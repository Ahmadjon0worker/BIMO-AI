import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installFakeDom } from './fakedom.mjs';
import { emit } from './tauri.mjs';

registerHooks({ load(url, context, next) {
  if (/\/src\/core\/voice(?:-mic)?\.ts$/.test(url)) return {
    format: 'module', shortCircuit: true,
    source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }),
  };
  return next(url, context);
} });
const { buildVoice } = await import('../src/tools/voice.ts');
const { Bridge } = await import('../src/core/bridge.ts');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const ready = extra => ({ ok: true, voice_api: 1, available: true, halted: false, busy: false, model: 'fixture-whisper', tts_available: false, reason: '', ...extra });
const preview = (id = 'fixture_preview', text = 'Salom 🤝\n<script>literal</script>') => ({
  kind: 'preview', text: 'Review this message.', source: 'literal',
  recipient: { chat_id: '123456789', title: 'Synthetic recipient', kind: 'user', username: 'test_user', is_self: false },
  preview: { id, chat_id: '123456789', recipient: 'Synthetic recipient', text, expires_in: 120, approval_required: true },
});
const sent = (id, status = 'sent') => ({ id, chat_id: '123456789', status, message_id: status === 'sent' ? 17 : null });
const byID = (view, id) => [...view.el.walk()].find(el => el.getAttribute('id') === id);
const originals = Object.fromEntries(Object.entries(Bridge));
let savedNavigator, savedAudio, contexts, streams, views;
class MockAudio {
  sampleRate = 48000; destination = {}; closed = 0;
  constructor() { contexts.push(this); }
  resume() { return Promise.resolve(); }
  close() { this.closed++; return Promise.resolve(); }
  createMediaStreamSource() { return { connect() {} }; }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  createScriptProcessor() { return this.processor = { onaudioprocess: null, connect() {}, disconnect() {} }; }
}
const stream = () => { const track = { stops: 0, stop() { this.stops++; } }; const value = { track, getTracks: () => [track] }; streams.push(value); return value; };
beforeEach(() => {
  installFakeDom(); contexts = []; streams = []; views = [];
  savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); savedAudio = globalThis.AudioContext;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => stream() } } });
  globalThis.AudioContext = MockAudio;
});
afterEach(async () => {
  for (const view of views) view.setVisible(false);
  await flush(); Object.assign(Bridge, originals);
  if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator); else delete globalThis.navigator;
  globalThis.AudioContext = savedAudio;
});
async function ui(extra = {}, voice = {}) {
  const effects = [], navigation = [], prefills = [];
  Object.assign(Bridge, {
    localAIAccountCommand: async (query, chat) => { effects.push(['command', query, chat]); return preview(); },
    localAIAccountSend: async id => { effects.push(['send', id]); return sent(id); },
    localAIAccountCancelDraft: async id => { effects.push(['cancel-preview', id]); return { cancelled: true }; },
    localAIAccountChats: async () => { effects.push(['chats']); return { limit: 30, chats: [
      { chat_id: '123456789', title: 'Synthetic recipient', kind: 'user', username: 'test_user', is_self: false, can_send: true, unread_count: 0 },
      { chat_id: '-100123', title: 'Read only', kind: 'channel', username: null, is_self: false, can_send: false, unread_count: 0 },
    ] }; },
    localAIToolboxCall: async (name, args) => { effects.push(['toolbox', name, args]); throw new Error('Unexpected tool effect'); },
    voicePanel: async expanded => { effects.push(['panel', expanded]); },
    localAIStop: async () => { effects.push(['stop']); },
    ...extra,
  });
  const transport = {
    status: async () => ready(),
    transcribe: async args => { effects.push(['transcribe', args]); return { ok: true, voice_api: 1, execution_performed: false, language: args.language, text: 'panelni och' }; },
    cancel: async () => { effects.push(['cancel-audio']); return { cancelled: true }; }, ...voice,
  };
  const view = buildVoice(tab => navigation.push(tab), (shell, script) => prefills.push({ shell, script }), transport);
  views.push(view); byID(view, 'voice-recipient').value = ''; byID(view, 'voice-command').value = '';
  view.setVisible(true); await view.refresh(); await flush(); return { view, effects, navigation, prefills };
}
async function capture(view) {
  byID(view, 'voice-record').fire('click'); await flush();
  const context = contexts.at(-1);
  context.processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(14400).fill(.03) } });
  byID(view, 'voice-finish').fire('click'); await flush();
}

