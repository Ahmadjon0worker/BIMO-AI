// Qanot's launch assembly: stationary facets deploy around a compass beacon.
// No falling character, hand wave, warp streaks or former character silhouette.
import { closeCurve } from "../core/anim";
import { Sound } from "../core/sound";
import { COMPACT_W, NOTCH_H, NOTCH_W } from "../core/layout";
import { drawQanot, QANOT_PALETTE } from "./outfits";

export const GREETING_END = 2.8;
export const GREETING_W = 640;
export const GREETING_H = 150;
export const ASP = 1.12;
const COLLAPSE = 0.34;
const GREETING_SOUND = "greeting";
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const segment = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const smooth = (k: number) => k * k * (3 - 2 * k);

/** Legacy shape fields stay available to layout callers; Qanot has no hands. */
export interface Pose {
  hb: number; x: number; y: number; sx: number; sy: number; tilt: number;
  eye: "dot" | "happy" | "content"; open: number; eyeRoll: number;
  lookX: number; lookY: number;
  handL: number; handR: number; wave: number;
  badge: number; tint: number; halo: number; haloBlue: number; minis: number; fx: number;
  header: number; card: number;
  iw: number; ih: number;
}

function assemblyPose(t: number): Pose {
  const assemble = smooth(segment(t, 0.32, 0.76));
  return {
    hb: 54 * assemble, x: GREETING_W / 2, y: 86,
    sx: 1, sy: 1, tilt: 0,
    eye: t > 1.3 ? "happy" : "dot", open: 1, eyeRoll: 0,
    lookX: 0, lookY: 0, handL: 0, handR: 0, wave: -1,
    badge: smooth(segment(t, 1.1, 1.45)), tint: 0,
    halo: assemble, haloBlue: smooth(segment(t, 0.65, 1.35)),
    minis: 0, fx: 1,
    header: smooth(segment(t, 0.15, 0.5)),
    card: smooth(segment(t, 0.22, 0.55)),
    iw: lerp(NOTCH_W, GREETING_W, smooth(segment(t, 0, 0.5))),
    ih: lerp(NOTCH_H, GREETING_H, smooth(segment(t, 0, 0.5))),
  };
}

function compactPose(): Pose {
  return {
    hb: 17, x: GREETING_W / 2 - COMPACT_W / 2 + 40, y: NOTCH_H / 2,
    sx: 1, sy: 1, tilt: 0, eye: "dot", open: 1, eyeRoll: 0,
    lookX: 0, lookY: 0, handL: 0, handR: 0, wave: -1,
    badge: 1, tint: 0, halo: 0, haloBlue: 1, minis: 1, fx: 0,
    header: 0, card: 0, iw: COMPACT_W, ih: NOTCH_H,
  };
}

/** Retains the exported pose API and the panel's own collapse curve. */
export function greetingPose(t: number, tc = Number.POSITIVE_INFINITY): Pose {
  if (t < tc) return assemblyPose(Math.max(0, t));
  const a = assemblyPose(Math.max(0, tc));
  const b = compactPose();
  const k = segment(t, tc, tc + COLLAPSE);
  const e = k >= 1 ? 1 : closeCurve(k);
  const p: Pose = { ...a };
  for (const key of ["x", "y", "hb", "iw", "ih", "halo", "haloBlue", "badge"] as const) {
    p[key] = lerp(a[key], b[key], e);
  }
  p.header = a.header * (1 - segment(t, tc, tc + 0.1));
  p.card = a.card * (1 - segment(t, tc, tc + 0.18));
  p.minis = smooth(segment(t, tc + 0.18, tc + 0.34));
  p.fx = 1 - segment(t, tc, tc + 0.2);
  p.eye = "dot";
  return p;
}

/** Historical export name; bounds of Qanot's new wing/prism silhouette. */
export function mochiBounds(p: Pose): { left: number; right: number; top: number; bottom: number } | null {
  const R = p.hb / 2;
  if (R <= 0.4) return null;
  return {
    left: p.x - R * ASP * Math.abs(p.sx), right: p.x + R * ASP * Math.abs(p.sx),
    top: p.y - R * 0.9 * Math.abs(p.sy), bottom: p.y + R * 0.9 * Math.abs(p.sy),
  };
}

