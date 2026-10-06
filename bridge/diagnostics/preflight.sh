#!/usr/bin/env bash
# preflight.sh — verify the rig is in a measurable state BEFORE running capture.py.
#
#   ./preflight.sh
#
# Exists because a capture of an idle or already-broken system looks like a
# successful run and produces numbers that are quietly meaningless. Every check
# below is one that has actually invalidated a run on this rig.
#
# Exits 0 (GO) only if everything passes.

set -uo pipefail
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export PULSE_SERVER="${PULSE_SERVER:-unix:$XDG_RUNTIME_DIR/pulse/native}"

EXPECT_BT=${EXPECT_BT:-3}     # how many BT speakers you intend to measure
fail=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; }

echo "== 1. adapters =="
usb_up=$(hciconfig -a 2>/dev/null | awk '/^hci/{u=($0~/Bus: USB/)} /^[ \t]+UP/{if(u)n++} END{print n+0}')
[ "$usb_up" -ge "$EXPECT_BT" ] \
  && ok "$usb_up USB dongles up (need >= $EXPECT_BT)" \
  || bad "only $usb_up USB dongles up, need $EXPECT_BT — reseat them"

if hciconfig 2>/dev/null | grep -q INQUIRY; then
  bad "an adapter is in INQUIRY (scanning) — inquiry wrecks A2DP; stop the scan"
else
  ok "no adapter is scanning"
fi

echo
echo "== 2. one audio link per radio =="
overloaded=0
for d in /sys/class/bluetooth/hci*; do
  [ -e "$d" ] || continue
  hci=$(basename "$d")
  n=$(hcitool -i "$hci" con 2>/dev/null | grep -c ACL)
  [ "$n" -gt 1 ] && { bad "$hci carries $n links — two A2DP streams on one radio chop"; overloaded=1; }
done
[ "$overloaded" -eq 0 ] && ok "no radio carries more than one link"

echo
echo "== 3. sinks exist =="
sinks=$(pactl list short sinks 2>/dev/null)
if [ -z "$sinks" ]; then
  bad "PulseAudio unreachable — nothing can be measured"
else
  nbt=$(grep -c bluez_sink <<<"$sinks")
  [ "$nbt" -eq "$EXPECT_BT" ] \
    && ok "$nbt bluez sinks" \
    || bad "$nbt bluez sinks, expected $EXPECT_BT"
  grep -q 'alsa_output' <<<"$sinks" \
    && ok "wired/built-in sink present" \
    || bad "no alsa_output sink — the built-in speaker is not in the mix"
  grep -q 'campfire_party' <<<"$sinks" \
    && ok "campfire_party null sink present (party mode wired up)" \
    || warn "no campfire_party sink — is party mode enabled?"
fi

echo
echo "== 4. IS AUDIO ACTUALLY FLOWING? =="
echo "     (the check that matters most — a capture of silence looks fine and means nothing)"
running=$(awk -F'\t' '/bluez_sink|alsa_output/ && $NF ~ /RUNNING/' <<<"$sinks" | wc -l)
total=$(awk -F'\t' '/bluez_sink|alsa_output/' <<<"$sinks" | wc -l)
if [ "$running" -eq 0 ]; then
  bad "0 of $total sinks are RUNNING — everything is SUSPENDED/IDLE."
  echo "        Start AirPlay from your phone and play a track, then re-run."
elif [ "$running" -lt "$total" ]; then
  bad "only $running of $total sinks are RUNNING:"
  awk -F'\t' '/bluez_sink|alsa_output/ {printf "          %-55s %s\n", $2, $NF}' <<<"$sinks"
else
  ok "all $total sinks RUNNING — audio is flowing to every output"
fi

echo
echo "== 5. the AirPlay path =="
pgrep -x shairport-sync >/dev/null && ok "shairport-sync running" || bad "shairport-sync not running"
pgrep -x nqptp          >/dev/null && ok "nqptp running (AirPlay 2 timing)" || warn "nqptp not running"

echo
echo "== 6. recent audio faults =="
faultlines=$(journalctl --since "-2 min" --no-pager 2>/dev/null \
             | grep -iE 'underrun|xrun|a2dp.*fail|too slow')
f=$(printf '%s' "$faultlines" | grep -c . )
if [ "$f" -gt 0 ]; then
  bad "$f audio fault lines in the last 2 min:"
  printf '%s\n' "$faultlines" | tail -6 | sed 's/^/          /'
  cat <<'HINT'
        If these line up with when you connected the speakers or started the
        stream, they are SETUP TRANSIENTS, not a real fault — PulseAudio emits
        them while it builds the loopbacks. Keep the music playing, wait two
        minutes so they age out of the window, and re-run this script.
        If they keep appearing during steady playback, stop and investigate.
HINT
else
  ok "journal clean for the last 2 minutes"
fi

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32m== GO ==\033[0m  rig is in a measurable state.\n'
  echo "Next: python3 capture.py --label extended-3bt --duration 180"
  echo "      (let it run the FULL 180s — do not Ctrl-C)"
  exit 0
else
  printf '\033[31m== NO-GO ==\033[0m  fix the FAIL lines above first.\n'
  echo "A capture taken now would produce numbers that look valid and are not."
  exit 1
fi
