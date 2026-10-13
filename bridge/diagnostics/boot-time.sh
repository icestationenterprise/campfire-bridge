#!/usr/bin/env bash
# boot-time.sh — E7 boot time gate. Run on the Pi after a FULL power cycle
# (pull the plug, don't `sudo reboot` — a warm reboot skips firmware init and
# flatters the number).
#
#   ./boot-time.sh
#
# Target: under 45 s from power-on to AirPlay available. Over that, plugging in
# at a campsite feels broken.
#
# IMPORTANT — read before trusting a "pass": shairport-sync is started by the
# bridge API only when party mode is enabled (see api/src/index.ts). After a
# cold boot with no party running, the Pi advertises NO AirPlay target at all,
# no matter how fast it booted. This script measures the three stages it can
# measure and tells you which part of the gate is architecture, not speed.

set -uo pipefail

hr() { printf '%s\n' "────────────────────────────────────────────────────────"; }
ms_to_s() { awk -v us="$1" 'BEGIN{printf "%.1f", us/1000000}'; }

hr; echo "1. KERNEL + USERSPACE"; hr
systemd-analyze 2>/dev/null || echo "systemd-analyze unavailable"
echo

hr; echo "2. SLOWEST UNITS (top 15)"; hr
systemd-analyze blame 2>/dev/null | head -15
echo
echo "User units:"
systemd-analyze --user blame 2>/dev/null | head -10
echo

hr; echo "3. STAGE TIMES SINCE POWER-ON"; hr
# Monotonic timestamps are microseconds since kernel start.
for u in bluetooth.service NetworkManager.service avahi-daemon.service campfire-camping-mode.service; do
  t=$(systemctl show "$u" -p ActiveEnterTimestampMonotonic --value 2>/dev/null)
  [ -n "$t" ] && [ "$t" != "0" ] && printf '  %-34s %6s s\n' "$u" "$(ms_to_s "$t")"
done
for u in pulseaudio.service campfire-bridge.service shairport-sync.service; do
  t=$(systemctl --user show "$u" -p ActiveEnterTimestampMonotonic --value 2>/dev/null)
  if [ -n "$t" ] && [ "$t" != "0" ]; then
    printf '  %-34s %6s s  (user)\n' "$u" "$(ms_to_s "$t")"
  else
    printf '  %-34s %6s\n' "$u" "not started"
  fi
done
echo

hr; echo "4. IS THE API ACTUALLY ANSWERING?"; hr
if curl -s --max-time 3 http://127.0.0.1:3000/api/status >/dev/null 2>&1; then
  echo "  /api/status responds"
else
  echo "  /api/status NOT responding"
fi
echo

hr; echo "5. IS AN AIRPLAY TARGET BEING ADVERTISED?"; hr
if systemctl --user is-active --quiet shairport-sync; then
  echo "  shairport-sync: active"
  if command -v avahi-browse >/dev/null; then
    echo "  mDNS _raop._tcp records:"
    timeout 5 avahi-browse -tp _raop._tcp 2>/dev/null | grep '^=' | cut -d';' -f7 | sort -u | sed 's/^/    /'
  fi
else
  echo "  shairport-sync: INACTIVE — no AirPlay target is being advertised."
  echo
  echo "  This is the architectural half of the E7 gate, not a speed problem:"
  echo "  the API starts shairport-sync only on POST /api/party/enable, so after"
  echo "  a cold boot nothing appears on the phone until the user opens the app,"
  echo "  reconnects speakers and starts the party."
  echo
  echo "  E7 cannot pass as written until work-order #16 (boot auto-reconnect)"
  echo "  lands and the device restores its party on boot by itself."
fi
echo

hr; echo "6. STOPWATCH — the only number that is the real gate"; hr
cat <<'TXT'
  Power-cycle the Pi and time, by hand, from plugging it in to the Campfire
  target appearing in your iPhone's Control Center AirPlay list.

  With the current architecture that requires the app, so record BOTH:
    a) power-on -> /api/status answering   (what section 3/4 above measures)
    b) power-on -> AirPlay target visible  (needs #16 to be automatic)

  Write both into EXPERIMENTS.md under E7, with the method noted.
TXT
