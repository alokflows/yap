//! Text injection at the OS cursor, plus the clipboard fallback and undo.
//!
//! All of it runs on one dedicated thread that owns the `Enigo` handle, so we
//! never juggle a non-Send keyboard handle across async tasks. The relay task
//! just sends it commands over a channel.

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::sync::mpsc::{Receiver, Sender};
use std::time::{Duration, Instant};

pub enum InjectCmd {
    /// Type this text at the cursor (paste-at-cursor mode).
    Paste(String),
    /// Put this text on the clipboard (copy mode).
    Copy(String),
    /// Delete the last typed run, if we're still inside the safe window.
    Undo,
}

// Undo only fires shortly after a paste — a rough stand-in for "nothing was
// typed after it" until we add a real keystroke monitor. Better to refuse a
// stale undo than to eat text the user typed later.
const UNDO_WINDOW: Duration = Duration::from_secs(20);

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
            InjectCmd::Paste(text) => {
                if let Some(en) = enigo.as_mut() {
                    match en.text(&text) {
                        Ok(()) => last_run = Some((text.chars().count(), Instant::now())),
                        Err(e) => eprintln!("[inject] typing failed: {e}"),
                    }
                }
            }
            InjectCmd::Copy(text) => {
                if let Some(cb) = clipboard.as_mut() {
                    let _ = cb.set_text(text);
                }
                last_run = None; // copying isn't an undoable paste
            }
            InjectCmd::Undo => {
                if let Some((n, when)) = last_run.take() {
                    if when.elapsed() <= UNDO_WINDOW {
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
