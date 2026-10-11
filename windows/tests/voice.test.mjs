import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({ load(url, context, next) {
  if (/\/src\/core\/voice(?:-mic)?\.ts$/.test(url)) return {
    format: 'module', shortCircuit: true,
    source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }),
  };
  return next(url, context);
} });
const { normalizeVoice, voiceCommandText, parseVoiceIntent, pcmWav, audioBase64, VoiceController } = await import('../src/core/voice.ts');
const { VoiceMic } = await import('../src/core/voice-mic.ts');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const ready = (extra = {}) => ({ ok: true, voice_api: 1, available: true, halted: false, busy: false,
  model: 'fixture-whisper', tts_available: false, reason: '', ...extra });
const transcript = (text = 'panelni och', extra = {}) => ({ ok: true, voice_api: 1, execution_performed: false, language: 'uz', text, ...extra });
const wav = () => pcmWav(new Float32Array(16000).fill(.1), 16000);
function transport(overrides = {}) {
  const calls = [];
  return { calls, adapter: {
    status: async () => { calls.push(['status']); return ready(); },
    transcribe: async (args) => { calls.push(['transcribe', args]); return transcript(); },
    cancel: async () => { calls.push(['cancel']); return { cancelled: true }; },
    ...overrides,
  } };
}

test('voice normalization preserves Uzbek meaning across Cyrillic and apostrophe variants', () => {
  assert.equal(normalizeVoice('  ҲАММАСИНИ ТЎХТАТ!  '), "hammasini to'xtat");
  assert.equal(normalizeVoice('Telegramni koʻrsat.'), "telegramni ko'rsat");
  assert.deepEqual(parseVoiceIntent('СОЗЛАМАЛАРНИ ОЧ!'), { kind: 'ui', target: 'settings' });
});
test('wake mode accepts only a complete wake prefix and preserves exact message body', () => {
  assert.equal(voiceCommandText('Hey Coucou, panelni och!', true), 'panelni och!');
  assert.equal(voiceCommandText('OK Qanot AI, panelni och!', true), 'panelni och!');
  assert.equal(voiceCommandText('Salom Qanot: @fixture_user ga “Salom!” yubor', true), '@fixture_user ga “Salom!” yubor');
  assert.equal(voiceCommandText('ОК Канот, панелни оч', true), 'панелни оч');
  assert.equal(voiceCommandText('KUKU: @fixture_user ga “Panelni yop!” yubor', true), '@fixture_user ga “Panelni yop!” yubor');
  for (const text of ['panelni och', 'kukuing panelni och', 'Coucou', 'salom', 'qanotli panelni och', 'Qanot AI']) assert.equal(voiceCommandText(text, true), null, text);
  assert.equal(voiceCommandText('Куку, панелни оч', true), 'панелни оч');
});
test('exact UI phrases are separate from quoted Telegram bodies and negative requests', () => {
  assert.deepEqual(parseVoiceIntent('panelni yop'), { kind: 'ui', target: 'panel-close' });
  for (const text of ['panelni ochma', 'terminalni ochma', 'hammasini to‘xtatma', '@fixture_user ga salom yuborma', "don't send @fixture_user hello", 'не отправляй @fixture_user привет']) {
    const intent = parseVoiceIntent(text);
    assert.ok(!['ui', 'telegram', 'terminal'].includes(intent.kind), `${text}: ${JSON.stringify(intent)}`);
  }
  const query = '@fixture_user ga “Panelni yop, hammasini to‘xtat, salom yuborma!” yubor';
  assert.deepEqual(parseVoiceIntent(query), { kind: 'telegram', query });
  assert.deepEqual(parseVoiceIntent('Coucou ' + query), { kind: 'telegram', query });
  assert.equal(parseVoiceIntent('“panelni och”').kind, 'help');
});
test('selected-recipient messaging requires explicit send and no recipient makes it non-actionable', () => {
  assert.deepEqual(parseVoiceIntent('salom yubor', true), { kind: 'telegram', query: 'salom yubor' });
  assert.equal(parseVoiceIntent('salom yubor', false).kind, 'help');
  assert.equal(parseVoiceIntent('shunga yuborma', true).kind, 'help');
});
test('terminal parser retains literal Unicode script and other tasks produce plans only', () => {
  const script = "Write-Output 'Salom 🤝'\nGet-Location";
  assert.deepEqual(parseVoiceIntent('PowerShell orqali: ' + script), { kind: 'terminal', shell: 'powershell', script });
  assert.deepEqual(parseVoiceIntent('CMD — ver'), { kind: 'terminal', shell: 'cmd', script: 'ver' });
  assert.equal(parseVoiceIntent('Github issue yaratish rejasini tuz').kind, 'plan');
  assert.equal(parseVoiceIntent('desktop tugmalarini tekshir').kind, 'plan');
  assert.deepEqual(parseVoiceIntent('github holatini ko‘rsat'), { kind: 'github', operation: 'status' });
});
test('malformed, oversized and unknown spoken text is not an action', () => {
  for (const text of ['', '\0panelni och', 'x'.repeat(4001), 'nima gap']) assert.equal(parseVoiceIntent(text).kind, 'help');
});
test('WAV is little-endian mono PCM16 at 16kHz with exact header and clipped signed samples', () => {
  const encoded = pcmWav(new Float32Array([-2, -1, -.5, 0, .5, 1, 2, NaN, Infinity]), 16000);
  const view = new DataView(encoded.buffer), ascii = (at, length) => String.fromCharCode(...encoded.subarray(at, at + length));
  assert.equal(ascii(0, 4), 'RIFF'); assert.equal(ascii(8, 4), 'WAVE'); assert.equal(ascii(12, 4), 'fmt '); assert.equal(ascii(36, 4), 'data');
  assert.equal(view.getUint32(4, true), encoded.length - 8); assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1); assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint32(28, true), 32000);
  assert.equal(view.getUint16(32, true), 2); assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), encoded.length - 44);
  assert.deepEqual(Array.from({ length: 9 }, (_, i) => view.getInt16(44 + i * 2, true)), [-32768, -32768, -16384, 0, 16384, 32767, 32767, 0, 0]);
});
test('downsampling averages each interval rather than keeping its first loud sample', () => {
  const encoded = pcmWav(new Float32Array([1, -1, 0, .3, .3, .3]), 48000);
  const view = new DataView(encoded.buffer);
  assert.equal(encoded.length, 48); assert.equal(view.getInt16(44, true), 0);
  assert.ok(Math.abs(view.getInt16(46, true) - Math.round(.3 * 32767)) <= 1);
});
test('15-second audio boundary and base64 byte cap are exact; invalid rates/duration are rejected', () => {
  const encoded = pcmWav(new Float32Array(16000 * 15), 16000);
  assert.equal(encoded.length, 480044); assert.equal(Buffer.from(audioBase64(encoded), 'base64').length, 480044);
  assert.throws(() => audioBase64(new Uint8Array(480045)), /15/);
  for (const rate of [0, 15999, 192001, NaN, Infinity]) assert.throws(() => pcmWav(new Float32Array(10), rate));
  assert.throws(() => pcmWav(new Float32Array(0), 16000));
  assert.throws(() => pcmWav(new Float32Array(240001), 16000));
});
test('voice status rejects incompatible protocol and unavailable/halted status never dispatches audio', async () => {
  for (const status of [ready({ available: false }), ready({ halted: true }), ready({ voice_api: 2 }), { ok: false }]) {
    const t = transport({ status: async () => status }); const c = new VoiceController(t.adapter);
    await c.refresh(); assert.equal(await c.transcribe(wav(), 'uz'), null);
    assert.ok(!t.calls.some(([name]) => name === 'transcribe'));
  }
});
test('busy transcription cannot duplicate dispatch and invalid response never becomes executable text', async () => {
  const response = deferred(); let dispatched = 0;
  const t = transport({ transcribe: async () => { dispatched++; return response.promise; } });
  const c = new VoiceController(t.adapter); await c.refresh(); const first = c.transcribe(wav(), 'uz');
  assert.equal(c.busy, true); assert.equal(await c.transcribe(wav(), 'uz'), null); assert.equal(dispatched, 1);
  response.resolve(transcript('panelni och', { execution_performed: true }));
  assert.equal(await first, null); assert.equal(c.text, ''); assert.ok(c.error); assert.equal(c.busy, false);
});
test('transcription payload is bounded PCM and uniquely identified; response must match language', async () => {
  const t = transport(); const c = new VoiceController(t.adapter); await c.refresh();
  assert.equal(await c.transcribe(wav(), 'uz'), 'panelni och');
  const sent = t.calls.find(([name]) => name === 'transcribe')[1];
  assert.equal(sent.language, 'uz'); assert.match(sent.request_id, /^[a-f0-9-]{36}$/i);
  assert.equal(Buffer.from(sent.audio_base64, 'base64').subarray(0, 4).toString(), 'RIFF');
  const bad = transport({ transcribe: async () => transcript('stop', { language: 'en' }) });
  const other = new VoiceController(bad.adapter); await other.refresh();
  assert.equal(await other.transcribe(wav(), 'uz'), null); assert.equal(other.text, '');
});
test('invalidate cancels transcription and late success or error cannot restore text', async () => {
  for (const reject of [false, true]) {
    const response = deferred(); const t = transport({ transcribe: async () => response.promise });
    const c = new VoiceController(t.adapter); await c.refresh(); const pending = c.transcribe(wav(), 'uz'); await flush();
    c.invalidate(); reject ? response.reject(new Error('late private text')) : response.resolve(transcript('stop'));
    assert.equal(await pending, null); assert.equal(c.text, ''); assert.equal(c.error, '');
    assert.equal(t.calls.filter(([name]) => name === 'cancel').length, 1);
  }
});
test('cancelling an in-flight transcript never dispatches a retry and a later explicit request stays separate', async () => {
  const old = deferred(); let requests = 0;
  const t = transport({ transcribe: async () => ++requests === 1 ? old.promise : transcript('telegramni och') });
  const c = new VoiceController(t.adapter); await c.refresh(); const pending = c.transcribe(wav(), 'uz'); await flush();
  c.invalidate(); await flush(); assert.equal(requests, 1, 'cancel must never replay audio');
  old.resolve(transcript('stop')); assert.equal(await pending, null); assert.equal(c.text, '');
  assert.equal(await c.transcribe(wav(), 'uz'), 'telegramni och'); assert.equal(requests, 2);
});

