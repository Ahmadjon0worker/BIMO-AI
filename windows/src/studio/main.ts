import "../style.css";
import "./studio.css";
import "../effects/liquid.css";
import { installLiquidSurfaces } from "../effects/liquid";
import { createThinkingOrb, botStateToOrbState } from "../effects/thinking-orb";
import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import { LOCAL_AI_MODES, LocalAIController } from "../core/local-ai";
import { activeModel, providerDef } from "../core/providers";
import { State, type Settings } from "../core/state";
import { Sound } from "../core/sound";
import { onLanguageChange, resolveLanguage, setLanguage, systemLanguages, t, tl } from "../i18n/i18n";
import { buildProviderSetup } from "../settings/providers";
import { buildPrompt } from "../views/chat";
import { h } from "../views/dom";
import { SentenceSpeechQueue, createWavSpeechAdapter } from "../core/speech-queue";
import { isTelegramCommand } from "../core/telegram-command";
import type { VoiceLanguage } from "../core/voice";

// Studio has its own webview state and native Chat instance. Telegram remains
// on the existing fixed local action route, independent of provider fallback.
const root = document.querySelector<HTMLElement>("#studio-root");
if (!root) throw new Error("Studio root is missing");

const errorText = h("span");
const error = h("div", { class: "studio-error", role: "alert", hidden: true }, errorText,
  h("button", { type: "button", "aria-label": "Xabarni yopish", text: "×", onclick: () => {
    State.noteMessage = null;
    State.notify();
  } }),
);
const serviceBadge = h("span", { class: "studio-service-badge", role: "status", text: "Xizmat tekshirilmoqda" });
const studioOrb = createThinkingOrb({ size: 64, state: "breathing", theme: "dark", accent: "#b7dfff" });
studioOrb.el.style.margin = "0 auto 14px";
let studioVisible = !document.hidden;
const spokenReply = h("input", { id: "studio-spoken", type: "checkbox" });
const speechStatus = h("span", { class: "studio-speech-status", role: "status", "aria-live": "polite" });
const speechStop = h("button", { type: "button", class: "studio-button secondary", text: "Ovozni to‘xtatish", disabled: true, onclick: () => studioSpeech.cancel() });
const studioSpeech = new SentenceSpeechQueue(createWavSpeechAdapter(args => Bridge.localAIVoiceSpeak(args)), () => {
  speechStop.disabled = !studioSpeech.state.active;
  speechStatus.textContent = studioSpeech.state.error || (studioSpeech.state.active ? `Mahalliy ovoz · ${studioSpeech.state.remaining} jumla` : "");
});
let speechHistory = State.chatHistory;
let lastSpeechID = speechHistory.at(-1)?.id ?? -1;
let speechTurn = false;
const version = h("span", { class: "studio-version", text: "BIMO AI Studio" });
const currentProvider = h("span", { class: "studio-current-provider" });
const chatNavigation = h("button", { type: "button", class: "studio-nav on", text: "Suhbat", "aria-pressed": "true" });
const healthNavigation = h("button", { type: "button", class: "studio-nav", text: "Tizim holati", "aria-pressed": "false" });
const providerMount = h("div", { class: "studio-provider-mount" });
const sidebar = h("aside", { class: "studio-sidebar", "aria-label": "Studio boshqaruvi" },
  h("div", { class: "studio-brand" }, h("span", { class: "studio-mark", text: "C" }),
    h("div", {}, h("strong", { text: "BIMO AI" }), h("span", { text: "STUDIO" }))),
  h("nav", { class: "studio-navigation", "aria-label": "Bo‘limlar" }, chatNavigation, healthNavigation),
  providerMount,
  h("div", { class: "studio-sidebar-links" },
    h("button", { type: "button", class: "studio-button secondary", text: "API kalitlari va sozlamalar", onclick: () => void openSettings() }),
    h("button", { type: "button", class: "studio-button secondary", text: "Telegram va Windows vositalari", onclick: () => void openTools() }),
    h("button", { type: "button", class: "studio-button secondary", text: "🎙 Ovozli boshqaruv", onclick: () => void Bridge.localAIOpenVoice().catch(error => { serviceBadge.textContent = error instanceof Error ? error.message : String(error); }) }),
    h("p", { class: "studio-sidebar-note", text: "Auto avval Ollama’ni, keyin sozlangan Gemini va Groq’ni sinaydi. API kalitlarini Sozlamalarda kiriting." }),
  ),
  h("footer", { class: "studio-sidebar-footer" }, serviceBadge, version),
);
const chat = buildPrompt(() => sync());
chat.el.classList.add("on", "studio-chat-view");
const welcome = h("div", { class: "studio-welcome" },
  studioOrb.el,
  h("h2", { text: "Bugun nimani qilamiz?" }),
  h("p", { text: "Savol yozing, ish uchun matn tayyorlang yoki Telegram buyrug‘ini bering." }),
  h("div", { class: "studio-examples" },
    example("Matnni tahrirlash", "Quyidagi matnni sodda va tushunarli qilib tahrirla: "),
    example("Reja tuzish", "Bugungi ishlarim uchun aniq reja tuzishga yordam ber: "),
    example("Kod bilan yordam", "Quyidagi kodni tushuntir va xatolarini top: "),
  ),
);
const chatContent = h("div", { class: "studio-chat-content" }, chat.el, welcome);
const newChat = h("button", { type: "button", class: "studio-button secondary", text: "+ Yangi suhbat", onclick: () => void resetChat() });
const chatPage = h("section", { class: "studio-chat-page", "aria-label": "AI suhbat" },
  h("header", { class: "studio-page-header" },
    h("div", {}, h("p", { class: "studio-eyebrow", text: "SHAXSIY AI YORDAMCHI" }), h("h1", { text: "Suhbat" }), currentProvider), newChat),
  chatContent,
  h("div", { class: "studio-speech-controls" },
    h("label", { class: "studio-speech-label", for: "studio-spoken" }, spokenReply, h("span", { text: "Javobni mahalliy ovozda o‘qish" })), speechStop, speechStatus),
  h("p", { class: "studio-keyboard-hint", text: "Enter — yuborish. Provider va modelni pastdagi tanlov orqali ham o‘zgartirish mumkin." }),
);

