# Replication analyses: rows 17 and 33 of BLOCKER-SYNTHESIS section 2.1 (B14-E1, B14-E3)

Date 2026-10-09. Cost: $0. No model calls, no network, no sealed beds read (`beds/sealed/` untouched), dev seeds 0 to 27 only (burned),
nothing under `experiments/`, `src/` or the corpus modified. Everything here is deterministic and re-runs from the commands below.

## Verdicts

| row | kill rule | verdict |
|---|---|---|
| 17 conformance evaluator (B14-E1) | the evaluator misclassifies more designs than oracle v1 (29), or cannot express a pilot's effects | **Does not fire.** Declared-normalisation conformance (tier I, tau = 1) misclassifies 2 of the 29 classes oracle v1 misclassified (the item-agnostic tier G: 12 of 29); all five pilots' effects are expressible as effect logs. See the two cautions below: the 29 is a ceiling by construction, and tier I is oracle-like work, not generic. |
| 33 corpus variant-family census (B14-E3) | fewer than 10 families with 3 or more variants and shipped oracles | **Fires.** 4 families on the primary definition with the exact assignment distance. No cell of the exact run reaches 10 (maximum 9, for lineage-only components counting a family when any member ships an oracle; maximum 8 on the primary oracle criterion). The cheaper run, which uses a signature proxy for graphs above 120 nodes, gives 9 on the primary definition but reaches 10 to 13 in some cells, so with that distance the verdict is not robust; with the exact distance it is. |

Two cautions that qualify the row 17 verdict, stated here because the numbers alone read better than they are:

1. **Ceiling.** Oracle v1 "misclassified 29" because the 29 classes were selected as the ones it got wrong (18 wrong designs it passed, 11 correct designs it
   rejected). A comparison against that count can only fail if the evaluator is wrong on more designs than exist in the list. The informative comparison is
   against oracle v2 on the same battery: v2 misses 1 of the 29 (and the 5 residual classes); conformance tier I misses 2 of the 29 (and the same 5 residuals).
2. **Tier I is declared per item.** Generic conformance with only text normalisation (tier G) falsely rejects every one of the 11 correct designs
   (0 of 11 accepted). What makes tier I work is a short per-item declaration (19 to 33 non-comment lines per item) that says which differences are not
   differences. That is the same kind of knowledge an oracle encodes. It is much smaller than the oracles (which also generate the batteries) but not free.

## 1. Row 17: conformance evaluator

### 1.1 What is compared

