// Qanot's independently authored geometric companion and facet styles.
// Historical outfit IDs remain valid settings values; none render the old art.
import type { Outfit, OutfitSelection } from "./wardrobe";

type Ctx = CanvasRenderingContext2D;
type Point = readonly [number, number];

export const QANOT_PALETTE = {
  turquoise: "#22C6BD", light: "#66EEE0", gold: "#F4C767",
  bronze: "#C28B2C", navy: "#102A35", white: "#E8FFFA",
} as const;

export interface Head {
  R: number; rx: number; ry: number; yaw: number; pitch: number;
  physDx: number; physDy: number;
}

export function makeHead(R: number, yaw = 0, pitch = 0, physDx = 0, physDy = 0): Head {
  return { R, rx: R * 1.1, ry: R * 0.9, yaw, pitch, physDx, physDy };
}

function polygon(ctx: Ctx, points: readonly Point[], fill: string, stroke?: string) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.035;
    ctx.stroke();
  }
}

function line(ctx: Ctx, points: readonly Point[], color: string, width = 0.06) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
  ctx.stroke();
}

const clamp = (value: number, fallback = 0) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

/** Compatibility outline now describes the central angular prism. */
export function bodyOutline(rx: number, ry: number): Path2D {
  const path = new Path2D();
  path.moveTo(0, -ry);
  path.lineTo(rx * 0.5, 0);
  path.lineTo(0, ry);
  path.lineTo(-rx * 0.5, 0);
  path.closePath();
  return path;
}

export interface EyeFrame {
  sd: number; x: number; y: number; fx: number; fy: number;
  visible: boolean; w: number; h: number;
}

/** Kept for callers using the legacy frame API: Qanot has one central beacon. */
export function eyeFrames(H: Head): EyeFrame[] {
  return [{ sd: 0, x: H.yaw * H.R * 0.1, y: H.pitch * H.R * 0.1,
    fx: 1, fy: 1, visible: true, w: H.R * 0.25, h: H.R * 0.25 }];
}

/** Legacy export only; this is a turquoise/gold style, never a pumpkin body. */
export const PUMPKIN_BODY: readonly [string, string] = [QANOT_PALETTE.turquoise, QANOT_PALETTE.gold];

export interface QanotVisual {
  accent?: string;
  signal?: string;
  phase?: number;
  spread?: number;
  energy?: number;
  openness?: number;
  morph?: number;
  lookX?: number;
  lookY?: number;
}

/**
 * Draw in local coordinates. The silhouette is bounded by ±1.12R horizontally
 * and ±0.9R vertically. Polygonal wings, a gold keel and one compass beacon
 * are shared by panel, desktop, minis, launch assembly and style icons.
 */
export function drawQanot(ctx: Ctx, R: number, visual: QanotVisual = {}) {
  if (!Number.isFinite(R) || R <= 0) return;
  const accent = visual.accent || QANOT_PALETTE.turquoise;
  const spread = 0.76 + clamp(visual.spread ?? 1, 1) * 0.24;
  const phase = Number.isFinite(visual.phase) ? visual.phase! : 0;
  const pulse = Math.sin(phase * 2.1) * clamp(visual.energy ?? 0) * 0.025;
  const morph = clamp(visual.morph ?? 0);
  ctx.save();
  ctx.scale(R, R);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    polygon(ctx, [[0.22, -0.16], [1.08 * spread, -0.48 - pulse],
      [0.79 * spread, 0.39], [0.32, 0.2]], accent, QANOT_PALETTE.navy);
    polygon(ctx, [[0.27, -0.15], [0.94 * spread, -0.36 - pulse],
      [0.6 * spread, -0.02]], QANOT_PALETTE.light);
    polygon(ctx, [[0.32, 0.09], [0.79 * spread, 0.39],
      [0.59 * spread, 0.42], [0.23, 0.28]], QANOT_PALETTE.bronze);
    line(ctx, [[0.42, 0.04], [0.9 * spread, -0.22]], QANOT_PALETTE.gold, 0.045);
    ctx.restore();
  }
  polygon(ctx, [[0, -0.83], [0.43, -0.03], [0, 0.86], [-0.43, -0.03]],
    QANOT_PALETTE.gold, QANOT_PALETTE.navy);
  polygon(ctx, [[0, -0.66], [0.29, -0.03], [0, 0.62], [-0.29, -0.03]],
    QANOT_PALETTE.navy);
  line(ctx, [[0, 0.63], [0, 0.8]], QANOT_PALETTE.light, 0.045);

  const lookX = Math.max(-1, Math.min(1, visual.lookX || 0)) * 0.045;
  const lookY = Math.max(-1, Math.min(1, visual.lookY || 0)) * 0.04;
  ctx.save();
  ctx.translate(lookX, lookY - 0.03);
  const open = 0.08 + clamp(visual.openness ?? 1, 1) * 0.92;
  ctx.scale(1, open);
  switch (visual.signal) {
    case "closed": case "tired":
      line(ctx, [[-0.13, 0], [0.13, 0]], QANOT_PALETTE.gold);
      break;
    case "flat": case "line":
      line(ctx, [[-0.12, -0.12], [0.12, 0.12]], "#FF897B");
      line(ctx, [[0.12, -0.12], [-0.12, 0.12]], "#FF897B");
      break;
    case "happy": case "star":
      line(ctx, [[-0.15, 0], [-0.035, 0.12], [0.17, -0.14]], QANOT_PALETTE.light);
      break;
    case "spiral":
      ctx.rotate(phase * 0.9);
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        line(ctx, [[0.02, -0.14], [0.15, -0.14], [0.15, -0.02]], QANOT_PALETTE.light, 0.035);
      }
      break;
    case "wink": case "cup":
      line(ctx, [[-0.12, -0.12], [0.08, 0], [-0.12, 0.12]], QANOT_PALETTE.white);
      break;
    case "heart":
      polygon(ctx, [[0, -0.17], [0.16, 0], [0, 0.17], [-0.16, 0]], "#FF91BE");
      polygon(ctx, [[0, -0.07], [0.07, 0], [0, 0.07], [-0.07, 0]], QANOT_PALETTE.white);
      break;
    default:
      polygon(ctx, [[0, -0.16], [0.14, 0], [0, 0.16], [-0.14, 0]],
        QANOT_PALETTE.white);
  }
  ctx.restore();

  // File-drop mode is a geometric envelope slot, not a character/body morph.
  if (morph > 0.01) {
    ctx.globalAlpha *= morph;
    polygon(ctx, [[-0.27, 0.32], [0.27, 0.32], [0.27, 0.57], [-0.27, 0.57]],
      QANOT_PALETTE.turquoise);
    line(ctx, [[-0.24, 0.34], [0, 0.46], [0.24, 0.34]], QANOT_PALETTE.navy, 0.04);
  }
  ctx.restore();
}

