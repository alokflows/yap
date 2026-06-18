//! Ripple Desktop — joins a room as a normal peer (hashed room + sealed text) and
//! types received messages at the OS cursor. Same crypto as the web app, so the
//! relay stays blind.

mod inject;

use futures_util::{SinkExt, StreamExt};
use inject::InjectCmd;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender as StdSender;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::Notify;
use tokio_tungstenite::tungstenite::Message;

const RELAY: &str = "wss://yap-mkk4.onrender.com/ws";

// ---- shared settings -------------------------------------------------------
#[derive(Clone, Copy, Serialize)]
struct Settings {
    /// Type each received message at the cursor (clipboard + paste shortcut).
    type_at_cursor: bool,
    /// Also leave each received message on the clipboard.
    auto_copy: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Settings { type_at_cursor: true, auto_copy: false }
    }
}

enum RelayCmd {
    SendText(String),
}

struct RelayHandle {
    cmd_tx: UnboundedSender<RelayCmd>,
    stop: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

struct AppState {
    inject_tx: StdSender<InjectCmd>,
    settings: Arc<Mutex<Settings>>,
    relay: Mutex<Option<RelayHandle>>,
}

// ---- helpers ---------------------------------------------------------------
fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

#[derive(Clone, Serialize)]
struct StatusPayload {
    state: String,
    devices: usize,
    error: Option<String>,
}
fn emit_status(app: &AppHandle, state: &str, devices: usize, error: Option<String>) {
    let _ = app.emit(
        "ripple://status",
        StatusPayload { state: state.into(), devices, error },
    );
}

#[derive(Clone, Serialize)]
struct MsgPayload {
    dir: String,
    text: String,
    delivered: u32,
}
fn emit_message(app: &AppHandle, dir: &str, text: String, delivered: u32) {
    let _ = app.emit("ripple://message", MsgPayload { dir: dir.into(), text, delivered });
}

#[derive(Clone, Serialize)]
struct Device {
    name: String,
    os: String,
    is_host: bool,
    is_me: bool,
}
fn emit_devices(app: &AppHandle, v: &serde_json::Value, my_id: &Option<String>) {
    let mut devices = Vec::new();
    if let Some(members) = v.get("members").and_then(|m| m.as_array()) {
        for m in members {
            let id = m.get("id").and_then(|x| x.as_str()).unwrap_or("");
            devices.push(Device {
                name: m.get("name").and_then(|x| x.as_str()).unwrap_or("Device").to_string(),
                os: m.get("os").and_then(|x| x.as_str()).unwrap_or("Device").to_string(),
                is_host: m.get("isHost").and_then(|x| x.as_bool()).unwrap_or(false),
                is_me: my_id.as_deref() == Some(id),
            });
        }
    }
    let _ = app.emit("ripple://devices", devices);
}

// A stable per-device id, persisted under the app's config dir.
fn get_or_create_did(app: &AppHandle) -> String {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("did");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    let did = uuid::Uuid::new_v4().to_string();
    let _ = std::fs::write(&path, &did);
    did
}

// ---- relay task ------------------------------------------------------------
enum ConnEnd {
    Stopped, // user asked to disconnect
    Dropped, // connection lost — reconnect
}

#[allow(clippy::too_many_arguments)]
async fn relay_loop(
    app: AppHandle,
    key: [u8; 32],
    room: String,
    did: String,
    inject_tx: StdSender<InjectCmd>,
    settings: Arc<Mutex<Settings>>,
    stop: Arc<AtomicBool>,
    notify: Arc<Notify>,
    mut cmd_rx: UnboundedReceiver<RelayCmd>,
) {
    let url = format!("{}?role=desktop&room={}&did={}", RELAY, enc(&room), enc(&did));
    let mut backoff = 500u64;
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        emit_status(&app, "connecting", 0, None);
        match tokio_tungstenite::connect_async(&url).await {
            Ok((ws, _)) => {
                backoff = 500;
                let end = run_connection(&app, &key, ws, &inject_tx, &settings, &stop, &notify, &mut cmd_rx).await;
                if let ConnEnd::Stopped = end {
                    break;
                }
            }
            Err(e) => emit_status(&app, "offline", 0, Some(format!("{e}"))),
        }
        if stop.load(Ordering::SeqCst) {
            break;
        }
        emit_status(&app, "offline", 0, None);
        // Backoff, but wake instantly if the user disconnects.
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(backoff)) => {}
            _ = notify.notified() => {}
        }
        backoff = (backoff * 2).min(5000);
    }
    emit_status(&app, "offline", 0, None);
}

