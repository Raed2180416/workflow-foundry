#!/usr/bin/env bash
# Stops the bridge (tmux session and/or systemd user services). The daemon cancels its jobs,
# stops its services and publishes state=stopped before it exits.
set -uo pipefail
if tmux has-session -t foundry-bridge 2>/dev/null; then
  tmux send-keys -t foundry-bridge:daemon C-c
  for _ in $(seq 1 45); do pgrep -f 'bridge/laptop/daemon.mjs' >/dev/null || break; sleep 1; done
  tmux kill-session -t foundry-bridge && echo "tmux session foundry-bridge stopped"
fi
if command -v systemctl >/dev/null && systemctl --user is-active --quiet foundry-bridge.service 2>/dev/null; then
  systemctl --user stop foundry-tunnel.service foundry-bridge.service && echo "systemd user services stopped"
fi
pgrep -fa 'bridge/laptop/daemon.mjs|cloudflared tunnel' || echo "no bridge processes left"
