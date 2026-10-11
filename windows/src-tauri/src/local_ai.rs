// The Local AI panel can only address the local router installed alongside it.
// Named tool calls address this verified bridge only. Explicit scripts execute
// as the current user; generated proposals do not authorize execution.

use std::{sync::atomic::{AtomicU16, Ordering}, time::Duration};

use reqwest::{redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::i18n::{t, tf};
use crate::net;

static ROUTER_PORT: AtomicU16 = AtomicU16::new(0);
const MAX_BODY: usize = 64 * 1024;
const MAX_VOICE_BODY: usize = 1024 * 1024;
const MAX_VOICE_RESPONSE: usize = 2 * 1024 * 1024;
const MAX_VOICE_BASE64: usize = 704_000;

pub(crate) fn publish_router_port(port: Option<u16>) {
    ROUTER_PORT.store(port.filter(|port| matches!(*port, 11435 | 11437)).unwrap_or(0), Ordering::Release);
}

pub(crate) fn router_port() -> Option<u16> {
    match ROUTER_PORT.load(Ordering::Acquire) { port @ (11435 | 11437) => Some(port), _ => None }
}

fn endpoint_at(path: &str, port: u16) -> Result<Url, String> {
    if !matches!(port, 11435 | 11437) { return Err(t("Invalid Local AI control.")); }
    if !matches!(path, "/health" | "/control/mode" | "/control/stop" | "/control/open-opencode"
        | "/capabilities" | "/telegram/status" | "/telegram/configure" | "/telegram/start" | "/telegram/stop"
        | "/computer/plan" | "/computer/approve" | "/computer/finish" | "/tools/status" | "/tools/call"
        | "/voice/status" | "/voice/transcribe" | "/voice/cancel" | "/voice/speak") {
        if !matches!(path, "/telegram/account/status" | "/telegram/account/configure" | "/telegram/account/connect"
            | "/telegram/account/verify" | "/telegram/account/disconnect" | "/telegram/account/chats"
            | "/telegram/account/messages" | "/telegram/account/draft" | "/telegram/account/send"
            | "/telegram/account/command" | "/telegram/account/cancel" | "/telegram/account/compose" | "/telegram/account/resolve") {
        return Err(t("Invalid Local AI control."));
        }
    }
    // Fixed numeric loopback avoids DNS rebinding and never accepts 0.0.0.0.
    let url = Url::parse(&format!("http://127.0.0.1:{port}{path}")).map_err(|e| e.to_string())?;
    if url.host_str() != Some("127.0.0.1") || url.port() != Some(port) || url.scheme() != "http" {
        return Err(t("Local AI controls only work on this computer."));
    }
    Ok(url)
}

fn mode_body(mode: &str) -> Result<Value, String> {
    if !matches!(mode, "ECO" | "BALANCED" | "QUALITY") {
        return Err(t("Invalid Local AI mode."));
    }
    Ok(json!({ "mode": mode }))
}

async fn request(path: &str, body: Option<Value>) -> Result<Value, String> {
    // Snapshot the verified service once. Never reroute or repeat a dispatched mutation.
    let port = router_port().ok_or_else(|| t("Local AI is disconnected. Start LocalAI and retry."))?;
    request_at(path, body, port).await
}

pub(crate) async fn probe_health(port: u16) -> Result<Value, String> {
    request_at("/health", None, port).await
}

fn safe_account_error(value: &Value) -> Option<&str> {
    if value.get("error_kind")?.as_str()? != "telegram_account_safe" { return None; }
    let code = value.get("code")?.as_str()?;
    if code.is_empty() || code.len() > 64 || !code.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_') { return None; }
    let error = value.get("error")?.as_str()?;
    if error.is_empty() || error.chars().count() > 500 || error.chars().any(char::is_control) { return None; }
    Some(error)
}

async fn request_at(path: &str, body: Option<Value>, port: u16) -> Result<Value, String> {
    let url = endpoint_at(path, port)?;
    if body.as_ref().is_some_and(|body| !body_fits(path, body)) {
        return Err(t("Local tools request is too large."));
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(1))
        .timeout(Duration::from_secs(request_timeout(path, body.is_some())))
        .build()
        .map_err(|e| e.to_string())?;
    let request = match body {
        Some(body) => client.post(url).header("X-LocalAI-Control", "1").json(&body),
        None => client.get(url),
    };
    let response = request.send().await.map_err(|_| t("Local AI is disconnected. Start LocalAI and retry."))?;
    let status = response.status();
    let bytes = net::read_capped(response, response_cap(path)).await?;
    if !status.is_success() {
        // A credential endpoint's backend error must never echo the token.
        if path.starts_with("/telegram/account/") {
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                if let Some(error) = safe_account_error(&value) { return Err(error.to_string()); }
            }
        } else if path != "/telegram/configure" {
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                if let Some(error) = value.get("error").and_then(Value::as_str)
                    .or_else(|| value.pointer("/error/message").and_then(Value::as_str)) {
                    return Err(error.chars().take(500).collect());
                }
            }
        }
        return Err(tf("Local AI control failed ({status}).", &[("status", &status.as_u16().to_string())]));
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| t("Invalid Local AI status"))?;
    if !value.is_object() {
        return Err(t("Invalid Local AI status"));
    }
    Ok(value)
}

fn request_timeout(path: &str, post: bool) -> u64 {
    if path == "/voice/transcribe" { 180 }
    else if path == "/voice/status" { 15 }
    else if path == "/voice/speak" { 30 }
    else if path == "/voice/cancel" { 10 }
    else if path == "/tools/call" { 180 }
    else if path == "/tools/status" { 15 }
    else if matches!(path, "/telegram/account/draft" | "/telegram/account/command") { 150 }
    else if post && path.starts_with("/telegram/account/") { 50 }
    else if matches!(path, "/computer/plan" | "/computer/approve") { 90 }
    else if post { 15 } else { 5 }
}
fn response_cap(path: &str) -> usize {
    match path { "/voice/speak" => MAX_VOICE_RESPONSE, "/tools/call" => 2 * 1024 * 1024, "/telegram/account/messages" => 512 * 1024, "/telegram/account/chats" => 256 * 1024, _ => MAX_BODY }
}

