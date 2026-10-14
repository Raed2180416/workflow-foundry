# W-bed R6: what landed

*2026-10-14, cloud session. Cost $0: no model calls. `beds/sealed/` was not read; no credentials were used. Nothing under
`src/`, `experiments/`, `policy/`, `schemas/`, `bin/`, `skills/` or any bed outside `beds/wbed/` was changed, and no other
W-bed export changed behaviour. Design reference: [W-BED.md](W-BED.md) §2, §2.4, §3.6, §3.8, §6, §8;
[FLOW-V3.md](FLOW-V3.md) §2.3; [PRIOR-ART-SWARMS.md](PRIOR-ART-SWARMS.md); [PRIOR-ART-MANAGED-AGENTS-DW.md](PRIOR-ART-MANAGED-AGENTS-DW.md);
`briefs/flow-v3-slice2-brief.md` item 6 (and 1c, 3b, 6b). Conventions follow [W-BED-R5-NOTES.md](W-BED-R5-NOTES.md). Tags:
**[M]** measured here or read in the repo, **[I]** inference. The claim this bed exists to test is PROOF-LEDGER **B6**:
a `wide` swarm beats `best_of_n` at equal tokens on verified success. The bed cannot decide B6 at $0; it makes the paid
comparison possible and exact.*

## 1. Files

| path | what |
|---|---|
| `beds/wbed/r6/index.mjs` | family `wbed-r6` v1.0.0 "wide research table": the bed interface plus `stages`, `relations`, `composedOracle`, `referenceTrace`, `structure`, `invariants`, `necessityControls`, and the R6-specific `unitChecks`, `keywordScript`, `whiteboxSolve`, `textIndex`, `tokenAccounting`, `bestOfNRun`, `scopeOf`, `sizeOf`, `taskTokens` |
| `beds/wbed/r6/vocab.mjs` | properties with exact unit maps, standard and non-standard conditions, labs, name and code pools, document kinds, the three ranking policies, `LEVELS`, `MAX_FANOUT` 32, the d5 phrasing tier rule |
| `beds/wbed/r6/world.mjs` | the world: labs, cut-off, compounds with roles, documents with claims, quotes, predictions, plans, notices, the register; per-cell winner/loser/trap construction; decisiveness re-draw |
| `beds/wbed/r6/render.mjs` | one text file per document (`files/corpus/Dnnn.txt`), the prompt (rules), `inputs` (question, properties, register) |
| `beds/wbed/r6/pipeline.mjs` | the exact solver as stages (index, plan, worker, reduce) with one option per mistake; `textIndex` (the code mention index) |
| `beds/wbed/r6/score.mjs` | `outputSchema` and the exact end-to-end scorer |
| `beds/wbed/r6/stages.mjs` | stage contracts and oracles; relations Y1–Y5; `composeOracle` |
| `beds/wbed/r6/controls.mjs` | 28 bad controls, 4 necessity / comparison controls |
| `beds/wbed/r6/budget.mjs` | the attention model, equal-token accounting for wide vs best_of_n |
| `beds/wbed/r6/verify.mjs` | `unitChecks`: the code half of the verify, from task text only |
| `beds/wbed/r6/heuristic.mjs` | the keyword script (text-only bad control) |
| `beds/wbed/r6/whitebox.mjs` | the white-box script (generator templates, text only): decidability witness and reported attack |
| `beds/wbed/r6/r6.test.mjs` | 30 oracle-health tests |
| `beds/wbed-r6/index.mjs` | registration shim; `loadFamily('wbed-r6')` works (tested) |
| `beds/wbed/attacks/triviality.mjs` | rung table gains `r6` (gate: one call ≤ 2/12; necessity: no plan) |

`beds/wbed/lib/faults.mjs` is unchanged: R6 calls its `requireNoFaults`, `hooks.schemaDrift` (world) and
`hooks.adversarialContent` (files) at the documented places; every hook is a no-op and a fault request throws (tested).
f3 lists R6 already; f2 does not, as in W-BED §3.8.

A coordinator's WIP snapshot (9070b0c, "unreviewed") committed an in-progress copy of these files; the R6 commit
replaces it with the reviewed version.

