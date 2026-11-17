#!/usr/bin/env python3
"""Sealed-box + passive-radiator model for the Campfire built-in speaker.

Lumped-element (Thiele/Small) model of one driver in a closed box with an
optional passive radiator (PR) in the same box. Pure Python, no dependencies.
Prints the tuning numbers the enclosure needs (box tuning fb, the PR notch,
sealed-equivalent Fc/Qtc), a response table, the -3/-10 dB points, and the
voltage at which the driver or the PR hits Xmax — the number the S8 DSP
limiter is set from.

Usage
  python3 box_model.py                       # TC6FD00-04 + ND65-PR in 0.40 L
  python3 box_model.py --vb 0.3 0.4 0.5 0.6  # sweep the chamber volume
  python3 box_model.py --no-pr               # sealed only
  python3 box_model.py --eg 3.5 --csv out.csv --plot out.png

What it does NOT model: voice-coil inductance, box leakage beyond a lumped QL,
stuffing, cone break-up, baffle diffraction, the amp's clipping, or the DSP EQ.
Valid below ~1 kHz for a 2-inch driver. Verify fb with an impedance sweep or a
near-field measurement in REW (docs/first-speaker-manual.md Step 7).
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import sys

RHO = 1.18     # kg/m^3, air at ~20 C
C = 343.0      # m/s
P_REF = 20e-6  # Pa


def load_parts(path: pathlib.Path) -> dict:
    return json.loads(path.read_text())


def driver_mech(d: dict) -> dict:
    """Derive mechanical parameters from the published T/S set."""
    sd = d["Sd_cm2"] * 1e-4
    vas = d["Vas_L"] * 1e-3
    cms = vas / (RHO * C * C * sd * sd)
    ws = 2 * math.pi * d["Fs_Hz"]
    mms = 1.0 / (ws * ws * cms)
    rms = ws * mms / d["Qms"]
    bl = math.sqrt(ws * mms * d["Re_ohm"] / d["Qes"])
    return dict(Sd=sd, Cms=cms, Mms=mms, Rms=rms, Bl=bl, Re=d["Re_ohm"],
                Xmax=d["Xmax_mm"] * 1e-3, Fs=d["Fs_Hz"], Qts=d["Qts"], Vas=vas)


def pr_acoustic(p: dict) -> dict:
    """Passive radiator as an acoustic series branch: mass, compliance, loss."""
    sp = p["Sd_cm2"] * 1e-4
    mmp = p["Mms_g"] * 1e-3
    cmp_ = p["Cms_mm_per_N"] * 1e-3
    wp = 2 * math.pi * p["Fs_Hz"]
    rmp = wp * mmp / p["Qms"]
    return dict(Sp=sp, Map=mmp / sp**2, Cap=cmp_ * sp**2, Rap=rmp / sp**2,
                fp=p["Fs_Hz"], Xmax=p["Xmax_mm"] * 1e-3)


def box_tuning(pr: dict | None, vb_m3: float) -> float | None:
    """PR-in-box resonance: fb^2 = fp^2 + 1/(4 pi^2 Map Cab)."""
    if pr is None:
        return None
    cab = vb_m3 / (RHO * C * C)
    return math.sqrt(pr["fp"] ** 2 + 1.0 / (4 * math.pi**2 * pr["Map"] * cab))


def response(f: float, drv: dict, pr: dict | None, vb_m3: float, eg: float, ql: float):
    """Return (SPL dB at 1 m half-space, driver peak excursion m, PR peak excursion m)."""
    w = 2 * math.pi * f
    jw = 1j * w
    cab = vb_m3 / (RHO * C * C)
    zc = 1.0 / (jw * cab)
    # box leakage as a resistance across the compliance, Q_L referenced to fb (or Fc when sealed)
    f_ref = box_tuning(pr, vb_m3) or (drv["Fs"] * math.sqrt(1 + drv["Vas"] / vb_m3))
    ral = ql / (2 * math.pi * f_ref * cab)
    z_box = zc * ral / (zc + ral)
    if pr is not None:
        zp = jw * pr["Map"] + 1.0 / (jw * pr["Cap"]) + pr["Rap"]
        z_par = z_box * zp / (z_box + zp)
    else:
        zp = None
        z_par = z_box
    # driver: force from Bl*i, mechanical load incl. the box seen through Sd^2
    zm = jw * drv["Mms"] + drv["Rms"] + 1.0 / (jw * drv["Cms"]) + drv["Sd"] ** 2 * z_par
    v_d = (drv["Bl"] * eg / drv["Re"]) / (zm + drv["Bl"] ** 2 / drv["Re"])   # RMS cone velocity
    u_d = drv["Sd"] * v_d                                                     # RMS volume velocity
    if pr is not None:
        u_tot = u_d * zp / (z_box + zp)      # cone + PR, with the PR's phase
        u_p = -u_d * z_par / zp
    else:
        u_tot = u_d
        u_p = 0.0
    p_1m = RHO * f * abs(u_tot)             # half-space (2 pi) at 1 m
    spl = 20 * math.log10(max(p_1m, 1e-12) / P_REF)
    x_d = math.sqrt(2) * abs(v_d) / w       # peak displacement
    x_p = math.sqrt(2) * abs(u_p) / (pr["Sp"] * w) if pr is not None else 0.0
    return spl, x_d, x_p


def log_freqs(f0: float, f1: float, per_octave: int) -> list[float]:
    n = int(math.log2(f1 / f0) * per_octave) + 1
    return [f0 * 2 ** (i / per_octave) for i in range(n)]


def first_crossing(freqs, spls, level):
    """Lowest frequency at which the response reaches `level` (dB)."""
    for f, s in zip(freqs, spls):
        if s >= level:
            return f
    return None


def run_case(drv, pr, vb_l, eg, ql, f_lo, f_hi, per_octave):
    vb = vb_l * 1e-3
    freqs = log_freqs(f_lo, f_hi, per_octave)
    rows = [response(f, drv, pr, vb, eg, ql) for f in freqs]
    spls = [r[0] for r in rows]
    # reference = response at ~500 Hz (midband for a 2-inch driver)
    ref_i = min(range(len(freqs)), key=lambda i: abs(freqs[i] - 500))
    ref = spls[ref_i]
    f3 = first_crossing(freqs, spls, ref - 3)
    f10 = first_crossing(freqs, spls, ref - 10)
    # excursion limits: the voltage at which Xmax is reached, over 40..400 Hz
    v_lim_d, f_lim_d, v_lim_p, f_lim_p = math.inf, None, math.inf, None
    for f, (_, xd, xp) in zip(freqs, rows):
        if 40 <= f <= 400:
            if xd > 0:
                v = eg * drv["Xmax"] / xd
                if v < v_lim_d:
                    v_lim_d, f_lim_d = v, f
            if pr is not None and xp > 0:
                v = eg * pr["Xmax"] / xp
                if v < v_lim_p:
                    v_lim_p, f_lim_p = v, f
    alpha = drv["Vas"] / vb
    return dict(vb_l=vb_l, freqs=freqs, rows=rows, ref=ref, f3=f3, f10=f10,
                fb=box_tuning(pr, vb), fc=drv["Fs"] * math.sqrt(1 + alpha),
                qtc=drv["Qts"] * math.sqrt(1 + alpha),
                v_lim_d=v_lim_d, f_lim_d=f_lim_d, v_lim_p=v_lim_p, f_lim_p=f_lim_p)


def fmt_f(x):
    return "—" if x is None else f"{x:5.0f} Hz"


def main() -> int:
    here = pathlib.Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--parts", type=pathlib.Path, default=here / "drivers.json")
    ap.add_argument("--driver", default="TC6FD00-04")
    ap.add_argument("--pr", default="ND65-PR", help="passive radiator key, or 'none'")
    ap.add_argument("--no-pr", action="store_true", help="sealed box only")
    ap.add_argument("--vb", type=float, nargs="+", default=[0.40], help="net internal volume(s), litres")
    ap.add_argument("--eg", type=float, default=2.0, help="drive voltage, V RMS (2.0 V = 1 W into 4 ohm; MAX98357A at 5 V clips near 3.5 V)")
    ap.add_argument("--ql", type=float, default=7.0, help="box leakage Q (7 = typical sealed/PR box)")
    ap.add_argument("--f-lo", type=float, default=40.0)
    ap.add_argument("--f-hi", type=float, default=2000.0)
    ap.add_argument("--per-octave", type=int, default=6)
    ap.add_argument("--csv", type=pathlib.Path, help="write the response table for the first --vb")
    ap.add_argument("--plot", type=pathlib.Path, help="PNG of the response(s); needs matplotlib")
    args = ap.parse_args()

    parts = load_parts(args.parts)
    d = parts["drivers"][args.driver]
    drv = driver_mech(d)
    use_pr = not args.no_pr and args.pr.lower() != "none"
    pr = pr_acoustic(parts["passive_radiators"][args.pr]) if use_pr else None

    print(f"Driver : {d['name']}")
    print(f"         Fs {d['Fs_Hz']} Hz  Qts {d['Qts']}  Vas {d['Vas_L']} L  Sd {d['Sd_cm2']} cm²  Xmax {d['Xmax_mm']} mm  Re {d['Re_ohm']} Ω"
          + ("" if d.get("verified_against_datasheet") else "   ⚠ NOT yet checked against the datasheet"))
    print(f"         derived: Mms {drv['Mms']*1e3:.2f} g  Cms {drv['Cms']*1e3:.3f} mm/N  Bl {drv['Bl']:.2f} T·m")
    if pr is not None:
        p = parts["passive_radiators"][args.pr]
        print(f"PR     : {p['name']}")
        print(f"         Fs {p['Fs_Hz']} Hz  Mms {p['Mms_g']} g  Cms {p['Cms_mm_per_N']} mm/N  Sd {p['Sd_cm2']} cm²  Xmax {p['Xmax_mm']} mm")
    print(f"Drive  : {args.eg:.2f} V RMS ({args.eg**2/drv['Re']:.2f} W into Re)   QL {args.ql}   SPL at 1 m, half-space (−6 dB in free field at LF)")
    print()

    cases = [run_case(drv, pr, vb, args.eg, args.ql, args.f_lo, args.f_hi, args.per_octave) for vb in args.vb]

    print("Volume   sealed Fc/Qtc      PR tuning fb   PR notch   ref@500Hz   −3 dB     −10 dB    Xmax limit (driver)      Xmax limit (PR)")
    for c in cases:
        fb = fmt_f(c["fb"]) if pr is not None else "   —   "
        notch = f"{pr['fp']:5.0f} Hz" if pr is not None else "   —   "
        lim_d = f"{c['v_lim_d']:.2f} V @ {fmt_f(c['f_lim_d'])}"
        lim_p = (f"{c['v_lim_p']:.2f} V @ {fmt_f(c['f_lim_p'])}" if pr is not None and c["f_lim_p"] else "—")
        print(f"{c['vb_l']:4.2f} L   {c['fc']:5.0f} Hz / {c['qtc']:4.2f}   {fb}      {notch}   {c['ref']:5.1f} dB   {fmt_f(c['f3'])}  {fmt_f(c['f10'])}   {lim_d:22s}   {lim_p}")
    print()
    print("Xmax limit = drive voltage at which excursion reaches Xmax at that frequency, 40–400 Hz.")
    print("Set the S8 limiter / low-shelf so the driver never exceeds its figure; the PR has 5 mm of travel and is rarely the limit.")
    print()

    # response table for the first case
    c0 = cases[0]
    print(f"Response, Vb = {c0['vb_l']:.2f} L  (dB re ref at 500 Hz; excursions are peak mm at {args.eg:.2f} V)")
    print("   f (Hz)   SPL dB    rel dB   x_drv mm   x_pr mm")
    for f, (spl, xd, xp) in zip(c0["freqs"], c0["rows"]):
        if f <= 1000 or abs(math.log2(f) - round(math.log2(f))) < 1e-9:
            print(f"   {f:7.1f}   {spl:6.1f}   {spl - c0['ref']:+6.1f}   {xd*1e3:7.2f}   {xp*1e3:7.2f}")

    if args.csv:
        with args.csv.open("w") as fh:
            fh.write("f_hz,spl_db,rel_db,x_driver_mm,x_pr_mm\n")
            for f, (spl, xd, xp) in zip(c0["freqs"], c0["rows"]):
                fh.write(f"{f:.3f},{spl:.3f},{spl - c0['ref']:.3f},{xd*1e3:.4f},{xp*1e3:.4f}\n")
        print(f"\nwrote {args.csv}")

    if args.plot:
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
        except ImportError:
            print("\n--plot skipped: matplotlib not installed (pip install matplotlib)")
            return 0
        fig, ax = plt.subplots(figsize=(8, 4.5))
        for c in cases:
            ax.semilogx(c["freqs"], [r[0] - c["ref"] for r in c["rows"]], label=f"{c['vb_l']:.2f} L" + (f", fb {c['fb']:.0f} Hz" if c["fb"] else ""))
        ax.set_xlabel("Hz")
        ax.set_ylabel("dB re 500 Hz")
        ax.set_ylim(-30, 10)
        ax.grid(True, which="both", alpha=0.3)
        ax.legend()
        ax.set_title(f"{args.driver}" + (f" + {args.pr}" if pr is not None else " sealed") + f", {args.eg:.1f} V RMS")
        fig.tight_layout()
        fig.savefig(args.plot, dpi=130)
        print(f"wrote {args.plot}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