fn request_cap(path: &str) -> usize {
    if path == "/voice/transcribe" { MAX_VOICE_BODY } else { MAX_BODY }
}

fn body_fits(path: &str, body: &Value) -> bool {
    serde_json::to_vec(body).is_ok_and(|bytes| bytes.len() <= request_cap(path))
}

fn voice_language(value: Option<&Value>) -> bool {
    value.and_then(Value::as_str).is_some_and(|language| matches!(language, "uz" | "en" | "ru"))
}

fn base64_index(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62), b'/' => Some(63), _ => None,
    }
}

/// Canonical ASCII Base64 only; the offline engine verifies the WAV container.
fn voice_audio(encoded: &str) -> bool {
    let bytes = encoded.as_bytes();
    if bytes.is_empty() || bytes.len() > MAX_VOICE_BASE64 || bytes.len() % 4 != 0 { return false; }
    let payload = encoded.trim_end_matches('=');
    let padding = bytes.len() - payload.len();
    if padding > 2 || !payload.bytes().all(|byte| base64_index(byte).is_some()) { return false; }
    match (padding, payload.bytes().last().and_then(base64_index)) {
        (0, Some(_)) => true,
        (1, Some(last)) => last & 3 == 0,
        (2, Some(last)) => last & 15 == 0,
        _ => false,
    }
}

fn voice_transcribe_body(arguments: Value) -> Result<Value, String> {
    let invalid = || t("Invalid Local AI control.");
    let fields = arguments.as_object().ok_or_else(invalid)?;
    if fields.keys().any(|key| !matches!(key.as_str(), "audio_base64" | "language" | "request_id" | "duration_seconds"))
        || !voice_language(fields.get("language"))
        || !fields.get("audio_base64").and_then(Value::as_str).is_some_and(voice_audio) {
        return Err(invalid());
    }
    if fields.get("request_id").is_some_and(|value| !value.as_str().is_some_and(|id|
        (1..=64).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')))) {
        return Err(invalid());
    }
    if fields.get("duration_seconds").is_some_and(|value| !value.as_f64().is_some_and(|duration|
        duration.is_finite() && (0.0..=15.0).contains(&duration))) {
        return Err(invalid());
    }
    if !body_fits("/voice/transcribe", &arguments) { return Err(t("Local tools request is too large.")); }
    Ok(arguments)
}

fn voice_speak_body(arguments: Value) -> Result<Value, String> {
    let invalid = || t("Invalid Local AI control.");
    let fields = arguments.as_object().ok_or_else(invalid)?;
    if fields.len() != 2 || fields.keys().any(|key| !matches!(key.as_str(), "text" | "language"))
        || !voice_language(fields.get("language"))
        || !fields.get("text").and_then(Value::as_str).is_some_and(|text|
            !text.trim().is_empty() && text.encode_utf16().count() <= 1000
            && !text.chars().any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))) {
        return Err(invalid());
    }
    Ok(arguments)
}

#[tauri::command]
pub async fn local_ai_voice_status() -> Result<Value, String> { request("/voice/status", None).await }
#[tauri::command]
pub async fn local_ai_voice_transcribe(arguments: Value) -> Result<Value, String> {
    request("/voice/transcribe", Some(voice_transcribe_body(arguments)?)).await
}
#[tauri::command]
pub async fn local_ai_voice_cancel() -> Result<Value, String> { request("/voice/cancel", Some(json!({}))).await }
#[tauri::command]
pub async fn local_ai_voice_speak(arguments: Value) -> Result<Value, String> {
    request("/voice/speak", Some(voice_speak_body(arguments)?)).await
}

fn toolbox_body(name: &str, arguments: Value) -> Result<Value, String> {
    if !matches!(name, "terminal_run" | "github_action" | "ai_plan" | "desktop_windows"
        | "desktop_start" | "desktop_observe" | "desktop_action" | "desktop_finish")
        || !arguments.is_object() {
        return Err(t("Invalid Local AI control."));
    }
    let body = json!({"name":name,"arguments":arguments});
    if serde_json::to_vec(&body).map_or(true, |bytes| bytes.len() > MAX_BODY) {
        return Err(t("Local tools request is too large."));
    }
    Ok(body)
}

