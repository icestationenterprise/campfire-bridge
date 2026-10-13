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

## Part 7 — The four remaining experiments, step by step

As of 2026-10-12 these four are the open ones. 7A and 7B need nothing you do
not already own. 7C needs two reboots. 7D needs a third Bluetooth speaker.

Deploy the scripts first.

**On your Mac:**
```bash
cd ~/Projects/campfire-bridge
rsync -av bridge/diagnostics/ pi@campfire-bridge.local:/home/pi/campfire-bridge/bridge/diagnostics/
```

---

### 7A — E4: what is writing to the SD card

This closes Known Issue #0 and unblocks storage sizing in #28.

**Step 1 — get the Pi into the state where the fault was seen.** The 4.8 MB/s
was measured with speakers connected, so idle will not reproduce it. Open the
Campfire app, connect both speakers, start the party, and AirPlay something that
actually plays for the whole test. Leave it playing.

**Step 2 — run the attribution script.**

**On the Pi:**
```bash
cd ~/campfire-bridge/bridge/diagnostics
sudo apt install -y fatrace
sudo ./sd-write-attribute.sh
```

It takes about a minute. It prints three numbers that matter:

| Number | Meaning |
|---|---|
| `wchar` | Bytes the API wrote via syscalls — **includes sockets**. A chatty HTTP API inflates this. Not storage. |
| `write_bytes` | Bytes that actually reached the card. **This is the only number that wears it out.** |
| Whole card | Every process, from `/proc/diskstats`. |

**Step 3 — read the verdict.** There are only three outcomes:

- **`write_bytes` is small (<50 KB/s) and `wchar` is large.** The original 4.8 MB/s
  was syscall traffic read as disk traffic — the app polls `/api/status` every
  2 s and each response is a `write()` to a socket. Nothing is wrong with the
  card. Issue #0 closes as a measurement error and E4 proceeds with the real
  number.
- **`write_bytes` is large.** Real. Section 3 of the output lists the files the
  API holds open with their write positions; a growing `pos` is the culprit.
  Send me that section and I will fix it (that is Step 3 of the plan).
- **`write_bytes` is small but the whole card is busy.** Someone else is writing.
  Section 4's fatrace output names them.

**Step 4 — record it** in `EXPERIMENTS.md` under E4, with the state (speakers
connected, party active, playing) noted next to the number.

---

### 7B — E7: boot time

**Step 1 — full power cycle.** Pull the power. Do not `sudo reboot` — a warm
reboot skips firmware init and makes the number look better than the field.

**Step 2 — wait 2 minutes, then SSH in and run it.**

**On the Pi:**
```bash
cd ~/campfire-bridge/bridge/diagnostics
./boot-time.sh
```

**Step 3 — understand what you can and cannot measure yet.** The gate is
"power-on to AirPlay target visible, under 45 s". Right now the API starts
shairport-sync only when party mode is enabled, so **after a cold boot the Pi
advertises no AirPlay target at all** until you open the app and start a party.
The script will say so in section 5.

So record two numbers:

- **(a) power-on → `/api/status` answering** — the script measures this.
- **(b) power-on → AirPlay target visible on the iPhone** — stopwatch, by hand,
  and note that it currently includes app interaction.

E7 passes on (a) or it does not; (b) cannot pass automatically until work-order
**#16** (boot auto-reconnect) lands. That is a finding, not a failure — it means
#16 is a launch gate, not a nice-to-have.

---

### 7C — E3: RAM floor (two reboots)

This decides the board's RAM tier, worth $3–10/unit.

> **Before you start:** you are editing the kernel command line. A typo here
> makes the Pi refuse to boot and you will have to fix it by putting the SD card
> in your Mac. The commands below make a backup first — do not skip it. Recovery
> is at the end of this section.

**Step 1 — back up and set the 1 GB limit.**

**On the Pi:**
```bash
sudo cp /boot/firmware/cmdline.txt /boot/firmware/cmdline.txt.bak
sudo sed -i 's/$/ mem=1024M/' /boot/firmware/cmdline.txt
cat /boot/firmware/cmdline.txt
```

Read that output. It must be **one single line** ending in ` mem=1024M`. If it
looks wrong, restore immediately: `sudo cp /boot/firmware/cmdline.txt.bak /boot/firmware/cmdline.txt`.

**Step 2 — reboot and confirm the kernel really sees 1 GB.**

**On the Pi:**
```bash
sudo reboot
# wait, SSH back in, then:
free -h
```

`total` should read roughly `950Mi`, not 8 GB. If it still says 8 GB the
parameter did not take and the run is meaningless.

**Step 3 — get into the worst case and capture.** Connect the speakers, start
the party, play audio, then:

**On the Pi:**
```bash
cd ~/campfire-bridge/bridge/diagnostics
python3 capture.py --label ram-1g --duration 180
```

**Step 4 — check for swapping during the run.** In a second SSH window while
the capture runs:

**On the Pi:**
```bash
vmstat 1 20
```

The `si` and `so` columns must stay `0`. Anything else means it ran out of RAM
and the tier fails.