test('voice opens with Uzbek readiness and no private chat, command or AI read', async () => {
  const { view, effects } = await ui();
  assert.match(view.el.textContent, /Ovozli boshqaruv/); assert.match(byID(view, 'voice-status').textContent, /fixture-whisper/);
  assert.equal(byID(view, 'voice-direct').checked, true); assert.equal(byID(view, 'voice-record').disabled, false);
  assert.deepEqual(effects, []); byID(view, 'voice-chats').fire('click'); await flush();
  assert.equal(effects[0][0], 'chats'); assert.equal(byID(view, 'voice-recipient').children.length, 2);
  assert.match(byID(view, 'voice-recipient').textContent, /test_user/);
});

test('changing voice language displays its installed model and only cancels old work', async () => {
  let statusReads = 0;
  const { view, effects, navigation, prefills } = await ui({}, { status: async () => {
    statusReads++;
    return ready({ model: 'navai-small-uz-q5_1', models_by_language: {
      uz: 'navai-small-uz-q5_1', en: 'small-q5_1', ru: 'small-q5_1',
    } });
  } });
  const language = byID(view, 'voice-language'), notice = byID(view, 'voice-status');
  assert.equal(language.value, 'uz');
  assert.match(notice.textContent, /Whisper navai-small-uz-q5_1/);
  assert.deepEqual(effects, []);
  view.controller.text = 'old synthetic transcript';
  language.value = 'ru'; language.fire('change'); await flush();
  assert.match(notice.textContent, /Whisper small-q5_1/);
  assert.doesNotMatch(notice.textContent, /navai/);
  assert.equal(view.controller.text, '');
  assert.deepEqual(effects, [['cancel-audio']]);
  language.value = 'uz'; language.fire('change'); await flush();
  assert.match(notice.textContent, /Whisper navai-small-uz-q5_1/);
  assert.deepEqual(effects, [['cancel-audio'], ['cancel-audio']]);
  assert.equal(statusReads, 1, 'switching an installed model needs no download or new service request');
  assert.equal(streams.length, 0); assert.equal(contexts.length, 0);
  assert.equal(view.mic.recording, false);
  assert.deepEqual(navigation, []); assert.deepEqual(prefills, []);
});

test('explicit Telegram command sends exact preview once and double clicks cannot duplicate in-flight send', async () => {
  const wait = deferred(); let dispatches = 0;
  const { view, effects } = await ui({ localAIAccountSend: async id => { dispatches++; return wait.promise; } });
  byID(view, 'voice-recipient').value = '123456789';
  const first = view.run('shu chatga salom yubor'); await flush();
  assert.equal(byID(view, 'voice-execute').disabled, true); assert.equal(dispatches, 1);
  await view.run('shu chatga salom yubor'); byID(view, 'voice-send').fire('click'); await flush();
  assert.equal(dispatches, 1); assert.deepEqual(effects.filter(e => e[0] === 'command'), [['command', 'shu chatga salom yubor', '123456789']]);
  wait.resolve(sent('fixture_preview')); await first;
  assert.match(byID(view, 'voice-result').textContent, /xabar yuborildi/); assert.equal(byID(view, 'voice-send').hidden, true);
});

test('unknown send remains visible, same fresh proof is blocked until explicit non-sending check', async () => {
  let commands = 0, sends = 0;
  const { view, effects } = await ui({
    localAIAccountCommand: async () => preview(`fixture_${++commands}`),
    localAIAccountSend: async id => { sends++; return sent(id, 'unknown'); },
  });
  await view.run('@test_user ga salom yubor'); assert.equal(sends, 1);
  assert.match(byID(view, 'voice-result').textContent, /noma’lum/); assert.equal(byID(view, 'voice-check').hidden, false);
  await view.run('@test_user ga salom yubor'); assert.equal(sends, 1);
  assert.ok(effects.some(e => e[0] === 'cancel-preview' && e[1] === 'fixture_2'));
  byID(view, 'voice-check').fire('click'); assert.equal(sends, 1); assert.equal(byID(view, 'voice-check').hidden, true);
  await view.run('@test_user ga salom yubor'); assert.equal(sends, 2);
});

test('lost send response consumes proof and is never retried on hide, re-open or manual send', async () => {
  let sends = 0; const { view } = await ui({ localAIAccountSend: async () => { sends++; throw new Error('Synthetic lost acknowledgment'); } });
  await view.run('@test_user ga salom yubor'); assert.equal(sends, 1);
  view.setVisible(false); view.setVisible(true); byID(view, 'voice-send').fire('click'); await flush();
  assert.equal(sends, 1); assert.equal(view.telegram.snapshot.result.status, 'unknown');
  assert.match(byID(view, 'voice-result').textContent, /noma’lum/);
});

