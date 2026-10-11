import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";
import { calls, emit, internals, sent } from "./tauri.mjs";

installFakeDom();
const { buildPrompt } = await import("../src/views/chat.ts");
const { State, DEFAULT_SETTINGS } = await import("../src/core/state.ts");
const { setLanguage } = await import("../src/i18n/i18n.ts");
const plainInvoke = internals.invoke;
let answers = {}, view;
internals.invoke = async (cmd, args) => {
  const plain = await plainInvoke(cmd, args);
  if (cmd in answers) return typeof answers[cmd] === "function" ? answers[cmd](args) : answers[cmd];
  return plain;
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const recipient = { chat_id: "123456789", title: "Synthetic recipient", kind: "user", username: "test_user", is_self: false };
const preview = (extra = {}) => ({ kind: "preview", text: "Review this message.", recipient,
  preview: { id: "synthetic_preview", chat_id: recipient.chat_id, recipient: recipient.title, text: "Exact text\n<script>literal</script>", expires_in: 120, approval_required: true }, source: "literal", ...extra });
const $ = (className) => view.el.querySelector(className);
async function submit(text) { $(".chat-input").value = text; $(".send-btn").fire("click"); await flush(); view.sync(); }

beforeEach(() => {
  if (view) view.setVisible(false);
  calls.length = 0; answers = {}; setLanguage("en");
  State.settings = { ...DEFAULT_SETTINGS, chatModels: {} }; State.chatHistory = []; State.stateOverride = null;
  State.view = "prompt"; State.mode = "expanded"; State.paused = false; State.droppedFile = null;
  view = buildPrompt(() => {}); view.setVisible(true); view.sync();
});

test("ordinary chat retains provider behavior and makes no personal Telegram call", async () => {
  answers.chat_send = { text: "A normal answer." };
  await submit("Explain a sunset");
  assert.deepEqual(sent("chat_send"), [{ query: "Explain a sunset", context: null }]);
  assert.deepEqual(sent("local_ai_account_command"), []); assert.deepEqual(sent("local_ai_account_status"), []);
  assert.equal(State.chatHistory.at(-1).content, "A normal answer.");
});

test("an explicit draft request produces an exact plain-text approval card without calling the provider", async () => {
  answers.local_ai_account_command = preview(); await submit('@test_user ga "Exact text" qoralama tayyorla');
  assert.equal(sent("chat_send").length, 0); assert.equal(sent("local_ai_account_send").length, 0);
  assert.equal($(".chat-telegram-card").hidden, false); assert.equal($(".chat-telegram-send").disabled, false);
  assert.equal($(".chat-telegram-text").textContent, preview().preview.text); assert.equal(view.el.find("SCRIPT").length, 0);
  assert.match($(".chat-telegram-recipient").textContent, /Synthetic recipient.*@test_user.*123456789/);
  assert.ok(!State.chatHistory.at(-1).content.includes("<script>"));
});

test("one-shot approval waits for a matching Telegram acknowledgement", async () => {
  const wait = deferred(); answers.local_ai_account_command = preview(); answers.local_ai_account_send = () => wait.promise;
  await submit('@test_user ga "Salom" qoralama tayyorla');
  $(".chat-telegram-send").fire("click"); $(".chat-telegram-send").fire("click");
  assert.deepEqual(sent("local_ai_account_send"), [{ id: "synthetic_preview" }]);
  assert.match($(".chat-telegram-summary").textContent, /Sending/);
  assert.ok(!$(".chat-telegram-summary").textContent.includes("confirmed"));
  wait.resolve({ id: "synthetic_preview", chat_id: recipient.chat_id, status: "sent", message_id: 17 }); await flush(); view.sync();
  assert.match($(".chat-telegram-summary").textContent, /confirmed/);
  assert.equal($(".chat-telegram-send").disabled, true);
});

test("unknown send remains consumed across Stop and has no retry approval", async () => {
  const wait = deferred(); answers.local_ai_account_command = preview(); answers.local_ai_account_send = () => wait.promise;
  await submit('@test_user ga "Salom" yubor');
  emit("localai-account-invalidated", null); wait.reject(new Error("private transport diagnostic")); await flush(); view.sync();
  assert.match($(".chat-telegram-summary").textContent, /result is unknown/);
  assert.equal($(".chat-telegram-send").disabled, true); assert.equal($(".chat-telegram-text").textContent, "");
  assert.ok(!view.el.textContent.includes("private transport diagnostic"));
  $(".chat-telegram-send").fire("click"); assert.equal(sent("local_ai_account_send").length, 1);
});

test("an ordinary how-to question uses the provider while negative message intent stays local", async () => {
  answers.chat_send = { text: "Ordinary how-to answer." };
  await submit("Telegramda xabar qanday yuboraman?");
  assert.equal(sent("local_ai_account_command").length, 0); assert.equal(sent("chat_send").length, 1);
  assert.equal(State.chatHistory.at(-1).content, "Ordinary how-to answer.");
  await submit("Telegramda @test_user ga Salom yuborma");
  assert.equal(sent("local_ai_account_command").length, 0); assert.equal(sent("chat_send").length, 1);
  assert.match(State.chatHistory.at(-1).content, /name its recipient/);
});

test("unknown recipient and local failures never fall back to a cloud provider", async () => {
  answers.local_ai_account_command = { kind: "clarification", text: "Choose one recipient." };
  await submit("Telegramda Ali ga Salom yubor"); assert.equal(State.chatHistory.at(-1).content, "Choose one recipient.");
  answers.local_ai_account_command = () => { throw new Error("private RPC diagnostic"); };
  await submit("Telegramda Ali ga Salom yubor"); assert.match(State.chatHistory.at(-1).content, /Nothing was sent/);
  assert.equal(sent("chat_send").length, 0); assert.equal(sent("local_ai_account_send").length, 0);
  assert.ok(!view.el.textContent.includes("private RPC diagnostic"));
});

test("malformed or swapped recipient preview never enables approval", async () => {
  answers.local_ai_account_command = preview({ recipient: { ...recipient, chat_id: "987654321" } });
  await submit('@test_user ga "Salom" yubor');
  assert.equal($(".chat-telegram-send").disabled, true); assert.equal($(".chat-telegram-card").hidden, true);
  assert.equal(sent("local_ai_account_send").length, 0); assert.equal(sent("chat_send").length, 0);
});

test("shuni uses only the verified ordinary assistant reply as exact message context", async () => {
  const body = "Ordinary reply\nwith punctuation?!"; answers.chat_send = { text: body }; await submit("Write a greeting");
  answers.local_ai_account_command = preview(); await submit("@test_user ga shuni yubor");
  assert.deepEqual(sent("local_ai_account_command").at(-1), { query: "@test_user ga shuni yubor", chatId: undefined, messageText: body });
  await submit("shunga shuni yubor");
  assert.deepEqual(sent("local_ai_account_command").at(-1), { query: "shunga shuni yubor", chatId: recipient.chat_id, messageText: body });
  assert.equal(sent("chat_send").length, 1);
});

test("action clarification and preview notices never become referenced message text", async () => {
  answers.local_ai_account_command = { kind: "clarification", text: "Pick a chat." }; await submit("shunga shuni yubor");
  answers.local_ai_account_command = preview(); await submit("@test_user ga shuni yubor");
  assert.equal(sent("local_ai_account_command").at(-1).messageText, undefined);
});

test("New Chat cancels preview and clears recipient and reply references", async () => {
  answers.chat_send = { text: "Ordinary reply" }; await submit("Write a greeting");
  answers.local_ai_account_command = preview(); await submit("@test_user ga shuni qoralama tayyorla");
  State.chatHistory = []; view.sync();
  assert.equal($(".chat-telegram-card").hidden, true); assert.equal($(".chat-telegram-context").hidden, true);
  assert.deepEqual(sent("local_ai_account_cancel_draft").at(-1), { id: "synthetic_preview" });
  await submit("shunga shuni yubor");
  assert.equal(sent("local_ai_account_command").at(-1).chatId, undefined); assert.equal(sent("local_ai_account_command").at(-1).messageText, undefined);
});

test("late command response after hiding is revoked and cannot restore the send button", async () => {
  const wait = deferred(); answers.local_ai_account_command = () => wait.promise;
  await submit('@test_user ga "Salom" yubor'); view.setVisible(false); wait.resolve(preview()); await flush(); view.setVisible(true); view.sync();
  assert.equal($(".chat-telegram-send").disabled, true); assert.equal($(".chat-telegram-card").hidden, true);
  assert.deepEqual(sent("local_ai_account_cancel_draft").at(-1), { id: "synthetic_preview" });
  assert.equal(State.chatHistory.length, 1);
});

test("late ordinary reply after reset cannot corrupt the new chat or message reference", async () => {
  const wait = deferred(); answers.chat_send = () => wait.promise; await submit("Write a greeting");
  State.chatHistory = []; view.sync(); wait.resolve({ text: "Old reply" }); await flush(); view.sync();
  assert.equal(State.chatHistory.length, 0); assert.equal($(".chat-input").disabled, false);
  answers.local_ai_account_command = { kind: "clarification", text: "Which text?" }; await submit("shunga shuni yubor");
  assert.equal(sent("local_ai_account_command").at(-1).messageText, undefined);
});

test("an explicit Tools chat selection becomes visible public recipient context", async () => {
  emit("localai-telegram-context", recipient); answers.local_ai_account_command = preview(); await submit("Salom yubor");
  assert.equal(sent("local_ai_account_command").at(-1).chatId, recipient.chat_id);
  assert.match($(".chat-telegram-context").textContent, /Synthetic recipient/);
});

test("recipient context does not hijack ordinary coding, story or planning prompts", async () => {
  emit("localai-telegram-context", recipient); answers.chat_send = (args) => ({ text: `Ordinary response: ${args.query}` });
  for (const query of ["menga Python kod yozib ber", "hikoya yozib ber", "reja tayyorla"]) await submit(query);
  assert.equal(sent("chat_send").length, 3); assert.equal(sent("local_ai_account_command").length, 0);
  answers.local_ai_account_command = preview(); await submit("shunga shuni yubor");
  assert.equal(sent("local_ai_account_command").at(-1).messageText, "Ordinary response: reja tayyorla");
});

test("ordinary Telegram-topic coding and story prompts keep the selected provider", async () => {
  emit("localai-telegram-context", recipient); answers.chat_send = { text: "Ordinary Telegram-topic reply." };
  for (const query of ["Telegram bot uchun Python kod yozib ber", "Telegram haqida hikoya yozib ber", "Explain '@test_user send hello'"]) await submit(query);
  assert.equal(sent("chat_send").length, 3); assert.equal(sent("local_ai_account_command").length, 0);
  assert.equal(State.chatHistory.at(-1).content, "Ordinary Telegram-topic reply.");
});

test("Telegram sending nouns in a coding request do not become action directives", async () => {
  emit("localai-telegram-context", recipient); answers.chat_send = { text: "Ordinary Python code reply." };
  for (const query of ["Telegram bot uchun xabar yuborish kodini yozib ber", "Telegram xabar yuboruvchi Python dastur yozib ber"]) await submit(query);
  assert.equal(sent("chat_send").length, 2); assert.equal(sent("local_ai_account_command").length, 0);
});

test("Tools context and account invalidation do not discard an ordinary provider reply", async () => {
  const wait = deferred(); answers.chat_send = () => wait.promise; await submit("Write a greeting");
  emit("localai-telegram-context", recipient); emit("localai-account-invalidated", null);
  wait.resolve({ text: "Ordinary reply after context changes" }); await flush(); view.sync();
  assert.equal(State.chatHistory.at(-1).content, "Ordinary reply after context changes");
  assert.equal($(".chat-input").disabled, false); assert.equal(sent("local_ai_account_command").length, 0);
});

test("unquoted literal question text is prepared by the backend without rewriting", async () => {
  answers.local_ai_account_command = preview({ preview: { ...preview().preview, text: "Qanday yuribsiz?" } });
  answers.local_ai_account_send = { id: "synthetic_preview", chat_id: recipient.chat_id, status: "sent", message_id: 17 };
  await submit("@test_user ga Qanday yuribsiz? yubor");
  assert.equal(sent("local_ai_account_command").at(-1).query, "@test_user ga Qanday yuribsiz? yubor");
  assert.equal(sent("local_ai_account_send").length, 1); assert.equal(sent("chat_send").length, 0);
  assert.match(State.chatHistory.at(-1).content, /confirmed/);
});

test("clearing Tools recipient context invalidates the inline approval", async () => {
  emit("localai-telegram-context", recipient); answers.local_ai_account_command = preview(); await submit("@test_user ga qoralama tayyorla");
  emit("localai-telegram-context", null); view.sync();
  assert.equal($(".chat-telegram-context").hidden, true); assert.equal($(".chat-telegram-send").disabled, true);
  assert.deepEqual(sent("local_ai_account_cancel_draft").at(-1), { id: "synthetic_preview" });
});

test("Uzbek Cyrillic command and prior-answer references use the same local typed route", async () => {
  answers.chat_send = { text: "Salom!\nO‘zgarmagan matn." }; await submit("Write a greeting");
  emit("localai-telegram-context", recipient); answers.local_ai_account_command = preview();
  await submit("шунга шуни юбор");
  assert.deepEqual(sent("local_ai_account_command").at(-1), { query: "шунга шуни юбор", chatId: recipient.chat_id, messageText: "Salom!\nO‘zgarmagan matn." });
});

test("model deltas cannot overwrite Telegram preview or clarification", async () => {
  const wait = deferred(); answers.local_ai_account_command = () => wait.promise;
  await submit('@test_user ga "Salom" qoralama tayyorla'); emit("chat-delta", "Fake model sent status");
  wait.resolve(preview()); await flush(); view.sync();
  assert.equal($(".chat-telegram-text").textContent, preview().preview.text); assert.ok(!view.el.textContent.includes("Fake model sent status"));
});

test("an authorized literal command sends its verified ID once without approval clicks", async () => {
  const query = '@test_user ga "Qoralama? <script>literal</script>" yubor';
  answers.local_ai_account_command = preview();
  answers.local_ai_account_send = { id: "synthetic_preview", chat_id: recipient.chat_id, status: "sent", message_id: 17 };
  await submit(query);
  assert.deepEqual(sent("local_ai_account_command"), [{ query, chatId: undefined, messageText: undefined }]);
  assert.deepEqual(sent("local_ai_account_send"), [{ id: "synthetic_preview" }]);
  assert.equal(sent("chat_send").length, 0); assert.match(State.chatHistory.at(-1).content, /confirmed/);
  assert.equal($(".chat-telegram-send").disabled, true); assert.equal(view.el.find("SCRIPT").length, 0);
});

test("explicit natural reply conjugations generate and send once without requiring qoralama", async () => {
  let index = 0; emit("localai-telegram-context", recipient);
  answers.local_ai_account_command = () => preview({ source: "draft", preview: { ...preview().preview, id: `reply_${++index}`, text: "Local reply" } });
  answers.local_ai_account_send = (args) => ({ id: args.id, chat_id: recipient.chat_id, status: "sent", message_id: index + 17 });
  for (const verb of ["ber", "bering", "bergin", "bersin", "yoz", "yozing", "yozgin", "yozsin", "yozaver", "yozaversin", "yozavering", "yozib ber"]) await submit(`unga javob ${verb}`);
  assert.equal(sent("local_ai_account_command").length, 12); assert.equal(sent("local_ai_account_send").length, 12);
  assert.equal(new Set(sent("local_ai_account_send").map((args) => args.id)).size, 12);
  assert.equal(sent("chat_send").length, 0); assert.match(State.chatHistory.at(-1).content, /confirmed/);
});

test("bare natural reply requests remain ordinary provider chat even with a selected Telegram context", async () => {
  emit("localai-telegram-context", recipient); answers.chat_send = { text: "Ordinary reply instructions." };
  for (const query of ["javob ber", "javob bering", "yozib ber", "yozavering"]) await submit(query);
  assert.equal(sent("chat_send").length, 4); assert.equal(sent("local_ai_account_command").length, 0);
  assert.equal(sent("local_ai_account_send").length, 0);
});

test("submission stays locked across command planning and automatic send", async () => {
  const planning = deferred(), sending = deferred(); answers.local_ai_account_command = () => planning.promise;
  answers.local_ai_account_send = () => sending.promise;
  await submit('@test_user ga "Salom" yubor');
  assert.equal($(".chat-input").disabled, true); $(".send-btn").fire("click");
  planning.resolve(preview()); await flush(); view.sync();
  assert.equal($(".chat-input").disabled, true); assert.equal($(".send-btn").disabled, true);
  $(".send-btn").fire("click"); $(".chat-telegram-send").fire("click");
  assert.equal(sent("local_ai_account_command").length, 1); assert.equal(sent("local_ai_account_send").length, 1);
  sending.resolve({ id: "synthetic_preview", chat_id: recipient.chat_id, status: "sent", message_id: 17 }); await flush(); view.sync();
  assert.equal($(".chat-input").disabled, false); assert.equal($(".send-btn").disabled, false);
});

test("only preview-only requests stay manual, while qoralama plus an explicit send is automatic", async () => {
  answers.local_ai_account_command = preview({ source: "draft" });
  answers.local_ai_account_send = { id: "synthetic_preview", chat_id: recipient.chat_id, status: "sent", message_id: 17 };
  await submit("@test_user ga qisqa tabrik qoralama yozib ber");
  assert.equal(sent("local_ai_account_send").length, 0); assert.equal($(".chat-telegram-send").disabled, false);
  await submit("@test_user ga qisqa tabrik qoralama yozib ber yubor");
  assert.equal(sent("local_ai_account_send").length, 1); assert.equal($(".chat-telegram-send").disabled, true);
});

test("Stop between accepting a preview and dispatching prevents the automatic send", async () => {
  answers.local_ai_account_command = preview(); const originalNotify = State.notify;
  let invalidated = false;
  State.notify = function () {
    if (!invalidated && $(".chat-body").classList.contains("telegram-preview")) { invalidated = true; emit("localai-account-invalidated", null); }
    return originalNotify.call(this);
  };
  try {
    await submit('@test_user ga "Salom" yubor');
    assert.equal(invalidated, true); assert.equal(sent("local_ai_account_send").length, 0);
    assert.deepEqual(sent("local_ai_account_cancel_draft").at(-1), { id: "synthetic_preview" });
    assert.equal($(".chat-telegram-send").disabled, true);
  } finally { State.notify = originalNotify; }
});

test("reset during planning revokes a late verified preview without automatic sending", async () => {
  const planning = deferred(); answers.local_ai_account_command = () => planning.promise;
  await submit('@test_user ga "Salom" yubor'); State.chatHistory = []; view.sync();
  planning.resolve(preview()); await flush(); view.sync();
  assert.equal(sent("local_ai_account_send").length, 0); assert.equal(State.chatHistory.length, 0);
  assert.deepEqual(sent("local_ai_account_cancel_draft").at(-1), { id: "synthetic_preview" });
});

test("automatic malformed send acknowledgement remains unknown and offers no retry", async () => {
  answers.local_ai_account_command = preview();
  answers.local_ai_account_send = { id: "swapped_id", chat_id: recipient.chat_id, status: "sent", message_id: 17 };
  await submit('@test_user ga "Salom" yubor');
  assert.equal(sent("local_ai_account_send").length, 1); assert.match(State.chatHistory.at(-1).content, /result is unknown/);
  assert.equal($(".chat-telegram-send").disabled, true); $(".chat-telegram-send").fire("click");
  assert.equal(sent("local_ai_account_send").length, 1);
});

test("missing natural reply context clarifies without a send or provider fallback", async () => {
  answers.local_ai_account_command = { kind: "clarification", text: "Choose a recipient first." };
  await submit("unga javob ber");
  assert.equal(sent("local_ai_account_send").length, 0); assert.equal(sent("chat_send").length, 0);
  assert.equal(State.chatHistory.at(-1).content, "Choose a recipient first.");
  for (const query of ["unga javob bermang", "unga javob ber?"]) await submit(query);
  assert.equal(sent("local_ai_account_command").length, 1); assert.equal(sent("local_ai_account_send").length, 0);
});
