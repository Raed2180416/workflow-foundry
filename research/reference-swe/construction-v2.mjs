import assert from 'node:assert/strict';
import path from 'node:path';
import { Foundry } from '../../src/foundry.mjs';
import { digest } from '../../src/data.mjs';
import { Trial, makeRegistry, architectureErrors, initialMessages, writeNew } from './harness.mjs';

// Neutral scripts exercise only protocol control flow; no coding-task answers.
export const TRANSCRIPTS = [
  { id: 'finish-now', responses: ['{"op":"finish"}'], calls: 1, submitted: true },
  { id: 'multiple-turns', responses: ['{"op":"read"}', '{"op":"read"}', '{"op":"finish"}'], calls: 3, submitted: true },
  { id: 'format-feedback', responses: ['{"op":"unknown"}', '{"op":"read"}', '{"op":"finish"}'], calls: 3, submitted: true },
  { id: 'finish-fifth', responses: [...Array(4).fill('{"op":"read"}'), '{"op":"finish"}'], calls: 5, submitted: true },
  { id: 'exhaustion', responses: Array(5).fill('{"op":"read"}'), calls: 5, submitted: false }
];
const NEUTRAL = { id: 'protocol-only', fn: 'unused', description: 'Neutral protocol transcript; no coding task is assessed.', source: '# inert neutral transcript\n', public: [], hidden: [] };

export async function constructionGate(workflow, directory, { signal } = {}) {
  const report = { status: 'partial', evaluatorId: 'reference-neutral-construction-v2',
    workflowHash: digest(workflow), constructionPassed: false, deploymentQualified: false,
    taskQualified: false, actualModelCalls: 0, envelope: 'Scripted neutral message handoff and stopping only', errors: [], cases: [] };
  try { report.errors.push(...architectureErrors(workflow)); }
  catch (error) { report.errors.push(`Malformed graph: ${error.message}`); }
  if (!report.errors.length) for (const scenario of TRANSCRIPTS) {
    if (signal?.aborted) { report.errors.push('Construction evaluation cancelled'); break; }
    const responses = [...scenario.responses];
    const provider = { identity: { provider: 'scripted-conformance-only', model: 'no-model-called' },
      generate: async () => {
        if (!responses.length) throw Error('CONFORMANCE_UNEXPECTED_QUERY');
        return { text: responses.shift(), evidence: { conformanceOnly: true } };
      } };
    const dir = path.join(directory, scenario.id);
    const trial = new Trial(NEUTRAL, path.join(dir, 'trial'), provider);
    const registry = makeRegistry(() => trial);
    const foundry = new Foundry(path.join(dir, 'foundry'), { registry, policy: { maxSteps: 20, maxConcurrency: 1, maxDurationMs: 10000, maxCost: 0 } });
    report.registryHash ??= registry.hash();
    let execution, error = null, passed = false;
    try {
      foundry.save(workflow);
      const run = foundry.createRun(workflow.id, { messages: initialMessages(NEUTRAL) });
      execution = await foundry.startRun(run.id, { signal });
      writeNew(path.join(dir, 'native-run.json'), foundry.inspectRun(run.id));
      assert.equal(trial.calls, scenario.calls, 'Unexpected query count');
      assert.equal(trial.operations, scenario.calls, 'Each query must dispatch exactly one operation');
      assert.equal(trial.done, scenario.submitted, 'Unexpected submission');
      assert.equal(execution.status, scenario.submitted ? 'succeeded' : 'failed', 'Unexpected run completion');
      if (!scenario.submitted) assert.equal(execution.error?.code, 'LOOP_EXHAUSTED');
      assert.equal(responses.length, 0, 'Workflow stopped before consuming required observations');
      assert.equal(trial.messages.length, 2 + 2 * scenario.calls, 'History lost a message');
      if (scenario.id === 'format-feedback') assert.match(trial.messages[3].content, /error/);
      passed = true;
    } catch (caught) { error = { code: caught.code ?? null, message: caught.message }; }
    finally { await foundry.close(); }
    report.cases.push({ id: scenario.id, passed, calls: trial.calls, operations: trial.operations,
      submitted: trial.done, status: execution?.status ?? 'rejected', error,
      runtimeError: execution?.error ?? null, expected: { calls: scenario.calls, submitted: scenario.submitted } });
  }
  report.constructionPassed = !report.errors.length && report.cases.length === TRANSCRIPTS.length && report.cases.every(x => x.passed);
  writeNew(path.join(directory, 'construction.json'), report);
  return report;
}

// Mutation controls are copies used only to challenge the evaluator. Never replace
// the actual model candidate with these graphs or count them as model proposals.
export function constructionMutations(workflow) {
  const mutate = (id, change) => { const copy = structuredClone(workflow); change(copy); return { id, workflow: copy }; };
  const body = w => w.nodes[0].body.nodes;
  const query = w => body(w).find(n => n.tool === 'reference.query');
  const act = w => body(w).find(n => n.tool === 'reference.act');
  return [
    mutate('action-drops-assistant', w => { act(w).args.messages = structuredClone(query(w).args.messages); }),
    mutate('recurrence-drops-observation', w => { query(w).args.messages = { $ref: `previous.${query(w).id}.messages`, default: [] }; }),
    mutate('initial-drops-wrapper', w => { w.nodes[0].initial = { messages: { $ref: 'input.messages' } }; }),
    mutate('root-drops-wrapper', w => { w.acceptance = [{ op: 'eq', left: { $ref: `nodes.${w.nodes[0].id}.last.done` }, right: true }]; }),
    mutate('premature-stop', w => { w.nodes[0].until = { op: 'exists', value: { $ref: `nodes.${act(w).id}.done` } }; }),
    mutate('ignores-finish', w => { w.nodes[0].until = { op: 'eq', left: { $ref: 'iteration' }, right: 4 }; })
  ];
}

export async function challengeGate(workflow, directory, options = {}) {
  const mutations = [];
  for (const mutation of constructionMutations(workflow)) {
    const report = await constructionGate(mutation.workflow, path.join(directory, mutation.id), options);
    mutations.push({ id: mutation.id, rejected: !report.constructionPassed, workflowHash: report.workflowHash,
      failedCases: report.cases.filter(c => !c.passed).map(c => c.id), errors: report.errors });
  }
  const result = { status: 'partial', deploymentQualified: false, taskQualified: false,
    evaluatorSoundOnMutations: mutations.every(m => m.rejected), mutations };
  writeNew(path.join(directory, 'mutations.json'), result);
  return result;
}
