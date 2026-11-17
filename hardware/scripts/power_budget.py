#!/usr/bin/env python3
"""Carrier power budget: 5 V rail per state, battery current, runtime, charger
headroom, boost sizing. Pure Python, no dependencies.

Every load has a confidence tag. MEASURED rows come from
bridge/diagnostics/EXPERIMENTS.md (E6, Pi 5 dev rig, 2026-10-15); ESTIMATE rows
must be replaced by the Pi 4B bench numbers (docs/bench-tests.md T13/T14) and
then by EVT measurements. Until then the runtime column is a forecast, not a spec.

Usage
  python3 power_budget.py
  python3 power_budget.py --cm4-idle 2.4 --cells 3 --input-a 3.0
  python3 power_budget.py --json            # machine-readable, for requirements.md tables
"""
from __future__ import annotations

import argparse
import json
import sys

# ---------------------------------------------------------------------------
# Loads on the 5 V rail, watts. (value, confidence, note)
# ---------------------------------------------------------------------------
LOADS = {
    "cm4_idle":        (2.00, "ESTIMATE", "CM4 Lite 1 GB wireless, WiFi associated, BT disabled, idle. Pi 5 measured 3.85 W (E6); Pi 4B community figure ~2.7 W; CM4 ~2.0 W. Replace with T13."),
    "cm4_audio_delta": (0.40, "ESTIMATE", "Decode + N× SBC encode + mixing. Pi 5 measured +0.31 W for 3 BT + built-in (E6, 8 % of draw)."),
    "cm4_ap_delta":    (0.30, "ESTIMATE", "hostapd AP beaconing + higher WiFi Tx duty in camping mode. E6 camping row was suspect; re-measure."),
    "bt_module_each":  (0.25, "ESTIMATE", "BT850-ST streaming A2DP, per module (~50 mA at 5 V). Check the BT85x datasheet current table."),
    "usb_hub":         (0.15, "DATASHEET", "USB2514B class 4-port hub + its LDO, ~30 mA at 3.3 V plus upstream."),
    "amp_quiescent":   (0.02, "DATASHEET", "MAX98357A idle."),
    "amp_music":       (0.45, "ESTIMATE", "MAX98357A at party volume: ~1/8 of 3 W max into 4 Ω, ~85 % efficient."),
    "amp_full":        (3.50, "DATASHEET", "MAX98357A full-scale sine into 4 Ω at 5 V: ~3 W out, ~85 % efficient. Thermal/PSU worst case, not a listening level."),
    "led":             (0.06, "DATASHEET", "RGB LED, one or two colours on."),
    "gauge_latch_misc":(0.03, "DATASHEET", "MAX17048 + LTC2954 + pull-ups."),
    "boot_peak":       (6.50, "ESTIMATE", "Boot spike with hub + 3 modules enumerating. Pi 5 measured 5.57 W (E6)."),
}

STATES = {
    # name: (list of load keys, multiplicity dict)
    "idle (home WiFi, nothing playing)":        (["cm4_idle", "usb_hub", "amp_quiescent", "led", "gauge_latch_misc"], {}),
    "STANDARD playing (1 BT + built-in)":        (["cm4_idle", "cm4_audio_delta", "usb_hub", "amp_music", "led", "gauge_latch_misc", "bt_module_each"], {"bt_module_each": 1}),
    "EXTENDED playing (3 BT + built-in)":        (["cm4_idle", "cm4_audio_delta", "usb_hub", "amp_music", "led", "gauge_latch_misc", "bt_module_each"], {"bt_module_each": 3}),
    "EXTENDED camping, built-in at full":        (["cm4_idle", "cm4_audio_delta", "cm4_ap_delta", "usb_hub", "amp_full", "led", "gauge_latch_misc", "bt_module_each"], {"bt_module_each": 3}),
    "boot peak":                                 (["boot_peak"], {}),
}


