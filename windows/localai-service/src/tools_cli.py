"""AI-independent commands for CMD/PowerShell and an exportable MCP config."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from tool_client import ToolClient, ClientError


def literal_file(path):
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        return stream.read()


def main(argv=None, *, client=None):
    parser = argparse.ArgumentParser(description="Qanot AI: terminal, Telegram, GitHub va desktop vositalari")
    parser.add_argument("--port", type=int, choices=(11435, 11437))
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    sub.add_parser("mcp-config")
    terminal = sub.add_parser("terminal")
    terminal.add_argument("--shell", choices=("cmd", "powershell"), required=True)
    scripts = terminal.add_mutually_exclusive_group(required=True)
    scripts.add_argument("--script")
    scripts.add_argument("--script-file", type=Path)
    terminal.add_argument("--cwd", default=".")
    terminal.add_argument("--timeout", type=int, default=30)
    telegram = sub.add_parser("telegram")
    telegram.add_argument("--to", required=True, help="self yoki @username")
    bodies = telegram.add_mutually_exclusive_group(required=True)
    bodies.add_argument("--text")
    bodies.add_argument("--text-file", type=Path)
    call = sub.add_parser("call")
    call.add_argument("name")
    args = call.add_mutually_exclusive_group()
    args.add_argument("--arguments", default=None)
    args.add_argument("--arguments-file", type=Path)
    selected = parser.parse_args(argv)
    try:
        if selected.command == "mcp-config":
            entry = str(Path(__file__).with_name("service_main.py"))
            result = {"mcpServers": {"coucou": {"command": sys.executable, "args": [entry, "--mcp"]}}}
        else:
            active = client or ToolClient(selected.port)
            # Verify identity before any effect; pin this service for the invocation.
            active.discover()
            if selected.command == "status":
                result = active.call("toolbox_status", {})
            elif selected.command == "terminal":
                script = selected.script if selected.script is not None else literal_file(selected.script_file)
                result = active.call("terminal_run", {"shell": selected.shell, "script": script,
                    "cwd": selected.cwd, "timeout_seconds": selected.timeout})
            elif selected.command == "telegram":
                text = selected.text if selected.text is not None else literal_file(selected.text_file)
                recipient = active.call("telegram_resolve", {"recipient": selected.to})
                chat = recipient.get("chat", recipient)
                preview = active.call("telegram_compose", {"chat_id": chat["chat_id"], "text": text})
                # --to plus --text explicitly authorizes this one exact message.
                result = active.call("telegram_send", {"id": preview["id"]})
            else:
                raw = selected.arguments_file.read_text(encoding="utf-8-sig") if selected.arguments_file else selected.arguments or "{}"
                result = active.call(selected.name, json.loads(raw))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if (result.get("status") in ("unknown", "cancelled") or result.get("timed_out")
                or result.get("outcome_unknown") or result.get("cancelled")):
            return 2
        if result.get("exit_code", 0) != 0:
            return 1
        return 0
    except (ClientError, OSError, ValueError, KeyError):
        print(json.dumps({"ok": False, "error": "Amal bajarilmadi yoki natijasi noma’lum. Qayta yuborilmadi; Qanot AI holatini tekshiring"}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
