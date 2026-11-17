#!/usr/bin/env bash
# Generate the manufacturing set for one board revision, reproducibly, from the
# KiCad sources: Gerbers, Excellon drill files + map, pick-and-place, BOM, STEP.
# Everything lands in hardware/manufacturing/<rev>/ with a SHA-256 manifest and
# the git commit it was built from, so the exact ordered files can be tagged.
#
# Usage:  hardware/scripts/export_board.sh <rev> [variant]   e.g. A0, or A0 Bridge-Base
#         KICAD_CLI=/path/to/kicad-cli hardware/scripts/export_board.sh A0
#
# Variants: KiCad 10 has native design variants (Base / Extended / Bridge /
# Speaker, one schematic + one board). Pass the variant name as the second
# argument and the BOM, pick-and-place and STEP are exported for that variant
# into hardware/manufacturing/<rev>-<variant>/. Gerbers are the same copper for
# every variant and are exported once, in the plain <rev> run.
#
# Run check_board.sh first; this script refuses to export a board that fails DRC.
#
# Fab notes (JLCPCB / PCBWay):
#  - Upload gerbers.zip as-is. 4-layer order: F.Cu, In1.Cu, In2.Cu, B.Cu.
#  - bom.csv and cpl.csv are KiCad's native column layouts; both fabs let you
#    map columns at upload. The LCSC field must be filled on every placed part
#    (symbol field "LCSC") for the assembly quote to price it.
#  - Parts not on LCSC (CM4 connectors, BT850-ST modules) are consigned or
#    hand-placed; mark them in the BOM's "Note" field.

set -euo pipefail

REV="${1:?usage: export_board.sh <rev> [variant]   (e.g. A0, or A0 Bridge-Base)}"
VARIANT="${2:-}"
VARG=()
[ -n "$VARIANT" ] && VARG=(--variant "$VARIANT")
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PROJ_DIR="${PROJ_DIR:-$REPO/hardware/carrier}"
NAME="${BOARD_NAME:-campfire-carrier}"
SCH="$PROJ_DIR/$NAME.kicad_sch"
PCB="$PROJ_DIR/$NAME.kicad_pcb"
OUT="$REPO/hardware/manufacturing/$REV${VARIANT:+-$VARIANT}"

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
[ -f "$SCH" ] || { echo "missing $SCH" >&2; exit 2; }
[ -f "$PCB" ] || { echo "missing $PCB" >&2; exit 2; }

echo "▶ gate: ERC/DRC must be clean"
"$REPO/hardware/scripts/check_board.sh" "$PROJ_DIR"

rm -rf "$OUT"
mkdir -p "$OUT/gerbers"

echo "▶ gerbers"
"$KICAD_CLI" pcb export gerbers \
  --output "$OUT/gerbers/" \
  --layers "F.Cu,In1.Cu,In2.Cu,B.Cu,F.Paste,B.Paste,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts" \
  --subtract-soldermask --no-protel-ext --use-drill-file-origin \
  "$PCB"

echo "▶ drill"
"$KICAD_CLI" pcb export drill \
  --output "$OUT/gerbers/" \
  --format excellon --excellon-units mm --excellon-zeros-format decimal \
  --drill-origin plot --generate-map --map-format gerberx2 \
  "$PCB"

echo "▶ pick-and-place"
"$KICAD_CLI" pcb export pos \
  --output "$OUT/cpl.csv" \
  --format csv --units mm --side both --smd-only --use-drill-file-origin --exclude-dnp "${VARG[@]}" \
  "$PCB"

echo "▶ BOM"
"$KICAD_CLI" sch export bom \
  --output "$OUT/bom.csv" \
  --fields 'Reference,Value,Footprint,LCSC,Manufacturer,MPN,Note,${QUANTITY}' \
  --labels 'Reference,Value,Footprint,LCSC,Manufacturer,MPN,Note,Qty' \
  --group-by 'Value,Footprint,LCSC' \
  --exclude-dnp "${VARG[@]}" \
  "$SCH"

echo "▶ STEP (for the enclosure fit check)"
"$KICAD_CLI" pcb export step \
  --output "$OUT/$NAME-$REV.step" \
  --subst-models --no-dnp "${VARG[@]}" \
  "$PCB"

echo "▶ schematic PDF (for the FCC package and design review)"
"$KICAD_CLI" sch export pdf --output "$OUT/$NAME-$REV-schematic.pdf" "$SCH"

echo "▶ zip + manifest"
( cd "$OUT" && zip -qr gerbers.zip gerbers )
{
  echo "board:   $NAME"
  echo "rev:     $REV"
  echo "variant: ${VARIANT:-default}"
  echo "commit:  $(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "dirty:   $(git -C "$REPO" status --porcelain -- hardware/carrier 2>/dev/null | wc -l | tr -d ' ') uncommitted file(s) under hardware/carrier"
  echo "date:    $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "kicad:   $("$KICAD_CLI" version 2>/dev/null || echo unknown)"
  echo
  ( cd "$OUT" && shasum -a 256 gerbers.zip cpl.csv bom.csv "$NAME-$REV.step" "$NAME-$REV-schematic.pdf" )
} > "$OUT/MANIFEST.txt"

echo
cat "$OUT/MANIFEST.txt"
echo
echo "✓ manufacturing set in hardware/manufacturing/$REV/"
echo "  Tag the commit when you order:  git tag carrier-$REV && git push origin carrier-$REV"
