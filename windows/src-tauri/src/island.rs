// Island window: placement on the chosen display, the two window sizes
// (full panel / invisible wake strip), click-through and the cursor poll.
//
// There is no notch on a PC, so the island is a black shape drawn at the top
// centre of the main display inside a borderless, transparent, always-on-top
// window that never takes focus.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::platform::{self, cursor_physical, left_button_down};
use crate::settings::{Dock, IslandPosition};

/// Logical size of the full window — the largest island view, like the macOS panel.
pub const PANEL_W: f64 = 720.0;
pub const PANEL_H: f64 = 320.0;
/// Logical size of the invisible strip that wakes the island when it is hidden.
pub const STRIP_W: f64 = 240.0;
pub const STRIP_H: f64 = 6.0;

pub const WINDOW_LABEL: &str = "island";

/// Margin around the island that still counts as "on the island", in logical px.
/// Wider than the macOS 6 pt because a click must never be swallowed.
const HIT_MARGIN: f64 = 14.0;
const DRAG_THRESHOLD: f64 = 5.0;
const SNAP_DISTANCE: f64 = 48.0;

#[derive(Clone, Copy, Debug, PartialEq)]
struct Anchor {
    center: f64,
    top: f64,
}

#[derive(Clone, Copy, Debug)]
struct WorkArea {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale: f64,
}

impl WorkArea {
    fn of(monitor: &Monitor) -> Self {
        let work = monitor.work_area();
        let valid = work.size.width > 0 && work.size.height > 0;
        let (position, size) = if valid { (work.position, work.size) } else { (*monitor.position(), *monitor.size()) };
        Self { x: position.x as f64, y: position.y as f64,
            width: size.width.max(1) as f64, height: size.height.max(1) as f64,
            scale: monitor.scale_factor() }
    }

    fn panel_size(self) -> (f64, f64) {
        // A monitor smaller than the full panel cannot fit it: keep the native
        // window inside its work area rather than hiding controls off-screen.
        ((PANEL_W * self.scale).round().min(self.width).max(1.0),
         (PANEL_H * self.scale).round().min(self.height).max(1.0))
    }

    fn restore(self, x: f64, y: f64) -> Anchor {
        let (width, height) = self.panel_size();
        Anchor { center: self.x + x.clamp(0.0, 1.0) * (self.width - width).max(0.0) + width / 2.0,
            top: self.y + y.clamp(0.0, 1.0) * (self.height - height).max(0.0) }
    }

    fn clamp(self, anchor: Anchor) -> Anchor {
        let (width, height) = self.panel_size();
        Anchor { center: anchor.center.clamp(self.x + width / 2.0, self.x + self.width - width / 2.0),
            top: anchor.top.clamp(self.y, self.y + (self.height - height).max(0.0)) }
    }

    fn normalize(self, anchor: Anchor) -> (f64, f64) {
        let anchor = self.clamp(anchor);
        let (width, height) = self.panel_size();
        let sx = (self.width - width).max(0.0);
        let sy = (self.height - height).max(0.0);
        (if sx > 0.0 { ((anchor.center - width / 2.0 - self.x) / sx).clamp(0.0, 1.0) } else { 0.5 },
         if sy > 0.0 { ((anchor.top - self.y) / sy).clamp(0.0, 1.0) } else { 0.0 })
    }

    fn dock_anchor(self, anchor: Anchor, dock: Dock) -> Anchor {
        let mut anchor = self.clamp(anchor);
        let (width, height) = self.panel_size();
        if dock.left() { anchor.center = self.x + width / 2.0; }
        if dock.right() { anchor.center = self.x + self.width - width / 2.0; }
        if dock.top() { anchor.top = self.y; }
        if dock.bottom() { anchor.top = self.y + self.height - height; }
        anchor
    }

    fn painted_rect(self, anchor: Anchor, rect: IslandRect) -> Option<VisibleRect> {
        if !rect.usable() { return None; }
        let (width,height) = self.panel_size();
        let x = (rect.x*self.scale).clamp(0.0,width);
        let y = (rect.y*self.scale).clamp(0.0,height);
        let right = ((rect.x+rect.w)*self.scale).clamp(x,width);
        let bottom = ((rect.y+rect.h)*self.scale).clamp(y,height);
        if right<=x || bottom<=y { return None; }
        Some(VisibleRect { x:anchor.center-width/2.0+x,y:anchor.top+y,w:right-x,h:bottom-y,scale:self.scale })
    }

    fn clamp_painted(self, anchor: Anchor, rect: IslandRect) -> Anchor {
        let Some(painted) = self.painted_rect(anchor,rect) else { return self.clamp(anchor) };
        let (width,_) = self.panel_size();
        let offset_x = painted.x-(anchor.center-width/2.0);
        let offset_y = painted.y-anchor.top;
        Anchor {
            center:(anchor.center-width/2.0).clamp(self.x-offset_x,self.x+self.width-offset_x-painted.w)+width/2.0,
            top:anchor.top.clamp(self.y-offset_y,self.y+self.height-offset_y-painted.h),
        }
    }

    fn settle_painted(self, anchor: Anchor, rect: IslandRect, dock: Dock, compact: bool) -> Anchor {
        let Some(painted) = self.painted_rect(anchor,rect) else { return self.dock_anchor(anchor,dock) };
        let (w,h) = if compact { compact_dimensions(dock) } else { (rect.w,rect.h) };
        let target = dock_rect(dock,w,h);
        let (host_width,_) = self.panel_size();
        let origin_x = painted.x+painted.w/2.0-(target.x+target.w/2.0)*self.scale;
        let origin_y = painted.y+painted.h/2.0-(target.y+target.h/2.0)*self.scale;
        self.dock_anchor(Anchor { center:origin_x+host_width/2.0,top:origin_y },dock)
    }

    fn window_rect(self, anchor: Anchor, collapsed: bool, dock: Dock) -> (i32, i32, u32, u32) {
        self.window_rect_at(self.clamp(anchor),collapsed,dock)
    }

    fn window_rect_at(self, anchor: Anchor, collapsed: bool, dock: Dock) -> (i32, i32, u32, u32) {
        let (panel_width, panel_height) = self.panel_size();
        let (width, height) = if !collapsed { (panel_width, panel_height) }
        else {
            let (w, h) = if dock.corner() { (80.0, STRIP_H) }
                else if dock.left() || dock.right() { (STRIP_H, 192.0) }
                else { (STRIP_W, STRIP_H) };
            ((w * self.scale).round().min(panel_width).max(1.0),
             (h * self.scale).round().min(panel_height).max(1.0))
        };
        let left = anchor.center - panel_width / 2.0;
        let x = if collapsed && dock.left() { left }
            else if collapsed && dock.right() { left + panel_width - width }
            else { anchor.center - width / 2.0 };
        let y = if collapsed && dock.bottom() { anchor.top + panel_height - height }
            else if collapsed && (dock == Dock::Left || dock == Dock::Right) { anchor.top + (panel_height - height) / 2.0 }
            else { anchor.top };
        (x.round() as i32, y.round() as i32,
            width as u32, height as u32)
    }
}

