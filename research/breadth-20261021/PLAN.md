# Breadth program: portfolio, family factory, claim protocol and first weeks (2026-10-21, revision 2)

*Design, 2026-10-21 (late evening), written by an Opus 5.5 subagent of the breadth workflow at HEAD `7ab0c16e`.
**Revision 2 supersedes revision 1** (committed in `6c56ec30`, written at `f8478b4` before the methodology and
repo-coverage sweeps had returned). Inputs: all six breadth sweeps of today (agentic-tool, enterprise-process,
construction, recurring-synthesis, methodology, repo-coverage; notes in the session scratchpad `breadth/*.md`), the two
critic scripts left in `breadth/cost-critic/` and `breadth/critic-owner/`, this repository, and two $0 calculations run
for this revision (`breadth/plan2/cost2.py`, `breadth/plan2/graph_power.py`, outputs beside them). Nothing in this file
has run against a model. Nothing here is a capability result. `beds/sealed/` was not read; no benchmark test split was
opened; no sealed aggregate of a running experiment was read.*

*Companion: [PREREG-BREADTH-v0.md](PREREG-BREADTH-v0.md) (draft preregistration, revision 2, not frozen). Disposals:
[DISPOSALS.md](DISPOSALS.md).*

**Evidence tags.**
- **[M]** read or measured in this repository today (path cited).
- **[S-obs]** observed by a breadth sweep today (a probe it ran or code it read), not re-run by this author.
- **[doc]** a project README, card, paper or leaderboard claim, not checked here.
- **[calc]** computed today by this author or by the methodology sweep (script path given).
- **[I]** inference or design choice.

**What changed from revision 1** (each item is argued where it lands):
1. **Comparator.** D19 makes **Opus 5.5 at effort xhigh** the owner's frontier bar; revision 1 had Sonnet 5.5 as the only
   powered comparator. Revision 2 tests Sonnet first and Opus xhigh second in one pre-declared claim graph (§8).
2. **Twelve beds, not eight**, in a declared order, with the comparator arms thinned where they are expensive. The
   cost critic showed a thinned 12-bed design dominates the 8-bed design on power and cost; the methodology sweep showed
   breadth buys precision faster than depth (§1, §8).
3. **Statistics corrected.** Within a bed: cluster-robust t or score test with a design effect; bootstrap only with ≥ 30
   clusters (revision 1 mis-cited Bowyer et al. as support for the bootstrap). Across beds: modified Hartung-Knapp
   (Röver floor). An assay-sensitivity label and a retained-lift ratio go with every non-inferiority verdict (§8).
4. **τ² banking_knowledge has no solo mode** at the pin (`corpus/tau2-bench/src/tau2/domains/banking_knowledge/
   environment.py:70-71` [M]); it needs a user simulator, so it moves from bed 8 to bed 10, paired with airline.
5. **Repo facts updated** from the repo-coverage sweep: the AB-v1 test run is not in flight; devCheck has Sonnet alone
   at 23/60, above Haiku + A1 (20/60); D18 raised the Mercury ceiling to 20M tokens; the AB-R held-out seed range collides
   with the need router's (§2, §6.4, §11 OD-10).
6. **Disk and meter.** Raw run transcripts for the full portfolio would be about 11.5 GB [calc]; the disk has 3.0 GB free
   [M, `df`]. Audit-on-write compression and a quota-meter capture are now prerequisites (§5.5, §9).
7. **Contamination controls fixed**: a memorization probe with ≥ 100 items and an exact test (30 items cannot detect less
   than +16 points over a 5% floor), a pooled difference-in-differences instead of a bare "10-point drop", and a log audit
   of every sealed run (§5.4).

---

## 0. Bottom line

1. **The claim has no held-out evidence today.** "Cheap model + Foundry is non-inferior to a frontier model alone, at
   lower cost" rests on development runs of one external bed (AutomationBench dev60 and devCheck) and on Claude-written
   beds. On devCheck, Sonnet 5.5 alone (23/60) is above Haiku + A1 and Haiku + A1-C (20/60 each) [S-obs, repo-coverage].
   Opus 5.5 xhigh alone has never run on an external bed. No sealed run in flight holds a frontier-alone arm [M].
2. **Breadth means independent beds.** The bed is the replication unit; inside a bed the unit is the cluster (template,
   scenario, user task, intent, family), never the instance. The anti-artefact quantity is the **between-bed spread τ
   with a prediction interval for a new bed**, not a pooled accuracy or a count of wins.
3. **Twelve external beds in declared order, about 3 weeks, about $2.4k list price** (sealed ≈ $1,780, dev ≈ $480,
   factory ≈ $100) [I/calc, §10]. One frozen Foundry kit (F-kit v1) on every bed; arms A-H (Haiku 5.5 alone), F-H (Haiku 5.5 + Foundry),
   A-S (Sonnet 5.5 alone), A-O (Opus 5.5 xhigh alone). At B = 12 and n_eff ≈ 80 per bed, the first claim node (F-H
   non-inferior to Sonnet within 10 points and at ≤ ½ its cost per verified success) has power 0.95 at τ = 0.05 and 0.76
   at τ = 0.10, with size 0.024–0.026 [calc, `plan2/graph_power.txt`].
4. **Tier 1, adopt this week** (run here, no Docker, no accounts, deterministic oracles, MIT/Apache): **WorkBench**
   (workplace SaaS, regenerated instances of 40 held-out templates), **AgentDojo** (prompt-injection security, injection
   tasks we author), **NaturalPlan** (scheduling; a solver built once by Haiku, held-out execution at $0 model cost),
   **τ²-bench telecom in solo mode** (policy-bound troubleshooting, environment assertions, pass^3; already pinned in
   `corpus/`). **AppWorld** (long-horizon personal multi-app, official sealed test) starts this week as the first Tier-2
   bed because the first interim report needs a long-horizon bed.
5. **Tier 2, in declared order:** AppWorld, BFCL v4 multi-turn, SpreadsheetBench-912, PlanBench (regenerated),
   ToolHop, τ² simulated-user domains (banking_knowledge BM25 + airline with the substring scorer), DABstep-fresh (fresh
   questions from our fee-rule solver, validated against 450 recovered answers), EnterpriseOps-Gym (owner's laptop,
   Docker). Substitutes: NESTFUL, DS-1000, SpreadsheetBench V2 (non-chart subset).
6. **Tier 3 is the family factory** (§6): one `family.spec` compiles policy text, generator, oracle and controls,
   replacing the roughly 73% of the 12 hand-built AB-R families that is bespoke. First three new families:
   `abr-reg-incident-clock`, `abr-itsm-queue`, `abr-p2p-audit`. Factory families carry their own claim (recurring
   families; random effects over ≥ 15 effective families, sign test over ≥ 24 as the robust secondary).
7. **The claim graph** (PREREG §5.3): node A = non-inferior to Sonnet ∧ ≤ ½ its cost (α 0.025); if A holds, α splits
   between node B = Foundry lifts Haiku (H3) and node C = non-inferior to **Opus xhigh** ∧ cheaper (on the beds where
   Opus runs at full depth); superiority only after both. Honest power for C is low if Opus is 5 points better than
   Sonnet (0.13–0.25) [calc]: "matches the owner's bar" is a stretch result, and the verdict sentence says so.
8. **Oracle validity first, at $0.** Every bed passes gold replay 100%, reported floors (do-nothing, constant, replay),
   ≥ 3 mutation operators with ≥ 95% killed, an identical digest on two runs, no LLM judge in the reward, an
   alternative-valid-answer audit and a leakage test before any paid call. The sweeps already found defects this way:
   WorkBench's 18.0% do-nothing floor, NaturalPlan calendar scoring that rejects valid alternatives in up to 227 of
   1,000 instances, SpreadsheetBench's evaluator scoring inputs and passing 7.3% of unchanged workbooks [S-obs].
9. **Cost and usage.** Comparator arms are 78% of sealed cost [calc]. Levers used: $0 kill gates, clusters before
   instances, comparators thinned on expensive beds, Opus at full depth only on the eight cheap beds (20-task anchors
   elsewhere unless the measured meter draw allows more), futility looks, cached comparator arms on dev, and a quota
   meter read from `claude -p --output-format stream-json` so "breadth per usage-limit hour" becomes measurable (§9).
10. **Own beds and concurrent sealed runs are reported beside the portfolio, never inside it** (§7): AB-v1 test and
    SOP-Bench sealed (if their tracks add frontier-alone arms by dated amendment), E8/OT-0 frontier agents, BUILDER-1
    fresh-author requests, unarmed Tier-A beds on fresh seeds (consumed from the need-router rows, not re-run).
11. **Decisions needed** (§11): the budget, K = 2 versus K = 1 (owner rule "no K = 1 comparative proof" versus a 31%
    saving), the margin label, the AgentDojo exception to THESIS D10, the laptop runs, the AB-v1 and SOP-Bench
    amendments, and two seed-ledger collisions.

---

## 1. What "breadth" has to mean for this claim

**The claim under test** (brief and AGENTS.md): cheap models (Haiku 5.5; Mercury 3; later open-weight) inside Foundry
construct, run, verify and reuse bounded typed workflows that match or beat frontier models alone (Sonnet 5.5, Opus 5.5;
the owner's bar is Opus 5.5 xhigh, D19) on real task success, at lower cost, with executable oracles and preregistered
held-out evaluation.

**Units.**

| Level | Unit | Why |
|---|---|---|
| Portfolio | **bed**: an independent source with its own harness, oracle and task population | Var(μ̂) ≈ τ²/B + v/T: for 480 tasks, SE 0.034 as 4 × 120, 0.029 as 8 × 60, 0.027 as 12 × 40 at τ = 0.05 [calc, methodology `meth-sims/calc_tables.py`]. Beds buy precision faster than tasks |
| Bed | **cluster**: template (WorkBench), scenario (AppWorld), user task (AgentDojo), task type × level (NaturalPlan), intent × subtask count × persona (τ²), instruction (SpreadsheetBench), family (factory) | WorkBench's design effect is about 5 at 10 instances per template [S-obs]; instances inflate n |
| Cluster | instance × run | Runs average out the 10–15% of tasks that flip between identical runs on AB [M, DEV60-A0-A1.md] |

**Axes of breadth**: domain, workflow shape, recurrence and horizon, arm (model; Foundry or not), host harness.

**Held-out classes** (every portfolio bed carries exactly one):

| Class | Meaning | Beds |
|---|---|---|
| H1 official-sealed | test items with no public answers, held by the benchmark owner | AppWorld test_normal |
| H2 fresh-generated | new instances from the benchmark's generator or ours, seed frozen before any arm runs | WorkBench regenerated, NaturalPlan via our generator, PlanBench regenerated, DABstep-fresh (our generator over Adyen's templates and data) |
| H3 fresh-authored | items written by a session that builds nothing, hashed before any arm runs | AgentDojo injection tasks we author (on public user tasks) |
| H4 public-static | public items and answers; possibly seen by every model, because no knowledge cut-off is published for Haiku 5.5, Sonnet 5.5 or Opus 5.5 [S-obs] | τ² telecom and simulated-user domains, BFCL, ToolHop, EnterpriseOps-Gym; SpreadsheetBench-912 (with a within-item hold-out of cases 2–3) |

H4 beds enter only with a clean memorization probe (§5.4); every pooled result is also reported without them.

**Claim ladder** (from the methodology sweep §2, adapted to D19): what evidence allows which sentence.

| Rung | Sentence allowed | Evidence |
|---|---|---|
| L0 | "Foundry lifts Haiku 5.5 on bed X" | per-bed paired lift; directional unless n_eff ≥ 130 |
| L1 | "On the declared portfolio, Haiku 5.5 in Foundry is non-inferior to Sonnet 5.5 alone within 10 points (pooled), at ≤ ½ its cost per verified success" | node A at B ≥ 8, with the assay-sensitivity label |
| L2 | "… and Foundry causes the gain" | node B (lift over Haiku alone) |
| L3 | "… and is non-inferior to Opus 5.5 xhigh within 10 points on the O-pool beds" | node C (≥ 5 beds with Opus at full depth) |
| L4 | "Not specific to Haiku or one host" | within-cell lift on ≥ 2 cheap models; ≥ 2 hosts × ≥ 3 beds, within-host comparisons only (not reachable this round, §3.3) |
| L5 | "Recurring families" | factory claim: ≥ 15 effective families (random effects) or ≥ 24 (sign test) |
| L6 | "Not a contamination artefact" | §5.4 checks pass; the H4-excluded and fresh-only analyses agree |

