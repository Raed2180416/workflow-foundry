#!/bin/sh
# Resume of the PREREG-TRACKER paid steps after the 2026-10-21 23:29Z / 23:31Z rate limits (environment faults, not scored) and the
# container restart that ended the waiting scripts. Runs the two parts one after the other (one call stream at a time on this shared
# machine); each step skips what its output file already holds, so nothing paid is repeated.
#   setsid nohup sh experiments/tracker-v2/paid-resume.sh > /var/tmp/foundry-work/tracker-v2/paid-resume.log 2>&1 &
set -u
cd "$(dirname "$0")/../.." || exit 1
echo "$(date -u +%FT%TZ) resume: e8 part"
sh experiments/tracker-v2/paid.sh e8 || echo "$(date -u +%FT%TZ) e8 part stopped (rc $?)"
echo "$(date -u +%FT%TZ) resume: builder1 part"
sh experiments/tracker-v2/paid.sh builder1 || echo "$(date -u +%FT%TZ) builder1 part stopped (rc $?)"
echo "$(date -u +%FT%TZ) resume done"
