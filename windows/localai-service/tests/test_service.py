from __future__ import annotations

import contextlib
import copy
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from provider_broker import ProviderBroker, ProviderUnavailable, openai_messages, provider_order
from provider_credentials import credential_target
from service_paths import data_root, service_port


class FakeTransport:
    def __init__(self, failures=(), offered=None):
        self.failures = set(failures)
        self.offered = offered or {"ollama": ["qwen3.5:4b"], "google": ["gemini-3.8-flash"], "groq": ["llama-3.3-70b-versatile"]}
        self.calls = []
        self.ports = []

    def json(self, provider, path, body=None, **kwargs):
        self.calls.append((provider, path, copy.deepcopy(body), kwargs.get("key")))
        if provider == "ollama":
            self.ports.append(kwargs.get("ollama_port"))
        if provider in self.failures:
            raise ProviderUnavailable("Synthetic provider unavailable")
        if path == "/api/tags":
            return {"models": [{"name": model} for model in self.offered[provider]]}
        if path == "/models":
            return {"data": [{"id": model} for model in self.offered[provider]]}
        if path == "/api/chat":
            return {"message": {"role": "assistant", "content": "Synthetic local answer"}}
        return {"choices": [{"message": {"role": "assistant", "content": "Synthetic cloud answer"}}], "usage": {"prompt_tokens": 2, "completion_tokens": 3}}


def native_body(**changes):
    result = {"model": "qwen3.5:4b", "messages": [{"role": "system", "content": "Synthetic instruction"},
            {"role": "user", "content": "Synthetic request"}], "stream": True, "options": {"num_predict": 128, "temperature": 0.2}}
    result.update(changes)
    return result


class BrokerTests(unittest.TestCase):
    def broker(self, transport=None, settings=None, keys=("google", "groq")):
        return ProviderBroker(transport=transport or FakeTransport(), settings=lambda: settings or {"chatProvider": "auto"},
                              credentials=lambda provider: "synthetic-key" if provider in keys else None)

    def test_auto_prefers_ollama(self):
        transport = FakeTransport()
        result = self.broker(transport).complete(native_body())
        self.assertEqual(result["provider"], "ollama")
        self.assertEqual([item[0] for item in transport.calls], ["ollama", "ollama"])
        self.assertFalse(transport.calls[-1][2]["stream"])
        self.assertEqual(transport.ports, [11434, 11434])

    def test_saved_local_port_is_honored(self):
        transport = FakeTransport()
        self.broker(transport, settings={"chatProvider": "ollama", "ollamaUrl": "http://localhost:11436/v1"}).complete(native_body())
        self.assertEqual(transport.ports, [11436, 11436])

    def test_unsafe_or_recursive_local_address_never_called(self):
        for address in ("http://127.0.0.1:11435", "https://remote.invalid", "http://token@127.0.0.1:11434", "http://127.0.0.1:11434/?x=1"):
            transport = FakeTransport()
            with self.assertRaisesRegex(ProviderUnavailable, "LocalAI tools require local Ollama"):
                self.broker(transport, settings={"chatProvider": "ollama", "ollamaUrl": address}).complete(native_body())
            self.assertEqual(transport.calls, [])

    def test_auto_unsupported_ollama_address_falls_to_keyed_cloud(self):
        transport = FakeTransport()
        result = self.broker(transport, settings={"chatProvider": "auto", "ollamaUrl": "http://127.0.0.1:11435"}).complete(native_body())
        self.assertEqual(result["provider"], "google")
        self.assertEqual(transport.ports, [])

    def test_ollama_missing_falls_back_to_gemini(self):
        transport = FakeTransport(failures={"ollama"})
        result = self.broker(transport).complete(native_body())
        self.assertEqual(result["provider"], "google")
        self.assertEqual(result["eval_count"], 3)
        self.assertEqual(transport.calls[-1][2]["max_tokens"], 128)

    def test_ollama_gemini_missing_falls_back_to_groq(self):
        transport = FakeTransport(failures={"ollama", "google"})
        result = self.broker(transport).complete(native_body())
        self.assertEqual(result["provider"], "groq")
        self.assertEqual(transport.calls[-1][2]["max_completion_tokens"], 128)

    def test_groq_computer_schema_uses_supported_json_mode(self):
        transport = FakeTransport(failures={"ollama", "google"})
        schema = {"type": "object", "properties": {"action": {"type": "string", "enum": ["finish"]}}, "required": ["action"], "additionalProperties": False}
        result = self.broker(transport).complete(native_body(format=schema))
        self.assertEqual(result["provider"], "groq")
        outgoing = transport.calls[-1][2]
        self.assertEqual(outgoing["response_format"], {"type": "json_object"})
        instructions = [message["content"] for message in outgoing["messages"] if message["role"] == "system"]
        self.assertIn('"enum":["finish"]', " ".join(instructions))
        self.assertIn("JSON", " ".join(instructions))
        self.assertTrue(all(path in ("/api/tags", "/models", "/chat/completions") for _, path, _, _ in transport.calls))

    def test_unconfigured_cloud_is_not_called(self):
        transport = FakeTransport(failures={"ollama"})
        with self.assertRaises(ProviderUnavailable):
            self.broker(transport, keys=()).complete(native_body())
        self.assertEqual([item[0] for item in transport.calls], ["ollama"])

    def test_explicit_provider_never_falls_back(self):
        transport = FakeTransport(failures={"google"})
        with self.assertRaises(ProviderUnavailable):
            self.broker(transport, settings={"chatProvider": "google"}).complete(native_body())
        self.assertEqual([item[0] for item in transport.calls], ["google"])

    def test_unknown_provider_does_not_make_request(self):
        transport = FakeTransport()
        with self.assertRaises(ProviderUnavailable):
            self.broker(transport, settings={"chatProvider": "arbitrary"}).complete(native_body())
        self.assertEqual(transport.calls, [])

    def test_offered_saved_model_is_used(self):
        transport = FakeTransport(offered={"ollama": ["local-a", "local-b"]})
        result = self.broker(transport, settings={"chatProvider": "ollama", "chatModels": {"ollama": "local-b"}}).complete(native_body())
        self.assertEqual(result["model"], "local-b")

    def test_explicit_missing_saved_model_is_error(self):
        transport = FakeTransport()
        with self.assertRaises(ProviderUnavailable):
            self.broker(transport, settings={"chatProvider": "ollama", "chatModels": {"ollama": "missing"}}).complete(native_body())
        self.assertEqual(len(transport.calls), 1)

    def test_cancelled_request_never_starts_provider(self):
        import threading
        cancelled = threading.Event()
        cancelled.set()
        transport = FakeTransport()
        with self.assertRaises(InterruptedError):
            self.broker(transport).complete(native_body(), cancel=cancelled)
        self.assertEqual(transport.calls, [])

    def test_native_images_are_converted_without_remote_urls(self):
        messages = [{"role": "user", "content": "Synthetic image question", "images": ["YWJj"]}]
        converted = openai_messages(messages)
        self.assertEqual(converted[0]["content"][1]["image_url"]["url"], "data:image/jpeg;base64,YWJj")
        self.assertEqual(messages[0]["images"], ["YWJj"])

    def test_credential_reader_targets_match_rust_keyring(self):
        self.assertEqual(credential_target("google"), "google-api-key.fr.louisraille.coucou")
        self.assertEqual(credential_target("groq"), "groq-api-key.fr.louisraille.coucou")
        with self.assertRaises(ValueError):
            credential_target("other-secret")

    def test_data_root_is_per_user_and_test_port_is_validated(self):
        with patch.dict(os.environ, {"LOCALAPPDATA": str(ROOT / "test-work/local"), "COUCOU_SERVICE_PORT": "19135"}, clear=True):
            self.assertEqual(data_root(), (ROOT / "test-work/local/Coucou/LocalAI").resolve())
            self.assertEqual(service_port(), 19135)
            os.environ["COUCOU_SERVICE_PORT"] = "0"
            with self.assertRaises(ValueError):
                service_port()


