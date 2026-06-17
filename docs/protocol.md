# Ripple Protocol (v1) — as built

The contract every client and the relay obey. **This file matches the running
code** (`server/server.js` + the web/desktop clients). Change it when you change
behavior. All frames are JSON over a WebSocket to the relay at `/ws`.

---

## Roles

- **Relay**: blind router. Groups connections by `room`, forwards sealed frames to
  the other peers in the same room, tracks presence, keeps a small in-memory
  per-code session (recent messages + lock + host). Never decrypts. Never writes
  to disk.
- **Peer**: any client (web, desktop, keyboard, TV, ios). Symmetric — every peer
  both sends and receives. One peer is the **host** (see below).

## Identifiers

- `code` — the human pairing code (e.g. `K7QF9P`). **Never sent to the relay raw.**
- `room` — `base64url(SHA-256(normalizeCode(code)))`. What the relay routes on.
- `did` — stable, random per-install device id. Lets a device rejoin / be host.
- `id` — per-connection id assigned by the relay (used by `kick`/`setHost`).

## Connecting (no hello frame — it's in the URL)

A peer opens:

```
wss://yap-mkk4.onrender.com/ws?role=<phone|desktop>&room=<room hash>&did=<device id>
```

`role` is just a label (`phone` is the default; the web app and keyboard use
`phone`, the desktop uses `desktop`). The relay reads the device name/OS from the
`User-Agent`. The relay then replies:

```json
{ "type": "joined", "role": "...", "room": "<room>", "id": "<conn id>",
  "did": "<did>", "members": [ /* see presence */ ],
  "phones": 1, "desktops": 0, "open": true, "hostDid": "<did>" }
```

and, if the code has history, a `history` frame (below). On any join/leave/change
the relay broadcasts `presence` to everyone:

```json
{ "type": "presence", "members": [
    { "id": "...", "role": "phone", "isHost": true, "name": "Pixel 7", "os": "Android" }
  ], "phones": 1, "desktops": 1, "open": true, "hostDid": "<did>" }
```

`members` is for display (label each device, show the host + a live dot). It
carries no secret — no `did`s are exposed in presence.

## Sending text

**Peer → Relay:**

```json
{ "type": "text", "text": "<sealed blob>", "cid": "<client msg id, optional>" }
```

`text` is the **sealed** blob from `seal()` — `base64url(iv(12) || AES-256-GCM
ciphertext+tag)` (see [security.md](security.md)). The relay stores it (so later
joiners get history) and forwards it **verbatim** to every other peer:

```json
{ "type": "text", "id": "<server msg id>", "text": "<sealed blob>", "t": 1718533200000 }
```

and acks the sender, echoing `cid` so the sender pairs the ack to the exact
message it sent (not by FIFO order):

```json
{ "type": "ack", "id": "<server msg id>", "t": 1718533200000, "delivered": 2, "cid": "<cid>" }
```

`delivered` = how many *other* peers it reached right now.

## Receiving text

A peer that gets a `text`:
1. Unseals it. On failure (wrong code / tamper) → **don't render**; surface a calm
   "make sure both devices use the same code" once (not per message).
2. If it types at the cursor (desktop/keyboard), applies its local setting
   (type-at-cursor on/off, auto-copy). These are per-device toggles, not a
   protocol field.

## History sync

On join the relay replays recent in-memory messages (sealed — it can't read them):

```json
{ "type": "history", "messages": [ { "id": ..., "text": "<sealed>", "t": ... } ] }
```

Clients also keep their own local per-code history. Never auto-type a replayed
backlog at the cursor.

## Host & room control

The **host** is the first device (by `did`) to join. If the host disconnects and
devices remain, the relay **reassigns** host to the oldest remaining device, so a
room is never left un-administrable. Host-only frames (ignored from non-hosts):

```json
{ "type": "setOpen", "open": false }   // lock: only already-known dids may join
{ "type": "kick",    "id": "<conn id>" } // remove a device; it gets {type:"kicked"}
{ "type": "setHost", "id": "<conn id>" } // hand host to another device
{ "type": "destroy" }                    // wipe the code; everyone gets {type:"destroyed"}
{ "type": "clear" }                      // wipe shared history; others get {type:"cleared"}
```

Codes are **shared/symmetric**: anyone with the code joins the same room. There is
no "wrong password" and no "code taken" — an unknown code just opens an empty room.

## Errors

```json
{ "type": "error", "code": "locked|full|busy", "message": "…" }
```
- `locked` — room is locked and this `did` isn't known. (terminal: don't retry)
- `full`   — room hit `MAX_ROOM_MEMBERS` (16). (terminal)
- `busy`   — relay shedding load (global cap / per-IP rate limit). (transient)
- no code  — `Invalid room.`, `Text too long.`, `Malformed message (expected JSON).`

## Liveness & limits

- The relay sends WebSocket **ping** frames every ~30s and drops sockets that miss
  a beat, then broadcasts updated `presence`.
- Limits (in-memory, no DB): `MAX_TEXT_LENGTH` 2,000,000 (ciphertext bytes),
  `MAX_ROOM_MEMBERS` 16, `MAX_SESSION_MESSAGES` 500/code, `MAX_SESSIONS` 5000,
  12h idle eviction, per-IP rate limits on `/ws` and `/poll`, a global connection
  ceiling, and a WS `maxPayload`.

## Legacy `/poll` (disabled in the UI)

`GET /poll/<room>/<afterId>[?wait=<sec>]` long-polls the same sealed messages for
the old dependency-free helper scripts. The web app hides the helpers; treat
`/poll` as legacy. It honors the room lock and the same rate limit.
