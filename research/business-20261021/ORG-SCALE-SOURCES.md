# ORG-SCALE SOURCES: material for an org twin (2026-10-21)

*Scouting pass for the owner's request in [OPEN-CORE-AND-INVARIANTS.md](OPEN-CORE-AND-INVARIANTS.md) §1 and §4: find
material that captures enterprise integration across business logic, execution and org-wide management (many processes,
legal entities, roles, systems of record, shared invariants, change control), so that an "org twin" bed can be built.
It extends, and does not repeat, [CATALOGUE.md](../enterprise-20261014/CATALOGUE.md) §5 Part B and §12 and
[BAR-SET.md](../enterprise-20261014/BAR-SET.md) §0. Branch `claude/intelligent-hamilton-vg1f9a` at `d4aa3a5`, about
12:20 UTC.*

*Cost $0: no model calls of our own; WebSearch, WebFetch, Exa, the Zenodo, DataCite, Hugging Face and Federal Register
APIs, `git ls-remote`, and treeless shallow clones. Nothing was installed, built or executed from third-party code. No
install hook ran. No account was created. Clones are `--depth 1 --filter=blob:none --no-checkout --no-recurse-submodules`
with hooks off and LFS smudge off. They live in `/var/tmp/foundry-work/org-scale-src/` (94 MB including data), outside
the repo, and nothing there is committed. Four small CC BY 4.0 datasets (42 MB) were downloaded after md5 checks against
Zenodo. Web, clone and dataset text was treated as data. This is development and diagnostic evidence; nothing here is a
held-out claim.*

**Evidence tags.** These follow CATALOGUE.md, plus one new tag:

| tag | meaning |
|---|---|
| [code] | read in a local clone at the pinned SHA (file:line) |
| [data] | measured this session from a downloaded file |
| [meta] | registry metadata read this session (Zenodo, DataCite, Hugging Face, Federal Register APIs) |
| [doc] | a document or page opened this session |
| [page] | a landing page opened; the data itself not downloaded |
| [snip] | search-result text only |
| [I] | inference |
| [unavail] | tried and not obtained |

**Layer codes.** B = business logic (rules, decisions); E = execution (real or simulated runs, state); O = org-wide
management (several processes, entities, roles, shared invariants, change control).

**Use codes.** GT = ground-truth execution; OR = oracle; INV = invariant source; GEN = generator seed; CAL = calibration
of distributions.

---

## 0. Bottom line

1. **No public source contains a whole organisation with an oracle.** Every candidate covers one or two layers. The org
   twin has to be assembled from four kinds of material:
   - executable ERP semantics (Tryton, Odoo, ERPNext);
   - object-centric execution traces (OCEL 2.0, BPI);
   - real layered rule stacks with dated changes (US federal financial management: FAR, DATA Act Broker, USSGL);
   - governance catalogues (NIST 800-53 in OSCAL; PCAOB inspection data).
2. **The best single executable substrate is Tryton** [code] (GPL-3.0):
   - 425 doctest business scenarios across 221 modules, including a two-company, two-currency consolidation;
   - posting refuses unbalanced moves and closed periods;
   - the default database is `sqlite://`, so it is the lightest real ERP to run as a reference oracle.
3. **The newest and most useful execution ground truth is a 2026 Zenodo set** (22079246, CC BY 4.0). It contains six
   synthetic source-system databases, each paired with a reference OCEL that serves as an extraction oracle.
   - Its industrial P2P scenario has 100,504 events, 46,353 objects, 20 object types and 55 event types.
   - Every event carries actor, role and one of 3 source systems [data].
   - Two org invariants hold on all of it: payment only after a passed three-way match, and PO releaser ≠ payment
     approver (0 violations in 3,096 payments and 3,000 pairs) [data]. It is therefore a clean positive population;
     violations have to be injected.
4. **The US federal financial-management stack is the most complete public "org constitution"**: public domain or CC0,
   executable, layered and dated.
   - The DATA Act Broker ships 242 SQL validation rules; 26 are cross-file reconciliations between systems of record
     [code].
   - The USSGL publishes paired proprietary and budgetary posting models and GTAS edits [doc].
   - The FAR micro-purchase and simplified-acquisition thresholds changed on 2025-10-01 (90 FR 41872) [meta]. That is a
     real, dated policy change for the "one policy change" in the slice.
5. **Licences close several obvious doors:**
   - **SAP-SAM:** non-commercial research evaluation only, no derivative works [doc].
   - **Secure Controls Framework:** CC BY-ND 4.0, and it forbids AI-generated derivative content without a paid licence
     of $25,000 a year or more [doc].
   - **No public SAP GRC segregation-of-duties rule set exists** [snip]. ISO 27001 Annex A and COSO are paid and
     copyrighted [I].
   - **iPaaS templates** (MuleSoft, Workato, Boomi) sit under vendor terms and need accounts [snip].
6. **One prior blocker is cleared.** ERP-Bench's Croissant metadata declares CC0 1.0 [meta]; TRUST-BENCHMARKS recorded
   its licence as "not stated". There is still no LICENSE file, so confirm with the authors before redistributing.
7. **The other benchmarks fall short:**
   - World of Workflows needs a ServiceNow developer instance, which is an account and outside AGENTS.md without owner
     approval [code: README].
   - EntCollabBench has no licence [meta].
   - No digital-twin-of-an-organisation (DTO) research artefact with an oracle was found [doc].
8. **Smallest buildable slice** (§10): P2P and R2R close over two entities.
   - Shared invariant: segregation of duties across both processes (NIST AC-5).
   - Policy change: the FAR-dated threshold edition.
   - Sources: Tryton as the reference oracle, ProcureChange for vocabulary and roles and as the monitor's clean
     population, BPI 2019 for calibration.
   - Everything except running Tryton (an install, so the owner decides) is already local or public domain.

---

## 1. Selection rule

An item counts toward the org layer if it shows at least one of:
- several interacting business objects or processes;
- several legal entities or parties;
- roles and authority;
- a rule that spans systems of record;
- rules that change over time under a dated authority.

Items are judged on four things:
- **(a) layers covered** (B, E, O);
- **(b) whether it yields an exact or executable oracle;**
- **(c) licence for local research, and separately for derivatives or commercial use;**
- **(d) acquisition cost:** size, accounts, how heavy it is to run.

Ranking is in §9.

---

## 2. Object-centric and multi-process logs

### 2.1 OCEL 2.0 datasets (all CC BY 4.0 unless noted; Zenodo record @ publication date)

Already catalogued as B10, B11 and B36: the OCEL 2.0 P2P (8412920), Order Management v2 (8428112) and the
LLM-simulated set (13879980). They are not repeated here.

