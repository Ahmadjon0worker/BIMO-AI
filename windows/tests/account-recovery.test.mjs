import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AccountController } from "../src/core/telegram-account.ts";
import { buildTelegramAccount } from "../src/tools/telegram-account.ts";
import { installFakeDom } from "./fakedom.mjs";
import { setLanguage } from "../src/i18n/i18n.ts";

const API_ID = 12345, CHAT = "-1009007199254740993";
const status = (extra = {}) => ({ available: true, configured: true, api_id: API_ID,
  state: "disconnected", authorized: false, busy: false, has_saved_session: false,
  username: null, dialog_count: 0, selected_chat_id: null, last_error: null, ...extra });
const codeRequired = (extra = {}) => status({ state: "code_required", ...extra });
const passwordRequired = (extra = {}) => status({ state: "password_required", ...extra });
const authorized = (extra = {}) => status({ state: "authorized", authorized: true,
  has_saved_session: true, username: "synthetic_user", dialog_count: 1, selected_chat_id: CHAT, ...extra });
const reviewedDraft = { id: "synthetic-reviewed-id", chat_id: CHAT, recipient: "Synthetic recipient",
  text: "Synthetic preview only", expires_in: 120, approval_required: true };
const fail = (message) => async () => { throw Error(message); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

function wire(initial = status(), overrides = {}) {
  let current = initial, blocked = null;
  const calls = [];
  const api = {
    status: async () => {
      calls.push("status");
      if (blocked) return blocked;
      if (current instanceof Error) throw current;
      return current;
    },
    configure: async () => { calls.push("configure"); return current; },
    connect: async () => { calls.push("connect"); return current; },
    verify: async () => { calls.push("verify"); return current; },
    disconnect: async () => { calls.push("disconnect"); return current; },
    chats: async () => { calls.push("chats"); return { limit: 30, chats: [
      { chat_id: CHAT, title: "Synthetic recipient", kind: "user", unread_count: 0, can_send: true }] }; },
    messages: async () => { calls.push("messages"); return { chat_id: CHAT, title: "Synthetic recipient", limit: 20, messages: [] }; },
    draft: async () => { calls.push("draft"); return reviewedDraft; },
    send: async () => { calls.push("send"); throw Error("Synthetic send timeout"); },
    ...overrides,
  };
  return { api, calls, set(value) { current = value; }, block(promise) { blocked = promise; }, unblock() { blocked = null; } };
}
const byID = (view, id) => {
  const node = [...view.el.walk()].find((element) => element.getAttribute("id") === id);
  assert.ok(node, `Expected UI element #${id}`);
  return node;
};
function visible(node) {
  for (let current = node; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute("hidden") != null) return false;
  }
  return true;
}
function mount(api) {
  installFakeDom(); setLanguage("en");
  const view = buildTelegramAccount(api);
  document.body.append(view.el); view.setVisible(true);
  return view;
}
async function reviewed(controller) {
  await controller.refresh(); await controller.run("chats"); controller.select(CHAT);
  await controller.run("messages"); await controller.run("draft", "Synthetic draft instruction");
}
afterEach(() => setLanguage("en"));

test("a failed connect clears only after clean cached status reaches the requested code stage", async () => {
  const backend = wire(status());
  backend.api.connect = async () => { backend.set(codeRequired()); throw Error("HTTP 400: stale connect failure"); };
  const controller = new AccountController(backend.api);
  await controller.refresh(); await controller.run("connect");
  assert.equal(controller.snapshot.status.state, "code_required");
  assert.equal(controller.snapshot.error, "");
  backend.set(Error("Local router is offline")); await controller.refresh();
  assert.equal(controller.snapshot.status, null);
  assert.match(controller.snapshot.error, /offline/);
});

test("wrong login code stays actionable until the authoritative stage actually advances", async () => {
  const backend = wire(codeRequired(), { verify: fail("HTTP 400: wrong login code") });
  const controller = new AccountController(backend.api);
  await controller.refresh(); await controller.run("verify", { code: "00000" });
  await controller.refresh(); assert.match(controller.snapshot.error, /wrong login code/);
  assert.equal(controller.snapshot.status.state, "code_required");
  backend.set(passwordRequired()); await controller.refresh();
  assert.equal(controller.snapshot.error, "");
  assert.equal(controller.snapshot.status.state, "password_required");
});

test("password failure remains on the same stage and clears after coherent authorization", async () => {
  const backend = wire(passwordRequired(), { verify: fail("HTTP 400: wrong synthetic password") });
  const controller = new AccountController(backend.api);
  await controller.refresh(); await controller.run("verify", { password: "synthetic-test-value" });
  assert.match(controller.snapshot.error, /wrong synthetic password/);
  backend.set(authorized({ authorized: false })); await controller.refresh();
  assert.match(controller.snapshot.error, /wrong synthetic password/);
  backend.set(authorized()); await controller.refresh();
  assert.equal(controller.snapshot.error, "");
});

