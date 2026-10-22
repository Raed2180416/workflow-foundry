#!/bin/bash
# OT-0 agent arms, re-run under PREREG-OT0-AMEND-1 (engine v1, the main tree as it is; the engine v2 series is not merged).
# Order (PREREG-OT0 §2): A-HV, then A-F Sonnet, then A-F Opus (D6), the Opus arm only if total OT-0 spend is under $50
# (W-C builds + the void runs of 2026-10-21 + these re-runs).
# Each arm runs under nice and is checked against disk space first (it stops below 1 GB free).
# Exit 3 (an environment fault: rate, usage or session limit, 429/529, overload) or a kill by a signal: wait 30 min and
# re-run the same command, which resumes from the last commit, at most 6 times.
# Exit 4 (graded, but contaminated by a late fault): logged, the chain goes on.
# Any other non-zero exit: logged, the chain stops.
# Launch detached:  setsid nohup bash experiments/constitution/ot0-rerun.sh >/var/tmp/foundry-work/ot0-rerun.out 2>&1 < /dev/null &
cd /home/user/workflow-foundry || exit 1
W=/var/tmp/foundry-work; L=$W/ot0-rerun.log
WAIT=${OT0_RESUME_WAIT_S:-1800}; MAX_RESUMES=6; MIN_FREE_KB=1048576
log() { echo "[ot0-rerun $(date -u +%FT%TZ)] $*" >> "$L"; }
run() {
  local label=$1; shift; local resumes=0 rc free
  # A finished row is never re-run (run-agents.mjs would refuse it with exit 1 and stop the chain).
  if [ -f "research/org-20261021/runs/$label/result.json" ]; then log "$label already has result.json; skipped"; return 0; fi
  while :; do
    free=$(df --output=avail -k / | tail -1)
    if [ "$free" -lt "$MIN_FREE_KB" ]; then log "$label NOT STARTED: ${free} KB free (< 1 GB)"; return 9; fi
    log "$label start (resumes so far: $resumes; ${free} KB free)"
    nice -n 10 "$@" >> "$W/ot0-$label.log" 2>&1; rc=$?
    log "$label exit $rc"
    case $rc in
      0) return 0 ;;
      4) log "$label CONTAMINATED by a late fault (graded; re-run fresh under a new label)"; return 4 ;;
      3|129|130|131|134|137|143)
        resumes=$((resumes+1))
        if [ $resumes -gt $MAX_RESUMES ]; then log "STOP $label: faulted again after $MAX_RESUMES resumes; resume later with the same command"; return 3; fi
        log "$label: environment fault or kill; resume $resumes/$MAX_RESUMES in ${WAIT}s"
        sleep "$WAIT" ;;
      *) log "$label FAILED (exit $rc); not retried"; return "$rc" ;;
    esac
  done
}
spent() { node --input-type=module -e "
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { priorSpend, LIVE_ROOT } from './experiments/constitution/run-agents.mjs';
const R = 'research/org-20261021/runs', j = f => JSON.parse(readFileSync(f, 'utf8'));
let wc = 0, voidUsd = 0, rerun = 0;
for (const d of readdirSync(R).filter(d => /^wc-e8-\d+$/.test(d))) if (existsSync(R + '/' + d + '/result.json')) wc += j(R + '/' + d + '/result.json').build?.costUsd ?? 0;
for (const d of ['ahv-s12', 'af-sonnet-s12', 'af-opus-s12']) { const f = R + '/void-20261021/' + d + '/result.json'; if (existsSync(f)) voidUsd += j(f).spentUsd ?? 0; }
for (const d of ['ahv-s12-r1', 'af-sonnet-s12-r1', 'af-opus-s12-r1']) {
  const f = R + '/' + d + '/result.json';
  rerun += existsSync(f) ? (j(f).spentUsd ?? 0) : existsSync(LIVE_ROOT + '/' + d) ? priorSpend(LIVE_ROOT + '/' + d).usd : 0;
}
console.log((wc + voidUsd + rerun).toFixed(4), 'wc', wc.toFixed(4), 'void', voidUsd.toFixed(4), 'rerun', rerun.toFixed(4));
"; }

log "START head $(git rev-parse --short HEAD); prereg $(node --input-type=module -e "import { preregCheck } from './experiments/constitution/freeze.mjs'; const p = preregCheck(); console.log(p.sha256.slice(0, 12), 'amendments', p.amendments.map(a => a.file.split('/').pop() + ':' + a.sha256.slice(0, 12)).join(','))" 2>&1)"
log "spend before: $(spent)"
run ahv-s12-r1 node experiments/constitution/run-agents.mjs --arm A-HV --model claude-haiku-5-5 --label ahv-s12-r1 --cap 5
rc=$?; if [ $rc -ne 0 ] && [ $rc -ne 4 ]; then log "CHAIN STOPPED at ahv-s12-r1 (exit $rc); spend $(spent)"; exit $rc; fi
run af-sonnet-s12-r1 node experiments/constitution/run-agents.mjs --arm A-F --model claude-sonnet-5-5 --label af-sonnet-s12-r1 --cap 20
rc=$?; if [ $rc -ne 0 ] && [ $rc -ne 4 ]; then log "CHAIN STOPPED at af-sonnet-s12-r1 (exit $rc); spend $(spent)"; exit $rc; fi
SP=$(spent); log "spend before Opus: $SP"
if node -e "process.exit(Number(process.argv[1]) < 50 ? 0 : 1)" "${SP%% *}"; then
  run af-opus-s12-r1 node experiments/constitution/run-agents.mjs --arm A-F --model claude-opus-5-5 --label af-opus-s12-r1 --cap 45
  rc=$?; if [ $rc -ne 0 ] && [ $rc -ne 4 ]; then log "CHAIN STOPPED at af-opus-s12-r1 (exit $rc); spend $(spent)"; exit $rc; fi
else log "Opus arm skipped: spend \$${SP%% *} >= \$50 (PREREG-OT0 §2)"; fi
log "ALL DONE; spend $(spent)"