/// Physical visible shape, shared by docking and Desktop Mochi home geometry.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct VisibleRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub scale: f64,
}

fn choose_dock(work: WorkArea, visible: Option<VisibleRect>, cursor: Option<(f64, f64)>) -> Dock {
    let limit = SNAP_DISTANCE * work.scale;
    let edge = |point: Option<f64>, rect: Option<(f64, f64)>, start: f64, end: f64| -> i8 {
        let nearest = |a: f64, b: f64| {
            if a.min(b) > limit { 0 } else if a <= b { -1 } else { 1 }
        };
        // A naturally released grip need not be close to the edge. A painted
        // edge already flush with the workarea is the strongest snap signal.
        if let Some((a,b)) = rect {
            let (a,b) = ((a-start).abs(),(b-end).abs());
            if a<=1.0 && b>1.0 { return -1; }
            if b<=1.0 && a>1.0 { return 1; }
        }
        if let Some(point) = point {
            let by_cursor = nearest((point - start).abs(), (point - end).abs());
            if by_cursor != 0 { return by_cursor; }
        }
        rect.map_or(0, |(a, b)| nearest((a - start).abs(), (b - end).abs()))
    };
    let horizontal = edge(cursor.map(|p| p.0), visible.map(|r| (r.x, r.x + r.w)), work.x, work.x + work.width);
    let vertical = edge(cursor.map(|p| p.1), visible.map(|r| (r.y, r.y + r.h)), work.y, work.y + work.height);
    match (horizontal, vertical) {
        (-1, -1) => Dock::TopLeft, (1, -1) => Dock::TopRight,
        (-1, 1) => Dock::BottomLeft, (1, 1) => Dock::BottomRight,
        (-1, _) => Dock::Left, (1, _) => Dock::Right,
        (_, -1) => Dock::Top, (_, 1) => Dock::Bottom,
        _ => Dock::Free,
    }
}

fn crosses_drag_threshold(start: Anchor, candidate: Anchor, scale: f64) -> bool {
    (candidate.center - start.center).hypot(candidate.top - start.top) >= DRAG_THRESHOLD * scale
}

#[derive(Clone)]
struct Placement {
    monitor: String,
    anchor: Anchor,
    dock: Dock,
}

#[derive(Clone)]
struct Drag {
    mouse: bool,
    cursor: (f64, f64),
    last_cursor: (f64, f64),
    scale: f64,
    start: Placement,
    current: Placement,
    moved: bool,
    visible: IslandRect,
    compact: bool,
}

#[derive(Clone, Serialize)]
struct DragEnded {
    moved: bool,
    cancelled: bool,
}

#[derive(Serialize, Clone)]
pub struct CursorPayload {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Clone)]
pub struct ScreenInfo {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

/// The island shape in window-logical coordinates, pushed by the front end.
/// The poll thread owns the click-through decision so it lands in the same 16 ms
/// tick as the cursor read — an IPC round trip here loses clicks.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct IslandRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl IslandRect {
    fn usable(self) -> bool {
        [self.x,self.y,self.w,self.h].iter().all(|n| n.is_finite()) && self.w>0.0 && self.h>0.0
    }
}

fn compact_dimensions(dock: Dock) -> (f64,f64) {
    if dock.corner() { (80.0,80.0) } else if dock==Dock::Left || dock==Dock::Right { (40.0,192.0) } else { (288.0,32.0) }
}

fn dock_rect(dock: Dock, w: f64, h: f64) -> IslandRect {
    IslandRect { x:if dock.left() { 0.0 } else if dock.right() { PANEL_W-w } else { (PANEL_W-w)/2.0 },
        y:if dock.bottom() { PANEL_H-h } else if dock==Dock::Left || dock==Dock::Right { (PANEL_H-h)/2.0 } else { 0.0 },w,h }
}

fn looks_compact(rect: IslandRect, dock: Dock) -> bool {
    let (w,h) = compact_dimensions(dock);
    (rect.w-w).abs()<0.5 && (rect.h-h).abs()<0.5
}

/// Wakes / parks the cursor poll thread so a hidden island costs literally nothing.
pub struct PollGate {
    active: Mutex<bool>,
    cv: Condvar,
    pub collapsed: AtomicBool,
    pub rect: Mutex<IslandRect>,
    compact: Mutex<Option<bool>>,
    /// Mirrors the window flag so we only call into the OS when it changes.
    ignoring: AtomicBool,
    drag: Mutex<Option<Drag>>,
    drag_tick_pending: AtomicBool,
}

impl PollGate {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(false),
            cv: Condvar::new(),
            collapsed: AtomicBool::new(true),
            rect: Mutex::new(IslandRect::default()),
            compact: Mutex::new(None),
            ignoring: AtomicBool::new(false),
            drag: Mutex::new(None),
            drag_tick_pending: AtomicBool::new(false),
        }
    }

    pub fn set_rect(&self, rect: IslandRect, compact: Option<bool>) {
        *self.rect.lock().unwrap() = rect;
        if compact.is_some() { *self.compact.lock().unwrap() = compact; }
    }

    /// Forces the next poll tick to re-apply the flag (after a window resize).
    pub fn forget_ignore_state(&self) {
        self.ignoring.store(false, Ordering::Relaxed);
    }

    pub fn set_active(&self, on: bool) {
        let mut guard = self.active.lock().unwrap();
        *guard = on;
        self.cv.notify_all();
    }

    pub(crate) fn wait_until_active(&self) {
        let mut guard = self.active.lock().unwrap();
        while !*guard {
            guard = self.cv.wait(guard).unwrap();
        }
    }

    pub(crate) fn is_active(&self) -> bool {
        *self.active.lock().unwrap()
    }

    pub fn is_dragging(&self) -> bool {
        self.drag.lock().unwrap().is_some()
    }
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

fn monitor_contains(m: &Monitor, x: f64, y: f64) -> bool {
    let p = m.position();
    let s = m.size();
    x >= p.x as f64
        && x < (p.x + s.width as i32) as f64
        && y >= p.y as f64
        && y < (p.y + s.height as i32) as f64
}

/// A display's logical origin, the key `at:<x>,<y>` preferences are matched on.
/// Names are no good for that: two monitors of the same model share one.
fn logical_origin(m: &Monitor) -> (i32, i32) {
    let scale = m.scale_factor();
    let p = m.position();
    ((p.x as f64 / scale).round() as i32, (p.y as f64 / scale).round() as i32)
}

/// One entry of the "Island lives on" list in Settings.
#[derive(Serialize, Clone)]
pub struct MonitorChoice {
    pub key: String,
    pub label: String,
}