#[tauri::command]
pub async fn local_ai_toolbox_status() -> Result<Value, String> { request("/tools/status", None).await }
#[tauri::command]
pub async fn local_ai_toolbox_call(name: String, arguments: Value) -> Result<Value, String> {
    request("/tools/call", Some(toolbox_body(&name, arguments)?)).await
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AccountConfig { api_id: i64, api_hash: String }
fn account_config_body(config: AccountConfig) -> Result<Value, String> {
    if !(1..=2147483647).contains(&config.api_id)
        || !config.api_hash.is_empty() && (config.api_hash.len() != 32 || !config.api_hash.bytes().all(|byte| byte.is_ascii_hexdigit())) {
        return Err(t("Enter a valid Telegram API ID and 32-character API hash."));
    }
    Ok(json!({"api_id":config.api_id,"api_hash":config.api_hash}))
}
fn account_connect_body(phone: Option<String>) -> Result<Value, String> {
    let phone = phone.map(|phone| phone.trim().to_string()).filter(|phone| !phone.is_empty());
    if let Some(phone) = phone {
        let digits = phone.strip_prefix('+').ok_or_else(|| t("Enter a phone number with its country code."))?;
        if !(7..=15).contains(&digits.len()) || digits.starts_with('0') || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(t("Enter a phone number with its country code."));
        }
        Ok(json!({"phone":phone}))
    } else { Ok(json!({})) } // Only the backend can restore a saved session.
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountVerify { #[serde(default)] code: Option<String>, #[serde(default)] password: Option<String> }
fn account_verify_body(input: AccountVerify) -> Result<Value, String> {
    match (input.code, input.password) {
        (Some(code), None) if (4..=8).contains(&code.len()) && code.bytes().all(|byte| byte.is_ascii_digit()) => Ok(json!({"code":code})),
        (None, Some(password)) if (1..=256).contains(&password.chars().count()) => Ok(json!({"password":password})),
        _ => Err(t("Enter the requested login code or 2FA password.")),
    }
}
fn account_chat_id(id: &str) -> Result<&str, String> {
    let digits = id.strip_prefix('-').unwrap_or(id);
    if id.len() > 24 || digits.is_empty() || digits.starts_with('0') || !digits.bytes().all(|byte| byte.is_ascii_digit()) || id.parse::<i64>().is_err() {
        return Err(t("Choose a Telegram chat from the loaded list."));
    }
    Ok(id)
}
fn account_draft_body(chat_id: &str, instruction: &str) -> Result<Value, String> {
    account_chat_id(chat_id)?;
    if instruction.trim().is_empty() || instruction.chars().count() > 2000 || instruction.contains('\0') { return Err(t("Enter an instruction for the message draft.")); }
    Ok(json!({"chat_id":chat_id,"instruction":instruction}))
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountChatQuery {
    limit: Option<u8>, cursor: Option<String>, query: Option<String>, filter: Option<String>,
}
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountMessageQuery { limit: Option<u8>, before_id: Option<i64>, query: Option<String> }

fn search_query(query: Option<String>) -> Result<Option<String>, String> {
    if query.as_ref().is_some_and(|query| query.encode_utf16().count() > 100 || query.chars().any(char::is_control)) {
        return Err(t("Invalid Local AI control."));
    }
    Ok(query)
}
fn positive_message_id(id: i64) -> Result<i64, String> {
    if !(1..=2147483647).contains(&id) { return Err(t("Invalid Local AI control.")); }
    Ok(id)
}
fn account_chats_body(options: AccountChatQuery) -> Result<Value, String> {
    let limit = options.limit.unwrap_or(30);
    if !(1..=30).contains(&limit) { return Err(t("Invalid Local AI control.")); }
    let mut body = json!({"limit":limit});
    if let Some(cursor) = options.cursor {
        if cursor.is_empty() || cursor.len() > 256 || !cursor.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte)) {
            return Err(t("Invalid Local AI control."));
        }
        body["cursor"] = json!(cursor);
    }
    if let Some(query) = search_query(options.query)? { body["query"] = json!(query); }
    if let Some(filter) = options.filter {
        if !matches!(filter.as_str(), "all" | "unread" | "users" | "groups" | "channels") { return Err(t("Invalid Local AI control.")); }
        body["filter"] = json!(filter);
    }
    Ok(body)
}
fn account_messages_body(chat_id: &str, options: AccountMessageQuery) -> Result<Value, String> {
    let limit = options.limit.unwrap_or(20);
    if !(1..=50).contains(&limit) { return Err(t("Invalid Local AI control.")); }
    let mut body = json!({"chat_id":account_chat_id(chat_id)?,"limit":limit});
    if let Some(id) = options.before_id { body["before_id"] = json!(positive_message_id(id)?); }
    if let Some(query) = search_query(options.query)? { body["query"] = json!(query); }
    Ok(body)
}
fn with_reply(mut body: Value, reply_to_id: Option<i64>) -> Result<Value, String> {
    if let Some(id) = reply_to_id { body["reply_to_id"] = json!(positive_message_id(id)?); }
    Ok(body)
}
fn valid_message_text(text: &str) -> bool {
    !text.trim().is_empty() && text.encode_utf16().count() <= 4000 && !text.contains('\0')
}
fn account_compose_body(chat_id: &str, text: &str, reply_to_id: Option<i64>) -> Result<Value, String> {
    account_chat_id(chat_id)?;
    if !valid_message_text(text) { return Err(t("Enter the message text to send.")); }
    with_reply(json!({"chat_id":chat_id,"text":text}), reply_to_id)
}
fn account_resolve_body(recipient: &str) -> Result<Value, String> {
    let username = recipient.strip_prefix('@');
    if recipient != "self" && !username.is_some_and(|name| (5..=32).contains(&name.len())
        && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        && name.bytes().next().is_some_and(|byte| byte.is_ascii_alphabetic())) {
        return Err(t("Choose a Telegram chat from the loaded list."));
    }
    Ok(json!({"recipient":recipient}))
}

fn account_command_body(query: &str, chat_id: Option<&str>, message_text: Option<&str>) -> Result<Value, String> {
    if query.trim().is_empty() || query.chars().count() > 6000 || query.contains('\0') {
        return Err(t("Enter a Telegram message command."));
    }
    let mut body = json!({"query":query});
    if let Some(id) = chat_id {
        account_chat_id(id)?;
        if id.parse::<i64>().is_err() {
            return Err(t("Choose a Telegram chat from the loaded list."));
        }
        body["chat_id"] = json!(id);
    }
    if let Some(text) = message_text {
        if !valid_message_text(text) {
            return Err(t("Enter the message text to send."));
        }
        body["message_text"] = json!(text);
    }
    Ok(body)
}

#[tauri::command]
pub async fn local_ai_account_status() -> Result<Value, String> { request("/telegram/account/status", None).await }
#[tauri::command]
pub async fn local_ai_account_configure(app: AppHandle, config: AccountConfig) -> Result<Value, String> {
    let result = request("/telegram/account/configure", Some(account_config_body(config)?)).await?;
    let _ = app.emit("localai-account-invalidated", ());
    Ok(result)
}
#[tauri::command]
pub async fn local_ai_account_connect(phone: Option<String>) -> Result<Value, String> {
    request("/telegram/account/connect", Some(account_connect_body(phone)?)).await
}
#[tauri::command]
pub async fn local_ai_account_verify(input: AccountVerify) -> Result<Value, String> {
    request("/telegram/account/verify", Some(account_verify_body(input)?)).await
}
#[tauri::command]
pub async fn local_ai_account_disconnect(app: AppHandle) -> Result<Value, String> {
    let _ = app.emit("localai-account-invalidated", ());
    request("/telegram/account/disconnect", Some(json!({}))).await
}
#[tauri::command]
pub async fn local_ai_account_chats(options: Option<AccountChatQuery>) -> Result<Value, String> {
    request("/telegram/account/chats", Some(account_chats_body(options.unwrap_or_default())?)).await
}
#[tauri::command]
pub async fn local_ai_account_messages(chat_id: String, options: Option<AccountMessageQuery>) -> Result<Value, String> {
    request("/telegram/account/messages", Some(account_messages_body(&chat_id, options.unwrap_or_default())?)).await
}
#[tauri::command]
pub async fn local_ai_account_draft(chat_id: String, instruction: String, reply_to_id: Option<i64>) -> Result<Value, String> {
    request("/telegram/account/draft", Some(with_reply(account_draft_body(&chat_id, &instruction)?, reply_to_id)?)).await
}
#[tauri::command]
pub async fn local_ai_account_compose(chat_id: String, text: String, reply_to_id: Option<i64>) -> Result<Value, String> {
    request("/telegram/account/compose", Some(account_compose_body(&chat_id, &text, reply_to_id)?)).await
}
#[tauri::command]
pub async fn local_ai_account_resolve(recipient: String) -> Result<Value, String> {
    request("/telegram/account/resolve", Some(account_resolve_body(&recipient)?)).await
}
#[tauri::command]
pub async fn local_ai_account_send(id: String) -> Result<Value, String> {
    request("/telegram/account/send", Some(approval_body(&id)?)).await
}

#[tauri::command]
pub async fn local_ai_account_command(query: String, chat_id: Option<String>, message_text: Option<String>) -> Result<Value, String> {
    request("/telegram/account/command", Some(account_command_body(&query, chat_id.as_deref(), message_text.as_deref())?)).await
}

#[tauri::command]
pub async fn local_ai_account_cancel_draft(id: String) -> Result<Value, String> {
    request("/telegram/account/cancel", Some(approval_body(&id)?)).await
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TelegramConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    token: Option<String>,
    allowed_chat_ids: Vec<i64>,
    enabled: bool,
}

fn telegram_body(config: TelegramConfig) -> Result<Value, String> {
    if config.enabled || config.allowed_chat_ids.is_empty() || config.allowed_chat_ids.len() > 100
        || config.allowed_chat_ids.iter().any(|id| *id == 0 || id.unsigned_abs() > 9_007_199_254_740_991) {
        return Err(t("Enter allowed Telegram chat IDs."));
    }
    if let Some(token) = &config.token {
        // Do not include a rejected token in the error, status, logs or tests.
        let valid = token.split_once(':').is_some_and(|(bot, secret)| {
            (5..=20).contains(&bot.len()) && bot.bytes().all(|byte| byte.is_ascii_digit())
                && (20..=150).contains(&secret.len())
                && secret.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
        });
        if !valid {
            return Err(t("Enter a valid Telegram bot token."));
        }
    }
    serde_json::to_value(config).map_err(|_| t("Invalid automation status."))
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerPlan {
    task: String,
    window_title: String,
    document_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expected_text: Option<String>,
    #[serde(default)]
    require_saved: bool,
}

fn plan_body(plan: ComputerPlan) -> Result<Value, String> {
    if plan.task.trim().is_empty() || plan.task.chars().count() > 2000
        || plan.window_title.trim().is_empty() || plan.window_title.chars().count() > 200
        || plan.document_path.trim().is_empty() || plan.document_path.chars().count() > 500
        || plan.expected_text.as_ref().is_some_and(|text| text.chars().count() > 2000) {
        return Err(t("Enter a task, Notepad title and document path."));
    }
    serde_json::to_value(plan).map_err(|_| t("Invalid automation status."))
}

fn approval_body(id: &str) -> Result<Value, String> {
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte)) {
        return Err(t("Invalid action approval."));
    }
    Ok(json!({ "id": id }))
}