## 2. The task

A research consortium's corpus: **200 / 260 / 320 / 400 documents** at d2–d5 (exactly), one text file each: journal
articles (labels "Journal article", "Letter", "Full paper"), preprints and their version 2, journal versions of
preprints, lab notes ("Lab note", "Technical memo"), reviews, errata ("Erratum", "Correction"), retraction notices,
expressions of concern, and consortium notices. 30–60 fictional compounds, each with an invented name and a code
("lumeprazine (VX-1043)").

**The question** names a lab X and a date Y: *which compounds did lab X itself test on or after Y?* For each, report the
accepted value of the 3–5 requested properties, and list the void documents that mention any of them. The compound
list is not in the prompt or the inputs; it must be discovered. The prompt states the rules:

- **Labs.** A document names its lab in the Affiliation line, by full name, abbreviation (d ≥ 3; the membership notice
  maps them) or former name (d ≥ 4; a rename notice states it). An organisation sharing a word of the name (d ≥ 4) is a
  different organisation.
- **Tests.** An own measurement of the compound, any property and condition, bounds included. Quotes, predictions and
  plans are not tests. A lab's tests are reported only in its own documents. A test is dated by the measurement date in
  the methods ("made on", "assayed between", "the week beginning", d5 held-out forms below), not the publication date.
  A test reported only in a void document does not count.
- **Resolution** (synth's policy, reduced, §9 item 1): void documents (retraction; version 2 or journal version
  replaces the preprint; a notice refers to a corpus document only if every detail matches), errata (the corrected value
  is cited as the corrected document), standard conditions, quotes, predictions, bounds, document-level n, units, and a
  ranking policy drawn per task (P1 venue-n-recency; P2 venue-recency from d3; P3 n-venue-recency from d4).
- **Answer.** `{table: [{entity, property, value, source_doc_id}], excluded_doc_ids}`: one row per (in-scope compound,
  requested property); `entity` by code or name; `value` in the canonical unit at the stated precision. Excluded: every
  void research document that mentions an in-scope compound.

**Fan-out width.** In-scope compounds 8 / 12 / 16 / 20 (±2 per task), plan candidates (compounds mentioned in a lab X
research document published on or after Y) 10–14 / 14–20 / 19–24 / 24–29, never above `MAX_FANOUT` = 32 [M, dev
301–320]. The width varies per task so a compiled solver cannot learn a fixed count.

**The traps** (each placed by construction on every task where it applies, then made decisive by the re-draw):

| kind | what | from |
|---|---|---|
| scope T1 | lab X tested it only before Y, in a document published after Y | d2 |
| scope T2 | lab X documents after Y only quote it (one gets its own titled "background note") | d2 |
| scope T3 | lab X's only test after Y is in a retracted document (which mentions nothing in scope) | d2 |
| scope T4 | lab X plans to test it ("will be tested in the next phase"; one in its own titled plan note) | d2 |
| scope alias | an in-scope compound tested only under lab X's abbreviation (d3) or former name (d4) | d3 |
| scope code-only | an in-scope compound named only by code in its establishing document, by name in another | d3 |
| scope namesake | a compound tested after Y by an organisation sharing lab X's stem | d4 |
| cell | a retracted / superseded / non-standard / quoted / predicted / bound claim that would outrank the winner; an erratum on the winner; a winner in a non-canonical unit; a newer loser the policy ranks lower | d2 |
| cell | an expression of concern on the winner | d3 |
| cell | a retraction of an out-of-corpus article sharing the winner's title (other first author and year) | d4 |

**No completeness shortcut.** Every near-miss candidate and the namesake compound have surviving standard claims for
every requested property, as in-scope compounds do (tested). Before this fix, "drop the candidates with missing
properties" recovered the scope without any test-date or void judgment; the code verifier's recall exposed it (§6.3).

**Held-out tier** (W-BED §2.5; the R5 pattern). d2–d4 use one test-date phrasing set on both splits. At d5 about 45% of
research documents use a split-specific form: on split dev a "Sample log" table (`compound | received … | assayed …`) and
the document kind "Conference abstract" (ranks with preprints); on split test "All assays were run k days after the site
visit of DATE" and "Technical report" (ranks with lab notes). Held-out tasks therefore carry phrasing and a document kind
no dev task carries (tested on dev 301–320 and held-out 8201–8202, 8301–8302).

