// The relay is staged into a separate user bin folder: it needs a static CRT.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.platform === "win32"
  ? ["rustc", "--release", "-p", "coucou-hook", "--", "-C", "target-feature=+crt-static"]
  : ["build", "--release", "-p", "coucou-hook"];
const result = spawnSync("cargo", args, { cwd: root, stdio: "inherit", shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
