# AUDIT-L1: hand audit of the pattern census, detector precision, and checklist-versus-failures (L1-a, L6-a)

*2026-10-09 · $0, no model calls, no Jev calls · single auditor (an agent) · `beds/sealed/` never read · new files only: this file and `out/L1-audit*.json*`, `out/L1-detector-hits-*`, `out/L6-audit.json`, `out/audit-scripts/`. Nothing existing was modified; L1-PATTERNS.md is unchanged and §8 below lists what should change in it.*

## 0. Result

1. **Corrected coverage.** On 60 hand-labelled workflows, stratified by cluster and pattern count, L0 plus L1 explain 88.4% of the 1,559 corpus workflows (Wilson 95% interval 75.0–95.1%, Kish effective n 40.3), not the census's 97.8%.
2. **Why it moved.** The census "explained" count is the count of non-refused items and is true by construction (L1-PATTERNS §1.4); the audit gap is almost entirely two Node-RED dashboard applications (#17 and #49, each carrying a stratum weight of about 60 items) that I read as the §2.5 "interactive dashboard state" refusal and the census explained. If those two are counted as explained the estimate is 96.1% (85.2–99.1%); if the refusal is applied by widget count to the whole corpus (14 more Node-RED items with 20 or more UI widgets) it is 95.2% (82.1–98.3%). The widget-count variant is the better-founded one and the sample-only one the stricter; the owner decides whether a dashboard app is a refusal.
3. **L1-a: FAIL.** Rule precision (yes + partly/2) is 0.73 for the 168 node-rule and token assignments (Wilson 66.1–79.3%) and 0.65 over all 222 detector assignments; the bar is 0.85 with a Wilson lower bound of 0.75, and the falsifier (below 0.75) is met. The coverage claim does not leave the directory.
4. **Detectors to remove (precision below 0.5 on fixed-seed hit samples): P02 (0.23), P30 (0.00), P49 (0.31), P16 (0.31), P17 (0.08), P18 (0.18).** All six are support-only, so removing them changes no census status or budget bucket (checked: 0 items carry any of them in their explained-needs set). P30 has 0 genuine hits of 7.
5. **L6-a: FAIL on the strict reading.** 6 of 21 recorded failure causes are named by an L1 checklist line or §9 code (28.6%, Wilson 13.8–50.0%); counting "partly" as named it is 57.1%. Below 50% under every denominator I tried on the strict reading, so 15 checklist lines are proposed, each `minedFrom: repo:<ref>` (§6).

## 1. Method and seeds

**L1-a sample.** Seed 20261009, PRNG mulberry32, per stratum the ids sorted lexicographically and Fisher-Yates shuffled on one shared stream, first k taken, strata visited in allocation order, then the 60 shuffled once for review order. Strata are the six platform clusters (automation, orchestration, science, consumer-creative, agentic, first-party; 10 items each) crossed with the census distinct-L1-pattern count (A: 0–1, B: 2–4, C: 5+), plus an R stratum of census-refused items inside agentic (the two refused automation items are merged into A). Frame sizes and allocations are in `out/L1-audit-draw.json`; every item carries its stratum size and draw order.

| cluster | A (0–1) | B (2–4) | C (5+) | R (refused) |
|---|---|---|---|---|
| automation | 3 of 57 | 4 of 157 | 3 of 181 | - |
| orchestration | 4 of 258 | 4 of 124 | 2 of 14 | - |
| science | 4 of 159 | 4 of 104 | 2 of 15 | - |
| consumer-creative | 3 of 69 | 4 of 105 | 3 of 99 | - |
| agentic | 1 of 5 | 4 of 109 | 3 of 60 | 2 of 33 |
| first-party | - | 10 of 10 | - | - |

**Blind labelling.** Each item was shown through `audit-scripts/view.mjs` (title, description, graph nodes with category, type and summary, edges, features; the `ir` field and every census output hidden) and labelled in draw order with the L0 constructs, the L1 patterns, an "explained" call (yes, partly, no), a refusal reading and gaps. Rows were appended with a timestamp (`labelledAt`) by `addlabel.mjs`; four rows were revised before any census row was opened for them (`revisedAt`, `revisionNote`, an inconsistency in how I labelled the P01, P05 and P08 chain idioms). SHA-256 of the labels file: `e0f2ff3d59eba411...`. **Disclosure:** the stratum letter (pattern-count bucket) of each item was visible to me in the draw output, so I knew the bucket but no pattern id, token or verdict; and the corpus summaries I read are the same fields the census reads.

**Adjudication (pass 2).** After the labels were final, `census-nodes.mjs` (a copy of the census tool that also dumps per-node assignments and plumbing witnesses; its needs and plumbing output equals the published census on all 1,559 items) gave for each item the detector set, the rule or token or witness behind every pattern, and the anchor nodes. Every detector pair (item, pattern) was judged yes, partly or no: does the pattern's skeleton describe the node or nodes that own it. Every blind-only pattern was coded m (the detector gave another owner or missed the shape) or M (the detector has no rule or no node for it). Adjudication lines are in `out/L1-audit-adjudication.jsonl` (290 lines). **Bias:** the adjudicator saw the detector's anchors, which pulls towards agreement, so adjudicated precision is the optimistic figure and blind agreement the pessimistic one; the L1-a decision fails on the optimistic one.

**Estimators.** Corrected coverage is post-stratified (weight = stratum size over stratum sample); its interval is Wilson at the Kish effective n (40.3); a seeded stratified bootstrap (seed 20261011, 5,000 resamples) and the unweighted n = 60 Wilson are reported beside it. Strict means "explained = yes" only. Precision of pairs uses (yes + partly/2) over pairs, with a Wilson interval on the fractional count and an item-clustered bootstrap. Census-refused items carry no census patterns by design, so their blind patterns are outside pattern recall (2 items: #42, #44).

**Detector hit samples.** Seed 20261010: for each pattern, the items whose detector set contains it, ids sorted, shuffled on one stream in the listed order, first k judged real, partly or not real. The five most frequent patterns are P01, P02, P37, P38, P08 (10 judged each; P01 and P02 judged 20); the five rarest non-zero are P48, P30, P49, P31, P22 (all hits judged, 6 to 10); the support-only detectors P01, P02, P16, P17, P18, P49 are judged 20 each or all hits when fewer exist (P16 18, P49 8). P11, P23, P24 and P52 never fire (P11, P23, P24, P52); they cannot be sampled. Per-hit verdicts: `out/L1-detector-hits-verdicts.jsonl`.

## 2. Table 1: coverage, item-level agreement, rule precision

| quantity | value | interval or note |
|---|---|---|
| census claim: explained by L0 + L1 | 97.8% (1,524 of 1,559) | tautological by construction; no interval |
| **audit, strict, post-stratified** | **88.4%** | **Wilson 75.0–95.1% (Kish n 40.3); stratified bootstrap 82.8–94.4%** |
| audit, strict, unweighted n = 60 | 91.7% | Wilson 81.9–96.4% |
| audit, lenient (partly counts as explained) | 90.1% | Wilson 77.2–96.1%; bootstrap 86.3–97.9% |
| sensitivity: the two dashboard refusals counted as explained | 96.1% | Wilson 85.2–99.1%; bootstrap 92.6–97.9% |
| sensitivity: dashboard refusal applied by widget count, whole corpus | 95.2% | Wilson 82.1–98.3%; bootstrap 91.7–97.0%; 14 extra items, 58 sample items used |
| item-level agreement on "explained" (census explained = not refused vs my yes) | 57 of 60 (95.0%) | lenient reading 58 of 60 (96.7%); the census says explained and I say not on 3 items (#17, #49, #54), the reverse on 0 |
| pattern sets equal, detector vs blind (L1 only) | 6 of 60 items | mean Jaccard 0.40; 36 items have a detector pair judged no, 36 have a blind-only pattern |
| **rule precision, node-rule and token pairs** | **0.73** | 168 pairs (100 yes, 46 partly, 22 no); Wilson 66.1–79.3%; cluster bootstrap 68.9–77.8%; weighted 0.72; **fail** |
| rule precision, all detector pairs | 0.65 | 222 pairs (119/49/54); Wilson 58.2–70.6%; **fail** |
| precision, support-only (plumbing) pairs | 0.38 | 54 pairs (19/3/32); Wilson 26.2–51.3% |
| detector recall against my blind labels | 0.61 | 100 of 165 blind pairs (Wilson 53.0–67.7%); 39 blind-only pairs where another owner was chosen, 26 with no rule; adjudicated recall 0.69 |

**L0 constructs (if, guard, judge, input).** Agreement on presence: if 66.7% (kappa 0.33; both 10, mine only 20, census only 0); guard 80.0% (kappa 0.05; both 1, mine only 9, census only 3); judge 80.0% (kappa 0.18; both 2, mine only 11, census only 1); input 35.0% (kappa 0.00; both 21, mine only 39, census only 0). This comparison is weak by design: the census records an L0 construct only when a control node falls to a plain L0 rule, so plain conditions that it assigned to an L1 pattern, and every input that is not a trigger node, do not appear as L0. Read it as "the census L0 counts are not constructs present", not as an error rate.

## 3. Table 2: per-pattern precision and recall on the 60 items

Precision = (yes + partly/2) over detector pairs; blind = share of detector pairs that my blind label also had. Recall (blind) = detector pairs also in my blind label over my blind pairs; recall (adj) counts adjudicated-true pairs over adjudicated-true plus blind-only. Patterns with 3 or more detector pairs or 3 or more blind pairs; the rest are in `out/L1-audit.json` (`perPattern`).

| pattern | detector pairs | yes / partly / no | precision (adj) | precision (blind) | blind pairs | missed (m / M) | recall (blind) | recall (adj) |
|---|---|---|---|---|---|---|---|---|
| P01 | 20 | 15 / 1 / 4 | 0.78 | 0.35 | 16 | 7 / 2 | 0.44 | 0.63 |
| P18 | 16 | 0 / 0 / 16 | 0.00 | 0.00 | 0 | 0 / 0 | n/a | n/a |
| P45 | 12 | 12 / 0 / 0 | 1.00 | 1.00 | 13 | 1 / 0 | 0.92 | 0.92 |
| P47 | 11 | 7 / 3 / 1 | 0.77 | 0.00 | 1 | 1 / 0 | 0.00 | 0.90 |
| P14 | 10 | 9 / 1 / 0 | 0.95 | 0.70 | 9 | 2 / 0 | 0.78 | 0.83 |
| P27 | 9 | 6 / 3 / 0 | 0.83 | 0.67 | 6 | 0 / 0 | 1.00 | 1.00 |
| P02 | 8 | 1 / 0 / 7 | 0.13 | 0.13 | 2 | 1 / 0 | 0.50 | 0.50 |
| P38 | 8 | 2 / 4 / 2 | 0.50 | 0.50 | 9 | 5 / 0 | 0.44 | 0.44 |
| P08 | 7 | 0 / 7 / 0 | 0.50 | 0.43 | 11 | 4 / 4 | 0.27 | 0.30 |
| P29 | 7 | 6 / 1 / 0 | 0.93 | 0.71 | 6 | 0 / 1 | 0.83 | 0.87 |
| P37 | 7 | 1 / 5 / 1 | 0.50 | 0.14 | 2 | 1 / 0 | 0.50 | 0.78 |
| P54 | 7 | 6 / 1 / 0 | 0.93 | 1.00 | 10 | 0 / 3 | 0.70 | 0.68 |
| P05 | 6 | 4 / 0 / 2 | 0.67 | 0.67 | 5 | 1 / 0 | 0.80 | 0.80 |
| P20 | 6 | 2 / 0 / 4 | 0.33 | 0.33 | 2 | 0 / 0 | 1.00 | 1.00 |
| P10 | 5 | 4 / 1 / 0 | 0.90 | 0.80 | 4 | 0 / 0 | 1.00 | 1.00 |
| P41 | 5 | 5 / 0 / 0 | 1.00 | 1.00 | 5 | 0 / 0 | 1.00 | 1.00 |
| P42 | 5 | 3 / 2 / 0 | 0.80 | 0.20 | 1 | 0 / 0 | 1.00 | 1.00 |
| P55 | 5 | 2 / 3 / 0 | 0.70 | 0.80 | 7 | 3 / 0 | 0.57 | 0.54 |
| P06 | 4 | 2 / 1 / 1 | 0.63 | 0.25 | 3 | 0 / 2 | 0.33 | 0.56 |
| P12 | 4 | 2 / 2 / 0 | 0.75 | 0.75 | 16 | 7 / 6 | 0.19 | 0.19 |
| P13 | 4 | 1 / 2 / 1 | 0.50 | 0.25 | 1 | 0 / 0 | 1.00 | 1.00 |
| P15 | 4 | 0 / 1 / 3 | 0.13 | 0.00 | 5 | 3 / 2 | 0.00 | 0.09 |
| P17 | 4 | 0 / 0 / 4 | 0.00 | 0.00 | 0 | 0 / 0 | n/a | n/a |
| P26 | 4 | 4 / 0 / 0 | 1.00 | 0.00 | 2 | 0 / 2 | 0.00 | 0.67 |
| P32 | 4 | 2 / 1 / 1 | 0.63 | 0.75 | 5 | 1 / 1 | 0.60 | 0.56 |
| P34 | 4 | 4 / 0 / 0 | 1.00 | 0.75 | 4 | 0 / 1 | 0.75 | 0.80 |
| P56 | 4 | 4 / 0 / 0 | 1.00 | 1.00 | 4 | 0 / 0 | 1.00 | 1.00 |
| P04 | 3 | 1 / 1 / 1 | 0.50 | 0.33 | 2 | 0 / 1 | 0.50 | 0.60 |
| P07 | 3 | 2 / 0 / 1 | 0.67 | 0.67 | 2 | 0 / 0 | 1.00 | 1.00 |
| P21 | 3 | 2 / 0 / 1 | 0.67 | 0.33 | 1 | 0 / 0 | 1.00 | 1.00 |

Reading. The worst recall is on the shapes that sit in step-level tags or in flattened structure that the detector never sees: P12 (16 blind pairs, recall 0.19), P08, P15, P38, P01, P54. The worst precision is on the keyword detectors (P18 0 of 16, P17 0 of 4, P02 1 of 8) and on two node rules: P20 (generate-verify-retry) and P15 (fan-in), 0.33 and 0.13 at n = 6 and 4, too few to remove under the 0.5 rule but enough to re-scope. P08 is a concern in a different way: all 7 detector pairs are "partly" (data filters, not guards before an effect) while 8 genuine guards were missed.

## 4. Table 3: detector precision on fixed-seed hit samples

| pattern | group | population | judged | yes / partly / no | precision | Wilson 95% |
|---|---|---|---|---|---|---|
| P01 | five-most-frequent, support-only-20 | 758 | 20 | 9 / 9 / 2 | 0.68 | 45.7–83.7% |
| P02 | five-most-frequent, support-only-20 | 348 | 20 | 3 / 3 / 14 | 0.23 | 9.6–44.3% |
| P37 | five-most-frequent | 282 | 10 | 2 / 8 / 0 | 0.60 | 31.3–83.2% |
| P38 | five-most-frequent | 252 | 10 | 8 / 0 / 2 | 0.80 | 49.0–94.3% |
| P08 | five-most-frequent | 229 | 10 | 7 / 2 / 1 | 0.80 | 49.0–94.3% |
| P18 | support-only-20 | 225 | 20 | 2 / 3 / 15 | 0.18 | 6.6–38.9% |
| P17 | support-only-20 | 147 | 20 | 0 / 3 / 17 | 0.08 | 1.8–26.9% |
| P16 | support-only-20 | 18 | 18 (all) | 1 / 9 / 8 | 0.31 | 14.4–53.6% |
| P22 | five-rarest-nonzero | 10 | 10 (all) | 10 / 0 / 0 | 1.00 | 72.2–100.0% |
| P31 | five-rarest-nonzero | 9 | 9 (all) | 7 / 1 / 1 | 0.83 | 50.7–96.1% |
| P49 | five-rarest-nonzero, support-only-20 | 8 | 8 (all) | 1 / 3 / 4 | 0.31 | 10.2–64.4% |
| P30 | five-rarest-nonzero | 7 | 7 (all) | 0 / 0 / 7 | 0.00 | 0.0–35.4% |
| P48 | five-rarest-nonzero | 6 | 6 (all) | 2 / 4 / 0 | 0.67 | 30.0–90.3% |

For the "10 hits" requirement the first 10 of each draw give: P01 0.70, P02 0.30, P37 0.60, P38 0.80, P08 0.80, P48 0.67, P30 0.00, P49 0.31, P31 0.83, P22 1.00. Notes by pattern:
- **P37 webhook (0.60).** 8 of 10 hits are "partly": 6 are GitHub or GitLab push and pull-request starts, which have no reply (the P38 shape), one is a Zapier sub-zap start and one a token-only Langflow API flow. Only 2 of 10 are request-and-respond. The platform split of the whole P37 population is github-actions 72, n8n 65, gitlab-ci 41, so about 40% of P37 comes from CI platforms.
- **P38 event rule (0.80).** The two misses are orchestration start messages, not event rules.
- **P08 guard (0.80).** 7 of 10 are real guards (a condition gating an effect). The no is an input selector; the two partly are a stream splitter and a dispatch table of 16 `choose` nodes.
- **P01 linear pipeline (0.68).** 9 of 20 are real typed chains, 9 are partly (control-order sequences or trivial three-node sequences with no data hand-off), 2 are unrelated lookups or debug chains.
- **P02 fetch-transform-write (0.23).** 14 of 20 are not syncs: CI cache restore and save, media processing, bioinformatics sample sheets, shortcut utilities.
- **P17 reconcile (0.08), P18 best-of-N (0.18).** Wrong shapes: model-loader and text-encoder inputs feeding one sampler, agent tool lists, device reads. The two real P18 hits are three concurrent translations followed by a pick and three parallel analysts that are merged.
- **P16 dedupe (0.31), P49 panel (0.31).** Keyword hits on exact-key removeDuplicates nodes and on sequences of graders; one real hit in each.
- **P30 saga (0.00).** Seven of seven are WDL `RevertSam` or a file-editor undo tool, as L1-PATTERNS already says.
- **P48 tripwire (0.67), P31 checkpoint (0.83).** Real but few; the P31 miss is the word "can" in a loop description.
- **P22 loop-until (1.00).** all 10 hits are Home Assistant `repeat.while` loops and 8 of them are one author's controller blueprints (EPMatt/awesome-ha-blueprints): genuine, but one platform and essentially one family.

## 5. Corrected coverage statement

On 60 stratified hand labels, L0 plus L1 explain 88.4% of the 1,559 corpus workflows (Wilson 95% interval 75.0–95.1%, Kish effective n 40.3), against the census figure of 97.8% that is true only by construction.

The interval is wide because four of the 17 strata have one or two sampled items and one automation stratum (181 items) is carried by 3 labels, two of which are the dashboard apps. Only 24 of the 181 items in that stratum are Node-RED at all, and only 14 unrefused Node-RED items in the whole corpus have 20 or more widgets, so the draw landed in a rare cell and the sample-only figure extrapolates it to about 120 items; that is why I report the widget-count variant (95.2%, 82.1–98.3%) next to the sample-only figure. The corpus's own IR verdict for both dashboard items is `via-extension`, not `unsupported`, so the refusal reading is mine and carries medium confidence (`refusalConfidence` in the label rows).

## 6. L6-a: checklist lines and §9 codes against recorded failures

Read in full: DEV-NOTES (D1–D23), FRONTIER-GAPS §0–§2, construction REPORT-dev §3 and §6.1, the verdict sections of the four diagnoses, review-05 §1.2 and §3.6, W-BED §3.8, BLOCKER-SYNTHESIS §3 and §5. Searched by keyword and read at the matching rows: the other review-20261007 files (failure, silent, false-pass rows), docs/RESEARCH.md (result and failure rows), and the findings tables of the `beds/*/AUDIT.md` files (skimmed for solver failures). The remainder of the 22,000 lines in those sources was not read line by line, so the inventory is complete for the structured failure records and may miss a failure mentioned only in passing. The AUDIT files record defects of the beds and their oracles (about 147 finding rows), not failures of workflows, so they are excluded with the other instrument findings (listed in `out/L6-audit.json`, `instrumentFindingsExcluded`). Rating rule: **yes** means a line or code in L1-PATTERNS §4, §5 or §9 names the cause; **partly** means it addresses the same mechanism or a sub-case; **none**. "Named" in the LIBRARY-TESTS decision is read as yes.

| id | scope | cause (abridged) | rating | line or code |
|---|---|---|---|---|
| F01 | output | Identity merge is a hard threshold with no borderline band: one-typo variants of the same person stay split (under-merge), so the split entity takes the wrong country, phone or amount. | yes | P16 checklist line 1 (a borderline band goes to a judge) |
| F02 | output | A per-task convention stated only by worked example (BRIGHTDESK day-first, ATLAS or VENDEX order) is read as the opposite by a cheap model in one global configuration read, so every numeric  | partly | P03 checklist line 1 (quote check on every reading judge); 9 JUDGE_NO_CHECK |
| F03 | output | Sign or perspective convention misread (a balance sign, amount_usd signs overridden in three compiles): C0 s207 misread a balance sign. | none | - |
| F04 | construction | The single global configuration read ran on the cheapest class at low reasoning with no checks, so its configured escalation path (maxClass L, onCheckFail escalate) could never fire. | yes | P03 checklist line 1 (quote check on every reading judge); 9 JUDGE_NO_CHECK |
| F05 | construction | Acceptance is the existence of the answer and the verify node is structural with gate false, so the run verdict is pass on 5 of 5 oracle failures (32 of 32 F trials); 7 of 7 F artifacts and  | yes | 9 VERIFY_NOT_GATING; P01 checklist line 2 |
| F06 | construction | A builder-written check stricter than the task contract (any change to a default value reads as a signature change) vetoes a correct patch; the repair node is told to obey it and selection t | none | - |
| F07 | construction | The fallback emits the unpatched original whenever every candidate is flagged (best starts at the original with score -1, one flag costs -50), although it had measured the original as failin | partly | P20 checklist line 4 (defaults on exhaustion are explicit); 9 SILENT_DROP (fallen-back items flagged) |
| F08 | construction | failure: collect with a merge that drops failed batches, and a verify node that does not gate on missing rows, so a run answers with silently dropped rows (the validator only warns). | yes | 9 SILENT_DROP; 9 MAP_NO_ECHO_CHECK; P13 line 1 |
| F09 | construction | The probe set did not contain the failing case: all three probes had BRIGHTDESK month-first and none had a wrong-default bug, so construction success (24 of 24 probes) said nothing about 9 d | none | - |
| F10 | construction | A heal or recompile widened a guard and removed the ability to refuse: Opus-arm v2 answered 24 of 24 in the N-version probe and was wrong on 6 of 8 d4 tasks (the stream caught one); in 4 tas | none | - |
| F11 | output | Static compiled code fails silently on drift: the C0 records solver went 14 of 16 at d3, then 2 of 8 at d4 with no signal (R8 f1: renamed column, new system, convention switch). | none | - |
| F12 | construction | Unresolved adjudication (no majority) delivers the compiled answer: 3 known wrong deliveries (H/H s208, s214, kinetics H/H s209). | partly | P09 title and checklist line 2 (undecidable option exists, escalate never guess) |
| F13 | output | Tiering down a high-leverage global judge breaks the solver although leaf agreement is 0.966: Haiku 5 of 8 and Sonnet 3 of 8 against 7 of 8 end to end (date order leaves, void markers). | none | - |
| F14 | construction | Compile acceptance is too permissive: kinetics H/H v1 accepted at exact 0 of 3, partial 0.546; S/H v2 adopted with accepted false; reject-if-worse is vacuous at a 0 of 3 baseline. | none | - |
| F15 | construction | Over-strict judge checks turn correctness bugs into cost bugs: vendex-entries failed its own check on every tier (2 deopts at about $0.51 each); kinetics S/H had 4 guard deopts in 6 compiled | none | - |
| F16 | construction | Recompile v3, built from one regression case, silently missed 2 of 7 d4 deliveries (s218, s223) with scores equal to the Haiku agent's to six decimals: the compiler's own model shows through | none | - |
| F17 | output | Common-mode failure of same-family variants: s214 was unanimous and wrong across two independent lineages; the N-version probe shows unanimity is not evidence. | partly | P20 checklist line 7 (a judge verifying its own family is not independent); P49 card (panel independence must be measured) |
| F18 | output | A scope ambiguity in the SOP ("Block read 23.7 C during this read" excludes one well or all nine) moves the excluded_samples set that the grader compares exactly; 13 of 13 wrong Haiku answer | partly | P09 checklist line 2 (undecidable option); P07 checklist line 1 (none-of-these option) |
| F19 | output | A single-sample slip in a judge that reads a run status: the injected error class was returned as a wrong succeeded run on all 88 recorded reads by the parent; the healed version with k = 3  | partly | 9 JUDGE_NO_CHECK |
| R8-f2 | designed | R8 f2 tool failure: gateway 5xx or timeouts on k% of judge calls, a decoder that fails on first call. | yes | P26 (retry with backoff, classify the error before retrying); P27 (error route) |
| R8-f3 | designed | R8 f3 adversarial content: planted instructions in documents ("ignore entity X", "mark all reviewed"). | yes | P07 checklist line 3 (an injection document routes to ignore); 9 BRANCH_ON_TEXT |

Baseline-agent failures (direct Haiku agent, no workflow; counted only in the last row below): B0a partly, B0b none, B0c yes.

| denominator | causes | yes | partly | none | named (yes) | named (yes + partly) | half credit |
|---|---|---|---|---|---|---|---|
| recorded + designed (headline) | 21 | 6 | 6 | 9 | **28.6%** (13.8–50.0%) | 57.1% (36.5–75.5%) | 42.9% |
| recorded only | 19 | 4 | 6 | 9 | **21.1%** (8.5–43.3%) | 52.6% (31.7–72.7%) | 36.8% |
| output failures | 8 | 1 | 4 | 3 | **12.5%** (2.2–47.1%) | 62.5% (30.6–86.3%) | 37.5% |
| construction-loop failures | 11 | 3 | 2 | 6 | **27.3%** (9.7–56.6%) | 45.5% (21.3–72.0%) | 36.4% |
| with baseline agent | 24 | 7 | 7 | 10 | **29.2%** (14.9–49.2%) | 58.3% (38.8–75.5%) | 43.8% |

**Decision (LIBRARY-TESTS L6-a, below 50% means corpus trivia).** On the strict reading 28.6% < 50% in all five denominators: the checklists are not yet failure knowledge, and lines are to be added from the repo's own failures. The result is sensitive to how "named" is read: counting "partly" as named gives 57.1% on the headline denominator, above 50% in four of five denominators. The test text says a line or code that "names" the failure, so I take the strict reading as the decision and report the lenient one as the sensitivity. The rating is by one auditor who knew each answer, which can only flatter the checklists; the full table with reasons is in `out/L6-audit.json` so a reader can recode it.

What is caught: the C0 construction lessons that were folded back into §9 (VERIFY_NOT_GATING, SILENT_DROP, the id echo), the P16 borderline band (mined from this very failure), the injected-content class, and the tool-failure class. What is missed is a pattern: **every failure about the construction and compile loop itself (acceptance of a compile, heal and recompile gates, check calibration, probe coverage, tier choice, compiler common mode) and about input drift has no line**, because L1 checklists are per pattern and these causes live in the layer above (the composition checker and the JIT loop). LIBRARY-TESTS cites D9 (guard widening) as a source of this test, yet L1-PATTERNS has no code for it.

### Proposed checklist lines (from the repo's own failures; not applied)

| for | proposed line or code | minedFrom |
|---|---|---|
| F03 (none) | P03: per-source date order, sign and perspective conventions are read once as a global configuration (evidence quote per decision, an explicit rule that a worked example decides, k >= 3 agreement or the strong tier) and a consequence check flips each convention in a copy and confirms the output changes as the notes require. | `repo:research/jit-20261008/DEV-NOTES.md#D20` |
| F06 (none) | P20: a builder-written check names the task-contract clause it enforces and is never stricter; a heuristic check may demote a candidate but never veto one that passes more evidence; a repair can contest a check; every repair and fallback branch is exercised once by a known-legitimate change. | `repo:research/construction-20261006/diagnosis/F-haiku-codefix.md` |
| F07 (partly) | P20: the exhaustion default is never the unpatched input when a candidate is better on every measured axis except a disputed check. | `repo:research/construction-20261006/diagnosis/B1-opus-codefix.md` |
| F09 (none) | 9 PROBE_COVERAGE: every per-task convention value and every defect class named in the task documents appears in at least one probe; a self-test flips each convention in a probe copy and confirms the solver follows the notes. | `repo:research/construction-20261006/REPORT-dev.md#3 obs 1` |
| F10 (none) | 9 DOMAIN_WIDENED: a recompile replays every input on which its parent deopted and every guard-triggering trace; each must still deopt or match the strong tier; a guard diff reports deleted or widened conditions. | `repo:research/jit-20261008/DEV-NOTES.md#D8,D9` |
| F11 (none) | 9 NO_INPUT_GUARD: a solver states the input profile it was built on (schema, formats, conventions, size) and deopts outside it instead of answering. | `repo:research/jit-20261008/DEV-NOTES.md#D5` |
| F12 (partly) | P09: an unresolved disagreement between two answers escalates to the strongest tier or a person, never defaults to either. | `repo:research/jit-20261008/FRONTIER-GAPS.md#N3,S3` |
| F13 (none) | 9 GLOBAL_READ_TIER: a judge whose output conditions many rows stays on the strongest tier or uses k >= 3 agreement plus a consequence check; leverage is the number of downstream output leaves that depend on it. | `repo:research/jit-20261008/DEV-NOTES.md#D6,D11` |
| F14 (none) | Composition checker: a compiled version is accepted only with a minimum agreement level against its traces and every named disagreement quoting the deciding sentence. | `repo:research/jit-20261008/DEV-NOTES.md#D4` |
| F15 (none) | 9 CHECK_FALSE_ALARM: each check has a recorded false-alarm count on known-good probes; a check that fails on every tier for an input class becomes a hoisted guard or is loosened. | `repo:research/jit-20261008/DEV-NOTES.md#D3` |
| F16 (none) | Composition checker: compare compiled outputs field by field with a second compiler model or a same-seed cheap agent before promotion. | `repo:research/jit-20261008/FRONTIER-GAPS.md#S8,N9` |
| F17 (partly) | P49: unanimity of variants from one model family or one compile lineage is not a pass. | `repo:research/jit-20261008/DEV-NOTES.md#D8 and erratum` |
| F18 (partly) | P03: a spec clause that admits two readings changing an output set is flagged with the clause quoted, never silently chosen. | `repo:research/jit-20261008/DEV-NOTES.md#D13 dossier 5 N6` |
| F19 (partly) | 9 JUDGE_NO_CHECK: for a judge that gates a status or an effect, require k >= 3 agreement when no code check can decide it. | `repo:research/jit-20261008/FRONTIER-GAPS.md#S9 Heal B.6` |
| B0a (partly) | P16: near-twins sharing a secondary attribute go to a same-entity judge with a quote check on the attribute. | `repo:research/construction-20261006/diagnosis/B0-haiku-records.md` |

## 7. Pass and fail decisions

- **L1-a: FAIL.** Node-rule and token rule precision 0.73 (Wilson lower bound 0.66) and all-pairs 0.65; required 0.85 and 0.75. The falsifier (precision below 0.75) is met. Consequences: (a) the 97.8% coverage figure and the 82.2% / 15.6% budget split must not leave this directory; (b) detectors below 0.5 are to be removed: P02 0.23, P30 0.00, P49 0.31, P16 0.31, P17 0.08, P18 0.18. The census re-run for (b) was not performed because that would overwrite existing files; by the explained-needs check it changes no census status or expansion-budget bucket (0 items affected), only the support counts in §2.4 and §8 of L1-PATTERNS. The node-rule precision miss is dominated by "partly" (46 of 168), not "no" (22); strict yes-only precision is 0.60.
- **L6-a: FAIL on the strict reading** (28.6% named, threshold 50%); lenient reading 57.1%. Add the proposed lines.
- **Owner spot check not done.** LIBRARY-TESTS asks for the owner to spot-check 10 items blind; I did not have that. The ten I would check are draw orders 17, 49, 54, 7, 22, 39, 58, 2, 8, 20 (the two dashboard refusals, the one "partly" item, and the seven items with the most disagreement rows in Appendix A); `view.mjs <drawOrder>` shows them without the census.

## 8. What to change in L1-PATTERNS (not applied here)

1. **§0 and §2.1.** Replace "explained by L0 + L1 | 1,524 | 97.8%" by the audit estimate (88.4%, 75.0–95.1% as sampled; 95.2%, 82.1–98.3% with the dashboard refusal by widget count) and state that 97.8% is the count of non-refused items. Keep the refusals row, but define "interactive dashboard state" by a criterion (for example 20 or more `ui_*` widgets) and apply it: 14 more Node-RED items qualify, which moves the non-refused share to 96.9% on its own. The corpus IR verdict set it for two items only.
2. **§1.3 and §4 (P16, P17), §5 (P02, P18, P30, P49).** Remove the six keyword or plumbing detectors, or restate them as "unmeasured, hit precision 0.08 to 0.31". P30 has zero genuine hits and should leave the census table. P01 (0.68) stays but should say that half its hits are control-order chains with no data hand-off, so "typed hand-offs" is not detected.
3. **§5 P37 and P38.** Split the CI-event shape: GitHub and GitLab push and pull-request starts are P38 or P41, not "webhook, respond". P37 should require a respond node or an HTTP trigger with a reply; today about 113 of 282 hits are CI events. The `/form/` regex also counts a dashboard `ui_form` as a webhook (P55 is the owner).
4. **§2.7 rule table.** Add rules for step-level structure that the node rules cannot see (about 25 of the 65 blind-only patterns): `when` and `rules` tags to P08, `matrix`, `scatter` and `parallel` tags to P12, `retry` to P26, `always`/`all_done` to P29, flattened subworkflows (feature counts of sub-workflows with no node) to P54. Re-classify tool nodes that carry category `model` (fgbio, DeepVariant, CellBender, ComfyUI loaders) so they stop adding P05, P18 and P17. Tighten P15 (stage barriers are not fan-in aggregation) and P20 (many hits are a generator and a critic in sequence), and the P33 `resume` regex.
5. **§6 and P22.** P22's 10 hits are all Home Assistant `repeat.while` loops, 8 from one blueprint collection; say so, or fold it into P20/P21 as the card half-suggests. P08 should say that the detector currently finds data filters and misses step-level `when` guards.
6. **§9.** Add the codes in §6 of this report: PROBE_COVERAGE, DOMAIN_WIDENED, NO_INPUT_GUARD, GLOBAL_READ_TIER, CHECK_FALSE_ALARM and the P20, P03, P09, P49 lines. Say in §8 that P16's line 1 is the only checklist line mined from a records failure, and that retrieval of a support-only card is not guaranteed.
7. **§1.6 and §10.** Mark L1-a as run, with the result above, and the owner's blind spot check as outstanding.

## 9. Limits

- Single auditor and a single pass; the rating of both L1-a and L6-a is one agent's judgement. Adjudication saw the detector's anchors (optimistic); labels saw the stratum bucket.
- The estimate rests on 60 labels, and one 3-label stratum carries 181 items. The Kish interval does not capture that the stratum-level variance is unestimable at n = 3; the bootstrap is no better there.
- Pair precision counts (item, pattern) pairs, not nodes; a pair is yes when the skeleton fits the owning nodes, so "partly" often means one of several nodes fits.
- The hit samples are 6 to 20 per detector; the Wilson intervals are wide for the rare patterns (P22 1.00 has a lower bound of 0.72).
- L6-a lists causes, not instances; a failure repeated 7 times counts once. The instance-weighted share would be dominated by the C0 construction defects (13 of 96 trials). Failures in lost run data are unattributed and unmapped.
- Not done: the census re-run after removal, L1-b executable coverage, retrieval of cards by Jev (the "is the line retrievable" half of L6).

## Appendix A: every disagreement (one line each)

Types: **detector-only** (detector assigned, blind label did not; adjudicated y, p or n), **both-partly** (both assigned, adjudicated partly), **blind-only m** (my pattern, detector gave another owner), **blind-only M** (my pattern, detector has no rule), **item-explained** (census explained, my call not). Draw order and pattern first.

| # | item | pattern | type | adj | reason |
|---|---|---|---|---|---|
| 1 | n8n:4428 | P38 | detector-only | n | evaluationTrigger feeds dataset rows to a test harness; not an event rule |
| 1 | n8n:4428 | P06 | detector-only | p | downloaded document is read then summarised; read-then-generate shape but no retrieval or citation |
| 1 | n8n:4428 | P01 | detector-only | y | webhook-set-download-extract chain of three plumbing stages exists; blind label omitted it |
| 2 | claude-code-workflows:workflow-corpus-acquisit.. | P13 | detector-only | p | parallel map whose body is a research agent, not a batched typed extraction |
| 2 | claude-code-workflows:workflow-corpus-acquisit.. | P14 | detector-only | y | barrier gathers the four branch results |
| 2 | claude-code-workflows:workflow-corpus-acquisit.. | P47 | detector-only | p | agents write converter and checker scripts, incidental to the task |
| 2 | claude-code-workflows:workflow-corpus-acquisit.. | P16 | detector-only | p | merge agent de-duplicates part files by script; keyword hit, skeleton only loosely fits |
| 4 | claude-code-workflows:kev-judge-program-design.. | P47 | detector-only | n | agents write documents and critiques; no code-execution step is the point |
| 4 | claude-code-workflows:kev-judge-program-design.. | P18 | detector-only | n | two different critics, not best-of-N candidates of one task |
| 5 | apple-shortcuts:workflowllm-seed-00459 | P08 | detector-only | p | one If gates an effect; the other ifs are branches |
| 5 | apple-shortcuts:workflowllm-seed-00459 | P01 | detector-only | n | three unrelated variable-setup transforms, not a pipeline |
| 5 | apple-shortcuts:workflowllm-seed-00459 | P02 | detector-only | n | web page fetch then image detect then run shortcut; not a sync/ETL |
| 7 | nextflow:1030 | P04 | detector-only | n | fgbio consensus caller is a bioinformatics tool tagged category model by the normaliser, not generated text |
| 7 | nextflow:1030 | P07 | detector-only | n | deepvariant is a variant caller tagged model; there is no judged classification |
| 7 | nextflow:1030 | P29 | detector-only | y | token completion-hook; Sarek has onComplete notifications (features list service:email, im-webhook), not visible as a node |
| 7 | nextflow:1030 | P26 | detector-only | y | token adaptive-retry; nf-core errorStrategy with resource escalation, not visible as a node |
| 7 | nextflow:1030 | P02 | detector-only | n | every pipeline reads and writes files; not a sync between systems |
| 8 | gitlab-ci:cuda | P37 | detector-only | p | push pipeline source is an event, so P38 fits better than webhook-respond |
| 8 | gitlab-ci:cuda | P15 | detector-only | n | stage barrier is ordering, not an aggregate of results |
| 8 | gitlab-ci:cuda | P29 | detector-only | p | cleanup_failure jobs run only on failure (P27 fits better than always-run finally) |
| 10 | comfyui:Jonseed-ComfyUI-Detail-D.. | P18 | detector-only | n | three KSampler variants feed different decoders and saves; nothing selects among candidates |
| 11 | claude-code-workflows:laptop-bridge-wf_c491d61.. | P47 | detector-only | y | builder writes and tests code; attacker writes and runs attack scripts |
| 11 | claude-code-workflows:laptop-bridge-wf_c491d61.. | P18 | detector-only | n | barrier over attack and e2e testers is not best-of-N |
| 11 | claude-code-workflows:laptop-bridge-wf_c491d61.. | P49 | detector-only | n | fixer reads two different reports; no independent verifiers voting |
| 12 | claude-code-workflows:phase0-unblock-wf_109538.. | P19 | detector-only | p | shared-scratchpad token: disjoint workstreams over one working tree; the rewrite to wide is applicable but nothing is planned by a model |
| 12 | claude-code-workflows:phase0-unblock-wf_109538.. | P47 | detector-only | p | probe and installer scripts are written and run, incidental |
| 12 | claude-code-workflows:phase0-unblock-wf_109538.. | P18 | detector-only | n | barrier over three different workstreams is not best-of-N |
| 15 | flowise:chatflows-local-qn-a | P05 | detector-only | n | chat model node is a component of the QA chain, not a second chained model step |
| 15 | flowise:chatflows-local-qn-a | P01 | detector-only | y | text file, splitter, vector-store ingest chain |
| 17 | node-red:1a43db3395478c8c30f18144.. | P37 | detector-only | n | ui_form is a dashboard form widget; regex /form/ matched it as a webhook |
| 17 | node-red:1a43db3395478c8c30f18144.. | P44 | detector-only | p | stream token is the converter's blanket Node-RED note (long-lived message program); no explicit stream node |
| 17 | node-red:1a43db3395478c8c30f18144.. | P42 | detector-only | y | converter notes: flow/global context persistent state |
| 17 | node-red:1a43db3395478c8c30f18144.. | P01 | detector-only | n | function, function, debug chain; debug output is not a pipeline stage |
| 20 | nf-core:proteogenomicsdb@1.0.0 | P26 | detector-only | y | token adaptive-retry (nf-core errorStrategy); not visible as a node |
| 20 | nf-core:proteogenomicsdb@1.0.0 | P01 | detector-only | y | vcf download, check, proteinDB chain |
| 20 | nf-core:proteogenomicsdb@1.0.0 | P17 | detector-only | n | merge_proteindbs gathers 11 inputs; this is fan-in, not reconciliation of two sources |
| 22 | activepieces:S0tI31TsQZvtNg5BDH1Tq | P38 | detector-only | p | MCP tool call with reply is a request/response trigger (P37 fits better) |
| 22 | activepieces:S0tI31TsQZvtNg5BDH1Tq | P04 | detector-only | p | askAi output is stored in a table, not delivered to a person |
| 22 | activepieces:S0tI31TsQZvtNg5BDH1Tq | P06 | detector-only | y | AI summaries over records fetched from calendar, mail and tables |
| 22 | activepieces:S0tI31TsQZvtNg5BDH1Tq | P27 | detector-only | p | error-branch token; no handler node is visible |
| 22 | activepieces:S0tI31TsQZvtNg5BDH1Tq | P42 | detector-only | p | Activepieces Tables are a persistent store, but records are created and deleted within the run |
| 22 | activepieces:S0tI31TsQZvtNg5BDH1Tq | P18 | detector-only | n | reply node after two askAi steps is not best-of-N |
| 23 | crewai:flow_definition_example... | P38 | detector-only | n | flow kickoff from a YAML definition is a manual start, not an event rule |
| 23 | crewai:flow_definition_example... | P06 | detector-only | n | reviewer and writer read the crew output, not retrieved documents |
| 24 | github-actions:ci-pytorch_test-slow.yml | P37 | detector-only | p | push and pull_request are events; P38 fits better than webhook-respond |
| 24 | github-actions:ci-pytorch_test-slow.yml | P01 | detector-only | y | changed files, skip decision, setup, build chain |
| 24 | github-actions:ci-pytorch_test-slow.yml | P02 | detector-only | n | setup, cache and install steps are not a data sync |
| 25 | openai-agents:compaction_session_examp.. | P13 | detector-only | n | scripted for-loop over questions with a chat agent body; not a batched typed extraction |
| 25 | openai-agents:compaction_session_examp.. | P20 | detector-only | n | the cycle is a compaction trigger on the session, not generate-verify-retry |
| 25 | openai-agents:compaction_session_examp.. | P42 | detector-only | p | session store holds turns across the loop; in-memory, so cross-run only if the session is reused |
| 25 | openai-agents:compaction_session_examp.. | P18 | detector-only | n | session node is not a best-of-N |
| 26 | n8n:18122 | P38 | detector-only | p | errorTrigger is an event, but P27 already owns it |
| 26 | n8n:18122 | P01 | detector-only | y | set, code, post chain |
| 27 | nf-core:scrnaseq@4.2.0 | P03 | detector-only | n | cellbender removebackground is a tool tagged model, not a model reading text |
| 27 | nf-core:scrnaseq@4.2.0 | P26 | detector-only | y | token adaptive-retry (nf-core errorStrategy) |
| 28 | nextflow:813 | P26 | detector-only | y | token adaptive-retry |
| 29 | home-assistant:forum-871550 | P21 | detector-only | n | repeat-count blink loops with delays are not poll-until-ready |
| 29 | home-assistant:forum-871550 | P40 | detector-only | y | run-concurrency-policy token (mode field) |
| 31 | haystack:computer_use_agent_with_.. | P20 | detector-only | n | router conditions inside a tool loop are not generate-verify-retry |
| 31 | haystack:computer_use_agent_with_.. | P47 | detector-only | y | model-written shell commands are run |
| 31 | haystack:computer_use_agent_with_.. | P17 | detector-only | n | agent with two read tools is not reconciliation |
| 32 | gitlab-ci:gitlab-development-kit | P37 | detector-only | p | push pipeline source is an event (P38) |
| 32 | gitlab-ci:gitlab-development-kit | P15 | detector-only | n | stage barriers order stages, no aggregate |
| 33 | gitlab-ci:database-lab | P37 | detector-only | p | push pipeline source is an event (P38) |
| 33 | gitlab-ci:database-lab | P15 | detector-only | n | stage barriers order stages, no aggregate |
| 34 | claude-code-workflows:bed-audits-wf_037c2944-b.. | P15 | detector-only | p | barrier collects five reports into one array; fan-in report with no identity check |
| 34 | claude-code-workflows:bed-audits-wf_037c2944-b.. | P47 | detector-only | p | auditors edit generators and run tests, incidental |
| 34 | claude-code-workflows:bed-audits-wf_037c2944-b.. | P18 | detector-only | n | barrier over lanes is not best-of-N |
| 35 | claude-code-workflows:design-review-c-wf_1ab0b.. | P47 | detector-only | y | agents write benchmark scripts and a prototype and test them headless |
| 35 | claude-code-workflows:design-review-c-wf_1ab0b.. | P18 | detector-only | n | barrier over unrelated lanes is not best-of-N |
| 37 | comfyui:Comfy-Org-workflow_templ.. | P18 | detector-only | n | single sampler; the plumbing rule fired on text encoders feeding one node |
| 38 | galaxy:hi-c-map-for-assembly-ma.. | P08 | detector-only | p | Filter tools select CDS and telomere rows; data filtering steps rather than a guard before an effect |
| 39 | github-actions:build.yml | P37 | detector-only | p | push and pull_request are events (P38) |
| 39 | github-actions:build.yml | P27 | detector-only | p | the handler nodes are always() stats and job-if steps; cleanup-on-failure rather than a failure route |
| 39 | github-actions:build.yml | P01 | detector-only | y | cache, setup, configure, build chain |
| 39 | github-actions:build.yml | P02 | detector-only | n | restore, fetch and save an SDK cache is caching, not a sync |
| 40 | galaxy:607 | P08 | detector-only | p | collection and row filter tools; data filtering steps |
| 40 | galaxy:607 | P14 | detector-only | y | merge collections gather parallel branches |
| 41 | openai-agents:llm_as_a_judge.py | P18 | detector-only | n | generator and evaluator are not N candidates |
| 43 | pydantic-graph:graph.md#vending_machine | P10 | detector-only | p | prompts for coin and product feed a state machine rather than a menu of actions |
| 45 | claude-code-workflows:kev-build-contracts-wf_d.. | P47 | detector-only | y | builder writes and tests code, reviewer seeds defects in tests |
| 46 | claude-code-workflows:kev-analysis-wf_df1c3e5c.. | P47 | detector-only | y | probe and fine-tune feasibility scripts are written and run |
| 46 | claude-code-workflows:kev-analysis-wf_df1c3e5c.. | P18 | detector-only | n | barrier over unrelated surveys is not best-of-N |
| 46 | claude-code-workflows:kev-analysis-wf_df1c3e5c.. | P49 | detector-only | p | refuter and completeness critic both review the analysis; panel without a vote |
| 47 | apple-shortcuts:icloud-6ba47bd9ab2640788.. | P12 | detector-only | p | one repeat-count loop |
| 47 | apple-shortcuts:icloud-6ba47bd9ab2640788.. | P53 | detector-only | n | final Run another shortcut node is not per item |
| 47 | apple-shortcuts:icloud-6ba47bd9ab2640788.. | P01 | detector-only | y | gettext, url, HTTP GET chain |
| 47 | apple-shortcuts:icloud-6ba47bd9ab2640788.. | P02 | detector-only | n | getmyworkflows then url then run shortcut is not a sync |
| 47 | apple-shortcuts:icloud-6ba47bd9ab2640788.. | P17 | detector-only | n | battery, weather properties are not two record sets to reconcile |
| 48 | comfyui:TTPlanetPig-Comfyui_TTP_.. | P01 | detector-only | p | image size and scale utility chain inside a DAG |
| 48 | comfyui:TTPlanetPig-Comfyui_TTP_.. | P02 | detector-only | n | load image, resize, combine video is not a sync between systems |
| 48 | comfyui:TTPlanetPig-Comfyui_TTP_.. | P18 | detector-only | n | two decoders feed one combine node; no candidates compared |
| 49 | node-red:2078efb84e380d70c958ef67.. | P21 | detector-only | y | switch with delay cycle is a poll-until loop (converter notes) |
| 49 | node-red:2078efb84e380d70c958ef67.. | P25 | detector-only | y | five back-edges outside loop constructs |
| 49 | node-red:2078efb84e380d70c958ef67.. | P34 | detector-only | y | delay node |
| 49 | node-red:2078efb84e380d70c958ef67.. | P42 | detector-only | y | converter notes: flow/global context persistent state |
| 49 | node-red:2078efb84e380d70c958ef67.. | P01 | detector-only | n | function chain inside UI handlers |
| 50 | tekton:pipelinerun-with-matrix | P27 | detector-only | p | error edges lead to the finally task, so P29 describes it and P27 only loosely |
| 51 | apple-shortcuts:workflowllm-seed-07479 | P32 | detector-only | n | anchors are file pickers and an ask; no approval gate before an effect is visible |
| 51 | apple-shortcuts:workflowllm-seed-07479 | P08 | detector-only | p | a single If guards an effect |
| 51 | apple-shortcuts:workflowllm-seed-07479 | P01 | detector-only | n | three consecutive device-detail queries are not a pipeline |
| 51 | apple-shortcuts:workflowllm-seed-07479 | P02 | detector-only | n | device details, hash, create folder is not a sync |
| 51 | apple-shortcuts:workflowllm-seed-07479 | P17 | detector-only | n | device-detail reads are not two record sets |
| 52 | claude-code-workflows:beds-tier-a-wf_7c3e2774-.. | P13 | detector-only | p | pipeline() map over 8 families with agent bodies, not a typed extraction |
| 52 | claude-code-workflows:beds-tier-a-wf_7c3e2774-.. | P14 | detector-only | p | result array of independent audits; P14 fits loosely |
| 52 | claude-code-workflows:beds-tier-a-wf_7c3e2774-.. | P47 | detector-only | y | builders write generators, oracles and tests |
| 54 | metagpt:start_game.py#moderator-.. | P20 | detector-only | n | speak/act cycles inside a game loop are not generate-verify-retry |
| 54 | metagpt:start_game.py#moderator-.. | P55 | detector-only | p | optional human seat reads a typed line |
| 54 | metagpt:start_game.py#moderator-.. | P18 | detector-only | n | moderator parse after player actions is not best-of-N |
| 56 | comfyui:xxyQwQ-ComfyBench-datase.. | P18 | detector-only | n | single sampler; text encoders feeding one node |
| 57 | claude-code-workflows:c0-preflight-wf_d35b46dd.. | P47 | detector-only | y | agents write drivers and execute live sessions and artefacts |
| 57 | claude-code-workflows:c0-preflight-wf_d35b46dd.. | P18 | detector-only | n | barrier over smokes and a review is not best-of-N |
| 58 | anthropic:tool_permission_callback.. | P20 | detector-only | n | callback inside a tool loop is not generate-verify-retry |
| 58 | anthropic:tool_permission_callback.. | P09 | detector-only | p | rule callback then human prompt for undecided calls has the escalate shape, but the decider is code, not a judge |
| 58 | anthropic:tool_permission_callback.. | P28 | detector-only | p | denial text is returned to the model and the run continues; a fallback path of sorts |
| 58 | anthropic:tool_permission_callback.. | P35 | detector-only | y | interrupt-resume token |
| 58 | anthropic:tool_permission_callback.. | P48 | detector-only | p | permission callback blocks calls inline rather than as a parallel tripwire |
| 59 | flowise:chatflows-sql-db-chain | P05 | detector-only | n | ChatOpenAI feeds SqlDatabaseChain; one model plus a chain wrapper, not a prompt chain |
| 60 | n8n:3840 | P03 | detector-only | p | structured parser then set; an extraction-like step but not reading documents |
| 60 | n8n:3840 | P33 | detector-only | n | wait resume=timeInterval is a delay, the regex matched 'resume' |
| 60 | n8n:3840 | P01 | detector-only | y | http, set, graph api chain |
| 60 | n8n:3840 | P18 | detector-only | n | model nodes are provider sub-nodes of chains |
| 5 | apple-shortcuts:workflowllm-seed-00459 | P55 | both-partly | p | Ask-for-input nodes exist (11) but the anchors shown are barcode and photo capture |
| 7 | nextflow:1030 | P08 | both-partly | p | channel .branch routes streams by field (interval or not); closer to L0 if than to a filter-before-effect |
| 8 | gitlab-ci:cuda | P54 | both-partly | p | flow-size token (901 jobs); trigger-stage jobs may be child pipelines but the summaries do not say so |
| 17 | node-red:1a43db3395478c8c30f18144.. | P38 | both-partly | p | dashboard widget events trigger handlers; closer to a UI event than an automation event rule |
| 27 | nf-core:scrnaseq@4.2.0 | P08 | both-partly | p | channel .branch routes by protocol; closer to L0 if |
| 28 | nextflow:813 | P08 | both-partly | p | channel .branch operators route streams, closer to L0 if |
| 29 | home-assistant:forum-871550 | P33 | both-partly | p | 4 wait_for_trigger nodes are right, but the rule also assigned 9 plain delay nodes to P33 |
| 29 | home-assistant:forum-871550 | P12 | both-partly | p | repeat-count loops and one for_each; bounded loops rather than map-reduce |
| 47 | apple-shortcuts:icloud-6ba47bd9ab2640788.. | P32 | both-partly | p | an alert then a branch precedes some effects; a confirm gate is plausible but only one anchor |
| 49 | node-red:2078efb84e380d70c958ef67.. | P38 | both-partly | p | ui_text_input and ui_button widget events; dashboard rather than automation rule |
| 51 | apple-shortcuts:workflowllm-seed-07479 | P55 | both-partly | p | 5 Ask-for-input nodes are right; the other 9 anchors are documentpicker file reads |
| 2 | claude-code-workflows:workflow-corpus-acquisit.. | P12 | blind-only m | m | literal table mapped to workers; P13 and P12 are both defensible for this loop |
| 2 | claude-code-workflows:workflow-corpus-acquisit.. | P15 | blind-only m | m | merge agent combines the four reports; detector chose P14 for the barrier |
| 3 | airflow:example_eks_with_nodegro.. | P29 | blind-only M | M | trigger_rule=all_done teardown chain; node categories are wait/action so the error-handler rule cannot see it |
| 3 | airflow:example_eks_with_nodegro.. | P01 | blind-only M | M | setup, wait, pod, teardown chain; chain nodes are wait/code categories so the plumbing detector misses it |
| 4 | claude-code-workflows:kev-judge-program-design.. | P01 | blind-only m | m | design, critics, revise is a staged chain; P14 already captures the middle |
| 5 | apple-shortcuts:workflowllm-seed-00459 | P32 | blind-only m | m | alert plus two-option menu precede payment actions; plausible but not visible in the summary |
| 6 | coze:query-types-llm-intent-h.. | P01 | blind-only m | m | entry, code, intent, http chain; the model node breaks the plumbing-only chain rule |
| 7 | nextflow:1030 | P54 | blind-only M | M | features report 90 subworkflows but the graph is flattened, so the subworkflow rule has no node |
| 7 | nextflow:1030 | P12 | blind-only m | m | per-sample and per-interval scatter is implicit in channels |
| 7 | nextflow:1030 | P14 | blind-only m | m | scatter to callers then gather is implicit in channels |
| 8 | gitlab-ci:cuda | P38 | blind-only m | m | push source with rules; detector chose P37 |
| 8 | gitlab-ci:cuda | P08 | blind-only m | m | rules on every job are guards before effects; detector has no rule for CI job rules |
| 11 | claude-code-workflows:laptop-bridge-wf_c491d61.. | P01 | blind-only m | m | build, parallel checks, fix, verify chain; P14 covers the middle |
| 14 | airflow:example_agent#example_ag.. | P45 | blind-only m | m | single agent operator; P45 only if the agent has tools, which the summary does not show |
| 15 | flowise:chatflows-local-qn-a | P43 | blind-only m | m | conversational retrieval chain implies chat memory, not visible in the summaries |
| 16 | galaxy:Genome_annotation_with_m.. | P01 | blind-only M | M | maker feeds gffread then busco; the chain rule requires out-degree 1, so a branching spine is missed |
| 17 | node-red:1a43db3395478c8c30f18144.. | P55 | blind-only m | m | ui_form inputs are ask-validate-use, detector read them as webhooks |
| 18 | cwl:amplicon-wf--v.5-cond.cwl | P12 | blind-only M | M | steps tagged [scatter] have no rule in the detector (action nodes are not control nodes) |
| 18 | cwl:amplicon-wf--v.5-cond.cwl | P08 | blind-only M | M | steps tagged [when] have no rule in the detector |
| 19 | langgraph:reflexion.ipynb | P06 | blind-only M | M | search tool node feeds the revisor; the tool node has effects external so the read-then-model rule did not fire |
| 20 | nf-core:proteogenomicsdb@1.0.0 | P08 | blind-only M | M | processes tagged when: have no rule (action nodes are not control nodes) |
| 20 | nf-core:proteogenomicsdb@1.0.0 | P15 | blind-only M | M | merge_proteindbs has 11 predecessors; the wide-fan-in rule needs a merge-category node |
| 20 | nf-core:proteogenomicsdb@1.0.0 | P02 | blind-only m | m | downloads, conversions, merged database written out; ETL-like but not a sync between systems |
| 22 | activepieces:S0tI31TsQZvtNg5BDH1Tq | P37 | blind-only m | m | MCP tool trigger with reply_to_mcp_client; detector chose P38 |
| 22 | activepieces:S0tI31TsQZvtNg5BDH1Tq | P05 | blind-only m | m | three askAi steps in sequence; detector chose P06 and P04 |
| 24 | github-actions:ci-pytorch_test-slow.yml | P38 | blind-only m | m | push/PR event with job-if guards; detector chose P37 |
| 24 | github-actions:ci-pytorch_test-slow.yml | P08 | blind-only M | M | skip decision and step-level ifs; no detector rule for step ifs |
| 24 | github-actions:ci-pytorch_test-slow.yml | P12 | blind-only M | M | job matrix is in the summary only |
| 26 | n8n:18122 | P28 | blind-only M | M | second branch posts to Discord after the Slack post; the handler-rejoins rule did not fire |
| 27 | nf-core:scrnaseq@4.2.0 | P12 | blind-only m | m | per-sample channels are implicit |
| 27 | nf-core:scrnaseq@4.2.0 | P15 | blind-only M | M | multiqc gathers all samples; no merge-category node, so the fan-in rule missed it |
| 27 | nf-core:scrnaseq@4.2.0 | P54 | blind-only M | M | features report 17 subworkflows but the graph is flat |
| 28 | nextflow:813 | P12 | blind-only m | m | per-sample channels implicit |
| 28 | nextflow:813 | P54 | blind-only M | M | features report 32 subworkflows but the graph is flat |
| 32 | gitlab-ci:gitlab-development-kit | P38 | blind-only m | m | push source with rules; detector chose P37 |
| 32 | gitlab-ci:gitlab-development-kit | P08 | blind-only m | m | rules on every job; no detector rule for job rules |
| 32 | gitlab-ci:gitlab-development-kit | P12 | blind-only M | M | jobs tagged parallel:matrix; the tag is in the summary only |
| 32 | gitlab-ci:gitlab-development-kit | P26 | blind-only M | M | jobs tagged retry; the tag is in the summary only |
| 33 | gitlab-ci:database-lab | P38 | blind-only m | m | push source with rules; detector chose P37 |
| 33 | gitlab-ci:database-lab | P08 | blind-only m | m | rules on 80 test jobs; no detector rule for job rules |
| 34 | claude-code-workflows:bed-audits-wf_037c2944-b.. | P14 | blind-only m | m | two parallel lanes then gather; detector chose P15 |
| 34 | claude-code-workflows:bed-audits-wf_037c2944-b.. | P01 | blind-only m | m | each lane walks beds in sequence |
| 39 | github-actions:build.yml | P38 | blind-only m | m | push/PR event with job-if guards; detector chose P37 |
| 39 | github-actions:build.yml | P12 | blind-only M | M | job matrix is in the summary only |
| 39 | github-actions:build.yml | P08 | blind-only M | M | step ifs on cache hits; no detector rule for step ifs |
| 40 | galaxy:607 | P12 | blind-only m | m | collection mapping per sample is implicit |
| 40 | galaxy:607 | P15 | blind-only m | m | collapse collections builds the combined MAF; detector chose P14 |
| 43 | pydantic-graph:graph.md#vending_machine | P55 | blind-only m | m | console prompts for coin and product are ask-use; the rule saw 'select' and chose menu |
| 45 | claude-code-workflows:kev-build-contracts-wf_d.. | P01 | blind-only m | m | builder, reviewer, fixer chain of three model-category agent nodes; the plumbing chain rule needs plumbing-category nodes |
| 46 | claude-code-workflows:kev-analysis-wf_df1c3e5c.. | P01 | blind-only m | m | survey, synthesise, critique, revise chain |
| 49 | node-red:2078efb84e380d70c958ef67.. | P55 | blind-only m | m | ui_text_input widgets are ask-use; the rule saw them as event triggers |
| 50 | tekton:pipelinerun-with-matrix | P12 | blind-only M | M | matrix fan-out is in the summary only |
| 50 | tekton:pipelinerun-with-matrix | P26 | blind-only M | M | retries=1 is in the summary only |
| 52 | claude-code-workflows:beds-tier-a-wf_7c3e2774-.. | P12 | blind-only m | m | literal list of 8 families mapped; detector chose P13 |
| 52 | claude-code-workflows:beds-tier-a-wf_7c3e2774-.. | P01 | blind-only m | m | build then audit per family |
| 54 | metagpt:start_game.py#moderator-.. | P25 | blind-only m | m | 19-step scripted table with a win check; detector chose P20 for the cycle |
| 54 | metagpt:start_game.py#moderator-.. | P12 | blind-only m | m | per-player actions in a round |
| 54 | metagpt:start_game.py#moderator-.. | P06 | blind-only M | M | RetrieveExperiences vector search feeds Speak and Hunt; the read-then-model rule did not fire |
| 55 | wdl:LRAA-cell_cluster_guided.. | P12 | blind-only M | M | chunk scatter has no rule (WDL tasks are action nodes) |
| 55 | wdl:LRAA-cell_cluster_guided.. | P15 | blind-only m | m | merge tasks gather the shard outputs |
| 58 | anthropic:tool_permission_callback.. | P32 | blind-only M | M | human prompt 'Allow this tool?' is an approval gate; the rule needs words like approve, confirm |
| 58 | anthropic:tool_permission_callback.. | P08 | blind-only m | m | deny rules for system paths and dangerous bash are code filters before an effect |
| 59 | flowise:chatflows-sql-db-chain | P47 | blind-only m | m | SQL chain generates a query and runs it; P06 with a SQL retriever is equally defensible |
| 60 | n8n:3840 | P34 | blind-only M | M | timed wait before publishing; misread as a signal wait |
| 60 | n8n:3840 | P04 | blind-only M | M | AI content then Instagram publish; the draft-deliver rule needs a model node followed by an effect within two hops |
| 17 | node-red:1a43db3395478c8c30f18144.. | - | item-explained | no | Node-RED digital annealer with dashboard. Logic could be extracted as solver (subflows), but the item as a whole is a UI app. Judged under the section 2.5 dashboard refusal. |
| 49 | node-red:2078efb84e380d70c958ef67.. | - | item-explained | no | Node-RED Stellar Horizon SDK dashboard. Same treatment as item 17. |
| 54 | metagpt:start_game.py#moderator-.. | - | item-explained | partly | MetaGPT werewolf: code moderator steps a 19-step table; model players reflect, retrieve experiences, speak or act; win check ends the game. |
