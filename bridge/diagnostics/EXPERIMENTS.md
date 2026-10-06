# Component Cost-Down Experiments

Ranked by **money saved per hour of your time**. Each is a self-contained test
with a pass/fail and the BOM decision it unlocks. Most run on the rig you own.

Record every result in the table at the bottom.

---

## E1 — Kill the USB sound adapter and the PAM8403 (I²S amp)

**Saves:** the USB audio adapter, the PAM8403 board, an aux cable, a USB port,
and several hand-solder joints per unit. Roughly $4–7/unit at low volume, plus
real assembly labour — likely your single biggest win.

**Why it's on the table:** the Pi 5 has no analog audio out, which is the only
reason the USB adapter exists. A MAX98357A (~$1.50 in volume) is an I²S DAC and
3 W class-D amp on one chip — it replaces the adapter *and* the amp, and drives
your existing 4 Ω driver directly.

**Test (~$6, one evening):**
1. Wire a MAX98357A breakout to the Pi 5 GPIO header: BCLK→pin 12, LRCLK→pin 35,
   DIN→pin 40, VIN→pin 2 (5 V), GND→pin 6, and the speaker to its `+`/`-`.
2. Add to `/boot/firmware/config.txt`: `dtoverlay=hifiberry-dac`, then reboot.
3. `pactl list short sinks` → find the new `alsa_output...` sink name.
4. Set `BUILTIN_SINK_NAME` in the Pi's `.env` to that name, restart the bridge.
5. `python3 capture.py --label i2s-3bt --duration 180` with the full setup playing.

**Pass if:** audio is clean, busiest-core p95 is no worse than the USB path,
and the wired speaker stays in sync with the BT speakers (it should improve —
I²S has a shorter, more predictable path than USB audio).

**Watch for:** the MAX98357A is mono. For stereo use two, or accept mono (fine
for a single built-in driver). It also has no hardware volume control — volume
is done in software, which you already do in `party.ts`.

---

## E2 — How many dongles does the Extended SKU really need?

**Saves:** up to 2 dongles/unit (~$8–16) *and* possibly a USB hub *and* a port.

**Why it's on the table:** the current design assumes one radio per speaker.
Many BT controllers hold 2–3 simultaneous A2DP links; the limit is usually
bandwidth and firmware quality, not the spec.

**Test (free, ~1 hour):**
1. Unplug all but one dongle.
2. Pair and connect 2 speakers to that single adapter.
3. `python3 capture.py --label 1dongle-2spk --duration 300` — 5 minutes, because
   the failure mode here is intermittent.
4. Repeat with 3 speakers on one dongle (`1dongle-3spk`).

**Pass if:** zero dropouts over 5 minutes, no audible drift, `a2dp_fail` and
`bt_disconnect` counts are 0.

**Expect:** 2 speakers on one good dongle often works; 3 is usually where it
breaks. If 2 works, Extended goes from 3 dongles to 2. Test with the *worst*
speakers you own, not the best — and be aware `adapters.ts` currently assigns
one speaker per adapter, so this change needs a code change too.

---

## E3 — RAM floor

**Saves:** $3–10/unit. Board RAM tiers are one of the biggest price steps.

**Test (~30 min, needs 2 reboots):**
```
./constrain.sh ram-boot 1024     # follow the printed instructions, reboot
python3 capture.py --label ram-1g --duration 180
./constrain.sh ram-boot 512      # reboot again
python3 capture.py --label ram-512m --duration 180
```

**Pass if:** no faults, no swapping (`vmstat 1` shows `si`/`so` at 0), peak RAM
under 60% of the limit.

**Expect:** the audio path is small. Headroom goes to page cache and to whatever
the Node API and future OTA agent need. Do not size to the measured peak — size
to peak plus the OTA update process, which downloads and verifies a full image.

---

## E4 — Storage: size and write endurance

**Saves:** $2–5/unit, and avoids the #1 field-failure mode for Pi products.

**Test (free, runs alongside everything else):**
1. Image size: `df -h /` after a fresh flash of the production image.
2. Write rate: `disk_write_kbps` in any capture CSV. Average it, multiply out.

```
python3 - <<'PY'
import csv, glob, os, statistics
vals = [float(r["disk_write_kbps"])
        for f in glob.glob(os.path.expanduser("~/campfire-diag/*.csv"))
        if not f.endswith(".sinks.csv")
        for r in csv.DictReader(open(f)) if r.get("disk_write_kbps")]
avg = statistics.mean(vals)
print(f"avg {avg:.1f} KB/s -> {avg*86400/1048576:.2f} GB/day -> {avg*86400*365/1048576:.0f} GB/year")
PY
```

**Decide:** if writes are under ~1 GB/day, an 8 GB eMMC beats a 16 GB SD card on
cost *and* reliability. If they're higher, find out what is writing (journald is
the usual culprit — `Storage=volatile` in `/etc/systemd/journald.conf` is the fix)
before buying bigger storage.

