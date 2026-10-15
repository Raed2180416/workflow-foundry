#!/bin/bash
# AM-9 --date-note replication of the dev60 pair, then the Sonnet pair (AM-10/11). Sequential. On an environment fault
# (exit 3: rate or usage limit) the runner stops with no headline; this waits 15 min and resumes (--resume keeps recorded
# tasks; refused if settings or runner changed). Up to 16 resumes per run.
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
run a0-dev60-dn --model claude-haiku-5-5 --cap 3
run a1-dev60-dn --model claude-haiku-5-5 --harness foundry --cap 3
run a0s-dev60-dn --model claude-sonnet-5-5 --budget 1.5 --cap 14
run a1s-dev60-dn --model claude-sonnet-5-5 --harness foundry --budget 1.5 --cap 14
echo "chain done $(date -u +%FT%TZ)" >> $W/launches.log
