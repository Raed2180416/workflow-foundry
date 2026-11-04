#!/usr/bin/env bash
# H-slice paid passes (AMENDMENT-1 §4-5), in priority order, after the C selection was frozen. The Mercury share of the
# item token cap for H is 225,000 (the ledger counts C and H together against 450,000).
set -u
cd "$(dirname "$0")/../.."
D=research/tierdown-20261021/data
J="${TIERDOWN_JOURNAL_DIR:-/tmp}/journal-H.sqlite"
export MERCURY_TOKENS=450000
pass() { SITES="$1" bash experiments/tierdown/run-paid.sh H "$2" "$D/answers-H.jsonl" "$D/leverage.json" "$D/answers-C.jsonl" "$J"; echo "pass [$1] [$2] exit $?"; }
pass records/void-values,records/date-order,records/vendex-entries mercury-3,memo
pass records/rules,records/source-rules,kinetics/well-events,kinetics/prose-events-a,kinetics/extract:* claude-haiku-5-5,memo
pass records/country-names,records/countries mercury-3,memo
pass records/rules,kinetics/well-events,records/source-rules mercury-3
echo "H passes done at $(date -u +%FT%TZ)"
