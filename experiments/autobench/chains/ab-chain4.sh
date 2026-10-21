#!/bin/bash
# AutomationBench follow-on chain (2026-10-21): devCheck looks (aggregates only, PREREG-AB-v1 §5), Mercury A1-C dev60, A0 K=2, Sonnet devCheck.
cd /home/user/workflow-foundry
W=/var/tmp/foundry-work
# (follows ab-chain3, which skipped these on low disk at 17:30Z)
log() { echo "$* $(date -u +%FT%TZ)" >> $W/launches.log; }
run() { # id, args... ; resume on environment faults (exit 3), at most 6 times
  id=$1; shift; tries=0; extra=""
  while :; do
    free=$(df --output=avail -k / | tail -1); if [ "$free" -lt 1048576 ]; then log "$id NOT STARTED: <1GB free"; return 9; fi
    node experiments/autobench/run.mjs "$@" --run-id $id $extra >> $W/$id.log 2>&1; rc=$?
    log "$id exit $rc (CLI $(claude --version | cut -d' ' -f1))"
    [ $rc -eq 3 ] && [ $tries -lt 6 ] && { tries=$((tries+1)); extra="--resume"; sleep 1800; continue; }
    return $rc
  done
}
df -h / | tail -1 >> $W/launches.log
H="--model claude-haiku-5-5 --date-note --concurrency 3"
set -a; . /root/.config/foundry/inception.env; set +a
run m3-a1c-dev60-dn --model claude-haiku-5-5 --harness codeowned --node-models ledger=mercury-3,checker=mercury-3 --pool devTrain --subset 60 --seed 21 --date-note --budget 0.75 --cap 4 --token-cap 3000000 --session-tokens 300000 --concurrency 2
unset INCEPTION_API_KEY
run a0-devcheck-2 $H --pool devCheck --cap 2
run a0s-devcheck-1 --model claude-sonnet-5-5 --budget 1.5 --date-note --concurrency 3 --pool devCheck --cap 14
log "ab-chain4 ALL DONE"
