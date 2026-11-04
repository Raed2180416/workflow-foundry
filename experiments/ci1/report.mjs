#!/usr/bin/env node
// CI-1 analysis (research/ci1-20261021/PREREG-CI1.md §5): per arm, pass@1 averaged over K and pass^K per item, item-clustered bootstrap
// intervals, paired differences by item, cost per build and per verified build. Reads the committed run summaries only.
//   node experiments/ci1/report.mjs <label...> [--pairs A2:A0,A2:A1c,A1c:A1,A1:A0] [--json out.json] [--boot 10000]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SUMMARIES = path.join(here, '../../research/ci1-20261021/runs');
export const BOOT = 10000;

/** A deterministic PRNG for the bootstrap (mulberry32). */
export function prng(seed = 20261022) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Per item: { item, k: builds, passes, p1: passes / builds, all: every build passed }. */
export function perItem(records) {
  const by = new Map();
  for (const r of records) { const x = by.get(r.item) ?? { item: r.item, k: 0, passes: 0 }; x.k++; x.passes += r.pass ? 1 : 0; by.set(r.item, x); }
  return [...by.values()].map(x => ({ ...x, p1: x.passes / x.k, all: x.passes === x.k })).sort((a, b) => (a.item < b.item ? -1 : 1));
}
const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]; };
/** Percentile bootstrap over items of a statistic of the per-item values. */
export function bootstrap(values, { boot = BOOT, seed = 20261022, stat = mean } = {}) {
  const r = prng(seed), n = values.length, out = [];
  for (let b = 0; b < boot; b++) { const s = []; for (let i = 0; i < n; i++) s.push(values[Math.floor(r() * n)]); out.push(stat(s)); }
  return { lo: q(out, 0.025), hi: q(out, 0.975) };
}
/** Exact two-sided sign test on paired per-item differences (ties dropped). */
export function signTest(diffs) {
  const pos = diffs.filter(d => d > 0).length, neg = diffs.filter(d => d < 0).length, n = pos + neg;
  if (!n) return { pos, neg, p: 1 };
  const C = (n, k) => { let c = 1; for (let i = 1; i <= k; i++) c = c * (n - k + i) / i; return c; };
  const k = Math.min(pos, neg); let tail = 0; for (let i = 0; i <= k; i++) tail += C(n, i);
  return { pos, neg, p: Math.min(1, 2 * tail / 2 ** n) };
}
export function armStats(summary, { boot = BOOT } = {}) {
  const items = perItem(summary.records);
  const p1 = items.map(x => x.p1), all = items.map(x => (x.all ? 1 : 0));
  const usd = summary.records.reduce((s, r) => s + r.usd, 0), tokens = summary.records.reduce((s, r) => s + r.tokens, 0);
  const passes = summary.records.filter(r => r.pass).length;
  const outcomes = summary.records.reduce((m, r) => { m[r.outcome] = (m[r.outcome] ?? 0) + 1; return m; }, {});
  return { label: summary.label, arm: summary.arm, split: summary.split, model: summary.model, K: summary.K, items: items.length, builds: summary.records.length,
    pass1: mean(p1), pass1CI: bootstrap(p1, { boot }), passAll: mean(all), passAllCI: bootstrap(all, { boot }),
    usd: Math.round(usd * 1e6) / 1e6, usdPerBuild: summary.records.length ? usd / summary.records.length : null, usdPerVerified: passes ? usd / passes : null,
    tokensPerBuild: summary.records.length ? Math.round(tokens / summary.records.length) : null, outcomes, perItem: items, notRun: summary.notRun ?? [], environmentFault: summary.environmentFault ?? null };
}
export function paired(a, b, { boot = BOOT } = {}) {
  const A = new Map(perItem(a.records).map(x => [x.item, x.p1])), B = new Map(perItem(b.records).map(x => [x.item, x.p1]));
  const items = [...A.keys()].filter(k => B.has(k)).sort();
  const d = items.map(k => A.get(k) - B.get(k));
  return { a: a.label, b: b.label, items: items.length, diff: mean(d), ci: bootstrap(d, { boot }), sign: signTest(d), flips: { aOnly: items.filter(k => A.get(k) > B.get(k)), bOnly: items.filter(k => B.get(k) > A.get(k)) } };
}
const pct = x => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : 'n/a');
export function table(stats) {
  const rows = ['| Arm | Label | Items × K | pass@1 (95% CI) | pass^K (95% CI) | $ / build | $ / verified build | tokens / build | outcomes |', '|---|---|---|---|---|---|---|---|---|'];
  for (const s of stats) rows.push(`| ${s.arm} | ${s.label} | ${s.items} × ${s.K} | ${pct(s.pass1)} (${pct(s.pass1CI.lo)}–${pct(s.pass1CI.hi)}) | ${pct(s.passAll)} (${pct(s.passAllCI.lo)}–${pct(s.passAllCI.hi)}) | ${s.usdPerBuild === null ? '-' : `$${s.usdPerBuild.toFixed(4)}`} | ${s.usdPerVerified === null ? '-' : `$${s.usdPerVerified.toFixed(4)}`} | ${s.tokensPerBuild ?? '-'} | ${Object.entries(s.outcomes).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
  return rows.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  const labels = args.filter((x, i) => !x.startsWith('--') && !['--pairs', '--json', '--boot', '--oracle', '--items', '--exclude'].includes(args[i - 1]));
  const boot = Number(opt('--boot') ?? BOOT);
  // --oracle v2: POST HOC verdicts from runs/<label>/rescore-v2.json (experiments/ci1-posthoc); --items / --exclude: an item subset
  const v2 = opt('--oracle') === 'v2', only = opt('--items')?.split(','), drop = opt('--exclude')?.split(',') ?? [];
  const sums = labels.map(l => {
    const f = path.join(SUMMARIES, l, 'summary.json'); if (!existsSync(f)) throw new Error(`no summary for ${l}`);
    const s = JSON.parse(readFileSync(f, 'utf8'));
    if (v2) { const r = JSON.parse(readFileSync(path.join(SUMMARIES, l, 'rescore-v2.json'), 'utf8')); const by = new Map(r.rows.map(x => [`${x.item}-k${x.k}`, x.v2])); s.records = s.records.map(x => ({ ...x, pass: by.get(`${x.item}-k${x.k}`) ?? x.pass })); s.label = `${s.label} (v2)`; }
    s.records = s.records.filter(x => (!only || only.includes(x.item)) && !drop.includes(x.item));
    return s;
  });
  const stats = sums.map(s => armStats(s, { boot }));
  console.log(table(stats));
  const pairs = (opt('--pairs') ?? '').split(',').filter(Boolean).map(p => p.split(':'));
  const out = { stats, pairs: [] };
  for (const [x, y] of pairs) {
    const a = sums.find(s => s.arm === x || s.label === x), b = sums.find(s => s.arm === y || s.label === y);
    if (!a || !b) { console.log(`pair ${x}:${y}: missing`); continue; }
    const p = paired(a, b, { boot }); out.pairs.push(p);
    console.log(`${x} - ${y}: ${(100 * p.diff).toFixed(1)} points (95% CI ${(100 * p.ci.lo).toFixed(1)} to ${(100 * p.ci.hi).toFixed(1)}), items ${p.items}, sign test +${p.sign.pos}/-${p.sign.neg} p=${p.sign.p.toFixed(3)}; ${x} better on [${p.flips.aOnly.join(', ')}], ${y} better on [${p.flips.bOnly.join(', ')}]`);
  }
  if (opt('--json')) writeFileSync(opt('--json'), `${JSON.stringify(out, null, 1)}\n`);
}
