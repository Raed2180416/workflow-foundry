#!/usr/bin/env node
// C2-3 post-hoc analysis ($0, after the run; NOT preregistered, labelled so in RESULT-C2-3.md):
// 1. The preregistered paired bootstrap resamples shipments. The review of C2-1/C2-2 (finding 1) showed that errors in
//    this experiment are correlated within a SUPPLIER (a build's band-edge rule, a gate's admission, a convention the
//    agent misreads are all per supplier), so the same comparisons are re-run resampling the 12 suppliers: a
//    sensitivity check with 12 clusters, coarse by construction.
//    The same comparisons are also run on the items the supplier's labelled history DETERMINES (c23-errors.mjs
//    strataOf, 'pinned'): on the rest ('gap') B's matrix alone decides the class, and it equals the equal bands that the
//    reused workflow and SCRATCH's builder default to by construction (program-b.mjs header).
// 2. Cost and time per item projected to N items per supplier from the measured unit costs: SCRATCH and REUSE-G0 pay
//    fixed builds (and G0 its conformance runs) per supplier and run the workflow at $0 per item; the agent pays every
//    item. A projection, not a measurement. Every arm here uses the same 15 labelled history products per supplier.
//   node experiments/reuse/c23-posthoc.mjs     -> research/reuse-20261021/runs/c2-3/posthoc.json
import { ctxOf } from './c2.mjs';
import { armsOf, OUT } from './c23.mjs';
import { pairedShipmentBootstrap } from './analyze.mjs';
import { strataOf } from './c23-errors.mjs';
import { usd, writeJson } from './lib.mjs';
import path from 'node:path';

/** Paired bootstrap over a coarser cluster: the shipment bootstrap with the cluster key mapped onto `shipment`. */
export const pairedClusterBootstrap = (outA, outB, key = 'source', opts = {}) =>
  pairedShipmentBootstrap(outA.map(o => ({ ...o, shipment: o[key] })), outB.map(o => ({ ...o, shipment: o[key] })), opts);

/**
 * Per-item USD and ms at N items per supplier. arm: { out: [{ ms }], usd, ms }; perItem: true for an arm that pays per
 * item (the agent: usd and ms are all variable); otherwise usd is fixed per supplier set (builds) and ms = run ms
 * (variable) + fixed ms (builds, conformance runs).
 */
export function projectArm(arm, { suppliers, perItem, N }) {
  const n = arm.out.length, runMs = arm.out.reduce((a, o) => a + (o.ms ?? 0), 0);
  if (perItem) return { N, usdPerItem: arm.usd / n, msPerItem: arm.ms / n };
  return { N, usdPerItem: arm.usd / (suppliers * N), msPerItem: (arm.ms - runMs) / (suppliers * N) + runMs / n };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = ctxOf('c2-1', 'test');
  const { arms, lineages } = armsOf(ctx);
  const suppliers = Object.keys(ctx.manifest.sources).length;
  const ks = Object.keys(arms).filter(a => a.startsWith('AGENT-H@')).map(a => a.split('@k')[1]);
  const pairs = [];
  for (const k of ks) {
    for (const l of lineages) for (const b of ['SCRATCH', 'REUSE-G0', 'REUSE-b3']) pairs.push([`${b}@L${l}`, `AGENT-H@k${k}`]);
    pairs.push([`AGENT-H@k${k}`, `AGENT@k${k}`]);
  }
  if (ks.length > 1) pairs.push([`AGENT-H@k${ks[0]}`, `AGENT-H@k${ks[1]}`]);
  const bySupplier = pairs.filter(([a, b]) => arms[a] && arms[b]).map(([a, b]) => ({ a, b, cluster: 'supplier', ...pairedClusterBootstrap(arms[a].out, arms[b].out) }));
  const stratum = strataOf(ctx.manifest);
  const only = (out, s) => out.filter(o => stratum.get(o.id) === s);
  const byStratum = ['pinned', 'gap'].flatMap(s => pairs.filter(([a, b]) => arms[a] && arms[b] && !a.startsWith('REUSE-b3')).map(([a, b]) => {
    const A = only(arms[a].out, s), B = only(arms[b].out, s);
    return { a, b, stratum: s, items: A.length, correctA: A.filter(o => o.correct).length, correctB: B.filter(o => o.correct).length, ...pairedShipmentBootstrap(A, B) };
  }));
  const projection = {};
  for (const name of Object.keys(arms).filter(a => /^(SCRATCH|REUSE-G0|AGENT-H)@/.test(a))) {
    projection[name] = [20, 100, 1000].map(N => { const p = projectArm(arms[name], { suppliers, perItem: name.startsWith('AGENT'), N }); return { N, usdPerItem: usd(p.usdPerItem), msPerItem: Math.round(p.msPerItem) }; });
  }
  const out = { kind: 'c23-posthoc', note: 'post-hoc, not preregistered: supplier-clustered bootstrap (12 clusters) and a cost/time projection from measured unit costs', suppliers, bySupplier, byStratum, projection, generatedAt: new Date().toISOString() };
  writeJson(path.join(OUT, 'posthoc.json'), out);
  for (const c of bySupplier) console.log(`${c.a} − ${c.b} (by supplier): ${(100 * c.point).toFixed(1)} [${(100 * c.lo).toFixed(1)}, ${(100 * c.hi).toFixed(1)}]`);
  for (const c of byStratum) console.log(`${c.a} − ${c.b} (${c.stratum}, ${c.items} items: ${c.correctA} vs ${c.correctB}): ${(100 * c.point).toFixed(1)} [${(100 * c.lo).toFixed(1)}, ${(100 * c.hi).toFixed(1)}]`);
  for (const [n, ps] of Object.entries(projection)) console.log(n.padEnd(12), ps.map(p => `N=${p.N}: $${p.usdPerItem} ${(p.msPerItem / 1000).toFixed(2)} s`).join('  |  '));
}
