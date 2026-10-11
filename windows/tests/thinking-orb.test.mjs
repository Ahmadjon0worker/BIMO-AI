import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fakedom.mjs';
import {
  ORB_STATES, botStateToOrbState, createThinkingOrb, drawThinkingOrb,
  orbStateForStatus, thinkingOrbFrame,
} from '../src/effects/thinking-orb.ts';
import { resolvePreset } from '../src/vendor/thinking-orbs/engine/index.ts';

const golden = JSON.parse(readFileSync(new URL('../src/vendor/thinking-orbs/golden-samples.json', import.meta.url), 'utf8'));

test('all nine orb states retain upstream geometry at both sizes and four reference times', () => {
  assert.equal(ORB_STATES.length, 9);
  assert.equal(golden.cases.length, 72);
  for (const c of golden.cases) {
    const preset = resolvePreset(c.state, c.size);
    assert.deepEqual(preset, golden.resolved[`${c.state}-${c.size}`]);
    const frame = thinkingOrbFrame(c.state, c.size, c.t / preset.speed);
    assert.equal(frame.dots.length, c.dotCount, c.key);
    assert.equal(frame.lines.length, c.lineCount, c.key);
    let previousZ = -Infinity;
    for (const d of frame.dots) {
      assert.ok([d.x, d.y, d.z, d.r, d.white, d.a ?? 1].every(Number.isFinite), c.key);
      assert.ok(d.z >= previousZ && d.r > 0, c.key);
      previousZ = d.z;
    }
    for (const [i, ...expected] of c.dots) {
      const d = frame.dots[i];
      const values = [d.x, d.y, d.z, d.r, d.white, d.a ?? 1];
      const matches = values.every((v, j) => Math.abs(v - expected[j]) <= golden.tolerance);
      // A face-on ring has tied depths. Dividing then multiplying by speed
      // can change the last floating point bit and reorder those ties.
      const tiedMark = !matches && c.state === 'breathing' && Math.abs(d.z - expected[2]) <= golden.tolerance &&
        frame.dots.some(mark => [mark.x, mark.y, mark.z, mark.r, mark.white, mark.a ?? 1]
          .every((v, j) => Math.abs(v - expected[j]) <= golden.tolerance));
      assert.ok(matches || tiedMark, `${c.key} dot ${i} retains the upstream mark`);
    }
    for (const [i, ...expected] of c.lines) {
      const l = frame.lines[i];
      const values = [l.x1, l.y1, l.x2, l.y2, l.white, l.a ?? 1, l.w];
      values.forEach((v, j) => assert.ok(Math.abs(v - expected[j]) <= golden.tolerance, `${c.key} line ${i} field ${j}`));
    }
  }
});

test('companion, chat, Telegram, and voice status map without changing the task status', () => {
  const botStates = ['idle', 'working', 'thinking', 'searching', 'approval', 'question', 'error', 'finished', 'ratelimit', 'sleeping', 'dizzy'];
  for (const state of botStates) assert.ok(ORB_STATES.includes(botStateToOrbState(state)));
  assert.equal(botStateToOrbState('thinking'), 'solving');
  assert.equal(orbStateForStatus(' recording '), 'listening');
  assert.equal(orbStateForStatus('transcribing'), 'solving');
  assert.equal(orbStateForStatus('speaking'), 'composing');
  assert.equal(orbStateForStatus('reconnecting'), 'connecting');
  assert.equal(orbStateForStatus('connected'), 'breathing');
  assert.equal(orbStateForStatus('searching'), 'searching');
  assert.equal(orbStateForStatus('constructor'), 'breathing');
  assert.equal(orbStateForStatus('unexpected service response'), 'breathing');
});

function fakeContext() {
  return {
    paints: 0, saves: 0, restores: 0, arcs: [], colors: [], transform: null,
    setTransform(...values) { this.transform = values; },
    clearRect() { this.paints++; this.arcs = []; this.colors = []; },
    save() { this.saves++; }, restore() { this.restores++; },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    arc(...values) { this.arcs.push(values); },
    fill() { this.colors.push(this.fillStyle); },
  };
}