## 3. Oracle composition

**End-to-end** (`scoreTable`). Exact: the in-scope set exactly (missing or extra compounds fail), one row per
(compound, requested property), `round(value × 10^dec)` equal to the true integer, `source_doc_id` equal, the excluded set
exact. Every printed unit maps exactly to the canonical integer (K = °C + 273.15 at 2 decimals; °F = °C × 1.8 + 32 at 2
decimals; µg/mL, mg/100 mL, min, µM, pM, kg/m³ by integer factors): tested over every unit of every property. Details
carry counts only (synth 3.0.0 rule).

**Stages** (`stages`, analyst-side diagnostics, never success criteria):
- `index`: the code mention index (per code: name, mention documents) — exact;
- `plan`: recall-oriented — every in-scope compound once, no duplicate, no unknown string, ≤ 32; extra candidates
  allowed;
- `worker`: per item, independently — the scope verdict; for in-scope items the cells and the void documents;
- `reduce`: local checks only.

**Cross-item relations:**
- Y1 plan-index: every candidate resolves through the trace's index to one compound, no two to the same;
- Y2 worker coverage: one item per candidate, none dropped;
- Y3 table carried: the table is exactly the in-scope items' cells;
- Y4 void union: the excluded set is the union of the in-scope items' void documents;
- Y5 sources live: every source mentions its compound and is not excluded.

The composed oracle (all stages AND Y1–Y5) agrees with the end-to-end oracle on the reference trace and on every
control's trace (tested, dev 301–303, d2–d5). Composed pass implies end-to-end pass by construction: correct verdicts and cells per item, full coverage, and a carried table and void union reproduce the answer.

**Construction = resolver.** Each cell's constructed winner is the resolver's winner, and the roles are the resolver's
scope, on every task tested (dev 301–308, d2–d5) [M].

**Decidability witness.** `whiteboxSolve` parses the task text with the generator's templates and applies the prompt's
rules. It reproduces the oracle's truth on **every** task: dev 301–320 and held-out 8201, 8202, 8301, 8302, at d2–d5
(96/96) [M]. So the text conveys the truth, the rules leave nothing open, and no hidden fact decides an answer. The
mention index from text equals the world's mention records, and every compound's name↔code pair is recoverable from the
register or a "name (CODE)" mention (tested).

## 4. Controls and their scores

**28 bad controls** (23 apply at d2, 26 at d3, 28 at d4–d5) and **4 necessity / comparison controls**. Every applicable
control fails the oracle on every one of dev 301–320 at every difficulty and on the held-out seeds (tested; generator
re-draws 0 / 0 / 0 / 1 over 20 seeds at d2–d5). Mean oracle score (dev 301–310, d2 / d3 / d4 / d5) [M]:

| control | kind | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|
| empty | stage | 0.00 | 0.00 | 0.00 | 0.00 |
| shuffled-or-corrupted | stage | 0.15 | 0.15 | 0.15 | 0.15 |
| scope-by-publication-date | stage (worker) | 0.90 | 0.93 | 0.94 | 0.94 |
| scope-mentions-counted | stage (worker) | 0.76 | 0.76 | 0.85 | 0.83 |
| scope-void-kept | stage (worker) | 0.74 | 0.77 | 0.76 | 0.78 |
| scope-plans-counted | stage (worker) | 0.88 | 0.87 | 0.93 | 0.92 |
| scope-alias-missed | stage (plan) | — | 0.66 | 0.59 | 0.62 |
| scope-code-and-name-twice | stage (plan) | — | 0.93 | 0.95 | 0.96 |
| scope-namesake-lab | stage (worker) | — | — | 0.90 | 0.96 |
| retracted-claims-used | stage | 0.68 | 0.75 | 0.74 | 0.76 |
| superseded-kept | stage | 0.80 | 0.81 | 0.81 | 0.82 |
| errata-skipped | stage | 0.95 | 0.96 | 0.96 | 0.97 |
| erratum-cited | stage | 0.95 | 0.96 | 0.96 | 0.97 |
| nonstandard-counted | stage | 0.81 | 0.83 | 0.86 | 0.89 |
| quotes-counted | stage | 0.90 | 0.89 | 0.91 | 0.93 |
| predictions-counted | stage | 0.95 | 0.97 | 0.97 | 0.97 |
| bounds-counted | stage | 0.93 | 0.95 | 0.95 | 0.96 |
| no-unit-conversion | stage | 0.67 | 0.73 | 0.78 | 0.73 |
| recency-only | stage | 0.58 | 0.64 | 0.69 | 0.68 |
| concern-voids | stage | — | 0.82 | 0.82 | 0.82 |
| retraction-by-title | stage | — | — | 0.84 | 0.84 |
| excluded-corpus-wide | relation (Y4) | 0.85 | 0.85 | 0.85 | 0.85 |
| one-excluded-missing | relation (Y4) | 0.85 | 0.85 | 0.85 | 0.85 |
| map-null-filtered | relation (Y2) | 0.81 | 0.91 | 0.93 | 0.91 |
| reduce-lost-item | relation (Y3) | 0.81 | 0.91 | 0.93 | 0.91 |
| reduce-cells-misjoined | relation (Y3) | 0.15 | 0.15 | 0.15 | 0.15 |
| reduce-excluded-all-candidates | relation (Y4) | 0.85 | 0.85 | 0.85 | 0.85 |
| **heuristic:keyword-script** | heuristic (text only) | 0.13 | 0.17 | 0.17 | 0.16 |
| **necessity:no-plan-fixed-list** | necessity | 0.61 | 0.54 | 0.56 | 0.55 |
| **sequential-single-context** | necessity (size) | 0.36 | 0.21 | 0.16 | 0.09 |
| **best-of-n:equal-tokens** | comparison | 0.40 | 0.22 | 0.15 | 0.07 |
| **no-workflow:grep-agent** | comparison | — | 0.45 | 0.43 | 0.46 |

The four required controls:
- **best_of_n** (`best-of-n:equal-tokens`). N = max(3, N at equal tokens) single-context solves (§5), candidate i
  starting at document ⌊i·D/N⌋, each reading up to the 32K budget. The same verifier selects: `unitChecks` plus a
  stand-in *perfect* panel on a 20% sample of the candidate's rows. Every candidate fails, not only the one selected
  (tested, dev 301–305, d2–d5). N was 5–8 / 9–12 / 11–14 / 14–17 [M].
- **Single-context sequential** (`sequential-single-context`). Reads in id order and nothing past 32K tokens. Every task
  is above the budget at every difficulty: inline 48–50K / 63–66K / 77–79K / 102–104K; unread documents 73 / 135 / 196 /
  285 of 200 / 260 / 320 / 400 [M].
- **Keyword/heuristic** (`heuristic:keyword-script`, 49 lines, task text only). Scope from the full-name affiliation and
  the publication date; the first number after the property keyword; journal-then-recent; voids by quoted title. It
  scores 0.13–0.17 and fails every task [M].
- **No workflow.** Two readings are implemented:
  - `necessity:no-plan-fixed-list` (W-BED §2.4 item 3, "R6 without a plan"): the reference workers over the register's
    compounds registered by lab X, with exact scope confirmation. By construction it misses ≥ 2 in-scope compounds on
    every task (tested on all 80 dev tasks), so it fails 100% of attack seeds against the ≥ 50% bar.
  - `no-workflow:grep-agent` (d ≥ 3): an agent with tools and no workflow. It greps Affiliation lines for the full name,
    reads those documents and every notice, greps each compound it found by the string it saw, and answers exactly from
    what it read. It misses an alias-only compound unless a full-name document names it: 27 of 40 alias-only compounds
    on dev 301–308 were hidden that way, and the agent missed 31 of the 40 [M]. At d2 (no aliases) it would pass, so it
    starts at d3.

## 5. The B6 comparison: equal tokens, one verifier

**What `wide` reads** (`tokenAccounting`, input tokens, utf8/4, means over dev 301–320) [M]. Two worker designs are
counted:
- **chain** (the declared reference): a scope judge per candidate, then one judge per requested property for in-scope
  candidates, each reading the candidate's context;
