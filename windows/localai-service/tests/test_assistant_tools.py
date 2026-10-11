from __future__ import annotations

import ctypes
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from assistant_tools import (AssistantTools, AssistantStorage, DPAPICodec, CLIProcess,
                             ReplyParser, ASSISTANT_TOOLS, CODEX_DISABLED, sensitive)
from toolbox import ToolboxError
from toolbox_runtime import ToolboxRuntime
from tool_client import advanced_catalog


class FixtureCodec:
    def transform(self, value, encrypt):
        if encrypt:
            return b"TEST-ENCRYPTED:" + bytes(character ^ 173 for character in value)
        if not value.startswith(b"TEST-ENCRYPTED:"):
            raise ToolboxError("Invalid fixture cipher")
        return bytes(character ^ 173 for character in value[15:])


class Broker:
    def __init__(self):
        self.calls = []
        self.cancelled = False
    def available(self):
        return {"selected": "auto", "configured": {"google": False, "groq": False}}
    def complete(self, body, **kwargs):
        self.calls.append((body, kwargs))
        return {"message": {"content": "Salom, Moshi!"}, "provider": "ollama", "model": "fixture"}
    def cancel(self):
        self.cancelled = True


class FixtureProcess:
    def __init__(self, *, logged_in=True, compatible=True, tool=False):
        self.calls = []
        self.logged_in, self.compatible, self.tool = logged_in, compatible, tool
        self.stopped = False
    def stop(self): self.stopped = True
    def run(self, argv, **kwargs):
        self.calls.append((argv, kwargs))
        result = {"exit_code": 0, "stdout": "", "stderr": "", "cancelled": False,
                  "timed_out": False, "tool_attempted": False, "output_limit": False}
        if argv[-1] == "--help":
            result["stdout"] = "--json --tools --strict-mcp-config --safe-mode --no-session-persistence --ignore-user-config --ignore-rules --ephemeral --sandbox" if self.compatible else "old CLI"
        elif "features" in argv:
            result["stdout"] = "\n".join(f"{feature} stable true" for feature in {*CODEX_DISABLED, "skip_host_skill_discovery"})
        elif "login" in argv:
            result.update(exit_code=0 if self.logged_in else 1, stderr="Logged in using account private@example.invalid" if self.logged_in else "Not logged in")
        elif "auth" in argv:
            result["stdout"] = json.dumps({"loggedIn": self.logged_in, "email": "private@example.invalid"})
        else:
            event = {"type": "item.completed", "item": {"id": "one", "type": "command_execution" if self.tool else "agent_message", "text": "Salom, o‘zbekcha!"}}
            if kwargs["line_handler"](json.dumps(event)) is False:
                result.update(tool_attempted=True, exit_code=1)
        return result