/// Created before the island like Settings: late WebView2 creation can be blank.
pub fn create_tools_window(app: &AppHandle) {
    #[allow(unused_mut)]
    let mut url = WebviewUrl::App("tools.html".into());
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/tools.html");
        url = WebviewUrl::External(base);
    }
    match WebviewWindowBuilder::new(app, "tools", url)
        .additional_browser_args(crate::BROWSER_ARGS)
        .title(t("Telegram and Windows tools"))
        .inner_size(940.0, 720.0).min_inner_size(700.0, 560.0)
        .resizable(true).visible(false).center().build() {
        Ok(window) => {
            let hidden = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hidden.emit("tools-visible", false);
                    let _ = hidden.hide();
                } else if matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_)) {
                    let shown = hidden.is_visible().unwrap_or(false) && !hidden.is_minimized().unwrap_or(false);
                    let _ = hidden.emit("tools-visible", shown);
                }
            });
        }
        Err(error) => crate::log::line(format!("tools window failed: {error}")),
    }
}

pub fn create_studio_window(app: &AppHandle) {
    #[allow(unused_mut)]
    let mut url = WebviewUrl::App("studio.html".into());
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/studio.html");
        url = WebviewUrl::External(base);
    }
    match WebviewWindowBuilder::new(app, "studio", url)
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("LocalAI Studio - Qanot AI")
        .inner_size(1180.0, 780.0).min_inner_size(800.0, 580.0)
        .resizable(true).visible(false).center().build() {
        Ok(window) => {
            let hidden = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hidden.emit("studio-visible", false);
                    let _ = hidden.hide();
                } else if matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_)) {
                    let shown = hidden.is_visible().unwrap_or(false) && !hidden.is_minimized().unwrap_or(false);
                    let _ = hidden.emit("studio-visible", shown);
                }
            });
        }
        Err(error) => crate::log::line(format!("Studio window failed: {error}")),
    }
}

