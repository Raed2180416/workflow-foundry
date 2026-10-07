#!/usr/bin/env bash
# Starts the bridge daemon and the Cloudflare quick tunnel in a detached tmux session named
# foundry-bridge (windows: daemon, tunnel; each restarts its process after a crash). Safe to
# run twice. Attach with: tmux attach -t foundry-bridge   Stop with: bash bridge/laptop/run/stop.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${FOUNDRY_BRIDGE_CONFIG:-$HOME/foundry-bridge/bridge-config.json}"
command -v node >/dev/null || { echo "node is not on PATH" >&2; exit 1; }
command -v cloudflared >/dev/null || { echo "cloudflared is not on PATH" >&2; exit 1; }
[ -f "$CONFIG" ] || { echo "missing $CONFIG (copy bridge/laptop/bridge-config.example.json)" >&2; exit 1; }
if tmux has-session -t foundry-bridge 2>/dev/null; then echo "tmux session foundry-bridge is already running"; exit 0; fi
tmux new-session -d -s foundry-bridge -n daemon "bash '$HERE/daemon-loop.sh'"
tmux new-window -t foundry-bridge -n tunnel "bash '$HERE/tunnel-loop.sh'"
echo "started tmux session foundry-bridge. Logs: ~/foundry-bridge/daemon.log and ~/foundry-bridge/cloudflared.log"
