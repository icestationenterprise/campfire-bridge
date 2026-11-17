#!/bin/bash
# Campfire Bridge — Raspberry Pi setup script (Pi 4B / CM4 / Pi 5)
#
# Run on a fresh Raspberry Pi OS Lite (64-bit) install, as user pi:
#   sudo apt update && sudo apt install -y git
#   git clone -b lightest-certifiable-campfire https://github.com/icestationenterprise/campfire-bridge.git /home/pi/campfire-bridge
#   bash /home/pi/campfire-bridge/bridge/setup-pi.sh
#   sudo reboot
#
# Safe to re-run: every step checks before it changes anything.
# Everything below was first done by hand on the Pi 4B bench unit (2026-11-08
# to 11-16) and then folded in here so a fresh card comes up working.

set -e

BRANCH="${CAMPFIRE_BRANCH:-lightest-certifiable-campfire}"
REPO=/home/pi/campfire-bridge
CONFIG=/boot/firmware/config.txt
# Pinned on purpose. shairport-sync master renamed --with-pa/--with-systemd, and
# nqptp 1.2.9 speaks shared-memory version 11 while shairport-sync 4.3.7 speaks
# 10 — the mismatch is a fatal "emergency exit" at startup.
SHAIRPORT_TAG=4.3.7
NQPTP_TAG=1.2.6

GREEN='\033[0;32m'
NC='\033[0m'
step() { echo -e "\n${GREEN}▶ $1${NC}"; }

ensure_config_line() {   # ensure_config_line "dtoverlay=foo"
  grep -qxF "$1" "$CONFIG" 2>/dev/null || echo "$1" | sudo tee -a "$CONFIG" > /dev/null
}

step "1/12  Updating system packages"
sudo apt update && sudo apt upgrade -y

step "2/12  Installing system dependencies"
sudo apt install -y \
  git curl rfkill \
  bluetooth bluez bluez-tools iw \
  pulseaudio pulseaudio-module-bluetooth \
  avahi-daemon \
  python3-gpiozero i2c-tools
# lgpio gives gpiozero PWM for the pulsing LED; the daemon copes without it.
sudo apt install -y python3-lgpio 2>/dev/null || echo "python3-lgpio not available — LED will blink instead of pulse"
# The apt shairport-sync cannot do AirPlay 2 with the nqptp we build; use source.
if dpkg -s shairport-sync > /dev/null 2>&1; then
  sudo apt remove -y shairport-sync
fi

step "3/12  Installing Node.js 20"
if ! node --version 2>/dev/null | grep -q '^v20'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

step "4/12  Configuring Bluetooth"
# Always-on, always discoverable/pairable so speakers can connect
sudo tee /etc/bluetooth/main.conf > /dev/null << 'EOF'
[Policy]
AutoEnable=true

[General]
DiscoverableTimeout = 0
PairableTimeout = 0
EOF
sudo usermod -a -G bluetooth pi
# A fresh image soft-blocks Bluetooth; AutoEnable only works after bluetoothd
# has re-read main.conf, so unblock, then restart.
sudo rfkill unblock bluetooth || true
# The bridge API (user pi) powers every radio itself over D-Bus, including
# dongles plugged in after boot — a DOWN radio is invisible to the one-speaker-
# per-radio balancer. If the kernel has a radio rfkill-blocked only root can
# lift that, so allow pi exactly that one command and nothing else.
echo 'pi ALL=(root) NOPASSWD: /usr/sbin/rfkill unblock bluetooth' | sudo tee /etc/sudoers.d/campfire-rfkill > /dev/null
sudo chmod 0440 /etc/sudoers.d/campfire-rfkill
sudo visudo -cf /etc/sudoers.d/campfire-rfkill > /dev/null \
  || { echo "campfire-rfkill sudoers drop-in failed validation — removing it"; sudo rm -f /etc/sudoers.d/campfire-rfkill; }
sudo systemctl enable bluetooth
sudo systemctl restart bluetooth

# Disable the Pi's built-in BT adapter — all speaker output goes through the
# USB radios only. Takes effect at the next reboot.
ensure_config_line "dtoverlay=disable-bt"
sudo systemctl disable hciuart 2>/dev/null || true