- **one-call**: one typed judgment per candidate returning scope and all cells.

The verify is a panel of 3 on 20% of cells, with each judge reading either the compound's evidence or only the cited
source.

| | d2 | d3 | d4 | d5 |
|---|---|---|---|---|
| inline task (one read of everything) | 48.9K | 63.9K | 77.8K | 103.3K |
| plan (prompt + header digest + consortium notices) | 13.2K | 16.4K | 20.0K | 25.5K |
| workers, chain / one-call | 204K / 65K | 453K / 111K | 676K / 163K | 1,173K / 234K |
| largest worker context | 6.9K | 8.0K | 9.1K | 10.4K |
| verify, evidence / source only | 93K / 55K | 215K / 125K | 317K / 200K | 567K / 346K |
| **total, declared (chain + evidence verify)** | 311K | 685K | 1,013K | 1,766K |
| total, lean (one-call + source-only verify) | 133K | 252K | 383K | 605K |
| model calls, workers / verify | 35 / 15 | 64 / 30 | 85 / 39 | 127 / 60 |
| cacheable share of worker input (shared prefix) | 0.86 | 0.90 | 0.91 | 0.92 |
| **best_of_n N at equal tokens**, declared / one-call / lean | 4–8 / 2–4 / 2–3 | 8–12 / 4–6 / 3–4 | 11–14 / 5–7 / 4–5 | 14–18 / 7–8 / 5–6 |

What this says [I]:
1. `wide` is not a token saver here. It reads 2.7–17× the inline task, depending on design, because every worker
   re-reads the notices and every panel judge re-reads evidence. The B6 comparison is therefore a real fight: best_of_n
   at equal tokens gets many full reads.
2. The worker design changes N by about 2×, and the verify reading by a further 20–30%. The PREREG must fix the arm (c)
   reference design before computing N.
3. Every `wide` context stays under 11K tokens, below both the 32K attention budget and Haiku's 100K price step. Every
   best_of_n candidate at d5 reads 102–104K and pays $0.50/MTok instead of $0.10. **At d5, equal tokens is about 5×
   the dollars for best_of_n.** B6's falsifier ("or matches it only at higher cost") must be read in dollars too, and
   the report should give both.
4. 86–92% of `wide`'s worker input is a shared prefix (rules and notices first, then the candidate's documents). Prompt
   caching (slice 2 item 6b) is worth up to that share of worker input at the cache-read price.

**One verifier for both arms.** `unitChecks(task, output)` is the code half of the verify. It reads only the task:
schema, non-empty table, requested properties, known compounds, one row per cell, complete compounds, source exists /
is research / mentions the compound / not void by title (with the first author when the notice gives one) / not
excluded, plausible value range, excluded documents void by title. It accepts the reference on every task. Its flag rate
per control (dev 301–310, d2–d5) [M]:
- **flags ≥ 35/40 tasks (14 controls):** empty, shuffled, retracted-claims-used, superseded-kept, erratum-cited,
  no-unit-conversion, reduce-cells-misjoined, heuristic, sequential, best-of-n, code-and-name-twice, concern-voids,
  grep-agent, retraction-by-title;
- **never or rarely (18 controls):** every scope verdict mistake (publication date, mentions, void kept, plans, alias
  missed; namesake 4/20), errata-skipped, non-standard, quotes, predictions, bounds, recency-only, the four Y2–Y4
  relation controls, and the no-plan fixed list.

So the code checks catch structural damage. Semantic resolution errors need the panel. **Coverage errors (a compound
missing) are invisible to both** a code check of the output and a panel that samples rows: only the plan's `check`
against the index (gaps) can see them, and only if the check knows lab X's other names. The bed's best_of_n selection
uses a perfect sample panel, which still cannot rescue a candidate that never read the documents.

