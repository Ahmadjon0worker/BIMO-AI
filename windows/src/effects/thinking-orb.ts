import type { BotStateName } from "../core/layout";
import { MODE_FRAMES, paintFrame, resolvePreset } from "../vendor/thinking-orbs/engine/index";
import type { OrbFrame, OrbSize, OrbState } from "../vendor/thinking-orbs/engine/index";
import type { OrbTheme } from "../vendor/thinking-orbs/types";

export type { OrbSize, OrbState, OrbTheme };

export const ORB_STATES: readonly OrbState[] = [
  "working", "searching", "solving", "listening", "connecting",
  "weaving", "composing", "breathing", "shaping",
];

const BOT_STATES: Record<BotStateName, OrbState> = {
  idle: "breathing", working: "working", thinking: "solving", searching: "searching",
  approval: "shaping", question: "shaping", error: "shaping", finished: "shaping",
  ratelimit: "breathing", sleeping: "breathing", dizzy: "weaving",
};

/** Companion status and the orb remain independent: no task state is changed. */
export function botStateToOrbState(state: BotStateName): OrbState {
  return BOT_STATES[state];
}

/** Shared UI vocabulary for chat, Telegram, providers, and voice status. */
export function orbStateForStatus(status: string): OrbState {
  const key = status.trim().toLowerCase();
  if (ORB_STATES.includes(key as OrbState)) return key as OrbState;
  if (Object.hasOwn(BOT_STATES, key)) return BOT_STATES[key as BotStateName];
  switch (key) {
    case "sending": case "loading": case "running": case "busy": return "working";
    case "processing": case "transcribing": case "reasoning": return "solving";
    case "recording": case "capturing": return "listening";
    case "speaking": case "streaming": case "generating": case "writing": return "composing";
    case "connecting": case "reconnecting": case "authenticating": case "pending": return "connecting";
    case "tool": case "executing": case "automation": return "weaving";
    case "ready": case "connected": case "success": case "stopped": case "offline": return "breathing";
    case "failed": case "disconnected": case "warning": return "shaping";
    default: return "breathing";
  }
}

const LABELS: Record<OrbState, string> = {
  working: "Ishlayapti", searching: "Qidirmoqda", solving: "Tahlil qilmoqda",
  listening: "Tinglamoqda", connecting: "Ulanmoqda", weaving: "Vazifalarni bog‘lamoqda",
  composing: "Javob yozmoqda", breathing: "Tayyor", shaping: "Holat o‘zgarmoqda",
};

export interface OrbDrawOptions {
  state: OrbState;
  size: OrbSize;
  /** Seconds from the caller's shared clock; preset speed is applied here. */
  time: number;
  dark?: boolean;
  /** Optional agent accent; upstream's depth and alpha remain unchanged. */
  accent?: string;
}

/** Original upstream geometry, including its depth ordering and tuned sizes. */
export function thinkingOrbFrame(state: OrbState, size: OrbSize, time: number): OrbFrame {
  const { mode, speed, opts } = resolvePreset(state, size);
  return MODE_FRAMES[mode](size, (Number.isFinite(time) ? time : 0) * speed, opts);
}

function accentRGB(accent?: string): [number, number, number] | null {
  if (!accent || !/^#[\da-f]{6}$/i.test(accent)) return null;
  return [1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16)) as [number, number, number];
}

