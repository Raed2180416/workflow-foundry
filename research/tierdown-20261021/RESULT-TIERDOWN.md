# RESULT-TIERDOWN (A10 / tasks #33, #42): leverage-ranked tier-down of compiled-workflow judges

Written 2026-11-04 by Claude Opus 5.5 (workflow subagent `wf_6d3b90c9-c30-9`), branch `worktree-wf_6d3b90c9-c30-9`.
Plan: [DOSSIER.md](DOSSIER.md). Preregistration: [PREREG-TIERDOWN.json](PREREG-TIERDOWN.json) (sha256 `2790ad22…dfaffd4`,
frozen before any paid call) and [AMENDMENT-1.md](AMENDMENT-1.md) (C-slice selection, rule-tier sha256s and the order,
frozen before any H call; all seven input hashes re-verified unchanged at 17:20 UTC before the H injection).

**Evidence class: development.** Every unit is an archived dev-split compiled answer (records and kinetics, seeds
201–248) from `research/jit-20261008/runs`. H is a hash-split half of that archive, held out from every choice this
item made (tiers, rules, order, thresholds). It is **not sealed** and **not a fresh draw**. No sealed row, `beds/sealed/`
path or devCheck directory was read (the archive reader refuses them, `archive.mjs` `assertDevPath`).

## 1. Answer

| question | answer |
|---|---|
| Which judge nodes matter? | A $0 counterfactual screen of all 88 archived compiled answers (88/88 replay faithfully) ranks 21 judge sites by leverage × cost share. Top: `kinetics/well-events` (Opus, leverage 0.30, 23% of judge spend), `kinetics/prose-events-a`, `records/rules`, `kinetics/extract:*`, `records/source-rules`. |
| Do cheaper tiers hold? | Not on the expensive global readers. Haiku in place of Opus/Sonnet flips pass→fail on `records/rules`, `kinetics/well-events` and `kinetics/extract:*` on both slices, and on `records/source-rules` on H. Mercury and the abstaining rule tier hold on the cheap Haiku leaf judges (0 pass→fail in 90 H site-units). |
| Preregistered policy (primary) | **Promotes nothing.** The fixed sequence stops at site 1 (`prose-events-a@haiku`: 5 zero-flip H units, needs 149). Cost saved at equal accuracy: **0%**, exactly as preregistered. |
| Exploratory provisional policy | 6 sites tiered down. On the 42 H units: **29/42 passes, the same as the reference, 0 flips either way; delivery judge USD −23.4%** ($0.0661 → $0.0507 a unit); judge latency p50 74 s → 45 s. Non-inferiority at 3 points is **not shown**: 42 units cannot show it even with zero losses (upper bound 0.069; it needs about 99). |
| Where is the money? | 88% of that saving is one site, `prose-events-a` (Opus reference → Haiku). The Mercury and rule tiers replace Haiku judges that cost fractions of a cent; they save latency (void-values 24.3 s → 2.3 s), not dollars. The dollars sit in the high-leverage readers that cheaper tiers fail. |
| Build time | Measured, not applied: 45.5% of archived build-time judge spend ($26.26 of $57.78) repeats a request an earlier run of the same arm already answered. That is 4× the archive's whole delivery judge bill ($6.46). Applying it changes what `jit-check` measures and needs an owner decision. |
| Paid spend | Haiku **$0.51** (101 calls, 0 failures), Mercury **468,965 tokens** ($0 listed; 113 calls), Jev 0 (refused: no key), total **$0.51 of $5**. |

## 2. What was built (`experiments/tierdown/`, new files; no `src/` edit)

