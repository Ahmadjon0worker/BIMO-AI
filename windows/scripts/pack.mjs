// Copies the packages Tauri buries in target/release/bundle/ into
// windows/release/, with the names they ship under. Used by `npm run pack` and
// by the release workflows, so both produce exactly the same file names.

import { readFileSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { matchesRelease } from "./bundle-selection.mjs";
import { verifyWindowsPackages } from "./installer-proof.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = join(root, "target", "release", "bundle");
const outDir = join(root, "release");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--verification-report" || !args[1])) {
  throw new Error("Usage: node scripts/pack.mjs [--verification-report <successful-report.json>]");
}
const verificationReport = args[1];

const { version, productName } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const packageVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
if (version !== packageVersion) throw new Error("Installer and frontend versions differ.");
const cargoVersion = readFileSync(join(root, "Cargo.toml"), "utf8")
  .match(/\[workspace\.package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
if (version !== cargoVersion) throw new Error("Installer and native app versions differ.");

// What each platform ships: where Tauri puts it, how to recognise it, and the
// names it is published under (the rolling name, when there is one, always
// points at the latest release).
const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
const debArch = process.arch === "arm64" ? "arm64" : "amd64";
const PACKAGES = {
  win32: [
    {
      dir: "nsis",
      suffix: "-setup.exe",
      names: [`BIMOAI-Windows-${version}-setup.exe`, "BIMOAI-Windows-setup.exe"],
    },
    {
      dir: "msi",
      suffix: ".msi",
      names: [`BIMOAI-Windows-${version}.msi`, "BIMOAI-Windows.msi"],
    },
  ],
  linux: [
    {
      dir: "appimage",
      suffix: ".AppImage",
      names: [`BIMOAI-Linux-${version}-${arch}.AppImage`, `BIMOAI-Linux-${arch}.AppImage`],
    },
    { dir: "deb", suffix: ".deb", names: [`BIMOAI-Linux-${version}-${debArch}.deb`] },
    { dir: "rpm", suffix: ".rpm", names: [`BIMOAI-Linux-${version}-${arch}.rpm`] },
  ],
};

const packages = PACKAGES[process.platform];
if (!packages) {
  console.error(`Nothing to pack on ${process.platform}.`);
  process.exit(1);
}

/** Only this release and architecture can be published; old bundles are never reused. */
function currentBundle(dir, suffix) {
  let files = [];
  try {
    files = readdirSync(dir).filter((file) => matchesRelease(file,
      { productName, version, platform: process.platform, architecture: process.arch, suffix }));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  return files
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

const written = [];
const manifest = { product: productName, version, platform: process.platform, architecture: process.arch, createdAt: new Date().toISOString(), installers: [], payload: [] };
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const plans = packages.map(({ dir, suffix, names }) => {
  const built = currentBundle(join(bundleRoot, dir), suffix);
  if (!built) {
    console.error(`No ${productName} ${version} ${process.arch} ${suffix} bundle in ${join(bundleRoot, dir)} — build this release first.`);
    throw new Error("Build all installers for this release first.");
  }
  const nativeBinary = join(root, "target", "release", process.platform === "win32" ? "coucou.exe" : "coucou");
  if (process.platform !== "win32" && (!existsSync(nativeBinary) || statSync(built).mtimeMs < statSync(nativeBinary).mtimeMs)) {
    throw new Error("Installer is older than the app binary. Rebuild this release before packing.");
  }
  return { kind: dir, built, names };
});

// Tauri may restore/touch coucou.exe after bundling. A successful extraction
// report bound to current content proves freshness more accurately than mtime.
const proof = process.platform === "win32" ? verifyWindowsPackages({ root, plans, productName, version,
  architecture: process.arch, reportFile: verificationReport }) : null;
if (proof) manifest.verification = proof.report;

mkdirSync(outDir, { recursive: true });
for (const { kind, built, names } of plans) {
  for (const name of names) {
    const dest = join(outDir, name);
    copyFileSync(built, dest);
    written.push(dest);
    const bytes = statSync(dest).size;
    const hash = sha256(dest);
    if (proof && (proof.artifacts[kind].bytes !== bytes || proof.artifacts[kind].sha256 !== hash)) {
      throw new Error("Installer changed during packing. Re-run installer verification.");
    }
    manifest.installers.push({ file: name, bytes, sha256: hash, builtFrom: built });
  }
}

for (const name of ["coucou.exe", "coucou-hook.exe"]) {
  const file = join(root, "target", "release", name);
  if (existsSync(file)) manifest.payload.push({ file: name, bytes: statSync(file).size, sha256: sha256(file) });
}
const guide = join(root, "INSTALL-UZ.md");
if (process.platform === "win32" && existsSync(guide)) {
  manifest.payload.push({ file: "INSTALL-UZ.md", bytes: statSync(guide).size, sha256: sha256(guide) });
}
const serviceManifest = join(root, "localai-service", "bundle", "runtime-manifest.json");
if (process.platform === "win32" && existsSync(serviceManifest)) {
  const service = JSON.parse(readFileSync(serviceManifest, "utf8"));
  manifest.service = { service: service.service, architecture: service.architecture,
    files: service.file_count, bytes: service.total_bytes, manifestSha256: sha256(serviceManifest) };
}
writeFileSync(join(outDir, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(outDir, "SHA256SUMS.txt"), manifest.installers.map((i) => `${i.sha256}  ${i.file}`).join("\n") + "\n");

console.log("\n  Packages ready\n");
for (const f of written) {
  const mb = (statSync(f).size / 1024 / 1024).toFixed(2);
  console.log(`  ${f}  (${mb} MB)`);
}
console.log();
