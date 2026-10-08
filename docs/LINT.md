# Strict construction lint, acceptance grades and the `unverified` verdict

Reference for `src/lint.mjs`, `src/acceptance.mjs` and `src/verdict.mjs`. Specs: ROADMAP-AMENDMENTS R-15 and R-17
([`research/review-20261007/`](../research/review-20261007/ROADMAP-AMENDMENTS.md)), review lane 5 §3.6, C0 `REPORT-dev.md` §6.1.

## Why

In the C0 dev round every constructed workflow accepted as soon as "an answer exists", and the run verdict said `pass` on
32 of 32 F trials, including the 5 that failed the oracle. A valid schema and a finished run are not task success. Two
changes close that: a lint that rejects the patterns which made it possible, and a run verdict that cannot say `pass`
unless something a wrong answer can fail gated the run.

## Commands

```
foundry lint WORKFLOW.json [--policy MODEL_POLICY.json] [--components MANIFEST.json] [--fail-on error|warning]
foundry validate WORKFLOW.json --strict          # the same report; lint is always strict
```

Both print the validator result plus `lint`. Exit status is 1 when the workflow is invalid (a base error or a lint
error), or, with `--fail-on warning`, when anything was reported. Plain `foundry validate` is unchanged, so frozen
workflows still load and run. In code: `validateWorkflow(workflow, { registry, modelPolicy, strict: true })` or
`lintWorkflow(workflow, { modelPolicy })`. The MCP tool `foundry_validate` takes `strict: true`.

Result shape (`lint`):

```json
{ "profile": "strict-construction/1", "ok": false, "counts": { "error": 3, "warning": 2 },
  "codes": { "ACCEPTANCE_EXISTENCE_ONLY": 1 },
  "acceptance": { "grade": "existence-only", "code": "ACCEPTANCE_EXISTENCE_ONLY", "gates": [], "weak": ["exists nodes.answer.records"] },
  "findings": [ { "code": "VERIFY_NOT_GATING", "severity": "error", "path": "workflow.check", "node": "check",
                  "message": "...", "repair": { "action": "gate-verify", "hint": "..." }, "details": {} } ] }
```

