# Campfire carrier board — requirements (rev A, 2026-11-17)

The custom PCB that replaces the Pi 4B + UPS HAT + plug-in radios of the Phase 1
bench unit. Derived from the working bench unit and the measurements in
`bridge/diagnostics/EXPERIMENTS.md`, not invented. Every requirement has an ID so
the EVT bring-up (`#27f`) can tick it off. **Open decisions are in §12; nothing
in the schematic may depend on an undecided row.**

Companion files: block diagram, pin map and power tree in `hardware/README.md`;
power numbers from `hardware/scripts/power_budget.py`; acoustic tuning from
`hardware/acoustics/box_model.py`; Phase 1 wiring (what the carrier must
reproduce) in `hardware/phase1/pinout.md`.

Authority order when anything here disagrees with something else: **measured
hardware › vendor datasheet / reference design › this file › anything generated.**

---

## 1. Scope

| | |
|---|---|
| Product | Two lines × two sizes, **one PCB, four population variants** (decided 2026-11-17): **Campfire Bridge** Base / Extended (1 / 3 radios, no built-in: amp block DNP) and **Campfire Speaker** Base / Extended (1 / 3 radios + Go-class built-in). LITE later. |
| Function | AirPlay 2 receiver → 1 or 3 Bluetooth speakers in sync, plus the built-in on Speaker SKUs; home / camping modes; battery powered |
| Why one board | Pi 4B acceptance (2026-11-17): CPU is the AirPlay-receive + mixing path; the built-in output and the radios each cost ~0–2 points. Leaving the speaker off changes the box and the pack, not the compute. |
| Not in scope | LITE (Flip-class built-in, TAS5805M, 3S) — separate board later. Cast / Android. Backend. |
| Software | Unchanged from the bench unit: Raspberry Pi OS Lite 64-bit image built from `bridge/setup-pi.sh`, bridge API, `campfire-panel.py` |

## 2. System block

```
USB-C 5 V ─► charger + power path ─► SYS ─► boost 5.1 V ─► CM4 · MAX98357A (Speaker SKUs) · LED
                 │                     │        ▲ EN                └─► 3.3 V reg ─► 3× Murata 1MW radios
             1S pack (1–3 × 18650) ── MAX17048 ─┼── I²C ─► CM4
                                               latch ◄── button / CM4 KILL (GPIO27)
CM4 ── UART3 / UART4 / UART0 (HCI, CTS/RTS) ─► radio A / B / C ─► u.FL ─► antennas at N / SE / SW
CM4 ── I²S ─► MAX98357A ─► 2-inch driver (+ passive radiator, acoustic only)   [DNP on Bridge SKUs]
CM4 ── GPIO ─► RGB LED · button in · KILL out
CM4 WiFi ─► U.FL ─► official CM4 antenna kit
```

## 3. Compute — C

