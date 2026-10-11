"""Immutable installed code and independent, per-user writable data."""
from __future__ import annotations

import os
from pathlib import Path


SERVICE_ID = "coucou-localai-service"
SERVICE_VERSION = "1.3.1"


def data_root() -> Path:
    # The launcher sets a root only for isolated smoke tests. Never derive
    # writable storage from __file__, an install directory, or D:/LocalAI.
    override = os.environ.get("COUCOU_LOCALAI_DATA_DIR")
    if override:
        return Path(override).resolve()
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        raise RuntimeError("Windows LOCALAPPDATA is unavailable")
    return (Path(local) / "Coucou" / "LocalAI").resolve()


def service_port() -> int:
    value = int(os.environ.get("COUCOU_SERVICE_PORT", "11435"))
    if not 1024 <= value <= 65535:
        raise ValueError("Service port must be between 1024 and 65535")
    return value


def settings_path() -> Path | None:
    base = os.environ.get("APPDATA")
    return Path(base) / "Coucou" / "settings.json" if base else None


def prepare_storage(root: Path) -> None:
    for name in ("config", "runtime", "workspace", "logs", "backups"):
        target = root / name
        target.mkdir(parents=True, exist_ok=True)
        if not target.resolve().is_relative_to(root.resolve()):
            raise RuntimeError("Service storage redirects outside its data directory")
