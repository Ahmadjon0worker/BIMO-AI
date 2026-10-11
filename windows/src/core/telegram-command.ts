import { accountChatID, parseAccountDraft, parseAccountSend, type AccountDraft, type AccountSend } from "./telegram-account";

export interface TelegramRecipient {
  chat_id: string; title: string; kind: "user" | "group" | "channel";
  username: string | null; is_self: boolean;
}
export interface TelegramPreview {
  kind: "preview"; text: string; preview: AccountDraft; recipient: TelegramRecipient; source: "literal" | "draft";
}
export type TelegramCommand = TelegramPreview | { kind: "clarification" | "chat"; text: string };
export interface TelegramCommandTransport { send(id: string): Promise<unknown>; cancel(id: string): Promise<unknown> }

const invalid = () => new Error("The Telegram action could not be verified. Nothing was sent.");
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function bounded(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw invalid();
  return value;
}
export function parseTelegramRecipient(value: unknown): TelegramRecipient {
  const data = record(value), title = bounded(data.title, 1000);
  const username = data.username === null ? null : bounded(data.username, 32);
  if (!title.trim() || !["user", "group", "channel"].includes(String(data.kind)) || typeof data.kind !== "string"
    || username !== null && !/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(username) || typeof data.is_self !== "boolean"
    || data.is_self && data.kind !== "user") throw invalid();
  return { chat_id: accountChatID(data.chat_id), title, kind: data.kind as TelegramRecipient["kind"], username, is_self: data.is_self };
}
export function parseTelegramCommand(value: unknown): TelegramCommand {
  try {
    const data = record(value), text = bounded(data.text, 2000);
    if (data.kind === "clarification" || data.kind === "chat") {
      if (!text.trim() || "preview" in data || "recipient" in data) throw invalid();
      return { kind: data.kind, text };
    }
    if (data.kind !== "preview" || !["literal", "draft"].includes(String(data.source))) throw invalid();
    const recipient = parseTelegramRecipient(data.recipient), preview = parseAccountDraft(data.preview, recipient.chat_id);
    if (preview.recipient !== recipient.title || preview.expires_in > 120 || preview.text.includes("\0")) throw invalid();
    return { kind: "preview", text, preview, recipient, source: data.source as TelegramPreview["source"] };
  } catch { throw invalid(); }
}

