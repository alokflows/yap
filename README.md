<div align="center">

# 🗣️ Yap

**Speak or type on your phone → the text lands on your computer, right where your cursor is.**

No app to install. No accounts. No API keys. Just open a web page and a pairing code.

[**▶ Open the app**](https://yap-mkk4.onrender.com) · [How it works](#how-it-works) · [Paste at your cursor](#paste-straight-to-your-cursor) · [Self-host](#self-host-the-relay)

</div>

---

It's the Wispr-Flow idea split across two devices: your **phone** is the microphone and keyboard, your **computer** is where the words appear.

```
 ┌──────────┐     text over WebSocket      ┌──────────┐                ┌──────────┐
 │  Phone   │ ───────────────────────────► │  Relay   │ ─────────────► │ Computer │
 │ web app  │        (pairing code)        │  (Node)  │   clipboard +  │  helper  │
 └──────────┘                              └──────────┘   ⌘/Ctrl-V     └──────────┘
   type or                                 hosts the page              syncs clipboard
   dictate                                 + relays text               + auto-pastes
```

## How it works

1. **Open [yap-mkk4.onrender.com](https://yap-mkk4.onrender.com)** on your phone — and on your computer in a second tab.
2. Tap **New** to generate a pairing code, and enter the **same code** on both — or hit **Invite** to share a link that pairs the other device automatically.
3. On the phone's **Send** tab, type or dictate, then hit **Send**.
4. On the computer, the text shows up in the **Receive** tab (copy it), or — better — pastes straight at your cursor (see below).

Everything also lands in a **History** tab on both devices, and survives refreshes and dropped connections.

## Paste straight to your cursor

A browser is sandboxed — it physically can't type into Word, VS Code, or any other app. So Yap ships a **tiny helper** that does.

> In the app, open the **Receive** tab → **Set up** → download the helper for your OS. It auto-highlights your platform.

The helper is **zero-install** (pure built-in tools — `curl` + your system clipboard, no Python, no dependencies):

| OS | Download | Auto-paste |
|----|----------|------------|
| **macOS** | `yap-mac.command` — double-click to run | needs one-time Accessibility permission |
| **Windows** | `yap-windows.bat` — runs **invisibly** with a system-tray icon (right-click → Quit) | works out of the box |
| **Linux** | `yap-linux.sh` (`bash yap-linux.sh`) | needs `xdotool` (optional) |

Run it once with your pairing code. From then on, **every message you send is instantly on that computer's clipboard** — so you can blindly press **⌘/Ctrl-V** anywhere with full confidence. Where the OS allows, it also auto-pastes into the active window.

## Dictation

- **iPhone:** use your keyboard's 🎤 — it's on-device, free, and excellent. (Apple doesn't expose the in-app mic to websites, so this is the best path on iOS.)
- **Android:** the in-app 🎤 button works — tap to start, tap to stop, edit, then Send.
- **Anywhere:** the text box always works.

## Self-host the relay

The relay is a single stateless Node process — no database, no env vars (just `PORT` if you want to override). Deploy it to anything that supports WebSockets:

```bash
cd server
npm install
npm start        # http://localhost:8080
```

One-click deploy to Render's free tier:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/alokflows/yap)

A GitHub Action (`.github/workflows/keepalive.yml`) pings the deployment every ~12 minutes so the free tier never sleeps. Set the repo variable `RENDER_URL` to your URL after deploying.

## Repository layout

| Path | What it is |
|------|------------|
| `server/server.js` | Relay: serves the web app, relays text over `/ws`, exposes `/poll` for the helpers |
| `server/public/index.html` | The entire phone/computer web app (one file, no build step) |
| `server/public/dl/` | The zero-install desktop helpers (macOS / Windows / Linux) |
| `agent/agent.py` | Optional advanced Python agent (clipboard-paste / keystroke modes) |

## Rooms & access

- Anyone with the code can join — so the first device becomes the **host** and gets an **Allow others** toggle.
- Turn it off to **lock the room** to the devices already in it: your own phone/computer can still drop and reconnect (each device keeps a private local id), but **new/unknown devices are refused from the web app**.
- Everyone sees the small **member list** of who's connected. The lock lives on the session, so it survives brief disconnects.
- Scope today: the lock gates **web-app joiners** (the common "someone opened my link" case). The desktop **helper/agent** receive via the lightweight `/poll` path, which isn't gated yet — treat those as a trusted tool you run on your own machine. Extending the lock to that path ships with the approve/deny work below.

## Security notes

- The **pairing code is the access control** — use a non-obvious one, and lock the room once your devices are in.
- The relay **never writes to disk**; rooms and history live in memory only and are evicted after 12h idle.
- Always run the relay behind **HTTPS/WSS** (Render does this for you).

## Install it like an app

Yap is a **PWA** — open it and choose *Add to Home Screen* (iOS) or *Install* (Android/Chrome/Edge) to get a standalone app with its own icon and an offline shell.

## Roadmap

- QR code that opens the phone app pre-paired
- Per-device **approve / deny** prompts for the host, and extending the room lock to the desktop helper/`poll` path (on top of today's web-app lock)
- Optional end-to-end encryption of relayed text

---

<div align="center">
<sub>Built to be portable: open a link, share a code, paste anywhere.</sub>
</div>
