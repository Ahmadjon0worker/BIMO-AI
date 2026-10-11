// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView /
// ModelPickerView from IslandViewContent.swift.
//
// Answers are rendered as Markdown (markdown.ts). A local model streams its
// answer: Rust sends `chat-delta` events with the text visible so far. The
// model name above the text field opens the picker: provider chips, then the
// models of the chosen provider, asked for only once it is picked.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { renderMarkdown } from "./markdown";
import { Bridge, onEvent, type ChatContext, type ModelInfo } from "../core/bridge";
import {
  activeModel, pickModel, providerDef, visibleProviders, withModel, type ProviderDef,
} from "../core/providers";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
import type { ViewHost } from "./views";
import { N_, t, tl } from "../i18n/i18n";
import { createThinkingOrb } from "../effects/thinking-orb";
import {
  isTelegramCommand, parseTelegramCommand, parseTelegramRecipient, telegramRequestNeedsClarification,
  telegramUsesMessageReference, telegramExplicitReviewRequested, TelegramActionController, type TelegramRecipient,
} from "../core/telegram-command";

const STRINGS = {
  placeholderFirst: N_("Ask me anything…"),
  placeholderNext: N_("Continue…"),
  send: N_("Send"),
  switchModel: N_("Switch provider or model"),
  noModel: N_("Choose a model"),
  loading: N_("Loading models…"),
  noKey: N_("No API key — add it in Settings."),
  openSettings: N_("Open Settings"),
};

let nextId = 1;

function bubble(message: ChatMessage): HTMLElement {
  if (message.role === "user") {
    return h(
      "div",
      { class: "chat-row user" },
      h("div", { class: "bubble", text: message.content }),
    );
  }
  const reply = h("div", { class: "reply" });
  renderMarkdown(reply, message.content);
  return h("div", { class: "chat-row" }, reply);
}

/** The coloured chip showing what the question is about (a dropped file). */
function contextChip(label: string): HTMLElement {
  const chip = h("div", { class: "chip" }, h("i", { class: "chip-dot" }), h("span", { text: label }));
  requestAnimationFrame(() => chip.classList.add("settled"));
  return chip;
}

function saveSettings() {
  void Bridge.saveSettings(State.settings);
}

// ── Model picker ──────────────────────────────────────────────────────────────

