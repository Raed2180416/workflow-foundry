# Pre-registration: c0-dev (construction, development round)

**Status: DRAFT, not frozen.** Freezing needs the C0 preflight gate (G1 tests and dry run, G2 smokes, G3 this file
with its hashes) and is recorded under Amendments.

| Field | Value |
|---|---|
| Experiment id | `c0-dev` |
| Claim tested | C0 (ROADMAP §4.1), development round: given a task family it has not solved before, does a builder agent (Claude Code) produce a working solver more often, and with lower total cost per verified success, when it builds a typed Foundry workflow (F) than when it writes an ordinary orchestration script (B1), and than when the same model solves each task directly (B0)? Asked separately for a strong builder (Opus 5.5) and a weak one (Haiku 4.5): the system must make even Haiku able to construct, edit and run workflows. |
| Evidence class | **development**. Families are the 5 one-shot dev beds; the construction skills (`skills/micro-harness`, `skills/script-harness`) were written by the experimenter using the records pilot. Results may improve the protocol and skills before the sealed round (`PREREG-sealed.md`), which is the claim-bearing test. |
| Pre-registration commit | recorded under Amendments when frozen |
| Date | 2026-10-07 |

## 1. Beds and splits
- Families: `records`, `incident`, `codefix`, `synth`, `kinetics` (all `kind: oneshot`), difficulty 3.
- Probes given to builders: `dev` split seeds 1, 2, 3.
- Evaluation tasks: `test` split seeds 6001–6004 (4 tasks per family; never inspected).
- Oracles: each bed's `oracle()`; bed test suites green before the run. The task hashes printed by
  `node experiments/c0/run-dev.mjs --dry` are recorded at freeze (beds still being edited must settle first).

## 2. Models and arms
**Models (owner policy, 2026-10-07).** The only models any arm, artifact or builder smoke run may call are
`claude-haiku-4-5-20251001` (class M, the deliberately weak model, "akin to a ~9B model"), `claude-sonnet-5-5`
(class L) and `claude-opus-5-5` (class F). Class S (local qwen/granite models) is empty: local generative models are
parked and unreachable. Enforced four ways: the experiment's ModelPort holds a subset of the owner policy (its hash
`policyHash` is recorded with every construction and arm; the owner policy hash is recorded too); the host gateway
allow-lists the three ids; the F builder's Foundry CLI validates and runs against that subset (`tools/policy.json`, so a
class S node fails with MODEL_CLASS_EMPTY); no local model provider is constructed. Development agents that build
Foundry itself (Opus 5.5 and Sonnet 5.5) are not part of the experiment.

**Builder models.** Opus 5.5 at effort `xhigh` and Haiku 4.5 at effort `xhigh` (Claude Code CLI 2.1.292 accepted
`--effort xhigh` for Haiku 4.5 in a probe on 2026-10-07, with extended thinking active; had it been rejected, `high`
would have been used and recorded here). Each builder model builds both artifacts for every family.

