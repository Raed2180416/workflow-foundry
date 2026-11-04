# Swarm ladder, rung 1: result (D3)

*2026-11-04. Preregistered in [PREREG-SWARM-R1.md](PREREG-SWARM-R1.md) and frozen by [FROZEN-R1.json](FROZEN-R1.json)
before any paid call of the rung; two amendments, both after the held-out stage and both disclosed below. Research:
[DOSSIER-SWARM.md](DOSSIER-SWARM.md). Spend: **$7.60 of the $8.00 Haiku cap**. No Opus, Sonnet or Mercury call;
`beds/sealed/` never read. Tags: **[M]** measured here; **[I]** inference; **post-hoc** = not preregistered.*

## 1. Answer

**On this bed, a plain Haiku swarm does not swarm, and it gains nothing over a single Haiku agent.**

- **The swarm never delegated.** The swarm lead started **0 workers in 8 of 8 sessions** (1 dev, 7 held-out) [M].
  - The CLI recorded `subagent_stats.spawned = 0`.
  - The lead's own closing text says it "did the work myself with a script rather than delegating".
  - This is Kimi's "serial collapse": an orchestrator that is not trained against it does not fan out.
- **S and A tie on pass rate.** On 7 held-out tasks the swarm arm S and the single agent A each passed 4/7.
  - McNemar exact p = 1.
  - Mean oracle score difference S − A = +0.019, 95% CI −0.079 to +0.119.
  - Because S never used a worker, this measures the preamble and sampling noise, not swarming.
- **The forced swarm (rung 1b, exploratory, one task) did fan out, and was not better.**
  - It started 9 workers on the task both A and S had passed.
  - It failed by one cell and cost 2.1× S.
- **The Haiku-built fixed workflow W failed every held-out task: 0/7, mean score 0.44, $0.07 per task.**
  - It was built on dev probes.
  - It hard-coded the dev split's document-type list.
  - It never read the test split's "Technical report" documents, even though the prompt names that kind.
- **The simple baseline is strong.** A single Haiku agent with tools passed **4/7 held-out d5 tasks** at $0.44 per trial.
  - One Haiku call passes 0/12 at d5 (need-router M1, dev seeds 379–390).
  - The agent scripts its own parser.
- **For D3, the answer is "in scope as a measured option, not as a default".**
  - A swarm only helps when one context is actually degraded, and on this bed scripting removes that need.
  - The next rung should guard the single agent (code ranker, code void detection, code coverage plan), not add workers (§8).

## 2. What ran

| stage | split | seeds | arms | status | spend |
|---|---|---|---|---|---|
| capability probe (earlier session) | toy | none | Agent tool in the sandbox | diagnostic | $0.0044 |
| W build | dev d5 | 365–367 | Haiku builder (`construct` B1, effort high) | development | $0.394 |
| calibration | dev d5 | 368 | A, S, W | dev / diagnostic | $0.636 |
| held-out | test d5, tier novel-test | 9301–9307 (N = 7) | A, S, W | held-out | $5.807 |
| rung 1b (Amendment 1) | test d5 | 9301 | S-F | exploratory | $0.761 |

- **N.** The §6.2 rule set N = 8 from the calibration block cost ($0.636).
- **Guard stop.** The §6.3 runtime guard stopped before seed 9308, with $1.16 left against a $1.41 block bound. So 7
  complete blocks were run.
- **Faults and drift.** No environment fault. No model drift: every message on every trial was served by
  `claude-haiku-5-5`.
- **Decidability.** The text-only decidability witness agrees with the oracle on all 7 held-out tasks, so no failure is a
  grader fault.

**Amendments** (full text in the prereg):

1. **Amendment 1: rung 1b, exploratory.**
   - Added because S never delegated.
   - The new arm S-F is arm S plus a task-agnostic fan-out rule.
   - It ran on the first k rung-1 held-out tasks, with k = 1 by the amendment's budget rule.
   - Committed (01221415) before its only call.
2. **Amendment 2: the void rule, analysis only.**
   - The frozen rule voided **10 of 14 held-out A and S trials**, which left **0 complete blocks** and crashed the frozen
     analysis on an empty set.
   - Every flagged path is sandbox-private:
     - 38 are files or directories the session created itself under `/var/tmp`;
     - 11 are the CLI's own tool-result spill files;
     - 3 are the tmpfs directory above the session's own workdir.
   - `void-audit.mjs` classifies each path. Under the audited rule no trial is void.
   - The frozen rule's outcome is reported (`frozenRule` in SUMMARY-R1.json).