pub fn monitor_choices(app: &AppHandle) -> Vec<MonitorChoice> {
    let Ok(monitors) = app.available_monitors() else { return Vec::new() };
    monitors
        .iter()
        .map(|m| {
            let d = describe(m);
            MonitorChoice {
                key: d.key(),
                label: crate::i18n::tf(
                    "{name} — {width}×{height} at {x},{y}",
                    &[
                        ("name", &d.name),
                        ("width", &d.w.to_string()),
                        ("height", &d.h.to_string()),
                        ("x", &d.x.to_string()),
                        ("y", &d.y.to_string()),
                    ],
                ),
            }
        })
        .collect()
}

/// What a display is remembered by: its logical origin, plus its name and
/// logical size, so it is still found after the layout is rearranged or the
/// resolution changes (the Mac keeps the display's UUID for the same reason;
/// Tauri has no stable ID).
#[derive(Debug, Clone, PartialEq)]
struct DisplayId {
    name: String,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

impl DisplayId {
    /// `at:<x>,<y>` stays first, so a preference saved before still matches.
    fn key(&self) -> String {
        format!("at:{},{}|{}|{}x{}", self.x, self.y, self.name.replace('|', " "), self.w, self.h)
    }
}

fn describe(m: &Monitor) -> DisplayId {
    let (x, y) = logical_origin(m);
    let scale = m.scale_factor();
    let s = m.size();
    DisplayId {
        name: m.name().cloned().unwrap_or_else(|| "Display".into()),
        x,
        y,
        w: (s.width as f64 / scale).round() as i32,
        h: (s.height as f64 / scale).round() as i32,
    }
}

/// Which display a saved `at:` preference points at, best match first: same
/// place and name; the same name and size elsewhere (layout rearranged); the
/// same name alone when unique (resolution changed); the same place. None
/// means unplugged, and the caller falls back to the primary display.
fn pick_display(pref: &str, displays: &[DisplayId]) -> Option<usize> {
    let rest = pref.strip_prefix("at:")?;
    let mut parts = rest.split('|');
    let (x, y) = parts.next()?.split_once(',')?;
    let (x, y) = (x.trim().parse::<i32>().ok()?, y.trim().parse::<i32>().ok()?);
    let name = parts.next();
    let size = parts.next().and_then(|s| {
        let (w, h) = s.split_once('x')?;
        Some((w.parse::<i32>().ok()?, h.parse::<i32>().ok()?))
    });
    let at = |d: &DisplayId| d.x == x && d.y == y;
    if let Some(name) = name {
        if let Some(i) = displays.iter().position(|d| at(d) && d.name == name) {
            return Some(i);
        }
        if let Some((w, h)) = size {
            if let Some(i) = displays.iter().position(|d| d.name == name && d.w == w && d.h == h) {
                return Some(i);
            }
        }
        let mut same_name = displays.iter().enumerate().filter(|(_, d)| d.name == name);
        if let (Some((i, _)), None) = (same_name.next(), same_name.next()) {
            return Some(i);
        }
    }
    displays.iter().position(at)
}

/// The display the island lives on: a chosen one, the primary one, or the one
/// under the cursor.
fn target_monitor(app: &AppHandle, pref: &str) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    let ids: Vec<DisplayId> = monitors.iter().map(describe).collect();
    if let Some(i) = pick_display(pref, &ids) {
        return Some(monitors[i].clone());
    }
    if pref == "cursor" {
        if let Some((cx, cy)) = cursor_physical() {
            if let Some(m) = monitors.iter().find(|m| monitor_contains(m, cx, cy)) {
                return Some(m.clone());
            }
        }
    }
    app.primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.into_iter().next())
}

pub(crate) fn visible_rect_physical(app: &AppHandle) -> Option<VisibleRect> {
    let shared = app.try_state::<crate::Shared>()?;
    let win = window(app)?;
    let pos = win.outer_position().ok()?;
    let size = win.inner_size().ok()?;
    let scale = win.scale_factor().ok()?;
    if shared.gate.collapsed.load(Ordering::Relaxed) {
        // The frontend rect belongs to the last full viewport; the narrow wake
        // window itself is the only current visible/drop target while hidden.
        return Some(VisibleRect { x: pos.x as f64, y: pos.y as f64,
            w: size.width as f64, h: size.height as f64, scale });
    }
    let rect = *shared.gate.rect.lock().unwrap();
    if ![rect.x, rect.y, rect.w, rect.h].iter().all(|n| n.is_finite()) || rect.w <= 0.0 || rect.h <= 0.0 { return None; }
    let x = (rect.x * scale).clamp(0.0, size.width as f64);
    let y = (rect.y * scale).clamp(0.0, size.height as f64);
    let right = ((rect.x + rect.w) * scale).clamp(x, size.width as f64);
    let bottom = ((rect.y + rect.h) * scale).clamp(y, size.height as f64);
    if right <= x || bottom <= y { return None; }
    Some(VisibleRect { x: pos.x as f64 + x, y: pos.y as f64 + y, w: right - x, h: bottom - y, scale })
}

fn preferred_monitor(app: &AppHandle, pref: &str) -> Option<Monitor> {
    let saved = app.try_state::<crate::Shared>()
        .and_then(|s| s.settings.lock().unwrap().island_position.clone());
    target_monitor(app, saved.as_ref().map_or(pref, |p| p.monitor.as_str()))
}

fn monitor_at(app: &AppHandle, x: f64, y: f64) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    if let Some(monitor) = monitors.iter().find(|m| monitor_contains(m, x, y)) {
        return Some(monitor.clone());
    }
    // The cursor can be in a gap between staggered displays. Use the closest
    // frame instead of jumping to the primary display in that gap.
    monitors.into_iter().min_by(|a, b| {
        let distance = |m: &Monitor| {
            let p = m.position(); let s = m.size();
            let dx = x - x.clamp(p.x as f64, p.x as f64 + s.width as f64);
            let dy = y - y.clamp(p.y as f64, p.y as f64 + s.height as f64);
            dx * dx + dy * dy
        };
        distance(a).total_cmp(&distance(b))
    })
}

