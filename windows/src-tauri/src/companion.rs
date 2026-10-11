//! Visual pointing with our existing liquid Moshi. No mouse or keyboard input.
//! Flight math adapted from Plip flight.py, MIT © 2026 Hussain (see INSTALL-UZ).
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

static GENERATION: AtomicU64 = AtomicU64::new(0);
static POINTER_LOCK: Mutex<()> = Mutex::new(());
static TARGET: Mutex<Option<serde_json::Value>> = Mutex::new(None);
const LABEL: &str = "companion";
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Point { x: f64, y: f64, label: String, #[serde(default)] reduced_motion: bool }
fn valid(p: &Point) -> bool {
    p.x.is_finite() && p.y.is_finite() && p.x.abs() <= 100000.0 && p.y.abs() <= 100000.0
        && !p.label.trim().is_empty() && p.label.chars().count() <= 160 && !p.label.chars().any(char::is_control)
}
fn frame(start: (f64,f64), end: (f64,f64), progress: f64) -> (f64,f64) {
    let p = progress.clamp(0.0,1.0); let t = p*p*(3.0-2.0*p); let u = 1.0-t;
    let arc = ((end.0-start.0).hypot(end.1-start.1)*0.2).min(80.0);
    let c = ((start.0+end.0)/2.0,(start.1+end.1)/2.0-arc);
    (u*u*start.0+2.0*u*t*c.0+t*t*end.0,u*u*start.1+2.0*u*t*c.1+t*t*end.1)
}
pub fn setup(app: &AppHandle) {
    #[allow(unused_mut)] let mut url = WebviewUrl::App("companion.html".into());
    #[cfg(dev)] if let Some(mut base) = app.config().build.dev_url.clone() { base.set_path("/companion.html"); url = WebviewUrl::External(base); }
    match WebviewWindowBuilder::new(app,LABEL,url).additional_browser_args(crate::BROWSER_ARGS)
        .title("Moshi ko‘rsatgichi").inner_size(164.0,160.0).decorations(false).transparent(true)
        .shadow(false).always_on_top(true).skip_taskbar(true).focused(false).focusable(false)
        .resizable(false).maximizable(false).minimizable(false).closable(false)
        .disable_drag_drop_handler().visible(false).build() {
        Ok(w) => { let _ = w.set_ignore_cursor_events(true); crate::platform::make_non_activating(&w); },
        Err(e) => crate::log::line(format!("Moshi pointer window: {e}")),
    }
}
pub fn hide(app: &AppHandle) {
    let _guard=POINTER_LOCK.lock().unwrap_or_else(|e|e.into_inner());
    GENERATION.fetch_add(1,Ordering::SeqCst);
    *TARGET.lock().unwrap_or_else(|e|e.into_inner())=None;
    if let Some(w) = app.get_webview_window(LABEL) { let _ = w.emit("companion-visible",false); let _ = w.hide(); }
}
#[tauri::command] pub fn companion_hide(app: AppHandle) { hide(&app); }
#[tauri::command] pub fn companion_snapshot(app:AppHandle)->serde_json::Value {
    let _guard=POINTER_LOCK.lock().unwrap_or_else(|e|e.into_inner());
    json!({"visible":app.get_webview_window(LABEL).is_some_and(|w|w.is_visible().unwrap_or(false)),"target":TARGET.lock().unwrap_or_else(|e|e.into_inner()).clone()})
}
#[tauri::command]
pub fn companion_point(app: AppHandle, point: Point) -> Result<(),String> {
    let _guard=POINTER_LOCK.lock().unwrap_or_else(|e|e.into_inner());
    if !valid(&point) { return Err("Ko‘rsatish nuqtasi yaroqsiz".into()); }
    let w = app.get_webview_window(LABEL).ok_or("Moshi ko‘rsatgichi mavjud emas")?;
    let monitors = w.available_monitors().map_err(|_|"Ekranlar aniqlanmadi")?;
    let m = monitors.iter().find(|m| { let pos=m.position(); let size=m.size();
        point.x >= pos.x as f64 && point.y >= pos.y as f64 && point.x < pos.x as f64+size.width as f64 && point.y < pos.y as f64+size.height as f64
    }).ok_or("Nuqta ekran chegarasidan tashqarida")?;
    let scale=m.scale_factor(); let pos=m.position(); let size=m.size();
    let left=pos.x as f64; let top=pos.y as f64;
    let above = point.y-top >= 160.0*scale;
    let end=((point.x-82.0*scale).clamp(left,(left+size.width as f64-164.0*scale).max(left)),
        (if above {point.y-160.0*scale} else {point.y}).clamp(top,(top+size.height as f64-160.0*scale).max(top)));
    let start=crate::platform::cursor_physical().map(|(x,y)|(x-82.0*scale,y-80.0*scale)).unwrap_or(end);
    let id=GENERATION.fetch_add(1,Ordering::SeqCst)+1;
    let target=json!({"label":point.label,"above":above,"tip_x":(point.x-end.0)/scale});
    *TARGET.lock().unwrap_or_else(|e|e.into_inner())=Some(target.clone());
    let _=w.emit("companion-target",target);
    w.set_position(PhysicalPosition::new(start.0.round() as i32,start.1.round() as i32)).map_err(|_|"Moshi joylashtirilmadi")?;
    w.show().map_err(|_|"Moshi ko‘rsatilmadi")?; let _=w.emit("companion-visible",true);
    std::thread::spawn(move || {
        let duration=if point.reduced_motion {0.0} else {((end.0-start.0).hypot(end.1-start.1)/800.0).clamp(0.6,1.4)};
        let fly = |a:(f64,f64), b:(f64,f64), seconds:f64| {
            let clock=Instant::now();
            loop {
                let p=if seconds<=0.0 {1.0} else {(clock.elapsed().as_secs_f64()/seconds).min(1.0)};
                {let _guard=POINTER_LOCK.lock().unwrap_or_else(|e|e.into_inner());
                    if GENERATION.load(Ordering::SeqCst)!=id {return false;}
                    let at=frame(a,b,p); let _=w.set_position(PhysicalPosition::new(at.0.round() as i32,at.1.round() as i32));}
                if p>=1.0 {return true;} std::thread::sleep(Duration::from_millis(16));
            }
        };
        if !fly(start,end,if point.reduced_motion {0.0} else {duration.max(0.6)}) {return;}
        for _ in 0..80 { if GENERATION.load(Ordering::SeqCst)!=id {return;} std::thread::sleep(Duration::from_millis(50)); }
        if !fly(end,start,if point.reduced_motion {0.0} else {duration.max(0.6)}) {return;}
        let _guard=POINTER_LOCK.lock().unwrap_or_else(|e|e.into_inner());
        if GENERATION.load(Ordering::SeqCst)==id {*TARGET.lock().unwrap_or_else(|e|e.into_inner())=None;let _=w.emit("companion-visible",false);let _=w.hide();}
    });
    Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn flight_has_exact_endpoints_and_upward_arc(){let a=(10.0,20.0);let b=(810.0,20.0);assert_eq!(frame(a,b,0.0),a);assert_eq!(frame(a,b,1.0),b);let mid=frame(a,b,0.5);assert_eq!(mid.0,410.0);assert!(mid.1<20.0);}
    #[test] fn rejects_nonfinite_and_control_labels(){let mut p=Point{x:0.0,y:0.0,label:"Saqlash".into(),reduced_motion:false};assert!(valid(&p));p.x=f64::NAN;assert!(!valid(&p));p.x=0.0;p.label="x\ny".into();assert!(!valid(&p));}
}
