#!/usr/bin/env bash
# power-budget.sh — E6. ONE STATE PER RUN, resumable.
#
# Each load state is recorded by its own short invocation, appended to a file.
# You can lose SSH, switch WiFi, unplug the Pi, or stop for a day between
# states and nothing is lost. Run them in any order.
#
#   ./power-budget.sh                 what is done, what is left
#   ./power-budget.sh idle            record one state
#   ./power-budget.sh limited
#   ./power-budget.sh extended
#   ./power-budget.sh builtin         needs the I2S amp wired
#   ./power-budget.sh camping         you will lose SSH — read the notes first
#   ./power-budget.sh boot            needs the meter's peak-hold
#   ./power-budget.sh report          PSU rating + battery sizing
#
# Re-running a state overwrites its previous reading, so a bad measurement is
# just a re-run.
#
# ─── WIRING ─────────────────────────────────────────────────────────────────
#   wall adapter  ──►  USB-C meter  ──►  Pi 5
# Between the adapter and the Pi, not on a downstream port.
#
# ─── READ ONCE BEFORE YOU TRUST A NUMBER ────────────────────────────────────
# Record VOLTS AND AMPS, never amps alone. USB-C PD negotiates a voltage
# (5/9/12/15/20 V); 2 A at 5 V and 2 A at 12 V are completely different loads.
#
# Some inexpensive meters interfere with PD negotiation. Symptoms: the Pi
# refuses to boot, warns about the power supply, or silently caps USB current so
# the dongles misbehave. If any of that happens the meter is part of the circuit
# you are measuring — note it and treat every number as a floor.
#
# The Pi 5 asks for a 5 A / 25 W supply because of PD negotiation and its
# peripheral budget, NOT because this workload needs it. Finding the real draw
# is the entire point of E6.

set -uo pipefail

LOG=${LOG:-$HOME/campfire-diag/e6-power.jsonl}
mkdir -p "$(dirname "$LOG")"
touch "$LOG"

hr() { printf '%s\n' "────────────────────────────────────────────────────────"; }

# state key | ordering | label | setup text
label_of() {
  case "$1" in
    boot)     echo "boot spike (peak hold)" ;;
    idle)     echo "idle — booted, nothing connected" ;;
    limited)  echo "Limited SKU — 1 BT speaker + audio" ;;
    extended) echo "Extended SKU — 3 BT speakers, full volume" ;;
    builtin)  echo "Extended + built-in wired speaker, full volume" ;;
    camping)  echo "CAMPING — hotspot + 3 BT, full volume" ;;
    *)        echo "" ;;
  esac
}

setup_of() {
  case "$1" in
    boot) cat <<'TXT'
  The worst instantaneous draw: SD card, every USB port and all radios coming
  up at once. You cannot catch this by watching the display.

  1. Clear the meter's max/peak reading.
  2. Unplug the Pi. Wait 10 seconds. Plug it back in.
  3. Let it boot fully (~20 s), then read the PEAK off the meter.
  4. SSH back in and run:  ./power-budget.sh boot
TXT
;;
    idle) cat <<'TXT'
  Disconnect every speaker, no party, nothing playing. This is the standby
  floor — it sets how long the battery lasts when nobody is using it.
TXT
;;
    limited) cat <<'TXT'
  Connect exactly ONE speaker, party on, AirPlay audio at normal volume.
  This is the cheap SKU's load.
TXT
;;
    extended) cat <<'TXT'
  All three speakers connected, party on, AirPlay at FULL volume.
  Full volume matters — class D amp draw scales with output.
TXT
;;
    builtin) cat <<'TXT'
  Same as 'extended' PLUS the built-in wired speaker at full volume.
  Requires the MAX98357A I2S amp wired and BUILTIN_SINK_NAME set.
  Skip this state until the amp exists.
TXT
;;
    camping) cat <<'TXT'
  ** YOU WILL LOSE SSH DOING THIS. That is fine — this script records one
     state per run, so nothing is lost. Read all of it before starting. **

  1. Switch the device to camping mode from the app.
  2. Join your iPhone to the "Campfire" WiFi network.
  3. Join your Mac to "Campfire" as well.
  4. SSH back in at the hotspot address:   ssh pi@192.168.4.1
  5. Connect all three speakers, party on, AirPlay at FULL volume.
  6. Run:  ./power-budget.sh camping

  hostapd + 3 BT radios + amp is the real worst case you ship. THIS is the
  number that sizes both the PSU and the battery.

  Afterwards, put the Mac and phone back on home WiFi.
TXT
;;
  esac
}

ALL_STATES="boot idle limited extended builtin camping"

recorded_states() { [ -s "$LOG" ] && python3 - "$LOG" <<'PY'
import json, sys
seen = {}
for line in open(sys.argv[1]):
    line = line.strip()
    if not line: continue
    try: r = json.loads(line)
    except Exception: continue
    seen[r["state"]] = r
print(" ".join(seen))
PY
}

