# Ripple — Handoff (read me, then continue)

**You are Claude Code picking up the Ripple project.** The owner is non-technical,
usually on their phone, often away from the computer (which they leave on for
you). Their standing instruction: *"read the handoff and continue."* They want
maximum autonomy — do everything you can without making them intervene, and only
ask when there is genuinely no other way. Keep messages short and concrete.

This file is the living context. Update it as you make progress so the next
session can pick up cold.

---

## 0. Prime directives (do not violate)

1. **Never break the live web app.** `master` is what users hit. The web app +
   relay live in `server/` and deploy to Render (see §6). Verify before shipping.
2. **Privacy is the product.** The relay is a *blind pipe*: it must never see the
   raw pairing code or any plaintext. Clients route on a hash of the code and
   exchange only sealed (encrypted) blobs. No external/CDN calls at runtime.
3. **Match the look.** Earthy "Claude" theme; minimal, fast. Web and desktop
   should feel identical.
4. **Tell the truth.** If something isn't verified (e.g. needs a real device),
   say so. Don't claim a thing works that you didn't run.
5. **Be surgical.** Don't touch unrelated code; remove dead code you create.

---

## 1. What Ripple is

Share a short **pairing code** between devices; anything you type or dictate on
one device appears on the others (phone ↔ computer ↔ TV), both directions, no
accounts. On the **desktop app** received text is **typed at the OS cursor**.
Live web app: **https://yap-mkk4.onrender.com**

**Repo:** `alokflows/yap` (public, GitHub). Local working copy:
`/Users/megha/Documents/Ripple`. `gh` is authed as `alokflows`.

---

## 2. Repo layout

- `server/` — the relay + web app (deployed). `server.js` is the Node WebSocket
  relay; `server/public/index.html` is the **entire web UI** (inline CSS/JS),
  plus `sw.js` (PWA service worker), `qrcode.js`, `jsQR.js`.
- `packages/core/crypto.mjs` — E2E crypto (JS/Web Crypto), used by the web app.
  Tests: `node --test packages/core/crypto.test.mjs` (7/7).
- `packages/core-rs/` — the **Rust mirror** of the crypto. `cargo test` (8/8),
  asserts the cross-language vectors below.
