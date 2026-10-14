# E-BED: the enterprise bar bed (design, corrected)

*Final design, 2026-10-14, about 14:05 UTC, branch `claude/intelligent-hamilton-vg1f9a` at `48ac5d1`. It merges the E-bed
draft with the adversarial critique of the same day and a consolidation re-check. Every change from the draft is listed
in §12 "Errata", with the reason. The items it measures are in [BAR-SET.md](BAR-SET.md); sources and imports are in
[CATALOGUE.md](CATALOGUE.md) and [ACQUISITIONS.json](ACQUISITIONS.json); the UI construct is in [OPENUI.md](OPENUI.md);
the claims are PROOF-LEDGER §L. Status: **design only (D)**. Nothing under `beds/`, `experiments/`, `src/` or `tools/`
was written.*

*$0: no model calls of our own, nothing installed or built, no git write except the commit of these documents.
`beds/sealed/` and credential files were not read. Web, corpus and clone text was treated as data.*

**Evidence tags.** [M] a repo file read in one of the passes (file cited); [M-c] computed at $0 (script cited);
[doc] / [code] / [data] / [web✓] as in BAR-SET.md; [bar] taken from BAR-SET.md; [crit] a critique finding, checked where
marked; [I] inference or design choice; [unavail] needed and not obtained.

**$0 scripts used** (session scratchpad, outside the repo): `efinal/durations.py` (case lengths on BPI 2012, 2017,
2019), `efinal/pw.mjs` (family-test power, reliability pass rates), `efinal/cp.mjs` (Clopper-Pearson thresholds),
`ebar/bpi17.py` (BPI 2017 profile).

---

## 0. Summary

1. **What the E-bed is.** Nine enterprise workflows (E1–E9), an optional tau2 anchor (E10) and three library-unseen
   reserves (E11–E13). Each is packaged as **rulebook + world generator + exact reference transition + scripted actors**,
   never as a workflow file, so variant families are seeds × difficulty × editions and B13's shortage cannot recur.
2. **What it measures, stated honestly.** The **documented rule-and-deadline core** of these processes, in two tracks:
   - **Track P, "engine port"**: given the re-expressed rulebook, rule tables as data and the system-of-record schema,
     the arm builds a solver that implements the semantics. This is re-implementing the product's engine, and it is
     never reported as "set up D365-class workflows".
   - **Track C, "configure"**: the host supplies the engines (the library cards as the "product"); the arm produces the
     organisation's configuration and exception handling from policy memos, emails, sample historical cases and a
     scripted subject-matter expert whose answers cost simulated minutes; some rule rows are withheld and must be
     inferred from history. Track C is the closer analogue of the owner's "see if we can cheaply set it up".
3. **The unit of construction is `tick/1`, per instance.** A pure solver per case:
   `solve(caseSlice, events, now, files, query) → {decisions, effects[], obligations, humanTasks[], carry}`, with
   read-only `sor.query` for cross-case reads and explicit host-scheduled **sweep ticks** for batching (G13). A
   world-level mode (one call sees all cases) is kept as a diagnostic only, because it does not transfer to tier E.
4. **The host owns envelope mechanics, under a declared platform profile.** Durable simulated time, typed mocks with an
   effect ledger, scripted humans and counterparties, fault injection, and the guarantees of the platform being
   compared (for E8, Temporal-style activity retries). The profile is identical for every arm in an item, including the
   literal OSS port. The host never correlates, deduplicates, computes deadlines or compensates for an arm.
5. **Grading is on-policy and behavioural.** At every case-tick the oracle applies the reference transition to the arm's
   **own** history; a case passes if it never diverges. What is graded is observable: external effects inside their
   allowed windows, deadlines met, who was asked and within which window, business records at case close. Timer and
   obligation design is internal and not graded. A specificity test (at least three independently written correct
   solvers, zero false rejects) is part of oracle admission.
6. **Horizon covers the cases.** Each world starts with a go-live backlog of in-flight cases, advances by events only,
   and runs at least the item's 90th-percentile case length (E1: 90 business days, measured on BPI 2019 [data]). The
   closed-loop (CL) unit is a case segment with explicit censoring; cases are assigned to epochs by start date.
7. **Arms.** agent-H (Haiku agent, fresh per call) and agent-H-ws (with a persistent workspace); (a) JIT Haiku from
   traces; (g) Haiku library-first; **B1-H and B1-O** (Haiku or Opus builds once from spec-E, no fixtures); (c) the
   Opus-written reference port, frozen by hash; (c′) Opus writes the item workflow once with per-epoch rewrites;
   c-oss (literal OSS port, E8). One judge-escalation policy for all arms. Any arm entering a decision runs K ≥ 2.
8. **Oracle validity comes before any arm** (AGENTS: an invalid evaluator blocks claims): golden tests from public
   worked examples (including discriminating ones), N-version oracles where public examples are thin, the specificity
   test, controls that must fail, metamorphic and mutation suites, a censoring report. A frontier reference that cannot
   be built is a **capability outcome**, not an oracle failure.
9. **Statistics.** The family-level unit is the CL case segment, paired by (world, case). Family test: exact one-sided
   Wilcoxon signed-rank on {Δᵢ + δ} over admitted core items (W⁻ ≤ 8 of 9, p = 0.049) [M-c]. Power at true equality is
   0.60 at K = 2 and 0.85 at K = 4 [M-c, re-run]; K = 4 is recommended. Reliability is a one-sided 95% Clopper-Pearson
   lower bound ≥ 0.95 on completed tail-mix cases, every world's own bound ≥ 0.90, and a separate bound on critical
   violations (≤ 0.1% needs ≥ 2,995 clean cases, so it is established only on compiled arms at the scale tier) [M-c].
   Holm across the two Haiku arms; secondary per-item hypotheses Holm-adjusted and reported as secondary. Scope: nine
   selected items, no inference to enterprise workflows in general.
10. **Build and cost.** Everything before the first metered step is outside `src/` (engine freeze holds) and makes no
    metered model calls, but the authoring sessions draw on the session quota window (§8.3). The minimum viable paid
    pilot (E8 and E1, K = 2, Track P) is about **$250–750 list** [I]; it can cross the $500 owner pause. Tier-E runs wait
    for the bar-weighted engine column (§7).

---

## 1. The owner's bar made operational, and why this is not B13 again

| owner's words | measured as |
|---|---|
| "do these complex workflows" | 9 core items covering the construct classes of BAR-SET §4; each class central in ≥ 2 items except genuine saga compensation (E8 only) |
| "compare against the best proprietary systems by breaking them down, or OSS workflows" | arm (c): a faithful, frozen port of the documented semantics (D365, Reg E/network-X, 31 CFR, CMS, ServiceNow-style SLA, BPI logs) or OSS structure (Temporal, Camunda), with a per-item **semantics ledger** of features in and out (§2.11); c-oss for E8 |
| "see if we can cheaply set it up" | **Track C**: construction $, wall-clock, SME minutes and owner minutes for configuring the product from business inputs; Track P construction cost for re-implementing the engine; amortisation against the agents |
| "works reliably on even the most complex workflows the biggest orgs use" | reliability verdict H-E2 (§6): Clopper-Pearson lower bound ≥ 0.95 on completed tail-mix cases at d5 under faults, every world ≥ 0.90, zero critical violations, at documented semantics and the stated scale; a scale tier at 10⁴–10⁵ cases per world for compiled arms |
| "testing should be thorough" | §9: golden and discriminating goldens, N-version, specificity, property, metamorphic, mutation, triviality and gaming attacks, replay determinism, leak tests, heal precision, calibration |

**Why B13 fired** (DEV-NOTES D21 [M]): the replication unit was one hand-written workflow with an item-declared
conformance file, valid only at τ = 1; only 4 corpus families had ≥ 3 oracle-bearing members; the most complex items
produce prose.

**What changes here.**
1. The oracle is a rulebook's transition function evaluated on the arm's own history, not a declared diff. Exactness is
   the default (integer minor units, minute-exact times), applied to observable behaviour with allowed windows taken
   from the rulebook, never from per-item "not a difference" lists. The specificity test catches graders that reject
   correct designs (the D21 tier-G failure: generic normalisation "rejects every correct class on two items" [M]).
2. Families are generated: each (world seed, difficulty, edition schedule, party mix) is a new member.
3. Realism comes from documented semantics and real logs; BPI 2019 calibrates E1 and BPI 2017 calibrates E9, including
   variant-frequency curves and replayed real case skeletons (§2.6).
4. The reference is ours, written once per item from the decomposition and frozen; upstream graphs are reference
   material only.

---

## 2. Shared design

### 2.1 Worlds, cases, time, horizon and censoring

- **A world** is one fictional organisation (the W-bed "Hollin Group" lineage, `beds/wbed/lib/domain.mjs` [M]) over a
  business horizon: calendars, time zones, parties, a rulebook with editions, an arrival process of cases (one invoice,
  order, dispute, claim, incident or application with its sub-objects), and a **go-live backlog**: at t₀ the world
  already holds in-flight cases at every stage, delivered in the first wake-up as a migration (DESIGN-STREAMS §2.3 "tick
  1 is a migration" [M]). The backlog's state is the neutral export of a reference run over a pre-history.
- **Time advances by events only.** The host jumps to the earliest of: the next exogenous event, the earliest due
  obligation or timer of the arm, the next scheduled sweep. Idle days are skipped. A wake-up delivers all events up to
  that time, routed per case.
- **Horizon** ≥ the item's 90th-percentile case length plus the longest rule clock:

  | item | case length evidence | CL horizon (business time) |
  |---|---|---|
  | E1 | BPI 2019: median 46, p90 90, p99 157 business days; 57.6% > 40, 33.9% > 60 [data, `durations.py`] | 130 business days (go-live backlog + 90 + approval/payment clocks) |
  | E2 | no log; dunning steps and credit-limit expiry [bar] | 90 business days (3 letter cycles) |
  | E3 | one close cycle per month [bar] | 4 monthly closes (~85 business days) |
  | E4 | SAR clock ≤ 60 calendar days; document waits | 90 calendar days |
  | E5 | Reg E 45/90 days + network 120 + 30 + 30 + 10 days [web✓, bar] | 200 calendar days |
  | E6 | prompt-pay window + one quarterly edition switch | 1 quarter + 30 days |
  | E7 | incidents hours–days; problems and changes weeks [I] | 30 business days, hourly granularity |
  | E8 | hours–days | 14 days at hour granularity |
  | E9 | BPI 2017: median 14, p90 25, p99 43 business days [data]; offer expiry ~30 calendar days | 60 business days |

- **Epochs are defined in business time** as fractions of the horizon (E0 base 25%, E1 parties 15%, E2 rules and
  formats 20%, E3 schema/volume/faults 25%, E4 revert 15%), and **cases belong to the epoch in which they start**.
- **The CL unit is a case segment.** A case is *completed* if it reaches a terminal state inside the horizon, *censored*
  otherwise. Completed cases are graded end to end; censored cases are graded on their prefix and reported separately,
  with the censored share per epoch and arm. A verdict that rests on a censored share above 20% in any epoch is marked
  "censored" [I threshold].
- **Size budget.** A per-instance call renders to 2–20K tokens inline; master data, rulebook tables and documents are
  files. Every prompt stays under Haiku's 100K-token price step (`policy/models.json`: $0.10/$0.50 per MTok to 100K,
  $0.50/$2.50 beyond [M]); an agent arm that crosses it is logged and priced at the higher rate.

### 2.2 The `tick/1` contract, solver modes, state and platform profiles

```text
task.inputs = {
  item, world, case, now,                              // business clock, ISO with offset
  events: [{ id, type, at, source, payload }],         // inbound docs/messages, human answers, effect results,
                                                       // timer firings (with obligation id); NO edition notices in
                                                       // sealed no-notice variants (§2.5)
  carry                                                // the arm's own per-case carry, ≤ 64 KB JSON
}
task.files = { "sor/<case>.json", "master/<table>.json", "rulebook/<edition>/<table>.csv|json",
               "calendar/<id>.json", "docs/<eventId>.txt", "api/<system>.schema.json", "spec/SPEC-E.md" }
task.query = sor.query(table, filter)                  // read-only, cross-case (dedupe, exposure, grouping)

output = {
  decisions:  { <item-specific typed record> },
  effects:    [{ key, system, op, args, compensates?, after? }],   // applied in order by the host
  obligations:{ upsert: [{ id, kind, anchor, dueAt, calendar, onDue }], cancel: [id] },   // wake-ups, not graded
  humanTasks: [{ id, role, excludeUsers?, question, answerSchema, dueAt, onTimeout }],
  carry
}
```

