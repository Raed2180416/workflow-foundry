// J1 helpers (development stand-in; JUDGE-PROGRAM.md §6.0, §6.1). Loads a dev-select file (joined with its meta sidecar when that
// sidecar is trustworthy) into question rows, and computes the §6.1 metrics with a cluster bootstrap.
//
// Re-pointed 2026-10-09 for the owner's laptop, after the cloud container and its wave-A builds were lost:
//  - the wave-A manifest is the repository's (experiments/kev-data/out/wave-a-manifest.json);
//  - J1 reads the three dev-select files that survived (interactive, kinetics, runbook; KEV_J1_INPUTS), each checked against the
//    manifest's sha256 before use;
//  - a group's sidecar (.meta.jsonl: family, formId, worldHash) and its rebuilt train / calib-in slices are used ONLY when the laptop
//    rebuild (KEV_J1_REBUILD; build-wave-a.mjs with an empty held-out stub) reproduced the manifest's dev-select sha256 exactly.
//    Otherwise the group falls back: port key = question id, the bootstrap resamples records only (no form or world clustering, so
//    its intervals are likely too narrow: diagnostic only), and no train-fitted baseline exists for it.
// Only dev slices (train, calib-in, dev-select) are ever read here; test slices are refused, and calib-ood / dev-ood need the lost
// held-out material, so they do not exist on the laptop.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WAVE_A = fileURLToPath(new URL('../wave-a-manifest.json', import.meta.url));
export const manifest = () => JSON.parse(readFileSync(WAVE_A, 'utf8'));
export const J1_GROUPS = Object.freeze(['interactive', 'kinetics', 'runbook']);
export const WORK = process.env.KEV_J1_WORK ?? '/var/tmp/foundry-work/kev/j1';
export const INPUTS = process.env.KEV_J1_INPUTS ?? path.join(WORK, 'inputs');
export const REBUILD_ROOT = process.env.KEV_J1_REBUILD ?? '/var/tmp/foundry-work/kev/builds-rebuild';
const TEST = /^test/;
const sha = buf => createHash('sha256').update(buf).digest('hex');
const tagged = s => String(s).replace(/^sha256:/, '');

