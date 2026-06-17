# 00 — START HERE (master prompt)

> Paste-and-go prompt for a CLI coding agent (e.g. Claude Code) on the builder's
> machine. The human will say: *"Go to this repo, read prompts/00-START-HERE.md,
> and do exactly what it says."*

## Your mission

Build Ripple into a multi-platform, end-to-end-encrypted, **symmetric** text-relay
system whose defining trick is dropping text **at the cursor** on any device.

## Read first (in this order, do not skip)

1. `docs/architecture.md` — the whole system.
2. `docs/protocol.md` — the contract you must implement exactly.
3. `docs/security.md` — the encryption + consent model you must honor.
4. `AGENTS.md` — repo map + invariants.

## Hard rules

- **Do not rename or break `server/`.** Render deploys it (`render.yaml rootDir:
  server`). You may extend it; never relocate it.
- **The relay never sees plaintext.** Implement sealing client-side per
  `docs/security.md`.
- **No host.** Every client is a symmetric peer. Control is per-device consent.
- **Protocol first.** If you must change behavior, edit `docs/protocol.md` in the
  same change.
- Preserve `NOTICE` (FlorisBoard attribution) in the Android app.
- Keep commits small and scope-prefixed (`relay:`, `core:`, `android:`,
  `desktop:`). Don't push to `master` without the human's go-ahead.

## Step 0 — bootstrap (do once, first)

- Replace `LICENSE` with the canonical Apache-2.0 text from
  https://www.apache.org/licenses/LICENSE-2.0.txt (it's a placeholder pointer now,
  to keep the repo text-filter clean). Keep `NOTICE` as-is.
- When you vendor FlorisBoard into `apps/android/`, pull its `LICENSE`/`NOTICE`
  and retain all upstream copyright headers in copied files.

## Build in this order

| Step | Prompt | Outcome |
|------|--------|---------|
| 1 | `prompts/relay-upgrade.md` | relay speaks protocol v1 (peers, heartbeat, lock, sealed frames) |
| 2 | `prompts/web-app.md` | web app uses the symmetric model + peer list + E2E |
| 3 | `prompts/android.md` | Ripple Keyboard (FlorisBoard fork) → signed APK, paste at cursor |
| 4 | `prompts/desktop.md` | Ripple Desktop (Tauri) → injects keystrokes, fixes Linux |
| 5 | (await human) | iOS |

Finish each step — build + smoke-test — before starting the next. After each,
summarize what changed and how the human can verify it on a real device.
</content>
