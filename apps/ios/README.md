# Ripple Keyboard — iOS

Reserved. iOS support is planned but **built last**.

## Why later

- Requires a Mac + Xcode to build (Swift / SwiftUI).
- A keyboard extension has **no network** unless the user enables **Full Access**
  (`RequestsOpenAccess = YES`), and is memory-limited and can't reliably use the
  mic — so the **container app** (or another paired device) sends, and the
  **keyboard** receives + commits text.
- Even sideloading needs a re-sign every 7 days with a free Apple ID.

See [`/docs/architecture.md#ios`](../../docs/architecture.md#ios). No store
account is assumed.

## Status

Placeholder only. No code until the human gives the go-ahead.
</content>
