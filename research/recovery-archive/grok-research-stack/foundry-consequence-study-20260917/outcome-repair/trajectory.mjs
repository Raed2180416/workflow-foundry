import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Foundry } from '../../../workflow-foundry/src/foundry.mjs';
import { OutcomeRepairCoordinator } from '../../../workflow-foundry/src/outcome-repair.mjs';
import { workflow, sample, task, study } from './witness.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (target, value) => writeFileSync(target, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

export async function trajectory() {
  mkdirSync(path.join(study, 'artifacts'), { recursive: true });
  const output = mkdtempSync(path.join(study, 'artifacts', 'trajectory-v2-'));
  const results = [];
  for (const defect of ['wrong-content', 'wrong-filename']) {
    const directory = path.join(output, defect);
    mkdirSync(directory);
    const foundry = new Foundry(path.join(directory, 'workspace'));
    try {
      const outcomes = new OutcomeRepairCoordinator(foundry);
      const request = foundry.store.createRequest({ text: task });
      const contract = outcomes.registerContract({ requestId: request.id, input: sample,
        artifactName: 'record.json', expected: sample.record, evaluatorId: 'supplied-development-record-v2' });
      const wrong = workflow(1, defect === 'wrong-filename');
      if (defect === 'wrong-filename') wrong.nodes.find(node => node.tool === 'core.artifact').args.name = 'different.json';
      const initialProposal = foundry.propose({ requestId: request.id, workflow: wrong, rationale: `Supplied development ${defect} control; zero model calls.` });
      foundry.apply(initialProposal.id);
      const initialRun = await foundry.startRun(foundry.createRun(wrong.id, sample).id);
      assert.equal(initialRun.status, 'succeeded');
      const originalName = defect === 'wrong-filename' ? 'different.json' : 'record.json';
      const originalPath = path.join(foundry.store.directory, 'artifacts', initialRun.id, originalName);
      const originalBytes = readFileSync(originalPath);
      let legacyError;
      try { foundry.requestRepair({ requestId: request.id, failedRunId: initialRun.id, expectedHash: initialProposal.workflowHash }); }
      catch (error) { legacyError = { code: error.code, message: error.message }; }
      assert.equal(legacyError?.code, 'REPAIR_RUN_STATE');
      const observation = outcomes.observe({ requestId: request.id, proposalId: initialProposal.id, runId: initialRun.id, contractId: contract.id });
      assert.equal(observation.outcome, 'unsatisfied');
      const repair = outcomes.requestRepair({ requestId: request.id, runId: initialRun.id,
        receiptId: observation.id, expectedHash: initialProposal.workflowHash,
        diagnostic: 'Repair the defect evidenced by the frozen local JSON comparison.' });
      const context = outcomes.designContext({ requestId: repair.id, includeSkills: false });
      assert.deepEqual(context.outcomeRepair.comparison.expected.value, sample.record);
      if (defect === 'wrong-content') assert.equal(context.outcomeRepair.comparison.observed.value.label, 'wrong');
      else assert.equal(context.outcomeRepair.comparison.observed.state, 'absent');
      assert.equal(foundry.store.generationJobs().length, 0);
      const repairedProposal = outcomes.propose({ requestId: repair.id, workflow: workflow(2, true),
        rationale: 'Supplied development fix: serialize the input record and write the required basename.' });
      outcomes.apply(repairedProposal.id);
      const repairedRun = await foundry.startRun(foundry.createRun(wrong.id, sample).id);
      const repairedObservation = outcomes.observe({ requestId: repair.id, proposalId: repairedProposal.id,
        runId: repairedRun.id, contractId: contract.id });
      const repairedPath = path.join(foundry.store.directory, 'artifacts', repairedRun.id, 'record.json');
      const repairedBytes = readFileSync(repairedPath);
      assert.equal(repairedRun.status, 'succeeded'); assert.equal(repairedObservation.outcome, 'satisfied');
      assert.deepEqual(JSON.parse(repairedBytes), sample.record);
      assert.deepEqual(readFileSync(originalPath), originalBytes);
      assert.deepEqual(foundry.store.run(initialRun.id), initialRun);
      assert.equal(outcomes.verify(observation.id).id, observation.id);
      assert.equal(outcomes.verify(repairedObservation.id).id, repairedObservation.id);
      assert.equal(repair.rootRequestId, request.id); assert.equal(repair.parentRequestId, request.id);
      for (const [name, value] of Object.entries({ contract, initialRequest: foundry.store.request(request.id),
        initialProposal: foundry.store.proposal(initialProposal.id), initialRun, observation, repairRequest: repair,
        context, repairedProposal: foundry.store.proposal(repairedProposal.id), repairedRun, repairedObservation,
        initialEvents: foundry.store.events(initialRun.id), repairedEvents: foundry.store.events(repairedRun.id) })) {
        save(path.join(directory, `${name}.json`), value);
      }
      const result = { defect, legacyError, initialRunId: initialRun.id, initialStatus: initialRun.status,
        initialObservation: observation.outcome, reason: observation.reason, contractId: contract.id,
        receiptId: observation.id, repairRequestId: repair.id, repairedProposalId: repairedProposal.id,
        repairedRunId: repairedRun.id, repairedStatus: repairedRun.status,
        repairedObservation: repairedObservation.outcome, repairedReceiptId: repairedObservation.id,
        originalPath, originalSha256: hash(originalBytes), originalBytesRetained: true,
        repairedPath, repairedSha256: hash(repairedBytes), parentAndRootPreserved: true,
        workflowVersion: foundry.store.workflow(wrong.id).workflow.version,
        generationJobs: foundry.store.generationJobs().length };
      save(path.join(directory, 'RESULT.json'), result); results.push(result);
    } finally { await foundry.close(); }
  }
  const result = { qualification: 'Supplied development controls executed through the actual Foundry runtime; no model calls, hidden suites, or general intent proof.',
    output, passed: true, modelCalls: 0, automaticDispatches: 0,
    sourceSha256: hash(readFileSync(new URL('../../../workflow-foundry/src/outcome-repair.mjs', import.meta.url))), results };
  save(path.join(output, 'RESULT.json'), result);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await trajectory();
