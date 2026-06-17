//! Text injection at the OS cursor, plus the clipboard and undo.
//!
//! macOS / Windows / Linux-X11: put the text on the clipboard and synthesise the
//! paste shortcut (Cmd/Ctrl+V) with `enigo` — near-instant for any length and
//! clean with emoji. We save and restore the clipboard unless the user wants the
//! message kept on it (Auto-copy).
//!
//! Linux-Wayland: `enigo`/Xlib can't inject into native Wayland clients. We try,
//! in order:
//!   1. the **XDG RemoteDesktop portal** (`ashpd`) — zero install: put the text on
//!      the clipboard and have the portal press Ctrl+V. Asks once for permission
//!      (we persist the restore token, so it's a one-time prompt).
//!   2. `wtype` (wlroots) or `ydotool` (uinput; needs `ydotoold`) if present.
//!   3. last resort: leave the text on the clipboard and tell the user to Ctrl+V.
//!
//! It all runs on one dedicated thread that owns the `Enigo` handle, so we never
//! juggle a non-Send keyboard handle across async tasks.

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::sync::mpsc::{Receiver, Sender};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub enum InjectCmd {
    /// Paste this text at the cursor. `keep_clipboard` = leave it on the
    /// clipboard afterwards (Auto-copy on); otherwise restore what was there.
    Paste { text: String, keep_clipboard: bool },
    /// Just put this text on the clipboard (Auto-copy, no typing).
    Copy(String),
    /// Delete the last pasted run, if we're still inside the safe window.
    Undo,
}

// Undo only fires shortly after a paste — a rough stand-in for "nothing was
// typed after it" until we add a real keystroke monitor. Better to refuse a
// stale undo than to eat text the user typed later.
const UNDO_WINDOW: Duration = Duration::from_secs(20);

// macOS pastes with Cmd, everyone else with Ctrl.
#[cfg(target_os = "macos")]
const PASTE_MOD: Key = Key::Meta;
#[cfg(not(target_os = "macos"))]
const PASTE_MOD: Key = Key::Control;

pub fn spawn(app: AppHandle) -> Sender<InjectCmd> {
    let (tx, rx) = std::sync::mpsc::channel::<InjectCmd>();
    std::thread::spawn(move || run(rx, app));
    tx
}

// Surface a short message to the UI (toast). Used when paste can't reach the
// cursor (e.g. Wayland without permission/tools) so the app never looks dead.
fn notice(app: &AppHandle, text: &str) {
    let _ = app.emit("ripple://notice", text.to_string());
}

