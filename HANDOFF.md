# Ripple — Handoff (read me, then continue)

**You are Claude Code picking up the Ripple project.** The owner is non-technical,
often on their phone, sometimes away from the computer (which they leave on for
you). Standing instruction: *"read the handoff and continue."* Maximum autonomy —
do everything you can without making them intervene; ask only when there's
genuinely no other way. Keep chat replies short and concrete.

This file is the living context. **Update it as you make progress** so the next
cold session is fully oriented. It must contain *everything* needed to continue.

---

## 0. Prime directives (do not violate)

1. **Never break the live web app.** `master` is what users hit (Render deploys
   it). Verify before shipping. The web app + relay live in `server/`.
2. **Privacy is the product.** The relay is a *blind pipe*: it must never see the
   raw pairing code or any plaintext. Clients route on a hash of the code and
   exchange only sealed (AES-GCM) blobs. No external/CDN calls at runtime.
3. **Speed is the #1 feature.** This is a "type at the cursor" tool — latency is
   the product. Never block the input path on the network. Advanced features come
   second to instant, reliable delivery.
4. **One soul across platforms.** Web ↔ desktop ↔ Android must feel identical:
   same warm-clay "Claude" palette, same Ripple bubble icon, same flows. Improve
   something in one place → mirror it everywhere.
5. **Tell the truth.** If something isn't verified (needs a real device/network),
   say so plainly. Never claim a thing works that you didn't run.
6. **Think, don't stenograph.** The owner is non-technical and may describe a
   want imprecisely. Engage critically: propose the better approach, flag risks,
   suggest advanced features they didn't ask for but would want. Aim for
   best-in-class ("build it like it's flight software — every pixel cared for").
7. **Be surgical.** Don't touch unrelated code; remove dead code you create.

---

## 1. What Ripple is

Share a short **pairing code** between devices; anything you type or dictate on
one device appears on the others (phone ↔ computer ↔ TV), both directions, no
accounts. On clients with OS access (desktop app, Android keyboard) received
text is **typed/committed at the cursor in any app**. Every device is a full
**peer** (sends + receives).

