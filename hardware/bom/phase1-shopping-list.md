# Phase 1 shopping list — one STANDARD + one EXTENDED (Pi 4B build)

Prices are 2026-10 list prices at the named vendor; expect ±20 %. Quantities
are for **one unit of each SKU**. Items marked *have* are already on the bench.

## Order today

| Item | STANDARD | EXTENDED | Unit $ | Where / part | Notes |
|---|---|---|---|---|---|
| Raspberry Pi 4 Model B **1 GB** | 1 | 1 | $35 | PiShop.us `raspberry-pi-4-model-b-1gb`, Adafruit, CanaKit, Micro Center | 2 GB ($45) if 1 GB is out. FCC ID 2ABCB-RPI4B (modular) |
| microSD 32 GB A1 (SanDisk Extreme / Samsung EVO) | 1 | 1 | $8 | Amazon | One spare for fresh-flash testing |
| Pi 4 heatsink set (aluminium, adhesive) | 1 | 1 | $3 | Amazon | Passive cooling in the bay |
| **Ezurio BT851** Bluetooth USB adapter | 1 | 3 | $17 | Digi-Key P/N `BT851` (product 8251358), Mouser | Modular FCC ID SQGBT850; generic Linux `btusb` |
| USB-A extension, 20 cm, male→female | 0 | 3 | $3 | Amazon (3-pack) | Places radios B and C at the rear corners, A at the front |
| 2-inch full-range driver, 4 Ω (Dayton Audio DMA58-4 or Peerless TC6FD00-04) | 1 | 1 | $9 | Parts Express | 4 Ω matches the MAX98357A's 3 W |
| 2.5-inch passive radiator (Dayton Audio ND65-PR) | 1 | 1 | $7 | Parts Express | Bass below the driver's reach |
| MAX98357A I²S amp breakout | 1 | 1 | *have* | (Adafruit 3006 if more are needed, $6) | 2-pack already on hand |
| UPS board for Pi 4, **2 × 18650**, 5 V ≥ 2.5 A out, charges while running, I²C gauge (Waveshare "UPS HAT" for Raspberry Pi, INA219) | 1 | 1 | $28 | Amazon / waveshare.com | Check the listing says ≥ 2.5 A output and lists an I²C current/voltage monitor |
| 18650 cells, **flat top, 3500 mAh** (Samsung 35E / LG MJ1 / Molicel M35A) | 2 | 2 | $5 | 18650BatteryStore, IMR Batteries, Liion Wholesale | Brand cells carry UN38.3; keep the datasheet |
| Momentary push button, 12 mm panel mount | 1 | 1 | $2 | Amazon (5-pack) | Camping toggle / factory reset |
| RGB LED 5 mm common cathode, diffused | 1 | 1 | $1 | Amazon (pack) | |
| 330 Ω resistors | 3 | 3 | — | Amazon (kit) | LED series resistors |
| Female-female Dupont jumpers, 10–20 cm | 1 pack | — | $5 | Amazon | Shared |
| Speaker wire 22 AWG, foam gasket tape 3 mm | 1 | — | $8 | Amazon | Shared |
| M2.5 standoff + screw kit (Pi stack) | 1 | 1 | $8 | Amazon | |
| USB-A → USB-C cable, 15 cm | 1 | 1 | $3 | Amazon | Only if the UPS board does not feed the header |
| Enclosure: 3D print (PETG, 3 mm walls) | 1 | 1 | $25 | Home printer (~$4 filament) or JLC3DP / Craftcloud | Project box ($5, Amazon) for the bench until the print arrives |

**Shared tools and test gear (once):**

| Item | Unit $ | Where | Notes |
|---|---|---|---|
| Dayton Audio iMM-6 measurement mic | $25 | Parts Express / Amazon | With REW (free) for Step 7 |
| Digital calipers | $12 | Amazon | Enclosure design |
| USB inline power meter | *have* | | E6 |

**Estimated totals:** STANDARD ≈ $175 · EXTENDED ≈ $220 · shared ≈ $60 →
**≈ $455 for both prototypes and the tools.** (The plan's per-unit parts cost
of $84–129 is lower because it uses a $14 charge board instead of the $28 UPS
HAT and a home-printed box; the HAT is worth it for the first two units
because its gauge is what the safe-shutdown service reads.)

## Phase 2 samples (order later, before the carrier design)

| Item | Qty | Unit $ | Where | Notes |
|---|---|---|---|---|
| Ezurio BT850-ST (external-antenna pad) | 3 | $11 | Digi-Key `BT850-ST-T/R` (8135951) | Solder-down version of the BT851 for the carrier |
| Ezurio BT850-SA (chip antenna) | 1 | $10.85 | Digi-Key 8251356 | Compare against -ST + pigtail |
| Fn-Link 6221E-UUC (RTL8821CU) | 3 | $4 | Fn-Link direct / made-in-china | FCC ID 2AATL-6221EUUC; needs a breakout; cheapest certified radio at volume |
| Raspberry Pi CM4 Lite 1 GB wireless | 1 | $30 | PiShop / Digi-Key | For the carrier bring-up |
| 2.4 GHz FPC antenna + MHF/u.FL pigtail | 3 | $1.50 | Amazon / Digi-Key | Must match the BT850-ST grant's antenna list |
| MAX17048 breakout | 1 | $6 | Adafruit / SparkFun | Fuel gauge for the carrier |

## Not needed

- Wall adapter in the box: the user's phone charger (USB-C) charges the UPS
  board. If you ship one, buy a listed off-the-shelf adapter; never build one.
- USB hub: the Pi 4B has four ports.
- Fan, case, active cooler: the enclosure is the case; the bay is vented.
