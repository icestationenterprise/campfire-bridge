#!/usr/bin/env bash
# Run KiCad ERC on the schematic and DRC on the board, from the command line.
# Exit 1 on any error-severity violation so this can gate a commit or CI job.
#
# Usage:  hardware/scripts/check_board.sh [project-dir]
#         KICAD_CLI=/path/to/kicad-cli hardware/scripts/check_board.sh
#
# Reports land in <project-dir>/reports/ (erc.json, erc.txt, drc.json, drc.txt).
# Warnings are listed in the .txt reports but do not fail the run.

set -euo pipefail

PROJ_DIR="${1:-$(cd "$(dirname "$0")/../carrier" 2>/dev/null && pwd || true)}"
NAME="${BOARD_NAME:-campfire-carrier}"
SCH="$PROJ_DIR/$NAME.kicad_sch"
PCB="$PROJ_DIR/$NAME.kicad_pcb"
OUT="$PROJ_DIR/reports"

# --- find kicad-cli (brew cask puts it inside the app bundle on macOS) ---
KICAD_CLI="${KICAD_CLI:-}"
if [ -z "$KICAD_CLI" ]; then
  if command -v kicad-cli >/dev/null 2>&1; then
    KICAD_CLI=kicad-cli
  elif [ -x /Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli ]; then
    KICAD_CLI=/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli
  else
    echo "kicad-cli not found. On your Mac: brew install --cask kicad   (or set KICAD_CLI=...)" >&2
    exit 2
  fi
fi

if [ -z "$PROJ_DIR" ] || [ ! -d "$PROJ_DIR" ]; then
  echo "project dir not found: '$PROJ_DIR' (create hardware/carrier/ first)" >&2
  exit 2
fi
mkdir -p "$OUT"
status=0

if [ -f "$SCH" ]; then
  echo "▶ ERC  $SCH"
  "$KICAD_CLI" sch erc --format json --severity-error --exit-code-violations \
    --output "$OUT/erc.json" "$SCH" || status=1
  "$KICAD_CLI" sch erc --format report --severity-all \
    --output "$OUT/erc.txt" "$SCH" >/dev/null 2>&1 || true
else
  echo "   no schematic at $SCH — skipped"
fi

if [ -f "$PCB" ]; then
  echo "▶ DRC  $PCB"
  "$KICAD_CLI" pcb drc --format json --severity-error --schematic-parity --exit-code-violations \
    --output "$OUT/drc.json" "$PCB" || status=1
  "$KICAD_CLI" pcb drc --format report --severity-all --schematic-parity \
    --output "$OUT/drc.txt" "$PCB" >/dev/null 2>&1 || true
else
  echo "   no board at $PCB — skipped"
fi

# --- summary: count violations by severity across whatever reports exist ---
python3 - "$OUT" <<'PY'
import json, pathlib, sys
out = pathlib.Path(sys.argv[1])
def walk(node, acc):
    if isinstance(node, dict):
        sev = node.get("severity")
        if sev and "type" in node:
            acc[sev] = acc.get(sev, 0) + 1
        for v in node.values():
            walk(v, acc)
    elif isinstance(node, list):
        for v in node:
            walk(v, acc)
for name in ("erc.json", "drc.json"):
    p = out / name
    if not p.exists():
        continue
    try:
        data = json.loads(p.read_text())
    except Exception as e:  # noqa: BLE001
        print(f"   {name}: unreadable ({e})")
        continue
    acc = {}
    walk(data, acc)
    pretty = ", ".join(f"{k}: {v}" for k, v in sorted(acc.items())) or "clean"
    print(f"   {name}: {pretty}   (full list: {p.with_suffix('.txt').name})")
PY

if [ "$status" -ne 0 ]; then
  echo "✗ error-severity violations present"
else
  echo "✓ ERC/DRC clean at error severity"
fi
exit "$status"
