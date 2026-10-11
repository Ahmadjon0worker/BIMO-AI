import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";
import { setLanguage } from "../src/i18n/i18n.ts";
import { buildTelegramAccount } from "../src/tools/telegram-account.ts";
import { buildTools } from "../src/tools/view.ts";

const CHAT = "123456789";
const disconnected = (extra = {}) => ({ available: true, configured: true, api_id: 12345,
  state: "disconnected", authorized: false, busy: false, has_saved_session: false,
  username: null, dialog_count: 0, selected_chat_id: null, last_error: null, ...extra });
const chat = { chat_id: CHAT, title: "Synthetic recipient", kind: "user", unread_count: 0, can_send: true };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
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

// Track browser effects without changing the shared fake DOM or production UI.
function trackedDom() {
  installFakeDom();
  setLanguage("en");
  const focus = [], scroll = [], frames = [];
  const create = document.createElement;
  document.activeElement = null;
  document.createElement = (tag) => {
    const node = create(tag);
    node.focus = (options) => {
      focus.push({ id: node.getAttribute("id"), options });
      if (!node.disabled && visible(node)) document.activeElement = node;
    };
    node.scrollIntoView = (options) => scroll.push({ id: node.getAttribute("id"), options });
    node.getBoundingClientRect = () => ({ top: 420, bottom: 480, left: 0, right: 500, width: 500, height: 60 });
    Object.defineProperty(node, "isConnected", { get: () => {
      let current = node;
      while (current.parentElement) current = current.parentElement;
      return current === document.body;
    } });
    return node;
  };
  globalThis.innerHeight = 800;
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  return { focus, scroll, frames, render() {
    const pending = frames.splice(0);
    for (const callback of pending) callback(0);
  } };
}
function transport(overrides = {}) {
  let current = disconnected();
  const calls = [];
  const api = {
    status: async () => { calls.push(["status"]); return current; },
    configure: async (value) => { calls.push(["configure", value]); return current; },
    connect: async (phone) => { calls.push(["connect", phone]); return current; },
    verify: async (value) => { calls.push(["verify", value]); return current; },
    disconnect: async () => { calls.push(["disconnect"]); current = disconnected(); return current; },
    chats: async () => { calls.push(["chats"]); return { chats: [chat], limit: 30 }; },
    messages: async () => { calls.push(["messages"]); return { chat_id: CHAT, title: chat.title, limit: 20, messages: [] }; },
    draft: async () => { calls.push(["draft"]); throw new Error("Draft is outside this auth UI test"); },
    send: async () => { calls.push(["send"]); throw new Error("Send is outside this auth UI test"); },
    ...overrides,
  };
  return { api, calls, set(value) { current = value; } };
}
function mount(dom, api) {
  const view = buildTelegramAccount(api, () => 120);
  document.body.append(view.el);
  view.setVisible(true);
  dom.render();
  return view;
}
async function settled(view) {
  for (let count = 0; count < 5 && view.controller.snapshot.pending; count++) await flush();
  assert.equal(view.controller.snapshot.pending, null, "UI request should have completed");
}
const secretIDs = ["account-api-hash", "account-phone", "account-code", "account-password"];
afterEach(() => setLanguage("en"));

test("configured disconnected auth shows code and 2FA steps but only phone/connect is actionable", async () => {
  const dom = trackedDom(), wire = transport(), view = mount(dom, wire.api);
  await view.controller.refresh(); dom.render();
  for (const id of ["account-phone-step", "account-code-step", "account-password-step"]) assert.equal(visible(byID(view, id)), true);
  for (const id of ["account-code", "account-password", "account-verify-code", "account-verify-password"]) assert.equal(byID(view, id).disabled, true);
  assert.equal(byID(view, "account-phone").disabled, false);
  assert.equal(byID(view, "account-connect").disabled, false);
  assert.match(byID(view, "account-login-step-hint").textContent, /phone|login code|connect/i);
  assert.equal(visible(byID(view, "account-api-editor")), false);
  assert.equal(visible(byID(view, "account-api-summary")), true);
  for (const id of ["account-list-chats", "account-read-messages", "account-prepare-draft", "account-send"]) assert.equal(byID(view, id).disabled, true);
  byID(view, "account-code").value = "12345";
  byID(view, "account-verify-code").fire("click");
  byID(view, "account-password").value = "synthetic-2fa";
  byID(view, "account-verify-password").fire("click");
  assert.deepEqual(wire.calls, [["status"]]);
});

test("unconfigured auth exposes API editor and cannot request codes or private data", async () => {
  const dom = trackedDom(), wire = transport(), view = mount(dom, wire.api);
  wire.set(disconnected({ configured: false, api_id: null }));
  await view.controller.refresh(); dom.render();
  assert.equal(visible(byID(view, "account-api-editor")), true);
  assert.equal(byID(view, "account-save").disabled, false);
  for (const id of ["account-connect", "account-code", "account-password", "account-list-chats", "account-send"]) assert.equal(byID(view, id).disabled, true);
  assert.match(byID(view, "account-login-step-hint").textContent, /API/i);
});