| file | role |
|---|---|
| `archive.mjs` | archived JIT streams as material; dev-only guard (sealed, devCheck, non-dev split, seed ≥ 7001 refused) |
| `override.mjs`, `replay.mjs` | flow-v3 override hook + strict memo replay of an archived compiled answer at $0 |
| `perturb.mjs`, `leverage.mjs` | fidelity gate and one-leaf-at-a-time perturbation screen; leverage × cost share ranking |
| `classes.mjs` | leverage classes from the C slice only |
| `tier-replay.mjs` | paid node replays (Haiku, Mercury by explicit id with a run token cap, rule, memo) under `--expect-sha`; item-wide ledger caps; environment faults never scored |
| `rules/` | rule tier: country lexicon, date-order cue reader; abstains on anything unrecognised (frozen by sha256) |
| `inject.mjs` | end-to-end injection: real tier answers served through the override, every other judge at its archived answer, oracle on the output; cascade fallback on missing, abstained or check-rejected answers (charged both) |
| `policy.mjs` | Bound 1 (Clopper-Pearson), Bound 2, fixed-sequence testing, exact McNemar, non-inferiority, cascade, shadow count, CUSUM demotion |
| `analyze.mjs` | node tables, C selection, H evaluation, capability rows, `mergeInject`, `leverageCheck` (Spearman kill rule) |
| `buildmemo.mjs` | prices a build-time k-th-answer memo across runs (not applied) |
| `leafdiff.mjs` | root-cause helper: decision-leaf differences of every moved unit against the value the solver was served |
| `report.mjs` | tables below from the data files |
| `run-paid.sh`, `run-c.sh`, `run-h.sh`, `run-inject-h.sh`, `run-inject-h-provisional.sh` | detached drivers |

Tests (`nice -n 15 node --test --test-concurrency=1 <file>`, one at a time): `test/analyze.test.mjs` 10/10,
`test/lib.test.mjs` 12/12, `test/rules.test.mjs` 6/6, `test/replay.test.mjs` 1/1 (real sandboxed replay of an archived
row with `TIERDOWN_RUNS` pointing at the archive). All pass. Tests with teeth include these: a decisive perturbation
must flip the oracle, and a check-rejected served answer must fall back. An incomplete unit must never be scored as
the reference. A reordered list must not count as a difference. A Mercury request must carry `max_tokens` equal to the
provider's reservation (F2).

## 3. Phase 0 ($0): fidelity and leverage

- **Fidelity gate.** 88 of 88 archived compiled answers replay faithfully under flow-v3 with the strict memo (dossier
  target was 70 of 74 plus R0). Unmeasured perturbations (a changed value alters a later prompt, so the memo misses): 7
  of 76 on `records/rules` and 19 of 120 on `kinetics/doc-units`; every other site 0.
- **Ranking** ([data/leverage.md](data/leverage.md)): leverage × cost share puts `kinetics/well-events` (0.070),
  `kinetics/prose-events-a` (0.018), `records/rules` (0.015), `kinetics/extract:*` (0.009) and `records/source-rules`
  (0.006) first. Ten sites went to the paid phases (the PREREG table).
- **Kill rule** (dossier §5: drop the synthetic screen if its ranking disagrees with injected outcomes). Spearman between
  the C-slice screen flip rate and the rate at which real cheaper-tier answers moved the outcome (C and H, all model and
  rule tiers): **ρ = 0.53** over 10 sites ([data/leverage-check.json](data/leverage-check.json)). The screen is kept,
  but only just. The outlier is `kinetics/extract:*`: screen 0.06, injected 3 of 5 moved. The screen changes one leaf at
  a time, while a cheap extractor's errors span many leaves at once (D9 on H: 30 events against 5). **One-leaf
  perturbation understates the risk of extractors.**

## 4. Node replays (agreement on decision leaves; tolerant numbers; evidence stripped)

H slice (C in [data/select-C.json](data/select-C.json) and `report.mjs`). Cost is per decision, a k-sample reference
charged k times. Latency is the call's own.

| site | tier | answered | usable | mean leaf agreement | tier $/decision | ref $/decision | tier p50 | ref p50 |
|---|---|---|---|---|---|---|---|---|
| kinetics/extract:* | haiku | 30 | 30 | 0.847 | $0.0067 | $0.0270 | 38.0 s | 28.4 s |
| kinetics/prose-events-a | haiku | 5 | 5 | 0.964 | $0.0081 | $0.1224 | 52.6 s | 84.9 s |
| kinetics/well-events | haiku | 2 | 2 | 0.683 | $0.0073 | $0.1481 | 48.5 s | 26.5 s |
| records/rules | haiku | 8 | 8 | 0.956 | $0.0016 | $0.0374 | 11.6 s | 8.7 s |
| records/source-rules | haiku | 7 | 7 | 0.953 | $0.0036 | $0.0246 | 13.5 s | 14.7 s |
| records/source-rules | mercury | 3 | 1 | 0.864 | $0 | $0.0025 | 17.9 s | 9.9 s |
| records/date-order | mercury | 8 | 8 | 1.000 | $0 | $0.0017 | 1.3 s | 13.8 s |
| records/date-order | rule | 8 | 7 (1 abstain) | 0.952 | $0 | $0.0017 | 0.0 s | 13.8 s |
| records/void-values | mercury | 8 | 8 | 1.000 | $0 | $0.0029 | 2.3 s | 24.3 s |
| records/vendex-entries | mercury | 15 | 15 | 0.996 | $0 | $0.0024 | 9.5 s | 13.1 s |
| records/countries | mercury / rule | 8 / 8 | 8 / 8 | 1.000 / 1.000 | $0 | $0.0004 | 2.1 s / 0.0 s | 3.1 s |
| records/country-names | mercury / rule | 16 / 16 | 16 / 16 | 0.984 / 1.000 | $0 | $0.0002 | 1.2 s / 0.0 s | 1.7 s |

