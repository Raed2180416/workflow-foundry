#!/bin/sh
# Kev probe pipeline. Kev serves one request at a time on CPU, so Kev stages run sequentially.
# KEV_PROBE_URL selects the server (default here: the probe's 2-thread instance on :8009, see threads-ab.mjs).
set -e
cd "$(dirname "$0")/../.."
export KEV_PROBE_URL="${KEV_PROBE_URL:-http://127.0.0.1:8009}"
DS="failure-class injection records-pair synth-claim incident-class incident-root codefix-fn applicability"
node experiments/kev-probe/latency.mjs                       # step 0, alone
node experiments/kev-probe/run.mjs model $DS > experiments/runs/kev-probe/model.log 2>&1 &   # hosted arm alongside calibration
MODEL=$!
node experiments/kev-probe/run.mjs kev-cal $DS
wait $MODEL || true
node experiments/kev-probe/run.mjs freeze
node experiments/kev-probe/run.mjs kev-eval $DS              # evaluation half, alone (per-decision latency)
node experiments/kev-probe/run.mjs permute incident-class failure-class codefix-fn records-pair
node experiments/kev-probe/analyze.mjs
