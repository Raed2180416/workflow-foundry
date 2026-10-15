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
- **Revised the same day after an adversarial critique** (at HEAD `57cebba`, which adds the first paid A1 dev run on
  AutomationBench: 0/6 strict, mean partial credit 0.28, $0.10 [code `research/automationbench-20261014/runs/a1-dev-first6/summary.json`]).
  Thirty-six points were raised; 30 were accepted and changed the text below, and 6 were rejected. Each one is listed,
  with its reason, in the **Critique log** at the end. The main changes:
  - EARN-1 runs only on AB-R **TRAIN** families, and the AB-R split is fixed before it.
  - The strongest agent baseline (agent-H plus a validator) runs on E8 first.
  - The freeze rules now cover the AB-v1 harness files.
  - Every first experiment prints its minimum detectable effect, and readings are three-way.
  - BPI logs and WorkBench templates enter F6 now.
  - The owner simulator is truth-first.
  - WF-heal pays for its own updated mock.
  - The budget is restated on the cap basis that governs the soft cap.
  - The spine is trimmed to what two programs need now.

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
   - **Only S1 is built as a shared record now**, with the S6 timing fields inside it. S4 already exists. S2, S3 and S5 start
     as code local to their first experiment (EARN, LP and FID), and become shared only when a second program's
     preregistration needs them (ROADMAP §6 rules 5 and 12).
   - **Most programs meet in two of them.** F1's "earn it, then build it" path is the same path as:
     - F3's fresh-builder request;
     - F2's skill creator;
     - F7's re-earning after drift.

     F5's fidelity harness is also F7's drift detector and F6's second outside reference.
   - **[I]** One mechanism serves several programs, so building it once is the cheaper design.
2. **Every first experiment has a falsifiable prediction and the strongest simple baseline as an arm.**

   | Program | Simple baselines in its first experiment |
   |---|---|
   | F1 | always agent + verifier, run first on E8 (AGENTV-E8) and then on AB-R; always workflow; decide once from text |
   | F2 | all tools; the regex screen (for the skill screen) |
   | F3 | always inline; always request; rebuild from scratch |
   | F4 | a perfect spec given; an agent with no spec (the better of agent-H and agent-H + validator) |
   | F5 | the hand-built mock; a schema-only mock |
   | F6 | the in-generator estimate of the same matched contrast |
   | F7 | rebuild on every change; an agent that adapts (the better of agent-H and agent-H + validator) |
   | F8 | the agent arm's wall time; latency comes from every run, not from its own arms |

   **Resolution rule.** Every first experiment prints its minimum detectable effect (MDE) before it runs. Its reading is
   *supported*, *refuted* or *inconclusive*, and a threshold below the MDE can only read inconclusive (§0.3).
3. **$0 first.** Every program has a $0 stage that can start now, in new directories:
   - none of them touches `src/`, `policy/models.json`, `experiments/lib/`, `experiments/c0/`, `beds/lib/` or the need-router
     stamped files;
   - product schema changes wait for the engine bump after the matrix, on or after 11-04.
4. **New paid spend.**
   - **Total:** about $81–106 estimated and $164 at the caps, across eight paid first experiments plus the penny J-Q2
     [arith, §11]. Each is far below the $500 pause.
   - **F6 and F8 add $0.** They ride on AB-v1, MA-0 and every other run.
5. **Budget warning.** The soft cap is checked on a **cap basis**: each stage counts at the larger of its cap and its
   metered runs (`stages.json totals`, PREREG-NEED-V1 "Committed spend, not caps").
   - On that basis, the need router ($1,372.81) plus the rest of the MRR plan (about $425) already reach about $1,800,
     which is over the $1,500 soft cap before AB-v1, AB-R or these programs.
   - With AB-v1 and AB-R added, the total is about $2,350–2,450, and about $2,510–2,610 with this plan. At estimates it is
     about $1,920–2,050 with this plan [arith, §11].
   - **Default changed:** every $0 stage runs.
     - **Two small paid rows run anyway:** AGENTV-E8 and LP-0b, $6 together at the caps. Their results reshape the larger
       rows, and they are recorded as a soft-cap deviation.
     - **Every other paid F row waits** for your answer to §12 decision 1. The recommendation is a $2,700 cap-basis soft
       cap, or cuts to AB-R's later stages.
6. **What you see when.**
   - **By about 10-19:** **AGENTV-E8.** Does agent-H plus a validator close E8's 14/14 vs 10/14 gap? This is the
     strongest simple baseline, never run before.
   - **By about 10-27:**
     - **FID-1:** does an automatically built mock give the same verdicts on the existing solvers as the hand-built E8 mock?
     - **SPEC-1:** how much of the perfect-spec result survives a messy business?
     - **DRIFT-1a:** do the frozen E8 workflows fail silently on drift they never practised? This part costs $0.
     - **OUT-2:** do real process logs (BPI) recur the way our stream generators assume? This costs $0.
   - **By about 11-02:**
     - **EARN-1:** does earned structure beat both fixed policies on the AB-R **TRAIN** families?
     - **LP-1:** does least privilege cost success, and does it shrink the blast radius?
     - **FIX-1:** inline fix or sub-workflow request?
     - **DRIFT-1b:** the upkeep comparison between workflows that heal and an agent that adapts.
   - **AB-v1:** its test run follows its own preregistration.
7. **Decisions for you** (§12; each has a default):
   - the budget;
   - the AB-R TRAIN/held-out split, which EARN-1 now needs first;
   - a latency value λ_t, if you want latency inside the utility (default: report it beside the utility);
   - a real process of yours for F6;
   - OSS twins, but no vendor accounts, for F5;
   - acquiring WorkBench as a second outside world (its 69 task templates also make it an outside recurring bed).

---

## 0. How the eight fit together

### 0.1 The spine: six shared records

**Admission rule [I].** A record exists only if at least two programs need it, or the owner asked for it by name. Each is
justified by measured evidence.

**Build rule (revised after the critique) [I].** Admission does not mean building now.
- **S1 (with the S6 timing fields) is built in SPINE-0**, because every paid row needs it.
- **S4 exists.**
- **S2, S3 and S5 start as experiment-local code** inside EARN, LP and FID. Each becomes a shared module only when a second
  program's preregistration needs it. This follows ROADMAP §6 rule 5 ("Don't build assurance machinery a phase doesn't
  need") and rule 12 ("No new subsystem without a pre-registered experiment that needs it").
- **Each $0 stage commits its PREDICTION.md before its code**, as J-Q did (`research/architecture-20261014/runs/jq/REPORT.md`).

| # | Record | What it holds | Used by | Evidence it is needed | Where (new) |
|---|---|---|---|---|---|
| S1 | **Claim row** `claim-row/0` | Program, experiment and arm. The bed and its **origin**: our generator, ours grounded on outside tasks, an outside world with our grader, an outside world and grader, or real process data. **Fidelity tier** of every world or mock touched (S5). Evidence class (development or sealed) and K. **USD** split into run, build, world, upkeep, imputed, and reserved but unsettled. **Timing** (S6). Environment faults | all | **F5:** E8's $1.70 "leaves out" the world's cost (OWNER-DECISIONS F5). **F6:** we design the specs, worlds and graders (README "Evaluation validity: weakest link") [doc]. **F8:** seconds against hours in E8 [doc B1-E8-DEV]. Today's rows carry $ and K but no origin, fidelity or world cost [code: e.g. `research/automationbench-20261014/runs/raw-haiku/subset60/summary.json`] | `experiments/claims/` |
| S2 | **Earn ledger** | Per need signature (a task kind, a node's sub-need or a defect class): recurrences, verified passes, verified failure classes, cost so far, and promote and deopt events | F1 (per task), F3 (governor, per node), F2 (skill creator), F7 (re-earn after drift) | E8: 25 of agent-H's 27 invalid outputs repeat one misreading, because a fresh session cannot learn [doc B1-E8-DEV]. The repeat is observable, so it can be counted. The JIT dev stream spent 54% of its money on compiles at 24 tasks [doc `docs/RESEARCH.md:119`], so building too early is a real cost | `experiments/earned/ledger.mjs` |
| S3 | **Capability grant record and broker** | Per node, its declared tools, MCP servers, connectors, skills, data scopes, egress hosts, credential names and effect classes. Every request and decision, journaled. Default deny | F2, F3 (a request that needs a capability), F7 (a heal that needs one) | J-Q: the regex screen has recall 0.39 and catches 0/13 exfiltration texts [doc `research/architecture-20261014/runs/jq/REPORT.md`]. K-Dense: 136 of 177 skills carry a self-citation directive the regex misses [doc KDENSE-SKILLS §5.3]. The executor's network is not isolated (README "Subagents") [doc] | `experiments/provision/` |
| S4 | **Requirement ledger** (the tracker) | Conditions quoted from the user's own text, each with an id, a check and a status | F4 core; F1's verifier; F7 (an edition changes requirement ids); the AB A1 harness (`REQUIREMENTS.md`) | E8: every builder error missed a whole requirement, and every agent error misread the contract [doc OWNER-DECISIONS F4, B1-E8-DEV] | exists: `experiments/tracker/` (not stamped) |
| S5 | **World manifest** | Per world or mock, per endpoint: tier (M0–M4, §5.4), what it was validated against (system, date, snapshot hash), coverage, quirk log, editions as drift modules, and build cost per stage | F5 core; F6 (origin and tier); F7 (editions) | Cloud emulators diverged on 37% of 255 APIs [S]. AutomationBench's apps are docs-derived and were never checked against the real systems [S]. The cost of E8's world was never recorded [doc] | `experiments/mockfid/manifest.schema.json` |
| S6 | **Timing record** | Wall time split into model, tool, mock and waits (rate limit, Retry-After, queue, human); concurrency; simulated business time recorded separately | F8; every program | The need router keeps latency out of utility because wall times "are confounded by concurrency and stalls (one stall lasted 187 minutes)" [doc `research/need-router-20261014/DESIGN.md:193`] | `experiments/timing/` |

**Rule [I].** In an F-program comparison table, a result row without the S1 fields is diagnostic only and may not appear.
- **Rows from preregistered runners keep their own reporting rules:** NL0–NL2b, AB-v1 and the AB-R preregistration. Their
  runners are frozen and cannot emit S1.
- **Their S1 fields are back-filled** by `experiments/claims/origin.mjs`, and each back-filled field is marked `derived`.
- **The rule never demotes a preregistered result.**

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
- **AB-v1 freeze (added after the critique) [doc PREREG-AB-v1 §1.3, §5, §7, AM-8].**
  - **Read-only files.** F programs never edit the A1 harness's shared files: `experiments/autobench/{bridge.py,tool.mjs,lib.mjs,run.mjs}`,
    `experiments/autobench/harness/`, or any module those import. A change to any of them is a harness change under
    AB-v1 §7, and a change during the test run invalidates A1.
  - **Where F code goes instead.** Anything an F program needs from AutomationBench (a widened grant, planted records,
    world dumps, call sequences) is a wrapper in the program's own directory. It pre-processes a world JSON before
    `bridge.py serve --world`, or reads `bridge.py` output, and never patches it.
  - **Dev tasks only.** Every F run on AutomationBench goes through `assertDevOnly()`, on dev-train tasks only.
  - **Exposure scan.** F-program transcripts are in scope for AM-8's exposure rescan before the test run.
  - **Separate budget.** F spend on AutomationBench is booked to its own F row, never to AB-v1's $60 dev budget.
- **Resolution (added after the critique) [I].** Every first experiment's preregistration prints its minimum detectable
  effect (MDE) at its K and n before it runs, as MRR change 7 did for H4.
  - **Three-way reading.** Supported, refuted, or *inconclusive*.
  - **Thresholds below the MDE.** A prediction or refutation threshold below the MDE is kept as written, but it can only
    read inconclusive unless the interval excludes it.
  - **Why.** Development runs at K = 1 or 2 on 3–6 family clusters cannot resolve differences of 0.03–0.05 utility or a few
    points of pass rate.
- **Metering [doc PREREG-NEED-V1 §12, "Committed spend, not caps"].**
  - Every F runner meters by the need router's §12 convention: reserve each call's bound before launch, and charge a
    timeout at its bound.
  - For example, M1 shows $62.92 on that meter against a $10 estimate, mostly because its timeouts are charged at their
    bound.
  - The soft-cap check counts each F row at the larger of its cap and its metered spend.
- **E8 regression [I].** F programs edit the E8 bed in two places: FID-1's injected systems map and DRIFT's overlay. Each
  such edit ships with a test that the existing graded rows on worlds 1232–1234 reproduce byte-identically. Those rows are
  B1-H, B1-O, B1L-H, B1N-H and agent-H s12. M1e, the forced stratum and four programs read them.
- **No E8-only claims [I].** Five first experiments rest on E8 worlds 1232–1234: AGENTV, FIX, SPEC, FID-1 and DRIFT. That
  is one generator we wrote, with three seeds. So no program's claim-bearing run may be E8-only, and each names its non-E8
  bed in §10 row 24.
- **Usage [doc README "Cost ledger"; ROADMAP §6 D14 proposal].** The weekly allowance, not money, is the binding limit, and
  a cloud session already ended on it on 10-09 (README status).
  - **Before the NL0 run (10-18/19):** at most three F-program build streams run at once, and the NL0 preparation items of
    MRR §5 rows 1–8 go first.

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
  span the need spectrum, but **three of the six are designated held-out** [doc RECURRING-DESIGN §4 headings, §3.9]:

  | Family | Stratum | AB-R split (proposed) |
  |---|---|---|
  | dealdesk | workflow pays | TRAIN |
  | suppression | workflow pays | held-out near |
  | noshow | agent fine | held-out near |
  | reviews | agent fine | TRAIN |
  | mailroom | slider-sensitive | held-out near |
  | slawatch | HARD, timer | TRAIN (forced stratum) |

  - **The rule on held-out families.** RECURRING-DESIGN §3.9 says a held-out family's dev streams 610–613 "may be used for
    harness rehearsal only. They never feed router fitting." The split itself is still an open owner decision (§3.13
    item 4).
  - **Consequence.** EARN-1 may use only TRAIN families, and the split must be fixed before EARN-1 (§1.5, §12).
  - **Coverage today.** The three built TRAIN families cover three strata. No slider-sensitive TRAIN family is built yet:
    `abr-sup-routing` and `abr-fin-receipts` are TRAIN but not built.

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

