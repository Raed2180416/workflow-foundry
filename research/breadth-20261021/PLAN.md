# Breadth program: portfolio, family factory, claim protocol and first weeks (2026-10-21, revision 3)

*Design, 2026-10-21 (late evening), written by an Opus 5.5 subagent of the breadth workflow at HEAD `48712cca`.
**Revision 3 supersedes revision 2** (written at `7ab0c16e`, committed by autosave in `eebece12`, with a one-line change
in `a1260640`; revision 1 is in `6c56ec30`). Revision 3 answers three critiques of revision 2 written today (validity,
cost and throughput, owner vision); what changed and why is in the **Critique log (§15)**. Inputs beyond revision 2's:
those critiques and their $0 scripts (scratchpad `breadth/validity/`, `costcritic/`, `breadth/critic-owner2/`), and three
$0 calculations for this revision (`breadth/plan3/power3.py`, `cost4.py`, `harm_guard.py`, outputs beside them). Nothing
in this file has run against a model. Nothing here is a capability result. `beds/sealed/` was not read; no benchmark test
split was opened; no sealed aggregate of a running experiment was read. Nothing was installed, downloaded or published.*

*Companion: [PREREG-BREADTH-v0.md](PREREG-BREADTH-v0.md) (draft preregistration, revision 3, not frozen). Disposals:
[DISPOSALS.md](DISPOSALS.md).*

**Evidence tags.**
- **[M]** read or measured in this repository today (path cited).
- **[S-obs]** observed by a breadth sweep today (a probe it ran or code it read), not re-run by this author.
- **[C-obs]** observed or computed by one of today's three critics, not re-run by this author (script path given).
- **[doc]** a project README, card, paper or leaderboard claim, not checked here.
- **[mem]** a critic's recollection, not re-read today.
- **[calc]** computed today by this author (script path given).
- **[I]** inference or design choice.

**What changed from revision 2, in one paragraph** (details and reasons in §15): the external portfolio is cut from twelve
beds to **ten valid ones** (eight core, two conditional), with PlanBench, ToolHop, τ² simulated-user and DS-1000 out of the
primary pool and NaturalPlan and SpreadsheetBench re-run as agent beds; **every arm gets the same tools, bed card, date note
and hardened session configuration**, so node B measures workflows rather than tool access; Sonnet is thinned to n_eff 60
per bed and **Opus xhigh runs as 20-task anchors on every primary bed**, so node C is no longer earned on the easy beds;
a new **enterprise stream node V** tests superiority over Opus xhigh at full horizon on the owner's shapes, under its own
preregistration; power is reported at the effect the dev evidence actually shows, where **"Inconclusive" is the most likely
verdict**, so sealed comparator money waits behind a **portfolio dev gate**; the **7-day usage window**, not dollars,
sets the schedule; the verdict date moves to 2026-11-18. Tier 1 for the next phase is **WorkBench with the shared facade,
AgentDojo, AppWorld and the family-factory prototype for node V**; τ² telecom is first in Tier 2.

---

## 0. Bottom line

1. **The claim has no held-out evidence today, and the dev evidence points below the margin's comfort zone.** "Cheap model
   + Foundry is non-inferior to a frontier model alone, at lower cost" rests on development runs of one external bed. Under
   the date note, Haiku + A1 is 18/60 against Sonnet 5.5 alone 20/60 on dev60 [M, DEV60-A0-A1.md]; on devCheck, Haiku + A1
   and + A1-C are 20/60 against Sonnet alone 23/60 [S-obs; C-obs, `a0s-devcheck-1/summary.json` pass rate 0.383]. So
   Haiku + Foundry sits **2–5 points below Sonnet**. Opus 5.5 xhigh alone has never run on an external bed. No sealed run in
   flight holds a frontier-alone arm [M].
2. **Stated in advance: at the effect the dev evidence shows, the most likely verdict is "Inconclusive".** With ten beds,
   Sonnet at n_eff 60 and F-H truly 3 points below Sonnet, node A passes with probability 0.60 at a between-bed spread τ of
   0.05 and 0.37 at τ 0.10; at 5 points below, 0.36 and 0.20 [calc, `plan3/power3.txt`]. Hence the **portfolio dev gate**
   (§8.4): no sealed comparator money is spent until the pooled dev estimate of F-H − A-S on the first three beds is at least
   −0.03. Until then the money goes to the Foundry kit, on dev.
3. **Breadth means independent, valid beds; validity first, then count.** The bed is the replication unit; inside a bed,
   the cluster. Ten primary beds in a declared order (§4): **WorkBench, AgentDojo, AppWorld, τ² telecom (solo), BFCL v4
   multi-turn, SpreadsheetBench V2 (non-chart), NaturalPlan (as an agent bed), EnterpriseOps-Gym (laptop)**, then two
   conditional slots (**DABstep-fresh** only with two independent solvers, and the first newly scouted bed). The verdict
   needs B ≥ 8. Power comes from beds, not depth: at F-H = A-S, P(node A) is 0.69 with 8 beds and 0.85 with 10 [calc].
4. **Fair comparators** (§5.2). Every arm (A-H, F-H, A-S, A-O) has the same bed facade, the same sandboxed network-off
   Python tool, the same Opus-written bed card, the same declared date and identity, and the same hardened session flags.
   Rev 2 gave Foundry code execution and a bed card and gave the frontier arms neither; that contrast measured tool access.
5. **Opus 5.5 xhigh, the owner's bar (D19), is tested twice.** Node C pools 20-task Opus anchors from **every** primary
   bed, long-horizon ones included (size 0.012–0.017 [calc]). Node **V** (§6.6) runs Opus xhigh as one long Claude Code session
   per enterprise stream, at full horizon, and tests **superiority** of Haiku + Foundry: 24 sealed streams over three
   factory families, power 0.81 if clean-stream rates are 0.75 against 0.35 and 0.35 if they are 0.70 against 0.45 [C-obs,
   `critic-owner2/estream_power.txt`]. V is where Foundry's mechanism (construct once, verify, reuse, adapt to an amendment,
   code owns the clocks) should carry the result, and the only place superiority over Opus is reachable this round.
6. **Tier 1, built in the next phase** (§4.3; JSON at the end of the orchestrator reply): **WorkBench + the shared facade**,
   **AgentDojo**, **AppWorld**, and the **family-factory prototype** that produces V's streams. Installs ≈ 0.76 GB under
   D16. τ² telecom moves to the head of Tier 2 (venv size unverified, K = 3, public and possibly vendor-targeted).
7. **Cost** (list price, [I] until dev pilots measure it; §10): sealed primary ≈ **$965** for ten beds (≈ $880 for the
   eight core), sealed extras ≈ $75, dev ≈ $400, factory build ≈ $30: ≈ **$1.47k without V**; V adds $350–880 under its own
   preregistration. Frontier session-hours fall from 126 (rev 2) to 61, plus 25–45 for V [calc, `plan3/cost4.txt`; C-obs].
   Build agents are the hidden cost (§10.3): Haiku 5.5 max writes adapter code, Opus reviews.
