// Development pilot: hand-written records workflow with the extraction node pinned to each model.
// Usage: node experiments/pilots/records-hand-pilot.mjs <difficulty> <seeds,comma> <models,comma> [trials] [chunkSize]
import path from 'node:path';
import { makeTasks } from '../lib/beds.mjs';
import { runExperiment } from '../lib/runner.mjs';
import { createModelPort } from '../lib/models.mjs';
import { foundryWorkflow } from '../lib/arms/foundry-workflow.mjs';
import { buildRecordsWorkflow } from '../workflows/records-hand.mjs';

const [d, seeds, models, trials = '1', chunk = '6', reasoning = 'none'] = process.argv.slice(2);
const out = path.resolve('experiments/runs/records-hand-pilot');
const { port } = createModelPort({ journalFile: path.join(out, 'journal.sqlite') });
const workflow = buildRecordsWorkflow({ chunkSize: Number(chunk), modelClass: 'S', maxClass: 'L', concurrency: 4, maxCost: 2, reasoning });
const tasks = await makeTasks('records', { split: 'dev', seeds: seeds.split(',').map(Number), difficulty: Number(d) });
const short = m => m.replace(/^claude-/, '').split('-')[0].replace(/-q4km$/, '');
const arms = models.split(',').map(m => foundryWorkflow({ id: `fhand3-${short(m)}-r${reasoning}-c${chunk}`, workflow, modelPort: port, assignment: { read: m }, maxCostUsd: 2 }));
const recs = await runExperiment({ experiment: `records-hand-d${d}`, arms, tasks, trials: Number(trials), workRoot: '/var/tmp/foundry-work/records-hand-pilot', resultsFile: path.join(out, 'results.jsonl'), concurrency: 2, keepWorkdirs: true });
for (const r of recs) console.log(r.arm, r.taskKey, r.trial, r.pass, r.score, r.costUsd.toFixed(4), JSON.stringify(r.meta), r.error?.code ?? '', (r.oracleDetails ?? '').slice(0, 300));
process.exit(0);
