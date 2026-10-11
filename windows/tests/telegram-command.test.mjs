import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTelegramCommand, parseTelegramCommand, telegramRequestNeedsClarification, telegramUsesMessageReference, telegramExplicitReviewRequested,
  TelegramActionController,
} from "../src/core/telegram-command.ts";

const recipient = { chat_id: "123456789", title: "Synthetic recipient", kind: "user", username: "test_user", is_self: false };
const preview = (extra = {}) => ({ kind: "preview", text: "Review this message.", recipient,
  preview: { id: "synthetic_preview", chat_id: recipient.chat_id, recipient: recipient.title,
    text: "Exact text\n<script>literal</script>", expires_in: 120, approval_required: true }, source: "literal", ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("the Telegram intent gate keeps ordinary chat away from account APIs", () => {
  for (const text of ["hello", "write a poem", "Telegram nima?", "How does Telegram work?", "@test_user profile", "Salom yoz", 'Explain "@test_user send hello"', 'Explain this: "text\n@test_user send hello"', "Explain `@test_user send hello`", "Explain '@test_user send hello'", "Send email to person@example.com", "Telegram bot uchun Python kod yozib ber", "Telegram haqida hikoya yozib ber"]) assert.equal(isTelegramCommand(text), false, text);
  for (const text of ['@test_user ga "Salom" yubor', "Telegramda Ali ga Salom yoz", "Telegramda Aliga Salom yoz", "shunga shuni yubor", "Send a message to @test_user", "Отправь @test_user привет", "шунга шуни юбор", "Телеграмда @test_user га салом жўнат", "унга буни ёз", "@test_user ga qoralama tayyorla", "Prepare a draft for @test_user", "@test_user га қоралама тайёрла", "@test_user ga 'O'zbekiston' yubor"]) assert.equal(isTelegramCommand(text), true, text);
  assert.equal(isTelegramCommand("Salom yubor", true), true);
  for (const text of ["menga Python kod yozib ber", "hikoya yozib ber", "reja tayyorla", "qoralama yozib ber", "write a poem", "prepare a plan", "Telegram bot uchun Python kod yozib ber", "Telegram haqida hikoya yozib ber", "Telegram bot uchun xabar yuborish kodini yozib ber", "Telegram xabar yuboruvchi Python dastur yozib ber"]) assert.equal(isTelegramCommand(text, true), false, text);
  for (const text of ["Salom yubor", "Salom yuboring", "Salom yuborsin", "Salom yuborsang", "Salom yuboraver", "Salom jo‘nating"]) assert.equal(isTelegramCommand(text, true), true, text);
});

test("bounded natural reply wording requires an explicit recipient", () => {
  for (const verb of ["javob ber", "javob bering", "javob bergin", "javob bersin", "yoz", "yozing", "yozgin", "yozsin", "yozaver", "yozaversin", "yozavering", "yozib ber"]) {
    assert.equal(isTelegramCommand(`unga ${verb}`), true, verb);
    assert.equal(isTelegramCommand(`@test_user ga ${verb}`), true, verb);
    assert.equal(isTelegramCommand(verb), false, `${verb} without recipient`);
    assert.equal(isTelegramCommand(verb, true), false, `${verb} cannot silently use old selected context`);
  }
  assert.equal(isTelegramCommand("унга жавоб беринг"), true);
  assert.equal(isTelegramCommand("unga yozuvchi haqida tushuntir"), false);
  assert.equal(isTelegramCommand("Explain 'unga javob ber'"), false);
  for (const query of ["unga javob berma", "unga javob bermang", "unga javob ber?", "unga yozavering?"]) {
    assert.equal(isTelegramCommand(query), true, query); assert.equal(telegramRequestNeedsClarification(query), true, query);
  }
  assert.equal(telegramRequestNeedsClarification("@test_user ga nega kech qolganim haqida javob yozing"), false);
  assert.equal(telegramRequestNeedsClarification("unga nega kech qolganim haqida javob bering"), false);
});

test("only preview-only wording requests manual review, and literal words never change send policy", () => {
  for (const query of ["@test_user ga qoralama yozib ber", "@test_user ga draft prepare", "@test_user preview message", "унга қоралама ёз"]) assert.equal(telegramExplicitReviewRequested(query), true, query);
  for (const query of ["unga javob ber", "@test_user ga qoralama yozib ber yubor", '@test_user ga "qoralama draft preview" yubor', "@test_user ga 'qoralama' yoz", "@test_user ga draft send"]) assert.equal(telegramExplicitReviewRequested(query), false, query);
});

test("negative requests and questions cannot make a send preview", () => {
  for (const text of ["Telegramda @test_user ga yuborma", "Do not send @test_user anything", "Не отправляй @test_user привет", "Telegramda xabar qanday yuboriladi?", "How do I send a Telegram message?"]) assert.equal(telegramRequestNeedsClarification(text), true, text);
  assert.equal(telegramRequestNeedsClarification('@test_user ga "Qanday? Yuborma." yubor'), false, "literal message punctuation and words are excluded from intent");
  assert.equal(telegramRequestNeedsClarification("@test_user ga Qanday yuribsiz? yubor"), false, "unquoted literal question body reaches the typed backend parser");
  assert.equal(telegramRequestNeedsClarification("@test_user ga Do not send another reply yubor"), false, "unquoted literal negative phrase is still a message body");
});

test("a message reference is distinct from a recipient pronoun", () => {
  assert.equal(telegramUsesMessageReference("shunga shuni yubor"), true);
  assert.equal(telegramUsesMessageReference("шунга шуни юбор"), true);
  for (const text of ["shu javobni @test_user ga yubor", "shu xabarni @test_user ga yubor", "shu habarni @test_user ga yubor", "oxirgi javobni @test_user ga yubor", "oldingi javobni @test_user ga yubor", "mana shuni @test_user ga yubor"]) assert.equal(telegramUsesMessageReference(text), true, text);
  assert.equal(telegramUsesMessageReference("unga Salom yubor"), false);
  assert.equal(telegramUsesMessageReference('@test_user ga "shuni" yubor'), false);
});

test("command preview is typed and retains exact message text", () => {
  const result = parseTelegramCommand(preview());
  assert.equal(result.preview.text, "Exact text\n<script>literal</script>");
  assert.deepEqual(result.recipient, recipient);
  assert.deepEqual(parseTelegramCommand({ kind: "clarification", text: "Which chat?" }), { kind: "clarification", text: "Which chat?" });
});

test("malformed recipients, swapped approvals and unsupported action results fail closed", () => {
  const good = preview();
  for (const value of [null, { kind: "sent", text: "Sent!" }, { kind: "chat", text: "Done", preview: good.preview },
    { ...good, source: "execute" }, { ...good, recipient: { ...recipient, chat_id: "987654321" } },
    { ...good, recipient: { ...recipient, username: "<script>" } }, { ...good, recipient: { ...recipient, is_self: "true" } },
    { ...good, preview: { ...good.preview, approval_required: false } }, { ...good, preview: { ...good.preview, expires_in: 121 } },
    { ...good, preview: { ...good.preview, recipient: "Swapped recipient" } }, { ...good, preview: { ...good.preview, text: "a\0b" } }]) assert.throws(() => parseTelegramCommand(value));
});

test("approval consumes its ID synchronously before one transport call", async () => {
  const wait = deferred(), sends = [], cancels = [];
  const controller = new TelegramActionController({ send: async (id) => { sends.push(id); return wait.promise; }, cancel: async (id) => { cancels.push(id); } });
  controller.accept(parseTelegramCommand(preview()));
  const running = controller.send();
  assert.equal(controller.snapshot.preview, null); assert.equal(controller.snapshot.pending, true);
  assert.equal(controller.snapshot.result.status, "unknown");
  await controller.send(); assert.deepEqual(sends, ["synthetic_preview"]); assert.deepEqual(cancels, []);
  wait.resolve({ id: "synthetic_preview", chat_id: recipient.chat_id, status: "sent", message_id: 17 }); await running;
  assert.equal(controller.snapshot.result.status, "sent");
  await controller.send(); assert.equal(sends.length, 1);
});

test("timeout and mismatched send acknowledgement keep unknown consumed outcome", async () => {
  for (const response of [() => { throw new Error("timeout"); }, () => ({ id: "other", chat_id: recipient.chat_id, status: "sent", message_id: 17 })]) {
    let sends = 0;
    const controller = new TelegramActionController({ send: async () => { sends++; return response(); }, cancel: async () => {} });
    controller.accept(parseTelegramCommand(preview())); await controller.send(); controller.invalidate(); await controller.send();
    assert.equal(controller.snapshot.result.status, "unknown"); assert.equal(sends, 1); assert.equal(controller.snapshot.preview, null);
  }
});

test("cancel, expiry, replacement and late result discard revoke only their exact IDs", () => {
  const cancelled = [], controller = new TelegramActionController({ send: async () => {}, cancel: async (id) => { cancelled.push(id); } });
  controller.accept(parseTelegramCommand(preview())); controller.cancel();
  assert.equal(controller.snapshot.result.status, "cancelled");
  controller.accept(parseTelegramCommand(preview({ preview: { ...preview().preview, id: "expired" } })));
  controller.snapshot.expiresAt = Date.now() - 1; controller.expire();
  assert.equal(controller.snapshot.preview, null); assert.match(controller.snapshot.error, /expired/);
  controller.discardResponse(preview({ preview: { ...preview().preview, id: "late" } }));
  assert.deepEqual(cancelled, ["synthetic_preview", "expired", "late"]);
});

test("hiding during a send preserves its uncertain result and cannot revive an approval", async () => {
  const wait = deferred(), controller = new TelegramActionController({ send: async () => wait.promise, cancel: async () => {} });
  controller.accept(parseTelegramCommand(preview())); const sending = controller.send(); controller.invalidate();
  assert.equal(controller.snapshot.result.status, "unknown"); assert.equal(controller.snapshot.preview, null);
  wait.reject(new Error("offline")); await sending;
  assert.equal(controller.snapshot.result.status, "unknown");
});

test("a fresh proof for the same uncertain body is revoked across hide/reset without another send", async () => {
  const sends = [], cancels = [];
  const controller = new TelegramActionController({
    send: async (id) => { sends.push(id); if (id === "synthetic_preview") throw new Error("timeout"); return { id, chat_id: recipient.chat_id, status: "sent", message_id: 18 }; },
    cancel: async (id) => { cancels.push(id); },
  });
  controller.accept(parseTelegramCommand(preview())); await controller.send(); controller.invalidate();
  controller.accept(parseTelegramCommand(preview({ preview: { ...preview().preview, id: "new_same_proof" } })));
  await controller.send();
  assert.deepEqual(sends, ["synthetic_preview"]); assert.deepEqual(cancels, ["new_same_proof"]);
  assert.equal(controller.snapshot.preview, null); assert.equal(controller.snapshot.result.status, "unknown");
  assert.match(controller.snapshot.error, /unknown/);
  controller.accept(parseTelegramCommand(preview({ preview: { ...preview().preview, id: "different_body", text: "A different explicit message" } })));
  await controller.send(); assert.equal(controller.snapshot.result.status, "sent");
  controller.accept(parseTelegramCommand(preview({ preview: { ...preview().preview, id: "same_after_other_send" } })));
  await controller.send(); assert.deepEqual(sends, ["synthetic_preview", "different_body"]);
  assert.equal(controller.snapshot.result.status, "unknown");
  controller.acknowledgeUnknown(); assert.equal(controller.snapshot.result, null);
  assert.deepEqual(sends, ["synthetic_preview", "different_body"], "acknowledgement never sends or creates a new proof");
  controller.accept(parseTelegramCommand(preview({ preview: { ...preview().preview, id: "explicit_after_check" } })));
  await controller.send(); assert.deepEqual(sends, ["synthetic_preview", "different_body", "explicit_after_check"]);
});

test("uncertainty capacity never evicts an older unresolved body to allow a duplicate", async () => {
  const sends = [], cancelled = [];
  const controller = new TelegramActionController({ send: async id => { sends.push(id); throw new Error("timeout"); }, cancel: async id => cancelled.push(id) });
  const response = (id, text) => parseTelegramCommand(preview({ preview: { ...preview().preview, id, text } }));
  for (let index = 0; index < 32; index++) { controller.accept(response(`proof_${index}`, `Body ${index}`)); await controller.send(); }
  controller.accept(response("capacity_overflow", "Body 32")); await controller.send();
  controller.accept(response("original_again", "Body 0")); await controller.send();
  assert.equal(sends.length, 32); assert.deepEqual(cancelled, ["capacity_overflow", "original_again"]);
  assert.equal(controller.snapshot.result.id, "proof_0");
  controller.acknowledgeUnknown(); controller.accept(response("after_check", "Body 32")); await controller.send();
  assert.equal(sends.length, 33);
});
