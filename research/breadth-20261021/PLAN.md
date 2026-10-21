# Breadth program: portfolio, family factory, claim protocol and first week (2026-10-21)

*Design, 2026-10-21, written by an Opus 5.5 subagent of the breadth workflow (task #82) at HEAD `f8478b4`. Inputs: the
four breadth sweeps of today (agentic-tool, enterprise-process, construction, recurring-synthesis; notes in the session
scratchpad `breadth/*.md`), this repository, and one $0 power simulation run for this document. The methodology and
repo-coverage sweeps returned nothing, so §2 (repo coverage) and §7/§9 (statistics) are reconstructed here; the
methodology sweep left simulation scripts and fetched papers in the scratchpad, which are cited where used. Nothing in this
file has run against a model. Nothing here is a capability result. `beds/sealed/` was not read; no benchmark test split
was opened.*

*Companion: [PREREG-BREADTH-v0.md](PREREG-BREADTH-v0.md), the draft preregistration (not frozen). Disposals:
[DISPOSALS.md](DISPOSALS.md).*

**Evidence tags.**
- **[M]** read or measured in this repository today (path cited).
- **[S-obs]** observed by a sibling breadth sweep today (a probe it ran or code it read), not re-run by this author.
- **[doc]** a project README, card, paper or leaderboard claim, not checked here.
- **[calc]** computed by this author today (script path given).
- **[I]** inference or design choice.

---

## 0. Bottom line

1. **What breadth must mean.** The claim is "cheap model + Foundry is non-inferior to a frontier model alone, at lower
   cost, and Foundry causes the gain", tested on many *independent beds*. The bed is the unit of replication. Inside a
   bed the unit is the *cluster* (template, scenario, user task, family), never the instance. A pooled accuracy or a count
   of per-bed wins is not the claim.
2. **Per-bed tests cannot carry it; the portfolio can.** At a 10-point margin with about 90 effective paired tasks per
   bed, one bed has about 0.48 power [calc]. Eight beds pooled with a random-effects model (Hartung-Knapp) have 0.66–0.91
   power at a true difference of 0, and 0.87–0.99 at +3 points, with type-I error at or below 0.025 [calc]. Four beds
   give 0.24–0.42 [calc]. So the preregistration fixes **eight beds in a declared order with substitutes**, and this
   week's four beds give a directional Stage-A result, not a verdict.
3. **Today's evidence is narrow.** Every comparative number in the repo is development evidence on one external bed
   (AutomationBench dev60/devCheck) or on our own Claude-written beds. SOP-Bench sealed (Haiku vs Haiku) and the AB-v1 test
   run (Haiku vs Haiku; Sonnet only as a never-in-a-claim reference on 60 tasks) are the only held-out runs in flight,
   and neither has a Sonnet-alone arm under its own preregistration [M]. The "cheap + Foundry vs frontier alone"
   comparison has no held-out evidence anywhere yet.
4. **Tier 1, adopt this week** (all in this container, no Docker, no accounts, deterministic oracles, MIT/Apache):
   **WorkBench** (workplace SaaS, 69 templates, regenerated fresh instances), **AgentDojo** (security under prompt
   injection, fresh injection tasks we author), **NaturalPlan** (scheduling; construct a solver once, run held-out at $0
   model cost), **AppWorld** (long-horizon multi-app, official sealed test; cost-gated). Three domains new to external
   evidence (personal multi-app, injection security, scheduling) plus a second workplace-SaaS source, and four shapes
   new to external evidence (long horizon, untrusted input, construct-once planning, template reuse), for about **$240
   of sealed runs plus about $115 of dev and pilots** at list price [I, §9].
5. **Tier 2, next, in declared order** to reach eight beds: τ²-bench telecom solo (policy-bound troubleshooting, pure
   environment assertions, pass^3), BFCL v4 multi-turn, SpreadsheetBench-912 (build on workbook 1, hold out 2–3), τ²
   banking_knowledge (BM25). Substitutes: EnterpriseOps-Gym (laptop Docker), PlanBench, ITBench-Lite, AgentArch.
6. **Tier 3 is the family factory**: one `family.spec` compiles policy text, generator, oracle and controls, replacing
   the roughly 73% of the 12 hand-built AB-R families that is bespoke [S-obs]. First three new families:
   **regulatory incident clock**, **ITSM queue with pause/reopen**, **P2P audit with injected violations**. Factory
   families are a separate claim (recurring families, sign test over ≥ 24 effective families), never pooled with the
   external beds.
7. **One adapter for every host.** A generic bed-to-MCP facade (tools, reset, snapshot; grading host-side and hidden)
   lets the same bed run under Claude Code headless here and under Claude Code, OpenCode, Codex and Cursor on the owner's
   laptop (D9). Only `claude` 2.1.306 is installed in this container [M]; the host axis is a laptop study.
8. **Oracle validity first, at $0.** Every bed passes gold replay 100%, a reported do-nothing floor, mutants killed at
   ≥ 95% with more than one operator, a determinism digest and no LLM judge in the reward before any paid call. The
   sweeps already found three defects this way: WorkBench's 18.0% do-nothing floor, NaturalPlan calendar scoring that
   rejects valid alternatives in up to 227 of 1,000 instances, SpreadsheetBench's 7.3% unchanged-workbook pass rate
   [S-obs].
9. **Cost and usage.** The frontier arms (Sonnet, plus the Opus anchor) are about 65–90% of every bed's sealed cost
   [I, §9]. The levers are $0 kill gates, clusters instead of instances, K = 2 instead of more, futility looks, reuse
   inside cluster streams, Opus only on 20-task anchors, and runner concurrency of at most 6 sessions (at most 3
   Sonnet) so this program does not trip the account's 5-hour limit (§8).
10. **Blocked or owner-gated:** a Mercury 3 arm (D8 cap nearly spent: about 4.22M of 5M tokens, per commit `b2f22eb`
    [M]); open-weight arms (no GPU); laptop-only beds and hosts; a two-week list-price total of about $885–1,040 across
    stages that are each under the $500 pause rule (§10).

---

## 1. What "breadth" has to mean for this claim

**The claim under test** (from the brief and AGENTS.md): cheap models (Haiku 5.5; Mercury 3; later open-weight) inside
Foundry construct, run, verify and reuse bounded typed workflows that match or beat frontier models alone (Sonnet 5.5,
Opus 5.5) on real task success, at lower cost, with executable oracles and preregistered held-out evaluation.

**Units.**

| Level | Unit | Why |
|---|---|---|
| Portfolio | **bed**: an independent source with its own harness, oracle and task population | Beds differ in harness and task distribution; the random-effects variance between beds is the "is it a one-benchmark artefact?" quantity |
| Bed | **cluster**: template (WorkBench), scenario (AppWorld), user task (AgentDojo), task type × complexity level (NaturalPlan), intent (τ²), family (factory) | Instances of one cluster share structure: WorkBench's design effect is about 5 at 10 instances per template [S-obs]; counting instances inflates n |
| Cluster | instance (task) × run (K) | Runs average out run-to-run flips; ROADMAP §4.3 forbids K = 1 comparative claims [M] |

**Axes of breadth** (what the coverage matrix in §3 tracks): domain, workflow shape, recurrence and horizon, arm
(model and Foundry or not), host harness.

**Held-out classes** (every bed in the portfolio is labelled with exactly one):

| Class | Meaning | Examples |
|---|---|---|
| H1 official-sealed | test items with no public answers, maintained by the benchmark owner | AppWorld test (eval programs only; "do not look" rules) [S-obs] |
| H2 fresh-generated | new instances from the benchmark's own generator or ours, seed frozen before any arm runs | WorkBench regenerated instances; NaturalPlan via our generator; PlanBench regenerated |
| H3 fresh-authored | new items written by a session that builds nothing, hashed before any arm runs | AgentDojo injection tasks we author; factory families |
| H4 public-static | public items and answers; treated as possibly seen by every model, because no knowledge cutoff for Haiku 5.5, Sonnet 5.5 or Opus 5.5 is published [S-obs] | BFCL, τ² telecom (all 2,285 tasks are in `tasks.json` [M]), SpreadsheetBench |

H4 beds may enter the portfolio only with a clean memorization probe (§5.4), and a sensitivity analysis drops them.

**Why not "non-inferior in m of B beds".** Per-bed power at the affordable n is about 0.5 [calc], so "m of B" mostly
measures luck; it stays a descriptive table with Holm-adjusted per-bed results. The primary statistic is the pooled
paired difference with its confidence interval and a prediction interval for a new bed (§7).

---

## 2. Where the evidence stands today (repo coverage, reconstructed)

The repo-coverage sweep returned nothing; this table is built from README.md and the research directories [M].

| Bed | Source | Domain | Shape | Arms run so far | Class of evidence | Status 2026-10-21 |
|---|---|---|---|---|---|---|
| AutomationBench (dev60, devCheck) | Zapier, external | workplace SaaS, 47 simulated apps | multi-step tool use, one-off tasks | A0 Haiku, A1/A1-C Haiku + harness, Sonnet ± harness (dev60 only), Mercury A1-C partial | dev | dev60: Haiku + A1 22/60, Sonnet alone 20/60, Sonnet + A1 28/60 ([DEV60-A0-A1](../automationbench-20261014/runs/DEV60-A0-A1.md)); devCheck: A1 20/60 = A1-C 20/60 vs A0 13/60 ([DEVCHECK](../automationbench-20261014/runs/DEVCHECK.md)) |
| AutomationBench AB-v1 test | external | same | same | A0, A1 (Haiku); A2 Sonnet on testRef only, "never in a claim" | sealed, pending | [PREREG-AB-v1](../automationbench-20261014/PREREG-AB-v1.md) §3 |
| SOP-Bench | Amazon, external, CC BY-NC | 12 regulated SOPs | build once per SOP, run on sealed rows | A-H agent 73.8% strict (dev); W-H build-once | sealed run in progress | [NOTES](../sopbench-20261021/NOTES.md), [DESIGN](../sopbench-20261021/DESIGN.md) |
| AB-R recurring families (12) | own, grounded on AB tasks | 6 business domains | recurring streams, cross-trigger state | gates only | dev, under review | [RECURRING-DESIGN](../automationbench-20261014/RECURRING-DESIGN.md) |
| E8 order saga | own | order-to-cash | saga, compensation, faults, drift | B1-O, B1L-H, B1G-H, C-H, C-H-T, agent-H | dev | COMP-1 inconclusive ([RESULT-COMP1](../composition-20261021/RESULT-COMP1.md)) |
| E7 ITSM slice 1 | own | ITSM incidents + SLA | stream with SLA engine | in build | dev | task #61 |
| OT-0 | own, on E8 | org rules over two processes | constitution, shield, auditor | $0 done; paid chain launched | dev / prereg frozen | [PREREG-OT0](../org-20261021/PREREG-OT0.md) |
| SPEC-1 / INTENT-1 | own | intent recovery from messy requests | request → spec → build | SPEC-0 built; κ 0.57 second rater | dev | [DESIGN](../intent-20261021/DESIGN.md) |
| W-bed rungs R0–R6 | own | synthetic structural ladder | typed pipeline → swarm | reference workflows | dev | [W-BED](../jit-20261008/design/W-BED.md) |
| records, incident, kinetics, codefix, need-* | own | records extraction, incident triage, kinetics fitting, code repair | one-shot families | P1 (records), C0 dev (records, codefix), NL0 | dev, P1 held-out on one family | README Results |
| τ²-bench | Sierra, external | telecom, banking, airline, retail | policy dialogue | none | pinned, inert | [ACQUISITION](../tau2-20261021/ACQUISITION.md) |

**What this table says.**
- External beds with any comparative evidence: 1 (AutomationBench), dev only. External beds sealed: 2 in flight, neither
  holding the frontier-alone comparison.
- The frontier-alone comparator (Sonnet 5.5 alone) has been run on 60 dev tasks of one bed. Opus 5.5 alone has never run
  as an arm outside C0 dev and OT-0.
- Host harness: only Claude Code headless (`claude -p`). Models: Haiku 5.5, Sonnet 5.5, Opus 5.5, Mercury 3 (partial).
- README's own count: "measured on sealed or wild tasks: 0" layers [M].

---

## 3. Target coverage matrix and holes

### 3.1 Domain × shape

Shapes: **S1** typed judgment; **S2** short multi-step tool use (≤ 10 steps); **S3** long horizon (≥ 20 steps or many
apps); **S4** policy-bound dialogue; **S5** construct once, run many (build-once program or workflow); **S6** recurring
stream with cross-trigger state and clocks; **S7** untrusted input and control-flow integrity; **S8** saga, compensation,
faults; **S9** async, time, ambiguity; **S10** intent recovery from a messy request.

Cell codes: **own** = our Claude-written bed; **ext-dev** = external, dev evidence; **ext-seal** = external sealed run in
flight; **T1/T2/T3** = added by that tier of this plan; **—** = hole.

| Domain | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Workplace SaaS (email, calendar, CRM, PM, analytics) | — | ext-dev (AB), **T1 WorkBench** | — | — | **T1 WorkBench** (template reuse) | own (AB-R) | — | — | — | own (SPEC-1) |
| Enterprise ITSM / HR / CSM | — | T2 EnterpriseOps-Gym (laptop) | T2 EnterpriseOps-Gym | — | — | own (E7, slawatch), **T3 itsm-queue** | — | — | — | — |
| Order, commerce, ERP | — | own (E8) | own (E8) | — | own (E8 builds) | own (OT-0) | — | own (E8) | — | own (SPEC-1 on E8) |
| Customer-service policy dialogue | — | — | — | **T2 τ² telecom, banking** | T2 (per-intent workflows) | — | — | — | — | — |
| Personal multi-app assistant | — | **T1 AppWorld** | **T1 AppWorld** | — | **T1 AppWorld** (scenario variants) | — | — | — | — | — |
| Assistant under prompt injection | — | **T1 AgentDojo** | — | — | — | **T1 AgentDojo** (task × injections) | **T1 AgentDojo**; own taint tests | — | — | — |
| Finance, AP, tax, payments | — | ext-dev (AB finance) | — | — | dev-only TaxCalcBench | own (apintake, receipts), **T3 p2p-audit** | — | — | — | — |
| Regulated procedures (SOPs) | ext-seal (SOP-Bench) | ext-seal | — | — | ext-seal (SOP-Bench) | **T3 reg-incident-clock** | — | — | T3 (statutory clocks) | — |
| Scheduling and planning | — | — | — | — | **T1 NaturalPlan**, T2 PlanBench | — | — | — | — | — |
| Office documents, spreadsheets | — | — | — | — | **T2 SpreadsheetBench-912** | — | — | — | — | — |
| IT ops and compliance | — | — | — | — | T2 ITBench-Lite CISO | — | — | — | — | — |
| Function calling, API composition | — | **T2 BFCL-MT** | T2 BFCL long_context | — | control: NESTFUL, ToolHop | — | — | — | — | — |
| Synthetic structure (records, kinetics, W-bed) | own | own | own (W-bed R5–R6) | — | own | own (JIT streams) | — | own (R8 faults) | — | — |

### 3.2 Arms × beds (portfolio beds only)

Arms: **A-H** Haiku 5.5 alone; **F-H** Haiku 5.5 + Foundry; **A-S** Sonnet 5.5 alone; **A-O** Opus 5.5 alone (20-task
anchor); **F-S** Sonnet 5.5 + Foundry (optional control); **F-M** Mercury 3 + Foundry (blocked by D8); **pub** published
frontier per-task results (screening context only, never an arm).

| Bed | A-H | F-H | A-S | A-O | F-S | F-M | pub |
|---|---|---|---|---|---|---|---|
| WorkBench | ✓ | ✓ | ✓ | anchor | optional | gated | 24 models per task (Haiku 4.5, Sonnet 4.6, Opus 4.8, Fable 5, GPT-5.5 …) [S-obs] |
| AgentDojo | ✓ | ✓ | ✓ | anchor | optional | gated | 2025 results page (Claude 3.x) [S-obs] |
| NaturalPlan | ✓ (direct) | ✓ (built solver) | ✓ (direct) | anchor | — | gated | 2024 paper only [S-obs] |
| AppWorld | ✓ | ✓ | ✓ | anchor if approved | — | gated | board: Opus 4.6/4.7, gpt-5.6-luna, Qwen3-14B RL [S-obs] |
| τ² telecom solo | ✓ | ✓ | ✓ | anchor | optional | gated | stale official board [S-obs] |
| BFCL-MT | ✓ | ✓ | ✓ | anchor | — | gated | CSV: Haiku 4.5, Sonnet 4.5, Opus 4.5 [S-obs] |
| SpreadsheetBench-912 | ✓ | ✓ (build on case 1) | ✓ | anchor | — | gated | site top 70.48%, model unnamed [S-obs] |
| τ² banking | ✓ | ✓ | ✓ | anchor | — | gated | tau3-Banking board [S-obs] |

Open-weight: no arm (no GPU; local generative models parked, README [M]). Published open-weight rows (AppWorld
AgentRL + Qwen3-14B 86.9 / 67.6 TGC on test_normal / test_challenge against Opus 4.6 at 91.1 / 72.4 [S-obs]) are context
for the thesis, never a result of ours.

### 3.3 Hosts

| Host | Where | Status | Role |
|---|---|---|---|
| Claude Code headless (`claude -p`, policy flags) | this container | installed, 2.1.306 [M] | every arm of every portfolio bed |
| Claude Code interactive + Foundry MCP | owner's laptop | available to the owner | host study |
| OpenCode | laptop | allowlisted v2.0.5 only [M]; the repo's OpenCode route uses free models only (README), so a Claude model there needs the owner's own key | host study; model may differ, so within-host comparisons only |
| Codex | laptop | owner's own account; not installed here [M] | host study (D9 order: after Cursor) |
| Cursor | laptop | owner's own account; not installed here [M] | host study |

### 3.4 Holes left after Tiers 1–2

- **S9 async, time, ambiguity** on an external bed: none. Gaia2/ARE is the only candidate and its verifier is partly
  LLM-judged [S-obs]; the factory's statutory-clock family covers time in our own world.
- **S8 compensation and faults** on an external bed: none found with an executable oracle; E8 stays own-bed evidence.
- **Long-horizon recurring streams (quarter, year)** externally: none; factory horizon ladder H3/H4 only.
- **Multi-actor approvals**: OT-0 (own) and the P2P factory family; ERP-Bench would add it externally but needs an owner
  decision on Docker size.
- **Hosts other than Claude Code**: laptop only. **Open-weight models**: no route.

---

## 4. Candidate scoring and the tiered portfolio

### 4.1 Rubric

| Criterion | Scale |
|---|---|
| **V** oracle validity | 3 = executable, deterministic, $0 gate passed by a sweep; 2 = executable, gate partly done or one known defect with a fix; 1 = executable but weak (keyword match, partly LLM-judged); 0 = LLM judge or similarity metric |
| **R** local runnability under D16 | 3 = wheels/data under 500 MB, no Docker, no accounts, probed; 2 = runnable here, not yet probed; 1 = laptop Docker under 1 GB; 0 = accounts, hosted instances or over-cap images |
| **L** licence | ok (MIT/Apache/CC BY), NC (research only, per-row results out of git), ? (unstated) |
| **C** contamination and held-out class | H1–H4 (§1) |
| **$** cost per held-out task, Haiku arm / Sonnet arm | list price, CLI route; anchors in §9.1 |
| **E** adapter effort | engineer-days, on top of the shared facade |
| **G** coverage gain | 0–3 hole cells of §3.1 filled that nothing else fills |

### 4.2 Scored candidates

| Candidate | V | R | L | C | $ Haiku / Sonnet per task | E | G | Decision |
|---|---|---|---|---|---|---|---|---|
| WorkBench @`49c7dfd` | 3 (gold 690/690, floor 124/690, digest stable [S-obs]) | 3 (131 MB) | MIT | H2 if regeneration is seedable, else H4 | 0.008 / 0.05 | 1 | 2 (S5 template reuse; harm metric) | **Tier 1** |
| AgentDojo 0.1.35, v1.2.2 | 2 (utility gold 97/97; injection gold 27/35 unresolved [S-obs]) | 3 (166 MB) | MIT | H3 for authored injections; user tasks H4 | 0.008 / 0.06 | 1.5 | 3 (S7 external; recurring task × injection) | **Tier 1** |
| NaturalPlan | 2 (trip, meeting fine; calendar exact-match defect [S-obs]) | 3 (50 MB) | Apache-2.0 / CC BY 4.0 | H2 via our generator, else H4 | 0.0005 / 0.01 direct; F-H $0 per held-out instance | 1–2 | 2 (S5 construction, planning domain) | **Tier 1** |
| AppWorld 0.1.3.post1 | 3 (gold 147/147, null 0/147 on train+dev [S-obs]) | 3 (366 MB) | Apache-2.0 + encryption and no-look terms | **H1** | 0.03–0.45 / 0.6–3 (wide; pilot) | 2–3 | 3 (S3 long horizon, personal multi-app, scenario variants) | **Tier 1, cost-gated** |
| τ² telecom solo @`57e54143` | 2 (ENV_ASSERTION; gate not yet run) | 2 (pinned in `corpus/`; venv not built) | MIT | H4 (2,285 tasks public in `tasks.json` [M]); v2.0.0 replaced 50 base tasks with same-ID reviewed versions [M] | 0.03–0.08 / 0.3–0.6 | 3 | 3 (S4 dialogue; pass^k) | **Tier 2, first** |
| BFCL v4 multi-turn | 3 (gold 800/800, null 0/800 [S-obs]) | 3 (106 MB with `--no-deps`) | Apache-2.0 | H4 (public since 2024) | 0.003–0.01 / 0.06–0.2 | 1–1.5 | 1 (typed call plans; miss_func/miss_param) | **Tier 2** |
| SpreadsheetBench-912 | 2 (floor 67/912 unchanged-workbook pass; evaluator bugs listed [S-obs]) | 3 (96 MB tarball + openpyxl) | CC BY-SA 4.0 | H4, but build-on-case-1, hold-out cases 2–3 is a within-item held-out | 0.0006 code call; 0.05–0.3 agent / ×20 | 2–3 | 2 (office files; S5) | **Tier 2** |
| τ² banking_knowledge (BM25) | 2 (DB hash 88, ACTION 9 [S-obs]) | 2 | MIT | H4; re-graded 2026-07 [S-obs] | 0.03–0.1 / 0.3–0.6 | +1 on τ² adapter | 1 | **Tier 2** |
| EnterpriseOps-Gym | 2 (SQL state verifiers 102/102 in 13 samples; response_check exists [S-obs]) | 1 (Docker 103–168 MB per domain; no daemon here [S-obs]) | Apache-2.0 | H4 (public split; 40% hidden) | 0.01–0.4 (89K context, price cliff) | 3–4 | 2 (enterprise ops over MCP; distractor tools) | Tier 2 substitute 1 (laptop) |
| PlanBench | 2 (VAL; build untested: flex missing [S-obs]) | 2 | MIT (VAL BSD-3) | H2 (generators, obfuscated variants) | 0.0002 / 0.004 | 2 | 1 | Tier 2 substitute 2 |
| ITBench-Lite CISO + FinOps | 2 (OPA eval; ground truth in folder) | 3 (14 MB + `opa` binary) | Apache-2.0 | H4; n = 30 | 0.01–0.03 / ×20 | 1 | 1 (IT compliance) | Tier 2 substitute 3 (small n) |
| AgentArch | 2 (strict argument oracle, pass^k) | 3 (2 MB) | Apache-2.0 | H4; n = 110 | 0.002–0.01 / ×20 | 1 | 1 | Tier 2 substitute 4 |
| ToolHop | 2 (exact match; Direct scenario = leakage control) | 3 (20 MB) | Apache-2.0 | H4 | 0.001–0.004 | 1 | 0 | control / substitute 5 |
| MCPMark local (filesystem 30, Postgres 21) | 2 | 1–2 | Apache-2.0 | H4; near-saturated at the top [S-obs] | not estimated | 2–3 | 0 | defer |
| TaxCalcBench TY24 | 3 (deterministic engine output) | 2 (sparse clone; ≥ 285 MB full) | MIT | **answers in the repo**; a published run copied them [S-obs] | ~0.34 Haiku per return [doc] | 2 | 1 | **dev-only** (the one bed with published Haiku/Sonnet/Opus 5.5 numbers [doc]) |
| DABstep | 2 | 3 | CC BY 4.0 | hidden answers recoverable, 450/450 [S-obs] | 0.01–0.03 | 3 | 1 | method only (own solver as oracle) |
| NESTFUL, DS-1000 | 2–3 | 3 | Apache-2.0 / CC BY-SA | H4, high | < 0.001 | 1 | 0 | need-router negative controls |
| LegalBench | 2 | 3 | per task | H4, high | < 0.001 | 1 | 0 (typed judgments, not workflows) | typed-judgment axis only |
| MCPGen-25 | 2 | 2 | **no LICENSE** | low | 0.003–0.03 | 2 | 0 | diagnostic only |
| BPO-Bench | 1 (keyword oracle) | 3 | Apache-2.0 | H4 | < 0.005 | 1 | 0 | fault catalogue for runtime faults |
| Gaia2 / ARE | 1 (soft checks LLM-judged) | 2 | MIT / CC BY 4.0 | validation H4; test H1 (held by Meta) | not estimated | 4–5 | 2 (S9) | defer until a deterministic judge substitute exists |
| ERP-Bench (Anchor) | 3 (CP-SAT-certified verifier) | 1 (Odoo 699 MB + Postgres 162 MB images) | CC0 per metadata, no LICENSE file | H2 (generate-tasks) | 0.05–0.2 | 4 | 2 (ERP, long horizon) | **owner decision** |
| ToolSandbox | 1 (needs an LLM user simulator, RapidAPI) | 1 | Apple licence | H4 | — | 3–4 | 0 | defer |
| TravelPlanner | 2 | 2 | MIT | H4; structured conversion counts as cheating [S-obs] | — | 2 | 0 | dev curiosity |
| Spider2-DBT | 3 | 0 (1.06 GB zips) | MIT | H4 | 0.3–1.0 agent | 4 | 2 | owner decision |
| Excluded (D16 or oracle) | MCP-Atlas (1,021.6 MB image, LLM judge), LiveMCPBench (6.3 GB), MCP-Bench and MCP-Universe (live keys or services), ComplexFuncBench (RapidAPI, judge), WebArena-Verified and VisualWebArena (1.2–22 GB images), Toolathlon (accounts), CRMArena / -Pro (live Salesforce orgs), WorkArena (ServiceNow instances), TheAgentCompany (30+ GB), ITBench SRE/live (31 GB / kind cluster), EnterpriseBench (LLM judge), Spider2 full, FinanceBench (LLM-graded, 1.26 GB clone), MedAgentBench (1.84 GB image), CHI-Bench (gated data, Opus judge; protocol adopted only) [S-obs] | | | | | | | dispose (recorded) |

### 4.3 Tier 1: adopt this week

Selection: largest coverage gain per dollar among beds that run here today and can be held out. Each bed below gets the
shared facade (§5.1), the $0 gate (§5.3), a dev pilot, and one sealed run under the preregistration.

**T1-1 WorkBench** (https://github.com/olly-styles/WorkBench @`49c7dfd00c03d384ec59ea57374f50b766aa5613`, MIT, read
2026-10-21 by two sweeps).
- *Split.* Templates are the clusters. Within each of the 6 domains, order templates by
  `sha256('breadth-wb-v1:' + template_id)`; the first round(0.42 · n) go to dev (29 of 69), the rest are held out (40). Dev uses all
  shipped instances of dev templates. The sealed set is **3 regenerated instances per held-out template** (120 tasks),
  generated with a seed frozen in the preregistration.
- *Gate still to do.* Verify that `workbench-generate-data` can be seeded (the sweeps found it unseeded upstream
  [S-obs]); regenerated instances must pass gold replay 100% with a stable digest twice. Add three mutation operators
  (wrong argument, extra write, duplicate write): only drop-last was tested (566/568 killed [S-obs]). If regeneration
  fails, fall back to the shipped instances of held-out templates and relabel the bed H4.
- *Outcome.* Official `is_correct`; harmful side-effect rate secondary; the 18.0% do-nothing floor cancels in paired
  differences but the state-changing subset is reported too.
- *Foundry mode.* F-reuse per template stream (§5.2).
- *Parity anchor.* Haiku 4.5 (in the policy for tests [M]) through our A-H harness on 40 shipped instances of **dev**
  templates, compared task by task with the published Haiku 4.5 verdicts: a harness-validity check at about $2.
- *Why first.* Free frontier baseline per task for 24 models; Haiku 4.5 is perfect on 27/69 templates, below 50% on 15
  and at 0% on 3, and 55.7% on multi_domain with 82 side effects [S-obs]: real headroom where a workflow can act.

**T1-2 AgentDojo** (https://github.com/ethz-spylab/agentdojo, PyPI 0.1.35, benchmark v1.2.2, MIT).
- *Units.* (user task, condition), condition ∈ {benign, injection 1, injection 2}; cluster = user task.
- *Split.* 97 user tasks ordered by hash within suite: about 40% dev (F-kit development, the 35 public injection tasks),
  the rest held out. Sealed sample: 40 held-out user tasks × 3 conditions = 120 units. The injection tasks used on the
  sealed set are **new**, written by a session that builds nothing (about 3 per suite), hashed before any arm runs, each
  validated fail-to-pass: its security predicate fires when the injection goal is executed by a scripted agent and not
  otherwise.
- *Gate still to do.* Resolve the 8 workspace injection tasks that did not register in the sweep's single-pairing probe
  [S-obs] before any security outcome counts.
- *Outcome.* Success = utility true and, under attack, security holds. Utility, utility under attack and targeted ASR
  are secondary.
- *Arms see only facade tools* (no Bash, no network): the text is adversarial by design (D10, §10).
- *Why.* The only external test of THESIS P9 (control flow fixed before untrusted data is read). The Foundry claim here
  is "matched utility under attack with ASR near 0": Foundry aims at it by construction (the workflow is fixed before
  tool outputs are read), while a plain agent has no structural guarantee.

**T1-3 NaturalPlan** (https://github.com/google-deepmind/natural-plan, Apache-2.0 code, CC BY 4.0 data; data sha256
trip `15c4755d…`, meeting `cabd5537…`, calendar `3f34ff27…` [S-obs]).
- *Clusters.* Task type × complexity level (about 27).
- *Sealed set.* 10 instances per cluster (about 270) from **our generator**, admitted only if a faithfulness gate passes
  (per-level constraint counts within 10% of the public set; every instance solvable; trip unique by construction). If
  the generator fails the gate, use public instances plus a paraphrased format-drift split, labelled H4.
- *Oracle fix.* Replace calendar exact match with a feasibility checker (403/1,000 instances have more than one feasible
  slot, 227 with no stated tie-break [S-obs]); gate: agrees with golden on uniquely solvable instances 100%, accepts
  every feasible alternative, rejects infeasible mutants.
- *Arms.* A-H, A-S, A-O: one direct call each (official 5-shot prompt). F-H: Haiku 5.5 builds a parser + solver once per
  task type on dev instances with dev oracle feedback (3 independent lineages, ≤ $1 each), frozen; held-out execution
  makes no model call or only narrow parse judgments. This is the purest "code owns procedure" test in the portfolio.
- *Caveat.* With 3 task types, F-H's variance is dominated by build variance; the analysis bootstraps over lineages and
  clusters (PREREG §5.1).

**T1-4 AppWorld** (https://github.com/StonyBrookNLP/appworld, PyPI 0.1.3.post1, data 0.1.0 sha256 `fd9f9608…8250`
[S-obs]).
- *Split.* Official. F-kit development on train (90) + dev (57) only. Sealed: test_normal, 30 scenarios × 3 variants =
  90 tasks, scenario ids drawn by hash without opening task content. test_challenge stays untouched for a later
  confirmatory round. Released counts are 732 ids, not 750 [S-obs].
- *Gate still to do.* Determinism (two runs, identical digest) and side-effect mutation operators (repeat-last-write,
  extra field, touch-other-record) on dev; gold 147/147 and null 0/147 are done [S-obs].
- *Outcome.* TGC (task goal completion); SGC (all 3 variants) secondary.
- *Foundry mode.* F-reuse across the 3 variants of a scenario.
- *Terms.* No looking into or tuning on test; per-task test results stay out of git (aggregates only); encrypted data is
  never redistributed.
- *Cost gate.* A 20-task dev pilot per arm measures $/task. If the projected sealed cost exceeds $250, cut scenarios (not
  below 20) or move AppWorld to week 2. The wheel has no MCP server (that is on unreleased main) [S-obs]: the facade wraps
  `appworld serve apis` or the in-process API.

### 4.4 Tier 2: next, in declared order

The preregistration fixes this order. A bed is skipped only for a $0 gate failure, a D16 failure or a cost-gate failure,
recorded before any paid sealed run on it; the next substitute then takes its place.

| Order | Bed | Held-out | Foundry mode | Note |
|---|---|---|---|---|
| 5 | τ² telecom solo (`--agent llm_agent_solo --user dummy_user` registered at the pin [M]) | H4 + v2.0.0 surface-refreshed subset | per-intent F-reuse | **reliability bed: K = 3, pass^3**; no user simulator, so no simulator variance; Gymnasium `AgentGymEnv` exists [M] |
| 6 | BFCL v4 multi-turn (base, miss_func, miss_param, long_context) | H4 + memorization probe | F-live | Haiku 4.5 parity anchor against the leaderboard CSV; web_search and memory-vector excluded |
| 7 | SpreadsheetBench-912 | build on case 1, hold out cases 2–3 | F-build per instruction | drop or subtract the 67 items an unchanged workbook passes; fix `evaluation.py` (scores inputs, hard-codes `range(3)`, 5 malformed `answer_position` strings) [S-obs] |
| 8 | τ² banking_knowledge, `--retrieval-config bm25` | H4 | F-live | shares the τ² adapter; a source-level sensitivity analysis groups the two τ² beds |
| sub 1 | EnterpriseOps-Gym csm + itsm + hr | H4 (public split) | F-live | laptop Docker; keep prompts under 100K tokens (Haiku price cliff) |
| sub 2 | PlanBench (regenerated, obfuscated) | H2 | F-build | VAL build or a parity-tested validator first |
| sub 3 | ITBench-Lite CISO + FinOps | H4 | F-build | n = 30, so wide CI |
| sub 4 | AgentArch | H4 | F-live | |
| sub 5 | ToolHop | H4 | F-live | Direct (no tools) scenario as the leakage control |

### 4.5 Tier 3: family factory targets and fresh-instance generators

- Factory families (§6): `abr-reg-incident-clock`, `abr-itsm-queue`, `abr-p2p-audit`, then `abr-erp-dunning` (Tryton,
  when OT-1 starts under D4).
- Generators that turn H4 beds into H2: WorkBench regeneration (T1-1), NaturalPlan generator (T1-3), PlanBench
  generators, a τ² telecom composition check (`src/tau2/domains/telecom/tasks/manager.py` [M]: can it compose tasks
  outside the public 2,285, or new user-DB values?), AgentDojo injection authoring (T1-2), a DABstep fee-rule solver
  validated against the 10 dev answers and the recovered test answers (N-version oracle) before minting fresh questions.

### 4.6 Corrections to carry into other documents

Each correction is from a sweep today unless marked [M]; the owning tracks should apply them.

| Where | Correction |
|---|---|
| `research/tau2-20261021/ACQUISITION.md` | `tasks.json` for telecom has 2,285 entries, the same as `tasks_full.json`; `base` (114) is a list in `split_tasks.json`; v2.0.0 (2026-10-19) replaced 50 English telecom and 50 retail base tasks with same-ID reviewed versions and changed scoring, so 2.0 scores are not comparable with 1.x [M, `CHANGELOG.md`]. Retail rewards are DB + NL_ASSERTION (LLM-judged, 112/114); airline COMMUNICATE is LLM-judged unless `--communicate-scorer substring`; only telecom and banking_knowledge are pure executable oracles; the default user simulator is `openai/gpt-5.5`; the PyPI package `tau2` is an unrelated project [S-obs] |
| any note quoting AppWorld | 732 released ids (train 90, dev 57, test_normal 168, test_challenge 417), not 750; `appworld verify` ends in `os._exit(0)` and loses stdout [S-obs] |
| any note quoting SpreadsheetBench Verified-400 | exactly 1 test case per instruction, so the 3-workbook build-once property exists only in the 912 set [S-obs, construction sweep; the enterprise sweep's "3 per instruction" is wrong] |
| any WorkBench result | report against the 18.0% do-nothing floor (124/690) and on the 566 state-changing tasks [S-obs] |
| EnterpriseOps-Gym notes | the sweeps disagree on counts (HF 1,115 vs public split 649 of 1,150) and on frontier scores (best 34.1% / Opus 4.5 37.4% vs Opus 4.6 45.9%): unresolved |
| DABstep, TaxCalcBench | not usable as held-out: hidden answers recoverable (DABstep), expected outputs in the repo (TaxCalcBench) [S-obs] |

---

## 5. Shared infrastructure

### 5.1 Bed-to-MCP facade (one adapter per bed, every host)

`experiments/breadth/facade/` (to be written; Node ESM, stdio MCP server; the Python bed runs in its own pinned venv
outside the repo).

| Piece | What it does |
|---|---|
| `tools` | the bed's tool registry as MCP tools (WorkBench's 26 functions; AgentDojo suite tools; AppWorld `execute(code)` plus API docs lookup; τ² tools) |
| `reset(task, seed)` / `snapshot()` | fresh world per task; snapshots for grading and for F-reuse fallbacks |
| `grade()` | host-side only, a separate process, reading snapshots; never exposed as a tool; per-task verdicts written to a host-only directory |
| network | the bed process runs under `unshare -rn` (no network), as the sweeps probed [S-obs]; models reach only the model route |
| arms | A-H / A-S / A-O: `claude -p` with `--strict-mcp-config` and only the facade server; F-H: the facade plus the Foundry MCP server |

Hosts on the laptop attach the same server (`claude mcp add-json`, `codex mcp add`, Cursor and OpenCode MCP config), so
the host is a controlled variable. Cost: about 2 engineer-days once, then about 0.5 day per bed [S-obs estimate].

### 5.2 F-kit v1: what the Foundry arm is

One Foundry arm per bed, frozen by hash before the sealed run (PREREG §2). Bed-agnostic core, per-bed card.

1. **Templates (architect: Opus 5.5).** Bed-agnostic skeletons in the A1-C lineage: discover → requirement ledger → plan
   → act → verify, as typed workflows with narrow `agent` nodes, `code` nodes and `verify` nodes. Per bed, Opus writes a
   *bed card* from public docs, the tool schema and dev tasks only (≤ $5 per bed).
2. **Construct (Haiku 5.5).** For each task, Haiku fills the template through Foundry's construct/validate/run tools.
   A trivial workflow (one agent node) is allowed: "the best workflow may be none" (THESIS §1).
3. **Run and verify.** Acceptance must gate: a run whose own `verify` fails ends as a failure, not "pass" (the README's
   "honest run verdicts: broken" finding is the risk this addresses).
4. **Reuse inside a cluster stream (F-reuse).** After a run whose own verification passes, the workflow is kept for that
   cluster. The next instance of the cluster first passes a typed applicability gate (Haiku), then runs the kept
   workflow; a refusal or a runtime deopt falls back to construction. **No oracle feedback on sealed instances**: reuse
   relies on Foundry's own verification, as in real use.
5. **F-build** (NaturalPlan, SpreadsheetBench, PlanBench): built once per cluster on dev instances with dev oracle
   feedback, frozen, executed on held-out instances.
6. **Budgets.** Same per-task turn and token caps as A-H; construction cost counts on the instance where it happens;
   per-call prompts stay under 100K tokens (Haiku's price cliff at 100K: $0.50 / $2.50 per MTok beyond it [M,
   `policy/models.json`]).
7. **Dev discipline.** Kit iteration on dev splits only, at most 3 looks at a dev hold-back per bed (the AB-v1 devCheck
   rule), at most $15 per bed.
8. **Engine.** Every sealed run uses one named engine freeze, recorded in the freeze addendum (ROADMAP §6 rule 13).

### 5.3 The $0 oracle-validity gate (every bed, before any paid call)

| Gate | Check | Blocks the bed if |
|---|---|---|
| BG-0 provenance | URL, revision, sha256, size, licence, date recorded (D16) | anything missing |
| BG-1 gold replay | official gold actions or answers through the facade score 100% | < 100% |
| BG-2 floors | do-nothing, constant-answer and replay agents scored | not reported; if a floor exceeds 10%, the state-changing subset is also a headline |
| BG-3 mutation | at least 3 operators (drop, duplicate or extra write, wrong argument), ≥ 95% killed | < 95% |
| BG-4 determinism | two runs give an identical digest | any difference |
| BG-5 judge-free | no LLM judge in the reward | judge present (then a deterministic substitute, or dev-only) |
| BG-6 alternative-valid answers | an audit that valid non-golden answers are accepted (NaturalPlan lesson) | valid answers rejected |
| BG-7 shipped defaults and malformed fields | evaluator reads model output, not inputs; parses every item (SpreadsheetBench lesson) | defect unfixed |
| BG-8 leakage | gold, sealed manifests and verdicts unreachable from arm workdirs (test asserts it) | any path reachable |

Status today [S-obs]: WorkBench BG-1/2/4 done, BG-3 one operator only; AppWorld BG-1/2 on train+dev; BFCL-MT BG-1/2;
AgentDojo BG-1/2 for utility, security unresolved; NaturalPlan evaluators reproduce the paper but BG-6 fails on calendar;
SpreadsheetBench BG-2/6/7 found defects; τ² not started.

### 5.4 Contamination controls

1. **Memorization probe** (≈ $1 per bed): Haiku 5.5 and Sonnet 5.5, given the task text with no tools or world, asked
   for the gold actions or answer. Blind success above floor + 5 points flags the bed; a flagged H4 bed leaves the
   primary pool.
2. **Fresh vs public contrast** where both exist (WorkBench shipped vs regenerated; τ² old vs v2.0.0-replaced; NaturalPlan
   public vs generated): A-H and A-S success on each, reported; a drop over 10 points on fresh items is flagged.
3. **Library leakage scan** of F-kit templates and bed cards for literals of sealed items (ROADMAP §4.3).
4. **Network-off executors** (TaxCalcBench's copied-answer lesson [S-obs]).
5. **H4 sensitivity**: every pooled result is reported with and without H4 beds.

### 5.5 Disk and installs under D16

Disk free at writing: 3.5 GB of 252 GB [M, `df`]. D16 caps: 500 MB per clone or install, 1.5 GB for breadth while sealed
runs are live.

| Stage | Installs live at once | Approx. MB |
|---|---|---|
| Stage A | WorkBench 131, AgentDojo 166, NaturalPlan 50, AppWorld 366 | ~713 |
| Stage B | τ² venv (unmeasured, est. 300–500; repo already in `corpus/`), BFCL 108, SpreadsheetBench 175, plus AppWorld until its run ends | ~1,000–1,150 |

Rule: one install at a time, `df` check before each, delete what a stage no longer needs and record it in DISPOSALS.

---

## 6. Family factory (Tier 3)

### 6.1 Why

The 12 AB-R families are 37,463 Python lines (generator 15,781; oracle 5,018; reference 3,866; controls 2,835; gates
5,284; harness 3,898); at most 24% is shared, `reference.py` shares 0 definitions, and `family.json` has 39 top-level
keys of which 22 are common [S-obs]. One review of two families today added +1,266/−211 lines of generic oracle fixes
[S-obs]. On `abr-fin-apintake` the gates pass (reference 462/462, 1,968/1,968 mutants killed over 59 operators), but the
23 one-defect controls still pass 84–100% of triggers and 7 of 23 leave a clean week on 2 streams [S-obs]: per-trigger
rates hide defects, so clean weeks, hard-requirement violations and clause-attributed accuracy are the headline metrics.

### 6.2 Design (from the recurring-synthesis sweep, adopted with the changes marked [I])

- **One spec, four artifacts.** `family.spec` (YAML: world, clocks, policy clauses, triggers with arrival processes,
  stories, traps, effects, invariants, need job, plugins) compiles to POLICY.md, generator + truth engine, oracle,
  observable-only reference and controls. Prose and checks cannot drift (Anchor, arXiv 2605.26321 [doc]).
- **N-version where it buys validity.** The truth engine reads latent state; the reference reads only tool-visible
  state; they share the spec, not code, and must agree on every dev stream.
- **Traps are metamorphic operators with a declared resolving clause**, kept only if they flip the truth or break a
  named control (SWE-smith's fail-to-pass rule, arXiv 2504.21798 [doc]). New operators: T-clock, T-drift, T-partial,
  T-conflict, T-retract, T-replay, T-burst, T-irrelevant.
- **LLMs write the spec and the phrasebank once** (Opus spec ≈ $1–3; phrases admitted only if the reference and 2 of 3
  blind Haiku readers classify them as intended). Generation and grading are deterministic and $0.
- **Pipeline** F0 source card → F1 spec (Opus) → F2 lint → F3 phrasebank → F4 compile → F5 gates → F6 pilot → F7 freeze
  → F8 evaluation tiers (T0 $0, T1 ≈ $1, T2 $5–8, T3 ≈ $15, T4 Opus ceiling on ≤ 4 families).
- **Adapters** A1 log-calibrated stream, A2 clean population + injected violations, A3 statute-derived clocks, A4
  ERP-executed (Tryton N-version), A5 CP-SAT-certified, A6 schema-seeded (AWM-1K), A7 public-task-grounded (today's AB-R).
- **Host neutrality** [I]: factory families run on the AutomationBench host today; the spec's `host` field also targets a
  `sqlite-mcp` host so the same family can be served through the facade of §5.1.

### 6.3 Oracle-validity gates (block a family; all $0 unless priced)

| Gate | Check | Bar |
|---|---|---|
| G0 spec lint | every trap has a resolving clause; resolving inputs reachable; every effect has a predicate; every clause exercised | no miss |
| G1 determinism | identical hashes for world0, triggers, truth, end; round trip | identical |
| G2 **solvability** | observable-only **reference** passes every trigger and week on practice and dev streams | 100% |
| G3 necessity | removing any effect or clause makes the oracle fail somewhere | no decorative clause |
| G4 generator–reference agreement | same effect signatures on every dev stream | 100% |
| G5 **triviality attack and controls** | null passes exactly the no-op share; echo 0; naive ≤ 40-line control < 0.60 per trigger at d3; memoryless < 0.90 and no clean week; one control per clause and per trap kind, each detected in every evaluation stream | every control fails and is detected |
| G6 trap validity | fail-to-pass per trap; each trap kind ≥ 5 times over 4 dev streams | all kept traps valid |
| G7 metamorphic invariance | entity renames, base-week shifts, permuted independent triggers leave reference 100% and mutant verdicts unchanged | unchanged |
| G8 blind arm (≈ $0.05) | Haiku with POLICY.md + payload, no tools | below no-op share + 0.15 (threshold preregistered) |
| G9 second reader (≈ $0.3) | a session that did not write the family derives 20 practice outcomes | every disagreement fixed and logged |
| G10 **mutation score** and specificity | mutants killed; policy-neutral variants accepted; AB handler cross-check | ≥ 0.95 (1.0 on the reference's own operators); `ab_disagree == 0` |
| G11 differential tier (sample) | Haiku agent vs Sonnet agent on one rebased stream ($5–12) | flag if Haiku beats Sonnet by more than a preset margin |
| G12 leakage and parity | truth and reference host-only; `abr-apply` equals the app's own model path | no leak |
| **Reference workflow** | `wf-O`: the builder-kit skeleton completed by Opus against practice streams only | reported as the ceiling; build gap = wf-O − wf-H |

Admission to held-out: a session that did not write the family and has seen no arm results runs G0–G12 and prints
aggregates only (the existing need-router rule).

### 6.4 Build order with falsifiers

| Step | What | Cost | Falsifier or prediction [I unless noted] |
|---|---|---|---|
| B0 | extract the shared harness and gate skeleton into `experiments/autobench/abr/lib` | $0, ~1 day | all 12 families' gate JSONs identical before and after |
| B1 | parity re-spec of `abr-mkt-reviews` as a `family.spec` (pin the commit; the review track edits it today) | $0 | falsified if spec + plugins exceed 50% of the original lines, or any trap kind, control or mutation operator is lost; prediction 25–40% |
| B2 | generated controls, mutation operators and G3/G6/G7/G8 on all 12 families | $0 + ~$0.6 | prediction: G3 or G6 flags a decorative clause or inert trap in ≥ 3 of 12 |
| B3 | the first three new families (§6.5) | ~3 × $2 spec, gates $0 | each passes G0–G12 within two review rounds |
| B4 | effective-breadth count (single linkage on clause/trap/state/app signature, preregistered τ = 0.35) | $0 | if the new families fall into existing clusters, stop and redirect to new domains |
| B5 | T0–T2 on all; T3 on survivors; T4 on four | $60–150 | — |

### 6.5 The first three target families

Chosen for clause-type distinctness from the 12 AB-R families and from E7/E8, for needing no new install, and for an
exact oracle source. Each is checked for distinctness at B4 before any paid run.

| | `abr-reg-incident-clock` | `abr-itsm-queue` | `abr-p2p-audit` |
|---|---|---|---|
| Adapter | A3 statute-derived clocks | A1 log-calibrated stream | A2 clean population + injected violations |
| Source | NIS2 Art. 23(4) structure (24 h early warning, 72 h notification, one-month final report), GDPR Art. 12(3) for a DSAR variant; `holidays` 0.107 (MIT) for calendars [S-obs] | UCI incident event log ID 498 (CC BY 4.0): weekday profile, reassignment 45.6%, reopen 1.1%, mined SLA thresholds; parameters only, no rows cross [S-obs] | ProcureChange reference OCEL (Zenodo 22079246, CC BY 4.0): P2P JSON 7.4 MB inside a 1,158 MB record, clean on two invariants over 3,096 payments [S-obs, figures not re-opened] |
| Clauses (examples) | classify "significant" only on the CISO's email; three clocks; retraction before the early warning cancels all clocks and needs a log row; only the policy owner may amend a window | SLA clock pauses on "awaiting customer", resumes on reply; reopen restarts the resolution clock; priority change re-targets the SLA; escalate at 80% of the SLA | releaser must differ from approver; payment only after a passed three-way match within tolerance; duplicate invoice detection; hold on a failed match |
| Traps | T-clock (DST, weekend, month-end clamp), T-authority, T-lookalike, T-stale, T-repeat, T-retract | T-burst (a design parameter: the log shows a peak day of only 1.7× a weekday, so burst is a stress test, not a field claim), T-replay, T-partial, T-conflict | T-lookalike vendor, T-replay (duplicate invoice), T-conflict (two receipts disagree), injected SoD and match violations with exact labels |
| State kinds | S2 timers, S4 policy editions, S5 lifecycle, S1 ledger | S2, S5, S6 windows, S7 joins | S7 joins (PO ↔ receipt ↔ invoice), S1, S3 pending approval |
| Hard requirement | schedule + audit | schedule | approval + audit |
| Third oracle | clock engine as a pure function, property-tested (Hypothesis) | clock engine; AB handler cross-check | the injection log (exact labels) |
| Distinctness risk | low | **overlaps `abr-ops-slawatch` and E7**: if its signature distance to either is below τ, swap in `abr-erp-dunning` | low |
| Prediction [S-obs, sweep's own] | the clearest workflow win: `calendar-month` and DST traps are code-solvable and judgment-hostile | burst raises agent cost per clean week more than workflow cost | — |

### 6.6 The factory's own claim

Separate from the external-bed portfolio. Per family: paired comparison of clean-week rate and hard-violation count,
wf-H (Haiku-built, once per family) against agent-H and agent-S (Sonnet), Opus ceilings on four families. Portfolio of
families: wins/F with an exact one-sided sign test plus a hierarchical model with a family random effect. Power of the
sign test [S-obs calc]: 12 families give 39% at a true win rate of 0.75 (74% at 0.85); 24 give 77% (98%); 36 give 91%.
So the factory claim waits for at least 24 *effective* families (distinct clusters at τ = 0.35); the 12 AB-R families
count as one cluster under the need-router import-graph rule until B4 measures otherwise [M, RECURRING-DESIGN §2].

---

## 7. The breadth-claim protocol (summary)

Full text: [PREREG-BREADTH-v0.md](PREREG-BREADTH-v0.md).

- **Hypotheses (co-primary, all one-sided α = 0.025).** H1 non-inferiority: the pooled paired success difference F-H −
  A-S has a lower 97.5% bound above −δ, δ = 0.10. H2 cost: the pooled ratio of cost per verified success, F-H / A-S, has
  an upper 97.5% bound ≤ 0.5. H3 lift: the pooled difference F-H − A-H is above 0. The portfolio claim needs all three;
  "beats" is tested only after H1 holds (closed testing, no extra α).
- **Pooling.** Random effects with Paule-Mandel τ² and Hartung-Knapp-Sidik-Jonkman intervals (never narrower than the
  fixed-effect interval), t on B − 1 df; within-bed estimates from a cluster bootstrap, not the CLT (Bowyer et al.,
  arXiv 2503.01747, abstract read today from the methodology sweep's fetch [doc]). Prediction interval for a new bed
  reported with the target "lower bound above −2δ".
- **Beds.** Eight in declared order (§4.3–4.4), with substitutes; pooled verdict only at B = 8. Stage A (Tier 1, B = 4)
  is reported descriptively.
- **Arms.** A-H, F-H, A-S on every bed; A-O on a 20-task anchor per bed; F-S optional; F-M only if D8 allows.
- **K.** 2 runs per task for A-H, A-S, A-O; 3 lineages (random stream orders) for F-H, as ROADMAP §4.3 requires for
  learning arms; K = 3 for every arm on the reliability bed (τ² telecom) for pass^3.
- **Stopping.** No early stop for efficacy. One interim look per bed at half its pairs: stop for futility if the one-sided
  z for H1 is below 0.02 (P(stop | true 0) = 0.02, P(stop | true −δ) = 0.47 [calc by the methodology sweep, re-checked
  here as consistent with the printed table]); stop at the bed's cost cap.
- **Item sampling.** Stratified random clusters with a hash seed; no difficulty-filtered anchors for the primary estimate
  (mid-range filters keep rank order but bias absolute scores under scaffold shift: Ndzomga, arXiv 2603.23749 [doc]).
- **Reported**: everything in PREREG §9, including raw failures, all gate results, excluded beds and every deviation.

**Power** [calc: `scratchpad/breadth/plan/pool_power.py`, 4,000 replications each, using the methodology sweep's
`portfolio_sim.py`; discordance 0.25, δ = 0.10, one-sided 0.025]:

| Beds B | n_eff per bed | τ (between-bed SD) | P(H1 holds \| true 0) | P(H1 \| true +0.03) | size at true −δ |
|---|---|---|---|---|---|
| 4 | 60 / 90 | 0.05 | 0.31 / 0.42 | 0.52 / 0.66 | ≤ 0.005 |
| 6 | 60 / 90 | 0.05 | 0.66 / 0.77 | 0.88 / 0.94 | ≤ 0.014 |
| 8 | 60 / 90 | 0.05 | 0.85 / 0.91 | 0.97 / 0.99 | ≤ 0.018 |
| 8 | 60 / 90 | 0.08 | 0.66 / 0.71 | 0.87 / 0.90 | ≤ 0.019 |
| 10 | 60 / 90 | 0.08 | 0.78 / 0.82 | 0.95 / 0.97 | ≤ 0.025 |

Per bed, for comparison: 202 paired tasks are needed for 0.80 power at discordance 0.25 (exact score test; 319 if the
true difference is −0.02) [S-obs calc, `ni-sample-size.txt`]; at n_eff = 90 the per-bed power is about 0.48 [calc, normal
approximation]. Observed discordance anchors: AB dev60 Haiku + A1 vs Sonnet alone 14/60 = 0.23; Sonnet + A1 vs Haiku +
A1 16/60 = 0.27 [M].

---

## 8. Week schedule within usage limits

### 8.1 Usage model and rules

- **What binds.** Paid calls and agents draw on one plan allowance; usage credits are off, so hitting the limit pauses
  everything (README [M]). Today the 5-hour session limit stopped all agents once, at about 15 concurrent agents (brief).
- **Rules for this program** [I]:
  1. At most **6 concurrent runner sessions** for breadth (at most 3 of them Sonnet, at most 1 Opus), plus at most **2
     build agents** (Opus for templates and bed cards, Sonnet for adapters). Other tracks keep the rest of the account.
  2. Heavy arms (Sonnet, Opus) start just after a window reset; Haiku arms and $0 work fill the rest.
  3. A **usage ledger** per wave: tokens by model and list-$, per 5-hour window. When a limit is hit, record cumulative
     list-$ and tokens at the hit as the calibration point; later waves plan at ≤ 60% of it.
  4. Every runner is resumable (`--resume`, as the AB runner) and commits its journal before each wave; waves are
     staggered with scheduled reminders, not polling loops.
  5. A disk check before each launch; one install at a time (§5.5).
- **Usage proxy per bed** (session-hours = sessions × typical session length) [I]: WorkBench ≈ 8, AgentDojo ≈ 10,
  NaturalPlan ≈ 7 (mostly direct calls and 9 builds), AppWorld ≈ 56. Stage A sealed ≈ 81 session-hours ≈ 14 wall-hours at
  6 lanes ≈ 3 windows.

### 8.2 Days (Thursday 10-22 to Wednesday 10-28)

The 3-day plan (`research/PLAN-3DAY-20261021.md`) owns 10-22 to 10-24 (engine bump, SPEC-1, AB-v1 test, demo). Breadth
work in those days is $0 or small, and no breadth sealed run starts before the engine freeze it names.

| Day | $0 work (any time) | Paid work (window-aware) | Gate to pass by end of day |
|---|---|---|---|
| Wed 10-21 (tonight) | this plan and the prereg draft; DISPOSALS merged | — | plan reviewed by the orchestrator |
| Thu 10-22 | facade v0 with WorkBench; WorkBench reinstall; generator seed-control check; 3 extra mutation operators; NaturalPlan venv, feasibility checker and generator v0; AgentDojo reinstall and the 8 workspace pairings | memorization probes WorkBench, NaturalPlan (≈ $2) | BG-0…BG-8 for WorkBench and NaturalPlan |
| Fri 10-23 | AppWorld install (no network), determinism and side-effect mutants on dev; AgentDojo facade; injection-task author session (no builder access); F-kit v1 core from A1-C v2 | Opus templates and 4 bed cards (≈ $16); Haiku-alone dev pilots, 30–40 tasks per bed (≈ $6); Sonnet dev parity, 20 tasks per bed (≈ $25, AppWorld ≈ $16 of it) | AppWorld cost projection; headroom screen (PREREG §1.2) |
| Sat 10-24 | contamination contrasts; analysis script and power re-check; sealed manifests hashed (WorkBench seeds, AgentDojo injections, NaturalPlan instances, AppWorld scenario ids) | F-kit dev iteration, ≤ 3 looks per bed (≤ $60); Haiku 4.5 parity anchor on WorkBench dev (≈ $2) | F-kit hashes; **PREREG-BREADTH-v1 frozen and committed** |
| Sun 10-25 | — | sealed: WorkBench (≈ $20), NaturalPlan (≈ $9), then AgentDojo (≈ $24) | interim futility looks as they reach half |
| Mon 10-26 | τ² venv and adapter start (Tier 2) | sealed: AppWorld, A-H and F-H lanes, then A-S after a reset (≈ $185) | AppWorld interim look |
| Tue 10-27 | BFCL-MT, SpreadsheetBench-912 gates | AppWorld A-S completes; A-O anchors where approved | — |
| Wed 10-28 | **Stage-A report** (descriptive pooled, B = 4); factory B0–B1 complete | — | Stage-A report committed |

Factory work (B0–B2, $0) runs in parallel all week on one build agent once the facade is up.

### 8.3 Week 2 outline (10-29 to 11-04)

τ² telecom solo (K = 3) and banking, BFCL-MT, SpreadsheetBench-912 sealed runs (Stage B, ≈ $350–440); the primary pooled
analysis at B = 8; factory B3 (first three families, T0–T2); host study on the laptop (WorkBench via the facade, 30-task
smoke set per host, within-host Foundry vs no Foundry). The 11-04 engine bump (D15) must not change the engine under a
running sealed run.

---

## 9. Cost table

### 9.1 Per-task basis (list price, CLI route with prompt caching)

| Anchor | Value | Source |
|---|---|---|
| AB agent task, Haiku 5.5 (≈ 13 responses) | $0.012–0.016 | DEV60, DEVCHECK [M] |
| AB agent task, Haiku + A1 / A1-C | $0.015 / $0.030 | DEVCHECK [M] |
| AB agent task, Sonnet 5.5 alone | $0.10 (6–7× Haiku per task, not the 20× token price ratio) | DEV60 Sonnet pair [M] |
| SOP-Bench row, Haiku agent | $0.0022 | NOTES §8 [M] |
| Prices | Haiku $0.10/$0.50 (≤ 100K prompt), Sonnet $2/$10, Opus $4/$20 per MTok | `policy/models.json` [M] |

Opus per task is taken as 2× Sonnet [I]. Per-bed per-task figures below are [I] from these anchors and the sweeps' token
estimates; the dev pilots replace them before the freeze.

### 9.2 Stage A (Tier 1), Stage B (Tier 2), factory

| Bed | n tasks (clusters) | $/task H / S / O | A-H (K=2) | F-H (3 lineages) | A-S (K=2) | A-O anchor (20 × 2) | Sealed total |
|---|---|---|---|---|---|---|---|
| WorkBench | 120 (40) | 0.008 / 0.05 / 0.10 | 1.9 | 2.2 | 12 | 4 | **≈ 20** (+2 parity) |
| AgentDojo | 120 (40) | 0.008 / 0.06 / 0.12 | 1.9 | 2.9 | 14 | 5 | **≈ 24** |
| NaturalPlan | 270 (27) | 0.0005 / 0.01 / 0.02 direct | 0.3 | 2.7 (9 builds; $0 execution) | 5.4 | 0.8 | **≈ 9** |
| AppWorld test_normal | 90 (30) | 0.10 / 0.80 / 1.60 | 18 | 22 | 144 | 64 (owner approval) | **≈ 184** (+64) |
| **Stage A sealed** | | | | | | | **≈ 240** (+64 optional) |
| Stage A dev and pilots | Opus templates and cards 16; Haiku dev pilots 6; Sonnet dev parity 25; F-kit dev looks ≤ 60; probes and parity 6 | | | | | | **≈ 115** |
| τ² telecom solo (K = 3) | 90 (≈ 40 intents) | 0.05 / 0.45 / 0.90 | 13.5 | 13.5 | 122 | 54 | ≈ 200 |
| BFCL-MT | 120 (40) | 0.006 / 0.08 / 0.16 | 1.4 | 2.2 | 19 | 6 | ≈ 29 |
| SpreadsheetBench-912 | 120 cases (60 instr.) | 0.02 / 0.15 / 0.30 | 5 | 18 (builds) | 36 | 12 | ≈ 71 |
| τ² banking (BM25) | 90 (≈ 30) | 0.05 / 0.45 / 0.90 | 9 | 13.5 | 81 | 36 | ≈ 140 |
| **Stage B sealed** | | | | | | | **≈ 440** with the τ² Opus anchors, ≈ 350 without; plus dev ≈ 80 |
| Factory B0–B5, first 3 families | specs ≈ 9, gates ≈ 2, T1–T2 ≈ 25, T3 ≈ 45, T4 Opus ≈ 20 | | | | | | **≈ 100** |
| **Two-week total** | | | | | | | **≈ 885–1,040** (without / with every optional Opus anchor); about one fifth of the sealed spend is on the Haiku arms |

Each stage's sealed run stays under the $500 single-experiment pause rule [M, policy `spend`] if the τ² Opus anchors run
only when Stage A came in under budget; dev runs are separate small experiments. The two-week total and the optional
Opus anchors need the owner (§10).

### 9.3 Breadth per dollar and per usage hour

| Bed | Sealed clusters | $ per cluster (all arms) | $ per cluster, Haiku arms only | Session-hours |
|---|---|---|---|---|
| NaturalPlan | 27 | 0.34 | 0.11 | ≈ 7 |
| WorkBench | 40 | 0.50 | 0.10 | ≈ 8 |
| AgentDojo | 40 | 0.60 | 0.12 | ≈ 10 |
| BFCL-MT | 40 | 0.73 | 0.09 | ≈ 6 |
| SpreadsheetBench-912 | 60 | 1.2 | 0.38 | ≈ 15 |
| τ² banking | 30 | 4.7 | 0.75 | ≈ 25 |
| τ² telecom (K = 3) | 40 | 5.0 | 0.68 | ≈ 35 |
| AppWorld | 30 | 6.1 (8.3 with the Opus anchor) | 1.32 | ≈ 56 |

Reading [I]: the cheap arms are nearly free everywhere; the comparator arms set the price of breadth. AppWorld costs
10–18× a cheap bed per cluster and is kept for what nothing else gives (official sealed, long horizon).

---

## 10. Owner decisions needed

| # | Question | Recommendation | Blocks |
|---|---|---|---|
| OD-1 | Breadth budget: Stage A ≈ $355 (sealed ≈ $240 + dev ≈ $115), Stage B ≈ $430–520 (sealed ≈ $350–440 + dev ≈ $80), factory ≈ $100; ≈ $885–1,040 over two weeks at list price | approve by stage; each stage's sealed run under $500 | Stage B |
| OD-2 | D10: executors read benchmark text, and AgentDojo's is adversarial by design | accept as for AutomationBench (RECURRING-DESIGN §3.13), with facade-only tools, no Bash and no network for every portfolio arm | AgentDojo |
| OD-3 | Mercury (D8): about 0.8M tokens left under the 5M cap; an F-M arm needs about 2–3M per bed [I] | report the allowance or keep F-M off | F-M arm |
| OD-4 | Laptop runs: EnterpriseOps-Gym images (csm + hr + itsm ≈ 314 MB compressed) and the host study with the owner's own Codex, Cursor and OpenCode | approve for week 2 | host axis, substitute 1 |
| OD-5 | Opus anchor on AppWorld (+$64) and τ² (+$54 + $36) | approve if Stage A runs under budget | A-O on those beds |
| OD-6 | Breadth's concurrency share (≤ 6 runner sessions + 2 build agents) | confirm, or state the account's limit | schedule |
| OD-7 | ERP-Bench (Odoo ≈ 861 MB images) and Spider2-DBT (1.06 GB zips) | defer | Tier 3 externals |

README's owner-decision table should carry OD-1 to OD-7 (README is the single entry point; ROADMAP §6 rule 1). This
document does not edit README.

---

## 11. Risks and what would change the plan

1. **The Foundry arm is a different program per bed in practice.** Mitigation: one bed-agnostic core, bed cards written
   by Opus from public material only, hashes frozen, and the per-bed card diff reported. If a bed needs custom code
   beyond its card, that bed is labelled "bed-specific F" in the report.
2. **Haiku alone is already non-inferior to Sonnet** on some beds (AB dev60: Haiku + A1 22/60 vs Sonnet alone 20/60 [M]).
   H3 (lift over Haiku alone) exists so this is not credited to Foundry.
3. **Sonnet-alone is a weak frontier baseline.** It is the natural one (Claude Code with the bed's tools). F-S on WorkBench
   and AgentDojo shows whether Foundry helps Sonnet as much (AB dev60: the harness lifted both models by 13–15 points [M]).
4. **Cost overrun on AppWorld or τ².** Cost gates before freeze; futility looks; the cap stops the bed.
5. **Contamination.** H4 beds may favour whichever arm memorized more; probes and the H4 sensitivity analysis bound it.
6. **Account limits.** A limit hit mid-wave costs a window, not data, if runners resume.
7. **Oracle defects found late.** An invalid evaluator blocks claims (AGENTS.md): a bed whose gate fails after the sealed
   run is reported and excluded, and the next substitute is run.

## 12. Not verified here

Model knowledge cutoffs; WorkBench generator seed control; the 8 AgentDojo workspace injection pairings; τ² venv size and
whether `tasks/manager.py` can compose tasks outside the public pool; NaturalPlan generator faithfulness; AppWorld cost
per task (the range is wide); whether `claude -p` sessions share prompt-cache prefixes across processes; whether Codex,
OpenCode and Cursor run headless against an MCP server; EnterpriseOps-Gym task counts; ProcureChange per-file download;
the usage limit's size in tokens or dollars.

---

## Sources

All read on 2026-10-21, by the sweep named or by this author.

**Repository [M]:** README.md; docs/THESIS.md; docs/ROADMAP.md §4, §6; AGENTS.md; `policy/models.json` (version
2026-10-21.2); `research/decisions-20261021.md` (D4, D8, D9, D10, D16); `research/PREREGISTRATION-TEMPLATE.md`;
`research/PLAN-3DAY-20261021.md`; `research/automationbench-20261014/{PREREG-AB-v1.md,RECURRING-DESIGN.md,runs/DEV60-A0-A1.md,runs/DEVCHECK.md}`;
`research/sopbench-20261021/{NOTES.md,DESIGN.md}`; `research/tau2-20261021/ACQUISITION.md`;
`research/composition-20261021/RESULT-COMP1.md`; `research/org-20261021/README.md`; `research/jit-20261008/design/W-BED.md`;
`corpus/tau2-bench` at `57e54143` (`data/tau2/domains/telecom/split_tasks.json`, `tasks.json`, `src/tau2/registry.py`,
`src/tau2/gym/`, `CHANGELOG.md`).

**Sweep notes** (session scratchpad `breadth/`): `agentic-tool.md`, `enterprise-process.md`, `construction.md`,
`recurring-synthesis.md`, `wb-probe-run1.json`, `wb-probe-run2.json`; methodology leftovers `tools-meth/*.py`,
`ni-sample-size.txt`, `fut-sim.txt`, `portfolio-sim.txt`, `meth/*.txt`.

**Benchmarks** (read by the sweeps): WorkBench https://github.com/olly-styles/WorkBench; AppWorld
https://github.com/StonyBrookNLP/appworld; BFCL https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard;
τ²-bench https://github.com/sierra-research/tau2-bench; AgentDojo https://github.com/ethz-spylab/agentdojo; NESTFUL
https://github.com/IBM/NESTFUL; ToolHop https://huggingface.co/datasets/bytedance-research/ToolHop; EnterpriseOps-Gym
https://github.com/ServiceNow/EnterpriseOps-Gym; MCPMark https://github.com/eval-sys/mcpmark; Gaia2/ARE
https://github.com/facebookresearch/meta-agents-research-environments; ToolSandbox https://github.com/apple/ToolSandbox;
TaxCalcBench https://github.com/column-tax/tax-calc-bench; SpreadsheetBench https://huggingface.co/datasets/KAKA22/SpreadsheetBench
and https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2; ITBench-Lite https://huggingface.co/datasets/ibm-research/ITBench-Lite;
AgentArch https://github.com/ServiceNow/AgentArch; BPO-Bench https://huggingface.co/datasets/ibm-research/BPO-Bench; DABstep
https://huggingface.co/datasets/adyen/DABstep; LegalBench https://github.com/HazyResearch/legalbench; ERP-Bench
https://huggingface.co/datasets/anonymouse321/erp-bench; CHI-Bench https://github.com/actava-ai/chi-bench; NaturalPlan
https://github.com/google-deepmind/natural-plan; PlanBench https://github.com/karthikv792/LLMs-Planning; MCPGen
https://github.com/zoe-yyx/MCPGen_Official; DS-1000 https://github.com/xlang-ai/DS-1000; TravelPlanner
https://github.com/OSU-NLP-Group/TravelPlanner; Spider2-DBT https://github.com/xlang-ai/Spider2/tree/main/spider2-dbt.

**Methods** (read by the sweeps; abstracts of the last four re-read by this author from the methodology sweep's fetches):
Anchor arXiv 2605.26321; AutoGym 2609.22592; AgentMercury 2608.20634; τ² paper 2506.07982; SWE-smith 2504.21798;
TaskCraft 2506.10055; AutoEnv 2511.19304; EnvScaler 2601.05808; Abrich 2610.09142; IPT 2604.15149; ABC 2507.02825;
FlowMind 2602.11782; AFlow 2410.10762; Bowyer et al. 2503.01747 (CLT in small-n evals); Waudby-Smith and Ramdas
2010.09686 (betting confidence sequences); Ndzomga 2603.23749 (efficient agent benchmarking, mid-range filter);
Hofmann et al. 2509.11106 (Fluid Benchmarking).

**Data sources** (read by the recurring-synthesis sweep): UCI incident log
https://archive.ics.uci.edu/dataset/498/incident+management+process+enriched+event+log; ProcureChange
https://zenodo.org/records/22079246; BPIC OCEL https://zenodo.org/records/22663565; GDPR Art. 12
https://gdpr-info.eu/art-12-gdpr/; holidays https://pypi.org/project/holidays/; OR-Tools https://pypi.org/project/ortools/;
Tryton https://pypi.org/project/trytond/.
