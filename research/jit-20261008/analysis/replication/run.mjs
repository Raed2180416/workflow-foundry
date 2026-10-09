#!/usr/bin/env node
// Runs one adapter's candidates through the conformance evaluator under tier G and tier I and the item's own oracle (v2).
//   node --max-old-space-size=1024 run.mjs <ha|n8n12679|n8n20281|gha|galaxy> [--seeds 0-9] [--only substring]
// Writes out/rows-<adapter>.json.   No model calls. Dev seeds only (0-27 burned).
import fs from 'node:fs';
import { conform, accept, acceptShare } from './lib/conformance.mjs';

const [, , name, ...rest] = process.argv;
const arg = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const range = s => { const [a, b] = s.split('-').map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); };
const seeds = range(arg('--seeds', '0-9'));
if (seeds.some(s => s < 0 || s > 27)) throw new Error('only burned dev seeds 0-27 are allowed');
const only = arg('--only', null);

const A = await import(`./adapters/${name}.mjs`);
const Nmod = await import(`./normalisation/${name}.mjs`);
await A.init();
const tiers = { G: Nmod.G, I: Nmod.I };
const meta0 = A.meta;
const rows = [];
const t0 = Date.now();
const cands = A.candidates().filter(c => !only || c.id.includes(only));
for (const seed of seeds) {
  const variants = new Map();
  const ctx = v => {
    if (variants.has(v)) return variants.get(v);
    const task = A.taskFor(seed, v);
    const exp = A.expectedLog(task);
    const o = { task, exp, expV1: cands.some(c => c.expectedAlt === 'v1') && A.expectedLogV1 ? A.expectedLogV1(task) : null, oraExp: A.oracleExpected ? A.oracleExpected(task) : null };
    if (seed === seeds[0]) console.error(`[${name}] seed ${seed} ${v ?? ''}: expected log ${exp.length} events, ${new Set(exp.map(e => e.case)).size} cases`);
    // consistency check: the item's own expected trace against the expected log (tier I)
    if (o.oraExp) { const r = conform(o.oraExp, exp, tiers.I); rows.push({ row: 'oracle-expected-vs-original', seed, fitness: r.fitness, precision: r.precision, nE: r.nE, nO: r.nO, acceptedI: accept(r) }); }
    variants.set(v, o); return o;
  };
  for (const c of cands) {
    const { task, exp, expV1 } = ctx(c.variant ?? meta0.variant);
    let output;
    try { output = await c.make(task); if (output && output.__skip) continue; } catch (e) { rows.push({ row: 'candidate', id: c.id, seed, error: String(e?.message ?? e).slice(0, 160) }); continue; }
    let log;
    try { log = A.logOf(task, output); if (c.perturb) log = c.perturb(log); } catch (e) { rows.push({ row: 'candidate', id: c.id, seed, error: `log: ${String(e?.message ?? e).slice(0, 160)}` }); continue; }
    let ora = null;
    if (!c.perturb) { try { ora = A.oracleOf(task, output); } catch (e) { ora = { error: String(e?.message ?? e).slice(0, 100) }; } }
    const out = { row: 'candidate', id: c.id, cls: c.cls, kind: c.kind, seed, nObserved: log.length, oracle: ora };
    for (const [tn, N] of Object.entries(tiers)) {
      const r = conform(exp, log, N);
      out[tn] = { fitness: r.fitness, precision: r.precision, f1: r.f1, nE: r.nE, nO: r.nO, matched: r.matched, minFitness: r.minFitness, minPrecision: r.minPrecision, casesExact: r.casesExact, nCases: r.nCases,
        accept: accept(r), accept95: accept(r, 0.95), acceptShare90: acceptShare(r, 0.9), orderMoves: Object.values(r.cases).reduce((a, x) => a + x.orderMoves, 0),
        firstDeviation: Object.entries(r.cases).filter(([, x]) => x.fitness < 1 || x.precision < 1).slice(0, 2).map(([k, x]) => ({ case: k, missing: x.missing.slice(0, 2), extra: x.extra.slice(0, 2) })) };
      if (expV1) { const r1 = conform(expV1, log, N); out[`${tn}_v1log`] = { fitness: r1.fitness, precision: r1.precision, accept: accept(r1) }; }
    }
    rows.push(out);
  }
}
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`./out/rows-${name}.json`, import.meta.url), JSON.stringify({ adapter: name, meta: A.meta, seeds, tiers: Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, v.name])), rows }, null, 1));
console.error(`[${name}] ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(0)} s, heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);
