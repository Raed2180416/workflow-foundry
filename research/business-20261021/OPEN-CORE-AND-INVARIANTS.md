# Open core, org invariants and the multi-tier gap: v0 reasoning (2026-10-21)

*Orchestrator's first pass, written to be attacked. It builds on `research/business-20261015/WHAT-ORGS-PAY-FOR.md`,
which covered what to sell first, and `research/enterprise-20261014/CATALOGUE.md` and `BAR-SET.md` (the enterprise bar
E1–E13). It does not repeat them.*

## Owner's questions (2026-10-21)

1. "If the corpus doesn't cover extremely complicated multi-layered integrations between business logic, actual
   execution and org-wide management, we need to go hunting, be creative and build a system capable of it."
2. "These companies need some rules at certain layers to be unchanged, like invariants. … The OSS core will allow users
   to build complex workflows for solo devs, but complex business multi-tiered workflows we paywall?"

## 1. Coverage: the corpus does not reach the org layer

| Measure | Value |
|---|---|
| Corpus workflows | 1,559 |
| Touch an ERP, CRM or ITSM system of record (SAP, NetSuite, Oracle, Workday, ServiceNow, Salesforce, Dynamics, Odoo, QuickBooks, Xero) | **16** |
| Most connector-heavy items | genomics pipelines (nf-core, CWL) |
| Domains | dominated by science, CI/CD, home automation and data orchestration |

**The enterprise bar** (BAR-SET E1–E13) does reach real business rules: tolerance hierarchies, credit holds, Reg E
clocks, CMS edits, sagas. But each item is **one process**. What no bed, corpus or public benchmark covers
(`research/benchmarks-20261015/CONSTRUCTION-BENCHMARKS.md`, `research/intent-20261021/EXTERNAL-BENCHMARKS.md`) is
the **org layer**:
- many processes (P2P, O2C, R2R, hire-to-retire, ITSM change) running at once over shared systems of record;
- several legal entities, roles and people;
- shared invariants no single workflow may break;
- those invariants changing over time under change control.

## 2. Which rules must not change: layered invariants

**Order of precedence.** Regulation, then org policy, then entity or department rule, then process rule, then workflow
logic.
- A lower layer may narrow a higher layer, never widen it. This is the Progent-style capability narrowing already in
  ROADMAP §plan/expand, generalised.
- Lower layers are where cheap models write.
- Higher layers change only by a version-bound proposal approved by an authority at that layer (THESIS: execution
  authority stays outside the model; state changes use compare-and-swap).

**Invariant families with concrete examples:**

| Family | Examples | How it is checked |
|---|---|---|
| Value conservation | Double entry balances; sub-ledger equals its GL control account; captured minus refunded equals net charged per order; FX rounding rule; no posting to a closed period | Runtime monitor over the systems of record; property tests in practice worlds |
| Exactly-once and ordering | No duplicate payment or e-mail; compensation in reverse order; idempotency keys | Effect-history predicates (E8 capability contracts) |
| Authority | Delegation-of-authority thresholds (approval above X needs role R); segregation of duties (vendor-master editor ≠ invoice approver ≠ payment releaser); four-eyes on changes | A static check of each workflow's effect and approval graph against the role matrix; a runtime check against the actual approver identity |
| Clocks and obligations | Reg E 10-day provisional credit; SLA breach handling; GDPR 30-day request deadline; dunning cadence | Temporal monitors (these are a pure function of history, as in the E7 SLA oracle) |
| Data | PII stays in its region; retention and legal hold (deletion frozen); least privilege per connector | Label and capability policy at build time; egress monitor at run time |
| Process legality | Three-way match before payment; no shipment before payment unless on credit terms; the state machine of each business object | Typed state slots and guards in the IR; per-object conformance against an object-centric log |
| Change control | A workflow version runs only if approved; an invariant changes only at its layer's authority; every run is pinned to the versions it ran | The journal, the version hash and the approval record |

**Why this matters for us.** The thesis already has the machinery:
- typed IR, an effects lattice, capability narrowing, labels and CAS;
- verify nodes that gate;
- replayable journals, practice worlds and N-version oracles.

An **org invariant layer** is these pieces composed into a "constitution". Every generated workflow is checked against
it statically before it deploys, and monitored against it at run time. That turns "the model wrote it" into "it cannot
violate the org's rules, and here is the evidence".

