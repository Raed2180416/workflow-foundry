# Mercury as planner and checker inside A1-C, Haiku acting: partial dev60 (2026-10-21)

**Run.** `m3-a1c-dev60-dn`: `run.mjs --harness codeowned --model claude-haiku-5-5 --node-models
ledger=mercury-3,checker=mercury-3`, the same 60 devTrain tasks (seed 21), date note, $0.75 per session, `--token-cap
3000000 --session-tokens 300000`, concurrency 2, CLI 2.1.306, a1c-v1 harness (manifest ef5c3382: the Mercury entries
pinned). **Stopped at the token cap after 38 of 60 tasks** (2,709,413 Mercury tokens; about 71K per task against the
42K estimate). Not resumed: finishing would push total Mercury use past decision D8's 5M ceiling (about 4.2M used).

**Results on the 38 tasks it finished, paired with every other arm on the same 38 tasks** (exact McNemar):

| Arm on the same 38 tasks | Strict pass | Partial credit | Only Mercury-planner passes | Only the other passes | p |
|---|---|---|---|---|---|
| **Haiku acting + Mercury ledger/checker (A1-C)** | **15** | **0.760** | | | |
| Haiku alone (A0, CLI 2.1.306) | 5 | 0.541 | 12 | 2 | 0.013 |
| Haiku in every role (A1-C) | 9 | 0.759 | 8 | 2 | 0.109 |
| Sonnet alone (A0) | 12 | 0.689 | 8 | 5 | 0.58 |
| Sonnet + A1 prose harness | 15 | 0.767 | 5 | 5 | 1.00 |

**Cost.** Haiku $0.71 for 38 tasks ($0.019 per task). Mercury tokens about 71K per task: at the documented list prices
(about $0.10 to $0.35 per M; the policy row shows $0) that is at most about $0.025 per task. Total at most about $0.045 per
task, against Sonnet + A1's $0.115 per task on dev60.

**Reading (development evidence; in-sample harness; k = 1; 38 of 60 tasks in run order).**
- On these 38 tasks, a cheap acting model with a different-family cheap planner/checker **ties the frontier model with
  the harness**, and beats Sonnet alone and Haiku-only A1-C.
- **Why it might work:** the planner and checker are clean-context single calls, so model diversity (another family)
  may decorrelate the ledger and check errors that the A1-C anatomy found (16 false accepts, 10 false rejects with Haiku
  checking Haiku). This is a hypothesis, not shown.
- **Not shown:** the 22 unfinished tasks; out-of-sample behaviour (devCheck); run-to-run variance (10–15% of tasks flip
  between identical runs); whether Sonnet as the planner/checker would do the same (the 2-task smoke did not help, but
  n = 2).

**Next.**
1. The owner's remaining Mercury allowance decides whether to finish the 22 tasks (about 1.6M tokens) and run devCheck
   (about 4.3M).
2. The loop guard and masking from FIXES A2/A1 cut Mercury's tokens per task.
3. A paired arm with Sonnet as planner/checker and Haiku acting on the same tasks separates "different family" from
   "stronger model".

## Completion as a fill run (2026-10-21 ~18:50Z)

D18 raised the Mercury ceiling to 20M, but resuming `m3-a1c-dev60-dn` was refused: its launch pins the harness manifest
(ef5c3382), and `experiments/autobench/bridge.py` changed at 18:41Z. The AutomationBench families workflow added
`pin_timezone`, which acts only on rows that carry `info.tz` (the abr-* recurring families) and is a no-op for every
official task. It also loads the input row before installing the shim, which is pure and changes nothing. Following the
`a1-dev60-dn-fill` precedent, the 22 unfinished tasks run as **`m3-a1c-dev60-dn-fill`** (same model roles, budget, session
tokens and concurrency; token cap 2.3M; harness manifest 17a9f039, which differs from ef5c3382 only by that bridge
change). The headline for the 60 tasks pools the two runs, and the split is stated.

The same bridge change reached `a0-devcheck-2` (ab-chain4) mid-run. A0 records no harness manifest; official rows carry no
`info.tz`, so its behaviour is unchanged.

## Full dev60 (38 + 22 fill), 2026-10-21 19:00Z

| Arm, same 60 devTrain tasks | Strict pass | Only Mercury-planner passes | Only the other passes | p (exact McNemar) |
|---|---|---|---|---|
| **Haiku acting + Mercury ledger/checker (A1-C)** | **29/60 (48.3%)**, partial credit **0.800** | | | |
| Haiku alone | 9/60 | 24 | 4 | < 0.001 |
| Haiku + A1 prose harness | 18/60 | 17 | 6 | 0.035 |
| Haiku in every role (A1-C) | 20/60 | 13 | 4 | 0.049 |
| Sonnet alone | 20/60 | 15 | 6 | 0.078 |
| Sonnet + A1 prose harness | 28/60 | 8 | 7 | 1.00 |

**Cost.** Haiku $0.93 for 60 tasks ($0.015 per task); Mercury 3.68M tokens by the records (about 61K per task; at most
about $0.02 per task at documented list prices). In total at most about $0.035 per task, against Sonnet + A1's $0.115 and
Sonnet alone's $0.10.

**Reading (development evidence, k = 1, the A1-C pipeline was probed on these tasks; the Mercury roles are new).**
- **The best configuration we have measured on dev60:** two cheap models, a different-family planner/checker with a cheap
  actor, match the frontier model with the harness (29 vs 28; 8 vs 7 discordant) and are significantly better than
  Haiku-only A1-C, at about a third of the frontier cost.
- The out-of-sample test is next (devCheck look 3, or a disjoint devTrain 60), with the Sonnet-planner control (queued)
  separating "different family" from "stronger model".
