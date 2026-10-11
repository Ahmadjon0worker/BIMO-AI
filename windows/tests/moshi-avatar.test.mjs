import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fakedom.mjs';
import { BotEngine } from '../src/mochi/engine.ts';
import { createMoshiAvatar } from '../src/mochi/avatar.ts';

test('Telegram animation pauses when its tab or document is hidden and disposes its listeners', () => {
  installFakeDom();
  const pending = new Map(), listeners = new Map();
  let serial = 0, draws = 0, updates = 0, reduced = false, lastBadge = null;
  const createElement = document.createElement;
  document.visibilityState = 'visible';
  document.createElement = tag => {
    const el = createElement(tag);
    if (tag === 'canvas') {
      el.isConnected = true;
      el.getContext = () => ({ setTransform() {}, clearRect() {} });
    }
    return el;
  };
  document.addEventListener = (name, fn) => listeners.set(name, fn);
  document.removeEventListener = (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); };
  globalThis.requestAnimationFrame = fn => { pending.set(++serial, fn); return serial; };
  globalThis.cancelAnimationFrame = id => pending.delete(id);
  window.matchMedia = () => ({ get matches() { return reduced; }, addEventListener() {}, removeEventListener() {} });
  const oldDraw = BotEngine.prototype.draw, oldUpdate = BotEngine.prototype.update;
  BotEngine.prototype.draw = function () { assert.equal(this.variant, 'telegram'); lastBadge = this.badgeS ? this.badge?.kind : null; draws++; };
  BotEngine.prototype.update = () => updates++;
  const nextFrame = time => { const [id, fn] = pending.entries().next().value; pending.delete(id); fn(time); };
  try {
    const avatar = createMoshiAvatar('telegram', 'Telegram Moshi');
    assert.equal(pending.size, 0);
    avatar.setVisible(true); nextFrame(10);
    assert.equal(draws, 1); assert.equal(pending.size, 1);
    avatar.setVisible(false); assert.equal(pending.size, 0);
    document.visibilityState = 'hidden'; avatar.setVisible(true); nextFrame(20);
    assert.equal(draws, 1); assert.equal(pending.size, 0);
    document.visibilityState = 'visible'; listeners.get('visibilitychange')(); nextFrame(30);
    assert.equal(draws, 2); assert.equal(pending.size, 1);
    reduced = true; listeners.get('visibilitychange')(); nextFrame(40);
    assert.equal(draws, 3); assert.equal(updates, 2); assert.equal(pending.size, 0);
    avatar.setState('error');
    assert.equal(lastBadge, 'dot'); assert.equal(pending.size, 0);
    avatar.destroy(); avatar.setVisible(true);
    assert.equal(pending.size, 0); assert.equal(listeners.size, 0);
  } finally {
    BotEngine.prototype.draw = oldDraw; BotEngine.prototype.update = oldUpdate;
    delete window.matchMedia;
  }
});
