#!/usr/bin/env bash
# constrain.sh — make the Pi 5 behave like weaker, cheaper hardware, so you can
# find the failure point before buying anything.
#
# Run on the Pi. Most subcommands need sudo.
#
#   ./constrain.sh show                 current constraints
#   ./constrain.sh clock 1500           pin CPU max clock to 1500 MHz
#   ./constrain.sh cores 2              take cores 2..N offline
#   ./constrain.sh quota 25             cap audio units at 25% of one core
#   ./constrain.sh ballast 1500         lock 1500 MB away to emulate less RAM
#   ./constrain.sh ram-boot 512         print the cmdline.txt edit (most accurate)
#   ./constrain.sh reset                undo everything except ram-boot
#
# LIMITS OF THIS APPROACH — read before trusting the results:
#   * A Pi 5 will not go below ~1.5 GHz, so clock alone cannot reach the range
#     of a cheap Cortex-A53 board.
#   * A Cortex-A76 at 1.0 GHz is roughly 2-2.5x faster per clock than a
#     Cortex-A53 at 1.0 GHz. Downclocking measures the clock axis only, never
#     the microarchitecture axis.
#   * 'quota' uses a 1 ms scheduling period so throttling granularity stays well
#     under one audio buffer. It is still an approximation of a slower core.
#   Use these to find the KNEE (where audio starts breaking), then use
#   dsp_bench to compare that knee against a candidate board. Neither tool
#   alone is sufficient.

set -uo pipefail

CPUDIR=/sys/devices/system/cpu
STATE=/run/campfire-constrain.state
UNITS_SYS=(pulseaudio.service shairport-sync.service bluetooth.service)
UNITS_USER=(campfire-bridge.service pulseaudio.service shairport-sync.service)

die() { echo "error: $*" >&2; exit 1; }
need_root() { [ "$(id -u)" -eq 0 ] || die "needs sudo: sudo $0 $*"; }

khz_of() { awk '{printf "%d", $1/1000}' <<<"$1"; }

cmd_show() {
  echo "== clock =="
  for f in cpuinfo_min_freq cpuinfo_max_freq scaling_min_freq scaling_max_freq scaling_governor; do
    p="$CPUDIR/cpu0/cpufreq/$f"
    [ -r "$p" ] && printf "  %-20s %s\n" "$f" "$(cat "$p")"
  done
  printf "  %-20s %s MHz\n" "current" "$(khz_of "$(cat $CPUDIR/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)")"
  echo "== cores =="
  printf "  online: %s   present: %s\n" \
    "$(cat $CPUDIR/online 2>/dev/null)" "$(cat $CPUDIR/present 2>/dev/null)"
  echo "== memory =="
  awk '/MemTotal|MemAvailable/ {printf "  %-14s %d MB\n", $1, $2/1024}' /proc/meminfo
  [ -f /run/campfire-ballast.pid ] && echo "  ballast: running (pid $(cat /run/campfire-ballast.pid))"
  echo "== cpu quota =="
  for u in "${UNITS_SYS[@]}"; do
    q=$(systemctl show -p CPUQuotaPerSecUSec --value "$u" 2>/dev/null)
    [ -n "$q" ] && [ "$q" != "infinity" ] && echo "  system/$u: $q"
  done
  for u in "${UNITS_USER[@]}"; do
    q=$(systemctl --user show -p CPUQuotaPerSecUSec --value "$u" 2>/dev/null)
    [ -n "$q" ] && [ "$q" != "infinity" ] && echo "  user/$u: $q"
  done
  echo "== throttle flags =="
  command -v vcgencmd >/dev/null && echo "  $(vcgencmd get_throttled)" || echo "  vcgencmd not available"
}

