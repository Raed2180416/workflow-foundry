// N-version probe (development evidence): run several independently compiled solvers of one family on the same dev tasks and
// ask whether their agreement predicts correctness, i.e. whether voting between cheap compiled variants is an oracle-free
// uncertainty signal. Answers are compared by unordered canonical JSON; the bed oracle scores each answer (dev split only).
//   node experiments/jit/nversion.mjs --family records --seeds 201-224 --d3 201-216 --d4 217-224 --solvers a=path,b=path [--cap-usd 3]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeTasks, score, loadFamily } from '../lib/beds.mjs';
import { createModelPort } from '../lib/models.mjs';
import { runCompiled } from './run-compiled.mjs';

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const range = s => { const [a, b] = s.split('-').map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); };
const familyId = arg('--family'), cap = Number(arg('--cap-usd') ?? 3);
const solvers = Object.fromEntries(arg('--solvers').split(',').map(p => p.split('=')));
const segs = [['3', arg('--d3')], ['4', arg('--d4')], ['5', arg('--d5')]].filter(([, s]) => s).map(([d, s]) => ({ difficulty: Number(d), seeds: range(s) }));
const fam = await loadFamily(familyId);
const root = `/var/tmp/foundry-work/jit/nversion-${familyId}`; mkdirSync(root, { recursive: true });
const { port, db } = createModelPort({ journalFile: path.join(root, 'journal.sqlite'), allowedModels: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] });
const canon = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canon).sort().join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
let spent = 0; const rows = [];
for (const seg of segs) for (const t of await makeTasks(familyId, { split: 'dev', seeds: seg.seeds, difficulty: seg.difficulty })) {
  const runs = {};
  await Promise.all(Object.entries(solvers).map(async ([name, solvePath]) => {
    if (spent >= cap) { runs[name] = { status: 'skipped' }; return; }
    const workdir = path.join(root, `${name}-${t.taskKey.replaceAll(':', '_')}`);
    const r = await runCompiled({ solvePath, task: t.task, modelPort: port, perTaskUsd: 1, timeoutMs: 15 * 60 * 1000, workdir, familyId, label: `nv:${name}:${t.taskKey}` });
    spent += r.costUsd ?? 0;
    const v = r.status === 'ok' ? await score(familyId, t.task, r.output) : null;
    runs[name] = { status: r.status, pass: v?.pass ?? null, score: v?.score ?? null, costUsd: r.costUsd, key: r.status === 'ok' ? canon(r.output) : null };
  }));
  const oks = Object.values(runs).filter(r => r.status === 'ok');
  const groups = new Map(); for (const r of oks) groups.set(r.key, (groups.get(r.key) ?? 0) + 1);
  const top = [...groups.entries()].sort((a, b) => b[1] - a[1])[0];
  const majority = top && top[1] > oks.length / 2 ? oks.find(r => r.key === top[0]) : null;
  const row = { taskKey: t.taskKey, difficulty: seg.difficulty, ok: oks.length, distinct: groups.size, unanimous: oks.length >= 2 && groups.size === 1,
    majorityPass: majority?.pass ?? null, anyPass: oks.some(r => r.pass), runs: Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, { status: r.status, pass: r.pass, score: r.score, costUsd: r.costUsd }])) };
  rows.push(row);
  console.log(`${t.taskKey} ok=${row.ok} distinct=${row.distinct} unanimous=${row.unanimous} ${Object.entries(row.runs).map(([k, r]) => `${k}:${r.status === 'ok' ? (r.pass ? 'P' : 'F') : r.status[0].toUpperCase()}`).join(' ')} $${spent.toFixed(3)}`);
}
db.close();
const u = rows.filter(r => r.unanimous), d = rows.filter(r => r.ok >= 2 && !r.unanimous);
const perSolver = Object.fromEntries(Object.keys(solvers).map(k => { const rs = rows.map(r => r.runs[k]).filter(r => r?.status === 'ok'); return [k, { ok: rs.length, pass: rs.filter(r => r.pass).length, deoptOrCrash: rows.filter(r => r.runs[k] && !['ok', 'skipped'].includes(r.runs[k].status)).length }]; }));
const summary = { familyId, solvers, spentUsd: spent, tasks: rows.length, perSolver,
  unanimous: { n: u.length, pass: u.filter(r => r.majorityPass).length },
  disagree: { n: d.length, majorityPass: d.filter(r => r.majorityPass).length, anyPass: d.filter(r => r.anyPass).length, noMajority: d.filter(r => r.majorityPass === null).length } };
writeFileSync(path.join(root, 'nversion.json'), JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
