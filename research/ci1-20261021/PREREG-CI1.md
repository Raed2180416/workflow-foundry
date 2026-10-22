# PREREG-CI1: corpus-based construction tests with leave-one-out pattern retrieval

*Written 2026-10-22 before the first test-split builder call. The freeze is [MANIFEST.json](MANIFEST.json), sha256
**`39bf40bd420be14b4b666f5d5e9c0ceb4cb03a85d9c87774a2b0578ebb19def6`** (163 files: 121 bed files by digest, the retrieval index, the arm
code, templates, policy), checked by `experiments/ci1/run-arm.mjs` before any test-split run: a changed frozen file refuses the run.
Development evidence before this point: dev round 1 (`runs/dev1-*`, 5 dev items × 1 build per arm, $0.13), the smoke and control
runs (`runs/dev-*`). Plan and research: [DOSSIER.md](DOSSIER.md). Owner asks E6 and A8 (research/REQUIREMENTS-COVERAGE-20261021.md).*

## 1. Question

Can a cheap model (Haiku 5.5) build, from a person's description alone, a workflow whose **effects equal those of a real corpus
workflow on hidden seeded worlds**, and do (a) BUILDER-1's frontier-written templates, (b) a compose path with a code-owned practice
loop, and (c) leave-one-out retrieval of corpus patterns raise that rate over a one-shot baseline?

## 2. Bed (frozen)

- **Items:** 24 n8n.io templates (`research/ci1-20261021/SPLIT.json`): 5 dev, 19 test. Each item: the corpus graph (plus documented
  patches of placeholders and data-loss defects, `spec.json`), a seeded world generator, a natural-language description written by the
  bed author (Opus 5.5) after reading the source, an independent Foundry transliteration, and an oracle.
- **Reference 1** is the corpus graph run by n8n-sim (`experiments/ci1/sim/`, corpus code only inside `src/sandbox.mjs`). **Reference 2**
  is the transliteration. An item is admitted only when both agree on every one of 32 candidate worlds (two-reference gate) and reruns
  are deterministic. References are "shim interpretations": stand-in semantics, not n8n itself.
- **Worlds:** 32 candidates per item; mutants of the reference (flipped/shifted conditions, branch swaps, skipped steps, dropped or
  duplicated effects, swapped recipients, changed constants) are run on each; a greedy cover picks the hidden worlds that kill the most
  mutants (at least 6, at most 8, at least one with outside effects) and one public world from the rest.
- **Oracle** (`experiments/ci1/canon.mjs`, `bed.mjs scoreBuilt`): a build passes an item only when, **in every hidden world**, its
  effects are equivalent to the reference's: the same number of e-mails per recipient, chat posts per channel and answers to the caller;
  every message carries every fact of the reference message (a token that is not written in the reference definition: names, ids,
  amounts, dates, counts, addresses, URLs); no message mentions a world row the reference message leaves out; final sheet rows equal as
  multisets on the reference's columns (cells normalised); JSON answers equal (prose leaves by facts). Wording is free; over-reach fails.
- **Description gates** (`experiments/ci1/gates.mjs`): no source node name (≥ 2 words, ≥ 12 characters, triggers exempt), no n8n
  vocabulary in prose, not the template title, ≤ 0.10 word-8-gram overlap with the creator's description and sticky notes. All 24 pass.
- **Validity gates measured at freeze** (`runs/freeze-*`, $0): REF (the transliteration) passes **24/24** items (19 test, 5 dev);
  EMPTY (a workflow with no effects) passes **0/24**; every reference reran identically; the hidden worlds kill every killable mutant
  of every item; surviving (never-killed) mutants are audited for equivalence in RESULT-CI1.md §2.

## 3. Arms (code frozen by the manifest; model ids from `policy/models.json`)

