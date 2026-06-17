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

**Not yet done:** Windows/Linux run-through (code is cross-platform via `enigo`,
but Linux Wayland should use the XDG RemoteDesktop portal — see the spec);
start-on-login; release packaging (Task C).

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