for (const [name, extra] of [
  ["backend error", { last_error: "Synthetic backend attention required" }],
  ["error state", { state: "error" }],
  ["still busy", { busy: true }],
  ["teardown pending", { teardown_pending: true }],
  ["support unavailable", { available: false }],
  ["different API identity", { api_id: 54321 }],
  ["incoherent authorization", { authorized: true }],
]) test(`healthy-looking auth polling does not erase connect failure with ${name}`, async () => {
  const backend = wire(status(), { connect: fail("HTTP 400: retained connect failure") });
  const controller = new AccountController(backend.api);
  await controller.refresh(); await controller.run("connect");
  backend.set(codeRequired(extra)); await controller.refresh();
  assert.match(controller.snapshot.error, /retained connect failure/);
});

test("verification progress from another API identity cannot resolve the failed login", async () => {
  const backend = wire(codeRequired(), { verify: fail("HTTP 400: retained verification failure") });
  const controller = new AccountController(backend.api);
  await controller.refresh(); await controller.run("verify", { code: "00000" });
  backend.set(authorized({ api_id: 54321 })); await controller.refresh();
  assert.match(controller.snapshot.error, /retained verification failure/);
});

test("configure reconciliation matches the attempted public API ID", async () => {
  const backend = wire(status({ configured: false, api_id: null }), { configure: fail("HTTP 400: configure failure") });
  const controller = new AccountController(backend.api);
  await controller.refresh(); await controller.run("configure", { api_id: API_ID, api_hash: "a".repeat(32) });
  backend.set(status({ api_id: 54321 })); await controller.refresh();
  assert.match(controller.snapshot.error, /configure failure/);
  backend.set(status()); await controller.refresh(); assert.equal(controller.snapshot.error, "");
});

test("a rejected hash update is not hidden by an unchanged previously configured API ID", async () => {
  const backend = wire(status(), { configure: fail("HTTP 400: rejected synthetic hash") });
  const controller = new AccountController(backend.api);
  await controller.refresh(); await controller.run("configure", { api_id: API_ID, api_hash: "a".repeat(32) });
  await controller.refresh(); assert.match(controller.snapshot.error, /rejected synthetic hash/);
  backend.set(codeRequired()); await controller.refresh(); assert.equal(controller.snapshot.error, "");
});

test("configure completion can be reconciled from a changed public API ID", async () => {
  const backend = wire(status(), { configure: fail("Synthetic configuration timeout") });
  const controller = new AccountController(backend.api);
  await controller.refresh(); await controller.run("configure", { api_id: 54321, api_hash: "a".repeat(32) });
  backend.set(status({ api_id: 54321 })); await controller.refresh();
  assert.equal(controller.snapshot.error, "");
});

test("matching saved API credentials do not erase a configure error while auth status is error", async () => {
  const backend = wire(status({ configured: false, api_id: null }), { configure: fail("Synthetic configuration failure") });
  const controller = new AccountController(backend.api);
  await controller.refresh(); await controller.run("configure", { api_id: API_ID, api_hash: "a".repeat(32) });
  backend.set(status({ state: "error" })); await controller.refresh();
  assert.match(controller.snapshot.error, /configuration failure/);
  backend.set(status()); await controller.refresh(); assert.equal(controller.snapshot.error, "");
});

test("disconnect is not terminal while stop completion or teardown is still pending", async () => {
  const backend = wire(authorized(), { disconnect: fail("Synthetic disconnect timeout") });
  const controller = new AccountController(backend.api);
  await controller.refresh(); await controller.run("disconnect");
  for (const extra of [{ stop_complete: false }, { teardown_pending: true }, { busy: true }]) {
    backend.set(status(extra)); await controller.refresh();
    assert.match(controller.snapshot.error, /disconnect timeout/);
  }
  backend.set(status({ stop_complete: true, teardown_pending: false })); await controller.refresh();
  assert.equal(controller.snapshot.error, "");
});

test("a failed auth request can reconcile an expected endpoint after status was offline", async () => {
  const backend = wire(Error("Synthetic offline status"), { connect: fail("Synthetic connection timeout") });
  const controller = new AccountController(backend.api);
  await controller.refresh(); assert.equal(controller.snapshot.status, null);
  await controller.run("connect"); assert.match(controller.snapshot.error, /connection timeout/);
  backend.set(codeRequired()); await controller.refresh(); assert.equal(controller.snapshot.error, "");
});

test("send uncertainty survives healthy, disconnected, changed-identity and offline cached status", async () => {
  const backend = wire(authorized()), controller = new AccountController(backend.api);
  await reviewed(controller); await controller.run("send");
  assert.equal(controller.snapshot.sent.status, "unknown");
  assert.equal(controller.snapshot.draft, null);
  for (const next of [authorized(), status(), authorized({ api_id: 54321, username: "another_synthetic_user" }), Error("Synthetic offline status")]) {
    backend.set(next); await controller.refresh();
    assert.equal(controller.snapshot.sent.status, "unknown");
    assert.equal(controller.snapshot.sent.id, reviewedDraft.id);
    assert.equal(controller.snapshot.draft, null);
    assert.match(controller.snapshot.error, /send timeout/);
  }
  assert.equal(backend.calls.filter((name) => name === "send").length, 1);
});