`code`, `severity`, `path` (the validator's path syntax) and `repair.action` are stable and meant for a repair loop. `message`
and `repair.hint` are prose. Error findings are copied into `errors` (the workflow is then invalid and has no `hash`), warning
findings into `warnings`. The advisory base warning `ERROR_COLLECTION` is replaced by the strict rule of the same code.

## Rules

| Code | Severity | Fires when | Repair action |
|---|---|---|---|
| `ACCEPTANCE_EXISTENCE_ONLY` | error | The root acceptance holds only presence predicates and no gating `assert` or independent gating `verify` covers the answer (a gating verify inside a map or loop body the answer depends on counts too, unless a collecting map swallows its failures). Cleared by a strong predicate, or by the `oracle` declaration below | `strengthen-acceptance` |
| `VERIFY_NOT_GATING` | error (warning under `oracle: none`; never in a `discovery` workflow) | A `verify` node has `gate:false` and no acceptance, `assert`, `when` or loop `until` condition reads its result. `exists nodes.V.pass` does not count: the key exists when `pass` is false | `gate-verify` |
| `ERROR_COLLECTION` | error | A `map` has `failure:"collect"` and nothing gates on `nodes.M.failed` (acceptance, `assert`, `when`), nor does a gating `verify` read the map. Failed items and batches would be dropped silently | `gate-failed-count` |
| `ESCALATION_WITHOUT_CHECKS` | warning | A model node sets `escalation.onCheckFail` to `escalate` or `resample` but has no `checks`. Only schema failures (E1) can still escalate it | `add-checks-or-drop-escalation` |
| `GLOBAL_READ_UNGUARDED` | warning | A root-flow `agent` with role extract, classify, judge or route is read by a `map` or by a node that also reads a map (one read conditions every item), and has none of: an evidence-quote field in `returns` that a check (or a gating `verify`) reads; k-sample agreement (two or more sibling agents with the same role, schema and inputs that one later node compares); a start class above the workflow default | `guard-global-read` |
| `CLASS_ABOVE_DEFAULT_UNJUSTIFIED` | warning | A model node starts on a class above the workflow default and has no `model.justification`. The default is `defaultClass` if declared, otherwise the cheapest class any model node starts on | `justify-class` |
| `NO_ORACLE_DECLARED` | warning | The workflow declares `oracle: { mode: "none" }`. Informational: its runs end `unverified` | `none` |
| `ORACLE_DECLARATION_REDUNDANT` | warning | `oracle: none` is declared although the acceptance already holds a gating check | `remove-oracle-declaration` |
| `LINT_RULE_SKIPPED` | warning | A rule threw on a malformed workflow. Reported, never swallowed; fix the validation errors first | `fix-workflow` |

What counts as a **presence predicate** (not a gate): `exists X`; `ne X null|""|[]|{}`; `gt X.length 0` and `gte X.count 1`
(and mirrors); comparing a value with itself; any condition without a reference. `all` is as strong as its strongest branch,
`any` as strong as its weakest, `not` flips the polarity (`not exists X` can fail, so it is strong). A verify with
`independence: same-model` never counts as an independent gate: a producer cannot certify itself.

The lint is **structural**. It recognizes the declared form of a guard, not whether the guard is any good, and it grades only
the root flow's acceptance (map and loop bodies carry per-item acceptance, whose job is local). Its rules were written from the
C0 dev artifacts, so their firing there describes those artifacts; it does not show that the rules predict failures on new
constructions. `GLOBAL_READ_UNGUARDED` in particular is a heuristic and can fire on a one-shot lookup that is not a configuration
read (`countries` in F-opus records).

## The documented "no oracle available" mode

Some tasks have no executable or independent check (a free-text brief, a plan). Say so explicitly instead of passing on existence:

```json
"oracle": { "mode": "none", "reason": "No executable oracle exists for a free-text brief; a person reads it against the source." }
```

`reason` is required (20 to 2000 characters) and is copied into the run verdict. With it the lint accepts an existence-only
acceptance (and reports `NO_ORACLE_DECLARED`), and every succeeded run ends `unverified` with code `NO_ORACLE_DECLARED`, whatever
its acceptance holds. Replace the declaration with a gating check as soon as an independent oracle exists.

Two small related fields: top-level `defaultClass` (a class from the owner policy) sets the default for
`CLASS_ABOVE_DEFAULT_UNJUSTIFIED`, and `model.justification` (10 to 1000 characters) is the justification it asks for.

## Run verdicts

`unverified` is a new verdict (authority `unresolved`, like `inconclusive`). It means: the run reached its end, but nothing that a
wrong answer can fail gated it, or something said the answer is not sound. A run is `pass` only if its acceptance gates (R-17).
For a succeeded run, in order:

| Verdict `code` | Condition |
|---|---|
| `finding` | A discovery workflow with at least one confirmed finding (unchanged) |
| `VERIFY_FAILED_NONBLOCKING` | A `gate:false` verify that nothing reads recorded `pass:false`. The answer needs review |
| `ERROR_COLLECTED` | A collecting `map` whose failed count is not gated recorded failed items |
| `ACCEPTANCE_EXISTENCE_ONLY` | The acceptance only checks that an answer exists |
| `NO_ORACLE_DECLARED` | The workflow declares `oracle: none` |
| `ACCEPTANCE_UNASSESSED` | `verdictOf` was not given the workflow, so the acceptance cannot be read |
| (`pass`) | None of the above: the acceptance holds a gate |

Every verdict for a succeeded run carries `acceptance` (`gating`, `existence-only`, `no-oracle`, `unassessed`), and the decision
record's `features.acceptance` repeats it. A failing gating verify still stops the run (`VERIFY_FAILED`, verdict `inconclusive`).
`unverified` is a statement about what the run established, not about the answer: an unverified run may well be right, as 27 of
the 32 C0 F trials were. Reports must show the run verdict next to the independent oracle's, per arm.