class PortableRuntimeTests(unittest.TestCase):
    def test_native_runtime_self_test(self):
        python = ROOT / "bundle/runtime/python.exe"
        result = subprocess.run([str(python), "-B", str(ROOT / "bundle/src/service_main.py"), "--self-test"],
                                cwd=ROOT, capture_output=True, text=True, timeout=40,
                                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(result.stdout)
        self.assertTrue(report["ok"])
        self.assertEqual(report["service"], "coucou-localai-service")
        self.assertTrue(report["private_vc_runtime_complete"])
        self.assertTrue(report["mfc_loaded_from_private_runtime"])

    def test_isolated_bridge_http_and_storage(self):
        work = ROOT / "test-work"
        work.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=work) as directory:
            test_root = Path(directory)
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            environment = dict(os.environ)
            environment["APPDATA"] = str(test_root / "roaming")
            environment["LOCALAPPDATA"] = str(test_root / "local")
            process = subprocess.Popen([str(ROOT / "bundle/runtime/python.exe"), "-B", str(ROOT / "bundle/src/service_main.py"),
                "--port", str(port), "--data-root", str(test_root / "data")], cwd=ROOT, env=environment,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            def get(path, headers=None):
                request = urllib.request.Request(f"http://127.0.0.1:{port}" + path, headers=headers or {})
                with opener.open(request, timeout=8) as response:
                    return json.load(response)
            try:
                health = None
                last_error = None
                deadline = time.monotonic() + 25
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        break
                    try:
                        health = get("/health")
                        break
                    except OSError as exc:
                        last_error = str(exc)
                        time.sleep(0.1)
                self.assertIsNotNone(health, "Isolated bridge did not become healthy: " + str(last_error))
                self.assertEqual(health["service"], "coucou-localai-service")
                self.assertTrue(health["bridge_ready"])
                self.assertTrue(health["ok"])
                self.assertIn(health["mode"], ("ECO", "BALANCED", "QUALITY"))
                for name in ("busy", "halted", "computer_use_active"):
                    self.assertIsInstance(health[name], bool)
                self.assertGreater(health["ram_total_gib"], 0)
                self.assertGreaterEqual(health["ram_available_gib"], 0)
                capabilities = get("/capabilities")
                self.assertEqual(Path(capabilities["computer"]["workspace_root"]), test_root / "data/workspace")
                self.assertFalse(get("/telegram/account/status")["authorized"])
                with self.assertRaises(urllib.error.HTTPError) as blocked:
                    get("/health", {"Origin": "https://untrusted.invalid"})
                self.assertEqual(blocked.exception.code, 403)
                self.assertTrue((test_root / "data/runtime/router.pid").is_file())
                self.assertFalse((test_root / "data/config/telegram-session.dpapi").exists())
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
                stdout, stderr = process.communicate()
                if stderr and health is None:
                    self.fail(stderr.decode("utf-8", "replace")[:1000])


if __name__ == "__main__":
    unittest.main(verbosity=2)
