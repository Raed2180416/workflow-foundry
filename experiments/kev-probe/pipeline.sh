#!/bin/sh
# Kev probe pipeline (sequential: Kev serves one request at a time on CPU). Latency first, alone.
set -e
cd "$(dirname "$0")/../.."
node experiments/kev-probe/latency.mjs
node experiments/kev-probe/run.mjs kev-cal failure-class injection records-pair synth-claim incident-class incident-root codefix-fn applicability
node experiments/kev-probe/run.mjs freeze
node experiments/kev-probe/run.mjs kev-eval failure-class injection records-pair synth-claim incident-class incident-root codefix-fn applicability
node experiments/kev-probe/run.mjs permute incident-class failure-class codefix-fn records-pair
