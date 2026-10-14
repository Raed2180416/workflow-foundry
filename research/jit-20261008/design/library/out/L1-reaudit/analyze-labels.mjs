// analyze-labels.mjs: coverage (post-stratified, Wilson at the Kish effective n, seeded stratified bootstrap) and detector
// precision / recall from a re-audit label file. $0, reads only the label file and draw.json (no corpus, no census, no beds).
// Usage (repo root):  node research/jit-20261008/design/library/out/L1-reaudit/analyze-labels.mjs [labels-file] [out-summary.json]
//   default labels file: labels-sonnet-60.jsonl (same directory); default summary: <labels file>.summary.json
// Row fields used: cluster, stratum, explained (yes|partly|no), dashboardCriterion, explainedIfDashboardExplained,
//   census.status, detectors[{pattern,via,verdict}], l0Assignments[{construct,verdict}], patterns (blind), detectorsMissed, gaps.
// Readings of coverage (owner decision PAUSE §5.8: both are reported, the conservative one first):
//   conservative  an item flagged dashboardCriterion (Node-RED, >= 20 ui_* nodes, or the corpus IR refusal) is NOT explained;
//   dashboardExplained  such an item takes the label's explainedIfDashboardExplained;
//   blind  every item takes the label's own `explained` (the labeller's reading of the refusal definition).
// "strict" counts explained = yes only; "lenient" counts yes + partly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABELS = path.resolve(process.argv[2] ?? path.join(HERE, 'labels-sonnet-60.jsonl'));
const SUMMARY = path.resolve(process.argv[3] ?? LABELS.replace(/\.jsonl$/, '.summary.json'));
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const rows = fs.readFileSync(LABELS, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const Z = 1.959964;

// ---- helpers
const wilson = (x, n) => {            // x may be fractional
  const p = x / n, d = 1 + Z * Z / n;
  const c = (p + Z * Z / (2 * n)) / d, h = (Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pct = (x) => +(100 * x).toFixed(1);
const ci = (a) => [pct(a[0]), pct(a[1])];

// ---- strata (draw.json: popSize = corpus stratum size incl. L1-a items; frameSize = popSize minus L1-a items)
const key = (r) => `${r.cluster}|${r.stratum}`;
const nh = {}; for (const r of rows) nh[key(r)] = (nh[key(r)] ?? 0) + 1;
const strata = draw.strata;
for (const k of Object.keys(nh)) if (!strata[k]) throw new Error('no stratum ' + k);

// ---- coverage
function covOf(r, reading, mode) {
  let e = r.explained;
  if (r.dashboardCriterion) { if (reading === 'conservative') e = 'no'; else if (reading === 'dashboardExplained') e = r.explainedIfDashboardExplained ?? e; }
  return mode === 'strict' ? (e === 'yes' ? 1 : 0) : (e === 'yes' || e === 'partly' ? 1 : 0);
}
function estimate(data, sizeField) {   // data: [{k, y}]
  const cnt = {}, ys = {}; for (const d of data) { cnt[d.k] = (cnt[d.k] ?? 0) + 1; ys[d.k] = (ys[d.k] ?? 0) + d.y; }
  let wsum = 0, w2 = 0, num = 0;
  for (const k of Object.keys(cnt)) { const N = strata[k][sizeField], w = N / cnt[k]; wsum += N; num += N * (ys[k] / cnt[k]); w2 += cnt[k] * w * w; }
  return { p: num / wsum, kish: (wsum * wsum) / w2, N: wsum };
}
function bootstrap(data, sizeField, seed, B = 5000) {
  const rnd = mulberry32(seed), by = {}; for (const d of data) (by[d.k] ??= []).push(d.y);
  const ps = [];
  for (let b = 0; b < B; b++) {
    let num = 0, den = 0;
    for (const [k, arr] of Object.entries(by)) { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[Math.floor(rnd() * arr.length)]; num += strata[k][sizeField] * (s / arr.length); den += strata[k][sizeField]; }
    ps.push(num / den);
  }
  ps.sort((a, c) => a - c); return [ps[Math.floor(0.025 * B)], ps[Math.ceil(0.975 * B) - 1]];
}
const coverage = {};
for (const reading of ['conservative', 'dashboardExplained', 'blind']) for (const mode of ['strict', 'lenient']) {
  const data = rows.map((r) => ({ k: key(r), y: covOf(r, reading, mode) }));
  const x = data.reduce((s, d) => s + d.y, 0), n = data.length;
  const e = estimate(data, 'popSize'), f = estimate(data, 'frameSize');
  coverage[`${reading}/${mode}`] = {
    unweighted: { x, n, p: pct(x / n), wilson: ci(wilson(x, n)) },
    postStratified: { p: pct(e.p), kishN: +e.kish.toFixed(1), wilsonAtKish: ci(wilson(e.p * e.kish, e.kish)), bootstrap: ci(bootstrap(data, 'popSize', 20261016)), targetItems: e.N },
    frameWeights: { p: pct(f.p), kishN: +f.kish.toFixed(1), wilsonAtKish: ci(wilson(f.p * f.kish, f.kish)), targetItems: f.N },
  };
}

// ---- census comparison on the same 60
const censusNotRefused = rows.filter((r) => r.census.status !== 'refused').length;
const cmp = {
  censusNotRefusedUnweighted: { x: censusNotRefused, n: rows.length, p: pct(censusNotRefused / rows.length) },
  censusStatusCounts: rows.reduce((m, r) => { m[r.census.status] = (m[r.census.status] ?? 0) + 1; return m; }, {}),
  refusalAgreement: rows.filter((r) => r.census.status === 'refused').map((r) => ({ d: r.drawOrder, census: r.census.irVerdict, labeller: r.refusal ?? (r.dashboardCriterion ? 'dashboard (explained as display-only)' : null), explained: r.explained })),
  explainedYesButCensusRefused: rows.filter((r) => r.census.status === 'refused' && r.explained === 'yes').map((r) => r.drawOrder),
  explainedNotYesButCensusAssigned: rows.filter((r) => r.census.status !== 'refused' && r.explained !== 'yes').map((r) => ({ d: r.drawOrder, explained: r.explained })),
};

// ---- detector precision (pairs judged yes / partly / no); precision = (yes + partly/2) / pairs
const val = { yes: 1, partly: 0.5, no: 0 };
const pairsAll = rows.flatMap((r) => r.detectors.map((d) => ({ ...d, d: r.drawOrder, refused: r.census.status === 'refused' })));
const prim = pairsAll.filter((p) => !p.refused);                         // primary: items the census does not refuse
const prec = (a) => (a.length ? a.reduce((s, p) => s + val[p.verdict], 0) / a.length : null);
const strict = (a) => (a.length ? a.filter((p) => p.verdict === 'yes').length / a.length : null);
function clusterBoot(rowsSel, pick, seed, B = 5000) {   // item-clustered bootstrap of (yes + partly/2) / pairs
  const rnd = mulberry32(seed), per = rowsSel.map((r) => { const a = pick(r); return [a.reduce((s, p) => s + val[p.verdict], 0), a.length]; });
  const ps = [];
  for (let b = 0; b < B; b++) { let s = 0, m = 0; for (let i = 0; i < per.length; i++) { const q = per[Math.floor(rnd() * per.length)]; s += q[0]; m += q[1]; } ps.push(m ? s / m : NaN); }
  ps.sort((a, c) => a - c); return [ps[Math.floor(0.025 * B)], ps[Math.ceil(0.975 * B) - 1]];
}
const rowsNR = rows.filter((r) => r.census.status !== 'refused');
const block = (a, pick) => ({ pairs: a.length, yes: a.filter((p) => p.verdict === 'yes').length, partly: a.filter((p) => p.verdict === 'partly').length, no: a.filter((p) => p.verdict === 'no').length,
  precision: +(prec(a)).toFixed(3), strictPrecision: +(strict(a)).toFixed(3), wilson: ci(wilson(prec(a) * a.length, a.length)), clusteredBootstrap: pick ? ci(clusterBoot(rowsNR, pick, 20261017)) : undefined });
const nodeTok = prim.filter((p) => p.via !== 'plumb');
const detectors = {
  nodeRuleAndToken: block(nodeTok, (r) => r.detectors.filter((p) => p.via !== 'plumb')),
  allPairs: block(prim, (r) => r.detectors),
  node: block(prim.filter((p) => p.via === 'node')),
  token: block(prim.filter((p) => p.via === 'token')),
  plumbing: block(prim.filter((p) => p.via === 'plumb')),
  p01Only: block(prim.filter((p) => p.pattern === 'P01')),
  allPairsIncludingCensusRefusedItems: block(pairsAll),
  l0Assignments: (() => { const a = rows.flatMap((r) => r.l0Assignments.map((x) => ({ verdict: x.verdict, c: x.construct }))); const o = block(a); o.byConstruct = Object.fromEntries([...new Set(a.map((x) => x.c))].map((c) => [c, block(a.filter((x) => x.c === c))])); return o; })(),
  bar: { pass: 'precision >= 0.85 with Wilson lower bound >= 0.75', falsifier: 'precision < 0.75', source: 'LIBRARY-TESTS L1-a / AUDIT-L1 §7' },
};
const byPattern = {};
for (const p of prim) (byPattern[p.pattern] ??= []).push(p);
detectors.byPattern = Object.fromEntries(Object.entries(byPattern).sort((a, b) => b[1].length - a[1].length).map(([k, a]) => [k, { pairs: a.length, yes: a.filter((p) => p.verdict === 'yes').length, partly: a.filter((p) => p.verdict === 'partly').length, no: a.filter((p) => p.verdict === 'no').length, precision: +prec(a).toFixed(2), items: a.map((p) => p.d) }]));
detectors.falsePairs = prim.filter((p) => p.verdict === 'no').map((p) => ({ d: p.d, pattern: p.pattern, via: p.via, why: p.why }));
// pass/fail
const g = detectors.nodeRuleAndToken;
detectors.decision = { nodeRuleAndToken: g.precision >= 0.85 && g.wilson[0] >= 75 ? 'PASS' : g.precision < 0.75 ? 'FAIL (falsifier met)' : 'FAIL (below bar)', allPairs: detectors.allPairs.precision < 0.75 ? 'below falsifier' : 'above falsifier' };

// ---- recall of the labeller's own pattern list against the detector set (non-refused items; L1 patterns only)
const REMOVED = new Set(['P02', 'P16', 'P17', 'P18', 'P30', 'P49']);
let found = 0, tot = 0, foundDet = 0, totDet = 0; const missCount = {};
for (const r of rowsNR) {
  const det = new Set([...Object.keys(r.census.needs).filter((p) => !p.startsWith('L0')), ...r.census.tokens.map((t) => t.p).filter(Boolean), ...r.census.plumbing]);
  for (const p of r.patterns) { tot++; if (det.has(p)) found++; else missCount[p] = (missCount[p] ?? 0) + 1; if (!REMOVED.has(p)) { totDet++; if (det.has(p)) foundDet++; } }
}
const recall = { all: { found, total: tot, recall: +(found / tot).toFixed(3), wilson: ci(wilson(found, tot)) }, excludingRemovedDetectors: { found: foundDet, total: totDet, recall: +(foundDet / totDet).toFixed(3), wilson: ci(wilson(foundDet, totDet)) },
  missedByPattern: Object.fromEntries(Object.entries(missCount).sort((a, b) => b[1] - a[1])), note: 'a blind pattern counts as found when it is anywhere in the census detector set of its item (needs, tokens or plumbing), not necessarily on the same nodes' };

// ---- gaps: every quoted fragment the vocabulary lacks
const gaps = rows.flatMap((r) => r.gaps.map((x) => ({ d: r.drawOrder, id: r.id, explained: r.explained, fragment: x.fragment, why: x.why })));
const gapItems = new Set(gaps.map((x) => x.d));
const refusals = rows.filter((r) => r.refusal).map((r) => ({ d: r.drawOrder, refusal: r.refusal, confidence: r.refusalConfidence }));

// ---- by cluster (unweighted, conservative strict)
const byCluster = {};
for (const r of rows) { const c = (byCluster[r.cluster] ??= { n: 0, yes: 0 }); c.n++; c.yes += covOf(r, 'conservative', 'strict'); }

const summary = { labels: path.relative(process.cwd(), LABELS), rows: rows.length, labeller: [...new Set(rows.map((r) => r.labeller))], seed: draw.seed,
  note: 'first-party has no unlabelled item (L1-a drew all 10), so the estimates are for the 1,549 non-first-party items; popSize weights treat the L1-a items as exchangeable with the frame',
  counts: { explained: rows.reduce((m, r) => { m[r.explained] = (m[r.explained] ?? 0) + 1; return m; }, {}), dashboardCriterionItems: rows.filter((r) => r.dashboardCriterion).map((r) => r.drawOrder), refusals, itemsWithGaps: gapItems.size, gapFragments: gaps.length },
  coverage, census: cmp, detectors, recall, byClusterConservativeStrict: byCluster, gaps };
fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 1) + '\n');
const L = (k) => { const c = coverage[k]; return `${c.postStratified.p}% (Wilson ${c.postStratified.wilsonAtKish.join('-')}, Kish n ${c.postStratified.kishN}; bootstrap ${c.postStratified.bootstrap.join('-')}; unweighted ${c.unweighted.x}/${c.unweighted.n} ${c.unweighted.p}% Wilson ${c.unweighted.wilson.join('-')})`; };
console.log('conservative strict   ', L('conservative/strict'));
console.log('dashboardExplained str', L('dashboardExplained/strict'));
console.log('blind strict          ', L('blind/strict'));
console.log('conservative lenient  ', L('conservative/lenient'));
console.log('detectors node+token  ', JSON.stringify(detectors.nodeRuleAndToken));
console.log('detectors all pairs   ', JSON.stringify(detectors.allPairs));
console.log('decision', JSON.stringify(detectors.decision), '; recall', JSON.stringify(recall.all), JSON.stringify(recall.excludingRemovedDetectors));
console.log('wrote', path.relative(process.cwd(), SUMMARY));
