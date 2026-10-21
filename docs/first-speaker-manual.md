# From the Pi 5 rig to the first shipped speaker — step-by-step

**Branch:** `lightest-certifiable-campfire` (this one). All new code and steps
live here. **Baseline that works on the Pi 5 today:** branch `pi5-dev-rig`.
Never develop on `pi5-dev-rig`; it is the known-good fallback.

**What you are selling first:** STANDARD (1 Bluetooth speaker) and EXTENDED
(3 Bluetooth speakers). LITE (no Bluetooth, Flip-class built-in) comes later.

**Decisions this manual is built on** (made 2026-10-21, see `PLAN.md`):

| Decision | Why |
|---|---|
| AirPlay in, Bluetooth out | Sound segregation is the product |
| Raspberry Pi 4 Model B 1 GB for the first units | 5 GHz WiFi + FCC **modular** grant (2ABCB-RPI4B), same image as today, 4 USB ports |
| Certified Bluetooth modules (Ezurio BT851 now, BT850-ST or Fn-Link 6221E-UUC on the carrier later) | Every radio has a modular grant → the product needs only a Part 15B test |
| Go-class built-in (MAX98357A, 2-inch driver, passive radiator, software EQ) | Matches the JBL Go in the rig for ~$13 |
| No backend | Button = credential, long press = factory reset, firmware from a static file host |
| Battery: 2 × 18650 on a UPS board | ~6 h at party volume; third cell later if wanted |

**Because every radio is modular, the hand-built Phase 1 unit can itself be
Part 15B tested and sold.** The CM4 carrier (Phase 2) is a cost-down, not a
prerequisite for the first sale.

Timeline if parts arrive this week: builds + acceptance in 2–3 weeks, image
work in parallel, app wizard 1–2 weeks, first beta units at ~6 weeks, lab test
booked at ~8 weeks, first sale after the report (lab turnaround 2–4 weeks).

---

## Step 1 — Order today

Shopping list with quantities for one STANDARD **and** one EXTENDED:
`hardware/bom/phase1-shopping-list.md`. Order everything in the "Order today"
table; the "Phase 2 samples" table can wait.

Lead times: Digi-Key 1–2 days · PiShop 2–5 days · Parts Express 3–5 days ·
cells 3–5 days · 3D-print service 7–10 days (or print at home).

Tools you need on the bench: soldering iron, multimeter, the USB power meter
you already have, wire strippers, hot glue, calipers, a 2.5 mm hex driver.

---

## Step 2 — While parts ship: software on this branch

Everything below runs on the **Pi 5 rig first** (it is the same OS), so you
can test each milestone before the Pi 4B arrives. I write the code; you flash,
run and report. Each milestone is one commit on this branch, confirmed working
by you before it is committed.

| # | Milestone | What changes | You verify by |
|---|---|---|---|
| S1 | Trim the image | `setup-pi.sh` disables `tailscaled`, `cloud-init`, `ModemManager`, `NetworkManager-wait-online`; journald capped; no swap | `systemd-analyze` shows them gone; `free -m` idle < 300 MB used |
| S2 | AirPlay 2 built reproducibly | shairport-sync from source with `--with-airplay-2 --with-pa`, nqptp installed and enabled; `interpolation = "basic"` | A fresh SD flashed from the script shows "Campfire" in the iPhone AirPlay list |
| S3 | Read-only root with overlay | Production image boots read-only; `/var`, `/home/pi/.campfire-bridge` writable overlay | Pull the plug 10 times mid-song; it boots clean every time |
| S4 | Boot auto-start | API reconnects bonded speakers, starts the party and shairport-sync on boot | Power on → AirPlay target visible < 45 s, no app needed |
| S5 | Hotspot provisioning | On the `Campfire-XXXX` hotspot the app posts home SSID + password; device joins; forced hotspot-password change; per-unit SSID from the serial file | A fresh unit joins your home WiFi from the app alone |
| S6 | Prefer 5 GHz at home | Saved 5 GHz profile at higher priority; hotspot stays 2.4 GHz | `iw dev wlan0 link` shows a 5 GHz channel at home |
| S7 | USB 2.0 port preference | `bluetooth.ts` picks radios on USB 2.0 ports first | `GET /api/adapters` shows bus paths; pairing lands on the USB 2.0 radios |
| S8 | Built-in DSP chain | EQ + bass shelf + limiter on the built-in sink only; profile by SKU | Measured response in Step 7 |

Deploy loop for every milestone:

