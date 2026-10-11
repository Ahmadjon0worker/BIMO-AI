import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";
import { calls, internals, sent } from "./tauri.mjs";

installFakeDom();
const { buildProviderSetup, providerStatusText } = await import("../src/settings/providers.ts");
const { DEFAULT_SETTINGS } = await import("../src/core/state.ts");
const { Bridge } = await import("../src/core/bridge.ts");
const { setLanguage } = await import("../src/i18n/i18n.ts");
const originalInvoke = internals.invoke;
let answers, settings, saved, view;
internals.invoke = async (cmd, args) => {
  const result = await originalInvoke(cmd, args);
  return cmd in answers ? (typeof answers[cmd] === "function" ? answers[cmd](args) : answers[cmd]) : result;
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (cls) => view.querySelector(cls);

beforeEach(() => {
  setLanguage("en");
  calls.length = 0;
  answers = {};
  settings = { ...DEFAULT_SETTINGS, chatModels: {} };
  saved = [];
  view = buildProviderSetup({
    settings: () => settings,
    save: async (next) => {
      await Bridge.saveSettingsOrThrow(next);
      saved.push(next);
      settings = next;
    },
  });
});

test("fresh setup offers Automatic, Gemini and Groq without networking or demanding Ollama", () => {
  assert.equal($(".setup-provider").value, "auto");
  const offered = $(".setup-provider").find("OPTION").map((n) => n.getAttribute("value"));
  assert.ok(offered.includes("google") && offered.includes("groq") && offered.includes("ollama"));
  assert.match(view.textContent, /Ollama is optional/);
  assert.equal($(".setup-model-row").hidden, true);
  assert.equal($(".setup-manual-row").hidden, true);
  assert.equal(calls.length, 0, "opening Settings does not probe cloud services or read secrets");
});

test("explicit Automatic check reports the actual fallback provider and model", async () => {
  answers.chat_provider_status = { provider: "auto", available: true, effectiveProvider: "groq", model: "llama-3.3-70b-versatile" };
  $(".setup-check").fire("click");
  await flush();
  assert.deepEqual(sent("chat_provider_status"), [{ provider: "auto" }]);
  assert.equal($(".setup-status").textContent, "Ready: Groq · llama-3.3-70b-versatile");
  assert.ok($(".setup-status").classList.contains("ok"));
  assert.deepEqual(sent("chat_send"), [], "a connection check never generates a reply");
});

test("provider selection is saved without fetching models or sending any prompt", async () => {
  $(".setup-provider").value = "groq";
  $(".setup-provider").fire("change");
  await flush();
  assert.equal(settings.chatProvider, "groq");
  assert.equal($(".setup-model-row").hidden, false);
  assert.equal($(".setup-manual").value, "llama-3.3-70b-versatile");
  assert.equal(saved.length, 1);
  assert.deepEqual(sent("chat_models"), []);
  assert.deepEqual(sent("chat_provider_status"), []);
});

test("failed settings write keeps the old provider and displays the native error", async () => {
  answers.save_settings = () => { throw new Error("settings file unavailable"); };
  $(".setup-provider").value = "groq";
  $(".setup-provider").fire("change");
  await flush();
  assert.equal(settings.chatProvider, "auto");
  assert.equal($(".setup-provider").value, "auto");
  assert.match($(".setup-status").textContent, /settings file unavailable/);
  assert.equal(saved.length, 0);
});

test("model refresh saves a supported model and manual selection remains possible", async () => {
  $(".setup-provider").value = "google";
  $(".setup-provider").fire("change");
  await flush();
  answers.chat_models = [
    { id: "gemini-existing-pro", label: "Gemini Pro" },
    { id: "gemini-existing-flash", label: "Gemini Flash" },
  ];
  $(".setup-refresh").fire("click");
  await flush();
  assert.deepEqual(sent("chat_models"), [{ provider: "google" }]);
  assert.equal(settings.chatModels.google, "gemini-existing-flash");
  $(".setup-manual").value = "  my-new-model  ";
  $(".setup-save-model").fire("click");
  await flush();
  assert.equal(settings.chatModels.google, "my-new-model");
  assert.equal($(".setup-models").value, "my-new-model");
  assert.equal(sent("chat_models").length, 1, "manual selection doesn't require a model-list request");
});

test("a stale connection response cannot mark a newly selected provider ready", async () => {
  let finish;
  answers.chat_provider_status = () => new Promise((resolve) => { finish = resolve; });
  $(".setup-check").fire("click");
  await flush();
  $(".setup-provider").value = "groq";
  $(".setup-provider").fire("change");
  await flush();
  finish({ provider: "auto", available: true, effectiveProvider: "ollama", model: "old-model" });
  await flush();
  assert.equal(settings.chatProvider, "groq");
  assert.doesNotMatch($(".setup-status").textContent, /old-model/);
  assert.equal($(".setup-check").disabled, false);
});

test("an unavailable provider stays visibly unavailable and the status reads in Uzbek", async () => {
  answers.chat_provider_status = { provider: "auto", available: false, model: "", error: "API key invalid" };
  $(".setup-check").fire("click");
  await flush();
  assert.equal($(".setup-status").textContent, "API key invalid");
  assert.ok($(".setup-status").classList.contains("err"));
  setLanguage("uz");
  assert.equal(providerStatusText({ provider: "auto", available: true, effectiveProvider: "google", model: "test-flash" }), "Tayyor: Gemini · test-flash");
  setLanguage("en");
});
