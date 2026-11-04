#!/usr/bin/env bash
# C-slice paid passes in priority order (AMENDMENT-1 clarification 4; RESULT-TIERDOWN.md §0 R7): the Mercury share of
# the item token cap (225,000 of 450,000 for C) goes first to the Opus reader and the small Haiku sites; records/source-rules
# gets no more Mercury calls (its C usable rate can no longer reach the preregistered 0.95: 2 of its first 5 recorded
# answers were truncated at ~24K output tokens), and kinetics/well-events and records/vendex-entries get what is left.
# Review 2026-11-04 #7/#16: this script was written after an earlier, interrupted C pass (answers-C.jsonl lines 1-79: 31
# Haiku answers, $0.171923, and 12 Mercury answers, 111,092 tokens) that left no ledger line; its reconstruction is in
# data/answers-C.runs.reconstructed.jsonl. It cited "§Deviations D3", which does not exist, and "first 6 answers" where
# 5 are recorded.
set -u
cd "$(dirname "$0")/../.."
D=research/tierdown-20261021/data
J="${TIERDOWN_JOURNAL_DIR:-/tmp}/journal-C.sqlite"
export MERCURY_TOKENS=225000
SITES=records/rules,records/date-order,records/void-values,records/countries,records/country-names,kinetics/prose-events-a,kinetics/extract:* \
  bash experiments/tierdown/run-paid.sh C claude-haiku-5-5,mercury-3,memo "$D/answers-C.jsonl" "$D/leverage.json" "$D/answers-H.jsonl" "$J" || exit $?
SITES=records/source-rules bash experiments/tierdown/run-paid.sh C claude-haiku-5-5,memo "$D/answers-C.jsonl" "$D/leverage.json" "$D/answers-H.jsonl" "$J" || exit $?
SITES=kinetics/well-events,records/vendex-entries bash experiments/tierdown/run-paid.sh C claude-haiku-5-5,mercury-3,memo "$D/answers-C.jsonl" "$D/leverage.json" "$D/answers-H.jsonl" "$J"
echo "C passes done at $(date -u +%FT%TZ)"
