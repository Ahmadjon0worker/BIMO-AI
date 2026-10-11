//! The bundled service has per-user data and belongs to this Coucou process.
//! Only a bridge with this build's required features is reused. An older router is preserved
//! while the bundled service uses the second, fixed numeric loopback port.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const PRIMARY_PORT: u16 = 11435;
const FALLBACK_PORT: u16 = 11437;
// Health can spend up to three seconds checking an unresponsive optional Ollama.
// The bridge must still become usable for Telegram and configured cloud providers.
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
const READY_BUDGET: Duration = Duration::from_secs(20);
const POLL_INTERVAL: Duration = Duration::from_millis(100);
const TELEGRAM_FEATURES: [&str; 6] = ["chat_pages", "chat_search", "history_pages", "compose", "reply", "ai"];

#[derive(Default)]
pub struct LocalService {
    child: Mutex<Option<OwnedProcess>>,
    starting: AtomicBool,
    stopped: AtomicBool,
}

struct OwnedProcess {
    child: Child,
    port: u16,
    #[cfg(windows)]
    job: usize,
}

impl Drop for OwnedProcess {
    fn drop(&mut self) {
        #[cfg(windows)]
        if self.job != 0 {
            unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(windows::Win32::Foundation::HANDLE(self.job as *mut _));
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl LocalService {
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        // Publication and shutdown share this short lock. A successful health
        // probe cannot publish a route after shutdown has cleared it.
        let owned = {
            let mut slot = self.child.lock().unwrap_or_else(|e| e.into_inner());
            crate::local_ai::publish_router_port(None);
            slot.take()
        };
        drop(owned);
    }

    fn begin_start(&self) -> Option<StartGuard<'_>> {
        (!self.starting.swap(true, Ordering::AcqRel)).then(|| StartGuard(&self.starting))
    }

    fn discard_owned(&self) {
        let owned = {
            let mut slot = self.child.lock().unwrap_or_else(|e| e.into_inner());
            crate::local_ai::publish_router_port(None);
            slot.take()
        };
        drop(owned);
    }

    fn owned_port(&self) -> Result<Option<u16>, String> {
        let mut slot = self.child.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(process) = slot.as_mut() {
            if process.child.try_wait().map_err(|_| "Cannot check the LocalAI service.".to_string())?.is_none() {
                return Ok(Some(process.port));
            }
            drop(slot.take());
        }
        Ok(None)
    }

    fn owned_alive(&self, port: u16) -> Result<bool, String> {
        let mut slot = self.child.lock().unwrap_or_else(|e| e.into_inner());
        match slot.as_mut() {
            Some(process) if process.port == port => Ok(process.child.try_wait()
                .map_err(|_| "Cannot check the LocalAI service.".to_string())?.is_none()),
            _ => Ok(false),
        }
    }

    fn publish_ready(&self, port: u16, owned: bool) -> Result<Value, String> {
        let mut slot = self.child.lock().unwrap_or_else(|e| e.into_inner());
        if self.stopped.load(Ordering::Acquire) { return Err("BIMO AI is closing.".into()); }
        if owned {
            let alive = match slot.as_mut() {
                Some(process) if process.port == port => process.child.try_wait()
                    .map_err(|_| "Cannot check the LocalAI service.".to_string())?.is_none(),
                _ => false,
            };
            if !alive { return Err("The bundled LocalAI service exited before it was ready.".into()); }
        }
        crate::local_ai::publish_router_port(Some(port));
        Ok(json!({"ok":true,"status":if owned {"running"} else {"existing"},"owned":owned,"port":port,"bridge_ready":true}))
    }
}

struct StartGuard<'a>(&'a AtomicBool);
impl Drop for StartGuard<'_> {
    fn drop(&mut self) { self.0.store(false, Ordering::Release); }
}

fn bundled_paths(resource_dir: &Path) -> (PathBuf, PathBuf) {
    let service = resource_dir.join("localai-service");
    (service.join("runtime").join("pythonw.exe"), service.join("src").join("service_main.py"))
}

