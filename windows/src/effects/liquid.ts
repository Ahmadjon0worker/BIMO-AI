import { LiquidGlassEngine } from "../vendor/quick-liquid/core/engine";
import type { LiquidGlassConfig } from "../vendor/quick-liquid/core/config";
import { Spring } from "../vendor/quick-liquid/animations/spring";

export type LiquidScope = "island" | "studio" | "tools" | "settings";

const SELECTORS: Record<LiquidScope, string> = {
  island: "#island, .card, .chat-bar, .picker, .local-ai-card",
  studio: ".studio-sidebar, .studio-chat-content, .studio-health-tile, .studio-health-controls, .picker",
  tools: ".card, .account-auth-step, .account-api-editor, .toolbox-plan-step",
  settings: "section, .provider-setup, .hook-preview",
};
const PRESS = "button, .btn, .pill";
const installed = new WeakMap<HTMLElement, () => void>();
const MAX_OPTICS = 12;
function cornerRadius(style: CSSStyleDeclaration): number {
  return Math.max(...[style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].map(value => parseFloat(value) || 0));
}

interface Surface {
  el: HTMLElement;
  shell: HTMLDivElement | null;
  engine: LiquidGlassEngine | null;
  inView: boolean;
  position: [string, string] | null;
  zIndex: [string, string] | null;
  radius: number;
  pendingRadius: number | null;
  radiusTimer: ReturnType<typeof setTimeout> | null;
  move: (event: PointerEvent) => void;
  leave: () => void;
}

/** Static optics configuration: maps rebuild on geometry, not on each frame. */
export function liquidConfig(scope: LiquidScope, radius: number, primary = false): Partial<LiquidGlassConfig> {
  return {
    material: "clear", appearance: "dark", borderRadius: radius,
    blur: primary ? 3 : 5, saturation: 1.28,
    refractionStrength: primary ? 25 : 16,
    bezelWidth: primary ? 30 : 18, thickness: primary ? 24 : 16,
    chromaticAberration: primary ? .3 : .2, dispersionMode: "exact",
    tint: "14, 23, 37", tintOpacity: scope === "island" ? .1 : .15,
    edgeHighlight: .82, specularStrength: .24, lightAngle: -35,
    quality: primary ? "high" : "medium", refractionMode: "auto",
    elevation: 0, dynamicLighting: false, cursorTracking: false,
    parallax: false, hoverLighting: false, respectPreferences: true,
  };
}

/** Install glass without moving existing children or changing layout dimensions.
 * Call destroy when the window/view is disposed. Hidden or detached surfaces
 * release SVG maps and animation frames; small controls use one press spring.
 */
