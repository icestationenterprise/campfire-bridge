#!/bin/bash
# Campfire Bridge — Camping Mode Daemon
#
# On boot: waits up to BOOT_TIMEOUT for a home WiFi connection via NetworkManager.
# If none found: activates the Campfire hotspot (wlan0 in AP/shared mode).
#
# Home mode:    if home WiFi stays down for HOME_LOSS_TICKS consecutive checks,
#               fall back to the hotspot. One missed check is a WiFi blip that
#               NetworkManager recovers from on its own — switching the radio to
#               AP mode on a blip is what used to kill AirPlay sessions.
# Camping mode: when a saved home network is in range, tear the hotspot down and
#               let NM reconnect. Never while a phone is joined to the hotspot —
#               that phone is the user, mid-party. Scanning also takes the AP
#               radio off-channel, so we don't scan while anyone is connected.
#
# Also polls REQUEST_FILE so POST /api/network/mode can trigger a switch without
# needing sudo from the Bridge API process. Writes the current mode ("home" or
# "camping") to STATE_FILE so the Bridge API can surface it in GET /api/status.

set -uo pipefail

STATE_FILE=/tmp/campfire-network-mode
REQUEST_FILE=/tmp/campfire-mode-request
HOTSPOT_CON=campfire-hotspot
HOTSPOT_IF=wlan0
BOOT_TIMEOUT=60      # seconds to wait at boot for home WiFi
CHECK_INTERVAL=30    # seconds between loop ticks
HOME_LOSS_TICKS=4    # consecutive ticks without home WiFi before falling back (4 × 30 s = 2 min)
RECONNECT_WAIT=45    # seconds to give NM to reconnect after the hotspot is stopped

write_state() { echo "$1" > "$STATE_FILE"; }
log() { echo "[camping-mode] $*"; }

# nmcli prints the connection type as "802-11-wireless" in terse (-t) mode and
# "wifi" in pretty mode. Match both — matching only "wifi" made these checks
# always fail, so the daemon believed it was camping while on home WiFi.
WIFI_TYPE='(wifi|802-11-wireless)'

# True if a non-hotspot WiFi connection is currently active in NM
home_wifi_active() {
  nmcli -t -f NAME,TYPE,STATE con show --active 2>/dev/null \
    | grep -E ":${WIFI_TYPE}:activated$" \
    | grep -qv "^${HOTSPOT_CON}:"
}

# True if the hotspot profile is actually up
hotspot_active() {
  nmcli -t -f NAME,STATE con show --active 2>/dev/null | grep -q "^${HOTSPOT_CON}:activated$"
}

# True if any saved home WiFi SSID is visible in the current scan results.
# Works even in AP mode on Pi's brcmfmac driver (background scan supported).
home_wifi_in_range() {
  local visible
  visible=$(nmcli -t -f SSID dev wifi list 2>/dev/null | sort -u)
  while IFS= read -r con_name; do
    [ -z "$con_name" ] && continue
    local ssid
    ssid=$(nmcli -t -f 802-11-wireless.ssid con show "$con_name" 2>/dev/null \
           | cut -d: -f2-)
    [ -z "$ssid" ] && continue
    echo "$visible" | grep -qxF "$ssid" && return 0
  done < <(nmcli -t -f NAME,TYPE con show 2>/dev/null \
             | grep -E ":${WIFI_TYPE}$" \
             | grep -v "^${HOTSPOT_CON}:" \
             | cut -d: -f1)
  return 1
}

# Number of stations currently associated with the hotspot.
hotspot_clients() {
  if command -v iw >/dev/null 2>&1; then
    iw dev "$HOTSPOT_IF" station dump 2>/dev/null | grep -c '^Station'
  else
    ip neigh show dev "$HOTSPOT_IF" 2>/dev/null | grep -c 'REACHABLE'
  fi
}

start_hotspot() {
  log "Starting Campfire hotspot"
  local out
  if out=$(nmcli con up "$HOTSPOT_CON" 2>&1); then
    write_state camping
  else
    log "Hotspot failed to start: $out"
    write_state home
  fi
}

stop_hotspot() {
  log "Stopping hotspot, waiting ${RECONNECT_WAIT}s for home WiFi..."
  nmcli con down "$HOTSPOT_CON" 2>&1 | sed 's/^/[camping-mode] /'
  write_state home
  sleep "$RECONNECT_WAIT"
  if home_wifi_active; then
    log "Reconnected to home WiFi"
  else
    log "Home WiFi did not connect — restarting hotspot"
    start_hotspot
  fi
}

# Called each loop tick. If the Bridge API wrote a mode request, act on it.
handle_api_request() {
  [ -f "$REQUEST_FILE" ] || return
  local requested
  requested=$(tr -d '[:space:]' < "$REQUEST_FILE" 2>/dev/null)
  rm -f "$REQUEST_FILE"
  local current
  current=$(cat "$STATE_FILE" 2>/dev/null || echo home)

  if [ "$requested" = "home" ] && [ "$current" = "camping" ]; then
    log "API requested home mode"
    stop_hotspot
  elif [ "$requested" = "camping" ] && [ "$current" = "home" ]; then
    log "API requested camping mode"
    start_hotspot
  fi
}

# Keep the Bluetooth radios off the WiFi channel. Cheap and idempotent.
steer_bluetooth() {
  [ -x /usr/local/bin/campfire-bt-afh.sh ] && /usr/local/bin/campfire-bt-afh.sh apply
}

# ── Boot: wait for home WiFi ──────────────────────────────────────────────────

write_state home
log "Waiting up to ${BOOT_TIMEOUT}s for home WiFi..."

elapsed=0
while [ "$elapsed" -lt "$BOOT_TIMEOUT" ]; do
  if home_wifi_active; then
    log "Connected to home WiFi"
    break
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

if ! home_wifi_active; then
  log "No home WiFi after ${BOOT_TIMEOUT}s"
  start_hotspot
fi
steer_bluetooth

# ── Monitoring loop ───────────────────────────────────────────────────────────

home_missing=0

while true; do
  sleep "$CHECK_INTERVAL"
  handle_api_request
  steer_bluetooth
  mode=$(cat "$STATE_FILE" 2>/dev/null || echo home)

  if [ "$mode" = "camping" ]; then
    home_missing=0
    if ! hotspot_active; then
      log "State says camping but the hotspot is down — correcting to home"
      write_state home
      continue
    fi
    clients=$(hotspot_clients)
    if [ "${clients:-0}" -gt 0 ]; then
      continue    # someone is using the hotspot — don't scan, don't switch
    fi
    if home_wifi_in_range; then
      log "Home WiFi in range and hotspot idle"
      stop_hotspot
    fi
  else
    if home_wifi_active; then
      home_missing=0
    else
      home_missing=$((home_missing + 1))
      log "Home WiFi down (${home_missing}/${HOME_LOSS_TICKS})"
      if [ "$home_missing" -ge "$HOME_LOSS_TICKS" ]; then
        home_missing=0
        start_hotspot
      fi
    fi
  fi
done
