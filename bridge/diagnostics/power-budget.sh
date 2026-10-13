#!/usr/bin/env bash
# power-budget.sh — E6. Walks through each load state, prompts you for the
# reading off the inline USB-C meter, records the Pi's own throttle state
# alongside it, and writes a JSON you can diff against other boards.
#
# Run on the Pi:  ./power-budget.sh
#
# ─── WIRING ─────────────────────────────────────────────────────────────────
#   wall adapter  ──►  USB-C meter  ──►  Pi 5
# The meter goes BETWEEN the adapter and the Pi, not on a downstream port.
#
# ─── READ THIS BEFORE YOU TRUST A NUMBER ────────────────────────────────────
# Record VOLTS AND AMPS, never amps alone. USB-C PD negotiates a voltage
# (5/9/12/15/20 V); 2 A at 5 V and 2 A at 12 V are wildly different loads. The
# script computes watts for you.
#
# Some inexpensive meters interfere with PD negotiation. Symptoms: the Pi
# refuses to boot, warns about the power supply, or silently caps USB current so
# your dongles misbehave. If any of that happens, the meter is part of the
# circuit you are measuring — note it and treat the numbers as a floor.
#
# The Pi 5 asks for a 5 A / 25 W supply because of PD negotiation and its
# peripheral budget, NOT because this workload needs it. Measuring the real
# draw is the entire point of E6: a cheaper board with 3 dongles likely lands
# near 1.5-2.5 A peak, which is a much cheaper adapter.

set -uo pipefail

OUT=${OUT:-$HOME/campfire-diag/e6-power.json}
mkdir -p "$(dirname "$OUT")"

hr() { printf '%s\n' "────────────────────────────────────────────────────────"; }

throttle() {
  local t
  t=$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)
  case "$t" in
    0x0|"") echo "$t clean" ;;
    *)      echo "$t  <-- NON-ZERO: bit 0 = under-voltage NOW, bit 16 = under-voltage since boot. 0x50005 = actively browning out" ;;
  esac
}

readings=()

measure() {
  local key="$1" label="$2" setup="$3"
  hr; echo "STATE: $label"; hr
  echo "$setup"
  echo
  read -rp "  Press Enter once the Pi is in that state and the meter has settled... " _
  echo "  Pi throttle state: $(throttle)"
  echo
  read -rp "  Volts (e.g. 5.12): " v
  read -rp "  Amps  (e.g. 1.84): " a
  local w
  w=$(awk -v v="$v" -v a="$a" 'BEGIN{printf "%.2f", v*a}')
  echo "  => ${w} W"
  echo
  readings+=("{\"state\":\"$key\",\"label\":\"$label\",\"volts\":$v,\"amps\":$a,\"watts\":$w,\"throttled\":\"$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)\"}")
}

cat <<'INTRO'
════════════════════════════════════════════════════════════════════════════
E6 — POWER BUDGET
════════════════════════════════════════════════════════════════════════════
Six states, in order. Skip any you cannot reach yet (just enter 0 for volts).

The one that matters most is the LAST one: camping mode hosts an access point
while three Bluetooth radios stream, which is the real worst case you ship, and
it is NOT the same as the home-mode load.
INTRO
echo

# Boot spike needs the meter's peak-hold, so it is handled by instruction only.
hr; echo "STATE: boot spike (use the meter's PEAK HOLD / MAX function)"; hr
cat <<'TXT'
  This is the worst instantaneous draw: SD card, every USB port and all radios
  initialising at once. You cannot catch it by watching.

  1. Clear the meter's max/peak reading.
  2. Unplug the Pi, wait 10 seconds, plug it back in.
  3. Let it boot fully, then read the PEAK value off the meter.
  4. SSH back in and re-run this script, entering that peak here.
TXT
echo
read -rp "  Peak volts (0 to skip): " bv
read -rp "  Peak amps  (0 to skip): " ba
bw=$(awk -v v="$bv" -v a="$ba" 'BEGIN{printf "%.2f", v*a}')
echo "  => ${bw} W peak"
readings+=("{\"state\":\"boot_peak\",\"label\":\"boot spike (peak hold)\",\"volts\":$bv,\"amps\":$ba,\"watts\":$bw,\"throttled\":\"n/a\"}")
echo

measure idle "idle — booted, no speakers, no audio" \
  "  Disconnect all speakers, no party, nothing playing. This is the standby floor."

measure limited_1bt "Limited SKU — 1 BT speaker + audio" \
  "  Connect ONE speaker, start the party, AirPlay audio at normal volume."

measure extended_3bt "Extended SKU — 3 BT speakers + audio, full volume" \
  "  Connect all three speakers, party on, AirPlay at FULL volume.
  Full volume matters: class D amp draw scales with output."

measure extended_builtin "Extended + built-in wired speaker, full volume" \
  "  Same as above PLUS the built-in speaker driven at full volume.
  Skip (enter 0) if the I2S amp is not wired yet."

measure camping_3bt "CAMPING — hotspot up, 3 BT + audio, full volume" \
  "  Switch to camping mode, join your phone to the Campfire hotspot, three
  speakers, party on, AirPlay at full volume. hostapd + 3 radios + amp is the
  real worst case. THIS is the number that sizes the PSU and the battery."

# ─── Report ─────────────────────────────────────────────────────────────────
hr; echo "RESULT"; hr
printf '%s\n' "${readings[@]}" | python3 -c '
import json, sys

rows = [json.loads(l) for l in sys.stdin if l.strip()]
rows = [r for r in rows if r.get("watts", 0) > 0]
if not rows:
    print("  nothing recorded")
    raise SystemExit

pad = max(len(r["label"]) for r in rows)
for r in rows:
    label = r["label"].ljust(pad)
    print("  %s  %5.2f V  %5.2f A  %6.2f W" % (label, r["volts"], r["amps"], r["watts"]))

peak = max(rows, key=lambda r: r["watts"])
print("")
print("  PEAK: %.2f W  (%s)" % (peak["watts"], peak["label"]))
print("  PSU rating = peak x 1.5 = %.1f W" % (peak["watts"] * 1.5))
print("")

CONTINUOUS = ("extended_3bt", "extended_builtin", "camping_3bt")
cont = [r for r in rows if r["state"] in CONTINUOUS]
if cont:
    draw = max(r["watts"] for r in cont)
    print("  Battery sizing (#27b) - pick a runtime target and read across:")
    print("    continuous worst-case draw: %.2f W" % draw)
    CELL_MAH = 3000.0          # a good 18650, conservative
    for h in (4, 6, 8, 12):
        wh = draw * h
        mah = (wh / 3.7 / 0.85) * 1000.0
        cells = mah / CELL_MAH
        print("    %2d h ->  %6.1f Wh  ~= %7.0f mAh  ~= %.1f x 18650 cells" % (h, wh, mah, cells))
    print("    (3.7 V nominal, 85%% usable to protect cycle life, 3000 mAh/cell.)")
    print("    Over ~100 Wh a pack cannot fly as cargo without special handling -")
    print("    watch that line if the runtime target climbs.")
'
echo

printf '{"experiment":"E6","date":"%s","host":"%s","readings":[%s]}\n' \
  "$(date -Iseconds)" "$(hostname)" "$(IFS=,; echo "${readings[*]}")" > "$OUT"
echo "Saved: $OUT"
echo
echo "Record the peak and the camping number in EXPERIMENTS.md under E6,"
echo "and carry the continuous draw into #27b for cell sizing."
