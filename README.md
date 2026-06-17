<div align="center">

# 🗣️ Ripple

**Talk or type on one device → the words land at the cursor on another.**
Phone → computer. Phone → TV. Computer → phone. Any device, both directions.

No accounts. No API keys. Share a code, that's it.

[**▶ Open the app**](https://yap-mkk4.onrender.com) · [Set it up](SETUP.md) · [How it's built](docs/architecture.md)

</div>

---

## What it is (in one breath)

Your devices share a short **pairing code**. Anything you type or say on one
shows up — **right at the text cursor** — on the others. It's a data cable made
of Wi-Fi: text flows **both ways**, between phones, computers, and TVs.

```
 ┌─────────┐                 ┌─────────┐                 ┌─────────┐
 │ Phone   │ ◄────────────►  │  Relay  │  ◄────────────► │  TV /   │
 │ keyboard│   encrypted     │ (blind  │    encrypted    │ computer│
 │ + mic   │   text          │  pipe)  │    text         │ keyboard│
 └─────────┘                 └─────────┘                 └─────────┘
        every device can send AND receive — no "host"
```

## What works today

- **Web app** — open the link on any device, pair, send/receive text.
- **Desktop paste-at-cursor** — a tiny helper types sent text straight into the
  app you're in (Windows/Mac solid; Linux is moving to the new desktop app).

## What we're building

- **Ripple Keyboard** (Android + TV, then iOS) — a full standalone keyboard with a
  built-in Ripple panel: pair, see history, and have spoken/typed text appear at
  your cursor in *any* app. Forked from the open-source FlorisBoard.
- **Ripple Desktop** — one small Tauri app replacing the helper scripts (and fixing
  Linux paste).
- **End-to-end encryption** — the relay only ever sees scrambled text.

## The three docs

| File | Read it if you're… |
|------|--------------------|
| **[SETUP.md](SETUP.md)** | a person who wants to use it or self-host it |
| **[docs/architecture.md](docs/architecture.md)** | curious how the whole thing works (the textbook) |
| **[AGENTS.md](AGENTS.md)** | an AI coding agent building this repo |

## Layout

```
server/     the live relay + web app (deployed on Render)
packages/   shared protocol "core" (TypeScript reference)
apps/       android · desktop · ios  (the new clients)
docs/       architecture · protocol · security
prompts/    build instructions an AI agent executes
```

## License

[Apache-2.0](LICENSE). Ripple Keyboard builds on
[FlorisBoard](https://github.com/florisboard/florisboard) (also Apache-2.0) —
see [NOTICE](NOTICE).
</content>
