import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";
import { setLanguage } from "../src/i18n/i18n.ts";
import { emit } from "./tauri.mjs";
import { WINDOW, SESSION, HASH, toolStatus, toolOutput, toolPlan, observation, toolTransport, deferred, flush } from "./toolbox-fixtures.mjs";
const byID = (view, id) => [...view.el.walk(), ...(view.desktopEl ? view.desktopEl.walk() : [])].find(el => el.getAttribute("id") === id);
async function ui(extra = {}, panel = "toolbox") {
  installFakeDom(); setLanguage("uz"); const { buildToolbox } = await import("../src/tools/toolbox.ts"); const fixture = toolTransport(extra);
  const view = buildToolbox(fixture.adapter); view.setVisible(true, panel); await view.refresh(); return { view, calls: fixture.calls, adapter: fixture.adapter };
}
async function startDesktop(view) {
  byID(view, "desktop-list-windows").fire("click"); await flush(); const selector = byID(view, "desktop-window"); selector.value = WINDOW.hwnd; selector.fire("change");
  byID(view, "desktop-start").fire("click"); await flush();
}
test("manual terminal readiness and diagnostic example do not invoke AI or commands", async () => {
  const { view, calls } = await ui(); assert.equal(byID(view, "terminal-run").disabled, false); assert.deepEqual(calls.map(c => c[0]), ["status"]);
  assert.match(view.el.textContent, /AI shart emas/); assert.match(view.el.textContent, /CMD va PowerShell/);
  const shell = byID(view, "terminal-shell"); shell.value = "cmd"; shell.fire("change"); byID(view, "terminal-diagnostic").fire("click");
  assert.equal(byID(view, "terminal-script").value, "ver\ncd\nwhere python"); assert.deepEqual(calls.map(c => c[0]), ["status"]);
});

test("Ctrl+Enter runs exact script once, IME/Enter remain inactive and result text never becomes markup", async () => {
  const wait = deferred(); let effectCalls = 0, exact;
  const { view } = await ui({ call: async (name, args) => { assert.equal(name, "terminal_run"); effectCalls++; exact = args; return wait.promise; } });
  const script = byID(view, "terminal-script"); script.value = "  Write-Output 'Salom 🤝'\nGet-Date  ";
  for (const event of [{ key: "Enter", ctrlKey: false }, { key: "Enter", ctrlKey: true, isComposing: true }, { key: "Enter", ctrlKey: true, repeat: true }]) for (const fn of script.listeners.get("keydown")) fn({ ...event, preventDefault() {} });
  assert.equal(effectCalls, 0); for (let i = 0; i < 2; i++) for (const fn of script.listeners.get("keydown")) fn({ key: "Enter", ctrlKey: true, isComposing: false, preventDefault() {} });
  assert.equal(effectCalls, 1); assert.equal(exact.script, script.value); wait.resolve(toolOutput()); await flush();
  assert.equal(byID(view, "toolbox-stdout").textContent, "<img src=x onerror=alert(1)>\nSalom 🤝"); assert.equal(view.el.find("IMG").length, 0); assert.match(byID(view, "toolbox-output-summary").textContent, /Chiqish kodi: 0/);
});

test("AI proposal appears literally and only explicit copy fills script; neither generation nor copying executes", async () => {
  const { view, calls } = await ui(); byID(view, "toolbox-ai-task").value = "Check environment"; byID(view, "toolbox-ai-plan").fire("click"); await flush();
  assert.deepEqual(calls.map(c => c[0]), ["status", "ai_plan"]); const preview = byID(view, "toolbox-ai-preview");
  assert.match(preview.textContent, /<script>Proposal data<\/script>/); assert.equal(preview.find("SCRIPT").length, 0); assert.match(preview.textContent, /groq.*fixture-model/);
  preview.find("BUTTON")[0].fire("click"); assert.equal(byID(view, "terminal-script").value, "Write-Output 'Salom 🤝'"); assert.deepEqual(calls.map(c => c[0]), ["status", "ai_plan"]);
  byID(view, "terminal-run").fire("click"); await flush(); assert.equal(calls.filter(c => c[0] === "terminal_run").length, 1);
});

