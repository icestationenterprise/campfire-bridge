# Hardware Characterization — Step-by-Step Runbook

Start to finish. Follow in order. Do not skip Part 0.

**Four rules that have each already cost a full run:**

1. **The `--label` does not change the rig.** It is a filename. Physically change
   the speakers *first*, then run the capture with the matching label.
2. **Never Ctrl-C a capture.** A short run makes p95 meaningless.
3. **Run `./preflight.sh` before every single capture.** It must say GO.
4. **After anything that touches cores, run `nproc`.** If it is not 4, reboot.
   Every measurement taken on the wrong core count is silently wrong.

All commands run **on the Pi** over SSH as the `pi` user, **never with sudo**
unless the step says so — sudo breaks the PulseAudio connection.

---

## Part 0 — Clean slate

**On the Pi:**
```
sudo reboot
```

Wait ~60 s, reconnect, then:
```
nproc                                   # must print 4
cat /sys/devices/system/cpu/online      # must print 0-3
uptime                                  # confirms the reboot happened
```

If `nproc` is not 4, stop — nothing below is valid until it is.

---

## Part 1 — Deploy

**On your Mac:**
```
cd /Users/icestation/Projects/campfire-bridge
rsync -avz bridge/diagnostics/ pi@campfire-bridge.local:~/campfire-bridge/bridge/diagnostics/
rsync -avz --exclude node_modules --exclude dist \
  bridge/api/src/ pi@campfire-bridge.local:~/campfire-bridge/bridge/api/src/
```

**On the Pi:**
```
cd ~/campfire-bridge/bridge/api && npm run build && systemctl --user restart campfire-bridge
cd ~/campfire-bridge/bridge/diagnostics && cc -O2 -o dsp_bench dsp_bench.c -lm
```

---

## Part 2 — Radio layout (do this once, before any audio)

```
cd ~/campfire-bridge/bridge/diagnostics
./bt-identify.sh
```

Confirm: three rows, all `Bus: USB`, no `BUILT-IN` row.

**Check the SPEED column.** Any dongle showing `USB3` is sitting in broadband
2.4 GHz noise — move it to a USB2 port (black on a Pi 5) or onto a short USB
extension cable. Three dongles in adjacent ports also desense each other.

Then connect all three speakers through the app and check the spread:
```
./bt-balance.sh show
```

**Required: exactly one active link per dongle.** Two A2DP streams on one radio
chop. If two share a radio:
```
./bt-balance.sh move <speaker-mac> <idle-hciN>
```

---

## Part 3 — The four captures

Each is a **different physical configuration**. Change the rig, then capture.

### 3A. Extended SKU — the worst case you ship

Rig: **3 BT speakers + wired, all playing in sync.**

1. AirPlay from your iPhone to Campfire Bridge
2. Party mode on, all 4 outputs
3. Play a long continuous album at realistic volume
4. ```
   ./preflight.sh                   # must say GO
   python3 capture.py --label extended-3bt --duration 180
   ```
5. Check the last line: `observed 3 BT sink(s) + wired`. If it says anything
   else, the rig is not what you think — fix it and re-run.

### 3B. Limited SKU — does the cheap SKU need less silicon?

Rig: **1 BT speaker + wired.** You must actually disconnect two speakers.

```
./bt-balance.sh show            # confirm only ONE link remains
EXPECT_BT=1 ./preflight.sh      # tell preflight to expect 1 BT speaker, not 3
python3 capture.py --label limited-1bt --duration 180
```

Confirm the summary says `observed 1 BT sink(s) + wired`.

This is the run that tells you the marginal cost per speaker — without it you
cannot extrapolate to a 4-speaker config or justify cheaper silicon for Limited.

### 3C. Idle — the standby floor

Rig: **all 4 outputs connected, music genuinely STOPPED.**

Stop playback on the phone. Do not just pause mid-track and walk away — confirm
nothing is streaming.

```
python3 capture.py --label idle-connected --duration 180
```