test("saved API credentials can be edited without disclosing or resending the saved hash", async () => {
  const dom = trackedDom(), wire = transport(), view = mount(dom, wire.api);
  await view.controller.refresh(); dom.render();
  byID(view, "account-edit-api").fire("click");
  assert.equal(visible(byID(view, "account-api-editor")), true);
  assert.equal(byID(view, "account-api-id").value, "12345");
  assert.ok(!byID(view, "account-api-hash").value);
  assert.deepEqual(wire.calls, [["status"]]);
});

test("saved session offers restore while entering a phone offers sending a new code", async () => {
  const dom = trackedDom(), wire = transport(), view = mount(dom, wire.api);
  wire.set(disconnected({ has_saved_session: true }));
  await view.controller.refresh(); dom.render();
  assert.match(byID(view, "account-connect").textContent, /restore/i);
  byID(view, "account-phone").value = "+998901234567";
  byID(view, "account-phone").fire("input");
  assert.match(byID(view, "account-connect").textContent, /send.*code/i);
  assert.deepEqual(wire.calls, [["status"]]);
});

test("accepted connect clears secrets and the returned code stage enables only manual code verification", async () => {
  const dom = trackedDom(), waiting = deferred(), wire = transport({ connect: (phone) => {
    wire.calls.push(["connect", phone]); return waiting.promise;
  } }), view = mount(dom, wire.api);
  await view.controller.refresh();
  for (const id of secretIDs) byID(view, id).value = "synthetic-private-input";
  byID(view, "account-phone").value = "+998901234567";
  byID(view, "account-connect").fire("click");
  for (const id of secretIDs) assert.equal(byID(view, id).value, "");
  for (const id of ["account-connect", "account-code", "account-password", "account-verify-code", "account-verify-password"]) assert.equal(byID(view, id).disabled, true);
  assert.equal(wire.calls.filter(([name]) => name === "connect").length, 1);
  wire.set(disconnected({ state: "code_required" })); waiting.resolve(disconnected({ state: "code_required" }));
  await settled(view); dom.render();
  assert.equal(byID(view, "account-code").disabled, false);
  assert.equal(byID(view, "account-verify-code").disabled, false);
  assert.equal(byID(view, "account-password").disabled, true);
  assert.equal(byID(view, "account-verify-password").disabled, true);
  assert.equal(document.activeElement, byID(view, "account-code"));
});

test("manual code and 2FA transitions enable the correct field and authorized state gates private controls", async () => {
  const dom = trackedDom(), wire = transport({ verify: async (value) => {
    wire.calls.push(["verify", value]);
    const current = "code" in value ? disconnected({ state: "password_required" })
      : disconnected({ state: "authorized", authorized: true, has_saved_session: true });
    wire.set(current); return current;
  } }), view = mount(dom, wire.api);
  wire.set(disconnected({ state: "code_required" })); await view.controller.refresh(); dom.render();
  byID(view, "account-code").value = "12345";
  byID(view, "account-verify-code").fire("click");
  assert.equal(byID(view, "account-code").value, "");
  await settled(view); dom.render();
  assert.equal(byID(view, "account-code").disabled, true);
  assert.equal(byID(view, "account-password").disabled, false);
  assert.equal(byID(view, "account-verify-password").disabled, false);
  assert.equal(document.activeElement, byID(view, "account-password"));
  byID(view, "account-password").value = "synthetic-2fa";
  byID(view, "account-verify-password").fire("click");
  assert.equal(byID(view, "account-password").value, "");
  await settled(view); dom.render();
  for (const id of ["account-api-id", "account-api-hash", "account-phone", "account-code", "account-password", "account-connect"]) assert.equal(byID(view, id).disabled, true);
  assert.equal(byID(view, "account-list-chats").disabled, false);
  for (const id of ["account-read-messages", "account-prepare-draft", "account-send"]) assert.equal(byID(view, id).disabled, true);
  assert.deepEqual(wire.calls.filter(([name]) => name === "verify"), [["verify", { code: "12345" }], ["verify", { password: "synthetic-2fa" }]]);
});

test("repeated cached polling does not steal focus or scroll away from a partially entered code", async () => {
  const dom = trackedDom(), wire = transport(), view = mount(dom, wire.api);
  wire.set(disconnected({ state: "code_required" })); await view.controller.refresh(); dom.render();
  const effects = { focus: dom.focus.length, scroll: dom.scroll.length };
  byID(view, "account-code").value = "123";
  for (let count = 0; count < 3; count++) { await view.controller.refresh(); dom.render(); }
  assert.equal(byID(view, "account-code").value, "123");
  assert.equal(dom.focus.length, effects.focus);
  assert.equal(dom.scroll.length, effects.scroll);
  assert.equal(dom.focus.filter(({ id }) => id === "account-code").length, 1);
});

