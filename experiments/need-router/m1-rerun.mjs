// M1-R (MEMORY-ROUTING-RECURSION §5 row 4): re-run every M1 trial that hit the 300 s wall (MODEL_TIMEOUT; 26 at d3,
// 28 at d5) with the same arm definition at a 600 s wall, so the one-call labels stop counting a wall-clock limit as a
// model failure. Only the timed-out (task, arm) pairs run; everything else keeps its M1 row. The merged labelling is
// written next to the originals so jev-need.mjs can score Jev and the size rule under both.
// METERED: <= 54 calls, estimate $10-15, hard stop at --cap (default $25). Live files stay outside the repository.
//   node experiments/need-router/m1-rerun.mjs [--from m1,m1-d5] [--tag m1-r] [--timeout-ms 600000] [--cap 25] [--dry]
import path from 'node:path';
import { mkdirSync, copyFileSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeTasks } from '../lib/beds.mjs';
import { runExperiment, armHash } from '../lib/runner.mjs';
import { createModelPort } from '../lib/models.mjs';
import { b0Call } from '../lib/arms/b0-call.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS = path.join(ROOT, 'research/need-router-20261014/runs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const from = arg('--from', 'm1,m1-d5').split(',');
const tag = arg('--tag', 'm1-r');
const cap = Number(arg('--cap', '25'));
const timeoutMs = Number(arg('--timeout-ms', '600000'));
const live = `/var/tmp/foundry-work/need/${tag}`;
const out = path.join(RUNS, tag);

const readRows = f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
export const isTimeout = r => r.error?.code === 'MODEL_TIMEOUT';

// The arms exactly as M1 defined them (same ids, so the arm hashes must match the originals; checked below).
const EFFORT = { 'b0-call-haiku-none': 'none', 'b0-call-haiku-medium': 'medium' };

async function main() {
  const prior = from.flatMap(t => readRows(path.join(RUNS, t, 'results.jsonl')).map(r => ({ ...r, source: t })));
  const todo = prior.filter(isTimeout);
  const byArm = {};
  for (const r of todo) (byArm[r.arm] ??= []).push(r);
  console.log(`M1-R: ${todo.length} timed-out trials (${Object.entries(byArm).map(([a, x]) => `${a} ${x.length}`).join(', ')}); wall ${timeoutMs / 1000} s; cap $${cap}`);
  if (process.argv.includes('--dry')) return;
  mkdirSync(live, { recursive: true }); mkdirSync(out, { recursive: true });
  const { port } = createModelPort({ journalFile: path.join(live, 'journal.sqlite'), allowedModels: ['claude-haiku-5-5'], maxBudgetUsdPerCall: 1, timeoutMs });
  let spent = 0;
  const finish = () => {
    for (const f of ['results.jsonl', 'results.faults.jsonl']) if (existsSync(path.join(live, f))) copyFileSync(path.join(live, f), path.join(out, f));
    writeFileSync(path.join(out, 'spent.json'), JSON.stringify({ spentUsd: spent, cap, timeoutMs, calls: todo.length, from }, null, 1));
  };
  const capped = arm => ({ ...arm, async run(a) {
    if (spent >= cap) { console.log(`CAP: $${spent.toFixed(2)} >= $${cap}; stopping (results so far are kept)`); finish(); process.exit(4); }
    const r = await arm.run(a); spent += (r.costUsd ?? 0) + (r.imputedUsd ?? 0); return r;
  } });
  for (const [armId, rows] of Object.entries(byArm).sort()) {
    const arm = b0Call({ id: armId, model: 'claude-haiku-5-5', modelPort: port, reasoning: EFFORT[armId] });
    const tasks = [];
    for (const r of rows) {
      const [fam, split, d, s] = r.taskKey.split(':');
      const t = (await makeTasks(fam, { split, seeds: [Number(s.slice(1))], difficulty: Number(d.slice(1)) }))[0];
      if (t.taskKey !== r.taskKey || t.taskHash !== r.taskHash) throw new Error(`task drift ${r.taskKey}`);
      tasks.push(t);
    }
    // Each source run's arm hash must match today's definition, or the re-run would label a different arm.
    if (rows.some(r => r.armHash !== armHash(arm))) throw new Error(`${armId}: definition drifted from the source rows (${[...new Set(rows.map(r => r.armHash))]} vs ${armHash(arm)})`);
    await runExperiment({ experiment: `need-${tag}`, arms: [capped(arm)], tasks, trials: 1, workRoot: path.join(live, 'work'),
      resultsFile: path.join(live, 'results.jsonl'), concurrency: 4, envFaultRule: false, strictResume: true });
  }
  finish();
  // Merge: each timed-out row is replaced by its re-run (still a timeout at 600 s stays a failure, flagged).
  const rerun = new Map(readRows(path.join(live, 'results.jsonl')).map(r => [`${r.arm}|${r.taskKey}`, r]));
  const merged = prior.map(r => (isTimeout(r) && rerun.has(`${r.arm}|${r.taskKey}`) ? { ...rerun.get(`${r.arm}|${r.taskKey}`), source: r.source, rerunOf: 'MODEL_TIMEOUT@300s' } : r));
  writeFileSync(path.join(out, 'merged.jsonl'), merged.map(r => JSON.stringify(r)).join('\n') + '\n');
  const res = [...rerun.values()];
  const summary = { reran: res.length, pass: res.filter(r => r.pass).length, stillTimeout: res.filter(isTimeout).length, otherError: res.filter(r => r.error && !isTimeout(r)).length, spentUsd: spent };
  writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary));
  for (const r of res.sort((a, b) => a.taskKey.localeCompare(b.taskKey))) console.log(`  ${r.taskKey.padEnd(26)} ${r.arm.padEnd(22)} ${r.pass ? 'PASS' : 'fail'} ${r.error?.code ?? ''} ${(r.latencyMs / 1000).toFixed(0)}s $${(r.costUsd ?? 0).toFixed(3)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
