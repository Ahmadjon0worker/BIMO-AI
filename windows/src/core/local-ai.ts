// Local AI's status and controls. The native bridge owns the fixed loopback
// address; the webview never makes a network request or supplies an endpoint.

export const LOCAL_AI_MODES = ["ECO", "BALANCED", "QUALITY"] as const;
export type LocalAIMode = (typeof LOCAL_AI_MODES)[number];
export type LocalAIControl = "mode" | "stop" | "open-opencode";

export interface LocalAIHealth {
  ok: boolean;
  mode: LocalAIMode;
  active_model: string | null;
  busy: boolean;
  operation: string | null;
  ram_available_gib: number;
  ram_total_gib: number;
  tokens_per_second: number | null;
  last_error: string | null;
  computer_use_active: boolean;
  /** Older routers omit this; a halted router needs an explicit resume. */
  halted?: boolean;
}

export interface LocalAITransport {
  health(): Promise<unknown>;
  control(action: LocalAIControl, mode?: LocalAIMode): Promise<unknown>;
}

export interface LocalAISnapshot {
  health: LocalAIHealth | null;
  connection: "checking" | "connected" | "disconnected";
  error: string | null;
  pending: Set<LocalAIControl>;
  completed: LocalAIControl | null;
}

/** Invalid or incomplete responses must never leave stale RAM/model values. */
export function parseLocalAIHealth(raw: unknown): LocalAIHealth {
  if (!raw || typeof raw !== "object") throw new Error("Invalid Local AI status");
  const v = raw as Record<string, unknown>;
  const nullableText = (value: unknown) => value === null || typeof value === "string";
  const nonnegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (v.ok !== true || !LOCAL_AI_MODES.includes(v.mode as LocalAIMode)
    || typeof v.busy !== "boolean" || typeof v.computer_use_active !== "boolean"
    || !(v.halted === undefined || typeof v.halted === "boolean")
    || !nullableText(v.active_model) || !nullableText(v.operation) || !nullableText(v.last_error)
    || !nonnegative(v.ram_available_gib) || !nonnegative(v.ram_total_gib)
    || Number(v.ram_available_gib) > Number(v.ram_total_gib)
    || !(v.tokens_per_second === null || nonnegative(v.tokens_per_second))) {
    throw new Error("Invalid Local AI status");
  }
  return v as unknown as LocalAIHealth;
}

type Timer = ReturnType<typeof setTimeout>;
export interface LocalAIClock {
  set(callback: () => void, delay: number): Timer;
  clear(timer: Timer): void;
}

/** One poll in flight, and no recurring work while the panel is invisible. */
export class LocalAIController {
  readonly snapshot: LocalAISnapshot = {
    health: null, connection: "checking", error: null, pending: new Set(), completed: null,
  };
  private visible = false;
  private timer: Timer | null = null;
  private polling = false;
  private refreshRequested = false;
  private generation = 0;
  private readonly transport: LocalAITransport;
  private readonly changed: () => void;
  private readonly clock: LocalAIClock;

  constructor(
    transport: LocalAITransport,
    changed: () => void,
    clock: LocalAIClock = {
      // WebView timers need their global receiver, not the clock object.
      set: (callback, delay) => setTimeout(callback, delay),
      clear: (timer) => clearTimeout(timer),
    },
  ) {
    this.transport = transport;
    this.changed = changed;
    this.clock = clock;
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.generation++;
    this.clearTimer();
    if (visible) {
      this.snapshot.health = null;
      this.snapshot.connection = "checking";
      void this.refresh();
    }
  }

  private clearTimer(): void {
    if (this.timer != null) this.clock.clear(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<void> {
    if (!this.visible) return;
    if (this.polling) {
      this.refreshRequested = true;
      return;
    }
    this.clearTimer();
    this.polling = true;
    const generation = this.generation;
    try {
      const health = parseLocalAIHealth(await this.transport.health());
      if (generation === this.generation && this.visible) {
        if (this.snapshot.connection === "disconnected") this.snapshot.error = null;
        this.snapshot.health = health;
        this.snapshot.connection = "connected";
      }
    } catch (error) {
      if (generation === this.generation && this.visible) {
        this.snapshot.health = null;
        this.snapshot.connection = "disconnected";
        this.snapshot.error = String(error instanceof Error ? error.message : error);
      }
    } finally {
      this.polling = false;
      if (this.visible) {
        this.changed();
        if (this.refreshRequested || generation !== this.generation) {
          this.refreshRequested = false;
          void this.refresh();
        } else {
          this.timer = this.clock.set(() => {
            this.timer = null;
            void this.refresh();
          }, 3000);
        }
      }
    }
  }

  async control(action: LocalAIControl, mode?: LocalAIMode): Promise<void> {
    if (this.snapshot.pending.has(action)) return;
    if (action === "mode" && !LOCAL_AI_MODES.includes(mode as LocalAIMode)) return;
    this.snapshot.pending.add(action);
    this.snapshot.error = null;
    this.snapshot.completed = null;
    this.changed();
    try {
      await this.transport.control(action, mode);
      this.snapshot.completed = action;
      await this.refresh();
    } catch (error) {
      this.snapshot.error = String(error instanceof Error ? error.message : error);
    } finally {
      this.snapshot.pending.delete(action);
      this.changed();
    }
  }
}
