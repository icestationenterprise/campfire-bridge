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
  bluetooth bluez bluez-tools iw \
  pulseaudio pulseaudio-module-bluetooth \
  shairport-sync

step "3/9  Installing Node.js 20"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

step "4/9  Configuring Bluetooth"
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

# Disable the Pi's built-in BT adapter — all speaker output goes through
# USB dongles only. Must reboot to take effect.
if ! grep -q "dtoverlay=disable-bt" /boot/firmware/config.txt 2>/dev/null; then
  echo "dtoverlay=disable-bt" | sudo tee -a /boot/firmware/config.txt
fi
sudo systemctl disable hciuart 2>/dev/null || true

step "5/9  Configuring PulseAudio for Bluetooth"
mkdir -p /home/pi/.config/pulse
# Load Bluetooth modules on top of the default PulseAudio config
tee /home/pi/.config/pulse/default.pa > /dev/null << 'EOF'
.include /etc/pulse/default.pa
load-module module-bluetooth-policy
load-module module-bluetooth-discover
EOF

step "6/9  Enabling lingering user session (PulseAudio starts at boot)"
# Without this, user systemd services don't start until someone logs in.
sudo loginctl enable-linger pi

step "7/9  Cloning repo and building bridge"
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

# shairport-sync outputs to PulseAudio's default sink, which the bridge API
# points at campfire_party while party mode is active.
sudo cp /home/pi/campfire-bridge/bridge/config/shairport-sync.conf /etc/shairport-sync.conf

step "8/9  Installing campfire-bridge as a user systemd service"
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

step "9/10  Configuring networking (WiFi power save off, camping mode)"

# The Pi's brcmfmac WiFi drops frames while power-saving. On a device whose
# whole job is to receive a real-time audio stream that shows up as AirPlay
# stutter and the app periodically losing the bridge. Disable it everywhere.
sudo tee /etc/NetworkManager/conf.d/campfire-wifi-powersave.conf > /dev/null << 'EOF'
[connection]
# 2 = disable
wifi.powersave = 2
EOF

# Install NetworkManager hotspot profile
sudo cp /home/pi/campfire-bridge/bridge/config/campfire-hotspot.nmconnection \
        /etc/NetworkManager/system-connections/campfire-hotspot.nmconnection
sudo chmod 600 /etc/NetworkManager/system-connections/campfire-hotspot.nmconnection
sudo chown root:root /etc/NetworkManager/system-connections/campfire-hotspot.nmconnection
sudo nmcli con reload

# Install camping-mode daemon and the Bluetooth channel-steering helper it calls
sudo cp /home/pi/campfire-bridge/bridge/scripts/camping-mode.sh \
        /usr/local/bin/campfire-camping-mode.sh
sudo cp /home/pi/campfire-bridge/bridge/scripts/bt-afh.sh \
        /usr/local/bin/campfire-bt-afh.sh
sudo chmod +x /usr/local/bin/campfire-camping-mode.sh /usr/local/bin/campfire-bt-afh.sh

# Install and enable camping-mode systemd service (runs as root/system)
sudo cp /home/pi/campfire-bridge/bridge/systemd/camping-mode.service \
        /etc/systemd/system/campfire-camping-mode.service
sudo systemctl daemon-reload
sudo systemctl enable campfire-camping-mode.service
sudo systemctl start campfire-camping-mode.service || true

step "10/10  Trimming boot time (E7)"

# Measured 2026-10-13 on the Pi 5: 15.8 s cold boot, bridge API answering at
# 12.2 s. ~7.3 s of that is units this appliance has no use for, and the cost
# grows on a slower board with slower storage — which is exactly what E7 is
# meant to constrain. Each of these is safe on this device:
#
#   NetworkManager-wait-online  5.99 s  Blocks multi-user.target until the
#                                       network is up. Nothing here needs that:
#                                       camping-mode.sh polls link state itself
#                                       and the API binds regardless.
#   cloud-init                  0.70 s  Cloud provisioning. Not an appliance concern.
#   ModemManager                0.47 s  There is no cellular modem in this product.
sudo systemctl disable --now NetworkManager-wait-online.service 2>/dev/null || true
sudo touch /etc/cloud/cloud-init.disabled 2>/dev/null || true
sudo systemctl disable --now ModemManager.service 2>/dev/null || true

# tailscaled (0.69 s) is DELIBERATELY left running. Tailscale is out of the
# product architecture, but on a dev rig it is still a way back in when mDNS
# fails across WiFi bands (PLAN.md Known Issue #6). Remove it from the
# production image, not from the bench:
#   sudo systemctl disable --now tailscaled.service

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
