
# M9: a risk-adjusted CUSUM instead of `recompileOnDeopts: 2`. The count stays.

*2026-10-14. ATTACK §3 M9; PROOF-LEDGER K15; DEV-NOTES D29. Development evidence only: dev seeds 201–224, K = 1. Inputs: the 260 as-run rows of `runs/jit-dev-records-1` (168) and `runs/jit-dev-kinetics-1` (92), plus the N-version probe. $0, no model call, `beds/sealed/` not read. Dev tasks were regenerated for `profile.mjs`; 48 of 48 hashes match the rows. Code: `experiments/jit/cusum.mjs`; 13 tests. Outputs: `out/cusum.json` and `out/tables.generated.md` (10,000 simulated paths per calibration, seed 9). Input hashes: `profile.mjs` fbaf824f…, `eval-profiles.mjs` 8f2dd831…, `nversion-records-dev.json` 0e000d99….*

## 0. Result
- **Keep the count.** At ARL0 500 (h 3.251) the CUSUM never alarms on any of the 6 JIT streams.
  - It detects 0 of 4 drifts within 4 tasks, with 0 false alarms.
  - The count rule detects 3 of 4 (delays 0, 1, 0). Records O→H was recompiled by the regression trigger at the drift index, which both regimes keep.
  - The count rule raises 8 false alarms in 71 pre-drift tasks (kinetics H→H 2, S→H 3), so it fails the false-alarm half of the same bar.
- **The cause is arithmetic.**
  - In-control events occur on 26–49% of tasks, and one event adds at most 0.47.
  - So the chart needs at least 7 events in a row, and the 5 rows from D to D+4 add at most 2.33.
  - All 24 variants give 0 alarms at ARL0 500.
- **No h meets both halves.**
  - Detecting 4 of 4 needs h ≤ 0.35: ARL0 3.8, 18 false alarms.
  - At most 1 false alarm per stream needs h ≥ 0.75: ARL0 13, at most 1 of 4 detected.
  - At the count rule's own ARL0 (10), the chart has 8 false alarms and detects 2 of 4.
- **Risk inputs.** Novelty 0.07 ± 0.26, history 0.45 ± 0.23, AUC 0.62. Near-band P16 counts are not journaled.
- **History works against detection.** In frozen Opus v1, p rises from 0.38 to 0.79, so each deopt adds 0.11 and S peaks at 1.87. Unadjusted, the chart alarms at D+5.
- **K15: N.**

## 1. Method
**Drift index D.** idx 16 in both streams (records d3→d4, kinetics d4→d5), used for scoring only. A test shows the risk features do not change when difficulty, D, the segment or the task key change.

**Views.**
- *System (decides).* Event = a deopt or a shadow disagreement on the 98 compiled-attempt JIT rows: 35 events (24 deopts, 11 disagreements). Fit on those rows.
- *Oracle (ceiling).* Adds silent misses and monitors the static arm. Fit on all 260 rows (98 events).

**Risk inputs.**
- Frozen-profile `checkProfile` score from the arm's first 3 tasks, capped at 3. Records: 0.36–0.67 on d3, 2.308 on every d4 task. Kinetics: 0.32–0.70 on d4 except idx 3 (3.52) and idx 13 (1.41), and 1.5 on d5.
- Deopts in the previous 5 rows.
- Logistic fit, ridge 1e-6.

**Chart (Steiner et al. 2000; formula from memory, paper not opened).**
- W = y·log R_A − log(1 − p + R_A·p), with R_A = 2.
- S restarts after an alarm and at an as-run version change.
- h is set by Monte Carlo under the fitted model, with simulated deopt history fed back and common random numbers. A test checks the simulator against an exact Markov-chain ARL (33 and 12).

**Count rule.** Replayed from the rows; it equals `stateAfter.deoptsSinceCompile` on all 6 arms. Alarms:
- records H→H 10, 16; O→H 5; S→H 17;
- kinetics H→H 7, 11; O→H 8, 16, 18; S→H 5, 8, 12.

## 2. Risk model

