#!/bin/bash
# Yap helper for Linux — run:  bash yap-linux.sh   (or chmod +x and double-click)
# Every message you send from the phone lands on your clipboard, so you can
# press Ctrl-V anywhere. Auto-paste works if xdotool is installed (optional).
SERVER="https://yap-mkk4.onrender.com"

# Pick a clipboard tool.
if command -v wl-copy >/dev/null 2>&1; then COPY() { wl-copy; }
elif command -v xclip >/dev/null 2>&1; then COPY() { xclip -selection clipboard; }
elif command -v xsel  >/dev/null 2>&1; then COPY() { xsel --clipboard --input; }
else echo "Install a clipboard tool first: xclip (X11) or wl-clipboard (Wayland)."; exit 1; fi

# Optional auto-paste.
PASTE=""
command -v xdotool >/dev/null 2>&1 && PASTE="yes"

printf "Enter the pairing code shown in the Yap phone app: "
read -r CODE
CODE=$(printf '%s' "$CODE" | tr '[:lower:]' '[:upper:]' | tr -cd 'A-Z0-9')
if [ ${#CODE} -lt 3 ]; then echo "That code looks too short. Try again."; exit 1; fi

echo ""
echo "Connected to code $CODE. Send from your phone — text is copied here instantly."
echo "Press Ctrl-V to paste. Leave this window open; Ctrl-C to stop."
echo ""

LAST=$(curl -fsS "$SERVER/poll/$CODE/0/text" 2>/dev/null | tail -1 | cut -f1)
[ -z "$LAST" ] && LAST=0

while true; do
  RESP=$(curl -fsS "$SERVER/poll/$CODE/$LAST/text" 2>/dev/null)
  if [ -n "$RESP" ]; then
    while IFS=$'\t' read -r ID B64; do
      [ -z "$ID" ] && continue
      printf '%s' "$B64" | base64 -d 2>/dev/null | COPY
      LAST=$ID
      [ -n "$PASTE" ] && xdotool key --clearmodifiers ctrl+v >/dev/null 2>&1
      echo "  copied #$ID  (Ctrl-V to paste)"
    done <<< "$RESP"
  fi
  sleep 1.5
done
