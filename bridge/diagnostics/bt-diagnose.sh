#!/usr/bin/env bash
# bt-diagnose.sh <speaker-mac> — find out why one BT speaker refuses to connect.
#
# Run ON THE PI as the same user the bridge runs as:
#     ./bt-diagnose.sh AA:BB:CC:DD:EE:FF
#
# The Bridge API reports "Failed to connect <mac> via hciX" for every failure,
# which hides the only thing that matters — BlueZ's actual reason. This script
# reproduces the connect by hand and prints the raw error, plus the adapter and
# pairing state needed to interpret it.

set -uo pipefail
MAC=$(tr 'a-z' 'A-Z' <<<"${1:?usage: $0 <speaker-mac>}")
BT=$(command -v bluetoothctl) || { echo "bluetoothctl not found"; exit 1; }

hr() { printf '\n== %s ==\n' "$1"; }

# Run bluetoothctl commands against one adapter (by adapter MAC).
btctl() {  # btctl <adapter-mac|-> <timeout> <cmd...>
  local amac=$1 t=$2; shift 2
  { [ "$amac" != "-" ] && printf 'select %s\n' "$amac"
    printf '%s\n' "$@"
    sleep "$t"
    printf 'quit\n'
  } | timeout $((t + 5)) "$BT" 2>&1
}

hr "adapters"
if command -v hciconfig >/dev/null; then
  hciconfig -a | grep -E '^hci|BD Address|Bus:|UP|DOWN' | sed 's/^/  /'
else
  echo "  hciconfig missing: sudo apt install bluez-tools"
fi
# id|mac|bus|up   (Bus: lives on the "hciN:" line, state on its own line)
AMACS=()
while IFS= read -r _line; do [ -n "$_line" ] && AMACS+=("$_line"); done < <(hciconfig -a 2>/dev/null | awk '
  /^hci/ {id=$1; sub(":","",id); bus=($0 ~ /Bus: USB/) ? "USB" : "UART"; mac=""}
  /BD Address/ {mac=$3}
  /^[ \t]+(UP|DOWN)/ {print id"|"mac"|"bus"|"(($0 ~ /UP/) ? "UP" : "DOWN")}')

echo
echo "  parsed: ${#AMACS[@]} adapter(s)"
for a in "${AMACS[@]}"; do
  IFS='|' read -r id amac bus up <<<"$a"
  printf '    %-6s %-17s %-5s %s\n' "$id" "$amac" "$bus" "$up"
done
usb_count=$(printf '%s\n' "${AMACS[@]}" | grep -c '|USB|UP$')
echo "  USB dongles UP: $usb_count"
[ "$usb_count" -eq 0 ] && cat <<'WARN'
  *** NO USB DONGLES DETECTED ***
  assignAdapter() falls back to the built-in UART adapter when no USB adapter
  is up. That is almost certainly why you are seeing hci0. Check `lsusb` and
  reseat the dongles before anything else.
WARN

hr "where is $MAC paired?"
found_on=""
for a in "${AMACS[@]}"; do
  IFS='|' read -r id amac bus up <<<"$a"
  if [ "$up" != "UP" ]; then
    echo "  $id ($bus) is DOWN — skipped"
    continue
  fi
  out=$(btctl "$amac" 3 "devices Paired")
  if grep -qi "$MAC" <<<"$out"; then
    echo "  PAIRED on $id ($bus, $amac)"
    found_on="$id|$amac|$bus"
  else
    echo "  not paired on $id ($bus)"
  fi
done
if [ -z "$found_on" ]; then cat <<'WARN'
  *** NOT PAIRED ON ANY ADAPTER ***
  connectDevice() calls findAdapterForPairedDevice(), gets null, then falls
  back to assignAdapter() load-balancing -> picks an adapter the speaker was
  never paired to -> connect fails. You must PAIR it, not just connect.
WARN
elif [ "${found_on##*|}" = "UART" ]; then cat <<'WARN'
  *** PAIRED ON THE BUILT-IN UART ADAPTER ***
  findAdapterForPairedDevice() only searches USB adapters, so it will never
  find this pairing. Remove it and re-pair so it lands on a USB dongle.
WARN
fi

hr "device info"
btctl "-" 3 "info $MAC" | sed 's/^/  /'

hr "currently connected links per adapter"
for a in "${AMACS[@]}"; do
  IFS='|' read -r id amac bus up <<<"$a"
  printf '  %s: ' "$id"
  hcitool -i "$id" con 2>/dev/null | tail -n +2 | tr -s ' ' | paste -sd';' - || echo "(none)"
done

hr "A2DP sink endpoints (PulseAudio)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export PULSE_SERVER="${PULSE_SERVER:-unix:$XDG_RUNTIME_DIR/pulse/native}"
if pactl info >/dev/null 2>&1; then
  pactl list cards short | sed 's/^/  /'
  echo "  --- bluez sinks ---"
  pactl list short sinks | grep -i bluez | sed 's/^/  /' || echo "  (no bluez sinks)"
else
  cat <<'WARN'
  *** PULSEAUDIO UNREACHABLE FROM THIS SHELL ***
  If PulseAudio is not running, BlueZ has no A2DP endpoint to hand the speaker
  to and connects fail with br-connection-profile-unavailable.
  Check: systemctl --user status pulseaudio
WARN
fi

hr "LIVE CONNECT ATTEMPT — this is the answer"
target_mac="-"; target_id="default"
if [ -n "$found_on" ]; then
  IFS='|' read -r target_id target_mac _bus <<<"$found_on"
fi
echo "  attempting via ${target_id} (${target_mac})"
echo "  ----- raw bluetoothctl output -----"
raw=$(btctl "$target_mac" 12 "connect $MAC")
sed 's/^/  /' <<<"$raw"
echo "  -----------------------------------"

hr "verdict"
case "$raw" in
  *"Connection successful"*)
      echo "  CONNECTED. The speaker is fine — retry through the app now." ;;
  *br-connection-page-timeout*|*"Page Timeout"*)
      cat <<'V'
  br-connection-page-timeout = the speaker never answered the radio.
  Almost always one of:
    1. It is already connected to your PHONE (Sony speakers grab the last
       device aggressively). Turn Bluetooth off on your phone, or hold the
       speaker's BT button to drop its current link, then retry.
    2. It is powered off, asleep, or out of range.
V
      ;;
  *profile-unavailable*)
      cat <<'V'
  br-connection-profile-unavailable = the link worked but no A2DP sink endpoint
  was offered. This is a PulseAudio/BlueZ problem on the Pi, not the speaker:
    systemctl --user status pulseaudio
    pactl list cards short        # expect a bluez card once connected
V
      ;;
  *"br-connection-busy"*|*"in progress"*)
      echo "  Adapter busy — a previous connect/scan is still running. Wait 15s, retry." ;;
  *"Device "*"not available"*)
      echo "  Not available on this adapter = no pairing record here. Re-pair the speaker." ;;
  *"Failed to connect"*)
      echo "  Failed with the reason shown above — match it against BlueZ error codes." ;;
  *)  echo "  No terminal result within the timeout. Check the raw output above." ;;
esac

hr "recent bluetoothd errors"
journalctl -u bluetooth --since "-10 min" --no-pager 2>/dev/null \
  | grep -iE 'error|fail|refused|timeout' | tail -20 | sed 's/^/  /' \
  || echo "  (none, or journal unavailable)"
