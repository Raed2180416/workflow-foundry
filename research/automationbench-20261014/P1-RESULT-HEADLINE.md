# P1 headline: A1-C v2 against plain Haiku on 60 held-out AutomationBench tasks (2026-11-04)

**Status: the preregistered confirmatory test is complete and independently re-checked (below). The failure anatomy is
pending** (PREREG-A1CV2-P1 §13). The full record lives on branch `worktree-wf_3674d3bc-0a7-12` at `287f57ff`, bundled on this
branch as `research/session-20261028-rescue/incr-20261104-p1-result.bundle`. It holds all six arms' repo copies,
`analysis.json` and `harm-v1-v2.json` under `research/automationbench-20261014/runs/`.

- **Design:** look 2 of the frozen SEQUENTIAL-PLAN-v1 (plan `3cd586bd…`), 60 tasks unseen by every arm's builders.
  Haiku 5.5 throughout, through the Claude CLI pinned by bytes at 2.1.312 (amendment A2). The comparison is A1-C v2, the
  code-owned Foundry harness, against A0, the same model as a plain agent. D23's fixed sequence applies: strict pass is
  tested first with its own O'Brien–Fleming boundary.

**Confirmatory (A1-C v2 vs A0)**

| | A1-C v2 | A0 (plain Haiku) | difference |
|---|---|---|---|
| Strict pass | **29/60 (48.3%)** [36.2, 60.7] | 9/60 (15.0%) [8.1, 26.1] | **+33.3 points**; discordant 21 vs 1; exact p = 1.1e-5 (boundary 0.018); Bayes 95% [+18.7, +44.3] |
| Partial credit | **0.811** | 0.556 | **+0.255**; p ≈ 1e-5; Bayes 95% [+0.176, +0.344] |
| Cost per task | $0.0294 | $0.0127 | 2.3× |

Both hypotheses are rejected in the treatment's favour, and the harm check found no harm. The T3 A/A check, A0
against a second A0 run, gave 8 vs 9 (p = 1), so run-to-run noise is small.

**Descriptive (not confirmatory)**
- **v2 vs v1:** 29 vs 19 (p = 0.006).
- **v1 vs A0:** 19 vs 9 (p = 0.031).
- **Mercury as ledger and checker:** v1-M 29/60 at $0.0162 per task, v2-M 27/60 at $0.0109 per task. Their Mercury
  tokens are priced at the allowance's $0, so their real cost is higher than shown.
- **Exposure:** a sensitivity run without the 6 exposed tasks (n = 54) keeps every direction.

**What this does and does not show.**
- It does show that, on unseen tasks from one benchmark, a cheap model inside Foundry's code-owned harness passes three
  times as many tasks as the same model working alone, at 2.3× its cost.
- It is not a comparison against a frontier agent. The Opus 5.5 xhigh and Sonnet + A1 reference arms are VL-1's, still to run.
- It is one benchmark (breadth is the open claim). The arms are not cost-matched (A0 spent less).

## Independent re-check (2026-11-04 ~19:40Z, orchestrator, from the raw rows, not from analysis.json)
- **Recomputed from each arm's `results.jsonl`, fault rows excluded.** Strict pass: A0 9, A0-AA 8, v1 19, v2 29, v1-M 29, v2-M 27. Partial credit: 0.556,
  0.565, 0.728, 0.811, 0.812, 0.775. Exact McNemar tests:
  - v2 vs A0: 21 vs 1, p = 1.10e-5;
  - v2 vs v1: 11 vs 1, p = 6.35e-3;
  - A0 vs A0-AA: 3 vs 2, p = 1.0;
  - v2-M vs A0: 22 vs 4, p = 5.34e-4.
  Every number equals `analysis.json`.
- **Integrity.**
  - Every arm ran exactly the 60 tasks of LOOK2-TASKS.json (sha256 `85099131…`, the frozen file).
  - The four harness arms carry exactly their frozen harness hashes: v1 `e2f1f491`, v2 `12bb43cf`, v1-M `fff2886f`,
    v2-M `cc16ed23`.
  - Every arm records CLI 2.1.312.
