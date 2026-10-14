// agreement.mjs: the numbers of AUDIT-L1-REAUDIT.md that analyze-labels.mjs does not give. $0; reads the two blind label
// files, the draws, the adjudication of the 10 shared items, and (for the pooled and known-count variants) the L1-a label
// file, the revised census rows and the corpus index. No model, no Jev, no network, nothing under beds/.
// Usage (repo root):  node research/jit-20261008/design/library/out/L1-reaudit/agreement.mjs
// Writes out/L1-reaudit/agreement.json and prints a summary.
//
//  1. inter-rater agreement on the 10 shared items (sonnet-60 vs opus-10): explained (raw agreement, Cohen's kappa;
//     three-way and the strict and lenient binary cuts), blind pattern-set and L0 construct-set Jaccard, and agreement on
//     the detector-pair verdicts both labellers gave; each labeller and the adjudication (adjudication-10.json) side by side;
//  2. coverage on the 10 by each labeller (unweighted and design-weighted);
//  3. coverage sensitivities on the 60: the pre-specified estimator (analyze-labels.mjs, re-derived here as a check), the 10
//     adjudicated calls substituted, the dashboard items as an exactly known stratum (the census flags all 16), and the
//     two audits pooled (L1-a's 60 + these 60 = 120 labels on the revision-1 strata).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const ROOT = path.resolve(HERE, '../../../../../..');
const jsonl = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const S = new Map(jsonl(path.join(HERE, 'labels-sonnet-60.jsonl')).map((r) => [r.drawOrder, r]));
const O = jsonl(path.join(HERE, 'labels-opus-10.jsonl')).sort((a, b) => a.subOrder - b.subOrder);
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const ADJ = new Map(JSON.parse(fs.readFileSync(path.join(HERE, 'adjudication-10.json'), 'utf8')).items.map((a) => [a.drawOrder, a]));
const L1A = jsonl(path.join(OUT, 'L1-audit-labels.jsonl'));
const CENSUS = jsonl(path.join(OUT, 'pattern-census-items.jsonl'));
const Z = 1.959964;

// ---- helpers
const wilson = (x, n) => { const p = x / n, d = 1 + Z * Z / n; const c = (p + Z * Z / (2 * n)) / d, h = (Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n))) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; };
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pct = (x) => +(100 * x).toFixed(1);
const ci = (a) => [pct(a[0]), pct(a[1])];
const r3 = (x) => (x == null || Number.isNaN(x) ? null : +x.toFixed(3));
function kappa(a, b) {                       // Cohen's kappa for two equal-length categorical vectors
  const n = a.length, cats = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = cats.reduce((s, c) => s + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n), 0);
  return { n, agree: a.filter((x, i) => x === b[i]).length, po: r3(po), pe: r3(pe), kappa: pe === 1 ? null : r3((po - pe) / (1 - pe)) };
}
const jac = (a, b) => { const A = new Set(a), B = new Set(b); const u = new Set([...A, ...B]); return u.size ? [...A].filter((x) => B.has(x)).length / u.size : 1; };
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// ---- L0 construct names (card rows 1-30); the sonnet file uses names, the opus file row numbers
const L0 = ['input', 'step', 'judge', 'guard', 'invariant', 'map', 'flag', 'note', 'done', 'if', 'call', 'agent', 'wide', 'plan', 'effect', 'approve', 'ask', 'wait.delay', 'wait.signal', 'retry', 'route.error', 'finally', 'compensate', 'trigger.webhook', 'trigger.schedule', 'trigger.event', 'state', 'admission', 'session', 'stream'];
const normL0 = (x) => (typeof x === 'number' ? L0[x - 1] : ({ for: 'if', join: 'if', 'trigger.poll': 'trigger.event' }[x] ?? x));
const BOOKKEEPING = new Set(['input', 'step', 'note', 'done']);

