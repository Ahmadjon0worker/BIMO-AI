import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolboxController, parseDesktopObservation, parseDesktopPoint, parseDesktopTargets, parseDesktopEvidence, normalizeDesktopLabel } from "../src/core/toolbox.ts";
import { installFakeDom } from "./fakedom.mjs";
import { calls as nativeCalls } from "./tauri.mjs";
import { WINDOW, SESSION, HASH, toolStatus, observation, toolTransport, deferred, flush } from "./toolbox-fixtures.mjs";

const TARGET = { id: `uia_${"1".repeat(24)}`, label: "O‘zgarishni saqlash", type: "Button", enabled: true, rect: [10, 20, 70, 60], center: { x: 39, y: 39 } };
const POST_HASH = "b".repeat(64);
const observe = extra => observation({ targets: [TARGET], ...extra });
const evidence = (verified = true, extra = {}) => ({ verified, kind: "exact_text", expected: "Saqlandi", state_hash: HASH, truncated: false, ...extra });
const point = extra => ({ session_id: SESSION, state_hash: HASH, window: WINDOW, target: TARGET, x: -61, y: 59, label: TARGET.label,
  window_rect: [-100, 20, 700, 620], coordinate_space: "screen_physical_pixels", executed: false, ...extra });
function fixture(overrides = {}) {
  const base = toolTransport(), calls = [], adapter = { status: async () => toolStatus(), call: async (name, args) => {
    calls.push([name, structuredClone(args)]);
    if (overrides[name]) return overrides[name](args);
    if (name === "desktop_observe") return observe();
    if (name === "desktop_point") return point();
    if (name === "desktop_check") return { session_id: SESSION, state_hash: HASH, executed: false, evidence: evidence(true, { expected: args.expected_text }), verified_task_success: true };
    if (name === "desktop_target_action") return { session_id: SESSION, executed: true, action: args.action, target: TARGET, observe_required: false,
      post_observation: observe({ state_hash: POST_HASH }), evidence: evidence(true, { state_hash: POST_HASH }), verified_task_success: true };
    return base.adapter.call(name, args);
  } };
  return { calls, adapter };
}
async function ready(f) {
  const controller = new ToolboxController(f.adapter); controller.setVisible(true); await controller.refresh();
  await controller.windows(); await controller.start(WINDOW.hwnd); return controller;
}

test("UIA targets reject duplicate IDs, off-window rectangles and centers outside the target", () => {
  assert.equal(parseDesktopTargets([TARGET], WINDOW)[0].label, TARGET.label);
  for (const targets of [[TARGET, TARGET], [{ ...TARGET, rect: [-1, 0, 10, 10] }], [{ ...TARGET, center: { x: 71, y: 39 } }], [{ ...TARGET, enabled: "yes" }], [{ ...TARGET, id: "arbitrary" }]]) {
    assert.throws(() => parseDesktopTargets(targets, WINDOW));
  }
  assert.equal(parseDesktopObservation(observation(), SESSION).targets.length, 0);
});

test("point response must bind exact observed window, state, coordinate transform and visual-only effect", () => {
  const observed = parseDesktopObservation(observe(), SESSION);
  assert.equal(parseDesktopPoint(point(), observed).x, -61);
  for (const extra of [{ x: -62 }, { state_hash: POST_HASH }, { window: { ...WINDOW, pid: 1234 } }, { window_rect: [0, 0, 800, 600] }, { executed: true }, { coordinate_space: "css_pixels" }]) {
    assert.throws(() => parseDesktopPoint(point(extra), observed));
  }
  const long = { ...TARGET, label: "A".repeat(199) + "😀" };
  assert.throws(() => parseDesktopTargets([long], WINDOW));
  const bounded = { ...TARGET, label: "A".repeat(159) + "😀" };
  const boundedObs = parseDesktopObservation(observe({ targets: [bounded] }), SESSION);
  assert.equal(parseDesktopPoint(point({ target: bounded, label: "A".repeat(159) }), boundedObs).label.length, 159);
});

test("Uzbek Latin and Cyrillic labels share exact normalized spelling", () => {
  assert.equal(normalizeDesktopLabel("  Ўзгаришни   сақлаш "), normalizeDesktopLabel("O‘zgarishni saqlash"));
  assert.equal(normalizeDesktopLabel("Қўшимча маълумот"), normalizeDesktopLabel("Qo'shimcha ma'lumot"));
  assert.notEqual(normalizeDesktopLabel("Saqlash"), normalizeDesktopLabel("Saqlash va yuborish"));
});

test("unavailable or unspecified outcomes can never prove success", () => {
  assert.equal(parseDesktopEvidence(evidence(false)).verified, false);
  for (const kind of ["unavailable", "unspecified"]) assert.throws(() => parseDesktopEvidence({ verified: true, kind, reason: "pixels changed" }));
});

test("Moshi point is read-only and retains action proof; target action consumes it then uses fresh post-observation", async () => {
  const f = fixture(), controller = await ready(f), p = await controller.point(TARGET.id);
  assert.equal(p.label, TARGET.label); assert.equal(controller.snapshot.observation.state_hash, HASH);
  assert.equal(f.calls.some(([name]) => name === "desktop_target_action"), false);
  await controller.targetAction({ target_id: TARGET.id, action: "click", expected_text: "Saqlandi" });
  const sent = f.calls.find(([name]) => name === "desktop_target_action")[1];
  assert.equal(sent.expected_state_hash, HASH); assert.equal(controller.snapshot.observation.state_hash, POST_HASH);
  assert.equal(controller.snapshot.desktopEvidence.verified, true);
  assert.equal(f.calls.filter(([name]) => name === "desktop_observe").length, 1);
});

