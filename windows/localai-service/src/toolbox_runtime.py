"""One shared, local tools dispatcher for the desktop, CLI and MCP clients."""
from __future__ import annotations

import json
import threading
from urllib.request import Request, build_opener, ProxyHandler

from service_paths import service_port
from tool_client import NoRedirect


class ToolboxRuntime:
    def __init__(self, root):
        from toolbox import Toolbox
        from desktop_tools import DesktopTools
        self.root = root
        self.terminal = Toolbox(root, request=self.request)
        self.desktop = DesktopTools(root)
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
        # Serialize effects and consume calls once. A dropped client never
        # causes a retry or a second dispatch to another service.
        if not self.lock.acquire(blocking=False):
            raise ValueError("Boshqa vosita ishlayapti. Natijasini kuting")
        try:
            if (self.root / "runtime" / "emergency-stop").exists() and name != "desktop_finish":
                raise ValueError("Stop faol. Davom etish uchun LocalAI profilini tanlang")
            if name.startswith("desktop_"):
                return self.desktop.call(name, arguments)
            if name in ("terminal_run", "github_action", "ai_plan"):
                return self.terminal.call(name, arguments)
            raise ValueError("Noma’lum vosita")
        finally:
            self.lock.release()

    def stop(self):
        self.desktop.stop()
        stop = getattr(self.terminal, "stop", None)
        if stop:
            stop()

    def resume(self):
        self.desktop.reset()
