#!/usr/bin/env node
// POST-HOC (not preregistered; conceived after the dev and test gate results, research/reuse-20261021/RESULT-C2-1.md §5):
// a consumer-side conformance check before reuse. Program B already holds labelled history for each supplier (the 15
// products a SCRATCH build learns from). Before B reuses A's entry for a supplier, it runs the entry on that history ($0
// for a code-only workflow) and admits the entry for that supplier only if it reproduces every label. Per item, the
// preregistered profile gate (b3) still applies (variant G0+b3), or not (G0 alone).
//   node experiments/reuse/posthoc.mjs --run-id c2-1 --set test
// Writes LIVE_ROOT/<run-id>/<set>/conformance.jsonl and research/.../runs/<run-id>/posthoc-<set>.json. $0.
import path from 'node:path';
import { artifactFiles } from '../sopbench/exec.mjs';
import { subtaskOf, worldsOf } from './gen-b.mjs';
import { makeWorld } from './world-b.mjs';
import { runArtifact } from './host.mjs';
import { ctxOf, PROVEN_ID, gradeItem } from './c2.mjs';
import { GATES, PRIMARY_GATE } from './analyze.mjs';
import { clustersOf, crossedOf, reuseBoundRule, reuseBoundRule2 } from '../lib/stats.mjs';
import { appendJsonl, readJsonl, writeJson } from './lib.mjs';

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
const admitSource = s => perSource[s].pass === perSource[s].of;
const reuse = readJsonl(path.join(ctx.setLive, 'reuse.jsonl'));
const gates = { G0: r => admitSource(r.source), 'G0+b3': r => admitSource(r.source) && GATES[PRIMARY_GATE](r), b3: GATES[PRIMARY_GATE] };
const view = Object.fromEntries(Object.entries(gates).map(([g, f]) => {
  const acc = reuse.filter(f), ref = reuse.filter(r => !f(r)), harmful = reuse.filter(r => !r.correct);
  const admitted = acc.map(r => ({ parent: r.shipment, entry: r.entry, wrong: !r.correct }));
  return [g, { accepted: acc.length, wrongReuse: acc.filter(r => !r.correct).length, wrongReuseRate: acc.length ? acc.filter(r => !r.correct).length / acc.length : null,
    deopt: ref.length, falseDeopt: ref.filter(r => r.correct).length, catchRate: harmful.length ? harmful.filter(r => !f(r)).length / harmful.length : null,
    m3: admitted.length ? { parentExact: (({ decision, upper, nEff }) => ({ decision, upper, nEff }))(reuseBoundRule(clustersOf(admitted), { method: 'exact' })),
      crossedExact: (({ decision, upper, nEff }) => ({ decision, upper, nEff }))(reuseBoundRule2(crossedOf(admitted))) } : null,
    bySource: Object.fromEntries(Object.keys(ctx.manifest.sources).map(s => { const rs = reuse.filter(r => r.source === s); return [s, { accepted: rs.filter(f).length, wrong: rs.filter(r => f(r) && !r.correct).length, falseDeopt: rs.filter(r => !f(r) && r.correct).length }]; })) }];
}));
// Post-hoc arms, composed like analyze.mjs REUSE (same builds, same lineages): admitted supplier -> A's answer; else the
// supplier's build (paid once). The conformance runs ($0) are charged as time, once per supplier.
const builds = readJsonl(path.join(ctx.setLive, 'builds.jsonl')).filter(b => !b.envFault);
const built = new Map(readJsonl(path.join(ctx.setLive, 'built.jsonl')).map(b => [`${b.id}#${b.lineage}`, b]));
const lineages = [...new Set(builds.map(b => b.lineage))].filter(L => Object.keys(ctx.manifest.sources).every(s => builds.some(b => b.source === s && b.lineage === L))).sort();
const confMs = Object.fromEntries(Object.keys(ctx.manifest.sources).map(s => [s, conf.filter(r => r.source === s).reduce((a, r) => a + (r.durationMs ?? 0), 0)]));
const arms = {};
for (const L of lineages) for (const [g, f] of [['G0', gates.G0], ['G0+b3', gates['G0+b3']]]) {
  const paid = new Set(); let correct = 0, ms = 0, wrongReuse = 0, reused = 0;
  for (const r of reuse) {
    if (f(r)) { reused++; if (r.correct) correct++; else wrongReuse++; ms += r.durationMs; }
    else { const b = built.get(`${r.id}#${L}`); if (b?.correct) correct++; ms += b?.durationMs ?? 0; paid.add(r.source); }
  }
  const bs = builds.filter(b => b.lineage === L && paid.has(b.source));
  const buildUsd = bs.reduce((a, b) => a + (b.costUsd ?? 0), 0), buildMs = bs.reduce((a, b) => a + (b.wallMs ?? 0), 0);
  const conformMs = Object.values(confMs).reduce((a, b) => a + b, 0);
  arms[`REUSE-${g}@L${L}`] = { items: reuse.length, correct, itemAcc: correct / reuse.length, reused, wrongReuse, buildsPaid: paid.size, buildUsd, usdPerItem: buildUsd / reuse.length,
    meanItemMs: Math.round(ms / reuse.length), meanItemMsWithBuildsAndConformance: Math.round((ms + buildMs + conformMs) / reuse.length) };
}
const out = { kind: 'c2-posthoc', note: 'POST-HOC, not preregistered: consumer-side conformance on B\'s labelled history before reuse', set: ctx.set, perSource, view, arms,
  conformanceRunMs: conf.reduce((s, r) => s + (r.durationMs ?? 0), 0) };
writeJson(path.join(ctx.out, `posthoc-${ctx.set}.json`), out);
console.log(JSON.stringify({ arms, perSource, summary: Object.fromEntries(Object.entries(view).map(([g, v]) => [g, { accepted: v.accepted, wrong: v.wrongReuse, falseDeopt: v.falseDeopt, catch: v.catchRate, m3: v.m3 }])) }, null, 1));