test("failed or pending targeted action never retries or leaves its consumed observation available", async () => {
  const wait = deferred(), f = fixture({ desktop_target_action: () => wait.promise }), controller = await ready(f);
  const first = controller.targetAction({ target_id: TARGET.id, action: "click" });
  await controller.targetAction({ target_id: TARGET.id, action: "click" });
  assert.equal(f.calls.filter(([name]) => name === "desktop_target_action").length, 1); assert.equal(controller.snapshot.observation, null);
  wait.reject(Error("unknown result")); await first;
  await controller.targetAction({ target_id: TARGET.id, action: "click" });
  assert.equal(controller.snapshot.unknownEffect, true); assert.equal(f.calls.filter(([name]) => name === "desktop_target_action").length, 1);
});

test("checklist observes again and only explicit next advances after exact successful evidence", async () => {
  const f = fixture(), controller = await ready(f);
  controller.setGuide("Sahifani ochish | Bosh sahifa\nSaqlashni tekshirish | Saqlandi");
  assert.equal(controller.snapshot.guideIndex, 0); assert.equal(f.calls.some(([name]) => name === "desktop_check"), false);
  controller.advanceGuide(); assert.equal(controller.snapshot.guideIndex, 0);
  await controller.checkGuide(); assert.equal(controller.snapshot.guide[0].status, "verified"); assert.equal(controller.snapshot.guideIndex, 0);
  assert.deepEqual(f.calls.slice(-2).map(([name]) => name), ["desktop_observe", "desktop_check"]);
  controller.advanceGuide(); assert.equal(controller.snapshot.guideIndex, 1);
  assert.equal(f.calls.some(([name]) => name === "desktop_action" || name === "desktop_target_action"), false);
});

test("failed expected text keeps checklist current and hiding discards late checks", async () => {
  const wait = deferred(), f = fixture({ desktop_check: () => wait.promise }), controller = await ready(f);
  controller.setGuide("Saqlash | Saqlandi"); const check = controller.checkGuide(); await flush();
  controller.setVisible(false); wait.resolve({ session_id: SESSION, state_hash: HASH, executed: false, evidence: evidence(false), verified_task_success: false }); await check;
  assert.equal(controller.snapshot.guide.length, 0); assert.equal(controller.snapshot.desktopEvidence, null);
});

const byID = (view, id) => [...view.desktopEl.walk()].find(el => el.getAttribute("id") === id);
test("Uzbek guidance UI searches Cyrillic, points without input and renders target labels as text", async () => {
  installFakeDom(); const { buildToolbox } = await import("../src/tools/toolbox.ts"); const f = fixture(), view = buildToolbox(f.adapter);
  view.setVisible(true, "desktop"); await view.refresh(); await view.controller.windows(); await view.controller.start(WINDOW.hwnd);
  const search = byID(view, "desktop-target-search"); search.value = "Сақлаш"; search.fire("input");
  const select = byID(view, "desktop-target"); assert.match(select.textContent, /O‘zgarishni saqlash/); select.value = TARGET.id; select.fire("change");
  assert.equal(byID(view, "desktop-point-moshi").disabled, false);
  const before = nativeCalls.length; byID(view, "desktop-point-moshi").fire("click"); await flush();
  assert.equal(f.calls.filter(([name]) => name === "desktop_point").length, 1);
  assert.equal(f.calls.some(([name]) => name === "desktop_target_action"), false);
  assert.ok(nativeCalls.slice(before).some(([name]) => name === "companion_point"));
  byID(view, "desktop-expected-text").value = "Saqlandi"; byID(view, "desktop-target-run").fire("click"); await flush();
  assert.equal(f.calls.filter(([name]) => name === "desktop_target_action").length, 1); assert.match(byID(view, "desktop-evidence").textContent, /Kutilgan natija topildi/);
  view.setVisible(false); assert.equal(byID(view, "desktop-target-text").value, "");
});

test("Moshi pointer hides on recapture, finish, panel hide and session invalidation", async () => {
  for (const reason of ["recapture", "finish", "hide", "invalidate"]) {
    installFakeDom(); const { buildToolbox } = await import("../src/tools/toolbox.ts"); const f = fixture(), view = buildToolbox(f.adapter);
    view.setVisible(true, "desktop"); await view.refresh(); await view.controller.windows(); await view.controller.start(WINDOW.hwnd);
    const select = byID(view, "desktop-target"); select.value = TARGET.id; select.fire("change"); byID(view, "desktop-point-moshi").fire("click"); await flush();
    const before = nativeCalls.length;
    if (reason === "recapture") await view.controller.observe();
    if (reason === "finish") await view.controller.finish();
    if (reason === "hide") view.setVisible(false);
    if (reason === "invalidate") view.controller.invalidate();
    await flush();
    assert.ok(nativeCalls.slice(before).some(([name]) => name === "companion_hide"), reason);
    assert.equal(f.calls.some(([name]) => name === "desktop_target_action"), false);
  }
});

test("a late point lookup cannot reopen Moshi after the desktop panel hides", async () => {
  installFakeDom(); const { buildToolbox } = await import("../src/tools/toolbox.ts"), wait = deferred(), f = fixture({ desktop_point: () => wait.promise }), view = buildToolbox(f.adapter);
  view.setVisible(true, "desktop"); await view.refresh(); await view.controller.windows(); await view.controller.start(WINDOW.hwnd);
  const select = byID(view, "desktop-target"); select.value = TARGET.id; select.fire("change");
  const before = nativeCalls.length; byID(view, "desktop-point-moshi").fire("click"); view.setVisible(false); wait.resolve(point()); await flush();
  assert.equal(nativeCalls.slice(before).some(([name]) => name === "companion_point"), false);
});
