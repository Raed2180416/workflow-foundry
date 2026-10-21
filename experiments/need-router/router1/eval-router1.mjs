// ROUTER-1 evaluation (PREREG-ROUTER-1.md §2-§4): every system on one split, the step-4 middle-band choice on dev, and the
// endpoints E1-E7 on test. Reads the frozen set, the frozen router (src/need/) and the judge rows in router1/runs/.
//
//   node experiments/need-router/router1/eval-router1.mjs --split dev --select     # step 4: choose (judge, delta) on dev, write it into params.json
//   node experiments/need-router/router1/eval-router1.mjs --split test             # step 5: every system on test, results/test.json + RESULTS-test.md
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODES } from '../../../src/need/judge-prompt.mjs';
// --router v1 evaluates the preregistered frozen router (f9641ff9 + delta 0, copied to frozen-v1/); the default is the shipped v1.1 (src/need/).
const ROUTER_VERSION = (() => { const i = process.argv.indexOf('--router'); return i > 0 ? process.argv[i + 1] : 'v1.1'; })();
if (!['v1', 'v1.1'].includes(ROUTER_VERSION)) throw new Error('--router v1|v1.1');
const { needCheck, loadParams, thresholdAt, paramsSha } = await import(ROUTER_VERSION === 'v1' ? './frozen-v1/router.mjs' : '../../../src/need/router.mjs');
import { loadSet, readJsonl, rowsFile, DIR } from './judges.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const RESULTS = path.join(DIR, 'results');
export const DELTAS = [0, 0.1, 0.2, 0.3, 0.4];
export const JUDGE_ORDER = ['jev', 'mercury', 'haiku'];          // cheapest first (listed price), the step-4 tie-break
export const SLIDER = [0, 0.25, 0.5, 0.75, 1];
export const KEYWORDS = ['workflow', 'automate', 'automation', 'every', 'daily', 'weekly', 'monthly', 'whenever', 'recurring', 'schedule', 'approval', 'approve', 'process', 'pipeline', 'monitor'];
const KEYWORD_RE = new RegExp(`\\b(?:${KEYWORDS.join('|')})\\b`, 'i');
const INDEPENDENT = new Set(['mercury', 'ab-devtrain', 'ab-simple', 'anchor', 'abr-policy', 'ebed-spec']);

