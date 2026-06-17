# Yap Desktop (Tauri)

One small cross-platform app (Windows/Mac/Linux) that replaces the helper
scripts. Joins a room as a normal peer (hashed room + sealed text — the relay
stays blind) and **types received messages at the OS cursor**.

**Build instructions / spec:** [`/prompts/desktop.md`](../../prompts/desktop.md)

## Status

**Working on macOS** (built and run-verified against the live relay). The Rust
core is in `src-tauri/src/`:

- `lib.rs` — relay client (`tokio-tungstenite` over native-tls), Tauri commands,
  tray. Routes on `room_from_code`, seals/unseals with the shared crypto.
- `inject.rs` — types text at the cursor via `enigo`; clipboard fallback; undo
  (deletes the last typed run within a short safe window).
- crypto comes from [`packages/core-rs`](../../packages/core-rs) — the Rust
  mirror of `packages/core/crypto.mjs`, verified byte-for-byte against the JS
  test vectors (`cargo test`).

Features: pairing, live device count, **Type-at-cursor vs Copy-to-clipboard**,
**Stop pasting**, **Undo last**, send-to-phone, system tray (Show / Disconnect /
Quit). On macOS it prompts once for Accessibility permission.

**Linux note:** X11 works out of the box (clipboard + Ctrl+V via `enigo`). On
**Wayland** the app types via `wtype` (wlroots: Sway/Hyprland) or `ydotool`
(GNOME/KDE — needs the `ydotoold` daemon running). If typing does nothing on a
GNOME/KDE Wayland session, install one of them, e.g.:

```sh
sudo apt install ydotool   # then: sudo ydotoold &
# or, on wlroots compositors:
sudo apt install wtype
```

A no-install path via the XDG RemoteDesktop portal is the planned follow-up.

**Not yet done:** start-on-login; XDG portal for zero-setup Wayland; final shared
logo / app icon.

## Run (dev)

```sh
cd apps/desktop
npm install
npm run tauri dev
```

First run on macOS: grant **System Settings → Privacy & Security →
Accessibility** to the app, so it can type into other apps.

## Build a distributable

```sh
npm run tauri build    # → .dmg / .app  (and .exe / .AppImage on those OSes)
```
