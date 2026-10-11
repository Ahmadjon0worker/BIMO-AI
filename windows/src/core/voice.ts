import { isTelegramCommand, telegramRequestNeedsClarification } from "./telegram-command";

export type VoiceLanguage = "uz" | "en" | "ru";
export type VoiceIntent =
  | { kind: "ui"; target: "panel-open" | "panel-close" | "settings" | "studio" | "telegram" | "terminal" | "desktop" | "stop" }
  | { kind: "telegram"; query: string }
  | { kind: "github"; operation: "status" | "repos" }
  | { kind: "terminal"; shell: "cmd" | "powershell"; script: string }
  | { kind: "plan"; domain: "terminal" | "github" | "desktop"; task: string }
  | { kind: "help" };

const letters: Record<string, string> = { а:"a", б:"b", в:"v", г:"g", д:"d", е:"e", ё:"yo", ж:"j", з:"z", и:"i", й:"y", к:"k", л:"l", м:"m", н:"n", о:"o", п:"p", р:"r", с:"s", т:"t", у:"u", ф:"f", х:"x", ц:"ts", ч:"ch", ш:"sh", щ:"sh", ъ:"", ы:"i", ь:"", э:"e", ю:"yu", я:"ya", ў:"o'", қ:"q", ғ:"g'", ҳ:"h" };
export function normalizeVoice(text: string): string {
  return text.toLowerCase().replace(/[а-яёўқғҳ]/gu, c => letters[c]).replace(/[‘’ʻʼ`]/g, "'").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
}
/** A wake phrase is a gate, never an instruction to resume after Stop. */
export function voiceCommandText(text: string, wakeOnly = false): string | null {
  const match = text.match(/^\s*(?:(?:ok(?:ay)?|hey|salom|ey|ок(?:ей)?|эй|салом)\s+)?(?:bimo(?:\s+ai)?|бимо(?:\s+(?:аи|ай))?|moshi|моши|qanot(?:\s+ai)?|kanot(?:\s+ai)?|қанот(?:\s+аи)?|канот(?:\s+аи)?|coucou|kuku|куку|kuk(u|o))(?![\p{L}\p{N}_])[\s,.:!-]*(.*)$/iu);
  if (wakeOnly && !match) return null;
  return (match ? match[2] : text).trim() || null;
}
export function parseVoiceIntent(text: string, hasRecipient = false): VoiceIntent {
  if (!text.trim() || text.length > 4000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return { kind: "help" };
  const query = voiceCommandText(text) || text, n = normalizeVoice(query);
  // Exact whole phrases prevent a message body from becoming a UI command.
  const ui: Record<string, VoiceIntent & { kind: "ui" }> = {};
  for (const [target, phrases] of [
    ["panel-open", ["panelni och", "panelni kengaytir", "open panel"]], ["panel-close", ["panelni yop", "panelni ixcham qil", "close panel"]],
    ["settings", ["sozlamalarni och", "sozlamani och", "open settings"]], ["studio", ["studioni och", "ai ni och", "open studio"]],
    ["telegram", ["telegramni och", "telegramni ko'rsat", "open telegram"]], ["terminal", ["terminalni och", "cmd ni och", "powershellni och", "open terminal"]],
    ["desktop", ["kompyuter boshqaruvini och", "desktopni och", "open desktop"]], ["stop", ["to'xta", "hammasini to'xtat", "stop", "bekor qil"]],
  ] as const) for (const phrase of phrases) ui[phrase] = { kind: "ui", target };
  if (ui[n]) return ui[n];
  if (isTelegramCommand(query, hasRecipient) && !telegramRequestNeedsClarification(query)) return { kind: "telegram", query };
  if (["github holatini ko'rsat", "github holati", "github status"].includes(n)) return { kind: "github", operation: "status" };
  if (["repolarimni ko'rsat", "github repolarim", "my repositories"].includes(n)) return { kind: "github", operation: "repos" };
  if (["soat necha", "vaqtni ko'rsat", "what time is it"].includes(n)) return { kind: "terminal", shell: "powershell", script: "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'" };
  if (["windows versiyasini ko'rsat", "windows versiyasi"].includes(n)) return { kind: "terminal", shell: "cmd", script: "ver" };
  const script = query.match(/^(cmd|powershell)\s*(?:da|orqali)?\s*[:—-]\s*([\s\S]+)$/iu);
  if (script) return { kind: "terminal", shell: script[1].toLowerCase() as "cmd" | "powershell", script: script[2] };
  if (/\b(?:cmd|powershell|terminal)\b/.test(n)) return { kind: "plan", domain: "terminal", task: query };
  if (/\bgithub\b/.test(n)) return { kind: "plan", domain: "github", task: query };
  if (/kompyuter|desktop|sichqon|oyna|tugma/.test(n)) return { kind: "plan", domain: "desktop", task: query };
  return { kind: "help" };
}

export interface VoiceTransport { status(): Promise<unknown>; transcribe(args: Record<string, unknown>): Promise<unknown>; cancel(): Promise<unknown> }
export interface VoiceStatus { available: boolean; halted: boolean; busy: boolean; model: string; models_by_language: Partial<Record<VoiceLanguage, string>>; tts_available: boolean; reason: string }
export class VoiceController {
  status: VoiceStatus | null = null; text = ""; error = ""; busy = false; private generation = 0; private cancelling: Promise<unknown> = Promise.resolve();
  private transport: VoiceTransport; private changed: () => void;
  constructor(transport: VoiceTransport, changed: () => void = () => {}) { this.transport=transport;this.changed=changed; }
  async refresh() {
    const generation = this.generation;
    try {
      const r = await this.transport.status() as Record<string, unknown>;
      if (generation !== this.generation) return;
      if (r?.ok !== true || r.voice_api !== 1 || typeof r.available !== "boolean") throw new Error("Ovoz xizmati holati yaroqsiz");
      const models: Partial<Record<VoiceLanguage, string>> = {};
      if (r.models_by_language && typeof r.models_by_language === "object" && !Array.isArray(r.models_by_language)) {
        for (const language of ["uz", "en", "ru"] as const) {
          const model = (r.models_by_language as Record<string, unknown>)[language];
          if (typeof model === "string" && model.length > 0 && model.length <= 128) models[language] = model;
        }
      }
      this.status = { available:r.available, halted:r.halted === true, busy:r.busy === true, model:typeof r.model === "string" ? r.model : "", models_by_language:models, tts_available:r.tts_available === true, reason:typeof r.reason === "string" ? r.reason : "" };
      this.error = "";
    } catch (e) { if (generation !== this.generation) return; this.status = null; this.error = String(e instanceof Error ? e.message : e); }
    this.changed();
  }
  async transcribe(wav: Uint8Array, language: VoiceLanguage): Promise<string | null> {
    if (this.busy || !this.status?.available || this.status.halted) return null;
    const generation = this.generation; this.busy = true; this.text = ""; this.error = ""; this.changed();
    try {
      await this.cancelling;
      if (generation !== this.generation) return null;
      const r = await this.transport.transcribe({ audio_base64:audioBase64(wav), language, request_id:globalThis.crypto.randomUUID() }) as Record<string, unknown>;
      if (generation !== this.generation) return null;
      if (r?.ok !== true || r.voice_api !== 1 || r.execution_performed !== false || typeof r.text !== "string" || r.text.length > 4000 || r.language !== language) throw new Error("Nutq natijasi yaroqsiz");
      this.text = r.text.trim(); return this.text;
    } catch (e) { if (generation === this.generation) this.error = String(e instanceof Error ? e.message : e); return null; }
    finally { if (generation === this.generation) { this.busy = false; this.changed(); } }
  }
  invalidate() { this.generation++; this.text = ""; this.error = ""; this.busy = false; this.cancelling = this.cancelling.then(() => this.transport.cancel()).catch(() => {}); this.changed(); }
}
export function audioBase64(bytes: Uint8Array): string {
  if (bytes.length > 480044) throw new Error("Yozuv 15 soniyadan oshmasin");
  let value = ""; for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return btoa(value);
}
/** Average samples into 16 kHz rather than keeping a single sample (aliasing). */
export function pcmWav(samples: Float32Array, rate: number): Uint8Array {
  if (!Number.isFinite(rate) || rate < 16000 || rate > 192000 || !samples.length || samples.length / rate > 15) throw new Error("Audio formati yoki davomiyligi noto‘g‘ri");
  const count = Math.floor(samples.length * 16000 / rate), result = new Uint8Array(44 + count * 2), view = new DataView(result.buffer);
  const word = (offset: number, value: string) => [...value].forEach((c,i) => view.setUint8(offset+i,c.charCodeAt(0)));
  word(0,"RIFF"); view.setUint32(4,36+count*2,true); word(8,"WAVE"); word(12,"fmt "); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,16000,true); view.setUint32(28,32000,true); view.setUint16(32,2,true); view.setUint16(34,16,true); word(36,"data"); view.setUint32(40,count*2,true);
  for (let i=0;i<count;i++) { const start=Math.floor(i*rate/16000),end=Math.max(start+1,Math.floor((i+1)*rate/16000)); let sample=0;
    for (let j=start;j<end && j<samples.length;j++) sample+=Number.isFinite(samples[j])?samples[j]:0;
    sample=Math.max(-1,Math.min(1,sample/(end-start))); view.setInt16(44+i*2,sample<0?Math.round(sample*32768):Math.round(sample*32767),true); }
  return result;
}
