// Row 18, step 5: the stratified subset of J1 dev-select items for the Jev independence check.
//   node --max-old-space-size=1024 research/judge-20261009/independence/sample.mjs
// Population: the 1,181 Jev rows of research/judge-20261009/data/jev/J1/*.jsonl (K = 1, jev-1.13.0). Stratum = port x Jev-correct.
// Rule (fixed before any Claude read; seed SEED below):
//   - ports with negative results are oversampled: interactive X6 (14 Jev-wrong + 10 Jev-right), runbook X4 (12 + 8),
//     kinetics X3 (17 + 11);
//   - every other port: 2 Jev-wrong + 2 Jev-right (interactive Q1~east/north/south/west merged into one port Q1);
//     kinetics K2 and K3 have no Jev error: 2 Jev-right each;
//   - items inside a stratum are taken in sha256 order of "SEED|group|record id|question id" (a nested prefix of one ordering).
// Weight of an item = stratum size / stratum quota, so population-level numbers can be re-weighted.
// The label is never read here beyond the Jev-correct flag, and it is never sent to a model.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SEED = 'kev-independence-v1-20261009';
const here = path.dirname(fileURLToPath(import.meta.url));
const J1 = path.join(here, '..', 'data', 'jev', 'J1');
const OUT = path.join(here, 'data', 'sample.jsonl');
const h = s => createHash('sha256').update(s).digest('hex');

const NEG = { 'interactive:X6': [14, 10], 'runbook:X4': [12, 8], 'kinetics:X3': [17, 11] };   // [Jev-wrong, Jev-right]
const portOf = (group, q) => `${group}:${q.split('~')[0]}`;                                       // Q1~east -> Q1

const pop = [];
for (const group of ['interactive', 'kinetics', 'runbook']) {
  for (const l of fs.readFileSync(path.join(J1, `${group}-dev-select.jsonl`), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    pop.push({ group, recId: r.id, qid: r.question, port: portOf(group, r.question), jevChoice: r.choice, jevLabelOption: r.keys[r.label], jevCorrect: r.choice === r.keys[r.label], keys: r.keys });
  }
}
const strata = new Map();
for (const it of pop) { const k = `${it.port}|${it.jevCorrect ? 'right' : 'wrong'}`; if (!strata.has(k)) strata.set(k, []); strata.get(k).push(it); }

const sample = [];
const ports = [...new Set(pop.map(p => p.port))].sort();
const plan = [];
for (const port of ports) {
  const [qw, qr] = NEG[port] ?? [2, 2];
  for (const [kind, q] of [['wrong', qw], ['right', qr]]) {
    const pool = strata.get(`${port}|${kind}`) ?? [];
    const take = Math.min(q, pool.length);
    if (!take) { plan.push({ port, kind, N: pool.length, quota: 0, taken: 0 }); continue; }
    pool.sort((a, b) => (h(`${SEED}|${a.group}|${a.recId}|${a.qid}`) < h(`${SEED}|${b.group}|${b.recId}|${b.qid}`) ? -1 : 1));
    for (const it of pool.slice(0, take)) sample.push({ ...it, stratum: `${port}|${kind}`, weight: pool.length / take });
    plan.push({ port, kind, N: pool.length, quota: q, taken: take });
  }
}
// stable item index: by group, port, record id, question id
sample.sort((a, b) => (`${a.group}|${a.port}|${a.recId}|${a.qid}` < `${b.group}|${b.port}|${b.recId}|${b.qid}` ? -1 : 1));
sample.forEach((s, i) => { s.idx = i; });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, sample.map(s => JSON.stringify(s)).join('\n') + '\n');
fs.writeFileSync(path.join(here, 'data', 'sample-plan.json'), JSON.stringify({ seed: SEED, population: pop.length, jevWrongPopulation: pop.filter(p => !p.jevCorrect).length, n: sample.length, jevWrong: sample.filter(s => !s.jevCorrect).length, plan }, null, 1));
console.log(`${sample.length} items; Jev wrong ${sample.filter(s => !s.jevCorrect).length}; records ${new Set(sample.map(s => s.recId)).size}`);
for (const p of plan) console.log(p.port.padEnd(18), p.kind.padEnd(6), `N=${p.N} quota=${p.quota} taken=${p.taken}`);
