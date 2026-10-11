import { invoke } from "@tauri-apps/api/core";
import { IS_TAURI } from "./bridge";

/** A visual pointer only. Never performs input or treats a point as task success. */
export interface CompanionPoint { x: number; y: number; label: string; reduced_motion?: boolean }
export function parseCompanionPoint(raw: unknown): CompanionPoint {
  if (!raw || typeof raw !== "object") throw new Error("Ko‘rsatish nuqtasi topilmadi");
  const p = raw as Record<string, unknown>;
  if (typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y)
      || Math.abs(p.x) > 100000 || Math.abs(p.y) > 100000 || typeof p.label !== "string"
      || !p.label.trim() || p.label.length > 160 || /[\x00-\x1f]/.test(p.label)) {
    throw new Error("Ko‘rsatish nuqtasi yaroqsiz");
  }
  return { x: p.x, y: p.y, label: p.label.trim(), reduced_motion: p.reduced_motion === true };
}
export async function pointMoshi(raw: unknown): Promise<void> {
  const point = parseCompanionPoint(raw);
  if (!IS_TAURI) throw new Error("Moshi ko‘rsatgichi Windows ilovasida ishlaydi");
  point.reduced_motion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  await invoke("companion_point", { point });
}
export async function stopMoshiPoint(): Promise<void> {
  if (IS_TAURI) await invoke("companion_hide");
}
