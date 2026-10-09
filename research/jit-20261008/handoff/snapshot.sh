#!/bin/bash
# Handoff snapshot (cloud session -> laptop agent): copies gitignored run data and every workflow's results so far into
# research/jit-20261008/handoff/, then commits and pushes the whole working tree. No model calls. Safe to re-run.
set -u
cd /home/user/workflow-foundry || exit 1
H=research/jit-20261008/handoff
WF=/root/.claude/projects/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a
mkdir -p "$H/runs" "$H/workflows"
# 1. Stream run data (experiments/runs is gitignored): everything except SQLite journals and big scratch.
rsync -a --delete --exclude 'journal.sqlite*' --exclude 'tierdown.journal.sqlite*' --exclude '*.lock' experiments/runs/jit/ "$H/runs/jit/" 2>/dev/null
# 2. Model-call journals, compressed (they make replay and tier-down possible at $0).
tar -czf "$H/runs/journals.tgz" $(find experiments/runs/jit -name 'journal.sqlite*' 2>/dev/null) 2>/dev/null
# 3. Every workflow run of this session: script + each finished agent's returned result (partial runs included).
for d in "$WF"/subagents/workflows/wf_*; do
  [ -f "$d/journal.jsonl" ] || continue
  id=$(basename "$d")
  meta="$WF/workflows/$id.json"
  node -e '
    const fs = require("fs"); const [jf, mf, out] = process.argv.slice(1);
    const lines = fs.readFileSync(jf, "utf8").trim().split("\n").map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(mf, "utf8")); } catch {}
    const results = lines.filter(j => j.type === "result");
    const txt = v => typeof v === "string" ? v : JSON.stringify(v, null, 1);
    const parts = [`# Workflow ${meta.workflowName ?? ""} (${require("path").basename(require("path").dirname(jf))})`, "",
      `status: ${meta.status ?? "running (no final record yet)"}; finished agents: ${results.length}`, "",
      "## Script", "", "```js", meta.script ?? "(script not recorded)", "```", ""];
    results.forEach((r, i) => parts.push(`## Agent result ${i + 1}${r.label ? ` (${r.label})` : ""}`, "", txt(r.result), ""));
    fs.writeFileSync(out, parts.join("\n"));
  ' "$d/journal.jsonl" "$meta" "$H/workflows/$id.md" 2>/dev/null
done
# 4. Commit and push everything.
git add -A experiments research tools src bin tests docs README.md AGENTS.md .gitignore 2>/dev/null
git add -u 2>/dev/null
git commit -q -m "Handoff snapshot $(date -u +%Y-%m-%dT%H:%MZ): run data, journals, workflow results so far, WIP from running agents (unreviewed)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011geBy7JvDqKuqhDyfmzd1U" 2>/dev/null
for i in 1 2 3 4; do git push -q origin claude/intelligent-hamilton-vg1f9a 2>/dev/null && break; sleep $((2**i)); done
echo "snapshot $(date -u +%T) $(git log --oneline -1)"
