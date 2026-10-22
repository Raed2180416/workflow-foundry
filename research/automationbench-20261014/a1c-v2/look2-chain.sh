#!/bin/bash
# A1-C v2 held-out evaluation (P1) = look 2 of the FROZEN SEQUENTIAL-PLAN-v1 (PREREG-AB-v1-AMEND-1 §6; decisions D23,
# D25). PAID. Not run by the build; launched after the P0 decision commit, the hash freeze and the P1 preregistration,
# detached from this file:
#   V1HASH=… V1MHASH=… V2HASH=… V2MHASH=… V2COMMIT=… CLI='2.1.307 (Claude Code)' MERCURY_OTHER=… D22_LEFT=… [T3=1] \
#     setsid nohup bash look2-chain.sh > /var/tmp/foundry-work/a1c-v2-look2-chain.log 2>&1 &
# Every arm starts through `sequential.mjs look 2 --exec` of the checkout it runs from, so it carries the
# sequential-look.json sidecar (live directory and repo copy) and its repo copy lands in that checkout's runs/ (a look
# run may not pass --no-copy). Arms, in this order (v2 sits next to both v1 and A0; T3 next to A0):
#   key    checkout  role       --arm                                  --first-look  run id
#   v1     pin       treatment  A1-C                                   2             a1c-v1-look2
#   v2     branch    treatment  A1-C v2                                2             a1c-v2-look2
#   A0     pin       control    A0                                     -             a0-look2       (the ONLY control run)
#   A0-AA  pin       treatment  A0 (T3 A/A)                            2             a0-look2-aa    (only with T3=1; AMEND-1 §4)
#   v1-M   pin       treatment  A1-C (Mercury ledger and checker)      2             a1c-v1m-look2
#   v2-M   branch    treatment  A1-C v2 (Mercury ledger and checker)   2             a1c-v2m-look2
# The analysis is fixed in experiments/autobench/replay/look2-analysis.mjs (confirmatory: v2 vs A0 under the plan;
# descriptive: exact two-sided McNemar, v2 vs v1 first). The chain is idempotent: an arm whose live summary.json exists
# is done and skipped; an arm whose launch.json exists is resumed (--resume, its launch caps kept).
# Before every arm it checks: the pin commit, run.mjs and bridge.py shas, the branch commit, both checkouts' plan and
# look-2 files, the CLI version, the look-2 exposure (heldout-look2.mjs: no look-2 task in any run outside this plan's
# look-2 runs and the D26 reference arm), the D22 dollars left for the chain, and for a Mercury arm the D18 token
# ceiling. An environment fault (run.mjs exit 3) waits 30 min and resumes, at most 6 times, and is never scored; exit 4
# (a cap) stops the chain: a higher cap needs a decision. Exit 5: D22 dollars; exit 6: D18 tokens; exit 7: an
# integrity check failed.
set -u
: "${V1HASH:?frozen v1 hash (pin, at the CLI below)}"; : "${V1MHASH:?frozen v1-M hash}"; : "${V2HASH:?frozen v2 hash}"; : "${V2MHASH:?frozen v2-M hash}"
: "${V2COMMIT:?the frozen v2 branch commit (full sha)}"; : "${CLI:?the CLI version the hashes were frozen at, e.g. 2.1.307 (Claude Code)}"
: "${MERCURY_OTHER:?Mercury tokens used outside the live run records (D18 ledger)}"; : "${D22_LEFT:?USD of D22 left for this chain}"
export DISABLE_AUTOUPDATER=1
unset FORCE_PROMPT_CACHING_5M
WT=/home/user/workflow-foundry/.claude/worktrees/wf_3674d3bc-0a7-12
PIN=/home/user/workflow-foundry/.claude/worktrees/a1c-v1-pin
LIVE=${A1CV2_LIVE:-/var/tmp/foundry-work/autobench}       # overridden only by the $0 rehearsal (a1c-v2/rehearse-chain.sh)
SEQ_JS=${A1CV2_SEQ_JS:-experiments/autobench/sequential.mjs}   # idem: a stand-in that launches nothing
PIN_COMMIT=b1e16e030470c077b8c09bc3fdf06a32c2a26209         # aada200 + the frozen plan files (tag a1c-v1-look2)
PIN_RUNNER=ea1dca70628a80262430b0d693d013fab456aebccefaac9e48db9713d4c87c5f
BRIDGE=285be4f5ba32f569c904897d512524535f6b50c11c05d54e419e5e272f97641a
PLAN_FILE_SHA=56e8d3cf5f19ebf7268d49fed99d9ae85afb3c031b873979df02777aa53dc261  # SEQUENTIAL-PLAN-v1.json (plan 3cd586bd…)
LOOK2_FILE_SHA=85099131ad42ff27dd547c087797552fc424906093b5feb560ea5b81ebd2f567 # LOOK2-TASKS.json (list a8c1ed5c…)
PLAN=research/automationbench-20261014/SEQUENTIAL-PLAN-v1.json
COMMON=(--model claude-haiku-5-5 --date-note --concurrency 3 --budget 0.75 --timeout-min 20 --max-steps 50 --det record --k 1)
CHAIN_IDS=a1c-v1-look2,a1c-v2-look2,a0-look2,a0-look2-aa,a1c-v1m-look2,a1c-v2m-look2
say() { echo "[look2-chain $(date -u +%FT%TZ)] $*"; }
fail() { say "STOP: $1"; exit "${2:-7}"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }

