# ripple-core-kt — Kotlin crypto mirror

The **third** implementation of Ripple's end-to-end crypto, for the Android
keyboard/app. Byte-for-byte compatible with the JS (`packages/core/crypto.mjs`)
and Rust (`packages/core-rs`) cores, so an Android device interoperates with web
and desktop with no key exchange.

- `src/main/kotlin/com/ripple/core/Crypto.kt` — `RippleCrypto` object:
  `normalizeCode`, `roomFromCode`, `keyFromCode`, `seal`, `unseal`.
- `src/test/kotlin/.../CryptoTest.kt` — asserts the **same** cross-language
  vectors as the JS/Rust suites (see HANDOFF §3).

Pure JVM crypto (`javax.crypto` / `java.security`) — no Android-only APIs — so it
runs in plain unit tests and on-device alike.

## Test

```sh
gradle test            # standalone (needs Maven Central for the Kotlin plugin)
```

The vectors were also verified here with `kotlinc 2.1.0` directly (5/5), and the
identical JVM crypto operations pass under `javac`/`java` — so the math is proven
on the JVM. The final on-device check happens in the Android build/CI.

## Using it from the Android app

Either add this as a Gradle module dependency, or copy `Crypto.kt` into the app
module. `keyFromCode` returns a `javax.crypto.SecretKey`; pass it to `seal`/
`unseal`. **Never** change `KDF_SALT` (`yap.kdf.v1`) or the params — it would break
interop with every existing client and the test vectors.
