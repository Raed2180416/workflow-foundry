# BAR-SET: the enterprise bar, selected and broken down into L0/L1, with the gap table

*Final version, 2026-10-14, about 13:50 UTC, branch `claude/intelligent-hamilton-vg1f9a` at `48ac5d1`. Built from
[CATALOGUE.md](CATALOGUE.md) (Part A proprietary, Part B OSS). It merges the bar-set draft with the corrections of the
adversarial critique and a consolidation re-check; §8 lists every change. The bed that measures this set is
[E-BED.md](E-BED.md). PROOF-LEDGER §L holds the claims.*

*$0 throughout: no model calls of our own, nothing installed or built, `beds/sealed/` and credential files not read.
Web, corpus and clone text was treated as data. Item numbers A# and B# refer to CATALOGUE.md.*

**Evidence tags.** [doc] documentation opened (file:line when local); [code] code read in a local clone; [data] a number
measured from a downloaded log; [web✓] a regulation or page re-opened in the consolidation pass; [M] counted or computed
here; [I] inference or estimate; [unavail] tried and not obtained; [cat] taken from CATALOGUE.md without re-checking.

**What "the bar" means here, stated honestly.** The owner's bar is "the most complex workflows the biggest orgs use".
What public material lets us build and grade exactly is the **documented rule-and-deadline core** of those workflows: the
decision tables, clocks, correlation, approvals, reversals and compensation that the platforms' documentation and the
regulations specify. Tenant configuration, master data and integration effort are not public. This set therefore
measures whether cheap models can construct and run that core, at documented semantics and stated scale. It never
supports a claim of parity with a running D365, SAP, ServiceNow, Visa or CMS product (critique 4, 6).

---

## 0. The answer in brief

| id | workflow | broken down from | C / D | oracle anchor | realism | simple baseline (must fail the tail) | open engine gaps | role |
|---|---|---|---|---|---|---|---|---|
| **E1** | P2P invoice verification: 2/3-way match, 9-field unit price, cumulative price totals, tolerance hierarchy, holds, invoice before receipt, payment blocks | D365 AP [doc]; Oracle EBS holds, SAP J45 [cat] | 4/5 | D365 tolerance tables and cumulative example (`accounts-payable-invoice-matching.md:66–133`) | BPI 2019: 251,734 items, 11,973 variants, p90 case 90 business days [data] | Camunda 7 invoice demo (7 nodes, 8 DMN rules) | state, G1, G5, G6, G7, G9, G12, G13, G17, G19 | core, pilot |
| **E2** | O2C: credit blocking and hold list, ATP, collections and dunning | D365 credit, ATP, collections [doc]; SAP 1QM [cat] | 4/5 | 5 credit-limit scenarios; 3-run collection-letter example; ATP fence example | none public | limit-only credit check | state, G1, G3, G5, G7, G8, G13, G15, G16, G17, G18 | core |
| **E3** | Group record-to-report: intercompany chains, close-task DAG, consolidation with eliminations | D365 intercompany, GL, close workspace [doc] | 4/4 | elimination rules (descriptive) → hand-derived cases; W-bed R4 oracle | W-bed R4 world | R4 reference without dependency gating | G4, G6, G7, G8, G10, G12, G14, G15, G18 | core (composes E1, E2) |
| **E4** | KYC/CDD of legal entities with sanctions screening, then AML alert → case → SAR | 31 CFR 1010.230, 1020.320 [web✓]; OFAC scoring [cat]; Moov Watchman [web✓] | 5/4 | rule text; N-version oracles; labels exact by construction | none | exact-name screening | state, G1, G2, G3, G5, G7, G9, G12, G13, G15, G17, G18 | core |
| **E5** | Debit-card dispute: Reg E error resolution, then network-X chargeback, pre-arbitration, arbitration | Reg E §1005.11 [web✓]; Visa Core Rules §11 re-expressed [cat] | 5/5 | rule text; N-version oracles; hand-derived timelines across holidays | none | keyword → condition; calendar days everywhere | state, G1, G2, G3, G5, G10, G12, G15, G16, G17, G18, G19, compensate | core |
| **E6** | Medicare professional claim 837P → 835: PTP, MUE, add-on edits, pricing, accumulators, CARC/RARC | CMS NCCI, PFS, remittance pages [cat] | 5/5 | N-version pricing; 835 balancing identity | none | single-pass pricing, no edits | state, G10, G12, G13, G15, G17, G18, G19 | core |
| **E7** | ITSM incident → problem → change with SLA clocks, CAB approvals, conflict detection | ServiceNow SLA, change model, conflicts [cat]; WorkArena validator [code] | 4/4 | SLA timelines (pure function of history); WorkArena validator cases | BPIC 2014 [unavail] | 24×7 clock, no pause | state, G2, G3, G4, G7, G8, G14, G15, G16, G17 | core, pilot |
| **E8** | Order-fulfilment saga: per-location fulfilment, charge, child shipment, signals, reverse-order compensation | Temporal reference app [code]; Camunda trip saga [code]; Coinbase structure [cat] | 3+/4 [I] | trip-saga compensation structure → hand-derived failure-point cases | none | the reference app as written (no compensation) on a declared Temporal platform profile | G1, G2, G6, G8, G14, G19, compensate | core, pilot |
| **E9** | Consumer loan origination with multiple offers, incomplete-file rework, ~30-day offer expiry, fraud review | BPI 2017 and 2012 [data] | 3/3 | synthetic rulebook, exact on itself; log conformance descriptive | 31,509 applications; p90 case 25 business days [data] | happy-path workflow covering the top variant | G2, G3, G5, G7, G9, G12, G15 | core |
| E10 | Policy-constrained customer service (airline, telecom dual control) | tau2-bench [code] | 3/3 | exact DB end-state, action and communicate evaluators only | 2,285 telecom tasks | Haiku agent with the policy in its prompt | session | optional anchor |
| E11 | Mortgage loss mitigation and foreclosure dual tracking | Reg X §1024.41 [cat] | 4/5 | regulation text, per-day legality | none | calendar days, no pending-application bar | G1, G2, G5, G15, G16 | library-unseen reserve |
| E12 | SEPA credit-transfer R-transactions (recall, return, inquiry) | EPC135-18 v6.0 [cat] | 4/4 | message type, reason code, date, correlation | none | first-match reason codes, calendar days | G1, G2, G15, G16 | library-unseen reserve |
| E13 | Payroll gross-to-net with yearly editions | IRS Pub 15-T Worksheet 1A [cat] | 4/5 | worksheet arithmetic | none | latest-edition, single filing status | G18 | library-unseen reserve (drift) |
| E14 | O2C deductions chain: short-pay → deduction → match, split, deny or write-off → collections | D365 trade allowance and deduction workbench [doc] | 4/3 | thin; admission pending sourcing | none | write off everything | G1, G12, G13, G17 | candidate (cross-functional) |
| E15 | P&C claim FNOL → settlement with statutory clocks | NAIC Model 902, Guidewire exposures [cat] | 4/4 | clocks exact; settlement by multi-annotator, abstain-aware truth | none | — | G1, G2, G3, G5, G7 | candidate (judgement; reported separately) |

