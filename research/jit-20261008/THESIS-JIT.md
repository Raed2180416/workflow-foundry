# What we were missing: Foundry as a JIT compiler for agent work

*2026-10-08, main session. The owner asked for a deep re-evaluation against the full end-to-end vision, an
honest account of why progress felt stalled, and a plan that fits about 3 days at agent speed. The owner approved
acting without asking ("you have complete perms, don't ask me anything"). Tags: **[M]** measured in this repo
(file cited); **[I]** my inference. Nothing here is a claim from a sealed round. Every number below is dev or
diagnostic evidence.*

## 1. The evidence we already have, read together

| fact | source |
|---|---|
| A good workflow makes Haiku 5.5 excellent and cheap: hand-written workflow, Haiku nodes **35/36 at $0.016/trial**; Haiku agent 29/36 at $0.111; one Sonnet call 28/36 at $0.247 | [M] research/core-20261006/REPORT.md, key numbers |
| Haiku can *build* a working solver when it writes **code**: B1-haiku (Haiku → `solve.mjs`) **16/16**; F-haiku (Haiku → `workflow.json`) 11/16 | [M] research/construction-20261006/REPORT-dev.md |
| Constructed solvers cost **~5×** the hand workflow to execute (B1-haiku $0.078/trial vs fhand-haiku $0.016) | [M] same two reports; different seeds and difficulty mix, so only indicative [I] |
| **Probes did not predict evaluation**: all 8 constructions passed 24/24 probes, and every one of the 9 construction-defect failures came from a case no probe contained | [M] REPORT-dev.md |
| **The F run verdict was uninformative**: `pass` on 32/32 F trials, including all 5 oracle failures. Acceptance was only `exists` | [M] REPORT-dev.md |
| B1 builders had **oracle-scored probes** (12 score checks); in the wild nobody has an oracle | [M] experiments/c0/construct.mjs `scoreChecks` |
| Auto-heal live runs on IR artifacts produced no promoted fix so far | [M] research/heal-20261008/runs/H-*.json (`promote: false`); review in progress |

## 2. What we were missing (ideologically)

### 2.1 We treated a workflow as an artifact you *author*. It is a cache of work you have *already done*.
Every construction arm in C0 tried to write a workflow from a description and three probes, before any real task had been
solved. That is why "probes did not predict evaluation": the author must imagine every case. The alternative is
the oldest idea in language runtimes:
- **interpret first** (an agent solves the task with tools);
- **profile** (the trace shows what actually happened: the scripts the agent wrote, the judgments it made, the
  shapes it met);
- **compile the hot path** to cheap code;
- **guard** every assumption the compiled code makes;
- **deoptimise** back to the interpreter when a guard fails;
- **recompile** with the new trace.

Construction stops being an act of foresight and becomes **distillation of evidence**. A cheap model is good at
distillation, because the trace already holds the answer and the procedure, and it is bad at foresight (F-haiku 11/16) [I].

### 2.2 The authoring surface should be code. The typed IR is what you *observe*, not what you *write*.
Models are trained on code; a nine-kind JSON IR is a foreign language they must also get right. Our own data says so:
B1-haiku 16/16 vs F-haiku 11/16 [M]. The IR is still valuable as:
- a **declared manifest** (effects, budgets, model tiers, guards) that policy checks before a run;
- an **observed trace** (steps, judgments, escalations, costs) that the UI, the journal, replay and the auditor use.

The JIT SDK (`flow.step`, `flow.judge`, `flow.guard`, `flow.invariant`, `flow.map`, `flow.done`) emits exactly that
trace. So the IR's guarantees stay, and the authoring tax goes. Adapters still reject unsupported semantics; the
journal is still the ground truth [I].