**How "recurrence" is read [I].** The owner's F1 text puts recurrence among the day-one primitives *and* among the
signals that earn a workflow.
- **This design reads it as follows.** Declared recurrence opens an S2 ledger entry on day one, and the build waits for
  evidence.
- **The literal reading is tested too.** Under it, declared recurrence means a workflow from day one, which is exactly the
  A-wf arm. EARN-1 therefore tests both readings.

**The earning rule v0** [I]. It is frozen before EARN-1. Thresholds chosen on dev data are labelled as such.
- **Promote** need signature *s* when either:
  - *s* recurred r ≥ 3 times and the verifier rejected the same failure class twice. A failure class is the verifier's
    failing check id, assigned by code; or
  - r ≥ 5 and the cumulative agent cost on *s* is at least the expected build cost B̂.
- **What B̂ is.** B̂ = $0.57 per lineage, which is B1N-H's $1.70 over three lineages (build plus repair) [doc B1-E8-DEV].
  The first draft called $0.60 "the B1L-H mean", but the B1L-H build mean is $0.51.
- **What B̂ leaves out.** It excludes the practice world (mock) the build needs, whose cost is unknown for E8 and AB-R
  (F5). EARN-1 therefore reports the break-even world cost W\* (§1.5).
- **The cost condition is the break-even rule of the ski-rental problem** [web].
  - What it is: rent (run the agent) until the rent paid equals the purchase price (the build), then buy.
  - Its guarantee: it is 2-competitive among deterministic online rules, if the built workflow is at least as accurate as
    the agent.
  - When that guarantee lapses: if the workflow is less accurate, the guarantee does not hold. The q term in the utility
    then decides.
- **Demote** (deopt back to agent + verifier) when 50% or more of the units fall back after k units (MRR §3.4).
- **The horizon matters.**
  - At AB-R's assumed $0.02 per trigger (RECURRING-DESIGN §3.12), the cost condition fires near trigger 30.
  - On a single 40-trigger stream, a build that late is pure loss inside the horizon.
  - So EARN-1 chains a family's four weekly dev streams into one 160-trigger history. N = 160 is AB-R's own headline N.

### 1.4 Prior art

| Work | Take | Reject |
|---|---|---|
| Agent Workflow Memory (Wang et al., ICML 2025) [web]: induces reusable routines from experience, online or offline; +51.1% relative on WebArena, +24.6% on Mind2Web | Online induction from the stream itself, with no up-front oracle | Text workflows admitted without verification: ASI reports gains over it from programmatic verification |
| ASI, Inducing Programmatic Skills (Wang et al., COLM 2025) [web]: a skill is admitted only if the task is solved, the skill is called and every call changes the environment; reported gains of 23.5% and 11.3% over a static baseline and Agent Workflow Memory (the units are unclear in the abstract) | Admit by execution, not by description. This is the same rule as our library ladder | Using an induced skill's own trajectory as its reuse evidence. Our ladder needs held-out runs |
| RPA candidate-routine discovery from unsegmented UI logs (Leno, Augusto, Dumas, La Rosa, Maggi, Polyvyanyy, ICPM 2020) [web] | Recurrence found in logs as the trigger for automation: process mining's "automate what repeats" | Automating on frequency alone, with no correctness evidence |
| Routing and cascades: LLMRouterBench ("routers do not reliably beat a simple baseline"); Dekoninck et al. (quality estimators are critical) [doc MRR App. A] | "Verify, don't predict": start cheap, escalate on a failed check | A learned predictor of need |
| AI Agents That Matter (Kapoor et al., TMLR 2025) [web]: simple baselines and cost-controlled comparison; inadequate holdouts | Both fixed policies as arms; report cost (and time, F8) | Accuracy-only leaderboards |
| Our own JIT stream [doc RESEARCH.md:119] | Hotness counters and deopt | Fixed compile thresholds that ignore compile cost (54% of spend) |
| Ski rental; competitive analysis (Karlin, Manasse, Rudolph, Sleator, *Competitive snoopy caching*, Algorithmica 1988; citation entry only, the paper was not opened) [web] | The break-even cost condition and its 2-competitive guarantee, under the stated accuracy assumption | Randomised buy points (e/(e−1)-competitive): they add variance to a development run with three to six clusters |

### 1.5 First experiment

**EARN-0 ($0, first).** An offline replay of existing rows: the E8 paired run, the JIT dev stream, and the M1, M1-R and
NL0/NL1 rows once they exist.
- **What it computes:** what the earning rule would have chosen at each step, and its counterfactual pass and cost.
- **Sensitivity grid:** r ∈ {2, 3, 5}, failures ∈ {1, 2}, B̂ ∈ {$0.4, $0.57, $1.0}. It is chosen on dev data and labelled
  so.
- **Deopt check:** on the JIT records stream's d4 drift (seeds 217–224, where the static solver failed silently, 2/8),
  would the demote rule have fired, and after how many units? The rows are in `research/jit-20261008/runs/jit-dev-records-1/`.
- **Also:** guard recall of the primitive detector on the typed declarations of every bed (RX6-lite style).
- **Not used:** AB-R held-out families' rows, of any kind.

**AGENTV-E8 (paid, development; runs first, about $2–3, cap $5).** This is the strongest simple baseline, run on the one bed
where a workflow advantage was measured.
- **Why first.** B1-E8-DEV names "an agent-H-with-validator arm we have not run". 25 of agent-H's 27 invalid outputs repeat
  one contract misreading, which a host refusal shown back to the session would expose.
- **Arm.** agent-H per tick (`experiments/ebed/run-agent.mjs`, used unchanged) inside a wrapper in `experiments/earned/`.
  The wrapper validates the tick output against the contract schema and the host's own refusal before commit. On a
  refusal, it retries once with the refusal text. It never shows grading.
- **Bed.** Sized world 1232 d2 size 12, the identical 14 cases (10/14 for agent-H, 14/14 for the workflows); 1233 is added
  if the cap allows.
- **Reading.**
  - If agent-H + validator reaches ≥ 13/14, E8's workflow advantage is a contract-reading advantage, not a structure
    advantage. F1, F3 and F7 then use this arm as their agent baseline.
  - If it stays ≤ 11/14, the advantage survives the strongest simple agent.
  - Either way, its wall time and dollars enter LAT-0.
- **Resolution.** The MDE at 14 paired cases is large: about 4–5 discordant cases. The run reads "supported" only at 14/14
  vs ≤ 10/14. Anything else is inconclusive and informs only which agent arm the later programs use.

**EARN-1 (paid pilot, development, K = 1 chained history per family and arm).**

| Arm | Policy | Role |
|---|---|---|
| A-agent | agent-H per trigger, no verifier (AB-R arm) | cheapest baseline |
| **A-agentV** | agent-H per trigger plus a deployable verifier, with at most one retry carrying the verifier's reason | **simple baseline: always agent + verifier** |
| **A-wf** | `wf-H` built once on practice streams before trigger 1 (AB-R arm; read as the mean over its K = 3 lineages, which exist at $0 extra) | **simple baseline: always workflow**; also the literal reading of "recurrence is a day-one primitive" |
| A-text | one decision per family at intake from text, by the frozen size rule and NR-static (`router.mjs`, used read-only). Its outcome is taken from the chosen arm's rows, so it costs $0 | the method F1 replaces |
| **A-earn** | primitives get structure from trigger 1; the probe runs on trigger 1; otherwise agent + verifier; promote and deopt by the frozen rule | F1 |
| agent-O, reference, null | AB-R ceilings and controls (RECURRING-DESIGN §3.8) | bounds |

- **The verifier** is oracle-free:
  - after a trigger it re-reads the world;
  - it runs code checks for that trigger kind. The checks are written once from `POLICY.md` by the AB-R **second reader**
    (RECURRING-DESIGN §3.11 gate 6: a session that did not write the family), **never by the family author**, who wrote
    the oracle and the truth;
  - it never imports oracle, truth or generator code, and a test asserts this;
  - these are hand-written checks, not tracker v1's auto-extracted properties, which MRR change 4(d) rejects as a check
    source;
  - both its conditional miss rate, P(pass | wrong), and its false-rejection rate are measured before the run at $0 and
    reported (MRR change 10). Wrong cases are planted wrong actions; right cases are reference-solver actions. The arm
    runs either way, labelled by those rates.
- **Metric:**
  - **Per chained history** (a family's four weekly dev streams 610 → 613 run in order; the world resets per stream, while
    the S2 ledger and any built workflow carry over):
    - trigger pass rate by the AB-R oracle (effects per trigger, exactly-once, timing);
    - utility u = p − c/V − B/(N·V) − (W/V)·q − r/(N·V) at V = $1, W = V and N = 160. This is the need-router formula
      (DESIGN.md:185), including its routing term r: the probe, the verifier calls the agent arms do not otherwise pay,
      and ledger overhead;
    - **W\*, the break-even world cost** at which A-wf and A-earn fall to A-agentV's utility. The practice worlds the
      builds use are not free (F5), and their cost is unknown for AB-R;
    - wall time p50/p90 per trigger and time to first correct trigger (F8).
  - **Capability number:** pooled u(A-earn) − max(u(A-agentV), u(A-wf)), with a family-cluster bootstrap. Also reported:
    regret against the best fixed policy for each family in hindsight.
  - **MDE, printed before the run [arith].** Take a family-level SD of utility differences of about 0.10, and 3 TRAIN
    clusters. Then SE ≈ 0.058, and the MDE at 80% power is about 0.16. With 6 TRAIN clusters it is about 0.11.
