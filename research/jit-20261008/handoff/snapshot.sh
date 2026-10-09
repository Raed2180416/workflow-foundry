#!/bin/bash
# Snapshot of stream run data into git (BLOCKER-SYNTHESIS S0-1). No model calls. Safe to re-run.
#   research/jit-20261008/handoff/snapshot.sh [config.json ...]     (default: experiments/jit/configs/*.json)
# 1. Exports every config's run directory as text (experiments/jit/resume-streams.mjs --export-only --commit:
#    results, events, faults, journal.jsonl from journal.sqlite, solvers, traces, regressions, MANIFEST.json with a
#    sha256 per file) and mirrors it into the committed directory (persist.commitDir, default
#    research/jit-20261008/runs/<experiment>/). No tarballs and no SQLite go into git.
# 2. Optionally (SNAPSHOT_WORKFLOWS_DIR set) renders each workflow run's script and finished agent results.
# 3. Commits exactly those paths, checks with `git ls-files --error-unmatch` that every mirrored file is tracked, pushes
#    (unless SNAPSHOT_NO_PUSH=1) and checks that the pushed branch holds every MANIFEST.json.
# Every failure stops the script with a non-zero status: nothing here discards errors.
set -euo pipefail
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$ROOT"
BRANCH=${SNAPSHOT_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
[ "$BRANCH" != main ] && [ "$BRANCH" != HEAD ] || { echo "snapshot: refusing to commit and push on '$BRANCH' (use the work branch)" >&2; exit 1; }
H=research/jit-20261008/handoff

if [ "$#" -gt 0 ]; then configs=("$@"); else configs=(experiments/jit/configs/*.json); fi

# 1. Export and mirror. stdout: one mirrored directory per line; the progress lines go to stderr.
out=$(node experiments/jit/resume-streams.mjs --export-only --commit "${configs[@]}")
dirs=()
if [ -n "$out" ]; then mapfile -t dirs <<< "$out"; fi
paths=("${dirs[@]}")

# 2. Workflow runs (the cloud session kept them under ~/.claude/projects/<project>/<session>/).
if [ -n "${SNAPSHOT_WORKFLOWS_DIR:-}" ]; then
  WF=$SNAPSHOT_WORKFLOWS_DIR
  [ -d "$WF/subagents/workflows" ] || { echo "snapshot: $WF/subagents/workflows does not exist" >&2; exit 1; }
  mkdir -p "$H/workflows"
  for d in "$WF"/subagents/workflows/wf_*; do
    [ -f "$d/journal.jsonl" ] || continue
    id=$(basename "$d")
    node -e '
      const fs = require("fs"); const [jf, mf, out] = process.argv.slice(1);
      const lines = fs.readFileSync(jf, "utf8").trim().split("\n").map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      let meta = {}; if (fs.existsSync(mf)) meta = JSON.parse(fs.readFileSync(mf, "utf8"));
      const results = lines.filter(j => j.type === "result");
      const txt = v => typeof v === "string" ? v : JSON.stringify(v, null, 1);
      const parts = [`# Workflow ${meta.workflowName ?? ""} (${require("path").basename(require("path").dirname(jf))})`, "",
        `status: ${meta.status ?? "running (no final record yet)"}; finished agents: ${results.length}`, "",
        "## Script", "", "```js", meta.script ?? "(script not recorded)", "```", ""];
      results.forEach((r, i) => parts.push(`## Agent result ${i + 1}${r.label ? ` (${r.label})` : ""}`, "", txt(r.result), ""));
      fs.writeFileSync(out, parts.join("\n"));
    ' "$d/journal.jsonl" "$WF/workflows/$id.json" "$H/workflows/$id.md"
  done
  paths+=("$H/workflows")
fi

if [ "${#paths[@]}" -eq 0 ]; then echo "snapshot: no run data to commit"; exit 0; fi

# 3. Commit exactly these paths (never `git add -A`), then verify that git tracks every mirrored file.
git add -- "${paths[@]}"
if git diff --cached --quiet -- "${paths[@]}"; then
  echo "snapshot: nothing changed since the last snapshot"
else
  git commit -q -m "Run-data snapshot $(date -u +%Y-%m-%dT%H:%MZ): text export (JSONL journals, solvers, sha256 manifests)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- "${paths[@]}"
fi
for d in "${dirs[@]}"; do
  git ls-files --error-unmatch "$d/MANIFEST.json" > /dev/null
  node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1] + "/MANIFEST.json", "utf8"));
    for (const [rel, f] of Object.entries(m.files)) if (!f.local) console.log(process.argv[1] + "/" + rel);
  ' "$d" | while IFS= read -r f; do git ls-files --error-unmatch "$f" > /dev/null; done
done

# 4. Push, then check that the remote branch has every manifest.
if [ "${SNAPSHOT_NO_PUSH:-0}" = 1 ]; then echo "snapshot $(date -u +%T) $(git log --oneline -1) (not pushed: SNAPSHOT_NO_PUSH=1)"; exit 0; fi
pushed=0
for i in 1 2 3 4; do
  if git push -q origin "$BRANCH"; then pushed=1; break; fi
  echo "snapshot: push attempt $i failed; retrying" >&2
  sleep $((2 ** i))
done
[ "$pushed" = 1 ] || { echo "snapshot: push to origin/$BRANCH failed" >&2; exit 1; }
git fetch -q origin "$BRANCH"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ] || { echo "snapshot: origin/$BRANCH is not at HEAD after the push" >&2; exit 1; }
for d in "${dirs[@]}"; do git cat-file -e "origin/$BRANCH:$d/MANIFEST.json"; done
echo "snapshot $(date -u +%T) $(git log --oneline -1) pushed and verified"
