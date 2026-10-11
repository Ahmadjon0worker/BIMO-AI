// Original Qanot AI angular wing/diamond artwork, rendered directly into PNG/ICO.
// The turquoise/gold emblem is independent of the upstream mascot. The existing
// MIT PNG/ICO encoding helpers are retained; see LICENSE-QANOT-ASSETS.md.
//
//   node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "qanot");

// ── Original Qanot wing emblem ────────────────────────────────────────────────
const SS = 4;
const NAVY = [16, 42, 53];
const TURQUOISE = [34, 198, 189];
const TURQUOISE_LIGHT = [102, 238, 224];
const GOLD = [244, 199, 103];
const GOLD_SHADOW = [194, 139, 44];
const PLATE = [[.5, .045], [.92, .27], [.92, .73], [.5, .955], [.08, .73], [.08, .27]];
const WING_TOP = [[.46, .43], [.13, .235], [.20, .485], [.43, .65], [.38, .48]];
const WING_LOW = [[.425, .53], [.215, .505], [.285, .715], [.46, .78], [.38, .595]];
const DIAMOND = [[.5, .23], [.62, .5], [.5, .81], [.38, .5]];
const CORE = [[.5, .395], [.54, .5], [.5, .63], [.46, .5]];

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i], [bx, by] = points[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function mix(a, b, t) {
  return a.map((value, index) => value * (1 - t) + b[index] * t);
}

function renderQanot(size) {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = [0, 0, 0];
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + .5) / SS) / size;
          const v = (y + (sy + .5) / SS) / size;
          if (!insidePolygon(u, v, PLATE)) continue;
          hits++;
          let sample = NAVY;
          if (insidePolygon(u, v, WING_TOP) || insidePolygon(1 - u, v, WING_TOP)) {
            sample = mix(TURQUOISE_LIGHT, TURQUOISE, Math.min(1, Math.max(0, (v - .23) / .42)));
          }
          if (insidePolygon(u, v, WING_LOW) || insidePolygon(1 - u, v, WING_LOW)) {
            sample = mix(TURQUOISE, [20, 131, 146], Math.min(1, Math.max(0, (v - .5) / .3)));
          }
          if (insidePolygon(u, v, DIAMOND)) sample = mix(GOLD, GOLD_SHADOW, Math.min(1, Math.max(0, (v - .23) / .58)));
          if (insidePolygon(u, v, CORE)) sample = NAVY;
          for (let channel = 0; channel < 3; channel++) color[channel] += sample[channel];
        }
      }
      if (!hits) continue;
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.round(color[channel] / hits);
      pixels[offset + 3] = Math.round(255 * hits / (SS * SS));
    }
  }
  return pixels;
}

// ── PNG ───────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICO (PNG-in-ICO, Vista and later) ─────────────────────────────────────────

function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ── Go ────────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

const png = (size) => encodePNG(size, renderQanot(size));

const files = {
  "32x32.png": png(32),
  "128x128.png": png(128),
  "128x128@2x.png": png(256),
  "icon.png": png(512),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log(`${name} — ${data.length} bytes`);
}

const ico = encodeICO([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) })));
writeFileSync(join(OUT, "icon.ico"), ico);
console.log(`icon.ico — ${ico.length} bytes`);
mkdirSync(ASSETS, { recursive: true });
const manifest = { schema: 1, brand: "Qanot AI", author: "Ahmadjon0worker", license: "MIT",
  generator: "scripts/gen-icons.mjs", design: "Original mirrored angular turquoise wings and gold diamond on a navy hexagonal plate.",
  files: Object.entries({ ...files, "icon.ico": ico }).map(([file, data]) => ({
    file: `src-tauri/icons/${file}`, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"),
  })) };
writeFileSync(join(ASSETS, "icons-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