pub fn begin_drag(app: &AppHandle, pointer_type: &str, client_x: Option<f64>, client_y: Option<f64>) -> bool {
    let mouse = match pointer_type { "mouse" => true, "touch" | "pen" => false, _ => return false };
    if mouse && (!platform::CURSOR_POLL || !left_button_down()) { return false; }
    let Some(shared) = app.try_state::<crate::Shared>() else { return false };
    if shared.gate.collapsed.load(Ordering::Relaxed) { return false; }
    let Some(win) = window(app) else { return false };
    let Ok(origin) = win.outer_position() else { return false };
    let Ok(size) = win.outer_size() else { return false };
    let (pref, dock) = {
        let settings = shared.settings.lock().unwrap();
        (settings.screen.clone(), settings.island_position.as_ref().map_or(Dock::Top, |p| p.dock))
    };
    let Some(monitor) = win.current_monitor().ok().flatten().or_else(|| preferred_monitor(app, &pref)) else { return false };
    let anchor = Anchor { center: origin.x as f64 + size.width as f64 / 2.0, top: origin.y as f64 };
    let placement = Placement { monitor: describe(&monitor).key(), anchor: WorkArea::of(&monitor).clamp(anchor), dock };
    let cursor = if !mouse {
        match (client_x, client_y) {
            (Some(x), Some(y)) if x.is_finite() && y.is_finite() => (origin.x as f64 + x * monitor.scale_factor(), origin.y as f64 + y * monitor.scale_factor()),
            _ => visible_rect_physical(app).map_or((anchor.center, anchor.top), |r| (r.x + r.w / 2.0, r.y + r.h / 2.0)),
        }
    } else { cursor_physical().unwrap_or((anchor.center, anchor.top)) };
    let live_rect = *shared.gate.rect.lock().unwrap();
    let visible = if live_rect.usable() { live_rect } else { dock_rect(dock,PANEL_W,PANEL_H) };
    let compact = shared.gate.compact.lock().unwrap().unwrap_or_else(|| looks_compact(visible,dock));
    {
        let mut drag = shared.gate.drag.lock().unwrap();
        if drag.is_some() { return false; }
        *drag = Some(Drag { mouse, cursor, last_cursor: cursor, scale: monitor.scale_factor(), start: placement.clone(), current: placement, moved: false,visible,compact });
    }
    shared.gate.set_active(true);
    refresh_click_through(app, &shared.gate);
    true
}

fn update_drag(app: &AppHandle, dx: f64, dy: f64, pointer: Option<(f64, f64)>) {
    if !dx.is_finite() || !dy.is_finite() { return; }
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let snapshot = shared.gate.drag.lock().unwrap().clone();
    let Some(snapshot) = snapshot else { return };
    let proposed = Anchor { center: snapshot.start.anchor.center + dx, top: snapshot.start.anchor.top + dy };
    let (px, py) = pointer.unwrap_or((proposed.center, proposed.top + 1.0));
    let Some(monitor) = monitor_at(app, px, py) else { return };
    let live_rect = *shared.gate.rect.lock().unwrap();
    let visible = if live_rect.usable() { live_rect } else { snapshot.visible };
    let compact = shared.gate.compact.lock().unwrap().unwrap_or_else(|| looks_compact(visible,snapshot.start.dock));
    let anchor = WorkArea::of(&monitor).clamp_painted(proposed,visible);
    let monitor_key = describe(&monitor).key();
    let placement = {
        let mut held = shared.gate.drag.lock().unwrap();
        let Some(drag) = held.as_mut() else { return };
        drag.last_cursor = (px, py);
        drag.visible = visible;
        drag.compact = compact;
        // An outward gesture at an already clamped edge can still change dock;
        // measure the attempted pointer movement, not just window displacement.
        if !drag.moved && !crosses_drag_threshold(drag.start.anchor, proposed, drag.scale) { return; }
        if drag.moved && drag.current.monitor == monitor_key && drag.current.anchor == anchor { return; }
        drag.moved = true;
        drag.current = Placement { monitor: monitor_key, anchor, dock: drag.start.dock };
        drag.current.clone()
    };
    place_window(app, &monitor, placement.anchor, false, placement.dock,Some(visible));
}

pub fn update_pointer_drag(app: &AppHandle, delta_x: f64, delta_y: f64) {
    if !delta_x.is_finite() || !delta_y.is_finite() { return; }
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let snapshot = shared.gate.drag.lock().unwrap().clone();
    let Some(drag) = snapshot.filter(|d| !d.mouse) else { return };
    let delta = (delta_x * drag.scale, delta_y * drag.scale);
    update_drag(app, delta.0, delta.1, Some((drag.cursor.0 + delta.0, drag.cursor.1 + delta.1)));
}

pub fn end_drag(app: &AppHandle, cancelled: bool) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    if !cancelled {
        let snapshot = shared.gate.drag.lock().unwrap().clone();
        if let Some(drag) = snapshot {
            let cursor = if drag.mouse { cursor_physical().unwrap_or(drag.last_cursor) } else { drag.last_cursor };
            // Flush final movement and live shape/compact changes for every
            // pointer type, including resize after the last touchmove.
            update_drag(app,cursor.0-drag.cursor.0,cursor.1-drag.cursor.1,Some(cursor));
        }
    }
    let Some(drag) = shared.gate.drag.lock().unwrap().take() else { return };
    let mut placement = if cancelled || !drag.moved { drag.start } else { drag.current };
    if let Some(monitor) = target_monitor(app, &placement.monitor) {
        let work = WorkArea::of(&monitor);
        if drag.moved && !cancelled {
            placement.dock = choose_dock(work, work.painted_rect(placement.anchor,drag.visible), Some(drag.last_cursor));
        }
        let anchor = if drag.moved && !cancelled { work.settle_painted(placement.anchor,drag.visible,placement.dock,drag.compact) }
            else { work.dock_anchor(placement.anchor,placement.dock) };
        if drag.moved && !cancelled {
            let (x, y) = work.normalize(anchor);
            let settings = {
                let mut settings = shared.settings.lock().unwrap();
                settings.island_position = Some(IslandPosition { monitor: describe(&monitor).key(), x, y, dock: placement.dock });
                // Serialize under the same settings lock as the native update.
                if let Err(error) = crate::settings::save(&settings) {
                    crate::log::line(format!("could not save island position: {error}"));
                }
                settings.clone()
            };
            let _ = app.emit("settings-changed", settings);
        }
        place_window(app, &monitor, anchor, shared.gate.collapsed.load(Ordering::Relaxed), placement.dock,None);
    }
    refresh_click_through(app, &shared.gate);
    let _ = app.emit_to(WINDOW_LABEL, "island-drag-ended", DragEnded { moved: drag.moved && !cancelled, cancelled });
    if shared.gate.collapsed.load(Ordering::Relaxed) {
        shared.gate.set_active(false);
        platform::set_pointer_watch(false);
    }
}

fn request_drag_tick(app: &AppHandle, gate: &Arc<PollGate>) {
    if !gate.drag.lock().unwrap().as_ref().is_some_and(|drag| drag.mouse)
        || gate.drag_tick_pending.swap(true, Ordering::Relaxed) { return; }
    let handle = app.clone();
    let tick_gate = gate.clone();
    // Window moves and command-driven geometry share the main thread. A late
    // poll tick cannot put back a pre-release/pre-reset rectangle.
    if app.run_on_main_thread(move || {
        let snapshot = tick_gate.drag.lock().unwrap().clone();
        if let Some(drag) = snapshot.filter(|d| d.mouse) {
            if !left_button_down() {
                end_drag(&handle, false);
            } else if let Some(cursor) = cursor_physical() {
                update_drag(&handle, cursor.0 - drag.cursor.0, cursor.1 - drag.cursor.1, Some(cursor));
            }
        }
        tick_gate.drag_tick_pending.store(false, Ordering::Relaxed);
    }).is_err() {
        gate.drag_tick_pending.store(false, Ordering::Relaxed);
    }
}