| Arm | Construction | Execution per task |
|---|---|---|
| F-opus | Opus 5.5 (xhigh) builder in the executor sandbox with the Foundry kit (read-only), `skills/micro-harness`, 3 probes, `/score` (≤ 12 checks), model gateway ($2 cap); builder cap $8; 45 min | the delivered `workflow.json` (pinned copy, hash-checked) on the Foundry runtime (host), maxCost $1, 20 min |
| B1-opus | same builder, sandbox, probes, `/score`, gateway, caps and time; a read-only script kit with `skills/script-harness`; writes `solve.mjs` | `node solve.mjs task.json` in the sandbox without network (the gateway's unix socket only), gateway cap $1, 20 min |
| F-haiku | as F-opus with a Haiku 4.5 (xhigh) builder | as F-opus |
| B1-haiku | as B1-opus with a Haiku 4.5 (xhigh) builder | as B1-opus |
| B0-opus | none | Claude Code headless (Opus 5.5) with tools in the executor sandbox, per-task cap $2, 20 min |
| B0-haiku | none | the same with Haiku 4.5, per-task cap $1, 20 min |

Construction labels are `<arm>-<family>-k1` (e.g. `F-opus-records-k1`): 5 families × 4 constructed arms = 20
constructions (K_c = 1 in this round). Each delivered artifact also runs once on its 3 probes (construction success).
Execution K = 2 trials per evaluation task, 6 arms. Prompts: `experiments/c0/prompts.mjs` (hash under Amendments).

**Guidance symmetry.** F builders get `skills/micro-harness` (SKILL.md, `references/ir.md`, `references/operators.md`)
from the Foundry kit. B1 builders get `skills/script-harness` (SKILL.md, `references/patterns.md`) from a script kit
that holds only that skill, mounted read-only the same way and pointed to by the same sentence of the prompt. It
carries the same general lessons (narrow typed judgments, thinking off for extraction, raw spans parsed in code, id-echo
checks, rules in code, verify then answer, cheapest model first with bounded escalation) for plain Node scripts using
`tools/model.mjs`; it is family-neutral, and SKILL.md and its pattern reference are each within ±15% of their
micro-harness counterparts (checked by `experiments/lib/c0-protocol.test.mjs`). Remaining asymmetry: `ir.md` documents
the IR (substrate documentation, as the callModel paragraph does for B1), and the Foundry kit also contains the
Foundry sources and other skills that the prompt does not point to.

## 3. Measurements
- **Construction success**: the artifact was delivered and answered every probe without a harness fault (no error, an
  output to score).
- **TTFH**: score checks and wall time until the first passing probe check (timestamped `/score` log).
- **Verified success** on the 4 × 2 evaluation trials per family and arm.
- **CPS** = (construction $ + all execution $) / verified successes, construction amortised over the 8 evaluation
  trials; also execution-only CPS, and the break-even number of verified successes against B0 of the same model.
- Per-task execution cost, latency, harness faults, environment faults (retried), `costUnknown` trials, gateway
  refusals, verdicts (F), models used.

## 4. Analysis and power
`node experiments/c0/analyze.mjs` (frozen with this file). Within each builder model: F vs B1, F vs B0, B1 vs B0.
Across builder models: F-haiku vs F-opus, B1-haiku vs B1-opus, and F-haiku vs B0-opus. Each paired comparison reports
the success difference and two CPS ratios (execution only; including construction, resampled with the tasks) from a
family-clustered bootstrap (10,000 resamples), with the count of resamples where both CPS are finite. 5 families × 4
tasks × K = 2 is far below the power needed for success differences (R05 §3): **directional only**; no claim is made
from this round.

## 5. Measurement rules
- **Kill rules.** Stop if a construction exceeds a cap by more than 20% (builder > $9.60 or gateway > $2.40), if total
  recorded spend (constructions, construction faults, probe and evaluation trials and their faults) passes $350
  (checked after every construction and every trial), or if environment faults stall a family run (below).
- **Gateway reservation.** A call in flight holds (system + prompt + schema characters / 3) tokens × 2 at the model's
  input price plus 8,000 output tokens at its output price, at most the $1 per-call cap. A call is admitted only if its
  reservation fits next to the known spend and the calls in flight; otherwise it waits for one to settle, and is
  refused (`GATEWAY_BUDGET`, counted in the record) when it cannot fit. Closing a session waits for calls in flight
  (330 s grace, then cancels and still charges what each journaled call consumed).
- **Environment faults.** A failed trial whose own error, or any model call it made, is `MODEL_RATE_LIMIT` (including
  subscription usage limits), `MODEL_UNAVAILABLE`, `SANDBOX_UNAVAILABLE`, `EXECUTOR_LAUNCH` or `EXECUTOR_PROTOCOL` is not
  an outcome: it goes to `results.faults.jsonl` (or `probes.faults.jsonl`) with its spend, and a resume retries it. A
  construction whose builder session ended in one of these goes to `construction-faults.jsonl` and is retried on
  resume. A passing trial that met a fault is a pass. If more than 25% of a family run's attempted trials (after at
  least 8) are faulted, the run stops; resume after the reset. Faulted spend counts toward the kill rule.
- **Unknown spend.** A builder or B0 session killed without a result is charged at its budget bound (`costUnknown`
  recorded); a gateway call whose spend could not be observed adds its bound to `unknownUpperUsd`. Never a silent $0.
