/** Local automation is a reviewed workflow. Plain chat never dispatches actions. */
export interface TelegramStatus {
  configured: boolean;
  enabled: boolean;
  running: boolean;
  allowed_chat_ids: number[];
  last_error: string | null;
  bot_username: string | null;
}
export interface ComputerPlan {
  task: string;
  window_title: string;
  document_path: string;
  expected_text?: string;
  require_saved: boolean;
}
export interface ComputerProposal {
  action: "click" | "type" | "keypress" | "finish";
  text?: string;
  key?: string;
  x?: number;
  y?: number;
}
export interface ComputerReview {
  id: string;
  status: "pending" | "finished" | "error" | "cancelled";
  proposal?: ComputerProposal;
  reason?: string;
  expected_postcondition?: string;
  observation?: { editor_text?: string; [key: string]: unknown };
  actions_remaining?: number;
  verified_task_success?: boolean;
  error?: string;
}
export interface Capabilities {
  ok: boolean;
  profile: unknown;
  telegram: TelegramStatus;
  computer: { active: boolean; pending: ComputerReview | null; max_actions: number; workspace_root?: string };
  remote_requests: { chat_id: number; task: string; created_at: number; requires_desktop_approval: true }[];
}
export interface TelegramConfig { token?: string; allowed_chat_ids: number[]; enabled: false }
export interface CapabilitiesTransport {
  capabilities(): Promise<unknown>;
  configure(config: TelegramConfig): Promise<unknown>;
  telegram(action: "start" | "stop"): Promise<unknown>;
  plan(plan: ComputerPlan): Promise<unknown>;
  approve(id: string): Promise<unknown>;
  finish(): Promise<unknown>;
  stop(): Promise<unknown>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid automation status.");
  return value as Record<string, unknown>;
}
function optionalString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("Invalid automation status.");
  return value;
}
export function parseChatIDs(value: string): number[] {
  const items = value.trim().split(/[\s,;]+/).filter(Boolean);
  if (!items.length || items.length > 100) throw new Error("Enter allowed Telegram chat IDs.");
  const ids = items.map((item) => {
    if (!/^-?\d+$/.test(item)) throw new Error("Telegram chat IDs must be whole numbers.");
    const id = Number(item);
    if (!Number.isSafeInteger(id) || id === 0) throw new Error("Telegram chat IDs must be whole numbers.");
    return id;
  });
  return [...new Set(ids)];
}
export function parseTelegramStatus(value: unknown): TelegramStatus {
  const data = object(value);
  if ([data.configured, data.enabled, data.running].some((item) => typeof item !== "boolean")
    || !Array.isArray(data.allowed_chat_ids) || data.allowed_chat_ids.length > 100
    || data.allowed_chat_ids.some((id) => !Number.isSafeInteger(id) || id === 0)) {
    throw new Error("Invalid automation status.");
  }
  return { configured: data.configured as boolean, enabled: data.enabled as boolean,
    running: data.running as boolean, allowed_chat_ids: data.allowed_chat_ids as number[],
    last_error: optionalString(data.last_error), bot_username: optionalString(data.bot_username) };
}
export function parseComputerReview(value: unknown): ComputerReview {
  const data = object(value);
  if (typeof data.id !== "string" || !data.id || data.id.length > 128
    || typeof data.status !== "string" || !["pending", "finished", "error", "cancelled"].includes(data.status)) {
    throw new Error("Invalid automation status.");
  }
  const result: ComputerReview = { id: data.id, status: data.status as ComputerReview["status"] };
  if (data.proposal != null) {
    const proposal = object(data.proposal);
    if (typeof proposal.action !== "string" || !["click", "type", "keypress", "finish"].includes(proposal.action)
      || typeof data.reason !== "string" || typeof data.expected_postcondition !== "string") {
      throw new Error("Invalid automation status.");
    }
    const next: ComputerProposal = { action: proposal.action as ComputerProposal["action"] };
    result.reason = data.reason;
    result.expected_postcondition = data.expected_postcondition;
    if (proposal.text != null) {
      if (typeof proposal.text !== "string" || proposal.text.length > 2000) throw new Error("Invalid automation status.");
      next.text = proposal.text;
    }
    if (proposal.key != null) {
      if (typeof proposal.key !== "string" || proposal.key.length > 24) throw new Error("Invalid automation status.");
      next.key = proposal.key;
    }
    for (const axis of ["x", "y"] as const) {
      if (proposal[axis] != null) {
        if (!Number.isSafeInteger(proposal[axis]) || Number(proposal[axis]) < 0) throw new Error("Invalid automation status.");
        next[axis] = Number(proposal[axis]);
      }
    }
    if (next.action === "type" && next.text == null
      || next.action === "keypress" && !next.key
      || next.action === "click" && (next.x == null || next.y == null)) throw new Error("Invalid automation status.");
    result.proposal = next;
  }
  if (result.status === "pending" && !result.proposal) throw new Error("Invalid automation status.");
  if (data.observation != null) {
    const observed = object(data.observation);
    if (observed.editor_text != null && typeof observed.editor_text !== "string") throw new Error("Invalid automation status.");
    result.observation = observed;
  }
  if (data.actions_remaining != null) {
    if (!Number.isInteger(data.actions_remaining) || Number(data.actions_remaining) < 0 || Number(data.actions_remaining) > 10) {
      throw new Error("Invalid automation status.");
    }
    result.actions_remaining = Number(data.actions_remaining);
  }
  if (data.verified_task_success != null) {
    if (typeof data.verified_task_success !== "boolean") throw new Error("Invalid automation status.");
    result.verified_task_success = data.verified_task_success;
  }
  if (data.error != null) result.error = optionalString(data.error) || undefined;
  return result;
}
export function observedEditorText(review: ComputerReview | null): string {
  const observation = review?.observation;
  if (!observation) return "";
  if (typeof observation.editor_text === "string") return observation.editor_text;
  if (observation.editor && typeof observation.editor === "object" && !Array.isArray(observation.editor)) {
    const excerpt = (observation.editor as Record<string, unknown>).text_excerpt;
    if (typeof excerpt === "string") return excerpt;
  }
  return "";
}
export function parseCapabilities(value: unknown): Capabilities {
  const data = object(value), computer = object(data.computer);
  if (typeof data.ok !== "boolean" || typeof computer.active !== "boolean"
    || !Number.isInteger(computer.max_actions) || Number(computer.max_actions) < 1 || Number(computer.max_actions) > 10) {
    throw new Error("Invalid automation status.");
  }
  if (computer.workspace_root != null && (typeof computer.workspace_root !== "string"
    || !computer.workspace_root.trim() || computer.workspace_root.length > 500)) {
    throw new Error("Invalid automation status.");
  }
  const remoteRequests: Capabilities["remote_requests"] = [];
  if (data.remote_requests != null) {
    if (!Array.isArray(data.remote_requests) || data.remote_requests.length > 10) throw new Error("Invalid automation status.");
    for (const value of data.remote_requests) {
      const item = object(value);
      if (!Number.isSafeInteger(item.chat_id) || item.chat_id === 0 || typeof item.task !== "string"
        || !item.task.trim() || item.task.length > 2000 || !Number.isSafeInteger(item.created_at)
        || Number(item.created_at) < 0 || item.requires_desktop_approval !== true) throw new Error("Invalid automation status.");
      remoteRequests.push({ chat_id: Number(item.chat_id), task: item.task, created_at: Number(item.created_at), requires_desktop_approval: true });
    }
  }
  return { ok: data.ok, profile: data.profile, telegram: parseTelegramStatus(data.telegram), remote_requests: remoteRequests,
    computer: { active: computer.active, max_actions: Number(computer.max_actions),
      ...(typeof computer.workspace_root === "string" ? { workspace_root: computer.workspace_root } : {}),
      pending: computer.pending == null ? null : parseComputerReview(computer.pending) } };
}

