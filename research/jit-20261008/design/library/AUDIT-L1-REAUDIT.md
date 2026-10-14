# AUDIT-L1-REAUDIT: the L1-a re-audit of the revised census (fresh draw, two blind labellers)

*2026-10-14 · $0: no model calls and no Jev calls by anyone in this audit · development / diagnostic evidence, not a sealed
evaluation (the vocabulary was mined from this corpus, so every figure here is in-sample) · `beds/sealed/` never read.
Labellers: **sonnet-60** (Sonnet 5.5, all 60 items) and **opus-10** (Opus 5.5, a fixed-seed 10-item sub-draw), blind to
each other, to the census and to every L1-a label. Author and adjudicator of this file: the library audit agent (Opus 5.5)
acting under the orchestrator, to which the owner delegated the PAUSE-20261009 §5 decisions. New files: this one,
`out/L1-reaudit/adjudication-10.json`, `out/L1-reaudit/agreement.mjs` → `agreement.json`; the PROOF-LEDGER D1 status
cell is updated. Inputs (committed by others): `out/L1-reaudit/draw.json`, `draw-10.json`, `draw.mjs` (924453a),
`labels-opus-10.jsonl` (9c1a830), `labels-sonnet-60.jsonl`, `labels-sonnet-60.summary.json`, `analyze-labels.mjs`
(ec8983c).*

## 0. Result

**Decision (D1, LIBRARY-TESTS L1-a): FAIL. The revised library does not pass L1-a.** On a fresh 60-item draw of the
revision-1 census, rule precision (yes + partly/2) is **0.713 over 202 node-rule and token pairs (Wilson 64.7–77.1%)**.
The bar is 0.85 with a Wilson lower bound of 0.75, and the falsifier (precision below 0.75) is met. The second labeller
gives 0.54 on its 25 pairs. On the 25 pairs both labellers judged, my adjudication also gives 0.54, against 0.70 from the
primary labeller, so 0.713 is the optimistic figure. Revision 1 removed six support-only detectors and split P37. It did
not touch the node rules that lose precision, which AUDIT-L1 §8 item 4 lists and which are still open: tool and
configuration nodes tagged `model` (they feed P05, P06, P03, P04 and L0 judge), P15 on stage barriers, P32 on human
nodes that are not approvals, P33's signal-wait token, P20 on tool-loop exits, and P29's "post" regex. Node-rule
precision is therefore unchanged from L1-a (0.73 then, 0.71 now).

This has three consequences. The census stays a candidate generator. Its per-pattern support, budget split and greedy
curve are not measurements, and neither is the census-`needs` gold that L2 would use. The only coverage figure is the
hand-label one.