- **Beds:**
  - **AB-R TRAIN families only**, after AB-R's $0 validity gates (RECURRING-DESIGN §3.11) and after the owner fixes the
    split (§12 decision 9). Today these are dealdesk, reviews and slawatch, plus routing, receipts and referral once
    built;
  - the held-out-near families are reserved, untouched, for EARN-2;
  - E8 enters as a forced-stratum diagnostic from existing rows ($0), and through AGENTV-E8.
- **Cost.**
  - **Incremental:** the A-agentV and A-earn arms, about $15–20, cap $30 [arith: 3 families × 160 triggers × $0.03 per
    verified agent trigger ≈ $14.4 for A-agentV; A-earn about $3 of agent phase, 3 builds at $0.4–0.7 and about $0.3 of
    workflow runs]. This assumes AB-R's own stage-2 arms (agent-H, wf-H on 610–613 of the TRAIN families) run anyway.
  - **Standalone:** about $30, cap $45.
- **Prediction (fixed now; each is read against the MDE):**
  - (a) A-earn is within 0.03 utility of the better fixed policy on every stratum, and beats A-text by ≥ 0.05 pooled.
    Both thresholds are below the MDE, so at K = 1 this reads at best inconclusive-consistent.
  - (b) On reviews (agent fine), A-earn promotes only by the cost condition, between triggers 25 and 40 of 160. Its
    utility is within 0.03 of A-agentV over the 160 triggers.
  - (c) On dealdesk (workflow pays), it reaches A-wf's per-trigger pass rate within 10 triggers.
  - (d) On slawatch it equals A-wf, because of the timer primitive.
  - (e) Guard recall on declared primitives is ≥ 0.9.
  - (f) On the d3 streams, where AB-R delivers policy amendments by email (RECURRING-DESIGN §4.1), a built workflow that
    misses an amendment is demoted by the deopt rule within 5 triggers, or is caught by the verifier.
- **Refuted if any of these holds** (each needs the interval to exclude the threshold; otherwise the reading is
  inconclusive):
  - A-wf beats A-earn by more than max(0.05, MDE) pooled. Then "always workflow + verification" is the policy, and earning
    is unnecessary complexity.
  - A-agentV beats A-earn by more than max(0.05, MDE) pooled. Then earning costs more than it saves.
  - Guard recall is below 0.9. Then the guard asks instead of inferring, as DESIGN.md:257 already says.
  - W\* is below $1 per family while A-wf's lead over A-agentV rests on the free practice worlds. Then the workflow
    advantage on AB-R is a free-mock artefact, and the claim waits for FID evidence.

### 1.6 Build items

