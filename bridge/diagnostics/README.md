# Hardware Cost-Down Diagnostics

**Goal:** find the cheapest bill of materials that still runs the Campfire Bridge
audio path at shipping quality — and prove it with measurements, not guesses.

The Pi 5 dev rig works. The question is which parts of it are load-bearing.
This directory answers that in four passes.

---

## The thing most people get wrong

Your workload is **spread across processes, and shairport-sync is the most
expensive one** — not PulseAudio.

```
shairport-sync ──► campfire_party (null sink) ──┬─► loopback ─► SBC encode ─► BT dongle 1
   (ALAC decode,                                ├─► loopback ─► SBC encode ─► BT dongle 2
    soxr resample)                              ├─► loopback ─► SBC encode ─► BT dongle 3
                                                └─► loopback ─────────────► USB audio (wired)
```

Every loopback and every SBC encoder does run inside **one PulseAudio process**,
and that mixing path is effectively one thread — but measurement showed it is not
the ceiling. At the stressed config on the Pi 5 rig: **shairport-sync 26%,
pulseaudio 15%**. The ALAC decode and soxr resample stage ahead of the fan-out
costs more than the fan-out itself, and the two run on different cores.

What follows from that:

- **Total CPU % across all cores is still the wrong headline metric.** 30% total
  on a quad-core can mean one core pinned at 100% and three idle — a device that
  stutters. The number that picks your SoC is **busiest-core p95**; everything
  here reports it and `report.py` flags it.
- **Do not rule out a multi-core budget SoC on single-thread grounds.** An
  earlier version of this document did exactly that. The measurements overturned
  it: because the work spreads across processes, more and slower cores *can*
  carry this workload. The requirement is roughly **1200–1400 MHz of
  Cortex-A76-equivalent throughput, spread across any number of cores** — see
  "Measured baseline" in `EXPERIMENTS.md`.
- **`dsp_bench` SCORE is a per-core throughput proxy, not a verdict.** Use it to
  compare microarchitectures, then check the board has enough cores to spread
  the fan-out across.

You still cannot shop from spec sheets: two boards with "4× 1.5 GHz" can differ
2.5× per clock.

---

## Pass 1 — Measure what you actually use

On the Pi, with **AirPlay streaming to 3 BT speakers + the wired speaker**
(Extended SKU worst case — never profile the Limited SKU and extrapolate up):

```
python3 capture.py --label extended-3bt --duration 180
```

Also capture the cases that add hidden load:

| Label | Scenario | Why it matters |
|---|---|---|
| `extended-3bt` | 3 BT + wired, home WiFi | The worst case you ship |
| `camping-3bt` | Same, but in camping/hotspot mode | The Pi is now an AP *and* a BT host, on the same 2.4 GHz band |
| `limited-1bt` | 1 BT + wired | The cheap SKU may justify cheaper silicon |
| `idle-connected` | Paired, nothing playing | Sets the standby power floor |
| `boot` | Capture from power-on for 90 s | Boot time is a product quality decision |

Then:

```
python3 report.py ~/campfire-diag/*.json
```

You now know: busiest-core %, peak RAM, SD write rate, thermals, and whether
the journal recorded any real audio faults.

---

## Pass 2 — Find the knee

Emulate weaker hardware on the Pi you already own, and find where it breaks:

```
./run-matrix.sh all
```

This sweeps CPU quota (widest range), core count, and clock, capturing at each
step and **pausing for you to listen**. Listen seriously — multi-speaker drift
is audible long before it shows up in a log.

The output is your **requirement**: "the audio path needs at least X% of one
Cortex-A76 core at Y MHz, and Z MB of RAM."

**Where this method runs out of road:** a Pi 5 will not clock below ~1.5 GHz, and a
Cortex-A76 is ~2–2.5× faster per clock than the Cortex-A53 in most cheap boards.
Downclocking measures the clock axis; it cannot measure the microarchitecture
axis. That's what Pass 3 is for.

---

## Pass 3 — Compare boards before buying them

`dsp_bench.c` is a single-threaded benchmark built from the three kernels your
workload actually runs: float FIR (soxr resampling), int subband analysis (SBC
encoding), and N-stream mixing (the loopback fan-out).

