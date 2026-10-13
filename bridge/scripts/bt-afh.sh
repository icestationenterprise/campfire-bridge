#!/bin/bash
# Campfire Bridge — Bluetooth channel steering (AFH host classification)
#
# Three USB Bluetooth radios sit a few centimetres from the Pi's WiFi antenna.
# Left alone they hop across all 79 Bluetooth channels, including the ~22 MHz
# the Pi's own 2.4 GHz WiFi link occupies, and the WiFi link collapses to
# 1 Mbit/s while speakers stream. Each controller has its own adaptive
# frequency hopping, but it assesses channels slowly and re-enables them
# periodically — the "works for 30 s, dies for a minute" cycle.
#
# The Bluetooth spec lets the host declare channels bad up front
# (HCI Set_AFH_Host_Channel_Classification, OGF 0x03 OCF 0x003F). This script
#   1. masks the Pi's own WiFi channel (±12 MHz) on every adapter when the Pi
#      is on 2.4 GHz (client or hotspot);
#   2. optionally (AFH_PARTITION=1) gives each adapter its own slice of the
#      band so the speakers' links never collide with each other. Only done
#      when WiFi is on 5 GHz or down: the spec requires ≥ 20 usable channels
#      per adapter, and 79 − 25 masked is not enough for three disjoint slices.
#      Off by default — narrow slices lose the controller's freedom to dodge
#      the neighbours' WiFi, which is usually the better trade.
#
# Idempotent: re-applies only when the WiFi channel or adapter set changes
# (the classification does not survive an adapter reset). Needs root.
#
# Usage: campfire-bt-afh.sh         apply (camping-mode.sh calls this every tick)
#        campfire-bt-afh.sh show    print the plan without applying
#        campfire-bt-afh.sh clear   re-enable all channels everywhere

set -uo pipefail

WLAN_IF=${WLAN_IF:-wlan0}
AFH_PARTITION=${AFH_PARTITION:-0}
STATE_FILE=/run/campfire-bt-afh
GUARD_MHZ=12
log() { echo "[bt-afh] $*"; }

# MHz of the current WiFi link or AP; empty when WiFi is down.
wifi_freq() {
  iw dev "$WLAN_IF" info 2>/dev/null | sed -n 's/.*channel [0-9]* (\([0-9]*\) MHz).*/\1/p' | head -1
}

adapters() { ls /sys/class/bluetooth 2>/dev/null | grep '^hci' | sort -V; }

# Print the 10-byte little-endian mask (hex, no spaces) for a range of
# channels to DISABLE: lo..hi inclusive, or "-" for none.
# Bit k = 1 → channel k usable; 0 → bad. Bit 79 is reserved and must be 0.
mask_disable() {
  python3 - "$1" "$2" <<'PY'
import sys
lo, hi = sys.argv[1], sys.argv[2]
bits = [1] * 79
if lo != "-":
    for k in range(max(0, int(lo)), min(78, int(hi)) + 1):
        bits[k] = 0
if sum(bits) < 20:
    sys.exit("fewer than 20 channels left — refusing")
b = bytearray(10)
for k, v in enumerate(bits):
    if v: b[k // 8] |= 1 << (k % 8)
print(b.hex())
PY
}

# Mask that ENABLES only channels lo..hi (for partitioning).
mask_enable_only() {
  python3 - "$1" "$2" <<'PY'
import sys
lo, hi = int(sys.argv[1]), int(sys.argv[2])
if hi - lo + 1 < 20:
    sys.exit("slice narrower than 20 channels — refusing")
b = bytearray(10)
for k in range(lo, hi + 1):
    b[k // 8] |= 1 << (k % 8)
print(b.hex())
PY
}

# Send Set_AFH_Host_Channel_Classification to one adapter.
apply_mask() {
  local hci=$1 mask=$2 idx=${1#hci}
  python3 - "$idx" "$mask" <<'PY' && return 0
import socket, struct, sys
idx, mask = int(sys.argv[1]), bytes.fromhex(sys.argv[2])
s = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_RAW, socket.BTPROTO_HCI)
s.bind((idx,))
# receive only Command Complete events
s.setsockopt(socket.SOL_HCI, socket.HCI_FILTER, struct.pack("IIIh2x", 1 << 4, 1 << 0x0E, 0, 0))
s.send(b"\x01" + struct.pack("<HB", 0x0C3F, 10) + mask)
s.settimeout(2)
try:
    r = s.recv(260)
    if len(r) >= 7 and r[1] == 0x0E and r[6] != 0:
        sys.exit(f"controller returned status 0x{r[6]:02x}")
except socket.timeout:
    pass
PY
  # Fallback for Pythons built without AF_BLUETOOTH
  if command -v hcitool >/dev/null 2>&1; then
    hcitool -i "$hci" cmd 0x03 0x003f $(echo "$mask" | sed 's/../& /g') >/dev/null
  else
    return 1
  fi
}

plan() {   # prints "<hci> <mask> <description>" per adapter
  local freq; freq=$(wifi_freq)
  local list; list=$(adapters)
  local n; n=$(echo "$list" | grep -c .)
  if [ -n "$freq" ] && [ "$freq" -lt 3000 ]; then
    local lo=$((freq - GUARD_MHZ - 2402)) hi=$((freq + GUARD_MHZ - 2402))
    local mask; mask=$(mask_disable "$lo" "$hi") || return 1
    for h in $list; do echo "$h $mask avoid-wifi-${freq}MHz(ch$lo-$hi)"; done
  elif [ "$AFH_PARTITION" = "1" ] && [ "$n" -ge 2 ] && [ "$n" -le 3 ]; then
    local i=0 width=$((79 / n))
    for h in $list; do
      local lo=$((i * width)) hi=$(( i == n - 1 ? 78 : (i + 1) * width - 1 ))
      local mask; mask=$(mask_enable_only "$lo" "$hi") || return 1
      echo "$h $mask slice(ch$lo-$hi)"
      i=$((i + 1))
    done
  else
    for h in $list; do echo "$h ffffffffffffffffff7f all-channels"; done
  fi
}

case "${1:-apply}" in
  show)
    plan
    ;;
  clear)
    for h in $(adapters); do apply_mask "$h" ffffffffffffffffff7f && log "$h: all channels enabled"; done
    rm -f "$STATE_FILE"
    ;;
  apply)
    current=$(plan) || { log "no plan: $current"; exit 1; }
    [ "$current" = "$(cat "$STATE_FILE" 2>/dev/null)" ] && exit 0
    ok=1
    while read -r h mask why; do
      [ -z "$h" ] && continue
      if apply_mask "$h" "$mask"; then log "$h: $why"; else log "$h: FAILED to apply ($why)"; ok=0; fi
    done <<< "$current"
    [ "$ok" = 1 ] && echo "$current" > "$STATE_FILE"
    ;;
  *)
    echo "usage: $0 [apply|show|clear]" >&2; exit 2
    ;;
esac
