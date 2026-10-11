"""Assemble an isolated, redistributable CPython runtime from public allowlists.

Does not copy a venv, install anything globally, execute wheel .pth files, or
read the source machine's LocalAI config/accounts/runtime/models/logs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import zipfile

ROOT = Path(__file__).resolve().parent
EXCLUDED = {"__pycache__", "tests", "test", "Demos", "demos", "examples", "samples"}
RUNTIME_FILES = ("python.exe", "pythonw.exe", "python3.dll", "python312.dll", "vcruntime140.dll", "vcruntime140_1.dll", "LICENSE.txt")
PYTHON_PACKAGES = ("PIL", "lxml", "docx", "pypdf", "openpyxl", "reportlab", "et_xmlfile", "charset_normalizer")
PURE_PACKAGES = ("telethon", "pyaes", "pyasn1", "rsa", "pywinauto", "comtypes")
PURE_FILES = ("six.py", "typing_extensions.py")
WHEELS = ("pywin32-312-cp312-cp312-win_amd64.whl", "psutil-7.2.2-cp37-abi3-win_amd64.whl")
MFC_FILES = ("mfc140u.dll", "mfc140enu.dll")
CRT_FILES = ("msvcp140.dll", "msvcp140_1.dll", "msvcp140_2.dll", "msvcp140_atomic_wait.dll", "msvcp140_codecvt_ids.dll", "concrt140.dll")
SERVICE_SOURCES = ("router.py", "capabilities.py", "telegram_account.py", "telegram_intent.py", "local_tools.py",
                   "service_paths.py", "provider_credentials.py", "provider_broker.py", "service_inference.py", "service_main.py",
                   "toolbox.py", "desktop_tools.py", "toolbox_runtime.py", "tool_client.py", "tools_cli.py", "voice_tools.py")


def sync_sources(bundle):
    for name in SERVICE_SOURCES:
        safe_copy(ROOT / "src" / name, bundle / "src" / name)
    safe_copy(ROOT / "README.md", bundle / "README.md")
    for name in ("coucou.cmd", "coucou.ps1", "coucou-mcp.cmd", "TOOLS-UZ.md"):
        safe_copy(ROOT / name, bundle / name)
    if (ROOT / "public-tools").is_dir():
        for name in ("gh.exe", "LICENSE-GitHub-CLI.txt", "github-cli-provenance.json"):
            safe_copy(ROOT / "public-tools" / name, bundle / "bin" / name)
    include_voice(bundle)


def include_voice(bundle):
    source = ROOT / 'public-voice'
    target = bundle / 'voice'
    if target.exists():
        if not target.resolve().is_relative_to(bundle.resolve()) or target.is_symlink():
            raise RuntimeError('Generated voice directory escaped bundle')
        shutil.rmtree(target)
    packs = [('', 'whisper.cpp'), ('tts', 'espeak-ng')]
    if (source / 'uzbek').exists():
        packs.append(('uzbek', 'whisper.cpp'))
    for subtree, engine in packs:
        folder = source / subtree
        manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
        if manifest.get('schema') != 1 or manifest.get('engine') != engine:
            raise RuntimeError('Public voice identity mismatch')
        files = manifest.get('files', [])
        if not 2 <= len(files) <= 1024:
            raise RuntimeError('Public voice allowlist count mismatch')
        for entry in files:
            name = entry['path']
            relative = Path(name)
            if relative.is_absolute() or any(part in ('..', '.', '') for part in name.replace('\\', '/').split('/')) or ':' in name:
                raise RuntimeError('Public voice path escaped allowlist')
            path = folder / relative
            if not path.resolve().is_relative_to(folder.resolve()) or path.is_symlink() or path.stat().st_size != entry['size'] or sha(path) != entry['sha256']:
                raise RuntimeError('Public voice asset content mismatch')
            safe_copy(path, target / subtree / relative)
        safe_copy(folder / 'manifest.json', target / subtree / 'manifest.json')
    safe_copy(ROOT / 'public-tools/espeak-ng-source.tar.gz', bundle / 'licenses/espeak-ng-source.tar.gz')
    safe_copy(ROOT / 'VOICE-UZ.md', bundle / 'VOICE-UZ.md')
    for name in ('VOICE-UZ-BENCHMARK.md', 'VOICE-UZ-BENCHMARK.json'):
        if (ROOT / name).is_file():
            safe_copy(ROOT / name, bundle / name)


def include_redist(bundle, source):
    for name in MFC_FILES:
        safe_copy(source / "additional/File" / (name + "_amd64"), bundle / "runtime" / name)
    for name in CRT_FILES:
        safe_copy(source / "minimum/File" / (name + "_amd64"), bundle / "runtime" / name)
    safe_copy(source / "UX/license.rtf", bundle / "LICENSE-Microsoft-VC-Redistributable.rtf")


def write_manifest(bundle, wheel_metadata):
    files = [{"path": str(file.relative_to(bundle)).replace("\\", "/"), "bytes": file.stat().st_size, "sha256": sha(file)}
             for file in sorted(bundle.rglob("*")) if file.is_file() and file.name != "runtime-manifest.json"]
    manifest = {"service": "coucou-localai-service", "python": "3.12.14", "architecture": "x64",
                "public_wheels": wheel_metadata, "file_count": len(files), "total_bytes": sum(item["bytes"] for item in files),
                "no_user_config_or_credentials": True, "files": files}
    manifest["microsoft_redist"] = {"source": "Microsoft Visual Studio 2022 Visual C++ x64 Redistributable",
                                    "version": "14.44.35112", "dlls": list(MFC_FILES + CRT_FILES),
                                    "installation": "Private DLL files only; no system install or registry mutation"}
    (bundle / "runtime-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({key: manifest[key] for key in ("service", "file_count", "total_bytes", "no_user_config_or_credentials")}))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_copy(source, target):
    if any(path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())
           for item in (source, target) for path in (item, *item.parents)):
        raise RuntimeError("Package allowlist contains a redirected file")
    # A loaded Windows DLL cannot be overwritten. If this build already has the
    # exact verified bytes, preserve it without opening the destination to write.
    if (source.is_file() and target.is_file()
            and source.stat().st_size == target.stat().st_size and sha(source) == sha(target)):
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def copy_package(source, target):
    if not source.is_dir():
        raise RuntimeError(f"Required public package is missing: {source.name}")
    for item in source.rglob("*"):
        relative = item.relative_to(source)
        if any(part in EXCLUDED for part in relative.parts) or item.suffix in {".pyc", ".pyo"}:
            continue
        if item.is_file():
            safe_copy(item, target / relative)


def extract_wheel(source, site):
    with zipfile.ZipFile(source) as archive:
        for member in archive.infolist():
            relative = Path(member.filename)
            if relative.is_absolute() or ".." in relative.parts or member.is_dir():
                continue
            if any(part in EXCLUDED for part in relative.parts):
                continue
            # pywin32 ships optional GUI/server tools which this bridge never uses.
            if relative.parts[0] in {"isapi", "adodbapi", "pywin32.pth", "PyWin32.chm"}:
                continue
            if relative.parts[0] == "pythonwin" and relative.suffix not in {".pyd", ".dll"}:
                continue
            target = (site / relative).resolve()
            if not target.is_relative_to(site.resolve()):
                raise RuntimeError("Wheel path escapes the runtime")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(member))


def copy_metadata(source, packages, site):
    prefixes = {name.lower().replace("-", "_") for name in packages}
    prefixes.update({"pillow", "python_docx", "typing_extensions", "six"})
    for item in source.iterdir():
        name = item.name.lower().replace("-", "_")
        if item.is_dir() and (item.name.endswith(".dist-info") or item.name.endswith(".egg-info")) and any(
                name.startswith(prefix + "_") for prefix in prefixes):
            copy_package(item, site / item.name)


def verify_pe(path):
    data = path.read_bytes()
    if len(data) < 128 or data[:2] != b"MZ":
        raise RuntimeError(f"Invalid runtime executable: {path.name}")
    offset = struct.unpack_from("<I", data, 0x3C)[0]
    if data[offset:offset + 4] != b"PE\0\0" or struct.unpack_from("<H", data, offset + 4)[0] != 0x8664:
        raise RuntimeError(f"Runtime requires Windows x64 binaries: {path.name}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--python-root", type=Path, default=Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/python")
    parser.add_argument("--public-package-source", type=Path, default=Path("D:/LocalAI/.venv/Lib/site-packages"))
    parser.add_argument("--sync-source", action="store_true", help="Update service source and hashes without copying dependencies again")
    parser.add_argument("--redist-source", type=Path, default=ROOT / "redist-extract")
    args = parser.parse_args()
    python_root = args.python_root.resolve()
    public = args.public_package_source.resolve()
    bundle = ROOT / "bundle"
    if args.sync_source:
        previous = json.loads((bundle / "runtime-manifest.json").read_text(encoding="utf-8"))
        sync_sources(bundle)
        include_redist(bundle, args.redist_source)
        write_manifest(bundle, previous["public_wheels"])
        return
    runtime, site = bundle / "runtime", bundle / "runtime/site-packages"
    if bundle.exists():
        # This tool owns only its generated bundle directory; no user data lives here.
        if not bundle.resolve().is_relative_to(ROOT.resolve()):
            raise RuntimeError("Generated bundle path escaped the service project")
        shutil.rmtree(bundle)
    site.mkdir(parents=True)
    for name in RUNTIME_FILES:
        safe_copy(python_root / name, runtime / name)
    for item in (python_root / "DLLs").iterdir():
        if item.is_file() and item.suffix.lower() in {".dll", ".pyd"} and not item.name.startswith(("_test", "_ctypes_test", "_tkinter", "tcl", "tk")):
            safe_copy(item, runtime / "DLLs" / item.name)
    stdlib = python_root / "Lib"
    with zipfile.ZipFile(runtime / "python312.zip", "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for item in stdlib.rglob("*.py"):
            relative = item.relative_to(stdlib)
            if relative.parts[0] in {"site-packages", "test", "tkinter", "idlelib", "turtledemo", "ensurepip", "venv"} or "__pycache__" in relative.parts:
                continue
            archive.write(item, str(relative).replace("\\", "/"))
    modern = python_root / "Lib/site-packages"
    for name in PYTHON_PACKAGES:
        copy_package(modern / name, site / name)
    for name in PURE_PACKAGES:
        copy_package(public / name, site / name)
    for name in PURE_FILES:
        safe_copy(public / name, site / name)
    copy_metadata(modern, PYTHON_PACKAGES, site)
    copy_metadata(public, PURE_PACKAGES, site)
    wheel_metadata = []
    for name in WHEELS:
        wheel = ROOT / "wheels" / name
        extract_wheel(wheel, site)
        wheel_metadata.append({"name": name, "source": "https://pypi.org", "sha256": sha(wheel)})
    sync_sources(bundle)
    include_redist(bundle, args.redist_source)
    # _pth disables registry/environment sys.path and all automatic .pth code.
    (runtime / "python312._pth").write_text(
        "python312.zip\nDLLs\nsite-packages\nsite-packages/win32\nsite-packages/win32/lib\nsite-packages/pythonwin\nsite-packages/pywin32_system32\n../src\n", encoding="utf-8")
    # Only Microsoft typelib wrappers, already used by pywinauto, are included.
    comtypes_gen = site / "comtypes/gen"
    allowed_gen = {"__init__.py", "_00020430_0000_0000_C000_000000000046_0_2_0.py", "_944DE083_8FB8_45CF_BCB7_C477ACB2F897_0_1_0.py", "stdole.py", "UIAutomationClient.py"}
    for item in comtypes_gen.iterdir():
        if item.is_file() and item.name not in allowed_gen:
            item.unlink()
    # Preserve the application's MIT license alongside Python/dependency licenses.
    license_source = ROOT.parents[1] / "LICENSE"
    if license_source.exists():
        safe_copy(license_source, bundle / "LICENSE-Coucou.txt")
    safe_copy(ROOT / "source-provenance.json", bundle / "source-provenance.json")
    for name in ("python.exe", "pythonw.exe", "python312.dll"):
        verify_pe(runtime / name)
    write_manifest(bundle, wheel_metadata)


if __name__ == "__main__":
    main()
