---
name: foundry-construct
description: Construct a Workflow Foundry workflow (typed JSON IR) for a task, or decide that the task needs none. Use when asked to build, size, scale, verify or repair a workflow, including very large jobs (whole-codebase audits, research programs over huge data). Encodes the construction rules our measured runs support.
license: LicenseRef-Project-Pending
compatibility: Workflow Foundry engine (Node >= 24). Validate with `foundry validate` and `foundry lint --fail-on error`.
---

# Construct a workflow

A workflow is worth building when code can own the procedure and make the result checkable. Your job is the
cheapest workflow that **proves** it did the whole job: every unit covered, every outcome checked by something
other than the step that produced it. Build it, practise it, then stop on evidence, not on confidence.

## The loop

1. **Need.** Decide first whether any workflow is needed. One call or one agent is often the best workflow.
   Build one when the task recurs, waits on time or people, makes irreversible effects, spans several systems, is
   too large for one context, or must be exact and auditable. When unsure, load `references/need.md`.
2. **Contract before nodes.** Write the envelope: success criteria, risks, unsupported cases. Map every required
   outcome to a check that something other than its producer evaluates: code, a capability that re-reads the
   world, or a different model. "The tool said done" and "the model says it looks right" are not checks.
3. **Measure before you plan.** Get the real inventory and its size from code: files, rows, bytes, records,
   systems, people. Never let a model estimate how much work there is.
4. **Bind capabilities at construction.** Use only tools in the actual catalog, with their real schemas, bound
   per node. Missing capability = explicit blocker. Do not leave tool choice to the run.
5. **Code owns procedure; models make narrow judgments.** Write deterministic steps as `code` or `task` nodes.
   Use an `agent` node only where judgment is irreducible, with a typed `returns` schema, the cheapest model
   class that passes practice, and only the context it needs.
6. **Scale.** If the work cannot fit one reader's budget, or has more than ~50 units, load `references/scale.md`
   and follow it: partition by code, a coverage ledger, fan-out sized from measured difficulty, a sampled second
   reader, and reconciliation.
7. **Validate and lint.** Run `foundry validate` and `foundry lint --fail-on error`, and fix every finding. The
   linter already enforces gating acceptance, gated collected failures and gated continued errors. Do not restate
   those rules; satisfy them.
8. **Practise on executable cases.** Run representative cases, plus negatives: missing or contradictory data,
   denied tools, duplicate effects, restart mid-run. Then mutate the workflow (drop a step, corrupt an output) and
   confirm a check fails. A check that never fails tells you nothing.
9. **Freeze only clean.** Do not freeze while any practice case fails. Either fix it or write it into
   `envelope.unsupported`. Workflows frozen with known misses carried them to sealed rows.
10. **Stop on evidence.** The workflow is done when every acceptance check has evidence. Report the validation
    result, the cases run, the independent evidence, the cost and the remaining limits. Never report "no failure
    found" as "correct".

## Hard rules (not enforced by the linter)

- A producer never grades itself. A healer, extractor or builder that also judges its own output must be
  replaced by an independent check. Observed: a self-graded repair said "pass" 8 of 8 times while the oracle said
  0 of 8.
- Side effects go through checks before commit: validate an effect against the host's contract and surface its
  refusals before applying it. Retrying an effect whose outcome is unknown is forbidden: reconcile first.
- Coverage is reported by code from the ledger, never by a model's summary.
- Every finding carries its provenance: unit id plus location. A finding without a location is noise.
- Spend a larger model class only where a cheaper one failed in practice, and say so in `model.justification`.
- Prefer extracting with code (structure, section and cue rules) before asking a model. Code alone often matches
  or beats a cheap model on extraction.
- Fan-out is sized, never maxed: code clears what it can first, and the number of model calls = the remaining
  work ÷ the shard size where the chosen model's measured recall holds. The engine's 1,000 items per map is a limit.
- Every loop has `maxIterations`, every wait a timeout, every map `maxItems`, every run a budget.

## Load only what the current step needs

| Step | Reference |
|---|---|
| Is a workflow needed? Which mode? | `references/need.md` |
| Node kinds, fields, references, minimal shapes | `references/ir.md` (generated from the schema) |
| A pattern for this task shape, with evidence | `references/patterns.md` |
| Large jobs: partition, ledger, fan-out, sampling, stopping, optimality | `references/scale.md` |
| Checks, independence, three-valued outcomes, when to stop | `references/verify-stop.md` |
| A run failed, or a workflow is reused elsewhere | `references/heal-reuse.md` |
| Failure modes seen in our runs, with counts | `references/antipatterns.md` |
| A complete scale example that validates and lints clean | `exemplars/partitioned-audit.json` |
| Complete procedure examples with approvals and re-read checks | `app/core/templates/*.json` |

Evidence levels used in the references: **sealed** (held out, separate author), **held-out** (frozen
preregistration), **dev** (development data), **design** (not yet measured). Weigh rules accordingly.