```
cc -O2 -o dsp_bench dsp_bench.c -lm
taskset -c 0 ./dsp_bench          # prints SCORE=...
```

The Pi 5 dev rig scores **330.8** — that is the cross-board baseline. Run **the
same binary source** on any candidate board (borrowed, a friend's, a $15 eval
unit, or a cloud ARM instance with the same core type), then predict:

```
python3 report.py --baseline 330.8 --predict 140 ~/campfire-diag/extended-3bt-*.json
#                            ^Pi5 score  ^candidate score
```

A predicted busiest-core p95 under **50%** means "buy one and confirm."
Over **70%** means "don't." Against the measured Pi 5 runs that puts the
cut-off at a candidate SCORE of roughly **170**.

The margin is not padding. It absorbs: a future codec change (AAC costs more
than SBC), a fourth speaker, thermal throttling in a sealed plastic enclosure,
and the day a customer's BT speaker negotiates a bitpool you didn't test.

---

## Pass 4 — Confirm on real silicon

Buy **one** of each of your top two candidates. Run the identical harness. A
board ships only if it passes every row:

| Gate | Threshold | Tool |
|---|---|---|
| Busiest-core p95, Extended SKU | < 50% | `capture.py` |
| Busiest-core p95, camping mode | < 60% | `capture.py` |
| Audio faults over 30 min | 0 | `capture.py` journal counts |
| Audible drift between speakers | none | your ears + `*.sinks.csv` |
| Peak RAM | < 60% of board RAM | `capture.py` |
| Temp in sealed enclosure, 1 h | < 70 °C, no throttle codes | `capture.py` |
| Boot to first audio | < 45 s | stopwatch |
| BT reconnect after power cycle | 3/3 speakers, < 30 s | manual |

Run the thermal gate **in the actual enclosure**. An open board on a desk will
pass a test that a sealed box fails, and that failure shows up after your
customer has been playing music for an hour.

---

## Files

| File | What it does |
|---|---|
| `capture.py` | Samples system + per-process telemetry, PulseAudio sink latency, journal faults → CSV + JSON |
| `report.py` | Compares runs into one table; `--predict` estimates a candidate board |
| `constrain.sh` | Emulates weaker hardware (clock, cores, CPU quota, RAM ballast) |
| `run-matrix.sh` | Guided sweep that finds the breaking point, pausing for listening tests |
| `dsp_bench.c` | Portable single-thread score for cross-board comparison |
| `EXPERIMENTS.md` | Per-component cost-down experiments, cheapest wins first |

## Deploying this to the Pi

**On your Mac:**
```
rsync -avz bridge/diagnostics/ pi@campfire-bridge.local:~/campfire-bridge/bridge/diagnostics/
```

**On the Pi:**
```
cd ~/campfire-bridge/bridge/diagnostics
sudo apt install -y build-essential python3
cc -O2 -o dsp_bench dsp_bench.c -lm && taskset -c 0 ./dsp_bench
```

### Pulling the results back

`capture.py` writes to `~/campfire-diag/` **on the Pi**, which is an SD card that
will eventually be reflashed. The derived numbers are no use without the raw
samples behind them (E4 reads the CSVs directly), so copy them off after every
session.

**On your Mac:**
```
rsync -avz pi@campfire-bridge.local:~/campfire-diag/ ~/campfire-diag/
```

---

## One caution about optimising the wrong variable

At small volumes, **certification and tooling dominate BOM**. FCC intentional-radiator
testing is ~$5–15k and 6–12 weeks (item #1 in `PLAN.md`).

Using a **pre-certified radio module** (CM4/CM5, or any SoM with a modular grant)
means you inherit that grant and test far less. A bare cheap SoC with a raw radio
puts you back into full intentional-radiator testing.

Do this arithmetic before falling in love with a cheaper board:

```
BOM saving per unit × units in the first production run
   vs
extra certification cost + weeks of delay + your engineering time
```

Saving $18/unit on 200 units is $3,600 — less than the certification delta it
can trigger. The same $18 on 5,000 units is $90,000, and the calculus inverts.
**Know your first-run volume before you pick the SoC**, because it changes the
right answer.
