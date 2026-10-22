# Enclosure — from the OpenSCAD model to a printed box

`campfire-enclosure.scad` is the whole box as code: a two-bay base (sealed
acoustic chamber in front, vented electronics bay behind) and a flat lid. Every
dimension is a named parameter at the top of the file. Layout drawing:
`../enclosure-layout.svg`.

## 1. Measure before you export

The two front openings must match the parts that arrived. With the calipers:

| Parameter | What to measure | Datasheet default |
|---|---|---|
| `drv_cut` | Peerless TC6FD00-04: diameter of the part that passes through the baffle | 50.0 mm |
| `drv_bc` | distance between opposite mounting holes, centre to centre | not published — set from your measurement (default 52) |
| `pr_cut` | Dayton ND65-PR: through-baffle diameter | 52.1 mm |
| `pr_bc` | opposite mounting holes, centre to centre | not published — set from your measurement (default 58) |
| `btn_d` | the button's thread diameter + 0.3 mm | 12.7 |
| `usbc_w`, `usbc_h`, `usbc_sp` | the panel-mount USB-C extension's slot and screw spacing | 10.5 × 6, 20 |

Add 0.3–0.5 mm to any hole that must slip over a part; PETG shrinks a little.

## 2. Export the STL

**On your Mac:**
```bash
open -a OpenSCAD hardware/phase1/enclosure/campfire-enclosure.scad
```
In OpenSCAD: edit the parameters at the top → set `part = "base";` → **F6**
(render, takes a minute) → **File › Export › Export as STL** →
`campfire-base.stl`. Repeat with `part = "lid";` → `campfire-lid.stl`.

Or from the terminal, no GUI:

**On your Mac:**
```bash
cd hardware/phase1/enclosure
openscad -o campfire-base.stl -D 'part="base"' campfire-enclosure.scad
openscad -o campfire-lid.stl  -D 'part="lid"'  campfire-enclosure.scad
```

The console prints the chamber volume and the bay size when it renders.

## 3. Print it

Base: 216 × 146 × 70 mm, printed open side up, no supports needed (the round
holes in the walls have a 45° roof so they print clean). Lid: flat, 3 mm.

| Setting | Value |
|---|---|
| Material | PETG (or ABS/ASA) — PLA softens in a hot car |
| Layer height | 0.2 mm |
| Perimeters | 4 (walls are 3 mm; this makes them solid and airtight) |
| Infill | 30 % base, 100 % for the lid |
| Bed | ≥ 220 × 150 mm. Prusa MK3/MK4, Bambu A1/P1/X1 fit; an Ender 3 is at its limit — set `L = 210` if needed |
| Time | ~10–14 h base, ~2 h lid |

**No printer:** upload the two STLs to [JLC3DP](https://jlc3dp.com),
[PCBWay](https://www.pcbway.com/rapid-prototyping/), or
[Craftcloud](https://craftcloud3d.com). Choose **PETG (FDM)** for the cheapest
(~$15–25 per base) or **PA12 nylon (MJF/SLS)** for the most rigid and airtight
(~$30–45). Quantity 2 of each file. 7–10 days.

## 4. Parts the box needs that are not in the main shopping list

| Item | Qty | Why |
|---|---|---|
| USB-C panel-mount extension, female panel → male, 30 cm | 1 per unit | Brings the UPS HAT's charge port to the rear panel |
| 5 mm LED panel-mount holder (clip) | 1 per unit | Or a dab of hot glue |
| M3 × 10 self-tapping screws | 4 per unit | Lid into the corner posts |
| M3 × 12 screws + nuts (or self-tapping) | 8 per unit | Driver and passive radiator to the front face |
| Foam gasket tape, 3 mm | already ordered | Around the driver, the radiator, and along the top of the walls and divider under the lid |

## 5. Assembly order

1. Driver and passive radiator into the front face with gasket tape; solder the
   speaker leads first and feed them through the divider grommet; seal the
   grommet with hot glue.
2. UPS HAT onto the four floor posts (M2.5), cells in, Pi on top with the
   standoff kit, heatsink on the SoC.
3. MAX98357A stuck to the divider wall on the bay side; jumpers to the header.
4. Button, LED and USB-C extension into the rear panel; wire to the header.
5. Radios: A straight into a black USB port at the front of the stack; B and C
   on extensions to the rear corners, held with double-sided tape.
6. Foam tape along the top of all walls and the divider; lid on, four screws.

## Changing the design

Everything is a parameter. Common edits: `chamber` (acoustic volume — the
console prints it), `pi_x` / `pi_y` (move the stack), `btn_x` / `led_x` /
`usbc_x` (rear panel layout), `L` (shrink for a smaller bed). After any edit,
re-run step 2.
