#!/bin/sh
# Held-out requests (PREREG-TRACKER-H §2): one Mercury 3 call, token cap 40,000. The key is read only into this command's environment
# and never printed. Run detached:
#   setsid nohup sh experiments/tracker-v2/heldout/paid-author.sh > /var/tmp/foundry-work/tracker-v2/heldout-author.log 2>&1 &
set -u
cd "$(dirname "$0")/../../.." || exit 1
echo "$(date -u +%FT%TZ) author start"
( set -a; . /root/.config/foundry/inception.env; set +a; nice -n 15 node experiments/tracker-v2/heldout/author.mjs --per 2 --token-cap 40000 )
echo "$(date -u +%FT%TZ) author done (rc $?)"