test("GitHub creation requires explicit operation fields and button, never selecting or AI-copy alone", async () => {
  const { view, calls } = await ui(); const op = byID(view, "github-operation"); op.value = "create_pr"; op.fire("change");
  assert.equal(byID(view, "github-create-fields").hidden, false); assert.equal(byID(view, "github-pr-fields").hidden, false); assert.deepEqual(calls.map(c => c[0]), ["status"]);
  const domain = byID(view, "toolbox-ai-domain"); domain.value = "github"; domain.fire("change"); byID(view, "toolbox-ai-task").value = "Issue proposal";
  byID(view, "toolbox-ai-plan").fire("click"); await flush(); byID(view, "toolbox-ai-preview").find("BUTTON")[0].fire("click");
  assert.equal(op.value, "create_issue"); assert.equal(byID(view, "github-repo").value, "fixture/repo"); assert.equal(byID(view, "github-pr-fields").hidden, true);
  assert.equal(calls.some(c => c[0] === "github_action"), false); byID(view, "github-execute").fire("click"); await flush();
  const created = calls.find(c => c[0] === "github_action"); assert.deepEqual(created[1], { operation: "create_issue", repo: "fixture/repo", title: "Fixture issue", body: "Synthetic body" });
  assert.equal(byID(view, "toolbox-result-link").getAttribute("href"), "https://github.com/fixture/repo/issues/1");
});

test("missing GitHub login gives useful setup and does not disable local terminal", async () => {
  const { view } = await ui({ status: async () => toolStatus({ github: { installed: true, authenticated: false } }) });
  assert.equal(byID(view, "terminal-run").disabled, false); assert.equal(byID(view, "github-execute").disabled, false);
  byID(view, "github-operation").value = "repos"; byID(view, "github-operation").fire("change"); assert.equal(byID(view, "github-execute").disabled, true);
  assert.match(view.el.textContent, /gh auth login/); assert.match(byID(view, "toolbox-readiness").textContent, /Akkauntga kirilmagan/);
});

test("uncertain GitHub creation names the bound operation and acknowledgement performs no retry", async () => {
  let effects = 0;
  const { view } = await ui({ call: async (name, args) => { assert.equal(name, "github_action"); effects++; return toolOutput({ operation: args.operation, mutation_attempted: true, outcome_unknown: true }); } });
  const op = byID(view, "github-operation"); op.value = "create_issue"; op.fire("change"); byID(view, "github-repo").value = "owner/repo"; byID(view, "github-title").value = "Synthetic issue";
  byID(view, "github-execute").fire("click"); await flush(); assert.equal(effects, 1);
  assert.match(byID(view, "toolbox-status").textContent, /Issue yaratish.*owner\/repo.*noma’lum/); assert.equal(byID(view, "toolbox-check-result").hidden, false);
  byID(view, "github-execute").fire("click"); await flush(); assert.equal(effects, 1);
  byID(view, "toolbox-check-result").fire("click"); assert.equal(effects, 1); assert.equal(byID(view, "toolbox-check-result").hidden, true);
});

test("hiding or changing domain discards late AI without filling an editor or executing", async () => {
  for (const change of ["hide", "domain"]) {
    const wait = deferred(); const { view } = await ui({ call: async name => { assert.equal(name, "ai_plan"); return wait.promise; } });
    const original = byID(view, "terminal-script").value; byID(view, "toolbox-ai-task").value = "Plan"; byID(view, "toolbox-ai-plan").fire("click");
    if (change === "hide") view.setVisible(false); else { const domain = byID(view, "toolbox-ai-domain"); domain.value = "github"; domain.fire("change"); }
    wait.resolve(toolPlan()); await flush(); assert.equal(view.controller.snapshot.plan, null); assert.equal(byID(view, "terminal-script").value, original);
  }
});

test("Desktop selects exact HWND, displays only data PNG and never executes on start/observe", async () => {
  const { view, calls } = await ui({}, "desktop"); assert.equal(byID(view, "desktop-capture").hidden, true); assert.equal(byID(view, "desktop-perform-action").disabled, true);
  await startDesktop(view); assert.equal(view.controller.snapshot.session.id, SESSION); assert.match(byID(view, "desktop-capture").getAttribute("src"), /^data:image\/png;base64,/);
  assert.match(byID(view, "desktop-observed-text").textContent, /<img src=x>/); assert.equal(view.desktopEl.find("SCRIPT").length, 0);
  assert.deepEqual(calls.map(c => c[0]), ["status", "desktop_windows", "desktop_start", "desktop_observe"]);
});

