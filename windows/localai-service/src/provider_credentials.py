"""Read only the two Coucou AI credentials, using the Rust keyring layout."""
from __future__ import annotations

import ctypes
import os
from ctypes import wintypes

KEYS = {"google": "google-api-key", "groq": "groq-api-key"}
SERVICE = "fr.louisraille.coucou"


class _Credential(ctypes.Structure):
    _fields_ = [("Flags", wintypes.DWORD), ("Type", wintypes.DWORD),
        ("TargetName", wintypes.LPWSTR), ("Comment", wintypes.LPWSTR),
        ("LastWritten", wintypes.FILETIME), ("CredentialBlobSize", wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
        ("Persist", wintypes.DWORD), ("AttributeCount", wintypes.DWORD),
        ("Attributes", ctypes.c_void_p), ("TargetAlias", wintypes.LPWSTR),
        ("UserName", wintypes.LPWSTR)]


def credential_target(provider: str) -> str:
    if provider not in KEYS:
        raise ValueError("Unsupported AI credential")
    return f"{KEYS[provider]}.{SERVICE}"


def read_key(provider: str) -> str | None:
    target = credential_target(provider)
    if os.name != "nt":
        return None
    api = ctypes.WinDLL("advapi32", use_last_error=True)
    api.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                             ctypes.POINTER(ctypes.POINTER(_Credential))]
    api.CredReadW.restype = wintypes.BOOL
    api.CredFree.argtypes = [ctypes.c_void_p]
    pointer = ctypes.POINTER(_Credential)()
    if not api.CredReadW(target, 1, 0, ctypes.byref(pointer)):
        return None
    try:
        item = pointer.contents
        if item.CredentialBlobSize > 4096 or item.CredentialBlobSize % 2:
            return None
        value = ctypes.string_at(item.CredentialBlob, item.CredentialBlobSize).decode("utf-16-le")
        return value.strip() or None
    except (UnicodeError, ValueError):
        return None
    finally:
        if pointer.contents.CredentialBlob and pointer.contents.CredentialBlobSize:
            ctypes.memset(pointer.contents.CredentialBlob, 0, pointer.contents.CredentialBlobSize)
        api.CredFree(pointer)
