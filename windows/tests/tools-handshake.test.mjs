import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolsHandshake } from '../src/core/tools-handshake.ts';
import { Bridge } from '../src/core/bridge.ts';
import { sent } from './tauri.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('a slow tools page restores native assistant visibility without an opening event or microphone effect', async () => {
  const handshake = new ToolsHandshake(), applied = [];
  await handshake.restore(async () => ({ visible: true, tab: 'assistant' }), s => applied.push(s));
  assert.deepEqual(applied, [{ visible: true, tab: 'assistant' }]);
  assert.equal(sent('local_ai_voice_transcribe').length, 0);
});
test('a newer tools event wins over a snapshot already in flight', async () => {
  const handshake = new ToolsHandshake(), wait = deferred(), applied = [];
  const restore = handshake.restore(() => wait.promise, s => applied.push(s));
  handshake.changed(); wait.resolve({ visible: true, tab: 'assistant' }); await restore;
  assert.deepEqual(applied, []);
});
test('pagehide discards late snapshot and can never reopen tools or record from a held key', async () => {
  const handshake = new ToolsHandshake(), wait = deferred(), applied = [];
  const restore = handshake.restore(() => wait.promise, s => applied.push(s));
  handshake.close(); wait.resolve({ visible: true, tab: 'voice', voice_held: true }); await restore;
  assert.deepEqual(applied, []);
});
test('native snapshot accepts only bounded display tabs and strict visibility', async () => {
  for (const state of [null, { visible: 'true', tab: 'voice' }, { visible: true, tab: 'desktop' }, { visible: true, tab: ['voice'] }, { visible: true, tab: { toString: () => 'voice' } }]) {
    await assert.rejects(new ToolsHandshake().restore(async () => state, () => assert.fail('invalid state applied')));
  }
});
test('opening voice persists the requested native tab rather than depending on a webview event', async () => {
  await Bridge.localAIOpenVoice();
  assert.deepEqual(sent('local_ai_open_tools').at(-1), { tab: 'voice' });
});