cmd_clock() {
  need_root clock "$@"
  local mhz=${1:?usage: clock <MHz>} khz=$((${1} * 1000))
  local minf maxf
  minf=$(cat "$CPUDIR/cpu0/cpufreq/cpuinfo_min_freq") || die "no cpufreq on this board"
  maxf=$(cat "$CPUDIR/cpu0/cpufreq/cpuinfo_max_freq")
  [ "$khz" -lt "$minf" ] && { echo "note: $mhz MHz is below this board's floor of $(khz_of "$minf") MHz - clamping"; khz=$minf; }
  [ "$khz" -gt "$maxf" ] && { echo "note: clamping to board max $(khz_of "$maxf") MHz"; khz=$maxf; }
  for p in "$CPUDIR"/cpu[0-9]*/cpufreq; do
    [ -w "$p/scaling_max_freq" ] || continue
    echo performance > "$p/scaling_governor" 2>/dev/null
    echo "$khz"      > "$p/scaling_max_freq"
    echo "$khz"      > "$p/scaling_min_freq" 2>/dev/null
  done
  echo "clock pinned to $(khz_of "$khz") MHz (governor=performance)"
  echo "verify: grep MHz <($0 show)"
}

cmd_cores() {
  need_root cores "$@"
  local n=${1:?usage: cores <N>} i
  [ "$n" -ge 1 ] || die "need at least 1 core"
  cat <<'WARN'
  NOTE: on a Pi 5, offlining a core can be a ONE-WAY trip — the kernel may
  refuse to bring it back ("write error: Input/output error" on reset), and
  only a reboot restores it. Everything measured after a failed restore runs
  on fewer cores than its label claims. Always check `nproc` after reset.
WARN
  for d in "$CPUDIR"/cpu[0-9]*; do
    i=${d##*/cpu}
    [ -w "$d/online" ] || continue      # cpu0 is usually not hot-unpluggable
    if [ "$i" -ge "$n" ]; then echo 0 > "$d/online"; else echo 1 > "$d/online"; fi
  done
  echo "cores online: $(cat $CPUDIR/online)"
}

cmd_quota() {
  need_root quota "$@"
  local pctv=${1:?usage: quota <percent-of-one-core>}
  cat <<'WARN'
  NOTE: this caps EACH service individually, not the audio pipeline as a whole.
  The Campfire workload is spread over several processes (shairport-sync,
  pulseaudio, bluetoothd, node), none of which individually uses much CPU, so a
  quota above any single process's usage changes NOTHING and produces a flat,
  meaningless sweep. Use the `clock` and `cores` axes to find the real knee.
WARN
  local applied=0 u
  for u in "${UNITS_SYS[@]}"; do
    if systemctl cat "$u" >/dev/null 2>&1; then
      systemctl set-property "$u" CPUQuota="${pctv}%" CPUQuotaPeriodSec=1ms --runtime 2>/dev/null \
        && { echo "  system/$u -> ${pctv}%"; applied=1; }
    fi
  done
  for u in "${UNITS_USER[@]}"; do
    if sudo -u "${SUDO_USER:-pi}" XDG_RUNTIME_DIR=/run/user/"$(id -u "${SUDO_USER:-pi}")" \
         systemctl --user cat "$u" >/dev/null 2>&1; then
      sudo -u "${SUDO_USER:-pi}" XDG_RUNTIME_DIR=/run/user/"$(id -u "${SUDO_USER:-pi}")" \
        systemctl --user set-property "$u" CPUQuota="${pctv}%" CPUQuotaPeriodSec=1ms --runtime 2>/dev/null \
        && { echo "  user/$u -> ${pctv}%"; applied=1; }
    fi
  done
  [ "$applied" -eq 1 ] || die "no audio units found to throttle - edit UNITS_SYS/UNITS_USER at the top of this script"
  echo "quota applied (--runtime: cleared on reboot)"
}

cmd_ballast() {
  need_root ballast "$@"
  local mb=${1:?usage: ballast <MB>}
  [ -f /run/campfire-ballast.pid ] && kill "$(cat /run/campfire-ballast.pid)" 2>/dev/null
  python3 - "$mb" <<'PY' &
import ctypes, sys, time
mb = int(sys.argv[1])
buf = bytearray(mb * 1024 * 1024)
for i in range(0, len(buf), 4096):      # touch every page so it is really resident
    buf[i] = 1
libc = ctypes.CDLL("libc.so.6", use_errno=True)
addr = (ctypes.c_char * len(buf)).from_buffer(buf)
if libc.mlock(ctypes.byref(addr), ctypes.c_size_t(len(buf))) != 0:
    print("warning: mlock failed, pages may be swapped out", file=sys.stderr)
while True:
    time.sleep(3600)
PY
  echo $! > /run/campfire-ballast.pid
  sleep 2
  echo "ballast holding ${mb} MB (pid $(cat /run/campfire-ballast.pid))"
  awk '/MemAvailable/ {printf "MemAvailable now: %d MB\n", $2/1024}' /proc/meminfo
  echo "NOTE: this shrinks available RAM but does not shrink kernel/page-cache"
  echo "      headroom the way a genuinely smaller board does. For a real answer"
  echo "      use: $0 ram-boot <MB>"
}

cmd_ram_boot() {
  local mb=${1:?usage: ram-boot <MB>}
  cat <<TXT
Most accurate RAM test - the kernel really only sees ${mb} MB.

On the Pi:
  sudo cp /boot/firmware/cmdline.txt /boot/firmware/cmdline.txt.bak
  sudo sed -i 's/\$/ mem=${mb}M/' /boot/firmware/cmdline.txt
  sudo reboot

To undo:
  sudo cp /boot/firmware/cmdline.txt.bak /boot/firmware/cmdline.txt
  sudo reboot

(On older Raspberry Pi OS the path is /boot/cmdline.txt.)
TXT
}

cmd_reset() {
  need_root reset
  for p in "$CPUDIR"/cpu[0-9]*/cpufreq; do
    [ -w "$p/scaling_max_freq" ] || continue
    cat "$p/cpuinfo_max_freq" > "$p/scaling_max_freq" 2>/dev/null
    cat "$p/cpuinfo_min_freq" > "$p/scaling_min_freq" 2>/dev/null
    echo ondemand > "$p/scaling_governor" 2>/dev/null
  done
  local core_restore_failed=0
  for d in "$CPUDIR"/cpu[0-9]*; do
    [ -w "$d/online" ] || continue
    if ! echo 1 > "$d/online" 2>/dev/null; then
      [ "$(cat "$d/online" 2>/dev/null)" = "1" ] || core_restore_failed=1
    fi
  done
  for u in "${UNITS_SYS[@]}"; do
    systemctl cat "$u" >/dev/null 2>&1 && \
      systemctl set-property "$u" CPUQuota= CPUQuotaPeriodSec= --runtime 2>/dev/null
  done
  for u in "${UNITS_USER[@]}"; do
    sudo -u "${SUDO_USER:-pi}" XDG_RUNTIME_DIR=/run/user/"$(id -u "${SUDO_USER:-pi}")" \
      systemctl --user set-property "$u" CPUQuota= CPUQuotaPeriodSec= --runtime 2>/dev/null
  done
  if [ -f /run/campfire-ballast.pid ]; then
    kill "$(cat /run/campfire-ballast.pid)" 2>/dev/null
    rm -f /run/campfire-ballast.pid
  fi
  if [ "${core_restore_failed:-0}" -eq 1 ] || [ "$(nproc)" -lt "$(getconf _NPROCESSORS_CONF)" ]; then
    cat <<'WARN'

  *** CORES DID NOT COME BACK ***
  The kernel refused to re-online one or more cores. This machine is now
  running on fewer cores than normal, and ANY measurement taken from here on
  is invalid until you reboot.

      sudo reboot

WARN
  fi
  echo "reset done (a 'ram-boot' cmdline.txt edit is NOT undone by this)"
  cmd_show
}

case "${1:-show}" in
  show)     cmd_show ;;
  clock)    shift; cmd_clock "$@" ;;
  cores)    shift; cmd_cores "$@" ;;
  quota)    shift; cmd_quota "$@" ;;
  ballast)  shift; cmd_ballast "$@" ;;
  ram-boot) shift; cmd_ram_boot "$@" ;;
  reset)    cmd_reset ;;
  *) sed -n '2,30p' "$0"; exit 1 ;;
esac