- **Per-instance mode is primary** for every arm. Cross-case work goes through `sor.query` (reads) and through **sweep
  ticks**: world-level wake-ups the host schedules at a cadence declared in spec-E (evaluate-for-release, unblock and
  auto-match batches, rescreen on list update, collections runs). A sweep tick sees the open-case index and may emit
  effects for many cases. This is the shape a tier-E engine runs, so tier-S numbers transfer.
- **World-level mode** (one call sees every case) is a diagnostic: it makes cross-case reasoning free and correlates
  failures within a tick, so it never enters a decision.
- **State.** The system of record (SoR) has two parts:
  - **business records** (POs, invoices, orders, disputes, tickets, applications, holds as set, letters as sent): written
    only through `sor.*` effects, gradable, and present in every input;
  - **product-computed fields** (match status, `businessElapsed`, `breachAt`, effective credit limit): in Track P the
    arm computes them and writes them through `sor.*`; in Track C the host's product engine computes them. They are
    never copied from the reference into an arm's input.
- **Carry and workspace.** A per-case carry of ≤ 64 KB JSON (as DESIGN-STREAMS [M]), plus an optional file-backed
  per-arm workspace (≤ 50 MB) for arms that keep scripts or indices (agent-H-ws). Neither is graded; both are journaled.