#[tauri::command]
pub fn local_ai_open_studio(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("studio").ok_or_else(|| t("Local tools window is unavailable."))?;
    let _ = window.unminimize();
    window.show().map_err(|_| t("Local tools window is unavailable."))?;
    let _ = window.set_focus();
    let _ = window.emit("studio-visible", true);
    Ok(())
}

#[tauri::command]
pub fn local_ai_open_tools(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("tools").ok_or_else(|| t("Local tools window is unavailable."))?;
    let _ = window.unminimize();
    window.show().map_err(|_| t("Local tools window is unavailable."))?;
    let _ = window.set_focus();
    let _ = window.emit("tools-visible", true);
    Ok(())
}

#[tauri::command]
pub async fn local_ai_capabilities() -> Result<Value, String> { request("/capabilities", None).await }
#[tauri::command]
pub async fn local_ai_telegram_status() -> Result<Value, String> { request("/telegram/status", None).await }
#[tauri::command]
pub async fn local_ai_telegram_configure(config: TelegramConfig) -> Result<Value, String> {
    request("/telegram/configure", Some(telegram_body(config)?)).await
}
#[tauri::command]
pub async fn local_ai_telegram_start() -> Result<Value, String> { request("/telegram/start", Some(json!({}))).await }
#[tauri::command]
pub async fn local_ai_telegram_stop() -> Result<Value, String> { request("/telegram/stop", Some(json!({}))).await }
#[tauri::command]
pub async fn local_ai_computer_plan(plan: ComputerPlan) -> Result<Value, String> {
    request("/computer/plan", Some(plan_body(plan)?)).await
}
#[tauri::command]
pub async fn local_ai_computer_approve(id: String) -> Result<Value, String> {
    request("/computer/approve", Some(approval_body(&id)?)).await
}
#[tauri::command]
pub async fn local_ai_computer_finish() -> Result<Value, String> { request("/computer/finish", Some(json!({}))).await }

#[tauri::command]
pub async fn local_ai_health() -> Result<Value, String> {
    request("/health", None).await
}

#[tauri::command]
pub async fn local_ai_mode(mode: String) -> Result<Value, String> {
    request("/control/mode", Some(mode_body(&mode)?)).await
}

#[tauri::command]
pub async fn local_ai_stop(app: AppHandle) -> Result<Value, String> {
    let _ = app.emit("localai-account-invalidated", ());
    request("/control/stop", Some(json!({}))).await
}

#[tauri::command]
pub async fn local_ai_open_opencode() -> Result<Value, String> {
    request("/control/open-opencode", Some(json!({}))).await
}

#[cfg(test)]
mod tests {
    #[test]
    fn voice_routes_and_limits_do_not_expand_other_control_requests() {
        use super::*;
        for path in ["/voice/status", "/voice/transcribe", "/voice/cancel", "/voice/speak"] {
            for port in [11435, 11437] {
                let url = endpoint_at(path, port).unwrap();
                assert_eq!(url.host_str(), Some("127.0.0.1"));
                assert_eq!(url.port(), Some(port));
                assert_eq!(url.path(), path);
            }
        }
        for path in ["/voice", "/voice/download", "/voice/transcribe?url=https://example.com",
            "/voice/speak/", "/voice/../control/run", "https://example.com/voice/status"] {
            assert!(endpoint_at(path, 11435).is_err());
        }
        assert_eq!(request_cap("/voice/transcribe"), 1024 * 1024);
        assert_eq!(response_cap("/voice/speak"), 2 * 1024 * 1024);
        // One MiB of raw WAV expands before its metadata enters the JSON body.
        let maximum_wav_json = 4 * ((1024 * 1024 + 2) / 3) + 1024;
        assert!(maximum_wav_json <= response_cap("/voice/speak"));
        for path in ["/voice/status", "/voice/cancel", "/voice/speak", "/tools/call", "/telegram/account/send", "/control/mode"] {
            assert_eq!(request_cap(path), MAX_BODY);
        }
        for path in ["/voice/status", "/voice/cancel", "/voice/transcribe", "/health"] {
            assert_eq!(response_cap(path), MAX_BODY);
        }
        let audio = json!({"audio_base64":"A".repeat(MAX_VOICE_BASE64), "language":"uz"});
        assert!(voice_transcribe_body(audio.clone()).is_ok());
        assert!(body_fits("/voice/transcribe", &audio));
        assert!(!body_fits("/voice/speak", &audio));
        assert!(!body_fits("/tools/call", &audio));
        assert!(!body_fits("/voice/transcribe", &json!({"data":"A".repeat(MAX_VOICE_BODY)})));
        assert_eq!(request_timeout("/voice/status", false), 15);
        assert_eq!(request_timeout("/voice/transcribe", true), 180);
        assert_eq!(request_timeout("/voice/speak", true), 30);
        assert_eq!(request_timeout("/voice/cancel", true), 10);
    }

    #[test]
    fn voice_audio_requires_canonical_ascii_base64_without_whitespace() {
        use super::*;
        for value in ["AAAA", "AA==", "AAA=", "UklGRg==", "////", "++++"] { assert!(voice_audio(value), "{value}"); }
        for value in ["", "A", "AAA", "=AAA", "A===", "====", "AB==", "AAB=", "AA=A", "AAAA\n", "AA A", "____", "ＡＡＡＡ"] {
            assert!(!voice_audio(value), "{value:?}");
        }
        assert!(voice_audio(&"A".repeat(MAX_VOICE_BASE64)));
        assert!(!voice_audio(&"A".repeat(MAX_VOICE_BASE64 + 4)));
    }

