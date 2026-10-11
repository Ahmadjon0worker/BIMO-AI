import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolboxController, parseToolboxStatus, parseToolOutput, parseToolPlan, parseDesktopWindows, parseDesktopObservation, validateTerminal, validateGithub } from "../src/core/toolbox.ts";
import { WINDOW, SESSION, HASH, toolStatus, toolOutput, toolPlan, observation, toolTransport, deferred, flush } from "./toolbox-fixtures.mjs";
async function ready(adapter) { const controller = new ToolboxController(adapter); controller.setVisible(true); await controller.refresh(); return controller; }
async function desktop(controller) { await controller.windows(); await controller.start(WINDOW.hwnd); }

test("tool status accepts readiness independently from AI and drops unrequested credentials", () => {
  const parsed = parseToolboxStatus(toolStatus({ api_key: "secret", token: "secret" })); assert.equal(parsed.workspace_root, "C:\\Fixture\\workspace"); assert.equal("api_key" in parsed, false);
  assert.equal(parseToolboxStatus(toolStatus({ github: { installed: false, authenticated: false } })).github.installed, false);
  for (const extra of [{ ok: "true" }, { terminal: { cmd: true, powershell: "true", python: true } }, { desktop: { active: true, supported: "yes" } }, { features: [null] }]) assert.throws(() => parseToolboxStatus(toolStatus(extra)));
});

test("terminal validates Unicode/exact script, bounded timeout and relative workspace paths", () => {
  const script = "  Write-Output 'Salom 🤝'\nGet-Date  "; assert.equal(validateTerminal({ shell: "powershell", script, cwd: "notes", timeout_seconds: 30 }).script, script);
  for (const cwd of ["..", "../escape", "C:\\Windows", "\\\\server\\share", "folder:stream", "/outside"]) assert.throws(() => validateTerminal({ shell: "cmd", script: "ver", cwd, timeout_seconds: 10 }));
  for (const script of ["", "\n ", "\ud800", "null\0", "x".repeat(10001)]) assert.throws(() => validateTerminal({ shell: "cmd", script, timeout_seconds: 10 }));
  for (const timeout_seconds of [0, 61, 1.5]) assert.throws(() => validateTerminal({ shell: "cmd", script: "ver", timeout_seconds }));
});

test("GitHub operation and creation arguments reject malformed repo/branch/title before effects", () => {
  assert.equal(validateGithub({ operation: "status" }).operation, "status"); assert.equal(validateGithub({ operation: "create_pr", repo: "owner/repo", title: "PR", head: "feature/test", base: "main" }).head, "feature/test");
  assert.equal(validateGithub({ operation: "create_pr", repo: "owner/repo", title: "ForkPR", head: "other-owner:feature/test", base: "main" }).head, "other-owner:feature/test");
  for (const input of [{ operation: "delete" }, { operation: "issues" }, { operation: "view", repo: "--bad" },
    { operation: "create_issue", repo: "owner/repo", title: "" }, { operation: "create_issue", repo: "owner/repo", title: "line\nbreak" },
    { operation: "create_pr", repo: "owner/repo", title: "PR", head: "--delete", base: "main" },
    { operation: "create_pr", repo: "owner/repo", title: "PR", head: "a..b", base: "main" }]) assert.throws(() => validateGithub(input));
});

test("result parsers bind selected shell/operation and reject arbitrary created URLs", () => {
  assert.equal(parseToolOutput(toolOutput(), "terminal", "powershell").stdout.includes("<img"), true);
  assert.equal(parseToolOutput(toolOutput({ operation: "repos", exit_code: null }), "github", "repos").exit_code, null);
  assert.throws(() => parseToolOutput(toolOutput({ shell: "cmd" }), "terminal", "powershell"));
  assert.throws(() => parseToolOutput(toolOutput({ execution_boundary: "administrator" }), "terminal", "powershell"));
  for (const url of ["javascript:alert(1)", "https://example.com/a", "https://github.com@evil.com/a", "https://github.com/owner/repo/settings"]) assert.throws(() => parseToolOutput(toolOutput({ operation: "create_issue", url }), "github", "create_issue"));
});