/** A gate for explicit messaging requests. It never extracts or rewrites the message. */
export function isTelegramCommand(query: string, hasRecipient = false): boolean {
  const intent = normalizeIntent(intentOnly(query));
  const reply = /\b(?:javob\s+ber(?:ing|gin|sin)?|yoz(?:ing|gin|sin|aver(?:sin|ing)?|ib\s*ber(?:ing|gin|sin)?)?)\b/iu.test(intent);
  const negativeReply = /\b(?:yoz(?:ma|mang|may|masin)|javob\s+ber(?:ma|mang|may|masin))\b/iu.test(intent);
  const action = reply || negativeReply || /(?:yubor|jo[‘’'`ʻʼ]?nat|jonat|tayyorla|\bqoralama\b|\b(?:send|message|draft|write|prepare)\b|отправ|напиш|черновик|подготов|состав)/iu.test(intent);
  const destination = /(?:^|[\s(\[,])@[A-Za-z][A-Za-z0-9_]{3,31}\b/u.test(intent)
    || /\b(?:shunga|unga|bunga|shu\s+chatga|o[‘’'`ʻʼ]?shanga|ularga|to\s+(?:him|her|them))\b|(?:ему|ей|туда)/iu.test(intent);
  const explicitSend = explicitSendRequested(intent);
  const telegram = /\btelegram(?:da|ga|dan|dagi)?\b/iu.test(intent);
  const namedTelegramRecipient = /\btelegramda\s+(?:[^\s]{1,60}ga\b|[^\n]{1,80}?\s+ga\b)/iu.test(intent);
  return action && (destination || namedTelegramRecipient || explicitSend && (telegram || hasRecipient));
}
export function telegramExplicitReviewRequested(query: string): boolean {
  const intent = normalizeIntent(intentOnly(query));
  return !explicitSendRequested(intent) && /\b(?:qoralama|draft|preview)\b|черновик|предпросмотр/iu.test(intent);
}
function explicitSendRequested(intent: string): boolean {
  return /\b(?:yubor(?:ing|gin|sin|sang|sangiz|ib\s*ber|vor|aver|avering|aversin)?|jo[‘’'`ʻʼ]?nat(?:ing|gin|sin|sang|ib\s*ber)?|jonat(?:ing|sin|sang)?|send)\b|(?:отправь(?:те)?|отправляй(?:те)?)/iu.test(intent);
}
function intentOnly(query: string): string {
  const closers: Record<string, string> = { '"': '"', "“": "”", "«": "»", "`": "`", "'": "'", "‘": "’" };
  const word = (character: string | undefined) => !!character && /[\p{L}\p{N}]/u.test(character);
  let masked = "", from = 0;
  for (let start = 0; start < query.length; start++) {
    const opener = query[start], closer = closers[opener];
    if (!closer || (opener === "'" || opener === "‘") && word(query[start - 1])) continue;
    for (let end = start + 1; end < query.length; end++) {
      if (query[end] !== closer || (closer === "'" || closer === "’") && word(query[end - 1]) && word(query[end + 1])) continue;
      masked += query.slice(from, start) + " "; from = end + 1; start = end; break;
    }
  }
  return masked + query.slice(from);
}
function normalizeIntent(query: string): string {
  const letters: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "'", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o'", қ: "q", ғ: "g'", ҳ: "h" };
  const original = query.toLowerCase();
  return `${original} ${original.replace(/[а-яёўқғҳ]/gu, (letter) => letters[letter])}`;
}
export function telegramRequestNeedsClarification(query: string): boolean {
  const intent = normalizeIntent(intentOnly(query));
  // The message itself may contain a question or a negative phrase. A clear
  // closing directive lets the backend parse the exact body before classifying.
  if (/(?:yubor(?:ing|sin|sang|aver|avering|aversin|ib\s+ber)?|jo[‘’'`ʻʼ]?nat(?:ing|sin)?|jonat(?:ing|sin)?|yoz(?:ing|gin|sin|aver(?:sin|ing)?|ib\s*ber(?:ing|gin|sin)?)?|\bsend)\s*[.!]*$/iu.test(intent)) return false;
  if (/\bhaqida\b/iu.test(intent) && /\bjavob\s+ber(?:ing|gin|sin)?\s*[.!]*$/iu.test(intent)) return false;
  return /(?:yuborma|yubormang|jo[‘’'`ʻʼ]?natma|jonatma|yozma|javob\s+ber(?:ma|mang|may|masin)|\b(?:do\s+not|don't|don’t|never)\s+(?:send|message)|не\s+(?:отправ|пиши))/iu.test(intent)
    || /(?:\?|\b(?:qanday|nega|nima\s+uchun|how|why|можно\s+ли|как)\b)/iu.test(intent);
}
export function telegramUsesMessageReference(query: string): boolean {
  return /\b(?:shuni|buni|o[‘’'`ʻʼ]?shani|shu\s+(?:javobni|matnni|xabarni|habarni)|(?:oxirgi|oldingi)\s+javobni|this\s+(?:reply|text|message)|send\s+(?:this|it))\b|(?:это|этот\s+(?:текст|ответ))/iu.test(normalizeIntent(intentOnly(query)));
}

/** An approval is private, short-lived and consumed before the one send request. */
export class TelegramActionController {
  snapshot: { preview: TelegramPreview | null; expiresAt: number; pending: boolean; result: AccountSend | null; error: string } = {
    preview: null, expiresAt: 0, pending: false, result: null, error: "",
  };
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private uncertain = new Map<string, AccountSend>();
  private transport: TelegramCommandTransport;
  private changed: () => void;
  constructor(transport: TelegramCommandTransport, changed: () => void = () => {}) { this.transport = transport; this.changed = changed; }
  private cancelID(id: string) { void this.transport.cancel(id).catch(() => {}); }
  private clearTimer() { if (this.expiryTimer !== null) clearTimeout(this.expiryTimer); this.expiryTimer = null; }
  discardResponse(value: unknown): void {
    try { const result = parseTelegramCommand(value); if (result.kind === "preview") this.cancelID(result.preview.id); } catch { /* No trustworthy ID. */ }
  }
  accept(result: TelegramPreview): void {
    if (this.snapshot.pending) { this.cancelID(result.preview.id); return; }
    const draft = result.preview;
    const key = JSON.stringify([draft.chat_id, draft.text, draft.reply_to_id ?? null]);
    const prior = this.uncertain.get(key) || (this.uncertain.size >= 32 ? [...this.uncertain.values()].at(-1) : undefined);
    if (prior) {
      this.cancelID(draft.id);
      this.invalidate(); this.snapshot.result = prior;
      this.snapshot.error = "The send result is unknown. Check Telegram before composing another message.";
      this.changed(); return;
    }
    this.invalidate();
    this.snapshot.preview = result; this.snapshot.expiresAt = Date.now() + result.preview.expires_in * 1000;
    this.snapshot.error = ""; this.snapshot.result = null;
    this.expiryTimer = setTimeout(() => this.expire(), result.preview.expires_in * 1000);
    // Node's synthetic UI tests do not need to stay open for the preview TTL.
    (this.expiryTimer as unknown as { unref?: () => void }).unref?.();
    this.changed();
  }
  expire(): void {
    if (!this.snapshot.preview || Date.now() < this.snapshot.expiresAt) return;
    this.invalidate(); this.snapshot.error = "The draft expired. Prepare and review a new draft."; this.changed();
  }
  invalidate(): void {
    const preview = this.snapshot.preview; this.snapshot.preview = null; this.snapshot.expiresAt = 0; this.clearTimer();
    if (preview) this.cancelID(preview.preview.id);
    if (!this.snapshot.pending && this.snapshot.result?.status !== "unknown") this.snapshot.result = null;
    this.snapshot.error = ""; this.changed();
  }
  cancel(): void {
    const draft = this.snapshot.preview?.preview;
    this.invalidate();
    if (draft) this.snapshot.result = { id: draft.id, chat_id: draft.chat_id, status: "cancelled", message_id: null };
    this.changed();
  }
  acknowledgeUnknown(): void {
    if (this.snapshot.pending || this.snapshot.result?.status !== "unknown") return;
    const result = this.snapshot.result;
    for (const [key, prior] of this.uncertain) if (prior.id === result.id) this.uncertain.delete(key);
    this.snapshot.result = null; this.snapshot.error = ""; this.changed();
  }
  async send(): Promise<void> {
    if (this.snapshot.pending) return;
    const draft = this.snapshot.preview?.preview;
    if (!draft || Date.now() >= this.snapshot.expiresAt) { this.expire(); return; }
    this.snapshot.preview = null; this.snapshot.expiresAt = 0; this.clearTimer(); this.snapshot.pending = true; this.snapshot.error = "";
    // Keep uncertainty visible even if the window closes before the reply.
    this.snapshot.result = { id: draft.id, chat_id: draft.chat_id, status: "unknown", message_id: null }; this.changed();
    const key = JSON.stringify([draft.chat_id, draft.text, draft.reply_to_id ?? null]);
    this.uncertain.set(key, this.snapshot.result);
    // Acceptance blocks new sends at capacity until an explicit acknowledgement;
    // unresolved signatures are never evicted to enable a duplicate later.
    try {
      this.snapshot.result = parseAccountSend(await this.transport.send(draft.id), draft);
      if (this.snapshot.result.status !== "unknown") this.uncertain.delete(key);
    }
    catch { /* The consumed preview must never become a retry button. */ }
    finally { this.snapshot.pending = false; this.changed(); }
  }
}
