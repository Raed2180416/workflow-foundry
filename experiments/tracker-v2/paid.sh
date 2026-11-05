#!/bin/sh
# Paid runs of PREREG-TRACKER (research/tracker-20261021/PREREG-TRACKER.md §7), run detached from this file:
#   setsid nohup sh experiments/tracker-v2/paid.sh builder1 > /var/tmp/foundry-work/tracker-v2/paid-builder1.log 2>&1 &
#   setsid nohup sh experiments/tracker-v2/paid.sh e8 > /var/tmp/foundry-work/tracker-v2/paid-e8.log 2>&1 &     (after run-e8.mjs prepare)
# Every step is resumable (it skips what its output file already holds). An environment fault (exit 75: rate or usage limit, provider
# unavailable or timed out) is not scored: wait 30 minutes and resume, at most 4 times per step. Any other failure stops the script.
# Haiku budgets per step add up to $2.7 (cap $3); Mercury is capped at 150,000 tokens. The Mercury key is read only into the
# environment of its one command and never printed.
set -u
cd "$(dirname "$0")/../.." || exit 1
OUT=research/tracker-20261021/builder1
E8=research/tracker-20261021/e8
H=claude-haiku-5-5
PART="${1:-builder1}"
step() {
  n=0
  while :; do
    nice -n 15 node "$@"; rc=$?
    if [ "$rc" -eq 75 ] && [ "$n" -lt 4 ]; then n=$((n + 1)); echo "$(date -u +%FT%TZ) environment fault (exit 75); not scored; waiting 30 min ($n/4)"; sleep 1800; continue; fi
    return "$rc"
  done
}
echo "$(date -u +%FT%TZ) start $PART"
node experiments/tracker-v2/freeze.mjs --check || { echo "frozen files changed: stop"; exit 1; }
if [ "$PART" = e8 ]; then
  step experiments/tracker-v2/run-e8.mjs bind --model $H --budget 0.4 --out $E8 || exit 1
  step experiments/tracker-v2/run-e8.mjs prose --model $H --budget 0.4 --out $E8 || exit 1
  echo "$(date -u +%FT%TZ) e8 paid steps done"
  exit 0
fi
step experiments/tracker-v2/run-builder1.mjs capture --model $H --samples 3 --budget 0.3 --out $OUT || exit 1
for s in 0 1 2; do step experiments/tracker-v2/run-builder1.mjs bind --capture $OUT/capture-$H-s$s.json --model $H --budget 0.2 --out $OUT || exit 1; done
step experiments/tracker-v2/run-builder1.mjs bind --capture $OUT/capture-rule.json --model $H --budget 0.2 --out $OUT || exit 1
step experiments/tracker-v2/run-builder1.mjs prose --capture $OUT/capture-$H-s0.json --model $H --budget 0.8 --out $OUT || exit 1
( set -a; . /root/.config/foundry/inception.env; set +a; step experiments/tracker-v2/run-builder1.mjs bind --capture $OUT/capture-$H-s0.json --model mercury-3 --token-cap 150000 --out $OUT ) || echo "mercury bind failed (reported, not retried)"
echo "$(date -u +%FT%TZ) builder1 paid steps done"