test("AI proposals are bounded data and must explicitly prove no execution", () => {
  assert.equal(parseToolPlan(toolPlan(), "terminal").proposal.steps[0].script, "Write-Output 'Salom 🤝'");
  assert.equal(parseToolPlan(toolPlan("terminal", { provider: null, model: null }), "terminal").provider, null);
  for (const extra of [{ execution_performed: true }, { domain: "github" }, { proposal: { summary: "x", steps: [] } }, { proposal: { summary: "x", steps: [{ title: "x", description: "x", operation: "delete_repo" }] } }]) assert.throws(() => parseToolPlan(toolPlan("terminal", extra), "terminal"));
});

test("HTTP200 uncertain GitHub mutation remains unknown and is never retried automatically", async () => {
  let calls = 0;
  const controller = await ready(toolTransport({ call: async () => { calls++; return toolOutput({ operation: "create_issue", timed_out: true, exit_code: null, mutation_attempted: true, outcome_unknown: true }); } }).adapter);
  await controller.github({ operation: "create_issue", repo: "owner/repo", title: "Synthetic issue" });
  assert.equal(controller.snapshot.unknownEffect, true); assert.equal(controller.snapshot.output.outcome_unknown, true);
  await controller.refresh(); assert.equal(calls, 1); assert.equal(controller.snapshot.unknownEffect, true);
});

test("GitHub unresolved exact mutations survive other successes and acknowledge one signature without effects", async () => {
  const mutations = [], fixture = toolTransport(), original = fixture.adapter.call;
  fixture.adapter.call = async (name, args) => {
    if (name !== "github_action") return original(name, args);
    mutations.push(args.title); return toolOutput({ operation: args.operation, mutation_attempted: true, outcome_unknown: args.title !== "known B" });
  };
  const controller = await ready(fixture.adapter), args = { operation: "create_issue", repo: "owner/repo" };
  await controller.github({ ...args, title: "unknown A" }); await controller.github({ ...args, title: "unknown C" }); await controller.github({ ...args, title: "known B" });
  await controller.terminal({ shell: "powershell", script: "Get-Date", timeout_seconds: 1 }); assert.equal(controller.snapshot.unknownEffect, true);
  await controller.github({ ...args, title: "unknown A" }); assert.deepEqual(mutations, ["unknown A", "unknown C", "known B"]);
  controller.acknowledgeUnknown(); assert.deepEqual(mutations, ["unknown A", "unknown C", "known B"]);
  await controller.github({ ...args, title: "unknown C" }); assert.deepEqual(mutations, ["unknown A", "unknown C", "known B"]);
  controller.acknowledgeUnknown(); assert.equal(controller.snapshot.unknownEffect, false);
  await controller.github({ ...args, title: "unknown A" }); assert.equal(mutations.length, 4);
});

test("opening and polling toolbox coalesces status without terminal/GitHub/AI/window actions", async () => {
  const wait = deferred(), fixture = toolTransport({ status: () => wait.promise }); const controller = new ToolboxController(fixture.adapter);
  controller.setVisible(true); const first = controller.refresh(), second = controller.refresh(); assert.equal(first, second); assert.equal(controller.snapshot.checking, true);
  wait.resolve(toolStatus()); await first; assert.equal(controller.snapshot.checking, false); assert.equal(fixture.calls.length, 0);
});

test("manual terminal preserves exact body and blocks concurrent clicks until its result", async () => {
  const wait = deferred(); let executions = 0, submitted;
  const fixture = toolTransport({ call: async (name, args) => { assert.equal(name, "terminal_run"); executions++; submitted = args; return wait.promise; } }); const controller = await ready(fixture.adapter);
  const script = "  echo Salom 🤝\nver "; const first = controller.terminal({ shell: "cmd", script, timeout_seconds: 2 }); await controller.terminal({ shell: "cmd", script: "second", timeout_seconds: 2 });
  assert.equal(executions, 1); assert.equal(submitted.script, script); wait.resolve(toolOutput({ shell: "cmd" })); await first;
  assert.equal(controller.snapshot.output.shell, "cmd"); assert.equal(controller.snapshot.unknownEffect, false);
});

test("hiding invalidates a pending command without replaying or attributing a late success", async () => {
  const wait = deferred(); let executions = 0; const controller = await ready(toolTransport({ call: async () => { executions++; return wait.promise; } }).adapter);
  const run = controller.terminal({ shell: "powershell", script: "Get-Date", timeout_seconds: 10 }); controller.setVisible(false); wait.resolve(toolOutput()); await run;
  assert.equal(executions, 1); assert.equal(controller.snapshot.output, null); assert.equal(controller.snapshot.unknownEffect, true); controller.setVisible(true); await controller.refresh(); assert.equal(executions, 1);
});