checks() {
  [ "$(git -C "$PIN" rev-parse HEAD)" = "$PIN_COMMIT" ] || fail "pin HEAD is not $PIN_COMMIT"
  [ -z "$(git -C "$PIN" status --porcelain --untracked-files=no)" ] || fail "pin has tracked changes"
  [ "$(git -C "$WT" rev-parse HEAD)" = "$V2COMMIT" ] || fail "branch HEAD is not V2COMMIT $V2COMMIT"
  [ -z "$(git -C "$WT" status --porcelain --untracked-files=no)" ] || fail "branch has tracked changes"
  [ "$(sha "$PIN/experiments/autobench/run.mjs")" = "$PIN_RUNNER" ] || fail "pin run.mjs is not $PIN_RUNNER"
  for d in "$PIN" "$WT"; do
    [ "$(sha "$d/experiments/autobench/bridge.py")" = "$BRIDGE" ] || fail "$d bridge.py is not $BRIDGE"
    [ "$(sha "$d/$PLAN")" = "$PLAN_FILE_SHA" ] || fail "$d plan file differs"
    [ "$(sha "$d/research/automationbench-20261014/LOOK2-TASKS.json")" = "$LOOK2_FILE_SHA" ] || fail "$d LOOK2-TASKS.json differs"
  done
  [ "$(claude --version 2>/dev/null | head -1)" = "$CLI" ] || fail "CLI is '$(claude --version 2>/dev/null | head -1)', not '$CLI' (the frozen hashes and A0's runner assume it)"
  [ "$(df --output=avail -k / | tail -1)" -ge 1048576 ] || fail "less than 1 GB free"
  (cd "$WT" && node experiments/autobench/replay/heldout-look2.mjs > "$LIVE/../a1c-v2-look2-exposure.json") || fail "look-2 exposure check failed (see $LIVE/../a1c-v2-look2-exposure.json)"
}