export function optionsOf(q) {
  if (q.type === 'choice') return Object.keys(q.criteria);
  if (q.type === 'noul') return ['false', 'true'];
  return q.criteria.map((_, i) => String(i));
}
export const labelOf = q => (q.type === 'noul' ? String(!!q.label) : String(q.label));
const readJsonl = f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// ---- where each group's data comes from ------------------------------------------------------------------------------------------
// The newest rebuild of a group under REBUILD_ROOT (its own manifest names the generator group).
function rebuildOf(group) {
  if (!existsSync(REBUILD_ROOT)) return null;
  const dirs = readdirSync(REBUILD_ROOT).filter(d => /^kd-[0-9a-f]{16}$/.test(d)).map(d => path.join(REBUILD_ROOT, d))
    .filter(d => existsSync(path.join(d, 'manifest.json')))
    .map(d => ({ d, m: JSON.parse(readFileSync(path.join(d, 'manifest.json'), 'utf8')) }))
    .filter(x => (x.m.generators ?? []).some(g => g.group === group))
    .sort((a, b) => statSync(path.join(b.d, 'manifest.json')).mtimeMs - statSync(path.join(a.d, 'manifest.json')).mtimeMs);
  return dirs[0] ?? null;
}
// Per group: the dev-select input (sha256 checked against the manifest), and the rebuild with a slice-by-slice comparison. The sidecar and
// the in-distribution slices are trusted only when the rebuilt dev-select file is byte-identical (sha256) to the manifest's.
export function sources({ m = manifest() } = {}) {
  const out = {};
  for (const group of J1_GROUPS) {
    const G = m.groups[group], want = tagged(G.slices['dev-select'].kev.sha256);
    const devFile = path.join(INPUTS, `${group}-dev-select-${want.slice(0, 12)}.jsonl`);
    if (!existsSync(devFile)) throw new Error(`J1 input missing: ${devFile}`);
    const got = sha(readFileSync(devFile));
    if (got !== want) throw new Error(`${devFile} hashes to ${got}, the manifest says ${want}`);
    const rb = rebuildOf(group);
    let rebuild = null;
    if (rb) {
      const slices = {};
      for (const s of Object.keys(rb.m.slices).filter(s => !TEST.test(s))) {
        const kevSha = tagged(rb.m.slices[s].files.kev.sha256), metaSha = tagged(rb.m.slices[s].files.meta.sha256);
        const orig = G.slices[s];
        slices[s] = { records: rb.m.slices[s].records, manifestRecords: orig?.records ?? null, kevSha256: kevSha, manifestKevSha256: orig ? tagged(orig.kev.sha256) : null,
          kevMatch: orig ? kevSha === tagged(orig.kev.sha256) : false, metaMatch: orig ? metaSha === tagged(orig.meta.sha256) : false,
          dropped: rb.m.slices[s].dropped, manifestDropped: orig?.dropped ?? null };
      }
      // the rebuilt dev-select must also be the very bytes of the surviving input
      const devRebuilt = path.join(rb.d, 'kev', 'dev-select.jsonl');
      const identical = existsSync(devRebuilt) && sha(readFileSync(devRebuilt)) === want;
      let lineDiff = null;
      if (!identical && existsSync(devRebuilt)) {        // which records differ (dev data only), by question id prefix
        const a = readFileSync(devFile, 'utf8').split('\n').filter(Boolean), b = readFileSync(devRebuilt, 'utf8').split('\n').filter(Boolean);
        const sa = new Set(a), sb = new Set(b), port = l => Object.keys(JSON.parse(l).questions)[0].split('~')[0];
        const count = xs => xs.reduce((acc, l) => ((acc[port(l)] = (acc[port(l)] ?? 0) + 1), acc), {});
        lineDiff = { identicalLines: a.filter(l => sb.has(l)).length, inputLines: a.length, rebuiltLines: b.length, onlyInInput: count(a.filter(l => !sb.has(l))), onlyInRebuild: count(b.filter(l => !sa.has(l))) };
      }
      rebuild = { dir: rb.d, buildId: rb.m.buildId, manifestBuildId: G.buildId, jobMaxState: rb.m.jobMaxState, manifestJobMaxState: G.jobMaxState, devSelectIdentical: identical, lineDiff, slices };
    }
    const verified = Boolean(rebuild?.devSelectIdentical && rebuild.slices['dev-select']?.metaMatch);
    out[group] = { group, devFile, devSha256: want, rebuild, verified,
      meta: verified ? path.join(rebuild.dir, 'kev', 'dev-select.meta.jsonl') : null,
      trainDir: verified ? path.join(rebuild.dir, 'kev') : null,
      clusters: verified ? 'form x world (rebuilt sidecar, verified)' : 'record only (no trustworthy sidecar): CIs form-unclustered, likely too narrow' };
  }
  return out;
}

// ---- rows ---------------------------------------------------------------------------------------------------------------------------
// One row per question. With a verified sidecar: port key `${qid}:${family}`, clusters form x world. Without: port key = qid, clusters =
// the record (formId = worldHash = record id; metricsWithCI resamples records only when every row has cluster 'record').
export function loadRows(kevFile, metaFile = null, { slice = 'dev-select' } = {}) {
  if (TEST.test(slice) || TEST.test(path.basename(kevFile))) throw new Error(`refusing to read ${slice}: test slices are read once, after the freeze`);
  const kev = readJsonl(kevFile);
  const meta = metaFile ? new Map(readJsonl(metaFile).map(m => [m.id, m.meta])) : null;
  const rows = [];
  for (const r of kev) {
    const m = meta ? meta.get(r._meta.id) : null;
    if (meta && !m) throw new Error(`${metaFile} has no row for ${r._meta.id}`);
    for (const [qid, q] of Object.entries(r.questions)) {
      const family = m?.family ?? null;
      rows.push({ recId: r._meta.id, qid, family, portKey: m ? `${qid}:${family}` : qid, options: optionsOf(q), label: labelOf(q), type: q.type,
        instructions: q.instructions ?? '', criteria: q.criteria, state: r.state, formId: m?.formId ?? r._meta.id, worldHash: m?.worldHash ?? r._meta.id,
        cluster: m ? 'form-world' : 'record', source: m?.surface?.source ?? null, wordingId: m?.wordingId ?? null, variant: m?.variant ?? null });
    }
  }
  return rows;
}
export const loadDev = src => loadRows(src.devFile, src.meta, { slice: 'dev-select' });
// A rebuilt in-distribution slice of a verified group (train, calib-in), with its sidecar.
export function loadSlice(buildKevDir, slice) {
  if (TEST.test(slice)) throw new Error(`refusing to read ${slice}: test slices are read once, after the freeze`);
  return loadRows(path.join(buildKevDir, `${slice}.jsonl`), path.join(buildKevDir, `${slice}.meta.jsonl`), { slice });
}
export const portOf = pk => pk.split(':')[0].split('~')[0];

