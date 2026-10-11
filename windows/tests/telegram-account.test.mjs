import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountController, accountChatID, parseAccountStatus, parseAccountChats, parseAccountMessages,
  parseAccountDraft, parseAccountSend } from "../src/core/telegram-account.ts";
import { installFakeDom } from "./fakedom.mjs";
import { setLanguage } from "../src/i18n/i18n.ts";
import { sent as tauriSent } from "./tauri.mjs";

const CHAT = "-1009007199254740993";
const status = (extra = {}) => ({ available: true, configured: true, api_id: 12345, state: "authorized", authorized: true,
  busy: false, has_saved_session: true, username: "synthetic_user", dialog_count: 1, selected_chat_id: CHAT, last_error: null, ...extra });
const chat = (extra = {}) => ({ chat_id: CHAT, title: "Synthetic chat", kind: "user", unread_count: 0, can_send: true, ...extra });
const draft = (extra = {}) => ({ id: "reviewed_rev-123", chat_id: CHAT, recipient: "Synthetic chat", text: "Salom!", expires_in: 120,
  approval_required: true, ...extra });
const messages = (extra = {}) => ({ chat_id: CHAT, title: "Synthetic chat", limit: 20,
  messages: [{ id: 1, date: "2026-10-09T10:00:00+00:00", sender_id: "123", text: "Synthetic message", out: false }], ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function transport(extra = {}) {
  return { status: async () => status(), configure: async () => status(), connect: async () => status(), verify: async () => status(),
    disconnect: async () => status({ state: "disconnected", authorized: false }), chats: async () => ({ chats: [chat()], limit: 30 }),
    messages: async () => messages(), draft: async () => draft(), send: async (id) => ({ id, chat_id: CHAT, status: "sent", message_id: 2 }), ...extra };
}
async function reviewed(controller) {
  await controller.refresh(); await controller.run("chats"); controller.select(CHAT);
  await controller.run("messages"); await controller.run("draft", "Reply politely");
}
const byID = (view, id) => [...view.el.walk()].find((el) => el.getAttribute("id") === id);

test("actual account DTO and optional bounded teardown state are parsed without secrets", () => {
  assert.deepEqual(parseAccountStatus(status({ api_hash: "never retain", code: "12345" })), status());
  assert.equal(parseAccountStatus(status({ stop_complete: false, teardown_pending: true })).teardown_pending, true);
  for (const extra of [{ available: 1 }, { state: "ready" }, { busy: "false" }, { api_id: 2147483648 },
    { selected_chat_id: 123 }, { teardown_pending: "yes" }, { last_error: {} }]) assert.throws(() => parseAccountStatus(status(extra)));
});

test("Telegram identifiers remain exact decimal strings beyond JavaScript integer precision", () => {
  assert.equal(accountChatID(CHAT), CHAT); assert.equal(parseAccountChats({ chats: [chat()], limit: 30 })[0].chat_id, CHAT);
  for (const id of [123, "0", "-0", "01", "-01", "+123", "1e5", "1.5", "1\n", "1".repeat(25)]) assert.throws(() => accountChatID(id));
  assert.throws(() => parseAccountChats({ chats: [chat(), chat()], limit: 30 }));
  assert.throws(() => parseAccountChats({ chats: [chat()], limit: 100 }));
  assert.throws(() => parseAccountChats({ chats: [chat({ can_send: "yes" })], limit: 30 }));
});

test("message and draft payloads must match the explicitly selected recipient", () => {
  assert.equal(parseAccountMessages(messages(), CHAT).messages[0].text, "Synthetic message");
  assert.throws(() => parseAccountMessages(messages({ chat_id: "999" }), CHAT));
  assert.throws(() => parseAccountMessages(messages({ limit: 30 }), CHAT));
  assert.throws(() => parseAccountDraft(draft({ chat_id: "999" }), CHAT));
  for (const extra of [{ approval_required: false }, { expires_in: 0 }, { text: " " }, { id: "../bad" }, { text: "x".repeat(4001) }])
    assert.throws(() => parseAccountDraft(draft(extra), CHAT));
});

test("sent requires Telegram message ID, while unknown and cancelled remain distinct", () => {
  const reviewed = draft();
  assert.equal(parseAccountSend({ id: reviewed.id, chat_id: CHAT, status: "unknown", message_id: null }, reviewed).status, "unknown");
  assert.equal(parseAccountSend({ id: reviewed.id, chat_id: CHAT, status: "cancelled", message_id: null }, reviewed).status, "cancelled");
  for (const data of [{ id: reviewed.id, chat_id: CHAT, status: "sent", message_id: null },
    { id: "old", chat_id: CHAT, status: "sent", message_id: 2 }]) assert.throws(() => parseAccountSend(data, reviewed));
});

test("status polling and chat selection never load private content or perform effects", async () => {
  const calls = [];
  const controller = new AccountController(transport({ status: async () => { calls.push("status"); return status(); },
    chats: async () => { calls.push("chats"); return { chats: [chat()], limit: 30 }; },
    messages: async () => { calls.push("messages"); return messages(); }, send: async () => { calls.push("send"); } }));
  await controller.refresh(); await controller.refresh(); assert.deepEqual(calls, ["status", "status"]);
  await controller.run("chats"); controller.select(CHAT); assert.equal(controller.snapshot.messagesLoaded, false);
  assert.equal(calls.includes("messages"), false); assert.equal(calls.includes("send"), false);
  await controller.run("draft", "Reply"); assert.equal(controller.snapshot.draft, null);
});

test("empty chat can be drafted only after the explicit read completes", async () => {
  let drafted = 0;
  const controller = new AccountController(transport({ messages: async () => messages({ messages: [] }),
    draft: async () => { drafted++; return draft(); } }));
  await reviewed(controller); assert.equal(controller.snapshot.messagesLoaded, true); assert.equal(drafted, 1);
});

test("a reviewed send ID is consumed before HTTP and repeated clicks cannot resend", async () => {
  const waiting = deferred(), sent = [];
  const controller = new AccountController(transport({ send: (id) => { sent.push(id); return waiting.promise; } }));
  await reviewed(controller); assert.deepEqual(sent, []);
  const first = controller.run("send"); assert.equal(controller.snapshot.draft, null);
  await controller.run("send"); assert.deepEqual(sent, [draft().id]);
  waiting.resolve({ id: draft().id, chat_id: CHAT, status: "sent", message_id: 2 }); await first;
  assert.equal(controller.snapshot.sent.status, "sent"); await controller.run("send"); assert.equal(sent.length, 1);
});

test("send HTTP timeout reports unknown outcome and cannot replay the consumed ID", async () => {
  let sends = 0;
  const controller = new AccountController(transport({ send: async () => { sends++; throw Error("Request timed out"); } }));
  await reviewed(controller); await controller.run("send");
  assert.equal(controller.snapshot.sent.status, "unknown"); assert.equal(controller.snapshot.sent.message_id, null);
  assert.equal(controller.snapshot.draft, null); assert.match(controller.snapshot.error, /timed out/);
  await controller.run("send"); assert.equal(sends, 1);
});

test("malformed send acknowledgement is also unknown rather than confirmed failure", async () => {
  const controller = new AccountController(transport({ send: async () => ({ status: "sent" }) }));
  await reviewed(controller); await controller.run("send"); assert.equal(controller.snapshot.sent.status, "unknown");
});

test("unknown send remains visible when the post-send cached status is also offline", async () => {
  let offline = false;
  const controller = new AccountController(transport({ status: async () => { if (offline) throw Error("offline"); return status(); },
    send: async () => { offline = true; throw Error("HTTP timeout"); } }));
  await reviewed(controller); await controller.run("send");
  assert.equal(controller.snapshot.status, null); assert.equal(controller.snapshot.selected, null);
  assert.equal(controller.snapshot.draft, null); assert.equal(controller.snapshot.sent.status, "unknown");
  await controller.run("send"); assert.equal(controller.snapshot.sent.status, "unknown");
});

test("unknown send remains visible after passive disconnected status and clears on explicit disconnect", async () => {
  let disconnected = false;
  const controller = new AccountController(transport({ status: async () => status(disconnected ? { authorized:false,state:"disconnected" } : {}),
    send: async () => { disconnected = true; throw Error("HTTP timeout"); } }));
  await reviewed(controller); await controller.run("send");
  assert.equal(controller.snapshot.status.authorized, false); assert.equal(controller.snapshot.selected, null);
  assert.equal(controller.snapshot.sent.status, "unknown");
  await controller.refresh(); assert.equal(controller.snapshot.sent.status, "unknown");
  await controller.run("disconnect"); assert.equal(controller.snapshot.sent, null);
});

test("draft expiry prevents sending without a network call", async () => {
  let sends = 0; const controller = new AccountController(transport({ send: async () => { sends++; } }));
  await reviewed(controller); controller.snapshot.draftExpiresAt = Date.now() - 1;
  await controller.run("send"); assert.equal(sends, 0); assert.equal(controller.snapshot.draft, null);
});

test("identity change and recipient change invalidate reviewed drafts", async () => {
  let current = status(); const controller = new AccountController(transport({ status: async () => current }));
  await reviewed(controller); current = status({ username: "another_user" }); await controller.refresh();
  assert.equal(controller.snapshot.draft, null); assert.equal(controller.snapshot.selected, null);
  current = status(); await reviewed(controller); controller.select("999"); assert.equal(controller.snapshot.draft, null);
  assert.equal(controller.snapshot.selected, null);
});

test("disconnect wins over an in-flight draft and late results cannot restore a send button", async () => {
  const waiting = deferred(); const controller = new AccountController(transport({ draft: () => waiting.promise }));
  await controller.refresh(); await controller.run("chats"); controller.select(CHAT); await controller.run("messages");
  const preparing = controller.run("draft", "Reply"); await controller.run("disconnect");
  waiting.resolve(draft()); await preparing; assert.equal(controller.snapshot.draft, null); assert.equal(controller.snapshot.selected, null);
});

test("global Stop invalidation rejects late draft completion", async () => {
  const waiting = deferred(); const controller = new AccountController(transport({ draft: () => waiting.promise }));
  await controller.refresh(); await controller.run("chats"); controller.select(CHAT); await controller.run("messages");
  const preparing = controller.run("draft", "Reply"); controller.invalidate(); waiting.resolve(draft()); await preparing;
  assert.equal(controller.snapshot.draft, null); assert.equal(controller.snapshot.pending, null);
});

test("global invalidation during an attempted send preserves the consumed uncertain outcome", async () => {
  const waiting = deferred(); let sends = 0;
  const controller = new AccountController(transport({ send: () => { sends++; return waiting.promise; } }));
  await reviewed(controller); const sending = controller.run("send");
  assert.equal(controller.snapshot.sent.status, "unknown");
  controller.invalidate();
  waiting.resolve({ id: draft().id, chat_id: CHAT, status: "sent", message_id: 77 }); await sending;
  assert.equal(controller.snapshot.sent.status, "unknown"); assert.equal(controller.snapshot.draft, null);
  await controller.run("send"); assert.equal(sends, 1);
});

test("a pre-control cached GET cannot overwrite the fresh disconnected status", async () => {
  const waiting = deferred(); let gets = 0;
  const controller = new AccountController(transport({ status: () => ++gets === 1 ? waiting.promise : Promise.resolve(status({ state: "disconnected", authorized: false })) }));
  const refresh = controller.refresh(), disconnecting = controller.run("disconnect"); waiting.resolve(status());
  await refresh; await disconnecting; assert.equal(gets, 2); assert.equal(controller.snapshot.status.state, "disconnected");
});

test("API hash and login secrets clear synchronously before a request starts", async () => {
  installFakeDom(); const { buildTelegramAccount } = await import("../src/tools/telegram-account.ts");
  const waiting = deferred(), calls = []; const view = buildTelegramAccount(transport({ configure: (input) => { calls.push(input); return waiting.promise; } }));
  view.controller.snapshot.status = status({ authorized: false, state: "disconnected" }); view.sync();
  byID(view, "account-api-id").value = "12345"; byID(view, "account-api-hash").value = "a".repeat(32);
  for (const id of ["account-phone", "account-code", "account-password"]) byID(view, id).value = "private";
  byID(view, "account-save").fire("click");
  for (const id of ["account-api-hash", "account-phone", "account-code", "account-password"]) assert.equal(byID(view, id).value, "");
  assert.deepEqual(calls, [{ api_id: 12345, api_hash: "a".repeat(32) }]); waiting.resolve(status()); await flush();
});

test("login code and 2FA are separate manual requests and never retained in the view", async () => {
  installFakeDom(); const { buildTelegramAccount } = await import("../src/tools/telegram-account.ts"); const calls = [];
  const view = buildTelegramAccount(transport({ verify: async (input) => { calls.push(input); return status(); } }));
  view.controller.snapshot.status = status({ authorized: false, state: "code_required" }); view.sync();
  byID(view, "account-code").value = "12345"; byID(view, "account-password").value = "unused";
  byID(view, "account-verify-code").fire("click"); assert.equal(byID(view, "account-code").value, ""); await flush();
  view.controller.snapshot.status = status({ authorized: false, state: "password_required" }); view.sync();
  byID(view, "account-password").value = "synthetic-2fa"; byID(view, "account-verify-password").fire("click");
  assert.equal(byID(view, "account-password").value, ""); await flush();
  assert.deepEqual(calls, [{ code: "12345" }, { password: "synthetic-2fa" }]);
});

test("Uzbek UI renders private message markup literally and exposes unknown send honestly", async () => {
  installFakeDom(); setLanguage("uz"); const { buildTelegramAccount } = await import("../src/tools/telegram-account.ts");
  const view = buildTelegramAccount(transport({ messages: async () => messages({ messages: [{ id: 1, date: "2026-10-09T10:00:00Z", sender_id: "123", text: "<script>private</script>", out: false }] }),
    send: async () => { throw Error("timeout"); } }));
  try { await reviewed(view.controller); assert.ok(view.el.textContent.includes("<script>private</script>")); assert.equal(view.el.find("SCRIPT").length, 0);
    await view.controller.run("send"); assert.ok(view.el.textContent.includes("Yuborish natijasi noma’lum"));
    view.controller.snapshot.status = status({ teardown_pending: true, stop_complete: false }); view.sync();
    assert.ok(view.el.textContent.includes("hali yopilmoqda")); assert.equal(byID(view, "account-list-chats").disabled, true);
  } finally { setLanguage("en"); }
});

test("Tools tab refreshes only local active status and hiding or switching clears login fields", async () => {
  installFakeDom(); const { buildTools } = await import("../src/tools/view.ts"); let capsGets = 0, accountGets = 0, reads = 0;
  const bot = { configured: false, enabled: false, running: false, allowed_chat_ids: [], last_error: null, bot_username: null };
  const view = buildTools({ capabilities: async () => { capsGets++; return { ok: true, profile: "BALANCED", telegram: bot, computer: { active: false, pending: null, max_actions: 10 } }; } },
    transport({ status: async () => { accountGets++; return status(); }, messages: async () => { reads++; return messages(); } }));
  await view.refresh(); assert.equal(capsGets, 1); assert.equal(accountGets, 0);
  view.setVisible(true); byID(view, "account-tab").fire("click"); await flush(); await view.refresh();
  assert.equal(capsGets, 1); assert.equal(accountGets, 2); assert.equal(reads, 0);
  for (const id of ["account-api-hash", "account-phone", "account-code", "account-password"]) byID(view, id).value = "private";
  view.setVisible(false); for (const id of ["account-api-hash", "account-phone", "account-code", "account-password"]) assert.equal(byID(view, id).value, "");
  byID(view, "account-code").value = "12345"; byID(view, "tools-tab").fire("click"); assert.equal(byID(view, "account-code").value, "");
  await view.refresh(); assert.equal(capsGets, 2);
});

test("explicit Tools selection sends public recipient metadata to both island and Studio", async () => {
  installFakeDom(); const { buildTelegramAccount } = await import("../src/tools/telegram-account.ts");
  const view = buildTelegramAccount(transport({ chats: async () => ({ limit: 30, chats: [chat({ username: "synthetic_user", is_self: true })] }) })); const before = tauriSent("plugin:event|emit_to").length;
  await view.controller.refresh(); await view.controller.run("chats");
  const select = byID(view, "account-chat"); select.value = CHAT; select.fire("change"); await flush();
  assert.deepEqual(tauriSent("plugin:event|emit_to").slice(before), ["island", "studio"].map(label => ({
    target: { kind: "AnyLabel", label }, event: "localai-telegram-context",
    payload: { chat_id: CHAT, title: "Synthetic chat", kind: "user", username: "synthetic_user", is_self: true },
  })));
  select.value = ""; select.fire("change"); await flush();
  assert.deepEqual(tauriSent("plugin:event|emit_to").slice(-2), ["island", "studio"].map(label => ({
    target: { kind: "AnyLabel", label }, event: "localai-telegram-context", payload: null,
  })));
});
