// Provider setup is independent of the rest of Settings so its save/check
// behavior can be verified without booting hooks, integrations or Telegram.

import { Bridge, type ChatProviderStatus } from "../core/bridge";
import { PROVIDERS, activeModel, pickModel, providerDef, withModel, type ProviderId } from "../core/providers";
import type { Settings } from "../core/state";
import { h, clear } from "../views/dom";
import { t } from "../i18n/i18n";

export interface ProviderSetupHost {
  settings(): Settings;
  /** Commits the object only after the native save succeeds. */
  save(next: Settings): Promise<void>;
  registerRefresh?(refresh: () => void): void;
}

export function providerStatusText(status: ChatProviderStatus): string {
  if (!status.available) return status.error || t("Provider unavailable. Check the connection or API key.");
  const name = t(providerDef(status.effectiveProvider || status.provider).name);
  return t("Ready: {provider} · {model}", { provider: name, model: status.model || t("Automatic") });
}

/** Every network check is initiated by a button; simply opening Settings is offline. */
export function buildProviderSetup(host: ProviderSetupHost): HTMLElement {
  const section = h("section", { class: "provider-setup" },
    h("h2", { text: t("AI provider") }),
    h("div", { class: "hint", text: t("Automatic tries Ollama first, then your configured Gemini or Groq. Ollama is optional. Cloud providers receive your chat messages.") }),
  );
  const provider = h("select", { class: "setup-provider", "aria-label": t("AI provider") }) as HTMLSelectElement;
  for (const p of PROVIDERS) provider.append(h("option", { value: p.id, text: t(p.name) }));
  const check = h("button", { class: "setup-check", text: t("Check connection") });
  const refresh = h("button", { class: "setup-refresh", text: t("Refresh models") });
  const models = h("select", { class: "setup-models", "aria-label": t("Model") }) as HTMLSelectElement;
  const manual = h("input", {
    type: "text", class: "setup-manual", "aria-label": t("Model ID"),
    placeholder: t("Model ID"), spellcheck: "false", autocomplete: "off", style: "flex:1 1 auto;min-width:0",
  }) as HTMLInputElement;
  const saveModel = h("button", { class: "setup-save-model", text: t("Save model") });
  const modelRow = h("div", { class: "row setup-model-row" }, h("label", { text: t("Model") }), models, refresh);
  const manualRow = h("div", { class: "row setup-manual-row" }, h("label", { text: t("Model ID") }), manual, saveModel);
  const notice = h("div", { class: "hint setup-status", role: "status", "aria-live": "polite" });
  section.append(h("div", { class: "row" }, h("label", { text: t("AI provider") }), provider, check), modelRow, manualRow, notice);
  let ticket = 0;
  let busy = false;

  function draw() {
    const settings = host.settings();
    provider.value = settings.chatProvider;
    const auto = settings.chatProvider === "auto";
    modelRow.hidden = auto;
    manualRow.hidden = auto;
    clear(models);
    const model = activeModel(settings);
    models.append(h("option", { value: model, text: model || t("Choose a model") }));
    models.value = model;
    manual.value = auto ? "" : model;
  }

  function pending(on: boolean) {
    busy = on;
    for (const button of [check, refresh, saveModel]) button.disabled = on;
    models.disabled = on;
    // The provider remains selectable: changing it invalidates an old check.
  }

  async function commit(next: Settings): Promise<boolean> {
    provider.disabled = true;
    try {
      await host.save(next);
      return true;
    } catch (error) {
      notice.className = "notice err setup-status";
      notice.textContent = t("Could not save: {error}", { error: String(error).replace(/^Error:\s*/, "") });
      return false;
    } finally {
      provider.disabled = false;
    }
  }

  provider.addEventListener("change", async () => {
    const request = ++ticket;
    pending(false);
    notice.className = "hint setup-status";
    notice.textContent = "";
    const id = provider.value as ProviderId;
    if (!PROVIDERS.some((p) => p.id === id)) return;
    provider.disabled = true;
    await commit({ ...host.settings(), chatProvider: id });
    provider.disabled = false;
    if (request === ticket) draw();
  });

  check.addEventListener("click", async () => {
    if (busy) return;
    const request = ++ticket;
    const id = host.settings().chatProvider;
    pending(true);
    notice.className = "hint setup-status";
    notice.textContent = t("Checking provider…");
    try {
      const status = await Bridge.chatProviderStatus(id);
      if (request !== ticket) return;
      notice.className = status.available ? "notice ok setup-status" : "notice err setup-status";
      notice.textContent = providerStatusText(status);
    } catch (error) {
      if (request !== ticket) return;
      notice.className = "notice err setup-status";
      notice.textContent = String(error).replace(/^Error:\s*/, "");
    } finally {
      if (request === ticket) pending(false);
    }
  });

  refresh.addEventListener("click", async () => {
    if (busy || host.settings().chatProvider === "auto") return;
    const request = ++ticket;
    const id = host.settings().chatProvider;
    pending(true);
    notice.className = "hint setup-status";
    notice.textContent = t("Loading models…");
    try {
      const offered = await Bridge.chatModels(id);
      if (request !== ticket) return;
      if (!offered.length) throw new Error(t("No models available. Download an Ollama model or check your provider account."));
      const selected = pickModel(providerDef(id), offered.map((m) => m.id), activeModel(host.settings()))!;
      if (selected !== activeModel(host.settings()) && !await commit(withModel(host.settings(), id, selected))) return;
      if (request !== ticket) return;
      clear(models);
      for (const m of offered) models.append(h("option", { value: m.id, text: m.label }));
      models.value = selected;
      manual.value = selected;
      notice.className = "notice ok setup-status";
      notice.textContent = t("Models refreshed. You can also enter a model ID manually.");
    } catch (error) {
      if (request !== ticket) return;
      notice.className = "notice err setup-status";
      notice.textContent = String(error).replace(/^Error:\s*/, "");
    } finally {
      if (request === ticket) pending(false);
    }
  });

  async function storeModel(value: string) {
    if (busy || host.settings().chatProvider === "auto") return;
    const model = value.trim();
    if (!model) {
      notice.className = "notice err setup-status";
      notice.textContent = t("Enter a model ID.");
      return;
    }
    pending(true);
    const request = ++ticket;
    const id = host.settings().chatProvider;
    try {
      if (await commit(withModel(host.settings(), id, model)) && request === ticket) {
        draw();
        notice.className = "notice ok setup-status";
        notice.textContent = t("Model saved. Check the connection to verify its availability.");
      }
    } finally {
      if (request === ticket) pending(false);
    }
  }
  models.addEventListener("change", () => void storeModel(models.value));
  saveModel.addEventListener("click", () => void storeModel(manual.value));
  draw();
  host.registerRefresh?.(() => {
    if (provider.disabled) return; // our own save is committed by its caller
    ticket++;
    pending(false);
    notice.className = "hint setup-status";
    notice.textContent = "";
    draw();
  });
  return section;
}
