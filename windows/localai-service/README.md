# BIMO AI LocalAI bridge

The installer includes an isolated Windows x64 CPython 3.12.14 runtime and the
Telegram, document, terminal, GitHub and window-bound desktop capability code. No Python, Node.js,
virtual environment, D drive or administrator service installation is needed
on the destination computer. Ollama and its large models are optional and are
not copied into the installer.

Installed resource contract:

```text
localai-service/runtime/pythonw.exe -B localai-service/src/service_main.py
```

The native BIMO AI launcher owns this child process. It reuses an existing
service only after verifying the compatible `coucou-localai-service` marker, toolbox API major 1, Telegram API major 2,
voice API major 1 and its supported messenger features. Port 11435 is preferred; an occupied
legacy or unrelated service is preserved while the bundle uses port 11437.
If both fixed ports are occupied by incompatible services, startup reports an
error. Normal controls become available only after a successful health probe.
This bridge binds only to 127.0.0.1 and rejects browser Origin headers.

Writable data defaults to `%LOCALAPPDATA%\Coucou\LocalAI` and is independent
of installed code. `COUCOU_LOCALAI_DATA_DIR`, `--data-root` and `--port` exist for
controlled integration tests. Computer status exposes `workspace_root` so the
Tools GUI uses the correct document directory.

Auto generation tries Ollama, then Gemini, then Groq. Cloud providers are used
only when their keys have been configured. An explicit provider uses only that
provider. Current model lists are discovered, and an available saved model is
preserved. The per-user BIMO AI Settings file contains provider/model preferences;
keys are read directly from Windows Credential Manager using the same UTF-16
layout and entry targets as BIMO AI's Rust keyring. No key is copied to the bundle,
written to JSON, or included in health/errors/logs.

The broker honors the saved loopback Ollama port 11434 or 11436. Another address,
remote host, credentials in a URL, or the bridge's own port 11435 produces a
clear error for an explicit Ollama selection. Auto skips that unsupported local
address and tries a configured cloud provider. This prevents router recursion
and silently using a different server than the one in Settings.

