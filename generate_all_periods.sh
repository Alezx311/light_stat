#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo "Використання: bash generate_all_periods.sh data/events.json" >&2
  exit 1
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
node "$SCRIPT_DIR/analyze_electricity.js" "$1"
for days in 7 14 30 60 90; do
  node "$SCRIPT_DIR/analyze_electricity.js" "$1" --days "$days"
done
