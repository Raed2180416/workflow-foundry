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

## Inspect a historical outcome

`inspectOutcomeHistory` rechecks a retained observation even when the current
capability registry has changed. It reads existing database records and preserved
artifact bytes. It creates no schema, writes no records, invokes no provider, and
does not probe the live artifact directory.

```js
import { inspectOutcomeHistory } from './src/outcome-history.mjs';

const history = inspectOutcomeHistory(foundry.store, {
  receiptId: recordedObservation.id,
  currentRegistryHash: foundry.registry.hash()
});
console.log(history.historicalAssessment);
console.log(history.currentEvidenceCheck);
// Always false, including when the historical assessment is satisfied:
console.log(history.currentWorldQualification);
```

The function also accepts `{ db }` backed by an already-open read-only SQLite
connection. Only `db.prepare(...).get/all` SELECT operations are used. The caller
owns the connection and can use a read transaction for a consistent concurrent
snapshot. Inspection does not automatically persist its report.

The explicit CLI command reads an existing workspace:

```sh
node bin/foundry.mjs outcome-history --receipt "$RECEIPT_ID" --workspace "$WORKSPACE"
```

This route opens read-only SQLite with `query_only` in a read transaction before
component loading or Foundry/Store initialization. It creates no workspace,
schema, ledger entry, or artifact. Ordinary SQLite WAL reader machinery may still
be used. Component, provider, execution, and promotion options are rejected.
The CLI supplies the hash of the built-in capability catalog only; it loads no
external component to reconstruct a current registry. This comparison remains
metadata with `currentWorldQualification: false`.

For `present` artifacts, the inspector independently decodes the preserved bytes,
checks every completed producer, and repeats the pinned `exact-json-artifact/2`
comparison. Object key order is ignored; array order is retained. Invalid or
unsupported JSON remains unsatisfied. The frozen host expectation is not certified
as independently correct.

For recorded absence or an unavailable observer, `historicalAssessment.basis` is
`recorded-observer-evidence-only`. This checks the recorded evidence's consistency;
it does not repeat the old physical observation. Missing bytes after a completed
producer remain unknown. A missing run directory after a producer wrote a different
filename also remains unknown. Confirmed absence at an accessible required path
remains the recorded unsatisfied outcome. Later live file changes never upgrade
these historical results.

The inspector checks the raw contract and receipt hashes, ledger keys, complete
request/proposal/root lineage, immutable workflow, historical run/input/registry/
policy/engine bindings, full event chain, and all completed artifact producers.
Every ancestor proposal must match its parent request's base hash. Each ancestor
repair's goal and success criteria must match its own applied proposal as well.
Only the frozen observer source `8de15af4…924f1fd`, data source
`50049ae8…4e7680c`, and the receipt's exact Node version are supported. Local source
identities are captured at module load. Other evaluator versions fail closed.
Bounds are 512 KiB per artifact/expectation, 100,000 events, 32 MiB of event JSON,
16 MiB per stored JSON record, and ten parent links.

`currentEvidenceCheck.status` is always `unverified`. Its registry comparison uses
the **caller-supplied** current hash and establishes no capability compatibility,
current artifact condition, execution authority, or policy compliance. The new
`outcome-history:<hash>` ID cannot be used as an outcome receipt or repair permit.
Existing repair and promotion checks stay in effect, including registry mismatch
refusals. Cross-world repair needs a separate explicit lineage and fresh qualification.

The database, source loader, and host remain trusted. Integrity hashes do not prove
that a privileged administrator never forged all records consistently. Missing or
changed historical records cause refusal; the inspector does not reconstruct them
from the current world.
