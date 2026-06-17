# Ripple Keyboard — Android (+ TV)

A standalone keyboard (forked from **FlorisBoard**, Apache-2.0) with a built-in
**Ripple panel**: pair, see history, and have spoken/typed text appear at the cursor
in any app. The same signed APK targets phones and Android TV (leanback). Ships
alongside a full container app.

**Build instructions:** [`/prompts/android.md`](../../prompts/android.md)
**Contract:** [`/docs/protocol.md`](../../docs/protocol.md) · [`/docs/security.md`](../../docs/security.md)

## Status

**In progress — the container app is scaffolded and building via CI.** What's here:

- Gradle project (`:app`, AGP 8.7 / Kotlin 2.1 / Compose, `minSdk 26`).
- `net/RippleClient.kt` — the single OkHttp WebSocket peer speaking the relay
  protocol (HANDOFF §4): seals/unseals AES-GCM blobs, routes on the room hash,
  optimistic send (never blocks the input path), id-correlated acks, backoff
  reconnect, terminal kicked/full/locked.
- `RippleViewModel` + Compose UI (`ui/`) — Connect + Chat screens in the
  warm-clay M3 theme. Full peer: send and receive encrypted text.
- Shared crypto: reuses `packages/core-kt` **by source** (`sourceSets` srcDir),
  so `RippleCrypto` can't drift from the JS/Rust mirrors or the cross-language
  vectors. `minSdk 26` is required by its `java.util.Base64` / PBKDF2 usage.
- Launcher + TV banner (placeholder clay bubble vectors — regenerate from the
  canonical `server/public/icon.svg` later).

### Still to build
- **The IME** (FlorisBoard fork) with the Ripple panel + commit-at-cursor — the
  headline feature. The networking/crypto layer above is shared with it.
- A **foreground Service** to own the single socket for IME + app.
- Compose **QR scan**, on-device dictation, Settings, keyboard setup wizard.
- TV D-pad polish.

## Build / verify

No Android SDK in the agent sandbox, so **CI is the source of truth**:
`.github/workflows/android-build.yml` assembles a debug APK on every push that
touches `apps/android/**` or `packages/core-kt/**` (artifact: `ripple-debug-apk`).

Locally (on a machine with the Android SDK + JDK 17):

```sh
cd apps/android
gradle :app:assembleDebug      # or ./gradlew once a wrapper is added
```

## Distribution (no Play Store)

`gradle assembleRelease` → signed APK → sideload to phone/TV. Keystore handling
(base64 in a GitHub secret + a release workflow) lands with the IME.
