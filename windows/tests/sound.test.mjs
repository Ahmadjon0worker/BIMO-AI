import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Bridge } from '../src/core/bridge.ts';
import { Sound, SOUND_NAMES } from '../src/core/sound.ts';

const saved = { fetch: globalThis.fetch, audio: window.AudioContext, own: Bridge.customSounds, bytes: Bridge.customSound };
let engine, fetched, played, files;
const bytes = (marker) => new Uint8Array([marker]).buffer;
class Audio {
  state = 'running'; destination = {};
  createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
  async decodeAudioData(raw) {
    const marker = new Uint8Array(raw)[0];
    if (marker === 255) throw new Error('invalid audio');
    return { marker };
  }
  createBufferSource() { return { connect() {}, start() { played.push(this.buffer.marker); } }; }
  async resume() { this.state = 'running'; }
}
beforeEach(() => {
  fetched = []; played = []; files = new Map();
  window.AudioContext = Audio;
  globalThis.fetch = async (path) => { fetched.push(path); return { ok: true, arrayBuffer: async () => bytes(1) }; };
  Bridge.customSounds = async () => [...files.keys()];
  Bridge.customSound = async (name) => files.get(name) ?? null;
  engine = new Sound.constructor();
});
afterEach(() => {
  globalThis.fetch = saved.fetch; window.AudioContext = saved.audio;
  Bridge.customSounds = saved.own; Bridge.customSound = saved.bytes;
});
test('custom audio replaces only that sound; preload shares its decode work', async () => {
  files.set('finish', bytes(2));
  await Promise.all([engine.preload(), engine.preload()]);
  assert.equal(fetched.length, SOUND_NAMES.length - 1);
  assert.ok(!fetched.includes('/sounds/finish.wav'));
  engine.play('finish'); engine.play('peek');
  assert.deepEqual(played, [2, 1]);
  assert.deepEqual([...engine.customized], ['finish']);
});
test('undecodable, empty and missing custom audio fall back to built-in sounds', async () => {
  files.set('finish', bytes(255)); files.set('approval', new ArrayBuffer(0)); files.set('greet', null);
  await engine.preload();
  engine.play('finish'); engine.play('approval'); engine.play('greet');
  assert.deepEqual(played, [1, 1, 1]);
  assert.equal(engine.customized.size, 0);
});
test('reload replaces changed audio and removal restores the built-in; mute still applies', async () => {
  files.set('finish', bytes(2)); await engine.preload();
  files.set('finish', bytes(3)); await engine.reload(); engine.play('finish');
  files.clear(); await engine.reload(); engine.play('finish');
  engine.setEnabled(false); engine.play('finish');
  assert.deepEqual(played, [3, 1]);
  assert.equal(engine.customized.size, 0);
});
test('unavailable custom sound bridge and missing built-ins do not break startup', async () => {
  Bridge.customSounds = async () => null;
  globalThis.fetch = async () => ({ ok: false });
  await engine.preload(); engine.play('finish');
  assert.deepEqual(played, []);
});