// ---------- statistics ----------
export function confusion(golds, preds) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  golds.forEach((g, i) => { const p = preds[i]; if (g && p) tp++; else if (!g && p) fp++; else if (g && !p) fn++; else tn++; });
  const precision = tp + fp ? tp / (tp + fp) : null, recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  return { tp, fp, fn, tn, precision: r4(precision), recall: r4(recall), f1: r4(f1), accuracy: r4((tp + tn) / golds.length) };
}
export function auroc(golds, scores) {
  const pos = [], neg = [];
  golds.forEach((g, i) => (g ? pos : neg).push(scores[i]));
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return r4(s / (pos.length * neg.length));
}
function logChoose(n, k) { let s = 0; for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i); return s; }
function binomCdf(x, n, p) {
  if (p <= 0) return 1; if (p >= 1) return x >= n ? 1 : 0;
  let s = 0; for (let k = 0; k <= x; k++) s += Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p)); return Math.min(1, s);
}
/** Clopper-Pearson 95% two-sided upper bound on a rate with x events in n. */
export function cpUpper(x, n, alpha = 0.05) {
  if (x >= n) return 1;
  let lo = x / n, hi = 1;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (binomCdf(x, n, mid) > alpha / 2) lo = mid; else hi = mid; }
  return r4(hi);
}
/** Exact McNemar: two-sided binomial test on the discordant pairs. */
export function mcnemar(correctA, correctB) {
  let b = 0, c = 0;
  correctA.forEach((a, i) => { if (a && !correctB[i]) b++; else if (!a && correctB[i]) c++; });
  const n = b + c, k = Math.min(b, c);
  const p = n ? Math.min(1, 2 * binomCdf(k, n, 0.5)) : 1;
  return { aOnly: b, bOnly: c, p: r4(p) };
}
function mulberry32(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Paired bootstrap over items of F1(A) - F1(B): 95% percentile interval. */
export function bootstrapDeltaF1(golds, predsA, predsB, { reps = 2000, seed = 20261021 } = {}) {
  const rnd = mulberry32(seed), n = golds.length, ds = [];
  for (let r = 0; r < reps; r++) {
    const idx = Array.from({ length: n }, () => Math.floor(rnd() * n));
    const g = idx.map(i => golds[i]);
    ds.push(confusion(g, idx.map(i => predsA[i])).f1 - confusion(g, idx.map(i => predsB[i])).f1);
  }
  ds.sort((a, b) => a - b);
  return { delta: r4(confusion(golds, predsA).f1 - confusion(golds, predsB).f1), lo: r4(ds[Math.floor(0.025 * reps)]), hi: r4(ds[Math.ceil(0.975 * reps) - 1]), reps, seed };
}
function quantile(xs, q) { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return null; return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }
const r4 = x => (x === null || x === undefined ? null : Math.round(x * 1e4) / 1e4);

// ---------- systems ----------
function judgeRows(judge, split) {
  const rows = readJsonl(rowsFile(judge, split)).filter(r => r.ok);
  const by = new Map();
  for (const r of rows) by.set(`${r.id}|${r.sample ?? 0}`, r);
  return by;
}
export function lengthThreshold(devItems) {
  const gs = devItems.map(it => it.gold.needsWorkflow), ls = devItems.map(it => it.text.length);
  let best = { t: Infinity, f1: -1 };
  for (const t of [...new Set(ls)].sort((a, b) => a - b)) { const f1 = confusion(gs, ls.map(l => l >= t)).f1; if (f1 > best.f1) best = { t, f1 }; }
  return best.t;
}

/** One decision per item per system: { needsWorkflow, p, mode, costUsd, latencyMs, fault } */
export function decide(items, split, { params = loadParams(), devItems = null, middle = params.middle } = {}) {
  const lenT = lengthThreshold(devItems ?? loadSet().filter(it => it.split === 'dev'));
  const J = Object.fromEntries(JUDGE_ORDER.map(j => [j, judgeRows(j, split)]));
  const out = { never: [], always: [], length: [], keyword: [], router: [], haiku: [], haiku1: [], mercury: [], jev: [] };
  for (const it of items) {
    out.never.push({ needsWorkflow: false, p: 0, mode: 'none', costUsd: 0 });
    out.always.push({ needsWorkflow: true, p: 1, mode: 'workflow', costUsd: 0 });
    out.length.push({ needsWorkflow: it.text.length >= lenT, p: it.text.length, mode: it.text.length >= lenT ? 'workflow' : 'none', costUsd: 0 });
    const kw = KEYWORD_RE.test(it.text);
    out.keyword.push({ needsWorkflow: kw, p: kw ? 1 : 0, mode: kw ? 'workflow' : 'none', costUsd: 0 });
    const reps = 5, t0 = process.hrtime.bigint(); let c;
    for (let k = 0; k < reps; k++) c = needCheck(it.text, { params });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / reps;
    out.router.push({ needsWorkflow: c.needsWorkflow, p: c.p, mode: c.mode, costUsd: 0, latencyMs: ms, card: c });
    for (const [name, judge, s] of [['haiku', 'haiku', 0], ['haiku1', 'haiku', 1], ['mercury', 'mercury', 0], ['jev', 'jev', 0]]) {
      const r = J[judge].get(`${it.id}|${s}`);
      out[name].push(r ? { needsWorkflow: r.needsWorkflow, p: r.p, mode: r.mode, costUsd: r.costUsd ?? 0, latencyMs: r.latencyMs ?? null, tokens: r.usage ?? (r.inputTokens ? { inputTokens: r.inputTokens } : null), served: r.served ?? null }
        : { missing: true, needsWorkflow: null, p: null, mode: null, costUsd: 0 });
    }
  }
  if (middle) out.final = hybrid(out, params, middle);
  return out;
}

/** router+J at the default slider: J decides only for items whose code p is in [t - delta, t); a missing or faulted judge row falls back to the code decision. */
export function hybrid(out, params, { judge, delta }, sensitivity = 0.5) {
  const t = thresholdAt(sensitivity, params.tDefault);
  return out.router.map((r, i) => {
    if (!judge || !(delta > 0) || !(r.p >= t - delta && r.p < t)) return { ...r, needsWorkflow: r.p >= t, band: r.p >= t ? 'above' : 'below' };
    const j = out[judge][i];
    if (j.missing) return { ...r, needsWorkflow: r.p >= t, band: 'middle', fallback: true };
    const yes = j.needsWorkflow === true;
    return { ...r, needsWorkflow: yes, mode: yes ? j.mode : r.mode, band: 'middle', judged: true, costUsd: j.costUsd ?? 0, latencyMs: (r.latencyMs ?? 0) + (j.latencyMs ?? 0) };
  });
}

function summarize(items, ds, { withAuroc = true } = {}) {
  const present = ds.map((d, i) => (d.missing ? null : i)).filter(i => i !== null);
  const g = present.map(i => items[i].gold.needsWorkflow), p = present.map(i => ds[i].needsWorkflow);
  const c = confusion(g, p);
  const negN = g.filter(x => !x).length;
  const modeAcc = present.filter(i => ds[i].mode === items[i].gold.mode).length / (present.length || 1);
  const cost = present.map(i => ds[i].costUsd ?? 0), lat = present.map(i => ds[i].latencyMs).filter(Number.isFinite);
  return { n: present.length, missing: ds.length - present.length, ...c, fpRateUpper95: cpUpper(c.fp, negN), negatives: negN, positives: g.length - negN,
    auroc: withAuroc ? auroc(g, present.map(i => ds[i].p)) : null, modeAccuracy: r4(modeAcc),
    costPerDecisionUsd: cost.length ? cost.reduce((a, b) => a + b, 0) / cost.length : 0, costTotalUsd: cost.reduce((a, b) => a + b, 0),
    latencyMedianMs: r4(quantile(lat, 0.5)), latencyP95Ms: r4(quantile(lat, 0.95)) };
}

export function modeConfusion(items, ds) {
  const m = Object.fromEntries(MODES.map(a => [a, Object.fromEntries(MODES.map(b => [b, 0]))]));
  items.forEach((it, i) => { if (!ds[i].missing && ds[i].mode) m[it.gold.mode][ds[i].mode]++; });
  return m;
}

/** Step 4 (dev only): highest dev recall with 0 dev FP over J x delta; ties -> cheaper judge, then smaller delta. */
export function selectMiddle(devItems, out, params, judges = JUDGE_ORDER) {
  const table = [];
  for (const judge of judges) {
    if (out[judge].every(d => d.missing)) continue;
    for (const delta of DELTAS) {
      const h = hybrid(out, params, { judge, delta });
      const c = confusion(devItems.map(it => it.gold.needsWorkflow), h.map(d => d.needsWorkflow));
      table.push({ judge, delta, fp: c.fp, recall: c.recall, judged: h.filter(d => d.judged).length, fallbacks: h.filter(d => d.fallback).length });
    }
  }
  const ok = table.filter(r => r.fp === 0);
  ok.sort((a, b) => b.recall - a.recall || JUDGE_ORDER.indexOf(a.judge) - JUDGE_ORDER.indexOf(b.judge) || a.delta - b.delta);
  const pick = ok[0] ?? { judge: null, delta: 0 };
  return { table, choice: pick.delta > 0 ? { judge: pick.judge, delta: pick.delta } : { judge: null, delta: 0 }, rule: 'PREREG-ROUTER-1 §3 step 4' };
}

function sliderTable(items, out, params) {
  const g = items.map(it => it.gold.needsWorkflow);
  return SLIDER.map(s => { const t = thresholdAt(s, params.tDefault); const c = confusion(g, out.router.map(r => r.p >= t)); return { sensitivity: s, threshold: r4(t), fp: c.fp, recall: c.recall, precision: c.precision }; });
}

function misses(items, out, final) {
  return items.flatMap((it, i) => {
    const d = final[i]; if (d.needsWorkflow === it.gold.needsWorkflow) return [];
    const card = out.router[i].card;
    return [{ kind: d.needsWorkflow ? 'FP' : 'FN', id: it.id, source: it.source, category: it.category, gold: it.gold.mode, confidence: it.gold.confidence, why: it.gold.why,
      routerP: card.p, band: d.band, judged: !!d.judged, predictedMode: d.mode,
      primitives: card.primitives.slice(0, 4).map(x => `${x.name}=${x.score.toFixed(2)}[${x.cues.slice(0, 2).map(c => c.match).join(' | ')}]`),
      dampeners: card.dampeners.slice(0, 3).map(x => `${x.name}=${x.score.toFixed(2)}`), text: it.text.slice(0, 240) }];
  });
}

export function evaluate(split, { params = loadParams() } = {}) {
  const all = loadSet(), items = all.filter(it => it.split === split), devItems = all.filter(it => it.split === 'dev');
  const out = decide(items, split, { params, devItems });
  const systems = ['never', 'always', 'length', 'keyword', 'haiku', 'mercury', 'jev', 'router', 'final'];
  const res = { split, router: ROUTER_VERSION, n: items.length, paramsSha: params.sha, tDefault: params.tDefault, middle: params.middle, lengthThreshold: lengthThreshold(devItems), systems: {} };
  for (const s of systems) if (out[s]) res.systems[s] = summarize(items, out[s], { withAuroc: !['never', 'always', 'final'].includes(s) });
  // Router AUROC on the items each judge answered (same subset), for a fair side-by-side.
  for (const j of ['haiku', 'mercury', 'jev']) {
    const idx = out[j].map((d, i) => (d.missing ? null : i)).filter(i => i !== null);
    if (idx.length) res.systems[j].routerAurocSameItems = auroc(idx.map(i => items[i].gold.needsWorkflow), idx.map(i => out.router[i].p));
  }
  res.modeConfusion = Object.fromEntries(['router', 'final', 'haiku', 'mercury', 'jev'].filter(s => out[s] && out[s].some(d => !d.missing)).map(s => [s, modeConfusion(items, out[s])]));
  res.slider = sliderTable(items, out, params);
  const g = items.map(it => it.gold.needsWorkflow);
  const has = j => out[j].every(d => !d.missing);
  if (has('haiku')) {
    const fin = out.final.map(d => d.needsWorkflow), hk = out.haiku.map(d => d.needsWorkflow), rt = out.router.map(d => d.needsWorkflow);
    res.e3 = { finalVsHaiku: { ...bootstrapDeltaF1(g, fin, hk), mcnemar: mcnemar(fin.map((p, i) => p === g[i]), hk.map((p, i) => p === g[i])) },
      routerVsHaiku: { ...bootstrapDeltaF1(g, rt, hk), mcnemar: mcnemar(rt.map((p, i) => p === g[i]), hk.map((p, i) => p === g[i])) } };
  }
  if (has('mercury')) {
    const rt = out.router.map(d => d.needsWorkflow), mc = out.mercury.map(d => d.needsWorkflow);
    res.e3 = res.e3 ?? {};
    res.e3.routerVsMercury = { ...bootstrapDeltaF1(g, rt, mc), mcnemar: mcnemar(rt.map((p, i) => p === g[i]), mc.map((p, i) => p === g[i])) };
  }
  const both = items.map((it, i) => [out.haiku[i], out.haiku1[i]]).filter(([a, b]) => !a.missing && !b.missing);
  res.haikuFlip = { pairs: both.length, modeFlips: both.filter(([a, b]) => a.mode !== b.mode).length, needFlips: both.filter(([a, b]) => a.needsWorkflow !== b.needsWorkflow).length };
  // E7 slices.
  const slice = pred => { const idx = items.map((it, i) => (pred(it) ? i : null)).filter(i => i !== null); const sub = idx.map(i => items[i]);
    return Object.fromEntries(['router', 'final', 'haiku', 'mercury', 'keyword'].filter(s => out[s]).map(s => [s, summarize(sub, idx.map(i => out[s][i]))])); };
  res.slices = { independentText: slice(it => INDEPENDENT.has(it.source)), authored: slice(it => it.source === 'authored'), highConfidence: slice(it => it.gold.confidence === 'high') };
  res.perSource = Object.fromEntries([...new Set(items.map(it => it.source))].map(src => [src, slice(it => it.source === src)]));
  res.middleBand = { judged: out.final.filter(d => d.judged).length, fallbacks: out.final.filter(d => d.fallback).length, bandItems: out.final.filter(d => d.band === 'middle').length };
  res.misses = misses(items, out, out.final);
  res.routerMisses = misses(items, out, out.router);
  return { res, out, items };
}

function fmt(x, d = 3) { return x === null || x === undefined ? 'n/a' : typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toFixed(d)) : String(x); }
export function markdown(res) {
  const L = [];
  L.push(`# ROUTER-1 results: ${res.split} split, router ${res.router} (n = ${res.n})`, '', `Generated by \`experiments/need-router/router1/eval-router1.mjs --split ${res.split} --router ${res.router}\`. paramsSha \`${res.paramsSha}\`; t_default ${res.tDefault}; middle band ${JSON.stringify(res.middle)}; length baseline threshold ${res.lengthThreshold} characters (dev max F1).`, '');
  L.push('| system | n | FP | FP-rate 95% upper | TP | FN | precision | recall | F1 | AUROC | mode acc | $/decision | median ms | p95 ms |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [s, m] of Object.entries(res.systems)) L.push(`| ${s} | ${m.n}${m.missing ? ` (${m.missing} missing)` : ''} | ${m.fp}/${m.negatives} | ${fmt(m.fpRateUpper95)} | ${m.tp} | ${m.fn} | ${fmt(m.precision)} | ${fmt(m.recall)} | ${fmt(m.f1)} | ${fmt(m.auroc)}${m.routerAurocSameItems !== undefined ? ` (router ${fmt(m.routerAurocSameItems)})` : ''} | ${fmt(m.modeAccuracy)} | ${m.costPerDecisionUsd.toExponential(2)} | ${fmt(m.latencyMedianMs, 2)} | ${fmt(m.latencyP95Ms, 2)} |`);
  L.push('', '**Slider (code router):**', '', '| sensitivity | threshold | FP | recall | precision |', '|---|---|---|---|---|');
  for (const r of res.slider) L.push(`| ${r.sensitivity} | ${r.threshold} | ${r.fp} | ${fmt(r.recall)} | ${fmt(r.precision)} |`);
  if (res.e3) { L.push('', '**E3 paired comparisons (ΔF1, 2,000-replicate paired bootstrap 95% interval; exact McNemar on binary correctness):**', '');
    for (const [k, v] of Object.entries(res.e3)) L.push(`- ${k}: ΔF1 ${fmt(v.delta)} [${fmt(v.lo)}, ${fmt(v.hi)}]; McNemar: first-only correct ${v.mcnemar.aOnly}, second-only ${v.mcnemar.bOnly}, p = ${fmt(v.mcnemar.p)}`); }
  L.push('', `**Haiku sample 0 vs 1:** ${res.haikuFlip.pairs} pairs, ${res.haikuFlip.modeFlips} mode flips, ${res.haikuFlip.needFlips} needsWorkflow flips.`);
  L.push(`**Middle band (final system):** ${res.middleBand.bandItems} items in the band, ${res.middleBand.judged} judged, ${res.middleBand.fallbacks} fell back to code.`);
  L.push('', '**Slices (router / final / haiku / mercury / keyword: FP, recall, F1):**', '', '| slice | n | router | final | haiku | mercury | keyword |', '|---|---|---|---|---|---|---|');
  const cell = m => (m ? `${m.fp}/${m.negatives} FP, R ${fmt(m.recall, 2)}, F1 ${fmt(m.f1, 2)}` : 'n/a');
  for (const [k, v] of [...Object.entries(res.slices), ...Object.entries(res.perSource).map(([s, v]) => [`source: ${s}`, v])]) L.push(`| ${k} | ${v.router.n} | ${cell(v.router)} | ${cell(v.final)} | ${cell(v.haiku)} | ${cell(v.mercury)} | ${cell(v.keyword)} |`);
  L.push('', '**Mode confusion (rows gold, columns predicted: none, checklist, workflow, recurring):**', '');
  for (const [s, m] of Object.entries(res.modeConfusion)) L.push(`- ${s}: ${MODES.map(g => `${g} [${MODES.map(p => m[g][p]).join(', ')}]`).join('; ')}`);
  L.push('', `**Every miss of the final system (${res.misses.length}):**`, '');
  for (const m of res.misses) L.push(`- ${m.kind} \`${m.id}\` (${m.source}/${m.category}; gold ${m.gold}${m.confidence === 'medium' ? '?' : ''}${m.why ? `: ${m.why}` : ''}) router p ${m.routerP}, band ${m.band}${m.judged ? ', judged' : ''}; ${m.primitives.join('; ')}${m.dampeners.length ? `; against ${m.dampeners.join(', ')}` : ''}. Text: “${m.text.replace(/\s+/g, ' ')}”`);
  return L.join('\n') + '\n';
}

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (import.meta.url === `file://${process.argv[1]}`) {
  const split = arg('--split', 'dev');
  mkdirSync(RESULTS, { recursive: true });
  if (process.argv.includes('--select')) {
    if (split !== 'dev') throw new Error('step 4 selects on dev only');
    if (ROUTER_VERSION !== 'v1.1') throw new Error('--select writes src/need/params.json (v1.1) only');
    const params = loadParams();
    const items = loadSet().filter(it => it.split === 'dev');
    const out = decide(items, 'dev', { params, middle: null });
    const sel = selectMiddle(items, out, params);
    console.log(JSON.stringify(sel, null, 1));
    const file = path.join(ROOT, 'src/need/params.json');
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    raw.middle = { judge: sel.choice.judge ? { haiku: 'claude-haiku-5-5', mercury: 'mercury-3', jev: 'jev-1.13.0' }[sel.choice.judge] : null, judgeSystem: sel.choice.judge, delta: sel.choice.delta, selectedOn: 'dev', rule: sel.rule };
    writeFileSync(file, JSON.stringify(raw, null, 1) + '\n');
    writeFileSync(path.join(RESULTS, 'select-dev.json'), JSON.stringify(sel, null, 1) + '\n');
    console.log(`middle = ${JSON.stringify(raw.middle)}; paramsSha ${paramsSha(raw)}`);
  } else {
    const params = loadParams();
    const pm = params.middle;
    const { res } = evaluate(split, { params: { ...params, middle: { judge: pm.judgeSystem ?? null, delta: pm.delta ?? 0 } } });
    writeFileSync(path.join(RESULTS, `${split}-${ROUTER_VERSION}.json`), JSON.stringify(res, null, 1) + '\n');
    writeFileSync(path.join(RESULTS, `RESULTS-${split}-${ROUTER_VERSION}.md`), markdown(res));
    console.log(markdown(res));
  }
}