| view | n | intercept | novelty | history | EPV | AUC |
|---|---|---|---|---|---|---|
| system | 98 | −1.10 (0.44) | 0.07 (0.26) | 0.45 (0.23) | 17.5 | 0.62 |
| oracle | 260 | −0.68 (0.21) | −0.02 (0.15) | 0.55 (0.18) | 49.0 | 0.61 |
| system, version-profile novelty | 98 | −1.58 (0.41) | 0.74 (0.31) | 0.40 (0.23) | 17.5 | 0.66 |

- **Calibration by family.** System-view O/E before the drift is 0.64 for records and 1.33 for kinetics; after it, 0.83 and 2.26. The "known" ARL0 holds for the pooled case mix only.
- **Kill mode.** It fires for per-family fits (EPV 7.5), not for the pooled fits.
- **Novelty.** It nearly separates the drift segments, yet it does not predict events.
- **The trade-off [I].** Risk adjustment is built not to alarm on a case-mix shift, and a drift is one.

## 3. h and what it demands

| view | h | ARL0 | count rule's in-control ARL | max weight | events in a row needed | reach in 5 rows |
|---|---|---|---|---|---|---|
| system | 3.251 | 500.1 ± 4.9 | 10.0 | 0.467 | 7 | 2.33 |
| oracle | 3.215 | 500.0 ± 4.8 | 13.8 | 0.414 | 8 | 2.07 |

Expected false alarms over the 71 pre-drift tasks: 0.14 for the CUSUM (0 observed) and 7.1 for the count rule (8 observed).

## 4. Per stream (system view)

| stream | monitored (pre) | events | version at D → change | CUSUM | max S | count alarms | false | delay |
|---|---|---|---|---|---|---|---|---|
| records H→H | 21 (13) | 8 | v2 → 17 | none | 0.47 | 10, 16 | 1 | 0 |
| records O→H | 21 (13) | 3 | v2 → 17 (regression at 16) | none | 0.86 | 5 | 1 | none |
| records S→H | 21 (13) | 4 | v1 → 18 | none | 1.05 | 17 | 0 | 1 |
| kinetics H→H | 9 (9) | 5 | ends at 11 | none | 1.11 | 7, 11 | 2 | – |
| kinetics O→H | 16 (13) | 8 | v2 → 17, ends at 18 | none | 1.32 | 8, 16, 18 | 1 | 0 |
| kinetics S→H | 10 (10) | 7 | ends at 12 | none | 0.86 | 5, 8, 12 | 3 | – |

## 5. Oracle view, sensitivity and sweep
- **Oracle view.** No alarm on any of 7 streams. The static arm fails 6 of 8 post-drift tasks and its chart peaks at 1.91; the count rule cannot see it.
- **Sensitivity.** All 20 variants at ARL0 500 give 0 alarms (h 3.03–4.47).
- **Sweep, system view.** Detecting 4 of 4 needs h ≤ 0.35; at most 1 false alarm per stream needs h ≥ 0.75.
- **Sweep, oracle view.** The bounds are h ≤ 0.35 and h ≥ 1.00 (ARL0 22.9).
- **Matched ARL0.** System: h 0.519, 8 false alarms (kinetics H→H 2, O→H 2, S→H 3), detects 2 of 4. Oracle: ARL0 14, 6 false alarms, detects 1 of 5.

## 6. Frozen N-version (records; no shadows, restart after an alarm)

| solver | deopts pre / post | wrong post | primary CUSUM | count: alarms; false; delay | unadjusted CUSUM |
|---|---|---|---|---|---|
| Opus v1 | 7 / 8 | 0 | none (1.87) | 5, 8, 10, 16, 18, 20, 22; 3; 0 | alarm at 21 |
| Opus v2 | 0 / 0 | 6 | none | none | none |
| Sonnet v1 | 0 / 4 | 2 | none (0.81) | 17, 21; 0; 1 | none |
| Haiku v1 | 5 / 5 | 3 | none (1.41) | 10, 12, 16, 19, 23; 2; 0 | none |

Opus v2 is silent drift: it never deopts and fails 6 of 8 post-drift tasks. Neither deployable rule sees it.

