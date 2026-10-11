import { h } from "../views/dom";
import { t, tl } from "../i18n/i18n";
import { Bridge, emitToWindow, onEvent } from "../core/bridge";
import { AccountController, type AccountTransport } from "../core/telegram-account";
import { buildTelegramMessenger } from "./telegram-messenger";

const TRANSPORT: AccountTransport = {
  status: () => Bridge.localAIAccountStatus(), configure: (config) => Bridge.localAIAccountConfigure(config),
  connect: (phone) => Bridge.localAIAccountConnect(phone), verify: (input) => Bridge.localAIAccountVerify(input),
  disconnect: () => Bridge.localAIAccountDisconnect(), chats: (options) => Bridge.localAIAccountChats(options),
  messages: (id, options) => Bridge.localAIAccountMessages(id, options), draft: (id, instruction, reply) => Bridge.localAIAccountDraft(id, instruction, reply),
  compose: (id, text, reply) => Bridge.localAIAccountCompose(id, text, reply), resolve: (recipient) => Bridge.localAIAccountResolve(recipient),
  cancel: (id) => Bridge.localAIAccountCancelDraft(id),
  send: (id) => Bridge.localAIAccountSend(id),
};

export function buildTelegramAccount(transport: AccountTransport = TRANSPORT, headerHeight = () => 120) {
  const connection = h("p", { class: "muted", role: "status", "aria-live": "polite" });
  const notice = h("div", { class: "notice", role: "status", "aria-live": "polite" });
  const apiID = h("input", { id: "account-api-id", type: "number", min: 1, max: 2147483647, autocomplete: "off" });
  const apiHash = h("input", { id: "account-api-hash", type: "password", maxlength: 32, autocomplete: "off",
    placeholder: tl("Leave blank to keep the saved API hash") });
  const phone = h("input", { id: "account-phone", type: "tel", maxlength: 17, autocomplete: "off", placeholder: "+998…" });
  const code = h("input", { id: "account-code", type: "password", inputmode: "numeric", maxlength: 8, autocomplete: "off" });
  const password = h("input", { id: "account-password", type: "password", maxlength: 256, autocomplete: "off" });
  const chatSelect = h("select", { id: "account-chat", onchange: () => {
    if (chatSelect.disabled) return;
    selectChat(chatSelect.value);
  } });
  const controller = new AccountController(transport, sync);
  let apiEditing = false, visible = false, authExpanded = false;
  let contextKey = "";
  function publishContext() {
    const state = controller.snapshot, chat = state.selected;
    const payload = chat && state.status?.authorized && state.status.state === "authorized" ? {
      chat_id: chat.chat_id, title: chat.title, kind: chat.kind, username: chat.username || null, is_self: chat.is_self || false,
    } : null;
    const key = JSON.stringify(payload);
    if (contextKey === key) return;
    contextKey = key;
    for (const window of ["island", "studio"]) void emitToWindow(window, "localai-telegram-context", payload);
  }
  function selectChat(id: string) { controller.select(id); publishContext(); }
  const messenger = buildTelegramMessenger(controller, chatSelect, selectChat, () => visible);
  let lastAuthState = "", pendingAuthStage = "", authRevision = 0;
  function clearSecrets() { ++authRevision; for (const input of [apiHash, phone, code, password]) input.value = ""; }
  function showError(error: string) { notice.textContent = t(error); notice.className = "notice error"; }
  const retry = h("button", { id: "account-retry-status", class: "secondary", text: tl("Retry LocalAI status"), onclick: () => {
    if (!retry.disabled) void controller.refresh();
  } });
  const reconnect = h("button", { id: "account-reconnect", text: tl("Reconnect Telegram"), onclick: async () => {
    if (reconnect.disabled) return;
    clearSecrets(); await controller.run("disconnect");
    if (controller.snapshot.status?.state === "disconnected" && !controller.snapshot.status.teardown_pending) await controller.run("connect");
  } });
  const recoveryReason = h("p", { class: "error" });
  const recovery = h("div", { id: "account-service-recovery", class: "account-api-editor", role: "status" }, recoveryReason,
    h("p", { class: "hint", text: tl("Open LocalAI Studio from your desktop and press Start services, then retry here.") }), retry);
  const configure = h("button", { id: "account-save", text: tl("Save app API settings"), onclick: () => {
    if (configure.disabled) return;
    const id = Number(apiID.value), hash = apiHash.value.trim();
    if (!Number.isInteger(id) || id < 1 || id > 2147483647 || hash && !/^[a-fA-F0-9]{32}$/.test(hash)
      || !hash && !controller.snapshot.status?.configured) { showError("Enter a valid Telegram API ID and 32-character API hash."); return; }
    clearSecrets(); apiEditing = false;
    void controller.run("configure", { api_id: id, api_hash: hash });
  } });
  const connect = h("button", { id: "account-connect", text: tl("Send Telegram login code"), onclick: () => {
    if (connect.disabled) return;
    const enteredPhone = phone.value.trim();
    if (enteredPhone && !/^\+[1-9]\d{6,14}$/.test(enteredPhone)) { showError("Enter a phone number with its country code."); return; }
    if (!enteredPhone && !controller.snapshot.status?.has_saved_session) { showError("Enter a phone number with its country code."); return; }
    clearSecrets();
    void controller.run("connect", enteredPhone || undefined);
  } });
  const verifyCode = h("button", { id: "account-verify-code", text: tl("Verify login code"), onclick: () => {
    if (verifyCode.disabled || controller.snapshot.status?.state !== "code_required") return;
    const enteredCode = code.value.trim();
    if (!/^\d{4,8}$/.test(enteredCode)) { showError("Enter the requested login code or 2FA password."); return; }
    clearSecrets();
    void controller.run("verify", { code: enteredCode });
  } });
  const verifyPassword = h("button", { id: "account-verify-password", text: tl("Verify 2FA password"), onclick: () => {
    if (verifyPassword.disabled || controller.snapshot.status?.state !== "password_required") return;
    const enteredPassword = password.value;
    if (!enteredPassword || enteredPassword.length > 256) { showError("Enter the requested login code or 2FA password."); return; }
    clearSecrets();
    void controller.run("verify", { password: enteredPassword });
  } });
  const disconnect = h("button", { id: "account-disconnect", class: "secondary", text: tl("Disconnect (keep saved login)"),
    onclick: () => { clearSecrets(); void controller.run("disconnect"); } });
  const label = (text: string, input: HTMLElement) => h("label", { class: "field", for: input.id }, h("span", { text: tl(text) }), input);
  const apiSummary = h("span", { id: "account-api-summary", class: "muted" });
  const editAPI = h("button", { id: "account-edit-api", class: "secondary", text: tl("Edit app API settings"), onclick: () => {
    if (editAPI.disabled) return;
    apiEditing = !apiEditing;
    if (apiEditing && controller.snapshot.status?.configured && controller.snapshot.status.api_id) apiID.value = String(controller.snapshot.status.api_id);
    if (!apiEditing) apiHash.value = ""; sync();
  } });
  const apiEditor = h("div", { id: "account-api-editor", class: "account-api-editor" },
    label("Telegram API ID", apiID), label("Telegram API hash", apiHash), configure);
  const stepHint = h("p", { id: "account-login-step-hint", class: "account-login-hint", role: "status", "aria-live": "polite" });
  const phoneHint = h("p", { class: "hint" }), codeHint = h("p", { class: "hint" }), passwordHint = h("p", { class: "hint" });
  const phoneForm = h("div", { id: "account-phone-step", class: "account-auth-step" }, h("h3", { text: tl("1 · Phone") }),
    label("Phone with country code", phone), connect, phoneHint);
  const codeForm = h("div", { id: "account-code-step", class: "account-auth-step" }, h("h3", { text: tl("2 · Login code") }),
    label("Login code from Telegram", code), verifyCode, codeHint);
  const passwordForm = h("div", { id: "account-password-step", class: "account-auth-step" }, h("h3", { text: tl("3 · 2FA (if requested)") }),
    label("Telegram 2FA password", password), verifyPassword, passwordHint);
  phone.addEventListener("input", sync);
  const authBody = h("div", { id: "account-auth-body" },
    h("p", { class: "hint", text: tl("Enter API credentials and sign in yourself. Login codes and 2FA passwords are never entered by the AI.") }),
    h("div", { class: "account-api-summary actions" }, apiSummary, editAPI), apiEditor, stepHint,
    h("div", { class: "account-auth-grid" }, phoneForm, codeForm, passwordForm),
    h("div", { class: "actions account-disconnect" }, disconnect),
    h("p", { class: "hint", text: tl("Disconnect closes the connection and keeps encrypted credentials and the saved session. It does not log out of Telegram.") }));
  const authToggle = h("button", { id: "account-toggle-auth", class: "secondary", text: tl("Account settings"), onclick: () => {
    authExpanded = !authExpanded; if (!authExpanded) clearSecrets(); sync();
  } });
  const el = h("div", { id: "personal-account-panel", role: "tabpanel" }, notice, recovery,
      h("section", { class: "card account-signin-card" }, h("div", { class: "account-connection-bar" },
        h("div", {}, h("h2", { text: tl("Personal Telegram account") }), connection), h("div", { class: "actions" }, reconnect, authToggle)), authBody), messenger.el);
  function sync() {
    const state = controller.snapshot, status = state.status;
    const busy = !!state.pending || !!status?.busy || !!status?.teardown_pending;
    const authorized = !!status?.authorized && status.state === "authorized";
    reconnect.hidden = !authorized || status?.connected !== false;
    reconnect.disabled = busy || !status?.available || !status.has_saved_session;
    authToggle.hidden = !authorized; authToggle.setAttribute("aria-expanded", String(authExpanded));
    authBody.hidden = authorized && !authExpanded;
    publishContext();
    recovery.hidden = !!status?.available;
    retry.disabled = !!state.pending || state.checking;
    retry.textContent = t(state.checking ? "Checking LocalAI services…" : "Retry LocalAI status");
    recoveryReason.textContent = t(state.checking ? "Checking LocalAI services…" : !status ? "LocalAI status could not be loaded. API saving and login stay disabled until the local service responds."
      : "The local service responds, but personal Telegram support is unavailable. Check LocalAI Studio services and retry.");
    connection.textContent = !status ? t(state.checking ? "Checking LocalAI services…" : "LocalAI service is unavailable") : !status.available ? t("Personal Telegram support is unavailable")
      : status.teardown_pending ? t("The Telegram connection is still closing…") : authorized && status.connected === false ? t("Telegram is offline. Reconnect to continue.")
      : `${t({ disconnected: "Personal account disconnected", connecting: "Connecting personal account…", code_required: "Enter the login code yourself",
        password_required: "Enter the 2FA password yourself", authorized: "Personal account authorized", error: "Personal account needs attention" }[status.state])}${status.username ? ` · @${status.username}` : ""}`;
    const authError = !authorized && status?.last_error;
    notice.className = state.error || status?.last_error ? "notice error" : "notice";
    notice.textContent = state.pending === "send" ? t("Sending this Telegram message once…")
      : state.sent?.status === "unknown" ? t("The send result is unknown. Check Telegram before composing another message.")
      : authError || (state.error ? t(state.error) : status?.last_error || (state.pending ? t("Waiting for personal Telegram…") : state.notice ? t(state.notice) : ""));
    if (status?.api_id && !apiID.value) apiID.value = String(status.api_id);
    apiSummary.textContent = !status ? t("LocalAI must be running before API settings can be saved.")
      : status.configured ? t("App API settings are saved.") : t("Save app API settings before requesting a login code.");
    apiEditor.hidden = !!status?.configured && !apiEditing;
    editAPI.hidden = !status?.configured; editAPI.disabled = busy || authorized;
    editAPI.textContent = t(apiEditing ? "Close app API settings" : "Edit app API settings");
    configure.disabled = busy || !status?.available || authorized;
    connect.disabled = busy || !status?.configured || !status.available || authorized || ["code_required", "password_required"].includes(status.state);
    connect.textContent = t(status?.has_saved_session && !phone.value?.trim() ? "Restore saved Telegram login" : "Send Telegram login code");
    disconnect.disabled = state.pending === "disconnect" || !status?.available || status.state === "disconnected" && !busy;
    for (const input of [apiID, apiHash]) input.disabled = busy || authorized;
    phone.disabled = connect.disabled;
    code.disabled = busy || !status?.available || status.state !== "code_required";
    password.disabled = busy || !status?.available || status.state !== "password_required";
    verifyCode.disabled = code.disabled; verifyPassword.disabled = password.disabled;
    const authState = status?.state || "", stage = authorized ? "done" : !status?.configured ? "api"
      : authState === "code_required" ? "code" : authState === "password_required" ? "password" : "phone";
    stepHint.textContent = t(!status?.available ? "Restore the local service and retry before starting Telegram login."
      : busy ? "Waiting for Telegram. Do not submit the login step again."
      : stage === "api" ? "Save app API settings before requesting a login code."
      : stage === "code" ? "Enter the code received in Telegram, then verify it."
      : stage === "password" ? "Telegram requested 2FA. Enter your password below."
      : stage === "done" ? "Signed in. Load chats only when you choose."
      : "Enter your phone number, then press Send Telegram login code.");
    phoneHint.textContent = t(authorized ? "Login is complete." : ["code_required", "password_required"].includes(authState)
      ? "The login code was requested. Continue with the next step."
      : status?.has_saved_session ? "Leave the phone blank to restore the saved login, or enter a number to request a code."
      : "Use a country code, for example +998901234567.");
    codeHint.textContent = t(authorized || authState === "password_required" ? "Login code accepted." : authState === "code_required"
      ? "Enter the code sent by Telegram. The AI will not enter it."
      : "First request a login code in step 1. This field will become active.");
    passwordHint.textContent = t(authState === "password_required" ? "Enter your own 2FA password to finish signing in."
      : "This step is only needed if Telegram asks for a 2FA password.");
    for (const [form, name] of [[phoneForm, "phone"], [codeForm, "code"], [passwordForm, "password"]] as const) {
      form.setAttribute("data-active", String(stage === name)); form.setAttribute("aria-current", stage === name ? "step" : "false");
    }
    if (authState !== lastAuthState) { lastAuthState = authState; pendingAuthStage = ["phone", "code", "password"].includes(stage) ? stage : ""; }
    if (pendingAuthStage && visible && !el.hidden && !busy) {
      const target = pendingAuthStage, revision = authRevision; pendingAuthStage = "";
      requestAnimationFrame(() => {
        const latest = controller.snapshot;
        const expected = target === "code" ? "code_required" : target === "password" ? "password_required" : authState;
        const field = target === "code" ? code : target === "password" ? password : phone;
        const form = target === "code" ? codeForm : target === "password" ? passwordForm : phoneForm;
        if (revision !== authRevision || !visible || el.hidden || latest.status?.state !== expected || latest.pending || latest.status?.busy || latest.status?.teardown_pending || field.disabled) return;
        form.style.setProperty("scroll-margin-top", `${headerHeight() + 16}px`);
        form.scrollIntoView({ block: "nearest", behavior: "smooth" });
        if (!field.value && (document.visibilityState !== "hidden")) field.focus({ preventScroll: true });
      });
    }
    messenger.sync();
  }
  sync();
  void onEvent<unknown>("localai-account-invalidated", () => {
    clearSecrets(); messenger.reset(); controller.invalidate(); controller.snapshot.status = null; sync();
    if (visible) void controller.refresh();
  });
  return { el, controller, sync, clearSecrets, setVisible: (next: boolean) => {
    visible = next; if (!next) { clearSecrets(); messenger.hide(); controller.cancelPrivateRequests(); } sync();
  } };
}
