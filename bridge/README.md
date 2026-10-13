# Campfire Bridge — device software

Everything that runs on the Raspberry Pi inside the speaker.

| Path | What |
|---|---|
| `api/` | Bridge API (Express/TypeScript). Bluetooth speaker management, party mode, AirPlay start/stop, network-mode requests. |
| `scripts/camping-mode.sh` | Daemon that switches between home WiFi and the Campfire hotspot. Runs as root. |
| `config/campfire-hotspot.nmconnection` | NetworkManager profile for the hotspot. |
| `config/shairport-sync.conf` | AirPlay receiver configuration. |
| `systemd/camping-mode.service` | System unit for the daemon. |
| `setup-pi.sh` | One-shot provisioning of a fresh Raspberry Pi OS Lite install. The only supported install path. |
| `diagnostics/` | Hardware characterization harness (see its README). |

## Install

Flash Raspberry Pi OS Lite (64-bit), boot, then:

```bash
curl -sL https://raw.githubusercontent.com/icestationenterprise/campfire-bridge/main/bridge/setup-pi.sh | bash
sudo reboot
```

## Services on the Pi

| Service | Scope | Role |
|---|---|---|
| `campfire-bridge` | user (`systemctl --user`) | Bridge API on port 3000 |
| `shairport-sync` | user (`systemctl --user`) | AirPlay receiver; started/stopped by the API with party mode |
| `pulseaudio` | user | Audio routing (null sink + loopbacks + BT sinks) |
| `campfire-camping-mode` | system | WiFi ↔ hotspot switching |
| `bluetooth`, `nqptp`, `avahi-daemon` | system | BlueZ, AirPlay 2 timing, mDNS |

## How audio flows

```
iPhone (AirPlay) ──► shairport-sync ──► campfire_party (PulseAudio null sink)
                                            ├─ loopback ─► bluez_sink.<speaker 1>
                                            ├─ loopback ─► bluez_sink.<speaker 2>
                                            └─ loopback ─► built-in sink (when BUILTIN_SINK_NAME is set)
```

Each loopback carries its own buffer so every speaker plays in sync; the
per-speaker value is dialed in from the app and persisted in
`~/.campfire-bridge/latency-cal.json`.

## Deploying API changes

**On your Mac:**
```bash
rsync -av bridge/api/src/ pi@campfire-bridge.local:/home/pi/campfire-bridge/bridge/api/src/
```

**On the Pi:**
```bash
cd ~/campfire-bridge/bridge/api && npm run build && systemctl --user restart campfire-bridge
```

Restarting the API does not interrupt audio: on start it adopts whatever
PulseAudio graph is already running.

## Tests

**On your Mac:**
```bash
cd bridge/api && npm test
```

All system access is mocked; the suite runs anywhere. See `docs/troubleshooting.md` for on-device checks.