function lifecycleHarness() {
  installFakeDom();
  const original = new Map(['IntersectionObserver', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'devicePixelRatio', 'getComputedStyle']
    .map(key => [key, globalThis[key]]));
  const pending = new Map(), listeners = new Map(), contexts = [], observers = [];
  let serial = 0;
  const media = Object.fromEntries(['(prefers-reduced-motion: reduce)', '(prefers-color-scheme: dark)'].map(query => [query, {
    matches: query.includes('dark'), listeners: new Set(),
    addEventListener(_name, fn) { this.listeners.add(fn); },
    removeEventListener(_name, fn) { this.listeners.delete(fn); },
    change(matches) { this.matches = matches; for (const fn of this.listeners) fn(); },
  }]));
  document.visibilityState = 'visible';
  document.documentElement = document.createElement('html');
  document.addEventListener = (name, fn) => listeners.set(name, fn);
  document.removeEventListener = (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); };
  const createElement = document.createElement;
  document.createElement = tag => {
    const el = createElement(tag);
    if (tag === 'canvas') {
      const ctx = fakeContext(); contexts.push(ctx);
      el.isConnected = false; el.getContext = () => ctx;
    }
    return el;
  };
  globalThis.requestAnimationFrame = fn => { pending.set(++serial, fn); return serial; };
  globalThis.cancelAnimationFrame = id => pending.delete(id);
  globalThis.matchMedia = query => media[query];
  globalThis.getComputedStyle = () => ({ colorScheme: 'dark' });
  globalThis.devicePixelRatio = 4;
  globalThis.IntersectionObserver = class {
    constructor(fn) { this.fn = fn; this.elements = new Set(); this.disconnected = false; observers.push(this); }
    observe(el) { this.elements.add(el); }
    unobserve(el) { this.elements.delete(el); }
    disconnect() { this.disconnected = true; this.elements.clear(); }
    show(el, visible = true) { this.fn([{ target: el, isIntersecting: visible }]); }
  };
  globalThis.MutationObserver = class {
    constructor(fn) { this.fn = fn; this.disconnected = false; observers.push(this); }
    observe() {} disconnect() { this.disconnected = true; }
  };
  return {
    pending, listeners, contexts, media, observers,
    frame(time) {
      assert.equal(pending.size, 1, 'one shared RAF');
      const [id, fn] = pending.entries().next().value; pending.delete(id); fn(time);
    },
    restore() {
      for (const [key, value] of original) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
      }
    },
  };
}

test('multiple mounted orbs share one clock and pause when hidden, offscreen, or detached', () => {
  const env = lifecycleHarness(), orbs = [];
  try {
    orbs.push(createThinkingOrb({ size: 64 }), createThinkingOrb({ size: 64 }));
    assert.equal(env.observers.length, 2, 'shared intersection and mutation observers');
    assert.equal(env.pending.size, 0, 'unmounted canvases do not loop');
    for (const orb of orbs) {
      orb.el.isConnected = true; env.observers[0].show(orb.el);
    }
    assert.equal(env.pending.size, 1);
    env.frame(1234);
    assert.deepEqual(env.contexts[0].arcs, env.contexts[1].arcs, 'same state shares exactly the same frame time');
    assert.equal(orbs[0].el.width, 128, 'DPR is capped at two');
    assert.deepEqual(env.contexts[0].transform, [2, 0, 0, 2, 0, 0]);
    orbs[0].setVisible(false);
    env.observers[0].show(orbs[1].el, false);
    assert.equal(env.pending.size, 0);
    env.observers[0].show(orbs[1].el);
    assert.equal(env.pending.size, 1);
    document.visibilityState = 'hidden'; env.listeners.get('visibilitychange')();
    assert.equal(env.pending.size, 0);
    const paints = env.contexts.map(ctx => ctx.paints);
    orbs[0].setState('searching'); orbs[1].setState('listening');
    assert.deepEqual(env.contexts.map(ctx => ctx.paints), paints, 'no hidden drawing');
    document.visibilityState = 'visible'; env.listeners.get('visibilitychange')();
    env.frame(2000);
    orbs[1].el.isConnected = false; env.observers[1].fn();
    assert.equal(env.pending.size, 0);
    orbs[1].el.isConnected = true; env.observers[1].fn();
    assert.equal(env.pending.size, 1, 'mount observer resumes an attached canvas');
    for (const orb of orbs) orb.destroy();
    assert.equal(env.pending.size, 0);
    assert.equal(env.listeners.size, 0);
    assert.ok(env.observers.every(observer => observer.disconnected));
    assert.ok(Object.values(env.media).every(mq => mq.listeners.size === 0));
    orbs[1].setVisible(true); orbs[1].setState('working');
    assert.equal(env.pending.size, 0, 'disposed objects never restart');
  } finally {
    for (const orb of orbs) orb.destroy(); env.restore();
  }
});

