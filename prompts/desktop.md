# 04 — Ripple Desktop (Tauri)

Goal: one small cross-platform app that replaces the helper scripts, joins as a
normal peer, and injects received text **at the OS cursor** — including Linux.

## Do

1. **Scaffold** a Tauri app in `apps/desktop/` (Rust core + minimal TS/HTML UI:
   pairing screen, peer list, consent mode, tray icon).
2. **Protocol v1** client (seal/unseal, heartbeat, reconnect) — reuse
   `packages/core` for the TS side; keep crypto consistent.
3. **Keystroke injection** at the cursor:
   - **Windows:** `SendInput()` (via `enigo` or direct FFI).
   - **macOS:** `CGEvent`; prompt for the one-time Accessibility permission.
   - **Linux:** **XDG RemoteDesktop portal** (Wayland) with `ydotool`/`xdotool`
     fallback (X11). This is the fix for the old clipboard-only limitation.
4. **Tray UX:** show connected/paired state; quick disconnect; start-on-login
   option.

## Don't

- Don't ship per-OS shell scripts as the primary path. Don't paste without the
  device's consent setting allowing it.

## Verify

- On each OS: pair, send from phone → text types into the focused app at the
  cursor. On Linux specifically, confirm it works on Wayland via the portal.
</content>
