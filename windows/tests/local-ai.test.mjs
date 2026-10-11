import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalAIController, parseLocalAIHealth } from "../src/core/local-ai.ts";
import { installFakeDom } from "./fakedom.mjs";
import { setLanguage } from "../src/i18n/i18n.ts";

const health = (changes = {}) => ({
  ok: true, mode: "BALANCED", active_model: "qwen3.5:9b", busy: false,
  operation: null, ram_available_gib: 12.5, ram_total_gib: 31.84,
  tokens_per_second: null, last_error: null, computer_use_active: false, ...changes,
});
const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); };
function clock() {
  const jobs = new Map();
  let seq = 0;
  return {
    jobs,
    set(fn, delay) { assert.equal(delay, 3000); jobs.set(++seq, fn); return seq; },
    clear(id) { jobs.delete(id); },
    tick() { const first = jobs.entries().next().value; if (first) { jobs.delete(first[0]); first[1](); } },
  };
}

test("the panel accepts measured values and rejects incomplete or impossible health", () => {
  assert.deepEqual(parseLocalAIHealth(health()), health());
  assert.equal(parseLocalAIHealth(health({active_model: null, tokens_per_second: 0})).tokens_per_second, 0);
  assert.equal(parseLocalAIHealth(health({halted: true})).halted, true);
  for (const invalid of [null, {}, health({ok: false}), health({mode: "REMOTE"}),
    health({ram_available_gib: 40}), health({ram_total_gib: -1}),
    health({tokens_per_second: Infinity}), health({active_model: {url: "x"}}), health({halted: "true"})]) {
    assert.throws(() => parseLocalAIHealth(invalid), /Invalid Local AI status/);
  }
});

test("polling starts only when visible, does not overlap, and stops on hide", async () => {
  const timer = clock();
  let count = 0;
  let resolve;
  const controller = new LocalAIController({
    health: () => { count++; return new Promise((done) => { resolve = done; }); },
    control: async () => ({}),
  }, () => {}, timer);
  assert.equal(count, 0);
  controller.setVisible(true);
  assert.equal(count, 1);
  await controller.refresh();
  assert.equal(count, 1);
  controller.setVisible(false);
  resolve(health());
  await flush();
  assert.equal(timer.jobs.size, 0);
  assert.equal(controller.snapshot.health, null);
  controller.setVisible(true);
  assert.equal(count, 2);
  resolve(health());
  await flush();
  // A manual refresh made during the first poll is coalesced after showing.
  if (count === 3) { resolve(health()); await flush(); }
  assert.equal(timer.jobs.size, 1);
  controller.setVisible(false);
  assert.equal(timer.jobs.size, 0);
});

test("default browser timers keep their global receiver during polling and mode changes", async () => {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const jobs = new Map();
  let seq = 0;
  let mode = "BALANCED";
  let controller;
  globalThis.setTimeout = function (callback, delay) {
    assert.ok(this === undefined || this === globalThis, "timer called with a foreign receiver");
    assert.equal(delay, 3000);
    jobs.set(++seq, callback);
    return seq;
  };
  globalThis.clearTimeout = function (id) {
    assert.ok(this === undefined || this === globalThis, "clear called with a foreign receiver");
    jobs.delete(id);
  };
  try {
    controller = new LocalAIController({
      health: async () => health({mode}),
      control: async (_action, selected) => { mode = selected; return {}; },
    }, () => {});
    controller.setVisible(true);
    await flush();
    assert.equal(jobs.size, 1);
    const tick = jobs.values().next().value;
    jobs.clear();
    tick();
    await flush();
    assert.equal(jobs.size, 1);
    await controller.control("mode", "QUALITY");
    assert.equal(controller.snapshot.health.mode, "QUALITY");
    assert.equal(controller.snapshot.error, null);
    assert.equal(jobs.size, 1);
    controller.setVisible(false);
    assert.equal(jobs.size, 0);
  } finally {
    controller?.setVisible(false);
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});

test("a failed poll clears stale RAM/model data and reconnects cleanly", async () => {
  const timer = clock();
  let fail = false;
  const controller = new LocalAIController({
    health: async () => { if (fail) throw new Error("timeout"); return health(); },
    control: async () => ({}),
  }, () => {}, timer);
  controller.setVisible(true);
  await flush();
  assert.equal(controller.snapshot.connection, "connected");
  fail = true;
  timer.tick();
  await flush();
  assert.equal(controller.snapshot.connection, "disconnected");
  assert.equal(controller.snapshot.health, null);
  fail = false;
  timer.tick();
  await flush();
  assert.equal(controller.snapshot.connection, "connected");
  assert.equal(controller.snapshot.error, null);
  controller.setVisible(false);
});

test("Stop reaches the router immediately while a mode request is pending", async () => {
  const calls = [];
  let finishMode;
  const controller = new LocalAIController({
    health: async () => health(),
    control: async (action, mode) => {
      calls.push([action, mode]);
      if (action === "mode") await new Promise((done) => { finishMode = done; });
      return {};
    },
  }, () => {}, clock());
  const changing = controller.control("mode", "QUALITY");
  await controller.control("stop");
  assert.deepEqual(calls, [["mode", "QUALITY"], ["stop", undefined]]);
  assert.equal(controller.snapshot.completed, "stop");
  finishMode();
  await changing;
  await controller.control("mode", "REMOTE");
  assert.equal(calls.length, 2);
});

test("Uzbek panel renders model/error text safely and does not run vision on its own", async () => {
  installFakeDom();
  const { buildLocalAI } = await import("../src/views/local-ai.ts");
  setLanguage("uz");
  const controls = [];
  const panel = buildLocalAI({
    health: async () => health({active_model: "<script>alert(1)</script>", last_error: "<img src=x onerror=evil>"}),
    control: async (...args) => { controls.push(args); return {}; },
  });
  try {
    panel.setVisible(true);
    await flush();
    assert.ok(panel.el.textContent.includes("Lokal AI"));
    assert.ok(panel.el.textContent.includes("Bo‘sh RAM: 12.5 / 31.8 GiB"));
    assert.ok(panel.el.textContent.includes("<script>alert(1)</script>"));
    assert.ok(panel.el.textContent.includes("<img src=x onerror=evil>"));
    assert.equal(panel.el.find("SCRIPT").length, 0);
    assert.deepEqual(controls, []);
    panel.el.querySelector(".local-ai-stop").fire("click");
    await flush();
    assert.equal(controls[0][0], "stop");
  } finally {
    panel.setVisible(false);
    setLanguage("en");
  }
});

test("a stopped router shows Uzbek resume guidance rather than ready", async () => {
  installFakeDom();
  const { buildLocalAI } = await import("../src/views/local-ai.ts");
  setLanguage("uz");
  const panel = buildLocalAI({
    health: async () => health({halted: true, busy: false, active_model: null,
      operation: null, tokens_per_second: null, last_error: "Stopped by user"}),
    control: async () => ({}),
  });
  try {
    panel.setVisible(true);
    await flush();
    assert.ok(panel.el.textContent.includes("Lokal AI to‘xtatilgan"));
    assert.ok(panel.el.textContent.includes("davom ettirish uchun rejimni tanlang"));
    assert.ok(!panel.el.textContent.includes("Lokal AI tayyor"));
    assert.ok(!panel.el.textContent.includes("Stopped by user"));
    assert.ok(panel.el.find(".local-ai-mode").every((button) => !button.disabled));
  } finally {
    panel.setVisible(false);
    setLanguage("en");
  }
});
