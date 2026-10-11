import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fakedom.mjs';
import { buildAssistant } from '../src/tools/assistant.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const byID = (view, id) => [...view.el.walk()].find(el => el.getAttribute('id') === id);
const status = () => ({ ok:true, brains:[{id:'broker',label:'Mahalliy AI',installed:true,ready:false,reason:'provider_unconfigured',detail:'Sozlamalarda provider va modelni tanlang.'}] });
const memory = text => ({ id:'synthetic_preference',text,source:'user',created_at:'2026-10-11T00:00:00Z' });
let views;
beforeEach(() => { installFakeDom(); views = []; });
afterEach(() => { for (const view of views) view.setVisible(false); });

function ui(overrides = {}) {
  const calls = [], dispatch = async (name, args) => {
    calls.push([name, args]);
    if (overrides[name]) return overrides[name](args);
    if (name === 'assistant_status') return status();
    if (name === 'assistant_memory_list') return {ok:true,items:[]};
    if (name === 'assistant_activity') return {ok:true,items:[]};
    if (name === 'assistant_cancel') return {ok:true,cancelled:true};
    if (name === 'assistant_memory_remember' || name === 'assistant_memory_forget') return {ok:true};
    return {ok:true,reply:'Synthetic reply.',provider:'fixture',elapsed_ms:1};
  };
  const view = buildAssistant(dispatch); views.push(view);
  byID(view, 'assistant-engine').value = 'auto'; byID(view, 'assistant-prompt').value = '';
  byID(view, 'assistant-memory').value = ''; view.setVisible(true);
  return {view,calls};
}
function ask(view, text) { byID(view, 'assistant-prompt').value=text; byID(view, 'assistant-ask').fire('click'); }

test('assistant is inert on visibility alone and shows actionable Uzbek details after an explicit refresh', async () => {
  const {view,calls} = ui(); assert.deepEqual(calls, []);
  await view.refresh(); assert.match(view.el.textContent, /Sozlamalarda provider va modelni tanlang/);
  assert.doesNotMatch(view.el.textContent, /provider_unconfigured/);
  assert.deepEqual(calls.map(call=>call[0]), ['assistant_status','assistant_memory_list','assistant_activity']);
});

test('a delayed old cancellation completes before the next brain request, and old answers never replace it', async () => {
  const old = deferred(), fresh = deferred(), cancellation = deferred(); let replies = 0;
  const {view,calls} = ui({assistant_brain_reply:()=>++replies===1?old.promise:fresh.promise,assistant_cancel:()=>cancellation.promise});
  ask(view,'Birinchi savol'); await flush(); assert.equal(replies,1);
  view.stop(); await flush(); assert.equal(calls.filter(call=>call[0]==='assistant_cancel').length,1);
  ask(view,'Yangi savol'); await flush(); assert.equal(replies,1,'fresh request must wait for cancellation');
  old.resolve({ok:true,reply:'Old private answer.',provider:'fixture',elapsed_ms:1}); await flush();
  assert.doesNotMatch(byID(view,'assistant-reply').textContent,/Old private/);
  assert.equal(byID(view,'assistant-ask').disabled,true,'old finalizer cannot unlock fresh pending turn');
  cancellation.resolve({ok:true,cancelled:true}); await flush(); assert.equal(replies,2);
  fresh.resolve({ok:true,reply:'Yangi javob.',provider:'fixture',elapsed_ms:2}); await flush();
  assert.equal(byID(view,'assistant-reply').textContent,'Yangi javob.'); assert.equal(byID(view,'assistant-ask').disabled,false);
  assert.deepEqual(calls.filter(call=>call[0]==='assistant_brain_reply').map(call=>call[1].prompt),['Birinchi savol','Yangi savol']);
});

test('hiding an active answer cancels once and no late result is shown after reopening', async () => {
  const answer = deferred(), {view,calls} = ui({assistant_brain_reply:()=>answer.promise});
  ask(view,'Synthetic private question'); await flush(); view.setVisible(false); view.setVisible(false);
  answer.resolve({ok:true,reply:'Hidden private answer <script>alert(1)</script>.',provider:'fixture',elapsed_ms:1}); await flush();
  view.setVisible(true); await flush();
  assert.equal(calls.filter(call=>call[0]==='assistant_cancel').length,1);
  assert.doesNotMatch(byID(view,'assistant-reply').textContent,/Hidden private/); assert.equal(view.el.find('SCRIPT').length,0);
});

test('a stale memory refresh cannot publish pre-mutation data, and a fresh refresh follows it', async () => {
  const stale = deferred(); let reads = 0;
  const {view,calls} = ui({assistant_memory_list:()=>++reads===1?stale.promise:Promise.resolve({ok:true,items:[memory('Yangi afzallik.')]} )});
  const refreshing = view.refresh(); await flush(); assert.equal(reads,1);
  byID(view,'assistant-memory').value='Yangi afzallik.'; byID(view,'assistant-remember').fire('click'); await flush();
  assert.equal(byID(view,'assistant-memory').value,'');
  stale.resolve({ok:true,items:[memory('Old stale private preference.')]}); await refreshing; await flush();
  assert.equal(reads,2); assert.match(view.el.textContent,/Yangi afzallik/);
  assert.doesNotMatch(view.el.textContent,/Old stale private preference/);
  assert.equal(calls.filter(call=>call[0]==='assistant_cancel').length,0,'memory mutation is not an AI job');
});

