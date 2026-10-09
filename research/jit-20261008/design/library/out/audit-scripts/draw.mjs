// L1-a draw: 60 items, stratified by cluster (10 each) and, within cluster, by number of distinct L1 patterns (A: 0-1, B: 2-4, C: 5+;
// agentic also has a refused stratum R). Fixed seed, mulberry32. Reads the census only to build strata; prints ids and strata, never `needs`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const SEED = 20261009;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const CL = { automation: ['activepieces', 'coze', 'dify', 'flowise', 'langflow', 'n8n', 'node-red', 'zapier'], orchestration: ['airflow', 'argo', 'dagster', 'github-actions', 'gitlab-ci', 'kubeflow', 'prefect', 'tekton', 'temporal'], science: ['cwl', 'galaxy', 'nextflow', 'nf-core', 'snakemake', 'wdl'], 'consumer-creative': ['apple-shortcuts', 'comfyui', 'home-assistant', 'ifttt'] };
const clusterOf = p => (p === 'claude-code-workflows' ? 'first-party' : Object.entries(CL).find(([, v]) => v.includes(p))?.[0] ?? 'agentic');
const rows = fs.readFileSync(path.join(OUT, 'pattern-census-items.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const ALLOC = {   // cluster -> stratum -> k ; automation merges its 2 refused items into A (a 2-item stratum cannot be weighted)
  automation: { A: 3, B: 4, C: 3 }, orchestration: { A: 4, B: 4, C: 2 }, science: { A: 4, B: 4, C: 2 },
  'consumer-creative': { A: 3, B: 4, C: 3 }, agentic: { R: 2, A: 1, B: 4, C: 3 }, 'first-party': { B: 10 },
};
const stratumOf = r => { const cl = clusterOf(r.plat); const n = Object.keys(r.needs).filter(p => !p.startsWith('L0')).length;
  if (r.status === 'refused') return cl === 'agentic' ? 'R' : 'A'; return n <= 1 ? 'A' : n <= 4 ? 'B' : 'C'; };
const frame = {}; for (const r of rows) { const k = clusterOf(r.plat) + '|' + stratumOf(r); (frame[k] ??= []).push(r.id); }
const picked = [];
for (const cl of Object.keys(ALLOC)) for (const s of Object.keys(ALLOC[cl])) {
  const pool = frame[cl + '|' + s].sort(); const take = shuffle(pool).slice(0, ALLOC[cl][s]);
  for (const id of take) picked.push({ id, cluster: cl, stratum: s, stratumSize: pool.length, stratumSample: ALLOC[cl][s] });
}
const order = shuffle(picked);
order.forEach((p, i) => p.drawOrder = i + 1);
fs.writeFileSync(path.join(OUT, 'L1-audit-draw.json'), JSON.stringify({ seed: SEED, prng: 'mulberry32', method: 'per stratum: ids sorted lexicographically, Fisher-Yates with the shared PRNG stream, first k taken; strata visited in ALLOC order; then the 60 shuffled once for review order', strata: 'cluster x {A: 0-1 distinct L1 patterns, B: 2-4, C: 5+, R: census-refused (agentic only; automation refused merged into A)}', frameSizes: frame && Object.fromEntries(Object.entries(frame).map(([k, v]) => [k, v.length])), alloc: ALLOC, items: order }, null, 1));
console.log(order.map(p => `${p.drawOrder}\t${p.cluster}\t${p.stratum}\t${p.id}`).join('\n'));
