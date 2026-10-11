import type { AgentTask } from "./state";
import { t } from "../i18n/i18n";

/** Derive the displayed status from the same state the hook handler updates. */
export function codexStatus(task: Pick<AgentTask, "state" | "finalLine">): string {
  switch (task.state) {
    case "thinking": return t("Codex is thinking");
    case "working": return t("Codex is working");
    case "searching": return t("Codex is searching");
    case "approval": return t("Codex needs permission");
    case "question": return t("Codex needs your answer");
    case "finished": return t("Codex finished");
    case "error": return t("Codex encountered an error");
    case "ratelimit": return t("Codex reached a rate limit");
    default: return task.finalLine ? t("Codex finished") : t("Codex is ready");
  }
}
