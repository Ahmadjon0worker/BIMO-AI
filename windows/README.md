# Qanot AI for Windows — 0.6.3

Qanot AI combines a movable desktop panel, **LocalAI Studio**, Telegram, CMD/PowerShell, GitHub tools and local Uzbek voice control. **Qanot** is the companion shown in the panel. This Windows edition derives from [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou); it uses its own public branding and companion artwork.

## Download and open

- [QanotAI-Windows-0.6.3-setup.exe](https://github.com/Ahmadjon0worker/CouCou-Uzbek-edition-/releases/download/v0.6.3/QanotAI-Windows-0.6.3-setup.exe): the recommended current-user installer.
- [QanotAI-Windows-0.6.3.msi](https://github.com/Ahmadjon0worker/CouCou-Uzbek-edition-/releases/download/v0.6.3/QanotAI-Windows-0.6.3.msi): Windows Installer format.
- [Release notes and checksums](https://github.com/Ahmadjon0worker/CouCou-Uzbek-edition-/releases/tag/v0.6.3).

Windows 10/11 x64 and WebView2 are required. The installer contains an isolated Python runtime, GitHub CLI and the offline voice components. Python, Node.js and Rust are not required on the destination PC. WebView2 installation may need internet. Ollama and large chat models are installed separately.

Use **Qanot AI LocalAI Studio** in Start or the tray menu. The compatible executable command remains `coucou.exe --studio`. Closing Studio hides it; **Quit** stops the app and its owned local service.

The service listens on loopback only, using port 11435 or 11437. An incompatible service already using 11435 is preserved. Studio's system status explains startup errors.

## Use the panel and tools

Drag the **⠿** handle. The compact panel is horizontal at the top/bottom, vertical at a side and square in a corner. Placement follows the Windows work area and is saved. The **−** button folds an expanded panel; waiting permission requests remain pending. General settings provide nine placements, hover opening, sounds, colors and shortcuts.

Select Ollama, Gemini, Groq or Auto in Studio. Auto tries Ollama, then configured Gemini and Groq. Provider keys use Windows Credential Manager. Cloud tasks send their relevant text to the chosen provider; local voice needs no provider key.

Telegram supports personal-account login, chat search/filter/pages, history, Saved Messages, username resolution, messages/replies and AI drafts. An explicit send instruction or send button authorizes one message. Uncertain sends are not automatically repeated. There are no background replies to every chat.

Manual CMD/PowerShell, GitHub and window-bound desktop actions work without a chat model. Terminal scripts run with the current user's permissions; the workspace restriction is not an OS sandbox. AI proposes work for review. Desktop sessions require a current observation and exclude protected credential/payment/shell windows.

Open **Voice control**, then click **Speak**. Uzbek selects NavAI Whisper small Q5_1 with Silero VAD; English/Russian select multilingual small-q5_1. eSpeak supplies local speech. Optional continuous listening accepts **OK Qanot**; legacy Coucou/Kuku phrases remain compatible. The microphone does not open at startup, and recordings are temporary.

## Existing data stays compatible

The new default installation folder is `%LOCALAPPDATA%\Qanot AI`. Existing per-user data retains `%APPDATA%\Coucou\settings.json` and `%LOCALAPPDATA%\Coucou\LocalAI`. Credential targets, service protocol IDs and compatible `coucou.exe`, `coucou-hook.exe`, `coucou.cmd`/`coucou.ps1` names are intentionally retained. Do not rename these internal paths. This preserves panel/provider settings and the existing Telegram session.

## Guides and validation

- [Complete edition guide and build steps](../README.md)
- [Uzbek installation guide](INSTALL-UZ.md)
- [Uzbek feature guide](README-UZ.md)
- [Telegram, terminal, GitHub and MCP](localai-service/TOOLS-UZ.md)
- [Local voice and limitations](localai-service/VOICE-UZ.md)
- [Runtime bootstrap](scripts/RUNTIME-BOOTSTRAP.md)

Historical **0.6.2** validation passed 633 frontend tests and 50 voice/router tests, built production binaries and verified extracted EXE/MSI payloads. Its eight public Uzbek audio clips measured WER 20.66% and CER 7.99%. These results do not verify a new 0.6.3 package. The human microphone/room test, MSI installation and clean-VM test are still pending. See [0.6.3 release notes](RELEASE-NOTES-0.6.3.md) for the current scope.

## Build from source

Use Windows x64, Python 3.12+, Node.js 24, Rust MSVC and C++ Build Tools. From `windows`:

```powershell
py -3.12 scripts/prepare-release-runtime.py --download
npm ci
npm test
node scripts/build-hook.mjs
cargo test --workspace --locked
npm run pack
```

The helper obtains the fixed [0.6.3 public runtime archive](https://github.com/Ahmadjon0worker/CouCou-Uzbek-edition-/releases/download/v0.6.3/QanotAI-Windows-0.6.3-runtime.zip), verifies its ZIP/manifest and all file hashes, then synchronizes the current service source. Large runtime/model binaries and all personal data are excluded from Git. `npm run pack` checks source/runtime freshness and produces EXE/MSI plus checksums in `release`.

The source retains the upstream MIT attribution. Upstream Coucou/Mochi names, character artwork, icons, sounds and demo media are governed separately by [LICENSE-ASSETS.md](../LICENSE-ASSETS.md); the Qanot public edition uses independently prepared branding. See the voice guide for model/eSpeak licenses and corresponding source distribution.
