// L1 re-audit draw (2026-10-14): a fresh 60-item stratified sample on the REVISED census, excluding every item L1-a drew,
// plus a fixed-seed 10-item sub-draw for the second labeller. $0: reads the census, the L1-a draw ids and the corpus index.
// Usage (from the repo root):  node research/jit-20261008/design/library/out/L1-reaudit/draw.mjs
//
// Procedure = L1-a (out/audit-scripts/draw.mjs, AUDIT-L1 §1) with three changes, all stated in draw.json:
//  1. seed 20261014 (L1-a used 20261009 for the draw, 20261010 for detector hits, 20261011 for the bootstrap);
//  2. the pool of each stratum excludes the 60 items L1-a drew (ids read from out/L1-audit-draw.json; only ids are read);
//  3. first-party has no unlabelled item left (L1-a drew all 10), so its 10 slots are reallocated: each of the five other
//     clusters gets +2, raising its A, B and C strata to 4 each (agentic keeps R = 2).
// Labels, adjudication and census verdicts are never read by this script; the draw output carries ids, strata, corpus
// line and source URL only (blind to the census verdicts; the stratum letter is shown, as in L1-a).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));          // .../out/L1-reaudit
const OUT = path.resolve(HERE, '..');                                // .../out
const ROOT = path.resolve(HERE, '../../../../../..');                // repo root
const CENSUS = path.join(OUT, 'pattern-census-items.jsonl');        // revised census (REVISION=1 default), HEAD 56d45de
const L1A_DRAW = path.join(OUT, 'L1-audit-draw.json');             // read for ids only
const CORPUS = path.join(ROOT, 'research/corpus-20261006/items.jsonl');
const SEED = 20261014;
const SEED_SUB = 20261015;
const SHA = (s) => crypto.createHash('sha256').update(s).digest('hex');

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CL = {
  automation: ['activepieces', 'coze', 'dify', 'flowise', 'langflow', 'n8n', 'node-red', 'zapier'],
  orchestration: ['airflow', 'argo', 'dagster', 'github-actions', 'gitlab-ci', 'kubeflow', 'prefect', 'tekton', 'temporal'],
  science: ['cwl', 'galaxy', 'nextflow', 'nf-core', 'snakemake', 'wdl'],
  'consumer-creative': ['apple-shortcuts', 'comfyui', 'home-assistant', 'ifttt'],
};
const clusterOf = (p) => (p === 'claude-code-workflows' ? 'first-party' : Object.entries(CL).find(([, v]) => v.includes(p))?.[0] ?? 'agentic');
// L1-a rule: refused items are R inside agentic and merged into A elsewhere; otherwise A: 0-1, B: 2-4, C: 5+ distinct L1 patterns
// (keys of `needs` that are not L0 constructs, zero-valued keys included, exactly as draw.mjs counts them).
const stratumOf = (r) => {
  const cl = clusterOf(r.plat);
  const n = Object.keys(r.needs).filter((p) => !p.startsWith('L0')).length;
  if (r.status === 'refused') return cl === 'agentic' ? 'R' : 'A';
  return n <= 1 ? 'A' : n <= 4 ? 'B' : 'C';
};
const ALLOC = {   // cluster -> stratum -> k (fresh draw). L1-a: automation A3 B4 C3; orchestration A4 B4 C2; science A4 B4 C2;
  automation: { A: 4, B: 4, C: 4 },              // consumer-creative A3 B4 C3; agentic R2 A1 B4 C3; first-party B10 (exhausted).
  orchestration: { A: 4, B: 4, C: 4 },
  science: { A: 4, B: 4, C: 4 },
  'consumer-creative': { A: 4, B: 4, C: 4 },
  agentic: { R: 2, A: 2, B: 4, C: 4 },
};