interface Picker {
  el: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

/** Provider chips, then the chosen provider's models — ModelPickerView. */
function buildPicker(onChange: () => void): Picker {
  const chips = h("div", { class: "picker-chips" });
  const list = h("div", { class: "picker-list" });
  const refresh = h("button", { class: "picker-link picker-refresh", text: tl("Refresh models") });
  const manual = h("input", { type: "text", class: "picker-model-input", placeholder: tl("Model ID"), "aria-label": tl("Model ID") }) as HTMLInputElement;
  const use = h("button", { class: "picker-link picker-use-model", text: tl("Use model") });
  const controls = h("div", { class: "picker-controls" }, manual, use, refresh);
  const el = h("div", { class: "picker" }, chips, h("div", { class: "picker-rule" }), controls, list);

  /** Models already asked for, by provider; a model server is asked again each time. */
  const cache = new Map<string, ModelInfo[]>();
  let isOpen = false;
  let request = 0;

  function drawChips() {
    clear(chips);
    for (const p of visibleProviders(State.settings)) {
      const on = p.id === State.settings.chatProvider;
      const chip = h(
        "button",
        { class: on ? "picker-chip on" : "picker-chip", style: `--accent:${p.accent}` },
        h("i", { class: "picker-dot" }),
        h("span", { text: t(p.name) }),
      );
      chip.addEventListener("click", () => {
        if (p.id === State.settings.chatProvider) return;
        State.settings = { ...State.settings, chatProvider: p.id };
        saveSettings();
        Sound.play("pop");
        drawChips();
        void loadModels();
        onChange();
      });
      chips.append(chip);
    }
  }

  function status(text: string, withSettings = false) {
    clear(list);
    const line = h("div", { class: "picker-status", text });
    if (withSettings) {
      line.append(
        h("button", {
          class: "picker-link",
          text: tl(STRINGS.openSettings),
          onclick: () => void Bridge.openSettingsWindow(),
        }),
      );
    }
    list.append(line);
  }

  function drawModels(p: ProviderDef, models: ModelInfo[]) {
    clear(list);
    const current = activeModel(State.settings);
    for (const m of models) {
      const on = m.id === current;
      const row = h(
        "button",
        { class: on ? "picker-model on" : "picker-model", style: `--accent:${p.accent}`, title: m.id },
        h("span", { class: "picker-model-name", text: m.label }),
        on ? svg(ICONS.check, 11, { stroke: 2.2 }) : null,
      );
      row.addEventListener("click", () => {
        State.settings = withModel(State.settings, p.id, m.id);
        saveSettings();
        Sound.play("blip");
        close();
      });
      list.append(row);
    }
    list.querySelector(".picker-model.on")?.scrollIntoView({ block: "nearest" });
  }

  async function loadModels() {
    const p = providerDef(State.settings.chatProvider);
    controls.hidden = p.id === "auto";
    manual.value = p.id === "auto" ? "" : activeModel(State.settings);
    const ticket = ++request;
    const cached = p.urlField || p.id === "auto" ? undefined : cache.get(p.id);
    if (cached) {
      drawModels(p, cached);
      return;
    }
    // Nothing is asked of a provider that has no key yet.
    if (p.key && !(await Bridge.secretPresent(p.key))) {
      if (ticket === request) status(t(STRINGS.noKey), true);
      return;
    }
    if (ticket !== request) return;
    status(t(STRINGS.loading));
    try {
      const models = await Bridge.chatModels(p.id);
      if (ticket !== request) return;
      if (!p.urlField && p.id !== "auto") cache.set(p.id, models);
      const keep = pickModel(p, models.map((m) => m.id), activeModel(State.settings));
      if (keep && keep !== activeModel(State.settings)) {
        State.settings = withModel(State.settings, p.id, keep);
        saveSettings();
        onChange();
      }
      if (models.length) drawModels(p, models);
      else status(t("No models available. Download an Ollama model or check your provider account."), true);
    } catch (err) {
      if (ticket === request) status(String(err).replace(/^Error:\s*/, ""), Boolean(p.key));
    }
  }

  refresh.addEventListener("click", () => {
    cache.delete(State.settings.chatProvider);
    void loadModels();
  });
  use.addEventListener("click", () => {
    const model = manual.value.trim();
    if (State.settings.chatProvider === "auto") return;
    if (!model) { status(t("Enter a model ID.")); return; }
    State.settings = withModel(State.settings, State.settings.chatProvider, model);
    saveSettings();
    close();
  });

  function open() {
    isOpen = true;
    el.classList.add("on");
    drawChips();
    onChange();
    void loadModels();
  }

  function close() {
    isOpen = false;
    request++;
    el.classList.remove("on");
    onChange();
  }

  return {
    el,
    open,
    close,
    get isOpen() {
      return isOpen;
    },
  };
}

// ── View ──────────────────────────────────────────────────────────────────────

export function buildPrompt(onHeightChange: () => void): ViewHost {
  const chipRow = h("div", { class: "chip-row" });
  const log = h("div", { class: "chat-log" });
  const orb = createThinkingOrb({ state: "solving", size: 20, theme: "dark", visible: false });
  const thinkingRow = h("div", { class: "chat-row" }, h("div", { class: "typing", role: "status" }, orb.el));
  window.addEventListener?.("pagehide", () => orb.destroy(), { once: true });
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: t(STRINGS.placeholderFirst),
    spellcheck: "false",
    maxlength: 6000,
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: tl(STRINGS.send) }, svg(ICONS.arrowUp, 11));
  const bar = h("div", { class: "chat-bar" }, input, send);

  const modelDot = h("i", { class: "model-dot" });
  const modelName = h("span", { class: "model-name" });
  const modelBtn = h(
    "button",
    { class: "model-btn", title: tl(STRINGS.switchModel) },
    modelDot,
    modelName,
    svg(ICONS.chevronUpDown, 9, { stroke: 2 }),
  );
  const modelRow = h("div", { class: "model-row" }, modelBtn);
  let lastReplyProvider: { selected: string; configuredModel: string; provider: string; model: string } | null = null;
  const telegramContext = h("div", { class: "chat-telegram-context", hidden: true });
  const telegramUsage = h("p", { class: "chat-telegram-usage", text: tl("Telegram message commands send immediately. Ask for a draft to review first.") });
  const actionSummary = h("div", { class: "chat-telegram-summary", role: "status", "aria-live": "polite" });
  const actionRecipient = h("div", { class: "chat-telegram-recipient" });
  const actionText = h("pre", { class: "chat-telegram-text" });
  const actionHint = h("p", { class: "chat-telegram-hint" });
  const approveAction = h("button", { class: "chat-telegram-send", text: tl("Approve and send this message once"),
    onclick: () => { if (!approveAction.disabled && visible) void actionController.send(); } });
  const cancelAction = h("button", { class: "chat-telegram-cancel", text: tl("Cancel"),
    onclick: () => { if (!cancelAction.disabled) actionController.cancel(); } });
  const acknowledgeAction = h("button", { class: "chat-telegram-acknowledge", text: tl("I checked Telegram"),
    onclick: () => { if (!acknowledgeAction.disabled && visible) actionController.acknowledgeUnknown(); } });
  const actionButtons = h("div", { class: "chat-telegram-actions" }, approveAction, cancelAction, acknowledgeAction);
  const actionCard = h("section", { class: "chat-telegram-card", hidden: true, "aria-label": tl("Review recipient and message") },
    actionSummary, actionRecipient, actionText, actionHint, actionButtons);

  const body = h("div", { class: "chat-body" });
  const picker = buildPicker(() => {
    body.classList.toggle("picking", picker.isOpen);
    drawModelButton();
  });
  body.append(chipRow, telegramContext, log, actionCard, picker.el, modelRow, telegramUsage, bar);

  const el = h("div", { class: "view" }, h("div", { class: "card wash chat-card" }, body));
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(99,102,241,0.5)");

  let sending = false;
  let sendingKind: "chat" | "telegram" | null = null, visible = true, requestTicket = 0;
  let knownHistory = State.chatHistory;
  let recipientContext: TelegramRecipient | null = null;
  let lastOrdinaryReply: { id: number; text: string } | null = null;
  const actionController = new TelegramActionController({
    send: (id) => Bridge.localAIAccountSend(id), cancel: (id) => Bridge.localAIAccountCancelDraft(id),
  }, () => { drawAction(); State.notify(); onHeightChange(); });
  let renderedCount = -1;
  // A local model answers token by token: where its text so far is shown.
  let live: HTMLElement | null = null;

  function drawAction() {
    const state = actionController.snapshot, preview = state.preview;
    actionCard.hidden = !preview && !state.pending && !state.result && !state.error;
    body.classList.toggle("reviewing-telegram", !actionCard.hidden);
    body.classList.toggle("telegram-preview", !!preview);
    actionRecipient.hidden = !preview; actionText.hidden = !preview; actionHint.hidden = !preview;
    const unknown = !state.pending && state.result?.status === "unknown";
    actionButtons.hidden = !preview && !unknown;
    approveAction.hidden = !preview; cancelAction.hidden = !preview;
    acknowledgeAction.hidden = !unknown;
    acknowledgeAction.disabled = !visible || sending || state.pending || !unknown;
    if (preview) {
      const recipient = preview.recipient;
      actionSummary.textContent = t("Review recipient and message");
      actionRecipient.textContent = `${recipient.title}${recipient.username ? ` · @${recipient.username}` : ""} · ${recipient.chat_id}${recipient.is_self ? ` · ${t("Saved Messages")}` : ""}`;
      // Telegram message content is literal text, never Markdown or HTML.
      actionText.textContent = preview.preview.text;
      actionHint.textContent = t("This is a preview. Nothing has been sent. Check the recipient and the entire message before approving.");
    } else {
      actionRecipient.textContent = ""; actionText.textContent = ""; actionHint.textContent = "";
      actionSummary.textContent = t(state.pending ? "Sending this Telegram message once…" : state.error || (state.result?.status === "sent"
        ? "Telegram confirmed that the message was sent." : state.result?.status === "unknown"
          ? "The send result is unknown. Check Telegram before composing another message." : "The message send was cancelled."));
    }
    actionCard.classList.toggle("uncertain", !state.pending && state.result?.status === "unknown");
    approveAction.disabled = !visible || sending || state.pending || !preview || Date.now() >= state.expiresAt;
    cancelAction.disabled = state.pending || !preview;
    modelBtn.disabled = sending || state.pending;
    input.disabled = sending || state.pending;
    send.disabled = sending || state.pending;
    telegramContext.hidden = !recipientContext;
    telegramContext.textContent = recipientContext ? t("Telegram recipient: {recipient}", {
      recipient: `${recipientContext.title}${recipientContext.username ? ` · @${recipientContext.username}` : ""} · ${recipientContext.chat_id}`,
    }) : "";
  }

  function forgetTelegram(clearRecipient: boolean, cancelTurn = sendingKind !== "chat") {
    if (cancelTurn) ++requestTicket;
    if (cancelTurn && sending) {
      sending = false; sendingKind = null; live = null; renderedCount = -1;
      if (State.stateOverride === "thinking") State.stateOverride = null;
    }
    if (clearRecipient) recipientContext = null;
    actionController.invalidate();
    drawModelButton(); drawAction();
  }

  function observeReset() {
    if (knownHistory === State.chatHistory) return;
    knownHistory = State.chatHistory; lastOrdinaryReply = null; lastReplyProvider = null;
    forgetTelegram(true, true);
  }

  void onEvent<unknown>("localai-telegram-context", (value) => {
    try {
      const context = parseTelegramRecipient(value);
      forgetTelegram(true); recipientContext = context; drawAction(); State.notify();
    } catch { forgetTelegram(true); }
  });
  void onEvent<unknown>("localai-account-invalidated", () => { lastOrdinaryReply = null; forgetTelegram(true); });

  function drawModelButton() {
    const p = providerDef(State.settings.chatProvider);
    modelDot.style.background = p.accent;
    if (lastReplyProvider?.selected === p.id && lastReplyProvider.configuredModel === activeModel(State.settings)) {
      const actual = providerDef(lastReplyProvider.provider);
      modelDot.style.background = actual.accent;
      modelName.textContent = `${p.id === "auto" ? `${t(p.name)} · ` : ""}${t(actual.name)} · ${lastReplyProvider.model}`;
    } else {
      modelName.textContent = p.id === "auto" ? t(p.name) : `${t(p.name)} · ${activeModel(State.settings) || t(STRINGS.noModel)}`;
    }
    modelBtn.classList.toggle("open", picker.isOpen);
    modelBtn.disabled = sending || actionController.snapshot.pending;
  }

  modelBtn.addEventListener("click", () => {
    if (sending || actionController.snapshot.pending) return;
    if (picker.isOpen) picker.close();
    else picker.open();
  });

  void onEvent<string>("chat-delta", (text) => {
    if (!sending || sendingKind !== "chat" || !text) return; // action text never comes from a model stream
    if (!live) {
      live = h("div", { class: "reply" });
      log.querySelector(".typing")?.parentElement?.remove();
      log.append(h("div", { class: "chat-row" }, live));
    }
    renderMarkdown(live, text);
    log.scrollTop = log.scrollHeight;
  });

  async function submit() {
    const query = input.value.trim();
    if (!query || query.length > 6000 || sending || actionController.snapshot.pending) return;
    observeReset();
    const telegram = isTelegramCommand(query, !!recipientContext);
    const selectedProvider = State.settings.chatProvider, configuredModel = activeModel(State.settings);
    const ticket = ++requestTicket, history = State.chatHistory;
    actionController.invalidate();
    if (picker.isOpen) picker.close();
    input.value = "";
    sending = true;
    sendingKind = telegram ? "telegram" : "chat";
    drawModelButton();
    Sound.play("send");

    const userID = nextId++;
    State.chatHistory.push({ id: userID, role: "user", content: query });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    const file = State.droppedFile;
    const context: ChatContext | null =
      State.chatHistory.length === 1 && file ? { kind: "file", name: file.name, path: file.path } : null;

    try {
      if (telegram) {
        if (telegramRequestNeedsClarification(query)) {
          history.push({ id: nextId++, role: "assistant", content: t("To prepare a Telegram message, name its recipient and the exact text, then review it before sending.") });
        } else {
          const previous = lastOrdinaryReply && history.some((message) => message.id === lastOrdinaryReply!.id && message.role === "assistant" && message.content === lastOrdinaryReply!.text)
            ? lastOrdinaryReply.text : undefined;
          const raw = await Bridge.localAIAccountCommand(query, recipientContext?.chat_id, telegramUsesMessageReference(query) ? previous : undefined);
          if (ticket !== requestTicket || history !== State.chatHistory || !visible) { actionController.discardResponse(raw); return; }
          const result = parseTelegramCommand(raw);
          // This fixed local route never falls back to a cloud chat provider.
          if (result.kind === "preview") {
            recipientContext = result.recipient; actionController.accept(result);
            if (telegramExplicitReviewRequested(query)) {
              history.push({ id: nextId++, role: "assistant", content: t("Telegram message prepared. Review the recipient and text below.") });
            } else {
              // A hide, reset or identity change may invalidate the preview
              // during rendering. An explicit command authorizes this one ID.
              await Promise.resolve();
              if (ticket !== requestTicket || history !== State.chatHistory || !visible || actionController.snapshot.preview !== result) {
                actionController.invalidate(); return;
              }
              await actionController.send();
              if (ticket !== requestTicket || history !== State.chatHistory) return;
              const outcome = actionController.snapshot.result;
              history.push({ id: nextId++, role: "assistant", content: t(actionController.snapshot.error || (outcome?.status === "sent"
                ? "Telegram confirmed that the message was sent." : outcome?.status === "unknown"
                  ? "The send result is unknown. Check Telegram before composing another message." : "The message send was cancelled.")) });
            }
          } else history.push({ id: nextId++, role: "assistant", content: result.text });
        }
      } else {
        const reply = await Bridge.chatSend(query, context);
        if (ticket !== requestTicket || history !== State.chatHistory || !history.some((message) => message.id === userID)) return;
        if (typeof reply?.text !== "string") throw new Error(t("The chat reply could not be verified."));
        if (typeof reply.provider === "string" && typeof reply.model === "string") {
          lastReplyProvider = { selected: selectedProvider, configuredModel, provider: reply.provider, model: reply.model };
        }
        const id = nextId++;
        State.chatHistory.push({ id, role: "assistant", content: reply.text });
        lastOrdinaryReply = { id, text: reply.text };
      }
      State.stateOverride = null;
      Sound.play("finish");
    } catch (err) {
      if (ticket !== requestTicket || history !== State.chatHistory) return;
      State.stateOverride = null;
      if (telegram) history.push({ id: nextId++, role: "assistant", content: t("The Telegram action could not be prepared. Nothing was sent. Check the local service and Telegram login, then try a new request.") });
      else { State.noteMessage = String(err).replace(/^Error:\s*/, ""); State.view = "note"; }
      Sound.play("error");
    } finally {
      if (ticket !== requestTicket || history !== State.chatHistory) return;
      sending = false;
      sendingKind = null;
      live = null;
      renderedCount = -1; // the finished answer replaces the streamed one
      drawModelButton();
      drawAction();
      State.notify();
      onHeightChange();
      if (visible) input.focus();
    }
  }

  send.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    if (key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (key === "Escape" && picker.isOpen) {
      e.preventDefault();
      picker.close();
    }
    e.stopPropagation(); // Escape closes the island, not the chat
  });

  return {
    el,
    sync() {
      observeReset();
      actionController.expire();
      const file = State.droppedFile;
      const wantChip = file?.name ?? "";
      if (chipRow.dataset.label !== wantChip) {
        chipRow.dataset.label = wantChip;
        clear(chipRow);
        if (wantChip) chipRow.append(contextChip(wantChip));
      }

      const thinking = State.stateOverride === "thinking";
      orb.setState(sendingKind === "telegram" ? "connecting" : live ? "composing" : "solving");
      orb.setVisible(visible && thinking && !live);
      const count = State.chatHistory.length + (thinking ? 0.5 : 0);
      if (count !== renderedCount && !live) {
        renderedCount = count;
        clear(log);
        for (const m of State.chatHistory) log.append(bubble(m));
        if (thinking) log.append(thinkingRow);
        log.scrollTop = log.scrollHeight;
      }

      // Leaving the chat folds the picker away.
      if (State.view !== "prompt" && picker.isOpen) picker.close();
      drawModelButton();
      drawAction();

      input.placeholder = t(State.chatHistory.length === 0 ? STRINGS.placeholderFirst : STRINGS.placeholderNext);
      input.disabled = sending || actionController.snapshot.pending;
    },
    setVisible(next: boolean) {
      if (visible && !next) forgetTelegram(false, sendingKind !== "chat");
      visible = next;
      orb.setVisible(next && State.stateOverride === "thinking" && !live);
      drawAction();
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}
