import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({ load(url, context, next) {
  if (/\/src\/core\/voice\.ts$/.test(url)) return {
    format: 'module', shortCircuit: true,
    source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }),
  };
  return next(url, context);
} });
const { voiceCommandText, parseVoiceIntent } = await import('../src/core/voice.ts');

test('BIMO wake phrases support Latin/Cyrillic and preserve exact requested message text', () => {
  assert.equal(voiceCommandText('OK BIMO, panelni och!', true), 'panelni och!');
  assert.equal(voiceCommandText('ОК Бимо: панелни оч', true), 'панелни оч');
  assert.deepEqual(parseVoiceIntent('Salom BIMO AI, sozlamalarni och'), { kind: 'ui', target: 'settings' });
  const body = '@fixture_user ga “Panelni yop! 🤝” yubor';
  assert.equal(voiceCommandText('Hey BIMO AI: ' + body, true), body);
  assert.deepEqual(parseVoiceIntent('BIMO ' + body), { kind: 'telegram', query: body });
  assert.equal(voiceCommandText('Бимо АИ, Телеграмни оч', true), 'Телеграмни оч');
});

test('BIMO wake boundary rejects partial names and keeps every previous alias usable', () => {
  for (const text of ['BIMO', 'BIMO AI', 'bimoli panelni och', 'бимолар панелни оч', 'bimo_user panelni och', 'panelni och']) {
    assert.equal(voiceCommandText(text, true), null, text);
  }
  for (const alias of ['Moshi', 'Моши', 'Qanot', 'Qanot AI', 'Kanot', 'Қанот', 'Канот', 'Coucou', 'Kuku', 'Куку']) {
    assert.equal(voiceCommandText(`OK ${alias}, panelni och`, true), 'panelni och', alias);
  }
  assert.equal(parseVoiceIntent('BIMO panelni ochma').kind, 'help');
  assert.equal(parseVoiceIntent('Бимо, ҳаммасини тўхтатма').kind, 'help');
});
