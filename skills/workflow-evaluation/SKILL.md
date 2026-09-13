---
name: workflow-evaluation
description: Test generated workflows against independent outcome oracles, compare matched baselines, discover failure cases and decide evidence-backed promotion without relying on model confidence or leaked holdouts.
license: LicenseRef-Project-Pending
---

# Evaluate a workflow, not its prose

Separate design validity, executable behavior, real task success, failure recovery,
authority compliance and deployment coverage. One score cannot trade a critical
boundary violation against lower latency. A program that passes schema validation
has only passed schema validation.

Label an evaluator receipt's scope explicitly: `qualificationLevel: construction`
for structural or neutral trace-conformance checks, and `task-outcome` for an
independent evaluator that actually checks the named task outcomes. A passing
construction check may admit a candidate for further experiments, but it must
not qualify that candidate's task performance or deployment. Reports without a
declared level remain unclassified evidence. Preserve the workflow, registry,
suite and evaluator identities; labels alone are not proof that an oracle is good.

## Freeze the comparison

Record task set/split, skill/corpus exposure, workflow/source hashes, architect
model, executor model, capabilities, runtime, initial world state, compute/cost
limits and human assistance. A free-provider model is not Haiku merely because
Haiku was the original example. Record the actual selected identifier.

Use matched conditions: bare model + format/tools; generic skill; generic+domain;
then revised skills. A reference is the actual runnable original harness when
available. A hand-coded pattern reconstruction is a **local reference**, not the
proprietary product. Different models/tools/backends prevent a harness-only claim.

## Define oracles outside the candidate

The evaluator checks the requested final state and unacceptable intermediate
effects, independently of model-authored assertions. Preserve malformed generation,
timeout, refusal, tool failure and unavailable-product outcomes in the denominator.
For nondeterminism use paired seeds/cases and repeated independent runs as feasible.

Before trusting the meter, inject: constant success, wrong answer, missing action,
unverified output, duplicated effect, mismatched evidence, skipped mandatory check,
and hidden use of a stronger model. The evaluator must catch each relevant mutation.

## Improve honestly

Use a diagnostic split for critique/repair. Save every candidate and raw result.
Attribute improvements to a concrete change, rerun regressions, and remove useless
scaffolding. Limit retries and model calls. Do not repeatedly inspect the final
test set then continue calling it held out. Cross-product holdout is not automatically
cross-domain transfer, especially when tasks or libraries overlap.

Report counts and denominators, not only percentages; report paired differences,
uncertainty and per-failure-class behavior. Zero observed critical failures in a
small sample is not proof of zero risk. Coverage is relative to the named taxonomy.

## Promotion

Keep states draft/experimental/validated-for-envelope/preferred/deprecated. Require
passing hard gates, adequate independent outcome evidence, tested recovery and
explicit remaining limits. Human changes in goals or environment/model versions
can invalidate old evidence. Preserve negative examples and retire stale workflows.

For agent loops, test causal state handoffs before spending real model calls. A
query returns an updated transcript containing its new assistant message; the
action consumes that exact message and transcript, then adds the observation.
The next iteration must receive the action's updated transcript. Exercise immediate
finish, multiple turns, malformed-action feedback and exhaustion with neutral
scripted replies. Reject mutations that drop a message, skip an observation,
flatten a named nested result or stop before actual completion. These controls
establish construction behavior only; use actual model-driven task runs and an
independent outcome oracle afterward.

Follow the concrete preregistration in `evals/PROTOCOL.md`. Fixture-level evidence
cannot establish parity with a paid closed product, a real laboratory, patient
care, production security, or arbitrary worst-case scenarios.
