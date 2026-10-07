# Phase 3 design: cheap-model execution (C1)

*2026-10-07, draft. Implements ROADMAP §5.3 and the procedure-distillation steps of §2.3.
Not yet pre-registered; the pre-registration follows the C0 dev round, because C1's
workflows are C0's outputs.*

## 1. Claim and exit
**C1:** frontier-authored workflows, executed with per-node model assignments found by
search, reach non-inferior verified success at much lower cost than (a) the frontier
executing alone (B0, Opus agent) and (b) the same workflow on all-frontier models, and
beat the all-cheapest assignment on success.
**Exit (ROADMAP §5.3):** C1 on two Tier A families and one owner family. Primary metric:
CPS at a non-inferiority margin on verified success; secondary: pass^k.

## 2. What is being distilled
The workflows are the **C0 F-arm artifacts** (Opus 5.5 builder, `research/construction-20261006/artifacts/`),
plus `experiments/workflows/records-hand.mjs` as a hand-authored control. Construction is
not repeated here: the workflow hash is fixed, and only model assignments and per-node
prompt variants change.

## 3. Procedure (ROADMAP §2.3, steps 2–6)
1. **Reference traces.** Run each workflow with every agent node on class F (Opus) and,
   separately, L (Sonnet) on the family's `dev` split (seeds 101–116, d3), K = 1. Keep the
   runs that pass the oracle; their journaled node calls are the references.
2. **Node screening** (`experiments/lib/distill.mjs`). For each agent node, replay the
   recorded requests verbatim on the candidates, cheapest first: Qwen3.5-2B, Granite-4.2-3B,
   Qwen3.5-4B (local, CPU), Haiku 4.5, Sonnet 5.5. Score = leaf agreement with the reference
   output (exact strings after trim, numbers to 1e-9 relative); a schema failure scores 0.
   Successive halving at cumulative sample sizes 4 → 8 → 16 with threshold 0.98 and at most
   10% failed calls. The cheapest survivor is the node's candidate assignment.
3. **Prompt variants.** For a node whose cheapest *local* candidate misses the threshold,
   the builder model (Opus) gets the node's failures (inputs, reference, candidate output)
   and writes **one** prompt variant for that node–model pair; it is re-screened once.
   Variants are bound to the pair (fixes do not transfer between models, R09).
4. **Cascade option.** A node may instead get a cascade: cheapest candidate first, and
   escalation on node-check failure (E2) or schema failure (E1), as the runtime already
   supports. Screening reports the check's catch rate on the candidate's disagreements;
   a cascade is admissible only if the check flags ≥ 90% of disagreeing outputs.
5. **End-to-end confirmation on dev.** Run the searched assignment and the cascade
   variant end to end on dev (16 tasks, K = 1). If success is more than 5 points below the
   all-frontier assignment, the most-disagreeing node is promoted one class and the run
   repeats (at most 3 promotions).
6. **Freeze** a `modelAssignment` bound to the workflow hash, model ids, engine version and
   decoding settings (`schemas/model-assignment.schema.json`, to be written).

## 4. Evaluation (sealed for claim-bearing rounds)
Arms per family, on held-out `test` seeds (never inspected), K = 3:
| Arm | What |
|---|---|
| `wf-searched` | the frozen searched assignment |
| `wf-cascade` | cheapest candidates + E1/E2 escalation up to F |
| `wf-frontier` | the same workflow, every agent node Opus |
| `wf-cheapest` | the same workflow, every agent node Qwen3.5-2B (local) |
| `B0-opus` | Claude Code headless with Opus, same per-task cap as C0 |
| `B0-haiku` | the same with Haiku |

**Non-inferiority margin:** 5 points on verified success (pre-registered), tested with a
family-clustered paired bootstrap 95% CI on (wf-searched − wf-frontier). CPS includes
local compute imputed at $0.20 per CPU-hour (the policy file's `imputedComputeUsdPerHour`),
reported separately as well, since on this VM local inference is slow and not free.

**Power.** With 3 families × 16 test tasks × K = 3 the CI half-width on a success
difference is about ±10 points: enough to see large gaps, not to prove 5-point
non-inferiority. The report will say which it is.

## 5. Owner family
ROADMAP §4.2 lists owner families (dependency upgrades, CI-failure repair, flaky-test
triage, web QA, data/SQL fixes). The only owner repository in scope is this one.
Candidate: **CI-failure repair on workflow-foundry itself**: seeded mutations of `src/`
that break named tests, with the suite as oracle and a diff guard against test edits.
Built as a bed (`beds/ownerci/`) with the same contract and an independent audit.

## 6. Engine conformance (§5.3 build item)
Measured on CPU only: the same GGUF and schema through llama.cpp `llama-server`
(json_schema grammar) and, if installable within the D5 cap, Ollama. vLLM/SGLang need a
GPU and are reported as **not measured** in this environment.

## 7. Open questions
- Reference choice: an Opus reference can itself be wrong on passing runs (a wrong leaf
  that the oracle tolerates). Agreement is a screen, not a verdict; end-to-end
  confirmation decides.
- Local latency: Qwen3.5-4B runs at ≈ 6 tokens/s generation on this CPU, so a d3
  `records` task is ≈ 10–20 min of CPU. Local arms run at concurrency 1 and are budgeted
  in wall time as well as dollars.