const healthValue = h("strong", { text: "Tekshirilmoqda" });
const healthDescription = h("p", { class: "studio-muted" });
const modelValue = h("strong", { text: "—" });
const memoryValue = h("strong", { text: "—" });
const speedValue = h("strong", { text: "—" });
const operationValue = h("strong", { text: "—" });
const healthError = h("p", { class: "studio-health-error", hidden: true });
const serviceStart = h("button", { type: "button", class: "studio-button secondary", text: "Mahalliy xizmatlarni ishga tushirish", onclick: () => void startServices() });
const serviceStartStatus = h("p", { class: "studio-muted", role: "status", "aria-live": "polite" });
const refreshHealth = h("button", { type: "button", class: "studio-button", text: "Yangilash", onclick: () => void health.refresh() });
const modeButtons = LOCAL_AI_MODES.map((mode) => h("button", {
  type: "button", class: "studio-button secondary studio-mode", text: mode,
  onclick: () => void health.control("mode", mode),
}));
const stopLocal = h("button", { type: "button", class: "studio-button studio-stop", text: tl("Stop Local AI"),
  onclick: () => void health.control("stop"),
});
const controlStatus = h("p", { class: "studio-control-status", role: "status", "aria-live": "polite" });
const resumeHint = h("p", { class: "studio-resume-hint", text: tl("Select a mode to resume Local AI."), hidden: true });
const healthPage = h("section", { class: "studio-health-page", hidden: true, "aria-label": "Tizim holati" },
  h("header", { class: "studio-page-header" },
    h("div", {}, h("p", { class: "studio-eyebrow", text: "MAHALLIY XIZMAT" }), h("h1", { text: "Tizim holati" }),
      h("p", { class: "studio-muted", text: "Telegram, Windows vositalari va AI xizmatining joriy holati." })), refreshHealth),
  h("div", { class: "studio-health-controls" },
    h("div", { class: "studio-mode-controls", role: "group", "aria-label": tl("Local AI mode") }, ...modeButtons, stopLocal),
    resumeHint, controlStatus,
  ),
  h("div", { class: "studio-health-grid" },
    healthTile("Xizmat", healthValue, healthDescription), healthTile("Faol model", modelValue),
    healthTile("Bo‘sh / jami RAM", memoryValue), healthTile("Tezlik", speedValue),
    healthTile("Jarayon", operationValue),
  ),
  healthError,
  h("div", { class: "studio-health-actions" },
    serviceStart, serviceStartStatus,
    h("h2", { text: "Ish vositalari" }),
    h("p", { text: "Telegram akkauntingiz, xabarlar va Windows boshqaruvi alohida vositalar oynasida ochiladi." }),
    h("button", { type: "button", class: "studio-button", text: "Telegram va Windows vositalarini ochish", onclick: () => void openTools() }),
  ),
);
root.append(sidebar, h("main", { class: "studio-main" }, error, chatPage, healthPage));
const destroyGlass = installLiquidSurfaces(root, "studio");
window.addEventListener("pagehide", () => { studioSpeech.cancel(); destroyGlass(); studioOrb.destroy(); }, { once: true });

