# SW-1 working status (resume note for the next agent instance; container restarts kill agents)

Worktree: /home/user/workflow-foundry/.claude/worktrees/wf_0f86d12b-ab5-4, branch worktree-wf_0f86d12b-ab5-4.
node_modules is a symlink to the main tree (never commit it; git add explicit paths only).

Plan (attempt 3, started 2026-10-22 03:44Z; attempts 1-2 died at container restarts 03:11Z and 03:40Z):
1. [done] beds/golive (go-live intake: 4 channel nodes per task, 2 with a legacy backlog export); template test passes.
2. [done] experiments/subworkflow/{dsl,templates,bind}.mjs: subworkflow/1 DSL, 4 frontier-written templates, by-hash binding
   through experiments/jit/call-host.mjs (stub mode: depth, recursion, effects 'none', budget tree).
3. [ ] bed test + README; fix: first-row-wins control passes when the newest row comes first in the file.
4. [ ] arms: A0 node alone; A1 self-built sub-workflow (free-form subworkflow/1); A1T self-built from the template catalog
   in-node; A2 typed request -> governing builder (fresh Haiku, select -> fill -> practice -> repair <= 3). All Haiku 5.5.
5. [ ] $0 tests with scripted ports (authority: effect ops -> proposal never executed; depth; budget carving; fallback).
6. [ ] pilot on dev seeds (burned), then PREREG-SW-1.md frozen (sha256 of code + task list) BEFORE the eval run.
7. [ ] eval run on split 'test' seeds (held-out seeds of this dev bed; not sealed), cap Haiku $5 total incl. pilot.
8. [ ] RESULT-SW-1.md.

Run data: research/subworkflow-20261021/runs/<run-id>/ (journal.sqlite is resumable: same runId/nodeKey replays at $0).
