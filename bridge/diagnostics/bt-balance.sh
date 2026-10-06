#!/usr/bin/env bash
# bt-balance.sh — show and fix how speakers are spread across the BT dongles.
#
#   ./bt-balance.sh show
#   ./bt-balance.sh move AA:BB:CC:DD:EE:FF hci1
#
# WHY THIS MATTERS
# One USB Bluetooth controller cannot cleanly carry two simultaneous A2DP
# streams. It time-slices the radio between the two ACL links, and on budget
# dongles the result is audible chopping on one or both speakers. The product
# design is one speaker per dongle for exactly this reason.
#
# The bond decides the radio: connectDevice() looks up which adapter a speaker
# is PAIRED on and connects there. So moving a speaker to another dongle means
# moving its bond — remove it from the old adapter and pair it on the new one.
# There is no way to "just connect it elsewhere".

set -uo pipefail
BT=$(command -v bluetoothctl) || { echo "bluetoothctl not found"; exit 1; }

# id|mac|bus|up  (Bus: is on the "hciN:" line, state is on its own line)
list_adapters() {
  hciconfig -a 2>/dev/null | awk '
    /^hci/ {id=$1; sub(":","",id); bus=($0 ~ /Bus: USB/) ? "USB" : "UART"; mac=""}
    /BD Address/ {mac=$3}
    /^[ \t]+(UP|DOWN)/ {print id"|"mac"|"bus"|"(($0 ~ /UP/) ? "UP" : "DOWN")}'
}

btctl() {  # btctl <adapter-mac|-> <settle-seconds> <cmd...>
  local amac=$1 t=$2; shift 2
  { [ "$amac" != "-" ] && printf 'select %s\n' "$amac"
    printf '%s\n' "$@"
    sleep "$t"
    printf 'quit\n'
  } | timeout $((t + 10)) "$BT" 2>&1
}

adapter_mac_of() {  # hciN -> BD address
  list_adapters | awk -F'|' -v want="$1" '$1==want {print $2}'
}

# Active ACL links on an adapter (one MAC per line).
links_on() { hcitool -i "$1" con 2>/dev/null | awk '/ACL/ {print $3}'; }

cmd_show() {
  local overloaded=0
  printf '%-6s %-17s %-5s %-5s %s\n' ADAPTER ADDRESS BUS STATE "ACTIVE LINKS / BONDED"
  while IFS='|' read -r id amac bus up; do
    [ -z "$id" ] && continue
    local links n bonded
    links=$(links_on "$id" | tr '\n' ' ')
    n=$(links_on "$id" | grep -c . )
    bonded=$(btctl "$amac" 2 "devices Paired" 2>/dev/null \
             | awk '/^[[:space:]]*Device[[:space:]]/ {print $2}' \
             | sort -u | tr '\n' ' ')
    printf '%-6s %-17s %-5s %-5s links:[%s] bonded:[%s]\n' "$id" "$amac" "$bus" "$up" "${links% }" "${bonded% }"
    if [ "$n" -gt 1 ]; then
      overloaded=1
      echo "       ^^ $n simultaneous links on one radio — this is what causes choppy audio"
    fi
  done < <(list_adapters)

  if [ "$overloaded" -eq 1 ]; then
    echo
    echo "FIX: move one of them to an idle dongle, e.g."
    echo "  ./bt-balance.sh move <speaker-mac> <idle-hciN>"
  else
    echo
    echo "Balance looks fine — at most one active audio link per dongle."
  fi
}

cmd_move() {
  local mac target
  mac=$(tr 'a-z' 'A-Z' <<<"${1:?usage: move <device-mac> <target-hciN>}")
  target=${2:?usage: move <device-mac> <target-hciN>}

  local tmac; tmac=$(adapter_mac_of "$target")
  [ -n "$tmac" ] || { echo "error: $target not found. Adapters:"; list_adapters; exit 1; }

  echo "== target =="
  echo "  $target ($tmac)"
  local tn; tn=$(links_on "$target" | grep -c .)
  if [ "$tn" -gt 0 ]; then
    echo "  WARNING: $target already has $tn active link(s):"
    links_on "$target" | sed 's/^/    /'
    echo "  Moving here would recreate the same problem. Pick an idle dongle."
    read -r -p "  continue anyway? [y/N] " yn
    [ "$yn" = "y" ] || exit 1
  fi

  echo
  echo "== removing the old bond =="
  local src=""
  while IFS='|' read -r id amac bus up; do
    [ "$up" = "UP" ] || continue
    if btctl "$amac" 2 "devices Paired" | grep -qi "$mac"; then
      echo "  bonded on $id — disconnecting and removing"
      btctl "$amac" 3 "disconnect $mac" >/dev/null
      btctl "$amac" 3 "remove $mac"     >/dev/null
      src=$id
    fi
  done < <(list_adapters)
  [ -n "$src" ] || echo "  (no existing bond found — continuing)"

  echo
  echo "== put the device into PAIRING MODE now =="
  echo "  WH-1000XM4: hold the power button ~7s until it says 'Bluetooth pairing'"
  echo "  Most speakers: hold the Bluetooth button until it flashes rapidly"
  echo "  Keep it in pairing mode for the next ~60 seconds."
  read -r -p "  press enter once it is flashing/announcing pairing... "

  # Discovery, pair, trust and connect MUST all happen inside ONE bluetoothctl
  # session. BlueZ stores discovered-but-unbonded devices as temporary,
  # per-adapter entries that are dropped once discovery stops -- so scanning in
  # a separate process and then pairing in a new one always fails with
  # "Device ... not available", even though the scan just saw it.
  echo
  echo "== scan + pair + connect on $target (single session, ~60s) =="
  local log=/tmp/bt-move-$target.log
  {
    printf 'select %s\n' "$tmac"; sleep 2
    printf 'scan on\n';           sleep 20
    printf 'pair %s\n'    "$mac"; sleep 20
    printf 'trust %s\n'   "$mac"; sleep 3
    printf 'connect %s\n' "$mac"; sleep 12
    printf 'scan off\n';          sleep 1
    printf 'quit\n'
  } | timeout 90 "$BT" > "$log" 2>&1

  local paired=0 connected=0
  grep -qi "Pairing successful\|already paired\|Paired: yes" "$log" && paired=1
  grep -qi "Connection successful\|already connected"          "$log" && connected=1

  if [ "$paired" -eq 1 ]; then echo "  paired on $target"; else
    echo "  PAIR FAILED. Most likely causes, in order:"
    echo "    1. The device was not actually in pairing mode for the whole window."
    echo "    2. Another radio grabbed it first (phone, laptop, the other dongle)."
    echo "    3. Inquiry running on a different adapter drowned it out — see"
    echo "       './bt-balance.sh show' and check for stray discovery."
    echo "  Relevant lines from $log:"
    grep -iE "not available|fail|refus|timeout|Pairing|AuthenticationFailed" "$log" \
      | tail -15 | sed 's/^/    /'
    exit 1
  fi
  [ "$connected" -eq 1 ] && echo "  connected on $target" \
                         || echo "  paired but not confirmed connected — check $log"

  echo
  cmd_show
}

case "${1:-show}" in
  show) cmd_show ;;
  move) shift; cmd_move "$@" ;;
  *) sed -n '2,20p' "$0"; exit 1 ;;
esac