/** The revision ID displayed for review is consumed once, never auto-approved. */
export class CapabilitiesController {
  snapshot: { capabilities: Capabilities | null; review: ComputerReview | null; pending: string | null; error: string; notice: string }
    = { capabilities: null, review: null, pending: null, error: "", notice: "" };
  private generation = 0;
  private refreshFlight: Promise<void> | null = null;
  private controlError = false;
  private transport: CapabilitiesTransport;
  private changed: () => void;
  constructor(transport: CapabilitiesTransport, changed: () => void = () => {}) {
    this.transport = transport; this.changed = changed;
  }

  refresh(): Promise<void> {
    if (this.refreshFlight) return this.refreshFlight;
    const generation = this.generation;
    const flight = (async () => {
      try {
        const capabilities = parseCapabilities(await this.transport.capabilities());
        if (generation !== this.generation || this.snapshot.pending) return;
        this.snapshot.capabilities = capabilities;
        if (capabilities.computer.pending) this.snapshot.review = capabilities.computer.pending;
        else if (!capabilities.computer.active && this.snapshot.review?.status === "pending") this.snapshot.review = null;
        if (!this.controlError) this.snapshot.error = "";
      } catch (error) {
        if (generation === this.generation && !this.snapshot.pending) {
          this.snapshot.capabilities = null;
          if (this.snapshot.review?.status === "pending") this.snapshot.review = null;
          if (!this.controlError) this.snapshot.error = String(error instanceof Error ? error.message : error);
        }
      } finally { this.changed(); }
    })();
    this.refreshFlight = flight;
    void flight.finally(() => { if (this.refreshFlight === flight) this.refreshFlight = null; });
    return flight;
  }

