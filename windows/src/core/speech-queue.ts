import type { VoiceLanguage } from "./voice";

export interface SpeechAdapter<T> {
  /** Return inert audio data. Allocate playback resources only inside play. */
  synthesize(text: string, language: VoiceLanguage): Promise<T>;
  play(audio: T, signal: AbortSignal): Promise<void>;
}
export interface SpeechQueueState { active: boolean; speaking: boolean; remaining: number; error: string }

/** Ear-first, bounded sentence queue; code blocks are shown rather than read aloud. */
export function speechSentences(message: string): string[] {
  const plain = message.slice(0, 8000).replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[\s]*[>#*-]+\s*/gm, "").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  const result: string[] = [];
  for (const sentence of plain.match(/.+?(?:[.!?]+(?=\s|$)|$)/gu) || []) {
    let rest = sentence.trim();
    while (rest && result.length < 24) {
      let end = Math.min(rest.length, 360);
      if (rest.length > end) { const space = rest.lastIndexOf(" ", end); if (space > 180) end = space; }
      // Never cut a UTF-16 surrogate pair in a spoken chunk.
      if (end < rest.length && /[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
      result.push(rest.slice(0, end).trim()); rest = rest.slice(end).trim();
    }
  }
  return result;
}

function untilCancelled<T>(work: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); resolve(null); };
    signal.addEventListener("abort", abort, { once: true });
    work.then(value => { signal.removeEventListener("abort", abort); resolve(signal.aborted ? null : value); },
      error => { signal.removeEventListener("abort", abort); if (signal.aborted) resolve(null); else reject(error); });
  });
}

/** Synthesize one sentence ahead while the current sentence plays; cancel never replays a late reply. */
export class SentenceSpeechQueue<T> {
  state: SpeechQueueState = { active: false, speaking: false, remaining: 0, error: "" };
  private generation = 0;
  private abort: AbortController | null = null;
  private adapter: SpeechAdapter<T>; private changed: () => void;
  constructor(adapter: SpeechAdapter<T>, changed: () => void = () => {}) { this.adapter = adapter; this.changed = changed; }
  cancel(): void {
    ++this.generation; this.abort?.abort(); this.abort = null;
    this.state = { active: false, speaking: false, remaining: 0, error: "" }; this.changed();
  }
  async speak(message: string, language: VoiceLanguage): Promise<boolean> {
    this.cancel();
    const sentences = speechSentences(message);
    if (!sentences.length) return false;
    const generation = this.generation, signal = (this.abort = new AbortController()).signal;
    this.state = { active: true, speaking: false, remaining: sentences.length, error: "" }; this.changed();
    // Catch a prefetch failure immediately, even while play is still in progress.
    const prepare = (text: string) => Promise.resolve().then(() => this.adapter.synthesize(text, language))
      .then(audio => ({ audio, error: null }), error => ({ audio: null, error }));
    let next = prepare(sentences[0]);
    try {
      for (let index = 0; index < sentences.length; index++) {
        const prepared = await untilCancelled(next, signal);
        if (!prepared || signal.aborted) return false;
        if (prepared.error || prepared.audio === null) throw prepared.error || new Error("Ovoz tayyorlanmadi");
        if (index + 1 < sentences.length) next = prepare(sentences[index + 1]);
        this.state.speaking = true; this.state.remaining = sentences.length - index; this.changed();
        const played = await untilCancelled(this.adapter.play(prepared.audio, signal).then(() => true), signal);
        if (!played || signal.aborted) return false;
        this.state.speaking = false; this.state.remaining--; this.changed();
      }
      return true;
    } catch (error) {
      if (generation === this.generation) this.state.error = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      if (generation === this.generation) { this.abort = null; this.state.active = false; this.state.speaking = false; this.state.remaining = 0; this.changed(); }
    }
  }
}

/** eSpeak NG's existing local WAV endpoint, with no cloud TTS or browser speech service. */
export function createWavSpeechAdapter(transport: (args: Record<string, unknown>) => Promise<unknown>): SpeechAdapter<Uint8Array> {
  return {
    async synthesize(text, language) {
      const raw = await transport({ text, language }) as Record<string, unknown>;
      if (raw?.ok !== true || raw.voice_api !== 1 || raw.execution_performed !== false || raw.language !== language || raw.format !== "wav" || typeof raw.audio_base64 !== "string" || raw.audio_base64.length > 1400000
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.audio_base64)) throw new Error("Ovoz javobi yaroqsiz");
      const bytes = Uint8Array.from(atob(raw.audio_base64), character => character.charCodeAt(0));
      if (bytes.length < 44 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.subarray(8, 12)) !== "WAVE") throw new Error("WAV javobi yaroqsiz");
      return bytes;
    },
    play(bytes, signal) {
      if (signal.aborted) return Promise.resolve();
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "audio/wav" }));
      const audio = new Audio(url);
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: unknown) => {
          if (settled) return; settled = true;
          clearTimeout(timer); signal.removeEventListener("abort", abort);
          audio.onended = null; audio.onerror = null; audio.onpause = null;
          audio.pause(); audio.removeAttribute?.("src"); URL.revokeObjectURL(url);
          error ? reject(error) : resolve();
        };
        const abort = () => finish();
        const timer = setTimeout(() => finish(new Error("Ovoz ijrosi tugamadi")), 45000);
        signal.addEventListener("abort", abort, { once: true });
        audio.onended = () => finish(); audio.onpause = () => finish(); audio.onerror = () => finish(new Error("Ovoz ijro etilmadi"));
        try { void audio.play().catch(finish); } catch (error) { finish(error); }
      });
    },
  };
}
