import { h } from "../views/dom";
import { t, tl } from "../i18n/i18n";
import { Bridge } from "../core/bridge";
import { CapabilitiesController, observedEditorText, parseChatIDs, type CapabilitiesTransport } from "../core/capabilities";
import type { AccountTransport } from "../core/telegram-account";
import { buildTelegramAccount } from "./telegram-account";
import type { ToolboxTransport } from "../core/toolbox";
import { buildToolbox } from "./toolbox";
import { buildVoice } from "./voice";

const TRANSPORT: CapabilitiesTransport = {
  capabilities: () => Bridge.localAICapabilities(),
  configure: (config) => Bridge.localAITelegramConfigure(config),
  telegram: (action) => action === "start" ? Bridge.localAITelegramStart() : Bridge.localAITelegramStop(),
  plan: (plan) => Bridge.localAIComputerPlan(plan),
  approve: (id) => Bridge.localAIComputerApprove(id),
  finish: () => Bridge.localAIComputerFinish(),
  stop: () => Bridge.localAIStop(),
};

export function buildTools(transport: CapabilitiesTransport = TRANSPORT, accountTransport?: AccountTransport, toolboxTransport?: ToolboxTransport) {
  let activeTab: "tools" | "account" | "toolbox" | "desktop" | "voice" = "tools", windowVisible = false;
  const status = h("div", { class: "notice", role: "status", "aria-live": "polite" });
  const telegramStatus = h("p", { class: "muted" });
  const token = h("input", { id: "telegram-token", type: "password", autocomplete: "off", maxlength: 256,
    placeholder: tl("Leave blank to keep the saved token") });
  const chats = h("input", { id: "telegram-chats", type: "text", autocomplete: "off", maxlength: 2000,
    placeholder: "123456789, -1001234567890" });
  const task = h("textarea", { id: "computer-task", rows: 3, maxlength: 2000 });
  const title = h("input", { id: "computer-window", type: "text", maxlength: 200 });
  const path = h("input", { id: "computer-document", type: "text", maxlength: 500,
    placeholder: "…\\workspace\\test.txt" });
  const workspaceHint = h("p", { class: "muted" });
  const expected = h("textarea", { id: "computer-expected", rows: 3, maxlength: 2000,
    placeholder: tl("Optional. Leave blank for a task that needs model planning.") });
  const saved = h("input", { id: "computer-saved", type: "checkbox" });
  const review = h("div", { class: "review", "aria-live": "polite" });
  const requests = h("div", { class: "remote-requests" });
  const observed = h("pre", { class: "editor-preview", id: "computer-observation" });
  const controller = new CapabilitiesController(transport, sync);
  const refresh = h("button", { class: "secondary", text: tl("Refresh"), onclick: () => void refreshCurrent() });
  const emergency = h("button", { class: "danger", id: "tools-stop", text: tl("Stop Local AI"),
    onclick: () => {
      voice.halt();
      toolbox.controller.invalidate();
      account.clearSecrets(); account.controller.invalidate(); account.controller.snapshot.pending = "stop"; account.sync();
      void controller.run("stop").finally(() => {
        account.controller.snapshot.pending = null; account.sync();
        if (windowVisible && activeTab === "account") void account.controller.refresh();
      });
    } });
  const configure = h("button", { id: "telegram-save", text: tl("Save Telegram settings"), onclick: () => {
    try {
      const ids = parseChatIDs(chats.value);
      const enteredToken = token.value.trim();
      token.value = ""; // Never retain/resend an entered credential in view/controller state.
      void controller.run("configure", { ...(enteredToken ? { token: enteredToken } : {}), allowed_chat_ids: ids, enabled: false });
    } catch (error) { showError(error); }
  } });
  const start = h("button", { id: "telegram-start", text: tl("Start Telegram bot"), onclick: () => void controller.run("start") });
  const stop = h("button", { id: "telegram-stop", class: "secondary", text: tl("Stop Telegram bot"), onclick: () => void controller.run("telegram-stop") });
  const plan = h("button", { id: "computer-plan", text: tl("Observe and prepare one action"), onclick: () => {
    if (!task.value.trim() || !title.value.trim() || !path.value.trim()) { showError(new Error(t("Enter a task, Notepad title and document path."))); return; }
    void controller.run("plan", { task: task.value.trim(), window_title: title.value.trim(), document_path: path.value.trim(),
      ...(expected.value !== "" ? { expected_text: expected.value } : {}), require_saved: saved.checked });
  } });
  const approve = h("button", { id: "computer-approve", text: tl("Approve this one action"), onclick: () => void controller.run("approve") });
  const cancel = h("button", { id: "computer-cancel", class: "secondary", text: tl("Cancel Windows task"), onclick: () => void controller.run("finish") });
  const label = (text: string, input: HTMLElement) => h("label", { class: "field", for: input.id }, h("span", { text: tl(text) }), input);
  const header = h("header", {}, h("div", {}, h("h1", { text: tl("Telegram and Windows tools") }),
      h("p", { class: "muted", text: tl("Manual tools work without AI. AI planning is optional and never runs actions automatically.") })),
      h("div", { class: "actions" }, refresh, emergency));
  const account = buildTelegramAccount(accountTransport, () => header.getBoundingClientRect?.().height || 120);
  const toolbox = buildToolbox(toolboxTransport);
  const voice = buildVoice(tab => setTab(tab), toolbox.prefillTerminal);
  const voiceTab = h("button", { id: "voice-tab", role: "tab", "aria-controls": "voice-panel", "aria-selected": "false", text: "🎙 Ovoz", onclick: () => setTab("voice") });
  const toolsTab = h("button", { id: "tools-tab", role: "tab", "aria-controls": "bot-windows-panel", "aria-selected": "true",
    text: tl("Bot and Windows"), onclick: () => setTab("tools") });
  const accountTab = h("button", { id: "account-tab", role: "tab", "aria-controls": "personal-account-panel", "aria-selected": "false",
    text: tl("Personal Telegram"), onclick: () => setTab("account") });
  const toolboxTab = h("button", { id: "toolbox-tab", role: "tab", "aria-controls": "toolbox-panel", "aria-selected": "false",
    text: tl("CMD, PowerShell and GitHub"), onclick: () => setTab("toolbox") });
  const desktopTab = h("button", { id: "desktop-tab", role: "tab", "aria-controls": "desktop-panel", "aria-selected": "false",
    text: tl("Desktop"), onclick: () => setTab("desktop") });
  const approvalRow = h("div", { class: "actions review-actions" }, approve);
  const reviewCard = h("section", { class: "card review-card" }, h("h2", { text: tl("Review the next action") }), review,
    approvalRow, h("details", {}, h("summary", { text: tl("Observed editor text") }), observed));
  const toolsPanel = h("div", { id: "bot-windows-panel", role: "tabpanel", "aria-labelledby": "tools-tab" },
    h("div", { class: "columns" },
      h("section", { class: "card" }, h("h2", { text: tl("Telegram bot") }), telegramStatus,
        h("p", { class: "muted", text: tl("This setup is for a bot. A personal Telegram account needs a separate login flow.") }),
        label("Bot token", token), label("Allowed Telegram chat IDs", chats),
        h("p", { class: "hint", text: tl("The token is saved on this computer. It is never shown again. Saving keeps the bot stopped; start it explicitly.") }),
        h("div", { class: "actions" }, configure, start, stop),
        h("h2", { text: tl("Telegram task requests") }),
        h("p", { class: "hint", text: tl("Remote requests never run Windows actions. Copy a task, choose its document and window, then review it here.") }), requests),
      h("section", { class: "card" }, h("h2", { text: tl("Windows task") }),
        workspaceHint,
        label("Task", task), label("Notepad window title", title), label("Document path", path),
        label("Exact text to write", expected),
        h("label", { class: "check", for: saved.id }, saved, h("span", { text: tl("The task requires saving to disk") })),
        h("div", { class: "actions" }, plan, cancel))),
    reviewCard);
  account.el.setAttribute("aria-labelledby", "account-tab"); account.el.hidden = true;
  toolbox.el.setAttribute("aria-labelledby", "toolbox-tab"); toolbox.el.hidden = true;
  toolbox.desktopEl.setAttribute("aria-labelledby", "desktop-tab"); toolbox.desktopEl.hidden = true;
  voice.el.setAttribute("aria-labelledby", "voice-tab"); voice.el.hidden = true;
  const el = h("main", {}, header, h("nav", { class: "tools-tabs", role: "tablist", "aria-label": tl("Tools sections") }, toolsTab, accountTab, toolboxTab, desktopTab, voiceTab),
    status, toolsPanel, account.el, toolbox.el, toolbox.desktopEl, voice.el);
  function refreshCurrent() { return activeTab === "voice" ? voice.refresh() : activeTab === "account" ? account.controller.refresh() : activeTab === "toolbox" || activeTab === "desktop" ? toolbox.refresh() : controller.refresh(); }
  function setTab(tab: "tools" | "account" | "toolbox" | "desktop" | "voice") {
    activeTab = tab; token.value = ""; account.clearSecrets();
    toolsPanel.hidden = tab !== "tools"; account.el.hidden = tab !== "account";
    toolbox.el.hidden = tab !== "toolbox"; toolbox.desktopEl.hidden = tab !== "desktop";
    voice.el.hidden = tab !== "voice"; voice.setVisible(windowVisible && tab === "voice");
    status.hidden = tab !== "tools";
    account.setVisible(windowVisible && tab === "account");
    toolbox.setVisible(windowVisible && (tab === "toolbox" || tab === "desktop"), tab === "desktop" ? "desktop" : "toolbox");
    toolsTab.setAttribute("aria-selected", String(tab === "tools")); accountTab.setAttribute("aria-selected", String(tab === "account"));
    toolboxTab.setAttribute("aria-selected", String(tab === "toolbox")); desktopTab.setAttribute("aria-selected", String(tab === "desktop"));
    voiceTab.setAttribute("aria-selected", String(tab === "voice"));
    if (windowVisible) void refreshCurrent();
  }
  let chatsHydrated = false;
  let lastReviewKey = "";
  function showError(error: unknown) { status.textContent = error instanceof Error ? error.message : String(error); status.className = "notice error"; }
  function sync() {
    const state = controller.snapshot, telegram = state.capabilities?.telegram;
    const workspace = state.capabilities?.computer.workspace_root;
    path.placeholder = workspace ? `${workspace}\\test.txt` : "…\\workspace\\test.txt";
    workspaceHint.textContent = workspace
      ? t("Only a verified Notepad editor and a .txt/.md document in {workspace} are supported. Each action needs your review.", { workspace })
      : t("Only a verified Notepad editor and a .txt/.md document in the local workspace are supported. Each action needs your review.");
    status.className = state.error ? "notice error" : "notice";
    status.textContent = state.error ? t(state.error) : state.pending ? t("Waiting for local tools…")
      : state.notice ? t(state.notice) : state.capabilities ? t("Local tools connected") : t("Open LocalAI services, then refresh.");
    if (telegram) {
      telegramStatus.textContent = `${telegram.bot_username ? `@${telegram.bot_username} · ` : ""}${t(telegram.running ? "Telegram bot is running" : telegram.configured ? "Telegram bot is stopped" : "Telegram token is not configured")}${telegram.last_error ? ` · ${telegram.last_error}` : ""}`;
      if (!chatsHydrated) { chats.value = telegram.allowed_chat_ids.join(", "); chatsHydrated = true; }
    } else telegramStatus.textContent = t("Telegram status unavailable");
    const busy = !!state.pending;
    configure.disabled = busy; start.disabled = busy || !telegram?.configured || telegram.running;
    stop.disabled = busy || !telegram?.running;
    plan.disabled = busy || !state.capabilities?.ok || state.capabilities.computer.active;
    for (const field of [task, title, path, expected, saved]) field.disabled = busy || !!state.capabilities?.computer.active;
    token.disabled = busy; chats.disabled = busy;
    cancel.disabled = state.pending === "finish" || state.pending === "stop" || !(state.capabilities?.computer.active || state.review || busy);
    emergency.disabled = state.pending === "stop";
    refresh.disabled = busy;
    approve.disabled = busy || !state.capabilities?.ok || state.review?.status !== "pending";
    requests.replaceChildren();
    for (const request of state.capabilities?.remote_requests || []) {
      const useTask = h("button", { class: "secondary", text: tl("Use this task"), onclick: () => {
        if (controller.snapshot.pending || controller.snapshot.capabilities?.computer.active) return;
        task.value = request.task; title.value = ""; path.value = ""; expected.value = ""; saved.checked = false;
        task.focus();
      } });
      useTask.disabled = busy || !!state.capabilities?.computer.active;
      requests.append(h("div", { class: "request-card" },
        h("p", { class: "muted", text: `Chat ${request.chat_id} · ${new Date(request.created_at * 1000).toLocaleString()}` }),
        h("p", { text: request.task }), useTask));
    }
    if (!requests.children.length) requests.append(h("p", { class: "muted", text: tl("No remote task requests.") }));
    review.replaceChildren(); observed.textContent = observedEditorText(state.review);
    const current = state.review;
    if (!current) review.append(h("p", { class: state.error ? "error" : "muted",
      text: state.error || tl("No action is waiting for approval.") }));
    else if (current.status === "pending" && current.proposal) {
      const proposal = current.proposal;
      review.append(h("p", { text: t("Actions remaining: {count}", { count: String(current.actions_remaining ?? "—") }) }),
        h("strong", { text: t("Proposed action: {action}", { action: proposal.action }) }),
        h("pre", { class: "action-preview", text: proposal.action === "type" ? proposal.text || ""
          : proposal.action === "keypress" ? proposal.key || "" : proposal.action === "finish" ? t("Finish and verify the task") : `x=${proposal.x}, y=${proposal.y}` }),
        h("p", { text: current.reason || "" }), h("p", { class: "muted", text: current.expected_postcondition || "" }));
    } else if (current.status === "finished") review.append(h("p", { class: current.verified_task_success ? "verified" : "unverified",
      text: t(current.verified_task_success ? "The result was verified against the requested text." : "The task ended. Check the result; success was not verified.") }));
    else review.append(h("p", { class: "error", text: current.error || t("Windows task cancelled.") }));
    const reviewKey = current ? `${current.id}:${current.status}` : state.error ? `error:${state.error}` : "";
    const shouldScroll = !!reviewKey && reviewKey !== lastReviewKey;
    lastReviewKey = reviewKey;
    if (shouldScroll) requestAnimationFrame(() => {
      if (lastReviewKey !== reviewKey) return;
      const headerHeight = header.getBoundingClientRect?.().height || 120;
      const cardHeight = reviewCard.getBoundingClientRect?.().height || 0;
      reviewCard.style.setProperty("scroll-margin-top", `${headerHeight + 16}px`);
      // Include the approval sibling in the scroll target. A long preview can
      // exceed the viewport; in that case keep its explicit action row visible.
      if (cardHeight <= (window.innerHeight || 720) - headerHeight - 32) {
        reviewCard.scrollIntoView({ block: "start", behavior: "smooth" });
      } else approvalRow.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }
  sync();
  return { el, controller, account, toolbox, voice, setTab, sync: () => { sync(); account.sync(); toolbox.sync(); voice.sync(); }, refresh: refreshCurrent,
    setVisible: (visible: boolean) => {
      windowVisible = visible; account.setVisible(visible && activeTab === "account"); toolbox.setVisible(visible && (activeTab === "toolbox" || activeTab === "desktop"), activeTab === "desktop" ? "desktop" : "toolbox");
      voice.setVisible(visible && activeTab === "voice");
      if (!visible) { token.value = ""; account.clearSecrets(); }
    } };
}
