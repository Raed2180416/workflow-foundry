#!/bin/bash
# CI-1 wave 2: run the bed check (two-reference agreement, determinism, mutants, hidden-world cover) for each item id given, one at a
# time at low priority, and print a one-line summary per item. Logs: /var/tmp/foundry-work/ci1-20261021/w2-logs/check-<id>.json
#   bash experiments/ci1-w2/check-items.sh <id...>
W="$(cd "$(dirname "$0")/../.." && pwd)"
export CI1_BED="${CI1_BED:-/var/tmp/foundry-work/ci1-20261021/bed-w2}"
L=/var/tmp/foundry-work/ci1-20261021/w2-logs
mkdir -p "$L"
for id in "$@"; do
  timeout 2400 nice -n 15 node "$W/experiments/ci1-w2/bed2.mjs" check "$id" > "$L/check-$id.json" 2>&1
  node "$W/experiments/ci1-w2/check-summary.mjs" "$L/check-$id.json"
done
