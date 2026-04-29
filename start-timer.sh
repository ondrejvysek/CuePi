#!/bin/bash
# (No blocking loop)

# Disable screen blanking / screensaver
xset -dpms
xset s off
xset s noblank

# Start Openbox window manager in the background
openbox-session &

# Launch Chromium natively in X11 immediately to the loading page.
# Resolve loading page path with fallbacks so manual updates/relocations
# do not break kiosk startup.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOADING_HTML="$SCRIPT_DIR/loading.html"
if [ ! -f "$LOADING_HTML" ] && [ -f "$HOME/stage-timer/loading.html" ]; then
  LOADING_HTML="$HOME/stage-timer/loading.html"
fi
if [ ! -f "$LOADING_HTML" ] && [ -f "$HOME/CuePi/loading.html" ]; then
  LOADING_HTML="$HOME/CuePi/loading.html"
fi

if [ -f "$LOADING_HTML" ]; then
  exec chromium --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 "file://$LOADING_HTML"
fi

# Last-resort fallback if loading page is missing.
exec chromium --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 "http://localhost:3000/presenter.html"
