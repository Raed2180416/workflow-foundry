#!/bin/sh
# Detached launcher for swarm ladder rung 1 (research/swarm-20261021/PREREG-SWARM-R1.md §6.4). Start it with
#   setsid nohup sh experiments/swarm/launch-r1.sh > /dev/null 2>&1 &
# Order: the W build and the A/S calibration in parallel, then W's calibration trial, then the held-out stage.
# An environment fault (rate or session limit; run-r1 exit 3) is not an outcome: wait 30 minutes, resume, at most 6 times.
# Any other non-zero exit (4 cap, 5 freeze mismatch, 6 rule stop) ends the chain; the log says which.
set -u
cd "$(dirname "$0")/../.." || exit 2
LIVE=${SWARM_R1_LIVE:-/var/tmp/foundry-work/swarm-r1}
mkdir -p "$LIVE"
note() { echo "$(date -u +%FT%TZ) $*" >> "$LIVE/launch.log"; }
free_mb() { df -Pm "$LIVE" | awk 'NR==2 {print $4}'; }
run() {
  stage=$1; tries=0
  while :; do
    if [ "$(free_mb)" -lt 1200 ]; then note "$stage: less than 1.2 GB free, not starting"; return 7; fi
    nice -n 10 node experiments/swarm/run-r1.mjs "$stage" >> "$LIVE/$stage.log" 2>&1; code=$?
    note "$stage exit $code"
    [ "$code" -eq 3 ] || return "$code"
    tries=$((tries + 1)); [ "$tries" -ge 6 ] && { note "$stage: 6 environment-fault waits used"; return 3; }
    note "$stage: environment fault, waiting 30 minutes"; sleep 1800
  done
}
note "launch pid $$"
run build & BUILD=$!
run calibrate; CAL1=$?
wait "$BUILD"; BUILT=$?
note "build done ($BUILT), first calibration ($CAL1)"
run calibrate || { note "STOP: calibration did not finish"; exit 1; }
run heldout; HELD=$?
note "ALL DONE heldout exit $HELD"
