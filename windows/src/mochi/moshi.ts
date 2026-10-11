// Moshi keeps Mochi's expressive face and soft five-sided silhouette. Its liquid
// shell is transparent, so the backdrop remains visible through the body.
// Fresnel rim lighting follows QuickLiquid's specular model (Amarnath, MIT):
// https://github.com/amarnath3003/quickLiquid · math/specular.ts.
// BotEngine continues to supply the original motion and emotional gestures.

export type MoshiVariant = "moshi" | "codex" | "opencode" | "telegram" | "claude"
  | "github" | "automation" | "vercel" | "cursor" | "gemini" | "copilot"
  | "muse" | "amp" | "hermes" | "agent";

export interface MoshiVisual {
  variant?: MoshiVariant;
  accent?: string;
  eye?: string;
  phase?: number;
  yaw?: number;
  pitch?: number;
  /** One is open; zero is a fully closed blink. */
  blink?: number;
  /** Positive values open a mouth; idle keeps the original mouthless face. */
  mouth?: number;
  /** Zero omits hands; one draws them at full size. */
  hands?: number;
  blush?: number;
  /** Blend to a five-sided mailbox with a flat top, preserving slot geometry. */
  mailbox?: number;
  bodyColor?: string;
  tint?: string;
  tintStrength?: number;
  /** Freeze the liquid's moving highlights without changing its material. */
  reducedMotion?: boolean;
  /** Clothing paints between the shell and the final reflective surface. */
  reflections?: boolean;
}

interface Palette { top: string; bottom: string; accent: string; ink: string }

export const MOSHI_PALETTE: Readonly<Record<MoshiVariant, Palette>> = {
  moshi: { top: "rgb(237,237,239)", bottom: "rgb(196,197,202)", accent: "#8096aa", ink: "rgb(26,20,18)" },
  codex: { top: "#edf2f0", bottom: "#bbc9c5", accent: "#4f947f", ink: "rgb(26,20,18)" },
  opencode: { top: "#edf0f5", bottom: "#bbc3d2", accent: "#6484ac", ink: "rgb(26,20,18)" },
  telegram: { top: "#edf2f6", bottom: "#b7c9d7", accent: "#478fbd", ink: "rgb(26,20,18)" },
  claude: { top: "#f3eeeb", bottom: "#cdc0ba", accent: "#bb8972", ink: "rgb(26,20,18)" },
  github: { top: "#eeeff3", bottom: "#c0c2cc", accent: "#78849a", ink: "rgb(26,20,18)" },
  automation: { top: "#edf3f1", bottom: "#b9ccc7", accent: "#598c81", ink: "rgb(26,20,18)" },
  vercel: { top: "#eef0f3", bottom: "#bdc3cc", accent: "#687a90", ink: "rgb(26,20,18)" },
  cursor: { top: "#eef0f5", bottom: "#bec3d2", accent: "#7885b0", ink: "rgb(26,20,18)" },
  gemini: { top: "#f0eef6", bottom: "#c4bed5", accent: "#9383b8", ink: "rgb(26,20,18)" },
  copilot: { top: "#edf2f4", bottom: "#bac8ce", accent: "#6397aa", ink: "rgb(26,20,18)" },
  muse: { top: "#f4edf3", bottom: "#d0bfd0", accent: "#ac88ac", ink: "rgb(26,20,18)" },
  amp: { top: "#f4f0e9", bottom: "#d1c6b9", accent: "#b99c74", ink: "rgb(26,20,18)" },
  hermes: { top: "#f3f1eb", bottom: "#cec8ba", accent: "#aa9d7d", ink: "rgb(26,20,18)" },
  agent: { top: "#edf0f3", bottom: "#bec6ce", accent: "#7d9aae", ink: "rgb(26,20,18)" },
};

