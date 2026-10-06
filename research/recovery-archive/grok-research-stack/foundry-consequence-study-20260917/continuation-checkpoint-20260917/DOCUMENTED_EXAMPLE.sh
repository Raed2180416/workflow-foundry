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