**What the bed's best_of_n control is and is not.** It is a deterministic stand-in that encodes one hypothesis: a single
context loses what lies past ~32K tokens. Under that hypothesis no candidate can be right, so selection cannot help. It
does not model sample diversity, nor a best_of_n of agents with tools; the grep-agent control is the deterministic
version of the latter. **B6 is decided only by the paid run:** arm `wide` (reference or JIT-built) vs arm `best_of_n`
(N Haiku agents, the same verify: `unitChecks` plus the panel, at equal tokens computed from the ledger), on the same
tasks, under the PREREG decision rule.

## 6. Measured sizes and runtime

| | d2 | d3 | d4 | d5 |
|---|---|---|---|---|
| documents (research) | 200 (187) | 260 (239) | 320 (291) | 400 (367) |
| compounds in world / in scope (range) / candidates (range) | 30 / 6–10 / 10–14 | 40 / 10–14 / 14–20 | 50 / 14–18 / 19–24 | 60 / 18–22 / 24–29 |
| cells (mean) | 23 | 47 | 63 | 100 |
| excluded documents (range) | 2–6 | 2–8 | 3–7 | 2–13 |
| corpus tokens (mean) | 45.1K | 59.3K | 72.4K | 96.8K |
| inline task tokens (min–max) | 48.1–49.7K | 62.9–66.0K | 76.6–79.4K | 102.0–104.4K |

(dev 301–320 [M]). Generation takes 0.1–0.5 s per task including the decisiveness check over 32 controls; the oracle
takes milliseconds. The 3 s runtime test at d5 cold passes [M].

**Triviality attack, dry run** (`node beds/wbed/attacks/triviality.mjs --rung r6`, attack seeds 379–390): 24 calls.
- d3: inline mean 63.9K tokens, token-priced **$0.23** list.
- d5: mean 105K. The driver prints $0.36, but it does not model the 100K price step. At $0.50 / $2.50 per MTok above
  100K, the d5 attack costs about **$1.5–2.0** [I].
- Stubs: reference 12/12. Every comparison control 0/12: empty, best-of-n, sequential, no-plan, keyword, grep-agent [M].

## 7. Cost estimates (Haiku 5.5 list: $0.10 / $0.50 per MTok, $0.50 / $2.50 above 100K tokens per prompt)

| arm, per R6 task | d3 | d5 |
|---|---|---|
| one call (attack) | ≈ $0.01 [M: $0.23 / 24] | ≈ $0.06–0.08 (above the price step) [I] |
| reference `wide`, declared design, no caching | ≈ $0.07 input + ≈ $0.01 output [I from §5] | ≈ $0.18 + $0.01 [I] |
| reference `wide`, with prefix caching (≈ 0.9 cacheable at 0.1×) | ≈ $0.02 [I] | ≈ $0.04 [I] |
| best_of_n at equal tokens | ≈ $0.07 (all reads under 100K) [I] | ≈ $0.85 (every read above 100K) [I] |
| Haiku agent (arm d), W-BED §3.6 | $0.5–1.5 [I] | same, toward the top [I] |

W-BED §3.6 estimated the reference at $0.2–0.6. The token arithmetic says less, but the claude-cli per-call overhead
for 100–190 small judge calls per task is unmeasured (W-BED O5; FRONTIER-GAPS D22 measured $0.00011 per tiny judge
call). Measure it on 20 calls before R6 runs.

## 8. Seeds

No ledger edit was needed. `research/jit-20261008/SEED-LEDGER.json` already lists `wbed-r6` in `wbed-dev` (dev
301–390, allow jit-dev) and in `wbed-heldout-a` … `-d` (8201–8224, 8301–8324, 8401–8424, 8501–8524, allow
jit-heldout).
- Tests use dev 301–320.
- The attack plan uses dev 379–390.
- Generator checks use held-out 8201, 8202, 8301, 8302. As in R5, these are generated and scored at $0 by the bed's
  own tests only; no arm sees them, and nothing is consumed.
- Fixture seeds for the reference author: 373–378, per W-BED §2.3.

## 9. Deviations from W-BED.md, and why

