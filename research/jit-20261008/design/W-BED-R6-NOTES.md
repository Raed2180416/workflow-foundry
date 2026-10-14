# W-bed R6: what landed

*2026-10-14, cloud session. Revised the same day after an adversarial review (§13): family version **1.1.0**. Cost $0:
no model calls. `beds/sealed/` was not read; no credentials were used. Nothing under `src/`, `experiments/`, `policy/`,
`schemas/`, `bin/`, `skills/` or any bed outside `beds/wbed/` was changed, and no other W-bed export changed behaviour.
Design reference: [W-BED.md](W-BED.md) §2, §2.4, §3.6, §3.8, §6, §8; [FLOW-V3.md](FLOW-V3.md) §2.3;
[PRIOR-ART-SWARMS.md](PRIOR-ART-SWARMS.md); [PRIOR-ART-MANAGED-AGENTS-DW.md](PRIOR-ART-MANAGED-AGENTS-DW.md);
`briefs/flow-v3-slice2-brief.md` item 6 (and 1c, 3b, 6b). Conventions follow [W-BED-R5-NOTES.md](W-BED-R5-NOTES.md). Tags:
**[M]** measured here or read in the repo, **[I]** inference. The claim this bed exists to test is PROOF-LEDGER **B6**:
a `wide` swarm beats `best_of_n` at equal tokens on verified success. The bed cannot decide B6 at $0, and after the
review it says so more plainly: **no $0 evidence separates `wide` from a single context or from an agent with tools**
(§5, §13). It makes the paid comparison possible and exact.*

## 1. Files

| path | what |
|---|---|
| `beds/wbed/r6/index.mjs` | family `wbed-r6` v1.1.0 "wide research table": the bed interface plus `stages`, `relations`, `composedOracle`, `referenceTrace`, `structure` (with `structure.b6`, the B6 protocol the PREREG must adopt), `invariants`, `necessityControls`, and the R6-specific `unitChecks`, `codePlan`, `coverageIssues`, `keywordScript`, `whiteboxSolve`, `textIndex`, `tokenAccounting`, `bestOfNRun`, the reported ablations `planAblation` and `grepAgentRun`, `scopeOf`, `sizeOf`, `taskTokens` |
| `beds/wbed/r6/vocab.mjs` | properties with exact unit maps, standard and non-standard conditions, labs, name and code pools, document kinds, the three ranking policies, `LEVELS`, `MAX_FANOUT` 32, the d5 phrasing tier rule |
| `beds/wbed/r6/world.mjs` | the world: labs, cut-off, compounds with roles, documents with claims, quotes, predictions, plans, notices, the register; per-cell winner/loser/trap construction; decisiveness re-draw (refuses to build without the verifier) |
| `beds/wbed/r6/render.mjs` | one text file per document (`files/corpus/Dnnn.txt`), the prompt (rules), `inputs` (question, properties, register) |
| `beds/wbed/r6/pipeline.mjs` | the exact solver as stages (index, plan, worker, reduce) with one option per mistake; `textIndex` (the code mention index) |
| `beds/wbed/r6/score.mjs` | `outputSchema`, the exact end-to-end scorer, `resolveWith` (code, name or "name (CODE)") |
| `beds/wbed/r6/stages.mjs` | stage contracts and oracles; relations Y1–Y5; `composeOracle` |
| `beds/wbed/r6/controls.mjs` | 29 bad controls, 2 necessity controls (the size stand-ins) |
| `beds/wbed/r6/budget.mjs` | the attention model; `workerSlice` (the declared worker context); `agentReadSet` and `agentTokens` (an agent with tools); token and dollar accounting for wide vs best_of_n with output and thinking tokens and the 100K price step; `nAtEqual` for ledger numbers |
| `beds/wbed/r6/verify.mjs` | `unitChecks`: the code half of the verify, from task text only; `codePlan` and `coverageIssues`: the plan and its check as code; `parseDay` |
| `beds/wbed/r6/heuristic.mjs` | the keyword script (text-only bad control; a strawman, §3) |
| `beds/wbed/r6/whitebox.mjs` | the white-box parser (task text only): decidability witness and the triviality attack; `{ phrasing: 'dev-visible' }` knows only the sentence forms dev text shows |
| `beds/wbed/r6/r6.test.mjs` | 36 oracle-health and review-regression tests |
| `beds/wbed-r6/index.mjs` | registration shim; `loadFamily('wbed-r6')` works (tested) |
| `beds/wbed/attacks/triviality.mjs` | rung table row `r6` (gate: one call ≤ 2/12; necessity: none for correctness, §13) |

`beds/wbed/lib/faults.mjs` is unchanged: R6 calls its `requireNoFaults`, `hooks.schemaDrift` (world) and
`hooks.adversarialContent` (files) at the documented places; every hook is a no-op and a fault request throws (tested).
f3 lists R6 already; f2 does not, as in W-BED §3.8.

Coordinator WIP snapshots committed in-progress copies of these files: 9070b0c (before the builder's commit 147486d)
and the five-minute autosave snapshots during the review fixes (c109da2 onwards; the review commit's message lists
them). The "W-bed R6:" commits mark the reviewed versions.

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
  requested property); `entity` by code, name or "name (CODE)"; `value` in the canonical unit at the stated precision.
  Excluded: every void research document that mentions an in-scope compound.

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
| decoy (v1.1.0) | 1 (d4) or 2 (d5) further out-of-corpus retractions sharing the title of a surviving background or losing document, so an out-of-corpus retraction does not point at a winner (review finding 7) | d4 |

