#!/usr/bin/env bash
# sd-write-attribute.sh — find out what is writing to the SD card, and whether
# those writes actually reach storage.
#
# Run on the Pi, as root:  sudo ./sd-write-attribute.sh
#
# Context (E4 / Known Issue #0 in PLAN.md): capture.py measured ~4.8 MB/s of
# continuous writes attributed to `node` on 2026-10-06, which is ~396 GB/day and
# would wear out an SD card inside a year. Nothing in bridge/api/src writes
# continuously, so the number needs attributing before any code changes.
#
# The distinction this script exists to make:
#   wchar       bytes the process wrote via write() syscalls — INCLUDES sockets
#               and pipes, so a chatty HTTP API inflates this and it is NOT disk
#   write_bytes bytes the kernel actually sent to a block device — this is the
#               only number that wears out the card
# If wchar is huge and write_bytes is ~0, the "SD write" is really network or
# log-to-journal traffic and the card is fine.

set -uo pipefail

WINDOW=${WINDOW:-30}
FATRACE_SECS=${FATRACE_SECS:-20}

[ "$(id -u)" -eq 0 ] || { echo "needs root: sudo $0" >&2; exit 1; }

hr() { printf '%s\n' "────────────────────────────────────────────────────────"; }
kbs() { awk -v b="$1" -v s="$2" 'BEGIN{printf "%.1f", b/1024/s}'; }

# ─── 0. State check ─────────────────────────────────────────────────────────
hr; echo "0. STATE — the 4.8 MB/s was measured with speakers connected."
hr
PARTY=$(curl -s --max-time 2 http://127.0.0.1:3000/api/status 2>/dev/null \
        | grep -o '"party_active":[a-z]*' | cut -d: -f2)
echo "party_active   : ${PARTY:-unreachable}"
echo "connected sinks: $(pactl list short sinks 2>/dev/null | grep -c bluez || echo '?')"
echo
echo "If party_active is false or there are 0 bluez sinks, stop now, start the"
echo "party from the app with speakers playing, and re-run. An idle measurement"
echo "will not reproduce the fault."
echo

# ─── 1. Per-process, syscall vs block device ────────────────────────────────
PID=$(pgrep -f 'node .*dist/index.js' | head -1)
[ -n "$PID" ] || { echo "bridge API not running (no 'node dist/index.js')"; exit 1; }

read -r W1 C1 < <(awk '/^wchar:/{w=$2} /^write_bytes:/{b=$2} END{print w, b}' "/proc/$PID/io")
D1=$(awk '$3=="mmcblk0"{print $10}' /proc/diskstats)
T1=$(date +%s)

hr; echo "1. MEASURING for ${WINDOW}s — PID $PID"; hr
sleep "$WINDOW"

read -r W2 C2 < <(awk '/^wchar:/{w=$2} /^write_bytes:/{b=$2} END{print w, b}' "/proc/$PID/io")
D2=$(awk '$3=="mmcblk0"{print $10}' /proc/diskstats)
T2=$(date +%s)
ELAPSED=$((T2 - T1))

SYSCALL_KBS=$(kbs $((W2 - W1)) "$ELAPSED")
DISK_KBS=$(kbs $((C2 - C1)) "$ELAPSED")
# diskstats field 10 is sectors written, 512 bytes each
CARD_KBS=$(awk -v s=$((D2 - D1)) -v t="$ELAPSED" 'BEGIN{printf "%.1f", s*512/1024/t}')

printf 'API wchar       (syscalls, incl. sockets): %10s KB/s\n' "$SYSCALL_KBS"
printf 'API write_bytes (actually to storage)    : %10s KB/s  <-- the one that matters\n' "$DISK_KBS"
printf 'Whole card      (mmcblk0, all processes) : %10s KB/s\n' "$CARD_KBS"
echo
echo "Daily, from write_bytes: $(awk -v k="$DISK_KBS" 'BEGIN{printf "%.1f", k*86400/1024/1024}') GB/day"
echo

# ─── 2. Verdict ─────────────────────────────────────────────────────────────
hr; echo "2. VERDICT"; hr
if awk -v d="$DISK_KBS" 'BEGIN{exit !(d < 50)}'; then
  echo "The API is NOT writing meaningfully to the card ($DISK_KBS KB/s)."
  if awk -v s="$SYSCALL_KBS" 'BEGIN{exit !(s > 1000)}'; then
    echo "Its wchar is high ($SYSCALL_KBS KB/s) — that is socket/pipe traffic, not"
    echo "storage. The original 4.8 MB/s was very likely wchar being read as disk."
  fi
  if awk -v c="$CARD_KBS" -v d="$DISK_KBS" 'BEGIN{exit !(c > d + 500)}'; then
    echo "But the CARD is busy ($CARD_KBS KB/s) and it is someone else — see section 3."
  else
    echo "The card is quiet too. Issue #0 does not reproduce in this state."
  fi
else
  echo "CONFIRMED: the API itself is writing $DISK_KBS KB/s to storage."
  echo "Section 3 shows which files."
fi
echo

# ─── 3. Who and what ────────────────────────────────────────────────────────
hr; echo "3. FILES THE API HOLDS OPEN (non-socket, non-pipe, non-/dev)"; hr
ls -l "/proc/$PID/fd" 2>/dev/null | grep -v -E 'socket|pipe|/dev/|anon_inode' | tail -n +2
echo
echo "Write position of each, sampled twice — a growing 'pos' is an active writer:"
for fd in /proc/$PID/fd/*; do
  tgt=$(readlink "$fd" 2>/dev/null) || continue
  case "$tgt" in *socket*|*pipe*|/dev/*|*anon_inode*) continue ;; esac
  p=$(awk '/^pos:/{print $2}' "/proc/$PID/fdinfo/$(basename "$fd")" 2>/dev/null)
  echo "  pos=$p  $tgt"
done
echo

hr; echo "4. SYSTEM-WIDE WRITERS (${FATRACE_SECS}s of fatrace)"; hr
if command -v fatrace >/dev/null; then
  timeout "$FATRACE_SECS" fatrace -f W 2>/dev/null \
    | awk '{print $1}' | sort | uniq -c | sort -rn | head -15
  echo
  echo "Top written files:"
  timeout "$FATRACE_SECS" fatrace -f W 2>/dev/null \
    | awk '{print $NF}' | sort | uniq -c | sort -rn | head -15
else
  echo "fatrace not installed. Install and re-run for file-level attribution:"
  echo "  sudo apt install -y fatrace"
fi
echo

hr; echo "5. JOURNAL SIZE (rule out logging)"; hr
journalctl --disk-usage 2>/dev/null
du -sh /var/log 2>/dev/null
echo
echo "Record the write_bytes number in bridge/diagnostics/EXPERIMENTS.md under E4."
