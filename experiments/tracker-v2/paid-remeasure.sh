#!/bin/sh
# Paid steps of PREREG-TRACKER-H2 (research/tracker-20261021/PREREG-TRACKER-H2.md §5), run detached from this file:
#   setsid nohup sh experiments/tracker-v2/paid-remeasure.sh > /var/tmp/foundry-work/tracker-20261021/paid-remeasure.log 2>&1 &
# Every step resumes from the files already written. An environment fault (exit 75: rate or usage limit, provider unavailable or timed
# out) is not scored: wait 30 minutes and resume, at most 4 times per step. Any other failure stops the script. Both freeze checks run
# before every step: a drift not recorded in deviations.json / heldout/deviations-h.json stops everything. Haiku caps per step add up
# to $1.31; no Mercury call. The disk is checked before each step: below 1.2 GB free the script stops.
set -u
cd "$(dirname "$0")/../.." || exit 1
R=experiments/tracker-v2/remeasure.mjs
check() {
  node experiments/tracker-v2/freeze.mjs --check > /dev/null || { echo "$(date -u +%FT%TZ) PREREG-TRACKER freeze drifted: stop"; exit 1; }
  node experiments/tracker-v2/heldout/freeze-h.mjs --check > /dev/null || { echo "$(date -u +%FT%TZ) held-out freeze drifted: stop"; exit 1; }
  free=$(df -Pk . | awk 'NR==2 {print $4}')
  [ "$free" -gt 1258291 ] || { echo "$(date -u +%FT%TZ) disk below 1.2 GB free ($free KB): stop"; exit 1; }
}
step() {
  n=0
  while :; do
    check
    nice -n 15 node "$@"; rc=$?
    if [ "$rc" -eq 75 ] && [ "$n" -lt 4 ]; then n=$((n + 1)); echo "$(date -u +%FT%TZ) environment fault (exit 75); not scored; waiting 30 min ($n/4)"; sleep 1800; continue; fi
    return "$rc"
  done
}
echo "$(date -u +%FT%TZ) start PREREG-TRACKER-H2"
step $R builds --budget 0.20 || exit 1
step $R conversations || exit 1
step $R capture --samples 3 --budget 0.05 || exit 1
for s in s0 s1 s2; do step $R bind --sample $s --budget 0.14 || exit 1; done
echo "$(date -u +%FT%TZ) judging (\$0)"
step $R judge --setting key --sample s0 --semantics v3,v4 || exit 1
step $R judge --setting own --sample s0 --semantics v3,v4 || exit 1
for k in 0 1 2; do step $R prose --k $k --budget 0.15 || exit 1; done
for fb in t2 t1 none; do step $R repair --feedback $fb --budget 0.07 || echo "$(date -u +%FT%TZ) repair $fb failed (reported)"; done
for s in s1 s2; do
  step $R judge --setting key --sample $s --semantics v4 || exit 1
  step $R judge --setting key --sample $s --semantics v3 --arms B-H,B-M,B0-H2 || exit 1
  step $R judge --setting own --sample $s --semantics v3,v4 || exit 1
done
node $R score > /dev/null && echo "$(date -u +%FT%TZ) scored"
echo "$(date -u +%FT%TZ) PREREG-TRACKER-H2 done"
