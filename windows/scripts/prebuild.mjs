// Fail before packaging if the portable service is missing, damaged or stale.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform === "win32") {
  if (process.arch !== "x64") throw new Error("The bundled LocalAI runtime requires a Windows x64 build.");
  const bundle = join(root, "localai-service", "bundle");
  const manifestFile = join(bundle, "runtime-manifest.json");
  if (!existsSync(manifestFile)) throw new Error("Prepare the LocalAI runtime first; see localai-service/README.md.");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  if (manifest.service !== "coucou-localai-service" || manifest.architecture !== "x64"
    || !Array.isArray(manifest.files) || manifest.files.length !== manifest.file_count) {
    throw new Error("Invalid LocalAI runtime manifest. Regenerate the runtime.");
  }
  const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const expected = new Set(["runtime-manifest.json", ...manifest.files.map((item) => item.path)]);
  if (expected.size !== manifest.file_count + 1) throw new Error("Duplicate LocalAI resource paths.");
  const walk = (folder, prefix = "") => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Redirected LocalAI resource: ${relative}.`);
      if (entry.isDirectory()) walk(join(folder, entry.name), relative + "/");
      else if (!entry.isFile() || !expected.has(relative)) throw new Error(`Unlisted LocalAI resource: ${relative}.`);
    }
  };
  walk(bundle);
  for (const item of manifest.files) {
    if (typeof item.path !== "string" || isAbsolute(item.path) || item.path.split(/[\\/]/).includes("..")) {
      throw new Error("Invalid LocalAI resource path.");
    }
    const file = resolve(bundle, item.path);
    if (!file.startsWith(bundle + sep) || !existsSync(file) || statSync(file).size !== item.bytes
      || digest(file) !== item.sha256) throw new Error(`LocalAI resource changed: ${item.path}. Regenerate the runtime.`);
    if (item.path.startsWith("src/")) {
      const source = join(root, "localai-service", item.path);
      if (!existsSync(source) || digest(source) !== item.sha256) {
        throw new Error(`LocalAI source is newer than its bundle: ${item.path}. Regenerate the runtime.`);
      }
    }
  }
  console.log(`Verified ${manifest.file_count} LocalAI runtime files before build.`);
}

await import("./build-hook.mjs");