- `apps/desktop/` — the **Tauri v2 desktop app** (Rust core + vanilla HTML/JS UI).
- `apps/android/`, `apps/ios/` — placeholders (not started).
- `prompts/` — original build specs. `docs/` — protocol/security docs.
- `.github/workflows/` — `keepalive.yml` (pings the relay so Render's free tier
  doesn't sleep) and `desktop-release.yml` (builds desktop installers, §7).

---

## 3. The crypto core (the heart of the privacy model)

Same math in JS (`packages/core/crypto.mjs`) and Rust (`packages/core-rs`):
- `normalizeCode` → upper-case, strip non-alphanumerics.
- `roomFromCode(code)` → `base64url(SHA-256(code))`. **The relay routes on this**,
  never the raw code.
- `keyFromCode(code)` → AES-GCM-256 key via PBKDF2 (salt `yap.kdf.v1`, **210000**
  iters, SHA-256).
- `seal(key, text)` → `base64url(iv(12) || AES-GCM ciphertext)`.
- `unseal(key, blob)` → plaintext, or null on wrong key / tamper (never throws).

**Cross-language vectors (must stay byte-for-byte; both JS+Rust tests assert):**
- `roomFromCode("K7QF9P")` = `m5y7nOTrj9TE1Pbh9LSBNGFqitACsWIlLsKk8cfTqjg`
- `seal` of `"hello, cursor"` with code `K7QF9P` and a forced all-zero 12-byte IV
  = `AAAAAAAAAAAAAAAAA8gVxDfIR9jOqUCwRBdsU7oecTFk-DiEAtrwkOY`

---

## 4. What's DONE (and live)

### Task A — E2E encryption (LIVE) ✅
The relay is blind. Web app derives key+room from the code, routes the WS on the
hashed room, seals outgoing / unseals incoming (skips undecryptable), keeps the
local echo plaintext. Relay has `sanitizeRoom()` (base64url ≤64) on WS + `/poll`,
raised `MAX_TEXT_LENGTH`, and serves `packages/core/crypto.mjs` at
`/core/crypto.mjs`. SW shell includes it. Helper-download UI hidden (old plaintext
protocol). Verified end-to-end against the production relay.

### Web polish (LIVE) ✅
- WhatsApp-style compact sent bubbles (time + tick only; device count in the tick
  tooltip).
- Fixed desktop layout overflow: the mobile-keyboard `visualViewport` hack is now
  gated to touch devices, so desktop holds a stable 100dvh.
- Auto-copy is focus-resilient: if the tab is unfocused when a message lands, it
  copies the moment the tab regains focus.

### Task B — Desktop app (built; macOS verified) ✅ (mostly)
`apps/desktop/` Tauri v2 app, **web-identical UX**:
- Pairing identical to web: **Create code / Join with code**, then a locked code
  with **QR / Invite / Change**. QR encodes `https://yap-mkk4.onrender.com/?room=CODE`
  (vendored `qrcode.js`), so a phone scans it and opens the web app connected.
- **Chat / Devices** tabs, message bubbles, composer; right-click a bubble →
  **Copy / Resend**. Devices tab lists members (name/type/host) from presence.
- Toggles: **Type at cursor** + **Auto-copy** (no separate copy mode). **Undo**
  button (deletes the last pasted run within a ~20s safe window).
- System tray: Show / Disconnect / Quit. macOS prompts once for Accessibility.
- **Fast paste:** "type at cursor" = clipboard + Cmd/Ctrl+V (one paste action),
  NOT char-by-char typing. Saves/restores the clipboard unless Auto-copy is on.
- **Linux:** X11 uses clipboard + Ctrl+V (enigo). **Wayland** types via `wtype`
  (wlroots) or `ydotool` (GNOME/KDE, needs `ydotoold`) — see README + §8.

Rust: `src-tauri/src/lib.rs` (relay client over `tokio-tungstenite` +
**native-tls** — note: rustls needs a crypto-provider; native-tls avoids it),
`src-tauri/src/inject.rs` (keystroke/clipboard/undo). Crypto from `packages/core-rs`.
Verified: `cargo test` (vectors) + a live sealed round-trip through the production
relay using the desktop's exact stack. macOS `.app` installed at
`/Applications/Ripple.app`.

### Cross-platform installers (CI) ✅
`.github/workflows/desktop-release.yml` (tauri-action) builds macOS/Windows/Linux
on a `v*` tag or manual `gh workflow run desktop-release.yml` → a GitHub Release
`desktop-dev` with `.dmg` / `.msi` / `.exe` / `.AppImage` / `.deb` / `.rpm`.
Public link: **https://github.com/alokflows/yap/releases/tag/desktop-dev**

---

## 5. What's LEFT (next steps, roughly in priority)

1. **Verify Wayland typing on the owner's office Linux machine** (likely Ubuntu
   GNOME Wayland). The **XDG RemoteDesktop portal** (`ashpd`) is now implemented
   (zero-install) with `wtype`/`ydotool` + clipboard fallbacks — but it has only
   been `cargo check`'d, never run on a real Wayland session. Confirm the
   permission dialog appears once and Ctrl+V lands at the cursor.
2. **One shared logo everywhere** — web favicon, in-app header, and the desktop
   **dock/taskbar app icon**. Desktop icons are now the brand terracotta logo
   (regenerated from `apps/desktop/src/icon.svg`); if the owner picks a different
   final logo, re-run `tauri icon` on a 1024px PNG of it to regenerate all sizes.
3. **start-on-login** for the desktop (tauri autostart plugin).
4. **A real "safe window" for undo** (today it's a 20s timer; the spec wants
   "only if nothing was typed after it" — needs a keystroke monitor).
5. **Task C/D:** Android keyboard (IME) app with in-keyboard QR; TV (leanback,
   auto-hand-host to first phone); NFC; iOS (separate Swift build). APK auto-built
   into Releases.
6. **Stronger codes / rate-limiting** on the relay (guessing throttle).

---

## 6. Deploy (web app / relay) — IMPORTANT quirk