**Non-negotiable:** whatever you pick, the rootfs should be read-only or
overlayfs in production. Customers will unplug the speaker mid-write.

---

## E5 — WiFi/BT coexistence in camping mode

**Not a saving — a risk that constrains which cheap boards are allowed.**

In camping mode the device runs a 2.4 GHz AP while three BT radios stream A2DP
in the same band. Cheap combo modules with a shared antenna handle this badly,
and it is the single most likely way a cheaper board ruins the product.

**Test (free, 30 min):**
1. `python3 capture.py --label camping-3bt --duration 600` with the phone joined
   to the hotspot and AirPlay running to all speakers. Ten minutes minimum.
2. Repeat on home WiFi (`home-3bt`) as the control.

**Pass if:** dropout counts are the same as on home WiFi.

**If camping is worse:** try forcing the AP to a different 2.4 GHz channel
(1/6/11 away from what the dongles hop through), or move the AP to 5 GHz — but
note a 5 GHz-only hotspot excludes older phones, and this is a launch requirement
per `PLAN.md`. Carry this test forward to every candidate board; it is a gate, not
an optimisation.

---

## E6 — Power budget

**Saves:** $2–6/unit on the PSU, and prevents brownout returns.

**Test (~$15 for a USB inline power meter):**
1. Meter between the wall adapter and the board.
2. Record: idle, 3 BT streaming + wired at full volume, and the boot spike
   (the worst case — SD card, all USB ports and radios initialising at once).

**Decide:** PSU rating = measured peak × 1.5. The Pi 5 asks for 5 A because of
its USB-PD negotiation and peripheral budget, **not** because your workload needs
it. A cheaper board with 3 dongles will likely land near 1.5–2.5 A peak, which is
a much cheaper adapter.

**Watch for:** if you keep a Pi 5 and under-spec the supply, it reports throttle
code `0x50005` under-voltage — `capture.py` captures this in `throttle_codes`.

---

## E7 — Boot time

**Not a saving — a product quality gate that constrains storage and SoC choice.**

`systemd-analyze` and `systemd-analyze blame` on the Pi. Time from power-on to
the AirPlay target appearing on an iPhone.

**Target:** under 45 s. Over that, camping-mode use feels broken — the user
plugs in at a campsite and nothing appears.

Cheap eMMC and slow SoCs both hurt here, so measure it on every candidate board.

---

## Measured baseline — Pi 5 dev rig, 2026-10-05

3 BT speakers + wired in sync, AirPlay streaming, open board on a desk. This is
the spec #28 buys against.

| Quantity | Measured |
|---|---|
| Throughput requirement, Extended SKU | **~1200–1400 MHz of Cortex-A76-equivalent**, spread across any number of cores |
| Busiest-core p95 @ 4 cores / 2400 MHz | ~25% (repeatable to within 3 points across 6 runs) |
| Single-core clock curve | 2400 MHz = 56.8% · 2000 = 61.0% · 1700 = 68.9% · 1500 = 73.6% |
| Failure knee | **1500 MHz single-core — 3 underruns** |
| Dominant process | **shairport-sync 26%** (ALAC decode + soxr resample) vs pulseaudio 15% |
| Peak RAM | 541 MB |
| Thermals | max 60 °C open-board, zero throttle codes |
| `dsp_bench` SCORE | **330.8** — the cross-board baseline; a candidate needs >~170 |

**Consequence for board selection:** the workload is *not* single-thread-bound.
It spreads across processes, so multi-core budget SoCs stay on the shortlist.

### Read the baseline with these two caveats

1. **Every number above is inflated by the ~4 MB/s background writer (E4).** It is
   present in all 25 runs, including idle, and it costs CPU as well as endurance.
   If it turns out to be a logging bug, the real audio-path requirement is *lower*
   than 1200–1400 MHz A76-equivalent — possibly enough to change the SoC answer.
   **#28 should not be finalized until E4's writer is attributed.**
2. **There is no idle control at the constrained configs.** At 4 cores / 2400 MHz,
   `idle-connected` costs 24.3% busiest-core and full Extended load costs 25.7% —
   a **1.4-point** marginal cost for streaming to 3 BT speakers + wired. So the
   headline ~25% is almost entirely fixed baseline, not audio work. The single-core
   curve (56.8% → 73.6%) was never paired with an idle run at the same clock, so
   how much of it is the audio path is unknown. Any re-run should capture
   `idle-connected` at every constrained step.

### Data integrity of the existing runs — checked 2026-10-06

Verified by recovering the true sink count from each run's `.sinks.csv`, which
records sink names per sample even for runs whose JSON predates the
`bt_sink_count` field:

- **The clock, cores and quota sweeps are valid on the sink axis.** All of them
  genuinely had 3 BT sinks + wired connected. The `?` in `report.py` output is a
  missing JSON field, not missing speakers.
- **`limited-1bt-20261005-120631` is mislabeled — it had 3 BT sinks, not 1.**
  Trap 3 caught in the wild. Its 22.8% is not a Limited-SKU number; use the
  `135921` run (1 sink, 26.1%) instead.
- **The quota sweep is non-monotonic and confirms trap 1 from the data:**
  quota-25pct = 39.2% busiest-core but quota-15pct = 23.3% and quota-100pct =
  28.7%. The cap never bound. Discard the quota rows entirely.
- **`2bt-wired` ran 46 s, not the intended 180 s.** Too short to mean anything.
- **The Pi powered itself off during the core-offlining runs.** From
  `~/campfire-diag/listening-notes.txt`: "dropouts, pi shut itself odd" (cores-2),
  "Dropouts, crackle, lag, pi shutting off" (cores-1). Treat cores-1 and cores-2
  as unreliable, and note this is a stability event the fault counters did not
  record — both runs logged 0 journal faults.
- **The listening notes disown their own first three entries:** at quota-15pct the
  user wrote "all previous problems happened before LISTEN NOW for each test", so
  the quota-50/35/25 crackle reports are mistimed, not results.

### Method traps already hit — don't repeat them

1. `constrain.sh quota` caps each service separately, so it never binds on this
   multi-process workload and adds throttling overhead of its own. Dropped from
   `run-matrix.sh all`; only run it deliberately.
2. Offlining cores on a Pi 5 can be irreversible without a reboot, and a failed
   restore silently invalidates every later run in the sweep.
3. A `--label` does not change the rig. `capture.py` now records the observed BT
   sink count and `report.py` flags when two runs claim different labels for the
   same config.

### Where the raw samples live

On the Pi at `~/campfire-diag/`, **not in this repo**. The numbers above are the
derived summary; E4 needs the CSVs themselves. See "Pulling the results back" in
`README.md`.

---

## Results table

Fill this in as you go. This is what you take to suppliers.

| # | Experiment | Result | Saving/unit | Decision | Date |
|---|---|---|---|---|---|
| E1 | I²S amp replaces USB adapter + PAM8403 | Not run — blocked on setting `BUILTIN_SINK_NAME` on the Pi | $4–7 | open | — |
| E2 | Dongles needed for 3 speakers | **Not validly run.** The only capture (`2bt-wired`) is **46 s** against a 300 s protocol for an intermittent fault, and records sink MACs but not which adapter each used. The audible 2-on-1-dongle chopping remains an uncontrolled observation | $0–16 | **Do not cut dongle count — one per speaker.** Re-run at 300 s, logging adapter per sink | 2026-09-20 |
| E3 | RAM floor | Peak **541 MB** across 25 runs (max of any run; idle 528 MB). Constrained 1024/512 MB boot runs still not done | $3–10 | **1 GB tier**; 512 MB too tight once OTA downloads an image | 2026-10-05 |
| E4 | Storage size + writes/day | **FAIL — and probably a bug, not a requirement.** Sustained **~4.2 MB/s** of writes → **~347 GB/day, ~126 TB/year**. That is **~347×** the <1 GB/day this experiment assumed. Load-independent: idle-with-nothing-playing writes as much as 3 BT + wired streaming (4315 vs 4293 KB/s). Each run's nonzero samples are integer multiples of that run's own base rate, i.e. a steady writer batched by writeback — not a measurement artifact. `disk_written_bytes()` is correct (`/proc/diskstats` field 9 × 512, differenced), and the same code path yields sane network numbers (89 KB/s AirPlay in, 1 KB/s idle) | $2–5 | **BLOCKED — attribute the writer before choosing storage.** Do not size storage to this number | 2026-10-06 |
| E5 | Camping-mode coexistence | **Inconclusive — the control does not match.** Camping ran 3 captures (181 s, 301 s, 300 s) with **3 underruns in one 300 s run**, 0 in the other two. Home control (`extended-3bt`) ran only 181 s × 2, 0 faults. Camping got 782 s of exposure vs home's 362 s, so more faults is partly just more looking. `hostapd` CPU reads 0.0 in every camping run, which is itself suspect for a run that is supposed to be hosting the AP | gate | open — re-run matched at 600 s each | 2026-10-05 |
| E6 | Peak current draw | Not run — needs a ~$15 inline USB power meter | $2–6 | open | — |
| E7 | Boot time | Not run | gate | open | — |

**Highest-value work remaining, in order:** E4 attribution (a 4 MB/s idle writer is a
field-reliability bug *and* it inflates every CPU number below), E5 re-run with a
matched control, E2 at full duration with adapter logging, E7, E6, E1, E3 boot runs.