let page: "chat" | "health" = "chat";
let initialized = false;
let providerSignature = "";
let servicesStarting = false;
const health = new LocalAIController({ health: () => Bridge.localAIHealth(), control: (action, mode) =>
  action === "mode" ? Bridge.localAIMode(mode!) : action === "stop" ? Bridge.localAIStop() : Bridge.localAIOpenOpenCode(),
}, drawHealth);

function healthTile(label: string, value: HTMLElement, detail?: HTMLElement): HTMLElement {
  return h("article", { class: "studio-health-tile" }, h("span", { text: label }), value, detail);
}

function example(label: string, prompt: string): HTMLElement {
  return h("button", { type: "button", text: label, onclick: () => {
    const input = chat.el.querySelector<HTMLInputElement>(".chat-input");
    if (!input || input.disabled) return;
    input.value = prompt;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  } });
}

function signature(settings: Settings): string {
  return JSON.stringify([settings.chatProvider, settings.model, settings.chatModels, settings.ollamaUrl,
    settings.lmstudioUrl, settings.customUrl, settings.language]);
}

function mountProviders(): void {
  providerSignature = signature(State.settings);
  providerMount.replaceChildren(buildProviderSetup({
    settings: () => State.settings,
    save: async (next) => {
      await Bridge.saveSettingsOrThrow(next);
      State.settings = next;
      providerSignature = signature(next);
      State.notify();
    },
  }));
}

function applyLanguage(): void {
  // Fresh settings choose Uzbek. A saved empty value still means system language.
  setLanguage(resolveLanguage(State.settings.language, systemLanguages()));
}

function sync(): void {
  if (!initialized) return;
  State.view = "prompt";
  chat.sync();
  const selected = providerDef(State.settings.chatProvider);
  currentProvider.textContent = `${selected.id === "auto" ? "Auto · Ollama → Gemini → Groq" : `${selected.name} · ${activeModel(State.settings) || "Model tanlang"}`}`;
  welcome.hidden = State.chatHistory.length > 0 || State.stateOverride === "thinking";
  studioOrb.setState(botStateToOrbState(State.effectiveState));
  studioOrb.setVisible(studioVisible && !welcome.hidden && page === "chat" && !document.hidden);
  newChat.disabled = State.stateOverride === "thinking";
  error.hidden = !State.noteMessage;
  errorText.textContent = State.noteMessage || "";
  syncSpeech();
}

