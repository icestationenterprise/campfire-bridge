#!/bin/bash
set -e

=== Configuration ===
BRIDGE_USER="bridge"
BRIDGE_HOME="/home/$BRIDGE_USER"
TIMEZONE="America/New_York"
HOSTNAME="campfire-bridge"

=== Update system ===
echo "Updating system packages..."
sudo apt update && sudo apt upgrade -y

=== Install dependencies ===
echo "Installing dependencies..."
sudo apt install -y
git curl bluez pulseaudio avahi-daemon ufw nodejs npm jq
build-essential libasound2-dev libssl-dev

=== Create bridge user ===
echo "Creating bridge user..."
sudo useradd -m -s /bin/bash -G audio,bluetooth $BRIDGE_USER

=== Set timezone ===
sudo timedatectl set-timezone $TIMEZONE

=== Set hostname ===
echo "$HOSTNAME" | sudo tee /etc/hostname
sudo hostnamectl set-hostname "$HOSTNAME"

=== SSH hardening ===
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh

=== Firewall ===
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 8080/tcp
sudo ufw --force enable

=== Install librespot ===
echo "Installing librespot..."
cd /tmp
curl -L https://github.com/librespot-org/librespot/releases/latest/download/librespot-linux-arm64.tar.gz | tar xz
sudo mv librespot /usr/local/bin/
sudo chown root:root /usr/local/bin/librespot
sudo chmod +x /usr/local/bin/librespot

=== Install shairport-sync (optional) ===
echo "Installing shairport-sync..."
sudo apt install -y autoconf automake libtool libdaemon-dev libasound2-dev libpopt-dev libconfig-dev avahi-daemon libavahi-client-dev libssl-dev libsoxr-dev
cd /tmp
git clone https://github.com/mikebrady/shairport-sync.git
cd shairport-sync
autoreconf -i -f
./configure --sysconfdir=/etc --with-alsa --with-avahi --with-ssl=openssl --with-soxr --with-systemd
make
sudo make install

=== Install Node.js API ===
echo "Setting up Node.js API..."
sudo npm install -g typescript ts-node pm2
cd $BRIDGE_HOME
git clone https://github.com/your-org/campfire-bridge-api.git api
cd api
npm install
sudo -u $BRIDGE_USER npm run build

=== Configure PulseAudio ===
sudo cp /tmp/pulse-default.pa /etc/pulse/default.pa
sudo systemctl enable pulseaudio --global

=== Copy systemd units ===
sudo cp systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload

=== Enable services ===
sudo systemctl enable pulseaudio
sudo systemctl enable librespot
sudo systemctl enable bridge-api
sudo systemctl enable bt_autoreconnect

=== Final checklist ===
echo "✅ Bridge installed. Reboot and run 'bluetoothctl' to pair your speaker."
echo "IP Address: $(hostname -I)"