1. **Nine core items (E1–E9) carry the family-level decision.** Every construct class the owner's bar names is
   exercised centrally by at least two of them (§4), except genuine saga compensation, which only E8 exercises centrally
   (E1, E2, E3, E5 exercise business reversals). No core item needs L0 rows 13 (`wide`), 14 (`plan`) or 30 (`stream`).
2. **E10 is an optional external anchor**, the only item with third-party results on the same oracle, at the price of a
   non-policy user simulator (§2.1).
3. **E11–E13 are library-unseen reserves**: the new library cards (P58–P60) are written without them, so they measure
   whether library-first construction generalises beyond the items the cards were shaped on (critique 5).
4. **E14 and E15 answer the selection-bias objection** (critique 6): E14 is an end-to-end cross-functional chain, E15 a
   judgement-heavy item whose truth needs a multi-annotator protocol. Both are candidates; neither enters the
   family-level test.
5. **Each item is a rulebook plus a world generator, not a workflow file** (the fix for B13): a re-expressed public
   rulebook; golden tests from public worked examples; a seeded world generator with a difficulty dial and a rule-edition
   knob; a reference transition function as the exact oracle; scripted actors. Families are seeds × parameters ×
   editions.
6. **The real bar sits in the envelope, and it reorders the engine column** (§5): `state` → one durable correlated wait
   node with a timer race → human-task completion (timeout routing, roles, lifecycle) → `compensate` with idempotent
   effects → envelope multi-instance, child and cancel → instance query and sweeps → in-flight versioning. `session`,
   `admission` and `stream` drop off the core bar's path. Seven new gaps are proposed (G15–G21); the two largest, a
   pausable calendar clock (G15) and decision tables with hit policies (G17), are L1 patterns buildable now at tier S.
7. **Honest limits.** Oracle validity is strong for E1 and E2, partial for E3, E6 and E7, thin for E4 and E5 (they need
   two independent oracle implementations), and E9's rules are synthetic. Every rulebook exceeds the 8K constructor cap
   (Visa §11 alone is about 72K tokens [M]), so rule rows are data and the constructor builds the interpreter; claims
   must say so. Decompositions below are one labeller's; a second labeller is needed before any coverage share is quoted.

---

## 1. Selection rules, and why this avoids B13

**Why B13 fired** (DEV-NOTES D21; DESIGN-STREAMS §1.2): the unit was one hand-written workflow with a hand-made oracle;
conformance worked only at τ = 1 with per-item declarations; of 1,559 items only 4 families had at least 3 members with
an oracle; the most complex items produce prose. Part B's executable models are smaller still (medians 2–6 nodes,
maximum 88), so replicating them fails the same way.

**Inclusion criteria (hard filters for the core):**
- (i) complexity a large organisation actually runs: Part A C ≥ 4, or Part B C = 3, or a real log with ≥ 1,000 variants;
- (ii) each item adds at least one construct class no earlier item covers well;
- (iii) an exact oracle can be built from public semantics (Part A D ≥ 4) or from a real log plus stated rules;
- (iv) the licence allows a re-expressed rulebook; otherwise synthetic numbers, with the real-number variant kept local.

Ties went to items that reuse W-bed code (`beds/wbed/lib`: fx, parties, dialects) and the R4 composition.

**What these filters cost (critique 6).** Filter (iii) excludes judgement-heavy and cross-functional processes whose
truth is not computable from public text: P&C settlement (A9), prior authorisation (A10), and, by inference, CPG
deductions, telecom order fallout, payment investigations, corporate actions and engineering change. Decision tables
(P58) are central in 8 of 9 core items, which is where commercial rule engines already do well and construction has the
least room to add value. E8 layers our own saga specification on a demo app, and E9's rules are synthetic. Hence the
title "documented rule-and-deadline core", the two candidates E14 and E15, and the scope statement in §0.

---

## 2. The bar set

### 2.1 Core and optional anchor

| id | systems broken down | C / D | licence position | oracle and golden tests | realism calibration | simple baseline |
|---|---|---|---|---|---|---|
| **E1** | D365 AP [doc]; Oracle EBS holds and SAP J45 [cat] | 4/5 | D365 docs CC BY 4.0; BPI 2019 CC BY 4.0 | Per-line check statuses, holds, approvals, postings, releases. Goldens: `accounts-payable-invoice-matching.md:66–133` (tolerance tables, nine-field unit-price table, cumulative example) and `three-way-matching-policies.md` examples [doc] | BPI 2019 categories, variant curve and durations [data] | Camunda 7 invoice demo; one Haiku call per tick |
| **E2** | D365 credit management, ATP, collections [doc]; SAP 1QM outline [cat] | 4/5 | CC BY 4.0 | Hold reasons per order and checkpoint, release events, promise dates, letter codes, fees. Goldens: 5 credit-limit scenarios (`Credit-limit-scenarios.md:25`), 3-run collection example (`process-collection-letters-example.md:31–33, 110, 129`), ATP fence example (`delivery-dates-available-promise-calculations.md:54–60`) [doc] | none public | limit-only credit check; one Haiku call per tick |
| **E3** | D365 intercompany, GL, close workspace [doc] | 4/4 | CC BY 4.0 | Elimination set exact, group totals conserved, task-gating legality. `elimination-rules.md:53–62` is descriptive, so numeric cases are hand-derived [I] | W-bed R4 world (B4) | R4 reference without dependency gating |
| **E4** | 31 CFR 1010.230 and 1020.320 [web✓]; OFAC tool description [cat] | 5/4 | US regulation; synthetic watchlist | Owner set, required verifications, hits under our published scorer, SAR due dates, case grouping; labels exact by construction | none | exact-name screening; one Haiku call |
| **E5** | Reg E §1005.11 [web✓]; Visa Core Rules §11 [cat]; Pega Smart Dispute [unavail] | 5/5 | Visa forbids duplication, so a synthetic "network-X" rulebook; Reg E public | Condition, validity, every action date in its window, provisional-credit handling, final liability; two independent implementations plus hand-derived timelines (no public numeric worked examples [I]) | none | keyword → condition; calendar days everywhere |
| **E6** | CMS NCCI, PFS and remittance pages [cat] | 5/5 | CMS public [I]; CPT descriptors AMA-licensed → synthetic or HCPCS-like codes | Exact cents and codes per line and remittance; billed = paid + Σ adjustments [I] | none | single-pass pricing without edits |
| **E7** | ServiceNow SLA API, change model, conflict detection [cat]; WorkArena [code]; BPIC 2014 [unavail] | 4/4 | ServiceNow docs as semantics only; WorkArena Apache-2.0 | Exact elapsed, business-elapsed, breach timestamps; legal transitions; conflict set; schedule checks ported from `manage_change_request_schedule.py:183–289` [code] | landing page only | 24×7 clock without pause; one Haiku call |
| **E8** | Temporal reference app [code]; Camunda trip saga [code]; Coinbase swap structure [cat] | 3+/4 [I] | MIT; Apache-2.0 | Final effect ledger: all-or-nothing, compensation set and order, idempotency under timeout-after-commit, duplicate and out-of-order events | none | the app as written, on the declared Temporal platform profile (it has no compensation; see E8) |
| **E9** | Dutch bank, BPI 2017 (BPI 2012 as second log) [data] | 3/3 | 4TU General Terms; distributions only, log kept local | Synthetic rulebook, exact on itself; conformance descriptive | 31,509 applications [data] | happy-path workflow covering the top variant |
| E10 | tau2-bench [code] | 3/3 | MIT | DB end-state, action and communicate evaluators are exact; the NL-assertion and auth-classifier evaluators are model-judged (`evaluator/evaluator.py:36`, `auth_classifier.py`) [code], so only the exact ones are used | 2,285 telecom tasks | Haiku agent with the policy in its prompt |

