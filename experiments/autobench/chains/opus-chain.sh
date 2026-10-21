#!/bin/bash
# Frontier comparator (D19): Opus 5.5 xhigh alone, dev60 then devCheck; starts after the SOP-Bench sealed run and its cells end.
cd /home/user/workflow-foundry
W=/var/tmp/foundry-work
while pgrep -f "sopbench/chain.sh|sealed.mjs" >/dev/null; do sleep 120; done
log() { echo "$* $(date -u +%FT%TZ)" >> $W/launches.log; }
run() { id=$1; shift; tries=0; extra=""
  while :; do
    free=$(df --output=avail -k / | tail -1); [ "$free" -lt 1048576 ] && { log "$id NOT STARTED: <1GB free"; return 9; }
    node experiments/autobench/run.mjs "$@" --run-id $id $extra >> $W/$id.log 2>&1; rc=$?; log "$id exit $rc (CLI $(claude --version | cut -d' ' -f1))"
    [ $rc -eq 3 ] && [ $tries -lt 6 ] && { tries=$((tries+1)); extra="--resume"; sleep 1800; continue; }
    return $rc; done; }
run a0o-dev60-dn --model claude-opus-5-5 --effort xhigh --budget 3 --pool devTrain --subset 60 --seed 21 --date-note --concurrency 3 --cap 45
run a0o-devcheck-1 --model claude-opus-5-5 --effort xhigh --budget 3 --pool devCheck --date-note --concurrency 3 --cap 45
log "opus-chain ALL DONE"