    #[test]
    fn voice_transcribe_only_accepts_bounded_language_id_and_duration_fields() {
        use super::*;
        let minimum = json!({"audio_base64":"UklGRg==", "language":"uz"});
        assert_eq!(voice_transcribe_body(minimum.clone()).unwrap(), minimum);
        let body = json!({"audio_base64":"UklGRg==", "language":"ru", "request_id":"utterance_123-abc", "duration_seconds":15});
        assert_eq!(voice_transcribe_body(body.clone()).unwrap(), body);
        for language in ["uz", "en", "ru"] {
            assert!(voice_transcribe_body(json!({"audio_base64":"AAAA", "language":language})).is_ok());
        }
        for patch in [json!({"audio_base64":null}), json!({"audio_base64":"invalid private audio!"}),
            json!({"language":"en-US"}), json!({"language":null}), json!({"url":"https://example.com"}),
            json!({"request_id":""}), json!({"request_id":null}), json!({"request_id":"id/private"}),
            json!({"request_id":"x".repeat(65)}), json!({"request_id":"ид"}), json!({"request_id":"id\n"}),
            json!({"duration_seconds":null}), json!({"duration_seconds":true}), json!({"duration_seconds":"15"}),
            json!({"duration_seconds":-0.1}), json!({"duration_seconds":15.1})] {
            let mut invalid = minimum.clone();
            for (key, value) in patch.as_object().unwrap() { invalid[key] = value.clone(); }
            let error = voice_transcribe_body(invalid).unwrap_err();
            assert!(!error.contains("invalid private audio"));
        }
        for invalid in [json!({}), json!([]), json!({"audio_base64":"AAAA"}), json!({"language":"uz"})] {
            assert!(voice_transcribe_body(invalid).is_err());
        }
        assert!(voice_transcribe_body(json!({"audio_base64":"AAAA", "language":"uz", "duration_seconds":0})).is_ok());
        assert!(voice_transcribe_body(json!({"audio_base64":"AAAA", "language":"uz", "request_id":"x".repeat(64)})).is_ok());
    }

    #[test]
    fn voice_speak_preserves_literal_multiline_text_and_bounds_utf16() {
        use super::*;
        let text = "  Salom!\nO‘zbekiston $() `literal` <speak>matn</speak>  ";
        let body = json!({"text":text, "language":"uz"});
        assert_eq!(voice_speak_body(body.clone()).unwrap(), body);
        assert!(voice_speak_body(json!({"text":"😀".repeat(500), "language":"en"})).is_ok());
        assert!(voice_speak_body(json!({"text":"😀".repeat(501), "language":"en"})).is_err());
        assert!(voice_speak_body(json!({"text":"x".repeat(1000), "language":"ru"})).is_ok());
        for invalid in [json!({"text":"x".repeat(1001), "language":"uz"}), json!({"text":"", "language":"uz"}),
            json!({"text":" \n\t", "language":"uz"}), json!({"text":"private\0text", "language":"uz"}),
            json!({"text":"x\u{1}y", "language":"uz"}), json!({"text":null, "language":"uz"}),
            json!({"text":"salom", "language":"fr"}), json!({"text":"salom", "language":"uz", "url":"https://example.com"}),
            json!({"text":"salom"}), json!([])] {
            let error = voice_speak_body(invalid).unwrap_err();
            assert!(!error.contains("private"));
        }
    }

    #[test]
    fn named_toolbox_calls_are_bounded_without_accepting_arbitrary_routes() {
        use serde_json::json;
        assert!(super::toolbox_body("terminal_run", json!({"shell":"cmd","script":"ver"})).is_ok());
        assert!(super::toolbox_body("desktop_action", json!({"session_id":"example"})).is_ok());
        assert!(super::toolbox_body("shell", json!({})).is_err());
        assert!(super::toolbox_body("terminal_run", json!(["ver"])).is_err());
        assert!(super::toolbox_body("terminal_run", json!({"script":"x".repeat(65536)})).is_err());
        assert_eq!(super::request_timeout("/tools/call", true), 180);
        assert_eq!(super::response_cap("/tools/call"), 2 * 1024 * 1024);
        assert!(super::endpoint_at("/tools/call", 11437).is_ok());
        assert!(super::endpoint_at("/tools/call?command=ver", 11437).is_err());
    }
    use super::*;

    #[test]
    fn controls_cannot_address_an_external_url_or_an_arbitrary_route() {
        for path in ["/health", "/control/mode", "/control/stop", "/control/open-opencode", "/capabilities",
            "/telegram/status", "/telegram/configure", "/telegram/start", "/telegram/stop",
            "/computer/plan", "/computer/approve", "/computer/finish",
            "/telegram/account/status", "/telegram/account/configure", "/telegram/account/connect", "/telegram/account/verify",
            "/telegram/account/disconnect", "/telegram/account/chats", "/telegram/account/messages", "/telegram/account/draft", "/telegram/account/send",
            "/telegram/account/command", "/telegram/account/cancel", "/telegram/account/compose", "/telegram/account/resolve"] {
            let url = endpoint_at(path, 11435).unwrap();
            assert_eq!(url.host_str(), Some("127.0.0.1"));
            assert_eq!(url.port(), Some(11435));
            assert_eq!(url.path(), path);
            assert_eq!(endpoint_at(path, 11437).unwrap().port(), Some(11437));
        }
        for path in ["https://example.com", "//example.com", "/control/run", "/health?url=x", "",
            "/telegram/send", "/computer/execute", "/telegram/status?token=secret", "/computer/../run",
            "/telegram/account/logout", "/telegram/account/send?text=private", "/telegram/account/../send"] {
            assert!(endpoint_at(path, 11435).is_err());
        }
        for port in [0, 80, 443, 11434, 11436, 65535] { assert!(endpoint_at("/health", port).is_err()); }
    }

    #[test]
    fn only_the_three_profile_names_can_be_posted() {
        for mode in ["ECO", "BALANCED", "QUALITY"] {
            assert_eq!(mode_body(mode).unwrap(), json!({ "mode": mode }));
        }
        for mode in ["eco", "", "qwen3.5:9b", "http://example.com", "ECO\nQUALITY"] {
            assert!(mode_body(mode).is_err());
        }
    }