**Separability (v1.1.0).** A version 2 repeats what version 1 quotes, so it mentions every compound version 1 mentions
(the generator checks it and re-draws otherwise). The evidence that a document is void therefore reaches every worker
whose compound it mentions: the bed's exact worker on the declared slice (`workerSlice`: every notice plus every
research document and review that mentions the compound) reproduces the truth on every task, dev 301–320 and held-out
8201, 8202, 8301, 8302 at d2–d5 (96/96, tested). In v1.0.0 it did not: 70/80 dev and 14/16 held-out, every failure on
`excluded_doc_ids` (review finding 3).

**No completeness shortcut.** Every near-miss candidate and the namesake compound have surviving standard claims for
every requested property, as in-scope compounds do (tested). Before this was fixed, "drop the candidates with missing
properties" recovered the scope without any test-date or void judgment.

**Held-out tier** (W-BED §2.5; the R5 pattern). d2–d4 use one test-date phrasing set on both splits. At d5 about 45% of
research documents use a split-specific form: on split dev a "Sample log" table (`compound | received … | assayed …`) and
the document kind "Conference abstract" (ranks with preprints); on split test "All assays were run k days after the site
visit of DATE" and "Technical report" (ranks with lab notes). In v1.1.0 the d5 prompt names both kinds (rules 6 and 8)
on both splits, so the rules no longer reveal the split; the corpus still shows the tier by the kinds it contains
(tested; review finding 7). Held-out d5 tasks carry a test-date phrasing no dev task carries. The streams run at d3 then
d4 (W-BED §2.5), so **held-out R6 streams carry no unseen phrasing** (§13, finding 1).

## 3. Oracle composition, decidability and triviality

**End-to-end** (`scoreTable`). Exact: the in-scope set exactly (missing or extra compounds fail), one row per
(compound, requested property), `round(value × 10^dec)` equal to the true integer, `source_doc_id` equal, the excluded set
exact. Every printed unit maps exactly to the canonical integer (K = °C + 273.15 at 2 decimals; °F = °C × 1.8 + 32 at 2
decimals; µg/mL, mg/100 mL, min, µM, pM, kg/m³ by integer factors): tested over every unit of every property. Details
carry counts only (synth 3.0.0 rule). An entity may be written "name (CODE)" when both halves name the same compound; a
pair whose halves disagree names nothing (tested; review finding 8).

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

**Decidability witness.** `whiteboxSolve` parses the task text and applies the prompt's rules. It reproduces the
oracle's truth on **every** task: dev 301–320 and held-out 8201, 8202, 8301, 8302, at d2–d5 (96/96) [M]. So the text
conveys the truth, the rules leave nothing open, and no hidden fact decides an answer. The mention index from text
equals the world's mention records, and every compound's name↔code pair is recoverable from the register or a
"name (CODE)" mention (tested).

**Triviality (W-BED §2.4 items 2 and 4; corrected after review finding 1).** The same script is the triviality answer,
and it does not need the generator source. The corpus is a closed template grammar: two standard, two non-standard and
one bound sentence per property, five test-date forms, fixed notice sentences. Every form at d2–d4 appears in dev text
on both splits. `whiteboxSolve(task, { phrasing: 'dev-visible' })`, which drops the one form dev text never shows (the
d5 test-split "k days after the site visit of DATE"), solves dev 301–305 at every difficulty and **every held-out task at
d2–d4 (12/12)**; it fails all 4 held-out d5 tasks (tested). The reviewer's independent text-only solver (59 dense lines,
6.8 KB) solves 336/336 dev and 16/16 held-out tasks [M, `/var/tmp/foundry-work/review-R6/solve60.mjs`, re-run here on
v1.0.0 and v1.1.0 dev 301–320: 80/80]. Strictly, item 2's bar is 20 lines and no 20-line script is known to solve R6;
the keyword script (49 lines) fails every task. But the keyword script is a strawman (it ignores test dates, aliases,
quotes, conditions, errata and the policy), and the honest reading is: **for a code-writing arm (JIT, B1) R6 at the
stream difficulties is a parser-writing task**, and R6 measures cost and orchestration, not judgment, for it. The B6
comparison is therefore defined between model-executed arms only (§5, `structure.b6`).

## 4. Controls and their scores

**29 bad controls** (24 apply at d2, 27 at d3, 29 at d4–d5) and **2 necessity controls**. Every applicable control
fails the oracle on every one of dev 301–320 at every difficulty and on the held-out seeds (tested; generator re-draws
0 / 0 / 0 / 1 over 20 seeds at d2–d5, the one a `cell-logp` construction re-draw at d5 seed 301, none driven by a
control). Mean oracle score (dev 301–320, d2 / d3 / d4 /
d5) [M, v1.1.0]:

| control | kind | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|
| empty | stage | 0.00 | 0.00 | 0.00 | 0.00 |
| shuffled-or-corrupted | stage | 0.15 | 0.15 | 0.15 | 0.15 |
| scope-by-publication-date | stage (worker) | 0.88 | 0.91 | 0.94 | 0.92 |
| scope-mentions-counted | stage (worker) | 0.74 | 0.80 | 0.82 | 0.85 |
| scope-void-kept | stage (worker) | 0.74 | 0.77 | 0.77 | 0.79 |
| scope-plans-counted | stage (worker) | 0.87 | 0.90 | 0.91 | 0.92 |
| scope-alias-missed | stage (plan) | — | 0.64 | 0.60 | 0.61 |
| scope-code-and-name-twice | stage (plan) | — | 0.93 | 0.95 | 0.96 |
| scope-namesake-lab | stage (worker) | — | — | 0.92 | 0.96 |
| plan-register-list (was `necessity:no-plan-fixed-list`) | stage (plan) | 0.60 | 0.54 | 0.55 | 0.56 |
| retracted-claims-used | stage | 0.69 | 0.74 | 0.74 | 0.76 |
| superseded-kept | stage | 0.80 | 0.81 | 0.82 | 0.82 |
| errata-skipped | stage | 0.95 | 0.96 | 0.97 | 0.97 |
| erratum-cited | stage | 0.95 | 0.96 | 0.97 | 0.97 |
| nonstandard-counted | stage | 0.79 | 0.84 | 0.86 | 0.89 |
| quotes-counted | stage | 0.87 | 0.91 | 0.91 | 0.94 |
| predictions-counted | stage | 0.93 | 0.97 | 0.97 | 0.97 |
| bounds-counted | stage | 0.93 | 0.95 | 0.95 | 0.96 |
| no-unit-conversion | stage | 0.68 | 0.76 | 0.77 | 0.74 |
| recency-only | stage | 0.56 | 0.65 | 0.68 | 0.68 |
| concern-voids | stage | — | 0.82 | 0.83 | 0.83 |
| retraction-by-title | stage | — | — | 0.84 | 0.84 |
| excluded-corpus-wide | relation (Y4) | 0.85 | 0.85 | 0.85 | 0.85 |
| one-excluded-missing | relation (Y4) | 0.85 | 0.85 | 0.85 | 0.85 |
| map-null-filtered | relation (Y2) | 0.80 | 0.88 | 0.91 | 0.91 |
| reduce-lost-item | relation (Y3) | 0.80 | 0.88 | 0.91 | 0.91 |
| reduce-cells-misjoined | relation (Y3) | 0.15 | 0.15 | 0.15 | 0.15 |
| reduce-excluded-all-candidates | relation (Y4) | 0.85 | 0.85 | 0.85 | 0.85 |
| heuristic:keyword-script | heuristic (text only, strawman) | 0.12 | 0.17 | 0.15 | 0.16 |
| **sequential-single-context** | necessity (size, 32K hypothesis) | 0.35 | 0.21 | 0.15 | 0.07 |
| **best-of-n:equal-tokens** | necessity (size, 32K hypothesis) | 0.38 | 0.23 | 0.14 | 0.07 |

What each comparison stand-in is, after the review:
- **best_of_n** (`best-of-n:equal-tokens`). N = max(3, N at equal tokens in one-inline-call units, effort none, input +
  output) single-context solves (§5), candidate i starting at document ⌊i·D/N⌋, each reading up to the 32K budget. The
  same verifier selects: `unitChecks` plus a stand-in *perfect* panel on a 20% sample of the candidate's rows. Every
  candidate fails, not only the one selected (tested, dev 301–305, d2–d5); N was 5–7 / 9–12 / 11–14 / 14–16 [M]. It
  fails **only** because of the 32K-token attention hypothesis; it is not the B6 arm (which is N agent solves).
- **Single-context sequential** (`sequential-single-context`). Reads in id order and nothing past 32K tokens. Every task
  is above the budget at every difficulty: inline 48–50K / 63–66K / 77–79K / 101–105K; unread documents 73 / 135 / 196 /
  284 of 200 / 260 / 320 / 400 [M]. Same hypothesis.
- **Keyword/heuristic** (`heuristic:keyword-script`, 49 lines, task text only). Scope from the full-name affiliation and
  the publication date; the first number after the property keyword; journal-then-recent; voids by quoted title. It
  scores 0.12–0.17 and fails every task [M]. A strawman: the triviality answer is the parser of §3.
