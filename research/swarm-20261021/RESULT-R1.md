# Swarm ladder, rung 1: result (D3)

*2026-11-04. Preregistered in [PREREG-SWARM-R1.md](PREREG-SWARM-R1.md) and frozen by [FROZEN-R1.json](FROZEN-R1.json)
before any paid call of the rung. Three amendments, all after the held-out stage and all disclosed below. Research:
[DOSSIER-SWARM.md](DOSSIER-SWARM.md). Spend: **$7.60 of the $8.00 Haiku cap**. No Opus, Sonnet or Mercury call;
`beds/sealed/` never read. Tags: **[M]** measured here; **[I]** inference; **post-hoc** = not preregistered.*

*Revised 2026-11-04 after the design review (§10). The first version (commit 17c4ee0a) published a 7-block table that
rested on a bug in the post-hoc void audit (review B1). This version corrects it, reports the three void rules side by
side, and states the frozen falsifiers as written. No new paid call was made: the $0.40 left under the cap buys no
swarm trial (one forced fan-out trial cost $0.76).*

## 1. Answer

**Rung 1 does not answer D3. The swarm treatment was never delivered, so rung 1 says nothing about what a Haiku swarm
that fans out does.** It leaves the 10-07 position (00-SYNTHESIS §3.9: swarms in scope as the `wide` operator family, and
every swarm must beat best-of-K with the same verifier at equal tokens) unchanged; it adds no evidence for or against it.

What rung 1 does measure [M]:

- **A plain Claude Code Haiku lead does not delegate on this bed.** The swarm lead started **0 workers in 8 of 8
  sessions** (1 dev, 7 held-out). The CLI recorded `subagent_stats.spawned = 0`. The lead's closing text says it "did the
  work myself with a script rather than delegating". This is Kimi's "serial collapse". So arm S is "arm A plus a lead
  preamble plus an unused `Agent` tool", and every S-vs-A number below measures that, not swarming.
- **Primary table (Amendment 2 as written, with the corrected audit): 6 complete held-out blocks.** A passes **3/6**,
  S **4/6**, W **0/6**.
  - S vs A: discordant pairs 1 / 0, McNemar p = 1. Mean score S − A = **+0.061** (95% bootstrap −0.008 to +0.141).
    Cost per success S/A = 0.58 (0.22 to 1.08).
  - Under Amendment 3 (7 blocks) A and S both pass 4/7, score +0.019 (−0.079 to +0.119). Under the frozen rule there is
    no complete block at all.
- **The frozen falsifiers, as written (prereg §7 and §5.5), under every void rule:**
  - Falsifier 1 ("S beats A" is falsified if S's pass rate and mean score are both at or below A's): **not fired.** S's
    score is above A's (0.926 vs 0.864 primary; 0.902 vs 0.884 under Amendment 3).
  - Falsifier 2 ("cheaper or faster at equal quality" is falsified if S's cost per pass or median wall-clock is above
    A's while S's pass rate is not higher): **not fired.** S is cheaper per pass ($0.505 vs $0.867) and faster (410 s vs
    627 s).
  - The §5.5 branch "plain Haiku swarms add nothing on this bed" needs S at or below A on pass and score: **not met** as
    worded. The rung-2 trigger (a third of S's failed units coded K3, K5 or K7, or a carried-rows replay that turns a
    failure into a pass) is **not met** either, because S had no workers.
  - Reading: **inconclusive about swarms (treatment not delivered).** S's small edge over A is not significant, and it
    comes from a lead that never used a worker: preamble and sampling noise, not swarming [I].
- **The forced fan-out (rung 1b, Amendment 1, exploratory, one task) did fan out.** It started 9 workers and failed by
  one cell (score 0.992). On that task (seed 9301) both A and S passed. S-F cost **1.08× A** ($0.761 vs $0.706) and
  **2.13× S** ($0.358). It was faster than A (561 s vs 646 s) and slower than S (371 s). N = 1: no claim.
- **The Haiku-built fixed workflow W failed every held-out task: 0/6 (0/7), mean score 0.46 (0.44), $0.07 per task
  plus a $0.39 build.** Its builder copied the dev split's document-type list and left out "Technical report", the
  test split's new kind, although the prompt's rules name it (§5.3). That is a real construction finding: a cheap builder
  overfits to what the probes show, not to what the spec says.
- **The single-agent baseline is strong.** A passed 3/6 (4/7) held-out d5 tasks at $0.43 per trial by scripting its own
  parser. For orientation only (dev split, an earlier session, not comparable): one Haiku call passed **0/12 at effort
  medium and 2/12 at effort none** on dev seeds 379–390 at d5 (need-router M1).

