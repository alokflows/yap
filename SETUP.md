# Setting up Ripple

Three ways to use Ripple, from easiest to most hands-on. Pick the one that fits you.

---

## A. Just use it (zero setup)

1. Open **https://yap-mkk4.onrender.com** on two devices (e.g. your phone and
   your computer).
2. On one, tap **Create code**. On the other, **Join** with that code.
3. Type or talk on one — the words appear on the other. Done.

> Want the text to land *at your cursor* in any app on your computer? Grab the
> desktop helper from the **paste icon** in the app header. (The new **Ripple
> Desktop** app — see section C — will replace this and also fix Linux.)

---

## B. Self-host the relay (run your own pipe)

The relay is one small Node process — no database, no secrets, just a port. Host
it anywhere that supports WebSockets so your text never touches our server.

```bash
cd server
npm install
npm start            # → http://localhost:8080
```

**Point the apps at your relay** by setting the relay URL (the web app reads it
from its own origin; the native apps take it in their pairing screen).

One-click deploy to a free tier (Render):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/alokflows/ripple)

### Custom setup (your own accounts)

Everything Ripple uses is swappable and free-tier friendly:

| Piece | Default | Make it yours |
|-------|---------|---------------|
| **Relay host** | Render free tier | Any Node host: Fly.io, Railway, a VPS, your own box |
| **Keep-alive** | GitHub Action pings every ~12 min | Set repo variable `RENDER_URL` to your URL |
| **Domain** | `*.onrender.com` | Put any domain in front (HTTPS/WSS required) |

Nothing is locked to us. Fork it, host it, own it.

---

## C. Build the apps yourself (no app store, no fees)

You do **not** need a Play Store or App Store account. You build a signed file
and install it directly.

### Android phone / TV — signed APK

```bash
cd apps/android
./gradlew assembleRelease     # produces a signed app-release.apk
```

- First time, the build generates (or you provide) a **keystore** — keep it; it
  signs every future build so updates install cleanly.
- **Sideload to a TV:** put the APK on a USB stick or use a file-send app, then
  open it on the TV with "install unknown apps" enabled.

### Desktop (Windows / Mac / Linux) — Ripple Desktop

```bash
cd apps/desktop
npm install
npm run tauri build           # → .exe / .dmg / .AppImage
```

Run the file directly. On Linux, grant the one-time "remote control" permission
when asked — that's what lets it type at your cursor.

### iOS — kept possible, parked for now

iOS needs a Mac + Xcode to build, and even sideloading re-signs every 7 days
with a free Apple ID. The code path is reserved (`apps/ios/`) but built last.
See [docs/architecture.md](docs/architecture.md#ios).

---

## Where to go next

- **How it all works:** [docs/architecture.md](docs/architecture.md)
- **The message format:** [docs/protocol.md](docs/protocol.md)
- **Privacy & encryption:** [docs/security.md](docs/security.md)
</content>
