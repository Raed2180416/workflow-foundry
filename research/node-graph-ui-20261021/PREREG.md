# PREREG: run-graph data, held-out look (frozen 2026-11-04, before the held-out run)

**What is compared.** What a person (or any UI built on the data) is told about a run, at every committed moment of
the run, by three arms, against an oracle read from the runtime's own records:

| arm | what it is |
|---|---|
| **T** | `app/core/run-graph.mjs` (this work), as committed in `858685ba` |
| **B1** | `tools/run-view`'s reducer as the prototype shows it: its 16 states read as 5, no owner check, the first red card as the cause |
| **B0** | `app/dashboard` today: run status words, `explainRun` failed step (top level), inbox approvals of runs in `awaiting_approval` |
| **C+** | the oracle answering itself (must be 100%, or the scorer is broken) |
| **C-** | T with states, waiting list, cause and costs blanked (must be at or below 25% on stateLive, waitMissed, fail and cost, or the evaluator has no teeth) |

**Oracle** (`app/eval/run-graph/harness.mjs`, `truthAt`): node states from the checkpoint snapshot taken after every
committed update (`store.updateRun`), the run state from its status and whether its owner process is alive, the
waiting set from rows in `awaiting_human`/`awaiting_approval` of a run that has not stopped, the failing leaf and its
code from failed/uncertain rows (CANCELLED and refused-approval rows excluded), per-step cost from the model-call
journal. The rules were written in development; two were corrected there and are part of this freeze (a step whose
action was refused, or stopped with CANCELLED, is "not running"; a stopped run has nothing waiting).

**Questions** (all scored per moment unless marked final): `state` (each top-level step's user state), `stateLive`
(the same, only where the truth is working, needs you or problem), `run`, `wait` (exact set), `waitFalseAlarm`
(nothing listed when nothing waits), `waitMissed` (each waiting item listed), final: `fail` (names a failing
top-level step or the run-level code), `failDeep` (names the failing leaf instance and its exact code), `cost` (steps
that spent money, within 1e-9 of the journal), `costAll`, `line` (one-line summary names the failing step and a cost).

**Cases.** Held-out: random scenarios with seeds **100000-100299** from `randomScenario` (never run before this
commit; development used the named S1-S15 and seeds 0-199), plus nothing else. The generator, oracle and arms are by
the same author as T: this is **held-out by seed, not by author**. A separate author was not available to this item.

**Frozen files** (sha256, at commit `858685ba`):

| file | sha256 |
|---|---|
| app/eval/run-graph/scenarios.mjs | 97d436b83c70dc4c2341e6206fb3f4a7f1ea271727f51eb8f53f9f428767674a |
| app/eval/run-graph/harness.mjs | 8ecdf5ec8745ae8c9e47410396e3d2a4f0a409366f71fe59feac4f9811e48f9d |
| app/eval/run-graph/mutants.mjs | 60fcf4c6a1c717fca3dc9dfb0500b2144faf276a90c52982622f8b7648d539f2 |
| app/eval/run-graph/measure.mjs | 44ceef7f0ea8d917b313a0443a067ee7a66d531640bb54e105ab0e2e74049176 |
| app/eval/run-graph/crash-child.mjs | 5e530528d190737dac7f77e248c1a60ce13fcfa62b75d02cdc1d4fb686dabf59 |
| app/core/run-graph.mjs (system under test) | 32ef9da1c7b45a0b56d9dfbab8fa404d4beabf1a09b3597bcd4ae7dce7d6aabd |

**Command (run once):**
`node app/eval/run-graph/measure.mjs --split heldout --seeds 100000-100299 --no-named --out research/node-graph-ui-20261021/results/heldout.json`

**Decision rule, fixed now.**
1. Validity: C+ = 100% on every question and C- within the bounds above; otherwise the look is invalid and no claim is made.
2. Claim H1 (correctness): T >= 99.0% on every question with n >= 20. Below that on any question: H1 fails, and every miss is root-caused in the result, not fixed into this look.
3. Claim H2 (better than the prototype's reading): T - B1 >= 10 points on `failDeep`, and T >= B1 on every other question.
4. Claim H3 (better than the product today): T - B0 >= 50 points on `waitMissed` and >= 30 points on `failDeep`.
5. Mutation (reported, not a claim): mutants killed on the held-out set.
6. No paid model call; $0. A run that crashes the harness is an evaluator fault: reported, rerun once, never scored silently.