pub fn reset_position(app: &AppHandle) {
    end_drag(app, true);
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let settings = {
        let mut settings = shared.settings.lock().unwrap();
        settings.island_position = None;
        if let Err(error) = crate::settings::save(&settings) {
            crate::log::line(format!("could not reset island position: {error}"));
        }
        settings.clone()
    };
    apply_geometry(app, &settings.screen, shared.gate.collapsed.load(Ordering::Relaxed));
    let _ = app.emit("settings-changed", settings);
}

pub fn set_dock(app: &AppHandle, dock: Dock) {
    end_drag(app, true);
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let snapshot = shared.settings.lock().unwrap().clone();
    let Some(monitor) = preferred_monitor(app, &snapshot.screen) else { return };
    let work = WorkArea::of(&monitor);
    let start = snapshot.island_position.as_ref().map_or_else(|| work.restore(0.5, 0.0), |p| work.restore(p.x, p.y));
    let anchor = work.dock_anchor(start, dock);
    let (x, y) = work.normalize(anchor);
    let settings = {
        let mut settings = shared.settings.lock().unwrap();
        settings.island_position = Some(IslandPosition { monitor: describe(&monitor).key(), x, y, dock });
        if let Err(error) = crate::settings::save(&settings) { crate::log::line(format!("could not save island dock: {error}")); }
        settings.clone()
    };
    apply_geometry(app, &settings.screen, shared.gate.collapsed.load(Ordering::Relaxed));
    refresh_click_through(app, &shared.gate);
    let _ = app.emit("settings-changed", settings);
}

#[cfg(test)]
mod display_tests {
    use super::*;

    fn d(name: &str, x: i32, y: i32, w: i32, h: i32) -> DisplayId {
        DisplayId { name: name.into(), x, y, w, h }
    }

    #[test]
    fn a_display_is_found_again_after_changes() {
        let dell = d("DELL U2720Q", 1920, 0, 2560, 1440);
        let lap = d("eDP-1", 0, 0, 1920, 1200);
        let key = dell.key();
        assert_eq!(pick_display(&key, &[lap.clone(), dell.clone()]), Some(1));
        // Rearranged: the Dell moved to the left of the laptop.
        let moved = [d("eDP-1", 2560, 0, 1920, 1200), d("DELL U2720Q", 0, 0, 2560, 1440)];
        assert_eq!(pick_display(&key, &moved), Some(1));
        // Resolution changed, still the only Dell.
        let rescaled = [lap.clone(), d("DELL U2720Q", 1920, 0, 1920, 1080)];
        assert_eq!(pick_display(&key, &rescaled), Some(1));
        // Unplugged: nothing, so the caller falls back to the primary display.
        assert_eq!(pick_display(&key, &[lap.clone()]), None);
    }

    #[test]
    fn two_identical_monitors_are_told_apart_by_place() {
        let a = d("LG 27UL500", 0, 0, 1920, 1080);
        let b = d("LG 27UL500", 1920, 0, 1920, 1080);
        assert_eq!(pick_display(&b.key(), &[a.clone(), b.clone()]), Some(1));
        assert_eq!(pick_display(&a.key(), &[a, b]), Some(0));
    }

    #[test]
    fn preferences_saved_before_still_match() {
        let lap = d("eDP-1", 0, 0, 1920, 1200);
        let ext = d("HDMI-1", 1920, 0, 1920, 1080);
        assert_eq!(pick_display("at:1920,0", &[lap.clone(), ext.clone()]), Some(1));
        assert_eq!(pick_display("primary", &[lap, ext]), None);
        assert_eq!(pick_display("at:nonsense", &[]), None);
    }
}

pub fn screen_info(app: &AppHandle, pref: &str) -> ScreenInfo {
    match preferred_monitor(app, pref) {
        Some(m) => {
            let scale = m.scale_factor();
            let p = m.position();
            let s = m.size();
            ScreenInfo {
                x: p.x as f64 / scale,
                y: p.y as f64 / scale,
                width: s.width as f64 / scale,
                height: s.height as f64 / scale,
                scale,
            }
        }
        None => ScreenInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale: 1.0 },
    }
}

/// Places and sizes the window. `collapsed` picks the wake strip instead of the panel.
pub fn apply_geometry(app: &AppHandle, pref: &str, collapsed: bool) {
    let shared = app.try_state::<crate::Shared>();
    let dragging = shared.as_ref().and_then(|s| s.gate.drag.lock().unwrap().clone());
    let saved = shared.as_ref().and_then(|s| s.settings.lock().unwrap().island_position.clone());
    let monitor_pref = dragging.as_ref().map(|d| d.current.monitor.as_str())
        .or_else(|| saved.as_ref().map(|p| p.monitor.as_str())).unwrap_or(pref);
    let Some(m) = target_monitor(app, monitor_pref) else { return };
    let work = WorkArea::of(&m);
    let (anchor,dock,drag_bounds) = if let Some(drag) = dragging {
        let live = shared.as_ref().map(|s| *s.gate.rect.lock().unwrap());
        let rect = live.filter(|r| r.usable()).unwrap_or(drag.visible);
        (work.clamp_painted(drag.current.anchor,rect),drag.current.dock,Some(rect))
    } else if let Some(saved) = saved { (work.dock_anchor(work.restore(saved.x,saved.y),saved.dock),saved.dock,None) }
        else { (work.restore(0.5,0.0),Dock::Top,None) };
    place_window(app,&m,anchor,collapsed,dock,drag_bounds);
}

fn place_window(app: &AppHandle, m: &Monitor, anchor: Anchor, collapsed: bool, dock: Dock, drag_bounds: Option<IslandRect>) {
    let Some(win) = window(app) else { return };

    let work = WorkArea::of(m);
    let (x,y,pw,ph) = if let Some(rect) = drag_bounds {
        work.window_rect_at(work.clamp_painted(anchor,rect),false,dock)
    } else { work.window_rect(anchor,collapsed,dock) };

    // GTK never sizes a non-resizable window below its natural size (200 px
    // here), so on Linux the 6 px wake strip would stay a 200 px block. tao
    // re-applies the config's `resizable: false` after the first configure, so
    // this is asked every time, just before the resize. Undecorated, the window
    // still offers the user nothing to resize it by. (Found by @YossiYad, #44.)
    #[cfg(target_os = "linux")]
    let _ = win.set_resizable(true);
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let (lx, ly) = logical_origin(m);
    platform::pin_to_monitor(&win, lx, ly);
    // Moving across displays can rescale the window: re-assert the physical size.
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_always_on_top(true);
}

