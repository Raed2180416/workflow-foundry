#!/bin/bash
# OT-0 paid arms (PREREG-OT0 FROZEN at 27ff324, engine v1). Order per §2; Opus only if total spent < $50 (§2) — D6 covers owner agreement.
cd /home/user/workflow-foundry
W=/var/tmp/foundry-work; L=$W/ot0-chain.log
log() { echo "[ot0 $(date -u +%FT%TZ)] $*" >> $L; }
run() { local label=$1; shift; local tries=0
  while :; do
    free=$(df --output=avail -k / | tail -1); [ "$free" -lt 1048576 ] && { log "$label NOT STARTED: <1GB free"; return 9; }
    "$@" >> $W/ot0-$label.log 2>&1; rc=$?; log "$label exit $rc"
    [ $rc -eq 0 ] && return 0
    tries=$((tries+1)); [ $tries -ge 4 ] && { log "STOP $label after $tries failures"; return $rc; }
    sleep 1800
  done; }
spent() { python3 -c "
import json,glob
t=0
for f in glob.glob('research/org-20261021/runs/*/result.json'):
    try: t+=float(json.load(open(f)).get('cost',{}).get('usd',json.load(open(f)).get('costUsd',0)) or 0)
    except Exception: pass
print(round(t,4))"; }
for k in 1 2 3; do run wc-e8-$k node experiments/constitution/build-wc.mjs --model claude-haiku-5-5 --effort high --budget 3 --minutes 40 --label wc-e8-$k; done
run ahv-s12 node experiments/constitution/run-agents.mjs --arm A-HV --model claude-haiku-5-5 --label ahv-s12 --cap 5
run af-sonnet-s12 node experiments/constitution/run-agents.mjs --arm A-F --model claude-sonnet-5-5 --label af-sonnet-s12 --cap 20
SP=$(spent); log "spent so far: \$$SP"
if python3 -c "import sys; sys.exit(0 if float('$SP')<50 else 1)"; then run af-opus-s12 node experiments/constitution/run-agents.mjs --arm A-F --model claude-opus-5-5 --label af-opus-s12 --cap 45; else log "Opus arm skipped: spent \$$SP >= \$50 (prereg §2)"; fi
log "ALL DONE"
