import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fingerprint, readJson, validateWindowsProof, verifierPowerShell, verifyWindowsPackages } from "../scripts/installer-proof.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "bimo-pack-proof-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (relative, content) => {
    const file = join(root, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    return file;
  };
  const app = put("target/release/coucou.exe", "app fixture");
  const hook = put("target/release/coucou-hook.exe", "hook fixture");
  const guide = put("INSTALL-UZ.md", "public guide");
  const runtimeFile = put("localai-service/bundle/src/public.py", "public runtime");
  const manifest = { service: "coucou-localai-service", architecture: "x64", python: "3.12.14",
    no_user_config_or_credentials: true, file_count: 1, total_bytes: fingerprint(runtimeFile).bytes,
    files: [{ path: "src/public.py", ...fingerprint(runtimeFile) }] };
  const manifestFile = put("localai-service/bundle/runtime-manifest.json", JSON.stringify(manifest));
  const plans = [{ kind: "nsis", built: put("bundle/BIMO AI_0.7.1_x64-setup.exe", "nsis fixture") },
    { kind: "msi", built: put("bundle/BIMO AI_0.7.1_x64_en-US.msi", "msi fixture") }];
  const report = { passed: true, noInstallersExecuted: true, errors: [],
    expected: { product: "BIMO AI", version: "0.7.1", architecture: "x64" }, artifacts: {} };
  for (const plan of plans) report.artifacts[plan.kind] = { path: plan.built, ...fingerprint(plan.built), verification: {
    passed: true, privateFiles: 0, appMetadata: { product: "BIMO AI", productVersion: "0.7.1", fileVersion: "0.7.1" },
    appSha256: fingerprint(app).sha256, hookSha256: fingerprint(hook).sha256, guideSha256: fingerprint(guide).sha256,
    runtimeManifestSha256: fingerprint(manifestFile).sha256, runtimeFiles: 1, runtimeBytes: manifest.total_bytes, payloadFiles: 5,
  } };
  const args = { root, plans, report, productName: "BIMO AI", version: "0.7.1", architecture: "x64" };
  return { root, put, plans, report, args, app, hook, guide, runtimeFile, manifestFile, manifest };
}

test("Windows pack accepts exact archive proof when Tauri touches native mtime after bundling", t => {
  const f = fixture(t);
  utimesSync(f.app, new Date("2099-01-01"), new Date("2099-01-01"));
  const proof = validateWindowsProof(f.args);
  assert.equal(proof.artifacts.nsis.sha256, fingerprint(f.plans[0].built).sha256);
  const reportFile = f.put("report.json", "\uFEFF" + JSON.stringify(f.report));
  assert.equal(readJson(reportFile).passed, true);
  assert.equal(verifyWindowsPackages({ ...f.args, reportFile }).report.sha256, fingerprint(reportFile).sha256);
});

for (const target of ["nsis", "msi"]) test(`Windows pack rejects a ${target} archive changed after extraction`, t => {
  const f = fixture(t);
  const file = f.plans.find(plan => plan.kind === target).built;
  // Keep the size unchanged: a timestamp/size-only check would accept this.
  writeFileSync(file, `${target} fixturE`);
  assert.throws(() => validateWindowsProof(f.args), new RegExp(`${target} installer changed`));
});

for (const field of ["app", "hook", "guide", "runtimeFile"]) test(`Windows pack rejects changed ${field} despite an unchanged successful report`, t => {
  const f = fixture(t);
  const bytes = fingerprint(f[field]).bytes;
  writeFileSync(f[field], "X".repeat(bytes));
  assert.throws(() => validateWindowsProof(f.args), /no longer matches|Runtime file .*changed/);
});

test("Windows pack rejects an updated runtime manifest until the installers are extracted again", t => {
  const f = fixture(t);
  f.manifest.python = "3.12.15";
  writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
  assert.throws(() => validateWindowsProof(f.args), /runtimeManifestSha256 no longer matches/);
});

test("Windows pack rejects runtime files outside the approved manifest", t => {
  const f = fixture(t);
  f.put("localai-service/bundle/src/unapproved.py", "extra public code");
  assert.throws(() => validateWindowsProof(f.args), /unexpected files/);
});

const mutations = {
  "failed extractor": f => { f.report.passed = false; },
  "reported error": f => { f.report.errors.push("extraction failed"); },
  "wrong release": f => { f.report.expected.version = "0.2.0"; },
  "wrong product": f => { f.report.expected.product = "Other"; },
  "wrong architecture": f => { f.report.expected.architecture = "arm64"; },
  "missing MSI": f => { delete f.report.artifacts.msi; },
  "another archive": f => { f.report.artifacts.nsis.path += ".old"; },
  "changed archive hash": f => { f.report.artifacts.nsis.sha256 = "0".repeat(64); },
  "changed archive size": f => { f.report.artifacts.nsis.bytes++; },
  "changed payload hash": f => { f.report.artifacts.msi.verification.hookSha256 = "0".repeat(64); },
  "wrong native version": f => { f.report.artifacts.msi.verification.appMetadata.fileVersion = "0.2.0"; },
  "missing runtime entry": f => { f.report.artifacts.msi.verification.runtimeFiles--; },
  "wrong runtime bytes": f => { f.report.artifacts.msi.verification.runtimeBytes++; },
  "unexpected payload": f => { f.report.artifacts.msi.verification.payloadFiles++; },
  "private payload": f => { f.report.artifacts.msi.verification.privateFiles = 1; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`Windows pack rejects a mutated proof: ${name}`, t => {
  const f = fixture(t);
  mutate(f);
  assert.throws(() => validateWindowsProof(f.args), /Re-run installer verification/);
});

test("Windows pack rejects traversal and private runtime paths before reading them", t => {
  const f = fixture(t);
  for (const path of ["../outside", "C:/private", "src/.env", "storage/account.session"]) {
    f.manifest.files[0].path = path;
    writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
    assert.throws(() => validateWindowsProof(f.args), /Unsafe runtime manifest path|Private state/);
  }
});

test("pack finds the working PowerShell host without a machine-specific project path", t => {
  const f = fixture(t);
  const installed = f.put("installed/pwsh.exe", "PowerShell fixture");
  const inherited = f.put("inherited/pwsh.exe", "PowerShell fixture");
  const explicit = f.put("explicit/pwsh.exe", "PowerShell fixture");
  const env = { PATH: [join(f.root, "missing"), dirname(installed)].join(delimiter), SystemRoot: f.root };
  assert.equal(verifierPowerShell(env), installed);
  assert.equal(verifierPowerShell({ ...env, PSHOME: dirname(inherited) }), inherited);
  assert.equal(verifierPowerShell({ ...env, COUCOU_PACK_POWERSHELL: explicit }), explicit);
  assert.throws(() => verifierPowerShell({ ...env, COUCOU_PACK_POWERSHELL: join(f.root, "absent.exe") }), /COUCOU_PACK_POWERSHELL/);
  assert.equal(verifierPowerShell({ SystemRoot: f.root }), join(f.root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
});
