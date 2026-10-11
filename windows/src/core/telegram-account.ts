/** Personal account data is loaded only by explicit user requests. */
export const ACCOUNT_STATES = ["disconnected", "connecting", "code_required", "password_required", "authorized", "error"] as const;
export interface AccountStatus {
  available: boolean; configured: boolean; api_id: number | null;
  state: typeof ACCOUNT_STATES[number]; authorized: boolean; busy: boolean;
  has_saved_session: boolean; username: string | null; dialog_count: number;
  selected_chat_id: string | null; last_error: string | null;
  stop_complete?: boolean; teardown_pending?: boolean;
  connected?: boolean; session_epoch?: number;
}
export interface AccountChat { chat_id: string; title: string; kind: "user" | "group" | "channel"; unread_count: number; can_send: boolean; username?: string | null; is_self?: boolean }
export interface AccountMessage { id: number; date: string; sender_id: string | null; text: string; out: boolean;
  sender_name?: string | null; media_kind?: string | null; reply_to_id?: number | null; truncated?: boolean }
export interface AccountDraft { id: string; chat_id: string; recipient: string; text: string; expires_in: number; approval_required: true;
  reply_to_id?: number; session_epoch?: number; ai?: { provider: string | null; model: string | null } }
export interface AccountSend { id: string; chat_id: string; status: "sent" | "unknown" | "cancelled"; message_id: number | null;
  reply_to_id?: number; session_epoch?: number }