test("a queued code focus is cancelled when Stop invalidates the auth transition", async () => {
  const dom = trackedDom(), wire = transport(), view = mount(dom, wire.api);
  wire.set(disconnected({ state: "code_required" })); await view.controller.refresh();
  view.controller.invalidate(); wire.set(disconnected()); await view.controller.refresh();
  dom.render();
  assert.equal(byID(view, "account-code").disabled, true);
  assert.equal(dom.focus.some(({ id }) => id === "account-code"), false);
  assert.equal(dom.scroll.some(({ id }) => id === "account-code-step"), false);
});

test("hiding the account before its queued frame clears secrets and cancels focus and scrolling", async () => {
  const dom = trackedDom(), wire = transport(), view = mount(dom, wire.api);
  wire.set(disconnected({ state: "code_required" })); await view.controller.refresh();
  for (const id of secretIDs) byID(view, id).value = "synthetic-private-input";
  view.setVisible(false); dom.render();
  for (const id of secretIDs) assert.equal(byID(view, id).value, "");
  assert.equal(dom.focus.some(({ id }) => id === "account-code"), false);
  assert.equal(dom.scroll.some(({ id }) => id === "account-code-step"), false);
});

test("a busy code stage waits until enabled before focusing and does not refocus on later polls", async () => {
  const dom = trackedDom(), wire = transport(), view = mount(dom, wire.api);
  wire.set(disconnected({ state: "code_required", busy: true })); await view.controller.refresh(); dom.render();
  assert.equal(byID(view, "account-code").disabled, true);
  assert.equal(dom.focus.some(({ id }) => id === "account-code"), false);
  wire.set(disconnected({ state: "code_required" })); await view.controller.refresh(); dom.render();
  assert.equal(byID(view, "account-code").disabled, false);
  assert.equal(document.activeElement, byID(view, "account-code"));
  await view.controller.refresh(); dom.render();
  assert.equal(dom.focus.filter(({ id }) => id === "account-code").length, 1);
});

test("failed status polling fails closed and does not jump to stale auth fields", async () => {
  let offline = false;
  const dom = trackedDom(), wire = transport({ status: async () => {
    if (offline) throw new Error("Synthetic offline status");
    return disconnected({ state: "code_required" });
  } }), view = mount(dom, wire.api);
  await view.controller.refresh(); dom.render();
  const effects = { focus: dom.focus.length, scroll: dom.scroll.length };
  offline = true; await view.controller.refresh(); dom.render();
  assert.equal(view.controller.snapshot.status, null);
  for (const id of ["account-connect", "account-code", "account-password", "account-verify-code", "account-verify-password", "account-list-chats", "account-send"]) assert.equal(byID(view, id).disabled, true);
  assert.equal(dom.focus.length, effects.focus); assert.equal(dom.scroll.length, effects.scroll);
});

test("invalid local phone and login-code input is retained and never reaches transport", async () => {
  const dom = trackedDom(), wire = transport(), view = mount(dom, wire.api);
  await view.controller.refresh();
  byID(view, "account-phone").value = "+12";
  byID(view, "account-connect").fire("click");
  assert.equal(byID(view, "account-phone").value, "+12");
  assert.equal(wire.calls.filter(([name]) => name === "connect").length, 0);
  wire.set(disconnected({ state: "code_required" })); await view.controller.refresh(); dom.render();
  byID(view, "account-code").value = "12";
  byID(view, "account-verify-code").fire("click");
  assert.equal(byID(view, "account-code").value, "12");
  assert.equal(wire.calls.filter(([name]) => name === "verify").length, 0);
});

test("hiding or switching Tools tabs clears manual auth secrets without reading private chats", async () => {
  const dom = trackedDom(), wire = transport();
  const bot = { configured: false, enabled: false, running: false, allowed_chat_ids: [], last_error: null, bot_username: null };
  const view = buildTools({ capabilities: async () => ({ ok: true, profile: "BALANCED", telegram: bot,
    computer: { active: false, pending: null, max_actions: 10 } }) }, wire.api);
  document.body.append(view.el);
  view.setVisible(true); byID(view, "account-tab").fire("click"); await flush(); dom.render();
  for (const id of secretIDs) byID(view, id).value = "synthetic-private-input";
  view.setVisible(false);
  for (const id of secretIDs) assert.equal(byID(view, id).value, "");
  view.setVisible(true);
  for (const id of secretIDs) byID(view, id).value = "synthetic-private-input";
  byID(view, "tools-tab").fire("click");
  for (const id of secretIDs) assert.equal(byID(view, id).value, "");
  assert.equal(wire.calls.some(([name]) => ["connect", "verify", "chats", "messages", "draft", "send"].includes(name)), false);
});
