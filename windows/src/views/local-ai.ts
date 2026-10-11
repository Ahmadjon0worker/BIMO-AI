import { h } from "./dom";
import { Bridge } from "../core/bridge";
import { LOCAL_AI_MODES, LocalAIController, type LocalAITransport } from "../core/local-ai";
import { t, tl } from "../i18n/i18n";
import type { ViewHost } from "./views";

const TRANSPORT: LocalAITransport = {
  health: () => Bridge.localAIHealth(),
  control: (action, mode) => {
    if (action === "mode" && mode) return Bridge.localAIMode(mode);
    if (action === "stop") return Bridge.localAIStop();
    if (action === "open-opencode") return Bridge.localAIOpenOpenCode();
    return Promise.reject(new Error(t("Invalid Local AI control.")));
  },
};

/** All server text is rendered as text, including model names and errors. */
export function buildLocalAI(transport: LocalAITransport = TRANSPORT): ViewHost {
  const connection = h("span", { class: "local-ai-connection", role: "status", "aria-live": "polite" });
  const model = h("span", { class: "local-ai-model" });
  const operation = h("span", { class: "local-ai-operation" });
  const memory = h("span", { class: "local-ai-metric" });
  const speed = h("span", { class: "local-ai-metric" });
  const message = h("div", { class: "local-ai-message", role: "status", "aria-live": "polite" });
  const controller = new LocalAIController(transport, () => sync());
  const modeButtons = LOCAL_AI_MODES.map((mode) => h("button", {
    class: "local-ai-mode", text: mode,
    onclick: () => void controller.control("mode", mode),
  }));
  const stop = h("button", {
    class: "btn local-ai-stop", text: tl("Stop Local AI"),
    onclick: () => void controller.control("stop"),
  });
  const open = h("button", {
    class: "btn secondary", text: tl("Open OpenCode"),
    onclick: () => void controller.control("open-opencode"),
  });
  const refresh = h("button", {
    class: "local-ai-refresh", text: tl("Refresh"),
    onclick: () => void controller.refresh(),
  });
  const tools = h("button", {
    class: "btn secondary", text: tl("Telegram and Windows tools"),
    onclick: () => {
      void Bridge.localAIOpenTools().catch((error: unknown) => {
        message.textContent = error instanceof Error ? error.message : String(error);
        message.classList.add("error");
      });
    },
  });
  const studio = h("button", {
    class: "btn secondary", text: "LocalAI Studio",
    onclick: () => {
      void Bridge.localAIOpenStudio().catch((error: unknown) => {
        message.textContent = error instanceof Error ? error.message : String(error);
        message.classList.add("error");
      });
    },
  });
  const el = h("div", { class: "view local-ai-view" },
    h("div", { class: "card local-ai-card" },
      h("div", { class: "local-ai-heading" },
        h("strong", { text: tl("Local AI") }), connection, refresh),
      h("div", { class: "local-ai-current" }, model, operation),
      h("div", { class: "local-ai-metrics" }, memory, speed),
      h("div", { class: "local-ai-modes", role: "group", "aria-label": tl("Local AI mode") }, ...modeButtons),
      h("div", { class: "local-ai-actions", style: "flex-wrap: wrap; gap: 6px" }, studio, stop, open, tools),
      h("div", { class: "local-ai-hint", text: tl('Write @username ga "Salom" yubor or unga javob ber in chat to send immediately. Ask for a draft to review first.') }),
      message),
  );

  function sync(): void {
    const { health, connection: state, error, pending, completed } = controller.snapshot;
    connection.textContent = state === "connected" ? t("Local AI connected")
      : state === "checking" ? t("Connecting to Local AI…") : t("Local AI disconnected");
    connection.dataset.state = state;
    model.textContent = health?.active_model || t("No model loaded");
    model.title = model.textContent;
    operation.textContent = health?.halted ? t("Local AI is stopped")
      : health?.computer_use_active ? t("Computer Use is active")
      : health?.busy ? t("Local AI is working") : health ? t("Local AI is ready") : "—";
    operation.title = health?.operation || operation.textContent;
    memory.textContent = health ? t("RAM free: {free} / {total} GiB", {
      free: health.ram_available_gib.toFixed(1), total: health.ram_total_gib.toFixed(1),
    }) : t("RAM: unavailable");
    speed.textContent = health?.tokens_per_second != null
      ? t("Speed: {speed} tokens/s", { speed: health.tokens_per_second.toFixed(1) }) : t("Speed: not measured");
    modeButtons.forEach((button, index) => {
      button.classList.toggle("on", health?.mode === LOCAL_AI_MODES[index]);
      button.setAttribute("aria-pressed", String(health?.mode === LOCAL_AI_MODES[index]));
      button.disabled = !health || pending.has("mode") || pending.has("stop") || health.busy || health.computer_use_active;
    });
    // Stop must never wait for mode changes or OpenCode launches to finish.
    stop.disabled = pending.has("stop");
    stop.textContent = pending.has("stop") ? t("Stopping Local AI…") : t("Stop Local AI");
    open.disabled = !health || pending.has("open-opencode");
    message.classList.toggle("error", !!error || (!!health?.last_error && !health.halted));
    message.classList.toggle("stopped", !!health?.halted && !error);
    const notice = pending.has("mode") ? t("Changing Local AI mode…")
      : completed === "stop" ? t("Stop requested. Check that the task has ended.")
      : completed === "open-opencode" ? t("OpenCode launch requested.")
      : completed === "mode" ? t("Local AI mode updated.") : "";
    message.textContent = error ? t(error) : health?.halted ? t("Select a mode to resume Local AI.") : health?.last_error || notice;
    message.title = message.textContent;
  }

  sync();
  return { el, sync, setVisible: (visible) => controller.setVisible(visible) };
}