test('queued cancellation finishes before a new transcript dispatch and invalidation before dispatch sends no audio', async () => {
  const cancellation = deferred(); let requests = 0;
  const t = transport({ cancel: async () => cancellation.promise, transcribe: async () => { requests++; return transcript(); } });
  const c = new VoiceController(t.adapter); await c.refresh(); c.invalidate();
  const pending = c.transcribe(wav(), 'uz'); await flush(); assert.equal(requests, 0); assert.equal(c.busy, true);
  cancellation.resolve({ cancelled: true }); assert.equal(await pending, 'panelni och'); assert.equal(requests, 1);
  const stale = c.transcribe(wav(), 'uz'); c.invalidate(); assert.equal(await stale, null); await flush();
  assert.equal(requests, 1, 'an invalidated queued request must not reach the backend');
});
test('status started before Stop cannot overwrite the fresh halted status', async () => {
  const old = deferred(); let requests = 0;
  const t = transport({ status: async () => ++requests === 1 ? old.promise : ready({ halted: true }) });
  const c = new VoiceController(t.adapter); const pending = c.refresh(); c.invalidate(); await c.refresh();
  old.resolve(ready()); await pending;
  assert.equal(c.status.halted, true, 'old ready status must not resurrect Start after Stop');
});

let savedNavigator, savedAudio, contexts, resumes;
class MicAudio {
  sampleRate = 48000; destination = {}; closed = 0; resumed = 0;
  constructor() { contexts.push(this); this.pendingResume = resumes.shift(); }
  resume() { this.resumed++; return this.pendingResume?.promise ?? Promise.resolve(); }
  close() { this.closed++; return Promise.resolve(); }
  createMediaStreamSource() { return { connect() {} }; }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  createScriptProcessor() { return this.processor = { onaudioprocess: null, connect() {}, disconnect() {} }; }
}
const stream = () => { const track = { stops: 0, stop() { this.stops++; } }; return { track, getTracks: () => [track] }; };
function microphone(getUserMedia = async () => stream()) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
  const delivered = []; const mic = new VoiceMic(value => delivered.push(value)); return { mic, delivered };
}
function feed(context, count, level = .03) {
  const chunk = new Float32Array(count).fill(level);
  context.processor.onaudioprocess({ inputBuffer: { getChannelData: () => chunk } });
}
beforeEach(() => {
  savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); savedAudio = globalThis.AudioContext;
  contexts = []; resumes = []; globalThis.AudioContext = MicAudio;
});
afterEach(() => {
  if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator); else delete globalThis.navigator;
  globalThis.AudioContext = savedAudio;
});
test('late microphone permission after Stop stops its tracks and never constructs recording context', async () => {
  const permission = deferred(), input = stream(); const { mic, delivered } = microphone(() => permission.promise);
  const opening = mic.start(); mic.stop(); permission.resolve(input); await opening;
  assert.equal(input.track.stops, 1); assert.equal(mic.recording, false); assert.equal(contexts.length, 0); assert.equal(delivered.length, 0);
});
test('missing API and denied microphone permission never create audio context or deliver a recording', async () => {
  const denied = microphone(async () => { throw new Error('Permission denied'); });
  await assert.rejects(denied.mic.start(), /Permission denied/);
  assert.equal(denied.mic.recording, false); assert.equal(contexts.length, 0); assert.equal(denied.delivered.length, 0);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  await assert.rejects(denied.mic.start(), /Mikrofon/); assert.equal(contexts.length, 0);
});
test('out-of-order microphone permission cannot replace or stop the newest recording', async () => {
  const first = deferred(), second = deferred(), a = stream(), b = stream(); let requests = 0;
  const { mic } = microphone(() => ++requests === 1 ? first.promise : second.promise);
  const oldStart = mic.start(), newStart = mic.start(); second.resolve(b); await newStart;
  first.resolve(a); await oldStart;
  assert.equal(a.track.stops, 1); assert.equal(b.track.stops, 0); assert.equal(mic.recording, true);
  mic.stop(); assert.equal(b.track.stops, 1);
});
test('old context resume success after Stop/new Start never tears down the replacement microphone', async () => {
  const oldResume = deferred(); resumes.push(oldResume); const a = stream(), b = stream(); let requests = 0;
  const { mic } = microphone(async () => ++requests === 1 ? a : b);
  const oldStart = mic.start(); await flush(); mic.stop(); await mic.start();
  oldResume.resolve(); await oldStart;
  assert.equal(mic.recording, true); assert.equal(b.track.stops, 0); assert.equal(contexts[1].closed, 0);
  mic.stop();
});
test('old context resume failure after Stop/new Start never tears down the replacement microphone', async () => {
  const oldResume = deferred(); resumes.push(oldResume); const a = stream(), b = stream(); let requests = 0;
  const { mic } = microphone(async () => ++requests === 1 ? a : b);
  const oldStart = mic.start().catch(() => {}); await flush(); mic.stop(); await mic.start();
  oldResume.reject(new Error('old resume failed')); await oldStart;
  assert.equal(mic.recording, true); assert.equal(b.track.stops, 0); assert.equal(contexts[1].closed, 0);
  mic.stop();
});
test('microphone stops after spoken audio followed by silence and delivers once', async () => {
  const input = stream(); const { mic, delivered } = microphone(async () => input); await mic.start();
  const context = contexts[0]; feed(context, 14400); feed(context, 57600, 0);
  assert.equal(mic.recording, false); assert.equal(delivered.length, 1); assert.equal(input.track.stops, 1); assert.equal(context.closed, 1);
  mic.finish(); assert.equal(delivered.length, 1);
  assert.equal(new DataView(delivered[0].buffer).getUint32(24, true), 16000);
});
test('microphone caps long chunks at exactly 15 seconds and drops silent or tiny audio', async () => {
  const { mic, delivered } = microphone(); await mic.start(); feed(contexts[0], 48000 * 16);
  assert.equal(delivered.length, 1); assert.equal(delivered[0].length, 480044); assert.equal(mic.recording, false);
  await mic.start(); feed(contexts[1], 12000, 0); mic.finish(); assert.equal(delivered.length, 1);
  await mic.start(); feed(contexts[2], 1000); mic.finish(); assert.equal(delivered.length, 1);
});
test('callback captured before Stop cannot deliver or append into a new recording', async () => {
  const { mic, delivered } = microphone(); await mic.start(); const callback = contexts[0].processor.onaudioprocess;
  mic.stop(); await mic.start(); callback({ inputBuffer: { getChannelData: () => new Float32Array(48000).fill(.03) } });
  assert.equal(delivered.length, 0); assert.equal(mic.level, 0); assert.equal(mic.recording, true); mic.stop();
});