## 3. Capability table (held-out, N = 7 paired tasks, K = 1)

| arm | who decomposes | pass | Wilson 95% | mean score | cells right | missing compounds per task | excluded set right | cost per trial | cost per pass | median / max wall |
|---|---|---|---|---|---|---|---|---|---|---|
| **A** single Haiku agent (baseline) | nobody | **4/7** | 0.25–0.84 | 0.884 | 0.939 | 0.86 | 4/7 | $0.437 | $0.765 | 607 / 747 s |
| **S** Haiku swarm (Agent tool offered) | a model at run time; **in fact, nobody (0 workers)** | **4/7** | 0.25–0.84 | 0.902 | 0.961 | 0.29 | 4/7 | $0.321 | $0.562 | 420 / 677 s |
| **W** Haiku-built fixed workflow | code at build time | **0/7** | 0–0.35 | 0.444 | 0.533 | 4.14 | 0/7 | $0.071 (+ $0.394 build) | none | 213 / 252 s |
| *S-F forced swarm (rung 1b, 1 task, exploratory)* | *a model, 9 workers* | *0/1 (score 0.992)* | | | | *0* | *1/1* | *$0.761* | | *561 s* |
| *one Haiku call (need-router M1, dev 379–390, earlier)* | *nobody* | *0/12 at effort medium* | | *0.81 mean on the dev gate* | | | | *$0.24–0.32* | | *260–340 s* |

**Paired comparisons** (frozen analysis, amended void rule):

| comparison | discordant pairs (first arm only / second arm only) | McNemar p | pass difference, 95% bootstrap | score difference, 95% bootstrap | cost-per-success ratio |
|---|---|---|---|---|---|
| S vs A (primary) | 1 / 1 | 1.00 | 0.00 (−0.43, +0.43) | +0.019 (−0.079, +0.119) | 0.74 (0.30, 1.69) |
| W vs A | 0 / 4 | 0.125 | −0.57 (−0.86, −0.14) | **−0.440 (−0.554, −0.338)** | W has no passes |
| S vs W | 4 / 0 | 0.125 | +0.57 (+0.14, +0.86) | **+0.458 (+0.381, +0.514)** | W has no passes |

None of these is confirmatory (§4 of the prereg: that needs McNemar p < 0.05).

- **W versus A and S.** The score gaps are large and their intervals exclude 0. On every task W scores below both A and
  S.
- **S versus A.** No difference is detectable. S was cheaper per trial (−27%) and faster (median −31%), but the
  cost-per-success interval spans 1.

### Per task

| seed | policy | A | S | W |
|---|---|---|---|---|
| 9301 | P2 | **pass** $0.71, 646 s | **pass** $0.36, 371 s | 0.465, $0.07 |
| 9302 | P1 | **pass** $0.46, 526 s | 0.761, $0.23 | 0.323, $0.07 |
| 9303 | P3 | **pass** $0.33, 747 s | **pass** $0.54, 677 s | 0.501, $0.07 |
| 9304 | P3 | 0.745, $0.37 | 0.720, $0.38 | 0.471, $0.08 |
| 9305 | P1 | 0.607, $0.22 | 0.834, $0.15 | 0.332, $0.07 |
| 9306 | P2 | **pass** $0.55, 745 s | **pass** $0.32, 399 s | 0.459, $0.07 |
| 9307 | P2 | 0.834, $0.43 | **pass** $0.27, 421 s | 0.559, $0.06 |

### Dev calibration (seed 368; cost only, never a capability claim)

| arm | outcome | score | cost | wall | what failed |
|---|---|---|---|---|---|
| A | fail | 0.992 | $0.337 | 499 s | one cell ranked by recency instead of policy P3 |
| S (0 workers) | fail | 0.842 | $0.201 | 317 s | a preprint kept although its journal version replaces it (one cell), and that void preprint left out of `excluded_doc_ids` |
| W | fail | 0.936 | $0.098 | 217 s | one compound split into two keys: the model put the code in the name field, and `compoundKey()` lower-cased it into a `name:` key |

W scored 0.936 on dev and 0.444 on held-out. §5.3 explains the gap.

## 4. Predictions (prereg §5.4) and the ladder rule (§5.5)

- **P1 (Kim et al.: if A passes ≥ 45%, S does not beat A): held.**
  - A passed 57%. S did not beat A on pass rate or score.