    #[test]
    fn telegram_save_never_starts_bot_and_blank_preserves_existing_credential() {
        let config: TelegramConfig = serde_json::from_value(json!({ "allowed_chat_ids": [123, -100123], "enabled": false })).unwrap();
        assert_eq!(telegram_body(config).unwrap(), json!({ "allowed_chat_ids": [123, -100123], "enabled": false }));
        assert!(telegram_body(TelegramConfig { token: Some("123456789:placeholder_nonlive_credential".into()), allowed_chat_ids: vec![123], enabled: false }).is_ok());
        for body in [json!({"allowed_chat_ids": [123], "enabled": true}),
            json!({"allowed_chat_ids": [], "enabled": false}), json!({"allowed_chat_ids": [0], "enabled": false}),
            json!({"allowed_chat_ids": [9007199254740992i64], "enabled": false})] {
            assert!(telegram_body(serde_json::from_value(body).unwrap()).is_err());
        }
        assert!(serde_json::from_value::<TelegramConfig>(json!({"allowed_chat_ids": [123], "enabled": false, "url":"https://evil"})).is_err());
    }

    #[test]
    fn rejected_credentials_are_not_echoed_in_errors() {
        let value = "private-value with spaces:do-not-echo";
        let error = telegram_body(TelegramConfig { token: Some(value.into()), allowed_chat_ids: vec![123], enabled: false }).unwrap_err();
        assert!(!error.contains(value));
        assert!(!error.contains("private-value"));
    }

    #[test]
    fn bounded_plan_carries_exact_text_without_shell_or_extra_fields() {
        let body = json!({"task":"Write exact text", "window_title":"test.txt", "document_path":"D:\\LocalAI\\workspace\\test.txt",
            "expected_text":"Salom\nO‘zbekiston", "require_saved":true});
        assert_eq!(plan_body(serde_json::from_value(body.clone()).unwrap()).unwrap(), body);
        assert!(plan_body(ComputerPlan {task:" ".into(),window_title:"test".into(),document_path:"test.txt".into(),expected_text:None,require_saved:false}).is_err());
        assert!(plan_body(ComputerPlan {task:"x".repeat(2001),window_title:"test".into(),document_path:"test.txt".into(),expected_text:None,require_saved:false}).is_err());
        assert!(serde_json::from_value::<ComputerPlan>(json!({"task":"x", "window_title":"x", "document_path":"x", "command":"powershell"})).is_err());
    }

    #[test]
    fn approval_ids_and_timeouts_are_bounded_without_model_calls() {
        assert_eq!(approval_body("proposal_rev-1").unwrap(), json!({"id":"proposal_rev-1"}));
        for id in ["", "../session", "https://example.com", "a b", "id\n"] { assert!(approval_body(id).is_err()); }
        assert!(approval_body(&"x".repeat(129)).is_err());
        assert_eq!(request_timeout("/computer/plan", true), 90);
        assert_eq!(request_timeout("/computer/approve", true), 90);
        assert_eq!(request_timeout("/control/stop", true), 15);
        assert_eq!(request_timeout("/health", false), 5);
    }

    #[test]
    fn account_configuration_accepts_only_bounded_api_id_and_hex_hash_without_echo() {
        let body = json!({"api_id":12345,"api_hash":"a".repeat(32)});
        assert_eq!(account_config_body(serde_json::from_value(body.clone()).unwrap()).unwrap(), body);
        assert_eq!(account_config_body(AccountConfig { api_id: 1, api_hash: String::new() }).unwrap(), json!({"api_id":1,"api_hash":""}));
        for id in [0, -1, 2147483648] { assert!(account_config_body(AccountConfig { api_id:id, api_hash:"a".repeat(32) }).is_err()); }
        let private = "private-invalid-credential";
        let error = account_config_body(AccountConfig { api_id:12345, api_hash:private.into() }).unwrap_err();
        assert!(!error.contains(private));
        assert!(account_config_body(AccountConfig { api_id:12345, api_hash:"z".repeat(32) }).is_err());
        assert!(serde_json::from_value::<AccountConfig>(json!({"api_id":1,"api_hash":"","endpoint":"https://example.com"})).is_err());
    }

    #[test]
    fn account_connect_uses_e164_or_empty_restore_without_secret_in_error() {
        assert_eq!(account_connect_body(Some(" +998901234567 ".into())).unwrap(), json!({"phone":"+998901234567"}));
        assert_eq!(account_connect_body(None).unwrap(), json!({}));
        assert_eq!(account_connect_body(Some(" ".into())).unwrap(), json!({}));
        for phone in ["+123456", "+01234567", "998901234567", "+1234567890123456", "+123456a", "private-phone"] {
            let error = account_connect_body(Some(phone.into())).unwrap_err(); assert!(!error.contains(phone));
        }
    }

    #[test]
    fn account_verify_carries_one_manual_auth_step_and_rejects_mixed_or_extra_fields() {
        assert_eq!(account_verify_body(AccountVerify { code:Some("12345".into()), password:None }).unwrap(), json!({"code":"12345"}));
        assert_eq!(account_verify_body(AccountVerify { code:None, password:Some("synthetic-2fa".into()) }).unwrap(), json!({"password":"synthetic-2fa"}));
        for body in [json!({}), json!({"code":"123"}), json!({"code":"１２３４"}), json!({"code":"123456789"}),
            json!({"password":""}), json!({"password":"x".repeat(257)}), json!({"code":"12345","password":"private-2fa"})] {
            let error = account_verify_body(serde_json::from_value(body).unwrap()).unwrap_err(); assert!(!error.contains("private-2fa"));
        }
        assert!(serde_json::from_value::<AccountVerify>(json!({"code":"12345","phone":"private"})).is_err());
    }

    #[test]
    fn account_chat_ids_remain_strings_and_draft_send_cannot_accept_raw_send_text() {
        let id = "-1009007199254740993";
        assert_eq!(account_chat_id(id).unwrap(), id);
        assert_eq!(account_draft_body(id,"Reply politely").unwrap(), json!({"chat_id":id,"instruction":"Reply politely"}));
        for id in ["0", "-0", "01", "+123", "1e3", "../session", "https://example.com", "1\n"] { assert!(account_chat_id(id).is_err()); }
        assert!(account_chat_id(&"1".repeat(25)).is_err());
        assert!(account_draft_body(id," ").is_err()); assert!(account_draft_body(id,&"x".repeat(2001)).is_err());
        let body = approval_body("reviewed_rev-123").unwrap();
        assert_eq!(body, json!({"id":"reviewed_rev-123"})); assert_eq!(body.as_object().unwrap().len(),1);
    }