# arm <key> <checkout dir> <mercury 0|1> <run id> <role> <arm name> <first look|-> <cap USD> <min cap USD> [run.mjs options…]
arm() {
  local key=$1 dir=$2 merc=$3 id=$4 role=$5 name=$6 first=$7 cap=$8 mincap=$9; shift 9
  local tries=0 rc resume=() fl=() tok=()
  if [ -f "$LIVE/$id/summary.json" ]; then say "[$key] $id already finished: skipped"; return 0; fi
  checks
  [ "$first" = - ] || fl=(--first-look "$first")
  if [ -f "$LIVE/$id/launch.json" ]; then
    resume=(--resume)
    cap=$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).capUsd))' "$LIVE/$id/launch.json")
    [ "$merc" = 1 ] && tok=(--token-cap "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tokenCap))' "$LIVE/$id/launch.json")" --session-tokens 300000)
    say "[$key] resuming $id at its launch caps"
  else
    # D22: the chain's settled spend plus this arm's cap stay within D22_LEFT.
    local spent left
    spent=$(cd "$WT" && node experiments/autobench/replay/look2-guard.mjs spend --live "$LIVE" --runs "$CHAIN_IDS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).total)))')
    left=$(node -e 'process.stdout.write(String(Math.floor((Number(process.argv[1]) - Number(process.argv[2])) * 100) / 100))' "$D22_LEFT" "$spent")
    if node -e 'process.exit(Number(process.argv[1]) < Number(process.argv[2]) ? 0 : 1)' "$left" "$cap"; then cap=$left; fi
    node -e 'process.exit(Number(process.argv[1]) >= Number(process.argv[2]) ? 0 : 1)' "$cap" "$mincap" || fail "[$key] D22: \$$left left after \$$spent spent; the arm needs at least \$$mincap" 5
    if [ "$merc" = 1 ]; then
      local tc
      tc=$(cd "$WT" && node experiments/autobench/replay/look2-guard.mjs cap --live "$LIVE" --other "$MERCURY_OTHER") || fail "[$key] D18: the Mercury token ceiling leaves less than 4.5M for this arm" 6
      tok=(--token-cap "$tc" --session-tokens 300000)
    fi
    say "[$key] launching $id: cap \$$cap${tok:+ ${tok[*]}} (chain spent \$$spent of D22_LEFT \$$D22_LEFT)"
  fi
  while :; do
    if [ "$merc" = 1 ]; then
      (cd "$dir" && { [ -n "${A1CV2_SEQ_JS:-}" ] || { set -a && . /root/.config/foundry/inception.env && set +a; }; } && nice node "$SEQ_JS" look 2 --plan "$PLAN" --role "$role" --arm "$name" "${fl[@]}" --exec -- --run-id "$id" "${COMMON[@]}" "$@" --cap "$cap" "${tok[@]}" "${resume[@]}")
    else
      (cd "$dir" && nice node "$SEQ_JS" look 2 --plan "$PLAN" --role "$role" --arm "$name" "${fl[@]}" --exec -- --run-id "$id" "${COMMON[@]}" "$@" --cap "$cap" "${resume[@]}")
    fi
    rc=$?
    echo "$id exit $rc (CLI $(claude --version 2>/dev/null | cut -d' ' -f1)) $(date -u +%FT%TZ)" >> "$LIVE/../launches.log"
    [ $rc -eq 3 ] && [ $tries -lt 6 ] || break
    tries=$((tries + 1)); resume=(--resume); say "[$key] environment fault: waiting 30 min before resume $tries of 6"; sleep "${A1CV2_FAULT_WAIT:-1800}"; checks
  done
  say "[$key] $id exit $rc"
  [ $rc -eq 0 ] || fail "[$key] $id exit $rc" "$rc"
}

checks
arm v1    "$PIN" 0 a1c-v1-look2  treatment 'A1-C'    2 "${CAP_V1:-6}" 4.5 --harness codeowned    --harness-hash "$V1HASH"
arm v2    "$WT"  0 a1c-v2-look2  treatment 'A1-C v2' 2 "${CAP_V2:-6}" 4.5 --harness codeowned-v2 --harness-hash "$V2HASH"
arm A0    "$PIN" 0 a0-look2      control   'A0'      - "${CAP_A0:-4}" 3.2
[ "${T3:-0}" = 1 ] && arm A0-AA "$PIN" 0 a0-look2-aa treatment 'A0 (T3 A/A)' 2 "${CAP_A0:-4}" 3.2
arm v1-M  "$PIN" 1 a1c-v1m-look2 treatment 'A1-C (Mercury ledger and checker)'    2 "${CAP_M:-4}" 3.2 --harness codeowned    --node-models ledger=mercury-3,checker=mercury-3 --harness-hash "$V1MHASH"
arm v2-M  "$WT"  1 a1c-v2m-look2 treatment 'A1-C v2 (Mercury ledger and checker)' 2 "${CAP_M:-4}" 3.2 --harness codeowned-v2 --node-models ledger=mercury-3,checker=mercury-3 --harness-hash "$V2MHASH"
say "every arm finished; harm (paired) and the fixed analysis"
[ -z "${A1CV2_SEQ_JS:-}" ] || { say "rehearsal: harm and analysis skipped"; exit 0; }
R=$WT/research/automationbench-20261014/runs
(cd "$WT" && node experiments/autobench/replay/harm.mjs --run "$LIVE/a1c-v1-look2" --run2 "$LIVE/a1c-v2-look2" --out "$R/a1c-v2-look2/harm-v1-v2.json" > /dev/null) || say "harm v1 vs v2: not comparable (see the file)"
(cd "$WT" && node experiments/autobench/replay/harm.mjs --run "$LIVE/a1c-v1m-look2" --run2 "$LIVE/a1c-v2m-look2" --out "$R/a1c-v2m-look2/harm-v1m-v2m.json" > /dev/null) || say "harm v1-M vs v2-M: not comparable (see the file)"
(cd "$WT" && node experiments/autobench/replay/look2-analysis.mjs --pin "$PIN" --branch "$WT" --harm "$R/a1c-v2-look2/harm-v1-v2.json" --write "$R/a1c-v2-look2/analysis.json")
say "done"