export interface OutfitState { presence: number; morph: number }

const STYLES: Readonly<Record<Outfit, number>> = {
  none: 0, partyHat: 1, beanie: 2, crown: 3, sunglasses: 4,
  roundGlasses: 5, bow: 6, scarf: 7, witchHat: 8, pumpkin: 9,
  santaHat: 10, bunnyEars: 11,
};

function styleAlpha(st: OutfitState) {
  return clamp(st.presence) * (1 - clamp(st.morph));
}

/** Faceted trail plates replace hats, ears and other former wardrobe artwork. */
export function drawOutfitBehind(ctx: Ctx, outfit: Outfit, H: Head, st: OutfitState) {
  if (outfit === "none" || styleAlpha(st) <= 0.005) return;
  const index = STYLES[outfit] || 0;
  ctx.save();
  ctx.globalAlpha *= styleAlpha(st);
  ctx.scale(H.R, H.R);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    const tip = 0.63 + (index % 3) * 0.06;
    polygon(ctx, [[0.22, 0.15], [tip, 0.57], [0.29, 0.43]],
      index % 2 ? QANOT_PALETTE.gold : QANOT_PALETTE.light);
    ctx.restore();
  }
  ctx.restore();
}

/** Each saved style has its own small linear wing engraving and prism marker. */
export function drawOutfitFront(ctx: Ctx, outfit: Outfit, H: Head, st: OutfitState) {
  if (outfit === "none" || styleAlpha(st) <= 0.005) return;
  const index = STYLES[outfit] || 0;
  ctx.save();
  ctx.globalAlpha *= styleAlpha(st);
  ctx.scale(H.R, H.R);
  const count = 1 + index % 3;
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const dx = 0.56 + i * 0.12;
      line(ctx, [[side * dx, -0.08], [side * (dx - 0.07), 0.12]],
        index % 2 ? QANOT_PALETTE.gold : QANOT_PALETTE.navy, 0.055);
    }
  }
  const tip = -0.5 - (index % 4) * 0.035;
  polygon(ctx, [[0, tip - 0.07], [0.07, tip], [0, tip + 0.07], [-0.07, tip]],
    index > 6 ? QANOT_PALETTE.turquoise : QANOT_PALETTE.white);
  ctx.restore();
}

export function drawWardrobeIcon(ctx: Ctx, size: number, selection: OutfitSelection, seasonal: Outfit, autoLabel: string) {
  ctx.clearRect(0, 0, size, size);
  const outfit = selection === "auto" ? seasonal : selection;
  const R = size * 0.28;
  const H = makeHead(R);
  const state = { presence: 1, morph: 0 };
  ctx.save();
  ctx.translate(size / 2, size * 0.45);
  drawOutfitBehind(ctx, outfit, H, state);
  drawQanot(ctx, R);
  drawOutfitFront(ctx, outfit, H, state);
  ctx.restore();
  if (selection === "auto") {
    ctx.save();
    ctx.fillStyle = QANOT_PALETTE.gold;
    ctx.font = "600 " + Math.max(4, size * 0.15) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(autoLabel, size / 2, size * 0.87, size * 0.85);
    ctx.restore();
  }
}
