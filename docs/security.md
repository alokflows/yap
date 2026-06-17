# Ripple — Security & Privacy Model (as built)

Written to be honest, including where the limits are. Privacy is the product.
**This file matches the running code** — see `packages/core/crypto.mjs` (JS),
`packages/core-rs` (Rust), `packages/core-kt` (Kotlin), all asserting the same
vectors.

---

## What we protect against

- **A passive network eavesdropper** (sniffing Wi-Fi / the link).
- **A curious or compromised relay** that sees all traffic it routes.
- **An uninvited device** trying to join your room.

## How

### 1. The relay is blind
- Clients route by `room = base64url(SHA-256(normalizeCode(code)))`. The relay
  never receives the raw pairing code — only the hash.
- Every text frame is **sealed** (encrypted) before it leaves the device. The
  relay forwards opaque bytes and stores them only **in memory** (recent messages
  per code, evicted after 12h idle). Nothing is written to disk. Logs record the
  room **hash**, never the code or plaintext.

### 2. End-to-end encryption (exact, as implemented)
- **Cipher:** AES-256-GCM. Each message uses a **fresh random 12-byte IV**. The
  sealed blob is `base64url(iv(12) || ciphertext || 16-byte tag)`.
- **Key derivation:** `key = PBKDF2-HMAC-SHA256(password = normalizeCode(code),
  salt = "yap.kdf.v1", iterations = 210000, length = 256 bits)`. The salt is fixed
  app-wide (the code is the only secret and both sides must derive the same key
  with no exchange); the cost to an attacker is the iteration count.
- Because both the room id and the key come from the code, two devices that share
  the code agree on key + room with **zero key exchange**, and the relay learns
  neither the code nor the key.
- ⚠ **Honest note:** this is PBKDF2-210k, **not** Argon2id, and the salt is fixed
  (so common codes are theoretically rainbow-tableable across users). See limits.

### 3. Room control & host
- The pairing **code is the access token** — use a non-obvious / long one.
- The first device (by `did`) is the **host**; it can **lock** the room (only
  already-known `did`s may rejoin), **kick** a device, **hand host** to another, or
  **destroy** the code. If the host leaves, host is reassigned to the oldest
  remaining device. Everyone in a room already shares the code, so host powers
  grant no access to anything secret — they're administration, not privilege over
  the encryption.
- Each receiving device decides locally whether to **type at the cursor** and/or
  **auto-copy** (per-device toggles). A backlog replayed as `history` is never
  auto-typed.

### 4. Abuse resistance (relay, in-memory, no DB)
- Per-IP **rate limits** on `/ws` connections and `/poll`, a **global connection
  ceiling**, a WebSocket **`maxPayload`**, and a **per-room device cap** (16). These
  blunt connection floods, oversized-frame DoS, and online code-guessing.

## The honest limit: short codes

A 6-character code is convenient but low-entropy (~30 bits). End-to-end encryption
stops a *passive* eavesdropper completely. But a **malicious relay** could try to
brute-force a short code offline against captured ciphertext, and PBKDF2-210k is
far cheaper to attack than Argon2id. Mitigations, in order of strength:

1. **Longer codes / passphrase** (or QR-carried codes) — entropy is the real
   defense; the UI should nudge toward this.
2. **Relay rate-limiting** (implemented) blunts online guessing/enumeration.
3. **Roadmap, in priority:** fold the room hash into the KDF salt (kills
   cross-user rainbow tables cheaply); move PBKDF2 → **Argon2id**; ultimately an
   authenticated PAKE (e.g. SPAKE2) so even a short code yields a strong session
   key with no offline-guessing weakness.

We document this rather than hide it: with a default short code Ripple is private
against the network and casual snooping; for adversary-grade privacy use a long
passphrase (and, once shipped, the PAKE handshake).

## Known residual exposures (honest)

- **Presence leakage:** anyone who guesses a room **hash** can see member counts /
  device labels for that room (the relay can't verify code knowledge — that's the
  cost of a blind relay). Rate-limiting is the practical mitigation; long codes are
  the real one.
- **Legacy `/poll` + `/dl`** routes use the **raw code** in the URL (the old
  plaintext helper protocol). The web UI hides them; consider removing the routes.

## Data at rest

- **Relay:** nothing on disk, ever (in-memory only).
- **Clients:** history is **local, per code**. Today the **web** keeps it in plain
  `localStorage` (not encrypted at rest); the **desktop** keeps it in the app's
  config dir. The **Android** app should store history with
  EncryptedSharedPreferences / Jetpack Security. Clearing the app clears it.

## Trust boundaries (summary)

| Actor | Can see | Cannot see |
|-------|---------|-----------|
| Network sniffer | that traffic exists, sizes | any text (sealed) |
| Relay | room hashes, peer presence, ciphertext | the code, the key, any plaintext |
| Uninvited device | nothing (no code) | the room (wrong code → wrong room/key) |
| Your own devices | plaintext (they're the endpoints) | — |
