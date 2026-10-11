import { defineConfig, type Plugin } from "vite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, copyFileSync, createReadStream, readFileSync, lstatSync } from "node:fs";
import { resolve, join, extname } from "node:path";

// ───────────────────────────────────────────────────────────────────────────────
// Qanot's original, source-generated oscillator cues and license notices.
// No upstream macOS sound directory is part of this Windows build.
export const SOUNDS_DIR = resolve(__dirname, "assets/qanot/sounds");
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Serves/copies only the 29 hash-verified Qanot WAVs and their MIT notices.
 * These original assets become part of the embedded frontend in the installer.
 */
function qanotSounds(): Plugin {
  const prefix = "/sounds/";
  const manifestName = "sounds-manifest.json";
  const noticeName = "LICENSE.txt";
  type Asset = { file: string; bytes: number; sha256: string };
  const verify = (): Asset[] => {
    const manifestPath = join(SOUNDS_DIR, manifestName);
    if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile()) {
      throw new Error("Generate Qanot sounds first: node scripts/generate-qanot-sounds.mjs");
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.schema !== 1 || manifest.brand !== "Qanot AI" || manifest.license !== "MIT"
        || !Array.isArray(manifest.files) || manifest.files.length !== 29
        || manifest.license_notice?.file !== noticeName) throw new Error("Invalid original Qanot sound manifest.");
    const files = [...manifest.files, manifest.license_notice] as Asset[];
    const names = new Set<string>();
    for (const file of files) {
      if ((file.file !== noticeName && !/^[a-z]+\.wav$/.test(file.file)) || names.has(file.file)
          || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
        throw new Error("Unsafe or duplicate Qanot sound asset.");
      }
      names.add(file.file);
      const path = join(SOUNDS_DIR, file.file);
      if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).size !== file.bytes
          || createHash("sha256").update(readFileSync(path)).digest("hex") !== file.sha256) {
        throw new Error(`Qanot sound asset changed: ${file.file}. Regenerate the original assets.`);
      }
    }
    const wavs = readdirSync(SOUNDS_DIR).filter((name) => extname(name) === ".wav");
    if (wavs.length !== 29 || wavs.some((name) => !names.has(name))) throw new Error("Unlisted Qanot WAV asset.");
    return files;
  };
  return {
    name: "qanot-original-sounds",
    buildStart() { verify(); },
    configureServer(server) {
      const allowed = new Set([...verify().map((file) => file.file), manifestName]);
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(prefix)) return next();
        let name: string;
        try { name = decodeURIComponent(req.url.slice(prefix.length).split("?")[0]); }
        catch { return next(); }
        if (!allowed.has(name)) return next();
        const file = join(SOUNDS_DIR, name);
        if (!existsSync(file)) return next();
        res.setHeader("Content-Type", name.endsWith(".wav") ? "audio/wav"
          : name.endsWith(".json") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const out = resolve(__dirname, "dist/sounds");
      const files = verify();
      mkdirSync(out, { recursive: true });
      for (const file of files) copyFileSync(join(SOUNDS_DIR, file.file), join(out, file.file));
      copyFileSync(join(SOUNDS_DIR, manifestName), join(out, manifestName));
    },
  };
}

export default defineConfig({
  plugins: [qanotSounds()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    // Cargo writes and locks files under target/ while Vite starts; watching them
    // crashes Vite on Windows with EBUSY. Packaging also locks release archives.
    // Tauri watches src-tauri/ itself; generated service files need no UI reload.
    watch: { ignored: ["**/target/**", "**/release/**", "**/localai-service/bundle/**", "**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "chrome110",
    minify: "esbuild",
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        island: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
        tools: resolve(__dirname, "tools.html"),
        studio: resolve(__dirname, "studio.html"),
        mochi: resolve(__dirname, "mochi.html"),
      },
    },
  },
});
