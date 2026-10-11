import { PANEL_W, PANEL_H, COMPACT_W, NOTCH_H } from "../core/layout";

export const PANEL_DOCKS = ["free", "top", "bottom", "left", "right",
  "top-left", "top-right", "bottom-left", "bottom-right"] as const;
export type PanelDock = typeof PANEL_DOCKS[number];
export type CompactShape = "horizontal" | "vertical" | "square";

/** Old saved positions had no dock; exact edges migrate without moving interiors. */
export function panelDock(position?: { x: number; y: number; dock?: string } | null): PanelDock {
  if (!position) return "top";
  if (PANEL_DOCKS.includes(position.dock as PanelDock)) return position.dock as PanelDock;
  const x = position.x <= 0 ? "left" : position.x >= 1 ? "right" : "";
  const y = position.y <= 0 ? "top" : position.y >= 1 ? "bottom" : "";
  return (x && y ? `${y}-${x}` : x || y || "free") as PanelDock;
}

export function compactShape(dock: PanelDock): CompactShape {
  return dock.includes("-") ? "square" : dock === "left" || dock === "right" ? "vertical" : "horizontal";
}

export function compactSize(dock: PanelDock): { w: number; h: number } {
  switch (compactShape(dock)) {
    case "vertical": return { w: 40, h: 192 };
    case "square": return { w: 80, h: 80 };
    default: return { w: COMPACT_W, h: NOTCH_H };
  }
}

/** Align the painted panel, rather than its transparent 720 × 320 host margin. */
export function panelRect(w: number, h: number, dock: PanelDock, hostW = PANEL_W, hostH = PANEL_H) {
  const right = dock === "right" || dock.endsWith("-right");
  const left = dock === "left" || dock.endsWith("-left");
  const bottom = dock === "bottom" || dock.startsWith("bottom-");
  const side = dock === "left" || dock === "right";
  return {
    x: right ? hostW - w : left ? 0 : (hostW - w) / 2,
    y: bottom ? hostH - h : side ? (hostH - h) / 2 : 0,
    w, h,
  };
}

/** Corners at attached edges stay square, making the surface meet the edge. */
export function panelRadii(dock: PanelDock, radius: number): string {
  const top = dock === "top" || dock.startsWith("top-");
  const bottom = dock === "bottom" || dock.startsWith("bottom-");
  const left = dock === "left" || dock.endsWith("-left");
  const right = dock === "right" || dock.endsWith("-right");
  return [top || left, top || right, bottom || right, bottom || left]
    .map((attached) => `${attached ? 0 : radius}px`).join(" ");
}

export function compactParts(dock: PanelDock, w: number, h: number) {
  switch (compactShape(dock)) {
    case "vertical": return {
      bot: { cx: w / 2, cy: 32 },
      grid: { x: (w - 13) / 2, y: 66, columns: 1, width: 13, height: 61 },
      handle: { x: (w - 24) / 2, y: h - 29 },
    };
    case "square": return {
      bot: { cx: 24, cy: 22 },
      grid: { x: (w - 29) / 2, y: h - 36, columns: 2, width: 29, height: 29 },
      handle: { x: w - 29, y: 8 },
    };
    default: return {
      bot: { cx: 40, cy: h / 2 },
      grid: { x: w - 62, y: h / 2 - 14.5, columns: 2, width: 29, height: 29 },
      handle: { x: w - 29, y: 4 },
    };
  }
}
