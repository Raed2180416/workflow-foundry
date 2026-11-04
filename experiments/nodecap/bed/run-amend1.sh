#!/bin/sh
# PREREG-NODECAP-1-AMEND-1 §6: the paid run, detached, under nice, with the environment-fault resume loop.
# Start it detached from the repository root:
#   setsid nohup sh experiments/nodecap/bed/run-amend1.sh research/nodecap-20261021/runs/haiku-amend1-2026-11-04 >/dev/null 2>&1 &
# The runner exits 0 when every slot has a row, 75 when it stopped on three consecutive environment faults (MODEL_UNAVAILABLE,
# MODEL_RATE_LIMIT, MODEL_TIMEOUT). On 75 this loop waits 10 minutes and resumes from the saved report (no episode that ran is re-run),
# at most 6 times. Any other exit (a crash, a refused start: dirty tree, manifest mismatch) ends the loop; nothing is retried blindly.
set -u
OUT=${1:?usage: run-amend1.sh <out dir>}
cd "$(dirname "$0")/../../.." || exit 2
mkdir -p "$OUT"
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}
echo $$ > "$OUT/wrapper.pid"
i=0
while :; do
  if [ -f "$OUT/report.json" ]; then RESUME=--resume; else RESUME=; fi
  echo "$(date -u +%FT%TZ) start attempt $i $RESUME" >> "$OUT/wrapper.log"
  nice -n 15 node experiments/nodecap/bed/run-model.mjs --protocol amend1 --model haiku --out "$OUT" $RESUME >> "$OUT/stdout.log" 2>> "$OUT/run.log"
  code=$?
  echo "$(date -u +%FT%TZ) exit $code (attempt $i)" >> "$OUT/wrapper.log"
  [ "$code" -eq 75 ] || break
  i=$((i + 1))
  [ "$i" -le 6 ] || { echo "$(date -u +%FT%TZ) resume limit reached" >> "$OUT/wrapper.log"; break; }
  sleep 600
done
echo "$(date -u +%FT%TZ) done (last exit $code)" >> "$OUT/wrapper.log"
rm -f "$OUT/wrapper.pid"
