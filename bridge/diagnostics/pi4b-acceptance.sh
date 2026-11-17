#!/usr/bin/env bash
# pi4b-acceptance.sh — the remaining CPU/coexistence captures on the Pi 4B bench
# unit, hands-off and in a fixed order. Run ON THE PI. Results land in
# ~/campfire-diag as pi4b-*.json; record them in EXPERIMENTS.md "Pi 4B acceptance".
#
#   bash ~/pi4b-acceptance.sh standard      1 BT + built-in rig as it is now:
#                                            dsp_bench score, then a hands-off 600 MHz re-run
#   bash ~/pi4b-acceptance.sh builtin       built-in ONLY (disconnect the BT speaker):
#                                            the load that option C would take off the chip
#   bash ~/pi4b-acceptance.sh extended      3 BT + built-in: ondemand, then 1200 / 900 / 600 MHz
#   bash ~/pi4b-acceptance.sh camping       600 s on the Campfire hotspot (SSH at 192.168.4.1)
#   bash ~/pi4b-acceptance.sh home-control  the matched 600 s run back on home WiFi
#   bash ~/pi4b-acceptance.sh report        everything so far, side by side
#
# RULE FOR EVERY CAPTURE: set the sync / buffer BEFORE you press enter, then do
# not touch the app, the speakers or the sync until the capture prints its
# summary. Re-timing a loopback is a CPU spike and shows up as a fault.
#
# The script lives outside the repo on purpose (rsync it to ~/ on the Pi) so a
# later `git pull` in ~/campfire-bridge never collides with it.

set -uo pipefail

DIAG=${DIAG:-$HOME/campfire-bridge/bridge/diagnostics}
OUT=${OUT:-$HOME/campfire-diag}
DUR=${DUR:-300}
LONG=${LONG:-600}
cd "$DIAG" || { echo "no diagnostics dir at $DIAG" >&2; exit 1; }
mkdir -p "$OUT"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }

cap() {   # cap <label> <seconds>
  python3 capture.py --label "$1" --duration "$2" --outdir "$OUT"
}

listen() {
  echo
  echo "  >>> What did you hear during that run? (enter = clean)"
  read -r -p "  >>> " note
  [ -n "$note" ] && echo "$(date -Is)  $1  $note" >> "$OUT/listening-notes.txt"
}

hands_off() {   # hands_off <what the rig must look like>
  echo
  echo "Rig for this capture: $1"
  echo "  1. AirPlay from the iPhone to Campfire, music playing continuously (not silence)"
  echo "  2. Set the sync / buffer NOW if it needs it"
  echo "  3. From enter until the summary prints: touch nothing"
  read -r -p "Press enter when it is playing and you are hands-off... "
}

preflight_gate() {
  if ! ./preflight.sh; then
    echo
    read -r -p "preflight did not pass. Continue anyway? [y/N] " yn
    [[ "$yn" =~ ^[Yy]$ ]] || exit 1
  fi
}

pin()   { sudo ./constrain.sh clock "$1" >/dev/null && echo "clock pinned: $1 MHz"; sleep 10; }
reset() { sudo ./constrain.sh reset >/dev/null 2>&1; }
trap reset EXIT

need_sudo() { sudo -v || exit 1; }

# ---------------------------------------------------------------------------

do_standard() {
  need_sudo
  bold "1/2  dsp_bench — the cross-board score (Pi 5 baseline was 330.8)"
  [ -x ./dsp_bench ] || cc -O2 -o dsp_bench dsp_bench.c -lm || { echo "build failed — is gcc installed?"; exit 1; }
  pin 1800
  taskset -c 0 ./dsp_bench | tee "$OUT/pi4b-dsp_bench.txt"
  reset
  echo "saved: $OUT/pi4b-dsp_bench.txt"

  bold "2/2  600 MHz re-run, hands-off (yesterday's one underrun came with a sync adjustment)"
  hands_off "1 BT speaker + built-in, party on"
  preflight_gate
  pin 600
  cap pi4b-1bt-600-handsoff "$DUR"
  reset
  listen pi4b-1bt-600-handsoff
  bold "standard done. Next: bash ~/pi4b-acceptance.sh builtin"
}