- **P2 (if A's failures are mostly documents A never saw, S's score exceeds A's): its premise is false.**
  - The frozen locus test calls 19 of A's 25 failed units "not seen".
  - The post-hoc evidence test (`locus2.mjs`) finds the evidence in A's tool results for **20 of 25**.
  - The frozen test only sees document headers and paths, and both agents read through grep and their own Python scripts.
  - So A's failures are rule-application errors with the evidence in view, not attention failures. S's score is not
    meaningfully higher.
- **P3 (a W that is a pure parser fails the novel-test forms, so W ≤ A): the premise is false, the outcome held.**
  - W is model-executed: 39–46 Haiku extraction calls per task.
  - It still failed on the novel-test tier, through the document-type vocabulary rather than the date phrasing (§5.3).
- **P4 (≥ 1/3 of S's failed units carry K3, K5 or K7): not supported, and vacuous.** S had no workers, so 0 of 27 units
  could carry one.
- **Ladder rule: rung 2 (guarded swarm) is not triggered.**
  - Coordination codes explain 0 of S's failures, and there are no worker rows to carry.
  - The "plain Haiku swarms add nothing" branch holds on pass rate (4/7 = 4/7). On score it holds only within noise
    (+0.019, CI spans 0).
  - Read as written: no case for a guarded swarm on this bed. A's and S's failures call for guards on the agent itself (§8).

## 5. Root cause of every failure

Error units come from `rootcause.mjs`, which maps each one to the bed trap it hit with the bed's own resolver, one mistake
switched on at a time. One line per trial is in [ROOTCAUSE-R1.jsonl](ROOTCAUSE-R1.jsonl); the summary is in
[SUMMARY-R1.json](SUMMARY-R1.json).

### 5.1 Single agent A: 3 failed trials, 25 units

| seed | units | root cause | where the fix belongs |
|---|---|---|---|
| 9304 (P3) | 12 wrong cells match a venue-first or recency ranking; 2 unexplained (no single mistake reproduces them); 1 retracted document missing from `excluded_doc_ids` | Rule 8 (rank by n first) misapplied: the agent's own extraction script ranked by venue or date. Evidence seen (post-hoc: 10 of 14 units). | model, judgment. Fix: a code ranker that takes the policy from rule 8 |
| 9305 (P1) | 6 missing compounds: 2 established only under the lab's abbreviation, 1 under its former name, 1 only by the relative date form, 2 plain; 2 excluded documents missing as a cascade | Scope discovery incomplete: alias affiliations and the novel "k days after the site visit" date were not resolved by the agent's grep and script. | model, search and scope. Fix: the bed's code plan (`codePlan`: lab names from the notices) as a coverage check |
| 9307 (P2) | 1 cell mis-ranked; 1 preprint kept although its journal version replaces it; that void document missing from `excluded_doc_ids` | Journal-version supersession not detected (title match across preprint and journal), plus one ranking slip. | model. Fix: code void detection by title |

### 5.2 Swarm S (0 workers in every session): 3 failed trials, 27 units

| seed | units | root cause | where the fix belongs |
|---|---|---|---|
| 9302 (P1) | 2 missing compounds (each established only by the relative date form, one also code-only, one also abbreviation-only); 1 preprint kept although superseded; 1 journal-replaced document and 2 cascade documents missing from `excluded_doc_ids` | The lead's script did not date "run k days after the site visit of D" tests, and missed the journal-version supersession. | model |
| 9304 (P3) | 12 ranking cells (the same venue-first pattern as A on the same task); 4 unexplained; 1 retracted document missing | The same rule-8 misapplication as A on this task. | model, judgment (evidence seen for 14 of 17 units) |
| 9305 (P1) | 2 preprints kept although superseded; 2 journal-replaced documents missing from `excluded_doc_ids` | Journal-version supersession not detected. | model. Fix: code void detection |

**Coordination (K-codes):** K1 (serial collapse) on 7/7 trials; no other code fired.

Root cause of K1: the lead judged the work scriptable and kept it. That is rational here, because R6 is a closed template
grammar (bed notes §13). An untrained orchestrator with a neutral delegation preamble does not fan out. Kimi K2.5 adds a
parallelism reward precisely to counter this.

### 5.3 Fixed workflow W: 7 failed trials, 238 units

**Dominant cause: document-type vocabulary overfit to the dev split.**
- `solve.mjs` lists research types as `['Journal article', 'Full paper', 'Letter', 'Preprint', 'Lab note', 'Conference abstract', 'Technical memo']`.
- The test split's novel kind **"Technical report" is missing**, although rule 6 of the prompt names "technical reports"
  on both splits.
- So technical reports are never sent to the model for extraction, and never count for scope or claims.

Units traced to technical reports [M, by construction]:

| unit type | traced to technical reports |
|---|---|
| missing compounds | **26 of 29**: every establishing document is a technical report |
| missing cells | **54 of 58**: the true winner is a technical report |
| wrong cells | **91 of 130**: the true winner is a technical report |

The builder saw only dev probes, which carry conference abstracts instead.

**Second cause: the ranking order is hard-coded.**
- W ranks n first unless the prompt says "sample size does not matter". That is right for P3 and P2, and wrong for P1
  (venue first).
- Of the 39 wrong cells whose winner is not a technical report, 28 are on the two P1 tasks. 23 of those 28 are
  reproduced exactly by a ranking-order mistake.

**Third cause: relative dates.** `latestDate()` takes the last date in the extracted phrase "k days after the site visit
of D", which is the visit, not the test. At most 3 of 29 missing compounds depend on this alone (post-hoc
`report-r1.mjs` check).

**Smaller causes:**
- 5 cells where an erratum was not applied (the builder's notes call its erratum regex fragile);
- 4 out-of-scope compounds included, dated by the publication-date fallback;
- 5 retracted documents missing from `excluded_doc_ids`.

**Dev calibration failure:** the compound-key fragmentation in the dev table of §3.

**Where the fix belongs:** the builder's code, which is a model fault at build time.
- Derive closed vocabularies (document kinds, ranking order) from the task's own rules, not from what the probes contain.
- Route unknown values to the model.
- Validate on a probe that differs in surface form.

The bed's held-out tier was designed to expose exactly this, and it did.

**Not replayed at $0:** technical reports were never extracted, so a fixed solver needs new model calls (about $0.07 per
task). The budget left after rung 1b ($0.40) is reserved.

### 5.4 Forced swarm S-F (rung 1b, exploratory): 1 failed trial, 1 unit

**Shape of the run** [M]:
- Workers and batching:
  - 9 workers in one batch, at most 8 concurrent, CLI-confirmed: `spawned` 9, `completed` 9, none refused or killed.
  - Critical steps 18; the session took 557 s.
  - Worker time: 1,259 s summed, 203 s wall-clock union, so roughly 6× parallel.
- Partition:
  - The lead partitioned by document: `ls | sed -n 'a,bp'` slices of 50, about 50 documents read per worker.
  - Workers extracted every measurement in their slice. The lead merged them and applied the rules.
  - This is CrowdForge's partition-map-reduce, decided at run time.

**The one wrong cell:** compound KT-4212, melting point.
- A worker reported the raw value correctly (449.42 °F) with the note "equals ~232.0 °C".
- The lead used 232; the truth is 231.9 to 1 decimal.
- Root cause: a lossy hand-off, where an approximate conversion in a worker note replaced computing from the raw value.
- Fix: a code unit converter applied to raw worker values.

**Other coordination observations (no failure):**
- One worker received a template brief with "START/END given at the bottom" but no values. It did nothing (0 documents,
  6.6 s): a no-op worker, Kimi's "spurious parallelism".

**Blind spots in our coordination coder**, found on its first real swarm trace and recorded, not patched:
1. No code for a no-op worker.
2. No code for a lossy hand-off.
3. The brief parser cannot read `sed -n` line ranges, so 21 in-scope compounds count as "unassigned" although every
   document was covered.
   - K3 did not fire, because no compound was missing.
   - K3 also requires that no worker returned the compound and the lead never saw it.
4. The carried-rows replay assumes workers return final rows. These workers returned raw measurements, so the replay's
   0.15 is meaningless.

Treat the coder as validated on synthetic swarms (9 tests) and on one real trace.

### 5.5 Fault-side summary

| arm | frozen locus (seen / not seen) | post-hoc evidence (seen / not seen) | side |
|---|---|---|---|
| A | 6 / 19 | 20 / 5 | model: rule application (ranking, supersession) and scope search |
| S | 16 / 11 | 22 / 5 | model: the same classes; harness: none (no workers) |
| W | n/a | n/a | model (builder code): vocabulary, ranking order and date overfit to dev |
| S-F | 1 / 0 | 1 / 0 | harness (lossy hand-off; a code converter fixes it) |

No failure is on the bed or grader side: the decidability witness agrees on all 7 tasks.

## 6. Defects in our own harness, found by this run

1. **Void rule (Amendment 2).** The rule voided sandbox-private scratch and would have discarded the whole comparison.
   - The need router uses the same rule. That deserves a check by its owner [I].
2. **Empty-set crash** in the frozen analysis; fixed with a guard.
3. **The frozen "seen" test** (`seenDocs`) undercounts reading done through scripts. A post-hoc evidence test was added
   (`locus2.mjs`); both are reported.
4. **The coordination coder's four blind spots** (§5.4).
5. **Cost guard conservatism.** The §6.3 guard (1.25 × largest block) stopped at N = 7 of 8 with $1.16 left. That was
   by design, but a block-cost model per arm would have fit task 8.

## 7. Threats to validity

- **Statistical power.** N = 7, K = 1, one bed, one difficulty. The pass-rate intervals are wide (0.25–0.84), and
  per-task outcomes are stochastic: A and S are the same agent apart from the preamble, and they disagree on 2 of 7 tasks.
- **Scriptable bed.** R6 is a closed template grammar, and both agents solved it by writing parsers. A bed where single-
  context work is genuinely degraded would test swarms more fairly. Examples: a corpus above the context window, or
  judgment that resists scripting (bed notes §11 Q7–Q8).
- **One build.** W rests on one Haiku build: one construction, 2 of 6 score checks used, 13 of 40 minutes.
- **Contention.** The machine and account were shared, so wall-clock includes contention.
- **Rung 1b** is one exploratory trial on a task whose rung-1 outcome was already known.

## 8. What next (ranked by expected value per dollar)

1. **Guard the single agent; do not add workers.**
   - A/S failure classes (ranking 24 cells, journal-version supersession 8 units, scope 8 compounds) each map to a code
     guard the bed already has or that is cheap to write:
     - a ranker that takes the policy from rule 8;
     - void detection by title;
     - `codePlan` / `coverageIssues` as a scope check.
   - Rung 2 should be "A + Foundry guards (as tools or as a verify step)" vs A on fresh held-out d5 seeds. Expected cost
     is about $4 at A's price.
2. **W: build vocabularies from the rules.** Re-run the W build with a builder instruction (or a construction-skill
   lesson) to derive closed sets from the prompt, and test on a probe of another surface form. This is the general lesson
   for Foundry construction: a cheap builder overfits to what the probes show, not to what the spec says.
3. **A swarm-favouring bed before any further swarm rung.** For example R6 at about 800 documents (above Haiku's useful
   context for one session), or discovery that needs judgment. Only there can rung 2's guarded swarm be tested
   honestly. Forced fan-out costs about 2× S per task here, with no accuracy gain on the one task tried.
4. **Coordination coder.** Add K12 (no-op worker) and K13 (lossy hand-off), and parse `sed`/`head`/`tail` line-range
   briefs. The real S-F trace becomes a fixture.

## 9. Files and reproduction

**Records:**
- Run records: `runs/` (calibration, held-out and rung-1b results; the N and k decisions; the run and launch logs; the W
  build record, notes and `solve.mjs`).
- Raw archives (transcripts, answers, spawn trees, files written; W's stdout, stderr and call logs) stay outside the
  repository: `/var/tmp/foundry-work/swarm-r1/archive`, `/var/tmp/foundry-work/swarm-r1b/archive`. The model-port
  journal is `/var/tmp/foundry-work/swarm-r1/journal.sqlite`.

**Code** (`experiments/swarm/`):
- `arms.mjs`, `spawn-tree.mjs`, `coord.mjs`, `rootcause.mjs`
- `run-r1.mjs`, `launch-r1.sh`, `analyze-r1.mjs` (amended)
- `run-r1b.mjs`, `launch-r1b.sh`
- post-hoc: `locus2.mjs`, `report-r1.mjs`, `void-audit.mjs`

**Tests:** `sh experiments/swarm/test/run-tests.sh`, 48 tests, all passing:
- spawn-tree 4, coord 9, arms 5, rootcause 6, analyze 1, r1b 2, void-audit 3;
- `tests/executor-extra-args` 3, `tests/executor-sandbox` 15.

**Re-analysis ($0):**
- `node experiments/swarm/analyze-r1.mjs --stage heldout --out research/swarm-20261021`
- `node experiments/swarm/report-r1.mjs --out research/swarm-20261021`

**Seed ledger:**
- `swarm-r1-heldout` (wbed-r6 test 9301–9310, used; 9308–9310 were generated only for freeze hashes);
- `swarm-r1-dev` (365–368, used).
