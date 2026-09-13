# Observed evaluation results

Date: 2026-09-13. Scope: diagnostic development only. No heldout or commercial
comparison has been completed. **The generated workflow is not ready for
promotion: after correction it passed eight original cases but produced false
success in all 21 subsequent wrong-type input challenges.**

## Actual OpenCode TUI smoke

The installed OpenCode 1.18.29 TUI used `opencode/big-pickle`, selected from the
actual isolated zero-price provider catalog. The task requested a synthetic JSON
file; neither attempt received private repository data or account credentials.

| Attempt | Actual model tools | Artifact oracle | Interpretation |
| --- | --- | --- | --- |
| `smoke-20260913` | Four denied calls; no completed write | Fail | Incorrect operator permission setup. Preserved infrastructure failure. |
| `smoke-pathfix-20260913` | One completed write; final `DONE` | Pass | Actual model-created file exactly matches the requested JSON and preserved write bytes. |

The second attempt changed only the sandbox path permission rules needed by the
installed application's non-Git root behavior. The prompt was copied unchanged.
This is one corrected environment smoke, not a claim of a 50% workflow success
rate and not a baseline-versus-skill comparison.

Successful session: `ses_f659b11f9ffeBhWQJNPznj62kN`.
Output SHA-256: `7bdfdf0ff7745f3fbd25b7051ea266f0740f75ad3b69d579e1db442b48ea3052`.
Application-reported cost: 0. Reported input/output/cache-read tokens:
1,877 / 90 / 5,120. TUI displayed response duration: 14.0 seconds.

Raw terminal stream, screens, local session export, prompt, model catalog,
effective configuration and independent verdict remain under each ignored
`evals/runs/<attempt>/` directory. Both owned TUI processes were stopped.
`research/dossiers/opencode-environment.md` provides file/line-specific evidence.

## Implemented invalid-evidence probes

`node --test tests/evaluation-evidence.test.mjs` passed 8 tests. The gate rejects
denied tool calls reported as completion, missing/replaced output, incorrect JSON,
prompt/model/hash drift, nonzero/unknown model prices, path traversal, mismatched
comparison controls, skill contamination and unsealed heldout attribution.
Three incident-oracle unit tests and three tests against actual Runtime/Store also
passed. The real-runtime tests show that self-attested success, duplicate effects
with healthy final state, and omitted independent verification are rejected.
These 14 tests use explicit hand-written unit fixtures, never model outputs.
They do not exercise all execution-domain probes listed in `PROTOCOL.md`.

## First matched construction pair

Pair: `evals/runs/incident-pair-20260913/`. The task, eight diagnostic states,
native runtime/schema, capability catalog and skill text were frozen before
generation. Both arms used OpenCode 1.18.29, `opencode/big-pickle`, identical
prompts, read/write-only tools and 240-second construction budgets. The treatment
added generic/native/software construction skills; the baseline received the
same task and interface documentation. Each arm had its own fresh TUI session.

| Arm | Actual construction | Original diagnostic states | Reported cost |
| --- | --- | --- | --- |
| Baseline | Timed out after five completed input reads; no candidate or final response. | Not executed; no valid artifact existed. | 0 |
| Foundry skills | Model wrote a schema-valid 8-node candidate; TUI response duration 132 seconds. | 7 passed / 8 executed. | 0 |

The Foundry candidate failed the missing-required-boolean case. `metrics` returned
an empty object, but a rollback effect occurred before a sibling branch failed on
the absent field. The run ultimately reported failure, yet simulator health had
already changed and the action ledger contained rollback. Independent inspection
therefore rejected the outcome. The model-created envelope and acceptance were
insufficient to establish the task's required evidence boundary.

Candidate SHA-256:
`5b72c0f2bff72776fa12b501e256ac86a778f47c3eed8b92c5b8b6367dd5769c`.
Session: `ses_f658e3e1effeUgFAHikEsp5jXg`.
Machine-readable result: `incident-foundry-20260913/construction-execution.json`.
Full failing trace: `incident-foundry-20260913/execution/missing-required-boolean/evidence.json`.
All run-relative paths in this section are below `evals/runs/`.

