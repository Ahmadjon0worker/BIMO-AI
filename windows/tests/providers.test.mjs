// The island's provider table (src/core/providers.ts): which model the chat
// uses, which chips the picker shows, and what a server address exposes.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDERS, activeModel, isLoopbackHost, pickModel, providerDef, urlExposure, visibleProviders, withModel,
} from "../src/core/providers.ts";
import { DEFAULT_SETTINGS } from "../src/core/state.ts";

const settings = (over = {}) => ({ ...DEFAULT_SETTINGS, ...over });

test("the ids and key names match the Rust side and the Mac", () => {
  assert.deepEqual(PROVIDERS.map((p) => p.id), ["auto", "anthropic", "google", "groq", "openai", "openrouter", "ollama", "lmstudio", "custom"]);
  assert.equal(providerDef("google").key, "google-api-key");
  assert.equal(providerDef("google").name, "Gemini");
  assert.equal(providerDef("groq").key, "groq-api-key");
  assert.equal(providerDef("openai").key, "openai-api-key");
  assert.equal(providerDef("openrouter").key, "openrouter-api-key");
  assert.equal(providerDef("ollama").key, null);
  // An unknown id follows the default route instead of requiring a Claude key.
  assert.equal(providerDef("nope").id, "auto");
});

test("Claude's model is the existing setting; the others are kept per provider", () => {
  assert.equal(DEFAULT_SETTINGS.chatProvider, "auto");
  assert.equal(DEFAULT_SETTINGS.language, "uz");
  assert.equal(activeModel(settings()), "auto");
  assert.equal(activeModel(settings({ chatProvider: "anthropic" })), "claude-opus-5");
  assert.equal(activeModel(settings({ chatProvider: "google" })), "gemini-3.8-flash");
  assert.equal(activeModel(settings({ chatProvider: "groq" })), "llama-3.3-70b-versatile");
  assert.equal(activeModel(settings({ chatProvider: "ollama" })), "");
  let s = withModel(settings({ chatProvider: "openai" }), "openai", "gpt-5-mini");
  assert.equal(activeModel(s), "gpt-5-mini");
  assert.equal(s.model, "claude-opus-5");
  s = withModel(s, "anthropic", "claude-haiku-4-5");
  assert.equal(s.model, "claude-haiku-4-5");
  assert.equal(s.chatModels.openai, "gpt-5-mini");
  // withModel never changes the object it was given.
  assert.deepEqual(DEFAULT_SETTINGS.chatModels, {});
});

test("Automatic and Ollama are visible before setup; other servers appear when configured", () => {
  const ids = (s) => visibleProviders(s).map((p) => p.id);
  const initial = ["auto", "anthropic", "google", "groq", "openai", "openrouter", "ollama"];
  assert.deepEqual(ids(settings()), initial);
  assert.deepEqual(ids(settings({ ollamaUrl: "http://127.0.0.1:11434" })), initial);
  assert.deepEqual(ids(settings({ chatProvider: "custom" })), [...initial, "custom"]);
});

test("Automatic cannot retain a manual model that would mask per-provider choices", () => {
  const initial = settings({ chatModels: { google: "my-gemini", groq: "my-groq", ollama: "my-local" } });
  assert.equal(withModel(initial, "auto", "wrong"), initial);
  assert.equal(activeModel(initial), "auto");
  assert.equal(activeModel({ ...initial, chatProvider: "groq" }), "my-groq");
});

test("the saved model is kept when offered, else a sensible one is picked", () => {
  const google = providerDef("google");
  assert.equal(pickModel(google, ["gemini-2.5-pro", "gemini-2.0-flash"], "gemini-2.5-pro"), "gemini-2.5-pro");
  assert.equal(pickModel(google, ["gemini-2.5-pro", "gemini-2.5-flash"], "gone"), "gemini-2.5-flash");
  assert.equal(pickModel(providerDef("openai"), ["gpt-4o", "gpt-5-mini"], "gone"), "gpt-5-mini");
  assert.equal(pickModel(providerDef("ollama"), ["llama3.2", "qwen"], ""), "llama3.2");
  assert.equal(pickModel(providerDef("openrouter"), ["a/b", "openrouter/auto"], "gone"), "openrouter/auto");
  assert.equal(pickModel(google, [], "x"), null);
});

test("loopback hosts match net.rs", () => {
  for (const host of ["localhost", "app.localhost", "127.0.0.1", "127.9.9.9", "[::1]", "::1", "0.0.0.0", "[::]"]) {
    assert.ok(isLoopbackHost(host), host);
  }
  for (const host of ["example.com", "192.168.1.2", "localhost.example.com", "128.0.0.1", "[2001:db8::1]"]) {
    assert.ok(!isLoopbackHost(host), host);
  }
});

test("an address says whether what you type leaves this computer", () => {
  assert.equal(urlExposure(""), "local");
  assert.equal(urlExposure("http://localhost:11434"), "local");
  assert.equal(urlExposure("127.0.0.1:1234/v1"), "local");
  assert.equal(urlExposure("http://[::1]:8000"), "local");
  assert.equal(urlExposure("https://llm.example.com"), "remote");
  assert.equal(urlExposure("http://gpu-box.lan:8000"), "remote-http");
  assert.equal(urlExposure("192.168.1.20:8000"), "remote-http");
  assert.equal(urlExposure("ftp://example.com"), "invalid");
  assert.equal(urlExposure("http://user:pw@example.com"), "invalid");
  assert.equal(urlExposure("http://"), "invalid");
});