function drawAssembly(ctx: CanvasRenderingContext2D, p: Pose, t: number) {
  if (p.hb <= 0.8) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(p.sx, p.sy);
  drawQanot(ctx, p.hb / 2, {
    spread: p.haloBlue, signal: p.eye === "happy" ? "happy" : "dot",
    phase: t, energy: 0.25, openness: p.open,
  });
  // A horizontal circuit sweep joins two geometric markers during assembly.
  if (p.fx > 0 && t < 1.6) {
    ctx.globalAlpha = p.fx * Math.sin(Math.PI * segment(t, 0.32, 1.6));
    ctx.strokeStyle = QANOT_PALETTE.gold;
    ctx.lineWidth = 1;
    const length = 30 + 28 * p.haloBlue;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 34, 3); ctx.lineTo(side * length, 3); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawMinis(ctx: CanvasRenderingContext2D, alpha: number) {
  if (alpha <= 0.01) return;
  const cx = GREETING_W / 2 + COMPACT_W / 2 - 40;
  const cy = NOTCH_H / 2;
  const colors = [QANOT_PALETTE.turquoise, QANOT_PALETTE.gold, QANOT_PALETTE.light, "#7FCBDE"];
  [[-6, -6], [6, -6], [-6, 6], [6, 6]].forEach(([dx, dy], i) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx + dx, cy + dy);
    drawQanot(ctx, 4 * alpha, { accent: colors[i], signal: "dot" });
    ctx.restore();
  });
}

export class Greeting {
  private startMs = 0;
  private tc = Number.POSITIVE_INFINITY;
  private fired = false;
  private timers: number[] = [];
  onComplete: (() => void) | null = null;

  start() {
    this.cancelTimers();
    this.startMs = performance.now();
    this.tc = Number.POSITIVE_INFINITY;
    this.fired = false;
    Sound.play(GREETING_SOUND);
    this.timers.push(window.setTimeout(() => this.fire(), (GREETING_END + 0.05) * 1000));
  }

  hover() {
    if (this.tc >= GREETING_END) this.tc = Number.POSITIVE_INFINITY;
  }

  interrupt() {
    const t = this.elapsed;
    if (!Number.isFinite(this.tc) || this.tc > t) this.tc = t;
    this.cancelTimers();
    Sound.fadeOut(GREETING_SOUND, 0.2);
  }

  leave() {
    this.cancelTimers();
    Sound.fadeOut(GREETING_SOUND, 0.2);
  }

  get elapsed(): number { return (performance.now() - this.startMs) / 1000; }
  get done(): boolean { return this.fired; }

  private fire() {
    if (this.fired) return;
    this.fired = true;
    this.cancelTimers();
    this.onComplete?.();
  }

  private cancelTimers() {
    this.timers.forEach(timer => window.clearTimeout(timer));
    this.timers = [];
  }

  draw(ctx: CanvasRenderingContext2D) {
    const t = this.elapsed;
    const end = Number.isFinite(this.tc) ? this.tc + COLLAPSE : GREETING_END;
    if (!this.fired && t >= end) this.fire();
    const p = greetingPose(t, this.tc);
    ctx.clearRect(0, 0, GREETING_W, GREETING_H);
    if (p.card > 0) {
      ctx.save();
      ctx.globalAlpha = p.card;
      ctx.beginPath();
      ctx.moveTo(20, 38); ctx.lineTo(620, 38); ctx.lineTo(630, 48);
      ctx.lineTo(630, 128); ctx.lineTo(620, 138); ctx.lineTo(20, 138);
      ctx.lineTo(10, 128); ctx.lineTo(10, 48); ctx.closePath();
      ctx.fillStyle = QANOT_PALETTE.navy;
      ctx.fill();
      ctx.strokeStyle = "#22635F";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    drawMinis(ctx, p.minis);
    drawAssembly(ctx, p, t);
  }
}