test("auth recovery never clears an unrelated private-data control failure", async () => {
  const backend = wire(authorized(), { chats: fail("Synthetic chats request failed") });
  const controller = new AccountController(backend.api);
  await controller.refresh(); await controller.run("chats");
  backend.set(codeRequired()); await controller.refresh();
  assert.match(controller.snapshot.error, /chats request failed/);
});

test("initial status checks are coalesced and expose checking until success or failure", async () => {
  const waiting = deferred(), backend = wire(); backend.block(waiting.promise);
  const controller = new AccountController(backend.api), first = controller.refresh();
  assert.equal(controller.snapshot.checking, true);
  assert.strictEqual(controller.refresh(), first);
  assert.deepEqual(backend.calls, ["status"]);
  waiting.resolve(status()); await first; assert.equal(controller.snapshot.checking, false);
  backend.unblock(); backend.set(Error("Synthetic offline status"));
  await controller.refresh(); assert.equal(controller.snapshot.checking, false);
  assert.equal(controller.snapshot.status, null);
});

test("offline recovery shows Studio guidance and Retry performs only one cached status GET", async () => {
  const backend = wire(Error("Synthetic router offline")), view = mount(backend.api);
  await view.controller.refresh();
  const recovery = byID(view, "account-service-recovery"), retry = byID(view, "account-retry-status");
  assert.equal(visible(recovery), true);
  assert.match(recovery.textContent, /LocalAI Studio.*desktop.*Start services/);
  assert.equal(recovery.textContent.includes(".cmd"), false);
  const waiting = deferred(); backend.block(waiting.promise);
  retry.fire("click");
  assert.equal(view.controller.snapshot.checking, true); assert.equal(retry.disabled, true);
  retry.fire("click"); const checked = view.controller.refresh();
  assert.deepEqual(backend.calls, ["status", "status"]);
  waiting.resolve(status()); await checked; await flush();
  assert.equal(view.controller.snapshot.checking, false);
  assert.equal(visible(recovery), false);
  assert.equal(byID(view, "account-connect").disabled, false);
  assert.equal(byID(view, "account-save").disabled, false);
  assert.deepEqual(backend.calls, ["status", "status"]);
});

test("offline UI Retry preserves the consumed unknown send outcome without any effect requests", async () => {
  const backend = wire(authorized()), view = mount(backend.api);
  await reviewed(view.controller); await view.controller.run("send");
  backend.calls.length = 0;
  backend.set(Error("Synthetic router offline")); await view.controller.refresh();
  assert.equal(visible(byID(view, "account-service-recovery")), true);
  assert.match(view.el.textContent, /send result is unknown/i);
  backend.set(authorized()); byID(view, "account-retry-status").fire("click");
  await view.controller.refresh(); await flush();
  assert.equal(view.controller.snapshot.sent.status, "unknown");
  assert.equal(view.controller.snapshot.sent.id, reviewedDraft.id);
  assert.equal(view.controller.snapshot.draft, null);
  assert.equal(byID(view, "account-send").disabled, true);
  assert.match(view.el.textContent, /send result is unknown/i);
  assert.deepEqual(backend.calls, ["status", "status"]);
});

test("initial service checking disables auth controls and Retry without sending any credentials", async () => {
  const waiting = deferred(), backend = wire(); backend.block(waiting.promise);
  const view = mount(backend.api), checked = view.controller.refresh();
  for (const id of ["account-retry-status", "account-save", "account-connect", "account-verify-code", "account-verify-password", "account-send"])
    assert.equal(byID(view, id).disabled, true, `#${id} must wait for cached status`);
  assert.deepEqual(backend.calls, ["status"]);
  waiting.resolve(status({ configured: false, api_id: null })); await checked;
  assert.equal(byID(view, "account-save").disabled, false);
  assert.equal(byID(view, "account-connect").disabled, true);
  assert.deepEqual(backend.calls, ["status"]);
});

test("opening API editor rehydrates only the saved public ID and passive checks preserve active edits", async () => {
  const backend = wire(status()), view = mount(backend.api);
  await view.controller.refresh();
  const editor = byID(view, "account-edit-api"), apiID = byID(view, "account-api-id"), hash = byID(view, "account-api-hash");
  apiID.value = "777"; editor.fire("click");
  assert.equal(apiID.value, String(API_ID)); assert.equal(hash.value || "", "");
  apiID.value = "777"; backend.set(status({ api_id: 54321 })); await view.controller.refresh();
  assert.equal(apiID.value, "777", "Do not overwrite a public ID being edited");
  assert.equal(hash.value || "", "");
  editor.fire("click"); editor.fire("click");
  assert.equal(apiID.value, "54321"); assert.equal(hash.value || "", "");
  assert.deepEqual(backend.calls, ["status", "status"]);
});
