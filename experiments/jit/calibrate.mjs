// Headroom gate for a stream family (family scout, 2026-10-08): Haiku and Sonnet agents, K=1, on a few dev seeds.
// Development evidence only. If the Haiku agent passes ≥ 7/8, the family has no headroom for a stream.
//   node experiments/jit/calibrate.mjs <family> <d,d> <seed,seed,...> [--models a,b]
import path from 'node:path';
import { runExperiment } from '../lib/runner.mjs';
import { makeTasks } from '../lib/beds.mjs';
import { b0Agent } from '../lib/arms/b0-agent.mjs';

const [familyId, ds, ss] = process.argv.slice(2);
const mi = process.argv.indexOf('--models');
const models = mi > 0 ? process.argv[mi + 1].split(',') : ['claude-haiku-5-5', 'claude-sonnet-5-5'];
if (!familyId || !ds || !ss) { console.error('usage: calibrate.mjs <family> <d,d> <seed,...> [--models a,b]'); process.exit(2); }
const tasks = [];
for (const d of ds.split(',').map(Number)) tasks.push(...await makeTasks(familyId, { split: 'dev', seeds: ss.split(',').map(Number), difficulty: d }));
const arms = models.map(m => b0Agent({ id: `agent-${m.replace(/^claude-|-5-5$/g, '')}`, model: m, budgetUsd: 1, timeoutMs: 15 * 60 * 1000 }));
const out = path.resolve('experiments/runs/jit/calibration');
await runExperiment({ experiment: `jit-cal-${familyId}`, arms, tasks, trials: 1, workRoot: `/var/tmp/foundry-work/jit-cal`, resultsFile: path.join(out, `${familyId}.jsonl`),
  concurrency: 4, envFaultRule: true, keepWorkdirs: true });