- **Platform profile** (declared in spec-E per item, identical for all arms):

  | profile | host guarantees | used by |
  |---|---|---|
  | `bare` | none: no retry, no dedupe, no correlation, no ordering | E1–E7, E9 (Track P) |
  | `temporal-like` | activity retry on retryable errors (1 s initial, ×2.0, max 100 s, unlimited attempts, per Temporal's documented default [web✓]); durable timers and signals; workflow code is the arm's | E8, all arms including c-oss |
  | `product` | Track C: the configured engines run the documented semantics; the arm supplies configuration and exception handling | Track C items |

  Under `temporal-like`, F1/F2 faults are absorbed by host retries for every arm; F3 (timeout after commit) still makes
  the host retry, so an arm without idempotency keys double-charges. The literal port therefore fails only where the
  bar's specification differs from the app's (permanent failure after charge), which is a different specification,
  not a planted flaw.
- **What the host never does** (under every profile): correlate events to cases by business meaning, deduplicate
  inbound events, compute deadlines, enforce separation of duties, compensate. Events carry raw business keys (PO number,
  ARN, ticket number, possibly mistyped), so correlation (G1) is tested at tier S.

### 2.3 Two tracks

| | Track P "engine port" | Track C "configure" |
|---|---|---|
| arm receives | spec-E (re-expressed rulebook), rule tables as data, SoR and API schemas | policy memos, emails, an org chart, 20–200 sample historical cases with outcomes, product documentation (the card APIs), an SME simulator |
| arm produces | a `tick/1` solver implementing the semantics | configuration (rule rows, tolerance and policy hierarchy, calendars, SLA definitions, approval matrix, collection steps) + exception-handling solver for what the product does not automate |
| product engine | none | P58 / P59 / P60 card implementations + item modules, written independently of the oracle and differentially tested against it before admission |
| withheld rows | none | variant C-w: 10–30% of rule rows absent from the memos, inferable from the historical cases (each withheld row is constructed so that ≥ 3 historical cases pin it) |
| SME | none | scripted; answers typed questions from world truth; each question costs 2 simulated minutes; ambiguous questions get "it depends" answers drawn from the memo text |
| graded | the on-policy CL oracle (§2.8) | the same oracle, plus configuration diff (descriptive) and SME minutes |
| claim wording | "built a correct engine for the documented semantics" | "configured the documented product semantics from business inputs" |

Track P is built first (it shares all oracle machinery). Track C starts on E1 and E7 after their Track P admission (§8).

### 2.4 Item package (bed contract v1.1, proposed)

`beds/ebed/<item>/`:

| module | content |
|---|---|
| `rulebook/` | editions as data with effective-date ranges and a provenance pointer per row family |
| `spec/SPEC-E.md` | re-expressed rulebook, SoR schema, API schemas, glossary, stated readings, platform profile, sweep cadence |
| `ledger/SEMANTICS.md` | the semantics ledger: features in and out, each with doc file:line (§2.11) |
| `world.mjs` | `generateWorld({seed, split, difficulty, schedule, mix, scale})`, pure; go-live backlog; `twins()` |
| `replay.mjs` | (E1, E9) real case skeletons from local BPI logs mapped to synthetic documents; local only, never committed |
| `actors.mjs` | deterministic human and counterparty policies keyed by (world, case, role, decision kind, ordinal), never by request text; noise model (§2.7) |
| `transition.mjs` | `referenceTransition(world, sorHistory, t, events) → output`, total on every reachable state; the oracle core |
| `oracle.mjs` | `oracleCaseTick`, `oracleCase`, `oracleStream` (§2.8) |
| `golden/` | public worked examples as executable cases `{source: file:line, input, expected}`, including discriminating cases |
| `controls.mjs` | bad controls, necessity controls, gaming attacks, white-box script (reported) |
| `defects.mjs` | mutation-mined latent defects with executed E0-silence checks and manifests; false revealing events (§2.10) |
| `structure.mjs` | L0/L1 labels, the reference decomposition, the second labeller's labels |
| `track-c/` | memos, historical cases, SME script, withheld-row manifest, product module bindings |

Shims `beds/ebed-e1/index.mjs` … follow `beds/wbed-r4/index.mjs` [M]. Shared host code in `beds/ebed/host/`; shared
oracle-side libraries (calendar, decision-table evaluator, obligation clock, saga planner, ledger checks) in
`beds/ebed/lib/`, written independently of the library cards in `experiments/library/cards/P58|P59|P60` and sharing no
code with them. `family.kind` gains `'world-stream'`; CONTRACT's oracle-health rules apply per case and per stream [M].

### 2.5 What every arm is given (spec-E), and how big it is

- **Contents**: the re-expressed rulebook in our own words; rule tables as data; SoR and API schemas; calendars; the
  effect contract (which ops need a key, which reverse which); obligation and human-task vocabularies; the platform
  profile; the sweep cadence; **stated readings** where a source is ambiguous (each records the competing reading; a
  contested reading never carries a drift family or latent defect). Example: E7 adopts WorkArena's ±5% check
  (`manage_change_request_schedule.py:233–235`) as "WorkArena task policy", with the comment's 20% (:210) recorded as
  contested [code].
- **Written by** a session that never sees oracle code, the defect list or the drift families (DESIGN-STREAMS spec-A
  [M]). Spec-explicitness test before freeze: every drift family's correct behaviour cites a spec sentence; every latent
  defect contradicts one; otherwise it is dropped as a reading dispute.
- **Size versus the 8K constructor cap** [M-c]: the public sources alone are D365 E1 files 34,365 characters (≈ 9.8K
  tokens), E2 files 53,032 (≈ 15K), E3 elimination + close 19,524 (≈ 5.6K), Visa Core Rules chapter 11 ≈ 251,800 (≈ 72K
  tokens). Spec-E per item is expected at 10–40K tokens [I], measured when written. The library constructor's S6 card
  alone takes 2,962 of 3,000 tokens and every call is capped at 8,000 (D2 [M]). Arm (g) therefore needs **hierarchical
  construction with spec-section retrieval**: a spec index (section titles + ≤ 150-token abstracts) in the plan call,
  and ≤ 2 retrieved sections per build call, every call still under 8K. Until that exists, arm (g) is not run on the
  E-bed; arms (a), B1 and (c) have their own compile caps and see spec-E as files.
- **Edition notices.** Default variants deliver a new edition file with an `edition.published` event. **Sealed no-notice
  variants** drop the event: the new edition file simply appears in `rulebook/`, and in the hardest variant it does not
  appear at all and must be inferred from counterpart rejections carrying reason codes. Detection latency is measured.
- **Licence handling** [bar]: D365 (CC BY 4.0) re-expressed with attribution; Visa not duplicated (synthetic network-X);
  CPT descriptors replaced by synthetic HCPCS-like codes; ServiceNow semantics only; BPI logs as distributions, kept in
  `/var/tmp`; ERPNext (GPL-3.0) read for semantics only, never copied.
- **Fixtures**: only (c)'s author gets labelled fixtures (§2.12). JIT and library arms get no oracle access [M].

### 2.6 Difficulty, mixes, calibration, scale

| d | adds (each level includes the previous) |
|---|---|
| d1 | toy worlds for unit tests |
| d2 | base: one edition, known formats and parties, natural mix, no faults |
| d3 | new parties with their own id styles, layouts and vocabularies; tail classes enriched to ≥ 50% of cases |
| d4 | effective-dated edition switch (anchor date decides) and a policy change; a new document format |
| d5 | schema change (SoR or API rename, enum extension), volume ×2, faults ramp 0 → 15%, label-preserving injection content |

- **Mixes.** Natural mix (reported, calibrated) and tail-enriched mix (≥ 50% tail classes; the verdicts read this one).
  BPI 2019's head is heavy: top variant 20.0%, 7 variants reach 50%, 45 reach 80%, 9,030 of 11,973 are singletons
  [data], so a happy-path workflow looks good on the natural mix.
- **Calibration (reported, gates admission of the generator, not of arms).** E1 natural-mix worlds must match BPI 2019
  on category shares (± 2 points), change-event rates (± 20%), the **variant-frequency curve** (share covered by the top
  1/7/45 variants within ± 5 points; singleton share within ± 10 points) and **directly-follows distance** (earth mover's
  distance over normalised DFG edge frequencies ≤ 0.1 [I threshold]). E9 must match BPI 2017 offers-per-application
  (total variation ≤ 0.05) and delay quantiles (± 10%).
- **Log-replay worlds (E1, E9).** Real BPI 2019 and BPI 2017 case skeletons (activity sequence, timestamps, case
  attributes) drive the event stream; the generator synthesises documents and values consistent with each skeleton and
  the rulebook decides the expected outcomes. Kept local only (BPI 2017 under 4TU terms; BPI 2019 CC BY 4.0 but 728 MB).
- **Scale tier (compiled arms only).** 10⁴–10⁵ cases per world (E1: 2.5 × 10⁴ PO items, a tenth of BPI 2019's year; E6:
  10⁵–5 × 10⁵ procedure-pair rows, against the real file's 475,042 [crit, doc]); throughput (case-ticks per second),
  memory (≤ 2 GB) and judge-cost budgets per world. Agent arms are not run at this tier (cost); the claim says so.
- **Sealed drift.** A separate session authors one extra d4 format family, one d5 schema family and one no-notice edition
  family per item as sealed plug-ins, from spec-E and the generator API only. "Adapts to the unknown" may be claimed only
  from these.

### 2.7 Faults, world events, actors

| id | class | injected by | healthy response | graded as |
|---|---|---|---|---|
| F1 | 429 with Retry-After | host (tagged `injected: true`) | wait, retry with the same key, no recompile | env; recompile here is a heal error |
| F2 | 5xx transient | host (tagged) | retry with the same key (or rely on the profile's retry) | env |
| F3 | timeout after commit (`unknown`) | host (tagged) | `status(key)` before any retry; never double-apply | ledger |
| F4 | partial batch (k of n) | host (tagged) | reconcile, resubmit only failures with the same keys | ledger |
| F5 | API field renamed | host, d5 | deopt or flag, then heal; no silent default | heal event |
| F6 | permanent failure (non-retryable) | host (tagged) | compensate committed steps | compensation |
| W1 | duplicate inbound delivery | world, ≥ d3 | dedupe by business key or event id | ledger, decisions |
| W2 | out-of-order events | world | order by business semantics | decisions |
| W3 | late event past its deadline | world | deadline path stands; late event handled per rule | decisions, SLA |
| W4 | conflicting concurrent update | world | rule-defined winner | decisions |
| W5 | injected instructions in documents | world (label-preserving) | no change in control flow (twin assertion) | adversarial-content rate |

- **Injected faults are tagged in the journal** and excluded from the K5 env-fault rule; real usage-limit 429s are
  recorded separately. **The simulated clock is frozen across real quota stops**, and streams resume from the journal.
- The fault schedule is keyed by (world, case, system, op, ordinal) and is identical across arms (W-bed `faults.mjs`
  design; its hooks are no-ops today [M]).
- **Actor noise model**, calibrated on BPI 2017's work-item lifecycle (suspend 215,402; resume 127,160; ate_abort
  85,224; withdraw 21,844 [data]): late answers, no answer, delegation to another role holder, withdrawal; free-text
  answers in a share of tasks (parsed by the arm); and **wrong answers** in a declared share where the rulebook requires
  a verification step (e.g. a vendor confirming a wrong quantity), graded on whether the workflow catches them.
- **Form route.** A declared share of human answers arrives through the rendered tier-0 form as OpenUI-shaped
  `formState` (`{ value, componentType }` per field, `spec/language.md:442–446` [doc]) and passes through a host adapter
  that maps to the typed answer; the host re-validates against `answerSchema` (OPENUI.md §5).

### 2.8 Oracle: on-policy, behavioural, with allowed windows

**On-policy grading.** For each case-tick the oracle evaluates `referenceTransition` on the arm's own SoR and event
history. The arm's observable output must lie in the reference's allowed set. The first divergence fails the case and is
recorded with its layer; the world then continues on the arm's trajectory (actors respond to what the arm did).
`referenceTransition` must be total over reachable states; after an arm error the case is already failed, so totality
only has to cover "continue the world".

**Layers (what is graded).**
1. **Decisions** per case: the item's typed record (condition, hold reasons, match statuses, owner set, SLA breach),
   exact. Escalating a decidable case is an error; so is not escalating a constructed-undecidable one (W-bed R2 [M]).
2. **External effects**: for every rulebook obligation the reference emits an allowed window [earliest, latest] and the
   canonical arguments. The arm passes if each required logical effect occurs exactly once inside its window and no
   effect occurs outside the allowed set. Order is enforced only where the rulebook declares it (compensation order,
   notice before reversal). Keys are arm-chosen; graded properties: a retried logical effect reuses its key; distinct
   logical effects use distinct keys.
3. **Deadlines met**: every rulebook deadline is graded through its consequence (the required action or escalation
   happened in its window), not through the arm's obligation table.
4. **Human tasks**: role, exclusions (separation of duties) and creation inside the allowed window. The arm's
   `answerSchema` must accept the actor's typed answer; if it rejects it, the consequence fails. What the actor answered
   is world data.
5. **Business records at case close and stream end**: the SoR business records equal the reference's.
6. **Invariants** (analyst-side, never shown to arms): conservation, balancing identities, one terminal state, monotone
   clocks.

**Critical violations** (each fails H-E2 on its own): a duplicate money movement (payment, refund, charge, provisional
credit); an effect requiring an approval with no approval; an effect on a held, cancelled or closed object; a
separation-of-duties violation; an orphaned charge or reservation after a failed saga; a regulatory filing missing,
late or duplicated; an effect that follows an injected instruction.

**Pass definitions.** *Case pass*: no divergence on layers 1–5 from start (or go-live) to completion. *Segment pass*:
the same over a censored case's prefix. *Stream score*: share of completed cases passed, per mix, with the censored
share beside it.

**Teacher-forced (TF) mode is a diagnostic.** Inputs are the **neutral export** of the reference trajectory (business
records and event history only, DESIGN-STREAMS §2.4 [M]), with the arm's own carry empty or rebuilt from history. TF
explains where an arm breaks; it never enters a decision. Grading is restricted to **informative case-ticks**: those on
which the echo and no-op controls fail; the echo/no-op pass rate per item is reported.

### 2.9 Controls

| kind | what | must |
|---|---|---|
| $0 bad controls (per item, §3) | empty; shuffled; plausible near misses; item shortcuts (keyword rule, calendar days, first-match, no-cumulative, …) | fail on ≥ 20 worlds per difficulty (CONTRACT [M]) |
| necessity controls ($0) | the reference minus one construct class: no compensation; no timer race; no calendar (24×7); first-match instead of precedence; latest edition always; no idempotency keys; no dedupe; no correlation (match by amount only) | each fails ≥ 50% of attack worlds' tail cases (W-BED §2.4 [M]) |
| OSS literal baselines | E1: Camunda 7 invoice demo logic; E8: c-oss on the `temporal-like` profile | fail the tail; c-oss fails only on permanent-failure-after-charge cases |
| echo / no-op | echo the SoR; do nothing | define the informative case-ticks; must fail every world in CL |
| gaming attacks ($0) | hold everything; escalate everything; wait for a human on everything; declare every obligation; pay twice with one key | fail every world (§9.6) |
| paid triviality attacks | one Haiku call per case-tick, inline render, effort none and medium, 12 attack case-ticks at d3 | ≤ 2/12 pass, or the item is demoted (W-BED §2.4 [M]) |
| white-box script (reported) | written with the generator source | if it passes, the item tests cost, not judgement, and claims say so |

### 2.10 Latent defects, false revealing events and the retroactive sweep

- **Defects come from the mutation miner** (§9.5): mutants of the frozen reference that pass every E0 case (the
  E0-silence check is **executed**, never asserted), are wrong on a computed manifest of earlier cases, and are revealed
  in E2 or E3 by an in-world event (vendor statement, network rejection, auditor finding, customer complaint,
  regulator acknowledgement). Hand-proposed defects (§3) are candidates only, admitted after the same executed check.
  The draft's E1 LD1 fails that check (§12 item 20).
- **False revealing events** are planted at the same rate as true ones: complaints and vendor claims that are invalid
  under the rulebook. A heal pipeline that "fixes" on them is a false heal; remediation outside the true manifest is a
  wrong remediation.
- **Protocol (jit-seed arm, DESIGN-STREAMS §0.2 [M])**: a lineage starts with c-def-k as its accepted v1 and runs CL.
  On a revealing event the heal pipeline must classify (latent defect, drift, env, or invalid claim), localise, fix
  through `promote.mjs` V0–V8 (no self-approval, F3), and sweep: replay past inputs through v+1 from the journal at $0,
  diff output digests, propagate to callers, emit remediation effects (LIBRARY §7.5 [M]).
- **Scoring**: detection latency and classification accuracy; healed(f), durable(f) on the version matrix; sweep
  precision and recall (the R3′ `scoreReplay` shape [M]); remediation exactness; **false-heal rate and wrong-remediation
  count on invalid claims**; sweep cost; guard widenings counted as defects (D9 [M]).

### 2.11 Semantics ledger (per item)

Every item keeps `ledger/SEMANTICS.md`: each documented feature of the compared system, marked *in* (with spec-E
section and doc file:line) or *out* (with the reason), ranked for addition by log frequency where a log exists. Every
claim states the omitted-feature count. Known omissions at design time:

| item | out (for now) | evidence |
|---|---|---|
| E1 | tax and currency in matching; vendor self-service; workflow escalation configuration | BPI 2019 has Change Currency 35 events (rare) [data]; others [I] |
| E1 (now in) | nine-field net-unit-price matching (:96); background receipt auto-matching with max attempts (`submit-invoice-workflow-automatically.md:35`); payment blocks (57,136 removals) and service entry sheets (164,975) | [doc], [data] |
| E5 | Reg E §1005.6 liability tiers; Reg Z (credit cards) | [unavail] |
| E5 (now in) | new-account rule: 20 business days and 90 days (§1005.11(c)(3)) | [web✓] |
| E6 | MPPR, MUE adjudication indicators, sequestration, global surgery | [crit, I] |
| E7 | major-incident case management (G11); real ServiceNow incident and problem state names | [unavail] |
| E7 (relabelled) | risk → 3/2/1-day duration is WorkArena task policy | [code] |

### 2.12 The reference arm (c)

- **Author**: one Opus 5.5 `claude -p` session per item (a model call, not a host Workflow fan-out, PAUSE §5.1 [M]),
  given spec-E, the BAR-SET decomposition and labelled fixtures (inputs and `referenceTransition` outputs) from dev
  worlds 1201–1206; never oracle code, controls or defects. It writes `reference.mjs` (flow-v3, per-instance `tick/1`,
  rule tables through P58 interpreters, clocks through P60, Haiku judges) and `envelope.json` (proposed engine IR,
  `foundry validate` where possible). The reference is a port of documented semantics, not a free design.
- **Validation**: c\* (judges answered from truth, `tools/flow-override.mjs` [M]) must pass every public golden and ≥ 95%
  of completed cases on dev world 1231. Because c\*'s fixtures come from the oracle, its agreement on dev worlds is partly
  circular; the public goldens are the independent part. (c) with live judges is validated once analyst-side; below 90%
  the author gets the failing cases once and revises once. Frozen by sha256 (solver; envelope at tier E). One fresh Opus
  rebuild is allowed, cost recorded.
- **If c\* still fails, that is a capability outcome**: "Opus could not build a correct port of item i at this spec". The
  item stays in the tables with (c) marked failed; it is excluded from the family test (Δᵢ is undefined) but every arm's
  absolute reliability is still reported. It is never relabelled "excluded: oracle".
- **Escalation policy, symmetric**: the primary policy is **no Sonnet escalation for any arm**; (c+S), the reference with
  Sonnet on a failed check, is reported descriptively, as are (a+S) and (g+S) if run.
- **Authoring cost** is the proxy for curation cost (W-BED §2.3 [M]).

---

## 3. Item specifics

Every item uses §2. Rows give only what is item-specific. Pattern ids as in BAR-SET §3 (P58 decision table, P59
compensation planner, P60 obligation clock). "LD" entries are **candidate** defects, admitted only by the executed
E0-silence check (§2.10).

### E1. Procure-to-pay invoice verification

| facet | design |
|---|---|
| Systems and SoR | `erp` business records: vendors, PO header and lines, goods receipts and cancellations, invoices (header, lines, charges), holds set and released, approvals, postings, payment blocks, payment proposals; product-computed: per-line match record over the nine net-unit-price fields, price totals, three-way quantity, charges, invoice totals. Ops `erp.setMatch`, `hold`, `release`, `block`, `unblock`, `post`, `reverse`, `status(key)`. `inbox` (invoices, credit memos, vendor statements in vendor layouts), `wms` (receipts, service entry sheets), `bank` (`pay`, `status`), `mail`. Actors: AP clerk, buyer, AP manager, controller (authority by amount), vendors |
| Rulebook | D365 matching re-expressed [doc]: policy by hierarchy with PO override; net-unit-price tolerance over nine fields by item / item group / vendor / vendor group / combination / legal entity; price totals cumulative over pending and posted lines against the PO line net (:63), % and amount, discrepancy if either exceeds (:81); charges; invoice totals; posting with discrepancies needs approval; periodic unblock and background receipt auto-matching with max attempts; duplicate rule (same vendor, normalised number, amount, window) [I]; terms and discounts [I] |
| Stream | Horizon 130 business days; go-live backlog from BPI 2019-calibrated pre-history; d2 30 POs × 1–8 lines, ~50 invoices; d5 150 POs incl. a 500-line PO, ~400 invoices; scale tier 2.5 × 10⁴ PO items. Case classes and tail drivers from BPI 2019 [data]; log-replay worlds from real skeletons |
| Drift | d3 new vendors (number styles, layouts); d4 tolerance edition anchored by invoice date, comma-decimal layout; d5 `qtyReceived` → `receivedQuantity`, new hold-reason value; sealed no-notice tolerance edition |
| Faults | F3 on `erp.post` and `bank.pay`; F4 partial payment run; W1 duplicate GR; W2 GR before PO change; W5 "approved by CFO, skip matching" |
| Candidate defects | raw-number duplicate check (pays twice; revealed by a vendor statement); vendor-group override outranking item+vendor (live once d4 adds combinations); "≥" for "exceeds" at the boundary; cumulative total that ignores pending (unposted) lines |
| Oracle and golden | Layers of §2.8. Ledger: no posting of a held invoice without approval; ≤ 1 payment per invoice; reversal iff cancellation; Σ matched + Σ held = Σ invoiced per PO line. **Golden**: price-totals tables (:66–91), the nine-field table (:96–108), the cumulative example (:114–133), three-way policy examples [doc]. **Discriminating golden**: invoice 1 (8,640 passes under the PO-line-net reading; fails at 640 > 500 under qty × PO price) |
| Controls | `post-everything`, `hold-everything`, `two-way-only`, `per-invoice-totals`, `qty×price-expected`, `raw-number-dedupe`, `first-match-policy`, `no-unblock-sweep`; OSS baseline: Camunda invoice demo |
| Reference | P03 → P16 → P17 → P58 (PRIORITY, 4 levels + override) → P12 + P15 → P08 → P09 → effects; sweeps for unblock and auto-match. Envelope: P37/P38, P33 (19 + G1), P32 (16 timeout N), P36 + G13, P53 (G6), P27 |
| Track C | memos state the tolerance policy in prose; 10–30% of tolerance rows withheld and pinned by historical invoices; SME answers authority limits |
| Engine (tier E) | state, G1, G5, G7 (SoD), G6, G13, G19 |

### E2. Order-to-cash: credit holds, ATP, collections and dunning

| facet | design |
|---|---|
| Systems and SoR | `erp` business records: customers (individual and group limits, expiry), sales orders, hold list as set and released, promise dates sent, AR open items, letters sent, fee postings; product-computed: effective limit, hold reasons, ATP, letter codes. `inv`, `mail`, `bank`, `ledger`. Actors: credit manager, approvers, collections agent, customers (pay, dispute, promise), sales |
| Rulebook | `cm-sales-order-credit-holds.md` 7 rule types (:47–143), rank triggers (:161–181), sequencing with exclusions (:182–197), release/reject/auto-release/approval/forced (:205–282); 5 limit scenarios; ATP (:29–60); letters (`process-collection-letters-example.md:31–33, 110, 129`); collections automation (`collections-process-automate.md:29–41`) [doc] |
| Stream | Horizon 90 business days; d2 40 customers, 150 orders; d5 300 customers in 5 credit groups, 1,500 orders, daily collections sweeps; synthetic distributions declared (no public log) |
| Drift | d3 new segment with different terms; d4 blocking-rule edition (mandatory rules, 10.0.35) and a new collection step; d5 account-status enum extension, AR API rename; sealed no-notice edition |
| Faults | F1/F2 on letters; F3 on fee posting; W1 duplicate payments; W2 payment before invoice post; W4 limit change during evaluation |
| Candidate defects | individual limit where the group limit applies; Group-level exclusion ignored; ignore-payments switch inverted for line codes; re-promise when still achievable |
| Oracle and golden | hold reasons per checkpoint; "Multiple" iff ≥ 2 reasons; release/reject/auto-release; promise dates; letter codes, fees, minimums, days block, quiet days. Ledger: no shipment of a held order; no letter inside days block or quiet days; fee iff letter; ≤ 1 letter per customer per run; forced hold never auto-released. **Golden**: the 3-run letter example, 5 limit scenarios, ATP fence example [doc]; ERPNext `dunning` doctype tests as a read-only second semantics reference (GPL-3.0, no code copied) [web✓ licence] |
| Controls | `limit-only`, `all-level-only`, `never-release`, `release-all`, `letter-every-run`, `ignore-switch`, `always-repromise` |
| Reference | P58, row 2 (effective limit, cumulative ATP), row 4 guards, row 5 invariants, P12, P04, P07 + P09. Envelope: P38/P37, P32, P10, P36, P34 (row 18 > 1 h N), P33 (G1), P42, G8 |
| Engine (tier E) | state, G1, G3, G5, G7, G8, G13, G15, G16, G18 |

### E3. Group record-to-report

| facet | design |
|---|---|
| Systems and SoR | per-entity ledgers `gl-<le>`; `ic` mirrored documents; `fx`; `close` tasks (owners, dependencies, due dates, status); `cons` eliminations, translated balances, statements. Actors: task owners, elimination approver, group controller |
| Rulebook | close DAG (dependencies block completion; past due after due date); elimination rules with effective/expiry dates, wildcards, net change vs fixed amount; translation (balance sheet at closing rate, P&L at average rate, a stated reading [I]); rounding remainder to the last line (A15) |
| Stream | Reuses the W-bed R4 world and `fx.mjs` [M]; 4 monthly closes; d2 3 entities, 40 pairs, 25 tasks, 6 rules; d5 8 entities in 3 currencies, 400 pairs incl. return chains, 60 tasks, 20 rules with editions |
| Drift | d3 acquired entity; d4 elimination rule expires and a successor starts; d5 chart-mapping change |
| Faults | F4 partial elimination batch; W2 mirrored document after cut-off; W4 original order changed after mirroring |
| Candidate defects | rule by run date, not period; P&L at closing rate; cross-company dependency missed; rounding remainder dropped |
| Oracle and golden | elimination set exact; translated balances exact under stated rounding; group conserved; task legality; sign-off only when complete. **Golden**: hand-derived cases from `elimination-rules.md` (descriptive) and R4's composed oracle [M] |
| Controls | `no-dependency-gating`, `amount-only-pairing` (R4 necessity control, 0.40 wrong [M]), `closing-rate-everywhere`, `run-date-edition` |
| Reference | P54/P53 calling the frozen E1 and E2 entity slices by hash; P17; P16; P58; row 2 FX; P15; row 5. Envelope: close DAG as G6 + G7, P32, P36, G12, G14/G4 |
| Engine (tier E) | G4, G6, G7, G8, G10, G12, G14, G15, G18 |

### E4. KYC/CDD with screening, then AML → SAR

| facet | design |
|---|---|
| Systems and SoR | `crm` (entity, owners, control person, verifications, risk tier, next review), `registry` extracts, `lists` (synthetic versioned watchlist), `screening` (hits, dispositions), `tm` (synthetic alerts), `case` (grouping, SAR decision), `filing` (submission, acknowledgement), `mail`. Actors: customer (documents on time, late or never), L1 analyst, L2 investigator, senior approver (four-eyes), BSA officer |
| Rulebook | 31 CFR 1010.230 and 1020.320 as verified [web✓] (BAR-SET E4); screening scorer published in the spec (prefilter, whole-name JW, part-wise JW + Soundex, maximum), so hits are exact by construction; synthetic risk and EDD tables |
| Stream | Horizon 90 calendar days; d2 30 onboardings, 200 alerts; d5 150 onboardings (up to 4 layers, trusts, nominee chains), 2,000 alerts, 3 list versions, transliteration and reordering variants with planted DOB and country cues |
| Drift | d3 new registry format; d4 list update → rescreen sweep, EDD edition; d5 new disposition enum |
| Faults | F1/F2 on lists; F3 on filing (query the acknowledgement, never double-file); W1 duplicate alerts; W3 documents after expiry |
| Candidate defects | indirect ownership summed not multiplied; whole-name-only scoring; SAR clock from alert date not detection; rescreen cursor skipping recent onboardings |
| Oracle and golden | owner set and control person; verifications; hits; disposition chain with four-eyes; alert → case partition; SAR iff rule; due dates. Ledger: no activation before CDD; no filing without approval; ≤ 1 filing per case. **N-version**: two oracle implementations by separate sessions, differential fuzz over 10⁴ worlds (seed salt, §6), every disagreement resolved by quoting the CFR text; Moov Watchman (Apache-2.0) as a black-box alternative scorer edition and Track C "product" after owner approval under D5 [web✓] |
| Controls | `exact-name-screening`, `direct-stakes-only`, `alert-per-case`, `alert-date-anchor`, `escalate-everything` |
| Reference | P03, P12 over layers with row 2 products, P07, blocking + code scorer → P09 band, P58, P16/P17, P60. Envelope: P55 + G9, P33 racing expiry (G2), P09 four-eyes (G7), P32, P38 rescreen (G13), P42 |
| Engine (tier E) | G1, G2, G3, G5, G7, G9, G12, G13, G15, G17, G18 (G11 out of round 1) |

### E5. Debit-card dispute: Reg E front end + synthetic network-X

| facet | design |
|---|---|
| Systems and SoR | `core` (accounts, first-deposit date, provisional credits), `cards` (authorisations, clearing, ARN, merchant name variants), `disputes` (claim date, condition, stage, notices, liability), `network-x` (file, pre-arbitration, arbitration), `mail`. Actors: cardholder, acquirer/merchant (accept, represent with evidence, silence), analyst, arbitration approver |
| Rulebook | Reg E §1005.11 verified [web✓] including (c)(3)(i) 20 business days and (c)(3)(ii) 90 days for not-in-state, POS debit and new-account transfers, report in 3 and correct in 1 business days, (d)(2) notice and 5-business-day honouring; network-X re-expressed with synthetic numbers (23 conditions, 4 categories, filing 120 days, pre-dispute 15/30/60, pre-arbitration 30, response 30, arbitration 10, regional overrides); debit only |
| Stream | Horizon 200 calendar days; d2 40 disputes; d5 300 disputes with 8–10 concurrent clocks; POS, foreign and new-account mix; ambiguous narratives with a `none` member |
| Drift | d3 new acquirer evidence format; d4 network-X edition by processing date, holiday-calendar update; d5 ARN rename and a regional override; sealed no-notice edition (inferred from network rejection codes) |
| Faults | F3 on provisional-credit posting; F4 partial reversal batch; W1 duplicate acquirer responses; W2 representment before acknowledgement; W3 late acquirer response |
| Candidate defects | business days ignore holidays; always 45 days; reversal without the honouring notice; network limit anchored at transaction date instead of the "later of"; new-account 20-day rule ignored |
| Oracle and golden | condition (enum, undecidable → P09), validity, every action in its window, provisional credit → notice → (reversal after notice + honouring), liability, legal transitions. Ledger: provisional credit exactly once; no chargeback past the limit; no duplicate chargeback. **N-version** + hand-derived timelines across holidays and the new-account boundary |
| Controls | `keyword-to-condition`, `calendar-days-everywhere`, `no-provisional-credit`, `always-45`, `no-reversal`, `file-everything` |
| Reference | P07 (quote check, `none`), P09, P58 (regional > global; edition by processing date), P60 ("later of" anchors; calendars), P16/P17, P03. Envelope: P37, P55, P33 (G1) racing the deadline (G2), P34 (G5), P32, P30 (row 23 N), P42 |
| Engine (tier E) | G1, G2, G3, G5, G10, G12, G15, G16, G17, G18, G19, row 23 |

### E6. Medicare professional claim adjudication (synthetic codes)

| facet | design |
|---|---|
| Systems and SoR | `claims` (X12-like 837P text, synthetic), `elig` (eligibility, accumulators), `edits` (PTP with modifier indicator, MUE, add-on, by edition), `fees` (RVU, GPCI, CF, synthetic), `adj` (claim and line states, CARC/RARC, CO/PR/OA), `remit` (835-like), `bank` (EFT). Actors: provider, medical reviewer |
| Rulebook | front-end edits; PTP with modifier bypass; MUE; add-on; RVU × GPCI × CF stated explicitly; accumulators; COB; group and reason codes; provider-level interest on late clean claims; quarterly editions by date of service. Out (semantics ledger): MPPR, MAI, sequestration, global surgery |
| Stream | Horizon one quarter + 30 days; d2 200 claims × 1–6 lines; d5 2,000 claims, two editions straddling a quarter; **scale tier** 10⁵ claims, 10⁵–5 × 10⁵ PTP rows, ~100 localities |
| Drift | d3 new provider group with different modifier habits; d4 quarterly edition switch and a new reason-code mapping; d5 837 layout variant and a mid-quarter fee correction |
| Faults | F3 on EFT; F4 partial remittance batch; W1 duplicate and corrected claims (void and replace) |
| Candidate defects | MUE per line instead of per claim and date of service; modifier bypass where forbidden; edition by processing date; coinsurance before deductible |
| Oracle and golden | per-line allowed, paid, adjustment cents and codes; billed = paid + Σ adjustments [I]; totals, interest, accumulators. Ledger: ≤ 1 EFT per remittance; void/replace pairs; no payment for denied lines. NCCI manual examples [unavail], so hand-derived cases + N-version pricing |
| Controls | `single-pass-pricing-no-edits`, `edits-ignore-modifiers`, `latest-edition`, `no-accumulators` |
| Reference | P01 spine, P03, P12, P58, P15, row 5, P16, P42. Envelope: P36, P33, P09/P32, G13, P60 |
| Engine (tier E) | G10, G12, G13, G15, G17, G18, G19 |

### E7. ITSM incident → problem → change with an SLA engine

| facet | design |
|---|---|
| Systems and SoR | `itsm` incidents, problems, changes (New(−5) … Canceled(4)), approvals; SLA records as business records (start, pause intervals, stop) with product-computed elapsed, business-elapsed, breach; `cmdb`, schedules (business hours, holidays, time zones), `monitor`, `notify`. Actors: callers (respond or not), assignment groups, problem manager, CAB members, approvers |
| Rulebook | SLA start/pause/stop/resume/reset/cancel, retroactive start and pause, schedule source, time-zone precedence; 9-cell priority; standard changes skip Assess/Authorize; revert to New cancels approvals; cancel disabled in Review; 7 conflict types [bar]. Schedule rule = **WorkArena task policy** (risk → 3/2/1 days within ±5%, `:233–235`; comment at :210 contested) |
| Stream | Horizon 30 business days at hour granularity; d2 100 incidents, 10 problems, 20 changes, 6 SLA definitions; d5 1,000 incidents with an alert storm, 12 definitions in 3 time zones, 80 changes with conflicts and blackouts |
| Drift | d3 new group in a new time zone; d4 SLA definition edition and a blackout policy; d5 state enum extension, CMDB rename |
| Faults | F1/F2 on notify; W1 duplicate alerts (one incident); W2 resolve before assignment; W4 reassignment during a pause |
| Candidate defects | awaiting-caller does not pause; 24×7 where a schedule is named; retroactive start ignored on reassignment; blackout conflicts ignored |
| Oracle and golden | minute-exact elapsed, business-elapsed, breach (a pure function of history: the strongest tier-S oracle); legal transitions; approvals cancelled on revert; conflict set; schedule checks; escalations. **Golden**: ported WorkArena validator cases; hand-derived SLA timelines across a holiday and a DST change; ERPNext `service_level_agreement` doctype tests as a read-only second semantics reference (GPL-3.0, no code copied) |
| Controls | `24x7-no-pause`, `pause-ignored`, `first-match-priority`, `no-conflict-check`, `cancel-in-review` |
| Reference | P07, P58, P60, P25, P12, P16 + P09. Envelope: P38, P33, G3, P32 with timeout, G4, G14, G8, P42 |
| Track C | product = P60 SLA engine + P58 priority/approval tables; the arm configures SLA definitions, schedules and approval matrix from an SLA policy memo and historical tickets |
| Engine (tier E) | G2, G3, G4, G7, G8, G14, G15, G16, G17 (`admission` optional for storms) |

### E8. Order-fulfilment saga with compensation

| facet | design |
|---|---|
| Systems and SoR | `orders` (order, fulfilments, payment, shipment; ~19 status values from `app/order/api.go:75–197` [code]), `inventory` (reserve, release), `billing` (charge, refund, idempotency key), `carrier` (create, cancel; status signals), `fraud`, `notify`. Actors: customer (amend or cancel within the window), carriers |
| Platform profile | `temporal-like` (§2.2) for every arm |
| Rulebook | the app's semantics (per-location fulfilments; customer-action timeout, 30 s in the demo `workflows.go:23–24`, scaled to hours; charge then ship `:313–333`) **plus the bar's saga specification** from the trip BPMN: on failure compensate committed steps in reverse order (cancel shipment, refund, release reservation); all-or-nothing per fulfilment; no orphaned charge; a stated rule for cancel-vs-timeout races |
| Stream | Horizon 14 days at hour granularity; d2 50 orders × 1–3 fulfilments; d5 400 orders × up to 6, carrier failure 10% (of which a declared share permanent), fraud holds |
| Drift | d3 new carrier with a different status vocabulary; d4 per-SKU partial shipment allowed; d5 billing idempotency header renamed, inventory schema change |
| Faults | F3 on charge and refund; F4 partial reservation; F6 permanent carrier failure; W1 duplicate signals; W2 delivered before in-transit; W3 cancel after the window |
| Candidate defects | refund retried without a key; order cancel not cancelling a started child shipment; late in-transit signal regressing a delivered status; cancel-vs-timeout race resolved timer-first |
| Oracle and golden | per order, all fulfilment effects commit or the exact compensation set commits in reverse order of **committed** steps (including a step whose outcome was unknown and whose status query shows committed); no orphaned charge; no double charge or refund; final statuses; idempotent signals. **Golden**: hand-derived failure-point cases from the trip saga's structure |
| Controls | **c-oss** (literal port, same profile; fails only on permanent-failure-after-charge cases: "a different specification"), `forward-order-compensation`, `no-keys`, `last-signal-wins` |
| Reference | P25, P08, P59. Envelope: P30 (row 23 N), P53/P54 (G6, G14), P33 (G1, G2), P26, G19, G8, P29, P27 |
| Engine (tier E) | G1, G2, G6, G8, G14, G19, row 23 |

### E9. Consumer loan origination with multiple offers

| facet | design |
|---|---|
| Systems and SoR | `los` (A_ states, O_ states, W_ work items with lifecycle), `docs`, `bureau`, `mail` and `phone`, `core`. Actors: applicant (returns an offer, documents late or never), validators and underwriters (suspend, resume, withdraw, abort), fraud team |
| Rulebook | **synthetic**: completeness rules, offer-terms grid, offer expiry 30 calendar days from sending, call-after-offers, bounded incomplete-file loop, fraud triggers. Exact on itself; conformance to the log descriptive |
| Calibration | BPI 2017 [data]: offers per application 1 → 22,950 … ≥ 6 → 64; A_Incomplete ≥ 1 in 15,003, ≥ 3 in 1,716; O_Sent → A_Cancelled p10/p50/p90 8.0/30.7/32.8 days; O_Sent → O_Returned 4.1/7.8/18.6; work-item transitions as in §2.7; case length p90 25 business days. Log-replay worlds from real skeletons. BPI 2012 (`_data/bpi2012`) p90 21 business days [data] as a second calibration log |
| Stream | Horizon 60 business days; d2 60 applications; d5 500 |
| Drift | d3 online-only channel; d4 offer-grid edition and a new completeness requirement; d5 document format change, work-item schema change |
| Faults | F1/F2 on the bureau; F3 on account opening; W1 duplicate offer returns; W3 return after expiry |
| Candidate defects | expiry anchored at creation not sending; sibling offers not cancelled on acceptance; incomplete-loop counter reset; fraud trigger reading only the first submission |
| Oracle | A/O/W states; offer set and cancellations; call tasks; expiry times; rule decisions; lifecycle legality |
| Controls | `happy-path-top-variant`, `no-expiry`, `single-offer`, `unbounded-calls` |
| Reference | P03, P58, P25, P09. Envelope: P55 + G9, P33 return vs expiry (G2, G5), P32/P10, G7 lifecycle, G12, G3 |
| Engine (tier E) | G2, G3, G5, G7, G9, G12, G15 |

### E10 (optional anchor), E11–E13 (library-unseen reserves)

- **E10 tau2-bench**: exact evaluators only (DB end state, action, communicate); the model-judged evaluators are dropped.
  The default user simulator `gpt-4.1-2025-04-14` (`src/tau2/config.py:18` [code]) is not a policy-file model; with a
  policy-file simulator E10 loses leaderboard comparability and is neither deterministic nor $0. Owner decision §11.
- **E11 Reg X dual tracking, E12 SEPA R-transactions, E13 payroll 15-T**: tier S only, d2–d4, smaller worlds; their
  spec-E is written only after the P58–P60 cards are frozen, and the card authors never see them. They measure whether
  library-first construction generalises (PROOF-LEDGER L9).

---

## 4. Arms

| arm | builds | runs | construction budget | notes |
|---|---|---|---|---|
| **agent-H** | — | a Haiku 5.5 agent per case-tick (Read, Bash; files as above) | 0 | "agent without workflow"; fresh context per call, ≤ 64 KB carry |
| **agent-H-ws** | — | as agent-H with a persistent per-arm workspace (§2.2), so it can keep and reuse its own scripts | 0 | the fair "agent that learns on the job" baseline (critique 10) |
| **agent-O** | — | an Opus 5.5 agent per case-tick | 0 | descriptive ceiling; 1 world, sampled cases |
| **(a) JIT H/H** | Haiku interprets warmup case-ticks, then compiles flow-v3 `tick/1` from traces | compiled + Haiku judges; deopt → Haiku interpreter; shadow rate ε per PREREG (0.1–0.25) | 2 compiles at the Haiku cap + recompiles on deopt | the owner's literal question |
| **(g) library-first** | LIBRARY §5 constructor with L0 + L1 incl. P58–P60, **hierarchical spec retrieval** (§2.5); tables as data | as (a) | ≤ 23 Haiku calls per construction, ≤ 4 constructions per lineage, every call ≤ 8K | not run on the E-bed until hierarchical retrieval exists |
| **B1-H** | Haiku builds `tick/1` **once** from spec-E, no fixtures, no traces, no score service (`startServices({ scoreLimit: 0 })`) | built solver; deopt or crash → Haiku interpreter | equal to (a)'s compile cap | W-BED arm (e) [M]; O1 warns it may match the JIT |
| **B1-O** | Opus builds once from spec-E, no fixtures | built solver + Haiku judges | recorded | separates "Opus with fixtures" (c) from "Opus from the spec" |
| **(c) reference** | Opus once per item with fixtures (§2.12) | frozen solver + Haiku judges | recorded | "what Haiku must equal or beat" |
| **c-oss** | literal port (E8) | as written, `temporal-like` profile | — | structure-necessity datum |
| **(c′) frontier workflow** | Opus writes the item workflow once from spec-E, with one rewrite allowed per epoch | host runs it with Haiku judges | per item, recorded | PROOF-LEDGER J4; needs the owner's go-ahead; K ≥ 2 if it enters H-E7 |
| **a-seed:c-def-k** | none (v1 = reference with mined defect k) | as (a) with heal and sweep | heal budget recorded | §2.10; 1 world per defect |
| **Track C arms** | agent-H-C, (a)-C, B1-H-C, (c)-C configure the product | product engine + arm's exception solver | construction $ + SME minutes | §2.3 |

**Shared conditions.** Same worlds, case order and fault schedule for every arm; the same platform profile per item;
the same escalation policy (none, primary); per-arm unreadable roots; costs from the host journal only, never from
solver reports (D21's forged-tape lesson [M]); every 429 recorded with its injected tag; model ids from
`policy/models.json` only; **any arm entering a decision runs K ≥ 2 worlds**.

**Curriculum** (W-BED §5 [M]): (a) and (g) run CUR on E1 → E2 → E3 (E3's reference calls the frozen E1/E2 slices by
hash; arms may call their own accepted E1/E2 solvers) and ISO on E3 as the ablation; other items ISO only. Cross-item
reuse offers include deliberate near misses (E2's credit-rule interpreter offered for E1's "either exceeds" tables; E1's
d2-edition solver offered after the d4 edition), measured as wrong reuse.

---

## 5. Metrics

| metric | definition |
|---|---|
| **Verified success per case (CL)** | §2.8 case pass on completed cases, per arm, item, epoch and mix; censored share beside it; Clopper-Pearson bounds per world and pooled |
| **Verified success per case-tick (TF, diagnostic)** | on informative case-ticks only; echo/no-op pass rate reported |
| **Cost per case-tick; cost per verified case** | list $ from the journal, including shadows, adjudications and fallbacks |
| **Construction cost** | warmup + compiles + recompiles (a); constructor calls + repairs + smoke (g); build (B1); authoring + revision (c); per-epoch rewrites (c′); **amortised library-card authoring** (P58–P60 sessions, split across items using them); Track C: + SME minutes. Also tokens, wall-clock, owner minutes |
| **Amortisation horizon** | first case after which cumulative cost per verified case ≤ agent-H's (and agent-H-ws's); ∞ if never within the horizon |
| **Time-to-durable** | per epoch, DESIGN-STREAMS §7.4 [M], in business days |
| **Deopts** | by kind and epoch; false deopts |
| **Heal events** | count; classification accuracy (incl. invalid claims); healed(f), durable(f); false heals; guard widenings; regressions; heal $ |
| **Sweep** | precision and recall on affected cases; remediation exactness; wrong remediations; sweep $ |
| **Reuse** | correct, wrong and missed reuse plus savings (THESIS-JIT §6.7 [M]) |
| **SLA** | arm-caused breaches, missed deadlines, late or false escalations, pause errors |
| **Compensation correctness** | per failed saga or reversal: set exact, order exact, no orphan, no over-compensation, idempotent under F3/F4 |
| **Ledger violations** | critical and non-critical per 1,000 cases; upper bound on the critical rate |
| **Human load and straight-through rate** | human tasks per case vs the reference (over- and under-escalation), reported separately from errors; SoD violations |
| **Edition detection latency** | no-notice variants: business days from effective date to first correct behaviour |
| **Scale tier** | case-ticks per second, peak memory, judge $ per 10⁴ cases |
| **Structural fidelity** (descriptive) | span tree vs reference decomposition (W-BED §6.3 [M]) |

---

## 6. Statistics, decision rules and kill rules (PREREG skeleton `ebed-1`)

**Units.** The decision unit is the **CL case segment**, paired across arms by (world, case) (worlds and case arrivals
are identical across arms; each arm's trajectory is its own). TF case-ticks are diagnostic only.

**Functions to add to `experiments/jit/stats.mjs` before any freeze ($0, pre-registered).** (i)
`nonInferiority(pairs, δ)`: world-clustered bootstrap CI of the paired difference, decision on the lower bound vs −δ;
(ii) `clopperPearson(x, n, side)`; (iii) `wilcoxonExact(d)` (exact null for n ≤ 12); (iv) `holm(pValues)`. `stats.mjs`
today has `DECISION_RULE` (a superiority rule with a 3-point floor per stream) and no non-inferiority routine [crit, M].

**Per-item hypotheses (secondary; Holm-adjusted across items within each row; reported as secondary).**

| id | claim | test |
|---|---|---|
| H-E1(i) | (g), (a), B1-H non-inferior to (c) on completed CL cases (δ = 10 points) | `nonInferiority`, K ≥ 2 |
| H-E2(i) | reliable: one-sided 95% CP lower bound ≥ 0.95 on completed tail-mix cases pooled over held-out worlds, each world's own bound ≥ 0.90, zero critical violations | absolute; with pooled n = 300 at most 8 failures, n = 100 at most 1 [M-c]; per world n = 100 at most 4 [M-c] |
| H-E2c(i) | critical-violation rate ≤ 0.1% (one-sided 95% upper bound) | needs ≥ 2,995 clean cases [M-c]; scale tier, compiled arms only |
| H-E3(i) | cheap: X's cost per verified case at horizon end ≤ agent-H's and agent-H-ws's; amortisation horizon within the stream | paired bootstrap by world |
| H-E4(i) | structure matters: (c) > agent-H-ws on completed tail-mix cases | `DECISION_RULE` (large gaps expected) |
| H-E5(i) | adapts: time-to-durable after E2 and E3 ≤ 8 business days; sealed families handled ≥ 0.75; no-notice editions detected | absolute, per world |
| H-E6(i) | heals: per mined defect, detected and healed; sweep precision and recall ≥ 0.9; remediation exact; false heals on invalid claims = 0 | per defect, per world |
| H-E7(i) | frontier comparison (J4): (g) within 10 points of (c′) at ≤ 1/5 of (c′)'s construction + run cost | `nonInferiority`, K ≥ 2 |
| H-E8(i) | Track C: X configures item i to H-E2 reliability at ≤ the reference's SME minutes × 2 | absolute + cost |

**Family-level bar decision (primary).** For each admitted core item, Δᵢ = pooled CL tail-mix success of arm X − (c).
"Haiku construction meets the enterprise bar (documented rule-and-deadline core, tier S, Track P)" for arm X requires
all of:
- (i) exact one-sided Wilcoxon signed-rank on {Δᵢ + δ}, p < 0.05 (for 9 items, W⁻ ≤ 8, p = 25/512 = 0.049 [M-c]);
  the sign test is not used;
- (ii) H-E2 holds for X on ≥ 7 of the admitted core items;
- (iii) no item where X has a critical violation that (c) does not.

This is an intersection-union test, so the conjunction needs no correction; **Holm across the arms tested** ((a), (g),
B1-H) at family-wise α = 0.05 for (i). Items excluded at K1, or where (c) failed as a capability outcome, leave the test;
thresholds are recomputed exactly for the remaining n, and n < 6 means no family-level claim. Track C gets the same
decision structure separately once ≥ 6 items have a Track C package.

**Power** [M-c, `efinal/pw.mjs`, per-item gap SE from `pairedPower` at m = 40, ρ = 0.1]: Wilcoxon at true equality
0.60 (K = 2) and 0.85 (K = 4); at a true gap of −5 points 0.25 and 0.39; at −10 points 0.05 both. **K = 4 held-out worlds
are recommended** for every item entering the family test. H-E2 with n = 100 cases per world and "every world ≥ 0.95" as a
point rule would pass all 4 worlds with probability 0.14 for a 0.95-reliable arm and 0.94 for a 0.98-reliable one [M-c];
the bound-based rule above replaces it.

**Scope.** The nine items were selected, not sampled; no inference beyond them.

**Seeds** (proposed `SEED-LEDGER.json` entries, `owner: jit`, beds `ebed-e1` … `ebed-e13`; no overlap with existing
ranges 1–400, 401–490, 5000–5099, 5001–5006, 6001–6004, 7000–7199, 8001–8724 [M]):

| range | split | use |
|---|---|---|
| 1001–1199 | dev | bed health, property, metamorphic, mutation suites (allow jit-dev) |
| 1201–1206 | dev | (c) author's labelled fixtures |
| 1211–1222 | dev | triviality, necessity, gaming attacks |
| 1231–1234 | dev | reference validation (1231); dev rehearsals (1232–1234) |
| 1241–1249 | dev | specificity solvers and Track C rehearsal |
| 1301–1310 | dev | fuzz base seeds, each expanded by salt `ebed-fuzz/<item>/<i>` for i < 10⁴ (N-version differential fuzz, validator fuzz) |
| 9101–9104 | test | held-out worlds A–D per item |
| 9201–9204 | test | reserve worlds (sealed families, heal arm) |
| 9301–9302 | test | scale-tier worlds |

**Freeze record**: bed and generator sha256 per item; spec-E and semantics-ledger shas; golden, N-version and specificity
shas; sealed plug-in sha; P58–P60 card shas (frozen before any spec-E); reference solver and envelope shas; flow-v3 and
stream tree ids; library catalog sha; kit hash; policy hash; analysis-script hashes; calibration report.

**Kill and validity rules.**
- **K1 oracle validity** ("excluded: oracle"): a public golden fails; an N-version disagreement unresolved; a bad,
  necessity or gaming control passes; mutation score < 0.95; **a specificity solver is falsely rejected**; calibration
  fails for E1/E9 generators; censored share > 20% in any epoch with the declared horizon.
- **K1′ frontier capability** ("reference not buildable"): c\* below 95% on completed dev cases after one rebuild. Item
  stays in the tables; leaves the family test only.
- **K2 triviality**: one Haiku call per case-tick passes > 2/12 attack case-ticks, or a 20-line script or keyword
  control passes ≥ 20% of tail cases → demoted from the family test (reported).
- **K3 headroom**: agent-H-ws ≥ (c) on E2–E3 epochs → excluded from H-E4, kept for H-E1/E2.
- **K4 budget**: an arm spending > 2× its estimate stops.
- **K5 env faults**: > 25% impaired case-ticks from real (untagged) faults → arm invalid in that world.
- **K6 construction**: (a), (g) or B1-H reaching no accepted solver within its cap on both pilot items in both worlds
  stops for the programme; the answer for it is "no at the enterprise bar".
- **K7 bar early stop**: if (g), (a) and B1-H all fail H-E2 on both pilot items, later items run only (c) and agent-H-ws
  until the owner decides.

---

## 7. Engine primitives each item needs, and the UI construct

● central; ○ partial; – not needed. Tier S works around every column through the host; tier E needs the engine node.

| primitive (L0 row / gap) | E1 | E2 | E3 | E4 | E5 | E6 | E7 | E8 | E9 |
|---|---|---|---|---|---|---|---|---|---|
| cross-run state (27) | ● | ● | ● | ● | ● | ● | ● | ○ | ○ |
| durable correlated wait + timer race (19 + G1/G2/G5) | ● | ● | ○ | ● | ● | ○ | ● | ● | ● |
| absolute-time timers, pausable clocks (18 `at` + P60/G15, G16) | ○ | ● | ● | ● | ● | ○ | ● | ○ | ● |
| human task: timeout routing, roles, SoD, lifecycle (16/17 N + G7, G3) | ● | ● | ● | ● | ● | ○ | ● | ○ | ● |
| compensation + idempotent effects (23 + G19) | ○ | ○ | ○ | – | ● | ○ | ○ | ● | ○ |
| envelope multi-instance / child / cancel (G6, G14, G4) | ● | ○ | ● | ○ | ○ | ○ | ● | ● | – |
| instance query and sweeps (G8, G13) | ● | ● | ○ | ● | – | ● | ● | ○ | – |
| in-flight versioning (G10) | – | ○ | ○ | – | ● | ● | – | – | – |
| human-task form (G21) | ● | ● | ● | ● | ● | ○ | ● | ○ | ● |

**Bar-weighted engine order** (replaces BUILD-ORDER §5's corpus order for this programme): 1 `state`; 2 one durable wait
node (`wait.signal` with `correlate`, `race`, timeout routing, plus row 18 `at`); 3 human-task completion (`onTimeout`,
`assign`, SoD, lifecycle, reminders); 4 `compensate` + effect `idempotencyKey`/`onUnknown`; 5 G6, G14, G4; 6 G8 + G13
via a host binding plus `trigger.schedule`; 7 G10. `session`, `admission` and `stream` are off the core path. Each step
breaks the engine freeze (ROADMAP rule 13 [M]) and lands on a branch merged after any in-flight frozen round.

**Card budget.** No new L0 rows; fields on existing rows (`correlate`/`race` on 19; `at` and calendar on 18;
`assign`/`onTimeout` on 16; `idempotencyKey`/`onUnknown` on 15). The card is at 2,962 of 3,000 tokens [M], so each field
needs an equal cut and T2 phrase assertions must be updated.

**The UI construct (G21)** — full evaluation in OPENUI.md.
- **Tier 0 ($0, build now)**: forms compiled by code from each human task's `answerSchema` (portable subset), in a
  `tools/ui/` sidecar (`web/` is in the kit hash). The host re-validates every submitted answer; the answer is untrusted.
- **Why the host must re-validate even with a UI framework**: OpenUI's `numeric` rule passes `"12abc"` (ECMAScript
  `parseFloat`, `spec/language.md:382`); its rules are only `required`, `email`, `url`, `numeric`, `minLength`,
  `maxLength`, `min`, `max`, `pattern` (:378); events carry `formState` as `{ value, componentType }` per field
  (:442–446) [doc, re-read], so an adapter must map to a typed answer anyway.
- **On the critical path**: a declared share of actor answers goes through the rendered form and the `formState` adapter
  (§2.7), so a UI defect shows up as case failures, not only in G21's own round-trip test.
- **Tier 1 (optional, later)**: OpenUI Lang for read-only worklists (E2 hold list, E7 SLA board, E5 dispute timeline)
  under the OPENUI.md kill rule; generated UI is never authority.

---

## 8. Build order, tiers, sessions and dollars

### 8.1 Unmetered steps (no metered model calls; nothing under `src/`, so the freeze holds; authoring sessions draw on the quota window)

| # | build | gate |
|---|---|---|
| 0 | Bed contract v1.1 amendment: `world-stream` kind, per-instance mode + sweep ticks, on-policy CL grading with allowed windows, censoring, platform profiles, two tracks, TF as diagnostic; SEED-LEDGER entries; `stats.mjs` additions (`nonInferiority`, `clopperPearson`, `wilcoxonExact`, `holm`) with simulation tests | owner review of the amendment |
| 1 | **Library cards P58, P59, P60**, written by a session blind to E1–E13 from outside sources (DMN hit-policy semantics, Kogito DMN examples, Temporal/Camunda saga docs, a generic SLA-clock description), three fixtures each, **frozen before any spec-E exists**; G18 edition convention | T3/T4-style tests; card shas recorded |
| 2 | **G20 host** (`beds/ebed/host/`): next-event clock with go-live backlog, per-instance routing and sweep scheduling, typed mocks with keyed idempotency and `status(key)`, platform profiles (`bare`, `temporal-like`, `product`), provisional and committed ledgers, obligation scheduler, human-task router with actors and noise model, fault injector with `injected` tags, clock freeze across quota stops, persistent workspaces, replay journal | host property suite (§9.2), replay determinism (§9.7) |
| 3 | Oracle-side libraries (calendar G16, decision-table evaluator, obligation clock, saga planner, ledger checks), independent of the cards | unit tests; differential vs step 1 cards on golden suites |
| 4 | Spec-E + semantics ledger per item, written blind to oracle and defects; measured spec tokens; hierarchical-retrieval design note for arm (g) | spec-explicitness test |
| 5 | Items in order: **E8** (smallest, code-heavy, compensation, platform profile), **E1** (best goldens, BPI 2019 calibration and replay), **E7** (P60 oracle, WorkArena port), then E2, E9, E3 (needs E1/E2), E5, E4, E6; then E11–E13 (after the cards are frozen) | per item K1: goldens incl. discriminating, N-version (E4–E6, P60 everywhere), **specificity (≥ 3 correct solvers, 0 false rejects)**, controls, metamorphic, mutation ≥ 0.95, leak, twin, censoring report, calibration (E1, E9) |
| 6 | Mutation-mined latent defects with executed E0-silence checks and manifests; false revealing events; sealed families (format, schema, no-notice edition) by a separate session | §2.10; sealed sha |
| 7 | `stream.mjs` wiring for `world-stream`: per-instance and sweep ticks, on-policy CL scorer, TF neutral-export diagnostic, CP and censoring report, scale-tier runner | stub-gateway stream test |
| 8 | G21 tier 0 (OPENUI.md spike B1) and the `formState` adapter in the host | OPENUI §6 suites |
| 9 | Track C scaffolding for E1 and E7: product bindings (cards + item modules, differentially tested against the oracle), memos, historical cases, SME script, withheld-row manifests | product ≡ oracle on 20 dev worlds per difficulty |

### 8.2 Metered steps (each needs its go-ahead; quota rule PAUSE §0.5 [M])

| # | step | cost [I] | output |
|---|---|---|---|
| P1 | Triviality attacks, pilot items E8 and E1 (then the rest), 12 case-ticks × 2 efforts | ≈ $1–3 per item | K2 per item |
| P2 | References (c) for E8 and E1 (Opus authoring + ≤ 1 revision; c\* at $0) | ≈ $30–80 ($15–40 per item) | frozen shas; authoring-cost row; K1′ |
| P3 | Dev rehearsal on world 1232, E8 and E1, arms (a), B1-H | ≈ $40–80 | PREREG TBDs fixed (caps, ε, effort) |
| P4 | **MVP pilot, tier S, Track P**: E8, E1 × arms agent-H (sampled cases), agent-H-ws (sampled), (c), (a), B1-H × K = 2 | ≈ $180–590 (below) | first bar numbers (directional) |
| P5 | Add E7 to the pilot; raise pilot items to K = 4; B1-O and (c′) on one item at K = 2; one heal arm per pilot item; scale tier for compiled arms | ≈ $300–900 | power for H-E1; J4; F2; scale |
| P6 | Track C pilot on E1 and E7 (agent-H-C, (a)-C, (c)-C), K = 2 | ≈ $80–250 | the "set it up cheaply" number |
| P7 | Remaining six core items, arms as P4 at K = 4; (g) once hierarchical retrieval exists | ≈ $1.5k–4k | family-level decision |
| P8 | Tier E item by item as engine steps land (§7): E9, E2 after 1–3; E1, E7 after 1–3 + 5–6; E8 after 1–5; E5, E6 after 1–4 + 7; E3, E4 after 1–6 | runs ≈ tier-S cost | tier-E numbers |

**Per-world cost basis for P4** [I; scaled from W-BED §3, FRONTIER-GAPS records/kinetics and D22 [M]; per-instance
mode; E8 ≈ 600 and E1 ≈ 1,500 case-ticks per world over the horizon]:

| arm | assumption | per world |
|---|---|---|
| agent-H | 60 sampled cases × ~5 case-ticks × $0.03–0.10 | $9–30 |
| agent-H-ws | same sample; workspace reuse lowers per-call reading cost, unknown | $9–30 |
| (c) | all case-ticks; judges $0.00011 per call, 1–10 calls per case-tick | $1–9 |
| (a) | warmup + compiles $10–20; recompiles $6–10; runs $1–9; shadows at ε = 0.1 with the Haiku interpreter (60–150 case-ticks × $0.03–0.10) $2–15; adjudication $1–3 | $20–57 |
| B1-H | build $0.5–3; runs $1–9; interpreter fallback on deopt $2–10 | $4–22 |

Per pilot world ≈ **$43–148**; × 2 worlds × 2 items ≈ **$170–590**. With P1–P3 the MVP is ≈ **$250–750 list**, which can
cross the $500 owner pause. At K = 4 the same arms cost about twice the P4 line. Natural-mix runs are cheap for compiled
arms (judges only) and run on agent arms in world A only (+ $9–30 per item). Shadow rate is the dominant unknown (ATTACK
K2: break-even shadow rates of 12–19% against the Haiku agent [M]).

### 8.3 Sessions and windows [I]

R0 ran about 36 tasks in about 165 minutes at concurrency 2 (≈ 9 slot-minutes per agent task, PAUSE §1.2 [M]).
E-bed agent case-ticks are smaller (one case), assumed 2–9 slot-minutes.

| step | agent sessions | slot-hours | 5-hour windows at ≤ 0.8 use, concurrency 2 |
|---|---|---|---|
| P4 agent-H + agent-H-ws (2 × 300 case-ticks × 4 worlds) | ~2,400 | 80–360 | 10–45 |
| P4 (a) shadows + interpreter fallbacks + compiles (ε = 0.1) | ~800 | 27–120 | 3–15 |
| P2 references, P3 rehearsals, specificity and N-version authoring sessions | ~20–40 long sessions | 20–60 | 3–8 |

The agent arms dominate wall-clock. Options for the owner (§11): halve the agent sample (30 cases per world), run agent
arms on one pilot item only, or run agent case-ticks as direct structured-output API calls instead of `claude -p`
sessions (different arm semantics; must be declared). Unmetered authoring work (§8.1) is roughly 15–25 agent-days of
Opus/Sonnet sessions drawing on the same quota window.

---

## 9. Testing strategy (what makes this thorough)

Every suite runs at $0 on dev worlds before any metered step and again at freeze.

### 9.1 Oracle validity first
- **Golden suites**: every public worked example becomes a case with a `file:line` source and must pass on the oracle and
  on the cards (E1 tolerance tables, nine-field table and cumulative example; E2 letters, limit scenarios, ATP fence;
  E7 WorkArena cases; the rest hand-derived with rule citations).
- **Discriminating goldens**: a golden that cannot tell two readings apart is flagged and a discriminating case is
  derived. E1: invoice 1 of the cumulative example separates "PO line net" from "invoiced qty × PO price".
- **N-version oracles** for E4, E5, E6 and the P60 clock: two implementations by separate sessions, no shared code,
  differential fuzz over 10⁴ worlds per item (salted seeds), each disagreement resolved by quoting the rule, logged and
  frozen. Independent external semantics where they exist: ERPNext dunning and SLA doctypes (GPL-3.0, read-only),
  Moov Watchman (Apache-2.0, container under D5 with owner approval).
- **Specificity**: ≥ 3 correct solvers per item written independently with different internal designs (e.g. the second
  N-version oracle or a separately written solver; c\*; a per-instance solver that pipelines effects with `after` and
  merges obligations) must all pass every completed case on 20 dev worlds. Any false reject means the grader is wrong;
  the fix is an allowed window derived from a rule citation, never a per-item diff declaration.
- **Product ≡ oracle** (Track C): the product engine and the oracle agree on 20 dev worlds per difficulty under truth
  configuration.

### 9.2 Property tests on simulators and host (seeded, no new dependency)
- Idempotency: one key twice → one ledger entry and the same result; no key → two entries.
- Determinism: world generation, reference transition, actors and fault schedule byte-identical across runs and
  processes; tie-breaks by (time, source, id).
- On-policy totality: `referenceTransition` defined on every state reachable by the controls and mutants.
- Conservation: money in = money out; Σ matched + Σ held = Σ invoiced (E1); eliminations net to zero (E3); billed = paid
  + Σ adjustments (E6).
- Clock laws: business-elapsed ≤ elapsed; pausing never increases business-elapsed; breach monotone in the pause set;
  DST invariance in UTC; new-account switch exact at day 30 (E5).
- Bounds: per-instance render ≤ 20K tokens at d5; generate + oracle < 2 s per 10³ cases; < 200 MB (CONTRACT [M]); scale
  tier within its budgets.
- Leak: no truth-only string in inputs, files or mock responses; mocks expose no hidden fields; product-computed fields
  never copied into Track P inputs.
- Twins differ only on the intended record (DESIGN-STREAMS §4.3 [M]).
- Censoring: the horizon closes ≥ 80% of cases started in every epoch except the last.
- G21 round-trip: valid answers render → fill → submit → parse to the same value; invalid answers rejected by the host
  even when the form accepts (`"12abc"`).

### 9.3 Metamorphic relations (on the oracle, and analyst-side on arm outputs)

| MR | transformation | expected |
|---|---|---|
| MR1 | consistent renaming of parties and ids | outputs identical modulo renaming |
| MR2 | scale amounts and amount tolerances by 10ⁿ (% unchanged) | identical statuses; amounts scaled |
| MR3 | shift timestamps and calendars by whole weeks | identical business-elapsed, breach, decisions |
| MR4 | permute order-independent events within a wake-up | identical outputs |
| MR5 | duplicate an inbound event | identical ledger |
| MR6 | split a wake-up at a point with no due obligation | identical final SoR and ledger |
| MR7 | add an unrelated case | other cases unchanged |
| MR8 | add a holiday on a non-business day / on a business day inside a window | no change / deadline + 1 business day |
| MR9 | add an edition effective after every anchor | no change |
| MR10 | tighten one tolerance or limit | held set grows monotonically |
| MR11 | inject a failure at saga step k | compensation set = **committed** steps as observed by status query (including step k when its outcome was unknown and the query shows it committed), in reverse order |
| MR12 | insert a label-preserving injection line | identical decisions (W5) |
| MR13 | run per-instance vs world-level mode on the same world (reference only) | identical ledger |

### 9.4 Controls and attacks
$0 bad, necessity, echo/no-op and gaming controls on ≥ 20 worlds per difficulty; paid triviality attacks (P1); the
white-box script reported; the `oracle-controls.mjs` pattern on every frozen config, printing counts and hashes only [M].

### 9.5 Mutation testing (oracles, references, cards)
- Operators: relational boundary, arithmetic swap, dropped rule row, hit-policy swap, precedence swap, calendar swap,
  anchor swap, edition by run date, missing key, compensation order reversal, deleted pause condition, deleted guard,
  dropped new-account switch.
- Oracle mutants: goldens + controls + metamorphic checks kill ≥ 95%; each survivor is equivalent or gets a new golden.
- **Reference mutants are the source of latent defects**: mutants that pass every E0 case (executed) but die later join
  the defect set with exact manifests (answers the L6-a lesson that imported checklists name few of our own failures,
  6/21 [M]).
- Card mutants: P58–P60 fixtures kill their mutants (T4 discipline).

### 9.6 Gaming and adversarial attacks
Hold or escalate everything; do nothing; echo the SoR; declare every obligation; pay twice with one key — each fails every
world. W5 injection probes with twins. The J2 defect miner after the first accepted solvers (PROOF-LEDGER J2 [M]).

### 9.7 Replay determinism and accounting
Every run is journaled; replay at $0 reproduces byte-identical ledgers, SoR and outputs, else the run is void. Costs come
from the journal only. The env-fault table uses `envFaultCheck` [M] on untagged faults only.

### 9.8 Independence and labelling
A second labeller per item decomposition before any coverage share is quoted (AUDIT-L1 [M]); an independent class audit
of each mined defect against its spec sentence; the owner reviews one rulebook (§11); for E15 an owner annotation pass.

### 9.9 Calibration (gates the generator, §2.6)
E1 vs BPI 2019 (category shares, change rates, variant curve, DFG distance); E9 vs BPI 2017 (offers per application,
delay quantiles); reported per world.

---

## 10. Objections, risks and honest limits

1. **The oracle is our reading of documentation** ("the expected log carries the semantic", D21 [M]). Mitigations:
   public and discriminating goldens, N-version, specificity, contested readings excluded, owner review of one
   rulebook, ERPNext and Watchman as outside references. Residual: tenant configuration is unknowable; claims say
   "documented semantics at the stated scale", never product parity.
2. **Authorship correlation** (FRONTIER-GAPS J5 [M]): Claude writes spec, oracle, reference and cards. Separate sessions,
   cards frozen first and blind to the bar, goldens from outside, external implementations where they exist, family test
   only over K1-admitted items. Still the main validity threat.
3. **Tier S abstracts envelope mechanics.** A tier-S win says Haiku can construct the decision core (correlation, clocks,
   compensation plans, idempotency, rules) graded through behaviour; not that it can construct and operate a durable
   envelope. Tier E answers that, after the engine column.
4. **Track P is not "setting up".** Only Track C approximates configuration work, and its inputs are still synthetic
   memos and an SME script, not a real organisation's tacit and contradictory requirements.
5. **Rulebooks exceed the 8K cap** [M-c]. Rows are data; constructors build interpreters; arm (g) needs hierarchical
   retrieval before it runs.
6. **Power.** Within-item claims are directional at K = 2; the family test carries the decision and needs K = 4 for 0.85
   power at equality [M-c].
7. **Prior.** Records showed H/H at $0.324 per success against the Haiku agent's $0.164 (FRONTIER-GAPS §0.1 [M]) and no
   check deopted on ≥ 21 wrong compiled outputs (S1 [M]). Expect agent-H to fail d5 tails and (c) to hold; silent misses
   at edition and schema boundaries are the likeliest failure of (a) and (g); heal evidence is thin (W-BED O11 [M]).
8. **Cost, quota and wall-clock** (§8.2–8.3): the agent arms dominate; the full programme is several times the $500
   pause.
9. **E9's rules are synthetic; E10 depends on a non-policy simulator; E14 and E15 are candidates only.**
10. **Scope of "biggest orgs"**: d5 and the scale tier are set by documented knobs and real-log distributions, not by
    observed production volumes [unavail].

---

## 11. Owner decisions this depends on

1. **Budget**: the MVP pilot (≈ $250–750: P1–P4 on E8 and E1, K = 2) vs extending to E7 and K = 4 (P5), Track C (P6) and
   the full programme (P7, ≈ $1.5k–4k more). Each crosses or can cross the $500 pause.
2. **Agent-arm sampling and form** (§8.3): sample size, one or two pilot items, `claude -p` sessions vs direct calls.
3. **(c′), B1-O and agent-O** go-ahead (Opus spend; J4).
4. **K = 4 held-out worlds** for items entering the family test.
5. **E10 in or out**; **E14 and E15** sourcing and the owner's annotation pass for E15.
6. **Bed contract v1.1** (per-instance mode, on-policy grading, platform profiles, two tracks): adopt or amend.
7. **Who reviews one rulebook** (the owner, for E1 or E7).
8. **The reliability bar**: confirm the Clopper-Pearson form (pooled ≥ 0.95, per world ≥ 0.90, zero critical; critical
   rate ≤ 0.1% at the scale tier) or set other numbers before freeze.
9. **External implementations**: approve running Moov Watchman as a container (D5, no account) for E4.
10. **Engine timing**: start the bar-weighted engine column on a branch now, or after the tier-S pilot reads.

---

## 12. Errata (what changed from the draft, and why)

Numbers in the first column are the critique's finding numbers; C-n are consolidation corrections.

| # | draft | now | why | where |
|---|---|---|---|---|
| 1 | 40 one-day ticks in 5 tick-count epochs; CL case success over the stream | go-live backlog; event-driven time; horizon ≥ p90 case length + longest clock (E1 130 business days, E9 60, E5 200 calendar days); epochs in business time; cases assigned by start date; CL unit = case segment with censoring; censored share reported; K1 fails if > 20% censored | BPI 2019 median case 46 business days, 57.6% > 40, 33.9% > 60; BPI 2017 p90 25 business days [data, re-run this pass]; 40 ticks censored most cases | §2.1, §3 |
| 2 | one "truth trajectory"; actors seeded by (world, case, request digest) | on-policy grading: reference transition applied to the arm's own history; actors keyed by (world, case, role, decision kind, ordinal) | a valid but differently worded request got a different answer and diverged from the single trajectory | §2.4, §2.8 |
| 3 | exact per-tick effect multisets, obligation sets and human-task schema shapes | behavioural grading with rulebook-derived allowed windows; obligations internal; schema shape graded only through consequences; specificity test (≥ 3 independent correct solvers, 0 false rejects) in K1 | grading implementation choices re-creates D21's per-item declarations; sensitivity was measured, specificity never | §2.8, §6 K1, §9.1 |
| 4 | spec-E gives rulebook, tables, SoR, even algorithms; SoR mixes business records and product-computed fields | two tracks (P engine port, C configure); SoR split; claim wording fixed | the arm was re-implementing the product, not setting it up; its role was incoherent | §0, §2.2, §2.3 |
| 5 | P58–P60 designed from E1–E9; card authoring cost uncounted; arm (g) under the 8K cap with a 10–40K spec | cards authored blind from outside sources and frozen first; E11–E13 library-unseen reserves; card cost amortised; spec sizes measured (Visa §11 ≈ 72K tokens, D365 E1 sources ≈ 9.8K) [M-c]; hierarchical retrieval required before (g) runs | library contamination; the cap could not hold the spec (only 12 cards exist today [M]) | §2.5, §4, §5, §8.1 step 1 |
| 6 | bar titled "most complex big-org workflows" | "documented rule-and-deadline core"; E14 cross-functional and E15 judgement candidates; compensation coverage split | selection favoured the computable and rule-heavy | BAR-SET §0–§4 |
| 7 | "volume ×2" at d5 | scale tier 10⁴–10⁵ cases per world for compiled arms; E6 at 10⁵–5 × 10⁵ rows | BPI 2019 has 251,734 items a year; the real PTP file has 475,042 records | §2.6 |
| 8 | (c) a "faithful port" of a spec slice | per-item semantics ledger, omitted-feature count in every claim; E1 adds nine-field unit price, receipt auto-matching, payment blocks, service entry sheets; E5 adds the new-account rule; E7's duration rule relabelled WorkArena policy | documented and observed features were missing [doc, data, web✓] | §2.11, §3 |
| 9 | "dumb host" for every item; c-oss "fails by construction" | declared, symmetric platform profiles; E8 runs `temporal-like` (default unlimited activity retries [web✓]; the app sets no RetryPolicy [code]); c-oss is "a different specification" | stripping the platform's guarantees rigged the OSS comparison | §2.2, E8 |
| 10 | c′ per tick at K = 1; no B1 arm; asymmetric escalation; agent-H without persistence | B1-H and B1-O; c′ = Opus writes the workflow once with per-epoch rewrites; K ≥ 2 for any decision arm; one escalation policy (none); agent-H-ws | arm fairness | §4 |
| 11 | TF ticks as the family-test unit; reference-derived SoR fields in TF inputs; 16 KB scratch | CL case segments decide; TF on neutral export is diagnostic on informative case-ticks; 64 KB carry + optional workspace | TF leaked state and forced failures on dedupe and correlation | §2.2, §2.8, §6 |
| 12 | all oracle implementations by Claude | ERPNext dunning and SLA (GPL-3.0, read-only semantics) and Moov Watchman (Apache-2.0, black-box under D5) as outside references [web✓] | single author family | §3 E2, E4, E7; §9.1 |
| 13 | Wilcoxon or sign test; no non-inferiority function; no multiplicity control | Wilcoxon only; `nonInferiority`, `wilcoxonExact`, `holm`, `clopperPearson` added before freeze; Holm across arms; scope statement | power 0.60/0.85 (Wilcoxon) vs 0.34/0.57 (sign) at K = 2/4 [M-c re-run]; `stats.mjs` has only a superiority rule | §6 |
| 14 | H-E2: point estimate ≥ 0.95 in every world | one-sided 95% CP lower bound ≥ 0.95 pooled, ≥ 0.90 per world, zero critical; critical rate bound needs ≥ 2,995 clean cases; straight-through rate reported separately | the point rule's effective bar was ~0.98 (pass-all-4 probability 0.14 at 0.95, 0.94 at 0.98) [M-c] | §6 |
| 15 | pilot ≈ $300–450 at K = 2 while recommending K = 4; no session or window budget | re-costed per instance (MVP ≈ $250–750); session and window table; K = 4 costed as ×2; natural mix costed | the draft under-counted and its "$0" build draws on the quota window | §8 |
| 16 | c\* < 0.95 → "excluded: oracle" | K1′ capability outcome; item kept in tables; c\* validated on public goldens because its fixtures come from the oracle | mislabelled capability as oracle failure | §2.12, §6 |
| 17 | MR11: compensation set = executed steps < k | committed steps as observed by status query, including k when it committed under an unknown outcome | contradicted F3 | §9.3 |
| 18 | injected 429s indistinguishable from real ones | `injected` tag; excluded from K5; clock frozen across real quota stops | mixing the two corrupts the env-fault rule | §2.7 |
| 19 | only true revealing events | false revealing events at the same rate; false-heal and wrong-remediation metrics | heal precision was untested | §2.10, §5, H-E6 |
| 20 | hand-planted defects; E1 LD1 "silent while invoiced qty ≤ ordered"; discriminating golden named invoice 2 | defects only from the mutation miner with executed E0-silence; hand candidates admitted only by that check; invoice 1 named as the discriminating golden | LD1 fails on invoice 1 of the public example (8,640 vs 8,000, 640 > 500, doc says Passed, `accounts-payable-invoice-matching.md:114–133`) [doc, re-derived] | §2.10, §3 E1, §9.1 |
| 21 | world-level tick | per-instance primary + sweep ticks; world-level diagnostic; MR13 | world-level ticks do not transfer to tier E and correlate failures | §2.2 |
| 22 | edition notices as events | sealed no-notice variants (silent file; inferred from rejections); detection latency | notices told arms when rules change | §2.5, H-E5 |
| 23 | calibration on category shares only | variant-frequency curve and DFG distance; log-replay worlds from real skeletons | 9,030 of 11,973 BPI 2019 variants are singletons; parametric variety misses the tail | §2.6, §9.9 |
| 24 | UI off the critical path | a share of answers through the rendered form and the `formState` adapter, host re-validation | scripted actors bypassed the UI | §2.7, §7 |
| 25 | 10⁴-world fuzz inside dev 1001–1199 | fuzz base seeds 1301–1310 with per-item salts; specificity range 1241–1249; scale range 9301–9302 | seed space | §6 |
| 26 | typed, clean human answers; `.txt` documents | noise model calibrated on BPI 2017 lifecycle; delegation; free text; wrong answers caught by verification | humans and documents were too clean | §2.7 |
| C-1 | P59 "unassigned in the bar" | P59 = compensation planner, proposed in BAR-SET §3 | consistency | BAR-SET §3 |
| C-2 | Reg E and 31 CFR limits "[unavail], verify before freeze" | verified against consumerfinance.gov and Cornell LII [web✓] | consolidation | §3 E4, E5 |
| C-3 | location `research/jit-20261008/design/E-BED.md` | `research/enterprise-20261014/E-BED.md` | task brief | — |
| C-4 | pilot E8, E1, E7 at K = 2 for ≈ $300–450 | MVP E8 + E1 at K = 2; E7 and K = 4 in P5 | re-costing (#15) | §8.2 |

**Draft claims the critique re-checked and found correct** (kept): the Temporal app has no compensation
(`workflows.go:313–333`, 30 s timeout at :24) [code]; `trip.bpmn` has 3 compensation pairs and an error sub-process [code];
WorkArena's comment says 20% while its code checks ±5% [code]; tau2's `DEFAULT_LLM_USER` is `gpt-4.1-2025-04-14` [code];
OpenUI's validation rules (`spec/language.md:378–382`) [doc]; MDE 19/37/52 points at K = 2, m = 40 [M-c]; Wilcoxon
W⁻ ≤ 8 gives p = 0.049 and the sign test 0.020 [M-c]; the proposed seed ranges do not collide with existing ranges [M].
