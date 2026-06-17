# Ripple — Security & Privacy Model

Written to be honest, including where the limits are. Privacy is the product.

---

## What we protect against

- **A passive network eavesdropper** (someone sniffing Wi-Fi / the link).
- **A curious or compromised relay** that can see all traffic it routes.
- **An uninvited device** trying to join your room.
- **Silent paste** — text reaching your cursor without your awareness.

## How

### 1. The relay is blind
- Clients route by `room = base64url(SHA-256(code))`. The relay never receives
  the raw pairing code.
- Every text frame is **sealed** (encrypted) before it leaves the device. The
  relay forwards opaque bytes. It stores nothing on disk; rooms live in memory
  and are evicted after 12h idle.

### 2. End-to-end encryption
- **Cipher:** an AEAD (XChaCha20-Poly1305, or AES-256-GCM via WebCrypto where
  XChaCha isn't available). Each message uses a fresh random nonce.
- **Key derivation:** `key = HKDF(secret = code, salt = "yap/v1", info = room)`.
  The code is stretched with a deliberately expensive KDF (PBKDF2 high-iteration
  or Argon2id) to slow brute force.
- Because both the room id and the key come from the code, two devices that share
  the code agree on the key with **zero key exchange** and the relay learns
  neither the code nor the key.

### 3. Per-device consent (replaces "host")
- There is no privileged device. Each device decides how it treats *incoming*
  text: **auto** (commit at cursor), **ask** (Accept/Dismiss), or **off**
  (history only). Default for cursor-typing devices (keyboard/desktop): **ask**
  on first contact, then remember per peer.
- Every device shows the live **peer list** with each peer's type ("Keyboard",
  "Computer", "TV") and a connected indicator, plus one-tap **Remove/Block**.

### 4. Joining control
- The pairing **code is the access token** — use a non-obvious one.
- Any peer can **lock** the room (no new devices). Already-known devices (by
  `did`) may still reconnect after a drop.

## The honest limit: short codes

A 6-character code is convenient but low-entropy (~30 bits). End-to-end
encryption stops a *passive* eavesdropper completely. But a **malicious relay**
could try to brute-force a short code offline against captured ciphertext.
Mitigations, in order of strength:

1. **Expensive KDF** (Argon2id) makes each guess costly.
2. **Longer codes / passphrase** option for sensitive use — entropy is the real
   defense; the UI nudges toward this.
3. **Rate limiting** on the relay blunts online guessing.
4. **Roadmap:** an authenticated key exchange (e.g. SPAKE2/PAKE) so even a short
   code yields a strong session key with no offline-guessing weakness. This is
   the proper end state.

We document this rather than hide it: with the default short code Ripple is private
against the network and casual snooping; for adversary-grade privacy, use a long
passphrase (and, once shipped, the PAKE handshake).

## Data at rest

- Relay: **nothing on disk**, ever.
- Clients: history is **local only**, stored per code, encrypted-at-rest where
  the platform offers it (Android Keystore / iOS Keychain-wrapped). Clearing the
  app clears it.

## Trust boundaries (summary)

| Actor | Can see | Cannot see |
|-------|---------|-----------|
| Network sniffer | that traffic exists, sizes | any text (sealed) |
| Relay | room hashes, peer presence, ciphertext | the code, the key, any plaintext |
| Uninvited device | nothing (no code) | the room (wrong code → wrong room/key) |
| Your own devices | plaintext (they're the endpoints) | — |
</content>
