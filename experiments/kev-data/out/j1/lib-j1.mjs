// J1 helpers (development stand-in; JUDGE-PROGRAM.md §6.0, §6.1). Loads a build slice joined with its meta sidecar
// into question rows, and computes the §6.1 metrics with a paired two-way cluster bootstrap over form x world.
// Only dev slices (train, calib-*, dev-*) are ever passed to loadSlice here; test slices are not read.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const WAVE_A = '/home/user/workflow-foundry/experiments/kev-data/out/wave-a-manifest.json';
export const manifest = () => JSON.parse(readFileSync(WAVE_A, 'utf8'));
const TEST = /^test/;

export function optionsOf(q) {
  if (q.type === 'choice') return Object.keys(q.criteria);
  if (q.type === 'noul') return ['false', 'true'];
  return q.criteria.map((_, i) => String(i));
}
export const labelOf = q => (q.type === 'noul' ? String(!!q.label) : String(q.label));

export function loadSlice(buildDir, slice) {
  if (TEST.test(slice)) throw new Error(`refusing to read ${slice}: test slices are read once, after the freeze`);
  const kev = readFileSync(path.join(buildDir, 'kev', `${slice}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const meta = new Map(readFileSync(path.join(buildDir, 'kev', `${slice}.meta.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => { const m = JSON.parse(l); return [m.id, m.meta]; }));
  const rows = [];
  for (const r of kev) {
    const m = meta.get(r._meta.id) ?? {};
    for (const [qid, q] of Object.entries(r.questions)) {
      const family = m.family ?? null;
      rows.push({ recId: r._meta.id, qid, family, portKey: `${qid}:${family}`, options: optionsOf(q), label: labelOf(q), type: q.type,
        instructions: q.instructions ?? '', criteria: q.criteria, state: r.state, formId: m.formId ?? r._meta.id, worldHash: m.worldHash ?? r._meta.id,
        source: m.surface?.source ?? null, wordingId: m.wordingId ?? null, variant: m.variant ?? null });
    }
  }
  return rows;
}

// ---- metrics ----------------------------------------------------------------------------------------------------
// item: { label, options, p: {opt: prob} , pred } ; prior: {opt: prob} (calib-OOD class prior)
export function brierOf(it) { return it.options.reduce((s, o) => s + ((it.p?.[o] ?? 0) - (o === it.label ? 1 : 0)) ** 2, 0); }
function pointMetrics(items, w, prior) {
  const labels = [...new Set(items.map(i => i.label))];
  let tot = 0, corr = 0, br = 0, brp = 0;
  const tp = new Map(), sup = new Map(), predc = new Map();
  for (let k = 0; k < items.length; k++) {
    const wk = w ? w[k] : 1; if (!wk) continue;
    const it = items[k]; tot += wk;
    const ok = it.pred === it.label; if (ok) corr += wk;
    sup.set(it.label, (sup.get(it.label) ?? 0) + wk); predc.set(it.pred, (predc.get(it.pred) ?? 0) + wk);
    if (ok) tp.set(it.label, (tp.get(it.label) ?? 0) + wk);
    if (it.p) br += wk * brierOf(it);
    if (prior) brp += wk * it.options.reduce((s, o) => s + ((prior[o] ?? 0) - (o === it.label ? 1 : 0)) ** 2, 0);
  }
  if (!tot) return null;
  const present = labels.filter(l => (sup.get(l) ?? 0) > 0);
  const recall = present.map(l => (tp.get(l) ?? 0) / sup.get(l));
  const f1 = present.map(l => { const t = tp.get(l) ?? 0, pr = predc.get(l) ? t / predc.get(l) : 0, rc = t / sup.get(l); return pr + rc ? (2 * pr * rc) / (pr + rc) : 0; });
  const out = { acc: corr / tot, bacc: recall.reduce((a, b) => a + b, 0) / recall.length, macroF1: f1.reduce((a, b) => a + b, 0) / f1.length };
  if (items[0].p) out.brier = br / tot;
  if (prior && items[0].p) out.bss = 1 - br / brp;
  return out;
}
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Two-way cluster bootstrap (forms x worlds): each resample draws forms and worlds with replacement, an item's weight is
// mult(form) * mult(world). 95% percentile interval. `B` resamples.
export function metricsWithCI(items, { prior = null, B = 10000, seed = 7 } = {}) {
  const point = pointMetrics(items, null, prior);
  if (!point) return null;
  const forms = [...new Set(items.map(i => i.formId))], worlds = [...new Set(items.map(i => i.worldHash))];
  const fi = new Map(forms.map((f, i) => [f, i])), wi = new Map(worlds.map((f, i) => [f, i]));
  const fIdx = items.map(i => fi.get(i.formId)), wIdx = items.map(i => wi.get(i.worldHash));
  const rng = mulberry32(seed), keys = Object.keys(point), draws = Object.fromEntries(keys.map(k => [k, []]));
  const fm = new Float64Array(forms.length), wm = new Float64Array(worlds.length), w = new Float64Array(items.length);
  for (let b = 0; b < B; b++) {
    fm.fill(0); wm.fill(0);
    for (let i = 0; i < forms.length; i++) fm[Math.floor(rng() * forms.length)]++;
    for (let i = 0; i < worlds.length; i++) wm[Math.floor(rng() * worlds.length)]++;
    for (let k = 0; k < items.length; k++) w[k] = fm[fIdx[k]] * wm[wIdx[k]];
    const m = pointMetrics(items, w, prior);
    if (m) for (const k of keys) if (Number.isFinite(m[k])) draws[k].push(m[k]);
  }
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
  const r4 = x => Math.round(x * 10000) / 10000;
  return { n: items.length, forms: forms.length, worlds: worlds.length, ...Object.fromEntries(keys.map(k => [k, { est: r4(point[k]), lo: r4(q(draws[k], 0.025)), hi: r4(q(draws[k], 0.975)) }])) };
}
export function majority(labels) { const c = new Map(); for (const l of labels) c.set(l, (c.get(l) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]; }
export function priorOf(labels) { const c = {}; for (const l of labels) c[l] = (c[l] ?? 0) + 1; const n = labels.length; for (const k in c) c[k] /= n; return c; }
