# PREREG-CI1-W2: CI-1 wave 2, nine larger held-out items, oracle v2 frozen as primary

*Written 2026-11-04 before the first wave-2 builder call. The freeze is `MANIFEST-W2.json` in this directory (sha256 recorded in the
commit that adds it, before any wave-2 build); `experiments/ci1-w2/run-w2.mjs` refuses a run when any frozen file changed. Wave 1:
[../RESULT-CI1.md](../RESULT-CI1.md), [../PREREG-CI1.md](../PREREG-CI1.md).*

## 1. Why a second wave

Wave 1 (19 test items) answered the preregistered question with wide intervals (A2 − A0 = +15.8, 95% CI 0.0 to 31.6) and, after the
oracle's five defects were corrected post hoc, sat near ceiling (A0 80.7%, A2 93.0%; 90.2% and 100% on the 17 unambiguous items). Two
things are needed: more items, and items that are harder than the wave-1 test median of 8 nodes. Wave 2 adds 9 items with a frozen
oracle that already contains the corrections, so its numbers are preregistered, not post hoc.

## 2. Bed (frozen)

- **Items** (`SPLIT-W2.json`, all test): 18797, 19187, 18534, 19014, 20090, 17902, 17771, 18281, 17175. n8n.io templates created
  2026-07-16 to 2026-09-28 (all after Haiku 5.5's cutoff), 7 to 35 nodes in the corpus graph (median 17), 0 to 5 Code nodes; three
  schedule triggers, four webhooks, two forms. Picked from the CI-1 pool (runnable in n8n-sim, no model or agent node) for size and
  business logic (receivables ageing and escalation, supplier qualification scoring, NCR risk scoring with duplicate detection, client
  onboarding with a risk digest, appointment cancel and reschedule, missed-heartbeat monitoring with re-alert windows, monthly
  statements of account, lead triage, web-form spam screening). Same author as wave 1 (Opus 5.5, bed author): held out from builder
  development (no builder has been run on any wave-2 item), not sealed.
- **Same protocol as wave 1** (`experiments/ci1-w2/bed2.mjs` imports wave 1's code): reference 1 = the corpus graph plus documented
  patches (placeholders and data-loss defects of the original, each with its reason in `spec.json`) run by n8n-sim; reference 2 = an
  independent Foundry transliteration; admission requires both to agree on all 32 candidate worlds and reruns to be identical; mutants;
  greedy cover of 6 to 8 hidden worlds that kill every killable mutant; one public world (the practice world) from the rest.
- **Oracle v2 is primary and frozen** (`experiments/ci1-posthoc/oracle-v2.mjs`, five declared changes from v1, RESULT-CI1.md §4). The
  categorical columns are computed once over all 32 candidate worlds and stored in each oracle file. v1 verdicts are recorded beside v2
  and reported, never used to decide.
- **Survivor audit** (RESULT-CI1.md §9): every mutant no candidate world kills was classified before the freeze: unreachable from the
  item's trigger (another trigger's subgraph in the same corpus file), wording only, value never reaches an effect, bound by the bed,
  n8n semantics (no items: nothing runs), equivalent, or boundary not sampled. Generators were extended where a stated boundary was not
  sampled (17175: four fixed boundary worlds, after which only an equivalent mutant survives; 17771: customers straddling each
  ageing edge; 17902, 18281: earlier session).
- **Description gates** (`experiments/ci1/gates.mjs`, $0): 9/9 pass (no source node name, no n8n vocabulary, not the title); word
  8-gram overlap with the creator's text at most 0.041. Descriptions are 245 to 652 words: complete specifications, as in wave 1.
- **Scorer:** `scoreBuilt2` with one robustness change made before the freeze: a hidden world whose run ends in `CODE_TIMEOUT` is rerun
  up to twice (wave 1 lost one build to a Code-step wall clock under host load).
- **Template fit** (`fit-w2.mjs`, $0): no BUILDER-1 template binds any wave-2 item's data (0/9), so A1 is not run (it would refuse).

## 3. Arms (wave 1's code, unchanged; model ids from `policy/models.json`)

| Arm | Model | K | Cap |
|---|---|---|---|
| **A0** one-shot (simple baseline) | claude-haiku-5-5 | 3 | $1.0 |
| A0t one-shot, thinking on | claude-haiku-5-5 | 3 | $1.0 |
| A1c compose path | claude-haiku-5-5 | 3 | $1.5 |
| **A2** A1c + leave-one-out retrieval | claude-haiku-5-5 | 3 | $1.5 |
| REF (the transliteration), EMPTY (no effects) | – | 1 | $0 |

Mercury is not run in wave 2: this item's 0.5M-token Mercury allowance has about 0.16M left, a handful of builds. The Opus arm is not
run (no budget line). Paid runs are detached from `experiments/ci1-w2/w2-run.sh` with the 30-minute environment-fault rule.

## 4. Measures

- **Primary:** A2 − A0 on the 9 wave-2 items, paired by item: difference of per-item pass@1 (K = 3) with a 95% item-bootstrap
  interval (10,000 resamples, seed 20261022) and an exact sign test; pass@1 and pass^3 per arm.
- **Secondary:** A2 − A1c (retrieval), A1c − A0 (compose loop), A0t − A0 (thinking); every failing build root-caused as in wave 1.
- **Pooled (secondary, labelled):** wave 1 under oracle v2 (post hoc) + wave 2 (preregistered), 28 items, A2 − A0 and A2 − A1c.
- **Validity gates before reading any arm:** REF passes 9/9, EMPTY passes at most 1/9.

## 5. Predictions (written now)

- A0: 45–80% pass@1 (larger items than wave 1; its dominant wave-1 failure, a reference to a skipped branch, has more branches to
  hit: webhooks with validation and duplicate paths).
- A2: 60–95%. **A2 − A0: 0 to +25 points.** A2 − A1c: −5 to +15.
- A0t − A0: −10 to +10 (no gain in wave 1).
- Park rule (from PREREG-CI1, applied to the pooled 28 items under v2): if A2 − A1c ≤ 3 points and the upper bound of its interval is
  below 10, retrieval is parked and the negative result kept.

## 6. Limits stated in advance

Nine items detect only large differences. One author wrote every description, generator, transliteration and the oracle, and also
wrote the wave-1 analysis that motivated oracle v2; the items are the deterministic, model-free slice of n8n templates. References are
shim interpretations (stand-in node semantics), not n8n itself.