// ---- 1. explained on the 10 shared items
const readings = {
  conservative: { s: (r) => (r.dashboardCriterion ? 'no' : r.explained), o: (o) => o.explained, a: (a) => a.explained.conservative },
  dashboardExplained: { s: (r) => (r.dashboardCriterion ? (r.explainedIfDashboardExplained ?? r.explained) : r.explained), o: (o) => o.explainedDashboardExplained ?? o.explained, a: (a) => a.explained.dashboardExplained },
};
const cut = { threeWay: (x) => x, strict: (x) => (x === 'yes' ? 'yes' : 'not'), lenient: (x) => (x === 'no' ? 'no' : 'explained') };
const explained = {};
for (const [rk, R] of Object.entries(readings)) {
  const s = O.map((o) => R.s(S.get(o.drawOrder))), o = O.map(R.o), a = O.map((x) => R.a(ADJ.get(x.drawOrder)));
  explained[rk] = { items: O.map((x, i) => ({ d: x.drawOrder, sonnet: s[i], opus: o[i], adjudicated: a[i] })) };
  for (const [ck, f] of Object.entries(cut)) explained[rk][ck] = { sonnetVsOpus: kappa(s.map(f), o.map(f)), sonnetVsAdjudicated: kappa(s.map(f), a.map(f)), opusVsAdjudicated: kappa(o.map(f), a.map(f)) };
}

// ---- 2. coverage on the 10 by each labeller (unweighted; design weight N_h / k_h of the 60-item draw, Kish n)
function cov10(get) {
  const out = {};
  for (const [ck, ok] of Object.entries({ strict: (x) => x === 'yes', lenient: (x) => x !== 'no' })) {
    const y = O.map((o) => (ok(get(o)) ? 1 : 0)), x = y.reduce((s, v) => s + v, 0);
    const w = O.map((o) => { const st = draw.strata[`${o.cluster}|${o.stratum}`]; return st.popSize / st.sampled; });
    const W = w.reduce((s, v) => s + v, 0), p = w.reduce((s, v, i) => s + v * y[i], 0) / W, kish = W * W / w.reduce((s, v) => s + v * v, 0);
    out[ck] = { unweighted: { x, n: 10, p: pct(x / 10), wilson: ci(wilson(x, 10)) }, weighted: { p: pct(p), kishN: +kish.toFixed(1), wilsonAtKish: ci(wilson(p * kish, kish)) } };
  }
  return out;
}
const coverage10 = {};
for (const [rk, R] of Object.entries(readings)) coverage10[rk] = { sonnet: cov10((o) => R.s(S.get(o.drawOrder))), opus: cov10(R.o), adjudicated: cov10((o) => R.a(ADJ.get(o.drawOrder))) };

// ---- 3. pattern-set and L0-set Jaccard
const adjSet = (o) => {                      // agreed patterns stand; disputed ones take the adjudicated verdict (yes or partly = present)
  const s = new Set(S.get(o.drawOrder).patterns), b = new Set(o.patterns), a = ADJ.get(o.drawOrder);
  const set = new Set([...s].filter((p) => b.has(p)));
  for (const p of a.patterns) if (p.verdict !== 'no') set.add(p.p);
  for (const p of [...s, ...b]) if (!(s.has(p) && b.has(p)) && !a.patterns.some((q) => q.p === p)) throw new Error(`no adjudication for #${o.drawOrder} ${p}`);
  return [...set];
};
const sets = O.map((o) => {
  const s = S.get(o.drawOrder), aset = adjSet(o);
  const sl0 = [...new Set(s.l0.map(normL0))], ol0 = [...new Set(o.l0.map(normL0))];
  return { d: o.drawOrder, sonnet: [...s.patterns].sort(), opus: [...o.patterns].sort(), adjudicated: aset.sort(),
    jPatterns: r3(jac(s.patterns, o.patterns)), jSonnetAdj: r3(jac(s.patterns, aset)), jOpusAdj: r3(jac(o.patterns, aset)),
    l0Sonnet: sl0.sort(), l0Opus: ol0.sort(), jL0: r3(jac(sl0, ol0)), jL0NoBookkeeping: r3(jac(sl0.filter((x) => !BOOKKEEPING.has(x)), ol0.filter((x) => !BOOKKEEPING.has(x)))) };
});
const jaccard = { perItem: sets, mean: { patterns: r3(mean(sets.map((x) => x.jPatterns))), sonnetVsAdjudicated: r3(mean(sets.map((x) => x.jSonnetAdj))), opusVsAdjudicated: r3(mean(sets.map((x) => x.jOpusAdj))), l0: r3(mean(sets.map((x) => x.jL0))), l0NoBookkeeping: r3(mean(sets.map((x) => x.jL0NoBookkeeping))) },
  equalPatternSets: sets.filter((x) => x.jPatterns === 1).length, patternPairs: { sonnet: sets.reduce((s, x) => s + x.sonnet.length, 0), opus: sets.reduce((s, x) => s + x.opus.length, 0), both: sets.reduce((s, x) => s + x.sonnet.filter((p) => x.opus.includes(p)).length, 0) } };