// ---- metrics ----------------------------------------------------------------------------------------------------------------------
// item: { label, options, p: {opt: prob}, pred }; prior: {opt: prob} (a reference distribution for the Brier skill score)
export function brierOf(it) { return it.options.reduce((s, o) => s + ((it.p?.[o] ?? 0) - (o === it.label ? 1 : 0)) ** 2, 0); }
const priorBrier = (it, prior) => it.options.reduce((s, o) => s + ((prior[o] ?? 0) - (o === it.label ? 1 : 0)) ** 2, 0);
// the uniform reference: p = 1/k over the item's own options (fitted on nothing)
export const uniformBrier = it => (it.options.length - 1) / it.options.length;
function pointMetrics(items, w, prior) {
  const labels = [...new Set(items.map(i => i.label))];
  let tot = 0, corr = 0, br = 0, brp = 0, bru = 0;
  const tp = new Map(), sup = new Map(), predc = new Map();
  for (let k = 0; k < items.length; k++) {
    const wk = w ? w[k] : 1; if (!wk) continue;
    const it = items[k]; tot += wk;
    const ok = it.pred === it.label; if (ok) corr += wk;
    sup.set(it.label, (sup.get(it.label) ?? 0) + wk); predc.set(it.pred, (predc.get(it.pred) ?? 0) + wk);
    if (ok) tp.set(it.label, (tp.get(it.label) ?? 0) + wk);
    if (it.p) { br += wk * brierOf(it); bru += wk * uniformBrier(it); }
    if (prior) brp += wk * priorBrier(it, prior);
  }
  if (!tot) return null;
  const present = labels.filter(l => (sup.get(l) ?? 0) > 0);
  const recall = present.map(l => (tp.get(l) ?? 0) / sup.get(l));
  const f1 = present.map(l => { const t = tp.get(l) ?? 0, pr = predc.get(l) ? t / predc.get(l) : 0, rc = t / sup.get(l); return pr + rc ? (2 * pr * rc) / (pr + rc) : 0; });
  const out = { acc: corr / tot, bacc: recall.reduce((a, b) => a + b, 0) / recall.length, macroF1: f1.reduce((a, b) => a + b, 0) / f1.length };
  if (items[0].p) { out.brier = br / tot; out.bssUniform = 1 - br / bru; }
  if (prior && items[0].p) out.bss = 1 - br / brp;
  return out;
}
export function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Bootstrap weights: two-way (forms x worlds; an item's weight is mult(form) * mult(world)) when every item has a verified sidecar,
// one-way over records otherwise (a record's questions move together). B resamples, deterministic from `seed`.
export function bootstrapWeights(items, { B = 10000, seed = 7 } = {}) {
  const oneWay = items.some(i => i.cluster === 'record');
  const keyA = oneWay ? (i => i.recId) : (i => i.formId), keyB = oneWay ? null : (i => i.worldHash);
  const idx = key => { const ids = [...new Set(items.map(key))], m = new Map(ids.map((x, i) => [x, i])); return { n: ids.length, of: items.map(i => m.get(key(i))) }; };
  const A = idx(keyA), Bk = keyB ? idx(keyB) : null, rng = mulberry32(seed);
  const ma = new Float64Array(A.n), mb = Bk ? new Float64Array(Bk.n) : null;
  return { oneWay, units: oneWay ? { records: A.n } : { forms: A.n, worlds: Bk.n }, *draws() {
    for (let b = 0; b < B; b++) {
      ma.fill(0); for (let i = 0; i < A.n; i++) ma[Math.floor(rng() * A.n)]++;
      if (mb) { mb.fill(0); for (let i = 0; i < Bk.n; i++) mb[Math.floor(rng() * Bk.n)]++; }
      const w = new Float64Array(items.length);
      for (let k = 0; k < items.length; k++) w[k] = ma[A.of[k]] * (mb ? mb[Bk.of[k]] : 1);
      yield w;
    }
  } };
}
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
const r4 = x => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
// 95% percentile intervals.
export function metricsWithCI(items, { prior = null, B = 10000, seed = 7 } = {}) {
  const point = pointMetrics(items, null, prior);
  if (!point) return null;
  const bw = bootstrapWeights(items, { B, seed }), keys = Object.keys(point), draws = Object.fromEntries(keys.map(k => [k, []]));
  for (const w of bw.draws()) { const m = pointMetrics(items, w, prior); if (m) for (const k of keys) if (Number.isFinite(m[k])) draws[k].push(m[k]); }
  return { n: items.length, clusters: bw.oneWay ? 'record' : 'form x world', ...bw.units,
    ...Object.fromEntries(keys.map(k => [k, { est: r4(point[k]), lo: r4(q(draws[k], 0.025)), hi: r4(q(draws[k], 0.975)) }])) };
}
// Paired difference A - B over the same items (joined by recId|qid), resampled together; for each metric both arms have.
export function pairedDiffCI(itemsA, itemsB, { prior = null, B = 10000, seed = 11 } = {}) {
  const key = i => `${i.recId}|${i.qid}`, mb = new Map(itemsB.map(i => [key(i), i]));
  const A = itemsA.filter(i => mb.has(key(i))), Bs = A.map(i => mb.get(key(i)));
  if (!A.length) return null;
  const pa = pointMetrics(A, null, prior), pb = pointMetrics(Bs, null, prior), keys = Object.keys(pa).filter(k => k in pb);
  const bw = bootstrapWeights(A, { B, seed }), draws = Object.fromEntries(keys.map(k => [k, []]));
  for (const w of bw.draws()) { const ma = pointMetrics(A, w, prior), mbb = pointMetrics(Bs, w, prior); if (ma && mbb) for (const k of keys) if (Number.isFinite(ma[k] - mbb[k])) draws[k].push(ma[k] - mbb[k]); }
  return { n: A.length, clusters: bw.oneWay ? 'record' : 'form x world', ...Object.fromEntries(keys.map(k => [k, { est: r4(pa[k] - pb[k]), lo: r4(q(draws[k], 0.025)), hi: r4(q(draws[k], 0.975)) }])) };
}
export function majority(labels) { const c = new Map(); for (const l of labels) c.set(l, (c.get(l) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]; }
export function priorOf(labels) { const c = {}; for (const l of labels) c[l] = (c[l] ?? 0) + 1; const n = labels.length; for (const k in c) c[k] /= n; return c; }

// node lib-j1.mjs --sources <out.json>: the rebuild check (hashes and counts only)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--sources') {
  const s = sources();
  const out = { schema: 'kev-j1/sources@1', generatedAt: new Date().toISOString(), manifest: path.relative(process.cwd(), WAVE_A), inputs: INPUTS, rebuildRoot: REBUILD_ROOT, groups: s };
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(out, null, 1) + '\n');
  for (const g of Object.values(s)) console.log(g.group, 'verified', g.verified, 'clusters', g.clusters, g.rebuild ? JSON.stringify(Object.fromEntries(Object.entries(g.rebuild.slices).map(([k, v]) => [k, `${v.records}/${v.manifestRecords} kev ${v.kevMatch ? 'match' : 'DIFFER'} meta ${v.metaMatch ? 'match' : 'DIFFER'}`]))) : 'no rebuild', g.rebuild?.lineDiff ? JSON.stringify(g.rebuild.lineDiff) : '');
}
