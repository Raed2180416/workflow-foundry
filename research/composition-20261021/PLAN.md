# Composition and long-horizon construction: plan (2026-10-21)

**Owner asks (2026-10-15):**
- The value proposition is that this system can be trusted.
- Find benchmarks we can use or adapt as of today.
- "Complex enterprise grade workflow creating with sub workflows being created correctly in long horizon tasks is
  something we need to see."

## What exists, and what does not

| Piece | State | Evidence |
|---|---|---|
| Sub-workflows in the construction SDK | **Exists.** `flow.call(hash, input, {budgetUsd, onDeopt, onRefuse})`: a nested compiled workflow from the library, run by the host in its own sandbox. Typed output schema, carved budget, recursion and depth checks, input-profile gate, local deopt, phases | `experiments/jit/flow-v3.mjs` header; FLOW-V3-SLICE1/2 |
| Sub-workflows in the IR engine (`src/`) | **Missing.** No `call` node, no `compensate` node, no continue-as-new | `src/construction-durable.mjs:191`; ROADMAP §5.6 (Phase 6) |
| W-bed R4 (nested sub-workflow) | Generator, oracle and controls exist. Never run | `beds/wbed/r4/`. The design says "nesting never changes correctness" (W-BED §2.4), so R4 measures reuse economics, not decomposition |
| E8 order saga (long horizon, compensation) | Admitted to development use. Haiku-built **monolithic** JS solvers 14/14; agent-H 10/14; agent-H + validator 12/14 | `research/enterprise-20261014/` |
| A public benchmark that judges system-chosen decomposition by execution, or compensation of generated workflows under faults | **None exists** | `research/benchmarks-20261015/CONSTRUCTION-BENCHMARKS.md` §"no benchmark" |

## The test to build: does the cheap builder decompose correctly, and does it matter?

**Bed.** E8, the longest-horizon enterprise process we have: intake, fraud review, payment, fulfilment, amendment,
cancellation with compensation, over simulated days. E7 (ITSM and SLA) follows once admitted. SOP-Bench is the external
replication (below).

**Arms** (all on the same worlds as the existing E8 rows):
- **B1L-H** (existing): Haiku builds one monolithic solver.
- **C-H** (new): Haiku builds a **composed** program.
  - A parent orchestrator plus sub-workflows it chooses itself.
  - Each sub-workflow is a separate module with a declared typed interface (input, output, effects) and its own
    contract tests.
  - The parent may call sub-workflows only through that interface.
- **C-H-T** (new): C-H with frontier-written decomposition templates (the thesis setting: cheap models construct from
  frontier-written templates).
- **agent-H / agent-H + V** (existing rows): the agent baselines.

**What is judged:**
1. **End to end.** The E8 oracle on the same completed cases, and on sealed worlds once frozen.
2. **Each business capability, independent of the builder's chosen boundaries.**
   - Hidden capability contracts are written from SPEC-E rules. Examples: payment is captured at most once per order; a
     refund is issued if and only if captured money must return; compensation runs in reverse order of effects.
   - They are judged on the effect history, so any decomposition can pass. A wrong boundary shows up as a violated
     capability.
3. **Interface honesty.** Every effect a sub-workflow emits is within its declared effects. A module that writes outside
   its interface fails.
4. **Faults.** Crash and restart mid-saga, duplicate delivery, and a downstream failure after a side effect. Measured as
   exactly-once effects and compensation completeness.
5. **Drift.** A SPEC-E rule change. Does the builder patch only the sub-workflow that owns the rule (a localised change),
   and does everything else keep passing?
6. **Cost.** Build once, then the cost per case, against the agent arms.

**Decision we want:** whether the composed program is at least as correct as the monolith, more robust under faults and
drift, and cheaper per case than the agents. If it is not, report that.

## External replication: SOP-Bench (Amazon, KDD 2026, CC BY-NC 4.0, research use)

- 10–12 SOPs with 90–327 ground-truth rows each and plain-Python mock tools.
- Published baselines: function-calling agents average about 64%, ReAct about 55%, Claude 4 Opus ReAct 72.4%.
- **Protocol:**
  - One workflow per SOP, built once by Haiku from the SOP text and 5 dev rows, with SOP sections as sub-workflows.
  - Repair on dev rows only.
  - Freeze it, then run every sealed row with k ≥ 3 and report pass^k.
  - Baseline: the Haiku agent per row, through the same mock tools.
- This is where the "90%+ reliable on recurring procedures" claim is tested on someone else's benchmark.

## AutomationBench (one-shot; context, not the thesis)

- Finish the Sonnet pair on dev60.
- Review A1-C and run it on dev60 with k ≥ 2.
- Our dev60 numbers are on the public split. They are never compared with the private leaderboard.

## Order of work

1. SOP-Bench acquisition, bridge, frozen dev/sealed split, raw Haiku baseline, then the build-once arm.
2. E8 composition arm. Build pieces, all $0:
   - the module interface;
   - the capability contracts;
   - the fault and drift harness;
   - a scripted composed reference to validate the harness.
   Then the paid C-H and C-H-T runs.
3. AutomationBench Sonnet pair, then the A1-C review and dev run.
4. The interrupted workflows from 2026-10-15 resume from their journals: A1-C review, families reviews, M0 fixes, E7
   round 2, E8 admission.

Every comparative claim is frozen before its run: cases, budgets, oracles (AGENTS.md).