Every arm sees the same request (the description), workspace (trigger, sheets with columns, channels, mailboxes) and, except A1, the same
capability list, IR rules and workflow schema (`experiments/ci1/prompt.mjs`). A built workflow runs in the Foundry engine with the CI-1
registry (BUILDER-1's stand-ins + `sheet.update`, `sheet.upsert`, `reply.send`). Questions get the item's answer key or a fixed
fallback (all 24 keys are empty: the descriptions are meant to be complete), at most 2 rounds.

| Arm | Model | What it is | K (test) |
|---|---|---|---|
| **A0** | claude-haiku-5-5 | One call writes the workflow (BUILDER-1's B0 on the CI-1 world); one validator repair; may ask or refuse. **Simple baseline.** | 3 |
| A0t | claude-haiku-5-5, reasoning `medium` | A0 with thinking on. | 3 |
| A1 | claude-haiku-5-5 | BUILDER-1's template builder, code unchanged since `research/surface-20261021/eval/MANIFEST-fix.json` (7 templates; select → fill → practice → repair); workspace appended to the request. | 3 |
| A1c | claude-haiku-5-5 | Templates whose data contract the workspace cannot satisfy are not offered (code check); with none left, the model composes the workflow from the shared blocks plus two frontier-written worked examples (`experiments/ci1/library/examples.json`), then a code-owned loop: strict validation → practice run in the item's **public** world → the model reviews what its workflow did there against the request and accepts or returns a fix; ≤ 3 repair rounds; delivers the last workflow that ran if no review accepted. | 3 |
| **A2** | claude-haiku-5-5 | A1c + leave-one-out corpus retrieval (`experiments/ci1/retrieve.mjs`): the top 3 pattern cards (corpus-derived L1 catalog + frontier-written IR realisation hints) and top 3 corpus exemplar skeletons (structure only) from 479 model-free n8n templates; never the target, an item with the same structure hash or Jaccard ≥ 0.6 on WL features, or an item by the target's author; masked-request BM25 + shape rerank, re-retrieved with the draft's shape on repair rounds. | 3 |
| A2-M | mercury-3 | A2 on Mercury 3, K = 1, on the first 5 test items in SPLIT order only (14177, 17545, 16364, 17342, 17878): this item's Mercury allowance is 0.5M tokens and dev used about 130K; exploratory. | 1 |

The optional Opus one-shot arm is **not run** (no budget line for it in this item).

## 4. Measures

- **Primary capability number:** per arm, the share of the 19 test items whose built workflow passes the oracle, as **pass@1**
  (per item, passes / K, averaged over items) with a 95% item-clustered percentile bootstrap interval (10,000 resamples, seed
  20261022), and **pass^3** (all K builds pass).
- **Primary test:** A2 vs A0, paired by item (difference of per-item pass@1; bootstrap interval; exact two-sided sign test).
- **Secondary:** A2 vs A1c (retrieval), A1c vs A1 (composition), A1 vs A0 (templates vs one-shot, BUILDER-1 on independent items),
  A0t vs A0 (thinking).
- **Also reported:** cost per build and per verified build, tokens, outcomes (ready / unsupported / build_failed / error), questions,
  repairs and reviews, failure classes per failing build (root-caused), template fit, retrieval exclusions, which retrieved patterns
  co-occur with passes, and the post-cutoff stratum (items created on or after 2026-07-01: 14 of 19 test items; pre-cutoff 14177, 16364, 15238, 11679, 16312) separately.
- **Pattern attribution** (budget allowing): on each test item where A2's pass@1 exceeds A1c's, rebuild A2 with each retrieved
  pattern card removed in turn (K = 1) and report which removal loses the pass (exploratory).

## 5. Predictions (written now)

- Template fit: **0 of 24** items satisfy any template's data contract (measured at $0: `templateFitsData`), so **A1 ≤ 5%** pass@1
  (the dossier's 20-40% assumed templates could bind the item's data; they cannot).
- A0: 45-70% pass@1 (dev: 3/5; its dev failures were runtime errors a practice run would catch).
- A1c: 60-85%. A2 − A1c: between −5 and +10 points (the descriptions are complete specifications, so retrieval has little to add).
- A2 − A0: +5 to +25 points.
- **Park rule (dossier):** if A2 − A1c ≤ 3 points and the upper bound of its 95% interval is below 10, retrieval is parked and the
  negative result kept.

## 6. Run rules

- Test runs only against the frozen manifest (`run-arm.mjs` refuses otherwise). Dev runs are labelled `dev*`, test runs `test*`.
- Paid runs are detached from a script file (`experiments/ci1/run-detached.sh`). Environment faults (rate or session limits, an
  unreachable provider, a provider timeout) are recorded under `faults/`, never scored; the run waits 30 minutes and resumes.
- Caps: Haiku arms ≤ $10 in total for this item (dev included); per test arm cap $2 (A0, A1), $3 (A1c, A2, A0t). Mercury: test run
  token cap 330K, ≤ 0.5M for the item including dev. The test runs are launched by `experiments/ci1/test-run.sh`.
- Records (built workflows, effects) stay outside git (`/var/tmp/foundry-work/ci1-20261021/runs/`); committed summaries carry scores,
  costs and failure reasons, with any non-synthetic e-mail address redacted.
- A bed defect found after the freeze is reported, never silently fixed; a corrected rescore is labelled post hoc.

## 7. Limits stated in advance

One author wrote the descriptions, references, worlds and oracle: the test split is held out from builder development, not sealed.
The items are the deterministic, model-free slice of n8n templates (test median 8 nodes, 7-15; 12 of 19 with Code nodes); nothing here speaks to agent workflows. 19 test
items detect only large differences. Memorisation of pre-cutoff templates is possible (5 of 19 test items).
