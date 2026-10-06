#!/usr/bin/env python3
"""
capture.py — sample what the Campfire Bridge workload actually costs.

Runs on the Pi while music is playing. Samples system and per-process
telemetry to CSV, samples PulseAudio sink latency (the sync-quality signal),
and counts audio-fault events from the journal for the run window.

The number that decides your SoC is cpu_max_core_pct, not cpu_all_pct:
PulseAudio's mixing/encoding path is one thread, so a four-core board with
50% total CPU can still be saturated. Watch the busiest core.

Usage (on the Pi, while AirPlay is streaming to all speakers):
    python3 capture.py --label extended-3bt --duration 180

Outputs into --outdir (default ~/campfire-diag/):
    <label>-<ts>.csv        per-sample telemetry
    <label>-<ts>.sinks.csv  per-sink PulseAudio latency over time
    <label>-<ts>.json       board metadata + journal fault counts + summary
"""

import argparse, json, os, re, subprocess, sys, time
from datetime import datetime

PAGE = os.sysconf("SC_PAGE_SIZE")
HZ = os.sysconf("SC_CLK_TCK")

# Processes that make up the audio path. Matched on exact comm name.
WATCH = ["pulseaudio", "pipewire", "wireplumber", "shairport-sync", "nqptp",
         "bluetoothd", "node", "avahi-daemon", "wpa_supplicant", "hostapd",
         "NetworkManager"]

# Journal patterns that mean "the audio broke". Counted over the run window.
FAULTS = {
    "underrun":      r"underrun|Underrun",
    "overrun":       r"overrun|Overrun",
    "latency_bump":  r"Increasing latency|increasing the latency",
    "too_slow":      r"too slow|processing too slow|Sink.*slow",
    "resync":        r"resync|Resync|drift|Drift",
    "bt_disconnect": r"Disconnected|disconnect.*ACL|Connection reset",
    "a2dp_fail":     r"a2dp.*fail|Failed to.*A2DP|transport.*error",
    "xrun":          r"xrun|XRUN",
}


def read(path, default=""):
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return default


def cpu_fields():
    """Return (total_busy, total_all, {core: (busy, all)}) from /proc/stat."""
    cores = {}
    tot = (0, 0)
    for line in read("/proc/stat").splitlines():
        if not line.startswith("cpu"):
            break
        parts = line.split()
        name = parts[0]
        v = [int(x) for x in parts[1:11]]
        idle = v[3] + v[4]              # idle + iowait
        allt = sum(v)
        busy = allt - idle
        if name == "cpu":
            tot = (busy, allt)
        else:
            cores[name] = (busy, allt)
    return tot[0], tot[1], cores


def pids_for(name):
    try:
        out = subprocess.run(["pgrep", "-x", name], capture_output=True, text=True, timeout=5)
        return [int(p) for p in out.stdout.split()]
    except Exception:
        return []


def proc_sample(name):
    """Return (cpu_ticks, rss_bytes, nthreads) summed over all pids with this name."""
    ticks = rss = threads = 0
    for pid in pids_for(name):
        stat = read(f"/proc/{pid}/stat")
        if not stat:
            continue
        try:
            rest = stat[stat.rindex(")") + 2:].split()
            ticks += int(rest[11]) + int(rest[12])   # utime + stime
            threads += int(rest[17])
        except (ValueError, IndexError):
            continue
        statm = read(f"/proc/{pid}/statm").split()
        if len(statm) > 1:
            rss += int(statm[1]) * PAGE
    return ticks, rss, threads


def meminfo():
    mi = {}
    for line in read("/proc/meminfo").splitlines():
        k, _, v = line.partition(":")
        mi[k] = int(v.split()[0]) if v.split() else 0
    total = mi.get("MemTotal", 0)
    avail = mi.get("MemAvailable", 0)
    return (total - avail) // 1024, total // 1024   # MB used, MB total


def disk_written_bytes():
    total = 0
    for line in read("/proc/diskstats").splitlines():
        f = line.split()
        if len(f) > 9 and re.fullmatch(r"(mmcblk\d|sd[a-z]|nvme\d+n\d+)", f[2]):
            total += int(f[9]) * 512
    return total