**Step 5 — repeat at 512 MB.**

**On the Pi:**
```bash
sudo cp /boot/firmware/cmdline.txt.bak /boot/firmware/cmdline.txt
sudo sed -i 's/$/ mem=512M/' /boot/firmware/cmdline.txt
sudo reboot
```

Then repeat steps 2–4 with `--label ram-512m`.

**Step 6 — PUT IT BACK.** Do not leave the rig crippled; every later
measurement would be wrong.

**On the Pi:**
```bash
sudo cp /boot/firmware/cmdline.txt.bak /boot/firmware/cmdline.txt
sudo reboot
free -h    # must show 8 GB again
```

**Pass criteria:** no faults, `si`/`so` at 0, peak RAM under 60% of the limit.
Expect 1 GB to pass and 512 MB to be too tight once OTA has to download and
verify a firmware image.

**If the Pi will not boot:** power off, put the SD card in your Mac, open
`cmdline.txt` on the `bootfs` volume in a text editor, delete the ` mem=...M`
you added, save, eject, put it back.

---

### 7D — E5: camping-mode WiFi/BT coexistence (gate)

The current result is inconclusive because the control did not match: camping
got 782 s of exposure, home got 362 s. More faults in camping was partly just
more looking.

> **You need three speakers streaming at once for this.** Memory says the K71
> and ENAV are not physically on hand, leaving the JBL Go and the XB23. With two
> speakers this is not the Extended SKU worst case and the result will not
> settle the gate. Get a third speaker before running it.

**Something changed since the last attempt:** `bridge/scripts/bt-afh.sh` now
masks the Pi's own WiFi channel on every Bluetooth adapter, which attacks
exactly the interference E5 is testing for. Confirm it is deployed and running
before you measure, or you will be re-measuring the old behaviour.

**On the Pi:**
```bash
systemctl status campfire-camping-mode --no-pager | head -20
sudo /usr/local/bin/campfire-bt-afh.sh && echo "AFH applied"
```

**Step 1 — camping run.** Switch the device to camping mode from the app, join
your iPhone to the `Campfire` WiFi network, connect all three speakers, start
the party, AirPlay audio that plays continuously.

**On the Pi** (SSH over the hotspot: `ssh pi@192.168.4.1`):
```bash
cd ~/campfire-bridge/bridge/diagnostics
python3 capture.py --label camping-3bt-600 --duration 600
```

Ten minutes. Leave the music playing the whole time. Do not touch the app.

**Step 2 — home control run, same length.** Switch back to home WiFi, same three
speakers, same audio, same volume.

**On the Pi:**
```bash
python3 capture.py --label home-3bt-600 --duration 600
```

**Step 3 — compare.**

**On the Pi:**
```bash
python3 report.py ~/campfire-diag/camping-3bt-600.json ~/campfire-diag/home-3bt-600.json
```

**Pass if:** fault counts are the same in both. Equal exposure is the whole
point — 600 s each, nothing else different.

**One thing to sanity-check in the output:** last time `hostapd` CPU read 0.0%
in every camping run, which is suspicious for a run that is supposed to be
hosting an access point. If it reads 0.0 again, the capture is not seeing the AP
process and the camping run is not measuring what it claims.

**If camping is genuinely worse:** move the AP to a 2.4 GHz channel far from
where the dongles hop (1/6/11), or to 5 GHz — but 5 GHz-only excludes older
phones, and camping mode is a launch requirement, so it is a real trade.

---

### 7E — E6: power budget (you have the meter)

**Wiring:** `wall adapter → USB-C meter → Pi 5`. The meter goes between the
adapter and the Pi, not on a downstream port.

**Step 1 — record volts AND amps, never amps alone.** USB-C PD negotiates a
voltage; 2 A at 5 V and 2 A at 12 V are completely different loads. The script
does the arithmetic.

**Step 2 — run the guided script.** It walks six load states, prompts you for
each reading, records the Pi's throttle state alongside it, and prints the PSU
rating and a battery cell-count table.

**On the Pi:**
```bash
cd ~/campfire-bridge/bridge/diagnostics
./power-budget.sh
```

**Step 3 — the state that matters most is the last one.** Camping mode hosts an
access point *while* three Bluetooth radios stream and the amp drives the
built-in speaker. That is the real worst case you ship, it is higher than the
home-mode load, and it is the number that sizes both the PSU and the battery.

**If the Pi misbehaves with the meter inline** — refuses to boot, warns about
the power supply, or USB devices start dropping — the meter is interfering with
PD negotiation and is now part of the circuit you are measuring. Note it and
treat the readings as a floor rather than a truth.

**Watch `vcgencmd get_throttled`.** The script prints it at every state. `0x0`
is clean; anything with bit 0 or bit 16 set means under-voltage, and `0x50005`
means it is actively browning out. An under-voltage reading invalidates the CPU
numbers from any capture taken in the same state.

**Feeds directly into #27b:** the continuous worst-case draw is the input to
battery sizing, and the script prints the Wh and 18650 count for 4/6/8/12 hour
targets so you can see what the runtime decision actually costs.

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
