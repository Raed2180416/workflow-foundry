# SW-1 working status (resume note for the next agent instance; container restarts kill agents)

Worktree: /home/user/workflow-foundry/.claude/worktrees/wf_0f86d12b-ab5-4, branch worktree-wf_0f86d12b-ab5-4.
node_modules is a symlink to the main tree (never commit it; git add explicit paths only). Model journals
(runs/*/journal.sqlite*) stay outside git (they can carry host account identity; .gitignore rule added).

Plan (attempt 5, resumed 2026-10-28 17:50Z):
1-7. [done] bed, DSL, templates, binding, arms, $0 tests, pilots 1-4, DESIGN + PREREG-SW-1 frozen (commit 7b1d45d8).
8. eval-1. Launch 1 (2026-10-22 04:31Z): 112 of 120 units ended env-fault MODEL_RATE_LIMIT (the subscription session
   limit, "You've hit your session limit"); 8 complete. Launch 2 (2026-10-28 17:54Z, the same PREREG command, frozen
   code hashes re-verified, log runs/eval-1/run-2.log, launch-1.json keeps the first launch record): [running].
   To resume after a restart: re-run the PREREG §Protocol command (complete units skip; finished calls replay at $0).
9. Post hoc tools ($0, committed): envaudit.mjs (env faults hidden inside sub-workflows), failures.mjs, posthoc.mjs
   (decisions, simple-node efficiency, anatomy, cache-neutral cost), judge-audit.mjs, vote-counterfactual.mjs.
10. SW-1b (template-miss probe, exploratory): beds/golive/layouts.mjs + test (committed), prompts-open.mjs,
    manifest-sw1b.mjs, analyze-sw1b.mjs, tasks-sw1b.json, test/node-open.test.mjs. The node.mjs / run.mjs changes
    (route 'governing-open', arms A2O / A2OF; --layout) are held in sw1b-pending.patch and applied only AFTER eval-1
    finishes (a restart must not resume eval-1 on changed code). Then: tests, PREREG-SW-1b freeze, run, analysis.
11. [ ] RESULT-SW-1.md.

Spend check: node -e over runs/*/journal.sqlite (SUM(cost_usd) FROM model_calls); run.mjs --cap-usd enforces it before
each unit. Owner cap: Haiku $5 for SW-1 + SW-1b together.