Preflight will FAIL here (sinks are not RUNNING). **That is correct for this one
run** — it is the only capture where you intentionally ignore preflight. This
number sizes the PSU and tells you idle power draw.

### 3D. Camping mode — a launch gate, not an optimization

**Read this whole section before starting. You will lose SSH.**

The camping daemon tears the hotspot down within 30 s whenever home WiFi is in
range, so you must stop the daemon first or the test cannot run.

**On the Pi:**
```
sudo systemctl stop camping-mode
sudo nmcli con up campfire-hotspot
```

The Pi drops off home WiFi now. SSH dies. Then:

1. On your **phone**: join WiFi network `Campfire`. Get the password from the Pi
   with `nmcli con show campfire-hotspot --show-secrets | grep psk` — do not paste
   it into this repo, which is public
2. On your **Mac**: join `Campfire` as well
3. SSH back in: `ssh pi@campfire-bridge.local` (or `ssh pi@10.42.0.1`)
4. On the phone: AirPlay to Campfire Bridge, all 4 outputs, play music
5. ```
   cd ~/campfire-bridge/bridge/diagnostics
   ./preflight.sh
   python3 capture.py --label camping-3bt --duration 300
   ```

300 s, not 180 — coexistence failures are intermittent and need a longer window.

**Restore afterwards:**
```
sudo nmcli con down campfire-hotspot
sudo systemctl start camping-mode
```
Then rejoin your home WiFi on both phone and Mac.

**What you are looking for:** `audio faults` must be `0`, same as 3A. The Pi is
running a 2.4 GHz access point while three Bluetooth radios stream in the same
band. If faults appear here and not in 3A, you have a coexistence problem, and
camping mode is a launch requirement.

---

## Part 4 — Cross-board score

```
taskset -c 0 ./dsp_bench
```

Record `SCORE`. This is the number that lets you compare a candidate board
against this Pi 5 before buying one. Run the identical source on any candidate,
then:
```
python3 report.py --baseline <pi5-score> --predict <candidate-score> \
  ~/campfire-diag/extended-3bt-*.json
```

---

## Part 5 — Find the failure point

Rig: back to **3 BT + wired, playing**, same as 3A.

```
./run-matrix.sh all
```

This sweeps core count, then CPU clock, capturing at each step and pausing for
you to listen. The quota sweep has been removed — it capped each service
separately and never bound on this multi-process workload.

**At each LISTEN prompt**, describe only what you hear *during that run* —
do not touch the speakers, the app, or the sync settings while it is measuring.

**When it finishes:**
```
nproc
```
If that is not 4, `sudo reboot` before doing anything else. Offlining cores on a
Pi 5 can be a one-way trip, and the script now stops rather than let you measure
on the wrong core count.

---

## Part 6 — Read it all together

```
python3 report.py ~/campfire-diag/*.json
```

| Column | Meaning |
|---|---|
| `CORE p95` | Busiest-core load. <50% = room to go cheaper. 50–70% = no margin. >70% = floor. |
| `faults` | Must be 0. Anything else invalidates that row's CPU numbers. |
| `BT` | How many BT speakers were **actually** connected. Cross-check against the label. |
| `mem MB` | Peak RAM. Size the tier to this **plus** OTA headroom. |

Then work through `EXPERIMENTS.md` for the per-component cost-down tests.

---

## Troubleshooting

| Symptom | Tool |
|---|---|
| Speaker won't connect | `./bt-diagnose.sh <mac>` — shows BlueZ's real error |
| Choppy audio | `./bt-balance.sh show` — look for 2 links on one radio |
| Which dongle is which | `./bt-identify.sh`, unplug one, re-run |
| Capture looks implausibly cheap | You measured silence. `./preflight.sh` |
| Numbers identical across different labels | You did not change the rig. Check the `BT` column. |
| SSH drops during BT work | Check `uptime` — did it actually reboot, or just lose WiFi? |