1. **A new world, not "synth scaled up".** synth's world is built around a short list of requested cells. It has no
   labs, test dates or alias forms. Stitching several synth worlds would make notice references ambiguous across them.
   R6 therefore has its own generator with a **reduced synth policy**:
   - **kept:** retractions, version and journal-version supersession, value errata (cited as the corrected document,
     void targets ignored), standard conditions, quotes, predictions, bounds, units, document-level n, expressions of
     concern, out-of-corpus references by mismatched detail, and three ranking policies;
   - **dropped:** press releases, factor / condition / n errata, named protocols, results tables, replicate lists,
     pronoun units, salts and near-name compounds.

   R6's difficulty is breadth and discovery. Per-compound resolution is a narrower chain than synth L3–L5.
2. **Exact oracle, not synth's 1% tolerance.** Values are compared exactly at the stated precision, because every unit
   map is decimal-exact (§3). This follows W-BED §2.2 item 1.
3. **Void documents are those that mention an in-scope compound, not the whole corpus** (synth lists all). This keeps
   the task separable (W-BED §3.6 "Separability") and ties the void list to the discovered set (Y4).
4. **"Tested by lab X after date Y" is made exact.** It becomes "on or after", dated by the measurement, with alias
   forms. "Test" is defined as an own measurement, bounds included.
5. **The necessity control's "fixed entity list taken from the prompt"** comes from `inputs.register` (compounds
   registered by lab X). The prompt names no compound, so a fixed list has to come from the inputs.
6. **The plan stage oracle is recall-oriented.** Extra candidates are allowed. W-BED does not say; a plan that
   over-generates and lets workers confirm is the natural `wide` shape, and Y1 still forbids duplicates.
7. **"best_of_n at equal tokens" is made concrete** (`tokenAccounting`, §5): N comes from the declared reference design,
   with N ≥ 3. The bed's control is a stand-in under a stated hypothesis, not the B6 arm.
8. **The held-out tier is a d5 phrasing tier** (split-specific, as R5's formats), not a held-out rung. RH stays the
   held-out rung (W-BED §3.9).
9. **The fan-out width varies ±2 per task**, quoted and planned compounds get their own titled notes, and near-miss
   compounds have complete data. These are anti-shortcut measures W-BED does not ask for (§2).
10. **The corpus is in `files`, not `inputs`**, so agent arms can grep it (R5 convention for the dump).

## 10. What the engine needs from `flow.wide` (compared with slice 2 item 6)

Slice 2 item 6 builds "`flow.wide` … over a bounded, typed work list with a code reducer, per item judgment,
concurrency cap and total budget; events per item; test against beds/wbed/r3 (fan-out N up to 48)". Items 6b (prefix
sharing), 3b (per-item failure policy) and 1c (phase events) are related. FLOW-V3 §2.3 has the fuller spec. R6 needs
the following; each is an E2-record change.

