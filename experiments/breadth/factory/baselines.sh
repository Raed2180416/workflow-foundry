#!/bin/bash
# Scripted $0 baselines for node V (no model): the observable-only reference and the G5 controls on dev streams,
# fast mode (abr-apply; G12 proves it equals the app's own model path). Writes one summary.json per (family, solver).
#   bash experiments/breadth/factory/baselines.sh [seeds] ["families"]   (default 2113-2120, all three)
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
SEEDS=${1:-2113-2120}
OUT=$ROOT/research/breadth-20261021/factory/baselines
H=$ROOT/experiments/autobench/abr/lib/factory/harness.py
for f in ${2:-abr-reg-incident-clock abr-itsm-queue abr-p2p-audit}; do
  for s in reference null echo naive memoryless; do
    d=$OUT/$f/$s
    mkdir -p "$d"
    nice -n 10 python3 -I -B "$H" --family "$f" run --solver "$s" --seeds "$SEEDS" > "$d/stdout.json" 2> "$d/stderr.txt"
    # results.jsonl stays out of git: only the summary is kept (per-trigger rows are regenerable at $0)
    tail -1 "$d/stdout.json" > "$d/summary.json"; rm -f "$d/stdout.json"; [ -s "$d/stderr.txt" ] || rm -f "$d/stderr.txt"
  done
done
echo done
