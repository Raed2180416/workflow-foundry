import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Foundry } from '../../../workflow-foundry/src/foundry.mjs';

export const study = path.dirname(fileURLToPath(import.meta.url));
export const sample = { record: { label: 'requested', active: true } };
export const task = 'Write record.json containing exactly the record supplied in the input.';
export function workflow(version = 1, correct = false) {
  return {
    schemaVersion: '1.0', id: 'outcome-repair-witness', version,
    title: 'Supplied JSON outcome repair control', goal: task, domain: 'software',
    envelope: {
      assumptions: ['A bounded local JSON artifact is the requested result.'],
      risks: ['Existing bytes can contain incorrect data.'],
      successCriteria: [task], unsupported: ['External effects and general intent inference']
    },
    inputSchema: { type: 'object', required: ['record'], properties: { record: { type: 'object' } }, additionalProperties: false },
    budget: { maxSteps: 5, maxConcurrency: 1, maxDurationMs: 10000, maxCost: 0 },
    nodes: [
      { id: 'encode', kind: 'task', needs: [], description: 'Serialize the chosen record.', tool: 'core.json',
        args: { value: correct ? { $ref: 'input.record' } : { label: 'wrong', active: false } }, timeoutMs: 1000, retry: { maxAttempts: 1 } },
      { id: 'file', kind: 'task', needs: ['encode'], description: 'Write the run artifact.', tool: 'core.artifact',
        args: { name: 'record.json', content: { $ref: 'nodes.encode.text' } }, timeoutMs: 1000, retry: { maxAttempts: 1 } }
    ],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.file.sha256' } }]
  };
}
export function artifact(foundry, runId) { return path.join(foundry.store.directory, 'artifacts', runId, 'record.json'); }
export function writeEvidence(file, value) { writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }

export async function witness() {
  mkdirSync(path.join(study, 'artifacts'), { recursive: true });
  const workspace = mkdtempSync(path.join(study, 'artifacts', 'legacy-witness-'));
  const foundry = new Foundry(workspace);
  try {
    const request = foundry.store.createRequest({ text: task });
    const proposal = foundry.propose({ requestId: request.id, workflow: workflow(), rationale: 'Supplied deliberately incorrect workflow; development witness.' });
    foundry.apply(proposal.id);
    const run = await foundry.startRun(foundry.createRun(proposal.workflow.id, sample).id);
    const bytes = readFileSync(artifact(foundry, run.id));
    assert.equal(run.status, 'succeeded');
    assert.notDeepEqual(JSON.parse(bytes), sample.record);
    let legacyError;
    try { foundry.requestRepair({ requestId: request.id, failedRunId: run.id, expectedHash: proposal.workflowHash }); }
    catch (error) { legacyError = { code: error.code, message: error.message }; }
    assert.equal(legacyError?.code, 'REPAIR_RUN_STATE');
    const result = {
      qualification: 'Supplied deterministic development witness; no model calls.', workspace,
      requestId: request.id, proposalId: proposal.id, runId: run.id,
      workflowHash: proposal.workflowHash, runStatus: run.status, eventHead: run.eventHead,
      expected: sample.record, actual: JSON.parse(bytes), independentlySatisfied: false,
      artifactPath: artifact(foundry, run.id), artifactSha256: createHash('sha256').update(bytes).digest('hex'), legacyError
    };
    writeEvidence(path.join(workspace, 'witness.json'), result);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally { await foundry.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await witness();