| Item | Owner path (new) | Needed because |
|---|---|---|
| Primitive detector over typed declarations (task #65) | `experiments/earned/primitives.mjs` | The owner's F1 text; text predictors ≤ 0.71 |
| Earn ledger (S2) and the frozen promote/deopt rule as a pure function | `experiments/earned/ledger.mjs`, `policy.mjs` | No promotion trigger exists |
| Stream runner applying a policy over AB-R and E8 streams, reusing the arms | `experiments/earned/stream.mjs` | Arms exist per trigger; no policy-level runner |
| Deployable verifier for agent arms, with a measured miss rate and false-rejection rate; the E8 variant is the contract and refusal validator of AGENTV-E8 | `experiments/earned/verify-agent.mjs` | The agent-H-with-validator arm was never run |
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
| 10-17 → 10-19 | AGENTV-E8 | about $2–3, cap $5; the validator wrapper only, no stamped tree |
| before EARN-1 | the AB-R TRAIN/held-out split (owner decision, RECURRING-DESIGN §3.13 item 4; §12 decision 9) | blocks EARN-1 |
| 10-27 → 10-31 | EARN-1 | TRAIN families only; needs the split, the AB-R validity gates, S1 and the verifier's rates |
| after the AB-R held-out streams open (after the need-router freeze) | claim-bearing EARN-2 at K = 2 on the held-out-near AB-R families, plus a WorkBench template arm (§6.4) | the first non-E8, non-AB-R recurrence evidence |

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

**LP-0b (the screen's capability number; J-Q2 pulled forward from MRR §5 row 17; about $0.10, cap $1).** The owner's F2
text says outside skills are "screened before any node can load them". So the screen needs its own number now, not in
November.
- **What is tested.** Exactly the frozen composite that J-Q proposed: a typed screen (Haiku label, or Jev at 0.5) OR the
  structural `credential-url` rule. It is tested against the regex baseline (J-Q recall 0.39) and against both unions.
- **Material.** A re-authored planted set: new skill bodies, new phrasings, the K-Dense steering family and K-Dense
  defensive prose as hard negatives. An adaptive adversary rewrites the misses once.
- **Thresholds.** They are fixed now: recall ≥ 0.95 at FPR ≤ 0.05.
- **Gate.** The ingestion gate (`screenOutsideText`) stays the regex until this passes, as the J-Q REPORT says.

**LP-1A (selection, about $1–2, cap $3).**
- **The query set** is written independently and frozen first: by the owner or a decision-11 far-family author. Held-out
  "Example request" lines are the fallback. When they are used, they are **stripped from the indexed skill bodies**,
  because otherwise the finder retrieves the query's own text.
- **Finder misses.** Every query whose needed capability has no match in the index is counted as a *creator request*. Its
  outcome is read in FIX-1 (§3.4), where the R-request path is the creator.
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
  | **G-all** | all 47 apps connected. This is **not** AutomationBench's default: the official runner already sets `meta.allowed_services` and returns 401 outside it [doc NOTES §4]. G-all is made by a world pre-processor in `experiments/provision/`, never by editing `bridge.py` (§0.3) |
  | G-oracle | the task's own `allowed_services`, i.e. the official setting. It is derived partly from the assertions, so it is a ceiling, not deployable |
  | **G-lp** | a read-only discovery phase; the finder fixes the grant; expansion requests during the act phase are refused and logged |
  | G-lp+req | the same, but expansion requests are auto-granted and logged (Progent's worst-case approver) |

  - **A $0 check comes first [not verified].** Does `bridge.py serve --world` keep a widened `meta.allowed_services`, or
    recompute it in setup? Does a planted record change the task contract hash that `--expect-contract` checks?
  - **If either blocks:** LP-1B needs a separate wrapper process. It never edits the bridge.

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
- **Resolution.** On 30 tasks, one task is 3.3 points, and raw Haiku passes about 22% strictly (about 6 of 30) [code
  `subset60/summary.json`].
  - The clean comparison is therefore read on **paired partial credit** first, with strict pass beside it. Prediction (c)
    and the first refutation below are read against the printed MDE.
  - The injected-condition contrast (a) has more room, because G-lp should be near 0 by construction.
- **Refuted if any of these holds:**
  - G-lp loses more than max(5 points, MDE) of clean pass, or of paired partial credit. Then strict grants cost too much,
    and requests must be the default.
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

**The skill creator is merged, not dropped [I].** The owner asked for "a skill finder and creator". The creator is made of
paths that already exist in this plan:
- **When the finder misses** (LP-1A counts these), a node files F3's typed request (§3.4). A fresh cheap builder makes the
  capability. It is admitted to the library ladder only by execution: its own planted-mutant check (MRR change 4), then
  held-out runs.
- **When a need recurs**, F1's earned path makes the same kind of artefact.
- **Its capability number.** The share of finder misses that end as an admitted, verified skill, with dollars and
  minutes. It is measured on FIX-1's structural defects that need a new capability.
- **Its baseline.** No creator: the node fails or asks the owner.

**Not built:**
- an LLM scanner as a gate;
- autoskill-style creation from screen history (KDENSE-SKILLS §6.5);
- an argument-level policy language, until LP-1B shows that in-scope misuse dominates.

### 2.6 Schedule

| When | Step | Depends on |
|---|---|---|
| 10-18 → 10-21 | LP-0 ($0) | — (moved after the NL0 run: usage rule, §0.3) |
| 10-20 → 10-21 | LP-0b (J-Q2, about $0.10) | LP-0's material |
| 10-22 → 10-24 | LP-1A | the frozen query set |
| 10-26 → 10-29 | LP-1B | AB-H (MA-0's harness, MRR §5 row 8; not in the tree yet), the $0 bridge check above |
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
  1,022/1,022, also under the revised oracle: `runs/regrade-oracle2-b1lh-e8-1/result.json`):
  - about 20 planted defects. **Local** ones keep the same capability set: a wrong constant (edition hours), a wrong
    comparison, a missing field. **Structural** ones need a new capability, effect, obligation or verifier: a deleted
    compensation branch, a deleted deadline obligation, a retry without its key, unhandled `migration` orders;
  - **reuse, not a new generator.** E8 already has a mutation-mined latent-defect miner (`beds/ebed/e8/defects.mjs`) and
    an operator set (`beds/ebed/e8/tools/mutate.mjs`) [code]. The operator file is on disk today but not yet in
    `git ls-files`, so FIX-0 either pins it by hash or waits for its commit. FIX-0 applies those operators to the solver copy, plus the
    structural deletions above. Defects that the miner finds to be E0-silent and revealed later are kept as a labelled
    subset, which F7 also uses;
  - the four real defects: B1-O's batch key, lineage 2's missed requirement, lineage 3's retry semantics, B1-H's imagined
    read file.
- **Labels are assigned by construction**, from the operator or the deletion that planted the defect. They are not
  assigned by the classifier that R-rule routes with.
  - The classifier's agreement with the construction labels (computed from each reference patch's capability diff) is
    reported as a $0 validity check. Below 0.9, R-rule is not run.
  - This removes the circularity of a classifier grading its own routing.
- **Detection evidence is identical for every arm, and oracle-free.** It is the orders on which the defective solver
  disagrees with its own previous version on practice worlds 1235–1237. This is the B1N disagreement format, with the last
  good version standing in as the reference, as in regression testing.

**FIX-1 (about $7–13, cap $20; development).**

| Arm | What happens |
|---|---|
| R-none | detect only (floor) |
| R-inline | a Haiku session with the full build context (SPEC-E, contract, its code, the smoke runner) patches the solver directly |
| R-request | every defect becomes a typed request (need, evidence, spec references, return schema, budget carve) to a fresh Haiku builder, through `subflow`'s `child` mode (`experiments/rec/subflow.mjs`), not a new request path; the result is a typed module with its own planted-mutant check (MRR change 4) |
| **R-rule** | the agent proposes a fix plan; code computes the plan's capability diff and routes it inline or as a request |
| **Rebuild** | a full B1L-H rebuild from scratch: a strong simple baseline at $0.39–0.62 and 98.2% mean. **It costs $0 new.** A rebuild never sees the defect, so the three existing B1L-H lineages are already its samples. Per defect event it costs one build ($0.51 mean) and restores every case with probability 1/3; with N-version repair (B1N-H) it costs $0.57 per lineage and restores all three [doc B1-E8-DEV]. The rebuild's own new defects count as regressions |

- **Governor sub-test.** The same structural defect is planted in all three lineages. The governor builds once and applies to
  all three, each with its own verification. It counts the savings and any wrong reuse.
  - **What this is a proxy for.** It tests repeats across *workflows*. The owner's wording is repeats "across nodes". That
    within-workflow case waits for a bed whose nodes share a sub-need.
  - **What is built for it.** The governor is built only to the extent this sub-test needs: a fingerprint and a memo, no
    service. There is no repeat data yet to justify more.
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
| Typed request schema, as an **extension of `subflow`'s call shape** (no third format beside `subflow` and `repair.mjs`); requests that need a capability go through LP's experiment-local broker | `experiments/fixroute/request.mjs` | B1N worked from disagreement evidence alone |
| Governor, minimal: fingerprint, memo, wrong-reuse counter, only what the sub-test needs | `experiments/fixroute/governor.mjs` | OWNER-DECISIONS F3 |
| Solver mutants with labels from construction, using `beds/ebed/e8/tools/mutate.mjs` operators read-only | `experiments/fixroute/mutants.mjs` | A controlled ground truth for routing |

The product typed request lands with `subflow` at the engine bump. **Not built:** planner or critic teams, or a discretionary
allowance (MRR §4).

### 3.6 Schedule

| When | Step | Notes |
|---|---|---|
| 10-19 → 10-23 | FIX-0 | $0 |
| 10-27 → 10-30 | FIX-1 | after REC-1's Z2 pilot (10-21), so that `subflow` mechanics are known first. Independent of the heal-kit decision: it uses the `repair.mjs` path |

**FIX-1 and REC-1.** REC-1 main (MRR §5 row 14, from 10-24) asks a related question: `child` or `inline` by size and
failure. FIX-1 asks it by capability.
- **No change to REC-1.** FIX-1 does not alter REC-1 main's design.
- **Where FIX-1's result goes.** It feeds the product request schema at the engine bump, and any REC-2.

---

## 4. F4 Spec from a messy business

### 4.1 Claim

A cheap builder must derive the contract from emails, documents, records and an owner who answers questions. Two claims
are made about it, and one quantity is measured:
- **Claim:** it recovers more of the perfect-spec result when the requirement tracker (derive, confirm, check) bridges the
  gap.
- **Claim:** it beats an agent that never gets a spec, on the same cases.
- **Measured, not claimed:** the fraction of the perfect-spec result it recovers, the **spec recovery ratio**. This carries
  a prediction band (§4.4), not a claim.

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

**The renderer belongs to SPEC-0 [I].**
- **Where it lives.** SPEC-0 writes the truth-first renderer in `experiments/specbiz/`. MA-1's T0 may import it.
- **Why.** The first draft made SPEC-0 depend on "MA-1 T0 (shared code)", but T0 waits for E8 admission (#54), and MA-1
  runs 10-21 → 10-28 (MRR §5 rows 10 and 13). That is later than SPEC-0.

**The owner simulator is truth-first** (MRR §3.3 rules 1 and 3: "Recorded, never regenerated"; MRR §4 lists "actor text
regenerated at run time" as not to build). Nothing is generated at run time:
1. **Offline, in SPEC-0.** Every intent record gets a pre-rendered answer text, content-addressed in the pack.
2. **At run time.** A builder's `ask(question)` is mapped to intent-record ids by a typed judgment. The judgment chooses
   from a closed list plus *no-match*, and is journaled; Haiku does it, at cents.
3. **The answer.** It is the pre-rendered text of the matched records, withheld with the seeded probability unless the
   question names the record's subject. *No-match* gets a fixed "I don't know, use your judgment".
4. **Replay.** It is byte-identical for the same journal.

**SPEC-1 (about $8–10, cap $20; development; K = 2 lineages per build arm).** The rendering is truth-first: a content-addressed
pack, never regenerated (MRR §3.3 rule 3).

| Arm | What it gets | Role |
|---|---|---|
| **S-perfect** | B1L-H with SPEC-E: existing rows, K = 3, mean 98.2% | ceiling ($0) |
| S-derive | B1L-H conditions, but the corpus instead of SPEC-E, plus `ask(question)` to the owner simulator (at most 20 questions, each journaled and charged) | F4 |
| **S-derive+ledger** | as S-derive, plus the tracker flow: extract a quote-anchored ledger from the corpus; the simulated owner confirms or edits it from the intent records; the builder gets the confirmed ledger | the bridge |
| **S-none-agent** | the better agent arm from AGENTV-E8 (agent-H, or agent-H + validator) per tick with the corpus, no build, on sized world 1232 d2 size 12 (agent-H with SPEC-E scored 10/14 there) | floor |

- **One common case set.** All four arms are scored on the 14 cases of sized world 1232 d2 size 12. Build arms are graded
  there at $0 (`build.mjs --grade-only --size 12`). The "beats an agent with no spec" claim reads only on these shared
  cases.
- **Metric:**
  - completed-case pass rate on grading worlds 1232–1234 × d2, d3, d5, for build arms only (agents cannot finish full
    worlds: about 7 h each);
  - **spec recovery ratio** = S-derive / S-perfect;
  - requirement recall: which gold ids are unimplemented, from per-rule oracle failures;
  - questions asked;
  - $, including the renderer and the simulator.
- **Prediction:**
  - (a) S-derive reaches 0.60–0.85 of S-perfect, with its misses concentrated in the records-only and owner-only carriers.
  - (b) The ledger adds ≥ 10 points of requirement recall.
  - (c) S-none-agent scores ≤ 10/14.
- **Resolution.** With 30 gold ids, one id is 3.3 points of recall, and K = 2 lineages per arm. So the "≥ 10 points" and
  "< 3 points" readings use the printed MDE (§0.3).
- **Refuted if:**
  - S-derive reaches ≥ 0.95 of S-perfect at K = 2. Then spec derivation is not the bottleneck on this kind of task, and F4
    continues only as a test on outside beds (AutomationBench).
  - The ledger adds < 3 points, with the interval excluding 10. Then the tracker is parked as a bridge until v2.
  - Both S-derive arms score below S-none-agent on the 14 shared cases. Then building from a messy business is worse than
    not building, and F4's second claim fails.

**The outside reading** comes from F6, not from a new run: A1's `REQUIREMENTS.md` statistics against AB-v1's
policy-class failures.
- **First data point (10-15).** A1's first paid dev run collected a ledger on 6 of 6 tasks, with plan and verification
  sections, and still passed 0 of 6 strictly, at mean partial credit 0.28 [code `runs/a1-dev-first6/summary.json`]. A
  ledger's existence is not requirement recall.
- **Overlap to coordinate.** The pending task #67 (an integrated A2 harness with "N-version requirements, oracle-first
  postconditions, repair loop") overlaps tracker v2 and EARN's verifier. It should import `experiments/tracker/` and
  `experiments/earned/verify-agent.mjs` rather than fork them.

### 4.5 Build items

| Item | Owner path (new) | Needed because |
|---|---|---|
| Carrier assignment, leak and coverage tests | `experiments/specbiz/carriers.mjs`, `leak.mjs` | Exact truth for requirement recall |
| Truth-first renderer with content-addressed packs (shared with MA-1's T0) | `experiments/specbiz/render.mjs` | MA-1 rules 1–3 [doc MRR] |
| Owner simulator, truth-first: typed match of a question to intent-record ids, pre-rendered answers from the pack, withholding with a seeded probability, every answer journaled | `experiments/specbiz/owner-sim.mjs` | Sim2Real "easy mode" [S]; MRR §3.3 rule 3 |
| Tracker v2: writer prompt and trace API, preregistered as a new version | `experiments/tracker/` (not stamped) | 16–21 false alarms; property bugs dominate [doc] |

**Not built:** an LLM judge of spec quality, or a model-decided requirement truth.

### 4.6 Schedule

| When | Step | Notes |
|---|---|---|
| 10-19 → 10-23 | SPEC-0, including the renderer | $0 |
| 10-23 → 10-26 | SPEC-1 | dev worlds; E8 admission is not required for development evidence, as for the B1 arms; needs AGENTV-E8 for the floor arm |
| after admission and a sealed family | claim-bearing version, with a non-E8 bed (AutomationBench policy-class tasks through A1's ledger) | |
| MA-1 (10-21 → 10-28) | may import SPEC-0's renderer | no dependency in either direction |

---

## 5. F5 Automatic realistic mocks

### 5.1 Claim

A mock built automatically from schemas, docs and recorded traffic, plus deliberate error-path probes, reaches per-endpoint
behavioural fidelity close to a hand-built reference. Fidelity is measured two ways:
- by differential testing;
- by whether the mock ranks a panel of arms the same way the reference does.

Its build cost is itemised in every claim that rests on it.

**The actor half of F5 is MA-1, not a new program [I].** The owner's F5 includes "model-driven actors". MA-1 (MRR §3.3
and §5 row 13, cap $45) is exactly that test.
- **What MA-1 asks.** Model-written people on E8 v1.2, truth-first, recorded and never regenerated. Do they find defects
  that scripted text misses?
- **What this plan adds.** MA-1's rows carry S1 fields, and its renderer cost is booked to `usd.world`. Its kill rule is
  read as F5's actor reading.
- **A second actor.** SPEC-1's owner simulator follows the same truth-first rules (§4.4).
- **E8 already has actors.** Its scripted, on-policy actors (`beds/ebed/e8/actors.mjs`: the fraud analyst and the
  carriers) remain the reference.

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
| M4 | continuously reconciled (shadow or diff mode). Defined so the scale is complete; **not built**: no experiment here needs it |

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
    - **primary:** the same-verdict rate per case, and **leniency flips** (a control that fails on the reference but passes
      on the mock);
    - **secondary:** Spearman SRCC of arm pass rates against the reference, with ties handled by mid-ranks.
      - It is reported only when the reference panel has at least four distinct pass rates.
      - Why: the good solvers sit at 95–100% and the controls near 0, so SRCC on this panel can be degenerate. A
        schema-only mock that fails everything gives a constant vector;
  - build $ and minutes per stage.
- **Prediction:**
  - (a) Schema-only: same verdict on < 0.7 of cases (SRCC < 0.5 where defined).
  - (b) Docs-only auto: F1 between 0.80 and 0.90, and at least one leniency flip.
  - (c) Docs + traffic + probes: F1 ≥ 0.95, same verdict on ≥ 0.95 of cases, 0 leniency flips (SRCC ≥ 0.9 where defined).
  - (d) Build cost under $2 per Haiku build.
- **"Docs-only" means no access to the reference.** Its probe loop runs the candidate's own self-tests. Only the
  docs + traffic + probes arm may call the reference.
- **Refuted if:**
  - docs + traffic + probes gives same verdict on < 0.9 of cases, or flips any necessity control to pass. Then automatic
    mocks cannot carry promotion evidence, and F5 claims stay "hand-built only";
  - schema-only already gives same verdict on ≥ 0.95 of cases. Then this panel does not exercise behaviour; the bed is too
    easy to discriminate, and FID-2 becomes primary.

**FID-2 (about $5, cap $10): a reference we did not write.**
- **Reference:** AutomationBench's stateful apps (Salesforce, HubSpot, QuickBooks) as implemented in its own Python.
- **Candidate:** an automatic mock built from AutomationBench's JSONC schemas.
- **Sequences:** the scripted parity sequences on exposed dev tasks, and A0's dev-train call logs.
- **Tie to F6:** this is F6's second outside reference.
- **AB-v1 rules apply (§0.3).** FID-2 reads AutomationBench's app code and dev-train logs only. It calls `bridge.py`
  without editing it, and opens no test task.

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

**Capability number [I].** Take one matched contrast run on beds of different origin: the same arm pair, defined the same
way.
- **The number:** the ratio of its outside effect to its in-generator effect, with an interval, and whether the two
  effects have the same sign.
- **The baseline:** the in-generator estimate alone.
- **The real-process rung:** whether the generators' stream parameters fall inside the range real logs show (OUT-2).

### 6.2 What exists and what is missing

**Exists:**
- **AutomationBench** at commit `4a8e106` [doc NOTES, PREREG-AB-v1]:
  - bridge parity 35/35;
  - raw Haiku on subset60: 13/60 strict (0.217), mean partial credit 0.63, $0.92 [code `subset60/summary.json`];
  - **AB-v1 is frozen:** a 300/300 dev/test split, dev at most $60, test at most $40 and run once, the A1 harness at
    `a1-v1`.
- **MA-0** (agent-H vs rehearse-H) is designed [doc MRR §3.3].
- **BPI logs.** BPI 2012, 2017, 2019 and 2020 (domestic declarations), plus OCEL 2.0 P2P and Order Management, were
  downloaded, measured and kept local [doc `research/enterprise-20261014/ACQUISITIONS.json` `data[]`].
  - **The files survive on this machine** (checked in the revision) under `/var/tmp/foundry-work/enterprise-src/_data/`.
  - **Licences.** BPI 2012, 2017 and 2019 are under 4TU's General Terms of Use; BPI 2020 is CC BY-NC 4.0. All are local
    only and never committed.
  - **The local BPI 2019 measurement** (`/var/tmp/foundry-work/enterprise-src/_metrics/bpi2019.stats.txt`, written by the
    10-14 acquisition pass) shows how real recurrence is distributed:
    - 251,734 cases and 11,973 variants;
    - 7 variants cover 50% of the cases and 45 cover 80%;
    - 9,030 variants occur once;
    - per category, "3-way match, invoice before GR" needs 36 variants for 80% of its 221,010 cases, while "3-way match,
      invoice after GR" needs 1,192 for 80% of its 15,182.

    This is a heavy head and a long tail, the shape F1's earning rule assumes. It is real-process evidence available at $0.
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
| WebArena, TheAgentCompany, WorkArena, WorkBench [S; doc CATALOGUE B7, B8, B15] | Self-hosted or local real software. WorkBench (MIT per our catalogue; checked at acquisition) is a local sandbox with an end-state oracle and 690 tasks from 69 templates [web], and needs no credentials | Benchmarks that need vendor instances (WorkArena) for now |
| Chapela-Campa et al. log-distance measures; Simod; AgentSimulator [S] | Score generated worlds against real event logs with peer-reviewed distances | A home-made realism score |
| AI Agents That Matter [web]; OpenScience's tuning on its reported sets [doc OPENSCIENCE §7.1] | Holdout discipline | Development on the reported set |

### 6.4 First experiment

**OUT-0 ($0).**
- Add S1 origin labels and back-fill existing rows (marked `derived`).
- **The transfer table pairs one matched contrast across beds:** *practise in a mock before acting* vs *act cold*. Every
  row uses the same arm pair.

  | Bed | Origin | Practise-first arm | Cold arm | Status |
  |---|---|---|---|---|
  | E8 | ours | B1L-H (build with a smoke loop on practice worlds) | agent-H | +4 of 14 cases (exact McNemar p = 0.125) |
  | AB-R | ours, grounded on AutomationBench | wf-H (built on practice streams) | agent-H | when it runs |
  | AutomationBench | outside world and grader | rehearse-H (MA-0: works a fork, then acts) | agent-H | when MA-0 runs |

  - **Different amortisation.** The arms differ in amortisation (build once vs rehearse every task), and the table says so.
    At N = 1 a build has nothing to amortise (MRR change 2c).
  - **A1 vs A0 is a different contrast**, a harness vs the raw official loop. It is reported in its own row and never
    paired with E8.

**OUT-1 ($0 new spend).** It uses the AB-v1 test run (its preregistration, its caps) and MA-0 (MRR plan, cap $40).
- **What F6 adds:** only the cross-bed reading. AB-v1 keeps its own frozen prediction and decision rules (§10 of that file).
- **Exploratory under AB-v1 §9.4.** The cross-bed reading of AB-v1's test rows is labelled exploratory under that
  section, unless it is recorded as a dated AB-v1 amendment before the harness-freeze addendum (§15 of that file). It is
  never a confirmatory result.
- **Prediction:** the outside effect is smaller than the in-generator one.
- **Refutation of the premise.** The premise is that the method is not tuned to our worlds. It is refuted if AB-v1 is "not
  supported" or "harm" while our beds show large effects. Then every in-generator effect is reported as an upper bound, and
  no program claims transfer.

**OUT-2 ($0; added after the critique): real recurrence and drift from BPI logs.** No model calls are made, and only
aggregates are committed.
- **Input.** BPI 2019 (purchase-to-pay, the domain of `abr-fin-apintake`), BPI 2017 (loan applications) and BPI 2012.
- **What it computes, per log:**
  - the variant-frequency curve: the share of cases covered by the top-k variants, and the singleton share;
  - for each variant, the arrival count over time, i.e. how many cases pass before r = 3 and r = 5 recurrences are reached;
  - the rate at which new variants appear per month, as a drift proxy.
- **What it compares.** The same quantities on the AB-R TRAIN families' practice streams 601–609 (trigger kinds per
  week, amendment rate) and on E8's generator.
- **Prediction.** Our generators have a lighter tail than real logs, with fewer one-off kinds. So EARN-1, run only on our
  streams, would overstate how much volume is earned.
- **Reading.** Two outputs:
  - the share of real volume that the earning rule v0 would ever promote, at r ∈ {3, 5};
  - whether AB-R's stream parameters fall inside the real range.
- **Refuted if** the AB-R streams' share of volume in their top kinds is within 10 points of BPI 2019's. Then the
  generators are not lighter-tailed on this measure.
- **Tool.** `experiments/outside/bpi-recur.mjs`. It reads XES with Node built-ins, or reuses the acquisition pass's
  `xes_stats.py`, run with `python3 -I` from outside the data directory.

**Second outside world ($0 acquisition, owner default yes).** Acquire WorkBench: a shallow, inert clone at a pinned SHA, with
URL, SHA, date, licence and outcome recorded.
- **Licence.** The repository licence is read at acquisition. The draft's "MIT" comes from our catalogue; arXiv lists the
  paper as CC BY 4.0.
- **What it is** [web]: a sandbox of five simulated databases and 690 tasks. The tasks are **instantiated from 69
  templates, 10 per template**, and each template has an outcome function that computes the expected end state.
- **An outside recurring bed.** Each template is a need signature that recurs ten times, and a third party wrote the
  world and the grader. This fills F6's missing item 3 (an outside recurring bed) for the recurrence half of F1, though
  not for carried state.
- **EARN-W** (proposed, preregistered after acquisition).
  - **Design.** A-agent, A-agentV, A-wf and A-earn on WorkBench template streams of 10, split by template into TRAIN and
    held-out before any run.
  - **Estimate:** about $15–20 on 15 TRAIN templates, cap $30 [arith: 150 tasks × ($0.02 + $0.03) for the two agent arms
    ≈ $7.5; A-wf 15 builds × $0.4–0.7 ≈ $6–10.5; A-earn at most about $2 of agent phase plus only the builds that
    failures earn].
  - **Which half of the rule it tests.** At N = 10 per template, cumulative agent cost (about $0.20–0.30) never reaches
    B̂. So only the failure condition can promote there.
  - **Status.** It is not in §11's totals until its preregistration.
- **Also** a second third-party world for LP-1.

**Real process.**
- **Owner tasks and the recurrence list** stay the real-user rung. If nothing arrives, the rung is reported missing.
- **BPI recurrence and drift statistics** run now (OUT-2). BPI *log-distance scoring of our worlds* waits for E1 and E9.
- **Recording any real business traffic** is an owner decision (credentials and personal data), never automatic.

### 6.5 Build items

| Item | Owner path (new) | Needed because |
|---|---|---|
| Origin field and back-fill | `experiments/claims/origin.mjs` | We design the specs, worlds and graders |
| Transfer table | `experiments/outside/transfer.mjs` | No cross-bed reading exists |
| BPI recurrence and drift statistics (OUT-2) | `experiments/outside/bpi-recur.mjs` | Real process data is available at $0 and tests the stream assumptions behind F1 and F7 |
| WorkBench acquisition record | `research/outside-20261015/ACQUISITION.md` | A second outside world, and the only outside recurring bed |
| Log-distance harness, deferred to E1 and E9 | not built now | Real-log realism; no experiment here needs it yet |

### 6.6 Schedule

| When | Step |
|---|---|
| 10-16 → 10-18 | OUT-0 |
| 10-19 → 10-21 | OUT-2 (BPI) |
| as each lands | the MA-0 (10-18 → 10-21) and AB-v1 rows enter the transfer table |
| after an owner yes (default yes), from 10-20 | WorkBench acquisition; then EARN-W's preregistration |

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
| WF-heal | detection from oracle-free signals (host refusals, `field-renamed`, an unknown enum, a new edition file) → an F3 typed request to a fresh Haiku builder (`repair.mjs` path, not the blocked heal kit). Its practice material is what an operator would have: forks of the live world at detection, the failing journals and any edition notice. A practice world *of the new edition* is allowed only if it is rebuilt through the FID pipeline and its cost is booked to `usd.upkeep` as mock upkeep | F7 | about $3–6, cap $10 (DRIFT-1a) |
| **WF-rebuild** | a B1L-H rebuild with the updated spec at each event. It also needs updated practice worlds, booked the same way | simple workflow baseline | DRIFT-1b |
| **Agent-adapt** | the better agent arm from AGENTV-E8 (agent-H, or agent-H + validator) per tick, reading the current spec and editions | the owner's comparison arm, at its strongest simple form | DRIFT-1b |

**Validity gate for the editions ($0, part of DRIFT-0; AGENTS.md: an invalid evaluator blocks claims).** Each blind edition
changes E8's reference semantics. So before DRIFT-1a runs, each edition must pass all of these:
- the updated reference policy scores 100% of completed cases on its epoch worlds;
- every bad, gaming and necessity control still fails;
- the oracle's mutation score on the edited transition is ≥ 0.95, which is E8's target (#59);
- generation is deterministic (two generations, identical hashes).

An edition that fails the gate is dropped and logged, not repaired after a solver has seen it.

DRIFT-1b (WF-rebuild plus agent-adapt) is about $21–25, cap $30 [arith: agent-adapt 6 epochs × about $1.5 × 2 seeds ≈ $18,
plus up to 20% for validator retries; rebuild 6 × about $0.5 ≈ $3].
- **Wall time.** Agent-adapt needs about 1.5 h per sized world, so 12 world-epochs take about 18 h sequentially. They run
  as parallel epochs inside the usage rule.
- **Rate limits.** A rate-limited epoch is an environment fault and is re-run, as in the E8 s12 run.

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
| Per-edition validity gate: reference at 100%, controls fail, oracle mutation score ≥ 0.95 on the edited transition, determinism | `experiments/drift/gate.mjs` | AGENTS.md: an invalid evaluator blocks claims; each edition rewrites reference semantics |

**Not built:** continuous diff against vendor systems (needs accounts), or BUMP (size).

### 7.6 Schedule

| When | Step | Notes |
|---|---|---|
| 10-20 → 10-24 | DRIFT-0, including the per-edition validity gate | no dependency on FID-0: the impact check uses pacts, not the diff harness |
| 10-24 → 10-27 | DRIFT-1a | WF-static is $0; WF-heal is about $3–6; only editions that passed the gate |
| 10-28 → 11-02 | DRIFT-1b | needs AGENTV-E8 to pick the agent arm |
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
same arms on the same triggers. Arms are interleaved by trigger at matched concurrency, and the concurrency of every row is
recorded, because stalls and concurrency confound wall time (DESIGN.md:193).
- **The quantities that can go either way.** "Code is faster than an LLM session per trigger" is near-certain by
  construction. So the prediction is about two quantities that are not:
  - **the crossover N\*_t:** the number of triggers after which a workflow's cumulative wall time, *including its build*
    (about 20 minutes) and any repair, falls below the agent arm's cumulative wall time;
  - **the reversal count:** the number of F-program comparisons whose winner by utility changes when latency enters at any
    λ_t in a declared grid. The grid is {$0.10, $1, $10} per hour of owner-waited compute time, the same three values as
    V. It is reported only; it is not the owner's λ_t.
- **Prediction:**
  - (a) N\*_t is between 10 and 40 triggers on AB-R at 1–2 minutes per agent trigger.
  - (b) At least one of the eight first experiments has a reversal at λ_t = $10/h.
  - (c) Per-trigger p50, p90 and p99 are reported for completeness, without a prediction.
- **Refuted if** N\*_t exceeds the history length (160) on every AB-R TRAIN family. Then on AB-R, speed does not favour
  building within a quarter, and speed claims are limited to tick-heavy beds like E8.

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

**Merged, not dropped (moved here by the critique):**

| Item | Where it lives |
|---|---|
| The skill creator (F2) | F3's typed request when the finder misses, plus F1's earned path, both admitted by execution. Measured as finder miss → admitted skill (§2.5). The first draft listed it under "Drop", but no evidence says it is unnecessary |
| Model-driven actors (F5) | MA-1 (MRR §5 row 13) and SPEC-1's truth-first owner simulator (§5.1) |
| J-Q2 (F2's screen) | Pulled forward from November to LP-0b |

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
| BPI log-distance scoring of our worlds (OUT-2's recurrence and drift statistics run now) | E1 and E9 being built |
| Shared S2 earn ledger, shared S3 broker, shared S5 manifest service | A second program's preregistration that needs them; until then, experiment-local code |
| Governor beyond FIX-1's sub-test | Repeat data across nodes from any bed |
| EARN-W (WorkBench template streams) in §11's totals | WorkBench acquisition and EARN-W's preregistration |
| Beds for the owner's own examples: MVP → CI/CD, OSS maintenance, rule-bound research programs | An owner process or recurrence list (decisions 10, 11). Candidate seeds: BUMP for OSS maintenance; this repository's own rule-bound research discipline, which is in-house and therefore never F6 evidence |
| Product schema changes (node `capabilities`, typed requests, journal timing) | The engine bump on or after 11-04 |
| Claim-bearing (sealed or held-out) versions of every first experiment | Each one's own preregistration after its development result |

---

## 10. One ordered roadmap

**Order rule [I].** $0 stages first. Within paid work, earlier is cheaper and more informative, and nothing blocks NL0–NL2b.
Dates are targets; their order is binding.

**Revised after the critique:**
- The strongest agent baseline (row 4) and the AB-R split now come before the experiments that depend on them.
- SPEC-0 no longer waits for MA-1.
- DRIFT-0 no longer waits for FID-0.
- Before the NL0 run, at most three F build streams run at once (§0.3). The MRR §5 rows 1–8 that prepare NL0 go first.

| # | When | ID | Program | What | Est. | Cap | Depends on | Decides |
|---|---|---|---|---|---|---|---|---|
| 1 | 10-15 → 10-17 | SPINE-0 | all | S1 claim row with the S6 timing fields; the meter on the §12 convention (reservation, timeouts at bound); origin field; S5 schema stub only | $0 | – | – | the fields every later row carries |
| 2 | 10-16 → 10-18 | LAT-0 + OUT-0 | F8, F6 | latency and origin back-filled from existing rows (marked `derived`); the matched-contrast transfer table skeleton | $0 | – | 1 | the first F8 table; the transfer table |
| 3 | 10-16 → 10-20 | EARN-0 | F1 | offline replay, including the JIT d4 deopt check; primitive detector (#65); guard recall | $0 | – | 1 | the frozen earning rule |
| 4 | 10-17 → 10-19 | AGENTV-E8 | F1 (the agent baseline for F3, F4 and F7) | agent-H + validator on E8 sized world 1232 d2 size 12 | $2–3 | $5 | the validator wrapper; 1 | whether E8's 14/14 vs 10/14 gap survives the strongest simple agent; which agent arm later rows use |
| 5 | 10-16 → 10-20 | FID-0 | F5 | differential harness, mutants, panel runner; validity gate ≥ 0.9 | $0 | – | 1 | whether FID-1 may run |
| — | 10-18/19 | NL0 stamp and run | (existing) | need-router matrix | – | – | – | none of rows 1–5 touches a stamped tree or an AB-v1 harness file |
| 6 | 10-18 → 10-21 | LP-0 | F2 | ingestion and strip rules; offline finder; J-Q2 material | $0 | – | – | the index for LP-1 |
| 7 | 10-19 → 10-21 | OUT-2 | F6 (for F1 and F7) | BPI recurrence and drift statistics against our generators | $0 | – | 1 | whether our streams are lighter-tailed than real logs |
| 8 | 10-19 → 10-23 | FIX-0 | F3 | mutants from E8's operators, labels by construction, classifier validity check | $0 | – | – | whether R-rule may run (agreement ≥ 0.9) |
| 9 | 10-19 → 10-23 | SPEC-0 | F4 | carriers, leak and coverage tests, the truth-first renderer, pre-rendered owner answers | $0 (renderer calls are billed in SPEC-1) | – | – | – |
| 10 | 10-20 → 10-21 | LP-0b (J-Q2) | F2 | screen composite against the regex | $0.10 | $1 | 6 | whether the screen may gate ingestion |
| 11 | 10-20 → 10-24 | DRIFT-0 | F7 | module schema, overlay, pacts, impact check, per-edition validity gate | $0 | – | 8 (request schema) | which editions may run |
| 12 | from 10-20 | WorkBench acquisition | F6, F1 | shallow, inert clone with an acquisition record | $0 | – | owner yes (default yes) | EARN-W's preregistration |
| 13 | 10-21 → 10-23 | FID-1 | F5 | auto vs hand-built on E8; same-verdict rate and leniency flips | $14–16 | $25 | 5; 8 optional (extra panel members) | whether auto mocks can carry promotion evidence |
| 14 | 10-22 → 10-24 | LP-1A | F2 | selection accuracy on a frozen query set; finder-miss count | $1–2 | $3 | 6, query author | finder vs all-tools |
| 15 | 10-23 → 10-26 | SPEC-1 | F4 | perfect vs derived vs derived + ledger vs no-spec agent, on shared cases | $8–10 | $20 | 9, 4 | the spec recovery ratio; the tracker as bridge |
| — | 10-24 | Need-router freeze | (existing) | analysis files frozen | – | – | – | F1 uses `router.mjs` read-only after it |
| 16 | 10-24 → 10-27 | DRIFT-1a | F7 | WF-static ($0) and WF-heal on gated blind editions | $3–6 | $10 | 11, 8 | silent failure; heal cost including mock upkeep |
| — | before row 18 | AB-R split | owner (§12 decision 9) | TRAIN / held-out for the AB-R families | – | – | – | which families EARN-1 may use |
| 17 | 10-26 → 10-29 | LP-1B | F2 | blast radius on AutomationBench dev-train via AB-H | $5 | $10 | 6, AB-H (MRR row 8), the $0 bridge check | whether app-level grants suffice |
| 18 | 10-27 → 10-31 | EARN-1 | F1, F8 | five policies on the AB-R TRAIN families, as chained 160-trigger histories; latency crossover N\*_t | $15–20 | $30 | 3, 4, the AB-R split, AB-R §3.11 gates, AB-R S2 rows, the verifier's rates, 1 | earned vs fixed structure; F8's speed reading |
| 19 | 10-27 → 10-30 | FIX-1 | F3 (and F2's creator) | inline vs request vs rule; rebuild read from existing rows; governor sub-test | $7–13 | $20 | 8, REC-1 Z2 (10-21), 4 | the routing rule; the creator's number |
| 20 | 10-28 → 11-02 | DRIFT-1b | F7 | WF-rebuild and agent-adapt arms | $21–25 | $30 | 16, 4 | the upkeep comparison |
| 21 | 10-30 → 11-03 | FID-2 | F5, F6 | auto mock vs AutomationBench's own implementation | $5 | $10 | 13 | fidelity against a reference we did not write |
| 22 | when AB-v1 test and MA-0 land | OUT-1 | F6 | the cross-bed reading; exploratory under AB-v1 §9.4 unless amended before its freeze addendum | $0 new | – | AB-v1, MA-0 | upper-bound labelling |
| 23 | ≥ 11-04 | E-bump items | F2, F3, F8 | node `capabilities`, typed request, journal timing; freeze record | $0 | – | the matrix ends (NL2b) | product support |
| 24 | November | sealed versions | all | each with a non-E8 bed: EARN-2 (AB-R held-out-near) and EARN-W (WorkBench templates); SPEC-2 and FIX-2 (sealed E-bed families, plus AutomationBench policy-class tasks for SPEC); FID-3 (OSS twin); DRIFT-2 (real history on AB-R and FID-2 mocks); LP-2 (WorkBench) | at their preregistrations | – | each one's development result plus owner decisions | claim-bearing numbers; none of them E8-only |

**Dependency chain:**

```
SPINE-0 → {LAT-0 + OUT-0, EARN-0, FID-0, AGENTV-E8, OUT-2}
AGENTV-E8 → {SPEC-1, FIX-1, DRIFT-1b, EARN-1}       (which agent arm is the baseline)
FID-0 → FID-1 → FID-2
FIX-0 → DRIFT-0 → DRIFT-1a → DRIFT-1b
FIX-0 → FIX-1 (after REC-1 Z2)
SPEC-0 → SPEC-1
LP-0 → LP-0b
LP-0 → LP-1A
LP-0 → LP-1B (after AB-H and the $0 bridge check)
EARN-0 + AB-R split + AB-R gates + AB-R S2 rows → EARN-1
WorkBench acquisition → EARN-W preregistration
AB-v1 + MA-0 → OUT-1
```

**Fit with the existing plan.**
- **Stamped trees.** No row edits a stamped tree or an AB-v1 harness file.
- **Development runs.** Rows 4 and 10–21 are development runs on dev seeds or dev-train, beside NL1, NL2, E2E and REC-1.
- **Usage.** The owner's weekly allowance, not money, is the binding limit (README "Cost ledger").
  - Rows 1–12 are code-heavy orchestration, and their usage weight is mostly subagent tokens. Before the NL0 run, at most
    three of them run at once.
  - Rows 13–21 are short paid runs.
  - D14 stays the owner's call.

---

## 11. Budget [arith]

**New spend in this plan:**

| Experiment | Est. | Cap |
|---|---|---|
| AGENTV-E8 | $2–3 | $5 |
| LP-0b (J-Q2) | $0.10 | $1 |
| EARN-1 | $15–20 | $30 |
| LP-1A | $1–2 | $3 |
| LP-1B | $5 | $10 |
| FIX-1 (the rebuild arm costs $0 new) | $7–13 | $20 |
| SPEC-1 | $8–10 | $20 |
| FID-1 | $14–16 | $25 |
| FID-2 | $5 | $10 |
| DRIFT-1a | $3–6 | $10 |
| DRIFT-1b | $21–25 | $30 |
| **Total** | **about $81–106** | **$164** |

- **Not included:** EARN-W (about $15–20, cap $30), until its preregistration.
- **F6 and F8 add $0.**
- **Metering.** Every row is metered by the §12 convention: reservations, and timeouts charged at their bound. A row with
  timeouts can therefore reach its cap well above its estimate, as M1 did ($62.92 metered against a $10 estimate).

**Existing commitments.** The soft cap is checked on the cap basis, as the need router's own check does
(PREREG-NEED-V1 "Committed spend, not caps"):

| Commitment | Estimate basis | Cap basis (governs the soft cap) | Source |
|---|---|---|---|
| Need router, with M1 on its meter, M1-R and DRIFT | about $990 (estUsd $966 plus M1-R's metered $25.89) | $1,372.81 | `stages.json totals` (`estUsd`, `softCapCheckUsd`) |
| MRR plan, other rows (M1-R is counted above) | about $298 | about $425 | MRR §5 ($310 / $450, less M1-R) |
| AB-v1 | at most $100 | $100 ($60 dev + $40 test) | its preregistration §5, §14.1 |
| AB-R | about $450–550 | no stage caps set (each stage ≤ $200); the estimate is used | RECURRING-DESIGN §3.12 |
| **Total before this plan** | **about $1,840–1,940** | **about $2,350–2,450** | |
| **With this plan** | **about $1,920–2,045** | **about $2,510–2,610** | |

The first draft gave "about $1,860" and "about $1,950" from older need-router totals ($951, caps $1,235). It did not give
the cap basis, which is the one the existing check uses.

**On the cap basis, the need router and the MRR plan alone (about $1,800) already exceed the $1,500 soft cap.** No paid F
row fits under it without cutting an existing commitment or raising the cap. Every single experiment stays under the $500
pause.

**If the soft cap binds, drop these first** (the least information lost per dollar saved):
1. FID-1's Opus architect variant: −$12.
2. DRIFT-1b's agent-adapt on one seed instead of two: −$9–12.
3. EARN-1 on two chained weekly streams per family instead of four: about −$7. The MDE rises, and so does the late-build
   horizon problem (§1.3).

Beyond that, the MRR drop list applies (REC-1 main on two jobs, −$110), then the AB-R stage sizes, which are the owner's
call.

---

## 12. Owner decisions (each has a default)

| # | Question | Default |
|---|---|---|
| 1 | On the cap basis the soft cap is already exceeded by existing plans (§11) | Recommend: raise the soft cap to $2,700 (cap basis), or cut the AB-R S3/S4 stage sizes. **Until you answer:** every $0 stage runs. Of the paid F rows, only AGENTV-E8 and LP-0b run ($6 at caps together), because their results reshape the larger rows; they are recorded as a soft-cap deviation. Every other paid F row waits for your answer |
| 2 | A latency value λ_t for utility | None: latency is reported beside utility, never inside it; LAT-1's reversal count uses a reporting grid only |
| 3 | A real process of yours for F6 (and the F1 owner examples): owner tasks, the recurrence list, or recorded traffic | No recording. Owner tasks and the recurrence list as already requested (decisions 10, 11); the rung is reported missing if none arrive. BPI statistics (OUT-2) run meanwhile on public logs |
| 4 | Real systems for F5's M3 tier | OSS twins within D5, after FID-1. No vendor accounts |
| 5 | Acquire WorkBench (local, no credentials; its licence is checked at acquisition) as a second outside world and the only outside recurring bed | Yes: a shallow, inert clone with an acquisition record; then EARN-W's preregistration |
| 6 | LP-1B plants injection texts in AutomationBench worlds; they may reach only the host-run loop (MRR F13) | Yes, AB-H only, through a world pre-processor, never a `bridge.py` edit |
| 7 | Who writes LP-1A's frozen query set | A decision-11 far-family author; otherwise you |
| 8 | The heal-kit `HEAL_POLICY_DRIFT` choice (README) | Unchanged. F3 and F7 do not depend on it: they use the `repair.mjs` path |
| 9 | The AB-R TRAIN/held-out split (RECURRING-DESIGN §3.13 item 4), now needed **before** EARN-1 | The split the family headings already propose: TRAIN = dealdesk, reviews, slawatch, routing, receipts, referral; held-out near = noshow, suppression, mailroom, gdpr, apintake, hr-inbox. EARN-1 uses TRAIN only |

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

**Looked up during the critique, 2026-10-15 [web]:**
- Styles et al., *WorkBench: a Benchmark Dataset for Agents in a Realistic Workplace Setting*:
  https://arxiv.org/abs/2405.00823 and https://arxiv.org/html/2405.00823.
  - What the HTML version says: 69 templates, 10 tasks each (690 tasks); an outcome function per template; five simulated
    databases (calendar, email, website analytics, CRM, project management); 21 multi-domain templates.
  - The page lists the paper under CC BY 4.0. The code repository's licence was not checked.
  - Only the first author's surname is given, because the full author list was not read from the page.
- The ski-rental problem: https://en.wikipedia.org/wiki/Ski_rental_problem. It gives the deterministic break-even rule as
  2-competitive and optimal among deterministic rules, and randomised rules as e/(e−1)-competitive.
- Karlin, Manasse, Rudolph, Sleator, *Competitive snoopy caching*, Algorithmica, 1988. This is a citation entry seen in
  search results only; the paper was not opened.

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

**Checked during the critique (2026-10-15, HEAD `57cebba`):**
- `research/need-router-20261014/prereg/stages.json` `totals` (estUsd 966, capUsd 1,275, committedUsd 1,322.92,
  softCapCheckUsd 1,372.81), `engineStamp`, and the `e8` job (split `forced`, modes `[]`, read at M1e)
- `research/need-router-20261014/PREREG-NEED-V1.md:936,950,962-970` (M1 on the §12 meter; the cap-basis soft-cap check)
- `research/need-router-20261014/DESIGN.md:185` (the utility formula, with r/(N·V)), `:188-193`, `:253-257`
- `research/need-router-20261014/DECISIONS-ADOPTED.md` decisions 7, 10, 11 and 12
- `research/automationbench-20261014/RECURRING-DESIGN.md` §2 (owner summary), §3.8–§3.13 and the §4 family headings
  (TRAIN vs held-out near)
- `research/automationbench-20261014/PREREG-AB-v1.md` §1.1–§1.3, §5, §7, AM-5 to AM-8
- `research/automationbench-20261014/NOTES.md` §2–§4 (`meta.allowed_services`, the 401 outside it)
- `research/automationbench-20261014/runs/a1-dev-first6/summary.json`
- `experiments/autobench/bridge.py:557-600,686-703,1052-1100` (`prepare`, `serve --world`, `--expect-contract`)
- `experiments/autobench/harness/foundry.mjs:121-209` (the A1 manifest includes `bridge.py` and `tool.mjs`)
- `research/enterprise-20261014/B1-E8-DEV.md` (build costs $0.39, $0.62 and $0.53; B1N $1.70; agent-H s12)
- `research/enterprise-20261014/runs/regrade-oracle2-*/result.json` (1,022/1,022 for B1L-H lineage 1 and both B1N
  lineages under the revised oracle)
- `beds/ebed/e8/defects.mjs:1-60`, `beds/ebed/e8/actors.mjs:1-12`, `beds/ebed/e8/tools/` (`mutate.mjs` is on disk but not
  in `git ls-files`)
- `research/jit-20261008/runs/jit-dev-records-1/` (rows present), `docs/RESEARCH.md:117-120`
- `research/enterprise-20261014/ACQUISITIONS.json` `data[]`
- `/var/tmp/foundry-work/enterprise-src/_data/` (BPI 2012, 2017, 2019 and 2020 present) and
  `/var/tmp/foundry-work/enterprise-src/_metrics/bpi2019.stats.txt` (local, outside the repository)
- `research/architecture-20261014/MEMORY-ROUTING-RECURSION.md` §3.3, §4 and §5
- `docs/ROADMAP.md` §6 rules 5, 12 and 13

**Not verified by me:**
- every [S] and [doc] item;
- the AB-R per-family costs;
- whether the E-bed host can take an injected systems map without an edit (FID-1 notes the fallback);
- whether `bridge.py serve --world` keeps a widened `meta.allowed_services`, and whether a planted record changes the
  task contract hash (LP-1B's $0 check);
- the four ClawsBench bug classes the sweep does not name;
- WorkBench's code licence.

---

## Critique log (2026-10-15)

**What happened.** An adversarial critic read this file the day it was written, checked its claims against the
repository at HEAD `57cebba`, and then revised it in place. The critique looked for:
- unnecessary complexity;
- unfalsifiable or unmeasurable claims;
- weak or missing baselines;
- leakage and tuning on test;
- cost underestimates;
- conflicts with the NL0 freeze and the preregistrations;
- duplicated work;
- omissions against OWNER-DECISIONS F1–F8;
- ordering mistakes.

**Cost of the critique.** $0 in model calls. Two web lookups were made (WorkBench, ski rental). No code was changed and
nothing was committed.

**Tally.** Thirty-six points: 30 accepted and applied, 6 rejected.

**How to read the table.** "Where" names the section the change landed in. Evidence tags are as in the header.

### Accepted

| # | Category | Point | Evidence | Change (where) |
|---|---|---|---|---|
| 1 | Leakage, ordering | EARN-1 ran on all six built AB-R families. Three of them (noshow, suppression, mailroom) are "held-out near", and their dev streams are for "harness rehearsal only". EARN-2 was then planned on held-out families after EARN-1 had used them, and the split was scheduled *after* EARN-1 | [doc RECURRING-DESIGN §4 headings, §3.9, §3.13 item 4] | EARN-1 uses TRAIN families only. The split is fixed before EARN-1 and added as §12 decision 9; held-out-near families are reserved for EARN-2 (§1.2, §1.5, §1.7, §10, §12) |
| 2 | Unmeasurable | Prediction and refutation thresholds (0.03 and 0.05 utility; 1, 3 and 5 points; 10 points of recall) sit below what K = 1 or 2 on 3–6 clusters can resolve. EARN-1's MDE is about 0.11–0.16 [arith]. In LP-1B one task is 3.3 points | [arith; code `subset60/summary.json`] | A global MDE rule and a three-way reading (§0.3, owner summary). Per-experiment resolution notes and max(threshold, MDE) refutations (§1.5, §2.4, §4.4) |
| 3 | Weak baseline | The strongest simple baseline on the only bed with a measured workflow advantage was never scheduled there: agent-H with a validator, which B1-E8-DEV names as unrun. 25 of 27 agent errors are one misreading that a refusal shown back would expose. DRIFT-1b and SPEC-1 used plain agent-H | [doc B1-E8-DEV] | New row AGENTV-E8 ($2–3, cap $5), run first. DRIFT-1b's and SPEC-1's agent arms use the better of the two (§1.5, §4.4, §7.4, §10) |
| 4 | Baseline bias, cost | The workflow arms get practice worlds (mocks) for free, which is F5's own point, while B̂ counts only the build session. And B̂ = $0.60 was called "the B1L-H mean", which is $0.51 | [doc B1-E8-DEV; OWNER-DECISIONS F5] | B̂ = $0.57 (B1N-H per lineage, with repair). EARN-1 reports the break-even world cost W\* and has a refutation on it (§1.3, §1.5) |
| 5 | Unfalsifiable as written | The cost condition is the ski-rental break-even rule. At about $0.02 per trigger it fires near trigger 30, so prediction (b) "never builds on agent-fine families" contradicted the rule's own arithmetic, and on a single 40-trigger stream a late build is pure loss. The utility also dropped the need router's routing term r/(N·V) | [doc RECURRING-DESIGN §3.12; DESIGN.md:185; web ski rental] | Histories are chained to 160 triggers (N = AB-R's headline). Prediction (b) now names the build point. The r term is restored, and the ski-rental prior art and its guarantee are cited (§1.3, §1.4, §1.5) |
| 6 | Owner omission | F1 lists recurrence both as a day-one primitive and as an earning signal; the draft silently chose one reading. "Needs change over time" (demotion) was never predicted | [doc OWNER-DECISIONS F1] | The reading is stated, and A-wf is named as the literal reading. A deopt check is added to EARN-0 (JIT d4), and prediction (f) on the AB-R d3 amendments (§1.3, §1.5) |
| 7 | Leakage | A-agentV's verifier ledger was to be "confirmed by the family author acting as owner", but the family author wrote the oracle and the truth | [doc RECURRING-DESIGN §3.11 gate 6] | The checks are written by the second reader, who never imports oracle or truth code (a test asserts this). They are hand-written, not tracker v1 properties (MRR 4d). The false-rejection rate is also measured (§1.5) |
| 8 | Measurement validity | Under the official runner, `meta.allowed_services` already returns 401 outside the task's apps, so the official setting *is* G-oracle, and G-all requires changing a world. Clean-pass thresholds of 1–3 points on 30 tasks are unresolvable | [doc NOTES §4; code `bridge.py:557-600,686-703`] | G-all comes from a world pre-processor. A $0 bridge check comes first. The clean comparison is read on paired partial credit (§2.4) |
| 9 | Prereg conflict | The draft's freeze rules named only the NL0 stamp. AB-v1 §7 makes `bridge.py`, `tool.mjs`, `lib.mjs`, `run.mjs` and their imports harness files, and a change during the test run invalidates A1. LP-1B, FID-2 and DRIFT-2 touch AutomationBench | [doc PREREG-AB-v1 §1.3, §5, §7, AM-8; code `harness/foundry.mjs:165-166`] | A new AB-v1 freeze rule: wrappers only, `assertDevOnly()`, F transcripts included in AM-8's rescan, and F spend kept off AB-v1's $60 dev budget (§0.3, §2.4, §5.5) |
| 10 | Owner omission | The owner asked for a skill *finder and creator*. The draft put the creator under "Drop: the evidence says it is unnecessary", but no evidence says so. The screen ("screened before any node can load them") had no capability number until a November J-Q2 | [doc OWNER-DECISIONS F2; J-Q REPORT "Next"] | The creator is merged and measured (finder miss → admitted skill, in LP-1A and FIX-1). J-Q2 is pulled forward as LP-0b (§2.4, §2.5, §9) |
| 11 | Owner omission, rule conflict | F5 includes "model-driven actors", and the draft had no actor experiment, though MA-1 is exactly that. SPEC-1's owner simulator generated answers at run time, which MRR §3.3 rule 3 ("recorded, never regenerated") and §4 ("actor text regenerated at run time": do not build) forbid | [doc MRR §3.3, §4, §5 row 13] | F5's actor half = MA-1, with S1 rows and its renderer cost booked. The owner simulator is truth-first: typed matching to intent records, pre-rendered answers, byte-identical replay (§4.4, §5.1) |
| 12 | Ordering | SPEC-0 (10-18 → 10-22) depended on "MA-1 T0 (shared code)", but T0 waits for #54 admission and MA-1 runs 10-21 → 10-28 | [doc MRR §5 rows 10, 13] | SPEC-0 owns the renderer, and MA-1 may import it (§4.4, §4.6, §10) |
| 13 | Comparability, unfalsifiable | S-none-agent was scored on 14 sized cases and the build arms on 1,022 full-world cases, so "beats an agent with no spec" compared different case sets. "Recovers a measured fraction" cannot be false. There was no refutation if deriving is worse than no spec | [doc B1-E8-DEV] | One common 14-case set for all arms. The claim is reworded (ratio measured, two claims made), and a third refutation is added (§4.1, §4.4) |
| 14 | Duplication, circularity | FIX-0's mutant generator duplicated E8's latent-defect miner and operator set. `request.mjs` would have been a third request format beside `subflow` and `repair.mjs`. The labels came from the same classifier R-rule routes with. The detection evidence was unspecified. And a rebuild never sees the defect, so it needs no new runs | [code `beds/ebed/e8/defects.mjs`, `beds/ebed/e8/tools/mutate.mjs`, `experiments/rec/subflow.mjs`; doc B1-E8-DEV] | Reuse the operators. Labels by construction, with a classifier agreement gate ≥ 0.9. Identical oracle-free detection evidence for every arm. R-request goes through `subflow` child mode. Rebuild is read from the three existing lineages at $0 (§3.4, §3.5) |
| 15 | Duplication | FIX-1 asks REC-1 main's `child`-vs-`inline` question on another axis, and runs after REC-1 main starts | [doc MRR §5 row 14] | FIX-1 does not alter REC-1 main. It feeds the bump's request schema and any REC-2 (§3.6) |
| 16 | Baseline bias | WF-heal got "practice worlds of the new edition": a free updated mock, which an operator facing unannounced drift does not have | [doc OWNER-DECISIONS F5, F7] | WF-heal practises on live-world forks, failing journals and notices. Any new-edition mock goes through FID and is booked as `usd.upkeep`, as are WF-rebuild's (§7.4) |
| 17 | Invalid evaluator risk, ordering | Each blind edition rewrites E8's reference semantics, and there was no gate on the edited oracle. DRIFT-0's dependency on FID-0 was spurious (the impact check uses pacts) | [AGENTS.md; doc E8 mutation target #59] | A per-edition validity gate (reference 100%, controls fail, mutation ≥ 0.95, determinism) and `gate.mjs`. The dependency is dropped (§7.4, §7.5, §7.6, §10) |
| 18 | Unmeasurable, mismatched | The transfer table paired different contrasts: E8 workflow vs agent beside AutomationBench A1 vs A0. F6 had no capability number | [doc B1-E8-DEV; MRR §3.3] | One matched contrast, *practise in a mock vs act cold*, across three origins. A1 vs A0 gets its own row. F6's number is defined (§6.1, §6.4) |
| 19 | Owner omission | F6 names BPI logs, but the draft deferred all BPI use to E1/E9 and did not check whether the files survive. They do. The local BPI 2019 measurement already shows a heavy head and long tail: 7 variants cover 50% and 45 cover 80% of 251,734 cases; 9,030 variants occur once | [doc ACQUISITIONS.json; local `_metrics/bpi2019.stats.txt`] | OUT-2 ($0): real recurrence and drift statistics against our generators, with a prediction and a refutation (§6.2, §6.4, §10) |
| 20 | Owner omission | F6 lists "an outside recurring bed" as missing, and the draft offered none. WorkBench's 690 tasks are 69 templates × 10, each with an outcome function: recurrence with an outside world and grader | [web arXiv 2405.00823 HTML] | WorkBench acquisition moved earlier, and EARN-W proposed (prereg after acquisition, not in totals). The licence is checked at acquisition (§6.4, §9, §12) |
| 21 | Prereg conflict | OUT-1 added a new prediction to be read on AB-v1's frozen test run | [doc PREREG-AB-v1 §9.4, §15] | Labelled exploratory under §9.4, unless amended before the freeze addendum (§6.4, §10) |
| 22 | Tautology | F8's predictions (workflow p50 ≥ 10× faster; agent < earn < workflow time to first correct) are near-certain by construction, and its refutation (agent p90 ≤ 2× workflow) is near-impossible. Concurrency was uncontrolled | [doc DESIGN.md:193] | Replaced by the crossover N\*_t (build time included) and a reversal count over a reporting λ_t grid. Arms are interleaved at matched concurrency (§8.4) |
| 23 | Prereg conflict | "A row without S1 fields is diagnostic only" would have demoted the preregistered NL and AB-v1 results, whose frozen runners cannot emit S1 | [code `stages.json engineStamp`; doc PREREG-AB-v1 §7] | The rule binds F tables only. Preregistered results keep their own rules, and the back-fill is marked `derived` (§0.1) |
| 24 | Complexity | Six shared records and about 35 modules before any program showed need. This conflicts with ROADMAP §6 rules 5 and 12 and MRR §4 condition 3: e.g. a governor justified by "no repeat data exists", a shared S2 and S3 with one consumer each, an M4 tier, a log-distance harness | [doc ROADMAP §6; MRR §4] | Only S1 (with the S6 fields) is shared now. S2, S3 and S5 stay experiment-local until a second prereg needs them. The governor is minimal. M4 and log-distance are not built, and each $0 stage commits its PREDICTION.md first (§0.1, §3.4, §5.4, §6.5, §9) |
| 25 | Cost underestimate | §11 used stale need-router totals ($951, caps $1,235; now $966, $1,275, committed $1,322.92, soft-cap check $1,372.81) and only the estimate basis, while the existing check uses the cap basis. On that basis, need router + MRR ≈ $1,800 is over the soft cap before AB-v1, AB-R or F. M1 shows $62.92 on the §12 meter against a $10 estimate. The draft's default ran paid rows past the soft cap without the owner | [code `stages.json totals`; doc PREREG-NEED-V1:936-970] | Both bases restated: about $2,510–2,610 cap basis with this plan. F rows are metered on the §12 convention. The default now holds paid F rows for §12 decision 1, except AGENTV-E8 and LP-0b ($6 at the caps) (owner summary, §0.3, §11, §12) |
| 26 | Ordering, usage | Nine $0 build streams were scheduled concurrently 10-15 → 10-22, on top of P0, MEM-0, Z0/Z1, AB-H, the NL0 stamp, MA-0, AB-v1 dev and AB-R building. Usage is the binding limit, and a session already ended on it (10-09) | [doc README status, "Cost ledger"] | At most three F streams before the NL0 run, with MRR rows 1–8 first. LP-0, FIX-0, SPEC-0 and DRIFT-0 move after NL0 (§0.3, §10) |
| 27 | Monoculture, regression | Five first experiments rest on E8 worlds 1232–1234 (one generator, three seeds). F programs edit the E8 bed (an injected systems map, the drift overlay) that M1e and the forced stratum read | [code `stages.json` job `e8`] | No E8-only claim-bearing run, and §10 row 24 names a non-E8 bed for each. A byte-identical regrade test accompanies every E8 bed edit (§0.3, §10) |
| 28 | Leakage | LP-1A's fallback queries ("Example request" lines) live inside the skill bodies the finder indexes | [doc KDENSE-SKILLS §6.4] | They are stripped from the index when used (§2.4) |
| 29 | Measurement validity | SRCC on the E8 panel is unstable or undefined: the good solvers sit at 95–100% and the controls near 0, and a fail-everything mock gives a constant vector. "Docs-only" with a probe loop was ambiguous about touching the reference | [doc B1-E8-DEV] | The primary metric is now the same-verdict rate and leniency flips. SRCC is secondary, with mid-ranks, and only with ≥ 4 distinct pass rates. The docs-only arm never calls the reference (§5.5) |
| 30 | Stale state, duplication | The draft was written at `58cc47a`. HEAD `57cebba` adds A1's first paid dev run: a ledger collected 6/6, yet 0/6 strict. A pending task #67 (A2 harness) overlaps tracker v2 and EARN's verifier | [code `runs/a1-dev-first6/summary.json`; task list] | Header updated. The A1 data point and the coordination note are added to F4 (§4.4) |

### Rejected

| # | Point | Reason |
|---|---|---|
| R1 | Cut FID-1's Opus "architect" variant now, to save $12 | It is already first on the cut list (§11). Whether to cut is the owner's budget decision, and the variant is the only frontier-vs-cheap contrast for mock building |
| R2 | Put primitive-bearing tasks into the frozen need set, as task #65's wording says | That is an amendment to a preregistered stage (OWNER-DECISIONS: "Any change to a preregistered stage goes through a recorded amendment"). A separate set gives the same evidence without touching NL0–NL2 |
| R3 | Merge FIX-1 into REC-1 main | REC-1 main is designed, gated by Z2 and capped at $300 (MRR §5 row 14). Re-scoping it now churns a gated plan. FIX-1 stays a separate $7–13 development run that feeds the bump and any REC-2 (accepted point 15 handles the overlap) |
| R4 | Drop DRIFT-1b, the largest single cost | The owner's F7 asks for exactly this comparison: workflows that heal against agents that adapt. It is reduced to one seed only if the soft cap binds (§11 item 2) |
| R5 | Replace the earning rule's fixed thresholds with a bandit or learned threshold | There is no volume yet. MRR §4 lists "bandits before there is volume" as not to build, and the ski-rental rule already carries a worst-case guarantee under its stated assumption |
| R6 | Remove the requirement ledger (S4) from the verifier path, because the tracker "is not yet usable as a verdict" | The claim is right about tracker v1's auto-extracted properties (MRR change 4d), but EARN's verifier never used them. It runs hand-written checks by the second reader, gated by a measured miss rate. The text now says so (accepted point 7); S4 stays |