test('parallel refresh calls are coalesced and a hidden status reply cannot start private-data reads', async () => {
  const delayedStatus = deferred(), {view,calls} = ui({assistant_status:()=>delayedStatus.promise});
  const first = view.refresh(); await view.refresh(); await view.refresh();
  assert.equal(calls.filter(call=>call[0]==='assistant_status').length,1);
  view.setVisible(false); delayedStatus.resolve(status()); await first;
  assert.equal(calls.some(call=>call[0]==='assistant_memory_list'||call[0]==='assistant_activity'),false);
  assert.doesNotMatch(view.el.textContent,/Sozlamalarda provider va modelni tanlang/);
});

test('hiding a pending memory save does not cancel unrelated AI work or claim that saving stopped', async () => {
  const saving = deferred(), {view,calls} = ui({assistant_memory_remember:()=>saving.promise});
  byID(view,'assistant-memory').value='Synthetic preference'; byID(view,'assistant-remember').fire('click'); await flush();
  assert.equal(byID(view,'assistant-cancel').disabled,true); view.setVisible(false);
  saving.resolve({ok:true}); await flush();
  assert.equal(calls.some(call=>call[0]==='assistant_cancel'),false);
  assert.doesNotMatch(byID(view,'assistant-reply').textContent,/to‘xtatildi/);
});

test('brain text, memory text, source and action labels stay literal instead of creating markup', async () => {
  const literal='<img src=x onerror=alert(1)><script>alert(2)</script>';
  const {view} = ui({
    assistant_brain_reply:async()=>({ok:true,reply:literal,provider:'fixture',elapsed_ms:1}),
    assistant_memory_list:async()=>({ok:true,items:[{...memory(literal),source:'<svg onload=alert(3)>'}]}),
    assistant_activity:async()=>({ok:true,items:[{action:literal,status:'<script>sent</script>',elapsed_ms:3}]}),
  });
  await view.refresh(); ask(view,'Literal text test'); await flush();
  assert.equal(byID(view,'assistant-reply').textContent,literal); assert.ok(view.el.textContent.includes('<svg onload=alert(3)>'));
  for (const tag of ['IMG','SCRIPT','SVG']) assert.equal(view.el.find(tag).length,0);
});

test('malformed brain and memory outputs report an error and never become playable or rendered answers', async () => {
  const {view} = ui({assistant_brain_reply:async()=>({ok:true,reply:{html:'<script>bad</script>'}}),assistant_memory_list:async()=>({ok:true,items:[{id:'bad',text:null}]})});
  await view.refresh(); assert.match(view.el.textContent,/Xotira ma’lumoti yaroqsiz/);
  ask(view,'Invalid reply test'); await flush();
  assert.match(byID(view,'assistant-reply').textContent,/AI javob bermadi/); assert.equal(view.el.find('SCRIPT').length,0);
  assert.equal(byID(view,'assistant-ask').disabled,false);
});

test('real broker ready=null still refreshes memory and activity and does not claim a verified login', async () => {
  const {view,calls}=ui({assistant_status:async()=>({ok:true,brains:[{id:'broker',label:'Ollama / Gemini / Groq',installed:true,ready:null,reason:'checked_on_request',detail:'Provider so‘rovda tekshiriladi.'}]}),
    assistant_memory_list:async()=>({ok:true,items:[memory('O‘zbekcha javob bering.')]})});
  await view.refresh();
  assert.match(view.el.textContent,/So‘rovda tekshiriladi/);assert.match(view.el.textContent,/O‘zbekcha javob bering/);
  assert.equal(view.el.find('.assistant-brain')[0].getAttribute('data-ready'),'null');
  assert.equal(calls.filter(call=>call[0]==='assistant_activity').length,1);
  assert.doesNotMatch(view.el.find('.assistant-brain')[0].textContent,/Ulanish kerak|Tayyor/);
});

test('backend activity states display failed, cancelled and unknown honestly instead of claiming completion', async () => {
  const {view}=ui({assistant_activity:async()=>({ok:true,items:[
    {action:'successful_fixture',state:'completed',elapsed_ms:1},
    {action:'failed_fixture',state:'failed',elapsed_ms:2},
    {action:'cancelled_fixture',state:'cancelled',elapsed_ms:3},
    {action:'unknown_fixture',state:'unknown',elapsed_ms:4},null,
  ]})});
  await view.refresh();const rows=view.el.find('.assistant-activity-row').map(row=>row.textContent);
  assert.deepEqual(rows,['successful_fixture · Bajarildi · 1 ms','failed_fixture · Xato · 2 ms','cancelled_fixture · To‘xtatildi · 3 ms','unknown_fixture · Natija noma’lum · 4 ms']);
});
