import { test } from "node:test";
import assert from "node:assert/strict";
import { CapabilitiesController, observedEditorText, parseCapabilities, parseChatIDs, parseComputerReview, parseTelegramStatus } from "../src/core/capabilities.ts";
import { installFakeDom } from "./fakedom.mjs";
import { setLanguage } from "../src/i18n/i18n.ts";

const telegram = (changes = {}) => ({ configured: true, enabled: false, running: false,
  allowed_chat_ids: [123, -100123], last_error: null, bot_username: "test_bot", ...changes });
const proposal = (changes = {}) => ({ id: "rev-1", status: "pending", actions_remaining: 9,
  proposal: { action: "type", text: "Salom\nO‘zbekiston" }, reason: "Write the requested text", expected_postcondition: "Editor has the requested text",
  observation: { editor_text: "old" }, ...changes });
const capabilities = (changes = {}) => ({ ok: true, profile: "BALANCED", telegram: telegram(),
  computer: { active: false, pending: null, max_actions: 10 }, ...changes });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function transport(changes = {}) {
  let pending = null;
  return {
    capabilities: changes.capabilities || (async () => capabilities({ computer: { active: pending?.status === "pending",
      pending: pending?.status === "pending" ? pending : null, max_actions: 10 } })),
    configure: changes.configure || (async () => telegram()), telegram: changes.telegram || (async () => telegram()),
    plan: async (input) => { pending = await (changes.plan ? changes.plan(input) : proposal()); return pending; },
    approve: async (id) => { pending = await (changes.approve ? changes.approve(id) : proposal({ id: "rev-2" })); return pending; },
    finish: async () => { pending = null; return changes.finish ? changes.finish() : { status: "cancelled" }; },
    stop: async () => { pending = null; return changes.stop ? changes.stop() : {}; },
  };
}

