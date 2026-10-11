import { h } from "../views/dom";
import { t, tl } from "../i18n/i18n";
import { AccountController, validTelegramText, type AccountChat, type AccountChatFilter, type AccountMessage } from "../core/telegram-account";

/** Explicit reads and sends only; composer text is bound to a chat AND reply. */
export function buildTelegramMessenger(controller: AccountController, chatSelect: HTMLSelectElement,
  selectChat: (id: string) => void, isVisible: () => boolean) {
  const chatSearch = h("input", { id: "account-chat-search", type: "search", maxlength: 100, placeholder: tl("Search chats"), "aria-label": tl("Search chats") });
  const filter = h("select", { id: "account-chat-filter", "aria-label": tl("Chat filter") },
    ...[["all", "All chats"], ["unread", "Unread"], ["users", "People"], ["groups", "Groups"], ["channels", "Channels"]].map(([value, key]) => h("option", { value, text: tl(key) })));
  filter.value = "all";
  const username = h("input", { id: "account-recipient", maxlength: 33, placeholder: "@username", "aria-label": tl("Open Telegram username") });
  const chatRows = h("div", { id: "account-chat-list", class: "messenger-chat-list", "aria-label": tl("Loaded chats") });
  const chatCount = h("span", { class: "hint messenger-count", role: "status" });
  const list = h("button", { id: "account-list-chats", text: tl("Load 30 chats"), onclick: () => {
    if (!list.disabled) void controller.loadChats({ query: chatSearch.value || "", filter: filter.value as AccountChatFilter });
  } });
  const moreChats = h("button", { id: "account-more-chats", class: "secondary", text: tl("Load more chats"), onclick: () => {
    const page = controller.snapshot.chatPage;
    if (!moreChats.disabled && page?.next_cursor) void controller.loadChats({ query: page.query, filter: page.filter, cursor: page.next_cursor }, true);
  } });
  async function openRecipient(recipient: string) {
    const chat = await controller.resolve(recipient);
    if (!chat || !isVisible()) return;
    selectChat(chat.chat_id); await controller.loadMessages();
  }
  const saved = h("button", { id: "account-saved-messages", class: "secondary", text: tl("Saved Messages"), onclick: () => { if (!saved.disabled) void openRecipient("self"); } });
  const open = h("button", { id: "account-open-recipient", class: "secondary", text: tl("Open"), onclick: () => { if (!open.disabled) void openRecipient((username.value || "").trim()); } });
  const title = h("h3", { id: "account-selected-title" });
  const subtitle = h("p", { class: "hint" });
  const messageSearch = h("input", { id: "account-message-search", type: "search", maxlength: 100, placeholder: tl("Search this chat"), "aria-label": tl("Search this chat") });
  const read = h("button", { id: "account-read-messages", class: "secondary", text: tl("Read last 50 messages"), onclick: () => {
    if (!read.disabled) void controller.loadMessages(messageSearch.value || "");
  } });
  const clearSearch = h("button", { id: "account-clear-message-search", class: "secondary", text: tl("Clear search"), onclick: () => {
    if (!clearSearch.disabled) { messageSearch.value = ""; void controller.loadMessages(); }
  } });
  const older = h("button", { id: "account-older-messages", class: "secondary", text: tl("Older messages"), onclick: () => {
    if (!older.disabled) { olderScroll = messages.scrollHeight - messages.scrollTop; void controller.loadMessages(controller.snapshot.messagePage?.query || "", true); }
  } });
  const messages = h("div", { id: "account-messages", class: "messenger-messages", "aria-label": tl("Loaded messages"), tabindex: 0 });
  const historyStatus = h("p", { class: "hint messenger-history-status", role: "status", "aria-live": "polite" });
  const instruction = h("textarea", { id: "account-instruction", rows: 2, maxlength: 2000, placeholder: tl("Tell AI what to write for this chat"), "aria-label": tl("Message draft instruction") });
  const composer = h("textarea", { id: "account-composer", rows: 2, maxlength: 4000, placeholder: tl("Write a message…"), "aria-label": tl("Message to the selected chat") });
  composer.value = ""; instruction.value = "";
  const composerHint = h("span", { class: "hint", id: "account-composer-hint" });
  const replyText = h("span", { id: "account-reply-text" });
  const replyCancel = h("button", { id: "account-cancel-reply", class: "secondary", text: tl("Cancel reply"), onclick: () => {
    if (!replyCancel.disabled) setReply(null);
  } });
  const replyBanner = h("div", { class: "messenger-reply", id: "account-reply-banner" }, replyText, replyCancel);
  const aiProvider = h("span", { id: "account-ai-provider", class: "hint" });
  const review = h("div", { class: "account-draft-preview", "aria-live": "polite" });
  const acknowledge = h("button", { id: "account-check-unknown", class: "secondary", text: tl("I checked Telegram"), onclick: () => {
    if (!acknowledge.disabled) controller.acknowledgeUnknown();
  } });
  const draftCache = new Map<string, string>();
  let binding = "", reply: AccountMessage | null = null, revision = 0, summaryOnly = false, accountIdentity = "";
  let listKey = "", messageKey = "", reviewKey = "", olderScroll: number | null = null;
  const contextKey = () => `${controller.snapshot.selected?.chat_id || ""}:${reply?.id || ""}`;
  function remember() {
    if (!binding) return;
    if (composer.value) draftCache.set(binding, composer.value); else draftCache.delete(binding);
    // Bounded, in-memory drafts; never persist private text to disk.
    while (draftCache.size > 50) draftCache.delete(draftCache.keys().next().value!);
  }
  function setReply(message: AccountMessage | null) {
    remember(); reply = message; binding = contextKey(); composer.value = draftCache.get(binding) || "";
    ++revision; aiProvider.textContent = ""; controller.cancelAI(); sync(); composer.focus();
  }
  function selectionChanged() {
    const selected = controller.snapshot.selected?.chat_id || "";
    if (binding.split(":")[0] === selected) return;
    remember(); reply = null; binding = contextKey(); composer.value = draftCache.get(binding) || "";
    messageSearch.value = ""; instruction.value = ""; summaryOnly = false; aiProvider.textContent = ""; ++revision;
  }
  function capture() { return { binding, revision, text: composer.value, replyID: reply?.id }; }
  function unchanged(before: ReturnType<typeof capture>) { return isVisible() && before.binding === binding && before.revision === revision; }
  async function sendMessage() {
    if (send.disabled) return;
    // Existing reviewed API proofs remain compatible, but ordinary typed sends
    // prepare and consume their own immutable one-use proof in one action.
    if (!composer.value && controller.snapshot.draft) { await controller.run("send"); return; }
    const before = capture(), result = await controller.composeSend(before.text, before.replyID);
    if (result?.status === "sent" && unchanged(before)) {
      composer.value = ""; draftCache.delete(binding); ++revision; sync();
    }
  }
  const send = h("button", { id: "account-send", text: tl("Send message"), onclick: () => void sendMessage() });
  async function generate(andSend = false) {
    if (draft.disabled || andSend && (aiSend.disabled || summaryOnly)) return;
    if (!validTelegramText(instruction.value, 2000)) { controller.snapshot.error = t("Enter an instruction for the message draft."); sync(); return; }
    const before = capture(), proof = await controller.prepareAI(instruction.value, before.replyID);
    if (!proof) return;
    if (!unchanged(before)) { controller.discardDraft(proof); return; }
    aiProvider.textContent = [proof.ai?.provider, proof.ai?.model].filter(Boolean).join(" · ");
    composer.value = proof.text; ++revision; remember(); sync();
    if (!andSend) { controller.discardDraft(proof); composer.focus(); return; }
    const sendState = capture(), result = await controller.sendPrepared(proof);
    if (result?.status === "sent" && unchanged(sendState)) { composer.value = ""; draftCache.delete(binding); ++revision; sync(); }
  }
  const draft = h("button", { id: "account-prepare-draft", class: "secondary", text: tl("Write with AI"), onclick: () => void generate() });
  const aiSend = h("button", { id: "account-ai-send", text: tl("AI reply and send"), onclick: () => void generate(true) });
  const quick = (id: string, label: string, prompt: string, summary = false) => h("button", { id, class: "secondary", text: tl(label), onclick: () => {
    if (instruction.disabled) return;
    instruction.value = t(prompt); summaryOnly = summary; controller.cancelAI(); sync(); instruction.focus();
  } });
  const quickButtons = [quick("account-ai-short", "Short reply", "Write a short, natural reply to the latest incoming message."),
    quick("account-ai-translate", "Translate", "Translate the latest incoming message into Uzbek. Return only the translation."),
    quick("account-ai-summary", "Summarize", "Summarize the last 20 messages of this conversation in Uzbek for me. Do not address the recipient.", true)];
  const aiDetails = h("details", { class: "messenger-ai", id: "account-ai-controls" }, h("summary", { text: tl("AI assistant") }),
    h("div", { class: "actions messenger-quick" }, ...quickButtons), instruction,
    h("div", { class: "actions" }, draft, aiSend), aiProvider,
    h("p", { class: "hint", text: tl("AI uses the last 20 messages and your selected reply. Write with AI fills the editable message. AI reply and send sends once. Summaries stay in the composer.") }));
  const sidebar = h("aside", { class: "messenger-sidebar" },
    h("div", { class: "messenger-sidebar-heading" }, h("h3", { text: tl("Chats") }), chatCount),
    h("div", { class: "messenger-search" }, chatSearch, filter), h("div", { class: "actions" }, list, saved),
    h("div", { class: "messenger-recipient" }, username, open), chatRows, moreChats);
  const chatPane = h("section", { class: "messenger-conversation" },
    h("div", { class: "messenger-chat-header" }, title, subtitle,
      h("label", { class: "messenger-compact-chat" }, h("span", { text: tl("Selected Telegram chat") }), chatSelect)),
    h("div", { class: "messenger-history-tools" }, messageSearch, read, clearSearch, older),
    messages, historyStatus,
    h("div", { class: "messenger-compose" }, replyBanner, composer,
      h("div", { class: "messenger-compose-actions" }, composerHint, send), aiDetails, review, acknowledge));
  const el = h("section", { class: "card telegram-messenger", id: "account-messenger" }, sidebar, chatPane);
  const enter = (button: HTMLButtonElement) => (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.key === "Enter" && !key.isComposing && !button.disabled) { key.preventDefault(); button.click(); }
  };
  // Avoid synthetic click assumptions in the native keyboard paths.
  chatSearch.addEventListener("keydown", event => { const key = event as KeyboardEvent; if (key.key === "Enter" && !key.isComposing && !list.disabled) { key.preventDefault(); void controller.loadChats({ query: chatSearch.value || "", filter: filter.value as AccountChatFilter }); } });
  username.addEventListener("keydown", enter(open)); messageSearch.addEventListener("keydown", enter(read));
  chatSearch.addEventListener("input", sync);
  filter.addEventListener("change", () => { if (!filter.disabled) void controller.loadChats({ query: chatSearch.value || "", filter: filter.value as AccountChatFilter }); });
  composer.addEventListener("input", () => { ++revision; remember(); controller.cancelAI(); sync(); });
  instruction.addEventListener("input", () => { summaryOnly = false; controller.cancelAI(); sync(); });
  composer.addEventListener("keydown", event => {
    const key = event as KeyboardEvent;
    if (key.key === "Enter" && key.ctrlKey && !key.isComposing && !send.disabled) { key.preventDefault(); void sendMessage(); }
  });
  const kindLabel = (chat: AccountChat) => chat.is_self ? t("Saved Messages") : chat.kind === "user" ? t("Person") : chat.kind === "group" ? t("Group") : t("Channel");
  const mediaLabel = (kind: string) => t({ photo: "Photo", video: "Video", voice: "Voice message", audio: "Audio", sticker: "Sticker", document: "Document", contact: "Contact", location: "Location", poll: "Poll", other: "Attachment" }[kind as "photo"] || "Attachment");
  function sync() {
    const state = controller.snapshot, status = state.status;
    const identity = status?.authorized ? `${status.api_id}:${status.username || ""}:${status.session_epoch ?? "legacy"}` : "";
    if (identity && accountIdentity && identity !== accountIdentity) {
      draftCache.clear(); binding = ""; reply = null; composer.value = ""; instruction.value = ""; aiProvider.textContent = ""; ++revision;
    }
    if (identity) accountIdentity = identity;
    selectionChanged();
    const busy = !!state.pending || !!status?.busy || !!status?.teardown_pending;
    const authorized = !!status?.available && status.authorized && status.state === "authorized" && status.connected !== false;
    const canSend = authorized && !busy && !!state.selected?.can_send;
    for (const button of [list, saved, open]) button.disabled = !authorized || busy || state.chatsLoading;
    list.textContent = t(state.chatsLoading ? "Loading chats…" : "Load 30 chats");
    filter.disabled = chatSearch.disabled = username.disabled = !authorized || busy;
    moreChats.hidden = !state.chatPage?.has_more; moreChats.disabled = !authorized || busy || state.chatsLoading;
    read.disabled = !authorized || busy || !state.selected || state.messagesLoading;
    read.textContent = t(state.messagesLoading ? "Loading messages…" : "Read last 50 messages");
    messageSearch.disabled = !authorized || busy || !state.selected;
    clearSearch.hidden = !state.messagePage?.query && !messageSearch.value;
    clearSearch.disabled = read.disabled;
    older.hidden = !state.messagePage?.has_more; older.disabled = read.disabled;
    chatSelect.disabled = !authorized || busy;
    composer.disabled = !canSend; instruction.disabled = !canSend;
    send.disabled = !canSend || !(validTelegramText(composer.value || "") || state.draft && Date.now() < state.draftExpiresAt);
    draft.disabled = !canSend || !state.messagesLoaded || state.messagesLoading || state.aiPending;
    aiSend.disabled = draft.disabled || summaryOnly;
    draft.textContent = t(state.aiPending ? "AI is writing…" : "Write with AI");
    for (const button of quickButtons) button.disabled = instruction.disabled;
    replyBanner.hidden = !reply; replyCancel.disabled = busy;
    acknowledge.hidden = state.sent?.status !== "unknown"; acknowledge.disabled = busy;
    if (reply) replyText.textContent = `${t("Reply to message {id}", { id: reply.id })} · ${reply.text.slice(0, 180) || mediaLabel(reply.media_kind || "other")}`;
    title.textContent = state.selected?.title || t("Choose a chat to start");
    subtitle.textContent = state.selected ? `${kindLabel(state.selected)}${state.selected.username ? ` · @${state.selected.username}` : ""} · ${state.selected.chat_id}${!state.selected.can_send ? ` · ${t("Read only: messages cannot be sent here.")}` : ""}` : t("Load chats or open a username. Private history loads when you choose.");
    composerHint.textContent = !state.selected ? t("Select a recipient before writing.") : !state.selected.can_send ? t("Read only: messages cannot be sent here.")
      : t("{count}/4000 · Ctrl+Enter sends · Enter adds a line", { count: (composer.value || "").length });
    chatCount.textContent = t("{count} loaded", { count: state.chats.length });
    const nextList = JSON.stringify([state.chats, state.chatPage?.query, state.chatPage?.filter, state.selected?.chat_id, chatSearch.value, filter.value, chatSelect.disabled, t("Choose a loaded chat")]);
    if (nextList !== listKey) {
      const selectable = state.selected && !state.chats.some(chat => chat.chat_id === state.selected?.chat_id) ? [state.selected, ...state.chats] : state.chats;
      chatSelect.replaceChildren(h("option", { value: "", text: tl("Choose a loaded chat") }), ...selectable.map(chat => h("option", { value: chat.chat_id, text: `${chat.title} · ${chat.chat_id}` })));
      const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[‘’`ʻʼ]/gu, "'");
      const query = normalize(chatSearch.value || "");
      // Server matching also transliterates Cyrillic and case-folds Unicode.
      // A completed, bound server search is authoritative; a weaker local
      // substring check must not erase its verified matches.
      const serverMatches = state.chatPage?.query === (chatSearch.value || "") && state.chatPage.filter === filter.value;
      const local = state.chats.filter(chat => (serverMatches || !query || normalize(`${chat.title} ${chat.username || ""}`).includes(query)) &&
        (filter.value === "all" || filter.value === "unread" && chat.unread_count > 0 || filter.value === "users" && chat.kind === "user" || filter.value === "groups" && chat.kind === "group" || filter.value === "channels" && chat.kind === "channel"));
      chatRows.replaceChildren(...local.map(chat => h("button", { class: `messenger-chat-row${chat.chat_id === state.selected?.chat_id ? " selected" : ""}`, "data-chat-id": chat.chat_id,
        "aria-pressed": chat.chat_id === state.selected?.chat_id, disabled: chatSelect.disabled, onclick: () => {
          if (chatSelect.disabled) return; selectChat(chat.chat_id); void controller.loadMessages();
        } }, h("span", { class: "messenger-chat-title", text: chat.title }),
        h("span", { class: "hint", text: `${kindLabel(chat)}${chat.username ? ` · @${chat.username}` : ""}` }),
        chat.unread_count ? h("span", { class: "messenger-unread", text: String(chat.unread_count) }) : null)));
      if (!local.length) chatRows.append(h("p", { class: "hint", text: tl("No matching loaded chats. Load or search another page.") }));
      listKey = nextList;
    }
    chatSelect.value = state.selected?.chat_id || "";
    const nextMessages = JSON.stringify([state.messages, state.messagesLoaded, state.selected?.chat_id, busy, canSend, t("You")]);
    if (messageKey !== nextMessages) {
      const bottom = messages.scrollHeight - messages.scrollTop - (messages.clientHeight || 0) < 60;
      messages.replaceChildren(...state.messages.map(message => h("article", { class: `messenger-message${message.out ? " outgoing" : " incoming"}`, "data-message-id": message.id },
        h("div", { class: "messenger-message-meta" }, h("span", { text: message.out ? t("You") : message.sender_name || message.sender_id || t("Unknown sender") }),
          h("time", { datetime: message.date, text: new Date(message.date).toLocaleString() })),
        message.reply_to_id ? h("p", { class: "hint messenger-message-reply", text: t("Reply to message {id}", { id: message.reply_to_id }) }) : null,
        message.media_kind ? h("p", { class: "messenger-media", text: mediaLabel(message.media_kind) }) : null,
        h("div", { class: "messenger-message-text", text: message.text }),
        message.truncated ? h("p", { class: "hint", text: tl("Long message shortened in this view.") }) : null,
        h("button", { class: "secondary messenger-reply-action", disabled: !canSend, "data-reply-id": message.id, text: tl("Reply"), onclick: () => { if (canSend) setReply(message); } }))));
      if (!state.messagesLoaded) messages.append(h("p", { class: "messenger-empty", text: tl("No private messages have been loaded.") }));
      else if (!state.messages.length) messages.append(h("p", { class: "messenger-empty", text: tl("This chat has no loaded messages.") }));
      if (olderScroll != null) { messages.scrollTop = messages.scrollHeight - olderScroll; olderScroll = null; }
      else if (bottom || messageKey === "") messages.scrollTop = messages.scrollHeight;
      messageKey = nextMessages;
    }
    historyStatus.textContent = state.messagesLoading ? t("Loading messages…") : !state.messagesLoaded ? t("Read last 50 messages to show history and enable AI.")
      : t("{count} messages loaded{search}", { count: state.messages.length, search: state.messagePage?.query ? ` · ${state.messagePage.query}` : "" });
    const nextReview = JSON.stringify([state.draft, state.sent, t("Telegram confirmed that the message was sent.")]);
    if (nextReview !== reviewKey) {
      review.replaceChildren();
      if (state.draft) review.append(h("p", { text: t("Recipient: {recipient} ({chat})", { recipient: state.draft.recipient, chat: state.draft.chat_id }) }), h("pre", { class: "action-preview", text: state.draft.text }));
      if (state.sent?.status === "unknown") review.append(h("p", { class: "hint", text: t("Uncertain send in chat {chat}.", { chat: state.sent.chat_id }) }));
      if (state.sent) review.append(h("p", { class: state.sent.status === "sent" ? "verified" : "unverified", text: t(state.sent.status === "sent" ? "Telegram confirmed that the message was sent."
        : state.sent.status === "unknown" ? "The send result is unknown. Check Telegram before composing another message." : "The message send was cancelled.") }));
      review.hidden = !state.draft && !state.sent; reviewKey = nextReview;
    }
  }
  function clearPrivateComposer() {
    draftCache.clear(); binding = ""; reply = null; composer.value = ""; instruction.value = ""; aiProvider.textContent = ""; ++revision;
  }
  return { el, sync, hide: () => { clearPrivateComposer(); controller.cancelAI(); }, reset: clearPrivateComposer };
}