function syncSpeech(): void {
  if (speechHistory !== State.chatHistory) {
    speechHistory = State.chatHistory; lastSpeechID = speechHistory.at(-1)?.id ?? -1; speechTurn = false; studioSpeech.cancel();
    return;
  }
  if (State.stateOverride === "thinking") {
    if (!speechTurn) studioSpeech.cancel();
    speechTurn = true;
    return;
  }
  const completed = speechTurn; speechTurn = false;
  const reply = State.chatHistory.at(-1), question = State.chatHistory.at(-2);
  if (!reply || reply.id === lastSpeechID) return;
  lastSpeechID = reply.id;
  if (!completed || reply.role !== "assistant" || question?.role !== "user" || isTelegramCommand(question.content, true)
    || !spokenReply.checked || !studioVisible || document.hidden || page !== "chat") return;
  const language: VoiceLanguage = State.settings.language === "ru" ? "ru" : State.settings.language === "en" ? "en" : "uz";
  void studioSpeech.speak(reply.content, language);
}

function drawHealth(): void {
  const snapshot = health.snapshot;
  const connected = snapshot.connection === "connected";
  const value = snapshot.health;
  if(value?.halted && studioSpeech.state.active)studioSpeech.cancel();
  serviceBadge.classList.toggle("connected", connected);
  serviceBadge.textContent = connected ? "Mahalliy xizmat ulangan" : snapshot.connection === "checking" ? "Xizmat tekshirilmoqda" : "Mahalliy xizmat mavjud emas";
  healthValue.textContent = connected ? "Ulangan" : snapshot.connection === "checking" ? "Tekshirilmoqda" : "Ulanmagan";
  healthDescription.textContent = connected ? `${value?.mode || ""} rejimi` : "AI suhbat provider orqali ishlashi mumkin. Telegram va Windows vositalari uchun mahalliy xizmat kerak.";
  modelValue.textContent = value?.active_model || "Hozir faol model yo‘q";
  memoryValue.textContent = value ? `${value.ram_available_gib.toFixed(1)} / ${value.ram_total_gib.toFixed(1)} GB` : "—";
  speedValue.textContent = value?.tokens_per_second == null ? "—" : `${value.tokens_per_second.toFixed(1)} token/s`;
  operationValue.textContent = value?.busy ? value.operation || "Ishlayapti" : value?.halted ? "To‘xtatilgan" : connected ? "Tayyor" : "—";
  healthError.textContent = snapshot.error || (value?.halted ? "" : value?.last_error) || "";
  healthError.hidden = !healthError.textContent;
  modeButtons.forEach((button, index) => {
    button.classList.toggle("on", value?.mode === LOCAL_AI_MODES[index]);
    button.setAttribute("aria-pressed", String(value?.mode === LOCAL_AI_MODES[index]));
    button.disabled = !value || snapshot.pending.has("mode") || snapshot.pending.has("stop") || value.busy || value.computer_use_active;
  });
  // Stop stays available during a mode change, active task or disconnected status.
  stopLocal.disabled = snapshot.pending.has("stop");
  stopLocal.textContent = t(snapshot.pending.has("stop") ? "Stopping Local AI…" : "Stop Local AI");
  resumeHint.hidden = !value?.halted;
  controlStatus.textContent = snapshot.pending.has("mode") ? t("Changing Local AI mode…")
    : snapshot.completed === "stop" ? t("Stop requested. Check that the task has ended.")
    : snapshot.completed === "mode" ? t("Local AI mode updated.") : "";
  controlStatus.hidden = !controlStatus.textContent;
  serviceStart.hidden = connected;
  serviceStart.disabled = servicesStarting;
}

function selectPage(next: "chat" | "health"): void {
  page = next;
  chatPage.hidden = next !== "chat";
  healthPage.hidden = next !== "health";
  for (const [button, active] of [[chatNavigation, next === "chat"], [healthNavigation, next === "health"]] as const) {
    button.classList.toggle("on", active);
    button.setAttribute("aria-pressed", String(active));
  }
  chat.setVisible?.(next === "chat" && !document.hidden);
  studioOrb.setVisible(studioVisible && !welcome.hidden && next === "chat" && !document.hidden);
  if (next === "chat") chat.focus?.();
  else studioSpeech.cancel();
}

