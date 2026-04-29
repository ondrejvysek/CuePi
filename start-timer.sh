#!/bin/bash
# (No blocking loop)

# Disable screen blanking / screensaver
xset -dpms
xset s off
xset s noblank

# Start Openbox window manager in the background
openbox-session &

# Launch Chromium natively in X11 immediately to the loading page.
# Resolve loading page path relative to this script location so it works
# even if the repository is not installed in $HOME/stage-timer.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec chromium --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 "file://$SCRIPT_DIR/loading.html"
