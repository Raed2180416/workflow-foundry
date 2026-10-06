# Consequence-driven repair: source-informed mechanisms

17 September 2026. These are research transfers, not claims that the cited systems solve Foundry's synthesis problem. The local study preserves implementation and test receipts separately.

## Independent outcome observation must survive a green execution

Local source witness: `workflow-foundry/src/store.mjs:243-277` opens diagnostic repair only for a terminal failed run with error evidence. The new `outcome-repair/artifacts/legacy-witness-DxhxG9/witness.json` records an applied workflow whose runtime succeeded but whose actual `record.json` disagreed with the host-supplied expectation; the existing repair API rejected it with `REPAIR_RUN_STATE`. This is an actual missing join between outcome verification and repair, not evidence that every existing repair path is broken.

Kubernetes supplies a useful operational distinction. Its controller documentation describes comparing desired state with current state and acting on their difference. The inspected controller-runtime Reconciler contract is level-based: it concerns current API/cache state rather than the event that happened to trigger processing. Its implementation treats an error, an explicit later requeue, and completed reconciliation differently. A nil error with `RequeueAfter` can schedule later work. That makes a control-loop continuation distinct from an exception.

Primary sources inspected through the web on 17 September 2026:

- https://kubernetes.io/docs/concepts/architecture/controller/
- https://github.com/kubernetes-sigs/controller-runtime/blob/main/pkg/reconcile/reconcile.go
- https://github.com/kubernetes-sigs/controller-runtime/blob/main/pkg/internal/controller/controller.go

These main-branch source URLs were inspected, not cloned or executed here, and are not immutable revision pins. They support mechanism comparison rather than a source-reproduction claim.

The transfer is narrow: Foundry should compare a versioned outcome obligation against bound observation even when the execution engine returns success. A repair proposal must retain the original requirement and exact observed run; it must not overwrite that successful execution status to manufacture an exception. Unknown observation is different from observed non-satisfaction. Repairing an artifact-generating workflow is different from directly overwriting historical artifact bytes.

The analogy stops at semantic grounding. Kubernetes controllers are authored for a supplied resource specification. They do not independently identify arbitrary human objectives or invent their own outcome oracle. Foundry's first observer likewise receives a researcher/host-supplied exact JSON expectation. It is not a general business-outcome judge.

Negative operating evidence was read alongside the positive implementation. Controller-runtime issue 617, opened 30 September 2019, discusses incomplete reconciliation without an immediate requeue when a later watched event is expected. Issue 3297, opened 25 August 2025 and closed as not planned, asks about rate-limited requeue after the older Requeue field was deprecated. These are dated primary discussions of control semantics, not new 2026 outages or evidence of a universally broken controller.

- https://github.com/kubernetes-sigs/controller-runtime/issues/617
- https://github.com/kubernetes-sigs/controller-runtime/issues/3297

## Outcome correctness alone can miss forbidden process behavior

The frozen batch benchmark's supplied reproduce-every-item mutation produces the correct manifest in all 13 cases, yet makes 11 reproduction calls forbidden by the task. Its independent call ledger rejects both suites. This is stronger than a vocabulary or graph-shape counterexample: the wrong process has an apparently correct final result.

Consequently, the contract must retain both terminal outcome obligations and process restrictions. The current finite oracle checks actual sample identity, attempts, evidence-dependent ordering, duplicates, forbidden calls, and exact artifact JSON. This is deliberately not a universal temporal-logic representation. The six mutations demonstrate discriminating coverage only for the registered failures, not completeness over possible programs.

## Typed judgment is evidence, not an authority source

TypeSafe's confidence documentation states that Choice/Score confidence is calculated from the returned probability distribution. It is not another independently observed witness. The actual pinned SDK source (`ai@7.0.105`, `@ai-sdk/gateway@4.0.85`) likewise separates probability validation from calibration and notes that question types and provider semantics differ.

- https://docs.typesafe.ai/confidence
- Local implementation: `jev/node_modules/ai/src/evaluate/evaluate.ts`, `validate-evaluation.ts`, and `jev/node_modules/@ai-sdk/gateway/src/gateway-evaluation-model.ts`.

The frozen Jev assay therefore binds a typed recommendation to the exact evidence and option set, rejects stale judgments, and grants no execution authority. The labels and alternatives are explicitly supplied. The 36 oracle-wiring results only validate harness plumbing. The actual access probe returned authentication failure, so no claim about Jev accuracy, calibration, latency under inference, or live cost is supported by this study yet.

Exact checks—JSON equality, source identity, version binding, and call counts—remain deterministic. Jev is a candidate for interpreting corrections, relevance, competing meanings and repair implications where those are not already resolved by exact contracts. Adding it to every boolean check would add uncertainty without demonstrating a useful faculty.
