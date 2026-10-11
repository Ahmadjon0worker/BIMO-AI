import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SentenceSpeechQueue, speechSentences, createWavSpeechAdapter } from '../src/core/speech-queue.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('speech chunks preserve Uzbek, decimals and domain punctuation, omit fenced code and stay bounded', () => {
  assert.deepEqual(speechSentences('**Salom!** Narx 1.25 so‘m. [Manba](https://fixture.test) tayyor. `OK`.\n```powershell\nRemove-Item x\n```'),
    ['Salom!', 'Narx 1.25 so‘m.', 'Manba tayyor.', 'OK.']);
  assert.deepEqual(speechSentences('coucou.buxoromaktabibekobod.uz ishlayapti.'), ['coucou.buxoromaktabibekobod.uz ishlayapti.']);
  const chunks = speechSentences('So‘zlar '.repeat(2000));
  assert.ok(chunks.length <= 24); assert.ok(chunks.every(text => text.length <= 360));
  assert.deepEqual(speechSentences('```private incomplete code'), []);
});

test('second sentence synthesizes during first playback with at most one prefetched sentence', async () => {
  const first = deferred(), second = deferred(), events = [];
  const queue = new SentenceSpeechQueue({
    synthesize: async (text, language) => { events.push(['synthesize', text, language]); return text; },
    play: async text => { events.push(['play', text]); return text === 'Birinchi.' ? first.promise : second.promise; },
  });
  const pending = queue.speak('Birinchi. Ikkinchi. Uchinchi.', 'uz'); await flush();
  assert.deepEqual(events, [['synthesize', 'Birinchi.', 'uz'], ['play', 'Birinchi.'], ['synthesize', 'Ikkinchi.', 'uz']]);
  assert.equal(queue.state.speaking, true); assert.equal(queue.state.remaining, 3);
  first.resolve(); await flush();
  assert.deepEqual(events.slice(3), [['play', 'Ikkinchi.'], ['synthesize', 'Uchinchi.', 'uz']]);
  second.resolve(); assert.equal(await pending, true); assert.equal(queue.state.active, false);
  assert.equal(events.filter(event => event[0] === 'play').length, 3);
});

test('barge-in ends a pending synth immediately and a late success cannot play over a new reply', async () => {
  const old = deferred(), plays = [];
  const queue = new SentenceSpeechQueue({ synthesize: text => text === 'Eski.' ? old.promise : Promise.resolve(text), play: async text => { plays.push(text); } });
  const obsolete = queue.speak('Eski. Yo‘qoladi.', 'uz'); await flush(); queue.cancel();
  assert.equal(await obsolete, false); assert.equal(queue.state.active, false);
  assert.equal(await queue.speak('Yangi.', 'uz'), true);
  old.resolve('Eski.'); await flush(); assert.deepEqual(plays, ['Yangi.']);
});

test('cancel interrupts the playing sentence and ignores a failed prefetch without unhandled rejection', async () => {
  const playing = deferred(), next = deferred(), events = [];
  const queue = new SentenceSpeechQueue({
    synthesize: text => text === 'Birinchi.' ? Promise.resolve(text) : next.promise,
    play: async (text, signal) => { events.push(text); signal.addEventListener('abort', () => playing.resolve(), { once: true }); await playing.promise; },
  });
  const pending = queue.speak('Birinchi. Ikkinchi.', 'uz'); await flush(); queue.cancel();
  next.reject(new Error('Old prefetch')); assert.equal(await pending, false); await flush();
  assert.deepEqual(events, ['Birinchi.']); assert.equal(queue.state.error, '');
});

test('a prefetch failure is reported after current playback and never reads later sentences', async () => {
  const playing = deferred(), plays = [];
  const queue = new SentenceSpeechQueue({
    synthesize: async text => { if (text === 'Ikkinchi.') throw new Error('Synthetic TTS unavailable'); return text; },
    play: async text => { plays.push(text); await playing.promise; },
  });
  const pending = queue.speak('Birinchi. Ikkinchi. Uchinchi.', 'uz'); await flush(); playing.resolve();
  assert.equal(await pending, false); assert.match(queue.state.error, /TTS unavailable/);
  assert.deepEqual(plays, ['Birinchi.']); assert.equal(queue.state.active, false);
});

test('local WAV adapter rejects invalid payload before creating any playback resources', async () => {
  for (const raw of [{ ok: false }, { ok: true, format: 'wav', audio_base64: btoa('not-wave') }, { ok: true, format: 'mp3', audio_base64: 'abcd' }]) {
    const adapter = createWavSpeechAdapter(async () => raw);
    await assert.rejects(adapter.synthesize('Salom.', 'uz'), /yaroqsiz/);
  }
});

test('local playback cancellation pauses audio and revokes the exact object URL once', async () => {
  const oldAudio = globalThis.Audio, oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL, created = [], revoked = [], players = [];
  class FakeAudio {
    constructor(url) { this.url = url; this.pauses = 0; players.push(this); }
    play() { return Promise.resolve(); }
    pause() { this.pauses++; }
    removeAttribute() {}
  }
  globalThis.Audio = FakeAudio;
  URL.createObjectURL = blob => { created.push(blob); return 'blob:synthetic-voice'; };
  URL.revokeObjectURL = url => revoked.push(url);
  try {
    const adapter = createWavSpeechAdapter(async () => null), abort = new AbortController();
    const playing = adapter.play(new Uint8Array(44), abort.signal); await flush();
    abort.abort(); await playing;
    assert.equal(created.length, 1); assert.equal(players[0].pauses, 1); assert.deepEqual(revoked, ['blob:synthetic-voice']);
    abort.abort(); assert.equal(players[0].onended, null); assert.equal(players[0].onerror, null);
    assert.equal(revoked.length, 1);
  } finally { globalThis.Audio = oldAudio; URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; }
});
