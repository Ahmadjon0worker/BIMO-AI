"""Packaged Coucou bridge. Does not install or control shared services."""
from __future__ import annotations

import argparse
import ctypes
import importlib
import json
import os
from pathlib import Path
import sys

_DLL_HANDLES = []
_PRIVATE_MFC_HANDLE = None


def configure_runtime():
    global _PRIVATE_MFC_HANDLE
    sys.dont_write_bytecode = True
    runtime = Path(sys.executable).resolve().parent
    if os.name == "nt" and hasattr(os, "add_dll_directory"):
        for relative in (".", "DLLs", "site-packages/pywin32_system32", "site-packages/pythonwin", "site-packages/PIL", "site-packages/lxml"):
            folder = runtime / relative
            if folder.is_dir():
                _DLL_HANDLES.append(os.add_dll_directory(str(folder)))
        # Preload the privately bundled MFC dependency, so win32ui never relies
        # on a redistributable installed on the build computer.
        mfc = runtime / "mfc140u.dll"
        if mfc.is_file():
            library = ctypes.WinDLL(str(mfc))
            _DLL_HANDLES.append(library)
            _PRIVATE_MFC_HANDLE = library._handle


def self_test():
    # Import checks only: no credentials, user config reads, service sockets,
    # model requests, storage creation or Telegram login.
    required = ("ssl", "sqlite3", "ctypes", "psutil", "PIL.Image", "telethon", "pypdf",
                "docx", "openpyxl", "reportlab", "pywinauto", "win32api", "pythoncom",
                "toolbox", "desktop_tools", "toolbox_runtime", "tool_client", "tools_cli", "voice_tools")
    errors = []
    for name in required:
        try:
            importlib.import_module(name)
        except Exception as exc:
            errors.append({"module": name, "error": type(exc).__name__})
    from provider_credentials import credential_target
    from service_paths import SERVICE_ID, SERVICE_VERSION
    result = {"ok": not errors, "service": SERVICE_ID, "version": SERVICE_VERSION,
              "python": sys.version.split()[0], "modules_checked": len(required),
              "credential_layout_verified": credential_target("google") == "google-api-key.fr.louisraille.coucou",
              "errors": errors}
    if os.name == "nt":
        required_files = ("mfc140u.dll", "mfc140enu.dll", "msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll")
        result["private_vc_runtime_complete"] = all((Path(sys.executable).parent / name).is_file() for name in required_files)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.GetModuleFileNameW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint32]
        kernel.GetModuleFileNameW.restype = ctypes.c_uint32
        loaded_path = ctypes.create_unicode_buffer(32768)
        copied = kernel.GetModuleFileNameW(_PRIVATE_MFC_HANDLE, loaded_path, len(loaded_path)) if _PRIVATE_MFC_HANDLE else 0
        result["mfc_loaded_from_private_runtime"] = bool(copied and Path(loaded_path.value).resolve() == (Path(sys.executable).parent / "mfc140u.dll").resolve())
        result["ok"] = result["ok"] and result["private_vc_runtime_complete"] and result["mfc_loaded_from_private_runtime"]
    print(json.dumps(result))
    return 0 if result["ok"] else 1


def main():
    parser = argparse.ArgumentParser(description="Coucou per-user LocalAI bridge")
    parser.add_argument("--port", type=int, default=11435)
    parser.add_argument("--data-root", type=Path)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--mcp", action="store_true")
    parser.add_argument("--tools", nargs=argparse.REMAINDER, help="CMD/PowerShell CLI commands")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")
    os.environ["COUCOU_SERVICE_PORT"] = str(args.port)
    if args.data_root:
        os.environ["COUCOU_LOCALAI_DATA_DIR"] = str(args.data_root.resolve())
    configure_runtime()
    if args.self_test:
        return self_test()
    if args.tools is not None:
        from tools_cli import main as tools_main
        return tools_main(args.tools)
    if args.mcp:
        os.environ["COUCOU_MCP_CLIENT"] = "1"
        from service_paths import data_root, prepare_storage
        prepare_storage(data_root())
        from local_tools import MCPServer, LocalTools
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
        MCPServer(LocalTools()).run()
        return 0
    from service_paths import data_root, prepare_storage
    root = data_root()
    prepare_storage(root)
    import router
    router.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
