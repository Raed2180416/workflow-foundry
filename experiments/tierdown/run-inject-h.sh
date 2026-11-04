#!/usr/bin/env bash
# H-slice end-to-end injection at $0 (AMENDMENT-1 "Combined assignments injected on H"): every single (site, tier) pair
# with H answers (--each), plus the frozen combined assignments from data/select-C.json (the policy spec is injected
# under the name AMENDMENT-1 gives it, `selected`). --all-rows keeps every faithful H row, so a unit no assignment touches
# still counts at its reference cost and outcome. No model calls.
#   setsid nohup bash experiments/tierdown/run-inject-h.sh > <log> 2>&1 &
set -u
cd "$(dirname "$0")/../.."
D=research/tierdown-20261021/data
# The archive is read-only material; a sparse worktree points TIERDOWN_RUNS at the main tree's copy.
RUNS="${TIERDOWN_RUNS:-research/jit-20261008/runs}"
SPECS=$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).assignSpecs;
console.log([s.policy.replace(/^policy=/, "selected="), s["B-screen"], s["B-all-haiku"], s["B-all-mercury"], s["B-sink"], s["B-memo"]].join(";"));
' "$D/select-C.json")
nice -n 15 node experiments/tierdown/inject.mjs --answers "$D/answers-H.jsonl,$D/answers-H-rule.jsonl" --leverage "$D/leverage.json" \
  --slice H --each --all-rows --assign "$SPECS" --runs "$RUNS" --concurrency "${CONCURRENCY:-2}" --out "${OUT:-$D/inject-H.json}"
echo "inject H exit $? at $(date -u +%FT%TZ)"
