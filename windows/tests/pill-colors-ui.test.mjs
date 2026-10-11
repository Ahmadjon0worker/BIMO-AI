import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fakedom.mjs';
import { colorDot } from '../src/settings/colors.ts';
import { setLanguage } from '../src/i18n/i18n.ts';

let documentEvents, windowEvents, picks, colors;
const fire = (el, type, event = {}) => {
  for (const handler of el.listeners.get(type) ?? []) handler({ preventDefault() {}, ...event });
};
beforeEach(() => {
  installFakeDom(); setLanguage('uz'); colors = {}; picks = [];
  window.innerWidth = 700; window.innerHeight = 560;
  documentEvents = new Map(); windowEvents = new Map();
  document.addEventListener = (type, fn) => documentEvents.set(type, fn);
  document.removeEventListener = (type) => documentEvents.delete(type);
  window.addEventListener = (type, fn) => windowEvents.set(type, fn);
  window.removeEventListener = (type) => windowEvents.delete(type);
  const create = document.createElement;
  document.createElement = (tag) => {
    const el = create(tag); el.offsetWidth = 300; el.offsetHeight = 36;
    el.getBoundingClientRect = () => ({ left: 30, bottom: 50 });
    el.contains = (node) => node === el || [...el.walk()].includes(node);
    return el;
  };
});
const dot = () => colorDot({ id: 'agent_codex', name: 'Codex', color: '#2DD4BF' }, '',
  () => colors, (next) => { colors = next; picks.push(next); });
test('keyboard opens the Uzbek palette; explicit choice persists only the chosen pill and closes it', () => {
  const control = dot();
  assert.equal(control.getAttribute('role'), 'button');
  assert.equal(control.getAttribute('aria-label'), 'Codex · Rang');
  fire(control, 'keydown', { key: 'Enter' });
  const palette = document.body.find('.palette')[0];
  assert.equal(palette.find('.swatch').length, 10);
  assert.equal(picks.length, 0, 'opening never saves a preference');
  const selected = palette.find('.swatch')[1]; fire(selected, 'click');
  assert.deepEqual(colors, { agent_codex: '#F4505E' });
  assert.equal(control.style.background, '#F4505E');
  assert.equal(document.body.find('.palette').length, 0);
  assert.equal(documentEvents.size, 0);
  fire(control, 'click');
  const reset = document.body.find('.reset')[0]; assert.equal(reset.textContent, 'Standart');
  fire(reset, 'click'); assert.deepEqual(colors, {});
  assert.equal(picks.length, 2);
});
test('Escape and outside click close the palette without changing any colours', () => {
  const control = dot(); fire(control, 'click');
  documentEvents.get('keydown')({ key: 'Escape' });
  assert.equal(document.body.find('.palette').length, 0);
  fire(control, 'keydown', { key: ' ' });
  documentEvents.get('mousedown')({ target: document.body });
  assert.equal(document.body.find('.palette').length, 0);
  assert.equal(picks.length, 0); assert.deepEqual(colors, {});
});
