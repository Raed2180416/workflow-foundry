#!/usr/bin/env bash
# Runs the daemon in the foreground, appending to ~/foundry-bridge/daemon.log, and restarts it
# after a crash. A clean stop (Ctrl-C, exit code 0) or a configuration error (exit code 2) ends the loop.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BASE="$HOME/foundry-bridge"
CONFIG="${FOUNDRY_BRIDGE_CONFIG:-$BASE/bridge-config.json}"
mkdir -p "$BASE"
while true; do
  node "$REPO/bridge/laptop/daemon.mjs" --config "$CONFIG" 2>&1 | (trap '' INT HUP; tee -a "$BASE/daemon.log")
  code=${PIPESTATUS[0]}
  [ "$code" -eq 0 ] && { echo "daemon stopped cleanly"; break; }
  # 2 = bad arguments or config (missing file, unknown key): restarting cannot fix it
  [ "$code" -eq 2 ] && { echo "$(date -Is) daemon refused its configuration (exit 2); not restarting. Fix $CONFIG and run start-tmux.sh again." | tee -a "$BASE/daemon.log"; break; }
  echo "$(date -Is) daemon exited with $code; restarting in 5 s" | tee -a "$BASE/daemon.log"
  sleep 5
done
