// The chat view (src/views/chat.ts) on a fake DOM, through the real bridge:
// the model switcher asks for a provider's models only once it is picked and
// has a key, picking saves the settings, and a streamed answer grows in place.

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";
import { calls, emit, internals, sent } from "./tauri.mjs";

installFakeDom();
const { buildPrompt } = await import("../src/views/chat.ts");
const { DEFAULT_SETTINGS, State } = await import("../src/core/state.ts");

/** What the mocked Rust side answers, by command. */
let answers;
const plainInvoke = internals.invoke;
internals.invoke = async (cmd, args) => {
  const result = await plainInvoke(cmd, args);
  if (cmd in answers) return typeof answers[cmd] === "function" ? answers[cmd](args) : answers[cmd];
  return result;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let view;
beforeEach(() => {
  calls.length = 0;
  answers = {};
  State.settings = { ...DEFAULT_SETTINGS, chatProvider: "anthropic", chatModels: {} };
  State.chatHistory = [];
  State.stateOverride = null;
  State.view = "prompt";
  State.droppedFile = null;
  view = buildPrompt(() => {});
  view.sync();
});

const $ = (cls) => view.el.querySelector(cls);
const chips = () => view.el.find(".picker-chip").map((c) => c.textContent);
const models = () => view.el.find(".picker-model").map((m) => m.textContent);

test("the model button shows the active provider's model", () => {
  assert.equal($(".model-name").textContent, "Anthropic · claude-opus-5");
  State.settings = { ...State.settings, chatProvider: "google" };
  view.sync();
  assert.equal($(".model-name").textContent, "Gemini · gemini-3.8-flash");
  State.settings = { ...State.settings, chatProvider: "ollama" };
  view.sync();
  assert.equal($(".model-name").textContent, "Ollama · Choose a model");
});

test("a provider without a key is never asked for its models", async () => {
  answers.secret_present = false;
  $(".model-btn").fire("click");
  await flush();
  assert.ok($(".chat-body").classList.contains("picking"));
  assert.deepEqual(chips(), ["Automatic", "Anthropic", "Gemini", "Groq", "OpenAI", "OpenRouter", "Ollama"]);
  assert.deepEqual(sent("secret_present"), [{ key: "anthropic-api-key" }]);
  assert.deepEqual(sent("chat_models"), []);
  assert.match($(".picker-status").textContent, /No API key/);
});

test("with a key, the models are listed and picking one saves it", async () => {
  answers.secret_present = true;
  answers.chat_models = [
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  ];
  $(".model-btn").fire("click");
  await flush();
  assert.deepEqual(sent("chat_models"), [{ provider: "anthropic" }]);
  assert.deepEqual(models(), ["Claude Opus 5", "Claude Sonnet 5"]);
  view.el.find(".picker-model")[1].fire("click");
  assert.equal(State.settings.model, "claude-sonnet-5");
  assert.equal(sent("save_settings").at(-1).settings.model, "claude-sonnet-5");
  assert.ok(!$(".chat-body").classList.contains("picking"));
  assert.equal($(".model-name").textContent, "Anthropic · claude-sonnet-5");
});

test("switching provider saves it and asks the new provider only", async () => {
  answers.secret_present = (args) => args.key === "google-api-key";
  answers.chat_models = (args) => (args.provider === "google" ? [{ id: "gemini-2.5-flash", label: "gemini-2.5-flash" }] : []);
  $(".model-btn").fire("click");
  await flush();
  assert.deepEqual(sent("chat_models"), []);
  view.el.find(".picker-chip").find((c) => c.textContent === "Gemini").fire("click");
  await flush();
  assert.equal(State.settings.chatProvider, "google");
  assert.deepEqual(sent("chat_models"), [{ provider: "google" }]);
  // The saved model was not offered: the flash one is kept instead, and saved.
  assert.equal(State.settings.chatModels.google, "gemini-2.5-flash");
  assert.equal(sent("save_settings").at(-1).settings.chatModels.google, "gemini-2.5-flash");
  assert.deepEqual(models(), ["gemini-2.5-flash"]);
});

test("a local answer streams into one reply, then the finished text replaces it", async () => {
  let finish;
  answers.chat_send = () => new Promise((resolve) => (finish = resolve));
  const input = $(".chat-input");
  input.value = "hello";
  $(".send-btn").fire("click");
  await flush();
  view.sync(); // what State.notify() does in the island
  assert.ok($(".model-btn").disabled, "no switching mid-answer");
  assert.ok($(".typing"), "dots until the first visible text");

  emit("chat-delta", ""); // still thinking
  assert.ok($(".typing"));
  emit("chat-delta", "Hel");
  emit("chat-delta", "Hello **there**");
  view.sync(); // another view update mid-stream must not wipe the live answer
  assert.equal($(".typing"), null);
  const replies = view.el.find(".reply");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].find("STRONG")[0].textContent, "there");

  finish({ text: "Hello **there**!" });
  await flush();
  view.sync();
  assert.equal(view.el.find(".reply").length, 1);
  assert.equal(view.el.find(".reply")[0].textContent, "Hello there!");
  assert.deepEqual(State.chatHistory.map((m) => m.role), ["user", "assistant"]);
  assert.ok(!$(".model-btn").disabled);
});

test("fresh Automatic chat shows the cloud provider that actually answered", async () => {
  State.settings = { ...DEFAULT_SETTINGS, chatModels: {} };
  view.sync();
  assert.equal($(".model-name").textContent, "Automatic");
  answers.chat_send = { text: "Hello", provider: "groq", model: "llama-3.3-70b-versatile" };
  $(".chat-input").value = "hello";
  $(".send-btn").fire("click");
  await flush();
  view.sync();
  assert.equal($(".model-name").textContent, "Automatic · Groq · llama-3.3-70b-versatile");
  assert.equal(State.chatHistory.at(-1).content, "Hello");
  State.chatHistory = [];
  view.sync();
  assert.equal($(".model-name").textContent, "Automatic", "a new chat clears the previous reply's provider status");
});

test("Groq uses its own credential and the picker can refresh or save a manual model", async () => {
  answers.secret_present = (args) => args.key === "groq-api-key";
  answers.chat_models = [{ id: "llama-3.3-70b-versatile", label: "Llama" }];
  $(".model-btn").fire("click");
  await flush();
  view.el.find(".picker-chip").find((c) => c.textContent === "Groq").fire("click");
  await flush();
  assert.equal(State.settings.chatProvider, "groq");
  assert.deepEqual(sent("chat_models"), [{ provider: "groq" }]);
  assert.ok(sent("secret_present").some((v) => v.key === "groq-api-key"));
  $(".picker-refresh").fire("click");
  await flush();
  assert.equal(sent("chat_models").length, 2);
  $(".picker-model-input").value = "my-model";
  $(".picker-use-model").fire("click");
  assert.equal(State.settings.chatModels.groq, "my-model");
  assert.equal($(".model-name").textContent, "Groq · my-model");
});