**Next for D3** (§8): a swarm rung that cannot serially collapse (S-F, or a Foundry `wide` arm with Haiku workers), gated on
delivered fan-out (`delivery-gate.mjs`), against A and against best-of-K A with the same verifier at equal tokens (B5),
at N ≥ 6, piloted on dev before freezing; and an Opus 5.5 xhigh reference, which the $8 Haiku cap excluded.

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
  blocks were run.
- **Faults and drift.** No environment fault. No model drift: every message on every trial was served by
  `claude-haiku-5-5`.
- **Decidability.** The text-only decidability witness agrees with the oracle on all 7 held-out tasks, so no failure is a
  grader fault.
- **Departures from the owner's model roles.** The W builder ran at effort **high**, as frozen in prereg §2. The owner's
  rule (OPERATING-PRINCIPLES §7) is "Haiku 5.5 max for cheap implementation". This departure was preregistered but not
  flagged as a departure. The builder used 2 of its 6 score checks and 13 of its 40 minutes, so its budget was not the
  limit (§5.3). The A and S agents ran at the CLI default effort.
- **No frontier reference.** No Opus 5.5 xhigh arm ran (the owner's bar): the $8 Haiku cap excluded it, and no R6 Opus
  reference workflow exists (prereg §2).
- **No treatment-delivery gate.** The calibration record showed S with 0 workers at 17:48Z. The launcher still started
  the held-out stage on its own at 18:01Z, because the prereg had no gate (review M1). $2.25 of held-out spend and 7 fresh
  seeds then measured A against "A plus an unused tool". `experiments/swarm/delivery-gate.mjs` is that gate for the next
  rung; on rung 1's own calibration record it returns "treatment not delivered" (tested).

**Amendments** (full text in the prereg):

1. **Amendment 1: rung 1b, exploratory.** Added because S never delegated. The new arm S-F is arm S plus a task-agnostic
   fan-out rule. It ran on the first k rung-1 held-out tasks, with k = 1 by the amendment's budget rule. The amendment
   text was committed (01221415) before its only call. Its launcher `launch-r1b.sh` and its records were committed
   afterwards, in 17c4ee0a (review minor 6).
2. **Amendment 2: the void rule, analysis only.** The frozen rule voided 10 of 14 held-out A and S trials, which left
   0 complete blocks and crashed the frozen analysis on an empty set. A post-hoc audit (`void-audit.mjs`) classifies
   each flagged path; a trial is void only for drift, a repository-path mention, or a path of kind `other`.
3. **Amendment 3 (after the review): a failed `cd` is no access.** A path that is only ever the argument of `cd`, that no
   tool use creates, and that does not exist on the read-only host filesystem (outside the private tmpfs mounts) is
   `failed-cd`, not `other`. It applies to exactly one path in rung 1, so it is reported as a sensitivity analysis, not as
   the primary rule.

**The audit bug (review B1), and the three rules side by side.** The audit as first committed leaned on `writesOf`
(`spawn-tree.mjs`). That function read `"->"` (inside quotes), `> ''` and `a > b` inside heredocs as file redirections.
It returned `""` or a script word as a written path, and `under(p, "")` was true for every absolute path. So once any
command of a session held such a string, every flagged path of that session came out "self-created". On A 9302 (tool
use 27: `grep -c -- "->" …`) it hid `cd /var/foundry-work 2>/dev/null`. That path does not exist, is not under `/var/tmp`,
and the session never created it. The fix is a quote-, heredoc- and comment-aware command scanner (`shell-scan.mjs`),
plus an `under()` that refuses an empty, root or relative ancestor. Paths flagged by the frozen scan (52 in 10 trials),
re-audited:

| kind | count | where |
|---|---|---|
| self-created | 37 | files and directories the session itself made under `/var/tmp` (each traced to the tool use that creates it) |
| cli-spill | 11 | the CLI's own tool-result spill files under `/root/.claude/projects/<session>/tool-results/` |
| workdir-ancestor | 3 | `/var/tmp/foundry-work`, the tmpfs directory above the session's own workdir |
| other (Amendment 2) / failed-cd (Amendment 3) | 1 | `/var/foundry-work` in A 9302: a `cd` with its error discarded, to a path that does not exist |

The first version said "38 … created … under `/var/tmp`". That count held the bogus `/var/foundry-work` (review minor 1).

| void rule | void trials | complete blocks | A | S | W |
|---|---|---|---|---|---|
| frozen (§5.1 as frozen) | 10 (7 A, 3 S) | **0** | n/a | n/a | n/a |
| **Amendment 2 as written, corrected audit (primary)** | 1 (A 9302) | **6** | 3/6 | 4/6 | 0/6 |
| Amendment 3 (failed cd is no access) | 0 | 7 | 4/7 | 4/7 | 0/7 |

The primary rule is Amendment 2, because it was written before the bug was found. Amendment 3 was written knowing that it
restores exactly the block where A passed and S failed. A trial the audit cannot read (no transcript) keeps its frozen
verdict, void (tested).

## 3. Capability table (held-out, K = 1)

**Primary: Amendment 2 as written, corrected audit; N = 6 paired tasks (9301, 9303–9307).**

| arm | who decomposes | pass | Wilson 95% | mean score | cells right | missing compounds per task | excluded set right | cost per trial | cost per pass | median / max wall |
|---|---|---|---|---|---|---|---|---|---|---|
| **A** single Haiku agent (baseline) | nobody | **3/6** | 0.19–0.81 | 0.864 | 0.929 | 1.00 | 3/6 | $0.433 | $0.867 | 627 / 747 s |
| **S** Haiku swarm (Agent tool offered) | a model at run time; **in fact, nobody (0 workers)** | **4/6** | 0.30–0.90 | 0.926 | 0.971 | 0.00 | 4/6 | $0.337 | $0.505 | 410 / 677 s |
| **W** Haiku-built fixed workflow | code at build time | **0/6** | 0–0.39 | 0.464 | 0.556 | 4.00 | 0/6 | $0.071 (+ $0.394 build) | none | 211 / 252 s |

**Sensitivity: Amendment 3; N = 7 (9301–9307).** These are the numbers the first version published.

| arm | pass | Wilson 95% | mean score | cells right | missing compounds per task | excluded set right | cost per trial | cost per pass | median / max wall |
|---|---|---|---|---|---|---|---|---|---|
| A | 4/7 | 0.25–0.84 | 0.884 | 0.939 | 0.86 | 4/7 | $0.437 | $0.765 | 607 / 747 s |
| S (0 workers) | 4/7 | 0.25–0.84 | 0.902 | 0.961 | 0.29 | 4/7 | $0.321 | $0.562 | 420 / 677 s |
| W | 0/7 | 0–0.35 | 0.444 | 0.533 | 4.14 | 0/7 | $0.071 (+ $0.394 build) | none | 213 / 252 s |

**Outside both tables:**
- S-F (rung 1b, exploratory): seed 9301 only, 0/1, score 0.992, 9 workers, $0.761, 561 s. A and S both passed that task
  (A $0.706, 646 s; S $0.358, 371 s).
- One Haiku call (dev split, earlier session): 0/12 at effort medium and 2/12 at effort none, on dev 379–390.

**Paired comparisons** (frozen analysis code with the amended void rules):

| comparison | rule | discordant pairs (first only / second only) | McNemar p | pass difference, 95% bootstrap | score difference, 95% bootstrap | cost-per-success ratio |
|---|---|---|---|---|---|---|
| S vs A (primary) | A2 (6) | 1 / 0 | 1.00 | +0.17 (0.00, +0.50) | +0.061 (−0.008, +0.141) | 0.58 (0.22, 1.08) |
| S vs A | A3 (7) | 1 / 1 | 1.00 | 0.00 (−0.43, +0.43) | +0.019 (−0.079, +0.119) | 0.74 (0.30, 1.69) |
| W vs A | A2 (6) | 0 / 3 | 0.25 | −0.50 (−0.83, −0.17) | **−0.400 (−0.492, −0.312)** | W has no passes |
| W vs A | A3 (7) | 0 / 4 | 0.125 | −0.57 (−0.86, −0.14) | **−0.440 (−0.554, −0.338)** | W has no passes |
| S vs W | A2 (6) | 4 / 0 | 0.125 | +0.67 (+0.33, +1.00) | **+0.461 (+0.372, +0.525)** | W has no passes |
| S vs W | A3 (7) | 4 / 0 | 0.125 | +0.57 (+0.14, +0.86) | **+0.458 (+0.381, +0.514)** | W has no passes |

None of these is confirmatory (§4 of the prereg needs McNemar p < 0.05).

- **W against A and S.** The score gaps are large, and their intervals exclude 0 under both rules.
- **S against A.** No difference is detectable. S was cheaper per trial and faster, but the cost-per-success interval
  reaches 1 or more under both rules. S never used a worker, so none of this is about swarming.

### Per task

| seed | policy | A | S | W | in the primary table |
|---|---|---|---|---|---|
| 9301 | P2 | **pass** $0.71, 646 s | **pass** $0.36, 371 s | 0.465, $0.07 | yes |
| 9302 | P1 | **pass** $0.46, 526 s (void under A2: `cd /var/foundry-work`) | 0.761, $0.23 | 0.323, $0.07 | no (A3 only) |
| 9303 | P3 | **pass** $0.33, 747 s | **pass** $0.54, 677 s | 0.501, $0.07 | yes |
| 9304 | P3 | 0.745, $0.37 | 0.720, $0.38 | 0.471, $0.08 | yes |
| 9305 | P1 | 0.607, $0.22 | 0.834, $0.15 | 0.332, $0.07 | yes |
| 9306 | P2 | **pass** $0.55, 745 s | **pass** $0.32, 399 s | 0.459, $0.07 | yes |
| 9307 | P2 | 0.834, $0.43 | **pass** $0.27, 421 s | 0.559, $0.06 | yes |

### Dev calibration (seed 368; cost only, never a capability claim)

| arm | outcome | score | cost | wall | what failed |
|---|---|---|---|---|---|
| A | fail | 0.992 | $0.337 | 499 s | one cell ranked by recency instead of policy P3 |
| S (0 workers) | fail | 0.842 | $0.201 | 317 s | a preprint kept although its journal version replaces it (one cell), and that void preprint left out of `excluded_doc_ids` |
| W | fail | 0.936 | $0.098 | 217 s | one compound split into two keys: the model put the code in the name field, and `compoundKey()` lower-cased it into a `name:` key |

W scored 0.936 on dev and 0.46 on held-out. §5.3 explains the gap.

## 4. Predictions (prereg §5.4), falsifiers (§7) and the ladder rule (§5.5)

- **P1 (Kim et al.: if A passes ≥ 45%, S does not beat A): held, within noise.** A passed 50% (primary) or 57%
  (Amendment 3). S did not beat A on pass rate with any significance (p = 1). But S's score was higher under both rules,
  so this is "no detectable difference", not "S at or below A".
- **P2 (if A's failures are mostly documents A never saw, S's score exceeds A's): its premise is false.**
  - The frozen locus test calls 19 of A's 25 failed units "not seen".
  - The post-hoc evidence test (`locus2.mjs`) finds the evidence in A's tool results for **20 of 25**.
  - The frozen test only sees document headers and paths, and both agents read through grep and their own Python scripts.
  - So most of A's failures are rule-application errors with the evidence in view, not attention failures.
- **P3 (a W that is a pure parser fails the novel-test forms, so W ≤ A): the premise is false, the outcome held.**
  - W is model-executed: 39–46 Haiku extraction calls per task.
  - It still failed on the novel-test tier, through the document-type vocabulary rather than the date phrasing (§5.3).
- **P4 (≥ 1/3 of S's failed units carry K3, K5 or K7): vacuous.** S had no workers, so none of its units could carry one.
- **§7 falsifier 1:** not fired (S's score is above A's under every rule). **§7 falsifier 2:** not fired (S's cost per pass
  and median wall-clock are below A's). **§5.5 "adds nothing" branch:** not met as worded. **Rung-2 trigger:** not met (no
  workers, so no coordination codes and no worker rows to carry).
- **Reading.** Inconclusive about swarms: the treatment was not delivered. The first version of this document said "gains
  nothing" and "S did not beat A on pass rate or score". That read the frozen rules more strongly than their wording
  allows (review M2), and is withdrawn.

## 5. Root cause of every failure

Error units come from `rootcause.mjs`, which maps each one to the bed trap it hit with the bed's own resolver, one mistake
switched on at a time. Units no single mistake reproduces were traced post-hoc by `trace-unexplained.mjs`, with pairs of
mistakes, a "winner missed" mistake (the true winning claim never extracted), and W's own code facts
([TRACE-UNEXPLAINED-R1.jsonl](TRACE-UNEXPLAINED-R1.jsonl)). **All 57 previously unexplained units now carry an
explanation**, and none is left `unexplained`. "Winner missed" says what happened, not why the claim was missed.
[ROOTCAUSE-R1.jsonl](ROOTCAUSE-R1.jsonl) has one line per trial for all 21 held-out trials, including the voided block
9302 (`inComparison`). The summary is in [SUMMARY-R1.json](SUMMARY-R1.json).

**A and S units by class** (A: 3 failed trials, 25 units; S: 3 failed trials, 27 units, of which 2 trials and 21 units
are in the primary table):

| class | all 52 units | in the primary table (46) |
|---|---|---|
| ranking by the wrong order (a policy or recency mistake reproduces the cell) | 24 | 24 |
| journal-version supersession missed (the preprint's value kept, or the void preprint missing from `excluded_doc_ids`) | 8 | 6 |
| a missing compound (scope: alias, former name, the relative date form, plain) | 8 | 6 |
| the winning claim never extracted (post-hoc trace) | 6 | 6 |
| an excluded document missing as a cascade of a missing compound | 4 | 2 |
| a retracted document missing from `excluded_doc_ids` | 2 | 2 |

### 5.1 Single agent A: 3 failed trials, 25 units (all in the primary table)

| seed | units | root cause | where the fix belongs |
|---|---|---|---|
| 9304 (P3) | 11 wrong cells match a venue-first or recency ranking (the first version said 12); 2 cells traced post-hoc to a missed winning claim; 1 retracted document missing from `excluded_doc_ids` | Rule 8 (rank by n first) misapplied: the agent's own extraction script ranked by venue or date. Evidence seen (post-hoc: 10 of 14 units). The two missed winners: PD-8849 density (winner D055) and LT-5416 half-life (winner D119; a two-mistake ranking explanation, novel kind as journal plus venue first, also fits). | model, judgment. Fix: a code ranker that takes the policy from rule 8 |
| 9305 (P1) | 6 missing compounds: 2 established only under the lab's abbreviation, 1 under its former name, 1 only by the relative date form, 2 plain; 2 excluded documents missing as a cascade | Scope discovery incomplete: alias affiliations and the novel "k days after the site visit" date were not resolved by the agent's grep and script. | model, search and scope. Fix: the bed's code plan (`codePlan`: lab names from the notices) as a coverage check |
| 9307 (P2) | 1 cell mis-ranked; 1 preprint kept although its journal version replaces it; that void document missing from `excluded_doc_ids` | Journal-version supersession not detected (title match across preprint and journal), plus one ranking slip. | model. Fix: code void detection by title |

### 5.2 Swarm S (0 workers in every session): 3 failed trials, 27 units

| seed | units | root cause | where the fix belongs |
|---|---|---|---|
| 9302 (P1; outside the primary table) | 2 missing compounds (each established only by the relative date form, one also code-only, one also abbreviation-only); 1 preprint kept although superseded; 1 journal-replaced document and 2 cascade documents missing from `excluded_doc_ids` | The lead's script did not date "run k days after the site visit of D" tests, and missed the journal-version supersession. | model |
| 9304 (P3) | 12 ranking cells (the same venue-first pattern as A on the same task); 4 cells traced post-hoc to a missed winning claim; 1 retracted document missing | The same rule-8 misapplication as A on this task. The missed winners: PD-8849 density (D055), CX-4449 half-life (D365), HX-188 density (D314), LT-5416 half-life (D119). | model, judgment (evidence seen for 14 of 17 units) |
| 9305 (P1) | 2 preprints kept although superseded; 2 journal-replaced documents missing from `excluded_doc_ids` | Journal-version supersession not detected. | model. Fix: code void detection |

**The missed winners on 9304.** In three of the four cases (D055, D365, D314) the winning document names the compound
by its **code only** (0 mentions of the name), while the document chosen instead names it by name (D094, D001, D166)
[M, counted in the documents]. That both agents' extraction keyed on the compound's name is an inference [I]; their
scripts were not re-run.

**Coordination (K-codes):** K1 (serial collapse) on 7/7 trials; no other code fired.

**Root cause of K1.** The lead judged the work scriptable and kept it, which is rational here, because R6 is a closed
template grammar (bed notes §13). The lead preamble also explicitly allows "do small or tightly coupled work yourself"
(`arms.mjs`). The dossier already knew the bed was scriptable (DOSSIER-SWARM.md, d5 sizes). So serial collapse was
predictable, and a dev pilot with a delivery gate would have caught it before any held-out seed was spent (review M1;
§2). An untrained orchestrator with a neutral delegation preamble does not fan out. Kimi K2.5 adds a parallelism reward
precisely to counter this.

### 5.3 Fixed workflow W: 7 failed trials, 238 units (6 trials and 189 units in the primary table)

**Dominant cause: the document-type vocabulary overfits the dev split.**
- `solve.mjs` lists research types as `['Journal article', 'Full paper', 'Letter', 'Preprint', 'Lab note', 'Conference abstract', 'Technical memo']`.
- The test split's novel kind **"Technical report" is missing**, although rule 6 of the prompt names "technical reports"
  on both splits.
- So technical reports are never sent to the model for extraction, and never count for scope or claims.

Units traced to technical reports [M, by construction; `report-r1.mjs` `posthoc[].techreport`]:

| unit type | traced to technical reports, all 7 tasks | primary table (6 tasks) |
|---|---|---|
| missing compounds (every establishing document is a technical report) | **26 of 29** | 21 of 24 |
| missing cells (the true winner is a technical report) | **54 of 58** | 48 of 51 |
| wrong cells (the true winner is a technical report) | **91 of 130** | 72 of 98 |

The builder saw only dev probes, which carry conference abstracts instead.

**Second cause: the ranking order is hard-coded.**
- W ranks n first unless the prompt says "sample size does not matter". That is right for P3 and P2, and wrong for P1
  (venue first).
- Of the 39 wrong cells whose winner is not a technical report (all 7 tasks), 28 are on the two P1 tasks. 23 of those 28
  are reproduced exactly by a ranking-order mistake.

**Third cause: relative dates.** `latestDate()` takes the last date in the extracted phrase "k days after the site visit
of D", which is the visit, not the test. At most 3 of 29 missing compounds depend on this alone (post-hoc
`report-r1.mjs` check).

**Smaller causes:**
- 5 cells where an erratum was not applied (the builder's notes call its erratum regex fragile);
- 4 out-of-scope compounds included, dated by the publication-date fallback;
- 5 retracted documents missing from `excluded_doc_ids`.

**The 51 W cells the single-mistake tracer left unexplained** (post-hoc trace):
- 42: the winning claim was never extracted (W's model extraction calls missed it);
- 5: technical reports not counted as research;
- 2: technical reports not counted, together with W's fixed n-first ranking;
- 1: technical reports not counted, together with concern notices treated as voids;
- 1: technical reports not counted, together with a missed winner.

**Dev calibration failure:** the compound-key fragmentation in the dev table of §3.

**Where the fix belongs:** the builder's code, which is a model fault at build time.
- Derive closed vocabularies (document kinds, ranking order) from the task's own rules, not from what the probes contain.
- Route unknown values to the model.
- Validate on a probe that differs in surface form.

The bed's held-out tier was designed to expose exactly this, and it did.

**Not replayed at $0:** technical reports were never extracted, so a fixed solver needs new model calls (about $0.07 per
task). The $0.40 left after rung 1b does not cover a rebuild plus a held-out re-run.

### 5.4 Forced swarm S-F (rung 1b, exploratory): 1 failed trial, 1 unit

**Shape of the run** [M]:
- Workers and batching:
  - 9 workers in one batch, at most 8 concurrent, CLI-confirmed: `spawned` 9, `completed` 9, none refused or killed.
    The delivery gate passes this arm (tested on its record).
  - Critical steps 18; the session took 557 s.
  - Worker time: 1,259 s summed, 203 s wall-clock union, so roughly 6× parallel.
- Partition:
  - The lead partitioned by document: `ls | sed -n 'a,bp'` slices of 50, about 50 documents read per worker.
  - Workers extracted every measurement in their slice. The lead merged them and applied the rules.
  - This is CrowdForge's partition-map-reduce, decided at run time.
- Cost against both rung-1 arms on the same task (N = 1): **1.08× A** and **2.13× S**; wall-clock 0.87× A and 1.51× S.
  The first version compared it with S only ("2.1×"), the arm that never swarmed (review M4).

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

Treat the coder as validated on synthetic swarms (10 tests) and on one real trace.

### 5.5 Fault-side summary

| arm | frozen locus (seen / not seen), all units | post-hoc evidence (seen / not seen), all units | primary table: post-hoc evidence | side |
|---|---|---|---|---|
| A | 6 / 19 | 20 / 5 | 20 / 5 | model: rule application (ranking, supersession) and scope search |
| S | 16 / 11 | 22 / 5 | 18 / 3 | model: the same classes; harness: none (no workers) |
| W | n/a | n/a | n/a | model (builder code): vocabulary, ranking order and date overfit to dev |
| S-F | 1 / 0 | 1 / 0 | n/a | harness (lossy hand-off; a code converter fixes it) |

No failure is on the bed or grader side: the decidability witness agrees on all 7 tasks.

## 6. Defects in our own harness, found by this run and its review

1. **Void rule (Amendment 2).** The frozen rule voided sandbox-private scratch and would have discarded the whole
   comparison.
   - The need router uses the same frozen rule. That deserves a check by its owner [I].
2. **The audit that replaced it was itself wrong (review B1).** `writesOf` read quoted arrows and empty redirection
   targets as written paths, and `under(p, "")` was true for every path. The 48 tests of the first version all passed
   with the bug, because the analysis test never reached the audit and no audit test had a fake write target (review
   M5). Fixed with `shell-scan.mjs` and a guarded `under()`. Tested: 12 new tests, including the reviewer's synthetic
   case and an all-flagged analysis.
3. **The same bogus targets could fire K8** (a write collision) once a swarm has workers (review minor 4). Fixed with
   B1 and tested. K8 did not fire in rung 1 or 1b. The archived spawn trees still hold the old write lists, and S-F's
   tree shows no collision.
4. **Empty-set crash** in the frozen analysis; fixed with a guard.
5. **The frozen "seen" test** (`seenDocs`) undercounts reading done through scripts. A post-hoc evidence test was added
   (`locus2.mjs`); both are reported.
6. **The coordination coder's four blind spots** (§5.4).
7. **No treatment-delivery gate** (review M1): `delivery-gate.mjs`, for the next rung.
8. **Cost guard conservatism.** The §6.3 guard (1.25 × largest block) stopped at N = 7 of 8 with $1.16 left. That was
   by design, but a block-cost model per arm would have fit task 8.

## 7. Threats to validity

- **The treatment was not delivered.** S never used a worker; S-F is one exploratory trial on a task whose rung-1
  outcome was known.
- **Statistical power.** N = 6 (7), K = 1, one bed, one difficulty. The pass-rate intervals are wide. Per-task outcomes
  are stochastic: A and S are the same agent apart from the preamble, and they disagree on 1 of 6 (2 of 7) tasks. The
  owner's rule is "no K = 1 comparative proof" (OPERATING-PRINCIPLES §6); nothing here is one.
- **Post-hoc void rules.** All three of Amendment 2, its correction and Amendment 3 were written after the data were
  seen. The frozen rule leaves nothing to compare, so every comparison here rests on a post-hoc rule.
- **Scriptable bed.** R6 is a closed template grammar, and both agents solved it by writing parsers. A bed where single-
  context work is genuinely degraded would test swarms more fairly. Examples: a corpus above the context window, or
  judgment that resists scripting (bed notes §11 Q7–Q8).
- **One build.** W rests on one Haiku build at effort high (not the owner's "max"): one construction, 2 of 6 score
  checks used, 13 of 40 minutes.
- **No frontier reference** (Opus 5.5 xhigh), and no best-of-K comparator.
- **Contention.** The machine and account were shared, so wall-clock includes contention.
- **Seed exposure.** The $0 sizing script generated wbed-r6 test seeds 8401–8406 (range `wbed-heldout-c`, owned by
  wbed/JIT), and the agent that wrote this prereg saw their summary statistics. It is recorded in the seed ledger
  (`exposures` on `wbed-heldout-c`). The range owner decides whether to burn them.

## 8. What next (ranked by expected value per dollar)

1. **Before any further swarm rung: a dev pilot of every arm before freezing (about $0.55), plus the delivery gate.**
   On dev 368 the calibration already showed serial collapse and A at 0.992. Rung 1's calibration was such a pilot, but
   it ran after the freeze and fed no decision rule. One dev task cannot establish A's pass rate against P1's 45%, but it
   was enough to see that S would not swarm.
2. **Guard the single agent; do not add workers.**
   - The A/S failure classes (ranking 24 cells, journal-version supersession 8 units, scope 8 compounds, missed winners 6
     cells) each map to a code guard the bed already has or that is cheap to write:
     - a ranker that takes the policy from rule 8;
     - void detection by title;
     - `codePlan` / `coverageIssues` as a scope check;
     - matching compounds by code and by name.
   - Rung 2 should be "A + Foundry guards (as tools or as a verify step)" vs A on fresh held-out d5 seeds. Expected cost
     is about $4 at A's price.
3. **A swarm rung that delivers the treatment, with the fair comparators:**
   - **S-F as the preregistered swarm arm** (forced fan-out). Its cost is close to A's (1.08× on the one task), and S's
     held-out spend alone ($2.25) would have bought about 3 S-F trials.
   - **A Foundry `wide` arm with Haiku workers**, built on the bed's own `codePlan` and `coverageIssues`. It cannot
     serially collapse, and it is the in-scope form named by the 10-07 synthesis.
   - **B5: best-of-K A with the same verifier at equal tokens.** `beds/wbed/r6/index.mjs` already defines this arm and
     the equal-token budget. It is the fair comparator for a swarm's extra cost.
   - N ≥ 6, K ≥ 2, an Opus 5.5 xhigh reference, on a bed where one context is genuinely degraded (R6 at about 800
     documents, above Haiku's useful context for one session, or discovery that needs judgment).
4. **W: build vocabularies from the rules, at the owner's effort.** Re-run the W build at effort max, with a builder
   instruction (or a construction-skill lesson) to derive closed sets from the prompt, and test on a probe of another
   surface form. This is the general lesson for Foundry construction: a cheap builder overfits to what the probes show,
   not to what the spec says.
5. **Coordination coder.** Add K12 (no-op worker) and K13 (lossy hand-off), and parse `sed`/`head`/`tail` line-range
   briefs. The real S-F trace becomes a fixture.

## 9. Files and reproduction

**Records:**
- Run records: `runs/` (calibration, held-out and rung-1b results; the N and k decisions; the run and launch logs; the W
  build record, notes and `solve.mjs`).
- Raw archives (transcripts, answers, spawn trees, files written; W's stdout, stderr and call logs) stay outside the
  repository: `/var/tmp/foundry-work/swarm-r1/archive`, `/var/tmp/foundry-work/swarm-r1b/archive`. The model-port
  journal is `/var/tmp/foundry-work/swarm-r1/journal.sqlite`.
- Analysis outputs: `SUMMARY-R1-heldout.json` (frozen analysis, `rules` holds all three void rules),
  `SUMMARY-R1.json` (with the post-hoc checks and the Amendment 3 sensitivity), `ROOTCAUSE-R1.jsonl` (all 21 trials),
  `TRACE-UNEXPLAINED-R1.jsonl` (57 traced units).

**Code** (`experiments/swarm/`):
- `arms.mjs`, `spawn-tree.mjs` (writesOf corrected), `coord.mjs`, `rootcause.mjs`
- `run-r1.mjs`, `launch-r1.sh`, `analyze-r1.mjs` (amended: three void rules, root cause on every trial)
- `run-r1b.mjs`, `launch-r1b.sh`
- post-hoc: `locus2.mjs`, `report-r1.mjs`, `void-audit.mjs`, `shell-scan.mjs`, `trace-unexplained.mjs`
- for the next rung: `delivery-gate.mjs`

**Tests:** `sh experiments/swarm/test/run-tests.sh`, one file at a time, **60 tests, all passing**:
- spawn-tree 4, coord 10, arms 5, rootcause 6, analyze 3, r1b 2, void-audit 6, shell-scan 3, delivery-gate 2,
  trace-unexplained 1;
- `tests/executor-extra-args` 3, `tests/executor-sandbox` 15.

**Re-analysis ($0):**
- `node experiments/swarm/analyze-r1.mjs --stage heldout [--rule a2|a3|frozen] --out research/swarm-20261021`
- `node experiments/swarm/report-r1.mjs [--rule a2|a3] --out research/swarm-20261021`
- `node experiments/swarm/trace-unexplained.mjs --out research/swarm-20261021/TRACE-UNEXPLAINED-R1.jsonl`
- `node experiments/swarm/delivery-gate.mjs research/swarm-20261021/runs/calibrate-results.jsonl` (exit 7: not delivered)

**Seed ledger:**
- `swarm-r1-heldout` (wbed-r6 test 9301–9310, used; 9308–9310 were generated only for freeze hashes);
- `swarm-r1-dev` (365–368, used);
- `wbed-heldout-c`: exposure of wbed-r6 test 8401–8406 recorded; status unchanged (the owner's decision).

## 10. Review fixes (2026-11-04) and changed hashes

The design review of commits df9f0d07, 01221415 and 17c4ee0a found one blocker, six major findings and ten minor ones.

| finding | what changed |
|---|---|
| B1 audit bug | `shell-scan.mjs` (new), `writesOf` in `spawn-tree.mjs`, `void-audit.mjs` (guarded `under()`, token-based creation, whole-path naming, Amendment 3 kind); `analyze-r1.mjs` reports all three rules; §1–§3, the prereg's Amendment 2 text, both SUMMARY files and the D3 row corrected |
| M1 no delivery gate | `delivery-gate.mjs` + test; disclosed in §2 and §5.2 |
| M2 falsifiers | §1 and §4 state the frozen outcomes as written: inconclusive, treatment not delivered |
| M3 D3 row | `REQUIREMENTS-COVERAGE-20261021.md` D3: "B/D, ⚠ treatment not delivered", K = 1, post-hoc void rules, gap restated |
| M4 S-F cost | §1, §3 and §5.4 report S-F against A and S |
| M5 tests | analysis tests that reach the audit (all flagged; unauditable trial), void-audit tests with fake write targets and Amendment 3, writesOf heredoc/arrow/comparison cases, shell-scan tests, K8 regression |
| M6 cheaper approaches | §8 items 1 and 3 |
| minor 1, 2, 3 | §2 counts; the `analyze-r1.mjs` comment (10 of 14); creation needs a whole path (tested) |
| minor 4 | K8 regression test |
| minor 5 | `trace-unexplained.mjs`: 57 of 57 traced; §5 |
| minor 6 | §2 (launcher committed after its call) |
| minor 7 | the one-call figure moved out of the held-out table, with both efforts |
| minor 8 | §2 and §7 (W builder effort high, not max) |
| minor 9 | seed-ledger `exposures` on `wbed-heldout-c` |
| minor 10 | §1, §7 and §8 (no Opus reference) |

**Hashes that no longer match FROZEN-R1.json** (code the frozen run or analysis executes, changed after the run;
FROZEN-R1.json is left as frozen):
- `experiments/swarm/spawn-tree.mjs` (B1; frozen 79726e9a…). The run itself used the frozen version; the archived
  spawn trees hold its write lists.
- `experiments/swarm/analyze-r1.mjs` (Amendment 2 in 17c4ee0a, then three rules here; frozen 1068129e…).
- `research/swarm-20261021/PREREG-SWARM-R1.md` (amendments appended; frozen 23369a6c…).

**Earlier manifests.** The review also asked for a privacy check. The host account's e-mail address occurs **0 times** in
this branch's files at HEAD and in this item's commits; the check counted exact-string matches and printed none. So no
file was rewritten for privacy, and no file hash changed for that reason. The address does occur in four inherited
ancestor commits (a48e1ab1, ae69ec4c, e20d96d5, 778d14b6; two run records of the surface-20261021 item), and 728de1aa
removed it from the tree. Rewriting that history is the orchestrator's decision and was not done here. Other webmail
addresses at HEAD are an AutomationBench default-sender fixture and upstream LICENSE author lines, which are not personal
data of the host account.