### 2.3 Verification is the binding constraint, and we can get an oracle we did not know we had.
The failures that matter are silent wrong answers (F's verdict said pass on 5 oracle failures [M]). In the wild there is no
bed oracle. But a JIT has a **reference implementation of every task: the interpreter**. Three cheap checks need no
human and no hidden truth:
1. **Differential (shadow) testing**: on a deterministic sample of compiled runs, also run the interpreter and
   compare. A disagreement goes to a second interpretation, and the majority wins. A wrong compiled answer becomes a
   regression case. This is how JITs are validated against their interpreters.
2. **Mined invariants**: properties every trace satisfied become `flow.invariant` self-checks, for example
   conservation (rows in = merged + dropped), round-trips, enumerations, counts and idempotence. They catch silent errors at $0.
3. **Judge checks**: every model judgment carries a code check, such as a quote that must occur in the source or an enum
   that must be consistent with other fields. A failed check escalates the judgment.

The bed oracle is then only the *experimenter's* scorer, never the system's [I].

### 2.4 We measured the wrong unit. A workflow's value is amortisation over a stream.
Single-task K=3 comparisons charge construction to one task and cannot show the shape that matters:
- cost per task falling as the stream compiles;
- reliability holding as it deopts on novelty;
- recovery after drift.

The unit should be a **stream of recurring tasks**. The metrics should be:
- cumulative cost;
- cumulative successes;
- steady-state cost and success over the second half;
- the **break-even index** against "agent every time";
- behaviour after a distribution shift (a difficulty change mid-stream) [I].

### 2.5 Heal is not a separate subsystem. It is recompile-with-a-regression-suite.
The current heal pipeline (incidents, localisation, proposals, pinned gates, lint debt) is elaborate machinery operating on IR
artifacts [M: H-*.json schema]. In a JIT, heal is test-driven:
1. a failing case (deopt or shadow disagreement) joins the regression set;
2. the compiler patches the code until old and new cases pass;
3. a version that does worse on old cases is rejected.

That is the whole loop. "Figure out what's missing and make it so it doesn't run into that issue" (owner) is
exactly a deopt plus a recompile [I].

### 2.6 Tiering is the model ladder, and the router is the compile decision.

| tier | runs | becomes the default when |
|---|---|---|
| T0 interpreter | frontier or Haiku agent with tools | the task shape is novel |
| T1 compiled code + Haiku/Sonnet judges | `solve.mjs` on `flow.mjs` | traces exist, and guards and shadows hold |
| T2 compiled code + distilled judges | a judge moved down to Kev or a rule | the judge's agreement with T1 on the stream's own traces is ≥ threshold (existing successive-halving distiller, experiments/lib/distill.mjs) |
| T3 pure code | the judgment is constant | the judge's answer never varied across traces |

**Kev is trained on judgments the stream actually needed**, harvested from `trace.jsonl`, not on synthetic
factories alone. The **router** decides per request: interpret, run compiled, or compile now. Its inputs are:
- the recurrence of the task shape;
- the compile cost against the expected remaining stream;
- the guard and shadow record;
- the owner's cost/reliability slider (the shadow rate *is* the slider) [I].

### 2.7 What this changes in the e2e vision

| vision part | before | now |
|---|---|---|
| construction | author IR from a description | distil traces into code; Haiku compiles, Opus is the fallback |
| execution | engine runs IR | sandboxed code on `flow.mjs`; the engine's journal, replay and budget guarantees carry over via the gateway |
| verification | acceptance contracts per workflow | guards + mined invariants + judge checks + sampled shadow/differential |
| heal | incident pipeline | deopt → trace → recompile; reject-if-worse |
| reuse (C2) | template library | compiled solvers keyed by task shape; the router chooses |
| Kev (C3) | synthetic judge programs | distil hot judges from stream traces, measured against T1 |
| UI | runs and history | plus a stream view: versions, deopts, shadows, cost curve |
| evaluation | K=3 single tasks | preregistered streams with drift; break-even and steady state |

Kept, unchanged: model ids from policy only; the journal; budgets; sealed held-out discipline; no oracle access for
any system component; adapters reject what they cannot represent.

## 3. Why it felt stalled (honest)
1. **Throughput went to measurement infrastructure, not the capability loop.** In the last ~24 h most agent
   time went to:
   - bed audits;
   - the Kev data factory (synthetic judge data, groups each built and then adversarially reviewed);
   - heal pipeline machinery;
   - review-of-review cycles.

   Each piece was rigorous. None of it moved the headline number [I].
2. **Two owner-requested pauses and their resumes**, each costing restart and cache rebuild time [M: session log].
3. **A 4-vCPU VM**: parallel test suites from several workflows saturate it. As this is written, six node test processes and a
   heal trial run at once [M: ps].
4. **Serial gates**: frozen-kit discipline meant waiting on engine stage-1 before touching `src/` [M].
5. **Calendar-shaped plans.** `11-NEXT.md` scheduled weeks of milestones at a human-team cadence. At agent speed,
   the honest unit is hours per build and hours per stream run. The bottleneck is model wall-clock and CPU, not
   people [I].

Correction applied from now on:
- build in `experiments/` against frozen interfaces;
- run builders in parallel;
- one capability number per day;
- review after a number exists, not before.

## 4. The 3-day plan (started 2026-10-08 23:10 UTC)

**Day 1 (by 2026-10-09 23:00 UTC): the loop exists and has run once.**
- Build `experiments/jit/`, following [SPEC.md](SPEC.md). Two parallel builders:
  - `flow.mjs`, check-traces, compile;
  - interpret, run-compiled, stream, report.

  Tests at $0.
- Live smokes: one interpretation, one compiled run.
- Dev stream `dev-records-1`: records, dev seeds 201–216 at d3 then 217–224 at d4 (drift). Four arms:
  - Haiku agent;
  - Sonnet agent;
  - the static C0 B1-haiku solver;
  - JIT Haiku/Haiku.

  Report the cost and success curves (development evidence).
- Engine stage-1 and heal review finish in the background. They are not on the critical path.

**Day 2: does it generalise, and does it hold on held-out work?**
- Fix what the dev stream shows. Add a second family with headroom (codefix at d4–d5 or incident) and one R-bench
  replication item.
- Write `PREREG-stream.md`:
  - frozen config, seeds (test split ≥ 7001, never inspected), budgets and arms;
  - kill rules;
  - primary metric: cumulative successes and $/success over 24 tasks;
  - secondary: steady-state second half, break-even index, recovery after drift;
  - K=2 streams per arm and family, with gaps under 3 points called noise.
- Run it.

**Day 3: tier down, route, show it.**
- Harvest `flow.judge` calls from the stream traces. Try each hot judge on cheaper tiers with the existing distiller
  (Haiku → Haiku without thinking → Kev on the laptop bridge), promoting only at ≥ threshold agreement with re-scoring
  end to end.
- Router v0 (interpret / run compiled / compile now) with the shadow-rate slider.
- run-view stream page:
  - version timeline;
  - deopts and shadows;
  - cumulative cost curve.
- Write the report, preserving every negative result.

**Kill and pivot rules.**
- If the JIT arm's dev stream is not better than the Haiku agent on either success or $/success by Day 2 morning,
  diagnose from the traces before building more.
- If the compiled solvers are right but expensive, the next lever is tiering, not more construction.
- If they are cheap but wrong, the next lever is the shadow rate and invariants.

## 5. What stays parked
- Kev wave B (synthetic incident/synth judge data): stopped 2026-10-08 23:0x UTC to free CPU and attention. Its partial
  work is kept in `experiments/kev-data/`. Synthetic data remains the fallback if trace-harvested judgments
  are too few for Kev.
- Local open-weight generative models (owner decision).
- Rust.

## 6. Second-order reframings from the dev streams (2026-10-09, main session)

The dev evidence (DEV-NOTES D1–D12) shows that ten assumptions in §2 need revising. Each item gives the evidence, then the change.

1. **A workflow is a portfolio, not a single program.** One compile lineage scored 22/24 and another 18/24 on the same setup (D12). Compiled variants also fail in common mode (D8).
   - Keep several cheap compiles, each with a reliability record built from shadows.
   - Trust agreement only as far as it has been earned.
   - Escalate disagreement.
2. **Verify decisions, not answers.** Silent misses are a few explicit decisions (D1). Compiled code exposes its decisions, so the strong model can be asked about only the borderline ones. That costs about 1/50 of a full shadow and yields Kev labels.
3. **Three roles, not one interpreter.**
   - Demonstrator: produces traces, used rarely.
   - Adjudicator: the strongest model, asked narrow questions.
   - Executor: code plus cheap judges.

   D2 (the weak interpreter trap) and the Sonnet agent's 13/24 show that full re-solving by the interpreter is a weak oracle.
4. **Guards are learned by the runtime, not authored by the compiler** (type feedback). An automatic input profile is recorded from accepted traces and enforced before compiled code runs. It widens only on interpreter confirmation. With that rule, domain preservation (D9) holds by construction. Being tested offline (`profile.mjs`).
5. **Spec first, then compile.** Kinetics fails on semantics, not syntax: implicit exclusions and acceptable numeric variance. A strong model writes the explicit decisions, rules, tolerances and tests once, and the cheap compiler targets them. The spec's tests become acceptance.
6. **The currency is quota.** The subscription usage limit, not dollars, stalled the work. Code and Kev on the laptop cost no quota. The objective is the share of decisions made by code or Kev.
7. **Reuse and composition are different things.** (The owner corrected an earlier draft that blurred them, 2026-10-09.)
   - **Reuse** (C2) means a workflow that has proven durable in one program is reused as-is by another program, as an asset with a contract. It is safe only with an applicability check. The runtime-learned input profile (item 4) records the domain where the workflow has been proven. A new caller's input inside that domain runs the proven workflow; outside it, the workflow refuses and the router interprets or compiles a variant. A reusable workflow carries:
     - a typed input/output contract;
     - its profile;
     - its evidence record (durability, silent-miss rate);
     - its version.
   - Reuse is measured by four quantities:
     - correct reuse;
     - wrong reuse (reused outside its domain, and wrong);
     - missed reuse (refused although it would have been right);
     - savings over re-interpreting.

     Test: offer the records solver proven in the dev stream to a second program whose tasks partly overlap its domain.
   - **Composition** means building workflows from compiled sub-procedures (identity resolution, parsing, unit conversion, notification) that are guarded and healed as modules. The heal localiser picks the module. It is a separate lever: it makes healing local, and it gives reuse finer-grained units.
8. **Durability is a metric.** Measure:
   - version churn;
   - guard-fire rate over time;
   - silent misses per 100 tasks;
   - time-to-durable.

   Being added (`durability.mjs`).
9. **Swarms, boards and humans fit as the adjudication layer.**
   - Swarms explore.
   - The board is the shared decision ledger.
   - Subagents are targeted checkers.
   - The human is the final adjudicator for unresolved cases, as one setting on the owner's slider.
10. **The compiler improves itself.** Diagnoses become compiler prompt and SDK changes (D1–D12 became v2.1/v3 by hand). Automate it: propose changes from the diagnosis log, evaluate them by replaying past compiles offline, and adopt one only if it does better on held-out compile histories.
