# The workflow IR (generated from schemas/workflow.schema.json; do not edit by hand)

Regenerate with `node tools/skillpack/gen-ir.mjs`. Top-level fields: `schemaVersion`, `id`, `version`, `title`, `goal`, `domain`, `envelope`, `inputSchema`, `budget`, `nodes`, `acceptance`, `labels`, `discovery`, `segregation`, `state`, `defaultClass`, `oracle`, `metadata`;
required: `schemaVersion`, `id`, `version`, `title`, `goal`, `domain`, `envelope`, `budget`, `nodes`, `acceptance`.

Every node needs `id`, `kind`, `needs`, `description`. Node kinds and the fields each kind requires:

| kind | requires |
|---|---|
| `task` | `tool`, `args`, `timeoutMs`, `retry` |
| `assert` | `checks` |
| `human` | `question`, `answerSchema` |
| `map` | `items`, `maxItems`, `body` |
| `loop` | `maxIterations`, `body`, `until`, `initial` |
| `wait` | (none beyond the common fields) |
| `agent` | `instructions`, `returns`, `model` |
| `code` | `lang`, `source` |
| `verify` | `method`, `subject`, `independence`; plus by `method`: code → `lang`, `source`; agent → `instructions`, `model`; capability → `tool`, `args`; ledger → `ledger` |
| `state` | `slot`, `op`, `key` |

Enumerated fields:

- `role`: classify | route | extract | judge | generate | synthesis | code_edit | plan | verify
- `method`: code | agent | capability | ledger
- `independence`: execution | different-model | same-model
- `failure`: fail_fast | collect
- `onError`: stop | continue
- `lang`: js | python
- `op`: get | put | add | incr | delete
- `model`: { class | id, maxClass?, justification? } (class names come from policy/models.json classOrder)
- condition `op`: eq | ne | gt | gte | lt | lte | in | contains | exists | all | any | not

Limits the validator enforces:

- `map.maxItems` <= 1000; `budget.maxConcurrency` <= 16; `budget.maxSteps` <= 100000; `budget.maxDurationMs` <= 2592000000
- `loop.maxIterations` <= 1000; `code.source` <= 262144 characters
- `budget` fields: `maxSteps`, `maxConcurrency`, `maxDurationMs`, `maxCost`, `maxTokens`; required: `maxSteps`, `maxConcurrency`, `maxDurationMs`

Approvals (human nodes):

- A `human` node may name a `principal` { `role`, `threshold` }: the role (from the host's role matrix) that may answer it. A `threshold` { `amount`, `above`, `role` } routes answers whose `amount` is above `above` to another role. Only human nodes take a principal.
- Top-level `segregation` (at most 50 groups) lists 2–10 human nodes whose answerers must be pairwise distinct in one run (segregation of duties: requester ≠ approver).

References and runtime contracts (from src/runtime.mjs and src/sandbox.mjs):

- Values are referenced as `{"$ref": "input.<field>"}`, `{"$ref": "nodes.<id>.<field>"}`, and inside a map body `{"$ref": "item.<field>"}`.
- A `map` outputs `{ items, count, failed? }`; `items[i]` holds the body's node outputs; a failed item is `{ "$error": … }`; `failed` exists only with `failure: "collect"`.
- A `code` node runs `export default function main(input)` in a sandbox (no network, PATH only), with `input` = its resolved `args`; `returns` validates the result.
- A `verify` with `method: "code"` receives `main({ subject })`, `subject` being its resolved `subject` (an object of refs is allowed); it returns `{ pass, … }`. Code and capability verifiers have `independence: "execution"`.
- `agent` nodes take `instructions`, typed `returns`, `model`, optional `role`, `context.inputs` (`{ name, ref }`) and `escalation`.
- A `verify` with `method: "ledger"` takes `ledger` { `inventory`, `reads`, `maxReads`, `allowEmpty` }: `inventory` references the unit ids code listed, `reads` is the dotted path to each item's read ids. It passes only if every unit is read, none more than `maxReads` times (default 1), no read names a unit outside the inventory and no item failed; its output adds `ledger` { units, covered, missing, missingIds, overRead, unknown, failedItems, … } and `score` is the covered share.