Render hosts the relay (`render.yaml`, `rootDir: server`, autoDeploy from
`master`). **Render's auto-deploy has NOT been firing** — the owner triggers a
**Manual Deploy** in the Render dashboard after a push. There is no Render API key
or deploy hook available locally, so you cannot deploy yourself; tell the owner to
Manual Deploy (or have them paste a Render Deploy Hook URL so you can `curl` it).
The whole repo is cloned by Render, so the `/core/crypto.mjs` route reading
`../packages/core/crypto.mjs` works despite `rootDir: server`.

To confirm a deploy landed: `curl -s https://yap-mkk4.onrender.com/sw.js | grep -o 'yap-v[0-9]*'`
(bump that cache version in `server/public/sw.js` when you change the web app).

---

## 7. Desktop: build / run / release commands

```sh
# dev run (from a Mac/Linux/Windows with the toolchain)
cd apps/desktop && npm install && npm run tauri dev

# local release build
cd apps/desktop && npm run tauri build      # → .dmg/.app (mac), etc.

# cross-platform installers via CI (needs gh auth as alokflows)
gh workflow run desktop-release.yml
gh run watch <run-id> --exit-status
# refresh the public release if re-running (avoids asset clashes):
gh release delete desktop-dev --yes --cleanup-tag
# then dispatch again; publish the draft:
gh release edit desktop-dev --draft=false --prerelease
```

Rust toolchain is installed via rustup; source it in each shell:
`. "$HOME/.cargo/env"`. Crypto tests: `(cd packages/core-rs && cargo test)` and
`node --test packages/core/crypto.test.mjs`.

---

## 8. Running things for the owner (they're often away)

The owner leaves the laptop on and wants you to test/build for them. The Claude
CLI runs inside **Terminal.app**, so macOS TCC permissions go to **Terminal**:
- **Accessibility → Terminal** (drive windows via `osascript`/System Events) and
  **→ Ripple** (so Ripple can type at the cursor).
- **Screen Recording → Terminal** for `screencapture` (needs a Terminal relaunch
  to take effect — which would kill the session, so it applies next session).
- **Automation → Terminal** → allow System Events / Ripple.

If you have these, you can launch the app, bring it to front / full-screen,
`screencapture` it, and `SendUserFile` the screenshot to the owner's phone, then
minimize. Without Screen Recording, `screencapture` fails with "could not create
image from display" — then just report in text. The macOS app is at
`/Applications/Ripple.app`.

---

## 9. Status / history log (newest first)

- 2026-06-17 (later): Fixed the owner's three Ubuntu complaints. (1) **App icon**:
  the bundled `src-tauri/icons/*` were a stray yellow/teal circle, not the brand
  logo — regenerated every size (taskbar/installer/tray) from the real terracotta
  `src/icon.svg` via `tauri icon`, so the dock/taskbar now shows the right logo.
  (2) **Auto-copy on Wayland** (Ubuntu's default): `arboard` was X11-only — enabled
  its `wayland-data-control` feature so the clipboard works on native Wayland.
  (3) **Auto-paste / type-at-cursor on Wayland**: now zero-install via the **XDG
  RemoteDesktop portal** (`ashpd`) — clipboard + portal-driven Ctrl+V; asks once
  for keyboard permission and persists the restore token (saved under the app
  config dir as `portal_restore_token`). Falls back to `wtype`/`ydotool`, then to
  clipboard + a "press Ctrl+V" toast (new `ripple://notice` event). Verified with
  `cargo check` (compiles; ashpd `remote_desktop`+`screencast` features, tokio);
  **not run on a real Wayland box** — the portal dialog + actual keysym injection
  still need a real-machine test. Portal code lives in `inject.rs::portal`.
- 2026-06-17: Built the Tauri desktop app, made it web-identical (Create/Join +
  QR, Chat/Devices, toggles, right-click Copy/Resend), switched paste to
  clipboard+⌘V for speed, added Linux/Wayland typing (wtype/ydotool), set up the
  cross-platform release CI, published the `desktop-dev` release, installed the
  mac app to `/Applications`. Rust crypto mirror added + vectors verified.
- 2026-06-16: Shipped Task A (E2E encryption) to the live web app + relay; web
  polish (bubbles, layout, auto-copy). Relay verified blind.

When a whole area is finished and durably documented in `docs/`/`prompts/`, you
may trim this file — but keep it as the single place a cold session gets oriented.