test("AI planning and invalidated late plans never run scripts or GitHub operations", async () => {
  const fixture = toolTransport(); const controller = await ready(fixture.adapter); await controller.plan("terminal", "Check environment", "powershell");
  assert.deepEqual(fixture.calls.map(c => c[0]), ["status", "ai_plan"]); assert.ok(controller.snapshot.plan); const wait = deferred();
  const late = await ready(toolTransport({ call: async () => wait.promise }).adapter); const task = late.plan("github", "Create an issue"); late.clearPlan(); wait.resolve(toolPlan("github")); await task;
  assert.equal(late.snapshot.plan, null); assert.equal(late.snapshot.pending, null);
});

test("desktop captures validate bound session/window, SHA hash and fixed image MIME", () => {
  assert.equal(parseDesktopWindows({ windows: [WINDOW] })[0].hwnd, WINDOW.hwnd); assert.equal(parseDesktopObservation(observation(), SESSION).uia_text, "<img src=x> observed window");
  assert.throws(() => parseDesktopWindows({ windows: [WINDOW, WINDOW] }));
  for (const extra of [{ session_id: "other" }, { state_hash: "not-hash" }, { capture: { mime: "image/svg+xml", base64: "YWJj" } }, { capture: { mime: "image/png", base64: "bad<html>" } }]) assert.throws(() => parseDesktopObservation(observation(extra), SESSION));
});

test("desktop action consumes observed state once, binds exact window and refreshes after confirmed effect", async () => {
  const fixture = toolTransport(), base = fixture.adapter.call; const wait = deferred(); fixture.adapter.call = async (name, args) => name === "desktop_action" ? (fixture.calls.push([name, args]), wait.promise) : base(name, args);
  const controller = await ready(fixture.adapter); await desktop(controller); const first = controller.action({ action: "click", x: 23, y: 45 }); await controller.action({ action: "click", x: 99, y: 99 });
  const effects = fixture.calls.filter(c => c[0] === "desktop_action"); assert.equal(effects.length, 1); assert.equal(effects[0][1].expected_state_hash, HASH); assert.equal(effects[0][1].session_id, SESSION); assert.equal(controller.snapshot.observation, null);
  wait.resolve({ session_id: SESSION, executed: true, action: "click", observe_required: true, verified_task_success: false }); await first;
  assert.ok(controller.snapshot.observation); assert.equal(fixture.calls.filter(c => c[0] === "desktop_observe").length, 2);
});

test("desktop validation rejects outside coordinates/unsupported key and scroll carries coordinates", async () => {
  const fixture = toolTransport(), controller = await ready(fixture.adapter); await desktop(controller);
  for (const action of [{ action: "click", x: 800, y: 0 }, { action: "keypress", key: "ALT+F4" }, { action: "scroll", x: 1, y: 2, amount: 0 }, { action: "type", text: "x".repeat(2001) }]) await controller.action(action);
  assert.equal(fixture.calls.some(c => c[0] === "desktop_action"), false);
  await controller.action({ action: "scroll", x: 3, y: 4, amount: -2 }); assert.equal(fixture.calls.find(c => c[0] === "desktop_action")[1].x, 3);
});

test("unknown desktop effect requires recapture, never retries, and late start is closed on hide", async () => {
  const fixture = toolTransport(), base = fixture.adapter.call; fixture.adapter.call = async (name, args) => name === "desktop_action" ? (fixture.calls.push([name, args]), Promise.reject(Error("timeout"))) : base(name, args);
  const controller = await ready(fixture.adapter); await desktop(controller); await controller.action({ action: "type", text: "Salom" });
  assert.equal(controller.snapshot.observation, null); assert.equal(controller.snapshot.unknownEffect, true); await controller.action({ action: "type", text: "Salom" }); assert.equal(fixture.calls.filter(c => c[0] === "desktop_action").length, 1);
  const wait = deferred(), next = toolTransport(), original = next.adapter.call;
  next.adapter.call = async (name, args) => name === "desktop_start" ? wait.promise : original(name, args);
  const late = await ready(next.adapter); await late.windows(); const start = late.start(WINDOW.hwnd); late.setVisible(false); wait.resolve({ session_id: SESSION, window: WINDOW }); await start; await flush();
  assert.equal(late.snapshot.session, null); assert.ok(next.calls.some(c => c[0] === "desktop_finish")); assert.equal(next.calls.some(c => c[0] === "desktop_action"), false);
});