Words not allowed at any rung: "beats the frontier" without the superiority node; "general"; "SOTA"; a per-bed win
count as the headline. F-H results are never submitted as leaderboard entries (ROADMAP §4.3 [M]).

---

## 2. Where the evidence stands today

From the repo-coverage sweep (read-only, HEAD `73a8171e`, notes `breadth/coverage.md`), checked here against
`runs/DEV60-A0-A1.md`, `runs/DEVCHECK.md`, `PREREG-AB-v1.md` AM-10/11, the frontier amendment and decisions D18–D22 [M].

### 2.1 External beds

| Bed | Domain | Shape | Arms run (strict pass, K) | Class | Status 2026-10-21 |
|---|---|---|---|---|---|
| AutomationBench dev60 (devTrain, seed 21) | workplace SaaS, 47 simulated apps | one-shot multi-step tool use | Haiku alone 9/60; Haiku + A1 18/60; + A1-C 20/60; **Sonnet alone 20/60**; Sonnet + A1 28/60; Mercury-planner/checker + Haiku acting 29/60; Mercury alone 2/60 (official loop, step cap); Haiku and Sonnet rows under the date note, K = 1 | dev, in-sample for A1-C | [DEV60-A0-A1](../automationbench-20261014/runs/DEV60-A0-A1.md) [M] |
| AutomationBench devCheck (60 hold-back) | same | same | Haiku alone 13/60 and 15/60; A1 20/60; A1-C 20/60; **Sonnet alone 23/60** | dev hold-back, 2 of 3 looks used | DEVCHECK.md lacks the second A0 run and the Sonnet row [S-obs] |
| AutomationBench AB-v1 test (266 unburned of 300) | same | same | none | sealed, **not run** | harness-freeze addendum (§15) unwritten; planned 10-23; AM-10/11 let the owner's "whichever works best" pick the headline model; the D19 Opus amendment covers dev only [M] |
| SOP-Bench phase 2 (1,693 sealed rows) | 12 regulated SOPs | build once per SOP, run many rows | W-H (Haiku-built workflow) vs A-H (Haiku agent), k = 3; **no Sonnet or Opus arm** | sealed, running | halted once on `MODEL_RATE_LIMIT` (20:32Z) [S-obs] |
| τ²-bench @`57e54143` | telecom, banking, airline, retail | policy dialogue | none | pinned, inert | [ACQUISITION](../tau2-20261021/ACQUISITION.md) [M] |
| WorkBench, AgentDojo, AppWorld, BFCL-MT, NaturalPlan, SpreadsheetBench, ToolHop, NESTFUL | various | various | gold replay and floors only | $0 probes, deleted | [DISPOSALS](DISPOSALS.md) [M] |

### 2.2 Own beds (Claude-written) with paid arms

records (P1, the one preregistered held-out result: Haiku workflow 35/36 vs Sonnet one call 28/36), codefix and incident
(no headroom at d3–d5), kinetics (JIT streams, K = 1), W-bed (Haiku one call only), E8 (agent-H 10/14, + validator 12/14;
Opus one-shot builder 27.5%), COMP-1 (inconclusive), OT-0 (frontier agent arms void after the session limit), BUILDER-1
(Haiku + templates 18/21, Mercury + templates 18/21, same author). Built at $0 with **no model ever run**: the 12 AB-R
recurring families, synth, gridquest, gameqa, runbook, ownerci, E7 [S-obs, coverage.md §1].

### 2.3 What this says

- External domains with paid evidence: **2** (workplace SaaS; regulated procedures). Frontier-alone held-out evidence:
  **none**. Hosts: **one** (Claude Code headless, CLI 2.1.295–2.1.306). Models on external beds: Haiku 5.5, Sonnet 5.5,
  Mercury 3; Opus 5.5 on none.
- The dev lift of Sonnet over Haiku alone on AB is 13–18 points (dev60 9 → 20; devCheck 13–15 → 23): **the same size as
  the planned margin δ = 0.10**. A non-inferiority result against Sonnet means little unless Foundry also lifts Haiku
  (node B) and the bed shows a frontier premium (the assay-sensitivity label, §8).
- About $350 list price of recorded experiment calls in total, about $42 of it on external beds [S-obs]. Six usage-limit
  stops recorded (10-06/07, 10-08, 10-09, 10-15, 10-21 twice) [S-obs].

---

## 3. Target coverage matrix and holes

### 3.1 Domain × shape

Shapes: **S1** typed judgment; **S2** short multi-step tool use (≤ 10 steps); **S3** long horizon (≥ 20 steps or many
apps); **S4** policy-bound dialogue; **S5** construct once, run many; **S6** recurring stream with cross-trigger state and
clocks; **S7** untrusted input and control-flow integrity; **S8** saga, compensation, faults; **S9** async, time,
ambiguity; **S10** intent recovery from a messy request.

Codes: **own** = Claude-written bed with paid dev arms; **own-B** = built at $0, never armed; **ext-dev**, **ext-seal** =
external dev or sealed evidence; **1–12** = portfolio bed number (§4); **F** = factory family (§6); **—** = hole.

| Domain | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Workplace SaaS | — | ext-dev (AB), **1** | — | — | **1** (template reuse) | own-B (AB-R ×12) | — | — | — | own (BUILDER-1) |
| Assistant under prompt injection | — | **2** | — | — | — | **2** (task × injections) | **2** | — | — | — |
| Scheduling, formal planning | — | — | — | — | **3**, **8** | — | — | — | — | — |
| Customer-service policy dialogue | — | — | **4** (up to 9 subtasks) | **4**, **10** | 4 (per-intent reuse) | — | — | — | — | — |
| Personal multi-app assistant | — | **5** | **5** | — | **5** (scenario variants) | — | — | — | — | — |
| Function calling, API composition | — | **6**, **9** | 6 (long_context) | — | sub (NESTFUL) | — | — | — | — | — |
| Office documents, spreadsheets | — | — | — | — | **7** | — | — | — | — | — |
| Payments data analysis | — | **11** | — | — | 11 (per-template reuse) | — | — | — | — | — |
| Enterprise ITSM / HR / CSM | — | **12** (laptop) | **12** | — | — | own-B (E7), **F** itsm-queue | — | — | — | — |
| Order, commerce, ERP | — | own (E8) | own (E8) | — | own (E8 builds) | own (OT-0) | — | own (E8) | — | own-B (SPEC-0) |
| Regulated procedures | ext-seal (SOP) | ext-seal | — | — | ext-seal (SOP W-H) | **F** reg-incident-clock | — | — | F (statutory clocks) | — |
| Finance, AP, audit | — | ext-dev (AB finance) | — | — | — | own-B (apintake, receipts), **F** p2p-audit | — | — | — | — |
| Synthetic structure, science, SRE, CI | own (records, kinetics, incident, codefix) | own | own (W-bed R5–R6) | — | own (records P1) | own (JIT streams) | — | own (W-bed R8 faults) | — | — |

### 3.2 Arms × beds (portfolio)

Arms: **A-H** Haiku 5.5 alone; **F-H** Haiku 5.5 + Foundry; **A-S** Sonnet 5.5 alone; **A-O** Opus 5.5 xhigh alone
(full = at comparator depth; anchor = 20 tasks unless the measured meter draw allows full depth); **F-S** Sonnet + Foundry
(optional control); **F-HM** Mercury 3 planner/checker + Haiku acting (conditional, 2 beds); **pub** = published
per-task frontier results (screening only, never an arm).

| # | Bed | A-H | F-H | A-S | A-O | F-S | F-HM | pub |
|---|---|---|---|---|---|---|---|---|
| 1 | WorkBench | ✓ | ✓ reuse | ✓ | full | optional | ✓ | 24 models per task (Haiku 4.5 74.8%, Sonnet 4.6 88.3%, Opus 4.8 96.2%) [S-obs] |
| 2 | AgentDojo | ✓ | ✓ reuse | ✓ | full | optional | ✓ | 2025 results page (Claude 3.x) [S-obs] |
| 3 | NaturalPlan | ✓ direct | ✓ build | ✓ direct | full | — | — | 2024 paper only |
| 4 | τ² telecom solo | ✓ K=3 | ✓ reuse | ✓ K=3 | anchor | — | — | stale board |
| 5 | AppWorld | ✓ | ✓ reuse | ✓ | anchor | — | — | board: Opus 4.6/4.7, gpt-5.6-luna, Qwen3-14B RL |
| 6 | BFCL-MT | ✓ | ✓ live | ✓ | full | — | — | CSV: Haiku 4.5 53.6, Sonnet 4.5 61.4, Opus 4.5 68.4 |
| 7 | SpreadsheetBench-912 | ✓ | ✓ build | ✓ | full | — | — | site top 70.48% (model unnamed) |
| 8 | PlanBench | ✓ direct | ✓ build | ✓ direct | full | — | — | README (2024–25 models) |
| 9 | ToolHop | ✓ | ✓ live | ✓ | full | — | — | HF leaderboard (rows not read) |
| 10 | τ² simulated-user | ✓ | ✓ reuse | ✓ | anchor | — | — | tau3-Banking board |
| 11 | DABstep-fresh | ✓ | ✓ reuse | ✓ | full | — | — | HF Space (not read) |
| 12 | EnterpriseOps-Gym | ✓ | ✓ live | ✓ | anchor | — | — | paper: Opus 4.6 45.9%, Sonnet 4.6 42.2% |

Open-weight: no arm (no GPU route; local Qwen/Granite parked after a negative CPU screen [M]). AppWorld's board has
AgentRL + Qwen3-14B at 86.9 / 67.6 TGC against Opus 4.6 at 91.1 / 72.4 (test_normal / test_challenge) [S-obs]: context
for the thesis, never a result of ours.

### 3.3 Hosts

| Host | Where | Status | Role this round |
|---|---|---|---|
| Claude Code headless (`claude -p`, policy flags, `--strict-mcp-config` with the bed facade) | this container | installed, 2.1.306 [M] | every arm of every portfolio bed except bed 12 |
| Claude Code interactive + Foundry MCP | owner's laptop | available | host study (week 2–3) |
| Cursor, Codex (D9 order: Claude Code, Cursor, Codex) | laptop | owner's accounts; not installed here [M] | host study |
| OpenCode | laptop | allowlisted v2.0.5; repo route uses free models only [M] | host study |

The host study is within-host only: host's own model alone versus the same + the Foundry MCP server, on beds 1, 2 and
6 through the facade, 30 tasks per bed per host (descriptive). A host claim (L4) needs ≥ 2 hosts × ≥ 3 beds × n_eff 60 and
a host-by-treatment τ whose interval lies within 0.05 (methodology §8; Exgentic reports architecture swings of up to 12
points [doc]); it is not reachable this round.

### 3.4 Holes left after Tiers 1–3

- **S9 async, time, ambiguity, external**: none. Gaia2/ARE is the only candidate and part of its verifier is LLM-judged
  [S-obs]; the factory's statutory-clock family covers time in our own world.
- **S8 compensation and faults, external**: none with an executable oracle; E8 stays own-bed evidence. BPO-Bench's fault
  catalogue (Apache-2.0) feeds runtime-fault injection only.
- **Long-horizon recurring streams (quarter, year)**: factory horizon ladder H3/H4 only.
- **Multi-actor approvals, external**: none runnable under D16; ERP-Bench (Odoo images ≈ 861 MB) needs an owner decision.
- **SWE at scale, browser/GUI, creative/media, health and legal beyond SOP rows**: not in this round (D16 sizes,
  accounts, or LLM judges).
- **Hosts other than Claude Code; open-weight models; Mercury beyond two beds** (D18 allowance): partial or none.

---

## 4. Candidate scoring and the tiered portfolio

### 4.1 Rubric