fn compatible_health(value: &Value) -> bool {
    value.get("ok").and_then(Value::as_bool) == Some(true)
        && value.get("service").and_then(Value::as_str) == Some("coucou-localai-service")
        && value.get("bridge_ready").and_then(Value::as_bool) == Some(true)
        && value.pointer("/capabilities/toolbox_api").and_then(Value::as_u64) == Some(1)
        && value.pointer("/capabilities/advanced_desktop").and_then(Value::as_u64) == Some(1)
        && value.pointer("/capabilities/voice_api").and_then(Value::as_u64) == Some(1)
        && value.pointer("/capabilities/telegram_account_api").and_then(Value::as_u64) == Some(2)
        && value.pointer("/capabilities/telegram_account_features").and_then(Value::as_array)
            .is_some_and(|features| TELEGRAM_FEATURES.iter().all(|required|
                features.iter().any(|feature| feature.as_str() == Some(*required))))
        && matches!(value.get("mode").and_then(Value::as_str), Some("ECO" | "BALANCED" | "QUALITY"))
        && value.get("busy").is_some_and(Value::is_boolean)
        && value.get("computer_use_active").is_some_and(Value::is_boolean)
        && value.get("ram_total_gib").and_then(Value::as_f64).is_some_and(|v| v >= 0.0)
        && value.get("ram_available_gib").and_then(Value::as_f64).is_some_and(|v| v >= 0.0)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PortState { Free, Compatible, Occupied }
#[derive(Debug, PartialEq, Eq)]
enum ServiceChoice { Launch(u16), Reuse(u16) }

fn choose_service(primary: PortState, fallback: Option<PortState>) -> Result<ServiceChoice, String> {
    match primary {
        PortState::Free => Ok(ServiceChoice::Launch(PRIMARY_PORT)),
        PortState::Compatible => Ok(ServiceChoice::Reuse(PRIMARY_PORT)),
        PortState::Occupied => match fallback {
            Some(PortState::Free) => Ok(ServiceChoice::Launch(FALLBACK_PORT)),
            Some(PortState::Compatible) => Ok(ServiceChoice::Reuse(FALLBACK_PORT)),
            _ => Err("LocalAI ports 11435 and 11437 are occupied by unavailable or incompatible services. Existing services were preserved.".into()),
        },
    }
}

async fn inspect_port(port: u16) -> PortState {
    // Windows can take about two seconds to report ConnectionRefused on a
    // closed loopback port. A short connect deadline cannot prove occupancy.
    // A successful bind proves availability immediately; release it before
    // launching the service. A bound or reserved port still requires health
    // verification and must never be taken over based on a failed connect.
    if let Ok(listener) = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)) {
        drop(listener);
        return PortState::Free;
    }
    let connection = tokio::time::timeout(Duration::from_millis(350),
        tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port))).await;
    match connection {
        Ok(Ok(stream)) => {
            drop(stream);
            if tokio::time::timeout(PROBE_TIMEOUT, crate::local_ai::probe_health(port)).await
                .is_ok_and(|health| health.as_ref().is_ok_and(compatible_health)) {
                PortState::Compatible
            } else { PortState::Occupied }
        }
        _ => PortState::Occupied,
    }
}

