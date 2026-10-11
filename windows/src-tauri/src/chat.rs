// The chat, whoever answers it: the conversation, the system prompt, and which
// provider a turn goes to. Each provider's own wire format lives in its module:
// claude.rs (Anthropic), openai_compat.rs (OpenAI, Google AI, OpenRouter) and
// local_chat.rs (Ollama, LM Studio, any OpenAI-compatible server).
//
// API keys never leave the credential store and file bytes never cross the IPC
// boundary: the island sends the question and gets the answer's text back.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::settings::Settings;
use crate::{claude, local_chat, openai_compat, secrets};

pub const ANTHROPIC: &str = "anthropic";
pub const AUTO: &str = "auto";

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatContext {
    File { name: String, path: String },
    Window { app_name: String, title: String, url: Option<String> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReply {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

impl ChatReply {
    pub fn new(text: String, provider: &str, model: &str) -> Self {
        Self { text, provider: Some(provider.into()), model: Some(model.into()) }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider: String,
    pub available: bool,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A model a provider offers, for the picker in the chat view.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
}

// ── Conversation ──────────────────────────────────────────────────────────────

/// The conversation is kept twice: in the wire format of the provider that
/// answered last (Claude's carries web search blocks no other provider would
/// understand), and as plain text turns. Switching provider mid-conversation
/// rebuilds the history from the plain turns, so nothing in one provider's
/// format is ever sent to another.
pub struct Chat {
    inner: Mutex<Conversation>,
    window_label: &'static str,
}

impl Default for Chat {
    fn default() -> Self {
        Self::for_window(crate::island::WINDOW_LABEL)
    }
}

#[derive(Default)]
struct Conversation {
    /// Bumped by every reset, so an answer that lands after "New chat" is dropped.
    epoch: u64,
    /// The provider `native` belongs to.
    owner: Option<String>,
    native: Vec<Value>,
    /// `{"role", "content": text}` turns, the same whoever answered.
    plain: Vec<Value>,
}

/// What a provider needs to build one turn.
pub struct Turn {
    epoch: u64,
    provider: String,
    /// No earlier turn: the file or window context rides along with this one.
    pub first: bool,
    /// The earlier turns, in this provider's format.
    pub history: Vec<Value>,
}

impl Chat {
    pub fn for_window(window_label: &'static str) -> Self {
        Self { inner: Mutex::new(Conversation::default()), window_label }
    }

    pub fn window_label(&self) -> &'static str {
        self.window_label
    }

    pub fn reset(&self) {
        let mut c = self.inner.lock().unwrap();
        let epoch = c.epoch + 1;
        *c = Conversation { epoch, ..Default::default() };
    }

    /// Starts a turn with `provider`, converting the history if another
    /// provider answered the previous turns.
    pub fn begin(&self, provider: &str) -> Turn {
        let mut c = self.inner.lock().unwrap();
        if c.owner.as_deref() != Some(provider) {
            c.native = c.plain.clone();
            c.owner = Some(provider.to_string());
        }
        Turn {
            epoch: c.epoch,
            provider: provider.to_string(),
            first: c.plain.is_empty(),
            history: c.native.clone(),
        }
    }

    /// Records a finished turn: the user message and the answer in the
    /// provider's format, and their plain text. Only a successful turn is
    /// recorded, so the history always matches what the model saw.
    pub fn commit(&self, turn: &Turn, user: Value, assistant: Value, user_text: &str, answer: &str) {
        let mut c = self.inner.lock().unwrap();
        if c.epoch != turn.epoch || c.owner.as_deref() != Some(turn.provider.as_str()) {
            return;
        }
        c.native.push(user);
        c.native.push(assistant);
        c.plain.push(json!({ "role": "user", "content": user_text }));
        c.plain.push(json!({ "role": "assistant", "content": answer }));
    }
}

// ── System prompt ─────────────────────────────────────────────────────────────

/// Mochi's instructions. Greets the user by their first name when the account
/// has one worth using (identity.rs), and only claims web search where the
/// provider runs it (Claude).
pub fn system_prompt(web_search: bool) -> String {
    system_prompt_for(crate::identity::first_name(), web_search)
}

fn system_prompt_for(first_name: Option<&str>, web_search: bool) -> String {
    let opening = match first_name {
        Some(name) => format!("You are Qanot AI, {name}'s personal AI assistant living at the top of their screen."),
        None => "You are Qanot AI, a personal AI assistant living at the top of the user's screen.".to_string(),
    };
    let abilities = if web_search {
        "You have web search access and can help with absolutely anything — research, coding, finding places, recommendations, tasks, questions."
    } else {
        "You can help with absolutely anything — research, coding, recommendations, tasks, questions. You have no web access: say so when something needs current information."
    };
    format!(
        "{opening} {abilities} \
Respond in the user's language. Be thorough and complete — use as much detail as the task requires. \
Use light Markdown when it helps: short paragraphs, bullet lists, **bold**, `inline code` and fenced code blocks. Avoid tables and big headings: the chat window is small."
    )
}

/// The window context line, as ClaudeService.chat() writes it.
pub fn window_line(app_name: &str, title: &str, url: Option<&str>) -> String {
    let mut text = format!("Context — App: {app_name}, Window: {title}");
    if let Some(url) = url {
        text.push_str(&format!(", URL: {url}"));
    }
    text
}

/// The plain-text record of what the user asked, context included.
pub fn plain_question(first: bool, context: Option<&ChatContext>, query: &str) -> String {
    match context.filter(|_| first) {
        Some(ChatContext::File { name, .. }) => format!("File: {name}\n\n{query}"),
        Some(ChatContext::Window { app_name, title, url }) => {
            format!("{}\n\n{query}", window_line(app_name, title, url.as_deref()))
        }
        None => query.to_string(),
    }
}

// ── Which provider ────────────────────────────────────────────────────────────

/// The model chosen for `provider`, or its default.
pub fn model_for(settings: &Settings, provider: &str) -> String {
    if provider == AUTO {
        return AUTO.into();
    }
    if provider == ANTHROPIC {
        let m = settings.model.trim();
        return if m.is_empty() { claude::DEFAULT_MODEL.to_string() } else { m.to_string() };
    }
    settings
        .chat_models
        .get(provider)
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
        .or_else(|| openai_compat::provider(provider).map(|p| p.default_model.to_string()))
        .unwrap_or_default()
}

/// Model discovery is authoritative in auto mode: a removed model must not
/// strand a fresh install or an upgraded account on an obsolete default.
fn auto_model(settings: &Settings, provider: &str, available: &[ModelInfo]) -> Result<String, String> {
    let preferred = model_for(settings, provider);
    available.iter().find(|m| m.id == preferred)
        .or_else(|| openai_compat::provider(provider).and_then(|p| available.iter().find(|m| m.id == p.default_model)))
        .or_else(|| available.first())
        .map(|m| m.id.clone())
        .ok_or_else(|| crate::i18n::tf("{provider}: no chat models available.", &[("provider", provider)]))
}

enum AutoCandidate {
    Ollama(local_chat::Server),
    Cloud(&'static openai_compat::Provider),
}

impl AutoCandidate {
    fn id(&self) -> &'static str {
        match self {
            Self::Ollama(_) => "ollama",
            Self::Cloud(p) => p.id,
        }
    }

    async fn models(&self) -> Result<Vec<ModelInfo>, String> {
        match self {
            Self::Ollama(server) => local_chat::models(server).await,
            Self::Cloud(p) => {
                let key = secrets::get(p.key).ok_or_else(|| crate::i18n::tf("{name} API key missing. Add it in Settings.", &[("name", p.name)]))?;
                openai_compat::models(p, &key).await
            }
        }
    }
}

fn auto_candidates(settings: &Settings) -> Vec<AutoCandidate> {
    let mut candidates = vec![AutoCandidate::Ollama(local_chat::auto_ollama_server(settings))];
    for id in ["google", "groq"] {
        let p = openai_compat::provider(id).expect("known auto provider");
        if secrets::present(p.key) {
            candidates.push(AutoCandidate::Cloud(p));
        }
    }
    candidates
}

struct AutoFailure {
    message: String,
    retryable: bool,
}

/// This router is only used for generation. Telegram, local commands and other
/// actions never pass through it, so fallback cannot replay their side effects.
async fn try_auto<T, F, Fut>(candidates: Vec<T>, mut attempt: F) -> Result<ChatReply, String>
where
    F: FnMut(T) -> Fut,
    Fut: std::future::Future<Output = Result<ChatReply, AutoFailure>>,
{
    let mut errors = Vec::new();
    for candidate in candidates {
        match attempt(candidate).await {
            Ok(reply) => return Ok(reply),
            Err(error) if error.retryable => errors.push(error.message),
            Err(error) => return Err(error.message),
        }
    }
    Err(crate::i18n::tf("No AI provider is available. Start Ollama with a chat model, or add a Gemini/Groq API key in Settings. {errors}", &[("errors", &errors.join(" | "))]))
}

async fn send_auto(
    app: &AppHandle,
    chat: &Chat,
    settings: &Settings,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    try_auto(auto_candidates(settings), |candidate| {
        let query = query.clone();
        let context = context.clone();
        async move {
            let id = candidate.id();
            let failure = |message| AutoFailure { message: format!("{id}: {message}"), retryable: true };
            let available = candidate.models().await.map_err(failure)?;
            let model = auto_model(settings, id, &available).map_err(failure)?;
            // A failed attempt may have emitted an empty stream update. Clear
            // that view before a cloud reply; visible partial replies stop above.
            let _ = app.emit_to(chat.window_label(), "chat-delta", "");
            match candidate {
                AutoCandidate::Ollama(server) => local_chat::send_auto(app, chat, &server, &model, query, context).await
                    .map_err(|e| AutoFailure { message: format!("Ollama: {}", e.message), retryable: !e.visible_started }),
                AutoCandidate::Cloud(p) => openai_compat::send(chat, p, &model, query, context).await.map_err(failure),
            }
        }
    }).await
}

/// Readiness checks list models only; they never generate a reply, change the
/// selected provider, install Ollama or disclose credentials to the frontend.
pub async fn provider_status(settings: &Settings, provider: &str) -> ProviderStatus {
    let mut errors = Vec::new();
    if provider == AUTO {
        for candidate in auto_candidates(settings) {
            let id = candidate.id();
            match candidate.models().await.and_then(|list| auto_model(settings, id, &list)) {
                Ok(model) => return ProviderStatus { provider: AUTO.into(), available: true, model,
                    effective_provider: Some(id.into()), error: None },
                Err(error) => errors.push(format!("{id}: {error}")),
            }
        }
        return ProviderStatus { provider: AUTO.into(), available: false, model: String::new(), effective_provider: None,
            error: Some(crate::i18n::tf("Start Ollama with a chat model, or add a Gemini/Groq API key in Settings. {errors}", &[("errors", &errors.join(" | "))])) };
    }
    match models(settings, provider).await {
        Ok(list) => {
            let selected = model_for(settings, provider);
            let model = if selected.is_empty() { auto_model(settings, provider, &list) } else {
                list.iter().find(|m| m.id == selected).map(|m| m.id.clone())
                    .ok_or_else(|| crate::i18n::tf("The selected model {model} is unavailable. Pick another model.", &[("model", &selected)]))
            };
            match model {
                Ok(model) => ProviderStatus { provider: provider.into(), available: true, model, effective_provider: Some(provider.into()), error: None },
                Err(error) => ProviderStatus { provider: provider.into(), available: false, model: selected, effective_provider: None, error: Some(error) },
            }
        }
        Err(error) => ProviderStatus { provider: provider.into(), available: false, model: model_for(settings, provider), effective_provider: None, error: Some(error) },
    }
}

/// A file rides along only if it is one of Coucou's own copies of a dropped
/// file (files.rs puts them in the inbox). The page names the path, so without
/// this any file the user can read could be sent to a chat provider.
fn checked_context(context: ChatContext) -> Result<ChatContext, String> {
    match context {
        ChatContext::File { name, path } => {
            let inbox = crate::files::inbox_dir();
            if !is_inside(&inbox, std::path::Path::new(&path)) {
                return Err(crate::i18n::t("Only a file dropped on the island can be sent with a question."));
            }
            Ok(ChatContext::File { name, path })
        }
        other => Ok(other),
    }
}

/// True when `path` is a regular file directly inside `dir`, both resolved
/// (no `..`, no symlink pointing out of it).
fn is_inside(dir: &std::path::Path, path: &std::path::Path) -> bool {
    let (Ok(dir), Ok(file)) = (dir.canonicalize(), path.canonicalize()) else { return false };
    file.parent() == Some(dir.as_path())
        && std::fs::symlink_metadata(&file).map(|m| m.is_file()).unwrap_or(false)
}

/// One chat turn with the provider chosen in the settings.
pub async fn send(
    app: &AppHandle,
    chat: &Chat,
    settings: &Settings,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let context = context.map(checked_context).transpose()?;
    let provider = settings.chat_provider.as_str();
    if provider == AUTO {
        return send_auto(app, chat, settings, query, context).await;
    }
    let model = model_for(settings, provider);
    if provider == ANTHROPIC || provider.is_empty() {
        return claude::send(chat, &model, query, context).await;
    }
    if let Some(p) = openai_compat::provider(provider) {
        return openai_compat::send(chat, p, &model, query, context).await;
    }
    if let Some(server) = local_chat::server(settings, provider) {
        return local_chat::send(app, chat, &server, &model, query, context).await;
    }
    Err(format!("Unknown chat provider: {provider}"))
}

/// The models `provider` offers. Asked only when the user opens the picker on
/// that provider, and only once it has a key (or, for a local server, an
/// address): nothing is sent anywhere before that.
pub async fn models(settings: &Settings, provider: &str) -> Result<Vec<ModelInfo>, String> {
    if provider == AUTO {
        return Ok(vec![ModelInfo { id: AUTO.into(), label: "Ollama → Gemini → Groq".into() }]);
    }
    let no_key = || crate::i18n::t("No API key — add it in Settings.");
    if provider == ANTHROPIC {
        let key = secrets::get(claude::KEY).ok_or_else(no_key)?;
        return claude::models(&key).await;
    }
    if let Some(p) = openai_compat::provider(provider) {
        let key = secrets::get(p.key).ok_or_else(no_key)?;
        return openai_compat::models(p, &key).await;
    }
    if let Some(server) = local_chat::server(settings, provider) {
        return local_chat::models(&server).await;
    }
    Err(format!("Unknown chat provider: {provider}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn_texts(history: &[Value]) -> Vec<(String, Value)> {
        history
            .iter()
            .map(|m| (m["role"].as_str().unwrap().to_string(), m["content"].clone()))
            .collect()
    }

    #[test]
    fn a_turn_is_recorded_only_once_it_succeeds() {
        let chat = Chat::default();
        let t = chat.begin("anthropic");
        assert!(t.first);
        assert!(t.history.is_empty());
        // A failed turn records nothing: the next one is still the first.
        let t = chat.begin("anthropic");
        assert!(t.first);
        chat.commit(&t, json!({"role":"user","content":[{"type":"text","text":"hi"}]}), json!({"role":"assistant","content":[{"type":"text","text":"hello"}]}), "hi", "hello");
        let t = chat.begin("anthropic");
        assert!(!t.first);
        assert_eq!(t.history.len(), 2);
        assert!(t.history[0]["content"].is_array());
    }

    #[test]
    fn separate_windows_never_share_history_reset_or_stream_targets() {
        let island = Chat::default();
        let studio = Chat::for_window("studio");
        assert_eq!(island.window_label(), crate::island::WINDOW_LABEL);
        assert_eq!(studio.window_label(), "studio");
        let first = island.begin("ollama");
        island.commit(&first, json!({"role":"user","content":"island question"}),
            json!({"role":"assistant","content":"island answer"}), "island question", "island answer");
        assert!(studio.begin("ollama").first);
        let other = studio.begin("google");
        studio.commit(&other, json!({"role":"user","content":"studio question"}),
            json!({"role":"assistant","content":"studio answer"}), "studio question", "studio answer");
        studio.reset();
        assert!(!island.begin("ollama").first);
        assert!(studio.begin("google").first);
        assert_eq!(island.begin("ollama").history.len(), 2);
    }

    #[test]
    fn switching_provider_never_sends_claude_blocks_to_another_one() {
        let chat = Chat::default();
        let t = chat.begin("anthropic");
        let blocks = json!([
            {"type":"server_tool_use","id":"srvtoolu_1","name":"web_search","input":{"query":"x"}},
            {"type":"web_search_tool_result","tool_use_id":"srvtoolu_1","content":[]},
            {"type":"text","text":"Found it."}
        ]);
        chat.commit(&t, json!({"role":"user","content":[{"type":"text","text":"look"}]}), json!({"role":"assistant","content":blocks}), "look", "Found it.");

        let t = chat.begin("openai");
        assert!(!t.first);
        assert_eq!(
            turn_texts(&t.history),
            vec![("user".into(), json!("look")), ("assistant".into(), json!("Found it."))]
        );
        let raw = serde_json::to_string(&t.history).unwrap();
        assert!(!raw.contains("web_search"), "{raw}");

        // And back: Claude gets the plain turns too, including OpenAI's answer.
        chat.commit(&t, json!({"role":"user","content":"more"}), json!({"role":"assistant","content":"Sure."}), "more", "Sure.");
        let t = chat.begin("anthropic");
        assert_eq!(t.history.len(), 4);
        assert_eq!(t.history[3], json!({"role":"assistant","content":"Sure."}));
        assert!(!serde_json::to_string(&t.history).unwrap().contains("web_search"));
    }

    #[test]
    fn an_answer_that_lands_after_a_reset_or_a_switch_is_dropped() {
        let chat = Chat::default();
        let t = chat.begin("openai");
        chat.reset();
        chat.commit(&t, json!({"role":"user","content":"q"}), json!({"role":"assistant","content":"a"}), "q", "a");
        assert!(chat.begin("openai").first);

        let t = chat.begin("openai");
        let _other = chat.begin("google");
        chat.commit(&t, json!({"role":"user","content":"q"}), json!({"role":"assistant","content":"a"}), "q", "a");
        assert!(chat.begin("google").first);
    }

    #[test]
    fn the_prompt_greets_by_first_name_and_claims_web_search_only_for_claude() {
        let p = system_prompt_for(Some("Louis"), true);
        assert!(p.starts_with("You are Qanot AI, Louis's personal AI assistant living at the top of their screen."));
        assert!(p.contains("web search access"));
        assert!(p.contains("light Markdown"));
        let p = system_prompt_for(None, false);
        assert!(p.starts_with("You are Qanot AI, a personal AI assistant living at the top of the user's screen."));
        assert!(!p.contains("web search"));
        assert!(p.contains("no web access"));
    }

    #[test]
    fn context_goes_with_the_first_question_only() {
        let file = ChatContext::File { name: "a.txt".into(), path: "/x/a.txt".into() };
        assert_eq!(plain_question(true, Some(&file), "why?"), "File: a.txt\n\nwhy?");
        assert_eq!(plain_question(false, Some(&file), "why?"), "why?");
        let win = ChatContext::Window { app_name: "Code".into(), title: "main.rs".into(), url: None };
        assert_eq!(plain_question(true, Some(&win), "q"), "Context — App: Code, Window: main.rs\n\nq");
        assert_eq!(window_line("Edge", "Docs", Some("https://x.dev")), "Context — App: Edge, Window: Docs, URL: https://x.dev");
    }

    #[test]
    fn the_model_comes_from_the_settings_or_the_provider_default() {
        let mut s = Settings::default();
        assert_eq!(s.chat_provider, AUTO);
        assert_eq!(model_for(&s, AUTO), AUTO);
        assert_eq!(model_for(&s, "anthropic"), claude::DEFAULT_MODEL);
        assert_eq!(model_for(&s, "openai"), openai_compat::provider("openai").unwrap().default_model);
        assert_eq!(model_for(&s, "ollama"), "");
        s.chat_models.insert("openai".into(), " gpt-x ".into());
        s.chat_models.insert("ollama".into(), "llama3.2".into());
        s.model = "claude-haiku-4-5".into();
        assert_eq!(model_for(&s, "openai"), "gpt-x");
        assert_eq!(model_for(&s, "ollama"), "llama3.2");
        assert_eq!(model_for(&s, "anthropic"), "claude-haiku-4-5");
    }

    fn block_on<T>(f: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(f)
    }

    #[test]
    fn automatic_generation_falls_back_in_order_and_reports_the_provider_that_answered() {
        let mut attempted = Vec::new();
        let reply = block_on(try_auto(vec!["ollama", "google", "groq"], |id| {
            attempted.push(id);
            std::future::ready(if id == "google" {
                Ok(ChatReply::new("answer".into(), id, "gemini-discovered"))
            } else {
                Err(AutoFailure { message: format!("{id}: offline"), retryable: true })
            })
        })).unwrap();
        assert_eq!(attempted, ["ollama", "google"]);
        let wire = serde_json::to_value(reply).unwrap();
        assert_eq!(wire["provider"], "google");
        assert_eq!(wire["model"], "gemini-discovered");
    }

    #[test]
    fn automatic_generation_stops_after_partial_visible_output() {
        let mut attempted = Vec::new();
        let error = block_on(try_auto(vec!["ollama", "google", "groq"], |id| {
            attempted.push(id);
            std::future::ready(Err(AutoFailure { message: "stream failed after visible text".into(), retryable: false }))
        })).err().unwrap();
        assert_eq!(attempted, ["ollama"]);
        assert_eq!(error, "stream failed after visible text");
    }

    #[test]
    fn automatic_generation_explains_all_unavailable_candidates() {
        let error = block_on(try_auto(vec!["ollama", "google", "groq"], |id| {
            std::future::ready(Err(AutoFailure { message: format!("{id}: unavailable"), retryable: true }))
        })).err().unwrap();
        assert!(error.contains("add a Gemini/Groq API key"));
        for id in ["ollama", "google", "groq"] {
            assert!(error.contains(&format!("{id}: unavailable")));
        }
    }

    #[test]
    fn auto_model_selection_preserves_available_choices_and_recovers_retired_defaults() {
        let mut settings = Settings::default();
        let choices = vec![
            ModelInfo { id: "some-chat-model".into(), label: "some-chat-model".into() },
            ModelInfo { id: "gemini-3.8-flash".into(), label: "Gemini".into() },
        ];
        settings.chat_models.insert("google".into(), " removed-old-model ".into());
        assert_eq!(auto_model(&settings, "google", &choices).unwrap(), "gemini-3.8-flash");
        settings.chat_models.insert("google".into(), " some-chat-model ".into());
        assert_eq!(auto_model(&settings, "google", &choices).unwrap(), "some-chat-model");
        assert_eq!(auto_model(&settings, "ollama", &choices).unwrap(), "some-chat-model");
        assert!(auto_model(&settings, "groq", &[]).unwrap_err().contains("no chat models"));
    }

    #[test]
    fn only_files_in_the_inbox_ride_along() {
        let base = std::env::temp_dir().join(format!("coucou-chat-ctx-{}", std::process::id()));
        let inbox = base.join("inbox");
        std::fs::create_dir_all(inbox.join("sub")).unwrap();
        std::fs::write(inbox.join("a.txt"), b"a").unwrap();
        std::fs::write(base.join("secret.txt"), b"s").unwrap();
        std::fs::write(inbox.join("sub").join("b.txt"), b"b").unwrap();
        assert!(is_inside(&inbox, &inbox.join("a.txt")));
        assert!(!is_inside(&inbox, &base.join("secret.txt")));
        assert!(!is_inside(&inbox, &inbox.join("..").join("secret.txt")));
        assert!(!is_inside(&inbox, &inbox.join("sub").join("b.txt")));
        assert!(!is_inside(&inbox, &inbox.join("missing.txt")));
        assert!(!is_inside(&inbox, &inbox));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(base.join("secret.txt"), inbox.join("link.txt")).unwrap();
            assert!(!is_inside(&inbox, &inbox.join("link.txt")));
        }
        let _ = std::fs::remove_dir_all(&base);
    }
}
