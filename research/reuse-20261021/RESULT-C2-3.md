# RESULT C2-3: the agent baseline with the same labelled history (2026-11-04)

*Development evidence. Preregistered in [PREREG-C2-3.md](PREREG-C2-3.md) (commit `1c945542`) and frozen in
[FREEZE-C2-3.json](FREEZE-C2-3.json) (commit `2a2f6a4e`: code, manifest `15f753dc…`, the 12 history blocks, prereg hash)
before any test-set session; `checkFreeze` still passes after the run (no code, block, manifest or prereg change).
Program B, its suppliers and oracle are the experimenter's, and C2-1's test items had been analysed in C2-1 and C2-2, so
nothing here is sealed or held out from the experimenter. Per-session records (they hold SOP-Bench-derived text) are under
`/var/tmp/foundry-work/reuse-c2/c2-1/test/agent-h.jsonl`; aggregates in [runs/c2-3/](runs/c2-3/). Answers finding 2 of the
2026-11-04 review of C2-1/C2-2 (C2-1's agent baseline saw no label).*

Run: `node experiments/reuse/c23.mjs agent --run-id c2-1 --set test --k 1|2 --concurrency 2`, then `analyze`;
post-hoc: `c23-posthoc.mjs`, `c23-errors.mjs`. Model `claude-haiku-5-5` (policy/models.json) through the repo's Claude CLI
executor, CLI 2.1.318 for every C2-3 session. 470 scored sessions, 0 policy violations, 0 nested model uses.

## 1. The answer

Given the same 15 labelled history products per supplier that rebuilding (SCRATCH) and the history-gated reuse (G0) learn
from, the Haiku agent scores **91.5% in both repetitions** (215/235 each), against **97.9% / 98.3%** for SCRATCH and for
REUSE-G0 (whose item outcomes equal SCRATCH's) and **85.1% / 85.5%** for the preregistered reuse gate b3. Rebuilding is
better than the informed agent by **6.4 to 6.8 points**, every preregistered interval above 0 (P1 holds). C2-1's "+28
points over the agent" shrinks to "the preregistered reuse arm is about 6 points *worse* than an agent with the same
labels" (P3 holds), and the labels are worth about **+35 points** to the agent (P4 holds).

Where the gap sits matters more than its size (post-hoc, §5): on the 169 items whose class the supplier's history
determines, the agent is within 1 to 8 items of SCRATCH (3 of 4 intervals include 0). Almost all of SCRATCH's lead is on
57 items that fall in gaps the 15 labels leave open, where B's oracle uses the same equal bands that SCRATCH's builder and
the reused workflow default to, by construction. The rest is the agent refusing ids and zero scores that the procedure's
text forbids but the supplier's labelled history accepts.

## 2. Arms (235 items, 120 shipments, 12 suppliers)

| Arm | Labels per supplier | Item accuracy (L1 / L2, or k1 / k2) | Shipments right | Wrong bookings | Holds | USD per item | USD per correct item | Time per item incl. builds |
|---|---|---|---|---|---|---|---|---|
| SCRATCH, same Haiku builder (C2-1) | 15 | 230 = 97.9% / 231 = 98.3% | 97.5% / 98.3% | 3 / 2 | 7 / 7 | $0.0026 / $0.0024 | $0.0026 / $0.0024 | 13.3 s / 13.8 s |
| REUSE-G0, entry gated on the supplier's history (C2-1 §5, post-hoc) | 15 | 230 = 97.9% / 231 = 98.3% | 97.5% / 98.3% | 3 / 2 | 7 / 7 | $0.0018 / $0.0015 | $0.0018 / $0.0015 | 10.0 s / 9.7 s |
| **AGENT-H, Haiku agent per item with the history (C2-3)** | 15 | **215 = 91.5% / 215 = 91.5%** | 89.2% / 87.5% | 8 / 6 | 12 / 16 | $0.0017 / $0.0015 | $0.0019 / $0.0017 | 14.6 s / 16.0 s |
| REUSE-b3, preregistered producer-profile gate (C2-1) | 15 (for refused suppliers' builds) | 200 = 85.1% / 201 = 85.5% | 84.2% / 85.0% | 19 / 18 | 7 / 7 | $0.0017 / $0.0013 | $0.0020 / $0.0015 | 9.2 s / 8.2 s |
| AGENT, no history (C2-1) | 0 | 134 = 57.0% / 133 = 56.6% | 54.2% / 55.0% | 17 / 11 | 45 / 50 | $0.0013 / $0.0010 | $0.0024 / $0.0019 | 11.4 s / 9.4 s |

Unable to Decide answers: AGENT-H 16 / 21 (truth Unable on 9 items), AGENT 77 / 86, every workflow arm 9. Builds paid per
lineage: SCRATCH 12, REUSE 7. The agent's time is not like for like: C2-3 ran in November at concurrency 2 on CLI 2.1.318
with a longer system prompt, C2-1's arms in October (agent at concurrency 3 then 2, CLI 2.1.306).

**Projected per-item cost and time at N items per supplier** (`c23-posthoc.mjs`, from the measured unit costs; a
projection, not a measurement; all arms use the same 15 labels, so labelling cost is equal):

| Arm | N = 20 (≈ measured) | N = 100 | N = 1,000 |
|---|---|---|---|
| SCRATCH L1 / L2 | $0.0025 / $0.0023, 13.0 / 13.5 s | $0.00051 / $0.00046, 3.4 / 3.1 s | $0.00005 / $0.00005, 1.2 / 0.7 s |
| REUSE-G0 L1 / L2 | $0.0018 / $0.0015, 9.8 / 9.5 s | $0.00035 / $0.00029, 2.7 / 2.4 s | $0.00004 / $0.00003, 1.1 / 0.8 s |
| AGENT-H k1 / k2 | $0.0017 / $0.0015, 14.6 / 16.0 s | same | same |

At C2's volume (about 20 items per supplier) the agent costs about what REUSE-G0 costs and less than SCRATCH. From about
100 items per supplier the workflows cost a fifth of the agent and the gap grows with volume; between the two workflow
arms the difference at 1,000 items is $0.00002 per item, and SCRATCH is faster in lineage 2.

## 3. Preregistered predictions

| Prediction | Result |
|---|---|
| **P1 (primary):** SCRATCH − AGENT-H interval above 0 in ≥ 3 of 4 pairings; AGENT-H 85–95% per repetition | **holds**: L1−k1 +6.4 [2.2, 10.9], L2−k1 +6.8 [3.1, 11.2], L1−k2 +6.4 [2.1, 11.1], L2−k2 +6.8 [2.7, 11.2]; AGENT-H 91.5% and 91.5% |
| P2: REUSE-G0 − AGENT-H equals SCRATCH − AGENT-H item by item | **holds**: REUSE-G0's item outcomes equal SCRATCH's in both lineages (0 items differ) |
| P3: REUSE-b3 − AGENT-H point estimate ≤ 0 in every pairing | **holds**: −6.4 [−13.4, 0.8], −6.0 [−13.0, 1.1], −6.4 [−13.6, 0.4], −6.0 [−12.9, 0.9]. C2-1's D3 (+28 points) stays withdrawn as a capability claim |
| P4: AGENT-H − AGENT ≥ +25 points, interval above 0, both k | **holds**: +34.5 [26.4, 42.7] and +34.9 [26.7, 43.2] |
| P5: AGENT-H ≥ 95% on S0, S1, S5, S6, H1, H2, H5; ≥ 80% on S2 and H3; lowest on S3, S4, H4 | **fails**: S2 is lowest (13/21 and 9/21); H5 14/16 and 15/16; S0 17/18 and S5 16/17 in k1. H3 20/21 both; S3 19/20, S4 18/21, H4 17/19 and 19/19 |
| P6: AGENT-H $0.0015–0.0025 per item, above AGENT, near REUSE-G0, below SCRATCH; workflows cheaper from 100 items per supplier (projection) | **holds**: $0.0017 / $0.0015; projection above |
| AGENT-H@1 − AGENT-H@2 (reported, no prediction) | 0.0 [−3.8, 3.7]: same total, but 10 of the 30 distinct missed items are missed in both repetitions |

Per supplier (k1 / k2; SCRATCH L1 / L2):

| | S0 | S1 | S2 | S3 | S4 | S5 | S6 | H1 | H2 | H3 | H4 | H5 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AGENT-H | 17/18, 18/18 | 21, 21 /21 | **13, 9** /21 | 19, 19 /20 | 18, 18 /21 | 16, 17 /17 | 19, 19 /19 | 21, 20 /21 | 20, 20 /21 | 20, 20 /21 | 17, 19 /19 | 14, 15 /16 |
| AGENT (no history) | 16, 18 /18 | 20, 20 /21 | 0, 0 /21 | 3, 3 /20 | 0, 0 /21 | 15, 16 /17 | 18, 17 /19 | 21, 19 /21 | 20, 21 /21 | 0, 0 /21 | 5, 4 /19 | 16, 15 /16 |
| SCRATCH | 18, 18 /18 | 21, 21 /21 | 21, 21 /21 | 20, 18 /20 | 21, 21 /21 | 17, 17 /17 | 19, 19 /19 | 21, 21 /21 | 21, 21 /21 | 21, 21 /21 | 14, 17 /19 | 16, 16 /16 |

## 4. Root causes of every AGENT-H miss (40 = 20 per repetition)

Read from the per-session answers and the oracle's SOP-scale scores (`c23-errors.mjs`, [runs/c2-3/errors.json](runs/c2-3/errors.json)).

- **The procedure's text over the supplier's labelled history (19 misses: 7 in k1, 12 in k2).** S2 stores ids as
  `P-NNNNN` and H3 as `p_NNNNN`; the procedure (§5.1) asks for `P_XXXXX`, and B's master accepts each supplier's own format.
  The history block shows 15 such ids with their classes. In 16 sessions the agent said so ("the history classified
  hyphenated ids, but the SOP's explicit format rule takes precedence") and answered Unable to Decide, mostly without
  calling a tool; in 2 more it rewrote the id to `P_NNNNN`, which the supplier's service does not know. The same pattern
  on H4 (scores stored 0–4): three stored zeros are "missing" under §5.6, so the agent answered Unable although it noted
  that history records with three zeros were labelled A (1 miss). The behaviour is not stable: S2 lost 5 items to it in
  k1 and 11 in k2, on the same items and prompts. The header told the agent to infer the rule "where the SOP is silent
  or ambiguous"; here the SOP is explicit, and the agent sided with it.
- **Band edges the history does not determine (21 misses: 13 in k1, 8 in k2).** §5.7 names four classes and no
  cut-offs. On each miss the item's total lies in a gap between two classes in that supplier's 15 labels (S2's history,
  for example, has C at 13 and 16 and D at 20, so 17–19 is open); the agent drew the boundary elsewhere, in both
  directions (17–19 called C, 8 called B, 10 called C, 13 called B, and on S3 a 1–10 total of 15 called A). B's oracle
  puts these totals in equal bands, which is also what SCRATCH's builder chose. Same root cause as SCRATCH's own errors
  (C2-1 §4: 15 labels underdetermine the conversion), but SCRATCH's default prior matches B's matrix by construction.
- No timeouts, no budget stops (the most expensive session cost $0.0037 against the $0.05 cap), no malformed answers.

## 5. Post-hoc analyses (not preregistered)

**History-pinned strata** (`c23-errors.mjs strataOf`). A class item is *pinned* when its supplier's 15 labels fix its
class by monotonicity (an equal total, or two same-class totals around it, or a total beyond the end classes); otherwise
it falls in a *gap*. 169 items are pinned, 57 in gaps, 9 have truth Unable (every arm gets those 9 right).

| Comparison | Pinned (169) | Gap (57) |
|---|---|---|
| SCRATCH@L1 − AGENT-H@k1 | 165 vs 164: +0.6 [−2.8, 4.2] | 56 vs 42: +24.6 [14.1, 36.2] |
| SCRATCH@L2 − AGENT-H@k1 | 168 vs 164: +2.4 [−0.6, 5.9] | 54 vs 42: +21.1 [10.2, 32.8] |
| SCRATCH@L1 − AGENT-H@k2 | 165 vs 160: +3.0 [−1.7, 8.1] | 56 vs 46: +17.5 [7.1, 28.8] |
| SCRATCH@L2 − AGENT-H@k2 | 168 vs 160: +4.7 [0.6, 9.4] | 54 vs 46: +14.0 [3.4, 25.4] |
| AGENT-H − AGENT (k1, k2) | +45.6, +43.8 (intervals above 0) | +7.0 [−7.4, 20.8], +14.0 [0.0, 27.8] |

On what the evidence determines, the informed agent and rebuilding are close; on what it leaves open, the workflow arms win
because B was defined with their default bands. A program whose true bands differ inside those gaps would cost SCRATCH
and the reused entry the same items, and no C2 number can show which prior is right.

**Supplier-clustered bootstrap** (12 clusters, `c23-posthoc.mjs`; the review's finding 1 applied to the comparisons):
SCRATCH − AGENT-H +6.4 [0.0, 14.0] (L1−k1), +6.8 [1.7, 14.0] (L2−k1), +6.4 [−3.0, 18.2] (L1−k2), +6.8 [−0.9, 17.8]
(L2−k2): only 1 of 4 intervals clearly excludes 0 when the supplier is the unit, because S2 carries most of the gap.
AGENT-H − AGENT stays above 0 (+34.5 [12.9, 56.6], +34.9 [13.8, 57.3]); REUSE-b3 − AGENT-H spans about −27 to +12.

## 6. Faults, deviations and peeking

- **Rate limit.** Repetition 1 stopped at 15:12Z on `MODEL_RATE_LIMIT` (the account's 5-hour limit, shared with the main
  tree's paid runs) after 147 scored items; the 2 faulted sessions cost $0, stay in the record file and ledger and are not
  scored. Resumed at 17:18Z after the limit reset, as §1 prescribes; repetition 2 ran 17:29–18:00Z without a fault.
- **A look at partial results.** At 15:00Z, mid-repetition 1, the earlier session ran a failure-anatomy script on the
  records so far (4 misses then). Nothing that feeds a session changed afterwards (`checkFreeze`: no code, block, manifest
  or prereg change), so the look could not alter an answer; it is recorded because it happened.
- **Time.** Repetition 2 took 1,889 s for 235 items against 625 s for the last 88 items of repetition 1, at the same
  concurrency, while the host also ran other experiments; session times are host-load dependent.

## 7. Honest reading

- **The capability number (dev):** with the same 15 labels per supplier, rebuilding 97.9 / 98.3%, history-gated reuse
  97.9 / 98.3% (identical items), Haiku agent 91.5 / 91.5%, preregistered profile-gated reuse 85.1 / 85.5%, Haiku agent
  without labels 57.0 / 56.6%. The informed agent is the right baseline; C2-1's no-history agent measured missing
  information, not capability.
- **Reuse is not shown to beat a good agent on accuracy here beyond B's by-construction bands.** The workflow arms' lead
  over the informed agent is 6.4–6.8 points overall, about 0.6–4.7 points on items the labels determine, and the rest on
  items B's matrix decides with the workflows' own default. What the workflow arms do show: the same answer every run
  (the agent's S2 accuracy moved from 13/21 to 9/21 between repetitions on identical inputs), no model call per item
  once built (REUSE-G0 runs at $0 per item), and a cost per item that falls with volume while the agent's does not.
- **The agent's main failure is a policy question, not a reasoning one.** When the procedure's text and the
  supplier's labelled practice disagree (id format, zero scores), the agent follows the text in 19 of 40 misses. A
  workflow built on the labels follows the labels. Which is right is the owner's or the program's call; the experiment
  only shows that the two arms resolve the conflict differently, and that the agent does it inconsistently.
- **What this does not show.** One procedure, one second program, suppliers and oracle written by the experimenter; the
  test items were analysed twice before this run. Nothing is sealed.

## 8. Cost

C2-3 cost $0.805: dev smoke $0.0418 (2026-11-04, 20 dev items) and $0.7631 for the 470 scored test sessions (the 2
faulted sessions cost $0). Of this, $0.511 was spent in the session that resumed the run (17:18–18:00Z). C2 ledger:
**$2.6257** of the $2.90 cap (C2-1 $1.8208, C2-2 $0, C2-3 $0.8050); brief cap $3.

## 9. Next

1. An adapter arm (review suggestion): keep the proven entry and have Haiku build only a per-supplier adapter (id
   format, scale, response key), admitted only if it reproduces the history. S2, S3, S4 and H1–H4 are deterministic
   per-supplier transforms, so most refused suppliers could reuse the entry with a build smaller than a full rebuild.
2. A second program whose bands the experimenter did not choose (another SOP-Bench procedure with its own labels, or
   external data), so the gap stratum stops favouring the workflows by construction.
3. Fresh-label monitoring of admitted reuse (C2-1 §7.1, C2-2 T1); the agent arm needs the same, since it varies run to run.

## 10. Reproduce

```
node experiments/reuse/c23.mjs analyze                 # arms, P1–P6 comparisons -> runs/c2-3/summary.json (needs LIVE records)
node experiments/reuse/c23-posthoc.mjs                 # supplier-clustered bootstrap, strata, projection -> runs/c2-3/posthoc.json
node experiments/reuse/c23-errors.mjs                  # failure anatomy and strata -> runs/c2-3/errors.json
nice -n 15 node --test --test-concurrency=1 experiments/reuse/test/c23-posthoc.test.mjs   # 3 tests
nice -n 15 node --test --test-concurrency=1 experiments/reuse/test/review-fixes.test.mjs  # 12 tests (C2-3 block, composition)
```