def net_bytes():
    rx = tx = 0
    for line in read("/proc/net/dev").splitlines()[2:]:
        iface, _, rest = line.partition(":")
        if iface.strip() in ("lo",):
            continue
        f = rest.split()
        if len(f) >= 9:
            rx += int(f[0]); tx += int(f[8])
    return rx, tx


def thermal():
    t = read("/sys/class/thermal/thermal_zone0/temp", "0").strip()
    try:
        return int(t) / 1000.0
    except ValueError:
        return 0.0


def cur_mhz():
    f = read("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq", "0").strip()
    try:
        return int(f) // 1000
    except ValueError:
        return 0


def throttled():
    try:
        out = subprocess.run(["vcgencmd", "get_throttled"], capture_output=True, text=True, timeout=5)
        return out.stdout.strip().split("=")[-1] or "0x0"
    except Exception:
        return "n/a"


def pactl_sinks(env):
    """Return {sink_name: latency_ms}. Empty if PulseAudio is unreachable."""
    try:
        out = subprocess.run(["pactl", "list", "sinks"], capture_output=True,
                             text=True, timeout=8, env=env)
    except Exception:
        return {}
    sinks, name = {}, None
    for line in out.stdout.splitlines():
        m = re.match(r"\s*Name:\s+(\S+)", line)
        if m:
            name = m.group(1)
        m = re.search(r"Latency:\s+(\d+)\s*usec", line)
        if m and name:
            sinks[name] = int(m.group(1)) / 1000.0
    return sinks


def network_mode():
    """Record whether this run was in home or camping mode.

    A capture labelled 'camping' proves nothing unless the hotspot was actually
    up. The camping daemon also reverts to home within 30 s whenever a known
    network is in range, so a run can silently start camping and end at home.
    """
    state = read("/tmp/campfire-network-mode", "").strip() or "unknown"
    hotspot = None
    try:
        out = subprocess.run(["nmcli", "-t", "-f", "NAME,STATE", "con", "show", "--active"],
                             capture_output=True, text=True, timeout=5).stdout
        hotspot = any("campfire-hotspot" in line and "activated" in line.lower()
                      for line in out.splitlines())
    except Exception:
        pass
    return {"state_file": state, "hotspot_active": hotspot}


def board_meta():
    model = read("/proc/device-tree/model", "unknown").strip("\x00").strip()
    _, memtotal = meminfo()
    gov = read("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor", "?").strip()
    maxf = read("/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq", "0").strip()
    online = read("/sys/devices/system/cpu/online", "?").strip()
    try:
        maxmhz = int(maxf) // 1000
    except ValueError:
        maxmhz = 0
    return {
        "model": model, "kernel": os.uname().release, "mem_total_mb": memtotal,
        "governor": gov, "scaling_max_mhz": maxmhz, "cpus_online": online,
        "nproc": os.cpu_count(),
    }


def journal_faults(since_iso):
    counts = {k: 0 for k in FAULTS}
    try:
        out = subprocess.run(
            ["journalctl", "--since", since_iso, "--no-pager", "-o", "cat"],
            capture_output=True, text=True, timeout=60)
        text = out.stdout
    except Exception:
        return {"_error": "journalctl unavailable"}
    for key, pat in FAULTS.items():
        counts[key] = len(re.findall(pat, text))
    return counts