**Why E10 is optional.** tau2's default user simulator is a model (`src/tau2/config.py:18`,
`DEFAULT_LLM_USER = "gpt-4.1-2025-04-14"`) [code], which is not in our policy file. Swapping in a policy-file model
breaks comparability with published leaderboards, and an LLM user is neither deterministic nor $0. Keep E10 only if the
owner values that partial comparability.

### 2.2 Library-unseen reserves (critique 5)

The library cards P58–P60 (§3) must be written blind to the bar. E11–E13 are held out of that authoring and of the
card fixtures, so arm (g) on them measures generalisation of the library rather than fit to the items it was shaped on.
They are smaller worlds (tier S only) and are not in the family-level test.

| id | item | why it is a good held-out | decomposition |
|---|---|---|---|
| E11 | Reg X §1024.41 dual tracking (A6) | exact public clocks (5 business days, 30, 14/7, 120-day delinquency) and per-day legality; same deadline-and-legality shape as E5 | P60 clocks (business days), P58 legality table, P33 application arrival (G1), G2 sale-date race, P42 |
| E12 | SEPA R-transactions (A12) | 15 / 10 banking business days, ≥ 31 reason codes, same-channel rule; correlation by original message | P58 reason codes, P60 TARGET2-style calendar (G16), P33 + G1 correlation, G2 response deadline |
| E13 | Payroll 15-T (A7) | exact yearly editions; pure drift test of G18 | P58 rate schedules by edition, row 2 arithmetic, P12 per employee, G18 |

The EPC licence (E12) was not reviewed; E12 ships re-expressed rules only.

### 2.3 Candidates answering the selection bias (critique 6)

**E14. O2C deductions chain (cross-functional).** D365 trade allowance management describes the chain: promotion
claims are approved and passed to A/R as deductions (`trade-allowance.md:24–25`), customers short-pay invoices in
anticipation, the A/R clerk registers short-pays as deductions in the payment journal, and the collections manager
settles deductions against open credit notes on the Deduction workbench (`:162–176`) [doc]. The form names show match,
split, deny and write-off operations (`:7`, `TAMDeductionParmMatch`, `…Split`, `…Deny`, `…WriteOff`) [doc]. The public
semantics are an overview (D = 3), so E14 is admitted only if a second source fixes matching and write-off rules; it would
compose E2 (collections), E1-side credit memos and an E5-like dispute sub-process [I].

**E15. P&C claim FNOL → settlement (judgement).** NAIC Model 902 clocks are exact; exposure creation is documented;
settlement value is adjuster judgement (A9). Truth for judged fields comes from a multi-annotator protocol with an
abstain option: items where annotators disagree become "undecidable → must escalate" (the W-bed R2 rule). Same-family
model annotators are correlated, so at least one human annotation pass by the owner is needed before any claim. Reported
separately; never pooled with E1–E9.

### 2.4 Scope statement

The nine core items were selected, not sampled. Results on them support statements about these nine documented
processes at the stated scale, and nothing about "enterprise workflows in general" (critique 13).

---

## 3. Decompositions

L0 rows are numbered as in L0-VOCABULARY; L1 ids as in L1-PATTERNS (highest existing id P57). **Three new candidate
patterns** are proposed (ids are never reused):
- **P58, decision table**: hit policy (UNIQUE / FIRST / PRIORITY / COLLECT / ANY), precedence levels, effective-dated
  editions, static gap and overlap checks. Rows 2 + 4 + 5; tier S.
- **P59, compensation planner**: a pure function from a failure point (and the committed-step set) to the undo set and
  its order. Rows 2 + 5; tier S.
- **P60, obligation clock**: a pure solver computing named obligations with anchors, due dates, pause intervals and
  breach state, plus an envelope half that sets and cancels durable timers. Rows 2, 5, 18, 19, 27.

Their cards must be authored from sources outside the bar (the OMG DMN hit-policy semantics, the Kogito DMN examples
with 58 UNIQUE / 4 FIRST / 2 COLLECT / 1 PRIORITY / 1 ANY [cat B17], Temporal and Camunda saga documentation) by a
session that has not seen E1–E13 (critique 5; E-BED §8 step 1).

These decompositions are one labeller's design labels, the weakness AUDIT-L1 found in the census. A second labeller is
required before any coverage share is quoted.

### E1. P2P invoice verification
- **Semantics** [doc, `articles/finance/accounts-payable/`]:
  - invoice-totals matching (`accounts-payable-invoice-matching.md:48`);
  - price-totals matching (:62): the invoice line's net amount plus all pending and previously posted invoice lines,
    against the **PO line's net amount** (:63); % and/or amount tolerance, a discrepancy **if either exceeds** (:81);
    legal-entity tolerance "15% or 500.00" in the example (:114–133);
  - net-unit-price matching over **nine line fields** (:96): unit price, price unit, charges, discount, discount %,
    multiline discount, multiline discount %, net amount, net unit price; tolerance by item, item group, vendor, vendor
    group, item+vendor or legal entity;
  - three-way quantity matching (:135), charges matching (:160);
  - the policy hierarchy and PO-line override (`three-way-matching-policies.md`);
  - background product-receipt auto-matching, hourly or daily, with a maximum attempt count
    (`submit-invoice-workflow-automatically.md:35`).
- **The golden that pins the reading.** Under the documented reading, invoice 1 (8,640.00) passes against the PO line net
  of 10,000.00; under the naive reading "expected = invoiced qty × PO price" it fails (8,000.00 expected, variance 640 >
  500). Invoice 1 alone discriminates the two readings [doc, re-derived this pass].
- **Complexity** [I unless tagged]: about 12 line states and 5 invoice-header states over PO item, receipts, invoices and
  payment; about 10 decision points; 20–60 tolerance and policy rows per world; 4 human-task types (approve posting with
  discrepancies, invoice approval, manual hold release, vendor dispute); 2–3 timers (periodic unblock batch, payment and
  discount dates, approval timeout); 3 reversal documents (BPI 2019: Cancel Goods Receipt 3,096, Cancel Invoice Receipt
  7,096, Vendor creates debit memo 6,255 [data]); payment blocks (Remove Payment Block 57,136, Set Payment Block 124) and
  service entry sheets (164,975) [data]; 4 external parties (vendor, warehouse, ledger, bank).
