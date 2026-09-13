#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Foundry, parseCandidate } from '../src/foundry.mjs';
import { WorkflowGenerator } from '../src/generator.mjs';
import { OpenCodeFreeProvider } from '../src/opencode-free.mjs';
import { evaluateWorkflow, suiteEvaluator } from '../src/evaluation.mjs';
import { digest, errorData } from '../src/data.mjs';

// User-authorized bounded research demonstration. Real free model responses only;
// no candidate source edits, no paid fallback, no hidden TUI/commercial claim.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.join(root, '.foundry/live-demo');
const receipts = path.join(root, '.foundry/verification/product-demo');
mkdirSync(receipts, { recursive: true, mode: 0o700 });
const foundry = new Foundry(workspace);
const write = (name, value) => writeFileSync(path.join(receipts, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const report = { startedAt: new Date().toISOString(), protocol: 'docs/PRODUCT-DEMO-PROTOCOL.md', mode: 'noninteractive-real-model-development', stages: [], passed: false };
try {
  const suite = JSON.parse(readFileSync(path.join(root, 'examples/batch-suite.json'), 'utf8'));
  const prior = foundry.store.generationJobs().find(job => job.status === 'failed' && job.attempts.some(attempt => attempt.assessment?.evaluation));
  if (!prior) throw new Error('Expected an existing preserved failed development job; refusing to manufacture prior evidence');
  const priorRound = prior.attempts.findLast(attempt => attempt.assessment?.evaluation)?.round;
  const raw = JSON.parse(readFileSync(path.join(foundry.store.directory, 'generation', prior.id, String(priorRound).padStart(2, '0'), 'response.json'), 'utf8'));
  const previous = parseCandidate(raw.text);
  const rescored = await evaluateWorkflow(previous.workflow, suite, { directory: path.join(receipts, 'prior-current-rescore') });
  write('prior-current-rescore.json', rescored);
  const request = foundry.store.createRequest({
    text: `${readFileSync(path.join(root, 'examples/batch-task.md'), 'utf8')}\n\nDevelopment continuation. The prior unmodified candidate below failed actual cases. Use the current native skill and the concrete runError/failedNodes evidence to repair it; do not weaken the task or oracle.\n${JSON.stringify({ candidate: previous.workflow, evidence: rescored }, null, 2)}`,
    source: 'user-authorized-diagnostic-continuation'
  });
  const provider = new OpenCodeFreeProvider({ model: 'opencode/ling-3.0-flash-fin-free' });
  const generator = new WorkflowGenerator(foundry, provider, { maxRounds: 3, maxDurationMs: 300000, autoApply: true, evaluator: suiteEvaluator(suite) });
  const constructed = await generator.generate(request.id, { domain: 'software' });
  write('construction-job.json', constructed);
  report.stages.push({ kind: 'construction-continuation', priorJobId: prior.id, jobId: constructed.id, status: constructed.status, attempts: constructed.attempts.map(a => ({ round: a.round, status: a.status, metrics: a.assessment?.evaluation?.metrics ?? null, error: a.error ?? null })) });
  if (constructed.status !== 'applied') throw new Error('Continuation did not meet its independent diagnostic criteria');
  const original = foundry.store.workflow(constructed.workflowHash);
  const run = foundry.createRun(original.hash, { batches: [[1, 2], [3, 4]] });
  const originalRun = await foundry.startRun(run.id);
  if (originalRun.status !== 'succeeded') throw new Error('Qualified workflow failed its independently repeated local demo run');
  write('original-run.json', foundry.inspectRun(run.id));
  const revisedSuite = structuredClone(suite);
  revisedSuite.id = 'batch-summary-with-totals-diagnostic-v2';
  revisedSuite.task += ' Also include batchTotals, preserving each input batch order, in summary.json.';
  for (const item of revisedSuite.cases) {
    const artifact = item.expect.artifacts?.find(a => a.name === 'summary.json' && a.json);
    if (artifact) artifact.json.batchTotals = item.input.batches.map(batch => batch.reduce((sum, value) => sum + value, 0));
  }
  write('revision-suite-frozen.json', revisedSuite);
  const edit = foundry.store.createRequest({
    workflowId: original.workflow.id, baseHash: original.hash,
    text: 'Add an ordered batchTotals array to summary.json, containing the sum of each input batch in the original input order. Keep batchCount and grandTotal, preserve every input bound and malformed-input rejection, and retain maxSteps 150, maxConcurrency 2, maxDurationMs 60000, maxCost 0. Create the next version without migrating or altering existing runs. Use the actual native output contracts and independently check the new artifact contents.',
    source: 'user-authorized-natural-language-revision-demo'
  });
  const editor = new WorkflowGenerator(foundry, provider, { maxRounds: 3, maxDurationMs: 300000, autoApply: true, evaluator: suiteEvaluator(revisedSuite) });
  const revised = await editor.generate(edit.id, { domain: 'software' });
  write('revision-job.json', revised);
  report.stages.push({ kind: 'natural-language-revision', jobId: revised.id, status: revised.status, suiteHash: digest(revisedSuite), attempts: revised.attempts.map(a => ({ round: a.round, status: a.status, metrics: a.assessment?.evaluation?.metrics ?? null, error: a.error ?? null })) });
  if (revised.status !== 'applied') throw new Error('Natural-language revision did not meet its independent diagnostic criteria');
  const newHead = foundry.store.workflow(original.workflow.id);
  const historical = foundry.store.workflow(original.hash);
  const priorRun = foundry.store.run(run.id);
  if (newHead.workflow.version !== historical.workflow.version + 1 || priorRun.workflowHash !== original.hash) throw new Error('Version/CAS/history invariant failed');
  const newRun = foundry.createRun(newHead.hash, { batches: [[-2, 1], [7]] });
  const completed = await foundry.startRun(newRun.id);
  if (completed.status !== 'succeeded') throw new Error('Revised workflow did not complete its live demo input');
  write('revised-run.json', foundry.inspectRun(newRun.id));
  report.passed = true;
  report.workflow = { id: original.workflow.id, oldHash: original.hash, newHash: newHead.hash, oldRunId: run.id, newRunId: newRun.id, oldRunHashPreserved: true };
} catch (error) { report.error = errorData(error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  write('result.json', report); await foundry.close();
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
