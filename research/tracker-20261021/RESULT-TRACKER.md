# RESULT-TRACKER: the condition tracker (A7, task #60)

*2026-11-04. Owner's ask (2026-10-14): "log the conditions specified by user ... and check against logic and stuff demanded ... we
shouldn't over engineer here". Plan and sources: [DOSSIER.md](DOSSIER.md). Preregistrations: [PREREG-TRACKER.md](PREREG-TRACKER.md)
(BUILDER-1 and E8, frozen 2026-10-21, deviations D1-D3) and [PREREG-TRACKER-H.md](PREREG-TRACKER-H.md) (held-out set, frozen
2026-10-28). Every number below is recomputed by the commands in §10 from files committed beside this one. BUILDER-1 and E8 are
**development evidence**; only §6 is held-out.*

*Revised 2026-11-04 after the adversarial review (§11, [PREREG-TRACKER-H2.md](PREREG-TRACKER-H2.md)). The §6 numbers stand as the
preregistered result, but two leaks qualify them: every Haiku call saw the host account's e-mail (B0-H rows and H7 contaminated), and
the tracker and T1 were given the whole answer key while model builds only got the answers they asked for (model-built numbers are an
upper bound). The corrected re-measure on the same, now open, set is development-grade.*

## 00. Corrected bottom line (2026-11-04)