cmd_status() {
  hr; echo "E6 PROGRESS"; hr
  local done_list; done_list=" $(recorded_states) "
  for st in $ALL_STATES; do
    if [[ "$done_list" == *" $st "* ]]; then
      printf '  [x] %-9s %s\n' "$st" "$(label_of "$st")"
    else
      printf '  [ ] %-9s %s\n' "$st" "$(label_of "$st")"
    fi
  done
  echo
  echo "  Record one:   ./power-budget.sh <state>"
  echo "  Final report: ./power-budget.sh report"
  echo "  Log file:     $LOG"
  echo
}

cmd_record() {
  local st="$1" lbl
  lbl=$(label_of "$st")
  [ -n "$lbl" ] || { echo "unknown state: $st"; echo; cmd_status; exit 1; }

  hr; echo "STATE: $lbl"; hr
  setup_of "$st"
  echo

  local thr
  thr=$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)
  if [ "$st" = "boot" ]; then
    echo "  (throttle state not meaningful for a peak-hold reading)"
  else
    read -rp "  Press Enter once the Pi is in that state and the meter has settled... " _
    thr=$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)
    if [ -z "$thr" ]; then
      thr="n/a"
      echo "  throttle: unavailable (no vcgencmd)"
    elif [ "$thr" = "0x0" ]; then
      echo "  throttle: $thr  clean"
    else
      echo "  throttle: $thr  <-- NON-ZERO"
      echo "            bit 0 = under-voltage now, bit 16 = under-voltage since"
      echo "            boot, 0x50005 = actively browning out. An under-voltage"
      echo "            reading invalidates CPU numbers from the same state."
    fi
  fi
  echo

  local v a w
  read -rp "  Volts (e.g. 5.12): " v
  read -rp "  Amps  (e.g. 1.84): " a
  if ! [[ "$v" =~ ^[0-9]*\.?[0-9]+$ && "$a" =~ ^[0-9]*\.?[0-9]+$ ]]; then
    echo "  volts and amps must be numbers — nothing recorded."; exit 1
  fi
  w=$(awk -v v="$v" -v a="$a" 'BEGIN{printf "%.2f", v*a}')
  echo "  => ${w} W"

  printf '{"state":"%s","label":"%s","volts":%s,"amps":%s,"watts":%s,"throttled":"%s","at":"%s"}\n' \
    "$st" "$lbl" "$v" "$a" "$w" "${thr:-n/a}" "$(date -Iseconds)" >> "$LOG"

  echo "  recorded -> $LOG"
  echo
  cmd_status
}

cmd_report() {
  [ -s "$LOG" ] || { echo "nothing recorded yet. ./power-budget.sh status"; exit 1; }
  hr; echo "E6 — POWER BUDGET REPORT"; hr
  python3 - "$LOG" <<'PY'
import json, sys

ORDER = ["idle", "limited", "extended", "builtin", "camping", "boot"]
seen = {}
for line in open(sys.argv[1]):
    line = line.strip()
    if not line:
        continue
    try:
        r = json.loads(line)
    except Exception:
        continue
    seen[r["state"]] = r          # last write wins

rows = [seen[k] for k in ORDER if k in seen and seen[k].get("watts", 0) > 0]
if not rows:
    print("  nothing usable recorded")
    raise SystemExit

pad = max(len(r["label"]) for r in rows)
for r in rows:
    flag = "" if r.get("throttled") in ("0x0", "n/a", None) else "   UNDER-VOLTAGE " + r["throttled"]
    print("  %s  %5.2f V  %5.2f A  %6.2f W%s"
          % (r["label"].ljust(pad), r["volts"], r["amps"], r["watts"], flag))

peak = max(rows, key=lambda r: r["watts"])
print("")
print("  PEAK: %.2f W  (%s)" % (peak["watts"], peak["label"]))
print("  PSU rating = peak x 1.5 = %.1f W" % (peak["watts"] * 1.5))

CONTINUOUS = ("extended", "builtin", "camping")
cont = [r for r in rows if r["state"] in CONTINUOUS]
if cont:
    draw = max(r["watts"] for r in cont)
    worst = max(cont, key=lambda r: r["watts"])
    print("")
    print("  Battery sizing (#27b) — continuous worst case %.2f W (%s):"
          % (draw, worst["label"]))
    CELL_MAH = 3000.0
    for h in (4, 6, 8, 12):
        wh = draw * h
        mah = (wh / 3.7 / 0.85) * 1000.0
        print("    %2d h ->  %6.1f Wh  ~= %7.0f mAh  ~= %4.1f x 18650 cells"
              % (h, wh, mah, mah / CELL_MAH))
    print("    (3.7 V nominal, 85% usable to protect cycle life, 3000 mAh/cell.)")
    print("    Over ~100 Wh a pack is restricted as air cargo — watch that line.")

missing = [k for k in ORDER if k not in seen]
if missing:
    print("")
    print("  NOT YET MEASURED: %s" % ", ".join(missing))
    if "camping" in missing:
        print("  Camping is the state that sizes the PSU and the pack. The report")
        print("  is provisional until it exists.")
PY
  echo
  echo "Record the peak and the camping number in EXPERIMENTS.md under E6,"
  echo "and carry the continuous draw into #27b for cell sizing."
}

case "${1:-status}" in
  status|"")  cmd_status ;;
  report)     cmd_report ;;
  *)          cmd_record "$1" ;;
esac