step "5/12  Configuring PulseAudio for Bluetooth"
mkdir -p /home/pi/.config/pulse
tee /home/pi/.config/pulse/default.pa > /dev/null << 'EOF'
.include /etc/pulse/default.pa
load-module module-bluetooth-policy
load-module module-bluetooth-discover
EOF

step "6/12  Enabling lingering user session (PulseAudio starts at boot)"
sudo loginctl enable-linger pi

step "7/12  Fetching the repo (branch: $BRANCH) and building the bridge"
if [ -d "$REPO/.git" ]; then
  git -C "$REPO" fetch -q origin
  git -C "$REPO" checkout -q "$BRANCH"
  git -C "$REPO" pull -q --ff-only origin "$BRANCH" || true
else
  git clone -b "$BRANCH" https://github.com/icestationenterprise/campfire-bridge.git "$REPO"
fi
cd "$REPO/bridge/api"
npm install
npm run build

step "8/12  Building AirPlay 2 (nqptp $NQPTP_TAG + shairport-sync $SHAIRPORT_TAG from source)"
if /usr/local/bin/shairport-sync -V 2>/dev/null | grep -q "^${SHAIRPORT_TAG}-AirPlay2"; then
  echo "shairport-sync $SHAIRPORT_TAG with AirPlay 2 already installed"
else
  sudo apt install -y --no-install-recommends \
    build-essential autoconf automake libtool libpopt-dev libconfig-dev \
    libasound2-dev libpulse-dev libavahi-client-dev libssl-dev libsoxr-dev \
    libplist-dev libplist-utils libsodium-dev libavutil-dev libavcodec-dev \
    libavformat-dev uuid-dev libgcrypt-dev xxd
  mkdir -p /home/pi/src
  rm -rf /home/pi/src/nqptp /home/pi/src/shairport-sync

  git clone -q --branch "$NQPTP_TAG" --depth 1 https://github.com/mikebrady/nqptp.git /home/pi/src/nqptp
  cd /home/pi/src/nqptp
  autoreconf -fi && ./configure --with-systemd-startup && make
  sudo make install
  sudo systemctl enable --now nqptp

  git clone -q --branch "$SHAIRPORT_TAG" --depth 1 https://github.com/mikebrady/shairport-sync.git /home/pi/src/shairport-sync
  cd /home/pi/src/shairport-sync
  autoreconf -fi && ./configure --sysconfdir=/etc --with-pa --with-avahi \
    --with-ssl=openssl --with-soxr --with-airplay-2 --with-systemd && make -j4
  sudo make install
  cd /home/pi
fi
# Output goes to PulseAudio's default sink, which the bridge API points at
# campfire_party while party mode is active.
sudo cp "$REPO/bridge/config/shairport-sync.conf" /etc/shairport-sync.conf
# The bridge starts/stops AirPlay as a *user* service (systemctl --user), so it
# shares the pi user's PulseAudio. The source build's system unit stays disabled.
sudo systemctl disable --now shairport-sync.service 2>/dev/null || true
mkdir -p /home/pi/.config/systemd/user
tee /home/pi/.config/systemd/user/shairport-sync.service > /dev/null << 'EOF'
[Unit]
Description=Shairport Sync (AirPlay 2) for Campfire
After=pulseaudio.service

[Service]
Environment=PULSE_SERVER=unix:/run/user/1000/pulse/native
ExecStart=/usr/local/bin/shairport-sync
Restart=on-failure

[Install]
WantedBy=default.target
EOF

step "9/12  Installing campfire-bridge as a user systemd service"
# The built-in speaker's PulseAudio sink is found at startup by its ALSA card
# name (BUILTIN_CARD_NAME, default MAX98357A); set BUILTIN_SINK_NAME here only
# to override that.
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
systemctl --user restart campfire-bridge || true

