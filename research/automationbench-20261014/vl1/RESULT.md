# VL-1 result: the verifier-lab live arm on look 2 (AutomationBench)

**Evidence label.** Development, exploratory. This is look 2 of SEQUENTIAL-PLAN-v1 and the first look for every fork and
for the selector. The protocol is A1F: forked worlds and three models (Haiku 5.5, Mercury 3, Sonnet 5.5). It is never
a headline, and any claim needs a sealed rerun (PREREG-VL1 §0).
Sources:
- preregistration: `PREREG-VL1.md`, sha256 `f316ca51…f1f4`, frozen 2026-10-22;
- selection: `vl1/selection.json`, sha256 `5c7b5e48…3334`, committed alone in `686e61ec` before any grade was read;
- scores: `vl1/RESULT.json`, from the frozen `score.mjs`;
- per-task vectors and aggregates: `runs/vl1-look2/` (no transcripts).

## Decisions (PREREG-VL1 §9, applied mechanically by `score.mjs decide()`)

| Rule | Inputs | Outcome |
|---|---|---|
| Selection works if VL-1 − v1-M ≥ +3 with ≤ 2 losses; it is not the lever if ≤ +1 | +3 (8 gains, 5 losses) | **Inconclusive (neither rule fires).** No plan change on look 2; the question waits for a sealed rerun |
| Opus parity: VL-1 ≥ Opus − 2 at ≤ 20% of Opus's $/task | 32 vs 26 (passes); $0.1458 vs $0.3854 = 37.8% (fails) | **Not met** (cost condition; foreseen in the §0 disclosure) |
| VL-1R carry: gains > breaks vs control, and HP precision ≥ 0.7 | 0 fixed, 2 broke; precision 9/17 = 0.53 | **Do not carry repair** |

## Forks and reference (60 look-2 tasks; strict pass = the headline `final.task_completed_correctly`)

| Arm | Run | CLI | Pass | $ / task | $ / success | Mercury tokens |
|---|---|---|---|---|---|---|
| v1-M (A1-C v1, Haiku + Mercury) | `a1c-v1m-look2` | 2.1.312 | 29 (48.3%) | 0.0162 | 0.0335 | 3.52M (58.7K / task) |
| Sonnet 5.5 + A1 | `a1s-look2` | 2.1.307 | 27 (45.0%) | 0.1122 | 0.2493 | 0 |
| A0 Haiku | `a0-look2` | 2.1.312 | 9 (15.0%) | 0.0127 | 0.0847 | 0 |
| v2-M (A1-C v2, Haiku + Mercury) | `a1c-v2m-look2` | 2.1.312 | 27 (45.0%) | 0.0109 | 0.0243 | 3.90M |
| **Opus 5.5 xhigh, A0 (reference)** | `a0o-look2-1` | 2.1.307 | **26 (43.3%)** | **0.3854** | **0.8894** | 0 |

## Selection cells (paired over 60 tasks: exact two-sided McNemar; 10,000-sample bootstrap, seed 20261022)

Notes on the columns:
- $ / task is acting plus verifier cost; Mercury tokens are priced at $0 and reported apart.
- HP flagged = picks with a failing hard high-precision check (failing / flagged).

| Cell | Role | Pass | vs v1-M (+gain / −loss), p, 95% CI | vs Opus, p, CI | vs A0, p | Oracle | Switched | $ / task | $ / success | HP flagged |
|---|---|---|---|---|---|---|---|---|---|---|
| **P2/R3** | **VL-1** | **32** | **+3 (+8/−5), p 0.581, [−4, +10]** | **+6 (+10/−4), p 0.180, [−1, +13]** | +23, p 1.5e-5 | 37 | 34 | **0.1458** | **0.2733** | 9/17 |
| P2/R1 | VL-1/R1 | 31 | +2 (+3/−1), p 0.625, [−2, +6] | +5 (+11/−6), p 0.332 | +22 | 37 | 14 | 0.1458 | 0.2822 | 9/16 |
| P2/R2 | VL-1/R2 | 31 | +2 (+7/−5), p 0.774, [−5, +9] | +5 (+10/−5), p 0.302 | +22 | 37 | 33 | 0.1458 | 0.2822 | 11/20 |
| P2/R0 | v1-M alone | 29 | – | +3 (+12/−9), p 0.664, [−6, +12] | +20 | 37 | 0 | 0.1458* | 0.3016* | 10/20 |
| P2h/R2 | VL-1h | 29 | +0 (+3/−3), p 1, [−5, +5] | +3 (+11/−8), p 0.648 | +20 | 32 | 20 | 0.0463 | 0.0958 | 11/22 |
| P3/R3 | VL-3 | 33 | +4 (+9/−5), p 0.424, [−3, +11] | +7 (+11/−4), p 0.118, [0, +14] | +24 | 39 | 40 | 0.1610 | 0.2927 | 8/17 |
| P2v2/R3 | VL-v2 (vs v2-M, 27) | 30 | +3 (+5/−2), p 0.453, [−2, +8] | +4 (+9/−5), p 0.424 | +21 | 35 | 26 | 0.1405 | 0.2810 | 10/18 |
| VL-1R | P2/R3 + repair | 30 | vs VL-1: −2 (+0/−2), p 0.5, [−5, 0] | | | | | 0.1479 | 0.2957 | |