#[allow(clippy::too_many_arguments)]
async fn run_connection(
    app: &AppHandle,
    key: &[u8; 32],
    ws: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    inject_tx: &StdSender<InjectCmd>,
    settings: &Arc<Mutex<Settings>>,
    stop: &Arc<AtomicBool>,
    notify: &Arc<Notify>,
    cmd_rx: &mut UnboundedReceiver<RelayCmd>,
) -> ConnEnd {
    let (mut write, mut read) = ws.split();
    let mut outbox: VecDeque<String> = VecDeque::new();
    let mut my_id: Option<String> = None;

    loop {
        tokio::select! {
            incoming = read.next() => {
                match incoming {
                    Some(Ok(Message::Text(txt))) => {
                        // A terminal message (kicked / room closed / locked / full /
                        // busy) means: stop, don't reconnect-flap. Show why and end.
                        if handle_incoming(app, key, &txt, inject_tx, settings, &mut outbox, &mut my_id) {
                            stop.store(true, Ordering::SeqCst);
                            return ConnEnd::Stopped;
                        }
                    }
                    Some(Ok(Message::Ping(p))) => { let _ = write.send(Message::Pong(p)).await; }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return ConnEnd::Dropped,
                    _ => {}
                }
            }
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(RelayCmd::SendText(text)) => {
                        let blob = ripple_core::seal(key, &text);
                        let payload = serde_json::json!({ "type": "text", "text": blob }).to_string();
                        if write.send(Message::Text(payload)).await.is_err() {
                            return ConnEnd::Dropped;
                        }
                        outbox.push_back(text);
                    }
                    None => return ConnEnd::Stopped,
                }
            }
            _ = notify.notified() => {
                if stop.load(Ordering::SeqCst) {
                    let _ = write.send(Message::Close(None)).await;
                    return ConnEnd::Stopped;
                }
            }
        }
    }
}

// Returns true if the message is terminal (the caller should stop, not reconnect).
#[allow(clippy::too_many_arguments)]
fn handle_incoming(
    app: &AppHandle,
    key: &[u8; 32],
    txt: &str,
    inject_tx: &StdSender<InjectCmd>,
    settings: &Arc<Mutex<Settings>>,
    outbox: &mut VecDeque<String>,
    my_id: &mut Option<String>,
) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(txt) else { return false };
    match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        "joined" | "presence" => {
            if let Some(id) = v.get("id").and_then(|x| x.as_str()) {
                *my_id = Some(id.to_string());
            }
            let members = v.get("members").and_then(|m| m.as_array()).map(|a| a.len()).unwrap_or(0);
            let others = members.saturating_sub(1);
            emit_status(app, "connected", others, None);
            emit_devices(app, &v, my_id);
            false
        }
        "history" => {
            // Show past messages, but never auto-type a backlog at the cursor.
            if let Some(arr) = v.get("messages").and_then(|m| m.as_array()) {
                for m in arr {
                    if let Some(blob) = m.get("text").and_then(|t| t.as_str()) {
                        if let Some(plain) = ripple_core::unseal(key, blob) {
                            emit_message(app, "in", plain, 0);
                        }
                    }
                }
            }
            false
        }
        "text" => {
            if let Some(blob) = v.get("text").and_then(|t| t.as_str()) {
                match ripple_core::unseal(key, blob) {
                    Some(plain) => {
                        emit_message(app, "in", plain.clone(), 0);
                        let s = *settings.lock().unwrap();
                        // Type at the cursor and/or copy. When both are on, the paste
                        // leaves the text on the clipboard, so no separate copy needed.
                        if s.type_at_cursor {
                            let _ = inject_tx.send(InjectCmd::Paste { text: plain, keep_clipboard: s.auto_copy });
                        } else if s.auto_copy {
                            let _ = inject_tx.send(InjectCmd::Copy(plain));
                        }
                    }
                    // Don't fail silently: a message we can't decrypt almost always
                    // means the other device is on a different code.
                    None => {
                        let _ = app.emit("ripple://notice", "Couldn't read a message — check both devices use the same code.".to_string());
                    }
                }
            }
            false
        }
        "ack" => {
            let delivered = v.get("delivered").and_then(|d| d.as_u64()).unwrap_or(0) as u32;
            if let Some(text) = outbox.pop_front() {
                emit_message(app, "out", text, delivered);
            }
            false
        }
        "kicked" => { emit_status(app, "offline", 0, Some("Removed from this room.".into())); true }
        "destroyed" => { emit_status(app, "offline", 0, Some("Room was closed by the host.".into())); true }
        "error" => {
            let m = v.get("message").and_then(|x| x.as_str()).unwrap_or("Disconnected.");
            emit_status(app, "offline", 0, Some(m.to_string()));
            // locked / full / busy are terminal — reconnecting would just flap.
            matches!(v.get("code").and_then(|x| x.as_str()), Some("locked") | Some("full") | Some("busy"))
        }
        _ => false,
    }
}

