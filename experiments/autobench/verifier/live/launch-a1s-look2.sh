#!/bin/bash
# VL-1 step 1 (PAID, D27): the new fork, Sonnet 5.5 + the A1 prose harness on the 60 look-2 tasks, run id a1s-look2,
# cap $10 (PREREG-VL1 §3). Launch only after PREREG-VL1 is committed, detached from this file:
#   setsid nohup bash experiments/autobench/verifier/live/launch-a1s-look2.sh > /var/tmp/foundry-work/a1s-look2.chain.log 2>&1 &
# It runs from the a1c-v1 pin worktree (the runner, bridge and corpus pin of a0o-look2-1 and the A1-C v2 chain's v1, v1-M
# and A0 arms), at nice, concurrency 2 (room for the Opus run). Flags are the dev60 sonnet-a1 arm's (a1s-dev60-dn:
# --harness foundry --model claude-sonnet-5-5 --budget 1.5 --date-note, max-steps 50, timeout 20 min, det record, k 1)
# plus --tasks <look-2 list> and --cap 10; --concurrency 2 and --no-copy are new (VERIFIER-LAB.md §5 step 1).
# Before every start and resume it checks: the pin commit and a clean tree, the runner and bridge sha256, the look-2 file
# and list hashes, the CLI version (2.1.307), the A1 manifest hash recomputed in this environment, and >= 1.2 GB free.
# The dev-only split guard stays on (no --harness-hash: that flag would lift it); the manifest hash is checked here
# instead, before the start and again in launch.json after it.
# An environment fault (run.mjs exit 3) waits 30 min and resumes, at most 6 times; a fault is never scored (the runner
# keeps it out of results.jsonl). Exit 4 (the cap) stops: a higher cap needs a decision. Its log and results are NOT read
# before VL-1 step 5.
set -u
export DISABLE_AUTOUPDATER=1
unset FORCE_PROMPT_CACHING_5M CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC DISABLE_TELEMETRY DISABLE_ERROR_REPORTING
PIN=${VL1_PIN:-/home/user/workflow-foundry/.claude/worktrees/a1c-v1-pin}
LIVE=/var/tmp/foundry-work/autobench
RUN=a1s-look2
CAP=10
PIN_COMMIT=b1e16e030470c077b8c09bc3fdf06a32c2a26209
PIN_RUNNER=ea1dca70628a80262430b0d693d013fab456aebccefaac9e48db9713d4c87c5f
BRIDGE=285be4f5ba32f569c904897d512524535f6b50c11c05d54e419e5e272f97641a
LOOK2_FILE_SHA=85099131ad42ff27dd547c087797552fc424906093b5feb560ea5b81ebd2f567
LIST_SHA=a8c1ed5c8b18606c97feb7fcdd83115eab8cbdffa6e7956d9ee6d9d0974e916f
CLI='2.1.307 (Claude Code)'
A1HASH=93cbeb4b7d3164821c6a9db5b4ae865503e5dfd66187b873122c97cb4ef70a86
L2=$PIN/research/automationbench-20261014/LOOK2-TASKS.json
say() { echo "[a1s-look2 $(date -u +%FT%TZ)] $*"; }
fail() { say "STOP: $1"; exit "${2:-7}"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }

checks() {
  [ "$(git -C "$PIN" rev-parse HEAD)" = "$PIN_COMMIT" ] || fail "pin HEAD is not $PIN_COMMIT"
  [ -z "$(git -C "$PIN" status --porcelain --untracked-files=no)" ] || fail "pin has tracked changes"
  [ "$(sha "$PIN/experiments/autobench/run.mjs")" = "$PIN_RUNNER" ] || fail "runner sha differs"
  [ "$(sha "$PIN/experiments/autobench/bridge.py")" = "$BRIDGE" ] || fail "bridge sha differs"
  [ "$(sha "$L2")" = "$LOOK2_FILE_SHA" ] || fail "LOOK2-TASKS.json differs"
  node -e 'const c=require("crypto"),t=require(process.argv[1]).tasks; const h=c.createHash("sha256").update(JSON.stringify([...t].sort())).digest("hex"); if (h!==process.argv[2] || t.length!==60) { console.error("look-2 list hash", h); process.exit(1) }' "$L2" "$LIST_SHA" || fail "look-2 list hash differs"
  [ "$(claude --version 2>/dev/null | head -1)" = "$CLI" ] || fail "CLI is '$(claude --version 2>/dev/null | head -1)', not '$CLI'"
  [ "$(df --output=avail -k / | tail -1)" -ge 1258291 ] || fail "less than 1.2 GB free"
  local h
  h=$(cd "$PIN" && node --input-type=module -e '
    const f = await import("./experiments/autobench/harness/foundry.mjs");
    const cfg = f.harnessConfig({ model: "claude-sonnet-5-5", budgetUsd: 1.5, timeoutMin: 20, maxSteps: 50, cliMaxTurns: 49, tools: ["Bash"], det: "record", k: 1, concurrency: 2, dateNote: true, effort: undefined, cli: f.cliVersion() });
    process.stdout.write(f.harnessManifest(cfg).sha256);') || fail "manifest recompute failed"
  [ "$h" = "$A1HASH" ] || fail "A1 manifest hash $h is not the frozen $A1HASH"
}

[ -f "$LIVE/$RUN/summary.json" ] && { say "$RUN already finished"; exit 0; }
checks
HELD=$(node -e 'process.stdout.write(require(process.argv[1]).tasks.join(","))' "$L2")
resume=()
[ -f "$LIVE/$RUN/launch.json" ] && resume=(--resume)
tries=0
while :; do
  say "start ${resume[*]:-fresh} (CLI $(claude --version 2>/dev/null | cut -d' ' -f1))"
  (cd "$PIN" && nice node experiments/autobench/run.mjs --harness foundry --model claude-sonnet-5-5 --budget 1.5 --cap "$CAP" --date-note \
    --concurrency 2 --timeout-min 20 --max-steps 50 --det record --k 1 --no-copy --tasks "$HELD" --run-id "$RUN" "${resume[@]}" > "$LIVE/../$RUN.log" 2>&1)
  rc=$?
  echo "$RUN exit $rc (CLI $(claude --version 2>/dev/null | cut -d' ' -f1)) $(date -u +%FT%TZ)" >> "$LIVE/../launches.log"
  if [ -f "$LIVE/$RUN/launch.json" ]; then
    node -e 'const l=require(process.argv[1]); if (l.harness!==process.argv[2] || l.model!=="claude-sonnet-5-5") process.exit(1)' "$LIVE/$RUN/launch.json" "$A1HASH" || fail "launch.json does not carry the frozen A1 hash"
  fi
  [ $rc -eq 3 ] && [ $tries -lt 6 ] || break
  tries=$((tries + 1)); resume=(--resume); say "environment fault: waiting 30 min before resume $tries of 6"; sleep 1800; checks
done
say "$RUN exit $rc"
exit $rc
