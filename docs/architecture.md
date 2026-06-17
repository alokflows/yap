# Ripple — Architecture

This is the textbook. If a software engineer asks "how does it work?", everything
they need is here.

---

## 1. The idea

Ripple moves **text** between your devices and drops it **at the cursor** — the
exact spot where you'd be typing. One device is your input (a keyboard, a mic);
another is where the words appear. Crucially, **every device is symmetric**:
each can both send and receive. There is no "host" and no one-way street.

## 2. The shape of the system

Three kinds of parts:

1. **Relay** — a tiny, stateless server. It is a *blind pipe*: it groups
   connections by room and forwards sealed (encrypted) messages between them. It
   cannot read what flows through it, and it stores nothing on disk.
2. **Clients (peers)** — the web app, the Ripple Keyboard (Android/TV/iOS), and Ripple
   Desktop. Each one connects to the relay, joins a room, and can send and
   receive text.
3. **The protocol** — the rules every client and the relay agree on. This is the
   *real* shared core (see §5).

```
   Peer A  ──WS──►  ┌────────────┐  ──WS──►  Peer B
   (web)            │   Relay    │           (keyboard)
   Peer C  ──WS──►  │ blind pipe │  ──WS──►  Peer D
   (desktop)        └────────────┘           (TV keyboard)
                 routes by room = hash(code)
                 forwards sealed frames only
```

## 3. The core flow

1. **Pair.** One device makes a short code; others enter it. The code names the
   room *and* seeds the encryption key (see [security.md](security.md)).
2. **Connect.** Each device opens a WebSocket to the relay and sends a `hello`
   announcing who it is (device type, name, OS, capabilities).
3. **Talk.** A device seals a text message and sends it. The relay fans it out to
   every other peer in the room.
4. **Receive.** Each peer unseals the text and — based on its own **consent
   setting** (auto / ask / off) — commits it at the cursor or shows it for
   approval.

## 4. Why "no host" matters

Earlier designs had a host device that granted permission. We dropped it. The
data path is a **two-way cable**: any peer can originate text, any peer can
receive it. Control is **local and per-device** — each device decides whether to
*accept* incoming text into its cursor. This is simpler, more honest, and means
a TV can type back just as easily as a phone.

## 5. The "core" is the protocol, not a shared binary

You cannot literally share one code file across Kotlin, Swift, Rust, and JS. So
the shared core is the **protocol specification** in
[protocol.md](protocol.md), plus **one reference implementation in TypeScript**
(`packages/core/`) used by the web app, the relay, and the desktop app. Android
and iOS implement faithful *mirrors* of the same spec in their native languages.

> Rule: the spec is king. To change behavior, change `protocol.md` first.

## 6. The pieces, concretely

| Part | Tech | Lives in | Notes |
|------|------|----------|-------|
| Relay | Node + `ws` | `server/` | Deployed on Render. In-memory rooms, 12h idle evict. **Never renamed** (Render points here). |
| Web app | One HTML file | `server/public/` | No build step. Mobile-first. |
| Core | TypeScript, WebCrypto | `packages/core/` | Framing, sealing, history, key derivation. |
| Ripple Keyboard | Kotlin, `InputMethodService` | `apps/android/` | Fork of FlorisBoard + a Ripple panel. Phone + TV. |
| Ripple Desktop | Rust + Tauri | `apps/desktop/` | Tray app; injects keystrokes at the OS cursor. |
| Ripple iOS | Swift, keyboard extension | `apps/ios/` | Built last; needs Full Access for network. |

## 7. The Ripple Keyboard (the flagship)

Forked from **FlorisBoard** (Apache-2.0, Kotlin) — a mature, private,
fully-featured keyboard. We keep its engine (layouts, theming, emoji, clipboard)
and add **one new surface**: the **Ripple panel**, reached from a key on the toolbar
row, exactly like its clipboard/emoji panels. The panel has:

- **Connect** — create or enter a code; shows live connection + peers.
- **Live** — incoming text; commits at the cursor (auto, or tap).
- **History** — past messages, tap to re-insert.

Because a keyboard (IME) is the one component Android *allows* to type into any
app, this is how "paste at the cursor" works on Android — and the same APK runs
on **Android TV** (leanback). The phone is the mic; the TV's keyboard receives.

## 8. Ripple Desktop (replacing the scripts)

One Tauri app for Windows/Mac/Linux. It joins as a normal peer and injects
keystrokes at the OS cursor:

- **Windows:** `SendInput()` — reliable, no extra permission.
- **macOS:** `CGEvent` — needs the one-time Accessibility permission.
- **Linux:** the **XDG RemoteDesktop portal** (Wayland's sanctioned input path)
  or `ydotool` on X11 — this is what the old shell script *couldn't* do cleanly,
  and why Linux paste was stuck at clipboard-only.

## 9. iOS {#ios}

Apple keyboards have **no network by default**. Setting `RequestsOpenAccess=YES`
("Full Access," which the user enables once) grants network + a shared container.
Keyboard extensions are memory-limited and can't reliably use the mic, so on iOS
the **container app** (or another paired device) is the sender, and the
**keyboard** is the receiver that commits text. Built last; the slot is reserved.

## 10. Security in one paragraph

The relay is blind: it routes by `hash(code)` and forwards only sealed frames.
Text is encrypted end-to-end with a key derived from the pairing code. Each
device controls whether incoming text reaches its cursor. Full threat model,
the honest limits of a short code, and the key-derivation details are in
[security.md](security.md).

## 11. Distribution

No app stores required. Android → self-signed release APK, sideloaded. Desktop →
plain `.exe`/`.dmg`/`.AppImage`. iOS → re-signed with a free Apple ID (later).
Publishing to stores is a future, optional step.
</content>
