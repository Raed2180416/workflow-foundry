# Repair an observed JSON outcome

A run can report `succeeded` while its output is wrong. The outcome commands compare
one required local JSON artifact against a frozen host-supplied expectation and
create an explicit repair request when the observed outcome is `unsatisfied`.
Registration records the expectation's provenance; it does not establish that the
expectation is independently correct. This checks bounded JSON content, not general
business intent. Supply only expectations that may be disclosed as repair feedback.

## Runnable offline example

Run from the checkout root with Node 24 or later and `jq`. This deliberately writes
the wrong record, then applies a supplied version-2 candidate. All calls are local;
the example does not invoke a model. Its temporary workspace retains the evidence.

```bash
set -eu
workspace="$(mktemp -d)"
foundry() { node bin/foundry.mjs --workspace "$workspace" "$@"; }

node - "$workspace" <<'NODE'
const fs = require('node:fs'), path = require('node:path');
const directory = process.argv[2];
const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value), { flag: 'wx' });
const goal = 'Write record.json containing exactly input.record.';
const workflow = {
  schemaVersion: '1.0', id: 'outcome-example', version: 1,
  title: 'Supplied outcome example', goal, domain: 'software',
  envelope: { assumptions: ['One local JSON artifact is sufficient.'], risks: ['Wrong content.'],
    successCriteria: [goal], unsupported: ['General intent inference'] },
  inputSchema: { type: 'object', required: ['record'], properties: { record: { type: 'object' } }, additionalProperties: false },
  budget: { maxSteps: 5, maxConcurrency: 1, maxDurationMs: 10000, maxCost: 0 },
  nodes: [
    { id: 'encode', kind: 'task', needs: [], description: 'Encode record.', tool: 'core.json',
      args: { value: { label: 'wrong' } }, timeoutMs: 1000, retry: { maxAttempts: 1 } },
    { id: 'file', kind: 'task', needs: ['encode'], description: 'Write artifact.', tool: 'core.artifact',
      args: { name: 'record.json', content: { $ref: 'nodes.encode.text' } }, timeoutMs: 1000, retry: { maxAttempts: 1 } }
  ], acceptance: [{ op: 'exists', value: { $ref: 'nodes.file.sha256' } }]
};
save('input.json', { record: { label: 'requested' } });
save('expected.json', { label: 'requested' });
save('v1.json', { workflow, rationale: 'Supplied deliberately incorrect development control.' });
workflow.version = 2;
workflow.nodes[0].args.value = { $ref: 'input.record' };
save('v2.json', { workflow, rationale: 'Supplied repair: serialize the actual input record.' });
NODE

request="$(foundry request --text 'Write record.json containing exactly input.record.' | jq -r .id)"
contract="$(foundry outcome-contract --request "$request" --input "$workspace/input.json" \
  --artifact-name record.json --expected "$workspace/expected.json" --evaluator-id host-example-v1 | jq -r .id)"
foundry propose "$workspace/v1.json" --request "$request" > "$workspace/proposal-v1.json"
proposal="$(jq -r .id "$workspace/proposal-v1.json")"
base="$(jq -r .workflowHash "$workspace/proposal-v1.json")"
foundry apply "$proposal" > "$workspace/applied-v1.json"
foundry run outcome-example --input "$workspace/input.json" > "$workspace/run-v1.json"
run="$(jq -r .id "$workspace/run-v1.json")"
foundry outcome-observe "$run" --request "$request" --proposal "$proposal" --contract "$contract" > "$workspace/observed-v1.json"
jq -e '.outcome == "unsatisfied"' "$workspace/observed-v1.json" > /dev/null
receipt="$(jq -r .id "$workspace/observed-v1.json")"
repair="$(foundry outcome-repair-request --receipt "$receipt" --request "$request" --run "$run" \
  --expected-hash "$base" --diagnostic 'Repair the source of record.json.' | jq -r .id)"
foundry outcome-context --request "$repair" --no-skills > "$workspace/repair-context.json"
foundry outcome-propose "$workspace/v2.json" --request "$repair" > "$workspace/proposal-v2.json"
next="$(jq -r .id "$workspace/proposal-v2.json")"
foundry outcome-apply "$next" > "$workspace/applied-v2.json"
foundry run outcome-example --input "$workspace/input.json" > "$workspace/run-v2.json"
next_run="$(jq -r .id "$workspace/run-v2.json")"
foundry outcome-observe "$next_run" --request "$repair" --proposal "$next" --contract "$contract" > "$workspace/observed-v2.json"
jq -e '.outcome == "satisfied"' "$workspace/observed-v2.json"
printf 'Evidence directory: %s\n' "$workspace"
```

`outcome-context` emits JSON containing the original task, current workflow,
preserved expected/observed values, and bounded field differences marked as data.
Use `--no-skills` to omit skill bodies. `outcome-propose` accepts a workflow JSON
file with `--rationale TEXT`, or a `{ "workflow": ..., "rationale": ... }` candidate.
The request keeps its goal, success criteria, parent and root; apply rechecks the
receipt and the current workflow hash. The old run and artifact remain retained.

## Interpretation and refusals

`outcome-observe` exits zero when it records or verifies a receipt, including
`unsatisfied` or `unknown`. Read its `outcome` field; exit status alone is not task
success. Invalid arguments or rejected operations exit one with a JSON error on
stderr. `outcome-repair-request` accepts only `unsatisfied` and has an optional
`--max-depth` of 1–10, default 3. Repeated observations and repair requests reuse
their existing IDs.

Confirmed required-file absence with no completed producer is `unsatisfied`.
Missing bytes after a recorded producer, or an unavailable observer, are `unknown`
and cannot authorize repair. Tampered evidence, stale versions, cross-run receipts,
changed goals and changed frozen expectations are rejected. Contracts are reused
across repair descendants with the same root/input/artifact scope and cannot be
replaced. Rechecking live evidence may reject a historical receipt whose underlying
files changed; the saved receipt remains historical evidence.

Ordinary `propose`, `apply`, `prompt`, and `generate` reject outcome-repair records
with `OUTCOME_CLI_ROUTE`. Use the explicit outcome commands so evidence is checked.
Ordinary requests retain their original routes. These CLI checks operate within the
trusted host boundary; they do not restrict a database administrator or direct
library calls outside the coordinator.

## Explicit model generation

An authorized host may instead request a model proposal with:

```sh
node bin/foundry.mjs generate --workspace "$workspace" --outcome-repair \
  --request "$repair" --agent opencode-v2-free --model opencode/big-pickle --rounds 1
```

This is a deliberate provider call and was not used by the offline example. The
existing `opencode-free` route also supports the facade with an explicitly selected
model. Availability and free-tier checks remain the provider's responsibility.
`--outcome-repair` requires an existing repair request and rejects a replacement
task, workflow, or `--auto-apply`. Apply separately with `outcome-apply`, then execute
and observe a new run. Contract, observation, context and repair commands never
dispatch a provider or execute a workflow.