test('manual review renders literal body and shows the explicit send outcome', async () => {
  const { view, effects } = await ui(); byID(view, 'voice-direct').checked = false;
  await view.run('@test_user ga salom yubor'); assert.equal(effects.some(e => e[0] === 'send'), false);
  assert.match(byID(view, 'voice-result').textContent, /<script>literal<\/script>/); assert.equal(view.el.find('SCRIPT').length, 0);
  assert.equal(byID(view, 'voice-send').hidden, false); byID(view, 'voice-send').fire('click'); await flush();
  assert.match(byID(view, 'voice-result').textContent, /xabari yuborildi/); assert.equal(effects.filter(e => e[0] === 'send').length, 1);
});

test('closing Voice during command response discards and cancels its late preview without sending', async () => {
  const wait = deferred(); const { view, effects } = await ui({ localAIAccountCommand: async () => wait.promise });
  byID(view, 'voice-command').value = 'private synthetic command'; const pending = view.run('@test_user ga salom yubor');
  view.setVisible(false); wait.resolve(preview('late_preview')); await pending; await flush();
  assert.equal(byID(view, 'voice-command').value, ''); assert.equal(view.telegram.snapshot.preview, null);
  assert.equal(effects.some(e => e[0] === 'send'), false); assert.ok(effects.some(e => e[0] === 'cancel-preview' && e[1] === 'late_preview'));
  assert.doesNotMatch(byID(view, 'voice-result').textContent, /Synthetic recipient|Salom/);
});

test('hiding an accepted manual preview clears private text and cancels its proof', async () => {
  const { view, effects } = await ui(); byID(view, 'voice-direct').checked = false;
  await view.run('@test_user ga salom yubor'); assert.match(byID(view, 'voice-result').textContent, /Synthetic recipient/);
  view.setVisible(false); view.setVisible(true); await flush();
  assert.equal(byID(view, 'voice-result').textContent, ''); assert.equal(view.telegram.snapshot.preview, null);
  assert.ok(effects.some(e => e[0] === 'cancel-preview' && e[1] === 'fixture_preview')); assert.equal(effects.some(e => e[0] === 'send'), false);
});

test('recipient change invalidates a pending command rather than retargeting its old message', async () => {
  const wait = deferred(); const { view, effects } = await ui({ localAIAccountCommand: async () => wait.promise });
  const recipient = byID(view, 'voice-recipient'); recipient.value = '123456789'; const pending = view.run('shu chatga salom yubor');
  recipient.value = '987654321'; recipient.fire('change'); wait.resolve(preview('old_recipient')); await pending; await flush();
  assert.equal(effects.some(e => e[0] === 'send'), false); assert.equal(view.telegram.snapshot.preview, null);
  assert.ok(effects.some(e => e[0] === 'cancel-preview' && e[1] === 'old_recipient'));
});

test('CMD and PowerShell handoff preserve literal Unicode and only navigate to a manual editor', async () => {
  const { view, effects, prefills, navigation } = await ui();
  const script = "echo Salom 🤝\necho <script>literal</script>";
  await view.run('CMD: ' + script); await view.run("PowerShell: Write-Output 'O‘qish'\nGet-Date");
  assert.deepEqual(prefills, [{ shell: 'cmd', script }, { shell: 'powershell', script: "Write-Output 'O‘qish'\nGet-Date" }]);
  assert.deepEqual(navigation, ['toolbox', 'toolbox']); assert.equal(effects.some(e => e[0] === 'toolbox'), false);
});

test('AI plan and GitHub status are explicit effects and a plan never runs its proposed script', async () => {
  const { view, effects, prefills } = await ui({ localAIToolboxCall: async (name, args) => {
    effects.push(['toolbox', name, args]);
    if (name === 'github_action') return { ok: true, operation: args.operation, exit_code: 0, timed_out: false, stdout: 'Synthetic gh status', stderr: '', output_truncated: false };
    return { ok: true, domain: args.domain, task: args.task, shell: 'powershell', provider: null, model: null, execution_performed: false,
      proposal: { summary: 'Synthetic plan <img src=x>', steps: [{ title: 'Review', description: 'Inspect first', script: 'Write-Output fixture' }] } };
  } });
  await view.run('GitHub holatini ko‘rsat'); assert.match(byID(view, 'voice-result').textContent, /Synthetic gh status/);
  await view.run('terminal uchun reja tuz'); assert.match(byID(view, 'voice-result').textContent, /Write-Output fixture/);
  assert.deepEqual(effects.filter(e => e[0] === 'toolbox').map(e => e[1]), ['github_action', 'ai_plan']); assert.deepEqual(prefills, []);
});