// ---- 4. detector-pair verdicts both labellers gave
const grp = (p, via) => (p.startsWith('L0') ? 'l0' : /plumb/.test(via) ? 'plumbing' : 'rule');
const pairs = [];
for (const o of O) {
  const s = S.get(o.drawOrder), a = ADJ.get(o.drawOrder);
  const sm = new Map(); for (const x of s.detectors) if (!sm.has(x.pattern)) sm.set(x.pattern, x); for (const x of s.l0Assignments) sm.set(x.construct, { pattern: x.construct, via: 'node', verdict: x.verdict });
  const om = new Map(); for (const x of o.census.detectors) if (x.via !== 'ir-verdict') om.set(x.p, x);
  for (const p of new Set([...sm.keys(), ...om.keys()])) {
    const sv = sm.get(p)?.verdict, ov = om.get(p)?.verdict, via = (om.get(p) ?? sm.get(p)).via;
    let adj = null;
    if (sv && ov) adj = sv === ov ? sv : a.detectorPairs.find((q) => q.p === p)?.adjudicated;
    if (sv && ov && !adj) throw new Error(`no adjudication for #${o.drawOrder} ${p}`);
    pairs.push({ d: o.drawOrder, p, group: grp(p, via), sonnet: sv ?? null, opus: ov ?? null, adjudicated: adj });
  }
}
const val = { yes: 1, partly: 0.5, no: 0 };
const precOf = (xs, k) => { const v = xs.map((x) => x[k]); const y = v.filter((x) => x === 'yes').length, pa = v.filter((x) => x === 'partly').length, no = v.filter((x) => x === 'no').length; const p = (y + pa / 2) / v.length; return { pairs: v.length, yes: y, partly: pa, no, precision: r3(p), wilson: ci(wilson(p * v.length, v.length)) }; };
const shared = pairs.filter((x) => x.sonnet && x.opus);
const detectorAgreement = { onlyOneLabeller: pairs.filter((x) => !(x.sonnet && x.opus)) };
for (const g of ['rule', 'plumbing', 'l0', 'all']) {
  const xs = shared.filter((x) => g === 'all' || x.group === g);
  detectorAgreement[g] = { verdicts: kappa(xs.map((x) => x.sonnet), xs.map((x) => x.opus)), sonnetHigher: xs.filter((x) => val[x.sonnet] > val[x.opus]).length, opusHigher: xs.filter((x) => val[x.opus] > val[x.sonnet]).length,
    precision: { sonnet: precOf(xs, 'sonnet'), opus: precOf(xs, 'opus'), adjudicated: precOf(xs, 'adjudicated') } };
}
detectorAgreement.disputed = shared.filter((x) => x.sonnet !== x.opus);