  async run(action: "configure" | "start" | "telegram-stop" | "plan" | "approve" | "finish" | "stop", input?: TelegramConfig | ComputerPlan): Promise<void> {
    // Emergency stop can interrupt an in-flight plan/approval; all other writes serialize.
    if (this.snapshot.pending && action !== "stop" && action !== "finish") return;
    if (this.snapshot.pending === action) return;
    const id = this.snapshot.review?.status === "pending" ? this.snapshot.review.id : null;
    if (action === "approve" && !id) return;
    const generation = ++this.generation;
    this.snapshot.pending = action; this.snapshot.error = ""; this.snapshot.notice = "";
    this.controlError = false;
    if (["approve", "plan", "finish", "stop"].includes(action)) this.snapshot.review = null;
    this.changed();
    try {
      if (action === "plan" || action === "approve") {
        const result = action === "plan" ? await this.transport.plan(input as ComputerPlan) : await this.transport.approve(id!);
        if (generation === this.generation) this.snapshot.review = parseComputerReview(result);
      } else if (action === "configure" || action === "start" || action === "telegram-stop") {
        const result = action === "configure" ? await this.transport.configure(input as TelegramConfig)
          : await this.transport.telegram(action === "start" ? "start" : "stop");
        if (generation === this.generation && this.snapshot.capabilities) this.snapshot.capabilities.telegram = parseTelegramStatus(result);
      } else {
        if (action === "stop") await this.transport.stop(); else await this.transport.finish();
      }
      if (generation === this.generation) this.snapshot.notice = action === "stop" ? "Stop requested. Check that the task has ended."
        : action === "finish" ? "Windows task cancelled." : "Automation status updated.";
    } catch (error) {
      if (generation === this.generation) {
        this.controlError = true;
        this.snapshot.error = String(error instanceof Error ? error.message : error);
      }
    } finally {
      if (generation === this.generation) {
        this.snapshot.pending = null; this.changed();
        // A GET started before the mutation cannot replace its result or fulfill
        // the required refresh. Let that request finish, then issue a fresh GET.
        if (this.refreshFlight) await this.refreshFlight;
        if (generation === this.generation) await this.refresh();
      }
    }
  }
}
