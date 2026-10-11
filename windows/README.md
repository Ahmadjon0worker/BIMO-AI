# BIMO AI for Windows — 0.7.1

**BIMO AI 0.7.1** includes liquid Moshi, LocalAI Studio, Telegram, grounded UIA targets, visual pointing, verified guide steps, hold-to-talk, sentence speech, CLI readiness and encrypted preference memory. See [the Uzbek usage guide](README-PLIP-UZ.md) and [liquid integration/provenance](README-LIQUID-UZ.md).

BIMO AI combines a movable desktop panel, **LocalAI Studio**, Telegram, CMD/PowerShell, GitHub tools and local Uzbek voice control. **Moshi** adapts the original **Mochi** design to a soft pentagonal body, retaining its white-gray materials, black eyes, shadows and clothing. Telegram, Codex, OpenCode and other agent variants share this family, with color variants for subagents. This Windows edition derives from [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou); BIMO AI product branding, icons and notification cues remain unchanged.

![Moshi, Codex, OpenCode and Telegram pentagonal companions](assets/qanot/moshi-preview.png)

This still frame comes from the shipping renderer. Moshi breathes, blinks, waves and animates according to agent state. Renderer source code retains the [MIT license](../LICENSE). The Mochi-based character and preview retain the [original artwork terms](../LICENSE-ASSETS.md); the user confirmed written permission to distribute the adaptation.

## Download and open

- [BIMOAI-Windows-0.7.1-setup.exe](https://github.com/Ahmadjon0worker/BIMO-AI/releases/download/v0.7.1/BIMOAI-Windows-0.7.1-setup.exe): recommended current-user installer.
- [Release notes and checksums](https://github.com/Ahmadjon0worker/BIMO-AI/releases/tag/v0.7.1).

The repository is private; sign in with an authorized GitHub account to download. This release publishes the tested EXE installer. MSI remains a local packaging candidate until installation-path/startup migration from the previous product name is tested.

Windows 10/11 x64 and WebView2 are required. The installer contains an isolated Python runtime, GitHub CLI and the offline voice components. Python, Node.js and Rust are not required on the destination PC. WebView2 installation may need internet. Ollama and large chat models are installed separately.

Use **BIMO AI LocalAI Studio** in Start or the tray menu. The compatible executable command remains `coucou.exe --studio`. Closing Studio hides it; **Quit** stops the app and its owned local service.

The service listens on loopback only, using port 11435 or 11437. An incompatible service already using 11435 is preserved. Studio's system status explains startup errors.

## Use the panel and tools

Drag the **⠿** handle. The compact panel is horizontal at the top/bottom, vertical at a side and square in a corner. Placement follows the Windows work area and is saved. The **−** button folds an expanded panel; waiting permission requests remain pending. General settings provide nine placements, hover opening, sounds, colors and shortcuts.

Select Ollama, Gemini, Groq or Auto in Studio. Auto tries Ollama, then configured Gemini and Groq. Provider keys use Windows Credential Manager. Cloud tasks send their relevant text to the chosen provider; local voice needs no provider key.

Telegram supports personal-account login, chat search/filter/pages, history, Saved Messages, username resolution, messages/replies and AI drafts. An explicit send instruction or send button authorizes one message. Uncertain sends are not automatically repeated. There are no background replies to every chat.

Manual CMD/PowerShell, GitHub and window-bound desktop actions work without a chat model. Terminal scripts run with the current user's permissions; the workspace restriction is not an OS sandbox. AI proposes work for review. Desktop sessions require a current observation and exclude protected credential/payment/shell windows.

Open **Voice control**, then click **Speak**. Uzbek selects NavAI Whisper small Q5_1 with Silero VAD; English/Russian select multilingual small-q5_1. eSpeak supplies local speech. Optional continuous listening accepts **OK Bimo** and **OK Moshi**; **OK Qanot**, **OK Coucou** and **OK Kuku** remain compatible. The microphone does not open at startup, and recordings are temporary.

## Existing data stays compatible

The new default installation folder is `%LOCALAPPDATA%\BIMO AI`. Existing per-user data retains `%APPDATA%\Coucou\settings.json` and `%LOCALAPPDATA%\Coucou\LocalAI`. Credential targets, service protocol IDs and compatible `coucou.exe`, `coucou-hook.exe`, `coucou.cmd`/`coucou.ps1` names are intentionally retained. Do not rename these internal paths. This preserves panel/provider settings and the existing Telegram session.

## Guides and validation

- [Complete edition guide and build steps](../README.md)
- [Uzbek installation guide](INSTALL-UZ.md)
- [Uzbek feature guide](README-UZ.md)
- [Moshi, voice and guided desktop additions in 0.7.0](README-PLIP-UZ.md)
- [Telegram, terminal, GitHub and MCP](localai-service/TOOLS-UZ.md)
- [Local voice and limitations](localai-service/VOICE-UZ.md)
- [Runtime bootstrap](scripts/RUNTIME-BOOTSTRAP.md)

See [the current 0.7.1 verification record](VERIFICATION-0.7.1-UZ.md). Historical reports retain their exact version and installer hashes. The human microphone/room test, MSI installation and clean-VM test remain pending.

## Build from source

Use Windows x64, Python 3.12+, Node.js 24, Rust MSVC and C++ Build Tools. From `windows`:

```powershell
gh release download v0.7.1 --repo Ahmadjon0worker/BIMO-AI --pattern BIMOAI-Windows-runtime-base.zip --dir .build-inputs
py -3.12 scripts/prepare-release-runtime.py --archive .build-inputs/BIMOAI-Windows-runtime-base.zip
npm ci
npm test
node scripts/build-hook.mjs
cargo test --workspace --locked
npm run pack
```

The helper uses the [runtime base hosted by release v0.7.1](https://github.com/Ahmadjon0worker/BIMO-AI/releases/download/v0.7.1/BIMOAI-Windows-runtime-base.zip), verifies its ZIP/manifest and all file hashes, then synchronizes the **current 1.4.1 service source**. The dependency archive retains its frozen 0.6.3 bytes; the current app does not ship the old service code. Older GitHub releases are no longer build dependencies. Large runtime/model binaries and all personal data are excluded from Git. `npm run pack` checks source/runtime freshness and produces EXE/MSI plus checksums in `release`.

The commands above use your signed-in GitHub CLI account. Alternatively download the ZIP in your signed-in browser, then run `py -3.12 scripts/prepare-release-runtime.py --archive C:/Downloads/BIMOAI-Windows-runtime-base.zip`. The helper's separate `--download` request is unauthenticated and does not read tokens/browser credentials.

The source retains the upstream MIT attribution. Mochi-based Moshi materials, eyes and clothing are adaptations of Louis Raillé's artwork, governed separately by [LICENSE-ASSETS.md](../LICENSE-ASSETS.md) and the written permission confirmed by the user. Moshi is not presented as independent original artwork. Qanot icons and notification cues retain their separate MIT asset license. See the voice guide for model/eSpeak licenses and corresponding source distribution.
