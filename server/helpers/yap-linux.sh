#!/bin/bash
# Yap helper for Linux — run:  bash yap-linux.sh
# Every message you send from the phone lands on your clipboard AND is pasted at
# your cursor, so it feels like magic — just like the Windows helper.
#
# It needs two tiny tools: a clipboard tool and a "type a keystroke" tool.
# This script auto-detects your desktop (Wayland or X11) and, if anything is
# missing, prints the exact one-line command to install it. Nothing is hidden
# and nothing runs without you seeing it.
SERVER="https://yap-mkk4.onrender.com"

# --- figure out the package-install command for this distro (for nice hints) --
installer() {
  if   command -v apt-get >/dev/null 2>&1; then echo "sudo apt install -y";
  elif command -v dnf     >/dev/null 2>&1; then echo "sudo dnf install -y";
  elif command -v pacman  >/dev/null 2>&1; then echo "sudo pacman -S --noconfirm";
  elif command -v zypper  >/dev/null 2>&1; then echo "sudo zypper install -y";
  else echo ""; fi
}
PKG="$(installer)"
hint() { # hint <package-name>
  if [ -n "$PKG" ]; then echo "    $PKG $1"; else echo "    (install '$1' with your package manager)"; fi
}

# --- are we on Wayland or X11? --------------------------------------------------
# Wayland and X11 need completely different "paste" tools. xdotool ONLY works on
# X11 — on Wayland it makes the cursor twitch but never actually pastes, which is
# the classic "it copies but won't paste" problem.
IS_WAYLAND=""
if [ -n "$WAYLAND_DISPLAY" ] || [ "$XDG_SESSION_TYPE" = "wayland" ]; then IS_WAYLAND="yes"; fi

# --- pick a clipboard tool ------------------------------------------------------
COPY=""
if   command -v wl-copy >/dev/null 2>&1; then COPY() { wl-copy; }
elif command -v xclip   >/dev/null 2>&1; then COPY() { xclip -selection clipboard; }
elif command -v xsel    >/dev/null 2>&1; then COPY() { xsel --clipboard --input; }
else
  echo "Yap needs a clipboard tool. Install one:"
  if [ -n "$IS_WAYLAND" ]; then hint "wl-clipboard"; else hint "xclip"; fi
  exit 1
fi

# --- pick a paste (keystroke) tool ----------------------------------------------
# PASTE() must send a Ctrl-V to whatever window is focused.
HAVE_PASTE=""
PASTE_HINT=""
PASTE_TOOL=""
PASTE() { :; }   # default no-op; replaced below if a tool is available
if [ -n "$IS_WAYLAND" ]; then
  # Use "-k v" (the named V key), NOT positional "v". Positional text makes wtype
  # temporarily remap a keycode to emit that character; with Ctrl held the
  # compositor then sees Ctrl+<random keycode>, which pastes nothing and can type
  # garbage digits. "-k v" presses the real V key, so Ctrl+V actually pastes.
  if   command -v wtype   >/dev/null 2>&1; then PASTE() { wtype -M ctrl -k v -m ctrl; }; HAVE_PASTE="yes"; PASTE_TOOL="wtype";
  elif command -v ydotool >/dev/null 2>&1; then PASTE() { ydotool key 29:1 47:1 47:0 29:0; }; HAVE_PASTE="yes"; PASTE_TOOL="ydotool";  # ctrl+v
  else PASTE_HINT="wtype"; fi
else
  if   command -v xdotool >/dev/null 2>&1; then PASTE() { xdotool key --clearmodifiers ctrl+v; }; HAVE_PASTE="yes"; PASTE_TOOL="xdotool";
  else PASTE_HINT="xdotool"; fi
fi

# --- the pairing code (baked into the download; asked once if missing) ----------
# Codes are 3-12 characters. We cap at 12 to match the server: a longer string
# forms an invalid /poll URL, which used to make the server hand back its own
# web page (you'd see CSS scroll past as "copied ..."). Capping prevents that.
sanitize_code() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr -cd 'A-Z0-9'; }

CODE=$(sanitize_code "__CODE__")
if [ ${#CODE} -lt 3 ]; then
  printf "Enter the pairing code shown in the Yap phone app: "
  read -r RAW
  CODE=$(sanitize_code "$RAW")
fi
if [ ${#CODE} -gt 12 ]; then
  echo "Note: codes are at most 12 characters — using the first 12 (\"${CODE:0:12}\")."
  CODE=${CODE:0:12}
fi
if [ ${#CODE} -lt 3 ]; then echo "That code looks too short. Try again."; exit 1; fi

echo ""
echo "Connected to code $CODE. Send from your phone."
if [ -n "$HAVE_PASTE" ]; then
  echo "Auto-paste is ON via $PASTE_TOOL — text drops straight at your cursor. Click where you want it."
else
  echo "Text is copied here instantly — press Ctrl-V to paste."
  if [ -n "$PASTE_HINT" ]; then
    echo "Want hands-free auto-paste? Install:"
    hint "$PASTE_HINT"
    [ -n "$IS_WAYLAND" ] && echo "    (GNOME-on-Wayland may also need 'ydotool' + its daemon; see ydotoold --help)"
  fi
fi
echo "Leave this window open; Ctrl-C to stop."
echo ""

# Stable device id, so the host's room lock can recognise this helper: when the
# host turns "Allow others" off, helpers seen while the room was open keep
# working and unknown ones are refused. Stored once, reused every run.
DID_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/yap/did"
DID=$(cat "$DID_FILE" 2>/dev/null | tr -cd 'A-Za-z0-9_-' | cut -c1-40)
if [ -z "$DID" ]; then
  DID=$( (cat /proc/sys/kernel/random/uuid 2>/dev/null) || date +%s%N )
  DID=$(printf '%s' "$DID" | tr -cd 'A-Za-z0-9_-' | cut -c1-40)
  mkdir -p "$(dirname "$DID_FILE")" 2>/dev/null && printf '%s' "$DID" > "$DID_FILE" 2>/dev/null
fi

# Baseline high-water mark so we never replay old messages. Retry until the
# probe truly succeeds: a failed probe must NOT fall back to 0, or the next poll
# dumps the whole backlog — old messages flooding/pasting at once with their ids
# scrolling by (the "numbers on repeat"). A genuinely empty room returns 0.
LAST=""
tries=0
until [ -n "$LAST" ]; do
  if BASE=$(curl -fsS "$SERVER/poll/$CODE/0/text?did=$DID" 2>/dev/null); then
    LAST=$(printf '%s' "$BASE" | tail -1 | cut -f1)
    [ -z "$LAST" ] && LAST=0
  else
    tries=$((tries + 1))
    [ "$tries" = 3 ] && echo "  (waiting for the server…)"
    sleep 0.5
  fi
done

# Long-poll: the server returns the instant a message arrives, so latency is the
# network round-trip, not a poll interval. The short sleep only throttles
# reconnects if the server is unreachable.
while true; do
  RESP=$(curl -fsS --max-time 35 "$SERVER/poll/$CODE/$LAST/text?wait=30&did=$DID" 2>/dev/null)
  if [ -n "$RESP" ]; then
    while IFS=$'\t' read -r ID B64; do
      [ -z "$ID" ] && continue
      printf '%s' "$B64" | base64 -d 2>/dev/null | COPY
      LAST=$ID
      # COPY returns only after the clipboard tool owns the selection, so the
      # text is already in place — paste immediately, no added latency.
      PASTE >/dev/null 2>&1 # Ctrl-V into the focused window (no-op if unavailable)
      echo "  delivered #$ID"
    done <<< "$RESP"
  fi
  sleep 0.2
done
