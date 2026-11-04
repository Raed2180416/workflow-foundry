#!/bin/bash
# VL-1 steps 2-6 on look 2 (PREREG-VL1 §5), from the main tree. Each subcommand checks the frozen file hashes first.
#   bash experiments/autobench/verifier/live/run-look2.sh lab      # step 2: label-free lab from the fork runs ($0)
#   bash experiments/autobench/verifier/live/run-look2.sh verify   # step 3: RL2 extract/check/judge + Haiku judge (PAID, ~$1.3; caps)
#   bash experiments/autobench/verifier/live/run-look2.sh select   # step 4: selection.json ($0) -> commit it: the blind boundary
#   bash experiments/autobench/verifier/live/run-look2.sh repair   # step 6: VL-1R (PAID, <= $1), after the commit, before step 5
#   bash experiments/autobench/verifier/live/run-look2.sh score    # step 5: after the commit AND after the A1-C v2 chain is graded
# Forks: v1m = a1c-v1m-look2 (default), sonnet-a1 = a1s-look2, haiku-a0 = a0-look2, v2m = a1c-v2m-look2 (when finished).
# A fork run is used only when its summary.json exists (the run finished; faults were resumed, never scored).
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
D=$REPO/experiments/autobench/verifier
R=$REPO/research/automationbench-20261014
LIVE=/var/tmp/foundry-work/autobench
L=${VL1_WORK:-/var/tmp/foundry-work/vl1-look2}
PIN=/home/user/workflow-foundry/.claude/worktrees/a1c-v1-pin
V2WT=/home/user/workflow-foundry/.claude/worktrees/wf_3674d3bc-0a7-12
LIST=$R/LOOK2-TASKS.json
LIST_SHA=a8c1ed5c8b18606c97feb7fcdd83115eab8cbdffa6e7956d9ee6d9d0974e916f
say() { echo "[vl1-look2 $(date -u +%FT%TZ)] $*"; }
fail() { say "STOP: $1"; exit "${2:-7}"; }
finished() { [ -f "$LIVE/$1/summary.json" ]; }

frozen() {
  (cd "$REPO" && sha256sum --quiet -c "$R/vl1/VL1-FROZEN-SHA256SUMS") || fail "a frozen VL-1 file changed (VL1-FROZEN-SHA256SUMS)"
  local bad
  bad=$(cd "$D/requirement-ledger-v2" && sha256sum -c "$R/vl1/RL2-FROZEN-SHA256SUMS" 2>/dev/null | grep -v ': OK$' | grep -v '^run.mjs: FAILED$' || true)
  [ -z "$bad" ] || fail "RL2 logic differs from its freeze: $bad"
  node -e 'const c=require("crypto"),t=require(process.argv[1]).tasks; const h=c.createHash("sha256").update(JSON.stringify([...t].sort())).digest("hex"); if (h!==process.argv[2]) process.exit(1)' "$LIST" "$LIST_SHA" || fail "look-2 list hash differs"
  [ "$(df --output=avail -k / | tail -1)" -ge 1258291 ] || fail "less than 1.2 GB free"
}
arms() {
  for r in a1c-v1m-look2 a1s-look2 a0-look2; do finished "$r" || fail "fork $r has not finished"; done
  ARMS=(--arm v1m=a1c-v1m-look2 --arm sonnet-a1=a1s-look2 --arm haiku-a0=a0-look2)
  ARMLIST=v1m,sonnet-a1,haiku-a0
  POOLS='P2=v1m,sonnet-a1;P2h=v1m,haiku-a0;P3=v1m,sonnet-a1,haiku-a0'
  if finished a1c-v2m-look2; then ARMS+=(--arm v2m=a1c-v2m-look2); ARMLIST+=,v2m; POOLS+=';P2v2=v2m,sonnet-a1'; fi
}

frozen
case "${1:-}" in
  lab)
    arms
    python3 -I "$D/live/build-live.py" --tasks "$LIST" --live-root "$LIVE" "${ARMS[@]}" --out "$L/lab" | tee "$L.build.json" ;;
  verify)
    [ -f "$L/lab/manifest.json" ] || fail "no lab: run 'lab' first"
    node "$D/requirement-ledger-v2/run.mjs" --vlab "$L/lab" --out "$L/rl2" --phase extract --readers haiku:0,haiku:1,haiku:2 --usd-cap 1.5
    node "$D/requirement-ledger-v2/run.mjs" --vlab "$L/lab" --out "$L/rl2" --phase check --readers haiku:0,haiku:1,haiku:2 --tag look2
    node "$D/requirement-ledger-v2/run.mjs" --vlab "$L/lab" --out "$L/rl2" --phase judge --tag look2 --judge-tag look2 --judge-only-accepted --usd-cap 2
    ARMLIST=$(node -e 'process.stdout.write(require(process.argv[1]).armOrder.join(","))' "$L/lab/manifest.json")
    node "$D/diverse-judges/run.mjs" --vlab "$L/lab" --out "$L/dj" --judge haiku --arms "$ARMLIST" --usd-cap 0.75 ;;
  select)
    [ -f "$L/rl2/checks-look2.jsonl" ] && [ -f "$L/dj/judgments-haiku-world.jsonl" ] || fail "verifier outputs missing: run 'verify' first"
    POOLS='P2=v1m,sonnet-a1;P2h=v1m,haiku-a0;P3=v1m,sonnet-a1,haiku-a0'
    node -e 'process.exit(require(process.argv[1]).armOrder.includes("v2m") ? 0 : 1)' "$L/lab/manifest.json" && POOLS+=';P2v2=v2m,sonnet-a1'
    node "$D/live/select.mjs" --vlab "$L/lab" --rl2 "$L/rl2" --rl2-tag look2 --dj "$L/dj" --pools "$POOLS" --rules R0,R1,R2,R3 --out "$R/vl1/selection.json"
    say "commit research/automationbench-20261014/vl1/selection.json now: it is the blind boundary (score.mjs refuses an uncommitted selection)" ;;
  repair)
    git -C "$REPO" ls-files --error-unmatch "$R/vl1/selection.json" > /dev/null 2>&1 || fail "selection.json is not committed"
    [ ! -f "$R/vl1/RESULT.json" ] || fail "step 5 already ran: VL-1R must run before scoring"
    node "$D/live/repair.mjs" --selection "$R/vl1/selection.json" --primary P2/R3 --vlab "$L/lab" --rl2 "$L/rl2" --rl2-tag look2 \
      --live-root "$LIVE" --checkout "$PIN" --out "$L/repair" --cap 1 --budget 0.1 --model claude-haiku-5-5 ;;
  score)
    for r in a1c-v1-look2 a1c-v2-look2 a0-look2 a1c-v1m-look2 a1c-v2m-look2 a1s-look2 a0o-look2-1; do finished "$r" || fail "$r has not finished: score after the A1-C v2 chain and the reference run are graded"; done
    [ -f "$V2WT/research/automationbench-20261014/runs/a1c-v2-look2/analysis.json" ] || fail "the A1-C v2 chain's analysis is not written yet"
    REP=(); [ -f "$L/repair/repair.json" ] && REP=(--repair "$L/repair/repair.json")
    node "$D/live/score.mjs" --selection "$R/vl1/selection.json" --live-root "$LIVE" --default v1m --ref a0o-look2-1 --compare A0=a0-look2 \
      --primary P2/R3 --rl2 "$L/rl2" --rl2-tag look2 --dj "$L/dj" "${REP[@]}" --out "$R/vl1/RESULT.json" ;;
  *) echo "usage: run-look2.sh lab|verify|select|repair|score"; exit 2 ;;
esac