- **Live web app / relay:** `https://yap-mkk4.onrender.com` (hostname keeps the
  old "yap" slug on purpose — see §3 / §7; it's invisible to users).
- **Repo:** `alokflows/ripple` on GitHub (public). The *product* is renamed to
  Ripple everywhere; the **repo slug is still `yap`** until the owner renames it
  in GitHub Settings (old links auto-redirect after). `gh` authed as `alokflows`.
- Local working copy on the owner's Mac: `~/Documents/Ripple` (path may vary).

---

## 2. Repo layout

- `server/` — relay + web app (deployed by Render, `rootDir: server`).
  - `server.js` — Node WebSocket relay (`/ws`), long-poll (`/poll`), `/healthz`,
    static file server, abuse limits (§5).
  - `public/index.html` — the **entire web UI** (inline CSS/JS). `sw.js` (PWA),
    `qrcode.js`, `jsQR.js`, `manifest.webmanifest`, `icon.svg`, `icons/*`.
  - `scripts/gen-icons.mjs` — regenerates `icon.svg` + PWA PNGs from one bubble
    definition (needs dev-only `@resvg/resvg-js`; NOT a runtime dep).
  - `helpers/ripple-*` — legacy plaintext desktop helper scripts, **hidden/
    disabled** in the UI (kept for the `/poll` path only). Don't surface them.
- `packages/core/crypto.mjs` — E2E crypto (JS/WebCrypto). Tests:
  `node --test packages/core/crypto.test.mjs` (7/7).
- `packages/core-rs/` — **Rust mirror** of the crypto. `cargo test` (8/8).
- `packages/core-kt/` — **Kotlin mirror** of the crypto for Android (`RippleCrypto`).
  Same vectors; verified with kotlinc 2.1.0 (5/5). `gradle test` or fold into the
  Android app. JDK 21 + Gradle + (downloadable) kotlinc all work in the sandbox.
- `apps/desktop/` — **Tauri v2** desktop app (Rust core + vanilla HTML/JS UI).
- `apps/android/` — **placeholder** (README only). The keyboard app lands here —
  see §10, the next big build.
- `apps/ios/` — placeholder (build last).
- `docs/` — `protocol.md`, `security.md`, `architecture.md` (⚠ STALE — see §9).
- `prompts/` — original build specs (`prompts/android.md` is the keyboard spec).
- `.github/workflows/` — `keepalive.yml` (pings relay so Render free tier stays
  awake), `desktop-release.yml` (builds desktop installers).

---

## 3. The crypto core (the heart of the privacy model)

Identical math in JS (`packages/core/crypto.mjs`) and Rust (`packages/core-rs`).
**A third (Kotlin) implementation is required for Android — see §10/§9.**

- `normalizeCode` → upper-case, strip non-alphanumerics.
- `roomFromCode(code)` → `base64url(SHA-256(code))`. **Relay routes on this**,
  never the raw code.
- `keyFromCode(code)` → AES-GCM-256 key via PBKDF2 (salt `yap.kdf.v1`, **210000**
  iters, SHA-256). ⚠ The salt literal is `yap.kdf.v1` — **do NOT rename it**;
  changing it breaks all interop and the vectors below. It's invisible to users.
- `seal(key, text)` → `base64url(iv(12) || AES-GCM ciphertext)`.
- `unseal(key, blob)` → plaintext, or null on wrong key/tamper (never throws).

**Cross-language vectors (must stay byte-for-byte; every implementation asserts):**
- `roomFromCode("K7QF9P")` = `m5y7nOTrj9TE1Pbh9LSBNGFqitACsWIlLsKk8cfTqjg`
- `seal` of `"hello, cursor"` with code `K7QF9P` and a forced all-zero 12-byte IV
  = `AAAAAAAAAAAAAAAAA8gVxDfIR9jOqUCwRBdsU7oecTFk-DiEAtrwkOY`

---

## 4. Protocol (as IMPLEMENTED — trust this over docs/)

WebSocket `wss://yap-mkk4.onrender.com/ws?role=<phone|desktop>&room=<hash>&did=<id>`.
JSON frames. The relay stores a per-code session in memory (notes + lock + host).

Client → server: `text` `{text: <sealed>, cid?}` · `clear` (host only) · `setOpen`
`{open}` (host) · `kick` `{id}` (host) · `setHost` `{id}` (host) · `destroy`
(host) · `ping`.
Server → client: `joined` / `presence` `{members[], phones, desktops, open,
hostDid, id}` · `history` `{messages[]}` · `text` `{id, text, t}` · `ack`
`{id, t, delivered, cid?}` (echoes the sender's `cid` so the bubble pairs by id,
not FIFO) · `cleared` · `kicked` · `destroyed` · `error` `{code?, message}` with
codes `locked` / `full` / `busy` / (generic).

Host = first device with a `did` to join; **reassigned to the oldest remaining
device if the host leaves**. Lock (`open=false`) lets only already-known `did`s
rejoin. Codes are **shared/symmetric** — anyone with the code joins the same
room; there is no "wrong password" and (deliberately) no "code taken".

---

## 5. What's DONE

### Web app + relay (on `master`; owner deployed) ✅
- E2E encryption live; relay is blind (logs only the room **hash**, never code or
  plaintext). Verified blind earlier against production.
- **Relay hardening** (in-memory, no deps): per-IP rate limit on WS + `/poll`,
  global connection ceiling, `maxPayload`, `MAX_ROOM_MEMBERS=16` ("room full"),
  host reassignment on host disconnect, `clear` gated to host. Verified with a
  7/7 local behavior-test run.
- **Web robustness:** sent bubbles pair by client id (`cid`) so a dropped/rejected
  send can't shift later bubbles onto the wrong text; undecryptable messages show
  one calm "same code?" notice instead of vanishing; client-side length guard;
  `full`/`locked` are terminal (no reconnect-flap).
- **Rebrand Yap → Ripple** everywhere + new bubble icon (web favicon, PWA icons,
  in-app mark). SW cache renamed (`ripple-v*`) so clients refresh.
- ✅ **Live deploy verified (2026-06-17, from the owner's Mac):** production
  `sw.js` = `ripple-v11`, byte-identical to `master`; `/healthz` = ok. So the
  current `master` web app/relay is what's live. (The *cloud sandbox* still can't
  reach the relay — egress 403 — but the owner's Mac can, which is how this and
  future deploys get confirmed: `curl -s …/sw.js | grep -o 'ripple-v[0-9]*'`.)

### Desktop app (Tauri v2, `apps/desktop/`) ✅ mostly
Web-identical UX: Create/Join + QR, Chat/Devices, composer (paper-plane send),
toggles (Type-at-cursor, Auto-copy), Undo, system tray. Right-click bubble →
Copy/Resend. Devices list uses the **same per-OS SVG icons as the web**.
- **Fast paste:** clipboard + Cmd/Ctrl+V (one action), not char typing.
- **macOS:** prompts once for Accessibility. Verified working in the *Yap* era;
  **not re-verified on a device since the rebrand**.
- **Linux:** X11 = clipboard+Ctrl+V (enigo). **Wayland** (Ubuntu default) = the
  **XDG RemoteDesktop portal** (`ashpd`, zero-install, one-time permission, token
  persisted) → falls back to `wtype`/`ydotool` → falls back to clipboard + "press
  Ctrl+V" toast. Auto-copy works on Wayland (`arboard` `wayland-data-control`).
  ⚠ **Only `cargo check`'d — never run on a real Wayland session.** The owner has
  not yet tested the Linux build.
- **Close = hide to tray (instant); tray Quit = immediate exit** (fixed a slow
  close). Kicked/closed/locked are terminal (no flap). Decrypt failures toast.
- Rust: `src-tauri/src/lib.rs` (relay client, tokio-tungstenite + native-tls),
  `src-tauri/src/inject.rs` (paste/clipboard/undo + `portal` module). Crypto from
  `packages/core-rs` (now crate `ripple-core`). Crate is `ripple-desktop`, lib
  `ripple_desktop_lib`, bundle id `com.alokflows.ripple`. Tauri events are
  `ripple://status|message|devices|notice`.

### Installers (CI) ✅
`.github/workflows/desktop-release.yml` (tauri-action) builds mac/Win/Linux →
GitHub Release **`desktop-dev`** (`.dmg`/`.msi`/`.exe`/`.AppImage`/`.deb`/`.rpm`).
The latest run is the **Ripple** build (new icon, Wayland portal, fast close).
✅ The temporary dev-branch auto-build trigger has been **removed** (2026-06-17);
installers now come from `v*` tags or `workflow_dispatch` only.

### Android app + keyboard (CI-green) ✅ builds; ⚠ not device-tested
`apps/android/` is a Gradle/AGP-8.7/Kotlin-2.1/Compose project, `minSdk 26` (the
crypto needs `java.util.Base64` + PBKDF2, both API-26). `.github/workflows/
android-build.yml` assembles a debug APK (`ripple-debug-apk`) — **green**.
- **Networking/crypto:** `net/RippleClient` = one OkHttp WS speaking the §4
  protocol (seal/unseal, room-hash routing, optimistic non-blocking send,
  id-correlated acks, backoff reconnect, terminal kicked/full/locked). Reuses
  `packages/core-kt` `RippleCrypto` **by source** (no drift from JS/Rust).
- **Shared socket:** `RippleRepository` (process-wide singleton) owns the one
  client so the app *and* the keyboard share a single WebSocket + history;
  `RippleConnectionService` (foreground, `dataSync`) keeps it alive when only the
  keyboard is up.
- **Container app:** `RippleViewModel` + Compose Connect/Chat (warm-clay M3).
- **Pairing QR:** `util/QrCodes` (ZXing, offline) generates the same `/?room=CODE`
  QR as web/desktop (Chat top bar + keyboard panel) AND `ui/ScanScreen` scans one
  with the camera (CameraX + on-device ZXing decode, no ML Kit). ⚠ Scanning is
  unverified (emulator camera is synthetic).
- **The keyboard:** `ime/RippleImeService` (InputMethodService) — a working
  compact key grid **plus the Ripple panel**: received text → chips that
  `commitText` **at the cursor** on tap; typed text → **send** to paired devices.
  Native key grid for now (FlorisBoard-grade layout can swap in later without
  touching the panel/plumbing). ✅ **Verified on an Android-15 emulator on the
  owner's Mac (2026-06-18):** app launches (no crash), pairs to the **live relay**,
  **E2E encrypted send + receive both work** (proven against a Node test-peer —
  emoji intact, history replay OK), keyboard registers as an IME, renders the
  panel, **inserts a received chip at the cursor**, letter keys type. Still
  unverified: **camera QR scan**, the FGS notification, TV/leanback.

### Cross-language crypto ✅
JS (7/7) + Rust (8/8) vectors pass; salt/host preserved through the rebrand.

---

## 6. Git / deploy state (read carefully)

- **`master` = the live truth.** As of this handoff it contains the full rebrand,
  relay hardening, web robustness, and all desktop fixes (merge commit on top).
- The branch **`claude/ubuntu-app-issues-2dr7ek`** holds the same work and is
  what the desktop CI currently auto-builds. A **dedicated test/cleanup session
  is planned** by the owner that will rigorously test all versions and **delete
  branches** — so keep `master` authoritative and this file on `master`.
- **Render deploy:** `render.yaml` (`rootDir: server`, `autoDeploy: true`,
  service name `yap`). Autodeploy has historically been flaky → the owner clicks
  **Manual Deploy**. There's no Render API key/deploy-hook locally; you can't
  deploy yourself. **A web/relay change only goes live after a push to `master`
  AND a Render deploy.** Bump the `sw.js` cache version (`ripple-v*`) on web
  changes so PWA clients refresh.
- Confirm a deploy (from a machine that can reach it):
  `curl -s https://yap-mkk4.onrender.com/sw.js | grep -o 'ripple-v[0-9]*'`.

---

## 7. Build / run / verify commands

```sh
# Crypto vectors
node --test packages/core/crypto.test.mjs
(cd packages/core-rs && cargo test)

# Relay (local): node server.js  (PORT=8099 for tests)
# Desktop dev / build
cd apps/desktop && npm install && npm run tauri dev
cd apps/desktop && npm run tauri build
# Desktop crate check (needs Linux GUI deps: libwebkit2gtk-4.1-dev,
# libxdo-dev, libssl-dev, libayatana-appindicator3-dev, librsvg2-dev,
# libgtk-3-dev, patchelf):  (cd apps/desktop/src-tauri && cargo check)

# Android — CI builds the APK, but the OWNER'S MAC can also run an emulator
# (toolchain installed to ~/Library/Android/sdk; JDK = /opt/homebrew/opt/openjdk@17):
gh workflow run android-build.yml     # CI build → ripple-debug-apk artifact
SDK=$HOME/Library/Android/sdk; ADB=$SDK/platform-tools/adb
$SDK/emulator/emulator -avd ripple -no-window -gpu swiftshader_indirect &  # headless boot
$ADB wait-for-device; gh release download android-dev -R alokflows/ripple -p '*.apk' -O /tmp/r.apk --clobber
$ADB install -r -g /tmp/r.apk && $ADB shell am start -n com.alokflows.ripple/com.ripple.app.MainActivity
$ADB exec-out screencap -p > /tmp/shot.png   # drive via `input tap/text`, enable IME via `ime set`

# Installers via CI
gh workflow run desktop-release.yml   # or push a v* tag
# Regenerate icons from the one bubble definition:
(cd apps/desktop && npm i -D @resvg/resvg-js && npm run tauri icon <1024.png>)
(cd server && npm i -D @resvg/resvg-js && node scripts/gen-icons.mjs)
```

Rust toolchain via rustup: `. "$HOME/.cargo/env"`.

---

## 8. Sandbox limits (be honest about these)

The cloud sandbox **cannot reach `yap-mkk4.onrender.com`** (egress 403) and
**cannot build/run Android, iOS, or a GUI** (no Android SDK/emulator, no display).
So: web "is it live" checks, Android builds, and on-device behavior must be
validated via **CI + the owner's real device**, or from the owner's Mac. State
this plainly rather than guessing. `cargo check`/unit tests/relay tests DO run
here and are real verification.

---

## 9. ⚠ Known issues / must-fix-soon (engineering judgment)

1. ✅ **DONE — `docs/protocol.md` + `docs/security.md` now match the code** (the
   as-built protocol in §4, AES-GCM + PBKDF2-210k + fixed salt + real host model).
   They were rewritten; the Android keyboard can be built against them safely.
2. **Crypto roadmap (documented, not yet changed):** it's PBKDF2-210k + fixed salt,
   not Argon2id. `security.md` now states this honestly and lists the upgrade path:
   fold the room hash into the salt (kills cross-user rainbow tables cheaply) →
   Argon2id → PAKE. Worth doing, but it's a *coordinated* change across all four
   crypto cores (JS/Rust/Kotlin) + a new vector set, so plan it deliberately.
3. **Reliability/security audit findings** (from a prior deep audit) mostly fixed
   on the relay; remaining: no client resend of offline-queued messages; presence
   leaks room occupancy to anyone who guesses a room hash (inherent to a blind
   relay; rate-limit mitigates); legacy `/poll` + `/dl` raw-code routes still
   exist (helpers disabled) — consider removing.
4. **Desktop unverified on device since rebrand** (mac + Linux). **Wayland portal
   never run for real.** Owner hasn't checked Linux yet.
5. ✅ **DONE** — temporary dev-branch CI trigger removed from `desktop-release.yml`.
6. **Repo still named `yap`** — owner to rename to `ripple`.

---

## 10. NEXT BIG BUILD — Ripple Keyboard (Android + TV)

**Vision (owner's words, refined):** a *professional, privacy-first, blazing-fast*
keyboard that is a full Ripple peer. You can read/insert the chat **without
leaving the keyboard**, OR open the **full app** (a website-identical screen) for
the complete experience plus keyboard settings. Same signed APK runs on phones
and **Android TV** (leanback). FlorisBoard is the base (don't reinvent a keyboard).

### Progress (2026-06-17)
✅ **Slice 1 — container app** and ✅ **Slice 2 — the keyboard (IME) + shared
socket**, both CI-green (see §5 "Android app + keyboard"). The app and the IME
share one socket (`RippleRepository` + `RippleConnectionService`); the keyboard
inserts received text at the cursor and sends typed text.
⚠ **Design divergence to know:** the IME currently uses a **native compact key
grid**, *not* a FlorisBoard fork. Rationale: vendoring all of FlorisBoard is a
large, deliberate effort and the Ripple panel + networking are identical either
way — so we shipped a working keyboard now and kept Floris as a later swap-in for
a richer layout (emoji/glide/long-press). Revisit when layout richness matters.
**Remaining (priority):** (a) richer key layout (symbols/emoji, or vendor
FlorisBoard); (b) keyboard **setup wizard** + **Settings** (consent mode
auto/ask/off, theme, default code); (c) Compose **QR scan** + on-device
**dictation** (QR *generation* is done — only camera scanning remains); (d)
**history encrypted at rest**; (e) **signed-APK release**
workflow (keystore as a base64 GitHub secret); (f) TV D-pad polish + replace the
placeholder icon with the canonical bubble. **First real test:** sideload the
APK, enable the keyboard, pair, type both ways.

### Architecture (recommended)
- **Fork FlorisBoard** (Apache-2.0, Kotlin/Gradle/AndroidX) into `apps/android/`.
  ⚠ The current `apps/android/` is the **container-app Gradle project** (module
  `:app`, package `com.ripple.app`). When vendoring FlorisBoard, add it as
  sibling module(s) and reuse `:app`'s `RippleClient`/crypto — don't fork over
  the existing project. Keep its IME engine, layouts, emoji, clipboard, theming.
  **Preserve `NOTICE`**.
- **Ripple panel inside the IME:** a toolbar key opens a panel (same pattern as
  FlorisBoard's clipboard/emoji panels) with tabs **Connect / Live / History**.
  Commit received text at the cursor via `currentInputConnection.commitText()`.
  Dictate/type → seal → send (full peer). Respect a consent mode (auto/ask/off).
- **Container app (Jetpack Compose):** full-screen chat UI that **mirrors the
  website** (pairing: Create/Join + QR scan, Chat, Devices) PLUS **Settings**
  (theme, consent mode, default code, autostart, manage devices) PLUS the
  **keyboard enable/setup wizard**. This is the "extra features in the app" the
  owner wants.
- **One networking service:** a bound **foreground Service** owns a single OkHttp
  WebSocket shared by the IME and the app (so the connection survives and the
  input path never blocks on the network). Heartbeat + backoff reconnect.
  Protocol v1 per §4. **Speed first:** pre-warm the socket; commit-at-cursor is
  synchronous and instant; never await the network on a keypress.
- ✅ **Kotlin crypto mirror DONE:** `packages/core-kt/` (`RippleCrypto`) mirrors §3
  byte-for-byte and **passes the cross-language vectors** (verified with kotlinc
  2.1.0, 5/5). The Android app depends on this module or includes `Crypto.kt`. The
  riskiest correctness item is already de-risked.
- **History at rest encrypted** (Jetpack Security / EncryptedSharedPreferences) —
  the spec says never store history unencrypted.
- **TV (leanback):** leanback launcher intent + a D-pad-friendly Connect screen;
  receive text into TV search/text boxes; same APK. (Host model already exists in
  the relay if a "hand control to phone" flow is wanted later.)
- **Distribution (no Play Store):** `./gradlew assembleRelease` → **signed APK**,
  sideloadable to phone + TV. Add `android-release.yml` CI (build APK on tag/
  dispatch into a release). Keystore: generate, store base64 in a GitHub secret,
  document in `apps/android/README.md`.

### Design system
- **Use Google's Material 3** (`m3.material.io`) as the base for the *app*
  screens (Compose Material3): components, motion, accessibility, dynamic type.
  **Override the color scheme with our warm-clay palette** (clay `#c4673f`, paper
  `#faf3ed`) as the M3 seed/scheme, and use the Ripple bubble as the mark. For the
  *keyboard*, use FlorisBoard's theming with the same palette (Light, Dark, true-
  black OLED). Net: Material 3 for structure + our identity for skin. (Answer to
  the owner's "is Google's design.md useful?": yes — adopt M3 for the app, keep
  our palette/bubble.)

### Suggested advanced features (propose to owner; don't blindly add all)
- On-device **dictation** via Android `SpeechRecognizer` (private, fast) wired to
  the keyboard mic → send.
- **QR scan inside the keyboard/app** to join a code instantly (CameraX + a QR
  lib, or reuse `jsQR` approach natively).
- **Quick actions**: one-tap paste of the last received message; swipe to insert
  history items; a floating "incoming" chip above the keyboard.
- **Per-app consent** (auto-paste only in allowlisted apps).
- NFC tap-to-pair (TV ↔ phone) — later.

### Hard truths / what I can/can't guarantee
- I can write all the Kotlin/Gradle code, the CI, and the crypto+vectors. I
  **cannot build or run Android here** (no SDK/Gradle/emulator/device). "It
  compiles / it works" must be proven by **CI + the owner's device/TV test**.
- Forking FlorisBoard is a large codebase to vendor and keep updated; it's still
  the right call for v1 (full keyboard for free) — but flag the maintenance cost.
- Do §9.1 (fix the protocol/security docs to match reality) **before** writing the
  Android networking/crypto, or effort will be wasted on the wrong contract.

---

## 11. Status / history log (newest first)

- 2026-06-18: **FIRST ON-DEVICE TEST (emulator) — Android core works.** Renamed
  repo+folder to **ripple** (`github.com/alokflows/ripple`, `~/Documents/ripple`).
  Then stood up an **Android-15 arm64 emulator on the owner's Mac** (installed
  openjdk@17 + cmdline-tools + emulator + system image to `~/Library/Android/sdk`;
  AVD `ripple`; boot headless: `emulator -avd ripple -no-window -gpu
  swiftshader_indirect`). Installed the release APK and verified against the LIVE
  relay: app launches, pairs, **E2E send+receive both work** (Node test-peer with
  the JS crypto — emoji + history OK), keyboard registers as IME, panel renders,
  **received chip inserts at the cursor**, keys type. ⚠ Still unverified: camera
  QR scan (synthetic emulator camera), FGS notification, TV. **Lesson:** "can't
  test on device" was wrong on the owner's Mac — the emulator is the real loop now.
- 2026-06-18: **Camera QR scanning + downloadable releases + README redesign.**
  (1) `ui/ScanScreen` — CameraX preview + **on-device ZXing decode** of the Y
  plane (frames never leave the device); parses `/?room=CODE` or a bare code and
  connects. Reused the bundled `zxing-core` (no ML Kit) to stay lean; **dropped
  `material-icons-extended`** (APK bloat) for a local QR vector + `-core`.
  (2) `android-build.yml` now **publishes the APK to a rolling `android-dev`
  Release** (one-click download; verified — asset live, **12.4 MB debug**) and to
  `v*` tags; desktop releases set to published. (3) Redesigned the landing README
  (badges + Download table). All CI-green, merged to `master`. ⚠ Camera scan/
  preview still unverified on a real device. **Size note:** 12.4 MB is the *debug*
  APK; a release build (R8 minify + resource shrink) should roughly halve it but
  must be validated on-device first (R8 can over-strip an untested app).
- 2026-06-17 (latest+): **Pairing QR in the Android app + keyboard.** `util/QrCodes`
  (ZXing, offline) encodes the same `/?room=CODE` link as web/desktop; shown via a
  QR action in the Chat top bar and a "QR" pill in the keyboard panel. Generation
  only — camera scanning to pair is the follow-up. CI-green; merged to `master`.
- 2026-06-17 (latest): **Built the Ripple keyboard (Android IME).** Added
  `ime/RippleImeService` (working key grid + Ripple panel: received text inserts
  at the cursor, typed text sends to paired devices), `RippleRepository` (one
  shared socket for app+IME) and `RippleConnectionService` (foreground, keeps the
  socket alive). Refactored the ViewModel onto the repository; manifest IME +
  FGS + notification wiring. CI-green debug APK; merged to `master`. Chose a
  native key grid over a FlorisBoard fork for now (see §10 divergence note).
  ⚠ Not yet run on a device — typing/commit-at-cursor unverified.
- 2026-06-17 (late): Session run from the **owner's Mac** (can reach the relay).
  (1) **Verified the live deploy** — prod `sw.js` = `ripple-v11` = `master`,
  `/healthz` ok (closes the long-standing "can't confirm live" gap). (2) Removed
  the temporary dev-branch trigger from `desktop-release.yml` (§9.5 done).
  (3) **Started the Android keyboard build** — scaffolded `apps/android/` as a
  CI-green container app: Gradle/AGP-8.7/Kotlin-2.1/Compose, `net/RippleClient`
  (OkHttp WS, §4 protocol), `RippleViewModel` + Compose Connect/Chat in warm-clay
  M3, crypto reused from `core-kt` by source, leanback intent for TV, adaptive
  icon/banner, `android-build.yml` (debug APK artifact, build passed). Merged to
  `master`. Next: the FlorisBoard IME fork. **Not device-tested.**
- 2026-06-17 (night): Cleared the two Android blockers. (1) Rewrote
  `docs/protocol.md` + `docs/security.md` to match the running code (they
  described a different, never-built protocol). (2) Built the **Kotlin crypto
  mirror** `packages/core-kt/` and proved it against the cross-language vectors
  with kotlinc 2.1.0 (5/5) — also re-proved the exact JVM crypto via a `javac`
  run. Android's hardest correctness piece is done; the keyboard build can start.
- 2026-06-17 (evening): Wrote this comprehensive handoff. Merged the rebrand +
  fixes branch to `master`; owner deployed the web app to Render (reported
  working; unverifiable from sandbox). Set the Android keyboard + TV plan (§10)
  and the must-fix list (§9). Next big build = Ripple Keyboard.
- 2026-06-17: **Rebrand Yap → Ripple** everywhere + new smooth speech-bubble icon
  (one source → web + desktop). Kept crypto salt, relay host, Render service name
  (technical/infra). Verified: desktop `cargo check`, crypto 8/8 + 7/7, relay 7/7.
- 2026-06-17: **Relay hardening** (rate limits, room cap, host reassignment,
  host-gated clear) + **web robustness** (id-correlated bubbles, decrypt notice,
  length guard, terminal full/locked) + **desktop** (Wayland XDG portal paste,
  Wayland clipboard, fast close-to-tray, terminal disconnects). Reliability/
  security audit run (findings in §9).
- 2026-06-17 (early): Tauri desktop app made web-identical; Linux/Wayland typing;
  cross-platform release CI; `desktop-dev` release; Rust crypto mirror + vectors.
- 2026-06-16: Shipped E2E encryption to the live web app + relay; web polish.

When an area is finished and durably documented in `docs/`/`prompts/`, you may
trim this file — but keep it the single place a cold session gets oriented.
