import { h } from "../views/dom";
import { t, tl } from "../i18n/i18n";
import { Bridge, onEvent } from "../core/bridge";
import { ToolboxController, GITHUB_OPERATIONS, DESKTOP_KEYS, type ToolboxTransport, type ToolboxDomain, type TerminalShell, type GithubOperation, type DesktopAction } from "../core/toolbox";

const TRANSPORT: ToolboxTransport = { status: () => Bridge.localAIToolboxStatus(), call: (name, args) => Bridge.localAIToolboxCall(name, args) };
const label = (text: string, input: HTMLElement) => h("label", { class: "field", for: input.id }, h("span", { text: tl(text) }), input);
const operations: Record<GithubOperation, string> = { status: "GitHub status", repos: "My repositories", issues: "List issues", pulls: "List pull requests", view: "Repository details", create_issue: "Create issue", create_pr: "Create pull request" };
export function buildToolbox(transport: ToolboxTransport = TRANSPORT) {
  const controller = new ToolboxController(transport, sync);
  let visible = false, activePanel: "toolbox" | "desktop" = "toolbox", planKey = "", outputKey = "", windowKey = "", captureKey = "";
  const status = h("div", { id: "toolbox-status", class: "notice", role: "status", "aria-live": "polite" });
  const readiness = h("p", { id: "toolbox-readiness", class: "hint" });
  const acknowledge = h("button", { id: "toolbox-check-result", class: "secondary", text: tl("I checked the result"), onclick: () => { if (!acknowledge.disabled) controller.acknowledgeUnknown(); } });
  const shell = h("select", { id: "terminal-shell" }, h("option", { value: "cmd", text: "CMD" }), h("option", { value: "powershell", text: "PowerShell" })); shell.value = "powershell";
  const cwd = h("input", { id: "terminal-cwd", type: "text", maxlength: 512, placeholder: "." }); cwd.value = ".";
  const timeout = h("input", { id: "terminal-timeout", type: "number", min: 1, max: 60, value: 30 }); timeout.value = "30";
  const script = h("textarea", { id: "terminal-script", rows: 6, maxlength: 10000, spellcheck: false, "aria-label": tl("Exact command or script") }); script.value = "Get-Date\nGet-Location\n$PSVersionTable.PSVersion";
  const run = h("button", { id: "terminal-run", text: tl("Run this script"), onclick: () => {
    if (!run.disabled) void controller.terminal({ shell: shell.value as TerminalShell, script: script.value || "", cwd: cwd.value || ".", timeout_seconds: Number(timeout.value) });
  } });
  const diagnostic = h("button", { id: "terminal-diagnostic", class: "secondary", text: tl("Fill diagnostic example"), onclick: () => {
    if (diagnostic.disabled) return;
    script.value = shell.value === "cmd" ? "ver\ncd\nwhere python" : "Get-Date\nGet-Location\n$PSVersionTable.PSVersion"; controller.clearPlan();
  } });
  const terminalCard = h("section", { class: "card toolbox-terminal" }, h("h2", { text: tl("CMD and PowerShell") }),
    h("p", { class: "hint", text: tl("Run the exact script below as the current Windows user. AI is optional. Ctrl+Enter runs once.") }),
    h("div", { class: "toolbox-terminal-options" }, label("Shell", shell), label("Workspace subfolder", cwd), label("Timeout (seconds)", timeout)),
    label("Exact command or script", script), h("div", { class: "actions" }, run, diagnostic));
  const operation = h("select", { id: "github-operation" }, ...GITHUB_OPERATIONS.map(value => h("option", { value, text: tl(operations[value]) }))); operation.value = "status";
  const repo = h("input", { id: "github-repo", maxlength: 140, placeholder: "owner/repository" });
  const ghTitle = h("input", { id: "github-title", maxlength: 256 });
  const ghBody = h("textarea", { id: "github-body", rows: 4, maxlength: 20000 });
  const head = h("input", { id: "github-head", maxlength: 256, placeholder: "feature-branch" });
  const base = h("input", { id: "github-base", maxlength: 256, placeholder: "main" }); base.value = "main";
  const ghExecute = h("button", { id: "github-execute", text: tl("GitHub status"), onclick: () => {
    if (ghExecute.disabled) return;
    const op = operation.value as GithubOperation;
    void controller.github({ operation: op, ...(repo.value?.trim() ? { repo: repo.value.trim() } : {}),
      ...(["create_issue", "create_pr"].includes(op) ? { title: ghTitle.value || "", body: ghBody.value || "" } : {}),
      ...(op === "create_pr" ? { head: head.value || "", base: base.value || "" } : {}) });
  } });
  const ghCreate = h("div", { id: "github-create-fields" }, label("Issue or pull request title", ghTitle), label("Body", ghBody));
  const ghBranches = h("div", { id: "github-pr-fields", class: "toolbox-branches" }, label("Head branch", head), label("Base branch", base));
  const githubCard = h("section", { class: "card toolbox-github" }, h("h2", { text: "GitHub" }),
    h("p", { class: "hint", text: tl("Uses your GitHub CLI login. Choose an operation and run it explicitly. AI is optional.") }),
    label("GitHub operation", operation), label("Repository (owner/name)", repo), ghCreate, ghBranches,
    h("p", { id: "github-login-hint", class: "hint", text: tl("If GitHub is not signed in, run gh auth login in your own terminal, then refresh here.") }),
    h("div", { class: "actions" }, ghExecute));
  const outputSummary = h("p", { id: "toolbox-output-summary", class: "hint" });
  const stdout = h("pre", { id: "toolbox-stdout", class: "toolbox-output", tabindex: 0 });
  const stderr = h("pre", { id: "toolbox-stderr", class: "toolbox-output error", tabindex: 0 });
  const resultLink = h("a", { id: "toolbox-result-link", href: "", text: tl("Open created GitHub item"), onclick: event => {
    event.preventDefault(); const url = controller.snapshot.output?.url; if (url) void Bridge.openUrl(url);
  } });
  const output = h("section", { class: "card toolbox-output-card" }, h("h2", { text: tl("Command result") }), outputSummary,
    h("h3", { text: "stdout" }), stdout, h("h3", { text: "stderr" }), stderr, resultLink);
  const domain = h("select", { id: "toolbox-ai-domain" }, h("option", { value: "terminal", text: tl("Terminal proposal") }), h("option", { value: "github", text: tl("GitHub proposal") })); domain.value = "terminal";
  const aiTask = h("textarea", { id: "toolbox-ai-task", rows: 3, maxlength: 4000, placeholder: tl("Describe what you want to do") });
  const aiRun = h("button", { id: "toolbox-ai-plan", class: "secondary", text: tl("Ask AI for an editable proposal"), onclick: () => {
    if (!aiRun.disabled) void controller.plan(domain.value as ToolboxDomain, aiTask.value || "", domain.value === "terminal" ? shell.value as TerminalShell : undefined);
  } });
  const plan = h("div", { id: "toolbox-ai-preview", class: "toolbox-plan" });
  const aiCard = h("section", { class: "card toolbox-ai-card" }, h("h2", { text: tl("Optional AI planning") }),
    h("p", { class: "hint", text: tl("AI proposals never run automatically. Copy a step into the editor, adjust it, then press its run button.") }),
    label("Proposal type", domain), label("Task", aiTask), aiRun, plan);
  const terminalEl = h("div", { id: "toolbox-panel", role: "tabpanel" }, status, acknowledge, readiness, h("div", { class: "columns toolbox-columns" }, terminalCard, githubCard), output, aiCard);

  const desktopStatus = h("div", { id: "desktop-status", class: "notice", role: "status", "aria-live": "polite" });
  const desktopAcknowledge = h("button", { id: "desktop-check-result", class: "secondary", text: tl("I checked the result"), onclick: () => { if (!desktopAcknowledge.disabled) controller.acknowledgeUnknown(); } });
  const windows = h("select", { id: "desktop-window", "aria-label": tl("Choose a desktop window") });
  const windowsList = h("button", { id: "desktop-list-windows", class: "secondary", text: tl("List open windows"), onclick: () => { if (!windowsList.disabled) void controller.windows(); } });
  const desktopStart = h("button", { id: "desktop-start", text: tl("Start selected window"), onclick: () => { if (!desktopStart.disabled) void controller.start(windows.value); } });
  const observe = h("button", { id: "desktop-observe", class: "secondary", text: tl("Refresh window capture"), onclick: () => { if (!observe.disabled) void controller.observe(); } });
  const finish = h("button", { id: "desktop-finish", class: "danger", text: tl("Finish desktop session"), onclick: () => { if (!finish.disabled) void controller.finish(); } });
  const windowInfo = h("p", { id: "desktop-window-info", class: "hint" });
  const capture = h("img", { id: "desktop-capture", class: "toolbox-capture", alt: tl("Selected desktop window capture") });
  const captureHint = h("p", { class: "hint", text: tl("Click the capture to fill coordinates. Press Perform one action to act on that observed window.") });
  const action = h("select", { id: "desktop-action" }, ...[["click", "Click"], ["type", "Type text"], ["keypress", "Press keys"], ["scroll", "Scroll"]].map(([value, name]) => h("option", { value, text: tl(name) }))); action.value = "click";
  const x = h("input", { id: "desktop-x", type: "number", min: 0, value: 0 }); x.value = "0";
  const y = h("input", { id: "desktop-y", type: "number", min: 0, value: 0 }); y.value = "0";
  const coordinates = h("div", { id: "desktop-coordinates", class: "toolbox-branches" }, label("X", x), label("Y", y));
  const text = h("textarea", { id: "desktop-text", rows: 3, maxlength: 2000 });
  const textField = label("Text to type", text);
  const key = h("select", { id: "desktop-key" }, ...DESKTOP_KEYS.map(value => h("option", { value, text: value }))); key.value = "CTRL+A";
  const keyField = label("Key or key combination", key);
  const amount = h("input", { id: "desktop-scroll", type: "number", min: -10, max: 10, value: -3 }); amount.value = "-3";
  const scrollField = label("Scroll amount", amount);
  const act = h("button", { id: "desktop-perform-action", text: tl("Perform one action"), onclick: () => {
    if (act.disabled) return;
    const kind = action.value as DesktopAction["action"];
    void controller.action({ action: kind, ...(kind === "click" || kind === "scroll" ? { x: Number(x.value), y: Number(y.value) } : {}),
      ...(kind === "type" ? { text: text.value || "" } : {}), ...(kind === "keypress" ? { key: key.value || "" } : {}), ...(kind === "scroll" ? { amount: Number(amount.value) } : {}) });
  } });
  const desktopText = h("pre", { id: "desktop-observed-text", class: "toolbox-output", tabindex: 0 });
  const desktopResult = h("pre", { id: "desktop-result", class: "toolbox-output", tabindex: 0 });
  const desktopTask = h("textarea", { id: "desktop-ai-task", rows: 3, maxlength: 4000 });
  const desktopPlan = h("button", { id: "desktop-ai-plan", class: "secondary", text: tl("Ask AI for desktop steps"), onclick: () => {
    if (!desktopPlan.disabled) void controller.plan("desktop", desktopTask.value || "");
  } });
  const desktopPlanOutput = h("div", { id: "desktop-ai-preview", class: "toolbox-plan" });
  const desktopEl = h("div", { id: "desktop-panel", role: "tabpanel" }, desktopStatus, desktopAcknowledge,
    h("section", { class: "card" }, h("h2", { text: tl("Desktop control") }),
      h("p", { class: "hint", text: tl("Choose a window, capture it, then perform one explicit action. This works without AI. Each action stays bound to the captured window.") }),
      h("div", { class: "actions" }, windowsList), label("Choose a desktop window", windows),
      h("div", { class: "actions" }, desktopStart, observe, finish), windowInfo),
    h("div", { class: "columns toolbox-desktop-columns" }, h("section", { class: "card toolbox-capture-card" }, capture, captureHint,
      h("details", {}, h("summary", { text: tl("Observed window text") }), desktopText)),
      h("section", { class: "card" }, label("Action", action), coordinates, textField, keyField, scrollField, act,
        h("details", {}, h("summary", { text: tl("Last desktop result") }), desktopResult))),
    h("section", { class: "card" }, h("h2", { text: tl("Optional AI planning") }),
      h("p", { class: "hint", text: tl("Desktop AI proposes steps only. Fill the action fields yourself and perform each action explicitly.") }),
      label("Task", desktopTask), desktopPlan, desktopPlanOutput));

  function clearProposals() { controller.clearPlan(); }
  for (const field of [script, shell, repo, operation, domain, aiTask, desktopTask]) field.addEventListener(field.tagName === "SELECT" ? "change" : "input", clearProposals);
  shell.addEventListener("change", sync); operation.addEventListener("change", sync); action.addEventListener("change", sync); windows.addEventListener("change", sync);
  script.addEventListener("keydown", event => {
    const key = event as KeyboardEvent;
    if (key.key === "Enter" && key.ctrlKey && !key.isComposing && !key.repeat && !run.disabled) {
      key.preventDefault(); void controller.terminal({ shell: shell.value as TerminalShell, script: script.value || "", cwd: cwd.value || ".", timeout_seconds: Number(timeout.value) });
    }
  });
  capture.addEventListener("click", event => {
    if (act.disabled || !controller.snapshot.observation) return;
    const bounds = capture.getBoundingClientRect?.(); if (!bounds?.width || !bounds.height) return;
    const click = event as MouseEvent, observed = controller.snapshot.observation.window;
    x.value = String(Math.min(observed.width - 1, Math.max(0, Math.floor((click.clientX - bounds.left) / bounds.width * observed.width))));
    y.value = String(Math.min(observed.height - 1, Math.max(0, Math.floor((click.clientY - bounds.top) / bounds.height * observed.height))));
    action.value = "click"; sync();
  });
  function renderPlan(target: HTMLElement, wanted: ToolboxDomain) {
    const current = controller.snapshot.plan;
    if (!current || current.domain !== wanted) { target.replaceChildren(); return; }
    target.replaceChildren(h("p", { text: current.proposal.summary }), h("p", { class: "hint", text: `${current.provider || t("Unknown provider")} · ${current.model || t("Unknown model")} · ${t("Proposal only; nothing was executed.")}` }));
    for (const step of current.proposal.steps) {
      const copy = h("button", { class: "secondary", text: tl("Copy step into editor"), onclick: () => {
        if (controller.snapshot.pending || !visible || controller.snapshot.plan !== current) return;
        if (wanted === "terminal" && step.script != null) { script.value = step.script; script.focus(); }
        if (wanted === "github" && step.operation) {
          operation.value = step.operation; const args = step.arguments || {};
          for (const [field, name, max] of [[repo, "repo", 140], [ghTitle, "title", 256], [ghBody, "body", 20000], [head, "head", 256], [base, "base", 256]] as const) {
            field.value = typeof args[name] === "string" && args[name].length <= max ? args[name] : "";
          }
        }
        sync();
      } });
      copy.disabled = wanted === "desktop" || wanted === "terminal" && step.script == null || wanted === "github" && !step.operation;
      target.append(h("article", { class: "toolbox-plan-step" }, h("h3", { text: step.title }), h("p", { text: step.description }),
        step.script != null ? h("pre", { class: "toolbox-output", text: step.script }) : null,
        step.operation ? h("p", { class: "hint", text: t(operations[step.operation]) }) : null,
        wanted === "desktop" ? null : copy));
    }
  }
  function sync() {
    const state = controller.snapshot, ready = state.status, busy = !!state.pending;
    status.className = desktopStatus.className = state.error || state.unknownEffect ? "notice error" : "notice";
    status.textContent = desktopStatus.textContent = state.unknownEffect ? `${state.uncertainOperation ? `${t(operations[state.uncertainOperation])} · ${state.uncertainRepo || ""} · ` : ""}${t("The action result is uncertain. Check its result before running another action.")}${state.error ? ` ${t(state.error)}` : ""}`
      : state.error ? t(state.error) : busy ? t("Running local tool…") : ready ? t("Manual tools ready. AI planning is optional.") : t("Start LocalAI services, then refresh tool status.");
    acknowledge.hidden = desktopAcknowledge.hidden = !state.unknownEffect; acknowledge.disabled = desktopAcknowledge.disabled = busy;
    readiness.textContent = ready ? `${t("Workspace")}: ${ready.workspace_root} · CMD ${ready.terminal.cmd ? "✓" : "—"} · PowerShell ${ready.terminal.powershell ? "✓" : "—"} · Python ${ready.terminal.python ? "✓" : "—"} · GitHub ${ready.github.authenticated ? ready.github.user || "✓" : t(ready.github.installed ? "Not signed in" : "Not installed")}` : "";
    for (const field of [shell, cwd, timeout, script, operation, repo, ghTitle, ghBody, head, base, domain, aiTask, desktopTask]) field.disabled = busy || !ready;
    run.disabled = !ready || busy || !ready.terminal[shell.value as TerminalShell]; diagnostic.disabled = busy;
    const op = operation.value as GithubOperation;
    ghExecute.disabled = busy || !ready?.github.installed || op !== "status" && !ready?.github.authenticated;
    ghExecute.textContent = t(operations[op]); ghCreate.hidden = !["create_issue", "create_pr"].includes(op); ghBranches.hidden = op !== "create_pr";
    aiRun.disabled = desktopPlan.disabled = busy || !ready;
    const nextOutput = JSON.stringify([state.output, state.outputKind, t("Exit code")]);
    if (nextOutput !== outputKey) {
      const result = state.output; outputSummary.textContent = result ? `${state.outputKind === "terminal" ? result.shell : t(operations[result.operation!])} · ${t("Exit code")}: ${result.exit_code ?? "—"}${result.timed_out ? ` · ${t("Timed out")}` : ""}${result.output_truncated ? ` · ${t("Output shortened")}` : ""}${result.cwd ? ` · ${result.cwd}` : ""}` : t("No command has run yet.");
      stdout.textContent = result?.stdout || ""; stderr.textContent = result?.stderr || "";
      resultLink.hidden = !result?.url; resultLink.setAttribute("href", result?.url || ""); outputKey = nextOutput;
    }
    const nextPlan = JSON.stringify([state.plan, domain.value, t("Proposal only; nothing was executed.")]);
    if (nextPlan !== planKey) { renderPlan(plan, domain.value as ToolboxDomain); renderPlan(desktopPlanOutput, "desktop"); planKey = nextPlan; }
    const supported = !!ready?.desktop?.supported;
    windowsList.disabled = busy || !supported || !!state.session;
    windows.disabled = busy || !!state.session || !supported;
    desktopStart.disabled = busy || !supported || !!state.session || !state.windows.some(window => window.hwnd === windows.value);
    observe.disabled = busy || !state.session; finish.disabled = busy || !state.session;
    act.disabled = busy || !state.observation;
    for (const field of [action, x, y, text, key, amount]) field.disabled = act.disabled;
    coordinates.hidden = !["click", "scroll"].includes(action.value); textField.hidden = action.value !== "type"; keyField.hidden = action.value !== "keypress"; scrollField.hidden = action.value !== "scroll";
    const nextWindows = JSON.stringify(state.windows);
    if (nextWindows !== windowKey) { const selected = windows.value; windows.replaceChildren(h("option", { value: "", text: tl("Choose a desktop window") }), ...state.windows.map(window => h("option", { value: window.hwnd, text: `${window.title} · ${window.process} · ${window.width}×${window.height}` }))); windows.value = state.windows.some(window => window.hwnd === selected) ? selected : ""; windowKey = nextWindows; }
    const observation = state.observation;
    const nextCapture = observation ? `${observation.session_id}:${observation.state_hash}` : "";
    if (nextCapture !== captureKey) { capture.hidden = !observation; capture.setAttribute("src", observation ? `data:image/png;base64,${observation.capture.base64}` : ""); captureKey = nextCapture; }
    capture.hidden = !observation; captureHint.hidden = !observation;
    windowInfo.textContent = observation ? `${observation.window.title} · ${observation.window.process} · ${observation.window.width}×${observation.window.height}`
      : state.session ? t("Session active. Refresh the capture before an action.") : supported ? t("No desktop session is active.") : t("Desktop control is unavailable on this computer.");
    desktopText.textContent = observation?.editor_text || observation?.uia_text || ""; desktopResult.textContent = state.desktopResult;
  }
  sync();
  void onEvent<unknown>("localai-account-invalidated", () => {
    controller.invalidate(); aiTask.value = ""; desktopTask.value = ""; text.value = ""; sync();
  });
  return { el: terminalEl, desktopEl, controller, sync, prefillTerminal: (nextShell: TerminalShell, nextScript: string) => { shell.value = nextShell; script.value = nextScript; sync(); }, refresh: () => controller.refresh(), setVisible: (next: boolean, panel: "toolbox" | "desktop" = activePanel) => {
    if (panel !== activePanel && visible) controller.setVisible(false);
    activePanel = panel; visible = next; controller.setVisible(next);
    if (!next) { aiTask.value = ""; desktopTask.value = ""; text.value = ""; ghBody.value = ""; }
    sync();
  } };
}
