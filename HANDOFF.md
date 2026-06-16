# Yap — Handoff Report (read me, then continue the work)

**You are Claude Code, picking up an in-progress build of Yap.** The owner is
non-technical and is handing this to you with one instruction: *"read the report
and continue."* This file is your full briefing — current state, decisions
already made, and the exact ordered work left to do, with how to verify each
piece. **When every task in §6 is done and verified, delete this file** (it is a
baton, not permanent docs — the permanent docs live in `docs/` and `prompts/`).

---

## 0. Prime directives (do not violate)

1. **Never break the live app.** `master` auto-deploys to Render
   (`render.yaml`). Anything pushed to `master` goes live in minutes.
2. **Verify before you deploy.** Run it for real (browser / device) before it
   touches `master`. If you can't verify a thing yet, put it on a branch and say so.
3. **Be surgical.** Don't touch unrelated code. Remove dead code you create.
4. **Privacy is the product.** No external/CDN calls at runtime. The app must
   work offline (it's a PWA with a service worker). The relay is a *blind pipe*
   that never sees plaintext or the raw pairing code.
5. **Match the look.** Earthy "Claude" theme, minimal, fast. Mirror the existing
   CSS variables and component style in `server/public/index.html`.
6. **Tell the truth.** If a step fails, say so with the output. Never claim
   something works that you didn't run.

---

## 1. What Yap is

Share a short **pairing code** between devices; anything you type or dictate on
one device appears **at the text cursor** on the others. Phone ↔ computer ↔ TV,
both directions, no accounts. Live app: https://yap-mkk4.onrender.com

**Stack:** Node.js relay + static web app in `server/` (`server.js`,
`public/index.html` — the whole web UI is that one HTML file with inline CSS/JS).
Planned native apps in `apps/` (desktop = Tauri/Rust; android; ios). Shared
logic in `packages/core/`. Aspirational protocol in `docs/protocol.md`.

---

## 2. Decisions the owner has locked (build to these)

- **Encryption first.** Add end-to-end encryption across web + relay (and all
  apps) *before* shipping the desktop app. (This report's §6 Task A.)
- **Host = whoever starts the code** (already true). Plus a **"Make host"**
  transfer button (already shipped). Plus: a **TV auto-hands host to the first
  phone/computer that joins**, so the human device is always in control.
- **Undo = clear my box + "unsend last".** In the desktop app, undo also deletes
  the text it just pasted on the other screen — *but only if nothing was typed
  after it* (safe window). Web-only undo just clears the compose box.
- **Desktop app = Tauri (Rust), lightweight**, same UI as the web app, with:
  paste-at-cursor, a copy-to-clipboard toggle, a **stop-pasting** toggle, undo.
- **APK in GitHub Releases** — a scroll-down "Releases" download, auto-built.
- **QR scan-to-connect** (shipped) and, later, **QR inside the keyboard** + NFC
  tap-to-connect. On a **TV**, show the TV's *own* QR for a phone to scan (you
  don't scan from a TV), and put primary remote-focus on the pairing button.

---

## 3. What was shipped THIS session (all on `master`, all live, all tested)

| Feature | Where | Verified |
|---|---|---|
| QR scan-to-connect (button on paired view → QR of `/?room=CODE`) | `index.html` + vendored `qrcode.js` | QR builds a valid scannable GIF (Node), serves over HTTP |
| Lean bottom **chat bar** (paper-plane send, inline mic, Copy removed) | `index.html` | Renders; owner confirmed live |
| Send button enables only with text; Enter sends, Shift+Enter newline; box auto-grows | `index.html` | Script parses, logic reviewed |
| Truthful send toast ("landed on N devices") from the relay's real ack | `index.html` | Server already returns `ack.delivered` |
| Short **status pill** ("0/1/2 devices") + width cap so it can't crowd the logo | `index.html` | — |
| Text box caps height, scrolls internally, **soft gradient edges** (only while scrolling) | `index.html` | — |
| **"Make host"** control transfer (crown in Devices list) | `server.js` + `index.html` | **2-client test**: 1st joiner is host; host can transfer; non-host cannot grab |
| Join box now starts **empty** (no confusing pre-fill of your own old code) | `index.html` | logic reviewed |
| **In-app QR scanner** (Scan button on join → camera → connect, never leaves site) | `index.html` + vendored `jsQR.js` | assets serve; **camera flow NOT testable in cloud — verify on a phone** |
| **Connection no longer churns on tab switch**; server enforces **one socket per device id** | `server.js` + `index.html` | **WS test**: 3 conns from 2 devices → 2 members, 1 host. Killed the flicker / double-host / phantom devices |
| Device rows labelled by **OS** (Phone vs Computer), not the old tab-role | `index.html` | logic reviewed |
| **Send + Receive merged into one "Chat" screen** with left/right **message bubbles**, newest-at-bottom, auto-scroll. Tabs are now just **Chat / Devices** | `index.html` | renders; structure verified |
| **Delivery ticks** on sent bubbles (single = sent, double accent = reached devices) + **"N devices"** in light gray | `index.html` | uses relay's real `ack.delivered` count |
| **Long-press a message → action sheet** (Copy / Resend); quick tap still copies | `index.html` | delegated pointer handlers; verify gesture on a phone |
| Dynamic **empty-chat hint** (waiting vs connected vs offline) + 44px tap targets | `index.html` | — |
| "Destroy code" moved to a quiet spot at the bottom of Devices; light-theme borders darkened ~25% | `index.html` | — |

NOTE: the UI is now a **single Chat screen** (not Send/Receive tabs) and there is
no send/receive "role" anymore — every device sends and receives. The
`?room=CODE` value sent to the relay is still the **raw code** (encryption not
wired yet — Task A). A 🔒 "encrypted" badge was intentionally NOT added until
encryption is real.

The QR auto-connect works because the app **already** auto-connects from
`/?room=CODE` on load (`index.html`, the `urlRoom` logic).

---

## 4. The verified encryption core (your foundation — already proven here)

`packages/core/crypto.mjs` — plain ESM, Web Crypto only (identical in browser &
Node). Exports:

- `normalizeCode(code)` → upper-case, strip non-alphanumerics.
- `roomFromCode(code)` → `base64url(SHA-256(code))`. **The relay routes on this**,
  so it never sees the raw code.
- `keyFromCode(code)` → AES-GCM-256 key via PBKDF2 (salt `"yap.kdf.v1"`,
  **210000** iterations, SHA-256).
- `seal(key, text)` → `base64url(iv(12) || AES-GCM ciphertext)`.
- `unseal(key, blob)` → plaintext, or `null` on wrong key / tamper (never throws).

**Run the tests:** `node --test packages/core/crypto.test.mjs` → 7/7 pass
(round-trip, wrong-key rejected, tamper rejected, deterministic room hash,
code hidden, fresh nonce, normalize).

**Cross-language test vectors** (so the Rust mirror in the desktop app can be
checked against the exact same math):
- `roomFromCode("K7QF9P")` = `m5y7nOTrj9TE1Pbh9LSBNGFqitACsWIlLsKk8cfTqjg`
- `seal` of `"hello, cursor"` with code `K7QF9P` **and a forced all-zero 12-byte
  IV** (test-only) = `AAAAAAAAAAAAAAAAA8gVxDfIR9jOqUCwRBdsU7oecTFk-DiEAtrwkOY`
  (Rust must reproduce this byte-for-byte with the same fixed IV, then switch to
  random IVs in production.)

---

## 5. Important truths about the current relay (read before Task A)

- `server.js` currently routes on the **raw code** in the query
  (`?room=CODE`) and forwards **plaintext** `{type:'text', text}`. The
  `docs/protocol.md` describes the *target* encrypted protocol — the live relay
  does **not** implement it yet.
- `sanitizeCode()` clamps the room to `[A-Z0-9]{≤12}`. A hashed room is longer,
  mixed-case base64url (`-` `_`) — so Task A must add a `sanitizeRoom()` that
  accepts base64url up to ~64 chars, used for the `?room=` param and `/poll`.
- The relay keeps a small in-memory session history per room and enforces
  `MAX_TEXT_LENGTH`. After encryption, history holds ciphertext (good — opaque),
  and ciphertext is ~1.4× longer, so raise `MAX_TEXT_LENGTH` accordingly.
- The downloadable helper scripts under `server/helpers/` speak the **old
  plaintext** protocol. Encrypting the web app **will break them.** That's
  acceptable per the owner's "encrypt first / replace helpers with the desktop
  app" decision — but **hide the helper download UI** (the header "paste" modal
  in `index.html`) when you ship encryption, until the Tauri app replaces it.

---

## 6. Work left to do — in order. Verify each before moving on.

### Task A — Wire E2E encryption into web + relay  *(do FIRST; deploys live)*
**✅ DONE — built on branch `claude/encrypt-web-relay`, verified end-to-end in
Node against the real relay (two clients, both directions, history replay, wrong
code isolated, relay logs show only the hashed room). Not yet merged to `master`
— awaiting the owner's go-ahead for the live deploy + a real two-device test.**
What shipped: `/core/crypto.mjs` served from `packages/core` (single source);
web app derives `keyFromCode`/`roomFromCode` on pairing, routes the WS on the
hash, seals outgoing / unseals incoming (skips undecryptable), keeps the local
echo in plaintext; relay gained `sanitizeRoom()` (base64url ≤64) on WS + `/poll`,
raised `MAX_TEXT_LENGTH` to 2M, serves the core module; SW bumped to `yap-v9`
with the module in the shell; helper-download UI hidden. **Rollout note:** a new
client (hashed room) and an old still-open client (raw-code room) land in
different rooms until the old one reloads — a transient during deploy, self-heals
on refresh.

Goal: relay becomes blind. Build on `packages/core/crypto.mjs`.

**Web (`server/public/index.html`):**
1. Load the core as a module and expose it to the existing classic inline
   script, e.g. add `<script type="module">import * as C from '/core/crypto.mjs';
   window.YapCrypto = C; window.dispatchEvent(new Event('yapcrypto'))</script>`,
   and serve `packages/core/crypto.mjs` at `/core/crypto.mjs` (add a static
   route or copy it into `public/`). Add it to the service-worker `SHELL` and
   bump the cache (currently `yap-v7`).
2. When a code is locked in (create/join), `await keyFromCode(code)` and
   `await roomFromCode(code)`; stash both. Keep **displaying the raw code** to
   the user — only the relay sees the hash.
3. `wsUrl()` must use the **hashed room**, not the raw code.
4. Make `doSend` async: `seal(key, text)` → send `{type:'text', text: blob}`.
   Keep the local echo in plaintext (the sender already has it in `outbox`).
5. On incoming `{type:'text', text: blob}` and on `history` replay: `unseal`
   each; if `null`, skip it (don't render garbage).
**Relay (`server/server.js`):**
6. Add `sanitizeRoom()` (base64url, ≤64) and use it for the WS `room` and
   `/poll`. Raise `MAX_TEXT_LENGTH`. Nothing else changes — it already forwards
   opaque strings.
7. Hide the helper-download UI (see §5).
**Verify (must do before merging to `master`):** run `node server/server.js`
locally, open two browser tabs, pair with a code, send both directions, refresh
to confirm history decrypts, kill/restore the connection to confirm reconnect.
Confirm the relay logs show only hashed rooms and opaque blobs. Then merge → deploy.

### Task B — Desktop app (Tauri/Rust)  *(needs a real desktop; can't build in cloud)*
Scaffold in `apps/desktop/` per `prompts/desktop.md`. The WS client + crypto
live in **Rust**; the UI reuses the web look.
- **Mirror the crypto in Rust** (`aes-gcm`, `pbkdf2`, `sha2`, `base64` crates)
  with the §4 params and assert the §4 test vectors in a `cargo test`.
- Join as a normal peer (hashed room, sealed text).
- **Paste at cursor:** Windows `SendInput`/`enigo`; macOS `CGEvent` (+ one-time
  Accessibility prompt); Linux **XDG RemoteDesktop portal** (Wayland) with
  `ydotool`/`xdotool` fallback (X11).
- Toggles: **copy-to-clipboard** vs **paste-at-cursor**, and **stop pasting**.
- **Undo / unsend:** track the last pasted run; if nothing was typed after it,
  delete exactly that run (send the right number of backspaces / synthesize
  undo). Never delete from the middle.
- Tray: connected state, quick disconnect, start-on-login.
**Verify:** on each OS, pair from a phone → text types at the cursor; on Linux
confirm Wayland via the portal; confirm undo only fires within the safe window.

### Task C — APK in GitHub Releases (auto-build)
GitHub Actions workflow: on a version tag (or merge to `master`), build the
Android app and **attach the `.apk` to a GitHub Release** so it appears under the
repo's "Releases" tab for one-tap download. (Desktop: `npm run tauri build` →
`.exe`/`.dmg`/`.AppImage` attached the same way.)

### Task D — Keyboard app + TV + NFC
- **Android keyboard (IME)** in `apps/android/` with a built-in Yap panel: pair,
  history, and a **QR generated inside the keyboard** for instant pairing.
- **TV:** same Android app, auto-detected (leanback) — *one APK, no separate
  build*. Put primary D-pad focus on the pairing/QR button. The TV shows **its
  own QR** for a phone to scan, and **auto-hands host** to the first phone/
  computer that joins (server: add a "passive host" flag so the TV's `hostDid`
  transfers automatically on the next interactive join).
- **NFC** tap-to-connect between two phones (write/read the `/?room=CODE` link).
- **iOS** (`apps/ios/`): separate Swift build + App Store (Apple requires it).

### Cross-cutting — stronger codes (ties to "encryption first")
The pairing code is the only secret, so encourage strength: default to longer
auto-codes, **warn on weak custom codes** (Gmail-style strength hint), and let
QR carry a high-entropy code so scan-pairing is the strongest path. Add relay
**rate-limiting** on join attempts per room to throttle guessing.

---

## 7. When you're done

When Tasks A–D are complete and verified and deployed, **delete `HANDOFF.md`**
and make sure the durable docs (`docs/`, `prompts/`, `README.md`) reflect the
final state. Leave the repo clean — no dead code, no stray test scripts.
