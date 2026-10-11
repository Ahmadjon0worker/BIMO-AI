# Prepare the Windows release runtime

The BIMO AI source checkout keeps large public binaries and generated dependencies out
of Git. Release `v0.7.1` supplies `BIMOAI-Windows-runtime-base.zip`, the byte-identical
developer runtime base first frozen for `v0.6.3`. Its filename and download
location changed; the archive contents did not. After hydration, source
synchronization replaces its historical service code with the current checkout's
service `1.4.1`. The BIMO AI `0.7.1` frontend/native binaries are built from this
checkout:

<https://github.com/Ahmadjon0worker/BIMO-AI/releases/download/v0.7.1/BIMOAI-Windows-runtime-base.zip>

It contains exactly 2,068 allowlisted files plus `runtime-manifest.json`, with
571,951,706 uncompressed payload bytes. It includes private CPython 3.12.14,
public dependencies, multilingual/Uzbek Whisper, Silero VAD, eSpeak and its source
archive, GitHub CLI and Microsoft private redistributable DLLs with licenses.
There are no user configuration files, credentials, Telegram sessions, logs,
recordings or workspace documents. This build helper is never imported or run by
the installed application; the installer works offline after installation.

Use Windows x64, Python 3.12 or newer for this one-time bootstrap, Node.js and the
Rust/Tauri build prerequisites. From `windows`:

```powershell
py -3.12 scripts/prepare-release-runtime.py --download
npm ci
npm run pack
```

`--download` performs an unauthenticated HTTPS request. If the repository/release
is private, first download the ZIP through your signed-in GitHub account (or your
own authenticated GitHub CLI), then use `--archive` below. This helper neither
requests nor reads GitHub tokens or browser credentials.

The helper downloads only the fixed release URL. It verifies the ZIP's exact
size/SHA256, the source-controlled runtime manifest pin and every decompressed
file hash. Paths, case duplicates, symlinks/junctions, reserved Windows names,
encrypted members, unlisted files and size limits are checked before extraction.
The pins are in `scripts/release-runtime-0.6.3.json`. Its `version` identifies the
frozen runtime payload, while `release_version` identifies its current download
location. ZIP SHA256 stays
`79bad9bbf4cff6bf9312e9dbc45ff9dedae44f321872c5d66c01d219cf8ddea0`.
The repository was renamed to `Ahmadjon0worker/BIMO-AI`. The runtime base was
republished in `v0.7.1` as `BIMOAI-Windows-runtime-base.zip` with the original hash.
The Windows workflow uses its read-only repository token with `gh release download`
to fetch this asset from the private repository, then verifies it with `--archive`.
It does not store the token in files or pass it into the runtime helper.

Deleting an earlier release is safe only after this exact archive is uploaded
and verified in the new release.

To use an already downloaded archive without network access:

```powershell
py -3.12 scripts/prepare-release-runtime.py --archive C:/Downloads/BIMOAI-Windows-runtime-base.zip --verify-only
py -3.12 scripts/prepare-release-runtime.py --archive C:/Downloads/BIMOAI-Windows-runtime-base.zip
```

Verified archive contents populate `localai-service/bundle`, `public-voice`,
`public-tools` and the minimal `redist-extract` layout. Existing identical files
are preserved; differing existing generated files are rejected for review rather
than overwritten. Temporary extraction stays inside `.build-inputs`. The helper
then uses the verified private Python to run `build_runtime.py --sync-source`,
refreshing the bundle from the current checkout's service code and guides.
This preserves pinned dependencies while preventing stale bundled source.

`--skip-sync` separates hydration from source synchronization when needed. A
later sync can use:

```powershell
localai-service/bundle/runtime/python.exe -B localai-service/build_runtime.py --sync-source
```

Manually assembling a Python runtime or wheels, converting model checkpoints,
extracting WiX redistributables and unpacking installers are not needed for this
fast path. `localai-service/build_runtime.py`
retains the full rebuild path, and `localai-service/model-preparation/README.md`
documents independent pinned model conversion for maintainers who change assets.
Current service, frontend and native tests plus installer extraction verification
remain required when preparing a new release.