| Criterion | Scale |
|---|---|
| **V** oracle validity | 3 = executable, deterministic, $0 gate passed by a sweep; 2 = executable, gate partly done or one known defect with a fix; 1 = executable but weak (keyword match, partly LLM-judged); 0 = LLM judge or similarity metric |
| **R** local runnability under D16 | 3 = under 500 MB, no Docker, no accounts, probed; 2 = runnable here, not yet probed; 1 = laptop Docker under 1 GB; 0 = accounts, hosted instances or over-cap images |
| **L** licence | ok (MIT/Apache/CC BY), NC (research only, per-row results out of git), ? (unstated) |
| **C** held-out class | H1–H4 (§1) |
| **n** poolable | clusters ≥ 20 and n_eff ≥ 60 reachable (methodology §10); "desc" = descriptive only |
| **$** sealed cost, recommended design | all arms, list price [calc, §10] |
| **E** adapter effort | engineer-days on top of the shared facade |
| **G** coverage gain | 0–3 hole cells of §3.1 filled that nothing else fills |

### 4.2 Scored candidates

| Candidate | V | R | L | C | n | $ sealed | E | G | Decision |
|---|---|---|---|---|---|---|---|---|---|
| WorkBench @`49c7dfd` | 3 (gold 690/690; floor 124/690; digest stable) | 3 (131 MB) | MIT | H2 if regeneration is seedable, else H4 | 40 templates | 58 | 1 | 2 | **Tier 1, bed 1** |
| AgentDojo 0.1.35, v1.2.2 | 2 (utility gold 97/97; injection gold 27/35 in one pairing probe) | 3 (166 MB) | MIT | H3 on H4 | 58 user tasks | 84 | 1.5 | 3 | **Tier 1, bed 2** |
| NaturalPlan | 2 (calendar exact-match defect, fix specified) | 3 (50 MB) | Apache-2.0 / CC BY 4.0 | H2 via our generator, else H4 | ≈ 27 | 28 | 1–2 | 2 | **Tier 1, bed 3** |
| τ² telecom solo @`57e54143` | 2 (ENV_ASSERTION; gate not run) | 2 (pinned; venv not built) | MIT | H4; v2.0.0 replaced 50 base tasks | ≈ 34 cells | 240 | 3 | 3 | **Tier 1, bed 4** |
| AppWorld 0.1.3.post1 | 3 (gold 147/147, null 0/147 on train+dev) | 3 (366 MB) | Apache-2.0 + encryption and no-look terms | **H1** | 56 scenarios | 394 | 2–3 | 3 | **Tier 2, bed 5** (starts this week) |
| BFCL v4 multi-turn | 3 (gold 800/800, null 0/800) | 3 (106 MB, `--no-deps`) | Apache-2.0 | H4 | ≈ 40 | 97 | 1–1.5 | 1 | **Tier 2, bed 6** |
| SpreadsheetBench-912 | 2 (floors measured; evaluator fixes specified) | 3 (96 MB + openpyxl) | CC BY-SA 4.0 | H4 + within-item hold-out | 60 instructions | 166 | 2–3 | 2 | **Tier 2, bed 7** |
| PlanBench (regenerated, obfuscated) | 2 (VAL; build untested, flex missing) | 2 | MIT (VAL BSD-3) | H2 | ≈ 27 | 15 | 2 | 1 | **Tier 2, bed 8** |
| ToolHop | 2 (exact match; Direct scenario = leakage control) | 3 (20 MB) | Apache-2.0 | H4 | 80 domains | 58 | 1 | 1 | **Tier 2, bed 9** |
| τ² banking_knowledge (BM25) + airline (`--communicate-scorer substring`) | 2 (DB hash / ACTION; substring COMMUNICATE) | 2 (shares the τ² venv) | MIT | H4 | ≈ 30 | 183 | +1.5 on the τ² adapter (user simulator) | 1 | **Tier 2, bed 10** (no solo mode: Haiku 5.5 as a fixed user simulator for every arm) |
| DABstep-fresh (own generator + solver) | 2 once the N-version gate passes | 3 (24 MB context) | CC BY 4.0 | H2 (own generator over external templates and data) | 40 templates | 144 | 3 | 2 | **Tier 2, bed 11** |
| EnterpriseOps-Gym csm + itsm + hr | 2 (SQL verifiers 102/102 in 13 samples; `response_check` exists) | 1 (Docker; no daemon here) | Apache-2.0 | H4 (public split) | ≈ 40 | 313 | 3–4 | 2 | **Tier 2, bed 12** (laptop, OD-7) |
| NESTFUL | 3 (execute and compare) | 3 | Apache-2.0 | H4 | ≥ 20 | ≈ 20 | 1 | 0 | substitute 1 (also need-router negative control; may fail the assay screen) |
| DS-1000 (887, no TF/PyTorch) | 3 | 3 (uv dry-run: 18 wheels, no source builds) | CC BY-SA 4.0 | H4, high | ≥ 20 | ≈ 10 | 1 | 1 (data science) | substitute 2 (likely saturated) |
| SpreadsheetBench V2, non-chart subset | 2 (chart tasks VLM-judged: excluded) | 2 (134 MB) | MIT (card) | lowest risk (Sept 2026) | ? | ≈ 150 | 2–3 | 0 | substitute 3 (same source as bed 7) |
| AgentArch | 2 (strict argument oracle) | 3 (2 MB) | Apache-2.0 | H4 | **2 use cases** | — | 1 | 0 | descriptive only (G = 2) |
| ITBench-Lite CISO + FinOps | 2 (OPA eval; truth in folder) | 3 (14 MB + `opa`) | Apache-2.0 | H4 | 30 tasks | — | 1 | 1 | descriptive only (n = 30) |
| TaxCalcBench TY24 | 3 (engine output) | 2 (sparse clone) | MIT | **answers in repo**; a published run copied them | 51 | — | 2 | 1 | descriptive dev-only; the one bed with published Haiku/Sonnet/Opus 5.5 numbers [doc] |
| MCPMark local (FS 30, Postgres 21) | 2 | 1–2 | Apache-2.0 | H4; near-saturated at the top | 51 | — | 2–3 | 0 | defer |
| LegalBench | 2 | 3 | per task | H4, high | — | — | 1 | 0 | typed-judgment axis only |
| MCPGen-25 | 2 | 2 | **no LICENSE** | low | 25 | — | 2 | 0 | diagnostic only |
| BPO-Bench | 1 (keyword oracle) | 3 | Apache-2.0 | H4 | — | — | 1 | 0 | fault catalogue only |
| Gaia2 / ARE | 1 (soft checks LLM-judged) | 2 | MIT / CC BY 4.0 | validation H4; test H1 (Meta) | — | — | 4–5 | 2 (S9) | defer until a deterministic judge substitute exists |
| ERP-Bench (Anchor) | 3 (CP-SAT-certified verifier) | 1 (≈ 861 MB images) | CC0 per metadata, no LICENSE | H2 (`generate-tasks`) | 29 patterns | — | 4 | 2 | owner decision (OD-12) |
| Spider2-DBT | 3 | 0 (1.06 GB zips) | MIT | H4 | 68 | — | 4 | 2 | owner decision (OD-12) |
| ToolSandbox, TravelPlanner, FlowBench-EMNLP, WorFBench, TaskBench, WorkflowBench, Chat2Workflow | 0–1 (simulator, similarity or judge scoring) | — | — | — | — | — | — | — | not adopted (CR-6: similarity is never success) |
| Excluded under D16 or oracle rules | MCP-Atlas (1,021.6 MB image, judge), LiveMCPBench (6.3 GB), MCP-Bench and MCP-Universe (live keys or services), ComplexFuncBench (RapidAPI, judge), WebArena-Verified and VisualWebArena (1.2–22 GB images), Toolathlon (accounts), CRMArena/-Pro (live Salesforce orgs), WorkArena (ServiceNow instances), TheAgentCompany (30+ GB), ITBench SRE/live (31 GB / kind cluster), EnterpriseBench (judge), Spider2 full, FinanceBench (1.26 GB clone, LLM-graded), MedAgentBench (1.84 GB image), CHI-Bench (gated data, Opus judge; its harness-matrix protocol is adopted) [S-obs] | | | | | | | | recorded in DISPOSALS |

### 4.3 Tier 1: adopt this week

Selection: coverage gain per dollar among beds that run here today and can be held out. Each gets the shared facade
(§5.1), the $0 gate (§5.3), a dev pilot, the assay and headroom screens, and one sealed run under the preregistration.

**T1-1 WorkBench** (https://github.com/olly-styles/WorkBench @`49c7dfd00c03d384ec59ea57374f50b766aa5613`, MIT, read
2026-10-21 by two sweeps).
- *Split.* Templates are clusters. Within each domain, order templates by `sha256('breadth-wb-v1:' + template_id)`; the
  first round(0.42 · n) are dev: 5/5/4/3/3/9 of 12/11/9/8/8/21 (analytics, calendar, email, CRM, project management,
  multi_domain) = 29 dev, 40 held out. Sealed: **3 regenerated instances per held-out template** (120), seed frozen in
  the preregistration.
- *Gate still to do.* Seed control of `workbench-generate-data` (unseeded upstream [S-obs]); regenerated instances pass
  gold replay 100% with a stable digest twice; three more mutation operators (wrong argument, extra write, duplicate
  write; only drop-last was tested, 566/568 killed). If regeneration fails: shipped instances 1–3 of held-out templates,
  relabelled H4.
- *Outcome.* Official `is_correct`; harmful side-effect rate secondary; the 18.0% do-nothing floor cancels in paired
  differences; the state-changing subset is also reported.
- *Foundry mode.* F-reuse along each template's instance stream (§5.2).
- *Parity anchor.* Haiku 4.5 through our A-H harness on 40 shipped instances of dev templates, compared task by task with
  the published Haiku 4.5 verdicts (≈ $3): a harness check, never an arm.
- *Why first.* A free per-task frontier baseline for 24 models; Haiku 4.5 is perfect on 27/69 templates, below 50% on 15
  and at 0% on 3, and 55.7% on multi_domain with 82 side effects [S-obs].