1. **The plan → check → one replan loop, explicitly** (FLOW-V3 §2.3; item 6 says only "bounded, typed work list"). The
   check must read a code index built from the task files (`ctx.files`, as R5 item 10 asks for the agent's verify). It
   reports unknown codes, duplicates (a name and a code for one compound: `scope-code-and-name-twice`) and gaps.
2. **A worker that is a chain, not one judge.** FLOW-V3's worker forms are `judge | call | agent`. R6's reference worker
   is a scope judge, then k property judges, then a code step. Needed: `worker: async (item, ctx) => …` with a per-item
   span, or `{ call: { hash } }` to a compiled per-compound callee.
3. **Typed per-item outcomes that separate "done, out of scope" from "failed".** `{in_scope: false}` is a result, not a
   failure. With 3b's `onItemError: 'null'`, coverage must reach the reducer typed, and Y2 must hold as a code
   invariant. `map-null-filtered` is exactly what `.filter(Boolean)` produces: one in-scope compound silently gone, the
   table internally consistent. 3b's default `crash` is right for R6.
4. **Per-item input slicing.** Each worker should see only its compound's mention documents plus the notices (a file
   subset per item, as R5's agent gets only the dump directory). Without it every worker gets the 100K corpus, and both
   the size advantage and the price-step advantage disappear.
5. **Prefix sharing (6b) as a measured lever.** 86–92% of worker input is a shared prefix if prompts are laid out as
   rules + notices, then the compound's documents, then the property question. The prefix holds per compound across its
   1 + k calls. The ledger must report cache-read tokens per `wide` node.
6. **A verify that is both a panel on a sample of *cells* and a code predicate, AND-ed** (FLOW-V3 says "panel or a code
   predicate"). It needs:
   - a seeded sample (replay determinism);
   - a hook to give each panel judge its cell's evidence (`verify.sampleOf(results, ctx)`);
   - the independence label `same-model (correlated)` for a Haiku panel;
   - a panel rejection that deopts at item granularity (re-run that worker), not the whole `wide`.
7. **Per-phase token accounting in events** (input, output, cache read, cache write for plan, workers and verify).
   Without it "equal tokens" for best_of_n cannot be computed from a run. `tokenAccounting` is the bed's ex-ante
   estimate.
8. **`best_of_n` with the same verify object** (ROADMAP §2.1). This is not in slice 2. B6 needs
   `flow.bestOfN({ n, solve, verify })` or a harness arm that reuses the `wide` verify (panel + `unitChecks`) verbatim.
9. **`maxFanout` 32 versus item 6's R3 test.** R6 stays at or below 32 (24–29 at d5). But R3 d5 has 48 suppliers, and
   item 6 says "test against beds/wbed/r3 (fan-out N up to 48)". FLOW-V3 §2.3 refuses a plan longer than `maxFanout`.
   Either raise the cap with evidence, chunk the plan, or test R3 only up to 32.
10. **Budget.** `BUDGET_TOO_SMALL` uses `maxFanout × worker floor`. R6's worker floor is (1 + k) calls of 7–11K tokens
    for the chain design. `perTaskUsd(R6)` must cover the plan, up to 29 × 6 worker calls and 60 panel calls.
11. **Trace exposure for the composed oracle.** `trace.index`, `trace.plan.candidates`,
    `trace.worker.items[{entity, in_scope, cells, void_doc_ids}]` and `trace.reduce` must be written under span names by
    `stream.mjs` (the analogue of R4 item 6 and R5 item 17).
12. **Judge workers only.** Agent workers would hit the 2-concurrent / 16-per-run limits at 24–29 candidates (W-BED O3).
13. **Phase events (1c)** for plan, workers, reduce and verify. They give the critical-path wall-clock metric of W-BED
    §6.2 for R6.

## 11. Open questions

1. Which worker design is the arm (c) reference? Chain (narrow decisions, ROADMAP P1) or one-call (cheaper)? It halves
   or doubles best_of_n's N at equal tokens (d5: 14–18 vs 7–8).
2. Should the panel read the evidence or only the cited source? Source-only is cheaper and blind to a better-ranked
   claim. The bed counts both.
3. Should the falsifier be read at equal tokens, equal dollars, or both? At d5 they differ by about 5× because of the
   100K price step (§5).
4. The 32K attention budget behind the size controls is a hypothesis. The paid one-call attack (≈ $0.23 at d3, ≈ $2 at
   d5) measures the real failure. If one Haiku call passes > 2/12, the rung is dropped by W-BED §2.4.
5. The white-box script passes 100%. As with synth, a code-writing arm that had the generator source would solve R6
   outright. JIT arms never see the source. B6 compares two model arms and is unaffected; the claim should say so.
6. Coverage errors (a missing compound) are invisible to output-side verification (§5). Should `wide.check` be required
   to prove completeness against the index? That needs a model reading of lab X's alias notices, so it is a judged
   check, not code. Or is "gaps" reporting enough?
7. Should R6 rather be the held-out rung (W-BED §11.1)? It currently has a held-out phrasing tier at d5 only.
8. PROOF-LEDGER B6 should move from "—" to **B** (bed built and $0-tested). That file belongs to the coordinator, so it
   was not edited here.

## 12. Test run

- `node --test --test-concurrency=2 beds/wbed/r6/r6.test.mjs beds/wbed/attacks/triviality.test.mjs`, on the final code:
  **36 tests, 36 pass** (R6 30, attack driver 6) [M].
- Full W-bed suite (lib, attacks, R0–R6; `beds/wbed/r3p/` excluded as another agent's work in progress), on the final
  code with `--test-concurrency=2`: **157 tests, 157 pass**, 282 s [M]. Every R0–R5 test stays green.