\* P2/R0's cost is the pool's: both forks run. v1-M run alone costs $0.0162 per task.

The full R0–R3 × {P2, P2h, P3, P2v2} grid is in `RESULT.json`. Cells not listed above are descriptive only.

## Diagnostics

- **P2 outcome split** (v1-M, Sonnet+A1):
  - both pass: 19; v1-M only: 10; Sonnet only: 8; neither: 23.
  - On the 18 mixed tasks, R3 picks the passing world on 13 (q = 0.72), and R1 and R2 on 12. The prereg's assumption was
    q 0.70–0.85.
  - The gain stayed small because v1-M scored higher than expected: 29, against the prior's 26. R3 switched away from it
    on 34 tasks.
- **Gains vs v1-M:**
  - finance.invoice_aging_followup, marketing.partner_comarketing, marketing.video_repurpose,
  - operations.asana_slack_sheets_audit, operations.holiday_coverage_planning, sales.linkedin_sales_prospecting,
  - sales.milestone_celebration, support.zendesk_maintenance_notify.
- **Losses vs v1-M:** finance.qb_estimate_conversion, hr.jira_it_onboarding, hr.payroll_bonus_processing,
  operations.zoom_project_kickoff, sales.calendly_sequential_meetings.
- **Per domain, VL-1 / v1-M / Opus (of 10 each):**

  | Domain | VL-1 | v1-M | Opus |
  |---|---|---|---|
  | finance | 7 | 7 | 6 |
  | hr | 4 | 6 | 4 |
  | marketing | 5 | 3 | 3 |
  | operations | 5 | 4 | 3 |
  | sales | 5 | 4 | 4 |
  | support | 6 | 5 | 6 |

- **Union of all five forks:** 40 of 60.
- **VL-1R:**
  - 17 picks were treated; all graded, with control drift 0 and no audit violation; $0.124 spent.
  - Against the control, the treatment fixed 0 and broke 2 (marketing.social_crisis_response,
    operations.chatgpt_feedback_analysis).
- **HP precision on the P2/R3 picks** is 9/17 = 0.53. On dev60 it was 7/13 = 0.54.

## Expected vs observed (PREREG-VL1 §8)

| Arm | Prior | Observed |
|---|---|---|
| A0 Haiku | 15% (12–20) | 15.0% |
| v1-M alone | 43% (38–48) | 48.3% |
| Sonnet + A1 | 43% (38–47) | 45.0% |
| **VL-1** | **50% (45–55), ≈ $0.15** | **53.3%, $0.146** |
| VL-1h | 47% (42–52) | 48.3% |
| Opus 5.5 xhigh | 42% (35–50), $0.9–1.5 | 43.3%, $0.385 |

## Spend (new for VL-1)

| Item | Spend |
|---|---|
| Sonnet fork | $6.732 recorded, plus up to $3 unrecorded (sessions killed by the 2026-10-22 container restart) |
| RL2 extraction | $0.745 (180 calls) |
| RL2 judge | $0.065 (100 calls) |
| Haiku judge | $0.531 (240 calls) |
| VL-1R | $0.124 |
| **Total recorded** | **$8.20** (cap $15.25) |

## Deviations and disclosures (details in `runs/vl1-look2/EVENTS.jsonl`)

1. **CLI versions.** §2 says every arm ran CLI 2.1.307, but the A1-C v2 chain's arms (v1-M, A0, v2-M) ran 2.1.312. The
   verifier and repair calls ran on 2.1.318. Recorded per arm.
2. **Score precondition path.** `run-look2.sh score` looks for the chain's `analysis.json` in worktree
   `wf_3674d3bc-0a7-12`, which was removed after its merge. The file is committed in the main tree (`287f57ff`, sha256
   `3a99467c…`, 44,613 bytes, the same size seen in the worktree before it was removed).
   - `score.mjs` was run directly with `run-look2.sh`'s exact arguments.
   - The frozen checks passed: VL1-FROZEN OK, all 7 runs finished, and the selection committed and equal to HEAD.
   - No frozen file changed.
3. **Blindness.**
   - On 2026-10-22, the per-task results of 6 Sonnet tasks were seen in the run log (an earlier instance).
   - Before the selection, aggregate counts of the chain arms were seen, from the HEAD commit subject and the chain
     log's summary lines. No per-task grade was read before `686e61ec`. Selection is mechanical.
4. **Duplicate runner (environment, $0).** A second VL-1 instance raced on the lab build. The lab was deleted and rebuilt
   cleanly: 240 rows and 480 world files. Nothing from the collided lab was used.
5. **Sonnet fork spend.** The fork has unrecorded spend from the container restart (≤ $3). Costs above use the recorded
   `costUsd`.
6. **Policy file.** The recorded (not enforced) policy changed from `2026-10-21.2` to `.3` (CLI childEnv lines only). The
   model ids are unchanged.