**T1-2 AgentDojo** (https://github.com/ethz-spylab/agentdojo, PyPI 0.1.35, benchmark v1.2.2, MIT).
- *Units.* (user task, condition), condition ∈ {benign, injection 1, injection 2}; cluster = user task.
- *Split.* 97 user tasks ordered by hash within suite: 39 dev (F-kit development with the 35 public injection tasks),
  58 held out. Sealed: 58 × 3 = 174 units. The sealed injection tasks are **new**, about 3 per suite, written by a session
  that builds nothing, hashed before any arm runs, each validated fail-to-pass by a scripted agent.
- *Gate still to do.* Resolve the 8 workspace injection tasks that did not register in the single-pairing probe.
- *Outcome.* Success = utility true and, under attack, security holds. Utility, utility under attack and targeted ASR
  secondary.
- *Arms see only facade tools* (no Bash, no network): the text is adversarial by design (THESIS D10 exception, OD-2).
- *Why.* The only external test of THESIS P9 (control flow fixed before untrusted data is read). Foundry's claim here is
  matched utility under attack with ASR near 0 by construction.

**T1-3 NaturalPlan** (https://github.com/google-deepmind/natural-plan; Apache-2.0 code, CC BY 4.0 data; sha256 trip
`15c4755d…`, meeting `cabd5537…`, calendar `3f34ff27…` [S-obs]).
- *Clusters.* Task type × complexity level (≈ 27).
- *Sealed.* 10 instances per cluster (≈ 270) from **our generator**, admitted by a faithfulness gate (per-level
  constraint counts within 10% of the public set; every instance solvable; trip unique by construction). If it fails:
  public instances outside the dev sample plus a paraphrased format-drift copy, class H4.
- *Oracle fix.* Calendar exact match replaced by a feasibility checker (403/1,000 instances have more than one feasible
  slot, 227 with no stated tie-break [S-obs]); gate: agrees with golden on uniquely solvable instances 100%, accepts every
  feasible alternative, rejects infeasible mutants.
- *Arms.* A-H, A-S, A-O: one direct call each with the official 5-shot prompt. F-H: Haiku builds a parser + solver once per
  task type on dev instances with dev oracle feedback, **5 independent lineages per type** (≈ $1 each), frozen; held-out
  execution makes no model call or only narrow parse judgments.
- *Caveat.* F-H variance is dominated by build variance across 3 task types; the analysis adds a between-lineage
  component (PREREG §5.1).

**T1-4 τ²-bench telecom, solo mode** (https://github.com/sierra-research/tau2-bench @`57e54143`, v2.0.0, MIT; pinned in
`corpus/tau2-bench`).
- *Mode.* `--agent llm_agent_solo --user dummy_user` (both registered at the pin [M]): no user simulator, so no simulator
  variance; reward = environment assertions (+ ACTION on 32 tasks).
- *Structure* [M, `data/tau2/domains/telecom/tasks.json`, ids]: 2,285 tasks over 3 intents (mms 1,984, mobile data 254,
  service 47) and 21 intent × subtask-count cells (1–9 subtasks); official split train 74 / test 40.
- *Split.* Dev = the official train split. Sealed = the official test split (40) + 60 tasks from the pool outside train
  and test, at most 3 per intent × subtask-count × persona cell (the paper's own sampling rule [S-obs]). Cluster = that cell.
  Tasks in the v2.0.0-replaced set are flagged for the fresh-vs-public contrast.
- *K = 3 for every arm* (pass^3: the reliability bed). Subtask count gives a free horizon covariate (§8, dose-response).
- *Adapter.* A custom registered agent that calls the model route, or the Gymnasium `AgentGymEnv` [M]; litellm pinned
  below 1.82.7 [S-obs]. Network-off except the model route.

**Started this week as the first Tier-2 bed: AppWorld** (https://github.com/StonyBrookNLP/appworld, PyPI 0.1.3.post1, data
0.1.0 sha256 `fd9f9608…8250` [S-obs]).
- *Split.* Official. F-kit development on train (90) + dev (57) only. Sealed: **all 56 test_normal scenarios**, scenario
  ids ordered by hash without opening content. Haiku arms on all 3 variants (168 tasks; F-reuse across variants; SGC
  defined); comparators on 2 hash-chosen variants per scenario (112). test_challenge untouched (confirmatory reserve).
  Released counts are 732 ids, not 750 [S-obs].
- *Gate still to do.* Determinism (two runs, identical digest) and side-effect mutants (repeat-last-write, extra field,
  touch-other-record; Abrich found two AppWorld templates where repeating the last write passed [S-obs]).
- *Terms.* No looking into or tuning on test; per-task test results out of git; encrypted data never redistributed.
- *Cost gate.* The dev pilot measures $/task and meter draw; AppWorld's projected sealed cost is ≈ $394 with A-O as a
  20-task anchor [calc]. The wheel has no MCP server (that is on unreleased main); the facade wraps the in-process API.

### 4.4 Tier 2: declared order after Tier 1

The preregistration fixes this order. A bed is skipped only for a $0 gate failure, a D16 failure, a failed assay or
headroom screen, or a cost-gate failure, recorded before any paid sealed run on it; the next substitute then takes its
place. The first six beds span six domains and include a long-horizon bed (methodology §6.2).

| Order | Bed | Held-out | Foundry mode | Note |
|---|---|---|---|---|
| 5 | AppWorld test_normal | H1 | F-reuse (variants) | §4.3 |
| 6 | BFCL v4 multi-turn (base, miss_func, miss_param, long_context) | H4 + probe | F-live | 160 entries, 40 per category; Haiku 4.5 parity anchor against the leaderboard CSV; web_search and memory-vector excluded |
| 7 | SpreadsheetBench-912 | within-item (cases 2–3) | F-build per instruction | 60 instructions with 3 cases, excluding the 67 an unchanged workbook passes; **every arm sees the instruction plus case 1's input and answer workbook**; fix `evaluation.py` (scores inputs, hard-codes `range(3)`, 5 malformed `answer_position` strings) |
| 8 | PlanBench (Blocksworld, Logistics, Depots × plain, mystery, randomized) | H2 (regenerated) | F-build (one generic planner per domain family, 5 lineages) | VAL build (needs flex) or a pure-Python validator parity-tested against VAL verdicts on the shipped plans |
| 9 | ToolHop | H4 | F-live | 80 domains × 2 queries; the Direct (no-tool) scenario is run by A-H and A-S as the leakage control; dataset Python runs in our sandbox |
| 10 | τ² banking_knowledge (BM25) + airline (`--communicate-scorer substring`) | H4 | F-reuse per intent | **user simulator = Haiku 5.5, pinned prompt, identical for all arms** (the official simulator is `openai/gpt-5.5`: not comparable with the board); grouped with bed 4 as one source in a sensitivity analysis |
| 11 | DABstep-fresh | H2 (own generator) | F-reuse per template | build the fee-rule solver at $0; admit only if it agrees with the 10 dev answers and ≥ 99% of the 450 recovered test answers on the templates used, every disagreement explained; mint 3 new parameterizations per template |
| 12 | EnterpriseOps-Gym csm + itsm + hr | H4 | F-live | laptop Docker (OD-7); only tasks with no `response_check`; prompts under 100K tokens (Haiku price cliff) |
| sub 1 | NESTFUL | H4 | F-build (call DAG) | also a need-router negative control; may fail the assay screen |
| sub 2 | DS-1000 | H4 | F-live | likely saturated |
| sub 3 | SpreadsheetBench V2, non-chart | H4 (Sept 2026) | F-live | same source as bed 7: grouped in sensitivity |

### 4.5 Tier 3: family factory targets and fresh-instance generators

- Factory families (§6): `abr-reg-incident-clock`, `abr-itsm-queue`, `abr-p2p-audit`, then `abr-erp-dunning` (Tryton,
  when OT-1 starts under D4).
- Generators that turn H4 beds into H2: WorkBench regeneration (bed 1), NaturalPlan generator (bed 3), PlanBench
  generators (bed 8), DABstep solver (bed 11), AgentDojo injection authoring (bed 2), a τ² telecom composition check
  (`src/tau2/domains/telecom/tasks/manager.py` [M]: can it compose tasks outside the public 2,285?).

---

## 5. Shared infrastructure

### 5.1 Bed-to-MCP facade (one adapter per bed, every host)

`experiments/breadth/facade/` (to be written; Node ESM, stdio MCP server; the Python bed runs in its own pinned venv
outside the repo).

| Piece | What it does |
|---|---|
| `tools` | the bed's tool registry as MCP tools (WorkBench's 26 functions; AgentDojo suite tools; AppWorld `execute(code)` plus API docs lookup; τ² tools; file and sandboxed-Python tools for SpreadsheetBench and DABstep) |
| `reset(task, seed)` / `snapshot()` | fresh world per task; snapshots for grading and for F-reuse fallbacks |
| `grade()` | host-side only, a separate process, reading snapshots; never exposed as a tool; verdicts written to a host-only directory |
| network | the bed process runs under `unshare -rn`, as the sweeps probed [S-obs]; models reach only the model route |
| arms | A-H / A-S / A-O: `claude -p` with `--strict-mcp-config` and only the facade server; F-H: the facade plus the Foundry MCP server |
| meter | every session runs with `--output-format stream-json`; the runner records each `rate_limit_event` (5-hour and 7-day utilisation, one meter for all models, resolution 0.01 [M, `research/jit-20261008/analysis/quota-meter/README.md`]) before and after the session |

Hosts on the laptop attach the same server (`claude mcp add-json`, `codex mcp add`, Cursor and OpenCode MCP config).
About 2 engineer-days once, then about 0.5 day per bed [S-obs estimate]. The AB bridge and the SOP-Bench mailbox are the
working precedents [S-obs].

### 5.2 F-kit v1: what the Foundry arm is

One Foundry arm per bed, frozen by hash before the sealed run. Bed-agnostic core, per-bed card.

1. **Architect: Opus 5.5.** Bed-agnostic skeletons in the A1-C lineage (discover → requirement ledger → plan → act →
   verify) as typed workflows with narrow `agent`, `code` and `verify` nodes. Per bed, Opus writes a *bed card* from public
   docs, the tool schema and dev tasks only (≤ $5 per bed). Architect and executor models are reported separately
   (AGENTS.md).
2. **Construct and execute: Haiku 5.5.** For each task Haiku fills the template through Foundry's construct, validate
   and run tools. A trivial workflow (one agent node) is allowed: "the best workflow may be none" (THESIS §1).
3. **Gating acceptance.** A run whose own `verify` fails ends as a failure, not a pass.
4. **F-reuse** (beds 1, 2, 4, 5, 10, 11). After a run whose own verification passes, the workflow is kept for that
   cluster; the next instance passes a typed applicability gate (Haiku) and runs the kept workflow; a refusal or a runtime
   deopt falls back to construction. **No oracle feedback on sealed instances.** Three lineages = three random stream orders.
5. **F-build** (beds 3, 7, 8). Built once per cluster type on dev instances (case 1 for SpreadsheetBench) with oracle
   feedback, frozen, executed on held-out instances. Five lineages per type where types are few (NaturalPlan,
   PlanBench); three per instruction on SpreadsheetBench.
6. **F-live** (beds 6, 9, 12). Construction per task, no cross-task reuse (no natural cluster stream).
7. **Budgets.** Same per-task turn and token caps as A-H; construction and verification cost charged to the task where
   they happen; F-build construction amortized over the held-out instances it serves; prompts under 100K tokens (Haiku's
   price rises to $0.50 / $2.50 per MTok above it [M, `policy/models.json`]).
8. **Dev discipline.** Kit iteration on dev splits only; ≤ 3 looks at a dev hold-back per bed; ≤ $15 of F-H dev spend per
   bed; comparator dev arms run once and are cached by (split, model, effort, harness hash, CLI version) [methodology
   lever 7].
9. **Engine.** All sealed runs of the portfolio use one named engine freeze (ROADMAP §6 rule 13). Foundry development
   continues on branches; nothing merges into the frozen tag under a running bed.

**Effort levels.** A-H and F-H: Haiku 5.5 at `high` (the setting of every existing Haiku number). A-S: Sonnet 5.5 at
`high` (the AB A0-S/A1-S setting). A-O: Opus 5.5 at **`xhigh`** (D19). One dev look per bed family may test Haiku at
`max` (OPERATING-PRINCIPLES §7 names "Haiku 5.5 max for cheap implementation"); if it lifts A-H by ≥ 5 points at ≤ 2× cost
on two beds, both Haiku arms switch together before the freeze.

### 5.3 The $0 oracle-validity gate (every bed, before any paid call)

| Gate | Check | Blocks the bed if |
|---|---|---|
| BG-0 provenance | URL, revision, sha256, size, licence, date (D16); release and cut-off ledger row | anything missing |
| BG-1 gold replay | official gold actions or answers through the facade score 100%; gold length recorded per task (horizon covariate) | < 100% |
| BG-2 floors | do-nothing, constant-answer and replay agents scored | not reported; a floor above 10% makes the state-changing subset a co-headline |
| BG-3 mutation | ≥ 3 operators (drop, duplicate or extra write, wrong argument; side-effect operators where state is written), ≥ 95% killed | < 95% |
| BG-4 determinism | two runs give an identical digest | any difference |
| BG-5 judge-free | no LLM judge in the reward | judge present (deterministic substitute, or dev-only) |
| BG-6 alternative-valid answers | valid non-golden answers are accepted (NaturalPlan lesson) | valid answers rejected |
| BG-7 shipped defaults, malformed fields | evaluator reads model output, not inputs; every item parses (SpreadsheetBench lesson) | defect unfixed |
| BG-8 leakage | gold, sealed manifests and verdicts unreachable from arm workdirs (a test asserts it) | any path reachable |
| BG-9 ABC map | the bed's row of the Agentic Benchmark Checklist (T.1–T.10, R.1–R.13) filled, incl. trivial-agent results | missing |

Status [S-obs]: WorkBench BG-1/2/4 done, BG-3 one operator; AppWorld BG-1/2 on train+dev; BFCL-MT BG-1/2; AgentDojo
BG-1/2 for utility, security unresolved; NaturalPlan evaluators reproduce the paper but BG-6 fails on calendar;
SpreadsheetBench BG-2/6/7 found defects; τ², PlanBench, ToolHop, DABstep-fresh, EnterpriseOps-Gym not started.

### 5.4 Contamination and leakage controls

Direction of bias (methodology §7.1): pretraining memorization favours the larger models, so it makes non-inferiority
*harder* (conservative); Opus-written templates and bed cards, kept workflows, and dev-set tuning favour F-H
(anti-conservative). The controls aim at the second group first.

1. **Memorization probe, with power.** ≥ 100 dev items per bed; Haiku 5.5 and Sonnet 5.5 get the task text with no tools
   or world and are asked for the gold actions or answer; exact one-sided binomial test against the floor at 0.05. At
   n = 100 the 80%-power detectable excess is +7.3 points over a 5% floor and +10.4 over WorkBench's 18% [calc,
   methodology §7.2]. A flagged H4 bed is not admitted; a flagged H1–H3 bed is admitted with the flag. About $2–11 per bed.