def state_power(keys, mult, loads):
    total = 0.0
    worst_conf = "MEASURED"
    rank = {"MEASURED": 0, "DATASHEET": 1, "ESTIMATE": 2}
    for k in keys:
        w, conf, _ = loads[k]
        total += w * mult.get(k, 1)
        if rank[conf] > rank[worst_conf]:
            worst_conf = conf
    return total, worst_conf


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cm4-idle", type=float, help="override CM4 idle watts (from T13 or EVT measurement)")
    ap.add_argument("--bt-each", type=float, help="override per-module watts")
    ap.add_argument("--cells", type=int, default=2, help="18650 cells in the 1S pack (2 or 3)")
    ap.add_argument("--cell-mah", type=float, default=3500.0)
    ap.add_argument("--v-nom", type=float, default=3.6, help="pack nominal volts")
    ap.add_argument("--v-min", type=float, default=3.0, help="boost cut-off / shutdown volts")
    ap.add_argument("--usable", type=float, default=0.90, help="fraction of capacity used before safe shutdown")
    ap.add_argument("--boost-eff", type=float, default=0.88)
    ap.add_argument("--path-eff", type=float, default=0.95, help="charger power-path efficiency, USB in → SYS")
    ap.add_argument("--charge-eff", type=float, default=0.85, help="charger efficiency into the cell")
    ap.add_argument("--input-a", type=float, nargs="+", default=[1.5, 3.0], help="USB-C input current limit(s) to evaluate at 5 V")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    loads = dict(LOADS)
    if args.cm4_idle is not None:
        loads["cm4_idle"] = (args.cm4_idle, "MEASURED", "override from CLI")
    if args.bt_each is not None:
        loads["bt_module_each"] = (args.bt_each, "MEASURED", "override from CLI")

    pack_wh = args.cells * args.cell_mah / 1000.0 * args.v_nom
    usable_wh = pack_wh * args.usable

    results = []
    for name, (keys, mult) in STATES.items():
        p5, conf = state_power(keys, mult, loads)
        p_batt = p5 / args.boost_eff
        i_batt_nom = p_batt / args.v_nom
        i_batt_min = p_batt / args.v_min
        runtime_h = usable_wh / p_batt if name != "boot peak" else None
        results.append(dict(state=name, p_5v_w=p5, p_batt_w=p_batt, i_batt_nom_a=i_batt_nom,
                            i_batt_vmin_a=i_batt_min, i_5v_a=p5 / 5.0, runtime_h=runtime_h, confidence=conf))

    # charger headroom: what is left for the cell when playing on USB power
    worst_cont = max(r["p_batt_w"] for r in results if r["runtime_h"] is not None)
    charge = []
    for i_in in args.input_a:
        p_in = 5.0 * i_in * args.path_eff
        for r in results:
            if r["runtime_h"] is None:
                continue
            p_spare = max(p_in - r["p_batt_w"], 0.0)
            i_chg = p_spare * args.charge_eff / 4.2
            t_chg = (args.cells * args.cell_mah / 1000.0) / i_chg if i_chg > 0.05 else None
            charge.append(dict(input_a=i_in, state=r["state"], charge_a=i_chg, charge_h=t_chg))

    boost_peak_in_a = max(r["p_batt_w"] for r in results) / args.v_min

    out = dict(pack=dict(cells=args.cells, cell_mah=args.cell_mah, wh=pack_wh, usable_wh=usable_wh),
               states=results, charge=charge,
               boost=dict(peak_input_a_at_vmin=boost_peak_in_a, output_v=5.1,
                          continuous_output_a=worst_cont * args.boost_eff / 5.1),
               psu=dict(rule="USB-C 5 V source; the charger's input current limit sets the ceiling; "
                             "1.5× margin over the worst continuous state is met when input_a ≥ "
                             f"{worst_cont * 1.5 / 5.0 / args.path_eff:.2f} A"),
               loads={k: dict(w=v[0], confidence=v[1], note=v[2]) for k, v in loads.items()})

    if args.json:
        print(json.dumps(out, indent=2))
        return 0

    print(f"Pack: 1S{args.cells}P × {args.cell_mah:.0f} mAh = {pack_wh:.1f} Wh nominal, {usable_wh:.1f} Wh usable at {args.usable:.0%}")
    print(f"Boost efficiency {args.boost_eff:.0%}, cut-off {args.v_min} V\n")
    print(f"{'State':42s} {'5 V rail':>9s} {'5 V amps':>9s} {'from pack':>10s} {'A @3.6V':>8s} {'A @3.0V':>8s} {'runtime':>9s}  confidence")
    for r in results:
        rt = f"{r['runtime_h']:6.1f} h" if r["runtime_h"] else "     —  "
        print(f"{r['state']:42s} {r['p_5v_w']:7.2f} W {r['i_5v_a']:7.2f} A {r['p_batt_w']:8.2f} W {r['i_batt_nom_a']:7.2f} {r['i_batt_vmin_a']:8.2f} {rt}  {r['confidence']}")
    print()
    print("Charging while on USB-C (5 V source), current left for the cell after the load:")
    print(f"{'input limit':>12s}  {'state':42s} {'charge A':>9s} {'full charge':>12s}")
    for c in charge:
        t = f"{c['charge_h']:6.1f} h" if c["charge_h"] else "  never "
        print(f"{c['input_a']:9.1f} A     {c['state']:42s} {c['charge_a']:7.2f} A {t:>12s}")
    print()
    print(f"Boost converter: ≥ {boost_peak_in_a:.1f} A input at {args.v_min} V (boot peak), "
          f"≥ {out['boost']['continuous_output_a']:.2f} A continuous at 5.1 V. TPS61088 class (10 A switch) fits with margin; "
          f"TPS61023 class (3.7 A switch) does not.")
    print(f"PSU rule: {out['psu']['rule']}")
    print()
    print("Confidence: MEASURED = from E6/T13/T14; DATASHEET = vendor typical; ESTIMATE = replace before the BOM is final.")
    est = [k for k, v in loads.items() if v[1] == "ESTIMATE"]
    print(f"Estimates still open: {', '.join(est)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