The scorer initially blocked because the root dependency lock gained an unrelated
`jsonc-parser` entry during concurrent development. Before either arm executed,
the unchanged AJV dependency closure was copied into the frozen executor: AJV
8.20.0, fast-deep-equal 3.1.3, fast-uri 3.1.7, json-schema-traverse 1.0.0 and
require-from-string 2.0.2. All 537 copied files have hashes in
`incident-pair-20260913/execution-dependencies.json`. No installation hooks ran.
Both original scores used the same frozen dependency identity and scorer hash;
`comparison.json` records matching controls.

## One declared correction round

Pair: `evals/runs/incident-correction-20260913/`. Both arms received the identical
independent failure report, unchanged task/skills/runtime, another 240-second
budget, and their own exact prior candidate (or null when none existed). The
order was BA, after initial AB. This is assisted diagnostic repair, not a new
independent sample. No operator edited the generated workflows.

The Foundry model produced a 9-node version-2 candidate in 42.8 seconds, adding a
shared evidence-existence assertion before remediation. Exact output SHA-256:
`736812c0a47aba788350725b1732d76738fea19fcc40bf68dc36ac3422034cba`.
Session: `ses_f65899aa7ffe5NhGAMkSA0CQBF`.

An initial scoring attempt failed before execution because a fresh Store had no
version-1 workflow history. That `VERSION_CONFLICT` receipt remains in
`incident-correct-b-20260913/construction-execution.json`. Scorer revision 2 seeds
the exact preserved prior definition before importing its version-2 replacement;
it does not alter the model's version or content. The separate v2 receipt and
fresh execution directories preserve the correction transparently.

With matching history, the corrected Foundry workflow **passed 8/8 original
diagnostic states**. This includes rejecting missing fields before an effect.
Application-reported generation cost remained 0. The baseline correction also
produced a schema-valid candidate in 163 seconds and passed 8/8 original states.
Its session is `ses_f6587d099ffew8qq9gV854o91x`, and its output SHA-256 is
`e02de9a6baf179e0b571d287c110142406a06e5509aceafa00f2d5ee6a8c28e0`.
Both correction arms used matching scorer and dependency hashes. The baseline
TUI remained idle after its completed response until the 240-second process
timeout; the recorded final response was within the generation budget.

## Adversarial follow-on: presence is weaker than a valid boolean

The corrected workflow used existence tests. A separately frozen diagnostic
challenge replaced each required boolean with null, 0, 1, "false", "true", an
array or an object: three fields × seven invalid values = 21 states. The original
task already required boolean evidence. These variants were designed after
inspecting the repair and are explicitly not held out.

**Foundry result: 0/21 passed; all 21 runs applied an effect and incorrectly reported
successful recovery. Baseline result: 7/21 passed, with 14 false successes.**
A null CPU-saturation value, for example, passed the
existence gate; the deployment signal selected rollback, and final health/action
checks succeeded despite invalid required evidence. Passing the original eight
cases did not establish compliance with the full stated input contract.

Challenge case hash:
`6563222818d135ed3e84b0db50cda61ea3a724d6d84f461f60dcc5eb75b83a62`.
Run reports: `incident-correct-b-20260913/typing-challenge/report.json` and
`incident-correct-a-20260913/typing-challenge/report.json`.
Each challenge retains the actual runtime state, simulator action ledger and
event chain. The challenge used the original frozen runtime and unmodified model
output. No extra model correction was silently added to the declared budget.

The necessary next requirement is a typed evidence barrier dominating every
dependent effect. For this task, strict membership in `[true,false]` for every
required observation would reject the tested bad values; that proposed repair
has not been substituted into the model artifact. A general generator needs to
derive such obligations from the task's structured data/effect contract and
verify them independently.

## Interpretation

One architect task with repeated synthetic states does not support a statistical
superiority or equivalence claim. The baseline's timeout also prevents a direct
quality comparison of two first-pass programs. The results demonstrate actual
TUI construction, model-assisted diagnostic repair, and independent discovery of
remaining false success. They do not establish small-model efficiency, Haiku
performance, commercial product parity or robustness to arbitrary worst cases.
