Bridge Setup Guide
Hardware Requirements
* Raspberry Pi 3B+ or newer
* Bluetooth speaker
* Power supply
* microSD card (8GB+)

Installation
1. Flash Raspberry Pi OS Lite 64-bit to microSD card
2. Insert card and power on the Pi
3. Run the installation script:
sudo ./install_bridge.sh
Configuration
1. Pair your Bluetooth speaker using bluetoothctl
2. Configure WiFi if needed
3. Set environment variables in .env

Services
* librespot.service - Spotify Connect receiver
* bridge-api.service - REST/WebSocket API
* pulseaudio.service - Audio routing
* bt_autoreconnect.service - Bluetooth auto-reconnect

Troubleshooting
See troubleshooting guide