| item | size | content [tag] | layers | use | cost, risk |
|---|---|---|---|---|---|
| **Synthetic relational DBs + reference OCELs** ([22079246](https://zenodo.org/records/22079246), 2026-08-24, A. Berti) | 1,158.5 MB total; 6 scenarios × (source SQLite + 5 OCEL serialisations); P2P reference JSON 7.4 MB | **ProcureChange (P2P)**: 730,158 source rows in 44 application tables, with SAP-style change documents and archive copies [meta]. Reference log [data]: 100,504 events, 46,353 objects, 20 object types (PR, PR item, RFQ, quotation, PO, PO item, schedule line, contract, ASN, GR, goods movement, inspection lot, invoice, invoice item, accounting document, payment proposal, payment, supplier, material, cost centre) and 55 event types. Exceptions include 600 failed three-way matches, 600 invoice blocks and unblocks, 428 price changes, 96 payment reversals, 81 supplier blocks, 272 rejected requisitions and 230 rejected POs. Every event has `actor`, `actor_role` (9 roles: REQUESTER, APPROVER, BUYER, WAREHOUSE, QUALITY, LOGISTICS, AP, TREASURY, PROCESS_OWNER), `source_system` (3), `changed_field`/`old_value`/`new_value`, `source_table`/`source_record_id`; 103 actors; 2023-01-02 → 2024-11-22. **Siblings** [meta]: ForgeFlow engineer-to-order (SalesOrder/Shipment; 58 tables; 97,884 events; 28 object types); ClaimStream insurance (event store with sagas and outbox); PermitFlow (workflow-engine history tables); BatteryVault (bitemporal Data Vault with a *balanced asset journal*); TrialVersion. Deterministic seed `20260820`, 3,000 primary instances each | B, E, (O: roles, 3 systems) | GT for P2P execution; OR for extraction (source DB → canonical events); GEN for the twin's system-of-record schemas; clean population for invariant monitors | Low for the JSON. The P2P source DB is 143 MB, above this task's 50 MB cap (owner decision). **Risk:** synthetic, single author, 2 months old. Audit it as the OCEL P2P was audited (CATALOGUE §5: page claimed three-way match, log had two-way) |
| **OCEL from an SAP ERP IDES instance**: P2P, O2C, transfer order (OCEL 1.0 legacy, converted; [18334009](https://zenodo.org/records/18334009) SQLite 2026-01-22, also [18333927](https://zenodo.org/records/18333927) JSON and [18333978](https://zenodo.org/records/18333978) XML) | 21.0 MB (SQLite set) | Extracted from SAP's IDES demo client, not a live company [doc: ocel-standard.org legacy page]. **P2P** [data]: 24,854 events; 74,489 objects; 32 event types; 8 object types keyed by real SAP keys (EBELN, EBELN_EBELP, BELNR, MBLNR, MATNR, BANFN …); events touch 1–5 object types (median 3 objects, max 221); `resource` attribute; no O2O. **O2C** [data]: 98,350 events; 107,767 objects; 23 event types; 19 object types incl. debit/credit memo requests, returns, invoice cancellation, pro-forma; no resource; no O2O | B, E | GT of real SAP object semantics and document chains; interface realism for SAP mocks | Low. Demo-client behaviour, so tiny variant tails; no actors on O2C |
| **Container Logistics** ([18373888](https://zenodo.org/records/18373888), 2026-01-26) | 46.5 MB | [data] 35,372 events; 13,882 objects; 14 event types; 7 object types (Customer Order, Transport Document, Container, Handling Unit, Vehicle, Truck, Forklift); 15,920 O2O with qualifiers (`CR contains HU`, `TD for CO`, `High-Prio VH for TD`). CPN-simulated. Vehicle capacity is shared with other companies through an external logistics provider [meta] | B, E, (O: two parties) | GT for a cross-party O2C fulfilment leg; batching (G13) | Low |
| Order Management (new record [18373906](https://zenodo.org/records/18373906), 2026-01-26) | 64.3 MB | Same description as 8428112 (B11); relation between the two records not checked | B, E | as B11 | — |
| **BPI Challenge logs in OCEL 2.0** ([22663565](https://zenodo.org/records/22663565), 2026-09-08) | 606.4 MB total: BPIC14 41.1 MB, BPIC15 ×5 2.7–3.8 MB, BPIC16 396 MB, BPIC17 65 MB, BPIC19 87.7 MB | Format conversion of the 2023 OCEL 1.0 versions (Khayatbashi et al., ER 2023) [meta]. BPIC14 links interaction → incident → change | E (real) | Real multi-object traces without our own flattening | BPIC14 is affordable. BPIC19 and BPIC17 exceed 50 MB. The original BPI licences still apply ("cite both") |
| Inventory management DB + OCELs ([21977737](https://zenodo.org/records/21977737), 2026-08-17) | 16.2 MB | Simulated DB with generator scripts; EOQ, safety stock, reorder point; understock/overstock labels [meta] | B, E | GEN for stock policy | Low. Synthetic |
| LRMs collection ([21977764](https://zenodo.org/records/21977764), 2026-08-17) | 84.8 MB | O2C, P2P, hiring, hospital [meta]. Same creator and content description as B36 (13879980) [I] | E (LLM-simulated) | Never as a real distribution | — |
| Collaborative processes → OCEL ([22183242](https://zenodo.org/records/22183242), 2026-08-31, **GPL-3.0**) | 50.8 MB | Converter from collaborative (multi-organisation) XES to OCEL 2.0; mapping rules M1–M8; 14 predictive tasks; arXiv 2608.27671 [meta] | B (cross-org) | Pattern for cross-organisation object models | GPL code, read only |
| P2P conversational QA ([18086659](https://zenodo.org/records/18086659), 2025-12-29) | 0.6 MB | 2,552 boolean question-answer pairs over the OCEL 2.0 P2P log [meta] | — | Oracle shape for "ask the twin" checks | Low |
| Also seen, not assessed for the org layer | — | IoT-enriched cargo pickup at a Chinese port (22019684, 18.9 MB, real deployment per its description [meta]); hinge production; Enron; Ethereum; AoE2; Bundestag; unfair logs | — | — | — |

The OCEL 2.1 format revision (bundled Parquet `.ocel.zip`, CSV) is now used by the 2026 sets [doc: ocel-standard.org].
OCEL tooling note: `pm4py` is **AGPL-3.0** (@`9521745b`, [code] LICENSE). Use it in research scripts only, never in a
shipped component. `Javert899/sap-extractor` (Apache-2.0, @`d06d1a47`) is the open SAP→OCEL extractor from
arXiv 2110.03467 and JIIS 2023 [doc].

### 2.2 Real multi-process and multi-log event data (DataCite rights read 2026-10-21; 4TU itself returned 503 or
connection resets this session)

| log | licence [meta] | what makes it org-relevant | layers | use |
|---|---|---|---|---|
| BPI 2011 hospital (Dutch academic hospital) | 4TU General Terms of Use | many departments in one log | E | CAL |
| BPI 2013 Volvo IT (incidents, open and closed problems: 3 logs) | 4TU GTU | incident → problem escalation across support lines | E | CAL for E7 |
| **BPI 2014 Rabobank ITSM** (4 CSVs: interaction, incident, incident activity, change; HP Service Manager) | parts 4TU GTU; OCEL version CC BY 4.0 | the only real log linking **interaction → incident → change** across ITIL processes; its stated purpose is predicting the service-desk impact of changes [meta] | E, O (change control) | GT and CAL for the ITSM-change leg of the twin; the CATALOGUE listed it [unavail] |
| BPI 2015 (5 Dutch municipalities, building permits, ~4 years) | 4TU GTU; OCEL CC BY 4.0 | the same process in 5 organisations, which "should be identical, but may differ slightly", including when changes are made [meta] | E, O (5 variants of one policy) | CAL for cross-entity variance |
| BPI 2016 UWV (clicks, complaints, questions, messages) | 4TU GTU | multi-channel customer journey of one agency | E | — |
| BPI 2017 / 2012 loans | 4TU GTU | already measured (CATALOGUE §5.2) | E | E9 |
| **BPI 2018 EU direct payments** (German farmers, profil c/s) | **CC0 1.0** | 43,809 applications; 2,514,266 events; 3 years; document-centric (documents with states and actions); batch runs. "The process repeats every year with minor changes due to changes in EU regulations" [meta] | E, O (**regulation-driven drift**) | The only real log whose generating mechanism is a yearly rule edition. Use it for policy-change and drift detection (G10, E13-style editions) |
| BPI 2019 P2P | CC BY 4.0 | already measured (CATALOGUE §5.2) | E | CAL for P2P |
| **BPI 2020 travel** (5 logs: domestic, international, prepaid travel cost, request for payment, travel permit) | CC BY-NC 4.0 | linked documents (permit ↔ declarations); approval chain administration → budget owner → supervisor (→ director); 2017 two departments, 2018 whole university [meta] | E, O (DoA chain, org roll-out) | CAL for DoA routing; research use only |
| Hospital Billing (2017) | 4TU GTU | **financial module of a hospital ERP**; 100,000 traces over 3 years [meta] | E | CAL for billing / R2R-adjacent |
| Road Traffic Fines (2015) | 4TU GTU | fine → notification → appeal to prefecture or judge → payment or credit collection | E, O (several authorities) | CAL |
| Event graphs of BPIC 2014/15/16/17/19 (4TU, 2021) | CC BY 4.0 | multi-entity event knowledge graphs [meta] | E | alternative to OCEL |

No BPI Challenge dataset after 2020 is registered in DataCite (query on 2026-10-21) [meta]. The 2026 additions are OCEL
conversions only. The "4TU General Terms of Use" text was not re-read this session.

---

## 3. Process-model collections

| item | version, size, licence | org-layer content | verdict |
|---|---|---|---|
| **SAP-SAM** ([Zenodo 7012043](https://zenodo.org/records/7012043)) | v0.5.1, 2022-08-20; 4,757.58 MB; **"Non-Commercial Research purposes of evaluating Recipient's algorithms … no rights to make derivative works"** [doc: signavio/sap-sam README @`dac1eb71`; code is Apache-2.0] | 1,021,471 models by 72,996 users (2011–2021); about 470,000 bear example-model names. Notations include BPMN process, **collaboration** and choreography models, **DMN**, CMMN, EPC, value chains, **ArchiMate**, **organisation charts** [doc: arXiv 2208.12223] | Evaluation-only. It cannot seed a generator or appear in anything we ship. It exceeds the disk and the 50 MB cap. **Do not acquire** |
| **BPMAI** ([Zenodo 3758705](https://zenodo.org/records/3758705)) | BPMAI-29-10-2019, 2020-04-20; 387.7 MB; **CC BY 3.0** [meta] | 29,810 models (a subset of the same academic workspace), with revisions; JSON | Usable for structure statistics, including collaboration share. Above the 50 MB cap; owner decision. Student-made models |
| **EA ModelSet** ([Zenodo 8192011](https://zenodo.org/records/8192011) v0.0.2, CC BY 4.0; GitHub `me-big-tuwien-ac-at/EAModelSet` @`4ebe3054`, v0.0.3) | 863 → 978 ArchiMate models; per-model source licence recorded; repo has no root licence file [doc, meta] | business, application and technology layers: actors, roles, application landscapes; 10–4,003 elements per model [doc: PoEM 2023 paper] | GEN seed for "which systems of record, owned by whom" |
| Camunda 7/8, Zeebe, BPMN-MIWG | — | already B25, B27, B28 | — |
| "PMLB" | — | not found under that name [unavail] | Ask the owner for its source |

---

## 4. Open-source ERP, CRM and HR as executable business semantics

All rows: treeless clone at the default-branch HEAD, 2026-10-21 [code]. File counts come from `git ls-tree` (no
checkout).

| system (licence) | pin, commit date | files | rule tests and scenarios | invariants found in code | multi-entity | run weight [code/I] |
|---|---|---|---|---|---|---|
| **Tryton** (GPL-3.0 per module LICENSE) `tryton/tryton` | `b09f5949`, 2026-10-20 (GitHub copy of a Mercurial/heptapod monorepo: `.hgtags`, `.gitlab-ci.yml` in tree [I]) | 13,528; 221 modules | **425 `tests/scenario_*.rst` doctests**, e.g. reconciliation (6), `scenario_close_fiscalyear`, `scenario_renew_fiscalyear`, dunning (5), landed cost, tax-cash period close, `purchase_requisition`, `stock_period`, **`account_consolidation/tests/scenario_consolidation.rst`** (204 lines: two companies, USD and EUR, one user across both) | `modules/account/move.py:449` `post` → `:494` `msg_post_unbalanced_move`; closed-period refusals at `:317` and `:409`; reconciliation balance `:688` | multi-company and consolidation in core modules | **Lightest real ERP**: default DB `sqlite://` (`trytond/trytond/config.py:63–64`); SQLite backend in core. Running needs a pinned `pip install` (an install step, so the owner decides) |
| **Odoo Community** (LGPL-3.0) `odoo/odoo` | `2b504bcb`, 2026-10-21, branch 20.0 | 50,548; 642 addons | 2,020 `tests/test_*.py`; 83 in account and stock_account, e.g. `test_account_inalterable_hash.py`, `test_account_lock_exception.py`, `test_stockvaluation.py`, `test_multicompany_lot_valuation.py`; 347 demo data files | `addons/account/models/account_move.py:2935` `_check_balanced` → `:2946` "The entry is not balanced."; `:2976` `_check_fiscal_lock_dates`; inalterability hash `:364` | multi-company yes. **No inter-company addon in Community** (0 of 642 manifests match `inter_company`): inter-company rules are Enterprise-only [I] | PostgreSQL plus Python. ERP-Bench uses Odoo 19 |
| **ERPNext** (GPL-3.0) `frappe/erpnext` | `e02e7160`, 2026-10-21, develop | 5,846 | 573 `test_*.py`; demo data `erpnext/setup/demo.py` and `demo_data/*.json` | `erpnext/accounts/general_ledger.py:460–462` "Debit and Credit not equal"; `erpnext/stock/stock_ledger.py:67` `NegativeStockError`, `:1686` `validate_negative_stock`; **inter-company** `…/sales_invoice/services/inter_company.py:10` `validate_inter_company_party` (throws at `:47`, `:49`); accounting-period and period-closing doctypes | yes, including inter-company invoices | MariaDB, Redis and Node (bench); heavy [I] |
| Frappe HRMS (GPL-3.0) `frappe/hrms` | `7fc314bd`, 2026-10-20 | 1,660 | 128 tests | — | — | as ERPNext |
| **Apache OFBiz** (Apache-2.0) `apache/ofbiz-framework` | `cc687ca4`, 2026-10-21, trunk | 6,547 | 67 `testdef` XML files: accounting, invoice, payment application, fixed asset, MRP, production run, order, quote | — (services not read) | parties and organisations [I] | JDK 17 (`README.md:73`); embedded H2 by default (`framework/entity/config/entityengine.xml:55`); `./gradlew cleanAll loadAll` loads demo data (`README.md:122`); `testIntegration` (`:239`). **Only permissive-licence ERP in the set** |
| **metasfresh** (GPL-2.0, `backend/LICENSE.md`) | `684b536b`, 2026-10-21, `new_dawn_uat` | 45,881 | **419 Cucumber `.feature` files**: contract 37, materialDispo 30, invoice 20, **edi 20**, distributionOrder 19, order 16, delivery 14, purchaseOrder 12, costing 12, invoicecandidate 11, bankStatement 6, tax_declaration 3 … | in the Gherkin steps (not read) | yes (ADempiere lineage) | Heavy: Postgres, RabbitMQ, search, PostgREST and more (`misc/dev-support/docker/infrastructure/docker-compose.yml`). The feature files are readable specifications without running anything |
| **iDempiere** (GPL-2.0) | `11d707dd`, 2026-10-21 | 12,769 | 157 JUnit classes in `org.idempiere.test`, e.g. `MatchInvTest`, `MatchPOTest`, `MatchInv2ndAcctSchemaTest`, `AllocationTest`, `AveragePOCostingTest`, `InventoryTest`, `MOrgTest` | (tests imply match and allocation rules) | GardenWorld demo client with organisations (seed history in `migration-historic/`) | PostgreSQL plus Java/OSGi [I] |
| Dolibarr (GPL-3.0) | `9310b5a7`, 2026-10-21 | 15,659 | 162 phpunit tests | — | multi-company is an external module [I, not checked] | PHP plus SQL |
| OpenBoxes (EPL-1.0) | `c89028fc`, 2026-10-20 | 6,447 | 180 test files | — | multi-location supply chain [I] | Grails plus MySQL [I] |
| SuiteCRM 8 (AGPL-3.0) `SuiteCRM-Core` | `62519568`, 2026-10-20, branch `hotfix` | 12,635 | 241 `*Test.php` | `AOW_` workflow module (conditions and actions) | — | PHP plus MySQL. AGPL: read only |
| OrangeHRM (GPL-3.0) | `56e23b3b`, 2026-06-29 | 4,083 | 596 `*Test.php`; plugins include Leave, Claim, Time, Attendance, Performance, Recruitment, PIM | — | — | PHP plus MySQL |
| **Apache Fineract** (Apache-2.0), core banking (adjacent) | `b94b2ddf`, 2026-10-20 | 8,447 | 85 integration tests incl. `AccountingScenarioIntegrationTest`, `JournalEntryReversalOrderingIntegrationTest`, **`LoanDisbursementMakerCheckerIntegrationTest`** (four-eyes), `AccountingRuleIntegrationTest` | maker-checker and accounting rules | multi-office [I] | Java plus SQL [I] |

**What this gives the twin** [I]:
- **Tryton** is the reference transition function for GL, AP, AR, stock, purchase, sale and consolidation, with
  executable golden scenarios.
- **Odoo and ERPNext** give independent second and third implementations of the same invariants (balanced entry,
  closed or locked period, negative stock, inter-company party checks), which make N-version oracles possible.
- **metasfresh's 419 feature files** are the largest public corpus of Given/When/Then ERP business scenarios. They seed
  rules and tests, and running metasfresh is not required.
- **OFBiz** is the one permissive ERP if a non-copyleft reference is ever needed.
- **Copyleft and AGPL code** stay in separate-process oracles and read-only specifications, never in the engine.

---

## 5. Org-wide governance artefacts (invariant ground truth)

| item | pin, licence | content | layers | use | caveat |
|---|---|---|---|---|---|
| **NIST SP 800-53 rev 5 in OSCAL** (`usnistgov/oscal-content` @`78650f02`, 2026-05-13) | **public domain** [code: LICENSE.md] | catalog v5.2.0, last modified 2026-05-11. **20 families, 324 base controls, 872 enhancements** [data: 10,442,037-byte JSON, sha256 `01f37cf9…`, deleted after counting]. Includes **AC-5 Separation of Duties, AC-6 Least Privilege, AU-9, CM-3 Configuration Change Control, CM-4 Impact Analyses, CM-5 Access Restrictions for Change**. Low, moderate and high baselines as resolved profiles | O | INV text for SoD, change control and audit-trail invariants; machine-readable control IDs | IT controls, not financial controls. SOX ITGC maps onto it only by convention [I] |
| **PCAOB inspection datasets** ([news release 2025-04-28](https://pcaobus.org/news-events/news-releases/news-release-detail/pcaob-makes-available-new-downloadable-datasets-featuring-pcaob-inspection-findings-from-audit-firm-inspection-reports)) | US public body; terms not read | Part I.A and I.B deficiency datasets in CSV, XML and JSON; 2018 onward for annually inspected firms, 2019 onward for triennially inspected firms; quarterly updates. Fields: full description, issuer key, **audits affected (financial statements and/or ICFR)**, classification, **audit area**, risk, auditing standard and paragraph. A firm-level dataset covers 4,000+ reports [doc via Exa; WebFetch got 403] | O (what fails in practice) | Base rates for which control areas fail, to weight the twin's shocks and audits | Auditor-side deficiencies, not company control failures. Audits sampled for inspection are not representative (PCAOB's own caveat) |
| SEC 10-K Item 9A and ICFR | public | The 10-K cover page has a tagged **ICFR auditor attestation flag** (dei) [snip]. EDGAR full-text search can find "material weakness" text [I]. Audit Analytics' internal-controls database is paid [snip] | O | Real material-weakness narratives; a classification is ours to build | EDGAR's fair-access policy requires a declared User-Agent with a contact. The owner must provision it; do not use the user's e-mail automatically |
| **Secure Controls Framework** | **CC BY-ND 4.0**. Terms forbid "utilizing Artificial Intelligence … to leverage SCF content to generate policies, standards, procedures, metrics …" without a commercial licence (Tier 1 $25,000 a year; Tier 2 from $200,000) [doc: terms and commercial-licence pages] | 1,400–1,500+ controls; 200+ framework mappings (ISO 27001 and SOC 2 named; SOX and COSO not confirmed); CSV and OSCAL [snip] | O | Read-only cross-walk reference at most | **Conflicts directly with a product that generates controls with models.** Do not build on it |
| AICPA Trust Services Criteria 2017 (points of focus revised 2022) | free download after an account; copyright notice [snip] | SOC 2 criteria | O | Reference only | Account needed; terms not read |
| COSO 2013; ISO/IEC 27001:2022 Annex A | sold, copyright [I, not opened] | — | O | Cite by ID only | Use NIST 800-53 as the open substitute |
| SoD rule sets | — | **No public SAP GRC standard rule set.** An SAP Community thread asking for an "official SAP standard matrix" got none; SAP says conflicts are the customer's to define [snip] | O | — | We must author conflict pairs ourselves, derived from AC-5, the ProcureChange role taxonomy and ERP role models. That makes them **our** invariant, so freeze them before evaluation |
| Delegation-of-authority instruments | Australian PGPA (Finance Minister to Accountable Authorities) Delegation 2022, amended 2025-09, 2026-03-02 and 2026-07-20 [snip: finance.gov.au] | A real DoA instrument with a dated amendment history | O | INV and change-control seed | Thresholds not read; legislation.gov.au not opened |
| **FAR thresholds** | public domain (US government work) [I]; `GSA/GSA-Acquisition-FAR` @`da52ccbb` (no licence file) | **90 FR 41872**, published 2025-08-27, **effective 2025-10-01**: inflation adjustment of acquisition thresholds [meta: Federal Register API]. Micro-purchase $10,000 → $15,000; simplified acquisition $250,000 → $350,000; FAR 6.304 justification approval $750,000 → $900,000 [snip; figures in secondary sources, consistent] | B, O | **Dated policy edition for the slice** | Federal procurement rule transplanted into a corporate twin. Label it as a synthetic policy edition with real provenance |

---

## 6. Enterprise integration and cross-system sagas

| item | pin, licence | content | verdict |
|---|---|---|---|
| FTGO application (`microservices-patterns/ftgo-application`) | `558dfc53`, last commit 2022-09-03; Apache-2.0 | services for order, kitchen, **accounting**, consumer, delivery and restaurant. Sagas `CreateOrderSaga`, `CancelOrderSaga`, `ReviseOrderSaga` with undo commands (`UndoBeginCancelCommand`, `UndoBeginReviseOrderCommand`, `ReverseOrderUpdateCommand`), and an accounting authorisation step [code] | Adds **revise and cancel** sagas across a financial service, which B13 and B19 lack. Stale since 2022 |
| Eventuate customers-and-orders | `894f2dbb`, Apache-2.0 | credit-reservation saga | Small; overlaps E8 |
| Apache Camel examples | `14d4a335`, Apache-2.0; 62 example directories | mostly technical (aggregate, kafka); only `salesforce-consumer` touches a SaaS system of record [code] | Low value for the org layer |
| Apache Camel Kamelets | `4b6c4b1b`, Apache-2.0 | connector catalogue (not counted) | Connector vocabulary only |
| MuleSoft Anypoint templates (e.g. SAP↔Salesforce account, order, opportunity broadcast and migration) | **MuleSoft License Agreement**; private Maven dependencies [snip: Exchange listings] | integration shapes between Salesforce and SAP or S/4HANA | Read the listing pages for shape; no code acquisition |
| Workato community library | community policy plus account; 500,000+ recipes [snip] | — | Not acquirable under our rules |
| Boomi Discover recipes and process library | account required [snip] | NetSuite↔Salesforce and order-to-cash recipes | Not acquirable |
| Celigo templates | [unavail] | — | — |
| Temporal, Camunda, Conductor and Dapr sagas | — | already B13, B14, B18–B22, B31 | — |

**Verdict** [I]: public integration material is still single-process plumbing. It adds nothing at the org layer beyond
FTGO's multi-service compensation. The cross-system invariants in §5 and §8 (DATA Act cross-file rules, EN 16931) are
better integration oracles than any template gallery.

---

## 7. Simulators and org-scale agent benchmarks

| item | pin, licence | what it simulates; oracle | org layer? | verdict |
|---|---|---|---|---|
| **ERP-Bench (Anchor)** HF `anonymouse321/erp-bench` | `ebdb941f`, 2026-05-07; **Croissant `license`: CC0 1.0**, v0.1.0 [meta]; no LICENSE file; card has no licence | Real Odoo 19. 300 procurement and manufacturing tasks compiled from one CP-SAT specification; terminal-state verifier over Odoo records; one seeded Odoo environment per task (7,309 files: 3,600 under `tasks/` and 3,600 under `tasks_ui/`) [meta, README] | B, E (single company) | **External anchor with an exact verifier on a real ERP.** Heavy per-task Odoo. Confirm the licence with the authors before redistributing |
| **EnterpriseOps-Gym** GitHub `ServiceNow/EnterpriseOps-Gym` | `271f2c35`, Apache-2.0; HF `ServiceNow-AI/EnterpriseOps-Gym` @`c8e538ea`, apache-2.0 | 1,150 tasks; 8 domains incl. HR, ITSM, CSM, hybrid; 164 tables; SQL verifiers for goal, integrity and policy; `gym_dbs.zip` 14,527,720 bytes; per-domain oracle parquet [code, meta] | B, E; cross-domain but not cross-entity | Cheap anchor for policy-plus-integrity verifiers (already in TRUST-BENCHMARKS) |
| **World of Workflows** (`Skyfall-Research/world-of-workflows`) | `a6e9badc`, MIT | README: a ServiceNow-based mock enterprise with "over 6,000 interlinked tables and 93 workflows". Search snippet of the paper: 4,000+ business rules and 55 workflows (**inconsistent**). **Requires a ServiceNow developer instance and an OpenRouter key** [code: README] | O (hidden cascading side effects) | **Blocked**: account creation is outside AGENTS.md without owner approval. The idea to borrow is grading *hidden side effects* |
| EntCollabBench (arXiv 2605.08761) | GitHub `yutao1024/EntCollabBench` @`9d085fcb`, **no licence**; HF `Kirito-Lab/EntCollabBench` @`df95c873`, no licence | 11 role-specialised agents across 6 departments with permission isolation; Workflow subset graded by DB state diffs; Approval subset graded by deterministic policy adjudication [doc] | O (roles, approvals) | Read-only design reference |
| Era by Eon (arXiv 2609.09853, 2026-09-09) | code and licence not found | **One seeded entity graph feeds simulators** of Salesforce, Zendesk, Slack and Gong, plus generated internal DBs. Answers are computed from final records, so grading is exact. 23 generated companies [doc: abstract] | O (one consistent estate) | **The closest published design to the org-twin generator**; cite as precedent |
| EnterpriseBench (EMNLP 2025, arXiv 2510.27287) | licence not checked | 500 tasks; RBAC across role levels and departments; CRM, ITSM, HR and mail data [doc] | O (access control) | Secondary |
| OrgAccess (arXiv 2505.19165) | "open-sourced", licence not checked | 40 permission types; 70,000 permission-reasoning items; GPT-4.1 F1 0.27 on hard items [doc] | O (RBAC reasoning, not execution) | Secondary |
| ERPsim (HEC Montréal) | proprietary; runs on a real SAP system via SAP University Alliances; about 300 universities [snip] | multi-team make-to-stock market game | B, E, O | Not acquirable |
| Beer Game `orlov-ai/beer-game-env` | `c78b69e2`, MIT | 4-echelon gym environment; cost function | E | Tiny multi-party supply-chain shock generator |
| OR-Gym `hubbs5/or-gym` | `0b18d16e`, MIT | supply-chain and inventory environments | E | as above |
| Prosimos | `76636886`; **no root licence file** | business process simulator | E | Read-only |
| DORY (BPM 2026 demo) | licence not checked | object-centric simulator with dynamic relations [doc] | E | Watch |
| DTO research | — | Knopp (RWTH) object-centric simulation for organisational digital twins; Fornari et al. 2025 manifesto ("no data was used"); 2026 systematic review [doc] | — | **No public digital twin of an organisation with an oracle exists** |

OpenAlex could not be used. Its shared daily budget was exhausted, and registering a key would have needed the user's
e-mail, which the rules forbid. Exa was used instead [unavail].

---

## 8. Niche and adjacent sources that remove blockers

| item | pin, licence | content [tag] | blocker it removes |
|---|---|---|---|
| **DATA Act Broker** (`fedspendingtransparency/data-act-broker-backend`) | `bed939e6`, 2026-10-14; **CC0 1.0** | `dataactvalidator/config/sqlrules/`: **242 SQL rules** (FABS 122, File B 45, File C 37, File A 29, FABS-required 9). `sqlRules.csv` flags **26 cross-file rules**. Examples: A18 "GrossOutlayAmountByTAS_CPE in File A must equal the sum of … in File B"; A19, the same for obligations with sign inversion; A30.1/A30.2, every TAS in A exists in B and vice versa [code] | **Executable reconciliation invariants between systems of record** (financial system ↔ program/object-class ↔ award systems), written by a real regulator, with fatal/warning severity |
| **USSGL TFM supplement** ([tfx.treasury.gov](https://tfx.treasury.gov/tfm/supplements/ussgl/ussgl-part-1)) | US government work [I] | Part 1 FY2026: chart of accounts, **account transactions with proprietary and budgetary entries per event** (categories A–H), T-accounts, **GTAS validations and edits**; bulletins 2026-03 and 2026-05 revise it mid-year. Notes require matching transfer-in/transfer-out accounts, otherwise "agency-wide and/or government-wide elimination discrepancies" [doc] | **Posting models as data** (event → entries) plus intragovernmental **elimination matching**, the public analogue of intercompany elimination, with dated bulletins as change control |
| **EN 16931 e-invoicing validation** (`ConnectingEurope/eInvoicing-EN16931`) | `6e35e0ab`, 2026-10-12; **EUPL-1.2** | Schematron for UBL, CII and EDIFACT syntaxes (model, syntax and code-list layers); tests: 206 UBL invoice and 71 credit-note unit files plus 29 more; examples: 17 UBL, 15 CII, 9 EDIFACT [code] | Executable **document arithmetic and party rules** for the O2C/P2P hand-off between two companies (invoice totals, VAT breakdown). A second implementation exists in Peppol BIS Billing 3 (`OpenPEPPOL/peppol-bis-invoice-3` @`261c4584`, no licence file found, read-only) |
| **XBRL US DQC rules** (`DataQualityCommittee/dqc_us_rules`) | `64abefd3`, 2026-10-19; licence permits copying and derivative works that "assist in its implementation", with notice [code: License.md] | **209 rule IDs**, 1,076 `.xule` files across taxonomy years (e.g. DQC_0004, DQC_0008) [code] | **R2R output-level invariants** over financial statements (consistency and sign rules). Pairs with SEC financial-statement datasets as a real calibration population |
| **OCDS** (`open-contracting/standard` @`eb57a46e`, branch 1.2-dev, Apache-2.0) plus **Cardinal** (`open-contracting/cardinal-rs` @`0b28400d`, MIT) | schema permissive; data licences vary by publisher [page] | Full public-procurement lifecycle (planning, tender, award, contract, implementation) with party roles (buyer, procuring entity, tenderer, supplier, payer). Data Registry: **100+ publishers**, bulk JSON, Excel and CSV [page]. Cardinal: **11 red-flag indicators** (R003 short submission period, R018 single bid, R024 price close to winning bid, R025, R028 identical bid prices, R030 late bid won, R035, R036 lowest bid disqualified, R038, R048, R058) [code, doc] | **Real multi-party procurement at volume, with lifecycle stages**, plus soft invariants (red flags) to weight the procurement leg |
| UN/EDIFACT directories (UNECE); ASC X12 | EDIFACT free from UNECE [snip]; X12 is a paid standard [I]; `azoner/pyx12` @`196e7ec0` (BSD-style) | ORDERS → ORDRSP → DESADV → INVOIC cycle [snip] | Multi-party message choreography (G1 correlation). EN 16931 already covers invoice semantics |
| ISO 20022 samples | bank sample files (PostFinance, Goldman Sachs portals) [snip]; ISO repository terms [unavail] | pain.001 and camt.053 | Treasury leg (payment run → statement → reconciliation); later |
| Synthea (`synthetichealth/synthea` @`3e457b7c`, Apache-2.0) | — | payer agents and insurance plans exist (`src/main/resources/payers/insurance_companies.csv`, `insurance_plans.csv`, `…/agents/Payer.java`: HTTP 200 at the pin) [code] | Payer–provider multi-organisation flows. **Defer**: AGENTS.md's patient-operations boundary needs owner scope approval even for synthetic data |
| Microsoft AdventureWorks and WideWorldImporters (`microsoft/sql-server-samples` @`3b65ec4a`, MIT) | MIT [code: license.txt] | Sales, purchasing, production, HR and person schemas in one database; WideWorldImporters adds temporal history tables [I, not opened] | Cheap **multi-department system-of-record seed** with history |

---

## 9. Ranking: top 8 for an org-twin bed that tests cheap-model construction under org invariants

The criteria weigh three things:
- **org-layer coverage and oracle exactness** (highest weight);
- **licence for local research, then for derivatives**;
- **acquisition cost** (size, accounts, run weight).

Scores are a judgement [I], not a measurement.

| rank | source | layers | role in the bed | why above the next | main risk |
|---|---|---|---|---|---|
| **1** | **Tryton** (GPL-3.0, @`b09f5949`) | B, E, (O: multi-company, consolidation) | **Reference transition function and N-version oracle** for GL, AP, AR, stock, purchase and close. 425 scenarios are golden tests and task seeds | The only real ERP that runs on SQLite, ships executable business narratives, and covers consolidation of two companies in two currencies | Running needs a pinned install (owner); GPL keeps it a separate process |
| **2** | **US federal financial-management rule stack**: FAR 90 FR 41872, DATA Act Broker (CC0, @`bed939e6`), USSGL TFM (public domain) | B, O | **Layered invariants with authority and dates**: statute → regulation → agency edits; cross-system SQL reconciliations; posting models as data; dated editions | The only public source with real, versioned, executable org-level rules and a real change history | Public-sector semantics. The corporate twin must label transplanted rules as synthetic editions |
| **3** | **Synthetic relational DBs + reference OCELs** (Zenodo 22079246, CC BY 4.0), led by ProcureChange | B, E, (O: roles, 3 source systems) | **Execution ground truth with actors and roles**; extraction oracle; schema seed; clean population for invariant monitors (0/3,000 SoD and 0/3,096 payment-before-match violations measured) | Multi-object with roles and source provenance, permissively licensed, small | Synthetic and new; audit before use |
| **4** | **BPI real logs**: 2019 P2P (CC BY), **2018 (CC0, regulation-driven yearly drift)**, 2020 (CC BY-NC, DoA chain), 2014 (ITSM interaction → incident → change) | E, (O) | **Calibration** of variant tails, durations, approval chains and **drift across rule editions** | Real behaviour that no generator reproduces; BPI 2018 is real policy drift | BPI 2020 is non-commercial; 4TU was unreachable this session |
| **5** | **ERP-Bench** (CC0 per Croissant; Odoo 19) | B, E | **External anchor**: exact CP-SAT-backed verifiers on a real ERP; also a check that our twin's P2P and manufacturing semantics agree with Odoo | Third-party results on the same oracle | Heavy per-task Odoo; licence only in metadata |
| **6** | **NIST SP 800-53 rev 5 OSCAL** (public domain) **+ PCAOB Part I.A/I.B datasets** | O | **Invariant vocabulary** (AC-5 SoD, AC-6, CM-3/4/5 change control, AU-9) and **failure base rates** by audit area | Machine-readable, open, and the substitute for licence-blocked ISO, COSO, TSC and SCF | IT-control framing; PCAOB samples are not representative |
| **7** | **EN 16931 Schematron + tests** (EUPL-1.2) | B, (O: two parties) | **Inter-company document oracle** for the O2C ↔ P2P hand-off (an intercompany invoice must validate on both sides) | Executable, versioned, with test files | Invoice-only; not process-level |
| **8** | **N-version ERP corpus**: Odoo CE (LGPL), ERPNext (GPL; has inter-company), metasfresh (419 features) | B, E | **Second and third implementations** for N-version oracles; feature files as rule and test seeds | Gives independence to the oracle that rank 1 alone cannot | Heavy to run; Odoo CE lacks inter-company rules |

**Next in line**: OCDS plus Cardinal (multi-party procurement at volume); EnterpriseOps-Gym (cheap cross-domain policy
verifiers); XBRL DQC (R2R output invariants); the SAP-IDES OCELs (real SAP keys); EA ModelSet (system landscape
seeds); FTGO (revise and cancel sagas).

**Excluded for licence or access**: SAP-SAM, SCF, World of Workflows (account), ERPsim, MuleSoft, Workato and Boomi
templates, EntCollabBench (no licence).

---

## 10. Smallest buildable slice: "OT-0"

**Claim it can test** [I]: a cheap model, constructing from frontier-written templates, builds two workflows. The
workflows compose over shared systems of record. Neither violates a shared org invariant, before or after a dated policy
change that arrives through change control. A simple baseline fails at least one of these.

**World** (seeded, simulated 3 months):
- **Entities:** two legal entities, E-US (USD) and E-EU (EUR). This mirrors Tryton's `scenario_consolidation.rst`
  pattern.
- **Systems of record:**
  - GL with AP sub-ledger and GR/IR clearing, using Tryton semantics;
  - procurement store, using a ProcureChange object subset (requisition, PO, PO item, GR, invoice, payment proposal,
    payment);
  - identity and role directory, using ProcureChange's 9 roles;
  - policy store: a dated delegation-of-authority (DoA) table, with an effective date on each row.

**Two processes** (cheap-model-built from templates):

| process | steps | oracle |
|---|---|---|
| **P (P2P)** | requisition → DoA approval → PO → goods receipt → invoice → three-way match (E1 tolerance rules) → payment proposal → approval → payment. Posts AP and GR/IR to the GL. One intercompany purchase E-EU → E-US per month | E1 process oracle (BAR-SET); Tryton-equivalent posting for sampled cases |
| **R (R2R month-end close)** | GR/IR accrual → AP sub-ledger ↔ control reconciliation → intercompany balance agreement E-US ↔ E-EU → period lock | Exact on ledger state. Tryton refuses unbalanced and closed-period posting (`move.py:317, :494`), which gives N-version agreement |

**One shared invariant: I-SoD** (from NIST AC-5, instantiated by us and frozen before evaluation).
- **Rule:** on any P2P chain, three identities are pairwise distinct:
  1. the one who approved the PO;
  2. the one who released the payment;
  3. any identity that posted a manual journal touching that chain's AP or GR/IR accounts during R's close.
- **Why it is shared:** it spans P and R, and only the journal joins them.
- **Static check:** each workflow's approval and effect graph, checked against the role matrix before deployment.
- **Runtime check:** the actual identities in the journal, checked after each run.
- **Clean population:** ProcureChange shows 0 violations on 3,000 PO-release/payment-approval pairs [data].
- **Monitor validation:** inject violations into copies of those traces (same actor in two roles). The monitor must
  catch every one, or no claim is made.

**One policy change: C-DoA** (real provenance).
- **Editions:**
  - v1: micro-purchase $10,000, simplified acquisition $250,000.
  - v2: $15,000 and $350,000, effective 2025-10-01 (90 FR 41872) [meta].
- **How it arrives:** at month 2 it comes in as a version-bound proposal, approved by the policy-layer authority (CAS
  on the policy store).
- **Pinning:** requisitions created before the effective date keep v1. This is declared, and it exercises G10
  (versioning of in-flight instances).
- **The trap:**
  - Raising the threshold removes an approval step for $10,000–$15,000 purchases.
  - A naive rebuild may let the requester's manager act as both approver and payment releaser for those purchases,
    which violates I-SoD.
  - The right construction keeps thresholds as data and leaves the role graph untouched.

**Grading per seeded world and month:**
1. P passes the E1 oracle;
2. R's ledger state equals the oracle's;
3. composition: R's GR/IR and AP balances equal the sum of P's postings;
4. zero I-SoD violations, static and runtime;
5. each requisition is routed under its pinned edition.

The capability number is the share of world-months passing all five, reported as pass^k over seeds before and after
C-DoA.

**Baselines (must fail the tail):**
- a single-prompt Haiku workflow given the policy text;
- the template without the invariant layer.

**Development vs sealed:** seeds and months are split. The C-DoA edition text is frozen before any run.

**Calibration:** BPI 2019 variant mix and durations for P [data, CATALOGUE §5.2]. BPI 2018 is a later drift test, not
part of OT-0.

**Cost and risk:**

| item | status |
|---|---|
| Local material | ProcureChange JSON 7.4 MB (sha256 `6ace1648…`) is already local. The NIST text and FAR rule are public domain. The E1 rules are already in BAR-SET |
| Install needed | Tryton, only for the N-version check (pinned `trytond`, `proteus` and modules). This is an owner decision. Without it, OT-0 still runs on our own mock, with Tryton scenarios read as specifications |
| Risks | The I-SoD conflict pairs are ours, which risks circularity. ProcureChange is unaudited synthetic data. The FAR rule is transplanted into a corporate twin |

**OT-1 extension, once OT-0 holds:**
- Add an R2R → external-reporting leg graded by DATA Act-style cross-file rules (A18, A19, A30).
- Add an EN 16931 check on the intercompany invoice.
- Add BPI 2014's ITSM change process as a third process under CM-3 change control.

---

## 11. What was not found (remaining blockers)

1. **No real multi-entity ERP log with intercompany flows** is public. BPI 2019 has about 60 subsidiaries (CATALOGUE
   B1), but no intercompany document links were seen in it [I]. Group-level realism stays synthetic.
2. **No public SoD rule set from a GRC vendor.** Conflict pairs must be authored and frozen by us.
3. **No public digital twin of an organisation with an oracle.** The closest designs are Era by Eon (one seeded entity
   graph feeding many simulators) and WoW (hidden side effects). Neither is acquirable as a bed today.
4. **ISO 27001 Annex A, COSO 2013 and the SOC 2 TSC are not openly licensed.** The open substitute is NIST 800-53 in
   OSCAL.
5. **iPaaS template galleries are not open source.** The best integration oracles are regulatory validators (DATA Act,
   EN 16931), not templates.
6. "PMLB" could not be identified.

---

## 12. Acquisition records (2026-10-21; root `/var/tmp/foundry-work/org-scale-src/`, not committed)

**Treeless shallow clones.** All used `--depth 1 --filter=blob:none --no-checkout --no-recurse-submodules`, with
`core.hooksPath=/dev/null` and `GIT_LFS_SKIP_SMUDGE=1`. Only specific small blobs were read with `git show` (licence
files, the files cited above). Every outcome is "ok, inert".

| repo | SHA | commit date | licence (observed) |
|---|---|---|---|
| odoo/odoo | 2b504bcb3b4182e79a7e156363bca4ae75d4811b | 2026-10-21 | LGPL-3.0 |
| frappe/erpnext | e02e716046ccbf00c80c4b88ab2f09106117a357 | 2026-10-21 | GPL-3.0 |
| frappe/hrms | 7fc314bdbdb69d0161bff1ba4dd46f4a7dffd8a2 | 2026-10-20 | GPL-3.0 |
| apache/ofbiz-framework | cc687ca4b5804c55eb1fd676d95f019396467947 | 2026-10-21 | Apache-2.0 |
| tryton/tryton | b09f5949d06366cf814835371146e013339e472a | 2026-10-20 | GPL-3.0 (per module) |
| Dolibarr/dolibarr | 9310b5a7852cb2190a50131ae8c3c4722b744e41 | 2026-10-21 | GPL-3.0 |
| idempiere/idempiere | 11d707dd36b8c15953b60cfaed7ac46161bcb6c8 | 2026-10-21 | GPL-2.0 |
| metasfresh/metasfresh | 684b536bc6199e861f59aacacfa62357af56d941 | 2026-10-21 | GPL-2.0 (`backend/LICENSE.md`) |
| openboxes/openboxes | c89028fcde96ac47a3fadc42b13760168785cff9 | 2026-10-20 | EPL-1.0 |
| salesagility/SuiteCRM-Core | 6251956840c828ce6406f1214d147cc849b55978 | 2026-10-20 | AGPL-3.0 |
| orangehrm/orangehrm | 56e23b3b09e7af29317a0943523b825843fff527 | 2026-06-29 | GPL-3.0 |
| apache/fineract | b94b2ddf1f37b79a6bdfef76ce5f60f7db1e5a8c | 2026-10-20 | Apache-2.0 |
| DataQualityCommittee/dqc_us_rules | 64abefd357c34ef45f9f4336a1e3171984d76601 | 2026-10-19 | DQC licence (copy and implement, with notice) |
| ConnectingEurope/eInvoicing-EN16931 | 6e35e0ab8b09eb183f7d84b282e24ef95f9f5715 | 2026-10-12 | EUPL-1.2 |
| fedspendingtransparency/data-act-broker-backend | bed939e6e51e5b31cac4ece7e3389a7464e6e78a | 2026-10-14 | CC0-1.0 |
| open-contracting/cardinal-rs | 0b28400d90e0167ff671c5d0b616418b4ac6dc2e | 2026-10-07 | MIT |
| open-contracting/standard | eb57a46e69efead6ae62144fe1b7cefc53d07ff2 | 2026-10-12 | Apache-2.0 |
| usnistgov/oscal-content | 78650f02ad9321bb7b817846f8fbd4f2bcd620de | 2026-05-13 | public domain |
| Skyfall-Research/world-of-workflows | a6e9badc2c708f4d0ce7de252ad82e9b6cca3451 | 2026-08-19 | MIT |
| ServiceNow/EnterpriseOps-Gym | 271f2c357f763376997dfd16807fcde2474ae41b | 2026-08-19 | Apache-2.0 |
| apache/camel-examples | 14d4a335962566475807fe6d8cb103f0f14d495b | 2026-10-16 | Apache-2.0 |
| microservices-patterns/ftgo-application | 558dfc53b11d30a5f1d995c0c6d58d5106c28189 | 2022-09-03 | Apache-2.0 |
| OpenPEPPOL/peppol-bis-invoice-3 | 261c458474e27d58a25be629cccac28883171c92 | 2026-03-16 | none found (read-only) |

**Pinned without cloning.** These were resolved with `git ls-remote` HEAD, with the licence read through
raw.githubusercontent.com at that SHA:

| repo | SHA (short) | licence |
|---|---|---|
| signavio/sap-sam | `dac1eb71` | code Apache-2.0; dataset licence in README |
| apache/camel-kamelets | `4b6c4b1b` | Apache-2.0 |
| eventuate-tram/eventuate-tram-sagas-examples-customers-and-orders | `894f2dbb` | Apache-2.0 |
| AutomatedProcessImprovement/Prosimos | `76636886` | none found |
| hubbs5/or-gym | `0b18d16e` | MIT |
| pm4py/pm4py-core | `9521745b` | AGPL-3.0 |
| azoner/pyx12 | `196e7ec0` | BSD-style |
| microsoft/sql-server-samples | `3b65ec4a` | MIT |
| synthetichealth/synthea | `3e457b7c` | Apache-2.0 |
| GSA/GSA-Acquisition-FAR | `da52ccbb` | none found |
| yutao1024/EntCollabBench | `9d085fcb` | none found |
| me-big-tuwien-ac-at/EAModelSet | `4ebe3054` | none at root |
| orlov-ai/beer-game-env | `c78b69e2` | MIT |
| Javert899/sap-extractor | `d06d1a47` | Apache-2.0 |

**Hugging Face datasets.** Metadata only, nothing downloaded:
- anonymouse321/erp-bench @`ebdb941f` (Croissant CC0-1.0);
- ServiceNow-AI/EnterpriseOps-Gym @`c8e538ea` (apache-2.0);
- Kirito-Lab/EntCollabBench @`df95c873` (no licence).

**Datasets downloaded.** Each file went into its own directory under `data/` and passed Zenodo's md5 check. All are
CC BY 4.0; the outcome for each is "ok; profiled with `python3 -I`, scripts kept in the session scratchpad".

| record / file | bytes | sha256 |
|---|---|---|
| 18334009 / 2_p2p.zip | 4,351,460 | 6ff58350816a8c398387a1782e65925181cbb229bbdcca587f00fe7a7b891eda |
| 18334009 / 3_o2c.zip | 7,150,177 | 4b3e7ec882329789ed4af9a5e34741135acfd6aca0920c4481f1dd2b303b8898 |
| 22079246 / procurechange.jsonocel.gz | 7,393,340 | 6ace16482a80393854b5075f8255326f8cbf0f1463ada1d43601e9d9a980ebd8 |
| 18373888 / container_logistics.sqlite | 23,023,616 | 3c91ff97f736615196902039eec8f00bcd2f83f653d282d8a5aaef3baa7d3d7e |

**Read, then deleted:** the NIST SP 800-53 rev5 OSCAL catalog JSON (10,442,037 bytes, sha256
`01f37cf90ea99d92242c936cbfbdebcc338eef1f71454e2acac36cc56e9bc062`).

**Not downloaded, over the 50 MB cap or the disk** (about 2.3 GB free after this pass):
- SAP-SAM (4.76 GB, and its licence also forbids derivatives);
- BPMAI (388 MB);
- the ProcureChange source DB (143 MB);
- the BPIC OCEL 2.0 conversions of 2016, 2017 and 2019;
- the EnterpriseOps-Gym DB zip (14.5 MB; deferred, not needed for this report).

---

## 13. Unavailable or unverified

- **data.4tu.nl**: returned 503 or connection resets, so the BPI dataset pages were not opened. Licences and
  descriptions come from DataCite instead.
- **api.openalex.org**: the shared budget was exhausted, and a key would need the user's e-mail.
- **pcaobus.org**: WebFetch got a 403; Exa returned the page.
- **Snippet only (not verified):**
  - FAR threshold figures beyond the Federal Register metadata;
  - AICPA TSC terms;
  - PGPA amendment dates;
  - the SEC ICFR flag;
  - Audit Analytics;
  - MuleSoft, Workato and Boomi terms;
  - UNECE EDIFACT terms;
  - ERPsim access;
  - the World of Workflows paper counts.
- **Not opened:**
  - legislation.gov.au instruments;
  - university DoA policies;
  - Celigo;
  - GLEIF Level 2 relationship data (a candidate seed for real group structures);
  - CIS Controls and CSA CCM licences;
  - the ISO 20022 repository terms;
  - the contents of metasfresh feature steps, OFBiz services, and Kamelets counts.
- **Inferences marked [I] above:**
  - that Odoo inter-company rules are Enterprise-only (based on absence in Community);
  - the Dolibarr multi-company module status;
  - the run weights of ERPNext, iDempiere and OpenBoxes;
  - the public-domain status of the FAR and USSGL as US government works.