class StorageTests(unittest.TestCase):
    def storage(self, directory):
        return AssistantStorage(Path(directory), codec=FixtureCodec())

    def test_explicit_memory_encrypted_deduplicated_and_forgotten(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = self.storage(directory)
            item = storage.remember("Menga o‘zbekcha javob ber", "user")
            saved = storage.memory_path.read_bytes()
            self.assertNotIn(b"o\xe2\x80\x98zbekcha", saved)
            self.assertEqual(storage.memories()[0]["text"], "Menga o‘zbekcha javob ber")
            self.assertTrue(storage.remember("menga o‘zbekcha javob ber")["duplicate"])
            self.assertEqual(len(storage.memories()), 1)
            self.assertTrue(storage.forget(item["item"]["id"])["forgotten"])
            self.assertEqual(storage.memories(), [])
            self.assertFalse(storage.forget(item["item"]["id"])["forgotten"])

    def test_secrets_rejected_before_persistence(self):
        samples = ["parol: juda maxfiy", "api key: fixture", "kirish kodi 12345", "4111 1111 1111 1111",
                   "sk-" + "x" * 30, "123456789:" + "A" * 24, "Authorization: Bearer abcdefgh123",
                   "Пароль: maxfiy", "парол 123456", "кириш коди 12345", "код подтверждения 23456",
                   "тасдиқлаш коди: 34567", "паспорт рақами: AA1234567", "api калит: secret", "OTP: 123456",
                   "ЖШШИР: 12345678901234", "карта рақами: 1234567890123456", "номер паспорта: AA1234567"]
        with tempfile.TemporaryDirectory() as directory:
            storage = self.storage(directory)
            for value in samples:
                with self.subTest(value=value):
                    self.assertTrue(sensitive(value))
                    with self.assertRaises(ToolboxError): storage.remember(value)
            self.assertFalse(storage.memory_path.exists())
            with self.assertRaises(ToolboxError): storage.remember("Uzbek", source="token:123")

    def test_nonsecret_cyrillic_preferences_remain_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = self.storage(directory)
            for value in ("Менга ўзбекча қисқа жавоблар ёқади", "Предпочитаю простые объяснения", "Моши ранги кўк бўлсин"):
                self.assertFalse(sensitive(value))
                self.assertTrue(storage.remember(value)["ok"])
            self.assertEqual(len(storage.memories()), 3)

    def test_environment_secret_rejected_from_memory(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"FIXTURE_API_KEY": "longfixturesecret123"}):
            with self.assertRaises(ToolboxError): self.storage(directory).remember("Use longfixturesecret123")

    def test_invalid_unicode_bounds_and_field_names_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            assistant = AssistantTools(Path(directory), storage=self.storage(directory), broker=Broker(), finder=lambda _: None)
            for arguments in ({"text": "x" * 501}, {"text": "\ud800"}, {"text": "Uzbek", "import_contacts": True}):
                with self.assertRaises(ToolboxError): assistant.call("assistant_memory_remember", arguments)
            with self.assertRaises(ToolboxError): assistant.call("assistant_memory_forget", {"id": "../"})
            with self.assertRaises(ToolboxError): assistant.call("assistant_activity", {"limit": True})

    def test_memory_corruption_is_preserved_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = self.storage(directory)
            storage.memory_path.parent.mkdir()
            storage.memory_path.write_bytes(b"broken encrypted memory")
            for action in (storage.memories, lambda: storage.remember("O‘zbekcha")):
                with self.assertRaises(ToolboxError): action()
            self.assertEqual(storage.memory_path.read_bytes(), b"broken encrypted memory")

    def test_limit_enforced_and_own_data_only(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = self.storage(directory)
            for index in range(80): storage.remember(f"Preference {index}")
            with self.assertRaises(ToolboxError): storage.remember("One more preference")
            self.assertEqual(len(storage.memories()), 80)

    def test_receipts_persist_only_metadata_and_states(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = self.storage(directory)
            started = time.monotonic()
            storage.receipt("terminal_run", started, {"ok": True, "script": "VERY_PRIVATE_SCRIPT", "stdout": "PRIVATE_OUTPUT"})
            storage.receipt("assistant_brain_reply", started, {"cancelled": True, "reply": "PRIVATE_PROMPT"})
            storage.receipt("github_action", started, {"outcome_unknown": True})
            raw = storage.activity_path.read_text()
            self.assertNotIn("PRIVATE", raw)
            self.assertEqual([item["state"] for item in storage.activities()], ["unknown", "cancelled", "completed"])
            self.assertEqual(set(storage.activities()[0]), {"id", "time", "tool", "state", "elapsed_ms"})

    def test_corrupt_receipt_extra_content_never_exposed(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = self.storage(directory)
            storage.activity_path.parent.mkdir()
            storage.activity_path.write_text(json.dumps({"schema": 1, "items": [{"id": "a" * 24, "time": "2026-10-11", "tool": "terminal_run", "state": "completed", "elapsed_ms": 4, "body": "private"}]}))
            self.assertNotIn("private", json.dumps(storage.activities()))

    def test_nonobject_activity_shapes_become_static_toolbox_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = self.storage(directory)
            storage.activity_path.parent.mkdir()
            for value in ([], "PRIVATE_CORRUPT_TEXT", 42, None, {"schema": 1, "items": [{"tool": []}]}):
                storage.activity_path.write_text(json.dumps(value))
                with self.assertRaises(ToolboxError) as caught: storage.activities()
                self.assertNotIn("PRIVATE", str(caught.exception))
                self.assertEqual(json.loads(storage.activity_path.read_text()), value)

    def test_corrupt_activity_cannot_hide_known_terminal_outcome(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = self.storage(directory)
            storage.activity_path.parent.mkdir()
            storage.activity_path.write_text("[]")
            runtime = ToolboxRuntime.__new__(ToolboxRuntime)
            runtime.root = Path(directory); runtime.lock = threading.Lock()
            runtime.assistant = Mock(); runtime.assistant.storage = storage
            runtime.terminal = Mock(); runtime.terminal.call.return_value = {"ok": True, "exit_code": 0, "stdout": "known result"}
            result = runtime.call({"name": "terminal_run", "arguments": {"shell": "cmd", "script": "literal reviewed script"}})
            self.assertEqual(result, {"ok": True, "exit_code": 0, "stdout": "known result"})
            self.assertFalse(runtime.activity_status["ok"])
            self.assertEqual(storage.activity_path.read_text(), "[]")
            runtime.terminal.call.assert_called_once()

    def test_any_future_audit_exception_preserves_action_result(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = ToolboxRuntime.__new__(ToolboxRuntime)
            runtime.root = Path(directory); runtime.lock = threading.Lock(); runtime.assistant = Mock()
            runtime.assistant.storage.receipt.side_effect = AttributeError("PRIVATE_DETAILS")
            runtime.terminal = Mock(); runtime.terminal.call.return_value = {"ok": True}
            self.assertEqual(runtime.call({"name": "terminal_run", "arguments": {}}), {"ok": True})
            self.assertNotIn("PRIVATE", json.dumps(runtime.activity_status))

    @unittest.skipUnless(os.name == "nt", "Windows DPAPI")
    def test_actual_dpapi_roundtrip_of_test_preference(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = AssistantStorage(Path(directory))
            storage.remember("Bu faqat test uchun o‘zbekcha eslatma")
            self.assertNotIn(b"faqat test", storage.memory_path.read_bytes())
            self.assertEqual(storage.memories()[0]["text"], "Bu faqat test uchun o‘zbekcha eslatma")


class BrainTests(unittest.TestCase):
    def assistant(self, directory, **kwargs):
        return AssistantTools(Path(directory), storage=AssistantStorage(Path(directory), codec=FixtureCodec()), broker=kwargs.pop("broker", Broker()), **kwargs)

    def test_status_redacted_cached_and_no_generation_request(self):
        with tempfile.TemporaryDirectory() as directory:
            process, broker = FixtureProcess(), Broker()
            assistant = self.assistant(directory, broker=broker, finder=lambda engine: [f"{engine}.exe"], process=process)
            first = assistant.status()
            count = len(process.calls)
            second = assistant.status()
            self.assertEqual(len(process.calls), count)
            self.assertEqual(first, second)
            self.assertNotIn("private@example", json.dumps(first))
            self.assertNotIn("command", json.dumps(first))
            self.assertEqual(broker.calls, [])
            self.assertTrue(first["brains"][0]["ready"])

    def test_incompatible_cli_never_generates(self):
        with tempfile.TemporaryDirectory() as directory:
            process = FixtureProcess(compatible=False)
            assistant = self.assistant(directory, finder=lambda _: ["codex.exe"], process=process)
            result = assistant.brain_reply({"prompt": "Salom", "engine": "codex"})
            self.assertFalse(result["ok"])
            self.assertEqual(len(process.calls), 1)

    def test_auto_preserves_broker_order_and_memory_is_data(self):
        with tempfile.TemporaryDirectory() as directory:
            broker = Broker()
            assistant = self.assistant(directory, broker=broker, finder=lambda _: None)
            assistant.storage.remember("Menga qisqa o‘zbekcha javoblar yoqadi")
            result = assistant.brain_reply({"prompt": "Salom"})
            self.assertTrue(result["ok"])
            body, options = broker.calls[0]
            self.assertEqual(body["messages"][1], {"role": "user", "content": "Salom"})
            self.assertIn("Menga qisqa", body["messages"][0]["content"])
            self.assertNotIn("tools", body)
            self.assertIn("elapsed_ms", result)

    def test_cli_uses_stdin_scratch_tools_off_and_auth_config_separated(self):
        with tempfile.TemporaryDirectory() as directory:
            process = FixtureProcess()
            assistant = self.assistant(directory, finder=lambda _: ["codex.exe"], process=process)
            result = assistant.brain_reply({"prompt": "UNIQUE_PRIVATE_PROMPT", "engine": "codex"})
            self.assertEqual(result["reply"], "Salom, o‘zbekcha!")
            argv, options = process.calls[-1]
            self.assertNotIn("UNIQUE_PRIVATE_PROMPT", " ".join(argv))
            self.assertIn(b"UNIQUE_PRIVATE_PROMPT", options["stdin"])
            for flag in ("--ignore-user-config", "--ignore-rules", "--ephemeral", "read-only", "mcp_servers={}"):
                self.assertIn(flag, argv)
            for feature in ("shell_tool", "unified_exec", "hooks", "plugins", "apps", "computer_use"):
                self.assertIn(feature, argv)
                self.assertEqual(argv[argv.index(feature) - 1], "--disable")
            self.assertFalse(Path(options["cwd"]).exists())

    def test_tool_event_discards_partial_text_and_has_no_auto_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            process = FixtureProcess(tool=True)
            assistant = self.assistant(directory, finder=lambda _: ["codex.exe"], process=process)
            result = assistant.brain_reply({"prompt": "Test", "engine": "codex"})
            self.assertFalse(result["ok"])
            self.assertTrue(result["tool_attempted"])
            self.assertEqual(result["reply"], "")
            self.assertEqual(sum(1 for argv, _ in process.calls if argv[-1] == "-"), 1)

    def test_cancel_suppresses_late_ignored_provider_response(self):
        class SlowBroker(Broker):
            def __init__(self): super().__init__(); self.entered = threading.Event(); self.release = threading.Event()
            def complete(self, body, **kwargs):
                self.entered.set(); self.release.wait(3)
                return {"message": {"content": "LATE_REPLY"}, "provider": "ollama"}
        with tempfile.TemporaryDirectory() as directory:
            broker = SlowBroker()
            assistant = self.assistant(directory, broker=broker, finder=lambda _: None)
            runtime = ToolboxRuntime.__new__(ToolboxRuntime)
            runtime.root = Path(directory); runtime.lock = threading.Lock(); runtime.assistant = assistant
            output = []
            thread = threading.Thread(target=lambda: output.append(runtime.call({"name": "assistant_brain_reply", "arguments": {"prompt": "Test"}})))
            thread.start(); self.assertTrue(broker.entered.wait(2))
            self.assertTrue(runtime.call({"name": "assistant_cancel", "arguments": {}})["cancelled"])
            broker.release.set(); thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertTrue(output[0]["cancelled"])
            self.assertEqual(output[0]["reply"], "")
            self.assertTrue(broker.cancelled)
            self.assertFalse(assistant.cancel.is_set())

    def test_entire_provider_chain_is_bounded_and_late_reply_discarded(self):
        class NeverBroker(Broker):
            def __init__(self): super().__init__(); self.release = threading.Event()
            def complete(self, body, **kwargs):
                self.release.wait(2)
                return {"message": {"content": "LATE"}, "provider": "ollama"}
        with tempfile.TemporaryDirectory() as directory:
            broker = NeverBroker()
            assistant = self.assistant(directory, broker=broker, finder=lambda _: None)
            started = time.monotonic()
            result = assistant._broker_reply("Test", "System", 0.05, threading.Event())
            self.assertTrue(result["timed_out"])
            self.assertLess(time.monotonic() - started, 0.5)
            self.assertTrue(broker.cancelled)
            self.assertEqual(result["reply"], "")
            broker.release.set()

    def test_provider_tool_call_returns_no_text_and_no_effect(self):
        class ToolBroker(Broker):
            def complete(self, body, **kwargs):
                return {"message": {"content": "I sent it", "tool_calls": [{"function": {"name": "telegram_send"}}]}}
        with tempfile.TemporaryDirectory() as directory:
            assistant = self.assistant(directory, broker=ToolBroker(), finder=lambda _: None)
            result = assistant.brain_reply({"prompt": "Test"})
            self.assertFalse(result["ok"])
            self.assertEqual(result["reply"], "")

    def test_status_and_readonly_polling_bypass_effect_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = ToolboxRuntime.__new__(ToolboxRuntime)
            runtime.root = Path(directory); runtime.lock = threading.Lock(); runtime.assistant = Mock()
            runtime.assistant.call.return_value = {"ok": True}
            runtime.lock.acquire()
            for name in ("assistant_status", "assistant_memory_list", "assistant_activity", "assistant_cancel"):
                self.assertEqual(runtime.call({"name": name, "arguments": {}}), {"ok": True})
            runtime.lock.release()

    def test_catalog_contains_assistant_and_no_implicit_send_or_login(self):
        names = {tool["name"] for tool in advanced_catalog()}
        self.assertTrue({tool["name"] for tool in ASSISTANT_TOOLS}.issubset(names))
        self.assertNotIn("assistant_login", names)
        self.assertNotIn("assistant_execute_reply", names)


class ParserTests(unittest.TestCase):
    def test_codex_updates_deduplicate_and_unknown_tool_types_fail_closed(self):
        parser = ReplyParser("codex", time.monotonic())
        for value in ("Sa", "Salom"):
            self.assertTrue(parser.feed(json.dumps({"type": "item.updated", "item": {"id": "a", "type": "agent_message", "text": value}})))
        self.assertEqual(parser.reply(), "Salom")
        self.assertTrue(parser.feed(json.dumps({"type": "item.completed", "item": {"type": "error", "message": "nonfatal CLI warning"}})))
        self.assertEqual(parser.reply(), "Salom")
        self.assertFalse(parser.feed(json.dumps({"type": "item.started", "item": {"type": "future_tool"}})))
        self.assertEqual(parser.reply(), "")

    def test_claude_tools_fail_and_malformed_events_do_not_raise(self):
        parser = ReplyParser("claude", time.monotonic())
        self.assertFalse(parser.feed("[]"))
        self.assertTrue(parser.invalid_event)
        parser = ReplyParser("claude", time.monotonic())
        for event in ({"type": "assistant", "message": "wrong"}, {"type": "stream_event", "event": {"content_block": "wrong"}}):
            self.assertTrue(parser.feed(json.dumps(event)))
        self.assertFalse(parser.feed(json.dumps({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "terminal"}]}})))

    def test_malformed_event_and_item_types_fail_closed_without_typeerror(self):
        for engine in ("codex", "claude"):
            for event in ({"type": []}, {"type": {}}, {"type": None},
                          {"type": "item.updated", "item": []}, {"type": "item.completed", "item": "bad"},
                          {"type": "item.updated", "item": {"type": []}},
                          {"type": "item.completed", "item": {"type": {}}}):
                with self.subTest(engine=engine, event=event):
                    parser = ReplyParser(engine, time.monotonic())
                    parser.final = "Must not escape"
                    parser.messages["prior"] = "Must not escape"
                    self.assertFalse(parser.feed(json.dumps(event)))
                    self.assertTrue(parser.invalid_event)
                    self.assertEqual(parser.reply(), "")


class ProcessTests(unittest.TestCase):
    def test_jsonl_process_stdin_and_drain(self):
        code = "import json,sys; data=sys.stdin.read(); print(json.dumps({'type':'item.completed','item':{'id':'x','type':'agent_message','text':data}}),flush=True)"
        with tempfile.TemporaryDirectory() as directory:
            parser = ReplyParser("codex", time.monotonic())
            result = CLIProcess().run([sys.executable, "-c", code], cwd=directory, timeout=3,
                                      stdin="o‘zbekcha".encode(), line_handler=parser.feed)
            self.assertEqual(result["exit_code"], 0)
            self.assertEqual(parser.reply(), "o‘zbekcha")

    def test_cancel_does_not_wait_for_long_process(self):
        with tempfile.TemporaryDirectory() as directory:
            process = CLIProcess(); output = []
            thread = threading.Thread(target=lambda: output.append(process.run([sys.executable, "-c", "import time; time.sleep(30)"], cwd=directory, timeout=30)))
            thread.start()
            deadline = time.monotonic() + 3
            while not process.active and time.monotonic() < deadline: time.sleep(0.01)
            process.stop(); thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertTrue(output[0]["cancelled"])
            self.assertFalse(process.active)

    def test_never_reading_stdin_remains_timeout_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            result = CLIProcess().run([sys.executable, "-c", "import time; time.sleep(30)"], cwd=directory,
                                      timeout=0.2, stdin=b"x" * 40000)
            self.assertTrue(result["timed_out"])

    def test_tool_attempt_kills_actual_owned_process(self):
        code = "import json,time; print(json.dumps({'type':'item.started','item':{'type':'command_execution'}}),flush=True); time.sleep(30)"
        with tempfile.TemporaryDirectory() as directory:
            parser = ReplyParser("codex", time.monotonic())
            result = CLIProcess().run([sys.executable, "-c", code], cwd=directory, timeout=3, line_handler=parser.feed)
            self.assertTrue(result["tool_attempted"])
            self.assertFalse(result["timed_out"])

    @unittest.skipUnless(os.name == "nt", "Windows job lifetime")
    def test_job_closes_background_child_after_parent_exits(self):
        code = "import subprocess,sys,json; child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); print(json.dumps({'child_pid':child.pid}),flush=True)"
        with tempfile.TemporaryDirectory() as directory:
            result = CLIProcess().run([sys.executable, "-c", code], cwd=directory, timeout=3)
            pid = json.loads(result["stdout"])["child_pid"]
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
            kernel.OpenProcess.restype = ctypes.c_void_p
            kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            handle = kernel.OpenProcess(0x1000, False, pid)
            if handle:
                try:
                    value = ctypes.c_uint32()
                    self.assertTrue(kernel.GetExitCodeProcess(handle, ctypes.byref(value)))
                    self.assertNotEqual(value.value, 259)  # STILL_ACTIVE
                finally:
                    kernel.CloseHandle(handle)


if __name__ == "__main__": unittest.main()
