#!/bin/bash
# CI-1 wave 2: freeze the given items one at a time at low priority (bed2.mjs freeze: re-runs the two-reference check, the mutants and
# the greedy hidden-world cover, then writes oracle/<id>.json with the hidden and public worlds and the reference effects), one JSON
# line per item on stdout (admitted, why, sha256, hidden, full check report). $0; no model is called.
#   bash experiments/ci1-w2/freeze-items.sh <id...>
W="$(cd "$(dirname "$0")/../.." && pwd)"
export CI1_BED="${CI1_BED:-/var/tmp/foundry-work/ci1-20261021/bed-w2}"
for id in "$@"; do
  timeout 2400 nice -n 15 node "$W/experiments/ci1-w2/bed2.mjs" freeze "$id" 2>&1
done
