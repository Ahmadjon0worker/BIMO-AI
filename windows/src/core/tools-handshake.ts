export type InitialToolsTab = "tools" | "assistant" | "voice";
export interface ToolsSnapshot { visible: boolean; tab: InitialToolsTab }

function parseSnapshot(value: unknown): ToolsSnapshot {
  if (!value || typeof value !== "object") throw new Error("Tools window state is unavailable");
  const s = value as Record<string, unknown>;
  if (typeof s.visible !== "boolean" || typeof s.tab !== "string" || !["tools", "assistant", "voice"].includes(s.tab)) throw new Error("Tools window state is invalid");
  return { visible: s.visible, tab: s.tab as InitialToolsTab };
}

/** Query after listeners are ready. A newer event or pagehide always wins over
 * an in-flight snapshot; restoring a display state never starts recording. */
export class ToolsHandshake {
  private revision = 0;
  private closed = false;
  changed() { this.revision++; }
  close() { this.closed = true; this.changed(); }
  async restore(read: () => Promise<unknown>, apply: (state: ToolsSnapshot) => void) {
    const revision = this.revision;
    const state = await read();
    if (this.closed || revision !== this.revision) return;
    apply(parseSnapshot(state));
  }
}
