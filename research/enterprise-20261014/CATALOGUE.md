# CATALOGUE: complex enterprise workflows, proprietary and OSS, broken down for the enterprise bar

*Final version, 2026-10-14, about 13:40 UTC, branch `claude/intelligent-hamilton-vg1f9a` at `48ac5d1`. This file merges
two catalogues written the same day: **Part A**, 31 workflows that large organisations run on proprietary platforms
(source 1), and **Part B**, 37 public executable workflow collections and real process logs (source 2). A
consolidation pass re-checked the claims that later documents depend on (§10). The selection built from this
catalogue is [BAR-SET.md](BAR-SET.md); the bed design is [E-BED.md](E-BED.md); the OpenUI evaluation is
[OPENUI.md](OPENUI.md); every clone and download is in [ACQUISITIONS.json](ACQUISITIONS.json).*

*All of this was $0: no model calls of our own, only WebSearch, WebFetch, shallow clones and local scripts. Nothing was
installed or built, no install hook ran, `beds/sealed/` and credential files were not read, and web, corpus and clone
text was treated as data. Third-party source lives only in `/var/tmp/foundry-work/enterprise-src/`, outside the repo.
This is development and diagnostic evidence; nothing here is a held-out claim.*

**Evidence tags (one scheme for both parts).**

| tag | meaning |
|---|---|
| [doc] | documentation or a regulation page opened in a session that day (file:line when local) |
| [code] | code or model files read in a local clone |
| [data] | a number measured from a downloaded dataset |
| [page] | a dataset landing page opened; the data itself not downloaded |
| [M] | a count made by the writer |
| [snip] | a search-result snippet only; the page was not opened |
| [I] | inference or judgement |
| [unavail] | tried and not obtained |
| [web✓] | re-opened in the consolidation pass (§10) |

Part A's own "[data]" tag meant a landing page; it is written [page] here. Part B's [obs-code], [obs-data] and [inf] are
written [code], [data] and [I].

---

## 0. Bottom line

1. **The most complex enterprise workflows are publicly decomposable only as rulebooks, not as workflow files.**
   Network rules, regulations and ERP documentation with worked numeric examples (D365 is CC BY 4.0) describe the
   decision and deadline core of card disputes, claim adjudication, P2P matching, credit management and more (Part A).
   Their executable workflow definitions are tenant configuration and are not public.
2. **Public executable workflow models are small demos.** Across 7 engine collections (689 model files) the median
   model has 2 to 6 nodes and the largest has 88 tasks; the best-known vendor reference processes have 4 to 12 nodes
   (Part B §5.1) [code]. Breaking them down tells us which constructs are needed; it cannot show that we handle
   big-organisation complexity.
