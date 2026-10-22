# SW-1 working status (resume note for the next agent instance; container restarts kill agents)

Worktree: /home/user/workflow-foundry/.claude/worktrees/wf_0f86d12b-ab5-4, branch worktree-wf_0f86d12b-ab5-4.
node_modules is a symlink to the main tree (never commit it; git add explicit paths only). Model journals
(runs/*/journal.sqlite*) stay outside git (they can carry host account identity; .gitignore rule added).

Plan (attempt 4, resumed 2026-10-22 04:21Z; attempts 1-3 died at container restarts 03:11Z, 03:40Z, 04:17Z):
1. [done] beds/golive (go-live intake: 4 channel nodes per task, 2 with a legacy backlog export), d1-d5; bed test.
2. [done] experiments/subworkflow/{dsl,templates,bind}.mjs: subworkflow/1 DSL, 4 frontier-written templates, by-hash binding.
3. [done] bed test + README.
4. [done] arms A0, A1, A1T, A2 (node decides) and A1F, A1TF, A2F (parent directs a sub-workflow on legacy-export nodes).
5. [done] $0 node tests (authority, depth, budget carving, repair, fallback, pilot-3 root cause).
6. [done] pilots 1-4 on dev seeds 11-14 (d2-d5), $0.51 Haiku. pilot-4 (d5) finished before the 04:17Z restart.
7. [ ] DESIGN.md + PREREG-SW-1.md frozen (sha256 of code + task list) BEFORE the eval run.
8. [ ] eval run on split 'test' seeds (held-out seeds of this dev bed; not sealed), cap Haiku $5 total incl. pilots.
9. [ ] RESULT-SW-1.md.

Run data: research/subworkflow-20261021/runs/<run-id>/ (journal.sqlite is resumable: same runId/nodeKey replays at $0;
units already complete in results.jsonl are skipped). Spend check:
node -e over runs/*/journal.sqlite (SUM(cost_usd) FROM model_calls); run.mjs --cap-usd enforces it before each unit.
