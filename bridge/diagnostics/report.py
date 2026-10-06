#!/usr/bin/env python3
"""
report.py — turn a pile of capture.py runs into one comparison table, and
predict whether a candidate board can run the workload.

    python3 report.py ~/campfire-diag/*.json
    python3 report.py --predict 856 ~/campfire-diag/extended-3bt-*.json

--predict takes the dsp_bench SCORE from the CANDIDATE board and estimates the
busiest-core load the Campfire workload would have there, using the run's own
board as the calibration point. You must have run dsp_bench on both boards.
"""

import argparse, glob, json, os, sys

# Thresholds. Busiest-core p95 is the number that matters: PulseAudio's mix and
# encode path is one thread, so headroom on other cores does not save you.
GREEN, AMBER = 50.0, 70.0


def verdict(p95, faults):
    bad = sum(v for k, v in faults.items() if isinstance(v, int)
              and k in ("underrun", "xrun", "too_slow", "a2dp_fail"))
    if bad:
        return "FAIL", f"{bad} audio faults"
    if p95 < GREEN:
        return "PASS", "comfortable headroom"
    if p95 < AMBER:
        return "TIGHT", "works, no margin for a slower board"
    return "FAIL", "no headroom"


def load(paths):
    out = []
    for p in paths:
        for f in sorted(glob.glob(p)):
            if not f.endswith(".json"):
                continue
            try:
                with open(f) as fh:
                    d = json.load(fh)
                d["_file"] = f
                out.append(d)
            except Exception as e:
                print(f"skipping {f}: {e}", file=sys.stderr)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--predict", type=float, metavar="CANDIDATE_SCORE",
                    help="dsp_bench SCORE of the candidate board")
    ap.add_argument("--baseline", type=float, metavar="THIS_BOARD_SCORE",
                    help="dsp_bench SCORE of the board the runs were captured on")
    args = ap.parse_args()

    runs = load(args.files)
    if not runs:
        sys.exit("no capture .json files matched")

    print(f"{'label':<22} {'MHz':>5} {'cores':>6} {'RAM':>6} "
          f"{'cpu_all':>8} {'CORE p95':>9} {'mem MB':>7} {'degC':>5} {'faults':>7} "
          f"{'BT':>4}  verdict")
    print("-" * 110)
    for r in sorted(runs, key=lambda x: x.get("started", "")):
        b = r.get("board", {})
        f = {k: v for k, v in r.get("journal_faults", {}).items() if isinstance(v, int)}
        core95 = r["cpu_max_core_pct"]["p95"]
        v, why = verdict(core95, f)
        nf = sum(v2 for k, v2 in f.items() if k in ("underrun", "xrun", "too_slow", "a2dp_fail"))
        obs = r.get("observed", {})
        bt = obs.get("bt_sink_count")
        bt_s = "?" if bt is None else str(bt)
        print(f"{r.get('label','?')[:22]:<22} {b.get('scaling_max_mhz',0):>5} "
              f"{str(b.get('cpus_online','?')):>6} {b.get('mem_total_mb',0):>6} "
              f"{r['cpu_all_pct']['p95']:>7.1f}% {core95:>8.1f}% "
              f"{r['mem_used_mb']['max']:>7} {r.get('temp_c_max',0):>5.1f} {nf:>7} "
              f"{bt_s:>4}  {v} ({why})")

    # A label is operator-typed; BT is what the rig actually had connected.
    # Runs whose labels imply different configs but share a BT count measured
    # the same thing, whatever their names say.
    by_bt = {}
    for r in runs:
        bt = r.get("observed", {}).get("bt_sink_count")
        if bt is not None:
            by_bt.setdefault(bt, []).append(r.get("label", "?"))
    if any(k is not None for k in by_bt) and len(by_bt) == 1 and len(runs) > 2:
        only = next(iter(by_bt))
        print(f"\nNOTE: every run had {only} BT sink(s) connected. Labels implying")
        print("different speaker counts measured the same configuration.")

    print("\nper-process CPU p95 (busiest run):")
    worst = max(runs, key=lambda r: r["cpu_max_core_pct"]["p95"])
    for proc, val in sorted(worst.get("per_process_cpu_p95", {}).items(),
                            key=lambda kv: -kv[1]):
        if val > 0.5:
            print(f"  {proc:<18} {val:>6.1f}%   ({worst.get('label')})")

    if args.predict:
        base = args.baseline
        if base is None:
            sys.exit("\n--predict also needs --baseline (dsp_bench SCORE of the board "
                     "these runs came from)")
        ratio = base / args.predict
        print(f"\nPrediction: candidate is {ratio:.2f}x slower than the capture board "
              f"({base:.0f} -> {args.predict:.0f})")
        print(f"{'label':<22} {'CORE p95 here':>14} {'predicted there':>16}  verdict")
        print("-" * 62)
        for r in sorted(runs, key=lambda x: x.get("started", "")):
            here = r["cpu_max_core_pct"]["p95"]
            there = here * ratio
            v = "PASS" if there < GREEN else ("TIGHT" if there < AMBER else "FAIL")
            print(f"{r.get('label','?')[:22]:<22} {here:>13.1f}% {there:>15.1f}%  {v}")
        print("\nCaveat: this scales the userspace DSP cost only. Kernel, USB and BlueZ")
        print("costs do not scale with the same factor. Treat a predicted PASS as")
        print("'worth buying one to confirm', never as proof.")


if __name__ == "__main__":
    main()
