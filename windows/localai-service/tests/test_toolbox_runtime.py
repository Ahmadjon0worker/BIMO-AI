from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from toolbox_runtime import ToolboxRuntime
from desktop_tools import DesktopTools


class Backend:
    supported = True
    def __init__(self): self.reads = 0
    def windows(self, limit): self.reads += 1; return []
    def assert_available(self): pass


class RuntimeTests(unittest.TestCase):
    def runtime(self, root):
        runtime = ToolboxRuntime.__new__(ToolboxRuntime)
        runtime.root = root; runtime.lock = threading.Lock()
        runtime.terminal = Mock()
        runtime.terminal.call.return_value = {"ok": True}
        runtime.desktop = DesktopTools(root, backend=Backend())
        return runtime

    def test_stop_rejects_new_effects_and_resume_restores_window_listing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / "runtime").mkdir()
            runtime = self.runtime(root)
            marker = root / "runtime/emergency-stop"; marker.write_text("stop")
            runtime.stop()
            with self.assertRaises(ValueError): runtime.call({"name": "terminal_run", "arguments": {"shell": "cmd", "script": "ver"}})
            runtime.terminal.call.assert_not_called()
            marker.unlink(); runtime.resume()
            result = runtime.call({"name": "desktop_windows", "arguments": {}})
            self.assertEqual(result["windows"], [])
            self.assertEqual(runtime.desktop.backend.reads, 1)

    def test_duplicate_in_flight_dispatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = self.runtime(Path(directory))
            runtime.lock.acquire()
            with self.assertRaises(ValueError): runtime.call({"name": "terminal_run", "arguments": {"shell": "cmd", "script": "ver"}})
            runtime.terminal.call.assert_not_called()
            runtime.lock.release()

    def test_unicode_request_measure_matches_native_utf8_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = self.runtime(Path(directory))
            payload = {"name": "github_action", "arguments": {"operation": "create_issue", "body": "文" * 20000}}
            self.assertEqual(runtime.call(payload), {"ok": True})
            runtime.terminal.call.assert_called_once_with("github_action", payload["arguments"])


if __name__ == "__main__": unittest.main()
