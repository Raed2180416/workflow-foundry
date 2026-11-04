#!/bin/sh
# DUR-1 paid chain (PREREG-DUR-1 §12-§13.1; BUILD-PLAN row 18): detached, idempotent, resumable. Every step is
# `node experiments/durability/run.mjs <stage> --paid ...`, which itself refuses to spend without the freeze (F-A for the
# author, F-B for the rest) and room in the $80 ledger. A step that finished leaves runs/.done-<step>; a re-launch skips it.
#
# Launch (detached, from a script file, per the operating rules):
#   setsid nohup sh experiments/durability/dur1-chain.sh author > research/durability-20261021/runs/chain-author.log 2>&1 &
#   setsid nohup sh experiments/durability/dur1-chain.sh after-author > research/durability-20261021/runs/chain.log 2>&1 &
# Phases:  author        the $0 dry run on the frozen code (fail closed), then P1 only (the sealed author; F-A must hold)
#          after-author  Stage Z ($0; fail closed: V-1, V-2, V-3, V-11, K-1, and K0.json must say "kill": false)
#                        -> WC-1 t0 -> P0 -> P3 (with P2 C-O) -> P4 -> P5 -> P6 -> P7 -> WC-1 end, ADV-SET -> P7 windows
#                        -> P8 -> P9 -> analysis
# Exit codes of run.mjs: 0 done; 3 refused (a changed freeze or --paid missing: the chain stops); 4 budget (the row is
# budget-stopped, the chain moves on); 5 a stop rule fired (K-1, V-1, V-2, V-3, V-6, V-11, a missing input: the chain
# stops); 75 environment fault (wait 30 minutes, resume the same step); other: harness error (one retry, then the step is
# excluded and reported). A stop in a parallel worker reaches the chain through runs/STOP-chain (review fix 2026-11-04:
# `exit` inside a background step ended only that subshell).
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
RUNS=${DUR1_RUNS:-research/durability-20261021/runs}
mkdir -p "$RUNS"
WAIT=${DUR1_ENV_WAIT_S:-1800}
MIN_KB=${DUR1_MIN_DISK_KB:-1258291}     # 1.2 GB (K-5)
DRY_OUT=${DUR1_DRY_OUT:-/var/tmp/foundry-work/dur1-chain-dry}

log() { echo "$(date -u +%FT%TZ) $*"; }
other_opus() { pgrep -f -- '--model claude-opus-5-5' >/dev/null 2>&1; }   # before an Opus step no DUR-1 Opus session runs, so any match is another chain
stopped() { [ -f "$RUNS/STOP-chain" ]; }
halt() { echo "$(date -u +%FT%TZ) $*" >> "$RUNS/STOP-chain"; log "STOP: $*"; exit "$2"; }

step() {
  name=$1; shift
  if stopped; then log "skip $name (the chain is stopped: $(head -c 300 "$RUNS/STOP-chain"))"; exit 3; fi
  if [ -f "$RUNS/.done-$name" ]; then log "skip $name (done)"; return 0; fi
  tries=0; opus_waits=0
  while :; do
    avail=$(df -Pk / | awk 'NR==2 {print $4}')
    if [ "$avail" -lt "$MIN_KB" ]; then log "K-5: disk ${avail} KB < ${MIN_KB} KB; pausing 30 min"; sleep "$WAIT"; continue; fi
    # Another Opus chain draws on the same session limit: wait (at most 4 x 30 min, then go on; review minor 4: no maximum,
    # and the P2* pattern matched no step). P3's C-O sessions are short and run inside the heal workers: not waited for.
    case "$name" in
      P1*|P6*|P7*|P8*|P9*) if [ "${opus_waits:-0}" -lt 4 ] && other_opus; then opus_waits=$(( ${opus_waits:-0} + 1 )); log "$name: another Opus chain is drawing on the session limit; waiting 30 min ($opus_waits/4)"; sleep "$WAIT"; continue; fi ;;
    esac
    log "start $name: $*"
    nice -n 15 "$@"; rc=$?
    case $rc in
      0)  touch "$RUNS/.done-$name"; log "done $name"; return 0 ;;
      3)  halt "$name refused (freeze changed or --paid missing)" 3 ;;
      4)  touch "$RUNS/.done-$name"; echo "$name" >> "$RUNS/budget-stops.txt"; log "budget stop $name (K-3): moving on"; return 0 ;;
      5)  halt "$name: a stop rule fired (see the step's log and runs/stagez/STOP.json)" 5 ;;
      75) log "environment fault in $name: waiting $WAIT s, then resuming"; sleep "$WAIT" ;;
      *)  tries=$((tries + 1))
          if [ "$tries" -ge 2 ]; then echo "$name rc=$rc" >> "$RUNS/excluded.txt"; touch "$RUNS/.done-$name"; log "harness error twice in $name: excluded"; return 1; fi
          log "harness error rc=$rc in $name: one retry in 60 s"; sleep 60 ;;
    esac
  done
}
# A step whose exclusion voids everything after it (the dry run, Stage Z).
must() { step "$@" || halt "$1 was excluded after two harness errors" 5; }

R="node experiments/durability/run.mjs"
phase=${1:-after-author}
if [ "$phase" = author ]; then
  # The $0 dry run on the frozen code first (PREREG-DUR-1 §13.1 as frozen 2026-11-04): no money before it passes.
  must Z0-dry $R dry --light --out "$DRY_OUT"
  step P1-author $R author --paid
  exit 0
fi
must Z-stagez $R stagez
# K-0 fails closed: no K0.json, or anything but "kill": false, stops the chain before any paid step.
if [ ! -f "$RUNS/stagez/K0.json" ]; then halt "K-0: runs/stagez/K0.json is missing" 5; fi
if ! grep -q '"kill": false' "$RUNS/stagez/K0.json"; then halt "K-0 fired or unreadable: the monitor is blind; stop before any paid heal" 5; fi
step Z-wc1-t0 $R wc1 --when t0
step P0-rehearsal $R p0 --paid
# P2 (C-O) runs inside P3 when an announced rule change first needs its reading; two workers split the lineages (<= 2 paid sessions).
step P3-heal-a $R heal --paid --streams s1,s2 --lineages b1lh-e8-1,b1lh-e8-2,b1lh-e8-3,ch-e8-1,ch-e8-2 &
sleep 120
step P3-heal-b $R heal --paid --streams s1,s2 --lineages ch-e8-3,cht-e8-1,cht-e8-2,cht-e8-3
wait
if stopped; then log "a P3 worker stopped the chain"; exit 3; fi
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