test('mock microphone transcription requires wake phrase in continuous mode and typed button remains explicit', async () => {
  const { view, effects } = await ui(); byID(view, 'voice-wake').checked = true;
  await capture(view); assert.equal(effects.some(e => e[0] === 'panel'), false);
  assert.match(byID(view, 'voice-result').textContent, /Wake iborasi/); assert.equal(view.mic.recording, true);
  view.stop(); await view.run('panelni och'); assert.ok(effects.some(e => e[0] === 'panel' && e[1] === true));
});

test('wake-prefixed mock transcript sends once and does not restart while a review is pending', async () => {
  const { view, effects } = await ui({}, { transcribe: async args => ({ ok: true, voice_api: 1, execution_performed: false, language: args.language, text: 'OK Coucou, @test_user ga salom yubor' }) });
  byID(view, 'voice-wake').checked = true; byID(view, 'voice-direct').checked = false; await capture(view);
  assert.equal(view.telegram.snapshot.preview?.preview.id, 'fixture_preview'); assert.equal(view.mic.recording, false);
  assert.equal(effects.some(e => e[0] === 'send'), false); byID(view, 'voice-send').fire('click'); await flush();
  assert.equal(effects.filter(e => e[0] === 'send').length, 1);
});

test('denied microphone permission is a visible error and old denial cannot poison a replacement recording', async () => {
  const old = deferred(); let requests = 0;
  const { view } = await ui(); navigator.mediaDevices.getUserMedia = () => ++requests === 1 ? old.promise : Promise.resolve(stream());
  byID(view, 'voice-record').fire('click'); await flush(); view.stop(); byID(view, 'voice-record').fire('click'); await flush();
  old.reject(new Error('Old permission denied')); await flush(); assert.equal(view.mic.recording, true); assert.equal(view.controller.error, '');
  view.stop(); navigator.mediaDevices.getUserMedia = async () => { throw new Error('Synthetic permission denied'); };
  byID(view, 'voice-record').fire('click'); await flush(); assert.match(byID(view, 'voice-status').textContent, /Synthetic permission denied/);
  assert.equal(view.mic.recording, false);
  navigator.mediaDevices.getUserMedia = async () => stream(); byID(view, 'voice-record').fire('click'); await flush();
  assert.equal(view.mic.recording, true); assert.match(byID(view, 'voice-status').textContent, /Mikrofon yoqilgan/);
});

test('pending permission disables record and hide releases its late stream without restarting', async () => {
  const permission = deferred(), input = stream(); const { view } = await ui(); navigator.mediaDevices.getUserMedia = () => permission.promise;
  byID(view, 'voice-record').fire('click'); await flush(); assert.equal(byID(view, 'voice-record').disabled, true);
  view.setVisible(false); permission.resolve(input); await flush();
  assert.equal(input.track.stops, 1); assert.equal(view.mic.recording, false); assert.equal(contexts.length, 0);
});

test('tab hide releases microphone and stale transcript cannot send or navigate', async () => {
  const transcript = deferred(); const { view, effects, navigation } = await ui({}, { transcribe: async () => transcript.promise });
  await capture(view); view.setVisible(false); transcript.resolve({ ok: true, voice_api: 1, execution_performed: false, language: 'uz', text: '@test_user ga salom yubor' }); await flush();
  assert.equal(streams[0].track.stops, 1); assert.equal(contexts[0].closed, 1); assert.equal(view.mic.recording, false);
  assert.equal(effects.some(e => e[0] === 'command' || e[0] === 'send'), false); assert.deepEqual(navigation, []); assert.equal(byID(view, 'voice-command').value, '');
});

test('Stop and external Stop release mic, clear selection and never auto-resume halted service', async () => {
  let halted = false; const { view, effects } = await ui({ localAIStop: async () => { halted = true; effects.push(['stop']); } }, { status: async () => ready({ halted }) });
  byID(view, 'voice-record').fire('click'); await flush(); await view.run('hammasini to‘xtat'); await flush();
  assert.equal(view.mic.recording, false); assert.equal(streams[0].track.stops, 1); assert.equal(byID(view, 'voice-record').disabled, true);
  await view.run('@test_user ga salom yubor'); assert.equal(effects.some(e => e[0] === 'command'), false);
  byID(view, 'voice-recipient').value = '123456789'; emit('localai-account-invalidated', null);
  assert.equal(byID(view, 'voice-recipient').value, ''); assert.equal(effects.filter(e => e[0] === 'stop').length, 1);
});
