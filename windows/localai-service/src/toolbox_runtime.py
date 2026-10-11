"""One shared, local tools dispatcher for the desktop, CLI and MCP clients."""
from __future__ import annotations

import json
import threading
import time
from urllib.request import Request, build_opener, ProxyHandler

from service_paths import service_port
from tool_client import NoRedirect


class ToolboxRuntime:
    def __init__(self, root):
        from toolbox import Toolbox
        from desktop_tools import DesktopTools
        from assistant_tools import AssistantTools
        self.root = root
        self.terminal = Toolbox(root, request=self.request)
        self.desktop = DesktopTools(root)
        self.assistant = AssistantTools(root)
        self.activity_status = {"ok": True}
        self.lock = threading.Lock()

    @staticmethod
    def request(endpoint, payload=None, timeout=150):
        if endpoint not in ("/health", "/v1/chat/completions"):
            raise ValueError("Noma’lum AI vositasi")
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(f"http://127.0.0.1:{service_port()}{endpoint}", data=body,
                          headers={"Content-Type": "application/json", "X-LocalAI-Control": "1"})
        with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=timeout) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError("AI javobi juda katta")
            return json.loads(raw)

    def status(self):
        result = self.terminal.status()
        result["desktop"] = self.desktop.status()
        result["assistant"] = self.assistant.status()
        result["activity_log"] = getattr(self, "activity_status", {"ok": True})
        result["toolbox_api"] = 1
        return result

    def call(self, payload):
        if not isinstance(payload, dict) or set(payload) != {"name", "arguments"}:
            raise ValueError("Vosita nomi va argumentlari kerak")
        name, arguments = payload["name"], payload["arguments"]
        if not isinstance(name, str) or not isinstance(arguments, dict):
            raise ValueError("Vosita argumentlari noto‘g‘ri")
        if len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) > 64 * 1024:
            raise ValueError("Vosita so‘rovi juda katta")
        # Cancel bypasses the effect lock held by an in-flight reply. Read-only
        # status/memory/activity polling likewise cannot replay an action.
        assistant = getattr(self, "assistant", None)
        if name in ("assistant_cancel", "assistant_status", "assistant_memory_list", "assistant_activity"):
            if assistant is None:
                raise ValueError("Yordamchi hali tayyor emas")
            return assistant.call(name, arguments)
        # Serialize effects and consume calls once. A dropped client never
        # causes a retry or a second dispatch to another service.
        if not self.lock.acquire(blocking=False):
            raise ValueError("Boshqa vosita ishlayapti. Natijasini kuting")
        started = time.monotonic()
        try:
            if (self.root / "runtime" / "emergency-stop").exists() and name != "desktop_finish":
                raise ValueError("Stop faol. Davom etish uchun LocalAI profilini tanlang")
            if name.startswith("desktop_"):
                result = self.desktop.call(name, arguments)
            elif name.startswith("assistant_") and assistant is not None:
                result = assistant.call(name, arguments)
            elif name in ("terminal_run", "github_action", "ai_plan"):
                result = self.terminal.call(name, arguments)
            else:
                raise ValueError("Noma’lum vosita")
            self._receipt(assistant, name, started, result)
            return result
        except Exception:
            self._receipt(assistant, name, started, failed=True)
            raise
        finally:
            self.lock.release()

    def _receipt(self, assistant, name, started, result=None, failed=False):
        if assistant is None:
            return
        try:
            assistant.storage.receipt(name, started, result, failed=failed)
            self.activity_status = {"ok": True}
        except Exception:
            # Audit failure cannot hide a known effect or cause a replay. Keep
            # a separate static status, without any exception/body/path detail.
            self.activity_status = {"ok": False, "error": "Faollik yozuvi saqlanmadi; amal natijasi o‘zgarmadi"}

    def stop(self):
        assistant = getattr(self, "assistant", None)
        if assistant:
            assistant.stop()
        self.desktop.stop()
        stop = getattr(self.terminal, "stop", None)
        if stop:
            stop()

    def resume(self):
        self.desktop.reset()
        assistant = getattr(self, "assistant", None)
        if assistant:
            assistant.resume()