- **Real variety** [data]: 42 activities, 11,973 variants; invoice-before-GR 221,010 items / 7,832 variants; after-GR
  15,182 / 4,228, longest case 990 events; Change Price 12,423 and Change Quantity 21,449 drive re-match loops. Case
  duration median 46 business days, p90 90, p99 157; 57.6% of items run longer than 40 business days.
- **Solver (tick)**: P03 invoice documents (judge with quote check); P16 duplicates (fuzzy vendor and invoice-number
  match, borderline band → judge); P17 PO line ↔ receipts ↔ invoice lines (E1 is P17's first real anchor); P58 policy
  and tolerance resolution at 4 levels plus the PO-line override; P12 over lines and P15 for invoice totals; P08 hold
  before posting; P09 undecidable reads and near-duplicates; invariant Σ matched + Σ held = Σ invoiced per line; the
  cumulative price total read from P42 state.
- **Envelope**: trigger P37/P38 (rows 24, 26, HOST); P33 invoice-before-GR waiting for the receipt by PO item (row 19 N +
  G1); P32 approve posting with discrepancies (row 16, timeout routing N); P36 periodic unblock and auto-match sweeps
  (row 25 + G13); P42 cumulative matching and seen invoice numbers (row 27 N); P53 per PO line (G6); P27 error routes;
  reversal documents as effects (row 15), not true compensation.
- **Lacks**: G1, G5, G6, G7 (requester ≠ approver [I]), G9, G12, G13, G17, G19 (duplicate payment).
- **Difficulty dial**: d1 2-way single receipt; d3 3-way, partial receipts, cumulative tolerance, charges; d5
  invoice-before-receipt with waits of days to months, 4-level overrides, mid-flight price and quantity changes,
  duplicates, more than 500 lines.

### E2. O2C credit, ATP and dunning
- **Semantics** [doc]: credit blocking (`cm-sales-order-credit-holds.md`): 7 rule types (:47–143), rank triggers
  (:161–181), sequencing Table → Group → All with exclusions (:182–197), hold-list release with or without posting and
  reject (:205–241), automatic release (:242), approval workflow (:257), forced holds (:265). Credit limits: 5
  group-versus-individual scenarios (`Credit-limit-scenarios.md:25`). ATP
  (`delivery-dates-available-promise-calculations.md`): re-promise only when the date can no longer be met (:29–32),
  cumulative with look-ahead (:36), never negative (:52), fence 7 days and offset 1 day (:54–60). Dunning
  (`process-collection-letters-example.md`): fees 0/20/50, minimums 0/10/100, days block 2/3/15 (:31–33); the "ignore
  payments and credit memos" switch gives header code 1 against line code 2 (:110), both 2 when off (:129). Collections
  automation (`collections-process-automate.md`): steps relative to the leading invoice's due date, pre-dunning (:29),
  pool rank (:33), quiet days (:35), track step (:41).
- **Complexity**: about 14 order, 6 hold-list and 5 collection states [I]; per checkpoint 7 rule types × 3 levels + 2
  rank triggers + the effective limit; 20–50 credit rules and 3–8 collection steps per world [I]; 4 human-task types; 5–6
  timers; 2 reversals (reject cancels the order; fees waived or reversed); 5 external parties.
- **Solver**: P58 for credit rules, collection steps and letter codes; row 2 for the effective limit and cumulative ATP;
  row 4 guards (forced hold never auto-released; an unknown rule type deopts); row 5 invariants ("Multiple" iff ≥ 2
  reasons; the hold list equals orders with an active reason); P12 per customer over the leading invoice; P04 letter
  draft → envelope; P07 + P09 disputed-invoice emails (optional DU).
- **Envelope**: P38/P37 triggers; P32 release approval; P10 hold-list menu; P36 evaluate-for-release, collections runs
  and interest notes; P34 quiet days and days block (row 18 > 1 h, N); P33 payment arrival (19 + G1); P42 exposure,
  letter position, history and last contact; G8 (the hold list is a query over open instances).
- **Lacks**: G1, G3, G5, G7, G8, G12, G13, G15, G16, G17, G18 (10.0.35 mandatory blocking rules, 10.0.43 intercompany
  exclusion).

### E3. Group record-to-report
- **Semantics** [doc]: close-task DAG with dependencies blocking completion, past-due flags and owners by company and
  area (`financial-period-close-workspace.md:33–48, 67–90`); elimination rules with effective and expiry dates, wildcard
  accounts, net change versus fixed amount (`elimination-rules.md`, example :53–62); intercompany and AP-matching
  interplay (`invoice-matching-intercompany-purchase-orders.md:17–23`); intercompany mirroring and returns [cat]; 23
  intercompany doc files not read.
- **Complexity**: about 8 states per intercompany pair; 20–60 close tasks; 5–20 elimination rules [I]; 3 human-task types;
  due dates per task; 1–2 reversals; N ledgers, an FX source, reporting.
- **Solver**: P54/P53 calling E1 and E2 entity slices by hash (the W-bed R4 shape); P17 due-to ↔ due-from; P16
  counterparty names; P58 eliminations by edition date; row 2 FX translation (reuse `beds/wbed/lib/fx.mjs`); P15
  statements; row 5 invariants (eliminations net to zero; group conserved); the A15 rounding rule (remainder to the last
  line) as a golden.
- **Envelope**: close DAG as G6 (multi-instance with dependency completion) + G7; P32 elimination approval; P36 closing
  schedule; mirrored documents as G12; cancel/change propagation from the original sales order as G14/G4 [I].
- **Lacks**: G4, G6, G7, G8, G10, G12, G14, G15, G18.

### E4. KYC/CDD with screening, then AML → SAR
- **Semantics** [web✓]: 31 CFR 1010.230(d): ownership ≥ 25% (up to four individuals), control prong exactly one
  individual, trustee for trusts at ≥ 25%; (e)(2) 16 excluded categories; (e)(3) control prong only for pooled vehicles
  and nonprofits; (h) exemptions including POS retail credit up to $50,000. 31 CFR 1020.320: $5,000 threshold; file
  within 30 calendar days of initial detection, plus 30 if no suspect is identified, never beyond 60; immediate telephone
  notice for ongoing violations; five-year retention. OFAC-style screening [cat]: prefilter, whole-name Jaro-Winkler,
  part-wise Jaro-Winkler + Soundex, maximum.
- **Complexity**: about 16 states and 10 decisions; 16 exclusions, 20–40 risk rows, 10–20 synthetic detection
  scenarios; 5 human-task types (L1 disposition, L2, senior approval, customer document request, SAR approval); 3–4
  timers; 4–5 external parties.
- **Solver**: P03 certifications and registry extracts; P12 over ownership layers with row 2 products of percentages;
  P07 by entity type; screening as P16-style blocking then code scoring, band → P09 review with quotes; P58 risk rating
  and EDD; P16/P17 alerts → cases; P60 SAR clock.
- **Envelope**: P55 document requests with a G9 loop; P33 document arrival racing an expiry (G2); P09 queue with
  four-eyes (G7); P32 senior approval; P38 rescreen on list update (G13 sweep); P42 screening history and links; P60.
- **Lacks**: G1, G2, G3, G5, G7, G9, G11, G12, G13, G15, G17, G18 (list versions).
- **Independent implementation**: Moov Watchman (Apache-2.0; Jaro-Winkler at `minMatch=0.80`; 472,477 OpenSanctions
  Pairs records) [web✓] is a candidate black-box second scorer and a "product" for E-BED's configure track; any
  container run needs owner approval under D5 and an acquisition record.

### E5. Debit-card dispute lifecycle
- **Semantics**: Reg E §1005.11 [web✓]: notice within 60 days of the statement; investigate in 10 business days (20 for
  transfers within 30 days of the first deposit); or provisionally credit within 10 (20) business days and finish within
  45 days (90 for transfers not initiated within a state, POS debit-card transactions, or new accounts); up to $50 may be
  withheld for suspected unauthorised transfers; notify of the credit within 2 business days; report within 3 business
  days of finishing; correct within 1 business day; before reversing a provisional credit, notify and honour items for
  5 business days. Network-X [cat, re-expressed]: 23 conditions in 4 categories; filing limits such as 120 days;
  pre-dispute waits of 15, 30 or 60 days; pre-arbitration within 30; response within 30; arbitration within 10;
  regional overrides; 153 numbered tables. Debit only; Reg Z §1026.13 and Reg E §1005.6 not opened [unavail].
- **Complexity**: about 18 states; 23 conditions × validity, a credit check, 3 pre-arbitration options; 100–200
  re-expressed rule rows [I]; 4 human-task types; 8–10 concurrent clocks; 2–3 reversals (provisional credit with notice
  and honouring; chargeback; re-presentment); 5 external parties.
- **Solver**: P07 narrative → condition with quote check and a `none` option, P09 on undecidable cases; P58 eligibility,
  invalid disputes and limits (regional > global; edition by processing date); P60 anchors ("later of" processing and
  expected delivery dates; business vs calendar days per jurisdiction; new-account switch); P16/P17 credits ↔ sales; P03
  evidence documents.
- **Envelope**: P37 intake; P55 questionnaire; P33 acquirer response correlated by case or ARN (G1) racing its deadline
  (G2); P34 pre-dispute waits (G5); P32 arbitration filing; P30 provisional credit → reversal (row 23 N) with the notice
  and honouring preconditions; P42 case history.
- **Lacks**: G1, G2, G3, G5, G10, G12, G15, G16 (e.g. a 2-business-day regional override), G17, G18, G19, row 23.

### E6. Medicare claim adjudication
- **Semantics** [cat]: front-end edits; PTP edits with modifier bypass; unit limits (MUE); add-on edits; RVU × GPCI × CF
  pricing (snippet-only, so spec-E states it); deductible and coinsurance accumulators; coordination of benefits;
  group/CARC/RARC per adjustment; provider-level interest on late clean claims; quarterly editions.
- **Omitted for now** [I, critique 8]: multiple procedure payment reduction, MUE adjudication indicators, sequestration,
  global surgery. Each omission is listed in the semantics ledger (E-BED §2.11) and in every claim.
- **Complexity** [I]: about 8 claim and 5 line states, about 6 decisions per line; synthetic tables of 1,000–5,000 pairs at
  base, **10⁵–5 × 10⁵ at the scale tier** (the real hospital PTP file v323r0 has 475,042 records, critique [doc]); 500–2,000
  unit limits; 100–300 add-on rows; about 100 localities; 1–2 human-task types; 2–3 timers; 1 void-and-replace; 4
  external parties.
- **Solver**: P01 spine (front end → edits → pricing → accumulators → remittance); P03 X12-like parse; P12 per line; P58
  pairs, limits and add-ons with editions; P15 835; row 5 balancing; P16 duplicates; P42 accumulators.
- **Envelope**: P36 cycles; P33 pend and documentation; P09/P32 medical review; G13 one EFT per remittance and PLB; P60
  prompt-pay interest.
- **Lacks**: G10, G12, G13, G15, G17, G18, G19. Mostly mechanical: it tests construction of a correct multi-stage rule
  engine, not judgement.

### E7. ITSM incident → problem → change with SLA
- **Semantics**: SLA start/pause/stop/resume/reset/cancel, retroactive start and pause, schedule source, time zone from
  5 sources [cat]; change states New(−5) … Canceled(4), standard changes skip Assess and Authorize, revert-to-New cancels
  approvals, cancel disabled in Review [cat]; 7 conflict types [cat].
- **The WorkArena schedule rule is not ServiceNow semantics.** Risk → duration (3/2/1 days within ±5%) is WorkArena's
  compositional-task policy (`manage_change_request_schedule.py:232–235`), and its comment at :210 says 20% [code]. E7
  uses it as a stated reading labelled "WorkArena task policy", never as ServiceNow behaviour, and it carries no drift
  family or latent defect.
- **Complexity**: about 7 incident, 6 problem and 8 change states [cat for change, I otherwise]; 9-cell priority matrix,
  6–12 SLA definitions, 7 conflict types, 5–10 approval rules [I]; 6 human-task types; about 8 timers; 1 reversal (revert
  cancels approvals); 4 external parties (CMDB, monitoring, notifications, schedules).
- **Solver**: P07 categorise; P58 priority, routing, approvals, conflicts; P60 SLA elapsed, business-elapsed and breach
  (a pure function of the event history: the strongest tier-S oracle in the set); P25 change state machine; P12 over CIs;
  P16 + P09 incident → problem grouping.
- **Envelope**: P38 monitoring event → incident; P33 awaiting caller with On Hold pausing the clock; G3 escalation
  thresholds; P32 CAB and approver gates with timeout; G4 revert and cancel; G14 problem → change child; G8 query SLA and
  update priority; P42.
- **Lacks**: G2, G3, G4, G7, G8, G11 (major incident), G14, G15, G16, G17.

### E8. Order-fulfilment saga
- **Observed** [code, `reference-app-orders-go@f4420d9`]: 7 order, 6 fulfilment, 3 payment and 3 customer-action
  statuses (`app/order/api.go:75–197`); customer-action timeout 30 s, "aggressively low for demo purposes"
  (`workflows.go:23–24`); charge with an idempotency key (`workflows.go:371`; `billing/api.go:98–122`); child shipment
  workflow (:396–430), carrier and status signals, a status query. **No compensation**: `Fulfillment.process` charges
  then ships (:313–333); if shipping fails after a successful charge the fulfilment is marked Failed and the charge is
  never refunded; no compensat/rollback/refund in non-test Go code. **No `RetryPolicy`**: activity options set only
  `StartToCloseTimeout` (`app/order/workflows.go:168, 350`; `app/shipment/workflows.go:103, 177`), so Temporal's default
  applies: unlimited retries with 1 s initial interval, coefficient 2.0, maximum 100 × initial [web✓
  docs.temporal.io]. On a Temporal platform the app orphans a charge only on a non-retryable or permanent shipping
  failure.
- **Trip saga** [code, `_raw/trip-saga/trip.bpmn`]: 3 service tasks with compensation boundary events and compensation
  tasks (CancelCar, CancelHotel, CancelFlight), and an error-start event sub-process that throws compensation.
- **Bar version = a different specification** from the app: fraud check; per-fulfilment reserve, charge, ship; on
  failure, compensate committed steps in reverse order (cancel shipment, refund, release reservation); customer amend or
  cancel racing a timeout scaled to hours. Faults: 429, timeout after commit, duplicate and out-of-order carrier
  signals, permanent carrier failure.
- **Complexity**: about 19 status values; 1 human-task type; 3 timers; 3–4 compensations; 5 external parties.
- **Solver**: P25 state machine; P08 availability; P59 compensation planner.
- **Envelope**: P30 (row 23 N; E8 is P30's first genuine anchor after 0 of 7 corpus hits); P53/P54 child shipments (G6,
  G14); P33 customer and carrier signals (G1, G2); P26 retry with backoff; G19 idempotency and outcome-unknown; G8
  query; P29 final notification; P27 error routes.
- **Lacks**: G1, G2, G6, G8, G14, G19, row 23.
- **The literal port is a structure-necessity control, not a strawman**: it runs on the same declared Temporal platform
  profile as every arm (E-BED §2.2), so it fails only where the bar's specification differs from the app's (permanent
  failure after charge).

### E9. Loan origination (BPI 2017)
- **Measured** [data, `scratchpad/ebar/bpi17.py`, re-run]: 31,509 applications; 24 activity names on complete events;
  offers per application 1 → 22,950, 2 → 6,578, 3 → 1,348, 4 → 443, 5 → 126, ≥ 6 → 64 (27.2% have ≥ 2); 15,003
  applications (47.6%) have at least one A_Incomplete, 1,716 have ≥ 3; first O_Sent → A_Cancelled p10/p50/p90
  8.0/30.7/32.8 days (n 10,321), a ~30-day expiry visible in the data (the rule itself is not documented); first O_Sent →
  O_Returned 4.1/7.8/18.6 days (n 21,768); A_Pending 17,228, A_Cancelled 10,431, A_Denied 3,752 cases, fraud assessment
  303 cases; work-item transitions suspend 215,402, resume 127,160, ate_abort 85,224, withdraw 21,844. Case duration
  median 14 business days, p90 25, p99 43 [data].
- **Complexity**: 10 A_, 7 O_ and 7 W_ types × 6 lifecycle transitions; 20–40 synthetic underwriting rows [I]; 6–7
  human-task types; 3 timers; offer cancellations on acceptance or expiry (O_Cancelled 20,898); 3 external parties.
- **Solver**: P03 application data; P58 completeness and offer terms; P25 A_/O_/W_ state machine; P09 fraud review.
- **Envelope**: P55 incomplete-file calls with a bounded loop (G9); P33 O_Returned vs 30-day expiry (G2, G5); P32/P10
  validation; G7 lifecycle (suspend, resume, abort, withdraw); G12 application → offers; G3 call-after-offers.
- **Lacks**: G2, G3, G5, G7, G9, G12, G15. Oracle scope: faithful to the log's behaviour profile; rules synthetic.

### E10 (optional). tau2-bench
P43 session (row 29 N); P45 capped tool loop (row 12); P55 identity check; P07 intent; P08 policy guards; P32 explicit
confirmation before a write; P25 for telecom's decision graphs of 34, 35 and 62 nodes [cat]. No envelope gap; the
difficulty is compiling natural-language policy into guards, plus a policy-file user simulator.

### E11–E15
Decompositions for E11–E13 are in §2.2; E14 and E15 in §2.3. They are designed only far enough to show which gaps they
add; none is in the first build.

### 3.1 Scale summary at d5 per world [I unless tagged]

| item | states | rule rows per world | human-task types | concurrent clocks | compensations | parties | real data | case length p90 |
|---|---|---|---|---|---|---|---|---|
| E1 | ~17 | 20–60 | 4 | 2–3 | 3 reversal types | 4 | 42 activities, 11,973 variants [data] | 90 business days [data] |
| E2 | ~25 | 25–60 | 4 | 5–6 | 2 | 5 | — | — |
| E3 | ~8 per pair + 20–60 tasks | 5–20 | 3 | per task | 1–2 | N + 2 | W-bed R4 | one close cycle |
| E4 | ~16 | 50–80 | 5 | 3–4 | 0–1 | 4–5 | — | SAR ≤ 60 days by rule |
| E5 | ~18 | 100–200 | 4 | 8–10 | 2–3 | 5 | — | ~6 months by rule [I] |
| E6 | ~13 | 2,000–7,000 base; 10⁵–5×10⁵ at scale | 1–2 | 2–3 | 1 | 4 | — | prompt-pay window |
| E7 | ~21 | 30–40 | 6 | ~8 | 1 | 4 | BPIC 2014 [unavail] | change/problem cycles [I] |
| E8 | ~19 [code] | few | 1 | 3 | 3–4 | 5 | — | hours to days |
| E9 | ~24 | 20–40 | 6–7 | 3 | offer cancels | 3 | 31,509 cases [data] | 25 business days [data] |

---

## 4. Construct coverage (core items)

● central; ○ partial; – not exercised.

| class | E1 | E2 | E3 | E4 | E5 | E6 | E7 | E8 | E9 |
|---|---|---|---|---|---|---|---|---|---|
| rule tables / precedence (P58) | ● | ● | ● | ● | ● | ● | ● | ○ | ● |
| human tasks / approvals (16, 17) | ● | ● | ● | ● | ● | ○ | ● | ○ | ● |
| timers, SLAs, escalation (18, P60) | ○ | ● | ● | ● | ● | ○ | ● | ● | ● |
| correlation + waits (19, G1) | ● | ● | ● | ● | ● | ○ | ● | ● | ● |
| genuine saga compensation (23, P30) | – | – | – | – | ○ | – | – | ● | – |
| business reversals (row 15 effects) | ● | ○ | ○ | – | ● | ○ | ○ | ○ | ○ |
| multi-instance fan-out (6, G6) | ● | ● | ● | ● | ○ | ● | ● | ● | ○ |
| cross-run state (27) | ● | ● | ● | ● | ● | ● | ● | ○ | ○ |
| fuzzy matching (P16) | ● | – | ○ | ● | ● | ○ | ○ | – | – |
| document understanding (P03) | ● | ○ | – | ● | ● | ○ | ○ | – | ○ |
| nested subprocesses (11, G14) | ○ | – | ● | ○ | ○ | – | ● | ● | – |
| exception paths (21, P27) | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| business calendar (G16) | ○ | ● | ○ | ○ | ● | ○ | ● | – | ○ |
| rule editions (G18) | ○ | ● | ● | ● | ● | ● | – | – | – |
| object-centric cases (G12) | ● | ○ | ● | ● | ○ | ● | ○ | ○ | ● |

The compensation row was split from the draft's single row (critique 6): genuine saga compensation is central in only
one core item. A second compensation item (the Temporal money-transfer or booking saga, B20) is the obvious addition if
the owner wants the class covered twice.

---

## 5. Gap table (input to the engine column in BUILD-ORDER §5)

G1–G14 are Part B's gaps; **G15–G21 are new**. n = number of core items (E1–E9) needing the gap.

| gap | what | L0 row / layer | kind | needed by | n | tier-S workaround today |
|---|---|---|---|---|---|---|
| state | cross-run seen-set / cursor / counter / relation | 27 | engine N | E1–E7, E9 | 8 | host carries state; the arm writes it through `sor.*` effects |
| G1 | correlate an inbound message to its instance by key | 19 (+ `correlate`) | engine N | E1, E2, E3, E4, E5, E7, E8, E9 | 8 | events carry raw business keys; the arm correlates |
| G5 | durable waits over 1 h | 18 / 19 | engine N | all 9 | 9 | host clock owns time |
| G2 | race between events and a timer | 19 (`race`) | engine N | E1, E4, E5, E7, E8, E9 | 6 | solver decides the winner given `now` |
| **G15** | pausable calendar clock: start / pause / resume / stop / reset / cancel, retroactive start, breach → escalation | P60 over 2, 5, 18, 19, 27 | L1 pattern (solver half tier S) + envelope | E2, E3, E4, E5, E6, E7, E9 | 7 | **P60 solver half buildable now** |
| **G16** | business calendar and time-zone binding (effective-dated holiday tables, business hours) | L2 pure library + L3 data | library / binding | E1, E2, E3, E5, E7 | 5 | build now (pure) |
| **G17** | decision table: hit policy, precedence levels (Table/Group/All), value-type matching, release-and-stop, static completeness and overlap checks | P58 (2, 4, 5) + checker codes `TABLE_GAP`, `TABLE_OVERLAP`, `HIT_POLICY`, `EDITION_UNRESOLVED` | L1 pattern + checker | E1–E7, E9 | 8 | **build now** |
| G7 | human-task assignment: roles, lanes, separation of duties, delegation, **lifecycle** (claim, suspend, resume, withdraw, abort) | 16 / 17 | engine N | E1, E2, E3, E4, E5, E7, E9 | 7 | host scripted actors (G20) |
| approve timeout | `onTimeout` route on approve / ask | 16 (N part) | engine N | E1, E2, E4, E5, E7 | 5 | host |
| G3 | non-interrupting reminder or escalation on a waiting step | 18 / 19 + 15 | engine N | E2, E3, E4, E5, E7, E9 | 6 | P60 emits reminder obligations |
| G12 | object-centric cases (PO item ↔ GR ↔ invoice; application ↔ offers) | 27 relations + correlation convention | design decision | E1, E2, E3, E4, E6, E8, E9 | 7 | SoR holds the relations |
| **G19** | effect idempotency key and outcome-unknown (query before retry); inbound dedupe and ordering | 15 contract + 27 | engine + L3 | E1, E2, E5, E6, E8 | 5 | host mocks enforce keys; the oracle checks the ledger |
| compensate | saga undo in reverse order of committed steps | 23 | engine N | E8 (core), E5 (reversal with preconditions) | 2 | P59 planner (tier S) |
| G6 | envelope multi-instance with completion condition and dependencies | 6 / 13 lifted | engine N | E1, E3, E4, E7, E8 | 5 | per-instance solver mode + host |
| G14 | envelope child workflow with cancel propagation | 11 lifted | engine N | E3, E7, E8 | 3 | `call` inside the solver |
| G4 | cancel scope / interrupting event sub-process | 21 / 22 | engine N | E3, E7, E8 | 3 | solver plans the cancel effects |
| G8 | query or update a running instance | new, or L3 binding `instances.query` | engine / binding | E2, E3, E7, E8 | 4 | host |
| G13 | cross-instance batching and periodic sweeps (evaluate-for-release, unblock, auto-match, rescreen) | 25 + G8 | engine / host | E1, E2, E4, E6 | 4 | host fires explicit sweep ticks |
| G9 | bounded rework loops in the envelope | 10 lifted | engine N | E1, E4, E7, E9 | 4 | tick re-entry |
| **G18** | effective-dated rule editions (edition chosen by anchor date, not run date) | solver input convention (P58) | solver | E2, E3, E4, E5, E6 | 5 | build now |
| G10 | in-flight version pinning and migration | hash per instance + P31 | engine N | E2, E5, E6 | 3 | — |
| G11 | ad-hoc / case management | — | engine N | E4, E7 | 2 | out of round 1 |
| **G20** | bed host: durable clock, mocks, scripted counterparties and humans, effect and obligation ledger, fault injection, platform profiles | `beds/ebed/host/` (W-bed `lib/faults.mjs` hooks are no-ops) | bed infrastructure | all 9 | 9 | must be built first |
| **G21** | human-task form for object-valued answers (tier 0 compiled from `answerSchema`; no OpenUI dependency) | `tools/ui/` sidecar (`web/` is in the kit hash) | tooling | items with human tasks | 7 | tier 0, $0 (OPENUI.md) |
| session | conversation turn with capped memory | 29 | engine N | E10 only | 0 | — |

**Engine column, bar-weighted** (it changes BUILD-ORDER §5's corpus order for this programme):
1. `state` (27).
2. One durable-wait node: 19 + G1 + G2 + G5, with an absolute-time `at` for P60.
3. Human-task completion: 16/17 timeout routing + G7 + G3.
4. `compensate` (23) + G19.
5. G6 + G14 + G4.
6. G8 + G13, via a host binding plus `trigger.schedule`.
7. G10.

`session`, `admission` and `stream` drop off the core bar's path. Every engine step breaks the engine freeze (kit
`a572eeee1ac237aa`, ROADMAP rule 13), so the first numbers come from tier-S work outside `src/`.

**Card budget.** The L0 card stands at 2,962 of 3,000 tokens (owner decision PAUSE §5.10: cut, do not raise). No new L0
rows: P58–P60 land as L1 patterns, and fields are added to existing rows (`correlate` and `race` on 19; `at` and a
calendar on 18; `assign` and `onTimeout` on 16; `idempotencyKey` and `onUnknown` on 15). Each added field needs an equal
cut elsewhere and updated T2 phrase assertions.

**Non-engine work** ($0 API, tier S, outside `src/`): P58 with its checker codes; the P60 solver half; the G16 calendar
library; P59; the G18 convention; the G20 host; G21 tier 0.

---

## 6. Exclusions and reserves (every catalogue entry not selected)

**Merged into a bar item.** A3 → E1; A5 and A20 → E2 (dunning added from D365 collections docs); A13 and A14 → E3 (A15's
rounding rule as an E3 golden); A4 and A11 → E4; A1 and A19 → E5; A2 → E6; A16 and A17 → E7; B13 and B19 → E8 (A29 as
structure only); A24, B2, B4 → E9; B3 → E10; B1 calibrates E1; B15's oracle shape is ported into E7 (a ServiceNow
instance needs an account, which is off-limits).

