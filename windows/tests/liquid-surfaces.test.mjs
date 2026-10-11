import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";
import { installLiquidSurfaces, liquidConfig } from "../src/effects/liquid.ts";
import { LiquidGlassEngine } from "../src/vendor/quick-liquid/core/engine.ts";
import { rasterizeLens } from "../src/vendor/quick-liquid/core/optics.ts";

test("liquid optical surfaces pause hidden/offscreen work, preserve children and drag transforms, and dispose once", () => {
  installFakeDom();
  const pending = new Map(), timers = new Map(), radii = new Map(), configUpdates = [], docEvents = new Map(), winEvents = new Map(), queries = [], intersections = [], mutations = [];
  let serial = 0;
  const originalCreate = document.createElement;
  const sample = originalCreate("div"), proto = Object.getPrototypeOf(sample);
  proto.removeAttribute = function (key) { this.attributes.delete(key); };
  proto.removeEventListener = function (type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== fn)); };
  proto.contains = function (el) { return this === el || [...this.walk()].includes(el); };
  proto.prepend = function (el) { el.parentNode = this; this.childNodes.unshift(el); };
  proto.removeChild = function (el) { this.childNodes = this.childNodes.filter(node => node !== el); el.parentNode = null; return el; };
  proto.matches = function (selector) {
    return selector.split(",").some(part => {
      part = part.trim();
      if (part === ":disabled") return this.disabled === true;
      if (part.startsWith("[")) return this.getAttribute(part.slice(1, -1).split("=")[0]) !== null;
      if (part.startsWith("#")) return this.id === part.slice(1);
      if (part.startsWith(".")) return this.classList.contains(part.slice(1));
      return this.tagName.toLowerCase() === part;
    });
  };
  proto.querySelectorAll = function (selector) { return [...this.walk()].filter(el => el.matches(selector)); };
  proto.closest = function (selector) { for (let el = this; el; el = el.parentElement) if (el.matches(selector)) return el; return null; };
  proto.getClientRects = function () { return this.getAttribute("hidden") !== null ? [] : [{ width: 320, height: 180 }]; };
  Object.defineProperty(proto, "isConnected", { configurable: true, get() { return document.body.contains(this); } });
  document.createElement = tag => {
    const el = originalCreate(tag), values = new Map();
    el.style = {
      getPropertyValue: key => values.get(key)?.[0] ?? "",
      getPropertyPriority: key => values.get(key)?.[1] ?? "",
      setProperty: (key, value, priority = "") => values.set(key, [value, priority]),
      removeProperty: key => values.delete(key),
    };
    Object.defineProperties(el.style, {
      position: { get: () => el.style.getPropertyValue("position"), set: value => el.style.setProperty("position", value) },
      zIndex: { get: () => el.style.getPropertyValue("z-index"), set: value => el.style.setProperty("z-index", value) },
    });
    el.offsetWidth = 320; el.offsetHeight = 180;
    return el;
  };
  globalThis.Element = proto.constructor;
  globalThis.getComputedStyle = el => ({ position: el.style.position || "static", zIndex: el.style.zIndex || "auto", borderTopLeftRadius: `${radii.get(el) ?? 20}px`, borderTopRightRadius: `${radii.get(el) ?? 20}px`, borderBottomLeftRadius: `${radii.get(el) ?? 20}px`, borderBottomRightRadius: `${radii.get(el) ?? 20}px` });
  globalThis.requestAnimationFrame = fn => { pending.set(++serial, fn); return serial; };
  globalThis.cancelAnimationFrame = id => pending.delete(id);
  const timeout = globalThis.setTimeout, clearTimer = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, delay) => { assert.equal(delay, 90); timers.set(++serial, fn); return serial; };
  globalThis.clearTimeout = id => timers.delete(id);
  globalThis.matchMedia = () => {
    const query = { matches: false, handlers: new Set(), addEventListener(_name, fn) { this.handlers.add(fn); }, removeEventListener(_name, fn) { this.handlers.delete(fn); } };
    queries.push(query); return query;
  };
  globalThis.IntersectionObserver = class {
    constructor(fn) { this.fn = fn; this.targets = new Set(); intersections.push(this); }
    observe(el) { this.targets.add(el); } unobserve(el) { this.targets.delete(el); } disconnect() { this.targets.clear(); }
    fire(el, visible) { this.fn([{ target: el, isIntersecting: visible }]); }
  };
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.MutationObserver = class { constructor(fn) { this.fn = fn; mutations.push(this); } observe() {} disconnect() { this.disposed = true; } };
  document.hidden = false;
  document.addEventListener = (name, fn) => docEvents.set(name, fn);
  document.removeEventListener = (name, fn) => { if (docEvents.get(name) === fn) docEvents.delete(name); };
  window.addEventListener = (name, fn) => winEvents.set(name, fn);
  window.removeEventListener = (name, fn) => { if (winEvents.get(name) === fn) winEvents.delete(name); };
  const mount = LiquidGlassEngine.prototype.mount, updateConfig = LiquidGlassEngine.prototype.updateConfig;
  // Optics pixels are checked separately. This fixture isolates the adapter's
  // observer/ownership lifecycle without pretending Node renders SVG backdrops.
  LiquidGlassEngine.prototype.mount = function () {};
  LiquidGlassEngine.prototype.updateConfig = function (config) { configUpdates.push(config); };
  const frame = () => { const work = [...pending]; pending.clear(); for (const [, fn] of work) fn(serial * 16); };
  try {
    const root = document.createElement("div"), child = document.createElement("span");
    const view = document.createElement("div"), card = document.createElement("div");
    view.className = "view"; card.className = "card"; view.append(card);
    root.id = "island"; root.style.position = "absolute";
    root.style.setProperty("transform", "translate(-50%, 12px)", "important");
    root.setAttribute("data-liquid-scope", "previous"); root.append(child, view); document.body.append(root);
    const baseline = LiquidGlassEngine.collectMetrics().engineCount;
    const destroy = installLiquidSurfaces(root); frame();
    assert.equal(LiquidGlassEngine.collectMetrics().engineCount, baseline, "offscreen surfaces do not allocate maps");
    intersections[0].fire(root, true); frame();
    assert.equal(LiquidGlassEngine.collectMetrics().engineCount, baseline + 1);
    intersections[0].fire(card, true); frame();
    assert.equal(LiquidGlassEngine.collectMetrics().engineCount, baseline + 1, "inactive opacity-hidden tab does not allocate maps");
    view.classList.add("on"); mutations[0].fn([{ target: view }]); frame();
    assert.equal(LiquidGlassEngine.collectMetrics().engineCount, baseline + 2);
    view.classList.remove("on"); mutations[0].fn([{ target: view }]); frame();
    assert.equal(LiquidGlassEngine.collectMetrics().engineCount, baseline + 1);
    assert.equal(child.parentNode, root, "interactive content was not wrapped or moved");
    assert.deepEqual([root.style.getPropertyValue("transform"), root.style.getPropertyPriority("transform")], ["translate(-50%, 12px)", "important"]);
    for (const radius of [22, 24, 26, 28]) {
      radii.set(root, radius); mutations[0].fn([{ target: root }]); frame();
      assert.equal(configUpdates.length, 0, "animated docking does not reconfigure the optical map each frame");
      assert.equal(timers.size, 1, "only the final radius settle timer survives");
      assert.equal(root.firstChild.style.borderRadius, "inherit", "the corner clip follows the host immediately");
    }
    const settle = [...timers.values()][0]; timers.clear(); settle();
    assert.deepEqual(configUpdates, [{ borderRadius: 28 }], "one final optical update follows settled geometry");
    radii.set(root, 30); mutations[0].fn([{ target: root }]); frame();
    assert.equal(timers.size, 1);
    const originalShell = root.firstChild;
    originalShell.remove(); mutations[0].fn([{ target: root }]); frame();
    assert.equal(LiquidGlassEngine.collectMetrics().engineCount, baseline + 1, "a host refresh replaces detached optics without leaking an engine");
    assert.notEqual(root.firstChild, originalShell);
    assert.equal(timers.size, 0, "replacing a shell cancels its pending geometry timer");
    radii.set(root, 32); mutations[0].fn([{ target: root }]); frame();
    assert.equal(timers.size, 1);
    const button = document.createElement("button"); child.append(button);
    button.style.setProperty("scale", "1.02", "important");
    root.listeners.get("pointerdown")[0]({ target: button, button: 0 }); frame();
    assert.equal(pending.size, 1, "only the active press runs a spring");
    document.hidden = true; docEvents.get("visibilitychange")();
    assert.equal(LiquidGlassEngine.collectMetrics().engineCount, baseline, "hidden cleanup does not wait for suspended RAF");
    assert.equal(pending.size, 0);
    assert.equal(timers.size, 0, "hidden cleanup cancels pending geometry work");
    assert.deepEqual([button.style.getPropertyValue("scale"), button.style.getPropertyPriority("scale")], ["1.02", "important"], "hidden cleanup restores existing CSS scale");
    document.hidden = false; docEvents.get("visibilitychange")(); frame();
    assert.equal(LiquidGlassEngine.collectMetrics().engineCount, baseline + 1);
    queries[1].matches = true; for (const fn of queries[1].handlers) fn(); frame();
    assert.equal(LiquidGlassEngine.collectMetrics().engineCount, baseline, "reduced transparency releases optics");
    queries[1].matches = false; for (const fn of queries[1].handlers) fn(); frame();
    root.setAttribute("hidden", ""); mutations[0].fn([{ target: root }]); frame();
    assert.equal(LiquidGlassEngine.collectMetrics().engineCount, baseline);
    root.removeAttribute("hidden"); mutations[0].fn([{ target: root }]); frame();
    assert.equal(LiquidGlassEngine.collectMetrics().engineCount, baseline + 1);
    destroy(); destroy();
    assert.equal(LiquidGlassEngine.collectMetrics().engineCount, baseline);
    assert.equal(root.getAttribute("data-liquid-scope"), "previous");
    assert.equal(root.style.getPropertyValue("z-index"), "");
    assert.deepEqual(root.childNodes, [child, view]);
    assert.equal(pending.size, 0); assert.equal(docEvents.size, 0); assert.equal(winEvents.size, 0);
    assert.ok(queries.every(query => query.handlers.size === 0));
  } finally {
    LiquidGlassEngine.prototype.mount = mount; LiquidGlassEngine.prototype.updateConfig = updateConfig;
    globalThis.setTimeout = timeout; globalThis.clearTimeout = clearTimer;
  }
});

test("real optical field keeps a neutral clear center and refracts symmetrically at the rim", () => {
  const raster = rasterizeLens({ width: 120, height: 80, radius: 20, bezel: 16, thickness: 18, ior: 1.5, mapWidth: 120, mapHeight: 80, padding: 8 });
  const pixel = (x, y) => [...raster.data.slice(((y + raster.padY) * raster.width + x + raster.padX) * 4, ((y + raster.padY) * raster.width + x + raster.padX) * 4 + 4)];
  assert.deepEqual(pixel(60, 40), [128, 128, 0, 255]);
  const left = pixel(5, 40), right = pixel(114, 40);
  assert.notEqual(left[0], 128); assert.equal(left[0] + right[0], 256);
  assert.equal(liquidConfig("island", 20, true).parallax, false);
  assert.equal(liquidConfig("studio", 18).dispersionMode, "exact");
});
