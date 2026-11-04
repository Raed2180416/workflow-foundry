#!/bin/bash
# Detached CI-1 wave-2 arm run with the environment-fault rule (owner, 2026-10-21): a rate or session limit stops the runner with
# exit 75; wait 30 minutes and resume (--resume skips finished builds; faulted builds are never scored), at most 6 times.
#   bash experiments/ci1-w2/run-detached-w2.sh <log file> <run-w2.mjs arguments...>
set -u
LOG="$1"; shift
cd "$(dirname "$0")/../.." || exit 1
export CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2
for attempt in 1 2 3 4 5 6 7; do
  echo "[$(date -u +%FT%TZ)] attempt $attempt: node experiments/ci1-w2/run-w2.mjs $* --resume" >> "$LOG"
  nice -n 15 node experiments/ci1-w2/run-w2.mjs "$@" --resume >> "$LOG" 2>&1
  code=$?
  echo "[$(date -u +%FT%TZ)] exit $code" >> "$LOG"
  [ "$code" -ne 75 ] && exit "$code"
  [ "$attempt" -eq 7 ] && exit 75
  echo "[$(date -u +%FT%TZ)] environment fault: waiting 30 minutes before resuming" >> "$LOG"
  sleep 1800
done
