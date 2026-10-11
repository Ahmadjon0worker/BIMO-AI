from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from tool_client import ToolClient, ClientError, telegram_catalog, NoRedirect
from tools_cli import main


class Response:
    def __init__(self, value):
        self.raw = value if isinstance(value, bytes) else json.dumps(value).encode()
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, limit): return self.raw[:limit]


class Opener:
    def __init__(self): self.calls = []; self.mutation_failure = False
    def open(self, request, timeout):
        self.calls.append((request.full_url, request.data, dict(request.header_items())))
        if request.full_url.endswith("/health"):
            valid = ":11437/" in request.full_url
            return Response({"service": "coucou-localai-service", "bridge_ready": True,
                "capabilities": {"toolbox_api": 1 if valid else 0}})
        if self.mutation_failure: raise OSError("private transport error")
        return Response({"ok": True})


class FakeClient:
    def __init__(self, unknown=False): self.calls = []; self.unknown = unknown
    def discover(self): return 11437
    def call(self, name, arguments):
        self.calls.append((name, arguments))
        if name == "telegram_resolve": return {"chat": {"chat_id": "42"}}
        if name == "telegram_compose": return {"id": "one-use"}
        if name == "telegram_send": return {"status": "unknown" if self.unknown else "sent"}
        return {"ok": True, "exit_code": 0}


class ToolClientTests(unittest.TestCase):
    def test_discovers_compatible_bridge_and_pins_effect_once(self):
        opener = Opener(); client = ToolClient(opener=opener)
        client.call("telegram_send", {"id": "one-use"})
        self.assertEqual(len(opener.calls), 3)
        self.assertTrue(opener.calls[-1][0].endswith(":11437/telegram/account/send"))
        self.assertEqual(json.loads(opener.calls[-1][1]), {"id": "one-use"})
        self.assertEqual(opener.calls[-1][2]["X-localai-control"], "1")

    def test_unknown_transport_never_discovers_or_replays_effect(self):
        opener = Opener(); client = ToolClient(11437, opener=opener)
        opener.mutation_failure = True
        with self.assertRaises(ClientError) as caught: client.call("telegram_send", {"id": "once"})
        self.assertEqual(len(opener.calls), 1)
        self.assertNotIn("private", str(caught.exception))

    def test_arbitrary_port_rejected(self):
        for port in (0, 80, 443, 11434, 65535):
            with self.assertRaises(ClientError): ToolClient(port)

    def test_loopback_redirect_is_never_followed(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://untrusted.invalid"))

    def test_valid_maximum_unicode_body_measured_as_utf8_not_json_escapes(self):
        opener = Opener()
        client = ToolClient(11437, opener=opener)
        body = "文" * 20000
        client.call("github_action", {"operation": "create_issue", "repo": "fixture/repo", "title": "test", "body": body})
        self.assertEqual(json.loads(opener.calls[-1][1])["arguments"]["body"], body)
        self.assertLess(len(opener.calls[-1][1]), 65536)

    def test_read_status_does_not_accept_arguments(self):
        with self.assertRaises(ClientError): ToolClient(11437).call("telegram_status", {"token": "fake"})

    def test_bounded_transport_request_and_response(self):
        client = ToolClient(11437, opener=Opener())
        with self.assertRaises(ClientError): client.call("telegram_compose", {"text": "x" * 65536})
        opener = Opener()
        with patch.object(opener, "open", return_value=Response(b"x" * (2 * 1024 * 1024 + 1))):
            with self.assertRaises(ClientError): ToolClient(11437, opener=opener).call("telegram_status", {})

    def test_mcp_telegram_catalog_no_login_or_configure_tools(self):
        names = {tool["name"] for tool in telegram_catalog()}
        self.assertIn("telegram_send", names)
        self.assertNotIn("telegram_connect", names)
        self.assertNotIn("telegram_configure", names)

    def test_cli_explicit_exact_message_bound_and_sent_once(self):
        client = FakeClient()
        with contextlib.redirect_stdout(io.StringIO()):
            code = main(["telegram", "--to", "@testuser", "--text", " Salom\nO‘zbekiston! "], client=client)
        self.assertEqual(code, 0)
        self.assertEqual(client.calls, [("telegram_resolve", {"recipient": "@testuser"}),
            ("telegram_compose", {"chat_id": "42", "text": " Salom\nO‘zbekiston! "}),
            ("telegram_send", {"id": "one-use"})])

    def test_cli_unknown_send_has_nonzero_exit_and_no_replay(self):
        client = FakeClient(True)
        with contextlib.redirect_stdout(io.StringIO()):
            code = main(["telegram", "--to", "self", "--text", "salom"], client=client)
        self.assertEqual(code, 2)
        self.assertEqual(sum(name == "telegram_send" for name, _ in client.calls), 1)

    def test_cli_unknown_github_success_process_is_nonzero_without_retry(self):
        client = FakeClient()
        with patch.object(client, "call", return_value={"ok": True, "exit_code": 0, "outcome_unknown": True}) as call:
            with contextlib.redirect_stdout(io.StringIO()):
                code = main(["call", "github_action", "--arguments", '{"operation":"create_issue"}'], client=client)
        self.assertEqual(code, 2)
        self.assertEqual(call.call_count, 1)

    def test_text_file_preserves_crlf_and_lone_cr(self):
        client = FakeClient()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "message.txt"
            literal = " Salom\r\nO‘zbekiston\rOxiri "
            path.write_bytes(literal.encode("utf-8"))
            with contextlib.redirect_stdout(io.StringIO()):
                code = main(["telegram", "--to", "self", "--text-file", str(path)], client=client)
        self.assertEqual(code, 0)
        self.assertEqual(client.calls[1][1]["text"], literal)

    def test_mcp_long_output_preserves_unknown_metadata_and_valid_json(self):
        from local_tools import MCPServer
        tools = FakeClient()
        result = {"stdout": "x" * 64000, "stderr": "", "outcome_unknown": True, "exit_code": 0}
        with patch.object(tools, "call", return_value=result):
            response = MCPServer(tools).handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {"name": "github_action", "arguments": {"operation": "create_issue"}}})
        blocks = response["result"]["content"]
        self.assertTrue(json.loads(blocks[0]["text"])["outcome_unknown"])
        self.assertEqual(json.loads(blocks[1]["text"]), result)

    def test_cli_mcp_config_offline_no_discovery_or_effect(self):
        client = FakeClient(); output = io.StringIO()
        with contextlib.redirect_stdout(output): code = main(["mcp-config"], client=client)
        self.assertEqual(code, 0)
        self.assertEqual(client.calls, [])
        data = json.loads(output.getvalue())["mcpServers"]["coucou"]
        self.assertEqual(data["args"][-1], "--mcp")


if __name__ == "__main__": unittest.main()
