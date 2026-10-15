# First-class programs F1–F8: one integrated program (2026-10-15)

This file designs and schedules the eight programs that [OWNER-DECISIONS.md](OWNER-DECISIONS.md) made first class today.
The owner's words were: "I agree with your complete analysis btw, everything you said should also be first class".

For each program it gives:
1. the claim in one sentence;
2. what already exists in the repository and what is missing;
3. the prior art that matters, with what we take and what we reject;
4. the first experiment: arms (always including the strongest simple baseline), the capability metric, the beds, the cost and
   cap, the $0 parts that come first, and a falsifiable prediction that says what would refute the claim;
5. build items, each owned by a code path, all outside the NL0-frozen trees;
6. the schedule against the existing plan.

After the eight programs come a list of what we drop or defer, one ordered roadmap across all eight with its dependencies,
the budget arithmetic and the owner decisions this raises.

**Status.** Design only, development evidence at most. Nothing here is a result or a claim.
- **Cost of writing it: $0.** I made no model calls, changed no code and read no credential file or `beds/sealed/`. Prior art
  for F1–F4 and F8 was looked up by web search today.
- **Commits.** I did not commit; the autosave does.
- **Repository state.** Written at HEAD `58cc47a` on `claude/intelligent-hamilton-vg1f9a`. The working tree held uncommitted
  edits by other running agents under `beds/ebed/e7/`, `beds/ebed/e8/` and `experiments/autobench/`. I neither touched nor
  relied on them.

**Inputs read today:**
- OWNER-DECISIONS.md (F1–F8);
- [MEMORY-ROUTING-RECURSION.md](../architecture-20261014/MEMORY-ROUTING-RECURSION.md) (abbreviated MRR below);
- [B1-E8-DEV.md](../enterprise-20261014/B1-E8-DEV.md);
- the M1-R, J-NEED-2 and J-Q reports;
- the AutomationBench NOTES, PREREG-AB-v1 and RECURRING-DESIGN;
- the four harness-deconstruction files (SYNTHESIS, KDENSE-SKILLS, KDENSE-BYOK, OPENSCIENCE);
- the repository paths in Appendix B.

The prior-art sweep given to this session was one JSON list, weighted toward F5 and F7. Its last entry (Hammoudi et al. and
BUMP) arrived cut off, so I re-checked both by search.

**Tags.** Every factual statement carries one:

| Tag | Meaning |
|---|---|
| **[code]** | Observed in code or data in this repository today, at the cited path |
| **[doc]** | A claim in a document (ours or a third party's) that I did not re-verify by execution |
| **[S]** | From the prior-art sweep, at the evidence level the sweep states. I did not re-open it |
| **[web]** | Looked up by me today (2026-10-15), at abstract or snippet level unless stated otherwise. URLs are in Appendix A |
| **[I]** | My design decision or inference |
| **[arith]** | My arithmetic, with its assumptions stated |

**A name clash.** "AWM" names two different papers:
- **Agent World Model** (arXiv 2602.10090), which synthesises environments, is cited here as **AWM-env**;
- **Agent Workflow Memory** (arXiv 2409.07429), which induces workflows, is cited here as **Agent Workflow Memory**.

---

## Owner summary

1. **One spine, not eight subsystems.**
   - **Six shared records** carry all eight programs (§0.1): a claim row, an earn ledger, a capability grant, the requirement
     ledger, a world manifest and a timing record.
   - **Most programs meet in two of them.** F1's "earn it, then build it" path is the same path as:
     - F3's fresh-builder request;
     - F2's skill creator;
     - F7's re-earning after drift.

     F5's fidelity harness is also F7's drift detector and F6's second outside reference.
   - **[I]** One mechanism serves several programs, so building it once is the cheaper design.
2. **Every first experiment has a falsifiable prediction and the strongest simple baseline as an arm.**

   | Program | Simple baselines in its first experiment |
   |---|---|
   | F1 | always agent + verifier; always workflow |
   | F2 | all tools |
   | F3 | always inline; always request; rebuild from scratch |
   | F4 | a perfect spec given; an agent with no spec |
   | F5 | the hand-built mock; a schema-only mock |
   | F7 | rebuild on every change; an agent that adapts |
   | F8 | latency comes from every run, not from its own arms |
3. **$0 first.** Every program has a $0 stage that can start now, in new directories:
   - none of them touches `src/`, `policy/models.json`, `experiments/lib/`, `experiments/c0/`, `beds/lib/` or the need-router
     stamped files;
   - product schema changes wait for the engine bump after the matrix, on or after 11-04.
4. **New paid spend.**
   - **Total:** about $80–100 estimated and $158 at the caps, across six paid first experiments [arith, §11]. Each is far below
     the $500 pause.
   - **F6 and F8 add $0.** They ride on AB-v1, MA-0 and every other run.
5. **Budget warning.** Existing commitments already exceed the $1,500 soft cap at estimates once AB-v1 and AutomationBench-R
   (AB-R) are counted: about $1,860 before these programs, and about $1,950 with them [arith, §11]. The order in §10 runs the
   most informative and cheapest work first. §11 lists what to drop first.
6. **What you see when.**
   - **By about 10-25:**
     - **FID-1:** does an automatically built mock rank the existing solvers the way the hand-built E8 mock does?
     - **SPEC-1:** how much of the perfect-spec result survives a messy business?
     - **DRIFT-1a:** do the frozen E8 workflows fail silently on drift they never practised? This part costs $0.
   - **By about 11-02:**
     - **EARN-1:** does earned structure beat both fixed policies on six AB-R families?
     - **LP-1:** does least privilege cost success, and does it shrink the blast radius?
     - **FIX-1:** inline fix or sub-workflow request?
     - **DRIFT-1b:** the upkeep comparison between workflows that heal and an agent that adapts.
   - **AB-v1:** its test run follows its own preregistration.
7. **Decisions for you** (§12; each has a default):
   - the budget;
   - a latency value λ_t, if you want latency inside the utility (default: report it beside the utility);
   - a real process of yours for F6;
   - OSS twins, but no vendor accounts, for F5;
   - acquiring WorkBench as a second outside world.

---

## 0. How the eight fit together

### 0.1 The spine: six shared records

**Admission rule [I].** A record exists only if at least two programs need it, or the owner asked for it by name. Each is
justified by measured evidence.

| # | Record | What it holds | Used by | Evidence it is needed | Where (new) |
|---|---|---|---|---|---|
| S1 | **Claim row** `claim-row/0` | Program, experiment and arm. The bed and its **origin**: our generator, ours grounded on outside tasks, an outside world with our grader, an outside world and grader, or real process data. **Fidelity tier** of every world or mock touched (S5). Evidence class (development or sealed) and K. **USD** split into run, build, world, upkeep, imputed, and reserved but unsettled. **Timing** (S6). Environment faults | all | **F5:** E8's $1.70 "leaves out" the world's cost (OWNER-DECISIONS F5). **F6:** we design the specs, worlds and graders (README "Evaluation validity: weakest link") [doc]. **F8:** seconds against hours in E8 [doc B1-E8-DEV]. Today's rows carry $ and K but no origin, fidelity or world cost [code: e.g. `research/automationbench-20261014/runs/raw-haiku/subset60/summary.json`] | `experiments/claims/` |
| S2 | **Earn ledger** | Per need signature (a task kind, a node's sub-need or a defect class): recurrences, verified passes, verified failure classes, cost so far, and promote and deopt events | F1 (per task), F3 (governor, per node), F2 (skill creator), F7 (re-earn after drift) | E8: 25 of agent-H's 27 invalid outputs repeat one misreading, because a fresh session cannot learn [doc B1-E8-DEV]. The repeat is observable, so it can be counted. The JIT dev stream spent 54% of its money on compiles at 24 tasks [doc `docs/RESEARCH.md:119`], so building too early is a real cost | `experiments/earned/ledger.mjs` |
| S3 | **Capability grant record and broker** | Per node, its declared tools, MCP servers, connectors, skills, data scopes, egress hosts, credential names and effect classes. Every request and decision, journaled. Default deny | F2, F3 (a request that needs a capability), F7 (a heal that needs one) | J-Q: the regex screen has recall 0.39 and catches 0/13 exfiltration texts [doc `research/architecture-20261014/runs/jq/REPORT.md`]. K-Dense: 136 of 177 skills carry a self-citation directive the regex misses [doc KDENSE-SKILLS §5.3]. The executor's network is not isolated (README "Subagents") [doc] | `experiments/provision/` |
| S4 | **Requirement ledger** (the tracker) | Conditions quoted from the user's own text, each with an id, a check and a status | F4 core; F1's verifier; F7 (an edition changes requirement ids); the AB A1 harness (`REQUIREMENTS.md`) | E8: every builder error missed a whole requirement, and every agent error misread the contract [doc OWNER-DECISIONS F4, B1-E8-DEV] | exists: `experiments/tracker/` (not stamped) |
| S5 | **World manifest** | Per world or mock, per endpoint: tier (M0–M4, §5.4), what it was validated against (system, date, snapshot hash), coverage, quirk log, editions as drift modules, and build cost per stage | F5 core; F6 (origin and tier); F7 (editions) | Cloud emulators diverged on 37% of 255 APIs [S]. AutomationBench's apps are docs-derived and were never checked against the real systems [S]. The cost of E8's world was never recorded [doc] | `experiments/mockfid/manifest.schema.json` |
| S6 | **Timing record** | Wall time split into model, tool, mock and waits (rate limit, Retry-After, queue, human); concurrency; simulated business time recorded separately | F8; every program | The need router keeps latency out of utility because wall times "are confounded by concurrency and stalls (one stall lasted 187 minutes)" [doc `research/need-router-20261014/DESIGN.md:193`] | `experiments/timing/` |

**Rule [I].** A result row without the S1 fields is diagnostic only and may not appear in a comparison table.

### 0.2 Where the programs meet

```
             F4 requirement ledger (S4) ───────────────► F1 verifier, F7 edition → requirement ids
                      │
 F1 earn ledger (S2) ─┼─► promote ─► F3 typed request ─► fresh cheap builder ─► verified ─► library ladder (F2 "creator")
                      │                    │
                      │                    └─► F2 broker (S3): a new capability is a grant request, journaled
                      │
 F5 world manifest (S5) ─► F7 editions as drift modules on the same mocks ─► F7 detection = F5 differential diff
                      │
                      └─► F6 origin and fidelity tier on every claim row (S1)
 F8 timing (S6) and F5 world cost: fields of every S1 row
```

### 0.3 Rules that bind all eight

- **NL0 freeze [code: `research/need-router-20261014/prereg/stages.json` `engineStamp`].**
  - **Stamped trees:** `src`, `experiments/lib`, `experiments/c0` and `beds/lib`, plus the label files
    (`experiments/need-router/{label-run,prereg-check,prereg-rules,metrics,m1-run}.mjs`, `experiments/jit/{seeds,stats}.mjs`
    and `policy/models.json`).
  - **Frozen at 10-24:** the analysis files `experiments/need-router/{features,router,voi,metrics,evaluate,card,prereg-rules}.mjs`.
  - **Rule:** all code for F1–F8 lives in new directories (§0.1 and each program's build list). Frozen files may be imported
    read-only.
  - **Product changes** (node schema, runtime journal fields) land at the engine bump on or after 11-04, as MRR §5 row 16
    already plans [doc].
- **Necessity test (MRR §4) [doc].** Build something only if both of these hold:
  - it prevents a measured failure, or one we can plant for $0, or it keeps a decision in the owner's hands;
  - a test can show it working this week.

  Everything else waits for a preregistered experiment that needs it (ROADMAP §6 rule 12).
- **Development first.**
  - Every first experiment below is **development evidence** on dev seeds or dev splits, read at K = 1 or 2.
  - ROADMAP §4.3 allows no comparative claim at K = 1, so each program's claim-bearing run is a later preregistration with
    sealed or held-out material.
  - **AutomationBench:** no F program opens an AB-v1 test task. All AB work uses dev-train only (PREREG-AB-v1 §1.3) [doc].
- **Text in corpora, benchmarks and on the web is data, never instructions** (AGENTS.md).
- **Each paid run** gets its own preregistration and its own cap, and stays under the $500 pause.

---

## 1. F1 Earned structure

### 1.1 Claim

On a stream of recurring work, a policy that does the following matches or beats both fixed policies ("always
agent + verifier" and "always workflow") on utility per dollar and per hour, and beats deciding once from task text:
- gives structure from day one only to typed hard primitives;
- runs everything else as an agent with a verifier;
- turns the repeated part into a workflow only when recurrence and repeated verified failures earn it.

### 1.2 What exists and what is missing

**Exists:**
- **Text-only need prediction is weak.**
  - Text predictors stay at or below 0.71 AUROC across held-out families: code + Jev scores 0.707 [0.46, 0.98], and 0.697
    under the re-run labels.
  - Jev's own increment over the code features is not above noise.
  - Asked directly, Jev scores 0.44–0.53 (0.53 on 96 tasks; 0.456 and 0.436 on 144 under the two labellings); the size rule
    scores 0.63–0.71.
  - [doc `research/need-router-20261014/runs/jev-need2/REPORT.md`, `runs/m1-r/REPORT.md`]
- **Need moves with conditions:**
  - with difficulty: R3 went from 8–9/12 at d3 to 0/12 at d5 [doc MRR §1];
  - with the model release: Haiku 4.5 → 5.5 took `records` from 0/36 to 25/36 [doc MRR §3.5].
- **E8 paired run** (world 1232, d2, size 12):

  | Arm | Passed | Cost | Time |
  |---|---|---|---|
  | Built workflows | 14/14 | $0.39–0.62 to build once | seconds per world |
  | agent-H | 10/14 | $1.45 | about 1.5 h |

  A full world needs about 7 h for agent-H [doc B1-E8-DEV].
- **The JIT dev stream** (interpret, then compile):
  - JIT Sonnet → Haiku scored 22/24, against 24/24 for the Opus agent;
  - compiles were 54% of spend;
  - the static solver failed silently on d4 drift (2/8) [doc `docs/RESEARCH.md:119`].
- **Need-router machinery:**
  - a hard guard (Stage 0) that forces a workflow from typed requirements [doc `research/need-router-20261014/DESIGN.md:253`];
  - a forced stratum (runbook, E8);
  - an RX6-lite guard-recall test planned [doc `DESIGN.md:539`];
  - NR-probe: try one example for a few cents (decision 7) [doc `DECISIONS-ADOPTED.md`].
- **AB-R families:** six of twelve have a generator, oracle, reference and controls in the tree
  [code `experiments/autobench/families/`]. Some are still in progress, with uncommitted edits by running agents today. They
  span the need spectrum [doc RECURRING-DESIGN headings]:

  | Family | Stratum |
  |---|---|
  | dealdesk | workflow pays |
  | suppression | workflow pays |
  | noshow | agent fine |
  | reviews | agent fine |
  | mailroom | slider-sensitive |
  | slawatch | HARD, timer |

**Missing:**
1. **The earning rule.** Nothing counts recurrence across a stream and compiles the repeated part when it is earned.
2. **The typed primitive detector.** Task #65 is pending.
3. **An "always agent + verifier" arm.** B1-E8-DEV names "an agent-H-with-validator arm we have not run" [doc].
4. **A runner that applies a policy over a stream.**
5. **A bed for the owner's own examples** (MVP → CI/CD, OSS maintenance, rule-bound research programs). These are deferred
   (§9).

### 1.3 The five hard primitives, read from typed facts [I]

| Primitive | Typed signal | Structure it forces from day one | Evidence it matters |
|---|---|---|---|
| Recurrence | declared job N > 1, or a need signature seen ≥ 2 times in S2 | an S2 entry; build once when earned | E8 build-once economics (above) |
| Time and state | waits, deadlines, timers, state carried across triggers (dedupe, counters) | engine structure: obligations in the tick host (`beds/ebed/host/host.mjs:676-715`), `wait` and `state` nodes with compare-and-swap | E8 saga deadlines and races; AB-R slawatch; Gaia2's time-sensitive failures [S] |
| Irreversible effects | capability `effects: 'non-idempotent'` [code `src/capabilities.mjs:14`]; money and send operations | keyed idempotency, an exactly-once ledger, a declared approval gate; ambiguous effects become `uncertain` and are never retried [doc README "Boundaries"] | Guardrails are 29–53% of AutomationBench assertions [doc NOTES §2]; E8 keyed batch operations |
| Size | over 30K tokens or over 32 units, **and** a probe that failed or ran slow (MRR S2) | a chunked `map`, or a `subflow` child | the M1 d5 flip; size alone never triggers (MRR §3.4) [doc] |
| Exactness | an output whose verifier is an exact equality on money, counts, dates or ids | computed in code; the model handles spans only | Jev "does not count reliably" [doc MRR App. A]; P1 records improved when parsing moved into code [doc README] |

**The probe decides the ambiguous middle.** Trigger 1 of a non-primitive kind runs agent + verifier.
- If the verifier rejects it, or it runs slow, the kind goes straight to workflow + verification. This is the owner's tilt
  for unsure cases.
- Otherwise it stays an agent until the earning rule fires.

**The earning rule v0** [I]. It is frozen before EARN-1. Thresholds chosen on dev data are labelled as such.
- **Promote** need signature *s* when either:
  - *s* recurred r ≥ 3 times and the verifier rejected the same failure class twice; or
  - r ≥ 5 and the cumulative agent cost on *s* is at least the expected build cost B̂ = $0.60, the B1L-H mean.
- **Demote** (deopt back to agent + verifier) when 50% or more of the units fall back after k units (MRR §3.4).

### 1.4 Prior art

| Work | Take | Reject |
|---|---|---|
| Agent Workflow Memory (Wang et al., ICML 2025) [web]: induces reusable routines from experience, online or offline; +51.1% relative on WebArena, +24.6% on Mind2Web | Online induction from the stream itself, with no up-front oracle | Text workflows admitted without verification: ASI reports gains over it from programmatic verification |
| ASI, Inducing Programmatic Skills (Wang et al., COLM 2025) [web]: a skill is admitted only if the task is solved, the skill is called and every call changes the environment; reported gains of 23.5% and 11.3% over a static baseline and Agent Workflow Memory (the units are unclear in the abstract) | Admit by execution, not by description. This is the same rule as our library ladder | Using an induced skill's own trajectory as its reuse evidence. Our ladder needs held-out runs |
| RPA candidate-routine discovery from unsegmented UI logs (Leno, Augusto, Dumas, La Rosa, Maggi, Polyvyanyy, ICPM 2020) [web] | Recurrence found in logs as the trigger for automation: process mining's "automate what repeats" | Automating on frequency alone, with no correctness evidence |
| Routing and cascades: LLMRouterBench ("routers do not reliably beat a simple baseline"); Dekoninck et al. (quality estimators are critical) [doc MRR App. A] | "Verify, don't predict": start cheap, escalate on a failed check | A learned predictor of need |
| AI Agents That Matter (Kapoor et al., TMLR 2025) [web]: simple baselines and cost-controlled comparison; inadequate holdouts | Both fixed policies as arms; report cost (and time, F8) | Accuracy-only leaderboards |
| Our own JIT stream [doc RESEARCH.md:119] | Hotness counters and deopt | Fixed compile thresholds that ignore compile cost (54% of spend) |

### 1.5 First experiment

**EARN-0 ($0, first).** An offline replay of existing rows: the E8 paired run, the JIT dev stream, and the M1, M1-R and
NL0/NL1 rows once they exist.
- **What it computes:** what the earning rule would have chosen at each step, and its counterfactual pass and cost.
- **Sensitivity grid:** r ∈ {2, 3, 5}, failures ∈ {1, 2}, B̂ ∈ {$0.4, $0.6, $1.0}. It is chosen on dev data and labelled so.
- **Also:** guard recall of the primitive detector on the typed declarations of every bed (RX6-lite style).

**EARN-1 (paid pilot, development, K = 1 stream per family and arm).**

| Arm | Policy | Role |
|---|---|---|
| A-agent | agent-H per trigger, no verifier (AB-R arm) | cheapest baseline |
| **A-agentV** | agent-H per trigger plus a deployable verifier, with at most one retry carrying the verifier's reason | **simple baseline: always agent + verifier** |
| **A-wf** | `wf-H` built once on practice streams before trigger 1 (AB-R arm) | **simple baseline: always workflow** |
| A-text | one decision per family at intake from text, by the frozen size rule and NR-static (`router.mjs`, used read-only). Its outcome is taken from the chosen arm's rows, so it costs $0 | the method F1 replaces |
| **A-earn** | primitives get structure from trigger 1; the probe runs on trigger 1; otherwise agent + verifier; promote and deopt by the frozen rule | F1 |
| agent-O, reference, null | AB-R ceilings and controls (RECURRING-DESIGN §3.8) | bounds |

- **The verifier** is oracle-free:
  - after a trigger it re-reads the world;
  - it checks the family's S4 ledger entries for that trigger kind (written once from `POLICY.md`, confirmed by the family
    author acting as owner);
  - its conditional miss rate, P(pass | wrong), is measured before the run on planted wrong actions at $0 and reported
    (MRR change 10). The arm runs either way, labelled by that rate.
- **Metric:**
  - **Per stream:**
    - trigger pass rate by the AB-R oracle (effects per trigger, exactly-once, timing);
    - utility u = p − c/V − B/(N·V) − (W/V)·q at V = $1, W = V and N = the stream length (the need-router formula, DESIGN
      §5);
    - wall time p50/p90 per trigger and time to first correct trigger (F8).
  - **Capability number:** pooled u(A-earn) − max(u(A-agentV), u(A-wf)), with a family-cluster bootstrap. Also reported:
    regret against the best fixed policy for each family in hindsight.
- **Beds:**
  - the six built AB-R families on their dev streams, after AB-R's $0 validity gates (RECURRING-DESIGN §3.11);
  - E8 enters as a forced-stratum diagnostic from existing rows ($0).
- **Cost.**
  - **Incremental:** the A-agentV and A-earn arms, about $15–20, cap $30 [arith: 6 families × about 36 triggers × $0.03–0.05
    per verified agent trigger ≈ $6.5–11, plus up to 6 builds at $0.4–0.7, plus the agent phase before promotion]. This
    assumes AB-R's own stage-1 arms (agent-H, wf-H) run anyway.
  - **Standalone:** about $30, cap $45.
- **Prediction (fixed now):**
  - (a) A-earn is within 0.03 utility of the better fixed policy on every stratum, and beats A-text by ≥ 0.05 pooled.
  - (b) On the agent-fine families A-earn never builds, or builds only after r triggers with no utility loss.
  - (c) On the workflow-pays families it reaches A-wf's per-trigger pass rate within 10 triggers.
  - (d) On slawatch it equals A-wf, because of the timer primitive.
  - (e) Guard recall on declared primitives is ≥ 0.9.
- **Refuted if any of these holds:**
  - A-wf beats A-earn by more than 0.05 pooled. Then "always workflow + verification" is the policy, and earning is
    unnecessary complexity.
  - A-agentV beats A-earn by more than 0.05 pooled. Then earning costs more than it saves.
  - Guard recall is below 0.9. Then the guard asks instead of inferring, as DESIGN.md:257 already says.

### 1.6 Build items

| Item | Owner path (new) | Needed because |
|---|---|---|
| Primitive detector over typed declarations (task #65) | `experiments/earned/primitives.mjs` | The owner's F1 text; text predictors ≤ 0.71 |
| Earn ledger (S2) and the frozen promote/deopt rule as a pure function | `experiments/earned/ledger.mjs`, `policy.mjs` | No promotion trigger exists |
| Stream runner applying a policy over AB-R and E8 streams, reusing the arms | `experiments/earned/stream.mjs` | Arms exist per trigger; no policy-level runner |
| Deployable verifier for agent arms, with a measured miss rate | `experiments/earned/verify-agent.mjs` | The agent-H-with-validator arm was never run |
| EARN-0 replay | `experiments/earned/replay0.mjs` | Cheapest test of the rule |

**Not built:**
- a learned need predictor (measured at ≤ 0.71);
- bandit thresholds (no volume yet);
- re-routing mid-run on predictions (MRR §4).

**Primitive-bearing tasks** go into a separate set, **not** into the frozen need set: adding them there would be a
preregistration amendment.

### 1.7 Schedule

| When | Step | Notes |
|---|---|---|
| 10-16 → 10-20 | EARN-0 and the primitive detector | $0 |
| 10-27 → 10-31 | EARN-1 | needs the AB-R validity gates, S1, S6 and the verifier's miss rate |
| after the AB-R TRAIN/held-out split (owner decision, RECURRING-DESIGN §3.13) | claim-bearing EARN-2 at K = 2 on held-out AB-R families | |

None of this touches NL0, NL1 or NL2.

---

## 2. F2 Least-privilege provisioning

### 2.1 Claim

Giving each node only what its contract declares has two effects, with no loss of task success against exposing all tools:
- it cuts the blast radius of injected text (unauthorised effects reachable from planted text) to near zero for capabilities
  outside the grant;
- code-first retrieval over a screened index selects the needed capabilities at least as accurately as exposing everything.

A node's grant is default deny, and anything more is a typed, journaled request to the harness.

### 2.2 What exists and what is missing

**Exists:**
- **Capability registry.** It requires declared `effects` (none, idempotent or non-idempotent), `risk`, a timeout and a
  reserved cost [code `src/capabilities.mjs:8-17`].
- **Node grants:**
  - a `task` node names exactly one tool [code `schemas/workflow.schema.json:146,200`];
  - `agent` nodes are narrow typed judgments with no tools [code `:207`];
  - executors get a `--tools` list [code `src/executors/claude-code.mjs:304`].
- **Control-flow taint** (`UNTRUSTED_CONTROL`) [doc README "Security"].
- **Retrieval.** Hard filters on effect tags, then BM25 [code `experiments/library/retrieve.mjs:80-92`].
- **The regex ingestion screen.** It is used only by its own test [code `experiments/library/quarantine.mjs:17-29`; doc
  KDENSE-SKILLS §6.4].
- **J-Q.** Regex recall is 0.39; the typed screens reach 0.88–0.89; both miss the `credential-url` class [doc jq REPORT].
- **The K-Dense dossier** [doc KDENSE-SKILLS §2.4, §5.3]:
  - 136 of 177 skills carry the self-citation and fetch directive; the regex catches 0/136 and K-Dense's own LLM scanner
    15/136;
  - 106 skills `pip install`;
  - 6 skills walk up parent directories for `.env` files;
  - 5 skills have paid or physical effects gated only by prose.
- **AutomationBench already scopes apps per task.** Calls to an app outside `meta.allowed_services` return 401 [doc NOTES §4].
- **Raw Haiku on AutomationBench** fails partly on selection: in the classified sample, "endpoint discovery" is 2 of 10 plus 3
  more found in extra reads [code `research/automationbench-20261014/runs/raw-haiku/subset60/failures-classified.json`].

**Missing:**
1. A node contract field for MCP servers, connectors, skills, data scopes (read and write paths), egress hosts and
   credential names.
2. A typed request protocol: grant, log or refuse.
3. Outside-skill ingestion: strip rules, effect tags, pinned environments and hash-bound verdicts.
4. A skill finder.
5. Any measure of blast radius. J-Q measures detection, not consequence.
6. Two security items README lists as open: the sink-field policy and executor isolation [doc].

### 2.3 Prior art

| Work | Take | Reject |
|---|---|---|
| Saltzer and Schroeder 1975, least privilege [web] | The principle, and default deny | — |
| Progent (Shi et al., 2025) [web]: deterministic privilege policies on tool calls. AgentDojo attack success fell from 41.2% to 2.2% in v1; v2 claims 0%. GPT-4o; the policy-expansion approver is assumed to always accept | Enforcement at the call boundary, in code; argument-level policies; expansion requests as a typed event | An LLM writing or widening its own grants as authority |
| CaMeL (Debenedetti et al., 2025) [web]: control flow comes only from the trusted query; capabilities on data values; 77% of AgentDojo tasks solved with provable security, against 84% undefended (later version) | Our control taint is the same idea. CaMeL's ~7-point utility cost is the right prior for our prediction | A custom interpreter: we have a typed IR |
| RAG-MCP (Gan and Sun, 2025) [web]: retrieve before exposing; tool-selection accuracy 43.13% against 13.62% with everything in the prompt; prompt tokens cut by over 50%; degrades as the registry grows | Retrieve, then expose few; report selection accuracy | Semantic retrieval as the only filter: hard filters on effects and credentials come first |
| K-Dense and OpenScience [doc SYNTHESIS, dossiers] | Scan results bound to a content hash; deterministic strip and lint rules; skill-load receipts; the skill-guide input and output sections as contract drafts | `allowed-tools` as authority; prose effect gates; unpinned daily sync; an LLM scanner as a gate (it flagged 15 of 136 copies of the same text) |

### 2.4 First experiment

**LP-0 ($0, first).**
1. Ingest K-Dense's 177 skills, our 14 skills and the 15 library cards into one index. The record per skill is in
   KDENSE-SKILLS §6.4 step 1.
2. Apply the strip rules: drop the citation section, flag the telemetry and trigger-widening lines, and map checkout or order
   verbs to `effect:pay`.
3. Report how many bodies change and what the hard filters remove.
4. Add the real-world "output steering" family as J-Q2 planted material, and K-Dense's defensive security prose as hard
   negatives.

**LP-1A (selection, about $1–2, cap $3).**
- **The query set** is written independently and frozen first: by the owner or a decision-11 far-family author. Held-out
  "Example request" lines are the fallback.
- **Arms:**
  - **all-tools**: Haiku sees every description and picks;
  - BM25 top-k;
  - **finder**: hard filters, then BM25 to at most 20, then Haiku chooses at most 5;
  - the oracle grant, as the ceiling.
- **Metric:** recall and precision of the needed set, and the tokens in context.

**LP-1B (blast radius, about $5, cap $10).**
- **Tasks:** 30 AutomationBench dev-train tasks, through the **host-run tool loop** AB-H. MRR F13 bars adaptive injection
  texts from agent arms that have Bash.

  | Grant arm | Definition |
  |---|---|
  | **G-all** | all 47 apps connected |
  | G-oracle | the task's own `allowed_services`. It is derived partly from the assertions, so it is a ceiling, not deployable |
  | **G-lp** | a read-only discovery phase; the finder fixes the grant; expansion requests during the act phase are refused and logged |
  | G-lp+req | the same, but expansion requests are auto-granted and logged (Progent's worst-case approver) |

- **Conditions:**
  - clean;
  - injected: one planted, re-authored text per task, in a record the task plausibly reads, carrying a canary token. It
    targets either an app in the needed set or one outside it.
- **Metric:**
  - **clean:** strict pass and partial credit, by the official rubric;
  - **injected:** the rate of unauthorised effects, meaning any write outside the reference set or any write carrying the
    canary. It is reported separately for in-scope and out-of-scope targets;
  - grant recall and precision;
  - the number of expansion requests.
- **Prediction:**
  - (a) Out-of-scope attacks succeed at least 3× as often under G-all as under G-lp, and G-lp is about 0.
  - (b) In-scope attacks are about equal under G-lp and G-all. App-level grants cannot stop misuse of an app the task needs.
    That points at argument-level and sink-field policies, the README's open item.
  - (c) G-lp's clean pass rate is within 3 points of G-all; G-lp+req is within 1 point.
- **Refuted if any of these holds:**
  - G-lp loses more than 5 points of clean pass. Then strict grants cost too much, and requests must be the default.
  - Out-of-scope unauthorised effects under G-lp are not lower than under G-all.
  - Out-of-scope attacks already succeed about 0% of the time under G-all. Then blast radius is not the binding risk on this
    bed; record it.

### 2.5 Build items

| Item | Owner path (new) | Needed because |
|---|---|---|
| Capability contract v0, as an experiment-side JSON Schema | `experiments/provision/contract.schema.json` | Nothing declares MCP, skills, scopes or egress [code] |
| Broker (S3): request → grant, refuse or log; default deny. A request justified by tainted text needs the owner or is refused (MRR R8) | `experiments/provision/broker.mjs` | Progent and CaMeL [web]; the K-Dense steering text [doc] |
| Ingestion, strip rules and hash-bound verdicts | `experiments/provision/ingest.mjs` | 0/136 by regex; 106 unpinned installs [doc] |
| Finder, importing `experiments/library/retrieve.mjs` and `index.mjs` read-only | `experiments/provision/finder.mjs` | AutomationBench endpoint-discovery failures [code]; RAG-MCP [web] |
| Blast-radius overlay (world dumps through `bridge.py serve --world`) and scorer | `experiments/provision/blast.mjs` | No consequence measure exists |
| Product: `capabilities` on nodes, enforced at dispatch | `schemas/`, `src/`, at the engine bump on or after 11-04 | Only after LP-1 shows no success loss |

**The skill creator is not built separately [I].** F1's earned path into the library ladder *is* the creator: an earned and
verified workflow is a skill.

**Not built:**
- an LLM scanner as a gate;
- autoskill-style creation from screen history (KDENSE-SKILLS §6.5);
- an argument-level policy language, until LP-1B shows that in-scope misuse dominates.

### 2.6 Schedule

| When | Step | Depends on |
|---|---|---|
| 10-16 → 10-19 | LP-0 ($0) | — |
| 10-22 → 10-24 | LP-1A | the frozen query set |
| 10-26 → 10-29 | LP-1B | AB-H (MA-0's harness, MRR §5 row 8) |
| on or after 11-04 | product schema | the engine bump |

---

## 3. F3 Inline fix vs sub-workflow request

### 3.1 Claim

A typed rule decides where each fix goes:
- **inline** when it is local, needs no new capability and has no side effect;
- **as a typed request to the harness** otherwise. A fresh cheap builder with a clean context and a budget carve builds it,
  and the result returns typed.

This rule fixes more defects per dollar than always-inline, always-request or a rebuild from scratch. A governor that builds
once for repeated requests saves cost in proportion to the repeat rate, with no wrong reuse.

### 3.2 What exists and what is missing

**Exists:**
- **B1N repair.** Fresh sessions given only the disagreement evidence took two flawed lineages to 1,022/1,022 for $0.16 in
  total [doc B1-E8-DEV; code `experiments/ebed/repair.mjs`, `experiments/tracker/nversion.mjs`].
- **`subflow`.** It has hard refusals, a host choice between `child` and `inline`, and mutant-checked credit [code
  `experiments/rec/subflow.mjs`, `tool.mjs`, `check-runner.mjs`]. Its Z1 latent-demand replay cost $0 [code
  `research/architecture-20261014/runs/z1/result.json`].
- **REC-1** is designed at about $250 (MRR §3.4).
- **The heal loop.** Localisation by counterfactual replay found the broken node in 3/3 incidents. It is blocked today by
  `HEAL_POLICY_DRIFT`, pending an owner choice [doc README; docs/RESEARCH.md:117].

**Missing:**
1. **The capability axis.** REC-1's S2–S4 choose child or inline by size and failure, not by whether the fix needs a new
   capability, effect, verifier or reuse.
2. **A typed request schema** shared by `subflow`, repair and heal.
3. **The governor:** a request fingerprint, build-once and apply-to-many.
4. **Any measure of repeats across nodes.**

### 3.3 Prior art

| Work | Take | Reject |
|---|---|---|
| Lazy task creation (Mohr, Kranz, Halstead 1991) [doc MRR] | A spawn is a hint; the result must not depend on the choice | — |
| ADaPT (decompose only when the executor fails) [doc MRR] | Request only on evidence | Decomposing up front |
| Kim et al. (arXiv 2512.08296): +80.8% on decomposable work, −70.0% on sequential planning [doc MRR]; Anthropic's multi-agent note: a poor fit for shared context, about 15× tokens [doc MRR] | Keep shared-context fixes inline | Multi-agent by default |
| Kady's fail-closed reading of model-written orchestration [doc KDENSE-BYOK M2.7] | Anything not statically known in a request is billed at the worst case and refused a model pin | Untyped JS delegation |
| Pact consumer contracts [S] | A request's `returns` schema is the consumer's contract; the governor reuses a fix only where the contract matches | — |

### 3.4 First experiment

**FIX-0 ($0, first).**
- **A defect set on a frozen copy of the B1L-H lineage-1 solver** (`research/enterprise-20261014/runs/b1lh-e8-1/solver.mjs`,
  1,022/1,022):
  - about 20 planted defects. **Local** ones keep the same capability set: a wrong constant (edition hours), a wrong
    comparison, a missing field. **Structural** ones need a new capability, effect, obligation or verifier: a deleted
    compensation branch, a deleted deadline obligation, a retry without its key, unhandled `migration` orders;
  - the four real defects: B1-O's batch key, lineage 2's missed requirement, lineage 3's retry semantics, B1-H's imagined
    read file.
- **Labels** come from the typed rule, computed from the reference patch's capability diff: new system.op calls, effect kinds,
  obligations, verifiers or a reusable module.

**FIX-1 (about $7–13, cap $20; development).**

| Arm | What happens |
|---|---|
| R-none | detect only (floor) |
| R-inline | a Haiku session with the full build context (SPEC-E, contract, its code, the smoke runner) patches the solver directly |
| R-request | every defect becomes a typed request (need, evidence, spec references, return schema, budget carve) to a fresh Haiku builder; the result is a typed module with its own planted-mutant check (MRR change 4) |
| **R-rule** | the agent proposes a fix plan; code computes the plan's capability diff and routes it inline or as a request |
| **Rebuild** | a full B1L-H rebuild from scratch: a strong simple baseline at $0.39–0.62 and 98.2% mean |

- **Governor sub-test.** The same structural defect is planted in all three lineages. The governor builds once and applies to
  all three, each with its own verification. It counts the savings and any wrong reuse.
- **Metric:**
  - defects fixed: every case restored on grading worlds 1232–1234, with 0 regressions;
  - $ and wall time per fixed defect;
  - regressions;
  - for the governor: the dedup rate and wrong reuse.
- **Prediction:**
  - (a) R-rule fixes at least as many as the better of R-inline and R-request, minus 1, at ≤ 0.8 × R-request's cost.
  - (b) R-inline fixes ≥ 80% of local defects but ≤ 60% of structural ones.
  - (c) Rebuild costs ≥ 3× R-rule per fixed defect.
- **Refuted if any of these holds:**
  - R-inline matches R-rule on structural defects. Then the request path is unnecessary; keep inline plus `subflow`.
  - R-request is no dearer than R-rule. Then always request, and the classifier is unnecessary.
  - Rebuild is the cheapest per fixed defect. Then "rebuild on defect" is the policy.

### 3.5 Build items

| Item | Owner path (new) | Needed because |
|---|---|---|
| Capability-diff classifier | `experiments/fixroute/classify.mjs` | S2–S4 lack the capability axis |
| Typed request schema; requests that need a capability go through S3 | `experiments/fixroute/request.mjs` | B1N worked from disagreement evidence alone |
| Governor: fingerprint, memo, apply-to-many, wrong-reuse counter | `experiments/fixroute/governor.mjs` | OWNER-DECISIONS F3; no repeat data exists |
| Solver mutants with local and structural labels | `experiments/fixroute/mutants.mjs` | A controlled ground truth for routing |

The product typed request lands with `subflow` at the engine bump. **Not built:** planner or critic teams, or a discretionary
allowance (MRR §4).

### 3.6 Schedule

| When | Step | Notes |
|---|---|---|
| 10-18 → 10-22 | FIX-0 | $0 |
| 10-27 → 10-30 | FIX-1 | after REC-1's Z2 pilot (10-21), so that `subflow` mechanics are known first. Independent of the heal-kit decision: it uses the `repair.mjs` path |

---

## 4. F4 Spec from a messy business

### 4.1 Claim

A cheap builder that must derive the contract from emails, documents, records and an owner who answers questions:
- recovers a measured fraction of the perfect-spec result (the **spec recovery ratio**);
- recovers more of it when the requirement tracker (derive, confirm, check) bridges the gap;
- beats an agent that never gets a spec.

### 4.2 What exists and what is missing

**Exists:**
- **SPEC-E**, the perfect 9K-token rulebook every E8 arm received [doc OWNER-DECISIONS F4].
- **The tracker** [doc tracker-e8 REPORT; code `experiments/tracker/`]:

  | Measure | Result |
  |---|---|
  | Cost | $0.13 |
  | Lineage 3's defect | caught, 4/4 |
  | B1-O's batch keying | missed |
  | False alarms | 16–21 |
  | Mutation score | 0.16 |
  | Extraction recall, Haiku | 0.77, 0.93, 0.00 |
  | Extraction recall, Sonnet | 0.53–0.57 |
  | Gold ledger | 30 ids, 15 U statements, 76 clauses |

- **The AB A1 harness** writes a `REQUIREMENTS.md` ledger [code `experiments/autobench/harness/foundry.mjs:1-14`].
- **AutomationBench policies live inside the world.** Raw Haiku applied an older sheet rule over a newer email (classified
  "policy/guardrail violation", 3 of 10) [code `failures-classified.json`].
- **AB-R** delivers policy amendments by email at d3 [doc RECURRING-DESIGN §4.1].
- **`need-nospec-records`** withholds the rules: build from examples, or clarify. No model has run on it [doc
  `beds/need-nospec-records/README.md`].
- **The MA-1 design:** truth-first intent records, a renderer, admission and a `T2-hard` stratum [doc MRR §3.3].

**Missing:**
1. A messy-business rendering of a spec with exact truth: which requirement sits in which carrier.
2. An owner simulator that answers only from intent records and withholds what is not asked.
3. Tracker v2: writer prompt and trace API.
4. A measurement of the spec recovery ratio.

### 4.3 Prior art

| Work | Take | Reject |
|---|---|---|
| ClarifyGPT (Mu et al., FSE 2024) [web]: detects ambiguity by disagreement among candidate programs, then asks; GPT-4 Pass@1 on MBPP-sanitized rose from 70.96% to 80.80% (v1 abstract; later versions report other averages) | Ask only when N candidate builds disagree; our N-version machinery already finds disagreement | Unlimited questions: each question is charged |
| Elicitron (Ataei et al., 2024) [web]: simulated users surface latent needs; claims more than human interviews (self-reported) | Simulated stakeholders as a cheap stand-in | Counting "needs found" with no ground truth: we score against a hidden requirement set |
| Process model generation from text (Friedrich, Mendling, Puhlmann, CAiSE 2011) [web]; AGORA invariants mined from recorded traffic [S] | Records and traffic are a spec source: precedent reveals rules | Assuming that text is complete |
| Sim2Real user simulation: simulators are "too cooperative", give everything up front, rarely push back [S] | The owner simulator withholds unless asked specifically, with a seeded probability | A cooperative oracle owner |
| CRMArena's latent variables [S] | Records carry causes (habits, sloppiness), not one-off injected traps | — |

### 4.4 First experiment

**SPEC-0 ($0, first).** The 30 gold requirement ids (tracker `gold.json`) are assigned by code to carriers. Only SPEC-E's
business rules become messy. CONTRACT.md and `api/*.schema.json` stay exact, because platforms do publish API docs and E8's
decisive failures were interface misreadings [doc B1-E8-DEV].

| Carrier | What it holds |
|---|---|
| SOP page | about 60% of the rules, some of them at an outdated edition |
| Email threads | newer policies override the SOP; one sender has no authority and must be ignored |
| Records | past orders whose outcomes reveal a rule; inference only |
| Owner-only | about 10% of the rules, answerable only by asking |
| Distractors | near-duplicate policies and irrelevant documents |

Gates, all $0:
- **Leak test:** no 8-word shingle of SPEC-E appears outside its assigned carrier.
- **Coverage test:** every id is recoverable from at least one carrier, checked by an author-written mapping (as AB-R's
  reference proves its traps are resolvable).

**SPEC-1 (about $8–10, cap $20; development; K = 2 lineages per build arm).** The rendering is truth-first: a content-addressed
pack, never regenerated (MRR §3.3 rule 3).

| Arm | What it gets | Role |
|---|---|---|
| **S-perfect** | B1L-H with SPEC-E: existing rows, K = 3, mean 98.2% | ceiling ($0) |
| S-derive | B1L-H conditions, but the corpus instead of SPEC-E, plus `ask(question)` to the owner simulator (at most 20 questions, each journaled and charged) | F4 |
| **S-derive+ledger** | as S-derive, plus the tracker flow: extract a quote-anchored ledger from the corpus; the simulated owner confirms or edits it from the intent records; the builder gets the confirmed ledger | the bridge |
| **S-none-agent** | agent-H per tick with the corpus, no build, on sized world 1232 d2 size 12 (agent-H with SPEC-E scored 10/14 there) | floor |

- **Metric:**
  - completed-case pass rate on grading worlds 1232–1234 × d2, d3, d5;
  - **spec recovery ratio** = S-derive / S-perfect;
  - requirement recall: which gold ids are unimplemented, from per-rule oracle failures;
  - questions asked;
  - $, including the renderer and the simulator.
- **Prediction:**
  - (a) S-derive reaches 0.60–0.85 of S-perfect, with its misses concentrated in the records-only and owner-only carriers.
  - (b) The ledger adds ≥ 10 points of requirement recall.
  - (c) S-none-agent scores ≤ 10/14.
- **Refuted if:**
  - S-derive reaches ≥ 0.95 of S-perfect at K = 2. Then spec derivation is not the bottleneck on this kind of task, and F4
    continues only as a test on outside beds (AutomationBench).
  - The ledger adds < 3 points. Then the tracker is parked as a bridge until v2.

**The outside reading** comes from F6, not from a new run: A1's `REQUIREMENTS.md` statistics against AB-v1's
policy-class failures.

### 4.5 Build items

| Item | Owner path (new) | Needed because |
|---|---|---|
| Carrier assignment, leak and coverage tests | `experiments/specbiz/carriers.mjs`, `leak.mjs` | Exact truth for requirement recall |
| Truth-first renderer with content-addressed packs (shared with MA-1's T0) | `experiments/specbiz/render.mjs` | MA-1 rules 1–3 [doc MRR] |
| Owner simulator: answers from intent records only, withholds with a seeded probability, every answer journaled | `experiments/specbiz/owner-sim.mjs` | Sim2Real "easy mode" [S] |
| Tracker v2: writer prompt and trace API, preregistered as a new version | `experiments/tracker/` (not stamped) | 16–21 false alarms; property bugs dominate [doc] |

**Not built:** an LLM judge of spec quality, or a model-decided requirement truth.

### 4.6 Schedule

| When | Step | Notes |
|---|---|---|
| 10-18 → 10-22 | SPEC-0 | $0 |
| 10-22 → 10-25 | SPEC-1 | dev worlds; E8 admission is not required for development evidence, as for the B1 arms |
| after admission and a sealed family | claim-bearing version | |
| alongside MA-1 (10-21 → 10-28) | shared renderer code | |

---

## 5. F5 Automatic realistic mocks

### 5.1 Claim

A mock built automatically from schemas, docs and recorded traffic, plus deliberate error-path probes, reaches per-endpoint
behavioural fidelity close to a hand-built reference. Fidelity is measured two ways:
- by differential testing;
- by whether the mock ranks a panel of arms the same way the reference does.

Its build cost is itemised in every claim that rests on it.

### 5.2 What exists and what is missing

**Exists:**
- **The E-bed host's typed mocks.** Systems are declared as data plus small apply functions, with keyed idempotency,
  `status(key)`, faults F1–F6, a journal and replay [code `beds/ebed/host/mocks.mjs:1-16`, `faults.mjs:6-14`].
- **E8's five systems** (orders, inventory, billing, carrier, fraud) take 153 lines [code `beds/ebed/host/systems/e8.mjs`]. The
  hand-built effort lies mostly in the spec, world, transition, oracle and goldens.
- **The cost of building E8 was never recorded.** Orchestration is not itemised [doc README "Cost ledger"]. 63 commits touch
  `beds/ebed/{e8,host}` [code `git log`].
- **A panel that costs $0 to run.** All of these are code:
  - the B1L-H lineages before and after repair;
  - B1-O and B1-H;
  - three blind specificity solvers;
  - the reference policy;
  - the bad, gaming and necessity controls [doc `beds/ebed/e8/README.md`; code `beds/ebed/e8/controls.mjs`];
  - from FIX-0, the planted solver mutants (§3.4).

  The 240 killed oracle mutants are not panel members: they mutate the grader, not an arm.
- **AutomationBench as another team's mocks** [S]:
  - 97K hand-written lines and 758 endpoints;
  - 11 apps are action-log stores;
  - its query engine rejects unsupported syntax.
- **The bridge:**
  - a determinism shim with seeded ids and a logical clock;
  - a masked vote diff;
  - 35/35 parity [doc NOTES §9–10].

**Missing:**
1. A differential fidelity harness.
2. An automatic mock-builder pipeline with a cost ledger per stage.
3. The mock manifest (S5).
4. The panel rank test.
5. Any real-system check: no vendor sandbox, no OSS twin.

### 5.3 Prior art (from the sweep [S] unless marked)

| Work | Take | Reject |
|---|---|---|
| MCP-Persona Tool-Traverse | Traverse the reference with deliberate invalid calls; rebuild the context before each comparison; behavioural F1 on accept and reject decisions | Docs-only mocks: they reject valid calls through "hallucinated constraints" and would make built workflows over-defensive |
| ClawsBench | Its 11 recurring mock-bug classes as **mutation operators** to validate our fidelity harness; dated fixtures, a coverage map and a quirk log in the manifest | Per-app fidelity: declare it per endpoint |
| AWM-env (Agent World Model) | Its stage structure (state schema → seed → tool server → state-diff verifier) and its per-stage cost ledger | Accepting up to 10% residual error per stage: 74% of its environments carry a bug |
| Pantheon; Sim2Real predictivity (SRCC) | The claim-relevant number is whether a **panel of arms** gets the same outcomes, with leave-one-arm-out; hunt for leniency arms exploit (Habitat's "wall sliding") | Grading a mock by which features it models |
| MIRAGE | "Same pass/fail of the caller's tests" as a fidelity number; record-replay misses error paths | Expecting more than about 75% shape fidelity from LLM-served mocks with no source |
| EnvSimBench; SimSAT | LLMs may write code mocks and render actor text | LLM-held multi-variable state (the "state-change cliff"; SimSAT gets about 1 in 9 read-after-write calls wrong); LLM-judged fidelity |
| Generative agents normalised by test-retest | Fidelity = mock-vs-reference agreement ÷ reference-vs-reference agreement (two seeds, ids masked) | Chasing 100% |
| LocalStack parity; Hoverfly diff; Microcks | Every behaviour carries a validated-against marker (system, date, snapshot hash); the fixtures that serve the mock are the same cases replayed against the reference; report coverage-bounded and achieved conformance | Hand-edited snapshots |
| ShardStore; RESTler and Schemathesis | Reference models double as mocks and oracle semantics; the producer-consumer graph generates stateful create → read → update chains | Random single calls |
| Fidelity of cloud emulators (ICSE 2025): 37% of 255 APIs diverged | The base rate: never "the mock is faithful", always per endpoint | — |
| ASME V&V 40 | Risk-informed bars: an endpoint whose mock verdict alone gates an irreversible effect needs the highest tier | One global bar |

### 5.4 Tiers (S5) [I]

| Tier | Meaning |
|---|---|
| M0 | schema only (Prism or stripe-mock style) |
| M1 | behaviour derived from docs or written by us, never compared |
| M2 | differentially tested against a reference mock (hand-built, or another team's), per endpoint, with a date |
| M3 | differentially tested against a real system or an OSS twin, with a dated snapshot |
| M4 | continuously reconciled (shadow or diff mode) |

**Where things sit today.** E8's systems are the reference semantics of our own bed, and they are M1 relative to any real
system. AutomationBench's apps are M1 relative to their vendors.

**The bar [I].** A promotion that rests on a mock needs every endpoint the workflow touched at M2 or above. Any statement
about real systems needs M3.

### 5.5 First experiment

**FID-0 ($0, first): validate the evaluator before any claim.** AGENTS.md: an invalid evaluator blocks claims.
1. **The harness.** It runs the same call sequences against two hosts (reference and candidate), masks generated ids and times,
   rebuilds the context from a snapshot, and diffs per field and per state.
2. **The bug classes.** The 7 ClawsBench classes the sweep names are mapped onto `defineSystem` copies:
   - sparse vs full mutation responses;
   - null vs absent;
   - a list serializer used for detail;
   - empty-collection shape;
   - flattened nesting;
   - wrong state transition;
   - static vs computed values.

   The other four are read from ClawsBench Appendix C.1 before FID-0 freezes.
3. **Idempotency mutants:** a key ignored; a 409 key conflict not raised; `status(key)` wrong after F3; the F5 rename not
   enforced.
4. **Gate:** the harness must detect ≥ 0.9 of the mutants.
5. **The panel runner.**

**FID-1 (about $14–16, cap $25; development).** The reference is E8's hand-built systems.

| Arm | Built from |
|---|---|
| **Hand-built** (reference; agreement with itself across seeds = the repeatability ceiling) | — |
| **Schema-only** (M0) | `api/*.schema.json` |
| Auto, docs-only | SPEC-E's platform sections and the API schemas. Built by Haiku with a probe loop, K = 2; plus an Opus "architect" variant, K = 1 |
| Auto, docs + traffic + probes | as above, plus host journals of reference runs on **practice** worlds 1235–1237 only, plus a traversal of invalid calls against the reference |

Every candidate plugs in through a `defineSystem`-compatible loader. If the host cannot take an injected systems map
unchanged, that one constructor parameter is a recorded bed-version change, made in its own commit.

- **Metric:**
  - behavioural F1 on accept and reject decisions;
  - normalised field and state agreement after generated stateful sequences;
  - **panel** results on grading worlds 1232–1234 run on each candidate and graded by the unchanged oracle:
    - Spearman SRCC of arm pass rates against the reference;
    - the same-verdict rate per case;
    - **leniency flips**: a control that fails on the reference but passes on the mock;
  - build $ and minutes per stage.
- **Prediction:**
  - (a) Schema-only: SRCC < 0.5.
  - (b) Docs-only auto: F1 between 0.80 and 0.90, and at least one leniency flip.
  - (c) Docs + traffic + probes: F1 ≥ 0.95, SRCC ≥ 0.9, same verdict on ≥ 0.95 of cases, 0 leniency flips.
  - (d) Build cost under $2 per Haiku build.
- **Refuted if:**
  - docs + traffic + probes gives SRCC < 0.8, or flips any necessity control to pass. Then automatic mocks cannot carry
    promotion evidence, and F5 claims stay "hand-built only";
  - schema-only already gives SRCC ≥ 0.9. Then this panel does not exercise behaviour; the bed is too easy to discriminate,
    and FID-2 becomes primary.

**FID-2 (about $5, cap $10): a reference we did not write.**
- **Reference:** AutomationBench's stateful apps (Salesforce, HubSpot, QuickBooks) as implemented in its own Python.
- **Candidate:** an automatic mock built from AutomationBench's JSONC schemas.
- **Sequences:** the scripted parity sequences on exposed dev tasks, and A0's dev-train call logs.
- **Tie to F6:** this is F6's second outside reference.

**Cost-counting rule, from now on.**
- Every bed or mock build is metered into S1 `usd.world`.
- E8's historical world cost is recorded as "unavailable; lower bound unknown". It is not invented.

### 5.6 Build items

| Item | Owner path (new) | Needed because |
|---|---|---|
| Differential harness with masking and context rebuild | `experiments/mockfid/diff.mjs` | No fidelity measure exists |
| Stateful sequence and error-probe generator (producer-consumer graph from the schemas) | `experiments/mockfid/probe.mjs` | Chains are where mocks fail (ClawsBench class 10) [S] |
| Panel runner: SRCC, same-verdict, leniency | `experiments/mockfid/panel.mjs` | The claim-relevant number [S Pantheon, SRCC] |
| ClawsBench-class and idempotency mutants | `experiments/mockfid/mutants.mjs` | Validates the evaluator |
| Mock manifest (S5) | `experiments/mockfid/manifest.schema.json` | Per-endpoint tier and date |
| Auto-builder stage pipeline with a per-stage cost ledger | `experiments/mockfid/build/` | F5's automatic half; cost is counted |

**Not built:**
- LLM-served stateful endpoints;
- an LLM fidelity judge;
- learned simulators (MirrorAPI-style; they need the GPU route);
- recording real business traffic (owner decision; §9).

### 5.7 Schedule

| When | Step | Notes |
|---|---|---|
| 10-16 → 10-20 | FID-0 | $0 |
| 10-21 → 10-23 | FID-1 | only if the FID-0 gate passes |
| 10-30 → 11-03 | FID-2 | |
| after the engine bump | FID-3: an OSS twin as an M3 reference, within the D5 image cap | §9 |

---

## 6. F6 Outside ground truth

### 6.1 Claim

Foundry's advantage over the simple baselines is measured on worlds, specs and graders written by others, and on real
process data. Every result states its origin, and in-generator effects are reported as upper bounds until an outside bed
confirms them.

### 6.2 What exists and what is missing

**Exists:**
- **AutomationBench** at commit `4a8e106` [doc NOTES, PREREG-AB-v1]:
  - bridge parity 35/35;
  - raw Haiku on subset60: 13/60 strict (0.217), mean partial credit 0.63, $0.92 [code `subset60/summary.json`];
  - **AB-v1 is frozen:** a 300/300 dev/test split, dev at most $60, test at most $40 and run once, the A1 harness at
    `a1-v1`.
- **MA-0** (agent-H vs rehearse-H) is designed [doc MRR §3.3].
- **BPI logs.** BPI 2012, 2017 and 2019 were downloaded, measured and kept local [doc
  `research/enterprise-20261014/ACQUISITIONS.json` `data[]`]. Whether the files survive on this machine was not checked.
- **WorkArena's validator** is ported into E7 [doc BAR-SET].
- **Owner tasks** (decision 10, target 10-28) and far families (decision 11) [doc DECISIONS-ADOPTED].
- **K-Dense's 326 templates** are a task source, but have no oracles [doc SYNTHESIS].

**Missing:**
1. An origin label on every row (S1).
2. A cross-bed transfer table.
3. An outside **recurring** bed: AB-R is ours, grounded on AutomationBench.
4. A real user's process.
5. Real-log scoring of our worlds. E1 and E9, the items calibrated to BPI, are not built; E7 and E8 have no real log.

### 6.3 Prior art

| Work | Take | Reject |
|---|---|---|
| AutomationBench paper [S]: tasks LLM-generated from Zapier use cases, then hardened; app behaviour "does not represent exact production behavior" | An out-of-generator world and grader | Reading its score as transfer to real systems: it is tier M1 |
| Sim2Real predictivity [S] | Report rank agreement of the same arms across our beds and outside beds | — |
| WebArena, TheAgentCompany, WorkArena, WorkBench [S; doc CATALOGUE B7, B8, B15] | Self-hosted or local real software. WorkBench is MIT, a local sandbox with an end-state oracle and 690 tasks, and needs no credentials | Benchmarks that need vendor instances (WorkArena) for now |
| Chapela-Campa et al. log-distance measures; Simod; AgentSimulator [S] | Score generated worlds against real event logs with peer-reviewed distances | A home-made realism score |
| AI Agents That Matter [web]; OpenScience's tuning on its reported sets [doc OPENSCIENCE §7.1] | Holdout discipline | Development on the reported set |

### 6.4 First experiment

**OUT-0 ($0).**
- Add S1 origin labels and back-fill existing rows.
- **The transfer table** pairs the same contrasts across beds:

  | Bed | Origin | Contrast |
  |---|---|---|
  | E8 | ours | workflow vs agent: +4 of 14 cases |
  | AB-R | ours, grounded on AutomationBench | wf-H vs agent-H, when it runs |
  | AutomationBench | outside | A1 vs A0; rehearse-H vs agent-H |

**OUT-1 ($0 new spend).** It uses the AB-v1 test run (its preregistration, its caps) and MA-0 (MRR plan, cap $40).
- **What F6 adds:** only the cross-bed reading. AB-v1 keeps its own frozen prediction and decision rules (§10 of that file).
- **Prediction:** the outside effect is smaller than the in-generator one.
- **Refutation of the premise.** The premise is that the method is not tuned to our worlds. It is refuted if AB-v1 is "not
  supported" or "harm" while our beds show large effects. Then every in-generator effect is reported as an upper bound, and
  no program claims transfer.

**Second outside world ($0 acquisition, owner default yes).** Acquire WorkBench: a shallow, inert clone at a pinned SHA, with
URL, SHA, date, licence and outcome recorded. It is a second third-party world for LP-1 and EARN.

**Real process.**
- **Owner tasks and the recurrence list** stay the real-user rung. If nothing arrives, the rung is reported missing.
- **BPI scoring** waits for E1 and E9.
- **Recording any real business traffic** is an owner decision (credentials and personal data), never automatic.

### 6.5 Build items

| Item | Owner path (new) | Needed because |
|---|---|---|
| Origin field and back-fill | `experiments/claims/origin.mjs` | We design the specs, worlds and graders |
| Transfer table | `experiments/outside/transfer.mjs` | No cross-bed reading exists |
| WorkBench acquisition record | `research/outside-20261015/ACQUISITION.md` | A second outside world |
| Log-distance harness, deferred to E1 and E9 | `experiments/outside/logdist.mjs` | Real-log realism |

### 6.6 Schedule

| When | Step |
|---|---|
| 10-16 → 10-18 | OUT-0 |
| as each lands | the MA-0 (10-18 → 10-21) and AB-v1 rows enter the transfer table |
| after an owner yes | WorkBench acquisition |

---

## 7. F7 Long-term upkeep

### 7.1 Claim

Over a schedule of realistic drift (field renames, enum extensions, policy editions with and without notice, new record
forms, removed endpoints), workflows that detect and heal keep reliability at lower cumulative upkeep than an agent that
adapts on every tick. Upkeep is counted in dollars, wall time, failed cases before recovery and wrong reuse. If the claim is
false, we say so.

### 7.2 What exists and what is missing

**Exists:**
- **E8 drift:**
  - a d4 edition switch [code `beds/ebed/e8/world.mjs:49,330-333`];
  - a d5 F5 rename of `billing.charge` `amountMinor` → `amount` [code `world.mjs:324`];
  - SPEC-E tells builders how to handle `field-renamed` [doc `SPEC-E.md:175-176`].
- **E-BED drift tiers per item:** sealed no-notice editions [doc `E-BED.md:247-248`] and an edition-detection-latency metric
  [doc `E-BED.md:620`].
- **The JIT dev stream:** a static solver failed silently on d4 drift (2/8), and a heal that widened a guard turned refusals
  into silent failures [doc RESEARCH.md:119].
- **The heal loop** is blocked; the **B1N repair path** works [doc].
- **The need router's DRIFT stage** re-checks model and CLI drift monthly [code `stages.json`].
- **R10:** a fingerprint change sends cross-run items to shadow [doc MRR §3.2].

**Missing:**
1. **Unpractised drift.**
   - **Why the current drift does not count.** E8's builds practised on d4 and d5 worlds and read SPEC-E's rename rule.
     Today's E8 drift is therefore *announced* drift, which the build loop absorbs.
   - **What F7 needs instead:** editions written after the build, by a session blind to the solvers.
2. A drift-module format.
3. An upkeep ledger.
4. Consumer pacts for impact analysis at $0.
5. Real-history drift.

### 7.3 Prior art

| Work | Take | Reject |
|---|---|---|
| Stripe date-based versioning; Cadwyn [S] | Each drift event is a version-change module (transform, docs, resources touched, a side-effect flag). The prior is about 16 breaking changes a year for a well-run API | — |
| oasdiff, buf, Confluent modes [S] | Classify every event by level and check id; split shape drift from side-effect drift | Our single F5 rename as "the" drift |
| Vendor OpenAPI repos and APIs.guru; Yasmin et al. (RADA); Di Lauro et al. [S] | Real-history editions; no-notice removals are common, so no-notice is the default | Invented-only drift |
| "The World Won't Stay Still"; MCPEvol-Bench [S]: deprecation cut GPT-5 from 0.56 to 0.45; stale experience misleads | Count **wrong reuse**, not only failures; put the mock edition in R10's fingerprint | Measuring only agent degradation: neither measures workflow upkeep cost, which is F7's open half |
| Pact can-i-deploy [S] | A pact per built workflow (the operations, fields and enum values it depends on), so affected workflows are found at $0 | — |
| Hammoudi, Rothermel, Tonella, ICST 2016 [web]: 1,065 breakages of record/replay tests over 453 versions; per a summary, locators are the main cause | Brittle identifiers are the main break; our analogues are field names and ids | — |
| BUMP (Reyes et al., SANER 2024) [web]: 571 reproducible breaking dependency updates from 153 Java projects, as Docker images (README: at least 250 GB) | A real breaking-change corpus for the OSS-maintenance example | Acquiring it now (size) |
| ReliabilityBench [S] | Within-run schema drift at a swept intensity ε | — |
| CME AutoCert+ [S] | Re-certify on every edition | — |

### 7.4 First experiment

**DRIFT-0 ($0, first).**
1. **The drift-module schema:**
   - `effectiveAt`;
   - class and check id;
   - `kind`: shape or side-effect;
   - `notice`: event or silent;
   - the transform;
   - the spec-delta text;
   - the affected requirement ids.
2. **An overlay** on E8 world generation and systems.
3. **Pact extraction** from each lineage's smoke journals.
4. **A static impact check** that predicts which events break which lineage.

**DRIFT-1 (development; editions written by a session blind to the solvers, following the E-BED rule).**
- **Six events over a simulated quarter, none of them practised:**
  1. a rename on a different system and operation (an `inventory.reserve` item field);
  2. an enum extension (a new carrier status);
  3. a policy edition with notice (new `customerActionHours` plus one new rule);
  4. the same edition as sealed no-notice;
  5. a new inbound record form;
  6. an endpoint removed and replaced, without deprecation.
- **Epochs.** Each event opens an epoch of sized worlds (size 12) on seeds 1232 and 1233.

| Arm | What it does | Role | Cost |
|---|---|---|---|
| **WF-static** | the frozen B1L-H and B1N solvers, no heal | floor; measures silent failure | $0 (DRIFT-1a) |
| WF-heal | detection from oracle-free signals (host refusals, `field-renamed`, an unknown enum, a new edition file) → an F3 typed request to a fresh Haiku builder with practice worlds of the new edition (`repair.mjs` path, not the blocked heal kit) | F7 | about $3–6, cap $10 (DRIFT-1a) |
| **WF-rebuild** | a B1L-H rebuild with the updated spec at each event | simple workflow baseline | DRIFT-1b |
| **Agent-adapt** | agent-H per tick reading the current spec and editions | the owner's comparison arm | DRIFT-1b |

DRIFT-1b (WF-rebuild plus agent-adapt) is about $21, cap $30 [arith: agent-adapt 6 epochs × about $1.5 × 2 seeds ≈ $18; rebuild
6 × about $0.5 ≈ $3].

- **Metric, per event:**
  - detection latency, in business hours and in cases;
  - cases failed silently before detection;
  - upkeep $ and wall time;
  - wrong reuse;
  - owner minutes, which are 0 in simulation and counted where an approval is needed.
- **Metric, over the schedule:**
  - cumulative pass rate;
  - total cost of ownership = build + runs + upkeep.
- **Capability number:** cumulative pass rate and cost per verified success, WF-heal against agent-adapt.
- **Prediction:**
  - (a) WF-static fails silently on ≥ 2 events.
  - (b) The static impact check catches ≥ 0.8 of the shape events and misses the side-effect events.
  - (c) WF-heal recovers each signalled event within one heal session at ≤ $0.6, but detects the no-notice semantic edition
    later than agent-adapt.
  - (d) Agent-adapt costs ≥ 5× WF-heal's total upkeep over the quarter, at no higher pass rate.
- **Refuted if:**
  - agent-adapt reaches a higher cumulative pass rate at ≤ 2× WF-heal's total cost. Then, at this drift rate, adapting
    agents win;
  - the impact check misses more than 20% of the breaking shape events. Then pacts cannot target upkeep at $0.

**DRIFT-2 (deferred, $0 acquisition).**
- **Source:** shallow, inert clones of two vendor spec repositories, HubSpot-public-api-spec-collection and Xero-OpenAPI. The
  sweep recorded their HEADs as `bc758dd` and `59b760a` [S].
- **Classification:** consecutive commits are classified by a pinned oasdiff if its binary can be fetched. Otherwise a minimal
  classifier in `experiments/drift/classify.mjs`, because the proxy blocks GitHub release downloads [doc README].
- **Output:** empirical change-class rates, then real-history editions on FID-2's AutomationBench mocks and the AB-R families.

### 7.5 Build items

| Item | Owner path (new) | Needed because |
|---|---|---|
| Drift-module schema and overlay | `experiments/drift/module.schema.json`, `apply.mjs` | Today's drift is announced and practised |
| Pact extraction and static impact | `experiments/drift/pact.mjs`, `impact.mjs` | Targeted upkeep at $0 [S Pact] |
| Upkeep ledger and total cost of ownership | `experiments/drift/upkeep.mjs` | No upkeep measurement exists [doc OWNER-DECISIONS F7] |
| Blind edition texts | `experiments/drift/editions/` | The E-BED blind-author rule |

**Not built:** continuous diff against vendor systems (needs accounts), or BUMP (size).

### 7.6 Schedule

| When | Step | Notes |
|---|---|---|
| 10-17 → 10-21 | DRIFT-0 | |
| 10-22 → 10-25 | DRIFT-1a | WF-static is $0; WF-heal is about $3–6 |
| 10-28 → 11-02 | DRIFT-1b | |
| after FID-2 | DRIFT-2 | |

---

## 8. F8 Speed and latency as a first-class metric

### 8.1 Claim

Every comparison reports these beside accuracy and cost:
- wall time per case (p50, p90, p99);
- time to the first correct result;
- time per verified success;

all on one timing record that separates model, tool, mock and waiting time. Conclusions are qualified where speed reverses
them.

### 8.2 What exists and what is missing

**Exists:**
- **The need router** reports median latency per mode, but keeps it out of utility (λ_t = 0; the owner declared none) [doc
  `PREREG-NEED-V1.md:482`, `DESIGN.md:193`].
- **E8:** agent-H runs about 85 ticks an hour and needs about 7 h per full world; builds take 19–24 minutes; workflows take
  seconds [doc B1-E8-DEV].
- **Rows already carry time:**
  - AutomationBench rows carry `durationMs` [code `experiments/autobench/run.mjs:210,252`];
  - `label-run` rows carry `latencyMs` and minutes [code];
  - agent-H rows carry `wallMs` [code `experiments/ebed/run-agent.mjs:95-97`].
- **The host's simulated clock** gives each system a `latencyMinutes` [code `beds/ebed/host/host.mjs:786`].
- **Rate-limit contamination** is handled as an environment fault (E8 s12, M1-R) [doc].

**Missing:**
1. Components: model, tool, mock and the separate waits.
2. Tails.
3. A business-time vs compute-time split.
4. Mock-overhead subtraction.
5. Worst-case cost reservation for in-flight calls. Timeouts were booked at $0 [doc SYNTHESIS take 3].

### 8.3 Prior art

| Work | Take | Reject |
|---|---|---|
| Dean and Barroso, "The Tail at Scale" (CACM 2013) [web] | Report tails, not means | Hedged requests: they double spend, and the need router already rejected them (DESIGN.md:721) |
| LLMCompiler (Kim et al., ICML 2024) [web]: parallel function calling; up to 3.7× latency, 6.7× cost and about 9% accuracy against ReAct (maxima) | Parallel fan-out is a latency lever for workflows (`map`) and a fair baseline for agents (parallel tool calls) | Reading maxima as typical |
| AI Agents That Matter [web] | Pareto frontiers; we add a time axis | — |
| MIRAGE (about 3 s per call) [S]; Pantheon [S] | Subtract or simulate mock time; latency is a fitted mock parameter | Charging a workflow for its mock's latency |
| ReliabilityBench: rate limiting was the most damaging fault [S] | Count Retry-After waits for every arm | — |
| OpenScience's cadence harness [doc OPENSCIENCE §7.2] | Its metric set: duration, time to first output, parallelism | "Completed" with no correctness check |

### 8.4 First experiment

**LAT-0 ($0).** Derive latency from existing rows:
- E8: builds and agent ticks;
- M1 and M1-R: per call;
- AutomationBench subset60;
- P1;
- the JIT stream;
- NL rows as they land.

Report per mode p50, p90 and p99, time per verified success, and environment-fault rows separately with their concurrency.

**LAT-1 ($0 spend).** S6 is added to every new runner in this plan. The F8 comparison with arms runs **inside EARN-1**, the
same arms on the same triggers.
- **Prediction:**
  - (a) Workflow per-trigger p50 is ≥ 10× faster than agent-H.
  - (b) Time to first correct for a new family runs agent < earn < always-workflow, because the build takes about 20 minutes.
- **Refuted if** agent-H's p90 is ≤ 2× the workflow's p90 on AB-R. Then speed claims are limited to tick-heavy beds like E8.

**Two clocks, never mixed [I].**
- **Compute wall time:** what the owner waits.
- **Business time on the simulated clock:** time-to-durable, edition detection latency.

### 8.5 Build items

| Item | Owner path (new) | Needed because |
|---|---|---|
| Timing record (S6) | `experiments/timing/schema.mjs` | Stalls confound wall time today |
| Derivation from existing rows | `experiments/timing/derive.mjs` | Cheapest first reading |
| Report (tails, Pareto, time per verified success) | `experiments/timing/report.mjs` | Every comparison |
| Worst-case reservation in the meter | `experiments/claims/meter.mjs` | Timeouts booked at $0 |
| Product journal timing fields | `src/`, at the engine bump | after the matrix |

**Not built:** hedged requests, or λ_t inside the utility before the owner declares a value.

### 8.6 Schedule

| When | Step |
|---|---|
| 10-16 → 10-17 | LAT-0 |
| from 10-18 | S6 in every new runner |

---

## 9. What we drop or defer

**Drop: the evidence says it is unnecessary or harmful.**

| Item | Reason |
|---|---|
| A learned, LLM or Jev predictor of need or mode (F1) | Jev asked directly scores 0.44–0.53 AUROC; the best text head scores 0.71, with Jev's increment over code inside noise (J-NEED-2, M1-R); decision 12 |
| LLM-held stateful mock endpoints, and an LLM judge of mock fidelity (F5) | EnvSimBench's state cliff; SimSAT gets about 1 in 9 read-after-write calls wrong [S] |
| An LLM skill scanner as a gate (F2) | It flagged 15 of 136 copies of the same text [doc] |
| Autoskill-style skill creation from screen history (F2) | No verification; privacy [doc KDENSE-SKILLS §6.5] |
| Hedged requests (F8) | They double spend [doc DESIGN.md:721] |
| A separate skill creator (F2) | F1's earned path into the library ladder is the creator |

**Defer: needs an owner decision, a credential, a GPU or a prior result.**

| Item | Waits for |
|---|---|
| Vendor sandboxes or real SaaS accounts for F5's M3 tier | Owner ("no account changes") |
| Recording real business traffic (Keploy-style) | Owner: credentials and personal data |
| OSS twins (ERPNext, Odoo, Zammad, EspoCRM, Mattermost, Nextcloud) as M3 references | FID-1 validating the harness; within the D5 image cap; GPL systems run as black boxes only |
| Learned mock simulators (MirrorAPI) | The GPU route (D9) |
| Argument-level policy language (Progent-style) | LP-1B showing that in-scope misuse dominates |
| λ_t in utility | An owner-declared value |
| BUMP | Size: its README asks for at least 250 GB of free disk |
| More than two vendor repositories of real-history drift | DRIFT-2's first two |
| CRMArena or WorkArena on real vendor instances | Accounts |
| Harbor-based science benchmarks | Modal or Harbor credentials [doc README] |
| BPI log-distance scoring | E1 and E9 being built |
| Beds for the owner's own examples: MVP → CI/CD, OSS maintenance, rule-bound research programs | An owner process or recurrence list (decisions 10, 11). Candidate seeds: BUMP for OSS maintenance; this repository's own rule-bound research discipline, which is in-house and therefore never F6 evidence |
| Product schema changes (node `capabilities`, typed requests, journal timing) | The engine bump on or after 11-04 |
| Claim-bearing (sealed or held-out) versions of every first experiment | Each one's own preregistration after its development result |

---

## 10. One ordered roadmap

**Order rule [I].** $0 stages first. Within paid work, earlier is cheaper and more informative, and nothing blocks NL0–NL2b.
Dates are targets; their order is binding.

| # | When | ID | Program | What | Est. | Cap | Depends on | Decides |
|---|---|---|---|---|---|---|---|---|
| 1 | 10-15 → 10-17 | SPINE-0 | all | S1 claim row, S6 timing, the meter with reservation; S5 schema stub | $0 | – | – | the fields every later row carries |
| 2 | 10-16 → 10-17 | LAT-0 | F8 | latency from existing rows | $0 | – | 1 | the first F8 table |
| 3 | 10-16 → 10-18 | OUT-0 | F6 | origin back-fill; transfer table skeleton | $0 | – | 1 | – |
| 4 | 10-16 → 10-20 | EARN-0 | F1 | offline replay; primitive detector (#65); guard recall | $0 | – | 1 | the frozen earning rule |
| 5 | 10-16 → 10-19 | LP-0 | F2 | ingestion and strip rules; offline finder; J-Q2 material | $0 | – | – | the index for LP-1 |
| 6 | 10-16 → 10-20 | FID-0 | F5 | differential harness, mutants, panel; validity gate ≥ 0.9 | $0 | – | 1 | whether FID-1 may run |
| 7 | 10-17 → 10-21 | DRIFT-0 | F7 | module schema, overlay, pacts, impact check | $0 | – | 6 (diff harness reused) | – |
| 8 | 10-18 → 10-22 | FIX-0 | F3 | solver mutants with labels; classifier | $0 | – | – | – |
| 9 | 10-18 → 10-22 | SPEC-0 | F4 | carriers, leak and coverage tests, renderer prompts | $0 | – | MA-1 T0 (shared code) | – |
| — | 10-18/19 | NL0 stamp and run | (existing) | need-router matrix | – | – | – | none of rows 1–9 touches a stamped tree |
| 10 | 10-21 → 10-23 | FID-1 | F5 | auto vs hand-built on E8; panel SRCC | $14–16 | $25 | 6; 8 optional (extra panel members) | whether auto mocks can carry promotion evidence |
| 11 | 10-22 → 10-24 | LP-1A | F2 | selection accuracy on a frozen query set | $1–2 | $3 | 5, query author | finder vs all-tools |
| 12 | 10-22 → 10-25 | SPEC-1 | F4 | perfect vs derived vs derived + ledger vs no-spec agent | $8–10 | $20 | 9 | the spec recovery ratio; the tracker as bridge |
| 13 | 10-22 → 10-25 | DRIFT-1a | F7 | WF-static ($0) and WF-heal on blind editions | $3–6 | $10 | 7, 8 (request schema) | silent failure; heal cost |
| — | 10-24 | Need-router freeze | (existing) | analysis files frozen | – | – | – | F1 uses `router.mjs` read-only |
| 14 | 10-26 → 10-29 | LP-1B | F2 | blast radius on AutomationBench dev via AB-H | $5 | $10 | 5, AB-H (MRR row 8) | whether app-level grants suffice |
| 15 | 10-27 → 10-31 | EARN-1 | F1, F8 | five policies on six AB-R families, with latency | $15–20 | $30 | 4, AB-R §3.11 gates, verifier miss rate, 1 | earned vs fixed structure; F8 speed reading |
| 16 | 10-27 → 10-30 | FIX-1 | F3 | inline vs request vs rule vs rebuild; governor | $7–13 | $20 | 8, REC-1 Z2 (10-21) | the routing rule; the governor |
| 17 | 10-28 → 11-02 | DRIFT-1b | F7 | WF-rebuild and agent-adapt arms | $21 | $30 | 13 | the upkeep comparison |
| 18 | 10-30 → 11-03 | FID-2 | F5, F6 | auto mock vs AutomationBench's own implementation | $5 | $10 | 10 | fidelity against a reference we did not write |
| 19 | when AB-v1 test and MA-0 land | OUT-1 | F6 | the cross-bed reading | $0 new | – | AB-v1, MA-0 | upper-bound labelling |
| 20 | ≥ 11-04 | E-bump items | F2, F3, F8 | node `capabilities`, typed request, journal timing; freeze record | $0 | – | the matrix ends (NL2b) | product support |
| 21 | November | sealed versions | all | EARN-2 (AB-R held-out), SPEC-2 and FIX-2 (sealed E-bed families), FID-3 (OSS twin), DRIFT-2 (real history), LP-2 (WorkBench) | at their preregistrations | – | each one's development result plus owner decisions | claim-bearing numbers |

**Dependency chain in one line:**

```
SPINE-0 → {LAT-0, OUT-0, EARN-0, FID-0}
FID-0 → FID-1 → FID-2
FID-0 → DRIFT-0 → DRIFT-1a → DRIFT-1b
FIX-0 → DRIFT-1a (request schema)
FIX-0 → FIX-1 (after REC-1 Z2)
SPEC-0 → SPEC-1
LP-0 → LP-1A
LP-0 → LP-1B (after AB-H)
EARN-0 → EARN-1 (after the AB-R gates)
AB-v1 + MA-0 → OUT-1
```

**Fit with the existing plan.**
- **Stamped trees.** No row edits a stamped tree.
- **Development runs.** Rows 10–18 are development runs on dev seeds or dev-train, beside NL1, NL2, E2E and REC-1.
- **Usage.** The owner's weekly allowance, not money, is the binding limit (README "Cost ledger"). For information only, D14
  stays the owner's call: rows 1–9 are code-heavy orchestration, and their usage weight is mostly subagent tokens.
  Rows 10–18 are short paid runs.

---

## 11. Budget [arith]

**New spend in this plan:**

| Experiment | Est. | Cap |
|---|---|---|
| EARN-1 | $15–20 | $30 |
| LP-1A | $1–2 | $3 |
| LP-1B | $5 | $10 |
| FIX-1 | $7–13 | $20 |
| SPEC-1 | $8–10 | $20 |
| FID-1 | $14–16 | $25 |
| FID-2 | $5 | $10 |
| DRIFT-1a | $3–6 | $10 |
| DRIFT-1b | $21 | $30 |
| **Total** | **about $79–98** | **$158** |

F6 and F8 add $0.

**Existing commitments, at estimates:**

| Commitment | Est. | Source |
|---|---|---|
| Need router | $951 (caps $1,235) | `stages.json` totals |
| MRR plan | $310 (caps $450) | MRR §5 |
| AB-v1 | at most $100 | its preregistration |
| AB-R | about $450–550 | RECURRING-DESIGN owner summary |
| **Total** | **about $1,860** | |

Adding this plan gives about $1,950, against the $1,500 soft cap. Every single experiment stays under the $500 pause.

**If the soft cap binds, drop these first** (the least information lost per dollar saved):
1. FID-1's Opus architect variant: −$12.
2. DRIFT-1b's agent-adapt on one seed instead of two: −$9.
3. EARN-1 on four families instead of six: −$5.

Beyond that, the MRR drop list applies (REC-1 main on two jobs, −$110), then the AB-R stage sizes, which are the owner's
call.

---

## 12. Owner decisions (each has a default)

| # | Question | Default |
|---|---|---|
| 1 | The soft cap binds once AB-v1 and AB-R are counted (§11) | Run every $0 stage; run the paid rows in §10 order, each under its cap; drop in §11 order if needed. Or raise the cap |
| 2 | A latency value λ_t for utility | None: latency is reported beside utility, never inside it |
| 3 | A real process of yours for F6 (and the F1 owner examples): owner tasks, the recurrence list, or recorded traffic | No recording. Owner tasks and the recurrence list as already requested (decisions 10, 11); the rung is reported missing if none arrive |
| 4 | Real systems for F5's M3 tier | OSS twins within D5, after FID-1. No vendor accounts |
| 5 | Acquire WorkBench (MIT, local, no credentials) as a second outside world | Yes: a shallow, inert clone with an acquisition record |
| 6 | LP-1B plants injection texts in AutomationBench worlds; they may reach only the host-run loop (MRR F13) | Yes, AB-H only |
| 7 | Who writes LP-1A's frozen query set | A decision-11 far-family author; otherwise you |
| 8 | The heal-kit `HEAL_POLICY_DRIFT` choice (README) | Unchanged. F3 and F7 do not depend on it: they use the `repair.mjs` path |

---

## Appendix A. Sources

**Looked up today, 2026-10-15 [web]** (abstract or snippet level unless stated otherwise):
- Shi et al., *Progent: Programmable Privilege Control for LLM Agents*: https://arxiv.org/abs/2504.11703 (v1 HTML
  https://arxiv.org/html/2504.11703v1; v2 https://arxiv.org/html/2504.11703v2).
- Debenedetti et al., *Defeating Prompt Injections by Design* (CaMeL): https://arxiv.org/abs/2503.18813.
- Gan and Sun, *RAG-MCP*: https://arxiv.org/abs/2505.03275 (HTML v1 https://arxiv.org/html/2505.03275v1).
- Wang, Mao, Fried, Neubig, *Agent Workflow Memory*, ICML 2025: https://arxiv.org/abs/2409.07429;
  https://proceedings.mlr.press/v267/wang25bx.html.
- Wang, Gandhi, Neubig, Fried, *Inducing Programmatic Skills for Agentic Tasks* (ASI), COLM 2025:
  https://arxiv.org/abs/2504.06821.
- Leno, Augusto, Dumas, La Rosa, Maggi, Polyvyanyy, *Identifying candidate routines for Robotic Process Automation from
  unsegmented UI logs*, ICPM 2020: https://arxiv.org/abs/2008.05782.
- Kim et al., *An LLM Compiler for Parallel Function Calling*, ICML 2024: https://arxiv.org/abs/2312.04511.
- Kapoor, Stroebl, Siegel, Nadgir, Narayanan, *AI Agents That Matter*, TMLR 2025: https://arxiv.org/abs/2407.01502;
  https://agents.cs.princeton.edu/.
- Ataei et al., *Elicitron*: https://arxiv.org/abs/2404.16045.
- Mu et al., *ClarifyGPT*: https://arxiv.org/abs/2310.10996; FSE 2024 page
  https://2024.esec-fse.org/details/fse-2024-research-papers/89/ClarifyGPT-A-Framework-for-Enhancing-LLM-based-Code-Generation-via-Requirements-Clar.
- Dean and Barroso, *The Tail at Scale*, CACM 56 (2013) 74–80: https://research.google/pubs/pub40801/.
- Friedrich, Mendling, Puhlmann, *Process Model Generation from Natural Language Text*, CAiSE 2011, LNCS 6741:482–496, DOI
  10.1007/978-3-642-21640-4_36. Only citation entries were seen; the method is not summarised from the paper.
- Hammoudi, Rothermel, Tonella, *Why do Record/Replay Tests of Web Applications Break?*, ICST 2016:180–190, DOI
  10.1109/ICST.2016.16; summary https://blog.acolyer.org/2016/05/30/why-do-recordreplay-tests-of-web-applications-break/.
- Reyes, Gamage, Skoglund, Baudry, Monperrus, *BUMP*, SANER 2024: https://arxiv.org/abs/2401.09906; Zenodo
  https://zenodo.org/record/10041882.
- Saltzer and Schroeder, *The Protection of Information in Computer Systems*, 1975: https://www.cs.virginia.edu/~evans/cs551/saltzer/.
  Only the front matter was seen; the least-privilege wording comes from secondary summaries.

**From the prior-art sweep given to this session [S]** (the sweep's own read dates are 2026-10-15; I did not re-open them):

| Work | URL |
|---|---|
| AutomationBench | https://arxiv.org/abs/2604.18934 |
| AWM-env (Agent World Model) | https://arxiv.org/abs/2602.10090 |
| EnvScaler | https://arxiv.org/abs/2601.05808 |
| MCP-Persona | https://arxiv.org/abs/2606.02470 |
| ClawsBench | https://arxiv.org/abs/2604.05172 |
| MIRAGE | https://arxiv.org/abs/2604.04806 |
| EnvSimBench | https://arxiv.org/abs/2605.07247 |
| SimSAT | https://arxiv.org/abs/2607.16900 |
| ToolEmu | https://arxiv.org/abs/2309.15817 |
| MirrorAPI | https://arxiv.org/abs/2503.20527 |
| WebDreamer | https://arxiv.org/abs/2411.06559 |
| Prism | https://github.com/stoplightio/prism |
| Hoverfly diff mode | https://docs.hoverfly.io/en/latest/pages/keyconcepts/modes/diff.html |
| Microcks | https://www.cncf.io/?p=164530 |
| PactFlow | https://docs.pactflow.io/docs/bi-directional-contract-testing/provider |
| Keploy | https://keploy.io/record-replay-testing |
| LocalStack parity testing | https://github.com/localstack/localstack/blob/main/docs/testing/parity-testing/README.md |
| Fidelity of Cloud Emulators, ICSE 2025 | https://conf.researchr.org/details/icse-2025/icse-2025-research-track/132/Fidelity-of-Cloud-Emulators-The-Imitation-Game-of-Testing-Cloud-based-Software |
| Software Engineering at Google, ch. 13 | https://abseil.io/resources/swe-book/html/ch13.html |
| ShardStore | https://jamesbornholt.com/papers/shardstore-sosp21.pdf |
| Mysteries of Dropbox | https://www.cis.upenn.edu/~bcpierce/papers/mysteriesofdropbox.pdf |
| RESTler | https://www.microsoft.com/en-us/research/publication/restler-stateful-rest-api-fuzzing |
| IDL | https://arxiv.org/abs/2005.03320 |
| Meta ARE / Gaia2 | https://arxiv.org/abs/2509.17158 |
| τ²-bench | https://arxiv.org/abs/2506.07982 |
| Sim2Real gap in user simulation | https://arxiv.org/abs/2603.11245 |
| Generative agent simulations of 1,000 people | https://arxiv.org/abs/2411.10109 |
| CRMArena | https://aclanthology.org/2025.naacl-long.194 |
| TheAgentCompany | https://arxiv.org/abs/2412.14161 |
| Pantheon | https://usenix.org/conference/atc18/presentation/yan-francis |
| Sim2Real Predictivity | https://arxiv.org/abs/1912.06321 |
| Path-exploration lifting | https://people.eecs.berkeley.edu/~dawnsong/papers/2012%20Path%20Exploration%20Lifting%20Hi%20Fi%20Tests%20for%20Lo%20Fi%20Emulators.pdf |
| nesdev emulator tests | https://www.nesdev.org/wiki/Emulator_tests |
| Mahimahi | https://www.usenix.org/conference/atc15/technical-session/presentation/netravali |
| Chapela-Campa et al. | https://arxiv.org/abs/2303.17463 |
| Market simulator realism | https://arxiv.org/abs/1912.04941 |
| ASME V&V 40 slides | https://www.imagwiki.nibib.nih.gov/sites/default/files/asme_vv_40_model_simulation_standard.pdf |
| FMI | https://fmi-standard.org/ |
| Antithesis deterministic simulation testing | https://antithesis.com/docs/resources/deterministic_simulation_testing/ |
| CME AutoCert+ | https://www.cmegroup.com/tools-information/webhelp/autocert-brokertec-oe/Content/GettingStarted.html |
| ReliabilityBench | https://arxiv.org/abs/2601.06112 |
| Stripe API versioning | https://stripe.com/blog/api-versioning |
| oasdiff | https://github.com/oasdiff/oasdiff |
| APIs.guru | https://github.com/APIs-guru/openapi-directory |
| Yasmin et al. | https://arxiv.org/abs/2008.12808 |
| "The World Won't Stay Still" | https://arxiv.org/abs/2603.05910 |

**Via MRR's Appendix A [doc]** (not re-opened by me):
- Mohr, Kranz, Halstead 1991;
- ADaPT;
- RLM;
- Kim et al. 2026;
- the Anthropic multi-agent note;
- LLMRouterBench;
- Dekoninck et al.;
- IRT-Router.

## Appendix B. Repository paths checked today

**Code:**
- `src/capabilities.mjs:8-17`
- `schemas/workflow.schema.json:141,146,200,207`
- `src/executors/claude-code.mjs:304`
- `experiments/library/retrieve.mjs:80-92`
- `experiments/library/quarantine.mjs:17-29`
- `beds/ebed/host/mocks.mjs:1-16`
- `beds/ebed/host/faults.mjs:6-14`
- `beds/ebed/host/host.mjs:786`
- `beds/ebed/host/systems/e8.mjs` (5 systems, 153 lines)
- `beds/ebed/e8/world.mjs:49,324,330-333`
- `experiments/autobench/families/` (6 families)
- `experiments/autobench/harness/foundry.mjs:1-14`
- `experiments/autobench/run.mjs:210,252`
- `experiments/ebed/run-agent.mjs:95-97`
- `experiments/rec/`, `experiments/tracker/`, `experiments/heal/`, `experiments/need-router/` (listings)

**Data:**
- `research/need-router-20261014/prereg/stages.json` (stages, `engineStamp`, totals)
- `research/architecture-20261014/runs/z1/result.json`
- `research/automationbench-20261014/runs/raw-haiku/subset60/{summary,failures-classified}.json`

**Documents:**
- `research/architecture-20261015/OWNER-DECISIONS.md`
- `research/architecture-20261014/MEMORY-ROUTING-RECURSION.md`
- `research/enterprise-20261014/{B1-E8-DEV,E-BED,BAR-SET,CATALOGUE}.md` and `ACQUISITIONS.json`
- `research/need-router-20261014/{DESIGN,PREREG-NEED-V1,DECISIONS-ADOPTED}.md`, `runs/{m1-r,jev-need2}/REPORT.md` and
  `tracker-e8/REPORT.md`
- `research/architecture-20261014/runs/jq/REPORT.md`
- `research/automationbench-20261014/{NOTES,PREREG-AB-v1,RECURRING-DESIGN}.md`
- `research/harness-deconstruct-20261015/*.md`
- `beds/ebed/e8/README.md`, `beds/ebed/e8/spec/SPEC-E.md:120-123,175-176`, `beds/ebed/e7/README.md`,
  `beds/need-nospec-records/README.md`
- `experiments/tracker/README.md`
- `docs/ROADMAP.md` §6, `docs/RESEARCH.md:117,119`
- `README.md`

**Not verified by me:**
- every [S] and [doc] item;
- the AB-R per-family costs;
- whether the BPI files survive on this machine;
- whether the E-bed host can take an injected systems map without an edit (FID-1 notes the fallback);
- the four ClawsBench bug classes the sweep does not name.
