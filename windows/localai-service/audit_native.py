"""Inspect native PE imports, including delay imports, without running code."""
from __future__ import annotations

import json
import os
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parent
BUNDLE = ROOT / "bundle"
PRIVATE_PREFIXES = ("mfc", "msvcp", "vcruntime", "concrt", "vccorlib", "python", "libssl", "libcrypto", "libffi")


def imports(path):
    data = path.read_bytes()
    if data[:2] != b"MZ":
        return []
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    sections, optional_size = struct.unpack_from("<H", data, pe + 6)[0], struct.unpack_from("<H", data, pe + 20)[0]
    optional = pe + 24
    magic = struct.unpack_from("<H", data, optional)[0]
    directories = optional + (112 if magic == 0x20B else 96)
    section_base = optional + optional_size
    mappings = []
    for index in range(sections):
        offset = section_base + index * 40
        size, rva, raw_size, raw = struct.unpack_from("<IIII", data, offset + 8)
        mappings.append((rva, max(size, raw_size), raw))
    def at(rva):
        for start, size, raw in mappings:
            if start <= rva < start + size:
                return raw + rva - start
        raise ValueError("Invalid PE RVA")
    def string(rva):
        offset = at(rva)
        end = data.index(0, offset)
        return data[offset:end].decode("ascii").lower()
    names = []
    for index, stride, field in ((1, 20, 12), (13, 32, 4)):
        rva, length = struct.unpack_from("<II", data, directories + index * 8)
        if not rva:
            continue
        offset = at(rva)
        for item in range(0, min(length or 65536, 65536), stride):
            row = data[offset + item:offset + item + stride]
            if not any(row):
                break
            name_rva = struct.unpack_from("<I", row, field)[0]
            if name_rva:
                names.append(string(name_rva))
    return sorted(set(names))


def main():
    files = [item for item in BUNDLE.rglob("*") if item.is_file() and item.suffix.lower() in {".exe", ".dll", ".pyd"}]
    bundled = {item.name.lower() for item in files}
    system = Path(os.environ.get("WINDIR", "C:/Windows")) / "System32"
    missing, rows = [], []
    for item in sorted(files):
        dependencies = imports(item)
        rows.append({"path": str(item.relative_to(BUNDLE)).replace("\\", "/"), "imports": dependencies})
        for name in dependencies:
            if name in bundled or name.startswith(("api-ms-win-", "ext-ms-win-")):
                continue
            if not name.startswith(PRIVATE_PREFIXES) and (system / name).is_file():
                continue
            missing.append({"file": rows[-1]["path"], "dependency": name})
    report = {"ok": not missing, "native_files_checked": len(files), "missing_private_dependencies": missing,
              "rows": rows}
    (ROOT / "native-dependency-audit.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("ok", "native_files_checked", "missing_private_dependencies")}))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
