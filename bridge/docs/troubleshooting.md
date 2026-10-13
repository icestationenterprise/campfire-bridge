# Troubleshooting

Commands marked **Pi** run over SSH on the device (`ssh pi@campfire-bridge.local`,
or `ssh pi@192.168.4.1` when joined to the Campfire hotspot).

## The app says the bridge is offline

**Pi:**
```bash
systemctl --user status campfire-bridge
journalctl --user -u campfire-bridge -n 50
cat /tmp/campfire-network-mode        # home or camping — the app must be on the matching URL
```

If the mode flipped to `camping` while you were at home, look at the daemon:

**Pi:**
```bash
sudo journalctl -u campfire-camping-mode -n 50
```

It only falls back to the hotspot after home WiFi has been down for several
consecutive checks; the log shows the countdown.

## Music stutters or drops out

1. WiFi power save must be off. **Pi:**
   ```bash
   iw dev wlan0 get power_save          # expect: Power save: off
   ```
   If it is on, `setup-pi.sh` has not been re-run since the power-save
   drop-in was added. Apply it: `sudo nmcli con modify <home-connection> wifi.powersave 2 && sudo nmcli con up <home-connection>`.
2. One speaker per USB dongle. **Pi:**
   ```bash
   curl -s localhost:3000/api/adapters | python3 -m json.tool
   ```
   Two connected speakers under one adapter will chop. Disconnect one and
   re-pair it; pairing picks the least-loaded dongle.
3. Keep dongles apart from USB 3 ports and from each other (short extension
   cables). See `diagnostics/RUNBOOK.md`.
4. Bluetooth inquiry (scanning) only ever runs while no speaker is connected
   and no party is active. If the API log shows `[bt] inquiry on …` while
   music is playing, something is wrong — report it.

## A speaker will not connect

The app shows the reason returned by `POST /api/bt/connect`:

| reason | meaning | do |
|---|---|---|
| `unreachable` | off, out of range, or held by a phone | power-cycle the speaker |
| `refused` | speaker forgot the pairing | the bridge re-pairs automatically once; if that fails put the speaker in pairing mode and tap Pair |
| `profile-unavailable` | PulseAudio has no A2DP endpoint | `systemctl --user restart pulseaudio` |
| `busy` | adapter mid-operation | wait a few seconds |
| `not-paired` | no bond on any adapter | tap Pair |

**Pi** — see what BlueZ actually knows:
```bash
busctl --system --verbose call org.bluez / org.freedesktop.DBus.ObjectManager GetManagedObjects | grep -A2 -E '"(Address|Paired|Connected|Adapter)"'
```

## Party mode is on but only one speaker plays

**Pi:**
```bash
pactl list short modules | grep campfire_party     # one null-sink + one loopback per speaker
pactl list short sink-inputs                       # shairport-sync must be on the campfire_party sink
```

The API moves client streams onto `campfire_party` whenever party mode is
(re)enabled; toggling party mode off and on from the app fixes a stray stream.

## AirPlay target not visible on the phone

**Pi:**
```bash
systemctl --user status shairport-sync     # only runs while party mode is active
sudo systemctl status nqptp                # AirPlay 2 timing — must be running
avahi-browse -rt _airplay._tcp             # should list "Campfire"
```

## SD card write rate (field reliability)

The bridge API should write almost nothing. To attribute writes:

**Pi:**
```bash
PID=$(pgrep -f 'node dist/index.js'); cat /proc/$PID/io; sleep 10; cat /proc/$PID/io
ls -l /proc/$PID/fd | grep -v -E 'socket|pipe|/dev/'      # files the API holds open for writing
sudo apt install -y fatrace && sudo timeout 15 fatrace -c -f W   # every file written system-wide, with the writer
```
