#!/bin/sh
# The paid steps of PREREG-TRACKER still open on 2026-10-28 (after D3): the 12 BUILDER-1 T1 reviews the 2026-10-22 restart cut off, the
# Mercury bind (T2-M), and the second E8 bind sample ("K = 2 if budget allows"); then their $0 judges. Run detached from this file:
#   setsid nohup sh experiments/tracker-v2/paid-remainder.sh > /var/tmp/foundry-work/tracker-v2/paid-remainder.log 2>&1 &
# Same fault rule as paid.sh: exit 75 (rate or usage limit, provider down) is not scored; wait 30 min and resume, at most 4 times.
set -u
cd "$(dirname "$0")/../.." || exit 1
OUT=research/tracker-20261021/builder1
E8=research/tracker-20261021/e8
H=claude-haiku-5-5
step() {
  n=0
  while :; do
    node experiments/tracker-v2/freeze.mjs --check || { echo "$(date -u +%FT%TZ) frozen files changed: stop"; exit 1; }
    nice -n 15 node "$@"; rc=$?
    if [ "$rc" -eq 75 ] && [ "$n" -lt 4 ]; then n=$((n + 1)); echo "$(date -u +%FT%TZ) environment fault (exit 75); not scored; waiting 30 min ($n/4)"; sleep 1800; continue; fi
    return "$rc"
  done
}
echo "$(date -u +%FT%TZ) start remainder"
step experiments/tracker-v2/run-builder1.mjs prose --capture $OUT/capture-$H-s0.json --model $H --budget 0.1 --out $OUT || exit 1
( set -a; . /root/.config/foundry/inception.env; set +a; step experiments/tracker-v2/run-builder1.mjs bind --capture $OUT/capture-$H-s0.json --model mercury-3 --token-cap 150000 --out $OUT ) \
  || echo "$(date -u +%FT%TZ) mercury bind failed (reported, not retried)"
step experiments/tracker-v2/run-e8.mjs bind --model $H --budget 0.4 --sample 1 --out $E8 || echo "$(date -u +%FT%TZ) E8 second bind failed (reported)"
echo "$(date -u +%FT%TZ) paid remainder done; judging (\$0)"
for f in $OUT/bind-claude-haiku-5-5-s0__mercury-3.json; do [ -f "$f" ] && nice -n 15 node experiments/tracker-v2/run-builder1.mjs judge --bind "$f" --out $OUT 2>&1 | tail -2; done
[ -f $E8/bind-$H-b1.json ] && nice -n 15 node experiments/tracker-v2/run-e8.mjs judge --bind $E8/bind-$H-b1.json --out $E8 2>&1 | tail -3
echo "$(date -u +%FT%TZ) remainder done"