**On your Mac:**
```bash
rsync -av --exclude node_modules --exclude dist \
  ~/Projects/campfire-bridge/bridge/ pi@campfire-bridge.local:/home/pi/campfire-bridge/bridge/
```

**On the Pi:**
```bash
cd ~/campfire-bridge/bridge/api && npm run build && systemctl --user restart campfire-bridge
```

For `setup-pi.sh` changes (S1–S3, S6), re-run the script on a **fresh SD card**
rather than patching a live system; the whole point is that a fresh flash
produces a working unit.

---

## Step 3 — Flash the Pi 4B

1. Raspberry Pi Imager → Raspberry Pi OS **Lite (64-bit)** → gear icon:
   hostname `campfire-bridge`, user `pi`, your home WiFi, SSH enabled.
2. Boot the Pi 4B on the bench with the microSD, wall power for now.

**On your Mac:**
```bash
ssh pi@campfire-bridge.local
```

**On the Pi:**
```bash
git clone -b lightest-certifiable-campfire https://github.com/icestationenterprise/campfire-bridge.git ~/campfire-bridge
bash ~/campfire-bridge/bridge/setup-pi.sh
```

The script runs as `pi` and calls `sudo` where it needs to. It installs the
packages, writes the Bluetooth, PulseAudio and NetworkManager config, installs
the hotspot profile and the services, and builds the bridge API.

3. Reboot. Check the three things that prove the image: `systemctl --user status campfire-bridge` is active, "Campfire" shows in the iPhone AirPlay list (after S2/S4), and the hotspot appears when you take the home router away (after S5).

---

## Step 4 — Build the STANDARD unit

Wiring diagram: `hardware/phase1/wiring-pi4b.svg`. Pin table:
`hardware/phase1/pinout.md`. Enclosure layout: `hardware/phase1/enclosure-layout.svg`.

### 4.1 Enclosure

I cannot produce CAD files. Build the box in Tinkercad or Fusion 360 from the
layout drawing: two bays. The **acoustic chamber** (front, ~0.4 L, sealed) holds
the 2-inch driver and the passive radiator on the front face. The
**electronics bay** (rear, vented) holds the Pi + UPS stack, the cells, the
radios, and the rear panel with USB-C, button and LED. Walls 3 mm PETG. Print
or order from a service. Until the print arrives, a $5 ABS project box with
drilled holes works for the bench.

### 4.2 Wire the built-in speaker

1. Solder header pins to the MAX98357A breakout if not done.
2. Female-to-female jumpers from the Pi header to the breakout:
   pin 2 → VIN · pin 6 → GND · pin 12 → BCLK · pin 35 → LRC · pin 40 → DIN.
   Leave SD and GAIN unconnected (mono mix, 9 dB).
3. Speaker wire from `+`/`−` to the driver tabs. Foam gasket tape around the
   driver and the passive radiator; mount both on the front face; seal the
   chamber.

### 4.3 Button and LED

- Button: pin 37 (GPIO26) and pin 39 (GND). Momentary, normally open.
- RGB LED (common cathode): R → 330 Ω → pin 36 (GPIO16); G → 330 Ω → pin 33
  (GPIO13); B → 330 Ω → pin 32 (GPIO12); cathode → pin 34 (GND). Blue is on
  a hardware-PWM pin so "pulsing blue" is cheap.

### 4.4 Power