/// Position, size and scale of the monitor the island lives on. Any change here
/// means the island has to be placed again.
fn current_screen_key(app: &AppHandle) -> Option<(i32, i32, u32, u32, i32, i32, u32, u32, u64)> {
    let pref = app
        .try_state::<crate::Shared>()
        .map(|s| s.settings.lock().unwrap().screen.clone())
        .unwrap_or_else(|| "primary".into());
    let m = preferred_monitor(app, &pref)?;
    let p = m.position();
    let size = m.size();
    let work = m.work_area();
    Some((p.x, p.y, size.width, size.height, work.position.x, work.position.y,
        work.size.width, work.size.height, m.scale_factor().to_bits()))
}

/// Emits `cursor` (window-logical coordinates) at ~60 Hz while the island is
/// visible. Parked on a condvar the rest of the time.
pub fn spawn_cursor_poll(app: AppHandle, gate: Arc<PollGate>) {
    std::thread::spawn(move || {
        let mut was_down = false;
        // Remembered across wakes so a display change while hidden is noticed the
        // moment the island comes back.
        let mut last_screen: Option<(i32, i32, u32, u32, i32, i32, u32, u32, u64)> = None;
        // Without a cursor to read (Linux) the loop only watches the display
        // layout, and twice a second is plenty for that: waking at 60 Hz just to
        // find no cursor costs CPU for nothing.
        let (period, screen_every) = if platform::CURSOR_POLL { (16, 30) } else { (500, 1) };
        loop {
            gate.wait_until_active();
            let mut last = (f64::MIN, f64::MIN);
            let mut ticks: u32 = 0;
            while gate.is_active() {
                std::thread::sleep(Duration::from_millis(period));
                request_drag_tick(&app, &gate);

                // Monitors get plugged in, unplugged, rearranged and rescaled, and
                // an island pinned to coordinates that no longer exist is an island
                // nobody can reach. Checked about twice a second — the cursor poll
                // is already running, so this costs one monitor query.
                ticks = ticks.wrapping_add(1);
                if ticks % screen_every == 0 {
                    let now = current_screen_key(&app);
                    if now.is_some() && now != last_screen {
                        let first = last_screen.is_none();
                        last_screen = now;
                        if !first {
                            crate::log::line("display layout changed — repositioning".to_string());
                            let _ = app.emit_to(WINDOW_LABEL, "screen-changed", ());
                        }
                    }
                }

                let Some(win) = window(&app) else { continue };
                let Ok(origin) = win.outer_position() else { continue };
                let scale = win.scale_factor().unwrap_or(1.0);
                let Some((cx, cy)) = cursor_physical() else { continue };
                let x = (cx - origin.x as f64) / scale;
                let y = (cy - origin.y as f64) / scale;
                let size = match win.inner_size() {
                    Ok(s) => (s.width as f64 / scale, s.height as f64 / scale),
                    Err(_) => (PANEL_W, PANEL_H),
                };
                let cursor_changed = (x - last.0).abs() >= 1.0 || (y - last.1).abs() >= 1.0;

                // Click-through: the window only takes the mouse over the island
                // shape. A small entry margin means the flag is already off by the
                // time a moving cursor reaches a button.
                let r = *gate.rect.lock().unwrap();
                let on_island = r.w > 0.0
                    && x >= r.x - HIT_MARGIN
                    && x <= r.x + r.w + HIT_MARGIN
                    && y >= r.y - HIT_MARGIN
                    && y <= r.y + r.h + HIT_MARGIN;

                // A file being dragged has to be able to find us. WS_EX_TRANSPARENT
                // — what click-through is on Windows — hides the window from
                // WindowFromPoint, so OLE finds no drop target and shows the "no
                // drop" cursor. macOS has no such problem: AppKit delivers drags to
                // registered destinations whatever ignoresMouseEvents says. So while
                // a button is held anywhere over the panel, the whole panel takes
                // the mouse, which also makes the drop zone as forgiving as the Mac's.
                // A press may be the start of a drag: make sure the drop target is
                // ours before the file arrives.
                let down = left_button_down();
                if down && !was_down {
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || platform::unblock_webview_drops(&handle));
                }
                was_down = down;

                let dragging = down
                    && x >= 0.0
                    && x <= size.0
                    && y >= 0.0
                    && y <= size.1;

                let accept = on_island || dragging || gate.is_dragging();
                if gate.ignoring.load(Ordering::Relaxed) == accept {
                    gate.ignoring.store(!accept, Ordering::Relaxed);
                    let _ = win.set_ignore_cursor_events(!accept);
                }

                // Button/rect/drag state is processed even when the cursor has
                // stayed still. Only the redundant frontend event is skipped.
                if cursor_changed {
                    last = (x, y);
                    let _ = win.emit("cursor", CursorPayload { x, y });
                }
            }
        }
    });
}

/// Re-applies click-through after the window or the island changed shape.
///
/// With the cursor poll (Windows) the window takes the mouse again and the next
/// tick decides from the cursor. Without it (Linux) the input region is set to
/// the island itself, or to the whole wake strip while collapsed.
pub fn refresh_click_through(app: &AppHandle, gate: &PollGate) {
    if platform::CURSOR_POLL {
        set_ignore_cursor(app, false);
        gate.forget_ignore_state();
        return;
    }
    let Some(win) = window(app) else { return };
    let region = if gate.is_dragging() {
        None
    } else if gate.collapsed.load(Ordering::Relaxed) {
        // The wake strip itself, never "the whole window": if the window ever
        // fails to shrink to the strip, the rest of it must not swallow clicks
        // meant for whatever sits under the top of the screen.
        let size = win.inner_size().ok();
        let scale = win.scale_factor().unwrap_or(1.0);
        Some((0.0, 0.0, size.map_or(STRIP_W, |s| s.width as f64 / scale), size.map_or(STRIP_H, |s| s.height as f64 / scale)))
    } else {
        let r = *gate.rect.lock().unwrap();
        if r.w <= 0.0 {
            // Nothing drawn yet: nothing takes the mouse.
            Some((0.0, 0.0, 0.0, 0.0))
        } else {
            let x0 = (r.x - HIT_MARGIN).max(0.0);
            let y0 = (r.y - HIT_MARGIN).max(0.0);
            let x1 = r.x + r.w + HIT_MARGIN;
            let y1 = r.y + r.h + HIT_MARGIN;
            Some((x0, y0, x1 - x0, y1 - y0))
        }
    };
    platform::set_input_region(&win, region);
}

pub fn set_ignore_cursor(app: &AppHandle, ignore: bool) {
    if let Some(win) = window(app) {
        let _ = win.set_ignore_cursor_events(ignore);
    }
}

#[cfg(test)]
mod placement_tests {
    use super::*;

    fn work(x: f64, y: f64, width: f64, height: f64, scale: f64) -> WorkArea {
        WorkArea { x, y, width, height, scale }
    }