- **No plan** (reported ablation, not a control: it passes). `planAblation`: the bed's exact workers mapped over every
  compound of the code mention index. It solves **every dev task (80/80)**; its width is 30 / 39–40 / 49–50 / 57–60
  workers, above `MAX_FANOUT` at d ≥ 3, against 10–29 plan candidates [M, tested]. And the plan itself is code:
  `codePlan` (the lab's names from the membership and rename notices, then every indexed compound mentioned in a research
  document whose Affiliation is one of them, published on or after Y) equals the reference plan on every dev and held-out
  task tested (tested). So the plan is needed for **width** under the fan-out cap, not for correctness, and needs no judge
  (review finding 2). The former `necessity:no-plan-fixed-list` (the register's lab X entries) failed by construction
  (the generator keeps ≥ 2 in-scope compounds out of the lab's register entries), so it showed nothing about the plan; it
  stays as the bad control `plan-register-list`.
- **No workflow** (reported ablation, not a control: it passes). `grepAgentRun`: an agent with tools that reads every
  notice, greps the Affiliation lines for every name of lab X the notices give, greps each compound it found there by name
  and by code, reads later versions of what it read, and answers exactly from what it read. It solves **every task**
  (dev 301–320 and held-out, d2–d5; tested), reading 22–33K / 42–53K / 56–66K / 84–95K tokens against inline 48–50K /
  63–66K / 77–79K / 101–105K [M]. At d3–d5 that is above the 32K budget, so under the attention hypothesis it fails like
  the single-context controls; without the hypothesis it passes. At d2 some tasks fit under 32K. The v1.0.0 control
  `no-workflow:grep-agent` grepped only the full name although it read the notices that give the other names; it
  duplicated `scope-alias-missed` and is gone. Its numbers in the v1.0.0 notes ("27 of 40 alias-only compounds hidden,
  31 of 40 missed") are **withdrawn** as evidence (review finding 4).

## 5. The B6 comparison: equal tokens, equal dollars, one verifier

**What `wide` reads and writes** (`tokenAccounting`, utf8/4, means over dev 301–320) [M]. Three designs are counted:
- **declared** (the reference): a scope judge per candidate, then one judge per requested property for in-scope
  candidates, each reading the candidate's slice; panel judges read the cell's evidence;
- **one-call**: one typed judgment per candidate returning scope and all cells; panel reads the evidence;
- **lean**: one call per candidate; panel reads only the cited source.

Output tokens are a per-call estimate (OUTPUT_EST, [I]: plan 60 + 40 per candidate, scope 80, cell 90, panel 60, a
best_of_n answer 300 + 45 per cell). Thinking is counted at the effort's cap (src/models/port.mjs THINKING: 0 at none,
8,000 at medium), an upper bound. Dollars: Haiku 5.5 list, $0.10/$0.50 per MTok, $0.50/$2.50 for the whole call when
the prompt is above 100K tokens (policy/models.json; both pinned by test).

| | d2 | d3 | d4 | d5 |
|---|---|---|---|---|
| inline task (one read of everything) | 49.4K | 64.6K | 78.6K | 104.0K |
| plan (prompt + header digest + consortium notices) | 13.2K | 16.4K | 20.0K | 25.5K |
| workers input, declared / one-call | 204K / 65K | 454K / 111K | 685K / 165K | 1,196K / 239K |
| largest worker context | 7.6K | 8.7K | 10.0K | 11.2K |
| verify input, evidence / source only | 93K / 55K | 216K / 125K | 321K / 204K | 579K / 357K |
| **input, declared** / lean | 311K / 133K | 686K / 252K | 1,026K / 389K | 1,801K / 622K |
| model calls, declared (plan + workers + verify) | 51 (1 + 35 + 15) | 95 (1 + 64 + 30) | 125 (1 + 85 + 39) | 189 (1 + 127 + 60) |
| output tokens, declared | 4.5K | 8.1K | 10.7K | 15.9K |
| thinking at effort medium (cap), declared | 410K | 758K | 999K | 1,508K |
| cacheable share of worker input (shared prefix) | 0.86 | 0.89 | 0.91 | 0.93 |
| **$ declared**, effort none / medium | 0.033 / 0.24 | 0.073 / 0.45 | 0.108 / 0.61 | 0.188 / 0.94 |
| $ lean, effort none | 0.016 | 0.029 | 0.044 | 0.070 |
| $ one best_of_n inline call, none / medium | 0.0056 / 0.0096 | 0.0077 / 0.0117 | 0.0094 / 0.0134 | 0.064 / 0.084 |

**best_of_n's N** (ranges over dev 301–320) [M for the arithmetic, [I] for the unit models]:

| unit, effort, budget | design | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|
| one inline call, none, equal tokens | declared / one-call / lean | 4–7 / 2–4 / 2–3 | 8–12 / 4–6 / 3–4 | 11–14 / 5–6 / 4–5 | 14–18 / 7–8 / 5–6 |
| one inline call, none, **equal dollars** | declared / one-call / lean | 4–7 / 2–4 / 2–3 | 8–11 / 4–5 / 3–4 | 10–12 / 5–6 / 4–5 | **2–3 / 1 / 1** |
| one inline call, medium (cap), equal tokens | declared / lean | 9–15 / 4–7 | 16–23 / 7–10 | 20–24 / 9–10 | 25–31 / 10–12 |
| one inline call, medium (cap), equal dollars | declared / lean | 19–30 / 10–15 | 33–45 / 15–22 | 41–50 / 20–23 | 10–12 / 4–5 |
| agent solve [I], none, equal tokens, tool batches 8K / 16K / 32K | declared | 3–4 / 5–7 / 8–11 | 3–4 / 4–7 / 7–9 | 3–4 / 5–6 / 9–10 | 2–3 / 4–5 / 8–9 |

The agent model (`agentTokens`) reads the documents an agent with tools needs (`agentReadSet`: 21–31K / 40–51K /
54–63K / 81–92K of documents) in tool-result batches and re-sends its context every turn; at 16K batches one solve is
about 50K / 112K / 170K / 351K tokens.

What this says [I]:
1. **The unit decides N.** In one-inline-call units best_of_n gets 4–18 candidates at effort none; in agent units 2–11,
   depending on how the agent batches its reads. W-BED §3.6 defines the arm as N agent solves, so N must come from the
   measured ledger of that arm (`nAtEqual`), not from the bed's inline-call estimate (review finding 5).
2. **The budget decides N.** At d5 every best_of_n read is above 100K tokens and pays 5× the rate: equal tokens gives
   14–18 inline candidates against the declared design, equal dollars 2–3 (1 against the lean design). B6's falsifier
   ("or matches it only at higher cost") must be read in both, and the report gives both.
3. **Effort decides the dollars.** Thinking tokens scale with the number of calls, not with the reads. At effort
   medium the declared `wide` carries up to 0.4–1.5M thinking tokens (at the cap) and costs 5–7× its effort-none
   dollars; best_of_n at equal dollars then gets 10–50 inline candidates. Running `wide`'s narrow judges at effort none
   (or measuring their real thinking) is a first-order cost lever.
4. **`wide` is not a token saver here.** It reads 2.7–17× the inline task, because every worker re-reads the notices
   and every panel judge re-reads evidence. Every `wide` context stays under 12K tokens, below the 32K budget and the
   100K price step. 86–93% of worker input is a shared prefix (rules and notices first, then the candidate's documents);
   prompt caching (slice 2 item 6b) is worth up to that share at the cache-read price.
5. **The PREREG must fix, before N is computed** (`structure.b6.fixBeforeN`): the worker design, the panel reading, the
   effort, the difficulty (d3/d4 streams, or d5 above the price step), the token unit (agent ledger), and whether cache
   reads count as tokens.

**One verifier for both arms.** `unitChecks(task, output)` is the code half of the verify. It reads only the task:
schema, non-empty table, requested properties, known compounds, one row per cell, complete compounds, source exists /
is research / mentions the compound / not void by title (with the first author when the notice gives one) / not
excluded, plausible value range, excluded documents void by title. It accepts the reference on every task. Its flag rate
per control (dev 301–310, d2–d5) [M]:
- **flags ≥ 35/40 tasks (13 controls):** every task for empty, shuffled, retracted-claims-used, superseded-kept,
  erratum-cited, no-unit-conversion, reduce-cells-misjoined, sequential, best-of-n, code-and-name-twice, concern-voids,
  retraction-by-title; 35/40 for the keyword script;
- **never or rarely (18 controls):** every scope verdict mistake (publication date, mentions, void kept, plans, alias
  missed; namesake 4/20), the register list, errata-skipped, non-standard, quotes, predictions, bounds, recency-only,
  and the five Y2–Y4 relation controls.

So the code checks catch structural damage. Semantic resolution errors need the panel. **Coverage errors (a compound
missing) are invisible to both** a code check of the output and a panel that samples rows. Only the plan's check
(`coverageIssues`: unknown strings, duplicates, and gaps against `codePlan`) sees them; it flags the alias-missed, the
code-and-name-twice and the register-list plans (tested). `wide` gets that check and best_of_n's selector does not,
unless each best_of_n candidate also returns the compounds it considered with a verdict (review finding 6;
`structure.b6.selectorAsymmetry`).

**What decides B6** (`structure.b6`, binding on the W-bed PREREG):
- the `wide` arm is model-executed: the trace has one `wide` node whose workers make judge calls (reference or
  JIT-built); a solver whose workers are pure code (a parser) is reported separately and does not count;
- the `best_of_n` arm is N independent Haiku agent solves selected by the same verify, N from the measured ledgers;
- equal tokens (input + output + thinking) and equal dollars (list, with the price step), both reported;
- **no $0 evidence separates the arms**: every $0 control that fails does so only under the 32K-token attention
  hypothesis, and an agent with tools and no workflow solves every task when it loses nothing. The paid one-call attack
  measures the hypothesis; the B6 run decides the claim.

## 6. Measured sizes and runtime

| | d2 | d3 | d4 | d5 |
|---|---|---|---|---|
| documents (research) | 200 (183–190) | 260 (234–244) | 320 (284–296) | 400 (360–372) |
| compounds in world / in scope (range) / candidates (range) | 30 / 6–10 / 10–14 | 40 / 10–14 / 14–20 | 50 / 14–18 / 19–24 | 60 / 18–22 / 24–29 |
| cells (mean) | 23 | 47 | 63 | 100 |
| excluded documents (range) | 2–6 | 2–8 | 3–7 | 2–13 |
| corpus tokens (mean) | 45.1K | 59.3K | 72.4K | 96.5K |
| inline task tokens (min–max, `inlineRender`) | 48.1–49.7K | 62.9–66.0K | 76.9–78.9K | 101.4–105.4K |
| plan-less map width (workers) | 30 | 39–40 | 49–50 | 57–60 |

(dev 301–320 [M], v1.1.0). Generation takes 0.1–0.5 s per task including the decisiveness check over 31 controls; the
oracle takes milliseconds. The 3 s runtime test at d5 cold passes [M].

**Triviality attack, dry run** (`node beds/wbed/attacks/triviality.mjs --rung r6`, attack seeds 379–390): 24 calls.
- d3: inline mean 63.8K tokens, token-priced **$0.23** list.
- d5: mean 103.7K. The driver prints $0.35, but it does not model the 100K price step. At $0.50 / $2.50 per MTok above
  100K, one call costs about $0.064 (none) and $0.084 (medium at the thinking cap), so the d5 attack costs about
  **$1.8** [I].
- Stubs: reference 12/12. Every comparison control 0/12: empty, best-of-n, sequential, plan-register-list, keyword [M].

## 7. Cost estimates (Haiku 5.5 list: $0.10 / $0.50 per MTok, $0.50 / $2.50 above 100K tokens per prompt)

| arm, per R6 task | d3 | d5 |
|---|---|---|
| one call (attack), effort none / medium | $0.008 / $0.012 [M arithmetic] | $0.064 / $0.084 (above the price step) |
| reference `wide`, declared design, effort none | $0.073 | $0.188 |
| reference `wide`, declared design, effort medium (thinking at the cap, upper bound) | $0.45 | $0.94 |
| reference `wide`, lean design, effort none | $0.029 | $0.070 |
| reference `wide`, with prefix caching (≈ 0.9 of worker and panel input as cache reads at 0.1×), effort none | ≈ $0.02 [I] | ≈ $0.04 [I] |
| best_of_n, one-inline-call units, equal tokens with the declared design, effort none | ≈ $0.08 (N ≈ 10) | ≈ $1.0 (N ≈ 16) |
| one agent solve, model [I], 16K batches, effort none | ≈ $0.012 | ≈ $0.04 (each call under 100K) |
| Haiku agent (arm d), W-BED §3.6 | $0.5–1.5 [I] | same, toward the top [I] |

W-BED §3.6 estimated the reference at $0.2–0.6. The token arithmetic says less at effort none and about that at effort
medium. The agent model is a perfect-retrieval lower bound; real agents read more. The claude-cli per-call overhead for
100–190 small judge calls per task is unmeasured (W-BED O5; FRONTIER-GAPS D22 measured $0.00011 per tiny judge call).
Measure it on 20 calls before R6 runs.

## 8. Seeds

No ledger edit was made. `research/jit-20261008/SEED-LEDGER.json` already lists `wbed-r6` in `wbed-dev` (dev 301–390,
allow jit-dev) and in `wbed-heldout-a` … `-d` (8201–8224, 8301–8324, 8401–8424, 8501–8524, allow jit-heldout).
- Tests use dev 301–321 (321 for the cold-runtime test; v1.0.0 used 389 on the test split, a seed no range assigns,
  review finding 9).
- The attack plan uses dev 379–390.
- Generator checks use held-out 8201, 8202, 8301, 8302: tasks 1–2 of held-out streams A and B. The bed's tests generate
  them and solve them with the white-box parser, the agent ablation and the exact worker slice, at $0. No arm sees them,
  and nothing is consumed. R5's tests do the same with 96 held-out seeds. **For the coordinator:** the ledger should
  record this generator-check use on the `wbed-heldout-a`/`-b` rows (the file is shared, so this session did not edit
  it), or the PREREG should state that the bed author's tests have generated these four tasks.
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
   the task separable (W-BED §3.6 "Separability") and ties the void list to the discovered set (Y4). v1.1.0 makes the
   separability hold under the declared worker slice (§2).
4. **"Tested by lab X after date Y" is made exact.** It becomes "on or after", dated by the measurement, with alias
   forms. "Test" is defined as an own measurement, bounds included.
5. **No structure-necessity attack for the plan** (W-BED §2.4 item 3 asks for "R6 without a plan … over a fixed entity
   list taken from the prompt"). The prompt names no compound. The v1.0.0 stand-in took the register's lab X entries and
   failed by construction. The honest result: without a plan the task is still solved (map over the index, or a code
   plan), so R6, like R4, has no necessity attack for correctness. Its plan is needed for width (the fan-out cap), and
   R6's remaining question is the B6 comparison (review finding 2).
6. **The plan stage oracle is recall-oriented.** Extra candidates are allowed. W-BED does not say; a plan that
   over-generates and lets workers confirm is the natural `wide` shape, and Y1 still forbids duplicates.
7. **"best_of_n at equal tokens" is made concrete, in two units** (`tokenAccounting`, §5). W-BED §3.6 defines best_of_n
   as N agent solves. The bed's control uses one inline call per candidate (N ≥ 3) under a stated hypothesis; the B6 arm
   uses agent solves with N from the measured ledgers. Output and thinking tokens are counted, and dollars with the price
   step (review finding 5).
8. **The held-out tier is a d5 phrasing tier** (split-specific, as R5's formats), not a held-out rung. RH stays the
   held-out rung (W-BED §3.9). The streams (d3 → d4) never reach it (§13, finding 1).
9. **The fan-out width varies ±2 per task**, quoted and planned compounds get their own titled notes, near-miss
   compounds have complete data, and (v1.1.0) out-of-corpus retractions also point at non-winners. These are
   anti-shortcut measures W-BED does not ask for (§2).
10. **The corpus is in `files`, not `inputs`**, so agent arms can grep it (R5 convention for the dump).
11. **The reference plan is code** (`codePlan`), not "judge → entity list" (W-BED §3.6 outline). A plan judge is optional:
    the lab's names are stated in two one-sentence notices, and the code plan equals the reference plan on every task
    tested (review finding 2).

## 10. What the engine needs from `flow.wide` (compared with slice 2 item 6)

Slice 2 item 6 builds "`flow.wide` … over a bounded, typed work list with a code reducer, per item judgment,
concurrency cap and total budget; events per item; test against beds/wbed/r3 (fan-out N up to 48)". Items 6b (prefix
sharing), 3b (per-item failure policy) and 1c (phase events) are related. FLOW-V3 §2.3 has the fuller spec. R6 needs
the following; each is an E2-record change.

1. **The plan → check → one replan loop, explicitly** (FLOW-V3 §2.3; item 6 says only "bounded, typed work list"). The
   plan may be a code function (`codePlan`), not only a judge. The check must read a code index built from the task
   files (`ctx.files`, as R5 item 10 asks for the agent's verify) and report unknown codes, duplicates (a name and a code
   for one compound: `scope-code-and-name-twice`) and gaps (`coverageIssues`).
2. **A worker that is a chain, not one judge.** FLOW-V3's worker forms are `judge | call | agent`. R6's reference worker
   is a scope judge, then k property judges, then a code step. Needed: `worker: async (item, ctx) => …` with a per-item
   span, or `{ call: { hash } }` to a compiled per-compound callee.
3. **Typed per-item outcomes that separate "done, out of scope" from "failed".** `{in_scope: false}` is a result, not a
   failure. With 3b's `onItemError: 'null'`, coverage must reach the reducer typed, and Y2 must hold as a code
   invariant. `map-null-filtered` is exactly what `.filter(Boolean)` produces: one in-scope compound silently gone, the
   table internally consistent. 3b's default `crash` is right for R6.
4. **Per-item input slicing.** Each worker should see only its slice (`workerSlice`: every notice plus its compound's
   research documents and reviews), a file subset per item, as R5's agent gets only the dump directory. Without it every
   worker gets the 100K corpus, and both the size advantage and the price-step advantage disappear. v1.1.0 guarantees the
   slice is sufficient (§2).
5. **Prefix sharing (6b) as a measured lever.** 86–93% of worker input is a shared prefix if prompts are laid out as
   rules + notices, then the compound's documents, then the property question. The prefix holds per compound across its
   1 + k calls. The ledger must report cache-read tokens per `wide` node.
6. **A verify that is both a panel on a sample of *cells* and a code predicate, AND-ed** (FLOW-V3 says "panel or a code
   predicate"). It needs:
   - a seeded sample (replay determinism);
   - a hook to give each panel judge its cell's evidence (`verify.sampleOf(results, ctx)`);
   - the independence label `same-model (correlated)` for a Haiku panel;
   - a panel rejection that deopts at item granularity (re-run that worker), not the whole `wide`.
7. **Per-phase token accounting in events**: input, output, thinking, cache read and cache write for plan, workers and
   verify. Without it "equal tokens" and "equal dollars" for best_of_n cannot be computed from a run. `tokenAccounting`
   is the bed's ex-ante estimate.
8. **`best_of_n` with the same verify object** (ROADMAP §2.1). This is not in slice 2. B6 needs
   `flow.bestOfN({ n, solve, verify })` or a harness arm that reuses the `wide` verify (panel + `unitChecks`) verbatim,
   with N agent solves and a ledger per solve. If the selector is to get the plan's coverage check, each solve returns
   its considered compounds with verdicts.
9. **`maxFanout` 32 versus item 6's R3 test.** R6 stays at or below 32 (24–29 at d5). But R3 d5 has 48 suppliers, and
   item 6 says "test against beds/wbed/r3 (fan-out N up to 48)". FLOW-V3 §2.3 refuses a plan longer than `maxFanout`.
   Either raise the cap with evidence, chunk the plan, or test R3 only up to 32. (R6 without a plan would need 39–60.)
10. **Budget.** `BUDGET_TOO_SMALL` uses `maxFanout × worker floor`. R6's worker floor is (1 + k) calls of 7–12K tokens
    for the chain design. `perTaskUsd(R6)` must cover the plan, up to 29 × 6 worker calls and 60 panel calls, and the
    thinking tokens at the run's effort (§5).
11. **Trace exposure for the composed oracle.** `trace.index`, `trace.plan.candidates`,
    `trace.worker.items[{entity, in_scope, cells, void_doc_ids}]` and `trace.reduce` must be written under span names by
    `stream.mjs` (the analogue of R4 item 6 and R5 item 17).
12. **Judge workers only.** Agent workers would hit the 2-concurrent / 16-per-run limits at 24–29 candidates (W-BED O3).
13. **Phase events (1c)** for plan, workers, reduce and verify. They give the critical-path wall-clock metric of W-BED
    §6.2 for R6.
14. **A trace that shows whether a `wide`'s workers made model calls**, so the B6 rule "the `wide` arm is
    model-executed" (`structure.b6.wideArm`) can be checked from the run, not asserted.

## 11. Open questions (owner)

1. Which worker design is the arm (c) reference? Chain (narrow decisions, ROADMAP P1) or one-call (cheaper)? It halves
   or doubles best_of_n's N (d5: 14–18 vs 7–8 in inline-call units).
2. Should the panel read the evidence or only the cited source? Source-only is cheaper and blind to a better-ranked
   claim. The bed counts both.
3. Which budget decides B6: equal tokens, equal dollars, or both (the bed reports both)? At d5 they differ by 5–7×
   because of the price step; at effort medium by up to 2× the other way because of `wide`'s thinking.
4. At what effort do `wide`'s judges run? Thinking scales with 51–189 calls (§5 item 3).
5. The 32K attention budget behind the size controls is a hypothesis, and it is the only $0 separation. The paid
   one-call attack (≈ $0.23 at d3, ≈ $1.8 at d5) measures it. If one Haiku call passes > 2/12, the rung is dropped by
   W-BED §2.4.
6. Should R6 test judgment for code-writing arms (§13 finding 1)? Options: (a) keep R6 as is and restrict B6 to
   model-executed arms (done in `structure.b6`); (b) run R6 streams at d4 → d5, or put the split-specific phrasing tier
   at d3/d4 on the test split, so held-out streams carry unseen phrasing; (c) per-task paraphrase pools.
7. Should the corpus exceed the model's context window at the B6 difficulty (about 800 documents), so the size argument
   is structural rather than a hypothesis (§13 finding 4)?
8. Should discovery need judgment (lab identity stated in prose spread over documents, in-scope compounds not the title
   compound), so the plan is necessary (§13 finding 2)?
9. Do cache reads count as tokens in "equal tokens"?
10. Should R6 rather be the held-out rung (W-BED §11.1)? It currently has a held-out phrasing tier at d5 only.

## 12. Test run

- `node --test --test-concurrency=2 beds/wbed/r6/r6.test.mjs`, on the final code: **36 tests, 36 pass** (300 s) [M].
- `beds/wbed/attacks/triviality.test.mjs`: **6 / 6** [M].
- W-bed suite without R3′ (lib, attacks, R0–R6), `--test-concurrency=2`: **163 tests, 163 pass** (412 s) [M]. Every
  R0–R5 test stays green.
- Whole W-bed suite including R3′ (`beds/wbed/**/*.test.mjs`): 190 / 192. Both failures are in
  `beds/wbed/r3p/r3p.test.mjs` (its version pin expects 1.0.0 and finds 1.1.0; its real-code test) and come from the
  R3′ agent's uncommitted work in progress on that bed, not from R6.

## 13. Adversarial review (2026-10-14) and what changed

The review read commit 147486d at $0 (scripts in `/var/tmp/foundry-work/review-R6/`). It found no P0, five P1s and five
P2s. Every finding was re-run here before acting; every one reproduced on v1.0.0. Disposition:

### 13.1 Fixed (with a regression test in `r6.test.mjs`)

| # | finding | verified on v1.0.0 | what changed | test |
|---|---|---|---|---|
| 1 | P1 triviality: a 59-line text-only script solves R6; the keyword control is a strawman | solve60 80/80 dev | the triviality answer is now the parser: `whiteboxSolve(…, { phrasing: 'dev-visible' })` solves held-out d2–d4 12/12 and fails held-out d5 4/4; headers of whitebox.mjs and heuristic.mjs corrected; §3; the B6 `wide` arm must be model-executed and pure-code solvers are reported apart (`structure.b6.wideArm`); triviality.mjs r6 row | "review finding 1 (triviality …)" |
| 2 | P1 the plan is not shown to be necessary; the no-plan control fails by construction | map over the index 80/80; code plan passes the plan oracle 80/80 | necessity re-scoped: no attack for correctness (as R4); the plan is needed for width (map 39–60 > 32 at d ≥ 3) and is code (`codePlan`, `coverageIssues`; `structure.wide.plan`); `planAblation` reported; the fixed-list control demoted to the bad control `plan-register-list`; deviation 5, 11 | "review finding 2 …", "the plan's code check …" |
| 3 | P1 the declared worker slice cannot see a version 2 that names only its own compound; separability false for the void list | slice 70/80 dev, 14/16 held-out, all on `excluded_doc_ids` | generator: a version 2 repeats version 1's quotes, so it mentions every compound v1 mentions (checked, re-draw otherwise); `workerSlice` is one definition shared by the accounting and the test | "review finding 3: separable …" (96/96) |
| 4 | P1 at $0 nothing separates `wide` from a no-workflow agent; the grep control is weaker than the rules it reads | stronger grep agent 60/60 at d3–d5 | `no-workflow:grep-agent` removed; `grepAgentRun` (all names, both strings, later versions) reported: passes every task, reads 22–95K; the 27/40 and 31/40 figures withdrawn; §5 and PROOF-LEDGER B6 state that no $0 evidence separates the arms | "review finding 4 …" |
| 5 | P1 best_of_n accounting uses the wrong unit and omits output and thinking tokens | `nOf` = wide / inline; header said output is negligible | `tokenAccounting` counts output (estimate) and thinking (cap) per call, prices dollars with the 100K step, gives N in one-inline-call units (equal tokens, equal dollars, per effort and design) and in an agent-solve model; `nAtEqual` for ledger numbers; THINKING_CAP and HAIKU_PRICE pinned to the engine and the policy; `structure.b6` lists what the PREREG fixes before N | "review finding 5 …" |
| 7a | P2 the d5 prompt reveals the split (rules 6 and 8) | yes | both held-out-tier kinds named on both splits at d5 | "review finding 7 …" |
| 7b | P2 an out-of-corpus retraction always names a winner | 20/20 | 1–2 decoys on background or losing documents at d4–d5 (over dev 301–320 at d4–d5: 40 on winners, 60 elsewhere) | "review finding 7 …" |
| 8 | P2 "name (CODE)" scored as unknown | yes | `resolveWith` in score.mjs, stages.mjs and verify.mjs; a mismatched pair names nothing | oracle test |
| 9a | P2 `buildWide` re-draws depend on whether index.mjs installed the verifier | yes | `buildWide` refuses to build without it | "review finding 9 …" (fresh process) |
| 9b | P2 the runtime test used seed 389 on the test split | yes | dev 321 | runtime test |

### 13.2 Recorded, not changed (P2s and parts of P1s), with reasons

- **Finding 1, generator side** (make R6 test judgment for code-writing arms: per-task paraphrase pools, or the
  split-specific tier at d3/d4 on the test split, or streams at d4 → d5). Deferred to the owner (§11 Q6). Reasons: it
  changes the held-out distribution relative to dev on R6 only (R1–R5 keep identical distributions at d3–d4); paraphrase
  pools stay a closed grammar a parser can learn from dev text; and for the JIT arm within a stream the warmup tasks
  come from the stream itself, so "unseen relative to dev" matters only for arms built on dev data (reference c, B1 e,
  the CUR library). The in-stream drift at task 17 (d3 → d4) remains the JIT's unseen change.
- **Finding 2, generator side** (make discovery need judgment). Deferred to the owner (§11 Q8): a redesign of how lab
  identity is stated, with every control and measurement redone.
- **Finding 4, corpus above the window.** Deferred to the owner (§11 Q7): about 800 documents, which also makes the
  one-call attack impossible and raises every arm's cost.
- **Finding 6** (P2, the selector cannot see a missing compound; `wide` gets a coverage check the selector does not).
  Recorded in `structure.b6.selectorAsymmetry` and §5. The check exists as code (`coverageIssues`); giving it to the
  selector needs best_of_n candidates that return their considered compounds, a protocol choice for the PREREG.
- **Finding 7, errata and concerns** sit on winners slightly more often than the base rate (0.37–0.51 against
  0.31–0.34). Not changed: an erratum on the winner is the erratum trap's purpose, a concern voids nothing, and the
  margin is small.
- **Finding 9, ledger.** The held-out generator-check seeds are recorded in §8 with a request to the coordinator; the
  shared ledger was not edited. The decisiveness re-draw conditions worlds on the bed's controls failing; over dev
  301–320 at d2–d5 there is one re-draw, a construction re-draw (`cell-logp`), and none driven by a control, so the bias
  is small today; it is stated here.
- **Finding 10** (claim mapping). Accepted as stated: R6 maps to B6 only; it has no J5 role. PROOF-LEDGER B6 moves to
  "B" with the caveats of this section.

### 13.3 Rejected

None. Two nuances, not rejections: (i) W-BED §2.4 item 2's literal bar is 20 lines, and the reviewer's solver is 59
dense lines (about 150 at normal width), so item 2 holds as written; the finding stands on item 4 and on what it means
for code-writing arms. (ii) Finding 2 omits that the plan-less map is 39–60 wide at d ≥ 3, above the default fan-out
cap, so a plan stage is still needed; it needs no judge.

### 13.4 Test counts after the fixes

- R6: **36 / 36** (was 30: eight review tests added, two replaced, the fixed-list and the weak grep-agent tests).
- Attack driver: 6 / 6.
- W-bed suite without R3′: **163 / 163**; with R3′ 190 / 192, both failures in the R3′ bed's in-progress work (§12).