/** Task IDs contain both integration IDs and provider-prefixed session IDs. */
export function moshiVariantFor(id: string): MoshiVariant {
  const value = id.toLowerCase();
  if (/telegram/.test(value)) return "telegram";
  if (/opencode|open-code/.test(value)) return "opencode";
  if (/codex|openai/.test(value)) return "codex";
  if (/claude|anthropic/.test(value)) return "claude";
  if (/github/.test(value)) return "github";
  if (/automation|automate|schedule|workflow|n8n/.test(value)) return "automation";
  if (/vercel/.test(value)) return "vercel";
  if (/cursor/.test(value)) return "cursor";
  if (/gemini|google|antigravity/.test(value)) return "gemini";
  if (/copilot/.test(value)) return "copilot";
  if (/muse/.test(value)) return "muse";
  if (/(?:^|[:/_-])amp(?:$|[:/_-])/.test(value)) return "amp";
  if (/hermes/.test(value)) return "hermes";
  if (/^(?:moshi|mochi|qanot|main|companion)?$/.test(value)) return "moshi";
  return "agent";
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
type Point = readonly [number, number];

/** Custom pill colours retain a light-facing side instead of becoming flat. */
export function moshiBodyColors(variant: MoshiVariant, custom?: string | null): readonly [string, string] {
  const palette = MOSHI_PALETTE[variant];
  if (!custom) return [palette.top, palette.bottom];
  let components: number[] | null = null;
  const rgb = custom.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) components = rgb.slice(1, 4).map(Number);
  else if (/^#[a-f0-9]{6}$/i.test(custom)) {
    components = [1, 3, 5].map(start => parseInt(custom.slice(start, start + 2), 16));
  } else if (/^#[a-f0-9]{3}$/i.test(custom)) {
    components = [1, 2, 3].map(start => parseInt(custom[start] + custom[start], 16));
  }
  if (!components) return [custom, custom];
  const highlight = components.map(value => Math.round(clamp(value, 0, 255) + (255 - clamp(value, 0, 255)) * .38));
  return [`rgb(${highlight.join(",")})`, custom];
}

/** Five corners, softly rounded without turning the silhouette into a circle. */
export function moshiBodyPath(rx: number, ry: number, mailbox = 0): Path2D {
  const normal: Point[] = [[0, -1], [1, -.3], [.64, 1], [-.64, 1], [-1, -.3]];
  // Same winding and vertex order: no crossed edges during a mailbox transition.
  const mail: Point[] = [[.9, -1], [1, .35], [0, 1], [-1, .35], [-.9, -1]];
  const m = clamp(mailbox);
  const points: Point[] = normal.map(([x, y], i) => [
    (x + (mail[i][0] - x) * m) * rx,
    (y + (mail[i][1] - y) * m) * ry,
  ]);
  const path = new Path2D();
  const fraction = .22 - .135 * m;
  let previousEnd: Point | null = null;
  let firstStart: Point | null = null;
  function edge(from: Point, to: Point) {
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const length = Math.hypot(dx, dy) || 1;
    // A slight outward bow makes the straight sides feel inflated, like Mochi.
    // The mailbox top stays flat so the original slot and suction target agree.
    const bow = Math.min(rx, ry) * .045 * (1 - m);
    const ox = dy / length * bow, oy = -dx / length * bow;
    path.bezierCurveTo(from[0] + dx / 3 + ox, from[1] + dy / 3 + oy,
      from[0] + dx * 2 / 3 + ox, from[1] + dy * 2 / 3 + oy, to[0], to[1]);
  }
  for (let i = 0; i < 5; i++) {
    const a = points[(i + 4) % 5], b = points[i], c = points[(i + 1) % 5];
    const start: Point = [b[0] + (a[0] - b[0]) * fraction, b[1] + (a[1] - b[1]) * fraction];
    const end: Point = [b[0] + (c[0] - b[0]) * fraction, b[1] + (c[1] - b[1]) * fraction];
    if (i === 0) { path.moveTo(start[0], start[1]); firstStart = start; }
    else if (previousEnd) edge(previousEnd, start);
    path.quadraticCurveTo(b[0], b[1], end[0], end[1]);
    previousEnd = end;
  }
  if (previousEnd && firstStart) edge(previousEnd, firstStart);
  path.closePath();
  return path;
}

function line(ctx: CanvasRenderingContext2D, points: Point[], close = false) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  if (close) ctx.closePath();
}