def pct(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    i = min(int(round((p / 100.0) * (len(s) - 1))), len(s) - 1)
    return s[i]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="run")
    ap.add_argument("--duration", type=int, default=180)
    ap.add_argument("--interval", type=float, default=1.0)
    ap.add_argument("--outdir", default=os.path.expanduser("~/campfire-diag"))
    ap.add_argument("--sink-interval", type=float, default=5.0,
                    help="seconds between PulseAudio sink latency samples")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = os.path.join(args.outdir, f"{args.label}-{ts}")

    env = dict(os.environ)
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    env.setdefault("PULSE_SERVER", f"unix:{env['XDG_RUNTIME_DIR']}/pulse/native")

    meta = board_meta()
    net_start = network_mode()
    start_wall = datetime.now()
    since_iso = start_wall.strftime("%Y-%m-%d %H:%M:%S")

    print(f"board      : {meta['model']}")
    print(f"cpus       : {meta['nproc']} online={meta['cpus_online']} "
          f"max={meta['scaling_max_mhz']}MHz gov={meta['governor']}")
    print(f"ram        : {meta['mem_total_mb']} MB")
    print(f"sampling   : {args.duration}s @ {args.interval}s -> {base}.csv")
    sinks0 = pactl_sinks(env)
    print(f"pulse sinks: {len(sinks0)} found" if sinks0 else
          "pulse sinks: NONE (pactl unreachable - sink latency will be empty)")
    print()

    cols = (["ts", "elapsed", "cpu_all_pct", "cpu_max_core_pct", "cpu_busiest_core",
             "cpu_mhz", "temp_c", "throttled", "mem_used_mb", "disk_write_kbps",
             "net_rx_kbps", "net_tx_kbps"]
            + [f"{p}_cpu_pct" for p in WATCH]
            + [f"{p}_rss_mb" for p in WATCH]
            + [f"{p}_threads" for p in WATCH])

    fcsv = open(f"{base}.csv", "w", buffering=1)
    fcsv.write(",".join(cols) + "\n")
    fsink = open(f"{base}.sinks.csv", "w", buffering=1)
    fsink.write("elapsed,sink,latency_ms\n")

    seen_sinks: set = set()
    seen_running: set = set()

    prev_busy, prev_all, prev_cores = cpu_fields()
    prev_proc = {p: proc_sample(p)[0] for p in WATCH}
    prev_disk = disk_written_bytes()
    prev_rx, prev_tx = net_bytes()

    hist = {c: [] for c in cols if c.endswith("_pct") or c in ("mem_used_mb", "temp_c")}
    throttle_events = set()
    t_start = time.monotonic()
    next_sink = 0.0

    try:
        while True:
            elapsed = time.monotonic() - t_start
            if elapsed >= args.duration:
                break
            time.sleep(args.interval)
            elapsed = time.monotonic() - t_start

            busy, allt, cores = cpu_fields()
            d_all = allt - prev_all
            cpu_all = 100.0 * (busy - prev_busy) / d_all if d_all else 0.0
            best_core, best_pct = "", 0.0
            for name, (cb, ca) in cores.items():
                pb, pa = prev_cores.get(name, (0, 0))
                d = ca - pa
                if d <= 0:
                    continue
                v = 100.0 * (cb - pb) / d
                if v > best_pct:
                    best_pct, best_core = v, name
            prev_busy, prev_all, prev_cores = busy, allt, cores

            row = {"ts": datetime.now().isoformat(timespec="seconds"),
                   "elapsed": f"{elapsed:.1f}",
                   "cpu_all_pct": f"{cpu_all:.1f}",
                   "cpu_max_core_pct": f"{best_pct:.1f}",
                   "cpu_busiest_core": best_core}
            hist["cpu_all_pct"].append(cpu_all)
            hist["cpu_max_core_pct"].append(best_pct)

            row["cpu_mhz"] = cur_mhz()
            temp = thermal()
            row["temp_c"] = f"{temp:.1f}"
            hist["temp_c"].append(temp)
            th = throttled()
            row["throttled"] = th
            if th not in ("0x0", "n/a", ""):
                throttle_events.add(th)

            used, _ = meminfo()
            row["mem_used_mb"] = used
            hist["mem_used_mb"].append(used)

            disk = disk_written_bytes()
            row["disk_write_kbps"] = f"{(disk - prev_disk) / 1024.0 / args.interval:.1f}"
            prev_disk = disk

            rx, tx = net_bytes()
            row["net_rx_kbps"] = f"{(rx - prev_rx) / 1024.0 / args.interval:.1f}"
            row["net_tx_kbps"] = f"{(tx - prev_tx) / 1024.0 / args.interval:.1f}"
            prev_rx, prev_tx = rx, tx

            for p in WATCH:
                ticks, rss, threads = proc_sample(p)
                dt = ticks - prev_proc[p]
                cpu = 100.0 * (dt / HZ) / args.interval if dt >= 0 else 0.0
                prev_proc[p] = ticks
                row[f"{p}_cpu_pct"] = f"{cpu:.1f}"
                row[f"{p}_rss_mb"] = f"{rss / 1048576.0:.1f}"
                row[f"{p}_threads"] = threads
                hist.setdefault(f"{p}_cpu_pct", []).append(cpu)

            fcsv.write(",".join(str(row.get(c, "")) for c in cols) + "\n")

            if elapsed >= next_sink:
                for name, lat in pactl_sinks(env).items():
                    fsink.write(f"{elapsed:.1f},{name},{lat:.1f}\n")
                    seen_sinks.add(name)
                    if lat > 0:
                        seen_running.add(name)
                next_sink = elapsed + args.sink_interval

            sys.stdout.write(
                f"\r{elapsed:6.0f}s  cpu_all {cpu_all:5.1f}%  "
                f"busiest_core {best_pct:5.1f}% ({best_core})  "
                f"mem {used}MB  {temp:.1f}C  ")
            sys.stdout.flush()
    except KeyboardInterrupt:
        print("\ninterrupted - writing what we have")

    fcsv.close()
    fsink.close()
    print()

    faults = journal_faults(since_iso)
    summary = {
        "label": args.label,
        "started": start_wall.isoformat(timespec="seconds"),
        "duration_s": round(time.monotonic() - t_start, 1),
        "board": meta,
        "cpu_all_pct": {"p50": round(pct(hist["cpu_all_pct"], 50), 1),
                        "p95": round(pct(hist["cpu_all_pct"], 95), 1),
                        "max": round(max(hist["cpu_all_pct"] or [0]), 1)},
        "cpu_max_core_pct": {"p50": round(pct(hist["cpu_max_core_pct"], 50), 1),
                             "p95": round(pct(hist["cpu_max_core_pct"], 95), 1),
                             "max": round(max(hist["cpu_max_core_pct"] or [0]), 1)},
        "mem_used_mb": {"p50": round(pct(hist["mem_used_mb"], 50), 1),
                        "max": max(hist["mem_used_mb"] or [0])},
        "temp_c_max": round(max(hist["temp_c"] or [0]), 1),
        "throttle_codes": sorted(throttle_events),
        "per_process_cpu_p95": {p: round(pct(hist.get(f"{p}_cpu_pct", []), 95), 1)
                                for p in WATCH if any(hist.get(f"{p}_cpu_pct", []))},
        "journal_faults": faults,
        # What was ACTUALLY connected during this run. Recorded because a label
        # is just a string the operator typed -- it does not change the rig, and
        # a mislabeled run is otherwise indistinguishable from a real one.
        "observed": {
            "bt_sinks": sorted(n for n in seen_sinks if "bluez_sink" in n),
            "bt_sink_count": len([n for n in seen_sinks if "bluez_sink" in n]),
            "wired_sink": any("alsa_output" in n for n in seen_sinks),
            "all_sinks": sorted(seen_sinks),
            "network_start": net_start,
            "network_end": network_mode(),
        },
        "files": {"telemetry": f"{base}.csv", "sinks": f"{base}.sinks.csv"},
    }
    with open(f"{base}.json", "w") as f:
        json.dump(summary, f, indent=2)

    print(f"cpu_all      p50 {summary['cpu_all_pct']['p50']:5.1f}%  "
          f"p95 {summary['cpu_all_pct']['p95']:5.1f}%  max {summary['cpu_all_pct']['max']:5.1f}%")
    print(f"busiest core p50 {summary['cpu_max_core_pct']['p50']:5.1f}%  "
          f"p95 {summary['cpu_max_core_pct']['p95']:5.1f}%  max {summary['cpu_max_core_pct']['max']:5.1f}%"
          "   <-- this is the number that picks your SoC")
    print(f"mem used     p50 {summary['mem_used_mb']['p50']:.0f}MB  max {summary['mem_used_mb']['max']}MB")
    print(f"temp max     {summary['temp_c_max']}C   throttle codes: {summary['throttle_codes'] or 'none'}")
    nf = {k: v for k, v in faults.items() if isinstance(v, int) and v}
    print(f"audio faults {nf or 'none'}")
    obs = summary["observed"]
    print(f"observed     {obs['bt_sink_count']} BT sink(s)"
          f"{' + wired' if obs['wired_sink'] else ' (NO wired sink)'}"
          f"   <-- confirm this matches the label '{args.label}'")
    n0, n1 = obs["network_start"], obs["network_end"]
    hs = "hotspot UP" if n1.get("hotspot_active") else "hotspot down"
    drift = "" if n0.get("hotspot_active") == n1.get("hotspot_active") \
            else "   *** MODE CHANGED MID-RUN — this run is not one scenario ***"
    print(f"network      {n1.get('state_file','?')} / {hs}{drift}")
    print(f"\nwrote {base}.json")


if __name__ == "__main__":
    main()
