// Need router M1 (DESIGN.md §7): the first real number. Does ONE Haiku call already solve any W-bed rung? One
// structured call per task (B0-call, no tools), two efforts, 12 attack seeds per rung at d3 (W-BED §8 wbed-attack dev
// 379-390; R3' on its own rows 479-490), through the journaled ModelPort, scored by each bed's oracle. It is also the
// W-bed's preregistered admission gate (R0 >= 10/12; every other rung <= 2/12 at each effort). METERED: ~192 calls,
// estimate ~$10, hard stop at --cap (default $15). Live files stay outside the repository and are copied in at the end.
//   node experiments/need-router/m1-run.mjs [--cap 15] [--rungs r0,r1,...] [--dry]
import path from 'node:path';
import { mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeTasks } from '../lib/beds.mjs';
import { runExperiment } from '../lib/runner.mjs';
import { createModelPort } from '../lib/models.mjs';
import { b0Call } from '../lib/arms/b0-call.mjs';
import { RUNGS, ATTACK_SEEDS, refuseSeeds } from '../../beds/wbed/attacks/triviality.mjs';
import { loadFamily } from '../lib/beds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const cap = Number(arg('--cap', '15'));
const rungs = arg('--rungs', Object.keys(RUNGS).join(',')).split(',');
const difficulty = Number(arg('--difficulty', '3'));
const tag = arg('--tag', difficulty === 3 ? 'm1' : `m1-d${difficulty}`);
const live = `/var/tmp/foundry-work/need/${tag}`;
const out = path.join(ROOT, 'research/need-router-20261014/runs', tag);
mkdirSync(live, { recursive: true }); mkdirSync(out, { recursive: true });

const tasks = [];
for (const r of rungs) {
  const seeds = RUNGS[r].seeds ?? ATTACK_SEEDS;
  const fam = await loadFamily(RUNGS[r].family);
  refuseSeeds(r, fam.family.id, seeds);
  tasks.push(...await makeTasks(RUNGS[r].family, { split: 'dev', seeds, difficulty }));
}
console.log(`M1: ${tasks.length} tasks over ${rungs.length} rungs x 2 efforts = ${tasks.length * 2} calls; cap $${cap}`);
if (process.argv.includes('--dry')) process.exit(0);

const timeoutMs = Number(arg('--timeout-ms', '0')) || undefined;
const only = arg('--only', null);   // a JSON file of [{ taskKey, arm }] to (re-)run; others are skipped
const { port } = createModelPort({ journalFile: path.join(live, 'journal.sqlite'), allowedModels: ['claude-haiku-5-5'], maxBudgetUsdPerCall: 1, timeoutMs });
let spent = 0;
const capped = arm => ({
  ...arm,
  async run(a) {
    if (spent >= cap) { console.log(`CAP: $${spent.toFixed(2)} >= $${cap}; stopping (results so far are kept)`); finish(); process.exit(4); }
    const r = await arm.run(a);
    spent += (r.costUsd ?? 0) + (r.imputedUsd ?? 0);
    return r;
  },
});
const arms = [
  capped(b0Call({ id: 'b0-call-haiku-none', model: 'claude-haiku-5-5', modelPort: port, reasoning: 'none' })),
  capped(b0Call({ id: 'b0-call-haiku-medium', model: 'claude-haiku-5-5', modelPort: port, reasoning: 'medium' })),
];
function finish() {
  for (const f of ['results.jsonl', 'results.faults.jsonl']) if (existsSync(path.join(live, f))) copyFileSync(path.join(live, f), path.join(out, f));
  writeFileSync(path.join(out, 'spent.json'), JSON.stringify({ spentUsd: spent, cap, calls: tasks.length * 2 }, null, 1));
}
const recs = await runExperiment({ experiment: `need-${tag}-wbed-triviality`, arms, tasks, trials: 1, workRoot: path.join(live, 'work'),
  resultsFile: path.join(live, 'results.jsonl'), concurrency: 4, envFaultRule: true, strictResume: true });
finish();
const byRung = {};
for (const r of recs) { const k = `${r.family}|${r.arm}`; const x = (byRung[k] ??= { n: 0, pass: 0, usd: 0 }); x.n += 1; x.pass += r.pass ? 1 : 0; x.usd += r.costUsd ?? 0; }
for (const [k, x] of Object.entries(byRung).sort()) console.log(`${k.padEnd(40)} ${x.pass}/${x.n} pass, $${x.usd.toFixed(3)}`);
console.log(`spent $${spent.toFixed(2)} of $${cap}`);
process.exit(0);
