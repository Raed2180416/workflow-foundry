// Phase 1 exit experiment (pre-registered in research/core-20261006/PREREG.md). Frozen: its sha256 is
// recorded in the pre-registration; any change after the first run is an amendment.
// Records bed v3 (per-task conventions stated only in prose), difficulty 3 and 4, test seeds 5001-5006.
// Usage: node experiments/p1/run.mjs [--dry] [--arms id,id]
import path from 'node:path';
import { makeTasks } from '../lib/beds.mjs';
import { runExperiment, armHash } from '../lib/runner.mjs';
import { createModelPort } from '../lib/models.mjs';
import { b0Call } from '../lib/arms/b0-call.mjs';
import { b0Agent } from '../lib/arms/b0-agent.mjs';
import { foundryWorkflow } from '../lib/arms/foundry-workflow.mjs';
import { buildRecordsV3Workflow } from '../workflows/records-v3.mjs';

const dry = process.argv.includes('--dry');
const only = process.argv.includes('--arms') ? process.argv[process.argv.indexOf('--arms') + 1].split(',') : null;
const HAIKU = 'claude-haiku-5-5', HAIKU45 = 'claude-haiku-4-5-20251001', SONNET = 'claude-sonnet-5-5';
// Hosted models only (local generative models are parked, owner decision 2026-10-07).
const MODELS = [HAIKU, HAIKU45, SONNET];
const out = path.resolve('experiments/runs/p1');
const { port, policyHash } = createModelPort({ journalFile: path.join(out, 'journal.sqlite'), allowedModels: MODELS, concurrency: { 'claude-cli': 12 } });
const seeds = [5001, 5002, 5003, 5004, 5005, 5006];
const tasks = [
  ...await makeTasks('records', { split: 'test', seeds, difficulty: 3 }),
  ...await makeTasks('records', { split: 'test', seeds, difficulty: 4 }),
];
// Class M = Haiku 5.5 and class L = Sonnet 5.5 in the policy subset above (Haiku 4.5 is reachable by id only).
const wf = (cls) => buildRecordsV3Workflow({ extractModelClass: cls, conventionsModelClass: cls, maxClass: 'L', concurrency: 4, maxCost: 2, reasoning: 'none' });
const arms = [
  b0Call({ id: 'b0call-haiku-none', model: HAIKU, modelPort: port, reasoning: 'none' }),
  b0Call({ id: 'b0call-haiku-med', model: HAIKU, modelPort: port, reasoning: 'medium' }),
  b0Call({ id: 'b0call-haiku45-none', model: HAIKU45, modelPort: port, reasoning: 'none' }),
  b0Call({ id: 'b0call-sonnet-med', model: SONNET, modelPort: port, reasoning: 'medium' }),
  b0Call({ id: 'b0ncall-haiku-med', model: HAIKU, modelPort: port, reasoning: 'medium', notes: true }),
  b0Agent({ id: 'b0agent-haiku', model: HAIKU, budgetUsd: 1, timeoutMs: 20 * 60 * 1000 }),
  foundryWorkflow({ id: 'fhand-haiku', workflow: wf('M'), modelPort: port, maxCostUsd: 2, maxDurationMs: 20 * 60 * 1000 }),
  foundryWorkflow({ id: 'fhand-sonnet', workflow: wf('L'), modelPort: port, maxCostUsd: 2, maxDurationMs: 20 * 60 * 1000 }),
].filter(a => !only || only.includes(a.id));
if (dry) {
  console.log(JSON.stringify({ policyHash, models: MODELS, tasks: tasks.map(t => [t.taskKey, t.taskHash.slice(0, 12)]), arms: arms.map(a => [a.id, armHash(a)]) }, null, 1));
  process.exit(0);
}
await runExperiment({ experiment: 'p1-records-v3', arms, tasks, trials: 3, workRoot: process.env.FOUNDRY_WORK_ROOT ?? '/var/tmp/foundry-work/p1',
  resultsFile: path.join(out, 'results.jsonl'), concurrency: 4, envFaultRule: true, strictResume: true });
process.exit(0);