    #[test]
    fn panel_and_wake_strip_keep_the_same_center_and_top() {
        let work = work(-2560.0, 40.0, 2560.0, 1400.0, 1.25);
        let anchor = work.restore(0.75, 0.6);
        let panel = work.window_rect(anchor, false, Dock::Free);
        let strip = work.window_rect(anchor, true, Dock::Free);
        assert_eq!(panel.0 as f64 + panel.2 as f64 / 2.0, strip.0 as f64 + strip.2 as f64 / 2.0);
        assert_eq!(panel.1, strip.1);
        assert_eq!((panel.2, panel.3), (900, 400));
    }

    #[test]
    fn a_full_panel_is_clamped_above_the_taskbar_at_negative_origins() {
        let work = work(-1920.0, -1080.0, 1920.0, 1040.0, 1.0);
        let rect = work.window_rect(Anchor { center: 5000.0, top: 5000.0 }, false, Dock::Free);
        assert_eq!(rect, (-720, -360, 720, 320));
        let strip = work.window_rect(Anchor { center: 5000.0, top: 5000.0 }, true, Dock::Free);
        assert_eq!(strip, (-480, -360, 240, 6));
        assert_eq!(work.window_rect(Anchor { center: -5000.0, top: -5000.0 }, false, Dock::Free), (-1920, -1080, 720, 320));
    }

    #[test]
    fn normalized_position_survives_resolution_dpi_and_monitor_rearrangement() {
        let old = work(1920.0, 0.0, 2560.0, 1400.0, 1.0);
        let (x, y) = old.normalize(old.restore(0.8, 0.35));
        let new = work(-3840.0, 80.0, 3840.0, 2080.0, 2.0);
        let anchor = new.restore(x, y);
        assert_eq!(new.normalize(anchor), (x, y));
        assert_eq!(new.window_rect(anchor, false, Dock::Free), (-1920, 584, 1440, 640));
    }

    #[test]
    fn an_unplugged_monitor_can_restore_the_same_fractions_on_primary() {
        let fallback = work(0.0, 0.0, 1920.0, 1040.0, 1.0);
        let rect = fallback.window_rect(fallback.restore(1.0, 1.0), false, Dock::Free);
        assert_eq!(rect, (1200, 720, 720, 320));
    }

    #[test]
    fn a_tiny_work_area_has_finite_normalization_and_no_offscreen_window() {
        let tiny = work(-100.0, 30.0, 500.0, 200.0, 2.0);
        let anchor = tiny.restore(1.0, 1.0);
        assert_eq!(tiny.window_rect(anchor, false, Dock::Free), (-100, 30, 500, 200));
        assert_eq!(tiny.normalize(anchor), (0.5, 0.0));
    }

    #[test]
    fn clicking_or_small_jitter_does_not_cross_the_logical_drag_threshold() {
        let start = Anchor { center: 900.0, top: 0.0 };
        assert!(!crosses_drag_threshold(start, start, 1.0));
        assert!(!crosses_drag_threshold(start, Anchor { center: 904.0, top: 1.0 }, 1.0));
        assert!(!crosses_drag_threshold(start, Anchor { center: 907.0, top: 0.0 }, 1.5));
        assert!(crosses_drag_threshold(start, Anchor { center: 907.5, top: 0.0 }, 1.5));
    }

    #[test]
    fn cursor_priority_reaches_side_dock_despite_transparent_compact_margin() {
        let work = work(0.0, 0.0, 1920.0, 1040.0, 1.0);
        let visible = VisibleRect { x: 216.0, y: 400.0, w: 288.0, h: 32.0, scale: 1.0 };
        assert_eq!(choose_dock(work, Some(visible), Some((20.0, 416.0))), Dock::Left);
        assert_eq!(choose_dock(work, Some(visible), Some((500.0, 416.0))), Dock::Free);
        let start = work.restore(0.0, 0.5);
        let attempted = Anchor { center: start.center - 200.0, top: start.top };
        assert_eq!(work.clamp(attempted), start);
        assert!(crosses_drag_threshold(start, attempted, 1.0), "outward gesture can change dock without moving clamped box");
    }

    #[test]
    fn every_edge_and_corner_has_a_distinct_cursor_snap() {
        let work = work(-1920.0, -1080.0, 1920.0, 1040.0, 1.0);
        for (cursor, expected) in [((-960.0,-1070.0),Dock::Top),((-960.0,-50.0),Dock::Bottom),
            ((-1910.0,-560.0),Dock::Left),((-10.0,-560.0),Dock::Right),
            ((-1910.0,-1070.0),Dock::TopLeft),((-10.0,-1070.0),Dock::TopRight),
            ((-1910.0,-50.0),Dock::BottomLeft),((-10.0,-50.0),Dock::BottomRight),
            ((-960.0,-560.0),Dock::Free)] {
            assert_eq!(choose_dock(work, None, Some(cursor)), expected);
        }
    }

    #[test]
    fn visible_rect_fallback_and_cursor_priority_use_logical_snap_distance() {
        let work = work(0.0, 0.0, 2880.0, 1560.0, 1.5);
        let visible = VisibleRect { x: 200.0, y: 20.0, w: 640.0, h: 150.0, scale: 1.5 };
        assert_eq!(choose_dock(work, Some(visible), Some((500.0, 300.0))), Dock::Top);
        assert_eq!(choose_dock(work, None, Some((70.0, 500.0))), Dock::Left);
        assert_eq!(choose_dock(work, None, Some((73.0, 500.0))), Dock::Free);
        let opposite = VisibleRect { x: 0.0, y: 300.0, w: 640.0, h: 150.0, scale: 1.5 };
        assert_eq!(choose_dock(work, Some(opposite), Some((2870.0, 400.0))), Dock::Left, "flush painted edge wins over remote cursor");
        let near_left = VisibleRect { x:20.0,..opposite };
        assert_eq!(choose_dock(work,Some(near_left),Some((2870.0,400.0))),Dock::Right,"nonflush proximity keeps cursor priority");
    }

    #[test]
    fn all_docked_full_boxes_and_wake_strips_touch_the_same_workarea_edges() {
        let work = work(-2560.0, 40.0, 2560.0, 1400.0, 1.25);
        for dock in [Dock::Top,Dock::Bottom,Dock::Left,Dock::Right,Dock::TopLeft,Dock::TopRight,Dock::BottomLeft,Dock::BottomRight] {
            let anchor = work.dock_anchor(work.restore(0.3,0.6),dock);
            let full = work.window_rect(anchor,false,dock);
            let wake = work.window_rect(anchor,true,dock);
            if dock.left() { assert_eq!(full.0,-2560); assert_eq!(wake.0,-2560); }
            if dock.right() { assert_eq!(full.0+full.2 as i32,0); assert_eq!(wake.0+wake.2 as i32,0); }
            if dock.top() { assert_eq!(full.1,40); assert_eq!(wake.1,40); }
            if dock.bottom() { assert_eq!(full.1+full.3 as i32,1440); assert_eq!(wake.1+wake.3 as i32,1440); }
            let expected = if dock.corner() { (100,8) } else if dock.left()||dock.right() { (8,240) } else { (300,8) };
            assert_eq!((wake.2,wake.3),expected);
        }
    }

