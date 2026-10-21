#!/bin/bash
cd /home/user/workflow-foundry
W=/var/tmp/foundry-work
set -a; . /root/.config/foundry/inception.env; set +a
node experiments/autobench/run.mjs --model claude-haiku-5-5 --harness codeowned --node-models ledger=mercury-3,checker=mercury-3 --tasks <the 22 unfinished tasks of m3-a1c-dev60-dn> --date-note --budget 0.75 --cap 3 --token-cap 2300000 --session-tokens 300000 --concurrency 2 --run-id m3-a1c-dev60-dn-fill >> $W/m3-a1c-dev60-dn-fill.log 2>&1
echo "m3-a1c-dev60-dn-fill exit $? $(date -u +%FT%TZ)" >> $W/launches.log
