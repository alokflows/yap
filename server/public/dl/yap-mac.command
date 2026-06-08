#!/bin/bash
# Yap helper for macOS — double-click to run.
# Every message you send from the phone lands on your clipboard, so you can
# press Cmd-V anywhere with full confidence. It also auto-pastes into the
# front app if you grant Accessibility permission (optional).
SERVER="https://yap-mkk4.onrender.com"

printf "Enter the pairing code shown in the Yap phone app: "
read -r CODE
CODE=$(printf '%s' "$CODE" | tr '[:lower:]' '[:upper:]' | tr -cd 'A-Z0-9')
if [ ${#CODE} -lt 3 ]; then echo "That code looks too short. Try again."; exit 1; fi

echo ""
echo "Connected to code $CODE."
echo "Send from your phone — the text is copied here instantly. Press Cmd-V to paste."
echo "(Optional auto-paste: System Settings -> Privacy & Security -> Accessibility -> enable Terminal.)"
echo "Leave this window open. Press Ctrl-C to stop."
echo ""

# Baseline: skip anything already in the session so we only paste new sends.
LAST=$(curl -fsS "$SERVER/poll/$CODE/0/text" 2>/dev/null | tail -1 | cut -f1)
[ -z "$LAST" ] && LAST=0

while true; do
  RESP=$(curl -fsS "$SERVER/poll/$CODE/$LAST/text" 2>/dev/null)
  if [ -n "$RESP" ]; then
    while IFS=$'\t' read -r ID B64; do
      [ -z "$ID" ] && continue
      printf '%s' "$B64" | base64 -D 2>/dev/null | pbcopy
      LAST=$ID
      osascript -e 'tell application "System Events" to keystroke "v" using command down' >/dev/null 2>&1
      echo "  copied #$ID  (Cmd-V to paste)"
    done <<< "$RESP"
  fi
  sleep 1.5
done
