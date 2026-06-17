# AGENTS.md — build blueprint for AI coding agents

Dense on purpose. Humans: read `README.md` + `docs/`.

## TL;DR

Ripple = encrypted, symmetric, cursor-targeting text relay across devices.
Relay = blind WS router. Clients = web, android-keyboard, desktop(tauri), ios.
Every client is a **peer** (sends + receives). No host. Consent is per-receiver.

## Repo map

```
server/            Node relay + web app (LIVE, deployed; rootDir for Render). Don't rename.
  server.js        WS router (/ws), /poll, /healthz
  public/index.html  single-file web app
packages/core/     TS reference impl of the protocol (crypto, framing, history). Source of truth for clients.
apps/android/      forked FlorisBoard (Kotlin) + Ripple panel IME. Target phone + TV (leanback).
apps/desktop/      Tauri (Rust+TS). Replaces helper scripts. Injects keystrokes at cursor.
apps/ios/          Swift keyboard ext + container app. BUILD LAST.
docs/              architecture.md · protocol.md · security.md  <-- contracts
prompts/           ordered build instructions. START at prompts/00-START-HERE.md
```

## Invariants (do not violate)

- `docs/protocol.md` is the contract. Change protocol => change that file first.
- Relay never sees plaintext. Text is sealed client-side (see docs/security.md).
- Relay routes by `room = hash(code)`, never the raw code.
- Symmetric: no message type grants "host" power. Control = per-device consent.
- `server/` stays put + stays working; Render deploys it (`render.yaml rootDir: server`).
- License: Apache-2.0; preserve `NOTICE` (FlorisBoard attribution) in android.

## Build order

1. `prompts/relay-upgrade.md`   — device types, peers, heartbeat, sealed frames
2. `prompts/web-app.md`         — adopt symmetric model + peer list + E2E
3. `prompts/android.md`         — fork FlorisBoard, Ripple panel, commit-at-cursor, signed APK
4. `prompts/desktop.md`         — Tauri client + OS keystroke injection
5. iOS — when human says go

## Stack per target

- relay: Node, `ws`. no DB. in-memory rooms, 12h idle evict.
- core: TypeScript, WebCrypto (AEAD), HKDF/PBKDF2.
- android: Kotlin, AndroidX, InputMethodService (FlorisBoard base), OkHttp WS.
- desktop: Rust (Tauri), enigo / XDG RemoteDesktop portal / SendInput / CGEvent.
- ios: Swift, UIInputViewController, RequestsOpenAccess=YES.

## Conventions

- One feature = one folder under its app. Shared logic => mirror `packages/core` semantics, don't re-derive the protocol.
- Every client: pairing screen + peer list + per-device "accept incoming" mode (auto/ask/off).
- Commit messages: imperative, scope-prefixed (`android:`, `relay:`, `core:`).
</content>
