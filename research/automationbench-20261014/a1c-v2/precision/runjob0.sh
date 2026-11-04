#!/bin/sh
T=$1; C=$2
S=/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/a1cv2
cd /tmp && timeout 900 /home/user/workflow-foundry/corpus/AutomationBench/.venv/bin/python -I $S/bin/playback.py /home/user/workflow-foundry/experiments/autobench/bridge.py /var/tmp/foundry-work/autobench/a1c-dev60-dn/prep/$T/input.json /var/tmp/foundry-work/autobench/a1c-dev60-dn/host/$T/fork-0 $S/replay0/$T.json $C > $S/replay0/$T.log 2>&1
echo "$T $?"