    #[test]
    fn account_timeouts_and_response_caps_are_scoped_to_known_operations() {
        assert_eq!(request_timeout("/telegram/account/status", false),5);
        assert_eq!(request_timeout("/telegram/account/verify", true),50);
        assert_eq!(request_timeout("/telegram/account/send", true),50);
        assert_eq!(request_timeout("/telegram/account/draft", true),150);
        assert_eq!(request_timeout("/telegram/account/command", true),150);
        assert_eq!(request_timeout("/telegram/account/cancel", true),50);
        assert_eq!(request_timeout("/control/stop", true),15);
        assert_eq!(response_cap("/telegram/account/messages"),512*1024);
        assert_eq!(response_cap("/telegram/account/status"),MAX_BODY);
        assert_eq!(response_cap("/health"),MAX_BODY);
    }

    #[test]
    fn natural_telegram_command_preserves_literal_text_and_accepts_only_bounded_context() {
        let query = "@an0niym0us ga «Salom! $() `literal`» yubor";
        assert_eq!(account_command_body(query, None, None).unwrap(), json!({"query":query}));
        assert_eq!(account_command_body("Shunga shuni yubor", Some("123456789"), Some("Salom\nO‘zbekiston")).unwrap(),
            json!({"query":"Shunga shuni yubor","chat_id":"123456789","message_text":"Salom\nO‘zbekiston"}));
        for query in ["", " ", "command\0suffix"] { assert!(account_command_body(query,None,None).is_err()); }
        assert!(account_command_body(&"x".repeat(6001),None,None).is_err());
        for id in ["0", "../session", "https://example.com", "9223372036854775808"] {
            assert!(account_command_body("yubor",Some(id),None).is_err());
        }
        for text in ["", " ", "body\0suffix"] { assert!(account_command_body("yubor",None,Some(text)).is_err()); }
        assert!(account_command_body("yubor",None,Some(&"x".repeat(4001))).is_err());
        let error = account_command_body("private-command\0suffix",None,None).unwrap_err();
        assert!(!error.contains("private-command"));
    }

    #[test]
    fn paginated_account_queries_are_bounded_and_cannot_choose_a_destination() {
        assert_eq!(account_chats_body(AccountChatQuery::default()).unwrap(), json!({"limit":30}));
        let body = json!({"limit":10,"cursor":"cursor_abc-1","query":"O‘zbekiston","filter":"unread"});
        assert_eq!(account_chats_body(serde_json::from_value(body.clone()).unwrap()).unwrap(), body);
        for body in [json!({"limit":0}), json!({"limit":31}), json!({"cursor":"../private"}),
            json!({"cursor":""}), json!({"query":"x".repeat(101)}), json!({"query":"x\n"}), json!({"filter":"bots"})] {
            assert!(account_chats_body(serde_json::from_value(body).unwrap()).is_err());
        }
        assert!(serde_json::from_value::<AccountChatQuery>(json!({"url":"https://example.com"})).is_err());
        assert_eq!(account_messages_body("-100123", AccountMessageQuery::default()).unwrap(), json!({"chat_id":"-100123","limit":20}));
        let options = json!({"limit":50,"before_id":123,"query":"salom"});
        assert_eq!(account_messages_body("-100123", serde_json::from_value(options).unwrap()).unwrap(),
            json!({"chat_id":"-100123","limit":50,"before_id":123,"query":"salom"}));
        for options in [json!({"limit":51}), json!({"limit":0}), json!({"before_id":0}), json!({"before_id":2147483648i64})] {
            assert!(account_messages_body("123", serde_json::from_value(options).unwrap()).is_err());
        }
    }

    #[test]
    fn compose_keeps_exact_body_and_reply_while_bounding_telegram_utf16_units() {
        let text = "  Salom!\nO‘zbekiston $() `literal`  ";
        assert_eq!(account_compose_body("123", text, Some(9)).unwrap(), json!({"chat_id":"123","text":text,"reply_to_id":9}));
        assert!(account_compose_body("123", &"😀".repeat(2000), None).is_ok());
        assert!(account_compose_body("123", &"😀".repeat(2001), None).is_err());
        for text in ["", " ", "a\0b"] { assert!(account_compose_body("123", text, None).is_err()); }
        for id in [0, -1, 2147483648] { assert!(account_compose_body("123", "Salom", Some(id)).is_err()); }
        assert!(account_chat_id("9223372036854775808").is_err());
        assert!(account_command_body("yubor", None, Some(&"😀".repeat(2001))).is_err());
    }

    #[test]
    fn recipient_resolution_is_explicit_and_cannot_accept_arbitrary_urls_or_phone_numbers() {
        for recipient in ["self", "@an0niym0us", "@Name_123"] { assert_eq!(account_resolve_body(recipient).unwrap(), json!({"recipient":recipient})); }
        for recipient in ["", "Self", "@abcd", "@1name", "@bad-name", "+998901234567", "https://t.me/name", "@name\n"] { assert!(account_resolve_body(recipient).is_err()); }
    }

    #[test]
    fn account_errors_require_the_explicit_safe_contract_and_no_controls() {
        let value = json!({"error_kind":"telegram_account_safe","code":"flood_wait","error":"Telegram cheklovi: 30 soniya kuting."});
        assert_eq!(safe_account_error(&value), Some("Telegram cheklovi: 30 soniya kuting."));
        for value in [json!({"error":"private credential"}),
            json!({"error_kind":"telegram_account_safe","code":"rpc error","error":"private"}),
            json!({"error_kind":"telegram_account_safe","code":"failure","error":"private\nline"}),
            json!({"error_kind":"telegram_account_safe","code":"failure","error":"x".repeat(501)})] {
            assert_eq!(safe_account_error(&value), None);
        }
    }
}