3. **Big-organisation complexity shows up in instance behaviour, which only event logs record.** BPI 2019 (one
   multinational's purchase-to-pay) has 251,734 purchase-order items, 1,595,923 events and 11,973 variants; 9,030
   variants occur once [data]. Its median case runs 46 business days and its 90th percentile 90 business days [data,
   re-measured §10].
4. **tau2-bench is the one source that is complex, runs at $0 locally and has an exact oracle**, but its default user
   simulator is a model outside our policy file (BAR-SET §2).
5. **The bar sits in the envelope layer the engine has not built.** Every top item needs some of `compensate` (L0 23),
   `wait.signal` (19), durable waits over 1 hour (18), `state` (27), approval timeout routing (16), plus the gaps
   G1–G14 named in §7 [I from the cards].
6. **Best first build (both parts agree):** procure-to-pay three-way matching and holds, credit holds, available-to-promise
   and intercompany chains from the D365 docs (CC BY 4.0, worked numeric examples), calibrated against the CC BY 4.0
   BPI 2019 log; then an order saga with compensation from OSS references.

---

## 1. Why corpus replication failed (B13), and what the catalogue unit is now

**Why B13 fired** (PROOF-LEDGER B13; DEV-NOTES D21; DESIGN-STREAMS §1.2):
- The replication unit was one hand-written workflow artefact, and each oracle had to be made by hand.
- Conformance worked only at τ = 1 with item-specific "not a difference" declarations.
- Of 1,559 corpus items, 67 variant families had at least 2 members, 18 had at least 3, and only 4 had at least 3
  members with an oracle; none reached 10.
- The most complex items produce prose or chat, so they have no oracle.

**The corpus is also structurally blind to this bar** [M, Part A]:
- 0 of its 1,559 items come from enterprise BPM platforms (Camunda, ServiceNow, Salesforce, Power Automate, Step
  Functions, Logic Apps, UiPath, Pega, Appian).
- L1 pattern P30 (saga) has 0 genuine corpus examples.
- The constructs these workflows need are marked N (not built) in the L0 card: `wait.signal`, `compensate`, `state`,
  durable `wait.delay` over 1 h, approval timeout routing. W-bed R7 (effects, waits, approvals) is parked.
- Repeating replication on Part B's models would fail the same way: they are smaller than the corpus items and also one
  of a kind [I].

**What changes.**
1. **The unit is a public rulebook plus worked examples plus a parameterised world generator.** The oracle is a
   reference transition function that implements the rulebook. Variant families are seeds × rule parameters
   (tolerances, regions, configurations) × rule editions, so they cannot run short.
2. **Public worked examples become golden tests for the oracle itself**: independent evidence that the evaluator is
   valid, which AGENTS.md requires before any claim.
3. **Real event logs calibrate realism only** (arrival rates, variant mix, rework, waits, batch users). They are never
   the correctness oracle. Conformance replay is descriptive.
4. **A stream of graded cases per process**, not one artefact: logs supply thousands of cases per process with case
   attributes to drive a simulator; tau2-bench and WorkBench add database end-state oracles over hundreds to thousands
   of tasks (Part B).
5. **Tasks are pure transition solvers** that emit an effect plan; the bed host owns durable time, mocks and scripted
   humans, and the oracle grades the host's effect ledger. This measures decision and deadline correctness before the
   N envelope constructs exist (L0's "solver is pure, envelope owns waits" split). E-BED.md refines this (on-policy
   grading, per-instance mode, censoring).

---

## 2. Scoring (the two parts use different scales; do not compare their scores)

**Part A (proprietary).** Both scores are judgement [I].
- **C, complexity 1–5**: how many construct flags apply and how large the rule tables are.
- **D, public decomposability 1–5**: 5 = exact public rules with numbers or worked examples; 4 = exact rules, some
  parameters configuration-dependent; 3 = semantics documented but incomplete; 2 = tenant-configured or a few guides;
  1 = case study only.
- **Rank** = C × D (1–25). Ties break on licence cleanliness, then judgement content (DU/FZ). **Sim** = simulator size.

**Part A construct flags** (L0 row and status): **DT** decision tables or precedence (`step`/`judge`, built); **HT**
human tasks or approvals (L0 16/17; timeout routing N); **TM** timers, SLAs, escalation (18; > 1 h N); **EW** external
event wait plus correlation (19, N); **CP** compensation or saga (23, N); **FO** fan-out (`map`/`wide`); **ST** state
across runs (27, N); **DU** document understanding; **FZ** fuzzy matching; **IN** integrations; **BC** business-calendar
arithmetic; **RV** effective-dated or versioned rules.

**Part B (OSS and data).** Each axis 1–3, product 1–27.
- **C**: 1 = ≤ 15 nodes and ≤ 1 enterprise feature; 2 = 16–40 nodes or 2–3 features; 3 = > 40 nodes, ≥ 4 features, or
  ≥ 1,000 real variants. Enterprise features: compensation, boundary or escalation timers, correlation, multi-instance
  or quorum, roles or separation of duties, cancel scopes, ≥ 5 business rules, waits over 1 hour, nested children.
- **E (executability)**: 1 = model or description only, or proprietary cloud only; 2 = local OSS engine or a computable
  oracle (log replay) that needs porting; 3 = runs at $0 locally with an exact programmatic oracle.
- **D (data)**: 1 = demo inputs; 2 = synthetic or simulated instances, or a generator; 3 = real event data with case
  attributes.

---

## 3. Part A: workflows on proprietary platforms (31), ranked

| # | Workflow | Org / platform | Domain (APQC) | C | D | C×D | Flags | Oracle source | Redistribution | Sim |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Card-network dispute lifecycle (chargeback, pre-arbitration, arbitration) | Visa Core Rules §11; Pega Smart Dispute | Payments (9, 6) | 5 | 5 | 25 | DT HT TM EW FO ST DU FZ IN BC RV | Network rule text | **Restricted**: Visa forbids duplication | L |
| A2 | Medicare professional claim adjudication 837P→835 | CMS / MACs | Healthcare payer (9, 5) | 5 | 5 | 25 | DT FO ST FZ IN RV | NCCI PTP/MUE/add-on files, fee schedule, CARC/RARC | CMS public [I]; CPT descriptors AMA-licensed | L |
| A3 | Procure-to-pay invoice matching (2/3-way), holds, tolerances | D365, Oracle Payables, SAP J45; BPIC 2019 | Finance (9.6, 4) | 4 | 5 | 20 | DT HT TM EW FO ST DU FZ IN | D365 docs with worked examples; BPIC 2019 | **CC BY 4.0** (docs and log) | M |
| A4 | KYC/CDD of legal entities with sanctions/PEP screening | Banks (31 CFR 1010.230, OFAC) | Risk & compliance (11) | 5 | 4 | 20 | DT HT FO ST DU FZ IN RV | Beneficial-ownership rule; OFAC scoring description | US regulation [I] | M |
| A5 | Customer credit management: blocking rules, hold list, release | D365, SAP 1QM/BD6 | Order-to-cash (9.2, 3) | 4 | 5 | 20 | DT HT TM ST RV | D365 docs with examples | **CC BY 4.0** | S–M |
| A6 | Mortgage loss mitigation and foreclosure dual tracking | Servicers (Reg X §1024.41) | Lending (9, 11) | 4 | 5 | 20 | DT HT TM EW ST DU BC | Regulation text | US regulation [I] | M |
| A7 | Payroll gross-to-net (federal withholding and more) | Workday/ADP/SAP payroll [I]; IRS Pub 15-T | HR / finance (9.5) | 4 | 5 | 20 | DT FO ST RV | 15-T Worksheet 1A | US government [I] | S–M |
| A8 | MRP / replenishment (coverage codes, action messages) | D365 master planning; SAP MRP [I] | Supply chain (4) | 4 | 5 | 20 | DT FO ST | D365 docs | **CC BY 4.0** | S–M |
| A9 | P&C claim FNOL → settlement (exposures, reserves, statutory clocks) | Guidewire ClaimCenter; NAIC Model 902 | Insurance (6, 9) | 4 | 4 | 16 | DT HT TM EW FO ST DU FZ IN BC | NAIC model timers | NAIC copyright [I] | M |
| A10 | Healthcare prior authorisation (CRD → DTR → PAS, X12 278) | Payers (CMS-0057-F, Da Vinci) | Healthcare (5, 6) | 4 | 4 | 16 | DT HT TM EW DU IN RV | Rule timeframes; implementation guides | Public [I] | M |
| A11 | AML alert → case → SAR filing | Banks (31 CFR 1020.320) | Risk & compliance (11) | 4 | 4 | 16 | DT HT TM FO ST DU FZ | SAR timing rule | US regulation [I] | M |
| A12 | SEPA credit-transfer exceptions (reject/return/recall/RFRO/inquiry; camt.056/029, pacs.004) | Banks (EPC) | Payments (9.7) | 4 | 4 | 16 | DT TM EW ST IN BC | EPC guidance | Not reviewed | S–M |
| A13 | Intercompany trade chains (two/three-legged, direct delivery, returns) | D365 SCM | Supply chain / finance | 4 | 4 | 16 | DT EW FO ST IN | D365 docs | **CC BY 4.0** | M |
| A14 | Period-end close and consolidation with eliminations | D365 GL; SAP J58 [unavail] | Finance (9.3) | 4 | 4 | 16 | DT HT FO ST RV | D365 docs | **CC BY 4.0** | M |
| A15 | Multiple-element revenue allocation and reallocation | D365 Finance | Finance (9.2) | 4 | 4 | 16 | DT ST RV | D365 docs | **CC BY 4.0** | M |
| A16 | IT incident management with an SLA engine | ServiceNow ITSM; BPIC 2014 (Rabobank) | IT (8) | 4 | 4 | 16 | DT HT TM ST BC | SLA API semantics | ServiceNow docs [I] | M |
| A17 | IT change enablement: risk approvals, CAB, conflict detection | ServiceNow; WorkArena task | IT (8) | 4 | 4 | 16 | DT HT TM FO BC | State model, conflict rules; WorkArena validator | WorkArena Apache-2.0 | M |
| A18 | Securities settlement fails: CSDR cash penalties and buy-ins | CSDs, brokers | Treasury (9.7) | 4 | 4 | 16 | DT TM ST FO RV BC | Penalty rate table | ICMA copyright [I] | M |
| A19 | Consumer EFT error resolution (Reg E §1005.11) | Banks | Payments (6, 11) | 3 | 5 | 15 | TM HT ST BC | Regulation text | US regulation [I] | S |
| A20 | Available-to-promise / capable-to-promise | D365; SAP aATP [I] | Order-to-cash (4) | 3 | 5 | 15 | DT ST | Exact ATP formula and example | **CC BY 4.0** | S |
| A21 | CPQ quote pricing waterfall → approvals → contract | Salesforce CPQ | Sales (3) | 4 | 3 | 12 | DT HT ST RV | Waterfall fields; approvals [unavail] | Not reviewed | M |
| A22 | Travel permit and expense reimbursement approval chain | TU/e (BPIC 2020) | HR / finance (9.6) | 3 | 4 | 12 | HT TM DT | Log plus stated rules | CC BY-NC | S |
| A23 | EU agricultural direct-payment applications (yearly cycle) | German states, profil c/s (BPIC 2018) | Government case management | 4 | 3 | 12 | DT HT TM ST RV | CC0 log; EU regulations not opened | CC0 log | M |
| A24 | Consumer loan origination (multiple offers) | Dutch bank (BPIC 2012/2017) | Lending | 3 | 3 | 9 | DT HT TM DU | Log only | 4TU terms | M |
| A25 | Customer returns / RMA with disposition codes | D365 (AX 2012 lineage) | Customer service (6) | 3 | 3 | 9 | DT HT EW | Docs (partly archived) | CC BY 4.0 (current docs) | S |
| A26 | Hire-to-onboard business process | Workday (university tenants) | Human capital (7) | 4 | 2 | 8 | HT DT IN TM | Tenant guides | Not reviewed | M |
| A27 | Underwriting quote → bind → issue with UW issues and authority | Guidewire PolicyCenter | Insurance | 3 | 2 | 6 | HT DT | [snip] only | — | M |
| A28 | Data/ML workflow orchestration at 0.5–2M jobs/day | Netflix Maestro | IT (8) | 3 | 2 | 6 | FO TM ST | Engine open source; workflows not | Apache-2.0 engine [snip] | — |
| A29 | Crypto transfer saga | Coinbase on Cadence/Temporal | Payments | 3 | 1 | 3 | CP | Case study | — | — |
| A30 | Uber Eats order orchestration ("eight standard steps") | Uber Cadence | Logistics | 3 | 1 | 3 | EW TM | Case study | — | — |
| A31 | Delivery creation with workflow fallback; payment idempotency | DoorDash Drive; Airbnb | Logistics / payments | 3 | 1 | 3 | CP EW | [snip] only | — | — |

### 3.1 Item cards

**A1. Card-network dispute lifecycle (Visa Core Rules §11; Pega Smart Dispute)**
- Steps [doc]: claim intake; choose one of 23 dispute conditions [M] in four categories (10 Fraud, 11 Authorization,
  12 Processing Errors, 13 Consumer Disputes); wait out pre-dispute periods (condition 13.1: 15 calendar days in Europe,
  30 days for MCC 4722 travel agencies, 60 days after a bonding-authority claim); file within the time limit (for
  example 120 calendar days from the Processing Date or from the last date the cardholder expected the goods); credit
  check (apply prior credits or cite their TID/ARN; credits whose details do not match the sale are limited to 120
  days); acquirer pre-arbitration within 30 days; issuer response within 30 days (accept; decline with compelling
  evidence and a certification; or decline with new documents; FX-loss pre-arbitration after a full credit also
  allowed); arbitration within 10 days of the pre-arbitration response.
- Two flows [doc]: Allocation for categories 10/11 (Table 11-1) and Collaboration for 12/13 (Table 11-2). Regional
  overrides [doc]: Nigeria 2 business days; Poland domestic ATM 20 days; Tanzania 20 or 10 days.
- Rule tables: 153 numbered tables in §11 [M]. Chapter 11 is about 251,800 characters (35,500 words), roughly 72K tokens
  [M, §10].
- DU/FZ: compelling evidence, AVS "Y" explanations, matching credits to sales whose details differ [doc]; narrative →
  condition is a judged branch with an exact label [I].
- Public artefact: the rule PDF, edition 18 April 2026 [doc], whose text forbids duplication. Pega docs [unavail]: the
  old URL redirects to an archive index.
- Simulator and oracle [I]: generator draws transactions (MCC, region, card-present, EMV, AVS, credits, delivery
  dates) and the narrative; reference implements per-condition eligibility, anchor dates and the stage machine;
  merchant and acquirer behaviour scripted; ship a re-expressed rulebook with synthetic numbers; the real-numbers
  variant stays local.

**A2. Medicare professional claim adjudication, 837P → 835**
- Steps: intake and front-end edits [I]; NCCI procedure-to-procedure edits (column-1/column-2 pairs; some bypassable
  with modifiers 59/XE/XP/XS/XU) [doc]; medically unlikely edits on units [doc]; add-on code edits [doc]; pricing
  [(wRVU×wGPCI)+(peRVU×peGPCI)+(mpRVU×mpGPCI)] × conversion factor [snip], from RVU files RVU26A–D [doc lists the
  files]; deductible and coinsurance accumulators and coordination of benefits [I]; remittance with group code (CO/PR/OA),
  CARC and RARC per adjustment, provider-level adjustments (PLB) including interest on late clean claims, one EFT per
  remittance; "Beneficiaries may be billed only when Group Code PR is used" [doc].
- RV: edits change quarterly with out-of-cycle replacement files; the NCCI Policy Manual is annual [doc]. The hospital
  PTP file v323r0 has 475,042 records and downloads route through `/license/ama` (critique pass, [doc]).
- ST: accumulators, units across claims, duplicate detection [I].
- Caveat [I]: mostly mechanical; it tests construction of a correct multi-stage rule engine more than judgement. Use
  HCPCS-only or synthetic codes to avoid the AMA CPT descriptor licence.

**A3. Procure-to-pay invoice matching, holds and tolerances (D365, Oracle, SAP; BPIC 2019)**
- D365 semantics [doc, `articles/finance/accounts-payable/accounts-payable-invoice-matching.md`,
  `three-way-matching-policies.md`]:
  - invoice-totals matching (§ at :48);
  - price-totals matching (:62): the net amount of the invoice line **and all pending and previously posted invoice
    lines** is compared with **the net amount of the PO line** (:63); % and/or amount tolerance, **a discrepancy if
    either exceeds** (:81);
  - net-unit-price matching compares **nine line amounts** (:96: unit price, price unit, charges, discount, discount %,
    multiline discount, multiline discount %, net amount, net unit price); tolerances per item, item group, vendor,
    vendor group, item+vendor or legal entity;
  - three-way quantity matching (:135) and charges matching (:160);
  - matching policy per legal entity, overridable per vendor, item or combination, and per PO line when "Allow matching
    policy override" is on; posting with discrepancies may require "Approve posting with matching discrepancies";
  - background product-receipt auto-matching runs hourly or daily with a maximum attempt count
    (`submit-invoice-workflow-automatically.md:35`) [doc, consolidation].
- Golden tests [doc]: the three price-totals tolerance tables (:66–91), the nine-field net-unit-price table (:96–108)
  and the cumulative example (:114–133): PO line 1,000 × 10.00 =
  10,000.00; tolerance 15% or 500.00; invoices 800, 100 and 200 at 10.80 (8,640.00, 1,080.00, 2,160.00); invoices 1 and
  2 pass, invoice 3 fails because the cumulative variance of 1,880.00 exceeds 500.00. Also the three-way policy examples
  (5 × 8,100 against a PO price of 8,000 with +8% unit and +15% totals tolerance → all Passed; a 4,000 shipping charge
  against 3,000 on the PO does not fail the line; Malaysia example: unreceived lines fail receipt quantity and a mouse at
  41 vs 40 fails a 2% unit tolerance) [doc, Part A].
- Oracle EBS [doc]: holds for quantity billed > received, price > PO price, quantity billed > ordered; they release on
  revalidation after a fix; some can be released manually.
- BPIC 2019: four categories (3-way, invoice after GR; 3-way, invoice before GR, blocked until the receipt and unblocked
  by a user or a batch; 2-way; consignment) [page]; measured in Part B #1 [data].
- SAP J45 [doc]: MRP or manual requisition → sourcing → PO → approval → goods receipt → invoicing.
- Contrast [code]: the Camunda 7 invoice demo has 7 nodes (2 user tasks, 1 rule task, 1 call activity) over 2 models,
  and one DMN of 8 rules (Part B #18).

**A4. KYC/CDD of legal entities with sanctions and PEP screening** — beneficial-ownership rule re-checked [web✓]:
- 31 CFR 1010.230(d)(1): each individual owning 25% or more of the equity interests, directly or indirectly; the Note to
  (d) says up to four individuals may need to be identified under (d)(1) and only one under (d)(2) (control prong: a
  single individual with significant responsibility to control, manage or direct). (d)(3): where a trust holds 25% or
  more, the trustee is the beneficial owner. (e)(2): 16 excluded legal-entity categories, (i)–(xvi). (e)(3): pooled
  investment vehicles and nonprofits get the control prong only. (h)(1): exemptions, including point-of-sale retail
  credit up to $50,000, postage, insurance-premium and equipment financing, limited by (h)(2).
- OFAC screening [doc]: prefilter by first letter and ≥ 50% similarity by edit distance; whole-name Jaro-Winkler and
  part-wise Jaro-Winkler + Soundex; the higher score is shown. Extended January 2021 (FAQ 892) [snip]. OpenSanctions'
  `ofac` mode emulates it without claiming parity; default threshold 0.7 [doc].
- Other steps: EDD for PEPs with senior approval, periodic rescreening on list updates [I]; indirect ownership through
  multi-layer graphs [I].
- Oracle [I]: synthetic ownership graphs and a synthetic watchlist with near-miss and transliterated names; exact on the
  owner set, required verifications and hits under our published scorer; true matches planted with date-of-birth and
  country cues. The live OFAC tool cannot be reproduced exactly [doc].
- Independent scorer (critique and consolidation, [web✓]): Moov Watchman, Apache-2.0, Jaro-Winkler at `minMatch=0.80`,
  benchmarked on 472,477 OpenSanctions Pairs records (precision 0.99), Docker image `moov/watchman`.

**A5. Customer credit management (D365; SAP 1QM/BD6)** [doc, `cm-sales-order-credit-holds.md`]
- 7 blocking rule types (days overdue, account status, terms of payment, credit limit expired, overdue amount plus
  credit-limit threshold, sales order amount, credit limit used %) (:47–143), plus 2 rank triggers (payment terms,
  settlement discounts) (:161–181).
- Precedence (:182–197): an exclusion with "Release sales order" releases and stops all evaluation; other exclusions
  affect only their rule; order Table → Group → All; an exclusion overrides a blocking rule only when value types match,
  not at the same level; "Credit limit used" runs only when its parameter is on; since 10.0.35 blocking rules are
  mandatory (a behaviour-changing fix, RV).
- Limits: the group limit is checked first, so the effective limit is the lower of group and individual (5 scenarios,
  `Credit-limit-scenarios.md:25`); 0.00 with Mandatory = no credit; 0.00 with Unlimited = unlimited; 0.00 with credit
  management disabled = unlimited.
- Hold list (:205–282): holds from all legal entities on one list, reason "Multiple" when more than one; release with or
  without posting; reject; "Evaluate for release" batch marks "Ready to release"; forced holds never auto-released; an
  approval workflow can gate release; intercompany orders excluded by default since 10.0.43.
- SAP 1QM [doc, outline only]: score/risk class/limit, limit request, accounts, blocked orders, reporting, jobs.
- Dunning (added in the bar-set pass) [doc]: `process-collection-letters-example.md:31–33` gives a 3-letter sequence
  with fees 0/20/50, minimums 0/10/100 and days block 2/3/15; the "ignore payments and credit memos" switch changes line
  codes against the header code (:110, :129); `collections-process-automate.md:29–41` gives pre-dunning, pool rank,
  quiet days and track steps.

**A6. Mortgage loss mitigation and dual tracking (Reg X §1024.41)** [doc]
- Acknowledge an application within 5 days (excluding weekends and holidays) if it arrives ≥ 45 days before a sale;
  evaluate within 30 days if complete > 37 days before; acceptance window ≥ 14 days if ≥ 90 days before, ≥ 7 days if
  between 90 and 37; appeal within 14 days, decided within 30; no first foreclosure notice or filing unless > 120 days
  delinquent; §(f)(2) and (g) bar filing, judgment or sale while a complete application is pending.
- Investor option waterfalls are not public [I], so synthetic. Oracle: per-day legality of foreclosure actions and notice
  dates as sale dates move.

**A7. Payroll gross-to-net (IRS Publication 15-T)** [doc]
- Worksheet 1A: annualise wages; add W-4 Step 4(a), subtract 4(b); subtract $12,900 (married filing jointly) or $8,600
  (others), or 0 if Step 2 is checked (pre-2020 forms: $4,300 per allowance); look up the rate schedule (standard or
  Step-2 sets × 3 filing statuses, marginal 0–37%); divide by pay periods; subtract Step 3 credits per period, floored at
  zero; add Step 4(c). 7 pay frequencies. Not opened [I]: state taxes, FICA wage-base accumulators, garnishment limits.
  Judgement-light; exact construction across jurisdictions; yearly drift.

**A8. MRP / replenishment (D365 master planning)** [doc]
- Coverage codes: manual, per requirement, per period, Min/Max, Priority, DDMRP. Min/Max with a multiple quantity
  (`replenishment-methods-quantity-modification.md:58–64`). Action messages with advance/postpone margins. Delays, safety
  stock, time fences. Oracle: exact planned orders and messages over a BOM explosion.

**A9. P&C claim FNOL → settlement (Guidewire ClaimCenter; NAIC Model 902)**
- Exposures [doc]: one per coverage × claimant (one collision gives 3 exposures); exposure types define data to collect;
  validation levels [snip]; assignment rules on FNOL submit [snip].
- NAIC clocks [doc]: acknowledge within 15 days; reply to the department within 21; accept or deny within 21 days after
  proof of loss, else notify and every 45 days; pay within 30 days of affirming liability; limitation-period notices 30
  (first party) or 60 (third party) days before expiry; auto total-loss rules with a 35-day right of recourse; calendar
  days. State adoption varies [snip]. Settlement value is adjuster judgement, so no exact oracle [I].

**A10. Healthcare prior authorisation (CMS-0057-F; Da Vinci PAS)** [doc]
- Decisions within 72 hours (expedited) or 7 calendar days (standard) from 2026 for impacted payers (except QHP issuers
  on the federal exchanges); a specific reason for every denial; drugs excluded; the Prior Authorization API from 2027;
  annual metrics from 31 March 2026. PAS IG STU 2 v2.2.1 [doc]. Pended responses resolve by subscription or `$inquire`
  [snip]. Payer criteria only partly public [I].

**A11. AML alert → case → SAR (31 CFR 1020.320)** — re-checked [web✓]:
- (a)(2): transactions involving or aggregating at least $5,000; (b)(3): file no later than 30 calendar days after initial
  detection; if no suspect was identified, an additional 30 days, and never more than 60 calendar days after initial
  detection; ongoing violations require an immediate telephone notification to law enforcement; (d): retain a copy and
  supporting documentation for five years from filing.
- Detection scenarios are bank-specific (synthetic) [I]; the continuing-activity FAQ URL returned 404 [unavail].

**A12. SEPA credit-transfer exceptions (EPC)** [doc]: answer a recall or request-for-recall within 15 banking business
days and an inquiry within 10; R-transactions through the same clearing mechanism as the original; ≥ 31 ISO reason codes
in the guidance [M]; the originator's launch windows not verified [snip/unavail].

**A13. Intercompany trade chains (D365)** [doc]: an intercompany sales order auto-creates its mirror purchase order and
vice versa; three-legged chains from an external customer's order; direct delivery defaults from the customer; address
and over/under-delivery tolerances sync from the original order and are editable only there; confirmed dates from the
intercompany vendor [snip]; auto-posting policies [snip]; returns create a PO, then a sales return order. Built from A3,
A5 and A20; the W-bed R4 nesting shape.

**A14. Period-end close and consolidation (D365)** [doc]: elimination rules with a destination elimination entity,
effective and expiry dates, journal type Elimination, wildcard source accounts (`1*`), destination "Source" or "User
defined", net change or fixed amount, a proposal process (`elimination-rules.md`, example at :53–62, descriptive). Close
workspace: dependencies block completion, past-due flags, owners by company and area
(`financial-period-close-workspace.md:33–48, 67–90`).

**A15. Multiple-element revenue allocation (D365)** [doc]: median price vs discount allocation; reallocation when lines
are added; a partial-invoice clearing account that returns to 0; essential/non-essential components; termination splits
by extended standalone selling price with **the rounding remainder to the last line**; clearing journal per termination
method.

**A16. IT incident with an SLA engine (ServiceNow; BPIC 2014)** [doc]: SLA conditions start, pause, stop, resume, reset,
cancel; resume on condition or when pause stops matching; cancel on condition, when start stops matching, or never;
reset = cancel or complete then start a new SLA; retroactive start from a task field; retroactive pause (default true);
schedule source from the definition, a task field or none (24×7); time zone from 5 sources; duration user-specified or
relative. BPIC 2014 [page]: Rabobank HP Service Manager extracts. Oracle: exact elapsed, business-elapsed and breach
timestamps from an event history.

**A17. IT change enablement (ServiceNow; WorkArena)**: state model New(−5), Assess(−4), Authorize(−3), Scheduled(−2),
Implement(−1), Review(0), Closed(3), Canceled(4); standard changes skip Assess and Authorize; "Revert to New" cancels
pending approvals; type editable only in New; cancel anywhere except Closed, disabled in Review; 7 conflict types [doc].
WorkArena validator [code, `compositional/manage_change_request_schedule.py:183–289`]: risk → duration (high 3 days,
medium 2, low 1) within ±5% (code at :233–235; the comment at :210 says "within 20%"); inside the schedule window; no
overlap; gaps ≤ 1 h (tight) or 24 h; ordered by impact; checks final table state through the Table API. The duration
rule is WorkArena's task policy, not ServiceNow's.

**A18. Securities settlement fails and CSDR penalties** [doc, ICMA 2017]: rates per day of fail — liquid shares 1.00 bp;
illiquid shares 0.50; SME growth (non-debt) 0.25; sovereign/supranational bonds 0.10; other bonds 0.20; SME debt 0.15;
other instruments 0.50; lack of cash at the official overnight rate. Reference price, netting, current table and buy-in
status after the 2022 amendments not verified [I]; EUR-Lex returned an empty page [unavail].

**A19. Consumer EFT error resolution (Reg E §1005.11)** — re-checked [web✓, consumerfinance.gov]:
- (b)(1)(i) notice no later than 60 days after the statement is sent; (c)(1) investigate within 10 business days, report
  within 3 business days of finishing, correct within 1 business day; (c)(2) up to 45 days from receipt if the account is
  provisionally credited within 10 business days (up to $50 may be withheld for a suspected unauthorised transfer) and
  the consumer is told within 2 business days; (c)(3)(i) **20 business days instead of 10** for transfers within 30 days
  after the first deposit (new accounts); (c)(3)(ii) **90 days instead of 45** for transfers not initiated within a
  state, point-of-sale debit card transactions, or transfers within 30 days after the first deposit; (d)(2) before
  debiting a provisional credit after finding no error, notify and honour checks and preauthorised transfers for five
  business days. The consumer-side front end of A1.

**A20. Available-to-promise (D365)** [doc, `delivery-dates-available-promise-calculations.md`]: cumulative ATP with
look-ahead (ATP = previous ATP + receipts − issues − net issues of future periods until cumulative receipts exceed
cumulative issues), never negative (:36, :52); promise date updated only when it can no longer be met (:29–32);
fences of 7 days and offsets of 1 day give a ship date 10 days out (:54–60); CTP by explosion, not allowed with
Planning Optimization.

**A21. CPQ (Salesforce)** [doc]: price waterfall Original → List → Special → Regular (volume) → Customer → Partner →
Net; `ApplyAdditionalDiscountLast__c`, `ApplyPartnerDiscountFirst__c` (unsupported with `ChannelDiscountsOffList__c`).
Advanced Approvals and co-termination proration [unavail]; entitlement-milestone docs 403.

**A22. Travel permits and expenses (BPIC 2020)** [page]: administration → budget owner → supervisor (collapsed when the
same person) → sometimes director; international trips need an approved permit; claims within 2 months after the trip;
permit log 7,065 cases, 86,581 events; CC BY-NC. Domestic declarations measured in Part B #5 [data].

**A23. EU agricultural direct payments (BPIC 2018)** [page]: 43,809 applications; 2,514,266 events; 24–2,973 events per
case (average 57); 14 activities; 2015–2017; CC0; yearly cycle with regulation changes. EU regulations not opened.

**A24. Loan origination (BPIC 2017)** [page; measured in Part B #2 and BAR-SET E9]: online applications filed in 2016;
multiple offers per application; 4TU General Terms; underwriting rules not public [I].

**A25. Returns / RMA (D365)** [doc/snip]: return reason code and disposition code; actions credit, credit only, scrap,
replace and credit, replace and scrap, return to customer [snip, archived AX 2012 docs].

**A26. Hire-to-onboard (Workday)** [doc, UW–Madison guide]: find or create the position → Direct Hire, Change Job or Add
Job by worker status; misconduct reference and background checks (HireRight only through recruiting); "Generate
Document" cannot be skipped; a legacy-ATS reason code skips Post Job. Business-process definitions are tenant
configuration [I].

**A27–A31. Low decomposability.** A27 underwriting issues block at quote, bind or issuance; special approval when no
user has authority [snip]. A28 Netflix Maestro: 500k jobs/day average, ~2M peak; foreach, branches, subworkflows; open
source; the blog returned 403 [snip]. A29 Coinbase [doc]: swap saga (withdraw A, withdraw B, deposit both; on failure
revert executed steps); millions of transactions daily; Zeebe and Step Functions rejected because every failure path
needed a predefined DAG. A30 Uber [doc]: Cadence runs "eight standard steps" per Eats order, not listed. A31 DoorDash and
Airbnb [snip]: 403 and 404. Value: structural evidence for compensation, saga and scale only.

### 3.2 Existing simulators with oracles (not counted in the 31)

- **WorkArena / WorkArena++** [doc, code]: 33 atomic and 682 compositional tasks; oracles are predicates over live
  ServiceNow tables (`validate`, `cheat`, `table_api_call`); the form validator admits it does not check extra fields;
  needs a ServiceNow instance (an account, off-limits), so port generators and validators to in-memory tables.
- **tau2-bench** [code]: airline, retail, telecom, banking_knowledge and mock; the evaluator compares final DB state to a
  goal (Part B #3).
- **SOP-Bench** [doc]: > 2,000 tasks in 12 domains; expert SOPs; AI-generated, human-validated tools; best ReAct 72.4%;
  paper CC BY-NC-ND; repo licence not stated.
- **CRMArena-Pro** [snip]: Salesforce B2B sales, service and CPQ tasks.
- Lesson [I]: all grade final system state against a goal — the oracle shape of §1 item 5.

---

## 4. What makes these enterprise-hard (cross-cutting) [I, grounded in the cards]

1. **Business calendars**: business vs calendar days, holidays, time zones (A6, A10, A12, A16, A19).
2. **Anchors**: clocks start from different dates, with "later of" rules and waits before an action is allowed (A1, A6).
3. **Precedence semantics**: Table/Group/All levels, value-type matching, release-and-stop rules (A5, A3).
4. **Cumulative and partial matching across runs** (A3, A15).
5. **Effective-dated rule editions** (A1, A2, A5, A7).
6. **Multi-entity mirroring and composition** (A13, A14).
7. **Regional overrides** (A1).
8. **The variant tail, waits of days to months and rework** (Part B §5.2): 73.8% of BPI 2012 cases repeat an activity;
   BPI 2019's 90th-percentile case runs 90 business days.

Items 1–5 are where a cheap constructor fails silently and an exact oracle earns its keep. Items 2, 4, 6 and 8 also need
the N constructs (`state`, `wait.signal`, `compensate`).

---

## 5. Part B: public executable workflows and real process data (37), ranked

### 5.1 Size of public executable models [code]

| collection | files | median size | max size |
|---|---|---|---|
| Camunda 7 examples | 54 | 2 | 9 |
| Camunda 8 examples | 30 | 2.5 | 18 |
| Kogito/jBPM examples | 107 | 2 | 16 |
| Step Functions collection | 184 | 6 | 33 |
| Logic Apps templates | 61 | 6 | 25 |
| Conductor | 225 | 2 | 88 |

Vendor reference processes: Camunda invoice 7 nodes, trip-booking saga 7, Kogito order saga 12, flowing-retail order 4.
The BPMN-MIWG interchange reference set tops out at 49.

### 5.2 Real process logs [data]

- **BPI 2019** (one multinational's P2P): 251,734 PO items, 1,595,923 events, 42 activities, 11,973 variants; top variant
  20.0%; 7 variants cover 50%, 45 cover 80%; 9,030 singletons; 8.9% of cases repeat an activity; 628 resources. By
  category: 3-way invoice before GR 221,010 items / 7,832 variants (36 for 80%); 3-way invoice after GR 15,182 / 4,228
  (1,192 for 80%), longest case 990 events; consignment 14,498 / 281; 2-way 1,044 / 148 (`_metrics/bpi2019.stats.txt`).
  Activity counts include Record Service Entry Sheet 164,975, Remove Payment Block 57,136, Change Quantity 21,449, Change
  Price 12,423, Cancel Invoice Receipt 7,096, Vendor creates debit memo 6,255, Cancel Goods Receipt 3,096.
- **BPI 2017** (loan applications): 31,509 applications; 1,202,267 events (475,306 complete); 26 activities; 15,930
  variants (5,623 complete-only); top variant 3.4%; case duration median 19.1 days, max 286; 149 resources.
- **BPI 2012**: 13,087 cases; 262,200 events; 24 activities; 4,366 variants (12 cover 50%, 1,749 cover 80%, 3,754 occur
  once); 73.8% rework; max case length 175.
- **BPI 2020 domestic declarations**: 10,500 cases; 56,437 events; 17 activities; 99 variants (3 cover 80%); 9.7% rework;
  durations up to 469 days.

The bar is reliability across this variant tail, its exceptions and waits of days to months, not graph size.

### 5.3 Ranked table

| # | item (URL @ pin; licence) | size metrics | exec / data | decomposition into L0 constructs, with gaps | C·E·D |
|---|---|---|---|---|---|
| B1 | **BPI 2019 P2P** ([4TU](https://data.4tu.nl/articles/dataset/BPI_Challenge_2019/12715853), v1; CC BY 4.0) | §5.2. Case attributes: Company, Vendor, Item Category, Document Type, spend area, GR-based invoice verification; event attributes: cumulative net worth (EUR), User. About 60 subsidiaries [doc] | XES; no reference model; oracle = matching rules per category [doc] plus replay | 26 trigger on PO item, 27 per-item GR/IR state, 19 GR/IR/invoice/service-entry events (**G1**), 2+4 match check, 16 remove payment block, 15 clear/pay, 23 cancel GR/IR and debit memo, **G9**, **G13** [I], **G5**, **G12** | 3·2·3 = **18** |
| B2 | **BPI 2017 loan** ([4TU](https://data.4tu.nl/articles/dataset/BPI_Challenge_2017/12696884); 4TU terms) | §5.2. Offer attributes: CreditScore, OfferedAmount, MonthlyCost, NumberOfTerms, Accepted | as B1 | 24 application, 2+4 validation, **G9** incomplete → call → revalidate loop with 17, **G6/G12** offers per application, 19 offer returned vs timeout (**G2**), 16 approve, 7 fraud flag → P09, **G5** | 3·2·3 = **18** |
| B3 | **tau2-bench** ([GitHub](https://github.com/sierra-research/tau2-bench) @dd8757d4; MIT) | [code] Airline: policy 1,313 words / 70 rule lines, 15 tools, 50 tasks, 2,000 reservations, gold actions up to 19. Retail: 17 tools, 114 tasks, 1,000 orders. Telecom: 1,025 + 2,686 + 2,822 policy words, 13 agent and 30 user tools (dual control), 2,285 tasks, decision graphs of 34, 35 and 62 nodes. banking_knowledge: 97 tasks, 20 tools, 698 documents, gold actions up to 37 | runs locally; exact DB end-state oracle and pass^k [doc]; v1.0.1 grading fix [doc] | 29 session, 17 ask, 3 enum intent judge, 4 policy guards, 16 explicit confirmation, 15 typed DB effects, 9; telecom adds P25 (10 + 3); banking adds P06. **No construct gap**: the hard part is compiling NL policy into guards | 3·3·2 = **18** |
| B4 | **BPI 2012 loan** ([4TU](https://data.4tu.nl/articles/dataset/BPI_Challenge_2012/12689204); 4TU terms) | §5.2; A_/O_/W_ sub-processes | as B1 | as B2 without multiple offers | 3·2·3 = **18** |
| B5 | **BPI 2020 travel expenses** ([4TU collection](https://data.4tu.nl/collections/BPI_Challenge_2020/5065541); CC BY-NC 4.0) | §5.2; roles ADMINISTRATION, BUDGET OWNER, PRE_APPROVER, SUPERVISOR. Other 4 logs [unavail] | XES | 24 submit, **G7** role chain (16 × up to 4, routed by 2+10), reject → 17 resubmit (**G9**), 15 payment, **G12** permit ↔ declaration | 2·2·3 = **12** |
| B6 | **n8n RS-SHOP** (corpus item n8n:20421; DESIGN-STREAMS) | 306 nodes, 337 edges: 13 triggers, 37 conditions, 157 actions, 64 code nodes, 6 sub-workflows | n8n JSON; world generator designed, not built | 24 signed webhooks, 27, P25, P34, 16/17, 15, 20, **G1** | 3·2·2 = **12** |
| B7 | **WorkBench** ([arXiv 2405.00823](https://arxiv.org/abs/2405.00823); @49c7dfd0; MIT) | [doc] 690 tasks, 5 databases, 26 tools; GPT-4 43% | local sandbox; end-state oracle | 3, 15, 4, 6, 10 | 2·3·2 = **12** |
| B8 | **TheAgentCompany** ([arXiv 2412.14161](https://arxiv.org/abs/2412.14161); @98b68ef8; MIT) | [doc] 175 tasks; GitLab, Plane, ownCloud, RocketChat; best agent 30% | Docker, heavy; checkpoint scoring; LLM colleagues [I] | 12, 17, 15 across 4 apps | 3·2·2 = **12** |
| B9 | **tau-bench (original)** ([arXiv 2406.12045](https://arxiv.org/abs/2406.12045); @59a200c6 via ls-remote; licence [unavail]) | [doc] airline and retail; gpt-4o < 50%; pass^8 < 25% on retail | superseded by B3 | as B3 | 2·3·2 = **12** |
| B10 | **OCEL 2.0 P2P** ([Zenodo 8412920](https://zenodo.org/records/8412920); CC BY 4.0) | [data] 14,671 events; 9,543 objects; 10 event types incl. delegate approval and two-way match; 7 object types; 2–10 objects per event; [doc] SAP-simulated; anomalies maverick buying, duplicate payments, slow approvals | SQLite/JSON; simulated | 16 × 2, **G7**, 19, 4, 7, **G12**, **G13** | 2·2·2 = **8** |
| B11 | **OCEL 2.0 Order Mgmt v2** ([Zenodo 8428112](https://zenodo.org/records/8428112); CC BY 4.0) | [data] 21,008 events; 10,840 objects; 11 event types; 6 object types; 3–37 objects per event; 311 failed deliveries, 566 payment reminders, 1,544 reorders | as B10; CPN Tools model published [doc] | 24, **G6**, 26, **G13**, **G3**, 20, **G12** | 2·2·2 = **8** |
| B12 | **OfficeBench** (@b978b808; Apache-2.0) | [doc] 300 tasks (93 / 95 / 112 one-, two-, three-app); GPT-4o 47.0%, 21.4% on three-app | Docker; checks not fully exact | 12 or 3 over app operations (P25) | 2·2·2 = **8** |
| B13 | **Temporal order reference app** ([GitHub](https://github.com/temporalio/reference-app-orders-go) @f4420d92; MIT) | [code] 3 workflows (Order, Shipment, Charge); 5 activities + 3 local; 1 child workflow; 3 signal channels; 2 queries; 2 parallel branches; 30-second customer-action timeout (`app/order/workflows.go:24`); 7 order statuses; fraud check; **no compensation** and **no RetryPolicy** (§10) | Go; Temporal dev server | 24, 15, 10, 19 + timeout (**G2**), **G6**, child (**G14**), carrier signals (**G1**), **G8**, 9 | 3·2·1 = **6** |
| B14 | **Temporal background checks** ([learn.temporal.io](https://learn.temporal.io/examples/go/background-checks/application-requirements); @e882565b; Apache-2.0) | [doc] 2 or 5 searches; SSN trace first, then parallel; candidate accept or decline with a 5-minute timeout; manual researcher; HR can cancel anytime; PII encrypted; waits of days to weeks | Go (code not read) | 15, 19 + timeout (**G2**), **G6**, 17, **G4**, **G5** | 3·2·1 = **6** |
| B15 | **WorkArena / WorkArena++** (@e8851309; Apache-2.0) | [doc] L1: 33 tasks, 19,912 instances; ++: 682 tasks | needs ServiceNow instances | 12 in a UI, 17, 15 | 3·1·2 = **6** |
| B16 | **Node-RED largest flows** (corpus) | median 150 nodes, max 421 (130 conditions) | IoT and home automation | 26, 10, 15, 30 | 3·2·1 = **6** |
| B17 | **Kogito / jBPM examples** ([GitHub](https://github.com/apache/incubator-kie-kogito-examples) @740ddbe3; Apache-2.0) | [code] 107 BPMN; 52 DMN (rules median 4, max 27; hit policies 58 UNIQUE, 4 FIRST, 2 COLLECT, 1 PRIORITY, 1 ANY). order-saga: 12 nodes, 3 boundary events, 7 compensation elements. travels: 2 call activities, 3 message events, 1 rule task. service-desk: ad-hoc, 16 nodes. Prequalification DMN: 5 decisions, 27 rules | Quarkus / Spring Boot | 2+4, 23, 11, 16/17 (**G7**), 19, **G11** | 2·2·1 = **4** |
| B18 | **Camunda 7 invoice** (camunda-bpm-platform @ee4826e5; Apache-2.0 [doc]) | [code] 7 nodes (2 user tasks, 1 rule task, 1 call activity), 3 lanes; DMN 2 decisions, 8 rules, UNIQUE and COLLECT | Camunda 7 | 24, 2+4 (COLLECT → several approver groups, **G7**), 16, 10, 11 review with **G9**, 15 | 2·2·1 = **4** |
| B19 | **Trip-booking saga** (berndruecker @f6152634; Apache-2.0) | [code] 6 activities, 3 compensation boundaries, 7 compensation elements, 1 error event | Camunda 7 | 15 × 3 each with 23, 21 → reverse compensation | 2·2·1 = **4** |
| B20 | **Temporal samples-java** (@e4db5f75; Apache-2.0) | [doc] booking saga, synchronous saga, money transfer, money batch, sliding-window batch, updatable timer | Java | 23; **G13**; 19; **G8** | 2·2·1 = **4** |
| B21 | **Temporal subscription template** (@1ccb15c6) | [code] 3 query handlers; 2 signals; selectors | Go | **G5**, 19 (**G2**), **G8**, 15, 27 | 2·2·1 = **4** |
| B22 | **Conductor kitchensink and test harness** ([GitHub](https://github.com/conductor-oss/conductor) @c52919af; Apache-2.0) | [code] wf1: 30 tasks; across 225 definitions: 26 dynamic forks, 36 do-while, 5 human tasks, 28 agent tasks, 11 failure workflows | Conductor server [I] | 15, 10, **G6**, 11, 21, 18/19, **G9** | 2·2·1 = **4** |
| B23 | **Airflow** (corpus, 88 items) | median 12.5 tasks, max 37 | data pipelines | 25, 15, 6, 20, 22 | 2·2·1 = **4** |
| B24 | **Conductor VFX media review** (`ui/e2e/fixtures/dynamicFork.json`) | [code] 54 top-level tasks, 88 incl. nested: 61 workers, 9 sub-workflows, 3 dynamic forks, 6 terminate, failure workflow | execution snapshot; workers not public | as B22 | 3·1·1 = **3** |
| B25 | **BPMN-MIWG reference models** (@386baa55; CC-BY-3.0) | [code] 22 models, median 10, max 49. B.2.0: 36 activities, 11 boundary events, 3 multi-instance. C.5.0 bank KYC: 31 nodes, control-flow complexity 13. C.4.0 onboarding: 4 pools. C.6.0 travel booking with compensation and event sub-process. C.9.0 onboarding with timeouts and fraud | descriptive | **G3**, **G4**, 23, **G6**, **G7** | 2·1·1 = **2** |
| B26 | **AWS Step Functions collection** (@7842c46f; MIT-0) | [code] 184 machines, median 6 states, max 33; 714 Task, 146 Choice (214 rules), 31 Parallel, 55 Map (17 distributed), 74 Wait; Retry in 69; 86 Catch; 44 callback tokens; 20 nested executions; saga pattern 12 states, 5 catch | AWS only; local emulator not verified | 15, 10, 6/13, 20, 21, 19 via task token (**G1**), 11, **G3** | 2·1·1 = **2** |
| B27 | **Camunda 8 / Zeebe examples** (camunda-community-hub @325e5e57; licence [unavail]) | [code] 30 files, max 18 (get-up: 5 timers, 10 gateways); payment 7; a large multi-instance example | Zeebe | 18, 19, **G6** | 1·2·1 = **2** |
| B28 | **Camunda 7 examples** (@6c7f4c4a; Apache-2.0) | [code] 54 files, max 9; 46 user tasks; dinner DRG (2 decisions, 12 rules); bpm-assert examples with unit tests | Camunda 7 | 16/17, 2+4 | 1·2·1 = **2** |
| B29 | **bpmn-for-research** (@1416f6f2; no licence) | [code] 3,739 diagrams = 4 exercises × (34–1,141 results) + 10 solutions; median 12 nodes, max 32; control-flow complexity ≤ 21; event-based gateways in 1,955, timers in 1,655, no compensation | descriptive | J3 structural-fidelity distribution | 1·1·2 = **2** |
| B30 | **SAP-SAM** ([Zenodo 7012043](https://zenodo.org/records/7012043) v0.5.1; non-commercial research) | [doc] "hundreds of thousands" of models, 4.8 GB | not downloaded | size distribution only | ≤ **2** |
| B31 | **Dapr workflow quickstart** (dapr/quickstarts @3b7e975b; Apache-2.0) | [doc] notify, verify inventory, approval (external event when total > 5000), payment, update inventory | Dapr | 15, 10, 19, 16 | 1·2·1 = **2** |
| B32 | **Flowable getting-started** ([docs](https://flowable.com/open-source/docs/bpmn/ch02-GettingStarted)) | [doc] holiday request: manager approval, then system call or email | Flowable | 16, 10, 15 | 1·2·1 = **2** |
| B33 | **Activiti examples** (@ddd1cf9c) | [doc] 4 basic API examples; licence [unavail] | Activiti | 16/17 | 1·2·1 = **2** |
| B34 | **flowing-retail order** (@24465429; Apache-2.0 [doc]) | [code] 4 activities, 3 message events (Kafka choreography) | Zeebe | 19 (**G1**) | 1·2·1 = **2** |
| B35 | **Azure Logic Apps templates** (@e6b7d87e; MIT) | [code] 61 workflows, median 6 actions, max 25; correlation-ID aggregation (21), sequential convoy (25), SAP order sync (18); most templates are RAG ingestion | Azure; local runtime [unavail] | **G1**, **G13**, 25, 10 | 1·1·1 = **1** |
| B36 | **OCEL LLM-simulated O2C/P2P/Hiring/Hospital** ([Zenodo 13879980](https://zenodo.org/records/13879980); CC BY 4.0) | [doc] generated by o1-preview; counts [unavail] | never use as a real distribution | — | **1** |
| B37 | **Kestra blueprints** (@4a19ce21) | README only [unavail] | — | — | unscored |

Not catalogued: Windmill (no source opened); real organisations' largest Airflow repositories (not surveyed).

**Part B findings kept.**
- **Discrepancy** [data vs doc]: the OCEL 2.0 P2P page describes a three-way match (SAP's MRBR transaction), but the log
  contains "Perform Two-Way Match". Simulated logs must be audited before use.
- **Licence limits**: research-use only for BPI 2020 (CC BY-NC 4.0) and SAP-SAM (non-commercial, not downloaded); no
  licence found, so read-only and not redistributable, for bpmn-for-research and camunda-community-hub/camunda-8-examples.
- **Ranking for an E-bed** (Part B's own): BPI 2019 (18; one process → 251k graded cases, held-out split by Company or
  Vendor, happy-path baseline covering the top variant's 20% should fail the tail); BPI 2017/2012 (18); tau2-bench
  telecom and airline (18; the only exact $0 local oracle); BPI 2020 (12); WorkBench, RS-SHOP, TheAgentCompany (12).

---

## 6. Cross-reference between the parts, and where each item went

| subject | Part A | Part B | used in BAR-SET as |
|---|---|---|---|
| P2P matching (D365 rules + BPI 2019 log) | A3 | B1, B18 (baseline), B10 (simulated, audit first) | **E1** (rules from A3, calibration from B1, Camunda demo as the simple baseline) |
| Credit, ATP, dunning | A5, A20 | — | **E2** |
| Intercompany, close, consolidation | A13, A14, A15 (rounding rule only) | — | **E3** |
| KYC/CDD + AML/SAR | A4, A11 | B25 C.5.0 (structure reference only) | **E4** |
| Disputes | A1, A19 | — | **E5** |
| Claims adjudication | A2 | — | **E6** |
| ITSM incident, problem, change | A16, A17 | B15 (validator ported) | **E7** |
| Order saga with compensation | A29 (structure only) | B13, B19, B20 | **E8** |
| Loan origination | A24 | B2, B4 | **E9** |
| Policy-constrained service | §3.2 | B3 | **E10** (optional anchor) |
| Library-unseen reserves | A6, A12, A7 | — | **E11–E13** (BAR-SET §2.2) |
| Deductions chain | (D365 trade allowance, BAR-SET §2.3) | — | **E14** candidate |
| Judgement item | A9 | — | **E15** candidate (reported separately) |

---

## 7. Construct gaps G1–G14 against L0 (Part B; confirmed by its sources)

| gap | what it is | needed by (Part B #) |
|---|---|---|
| G1 | correlate an external message to the right running instance by key (19 has a name but no key) | 1, 6, 13, 26, 34, 35 |
| G2 | race between several events and a timer (event-based gateway or selector) | 2, 13, 14, 21 |
| G3 | non-interrupting reminder or escalation timer on a waiting step | 11, 25, 26 |
| G4 | cancel scope / interrupting event sub-process | 14, 25 |
| G5 | durable waits over 1 hour (18 is N); real cases reach 286–469 days | 1, 2, 5, 14, 21 |
| G6 | envelope-level fan-out or multi-instance with a completion condition, over effects and human tasks | 2, 11, 13, 14, 22, 25, 27 |
| G7 | human-task assignment: roles, lanes, separation of duties, delegation | 5, 10, 17, 18, 25 |
| G8 | query or update a running instance | 13, 20, 21 |
| G9 | bounded rework loops in the envelope (rework in 9–74% of real cases) | 1, 2, 5, 18, 22 |
| G10 | versioning or migration of in-flight instances | none measured; [I] from Temporal worker-versioning samples |
| G11 | ad-hoc / case management | 17 |
| G12 | object-centric cases (2–37 objects per event) | 1, 2, 5, 10, 11 |
| G13 | batching across instances | 1, 10, 11, 20, 35 |
| G14 | envelope-level child workflow with cancellation propagation | 13, 14 |

Already in L0 but not built (N): `compensate` (23), `wait.signal` (19), `state` (27), `admission` (28), `trigger.*`
(24–26). BAR-SET §5 adds G15–G21.

---

## 8. Coverage

- **APQC PCF 7.4** [doc; IFRC mirror]: 13 top-level categories, about 1,920 numbered elements [M]; royalty-free with
  attribution. Covered: categories 3, 4, 5, 6, 7, 8, 9 (strongest 9.2, 9.3, 9.5, 9.6, 9.7) and 11. **Gaps**: 1
  (strategy), 2 (product development), 10 (asset management, e.g. SAP PM work orders, not researched), 12 and 13.
- **D365 business process catalog** [doc]: 15 end-to-end scenarios, > 100 areas, > 800 processes, > 3,000 scenarios;
  updated at least 4 times a year. Covered: Source to pay, Order to cash, Record to report, Inventory to deliver, Hire
  to retire, Case to resolution, Plan to produce/Forecast to plan. Not covered: Acquire to dispose, Concept to market,
  Design to retire, Project to profit, Prospect to quote (except CPQ), Administer to operate.
- **Platforms not covered**: Appian, UiPath, Automation Anywhere, SAP Signavio process collections (blog 403), Oracle
  Fusion (pages 404; only old EBS hold docs), S&OP. SAP Best Practices Explorer and Process Navigator BPMN need an SAP
  account [unavail].
- **Selection is not sampling.** Every item here was chosen for complexity and public decomposability; no statement
  about "enterprise workflows in general" follows from results on them (critique 13).

---

## 9. Sources opened (merged; the full per-pass list with outcomes is in ACQUISITIONS.json)

- **Microsoft Dynamics 365**: learn.microsoft.com pages for three-way matching policies, credit holds, credit-hold FAQ,
  business processes (about, order-to-cash overview); github.com/MicrosoftDocs/dynamics365-guidance overview; the D365
  docs clone files cited above.
- **ServiceNow and WorkArena**: servicenow.com docs for the SLA API, change state model and conflict detection; arXiv
  2403.07718 and 2407.05291; the WorkArena clone.
- **Salesforce**: Trailhead CPQ partner and distributor discounts.
- **SAP and Oracle**: learning.sap.com direct-materials procurement; the 1QM process-flow mirror PDF; Oracle EBS holds
  page (docs.oracle.com/cd/A60725_05/html/comnls/us/ap/holdap03.htm).
- **Workday**: hr.wisc.edu cutover hire scenarios.
- **Banking and payments**: Visa Core Rules PDF; consumerfinance.gov Reg E §1005.11 and Reg X §1024.41; Cornell LII 31
  CFR 1020.320 and 1010.230; ofac.treasury.gov FAQ 249; opensanctions.org scoring docs; EPC135-18 v6.0; ICMA CSDR note.
- **Insurance**: NAIC Model 902; Guidewire ClaimCenter exposures overview.
- **Healthcare**: CMS-0057-F fact sheet; HL7 Da Vinci PAS; CMS NCCI edits, remittance advice and PFS relative value
  files pages.
- **Payroll**: irs.gov Publication 15-T.
- **Event logs and data**: icpmconference.org 2019 BPI page; data.4tu.nl pages for BPI 2012, 2014, 2017, 2018, 2019 and
  the 2020 collection and domestic declarations; Zenodo 8412920, 8428112, 13879980, 7012043.
- **Engineering case studies and OSS docs**: temporal.io Coinbase case study; uber.com Cadence overview;
  learn.temporal.io background checks; GitHub pages for flowing-retail and trip-booking-saga-java; one Camunda docs page
  on exception best practices; docs.temporal.io retry policies (critique and consolidation).
- **Benchmarks and coverage**: arXiv 2506.08119, 2208.12223, 2403.01982, 2407.19056, 2405.00823, 2412.14161,
  2406.12045; APQC PCF 7.4 (IFRC mirror).
- **Independent implementations** (critique and consolidation): github.com/frappe/erpnext (GPL-3.0), github.com/moov-io/watchman (Apache-2.0).

---

## 10. Consolidation pass: what was re-checked, corrected or added

| claim | result | evidence |
|---|---|---|
| Reg E §1005.11 limits (A19) | Confirmed; added the new-account rule: 20 business days instead of 10 ((c)(3)(i)) and 90 days instead of 45 ((c)(3)(ii)(C)) | [web✓] consumerfinance.gov |
| 31 CFR 1010.230 (A4) | Confirmed: 25%, up to four individuals, exactly one control person, trustee rule, 16 exclusions, control-prong-only entities, $50,000 POS retail-credit exemption | [web✓] Cornell LII |
| 31 CFR 1020.320 (A11) | Confirmed: $5,000; 30 days; +30 with no suspect; 60-day cap; immediate phone call; five-year retention | [web✓] Cornell LII |
| D365 cumulative price-totals example (A3) | Confirmed (:114–133). The PO-line-net reading of :63 is pinned by **Invoice 1**: under an "invoiced qty × PO price" reading it fails (8,640 vs 8,000, 640 > 500) while the doc says Passed | [doc] read this pass |
| D365 net-unit-price matching (A3) | Nine line fields, not one price (:96) | [doc] read this pass |
| D365 background receipt matching (A3) | Hourly or daily, with a maximum attempt count (`submit-invoice-workflow-automatically.md:35`) | [doc] read this pass |
| Temporal reference app (B13) | No compensation (`workflows.go:313–333`), no `RetryPolicy` (only `StartToCloseTimeout` at `app/order/workflows.go:168, 350`, `app/shipment/workflows.go:103, 177`); Temporal's default activity policy retries without limit (initial 1 s, coefficient 2.0, maximum 100 × initial) | [code] + [web✓] docs.temporal.io |
| BPI 2017 case count (A24, snippet-only in Part A) | 31,509, measured | [data] |
| Case durations | BPI 2019: median 46 business days (64.0 calendar), p90 90 (126.1), p99 157; 57.6% > 40 business days, 33.9% > 60. BPI 2017: median 14 business days (19.1 calendar), p90 25 (35.1); 36.4% > 20. BPI 2012: median 1 business day, p90 21; 11.5% > 20 | [data] `scratchpad/efinal/durations.py` |
| Rulebook size vs the 8K constructor cap | Visa Core Rules chapter 11 ≈ 251,800 characters (≈ 72K tokens at chars/3.5); D365 sources for E1 34,365 characters (≈ 9.8K tokens), for E2 53,032 (≈ 15K), for E3 elimination + close 19,524 (≈ 5.6K) | [M] |
| OpenUI security notes (OPENUI.md) | `actionMessage.ts:28` calls `window.open(url,"_blank")` with no scheme check; `lang-core/src/utils/validation.ts:122` builds `new RegExp(arg)` from the rule argument; 4 consumer call sites of the URL guards (`safeUrl`, `safeOpenUrl`, `toCssUrl` ×2) | [code] grep this pass |

---

## 11. Unavailable or unverified (merged)

- **Returned errors**: Pega Smart Dispute docs (archive redirect); Salesforce entitlement docs (403); Netflix, DoorDash
  (403); Airbnb (404); Oracle Fusion 25c holds (404); eCFR (bot block); EUR-Lex 2017/389 (empty); FinCEN SAR FAQ (404);
  Guidewire PolicyCenter (title only); SAP community blog (403); UT Austin Workday guide (login); ocel-standard.org
  (503); a Dapr quickstart URL (404); `camunda/camunda-8-examples` and `MicrosoftDocs/Dynamics-365-Operations`
  (credentials).
- **Snippet-only claims**: the fee-schedule formula and conversion factor; SAP-SAM licence terms; Maestro scale;
  CRMArena-Pro size; return disposition actions; Guidewire validation levels and underwriting issues; Visa allocation and
  collaboration timing beyond Table 11-1.
- **Not opened**: Reg E §1005.6 liability tiers; Reg Z §1026.13; NCCI policy-manual examples; ServiceNow incident and
  problem state names; the 23 D365 intercompany doc files (titles only); BPIC 2014 data; the OCEL P2P audit.

---

## 12. Acquisition records (summary; full records with SHA, date, licence and outcome in ACQUISITIONS.json)

| kind | count | outcome |
|---|---|---|
| shallow or sparse clones | 14 succeeded, 2 failed (credential prompts) | all inert; HEAD SHAs re-confirmed this pass |
| PDFs | 6 | sha256 recorded; text extracts in the session scratchpad only |
| raw files at pinned SHAs | 6 model/code files + 21 README/LICENSE files | sha256 in `_metrics/raw-sha256.txt` |
| datasets | 6 downloaded (BPI 2012, 2017, 2019, 2020 domestic; OCEL P2P, OCEL order management), 4 described only | sha256 re-computed this pass; logs stay local, never committed |
| registry metadata | npm metadata for OpenUI's pinned dependencies | no tarballs |
