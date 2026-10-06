#!/usr/bin/env bash
# bt-identify.sh — map every hciN to the physical USB port it lives in, and say
# definitively whether the Pi's built-in radio is in play.
#
#   ./bt-identify.sh
#
# Answers three questions:
#   1. Is any adapter the Pi's BUILT-IN radio?  (Bus: UART, not USB)
#   2. Which physical USB port is each dongle in, and is it a USB3 port?
#   3. Which dongle is which, physically — unplug one and re-run.

set -uo pipefail

hr() { printf '\n== %s ==\n' "$1"; }

hr "is the built-in radio disabled?"
if grep -qs "dtoverlay=disable-bt" /boot/firmware/config.txt /boot/config.txt; then
  echo "  YES — 'dtoverlay=disable-bt' is set in config.txt."
  echo "  The Pi's built-in Bluetooth is off at the device-tree level."
else
  echo "  'dtoverlay=disable-bt' NOT found in config.txt."
  echo "  If a UART adapter appears below, the built-in radio IS active."
fi
echo
echo "  rfkill:"
rfkill list bluetooth 2>/dev/null | sed 's/^/    /' || echo "    (rfkill unavailable)"

hr "adapters"
# /sys/class/bluetooth/hciN/address is not readable on every kernel, so take
# addresses from hciconfig, which is authoritative.
addr_of() {
  hciconfig -a 2>/dev/null | awk -v want="$1" '
    /^hci/ {id=$1; sub(":","",id)}
    /BD Address/ {if (id==want) {print $3; exit}}'
}
printf '  %-6s %-17s %-6s %-9s %-10s %s\n' HCI ADDRESS BUS SPEED USBID "PHYSICAL PATH"
found_uart=0
for d in /sys/class/bluetooth/hci*; do
  [ -e "$d" ] || continue
  hci=$(basename "$d")
  # Skip hciN:M child nodes (individual connections) — only real adapters here.
  case "$hci" in *:*) continue ;; esac
  addr=$(addr_of "$hci"); [ -n "$addr" ] || addr="?"

  # Resolve the sysfs device this adapter hangs off.
  real=$(readlink -f "$d/device" 2>/dev/null)
  if [ -z "$real" ] || [[ "$real" != *usb* ]]; then
    # No USB ancestry => it is the SoC's own radio (UART/SDIO on a Pi).
    printf '  %-6s %-17s %-6s %-9s %-10s %s\n' \
      "$hci" "$addr" "UART" "-" "-" "${real:-unknown} (BUILT-IN)"
    found_uart=1
    continue
  fi

  # Walk up from the USB interface to the USB device directory (has idVendor).
  usbdev=$real
  while [ -n "$usbdev" ] && [ "$usbdev" != "/" ] && [ ! -f "$usbdev/idVendor" ]; do
    usbdev=$(dirname "$usbdev")
  done

  local_speed="?" usbid="?" port="?"
  if [ -f "$usbdev/idVendor" ]; then
    usbid="$(cat "$usbdev/idVendor"):$(cat "$usbdev/idProduct")"
    local_speed="$(cat "$usbdev/speed" 2>/dev/null || echo '?')"
    port=$(basename "$usbdev")
  fi

  case "$local_speed" in
    5000|10000) spd="USB3" ;;
    480)        spd="480M" ;;
    12)         spd="12M-FS" ;;    # full speed — NORMAL for a BT dongle
    1.5)        spd="1.5M-LS" ;;
    *)          spd="$local_speed" ;;
  esac

  printf '  %-6s %-17s %-6s %-9s %-10s %s\n' \
    "$hci" "$addr" "USB" "$spd" "$usbid" "$port"
done

hr "verdict"
if [ "$found_uart" -eq 1 ]; then
  echo "  A BUILT-IN (UART) adapter is present and enabled."
  echo "  Per the product design it should be disabled. Add to config.txt:"
  echo "      dtoverlay=disable-bt"
  echo "  then reboot."
else
  echo "  NO built-in adapter is in play. Every hciN above is a USB dongle."
  echo "  The Pi's own radio is either disabled or not exposing an HCI device."
fi
echo
echo "  OUI check — dongles from the same batch share the first 3 octets."
for d in /sys/class/bluetooth/hci*; do
  [ -e "$d" ] || continue
  hci=$(basename "$d")
  case "$hci" in *:*) continue ;; esac
  a=$(addr_of "$hci")
  printf '    %-6s %-17s OUI=%s\n' "$hci" "${a:-?}" "$(printf '%s' "$a" | cut -d: -f1-3)"
done
echo "  A Raspberry Pi's built-in radio uses a Pi-registered OUI"
echo "  (B8:27:EB, DC:A6:32, D8:3A:DD, 2C:CF:67, E4:5F:01 ...)."
echo "  If all your adapters share one non-Pi OUI, they are all dongles."

hr "how to tell which dongle is physically which"
cat <<'TXT'
  The PHYSICAL PATH column (e.g. 1-1.2) is the USB port. To map it to the
  port you can see:
      1. Note the paths above.
      2. Unplug ONE dongle.
      3. Re-run this script. The row that disappeared is the one you unplugged.
      4. Label it. Repeat.

  RF WARNING — this matters for the product, not just this debug session:
    * SPEED is the DONGLE's negotiated speed. 12M-FS is completely normal for a
      Bluetooth dongle and is not a fault — BT does not need more bandwidth.
    * The RF risk is the PORT and its neighbours, not this number. USB3
      SIGNALLING (from an SSD, a hub, a webcam) radiates broadband 2.4 GHz noise
      that desenses any BT dongle near it. A PHYSICAL PATH starting '3-' or '4-'
      is on a USB3 root hub — fine if nothing else there is running at USB3.
    * Three dongles in adjacent ports desense each other. Touching antennas is
      the worst case.
    If one adapter is consistently worse than the others, move it to a USB2
    port (the black ones on a Pi 5) or put it on a short USB extension cable to
    get physical separation, then re-test before blaming the dongle.
TXT
