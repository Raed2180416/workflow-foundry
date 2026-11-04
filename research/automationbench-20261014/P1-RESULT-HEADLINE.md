# P1 headline: A1-C v2 against plain Haiku on 60 held-out AutomationBench tasks (2026-11-04)

**Status: the preregistered confirmatory test is complete and independently re-checked (below), and the failure anatomy
is done (below, descriptive).** The A1-C v2 code and the full record (all six arms' repo copies, `analysis.json`,
`harm-v1-v2.json`) were merged into this branch on 2026-11-04 (`c195eee6`, from `287f57ff`); they sit under
`research/automationbench-20261014/runs/`. The freeze guards record the merge (`MANIFEST-ALLOWANCES.md`).

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
- It is not a tested comparison against a frontier agent. The reference arms (VL-1, `vl1/RESULT.md`, same 60 tasks) are
  reported beside it and never compared under the plan (§9.6): Opus 5.5 xhigh alone passed 26/60 at $0.3854 per task,
  and Sonnet 5.5 + A1 passed 27/60 at $0.1122. A1-C v2 passed 29/60 at $0.0294, 7.6% of Opus's cost per task. That is
  descriptive only: no test, one look, development evidence.
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

## Failure anatomy (descriptive, 2026-11-04, after the analysis; never a claim)

This uses the repo copies of every look-2 arm and VL-1's per-task pass vectors (`runs/vl1-look2/pass-vectors.json`). It
reads only grade summaries: pass flags, assertion types and counts, and v2's own termination category. It reads no task
text and no transcripts. Reproduce with `node experiments/autobench/replay/p1-anatomy.mjs` (`--json` for the record).

**Where v2's 31 failures ended.** v2 is single-pass by design, so its checker's verdict is the end of a run.

| v2's own verdict at the end | Failures | Solved by any other arm | Opus 5.5 xhigh | Sonnet + A1 | v1 | v1-M | v2-M | A0 |
|---|---|---|---|---|---|---|---|---|
| all-pass (every check of v2's passed; the grader failed it) | 12 | 7 | 3 | 4 | 0 | 6 | 6 | 0 |
| hard-fail (a hard check failed) | 7 | 3 | 1 | 0 | 1 | 1 | 0 | 0 |
| hard-undecided | 6 | 2 | 0 | 2 | 0 | 1 | 0 | 0 |
| advisory-fail | 6 | 2 | 1 | 1 | 0 | 1 | 0 | 1 |
| **total** | **31** | **14** | 5 | 7 | 1 | 9 | 6 | 1 |

- **Hard tasks:** 17 of v2's 31 failures were failed by every arm, Opus 5.5 xhigh and Sonnet + A1 included. Only 43 of
  the 60 tasks were solved by any arm. The ceiling for anything that selects among these arms on look 2 is 43; VL-1's
  P2 oracle is 37.
- **The checker knew in 19 of 31 cases** (hard-fail, hard-undecided, advisory-fail). Its verdict was right, but v2 has no
  second pass. Other arms solved only 7 of those 19, and VL-1's repair step fixed 0 and broke 2 of its 17. A repair
  round is therefore not free: it would have to pass a commit gate (ATTACK Move 1, Δ*) before it counts.
- **Silent failures, 12 of 31** (v2's checks all passed; the grader did not). By assertion kind:
  - content only (a body that must contain something): 4;
  - forbidden effects only (a message or record that must not exist): 4;
  - mixed: 4.

  These are misses in requirement extraction: the ledger never stated the requirement, so no check tested it. v2-M, the
  same harness with Mercury as ledger reader and checker, solved 6 of the 12. That points to variance between readers
  rather than a fixed blind spot, so a union of two readers' ledgers (N-version) is the cheapest candidate fix. It is a
  hypothesis for a fresh, preregistered look, not a finding.
- **Near misses:** 10 failures miss exactly one assertion, and 13 have partial credit of at least 0.8. Mean partial
  credit over the 31 failures is 0.633.
- **By domain:** hr 7, marketing 6, operations 5, sales 5, support 5, finance 3.
- **Assertion types in failures:** communication effects dominate. `gmail_message_sent_to_with_body_contains` appears in
  9 failures; Slack messages that must exist, or be in a given channel, in 9; an assertion that something must not be
  sent, posted or created in 11.