| ID | Requirement | Verify by |
|---|---|---|
| C-1 | Raspberry Pi **Compute Module 4 Lite, 1 GB, wireless** (CM4001000). Same BCM2711 as the bench Pi 4B; FCC ID 2ABCB-RPICM4 (modular). Production commitment to at least January 2034 (verify on the product page). | part number on the BOM |
| C-2 | 2 × Hirose **DF40C-100DS-0.4V(51)** receptacles; footprint and keep-outs from the CM4 datasheet. Start from Raspberry Pi's CM4IO KiCad files (`datasheets.raspberrypi.org/cm4io/CM4IO-KiCAD.zip`; the Oct-2025 revision may need a KiCad nightly — check against the installed version). | DRC against the datasheet drawing |
| C-3 | **microSD socket** on the carrier (Lite has no eMMC). SD lines per the CM4 datasheet. Flashing = write the card on the Mac; no `rpiboot` path needed for EVT. | boots from a card flashed on the Mac |
| C-4 | USB 2.0 host: **one spare port on a 4-pin header** (service dongle, future radio D). No hub — the radios are UART (R-1/R-7, decided 2026-11-17). Host mode enabled in `config.txt` (`dwc2` host on CM4). | a dongle on the header enumerates |
| C-5 | **Onboard Bluetooth disabled in hardware**: `BT_nDisable` → GND. (The "built-in BT disabled" decision, made permanent.) | `hciconfig` lists only the three UART radios (bus `uart`, none of them the CM4's own) |
| C-6 | WiFi antenna: **U.FL to the official CM4 antenna kit** (inside the grant), selected with `dtparam=ant2`. The onboard antenna is a fallback only: the pack and the driver magnet sit near it. | 5 GHz association at home; hotspot visible in camping |
| C-7 | Debug: **console on UART5 (GPIO12/13) header**, 3.3 V — UART0 is radio C (R-7); `nRPIBOOT` test pad, `GLOBAL_EN` / `RUN` test pads. | serial console on first power |
| C-8 | Thermal: the bay is vented; a heatsink pad area over the SoC, no fan. Target SoC < 70 °C at the camping worst case in a 35 °C room. | `vcgencmd measure_temp` during T11-class run on the EVT |

## 4. Power — P

Numbers from `power_budget.py` (defaults). **ESTIMATE until T13/T14 on the Pi 4B and then the EVT replace them.**

| State | 5 V rail | from pack | runtime 1S2P / 1S3P (3500 mAh) |
|---|---|---|---|
| idle | ≈ 2.3 W | ≈ 2.6 W | ≈ 8.8 / 13 h |
| EXTENDED playing | ≈ 3.8 W | ≈ 4.3 W | ≈ 5.2 / 7.8 h |
| EXTENDED camping, built-in full | ≈ 7.2 W | ≈ 8.1 W | ≈ 2.8 / 4.2 h |
| boot peak | ≈ 6.5 W | — | — |

| ID | Requirement | Verify by |
|---|---|---|
| P-1 | Input: **USB-C receptacle, USB 2.0 pinout, 5 V only** (no PD negotiation). Rd 5.1 kΩ on CC1 and CC2. Reverse-polarity and ESD protection on VBUS/CC/D±. | 5 V 3 A and 5 V 1.5 A sources both work |
| P-2 | **Input current limit** default **1.5 A**; **3 A only when a 3 A Rp is detected on CC** (see D-2). The product must not pull more than the source advertises. | measured input current with a 1.5 A source stays ≤ 1.5 A |
| P-3 | Charger: **1S Li-ion, power path / NVDC**, charges while the system runs at the EXTENDED worst case, JEITA/NTC thermistor input, charge termination, 4.2 V. Candidate: **BQ25616 / BQ25619** (I²C, input limit to 3.2 A); fallback **BQ24074** (standalone, 1.5 A ceiling). Follow the TI reference layout. | T14-class test on the EVT: `get_throttled` 0x0, charge current logged |
| P-4 | Pack: **1S, bought protected pack with UN38.3** and the vendor's protection-board datasheet; JST-XH 3-pin (B+, NTC, B−). The board is 1S regardless of capacity; **capacity is per SKU** from the runtime target: `power_budget.py` gives ≈ 4.4 Wh per hour of Extended playing (Speaker) and ≈ 3.9 Wh/h for a Bridge (no amp). One 18650 (12.6 Wh) ≈ 3 h; 1S2P ≈ 6 h; 1S3P ≈ 8–9 h; a 5000 mAh 1S pouch (18.5 Wh) ≈ 4–5 h. Defaults: Bridge = 1S2P 18650 or a 5000 mAh pouch; Speaker = 1S3P. Runtime is **estimated, not drained** (user, 2026-11-17); T14 charge-while-playing still runs. | pack datasheet in `hardware/carrier/datasheets/` |
| P-5 | Fuel gauge: **MAX17048** on I²C1 (0x36), ALRT to a GPIO. Safe-shutdown service reads it; shutdown threshold 10 % SoC (adjustable). | `i2cdetect -y 1` shows 0x36; T13 clean shutdown |
| P-6 | Boost: **5.1 V ± 3 %, ≥ 2.0 A continuous, ≥ 3 A for 1 s** (boot), input 3.0–4.4 V; **TPS61088 class**. Output ripple < 50 mV pp at the CM4 input. EN from the latch. | scope at the CM4 5 V pin, idle and boot |
| P-7 | **Power latch**: **LTC2954-1** class pushbutton controller. Press = on; hold ≥ 3 s = hard off; **KILL from CM4 GPIO27** via `dtoverlay=gpio-poweroff,gpiopin=27` after `poweroff` → **zero draw** (< 50 µA from the pack, gauge quiescent excepted). INT to a GPIO for a clean-shutdown request on short press. | pack current with the board off |
| P-8 | Rails: **5 V bus** → CM4, amp (Speaker SKUs), LED. **Dedicated 3.3 V regulator (≥ 600 mA) from the 5 V bus → the three 1MW radios** (VBAT + VDDIO per the datasheet; three radios transmitting can exceed what the CM4's own 3V3 output is rated to lend). CM4 3V3 / 1V8 outputs: pull-ups and the gauge only. | power_budget.py rail table vs measured |
| P-9 | Protection: resettable fuse or eFuse on VBUS; TVS on VBUS and the pack input; the pack's own protection board for OV/UV/OC. | datasheet review |
| P-10 | **Resolves the bench GPIO3 conflict**: the power button goes to the latch, not to GPIO3; I²C1 keeps GPIO2/3 for the gauge. Wake = press the button (latch turns the boost on). | T10b-class test passes on the EVT without a workaround |

## 5. Radios — R

| ID | Requirement | Verify by |
|---|---|---|
| R-1 | **DECIDED 2026-11-17 (D-8 = option A): Murata Type 1MW, part LBEE5HY1MW**, CYW43455, 7.9 × 7.3 × 1.1 mm, **FCC ID VPYLBEE5HY1MW, Single Modular Approval** (OEM installation). Bluetooth over **UART HCI** to BlueZ — the same chip family and the same Linux driver/firmware path (`hci_uart` / `hci_bcm`, `BCM4345C0.hcd`) as the Pi 4's own radio, so the bridge software does not change. The module's WiFi half (SDIO) is left unconnected and unpowered. ×3 on Extended, ×1 + two DNP footprints on Base. Rejected: Ezurio BT850 (user), ESP32/transmitter modules (bench showed Bluetooth costs the CM4 ~2 points — no compute to win), AW-CM256SM (its FCC IDs are host products, not a clean module grant). | three `hciX` adapters, bus `uart`, each a 43455 |
| R-7 | **UART assignment (draft — finalise against the CM4 datasheet pin table in Step 3).** BT HCI at 3 Mbaud needs CTS/RTS, so only UARTs with flow-control pins free of I²S/I²C can carry a radio: **radio A = UART3 (GPIO4–7)**, **radio B = UART4 (GPIO8–11)**, **radio C = UART0 (GPIO14–17)**. Console moves to **UART5 (GPIO12/13)**; the **LED moves off GPIO12/13/16** to free GPIOs (software PWM via lgpio works on any pin); one **BT_REG_ON** GPIO per radio; **LPO 32.768 kHz** per the 1MW datasheet (GPCLK or a crystal — check whether required). Firmware: a device-tree overlay adding an `hci_bcm` child to each UART with its `shutdown-gpios`. | each radio enumerates after a cold boot without hand steps |
| R-2 | **Antenna from the chosen module's grant list only**, 50 Ω, via u.FL/MHF or the module's own trace antenna per its integration guide. (The Ezurio antenna names recorded earlier no longer apply.) | BOM lists the antenna MPN and the integration-guide page |
| R-3 | **One antenna per radio at the enclosure extremes (N / SE / SW)**, on pigtails; antennas ≥ 20 mm from any metal, from the CM4 antenna, and from each other as far as the box allows. Modules may sit near the hub; the antenna position is what matters. | T12-class range test on the EVT: 15 ft with people in between, 30 min, no dropouts |
| R-4 | Radio USB lines: 90 Ω differential, length-matched, no vias where avoidable, away from the boost inductor and the amp outputs. | DRC net classes; eye not required at full speed |
| R-5 | **Co-location**: the SQGBT850 grant carries the standard "must not be co-located or operate in conjunction with any other antenna or transmitter" condition. Four transmitters (CM4 WiFi + 3 BT) in one host therefore need a simultaneous-transmission evaluation (RF exposure is a calculation at these powers; the lab decides the form). **Ask Ezurio and the lab before layout** whether a permissive change exists or how previous hosts handled it. This is the largest certification-scope risk. | written answer filed in `hardware/carrier/datasheets/` |
| R-6 | Cost-down evaluation only, not designed in: **Fn-Link 6221E-UUC** (RTL8821CU, 2AATL-6221EUUC, $4) on a breakout against the BT850-ST on the bench. | note in EXPERIMENTS.md |

## 6. USB hub — H (DROPPED 2026-11-17)

The hub existed only to carry USB radios. With UART radios (D-8) it goes; the
CM4's single USB 2.0 port becomes the spare service header (C-4). One IC, one
crystal and ~$1.50 off the BOM; one fewer thing to enumerate at boot.

## 7. Audio — A

| ID | Requirement | Verify by |
|---|---|---|
| A-1 | **MAX98357A** on 5 V, I²S from CM4 GPIO18 BCLK / GPIO19 LRCLK / GPIO21 DOUT (same as the bench). `SD_MODE` strapped for **(L+R)/2 mono**; `GAIN_SLOT` for **9 dB** (bench setting) — both on 0 Ω jumpers so S8 tuning can change them. | `pactl list sinks` shows the I²S sink; tone from the driver |
| A-2 | Output: **ferrite beads + caps on OUT+/OUT− per the MAX98357A EMI guidance**; 2-pin JST-PH to the driver; leads twisted. | pre-compliance scan |
| A-3 | Driver: **Peerless TC6FD00-04** (4 Ω, 2-inch) or Dayton DMA58-4; passive radiator **Dayton ND65-PR**; sealed chamber **0.4–0.6 L net** (the Phase 1 box is ~0.6 L gross). `box_model.py`: PR tuning **110 Hz at 0.4 L, 99 Hz at 0.6 L**, PR notch at 73 Hz, −10 dB point 113 Hz → 101 Hz as the volume grows, so the manual's "−10 dB ≤ 110 Hz" target wants the larger chamber. Excursion is **not** the limit with the PR fitted: the driver reaches Xmax (2 mm) only above 4.2 V RMS, beyond the MAX98357A's ~3.5 V clip — the S8 limiter guards amp clipping, plus a high-pass near 60 Hz where the PR no longer helps. Confirm with REW. | REW near-field + impedance sweep (manual Step 7) |
| A-4 | Amp enable follows the party state via `SD_MODE` on a GPIO **only if** pop/click at power-on is audible on the EVT; otherwise strapped. | listen at boot |

## 8. User interface — U

| ID | Requirement | Verify by |
|---|---|---|
| U-1 | **Power button** (panel, momentary) → latch. Short press = clean shutdown request (INT → GPIO → `campfire-panel.py`), press when off = power on, hold = hard off. | T10-class test |
| U-2 | **Mute button** (panel, momentary) → **GPIO26**, pull-up, RC debounce; same behaviour as the bench (`campfire-panel.py`). | T18 |
| U-3 | **RGB LED** on **GPIO16 R / GPIO13 G (PWM1) / GPIO12 B (PWM0)**, **active-low drive** (common-anode, like the bench part) through series resistors; light pipe or panel-mount to the rear face. States unchanged: pulsing blue / white / orange / red. | T19 |
| U-4 | No factory-reset button, no pairing button (decided 2026-11-16). Factory reset = app. | — |

## 9. Connectors, test, manufacturing — M

| ID | Requirement |
|---|---|
| M-1 | **4-layer, ~100 × 80 mm**, 1.6 mm, JLCPCB/PCBWay standard stackup (sig / GND / PWR / sig), ENIG for the DF40 pads. Mounting: 4 × M3 (or M2.5) holes, positions exported for the enclosure bosses. |
| M-2 | Connectors on the **rear edge**: USB-C; button and LED on 2-pin / 4-pin headers to the panel (or board-mounted with a light pipe — D-4). Pack JST-XH 3-pin, speaker JST-PH 2-pin, u.FL ×3 + CM4 antenna U.FL, spare USB header, UART header. |
| M-3 | **Test points** (1 mm pads, labelled): VBUS, SYS, VBAT, 5V, 3V3 (radio rail), 1V8, SDA/SCL, BCLK/LRCLK/DOUT, UART3/4/0 TX/RX/CTS/RTS, BT_REG_ON ×3, GPIO26, KILL, INT, PG, GND ×4. |
| M-4 | Every placed part has an **LCSC** field; parts not on LCSC (DF40 connectors, BT850-ST, CM4) are marked `consigned` in the BOM `Note` field. Exports via `hardware/scripts/export_board.sh`. |
| M-5 | Population variants: one schematic, four variants — **Bridge-Base, Bridge-Extended, Speaker-Base, Speaker-Extended**. Base: DNP radio B/C + antennas. Bridge: DNP the amp block (MAX98357A, its passives, ferrites, speaker connector). **KiCad 10 (installed) has native design variants**: define the four by name, mark DNP per variant, and `export_board.sh <rev> <variant>` exports that variant's BOM, pick-and-place and STEP; gerbers are shared. |
| M-6 | Silkscreen: board name, rev, date code, "Contains FCC ID: 2ABCB-RPICM4" + "SQGBT850" (labels also on the enclosure). |

## 10. Certification constraints — F

| ID | Constraint |
|---|---|
| F-1 | All radios modular (C-1, R-1) → product needs **Part 15B + SDoC**; no intentional-radiator test if every grant condition is met (antenna list R-2, integration instructions, labels). |
| F-2 | **R-5 co-location** answered in writing before layout. |
| F-3 | Switchers (boost, charger) are unintentional radiators: follow the reference layouts, keep loops tight, shield-can footprint optional on the boost. One near-field pre-scan day before the lab (budget $1–2k). |
| F-4 | Lab receives: 2–3 EVT units, schematics + layout PDF, BOM with FCC IDs and grant types, antenna datasheets, label art, user-guide Part 15 statement, a test mode holding **hotspot + 3 BT + built-in full + charging**. |
| F-5 | Pack ships with UN38.3; pack-level IEC 62133-2 from the vendor. Bluetooth SIG declaration (~$2.5k) if the Bluetooth name/logo is used. |

## 11. Firmware interface (what the image must set for this board)

```
# /boot/firmware/config.txt — carrier rev A
dtparam=i2s=on
dtoverlay=max98357a
dtparam=i2c_arm=on
dtoverlay=dwc2,dr_mode=host
dtparam=ant2                          # external CM4 antenna kit (C-6)
dtoverlay=gpio-poweroff,gpiopin=27    # assert KILL after poweroff (P-7)
# the bench's dtoverlay=gpio-shutdown on GPIO3 is REMOVED on the carrier (P-10);
# the latch INT line on a GPIO is handled by campfire-panel.py instead.
```

## 12. Open decisions — D (close before the schematic depends on them)

| ID | Decision | Default if nothing is said | Decides by |
|---|---|---|---|
| D-1 | Charger: BQ25616/BQ25619 (I²C, 3.2 A input) vs BQ24074 (standalone, 1.5 A) | **BQ25616-class.** `power_budget.py`: with a 1.5 A input the pack charges at ~0.6 A while EXTENDED plays (≈ 12 h to full); with 3 A, ~2 A (≈ 3.5 h). | 2026-11-24 |
| D-2 | USB-C 3 A detection: Rd-only (fixed 1.5 A) vs CC detector (TUSB320 class) vs PD sink controller (STUSB4500) | **TUSB320-class CC detector**, current advertisement → charger input limit over I²C. Rd-only is the fallback if BOM/complexity bites. | with D-1 |
| D-3 | Pack: 1S2P vs 1S3P | **Bay fits 3; EVT ships 2.** | enclosure Step 5 |
| D-4 | Button/LED: panel-mount on wires vs board-mounted + light pipe | **Panel-mount on headers** for EVT (matches the bench; no mechanical coupling to the board). | with M-2 |
| D-5 | ~~Hub: USB2514B vs FE1.1s~~ **CLOSED 2026-11-17: no hub** (UART radios). | — | done |
| D-6 | Radio supply: confirm BT850-ST VBUS 5 V vs 3.3 V from the datasheet | — | before schematic |
| D-7 | R-5 co-location: answer from the chosen module's vendor + lab | — | before layout |
| D-8 | ~~Radio category A / B / C~~ **CLOSED 2026-11-17: A, Murata Type 1MW (R-1).** Bluetooth measured at ~2 points of one core, so C had no compute case; the user chose A. | — | done |
| D-11 | **Validate the UART-HCI path for free before the carrier exists**: the Pi 4's own radio is a 43455 on a UART. Unplug the dongles, drop `dtoverlay=disable-bt`, reboot, pair the JBL on the onboard radio, play (bench test T24). Proves driver, firmware and BlueZ behaviour for the exact chip family. | do it before Step 3's radio sheet | this week |
| D-9 | **Bridge enclosure**: how small? Board ~100 × 80 mm + pack sets the floor; USB-C, button, LED, three antenna pockets. | ~110 × 90 × 35 mm, printed for EVT | Step 5 |
| D-10 | **Bridge pack**: 1S2P 18650 (~6 h) vs 5000 mAh pouch (~4–5 h, thinner box) | 1S2P 18650 for EVT (same cells as the Speaker, one pack SKU) | Step 2 |

## 13. Inputs still owed by the bench unit (Step 1)

| Bench test | Feeds |
|---|---|
| T12 range (BT851) | R-1/R-3 confidence; BT850-ST is the same radio |
| T13 runtime, T14 charge-while-playing | P-3 sizing, `power_budget.py` MEASURED rows |
| T15 boot time, T16 CPU headroom | C-1 headroom on the same silicon |
| T21 fresh-card reproducibility | Step 7 image work starts from a known-good script |