function polygon(ctx: CanvasRenderingContext2D, points: Point[]) {
  line(ctx, points, true); ctx.fill();
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  polygon(ctx, [[x, y - r], [x + r * .65, y], [x, y + r], [x - r * .65, y]]);
}

/** Pure lighting geometry shared by the main body, minis and export renderer. */
export function moshiLiquidLight(visual: MoshiVisual = {}) {
  const phase = visual.reducedMotion ? 0 : (visual.phase ?? 0);
  const yaw = clamp(visual.yaw ?? 0, -1.5, 1.5);
  const pitch = clamp(visual.pitch ?? 0, -1.5, 1.5);
  return {
    x: .34 + Math.sin(phase * .42) * .045 + Math.sin(yaw) * .14,
    y: -.46 + Math.cos(phase * .33) * .028 - Math.sin(pitch) * .10,
    drift: Math.sin(phase * .31) * .055,
  };
}

/** Schlick's approximation: clear at the centre, reflective at a grazing rim. */
export function moshiFresnel(cosTheta: number, ior = 1.5): number {
  const r0 = ((ior - 1) / (ior + 1)) ** 2;
  const grazing = 1 - clamp(cosTheta);
  return r0 + (1 - r0) * grazing ** 5;
}

/** Body paint used by the full engine as well as the standalone renderer. */
export function drawMoshiShell(ctx: CanvasRenderingContext2D, R: number, visual: MoshiVisual = {}, body?: Path2D) {
  const rx = R * 1.14, ry = R * .88;
  const variant = visual.variant ?? "moshi";
  const path = body ?? moshiBodyPath(rx, ry, visual.mailbox);
  ctx.save();
  const gradient = ctx.createLinearGradient(rx * .7, -ry * .85, -rx * .8, ry * .9);
  const [top, bottom] = moshiBodyColors(variant, visual.bodyColor);
  gradient.addColorStop(0, top);
  gradient.addColorStop(.50, bottom);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  // Tint is a coloured film, rather than an opaque fill. Canvas alpha preserves
  // actual page/desktop pixels behind the five-sided companion.
  ctx.globalAlpha *= visual.bodyColor ? .32 : .25;
  ctx.fill(path);
  ctx.restore(); ctx.save(); ctx.clip(path);

  const light = moshiLiquidLight(visual);
  const volume = ctx.createLinearGradient(-rx, -ry, rx * .7, ry);
  volume.addColorStop(0, "rgba(255,255,255,.23)");
  volume.addColorStop(.38, "rgba(255,255,255,.035)");
  volume.addColorStop(.70, "rgba(158,186,217,.025)");
  volume.addColorStop(1, "rgba(27,43,65,.13)");
  ctx.fillStyle = volume; ctx.fill(path);
  const caustic = ctx.createRadialGradient(-rx * .35, ry * .68, 0,
    -rx * .35, ry * .68, R * .95);
  caustic.addColorStop(0, "rgba(162,219,255,.16)");
  caustic.addColorStop(.45, "rgba(196,236,255,.045)");
  caustic.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = caustic; ctx.fill(path);

  // A soft inner lens reflection keeps Mochi's face readable on a detailed
  // backdrop, with no opaque face panel or change to the original black eyes.
  const lens = ctx.createRadialGradient(rx * light.x * .25, ry * .08, R * .08,
    rx * light.x * .25, ry * .08, R * .74);
  lens.addColorStop(0, "rgba(244,248,255,.27)");
  lens.addColorStop(.6, "rgba(244,248,255,.09)");
  lens.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = lens; ctx.fill(path);
  if (visual.tint && (visual.tintStrength ?? 0) > 0) {
    ctx.save(); ctx.globalAlpha *= clamp(visual.tintStrength ?? 0) * .34;
    const tint = ctx.createLinearGradient(0, ry, 0, -ry);
    tint.addColorStop(0, visual.tint); tint.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = tint; ctx.fill(path);
    ctx.restore();
  }
  ctx.restore();
  if (visual.reflections !== false) drawMoshiReflection(ctx, R, visual, path);
}