An **effect log** is an ordered list of events `{case, type, key, t?, stream?}`: `case` is the unit alignment runs in (a scenario, an evaluation job,
a seed's instance), `type` and `key` identify the effect, `t` is optional virtual time, `stream` groups events that are ordered among themselves
while different streams commute. The expected log is built independently of the candidate; the observed log is what the candidate's run produced.

| item (pilot) | log unit | case | stream | expected log |
|---|---|---|---|---|
| Home Assistant garbage-day (P4) | successful service call at virtual second t | scenario | one stream, timed | the author's YAML executed by `controls/original.mjs`; cross-checked against the oracle's own `expect` traces (10 of 10 seeds accepted at fitness = precision = 1.000) |
| n8n:12679 Zoho/KlickTipp (P2) | state delta of an effective write (record created, updated with changed fields, deleted; ids replaced by emails) | scenario | person (email) | the call-for-call transcription `makeFaithful` (the item README records 40 of 40 agreement with the executed original; the corpus file needed to execute the definition itself is not on this laptop) |
| n8n:20281 support-mail triage (P3) | one event per Jira / Slack / Teams / mail / sheet effect | mail batch | mail | the faithful transcription (14 of 14 agreement with the executed original per the item README); T3 designs are scored on T3 tasks against the improved reference |
| Galaxy variation reporting (P1) | one event per row (and header) of each of the 4 published tables | evaluation job (shipped job + 20 derived) | table | the shipped tables for the shipped job, `reference.mjs` for derived jobs (the item's own evaluator-health gate shows the reference reproduces the shipped tables) |
| GitHub Actions selenium (P5) | run status, reported versions, failure message, line-level file edits in the bot PR, PR operation and fields, PR text, other PRs touched | one instance per seed | file / pr / run | the reference plan `solveImproved`, asserted equal to the instance truth on file content |

### 1.2 Alignment rule (the whole rule)

1. Each event is projected to a signature: its type plus the canonical JSON of its key after the declared normalisation.
2. Two events match when signatures are equal and, if both carry a time, they differ by at most the declared tolerance (+-1 s where timed).
3. Per case, events are grouped by stream. Within a stream, order mode `bag` is an optimal one-to-one matching (order not judged); `seq` is a longest
   common subsequence (sequence alignment with unit-cost log moves and model moves; a changed event costs one of each, there is no substitution);
   `auto` uses `bag` for a stream whose events all carry times and `seq` otherwise. A tier may override the mode per stream.
4. fitness = matched / |expected| (share of expected effects reproduced, in order where order matters); precision = matched / |observed| (share of observed
   effects that were expected). An empty denominator gives 1 for that measure, so a design that does nothing has fitness 0 and vacuous precision.
5. A design is accepted at threshold tau when every case has fitness and precision at least tau. Primary tau = 1. Sensitivities: tau = 0.95, and "at least 90 percent of cases exact".
   A design is accepted overall iff it is accepted on every seed it was run on (the item tests' own convention, "fails on some task").

Two normalisation tiers are scored for every item:

* **G**, item-agnostic: text normalisation (typographic quotes and dashes, whitespace), +-1 s tolerance where timed, keys compared raw. Nothing item-specific.
* **I**, item-declared: a short file `normalisation/<item>.mjs` that says what is not a difference (set-valued fields, durations, id canonicalisation, ignored
  fields, a fact projection of model-authored text, net effect per entity, sortedness predicates). The declaration and tau are frozen in `PREREG.json` with sha256 of every file.

The evaluator is `lib/conformance.mjs` (167 non-comment lines, 9 unit tests). The per-item adapters (`adapters/`, 52 to 129 lines) extract logs from the
item's own environments and controls (read-only imports from `experiments/replicate/items/`).

### 1.3 Classes tested

Class counts follow dossier 7 (DESIGN.md): 18 wrong classes that passed oracle v1, 11 correct designs oracle v1 rejected, 5 residual. DESIGN gives only the
count of residuals; the five below are my reading of the items' known limits. Each class is realised either as an executable design (the repo's own controls,
or the item test's inline designs re-implemented in the adapter) or, where the class is a deviation of the effect log rather than a runnable design, as a
perturbation of the expected log (marked `*` in the table: HA-C1, HA-C2, N20-C1, N20-C2; the v2 oracle verdict for these is the documented one, not re-run).

Classes with more than one design (N12-W1 forgets one field in one direction: 23 designs; GHA-C1 three PR-text formats) count as detected / accepted only if
every design in the class is. The "decided by" column is my reading, not the dossier's: *comparison* (the comparison method can matter), *battery*
(detection depends on which scenarios exist), *expected-log* (the expected log itself encodes the semantic), *environment* (depends on the simulated
environment), *harness* (decided outside the effect log, by a cost meter or the prompt).

**Confound to keep in mind.** The oracle failed these designs (v1) on the *v1 battery*; conformance runs on the *v2 battery* (the current generators). Most
"wrong classes that passed v1" are decided by battery coverage, not by the comparison method, so a v2-battery conformance run detecting them says little
about conformance; the like-for-like comparison is conformance against oracle v2 on the same battery.

### 1.4 Per-class result

Seeds: Galaxy 0-4, n8n:12679 0-4, n8n:20281 0-4 (T2 and T3 tasks), Home Assistant 0-9, GitHub Actions 0-27. "reject" = detected for a wrong class; **X** marks a wrong verdict
(a wrong class accepted, or a correct class rejected). v2 oracle is the current item oracle. `*` = v2 verdict documented, not re-run.

| class | platform | kind | decided by | designs | v2 oracle | conformance G | conformance I | I tau .95 | I 90% exact |
|---|---|---|---|---|---|---|---|---|---|
| GX-W1 W1 skips the DP>=1 prefilter | Galaxy | wrong | battery | 1 | reject | reject | reject | accept **X** | reject |
| GX-W2 W2 by-variant report grouped by POS | Galaxy | wrong | battery | 1 | reject | reject | reject | accept **X** | reject |
| GX-W3 W3 countunique per position hard-coded to 1 | Galaxy | wrong | battery | 1 | reject | reject | reject | accept **X** | reject |
| GX-W4 W4 AF threshold label printed with 2 decimal | Galaxy | wrong | battery | 1 | reject | reject | reject | reject | reject |
| HA-W1 W1 naive-debounce | Home Assistant | wrong | battery | 1 | reject | reject | reject | reject | accept **X** |
| HA-W2 W2 start-gate-from-memory | Home Assistant | wrong | battery | 1 | reject | reject | reject | reject | accept **X** |
| N12-W1 W1 forgets first KT->Zoho | n8n:12679 | wrong | battery | 23 | reject | reject | reject | reject | mixed(15/23 accepted) **X** |
| N12-W2 W2 empty-values-never-written | n8n:12679 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N12-W3 W3 case-sensitive-zoho-segment-tags | n8n:12679 | wrong | battery | 1 | reject | reject | reject | reject | accept **X** |
| N12-W4 W4 kt-segments-to-zoho-on-create-only | n8n:12679 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N12-W5 W5 form-tag-on-every-new-subscriber | n8n:12679 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N12-W6 W6 bookkeeping-tag-on-every-zoho-contact | n8n:12679 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N20-W1 W1 ref-only-prompt (T3) | n8n:20281 | wrong | harness (prompt) | 1 | reject | reject | reject | reject | reject |
| N20-W2 W2 forged-modelTape (T3) | n8n:20281 | wrong | harness (cost accounting) | 1 | accept **X** | accept **X** | accept **X** | accept **X** | accept **X** |
| N20-W3 W3 drop-critical | n8n:20281 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N20-W4 W4 notify-before-create | n8n:20281 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N20-W5 W5 mention-dodge-critical (T3) | n8n:20281 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N20-W6 W6 probe-dodge (T3) | n8n:20281 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| GX-C1 C1 multi-effect record keeps the highest-imp | Galaxy | correct | expected-log | 1 | accept | reject **X** | accept | accept | accept |
| GHA-C1 pr-text-new-then-old | GitHub Actions | correct | comparison | 3 | accept | reject **X** | accept | accept | accept |
| GHA-C2 failed-with-leftovers | GitHub Actions | correct | comparison | 1 | accept | reject **X** | accept | accept | accept |
| GHA-C3 labels-twice | GitHub Actions | correct | comparison | 1 | accept | reject **X** | accept | accept | accept |
| HA-C1 C1 buttons-reversed | Home Assistant | correct | comparison | 1 | accept* | reject **X** | accept | accept | accept |
| HA-C2 C2 typographic-apostrophe | Home Assistant | correct | comparison | 1 | accept* | reject **X** | accept | accept | accept |
| HA-C3 C3 last_changed-debounce | Home Assistant | correct | environment | 1 | accept | reject **X** | accept | accept | accept |
| HA-C4 C4 skip-round-condition-scope | Home Assistant | correct | expected-log | 1 | accept | reject **X** | accept | accept | accept |
| N12-C1 C1 berlin-midnight-birthdays (alternative de | n8n:12679 | correct | comparison | 1 | accept | reject **X** | reject **X** | reject **X** | accept |
| N20-C1 C1 review-names-sender-by-display-name | n8n:20281 | correct | comparison | 1 | accept* | reject **X** | accept | accept | accept |
| N20-C2 C2 here-ping-on-critical-follow-up | n8n:20281 | correct | comparison | 1 | accept* | reject **X** | accept | accept | accept |
| GX-R1 R1 Math.round instead of Python round at exa | Galaxy | residual | battery | 1 | accept **X** | reject | accept **X** | accept **X** | accept **X** |
| GHA-R1 LIMIT-catch-all-misleading-message | GitHub Actions | residual | comparison | 1 | accept **X** | reject | accept **X** | accept **X** | accept **X** |
| GHA-R2 LIMIT-reads-commented-lines-takes-max | GitHub Actions | residual | battery | 1 | accept **X** | reject | accept **X** | accept **X** | accept **X** |
| GHA-R3 LIMIT-stuffed-pr-text | GitHub Actions | residual | comparison | 1 | accept **X** | reject | accept **X** | accept **X** | accept **X** |
| N20-R1 R1 memorised-answers (no model calls) | n8n:20281 | residual | harness (answers not in effects) | 1 | accept **X** | accept **X** | accept **X** | accept **X** | accept **X** |

Per-design rows (all 192 designs, per tier, with fitness and precision) are in `out/summary.json`; per-seed rows in `out/rows-<item>.json`.

### 1.5 Totals against oracle v1 and v2

| evaluator | wrong classes detected (of 18) | correct classes accepted (of 11) | misclassified of the 29 | residual (of 5) caught | misclassified of all 34 |
|---|---|---|---|---|---|
| oracle v1 (dossier, by construction) | 0 | 0 | **29** | n/a | n/a |
| oracle v2 (current, same battery) | 17 | 11 | 1 | 0 | 6 |
| conformance tier I, tau = 1 (primary) | 17 | 10 | 2 | 0 | 7 |
| conformance tier I, tau = 0.95 | 14 | 10 | 5 | 0 | 10 |
| conformance tier I, 90 percent of cases exact | 13 | 11 | 5 | 0 | 10 |
| conformance tier G (no declaration), tau = 1 | 17 | 0 | 12 | 4 (artefact, see below) | 13 |

* The one wrong class neither v2 nor conformance catches is N20-W2, the forged model tape: the forgery is in the cost accounting, not in any effect.
* Tier G "catches" 4 of 5 residuals only because it rejects every design on Galaxy and GitHub Actions (tie order in sorted tables, free text); this is not detection.
* Lowering tau below 1 is unsafe: at 0.95 three Galaxy wrong classes (a few rows in hundreds) are accepted.
* Per design, over all 192 designs including the controls and the one design with no ground-truth label: v2 7 wrong (all false accepts), tier I 9 (8 false accepts, 1 false reject), tier G 27 (4 false accepts, 23 false rejects).

Ranking agreement. For every design with an executable oracle verdict the oracle v2 score (share of cases passed) is compared with mean conformance F1
(harmonic mean of fitness and precision). Pooled over 188 designs, Spearman tier I 0.65, tier G 0.39; Kendall 0.53 and 0.30. Per item:

| item | designs | seeds | Spearman I / G | Kendall I / G | verdict agreement with v2, I / G | AUC of F1 for "v2 accepts", I / G |
|---|---|---|---|---|---|---|
| Galaxy | 34 | 5 | 0.61 / 0.61 | 0.48 / 0.49 | 34 / 30 of 34 | 1.00 / 0.98 |
| n8n:12679 | 42 | 5 | 0.84 / 0.66 | 0.81 / 0.60 | 40 / 39 of 42 | 0.98 / 0.55 |
| n8n:20281 | 45 | 5 | 0.83 / 0.70 | 0.68 / 0.60 | 45 / 42 of 45 | 1.00 / 0.88 |
| Home Assistant | 45 | 10 | 0.89 / 0.61 | 0.75 / 0.48 | 45 / 38 of 45 | 1.00 / 0.72 |
| GitHub Actions | 26 | 28 | 0.96 / 0.82 | 0.88 / 0.72 | 26 / 15 of 26 | 1.00 / 0.88 |

Rank correlation understates the agreement because the two scores are on different scales (an oracle score is the share of cases passed; F1 is share of effects
matched, and a one-row error in a long table costs F1 almost nothing but fails the case). The binary verdicts and the AUC are the better summary: with tier I a
threshold on F1 separates the designs oracle v2 accepts from those it rejects perfectly on four of five items (AUC 1.00), and on n8n:12679 at 0.98.
Ranking agreement with oracle v1 as such cannot be measured: the v1 oracle code and its scores for these designs are not in the repository. What is known is
v1's verdict on the 29 classes, and it is the opposite of the truth by selection; every class tier I gets right is a class where conformance disagrees with v1
(27 of the 29), and the 2 it gets wrong are classes where it would agree with v1's mistake.

### 1.6 Per-pilot expressibility (second half of the kill rule)

All five pilots' effects are expressible. The cost differs, and two parts of a pilot's correctness are not effects at all:

* **Home Assistant**: a log of successful service calls with virtual times is natural; tier I adds only a key map (button lists and entity lists as sets, a few
  notification fields). Tier I agrees with the oracle on all 45 designs; tier G falsely rejects the 7 correct or equivalent designs (icon and action-id fields, apostrophes).
* **n8n:20281**: the effects carry model-authored text (titles, summaries, company, product area, confidence). Exact-key conformance rejects the oracle-accepted improved reference
  (fitness about 0.18 under G), so tier I projects each effect to its facts (project, type, priority, labels, named ticket keys, whether the sender is named,
  channel-wide mentions). That projection is oracle-like work (33 lines, the largest declaration). Classes **N20-W2 (forged model tape) and N20-R1 (memorised answers) are not
  expressible in an effect log**: the forged tape changes what is billed, the memorised answer produces the same effects as a correct run. Both stay accepted (as they are by the oracle).
  The bad controls `reply-all` (not observable at difficulty 3) is accepted by both.
* **n8n:12679**: the item is a two-system state sync, so the log is a state delta, not a call log. With each write call as one effect, the item's own improved design is
  rejected for issuing fewer, larger calls (G rejects at fitness 0.96). Tier I therefore compares the net effect per person and system. That declaration was added after
  the first dev run showed exactly this false rejection (see section 3). Bad control `no-ui-user-guard` (the integration reacts to its own writes) is a no-op in effects
  because the echo is idempotent, so conformance accepts it and the oracle rejects it.
* **Galaxy**: a batch job, expressed as table rows. Tier G rejects the correct highest-impact-effect design and the independent faithful implementation because rows that tie on the
  sort key come out in a different order (the oracle explicitly leaves ties unconstrained); tier I compares the two sorted tables as bags plus a sortedness predicate.
* **GitHub Actions**: the PR text and the failure message are free text. Tier G rejects every design whose wording differs from the reference (it disagrees with v2 on 11 of 26 designs);
  tier I replaces the text by the facts the contract demands (which changed image is named with its old and new tag; which required keyword groups appear), which are
  exactly the oracle's own checks, copied. The three residuals (keyword-stuffed message, stuffed PR text, commented lines read) are accepted by tier I because they satisfy those same fact checks.

### 1.7 Negative results kept

* Tier G (generic) is not usable alone: 23 false rejects among 192 designs, 0 of 11 correct classes accepted.
* Tier I misses all 5 residual classes, as the oracle does; three of them (keyword-stuffed message and PR text, commented lines) are accepted because the fact projection is the oracle's own check.
* Tier I rejects the correct class N12-C1 (Berlin-midnight birthdays) on 4 of 5 seeds. Its only remaining deviation is in scenario S15, a soak run of random mixed edits: a birthday value in a create or update that differs from the reference's (a different date, not a time-zone shift), while the oracle judges only the final state of the soak and accepts. This is
  a process-versus-final-state difference that net-effect merging does not remove. It is a miss of the evaluator, not an artefact.
* Tau below 1 is unsafe (3 Galaxy classes accepted at 0.95), and "90 percent of cases exact" additionally accepts the two HA wrong classes, N12-W3 and 15 of the 23 N12-W1 designs, besides the forged tape every variant accepts.
* The expected log carries the semantic. Using the HA expected log built from the v0.1.0 reading of the condition scope (stop the whole run at a failed check, what oracle v1 expected)
  reproduces v1 exactly: conformance then accepts the two stop-on-failed-check designs (10 of 10 seeds) and rejects all 10 correct designs, including the reference (HA-C4). The
  evaluator inherits whatever the expected log says.
* N20-W2 and N20-R1 are structurally outside an effect log.

## 2. Row 33: corpus variant-family census

### 2.1 Method

Input: `research/corpus-20261006/items.jsonl`, 1,559 items from 49 platforms, read only. "Ships an oracle" means `oracle.kind != "none"` (all 1,121 `none`; 277 test-profile, 108 output-equivalence, 53 mocked-execution = 438).
Corpus text (titles, descriptions) is data: titles are used only for the lineage proxy below and are shown truncated in the tables.

**Template lineage.** The schema has no fork or parent field, and a phrase scan of title, description, oracle and IR notes ("forked from", "copy of", "derived from", "duplicate of", "variant of", "adapted from", ...) finds 3 hits,
none naming another corpus item. Lineage is therefore a proxy, evaluated within a platform for every pair. Two items are lineage-linked when any of:

* their normalised title stems are equal (lower case, parenthesised text removed, digits removed, stop words removed, at least 6 characters);
* their ids are equal after removing a trailing `@version` (two releases of one pipeline);
* they come from the same source directory (repo and directory derived from the url or id) **and** their title tokens have Jaccard similarity of at least 0.5.

141 pairs are lineage-linked.

**Normalised structure.** Each graph keeps its nodes and edges; a node label is `category | effects | normalised type`, where the type is lower-cased and every digit run or uuid becomes `#`
(ids, versions and counters are not structure). An edge keeps its kind (data, control, error, loop). Node ids, summaries and free text are dropped. Graphs with fewer than 5 nodes (240 items, 77 with an oracle) are
excluded from the distance-based families and included only in the lineage-only definition.

**Distance.** Graph edit distance upper bound by bipartite assignment (Riesen and Bunke): the cost of substituting node u by v is 0 for equal labels, 0.4 for the same category and effects,
0.8 for the same category, 1 otherwise, plus 0.5 times the L1 distance between the multisets of (direction, kind, neighbour category) of the two nodes' edges; deleting or inserting a node costs 1 plus 0.5 per incident edge;
solved exactly by the Hungarian algorithm. The distance is that cost divided by the larger graph's nodes plus edges, so it lies in [0, 1]. It is an upper bound on the true edit distance (so families are, if anything, under-merged). Pairs are first
screened by two valid lower bounds (size difference; node-class multiset), which removes 12,137 of 44,259 within-platform pairs. Graphs above a node limit use a signature distance (label and edge-profile multiset mismatch) instead, which is a coarser proxy:
limit 120 nodes in the fast run (3,817 signature distances), limit 400 in the headline run (361).

**Families.** Thresholds: theta = 0.25 primary, 0.15 and 0.35 sensitivity.

* `F_L` lineage only: connected components of lineage links.
* `F_S` structure only: components of pairs with distance <= theta.
* `F_LS` lineage plus structure (**primary**): components of pairs with distance <= theta, or lineage-linked with distance <= 2 theta (shared origin is evidence, so it relaxes the threshold).
* Each also with complete linkage (every pair in a family must be within its threshold), to check chaining.

**Oracle-bearing families** are counted three ways: at least 3 members that ship an oracle (**primary**), all members ship one, any member ships one. The kill rule asks for fewer than 10 families with at least 3 variants and shipped oracles.

### 2.2 Results (headline: exact assignment distance up to 400 nodes, primary definition)

| quantity | value |
|---|---|
| items | 1,559 |
| items in a family of 2 or more (F_LS, theta 0.25) | 67 families |
| families with at least 3 variants | **18** (59 items) |
| of which with at least 3 oracle-bearing members | **4** |
| of which all members ship an oracle | 4 |
| of which any member ships an oracle | 5 |
| family size distribution (2 / 3 / 4 / 5 to 9 / 10 and over) | 49 / 14 / 3 / 1 / 0 |
| largest family | 5 members (CWL workflows from WorkflowHub; no oracle) |
| complete linkage, same definition | 9 families of 3 or more, 2 with at least 3 oracle-bearing members |

Kill rule: **4 families (fewer than 10): fires.** The fast run (signature distance above 120 nodes) gives 9, still below 10, and its extra five come from nf-core, nextflow and snakemake pipelines whose large graphs are
matched only by the signature proxy (nf-core pipelines share a template skeleton, so these may be real template variants that the proxy over-merges or that the assignment cost splits; the data cannot tell).

Sensitivity, exact run (families with at least 3 members, and how many carry at least 3 oracle-bearing members):

| theta | definition | linkage | families >=3 | with >=3 oracle members (primary criterion) | all members oracle | any member oracle |
|---|---|---|---|---|---|---|
| 0.15 | F_L lineage only | single (components) | 17 | 8 | 7 | 9 |
| 0.15 | F_S structure only | single (components) | 3 | 1 | 1 | 1 |
| 0.15 | F_S structure only | complete | 2 | 0 | 0 | 0 |
| 0.15 | F_LS lineage+structure | single (components) | 5 | 1 | 1 | 1 |
| 0.15 | F_LS lineage+structure | complete | 2 | 0 | 0 | 0 |
| 0.25 | F_L lineage only | single (components) | 17 | 8 | 7 | 9 |
| 0.25 | F_S structure only | single (components) | 15 | 4 | 4 | 4 |
| 0.25 | F_S structure only | complete | 6 | 1 | 1 | 1 |
| 0.25 | F_LS lineage+structure | single (components) | 18 | 4 | 4 | 5 |
| 0.25 | F_LS lineage+structure | complete | 9 | 2 | 2 | 2 |
| 0.35 | F_L lineage only | single (components) | 17 | 8 | 7 | 9 |
| 0.35 | F_S structure only | single (components) | 26 | 5 | 5 | 5 |
| 0.35 | F_S structure only | complete | 22 | 5 | 5 | 5 |
| 0.35 | F_LS lineage+structure | single (components) | 28 | 5 | 5 | 6 |
| 0.35 | F_LS lineage+structure | complete | 25 | 6 | 6 | 6 |

Reading the table: in the exact run no cell reaches 10 on any of the three oracle criteria (the maximum is 9, at theta 0.15 for lineage-only components, which do not depend on theta; the maximum with the primary criterion is 8, same cell).
Lineage alone gives more oracle-bearing families than structure does (8 versus 4 to 5) because the lineage proxy links same-directory siblings regardless of how their graphs differ. Fast run (signature distance above 120 nodes), where the largest cells are 12 (primary criterion) and 13 (two oracle-bearing members), both complete linkage at theta 0.35:

| theta | definition | linkage | families >=3 | with >=3 oracle members |
|---|---|---|---|---|
| 0.15 | F_L lineage only | single | 17 | 8 |
| 0.15 | F_S structure only | single | 5 | 1 |
| 0.15 | F_S structure only | complete | 3 | 0 |
| 0.15 | F_LS lineage+structure | single | 7 | 1 |
| 0.15 | F_LS lineage+structure | complete | 3 | 0 |
| 0.25 | F_L lineage only | single | 17 | 8 |
| 0.25 | F_S structure only | single | 24 | 8 |
| 0.25 | F_S structure only | complete | 13 | 5 |
| 0.25 | F_LS lineage+structure | single | 27 | 9 |
| 0.25 | F_LS lineage+structure | complete | 16 | 6 |
| 0.35 | F_L lineage only | single | 17 | 8 |
| 0.35 | F_S structure only | single | 32 | 8 |
| 0.35 | F_S structure only | complete | 38 | 11 |
| 0.35 | F_LS lineage+structure | single | 33 | 8 |
| 0.35 | F_LS lineage+structure | complete | 41 | 12 |

### 2.3 Top 20 families (primary definition, exact run)

| # | size | platform | oracle-bearing | diameter | example members (data, truncated) |
|---|---|---|---|---|---|
| 1 | 5 | cwl | 0/5 | 0.51 | CWL-based RNA-Seq workflow (WorkflowHub #524) ; CWL-based ChIP-Seq workflow (WorkflowHub #525) |
| 2 | 4 | wdl | 4/4 | 0.17 | ExomeGermlineSingleSample (broadinstitute/warp) ; WholeGenomeGermlineSingleSample (broadinstitute/ |
| 3 | 4 | langflow | 0/4 | 0.22 | Custom Component Generator ; Price Deal Finder |
| 4 | 4 | home-assistant | 0/4 | 0.44 | Roomba - Run Basement Roomba Partial Clean ; Roomba - Run Upstairs Roomba when USER2 Leaves |
| 5 | 3 | airflow | 3/3 | 0.31 | example_athena (provider:amazon) ; example_glue_data_quality (provider:amazon) |
| 6 | 3 | kubeflow | 3/3 | 0.39 | conditional-execution-pipeline (KFP compiled pip ; nested-conditions-pipeline (KFP compiled pipelin |
| 7 | 3 | galaxy | 3/3 | 0.26 | Genome Assembly with Pacbio Hifi reads and Trio  ; Genome Assembly from Hifi reads - VGP3 (IWC VGP- |
| 8 | 3 | temporal | 2/3 | 0.46 | nexus-messaging (Temporal Go sample) ; nexus_messaging (Temporal Python sample) |
| 9 | 3 | flowise | 0/3 | 0.09 | Conversational Agent ; ReAct Agent |
| 10 | 3 | flowise | 0/3 | 0.28 | Conversational Retrieval QA Chain ; Github Docs QnA |
| 11 | 3 | node-red | 0/3 | 0.07 | Z2M Admin Panel ; Zigbee2mqtt admin (improved and reordered) |
| 12 | 3 | github-actions | 0/3 | 0.29 | Update files & Reload bot on Linux server ; Update Selenium Grid Docker Versions |
| 13 | 3 | cwl | 0/3 | 0.42 | amplicon-wf--v.5-cond.cwl (EBI-Metagenomics/pipe ; assembly-wf--v.5-cond.cwl (EBI-Metagenomics/pipe |
| 14 | 3 | apple-shortcuts | 0/3 | 0.31 | Main17.0 ; Main11.0 |
| 15 | 3 | home-assistant | 0/3 | 0.34 | Controller - IKEA E1524/E1810 TRÅDFRI Wireless 5 ; Controller - IKEA E2001/E2002 STYRBAR Remote con |
| 16 | 3 | home-assistant | 0/3 | 0.64 | Controller - Xiaomi WXCJKG11LM Aqara Opple 2 but ; Controller - Xiaomi WXCJKG12LM Aqara Opple 4 but |
| 17 | 3 | home-assistant | 0/3 | 0.37 | Sensor Light ; Bathroom Humidity Exhaust Fan |
| 18 | 3 | claude-code-workflows | 0/3 | 0.21 | Preflight: two live construction smokes and a ha ; Three independent design-review lanes in paralle |
| 19 | 2 | coze | 2/2 | 0.22 | Coze Studio canvas fixture: loop_selector_variab ; Coze Studio canvas fixture: subworkflow/bottom_w |
| 20 | 2 | n8n | 2/2 | 0.21 | 💅 AI Agents Generate Content & Automate Posting ; 💾 Generate Blog Posts on Autopilot with GPT‑5,  |

Platforms contributing members to families of 3 or more (items in such families / platform items): Home Assistant 13/96, CWL 8/45, Flowise 6/51, Langflow 4/27, WDL 4/36,
Airflow 3/88, GitHub Actions 3/85, Kubeflow 3/30, Temporal 3/34, Galaxy 3/60, Node-RED 3/45, Apple Shortcuts 3/79, claude-code-workflows 3/10 (first-party items, not independent evidence).
Many families are sets of examples a platform's documentation ships together (Airflow system tests, Kubeflow tutorial pipelines, Temporal samples, Flowise starter agents), which are siblings, not forks of a template.

### 2.4 The families that satisfy the kill rule's condition (at least 3 oracle-bearing members)

| # | size | platform | oracle-bearing | diameter | example members (data, truncated) |
|---|---|---|---|---|---|
| 1 | 4 | wdl | 4/4 | 0.17 | ExomeGermlineSingleSample (broadinstitute/warp) ; WholeGenomeGermlineSingleSample (broadinstitute/ |
| 2 | 3 | airflow | 3/3 | 0.31 | example_athena (provider:amazon) ; example_glue_data_quality (provider:amazon) |
| 3 | 3 | kubeflow | 3/3 | 0.39 | conditional-execution-pipeline (KFP compiled pip ; nested-conditions-pipeline (KFP compiled pipelin |
| 4 | 3 | galaxy | 3/3 | 0.26 | Genome Assembly with Pacbio Hifi reads and Trio  ; Genome Assembly from Hifi reads - VGP3 (IWC VGP- |

### 2.5 The five pilots

None of the pilots belongs to a family with a shipped oracle. n8n:12679, n8n:20281, the Home Assistant garbage-day automation and the Galaxy item are singletons; the GitHub Actions selenium item sits in a 3-member
family with no oracle (an unrelated bot workflow and one more). The corpus items themselves record `oracle.kind = none` for the n8n, HA and GHA pilots, and `output-equivalence` for the Galaxy one; the pilots' hand-built oracles are not part of the corpus items.
So the corpus offers no sibling variants on which to test whether a pilot's oracle generalises.

## 3. Honest limits

* **In-sample normalisations.** The tier I files were written while looking at results on the dev seeds (HA 0-9, n8n:20281 and n8n:12679 first runs). Three revisions were driven by dev results and are logged here: the n8n:20281 fact projection
  (after exact keys rejected the improved reference), the n8n:20281 key regexes (a quoted "HP-2231" was read as a ticket key; a regex swallowed trailing JSON), and the n8n:12679 net-effect merging (after the item's improved design was rejected for batching). `PREREG.json` freezes
  the final files by sha256 (check with `node prereg.mjs --check`); it is a freeze, not a preregistration. No held-out seed (7001 and above) was run, so there is no out-of-sample estimate of tier I.
* **The 29 is a ceiling** (see the cautions at the top). The class count, 29 versus 34, depends on my reading of "5 residual".
* **v2 verdicts for four classes are documented, not re-run** (perturbations of the log: HA-C1, HA-C2, N20-C1, N20-C2). I realised those four as log perturbations because the effect they describe (reversed button order,
  typographic apostrophe, sender named by display name, channel-wide mention on a follow-up) is a property of the comparison, not a runnable design.
* **Battery confound.** Conformance runs on the v2 batteries; the v1 failures were on the v1 batteries, which are not preserved.
* **Expected logs.** HA and GHA expected logs are executed originals or the reference solution; n8n expected logs are the faithful transcriptions (the executed original needs `/opt/corpus`, absent here); Galaxy derived jobs are judged against the reference, itself checked only
  on the shipped job. A shared bug in the expected log is invisible to conformance.
* **Class selection.** n8n:12679 contributes 6 wrong classes and 1 correct, n8n:20281 6 and 2, HA 2 and 4, Galaxy 4 and 1, GHA 0 and 3, matching dossier 7's counts, but the design realisations (the W1 field-forgetting designs, the inline designs of the item tests) are mine
  or the item tests'. Class identities for GHA's three correct classes (PR-text order, leftover files on a failed plan, duplicate labels) are my mapping of DESIGN's parenthetical.
* **Census.** Lineage is a proxy; the distance is an assignment upper bound with a hand-set cost model; graphs with fewer than 5 nodes are excluded from distance families; the kill-rule count is sensitive to the oracle-bearing definition and the distance used,
  although every exact-run cell at the primary and stricter settings is below 10. The nf-core family disagreement between the two runs (signature versus assignment) is unresolved.
* Machine load: other jobs shared this laptop; run times in the logs are not benchmarks.

## 4. Commands (all from the repo root)

```
node --test research/jit-20261008/analysis/replication/lib/conformance.test.mjs research/jit-20261008/analysis/replication/census/lib.test.mjs
# row 17: one adapter at a time (each prints a row count; ~1 to 5 minutes each on a loaded machine)
node --max-old-space-size=1024 research/jit-20261008/analysis/replication/run.mjs galaxy   --seeds 0-4
node --max-old-space-size=1024 research/jit-20261008/analysis/replication/run.mjs n8n12679 --seeds 0-4
node --max-old-space-size=1024 research/jit-20261008/analysis/replication/run.mjs n8n20281 --seeds 0-4
node --max-old-space-size=1024 research/jit-20261008/analysis/replication/run.mjs ha       --seeds 0-9
node --max-old-space-size=1024 research/jit-20261008/analysis/replication/run.mjs gha      --seeds 0-27
node research/jit-20261008/analysis/replication/aggregate.mjs        # out/summary.json, out/class-table.md
node research/jit-20261008/analysis/replication/peek.mjs galaxy      # per-design summary of one adapter
node research/jit-20261008/analysis/replication/prereg.mjs --check   # frozen files unchanged?
# row 33
CENSUS_LARGE=400 CENSUS_TAG=exact400 node --max-old-space-size=1024 research/jit-20261008/analysis/replication/census/census.mjs   # headline, ~11 min on a loaded machine
CENSUS_LARGE=120 CENSUS_TAG=sig120   node --max-old-space-size=1024 research/jit-20261008/analysis/replication/census/census.mjs   # fast variant, ~1 min
```

## 5. Files

* `lib/conformance.mjs`, `lib/conformance.test.mjs`: the evaluator and its tests.
* `adapters/<item>.mjs`: log extraction, expected logs, candidate designs (read-only imports of the item environments).
* `normalisation/<item>.mjs`: tier G and tier I declarations.
* `run.mjs`, `peek.mjs`, `aggregate.mjs`, `prereg.mjs`, `PREREG.json`: runner, inspection, aggregation, freeze.
* `out/rows-<item>.json`: per-seed rows; `out/summary.json`, `out/class-table.md`: aggregates.
* `census/lib.mjs`, `census/lib.test.mjs`, `census/census.mjs`: normalisation, distance, lineage, census. `out/census-exact400.json`, `out/census-sig120.json`, `out/census-top20-*.json`, `out/census-families-primary-*.tsv`.
