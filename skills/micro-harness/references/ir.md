# Foundry IR quick reference (schemaVersion "1.0")

Top level: `schemaVersion, id, version (int), title, goal, domain, envelope {assumptions, risks,
successCriteria (non-empty)}, budget {maxSteps, maxConcurrency (≤16), maxDurationMs, maxCost},
inputSchema?, labels? {"input.<field>": "untrusted:<src>"}, nodes, acceptance (non-empty, must
reference runtime values)`. Every node: `id, kind, needs (ids it depends on), description`, optional
`when` (condition), `join` (`all_success` default | `all_resolved`).

`acceptance` (top level and in map/loop bodies) is a list of conditions (below), e.g.
`[{"op":"exists","value":{"$ref":"nodes.answer.items"}}]`, never strings.

Branches: a node whose `when` is false is `skipped`. With the default `join: all_success` every node
that needs a skipped (or failed) node is skipped too (an `answer` skipped this way leaves the run
"succeeded" with no answer); a node that merges branches needs
`"join":"all_resolved"`, and each `$ref` into a possibly skipped node needs a `"default"`
(`{"$ref":"nodes.b.x","default":null}`), else it fails with MISSING_REFERENCE.

References: `{"$ref": "input.inputs.export"}`, `{"$ref": "nodes.<id>.<field>"}`; inside a map body
`item`, `index`; inside agent `checks` also `output`. A ref may only name nodes listed (transitively)
in `needs`. Conditions: `{op: eq|ne|gt|gte|lt|lte|in|contains, left, right}`, `{op: exists, value}`,
`{op: all|any, conditions}`, `{op: not, condition}`.

## code
`{"kind":"code","lang":"js"|"python","source":"...","args":{...},"returns"?: schema,"timeoutMs"}`
JS: `export default function main(input) { return {...}; }` (may be async). Python: `def main(input): return {...}`.
Pure: no network, no files, no environment; input = resolved `args`; output must be JSON.

## agent
`role`: one of classify, route, extract, judge, generate, synthesis, code_edit, plan, verify.
```json
{"kind":"agent","role":"extract","instructions":"...",
 "context":{"inputs":[{"name":"rows","ref":"item.lines","label":"untrusted:data","render":"text"}],
            "budget":{"maxInputTokens":6000,"onOverflow":"fail"}},
 "returns":{"type":"object","properties":{...},"required":[...],"additionalProperties":false},
 "model":{"class":"S","maxClass":"L"},"decoding":{"reasoning":"none","maxTokens":2000},
 "checks":[{"op":"eq","left":{"$ref":"output.ids"},"right":{"$ref":"item.ids"}}],
 "escalation":{"schemaRetries":1,"onCheckFail":"escalate","maxEscalations":2},
 "quarantined": false, "timeoutMs":300000}
```
`returns` uses a portable JSON Schema subset: type, properties, required, additionalProperties,
items, enum, const, minimum, maximum, minItems, maxItems, minLength, maxLength, description.
No pattern, oneOf/anyOf/allOf, $ref, format. The node's output is the parsed value.

## verify
`{"kind":"verify","method":"code","lang":"js","source":"... main({subject}) → {pass, score, reasons}",
 "subject":{"$ref":"nodes.x"},"independence":"execution","gate":false,"timeoutMs":20000}`
(`method: agent` uses `instructions/context/model` and needs `independence: different-model|same-model`.)

## map
`{"kind":"map","items":{"$ref":"nodes.split.batches"},"maxItems":200,"concurrency":4,
  "failure":"collect","body":{"nodes":[...],"acceptance":[...]}}` → output `{items:[{<bodyNodeId>: output}|{$error}], count, failed}` ordered by index.

## loop
`{"kind":"loop","maxIterations":5,"initial":{...},"until":{condition over nodes of the body},"body":{...}}`
Inside the body: `iteration`, `previous`.

## CLI
`foundry validate workflow.json` · `foundry run workflow.json --input '<json>' --workspace W --max-cost 1`
· `foundry calls --run <id> --workspace W` (every model call with cost) · run record: `foundry inspect <id> --workspace W`.
