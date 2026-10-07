// Phase 1 exit experiment (pre-registered in research/core-20261006/PREREG.md). Frozen: its sha256 is
// recorded in the pre-registration; any change after the first run is an amendment.
// Usage: node experiments/p1/run.mjs [--lane hosted|local] [--dry]
import path from 'node:path';
import { makeTasks } from '../lib/beds.mjs';
import { runExperiment, armHash } from '../lib/runner.mjs';
import { createModelPort } from '../lib/models.mjs';
import { b0Call } from '../lib/arms/b0-call.mjs';
import { b0Agent } from '../lib/arms/b0-agent.mjs';
import { foundryWorkflow } from '../lib/arms/foundry-workflow.mjs';
import { buildRecordsWorkflow } from '../workflows/records-hand.mjs';

const lane = process.argv.includes('--lane') ? process.argv[process.argv.indexOf('--lane') + 1] : 'hosted';
const dry = process.argv.includes('--dry');
const HAIKU = 'claude-haiku-4-5-20251001', SONNET = 'claude-sonnet-5-5', QWEN4B = 'qwen3.5-4b-q4km';
const out = path.resolve('experiments/runs/p1');
const { port } = createModelPort({ journalFile: path.join(out, `journal-${lane}.sqlite`) });
const seeds = [5001, 5002, 5003, 5004, 5005, 5006];
const tasks = [
  ...await makeTasks('records', { split: 'test', seeds, difficulty: 2 }),
  ...await makeTasks('records', { split: 'test', seeds, difficulty: 3 }),
];
const wf = (cls, max) => buildRecordsWorkflow({ chunkSize: 6, modelClass: cls, maxClass: max, concurrency: 4, maxCost: 2, reasoning: 'none' });
const hosted = [
  b0Call({ id: 'b0call-haiku-med', model: HAIKU, modelPort: port, reasoning: 'medium' }),
  b0Call({ id: 'b0call-haiku-none', model: HAIKU, modelPort: port, reasoning: 'none' }),
  b0Call({ id: 'b0call-sonnet-med', model: SONNET, modelPort: port, reasoning: 'medium' }),
  b0Call({ id: 'b0ncall-haiku-med', model: HAIKU, modelPort: port, reasoning: 'medium', notes: true }),
  b0Agent({ id: 'b0agent-haiku', model: HAIKU, budgetUsd: 1, timeoutMs: 15 * 60 * 1000 }),
  foundryWorkflow({ id: 'fhand-haiku', workflow: wf('M', 'L'), modelPort: port, assignment: { read: HAIKU }, maxCostUsd: 2 }),
  foundryWorkflow({ id: 'fhand-sonnet', workflow: wf('L', 'L'), modelPort: port, assignment: { read: SONNET }, maxCostUsd: 2 }),
];
// Local lane: S-class extraction with the escalation rules E1/E2/E7 allowed up to L (Sonnet).
const local = [foundryWorkflow({ id: 'fhand-qwen4b-esc', workflow: wf('S', 'L'), modelPort: port, assignment: { read: QWEN4B }, maxCostUsd: 2 })];
const arms = lane === 'local' ? local : hosted;
const localTasks = tasks.filter(t => t.task.difficulty === 2).slice(0, 3);
if (dry) {
  console.log(JSON.stringify({ lane, tasks: (lane === 'local' ? localTasks : tasks).map(t => [t.taskKey, t.taskHash.slice(0, 12)]), arms: arms.map(a => [a.id, armHash(a)]) }, null, 1));
  process.exit(0);
}
await runExperiment({ experiment: `p1-records-${lane}`, arms, tasks: lane === 'local' ? localTasks : tasks, trials: lane === 'local' ? 1 : 3,
  workRoot: path.join(out, 'work'), resultsFile: path.join(out, `results-${lane}.jsonl`), concurrency: lane === 'local' ? 1 : 3 });
process.exit(0);