do_builtin() {
  bold "Built-in only — what the main chip does when the radios are not its problem"
  echo "Disconnect the Bluetooth speaker in the app (or power it off) so the party is the built-in alone."
  hands_off "built-in ONLY, no BT speaker connected, party on"
  cap pi4b-builtin "$DUR"
  listen pi4b-builtin
  bold "builtin done. Next: plug the two dongles in, pair the other two speakers, then: bash ~/pi4b-acceptance.sh extended"
}

do_extended() {
  need_sudo
  bold "EXTENDED — 3 BT + built-in"
  echo "Before you start:"
  echo "  • two extra dongles plugged in (one black USB 2.0 port, one blue), BT851 still in its black port"
  echo "  • one speaker per radio — check with:  ./bt-balance.sh show"
  echo "  • all three speakers + built-in in the party, sync set"
  read -r -p "Press enter to see the radio occupancy... "
  ./bt-balance.sh show 2>/dev/null || true
  hands_off "3 BT speakers + built-in, party on"
  preflight_gate
  cap pi4b-3bt "$DUR";            listen pi4b-3bt
  for mhz in 1200 900 600; do
    bold "pinned $mhz MHz"
    pin "$mhz"
    hands_off "same rig, still playing, hands off"
    cap "pi4b-3bt-$mhz" "$DUR";   listen "pi4b-3bt-$mhz"
  done
  reset
  echo "clock back to ondemand:"; ./constrain.sh show | grep -E "governor|current"
  bold "extended done. Keep the three speakers for the camping pair. Next: app → Settings → Camping, rejoin, ssh pi@192.168.4.1, then: bash ~/pi4b-acceptance.sh camping"
}

do_camping() {
  bold "Camping coexistence (E5) — $LONG s on the hotspot"
  if ! ip -4 addr show wlan0 | grep -q "192.168.4.1"; then
    echo "wlan0 is not 192.168.4.1 — you are not on the Campfire hotspot. Switch from the app first."
    exit 1
  fi
  sudo /usr/local/bin/campfire-bt-afh.sh 2>/dev/null && echo "AFH channel mask applied" || echo "(AFH script not present — noted)"
  hands_off "phone on the Campfire WiFi, AirPlay to Campfire, 3 BT + built-in, party on"
  preflight_gate
  cap pi4b-camping-3bt-$LONG "$LONG"
  listen pi4b-camping-3bt-$LONG
  echo
  echo "hostapd must show CPU > 0 in the summary above, or the capture did not see the AP."
  bold "camping done. Next: app → Settings → Home, rejoin home WiFi, ssh pi@campfire-bridge.local, then: bash ~/pi4b-acceptance.sh home-control"
}

do_home_control() {
  bold "Home control — the matched $LONG s run"
  if ip -4 addr show wlan0 | grep -q "192.168.4.1"; then
    echo "still on the hotspot — switch to Home first."; exit 1
  fi
  hands_off "home WiFi, same 3 BT + built-in, same volume, same music"
  preflight_gate
  cap pi4b-home-3bt-$LONG "$LONG"
  listen pi4b-home-3bt-$LONG
  bold "pair complete. Compare:  bash ~/pi4b-acceptance.sh report"
}

do_report() {
  bold "dsp_bench"
  grep -h SCORE "$OUT"/pi4b-dsp_bench.txt 2>/dev/null || echo "(not run)"
  bold "captures"
  ls "$OUT"/pi4b-*.json >/dev/null 2>&1 && python3 report.py "$OUT"/pi4b-*.json || echo "(no pi4b captures yet)"
  bold "listening notes"
  grep -h pi4b "$OUT/listening-notes.txt" 2>/dev/null || echo "(none)"
  echo
  echo "Copy the table into bridge/diagnostics/EXPERIMENTS.md under 'Pi 4B acceptance'."
}

# preflight.sh checks for EXPECT_BT radios and sinks; tell it which rig this is.
case "${1:-}" in
  standard)     export EXPECT_BT=1; do_standard ;;
  builtin)      export EXPECT_BT=0; do_builtin ;;
  extended)     export EXPECT_BT=3; do_extended ;;
  camping)      export EXPECT_BT=3; do_camping ;;
  home-control) export EXPECT_BT=3; do_home_control ;;
  report)       do_report ;;
  *) sed -n '2,20p' "$0"; exit 1 ;;
esac
