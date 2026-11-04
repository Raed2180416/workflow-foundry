# Checks, independence and stopping

## What counts as a check
| Producer says | Is it evidence? | Use instead |
|---|---|---|
| "The tool returned success" | No | A `verify` with `method: "capability"` that re-reads the world (outbox, sheet, record) |
| "The model says it looks right" | No | `method: "code"` against the output's schema and invariants, or `method: "agent"` with `independence: "different-model"` |
| "All N items processed" | Only if code counted them | A ledger node comparing processed ids with the inventory |
| A file or row now exists | Presence only | A check on its content (the linter rejects existence-only acceptance) |

Independence levels, from strongest: **execution** (code or capability), then **different-model**, then **same-model**.
`same-model` checks share the producer's blind spots: use them only as cheap filters, never as the release gate.

## Outcomes are three-valued
Each obligation ends **supported** (checked and held), **failed** (checked and broke) or **unknown** (could not be
checked: tool down, data missing, sample too small). Release only with no failed obligation. List the unknowns in the
report; never round them up to supported. An effect whose outcome is unknown after a crash is reconciled
(re-read the world) before anything is retried.

## A check must be able to fail
Mutate the candidate in practice: drop a step, return a wrong value, report success after a failure. The gate must
reject each mutant. A gate that no mutant trips is decorative: strengthen it or drop the claim it was meant to support.

## When to stop
Stop when every acceptance predicate has evidence: ledger complete, gates passed, unknowns listed. A controller that
must carry evidence for each obligation before stopping cut premature stops from 40/66 to 0/66 (arXiv 2608.23623).
Stopping on budget is allowed but is reported as **incomplete** with what remains, never as done.
Evidence level: public (stopping), dev (mutation of gates: E8 oracle mutation scoring, `beds/ebed/e8/README.md`).
