# Ripple Protocol (v1)

The contract every client and the relay obey. **Change this file before changing
behavior.** All messages are JSON over a WebSocket to the relay at `/ws`.

---

## Roles

- **Relay**: blind router. Groups connections by `room`, forwards messages to the
  other peers in the same room, tracks presence. Never decrypts. Never persists
  to disk.
- **Peer**: any client (web, keyboard, desktop, ios). Symmetric — every peer may
  send and receive.

## Identifiers

- `code` — the human pairing code (e.g. `K7QF9P`). Never sent to the relay raw.
- `room` — `base64url(SHA-256(code))`. What the relay routes on.
- `did` — stable, random per-install device id (opaque). Lets a device rejoin.
- `id` — per-connection id assigned by the relay.

## Handshake

**Peer → Relay** (first frame):
```json
{
  "type": "hello",
  "proto": 1,
  "room": "<hash(code)>",
  "did": "<device id>",
  "name": "Alok's Pixel",
  "os": "Android",
  "deviceType": "keyboard",      // web | keyboard | desktop | ios | agent
  "caps": { "send": true, "receive": true, "cursor": true }
}
```

**Relay → Peer**:
```json
{ "type": "welcome", "id": "<conn id>", "room": "<room>", "peers": [ /* PeerInfo */ ] }
```

**Relay → all peers** on any join/leave/change:
```json
{ "type": "peers", "peers": [ { "id","did","name","os","deviceType","caps" } ] }
```

`deviceType` lets every client *label* the others ("Keyboard", "Computer", "TV").
`caps.cursor=true` means "this device can type into its OS cursor" — used purely
for display and for the receiver's own consent UI. It grants no special power.

## Sending text

**Peer → Relay**:
```json
{
  "type": "msg",
  "id": "<client msg id>",
  "t": 1718533200000,
  "enc": "xchacha20poly1305",
  "nonce": "<base64url>",
  "ciphertext": "<base64url>"
}
```

The relay forwards the frame **verbatim** to every other peer in the room and
replies to the sender:
```json
{ "type": "ack", "id": "<client msg id>", "delivered": 2 }   // peer count it reached
```

## Receiving text

A peer that gets a `msg`:
1. Unseals it (see [security.md](security.md)). On failure → ignore + surface a
   quiet "couldn't decrypt" (wrong code).
2. Applies its **consent mode**:
   - `auto` → commit at cursor immediately.
   - `ask` → show the text with Accept/Dismiss.
   - `off` → store in history only.

## Presence / liveness

- Heartbeat: peer sends `{ "type":"ping" }` every ~20s; relay replies `{"type":"pong"}`.
- Missing 2 beats → relay drops the connection and broadcasts updated `peers`.
- This is how every device shows an honest live "connected" dot for the others.

## Room control (symmetric)

Any peer may set a room **lock** (no new devices may join):
```json
{ "type": "setLock", "locked": true }
```
Relay enforces it for *new* `hello`s (existing `did`s may still reconnect) and
broadcasts the state. No peer outranks another; the lock is a shared switch.

## History sync

On join, the relay sends recent in-memory messages:
```json
{ "type": "history", "messages": [ { "id","t","enc","nonce","ciphertext" } ] }
```
Sealed too — the relay is just replaying frames it can't read. Clients keep their
own local, per-code history.

## Errors

```json
{ "type": "error", "code": "locked|badRoom|tooBig|rateLimited", "message": "…" }
```

## Compatibility

`proto` is an integer. The relay accepts known versions and refuses unknown ones
with `error/badProto`. Bump it only for breaking changes.
</content>
