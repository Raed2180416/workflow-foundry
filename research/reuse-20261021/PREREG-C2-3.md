# Pre-registration: C2-3, the agent baseline with the same labelled history

| Field | Value |
|---|---|
| Experiment id | C2-3 (requirements row A9; answers finding 2 of the 2026-11-04 review of C2-1/C2-2) |
| Question | C2-1's agent baseline never saw a label, while rebuilding (SCRATCH) and the history gate (G0) each used the supplier's 15 labelled history products. Is reuse still better than an agent that has the same information? |
| Evidence class | **development**: preregistered and frozen before any paid call on the test items, but program B, its suppliers and oracle are the experimenter's, and C2-1's test items were analysed in C2-1 and C2-2 (they are not held out from the experimenter) |
| Budget | C2's spend ledger (`/var/tmp/foundry-work/reuse-c2/spend.jsonl`, cap $2.90 for all of C2; the brief's cap is $3). Spent before this file: $1.8626 (C2-1 $1.8208 + this experiment's dev smoke $0.0418). Projected: about $0.40 per repetition, $0.80 for K = 2 |
| Date | 2026-11-04 |

## 1. Arm (new, paid)

**AGENT-H@k**, k = 1, 2: for each of C2-1's 235 test items, one Haiku 5.5 (`claude-haiku-5-5`) session, exactly as C2-1's
AGENT arm (`agent-b.mjs runAgentItem`, unchanged: SOP-Bench's system and user prompts, Bash and the tool client over B's
supplier world, 10 tool steps, 10 minutes), with two changes:

1. **The supplier's labelled history in the system prompt** (`agent-h.mjs`): the 15 history products of the item's
   supplier that SCRATCH's builder learned from (manifest `build` ids then `repair` ids), each with its inputs (the same
   text format as the task), what each of the four procedure tools returns for it in the supplier's world (`callTool`,
   the same server the agent's own calls reach) and B's recorded class. Header, worded after the builder's brief:
   "Labelled history: the past items below come from the same supplier as the task, each with its inputs, what each of
   the procedure's tools returned for it, and the hazard_class recorded for it. The recorded classes are correct. Where
   the SOP is silent or ambiguous, infer the rule from these records, and keep your answer consistent with them."
   One block per supplier; their sha256 are in `runs/c2-3/blocks-test.json` and in the freeze.
2. **Session budget $0.05** (CLI cap and ledger reservation) instead of $0.25: C2-1's 470 agent sessions cost at most
   $0.0028. A session that hits the cap is scored as it ends (no answer = wrong), not rerun.

Items run grouped by supplier (stream order within a supplier) so a supplier's block is a prompt-cache prefix; sessions are
independent, so the order changes no answer. Environment faults (SOP-Bench `isEnvFault`: rate or usage limit, unavailable
model or sandbox, executor launch or protocol failure, harness error) stop the phase; the faulted records stay in the
ledger and the record file, are never scored, and a resume reruns those items (as C2-1 §6).

## 2. Comparators (recorded in C2-1, not rerun)

On the same 235 items (manifest `15f753dc…`), from `/var/tmp/foundry-work/reuse-c2/c2-1/test/`:
SCRATCH@L1, L2 and REUSE-b3@L1, L2 (C2-1, preregistered); REUSE-G0@L1, L2 (C2-1 §5, post-hoc: the entry reused for a
supplier only if it reproduces its 15 history labels); AGENT@k1, k2 (C2-1, no history). `c23.mjs analyze` reproduces C2-1's
published numbers for all of them before any C2-3 run (checked 2026-11-04: SCRATCH 230 / 231, REUSE-b3 200 / 201, REUSE-G0
230 / 231, AGENT 134 / 133 of 235).

## 3. Measurements

Per arm: item accuracy (strict, as C2-1), Unable-to-Decide answers, no answer, shipment accuracy, holds, wrong bookings,
USD per item and per correct item (AGENT-H: session cost; builds as C2-1 charged them), time per item including builds
and (REUSE-G0) the conformance runs, accuracy per supplier. Paired item-accuracy differences with the shipment-cluster
bootstrap of C2-1 (`analyze.mjs pairedShipmentBootstrap`, 10,000 resamples, seed `c2-boot`, 95%):
SCRATCH@L − AGENT-H@k, REUSE-G0@L − AGENT-H@k, REUSE-b3@L − AGENT-H@k (every L, k), AGENT-H@k − AGENT@k, AGENT-H@1 − AGENT-H@2.

## 4. Predictions (recorded before any test-set session)

Dev smoke behind them (C2-1's dev set, suppliers S2, S3, S4, S6 only, $0.0418): block in the user prompt 6/8 correct,
block in the system prompt 12/12. Twenty dev items is no estimate; the predictions are the experimenter's judgement.

- **P1 (primary).** AGENT-H is less accurate than rebuilding: SCRATCH@L − AGENT-H@k has a 95% interval above 0 in at least
  3 of the 4 pairings. AGENT-H item accuracy 85–95% in each repetition.
- **P2.** REUSE-G0 − AGENT-H equals SCRATCH − AGENT-H item by item (REUSE-G0's outcomes on this set are SCRATCH's: the
  entry is right on every item of an admitted supplier, and refused suppliers get the same build). Not a prediction about
  the agent; the analysis checks it.
- **P3.** The preregistered C2-1 REUSE (b3) is not better than AGENT-H: REUSE-b3@L − AGENT-H@k point estimate ≤ 0 in every
  pairing. This replaces C2-1's D3 ("REUSE better than the agent by about 28 points"), which compared against an agent
  without labels and is withdrawn as a capability claim whatever C2-3 shows.
- **P4.** Labels are most of the agent's gap: AGENT-H@k − AGENT@k ≥ +25 points, interval above 0, both k.
- **P5 (per supplier).** AGENT-H ≥ 95% on S0, S1, S5, S6, H1, H2, H5; ≥ 80% on S2 and H3 (ids in the supplier's own format,
  which C2-1's agent refused on every item); lowest on S3, S4 and H4 (a scale to infer from 15 classes).
- **P6 (cost and time, measured at about 20 items per supplier).** AGENT-H costs $0.0015–0.0025 per item: above C2-1's
  AGENT, near REUSE-G0 ($0.0018 / $0.0015), below SCRATCH ($0.0026 / $0.0024). Agent cost does not amortise: at 100 or more
  items per supplier REUSE-G0 and SCRATCH cost less per item (a projection from the measured unit costs, labelled so).

## 5. Threats

- Self-authored program, suppliers and oracle (as C2-1); B's class bands equal the reused workflow's by construction.
- The test items were analysed in C2-1 and C2-2; the experimenter knows which suppliers are hard. The block's wording and
  placement were chosen with 20 dev items; nothing about the agent was tuned on test items.
- The agent sees all 15 records at once; the builder saw 5, then 10 more in a repair round, and ran its code on them.
  Neither sees the other 220 items' labels.
- K = 2 repetitions of one model; one procedure.
- The comparators were run in October 2026 and AGENT-H in November: CLI version and service conditions differ, so time
  per item is compared with that caveat (C2-1's own agent repetitions already differ in concurrency, 3 and 2).
- If the ledger cap stops repetition 2, only complete repetitions enter the comparisons, and a single repetition is
  reported as K = 1.

## Amendments
(dated entries only)