async function openSettings(): Promise<void> {
  if (!IS_TAURI) { showError("Sozlamalar o‘rnatilgan BIMO AI ilovasida ochiladi."); return; }
  await Bridge.openSettingsWindow();
}

async function openTools(): Promise<void> {
  try { await Bridge.localAIOpenTools(); }
  catch (failure) { showError(failure); }
}

function showError(failure: unknown): void {
  State.noteMessage = String(failure).replace(/^Error:\s*/, "");
  State.notify();
}

async function startServices(): Promise<void> {
  if (servicesStarting) return;
  servicesStarting = true;
  serviceStart.disabled = true;
  serviceStartStatus.textContent = "Mahalliy xizmatlar ishga tushirilmoqda…";
  try {
    await Bridge.localAIStartServices();
    await health.refresh();
    serviceStartStatus.textContent = health.snapshot.connection === "connected" ? "Mahalliy xizmat ulandi." : "Xizmat ishga tushirish so‘rovi bajarildi. Holatni yana tekshiring.";
  } catch (failure) {
    serviceStartStatus.textContent = "Xizmatni ishga tushirib bo‘lmadi.";
    showError(failure);
  } finally {
    servicesStarting = false;
    serviceStart.disabled = false;
  }
}

async function resetChat(): Promise<void> {
  if (State.stateOverride === "thinking") return;
  studioSpeech.cancel();
  await Bridge.chatReset();
  State.chatHistory = [];
  State.noteMessage = null;
  State.droppedFile = null;
  State.promptContext = null;
  State.notify();
  chat.focus?.();
}

chatNavigation.addEventListener("click", () => selectPage("chat"));
healthNavigation.addEventListener("click", () => selectPage("health"));
spokenReply.addEventListener("change", () => { if (!spokenReply.checked) studioSpeech.cancel(); });
stopLocal.addEventListener("click", () => studioSpeech.cancel());
// Pressing Send/Enter interrupts the previous reply before another turn starts.
chat.el.addEventListener("pointerdown", () => studioSpeech.cancel());
chat.el.addEventListener("keydown", event => { if ((event as KeyboardEvent).key === "Enter") studioSpeech.cancel(); });
State.subscribe(sync);
onLanguageChange(() => { if (initialized) { mountProviders(); sync(); } });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) studioSpeech.cancel();
  health.setVisible(!document.hidden);
  chat.setVisible?.(!document.hidden && page === "chat");
  studioOrb.setVisible(studioVisible && !welcome.hidden && !document.hidden && page === "chat");
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    if (!newChat.disabled) void resetChat();
  }
}, { capture: true });
window.addEventListener("pagehide", () => health.setVisible(false));
document.addEventListener("pointerdown", () => void Sound.resume(), { once: true });

async function main(): Promise<void> {
  const boot = await Bridge.boot();
  if (boot) {
    State.settings = { ...State.settings, ...boot.settings };
    version.textContent = `BIMO AI ${boot.version}`;
  }
  applyLanguage();
  State.view = "prompt";
  initialized = true;
  mountProviders();
  sync();
  health.setVisible(!document.hidden);
  await onEvent<Settings>("settings-changed", (settings) => {
    State.settings = { ...State.settings, ...settings };
    applyLanguage();
    if (signature(State.settings) !== providerSignature) mountProviders();
    State.notify();
  });
  await onEvent<boolean>("studio-visible", (visible) => {
    studioVisible = visible;
    if (!visible) studioSpeech.cancel();
    health.setVisible(visible && !document.hidden);
    chat.setVisible?.(visible && page === "chat");
    studioOrb.setVisible(visible && !welcome.hidden && !document.hidden && page === "chat");
  });
  await onEvent("voice-barge-in", () => studioSpeech.cancel());
  chat.focus?.();
}

void main().catch(showError);
