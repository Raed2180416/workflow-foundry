#!/bin/sh
# Paid steps of PREREG-TRACKER-H (research/tracker-20261021/PREREG-TRACKER-H.md §6), run detached from this file:
#   setsid nohup sh experiments/tracker-v2/heldout/paid-heldout.sh > /var/tmp/foundry-work/tracker-v2/paid-heldout.log 2>&1 &
# Every step resumes from the files already written. An environment fault (exit 75: rate or usage limit, provider unavailable or timed
# out) is not scored: wait 30 minutes and resume, at most 4 times per step. Any other failure stops the script. The freeze is checked
# first and before every step: a drift not recorded in heldout/deviations-h.json stops everything. Haiku caps per step add up to $1.47;
# Mercury steps are capped by tokens (builder 120,000; bind 100,000). The Mercury key is read only into its command's environment.
set -u
cd "$(dirname "$0")/../../.." || exit 1
OUT=research/tracker-20261021/heldout
H=claude-haiku-5-5
R=experiments/tracker-v2/heldout/run-heldout.mjs
check() { node experiments/tracker-v2/heldout/freeze-h.mjs --check || { echo "$(date -u +%FT%TZ) held-out freeze drifted: stop"; exit 1; }; }
step() {
  n=0
  while :; do
    check
    nice -n 15 node "$@"; rc=$?
    if [ "$rc" -eq 75 ] && [ "$n" -lt 4 ]; then n=$((n + 1)); echo "$(date -u +%FT%TZ) environment fault (exit 75); not scored; waiting 30 min ($n/4)"; sleep 1800; continue; fi
    return "$rc"
  done
}
mercury() { ( set -a; . /root/.config/foundry/inception.env; set +a; step "$@" ); }
echo "$(date -u +%FT%TZ) start held-out"
step $R builds --arm B-H --budget 0.10 || exit 1
step $R builds --arm B0-H --budget 0.20 || exit 1
mercury $R builds --arm B-M --token-cap 120000 || echo "$(date -u +%FT%TZ) B-M builds failed (reported, not retried)"
step $R capture --model $H --samples 3 --budget 0.10 || exit 1
for s in 0 1 2; do step $R bind --capture $OUT/capture-$H-s$s.json --model $H --budget 0.12 || exit 1; done
step $R bind --capture $OUT/capture-rule.json --model $H --budget 0.10 || exit 1
step $R prose --capture $OUT/capture-$H-s0.json --model $H --budget 0.40 || exit 1
mercury $R bind --capture $OUT/capture-$H-s0.json --model mercury-3 --token-cap 100000 || echo "$(date -u +%FT%TZ) Mercury bind failed (reported, not retried)"
echo "$(date -u +%FT%TZ) held-out paid steps done; judging (\$0)"
for f in $OUT/bind-*.json; do check; nice -n 15 node $R judge --bind "$f" || echo "judge failed: $f"; done
node $R score > /dev/null && echo "$(date -u +%FT%TZ) scored"
# H7 (exploratory): the findings back to the one-shot builder, one repair round per B0-H build per feedback arm.
TAG=claude-haiku-5-5-s0__claude-haiku-5-5
for fb in t2 t1 none; do
  step $R repair --feedback $fb --judge $OUT/judge-v3-$TAG.json --prose $OUT/prose-$TAG.json --bind $OUT/bind-$TAG.json --budget 0.09 || echo "$(date -u +%FT%TZ) repair $fb failed (reported)"
done
node $R score > /dev/null && echo "$(date -u +%FT%TZ) scored with repairs"
echo "$(date -u +%FT%TZ) held-out done"
