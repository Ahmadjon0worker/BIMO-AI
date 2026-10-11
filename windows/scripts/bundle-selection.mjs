/** Match Tauri's bundle names by product, exact version and architecture. */
export function matchesRelease(file, { productName, version, platform, architecture, suffix }) {
  if (!file.endsWith(suffix)) return false;
  if (platform === "win32") {
    const arch = architecture === "arm64" ? "arm64" : architecture === "ia32" ? "x86" : "x64";
    const stem = `${productName}_${version}_${arch}`;
    return file.startsWith(stem) && ["_", "-", "."].includes(file[stem.length]);
  }
  const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const product = escaped(productName.toLowerCase());
  const release = escaped(version);
  const arch = architecture === "arm64" ? "(?:aarch64|arm64)" : "(?:x86_64|amd64)";
  if (suffix === ".rpm") {
    return new RegExp(`^${product}-${release}-\\d+\\.${arch}\\.rpm$`, "i").test(file);
  }
  return new RegExp(`^${product}_${release}_${arch}(?:_|\\.)`, "i").test(file);
}
