import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountController, parseAccountChatPage, parseAccountMessagePage, validTelegramText } from "../src/core/telegram-account.ts";
import { installFakeDom } from "./fakedom.mjs";
import { setLanguage } from "../src/i18n/i18n.ts";

const CHAT = "-1009007199254740993", OTHER = "888", EPOCH = 7;
const status = (extra = {}) => ({ available: true, configured: true, api_id: 12345, state: "authorized", authorized: true,
  connected: true, session_epoch: EPOCH, busy: false, has_saved_session: true, username: "synthetic_user", dialog_count: 2, selected_chat_id: CHAT, last_error: null, ...extra });
const chat = (extra = {}) => ({ chat_id: CHAT, title: "<script>Literal name</script>", kind: "user", username: "synthetic_user", is_self: false, unread_count: 2, can_send: true, ...extra });
const message = (id = 5, extra = {}) => ({ id, date: "2026-10-10T10:00:00+00:00", sender_id: "123", sender_name: "Synthetic sender",
  text: "<img src=x onerror=alert(1)>", out: false, media_kind: "photo", reply_to_id: 3, truncated: true, ...extra });
const chats = (rows = [chat(), chat({ chat_id: OTHER, title: "Other chat" })], extra = {}) => ({ limit: 30, chats: rows, query: "", filter: "all", next_cursor: null, has_more: false, session_epoch: EPOCH, ...extra });
const history = (id = CHAT, rows = [message()], extra = {}) => ({ limit: 50, chat_id: id, title: "Synthetic chat", messages: rows, query: "", before_id: rows.length ? Math.min(...rows.map(m => m.id)) : null, has_more: false, session_epoch: EPOCH, ...extra });
const proof = (extra = {}) => ({ id: "proof-1", chat_id: CHAT, recipient: "Synthetic chat", text: "Salom!", approval_required: true, expires_in: 120, session_epoch: EPOCH, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const calls = [];
function transport(overrides = {}) {
  let nonce = 0;
  const previews = new Map();
  const prepare = (id, text, replyToID) => { const result = proof({ id: `proof-${++nonce}`, chat_id: id, text, ...(replyToID ? { reply_to_id: replyToID } : {}) }); previews.set(result.id, result); return result; };
  return { status: async () => status(), configure: async () => status(), connect: async () => status(), verify: async () => status(),
    disconnect: async () => status({ state: "disconnected", authorized: false, connected: false }),
    chats: async options => { calls.push(["chats", options]); return chats(undefined, { query: options?.query || "", filter: options?.filter || "all" }); },
    messages: async (id, options) => { calls.push(["messages", id, options]); return history(id, undefined, { query: options?.query || "" }); },
    resolve: async recipient => { calls.push(["resolve", recipient]); return { chat: chat({ chat_id: "999", is_self: recipient === "self" }), session_epoch: EPOCH }; },
    draft: async (id, instruction, reply) => { calls.push(["draft", id, instruction, reply]); return { ...prepare(id, "AI reply 🤝", reply), ai: { provider: "groq", model: "synthetic-model" } }; },
    compose: async (id, body, reply) => { calls.push(["compose", id, body, reply]); return prepare(id, body, reply); },
    cancel: async id => { calls.push(["cancel", id]); return {}; },
    send: async id => { calls.push(["send", id]); const draft = previews.get(id); return { id, chat_id: draft.chat_id, status: "sent", message_id: 101 + nonce, session_epoch: EPOCH,
      ...(draft.reply_to_id ? { reply_to_id: draft.reply_to_id } : {}) }; }, ...overrides };
}
async function ready(controller) { await controller.refresh(); await controller.loadChats(); controller.select(CHAT); await controller.loadMessages(); }
const byID = (view, id) => [...view.el.walk()].find(el => el.getAttribute("id") === id);
async function ui(overrides = {}) {
  installFakeDom(); setLanguage("uz"); const { buildTelegramAccount } = await import("../src/tools/telegram-account.ts");
  const view = buildTelegramAccount(transport(overrides)); view.setVisible(true); await ready(view.controller); return view;
}

test("v2 parsers bind page metadata, UTF16 and literal media/sender/reply fields", () => {
  const page = parseAccountChatPage(chats()); assert.equal(page.chats[0].username, "synthetic_user"); assert.equal(page.session_epoch, EPOCH);
  const messages = parseAccountMessagePage(history(), CHAT); assert.equal(messages.messages[0].media_kind, "photo"); assert.equal(messages.messages[0].sender_name, "Synthetic sender");
  assert.equal(messages.messages[0].reply_to_id, 3); assert.equal(messages.messages[0].truncated, true);
  for (const extra of [{ next_cursor: "", has_more: true }, { has_more: true }, { filter: "bad" }, { session_epoch: -1 }]) assert.throws(() => parseAccountChatPage(chats(undefined, extra)));
  for (const extra of [{ has_more: true, before_id: null }, { chat_id: OTHER }, { limit: 30 }, { messages: [message(), message()] }]) assert.throws(() => parseAccountMessagePage(history(CHAT, undefined, extra), CHAT));
  assert.equal(validTelegramText("🤝".repeat(2000)), true); assert.equal(validTelegramText("🤝".repeat(2001)), false);
  for (const body of ["", " \n", "nul\0", "broken\ud800", "\udc00"]) assert.equal(validTelegramText(body), false);
});

test("chat pages deduplicate, echo search/filter and preserve an open recipient outside filtered pages", async () => {
  let page = chats([chat()], { next_cursor: "nextPage", has_more: true });
  const controller = new AccountController(transport({ chats: async () => page })); await controller.refresh(); await controller.loadChats(); controller.select(CHAT);
  page = chats([chat({ unread_count: 9 }), chat({ chat_id: OTHER })]); await controller.loadChats({ cursor: "nextPage" }, true);
  assert.equal(controller.snapshot.chats.length, 2); assert.equal(controller.snapshot.selected.unread_count, 9);
  page = chats([], { query: "missing", filter: "users" }); await controller.loadChats({ query: "missing", filter: "users" });
  assert.equal(controller.snapshot.selected.chat_id, CHAT); assert.equal(controller.snapshot.chats.length, 0);
  page = chats([], { query: "wrong" }); await controller.loadChats({ query: "expected" }); assert.match(controller.snapshot.error, /Invalid/);
});

test("history pages tolerate ID gaps and deduplicate, while stale old chat responses are dropped", async () => {
  const wait = deferred(); let older = false;
  const controller = new AccountController(transport({ messages: async (id, options) => {
    if (id === OTHER) return wait.promise;
    older = !!options.before_id; return history(id, older ? [message(2), message(5)] : [message(5), message(10)], { has_more: !older });
  } })); await ready(controller); await controller.loadMessages("", true);
  assert.deepEqual(controller.snapshot.messages.map(m => m.id), [2, 5, 10]); assert.equal(older, true);
  controller.select(OTHER); const pending = controller.loadMessages(); controller.select(CHAT);
  wait.resolve(history(OTHER, [message(99)])); await pending;
  assert.equal(controller.snapshot.selected.chat_id, CHAT); assert.deepEqual(controller.snapshot.messages, []);
});

test("Saved Messages is resolved independently of initial30 and no status refresh reads history", async () => {
  calls.length = 0; const controller = new AccountController(transport()); await controller.refresh();
  assert.equal(calls.length, 0); const saved = await controller.resolve("self"); assert.equal(saved.chat_id, "999"); assert.equal(saved.is_self, true);
  assert.equal(controller.snapshot.selected.chat_id, "999"); assert.deepEqual(calls.map(c => c[0]), ["resolve"]);
  await controller.refresh(); assert.deepEqual(calls.map(c => c[0]), ["resolve"]);
});

test("manual send prepares exact multiline Unicode and reply once, consumes proof before duplicate clicks", async () => {
  calls.length = 0; const wait = deferred(); let sentProof;
  const base = transport(); const controller = new AccountController({ ...base, send: async id => { sentProof = id; calls.push(["send", id]); return wait.promise; } }); await ready(controller);
  const body = "  Salom 🤝\nIkkinchi qator  "; const first = controller.composeSend(body, 5); await flush(); const duplicate = await controller.composeSend(body, 5);
  assert.equal(duplicate, null); assert.deepEqual(calls.filter(c => c[0] === "compose").at(-1), ["compose", CHAT, body, 5]);
  assert.equal(calls.filter(c => c[0] === "send").length, 1);
  wait.resolve({ id: sentProof, chat_id: CHAT, status: "sent", message_id: 44, reply_to_id: 5, session_epoch: EPOCH }); await first;
  assert.equal(controller.snapshot.messages.at(-1).text, body); assert.equal(controller.snapshot.sent.status, "sent");
});

test("known preparation failure preserves retry eligibility; unknown send cannot repeat until explicit check", async () => {
  calls.length = 0; let failCompose = true; const base = transport();
  const controller = new AccountController({ ...base, compose: async (...args) => { if (failCompose) throw Error("reply unavailable"); return base.compose(...args); }, send: async id => { calls.push(["send", id]); throw Error("HTTP timeout"); } }); await ready(controller);
  await controller.composeSend("hello"); assert.equal(controller.snapshot.sent, null); assert.equal(calls.some(c => c[0] === "send"), false);
  failCompose = false; await controller.composeSend("hello"); assert.equal(controller.snapshot.sent.status, "unknown");
  controller.select(OTHER); assert.equal(controller.snapshot.sent.status, "unknown"); controller.select(CHAT);
  await controller.composeSend("hello"); assert.equal(calls.filter(c => c[0] === "send").length, 1);
  controller.acknowledgeUnknown(); await controller.composeSend("hello"); assert.equal(calls.filter(c => c[0] === "send").length, 2);
});

test("AI proof for an unknown identical body also cannot bypass the uncertainty guard", async () => {
  calls.length = 0; const base = transport(); const controller = new AccountController({ ...base, send: async id => { calls.push(["send", id]); throw Error("timeout"); } }); await ready(controller);
  await controller.composeSend("AI reply 🤝"); const ai = await controller.prepareAI("Reply"); await controller.sendPrepared(ai);
  assert.equal(calls.filter(c => c[0] === "send").length, 1); assert.ok(calls.some(c => c[0] === "cancel" && c[1] === ai.id));
});

test("multiple unknown signatures survive different successful sends and acknowledge only the displayed one", async () => {
  calls.length = 0; const base = transport(); let attempt = 0;
  const controller = new AccountController({ ...base, send: async id => { if (++attempt <= 2) { calls.push(["send", id]); throw Error("timeout"); } return base.send(id); } }); await ready(controller);
  await controller.composeSend("unknown A"); await controller.composeSend("unknown C"); await controller.composeSend("known B");
  assert.equal(controller.snapshot.sent.status, "sent"); const prepared = calls.filter(c => c[0] === "compose").length;
  await controller.composeSend("unknown A"); assert.equal(calls.filter(c => c[0] === "compose").length, prepared);
  assert.equal(controller.snapshot.sent.status, "unknown"); controller.acknowledgeUnknown();
  await controller.composeSend("unknown A"); assert.equal(controller.snapshot.sent.status, "sent");
  await controller.composeSend("unknown C"); assert.equal(controller.snapshot.sent.status, "unknown");
  assert.equal(calls.filter(c => c[0] === "send").length, 4);
});

test("explicit reconnect does not erase unresolved send signatures", async () => {
  calls.length = 0; const base = transport(); const controller = new AccountController({ ...base, send: async id => { calls.push(["send", id]); throw Error("timeout"); } });
  await ready(controller); await controller.composeSend("uncertain"); await controller.run("disconnect"); await ready(controller);
  await controller.composeSend("uncertain"); assert.equal(calls.filter(c => c[0] === "send").length, 1);
  assert.equal(controller.snapshot.sent.status, "unknown");
});

test("epoch/reply/text mismatches cancel preparation and never send", async () => {
  for (const extra of [{ session_epoch: EPOCH + 1 }, { reply_to_id: 6 }, { text: "altered" }]) {
    calls.length = 0; const controller = new AccountController(transport({ compose: async () => proof({ ...extra }) })); await ready(controller); await controller.composeSend("Salom!");
    assert.equal(calls.some(c => c[0] === "send"), false); assert.ok(calls.some(c => c[0] === "cancel")); assert.ok(controller.snapshot.error);
  }
});

test("hide and changed reply cancel late AI proofs; account epoch invalidates old loaded data", async () => {
  calls.length = 0; const wait = deferred(); let currentStatus = status();
  const controller = new AccountController(transport({ status: async () => currentStatus, draft: async () => wait.promise })); await ready(controller);
  const pending = controller.prepareAI("Reply"); controller.cancelPrivateRequests(); wait.resolve(proof()); assert.equal(await pending, null);
  assert.ok(calls.some(c => c[0] === "cancel")); assert.equal(controller.snapshot.aiPending, false);
  currentStatus = status({ session_epoch: EPOCH + 1 }); await controller.refresh(); assert.equal(controller.snapshot.selected, null); assert.equal(controller.snapshot.messagesLoaded, false);
});

test("messenger collapses auth after login and renders untrusted messages and metadata literally", async () => {
  const view = await ui(); assert.equal(byID(view, "account-auth-body").hidden, true); assert.equal(byID(view, "account-toggle-auth").hidden, false);
  assert.match(view.el.textContent, /<img src=x onerror=alert\(1\)>/); assert.match(view.el.textContent, /Synthetic sender/); assert.match(view.el.textContent, /Rasm/);
  assert.equal(view.el.find("IMG").length, 0); assert.equal(view.el.find("SCRIPT").length, 0);
  assert.equal(byID(view, "account-composer").disabled, false);
  byID(view, "account-toggle-auth").fire("click"); assert.equal(byID(view, "account-auth-body").hidden, false);
});

test("local Uzbek apostrophe preview and authoritative Cyrillic search preserve matching server rows", async () => {
  const view = await ui({ chats: async options => chats([chat({ title: "O'qish guruhi" })], { query: options?.query || "", filter: options?.filter || "all" }) });
  const search = byID(view, "account-chat-search"), rows = byID(view, "account-chat-list");
  search.value = "oʻqish"; search.fire("input"); assert.match(rows.textContent, /O'qish guruhi/);
  search.value = "ўқиш"; search.fire("input"); byID(view, "account-list-chats").fire("click"); await flush();
  assert.match(rows.textContent, /O'qish guruhi/); assert.equal(view.controller.snapshot.chatPage.query, "ўқиш");
});

test("composer binds drafts separately to each chat and reply, preserving Enter newlines", async () => {
  const view = await ui(), composer = byID(view, "account-composer"), select = byID(view, "account-chat");
  composer.value = "first chat draft"; composer.fire("input"); select.value = OTHER; select.fire("change"); assert.equal(composer.value, "");
  composer.value = "other draft"; composer.fire("input"); select.value = CHAT; select.fire("change"); assert.equal(composer.value, "first chat draft");
  await view.controller.loadMessages(); [...view.el.walk()].find(el => el.getAttribute("data-reply-id") === "5").fire("click"); assert.equal(composer.value, "");
  composer.value = "bound reply"; composer.fire("input"); byID(view, "account-cancel-reply").fire("click"); assert.equal(composer.value, "first chat draft");
  let prevented = false; for (const fn of composer.listeners.get("keydown")) fn({ key: "Enter", ctrlKey: false, preventDefault: () => prevented = true });
  assert.equal(prevented, false);
});

test("hiding clears private composer/instructions and cached chat drafts without sending or relogin", async () => {
  calls.length = 0; const view = await ui(), composer = byID(view, "account-composer"), instruction = byID(view, "account-instruction");
  composer.value = "private draft"; composer.fire("input"); instruction.value = "private instruction";
  const select = byID(view, "account-chat"); select.value = OTHER; select.fire("change"); composer.value = "other private draft"; composer.fire("input");
  const before = calls.length; view.setVisible(false); assert.equal(composer.value, ""); assert.equal(instruction.value, ""); assert.equal(calls.length, before);
  view.setVisible(true); select.value = CHAT; select.fire("change"); assert.equal(composer.value, "");
});

test("Ctrl+Enter sends once with IME guard and known failures keep composer text", async () => {
  calls.length = 0; const view = await ui({ compose: async () => { throw Error("known compose failure"); } });
  const composer = byID(view, "account-composer"); composer.value = "Salom 🤝\nLine2"; composer.fire("input");
  for (const fn of composer.listeners.get("keydown")) fn({ key: "Enter", ctrlKey: true, isComposing: true, preventDefault() {} });
  await flush(); assert.equal(view.controller.snapshot.error, "");
  let prevented = false; for (const fn of composer.listeners.get("keydown")) fn({ key: "Enter", ctrlKey: true, isComposing: false, preventDefault: () => prevented = true });
  await flush(); assert.equal(prevented, true); assert.equal(composer.value, "Salom 🤝\nLine2"); assert.match(view.controller.snapshot.error, /known/);
});

test("AI writes editable composer with actual provider and cancels proof; summary cannot AI-send", async () => {
  calls.length = 0; const view = await ui(); byID(view, "account-ai-short").fire("click"); byID(view, "account-prepare-draft").fire("click"); await flush();
  assert.equal(byID(view, "account-composer").value, "AI reply 🤝"); assert.match(byID(view, "account-ai-provider").textContent, /groq.*synthetic-model/);
  assert.equal(calls.some(c => c[0] === "send"), false); assert.ok(calls.some(c => c[0] === "cancel"));
  byID(view, "account-ai-summary").fire("click"); assert.equal(byID(view, "account-ai-send").disabled, true);
  byID(view, "account-ai-send").fire("click"); await flush(); assert.equal(calls.some(c => c[0] === "send"), false);
});

test("AI-and-send is explicit, while editing, reply change, hiding or chat switch rejects stale generation", async () => {
  for (const change of ["edit", "reply", "hide", "switch"]) {
    calls.length = 0; const wait = deferred(); const view = await ui({ draft: async () => wait.promise });
    byID(view, "account-instruction").value = "reply"; byID(view, "account-ai-send").fire("click");
    if (change === "edit") { byID(view, "account-composer").value = "manual edit"; byID(view, "account-composer").fire("input"); }
    if (change === "reply") [...view.el.walk()].find(el => el.getAttribute("data-reply-id") === "5").fire("click");
    if (change === "hide") view.setVisible(false);
    if (change === "switch") { const select = byID(view, "account-chat"); select.value = OTHER; select.fire("change"); }
    wait.resolve(proof({ text: "stale AI" })); await flush();
    assert.equal(calls.some(c => c[0] === "send"), false, change); assert.notEqual(byID(view, "account-composer").value, "stale AI", change);
    assert.ok(calls.some(c => c[0] === "cancel"), change);
  }
  calls.length = 0; const view = await ui(); byID(view, "account-instruction").value = "reply"; byID(view, "account-ai-send").fire("click"); await flush();
  assert.equal(calls.filter(c => c[0] === "send").length, 1); assert.equal(byID(view, "account-composer").value, "");
});

test("read-only channels disable composition and restoring the session is an explicit recovery action", async () => {
  calls.length = 0; let current = status({ connected: false });
  const view = await ui({ status: async () => current, disconnect: async () => { calls.push(["disconnect"]); return current = status({ state: "disconnected", authorized: false, connected: false }); },
    connect: async phone => { calls.push(["connect", phone]); return current = status(); } });
  assert.equal(byID(view, "account-composer").disabled, true); assert.equal(byID(view, "account-reconnect").hidden, false);
  assert.equal(calls.some(c => c[0] === "connect"), false); byID(view, "account-reconnect").fire("click"); await flush(); await flush();
  assert.deepEqual(calls.filter(c => ["connect", "disconnect"].includes(c[0])), [["disconnect"], ["connect", undefined]]);
  view.controller.snapshot.chats = [chat({ kind: "channel", can_send: false })]; view.controller.select(CHAT); view.sync();
  assert.equal(byID(view, "account-composer").disabled, true); assert.equal(byID(view, "account-send").disabled, true);
});
