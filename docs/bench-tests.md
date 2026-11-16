# Bench tests — STANDARD unit (Pi 4B, one radio)

Status: **DONE** passed on the bench · **VERIFY** probably works, result never
reported · **TODO** not yet run · **BLOCKED(x)** needs software first.
Record results and dates in the Status column; put numbers in
`bridge/diagnostics/EXPERIMENTS.md` under "Pi 4B acceptance".

Sync new code to the Pi first:

**On the Pi:**
```bash
cd ~/campfire-bridge && git pull
cd bridge/api && npm run build && systemctl --user restart campfire-bridge
```
After changes to `bridge/setup-pi.sh` or anything in `bridge/scripts/` or
`bridge/systemd/`, re-run the script instead; it is safe to re-run:
```bash
bash ~/campfire-bridge/bridge/setup-pi.sh && sudo reboot
```

| # | Test | Steps | Pass | Status |
|---|---|---|---|---|
| T1 | Boot + SSH | cold boot on the HAT, wait 90 s, `ssh pi@campfire-bridge.local` | prompt | DONE 2026-11-08 |
| T2 | AirPlay 2 target | iPhone Control Center → AirPlay | "Campfire" listed | DONE 2026-11-08 |
| T3 | Built-in speaker, direct | `speaker-test -c 2 -t sine -f 440 -l 1` | tone from the driver | DONE 2026-11-08 |
| T4 | Built-in in the party | Stop/Start the party in the app | "2 speakers in sync", a `builtin` row | VERIFY |
| T5 | Radio + JBL party | `bluetoothctl show` Powered yes; pair, connect, party, AirPlay | both play, sync adjustable | DONE 2026-11-09 |
| T6 | LED colours | `pinctrl set 16 op dl` red · `13` green · `12` blue · `dh` off (common-anode) | each colour alone | DONE 2026-11-16 |
| T7 | Mute button pin | `pinctrl set 26 ip pu; pinctrl get 26` | `hi`, `lo` while held | DONE 2026-11-16 |
| T8 | Battery HAT power quality | HAT ON, no USB-C: `vcgencmd get_throttled; i2cdetect -y 1` | `0x0`; one address (0x43 expected) | VERIFY |
| T9 | Cold boot joins Loon-5G, no hotspot | HAT off 10 s, on; wait 3 min; `iw dev wlan0 link \| grep freq` | `5xxx`; the Campfire SSID never appears | TODO |
| T10 | Power button sleep/wake | after `setup-pi.sh` + reboot: press the pin-5 button; press again | green LED stops ≤ 15 s; wakes and SSH works ≈ 15 s later | TODO |
| T10b | Gauge still readable with the power button overlay | `i2cdetect -y 1` after T10 | same address as T8 | TODO — if it vanished, GPIO3 and I²C conflict: move shutdown to `dtoverlay=gpio-shutdown,gpio_pin=5` (pin 29) and keep pin 5 for wake only |
| T11 | Camping mode, 10 min | app Settings → Camping; phone joins Campfire; AirPlay + party 10 min; Settings → Home | no dropouts; app reconnects at 192.168.4.1 and back | TODO (E5) |
| T12 | Range | JBL at 15 ft with two people between, 30 min; repeat with the old RTL8761B dongle | no dropouts; note BT851 vs dongle | TODO |
| T13 | Battery runtime | full charge; party at normal volume until shutdown | ≥ 5 h; clean reboot after | TODO (E8) |
| T14 | Charge while playing | charger in during a party; `vcgencmd get_throttled` | `0x0`, no dropouts | TODO |
| T15 | Boot-to-API time | `bridge/diagnostics/boot-time.sh` (RUNBOOK) | API < 45 s | TODO (E7a); AirPlay-at-boot BLOCKED(S4) |
| T16 | CPU headroom | `dsp_bench`; `capture.py --label pi4b-1bt --duration 300` (RUNBOOK) | score > 170; busiest core < 60 % | TODO |
| T17 | Unplug ×10 clean boot | pull power mid-song, 10 cycles | boots every time | BLOCKED(S3 read-only root) — **do not run on the current card** |
| T18 | Mute button behaviour | short press; 1 s hold | built-in mute toggles; all-mute toggles; app reflects both; LED flashes | TODO (daemon written 2026-11-16, untested) |
| T19 | LED states | boot; home; app → Camping; stop the bridge (`systemctl --user stop campfire-bridge`) | pulsing blue → white → orange → red after 30 s | TODO (daemon written, untested) |
| T20 | Hotspot provisioning + forced password | fresh card → hotspot → app enters WiFi → password change | joins home WiFi | BLOCKED(S5) |
| T21 | Fresh-card reproducibility | flash a new card; run only `setup-pi.sh`; nothing by hand | T1–T5 pass | TODO (script rewritten 2026-11-16, untested) |

## Notes
- T10: `dtoverlay=gpio-shutdown` uses GPIO3 (pin 5) with a 100 ms debounce.
  The HAT's gauge shares that pin as I²C clock; the official overlay notes do
  not forbid the combination, but T10b checks it on this hardware.
- T18/T19: the panel daemon logs to the journal:
  `journalctl -u campfire-panel -f`. LED type is set by `LED_ACTIVE_HIGH`
  in `bridge/systemd/campfire-panel.service` (unset = common-anode, the bench part).
- T21 is the one that matters for shipping: a unit is only reproducible if a
  fresh card needs no hand work.