async fn wait_for_ready<P, F, A, C>(port: u16, budget: Duration, mut probe: P, mut alive: A, closing: C) -> Result<Value, String>
where P: FnMut(u16) -> F, F: Future<Output = Result<Value, String>>,
      A: FnMut() -> Result<bool, String>, C: Fn() -> bool {
    let deadline = tokio::time::Instant::now() + budget;
    loop {
        if closing() { return Err("BIMO AI is closing.".into()); }
        if !alive()? { return Err("The bundled LocalAI service exited before it was ready.".into()); }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() { break; }
        let health = tokio::time::timeout(remaining.min(PROBE_TIMEOUT), probe(port)).await;
        if closing() { return Err("BIMO AI is closing.".into()); }
        if !alive()? { return Err("The bundled LocalAI service exited before it was ready.".into()); }
        if let Ok(Ok(value)) = health {
            if compatible_health(&value) { return Ok(value); }
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() { break; }
        tokio::time::sleep(remaining.min(POLL_INTERVAL)).await;
    }
    Err("The bundled LocalAI service did not become ready with the required Telegram features. Retry or reinstall BIMO AI.".into())
}

async fn owned_ready(state: &LocalService, port: u16) -> Result<Value, String> {
    let result = wait_for_ready(port, READY_BUDGET, crate::local_ai::probe_health,
        || state.owned_alive(port), || state.stopped.load(Ordering::Acquire)).await
        .and_then(|_| state.publish_ready(port, true));
    if result.is_err() { state.discard_owned(); }
    result
}

#[cfg(windows)]
fn own_process(child: Child, port: u16) -> Result<OwnedProcess, String> {
    use std::os::windows::io::AsRawHandle;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    let mut owned = OwnedProcess { child, port, job: 0 };
    // The job also cleans up after a forced installer restart or parent crash.
    unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null()).map_err(|_| "Could not manage the LocalAI service process.".to_string())?;
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = SetInformationJobObject(job, JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _, std::mem::size_of_val(&limits) as u32)
            .and_then(|_| AssignProcessToJobObject(job, HANDLE(owned.child.as_raw_handle())));
        if configured.is_err() {
            let _ = CloseHandle(job);
            return Err("Could not manage the LocalAI service process.".into());
        }
        owned.job = job.0 as usize;
    }
    Ok(owned)
}

async fn ensure_started(app: &AppHandle, state: &LocalService) -> Result<Value, String> {
    if state.stopped.load(Ordering::Acquire) { return Err("BIMO AI is closing.".into()); }
    {
        let _slot = state.child.lock().unwrap_or_else(|e| e.into_inner());
        crate::local_ai::publish_router_port(None);
    }
    match state.owned_port() {
        Ok(Some(port)) => return owned_ready(state, port).await,
        Ok(None) => {},
        Err(error) => { state.discard_owned(); return Err(error); },
    }
    let primary = inspect_port(PRIMARY_PORT).await;
    if state.stopped.load(Ordering::Acquire) { return Err("BIMO AI is closing.".into()); }
    let fallback = if primary == PortState::Occupied { Some(inspect_port(FALLBACK_PORT).await) } else { None };
    if state.stopped.load(Ordering::Acquire) { return Err("BIMO AI is closing.".into()); }
    let port = match choose_service(primary, fallback)? {
        ServiceChoice::Reuse(port) => return state.publish_ready(port, false),
        ServiceChoice::Launch(port) => port,
    };
    #[cfg(not(windows))]
    { let _ = (app, port); return Err("Start a compatible LocalAI bridge separately on this platform.".into()); }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let resources = app.path().resource_dir().map_err(|_| "LocalAI runtime is unavailable.".to_string())?;
        let (python, script) = bundled_paths(&resources);
        if !python.is_file() || !script.is_file() { return Err("LocalAI runtime is missing. Reinstall BIMO AI.".into()); }
        let data = crate::settings::local_dir().join("LocalAI");
        crate::platform::ensure_private_dir(&data).map_err(|_| "Cannot create LocalAI data folder.".to_string())?;
        if state.stopped.load(Ordering::Acquire) { return Err("BIMO AI is closing.".into()); }
        let child = Command::new(&python).arg("-B").arg(&script).arg("--port").arg(port.to_string())
            .current_dir(script.parent().unwrap())
            .env("COUCOU_LOCALAI_DATA_DIR", &data)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .creation_flags(0x0800_0000).spawn()
            .map_err(|_| "LocalAI service could not start. Reinstall BIMO AI.".to_string())?;
        let owned = own_process(child, port)?;
        {
            let mut slot = state.child.lock().unwrap_or_else(|e| e.into_inner());
            if state.stopped.load(Ordering::Acquire) { drop(owned); return Err("BIMO AI is closing.".into()); }
            *slot = Some(owned);
        }
        owned_ready(state, port).await
    }
}

pub async fn start(app: &AppHandle) -> Result<Value, String> {
    let state = app.state::<LocalService>();
    if state.stopped.load(Ordering::Acquire) { return Err("BIMO AI is closing.".into()); }
    let Some(_starting) = state.begin_start() else { return Ok(json!({"ok":true,"status":"starting"})); };
    ensure_started(app, &state).await
}

