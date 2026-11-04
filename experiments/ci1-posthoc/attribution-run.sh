#!/bin/bash
# CI-1 leave-one-pattern-out attribution (PREREG-CI1.md §4, exploratory; RESULT-CI1.md §6 gives the deviations): A2 rebuilt with
# retrieved pattern cards removed, on the test items where A2 beats A1c under oracle v2 with the two ambiguous items dropped (v2x):
#   17878 (A2 3/3, A1c 0/3): each of its three cards removed in turn, and all three removed, K = 3
#   11679, 16904 (A2 3/3, A1c 2/3): all three cards removed, K = 3 (one-card removals cannot be told from noise at a 1-in-3 gap)
# Runs against the frozen manifest (run-arm.mjs refuses otherwise), detached, with the environment-fault rule. Builds are scored by
# the frozen oracle v1 inside run-arm.mjs; experiments/ci1-posthoc/rescore.mjs adds the v2 verdicts afterwards.
#   bash experiments/ci1-posthoc/attribution-run.sh   (logs under /var/tmp/foundry-work/ci1-20261021/logs/attr-*.log)
W="$(cd "$(dirname "$0")/../.." && pwd)"
L=/var/tmp/foundry-work/ci1-20261021/logs
mkdir -p "$L"
R="bash $W/experiments/ci1/run-detached.sh"
$R $L/attr-17878-noP42.log --arm A2 --label test-attr-17878-noP42 --split test --items 17878 --k 3 --concurrency 1 --cap-usd 0.2 --drop P42
$R $L/attr-17878-noP36.log --arm A2 --label test-attr-17878-noP36 --split test --items 17878 --k 3 --concurrency 1 --cap-usd 0.2 --drop P36
$R $L/attr-17878-noP08.log --arm A2 --label test-attr-17878-noP08 --split test --items 17878 --k 3 --concurrency 1 --cap-usd 0.2 --drop P08
$R $L/attr-17878-noCards.log --arm A2 --label test-attr-17878-noCards --split test --items 17878 --k 3 --concurrency 1 --cap-usd 0.2 --drop P42,P36,P08
$R $L/attr-11679-noCards.log --arm A2 --label test-attr-11679-noCards --split test --items 11679 --k 3 --concurrency 1 --cap-usd 0.2 --drop P42,P12,P02
$R $L/attr-16904-noCards.log --arm A2 --label test-attr-16904-noCards --split test --items 16904 --k 3 --concurrency 1 --cap-usd 0.2 --drop P37,P16,P42
echo "DONE $(date -u +%FT%TZ)" >> $L/attr.done