/** Curved glass rim and moving specular sheen, clipped to the actual silhouette. */
export function drawMoshiReflection(ctx: CanvasRenderingContext2D, R: number, visual: MoshiVisual = {}, body?: Path2D) {
  const rx = R * 1.14, ry = R * .88;
  const path = body ?? moshiBodyPath(rx, ry, visual.mailbox);
  const light = moshiLiquidLight(visual);
  ctx.save(); ctx.clip(path);
  const shadow = ctx.createRadialGradient(0, 0, R * .15, 0, 0, R * 1.25);
  shadow.addColorStop(0, "rgba(0,0,0,0)");
  shadow.addColorStop(.60, "rgba(12,24,43,.015)");
  shadow.addColorStop(1, "rgba(4,16,32,.27)");
  ctx.fillStyle = shadow; ctx.fill(path);

  // A broad bevel and a narrow grazing line approximate the 1-D Fresnel band
  // without per-pixel readback, filters or a second animation loop for minis.
  const rim = ctx.createLinearGradient(rx * .65, -ry, -rx * .65, ry);
  rim.addColorStop(0, "rgba(255,255,255,.91)");
  rim.addColorStop(.24, "rgba(228,243,255,.26)");
  rim.addColorStop(.48, "rgba(163,204,239,.045)");
  rim.addColorStop(.72, "rgba(184,222,253,.37)");
  rim.addColorStop(1, "rgba(255,255,255,.73)");
  ctx.lineJoin = "round"; ctx.strokeStyle = rim;
  ctx.globalAlpha *= .36 + moshiFresnel(.3) * .42;
  ctx.lineWidth = Math.max(1.5, R * .18); ctx.stroke(path);
  ctx.restore(); ctx.save(); ctx.clip(path);

  // Very narrow channel offsets live only in the bezel, like QuickLiquid's
  // chromatic dispersion. They never colour or soften Mochi's facial features.
  const edgeWidth = Math.max(.55, R * .015);
  for (const [dx, color] of [[-R * .012, "rgba(114,218,255,.43)"],
    [R * .012, "rgba(255,173,213,.31)"]] as const) {
    ctx.save(); ctx.translate(dx, 0); ctx.strokeStyle = color;
    ctx.lineWidth = edgeWidth; ctx.stroke(path); ctx.restore();
  }
  ctx.strokeStyle = rim; ctx.lineWidth = Math.max(.7, R * .029); ctx.stroke(path);
  ctx.save(); ctx.scale(.947, .947);
  const innerRim = ctx.createLinearGradient(-rx, -ry, rx, ry);
  innerRim.addColorStop(0, "rgba(255,255,255,.17)");
  innerRim.addColorStop(.40, "rgba(255,255,255,.015)");
  innerRim.addColorStop(1, "rgba(159,213,252,.23)");
  ctx.strokeStyle = innerRim; ctx.lineWidth = Math.max(.5, R * .018); ctx.stroke(path);
  ctx.restore();

  const reflection = ctx.createRadialGradient(rx * light.x, ry * light.y, 0,
    rx * light.x, ry * light.y, R * .56);
  reflection.addColorStop(0, "rgba(255,255,255,.58)");
  reflection.addColorStop(.23, "rgba(255,255,255,.23)");
  reflection.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = reflection; ctx.fill(path);

  // The large curved glint reads as a soft lens rather than a rigid prism.
  ctx.save(); ctx.translate(rx * (.11 + light.drift), -ry * .56);
  ctx.rotate(-.19 + Math.sin(visual.yaw ?? 0) * .12); ctx.scale(1, .26);
  const glint = ctx.createRadialGradient(0, 0, 0, 0, 0, R * .69);
  glint.addColorStop(0, "rgba(255,255,255,.31)");
  glint.addColorStop(.56, "rgba(255,255,255,.095)");
  glint.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glint; ctx.beginPath(); ctx.arc(0, 0, R * .69, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.restore();
}

/** Each integration has its own silhouette detail, visor or chest insignia. */
export function drawMoshiDetails(ctx: CanvasRenderingContext2D, R: number, visual: MoshiVisual = {}, body?: Path2D) {
  const rx = R * 1.14, ry = R * .88;
  const variant = visual.variant ?? "moshi", palette = MOSHI_PALETTE[variant];
  const accent = visual.accent ?? palette.accent;
  const phase = visual.phase ?? 0;
  const yaw = Math.sin(visual.yaw ?? 0) * rx * .34;
  const pitch = -(visual.pitch ?? 0) * ry * .24;
  const path = body ?? moshiBodyPath(rx, ry, visual.mailbox);
  ctx.save();
  ctx.clip(path);
  ctx.translate(yaw, pitch);
  ctx.fillStyle = accent; ctx.strokeStyle = accent;
  ctx.globalAlpha *= .70;
  ctx.lineWidth = Math.max(.6, R * .040);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const y = ry * .10;
  switch (variant) {
    case "moshi": break;
    case "codex":
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(s * rx * .61, y - R * .23);
        ctx.lineTo(s * rx * .69, y - R * .23);
        ctx.quadraticCurveTo(s * rx * .77, y - R * .23, s * rx * .77, y - R * .14);
        ctx.lineTo(s * rx * .77, y + R * .14);
        ctx.quadraticCurveTo(s * rx * .77, y + R * .23, s * rx * .69, y + R * .23);
        ctx.lineTo(s * rx * .61, y + R * .23); ctx.stroke();
      }
      line(ctx, [[-R * .14, ry * .58], [-R * .23, ry * .65], [-R * .14, ry * .72]]); ctx.stroke();
      line(ctx, [[R * .14, ry * .58], [R * .23, ry * .65], [R * .14, ry * .72]]); ctx.stroke();
      break;
    case "opencode":
      ctx.beginPath();
      ctx.moveTo(-rx * .58, y - R * .24); ctx.lineTo(rx * .58, y - R * .24);
      ctx.quadraticCurveTo(rx * .78, y - R * .24, rx * .78, y - R * .05);
      ctx.lineTo(rx * .78, y + R * .08);
      ctx.quadraticCurveTo(rx * .78, y + R * .26, rx * .58, y + R * .26);
      ctx.lineTo(-rx * .58, y + R * .26);
      ctx.quadraticCurveTo(-rx * .78, y + R * .26, -rx * .78, y + R * .08);
      ctx.lineTo(-rx * .78, y - R * .05);
      ctx.quadraticCurveTo(-rx * .78, y - R * .24, -rx * .58, y - R * .24);
      ctx.closePath(); ctx.stroke();
      line(ctx, [[-R * .16, ry * .57], [-R * .06, ry * .66], [-R * .16, ry * .75]]); ctx.stroke();
      line(ctx, [[R * .06, ry * .75], [R * .23, ry * .75]]); ctx.stroke();
      break;
    case "telegram":
      polygon(ctx, [[-R * .25, ry * .54], [R * .28, ry * .42], [R * .13, ry * .84], [-R * .01, ry * .67]]);
      ctx.strokeStyle = palette.top; ctx.lineWidth = R * .025;
      line(ctx, [[-R * .01, ry * .67], [R * .22, ry * .46]]); ctx.stroke();
      break;
    case "claude":
      ctx.save(); ctx.translate(0, ry * .63); ctx.rotate(Math.sin(phase) * .06);
      for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4); line(ctx, [[R * .06, 0], [R * .17, 0]]); ctx.stroke();
      }
      ctx.restore();
      break;
    case "github":
      for (const s of [-1, 1]) {
        polygon(ctx, [[s * rx * .75, ry * .25], [s * rx * .91, ry * .33], [s * rx * .78, ry * .53]]);
      }
      line(ctx, [[-R * .21, ry * .67], [0, ry * .51], [R * .21, ry * .67]]); ctx.stroke();
      break;
    case "automation":
      ctx.save(); ctx.translate(0, ry * .62); ctx.rotate(Math.sin(phase * .9) * .1);
      for (let i = 0; i < 6; i++) {
        ctx.rotate(Math.PI / 3); ctx.fillRect(R * .09, -R * .025, R * .08, R * .05);
      }
      ctx.beginPath(); ctx.arc(0, 0, R * .10, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      break;
    case "vercel": polygon(ctx, [[0, ry * .45], [R * .22, ry * .80], [-R * .22, ry * .80]]); break;
    case "cursor":
      polygon(ctx, [[-R * .11, ry * .45], [R * .21, ry * .73], [R * .03, ry * .73], [-R * .04, ry * .89]]);
      break;
    case "gemini":
      polygon(ctx, [[0, ry * .40], [R * .07, ry * .59], [R * .23, ry * .64], [R * .07, ry * .69],
        [0, ry * .89], [-R * .07, ry * .69], [-R * .23, ry * .64], [-R * .07, ry * .59]]);
      break;
    case "copilot":
      for (const s of [-1, 1]) {
        const ex = s * rx * .37;
        line(ctx, [[ex - R * .23, y - R * .21], [ex + R * .23, y - R * .21],
          [ex + R * .26, y + R * .20], [ex - R * .26, y + R * .20]], true); ctx.stroke();
      }
      line(ctx, [[-R * .16, y], [R * .16, y]]); ctx.stroke();
      break;
    case "muse":
      line(ctx, [[0, ry * .79], [0, ry * .45], [R * .16, ry * .50]]); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-R * .07, ry * .79, R * .09, R * .055, -.3, 0, Math.PI * 2); ctx.fill();
      break;
    case "amp":
      for (let i = -2; i <= 2; i++) {
        const h = R * (.12 + .07 * (1 + Math.sin(phase * 2.2 + i)));
        line(ctx, [[i * R * .09, ry * .64 - h / 2], [i * R * .09, ry * .64 + h / 2]]); ctx.stroke();
      }
      break;
    case "hermes":
      for (const s of [-1, 1]) {
        line(ctx, [[s * R * .05, ry * .72], [s * R * .26, ry * .56], [s * R * .19, ry * .73]]); ctx.stroke();
      }
      diamond(ctx, 0, ry * .58, R * .09);
      break;
    case "agent":
      line(ctx, [[-R * .19, ry * .57], [0, ry * .72], [R * .19, ry * .57]]); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, ry * .50, R * .04, 0, Math.PI * 2); ctx.fill();
      break;
  }
  ctx.restore();
  // Integration details are kept small so Mochi's original face stays central.
  if (variant !== "moshi" && (visual.mailbox ?? 0) < .5) {
    ctx.save(); ctx.globalAlpha *= .65; ctx.strokeStyle = accent; ctx.fillStyle = accent;
    ctx.lineWidth = Math.max(.7, R * .06); ctx.lineCap = "round";
    if (variant === "telegram" || variant === "automation") {
      const side = variant === "telegram" ? 1 : -1;
      const px = side * R * .38, py = -ry * .75;
      line(ctx, [[px, py], [px + side * R * .08, py - R * .23]]); ctx.stroke();
      ctx.beginPath(); ctx.arc(px + side * R * .08, py - R * .25, R * .055, 0, Math.PI * 2); ctx.fill();
    } else if (variant === "opencode") {
      ctx.beginPath(); ctx.moveTo(-R * .15, -ry * .89);
      ctx.quadraticCurveTo(R * .03, -ry * 1.07, R * .20, -ry * .88); ctx.stroke();
    } else if (variant === "hermes") {
      for (const s of [-1, 1]) polygon(ctx, [[s * rx * .75, -ry * .42], [s * rx * 1.05, -ry * .60], [s * rx * .89, -ry * .20]]);
    } else if (variant === "cursor") {
      polygon(ctx, [[rx * .72, -ry * .38], [rx * .99, -ry * .77], [rx * .94, -ry * .05]]);
    } else if (variant === "gemini") {
      diamond(ctx, 0, -ry * .89, R * .13);
    } else if (variant === "github") {
      for (const s of [-1, 1]) {
        line(ctx, [[s * R * .17, -ry * .83], [s * R * .28, -ry * 1.04]]); ctx.stroke();
      }
    } else if (variant === "copilot") {
      line(ctx, [[-R * .23, -ry * .73], [-R * .14, -ry * 1.03], [R * .14, -ry * 1.03], [R * .23, -ry * .73]]); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawEye(ctx: CanvasRenderingContext2D, w: number, h: number, shape: string, side: number, blink: number, phase: number) {
  ctx.lineWidth = w * .35; ctx.lineCap = "round";
  if (shape === "closed" || blink < .12 || shape === "line" || shape === "flat" || shape === "tired") {
    line(ctx, [[-w * .6, 0], [w * .6, shape === "line" ? side * w * .15 : 0]]); ctx.stroke(); return;
  }
  if (shape === "happy" || (shape === "wink" && side > 0)) {
    ctx.beginPath(); ctx.arc(0, h * .20, w * .75, Math.PI * 1.14, Math.PI * 1.86); ctx.stroke(); return;
  }
  if (shape === "spiral") {
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 4; a += .24) {
      const r = w * (.04 + a * .047), angle = a + phase * side * 4;
      const px = Math.cos(angle) * r, py = Math.sin(angle) * r;
      if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke(); return;
  }
  if (shape === "heart") {
    ctx.fillStyle = "#ef668b"; ctx.beginPath(); ctx.moveTo(0, h * .42);
    ctx.bezierCurveTo(-w * 1.4, -h * .12, -w * .70, -h * .96, 0, -h * .30);
    ctx.bezierCurveTo(w * .70, -h * .96, w * 1.4, -h * .12, 0, h * .42); ctx.fill(); return;
  }
  if (shape === "star") {
    const points: Point[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = w * (i % 2 ? .40 : .88);
      points.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    ctx.fillStyle = "#eeb04f"; polygon(ctx, points); return;
  }
  ctx.beginPath();
  const hh = Math.max(w * .10, h * clamp(blink));
  ctx.ellipse(0, 0, w * (shape === "wide" ? .62 : .50), shape === "dot" ? w * .5 : hh / 2, 0, 0, Math.PI * 2); ctx.fill();
}

/** Draw at the current canvas origin. Callers supply transforms and animation. */
export function drawMoshi(ctx: CanvasRenderingContext2D, R: number, visual: MoshiVisual = {}) {
  const variant = visual.variant ?? "moshi", palette = MOSHI_PALETTE[variant];
  const rx = R * 1.14, ry = R * .88, phase = visual.phase ?? 0;
  const yaw = visual.yaw ?? 0, pitch = visual.pitch ?? 0;
  const body = moshiBodyPath(rx, ry, visual.mailbox);
  ctx.save();
  if ((visual.hands ?? 0) > 0) {
    ctx.fillStyle = visual.bodyColor ?? palette.bottom;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * rx * 1.04, ry * .63 + Math.sin(phase * 3 + side) * R * .025,
        R * .17 * clamp(visual.hands ?? 0), R * .12 * clamp(visual.hands ?? 0), side * .18, 0, Math.PI * 2); ctx.fill();
    }
  }
  drawMoshiShell(ctx, R, visual, body);
  drawMoshiDetails(ctx, R, visual, body);
  ctx.save(); ctx.clip(body);
  if ((visual.blush ?? 0) > 0) {
    ctx.fillStyle = `rgba(242,129,154,${clamp(visual.blush ?? 0) * .45})`;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(side * rx * .57 + Math.sin(yaw) * rx * .55, ry * .32,
        R * .16, R * .075, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  for (const side of [-1, 1]) {
    const angle = side * .37 + yaw, cp = Math.cos(-.12 + pitch);
    if (Math.cos(angle) * cp <= .04) continue;
    ctx.save();
    ctx.translate(Math.sin(angle) * cp * rx, -Math.sin(-.12 + pitch) * ry);
    ctx.scale(Math.max(.18, Math.cos(angle)), Math.max(.18, cp));
    ctx.fillStyle = palette.ink; ctx.strokeStyle = palette.ink;
    drawEye(ctx, R * .25, R * .27, visual.eye ?? "pill", side, clamp(visual.blink ?? 1), phase);
    ctx.restore();
  }
  if ((visual.mouth ?? 0) > .015) {
    ctx.save(); ctx.translate(Math.sin(yaw) * R * .30, ry * .35);
    ctx.strokeStyle = palette.ink; ctx.fillStyle = palette.ink; ctx.lineWidth = Math.max(.7, R * .035); ctx.lineCap = "round";
    ctx.beginPath(); ctx.ellipse(0, 0, R * .12, R * clamp(visual.mouth ?? 0, .025, .26), 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore(); ctx.restore();
}