fn run(rx: Receiver<InjectCmd>, app: AppHandle) {
    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => Some(e),
        Err(e) => {
            eprintln!("[inject] could not init keyboard: {e}");
            None
        }
    };
    let mut clipboard = arboard::Clipboard::new().ok();
    let mut last_run: Option<(usize, Instant)> = None;

    // Wayland-only: the RemoteDesktop portal session, set up lazily on the first
    // paste so the permission prompt appears only when text actually arrives.
    #[cfg(target_os = "linux")]
    let portal_token = {
        use tauri::Manager;
        app.path().app_config_dir().ok().map(|d| {
            let _ = std::fs::create_dir_all(&d);
            d.join("portal_restore_token")
        })
    };
    #[cfg(target_os = "linux")]
    let mut portal: Option<portal::Portal> = None;
    #[cfg(target_os = "linux")]
    let mut portal_tried = false;

    while let Ok(cmd) = rx.recv() {
        match cmd {
            InjectCmd::Paste { text, keep_clipboard } => {
                #[cfg(target_os = "linux")]
                if is_wayland() {
                    // 1) XDG RemoteDesktop portal: clipboard + Ctrl+V, zero install.
                    if !portal_tried {
                        portal_tried = true;
                        portal = portal::Portal::init(portal_token.clone());
                        if portal.is_none() {
                            eprintln!("[inject] RemoteDesktop portal unavailable; trying wtype/ydotool.");
                        }
                    }
                    if let (Some(p), Some(cb)) = (portal.as_ref(), clipboard.as_mut()) {
                        let prev = if keep_clipboard { None } else { cb.get_text().ok() };
                        if cb.set_text(text.clone()).is_ok() {
                            std::thread::sleep(Duration::from_millis(30));
                            if p.paste() {
                                last_run = Some((text.chars().count(), Instant::now()));
                                if let Some(prev_text) = prev {
                                    std::thread::sleep(Duration::from_millis(120));
                                    let _ = cb.set_text(prev_text);
                                }
                                continue;
                            }
                            // Portal paste failed — restore clipboard, then fall back.
                            if let Some(prev_text) = prev {
                                let _ = cb.set_text(prev_text);
                            }
                        }
                    }
                    // 2) External Wayland typing tools, if installed.
                    if wayland_type(&text) {
                        last_run = Some((text.chars().count(), Instant::now()));
                        if keep_clipboard {
                            if let Some(cb) = clipboard.as_mut() {
                                let _ = cb.set_text(text);
                            }
                        }
                        continue;
                    }
                    // 3) Last resort: leave it on the clipboard and say how to paste.
                    eprintln!("[inject] No Wayland typing path (portal denied + no wtype/ydotool).");
                    if let Some(cb) = clipboard.as_mut() {
                        let _ = cb.set_text(text);
                    }
                    notice(&app, "To paste at the cursor on Wayland, allow Ripple to control the keyboard when prompted (or install wtype/ydotool). Text copied — press Ctrl+V.");
                    continue;
                }

                // macOS / Windows / X11: clipboard + paste shortcut.
                let (Some(en), Some(cb)) = (enigo.as_mut(), clipboard.as_mut()) else {
                    notice(&app, "Couldn't reach the keyboard to type. Check the app's permissions.");
                    continue;
                };
                let prev = if keep_clipboard { None } else { cb.get_text().ok() };
                if cb.set_text(text.clone()).is_err() {
                    continue;
                }
                std::thread::sleep(Duration::from_millis(30));
                let _ = en.key(PASTE_MOD, Direction::Press);
                let _ = en.key(Key::Unicode('v'), Direction::Click);
                let _ = en.key(PASTE_MOD, Direction::Release);
                last_run = Some((text.chars().count(), Instant::now()));
                if let Some(prev_text) = prev {
                    std::thread::sleep(Duration::from_millis(120));
                    let _ = cb.set_text(prev_text);
                }
            }
            InjectCmd::Copy(text) => {
                if let Some(cb) = clipboard.as_mut() {
                    let _ = cb.set_text(text);
                }
            }
            InjectCmd::Undo => {
                if let Some((n, when)) = last_run.take() {
                    if when.elapsed() <= UNDO_WINDOW {
                        #[cfg(target_os = "linux")]
                        if is_wayland() {
                            if let Some(p) = portal.as_ref() {
                                if p.backspaces(n) {
                                    continue;
                                }
                            }
                            wayland_backspaces(n);
                            continue;
                        }
                        if let Some(en) = enigo.as_mut() {
                            for _ in 0..n {
                                let _ = en.key(Key::Backspace, Direction::Click);
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---- Linux / Wayland helpers ----------------------------------------------
#[cfg(target_os = "linux")]
fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_SESSION_TYPE").map(|s| s.eq_ignore_ascii_case("wayland")).unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn run_ok(cmd: &str, args: &[&str]) -> bool {
    std::process::Command::new(cmd)
        .args(args)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn wayland_type(text: &str) -> bool {
    // wtype types directly (wlroots compositors: Sway, Hyprland, …).
    if run_ok("wtype", &[text]) {
        return true;
    }
    // ydotool uses uinput, so it works on GNOME/KDE too (needs ydotoold running).
    run_ok("ydotool", &["type", text])
}

#[cfg(target_os = "linux")]
fn wayland_backspaces(n: usize) {
    // wtype: send the BackSpace keysym n times.
    let mut args: Vec<&str> = Vec::with_capacity(n * 2);
    for _ in 0..n {
        args.push("-k");
        args.push("BackSpace");
    }
    if run_ok("wtype", &args) {
        return;
    }
    // ydotool: keycode 14 = KEY_BACKSPACE, press(:1)/release(:0).
    let mut yargs: Vec<String> = vec!["key".to_string()];
    for _ in 0..n {
        yargs.push("14:1".to_string());
        yargs.push("14:0".to_string());
    }
    let refs: Vec<&str> = yargs.iter().map(|s| s.as_str()).collect();
    run_ok("ydotool", &refs);
}

// ---- Wayland: XDG RemoteDesktop portal -------------------------------------
// Zero-install keystroke injection on Wayland (GNOME/KDE/wlroots). We only ever
// send a few well-known keysyms (Ctrl+V to paste, BackSpace to undo) so layout
// and emoji are handled by the real clipboard, exactly like the X11 path.
#[cfg(target_os = "linux")]
mod portal {
    use ashpd::desktop::remote_desktop::{
        DeviceType, KeyState, NotifyKeyboardKeysymOptions, RemoteDesktop, SelectDevicesOptions,
        StartOptions,
    };
    use ashpd::desktop::{CreateSessionOptions, PersistMode, Session};
    use ashpd::enumflags2::BitFlags;
    use std::path::PathBuf;
    use tokio::runtime::Runtime;

    // X keysyms.
    const KEY_CTRL: i32 = 0xFFE3; // Control_L
    const KEY_V: i32 = 0x0076; // 'v'
    const KEY_BACKSPACE: i32 = 0xFF08; // BackSpace

    pub struct Portal {
        rt: Runtime,
        proxy: RemoteDesktop,
        session: Session<RemoteDesktop>,
    }

    impl Portal {
        /// Open a RemoteDesktop session for keyboard control. Shows the portal's
        /// permission dialog once; a saved restore token avoids re-prompting.
        pub fn init(token_path: Option<PathBuf>) -> Option<Self> {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(1)
                .enable_all()
                .build()
                .ok()?;
            let restore = token_path
                .as_ref()
                .and_then(|p| std::fs::read_to_string(p).ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let result = rt.block_on(async {
                let proxy = RemoteDesktop::new().await?;
                let session = proxy.create_session(CreateSessionOptions::default()).await?;
                let mut opts = SelectDevicesOptions::default()
                    .set_devices(BitFlags::from(DeviceType::Keyboard))
                    .set_persist_mode(PersistMode::ExplicitlyRevoked);
                if let Some(t) = restore.as_deref() {
                    opts = opts.set_restore_token(t);
                }
                proxy.select_devices(&session, opts).await?.response()?;
                let selected = proxy
                    .start(&session, None, StartOptions::default())
                    .await?
                    .response()?;
                let token = selected.restore_token().map(|s| s.to_string());
                Ok::<_, ashpd::Error>((proxy, session, token))
            });

            match result {
                Ok((proxy, session, token)) => {
                    // Persist the restore token so future launches skip the prompt.
                    if let (Some(p), Some(t)) = (token_path.as_ref(), token.as_ref()) {
                        let _ = std::fs::write(p, t);
                    }
                    Some(Portal { rt, proxy, session })
                }
                Err(e) => {
                    eprintln!("[inject] RemoteDesktop portal: {e}");
                    None
                }
            }
        }

        async fn key(&self, keysym: i32, state: KeyState) -> Result<(), ashpd::Error> {
            self.proxy
                .notify_keyboard_keysym(&self.session, keysym, state, NotifyKeyboardKeysymOptions::default())
                .await
        }

        /// Press Ctrl+V to paste whatever is on the clipboard at the cursor.
        pub fn paste(&self) -> bool {
            self.rt
                .block_on(async {
                    self.key(KEY_CTRL, KeyState::Pressed).await?;
                    self.key(KEY_V, KeyState::Pressed).await?;
                    self.key(KEY_V, KeyState::Released).await?;
                    self.key(KEY_CTRL, KeyState::Released).await?;
                    Ok::<(), ashpd::Error>(())
                })
                .is_ok()
        }

        /// Send BackSpace `n` times (undo the last pasted run).
        pub fn backspaces(&self, n: usize) -> bool {
            self.rt
                .block_on(async {
                    for _ in 0..n {
                        self.key(KEY_BACKSPACE, KeyState::Pressed).await?;
                        self.key(KEY_BACKSPACE, KeyState::Released).await?;
                    }
                    Ok::<(), ashpd::Error>(())
                })
                .is_ok()
        }
    }
}
