// Original BIMO AI interface cues: deterministic oscillators and envelopes.
// No recordings, sampled instruments, upstream WAVs or third-party melodies.
// Generated artwork/audio are MIT; see ../../LICENSE-QANOT-ASSETS.md.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "qanot", "sounds");
const RATE = 44100;
// Each tone is [start seconds, duration, initial Hz, final Hz, amplitude].
// The three rising notes form BIMO's original short flight signature.
const CUES = {
  peek: [[0, .13, 659, 740, .27], [.075, .14, 988, 1047, .19]],
  open: [[0, .16, 523, 587, .25], [.095, .19, 784, 880, .22], [.17, .17, 1175, 1175, .13]],
  close: [[0, .16, 880, 698, .25], [.09, .17, 523, 392, .20]],
  hover: [[0, .075, 1319, 1480, .16]],
  blip: [[0, .105, 880, 1175, .26]],
  slap: [[0, .075, 190, 72, .34], [.01, .07, 570, 210, .13]],
  annoyed: [[0, .17, 247, 220, .24], [.12, .18, 233, 196, .22]],
  dizzy: [[0, .20, 440, 698, .19], [.12, .20, 698, 330, .19], [.27, .18, 330, 587, .15]],
  greet: [[0, .19, 587, 587, .24], [.13, .20, 740, 740, .23], [.27, .25, 880, 1175, .22]],
  work: [[0, .105, 330, 392, .17], [.07, .13, 494, 523, .16]],
  finish: [[0, .18, 587, 587, .25], [.10, .20, 740, 740, .23], [.21, .28, 1175, 1175, .21]],
  error: [[0, .20, 330, 294, .26], [.15, .22, 247, 220, .25]],
  approval: [[0, .18, 587, 659, .23], [.11, .24, 880, 988, .23]],
  question: [[0, .18, 494, 587, .23], [.13, .20, 659, 784, .22]],
  approve: [[0, .14, 740, 784, .23], [.09, .23, 1175, 1319, .22]],
  gulp: [[0, .15, 480, 150, .25], [.075, .12, 250, 110, .18]],
  tick: [[0, .045, 1760, 1568, .15]],
  send: [[0, .16, 440, 1175, .24], [.085, .15, 988, 1480, .18]],
  love: [[0, .24, 523, 523, .18], [.075, .25, 659, 659, .19], [.15, .28, 880, 880, .18]],
  pop: [[0, .08, 660, 1320, .25]],
  proud: [[0, .21, 587, 587, .22], [.12, .22, 880, 880, .21], [.24, .30, 1175, 1319, .20]],
  wink: [[0, .11, 1047, 1319, .22], [.06, .11, 1568, 1397, .13]],
  yawn: [[0, .48, 262, 196, .20], [.08, .43, 392, 294, .09]],
  attach: [[0, .10, 523, 523, .24], [.095, .15, 784, 784, .22]],
  think: [[0, .10, 392, 440, .15], [.15, .12, 494, 523, .15]],
  search: [[0, .13, 659, 740, .18], [.12, .13, 880, 988, .18], [.24, .14, 1175, 1319, .17]],
  rate: [[0, .10, 740, 740, .19], [.085, .11, 988, 988, .18], [.17, .14, 1319, 1319, .17]],
  sleep: [[0, .28, 523, 440, .15], [.18, .30, 330, 262, .13]],
  greeting: [[0, .27, 587, 587, .21], [.17, .29, 740, 740, .20], [.34, .33, 880, 880, .20], [.54, .38, 1175, 1175, .18]],
};

function synthesize(tones) {
  const duration = Math.max(...tones.map(([start, length]) => start + length)) + .025;
  const samples = new Float64Array(Math.ceil(duration * RATE));
  for (const [start, length, from, to, amplitude] of tones) {
    const begin = Math.round(start * RATE);
    const end = Math.min(samples.length, Math.ceil((start + length) * RATE));
    for (let index = begin; index < end; index++) {
      const t = (index - begin) / RATE;
      const attack = Math.sin(Math.PI / 2 * Math.min(1, t / .007)) ** 2;
      const release = Math.sin(Math.PI / 2 * Math.min(1, Math.max(0, length - t) / .055)) ** 2;
      const envelope = attack * release * Math.exp(-3.4 * t / length);
      const phase = 2 * Math.PI * (from * t + .5 * (to - from) * t * t / length);
      const oscillator = .78 * Math.sin(phase) + .16 * Math.sin(2 * phase) + .06 * Math.sin(3 * phase);
      samples[index] += amplitude * envelope * oscillator;
    }
  }
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const gain = peak > .64 ? .64 / peak : 1;
  const pcm = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[index] * gain)) * 32767), index * 2);
  }
  return { pcm, duration: samples.length / RATE, peak: peak * gain };
}

function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // uncompressed PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

mkdirSync(OUT, { recursive: true });
const files = [];
for (const [name, tones] of Object.entries(CUES)) {
  const result = synthesize(tones);
  const bytes = wav(result.pcm);
  const file = `${name}.wav`;
  writeFileSync(join(OUT, file), bytes);
  files.push({ file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    duration_ms: Math.round(result.duration * 1000), peak: Number(result.peak.toFixed(6)) });
  console.log(`${file}: ${bytes.length} bytes`);
}
// Git checkout line endings must not alter the generated notice or its hash.
const originalLicense = readFileSync(join(ROOT, "..", "LICENSE"), "utf8").replace(/\r?\n/g, "\r\n");
const qanotLicense = readFileSync(join(ROOT, "..", "LICENSE-QANOT-ASSETS.md"), "utf8")
  .replace(/\r\n/g, "\n").trimEnd() + "\n\n";
const license = Buffer.from(originalLicense + "\n\n" + qanotLicense, "utf8");
writeFileSync(join(OUT, "LICENSE.txt"), license);
const manifest = { schema: 1, brand: "BIMO AI", author: "Ahmadjon0worker", license: "MIT",
  generator: "scripts/generate-qanot-sounds.mjs", sample_rate: RATE,
  license_notice: { file: "LICENSE.txt", bytes: license.length, sha256: createHash("sha256").update(license).digest("hex") },
  channels: 1, format: "PCM16", synthesis: "Original deterministic harmonic oscillators, frequency glides and amplitude envelopes; no source audio.", files };
writeFileSync(join(OUT, "sounds-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Generated ${files.length} original BIMO AI cues.`);
