#!/usr/bin/env node
// POST-HOC (not preregistered; conceived after the dev and test gate results, research/reuse-20261021/RESULT-C2-1.md §5):
// a consumer-side conformance check before reuse. Program B already holds labelled history for each supplier (the 15
// products a SCRATCH build learns from). Before B reuses A's entry for a supplier, it runs the entry on that history ($0
// for a code-only workflow) and admits the entry for that supplier only if it reproduces every label. Per item, the
// preregistered profile gate (b3) still applies (variant G0+b3), or not (G0 alone).
//   node experiments/reuse/posthoc.mjs --run-id c2-1 --set test
// Writes LIVE_ROOT/<run-id>/<set>/conformance.jsonl and research/.../runs/<run-id>/posthoc-<set>.json. $0.
//
// Revised 2026-11-04 after the review of C2-1/C2-2 (not a frozen file; the frozen C2-1 code is unchanged):
// - admitAll needs at least one history decision (finding 9: `pass === of` admitted a supplier with no history);
// - the arm composition is an exported pure function, composeConformanceArm, so it is tested (finding 10);
// - M3 is also computed with the SUPPLIER as the cluster (finding 1): the gate admits or refuses whole suppliers, so
//   its errors are correlated within a supplier; the shipment-clustered bound overstated the effective sample.
import path from 'node:path';
import { clustersOf, crossedOf, reuseBoundRule, reuseBoundRule2 } from '../lib/stats.mjs';
import { appendJsonl, readJsonl, writeJson } from './lib.mjs';

/** G0's admission of one supplier: every history label reproduced, and at least one history decision. */
export const admitAll = ({ pass, of }) => of > 0 && pass === of;

/** M3 on admitted decisions, clustered by shipment (as preregistered) and by supplier (the admission unit). */
export function m3Views(admitted) {
  if (!admitted.length) return null;
  const pick = ({ decision, upper, n, nEff, deff }) => ({ decision, upper, n, nEff, deff });
  const bySupplier = clustersOf(admitted.map(d => ({ parent: d.source, wrong: d.wrong })));
  return {
    parentExact: pick(reuseBoundRule(clustersOf(admitted), { method: 'exact' })),
    crossedExact: pick(reuseBoundRule2(crossedOf(admitted))),
    supplierExact: { ...pick(reuseBoundRule(bySupplier, { method: 'exact' })), suppliers: bySupplier.length, wrongSuppliers: bySupplier.filter(c => c.wrong > 0).length },
    // rho = 1: every admitted supplier counts once (its items are one decision); the worst case the floor 0.1 hides.
    supplierExactRho1: pick(reuseBoundRule(bySupplier, { method: 'exact', rho: 1 })),
  };
}

/**
 * One post-hoc arm, composed like analyze.mjs REUSE (same builds, same lineage): an item whose supplier `admit`s and that
 * `accept`s takes the proven entry's answer; any other item takes the supplier's build for `lineage` (paid once per
 * supplier). reuse: reuse.jsonl records; builtBy: Map `${id}#${lineage}` -> built.jsonl record.
 * Returns { out: [{ id, source, shipment, route, correct, ms }], correct, reused, wrongReuse, paid: Set<source>, ms }.
 */
export function composeConformanceArm({ reuse, admit, accept = () => true, builtBy, lineage }) {
  const out = [], paid = new Set();
  for (const r of reuse) {
    if (admit(r.source) && accept(r)) out.push({ id: r.id, source: r.source, shipment: r.shipment, route: 'reuse', correct: !!r.correct, ms: r.durationMs ?? 0 });
    else {
      const b = builtBy.get(`${r.id}#${lineage}`);
      out.push({ id: r.id, source: r.source, shipment: r.shipment, route: 'build', correct: !!b?.correct, ms: b?.durationMs ?? 0, missing: !b });
      paid.add(r.source);
    }
  }
  const reused = out.filter(o => o.route === 'reuse');
  return { out, correct: out.filter(o => o.correct).length, reused: reused.length, wrongReuse: reused.filter(o => !o.correct).length, paid, ms: out.reduce((a, o) => a + o.ms, 0) };
}