/** Does not clear or transform its caller's canvas, so Moshi can share it. */
export function drawThinkingOrb(ctx: CanvasRenderingContext2D, options: OrbDrawOptions): void {
  const frame = thinkingOrbFrame(options.state, options.size, options.time);
  const dark = options.dark ?? true;
  const accent = accentRGB(options.accent);
  ctx.save();
  if (!accent) {
    paintFrame(ctx, frame, dark);
  } else {
    const ink = (white: number, alpha = 1) => {
      const w = Math.max(0, Math.min(1, white));
      const g = (dark ? 1 - w : w) * 255;
      const rgb = accent.map(c => Math.round(dark ? g * (.25 + .75 * c / 255) : g + (255 - g) * c / 255 * .6));
      return `rgba(${rgb.join(",")},${alpha})`;
    };
    for (const line of frame.lines) {
      ctx.strokeStyle = ink(line.white, line.a);
      ctx.lineWidth = line.w;
      ctx.beginPath(); ctx.moveTo(line.x1, line.y1); ctx.lineTo(line.x2, line.y2); ctx.stroke();
    }
    for (const dot of frame.dots) {
      ctx.fillStyle = ink(dot.white, dot.a);
      ctx.beginPath(); ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

export interface ThinkingOrbOptions {
  state?: OrbState;
  size?: OrbSize;
  theme?: OrbTheme;
  speed?: number;
  label?: string;
  visible?: boolean;
  className?: string;
  accent?: string;
}

export interface ThinkingOrb {
  el: HTMLCanvasElement;
  setState(state: OrbState): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

interface Client {
  el: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  state: OrbState;
  size: OrbSize;
  theme: OrbTheme;
  speed: number;
  accent?: string;
  label?: string;
  visible: boolean;
  intersecting: boolean;
  destroyed: boolean;
}

// All inline and avatar indicators use one clock, one RAF, and one set of
// document observers. Hidden/offscreen instances never generate frames.
const clients = new Set<Client>();
let raf: number | null = null;
let reduced: MediaQueryList | null = null;
let scheme: MediaQueryList | null = null;
let intersections: IntersectionObserver | null = null;
let mutations: MutationObserver | null = null;

function now() { return performance.now() / 1000; }
function canPaint(client: Client) {
  return !!client.ctx && !client.destroyed && client.visible && client.intersecting &&
    client.el.isConnected && document.visibilityState !== "hidden";
}
function isDark(client: Client): boolean {
  if (client.theme !== "auto") return client.theme === "dark";
  let node: Element | null = client.el;
  while (node) {
    const attr = node.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr === "dark";
    if (node.classList.contains("dark")) return true;
    if (node.classList.contains("light")) return false;
    node = node.parentElement;
  }
  // The Windows panels declare color-scheme in CSS even when the OS is
  // light. Respect that substrate before falling back to OS preferences.
  const hostScheme = typeof window.getComputedStyle === "function" ? window.getComputedStyle(client.el).colorScheme : "";
  if (hostScheme === "dark" || hostScheme === "light") return hostScheme === "dark";
  return scheme?.matches ?? true;
}
function paint(client: Client, time: number) {
  if (!client.ctx) return;
  const ratio = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
  const dpr = Math.max(1, Math.min(2, ratio || 1));
  const pixels = Math.round(client.size * dpr);
  if (client.el.width !== pixels || client.el.height !== pixels) {
    client.el.width = pixels; client.el.height = pixels;
  }
  client.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  client.ctx.clearRect(0, 0, client.size, client.size);
  drawThinkingOrb(client.ctx, {
    state: client.state, size: client.size, time: reduced?.matches ? .6 : time * client.speed,
    dark: isDark(client), accent: client.accent,
  });
}
function stop() {
  if (raf !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
  raf = null;
}
function needsAnimation() {
  return !reduced?.matches && [...clients].some(client => canPaint(client) && client.speed > 0);
}
function schedule() {
  if (!needsAnimation()) { stop(); return; }
  if (raf === null && typeof requestAnimationFrame === "function") raf = requestAnimationFrame(tick);
}
function tick(time: number) {
  raf = null;
  for (const client of clients) if (canPaint(client) && client.speed > 0) paint(client, time / 1000);
  schedule();
}
function refresh() {
  for (const client of clients) if (canPaint(client)) paint(client, now());
  schedule();
}
function startObservers() {
  if (clients.size !== 1) return;
  reduced = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  scheme = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  reduced?.addEventListener("change", refresh);
  scheme?.addEventListener("change", refresh);
  document.addEventListener?.("visibilitychange", refresh);
  if (typeof IntersectionObserver !== "undefined") {
    intersections = new IntersectionObserver(entries => {
      for (const entry of entries) {
        for (const client of clients) if (client.el === entry.target) client.intersecting = entry.isIntersecting;
      }
      refresh();
    });
  }
  if (typeof MutationObserver !== "undefined" && document.documentElement) {
    mutations = new MutationObserver(refresh);
    mutations.observe(document.documentElement, {
      attributes: true, attributeFilter: ["class", "data-theme"], childList: true, subtree: true,
    });
  }
}
function stopObservers() {
  if (clients.size) return;
  stop();
  reduced?.removeEventListener("change", refresh);
  scheme?.removeEventListener("change", refresh);
  document.removeEventListener?.("visibilitychange", refresh);
  intersections?.disconnect(); mutations?.disconnect();
  reduced = null; scheme = null; intersections = null; mutations = null;
}

/** Plain Canvas 2D indicator; an owner must destroy it when its view closes. */
export function createThinkingOrb(options: ThinkingOrbOptions = {}): ThinkingOrb {
  const el = document.createElement("canvas");
  const size = options.size ?? 20;
  el.className = ["thinking-orb", options.className].filter(Boolean).join(" ");
  el.setAttribute("role", "img");
  el.setAttribute("style", `width:${size}px;height:${size}px;flex:0 0 ${size}px;display:block;pointer-events:none`);
  const client: Client = {
    el, ctx: typeof el.getContext === "function" ? el.getContext("2d") : null,
    state: options.state ?? "working", size, theme: options.theme ?? "auto",
    speed: Number.isFinite(options.speed) ? Math.max(0, options.speed ?? 1) : 1,
    accent: options.accent, label: options.label, visible: options.visible ?? true,
    intersecting: typeof IntersectionObserver === "undefined", destroyed: false,
  };
  function relabel() {
    el.dataset.orbState = client.state;
    el.setAttribute("aria-label", client.label ?? LABELS[client.state]);
  }
  relabel(); clients.add(client); startObservers();
  intersections?.observe(el); refresh();
  return {
    el,
    setState(state) {
      if (client.destroyed || client.state === state) return;
      client.state = state; relabel();
      if (canPaint(client)) paint(client, now());
      schedule();
    },
    setVisible(visible) {
      if (client.destroyed) return;
      client.visible = visible;
      if (canPaint(client)) paint(client, now());
      schedule();
    },
    destroy() {
      if (client.destroyed) return;
      client.destroyed = true; clients.delete(client);
      intersections?.unobserve(el); stopObservers(); schedule();
    },
  };
}
