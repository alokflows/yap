# Ripple — project memory for Claude Code

Read this first, then continue. This file is loaded automatically at the start of
every Claude Code session, so you never need the owner to re-explain the project.

The owner is a beginner (new to GitHub as of June 2026), often on a phone, and
wants **simple apps that just work, for free**. Keep replies short and concrete.
Do the work; don't make them do setup.

## What Ripple is
Share a short **pairing code** between devices; text you type/say on one device
appears **at the cursor** on another (phone ↔ computer ↔ TV), both directions, no
accounts. The relay is a blind pipe that only forwards data for a code.

- Live web app + relay: https://yap-mkk4.onrender.com  (hostname keeps the old
  "yap" slug on purpose; invisible to users)
- Repo: alokflows/ripple (public)

## Golden rules
1. **Never break the live web app.** `master` is what users hit (Render deploys
   `server/`). A web change goes live only after merge to `master` **and** a
   manual Render deploy (the owner clicks it). Bump `server/public/sw.js` cache
   (`ripple-v*`) on web changes so clients refresh.
2. **Encrypted by default; helper mode is the plaintext exception.** The web app
   normally sends sealed (AES-GCM) blobs, routed on a hash of the code. The
   desktop "helper" scripts read plain text via `/poll`, so the website's
   paste-at-cursor download turns on **helper mode**, which mirrors each sent
   message as plain text to the raw-code lane. Send-only; don't weaken the
   default encrypted path.
3. **Work in small steps. Commit often.** One change → test → commit → push.
   Develop on a branch, not directly on `master`.
4. **Be honest.** If something isn't tested on a real device/relay, say so.

## Layout
- `server/` — Node relay + the whole web app (`public/index.html`, inline CSS/JS).
  `helpers/` = the desktop paste-at-cursor scripts (win/mac/linux).
- `apps/desktop/` — Tauri (Rust) desktop app: types received text at the cursor,
  lives in the tray (left-click the tray icon to bring it back).
- `apps/android/` — Kotlin/Compose app + a keyboard (IME). Remembers the code and
  auto-reconnects. Keyboard is a basic proof-of-concept (no symbols/emoji yet).
- `packages/core*` — the crypto, mirrored in JS / Rust / Kotlin (same test vectors).
- One canonical icon: `server/public/icon.svg`; regenerate sizes with
  `cd server && npm i -D @resvg/resvg-js && node scripts/gen-icons.mjs`.

## Build / test
```sh
node --test packages/core/crypto.test.mjs        # crypto vectors
cd server && npm install && node server.js        # web app + relay (PORT=8099 for tests)
cd apps/desktop && npm install && npm run tauri dev
# Android builds in CI (.github/workflows/android-build.yml); can't build in a sandbox.
```

## Releases (the owner wants exactly 4 files, no "pre-release")
CI publishes ONE non-prerelease GitHub Release tagged `latest` with: one **APK**,
one **DMG**, one **EXE**, one **AppImage**. Desktop builds on a `v*` tag or manual
run; Android on a push to `master`.

## Status (update this as you go)
- Web app + relay: live. Helper mode (plaintext lane) added — needs Render deploy.
- Desktop: builds; tray-restore fixed; unsigned (Windows shows a one-time
  "More info → Run anyway").
- Android: builds; basic keyboard; not yet a FlorisBoard-grade keyboard.
- Next big build: a real keyboard (fork FlorisBoard) + Android TV D-pad support.