async function main() {
  const [{ artifactFiles }, { subtaskOf, worldsOf }, { makeWorld }, { runArtifact }, { ctxOf, PROVEN_ID, gradeItem }, { GATES, PRIMARY_GATE }] = await Promise.all([
    import('../sopbench/exec.mjs'), import('./gen-b.mjs'), import('./world-b.mjs'), import('./host.mjs'), import('./c2.mjs'), import('./analyze.mjs')]);
  const a = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, xs) => (x.startsWith('--') ? [...acc, [x.slice(2), xs[i + 1]]] : acc), []));
  const ctx = ctxOf(a['run-id'], a.set);
  const entry = ctx.registry.get(PROVEN_ID);
  const files = artifactFiles(entry.artifact.dir);
  const worlds = worldsOf(ctx.manifest, { toolOrder: ctx.toolOrder, makeWorld });
  const byId = new Map(ctx.manifest.products.map(p => [p.id, p]));
  const outFile = path.join(ctx.setLive, 'conformance.jsonl');
  const have = new Set(readJsonl(outFile).map(r => r.id));
  for (const [source, spec] of Object.entries(ctx.manifest.sources)) {
    for (const id of [...spec.build, ...spec.repair]) {
      if (have.has(id)) continue;
      const p = byId.get(id), task = subtaskOf(p, ctx.bankTexts);
      const run = await runArtifact({ files, sdkDir: entry.sdk.dir, catalog: ctx.catalog, outputColumns: ['hazard_class'], task, world: worlds[source], live: ctx.setLive, tag: `conf-${p.index}` });
      const g = run.status === 'done' ? gradeItem(run.answer, p.truth) : { cls: null, correct: false };
      appendJsonl(outFile, { id, source, correct: g.correct, answer: g.cls, truth: p.truth.hazard_class, durationMs: run.durationMs });
    }
  }
  const conf = readJsonl(outFile);
  const perSource = Object.fromEntries(Object.keys(ctx.manifest.sources).map(s => { const rs = conf.filter(r => r.source === s); return [s, { pass: rs.filter(r => r.correct).length, of: rs.length }]; }));
  const admitSource = s => admitAll(perSource[s]);
  const reuse = readJsonl(path.join(ctx.setLive, 'reuse.jsonl'));
  const gates = { G0: r => admitSource(r.source), 'G0+b3': r => admitSource(r.source) && GATES[PRIMARY_GATE](r), b3: GATES[PRIMARY_GATE] };
  const view = Object.fromEntries(Object.entries(gates).map(([g, f]) => {
    const acc = reuse.filter(f), ref = reuse.filter(r => !f(r)), harmful = reuse.filter(r => !r.correct);
    const admitted = acc.map(r => ({ parent: r.shipment, entry: r.entry, source: r.source, wrong: !r.correct }));
    return [g, { accepted: acc.length, wrongReuse: acc.filter(r => !r.correct).length, wrongReuseRate: acc.length ? acc.filter(r => !r.correct).length / acc.length : null,
      deopt: ref.length, falseDeopt: ref.filter(r => r.correct).length, catchRate: harmful.length ? harmful.filter(r => !f(r)).length / harmful.length : null,
      m3: m3Views(admitted),
      bySource: Object.fromEntries(Object.keys(ctx.manifest.sources).map(s => { const rs = reuse.filter(r => r.source === s); return [s, { accepted: rs.filter(f).length, wrong: rs.filter(r => f(r) && !r.correct).length, falseDeopt: rs.filter(r => !f(r) && r.correct).length }]; })) }];
  }));
  // Post-hoc arms, composed like analyze.mjs REUSE (same builds, same lineages): admitted supplier -> A's answer; else the
  // supplier's build (paid once). The conformance runs ($0) are charged as time, once per supplier.
  const builds = readJsonl(path.join(ctx.setLive, 'builds.jsonl')).filter(b => !b.envFault);
  const builtBy = new Map(readJsonl(path.join(ctx.setLive, 'built.jsonl')).map(b => [`${b.id}#${b.lineage}`, b]));
  const lineages = [...new Set(builds.map(b => b.lineage))].filter(L => Object.keys(ctx.manifest.sources).every(s => builds.some(b => b.source === s && b.lineage === L))).sort();
  const conformMs = conf.reduce((s, r) => s + (r.durationMs ?? 0), 0);
  const arms = {};
  for (const L of lineages) for (const [g, accept] of [['G0', () => true], ['G0+b3', GATES[PRIMARY_GATE]]]) {
    const c = composeConformanceArm({ reuse, admit: admitSource, accept, builtBy, lineage: L });
    const bs = builds.filter(b => b.lineage === L && c.paid.has(b.source));
    const buildUsd = bs.reduce((x, b) => x + (b.costUsd ?? 0), 0), buildMs = bs.reduce((x, b) => x + (b.wallMs ?? 0), 0);
    arms[`REUSE-${g}@L${L}`] = { items: reuse.length, correct: c.correct, itemAcc: c.correct / reuse.length, reused: c.reused, wrongReuse: c.wrongReuse, buildsPaid: c.paid.size, buildUsd, usdPerItem: buildUsd / reuse.length,
      meanItemMs: Math.round(c.ms / reuse.length), meanItemMsWithBuildsAndConformance: Math.round((c.ms + buildMs + conformMs) / reuse.length) };
  }
  const out = { kind: 'c2-posthoc', note: 'POST-HOC, not preregistered: consumer-side conformance on B\'s labelled history before reuse. m3.supplierExact* added 2026-11-04 (review finding 1): the admission unit is the supplier.',
    set: ctx.set, perSource, view, arms, conformanceRunMs: conformMs };
  writeJson(path.join(ctx.out, `posthoc-${ctx.set}.json`), out);
  console.log(JSON.stringify({ arms, perSource, summary: Object.fromEntries(Object.entries(view).map(([g, v]) => [g, { accepted: v.accepted, wrong: v.wrongReuse, falseDeopt: v.falseDeopt, catch: v.catchRate, m3: v.m3 }])) }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
