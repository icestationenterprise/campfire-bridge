#!/bin/bash
# Campfire Bridge — Camping Mode Daemon
#
# On boot: waits up to 60 s for a home WiFi connection via NetworkManager.
# If none found: activates the Campfire hotspot (wlan0 in AP/shared mode).
# While in hotspot mode: scans every 30 s; if a saved home network is
# visible, tears down the hotspot and lets NM reconnect automatically.
#
# Writes current mode ("home" or "camping") to /tmp/campfire-network-mode
# so the Bridge API can surface it in GET /api/status.

set -uo pipefail

STATE_FILE=/tmp/campfire-network-mode
HOTSPOT_CON=campfire-hotspot
BOOT_TIMEOUT=60   # seconds to wait at boot for home WiFi
CHECK_INTERVAL=30 # seconds between scans while in hotspot mode

write_state() { echo "$1" > "$STATE_FILE"; }

# True if a non-hotspot WiFi connection is currently active in NM
home_wifi_active() {
  nmcli -t -f NAME,TYPE,STATE con show --active 2>/dev/null \
    | grep ':wifi:activated' \
    | grep -qv "^${HOTSPOT_CON}:"
}

# True if any saved home WiFi SSID is visible in the current scan results.
# Does NOT disconnect anyone — purely passive check.
home_wifi_in_range() {
  local visible
  visible=$(nmcli -t -f SSID dev wifi list 2>/dev/null | sort -u)
  while IFS= read -r con_name; do
    [ -z "$con_name" ] && continue
    local ssid
    ssid=$(nmcli -t -f 802-11-wireless.ssid con show "$con_name" 2>/dev/null \
           | cut -d: -f2-)
    [ -z "$ssid" ] && continue
    echo "$visible" | grep -qF "$ssid" && return 0
  done < <(nmcli -t -f NAME,TYPE con show 2>/dev/null \
             | grep ':wifi$' \
             | grep -v "^${HOTSPOT_CON}:" \
             | cut -d: -f1)
  return 1
}

start_hotspot() {
  echo "[camping-mode] No home WiFi — starting Campfire hotspot"
  nmcli con up "$HOTSPOT_CON" 2>/dev/null || true
  write_state camping
}

stop_hotspot() {
  echo "[camping-mode] Home WiFi in range — stopping hotspot"
  nmcli con down "$HOTSPOT_CON" 2>/dev/null || true
  write_state home
}

# ── Boot: wait for home WiFi ──────────────────────────────────────────────────

write_state home
echo "[camping-mode] Waiting up to ${BOOT_TIMEOUT}s for home WiFi..."

elapsed=0
while [ "$elapsed" -lt "$BOOT_TIMEOUT" ]; do
  if home_wifi_active; then
    echo "[camping-mode] Connected to home WiFi"
    break
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

home_wifi_active || start_hotspot

# ── Monitoring loop ───────────────────────────────────────────────────────────

while true; do
  sleep "$CHECK_INTERVAL"
  mode=$(cat "$STATE_FILE" 2>/dev/null || echo home)

  if [ "$mode" = "camping" ]; then
    if home_wifi_in_range; then
      stop_hotspot
      sleep 15  # give NM time to auto-connect
      home_wifi_active || start_hotspot  # re-activate if auto-connect failed
    fi
  else
    if ! home_wifi_active; then
      start_hotspot
    fi
  fi
done
