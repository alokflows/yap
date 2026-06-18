<div align="center">

<img src="server/public/icon.svg" width="104" alt="Ripple" />

# Ripple

### Talk or type on one device — the words land at the cursor on another.

Phone → computer · Phone → TV · Computer → phone. **Any device, both directions.**
No accounts. No API keys. Share a code, that's it — and the relay never sees your text.

<br />

[![Open the web app](https://img.shields.io/badge/▶_Open_the_web_app-c4673f?style=for-the-badge)](https://yap-mkk4.onrender.com)
[![Download](https://img.shields.io/badge/⤓_Download_apps-2b2018?style=for-the-badge)](https://github.com/alokflows/ripple/releases)

<br />

![Android build](https://github.com/alokflows/ripple/actions/workflows/android-build.yml/badge.svg)
![Desktop build](https://github.com/alokflows/ripple/actions/workflows/desktop-release.yml/badge.svg)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-Web_·_macOS_·_Windows_·_Linux_·_Android_·_TV-faf3ed?labelColor=c4673f)

</div>

---

```
 ┌─────────┐                 ┌─────────┐                 ┌─────────┐
 │ Phone   │ ◄────────────►  │  Relay  │  ◄────────────► │  TV /   │
 │ keyboard│   encrypted     │ (blind  │    encrypted    │ computer│
 │ + mic   │   text          │  pipe)  │    text         │ keyboard│
 └─────────┘                 └─────────┘                 └─────────┘
        every device can send AND receive — no "host"
```

## What it is

Your devices share a short **pairing code**. Anything you type or say on one shows
up — **right at the text cursor** — on the others. It's a data cable made of Wi-Fi:
text flows **both ways** between phones, computers, and TVs. On devices with OS
access (the desktop app, the Android keyboard) the text is typed straight into
whatever app you're in.

The relay in the middle is a **blind pipe**. It routes on a *hash* of your code and
only ever forwards **sealed (AES-GCM) blobs** — it cannot read a single word, and
there are no accounts, logs, or API keys.

## Download

All downloads live on one release: **[Releases → latest ↗](https://github.com/alokflows/ripple/releases/latest)**.

| Platform | Get it | Notes |
| --- | --- | --- |
| **Web** | [Open the app ↗](https://yap-mkk4.onrender.com) | Works on any device with a browser. Installable as a PWA. |
| **Android + TV** | `Ripple-android.apk` | A keyboard *and* app in one. Sideload, then enable the Ripple keyboard. |
| **macOS** | `.dmg` | Types received text at your cursor. |
| **Windows** | `.exe` | Types received text at your cursor. |
| **Linux** | `.AppImage` | Types received text at your cursor. |
| **iOS** | _coming later_ | Keyboard extension + app. |

> Android & desktop are early builds — see **[Status](#status)**. The web app is the
> stable one.

## Features

- **Both directions, every device.** No host — anyone with the code sends and receives.
- **Lands at the cursor.** The desktop app and Android keyboard type received text
  straight into the focused field of any app.
- **End-to-end encrypted.** AES-GCM per message; the key is derived from your code
  and never leaves your devices. The relay sees only a room hash + ciphertext.
- **Pair in seconds.** Type a code, or **scan a QR** — generated offline, no outside
  service.
- **One identity everywhere.** Same warm-clay look and Ripple bubble across web,
  desktop, and Android.
- **Speed-first.** The input path never blocks on the network; text appears instantly.

## How it works

A pairing code is the only shared secret. From it, every client derives:

- a **room id** = `base64url(SHA-256(code))` — the relay routes on this, never the code;
- an **AES-256-GCM key** (PBKDF2-HMAC-SHA256) — used to `seal`/`unseal` each message.

So the relay is a pure switchboard for opaque blobs. The exact wire protocol and
threat model live in **[`docs/protocol.md`](docs/protocol.md)** and
**[`docs/security.md`](docs/security.md)**.

## Status

| Component | State |
| --- | --- |
| Web app + relay | ✅ Live ([yap-mkk4.onrender.com](https://yap-mkk4.onrender.com)) |
| Desktop (Tauri) | ✅ Builds for mac/Win/Linux · beta, on-device testing ongoing |
| Android app + keyboard | 🟡 Builds & installs · early beta, not yet device-hardened |
| Android camera QR scan | 🟡 Implemented · pending on-device test |
| iOS | ⏳ Planned |

## Build from source

```sh
# Crypto vectors (shared across JS / Rust / Kotlin)
node --test packages/core/crypto.test.mjs
(cd packages/core-rs && cargo test)

# Web app / relay
cd server && npm install && node server.js      # http://localhost:8099

# Desktop app
cd apps/desktop && npm install && npm run tauri dev

# Android (needs the Android SDK + JDK 17)
cd apps/android && gradle :app:assembleDebug
```

## Project layout

```
server/          Node WebSocket relay + single-file web app (deployed)
packages/core/   Reference crypto (JS/WebCrypto) + cross-language test vectors
packages/core-rs Rust crypto mirror      packages/core-kt  Kotlin crypto mirror
apps/desktop/    Tauri (Rust) desktop app — types at the cursor
apps/android/    Ripple keyboard (IME) + container app — phone & TV
docs/            architecture · protocol · security  (the contracts)
```

## Privacy & security

No accounts, no analytics, no third-party calls at runtime. Messages are encrypted
on-device; the relay is a blind pipe. QR codes are generated and scanned locally —
camera frames never leave the device. Found something? See
[`docs/security.md`](docs/security.md).

## License

[Apache-2.0](LICENSE). The Android keyboard builds on FlorisBoard — attribution is
preserved in [`NOTICE`](NOTICE).
