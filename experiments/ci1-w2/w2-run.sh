#!/bin/bash
# CI-1 wave 2 runs (research/ci1-20261021/w2/PREREG-CI1-W2.md §3, §6): the $0 controls, then every preregistered arm on the wave-2
# items, detached, with the environment-fault rule (run-detached-w2.sh). The runner refuses unless MANIFEST-W2.json matches.
#   bash experiments/ci1-w2/w2-run.sh   (logs under /var/tmp/foundry-work/ci1-20261021/logs/w2-*.log)
W="$(cd "$(dirname "$0")/../.." && pwd)"
L=/var/tmp/foundry-work/ci1-20261021/logs
mkdir -p "$L"
R="bash $W/experiments/ci1-w2/run-detached-w2.sh"
# controls against the frozen manifest ($0)
$R $L/w2-REF.log   --arm REF   --label w2-REF   --k 1 --concurrency 1
$R $L/w2-EMPTY.log --arm EMPTY --label w2-EMPTY --k 1 --concurrency 1
# primary arms (two at a time: the host is shared)
$R $L/w2-A0.log  --arm A0  --label w2-A0  --k 3 --concurrency 2 --cap-usd 1.0 &
$R $L/w2-A2.log  --arm A2  --label w2-A2  --k 3 --concurrency 2 --cap-usd 1.5 &
wait
$R $L/w2-A1c.log --arm A1c --label w2-A1c --k 3 --concurrency 2 --cap-usd 1.5 &
$R $L/w2-A0t.log --arm A0t --label w2-A0t --k 3 --concurrency 2 --cap-usd 1.0 &
wait
echo "DONE $(date -u +%FT%TZ)" >> $L/w2.done
