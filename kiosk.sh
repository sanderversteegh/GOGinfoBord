#!/usr/bin/env bash
# Start Chromium schermvullend op het infobord. Wordt automatisch gestart bij inloggen op de desktop.
URL="${INFOBORD_URL:-http://localhost:8080/}"

# wachten tot de server draait
for i in $(seq 1 60); do
  curl -fs -o /dev/null "$URL" && break
  sleep 2
done

BROWSER="$(command -v chromium || command -v chromium-browser)"
# na een harde stroomonderbreking geen "herstellen?"-balk tonen
PREFS="$HOME/.config/chromium/Default/Preferences"
[ -f "$PREFS" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"Crashed"/"exit_type":"Normal"/' "$PREFS"

exec "$BROWSER" \
  --kiosk "$URL" \
  --noerrdialogs --disable-infobars --no-first-run \
  --disable-session-crashed-bubble --disable-features=Translate \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --password-store=basic
