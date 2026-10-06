// Calibration pilot (development evidence only): how does a single structured call (B0-call)
// do on a bed at each difficulty? Used to pick difficulties where the comparison is informative.
// Usage: node experiments/pilots/calibrate-b0.mjs <family> <difficulties,comma> <seeds,comma> <models,comma> [trials]
import path from 'node:path';
import { makeTasks } from '../lib/beds.mjs';
import { runExperiment } from '../lib/runner.mjs';
import { createModelPort } from '../lib/models.mjs';
import { b0Call } from '../lib/arms/b0-call.mjs';
import { byArmTask, summarizeArm } from '../lib/stats.mjs';

const [family, diffs, seeds, models, trials = '1'] = process.argv.slice(2);
const out = path.resolve('experiments/runs/calibration');
const { port } = createModelPort({ journalFile: path.join(out, `${family}.journal.sqlite`) });
const tasks = [];
for (const d of diffs.split(',').map(Number)) tasks.push(...await makeTasks(family, { split: 'dev', seeds: seeds.split(',').map(Number), difficulty: d }));
const arms = models.split(',').map(m => b0Call({ id: `b0call-${m.replace(/^claude-/, '').split('-')[0]}`, model: m, modelPort: port }));
const recs = await runExperiment({ experiment: `calibrate-${family}`, arms, tasks, trials: Number(trials), workRoot: path.join(out, 'work'), resultsFile: path.join(out, `${family}.jsonl`), concurrency: 4 });
for (const [arm, m] of byArmTask(recs)) {
  for (const d of diffs.split(',')) {
    const sub = new Map([...m].filter(([k]) => k.includes(`:d${d}:`)));
    const s = summarizeArm(sub, { k: 1 });
    console.log(`${arm} d${d}: ${s.successes}/${s.trials} pass, mean score ${(([...sub.values()].flatMap(t => t.trials).reduce((a, r) => a + (r.score ?? 0), 0)) / s.trials).toFixed(3)}, $${s.costUsd.toFixed(3)}`);
  }
}
process.exit(0);