**Reserves now held out as library-unseen**: A6 → E11, A12 → E12, A7 → E13 (§2.2). **Candidates**: D365 trade allowance
→ E14; A9 → E15 (§2.3). **Calibration only**: A22 / B5 BPI 2020 (G7 role chains; CC BY-NC).

**Excluded**

| entry | reason |
|---|---|
| A8 MRP | construct-light (no HT, TM or EW); ATP already in E2 |
| A10 prior authorisation | payer criteria not public; only timeframes exact |
| A15 revenue allocation | DT, ST, RV only; its rounding rule kept as an E3 golden |
| A18 CSDR | rate table and netting unverified; EUR-Lex empty; ICMA copyright |
| A21 CPQ | approval semantics unavailable (D = 3) |
| A23 BPIC 2018 | EU regulations not opened (D = 3) |
| A25 RMA | docs partly archived; returns covered by E3's intercompany returns |
| A26 Workday hire | tenant configuration (D = 2) |
| A27–A31 | D ≤ 2: structural or scale evidence only |
| SOP-Bench, CRMArena-Pro | licence unstated or snippet only |
| B6 RS-SHOP | the DESIGN-STREAMS ceiling item; consumer shop, not big-org; kept as G1 evidence |
| B7 WorkBench, B12 OfficeBench | office productivity, not business process; OfficeBench checks not exact |
| B8 TheAgentCompany | heavy infrastructure; LLM colleagues; checkpoint scoring |
| B9 tau-bench v1 | superseded by tau2 |
| B10, B11 OCEL 2.0 | simulated; the P2P log contains "Perform Two-Way Match" where the page describes three-way; audit before any use; calibration only |
| B14 Temporal background checks | code not read; shapes covered by E4 and E8 |
| B16 Node-RED | IoT, not business logic |
| B17 Kogito | evidence for G17's hit-policy mix; a source for the blind P58 card |
| B18 Camunda invoice | used as E1's simple baseline |
| B20, B21 Temporal samples / subscription | references for G13 (money batch), G5 and a possible second compensation item |
| B22, B24 Conductor; B23 Airflow | data pipelines; workers not public |
| B25 BPMN-MIWG | C.5.0 bank KYC (31 nodes) kept as a J3 structural reference for E4 |
| B26 Step Functions; B35 Logic Apps | proprietary cloud only |
| B27–B34 | demos of 9–18 nodes |
| B30 SAP-SAM | non-commercial research licence; not downloaded |
| B36 LLM-simulated OCEL | never: not a real distribution |
| B37 Kestra | not measured |

