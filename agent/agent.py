#!/usr/bin/env python3
"""Ripple desktop agent.

Connects to the Ripple relay with a pairing code, then pastes any text
the phone sends at the current cursor position. This is the piece that makes
"speak on phone -> appears where my cursor is" actually happen.

Two delivery modes:
  paste  (default) : copy text to the clipboard, then send Cmd/Ctrl+V.
                     Fast and Unicode-safe; works in almost every app.
  type             : simulate keystrokes character by character.
                     Use this in apps that block programmatic paste.

Usage:
  python agent.py --server wss://your-relay.example.com --room ABCD
  python agent.py --server ws://localhost:8080 --room ABCD --mode type

Setup:
  pip install -r requirements.txt

Platform notes:
  macOS  : grant Accessibility permission to your terminal/Python under
           System Settings -> Privacy & Security -> Accessibility.
  Linux  : X11 works out of the box; on Wayland, keystroke injection is
           restricted (use the type mode or an X11 session).
"""

import argparse
import json
import os
import platform
import sys
import threading
import time

try:
    import websocket  # websocket-client
except ImportError:
    sys.exit("Missing dependency. Run: pip install -r requirements.txt")

try:
    import pyperclip
    from pynput.keyboard import Controller, Key
except ImportError:
    sys.exit("Missing dependency. Run: pip install -r requirements.txt")


IS_MAC = platform.system() == "Darwin"
PASTE_MODIFIER = Key.cmd if IS_MAC else Key.ctrl
_keyboard = Controller()

# Small delay so the clipboard write settles before the paste keystroke.
CLIPBOARD_SETTLE_S = 0.04
RECONNECT_DELAY_S = 2.0


def deliver(text: str, mode: str) -> None:
    """Insert `text` at the current cursor location."""
    if not text:
        return

    if mode == "type":
        _keyboard.type(text)
        return

    # paste mode: stash existing clipboard, paste ours, then restore.
    previous = None
    try:
        previous = pyperclip.paste()
    except Exception:
        previous = None

    try:
        pyperclip.copy(text)
    except Exception as exc:
        print(f"[agent] clipboard write failed ({exc}); falling back to typing")
        _keyboard.type(text)
        return

    time.sleep(CLIPBOARD_SETTLE_S)
    with _keyboard.pressed(PASTE_MODIFIER):
        _keyboard.press("v")
        _keyboard.release("v")

    # Restore the user's previous clipboard shortly after, best-effort.
    if previous is not None:
        def _restore():
            time.sleep(0.3)
            try:
                pyperclip.copy(previous)
            except Exception:
                pass
        threading.Thread(target=_restore, daemon=True).start()


def normalize_ws_url(server: str, room: str) -> str:
    """Build the full relay URL from a base server address and room code."""
    server = server.rstrip("/")
    # Accept http(s):// for convenience and convert to ws(s)://.
    if server.startswith("http://"):
        server = "ws://" + server[len("http://"):]
    elif server.startswith("https://"):
        server = "wss://" + server[len("https://"):]
    elif not server.startswith(("ws://", "wss://")):
        server = "ws://" + server

    if not server.endswith("/ws"):
        server = server + "/ws"
    return f"{server}?role=desktop&room={room}"


def run(server: str, room: str, mode: str) -> None:
    url = normalize_ws_url(server, room)
    print(f"[agent] room={room} mode={mode}")
    print(f"[agent] connecting to {url}")

    def on_open(ws):
        print(f"[agent] connected. Ready — open the phone app and enter code: {room}")

    def on_message(ws, raw):
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return
        mtype = msg.get("type")
        if mtype == "text":
            text = msg.get("text", "")
            preview = text if len(text) <= 60 else text[:57] + "..."
            print(f"[agent] paste ({len(text)} chars): {preview!r}")
            deliver(text, msg.get("mode") or mode)
        elif mtype == "presence":
            phones = msg.get("phones", 0)
            print(f"[agent] phones connected: {phones}")
        elif mtype == "joined":
            pass
        elif mtype == "error":
            print(f"[agent] relay error: {msg.get('message')}")

    def on_error(ws, err):
        print(f"[agent] socket error: {err}")

    def on_close(ws, code, reason):
        print(f"[agent] disconnected ({code} {reason or ''})")

    # Reconnect loop. run_forever handles ping/pong keepalive.
    while True:
        ws = websocket.WebSocketApp(
            url,
            on_open=on_open,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close,
        )
        try:
            ws.run_forever(ping_interval=25, ping_timeout=10)
        except KeyboardInterrupt:
            print("\n[agent] bye")
            return
        print(f"[agent] reconnecting in {RECONNECT_DELAY_S:.0f}s…")
        time.sleep(RECONNECT_DELAY_S)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ripple desktop agent")
    parser.add_argument(
        "--server",
        default=os.environ.get("YAP_SERVER", "wss://yap-mkk4.onrender.com"),
        help="Relay address (default: wss://yap-mkk4.onrender.com). Use ws://localhost:8080 for local dev.",
    )
    parser.add_argument(
        "--room",
        default=os.environ.get("RIPPLE_ROOM"),
        help="Pairing code shared with the phone (3-12 letters/numbers).",
    )
    parser.add_argument(
        "--mode",
        choices=["paste", "type"],
        default=os.environ.get("RIPPLE_MODE", "paste"),
        help="How to insert text at the cursor (default: paste).",
    )
    args = parser.parse_args()

    room = (args.room or "").strip().upper()
    if not room:
        room = input("Pairing code (3-12 letters/numbers): ").strip().upper()
    if not room.isalnum() or not (3 <= len(room) <= 12):
        sys.exit("Invalid pairing code. Use 3-12 letters/numbers.")

    try:
        run(args.server, room, args.mode)
    except KeyboardInterrupt:
        print("\n[agent] bye")


if __name__ == "__main__":
    main()
