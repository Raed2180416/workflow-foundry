#!/bin/bash
# VL-1 $0 reproduction on the STORED dev60 worlds (development evidence): the live pipeline, end to end, must give the
# verifier lab's pre-declared numbers. No model call can happen: `claude` is kept off PATH for every verifier step, the
# RL2 judge phase runs with --dry and must report 0 calls, and the Haiku judge's stored verdicts are used only after
# their prompts are matched to its journal.
#   DEV_LAB=<development lab dir> DEV_RL2=<its RL2 out dir> DEV_EVAL=<its rule-table JSON> OUT=<work dir> \
#     bash experiments/autobench/verifier/live/repro-dev60.sh
set -euo pipefail
: "${DEV_LAB:?the development lab directory}"; : "${DEV_RL2:?the development RL2 output directory}"; : "${DEV_EVAL:?the development rule table (judge-eval.json)}"
: "${OUT:?a work directory outside the repository}"
LIVE_ROOT=${LIVE_ROOT:-/var/tmp/foundry-work/autobench}
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
D=$REPO/experiments/autobench/verifier
NOCLAUDE="env PATH=$(dirname "$(command -v node)"):/usr/bin:/bin"
$NOCLAUDE sh -c 'command -v claude' && { echo "claude is still on PATH: refusing"; exit 1; }
mkdir -p "$OUT/rl2" "$OUT/dj"
node -e 'const l=require(process.argv[1]); require("fs").writeFileSync(process.argv[2], JSON.stringify({source: "a0-dev60-dn launch.json (dev60)", tasks: [...l.tasks].sort()}, null, 1))' "$LIVE_ROOT/a0-dev60-dn/launch.json" "$OUT/DEV60-TASKS.json"
node -e 'const b=require(process.argv[1]); require("fs").writeFileSync(process.argv[2], JSON.stringify({source: "development lab folds 3-4 (held-out for RL2)", tasks: [...b.folds["3"], ...b.folds["4"]].sort()}, null, 1))' "$DEV_LAB/build-report.json" "$OUT/HELDOUT-F34.json"

# step 2: the label-free lab (6 reported dev60 arms; the lab's arm order; its independent prepares for the rebuild)
python3 -I "$D/live/build-live.py" --tasks "$OUT/DEV60-TASKS.json" --live-root "$LIVE_ROOT" --out "$OUT/lab" \
  --arm m3-a1c=m3-a1c-dev60-dn+m3-a1c-dev60-dn-fill --arm sonnet-a1=a1s-dev60-dn+a1s-dev60-dn-fill --arm haiku-a1c=a1c-dev60-dn \
  --arm sonnet-a0=a0s-dev60-dn --arm haiku-a1=a1-dev60-dn+a1-dev60-dn-fill --arm haiku-a0=a0-dev60-dn \
  --ref-prep-runs a0s-dev60-dn,a0-dev60-dn,a1c-dev60-dn > "$OUT/build.json"

# step 3, replayed: the stored RL2 ledgers (extraction is per task, from the canonical initial world), checks recomputed
# at $0, judged checks from the stored judgments (0 calls to make), the Haiku judge's stored verdicts
cp "$DEV_RL2/extract.jsonl" "$OUT/rl2/extract.jsonl"
cp "$DEV_RL2/judge-all.jsonl" "$OUT/rl2/judge-repro.jsonl"
cp "$DEV_LAB/dj/judgments-haiku-world.jsonl" "$OUT/dj/judgments-haiku-world.jsonl"
$NOCLAUDE node "$D/requirement-ledger-v2/run.mjs" --vlab "$OUT/lab" --out "$OUT/rl2" --phase check --readers haiku:0,haiku:1,haiku:2 --tag repro
$NOCLAUDE node "$D/requirement-ledger-v2/run.mjs" --vlab "$OUT/lab" --out "$OUT/rl2" --phase judge --tag repro --judge-tag repro --judge-only-accepted --dry 2>&1 | tee "$OUT/rl2-judge-dry.txt"
grep -q '^judge: 0 call(s) to make' "$OUT/rl2-judge-dry.txt" || { echo "RL2 judge would make calls: inputs differ"; exit 1; }
$NOCLAUDE node "$D/diverse-judges/run.mjs" --vlab "$OUT/lab" --out "$OUT/dj" --judge haiku --arms m3-a1c,sonnet-a1,haiku-a1c,sonnet-a0,haiku-a1,haiku-a0 --sizes | tee "$OUT/dj-todo.json"
grep -q '"rows":0' "$OUT/dj-todo.json" || { echo "Haiku judge has rows to judge"; exit 1; }

# step 4: select (the lab's pools, in its fork order; P2h/P3h are the VL-1h and VL-3 analogues with the A0 Haiku fork)
POOLS='P2=m3-a1c,sonnet-a1;P3=m3-a1c,haiku-a1c,haiku-a1;P3s=m3-a1c,sonnet-a1,haiku-a1;P6=m3-a1c,sonnet-a1,haiku-a1c,sonnet-a0,haiku-a1,haiku-a0;P2h=m3-a1c,haiku-a0;P3h=m3-a1c,sonnet-a1,haiku-a0'
node "$D/live/select.mjs" --vlab "$OUT/lab" --rl2 "$OUT/rl2" --rl2-tag repro --dj "$OUT/dj" --pools "$POOLS" --rules R0,R1,R2,R3 --out "$OUT/selection.json" > /dev/null

# step 5: score from the dev60 runs' headline grades (development runs; the selection is not committed: --allow-uncommitted)
S5=(--selection "$OUT/selection.json" --live-root "$LIVE_ROOT" --default m3-a1c --compare A0=a0-dev60-dn --rl2 "$OUT/rl2" --rl2-tag repro --dj "$OUT/dj" --allow-uncommitted)
node "$D/live/score.mjs" "${S5[@]}" --out "$OUT/RESULT.json" | tee "$OUT/RESULT.txt"
node "$D/live/score.mjs" "${S5[@]}" --tasks-subset "$OUT/HELDOUT-F34.json" --out "$OUT/RESULT-f34.json" > "$OUT/RESULT-f34.txt"

node "$D/live/repro-check.mjs" --live-lab "$OUT/lab" --dev-dataset "$DEV_LAB/dataset.jsonl" --live-rl2 "$OUT/rl2" --live-tag repro \
  --dev-checks "$DEV_RL2/checks-all.jsonl" --dj-journal "$DEV_LAB/dj/journal.sqlite,$DEV_LAB/dj-pilot/journal.sqlite" --dj "$OUT/dj" \
  --result "$OUT/RESULT.json" --result-heldout "$OUT/RESULT-f34.json" --judge-eval "$DEV_EVAL" --out "$OUT/REPRO-CHECK.json"
