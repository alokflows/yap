# @ripple/core

The **reference implementation** of the Ripple protocol, in TypeScript. Shared by
the web app, the relay, and Ripple Desktop. Android (Kotlin) and iOS (Swift)
implement faithful mirrors of the same spec.

> The contract lives in [`/docs/protocol.md`](../../docs/protocol.md) and
> [`/docs/security.md`](../../docs/security.md). This package implements it; it
> does not redefine it.

## Will contain

- `room.ts` — derive `room = base64url(SHA-256(code))`.
- `crypto.ts` — KDF (Argon2id/PBKDF2) + AEAD seal/unseal (WebCrypto).
- `frames.ts` — build/parse `hello`, `msg`, `ack`, `peers`, `ping`/`pong`, etc.
- `history.ts` — local per-code history with quota-resilient storage.
- `index.ts` — public surface.

## Status

Placeholder. Implemented in build step 1–2 (see `/prompts`). No app logic yet.
</content>