test("Desktop coordinate click fills fields but only Perform one action sends a bound request", async () => {
  const { view, calls } = await ui({}, "desktop"); await startDesktop(view);
  const capture = byID(view, "desktop-capture"); capture.getBoundingClientRect = () => ({ left: 10, top: 20, width: 400, height: 300 });
  for (const fn of capture.listeners.get("click")) fn({ clientX: 60, clientY: 95 });
  assert.equal(byID(view, "desktop-x").value, "100"); assert.equal(byID(view, "desktop-y").value, "150"); assert.equal(calls.some(c => c[0] === "desktop_action"), false);
  byID(view, "desktop-perform-action").fire("click"); await flush(); const executed = calls.find(c => c[0] === "desktop_action")[1];
  assert.deepEqual(executed, { action: "click", x: 100, y: 150, session_id: SESSION, expected_state_hash: HASH });
  assert.ok(view.controller.snapshot.observation); assert.match(byID(view, "desktop-result").textContent, /"verified_task_success": false/);
});

test("Desktop scroll shows coordinates, finish clears capture and hiding closes session without input", async () => {
  const { view, calls } = await ui({}, "desktop"); await startDesktop(view); const action = byID(view, "desktop-action"); action.value = "scroll"; action.fire("change");
  assert.equal(byID(view, "desktop-coordinates").hidden, false); assert.equal(byID(view, "desktop-scroll").disabled, false);
  byID(view, "desktop-finish").fire("click"); await flush(); assert.equal(view.controller.snapshot.session, null); assert.equal(byID(view, "desktop-capture").hidden, true);
  await startDesktop(view); view.setVisible(false); await flush(); assert.equal(byID(view, "desktop-capture").getAttribute("src"), "");
  assert.equal(calls.filter(c => c[0] === "desktop_finish").length, 2); assert.equal(calls.some(c => c[0] === "desktop_action"), false);
});

test("external global Stop clears stale desktop captures/AI while preserving unresolved GitHub mutations", async () => {
  const wait = deferred(), fixture = toolTransport(), original = fixture.adapter.call;
  fixture.adapter.call = async (name, args) => name === "github_action" ? toolOutput({ operation: args.operation, outcome_unknown: true, mutation_attempted: true }) : name === "ai_plan" ? wait.promise : original(name, args);
  const { view } = await ui(fixture.adapter, "desktop"); await view.controller.github({ operation: "create_issue", repo: "owner/repo", title: "Synthetic issue" }); await startDesktop(view);
  byID(view, "desktop-ai-task").value = "Plan"; byID(view, "desktop-ai-plan").fire("click"); await flush(); emit("localai-account-invalidated", null); wait.resolve(toolPlan("desktop")); await flush();
  assert.equal(view.controller.snapshot.session, null); assert.equal(view.controller.snapshot.plan, null); assert.equal(byID(view, "desktop-capture").getAttribute("src"), "");
  assert.equal(view.controller.snapshot.unknownEffect, true); assert.equal(byID(view, "desktop-ai-task").value, "");
  assert.equal(fixture.calls.some(c => c[0] === "desktop_action"), false);
});

test("Tools integration adds both tabs and refreshes readiness only while its panel is active", async () => {
  installFakeDom(); setLanguage("uz"); const { buildTools } = await import("../src/tools/view.ts"); const fixture = toolTransport(); let oldStatus = 0;
  const view = buildTools({ capabilities: async () => { oldStatus++; return { ok: true, profile: "BALANCED", telegram: { configured: false, enabled: false, running: false, allowed_chat_ids: [], last_error: null, bot_username: null }, computer: { active: false, pending: null, max_actions: 10 }, remote_requests: [] }; } }, undefined, fixture.adapter);
  const find = id => [...view.el.walk()].find(el => el.getAttribute("id") === id); view.setVisible(true); find("toolbox-tab").fire("click"); await flush();
  assert.equal(find("toolbox-panel").hidden, false); assert.equal(find("personal-account-panel").hidden, true); assert.equal(find("bot-windows-panel").hidden, true); assert.equal(oldStatus, 0);
  await view.refresh(); assert.deepEqual(fixture.calls.map(c => c[0]), ["status", "status"]); find("desktop-tab").fire("click"); await flush();
  assert.equal(find("desktop-panel").hidden, false); assert.equal(find("toolbox-panel").hidden, true); assert.equal(fixture.calls.some(c => c[0] === "desktop_windows"), false);
});