// ---- 5. coverage sensitivities on the full draws
const CL = { automation: ['activepieces', 'coze', 'dify', 'flowise', 'langflow', 'n8n', 'node-red', 'zapier'], orchestration: ['airflow', 'argo', 'dagster', 'github-actions', 'gitlab-ci', 'kubeflow', 'prefect', 'tekton', 'temporal'], science: ['cwl', 'galaxy', 'nextflow', 'nf-core', 'snakemake', 'wdl'], 'consumer-creative': ['apple-shortcuts', 'comfyui', 'home-assistant', 'ifttt'] };
const clusterOf = (p) => (p === 'claude-code-workflows' ? 'first-party' : Object.entries(CL).find(([, v]) => v.includes(p))?.[0] ?? 'agentic');
const stratumOf = (r) => { const cl = clusterOf(r.plat), n = Object.keys(r.needs).filter((p) => !p.startsWith('L0')).length; if (r.status === 'refused') return cl === 'agentic' ? 'R' : 'A'; return n <= 1 ? 'A' : n <= 4 ? 'B' : 'C'; };
const cen = new Map(CENSUS.map((r) => [r.id, r]));
const keyOf = (id) => { const r = cen.get(id); return `${clusterOf(r.plat)}|${stratumOf(r)}`; };
// the dashboard set: Node-RED items with >= 20 ui_* nodes (revision-1 criterion) or the corpus IR refusal for dashboard state
const DASH = new Set();
for (const line of fs.readFileSync(path.join(ROOT, 'research/corpus-20261006/items.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const it = JSON.parse(line), plat = it.id.split(':')[0];
  const w = plat === 'node-red' ? it.graph.nodes.filter((n) => /^ui_/.test(n.type ?? '')).length : 0;
  if ((plat === 'node-red' && w >= 20) || /interactive-dashboard/.test(String(it.ir?.verdict ?? ''))) DASH.add(it.id);
}
const pop = {}; for (const r of CENSUS) { const k = keyOf(r.id); pop[k] = (pop[k] ?? 0) + 1; }
const dashKeys = [...new Set([...DASH].map(keyOf))];
// generic post-stratified estimator: data [{k, y}], sizes {k: N}; known {N, c}: an exactly known part added outside the sample
function estimate(data, sizes, known, seed) {
  const cnt = {}, ys = {}, by = {};
  for (const d of data) { cnt[d.k] = (cnt[d.k] ?? 0) + 1; ys[d.k] = (ys[d.k] ?? 0) + d.y; (by[d.k] ??= []).push(d.y); }
  let Ns = 0, num = 0, w2 = 0;
  for (const k of Object.keys(cnt)) { const N = sizes[k]; if (N == null) throw new Error('no size for ' + k); const w = N / cnt[k]; Ns += N; num += N * ys[k] / cnt[k]; w2 += cnt[k] * w * w; }
  const ps = num / Ns, kish = Ns * Ns / w2, KN = known?.N ?? 0, KC = known?.c ?? 0, N = Ns + KN;
  const scale = (x) => (Ns * x + KN * KC) / N;
  const rnd = mulberry32(seed), bs = [];
  for (let b = 0; b < 5000; b++) { let nu = 0; for (const [k, arr] of Object.entries(by)) { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[Math.floor(rnd() * arr.length)]; nu += sizes[k] * s / arr.length; } bs.push(scale(nu / Ns)); }
  bs.sort((a, c) => a - c);
  const wl = wilson(ps * kish, kish);
  return { p: pct(scale(ps)), wilsonAtKish: ci([scale(wl[0]), scale(wl[1])]), kishN: +kish.toFixed(1), bootstrap: ci([bs[124], bs[4874]]), items: N, labels: data.length };
}
const yS = { strict: (e) => (e === 'yes' ? 1 : 0), lenient: (e) => (e === 'no' ? 0 : 1) };
const sonnetRows = [...S.values()];
const sonnetE = (r, rk, adj) => { const a = adj && ADJ.get(r.drawOrder); if (a) return readings[rk].a(a); return readings[rk].s(r); };
const l1aE = (r, rk) => (DASH.has(r.id) ? (rk === 'conservative' ? 'no' : 'yes') : r.explained);   // AUDIT-L1 §0 item 2: both of its dashboard items read as explained in the sensitivity
const drawSizes = Object.fromEntries(Object.entries(draw.strata).map(([k, v]) => [k, v.popSize]));
const coverage60 = {};
for (const rk of Object.keys(readings)) for (const mode of ['strict', 'lenient']) {
  const tag = `${rk}/${mode}`, f = yS[mode];
  const reaudit = sonnetRows.map((r) => ({ k: `${r.cluster}|${r.stratum}`, y: f(sonnetE(r, rk, false)), dash: DASH.has(r.id), id: r.id }));
  const reauditAdj = sonnetRows.map((r) => ({ k: `${r.cluster}|${r.stratum}`, y: f(sonnetE(r, rk, true)), dash: DASH.has(r.id), id: r.id }));
  const l1a = L1A.map((r) => ({ k: keyOf(r.id), y: f(l1aE(r, rk)), dash: DASH.has(r.id), id: r.id }));
  // known-count: the dashboard items leave their stratum and form a stratum the census enumerates exactly (16 items)
  const knownVariant = (rows, sizes, seed) => {
    const nd = rows.filter((x) => !x.dash), dl = rows.filter((x) => x.dash);
    const sz = { ...sizes }; for (const k of dashKeys) sz[k] -= [...DASH].filter((id) => keyOf(id) === k).length;
    const c = rk === 'conservative' ? 0 : (dl.length ? dl.reduce((s, x) => s + x.y, 0) / dl.length : 1);
    return { ...estimate(nd, sz, { N: DASH.size, c }, seed), dashboardStratum: { N: DASH.size, labelled: dl.length, coverage: c, exact: rk === 'conservative' } };
  };
  coverage60[tag] = {
    reauditPrespecified: estimate(reaudit, drawSizes, null, 20261016),
    reauditAdjudicated10: estimate(reauditAdj, drawSizes, null, 20261016),
    reauditKnownDashboard: knownVariant(reaudit, drawSizes, 20261016),
    pooled120: estimate([...reaudit, ...l1a], pop, null, 20261018),
    pooled120KnownDashboard: knownVariant([...reaudit, ...l1a], pop, 20261018),
    l1aOnRevision1Strata: estimate(l1a, pop, null, 20261018),
  };
}

const result = { generated: 'agreement.mjs', dashboardSet: { n: DASH.size, strata: dashKeys, ids: [...DASH].sort() }, explained, coverage10, jaccard, detectorAgreement, coverage60 };
fs.writeFileSync(path.join(HERE, 'agreement.json'), JSON.stringify(result, null, 1) + '\n');
const ex = explained.conservative;
console.log('explained, conservative: three-way', JSON.stringify(ex.threeWay.sonnetVsOpus), 'strict', JSON.stringify(ex.strict.sonnetVsOpus), 'lenient', JSON.stringify(ex.lenient.sonnetVsOpus));
console.log('explained, dashboardExplained: three-way', JSON.stringify(explained.dashboardExplained.threeWay.sonnetVsOpus), 'strict', JSON.stringify(explained.dashboardExplained.strict.sonnetVsOpus));
console.log('jaccard', JSON.stringify(jaccard.mean), 'equal sets', jaccard.equalPatternSets, JSON.stringify(jaccard.patternPairs));
console.log('detector rule pairs', JSON.stringify(detectorAgreement.rule));
for (const [k, v] of Object.entries(coverage60)) console.log(k, Object.entries(v).map(([n, e]) => `${n} ${e.p} (${e.wilsonAtKish.join('-')}; boot ${e.bootstrap.join('-')}; Kish ${e.kishN})`).join(' | '));
console.log('wrote', path.relative(process.cwd(), path.join(HERE, 'agreement.json')));