2. **Fresh vs public, as a pooled difference in differences.** Where both exist (WorkBench shipped vs regenerated;
   τ² v2.0.0-replaced vs unchanged; NaturalPlan and PlanBench public vs generated), per arm gap = success(public) −
   success(fresh); signal = pooled (gap F-H − gap A-S), one-sided against 0.05, ≥ 60 items per side per bed. The bare
   "10-point drop" rule of revision 1 false-flags 18% of arm-beds at n = 40 per side [calc].
3. **Library leakage scan** of F-kit templates, bed cards and kept workflows for literals of sealed items (hashed
   n-grams); a hit voids that lineage on that bed.
4. **No network and no benchmark files** in the arm sandbox; TaxCalcBench shows why (a published run copied expected
   outputs from GitHub [S-obs]).
5. **Log audit of every sealed run** (HAL found an official τ-bench scaffold shipping test examples only by reading logs
   [doc, arXiv 2510.11977]): scripted greps for the benchmark name, HuggingFace, repository URLs and gold file names over
   every transcript as it is written; a reader session reads all failures and a random 10% of passes. An LLM may flag,
   never score. No bed result is final before its audit.
6. **H4 sensitivity**: every pooled result also without H4 beds.

### 5.5 Disk, installs and run data

Disk free at writing: **3.0 GB** of 252 GB [M, `df -h /`]. D16 caps installs at 500 MB each and 1.5 GB in total.

| Stage | Installs live at once | Approx. MB |
|---|---|---|
| Week 1 | WorkBench 131, AgentDojo 166, NaturalPlan 50, τ² venv (est. 300–500; repo already in `corpus/`), AppWorld 366 | ≈ 1,010–1,210 |
| Week 2 | AppWorld (until its run ends), BFCL 108, SpreadsheetBench 175, PlanBench (est. < 100), ToolHop 20; Tier-1 installs deleted after their sealed runs | ≈ 770–870 |
| Week 3 | τ² venv (bed 10), DABstep 24, AppWorld deleted | ≈ 350–550 |

**Run data is the larger problem.** Raw transcripts of every session of the recommended design would be about 11.5 GB
(13,420 sessions at 0.05–3 MB each; AB sessions measured 0.4–1.05 MB [S-obs]); gzip gives about 1.0 GB [calc,
`plan2/cost2.txt`]. Rule (**audit-on-write**): each transcript is grepped by the log audit as it closes, then gzipped;
transcripts of failures, of the 10% audit sample and of all F-H runs are kept; other passing transcripts are deleted after
their hash, grep result and structured run record are journaled. Target ≤ 500 MB of breadth run data on disk at any time;
a bed whose run data would push free disk below 1 GB pauses. One install at a time; `df` before each; disposals recorded.

---

## 6. Family factory (Tier 3)

### 6.1 Why

The 12 AB-R families are 37,463 Python lines (generator 15,781; oracle 5,018; reference 3,866; controls 2,835; gates
5,284; harness 3,898); at most 24% is shared, `reference.py` shares 0 definitions, and `family.json` has 39 top-level keys
of which 22 are common [S-obs]. A review of two families today added +1,266/−211 lines of generic oracle fixes [S-obs].
On `abr-fin-apintake` the gates pass (reference 462/462, 1,968/1,968 mutants killed over 59 operators), yet the 23
one-defect controls pass 84–100% of triggers and 7 of 23 leave a clean week on 2 streams [S-obs]: per-trigger rates hide
defects, so **clean weeks, hard-requirement violations and clause-attributed accuracy** are the headline metrics.

### 6.2 Design (recurring-synthesis sweep §5, adopted; changes marked [I])

- **One spec, four artifacts.** `family.spec` (YAML: family, host, world and versioned tables, clocks, policy clauses and
  amendable ones, triggers with arrival processes, stories, traps, effects, invariants, need job, plugins) compiles to
  POLICY.md, generator + truth engine, oracle, observable-only reference and controls (Anchor, arXiv 2605.26321 [doc]:
  no-op 0/300, oracle replay 300/300).
- **N-version where it buys validity.** The truth engine reads latent state; the reference reads only tool-visible state;
  they share the spec, not code, and must agree on every dev stream.