Mount the UPS board under the Pi on standoffs (it feeds 5 V into the header),
two cells in, its USB-C to the rear panel. Confirm the board's I²C gauge shows
up: `i2cdetect -y 1` on the Pi lists it (address per the board's wiki).

### 4.5 Radio

One Ezurio BT851 in a **black (USB 2.0) port**. For the beta units the old
RTL8761B dongle is acceptable; for anything sold, the BT851.

### 4.6 Power-on checks

**On the Pi:**
```bash
pactl list short sinks        # the MAX98357A I2S sink must be listed
hciconfig -a                  # one hci per radio, all UP
i2cdetect -y 1                # the UPS gauge address
vcgencmd get_throttled        # must be 0x0 on battery
```

Set `BUILTIN_SINK_NAME` in the Pi's `.env` to the I²S sink name, restart the
bridge, play from the phone: you must hear the built-in.

---

## Step 5 — Build the EXTENDED unit

Same as Step 4, plus:
- Radios B and C: BT851 adapters on 20 cm USB extensions to the **rear-left
  and rear-right corners** of the bay; radio A in the front-center position.
  Two go in the black USB 2.0 ports, the third in a blue USB 3.0 port on the
  longest extension.
- Pair one speaker per radio (the API already balances to the least-loaded
  radio; `bridge/diagnostics/bt-balance.sh` shows occupancy).

---

## Step 6 — Acceptance run (each unit)

Click-by-click protocol: `bridge/diagnostics/RUNBOOK.md`. Record results in
`bridge/diagnostics/EXPERIMENTS.md` under a new "Pi 4B acceptance" heading.

| Test | Script | Pass |
|---|---|---|
| CPU headroom | `dsp_bench` | score > 170; busiest core < 60 % with 3 BT + built-in |
| Camping coexistence (E5) | `capture.py --label camping-3bt --duration 600` with the phone on the hotspot | dropouts no worse than home mode |
| Power (E6) | `power-budget.sh` idle / limited / extended / builtin / camping / boot | throttle 0x0 on battery; report prints runtime per cell |
| Boot (E7) | `boot-time.sh` | AirPlay target visible < 45 s from power-on |
| Range | walk each speaker to 15 ft with people in between, 30 min | no dropouts on at least one certified radio type; note BT851 vs old dongle |
| Battery | play at party volume from full to shutdown | ≥ 5 h; clean reboot afterwards |

---

## Step 7 — Tune the built-in

1. Dayton iMM-6 mic into the Mac, REW (free), speaker at 1 m on a stand.
2. Measure the raw response. Expect a bump at the driver resonance and a
   roll-off around 150 Hz before the passive radiator helps.
3. Set the EQ profile (S8): a low shelf for the radiator's region, a notch at
   the resonance, a limiter at the amp's clip point.
4. Pass: ≥ 85 dB at 1 m, −10 dB point ≤ 110 Hz, no audible clipping at max
   volume. Save the profile into the image as the STANDARD/EXTENDED profile.

---

## Step 8 — App for first users

- Setup wizard over the hotspot (S5 on the device side): join `Campfire-XXXX`
  → enter home WiFi → set a new hotspot password → done. The existing
  Connections and Settings screens stay.
- Apple Developer account ($99/yr) → TestFlight. Beta users install from a
  link; no App Store review yet.
- iOS only for the first units.

---

## Step 9 — First beta units (given, not sold)

Pre-ship checklist, every unit:
- [ ] Flashed from the script on this branch, **not** cloned from the dev rig
- [ ] Serial written to `/etc/campfire/identity`; hotspot name shows the serial
- [ ] Unbox → hotspot → WiFi → AirPlay → pair speaker → camping → battery
      drain → unplug mid-song → clean boot
- [ ] One-page setup card in the box; "Prototype — evaluation unit, not for
      sale" label on the bottom
- [ ] Pull-update script works (`campfire-update` fetches the latest release
      from GitHub and reboots)

---

## Step 10 — Selling

1. **LLC** (before any money). Product liability insurance (lithium product).
2. **Lab**: pick an FCC lab (NTS, Element, UL, SGS, or a smaller regional
   lab). First-call questions: (a) Part 15B + SDoC on a product that contains
   only modular radios (Pi 4B 2ABCB-RPI4B, Ezurio SQGBT850); (b) how they
   handle the co-location evaluation for 1–3 BT modules transmitting with the
   Pi's WiFi; (c) test both SKUs or test EXTENDED as worst case. Budget
   $4–10k, 2–4 weeks.
3. Send 2 production-representative units + schematics (`hardware/`), the
   BOM with FCC IDs, label artwork, a draft user guide with the Part 15
   statement, and a way to hold the worst-case mode (hotspot + 3 BT + built-in
   at full volume + charging).
4. **Labels**: "Contains FCC ID: 2ABCB-RPI4B" and "Contains FCC ID: SQGBT850".
5. **Bluetooth SIG** declaration if the word Bluetooth or the logo appears in
   marketing (~$2,500 small-company rate; verify).
6. **Cells**: brand 18650s with UN38.3 summaries; keep the supplier's PDF.
7. Privacy policy ("we collect nothing") and terms; app store listing when
   you outgrow TestFlight.
8. **Phase 2** (`hardware/README.md`): the CM4 carrier is the cost-down once
   you are selling more than you can hand-build. It is a re-test when it ships.

---

## What I need from you at each step

- Step 1: order; tell me what arrived.
- Step 2: flash fresh SD cards and paste command output; I cannot reach the Pi.
- Steps 4–5: hands: solder, print, assemble. Photos help.
- Steps 6–7: ears and legs: range tests and listening; the REW plots.
- Step 8: Apple Developer account, TestFlight invites.
- Step 10: the LLC filing, the lab engagement, the policies.
