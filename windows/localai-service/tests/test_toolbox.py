"""Toolbox contracts and owned-process smoke tests; no external mutations."""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
TEST_TMP = ROOT.parents[1] / 'tmp' / 'toolbox-tests'
TEST_TMP.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'src'))
from toolbox import Toolbox, ToolboxError, TOOLBOX_TOOLS, MAX_OUTPUT_BYTES


class FakeRunner:
    def __init__(self, stdout='done', exit_code=0, timed_out=False):
        self.stdout, self.exit_code, self.timed_out = stdout, exit_code, timed_out
        self.calls, self.staged = [], []

    def __call__(self, args, **options):
        self.calls.append((args, options))
        if '--body-file' in args:
            path = Path(args[args.index('--body-file') + 1])
            self.staged.append((path, path.read_bytes()))
        if args[-1].endswith('.cmd'):
            path = Path(options['cwd']) / args[-1]
            self.staged.append((path, path.read_bytes()))
        return {'exit_code': self.exit_code, 'timed_out': self.timed_out, 'stdout': self.stdout,
                'stderr': '', 'output_truncated': False, 'duration_ms': 1, 'cancelled': False}


class ToolboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='coucou-toolbox-tests-', dir=TEST_TMP)
        self.runner = FakeRunner()
        self.tools = Toolbox(self.temp.name, runner=self.runner)
        self.tools._directory(self.tools.workspace)
        self.executables = patch.object(self.tools, 'executable', side_effect=lambda name: name + '.exe')
        self.executables.start()

    def tearDown(self):
        self.executables.stop()
        self.tools.stop()
        self.temp.cleanup()

    def test_catalog_is_named_bounded_and_has_no_approval_boolean(self):
        self.assertEqual([tool['name'] for tool in TOOLBOX_TOOLS], ['terminal_run', 'github_action', 'ai_plan'])
        for tool in TOOLBOX_TOOLS:
            self.assertFalse(tool['inputSchema']['additionalProperties'])
            self.assertNotIn('user_approved', tool['inputSchema']['properties'])

    def test_cmd_runs_only_ascii_staged_basename_and_preserves_original_script(self):
        script = '@echo before\r\necho "A&B"\r\necho literal %PATH%\r\n'
        result = self.tools.call('terminal_run', {'shell': 'cmd', 'script': script})
        args, options = self.runner.calls[0]
        self.assertEqual(args[:4], ['cmd.exe', '/D', '/S', '/C'])
        self.assertRegex(args[-1], r'^coucou-reviewed-[A-Za-z0-9_-]+\.cmd$')
        self.assertNotIn(script, args)
        self.assertEqual(self.runner.staged[0][1].decode('utf-8'), '@echo off\r\nchcp 65001 >nul\r\n' + script)
        self.assertFalse(self.runner.staged[0][0].exists())
        self.assertEqual(options['timeout'], 30)
        self.assertEqual(Path(options['cwd']), self.tools.workspace)
        self.assertEqual(result['execution_boundary'], 'current_user')
        self.assertTrue(result['ok'])

    def test_powershell_uses_encoded_command_without_script_argument_interpolation(self):
        script = "param([string]$Name='Exact')\nWrite-Output 'Salom 😀'\n# whitespace  "
        self.tools.terminal_run({'shell': 'powershell', 'script': script, 'timeout_seconds': 60})
        args, options = self.runner.calls[0]
        self.assertEqual(args[:4], ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
        decoded = base64.b64decode(args[4]).decode('utf-16-le')
        self.assertTrue(decoded.endswith('& {\n' + script + '\n}'))
        self.assertLess(len(subprocess.list2cmdline(args)), 32767)
        self.assertEqual(options['timeout'], 60)

    def test_maximum_powershell_emoji_script_stays_inside_windows_commandline_limit(self):
        script = '#' + '😀' * 4999
        self.tools.terminal_run({'shell': 'powershell', 'script': script})
        self.assertLess(len(subprocess.list2cmdline(self.runner.calls[0][0])), 32767)

    def test_invalid_requests_are_rejected_before_any_process(self):
        for arguments in ({'shell': 'bash', 'script': 'echo yes'}, {'shell': 'cmd', 'script': ''},
                          {'shell': 'cmd', 'script': '\ud800'}, {'shell': 'cmd', 'script': 'bad\x00'},
                          {'shell': 'cmd', 'script': '😀' * 5001}, {'shell': 'cmd', 'script': 'echo yes', 'timeout_seconds': True},
                          {'shell': 'cmd', 'script': 'echo yes', 'timeout_seconds': 0},
                          {'shell': 'cmd', 'script': 'echo yes', 'unknown': True}):
            with self.assertRaises(ToolboxError):
                self.tools.terminal_run(arguments)
        with self.assertRaises(ToolboxError):
            self.tools.call('raw_shell', {})
        self.assertEqual(self.runner.calls, [])

    def test_cwd_is_relative_existing_and_confined(self):
        nested = self.tools.workspace / 'folder with spaces'
        nested.mkdir()
        result = self.tools.terminal_run({'shell': 'cmd', 'script': 'echo safe', 'cwd': 'folder with spaces'})
        self.assertEqual(Path(result['cwd']), nested)
        for cwd in ('../outside', 'C:\\outside', 'C:relative', '\\\\server\\share', '/outside', 'folder:stream', 'missing'):
            with self.assertRaises(ToolboxError):
                self.tools.terminal_run({'shell': 'cmd', 'script': 'echo safe', 'cwd': cwd})

    def test_credentials_are_excluded_and_common_token_output_redacted(self):
        with patch.dict(os.environ, {'TEST_API_KEY': 'Synthetic-secret-123', 'GH_TOKEN': 'ghp_' + 'x' * 36,
                                     'HTTP_PROXY': 'http://user:pass@proxy.invalid', 'GH_DEBUG': 'api'}, clear=False):
            env = self.tools.environment(github=True)
            self.assertNotIn('TEST_API_KEY', env)
            self.assertNotIn('GH_TOKEN', env)
            self.assertNotIn('HTTP_PROXY', env)
            self.assertNotIn('GH_DEBUG', env)
            value = self.tools.redact('Synthetic-secret-123 ghp_' + 'x' * 36 + ' Authorization: Bearer SECRET_AUTH')
            self.assertNotIn('Synthetic-secret', value)
            self.assertNotIn('ghp_', value)
            self.assertNotIn('SECRET_AUTH', value)

    def test_redaction_still_obeys_combined_output_byte_limit(self):
        stdout, stderr, truncated = self.tools.bounded_output('😀' * 20000, 'stderr' * 20000)
        self.assertLessEqual(len(stdout.encode('utf-8')) + len(stderr.encode('utf-8')), MAX_OUTPUT_BYTES)
        self.assertTrue(truncated)
        self.assertNotIn('\ufffd', stdout)

    def test_status_uses_only_public_login_never_auth_token_output(self):
        self.runner.stdout = 'synthetic-user\n'
        result = self.tools.status()
        self.assertEqual(result['github'], {'installed': True, 'authenticated': True, 'user': 'synthetic-user'})
        self.assertEqual(self.runner.calls[0][0], ['gh.exe', 'api', 'user', '--hostname', 'github.com', '--jq', '.login'])
        self.runner.stdout = 'raw\nTOKEN: synthetic-token'
        self.assertFalse(self.tools.status()['github']['authenticated'])
        self.assertNotIn('synthetic-token', json.dumps(self.tools.status()))

    def test_portable_github_and_python_are_available_without_global_installs(self):
        service = Path(self.temp.name) / 'portable-service'
        (service / 'src').mkdir(parents=True)
        (service / 'bin').mkdir()
        bundled = service / 'bin' / 'gh.exe'
        bundled.write_bytes(b'synthetic executable; never run')
        with patch('toolbox.__file__', str(service / 'src' / 'toolbox.py')):
            with patch('toolbox.shutil.which', return_value='global-gh.exe') as discover:
                self.assertEqual(Toolbox.executable('gh'), str(bundled))
                discover.assert_not_called()
                self.assertEqual(Toolbox.executable('python'), sys.executable)
                paths = Toolbox.environment()['PATH'].split(os.pathsep)
                self.assertEqual(paths[:2], [str(Path(sys.executable).resolve().parent), str(service / 'bin')])
                bundled.unlink()
                self.assertEqual(Toolbox.executable('gh'), 'global-gh.exe')
                discover.assert_called_once_with('gh')

    def test_github_read_actions_use_fixed_cli_arguments_and_json(self):
        cases = {'repos': ['repo', 'list'], 'issues': ['issue', 'list'], 'pulls': ['pr', 'list'], 'view': ['repo', 'view']}
        for operation, prefix in cases.items():
            self.runner.stdout = '[]' if operation != 'view' else '{"nameWithOwner":"owner/repo"}'
            result = self.tools.github_action({'operation': operation, **({'repo': 'owner/repo'} if operation != 'repos' else {})})
            args, options = self.runner.calls[-1]
            self.assertEqual(args[1:3], prefix)
            self.assertIn('--json', args)
            self.assertNotIn('--web', args)
            self.assertEqual(options['env']['GH_HOST'], 'github.com')
            self.assertIn('data', result)

    def test_issue_creation_body_file_preserves_exact_multiline_text_and_is_removed(self):
        body = '  First line\nsecond "quoted" line\n`$() literal` 😀  '
        self.runner.stdout = 'https://github.com/owner/repo/issues/123\n'
        result = self.tools.github_action({'operation': 'create_issue', 'repo': 'owner/repo', 'title': '--literal title', 'body': body})
        args = self.runner.calls[0][0]
        self.assertIn('--title=--literal title', args)
        self.assertNotIn(body, args)
        self.assertEqual(self.runner.staged[0][1], body.encode('utf-8'))
        self.assertFalse(self.runner.staged[0][0].exists())
        self.assertEqual(result['url'], 'https://github.com/owner/repo/issues/123')
        self.assertFalse(result['outcome_unknown'])

    def test_pr_creation_requires_head_and_base_and_never_pushes_or_shells(self):
        self.runner.stdout = 'https://github.com/owner/repo/pull/9\n'
        result = self.tools.github_action({'operation': 'create_pr', 'repo': 'owner/repo', 'title': 'Title',
                                          'body': 'Body', 'head': 'contributor:feature/test', 'base': 'main'})
        args = self.runner.calls[0][0]
        self.assertEqual(args[-4:], ['--head', 'contributor:feature/test', '--base', 'main'])
        self.assertNotIn('git', args)
        self.assertFalse(result['outcome_unknown'])
        with self.assertRaises(ToolboxError):
            self.tools.github_action({'operation': 'create_pr', 'repo': 'owner/repo', 'title': 'Title'})
        self.assertTrue(all(not path.exists() for path in self.tools.scratch.glob('github-body-*')))

    def test_timed_out_mutation_is_unknown_with_no_automatic_retry(self):
        self.runner.timed_out = True
        self.runner.exit_code = None
        result = self.tools.github_action({'operation': 'create_issue', 'repo': 'owner/repo', 'title': 'Title'})
        self.assertTrue(result['outcome_unknown'])
        self.assertTrue(result['mutation_attempted'])
        self.assertEqual(len(self.runner.calls), 1)

    def test_invalid_github_names_and_refs_never_execute(self):
        for repo in ('--flag', 'https://github.com/owner/repo', 'owner/repo;evil', 'owner/..', 'owner/repo/other'):
            with self.assertRaises(ToolboxError):
                self.tools.github_action({'operation': 'view', 'repo': repo})
        for ref in ('--flag', 'feature bad', 'bad..ref', 'foo/.private', 'foo.lock/bar', 'a:main', 'main\n'):
            with self.assertRaises(ToolboxError):
                self.tools.branch(ref)
        self.assertEqual(self.runner.calls, [])

    def request(self, proposal, **result_fields):
        self.requests = []
        def request(path, payload, **options):
            self.requests.append((path, payload, options))
            return {'provider': 'groq', 'model': 'synthetic-model',
                    'choices': [{'message': {'content': json.dumps(proposal, ensure_ascii=False)}}], **result_fields}
        self.tools.request = request

    def test_ai_terminal_plan_returns_only_proposal_without_execution(self):
        self.request({'summary': 'Proposal', 'steps': [{'title': 'Check', 'description': 'Review command', 'script': 'Write-Output "Salom"'}]})
        result = self.tools.ai_plan({'domain': 'terminal', 'task': 'Check setup', 'shell': 'powershell'})
        self.assertEqual(result['proposal']['steps'][0]['script'], 'Write-Output "Salom"')
        self.assertFalse(result['execution_performed'])
        self.assertEqual(result['provider'], 'groq')
        self.assertEqual(result['domain'], 'terminal')
        self.assertEqual(result['task'], 'Check setup')
        self.assertEqual(self.requests[0][0], '/v1/chat/completions')
        self.assertEqual(self.requests[0][1]['response_format'], {'type': 'json_object'})
        self.assertEqual(self.requests[0][2]['timeout'], 150)
        self.assertEqual(self.runner.calls, [])

    def test_ai_github_proposal_remains_named_and_never_creates_anything(self):
        self.request({'summary': 'Proposal', 'steps': [{'title': 'Issue', 'description': 'Review issue',
                    'operation': 'create_issue', 'arguments': {'repo': 'owner/repo', 'title': 'Synthetic'}}]})
        result = self.tools.ai_plan({'domain': 'github', 'task': 'Prepare issue'})
        self.assertEqual(result['proposal']['steps'][0]['operation'], 'create_issue')
        self.assertEqual(self.runner.calls, [])

    def test_ai_rejects_unknown_fields_wrong_domain_invalid_refs_and_unbounded_steps(self):
        cases = [({'summary': 'Proposal', 'steps': [{'title': 'T', 'description': 'D', 'execute': True}]}, 'terminal'),
                 ({'summary': 'Proposal', 'steps': [{'title': 'T', 'description': 'D', 'script': 'echo unsafe'}]}, 'desktop'),
                 ({'summary': 'Proposal', 'steps': [{'title': 'T', 'description': 'D', 'operation': 'delete_repo'}]}, 'github'),
                 ({'summary': 'Proposal', 'steps': [{'title': 'T', 'description': 'D', 'operation': 'view', 'arguments': {'repo': '--inject'}}]}, 'github'),
                 ({'summary': 'Proposal', 'steps': [{'title': 'T', 'description': 'D'}] * 13}, 'terminal')]
        for proposal, domain in cases:
            self.request(proposal)
            with self.assertRaises(ToolboxError):
                self.tools.ai_plan({'domain': domain, 'task': 'Synthetic task'})
        self.assertEqual(self.runner.calls, [])

    def test_ai_provider_failure_is_static_and_stop_invalidates_late_proposal(self):
        def fail(*unused, **kwargs):
            raise ValueError('PRIVATE request and key')
        self.tools.request = fail
        with self.assertRaises(ToolboxError) as error:
            self.tools.ai_plan({'task': 'Task', 'domain': 'terminal'})
        self.assertNotIn('PRIVATE', str(error.exception))
        def late(*unused, **kwargs):
            self.tools.stop()
            return {'choices': [{'message': {'content': '{"summary":"S","steps":[{"title":"T","description":"D"}]}'}}]}
        self.tools.request = late
        with self.assertRaises(ToolboxError) as error:
            self.tools.ai_plan({'task': 'Task', 'domain': 'terminal'})
        self.assertIn('Stop', str(error.exception))

    def test_ai_json_duplicate_keys_are_rejected(self):
        self.tools.request = lambda *args, **kwargs: {'choices': [{'message': {'content': '{"summary":"S","summary":"D","steps":[]}'}}]}
        with self.assertRaises(ToolboxError):
            self.tools.ai_plan({'task': 'Task', 'domain': 'terminal'})


class OwnedProcessTests(unittest.TestCase):
    """Real subprocesses write only synthetic artifacts in their temporary cwd."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='coucou-toolbox-owned-', dir=TEST_TMP)
        self.tools = Toolbox(self.temp.name)
        self.cwd = self.tools._cwd()

    def tearDown(self):
        self.tools.stop()
        self.temp.cleanup()

    def test_real_process_captures_and_bounds_output(self):
        result = self.tools._run_process([sys.executable, '-I', '-c', 'import sys;sys.stdout.write("x"*100000);sys.stderr.write("e"*100000)'],
                                        cwd=self.cwd, timeout=10, env=self.tools.environment())
        self.assertEqual(result['exit_code'], 0)
        self.assertTrue(result['output_truncated'])
        self.assertLessEqual(len(result['stdout'].encode()) + len(result['stderr'].encode()), MAX_OUTPUT_BYTES)

    def test_real_timeout_kills_owned_child_tree(self):
        marker = self.cwd / 'must-not-exist.txt'
        child = 'import time,pathlib;time.sleep(3);pathlib.Path("must-not-exist.txt").write_text("bad")'
        parent = 'import subprocess,sys,time;subprocess.Popen([sys.executable,"-I","-c",' + repr(child) + ']);time.sleep(30)'
        result = self.tools._run_process([sys.executable, '-I', '-c', parent], cwd=self.cwd, timeout=.2, env=self.tools.environment())
        self.assertTrue(result['timed_out'])
        time.sleep(3.2)
        self.assertFalse(marker.exists())

    @unittest.skipUnless(os.name == 'nt', 'Windows unsigned process exit status')
    def test_native_windows_failure_exit_code_is_signed_for_gui_contract(self):
        script = 'import ctypes;ctypes.windll.kernel32.ExitProcess(0xC0000005)'
        result = self.tools._run_process([sys.executable, '-I', '-c', script], cwd=self.cwd,
                                        timeout=10, env=self.tools.environment())
        self.assertEqual(result['exit_code'], -1073741819)
        self.assertFalse(result['timed_out'])

    def test_stop_cancels_an_owned_running_process(self):
        values = []
        thread = threading.Thread(target=lambda: values.append(self.tools._run_process(
            [sys.executable, '-I', '-c', 'import time;time.sleep(30)'], cwd=self.cwd, timeout=10, env=self.tools.environment())))
        thread.start()
        deadline = time.monotonic() + 3
        while not self.tools.active and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertTrue(self.tools.stop()['stopped'])
        thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertTrue(values[0]['cancelled'])
        self.assertEqual(self.tools.active, {})

    @unittest.skipUnless(os.name == 'nt', 'Windows shells')
    def test_real_cmd_and_powershell_run_with_spaces_unicode_and_param_block(self):
        nested = self.cwd / 'folder with spaces'
        nested.mkdir()
        cmd = self.tools.terminal_run({'shell': 'cmd', 'cwd': nested.name, 'script': 'echo Salom CMD\r\necho Matn 😀', 'timeout_seconds': 10})
        self.assertEqual(cmd['exit_code'], 0, repr(cmd))
        self.assertIn('Salom CMD', cmd['stdout'])
        self.assertIn('😀', cmd['stdout'])
        powershell = self.tools.terminal_run({'shell': 'powershell', 'cwd': nested.name,
            'script': "param([string]$Name='Salom')\nWrite-Output ($Name + ' PowerShell 😀')", 'timeout_seconds': 10})
        self.assertEqual(powershell['exit_code'], 0, powershell['stderr'])
        self.assertIn('Salom PowerShell 😀', powershell['stdout'])
        self.assertEqual(list(nested.glob('coucou-reviewed-*')), [])


if __name__ == '__main__':
    unittest.main()