- **Traps are metamorphic operators with a declared resolving clause**, kept only if they flip the truth or break a named
  control (SWE-smith's fail-to-pass rule, arXiv 2504.21798 [doc]). Operators: T-clock, T-drift, T-partial, T-conflict,
  T-retract, T-replay, T-burst, T-irrelevant (truth = no-op or escalate).
- **LLMs write the spec and the phrasebank once** (Opus spec ≈ $1–3; a phrase is admitted only if the reference and 2 of
  3 blind Haiku readers classify it as intended). Generation and grading are deterministic and $0. Real log rows never
  reach arms; only parameters cross (THESIS D10).
- **Pipeline** F0 source card → F1 spec (Opus) → F2 lint (answerability invariant, AutoGym [doc]) → F3 phrasebank → F4
  compile → F5 gates → F6 pilot → F7 freeze with a results-blind edit log (repair environment defects only, never because
  an agent failed) → F8 tiers T0 $0 / T1 ≈ $1 / T2 $5–8 / T3 ≈ $15 / T4 Opus ceiling on ≤ 4 families.
- **Adapters** A1 log-calibrated stream (UCI incident log, NYC 311, BPI), A2 clean population + injected violations
  (ProcureChange), A3 statute-derived clocks (GDPR, NIS2; `holidays` 0.107), A4 ERP-executed (Tryton N-version), A5
  CP-SAT-certified, A6 schema-seeded (AWM-1K), A7 public-task-grounded (today's AB-R).
- **Host neutrality** [I]: factory families run on the AutomationBench host today; the spec's `host` field also targets a
  `sqlite-mcp` host so a family can be served through the facade of §5.1.

### 6.3 Oracle-validity gates (block a family; all $0 unless priced)

| Gate | Check | Bar |
|---|---|---|
| G0 spec lint | every trap has a resolving clause; resolving inputs reachable; every effect has a predicate; every clause exercised | no miss |
| G1 determinism | identical hashes for world0, triggers, truth, end; round trip | identical |
| G2 **solvability** | observable-only **reference** passes every trigger and week on practice and dev streams | 100% |
| G3 necessity | removing any effect or clause makes the oracle fail somewhere | no decorative clause |
| G4 generator–reference agreement | same effect signatures on every dev stream | 100% |
| G5 **triviality attack and controls** | null passes exactly the no-op share; echo 0; naive ≤ 40-line control < 0.60 per trigger at d3; memoryless < 0.90 and no clean week; one control per clause and per trap kind, each detected on every evaluation stream | every control fails and is detected |
| G6 trap validity | fail-to-pass per trap; each trap kind ≥ 5 times over 4 dev streams | all kept traps valid |
| G7 metamorphic invariance (IPT, arXiv 2604.15149 [doc]) | entity renames, base-week shifts, permuted independent triggers leave the reference at 100% and mutant verdicts unchanged | unchanged |
| G8 blind arm (≈ $0.05; TaskCraft's tool-less filter [doc]) | Haiku with POLICY.md + payload, no tools | below no-op share + 0.15 |
| G9 second reader (≈ $0.3) | a session that did not write the family derives 20 practice outcomes | every disagreement fixed and logged |
| G10 **mutation score** and specificity | mutants killed incl. Abrich side-effect operators (repeat-last-write, extra field, touch-other-record) and per-kind count assertions; policy-neutral variants accepted; AB handler cross-check | ≥ 0.95 (1.0 on the reference's own operators); `ab_disagree == 0` |
| G11 differential tier (sample; AutoEnv [doc]) | Haiku agent vs Sonnet agent on one rebased stream ($5–12) | flag if Haiku beats Sonnet by more than a preset margin |
| G12 leakage and parity | truth and reference host-only; `abr-apply` equals the app's own model path | no leak |
| **Reference workflow** | `wf-O`: the builder-kit skeleton completed by Opus against practice streams only | reported as the ceiling; build gap = wf-O − wf-H |

Admission to held-out: a session that did not write the family and has seen no arm results runs G0–G12 and prints
aggregates only.

### 6.4 Build order with falsifiers

| Step | What | Cost | Falsifier or prediction [I unless noted] |
|---|---|---|---|
| B0 | extract the shared harness and gate skeleton into `experiments/autobench/abr/lib` | $0, ~1 day | all 12 families' gate JSONs identical before and after |
| B1 | parity re-spec of `abr-mkt-reviews` (pin the commit; the review track edits families today) | $0 | falsified if spec + plugins exceed 50% of the original lines, or any trap kind, control or mutation operator is lost; prediction 25–40% |
| B2 | generated controls, Abrich operators and G3/G6/G7/G8 on all 12 families | $0 + ≈ $0.6 | prediction: G3 or G6 flags a decorative clause or inert trap in ≥ 3 of 12 |
| B3 | the first three new families (§6.5) | ≈ 3 × $2 spec; gates $0 | each passes G0–G12 within two review rounds |
| B4 | effective-breadth count (single linkage on clause/trap/state/app signature, preregistered τ = 0.35) | $0 | if the new families fall into existing clusters, stop and redirect to new sources |
| B5 | T0–T2 on all; T3 on survivors; T4 on four | $60–150 | — |

**Seed blocks** (fix before B5; OD-10): the AB-R README promises held-out seeds 8801+, which the seed ledger reserves for
`need-heldout` (8801–8848) [M, `research/jit-20261008/SEED-LEDGER.json`]; AB-R dev seeds 601–650 also overlap the
ledger's `need-example`/`need-label` reservation (601–650 on every bed) [M]. Proposed: factory and AB-R held-out
**8850–8999**, registered as a new purpose before any generation; dev seeds moved or the overlap recorded as a deliberate
shared dev use.

### 6.5 The first three target families

Chosen for clause-type distinctness from the 12 AB-R families and from E7/E8, for needing no new install, and for an
exact oracle source. Each is checked for distinctness at B4 before any paid run.

| | `abr-reg-incident-clock` | `abr-itsm-queue` | `abr-p2p-audit` |
|---|---|---|---|
| Adapter | A3 statute-derived clocks | A1 log-calibrated stream | A2 clean population + injected violations |
| Source | NIS2 Art. 23(4) structure (24 h early warning, 72 h notification, one-month final report), GDPR Art. 12(3) for a DSAR variant; `holidays` 0.107 (MIT) [S-obs]. Policies are fictional inspirations, never legal claims | UCI incident event log ID 498 (CC BY 4.0): weekday profile, reassignment 45.6%, reopen 1.1%, mined SLA thresholds; parameters only [S-obs] | ProcureChange reference OCEL (Zenodo 22079246, CC BY 4.0): P2P JSON 7.4 MB inside a 1,158 MB record (take only the JSON); clean on two invariants over 3,096 payments [S-obs, figures not re-opened] |
| Clauses (examples) | classify "significant" only on the CISO's email; three clocks; retraction before the early warning cancels all clocks and needs a log row; only the policy owner may amend a window | SLA clock pauses on "awaiting customer", resumes on reply; reopen restarts the resolution clock; priority change re-targets the SLA; escalate at 80% of the SLA | releaser ≠ approver; payment only after a passed three-way match within tolerance; duplicate-invoice detection; hold on a failed match |
| Traps | T-clock (DST, weekend, month-end clamp), T-authority, T-lookalike, T-stale, T-repeat, T-retract | T-burst (a design parameter: the log's peak day is only 1.7× a weekday, so burst is a stress test, not a field claim), T-replay, T-partial, T-conflict | T-lookalike vendor, T-replay (duplicate invoice), T-conflict (two receipts disagree), injected SoD and match violations with exact labels |
| State kinds | timers, policy editions, lifecycle, ledger | timers, lifecycle, windows, joins | joins (PO ↔ receipt ↔ invoice), ledger, pending approval |
| Hard requirement | schedule + audit | schedule | approval + audit |
| Third oracle | clock engine as a pure function, property-tested (Hypothesis 6.170.5, MPL-2.0) | clock engine; AB handler cross-check | the injection log (exact labels) |
| Distinctness risk | low | **overlaps `abr-ops-slawatch` and E7**: if its signature distance to either is below τ, swap in `abr-erp-dunning` | low |

### 6.6 The factory's own claim

Separate from the external portfolio. Per family: paired comparison of clean-week rate and hard-violation count, wf-H
(Haiku-built once per family) against agent-H, agent-S and agent-O (Opus xhigh on ≤ 4 families). Across families:
**random-effects model on continuous family-level paired differences as primary** (about 15–16 effective families for
the sign test's power, since the sign test's efficiency is about 0.64 [methodology §9.2]), exact one-sided sign test as
the robust secondary (12 families: power 0.39 at a true win rate of 0.75; 24: 0.77; 36: 0.91 [S-obs calc]). Lineages
(≥ 3 stream orders) are replicates inside a family. The 12 AB-R families count as one cluster until B4 measures otherwise.

---

## 7. Own beds and concurrent sealed runs: reported beside the portfolio

The primary pool holds only the external beds of §4 under one F-kit. Three secondary pools are reported beside it, each
with its own label, never mixed into the primary verdict.

| Pool | Members | Condition to enter | Owner track | Cost to breadth |
|---|---|---|---|---|
| **X: extended external** (sensitivity: "all external held-out evidence") | primary beds + AB-v1 test + SOP-Bench phase 2 sealed | AB-v1: the harness-freeze addendum puts a Haiku + Foundry arm (A1 or A1-C) **and** A0-S / A0-O xhigh on the same test tasks (OD-8). SOP-Bench: a dated amendment adds A-S (and A-O) on sealed rows **before any sealed aggregate is read** (OD-9; ≈ $28–33 for Sonnet k = 1 [S-obs calc]) | AB track; SOP track | $0 |
| **O: own beds** (Claude-written; label "own beds") | E8 sized world (agent-H, agent-H+V vs A-S/A-O agents under the OT-0 caps $20 / $45); BUILDER-1 with a fresh-author set of 24–48 requests from a separate session (≈ $0.05–2); Tier-A beds on fresh seeds (synth only for non-code arms: a catalog-aware script scores 96–99%) **consumed from need-router NL2/NL2b rows**, adding Sonnet only where missing | prereg per track; seeds from a clean block | E-bed, surface, need-router tracks | Sonnet additions ≈ $20–40 |
| **F: factory families** | §6 | G0–G12 pass | breadth (Tier 3) | ≈ $100 |

Why not pool own beds with external ones: their generators, oracles and often their tasks were written by the same model
family as the architect, which is the anti-conservative leak path of §5.4. They answer a different question (does Foundry
hold on the shapes the external beds lack: recurring streams, sagas, approvals, multi-entity).

---

## 8. The breadth-claim protocol (summary)

Full text: [PREREG-BREADTH-v0.md](PREREG-BREADTH-v0.md).

- **Beds.** Twelve in declared order (§4.3–4.4) with substitutes; verdict at the number of beds complete by 2026-11-11,
  at least 8 (below 8: "underpowered, B = k"). Descriptive interim reports at 6 and 9 beds; a non-binding refutation stop
  of comparator arms if the pooled upper bound already excludes the margin. No efficacy stop across beds: the owner's goal
  is breadth, and the methodology sweep's 6/9/12 efficacy looks (same power with 9.3 beds on average) would end the
  envelope early; kept as option OD-6.
- **Arms.** A-H, F-H, A-S on every bed; A-O (xhigh) at full comparator depth on the eight cheap beds (1, 2, 3, 6, 7, 8, 9,
  11) and as 20-task anchors on beds 4, 5, 10, 12 unless the dev-pilot meter draw allows full depth (decided at the
  freeze, before any sealed outcome). F-S optional on beds 1–2; F-HM (Mercury) on beds 1–2, ≤ 4M tokens each (D18).
- **K.** 2 runs per task for A-H, A-S, A-O; 3 lineages for F-H (F-reuse, F-live), 5 build lineages per type (F-build on
  few types); K = 3 for every arm on τ² telecom. K = 1 would buy equal precision with 69% of the runs (methodology §4.2),
  but the owner's standing rule is "no K = 1 comparative proof" (OPERATING-PRINCIPLES §6): OD-4.
- **Within a bed.** Paired task-level differences; cluster-robust variance (CR1) with t on G − 1 df, or the Tango score
  test with a design effect; bootstrap only with ≥ 30 clusters (size 0.039 at 15 clusters [calc, methodology
  `ni_interval_size2.out`]); a Bayesian paired interval (`bayes_evals`, MIT) as sensitivity.
- **Across beds.** Random effects: Paule-Mandel τ², modified Hartung-Knapp (never narrower than the fixed-effect SE;
  Röver et al., arXiv 1508.01227 [doc]), t on B − 1 df, one-sided α 0.025; REML, unweighted macro-t and DerSimonian-Laird
  as sensitivities (DL's size reaches 0.037–0.040 at small B [calc]); prediction interval on B − 2 df; predictive
  probability that a new bed is non-inferior.
- **Claim graph** (PREREG §5.3). Node **A** = H1-S (pooled F-H − A-S > −0.10) ∧ H2-S (pooled cost per verified success
  F-H / A-S ≤ 0.5), α 0.025. If A holds, α splits 0.0125 / 0.0125 to node **B** = H3 (pooled F-H − A-H > 0) and node
  **C** = H1-O ∧ H2-O (F-H vs Opus xhigh on the O-pool, ≥ 5 beds); a node that holds passes its α to the other. Node **D**
  (F-H − A-S > 0, "beats Sonnet") gets the full α only after B and C hold; node **E** ("beats Opus xhigh") after D.
- **What "matches" means.** δ = 0.10 absolute (repo precedent), plus an **assay-sensitivity label** on every verdict
  (pooled lift A-S − A-H: "informative" if its lower bound exceeds δ, "weakly informative" if only the point estimate
  does, "uninformative" otherwise), plus the **retained-lift ratio** r = (μ_F − μ_H)/(μ_S − μ_H) and the f = ½ retention
  test (FDA 2016 non-inferiority guidance: the margin must not exceed the control's own effect [doc]). No extra run: the
  three arms already exist.
- **Bed admission adds two screens on dev pilots** (≥ 30 paired dev tasks): headroom (skip if A-H and A-S both ≥ 0.90,
  or A-S < 0.10) and assay (enter the NI pool only if the dev lift A-S − A-H ≥ 0.10; otherwise the bed is reported as
  "no frontier premium here", where a cheap model suffices and only cost is compared).
- **Stopping inside a bed.** No efficacy stop; one futility look at half the pairs (z < 0.02 against −δ; P(stop | true 0)
  = 0.02, P(stop | true −0.10) = 0.47 [calc]); cost cap; invalid-evaluator and leakage voids.
- **Reported**: PREREG §9, including 2×2 discordance tables per bed, both factors of the cost ratio, a Pareto hull with the
  origin in dollars, tokens and meter units, every gate result, skipped beds, raw failures and every amendment.

**Power** [calc, `plan2/graph_power.py`, 2,000 replications per cell, 3,000 for the size rows; B = 12 S-pool beds with
n_eff 80 for F-H vs A-S and 100 for F-H vs A-H; O-pool 8 beds with n_eff 90 and discordance 0.30; true F-H − A-S = 0;
true CPS ratio vs Sonnet 0.30; correlation structure as in the cost critic's `joint2.py`]:

| τ (F-H − A-S) | lift F-H − A-H (mean, τ) | Opus premium over Sonnet | τ of log CPS | P(A) | P(A ∧ B) | P(A ∧ C) | P(all) |
|---|---|---|---|---|---|---|---|
| 0.05 | 0.10, 0.10 | 0 | 0.4 | 0.95 | 0.74 | 0.69 | 0.60 |
| 0.05 | 0.10, 0.10 | 0.05 | 0.4 | 0.96 | 0.70 | 0.25 | 0.23 |
| 0.05 | 0.05, 0.05 | 0 | 0.4 | 0.95 | 0.58 | 0.67 | 0.48 |
| 0.05 | 0.10, 0.10 | 0 | 0.7 | 0.63 | 0.50 | 0.48 | 0.43 |
| 0.10 | 0.10, 0.10 | 0 | 0.4 | 0.77 | 0.62 | 0.42 | 0.39 |
| 0.10 | 0.10, 0.10 | 0.05 | 0.4 | 0.75 | 0.58 | 0.15 | 0.14 |
| size, true F-H − A-S = −0.10 (τ 0.05 / 0.10) | | | | 0.024 / 0.026 | | | |
| size, F-H 0.10 below Opus | | | | | | 0.023 | |

Reading: node A is well powered at modest heterogeneity; cost heterogeneity across beds (τ of log CPS 0.7) is the main
threat to A, through H2. Node B (Foundry's own lift) has 0.5–0.75. Node C is honest about Opus: if Opus xhigh is 5 points
better than Sonnet, "non-inferior to Opus within 10 points" has power 0.15–0.25 at these sizes. Per bed, 202 paired tasks
give 0.80 power at δ 0.10 and discordance 0.25 [S-obs calc]: no single bed can carry the claim.

---

## 9. Schedule within usage limits

### 9.1 Usage model and rules

- **What binds.** One plan allowance shared by every agent and model; usage credits are off, so hitting the 5-hour
  limit pauses everything (README [M]). The brief: the limit is hit about once per 5 hours at about 15 concurrent agents.
  Dollars are not the binding constraint; meter units are, and today no runner records them.
- **Rules** [I]:
  1. **Quota-meter capture first** (≈ 0.5 day, $0): every breadth runner uses `--output-format stream-json` and journals
     the `rate_limit_event` utilisation before and after each session. From the dev pilots, fit meter units per session
     by arm and bed; the cost table gains a meter column.
  2. **Throttle**: no new breadth session starts while 5-hour utilisation is ≥ 0.80; breadth uses at most 6 concurrent
     runner sessions (at most 3 Sonnet or Opus) and 2 build agents. Other tracks keep the rest.
  3. **Frontier arms early in a window.** Arms of a task are interleaved (PREREG §2), so waves are task-sized; a wave
     with Opus tasks starts within the first hour after a reset.
  4. **Resumable runners**; journal committed (structured records only, §5.5) before each wave; waits use scheduled
     reminders, not polling loops.
  5. **Calibration**: the first limit hit records cumulative meter units per arm in that window; later waves plan at
     ≤ 40% of a window for breadth.
  6. **Windows of other tracks.** No breadth paid run during the AB-v1 test window (its §14 requires no other paid run
     [M]); Opus arms start only after the SOP-Bench sealed run finishes (D19 [M]).
- **Load.** Recommended design: 13,420 sessions, about 346 session-hours, 126 of them frontier [calc]: about 58 runner
  wall-hours at 6 lanes, about 12 five-hour windows if run back to back; spread over three weeks.

### 9.2 Days

The 3-day plan (`research/PLAN-3DAY-20261021.md`) owns 10-22 to 10-24 (engine bump, SPEC-1, AB-v1 test, demo).
Breadth paid work in those days is small and stays out of the AB-v1 window; no breadth sealed run starts before the
engine freeze it names.

| Day | $0 work | Paid work (window-aware) | Gate by end of day |
|---|---|---|---|
| Wed 10-21 (night) | this plan and the prereg draft revised | — | reviewed by the orchestrator |
| Thu 10-22 | quota-meter capture in the runner; facade v0 with WorkBench; WorkBench reinstall, seed-control check, 3 mutation operators; NaturalPlan venv, feasibility checker, generator v0; τ² venv (D16) and solo adapter; `experiments/breadth/analyze.mjs` port with tests against the Python simulations; seed-ledger fixes (OD-10) | memorization probes WorkBench, NaturalPlan, τ² telecom (≈ $10); Haiku-only dev pilots on WorkBench and NaturalPlan (≈ $1) | BG-0…BG-9 for WorkBench, NaturalPlan |
| Fri 10-23 (AB-v1 test day) | AgentDojo reinstall, 8 pairings resolved, facade; AppWorld install (no network), determinism and side-effect mutants on dev; τ² BG gates; F-kit v1 core from A1-C v2 | outside the AB window only: Opus F-kit templates and 4 bed cards (≈ $20); AgentDojo injection-authoring session (≈ $5) | BG for AgentDojo, τ², AppWorld |
| Sat 10-24 | sealed manifests hashed (WorkBench seeds, AgentDojo injections, NaturalPlan instances, τ² task list, AppWorld scenario ids); analysis dry run on simulated data | dev pilots for beds 1–4 (A-H, F-H, A-S; A-O if SOP sealed is done; ≥ 30 paired; ≈ $45); F-kit dev looks ≤ 3 per bed (≤ $60); WorkBench Haiku 4.5 parity anchor (≈ $3) | assay, headroom and cost screens; **PREREG-BREADTH v1 frozen** with admission rows for beds 1–4 |
| Sun 10-25 | log audit tooling on the first waves | sealed: WorkBench, NaturalPlan, AgentDojo (≈ $170) | futility looks at half |
| Mon 10-26 | AppWorld and BFCL bed cards; SpreadsheetBench evaluator fixes | sealed: τ² telecom K = 3 (≈ $240); AppWorld dev pilot and cost gate (≈ $55) | AppWorld admission row by dated amendment |
| Tue 10-27 | PlanBench validator; ToolHop install and gates | sealed: AppWorld starts (Haiku arms first waves, comparators interleaved per task) | — |
| Wed 10-28 | factory B0–B2 done; interim report on completed beds (descriptive) | AppWorld continues; BFCL dev pilot (≈ $17) | REPORT-INTERIM-1 committed |

### 9.3 Weeks 2 and 3

- **Week 2 (10-29 to 11-04):** AppWorld and BFCL sealed → **interim report at 6 beds** (descriptive, refutation check);
  beds 7–9 gates, dev pilots, sealed; τ² simulated-user adapter, DABstep solver and N-version gate; EnterpriseOps-Gym on
  the laptop (OD-7); factory B3 (three families) T0–T2; own-bed pool O runs in their tracks; host study smoke sets on the
  laptop. The 11-04 engine bump (D15) does not touch the frozen tag.
- **Week 3 (11-05 to 11-11):** beds 10–12 sealed → **interim at 9 beds** on the way, final pooled analysis by 11-11 with
  every bed complete; REPORT.md with the verdict sentence.

---

## 10. Cost table

### 10.1 Per-task anchors (list price, CLI route with prompt caching)

| Anchor | Value | Source |
|---|---|---|
| AB agent task, Haiku 5.5 | $0.011–0.016 | DEV60, DEVCHECK [M] |
| AB agent task, Haiku + A1 / A1-C | $0.015–0.040 / $0.030–0.037 | DEVCHECK, coverage §5 [S-obs] |
| AB agent task, Sonnet 5.5 alone | $0.099–0.101 (7.6–8.8× Haiku per task, not the 20× token price ratio) | [S-obs] |
| Opus 5.5 xhigh | unmeasured; taken as 2.5× Sonnet high per task (price 2×, +25% for xhigh) [I] | — |
| SOP-Bench row, Haiku agent | $0.0022 | NOTES §8 [M] |
| Prices | Haiku $0.10/$0.50 (≤ 100K prompt), Sonnet $2/$10, Opus $4/$20 per MTok | `policy/models.json` [M] |

F-H on agent beds is priced at 2× A-H per run (AB devCheck: A1-C $0.030 vs A0 $0.012 [M]). Per-bed figures below are [I]
from these anchors and the sweeps' token estimates; the dev pilots replace them before the freeze.

### 10.2 Sealed runs, recommended design

[calc, `plan2/cost2.py` → `cost2.txt`]

| # | Bed | Haiku tasks (clusters) | Comparator tasks | $ A-H | $ F-H | $ A-S | $ A-O | **Sealed $** | Sessions | Session-h | n_eff vs S / vs O |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | WorkBench | 120 (40) | 120 | 1.9 | 5.8 | 14.4 | 36.0 | **58** | 1,080 | 12.6 | 75 / 75 |
| 2 | AgentDojo | 174 (58) | 174 | 2.8 | 8.4 | 20.9 | 52.2 | **84** | 1,566 | 20.9 | 109 / 109 |
| 3 | NaturalPlan | 270 (27) | 270 | 0.3 | 9.1 | 5.4 | 13.5 | **28** | 1,620 | 5.4 | 115 / 115 |
| 4 | τ² telecom (K = 3) | 100 (≈ 34) | 100 (A-O 20) | 15.0 | 24.0 | 135.0 | 66.0 | **240** | 960 | 48.0 | 62 / anchor |
| 5 | AppWorld | 168 (56) | 112 (A-O 20) | 33.6 | 100.8 | 179.2 | 80.0 | **394** | 1,104 | 92.0 | 77 / anchor |
| 6 | BFCL-MT | 160 (≈ 40) | 160 | 1.9 | 5.8 | 25.6 | 64.0 | **97** | 1,440 | 16.8 | 100 / 100 |
| | **Interim 1 (beds 1–6)** | | | 55 | 154 | 381 | 312 | **≈ 900** | 7,770 | 196 | |
| 7 | SpreadsheetBench-912 | 120 cases (60) | 120 | 7.2 | 27.0 | 36.0 | 96.0 | **166** | 720 | 24.0 | 83 / 83 |
| 8 | PlanBench | 150 (≈ 27) | 150 | 0.1 | 9.0 | 1.8 | 4.5 | **15** | 900 | 3.0 | 83 / 83 |
| 9 | ToolHop | 160 (80) | 160 | 0.8 | 2.4 | 16.0 | 38.4 | **58** | 1,440 | 7.2 | 133 / 133 |
| | **Beds 7–9** | | | 8 | 38 | 54 | 139 | **≈ 240** | 3,060 | 34 | |
| 10 | τ² simulated-user | 90 (≈ 30) | 90 (A-O 20) | 16.2 | 35.1 | 86.4 | 45.2 | **183** | 670 | 33.5 | 64 / anchor |
| 11 | DABstep-fresh | 120 (40) | 120 | 4.8 | 14.4 | 36.0 | 88.8 | **144** | 1,080 | 27.0 | 75 / 75 |
| 12 | EnterpriseOps-Gym (laptop) | 120 (≈ 40) | 100 (A-O 20) | 19.2 | 54.0 | 160.0 | 80.0 | **313** | 840 | 56.0 | 62 / anchor |
| | **Beds 10–12** | | | 40 | 104 | 282 | 214 | **≈ 640** | 2,590 | 117 | |
| | **All 12, sealed** | | | 104 | 296 | 717 | 665 | **≈ 1,780** | 13,420 | 346 | comparators 78% |

### 10.3 Dev, factory and totals

| Item | $ [I] |
|---|---|
| Dev pilots (≥ 30 paired; A-O 30 on cheap beds, 10 on expensive), memorization probes (≥ 100 items × 2 models), F-kit dev looks, K = 3 subsamples, bed cards: beds 1–6 | ≈ 240 (AppWorld ≈ 105, τ² ≈ 55) |
| Same, beds 7–12 | ≈ 210 (EnterpriseOps-Gym ≈ 70, τ² simulated-user ≈ 60) |
| F-kit core templates (Opus), injection authoring, parity anchors | ≈ 30 |
| Factory B0–B5 (specs ≈ 9, gates ≈ 2, T1–T2 ≈ 25, T3 ≈ 45, T4 Opus ≈ 20) | ≈ 100 |
| **Primary portfolio + factory, three weeks** | **≈ 2,360** (sealed ≈ 1,780, dev ≈ 480, factory ≈ 100) |
| Secondary pools X and O (other tracks' budgets; breadth's Sonnet additions only) | ≈ 20–40 |

**Variants** [calc]:

| Variant | Sealed $ | Δ vs recommended | What is lost |
|---|---|---|---|
| Lean: A-O as 20-task anchors on every bed | ≈ 1,445 | −335 | node C becomes descriptive at δ 0.15 (L3 not testable at δ 0.10) |
| K = 1 for every arm except τ² telecom (OD-4), same tasks | ≈ 1,145 | −635 | violates the owner's "no K = 1 comparative proof"; precision per task falls (SE × 1.18), equal precision needs 1.4× tasks for ≈ 31% fewer runs |
| Opus xhigh at full depth everywhere | ≈ 2,890 | +1,110 | — (powers node C over all 12 beds; about 45 more frontier session-hours) |

Each interim stage's sealed spend exceeds the policy's $500 single-experiment pause (`policy/models.json` `spend`
[M]) only for beds 1–6 (≈ $900) and 10–12 (≈ $640): **OD-1** (record the owner's "full speed ahead, I don't mind" of
2026-10-21 as the decision, with the README note the rule asks for, before the first of those stages starts).

### 10.4 Breadth per dollar and per usage hour

| Bed | Sealed clusters | $ per cluster, all arms | $ per cluster, Haiku arms only | Session-h | Frontier session-h |
|---|---|---|---|---|---|
| PlanBench | 27 | 0.57 | 0.34 | 3.0 | 2.0 |
| ToolHop | 80 | 0.72 | 0.04 | 7.2 | 3.2 |
| NaturalPlan | 27 | 1.05 | 0.35 | 5.4 | 3.6 |
| WorkBench | 40 | 1.45 | 0.19 | 12.6 | 5.6 |
| AgentDojo | 58 | 1.45 | 0.19 | 20.9 | 9.3 |
| BFCL-MT | 40 | 2.43 | 0.19 | 16.8 | 7.5 |
| SpreadsheetBench-912 | 60 | 2.77 | 0.57 | 24.0 | 16.0 |
| DABstep-fresh | 40 | 3.60 | 0.48 | 27.0 | 12.0 |
| τ² simulated-user | 30 | 6.10 | 1.71 | 33.5 | 11.0 |
| AppWorld | 56 | 7.03 | 2.40 | 92.0 | 22.0 |
| τ² telecom | 34 | 7.06 | 1.15 | 48.0 | 18.0 |
| EnterpriseOps-Gym | 40 | 7.83 | 1.83 | 56.0 | 16.0 |

Reading [I]: the cheap arms are nearly free everywhere; the comparator arms set the price of breadth. The four
expensive beds cost 5–13× a cheap bed per cluster and are kept for what nothing else gives (official sealed, long
horizon, policy dialogue, enterprise operations). Meter units per bed replace session-hours once §9.1 rule 1 lands.

---

## 11. Decisions needed

The owner's standing instruction is "dont ask me for perms" (OPERATING-PRINCIPLES §8); decisions marked *orchestrator*
can be recorded as dated D-numbers under that grant. Items that touch an owner rule are marked *owner rule*.

| # | Question | Recommendation | Who | Blocks |
|---|---|---|---|---|
| OD-1 | Budget: ≈ $2.36k over three weeks; stages above the $500 pause rule | record "full speed ahead, I don't mind" (2026-10-21) as the decision; README note before beds 1–6 sealed | orchestrator (policy rule satisfied by the note) | interim 1 |
| OD-2 | THESIS D10 ("no executor reads third-party text"): every portfolio arm reads benchmark text; AgentDojo's is adversarial by design | accept as for AutomationBench (RECURRING-DESIGN §3.13): facade-only tools, no Bash, no network, host-side grading | orchestrator | all beds |
| OD-3 | Headline comparator (methodology O-3) | D19 settles it: Opus xhigh is the bar; the claim graph tests Sonnet first, then Opus | settled by D19 | — |
| OD-4 | K = 1 (methodology O-1, ≈ 31% fewer runs at equal precision, ≈ $635 at equal tasks) | keep K = 2 this round (owner rule "no K = 1 comparative proof"); revisit with the measured flip rates from the K = 3 subsamples | owner rule | — |
| OD-5 | Margin rule (methodology O-2) | δ = 0.10 absolute plus the assay label and retained-lift report on every verdict | orchestrator | freeze |
| OD-6 | Bed-level efficacy looks 6/9/12 (methodology O-4) | not adopted: breadth is the goal; interim reports are descriptive with a non-binding refutation stop | orchestrator | — |
| OD-7 | Laptop: EnterpriseOps-Gym images (csm + hr + itsm ≈ 314 MB compressed) and the host study with the owner's Codex, Cursor and OpenCode | approve for weeks 2–3 | owner's machine | bed 12, host study |
| OD-8 | AB-v1 test composition (AM-10/11 + D19) | put a Haiku + Foundry arm and A0-O xhigh (and A0-S) on the same test tasks, so AB-v1 can enter pool X; extend D19 to the test run | AB track | pool X |
| OD-9 | SOP-Bench sealed: add A-S (and A-O) | dated amendment before any sealed aggregate is read; else SOP stays Haiku-vs-Haiku | SOP track | pool X |
| OD-10 | Seed ledger: AB-R held-out 8801+ collides with `need-heldout` 8801–8848; AB-R dev 601–650 overlaps `need-example`/`need-label` | move factory/AB-R held-out to 8850–8999; record the dev overlap | factory / need-router | factory T-tiers |
| OD-11 | Mercury F-HM on beds 1–2 | ≤ 4M tokens per bed under D18 (≈ 5.2M of 20M used), only if ≥ 2× the cap remains at the freeze; descriptive (L4 needs ≥ 3 beds) | orchestrator | F-HM |
| OD-12 | ERP-Bench (Odoo ≈ 861 MB images) and Spider2-DBT (1.06 GB zips) | defer | owner (D16 sizes) | Tier-3 externals |

README's owner-decision table should carry the open ones (README is the single entry point; ROADMAP §6 rule 1). This
document does not edit README.

---

## 12. Risks and what would change the plan

1. **The Foundry arm is a different program per bed in practice.** One bed-agnostic core; Opus bed cards from public
   material only; hashes frozen; the per-bed card diff published. A bed needing code beyond its card is labelled
   "bed-specific F".
2. **Haiku alone already matches Sonnet on some beds**, and Sonnet beats Haiku + harness on others (devCheck 23 vs 20).
   Node B and the assay label exist so that neither is mistaken for a Foundry effect.
3. **Cost heterogeneity sinks H2** (P(A) falls from 0.95 to 0.63 when τ of log CPS rises from 0.4 to 0.7 [calc]): beds
   where F-H's construction is expensive relative to a short task (ToolHop, BFCL) can have CPS ratios near 1. The report
   splits CPS into its cost and success factors; F-live beds are where to look first.
4. **Opus xhigh is stronger than assumed.** Node C's power is 0.15–0.25 at a 5-point Opus premium; the verdict then
   reads "matches Sonnet; not shown against Opus xhigh", which is still a result.
5. **AppWorld, τ² or EnterpriseOps-Gym overrun.** Cost gates before their freeze rows; futility looks; caps stop the bed.
6. **Account limits.** A limit hit mid-wave costs a window, not data, if runners resume; the meter throttle (§9.1) aims to
   avoid it.
7. **Disk.** Audit-on-write; a bed pauses below 1 GB free.
8. **Oracle defects found late.** An invalid evaluator blocks claims (AGENTS.md): a bed whose gate fails after its sealed
   run is excluded and reported, and the next substitute runs.
9. **Contamination.** H4 beds may favour whichever arm memorized more; probes, the pooled difference in differences, the
   H4-excluded analysis and the log audit bound it.

## 13. Corrections to carry into other documents

| Where | Correction |
|---|---|
| this file, revision 1 §0, §2 and PREREG revision 1 §1.1 | AB-v1 test is **not in flight** (harness-freeze addendum unwritten); AM-10/11 may put a Sonnet-based headline and an A0 of the same model on test; SOP-Bench sealed halted once on a rate limit [S-obs] |
| this file, revision 1 §0 item 10, PREREG revision 1 §2 F-M | Mercury is not "capped by D8": D18 raised the ceiling to 20M tokens; about 5.2M used [M, decisions D18; S-obs] |
| this file, revision 1 §2 | "Haiku + A1 22/60" is the pre-date-note run; under the date note it is 18/60 against Sonnet alone 20/60 [M, DEV60-A0-A1.md] |
| this file, revision 1 §4.4 and PREREG revision 1 | τ² banking_knowledge raises an error in solo mode; it needs a user simulator [M, `environment.py:70-71`] |
| PREREG revision 1 §5.1 | Bowyer et al. (arXiv 2503.01747) do not support the cluster bootstrap at small N; both CLT and bootstrap under-cover [S-obs, methodology §4.1] |
| `research/automationbench-20261014/runs/DEVCHECK.md` | add A0 run 2 (15/60, $0.011/task) and Sonnet alone (23/60, $0.099/task) [S-obs] |
| README, docs/RESEARCH.md | "Haiku + harness ties Sonnet alone" (dev60) needs the devCheck row beside it (Sonnet 23/60 > A1 20/60) [S-obs] |
| `beds/incident/README.md`, `beds/codefix/README.md` | "no model has been run on it yet" is stale (calibration and C0 dev runs exist) [S-obs] |
| `research/tau2-20261021/ACQUISITION.md` | telecom `tasks.json` has 2,285 entries over 3 intents; `base` (114) is a list in `split_tasks.json`; v2.0.0 replaced 50 telecom and 50 retail base tasks and changed scoring (not comparable with 1.x); retail rewards are LLM-judged (NL_ASSERTION, 112/114); airline COMMUNICATE is judged unless `--communicate-scorer substring`; the default user simulator is `openai/gpt-5.5`; PyPI `tau2` is unrelated [M, S-obs] |
| any note quoting AppWorld | 732 released ids (train 90, dev 57, test_normal 168, test_challenge 417), not 750; `appworld verify` ends in `os._exit(0)` [S-obs] |
| any note quoting SpreadsheetBench Verified-400 | 1 test case per instruction; the 3-workbook property exists only in the 912 set [S-obs] |
| any WorkBench result | report against the 18.0% do-nothing floor (124/690) and on the 566 state-changing tasks [S-obs] |
| EnterpriseOps-Gym notes | the sweeps disagree on counts (HF 1,115 vs public split 649 of 1,150) and frontier scores (best 34.1% / Opus 4.5 37.4% vs Opus 4.6 45.9%): unresolved |
| DABstep, TaxCalcBench | not usable as held-out as shipped: hidden answers recoverable (450/450), expected outputs in the repo [S-obs] |
| `research/jit-20261008/SEED-LEDGER.json` / AB-R README | the two collisions of §6.4 |

## 14. Not verified here

Model knowledge cut-offs; Opus xhigh cost and meter multiplier; whether `--effort max` is accepted for Haiku by CLI
2.1.306; WorkBench generator seed control; the 8 AgentDojo workspace injection pairings; τ² venv size; whether
`tasks/manager.py` can compose telecom tasks outside the public pool; the number of distinct τ² intent × subtask-count ×
persona cells reachable in a 100-task sample; NaturalPlan generator faithfulness; PlanBench validator parity; DABstep
solver agreement; AppWorld cost per task (wide range); whether `claude -p` sessions share prompt-cache prefixes;
whether Codex, OpenCode and Cursor run headless against an MCP server; EnterpriseOps-Gym task counts and image sizes on
the laptop; the size of the 5-hour allowance in meter units; the design effects assumed in §10.2 (ρ 0.15–0.45); whether
the SOP-Bench sealed run has finished. The power figures rest on simulation models with two-point or normal effects;
re-run them at the freeze with dev-pilot discordance, ICC and cost spread.

---

## Sources

All read on 2026-10-21, by the sweep named or by this author.

**Repository [M]:** README.md; docs/THESIS.md (§5 P9, §10 D10); docs/ROADMAP.md §4, §6; AGENTS.md;
`research/OPERATING-PRINCIPLES.md`; `policy/models.json` (version 2026-10-21.2); `research/decisions-20261021.md` (D4,
D8, D9, D15, D16, D18, D19, D21, D22); `research/PREREGISTRATION-TEMPLATE.md`; `research/PLAN-3DAY-20261021.md`;
`research/automationbench-20261014/{PREREG-AB-v1.md (AM-10, AM-11, §14), PREREG-AB-v1-AMEND-FRONTIER.md, RECURRING-DESIGN.md,
runs/DEV60-A0-A1.md, runs/DEVCHECK.md}`; `research/sopbench-20261021/{NOTES.md,DESIGN.md}`; `research/tau2-20261021/ACQUISITION.md`;
`research/jit-20261008/SEED-LEDGER.json`; `corpus/tau2-bench` at `57e54143` (`data/tau2/domains/telecom/{tasks.json,split_tasks.json}`,
`src/tau2/registry.py`, `src/tau2/domains/banking_knowledge/environment.py`, `src/tau2/domains/telecom/environment.py`,
`src/tau2/agent/llm_agent.py`, `CHANGELOG.md`).

**Sweep notes and scripts** (session scratchpad `breadth/`): `agentic-tool.md`, `enterprise-process.md`,
`construction.md`, `recurring-synthesis.md`, `methodology.md`, `repo-coverage.md`, `coverage.md`, `wb-probe-run{1,2}.json`;
`tools-meth/*.py`, `meth-sims/*.py` and `.out`, `ni-sample-size*.txt`, `fut-sim.txt`, `portfolio-sim.txt`;
`cost-critic/{cost,h1_tau,joint,joint2}.{py,txt}`, `critic-owner/opus_power.py`; this revision's `plan2/cost2.{py,txt}` and
`plan2/graph_power.{py,txt}`.

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

**Methods** (read by the methodology and recurring-synthesis sweeps; evidence class in their notes): Röver, Knapp and
Friede, HKSJ with few studies, arXiv 1508.01227; FDA, Non-Inferiority Clinical Trials to Establish Effectiveness (Nov 2016),
https://www.fda.gov/media/78504/download; Bowyer, Aitchison and Ivanova, arXiv 2503.01747; Kotawala, arXiv 2605.30315;
Miller, arXiv 2411.00640; Kapoor et al. (HAL), arXiv 2510.11977; Anthropic Engineering, "Quantifying infrastructure noise
in agentic coding evals", https://www.anthropic.com/engineering/infrastructure-noise; Erol et al., Cost-of-Pass, arXiv
2504.13359; Zhu et al., Agentic Benchmark Checklist, arXiv 2507.02825; Perlitz et al., arXiv 2308.11696; She and Lin,
arXiv 2609.21267; Ndzomga, arXiv 2603.23749; Hofmann et al., arXiv 2509.11106; Scale AI, search-time contamination, arXiv
2508.13180; Rabanser et al., arXiv 2602.16666; Bandel et al. (Exgentic), arXiv 2602.22953; Bjarnason et al., arXiv
2602.07150; Waudby-Smith and Ramdas, arXiv 2010.09686; Anchor arXiv 2605.26321; AutoGym 2609.22592; AgentMercury
2608.20634; τ² paper 2506.07982; SWE-smith 2504.21798; TaskCraft 2506.10055; AutoEnv 2511.19304; EnvScaler 2601.05808;
Abrich 2610.09142; IPT 2604.15149; FlowMind 2602.11782; AFlow 2410.10762.

**Data sources** (read by the recurring-synthesis sweep): UCI incident log
https://archive.ics.uci.edu/dataset/498/incident+management+process+enriched+event+log; ProcureChange
https://zenodo.org/records/22079246; BPIC OCEL https://zenodo.org/records/22663565; GDPR Art. 12
https://gdpr-info.eu/art-12-gdpr/; holidays https://pypi.org/project/holidays/; OR-Tools https://pypi.org/project/ortools/;
Tryton https://pypi.org/project/trytond/; Hypothesis https://pypi.org/project/hypothesis/.
