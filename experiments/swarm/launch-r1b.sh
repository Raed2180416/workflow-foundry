#!/bin/sh
# Detached launcher for rung 1b (PREREG-SWARM-R1 Amendment 1):
#   setsid nohup sh experiments/swarm/launch-r1b.sh > /dev/null 2>&1 < /dev/null &
# An environment fault (exit 3) waits 30 minutes and resumes, at most 6 times.
set -u
cd "$(dirname "$0")/../.." || exit 2
LIVE=${SWARM_R1B_LIVE:-/var/tmp/foundry-work/swarm-r1b}
mkdir -p "$LIVE"
note() { echo "$(date -u +%FT%TZ) $*" >> "$LIVE/launch.log"; }
tries=0
note "launch pid $$"
while :; do
  if [ "$(df -Pm "$LIVE" | awk 'NR==2 {print $4}')" -lt 1200 ]; then note "less than 1.2 GB free, not starting"; exit 7; fi
  nice -n 10 node experiments/swarm/run-r1b.mjs run >> "$LIVE/run.out" 2>&1; code=$?
  note "run exit $code"
  [ "$code" -eq 3 ] || break
  tries=$((tries + 1)); [ "$tries" -ge 6 ] && break
  note "environment fault, waiting 30 minutes"; sleep 1800
done
note "ALL DONE"
