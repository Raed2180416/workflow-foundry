#!/bin/bash
# Detached CI-1 arm run with the environment-fault rule (owner, 2026-10-21): a rate or session limit stops the runner with exit 75;
# wait 30 minutes and resume (--resume skips finished builds; faulted builds are never scored), at most 6 times.
#   bash experiments/ci1/run-detached.sh <log file> <run-arm.mjs arguments...>
# Mercury arms need INCEPTION_API_KEY: the key is loaded inside this script from the owner's env file and never printed.
set -u
LOG="$1"; shift
cd "$(dirname "$0")/../.." || exit 1
case " $* " in *" A2-M "*) set -a; . /root/.config/foundry/inception.env; set +a ;; esac
for attempt in 1 2 3 4 5 6 7; do
  echo "[$(date -u +%FT%TZ)] attempt $attempt: node experiments/ci1/run-arm.mjs $* --resume" >> "$LOG"
  nice -n 15 node experiments/ci1/run-arm.mjs "$@" --resume >> "$LOG" 2>&1
  code=$?
  echo "[$(date -u +%FT%TZ)] exit $code" >> "$LOG"
  [ "$code" -ne 75 ] && exit "$code"
  [ "$attempt" -eq 7 ] && exit 75
  echo "[$(date -u +%FT%TZ)] environment fault: waiting 30 minutes before resuming" >> "$LOG"
  sleep 1800
done
