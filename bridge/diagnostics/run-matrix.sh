#!/usr/bin/env bash
# run-matrix.sh — guided sweep that finds the point where the audio breaks.
#
# Run this ON THE PI with music actually playing to every speaker you intend to
# ship (Extended SKU worst case: 3 BT speakers + built-in wired).
#
#   ./run-matrix.sh baseline     one full-speed capture (do this first)
#   ./run-matrix.sh clocks       sweep CPU clock down until audio breaks
#   ./run-matrix.sh cores        sweep core count down
#   ./run-matrix.sh quota        (NOT in "all" — caps each service separately, so
#                                it does not bind on this multi-process workload)
#   ./run-matrix.sh all          everything, in order
#
# Between steps it pauses so you can LISTEN. Numbers alone will not tell you
# that the speakers drifted out of sync — your ears will. Log what you hear.

set -uo pipefail
cd "$(dirname "$0")"

DUR=${DUR:-120}
OUT=${OUT:-$HOME/campfire-diag}
mkdir -p "$OUT"

cap() { python3 capture.py --label "$1" --duration "$DUR" --outdir "$OUT"; }

listen() {
  echo
  echo "  >>> LISTEN NOW: is it in sync? any dropouts, crackle, or lag between speakers?"
  read -r -p "  >>> describe what you hear (enter = fine): " note
  [ -n "$note" ] && echo "$(date -Is)  $1  $note" >> "$OUT/listening-notes.txt"
}

confirm_playing() {
  echo "Before starting:"
  echo "  1. AirPlay from your iPhone to Campfire Bridge"
  echo "  2. All target speakers connected and in party mode"
  echo "  3. Play a continuous track (not silence - silence costs nothing to encode)"
  read -r -p "Press enter when audio is playing to every speaker... "
}

step() {   # step <label> <constrain-args...>
  local label=$1; shift
  echo
  echo "=== $label ==="
  if [ $# -gt 0 ]; then sudo ./constrain.sh "$@" || return 1; fi
  sleep 5                      # let the stack settle after the change
  cap "$label"
  listen "$label"
}

do_baseline() {
  sudo ./constrain.sh reset >/dev/null
  step "baseline-full"
}

do_clocks() {
  verify_cores_restored    # a clock sweep on the wrong core count is garbage
  for mhz in 2400 2000 1700 1500; do
    step "clock-${mhz}mhz" clock "$mhz"
  done
  sudo ./constrain.sh reset >/dev/null
}

do_cores() {
  for n in 4 3 2 1; do
    step "cores-${n}" cores "$n"
  done
  sudo ./constrain.sh reset >/dev/null
  verify_cores_restored
}

# Offlining cores on a Pi 5 can be irreversible without a reboot. If the cores
# did not come back, every later run is silently measured on fewer cores than
# its label says — so stop rather than collect data that looks valid and is not.
verify_cores_restored() {
  local want have
  want=$(getconf _NPROCESSORS_CONF)
  have=$(nproc)
  if [ "$have" -lt "$want" ]; then
    echo
    echo "*** STOPPING: only $have of $want cores are online after reset. ***"
    echo "Everything measured from here would be wrong. Reboot, then re-run:"
    echo "    sudo reboot"
    exit 1
  fi
}

do_quota() {
  for q in 100 70 50 35 25 15; do
    step "quota-${q}pct" quota "$q"
  done
  sudo ./constrain.sh reset >/dev/null
}

confirm_playing
case "${1:-all}" in
  baseline) do_baseline ;;
  clocks)   do_clocks ;;
  cores)    do_cores ;;
  quota)    do_quota ;;
  all)      do_baseline; do_cores; do_clocks ;;
  *) echo "usage: $0 {baseline|clocks|cores|quota|all}"; exit 1 ;;
esac

echo
echo "=== results ==="
python3 report.py "$OUT"/*.json
echo
echo "listening notes: $OUT/listening-notes.txt"
echo "Constraints reset. Confirm with: ./constrain.sh show"
