#!/usr/bin/env bash
# Second $0 H pass (PREREG "secondary", AMENDMENT-1): the provisional policy is the selected set minus every pair that
# failed its H conditions (a pass->fail flip on its H units or Bound 2 on H), read mechanically from data/eval-H.json,
# injected on all H units at once under the name `provisional`. No model calls.
set -u
cd "$(dirname "$0")/../.."
D=research/tierdown-20261021/data
RUNS="${TIERDOWN_RUNS:-research/jit-20261008/runs}"
SPEC=$(node -e '
const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const keep = e.provisional.filter(p => p.keep);
if (!keep.length) { console.error("no provisional pair"); process.exit(1); }
console.log("provisional=" + keep.map(p => `${p.site}:${p.tier}`).join(","));
' "$D/eval-H.json") || exit 1
echo "$SPEC"
nice -n 15 node experiments/tierdown/inject.mjs --answers "$D/answers-H.jsonl,$D/answers-H-rule.jsonl" --leverage "$D/leverage.json" \
  --slice H --all-rows --assign "$SPEC" --runs "$RUNS" --concurrency "${CONCURRENCY:-2}" --out "$D/inject-H-provisional.json"
echo "inject H provisional exit $? at $(date -u +%FT%TZ)"