// ---- commands --------------------------------------------------------------
fn stop_relay(state: &State<AppState>) {
    if let Some(h) = state.relay.lock().unwrap().take() {
        h.stop.store(true, Ordering::SeqCst);
        h.notify.notify_waiters();
        // Dropping cmd_tx closes the channel; the task sees None and stops.
    }
}

#[tauri::command]
fn connect(code: String, app: AppHandle, state: State<AppState>) -> Result<(), String> {
    stop_relay(&state);
    let code = ripple_core::normalize_code(&code);
    if code.len() < 3 {
        return Err("Enter a pairing code (3+ characters).".into());
    }
    let key = ripple_core::key_from_code(&code);
    let room = ripple_core::room_from_code(&code);
    let did = get_or_create_did(&app);

    // macOS needs a one-time Accessibility grant to type into other apps.
    #[cfg(target_os = "macos")]
    {
        let _ = macos_accessibility_client::accessibility::application_is_trusted_with_prompt();
    }

    let stop = Arc::new(AtomicBool::new(false));
    let notify = Arc::new(Notify::new());
    let (cmd_tx, cmd_rx) = tokio::sync::mpsc::unbounded_channel::<RelayCmd>();
    *state.relay.lock().unwrap() = Some(RelayHandle {
        cmd_tx,
        stop: stop.clone(),
        notify: notify.clone(),
    });

    let inject_tx = state.inject_tx.clone();
    let settings = state.settings.clone();
    tauri::async_runtime::spawn(relay_loop(app, key, room, did, inject_tx, settings, stop, notify, cmd_rx));
    Ok(())
}

#[tauri::command]
fn disconnect(state: State<AppState>) {
    stop_relay(&state);
}

#[tauri::command]
fn send_text(text: String, state: State<AppState>) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(());
    }
    let guard = state.relay.lock().unwrap();
    match guard.as_ref() {
        Some(h) => h.cmd_tx.send(RelayCmd::SendText(text)).map_err(|_| "Not connected".to_string()),
        None => Err("Not connected".into()),
    }
}

#[tauri::command]
fn set_type_at_cursor(on: bool, state: State<AppState>) {
    state.settings.lock().unwrap().type_at_cursor = on;
}

#[tauri::command]
fn set_auto_copy(on: bool, state: State<AppState>) {
    state.settings.lock().unwrap().auto_copy = on;
}

#[tauri::command]
fn copy_to_clipboard(text: String, state: State<AppState>) {
    let _ = state.inject_tx.send(InjectCmd::Copy(text));
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    *state.settings.lock().unwrap()
}

#[tauri::command]
fn undo(state: State<AppState>) {
    let _ = state.inject_tx.send(InjectCmd::Undo);
}

// ---- app -------------------------------------------------------------------
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // The injector emits UI notices, so it needs the app handle — spawn it
            // here (where the handle exists) and register the state for commands.
            let inject_tx = inject::spawn(app.handle().clone());
            app.manage(AppState {
                inject_tx,
                settings: Arc::new(Mutex::new(Settings::default())),
                relay: Mutex::new(None),
            });
            build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides to the tray (instant) instead of tearing
            // down the webview + runtimes, which is what made "close" feel slow.
            // Full exit is the tray's Quit item.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            connect, disconnect, send_text, set_type_at_cursor, set_auto_copy,
            copy_to_clipboard, get_settings, undo
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ripple Desktop");
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "Show Ripple", true, None::<&str>)?;
    let disconnect_i = MenuItem::with_id(app, "disconnect", "Disconnect", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &disconnect_i, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        // Right-click opens the menu; a left-click brings the window straight
        // back, so the app stays reachable like the old taskbar helper instead
        // of vanishing into the tray.
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(w) = tray.app_handle().get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "disconnect" => {
                let state = app.state::<AppState>();
                stop_relay(&state);
            }
            // Hard, instant exit — nothing to flush (ephemeral session), and it
            // avoids any slow teardown of the clipboard/relay threads.
            "quit" => std::process::exit(0),
            _ => {}
        });

    // Use the app icon for the tray when it's available; never panic if it isn't.
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let _tray = builder.build(app)?;
    Ok(())
}
