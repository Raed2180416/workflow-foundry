#!/bin/bash
# Finish the AM-9 date-note replication after the disk-full stop (12:25 UTC):
# 1. a1-dev60-dn: resume (the runner changed only in fault handling; accepted and recorded) with the cap raised to $5,
#    so its 2 ENOSPC tasks (kept aside as faults) and 1 cap-skipped task rerun.
# 2. The Sonnet pair, fresh (their first attempt failed at prepare: no temporary directory).
# Exit 3 (environment fault): wait 15 min and resume. Exit 4 (cap): stop and report.
cd /home/user/workflow-foundry
W=/var/tmp/foundry-work
C="--pool devTrain --subset 60 --seed 21 --date-note --resume"
run() {
  id=$1; shift
  for i in $(seq 1 16); do
    node experiments/autobench/run.mjs "$@" $C --run-id $id >> $W/$id.log 2>&1; rc=$?
    [ $rc -ne 3 ] && { echo "$id exit $rc $(date -u +%FT%TZ)" >> $W/launches.log; return $rc; }
    echo "$id: environment fault (exit 3), resume $i in 15 min $(date -u +%FT%TZ)" | tee -a $W/$id.log >> $W/launches.log
    sleep 900
  done
}
run a1-dev60-dn --model claude-haiku-5-5 --harness foundry --cap 5 --accept-runner-change
run a0s-dev60-dn --model claude-sonnet-5-5 --budget 1.5 --cap 14
run a1s-dev60-dn --model claude-sonnet-5-5 --harness foundry --budget 1.5 --cap 14
echo "chain2 done $(date -u +%FT%TZ)" >> $W/launches.log