#[tauri::command]
pub async fn local_ai_start_services(app: AppHandle) -> Result<Value, String> { start(&app).await }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn launch_uses_only_the_bundled_runtime_and_entrypoint() {
        let base = std::env::temp_dir().join("Coucou test resources");
        let (python, script) = bundled_paths(&base);
        assert_eq!(python, base.join("localai-service/runtime/pythonw.exe"));
        assert_eq!(script, base.join("localai-service/src/service_main.py"));
        assert!(python.starts_with(&base) && script.starts_with(&base));
    }
    #[test]
    fn stop_does_not_touch_an_external_router_or_allow_late_start() {
        let state = LocalService::default();
        state.stop();
        assert!(state.stopped.load(Ordering::Acquire));
        assert!(state.child.lock().unwrap().is_none());
    }
    fn health() -> Value {
        json!({"ok":true,"service":"coucou-localai-service","bridge_ready":true,
            "mode":"BALANCED","busy":false,"computer_use_active":false,
            "ram_total_gib":16.0,"ram_available_gib":8.0,
            "capabilities":{"toolbox_api":1,"advanced_desktop":1,"voice_api":1,"telegram_account_api":2,"telegram_account_features":TELEGRAM_FEATURES}})
    }
    #[test]
    fn legacy_health_or_missing_protocol_and_features_cannot_be_reused() {
        assert!(!compatible_health(&json!({"ok":true})));
        assert!(!compatible_health(&json!({"ok":true,"service":"unrelated"})));
        let legacy = json!({"ok":true,"mode":"BALANCED","busy":false,"computer_use_active":false,
            "ram_total_gib":16.0,"ram_available_gib":8.0});
        assert!(!compatible_health(&legacy));
        assert!(compatible_health(&health()));
        for (field, replacement) in [("ok", json!(false)), ("service", json!("unrelated")),
            ("bridge_ready", json!(false)), ("mode", json!("UNKNOWN")),
            ("busy", json!("false")), ("computer_use_active", Value::Null), ("ram_total_gib", json!(-1))] {
            let mut bad = health();
            bad[field] = replacement;
            assert!(!compatible_health(&bad), "accepted invalid {field}");
        }
        for protocol in [Value::Null, json!(1), json!(3), json!("2")] {
            let mut bad = health();
            bad["capabilities"]["telegram_account_api"] = protocol;
            assert!(!compatible_health(&bad));
        }
        for missing in TELEGRAM_FEATURES {
            let mut bad = health();
            bad["capabilities"]["telegram_account_features"] = json!(TELEGRAM_FEATURES.into_iter()
                .filter(|feature| *feature != missing).collect::<Vec<_>>());
            assert!(!compatible_health(&bad), "accepted missing {missing}");
        }
    }
    #[test]
    fn legacy_service_uses_fallback_while_compatible_service_is_reused() {
        assert_eq!(choose_service(PortState::Free, None).unwrap(), ServiceChoice::Launch(11435));
        assert_eq!(choose_service(PortState::Compatible, Some(PortState::Free)).unwrap(), ServiceChoice::Reuse(11435));
        assert_eq!(choose_service(PortState::Occupied, Some(PortState::Free)).unwrap(), ServiceChoice::Launch(11437));
        assert_eq!(choose_service(PortState::Occupied, Some(PortState::Compatible)).unwrap(), ServiceChoice::Reuse(11437));
        assert!(choose_service(PortState::Occupied, Some(PortState::Occupied)).unwrap_err().contains("preserved"));
        assert!(choose_service(PortState::Occupied, None).is_err());
    }
    #[test]
    fn a_pre_voice_router_is_preserved_and_cannot_publish_the_new_bridge() {
        let mut old = health();
        old["capabilities"].as_object_mut().unwrap().remove("voice_api");
        assert!(!compatible_health(&old));
        assert_eq!(choose_service(PortState::Occupied, Some(PortState::Free)).unwrap(), ServiceChoice::Launch(FALLBACK_PORT));
        assert_eq!(choose_service(PortState::Occupied, Some(PortState::Compatible)).unwrap(), ServiceChoice::Reuse(FALLBACK_PORT));
        for version in [Value::Null, json!(0), json!(2), json!("1"), json!(true)] {
            let mut invalid = health();
            invalid["capabilities"]["voice_api"] = version;
            assert!(!compatible_health(&invalid));
        }
        assert!(compatible_health(&health()));
    }
    #[test]
    fn overlapping_start_is_coalesced_and_flag_is_released_on_cancelled_scope() {
        let state = LocalService::default();
        {
            let _first = state.begin_start().unwrap();
            assert!(state.begin_start().is_none());
            assert!(state.starting.load(Ordering::Acquire));
        }
        assert!(!state.starting.load(Ordering::Acquire));
        assert!(state.begin_start().is_some());
    }
    fn run<F: Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(future)
    }
    #[test]
    fn free_loopback_port_is_available_despite_delayed_windows_refusal() {
        let socket = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = socket.local_addr().unwrap().port();
        drop(socket);
        assert_eq!(run(inspect_port(port)), PortState::Free);
        // The availability probe must release its temporary reservation.
        let reservation = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).unwrap();
        drop(reservation);
    }
    #[test]
    fn existing_loopback_listener_is_preserved_without_compatible_health() {
        let socket = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = socket.local_addr().unwrap().port();
        // An ephemeral port is intentionally outside the fixed bridge URL
        // allowlist: a live TCP listener alone must never qualify for reuse.
        assert_eq!(run(inspect_port(port)), PortState::Occupied);
        assert_eq!(socket.local_addr().unwrap().port(), port);
    }
    #[test]
    fn readiness_waits_for_required_features_instead_of_a_live_process_only() {
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let result = run(wait_for_ready(11437, Duration::from_millis(500), |port| {
            assert_eq!(port, 11437);
            let mut value = health();
            if calls.fetch_add(1, Ordering::AcqRel) == 0 { value["bridge_ready"] = json!(false); }
            std::future::ready(Ok(value))
        }, || Ok(true), || false));
        assert!(result.is_ok());
        assert_eq!(calls.load(Ordering::Acquire), 2);
    }
    #[test]
    fn optional_slow_ollama_health_check_does_not_prevent_bridge_readiness() {
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let result = run(wait_for_ready(11437, Duration::from_secs(3), |_| {
            calls.fetch_add(1, Ordering::AcqRel);
            async { tokio::time::sleep(Duration::from_secs(2)).await; Ok(health()) }
        }, || Ok(true), || false));
        assert!(result.is_ok());
        assert_eq!(calls.load(Ordering::Acquire), 1, "a valid slow health response must not be repeatedly cancelled");
    }
    #[test]
    fn shutdown_during_health_probe_prevents_late_readiness() {
        let closing = AtomicBool::new(false);
        let result = run(wait_for_ready(11437, Duration::from_millis(100), |_| {
            closing.store(true, Ordering::Release);
            std::future::ready(Ok(health()))
        }, || Ok(true), || closing.load(Ordering::Acquire)));
        assert!(result.unwrap_err().contains("closing"));
        let state = LocalService::default();
        state.stopped.store(true, Ordering::Release);
        assert!(state.publish_ready(11437, false).is_err());
    }
    #[test]
    fn child_exit_during_probe_prevents_publishing_a_healthy_response() {
        let alive_checks = std::sync::atomic::AtomicUsize::new(0);
        let result = run(wait_for_ready(11435, Duration::from_millis(100), |_| std::future::ready(Ok(health())),
            || Ok(alive_checks.fetch_add(1, Ordering::AcqRel) == 0), || false));
        assert!(result.unwrap_err().contains("exited"));
    }
    #[test]
    fn unresponsive_health_has_a_bounded_startup_budget() {
        let started = std::time::Instant::now();
        let result = run(wait_for_ready(11437, Duration::from_millis(5), |_| std::future::pending::<Result<Value, String>>(),
            || Ok(true), || false));
        assert!(result.unwrap_err().contains("did not become ready"));
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