    #[test]
    fn dock_constraints_survive_dpi_changes_while_free_positions_keep_both_fractions() {
        let work = work(-3840.0,80.0,3840.0,2080.0,2.0);
        let right = work.dock_anchor(work.restore(0.2,0.35),Dock::Right);
        assert_eq!(work.normalize(right),(1.0,0.35));
        let bottom_left = work.dock_anchor(right,Dock::BottomLeft);
        assert_eq!(work.normalize(bottom_left),(0.0,1.0));
        let free = work.dock_anchor(work.restore(0.2,0.35),Dock::Free);
        assert_eq!(work.normalize(free),(0.2,0.35));
    }

    #[test]
    fn horizontal_compact_reaches_corner_without_dragging_grip_to_the_edge() {
        let work = work(0.0,0.0,1920.0,1032.0,1.0);
        let rect = dock_rect(Dock::Top,288.0,32.0);
        let anchor = work.clamp_painted(Anchor { center:-1000.0,top:-1000.0 },rect);
        assert_eq!(work.window_rect_at(anchor,false,Dock::Top),(-216,0,720,320));
        let painted = work.painted_rect(anchor,rect).unwrap();
        assert_eq!((painted.x,painted.y),(0.0,0.0));
        assert_eq!(choose_dock(work,Some(painted),Some((260.0,16.0))),Dock::TopLeft);
        let settled = work.settle_painted(anchor,rect,Dock::TopLeft,true);
        assert_eq!(work.window_rect(settled,false,Dock::TopLeft),(0,0,720,320));
        assert_eq!(work.normalize(settled),(0.0,0.0));
    }

    #[test]
    fn every_start_dock_reaches_all_corners_at_negative_origins_and_destination_dpi() {
        let work = work(-1920.0,-1200.0,1920.0,1152.0,1.5);
        for start in [Dock::Free,Dock::Top,Dock::Bottom,Dock::Left,Dock::Right,Dock::TopLeft,Dock::TopRight,Dock::BottomLeft,Dock::BottomRight] {
            let (w,h) = compact_dimensions(start);
            let rect = dock_rect(start,w,h);
            for (x,y,dock) in [(-10000.0,-10000.0,Dock::TopLeft),(10000.0,-10000.0,Dock::TopRight),
                (-10000.0,10000.0,Dock::BottomLeft),(10000.0,10000.0,Dock::BottomRight)] {
                let anchor = work.clamp_painted(Anchor { center:x,top:y },rect);
                let painted = work.painted_rect(anchor,rect).unwrap();
                assert_eq!(choose_dock(work,Some(painted),None),dock,"start {start:?}");
                if dock.left() { assert_eq!(painted.x,work.x); }
                if dock.right() { assert_eq!(painted.x+painted.w,work.x+work.width); }
                if dock.top() { assert_eq!(painted.y,work.y); }
                if dock.bottom() { assert_eq!(painted.y+painted.h,work.y+work.height); }
                let settled = work.settle_painted(anchor,rect,dock,true);
                let (nx,ny) = work.normalize(settled);
                assert_eq!(nx,if dock.left(){0.0}else{1.0});
                assert_eq!(ny,if dock.top(){0.0}else{1.0});
                assert_eq!(work.restore(nx,ny),settled,"saved fullhost restores exact settled position");
            }
        }
    }

    #[test]
    fn compact_morph_preserves_visible_center_on_the_unconstrained_axis() {
        let work = work(0.0,0.0,1920.0,1032.0,1.0);
        let horizontal = dock_rect(Dock::Top,288.0,32.0);
        let candidate = work.clamp_painted(Anchor { center:-1000.0,top:496.0 },horizontal);
        let before = work.painted_rect(candidate,horizontal).unwrap();
        let settled = work.settle_painted(candidate,horizontal,Dock::Left,true);
        let after = work.painted_rect(settled,dock_rect(Dock::Left,40.0,192.0)).unwrap();
        assert_eq!(before.y+before.h/2.0,after.y+after.h/2.0);
        for start in [Dock::Left,Dock::Right,Dock::BottomLeft,Dock::BottomRight] {
            let (w,h) = compact_dimensions(start);
            let rect = dock_rect(start,w,h);
            let candidate = Anchor { center:800.0-(rect.x+rect.w/2.0)+360.0,top:512.0-(rect.y+rect.h/2.0) };
            let before = work.painted_rect(candidate,rect).unwrap();
            let settled = work.settle_painted(candidate,rect,Dock::Free,true);
            let after = work.painted_rect(settled,dock_rect(Dock::Free,288.0,32.0)).unwrap();
            assert_eq!((before.x+before.w/2.0,before.y+before.h/2.0),(after.x+after.w/2.0,after.y+after.h/2.0),"start {start:?}");
        }
    }

    #[test]
    fn expanded_settle_uses_actual_dimensions_and_live_resize_bounds_are_safe() {
        let work = work(0.0,0.0,1920.0,1032.0,1.0);
        let expanded = dock_rect(Dock::Left,640.0,180.0);
        let candidate = Anchor { center:940.0,top:340.0 };
        let before = work.painted_rect(candidate,expanded).unwrap();
        let settled = work.settle_painted(candidate,expanded,Dock::Free,false);
        let after = work.painted_rect(settled,dock_rect(Dock::Free,640.0,180.0)).unwrap();
        assert_eq!((before.x+before.w/2.0,before.y+before.h/2.0),(after.x+after.w/2.0,after.y+after.h/2.0));
        let compact = dock_rect(Dock::Top,288.0,32.0);
        let edge = work.clamp_painted(Anchor { center:-1000.0,top:10000.0 },compact);
        let resized = work.clamp_painted(edge,dock_rect(Dock::Top,640.0,260.0));
        let visible = work.painted_rect(resized,dock_rect(Dock::Top,640.0,260.0)).unwrap();
        assert!(visible.x>=work.x && visible.y>=work.y && visible.x+visible.w<=work.x+work.width && visible.y+visible.h<=work.y+work.height);
    }

    #[test]
    fn invalid_painted_bounds_fall_back_and_cancel_restores_the_full_window() {
        let work = work(0.0,0.0,1920.0,1032.0,1.0);
        let attempted = Anchor { center:-1000.0,top:10000.0 };
        for rect in [IslandRect::default(),IslandRect { x:f64::NAN,y:0.0,w:20.0,h:20.0 }] {
            assert_eq!(work.clamp_painted(attempted,rect),work.clamp(attempted));
        }
        let drag = work.clamp_painted(attempted,dock_rect(Dock::Top,288.0,32.0));
        assert!(work.window_rect_at(drag,false,Dock::Top).0<0);
        let restored = work.window_rect(work.dock_anchor(work.restore(0.5,0.0),Dock::Top),false,Dock::Top);
        assert_eq!(restored,(600,0,720,320));
    }
}