- **Transcript scans.** `nestedModelAttempts > 0` (a nested Claude CLI or direct model API use in a builder or B0
  transcript: spend outside every ledger) voids the run: a voided construction is not executed and its cost leaves
  the analysis; a voided B0 trial is excluded. `outsidePaths` is reviewed by hand.
- **Time.** One 20-minute execution cap for every arm (F `maxDurationMs`, B1 script timeout, B0 session timeout).
  F agent nodes without their own `timeoutMs` use the ModelPort's 300 s call timeout, as B1's gateway calls do.
- **Cache pricing.** `FORCE_PROMPT_CACHING_5M` is not set; recorded costs are the CLI-reported list-price costs.
- **Resume.** A resume never mixes arm versions (arm hash includes the artifact hash, session policy hash and caps),
  and reuses a construction only from the same session policy, kit and builder model and effort.

## 6. Cost estimate
At caps: constructions 20 × $10 = $200; probe runs 20 × 3 × $1 = $60; F and B1 evaluation 4 arms × 5 families × 8
trials × $1 = $160; B0-opus 40 × $2 = $80; B0-haiku 40 × $1 = $40; total ≤ $540. The $350 kill rule bounds actual
spend at about $350 plus work in flight (≤ 4 constructions and 3 trials, ≈ $55), under the owner's $500
per-experiment pause threshold. Expected ≈ $200, a rough guess: the 2026-10-07 smokes (Sonnet builder, difficulty 2,
6–15 minutes) cost $0.67 and $1.03 per construction and $0.10–0.28 per executed task; Opus at `xhigh` for up to 45
minutes will cost several times more per construction, Haiku less.

## 7. Threats
- One construction per arm per family: builder variance is large (a Haiku smoke built a single-node workflow); the
  sealed round uses K_c = 2.
- The skills were written with knowledge of the records family (only general lessons are in them; a literal scan of
  the kits for dev-family strings is part of the sealed protocol).
- Substrates differ: F runs on the Foundry runtime on the host (code nodes in their own no-network sandbox), B1 runs a
  sandboxed Node script without network; both reach models only through the same subset policy, journal and pricing.
- The Haiku builder runs at effort `xhigh`; whether the API applies every effort level to Haiku is not observable
  from the CLI result beyond extended thinking being active.

## Amendments
(dated entries only)

- **2026-10-07, pre-freeze (no c0-dev results exist).** Changes from the first draft, following the C0 preflight review
  (R1–R9) and the owner's model policy of 2026-10-07:
  1. Models: the session subset of Haiku 4.5, Sonnet 5.5 and Opus 5.5, enforced by the subset policy, the gateway
     allow-list, the builder's policy file and no local provider (was: the full owner policy, unenforced).
  2. Two builder models (Opus 5.5 and Haiku 4.5, both effort `xhigh`) with identical caps; arms F-opus, B1-opus,
     F-haiku, B1-haiku, B0-opus, B0-haiku (was: one Opus builder, arms F, B1, B0-opus, B0-haiku); 20 constructions.
  3. Guidance symmetry: B1 builders get `skills/script-harness` exactly as F builders get `skills/micro-harness`.
  4. Builder prompt additions: budget tool, fresh workspace after each edit (F), session model classes (F), call log,
     execution environment and `tools/run-solver` (B1).
  5. Measurement rules of §5: gateway reservation (8,000 output tokens), environment-fault rule and stall rule,
     unknown-spend charging, void rule for nested model use, one 20-minute execution cap, 300 s call timeout for F,
     no `FORCE_PROMPT_CACHING_5M`, strict resume.
  6. Kill threshold $350 (was $250), because the constructions doubled; the bound stays under the $500 pause rule.
  7. Executor sandbox: own mount and pid namespace with a fresh /proc, host filesystem read-only, /root, /tmp,
     /home/user, /run, other workdirs and kits hidden, parent session identity scrubbed; B1 execution has no network.
  8. Cost estimate rewritten for 20 constructions and six arms (DESIGN §2's $6 construction budget is superseded by
     $8 builder + $2 gateway).