export function installLiquidSurfaces(root: HTMLElement, scope: LiquidScope = "island"): () => void {
  installed.get(root)?.();
  const oldScope = root.getAttribute("data-liquid-scope");
  root.setAttribute("data-liquid-scope", scope);
  const surfaces = new Map<HTMLElement, Surface>();
  const reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const opaque = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-transparency: reduce)") : null;
  let disposed = false, pending: number | null = null, pressFrame: number | null = null;
  let pressTarget: HTMLElement | null = null, savedScale: [string, string] | null = null;
  const spring = new Spring(1, { stiffness: 420, damping: 25, restThreshold: .003, restDisplacementThreshold: .0005 });
  const intersection = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const surface = surfaces.get(entry.target as HTMLElement);
      if (surface) surface.inView = entry.isIntersecting;
    }
    queue();
  }, { rootMargin: "60px" }) : null;
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => queue()) : null;

  function restoreStyle(el: HTMLElement, key: string, value: [string, string] | null) {
    if (!value) return;
    if (value[0]) el.style.setProperty(key, value[0], value[1]);
    else el.style.removeProperty(key);
  }
  function release(surface: Surface) {
    if (surface.radiusTimer !== null) clearTimeout(surface.radiusTimer);
    surface.radiusTimer = null; surface.pendingRadius = null;
    surface.engine?.destroy(); surface.engine = null;
    surface.shell?.remove(); surface.shell = null;
    surface.el.removeAttribute("data-liquid-optics");
  }
  function remove(surface: Surface) {
    release(surface);
    intersection?.unobserve(surface.el); resize?.unobserve(surface.el);
    surface.el.removeEventListener("pointermove", surface.move);
    surface.el.removeEventListener("pointerleave", surface.leave);
    surface.el.classList.remove("liquid-surface");
    restoreStyle(surface.el, "position", surface.position);
    restoreStyle(surface.el, "z-index", surface.zIndex);
    surfaces.delete(surface.el);
  }
  function visible(el: HTMLElement) {
    // Island tabs stay in the DOM at opacity zero for transitions; their boxes
    // still intersect the viewport. Only the selected tab needs optical maps.
    const view = el.closest(".view");
    if (view && !view.classList.contains("on") && !view.classList.contains("studio-chat-view")) return false;
    return !document.hidden && el.isConnected && !el.closest("[hidden], [aria-hidden='true']")
      && el.getClientRects().length > 0 && el.offsetWidth >= 8 && el.offsetHeight >= 8;
  }
  function register(el: HTMLElement) {
    if (surfaces.has(el) || el.closest(".liquid-optics")) return;
    const style = getComputedStyle(el);
    const surface: Surface = {
      el, shell: null, engine: null, inView: !intersection,
      position: style.position === "static" ? [el.style.getPropertyValue("position"), el.style.getPropertyPriority("position")] : null,
      zIndex: style.zIndex === "auto" ? [el.style.getPropertyValue("z-index"), el.style.getPropertyPriority("z-index")] : null,
      radius: cornerRadius(style),
      pendingRadius: null, radiusTimer: null,
      move: event => { if (!reduced?.matches && event.pointerType !== "touch") surface.engine?.setLightPosition(event.clientX, event.clientY); },
      leave: () => surface.engine?.resetLightPosition(),
    };
    if (surface.position) el.style.position = "relative";
    if (surface.zIndex) el.style.zIndex = "0";
    el.classList.add("liquid-surface");
    el.addEventListener("pointermove", surface.move, { passive: true });
    el.addEventListener("pointerleave", surface.leave, { passive: true });
    surfaces.set(el, surface); intersection?.observe(el); resize?.observe(el);
  }
  function reconcile() {
    pending = null;
    if (disposed) return;
    const selector = SELECTORS[scope];
    const candidates = [root, ...root.querySelectorAll<HTMLElement>(selector)].filter(el => el.matches(selector));
    for (const surface of surfaces.values()) if (!root.contains(surface.el) || !surface.el.matches(selector)) remove(surface);
    for (const el of candidates) register(el);
    let active = 0;
    for (const surface of surfaces.values()) {
      const wanted = active < MAX_OPTICS && surface.inView && visible(surface.el) && !opaque?.matches;
      if (!wanted) { release(surface); continue; }
      active++;
      // Views may replace their host's children while refreshing. Dispose the
      // old detached shell/maps before rebuilding its decorative sibling.
      if (surface.engine && surface.shell?.parentElement !== surface.el) release(surface);
      // Match changing island corner radii without changing the interactive host.
      const radius = cornerRadius(getComputedStyle(surface.el));
      if (surface.engine) {
        // Docking animates corner radii as well as dimensions. CSS inheritance
        // clips immediately; the optical field only rebuilds after geometry
        // settles, rather than rasterizing another map on each animation frame.
        if (radius === surface.radius) {
          if (surface.radiusTimer !== null) clearTimeout(surface.radiusTimer);
          surface.radiusTimer = null; surface.pendingRadius = null;
        } else if (radius !== surface.pendingRadius) {
          if (surface.radiusTimer !== null) clearTimeout(surface.radiusTimer);
          surface.pendingRadius = radius;
          surface.radiusTimer = setTimeout(() => {
            surface.radiusTimer = null;
            const settled = surface.pendingRadius;
            surface.pendingRadius = null;
            if (disposed || settled === null || !surface.engine || !visible(surface.el)) return;
            surface.engine.updateConfig({ borderRadius: settled });
            surface.radius = settled;
            surface.shell!.style.borderRadius = "inherit";
          }, 90);
        }
        continue;
      }
      const shell = document.createElement("div");
      shell.className = "liquid-optics";
      shell.setAttribute("aria-hidden", "true");
      surface.el.prepend(shell);
      try {
        surface.engine = new LiquidGlassEngine(shell, liquidConfig(scope, radius, surface.el.id === "island" || surface.el.classList.contains("studio-chat-content")));
        shell.style.borderRadius = "inherit"; // Preserve asymmetrical screen-edge docking corners.
        surface.radius = radius; surface.shell = shell;
        surface.el.setAttribute("data-liquid-optics", "ready");
      } catch {
        shell.remove(); // CSS frost/lighting stays usable without Canvas/SVG.
        surface.el.setAttribute("data-liquid-optics", "fallback");
      }
    }
  }
  function queue() {
    if (disposed || pending !== null) return;
    pending = requestAnimationFrame(reconcile);
  }
  function resetPress() {
    if (pressFrame !== null) cancelAnimationFrame(pressFrame);
    pressFrame = null;
    if (pressTarget) restoreStyle(pressTarget, "scale", savedScale);
    pressTarget = null; savedScale = null; spring.setValue(1);
  }
  function tickPress(now: number) {
    pressFrame = null;
    if (disposed || document.hidden || reduced?.matches || !pressTarget?.isConnected) { resetPress(); return; }
    const moving = spring.tick(now);
    pressTarget.style.setProperty("scale", spring.value.toFixed(4));
    if (moving) pressFrame = requestAnimationFrame(tickPress);
    else if (spring.target === 1) resetPress();
  }
  function animatePress(target: number) {
    spring.setTarget(target);
    if (pressFrame === null) pressFrame = requestAnimationFrame(tickPress);
  }
  function down(event: PointerEvent) {
    if (event.button !== 0 || reduced?.matches || document.hidden) return;
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>(PRESS) : null;
    if (!el || !root.contains(el) || el.matches(":disabled, [aria-disabled='true'], #panel-drag-handle, [data-tauri-drag-region]")) return;
    resetPress(); pressTarget = el;
    savedScale = [el.style.getPropertyValue("scale"), el.style.getPropertyPriority("scale")];
    animatePress(.962);
  }
  function up() { if (pressTarget) animatePress(1); }
  function preferences() { resetPress(); queue(); }
  function visibility() {
    resetPress();
    if (document.hidden) {
      if (pending !== null) cancelAnimationFrame(pending);
      reconcile(); // Hidden documents suspend RAF; release maps immediately.
    } else queue();
  }
  const mutations = typeof MutationObserver === "function" ? new MutationObserver(records => {
    if (records.some(record => record.target !== pressTarget && (!(record.target instanceof Element) || !record.target.closest(".liquid-optics")))) queue();
  }) : null;
  mutations?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden"] });
  root.addEventListener("pointerdown", down, { passive: true });
  document.addEventListener("pointerup", up, { passive: true });
  document.addEventListener("pointercancel", up, { passive: true });
  window.addEventListener("blur", resetPress);
  document.addEventListener("visibilitychange", visibility);
  reduced?.addEventListener("change", preferences); opaque?.addEventListener("change", preferences);
  queue();
  const destroy = () => {
    if (disposed) return;
    disposed = true; mutations?.disconnect(); intersection?.disconnect(); resize?.disconnect();
    if (pending !== null) cancelAnimationFrame(pending);
    pending = null; resetPress();
    root.removeEventListener("pointerdown", down); document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", up); window.removeEventListener("blur", resetPress);
    document.removeEventListener("visibilitychange", visibility);
    reduced?.removeEventListener("change", preferences); opaque?.removeEventListener("change", preferences);
    for (const surface of [...surfaces.values()]) remove(surface);
    if (oldScope === null) root.removeAttribute("data-liquid-scope"); else root.setAttribute("data-liquid-scope", oldScope);
    if (installed.get(root) === destroy) installed.delete(root);
  };
  installed.set(root, destroy);
  return destroy;
}
