"""Offline speech boundary and owned-process tests; no microphone or network."""
from __future__ import annotations

import base64
import array
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT.parents[1] / 'tmp' / 'voice-tests'
TMP.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'src'))
import voice_tools
from voice_tools import (VoiceTools, VoiceError, MODEL_SHA1, MAX_AUDIO_BYTES, MAX_TEXT_UNITS, MAX_TTS_AUDIO_BYTES,
                         MAX_MODEL_ASSET_BYTES, MAX_STT_ASSET_BYTES)


def wav(*, seconds=1, rate=16000, channels=1, width=2, silent=False):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as output:
        output.setnchannels(channels)
        output.setsampwidth(width)
        output.setframerate(rate)
        sample = b'\0' * width if silent else (b'\x20\x03' if width == 2 else b'\x90' * width)
        output.writeframes(sample * int(seconds * rate) * channels)
    return stream.getvalue()


def arguments(raw=None, **extra):
    return {'audio_base64': base64.b64encode(wav() if raw is None else raw).decode('ascii'), 'language': 'uz', **extra}


class Runner:
    def __init__(self):
        self.calls = []
        self.text = ' Salom, O‘zbekiston!'
        self.exit_code = 0
        self.timed_out = False
        self.callback = None
        self.custom = None

    def __call__(self, args, **options):
        audio = Path(args[args.index('-f') + 1])
        output = Path(args[args.index('-of') + 1]).with_suffix('.json')
        self.calls.append((args, options, audio, audio.read_bytes(), output))
        value = self.custom if self.custom is not None else {'transcription': [{'text': self.text}]}
        output.write_text(json.dumps(value, ensure_ascii=True), encoding='utf-8')
        if self.callback:
            self.callback()
        return {'exit_code': self.exit_code, 'timed_out': self.timed_out}


class SpeechRunner:
    def __init__(self):
        self.calls, self.callback = [], None
        self.raw = wav(rate=22050)
        self.exit_code, self.timed_out = 0, False

    def __call__(self, args, **options):
        source = Path(args[args.index('-f') + 1])
        output = Path(args[args.index('-w') + 1])
        self.calls.append((args, options, source, source.read_bytes(), output))
        output.write_bytes(self.raw)
        if self.callback:
            self.callback()
        return {'exit_code': self.exit_code, 'timed_out': self.timed_out}


class VoiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='voice-unit-', dir=TMP)
        self.root = Path(self.temp.name)
        self.assets = self.root / 'installed' / 'voice'
        self.assets.mkdir(parents=True)
        self.model = b'synthetic multilingual base model; never loaded'
        files = {'whisper-cli.exe': b'synthetic executable; never run', 'ggml-base.bin': self.model,
                 'ggml.dll': b'synthetic native dependency', 'LICENSE': b'synthetic test license'}
        for name, content in files.items():
            (self.assets / name).write_bytes(content)
        self.manifest = {'schema': 1, 'engine': 'whisper.cpp', 'version': 'synthetic', 'model': 'base',
                         'exe': 'whisper-cli.exe', 'model_file': 'ggml-base.bin',
                         'files': [{'path': name, 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
                                   for name, content in files.items()]}
        self.save_manifest()
        self.identity = patch.dict(MODEL_SHA1, {'base': hashlib.sha1(self.model).hexdigest()})
        self.identity.start()
        self.runner = Runner()
        self.voice = VoiceTools(self.root / 'data', assets=self.assets, runner=self.runner)

    def tearDown(self):
        self.voice.stop()
        self.identity.stop()
        self.temp.cleanup()

    def save_manifest(self):
        (self.assets / 'manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')

    def uzbek_fixture(self):
        """Independent synthetic package; neither executable nor weights run."""
        directory = self.assets / 'uzbek'
        directory.mkdir()
        self.uzbek_model = b'synthetic Uzbek fine-tuned model; never loaded'
        self.uzbek_model_id = 'navai-small-uz-q5_1'
        name = 'ggml-' + self.uzbek_model_id + '.bin'
        files = {'whisper-cli.exe': b'synthetic executable; never run', name: self.uzbek_model,
                 'ggml.dll': b'synthetic native dependency', 'LICENSE': b'synthetic test license'}
        for filename, content in files.items():
            (directory / filename).write_bytes(content)
        manifest = {'schema': 1, 'engine': 'whisper.cpp', 'version': 'synthetic',
                    'model': self.uzbek_model_id, 'exe': 'whisper-cli.exe', 'model_file': name,
                    'files': [{'path': filename, 'size': len(content),
                               'sha256': hashlib.sha256(content).hexdigest()}
                              for filename, content in files.items()]}
        (directory / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        return directory, manifest

    def vad_fixture(self):
        self.vad_model_id = 'silero-v6.2.0'
        self.vad_model_file = 'ggml-' + self.vad_model_id + '.bin'
        self.vad_model = b'synthetic voice activity model; never loaded'
        path = self.assets / self.vad_model_file
        path.write_bytes(self.vad_model)
        self.manifest['files'].append({'path': self.vad_model_file, 'size': len(self.vad_model),
                                       'sha256': hashlib.sha256(self.vad_model).hexdigest()})
        self.manifest['vad'] = {'model': self.vad_model_id, 'model_file': self.vad_model_file}
        self.save_manifest()
        return path

    def assert_clean(self):
        self.assertEqual(list(self.voice.scratch.glob('utterance-*')), [])
        self.assertEqual(list(self.voice.scratch.glob('speech-*')), [])
        self.assertFalse(self.voice.serial.locked())
        for _, _, audio, _, output in self.runner.calls:
            self.assertFalse(audio.exists())
            self.assertFalse(output.exists())

    def tts_fixture(self):
        directory = self.assets / 'tts'
        directory.mkdir()
        names = ['espeak-ng.exe', 'libespeak-ng.dll', 'espeak-ng-data/phondata', 'espeak-ng-data/phontab',
                 'espeak-ng-data/phonindex', 'espeak-ng-data/uz_dict', 'espeak-ng-data/lang/trk/uz',
                 'espeak-ng-data/lang/gmw/en', 'espeak-ng-data/lang/zle/ru', 'espeak-ng-data/voices/!v/Mr serious']
        self.tts_manifest = {'schema': 1, 'engine': 'espeak-ng', 'exe': 'espeak-ng.exe', 'files': []}
        for name in names:
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            content = ('synthetic speech asset ' + name).encode('ascii')
            path.write_bytes(content)
            self.tts_manifest['files'].append({'path': name, 'size': len(content),
                                              'sha256': hashlib.sha256(content).hexdigest()})
        self.save_tts_manifest()
        self.runner = SpeechRunner()
        self.voice.runner = self.runner

    def save_tts_manifest(self):
        (self.assets / 'tts' / 'manifest.json').write_text(json.dumps(self.tts_manifest), encoding='utf-8')

    def test_offline_status_verifies_all_assets_without_creating_user_storage(self):
        status = self.voice.status()
        self.assertTrue(status['available'])
        self.assertEqual(status['model'], 'base')
        self.assertEqual(status['languages'], ['uz', 'en', 'ru'])
        self.assertEqual(status['voice_api'], 1)
        self.assertTrue(status['offline'])
        self.assertLessEqual(status['cpu_threads'], 4)
        self.assertFalse(self.voice.root.exists())
        self.assertEqual(self.runner.calls, [])

    def test_missing_assets_is_an_actionable_status_not_a_download(self):
        voice = VoiceTools(self.root / 'data', assets=self.root / 'absent')
        self.assertEqual(voice.status()['reason'], 'voice_assets_missing')
        self.assertFalse(voice.status()['available'])
        self.assertFalse((self.root / 'absent').exists())

    def test_corrupted_dependency_invalidates_verified_cache(self):
        self.assertTrue(self.voice.status()['available'])
        (self.assets / 'ggml.dll').write_bytes(b'corrupted')
        status = self.voice.status()
        self.assertFalse(status['available'])
        self.assertEqual(status['reason'], 'voice_assets_invalid')

    def test_manifest_rejects_path_escape_unknown_files_and_english_only_model(self):
        original = json.loads(json.dumps(self.manifest))
        for change in ('../outside.dll', 'whisper-cli.exe:stream'):
            self.manifest['files'][0]['path'] = change
            self.save_manifest()
            self.assertEqual(self.voice.status()['reason'], 'voice_assets_invalid')
        self.manifest = original
        self.save_manifest()
        extra = self.assets / 'untracked.dll'
        extra.write_bytes(b'not included in manifest')
        self.assertFalse(self.voice.status()['available'])
        extra.unlink()
        self.manifest['model'] = 'base.en'
        self.save_manifest()
        self.assertFalse(self.voice.status()['available'])

    def test_model_must_match_known_multilingual_identity_even_if_manifest_rewritten(self):
        with patch.dict(MODEL_SHA1, {'base': '0' * 40}):
            self.assertEqual(self.voice.status()['reason'], 'voice_assets_invalid')

    def test_model_identity_cannot_be_skipped_using_manifest_path_case(self):
        item = next(item for item in self.manifest['files'] if item['path'] == 'ggml-base.bin')
        model = self.assets / item['path']
        item['path'] = 'GGML-base.bin'
        model.rename(self.assets / item['path'])
        self.save_manifest()
        with patch.dict(MODEL_SHA1, {'base': '0' * 40}):
            self.assertEqual(self.voice.status()['reason'], 'voice_assets_invalid')

    def test_official_multilingual_quantized_small_is_supported_and_requires_its_identity(self):
        self.assertEqual(MODEL_SHA1['small-q5_1'], '6fe57ddcfdd1c6b07cdcc73aaf620810ce5fc771')
        item = next(item for item in self.manifest['files'] if item['path'] == 'ggml-base.bin')
        (self.assets / item['path']).rename(self.assets / 'ggml-small-q5_1.bin')
        item['path'] = 'ggml-small-q5_1.bin'
        self.manifest.update(model='small-q5_1', model_file=item['path'])
        self.save_manifest()
        with patch.dict(MODEL_SHA1, {'small-q5_1': hashlib.sha1(self.model).hexdigest()}):
            self.assertTrue(self.voice.status()['available'])
            self.assertEqual(self.voice.status()['model'], 'small-q5_1')
            self.assertEqual(self.voice.transcribe(arguments())['model'], 'small-q5_1')
            self.assertEqual(Path(self.runner.calls[-1][0][2]).name, 'ggml-small-q5_1.bin')
        # A rewritten manifest SHA256 cannot replace the known model identity.
        self.voice.verified = None
        self.assertEqual(self.voice.status()['reason'], 'voice_assets_invalid')
        self.assert_clean()

    def test_english_only_quantized_small_is_forbidden(self):
        item = next(item for item in self.manifest['files'] if item['path'] == 'ggml-base.bin')
        (self.assets / item['path']).rename(self.assets / 'ggml-small.en-q5_1.bin')
        item['path'] = 'ggml-small.en-q5_1.bin'
        self.manifest.update(model='small.en-q5_1', model_file=item['path'])
        self.save_manifest()
        self.assertEqual(self.voice.status()['reason'], 'voice_assets_invalid')
        self.assertEqual(self.runner.calls, [])

    def test_multilingual_quantized_turbo_identity_and_resource_budget(self):
        model = 'large-v3-turbo-q5_0'
        self.assertEqual(MODEL_SHA1[model], 'e050f7970618a659205450ad97eb95a18d69c9ee')
        self.assertGreater(MAX_MODEL_ASSET_BYTES, 574 * 1024 * 1024)
        self.assertLessEqual(MAX_MODEL_ASSET_BYTES, MAX_STT_ASSET_BYTES)
        item = next(item for item in self.manifest['files'] if item['path'] == 'ggml-base.bin')
        name = 'ggml-' + model + '.bin'
        (self.assets / item['path']).rename(self.assets / name)
        item['path'] = name
        self.manifest.update(model=model, model_file=name)
        self.save_manifest()
        with patch.dict(MODEL_SHA1, {model: hashlib.sha1(self.model).hexdigest()}):
            self.assertEqual(self.voice.status()['model'], model)
            self.assertEqual(self.voice.transcribe(arguments())['model'], model)
            args, options, _, _, _ = self.runner.calls[-1]
            self.assertEqual(Path(args[2]).name, name)
            self.assertLessEqual(int(args[args.index('-t') + 1]), 4)
            self.assertEqual(options['timeout'], 60)
        self.voice.verified = None
        self.assertEqual(self.voice.status()['reason'], 'voice_assets_invalid')
        self.assert_clean()

    def test_english_only_or_oversized_turbo_asset_is_forbidden(self):
        original = json.loads(json.dumps(self.manifest))
        self.manifest.update(model='large-v3-turbo.en-q5_0', model_file='ggml-large-v3-turbo.en-q5_0.bin')
        self.save_manifest()
        self.assertEqual(self.voice.status()['reason'], 'voice_assets_invalid')
        self.manifest = original
        self.manifest['files'][0]['size'] = MAX_MODEL_ASSET_BYTES + 1
        self.save_manifest()
        self.assertEqual(self.voice.status()['reason'], 'voice_assets_invalid')
        self.assertEqual(self.runner.calls, [])

    def test_uzbek_child_selection_is_isolated_and_keeps_literal_transcripts(self):
        directory, _ = self.uzbek_fixture()
        self.runner.text = ' @fixture_user ga “Panelni ochma! O‘zbekcha \\ literal” yubor'
        with patch.dict(MODEL_SHA1, {self.uzbek_model_id: hashlib.sha1(self.uzbek_model).hexdigest()}):
            status = self.voice.status()
            self.assertTrue(status['available'])
            self.assertEqual(status['model'], self.uzbek_model_id)
            self.assertEqual(status['models_by_language'], {'uz': self.uzbek_model_id, 'en': 'base', 'ru': 'base'})
            self.assertEqual(self.runner.calls, [])
            # Repeated alternation detects a verification cache that confuses
            # equal dependency bytes in the primary and child directories.
            for language in ('uz', 'en', 'uz', 'ru', 'uz'):
                expected = self.uzbek_model_id if language == 'uz' else 'base'
                selected = directory if language == 'uz' else self.assets
                value = self.voice.transcribe(arguments(language=language))
                self.assertEqual(value['model'], expected)
                self.assertEqual(value['language'], language)
                self.assertEqual(value['text'], self.runner.text.strip())
                self.assertFalse(value['execution_performed'])
                args, options, _, _, _ = self.runner.calls[-1]
                self.assertEqual(Path(args[args.index('-m') + 1]), selected / ('ggml-' + expected + '.bin'))
                self.assertEqual(Path(args[0]), selected / 'whisper-cli.exe')
                self.assertEqual(Path(options['cwd']), selected)
                self.assertEqual(args[args.index('-l') + 1], language)
                self.assertEqual('--no-timestamps' in args, language == 'uz')
            self.assert_clean()

    def test_broken_uzbek_child_never_falls_back_or_reuses_verified_primary(self):
        directory, manifest = self.uzbek_fixture()
        model_path = directory / manifest['model_file']
        manifest_path = directory / 'manifest.json'
        with patch.dict(MODEL_SHA1, {self.uzbek_model_id: hashlib.sha1(self.uzbek_model).hexdigest()}):
            self.assertTrue(self.voice.status()['available'])
            # A rewritten SHA256 and byte count must still fail the separately
            # pinned model identity; the valid primary is not an Uzbek fallback.
            changed = self.uzbek_model + b' tampered'
            model_path.write_bytes(changed)
            entry = next(item for item in manifest['files'] if item['path'] == manifest['model_file'])
            entry.update(size=len(changed), sha256=hashlib.sha256(changed).hexdigest())
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
            for broken in ('model-identity', 'manifest-json', 'missing-manifest'):
                with self.subTest(broken=broken):
                    if broken == 'manifest-json':
                        manifest_path.write_text('{invalid', encoding='utf-8')
                    elif broken == 'missing-manifest':
                        manifest_path.unlink()
                    # Verify the primary first to exercise cache alternation.
                    value = self.voice.transcribe(arguments(language='en'))
                    self.assertEqual(value['model'], 'base')
                    before = len(self.runner.calls)
                    status = self.voice.status()
                    self.assertFalse(status['available'])
                    self.assertIn(status['reason'], ('voice_assets_invalid', 'voice_assets_missing'))
                    with self.assertRaises(VoiceError) as caught:
                        self.voice.transcribe(arguments(language='uz'))
                    self.assertIn(caught.exception.code, ('voice_assets_invalid', 'voice_assets_missing'))
                    self.assertEqual(len(self.runner.calls), before)
                    self.assert_clean()

    def test_uzbek_child_and_its_root_cannot_be_redirected(self):
        directory, _ = self.uzbek_fixture()
        detached = self.root / 'detached-special-package'
        directory.rename(detached)
        redirected_root = self.root / 'redirected-voice-root'
        def link(path, target):
            if os.name == 'nt':
                result = subprocess.run([os.environ.get('COMSPEC', 'cmd.exe'), '/D', '/C', 'mklink', '/J',
                                         str(path), str(target)], capture_output=True, check=False)
                self.assertEqual(result.returncode, 0, (result.stdout + result.stderr).decode(errors='replace'))
            else:
                path.symlink_to(target, target_is_directory=True)
        def unlink(path):
            if os.name == 'nt':
                path.rmdir()
            else:
                path.unlink()
        link(directory, detached)
        try:
            with patch.dict(MODEL_SHA1, {self.uzbek_model_id: hashlib.sha1(self.uzbek_model).hexdigest()}):
                self.assertEqual(self.voice.status()['reason'], 'voice_assets_invalid')
                with self.assertRaises(VoiceError) as caught:
                    self.voice.transcribe(arguments(language='uz'))
                self.assertEqual(caught.exception.code, 'voice_assets_invalid')
                self.assertEqual(self.runner.calls, [])
                link(redirected_root, self.assets)
                try:
                    voice = VoiceTools(self.root / 'other-data', assets=redirected_root, runner=self.runner)
                    self.assertEqual(voice.status()['reason'], 'voice_assets_invalid')
                    with self.assertRaises(VoiceError) as caught:
                        voice.transcribe(arguments(language='uz'))
                    self.assertEqual(caught.exception.code, 'voice_assets_invalid')
                    self.assertEqual(self.runner.calls, [])
                finally:
                    unlink(redirected_root)
        finally:
            # Only remove the test-owned link, never recurse into its target.
            unlink(directory)
        self.assert_clean()

    def test_explicit_monolingual_package_rejects_english_and_russian_before_decode(self):
        directory, _ = self.uzbek_fixture()
        with patch.dict(MODEL_SHA1, {self.uzbek_model_id: hashlib.sha1(self.uzbek_model).hexdigest()}):
            voice = VoiceTools(self.root / 'special-data', assets=directory, runner=self.runner)
            try:
                for language in ('en', 'ru'):
                    with self.subTest(language=language):
                        with self.assertRaises(VoiceError) as caught:
                            voice.transcribe(arguments(language=language))
                        self.assertEqual(caught.exception.code, 'voice_model_language')
                        self.assertEqual(self.runner.calls, [])
                        self.assertFalse(voice.serial.locked())
                self.assertEqual(voice.transcribe(arguments(language='uz'))['model'], self.uzbek_model_id)
            finally:
                voice.stop()
        self.assert_clean()

    def test_absent_uzbek_child_keeps_primary_for_every_language_without_creating_child(self):
        status = self.voice.status()
        self.assertTrue(status['available'])
        self.assertEqual(status['model'], 'base')
        self.assertEqual(status['models_by_language'], {'uz': 'base', 'en': 'base', 'ru': 'base'})
        self.assertFalse((self.assets / 'uzbek').exists())
        self.assertFalse(self.voice.root.exists())
        for language in ('uz', 'en', 'ru'):
            value = self.voice.transcribe(arguments(language=language))
            self.assertEqual(value['model'], 'base')
            self.assertEqual(Path(self.runner.calls[-1][0][2]), self.assets / 'ggml-base.bin')
            self.assertFalse(value['execution_performed'])
        self.assertFalse((self.assets / 'uzbek').exists())
        self.assert_clean()

    def test_vad_pin_and_manifest_reject_tampering_before_decoder(self):
        path = self.vad_fixture()
        original = json.loads(json.dumps(self.manifest))
        with patch.dict(voice_tools.VAD_SHA256, {self.vad_model_id: hashlib.sha256(self.vad_model).hexdigest()}):
            self.assertTrue(self.voice.status()['available'])
            changed = self.vad_model + b' tampered'
            path.write_bytes(changed)
            entry = next(item for item in self.manifest['files'] if item['path'] == self.vad_model_file)
            entry.update(size=len(changed), sha256=hashlib.sha256(changed).hexdigest())
            self.save_manifest()
            self.assertEqual(self.voice.status()['reason'], 'voice_assets_invalid')
            with self.assertRaises(VoiceError) as caught:
                self.voice.transcribe(arguments())
            self.assertEqual(caught.exception.code, 'voice_assets_invalid')
            path.write_bytes(self.vad_model)
            for bad in ('../outside.bin', 'unknown-model', 'missing-model-file', 'wrong-shape', 'unlisted-file'):
                with self.subTest(vad_manifest=bad):
                    self.manifest = json.loads(json.dumps(original))
                    if bad == '../outside.bin':
                        self.manifest['vad']['model_file'] = bad
                    elif bad == 'unknown-model':
                        self.manifest['vad']['model'] = 'untrusted-vad'
                    elif bad == 'missing-model-file':
                        del self.manifest['vad']['model_file']
                    elif bad == 'wrong-shape':
                        self.manifest['vad'] = ['bad']
                    else:
                        self.manifest['files'] = [item for item in self.manifest['files']
                                                  if item['path'] != self.vad_model_file]
                    self.save_manifest()
                    self.assertEqual(self.voice.status()['reason'], 'voice_assets_invalid')
                    with self.assertRaises(VoiceError):
                        self.voice.transcribe(arguments())
                    self.assertEqual(self.runner.calls, [])
            self.assert_clean()

    def test_vad_arguments_preserve_raw_text_and_cancellation_bounds(self):
        path = self.vad_fixture()
        self.runner.text = ' @fixture_user ga “Panelni ochma! Salom.” yubor'
        with patch.dict(voice_tools.VAD_SHA256, {self.vad_model_id: hashlib.sha256(self.vad_model).hexdigest()}):
            value = self.voice.transcribe(arguments())
            self.assertEqual(value['text'], self.runner.text.strip())
            self.assertTrue(value['speech_detected'])
            self.assertFalse(value['execution_performed'])
            args, options, _, _, _ = self.runner.calls[-1]
            self.assertIn('--vad', args)
            self.assertEqual(Path(args[args.index('-vm') + 1]), path)
            self.assertEqual(args[args.index('-vt') + 1], '0.5')
            self.assertEqual(args[args.index('-vp') + 1], '200')
            self.assertEqual(options['timeout'], 60)
            self.assertLessEqual(int(args[args.index('-t') + 1]), 4)
            self.runner.callback = self.voice.stop
            with self.assertRaises(VoiceError) as caught:
                self.voice.transcribe(arguments())
            self.assertEqual(caught.exception.code, 'voice_cancelled')
            self.assert_clean()

    def test_vad_empty_result_is_no_speech_but_missing_or_malformed_json_still_fails(self):
        path = self.vad_fixture()
        with patch.dict(voice_tools.VAD_SHA256, {self.vad_model_id: hashlib.sha256(self.vad_model).hexdigest()}):
            for empty in ([], [{'text': ' \t\n'}]):
                self.runner.custom = {'transcription': empty}
                value = self.voice.transcribe(arguments())
                self.assertEqual(value['text'], '')
                self.assertFalse(value['speech_detected'])
                self.assertFalse(value['execution_performed'])
                self.assert_clean()
            def no_json(args, **options):
                result = self.runner(args, **options)
                Path(args[args.index('-of') + 1]).with_suffix('.json').unlink()
                return result
            for configured in (True, False):
                with self.subTest(vad_configured=configured):
                    if not configured:
                        del self.manifest['vad']
                        self.manifest['files'] = [item for item in self.manifest['files']
                                                  if item['path'] != self.vad_model_file]
                        path.unlink()
                        self.save_manifest()
                    self.voice.runner = no_json
                    with self.assertRaises(VoiceError):
                        self.voice.transcribe(arguments())
                    self.voice.runner = self.runner
                    self.runner.custom = {}
                    with self.assertRaises(VoiceError):
                        self.voice.transcribe(arguments())
                    self.assert_clean()

    def test_redirected_voice_directory_is_rejected_before_path_resolution(self):
        redirected = self.root / 'redirected'
        if os.name == 'nt':
            # Directory junctions need no symlink privilege on Windows. Only
            # create/remove this owned tmp link; never recurse through it.
            result = subprocess.run([os.environ.get('COMSPEC', 'cmd.exe'), '/D', '/C', 'mklink', '/J',
                                     str(redirected), str(self.assets)], capture_output=True, check=False)
            self.assertEqual(result.returncode, 0)
        else:
            redirected.symlink_to(self.assets, target_is_directory=True)
        try:
            voice = VoiceTools(self.root / 'data', assets=redirected)
            self.assertEqual(voice.status()['reason'], 'voice_assets_invalid')
            self.assertEqual(voice.status()['tts_reason'], 'voice_tts_assets_missing')
            self.assertEqual(voice.assets, redirected.absolute())
        finally:
            if os.name == 'nt':
                redirected.rmdir()
            else:
                redirected.unlink()

    def test_valid_languages_return_only_text_no_tool_execution(self):
        for language in ('uz', 'en', 'ru'):
            value = self.voice.transcribe(arguments(language=language, duration_seconds=1, request_id='request_1'))
            self.assertEqual(value['text'], 'Salom, O‘zbekiston!')
            self.assertEqual(value['language'], language)
            self.assertEqual(value['request_id'], 'request_1')
            self.assertFalse(value['execution_performed'])
            self.assertEqual(value['duration_seconds'], 1)
            args, options, audio, raw, _ = self.runner.calls[-1]
            self.assertEqual(args[args.index('-l') + 1], language)
            self.assertEqual(args[args.index('-p') + 1], '1')
            self.assertLessEqual(int(args[args.index('-t') + 1]), 4)
            self.assertIn('-ng', args)
            self.assertIn('-oj', args)
            self.assertIn('-np', args)
            self.assertEqual(options['timeout'], 60)
            self.assertTrue(audio.is_relative_to(self.voice.root))
            self.assertEqual(raw, wav())
            self.assert_clean()

    def test_audio_metadata_is_discarded_before_native_decoder(self):
        raw = wav()
        metadata = b'private metadata must not reach native decoder'
        extra = b'JUNK' + struct.pack('<I', len(metadata)) + metadata + (b'\0' if len(metadata) % 2 else b'')
        changed = raw[:4] + struct.pack('<I', len(raw) + len(extra) - 8) + raw[8:] + extra
        self.voice.transcribe(arguments(changed))
        self.assertEqual(self.runner.calls[0][3], raw)
        self.assert_clean()

    def test_silence_skips_decoder_and_audio_files(self):
        value = self.voice.transcribe(arguments(wav(silent=True)))
        self.assertEqual(value['text'], '')
        self.assertFalse(value['speech_detected'])
        self.assertEqual(self.runner.calls, [])
        self.assertFalse(self.voice.scratch.exists())

    def test_invalid_audio_formats_duration_base64_and_fields_never_run(self):
        invalid = [arguments(wav(rate=44100)), arguments(wav(channels=2)), arguments(wav(width=1)),
                   arguments(wav(seconds=15 + 1/16000)), arguments(wav()[:-2]), arguments(b'not wav'),
                   arguments(duration_seconds=True), arguments(duration_seconds=float('nan')),
                   arguments(duration_seconds=1.2), arguments(language='auto'), arguments(request_id='../escape'),
                   arguments(unknown=True), {'audio_base64': 'data:audio/wav;base64,AAAA'},
                   {'audio_base64': '%%%%'}, {'audio_base64': 'x' * (4 * ((MAX_AUDIO_BYTES + 2) // 3) + 1)}]
        for value in invalid:
            with self.assertRaises(VoiceError) as caught:
                self.voice.transcribe(value)
            self.assertEqual(caught.exception.code, 'voice_invalid_audio')
        self.assertEqual(self.runner.calls, [])
        self.assert_clean()

    def test_exact_fifteen_seconds_is_allowed(self):
        value = self.voice.transcribe(arguments(wav(seconds=15), duration_seconds=15))
        self.assertEqual(value['duration_seconds'], 15)
        self.assert_clean()

    def test_text_segments_are_combined_without_actions(self):
        self.runner.custom = {'transcription': [{'text': ' @testuser ga'}, {'text': ' salom yubor '}]}
        value = self.voice.transcribe(arguments())
        self.assertEqual(value['text'], '@testuser ga salom yubor')
        self.assertFalse(value['execution_performed'])
        self.assert_clean()

    def test_malformed_and_unbounded_decoder_text_is_not_returned(self):
        for value in ({}, {'transcription': ['bad']}, {'transcription': [{'text': 'bad\0'}]},
                      {'transcription': [{'text': '\ud800'}]}, {'transcription': [{'text': '😀' * (MAX_TEXT_UNITS // 2 + 1)}]},
                      {'transcription': [{'text': 'x'}] * 257}):
            self.runner.custom = value
            with self.assertRaises(VoiceError):
                self.voice.transcribe(arguments())
            self.assert_clean()

    def test_timeout_and_cli_failure_have_static_errors_and_clean_temp_audio(self):
        self.runner.timed_out = True
        with self.assertRaises(VoiceError) as caught:
            self.voice.transcribe(arguments())
        self.assertEqual(caught.exception.code, 'voice_timeout')
        self.assert_clean()
        self.runner.timed_out, self.runner.exit_code = False, 1
        with self.assertRaises(VoiceError) as caught:
            self.voice.transcribe(arguments())
        self.assertNotIn(self.runner.text, str(caught.exception))
        self.assert_clean()

    def test_stop_invalidates_late_result_and_requires_explicit_resume(self):
        self.runner.callback = self.voice.stop
        with self.assertRaises(VoiceError) as caught:
            self.voice.transcribe(arguments())
        self.assertEqual(caught.exception.code, 'voice_cancelled')
        self.assertTrue(self.voice.status()['halted'])
        self.assert_clean()
        self.runner.callback = None
        self.voice.resume()
        self.assertEqual(self.voice.transcribe(arguments())['text'], 'Salom, O‘zbekiston!')
        self.assert_clean()

    def test_shared_stop_marker_blocks_resume_and_transcription(self):
        marker = self.voice.root / 'runtime' / 'emergency-stop'
        marker.parent.mkdir(parents=True)
        marker.write_text('stop', encoding='utf-8')
        for operation in (self.voice.resume, lambda: self.voice.transcribe(arguments())):
            with self.assertRaises(VoiceError) as caught:
                operation()
            self.assertEqual(caught.exception.code, 'voice_cancelled')
        self.assertEqual(self.runner.calls, [])
        marker.unlink()
        self.voice.resume()
        self.voice.transcribe(arguments())
        self.assert_clean()

    def test_concurrent_transcription_is_rejected_and_cancelled_result_discarded(self):
        entered, release, errors = threading.Event(), threading.Event(), []
        self.runner.callback = lambda: (entered.set(), release.wait(3))
        def transcribe():
            try:
                self.voice.transcribe(arguments())
            except VoiceError as error:
                errors.append(error.code)
        thread = threading.Thread(target=transcribe)
        thread.start()
        self.assertTrue(entered.wait(2))
        try:
            with self.assertRaises(VoiceError) as caught:
                self.voice.transcribe(arguments())
            self.assertEqual(caught.exception.code, 'voice_busy')
            self.voice.stop()
        finally:
            release.set()
            thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, ['voice_cancelled'])
        self.assert_clean()

    def test_temporary_audio_directory_cannot_redirect_outside_data_root(self):
        outside = self.root / 'outside'
        outside.mkdir()
        self.voice.scratch = outside
        with self.assertRaises(VoiceError):
            self.voice.transcribe(arguments())
        self.assertEqual(list(outside.iterdir()), [])

    def test_tts_verifies_recursive_assets_and_keeps_stt_independent(self):
        self.tts_fixture()
        status = self.voice.status()
        self.assertTrue(status['available'])
        self.assertTrue(status['tts_available'])
        self.assertEqual(status['tts_engine'], 'espeak-ng')
        self.assertEqual(status['tts_languages'], ['uz', 'en', 'ru'])
        self.assertFalse(self.voice.root.exists())
        (self.assets / 'tts' / 'espeak-ng-data' / 'lang' / 'trk' / 'uz').write_bytes(b'broken')
        status = self.voice.status()
        self.assertTrue(status['available'])
        self.assertFalse(status['tts_available'])
        self.assertEqual(status['tts_reason'], 'voice_tts_assets_invalid')
        self.assertEqual(self.runner.calls, [])

    def test_tts_rejects_escape_duplicate_unknown_and_missing_language_files(self):
        self.tts_fixture()
        original = json.loads(json.dumps(self.tts_manifest))
        for path in ('../outside.dll', 'espeak-ng.exe:stream', '/absolute', 'espeak-ng-data/../outside'):
            self.tts_manifest = json.loads(json.dumps(original))
            self.tts_manifest['files'][0]['path'] = path
            self.save_tts_manifest()
            self.assertFalse(self.voice.status()['tts_available'])
        self.tts_manifest = json.loads(json.dumps(original))
        self.tts_manifest['files'].append(self.tts_manifest['files'][0])
        self.save_tts_manifest()
        self.assertFalse(self.voice.status()['tts_available'])
        self.tts_manifest = original
        self.save_tts_manifest()
        extra = self.assets / 'tts' / 'untracked.dll'
        extra.write_bytes(b'extra')
        self.assertFalse(self.voice.status()['tts_available'])
        extra.unlink()
        extra.mkdir()
        self.assertFalse(self.voice.status()['tts_available'])
        extra.rmdir()
        self.assertTrue(self.voice.status()['tts_available'])
        (self.assets / 'tts' / 'espeak-ng-data' / 'lang' / 'trk' / 'uz').unlink()
        self.assertFalse(self.voice.status()['tts_available'])

    def test_tts_preserves_literal_text_and_uses_file_arguments_without_playback(self):
        self.tts_fixture()
        text = ' O‘zbekiston!\r\n" & whoami; <speak>literal</speak> 😀 '
        for language in ('uz', 'en', 'ru'):
            value = self.voice.speak({'text': text, 'language': language, 'request_id': 'speech_1'})
            self.assertEqual(value['format'], 'wav')
            self.assertEqual(value['engine'], 'espeak-ng')
            self.assertFalse(value['execution_performed'])
            self.assertNotIn('text', value)
            self.assertEqual(value['sample_rate'], 22050)
            self.assertEqual(value['duration_seconds'], 1)
            self.assertEqual(value['request_id'], 'speech_1')
            self.assertEqual(base64.b64decode(value['audio_base64']), self.runner.raw)
            args, options, source, exact, output = self.runner.calls[-1]
            self.assertEqual(exact.decode('utf-8'), text)
            self.assertEqual(args[args.index('-v') + 1], language)
            self.assertEqual(args[args.index('-s') + 1], '155')
            self.assertEqual(args[args.index('-b') + 1], '1')
            self.assertNotIn('-m', args)
            self.assertNotIn(text, args)
            self.assertEqual(options['timeout'], 30)
            self.assertTrue(source.is_relative_to(self.voice.root))
            self.assertFalse(output.exists())
            self.assert_clean()

    def test_tts_invalid_text_never_invokes_decoder_and_uses_utf16_limit(self):
        self.tts_fixture()
        for args in ({}, {'text': ''}, {'text': ' \r\n'}, {'text': 'bad\0'}, {'text': '\ud800'},
                     {'text': '\x01'}, {'text': '😀' * 501}, {'text': 'x' * 1001},
                     {'text': 'test', 'language': 'auto'}, {'text': 'test', 'request_id': '../outside'},
                     {'text': 'test', 'unknown': True}):
            with self.assertRaises(VoiceError) as caught:
                self.voice.speak(args)
            self.assertEqual(caught.exception.code, 'voice_invalid_text')
        self.assertEqual(self.runner.calls, [])
        self.voice.speak({'text': '😀' * 500})
        self.assertEqual(len(self.runner.calls), 1)
        self.assert_clean()

    def test_tts_rejects_malformed_truncated_stereo_or_oversized_audio(self):
        self.tts_fixture()
        for raw in (b'not audio', wav(rate=22050)[:-2], wav(rate=22050, channels=2), wav(rate=22050, width=1),
                    b'x' * (MAX_TTS_AUDIO_BYTES + 1)):
            self.runner.raw = raw
            with self.assertRaises(VoiceError) as caught:
                self.voice.speak({'text': 'Salom'})
            self.assertEqual(caught.exception.code, 'voice_tts_output_invalid')
            self.assert_clean()

    def test_tts_stop_discards_late_wav_and_requires_resume(self):
        self.tts_fixture()
        self.runner.callback = self.voice.stop
        with self.assertRaises(VoiceError) as caught:
            self.voice.speak({'text': 'Salom'})
        self.assertEqual(caught.exception.code, 'voice_cancelled')
        self.assert_clean()
        self.runner.callback = None
        self.voice.resume()
        self.assertTrue(self.voice.speak({'text': 'Salom'})['ok'])
        self.assert_clean()

    def test_tts_and_stt_share_concurrency_and_cancellation(self):
        self.tts_fixture()
        entered, release, errors = threading.Event(), threading.Event(), []
        self.runner.callback = lambda: (entered.set(), release.wait(3))
        def speak():
            try:
                self.voice.speak({'text': 'Salom'})
            except VoiceError as error:
                errors.append(error.code)
        thread = threading.Thread(target=speak)
        thread.start()
        self.assertTrue(entered.wait(2))
        try:
            for operation in (lambda: self.voice.transcribe(arguments()), lambda: self.voice.speak({'text': 'Salom'})):
                with self.assertRaises(VoiceError) as caught:
                    operation()
                self.assertEqual(caught.exception.code, 'voice_busy')
            self.voice.stop()
        finally:
            release.set()
            thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, ['voice_cancelled'])
        self.assert_clean()

    def test_tts_timeout_and_failure_do_not_return_text_or_native_details(self):
        self.tts_fixture()
        self.runner.timed_out = True
        with self.assertRaises(VoiceError) as caught:
            self.voice.speak({'text': 'private synthetic text'})
        self.assertEqual(caught.exception.code, 'voice_timeout')
        self.assertNotIn('private', str(caught.exception))
        self.assert_clean()
        self.runner.timed_out, self.runner.exit_code = False, 1
        with self.assertRaises(VoiceError):
            self.voice.speak({'text': 'private synthetic text'})
        self.assert_clean()


@unittest.skipUnless(os.name == 'nt', 'Owned Windows Job lifecycle')
class OwnedProcessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='voice-job-', dir=TMP)
        self.root = Path(self.temp.name)
        self.voice = VoiceTools(self.root)

    def tearDown(self):
        self.voice.stop()
        self.temp.cleanup()

    def test_hidden_native_job_completes_without_returning_console_text(self):
        value = self.voice._run_cli([sys.executable, '-I', '-c', 'print("synthetic private transcript")'],
            cwd=self.root, timeout=5, env=dict(os.environ), generation=0)
        self.assertEqual(value, {'exit_code': 0, 'timed_out': False})
        self.assertIsNone(self.voice.active)

    def test_timeout_kills_owned_decoder_child_tree(self):
        child = 'import time,pathlib;time.sleep(3);pathlib.Path("must-not-exist.txt").write_text("bad")'
        parent = 'import subprocess,sys,time;subprocess.Popen([sys.executable,"-I","-c",' + repr(child) + ']);time.sleep(30)'
        value = self.voice._run_cli([sys.executable, '-I', '-c', parent], cwd=self.root,
            timeout=.2, env=dict(os.environ), generation=0)
        self.assertTrue(value['timed_out'])
        time.sleep(3.2)
        self.assertFalse((self.root / 'must-not-exist.txt').exists())
        self.assertIsNone(self.voice.active)

    def test_stop_kills_active_job_and_old_generation_cannot_start_another(self):
        results = []
        thread = threading.Thread(target=lambda: results.append(self.voice._run_cli(
            [sys.executable, '-I', '-c', 'import time;time.sleep(30)'], cwd=self.root,
            timeout=10, env=dict(os.environ), generation=0)))
        thread.start()
        deadline = time.monotonic() + 3
        while self.voice.active is None and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertIsNotNone(self.voice.active)
        self.voice.stop()
        thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertNotEqual(results[0]['exit_code'], 0)
        self.assertIsNone(self.voice.active)
        with self.assertRaises(VoiceError) as caught:
            self.voice._run_cli([sys.executable, '-I', '-c', 'pass'], cwd=self.root,
                timeout=5, env=dict(os.environ), generation=0)
        self.assertEqual(caught.exception.code, 'voice_cancelled')


@unittest.skipUnless(os.environ.get('COUCOU_TEST_NATIVE_VOICE') == '1', 'Explicit public-asset offline smoke')
class PublicAssetSmoke(unittest.TestCase):
    def synthetic_round_trip(self, phrase):
        with tempfile.TemporaryDirectory(prefix='voice-public-', dir=TMP) as directory:
            voice = VoiceTools(Path(directory) / 'data', assets=ROOT / 'public-voice')
            try:
                status = voice.status()
                self.assertTrue(status['available'], status.get('reason'))
                self.assertTrue(status['tts_available'], status.get('tts_reason'))
                spoken = voice.speak({'text': phrase, 'language': 'uz'})
                with wave.open(io.BytesIO(base64.b64decode(spoken['audio_base64'])), 'rb') as source:
                    rate, frames = source.getframerate(), source.readframes(source.getnframes())
                pcm = array.array('h', frames)
                if sys.byteorder != 'little':
                    pcm.byteswap()
                # Deterministic resampling of a public synthetic fixture only.
                resampled = array.array('h', (pcm[index * rate // 16000]
                                             for index in range(len(pcm) * 16000 // rate)))
                if sys.byteorder != 'little':
                    resampled.byteswap()
                stream = io.BytesIO()
                with wave.open(stream, 'wb') as output:
                    output.setnchannels(1)
                    output.setsampwidth(2)
                    output.setframerate(16000)
                    output.writeframes(resampled.tobytes())
                heard = voice.transcribe(arguments(stream.getvalue(), language='uz'))
                self.assertTrue(heard['text'].strip(), 'Decoder returned no text for synthetic speech')
                self.assertFalse(heard['execution_performed'])
                self.assertEqual(list(voice.scratch.iterdir()), [])
                print(json.dumps({'synthetic_uzbek_round_trip': True, 'tts_seconds': round(spoken['duration_seconds'], 2),
                                  'stt_processing_ms': heard['processing_ms'], 'transcript_units': len(heard['text']),
                                  'model': heard['model'], 'expected': phrase, 'synthetic_transcript': heard['text']},
                                 separators=(',', ':')))
            finally:
                voice.stop()

    def test_offline_uzbek_synthetic_round_trip_without_microphone_or_playback(self):
        for phrase in ('Salom. Bugun havo yaxshi. Ovoz sinovi.', 'Panelni och. Telegramni och.'):
            with self.subTest(synthetic_phrase=phrase):
                self.synthetic_round_trip(phrase)


if __name__ == '__main__':
    unittest.main()
