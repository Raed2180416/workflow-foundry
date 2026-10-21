#!/bin/sh
# Run one command with the owner's Inception key loaded as INCEPTION_API_KEY (research/mercury-20261021/PROVISIONING.md):
# the key file lives outside the repository and is never printed, logged or committed. Used for the ROUTER-1 Mercury judge:
#   sh experiments/need-router/router1/with-inception.sh node experiments/need-router/router1/judges.mjs --judge mercury --split dev
set -a; . /root/.config/foundry/inception.env; set +a
exec "$@"
