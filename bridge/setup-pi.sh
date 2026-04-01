#!/bin/bash
# Campfire Bridge — Raspberry Pi 5 Setup Script
# Run once on a fresh Raspberry Pi OS Lite (64-bit) install.
# Usage: curl -sL https://raw.githubusercontent.com/icestationenterprise/campfire-bridge/main/bridge/setup-pi.sh | bash

set -e

GREEN='\033[0;32m'
NC='\033[0m'
step() { echo -e "\n${GREEN}▶ $1${NC}"; }

step "1/9  Updating system packages"
sudo apt update && sudo apt upgrade -y

step "2/9  Installing system dependencies"
sudo apt install -y \
  git curl \
  bluetooth bluez bluez-tools \
  pulseaudio pulseaudio-module-bluetooth \
  playerctl \
  shairport-sync

step "3/9  Installing Node.js 20"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

step "4/9  Installing librespot"
# raspotify packages librespot for ARM — we install it then disable their service
# since we manage the librespot process ourselves via the bridge.
curl -sL https://dtcooper.github.io/raspotify/install.sh | sh || true
sudo systemctl stop raspotify  2>/dev/null || true
sudo systemctl disable raspotify 2>/dev/null || true
# Verify the binary is in place
librespot --version || { echo "ERROR: librespot not found after install"; exit 1; }

step "5/9  Configuring Bluetooth"
# Always-on, always discoverable/pairable so speakers can connect
sudo tee /etc/bluetooth/main.conf > /dev/null << 'EOF'
[Policy]
AutoEnable=true

[General]
DiscoverableTimeout = 0
PairableTimeout = 0
EOF
sudo usermod -a -G bluetooth pi
sudo systemctl enable bluetooth
sudo systemctl restart bluetooth

step "6/9  Configuring PulseAudio for Bluetooth"
mkdir -p /home/pi/.config/pulse
# Load Bluetooth modules on top of the default PulseAudio config
tee /home/pi/.config/pulse/default.pa > /dev/null << 'EOF'
.include /etc/pulse/default.pa
load-module module-bluetooth-policy
load-module module-bluetooth-discover
EOF

# Configure shairport-sync to output through PulseAudio so it feeds
# into the party combined sink automatically when party mode is active.
sudo tee /etc/shairport-sync.conf > /dev/null << 'EOF'
general = {
  name = "Campfire";
  ignore_volume_control = "no";
};
pa = {
  // Output to PulseAudio default sink (becomes campfire_party in party mode)
};
EOF

step "7/9  Enabling lingering user session (PulseAudio starts at boot)"
# Without this, user systemd services don't start until someone logs in.
sudo loginctl enable-linger pi

step "8/9  Cloning repo and building bridge"
cd /home/pi
if [ -d "campfire-bridge/.git" ]; then
  echo "Repo already exists — pulling latest"
  cd campfire-bridge && git pull
else
  git clone https://github.com/icestationenterprise/campfire-bridge.git
  cd campfire-bridge
fi
cd bridge/api
npm install
npm run build

step "9/9  Installing campfire-bridge as a user systemd service"
# Running as a user service means it shares the pi user's PulseAudio session
# automatically — no need to pass socket paths manually.
mkdir -p /home/pi/.config/systemd/user
tee /home/pi/.config/systemd/user/campfire-bridge.service > /dev/null << 'EOF'
[Unit]
Description=Campfire Bridge API
After=network.target bluetooth.target pulseaudio.service

[Service]
Type=simple
WorkingDirectory=/home/pi/campfire-bridge/bridge/api
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable campfire-bridge
systemctl --user start campfire-bridge || true

echo ""
echo "================================================"
echo " Setup complete!"
echo ""
echo " Reboot now to start everything cleanly:"
echo "   sudo reboot"
echo ""
echo " After reboot, test from your Mac:"
echo "   curl http://campfire-bridge.local:3000/api/status"
echo "================================================"
