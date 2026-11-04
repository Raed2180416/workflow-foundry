#!/usr/bin/env bash
# Detached driver for the paid tier replays (PREREG-TIERDOWN.md). Usage:
#   setsid nohup bash experiments/tierdown/run-paid.sh <slice C|H> <tiers> <out.jsonl> <leverage.json> [<other answers files,>] [<journal.sqlite>] > <log> 2>&1 &
# The Mercury key is read only here, into this process's environment, from the owner's env file; it is never printed.
# Exit 75 from tier-replay.mjs is an environment fault (rate or session limit): wait 30 minutes and resume (at most 3
# times); answers already written are never re-asked and faults are never scored.
set -u
SLICE="$1"; TIERS="$2"; OUT="$3"; LEV="$4"; LEDGER="${5:-}"; JOURNAL="${6:-${OUT%.jsonl}.journal.sqlite}"
cd "$(dirname "$0")/../.."
PREREG=research/tierdown-20261021/PREREG-TIERDOWN.json
SHA=2790ad22d0013a087c10573225f433429ee4ea79ac597e9bf4c55b4a5dfaffd4
RUNS="${TIERDOWN_RUNS:-research/jit-20261008/runs}"
if [ -f /root/.config/foundry/inception.env ]; then set -a; . /root/.config/foundry/inception.env; set +a; fi
for attempt in 1 2 3 4; do
  nice -n 15 node experiments/tierdown/tier-replay.mjs --prereg "$PREREG" --expect-sha "$SHA" --slice "$SLICE" --tiers "$TIERS" \
    --leverage "$LEV" --out "$OUT" --ledger "$LEDGER" --journal "$JOURNAL" --runs "$RUNS" --cap-usd 3 --mercury-tokens 450000 --concurrency 2
  code=$?
  echo "tier-replay exit $code (attempt $attempt) at $(date -u +%FT%TZ)"
  [ "$code" -ne 75 ] && exit "$code"
  sleep 1800
done
exit 75