test("chat IDs are bounded, exact safe integers, deduplicated and allow group IDs", () => {
  assert.deepEqual(parseChatIDs("123, -100123; 123\n456"), [123, -100123, 456]);
  for (const invalid of ["", "0", "1.5", "1e3", "9007199254740992", "x", "1 " + Array(100).fill("2").join(" ")]) assert.throws(() => parseChatIDs(invalid));
});
test("status validates required booleans and ignores credentials rather than retaining them", () => {
  assert.deepEqual(parseTelegramStatus(telegram({ token: "secret" })), telegram());
  assert.equal(parseCapabilities(capabilities()).computer.pending, null);
  for (const invalid of [telegram({ running: "yes" }), telegram({ allowed_chat_ids: [0] }), telegram({ last_error: {} })]) assert.throws(() => parseTelegramStatus(invalid));
  assert.throws(() => parseCapabilities(capabilities({ computer: { active: true, pending: null, max_actions: 11 } })));
});
test("portable workspace location is retained without assuming a D drive", () => {
  const root = "C:\\Users\\Fresh User\\AppData\\Local\\Coucou\\LocalAI\\workspace";
  assert.equal(parseCapabilities(capabilities({ computer: { active: false, pending: null, max_actions: 10, workspace_root: root } })).computer.workspace_root, root);
  for (const workspace_root of ["", {}, "x".repeat(501)]) {
    assert.throws(() => parseCapabilities(capabilities({ computer: { active: false, pending: null, max_actions: 10, workspace_root } })));
  }
});
test("only complete one-action proposals can enable approval", () => {
  assert.equal(parseComputerReview(proposal()).proposal.text, "Salom\nO‘zbekiston");
  for (const invalid of [proposal({ proposal: undefined }), proposal({ proposal: { action: "shell", reason: "x", expected_postcondition: "x" } }),
    proposal({ proposal: { action: "click", x: -1, y: 10, reason: "x", expected_postcondition: "x" } }), proposal({ verified_task_success: "true" }),
    proposal({ status: ["pending"] }), proposal({ proposal: { action: ["type"], text: "x" } })]) assert.throws(() => parseComputerReview(invalid));
  assert.equal(parseComputerReview({ id: "done", status: "finished", verified_task_success: false }).verified_task_success, false);
});
test("the actual backend proposal metadata and nested UIA excerpt contract is accepted", () => {
  const fixture = { id: "revision_abCD-123", status: "pending", proposal: { action: "keypress", key: "CTRL+A" },
    reason: "Aniq matnni almashtirish", expected_postcondition: "Muharrir matni tanlanadi",
    observation: { editor: { text_excerpt: "Avvalgi matn" }, state_hash: "abc123", remaining_actions: 10 },
    actions_remaining: 10, verified_task_success: false };
  const parsed = parseComputerReview(fixture);
  assert.deepEqual(parsed.proposal, { action: "keypress", key: "CTRL+A" });
  assert.equal(parsed.reason, fixture.reason); assert.equal(observedEditorText(parsed), "Avvalgi matn");
  assert.equal(parseComputerReview({ ...fixture, proposal: { action: "finish" } }).proposal.action, "finish");
  assert.equal(parseComputerReview({ id: fixture.id, status: "finished", verified_task_success: true, result: {} }).verified_task_success, true);
});
test("planning never approves automatically and the displayed revision is consumed once", async () => {
  const called = [], waiting = deferred();
  const controller = new CapabilitiesController(transport({ approve: (id) => { called.push(id); return waiting.promise; } }));
  await controller.refresh();
  await controller.run("plan", { task: "x", window_title: "x", document_path: "x", require_saved: false });
  assert.deepEqual(called, []);
  const first = controller.run("approve");
  assert.equal(controller.snapshot.review, null);
  await controller.run("approve");
  assert.deepEqual(called, ["rev-1"]);
  waiting.resolve(proposal({ id: "rev-2" })); await first;
  assert.equal(controller.snapshot.review.id, "rev-2");
});
test("Stop interrupts planning and late proposals cannot restore an approval", async () => {
  const waiting = deferred(), called = [];
  const controller = new CapabilitiesController(transport({ plan: () => waiting.promise, stop: async () => { called.push("stop"); } }));
  await controller.refresh();
  const planning = controller.run("plan", {});
  await controller.run("stop");
  waiting.resolve(proposal()); await planning;
  assert.deepEqual(called, ["stop"]); assert.equal(controller.snapshot.review, null);
  await controller.run("approve"); assert.equal(controller.snapshot.review, null);
});
test("a GET started before mutation is discarded and followed by a fresh status GET", async () => {
  const stale = deferred(); let gets = 0;
  const controller = new CapabilitiesController(transport({ capabilities: () => ++gets === 1 ? stale.promise : Promise.resolve(capabilities()) }));
  const refresh = controller.refresh();
  const stop = controller.run("stop");
  stale.resolve(capabilities({ computer: { active: true, pending: proposal(), max_actions: 10 } }));
  await refresh; await stop;
  assert.equal(gets, 2); assert.equal(controller.snapshot.review, null); assert.equal(controller.snapshot.capabilities.computer.active, false);
});
test("a failed approval remains visible after successful status refresh, and disconnected review is cleared", async () => {
  let offline = false;
  const controller = new CapabilitiesController(transport({ capabilities: async () => { if (offline) throw Error("offline"); return capabilities({ computer: { active: true, pending: proposal(), max_actions: 10 } }); },
    approve: async () => { throw Error("Observation expired"); } }));
  await controller.refresh(); await controller.run("plan", {}); await controller.run("approve");
  assert.equal(controller.snapshot.error, "Observation expired");
  controller.snapshot.review = proposal(); offline = true; await controller.refresh();
  assert.equal(controller.snapshot.capabilities, null); assert.equal(controller.snapshot.review, null);
});
test("reopening recovers the current server proposal without executing it", async () => {
  let approves = 0;
  const controller = new CapabilitiesController(transport({ capabilities: async () => capabilities({ computer: { active: true, pending: proposal(), max_actions: 10 } }),
    approve: async () => { approves++; return proposal(); } }));
  await controller.refresh(); assert.equal(controller.snapshot.review.id, "rev-1"); assert.equal(approves, 0);
});
test("Uzbek review renders untrusted text literally and unverified completion is not success", async () => {
  installFakeDom(); setLanguage("uz");
  const { buildTools } = await import("../src/tools/view.ts");
  const view = buildTools(transport());
  try {
    await view.controller.refresh();
    view.controller.snapshot.review = proposal({ proposal: { action: "type", text: "<script>evil</script>" }, reason: "<img src=x>", expected_postcondition: "text" }); view.sync();
    assert.ok(view.el.textContent.includes("Faqat shu amalni tasdiqlash"));
    assert.ok(view.el.textContent.includes("<script>evil</script>")); assert.equal(view.el.find("SCRIPT").length, 0);
    view.controller.snapshot.review = { id: "done", status: "finished", verified_task_success: false }; view.sync();
    assert.ok(view.el.textContent.includes("muvaffaqiyat tasdiqlanmagan")); assert.equal(view.el.find(".verified").length, 0);
    view.controller.snapshot.review = null; view.controller.snapshot.error = "Observation expired"; view.sync();
    assert.ok(view.el.find(".review")[0].textContent.includes("Observation expired"));
  } finally { setLanguage("en"); }
});
test("Telegram desktop requests only prefill a task and clear the old target; they never execute", async () => {
  installFakeDom(); let actions = 0;
  const { buildTools } = await import("../src/tools/view.ts");
  const view = buildTools(transport({ capabilities: async () => capabilities({ remote_requests: [{ chat_id: -100123,
    task: "<img src=x> Write my note", created_at: 1750000000, requires_desktop_approval: true }] }),
    plan: async () => { actions++; return proposal(); } }));
  await view.controller.refresh();
  const byID = (id) => [...view.el.walk()].find((element) => element.getAttribute("id") === id);
  for (const id of ["computer-window", "computer-document", "computer-expected"]) byID(id).value = "old target";
  byID("computer-saved").checked = true;
  view.el.find("BUTTON").find((button) => button.textContent === "Use this task").fire("click");
  assert.equal(actions, 0); assert.equal(byID("computer-task").value, "<img src=x> Write my note");
  assert.equal(byID("computer-document").value, ""); assert.equal(byID("computer-window").value, "");
  assert.equal(byID("computer-expected").value, ""); assert.equal(byID("computer-saved").checked, false);
  assert.equal(view.el.find(".remote-requests")[0].find("IMG").length, 0);
  assert.equal(byID("desktop-capture").hidden, true);
  assert.equal(byID("desktop-capture").getAttribute("src") || "", "");
  assert.throws(() => parseCapabilities(capabilities({ remote_requests: [{ chat_id: 1, task: "x", created_at: 1, requires_desktop_approval: false }] })));
});
test("saving clears password immediately, omits empty token and never starts a bot", async () => {
  installFakeDom();
  const { buildTools } = await import("../src/tools/view.ts");
  const calls = [], view = buildTools(transport({ configure: async (config) => { calls.push(config); return telegram(); } }));
  await view.controller.refresh();
  const byID = (id) => [...view.el.walk()].find((element) => element.getAttribute("id") === id);
  const token = byID("telegram-token"), chats = byID("telegram-chats"), save = byID("telegram-save");
  chats.value = "123"; token.value = "123456789:placeholder_nonlive_credential";
  save.fire("click"); assert.equal(token.value, ""); await flush();
  assert.deepEqual(calls[0], { token: "123456789:placeholder_nonlive_credential", allowed_chat_ids: [123], enabled: false });
  token.value = ""; save.fire("click"); await flush(); assert.equal("token" in calls[1], false);
});