## 3. The paywall line: not "complexity"

**The owner's proposal:** OSS for solo devs, with complex multi-tier business workflows behind a paywall.

**Where I disagree** [I]:
- **Complexity is the wrong axis.**
  - Developers' best demos and their word of mouth come from complex workflows, so gating them starves the adoption
    loop.
  - "Complex" cannot be defined without gaming: users would split one workflow into several.
  - The 10-15 research found buyers pay for outcomes, predictable spend, upkeep, proof and control, and implementation,
    not for steps or orchestration.
- **The better axis is who needs the feature** (buyer-based open core; GitLab's published tiering principle, to be
  verified).
  - **Free (individual builder):** construct, run, verify, repair and reuse, including sub-workflows, sagas and complex
    graphs, on one owner's systems.
  - **Paid (the organisation):** the governance plane, which only matters when many people, entities and systems share
    rules:
    1. The org invariant layer: authoring, static proof at deploy, runtime monitors, violation blocking.
    2. Change control bound to identity: SSO/SCIM, roles, four-eyes on workflow and invariant changes, pinned versions,
       rollback.
    3. An evidence pack per period for SOX ITGC, SOC 2 and ISO 27001 from the replayable journals: who approved which
       version, which invariants were checked, which cases ran.
    4. Multi-entity, multi-system coordination at scale on a managed durable runtime with an SLA, or a private
       deployment.
    5. Verified vertical packs priced per verified outcome. The AP-exception wedge from the 10-15 research is the first.
       Each pack is a rulebook with oracles, practice worlds that mock SAP, NetSuite or D365, and a drift watch.
    6. Upkeep: drift detection and repair on the customer's own history.
- **Why this line holds** [I]:
  - What is paid is what a fork cannot easily copy: practice worlds and mocks of proprietary systems, vertical rulebooks
    with oracles, compliance mappings, the hosted runtime and the support liability.
  - The engine can stay genuinely open.
- **To check against precedent** (license facts not verified here):
  - n8n's Sustainable Use License;
  - Camunda 8's move to a production licence;
  - Temporal (MIT core plus cloud);
  - Kestra, Windmill and Activepieces (open core plus an enterprise edition with RBAC, SSO and audit);
  - Airbyte and GitLab EE.

## 4. What to build: an org twin

A bed one level above E1–E9. One simulated mid-size group:
- **Entities:** 2–3 legal entities.
- **Systems of record:** ERP GL, AP and AR, procurement, CRM, HRIS, ITSM, bank.
- **Processes at once:** P2P, O2C, R2R with intercompany flows, hire-to-retire, ITSM change.
- **Structure:** a role matrix with delegation-of-authority and segregation-of-duties rules, and the layered invariants
  of §2.
- **Duration:** simulated months.
- **Shocks:** a policy change mid-stream, an acquired entity, a period close, an audit.

Each cheap-built workflow is graded on three things:
1. its own process oracle (reuse the E1–E9 oracles);
2. zero org-invariant violations, checked by monitors across all systems;
3. its composition with the other processes, for example P2P's postings feed R2R's close, and the dunning output from
   O2C feeds cash.

**Sources to hunt for** (to verify; not yet acquired):
- object-centric event logs (OCEL 2.0 datasets: order management, procure-to-pay) as ground-truth multi-object execution;
- the BPI Challenge logs (2017 loans, 2019 P2P), already in the catalogue;
- large process-model collections (SAP Signavio's academic SAP-SAM, BPMAI);
- open-source ERP code as executable business semantics (Odoo, ERPNext, Apache OFBiz, Tryton, Dolibarr);
- control catalogues for invariants (COSO, SOX ITGC, ISO 27001 Annex A; delegation-of-authority and
  segregation-of-duties rule sets);
- enterprise-integration examples (Camunda, Temporal and Apache Camel samples).

## 5. Open questions for the attack

- Is the org invariant layer something buyers will pay for separately, or is it table stakes that incumbents give away
  (SAP GRC, ServiceNow GRC)?
- Is "evidence from replayable journals" accepted by auditors as SOX ITGC evidence, or does it need a certified control?
- Does gating governance kill bottom-up adoption inside companies, the way gating SSO is resented as the "SSO tax"?
- Can a solo operator build the org twin credibly, or is it a team-scale artifact?
- What is the smallest org-twin slice that proves the claim: two processes, one shared invariant and one policy change?