const rows = fs.readFileSync(CENSUS, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const censusSha = SHA(fs.readFileSync(CENSUS));
const l1a = JSON.parse(fs.readFileSync(L1A_DRAW, 'utf8'));
const excluded = new Set(l1a.items.map((p) => p.id));
if (excluded.size !== 60) throw new Error('expected 60 L1-a ids, got ' + excluded.size);
const excludedSorted = [...excluded].sort();

// population (all census rows) and frames (population minus L1-a's ids)
const popCount = {}; const frame = {};
for (const r of rows) {
  const k = clusterOf(r.plat) + '|' + stratumOf(r);
  popCount[k] = (popCount[k] ?? 0) + 1;
  if (!excluded.has(r.id)) (frame[k] ??= []).push(r.id);
}
const l1aPerStratum = {};
for (const r of rows) if (excluded.has(r.id)) { const k = clusterOf(r.plat) + '|' + stratumOf(r); l1aPerStratum[k] = (l1aPerStratum[k] ?? 0) + 1; }

// ---- draw 60: L1-a procedure, one shared PRNG stream, strata in ALLOC order, then one shuffle for review order
const rnd = mulberry32(SEED);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const picked = [];
for (const cl of Object.keys(ALLOC)) for (const s of Object.keys(ALLOC[cl])) {
  const key = cl + '|' + s;
  const pool = (frame[key] ?? []).slice().sort();
  if (pool.length < ALLOC[cl][s]) throw new Error('frame too small: ' + key);
  const take = shuffle(pool).slice(0, ALLOC[cl][s]);
  for (const id of take) picked.push({ id, cluster: cl, stratum: s });
}
const order = shuffle(picked);
order.forEach((p, i) => { p.drawOrder = i + 1; });

// corpus line and canonical URL for each drawn id (reads the corpus index only; no other field is kept)
const want = new Set(order.map((p) => p.id));
const where = new Map();
const corpusLines = fs.readFileSync(CORPUS, 'utf8').split('\n');
for (let i = 0; i < corpusLines.length; i++) {
  const line = corpusLines[i];
  if (!line) continue;
  const item = JSON.parse(line);
  if (want.has(item.id)) where.set(item.id, { line: i + 1, url: item.source.url });
}
if (where.size !== order.length) throw new Error('corpus lookup missed ' + (order.length - where.size));

// ---- draw 10: fixed seed, 2 per cluster (so the second labeller sees every cluster the revision touched). Per cluster the
// sorted ids get one Fisher-Yates shuffle on mulberry32(SEED_SUB), first 2 taken; then the 10 are shuffled once for review order.
const rndSub = mulberry32(SEED_SUB);
const shuffleSub = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rndSub() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pickedSub = [];
for (const cl of Object.keys(CL).concat('agentic')) {
  const ids = order.filter((p) => p.cluster === cl).map((p) => p.id).sort();
  pickedSub.push(...shuffleSub(ids).slice(0, 2));
}
const subIds = shuffleSub(pickedSub);
const byId = new Map(order.map((p) => [p.id, p]));

// ---- checks
const ids = order.map((p) => p.id);
if (new Set(ids).size !== 60) throw new Error('duplicate ids in draw');
if (ids.some((id) => excluded.has(id))) throw new Error('an L1-a item was drawn');
if (order.some((p) => p.cluster === 'first-party')) throw new Error('first-party drawn');

const strata = {};
for (const cl of Object.keys(ALLOC)) for (const s of Object.keys(ALLOC[cl])) {
  const key = cl + '|' + s;
  strata[key] = {
    cluster: cl, stratum: s,
    popSize: popCount[key] ?? 0,
    l1aExcluded: l1aPerStratum[key] ?? 0,
    frameSize: (frame[key] ?? []).length,
    sampled: order.filter((p) => p.cluster === cl && p.stratum === s).length,
    allocated: ALLOC[cl][s],
  };
}
const firstPartyPop = Object.entries(popCount).filter(([k]) => k.startsWith('first-party|')).map(([k, v]) => [k, v, l1aPerStratum[k] ?? 0, (frame[k] ?? []).length]);

const itemRow = (p) => ({
  drawOrder: p.drawOrder,
  id: p.id,
  cluster: p.cluster,
  stratum: p.stratum,
  stratumFrameSize: strata[p.cluster + '|' + p.stratum].frameSize,
  stratumPopSize: strata[p.cluster + '|' + p.stratum].popSize,
  corpus: { file: 'research/corpus-20261006/items.jsonl', line: where.get(p.id).line },
  sourceUrl: where.get(p.id).url,
});

const draw = {
  id: 'L1-reaudit-draw-1',
  date: '2026-10-14',
  purpose: 'Fresh stratified sample for the re-audit of the revised L1 (AUDIT-L1 successor; LIBRARY-TESTS L1). Blind: the labeller sees the item (title, description, graph) and the stratum letter; census verdicts, patterns, tokens and any L1-a label are not in this file.',
  census: { file: 'research/jit-20261008/design/library/out/pattern-census-items.jsonl', sha256: censusSha, rows: rows.length, revision: 'L1 revision 1 (REVISION=1, DASHBOARD_WIDGETS=20; HEAD 56d45de)' },
  seed: SEED,
  prng: 'mulberry32',
  method: 'Per stratum (cluster x A/B/C/R): frame = census rows in the stratum minus the 60 L1-a ids; ids sorted lexicographically; Fisher-Yates on one shared mulberry32(seed) stream; first k taken; strata visited in ALLOC order; then the 60 shuffled once on the same stream for review order (drawOrder). Strata: six platform clusters (automation, orchestration, science, consumer-creative, agentic, first-party) crossed with the distinct-L1-pattern count (A: 0-1, B: 2-4, C: 5+); refused items are R inside agentic and merged into A elsewhere (AUDIT-L1 §1).',
  allocationChange: 'L1-a: automation A3 B4 C3; orchestration A4 B4 C2; science A4 B4 C2; consumer-creative A3 B4 C3; agentic R2 A1 B4 C3; first-party B10. First-party has no unlabelled item left (L1-a drew all 10 of its frame), so its 10 slots are reallocated: +2 to each of the five other clusters, raising A, B and C to 4 each (agentic keeps R2). 60 = 5 x 12.',
  firstPartyFrame: firstPartyPop.map(([k, pop, drawn, rem]) => ({ stratum: k, popSize: pop, l1aExcluded: drawn, frameSize: rem })),
  excludedL1a: { count: excludedSorted.length, source: 'research/jit-20261008/design/library/out/L1-audit-draw.json (ids only; no label, adjudication or census field is read)', sha256: SHA(excludedSorted.join('\n')), ids: excludedSorted },
  strata,
  items: order.map(itemRow),
  subDraw: { file: 'research/jit-20261008/design/library/out/L1-reaudit/draw-10.json', seed: SEED_SUB, ids: subIds },
};

const sub = {
  id: 'L1-reaudit-draw-10',
  date: '2026-10-14',
  purpose: 'Fixed-seed 10-item sub-draw of draw.json for the second labeller (blind, as draw.json).',
  parent: { file: 'research/jit-20261008/design/library/out/L1-reaudit/draw.json', seed: SEED, n: 60 },
  seed: SEED_SUB,
  prng: 'mulberry32',
  method: 'Stratified by cluster, 2 per cluster (five clusters, 10 items). Per cluster: its drawn ids sorted lexicographically, one Fisher-Yates shuffle on one mulberry32(seed) stream, first 2 taken (clusters visited automation, orchestration, science, consumer-creative, agentic); then the 10 shuffled once on the same stream for review order (subOrder). Stratified so that the second labeller sees every cluster the revision touched.',
  items: subIds.map((id, i) => ({ subOrder: i + 1, drawOrder: byId.get(id).drawOrder, ...itemRow(byId.get(id)) })),
  composition: Object.fromEntries(Object.entries(subIds.reduce((m, id) => { const p = byId.get(id); const k = p.cluster + '|' + p.stratum; m[k] = (m[k] ?? 0) + 1; return m; }, {})).sort()),
};

fs.writeFileSync(path.join(HERE, 'draw.json'), JSON.stringify(draw, null, 1) + '\n');
fs.writeFileSync(path.join(HERE, 'draw-10.json'), JSON.stringify(sub, null, 1) + '\n');

// console: counts only (no ids beyond the sub-draw list, no census or label fields)
console.log('census rows', rows.length, 'sha256', censusSha.slice(0, 16), '; L1-a excluded', excludedSorted.length);
console.log('stratum            pop  L1a-excl  frame  allocated  sampled');
for (const [k, s] of Object.entries(strata)) console.log(k.padEnd(26), String(s.popSize).padStart(4), String(s.l1aExcluded).padStart(8), String(s.frameSize).padStart(6), String(s.allocated).padStart(10), String(s.sampled).padStart(8));
console.log('first-party (pop, L1-a excluded, frame):', JSON.stringify(firstPartyPop.map((x) => x.slice(1))));
console.log('draw 60 =', order.length, '; sub-draw 10 =', sub.items.length);
console.log('sub-draw composition', JSON.stringify(sub.composition));
