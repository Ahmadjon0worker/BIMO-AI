import { h } from "../views/dom";
import type { BotStateName } from "../core/layout";
import { BotEngine } from "./engine";
import type { MoshiVariant } from "./moshi";

/** A small companion whose animation belongs to the visible tools tab. */
export function createMoshiAvatar(variant: MoshiVariant, label: string, size = 52) {
  const el = h("canvas", { class: "moshi-avatar", role: "img", "aria-label": label,
    style: `width:${size}px;height:${size}px;flex:0 0 ${size}px;display:block` });
  el.dataset.moshiVariant = variant;
  const engine = new BotEngine();
  engine.isMini = true; engine.variant = variant;
  const ctx = typeof el.getContext === "function" ? el.getContext("2d") : null;
  const reduced = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let visible = false, disposed = false, frame: number | null = null, last = 0;
  const canPaint = () => !!ctx && !disposed && visible && el.isConnected && document.visibilityState !== "hidden";
  function stop() {
    if (frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    frame = null; last = 0;
  }
  function paint() {
    if (!ctx) return;
    engine.reducedMotion = !!reduced?.matches;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const pixels = Math.round(size * dpr);
    if (el.width !== pixels || el.height !== pixels) { el.width = pixels; el.height = pixels; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (reduced?.matches) {
      // Show the current status without waiting for the badge's entrance tween.
      engine.badge = engine.cfg.badge;
      engine.badgeS = engine.badge ? 1 : 0;
      engine.open = engine.state === "sleeping" ? 0 : 1;
    }
    engine.draw(ctx, size, size);
  }
  function tick(time: number) {
    frame = null;
    if (!canPaint()) { last = 0; return; }
    if (!reduced?.matches) engine.update(last ? Math.min(.05, (time - last) / 1000) : 0);
    last = time; paint();
    if (!reduced?.matches) frame = requestAnimationFrame(tick);
  }
  function resume() {
    stop();
    if (ctx && visible && !disposed && typeof requestAnimationFrame === "function") frame = requestAnimationFrame(tick);
  }
  document.addEventListener?.("visibilitychange", resume);
  reduced?.addEventListener("change", resume);
  return { el,
    setState(state: BotStateName) {
      if (disposed) return;
      engine.setState(state);
      el.dataset.moshiState = state;
      if (reduced?.matches && canPaint()) { engine.update(0); paint(); }
    },
    setVisible(next: boolean) { visible = next; resume(); },
    destroy() {
      disposed = true; stop();
      document.removeEventListener?.("visibilitychange", resume);
      reduced?.removeEventListener("change", resume);
    },
  };
}