---

## 7. Evidence added in these passes, risks and unknowns

**New evidence.**
- Dunning is decomposable with a worked example (`process-collection-letters-example.md:31–33, 110, 129`) [doc].
- The Temporal reference app has no compensation and no retry policy (defaults apply) [code, web✓]; the OSS reference
  saga is the trip BPMN.
- WorkArena's validator comment (20%, :210) disagrees with its code (±5%, :233–235), and the rule is WorkArena's task
  policy, not ServiceNow's [code].
- BPI 2017: ~30-day offer expiry, 27.2% multi-offer applications, a full human-task lifecycle [data]; G7 must include
  suspend, resume, withdraw and abort.
- Case length: BPI 2019 p90 90 business days, BPI 2017 p90 25 [data]; any bed horizon shorter than these censors most
  cases (E-BED Errata 1).
- tau2's default user is a non-policy model, and some evaluators are model-judged [code].
- Regulation limits for E4 and E5 re-checked against the text [web✓].

**Risks.**
1. Oracle validity for E4, E5 and E9 rests on N-version implementations and synthetic rules; each item needs golden and
   specificity tests passing before any arm runs (AGENTS: an invalid evaluator blocks claims).
2. Rulebook size versus the 8K cap [M]: "Haiku constructed E6" means the engine and its mappings, not transcribed rows.
3. Single-labeller decompositions.
4. Engine freeze: every envelope gap breaks kit `a572eeee1ac237aa`, so the first numbers are tier-S numbers.
5. Licences: Visa forbids duplication (re-express); CPT descriptors are AMA-licensed; ServiceNow docs are copyrighted
   (semantics only); BPI 2017 under 4TU terms (keep local); BPI 2020 non-commercial; ERPNext is GPL-3.0 (read semantics,
   never copy code).
