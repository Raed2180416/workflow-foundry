#!/bin/bash
# A1-C v2 held-out evaluation (P1) on PREREG-AB-v1-AMEND-1 look 2: the five arms of A1C-V2-DESIGN.md §5, one after
# another, each hard-capped (D22 dollars, D18 Mercury tokens). PAID. Not run by the build; the orchestrator launches it
# AFTER the P0 decision commit and the hash freeze, detached from this file:
#   V2HASH=<frozen v2 hash> V2MHASH=<frozen v2-M hash> setsid nohup bash look2-chain.sh > /var/tmp/foundry-work/a1c-v2-look2-chain.log 2>&1 &
# An environment fault (run.mjs exit 3: rate or session limit) waits 30 min and resumes with --resume, at most 6 times;
# a fault is never scored. Exit 4 (a cap) stops the chain: raise the cap only by a decision. Outputs stay in the live
# directories (--no-copy: per-task grades are not copied anywhere while arms are pending); copy each summary.json to
# $RUNS/<run-id>/ only after every arm is graded (§5 "after").
set -u
: "${V2HASH:?set V2HASH to the frozen v2 hash (A1C-V2-DESIGN.md §5 freeze)}"
: "${V2MHASH:?set V2MHASH to the frozen v2-M hash (replay/manifest-hash.mjs --harness codeowned-v2 --node-models ...)}"
WT=/home/user/workflow-foundry/.claude/worktrees/wf_3674d3bc-0a7-12
PIN=/home/user/workflow-foundry/.claude/worktrees/a1c-v1-pin
V1HASH=5622c9418c7467b79e234dae5fb48b38f41d4ea8fe044fa5ef0c68f9a109c74f
V1MHASH=fa6c2e45320ff5d986d5afe2b9d62c2f3720cb3f34138a604c4082d34236af7f
cd "$WT" || exit 1
# First launch only: the look-2 tasks must still be unexposed (after the first arm starts, its own launch.json names
# them, so a relaunch of an interrupted chain sets RELAUNCH=1).
[ "${RELAUNCH:-0}" = 1 ] || node experiments/autobench/replay/heldout-look2.mjs > /dev/null || { echo "look 2 no longer matches the DRAFT plan: stop and ask"; exit 1; }
HELD=$(node -e 'process.stdout.write(require(process.argv[1]).tasks.join(","))' "$WT/research/automationbench-20261014/a1c-v2/HELDOUT-LOOK2.json")
COMMON=(--model claude-haiku-5-5 --date-note --concurrency 3 --budget 0.75 --timeout-min 20 --max-steps 50 --det record --k 1 --no-copy --tasks "$HELD")

arm() {   # arm <dir> <mercury 0|1> <run-id> <run.mjs options...>
  local dir=$1 merc=$2 id=$3; shift 3
  local tries=0 rc
  while :; do
    if [ "$merc" = 1 ]; then (cd "$dir" && set -a && . /root/.config/foundry/inception.env && set +a && node experiments/autobench/run.mjs "$@" "${COMMON[@]}" --run-id "$id" $([ $tries -gt 0 ] && echo --resume))
    else (cd "$dir" && node experiments/autobench/run.mjs "$@" "${COMMON[@]}" --run-id "$id" $([ $tries -gt 0 ] && echo --resume)); fi
    rc=$?
    [ $rc -eq 3 ] && [ $tries -lt 6 ] || break
    tries=$((tries + 1)); echo "[$id] environment fault: waiting 30 min before resume $tries of 6"; sleep 1800
  done
  echo "[$id] exit $rc"
  return $rc
}

arm "$PIN" 0 a1c-v1-look2  --harness codeowned    --harness-hash "$V1HASH" --cap 6 || exit $?
arm "$WT"  0 a1c-v2-look2  --harness codeowned-v2 --harness-hash "$V2HASH" --cap 6 || exit $?
arm "$PIN" 0 a0-look2      --cap 4 || exit $?
arm "$PIN" 1 a1c-v1m-look2 --harness codeowned    --node-models ledger=mercury-3,checker=mercury-3 --harness-hash "$V1MHASH" --cap 4 --token-cap 5500000 --session-tokens 300000 || exit $?
arm "$WT"  1 a1c-v2m-look2 --harness codeowned-v2 --node-models ledger=mercury-3,checker=mercury-3 --harness-hash "$V2MHASH" --cap 4 --token-cap 5500000 --session-tokens 300000 || exit $?
echo "all five arms finished"