The memo tier answered 0 of 211 delivery decisions (C and H); see F9. Haiku had 101 calls with 0 failures. Mercury had
107 usable answers in 113 calls.

## 5. Selection on C, then promotion on H

**C selection** (AMENDMENT-1, mechanical): the order was prose-events-a@haiku, source-rules@haiku, void-values@mercury,
date-order@mercury, vendex-entries@mercury, countries@rule, country-names@rule. The following were not selected and keep
their reference tier:

- `records/rules`: Haiku fails Bound 2 (disagreement 0.062, 1 pass→fail plus 2 deopts in 11 units); Mercury usable 3/5.
- `kinetics/well-events`: Haiku disagreement 0.231 and 2 pass→fail in 3 units.
- `kinetics/extract:*`: Haiku disagreement 0.115 and 1 pass→fail in 2 units.

**H, primary (preregistered).** Fixed sequence at α = 0.05. Site 1, `prose-events-a@haiku`, has 0 pass→fail in 5 units.
Its Clopper-Pearson upper bound is 0.45, above δ = 0.02. So the verdict is keep-reference, and the sequence stops; the
other six are not tested. This was the stated prediction: the largest per-site H count is 16, and the zero-flip unit
counts needed are 29, 59 and 149.

**H, provisional (exploratory, labelled as such).** A pair is kept if it has zero H pass→fail flips and holds Bound 2 on
H. Six of seven are kept. `records/source-rules@haiku` is dropped: 1 pass→fail (s223) and 1 fail→pass (s222) on 7 units.
Units per kept pair: prose-events-a 5, void-values 8, date-order 8, vendex-entries 15, countries 8, country-names 16. A
second $0 pass injected the six together ([data/inject-H-provisional.json](data/inject-H-provisional.json)).

## 6. Capability vs the simple baselines (H, 42 units: 28 records + 14 kinetics; dev, held out)

Delivery judge USD per unit: archived list-price cost for reference answers, measured cost for tier answers, fallback
answers charged twice. Latency is the sum of a unit's judge latencies, not wall clock. NI means non-inferior at a
3-point margin: the one-sided 95% upper bound on the loss rate, minus the observed gain rate, must be < 0.03.

| arm | units | passes | accuracy | vs ref | p→f / f→p | McNemar p | NI | judge $/unit | **cost saved** | judge latency p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| **B-ref** (solvers as compiled) | 42 | 29 | 0.690 | — | — | — | — | $0.0661 | 0 | 74 / 251 s |
| **primary policy** (preregistered) | 42 | 29 | 0.690 | 0 | 0 / 0 | 1 | n/a | $0.0661 | **0%** | 74 / 251 s |
| **provisional** (exploratory) | 42 | 29 | 0.690 | 0 | 0 / 0 | 1 | not shown (0.069) | $0.0507 | **23.4%** | 45 / 251 s |
| selected (all 7 C picks, exploratory) | 42 | 29 | 0.690 | 0 | 1 / 1 | 1 | not shown (0.084) | $0.0472 | 28.7% | 38 / 251 s |
| B-screen (0.98 leaf agreement, no leverage) | 42 | 29 | 0.690 | 0 | 0 / 0 | 1 | not shown (0.069) | $0.0646 | 2.4% | 62 / 251 s |
| B-all-haiku | 42 | 25 | 0.595 | **−9.5 pt** | 5 / 1 | 0.22 | no (0.210) | $0.0332 | 49.9% | 56 / 393 s |
| B-all-mercury | 28 (14 incomplete) | 18 | 0.643 | 0 | 0 / 0 | 1 | not shown (0.101) | $0.0672 | 3.3% | 79 / 330 s |
| B-sink (reference on global readers) | 42 | 27 | 0.643 | **−4.8 pt** | 2 / 0 | 0.50 | no (0.142) | $0.0620 | 6.3% | 61 / 393 s |
| B-memo | 42 | 29 | 0.690 | 0 | 0 / 0 | 1 | not shown (0.069) | $0.0661 | 0% | 74 / 251 s |