8. **The binding constraint is the 7-day usage window** (§9). Rev 2 had no 7-day rule; its 5-hour throttle allowed about
   3.4× the weekly cap [C-obs]. Rules: a $0.01 dose test on day 1, a wave starts only at 5h ≤ 0.60 and 7d ≤ 0.80 (the R0
   runbook's G5 [M]), breadth takes at most 35% of the 7-day window per week, and one account-wide meter governor is
   recommended. Moving comparator arms to owner-provisioned API billing is an owner option (OD-15).
9. **Oracle validity first, at $0**, with three gates added (§5.4): leakage probes run *from inside* each environment's own
   code-execution tool; oracle fixes freeze before any build sees oracle feedback; and each bed records which hard
   violations its primary outcome already fails.
10. **Own beds and concurrent sealed runs stay beside the portfolio** (§7). The cheapest extra external sealed evidence is in
    other tracks: Sonnet and Opus xhigh arms on SOP-Bench sealed rows by dated amendment before any sealed aggregate is read
    (OD-9, time-critical), and Haiku + Foundry and Opus xhigh arms on the AB-v1 test (OD-8). A frontier arm added after a
    sealed run has started is labelled "non-concurrent comparator".
11. **Decisions needed** (§11): budget and meter note (OD-1), API billing for comparators (OD-15), the D18 Mercury ceiling
    (OD-11), laptop runs (OD-7), the AB-v1 and SOP-Bench amendments (OD-8, OD-9), the verdict date (OD-13), the seed block
    (OD-10), a policy entry for a frontier parity anchor (OD-16), and the earlier artifact publication (OD-0).

---

## 1. What "breadth" has to mean for this claim

**The claim under test** (brief and AGENTS.md): cheap models (Haiku 5.5; Mercury 3; later open-weight) inside Foundry
construct, run, verify and reuse bounded typed workflows that match or beat frontier models alone (Sonnet 5.5, Opus 5.5;
the owner's bar is Opus 5.5 xhigh, D19) on real task success, at lower cost, with executable oracles and preregistered
held-out evaluation.

**Units.**

| Level | Unit | Why |
|---|---|---|
| Portfolio | **bed**: an independent source with its own harness, oracle and task population | Var(μ̂) ≈ τ²/B + v/T: for 480 tasks, SE 0.034 as 4 × 120, 0.029 as 8 × 60, 0.027 as 12 × 40 at τ = 0.05 [S-obs, methodology `meth-sims/calc_tables.py`]. Beds buy precision faster than tasks |
| Bed | **cluster**: template (WorkBench), scenario (AppWorld), user task (AgentDojo; two-way with injection task, §8.2), task type × level (NaturalPlan), intent × subtask count × persona (τ²), task (SpreadsheetBench V2), family (factory) | WorkBench's design effect is about 5 at 10 instances per template [S-obs]; instances inflate n |
| Cluster | instance × run | Runs average out the 10–15% of tasks that flip between identical runs on AB [M, DEV60-A0-A1.md] |

**Axes of breadth**: domain, workflow shape, recurrence and horizon, arm (model; Foundry or not), host harness.

**Shared-harness bias is not covered by breadth.** Every bed uses the same CLI, comparator definition and Opus architect.
A shared artefact (the account identity in context, the injected host date, a session flag, a cost under-count) moves
every bed the same way, and τ does not see it. Only the parity rules of §5.2 and the checks of §5.4 do [C-obs, validity §0.5].

**Held-out classes** (every portfolio bed carries exactly one; relabelled from rev 2 [C-obs, validity §4c]):

| Class | Meaning | Beds |
|---|---|---|
| H1 official-sealed | answers held only by the benchmark owner | none this round |
| H1e encrypted-public | official test split whose answers ship encrypted and are decrypted locally; terms forbid looking | AppWorld test_normal |
| H2-ext fresh, external generator | new instances from the benchmark's own generator, seed frozen; counts only if regeneration changes the answers | WorkBench regenerated (else H4) |
| H2-own fresh, our generator or solver | instances or answers made by our code over external templates; an own-bed leak route (§7), flagged in every pooled result | NaturalPlan via our generator, DABstep-fresh |
| H3 fresh-authored | items written by a session that builds nothing, hashed before any arm runs | AgentDojo injection tasks we author (on public user tasks) |
| H4 public-static | public items and answers; possibly seen by every model (no knowledge cut-off is published for Haiku 5.5, Sonnet 5.5 or Opus 5.5 [S-obs]); vendors may have trained toward some (τ²-bench appears in launch material [mem]) | τ² telecom, BFCL-MT, EnterpriseOps-Gym; SpreadsheetBench V2 (released 2026-09: recency is its only control) |

H4 beds enter only with a clean contamination probe (§5.5). The **H1e/H2-ext/H3-only** analysis is a robustness check
with teeth: if the verdict holds only when H4 or H2-own beds are included, its wording is downgraded (PREREG §5.7).

**Claim ladder** (what evidence allows which sentence):

| Rung | Sentence allowed | Evidence |
|---|---|---|
| L0 | "Foundry lifts Haiku 5.5 on bed X" | per-bed paired lift; directional |
| L1 | "On the declared portfolio, Haiku 5.5 in Foundry is **within 10 points** of Sonnet 5.5 (at high) alone, at ≤ ½ its cost per verified success, retaining r̂ of Sonnet's premium over Haiku" | node A at B ≥ 8, with the assay label |
| L1+ | the words **"non-inferior"** or **"matches"** in L1 | node A **and** the retention test at f = ½ (PREREG §5.4) |
| L2 | "… and Foundry causes the gain over Haiku alone, beyond tools, card and notes" | node B, with the A-HN control (§8.2) |
| L3 | "… and is within 10 points of Opus 5.5 xhigh, pooled over every primary bed" | node C over the anchors |
| LV | "On recurring multi-tier enterprise streams, Haiku 5.5 in Foundry has more clean streams than Opus 5.5 xhigh alone at full horizon" | node V (own preregistration) |
| L4 | "Not specific to Haiku or one host" | ≥ 2 cheap models; ≥ 2 hosts × ≥ 3 beds (not reachable this round, §3.3) |
| L5 | "Recurring families" | factory claim, ≥ 15 effective families (random effects) or ≥ 24 (sign test) |
| L6 | "Not a contamination artefact" | §5.5 checks pass; the H1e/H2-ext/H3-only analysis agrees |

Words not allowed at any rung: "beats the frontier" without node D or E or V; "general"; "SOTA"; "the owner's bar" without
naming which node (C: external tool-use beds; V: enterprise streams); a per-bed win count as the headline. F-H results are
never submitted as leaderboard entries (ROADMAP §4.3 [M]). The records P1 result (Haiku workflow 35/36 vs Sonnet **one
call** 28/36) is never cited as "matching the frontier": the comparator was a single call [C-obs].

**Envelope sentence** (part of every verdict): "Claude Code headless only; no computer use; Haiku 5.5 as the cheap model
(Mercury descriptive unless F-HM is the frozen arm, §8.2); Sonnet 5.5 at high and Opus 5.5 at xhigh; beds chosen for
executable oracles, local runnability under D16 and a frontier premium on dev; the prediction interval covers new beds of
that class only."

---

## 2. Where the evidence stands today

From the repo-coverage sweep (HEAD `73a8171e`, notes `breadth/coverage.md`), checked against `runs/DEV60-A0-A1.md`,
`runs/DEVCHECK.md`, `PREREG-AB-v1.md` AM-9/10/11, the frontier amendment and decisions D16–D23 [M].

### 2.1 External beds

| Bed | Domain | Shape | Arms run (strict pass, K) | Class | Status 2026-10-21 |
|---|---|---|---|---|---|
| AutomationBench dev60 (devTrain, seed 21) | workplace SaaS, 47 simulated apps | one-shot multi-step tool use | Haiku alone 9/60; Haiku + A1 18/60; + A1-C 20/60; **Sonnet alone 20/60**; Sonnet + A1 28/60; Mercury-planner/checker + Haiku acting 29/60; Mercury alone 2/60; rows under the date note, K = 1 | dev, in-sample for A1-C | [DEV60-A0-A1](../automationbench-20261014/runs/DEV60-A0-A1.md) [M] |
| AutomationBench devCheck (60 hold-back) | same | same | Haiku alone 13/60 and 15/60; A1 20/60; A1-C 20/60; **Sonnet alone 23/60** | dev hold-back, 2 of 3 looks used | DEVCHECK.md lacks the second A0 run and the Sonnet row [S-obs] |
| AutomationBench AB-v1 test (266 unburned of 300) | same | same | none | sealed, **not run** | harness-freeze addendum unwritten; D23 sets the sequential plan [M] |
| SOP-Bench phase 2 (1,693 sealed rows) | 12 regulated SOPs | build once per SOP, run many rows | W-H vs A-H, k = 3; **no Sonnet or Opus arm** | sealed, running | halted once on `MODEL_RATE_LIMIT` [S-obs] |
| τ²-bench @`57e54143` | telecom, banking, airline, retail | policy-bound tool use; dialogue with a simulator | none | pinned, inert | [ACQUISITION](../tau2-20261021/ACQUISITION.md) [M] |
| WorkBench, AgentDojo, AppWorld, BFCL-MT, NaturalPlan, SpreadsheetBench, ToolHop, NESTFUL | various | various | gold replay and floors only | $0 probes, deleted | [DISPOSALS](DISPOSALS.md) [M] |

### 2.2 Own beds (Claude-written) with paid arms

records (P1: Haiku workflow 35/36 vs Sonnet one call 28/36), codefix and incident (no headroom at d3–d5), kinetics (JIT
streams, K = 1), W-bed (Haiku one call only), E8 (agent-H 10/14, + validator 12/14; Opus one-shot builder 27.5%), COMP-1
(inconclusive), OT-0 (frontier agent arms void after the session limit), BUILDER-1 (Haiku + templates 18/21, Mercury +
templates 18/21, same author). Built at $0 with **no model ever run**: the 12 AB-R recurring families, synth, gridquest,
gameqa, runbook, ownerci, E7 [S-obs, coverage.md §1].

### 2.3 What this says

- External domains with paid evidence: **2**. Frontier-alone held-out evidence: **none**. Hosts: **one** (Claude Code
  headless, CLI 2.1.295–2.1.306). Opus 5.5 on no external bed.
- Sonnet's dev lift over Haiku alone on AB is 13–18 points: **the size of the planned margin δ = 0.10**. Non-inferiority at
  δ 0.10 can pass with Haiku + Foundry no better than Haiku alone; hence the retention test gates the word "non-inferior"
  (L1+). On the dev point estimates, retention r is 0.82 on dev60 and 0.67 on devCheck (A1) [C-obs, validity §1b].
- About $350 list price of recorded experiment calls in total, about $42 on external beds [S-obs]. Six usage-limit stops
  recorded (10-06/07, 10-08, 10-09, 10-15, 10-21 twice) [S-obs].
- Two harness defects known in the repo bear on every CLI arm and were missing from rev 2: **C7** (`claude -p` puts the
  session account's e-mail address into the model's context; open; [M, `research/compromises-20261021/REGISTER.md:80`]) and
  **AM-9** (the CLI injects "Today's date is <host date>"; it moved AB by 3–4 tasks; [M, `PREREG-AB-v1.md:693-712`]).

---

## 3. Target coverage matrix and holes

### 3.1 Domain × shape

Shapes: **S1** typed judgment; **S2** short multi-step tool use (≤ 10 steps); **S3** long horizon (≥ 20 steps or many
apps); **S4** policy-bound dialogue with a user; **S5** construct once, run many; **S6** recurring stream with cross-trigger
state and clocks; **S7** untrusted input and control-flow integrity; **S8** saga, compensation, faults; **S9** async, time,
ambiguity; **S10** intent recovery from a messy request.

Codes: **own** = Claude-written bed with paid dev arms; **own-B** = built at $0, never armed; **ext-dev**, **ext-seal** =
external dev or sealed evidence; **1–10** = primary bed (§4); **V** = node V streams (§6.6); **F** = factory family;
**—** = hole.

| Domain | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Workplace SaaS | — | ext-dev (AB), **1** | — | — | **1** (template reuse streams) | own-B (AB-R ×12) | — | 1 (fault/drift subset) | — | own (BUILDER-1) |
| Assistant under prompt injection | — | **2** | — | — | — | **2** (task × injections) | **2** | — | — | — |
| Personal multi-app assistant | — | **3** | **3** | — | **3** (scenario variants) | — | — | — | — | — |
| Customer-service policy, tool use | — | **4** | **4** (up to 9 subtasks) | — (solo mode has no user) | 4 (per-intent reuse) | — | — | — | — | — |
| Function calling, API composition | — | **5** | 5 (long_context) | — | — | — | — | — | — | — |
| Office documents, spreadsheets | — | **6** | — | — | — | — | — | — | — | — |
| Scheduling | — | **7** | — | — | 7 (per-type reuse) | — | — | — | — | — |
| Enterprise ITSM / HR / CSM | — | **8** (laptop) | **8** | — | — | own-B (E7), **V** itsm-queue | — | — | **V** (SLA clocks) | **V** (messy intake) |
| Payments data analysis | — | **9** (cond.) | — | — | 9 | — | — | — | — | — |
| Order, commerce, ERP | — | own (E8) | own (E8) | — | own (E8 builds) | own (OT-0) | — | own (E8) | — | own-B (SPEC-0) |
| Regulated procedures | ext-seal (SOP) | ext-seal | — | — | ext-seal (SOP W-H) | **V** reg-incident-clock | — | **V** (retraction as compensation) | **V** (statutory clocks) | **V** |
| Finance, AP, audit | — | ext-dev (AB finance) | — | — | — | own-B (apintake), **V** p2p-audit | — | **V** (hold, release) | — | **V** |
| Synthetic structure, science, SRE, CI | own (records, kinetics, incident, codefix) | own | own (W-bed R5–R6) | — | own (records P1) | own (JIT streams) | — | own (W-bed R8 faults) | — | — |

### 3.2 Owner shapes against what the plan tests

From the vision critique [C-obs, against REQUIREMENTS-COVERAGE-20261021.md]; the right column is what rev 3 adds.

| Owner ask | Primary pool (beds 1–10) | Rev 3 addition |
|---|---|---|
| Enterprise multi-tier workflows; "the most complex workflows the biggest orgs use is the bar" | EnterpriseOps-Gym (bed 8, laptop, public split) | **V**: three enterprise families, 4-week streams, Opus xhigh at full horizon; external twin ERP-Bench on the laptop (OD-12) |
| Long horizon with correct sub-workflows | AppWorld, τ² telecom (up to 9 subtasks) | per-assertion (AppWorld) and per-subtask (τ²) outcomes against F-H's own sub-workflow verdicts, $0; V's clause-attributed accuracy |
| Messy intent | nothing external (τ² solo mode removes the user [M, `corpus/tau2-bench/src/tau2/agent/llm_agent.py:306-316`, via C-obs]) | V: 12 of 24 streams start from a messy request, admitted by a model-diverse panel and an answerability lint |
| Org rules that must not break | binary success per bed | hard-violation map per bed (BG-11) and a harm guard on every supported verdict (§8.3); V's primary endpoint is zero hard violations |
| Adaptivity: tools, MCP, faults, drift | fixed per-bed facade | EnterpriseOps-Gym with distractor tools as primary mode; a fault/drift subset on beds 1–2; V's mid-stream policy amendment |
| Reuse over recurring streams; reuse by a separate program | F-reuse streams of ≤ 3 instances | WorkBench reuse streams of 10 instances × 20 templates; A-HN (Haiku + notes file) as the naive-memory baseline; V's 4-week streams |
| Cheap model beats frontier; Opus xhigh is the bar | node A (Sonnet), node C (Opus anchors) | node V tests superiority over Opus xhigh; counterfactual need router (§8.2) |

Off-vision beds (BFCL, NaturalPlan, SpreadsheetBench, DABstep) are 4 of 10 primary beds, down from 6 of 12 with about
53% of the pooled weight in rev 2 [C-obs, `estream_power.txt`].

### 3.3 Hosts

| Host | Where | Status | Role this round |
|---|---|---|---|
| Claude Code headless (`claude -p`, hardened flags, `--strict-mcp-config` with the bed facade) | this container | installed, 2.1.306 [M] | every arm of every primary bed except bed 8; V |
| Claude Code interactive + Foundry MCP | owner's laptop | available | host study (weeks 2–3) |
| Cursor, Codex (D9 order: Claude Code, Cursor, Codex) | laptop | owner's accounts; not installed here [M] | host study |
| OpenCode | laptop | allowlisted v2.0.5 [M] | host study |

The host study is within-host only (host model alone vs + Foundry MCP) on beds 1, 2 and 5 through the facade, 30 tasks per
bed per host, descriptive. L4 needs ≥ 2 hosts × ≥ 3 beds × n_eff 60; not reachable this round.

### 3.4 Holes left

- **S4 dialogue with a user, external**: none in the primary pool. τ² banking/airline need a user simulator; the official
  one is `openai/gpt-5.5` and a Haiku simulator would be the cheap arm's own model [C-obs]; descriptive only.
- **S9 async, time, ambiguity, external**: none (Gaia2/ARE partly LLM-judged [S-obs]); V covers clocks in our worlds.
- **S8 compensation, external**: none with an executable oracle; V and E8 are own evidence.
- **Multi-actor approvals, external**: ERP-Bench (Odoo images ≈ 861 MB) needs an owner decision (OD-12).
- **SWE at scale, browser/GUI, computer use, creative/media, health and legal beyond SOP rows**: not this round.
- **Hosts other than Claude Code; open-weight models; Mercury beyond the D18 allowance**: partial or none.

---

## 4. Candidate scoring and the portfolio

### 4.1 Rubric

| Criterion | Scale |
|---|---|
| **V** oracle validity | 3 = executable, deterministic, $0 gate passed by a sweep; 2 = executable, gate partly done or one known defect with a fix; 1 = executable but weak (keyword match, partly LLM-judged); 0 = LLM judge or similarity metric |
| **R** local runnability under D16 | 3 = under 500 MB, no Docker, no accounts, probed; 2 = runnable here, not yet probed; 1 = laptop Docker under 1 GB; 0 = accounts, hosted instances or over-cap images |
| **L** licence | ok (MIT/Apache/CC BY), NC (research only, per-row results out of git), ? (unstated) |
| **C** held-out class | §1 |
| **n** poolable | clusters ≥ 20 and n_eff ≥ 60 reachable |
| **$** sealed cost, rev 3 design | all arms, list price [calc, `plan3/cost4.txt`] |
| **E** adapter effort | engineer-days on top of the shared facade [S-obs, C-obs] |
| **G** coverage gain | 0–3 hole cells filled that nothing else fills |

### 4.2 Scored candidates and decisions (rev 3)

| Candidate | V | R | L | C | n | $ sealed | E | G | Decision (rev 2 → rev 3) |
|---|---|---|---|---|---|---|---|---|---|
| WorkBench @`49c7dfd` | 3 (gold 690/690; floor 124/690; digest stable) | 3 (131 MB) | MIT | H2-ext if regeneration changes answers, else H4 | 40 templates | 23 | 1 | 2 | bed 1 → **Tier 1, bed 1**, conditional on the assay screen (near ceiling: published Haiku 4.5 74.8%, Sonnet 4.6 88.3% [S-obs]); oversample multi_domain and state-changing templates |
| AgentDojo 0.1.35, v1.2.2 | 2 (utility gold 97/97; injection pairing unresolved) | 3 (166 MB) | MIT | H3 on H4 | 58 user tasks × ≥ 20 authored injections | 24 | 1.5 | 3 | bed 2 → **Tier 1, bed 2**; utility (benign and under attack) is the margin outcome, security is co-reported and enters the harm guard; out of nodes D and E |
| AppWorld 0.1.3.post1 | 3 (gold 147/147, null 0/147 on train+dev) | 3 (389 MB) | Apache-2.0 + encryption and no-look terms | **H1e** | 56 scenarios | 283 | 2–3 | 3 | bed 5 → **Tier 1, bed 3**; best validity; BG-8 probe from inside `execute(code)` |
| τ² telecom solo @`57e54143` | 2 (ENV_ASSERTION; ACTION on 32 tasks needs a BG-6 audit) | 2 (pinned; venv not built, est. 300–500 MB) | MIT | H4, possibly vendor-targeted [mem] | ≈ 34 cells | 198 | 3 | 2 | bed 4 → **Tier 2, bed 4**; relabelled policy-bound tool use (not dialogue) |
| BFCL v4 multi-turn | 3 (gold 800/800, null 0/800) | 3 (106 MB) | Apache-2.0 | H4 | ≈ 40 | 27 | 1–1.5 | 1 | bed 6 → **Tier 2, bed 5**, conditional on a $0 multi-turn and miss_func driver check through `claude -p` + MCP (otherwise that category drops); published Sonnet 4.5 − Haiku 4.5 gap 7.8 points [S-obs], so it may fail the assay screen |
| SpreadsheetBench V2, non-chart | 2 (chart tasks VLM-judged: excluded) | 2 (134 MB) | MIT (card) | H4, released 2026-09 | ≥ 20 needed | 63 | 2–3 | 1 | substitute 3 → **Tier 2, bed 6**, if its gates pass with ≥ 20 clusters |
| NaturalPlan, as an agent bed | 2 (calendar feasibility checker specified) | 3 (50 MB) | Apache-2.0 / CC BY 4.0 | H2-own via our generator, else H4 | ≈ 27 | 16 | 1–2 | 1 | bed 3 (F-build vs one call) → **Tier 2, bed 7**, every arm an agent with the code tool (§5.2) |
| EnterpriseOps-Gym csm + itsm + hr | 2 (SQL verifiers; `response_check` tasks excluded) | 1 (laptop Docker) | Apache-2.0 | H4 | ≈ 40 | 246 | 3–4 | 2 | bed 12 → **Tier 2, bed 8** (OD-7); distractor-tool mode primary; laptop BG-8 re-probe; task counts resolved first |
| DABstep-fresh | 2 only if **two independent solvers** agree | 3 (24 MB) | CC BY 4.0 | H2-own | 40 templates | 57 | 3 + second solver | 1 | bed 11 → **conditional slot 9**; else pool O. Record how the 450 hidden answers were recovered and the dataset's terms before admission |
| first scouted bed (released after 2026-06, executable oracle, D16-runnable) | ≥ 2 required | ≥ 2 | ok | H2-ext/H3/H4-recent | ≥ 20 | ≈ 27 [I] | ? | ≥ 1 | new **conditional slot 10**; chosen by fixed criteria blind to any arm outcome (§4.4) |
| SpreadsheetBench-912 | 2 (evaluator fixes specified) | 3 (96 MB) | CC BY-SA 4.0 | H4 (cases 2–3 are public: not a contamination control) | 60 | — | 2–3 | 0 | bed 7 → **substitute 1** (only if V2 fails); also pool B |
| PlanBench (regenerated) | 2 (VAL not built) | 2 | MIT | H2-own | ≈ 27 | — | 2 | 1 | bed 8 → **substitute 2** as an agent bed once a VAL-parity validator exists; pool B for the build-once form |
| ToolHop | 2 (exact `<answer>`) | 3 | Apache-2.0 | H4 (answers from world knowledge) | 80 | — | 1 | 1 | bed 9 → **substitute 3**, with format-only failures reported |
| τ² banking_knowledge + airline (Haiku user simulator) | 2 | 2 | MIT | H4 | ≈ 30 | — | +1.5 | 1 | bed 10 → **descriptive** (simulator = the cheap arm's model; not the official simulator; substring scorer; same source as bed 4) |
| NESTFUL | 3 | 3 | Apache-2.0 | H4 | ≥ 20 | — | 1 | 0 | substitute → **negative control only** (need router) |
| DS-1000 | 3 | 3 | CC BY-SA 4.0 | H4, high | — | — | 1 | 1 | substitute → **dropped** (saturated, 2022) |
| AgentArch, ITBench-Lite, TaxCalcBench TY24, MCPMark local, LegalBench, MCPGen-25, BPO-Bench, Gaia2/ARE, ERP-Bench, Spider2-DBT, and the excluded list | unchanged from rev 2 | | | | | | | | unchanged (descriptive, deferred, owner decision or excluded; recorded in DISPOSALS) |

### 4.3 Tier 1: build in the next phase

Selection: validity first (best oracle and held-out class), then owner-shape coverage per build day, among beds that run
here today. Each Tier-1 item follows the same sequence: **acquire (D16) → minimal facade → $0 gates → $0 published-result
pre-screen where one exists → scripted $0 baselines → frozen split and hashed manifest → A-H vs A-S screen on public dev
items → bed card and F-kit dev → dev pilot with every arm**. Generators, solvers and build lineages come only after the screen
passes [C-obs, cost §7].

**T1-1 WorkBench + the shared facade** (https://github.com/olly-styles/WorkBench @`49c7dfd00c03d384ec59ea57374f50b766aa5613`,
MIT, read 2026-10-21 by two sweeps).
- *Facade v0* (§5.1) is built here: tools, reset/snapshot, host-side grade, the sandboxed Python tool, the date and
  identity declaration, hardened flags, init-event logging, the meter capture.
- *Split.* Templates are clusters. Order within each domain by `sha256(salt + template_id)` with the salt taken from a later
  commit's SHA (§8.2); the first round(0.42 · n) are dev (29), the rest held out (40). Sealed: 3 regenerated instances per
  held-out template (120), **oversampling multi_domain and state-changing templates** by declared stratum weights.
- *Gates still to do.* Seed control of `workbench-generate-data`; regenerated instances pass gold replay 100% with a stable
  digest twice and **change the answers** (else H4); mutation operators wrong-argument, extra write, duplicate write.
- *$0 pre-screen.* The published per-task verdicts of 24 models give the frontier premium on dev templates before any
  paid call; Haiku 4.5 through our A-H harness on 40 shipped dev instances (≈ $3) is the harness-parity anchor.
- *Outcome.* Official `is_correct` (state-exact, so harmful side effects already fail it [I, to be confirmed in BG-11]); the
  margin is also reported on the state-changing subset, where the 18.0% do-nothing floor does not dilute it.
- *Extras.* Reuse streams (20 held-out templates × 10 instances, Haiku arms and A-HN); a fault/drift subset (20 units).

**T1-2 AgentDojo** (https://github.com/ethz-spylab/agentdojo, PyPI 0.1.35, benchmark v1.2.2, MIT).
- *Units.* (user task, condition), condition ∈ {benign, injection a, injection b}; clusters two-way (user task × injection
  task).
- *Split.* 97 user tasks ordered by hash within suite: 39 dev, 58 held out (174 units). **≥ 20 new injection tasks** (≈ $5),
  written by a session that builds nothing, hashed before any arm runs, each validated fail-to-pass by a scripted agent.
- *Gate still to do.* The 8 workspace injection tasks that did not register in the single-pairing probe.
- *Outcome.* Margin outcome: utility (benign and under attack). Security (targeted ASR) is co-reported and enters the harm
  guard; AgentDojo is left out of nodes D and E, because a typed workflow wins on security partly by construction.

**T1-3 AppWorld** (https://github.com/StonyBrookNLP/appworld, PyPI 0.1.3.post1, data 0.1.0 sha256 `fd9f9608…8250` [S-obs]).
- *Split.* Official. F-kit development on train (90) + dev (57) only. Sealed: all 56 test_normal scenarios (H1e); Haiku arms
  on 3 variants (168 tasks; F-reuse across variants); A-S on n_eff 60 (64 tasks, ≤ 2 hash-chosen variants per scenario);
  A-O anchors on 20 scenarios. test_challenge untouched.
- *Gates still to do.* Determinism (two runs, identical digest); side-effect mutants (repeat-last-write, extra field,
  touch-other-record); **BG-8 from inside `execute(code)`**: a scripted probe tries to read the decrypted ground truth,
  package and HF caches from the interpreter every arm uses.
- *Outcome.* TGC; per-assertion results kept host-side as the sub-goal measure.
- *Terms.* No looking into or tuning on test; per-task test results out of git; encrypted data never redistributed.

**T1-4 Family-factory prototype for node V** (§6). B0 (shared harness extracted), the `family.spec` compiler, and the three
V families `abr-itsm-queue`, `abr-p2p-audit`, `abr-reg-incident-clock` through gates G0–G12, with 4-week streams, a
month-end, one policy-edition amendment in week 3, and messy intake on half the streams. Seeds from **8850–8999** registered
first (OD-10). Sealed V runs wait for PREREG-V-1 (§6.6).

### 4.4 Tier 2: declared order after Tier 1

The preregistration fixes this order. A bed is skipped only for a $0 gate failure, a D16 failure, a failed headroom or assay
screen, or a cost-gate failure, recorded before any paid sealed run on it; the next substitute then takes its place.
**Scouted beds** are appended to the end of the order by dated amendment, chosen by fixed criteria (release after
2026-06, executable deterministic oracle, D16-runnable, ≥ 20 clusters, published A-S − A-H gap if any), by a session that
has seen no breadth arm outcome.

| Order | Bed | Held-out | Foundry mode | Note |
|---|---|---|---|---|
| 4 | τ² telecom, solo (`llm_agent_solo`, `dummy_user`) | H4 (+ v2.0.0-replaced subset flagged) | F-reuse per intent | official test 40 + 60 from the pool, ≤ 3 per intent × subtask × persona cell; K = 3 for the alone arms (pass^3); BG-6 audit of the ACTION component |
| 5 | BFCL v4 multi-turn (base, miss_func, miss_param, long_context) | H4 | F-live | 160 entries, 40 per category; $0 driver check for later user turns and mid-session functions |
| 6 | SpreadsheetBench V2, non-chart | H4 (2026-09) | F-live | required cells exact, untouched cells unchanged (a harm measure), final answer exact |
| 7 | NaturalPlan, agent bed | H2-own (generator) or H4 | F-reuse per task type | every arm an agent with the code tool; feasibility checker frozen before any dev look |
| 8 | EnterpriseOps-Gym csm + itsm + hr | H4 | F-live | laptop (OD-7); distractor-tool mode; no `response_check` tasks; prompts under 100K tokens |
| 9 (cond.) | DABstep-fresh | H2-own | F-reuse per template | two independent solvers by separate sessions must agree on every dev answer and ≥ 99% of the recovered answers |
| 10 (cond.) | first scouted bed | per bed | per bed | criteria above |
| sub 1 | SpreadsheetBench-912 (only if bed 6 fails) | H4 | F-live | every arm sees case 1 with its answer; cases 2–3 scored |
| sub 2 | PlanBench, agent bed | H2-own | F-live | VAL or a validator parity-tested against VAL |
| sub 3 | ToolHop | H4 | F-live | format-only failures reported |

**Pool B (build-once)**, later and descriptive: NaturalPlan, PlanBench and SpreadsheetBench-912 in their F-build form, where
Haiku builds a solver once from labelled dev instances. A fair comparator there is a frontier model given the same dev
instances, oracle feedback budget and code tool (wf-S, wf-O), not one direct call [C-obs, validity §2a; vision].

### 4.5 Generators that turn H4 beds into H2

WorkBench regeneration (bed 1), AgentDojo injection authoring (bed 2), NaturalPlan generator (bed 7), DABstep solvers
(slot 9), a τ² telecom composition check (`src/tau2/domains/telecom/tasks/manager.py` [M]).

---

## 5. Shared infrastructure

### 5.1 Bed-to-MCP facade (one adapter per bed, every host)

`experiments/breadth/facade/` (to be written; Node ESM, stdio MCP server; each Python bed runs in its own pinned venv outside
the repo).

| Piece | What it does |
|---|---|
| `tools` | the bed's tool registry as MCP tools (WorkBench's 26 functions; AgentDojo suite tools; AppWorld `execute(code)` plus API docs; τ² tools; file tools for SpreadsheetBench and DABstep) |
| `python` | **one sandboxed, network-off Python tool for every arm**, run under `src/sandbox.mjs` (masks /home, /root, /opt, /tmp, /var, /run [M, `src/sandbox.mjs:17`]); the same tool that F-H's `code` nodes use |
| `reset(task, seed)` / `snapshot()` | fresh world per task; snapshots for grading and F-reuse fallbacks |
| `grade()` | host-side only, a separate process reading snapshots; never a tool; verdicts in a host-only directory |
| context declaration | a per-bed **date note** (the bed's own "today", identical across arms; AM-9) and a fixed **synthetic identity** in place of the account's (C7), both in the arm's system prompt |
| network | the bed process under `unshare -rn`; models reach only the model route |
| session | every top-level and nested session: `--safe-mode --tools <list> --disable-slash-commands --no-session-persistence --strict-mcp-config`, inside the sandbox (`src/executors/claude-code.mjs:302-304` [M]); A arms get only the facade server, F-H the facade plus the Foundry server |
| init check | the runner records the init event (tools, MCP servers, skills and plugins count, system-prompt hash) and refuses a session whose configuration differs from its arm's frozen one; `--effort` is checked as accepted (no silent fallback) |
| meter | every session runs with `--output-format stream-json`; the runner journals each `rate_limit_event` (5-hour and 7-day utilisation, one meter for all models, resolution 0.01 [M, `research/jit-20261008/analysis/quota-meter/README.md`]) |

About 2 engineer-days once, then 0.5–1 day per bed [S-obs; C-obs]. The AB bridge and the SOP-Bench mailbox are the working
precedents [S-obs].

### 5.2 Arm parity rules (new in rev 3)

| Rule | Why |
|---|---|
| **Tools.** A-H, A-S, A-O and F-H have the same facade tools and the same `python` tool. F-H adds only the Foundry MCP server | rev 2's "no Bash" comparators against F-H's `code` nodes measured tool access [C-obs, validity §2a] |
| **Information.** The Opus-written bed card is appended to every arm's prompt; every bed-specific statement in it cites a public document line, unsourced statements are removed | otherwise node B cannot tell typed workflows from the card [C-obs, validity §2b] |
| **Identity (C7).** Before any pilot: the engine fix lands (strip the account identity or declare the synthetic one); each arm configuration answers one "what is my e-mail?" probe (pass = no account address; ≈ $0.01 each); per arm, the share of tool arguments containing the account address is logged; a send to it scores as a failure; runs before the fix are diagnostic | a workflow that looks the profile up first would be immune, turning a harness defect into a Foundry advantage [C-obs, validity §3a] |
| **Date (AM-9).** One declared date note per bed, identical across arms, tested in the dev pilot | WorkBench, AppWorld, AgentDojo, τ² and EnterpriseOps-Gym carry their own dates [C-obs] |
| **Effort.** A-H and F-H: Haiku 5.5 at `high`; A-S: Sonnet 5.5 at `high`; A-O: Opus 5.5 at `xhigh` (D19). Verdict sentences name the effort | Sonnet at `high` is not its best setting [C-obs, validity §1e] |
| **Caps.** Turn cap = the bed's official cap for every arm; wall timeout and $ reservation **per arm** = 1.5 × that arm's dev-pilot 99th percentile; cap hits, timeouts and exclusions reported per arm, a bed above 5% flagged, and a sensitivity analysis without timeout failures | a shared timeout bites Opus xhigh hardest and compresses gaps toward "non-inferior" [C-obs, validity §1d] |
| **Interleaving.** Tasks run in hashed random order; all arms of a task run together on identical reset worlds. A bed's sealed run starts only when all its arms can run interleaved; otherwise it waits | D19's Opus hold and window timing could push A-O out of step; hashed order makes a stopped bed an unbiased paired subset [C-obs, validity §3d, §6] |
| **CLI.** Pinned by hash (C2); version recorded per run | |
| **Engine.** One named freeze, **without network-capable node capabilities** (track #80 is adding them) | |
| **Cost.** CPS recorded as billed and on a cache-neutral basis; a completeness check sums every F-H nested and gateway call against the journaled tokens at policy prices | prompt-cache hits depend on wave order; an under-count favours node A's cost half [C-obs, validity §3e] |

Not possible this round: a frontier harness-parity anchor (validity §2d). `policy/models.json` lists Haiku 4.5 but no older
Sonnet or Opus with published per-task results [M]; adding one is OD-16. The Haiku 4.5 anchors on WorkBench and BFCL remain
the only harness check, so the A arms are labelled "our harness".

### 5.3 F-kit v1: what the Foundry arm is

One Foundry arm per bed, frozen by hash before the sealed run. Bed-agnostic core; per-bed card shared with every arm.

1. **Architect: Opus 5.5.** Bed-agnostic skeletons in the A1-C lineage (discover → requirement ledger → plan → act → verify)
   as typed workflows with narrow `agent`, `code` and `verify` nodes. Per bed, Opus writes the bed card from public docs, the
   tool schema and dev tasks only (≤ $5 per bed). **All primary and substitute bed cards are written and hashed before the
   first sealed run** (≈ $65); a later edit is allowed only on that bed's dev evidence, by a session that has seen no sealed
   outcome, as a logged diff.
2. **Construct and execute: Haiku 5.5** (or the F-HM variant if frozen, §8.2). A trivial workflow (one agent node) is allowed.
3. **Gating acceptance.** A run whose own `verify` fails ends as a failure.
4. **F-reuse** (beds 1, 2, 3, 4, 7, slot 9): after a run whose own verification passes, the workflow is kept for that
   cluster; the next instance passes a typed applicability gate and runs it; a refusal or deopt falls back to construction.
   No oracle feedback on sealed instances. Lineages = random stream orders (3; 2 on AppWorld, τ², EnterpriseOps-Gym [C-obs,
   cost §6]).
5. **F-live** (beds 5, 6, 8): construction per task, no cross-task reuse.
6. **F-build** only in pool B (§4.4).
7. **Budgets.** Same caps as the A arms (§5.2); construction and verification cost charged to the task; prompts under 100K
   tokens (Haiku's price rises to $0.50 / $2.50 per MTok above it [M, `policy/models.json`]).
8. **Dev discipline.** Kit iteration on dev splits only; ≤ 3 looks at a dev hold-back per bed; ≤ $15 of F-H dev spend per
   bed; comparator dev arms run once and are cached by (split, model, effort, harness hash, CLI version).

### 5.4 The $0 oracle-validity gate (every bed, before any paid call)

| Gate | Check | Blocks the bed if |
|---|---|---|
| BG-0 provenance | URL, revision, sha256, size, licence, date (D16); release and cut-off ledger row | anything missing |
| BG-1 gold replay | official gold through the facade scores 100%; gold length recorded per task (horizon covariate) | < 100% |
| BG-2 floors | do-nothing, constant-answer and replay agents scored; these are the scripted $0 baselines | not reported; a floor above 10% makes the state-changing or discordant subset a co-headline |
| BG-3 mutation | ≥ 3 operators (drop, duplicate or extra write, wrong argument; side-effect operators where state is written), ≥ 95% killed | < 95% |
| BG-4 determinism | two runs give an identical digest | any difference |
| BG-5 judge-free | no LLM judge in the reward | judge present |
| BG-6 alternative-valid answers | valid non-golden answers accepted (NaturalPlan lesson; τ² ACTION on 32 tasks) | valid answers rejected |
| BG-7 evaluator defaults | evaluator reads model output, not inputs; every item parses | defect unfixed |
| BG-8 leakage, **from inside** | gold, sealed manifests and verdicts unreachable from arm workdirs **and from the bed's own code-execution path** (AppWorld `execute`, the `python` tool, package and HF caches; `corpus/tau2-bench` holds every telecom assertion) — a scripted probe asserts it | any path reachable |
| BG-9 ABC map | the bed's Agentic Benchmark Checklist row (T.1–T.10, R.1–R.13), trivial-agent results included | missing |
| **BG-10 oracle frozen first** | every declared oracle fix (NaturalPlan feasibility checker, SpreadsheetBench evaluator, AppWorld side-effect mutants) is frozen by hash before any F-kit dev look or build sees oracle feedback | a build learned from an unfixed oracle (its lineage is void) |
| **BG-11 hard-violation map** | per bed, the frozen list of hard violations (harmful side effect, security failure, forbidden write, collateral damage, invariant break, untouched cell changed) and whether the primary outcome already fails on each | missing |

Status [S-obs]: WorkBench BG-1/2/4 done, BG-3 one operator; AppWorld BG-1/2 on train+dev; BFCL-MT BG-1/2; AgentDojo BG-1/2
for utility; NaturalPlan BG-6 fails on calendar (fix specified); others not started.

### 5.5 Contamination and leakage controls

**Direction of bias is not established** [C-obs, validity §4a]. Pretraining memorization may favour the larger models
(conservative for non-inferiority), but three routes favour F-H: Opus's memory of public beds passing into bed cards (the
library scan checks only literal n-grams), vendor post-training toward reported benchmarks [mem], and distilled small models
inheriting it. So:

1. **Probe battery** per bed on **≥ 100 non-sealed items** (dev plus unused public pools; AgentDojo has only 39 dev user
   tasks, so its probe draws on unused pools and detects +11.7 points at n = 39 [C-obs]), for **Haiku 5.5, Sonnet 5.5 and Opus
   5.5** (Opus is an arm and the architect): slot guessing on masked task fields (TS-Guessing), verbatim continuation of
   task-file lines, canary completion where a canary exists, and a paraphrase comparison. Exact one-sided tests at 0.05.
   A flagged H4 bed is not admitted; a flagged H1e–H3 bed is admitted with the flag. ≈ $5–15 per bed. The rev-2 probe (gold
   actions without the world) is dropped: it cannot succeed on agentic beds memorized or not.
2. **Fresh vs public**, pooled difference in differences (WorkBench shipped vs regenerated; τ² v2.0.0-replaced vs unchanged;
   NaturalPlan public vs generated): per arm gap = success(public) − success(fresh); signal = pooled (gap F-H − gap A-S),
   one-sided against 0.05, ≥ 60 items per side per bed.
3. **Card sourcing.** Every bed-specific statement in a card cites a public document line (§5.2); the library leakage scan
   also covers cards and kept workflows (hashed n-grams of sealed task text and gold; a hit voids that lineage on that bed).
4. **No network and no benchmark files** in the arm sandbox (BG-8 from inside).
5. **Log audit of every sealed run** (HAL found an official τ-bench scaffold shipping test examples only by reading logs
   [doc, arXiv 2510.11977]): scripted greps for the benchmark name, HuggingFace, repository URLs and gold file names over every
   transcript as it closes; a session that built nothing reads all failures and a random 10% of passes and may only flag.
   **Reclassification follows a deterministic rule declared now** (PREREG §8.1) and is applied by script, the same for every
   arm.
6. **H1e/H2-ext/H3-only analysis** as a robustness check with teeth (§1).

### 5.6 Disk, installs and run data

Disk free during writing: **2.8–3.7 GB** of 252 GB (other tracks writing) [M, `df -h /` at 22:4x and 22:55Z];
`/var/tmp/foundry-work` holds 3.7 GB of other tracks' data [M, `du`]. D16: ≤ 500 MB per install, ≤ 1.5 GB in total.

| Stage | Installs live at once | Approx. MB |
|---|---|---|
| Tier-1 development | WorkBench 131, AgentDojo 166, AppWorld 389 (173 wheels + 216 data), factory ≈ 60 peak (UCI CSV deleted after parameter extraction) | ≈ 750 |
| Tier-1 sealed runs | only the bed that is running | ≤ 400 |
| Tier-2 development | τ² venv (300–500, unverified), BFCL 106, SpreadsheetBench V2 134, NaturalPlan 50; Tier-1 installs deleted after their sealed runs | ≤ 800 |

Rules: `df` before each install; an install starts only with ≥ 1.5 GB free; one sealed bed's install live at a time.
**Run data** (rev 2 kept all F-H transcripts, which made later audits one-sided and grew kept data to 0.64–0.88 GB [C-obs,
cost §4]): **the same retention for every arm** — transcripts of failures and of a seeded 10% sample of passes are kept,
gzipped on close after the log audit; every run's structured record and hash is journaled; kept data ≤ 300 MB on disk,
moved off-box weekly by the owner or deleted after the analysis hash is recorded (OD-1 note). Transcripts may carry the
account address until the C7 fix: they stay out of git (D17). The Foundry run-store size per task is measured in the dev
pilots. A bed whose run data would push free disk below 1 GB pauses.

---

## 6. Family factory (Tier 1 prototype) and node V

### 6.1 Why

The 12 AB-R families are 37,463 Python lines; at most 24% is shared, and `family.json` has 39 top-level keys of which 22 are
common [S-obs]. On `abr-fin-apintake` the gates pass (reference 462/462, 1,968/1,968 mutants killed), yet the 23 one-defect
controls pass 84–100% of triggers and 7 of 23 leave a clean week on 2 streams [S-obs]: per-trigger rates hide defects, so
**clean periods, hard-requirement violations and clause-attributed accuracy** are the headline metrics.

### 6.2 Design (recurring-synthesis sweep §5, adopted; changes marked [I])

- **One spec, four artifacts.** `family.spec` compiles to POLICY.md, generator + truth engine, oracle, observable-only
  reference and controls (Anchor, arXiv 2605.26321 [doc]).
- **N-version where it buys validity**: the truth engine reads latent state; the reference reads only tool-visible state;
  they share the spec, not code, and must agree on every dev stream.
- **Traps are metamorphic operators with a declared resolving clause**, kept only if they flip the truth or break a named
  control: T-clock, T-drift, T-partial, T-conflict, T-retract, T-replay, T-burst, T-irrelevant.
- **LLMs write the spec and the phrasebank once.** A phrase is admitted only if the reference classifies it as intended **and
  a model-diverse panel** (Haiku 5.5, Sonnet 5.5, Mercury 3; 2 of 3) does, **plus an answerability lint** (every slot the truth
  needs is recoverable from the text). Rev 2's Haiku-only panel filtered toward text the cheap model reads easily [C-obs,
  vision]. Generation and grading are deterministic and $0; only parameters cross from real logs (THESIS D10).
- **Pipeline** F0 source card → F1 spec (Opus) → F2 lint → F3 phrasebank → F4 compile → F5 gates → F6 pilot → F7 freeze with
  a results-blind edit log → F8 tiers.
- **Host neutrality** [I]: families run on the AutomationBench host today; the spec's `host` field also targets a
  `sqlite-mcp` host served through the facade.

### 6.3 Oracle-validity gates (block a family; all $0 unless priced)

| Gate | Check | Bar |
|---|---|---|
| G0 spec lint | every trap has a resolving clause; resolving inputs reachable; every effect has a predicate; every clause exercised | no miss |
| G1 determinism | identical hashes for world0, triggers, truth, end; round trip | identical |
| G2 **solvability** | observable-only reference passes every trigger and period on practice and dev streams | 100% |
| G3 necessity | removing any effect or clause makes the oracle fail somewhere | no decorative clause |
| G4 generator–reference agreement | same effect signatures on every dev stream | 100% |
| G5 **triviality attack and controls** (the scripted $0 baselines) | null passes exactly the no-op share; echo 0; naive ≤ 40-line control < 0.60 per trigger at d3; memoryless < 0.90 and no clean period; one control per clause and trap kind, each detected | every control fails and is detected |
| G6 trap validity | fail-to-pass per trap; each trap kind ≥ 5 times over 4 dev streams | all kept traps valid |
| G7 metamorphic invariance | renames, base-week shifts, permuted independent triggers leave the reference at 100% | unchanged |
| G8 blind arm (≈ $0.05) | Haiku with POLICY.md + payload, no tools | below no-op share + 0.15 |
| G9 second reader (≈ $0.3) | a session that did not write the family derives 20 practice outcomes | every disagreement fixed and logged |
| G10 **mutation score** | incl. Abrich side-effect operators and per-kind count assertions; policy-neutral variants accepted | ≥ 0.95; `ab_disagree == 0` |
| G11 differential tier (sample) | Haiku agent vs Sonnet agent on one stream ($5–12) | flag if Haiku beats Sonnet by more than a preset margin |
| G12 leakage and parity | truth and reference host-only; `abr-apply` equals the app's own model path | no leak |
| **Reference workflow** | `wf-O`: the builder-kit skeleton completed by Opus on practice streams only | reported as the ceiling |

Admission to held-out: a session that did not write the family and has seen no arm results runs G0–G12 and prints
aggregates only.

### 6.4 Build order with falsifiers

| Step | What | Cost | Falsifier or prediction [I unless noted] |
|---|---|---|---|
| B0 | extract the shared harness and gate skeleton into `experiments/autobench/abr/lib` | $0, ~1 day | all 12 families' gate JSONs identical before and after |
| B1 | parity re-spec of `abr-mkt-reviews` (pin the commit) | $0 | falsified if spec + plugins exceed 50% of the original lines, or any trap kind, control or mutation operator is lost |
| B2 | generated controls, Abrich operators and G3/G6/G7/G8 on all 12 families | $0 + ≈ $0.6 | G3 or G6 flags a decorative clause or inert trap in ≥ 3 of 12 |
| **B3** | **the three V families (§6.5), 4-week streams with month-end, a week-3 policy amendment, messy intake variants** | ≈ 3 × $2 spec + ≈ $2 panel; gates $0 | each passes G0–G12 within two review rounds |
| B4 | effective-breadth count (single linkage on clause/trap/state/app signature, preregistered τ = 0.35) | $0 | if the new families fall into existing clusters, stop and redirect |
| B5 | factory T0–T2 tiers on all; T3 on survivors | $60–150 | — |

**Seed block** (OD-10): factory and AB-R held-out seeds move to **8850–8999**, registered in `SEED-LEDGER.json` before any
generation; the AB-R README's 8801+ collides with `need-heldout` (8801–8848) and AB-R dev 601–650 overlaps `need-example`/
`need-label` [M, `research/jit-20261008/SEED-LEDGER.json`]. V's 24 sealed streams take 8850–8873; dev streams come from a
separate dev block.

### 6.5 The three V families

| | `abr-reg-incident-clock` | `abr-itsm-queue` | `abr-p2p-audit` |
|---|---|---|---|
| Enterprise bar | regulatory incident clocks (NIS2-style) | E7: incident → problem → change, SLA pause/resume, CAB approval | E1: three-way match, hold and release, separation of duties |
| Adapter | A3 statute-derived clocks | A1 log-calibrated stream | A2 clean population + injected violations |
| Source | NIS2 Art. 23(4) structure; GDPR Art. 12(3) for a DSAR variant; `holidays` 0.107 (MIT) [S-obs]; fictional policies, never legal claims | UCI incident log ID 498 (CC BY 4.0): parameters only [S-obs] | ProcureChange OCEL (Zenodo 22079246, CC BY 4.0): only the 7.4 MB P2P JSON from the 1,158 MB record [S-obs] |
| Golden tests | public worked examples of the rule text | the log's mined SLA thresholds | D365-style tolerance tables [C-obs, vision] |
| Traps | T-clock (DST, weekend, month-end), T-authority, T-lookalike, T-stale, T-repeat, T-retract | T-burst, T-replay, T-partial, T-conflict | T-lookalike vendor, T-replay, T-conflict, injected SoD and match violations |
| Hard requirement | schedule + audit; retraction as compensation | schedule; approvals | approval + audit; hold and release |
| Third oracle | clock engine as a pure function, property-tested (Hypothesis 6.170.5, MPL-2.0) | clock engine; AB handler cross-check | the injection log (exact labels) |
| Distinctness risk | low | overlaps `abr-ops-slawatch` and E7: if B4 puts it within τ of either, swap in `abr-erp-dunning` | low |

### 6.6 Node V: enterprise streams against Opus xhigh at full horizon (own preregistration)

Proposed by the vision critique as the single most important addition; adopted with its numbers [C-obs,
`critic-owner2/estream_power.py`].

- **Units.** A stream = 4 simulated weeks of one family's triggers with a month-end and one policy-edition amendment in week
  3. 24 sealed streams (8 per family) from seeds 8850–8873; 12 of the 24 start from a messy natural-language request instead
  of POLICY.md.
- **Arms.** F-H: Haiku constructs once per stream from the factory builder kit and runs the whole stream, adapting at the
  amendment (2 lineages). A-H, A-S: Haiku alone and Sonnet alone as agents. **A-O: Opus 5.5 xhigh as one long Claude Code
  session per stream with a notes file, no rebasing** (the B0+N baseline and the natural frontier deployment). wf-O: an
  Opus-built workflow, reported as the ceiling. F-HM (Mercury planner/checker + Haiku acting) if OD-11 allows. Every arm under
  §5.2's parity rules.
- **Endpoints.** Primary: **clean stream** (zero hard violations and every period passing). Secondary: clause-attributed
  accuracy (the sub-workflow measure), cost per clean stream, the amendment week's pass rate.
- **Test.** Superiority of F-H over A-O on clean streams, exact one-sided McNemar at 0.025 (its own α; never pooled with
  the external beds). Power: 0.81 at 0.75 vs 0.35, 0.35 at 0.70 vs 0.45, size ≈ 0.01 at 0.50 vs 0.50; 32 streams give 0.91
  and 0.49 [C-obs]. Sonnet and Haiku contrasts are secondary.
- **Independence controls** (own beds are kept out of the external pool for these reasons): specs from public rule text with
  public worked examples as golden tests; the spec author is isolated from F-kit and card authors; the truth engine is
  N-version against the observable-only reference; G11 and wf-O are reported; V is never pooled with external beds. The
  external twin is ERP-Bench per-pattern streams on the laptop (fresh `generate-tasks` instances, CP-SAT-certified verifier,
  CC0 per metadata), which needs OD-12 for its ≈ 861 MB images.
- **Cost** [C-obs, I]: $350–880 in total (A-O ≈ $8–20 per stream); 25–45 frontier session-hours. Funded by thinning A-S and
  moving Opus to anchors on the external beds: rev 3's sealed primary is ≈ $815 below rev 2's (§10).
- **Freeze.** PREREG-V-1 is drafted after B3's gates pass and before any V arm runs; dev streams only until then.

### 6.7 The factory's own claim

Separate from the external portfolio and from V. Per family, paired comparison of clean-period rate and hard-violation count,
wf-H against agent-H, agent-S and agent-O. Across families, random effects on family-level paired differences as primary,
exact sign test as the robust secondary (12 families: power 0.39 at a true win rate of 0.75; 24: 0.77 [S-obs calc]).

---

## 7. Own beds and concurrent sealed runs: reported beside the portfolio

| Pool | Members | Condition to enter | Owner track | Cost to breadth |
|---|---|---|---|---|
| **X: extended external** | primary beds + AB-v1 test + SOP-Bench phase 2 sealed | AB-v1: a Haiku + Foundry arm and A0-S / A0-O xhigh on the same test tasks (OD-8). SOP-Bench: a dated amendment adds A-S and A-O xhigh on sealed rows **before any sealed aggregate is read** (OD-9; ≈ $30 Sonnet k = 1 plus ≈ $70–85 Opus [C-obs]). Any frontier arm added after a sealed run started is labelled **"non-concurrent comparator"** | AB track; SOP track | $0 |
| **V: enterprise streams** | §6.6 | PREREG-V-1 | breadth | $350–880 |
| **O: own beds** | E8 sized world; BUILDER-1 fresh-author set; Tier-A beds on fresh seeds (consumed from need-router rows); DABstep-fresh if its two solvers disagree | prereg per track | E-bed, surface, need-router tracks | Sonnet additions ≈ $20–40 |
| **B: build-once** | NaturalPlan, PlanBench, SpreadsheetBench-912 in F-build form, with wf-S / wf-O builders as comparators | later; own addendum | breadth | not budgeted this round |
| **F: factory families** | §6.7 | G0–G12 | breadth | in factory budget |

Own beds stay out of the primary pool because their generators, oracles and often tasks were written by the architect's
model family. H2-own beds in the primary pool (NaturalPlan, DABstep-fresh) carry the same risk in weaker form; they are
flagged and dropped in the H1e/H2-ext/H3-only analysis.

---

## 8. The breadth-claim protocol (summary)

Full text: [PREREG-BREADTH-v0.md](PREREG-BREADTH-v0.md).

### 8.1 Beds and verdict date

Ten primary beds in declared order (§4.3–4.4) with substitutes; the verdict is computed once, on the beds complete by
**2026-11-18** (OD-13; rev 2 had 11-11, which the build effort and the 7-day window do not support [C-obs, cost §3]); it needs
B ≥ 8, otherwise "underpowered, B = k". Descriptive interim reports at 3 and 6 complete beds; a non-binding refutation stop
of comparator arms if the pooled upper bound already excludes the margin.

### 8.2 Arms

| Arm | Where | Depth |
|---|---|---|
| A-H Haiku 5.5 alone | every bed | full sample, K = 2 (3 on τ²) |
| F-H Haiku 5.5 + Foundry | every bed | full sample, 3 lineages (2 on AppWorld, τ², EnterpriseOps-Gym) |
| A-S Sonnet 5.5 alone (high) | every bed | **n_eff 60** per bed (cluster-capped), K = 2 (3 on τ²) |
| A-O Opus 5.5 alone (xhigh) | **every bed** | **20-task anchors**, one task per cluster, K = 2 (3 on τ²); full depth on a bed only through the Opus depth gate (pooled dev F-H − A-O ≥ −0.02, decided at the freeze) |
| A-HN Haiku 5.5 + notes file | beds 1–3 | full sample, K = 2: the naive-memory control (same tools and card; a notes file carried along each cluster stream) |
| F-HM Mercury 3 planner/checker + Haiku acting | beds 1–3 dev, V | if OD-11 raises D18 and F-HM's pooled dev success on beds 1–3 exceeds F-H's by ≥ 3 points, **F-HM becomes the frozen Foundry arm** for every bed (declared rule, dev only); otherwise descriptive |

Not arms: Haiku 4.5 parity anchors, published per-task frontier results, cached dev comparators.

**Counterfactual need router** (≈ $2): frozen before any sealed outcome; per task it picks A-H, F-H or escalate. Every arm
runs on identical worlds, so the routed policy's success and CPS are observed directly (escalation to A-O only on anchor
tasks; otherwise to A-S). Descriptive. It also stops F-H being forced onto beds where the best workflow is none.

### 8.3 Hypotheses, graph, wording gate, harm guard

- **Within a bed.** Paired task-level differences; cluster-robust CR1 with t on G − 1 df, or Tango's score test with a design
  effect; bootstrap only with ≥ 30 clusters; Bayesian paired interval where G < 20 (the anchors); AgentDojo two-way
  clustering as a sensitivity. F-build between-lineage variance no longer applies (pool B).
- **Across beds.** Paule-Mandel τ², modified Hartung-Knapp (never narrower than the fixed-effect SE; Röver et al., arXiv
  1508.01227 [doc]), t on B − 1 df, one-sided 0.025; REML, macro-t and DerSimonian-Laird as sensitivities; prediction interval
  on B − 2 df.
- **Claim graph** (PREREG §5.3). Node **A** = H1-S (pooled F-H − A-S > −0.10) ∧ H2-S (pooled CPS ratio F-H / A-S ≤ 0.5), α
  0.025. If A holds, α splits 0.0125 / 0.0125 to node **B** = H3 (F-H − A-H > 0) and node **C** = H1-O ∧ H2-O **pooled over the
  Opus anchors of every primary bed**; a node that holds passes its α to the other. Node **D** ("beats Sonnet") after A, B, C;
  node **E** ("beats Opus xhigh") after D. AgentDojo is excluded from D and E.
- **Wording gate** (no α): the words "non-inferior" and "matches" need node A **and** the retention test at f = ½ (per task
  L_t = ȳ(F-H) − ½ȳ(A-S) − ½ȳ(A-H), lower bound > 0). Otherwise: "within 10 points, retaining r̂ of the premium".
- **Assay label** on every verdict (pooled A-S − A-H: informative / weakly informative / uninformative), and r with its
  Fieller interval.
- **Harm guard** (no α): no "Supported" verdict if the pooled harm difference F-H − A-S (beds with a BG-11 harm definition) has
  a lower 97.5% bound above 0. Non-inferiority on harm at +0.05 is a declared secondary. A co-primary harm NI test was
  considered and rejected: at n_eff 60 on six harm-bearing beds and equal harm rates of 3–15%, it passes with probability
  0.07–0.10 at a +0.02 margin and 0.45–0.62 at +0.05 [calc, `plan3/harm_guard.txt`], which would sink node A. Most beds'
  primary outcomes are state-exact, so a hard violation is already a task failure (BG-11 records which).
- **Node V** is a separate preregistration with its own α (§6.6).

### 8.4 Gates before sealed comparator money

1. **Screen before build** (per bed): $0 published per-task pre-screen where one exists; then A-H vs A-S on ≥ 30 public dev
   items with the minimal facade (no F-kit). **Headroom**: skip if both ≥ 0.90, or A-S < 0.10. **Assay**: enter if A-S − A-H
   ≥ 0.20 at 30 pairs; extend to **60 pairs** if it lies in [0, 0.20) and enter if ≥ 0.10 at 60; otherwise "no frontier premium
   here" (cost compared only). At 30 pairs the SE is about 0.10: a bed with a true 0.15 lift was skipped 31% of the time [C-obs].
2. **Portfolio dev gate**: after the dev pilots of beds 1–3 (≈ 180 pairs, SE ≈ 0.04), sealed comparator arms start only if the
   pooled dev F-H − A-S ≥ −0.03. Otherwise the F-kit iterates on dev (looks counted) and Haiku arms may run sealed alone.
3. **Opus depth gate** (§8.2).
4. **Run order**: cheap beds first (1, 2, then 5–7), before committing to AppWorld, τ² and EnterpriseOps-Gym sealed.

### 8.5 Stopping

No efficacy stop. **No futility look** (rev 2's cut was calibrated on 202 independent pairs; at n_eff 62–133 its false stop
rate is 0.05–0.14, and recalibrated it stops only about 21% of beds at a true −0.10 [C-obs, cost §5]). Cost caps stop a bed;
with hashed task order its completed tasks are an unbiased paired subset. Invalid-evaluator and leakage voids as before.
Infrastructure faults are re-run from a fresh reset until cleared (≤ 3 tries); after that the task leaves every arm, listed.

### 8.6 Power (rev 3)

[calc, `plan3/power3.py` → `power3.txt`; same simulation model as rev 2's `graph_power.py`; 2,000 replications, 3,000 for
size; A-S n_eff 60; node C over 20-task anchors on every bed, discordance 0.30; lift F-H − A-H mean 0.10, τ 0.10; τ of log CPS
0.4; true CPS ratio 0.30.]

| True F-H − A-S | τ | Opus premium | B | P(A) | P(A ∧ retention) | P(A ∧ B) | P(A ∧ C) |
|---|---|---|---|---|---|---|---|
| 0 | 0.05 | 0 | 8 / 10 | 0.69 / 0.85 | 0.30 / 0.38 | 0.38 / 0.56 | 0.26 / 0.38 |
| 0 | 0.10 | 0 | 8 / 10 | 0.47 / 0.61 | 0.22 / 0.28 | 0.28 / 0.43 | 0.20 / 0.29 |
| −0.03 | 0.05 | 0.05 | 8 / 10 | 0.47 / 0.60 | 0.16 / 0.21 | 0.26 / 0.40 | 0.02 / 0.04 |
| −0.03 | 0.10 | 0.05 | 8 / 10 | 0.27 / 0.37 | 0.12 / 0.14 | 0.18 / 0.26 | 0.03 / 0.04 |
| −0.05 | 0.05 | 0.05 | 8 / 10 | 0.26 / 0.36 | 0.09 / 0.11 | 0.16 / 0.25 | 0.01 / 0.01 |
| −0.05 | 0.10 | 0.05 | 8 / 10 | 0.16 / 0.20 | 0.07 / 0.08 | 0.11 / 0.15 | 0.01 / 0.02 |
| size: true −0.10 (A); F-H 0.10 below Opus (C) | 0.05 | | 8 / 10 | 0.013 / 0.018 | | | 0.012 / 0.017 |

Rev 2's design (12 beds, A-S n_eff 80, Opus full on 8) gives P(A) 0.95 / 0.80 / 0.54 at true 0 / −0.03 / −0.05 (τ 0.05) on the
same draws; rev 3 gives up that power where rev 2 bought it with invalid beds (§15, V1). Reading: node A is reachable only if
the kit closes the dev gap (hence §8.4.2); node C is a stretch if Opus is 5 points better than Sonnet; superiority over Opus is
testable in V, not here. Raising B with valid scouted beds is the efficient lever (P(A) 0.69 → 0.85 from 8 to 10 beds).

---

## 9. Schedule within usage limits

### 9.1 Usage model and rules

- **What binds.** One plan allowance shared by every agent and model; usage credits are off, so a limit pauses everything.
  The **7-day window** binds before the 5-hour one: across 10 E8 and composition transcripts, 7-day meter movement was 3.0–5.0×
  smaller per dollar than 5-hour movement, so a week holds about 3.9 five-hour windows [C-obs, cost §2, `meter_scan.py`]. Lower
  bounds from one Opus run: a 5-hour window holds ≥ about $95 and a week ≥ about $250 of Opus list price; no upper bound known.
- **Rules** [I]:
  1. **Day-1 dose test** (cents): `probe-meter.mjs` on a quiet account gives dollars per 0.01 tick for both windows by model
     [M, `research/jit-20261008/R0-RUNBOOK.md` G5]. Every breadth runner journals `rate_limit_event` before and after each
     session; the cost table gains a meter column from the dev pilots.
  2. **Start gate**: a wave starts only at 5h ≤ 0.60 and 7d ≤ 0.80 (G5); no new breadth session at 5h ≥ 0.80.
  3. **Weekly share**: breadth uses at most 35% of the 7-day window per week, sized from the dose test (OD-14, since other
     tracks share it). One account-wide meter governor is recommended to the orchestrator.
  4. **Lanes**: at most 6 concurrent runner sessions (at most 3 Sonnet or Opus) and 2 build agents.
  5. **Build agents**: Haiku 5.5 at `max` writes adapter code (OPERATING-PRINCIPLES §7; a Haiku xhigh builder cost $0.21 against
     Opus xhigh $2.27 for a comparable C0 build [C-obs]); Opus reviews. Build-agent meter draw is journaled like any run.
  6. **Resumable runners**; journal committed (structured records only) before each wave; waits use scheduled reminders.
  7. **Other tracks' windows**: no breadth paid run during the AB-v1 test window; Opus arms after the SOP-Bench sealed run
     finishes (D19), and a bed's sealed run waits until all its arms can interleave (§5.2).
- **Owner option (OD-15)**: comparator arms on owner-provisioned API billing would move about 71% of breadth's sealed draw off
  the plan meter, at real money ≈ $690 list for A-S and A-O on ten beds [calc].
- **Load.** Ten beds: ≈ 9,000 sessions, ≈ 255 session-hours, 61 of them frontier [calc]; V adds 25–45 frontier hours.

### 9.2 Days

The 3-day plan (`research/PLAN-3DAY-20261021.md`) owns 10-22 to 10-24. Tier-1 build effort ≈ 13–15 engineer-days [I, from
C-obs per-bed estimates: facade 2 + meter 0.5 + WorkBench 1 + AgentDojo 1.5 + AppWorld 2–3 + factory B0/B3 ≈ 5–6 + audit and
analysis tooling ≈ 1–2], so about 7 days at 2 build agents.

| Days | $0 work | Paid work (window-aware) | Gate |
|---|---|---|---|
| Thu 10-22 | dose test; C7 engine fix handed to the engine track; identity probes; seed block 8850–8999 registered; facade v0 + WorkBench (D16), seed control, mutation operators; factory B0 | dose test and identity probes (< $0.10) | WorkBench BG-0…BG-11 |
| Fri 10-23 (AB-v1 test day) | AgentDojo reinstall, pairings; AppWorld install, determinism, side-effect mutants, BG-8 from inside `execute`; factory spec compiler | outside the AB window only: injection authoring (≈ $5) | AgentDojo and AppWorld gates |
| Sat 10-24 – Mon 10-26 | published pre-screens; split salts from a later commit; all bed cards written and hashed (≈ $65); factory B3 specs and gates | A-H vs A-S screens on dev (≈ $15); probe batteries (≈ $30); F-kit dev looks (≤ $45) | screens for beds 1–3 |
| Tue 10-27 – Thu 10-29 | analysis script with tests against the simulations; log-audit tooling | dev pilots for beds 1–3 with every arm (≈ $90); F-HM dev looks (Mercury, off the Claude meter) | **portfolio dev gate**; PREREG-BREADTH v1 frozen for beds 1–3 if it passes |
| from 10-30 | Tier-2 adapters (τ², BFCL, SpreadsheetBench V2, NaturalPlan) by Haiku-max builders; PREREG-V-1 | sealed WorkBench and AgentDojo, then AppWorld (if the gate passed); V dev streams | interim 1 at 3 beds |
| 11-02 – 11-15 | EnterpriseOps-Gym on the laptop (OD-7); scouting for slot 10 | sealed beds 4–8 in run order; V sealed | interim 2 at 6 beds |
| 11-18 | final pooled analysis; REPORT.md | — | verdict |

---

## 10. Cost table

### 10.1 Per-task anchors (list price, CLI route with prompt caching)

| Anchor | Value | Source |
|---|---|---|
| AB agent task, Haiku 5.5 | $0.011–0.016 | DEV60, DEVCHECK [M] |
| AB agent task, Haiku + A1 / A1-C | $0.015–0.040 / $0.030–0.037 | DEVCHECK [S-obs] |
| AB agent task, Sonnet 5.5 alone | $0.099–0.101 (7.6–8.8× Haiku per task) | [S-obs] |
| Opus 5.5 vs Sonnet per task | 1.94× measured at default effort on the records agent arms, n = 24 [C-obs, `research/need-router-20261014/replay-archived.txt`]; 2.5× assumed for xhigh, 4× as sensitivity | [I] |
| Prices | Haiku $0.10/$0.50 (≤ 100K prompt), Sonnet $2/$10, Opus $4/$20 per MTok | `policy/models.json` [M] |

F-H on agent beds is priced at 2× A-H per run; the measured devCheck ratio is 2.5× (+≈ $45 on ten beds if it holds).

### 10.2 Sealed runs, rev 3 design

[calc, `plan3/cost4.py` → `cost4.txt`]

| # | Bed | Haiku tasks (clusters) | A-S tasks (n_eff) | $ A-H | $ F-H | $ A-S | $ A-O (20 × K) | **Sealed $** | Sessions | Session-h | Frontier h |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | WorkBench | 120 (40) | 77 (60) | 1.9 | 5.8 | 9.2 | 6.0 | **23** | 794 | 9.3 | 2.3 |
| 2 | AgentDojo | 174 (58) | 61 (60) | 2.8 | 8.4 | 7.3 | 6.0 | **24** | 1,032 | 13.8 | 2.2 |
| 3 | AppWorld | 168 (56) | 64 (60) | 33.6 | 67.2 | 102.4 | 80.0 | **283** | 840 | 70.0 | 14.0 |
| | **Tier 1 (beds 1–3)** | | | 38 | 81 | 119 | 92 | **331** | 2,666 | 93 | 18 |
| 4 | τ² telecom (K = 3) | 100 (34) | 75 (60) | 15.0 | 16.0 | 101.2 | 66.0 | **198** | 785 | 39.2 | 14.2 |
| 5 | BFCL-MT | 160 (40) | 69 (60) | 1.9 | 5.8 | 11.0 | 8.0 | **27** | 978 | 11.4 | 2.1 |
| 6 | SpreadsheetBench V2 | 120 (60) | 60 (60) | 7.2 | 21.6 | 18.0 | 16.0 | **63** | 760 | 25.3 | 5.3 |
| 7 | NaturalPlan (agent) | 270 (27) | 77 (60) | 2.2 | 6.5 | 4.6 | 3.0 | **16** | 1,544 | 12.9 | 1.6 |
| 8 | EnterpriseOps-Gym (laptop) | 120 (40) | 69 (60) | 19.2 | 36.0 | 110.4 | 80.0 | **246** | 658 | 43.9 | 11.9 |
| | **Core 8** | | | 84 | 167 | 364 | 265 | **≈ 880** | 7,391 | 226 | 54 |
| 9 | DABstep-fresh (cond.) | 120 (40) | 77 (60) | 4.8 | 14.4 | 23.1 | 14.8 | **57** | 794 | 19.9 | 4.8 |
| 10 | scouted bed (cond.) | 120 (30) | 80 (60) | 1.4 | 4.3 | 12.8 | 8.0 | **27** | 800 | 9.3 | 2.3 |
| | **All 10, sealed** | | | 90 | 186 | 400 | 288 | **≈ 965** | 8,985 | 255 | 61 |

Opus xhigh at 4× Sonnet per task instead of 2.5×: ≈ $1,137 [calc]. Raw transcripts would be ≈ 8.5 GB, hence §5.6.

### 10.3 Extras, dev, factory, V, build agents and totals

| Item | $ [I] |
|---|---|
| Sealed extras: A-HN on beds 1–3 (≈ 48), WorkBench reuse streams (≈ 17), fault/drift subsets (≈ 7), need router (≈ 2) | ≈ 75 [calc] |
| Dev, beds 1–3: screens (30–60 pairs), probe batteries with three models, dev pilots with every arm, F-kit looks, parity anchors, injection authoring | ≈ 180 |
| Dev, beds 4–10 | ≈ 220 |
| Bed cards for all primary and substitute beds before the first sealed run | ≈ 65 |
| Factory B0–B3 (specs, panel, gates) | ≈ 30 |
| **Primary portfolio, without V** | **≈ 1.5k** (sealed 965 + extras 75 + dev 400 + cards 65 + factory 30) |
| Node V (own preregistration) | 350–880 |
| **With V** | **≈ 1.9k–2.4k** |
| Build agents (Haiku max implementers, Opus review), list-equivalent, on the meter | ≈ 150–400 [I]; rev 2 omitted this (all-Opus builders would be ≈ $1.0k–2.7k [C-obs]) |
| Pools X additions (other tracks' budgets): OD-9 SOP-Bench A-S + A-O ≈ $100–115; OD-8 AB-v1 arms | ≈ 150–200 |

Policy pause: the $500 single-experiment rule (`policy/models.json` `spend` [M]) is crossed by the core-8 sealed stage
(≈ $880) and by V's upper range. **OD-1**: record the owner's "full speed ahead, I don't mind" (2026-10-21, already the
authority for D22's $40) as the decision for this program, with a README note that states **the dollar figure (≈ $1.5k without
V, ≈ $2.4k with it) and the projected meter draw in weeks of the 7-day allowance** (from the dose test) and what that does to
other tracks, before the first sealed stage starts.

### 10.4 Breadth per dollar and per usage hour

| Bed | Sealed clusters | $ per cluster, all arms | Frontier session-h |
|---|---|---|---|
| NaturalPlan | 27 | 0.59 | 1.6 |
| WorkBench | 40 | 0.58 | 2.3 |
| AgentDojo | 58 | 0.41 | 2.2 |
| BFCL-MT | 40 | 0.68 | 2.1 |
| SpreadsheetBench V2 | 60 | 1.05 | 5.3 |
| DABstep-fresh | 40 | 1.43 | 4.8 |
| AppWorld | 56 | 5.05 | 14.0 |
| τ² telecom | 34 | 5.82 | 14.2 |
| EnterpriseOps-Gym | 40 | 6.15 | 11.9 |

The cheap arms are nearly free; the comparators set the price of breadth (71% of sealed cost). The three expensive beds are
kept for what nothing else gives (encrypted official test, long horizon, policy-bound tool use, enterprise operations).

---

## 11. Decisions needed

The owner's standing instruction is "dont ask me for perms" (OPERATING-PRINCIPLES §8); decisions marked *orchestrator* can be
recorded as dated D-numbers under that grant.

| # | Question | Recommendation | Who | Blocks |
|---|---|---|---|---|
| OD-0 | Rev 2's author published PLAN.md rev 2 as a private claude.ai artifact without being asked (https://claude.ai/artifact/6j3uXc1FS5gZYHw68LyH3x); AGENTS.md has no-publishing as a boundary | do not update or republish it (nothing in this revision did); whether to delete it is the owner's call | owner | — |
| OD-1 | Budget ≈ $1.5k (≈ $2.4k with V); stages above the $500 pause | record "full speed ahead, I don't mind" with a README note stating dollars and meter weeks | orchestrator | first sealed stage |
| OD-2 | THESIS D10 (no executor reads third-party text): every arm reads benchmark text; AgentDojo's is adversarial | accept as for AutomationBench: facade and sandboxed tools only, no network, host-side grading | orchestrator | all beds |
| OD-4 | K = 1 | keep K = 2 (owner rule "no K = 1 comparative proof") | owner rule | — |
| OD-5 | Margin | δ = 0.10 absolute, retention gate on the words, assay label and r on every verdict | orchestrator | freeze |
| OD-7 | Laptop: EnterpriseOps-Gym images (≈ 314 MB compressed) and the host study | approve for weeks 2–3 | owner's machine | bed 8, host study |
| OD-8 | AB-v1 test composition | a Haiku + Foundry arm and A0-O xhigh (and A0-S) on the same test tasks | AB track | pool X |
| OD-9 | SOP-Bench sealed: add A-S and A-O xhigh | dated amendment **before any sealed aggregate is read** (time-critical); else SOP stays Haiku vs Haiku | SOP track | pool X |
| OD-10 | Seed ledger collisions | factory, AB-R and V held-out seeds to 8850–8999; dev overlap recorded | factory / need-router | B3, V |
| OD-11 | Mercury D18 ceiling (20M; ≈ 5.2M used) | raise it so F-HM can run on beds 1–3 dev, V and, if chosen at the freeze, every bed (≤ 4M per bed); Mercury draws nothing from the Claude meter | owner | F-HM |
| OD-12 | ERP-Bench (≈ 861 MB images) as V's external twin; Spider2-DBT | approve ERP-Bench on the laptop for V's twin; defer Spider2-DBT | owner (D16 sizes) | V twin |
| OD-13 | Verdict date | move from 2026-11-11 to 2026-11-18 (build effort, 7-day window) | orchestrator | prereg |
| OD-14 | Breadth share of the 7-day window; one account-wide meter governor | ≤ 35% per week; adopt one governor across tracks | orchestrator | schedule |
| OD-15 | Comparator arms on owner-provisioned API billing | owner's choice: frees ≈ 71% of breadth's sealed meter draw for ≈ $690 real money | owner | schedule |
| OD-16 | A frontier harness-parity anchor | add one older Sonnet or Opus with published per-task results to the policy file, or accept "our harness" labels | owner / orchestrator | — |

README's owner-decision table should carry the open ones; this document does not edit README.

---

## 12. Risks and what would change the plan

1. **The kit does not close the dev gap.** Then the portfolio dev gate holds the comparators and the honest output is a
   kit-improvement report plus Haiku-only sealed runs; F-HM (29/60 on dev60 [M]) is the most promising lever.
2. **Too few valid beds.** If fewer than 8 pass admission, the verdict is "underpowered, B = k". Scouting (slot 10) and
   validated substitutes are the remedy, never relaxing a gate.
3. **The Foundry arm is a different program per bed.** One core; sourced cards shared with every arm; per-bed card diffs
   published; a bed needing code beyond its card is labelled "bed-specific F".
4. **Cost heterogeneity sinks H2.** CPS is split into cost and success factors; F-live beds are where to look first.
5. **Opus xhigh is stronger than assumed.** Node C then fails; V is the test that can still show superiority.
6. **The 7-day window.** The dose test sets the pace; OD-15 is the escape valve.
7. **Disk.** Equal-retention audit-on-write; one sealed install at a time; a bed pauses below 1 GB free.
8. **Oracle defects found late.** A bed whose gate fails after its sealed run is excluded and reported; the next substitute
   runs.
9. **Contamination in F-H's favour** (cards, vendor training): probe battery with Opus included, sourced cards, the
   H1e/H2-ext/H3-only robustness check, the log audit.
10. **V is our own world.** Independence controls (§6.6) and the ERP-Bench twin bound it; V is never pooled.

## 13. Corrections to carry into other documents

| Where | Correction |
|---|---|
| rev 2 of this file | DISPOSALS' rev-2 entry was committed by autosave in `a1260640` (with a one-line PLAN.md change), not left uncommitted |
| rev 2 §0 item 3, §8 | power 0.95 assumed F-H exactly equal to Sonnet; the dev evidence is 2–5 points below; see §8.6 |
| rev 2 §5.4 | the "conservative direction" of contamination bias is not established (§5.5) |
| rev 2 §1 | AppWorld is encrypted-public (H1e), not owner-held H1; SpreadsheetBench's cases 2–3 are public; WorkBench is H2 only if regeneration changes the answers |
| rev 2 §8 | futility cut mis-calibrated (n = 202 independent pairs vs n_eff 62–133) |
| rev 2 §10.3 | "Lean: claim C can no longer be tested" was wrong: C over anchors on every bed keeps its size (0.012–0.022) [calc; C-obs] |
| rev 2 §9.1 | no 7-day rule; the 5-hour throttle allowed ≈ 3.4× the weekly cap [C-obs] |
| rev 2 §3.1 | τ² telecom solo mode is not S4 dialogue |
| rev 2 PREREG §8.1 | ≥ 100 dev items is infeasible for AgentDojo (39), BFCL (40), τ² telecom (74): use non-sealed items |
| rev 2 PREREG τ² telecom | design effect used m = 4 although cells cap at 3 |
| `research/automationbench-20261014/runs/DEVCHECK.md` | add A0 run 2 (15/60, $0.011/task) and Sonnet alone (23/60, $0.099/task) [S-obs] |
| README, docs/RESEARCH.md | "Haiku + harness ties Sonnet alone" (dev60) needs the devCheck row beside it (Sonnet 23/60 > A1 20/60) [S-obs] |
| `research/tau2-20261021/ACQUISITION.md` | as in rev 2: 2,285 telecom tasks over 3 intents; v2.0.0 replaced 50 telecom and 50 retail base tasks; retail rewards LLM-judged; airline COMMUNICATE judged unless `--communicate-scorer substring`; default user simulator `openai/gpt-5.5`; PyPI `tau2` is unrelated [M, S-obs] |
| any note quoting AppWorld | 732 released ids (train 90, dev 57, test_normal 168, test_challenge 417), not 750 [S-obs] |
| any WorkBench result | report against the 18.0% do-nothing floor (124/690) and on the 566 state-changing tasks [S-obs] |
| EnterpriseOps-Gym notes | task counts (HF 1,115 vs public split 649 of 1,150) and frontier scores disagree between sweeps: resolve before admission |
| DABstep, TaxCalcBench | not usable as held-out as shipped: hidden answers recoverable (450/450), expected outputs in the repo [S-obs] |
| `research/jit-20261008/SEED-LEDGER.json` / AB-R README | the two collisions of §6.4 |

## 14. Not verified here

Model knowledge cut-offs; Opus xhigh cost and meter multiplier; dollars per meter tick (the dose test); whether `--effort max`
is accepted for Haiku by CLI 2.1.306; WorkBench generator seed control and whether regeneration changes answers; the 8
AgentDojo workspace pairings; τ² venv size; AppWorld cost per task; SpreadsheetBench V2's cluster count and gates; the
BFCL multi-turn driver through `claude -p` + MCP; EnterpriseOps-Gym counts on the laptop; whether the C7 engine fix lands
before the pilots; the Foundry run-store size; CHI-Bench's reported single-session collapse (28.0% pass@1 falling to 3.8%;
read by the vision critic at https://github.com/actava-ai/chi-bench on 2026-10-21 [doc], not re-read); V's build time; the
ERP-Bench laptop runtime. The power figures rest on simulation models with normal effects; re-run them at the freeze with
dev-pilot discordance, ICC, harm rates and cost spread.

---

## 15. Critique log (revision 2 → revision 3)

Three critiques of revision 2 were written on 2026-10-21: **validity** (scratchpad `breadth/validity/`), **cost and
throughput** (`costcritic/`) and **owner vision** (`breadth/critic-owner2/`). Each item: what the critique said, what changed,
and why. "Adopted", "modified" or "not adopted" is stated. No critique's claim was re-run unless marked [calc].

### Validity critique

| # | Critique | Change in rev 3 | Status and reason |
|---|---|---|---|
| V1 | Power quoted at the wrong effect: dev puts F-H 2–5 points below Sonnet; "Inconclusive" is the likely verdict | §0.2 says so in advance; §8.6 reports power at 0, −0.03 and −0.05 [calc, `plan3/power3.txt`]; the portfolio dev gate (§8.4.2) holds sealed comparator money until the dev gap is ≤ 3 points | adopted; re-run under the rev-3 design (which is less powerful at equal effects, because it has fewer beds) |
| V2 | Comparators lack code execution and the bed card | one sandboxed `python` tool and the bed card for every arm (§5.2); F-build moved to pool B; NaturalPlan and SpreadsheetBench run as agent beds | adopted |
| V3 | Opus pool skewed to short beds | node C pooled over 20-task anchors on **every** primary bed, AppWorld, τ² and EnterpriseOps-Gym included | modified: the critique proposed full-depth Opus on AppWorld (+$370); the cost critique showed anchors on all beds keep C's size and most of its power for less; V supplies the full-horizon Opus test |
| V4 | C7 (account e-mail) and AM-9 (host date) missing | identity and date rules (§5.2), identity probe, per-arm logging, sends to the account address scored as failures, runs before the fix diagnostic | adopted |
| V5 | Breadth does not cover shared-harness bias | stated in §1; session-configuration parity, init-event check, CLI hash, engine freeze without network node capabilities, cost-completeness check (§5.2) | adopted |
| V1b | δ = 0.10 equals the whole frontier premium | retention test at f = ½ gates the words "non-inferior"/"matches" (L1+) | adopted (wording gate, no α; P(A ∧ retention) reported in §8.6) |
| V1c | Absolute margin loose on beds with floor/ceiling mass | margin also reported on the state-changing / discordant subset; WorkBench oversamples multi_domain and state-changing templates | adopted |
| V1d | Shared noise pushes toward "non-inferior" | per-arm caps from dev p99; per-arm cap/timeout/exclusion reporting with a 5% flag; sensitivity without timeouts; faults re-run until a reset clears them; bed 10's simulator removed | adopted |
| V1e | Name the effort levels | verdicts say "Sonnet 5.5 at high", "Opus 5.5 at xhigh" | adopted |
| V2d | Frontier harness-parity anchor | not possible: the policy file lists no older frontier model with published per-task results [M]; OD-16 | not adopted (blocked) |
| V3d | Opus out of step | a bed's sealed run starts only when all arms can interleave; hashed task order | adopted |
| V3e | Cache and cost completeness | cache-neutral CPS and a completeness check | adopted |
| V4a | Contamination direction not established | §5.5 rewritten; H1e/H2-ext/H3-only robustness check with teeth | adopted |
| V4b | Memorization probe has no power on agentic beds | replaced by TS-Guessing, verbatim continuation, canary completion and paraphrase comparison, with Opus added | adopted |
| V4c | Held-out labels | H1e for AppWorld; H2-ext vs H2-own; SpreadsheetBench cases 2–3 not a control; WorkBench H2 only if answers change | adopted |
| V5a | LLM back doors: simulator, reclassify rule, asymmetric retention | bed 10 descriptive; deterministic reclassification rule (PREREG §8.1); equal transcript retention for all arms | adopted |
| V5b | Gold paths from inside environments | BG-8 now probes from the bed's own code-execution path, caches and `corpus/` | adopted |
| V5c | Harden oracles before builds learn | BG-10 | adopted |
| V5d | Per-bed oracle issues | ToolHop to substitute with format-only reporting; τ² ACTION BG-6 audit; airline descriptive; BFCL driver check; DABstep provenance of recovered answers | adopted |
| V6 | Cards after interim results; author-chosen salts; partial beds; envelope | all cards hashed before the first sealed run with isolated editors; salts from a later commit's SHA; hashed task order; envelope sentence (§1) | adopted |
| V7 | Drop/demote list | PlanBench, ToolHop, τ² simulated-user, DS-1000 out of the primary pool; DABstep needs two solvers; NESTFUL negative control; SpreadsheetBench V2 primary over 912; NaturalPlan kept only as an agent bed with code parity; WorkBench, BFCL, EnterpriseOps-Gym conditional; AgentDojo split outcome and out of D/E | adopted, except NaturalPlan, which the critique allowed under code parity |
| V8 | DISPOSALS committed in `a1260640`; artifact; OD-1 dollar figure | §13; OD-0; OD-1 note states dollars | adopted. This revision did not update, republish or delete the artifact |

### Cost and throughput critique

| # | Critique | Change in rev 3 | Status and reason |
|---|---|---|---|
| C1 | Opus 4× and F-H 2.5× sensitivities; omitted build sessions and agent time | sensitivities in §10; build agents priced and moved to Haiku-max implementers with Opus review | adopted |
| C1b | Rev 2 is not the thinned design it cites | A-S at n_eff 60; Opus 20-task anchors everywhere | adopted |
| C2 | The 7-day window binds; no 7-day rule | dose test, G5 start gate, ≤ 35% weekly share, account-wide governor (OD-14), API billing option (OD-15) | adopted (share and governor need the orchestrator; billing needs the owner) |
| C3 | Tier-1 schedule does not fit; verdict date slips | Tier 1 re-scoped to three beds + factory (≈ 13–15 engineer-days); verdict 2026-11-18 (OD-13) | adopted |
| C4 | Disk: kept run data over target | equal 10% pass sampling for every arm; kept ≤ 300 MB; one sealed install live; off-box move or delete | adopted |
| C5a | Futility mis-calibrated | futility look removed | adopted (recalibrated it saves little) |
| C5b | Probe on ≥ 100 dev items infeasible | ≥ 100 non-sealed items | adopted |
| C5c | Assay screen at 30 pairs too noisy | enter at ≥ 0.20 with 30 pairs, extend to 60 pairs in [0, 0.20) | adopted |
| C5d | F-build n_eff overstated | F-build moved to pool B | adopted (moot for the primary pool) |
| C5e | AgentDojo clustering | ≥ 20 authored injection tasks; two-way clustering as sensitivity | adopted |
| C5f | τ² telecom m = 4 vs cap 3 | m ≤ 3 in the design effect | adopted |
| C5g | "Lean: C cannot be tested" wrong | C over anchors on every bed | adopted |
| C6 | Recommended design ≈ $1,038 (bed 10 → NESTFUL) | rev 3 sealed ≈ $965 on ten beds with a different bed list (validity drops) | modified: NESTFUL is a negative control only (validity: G = 0); the slot goes to scouting |
| C7 | Gates before sealed comparator spend; cheap beds first; OD-8/OD-9 cheapest extra evidence | §8.4; §7 pool X | adopted |
| C8 | Artifact; stale DISPOSALS claim; OD-1 should state meter draw | OD-0; §13; OD-1 | adopted |

### Owner-vision critique

| # | Critique | Change in rev 3 | Status and reason |
|---|---|---|---|
| O1 | Off-vision beds carry ~53% of pooled weight; Opus full depth only on off-vision beds; "owner's bar" verdict possible with no owner-shape evidence | off-vision beds down to 4 of 10; Opus anchors on every bed; "owner's bar" must name its node (C or V); owner-shape table (§3.2) and envelope sentence | adopted |
| O2 | Add node V: enterprise streams vs Opus xhigh at full horizon, superiority | §6.6; Tier-1 factory prototype builds its streams; own preregistration and α | adopted, under the critique's option (b): C kept over anchors, V separate |
| O3 | Hard-violation co-primary in node A at +2 points | BG-11 map; harm guard on every supported verdict; NI at +0.05 secondary | modified: at +0.02 the co-primary has power ≤ 0.10, at +0.05 0.45–0.62 [calc, `plan3/harm_guard.txt`]; most primary outcomes already fail on hard violations |
| O4 | Counterfactual need router | §8.2, ≈ $2, descriptive | adopted |
| O5 | Tool parity | §5.2 | adopted |
| O6 | EnterpriseOps-Gym distractor tools; fault/drift subset | distractor mode primary; fault/drift subset on beds 1–2 | adopted |
| O7 | Sub-goal outcomes | AppWorld per-assertion, τ² per-subtask, against F-H's own verdicts | adopted |
| O8 | Longer reuse streams | WorkBench 20 templates × 10 instances with A-HN | adopted |
| O9 | Mercury underused; raise D18 | F-HM on beds 1–3 dev and V; becomes the frozen arm by a declared dev rule if OD-11 allows | adopted (needs the owner) |
| O10 | Messy intent: Haiku-only phrase panel favours the cheap model | model-diverse panel + answerability lint; V's messy-intake streams | adopted |
| O11 | SOP-Bench A-O xhigh by amendment, time-critical | OD-9 | adopted (SOP track's decision) |

---

## Sources

All read on 2026-10-21, by the sweep or critic named or by this author.

**Repository [M]:** README.md; docs/THESIS.md (§5 P9, §10 D10); docs/ROADMAP.md §4, §6; AGENTS.md;
`research/OPERATING-PRINCIPLES.md` (§6 line 29 "no K = 1 comparative proof"; §7 line 33 "Haiku 5.5 max for cheap
implementation"); `policy/models.json` (version 2026-10-21.2); `research/decisions-20261021.md` (D16–D23);
`research/compromises-20261021/REGISTER.md:80` (C7); `research/automationbench-20261014/PREREG-AB-v1.md:693-712` (AM-9);
`research/jit-20261008/R0-RUNBOOK.md` (G5); `research/jit-20261008/SEED-LEDGER.json`; `src/executors/claude-code.mjs:302-304`;
`src/sandbox.mjs:17`; `research/PLAN-3DAY-20261021.md`; `research/automationbench-20261014/runs/{DEV60-A0-A1.md,DEVCHECK.md}`;
`research/sopbench-20261021/{NOTES.md,DESIGN.md}`; `research/tau2-20261021/ACQUISITION.md`; `corpus/tau2-bench` at `57e54143`.

**Critiques and scripts** (session scratchpad): validity `breadth/validity/{gp_lib.py,power_shift.py}`; cost
`costcritic/{grid_power,grid2,cost3,rec,disk,meter_scan}.py` and `.txt`; vision `breadth/critic-owner2/estream_power.{py,txt}`;
this revision `breadth/plan3/{power3,cost4,harm_guard}.py` and `.txt`; rev 2's `breadth/plan2/` and the sweep notes
`breadth/*.md`.

**Benchmarks** (read by the sweeps): WorkBench https://github.com/olly-styles/WorkBench; AppWorld
https://github.com/StonyBrookNLP/appworld; BFCL https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard;
τ²-bench https://github.com/sierra-research/tau2-bench; AgentDojo https://github.com/ethz-spylab/agentdojo; NESTFUL
https://github.com/IBM/NESTFUL; ToolHop https://huggingface.co/datasets/bytedance-research/ToolHop; EnterpriseOps-Gym
https://github.com/ServiceNow/EnterpriseOps-Gym; SpreadsheetBench https://huggingface.co/datasets/KAKA22/SpreadsheetBench and
https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2; DABstep https://huggingface.co/datasets/adyen/DABstep; NaturalPlan
https://github.com/google-deepmind/natural-plan; PlanBench https://github.com/karthikv792/LLMs-Planning; DS-1000
https://github.com/xlang-ai/DS-1000; ERP-Bench https://huggingface.co/datasets/anonymouse321/erp-bench; CHI-Bench
https://github.com/actava-ai/chi-bench (vision critic); others as in rev 2.

**Methods:** Röver, Knapp and Friede, arXiv 1508.01227; FDA, Non-Inferiority Clinical Trials (Nov 2016),
https://www.fda.gov/media/78504/download; Bowyer, Aitchison and Ivanova, arXiv 2503.01747; Kapoor et al. (HAL), arXiv
2510.11977; Anthropic Engineering, infrastructure noise, https://www.anthropic.com/engineering/infrastructure-noise; Zhu et al.,
Agentic Benchmark Checklist, arXiv 2507.02825; Anchor arXiv 2605.26321; SWE-smith 2504.21798; TaskCraft 2506.10055; AutoEnv
2511.19304; Abrich 2610.09142; IPT 2604.15149; τ² paper 2506.07982; TS-Guessing (Deng et al., "Investigating data contamination
in modern benchmarks", arXiv 2311.09783 [mem, not re-read]).

**Data sources:** UCI incident log https://archive.ics.uci.edu/dataset/498/incident+management+process+enriched+event+log;
ProcureChange https://zenodo.org/records/22079246; GDPR Art. 12 https://gdpr-info.eu/art-12-gdpr/; holidays
https://pypi.org/project/holidays/; Hypothesis https://pypi.org/project/hypothesis/.
