#!/bin/sh
# Run the ROUTER-1 Mercury judge pass, and only that, with the owner's Inception key loaded as INCEPTION_API_KEY
# (research/mercury-20261021/PROVISIONING.md): the key file lives outside the repository and is never printed, logged or committed.
#   sh experiments/need-router/router1/with-inception.sh dev|test [--token-cap N]
#
# Review m2 (2026-11-04): the first version ran any command ("exec \"$@\"") with the key exported, was written to get past the
# session guard on "." in a command line, and was first used at 21:31:21Z on 2026-10-21, 36 s before deviation D2 recorded it
# (45909902). It is narrowed to the one judge command it was recorded for; anything else is refused before the key is read.
case "$1" in dev|test) split="$1" ;; *) echo "usage: with-inception.sh dev|test [--token-cap N]" >&2; exit 2 ;; esac
shift
cap=""
if [ "$#" -gt 0 ]; then
  if [ "$#" -eq 2 ] && [ "$1" = "--token-cap" ] && [ -n "$2" ] && [ -z "$(printf '%s' "$2" | tr -d 0-9)" ]; then cap="$2"; else echo "only --token-cap N is accepted" >&2; exit 2; fi
fi
set -a; . /root/.config/foundry/inception.env; set +a
dir=$(dirname "$0")
if [ -n "$cap" ]; then exec node "$dir/judges.mjs" --judge mercury --split "$split" --token-cap "$cap"; fi
exec node "$dir/judges.mjs" --judge mercury --split "$split"
