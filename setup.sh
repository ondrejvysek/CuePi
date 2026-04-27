#!/bin/bash
# CuePi - Automated Install Script
# Fetches the latest code from Git, configures X11, Boot Splash, and Autologin

echo "================================================="
echo "  CuePi - Automated Deployment"
echo "================================================="

# --- CONFIGURATION ---
REPO_URL="https://github.com/ondrejvysek/cuepi.git"
CURRENT_USER=$(whoami)
APP_DIR="$HOME/stage-timer"
AP_CONNECTION_NAME="CuePi_Fallback"
LEGACY_AP_CONNECTION_NAME="StageTimer_Fallback"
AP_SSID="CuePi_AP"
SYSTEMD_SERVICE_NAME="cuepi"
LEGACY_SYSTEMD_SERVICE_NAME="stage-timer"

echo -e "\n[1/7] Updating system and installing dependencies..."
sudo apt update
sudo apt install -y git nodejs npm chromium xserver-xorg x11-xserver-utils xinit openbox network-manager fonts-dejavu fonts-liberation fonts-roboto plymouth plymouth-themes imagemagick

echo -e "\n[2/7] Configuring Auto-Fallback Wi-Fi Hotspot..."
if sudo nmcli -t -f NAME connection show | grep -Fxq "$LEGACY_AP_CONNECTION_NAME"; then
    echo "Migrating legacy AP connection ($LEGACY_AP_CONNECTION_NAME -> $AP_CONNECTION_NAME)..."
    sudo nmcli connection modify "$LEGACY_AP_CONNECTION_NAME" connection.id "$AP_CONNECTION_NAME" || true
fi
if ! sudo nmcli -t -f NAME connection show | grep -Fxq "$AP_CONNECTION_NAME"; then
    sudo nmcli connection add type wifi ifname wlan0 con-name "$AP_CONNECTION_NAME" autoconnect yes ssid "$AP_SSID"
fi
sudo nmcli connection modify "$AP_CONNECTION_NAME" 802-11-wireless.ssid "$AP_SSID"
sudo nmcli connection modify "$AP_CONNECTION_NAME" 802-11-wireless.mode ap 802-11-wireless.band bg ipv4.method shared
sudo nmcli connection modify "$AP_CONNECTION_NAME" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "stageadmin"
sudo nmcli connection modify "$AP_CONNECTION_NAME" connection.autoconnect-priority -10
sudo nmcli connection delete "$LEGACY_AP_CONNECTION_NAME" 2>/dev/null || true

echo -e "\n[3/7] Automating OS Autologin..."
# Enable Console Autologin (Boot option B2)
sudo raspi-config nonint do_boot_behaviour B2

echo -e "\n[4/7] Setting up user permissions..."
sudo usermod -a -G video,render,input,tty $CURRENT_USER

echo -e "\n[5/7] Downloading latest code from Git..."
if [ -d "$APP_DIR" ]; then
    sudo rm -rf "$APP_DIR"
fi
git clone "$REPO_URL" "$APP_DIR"
cd "$APP_DIR"

echo -e "\n[6/7] Installing Node App Dependencies..."
npm install
chmod +x "$APP_DIR/start-timer.sh"

echo -e "\n[7/7] Setting up Plymouth Boot Splash & Node Service..."
# Create a seamless boot splash
THEME_DIR="/usr/share/plymouth/themes/cuepi"
sudo mkdir -p "$THEME_DIR"
sudo tee "$THEME_DIR/cuepi.plymouth" > /dev/null << EOF
[Plymouth Theme]
Name=CuePi
Description=CuePi Custom Splash
ModuleName=script

[script]
ImageDir=$THEME_DIR
ScriptFile=$THEME_DIR/cuepi.script
EOF

sudo tee "$THEME_DIR/cuepi.script" > /dev/null << 'EOF'
Window.SetBackgroundTopColor(0.0, 0.0, 0.0);
Window.SetBackgroundBottomColor(0.0, 0.0, 0.0);

