#!/usr/bin/env bash
# Runs a Cloudflare quick tunnel to the daemon and restarts it if it exits. Every restart gets a
# new https://<random>.trycloudflare.com URL; the daemon notices and republishes it.
BASE="$HOME/foundry-bridge"
mkdir -p "$BASE"
while true; do
  cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8765 --metrics 127.0.0.1:20241 --logfile "$BASE/cloudflared.log" --loglevel info ${FOUNDRY_TUNNEL_EXTRA:-}
  echo "$(date -Is) cloudflared exited with $?; restarting in 10 s"
  sleep 10
done