export type AccountChatFilter = "all" | "unread" | "users" | "groups" | "channels";
export interface AccountChatQuery { limit?: number; cursor?: string; query?: string; filter?: AccountChatFilter }
export interface AccountMessageQuery { limit?: number; before_id?: number; query?: string }
export interface AccountChatPage { chats: AccountChat[]; next_cursor: string | null; has_more: boolean; query: string; filter: AccountChatFilter; session_epoch?: number }
export interface AccountMessagePage { title: string; messages: AccountMessage[]; before_id: number | null; has_more: boolean; query: string; session_epoch?: number }
export interface AccountConfig { api_id: number; api_hash: string }
export type AccountVerify = { code: string; password?: never } | { password: string; code?: never };
export interface AccountTransport {
  status(): Promise<unknown>;
  configure(config: AccountConfig): Promise<unknown>;
  connect(phone?: string): Promise<unknown>;
  verify(input: AccountVerify): Promise<unknown>;
  disconnect(): Promise<unknown>;
  chats(options?: AccountChatQuery): Promise<unknown>;
  messages(chatID: string, options?: AccountMessageQuery): Promise<unknown>;
  draft(chatID: string, instruction: string, replyToID?: number): Promise<unknown>;
  send(id: string): Promise<unknown>;
  compose?(chatID: string, text: string, replyToID?: number): Promise<unknown>;
  resolve?(recipient: string): Promise<unknown>;
  cancel?(id: string): Promise<unknown>;
}
const invalid = () => new Error("Invalid personal Telegram status.");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1000): string {
  if (typeof value !== "string" || value.length > max) throw invalid();
  return value;
}
function nullable(value: unknown, max = 1000): string | null { return value == null ? null : text(value, max); }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw invalid();
  return Number(value);
}
export function accountChatID(value: unknown): string {
  const id = text(value, 24);
  if (!/^-?[1-9]\d*$/.test(id)) throw invalid();
  return id;
}
export function parseAccountStatus(value: unknown): AccountStatus {
  const data = object(value);
  if ([data.available, data.configured, data.authorized, data.busy, data.has_saved_session].some((item) => typeof item !== "boolean")
    || typeof data.state !== "string" || !ACCOUNT_STATES.includes(data.state as AccountStatus["state"])) throw invalid();
  const result: AccountStatus = { available: data.available as boolean, configured: data.configured as boolean,
    api_id: data.api_id == null ? null : integer(data.api_id, 1, 2147483647), state: data.state as AccountStatus["state"],
    authorized: data.authorized as boolean, busy: data.busy as boolean, has_saved_session: data.has_saved_session as boolean,
    username: nullable(data.username, 100), dialog_count: integer(data.dialog_count),
    selected_chat_id: data.selected_chat_id == null ? null : accountChatID(data.selected_chat_id), last_error: nullable(data.last_error, 500) };
  for (const flag of ["stop_complete", "teardown_pending", "connected"] as const) {
    if (data[flag] != null) { if (typeof data[flag] !== "boolean") throw invalid(); result[flag] = data[flag]; }
  }
  if (data.session_epoch != null) result.session_epoch = integer(data.session_epoch);
  return result;
}
export function parseAccountChats(value: unknown): AccountChat[] {
  const data = object(value);
  if (data.limit !== 30 || !Array.isArray(data.chats) || data.chats.length > 30) throw invalid();
  const seen = new Set<string>();
  return data.chats.map((value) => {
    const chat = object(value), id = accountChatID(chat.chat_id);
    if (seen.has(id) || !["user", "group", "channel"].includes(String(chat.kind)) || typeof chat.kind !== "string" || typeof chat.can_send !== "boolean") throw invalid();
    seen.add(id);
    const result: AccountChat = { chat_id: id, title: text(chat.title, 1000), kind: chat.kind as AccountChat["kind"],
      unread_count: integer(chat.unread_count), can_send: chat.can_send };
    if ("username" in chat) { result.username = nullable(chat.username, 32); if (result.username && !/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(result.username)) throw invalid(); }
    if ("is_self" in chat) { if (typeof chat.is_self !== "boolean" || chat.is_self && result.kind !== "user") throw invalid(); result.is_self = chat.is_self; }
    return result;
  });
}
export function parseAccountMessages(value: unknown, chatID: string, limit = 20): { title: string; messages: AccountMessage[] } {
  const data = object(value);
  if (accountChatID(data.chat_id) !== chatID || data.limit !== limit || !Array.isArray(data.messages) || data.messages.length > limit || ![20, 50].includes(limit)) throw invalid();
  const seen = new Set<number>();
  return { title: text(data.title), messages: data.messages.map((value) => {
    const message = object(value), date = text(message.date, 100);
    if (!/^\d{4}-\d\d-\d\dT/.test(date) || Number.isNaN(Date.parse(date)) || typeof message.out !== "boolean") throw invalid();
    const result: AccountMessage = { id: integer(message.id, 1), date, sender_id: message.sender_id == null ? null : accountChatID(message.sender_id),
      text: text(message.text, 16000), out: message.out };
    if (seen.has(result.id)) throw invalid(); seen.add(result.id);
    if ("sender_name" in message) result.sender_name = nullable(message.sender_name, 256);
    if ("media_kind" in message) { result.media_kind = nullable(message.media_kind, 20); if (result.media_kind && !["photo", "video", "voice", "audio", "sticker", "document", "contact", "location", "poll", "other"].includes(result.media_kind)) throw invalid(); }
    if ("reply_to_id" in message) result.reply_to_id = message.reply_to_id == null ? null : integer(message.reply_to_id, 1);
    if ("truncated" in message) { if (typeof message.truncated !== "boolean") throw invalid(); result.truncated = message.truncated; }
    return result;
  }) };
}
export function parseAccountChatPage(value: unknown): AccountChatPage {
  const data = object(value), chats = parseAccountChats(value);
  const next_cursor = nullable(data.next_cursor, 128), has_more = data.has_more ?? false;
  if (typeof has_more !== "boolean" || has_more && !next_cursor || next_cursor === "" || next_cursor?.includes("\0")) throw invalid();
  const filter = data.filter ?? "all";
    if (typeof filter !== "string" || !["all", "unread", "users", "groups", "channels"].includes(filter)) throw invalid();
  return { chats, next_cursor, has_more, query: text(data.query ?? "", 100), filter: filter as AccountChatFilter,
    ...(data.session_epoch == null ? {} : { session_epoch: integer(data.session_epoch) }) };
}
export function parseAccountMessagePage(value: unknown, chatID: string): AccountMessagePage {
  const data = object(value), result = parseAccountMessages(value, chatID, data.session_epoch == null && data.limit === 20 ? 20 : 50);
  const before_id = data.before_id == null ? null : integer(data.before_id, 1), has_more = data.has_more ?? false;
  if (typeof has_more !== "boolean" || has_more && before_id == null) throw invalid();
  return { ...result, before_id, has_more, query: text(data.query ?? "", 100),
    ...(data.session_epoch == null ? {} : { session_epoch: integer(data.session_epoch) }) };
}
export function validTelegramText(value: string, max = 4000): boolean {
  if (!value.trim() || value.length > max || value.includes("\0")) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const low = value.charCodeAt(++index); if (!(low >= 0xdc00 && low <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
export function parseAccountDraft(value: unknown, chatID: string): AccountDraft {
  const data = object(value), id = text(data.id, 128), body = text(data.text, 4000);
  if (!/^[A-Za-z0-9_-]+$/.test(id) || !validTelegramText(body) || accountChatID(data.chat_id) !== chatID || data.approval_required !== true) throw invalid();
  const result: AccountDraft = { id, chat_id: chatID, recipient: text(data.recipient), text: body,
    expires_in: integer(data.expires_in, 1, 3600), approval_required: true };
  if (data.reply_to_id != null) result.reply_to_id = integer(data.reply_to_id, 1);
  if (data.session_epoch != null) result.session_epoch = integer(data.session_epoch);
  if (data.ai != null) { const ai = object(data.ai); result.ai = { provider: nullable(ai.provider, 100), model: nullable(ai.model, 200) }; }
  return result;
}
export function parseAccountSend(value: unknown, draft: AccountDraft): AccountSend {
  const data = object(value);
  if (data.id !== draft.id || accountChatID(data.chat_id) !== draft.chat_id || typeof data.status !== "string"
    || !["sent", "unknown", "cancelled"].includes(data.status)) throw invalid();
  const messageID = data.message_id == null ? null : integer(data.message_id, 1);
  if (data.status === "sent" && messageID == null) throw invalid();
  if (draft.reply_to_id != null && data.reply_to_id !== draft.reply_to_id || draft.session_epoch != null && data.session_epoch !== draft.session_epoch) throw invalid();
  return { id: draft.id, chat_id: draft.chat_id, status: data.status as AccountSend["status"], message_id: messageID,
    ...(data.reply_to_id == null ? {} : { reply_to_id: integer(data.reply_to_id, 1) }),
    ...(data.session_epoch == null ? {} : { session_epoch: integer(data.session_epoch) }) };
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

type AuthAction = "configure" | "connect" | "verify" | "disconnect";
interface AuthFailure {
  action: AuthAction;
  before: { state: AccountStatus["state"]; configured: boolean; apiID: number | null; authorized: boolean } | null;
  expectedApiID?: number;
  verifyKind?: "code" | "password";
}
const authRank = (state?: AccountStatus["state"]) => state === "authorized" ? 3 : state === "password_required" ? 2 : state === "code_required" ? 1 : 0;
function authRecovered(status: AccountStatus, failure: AuthFailure): boolean {
  if (!status.available || status.busy || status.teardown_pending || status.last_error !== null || status.state === "error"
    || status.authorized !== (status.state === "authorized")) return false;
  const before = failure.before, advanced = authRank(status.state) > authRank(before?.state);
  if (failure.action === "configure") return status.configured && status.api_id === failure.expectedApiID
    && (!before?.configured || before.apiID !== status.api_id || advanced);
  if (before?.apiID != null && status.api_id !== before.apiID) return false;
  if (failure.action === "connect") return status.configured && advanced && authRank(status.state) > 0;
  if (failure.action === "verify") return status.configured && advanced
    && (status.authorized || failure.verifyKind === "code" && status.state === "password_required");
  return status.state === "disconnected" && !status.authorized && status.stop_complete !== false;
}

export class AccountController {
  snapshot: { status: AccountStatus | null; pending: string | null; checking: boolean; error: string; notice: string;
    chats: AccountChat[]; selected: AccountChat | null; messages: AccountMessage[]; messagesLoaded: boolean;
    draft: AccountDraft | null; draftExpiresAt: number; sent: AccountSend | null;
    chatsLoading: boolean; messagesLoading: boolean; aiPending: boolean; chatPage: AccountChatPage | null; messagePage: AccountMessagePage | null } = {
      status: null, pending: null, checking: false, error: "", notice: "", chats: [], selected: null, messages: [], messagesLoaded: false,
      draft: null, draftExpiresAt: 0, sent: null,
      chatsLoading: false, messagesLoading: false, aiPending: false, chatPage: null, messagePage: null,
    };
  private transport: AccountTransport;
  private changed: () => void;
  private generation = 0;
  private statusFlight: Promise<void> | null = null;
  private controlError = false;
  private authFailure: AuthFailure | null = null;
  private chatTicket = 0;
  private messageTicket = 0;
  private aiTicket = 0;
  private prepared = new Map<string, number>();
  private consumed = new Set<string>();
  private unknownAttempts = new Map<string, AccountSend>();
  constructor(transport: AccountTransport, changed: () => void = () => {}) { this.transport = transport; this.changed = changed; }
  private clearContent(): void {
    for (const id of this.prepared.keys()) void this.transport.cancel?.(id).catch(() => {});
    this.prepared.clear();
    this.snapshot.chats = []; this.snapshot.selected = null; this.snapshot.messages = []; this.snapshot.messagesLoaded = false;
    this.snapshot.draft = null; this.snapshot.draftExpiresAt = 0; this.snapshot.sent = null;
    this.snapshot.chatPage = null; this.snapshot.messagePage = null;
    this.snapshot.chatsLoading = false; this.snapshot.messagesLoading = false; this.snapshot.aiPending = false;
    ++this.chatTicket; ++this.messageTicket; ++this.aiTicket;
  }
  invalidate(): void {
    const unknownSend = this.snapshot.sent?.status === "unknown" ? this.snapshot.sent : null;
    ++this.generation; this.snapshot.pending = null; this.clearContent(); this.snapshot.sent = unknownSend; this.changed();
  }
  cancelPrivateRequests(): void {
    ++this.generation; ++this.chatTicket; ++this.messageTicket; ++this.aiTicket;
    this.snapshot.chatsLoading = false; this.snapshot.messagesLoading = false; this.snapshot.aiPending = false;
    if (this.snapshot.draft) this.discardDraft(this.snapshot.draft);
    this.snapshot.draft = null; this.snapshot.draftExpiresAt = 0;
    for (const id of this.prepared.keys()) void this.transport.cancel?.(id).catch(() => {});
    this.prepared.clear();
    // Hide/Stop can revoke preparation, but an attempted delivery stays consumed.
    this.snapshot.pending = null; this.changed();
  }
  select(chatID: string): void {
    if (this.snapshot.pending || this.snapshot.status?.busy) return;
    const chat = this.snapshot.chats.find((item) => item.chat_id === chatID) || null;
    ++this.generation; this.snapshot.selected = chat; this.snapshot.messages = []; this.snapshot.messagesLoaded = false;
    if (this.snapshot.draft) this.discardDraft(this.snapshot.draft);
    this.snapshot.draft = null; if (this.snapshot.sent?.status !== "unknown") this.snapshot.sent = null; this.snapshot.error = "";
    this.snapshot.messagePage = null; this.snapshot.messagesLoading = false; this.snapshot.aiPending = false;
    ++this.messageTicket; ++this.aiTicket;
    this.changed();
  }
  cancelAI(): void { ++this.aiTicket; this.snapshot.aiPending = false; this.changed(); }
  acknowledgeUnknown(): void {
    if (this.snapshot.pending) return;
    if (this.snapshot.sent?.status === "unknown") {
      for (const [key, sent] of this.unknownAttempts) if (sent.id === this.snapshot.sent.id) this.unknownAttempts.delete(key);
      this.snapshot.sent = null;
    }
    this.snapshot.error = ""; this.controlError = false; this.changed();
  }
  private signature(chat: string, body: string, reply?: number): string { return JSON.stringify([chat, body, reply ?? null]); }
  private uncertaintyBlocks(chat: string, body: string, reply?: number): boolean {
    const unresolved = this.unknownAttempts.get(this.signature(chat, body, reply));
    if (unresolved || this.unknownAttempts.size >= 64) {
      this.snapshot.sent = unresolved || [...this.unknownAttempts.values()].at(-1)!;
      this.fail("The send result is unknown. Check Telegram before composing another message."); this.changed(); return true;
    }
    return false;
  }
  private ready(): boolean {
    const status = this.snapshot.status;
    return !!status?.available && status.authorized && status.state === "authorized" && status.connected !== false && !status.busy && !status.teardown_pending;
  }
  private assertEpoch(epoch: number | undefined): void {
    if (this.snapshot.status?.session_epoch != null && epoch !== this.snapshot.status.session_epoch) throw new Error("The Telegram account changed. Reload the chats.");
  }
  private fail(error: unknown): void { this.controlError = true; this.snapshot.error = errorText(error); }
  async loadChats(options: AccountChatQuery = {}, append = false): Promise<void> {
    if (!this.ready() || this.snapshot.pending) return;
    const query = options.query || "", filter = options.filter || "all";
    if (query.length > 100 || query.includes("\0")) { this.fail("Enter a Telegram search of at most 100 characters."); this.changed(); return; }
    const ticket = ++this.chatTicket, generation = this.generation;
    this.snapshot.chatsLoading = true; this.snapshot.error = ""; this.controlError = false; this.changed();
    try {
      const page = parseAccountChatPage(await this.transport.chats({ ...options, limit: 30, query, filter }));
      if (ticket !== this.chatTicket || generation !== this.generation || !this.ready()) return;
      this.assertEpoch(page.session_epoch);
      if (page.query !== query || page.filter !== filter) throw invalid();
      const chats = new Map((append ? this.snapshot.chats : []).map(chat => [chat.chat_id, chat]));
      for (const chat of page.chats) chats.set(chat.chat_id, chat);
      this.snapshot.chats = [...chats.values()]; this.snapshot.chatPage = page;
      if (this.snapshot.selected) this.snapshot.selected = chats.get(this.snapshot.selected.chat_id) || this.snapshot.selected;
    } catch (error) { if (ticket === this.chatTicket && generation === this.generation) this.fail(error); }
    finally { if (ticket === this.chatTicket) { this.snapshot.chatsLoading = false; this.changed(); } }
  }
  async loadMessages(query = "", older = false): Promise<void> {
    const chat = this.snapshot.selected;
    if (!this.ready() || this.snapshot.pending || !chat) return;
    if (query.length > 100 || query.includes("\0")) { this.fail("Enter a Telegram search of at most 100 characters."); this.changed(); return; }
    const before = older ? this.snapshot.messagePage?.before_id : null;
    if (older && (!before || this.snapshot.messagePage?.query !== query)) return;
    const ticket = ++this.messageTicket, generation = this.generation;
    this.snapshot.messagesLoading = true; this.snapshot.error = ""; this.controlError = false;
    if (!older) { this.snapshot.messages = []; this.snapshot.messagesLoaded = false; this.snapshot.messagePage = null; }
    this.changed();
    try {
      const page = parseAccountMessagePage(await this.transport.messages(chat.chat_id, { limit: 50, query, ...(before ? { before_id: before } : {}) }), chat.chat_id);
      if (ticket !== this.messageTicket || generation !== this.generation || this.snapshot.selected?.chat_id !== chat.chat_id || !this.ready()) return;
      this.assertEpoch(page.session_epoch);
      if (page.query !== query) throw invalid();
      const messages = new Map((older ? this.snapshot.messages : []).map(message => [message.id, message]));
      for (const message of page.messages) messages.set(message.id, message);
      this.snapshot.messages = [...messages.values()].sort((a, b) => a.id - b.id);
      this.snapshot.messagesLoaded = true; this.snapshot.messagePage = page;
    } catch (error) { if (ticket === this.messageTicket && generation === this.generation) this.fail(error); }
    finally { if (ticket === this.messageTicket) { this.snapshot.messagesLoading = false; this.changed(); } }
  }
  async resolve(recipient: string): Promise<AccountChat | null> {
    if (!this.ready() || this.snapshot.pending || !this.transport.resolve) return null;
    if (recipient !== "self" && !/^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(recipient)) { this.fail("Enter a Telegram username, for example @username."); this.changed(); return null; }
    const ticket = ++this.chatTicket, generation = this.generation;
    this.snapshot.chatsLoading = true; this.snapshot.error = ""; this.controlError = false; this.changed();
    try {
      const data = object(await this.transport.resolve(recipient));
      if (ticket !== this.chatTicket || generation !== this.generation || !this.ready()) return null;
      this.assertEpoch(data.session_epoch == null ? undefined : integer(data.session_epoch));
      const chat = parseAccountChats({ limit: 30, chats: [data.chat] })[0];
      const chats = new Map(this.snapshot.chats.map(chat => [chat.chat_id, chat])); chats.set(chat.chat_id, chat);
      this.snapshot.chats = [...chats.values()]; this.select(chat.chat_id); return chat;
    } catch (error) { if (ticket === this.chatTicket && generation === this.generation) this.fail(error); return null; }
    finally { if (ticket === this.chatTicket) { this.snapshot.chatsLoading = false; this.changed(); } }
  }
  discardDraft(draft: AccountDraft): void {
    this.prepared.delete(draft.id); void this.transport.cancel?.(draft.id).catch(() => {});
  }
  async prepareAI(instruction: string, replyToID?: number): Promise<AccountDraft | null> {
    const chat = this.snapshot.selected;
    if (!this.ready() || this.snapshot.pending || !chat?.can_send || !this.snapshot.messagesLoaded || !validTelegramText(instruction, 2000)) return null;
    const ticket = ++this.aiTicket, generation = this.generation;
    this.snapshot.aiPending = true; this.snapshot.error = ""; this.controlError = false; this.changed();
    try {
      const draft = parseAccountDraft(await this.transport.draft(chat.chat_id, instruction, replyToID), chat.chat_id);
      if (ticket !== this.aiTicket || generation !== this.generation || !this.ready()) { this.discardDraft(draft); return null; }
      try { this.assertEpoch(draft.session_epoch); if (draft.reply_to_id !== replyToID) throw invalid(); }
      catch (error) { this.discardDraft(draft); throw error; }
      this.prepared.set(draft.id, Date.now() + draft.expires_in * 1000); return draft;
    } catch (error) { if (ticket === this.aiTicket && generation === this.generation) this.fail(error); return null; }
    finally { if (ticket === this.aiTicket) { this.snapshot.aiPending = false; this.changed(); } }
  }
  async composeSend(body: string, replyToID?: number): Promise<AccountSend | null> {
    const chat = this.snapshot.selected;
    if (!this.ready() || this.snapshot.pending || !chat?.can_send || !this.transport.compose) return null;
    if (!validTelegramText(body)) { this.fail("Enter a message of 1–4000 characters."); this.changed(); return null; }
    if (this.uncertaintyBlocks(chat.chat_id, body, replyToID)) return null;
    const generation = ++this.generation;
    this.snapshot.pending = "compose"; this.snapshot.error = ""; this.controlError = false; this.changed();
    try {
      const draft = parseAccountDraft(await this.transport.compose(chat.chat_id, body, replyToID), chat.chat_id);
      if (generation !== this.generation || !this.ready()) { this.discardDraft(draft); return null; }
      try { this.assertEpoch(draft.session_epoch); if (draft.text !== body || draft.reply_to_id !== replyToID) throw invalid(); }
      catch (error) { this.discardDraft(draft); throw error; }
      this.prepared.set(draft.id, Date.now() + draft.expires_in * 1000);
      this.snapshot.pending = null; return await this.sendPrepared(draft);
    } catch (error) { if (generation === this.generation) this.fail(error); return null; }
    finally { if (this.snapshot.pending === "compose" && generation === this.generation) this.snapshot.pending = null; this.changed(); }
  }
  async sendPrepared(draft: AccountDraft): Promise<AccountSend | null> {
    if (!this.ready() || this.snapshot.pending || !this.snapshot.selected?.can_send || draft.chat_id !== this.snapshot.selected.chat_id || this.consumed.has(draft.id)) return null;
    if (this.uncertaintyBlocks(draft.chat_id, draft.text, draft.reply_to_id)) { this.discardDraft(draft); return null; }
    if ((this.prepared.get(draft.id) || 0) <= Date.now()) { this.discardDraft(draft); this.fail("The draft expired. Prepare and review a new draft."); this.changed(); return null; }
    try { this.assertEpoch(draft.session_epoch); } catch (error) { this.discardDraft(draft); this.fail(error); this.changed(); return null; }
    const generation = ++this.generation;
    this.prepared.delete(draft.id); this.consumed.add(draft.id);
    this.snapshot.pending = "send"; this.snapshot.error = ""; this.controlError = false;
    this.snapshot.sent = { id: draft.id, chat_id: draft.chat_id, status: "unknown", message_id: null };
    const signature = this.signature(draft.chat_id, draft.text, draft.reply_to_id);
    this.unknownAttempts.set(signature, this.snapshot.sent); this.changed();
    try {
      const sent = parseAccountSend(await this.transport.send(draft.id), draft);
      if (generation !== this.generation) return null;
      this.snapshot.sent = sent;
      if (sent.status !== "unknown") this.unknownAttempts.delete(signature);
      if (sent.status === "sent" && sent.message_id && !this.snapshot.messagePage?.query) {
        this.snapshot.messages = [...this.snapshot.messages.filter(message => message.id !== sent.message_id),
          { id: sent.message_id, date: new Date().toISOString(), sender_id: null, text: draft.text, out: true, reply_to_id: draft.reply_to_id || null }].sort((a, b) => a.id - b.id);
        this.snapshot.messagesLoaded = true;
      }
      return sent;
    } catch (error) { if (generation === this.generation) this.fail(error); return null; }
    finally { if (generation === this.generation) this.snapshot.pending = null; this.changed(); }
  }
  refresh(): Promise<void> {
    if (this.statusFlight) return this.statusFlight;
    const generation = this.generation;
    this.snapshot.checking = true; this.changed();
    const flight = (async () => {
      try {
        const status = parseAccountStatus(await this.transport.status());
        if (generation !== this.generation || this.snapshot.pending) return;
        const previous = this.snapshot.status;
        if (!status.authorized || previous && (previous.api_id !== status.api_id || previous.username !== status.username || previous.session_epoch != null && previous.session_epoch !== status.session_epoch)) {
          const unknownSend = this.snapshot.sent?.status === "unknown" ? this.snapshot.sent : null;
          this.clearContent();
          // A disconnected or changed cached identity cannot resolve a prior
          // send timeout; an explicit account action clears this warning.
          this.snapshot.sent = unknownSend;
        }
        if (this.snapshot.draft && (this.snapshot.draft.chat_id !== status.selected_chat_id || Date.now() >= this.snapshot.draftExpiresAt)) this.snapshot.draft = null;
        this.snapshot.status = status;
        // A cached status can prove that an uncertain auth request progressed.
        // It cannot clear an unchanged failed code/password or a send outcome.
        if (this.authFailure && authRecovered(status, this.authFailure)) {
          this.authFailure = null; this.controlError = false;
        }
        if (!this.controlError) this.snapshot.error = "";
      } catch (error) {
        if (generation === this.generation && !this.snapshot.pending) {
          const consumedSend = this.snapshot.sent;
          this.snapshot.status = null; this.clearContent();
          // Offline status cannot disprove an attempted send. Keep its outcome
          // visible while dropping cached private content and approvals.
          this.snapshot.sent = consumedSend;
          if (!this.controlError) this.snapshot.error = errorText(error);
        }
      } finally { this.snapshot.checking = false; this.changed(); }
    })();
    this.statusFlight = flight;
    void flight.finally(() => { if (this.statusFlight === flight) this.statusFlight = null; });
    return flight;
  }
  async run(action: "configure" | "connect" | "verify" | "disconnect" | "chats" | "messages" | "draft" | "send",
    input?: AccountConfig | AccountVerify | string): Promise<void> {
    if (this.snapshot.pending && action !== "disconnect" || this.snapshot.pending === action) return;
    const chat = this.snapshot.selected, draft = this.snapshot.draft;
    if ((action === "messages" || action === "draft") && !chat) return;
    if (action === "draft" && (!chat?.can_send || !this.snapshot.messagesLoaded)) return;
    if (action === "send" && (!draft || draft.chat_id !== chat?.chat_id || Date.now() >= this.snapshot.draftExpiresAt)) {
      this.snapshot.draft = null; this.snapshot.error = "The draft expired. Prepare and review a new draft."; this.changed(); return;
    }
    if (action === "send" && draft && this.uncertaintyBlocks(draft.chat_id, draft.text, draft.reply_to_id)) return;
    if (["configure", "connect", "verify", "disconnect"].includes(action)) this.cancelPrivateRequests();
    const generation = ++this.generation;
    const before = this.snapshot.status;
    const authContext: AuthFailure | null = ["configure", "connect", "verify", "disconnect"].includes(action) ? {
      action: action as AuthAction,
      before: before ? { state: before.state, configured: before.configured, apiID: before.api_id, authorized: before.authorized } : null,
      ...(action === "configure" ? { expectedApiID: (input as AccountConfig)?.api_id } : {}),
      ...(action === "verify" ? { verifyKind: "code" in (input as AccountVerify || {}) ? "code" as const : "password" as const } : {}),
    } : null;
    this.snapshot.pending = action; this.snapshot.error = ""; this.snapshot.notice = ""; this.controlError = false; this.authFailure = null;
    // Consume a reviewed ID before effects, including ambiguous network failure.
    if (["send", "draft", "messages", "chats", "configure", "connect", "verify", "disconnect"].includes(action)) this.snapshot.draft = null;
    if (["configure", "connect", "verify", "disconnect"].includes(action)) this.clearContent();
    if (action === "send" && draft) {
      this.snapshot.sent = { id: draft.id, chat_id: draft.chat_id, status: "unknown", message_id: null };
      this.unknownAttempts.set(this.signature(draft.chat_id, draft.text, draft.reply_to_id), this.snapshot.sent);
    }
    this.changed();
    try {
      if (action === "configure" || action === "connect" || action === "verify" || action === "disconnect") {
        const result = action === "configure" ? await this.transport.configure(input as AccountConfig)
          : action === "connect" ? await this.transport.connect(input as string | undefined)
          : action === "verify" ? await this.transport.verify(input as AccountVerify) : await this.transport.disconnect();
        if (generation === this.generation) this.snapshot.status = parseAccountStatus(result);
      } else if (action === "chats") {
        const result = parseAccountChats(await this.transport.chats());
        if (generation === this.generation) { this.snapshot.chats = result; this.snapshot.selected = null; this.snapshot.messages = []; this.snapshot.messagesLoaded = false; }
      } else if (action === "messages") {
        const result = parseAccountMessages(await this.transport.messages(chat!.chat_id), chat!.chat_id);
        if (generation === this.generation) { this.snapshot.messages = result.messages; this.snapshot.messagesLoaded = true; }
      } else if (action === "draft") {
        const result = parseAccountDraft(await this.transport.draft(chat!.chat_id, input as string), chat!.chat_id);
        if (generation === this.generation) { this.snapshot.draft = result; this.snapshot.draftExpiresAt = Date.now() + result.expires_in * 1000; this.snapshot.sent = null; }
      } else {
        const result = parseAccountSend(await this.transport.send(draft!.id), draft!);
        if (generation === this.generation) {
          this.snapshot.sent = result;
          if (result.status !== "unknown") this.unknownAttempts.delete(this.signature(draft!.chat_id, draft!.text, draft!.reply_to_id));
        }
      }
      if (generation === this.generation) this.snapshot.notice = "Personal Telegram status updated.";
    } catch (error) {
      if (generation === this.generation) {
        this.controlError = true; this.snapshot.error = errorText(error);
        this.authFailure = authContext;
        // A timeout or malformed reply cannot establish whether Telegram
        // accepted the message. Keep the consumed ID and show that uncertainty.
        if (action === "send" && draft) this.snapshot.sent = { id: draft.id, chat_id: draft.chat_id, status: "unknown", message_id: null };
      }
    } finally {
      if (generation === this.generation) {
        this.snapshot.pending = null; this.changed();
        if (this.statusFlight) await this.statusFlight;
        if (generation === this.generation) await this.refresh();
      }
    }
  }
}
