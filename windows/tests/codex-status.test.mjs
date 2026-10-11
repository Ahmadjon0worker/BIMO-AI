import { test } from "node:test";
import assert from "node:assert/strict";
import { codexStatus } from "../src/core/agent-status.ts";
import { setLanguage } from "../src/i18n/i18n.ts";

test("Codex status distinguishes thinking, working, approval, answer, failure and completion", () => {
  setLanguage("uz");
  const expected = {
    thinking: "Codex o‘ylayapti",
    working: "Codex ishlayapti",
    searching: "Codex qidiryapti",
    approval: "Codex ruxsat kutmoqda",
    question: "Codex javobingizni kutmoqda",
    error: "Codex’da xato yuz berdi",
    ratelimit: "Codex limitga yetdi",
    finished: "Codex vazifani tugatdi",
    idle: "Codex tayyor",
  };
  try {
    for (const [state, text] of Object.entries(expected)) {
      assert.equal(codexStatus({state}), text);
    }
    assert.equal(codexStatus({state: "idle", finalLine: "Done"}), expected.finished);
    assert.equal(codexStatus({state: "working", finalLine: "Old result"}), expected.working);
  } finally {
    setLanguage("en");
  }
});
