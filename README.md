# 🎵 Campfire Bridge

A full-stack system for uninterrupted music playback on Bluetooth speakers via a Raspberry Pi bridge device.

## 🏗️ Architecture
[Mobile App] —AirPlay/Cast (audio)→ [shairport-sync] ←→ [PulseAudio party sink] → [Built-in + Bluetooth Speakers]
[Mobile App] —HTTP (setup/control)→ [Bridge API] → manages BT pairing, party mode, AirPlay on/off

## 📦 Repository Structure

- `bridge/` - Raspberry Pi setup and services
- `app/` - React Native mobile application
- `docs/` - Documentation and diagrams
- `scripts/` - Deployment and development scripts

## 🚀 Quick Start

### Bridge Setup

```bash
# Flash Raspberry Pi OS Lite 64-bit
# Run on the Pi:
sudo ./bridge/install_bridge.sh

### Mobile App
cd app
npm install
npx react-native run-ios # or run-android

##📱 Features
AirPlay support (iOS) — stream from any app, no Spotify dependency
Cast support (Android, planned)
Multi-speaker party mode with latency-synced playback
Multi-adapter Bluetooth routing (one dongle per speaker)
Device discovery via mDNS
Secure JWT authentication
Real-time status via WebSocket

##🛠️ Development
make lint    # Run linters
make test    # Run tests
make build:ios  # Build iOS
make build:android  # Build Android

## 📚 Documentation
Architecture Diagram
Bridge Setup Guide
App Development Guide
Security Policy
System Limitations
## 📄 License
MIT License - see LICENSE for details.
