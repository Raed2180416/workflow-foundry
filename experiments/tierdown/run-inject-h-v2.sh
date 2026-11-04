#!/usr/bin/env bash
# Review 2026-11-04: the H-slice $0 injection re-run with the corrected inject.mjs (per-event tier charge, wall-time
# latency, deopt-as-loss direction, sameFirstTier flags, tier tokens, all-frontier cost estimate). Same answers, same
# frozen assignments as run-inject-h.sh, plus:
#   provisional   the six pairs eval-H.json kept (exploratory, chosen ON H: in-sample);
#   selected-tier the frozen `selected` set minus every pair whose tier is the FIRST model of the site's preregistered
#                 reference (PREREG-TIERDOWN.json sites[].reference): its deployed cascade [tier, ...reference] is the
#                 reference cascade itself (policy.mjs cascadeOf), so it is not a tier change. Defined from the frozen
#                 preregistration text alone, before this run; no H outcome is read.
# No model calls. Output: data/inject-H-v2.json (the original data/inject-H*.json files are kept for the audit trail).
#   setsid nohup bash experiments/tierdown/run-inject-h-v2.sh > <log> 2>&1 &
set -u
cd "$(dirname "$0")/../.."
D=research/tierdown-20261021/data
RUNS="${TIERDOWN_RUNS:-research/jit-20261008/runs}"
SPECS=$(node -e '
const fs = require("fs");
const sel = JSON.parse(fs.readFileSync(process.argv[1], "utf8")), prereg = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), ev = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const s = sel.assignSpecs, first = site => (prereg.sites.find(x => x.site === site)?.reference ?? "").match(/claude-[a-z]+-\d+-\d+|mercury-\d+/)?.[0];
const tierPairs = sel.selection.order.filter(o => first(o.site) !== o.tier);
const prov = ev.provisional.filter(p => p.keep);
console.log([s.policy.replace(/^policy=/, "selected="), "provisional=" + prov.map(p => `${p.site}:${p.tier}`).join(","), "selected-tier=" + tierPairs.map(o => `${o.site}:${o.tier}`).join(","),
  s["B-screen"], s["B-all-haiku"], s["B-all-mercury"], s["B-sink"], s["B-memo"]].join(";"));
' "$D/select-C.json" research/tierdown-20261021/PREREG-TIERDOWN.json "$D/eval-H.json") || exit 1
echo "$SPECS" | tr ';' '\n'
nice -n 15 node experiments/tierdown/inject.mjs --answers "$D/answers-H.jsonl,$D/answers-H-rule.jsonl" --leverage "$D/leverage.json" \
  --slice H --each --all-rows --assign "$SPECS" --runs "$RUNS" --concurrency "${CONCURRENCY:-2}" --out "${OUT:-$D/inject-H-v2.json}"
echo "inject H v2 exit $? at $(date -u +%FT%TZ)"