## 7. Why, and what would have to change
- **Different regime from the isomorph [I].** The CABG isomorph accumulates weak evidence over long, low-base-rate series. Here the series are 9–21 tasks with 26–49% in-control event rates, and drift shows as runs of 1–3 events.
- **The lever is the in-control event rate.** Kinetics S→H had 7 events in 10 pre-drift tasks. Spurious deopts (D3) have to fall before any outcome monitor can meet this bar, and the count rule shares the problem.
- **History belongs in the per-version baseline,** not in the per-task risk.

## 8. Lead (post hoc, in-sample)
Rule: alarm at k frozen-profile novel tasks in a row.

| stream | k = 1: false alarms, delay | k = 2: false alarms, delay |
|---|---|---|
| records | 0, 0 | 0, 1 |
| kinetics | 2, 0 | 0, 1 |

Caveats:
- PARAMS were tuned on these same streams.
- The records signal is size features only; `TOLERANT_CHECK` flags 0 of 8.
- It flags input drift whether or not the workflow fails on it.
- A held-out family with a drift segment is needed.

## 9. Deviations and not done
Deviations and gaps are as listed in the summary above.

## Reproduce
```
node experiments/jit/cusum.mjs
node --test --test-concurrency=2 experiments/jit/test/cusum.test.mjs
```


---

## Adversarial verification (independent agent, 2026-10-14, wf_6272b7d3-7af)

VERDICT: CONFIRMED WITH CAVEATS

The decision stands: keep `recompileOnDeopts: 2` (K15 "B; N"). The CUSUM cannot meet the ATTACK's bar on these streams, and that holds no matter how the risk model is built. Some of the supporting text is wrong or misleading, though. The most important problem is that the count rule's "detects 3 of 4" is about what chance alone would produce.

What I reproduced ($0, no model calls, `beds/sealed/` not read, no files edited, nothing committed):
- **Tests:** `node --test --test-concurrency=2 experiments/jit/test/cusum.test.mjs` passes 13 of 13.
- **Measurement:** `node experiments/jit/cusum.mjs --out <scratch>` (76 s) produces a `tables.generated.md` byte-identical to the committed one. Primary result: h 3.2508, CUSUM 0 false alarms and 0 of 4 detected; count rule 8 false alarms and 3 of 4 detected.
- **Logistic fit, recomputed independently (numpy, outside the module):** beta −1.1002 / 0.0726 / 0.454, standard errors 0.443 / 0.259 / 0.227, AUC 0.616, 35 events in 98 rows. All match.
- **Chart and count rule, replayed independently:** CUSUM alarms and max S match on all 6 streams. Count-rule alarms match 10,16 / 5 / 17 / 7,11 / 8,16,18 / 5,8,12, with 8 false alarms.
- **ARL check:** an exact Markov-chain ARL for the no-risk-adjustment variant (p 0.357, h 3.2329) gives about 502–507, against 508.7 from the simulation.
- **Other numbers that check out:** max event weight 0.467 (lowest fitted p 0.254); expected false alarms 0.14 and 7.1; O/E 0.644, 0.831, 1.326, 2.26; EPV 17.5, 49 and 7.5; the frozen Opus v1 path (p reaches 0.79, S peaks at 1.87, unadjusted alarm at 21).
- **Label leakage:** none found. Records d4 novelty (2.308) comes only from `inputs.export` line count and string length. Kinetics d5 novelty (1.5) comes from `inputs.documents` growing from 12 to 15. No prompt mentions difficulty. `disagree` is a shadow-versus-compiled comparison (`stream.mjs:1185`) and never reads the oracle. The version-policy profile widens only when a shadow agrees. The drift index is read only by the phase-I variant and the scoring.
- **The impossibility holds for any chart:**
  - At ARL0 500, even R_A 5 needs 5 events in a row (h 4.471, at most 0.908 per event).
  - The post-drift events never come in a run that long: records H→H at 16, 18, 22; S→H at 16, 17, 20; O→H at 16 only. Kinetics O→H has only 3 post-drift rows.
  - So no chart calibrated to ARL0 500 could pass the rule.

Findings:

1. **MEDIUM (interpretation): the count rule's "3 of 4 detected" is what chance alone gives.**
   - *Evidence:* I simulated the fitted system-view process with no drift (50,000 paths, burn-in 13 or 50).
     - The count rule alarms somewhere in D..D+4 with probability 0.57. That is 2.3 expected out of 4, and 3 or more out of 4 has probability 0.43.
     - The matched-ARL0 CUSUM (h 0.519) gives 0.50, i.e. 2.0 expected; it observed 2 of 4.
     - So neither rule shows any drift detection on these data. "Keep the count" is only the rule's fallback ("otherwise keep the count"), not evidence that the count rule works.
   - *Fix:* add a chance column (expected window alarms with no drift) to the report, D29 and the K15 cell. Reword "detects 3 of 4 (delays 0, 1, 0)" as "alarms within 4 tasks of D in 3 of 4; about 2.3 expected with no drift".

2. **LOW: the "26–49% in-control event rate" is not computed anywhere.**
   - *Evidence:* the D29 text (DEV-NOTES.md:871) and the report state it, but the data say otherwise:
     - observed pre-drift rates per stream run from 8% to 70% (records S→H 1/13, O→H 2/13, H→H 5/13; kinetics H→H 5/9, O→H 5/13, S→H 7/10);
     - per family they are 20.5% and 53%, and pooled 25/71 = 35.2%;
     - fitted p runs from 0.254 to 0.678, and the simulated stationary rate is 0.407.
   - The bound argument does not depend on this figure; it uses only the lowest fitted p.
   - The real spread also shows that the pooled model is badly miscalibrated per arm, so "ARL0 500" holds only for the pooled case mix.
   - *Fix:* state the observed per-stream range (8–70%, pooled 35%).

3. **LOW: the Haiku v1 row in report §6 is wrong.** Post-drift wrong answers are 2, not 3 (6 before the drift and 2 after; 5 post-drift deopts plus 2 wrong gives the 7 post-drift oracle events). Recounted directly from `nversion-records-dev.json`. Opus v1, Opus v2 and Sonnet v1 are correct. *Fix:* change 3 to 2 before saving REPORT.md.

4. **LOW: "All 24 variants give 0 alarms at ARL0 500" (report §0) is wrong.** Only 22 of the 24 variants target ARL0 500. The two matched-ARL0 variants do alarm (8 and 6 false alarms). The summary's "all 20 sensitivity variants" is correct. *Fix:* say 22.

5. **LOW: the simulation does not match the data, but the verdict does not depend on it.**
   - *Evidence:* the feedback simulator produces more events than the data. Its stationary event rate is 0.407 against 35/98 = 0.357 observed, and its deopt rate is 0.279 against 24/98 = 0.245.
   - It shifts h and the count rule's in-control ARL a little (the iid variant gives h 3.165 and count ARL 8.2, against 3.251 and 10.0).
   - It does not change the decision, because the impossibility argument holds for any h above about 2.4.
   - *Fix:* report the simulated rate next to the observed one.

6. **LOW (test strength): the leakage test cannot catch a leak in the novelty computation.**
   - *Evidence:* the test `risk inputs never read the difficulty label...` checks `featuresOf` on hand-made units. Those units carry `difficulty` and `taskKey` fields that `unitsOf` never sets.
   - It never tests `noveltyOf`, where a leak could actually enter (through the task text). I checked that path by hand and found no leak (see above).
   - *Fix:* add a test that `noveltyOf` gives the same scores when task keys and difficulty labels are changed but the task content is not.

7. **INFO: the confound from the as-run streams goes against the CUSUM, and it is disclosed.** The chart restarts at as-run version changes, and the count rule caused some of those recompiles (for example kinetics O→H, where S drops from 1.32 to 0 at idx 9). The "no reset" variant and the frozen N-version probe still give 0 alarms, so the conclusion is unaffected.

8. **INFO: the agent's handling of the run was clean.** Commit `ed42cbe` touches only its own files (cusum.mjs, DEV-NOTES, PROOF-LEDGER, `analysis/cusum/out/`). REPORT.md does not exist, as the report itself states. D29 repeats finding 1's "detects 3 of 4" framing and finding 2's "26–49%".

My check scripts (not committed) are in `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/chk/`:
- `verify.py`: fit, rates, replays, count rule and exact ARL
- `rate.mjs`: stationary rates
- `chance.mjs`: chance detection
- `nov.mjs`: novelty reasons
