// A Windows bundle is current when extraction proved its exact payload, even
// if Tauri touched the native executable after writing the installers.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const reject = (message) => { throw new Error(`${message} Re-run installer verification before packing.`); };
const requireProof = (condition, message) => { if (!condition) reject(message); };
const validHash = (value) => typeof value === "string" && /^[a-f\d]{64}$/i.test(value);
const validBytes = (value) => Number.isSafeInteger(value) && value >= 0;

export function fingerprint(file) {
  const info = lstatSync(file);
  requireProof(info.isFile() && !info.isSymbolicLink(), `Expected a regular payload file: ${file}.`);
  return { bytes: info.size, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") };
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

export function verifierPowerShell(env = process.env) {
  if (env.COUCOU_PACK_POWERSHELL) {
    const host = resolve(env.COUCOU_PACK_POWERSHELL);
    requireProof(existsSync(host), "COUCOU_PACK_POWERSHELL does not name an existing PowerShell executable.");
    return host;
  }
  const candidates = [env.PSHOME && join(env.PSHOME, "pwsh.exe"),
    ...(env.PATH || "").split(delimiter).filter(Boolean).map(directory => join(directory.replace(/^"|"$/g, ""), "pwsh.exe"))];
  const modern = candidates.find(candidate => candidate && existsSync(candidate));
  if (modern) return modern;
  return env.SystemRoot ? join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe";
}

function assertFingerprint(actual, expected, label) {
  requireProof(validBytes(expected?.bytes) && validHash(expected?.sha256)
    && actual.bytes === expected.bytes && actual.sha256 === expected.sha256.toLowerCase(), `${label} changed or has no valid content proof.`);
}

function runtimePath(value) {
  requireProof(typeof value === "string", "Invalid runtime manifest path.");
  const path = value.replaceAll("\\", "/");
  requireProof(!/[:\x00-\x1f]/.test(path) && path.split("/").every(part => part && part !== "." && part !== ".."), "Unsafe runtime manifest path.");
  requireProof(!/(^|\/)(\.git|\.codex|\.ssh|logs|workspace|backups|storage)(\/|$)/i.test(path)
    && !/(^|\/)(\.env($|\.)|settings\.json$|config\.json$|credentials?\.(json|txt)$|.*\.(session|session-journal|sqlite|sqlite3|db|log|pem|key)$)/i.test(path), "Private state in runtime manifest.");
  return path;
}

function currentRuntime(root) {
  const bundle = join(root, "localai-service", "bundle");
  const manifestFile = join(bundle, "runtime-manifest.json");
  const manifest = readJson(manifestFile);
  requireProof(manifest.service === "coucou-localai-service" && manifest.architecture === "x64"
    && /^3\.12\./.test(manifest.python) && manifest.no_user_config_or_credentials === true, "Unexpected runtime identity.");
  requireProof(Array.isArray(manifest.files) && manifest.files.length > 0
    && manifest.file_count === manifest.files.length && validBytes(manifest.total_bytes), "Invalid runtime manifest counts.");
  const expected = new Set(["runtime-manifest.json"]);
  let bytes = 0;
  for (const entry of manifest.files) {
    const path = runtimePath(entry.path);
    requireProof(!expected.has(path.toLowerCase()), "Duplicate runtime manifest path.");
    expected.add(path.toLowerCase());
    assertFingerprint(fingerprint(join(bundle, path)), entry, `Runtime file ${path}`);
    bytes += entry.bytes;
  }
  requireProof(bytes === manifest.total_bytes, "Runtime manifest total bytes do not match.");
  const actual = readdirSync(bundle, { recursive: true, withFileTypes: true }).filter(entry => !entry.isDirectory());
  requireProof(actual.length === expected.size, "Runtime bundle has missing or unexpected files.");
  // Dirent.parentPath is available in the supported Node runtime; path is its
  // older alias. Keep the comparison relative to the public bundle only.
  for (const entry of actual) {
    requireProof(entry.isFile() && !entry.isSymbolicLink(), "Runtime bundle contains a non-regular file.");
    const parent = entry.parentPath || entry.path;
    const relative = resolve(parent, entry.name).slice(resolve(bundle).length + 1).replaceAll("\\", "/");
    requireProof(expected.has(relative.toLowerCase()), "Unexpected runtime bundle file.");
  }
  return { manifest, fingerprint: fingerprint(manifestFile) };
}

/** Bind the extractor's successful report to every current public build input. */
export function validateWindowsProof({ root, plans, report, productName, version, architecture }) {
  requireProof(architecture === "x64", "Windows extraction verification supports x64 builds only.");
  requireProof(report?.passed === true && report.noInstallersExecuted === true
    && Array.isArray(report.errors) && report.errors.length === 0, "Installer extraction did not pass.");
  requireProof(report.expected?.product === productName && report.expected.version === version
    && report.expected.architecture === architecture, "Installer verification product/version/architecture mismatch.");
  requireProof(plans.length === 2 && plans.some(plan => plan.kind === "nsis") && plans.some(plan => plan.kind === "msi")
    && Object.keys(report.artifacts || {}).sort().join(",") === "msi,nsis", "Both Windows installers need verification.");
  const app = fingerprint(join(root, "target", "release", "coucou.exe"));
  const hook = fingerprint(join(root, "target", "release", "coucou-hook.exe"));
  const guide = fingerprint(join(root, "INSTALL-UZ.md"));
  const runtime = currentRuntime(root);
  const artifactProof = {};
  for (const { kind, built } of plans) {
    const artifact = report.artifacts[kind];
    requireProof(typeof artifact?.path === "string" && resolve(artifact.path).toLowerCase() === resolve(built).toLowerCase(), `${kind} verification names another installer.`);
    const actual = fingerprint(built);
    assertFingerprint(actual, artifact, `${kind} installer`);
    const proof = artifact.verification;
    requireProof(proof?.passed === true && proof.privateFiles === 0
      && proof.appMetadata?.product === productName && proof.appMetadata.productVersion === version
      && proof.appMetadata.fileVersion === version, `${kind} native payload/version verification is invalid.`);
    for (const [name, expectedHash] of Object.entries({ appSha256: app.sha256, hookSha256: hook.sha256,
      guideSha256: guide.sha256, runtimeManifestSha256: runtime.fingerprint.sha256 })) {
      requireProof(validHash(proof[name]) && proof[name].toLowerCase() === expectedHash, `${kind} ${name} no longer matches the current payload.`);
    }
    requireProof(proof.runtimeFiles === runtime.manifest.file_count && proof.runtimeBytes === runtime.manifest.total_bytes
      && proof.payloadFiles === runtime.manifest.file_count + 4, `${kind} runtime/payload counts no longer match.`);
    artifactProof[kind] = actual;
  }
  return { artifacts: artifactProof, app, hook, guide, runtimeManifest: runtime.fingerprint };
}

/** Auto-extract to a unique workspace directory, or revalidate an existing proof. */
export function verifyWindowsPackages({ root, plans, productName, version, architecture, reportFile }) {
  let file = reportFile ? resolve(reportFile) : null;
  if (!file) {
    const workspace = resolve(root, "../..");
    const output = join(workspace, "tmp", "iv", `pack-${randomUUID()}`);
    const executable = verifierPowerShell();
    const verifier = join(root, "scripts", "verify-installers.ps1");
    requireProof(existsSync(verifier), "Installer extraction verifier is missing.");
    // A Node process inherits its launch shell's module search path. Let the
    // chosen PowerShell host load its own built-in Utility/Management modules.
    const env = { ...process.env };
    delete env.PSModulePath;
    const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", verifier,
      "-WindowsRoot", root, "-WorkspaceRoot", workspace, "-NsisPath", plans.find(plan => plan.kind === "nsis").built,
      "-MsiPath", plans.find(plan => plan.kind === "msi").built, "-OutputDirectory", output], { env, stdio: "inherit" });
    requireProof(!result.error && result.status === 0, "Read-only installer extraction failed; check the reported 7-Zip/WiX tools and archive errors.");
    file = join(output, "report.json");
  }
  const report = readJson(file);
  const proof = validateWindowsProof({ root, plans, report, productName, version, architecture });
  return { ...proof, report: { file, ...fingerprint(file) } };
}
