# 03 — Ripple Keyboard (Android + TV)

Goal: a standalone keyboard that pairs with Ripple and commits received text **at
the cursor in any app**. Built by forking FlorisBoard.

## Do

1. **Fork base:** vendor FlorisBoard (Apache-2.0, Kotlin) into `apps/android/`.
   Keep its IME engine, layouts, theming, emoji, clipboard. Preserve `NOTICE`.
2. **Ripple panel:** add a toolbar key that opens a Ripple panel (same pattern as the
   clipboard/emoji panels) with three tabs:
   - **Connect** — create/enter code; show connection + peer list.
   - **Live** — incoming text; commit at cursor via
     `currentInputConnection.commitText(text, 1)`. Respect consent mode.
   - **History** — local per-code history; tap to insert.
3. **Networking:** OkHttp WebSocket client implementing protocol v1; seal/unseal
   per `docs/security.md`. Heartbeat. Reconnect with backoff.
4. **Symmetric:** the keyboard can also **send** (type/dictate → send to peers),
   so it's a full peer, not a receiver-only.
5. **Themes:** ship Light, Dark, and true-black **Night/OLED**, matching the web
   app's warm-clay accent.
6. **TV:** add leanback launcher + a D-pad-friendly Connect screen. Same APK.
7. **Signing:** Gradle `assembleRelease` with a generated keystore →
   sideloadable signed APK. Document the keystore handling in `apps/android/README.md`.

## Don't

- Don't require a Play Store account. Don't store history unencrypted. Don't add
  a host role.

## Verify

- Set Ripple Keyboard as input method; pair with the web app; speak on the phone →
  text lands at the cursor in a notes app and on a TV search box. Peer list shows
  the keyboard as `deviceType: keyboard`.
</content>