Telegram drafts and reviewed computer planning use this same generation broker.
Provider fallback never retries a Telegram send or performs a computer action.
Groq's default `llama-3.3-70b-versatile` uses supported `json_object` mode for
planning schemas with an explicit JSON instruction. The existing capability
validators check the final proposal before a reviewed action can execute.
See [Groq structured output documentation](https://console.groq.com/docs/structured-outputs).
Personal Telegram credentials/sessions remain protected by per-user DPAPI.
Telegram supports explicit chat search/filter/pages, Saved Messages and username
resolution, paged history/search, manual compose, reply and AI message drafts.
Explicit send commands or compose buttons authorize one immutable recipient/text
pair. The backend consumes its short-lived proof before dispatch and never
automatically repeats an uncertain send. Reply proofs bind the message ID to the
same chat and current session. Chat text is treated as untrusted content for AI
generation. There are no background reads or automatic replies to every chat.
Manual tools work without a model: CMD/PowerShell run explicitly entered scripts
as the current user with bounded output, timeouts and owned process-tree cleanup.
The working directory is scoped, but scripts are not an OS sandbox. The bundled
official GitHub CLI uses existing user authentication and structured argument
arrays. Issue and draft PR creation happen only on explicit calls. Window-bound
desktop sessions bind HWND, process identity and each observed state before
literal input. Protected/credential/payment/shell windows are excluded. The
original reviewed Notepad editor workflow remains available.
Optional AI creates editable proposals without executing their content.
CLI and stdio MCP use the same fixed-loopback service, no mutation retries or
automatic port fallback. See [Uzbek tools guide](TOOLS-UZ.md).
OpenCode is not included and its button reports that clearly.

The bridge buffers generation before returning OpenAI SSE or Ollama NDJSON;
BIMO AI's native provider chat independently streams tokens to its windows.

## Prepare a fresh source checkout

From `windows`, use Python 3.12+ and the fixed 0.6.3 public release runtime:

```powershell
py -3.12 scripts/prepare-release-runtime.py --download
```

The helper checks the archive, manifest and every file hash, then synchronizes this checkout’s service source. See [runtime bootstrap](../scripts/RUNTIME-BOOTSTRAP.md). It is build-only; the installed app never downloads a runtime/model on startup. Large generated binaries and personal data stay outside Git.

## Regenerate the runtime

`build_runtime.py` copies only allowlisted public CPython files, dependencies and
service source. It does not copy a venv or read LocalAI config, sessions, models,
logs, captures or workspace documents. Public pywin32 and psutil wheels were
downloaded from PyPI for Python 3.12 x64 into the ignored `wheels` directory.
Other public packages are sourced from the available bundled document runtime
and the existing LocalAI package installation. Explicit source arguments allow
another build machine to supply the same dependencies.

```powershell
python build_runtime.py --python-root C:\path\to\Python312 --public-package-source C:\path\to\site-packages
```

Python's LICENSE.txt, public package license/metadata files and the upstream MIT
license are preserved. `source-provenance.json` records the original allowlisted
application module hashes. `bundle/runtime-manifest.json` records every payload
file hash, file count, native architecture, wheel hashes and total size. The
isolated `python312._pth` disables registry/environment Python paths and all
automatic wheel `.pth` execution.

Microsoft MFC and C++ redistributable dependencies are included privately with
their license. They were extracted with WiX `dark.exe` from the signed Microsoft
Visual Studio 2022 x64 Redistributable 14.44.35112; no system redist installer is
executed. `--redist-source` accepts this extracted public layout. The self-test
verifies that MFC loads from the bundled runtime, and `audit_native.py` checks
all native PE imports (including delay imports) for missing private dependencies.

## Verification

```powershell
bundle\runtime\python.exe -B bundle\src\service_main.py --self-test
bundle\runtime\python.exe -B tests\test_service.py
```

Self-test imports native runtime modules without starting services, reading user
credentials/config, creating user storage, contacting a provider or logging into
Telegram. The test suite uses synthetic provider responses and an ephemeral
loopback port/data directory. It never sends a real Telegram message or changes
the existing LocalAI service. A restricted execution sandbox may need loopback
permission for the HTTP integration test.


## Offline voice packaging

`src/voice_tools.py` uses only manifest-pinned Windows Whisper.cpp CPU decoders. Uzbek automatically selects
the NavAI Uzbek small Q5_1 pack in `public-voice/uzbek`; Russian and English keep multilingual small-q5_1.
The Uzbek pack uses its training-compatible no-timestamps mode and pinned Silero v6.2.0 VAD to gate non-speech.
Model and VAD identities are checked independently of each package manifest. There are no startup downloads.
eSpeak NG supplies Uzbek/Russian/English speech through a separate portable process. No system voice install is performed.
`public-voice/manifest.json`, `public-voice/uzbek/manifest.json` and `public-voice/tts/manifest.json` list redistributable assets; `build_runtime.py --sync-source`
verifies the hashes before copying them to `bundle/voice`. The eSpeak source archive is included under `bundle/licenses`.
Recordings are bounded mono PCM16 WAV, 16kHz, at most15s; one operation, process-tree cancellation, ephemeral-file cleanup.
The loopback voice API has its own body caps, control header, origin checks and Stop/resume lifecycle.
See `VOICE-UZ.md` for user instructions. Supported language does not imply perfect recognition; microphone quality and speech matter.
`VOICE-UZ-BENCHMARK.md` records the same eight public Uzbek fixtures before and after the change and non-speech controls.
`model-preparation/README.md` describes the pinned safetensors conversion and native quantization used at release preparation time.


## Branding and existing installations

BIMO AI is the public Windows product name; the existing liquid companion design remains. New EXE installs default to `%LOCALAPPDATA%\BIMO AI`. Per-user settings/data paths retain `Coucou`, including `%APPDATA%\Coucou` and `%LOCALAPPDATA%\Coucou\LocalAI`; credential targets, `coucou.exe`, CLI/hook names and service markers remain compatible. Do not rename these paths. Existing panel/provider settings and Telegram sessions use the same storage. Historical voice/test evidence remains historical; each new release requires fresh validation. The human microphone test is pending.
