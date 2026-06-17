//! Text injection at the OS cursor, plus the clipboard and undo.
//!
//! macOS / Windows / Linux-X11: put the text on the clipboard and synthesise the
//! paste shortcut (Cmd/Ctrl+V) with `enigo` — near-instant for any length and
//! clean with emoji. We save and restore the clipboard unless the user wants the
//! message kept on it (Auto-copy).
//!
//! Linux-Wayland: `enigo`/Xlib can't inject into native Wayland clients, so we
//! type via the Wayland tools `wtype` (wlroots) or `ydotool` (uinput, works on
//! GNOME/KDE once `ydotoold` is running). Detected at runtime from the session.
//!
//! It all runs on one dedicated thread that owns the `Enigo` handle, so we never
//! juggle a non-Send keyboard handle across async tasks.

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::sync::mpsc::{Receiver, Sender};
use std::time::{Duration, Instant};

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

pub fn spawn() -> Sender<InjectCmd> {
    let (tx, rx) = std::sync::mpsc::channel::<InjectCmd>();
    std::thread::spawn(move || run(rx));
    tx
}

fn run(rx: Receiver<InjectCmd>) {
    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => Some(e),
        Err(e) => {
            eprintln!("[inject] could not init keyboard: {e}");
            None
        }
    };
    let mut clipboard = arboard::Clipboard::new().ok();
    let mut last_run: Option<(usize, Instant)> = None;

    while let Ok(cmd) = rx.recv() {
        match cmd {
            InjectCmd::Paste { text, keep_clipboard } => {
                // Wayland: type via the Wayland tools (enigo can't reach Wayland
                // clients). On success, optionally keep the text on the clipboard.
                #[cfg(target_os = "linux")]
                if is_wayland() {
                    if wayland_type(&text) {
                        last_run = Some((text.chars().count(), Instant::now()));
                        if keep_clipboard {
                            if let Some(cb) = clipboard.as_mut() {
                                let _ = cb.set_text(text);
                            }
                        }
                        continue;
                    }
                    eprintln!("[inject] Wayland typing needs `wtype` or `ydotool` (with ydotoold). Install one of them.");
                    continue;
                }

                // macOS / Windows / X11: clipboard + paste shortcut.
                let (Some(en), Some(cb)) = (enigo.as_mut(), clipboard.as_mut()) else { continue };
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