**Coverage holds up, and the L1-a headline is superseded.** L0 + L1 explain **93.6% of the 1,549 non-first-party corpus
workflows (Wilson 82.3–97.9%, Kish n 43.8)** when a dashboard app is read as a refusal (the owner's headline, PAUSE §5.8).
Read as explained, the figure is 95.9% (85.5–99.0). The two labellers agree on "explained" on 9 of 10 shared items
(Cohen's kappa 0.74 on the strict cut, 1.00 on the lenient cut).

L1-a's 88.4% came from its strata. It weighted two sampled dashboard apps as if they stood for about 120 items; the
corpus has 16. On the revision-1 strata, L1-a's own labels give 94.3%, and the two audits pooled (120 labels) give 93.9%
(86.5–97.4).

**The owner's blind check.** The owner's 10-item blind check (LIBRARY-TESTS L1-a) was delegated to the orchestrator and
replaced by an independent second model labeller (§2). That shows the coverage calls reproduce across two Claude
labellers. It does not show that a human would agree: same-family models can share errors.

**The figure J1 must compare against: 93.6%** (conservative reading, strict "yes" only, post-stratified; Wilson
82.3–97.9). J1 passes if its pooled out-of-sample strict coverage is **at least 83.6%**. The other estimators in §3 span
92.7–94.9%, so a J1 result between 82.7% and 84.9% is a pass or a fail that depends on the comparator and must be
reported as such (§8).

## 1. Method

**Draw** (`out/L1-reaudit/draw.mjs`, `draw.json`; 924453a). The frame is the revision-1 census rows
(`out/pattern-census-items.jsonl`, sha256 0998e4e7…, HEAD 56d45de) minus the 60 items L1-a drew. The draw uses seed
20261014 and the L1-a procedure: mulberry32, one shared Fisher-Yates stream, strata in allocation order, then one shuffle
for review order. Strata are the six clusters crossed with the census pattern count: A 0–1, B 2–4, C 5+. Refused items
form an R stratum in agentic and are merged into A elsewhere.

First-party has no unlabelled item left, because L1-a drew all 10. Its 10 slots went +2 to each other cluster, so A, B
and C are 4 each and agentic R is 2. **The estimate therefore covers the 1,549 non-first-party items.**

The sub-draw (`draw-10.json`, seed 20261015) takes 2 items per cluster from the 60.

**Labelling.** Each labeller read the revised L0 card and L1 revision 1 and labelled blind, in two phases. The first was
L0 constructs, L1 patterns, explained (yes / partly / no), refusal, and gaps quoted from the source; neither labeller
opened a census row in this phase. In the second phase each labeller re-ran the revised census on its items from a
scratch copy that also prints the rule behind every node. Both report rows identical to the published file. Each then
judged every detector firing yes, partly or no.

- **sonnet-60** read the corpus summaries and the raw sources. Its blind rows carry `blindLabelledAt` from 12:36:24Z to
  12:40:40Z.
- **opus-10** read the corpus items with `ir` hidden and the raw sources under `/opt/corpus`. Its labels are stamped
  12:39:56Z and its adjudication 12:42:23Z.

Both blind phases ended before the first label commit (9c1a830, 12:42:31Z), so neither labeller could have read the
other's file from git.

**Disclosures.**
- The timestamps are append times the labellers wrote themselves.
- The sonnet labeller reports freezing its blind file at sha256 89dfeb64… before opening any census row. That frozen file
  is not in git; the committed file carries the census fields added afterwards. So blindness rests on the labellers'
  reports, as it did in L1-a.
- Both labellers saw the stratum letter.

**My part.**
- I adjudicated every disagreement between the two labellers on the 10 shared items (`adjudication-10.json`). I was not
  blind: I read both files, the census rows, each corpus item and its raw source.
- I computed agreement and the coverage sensitivities with `agreement.mjs`, which also re-derives the pre-specified
  estimator of `analyze-labels.mjs` (identical: 93.6%).

**Estimators** are those of AUDIT-L1 §1:
- Coverage is post-stratified, with Wilson at the Kish effective n and a seeded stratified bootstrap.
- "Strict" counts explained = yes only.
- Precision is (yes + partly/2) over pairs, on items the census does not refuse.

## 2. The owner's 10-item blind check: delegated and replaced

LIBRARY-TESTS L1-a asks for "a single auditor (an agent), with the owner spot-checking 10 items blind". PAUSE §5.9 left
the owner two options: do it, or waive it and say so in the re-audit. The owner delegated the §5 decisions (except heal
approvals) to the orchestrator. **The orchestrator did not waive the check. It replaced the owner with an independent
second model labeller:** Opus 5.5, blind, on a fixed-seed stratified 10-item sub-draw, 2 items from each of the five
clusters the draw covers.

**What the replacement establishes.**
- **The coverage calls reproduce across labellers.** A second labeller, of a different model size, blind to the first
  labeller and to the census, made the same strict call on 9 of 10 items and the same lenient call on 10 of 10. The one
  substantive difference (#22) is decided in §6.
- **Pattern-level labels are noisy.** Mean blind pattern-set Jaccard is 0.58 and only 2 of 10 sets are identical. Recall
  and per-pattern figures therefore depend on who labels.
- **The primary labeller is lenient on detector verdicts.** It scored higher on 8 of the 9 disputed rule pairs. That is
  how the 0.713 precision was read as optimistic, and that reading was available only because a second labeller existed.

**What it does not establish.**
- **That a person would agree.** Both labellers are Claude models from one family, given similar prompts, and the
  vocabulary they judge against was itself written by Claude models. Correlated errors are possible: a shared reading of
  what "explained" means, or shared leniency towards the vocabulary's own constructs. Agreement statistics cannot reveal
  them.
- **A tight bound on agreement.** At n = 10, one changed item moves kappa by about 0.3, and the 10 items are a subset of
  the 60, so they add no coverage evidence of their own.
- **Independent context.** Both labellers read the same L0 card, L1 text and AUDIT-L1 §1 method, and both saw the
  stratum letter.

The owner can still do the original check. The ten items and the order to use are in `draw-10.json`;
`adjudication-10.json` holds what a reviewer would be checking against.

## 3. Coverage (Table 1)

The re-audit rows cover the 1,549 non-first-party items. The pooled rows cover all 1,559, with first-party taken from
L1-a's census of that stratum (10 of 10 explained).

| estimate | reading | strict coverage | Wilson 95% (Kish n) | bootstrap | note |
|---|---|---|---|---|---|
| **re-audit, pre-specified (sonnet-60)** | **dashboard = refusal** | **93.6%** | **82.3–97.9 (43.8)** | 90.6–96.7 | **headline; J1 comparator** |
| re-audit, pre-specified | dashboard = explained | 95.9% | 85.5–99.0 (43.8) | 94.0–97.9 | |
| re-audit, lenient (partly counts) | dashboard = refusal | 95.6% | 85.0–98.8 (43.8) | 93.3–97.9 | |
| re-audit, the labeller's own refusal reading | per label | 94.8% | 83.9–98.4 (43.8) | 91.7–96.9 | sonnet read #29 as display-only |
| re-audit, unweighted | dashboard = refusal | 54/60 = 90.0% | 79.9–95.3 | | |
| re-audit, 10 adjudicated calls substituted | dashboard = refusal | 92.7% | 81.1–97.4 (43.8) | 90.4–95.8 | #22 yes → partly (§6) |
| re-audit, dashboard items as a known stratum | dashboard = refusal | 94.9% | 84.4–97.9 (42.7) | 93.0–96.8 | the census enumerates all 16 |
| pooled, L1-a + re-audit (120 labels) | dashboard = refusal | 93.9% | 86.5–97.4 (81.6) | 91.3–96.3 | two draws, two labellers |
| pooled, dashboard items as a known stratum | dashboard = refusal | 94.9% | 88.1–97.5 (79.8) | 92.6–96.9 | |
| pooled | dashboard = explained | 95.9% | 89.2–98.5 (81.6) | 93.6–97.9 | |
| L1-a labels re-weighted on revision-1 strata | dashboard = refusal | 94.3% | 80.5–98.5 (31.5) | 90.7–97.9 | same labels as 88.4% |
| *L1-a as published (revision-0 strata)* | *dashboard = refusal* | *88.4%* | *75.0–95.1 (40.3)* | | *superseded (below)* |
| *census "not refused" on the 60 (not a measurement)* | | *56/60 = 93.3%* | | | *corpus-wide 96.9%* |

**Why 88.4% moves to about 94%.** Under revision 0, L1-a's two Node-RED dashboard apps sat in automation C, a stratum
of 181 items with 3 labels. Each therefore carried a weight of about 60, so the estimate behaved as if about 120 items
were dashboard refusals. The corpus has 16 dashboard items: 14 by the revision-1 criterion (≥ 20 `ui_*` widgets) and 2
by the IR verdict. AUDIT-L1 §5 already called the widget-count variant (95.2%) "the better-founded one". Revision 1 puts
all 16 in automation A (71 items), and that alone brings L1-a's own labels to 94.3%.

The re-audit happens to draw 2 dashboard items among its 4 automation-A labels (#5 and #29). It therefore still
over-weights them, about 35 items' worth against 16. The known-stratum variant removes that and gives 94.9%.

**By cluster** (unweighted, conservative strict):
- Science, orchestration and consumer-creative: 12 of 12 each.
- Automation: 10 of 12. The two misses are the dashboard items.
- Agentic: 8 of 12. Two are full-history-handoff refusals (#2 realtime voice agent, #33 LlamaIndex multi-agent). Two are
  partly explained: #32, a CAMEL workforce that adds model-defined workers at run time, and #54, streaming guardrails.

**Labeller and census on the same 60.** The census leaves 56 of 60 unrefused; the labeller says yes to 54 or 55,
depending on the reading. The census refuses #29, which the labeller explains as display-only. It explains #32 and #54,
which the labeller calls partly.

## 4. Detector precision (Table 2)

| set | pairs | yes / partly / no | precision | Wilson 95% | L1-a (2026-10-09) |
|---|---|---|---|---|---|
| **node rules + tokens (sonnet-60)** | **202** | **118 / 52 / 32** | **0.713** | **64.7–77.1** (cluster bootstrap 66.7–76.0) | 0.73 (168 pairs; 66.1–79.3) |
| node rules only | 159 | 92 / 36 / 31 | 0.692 | 61.6–75.8 | |
| tokens only | 43 | 26 / 16 / 1 | 0.791 | 64.8–88.6 | |
| all pairs incl. plumbing | 237 | 139 / 62 / 36 | 0.717 | 65.7–77.1 | 0.65 (222 pairs) |
| plumbing (P01, P41) | 35 | 21 / 10 / 4 | 0.743 | 57.9–85.8 | 0.38 (54 pairs, incl. the removed detectors) |
| L0 rule assignments | 44 | 42 / 0 / 2 | 0.955 | 84.9–98.7 | not scored |
| node rules + tokens (opus-10) | 25 | 12 / 3 / 10 | 0.540 | 35.3–71.7 | |
| the 25 pairs both judged: sonnet / opus / **adjudicated** | 25 | 14/7/4 · 12/3/10 · **11/5/9** | 0.70 · 0.54 · **0.54** | adjudicated 35.3–71.7 | |
| blind recall (sonnet-60) | 231 blind pairs | 138 found | 0.597 | 53.3–65.9 | 0.61 |

**Decision against the bar.** The bar is 0.85 with a Wilson lower bound of at least 0.75, and the falsifier is below
0.75. The falsifier is met on every row that carries the decision: 0.713, 0.692, 0.54 and the adjudicated 0.54.

The only gain is in all pairs (0.65 → 0.717), and it comes from removing the six keyword and plumbing detectors, which
were most of L1-a's "no" plumbing pairs. Node-rule precision did not move. The primary labeller's "partly" verdicts often
carry a wrong-owner reason, for example "nothing is regenerated" or "not a kind to route on". On the shared pairs that
lifts its precision by 0.16 over the adjudicated figure. If the same gap held across all 202 pairs, adjudicated rule
precision would be near 0.55. That is an indication from 25 pairs, not an estimate.

**Where the precision is lost** (sonnet-60 per pattern, pairs ≥ 3):

| pattern | precision | pairs |
|---|---|---|
| P15 | 0.13 | 4 |
| P04 | 0.17 | 3 |
| P06 | 0.21 | 7 |
| P05 | 0.23 | 11 (8 no) |
| P33 | 0.40 | 5 |
| P21 | 0.50 | 4 |
| P53 | 0.50 | 3 |
| P20 | 0.56 | 8 |
| P32 | 0.56 | 9 |
| P42 | 0.57 | 7 |

Patterns at or above 0.93: P38, P29, P26, P36, P55, and P54 at 1.00. On the two shared items, P54 was adjudicated
partly, because the called children have effects (§6).

The false hits fall into seven classes, and both labellers name the first:
1. Tool and shell steps tagged `model` (nf-core and Nextflow processes, CI deploy scripts) become P05, P06, P03, P04 and
   L0 judge.
2. Configuration sub-nodes tagged `model` (chat-model, embedding and parser nodes) become P05, P06 and P07.
3. P15 fires on CI stage barriers.
4. P32 fires on file pickers and other human nodes that are not approvals.
5. The signal-wait token turns plain delays into P33.
6. P20 fires on tool-loop exit tests.
7. P29 fires on `on_failure` jobs through the "post" regex.

opus-10 adds three more: the error-branch token and Tekton `finally` become P27 with no error route; effectful sub-script
calls become P54; and P02 is now missed because its detector was removed.

**Misses.** Blind recall is 0.60. The most-missed patterns are P08 (17, step-level `when` and `if` guards), P12 (16,
implicit per-sample maps and matrices), P14 (8) and P54 (6, flattened subworkflows). That is AUDIT-L1 §8 item 4 again:
step-level structure that the node rules cannot see.

## 5. Inter-rater agreement on the 10 shared items (Table 3)

| quantity | value | note |
|---|---|---|
| explained, conservative, three-way (yes / partly / no) | 9 of 10, kappa **0.76** (p_e 0.59) | the only difference is #22 (yes vs partly) |
| explained, conservative, strict (yes vs not) | 9 of 10, kappa **0.74** (p_e 0.62) | |
| explained, conservative, lenient (explained vs no) | 10 of 10, kappa **1.00** (p_e 0.82) | |
| explained, dashboard = explained, three-way / strict | 9 of 10, kappa 0.62 / 0.62 (p_e 0.74) | lenient: all 10 explained by both; kappa undefined |
| coverage on the 10, conservative strict: sonnet / opus / adjudicated | 80% / 70% / 70% unweighted; 85.9% / 79.4% / 79.4% weighted (Kish n 8.2) | opus-10 put the lenient reading in bold as its headline (90%); AUDIT-L1's headline is strict |
| blind pattern sets: mean Jaccard | **0.58** (sonnet vs adjudicated 0.68, opus vs adjudicated 0.87) | identical on 2 of 10 (#10, #31); 35 and 30 pattern labels, 23 in both |
| L0 construct sets: mean Jaccard | 0.54, or 0.68 without input, step, note and done | opus lists the bookkeeping constructs on every item, sonnet rarely; sonnet's `for` is row 10 |
| detector verdicts, rule pairs both judged | 16 of 25 (0.64), kappa **0.43** | sonnet higher on 8 of the 9 disagreements |
| detector verdicts, plumbing / L0 pairs | 3 of 4 / 7 of 7 | |

**Gaps both found:**
- Streaming model output with mid-generation cancellation (#54).
- Model-defined task agents with a model-chosen provider and priority scheduling (#22).

**Gaps one labeller found:**
- Only opus-10 found a secret answer from a person (`input('• Please enter your password •')` posted to `/log-in`) and a
  session token kept in cross-run state (#36).
- Only opus-10 found several named entry points sharing state, and a rate limit on effects (#29).
- Only sonnet-60 noted cross-run state in files (`documentpicker`) on #36.

## 6. Adjudication of every disagreement on the 10 items

Reasons are in full in `out/L1-reaudit/adjudication-10.json`, with source paths and line numbers. Abridged:

| # | item | what | sonnet | opus | adjudicated | reason |
|---|---|---|---|---|---|---|
| 29 | node-red GivEnergy | explained | yes (+ dashboard flag) | no (+ explained if dashboard explained) | no / yes by reading | same substance: 41 display-only `ui_text`; the files record the conservative reading differently |
| 29 | | P42 | – | yes | **yes** | `flow.set('BaseURL')`, `flow.set('InverterSN0')` in the init run, `flow.get` in every later run |
| 29 | | P12 | – | yes | **partly** | `for (… regArray.length …)` sends 19 register reads; no code reduce, results go to display |
| 29 | | P01 | yes | – | **partly** | inject → function → http → function, two or three plumbing hops |
| 29 | | P08 | yes | – | **no** | the switches route by register or serial and gate no effect (L0 if) |
| 29 | | P34 | yes | – | **no** | `delay` with pauseType rate, 1 msg/s, is a rate limit, not a debounce and re-check |
| 1 | snakemake mirflowz | P14 | – | yes | **yes** | segemehl and oligomap map genome and transcriptome in parallel; `merge_*_maps` join them |
| 1 | | P29 | yes | – | **no** | `onsuccess: … rm -rf {INTERMEDIATES_DIR}` (Snakefile:43) runs on success only; the `onerror` half is P27 |
| 35 | HA zappi script | P54 (blind; detector y/n) | yes | no | **partly** | the decomposition into called scripts is real, but the children send notifications, and P54's child is an effect-free solver |
| 35 | | P25 | yes | – | **no** | a `choose` over conditions; no state is re-entered |
| 10 | n8n 7635 | P37 detector | yes | partly | **partly** | a hosted form is a real request, but there is no respond node, and a reply is what makes P37 |
| 22 | strands workflow tool | explained | yes | partly | **partly** | dependency-ordered agent tasks (`plan` has no dependency edges; `wide` is flat); model-chosen `model_provider` and `system_prompt` (workflow.py:319–369), with a silent fallback to the parent model |
| 22 | | P46 | – | yes | **partly** | task agents get their dependencies' outputs; the coordinator is a code scheduler, not a router judge |
| 56 | snakemake dea_limma | P15 | yes | – | **yes** | `ova_stats_plot` gathers every one-vs-all result (dea.smk:114, common.smk:12–16); the labeller's reason (`aggregate`) was wrong, the pattern right |
| 56 | | P14 | – | yes | **partly** | volcano, heatmap and one-vs-all analyses of one result; only the `all` target joins them |
| 31 | tekton displayname | P27 detector | partly | no | **no** | the error edge renders Tekton `finally`, which prints the result; no failure route (AUDIT-L1 scored #50 partly) |
| 24 | GHA promptflow deploy | P32 | yes | – | **no** | `environment: internal` may or may not require reviewers; that is not in the item |
| 24 | | P08 | yes | – | **partly** | `if: github.event_name == 'schedule'` picks canary or production: an L0 if between two effects |
| 24 | | P27 detector | partly | no | **no** | the token comes from `always()` steps, which P29 owns (AUDIT-L1 scored #39 partly) |
| 24 | | P41 detector (plumbing) | no | yes | **partly** | a CI workflow testing a sample by deploying it, with no build, barrier or release gate |
| 36 | shortcuts SNS client | P32 | – | yes | **yes** | "Are you sure you want to DELETE YOUR ACCOUNT?" twice and "… delete this channel?" (workflow_code lines 754, 768, 1006) |
| 36 | | P02 | yes | – | **no** | notifications are fetched and cached for display; nothing moves between systems |
| 36 | | P08 | yes | – | **no** | the checks before effects are P55's validation and P32's confirmations |
| 36 | | P10 detector | partly | yes | **partly** | real menus, but several anchors are document pickers and alerts (AUDIT-L1's partly convention) |
| 36 | | P54 detector | yes | partly | **partly** | 30 calls to child shortcuts that have effects; "SNS Receiver" re-invokes the parent |
| 54 | openai-agents streaming guardrails | P44 | – | yes | **partly** | a partial-output stream, but of the model's own output, not a bounded input topic |
| 54 | | P20 (blind; detector partly/no) | yes | no | **no** | nothing is regenerated; the loop breaks |
| 54 | | P07 detector | partly | no | **no** | a boolean check that aborts (P48), not classify-then-dispatch |
| 54 | | P04 detector | partly | no | **no** | the check never gates delivery; the text prints as it streams |

The L0 construct differences follow the pattern decisions: #1 `finally` vs `if`/`done`, #35 and #36 `call` vs `effect`
and `approve`, #29 `map` and `state`, #54 `agent`/`for` vs `map`/`if`. The rest is the bookkeeping convention noted in §5.
Opus was closer to the adjudicated pattern sets on 5 items (#29, #1, #22, #36, #54) and sonnet on 2 (#35, #24). The
other 3 are ties: #10 and #31, where both labellers gave the same set, and #56.

## 7. Constructs the vocabulary lacks

These are merged from both labellers and quoted from the sources in the label files. They are not edits; L0 and L1 are
unchanged.

**Two gaps stop an item being explained:**
1. **Model-defined agents at run time** (#32 CAMEL workforce: "writes role, system message and description for a new
   single-agent worker"; #22 strands: a model-written dependency DAG of task agents with model-chosen provider and
   prompt, and priority scheduling). L0 `agent` is fixed and `plan` has no dependency edges.
2. **Streaming a model's output and cancelling mid-generation** (#54, "text deltas are read one by one while the model is
   still generating … break out of the stream loop early", with a single-flight background check; #2 adds realtime
   audio). L0 `stream` (row 30) is a bounded input consumer.

**Gaps that leave the item explained but need a construct, a field or an L3 binding:**
- A secret answer from a person, and a session credential in cross-run state (#36). `ask` puts the answer in the trace,
  and the credential rule covers literals only.
- Loops and waits with no literal cap (#6, #17, #41, #55, #57).
- Randomness and wall-clock time in a pure step (#3, #28, #37; also #24's randomised `random-wait-action` delay).
- A per-run tool allow-list (#6) and a caller-supplied output schema (#45).
- RAG ingestion (#38).
- Deferred teardown and a cross-pipeline lock (#30).
- History re-entry (#16).
- Priority scheduling (#22).
- Several entry points sharing state (#11, #29).
- Static bypass toggles (#15).
- A rate limit on effects (#29).
- Cross-run state in files (#36, #37). L0 `state` is designed but not built.

## 8. Decision for D1, and what follows

- **L1-a: FAIL** (§0, §4). D1 stays **N**. The census remains a candidate generator. Its per-pattern support, budget
  split (81.8% within 5), greedy curve (90% at 38) and buildability tiers are not measurements. Two things follow from
  that:
  - **L2.** LIBRARY-TESTS L2's corpus arm uses census `needs` as gold, so its precision@k is bounded by detector
    precision of about 0.55–0.71. Either label the L2 gold by hand on a sample or report L2 as agreement with the
    candidate generator.
  - **What would pass.** AUDIT-L1 §8 item 4 (revision 2: step-level tags to P08, P12, P26, P29 and P54; tool nodes
    re-classified away from `model`; P15, P20, P32 and P33 re-scoped). Then a fresh draw, with detector verdicts given
    by two adjudicators. Labeller leniency moved precision by 0.16 here, more than the gap to the falsifier.
- **Coverage statement** (replaces 88.4% wherever it is quoted as the headline): *on 60 fresh stratified hand labels,
  L0 + L1 explain 93.6% of the 1,549 non-first-party corpus workflows (Wilson 82.3–97.9%), reading a Node-RED dashboard
  app as a refusal; 95.9% (85.5–99.0) reading it as explained; 93.9% (86.5–97.4) pooling both audits' 120 labels. This
  is in-sample (the vocabulary was mined from these platforms) and labelled by Claude models.* README, LIBRARY-TESTS L1,
  L1-PATTERNS §0 and §1.6, and the BUILD-ORDER findings still quote 88.4%. They should point here. That is not done in
  this commit, which changes only this file, the `out/L1-reaudit/` additions and the ledger cell.
- **J1 comparator: 93.6%.** J1 (`briefs/l1b-heldout-coverage-brief.md`) passes if pooled out-of-sample coverage, strict
  ("yes" only) and with refusals counted as not explained, is at least **83.6%**.

  I chose this figure over the pooled 93.9% for three reasons. Its estimator was committed (ec8983c) before this
  analysis. It is the fresh audit of the revision J1 tests. And its labeller is the same model as J1's (Sonnet), so a
  labeller effect, which §5 shows is several points, cancels in the comparison.

  The estimators in Table 1 span 92.7–94.9%. A J1 figure below 82.7% fails under every comparator, and one at 84.9% or
  above passes under every comparator. Between the two, report the J1 figure as sensitive to the comparator.

  J1 should repeat this audit's arrangement: a blind second labeller of another model size on at least 10 items, and the
  two run-stopping gaps of §7 counted explicitly. Those gaps are agentic-cluster constructs, and the J1 candidate
  platforms (Windmill, Kestra, Step Functions and the rest) are mostly not agentic, so J1 may pass without testing them.

## 9. Limits

- **Correlated labellers.** Both labellers and the adjudicator are Claude models (§2). Nothing here is a human judgement.
- **One adjudicator, after the census was seen.** Adjudication was by one agent who saw the detectors' anchors and both
  labels. Precision verdicts by every party came after the census rows were opened, so they lean towards agreement.
- **Wide intervals.** The strata hold 2 to 4 labels, so the Kish interval is wide and the variance at stratum level is
  barely estimable. The pooled 120 halves the interval but mixes two draws, two labellers and labels made against
  revision-0 and revision-1 L1 text. The vocabulary is the same 30 constructs and 54 patterns, but cards and checklists
  changed.
- **The adjudicated-10 row corrects 10 of the 60 items only.** It is a sensitivity, not a corrected estimate.
- **First-party not re-audited.** First-party is absent from the fresh draw, so its 10 items rest on L1-a alone.
- **Not done here.** L6-a on the revised checklists (D9), the census re-run of a revision 2, and the owner's own blind
  check, which remains possible (§2).
