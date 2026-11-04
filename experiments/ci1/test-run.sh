#!/bin/bash
# CI-1 test runs (research/ci1-20261021/PREREG-CI1.md §3, §6): every preregistered arm on the 19 test items, detached, with the
# environment-fault rule (run-detached.sh). The runner refuses unless research/ci1-20261021/MANIFEST.json matches.
#   bash experiments/ci1/test-run.sh   (logs under /var/tmp/foundry-work/ci1-20261021/logs/test-*.log)
W="$(cd "$(dirname "$0")/../.." && pwd)"
L=/var/tmp/foundry-work/ci1-20261021/logs
mkdir -p "$L"
R="bash $W/experiments/ci1/run-detached.sh"
# primary arms first
$R $L/test-A0.log  --arm A0  --label test-A0  --split test --k 3 --concurrency 2 --cap-usd 2 &
$R $L/test-A1c.log --arm A1c --label test-A1c --split test --k 3 --concurrency 2 --cap-usd 3 &
$R $L/test-A2.log  --arm A2  --label test-A2  --split test --k 3 --concurrency 2 --cap-usd 3 &
wait
$R $L/test-A1.log  --arm A1  --label test-A1  --split test --k 3 --concurrency 2 --cap-usd 2 &
$R $L/test-A0t.log --arm A0t --label test-A0t --split test --k 3 --concurrency 2 --cap-usd 3 &
$R $L/test-A2M.log --arm A2-M --label test-A2M --split test --items 14177,17545,16364,17342,17878 --k 1 --concurrency 1 --token-cap 330000 &
wait
echo "DONE $(date -u +%FT%TZ)" >> $L/test.done
