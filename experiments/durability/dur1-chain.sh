#!/bin/sh
# DUR-1 paid chain (PREREG-DUR-1 §12-§13.1; BUILD-PLAN row 18): detached, idempotent, resumable. Every step is
# `node experiments/durability/run.mjs <stage> --paid ...`, which itself refuses to spend without the freeze (F-A for the
# author, F-B for the rest) and room in the $80 ledger. A step that finished leaves runs/.done-<step>; a re-launch skips it.
#
# Launch (detached, from a script file, per the operating rules):
#   setsid nohup sh experiments/durability/dur1-chain.sh after-author > research/durability-20261021/runs/chain.log 2>&1 &
# Phases:  author        P1 only (the sealed author; freeze F-A must hold)
#          after-author  Stage Z ($0, K-0) -> P0 -> P3 (with P2 C-O) -> P4 -> P5 -> P6 -> P7 -> P8 -> P9 -> analysis
# Exit codes of run.mjs: 0 done, 3 refused (freeze or --paid: the chain stops), 4 budget (the row is budget-stopped, the
# chain moves on), 75 environment fault (wait 30 minutes, resume the same step), other: harness error (one retry, then the
# step is excluded and reported).
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
RUNS=research/durability-20261021/runs
mkdir -p "$RUNS"
WAIT=${DUR1_ENV_WAIT_S:-1800}
MIN_KB=${DUR1_MIN_DISK_KB:-1258291}     # 1.2 GB (K-5)

log() { echo "$(date -u +%FT%TZ) $*"; }
other_opus() { pgrep -f -- '--model claude-opus-5-5' >/dev/null 2>&1; }   # before an Opus step no DUR-1 Opus session runs, so any match is another chain

step() {
  name=$1; shift
  if [ -f "$RUNS/.done-$name" ]; then log "skip $name (done)"; return 0; fi
  tries=0
  while :; do
    avail=$(df -Pk / | awk 'NR==2 {print $4}')
    if [ "$avail" -lt "$MIN_KB" ]; then log "K-5: disk ${avail} KB < ${MIN_KB} KB; pausing 30 min"; sleep "$WAIT"; continue; fi
    case "$name" in
      P1*|P2*|P6*|P7*|P8*) if other_opus; then log "$name: another Opus chain is drawing on the session limit; waiting 30 min"; sleep "$WAIT"; continue; fi ;;
    esac
    log "start $name: $*"
    nice -n 15 "$@"; rc=$?
    case $rc in
      0)  touch "$RUNS/.done-$name"; log "done $name"; return 0 ;;
      3)  log "STOP: $name refused (freeze changed or --paid missing)"; exit 3 ;;
      4)  touch "$RUNS/.done-$name"; echo "$name" >> "$RUNS/budget-stops.txt"; log "budget stop $name (K-3): moving on"; return 0 ;;
      75) log "environment fault in $name: waiting $WAIT s, then resuming"; sleep "$WAIT" ;;
      *)  tries=$((tries + 1))
          if [ "$tries" -ge 2 ]; then echo "$name rc=$rc" >> "$RUNS/excluded.txt"; touch "$RUNS/.done-$name"; log "harness error twice in $name: excluded"; return 1; fi
          log "harness error rc=$rc in $name: one retry in 60 s"; sleep 60 ;;
    esac
  done
}

R="node experiments/durability/run.mjs"
phase=${1:-after-author}
if [ "$phase" = author ]; then
  step P1-author $R author --paid
  exit 0
fi
step Z-stagez $R stagez
step Z-wc1-t0 $R wc1 --when t0
if [ -f "$RUNS/stagez/K0.json" ] && grep -q '"kill": true' "$RUNS/stagez/K0.json"; then log "K-0 fired: the monitor is blind; stop before any paid heal"; exit 0; fi
step P0-rehearsal $R p0 --paid
# P2 (C-O) runs inside P3 when an announced rule change first needs its reading; two workers split the lineages (<= 2 paid sessions).
step P3-heal-a $R heal --paid --streams s1,s2 --lineages b1lh-e8-1,b1lh-e8-2,b1lh-e8-3,ch-e8-1,ch-e8-2 &
sleep 120
step P3-heal-b $R heal --paid --streams s1,s2 --lineages ch-e8-3,cht-e8-1,cht-e8-2,cht-e8-3
wait
step P4-windows $R windows --paid --streams s1,s2 --kind A-H
step P5-s3-heal $R heal --paid --streams s3
step P5-s3-windows $R windows --paid --streams s3 --kind A-H
step P6-refm $R refm --paid
step P7-redteam $R redteam --paid
step wc1-end $R wc1 --when end
step advset $R advset
step P7-rtwindows $R rtwindows --paid
step P8-aox $R windows --paid --kind A-Ox
step P9-forks $R forks --paid
step analysis $R analyze
log "chain complete"