test('reduced motion shows deterministic live states and follows host theme without an RAF', () => {
  const env = lifecycleHarness();
  let orb;
  try {
    env.media['(prefers-reduced-motion: reduce)'].matches = true;
    env.media['(prefers-color-scheme: dark)'].matches = false;
    orb = createThinkingOrb({ state: 'working', size: 20 });
    document.documentElement.append(orb.el); orb.el.isConnected = true;
    env.observers[0].show(orb.el);
    const ctx = env.contexts[0];
    assert.equal(env.pending.size, 0); assert.ok(ctx.paints > 0);
    const expectedDark = fakeContext();
    drawThinkingOrb(expectedDark, { state: 'working', size: 20, time: .6, dark: true });
    assert.deepEqual(ctx.colors, expectedDark.colors, 'host CSS dark scheme takes precedence over light OS');
    const staticFrame = structuredClone(ctx.arcs);
    env.observers[1].fn();
    assert.deepEqual(ctx.arcs, staticFrame);
    orb.setState('listening');
    assert.equal(orb.el.dataset.orbState, 'listening');
    assert.equal(orb.el.getAttribute('aria-label'), 'Tinglamoqda');
    assert.notDeepEqual(ctx.arcs, staticFrame);
    const darkColors = [...ctx.colors];
    document.documentElement.setAttribute('data-theme', 'light'); env.observers[1].fn();
    assert.notDeepEqual(ctx.colors, darkColors, 'ancestor theme overrides system theme');
    assert.equal(env.pending.size, 0);
    env.media['(prefers-reduced-motion: reduce)'].change(false);
    assert.equal(env.pending.size, 1);
    env.media['(prefers-reduced-motion: reduce)'].change(true);
    assert.equal(env.pending.size, 0);
    assert.equal(ctx.saves, ctx.restores, 'pure painter preserves caller context');
  } finally { orb?.destroy(); env.restore(); }
});

test('pure orb paint has transparent canvas output, keeps depth, and accepts optional agent ink', () => {
  const base = fakeContext(), tinted = fakeContext();
  const options = { state: 'connecting', size: 64, time: 1.7, dark: true };
  drawThinkingOrb(base, options); drawThinkingOrb(tinted, { ...options, accent: '#2DD4BF' });
  assert.equal(base.paints, 0, 'shared renderer does not erase Moshi or fill a background');
  assert.deepEqual(base.arcs, tinted.arcs, 'accent does not alter geometry or dot radii');
  assert.notDeepEqual(base.colors, tinted.colors);
  assert.equal(new Set(tinted.colors).size > 1, true, 'tinted dots retain depth shading');
  assert.equal(tinted.saves, 1); assert.equal(tinted.restores, 1);
});