logo.image = Image("splash.png");
logo.sprite = Sprite(logo.image);
logo.sprite.SetX(Window.GetWidth() / 2 - logo.image.GetWidth() / 2);
logo.sprite.SetY(Window.GetHeight() / 2 - logo.image.GetHeight() / 2);
EOF

# Copy the custom splash logo from the CuePi asset path.
if [ -f "$APP_DIR/assets/CuePi-splash.png" ]; then
    sudo cp "$APP_DIR/assets/CuePi-splash.png" "$THEME_DIR/splash.png"
    echo "CuePi splash screen logo applied from assets/CuePi-splash.png."
elif [ -f "$APP_DIR/splash.png" ]; then
    sudo cp "$APP_DIR/splash.png" "$THEME_DIR/splash.png"
    echo "Legacy splash.png detected and applied for backwards compatibility."
else
    # Fallback to black if no image is found
    echo "No CuePi splash image found in repository. Creating empty fallback."
    sudo convert -size 800x600 xc:black "$THEME_DIR/splash.png"
fi

sudo plymouth-set-default-theme -R cuepi

# Hide Linux boot text - Bulletproof cmdline.txt handling
CMDLINE_FILES=("/boot/firmware/cmdline.txt" "/boot/cmdline.txt")
for CMDLINE in "${CMDLINE_FILES[@]}"; do
    if [ -f "$CMDLINE" ]; then
        echo "Hiding boot text in $CMDLINE..."
        sudo cp "$CMDLINE" "${CMDLINE}.bak"
        
        CMD_CONTENT=$(cat "$CMDLINE")
        
        # Safely strip existing console/splash commands so we don't duplicate them
        CMD_CONTENT=$(echo "$CMD_CONTENT" | sed 's/ console=serial0,115200//g; s/ console=tty1//g; s/ console=serial0//g; s/ console=tty3//g; s/ quiet//g; s/ splash//g; s/ plymouth.ignore-serial-consoles//g; s/ vt.global_cursor_default=0//g; s/ vt.cur_default=0//g; s/ logo.nologo//g')
        
        # Append the exact required string on a single line
        CMD_CONTENT="$CMD_CONTENT console=tty3 quiet splash plymouth.ignore-serial-consoles vt.global_cursor_default=0 vt.cur_default=0 logo.nologo"
        
        sudo bash -c "echo \"$CMD_CONTENT\" > \"$CMDLINE\""
    fi
done

# Create the Node.js Server Service
sudo tee /etc/systemd/system/${SYSTEMD_SERVICE_NAME}.service > /dev/null << EOF
[Unit]
Description=CuePi Node Server
After=network.target

[Service]
ExecStart=$(which node) $APP_DIR/server.js
WorkingDirectory=$APP_DIR
StandardOutput=inherit
StandardError=inherit
Restart=always
User=$CURRENT_USER

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
if [ -f "/etc/systemd/system/${LEGACY_SYSTEMD_SERVICE_NAME}.service" ]; then
    sudo systemctl disable "$LEGACY_SYSTEMD_SERVICE_NAME" 2>/dev/null || true
fi
sudo ln -sf "/etc/systemd/system/${SYSTEMD_SERVICE_NAME}.service" "/etc/systemd/system/${LEGACY_SYSTEMD_SERVICE_NAME}.service"
sudo systemctl enable "$SYSTEMD_SERVICE_NAME"
sudo systemctl restart "$SYSTEMD_SERVICE_NAME"

# Bind the Kiosk launch to the physical HDMI console autologin using X11
echo '[[ -z $DISPLAY && $XDG_VTNR -eq 1 ]] && exec startx "'$APP_DIR'/start-timer.sh" -- -nocursor' > "$HOME/.bash_profile"

echo "================================================="
echo "  Setup Complete! "
echo "  Moderator UI: http://$(hostname -I | awk '{print $1}'):3000/"
echo "================================================="
echo "Please reboot the Raspberry Pi to apply all changes."
