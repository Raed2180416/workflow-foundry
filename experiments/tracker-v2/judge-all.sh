#!/bin/sh
# $0 judge steps (no model call): every BUILDER-1 bind file in turn, then the E8 bind file if present; then both scores.
#   sh experiments/tracker-v2/judge-all.sh [bind-file ...]   (default: every bind-*.json without a judge-*.json yet)
set -u
cd "$(dirname "$0")/../.." || exit 1
OUT=research/tracker-20261021/builder1
E8=research/tracker-20261021/e8
if [ "$#" -gt 0 ]; then FILES="$*"; else FILES=$(ls $OUT/bind-*.json 2>/dev/null); fi
for f in $FILES; do
  case "$f" in
    *e8/*) nice -n 15 node experiments/tracker-v2/run-e8.mjs judge --bind "$f" --out $E8 || echo "judge failed: $f" ;;
    *) j=$OUT/judge-$(basename "$f" .json | sed 's/^bind-//').json
       if [ -f "$j" ] && [ "$#" -eq 0 ]; then echo "skip $f (judged)"; continue; fi
       nice -n 15 node experiments/tracker-v2/run-builder1.mjs judge --bind "$f" --out $OUT || echo "judge failed: $f" ;;
  esac
done
echo "judge-all done"
