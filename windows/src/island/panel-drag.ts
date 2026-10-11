/** Pointer lifetime and ordered IPC for moving the panel. Mouse motion is native. */
export type PanelPointerType = "mouse" | "touch" | "pen";

export interface PanelPointer {
  pointerId: number;
  pointerType: string;
  button: number;
  isPrimary: boolean;
  screenX: number;
  screenY: number;
  clientX?: number;
  clientY?: number;
}

export interface PanelDragSink {
  begin(kind: PanelPointerType, clientX?: number, clientY?: number): Promise<boolean>;
  update(dx: number, dy: number): Promise<unknown>;
  end(cancelled: boolean): Promise<unknown>;
  active(on: boolean): void;
}

interface Session {
  id: number;
  kind: PanelPointerType;
  x: number;
  y: number;
  ending: boolean;
  moved: boolean;
  failed: boolean;
  ready: Promise<boolean>;
  pending: { dx: number; dy: number } | null;
  flushing: Promise<void> | null;
}

export class PanelDrag {
  private session: Session | null = null;
  private readonly sink: PanelDragSink;

  constructor(sink: PanelDragSink) { this.sink = sink; }

  get active(): boolean { return this.session !== null; }
  get pointerId(): number | null { return this.session?.id ?? null; }

  start(p: PanelPointer): boolean {
    if (this.session || !p.isPrimary || p.button !== 0 ||
        !["mouse", "touch", "pen"].includes(p.pointerType) ||
        !Number.isFinite(p.screenX) || !Number.isFinite(p.screenY)) return false;
    const s: Session = {
      id: p.pointerId, kind: p.pointerType as PanelPointerType,
      x: p.screenX, y: p.screenY, ending: false, moved: false, failed: false,
      ready: Promise.resolve(false), pending: null, flushing: null,
    };
    this.session = s;
    this.sink.active(true);
    // Start at pointerdown so the native cursor origin includes the first move.
    const clientX = Number.isFinite(p.clientX) ? p.clientX : undefined;
    const clientY = Number.isFinite(p.clientY) ? p.clientY : undefined;
    s.ready = Promise.resolve().then(() => this.sink.begin(s.kind, clientX, clientY)).catch(() => false);
    void s.ready.then((accepted) => {
      if (this.session !== s) return;
      if (!accepted) this.clear(s);
      else if (!s.ending) void this.flush(s);
    });
    return true;
  }

  move(p: Pick<PanelPointer, "pointerId" | "screenX" | "screenY">): void {
    const s = this.session;
    if (!s || s.ending || p.pointerId !== s.id || s.kind === "mouse") return;
    const dx = p.screenX - s.x, dy = p.screenY - s.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (!s.moved && Math.hypot(dx, dy) < 4) return;
    s.moved = true;
    // Total screen deltas remain stable when the window itself moves. Only keep
    // the newest pending move, never replay a slow queue of old touch positions.
    s.pending = { dx, dy };
    void s.ready.then((accepted) => { if (accepted && !s.ending) void this.flush(s); });
  }

  async end(cancelled = false, pointerId = this.pointerId): Promise<void> {
    const s = this.session;
    if (!s || s.ending || pointerId !== s.id) return;
    s.ending = true;
    if (cancelled) s.pending = null;
    try {
      if (!await s.ready || this.session !== s) return;
      if (cancelled) await s.flushing;
      else {
        do { await this.flush(s); }
        while (this.session === s && s.pending && !s.failed);
      }
      if (this.session === s) await this.sink.end(cancelled || s.failed);
    } finally {
      this.clear(s);
    }
  }

  /** Native mouse release can occur outside the WebView's pointer capture. */
  nativeEnd(): void {
    if (this.session) this.clear(this.session);
  }

  private async flush(s: Session): Promise<void> {
    if (s.flushing) return s.flushing;
    s.flushing = (async () => {
      try {
        while (this.session === s && s.pending) {
          const { dx, dy } = s.pending;
          s.pending = null;
          await this.sink.update(dx, dy);
        }
      } catch {
        s.failed = true;
        s.pending = null;
      }
    })();
    try { await s.flushing; }
    finally {
      s.flushing = null;
      if (s.failed && !s.ending && this.session === s) {
        void this.end(true, s.id).catch(() => { /* end always clears local state. */ });
      }
    }
  }

  private clear(s: Session): void {
    if (this.session !== s) return;
    this.session = null;
    s.pending = null;
    this.sink.active(false);
  }
}