- **Product setting** (each build's own words, one build in hand, B0-H rebuilt without the host identity), on the 42 model-built
  builds (21 defective, 21 verified), per capture sample: **the tracker catches 6 / 13 / 6 with 0 / 1 / 1 false alarms.** No tracker
  catches 4; a $0 grep for the person's literals catches 2 (0 false alarms); the prose checklist catches 10-12 but flags 11-12 of the
  21 good builds. On all 97 builds: 28 / 37 / 30 of 64 caught, 1 / 3 / 3 false alarms (precision 0.97 / 0.93 / 0.91).
- **Rules:** H3 and H4 met (H4 now against three T1 samples and their majority), H1 met in s0 only, H2 not met. Every false alarm
  remains a binding error.
- **Half of the model-built margin was the answer-key leak**: with the whole key the tracker caught 12 / 11 / 12 of the same 21.
- **v4** (two evaluator bugs fixed, product default) improves condition-level precision a little (0.85 / 0.72 / 0.78 on the 97
  builds) and removes no build-level false alarm.
- **H7 again:** tracker findings fixed 1 of 4 flagged one-shot builds; checklist findings and self-review fixed none and each broke one.
- **Status of the owner's ask:** logging conditions works and is cheap; checking against them adds a few precise catches over a
  grep or no tracker, with recall that swings by sample. It is development evidence with a capability number (D), not held-out proof.
- Spend: Haiku **$2.0662** of the $3 cap (this review: $0.5939, the canary included); mercury-3 unchanged at 350,720 tokens.

## 0. Bottom line (as first written, 2026-11-04; see §00 and §11)

- **Built.** A product-level tracker in `app/`. It reads the person's words, and later edits, into conditions quoted by pointer. Each
  condition gets one check, chosen from 7 code-owned templates and pointed into a closed vocabulary, or is marked inspection with a
  reason. The tracker runs the checks on practice data before the live run and again on every live run. Each condition then shows
  `met`, `unmet` (with evidence), `unknown` (with a reason) or `waived`. Every change to the conditions is a version-bound proposal.
  Only a person can confirm or waive. It is reachable from FoundryApp's API, an MCP tool and the dashboard (§1). No new dependency.
- **Held-out result** (§6). PREREG-TRACKER-H was frozen before any call on 14 new requests: 97 builds, 65 of them defective. The
  product setting (T2solo, one build in hand) caught **37 / 37 / 40** defective builds in the three Haiku samples. It raised **1 / 4 / 4**
  false alarms on the 32 verified builds, for a precision of 0.97 / 0.90 / 0.91.
  - The no-tracker baseline (T0) caught **2**.
  - The prose checklist (T1) caught **60**, with **18** false alarms (precision 0.77).
  - Met: H3 (adds at least 10 catches over T0), H4 (better precision than T1, fewer false alarms), H5 (capture recall 58/58 in every sample) and H6 (v3 has fewer false alarms than v1).
  - **Not met: H1 (precision ≥ 0.95 in every sample) and H2 (zero false alarms).**
- **Not every catch had a valid reason.** Adjudication labelled every `unmet`. In 3 / 7 / 4 of the caught builds, every reason shown
  to the person was wrong; those builds were defective for some other reason. Condition-level check precision is 0.82 / 0.72 / 0.75.
- **What still fails** (§5, §6.3):
  - **Binding errors** are the main cause of false alarms that remain. The binder drops a qualifier the words state elsewhere, such
    as "nobody has acknowledged" or "new leads". It also turns "a single daily digest" into "each ticket at most once, ever".
  - **Misses** are 28 of 65. In 13 of them the binder abstained or the vocabulary has no column for the person's category
    (California, west coast, "cc me"). In 5, the practice data never contains the case. In 10, the check was too weak: it accepted a
    mention where the person asked for a routing or for particular content.
- **Feeding the findings back to the builder did not help.** In H7, no repair arm fixed any defective one-shot build: 0 of 9 with
  tracker findings, 0 of 7 with checklist findings, 0 of 10 with a generic self-review. §6.4 gives the root cause.
- **E8**, the order saga (development evidence), is beyond the template set. Only 12 of its 30 gold ids got any check, and no catch
  on E8 was grounded under any semantics (§4).
- **Cost.** Capture plus bind costs about $0.003 to $0.005 of Haiku per request, once; re-checking any build or live run is $0. T1
  costs $0.0015 per build. The whole program spent **$1.47 of Haiku** (cap $3) and **350,720 mercury-3 tokens** (item cap 0.5M) (§7).

## 1. What was built (the product)

All in `app/`, as new files plus narrow hooks; nothing in `src/` (the engine v2 series merges later) and no `src/runtime.mjs` edit.

| piece | file | what it does |
|---|---|---|
| words | `app/core/tracker/words.mjs` | the person's turns (request, answers, later edits) as one text; quotes located **by pointer** (turn, start, end); clause units for the $0 rule |
| capture | `app/core/tracker/model.mjs` (`tracker-capture/1`) | Haiku reads the words into conditions; a quote that is not verbatim in the words is dropped. `captureRule` is the $0 form (every clause is a condition) |
| vocabulary + lint | `app/core/tracker/vocab.mjs` | the closed set of names a check may use: channels and effect fields from the app's capability registry, sheet columns from the person's data, literals copied from their words. A name outside it fails lint ($0) and gets one retry |
| bind | `model.mjs` (`tracker-bind/1`) | Haiku (or mercury-3) picks one of 7 templates per condition and points into the vocabulary, or says `inspection` (with why), `needs-answer` (with the question) or `not-a-condition` |
| check templates | `app/core/tracker/checks.mjs` | `present`, `absent`, `field`, `count`, `when-then`, `scope`, `order`: semantics in code, evaluated over what a run did, refused proposals included (attempts, never satisfactions). No model-written code runs; the dossier's `custom` escape hatch was not needed and was not built |
| semantics | `app/core/tracker/semantics.mjs` | v1 (frozen), v2 (D2), v3 (D3, product default): the evaluation rules that §5 root-causes |
| practice + scenarios | `practice.mjs`, `scenarios.mjs` | every build runs on the practice workspace (base), again on the same store (repeat), and on condition-targeted rows written on and just outside each check's own filter edge (targeted) |
| gates | `app/core/tracker/gates.mjs` | real-shape gate (a twin of a real passing instance must fail; a check never activated is `unknown: not exercised`) and G3 (a check unmet on every build of a request, 3 or more, is `check-suspect`) |
| statuses | `app/core/tracker/status.mjs` | `met` (thin below 3 decided activations), `unmet` (grounded check only, with evidence and the three-way choice: the build / the check / my words is wrong), `unknown` with a reason (not-exercised, no-check, check-suspect, unverifiable, needs-answer, not-run), `waived`. Untested is never met |
| ledger | `app/core/tracker/store.mjs` (`node:sqlite`) | one ledger per flow; every change is a version-bound proposal in OpenSpec's ADDED / MODIFIED / REMOVED form, applied by compare-and-swap on base versions. The tracker's own reading of the words applies at once but stays **unconfirmed**; a model's edit waits for a person; only a person (`HUMAN_CHANNELS`) confirms, accepts or waives. A waiver needs a reason and is bound to (condition version, workflow hash): it lapses when either changes |
| live runs | `app/core/tracker/live.mjs` | after every live run that ends, the same checks read what THAT run read and did; a condition its data never reached stays `unknown: not exercised` |
| app API | `app/core/tracker/service-hooks.mjs`, 5 one-line hooks in `app/core/service.mjs` | `conditions({flowId \| proposalId})`, `checkConditions(...)`, `proposeConditionEdit({flowId, changes, by, channel})`, `decideCondition({flowId, action, ..., channel})` (accept / reject / confirm / waive / unwaive), `checkRun({runId})`; `propose` captures conditions, every finished run is checked |
| MCP | `app/mcp/server.mjs` | `conditions` (read; `check: true` runs the version on practice data; `runId` checks a live run) and `edit_conditions` (propose only). There is no MCP tool to confirm or waive |
| dashboard | `app/dashboard/dashboard.js`, `server.mjs` | "What you asked for": each condition with its quote, its check in plain words and its status; buttons "Yes, I meant this", "Set aside" (asks why), "Check it again", "Not a condition"; pending agent edits with Accept / Reject |

Not built, on purpose (the over-engineering line): no temporal-logic language, no model deciding a status, no automatic repair of a
check after a build was seen, no auto-conditions from a pattern library, no new dependency.

**Tests** (each run alone, `nice -n 15 node --test --test-concurrency=1 <file>`; 63 of 63 pass, §10): `app/test/tracker/checks.test.mjs`
(templates, refused proposals, windows and censoring, untested-is-never-met, real-shape gate teeth, lint, scenario edges),
`semantics.test.mjs` (each v2/v3 rule with a case where it must NOT fire, e.g. a real omission stays unmet), `service-tracker.test.mjs`
(end to end with a scripted model: words -> conditions -> checks -> statuses catches a defect the practice run passes; edits are
version-bound; a model cannot waive; the dashboard refuses a request without the page token; live-run checks), plus the evaluation
runners' tests under `experiments/tracker-v2/test/`.

## 2. How it was measured

Three arms flag a build **before its live run**, on practice data only (no arm sees a hidden world, an oracle, a label or a
control's description):

- **T0, no tracker**: the build's own practice run does not pass (its status or its own acceptance checks). E8: run health.
- **T1, prose checklist**: one Haiku reviewer call per build (`tracker-prose-checklist/1`) gets the person's words, the SAME condition
  list as T2, the build and its base practice run, and ticks each condition; any `unmet` flags the build.
- **T2, the tracker**: any condition `unmet`. **T2solo** is the product with one build in hand (the real-shape gate sees that build's
  runs only, no G3); **T2** adds the cross-build view (gate over every build of the request, G3 on); **T2noG3** is T2 without G3.

Labels: BUILDER-1 and the held-out set use the hidden-world oracle's `verified` (each build run once in a world it never saw); E8 uses
the bed oracle on three practice worlds. Gold condition lists were written before any capture or bind call. "Caught" = defective and
flagged; "FA" = verified and flagged.

## 3. BUILDER-1 (development): 101 builds of 24 requests, 18 defective

Frozen semantics v1 is the preregistered primary; v2 (D2) and v3 (D3) were designed on these builds and are post-hoc deviations.
Each T2 cell is one Haiku capture sample bound once by Haiku (s0, s1, s2) or the $0 capture rule bound by Haiku (rule).

| arm | v1 s0 / s1 / s2 / rule | v2 s0 / s1 / s2 / rule | v3 s0 / s1 / s2 / rule |
|---|---|---|---|
| T0 (no tracker) | 7 caught, 0 FA | same | same |
| T1 (prose checklist, on s0's list) | **12 caught, 43 FA** (precision 0.218), $0.00147 per build | | |
| T2 (cross-build, G3) | 7/9/7/6 caught, **23/18/26/23 FA** | 8/10/8/7, 0/4/11/4 FA | 8/10/8/7 caught, **0/0/0/0 FA** |
| T0+T2 | 11/11/11/10, 23/18/26/23 FA | 12/12/12/11, 0/4/11/4 FA | **12/12/12/11 caught, 0/0/0/0 FA** |
| T2solo (one build in hand) | (not computed under v1) | 10/-/-/- , 13 FA | 10/12/10/10 caught, **8/13/8/11 FA** |
| T0+T2solo | | 14, 13 FA | 14/14/14/13, 8/13/8/11 FA |

Preregistered rules (v1, frozen): **R1 met** (T0+T2 adds 4/4/4 catches over T0's 7, needed 3 in every sample). **R2 not met** (23/18/26
false alarms; needed 0). **R3 met on s0 and s1, not on s2** (T2 precision 0.233/0.333/0.212 vs T1 0.218; T2 FA 23/18/26 ≤ 43).
**R4 met** (Haiku capture recall 80/80, 79/80, 79/80 = 1.000/0.988/0.988; the $0 rule 71/80 = 0.888, testable 0.879).

Condition-level check precision after adjudication (§5; every unmet (build, condition) labelled from its evidence, 77 groups):

| semantics | T2 (G3) s0 / s1 / s2 / rule | T2solo s0 / s1 / s2 / rule |
|---|---|---|
| v1 | 0.361 / 0.474 / 0.261 / 0.412 | - |
| v2 | 1.000 / 0.640 / 0.424 / 0.750 | 0.412 / - / - / - |
| v3 | **1.000 / 0.889 / 1.000 / 1.000** | **0.500 / 0.500 / 0.500 / 0.480** |

Abstention (v3, T2 view, all (build, condition) statuses): unknown 0.49 / 0.42 / 0.51 / 0.56, mostly `unverifiable` (the binder said a
run cannot show it: tone, "start nice and get firmer") 148/143/158/171, then not-exercised 44/34/39/28, check-suspect 35/15/44/19,
needs-answer 8/13/8/8. Expressiveness: 52 of the gold's 60 testable conditions were captured AND got a check (0.867) in every Haiku
sample (rule: 48/60 = 0.800), under the dossier's 20% bar for "the template set is wrong".

Reading (development): the frozen semantics did what was asked of recall (R1, R4) and failed precision (R2) badly. After v2 and v3
the cross-build tracker is the only arm with zero false alarms, and adding it to T0 takes catches from 7 to 12 of 18. The product
view (one build) still raises 8-13 false alarms on 83 verified builds; §5 says why.

## 4. E8 (development): the order saga, 9 scored builds, 3 defective

Conditions: the stored 2026-10-14 Haiku extraction s0 plus the $0 coverage rule (115 conditions; 28 of the 30 frozen gold ids, 0.933;
Haiku alone 23/30). Haiku bound **18 of 115** to a check (82 inspection, 15 not-a-condition): only **12 of 30 gold ids** got any check.
The template set does not express this spec (risk 2 of the dossier: well above 20% inexpressible).

| arm | v1 | v2 | v3 |
|---|---|---|---|
| T0 (run health) | 1 caught (B1-O), 0 FA | same | same |
| T1 (prose checklist) | **3 caught, 3 FA** ($0.0149 per build) | | |
| T2 (G3) | 2 caught, **6 FA** (every known-good) | 2, 6 FA | **0 caught, 0 FA** |
| T2noG3 / T2solo | 3 caught, 6 FA | 3, 6 FA | 3 caught, **6 FA** |

Preregistered E8 rules (v1): **R2-E8 not met** (unmet on all 6 known-good builds); **R1-E8 not met** (lineage 3 caught, B1-O missed by T2;
T2noG3 flags it). Instance join (each unmet's shown evidence joined by order id to the oracle's verdict on that world): v1 T2 72 of 72
instances on orders the oracle passes; v3 T2solo 1 of 30 on a failing order. **No catch on E8, under any semantics, is grounded**: the
builds flagged are flagged by checks that fail on the known-good builds too. The E8 second bind sample (`bind-claude-haiku-5-5-b1.json`)
stopped on a rate limit at 48 of 115 conditions on 2026-10-28. It was not resumed. Its answer would not change this reading:
expressiveness is 12 of 30 ids, and no catch is grounded under any semantics. It is also optional by the preregistration's own words
("K = 2 if budget allows"), and the machine time went to the held-out set.

## 5. Every false alarm, root-caused

A false alarm is an `unmet` on something the build does right by the person's words. Each group (case, check, failing items) was
labelled from its evidence and the practice effects (`experiments/tracker-v2/explain.mjs`), labels in
[builder1/adjudication-labels.json](builder1/adjudication-labels.json), groups in [builder1/adjudication.json](builder1/adjudication.json).
The causes, and the rule that answers each (all general rules about the person's words, never a per-case patch; tests in
`app/test/tracker/semantics.test.mjs`, each with a case where the rule must not fire):

| cause (BUILDER-1) | what happened | answered by |
|---|---|---|
| over-literal (v1 s0: 11) | content the person described ("what's done", "open mon-sat 9-6") required as literal words | R-wording (v2): soft wording missed is undecided; hard wording (digits, @, quoted, names) still fails |
| closed-world (4) | a `scope` check's "no other item is ever named" half from words with no exclusive cue | R-closed (v2): only with only / just / never / don't / except |
| rules-overlap (4) | two of the person's rules claim one item ("big companies go to Raj", "referrals go to Sofia"); the build followed the other | R-overlap (v2): a question to the person, unless the build never implements the failing rule |
| selector-it (4-8) | "sign it as Hannah" applied to every message, including ones to the person's own inbox | R-it (v2): a field rule failing only for one recipient group is a question |
| evaluator-names (9, noG3) | a ticket "named" by a common word ("Thanks!") | R-names (v2): extra naming values must be distinctive |
| object-name (10) | the check selects sheet "mailing list"; the system's sheet is "newsletter" | R-objects (v2), R-objects+ by schema (v3): suspect |
| keyword-category (10) / scenario-chimera (5) | "asks about shipping" bound to a keyword; a synthesized row appended the keyword to another row's text | R-chimera (v2): no synthesized row for free-text keyword filters |
| state-vs-effect (4-8) | "the list has everyone": a contact already on the list read as missed | R-state (v2), R-state+ (v3) |
| contradictory (12, s2) | one effect field fixed twice (to = the lead's address by link, to = raj@ by requirement): nothing can pass | R-contra (v3): suspect |
| **unstated-qualifier** (5-20, T2solo) | the words omit a qualifier every sensible build and the oracle apply (unsubscribed contacts, receipts, already-paid invoices) | R-qualifier (v3) turns failures exactly on one unmentioned category value into a question; **residual** in T2solo |
| **binding** (4-8, T2solo) | the binder chose a filter or template the words do not support (included `disputed` in "everyone who still owes us" although the words set disputed bills apart; a strict count for a "when") | **not answered**: G3 catches it when 3+ builds of the request exist; one build in hand cannot |
| **boundary-ambiguity** (5, s1) | a targeted row exactly on an edge the words leave open ("from the last 24h" at exactly 24 h) | **not answered** |

Residual in the product view (v3 T2solo, condition level): s0 14 false of 29 unmet (unstated-qualifier 10, binding 4); s1 16 of 33
(binding 6, unstated-qualifier 5, boundary-ambiguity 5); s2 14 of 29; rule 13 of 26. Under G3, v3 leaves 2 false unmets (s1, binding,
both on builds that are defective anyway).

E8 (v1/v2 FA on all 6 known-good builds; [PREREG-TRACKER.md](PREREG-TRACKER.md) D3):
- **C-066 / C-068 / C-069** (reserve within 120 min of processing; charge within 120 min of the reservation's commit; ship within 120
  min of the charge's commit): timing and outcome artefacts. A response emitted in the trigger's own tick was "early" (R-deadline); a
  declined charge was a trigger to ship after (R-commit); a reservation the system declined counted as the flow failing (R-outcome); a
  shipment owed after a refund (R-discharge, Symboleo's discharge). Fixed in v3.
- **C-087** (residual, v3 T2solo, all 9 builds): "When a customer cancels, send `order-cancelled`" drops SPEC-E R6.1's qualifier
  "before any of its steps committed" (and R3.2's "at or before the deadline"); the spec's late or refused cancels get `cancel-refused`
  (R6.3), which every build sends. Cause: **binding** (a dropped precondition the vocabulary cannot express: "no step committed yet"
  is derived state, not a field). G3 marks it suspect (T2: 0 FA); one build in hand cannot.

## 6. Held-out set (PREREG-TRACKER-H): the only claim-bearing result

> **Qualified 2026-11-04 (§11).** The B0-H rows and H7 (§6.4) are **contaminated** by the host account's e-mail in every Haiku
> call's context (B2, §11.2). Every model-built number is an **upper bound "given the whole answer key"**: the tracker and T1 got
> every key answer, the builders only those they asked for (M1, §11.3). The corrected re-measure is §11.4.

**Set-up.**
- **Requests:** 14 new requests written by mercury-3 from the template cards. Hidden worlds, the 41 bad-slot controls and a gold
  list of 58 conditions were written before any build or tracker call.
- **Builds (97):** REF 14 (2 defective by design), CONTROL 41 (all defective), B-H 14 (6 defective), B-M 14 (6), B0-H 14 (10).
  That makes 65 defective and 32 verified. The model-built subset is 42 builds: 22 defective, 20 verified.
- **What was frozen:** the tracker as shipped, semantics v3 with every prompt unchanged.
- **Labels:** the hidden-world oracle, each build run once.

### 6.1 Build level: the preregistered rules

| arm | s0 | s1 | s2 |
|---|---|---|---|
| T0 (no tracker) | 2 caught, 0 FA | same | same |
| T1 (prose checklist, s0's list) | **60 caught, 18 FA**, precision 0.769 | | |
| **T2solo v3** (the product, one build) | **37 caught, 1 FA**, 0.974 | **37, 4 FA**, 0.902 | **40, 4 FA**, 0.909 |
| T0+T2solo v3 | 37, 1 FA | 37, 4 | 40, 4 |
| T2 v3 (gate over every build, G3) | 37, 1 FA | 35, 1 | 38, 1 |
| T2solo v1 (frozen semantics) / v2 | 45, 10 FA / 40, 8 | 50, 9 / 37, 4 | 47, 12 / 46, 12 |
| T2solo v3, model-built subset (22 defective, 20 verified) | 15, 0 FA | 13, 2 | 16, 2 |
| T1, model-built subset | 18, 11 FA (0.621) | | |
| T0, model-built subset | 2, 0 FA | | |
| T2-rule v3 ($0 capture rule + Haiku bind), solo / G3 | 24, 4 FA / 22, 0 FA | | |
| T2-M v3 (mercury-3 binder; **2 of 14 requests** bound before the token cap) | 5, 0 FA | | |

Per arm, s0, T2solo v3 against T1 (caught, then FA):
- REF: 1/2 caught against 2/2; FA 1/12 against 7/12.
- CONTROL: 21/41 against 40/41.
- B-H: 3/6 against 5/6; FA 0/8 against 5/8.
- B-M: 3/6 against 6/6; FA 0/8 against 5/8.
- B0-H: 9/10 against 7/10; FA 0/4 against 1/4.

| rule (frozen) | s0 | s1 | s2 | verdict |
|---|---|---|---|---|
| H1 T2solo-v3 precision ≥ 0.95 | 0.974 | 0.902 | 0.909 | **not met** |
| H2 T2solo-v3 flags 0 verified builds | 1 | 4 | 4 | **not met** |
| H3 T0+T2solo-v3 catches ≥ 10 more than T0 | +35 | +35 | +38 | **met** |
| H4 T2solo-v3 precision ≥ T1 and FA ≤ T1 | 0.974 vs 0.769, 1 vs 18 | 0.902, 4 vs 18 | 0.909, 4 vs 18 | **met** |
| H5 capture recall ≥ 0.90 (pointer recall: the quote points at the gold's words; meaning is not scored, review m1) | 58/58 | 58/58 | 58/58 | **met** (the $0 rule: 56/58 = 0.966) |
| H6 v3 FA ≤ v1 FA (same binding) | 1 vs 10 | 4 vs 9 | 4 vs 12 | **met** |

Decided mechanically by `experiments/tracker-v2/decide-h.mjs`, written and committed (`25d8353c`) before any held-out score was read.

### 6.2 Condition level and grounding (adjudicated after scoring)

All 2,207 `unmet` (file, view, build, condition) entries fall into 126 groups, and every group was labelled
([heldout/adjudication-labels.json](heldout/adjudication-labels.json), written by `experiments/tracker-v2/heldout-labels.mjs`).
The labels follow the PREREG-TRACKER §5 definitions. Where the same evidence means different things on different builds, a label
can be overridden per build (`byBuild`). The one case is HS2's overlap ticket: it is a question on the reference, which answers
shipping questions, and a real omission on the builds that never answer them.

| v3 | s0 | s1 | s2 | rule |
|---|---|---|---|---|
| condition-level precision, T2solo | **0.820** (41/50) | **0.717** (38/53) | **0.754** (46/61) | 0.771 (27/35) |
| condition-level precision, T2 (G3) | 0.820 | 0.826 | 0.852 | 0.929 |
| caught builds with ≥ 1 true unmet (grounded), T2solo | **34** of 37 | **30** of 37 | **36** of 40 | 23 of 24 |
| caught only through false unmets ("by luck") | ref/HO1, b0-h/HS1, b0-h/HS2 | the HO2 controls and B-H/B-M HO2, two HL1 controls | two HL1 controls, b0-h/HS1, b0-h/HS2 | control/HC2-0 |

In BUILDER-1, by the same measure, v3 T2solo catches 8 / 9 / 8 grounded and 2 / 3 / 2 by luck.

Abstention, v3 T2solo s0, over all (build, condition) statuses: 250 met, 50 unmet, 273 unknown (0.48). The unknowns split into
unverifiable 202, not-exercised 34, check-suspect 23, no-check 13 and needs-answer 1. The Haiku binder gave a check to 51 of 83
captured conditions in s0 (48 of 83 in s1, 50 of 81 in s2) and marked 17 inspection.

### 6.3 Every held-out failure, root-caused

**False alarms on verified builds (v3 T2solo)**:

| sample | false alarm | cause |
|---|---|---|
| s0 | ref/HS2, "all other tickets also go to mike in a single daily digest" | **Binding.** Bound as "each normal ticket gets at most one e-mail to mike, ever". The repeat practice run is the next day, and its digest names the still-open tickets again. The words mean one digest per day. |
| s1 | ref/HL1, b-h/HL1, b-m/HL1, "log who got what" | **Binding.** Bound over every lead. The words' first sentence scopes the request to *new* leads from the form, so the spam lead and the already-contacted lead are rightly neither routed nor logged. R-qualifier did not fire: the failures fall on two status values, and the words do name "new". |
| s1 | ref/HO2, "don't email for warnings" | **Binding.** Bound as "every critical gets an e-mail; no other alert is ever e-mailed". PA-4 is critical but acknowledged, and the words page only criticals nobody acknowledged. |
| s2 | ref/HL1 ×3 builds as in s1, and ref/HS2 | Same causes as above. |

**False unmets on defective builds** (they inflate catches "by luck" and lower condition-level precision):
- **binding**: the same dropped qualifiers as above.
- **scenario-names**: a new evaluator bug. A targeted copy's fresh id is the original's plus a suffix ("P-1 S2"), so an e-mail
  about the copy also names "P-1".
- **evaluator-repeat**: a once-per-run count read over the two-run repeat view.
- **over-literal** (s2): "Every e-mail containing the FAQ answer has its text EQUAL to it", where the text includes the subject and a greeting.

**Misses** (s0, 28 of 65 defective builds not flagged), by cause:
- **The binder abstained, or the vocabulary has no column for the person's category** (13).
  - HL1 ×2 and HL2 ×6: "if they're in California", "west coast / east coast". The practice leads have `region` and `country` but no
    state, so the binder marked the routing rules `inspection`. "cc me" has no cc field (no-check).
  - HW1 ×2: "plus what's open and blocked" was marked inspection.
  - HE2 ×2: the binder's checks fix `to` twice, and R-contra correctly makes them suspect.
  - HC1-2: the check is suspect, by schema.
- **The practice data never contains the case** (5).
  - HS1 ×4: the practice tickets hold no refund ticket, and R-chimera (v2) forbids synthesizing one from a free-text keyword, so the
    refund conditions stay `not exercised`. That is a precision rule costing recall.
  - HC2-0: the control adds only contacts tagged "customer"; every practice contact is.
- **The check was too weak** (10).
  - HE1 ×2: "anything $50 or more goes to Dana" was bound as "an e-mail to Dana names it". The template's single summary e-mail to
    Dana also lists the auto-approved claims, so a wrongly approved $50 claim still "reaches Dana".
  - HI1 ×2 and HI2: the cadence checks test that a reminder is sent at 30 / 60 / 90 days, not *which* stage it is.
  - HO2 ×5: "put up a summary of unresolved warnings and criticals" was bound as "a chat post happens", not "every unresolved warning
    or critical is in it". Nothing forbids info alerts.

### 6.4 H7 (exploratory): the findings back to the one-shot builder

Each arm gave the B0-H builds one repair round from the same writer. Fixed / broken / cost:
- **t2** (tracker findings, the 9 flagged builds): 0 / 0 / $0.043.
- **t1** (checklist findings, the 8 flagged builds): 0 / 0 / $0.037. One flagged build was verified and stayed verified.
- **none** (self-review, all 14 builds): 0 / 0 / $0.063.

Root cause, from the repaired records (`runs/repair-*/records`):
- **The feedback was misread.** In HI1, the finding "maria@pixelandpixel.com: no email effect matches" quotes an answer to the
  "summaryTo" question without the question itself. The writer read Maria as a client row ("her row ... must be checked").
- **The host account's address survives.** *(Corrected 2026-11-04, review B2; the first version of this line called it an address
  "no input contains" that the writer "invents", which was a misdiagnosis.)* The one-shot writer hard-codes an e-mail address in HI1,
  HL2 and HO1 (now `requester@example.test` in the committed files, §11.1). It is the host account's own address: the `claude -p`
  route puts it into every Haiku call's context ("The user's email address is ..."), so the model took it for the person's (§11.2).
  The finding names the missing recipient, not the wrong one, and the repair writer, which still had the host address in its
  context, kept it. **This H7 run is contaminated**: the re-run on identity-isolated builds is §11.4.
- **Two repairs ran into other faults.** HO2 failed to build, and two self-review repairs now read a sheet that does not exist
  (`SHEET_NOT_FOUND`).

Specific findings, as worded today, do not repair a cheap one-shot build in one round. A finding has to carry its question context
("the address you asked the summary to go to") and name the offending value.

## 7. Cost per build

Haiku, from the model-call journals (`experiments/tracker-v2/spend.mjs`; every call, including calls whose step later stopped on a fault).

| | capture (per request) | bind (per request) | tracker per build | T1 per build |
|---|---|---|---|---|
| BUILDER-1 (24 requests, 101 builds) | $0.00037 | $0.0027 | $0.0031 once per request, then $0: **$0.00073** at 4.2 builds per request | **$0.00147** |
| held-out (14 requests, 97 builds) | $0.00039 | $0.0042 (s0 $0.0046) | $0.0046 once per request: **$0.00067** at 6.9 builds per request; $0.0046 with one build | **$0.00158** |
| E8 (one spec, 9 builds) | $0.0116 (stored, 2026-10-14) | $0.171 (115 conditions) | $0.020 per build | $0.0149 |

**With one build in hand, which is how the product is used, the tracker costs $0.0046 per build, about 3× T1 ($0.0016)** (review
m6: the $0.00067 figure spreads one request's cost over 6.9 builds, most of them analyst-made controls and the reference, a pool no
person has). The model cost is per conversation, not per build: every re-check of the same build, a repaired build or a live run
costs $0, so the tracker becomes cheaper than T1 from the third check of the same conversation on, and it is the only arm whose cost
does not grow with the number of builds and runs checked. With each build's own words (§11.3), conversations that differ need their
own capture and bind.

**Program spend (journals):**
- Haiku **$1.4723** of the $3 cap:
  - BUILDER-1: $0.4287.
  - E8: $0.3959.
  - Held-out $0.6477, split as: B-H builds $0.0213, B0-H builds $0.0876, H7 repairs $0.1428, and captures, binds and T1 $0.3960.
  - Builder calls are counted here because PREREG-TRACKER-H puts them inside the tracker's budget.
- mercury-3 **350,720 tokens**:
  - BUILDER-1 bind: 149,841, capped after 10 of 24 requests.
  - Held-out author: 4,943.
  - B-M builds: 97,560.
  - Held-out bind: 98,376, capped after 2 of 14 requests.
  - Mercury binds cost 30-37K tokens per request against the 14K planned. Root cause: mercury-3's first bind answer hit the output
    cap (`MODEL_TRUNCATED`) on every held-out request and on 3 of 10 BUILDER-1 requests, and the widened retry re-sends the whole
    prompt. Haiku never truncated (18 of 18 calls ok, held-out s0). That is why both T2-M arms are partial; they are reported, not
    extended. The item stays under D18's 0.5M.
- **After the review (2026-11-04):** the identity canary $0.0030 (14 calls) and the PREREG-TRACKER-H2 re-measure $0.5909, so Haiku
  **$2.0662** of the $3 cap in all. No further Mercury use.

## 8. Capability table vs the simple baselines

The capability number is defective builds caught **before the live run**, with false alarms on verified builds. All arms work on
practice data only.

Revised 2026-11-04 (§11.4): the first two rows are the corrected re-measure and lead; the preregistered held-out rows follow with
their qualifiers. T-lit± is the $0 grep for the person's literals (post hoc, §11.6).

| bed (evidence) | builds (defective / verified) | T0 no tracker | T-lit± ($0 grep) | T1 prose checklist | T2solo, the product (v3) | T2 with G3 (v3) | cost per build: T2 / T1 |
|---|---|---|---|---|---|---|---|
| **held-out, corrected, model-built, own words** (development-grade: the set is open) | 42 (21 / 21) | 4 / 0 | 2 / 0 | 10-12 / **11-12 FA** (K = 3) | **6 / 13 / 6, 0 / 1 / 1 FA** | 5-6 / 0 FA (model pool, key) | $0.0036 per conversation, once / $0.0012 |
| held-out, corrected, all builds, own words | 97 (64 / 33) | 4 / 0 | 23 / 0 | 52-54 / **17-19 FA** | **28 / 37 / 30, 1 / 3 / 3 FA** | | |
| held-out (preregistered; model-built rows given the whole key, B0-H contaminated) | 97 (65 / 32) | 2 / 0 FA | 31 / 0 | 60 / **18 FA** (K = 1) | **37-40 / 1-4 FA** (grounded 30-36) | 35-38 / 1 FA (pool incl. reference and controls) | $0.0046 with one build; $0.00067 over 6.9 builds / $0.00158 |
| held-out, model-built, whole key (upper bound) | 42 (22 / 20) | 2 / 0 | 10 / 0 | 18 / **11 FA** | **13-16 / 0-2 FA** | 13-16 / 0 FA | |
| BUILDER-1 (development; v3 designed here) | 101 (18 / 83) | 7 / 0 | 12 / **43 FA** | 10-12 / **8-13 FA** | 8-10 / **0 FA** (T0+T2: 12) | $0.00073 / $0.00147 |
| BUILDER-1, frozen v1 (preregistered primary) | same | 7 / 0 | 12 / 43 | n/a | 7-9 / 18-26 FA | |
| E8 (development) | 9 (3 / 6) | 1 / 0 | 3 / 3 FA | 3 / **6 FA** (no catch grounded) | 0 / 0 | $0.020 / $0.0149 |

Capture recall against gold lists written before any call:
- BUILDER-1: 80/80, 79/80, 79/80 (the $0 rule 71/80).
- Held-out: 58/58 in all three samples (rule 56/58).
- E8: 28/30 ids with the s0 + rule conditions (Haiku alone 23/30).

Check precision (a failing check means the condition is unmet), adjudicated:
- Held-out, v3 T2solo: 0.82 / 0.72 / 0.75.
- BUILDER-1, v3 T2solo (development): 0.50.
- With G3: 0.82-0.85 held-out, and 0.89-1.00 on BUILDER-1.

## 9. Honest reading

*(As first written. The corrected reading is §00 and §11.4: in the product setting the model-built margin over a $0 grep is +4 /
+11 / +4 builds, and a "+10 on model builds" bar fails in two of three samples.)*

**Logging the person's conditions works, and is cheap.**
- Haiku capture found every gold condition on the held-out set (58/58, three samples) and 79-80 of 80 on BUILDER-1, for about
  $0.0004 per request.
- The $0 rule (every clause is a condition) reaches 0.89-0.97.
- The words are held by pointer, every edit is a version-bound proposal, and only a person confirms or waives. This part is as the
  owner asked, without a DSL or a model judging status.

**Checking against the build helps, but it does not reach the bar.**
- On requests it was never designed on, the shipped tracker catches 35-38 more defective builds than a no-tracker builder. The
  baseline catches 2 of 65, because the builds' own practice runs pass.
- It raises 1-4 false alarms on 32 good builds. A cheap prose checklist reviewing the same conditions catches more (60) but cries wolf
  on 18 of the 32 good builds: on 7 of 12 references, and on 10 of 16 good template builds.
- The preregistered precision rules **H1 and H2 were not met** (0.902 and 0.909 in two of three samples; 1-4 false alarms against a
  bar of 0).
- The condition-level reality is weaker than the build-level number. Roughly one `unmet` in four is about something the build does
  right. 3, 7 and 4 of the 37-40 caught builds (8-19%) were caught only through such a false reason.

**What limits it, in order:**
1. **Binding.** The binder drops a qualifier the person stated in another sentence or clause, such as "new leads", "nobody has
   acknowledged" or "daily". Every held-out false alarm is this.
2. **Expressiveness.** In 13 misses the binder abstained or found no column. In 8 of them the practice data has no column for the
   person's category (state, coast, cc); the gap is in the vocabulary, not the template set.
3. **Weak checks.** In 10 misses a check accepted a mention or a send where the person asked for routing or for particular content.
4. **Practice coverage.** In 5 misses the practice data never contains the case.

G3 (needing three builds) removes most binding false alarms. With one build in hand, which is how the product is used, it is absent.

**Not shown:**
- Anything about live runs. Practice is not live; the live-run checks are built and tested, but not measured.
- Anything on real people's words. The held-out requests were written by a model, and one analyst wrote v3, the held-out gold, the
  worlds and the labels.
- Anything on complex specs. On E8 the template set expresses 12 of 30 ids, and no catch there is grounded.
- That findings help a builder repair. H7 found no effect: 0 of 26 repairs succeeded under any feedback.

**Process faults, none of them scored:**
- Rate limits stopped the held-out run on 2026-10-28; it resumed on 2026-11-04.
- On 2026-11-04 an analysis file (`decide-h.mjs`) was placed in a frozen directory. The freeze check stopped the paid script at the
  B-M step, as designed. The file was moved out (`37032d62`) and the run resumed; no frozen file changed.
- Mercury truncation capped both T2-M arms at partial coverage.
- The E8 second bind sample was not resumed.

**Analyses added after scoring**, all reported beside the preregistered numbers and none changing them:
- the grounded-catch count;
- the per-build label override;
- the miss root-causing.

**Next, cheapest first, each a $0 change to test on a fresh held-out set:**
1. **Carry sentence scope into binding.** The quote's own sentence and the request's scoping clause go into the bind prompt as
   "applies to". Precision needs this rule ahead of any other change.
2. **Fix the two evaluator bugs found here.** Scenario copies must get ids that do not extend the original's (scenario-names), and a
   per-run count must be evaluated per run on the repeat view (evaluator-repeat).
3. **Make an `unmet` a question first, when the product has one build.** Show the evidence with the three-way choice before calling
   the build wrong. The clinical-prescreening precedent in the dossier (§3.5) says the person's correction is the main precision lever.
4. **Add practice columns for the categories people actually use** (state, coast) and **forbid "names it" as a stand-in for "routes
   it"** in the bind prompt's template guidance.
5. **Word repair feedback with its question context, and name the offending value.**

## 10. Reproduce

All $0 (no model call), from the worktree root:

```sh
node experiments/tracker-v2/freeze.mjs --check            # PREREG-TRACKER inputs; drift accepted only where deviations.json records the exact hash
node experiments/tracker-v2/heldout/freeze-h.mjs --check  # PREREG-TRACKER-H inputs
node experiments/tracker-v2/report.mjs                    # §3 BUILDER-1: capture recall, expressiveness, arms per judge file, abstention, T1 cost
node experiments/tracker-v2/adjudicate.mjs score          # §3/§5 condition-level precision (labels: builder1/adjudication-labels.json)
node experiments/tracker-v2/run-e8.mjs score && node experiments/tracker-v2/report-e8.mjs   # §4
node experiments/tracker-v2/heldout/run-heldout.mjs score > /dev/null && node experiments/tracker-v2/decide-h.mjs   # §6 H1-H6
node experiments/tracker-v2/adjudicate.mjs score --dir research/tracker-20261021/heldout       # §6 condition-level precision
node experiments/tracker-v2/spend.mjs                     # §7 every journaled model call
node experiments/tracker-v2/same-statuses.mjs <judge-a> <judge-b>   # v1 / v2 unchanged by later semantics (D2, D3)
node experiments/tracker-v2/explain.mjs --bind <bind file> --build <id> [--heldout] --semantics v3   # root-cause one alarm
node experiments/tracker-v2/remeasure.mjs score > /dev/null && node experiments/tracker-v2/report-h2.mjs   # §11.4 (PREREG-TRACKER-H2)
FOUNDRY_IDENTITY_SHA256=<digest> node scripts/identity-scan.mjs --tracked   # §11.1 (or with CLAUDE_CODE_USER_EMAIL set by the host)
```

**Tests, 2026-11-04 (after the review).** Each file was run alone (`nice -n 15 node --test --test-concurrency=1 <file>`): **82 of 82
pass, 0 skipped** (the 63 below, plus `tests/identity-scan.test.mjs` 4, `tests/claude-cli-identity.test.mjs` 4,
`app/test/tracker/semantics-v4.test.mjs` 7 and `experiments/tracker-v2/test/remeasure.test.mjs` 4). The `src/` change was also checked
against `tests/claude-cli-env.test.mjs` (14), `tests/models-port.test.mjs` (15) and `tests/review-phase1.test.mjs` (10): all pass.

| file | tests |
|---|---|
| `app/test/tracker/checks.test.mjs` | 11 |
| `app/test/tracker/semantics.test.mjs` | 18 |
| `app/test/tracker/service-tracker.test.mjs` | 6 |
| `app/test/mcp-dashboard.test.mjs` | 7 |
| `app/test/service.test.mjs` | 5 |
| `experiments/tracker-v2/test/run-builder1.test.mjs` | 2 |
| `heldout-runner.test.mjs` | 2 |
| `heldout-validity.test.mjs` | 4 |
| `e8-probe.test.mjs` | 1 |
| `decide-h.test.mjs` | 7 (each H rule flips on its stated boundary) |

Re-judging (`run-builder1.mjs judge`, `run-e8.mjs judge`, `run-heldout.mjs judge`) re-runs every build on practice data; it is $0 but
takes 10-40 minutes per bind file on this shared machine (the h2 judges took about 3 minutes per file on 2026-11-04). Model-call
journals (SQLite) stay out of git (`.gitignore`; they can hold the host address from before the fix); when the worktree was removed
they were moved to `/var/tmp/foundry-work/tracker-20261021/journals/<builder1|e8|heldout>/journal/` (and `heldout-h2/`,
`heldout-h2-own-words/` and the identity canary's), where `spend.mjs /var/tmp/foundry-work/tracker-20261021/journals` and replays
can read them. Every output JSON carries its calls' cost and tokens.

## 11. Review response (2026-11-04): fixes, the corrected re-measure, disagreements

The adversarial review of this result found two blockers (B1 privacy, B2 validity), four majors and eight minors. This section
records what changed, with evidence. Nothing above §11 was deleted; corrected statements say so where they stand.

### 11.1 B1: the host account's address was committed (privacy)

- **What.** 36 files under `research/tracker-20261021/` held the host account's own e-mail address (340 occurrences), added by
  commits `224e1b34`, `80469df2`, `f52e2bc3` and `de3cd223`. Commit `3a82635a` replaces every occurrence with
  `requester@example.test`, which has the same length, so byte offsets inside the files hold. The address is never printed here; the
  scan reports it masked (`r***********@gmail.com`).
- **Files changed** (all under `research/tracker-20261021/`): `RESULT-TRACKER.md`; `heldout/adjudication.json`;
  `heldout/bind-claude-haiku-5-5-s2__claude-haiku-5-5.json`; `heldout/capture-claude-haiku-5-5-s2.json`;
  `heldout/judge-v{1,2,3}-claude-haiku-5-5-{s0,s1,s2}__claude-haiku-5-5.json` (9); `heldout/judge-v{1,2,3}-rule__claude-haiku-5-5.json`
  (3); `heldout/judge-v{1,2,3}-claude-haiku-5-5-s0__mercury-3.json` (3); `heldout/prose-claude-haiku-5-5-s0__claude-haiku-5-5.json`;
  `heldout/runs/b0-h/records/{HI1,HL2,HO1,HO2,HW2}.json`; `heldout/runs/repair-none/records/{HI1,HL2,HO1,HO2}.json`;
  `heldout/runs/repair-t1/records/{HI1,HL2,HO1,HO2}.json`; `heldout/runs/repair-t2/records/{HI1,HO1,HO2}.json`. Adjudication group keys
  hash the evidence text, so 8 keys changed: `experiments/tracker-v2/heldout-labels.mjs` is re-keyed (same labels) and
  `heldout/adjudication-labels.json` and `heldout/adjudication.json` regenerated.
- **Hashes that no longer match.** Every one of these files' blob hashes differs from the earlier commits. Inside the tree:
  `judge-v{1,2,3}-claude-haiku-5-5-s2__claude-haiku-5-5.json` record a `bindSha256` of the s2 bind file, and that bind file records a
  `captureSha256` of capture s2; both recorded hashes now point at the pre-redaction bytes. The freeze manifests (`freeze.json`,
  `heldout/freeze-h.json`) do not cover any of the 36 files, and both freeze checks pass.
- **Nothing moved.** After the redaction `run-heldout.mjs score` is identical apart from its timestamp, and `decide-h.mjs`,
  `adjudicate.mjs score --dir heldout` and `grounded.mjs` print byte-identical output.
- **History is not rewritten.** The four earlier commits still hold the address; rewriting the branch is the orchestrator's decision
  (the review proposed `git filter-branch --tree-filter`). The branch is not pushed.
- **Scan.** `scripts/identity-scan.mjs` finds an address by hash only: the identity comes from the environment at run time
  (`FOUNDRY_IDENTITY_SHA256`, or `CLAUDE_CODE_USER_EMAIL` hashed in memory) and is never stored. `--tracked` checks every tracked file,
  `--staged` the staged blobs (usable as a pre-commit hook; none is installed here), `--replace` writes a same-length placeholder.
  Every commit since `3a82635a` was scanned before it was made. Tests: `tests/identity-scan.test.mjs` (4).

### 11.2 B2: host identity reached every Haiku call (validity), root-caused and fixed

- **The first diagnosis was wrong.** §6.4 said the one-shot writer "invents" an address "no input contains". The review showed the
  models took it for the person's own: B0-H HW2's writer asked whether the e-mail should go to it, and capture s2 wrote "Bcc the user
  (<it>)". The earlier BUILDER-1 report had already seen this route put the account address into context
  (`research/surface-20261021/BUILDER-1.md`, compromise register C7), and the fix was left open.
- **Mechanism (observed code and observed behaviour).** In the installed claude 2.1.318 binary, the user context gets a block
  `The user's email address is ${email}. Use it only to identify the user ...`, where the e-mail is the account the CLI keeps in its
  global config (`oauthAccount.emailAddress`, written there at login from `CLAUDE_CODE_USER_EMAIL`, `CLAUDE_CODE_ACCOUNT_UUID` and
  `CLAUDE_CODE_ORGANIZATION_UUID`), or else `CLAUDE_CODE_USER_EMAIL`. `--system-prompt` replaces the system prompt, not this block.
- **Canary** (`experiments/tracker-v2/identity-canary.mjs`, Haiku, 14 calls, $0.0030; records keep hashes and booleans only):

  | child environment | calls | host address returned | file |
  |---|---|---|---|
  | inherited, as every experiment ran | 2 | 2 | `identity-canary-before.json` |
  | without `CLAUDE_CODE_USER_EMAIL` | 2 | 2 | same |
  | without the three identity variables | 2 | 2 | same |
  | without them and with an empty `CLAUDE_CONFIG_DIR` | 2 | 0 | `identity-canary-empty-config.json` |
  | the first draft of the fix (config directory inside the cwd) | 2 | 0 | `identity-canary-after.json` |
  | the final fix (config directory beside the cwd), inherited or given environment | 4 | 0 | `identity-canary-final.json` |

  The model said where it saw it: "userEmail field in the system-reminder" on every leaking call. Removing the variable alone does
  not help, because the stored account answers first. *Erratum:* PREREG-TRACKER-H2 §5 says "12 canary calls, $0.0026". A second run
  of the after-fix canary with the same run id was answered from the journal (ModelPort's crash recovery), so it made no call and
  re-wrote `identity-canary-after.json` with the first draft's two results; the final code was then checked with a fresh journal
  (`identity-canary-final.json`). Real calls: 14, $0.0030.
- **Fix** (`src/models/providers/claude-cli.mjs`; the one `src/` change of this item, narrow and outside `src/runtime.mjs`): by
  default each `claude -p` child gets its own fresh, empty config directory beside its throwaway cwd and none of the identity
  variables; `identity: 'inherit'` restores the old behaviour for an A/B only; the journal records the mode. Calls authenticate as
  before (the host manages the provider). Tests: `tests/claude-cli-identity.test.mjs` (4; a fake CLI that mimics the observed
  behaviour, including the case where removing the variables alone still leaks); `claude-cli-env`, `models-port` and
  `review-phase1` tests still pass. The executor sandbox (`src/executors/claude-code.mjs`) already ran with an allow-listed
  environment and a hidden, empty HOME, so it was not affected.
- **What was exposed.** Every Haiku call of this program went through the leaking route (BUILDER-1, E8 and the held-out set). Where
  it shows: B0-H HI1, HL2, HO1 and HO2 hard-coded the address and HW2 asked about it; capture s2 put it into one summary (HI2 C-005,
  which the binder then marked `inspection`, so no status changed); the H7 repair writer kept it. The B-H and B-M records carry no
  trace of it. The B0-H rows of §6 and all of H7 (§6.4) are **contaminated**; the re-run is §11.4.
- **Re-run evidence.** Rebuilt through the fixed provider, B0-H HI1 is **verified** (its only oracle reason before was the wrong
  recipient), and none of the 14 B0-H2 records holds the host identity (checked by hash per record).
- **Capture summary guard (m3).** `app/core/tracker/model.mjs` now replaces a capture summary that names an address, URL, @handle
  or #channel the person's words never gave by the quote itself, so an invented value cannot reach the bind prompt, T1 or the
  dashboard (`app/test/tracker/semantics-v4.test.mjs`).

### 11.3 M1: the tracker and T1 were given the whole answer key

- **Agreed.** `wordsFor(case)` gives capture, bind and T1 every answer in the key, while a model build only received the answers to
  the questions it asked. Of the 42 model builds of §6, 16 had different words; 12 of them never received an answer the tracker had,
  and all 12 are defective. §6 did not disclose this. **Every model-built number in §6 and §8 is therefore an upper bound "given the
  whole answer key"**, not the product setting; REF and CONTROL are the key's own builds, so the key is their words.
- **Fix.** `experiments/tracker-v2/remeasure.mjs` builds each model build's words from its own conversation (the request, then
  `record.questions[].answer` in the order asked). A build whose answers equal the key's (as a multiset) keeps the key's capture and
  bind, because the input is identical; every other distinct conversation gets its own capture (K = 3) and bind. Test:
  `experiments/tracker-v2/test/remeasure.test.mjs` (a build that asked nothing gets the request only, never a key answer).
- **Corrected set.** With B0-H2 in place of B0-H, 15 of the 42 model builds have their own words (12 distinct conversations).

### 11.4 The corrected re-measure (PREREG-TRACKER-H2; development-grade, the set is open)

Frozen at `331df644` before any of its paid calls; run detached from `experiments/tracker-v2/paid-remeasure.sh` on 2026-11-04. The
disk fell below the 1.2 GB line at 19:26 after the own-words captures; the script stopped as designed (an environment fault, not
scored) and resumed at 19:45 from the files already written. Haiku spend **$0.5909** (B0-H2 builds $0.1028, own-words captures
$0.0188 and binds $0.1108, T1 $0.2556 for 215 calls, H7 $0.1028); the journals agree to the cent. No Mercury call. Outputs:
`heldout/runs/b0-h2/records/`, `heldout/h2/` (`scores-h2.json`, judges, T1 samples, own-words captures and binds, H7 records).
`node experiments/tracker-v2/report-h2.mjs` prints every number below.

**Regression first.** Re-judging the 97 preregistered builds under v3 with the changed code gives the same T2solo status on all 573
(build, condition) entries of s0 (0 differ): D4's code changes leave v3 as it was.

**B0-H2** (the 14 B0-H builds again, identity isolated): 5 verified, 9 defective (B0-H: 4 and 10). HI1 is now verified; its only
oracle reason before was the host recipient. No record holds the host identity.

**Own words:** 15 of the 42 corrected model builds have their own words (12 distinct conversations); the other 27 received exactly the
key's answers.

Capability, per Haiku capture sample s0 / s1 / s2; "model-built" = B-H, B-M and B0-H2 (21 defective, 21 verified); all = 97 builds
(64 defective, 33 verified). Caught / false alarms:

| setting | arm | model-built | all builds |
|---|---|---|---|
| **corr-own (the product setting)** | T0, no tracker | 4 / 0 | 4 / 0 |
| | T-lit± ($0 grep, post hoc) | 2 / 0 | 23 / 0 |
| | T-lit ($0 grep, preregistered) | 2 / 5 | 25 / 8 |
| | T1 prose checklist, K = 3 (and majority) | 10 / 12, 12 / 11, 11 / 11 (maj. 12 / 11) | 52 / 19, 54 / 17, 53 / 19 (maj. 54 / 18) |
| | **T2solo v3** (preregistered product) | **6 / 0, 13 / 1, 6 / 1** | **28 / 1, 37 / 3, 30 / 3** (precision 0.966, 0.925, 0.909) |
| | T2solo v4 (product default) | 5 / 0, 11 / 1, 6 / 1 | 27 / 1, 35 / 3, 30 / 3 |
| | T0 + T2solo v3 | 8, 16, 8 caught | 30, 40, 32 caught |
| corr-key (whole key, upper bound) | T2solo v3 | 12 / 0, 11 / 2, 12 / 2 | 34 / 1, 35 / 4, 36 / 4 |
| | T2 with G3 over the model builds only (m2) | 6 / 0, 5 / 0, 6 / 0 | - |
| | T-lit± | 6 / 0 | 27 / 0 |
| orig-key (the 97 preregistered builds) | T2solo v3 (§6.1) | 15 / 0, 13 / 2, 16 / 2 | 37 / 1, 37 / 4, 40 / 4 |
| | T2solo v4 | 13 / 0, 13 / 2, 15 / 2 | 35 / 1, 37 / 4, 39 / 4 |
| | T-lit± | 10 / 0 | 31 / 0 |

Rules (PREREG-TRACKER-H thresholds, unchanged), product setting corr-own, v3 and v4 alike: **H1 met in s0 only** (0.966; 0.925 and
0.909 fail), **H2 not met** (1, 3, 3 false alarms), **H3 met** (+26, +36, +28 over T0 on all builds), **H4 met against every T1
sample and the majority** (T1 precision 0.73-0.76 with 17-19 false alarms), H5 pointer recall 58/58 on the key captures.

What the corrections did:
- **The answer-key leak (M1) was worth about half the model-built catches.** With the whole key the tracker catches 12 / 11 / 12 of
  the 21 defective model builds; with each build's own words, 6 / 13 / 6. s1 goes the other way: its own-words captures of the
  request-only conversations produced checks that flag b-h and b-m HI2, HS1 and HS2; those 12 unmets are not adjudicated (every one
  falls outside the existing label groups), so they may be grounded or lucky. On the model-built subset in the product setting the
  tracker adds +4 / +12 / +4 catches over T0: **a "+10 on model builds" bar would fail in two of three samples**, as the review
  predicted.
- **The host-identity leak (B2)** made one B0-H build defective (HI1) and shaped three others; it does not change the false-alarm
  picture, which is all binding (ref/HS2's "single daily digest", HL1's "new leads", HO2's "nobody has acknowledged"), as in §6.3.
- **v4** removes 0-2 catches per sample that were caught only through the two evaluator bugs and raises condition-level precision on
  the 97 builds from 0.820 / 0.717 / 0.754 to 0.854 / 0.717 / 0.780 (existing labels; 1 of the 161 unmet entries unlabelled). It removes no
  build-level false alarm: those are binding errors, not evaluator errors.
- **G3 over the builds a person could have (m2)** keeps 0 false alarms but halves the catches (6 / 5 / 6 of 21 model-built).
- **A $0 grep (M4)** catches 2 of 21 model-built defective builds with each build's own words and 6 with the whole key, with no false
  alarm. The tracker's margin over it, in the product setting, is +4 / +11 / +4 builds.

**H7 again, on B0-H2** (exploratory; the contaminated run of §6.4 found 0 of 26):
- t2 (tracker findings, 4 flagged builds): **1 fixed** (HO1), 0 broken, $0.023.
- t1 (checklist findings, 3 flagged builds, 2 of them verified): 0 fixed, 1 broken (HW2: the repair did not build), $0.016.
- none (self-review, all 14): 0 fixed, 1 broken (HI1), $0.064.
- One fix in four is a first positive signal for specific findings, not evidence: n = 4, one round, one writer.

### 11.5 M3: two evaluator bugs, fixed as semantics v4

- **R-copy-names** (`app/core/tracker/scenarios.mjs`): a targeted copy of row "P-1" was named "P-1 S2" (and `scenario2.<address>`),
  so an e-mail about the copy also named P-1. v4 glues the marker to the front ("S2P-1", "s2<address>"): neither name contains the
  other under the word-boundary or the token matcher, and the rest of the text a flow may classify on is kept.
- **R-per-run** (`app/core/tracker/checks.mjs`, `practice.mjs`): a count with no source item ("at most 1 digest e-mail", rendered
  "in one run") was counted over the repeat view, which joins two runs. v4 counts it per run; per-item counts ("each ticket at most
  once") still read both runs.
- **Tests with teeth** (`app/test/tracker/semantics-v4.test.mjs`, 7): each fix changes its case and leaves a real violation unmet (a
  copy routed to the wrong person; two digests in one run; a second reminder on the next day). v4 is the product default; v3 stays
  selectable and is the preregistered product. v1, v2 and v3 are unchanged (deviation D4 / HD1 records the new file hashes; the h2
  re-judge under v3 is the regression check, §11.4).
- **Not shipped as tested.** The review asked for v4 to be tested on a fresh held-out set. There is none yet, so v4's numbers in
  §11.4 are development evidence: both bugs were found on this set.

### 11.6 M4: the simplest baseline, and the over-engineering question

- **T-lit ($0, no model)**: flag a build when an e-mail address, #channel or number of two or more digits in the words is absent from
  the workflow JSON. Preregistered in PREREG-TRACKER-H2 before its paid calls. It flags 8 verified builds whose thresholds are
  encoded as "up to 49.99" for "under $50" or 201 for "over 200", so **T-lit±** (post hoc, commit `26825688`, labelled so in every
  output) also accepts n-1, n+1 and n-0.01. It is the strongest $0 baseline found.
- On the original 97 builds: T-lit 33/65 caught, 8 FA; **T-lit± 31/65 caught, 0 FA** (model-built: 10/22, 0 FA) with the whole key.
  With each build's own words, T-lit± catches **2 of 22 model-built** defective builds. The review's estimate (29/65 with 2 FA;
  10/22 with 1 FA; 2/22 with own words) is confirmed in substance: on model builds, the tracker's margin over a grep came from the
  answers the builders never received. §11.4 gives the corrected comparison.
- **A stronger checker arm** (Sonnet 5.5 or Opus 5.5 xhigh as T1) was not run: the remaining Haiku budget would not cover it, and it
  belongs in the next preregistration with a fresh set (§11.8).

### 11.7 Minors

| # | finding | done |
|---|---|---|
| m1 | H5 measures pointer recall, not meaning | Renamed in §6.1 ("pointer recall"); meaning is not scored. |
| m2 | G3 pooled the reference and the controls | G3 recomputed over the model builds a person could have (B-H, B-M, B0-H2) per request, §11.4. |
| m3 | capture summaries not checked for invented values | Fixed (§11.2): a routing literal not in the words is replaced by the quote. |
| m4 | one analyst labelled all 126 groups | **Not done.** A blind second labeller and agreement remain open; no new labels were written for §11.4. |
| m5 | T1 was one sample in H4 | T1 run K = 3 on own words (§11.4); H4 is checked against every sample and the majority. |
| m6 | per-build cost understated | §7 now leads with $0.0046 per build with one build in hand (about 3× T1). |
| m7 | missing tests | Added: own-words input, provider identity canary (fake CLI) and the paid canary script, both M3 regressions, T-lit. |
| m8 | 11 MB of judge JSON committed | **Disagree, kept.** They are the raw evidence the adjudication keys and the redaction check re-derive from; git stores them compressed. The h2 outputs keep the same compact evidence (2 items per status). |

### 11.8 Disagreements, deferrals and what is next

- **History rewrite (B1 step 1): deferred, not done.** Rewriting the branch is the orchestrator's decision; the redaction is a new
  commit and the four earlier commits still hold the address (§11.1).
- **"A config dir or home with auth only" (B2 step 1): done without auth in it.** Copying the login into a new directory would copy a
  credential file, which the working rules forbid. It was not needed: with an empty config directory the calls still authenticated
  (the host manages the provider) and the address was gone.
- **m8: kept** (§11.7). **m4: open** (no second labeller).
- **v4 on a fresh held-out set (M3): not possible yet.** v4 ships as the product default because both changes are evaluator bug fixes
  with tests in both directions; its numbers here are development evidence.
- **Next, cheapest first:** (1) a fresh held-out set with real people's words (or at least a second author family), the product
  setting (own words, one build) as the primary, preregistered with T-lit± and a stronger-checker arm (Sonnet 5.5, and Opus 5.5
  xhigh if the budget allows) as baselines; (2) carry each sentence's scope into binding (§9, still the main precision lever); (3)
  word repair findings with their question context; (4) a blind second labeller for the adjudication.
