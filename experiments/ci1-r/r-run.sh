#!/bin/bash
# CI-1 review arms (research/ci1-20261021/r/PREREG-CI1-R.md §3): four arms × both waves, K = 3, detached, in two streams so that the
# blind-card arm and its same-session control run side by side: stream 1 A2b then A1cH, stream 2 A2 (isolated rerun) then A0p.
# Each arm runs wave 1 (19 items) then wave 2 (9 items). The runner refuses unless MANIFEST-R and the wave's manifest match.
#   bash experiments/ci1-r/r-run.sh   (logs under /var/tmp/foundry-work/ci1-20261021/r-logs/)
W="$(cd "$(dirname "$0")/../.." && pwd)"
L=/var/tmp/foundry-work/ci1-20261021/r-logs
mkdir -p "$L"
R="bash $W/experiments/ci1-r/run-detached-r.sh"
arm() { # arm cap-wave1 cap-wave2
  $R "$L/test-R-$1.log" 1 --arm "$1" --label "test-R-$1" --k 3 --concurrency 3 --cap-usd "$2"
  $R "$L/w2-R-$1.log"   2 --arm "$1" --label "w2-R-$1"   --k 3 --concurrency 3 --cap-usd "$3"
}
( arm A2b 1.0 0.6; arm A1cH 1.0 0.6 ) &
( arm A2 1.0 0.6; arm A0p 0.7 0.4 ) &
wait
echo "DONE $(date -u +%FT%TZ)" >> "$L/r.done"