**Reading.**

- The preregistered capability number is **0% cost saved at equal accuracy**. It is a correct result of a test that
  could not pass on this archive.
- The exploratory provisional policy matches the reference on all 42 paired units at −23.4% delivery judge cost, 10× the
  B-screen saving. It is not a demonstrated non-inferiority.
- The simple "Haiku everywhere" baseline halves the bill but loses 9.5 points. "Frontier only on the global readers"
  (B-sink) loses 4.8 points too, because the per-document kinetics extractors are not global readers but are just as
  fragile (2 pass→fail).
- B-all-mercury is incomplete: Mercury `records/rules` and `kinetics/well-events` were never asked on H, because the
  token share was spent (F12).
- Absolute size: $0.65 saved over 42 units. In this archive the delivery judges are 10% of judge spend; the build-time
  judges are 90%.

## 7. Failures, root-caused

**F1. The primary policy promotes nothing (design limit, predicted).**
- Per-site H counts are 2–16. Bound 1 needs 29 / 59 / 149 zero-flip units for δ = 0.10 / 0.05 / 0.02.
- Root cause: the archive holds 42 H units across two families. A held-out slice cut from it cannot carry preregistered
  per-site bounds.
- Pooling C and H would give `records/country-names@rule` 35 zero-flip units (≥ 29). It is still inadmissible: the rule
  was written from C.