6. Tenant configuration is unknowable; no parity claim.
7. Selection bias toward computable, rule-heavy items (§1).

**Unknowns** [unavail / not opened]: the 23 D365 intercompany doc files; ServiceNow incident and problem state names;
Reg E official-interpretation examples beyond 11(d)(2)(1); Reg E §1005.6; Reg Z; NCCI policy-manual examples; BPIC 2014
data; the OCEL P2P audit; a second source for E14's deduction rules.

---

## 8. Errata vs the bar-set draft

| # | draft said | now | why |
|---|---|---|---|
| 1 | "the bar" = the most complex big-org workflows | "the documented rule-and-deadline core" of them | construct validity and selection bias (critique 4, 6) |
| 2 | 9 core + 1 optional | + E11–E13 library-unseen reserves, + E14, E15 candidates | library contamination; selection bias (critique 5, 6) |
| 3 | P58 and P60 as new candidates; P59 unassigned | P58, P59 (compensation planner), P60, authored blind to the bar from outside sources | critique 5; E-BED needed P59 |
| 4 | E1 net-unit-price matching as one price check | nine line fields (:96); background receipt auto-matching (`submit-invoice-workflow-automatically.md:35`); payment blocks and service entry sheets from BPI 2019 | critique 8; doc and data re-read |
| 5 | discriminating golden named Invoice 2 | Invoice 1 alone discriminates (8,640 vs 8,000 under the naive reading) | critique 20; re-derived |
| 6 | E5 Reg E: 10 business days and 45/90 days | adds the new-account rule (20 business days; 90 days) and the report/correct deadlines; CFR limits marked verified | consolidation [web✓] |
| 7 | E4 limits "[S1], verify before freeze" | verified against Cornell LII | consolidation [web✓] |
| 8 | E7 schedule check as ported ServiceNow semantics | labelled WorkArena task policy | critique 8 |
| 9 | E8 baseline "the reference app as written, which has no compensation" | same app, run on a declared Temporal platform profile (default unlimited activity retries); a different specification, not a flaw | critique 9 |
| 10 | one compensation row in the coverage table | split into genuine saga compensation (E8 only) and business reversals | critique 6 |
| 11 | E6 synthetic tables 1,000–5,000 pairs | plus a scale tier at 10⁵–5 × 10⁵ rows | critique 7 |
| 12 | no scope statement | §2.4: selected, not sampled | critique 13 |