step "10/12  Hardware overlays (I²S amp, I²C gauge, power button)"
ensure_config_line "dtparam=i2s=on"
ensure_config_line "dtoverlay=max98357a"     # built-in amp → ALSA card "MAX98357A"
ensure_config_line "dtparam=i2c_arm=on"      # UPS HAT fuel gauge
# The dtparam enables the controller; /dev/i2c-1 only appears once the i2c-dev
# module is loaded (raspi-config does this by adding it to /etc/modules).
echo i2c-dev | sudo tee /etc/modules-load.d/campfire-i2c.conf > /dev/null
sudo modprobe i2c-dev 2>/dev/null || true
# Power button on GPIO3 (header pin 5) to GND: a press while running asks
# systemd-logind for a clean shutdown; a press while halted wakes the Pi
# (GPIO3 is the only pin the firmware watches for that).
# GPIO3 is also I²C1 SCL and the kernel hands it to I²C first (dmesg on the
# bench: "pin gpio3 already requested by fe804000.i2c"), so the overlay must
# watch another pin: GPIO5 (header pin 29). Wire the button to pins 5 AND 29 —
# GPIO3 still wakes a halted Pi (firmware), GPIO5 shuts a running one down.
sudo sed -i '/^dtoverlay=gpio-shutdown$/d' "$CONFIG"
ensure_config_line "dtoverlay=gpio-shutdown,gpio_pin=5"

step "11/12  Networking (WiFi power save off, camping mode) and the front panel"
# The brcmfmac WiFi drops frames while power-saving — AirPlay stutter.
sudo tee /etc/NetworkManager/conf.d/campfire-wifi-powersave.conf > /dev/null << 'EOF'
[connection]
# 2 = disable
wifi.powersave = 2
EOF

sudo cp "$REPO/bridge/config/campfire-hotspot.nmconnection" \
        /etc/NetworkManager/system-connections/campfire-hotspot.nmconnection
sudo chmod 600 /etc/NetworkManager/system-connections/campfire-hotspot.nmconnection
sudo chown root:root /etc/NetworkManager/system-connections/campfire-hotspot.nmconnection
sudo nmcli con reload

sudo cp "$REPO/bridge/scripts/camping-mode.sh" /usr/local/bin/campfire-camping-mode.sh
sudo cp "$REPO/bridge/scripts/bt-afh.sh"       /usr/local/bin/campfire-bt-afh.sh
sudo cp "$REPO/bridge/scripts/campfire-panel.py" /usr/local/bin/campfire-panel.py
sudo chmod +x /usr/local/bin/campfire-camping-mode.sh /usr/local/bin/campfire-bt-afh.sh /usr/local/bin/campfire-panel.py

sudo cp "$REPO/bridge/systemd/camping-mode.service"   /etc/systemd/system/campfire-camping-mode.service
sudo cp "$REPO/bridge/systemd/campfire-panel.service" /etc/systemd/system/campfire-panel.service
sudo systemctl daemon-reload
sudo systemctl enable campfire-camping-mode.service campfire-panel.service
sudo systemctl restart campfire-camping-mode.service || true
sudo systemctl restart campfire-panel.service || true

step "12/12  Trimming boot time (E7)"
# Measured 2026-10-13 on the Pi 5: 15.8 s cold boot, bridge API answering at
# 12.2 s. ~7.3 s of that is units this appliance has no use for:
#   NetworkManager-wait-online  5.99 s  camping-mode.sh polls link state itself
#   cloud-init                  0.70 s  not an appliance concern
#   ModemManager                0.47 s  no cellular modem in this product
sudo systemctl disable --now NetworkManager-wait-online.service 2>/dev/null || true
sudo touch /etc/cloud/cloud-init.disabled 2>/dev/null || true
sudo systemctl disable --now ModemManager.service 2>/dev/null || true
# tailscaled is deliberately left alone on a dev rig (a way back in when mDNS
# fails across WiFi bands). Remove it from the production image only.

echo ""
echo "================================================"
echo " Setup complete. Reboot now:"
echo "   sudo reboot"
echo ""
echo " After reboot (from your Mac):"
echo "   curl http://campfire-bridge.local:3000/api/status"
echo " The LED pulses blue while booting, then turns white on home WiFi."
echo " The iPhone's AirPlay list shows \"Campfire\" once a party is started."
echo "================================================"