- Fix: a fresh held-out draw sized to the class (the dossier's seeds 701–760 plus a live reference run, ≤ $30). The
  alternative is a cascade whose verified check takes the burden off δ (§8).

**F2. The preregistered Mercury cap of 450,000 tokens overshot by 18,965 (4.2%), reaching 468,965.**
- It stayed under the 0.5M-per-item and D18 envelopes.
- Root cause: `src/models/providers/openai-chat.mjs` reserves `input + 8,000` output tokens per call (L69) against the
  run cap. But when the caller sets no `maxTokens`, it sends no `max_tokens` (L56), and the endpoint then lets a call
  bill up to about 24K completion tokens.
- Pass 4 on H shows it: a 44,222-token cap was charged 63,187 tokens by 3 calls, 2 of them truncated at about 23.7K.
- Fix (forward; no answer in the data was asked with it): `tier-replay.mjs` `decodingFor` sends `maxTokens` 8,000 for
  Mercury, so projection equals enforcement, and a test pins it. Handed to the Mercury track (#73): the provider itself
  should send `max_tokens` equal to its allowance whenever it reserves one.

**F3. Mercury `MODEL_TRUNCATED` on `records/source-rules` (4 of 8 asked, C and H).**
- Observed ([data/model-failures.json](data/model-failures.json)):
  - The visible text is 460–587 characters, a nearly closed JSON object whose quotes are cut mid-phrase (`"A"`,
    `"Do not read "`, `""`).
  - Billed completion tokens are 23,507–23,871, of which 1,442–4,483 are reported as reasoning.
  - So about 19–22K billed tokens are neither visible nor reported. The usable answers at this site billed 1.6–4.7K.
- Root cause on our side: none. The request is the same as for the usable answers. The cause inside the endpoint cannot
  be determined from here [I: hidden generation that is not reported].
- **Correction:** AMENDMENT-1 §4 says "Mercury writes long answers". That is wrong: the visible answers are short, and
  only the billed count is long.
- Effect: Mercury is unusable at this site (usable 0.60 on C), which excluded it before H.

**F4. Mercury `MODEL_SCHEMA` on `records/rules` (2 of 5 on C).**
- The request asked for strict `json_schema`. Mercury returned `void_markers` items without the required `system` key.
- Observed: Mercury's strict structured output does not enforce a nested `required`. The provider validated the output
  locally and refused it, so nothing was silently accepted.

**F5–F6. The decisive leaf on records is one system's date order, and three judge sites re-read it.**
Every Haiku-caused outcome change on records comes down to the date order of one system (ATLAS or BRIGHTDESK). Leaf
diffs are against the value the solver was served ([data/leafdiff-C.txt](data/leafdiff-C.txt),
[data/leafdiff-H.txt](data/leafdiff-H.txt)).
- `rules@haiku` C: 2 deopts of kind `invariant`. On s212, `date_order/ATLAS` is the only differing leaf, so the
  solver's invariant guard caught the misread [I: as an inconsistency with the switch list].
- `rules@haiku` C: 1 pass→fail (s208), `date_order/BRIGHTDESK`.
- `rules@haiku` H: 1 pass→fail (s223). Haiku flipped `date_order/ATLAS` **and** `date_order_switches/0/order_from`
  consistently, so the invariant passed and the wrong reading went through. **A consistency guard cannot catch a
  consistent misreading.**
- `source-rules@haiku` C: 1 deopt on `atlas_numeric_dates`.
- `source-rules@haiku` H: the same two leaf changes on s222 and s223 (`atlas_numeric_dates` DMY_then_MDY → MDY_then_DMY,
  and void markers without the `:: ` prefix). They flipped s222 fail→pass and s223 pass→fail. The reference itself is
  wrong on s222.
- The date-order site shows the same pattern (C): Mercury and the rule each turned fail→pass where the Haiku ×5 vote
  read BRIGHTDESK or ATLAS as DMY (AMENDMENT-1 notes).
- This is the N3 near-tie, now located: one leaf carries the records family's leverage, the reference tier is not
  ground truth on it, and agreement with the reference (Bound 2) penalises a tier for being right (F11).

**F7. `kinetics/well-events@haiku`: 3 pass→fail in 5 units (C + H).**
- Root cause: omission in a long global list. On s233 Haiku drops one of two temperature-excluded wells (`OB-0186`)
  and the whole 9-sample relabel group. On s235 it splits the one relabel group into four.
- It is a recall failure on the tail of a document-wide reader, so this is a frontier-tier node.

**F8. `kinetics/extract:*@haiku`: 3 pass→fail in 5 units.**
- Root cause: over-extraction and kind misclassification. One document yields 30 events against 5, with reader flags
  read as events.
- The solver's own check rejected 1–3 answers per unit, which fell back to the reference. It accepted the rest, which
  were wrong in ways the check does not test. The check covers schema and quotes, not event recall.

**F9. The memo tier never answered at delivery (0 of 211 decisions).**
- Root cause: each compiled solver writes its own judge prompts, so two arms almost never send an identical delivery
  request. The archive holds 21 such cross-run repeats in 852 delivery calls ($0.002).
- The repeats live at build time (45.5% of build spend, §1). The dossier expected this.

**F10. Jev not measured.** `FOUNDRY_SYSTEMONE_API_KEY` is not provisioned in this session, so the tier was refused before
any call (PREREG). This is a blocker, not a result. Jev's errors correlate with Claude's (phi 0.61), which already made
it a weak cascade partner.

**F11. Bound 2 measures agreement with a reference that is wrong on the decisive leaf.**
- The date-order rule (C: 2 fail→pass, disagreement 0.083) was excluded by the preregistered yardstick.
- On H it has 8 units, 0 flips and 1 abstention: VENDEX has no date-order cue, so that unit fell back to the reference.
- Kept out of the policy as preregistered. The next preregistration should score the decisive leaf against the
  **oracle** (pass/fail), not against the reference answer.

**F12. Incomplete baselines.** B-all-mercury leaves out 14 of 42 units. Mercury was never asked `records/rules` or
`kinetics/well-events` on H: the H token share went first to the selected sites (AMENDMENT-1 §4), and the per-run cap then
refused (`MODEL_BUDGET`). Incomplete units are counted, never scored as the reference (clarification 3).

**F13. Own tool defect, found and fixed.**
- The first `leafdiff.mjs` took "the first archived delivery answer to the identical request" as the reference.
  `source-rules` escalates, so that is a Haiku draft, not the served Sonnet/Opus answer. The tool showed 0 differences
  for a unit with agreement 0.903.
- It now replays the row and diffs against the served value, the same reference `tier-replay.mjs` scores against.
- A known caveat is documented in the tool: the multiset sort can misalign list items after the first change.

## 8. Deviations from the dossier (with reasons)

| dossier | done | reason |
|---|---|---|
| H = fresh dev seeds 701–760 plus a live reference run (≤ $30) | H = hash-split half of the archive | The item budget was ≤ $5. The cost is F1: H is too small for the preregistered bounds. |
| Jev tier for enum leaves | refused | no key (F10) |
| Rule synthesis by Opus (≤ $5) | rules written by the session's frontier author from C requests only, $0 marginal | Same model role, no API call. Frozen by sha256 before H. |
| Mercury ≤ 0.4M tokens | cap 450K preregistered, 468,965 used | F2 |
| Build-time memo config | priced (`buildmemo.mjs`), not applied | It changes what `jit-check` measures, so it needs an owner decision (dossier §4.5). |
| A1-C node-level verdict accuracy from the dev60 transcripts | not done | Out of this item's time. It stays with the A1-C v2 track. The dossier's finding (Mercury checker 17/28 against Haiku 9/25) is unchanged and unreplicated here. |

## 9. Honest reading and next steps

1. **The plan works, and the capability claim is not earned yet.**
   - The $0 counterfactual substrate works: 88/88 faithful, injection without D11's re-sampling confound, and
     leverage-ranked sites.
   - The data say cheaper tiers are safe on the cheap leaf judges and unsafe on the expensive global readers.
   - Tier-down at delivery time is therefore worth little in dollars on these families (≤ 23% of a bill that is 10% of
     judge spend), unless a frontier-priced node asks an easy question, as `prose-events-a` did.
   - It is worth more in latency: Mercury and the rules are about 10× faster on the sites whose reference is a Haiku ×5
     vote (void-values, date-order), and 1.4–1.5× on the single-answer sites.
2. **Leverage concentrates in leaves, not nodes.** On records, one leaf decides most outcomes: a system's date order. A
   node-level tier choice is too coarse. Next: route the decisive leaf to its own reader, a cascade of the rule (which
   abstains) and Mercury cross-checked against Haiku, with escalation only on disagreement. Everything else in the
   global reader can then go to the cheap tier. Score it against the oracle, not the reference (F11).
3. **The real money is at build time.**
   - A k-th-answer memo across runs prices at 45.5% of build-time judge spend in this archive.
   - Check-time judge calls are 31% of all judge spend, and 54.5% of that spend is cross-run repeats.
   - An owner decision on memoised checks (it changes what `jit-check` measures) is worth more than any delivery-time
     tier-down measured here.
4. **To earn a preregistered promotion,** draw a fresh held-out set sized to the class: ≥ 29 units per low-leverage site
   (country, vendex) is cheap, while 149 per high-leverage site is not. Either cascade the high-leverage sites behind an
   oracle-grade check, or keep them at the reference.
5. **Mercury:** usable and fast on short enum and map questions (void, date, countries, vendex), with 0 pass→fail. On
   long structured outputs it truncates (F3) and is non-strict (F4). Hand-offs to #73: F2, F3 and F4.

## 10. Reproduce ($0 from the committed data)

```
nice -n 15 node experiments/tierdown/analyze.mjs evaluate --prereg research/tierdown-20261021/PREREG-TIERDOWN.json \
  --selection research/tierdown-20261021/data/select-C.json \
  --answers research/tierdown-20261021/data/answers-H.jsonl,research/tierdown-20261021/data/answers-H-rule.jsonl \
  --inject research/tierdown-20261021/data/inject-H.json,research/tierdown-20261021/data/inject-H-provisional.json --out /tmp/eval-H.json
nice -n 15 node experiments/tierdown/report.mjs research/tierdown-20261021/data
# injection and leaf diffs replay the archive (read-only): TIERDOWN_RUNS=<main tree>/research/jit-20261008/runs
TIERDOWN_RUNS=... bash experiments/tierdown/run-inject-h.sh
```

Data ([data/](data/)): `leverage.json`/`.md` (screen), `classes-C.json`, `answers-{C,H}{,-rule}.jsonl` (+ `.runs.jsonl`
ledgers), `inject-C.json`, `select-C.json` (frozen), `inject-H.json`, `inject-H-provisional.json`, `eval-H.json`,
`leverage-check.json`, `buildmemo.json`, `model-failures.json`, `leafdiff-{C,H}.txt`.
