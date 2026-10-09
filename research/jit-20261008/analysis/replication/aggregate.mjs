#!/usr/bin/env node
// Aggregates out/rows-*.json into the row 17 tables: per design, per class, totals vs oracle v1 / v2, rank agreement. No model calls.
//   node research/jit-20261008/analysis/replication/aggregate.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spearman, kendall } from './lib/conformance.mjs';

const here = rel => new URL(rel, import.meta.url);
const ADAPTERS = ['galaxy', 'n8n12679', 'n8n20281', 'ha', 'gha'];
const PLAT = { galaxy: 'Galaxy', n8n12679: 'n8n:12679', n8n20281: 'n8n:20281', ha: 'Home Assistant', gha: 'GitHub Actions' };
const REJECT_KINDS = new Set(['class-wrong', 'class-residual', 'control-wrong']);   // control-unlabelled: no ground truth label (counted as accept-expected only in the G/I false-reject tally)
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f4 = x => (x === null || x === undefined ? null : Number(x.toFixed(4)));

const designs = [];   // one per (adapter, candidate id)
const meta = {};
for (const ad of ADAPTERS) {
  const file = here(`out/rows-${ad}.json`);
  if (!fs.existsSync(file)) { console.error(`missing rows-${ad}.json`); continue; }
  const R = JSON.parse(fs.readFileSync(file, 'utf8'));
  meta[ad] = { seeds: R.seeds, tiers: R.tiers, logUnit: R.meta.logUnit, consistency: R.rows.filter(r => r.row === 'oracle-expected-vs-original') };
  const byId = new Map();
  for (const r of R.rows.filter(r => r.row === 'candidate')) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r); }
  for (const [id, rows] of byId) {
    const ok = rows.filter(r => !r.error), errs = rows.length - ok.length;
    if (!ok.length) continue;
    const first = ok[0];
    const d = { adapter: ad, id, cls: first.cls ?? null, kind: first.kind, decidedBy: first.decidedBy ?? null, nSeeds: ok.length, errors: errs,
      truthAccept: !REJECT_KINDS.has(first.kind),
      v2Assumed: ok.every(r => r.oracle == null),   // a perturbation of the log (not an executable design): the v2 verdict is the documented one, not run
      oracleAccept: ok.every(r => r.oracle == null) ? !REJECT_KINDS.has(first.kind) : ok.every(r => r.oracle?.pass === true),
      oracleScore: ok.every(r => r.oracle == null) ? null : mean(ok.map(r => r.oracle?.score ?? 0)) };
    for (const t of ['G', 'I']) {
      d[t] = { accept: ok.every(r => r[t].accept), accept95: ok.every(r => r[t].accept95), share90: ok.every(r => r[t].acceptShare90),
        fitness: mean(ok.map(r => r[t].fitness)), precision: mean(ok.map(r => r[t].precision)), f1: mean(ok.map(r => r[t].f1)),
        seedsAccepted: ok.filter(r => r[t].accept).length };
    }
    designs.push(d);
  }
}

// decided-by taxonomy per class (my reading of the item READMEs and dossier 7; the dossier does not label every class this way)
//   comparison: the comparison method can matter; battery: detection depends on which scenarios exist; expected-log: the expected log itself encodes the semantic;
//   environment: depends on the simulated environment; harness: decided by the harness/meter outside the effect log (cost accounting, prompt, mock)
const DECIDED = { 'GX-W1': 'battery', 'GX-W2': 'battery', 'GX-W3': 'battery', 'GX-W4': 'battery', 'GX-C1': 'expected-log', 'GX-R1': 'battery',
  'HA-W1': 'battery', 'HA-W2': 'battery', 'HA-C1': 'comparison', 'HA-C2': 'comparison', 'HA-C3': 'environment', 'HA-C4': 'expected-log',
  'N12-W1': 'battery', 'N12-W2': 'battery', 'N12-W3': 'battery', 'N12-W4': 'battery', 'N12-W5': 'battery', 'N12-W6': 'battery', 'N12-C1': 'comparison',
  'N20-W1': 'harness (prompt)', 'N20-W2': 'harness (cost accounting)', 'N20-W3': 'battery', 'N20-W4': 'battery', 'N20-W5': 'battery', 'N20-W6': 'battery', 'N20-C1': 'comparison', 'N20-C2': 'comparison', 'N20-R1': 'harness (answers not in effects)',
  'GHA-C1': 'comparison', 'GHA-C2': 'comparison', 'GHA-C3': 'comparison', 'GHA-R1': 'comparison', 'GHA-R2': 'battery', 'GHA-R3': 'comparison' };
// ---- classes ----
const classes = new Map();
for (const d of designs) if (d.cls) { if (!classes.has(d.cls)) classes.set(d.cls, []); classes.get(d.cls).push(d); }
const verdict = (ds, f) => { const a = ds.filter(f).length; return a === ds.length ? 'accepted' : a === 0 ? 'rejected' : `mixed(${a}/${ds.length} accepted)`; };
const classRows = [...classes].map(([cls, ds]) => {
  const kind = ds[0].kind, wrong = REJECT_KINDS.has(kind);
  const row = { cls, platform: PLAT[ds[0].adapter], kind, decidedBy: DECIDED[cls] ?? ds[0].decidedBy, designs: ds.length, example: ds[0].id.split('/').slice(1).join('/'), seedsPerDesign: ds[0].nSeeds,
    v2: verdict(ds, d => d.oracleAccept), G: verdict(ds, d => d.G.accept), I: verdict(ds, d => d.I.accept), I_tau95: verdict(ds, d => d.I.accept95), I_share90: verdict(ds, d => d.I.share90),
    I_f1: f4(mean(ds.map(d => d.I.f1))), G_f1: f4(mean(ds.map(d => d.G.f1))) };
  const ok = (v) => (wrong ? v === 'rejected' : v === 'accepted');
  row.v2Assumed = ds.every(d => d.v2Assumed); row.v2_ok = ok(row.v2); row.G_ok = ok(row.G); row.I_ok = ok(row.I); row.I95_ok = ok(row.I_tau95); row.Ish_ok = ok(row.I_share90);
  return row;
});
const order = { 'class-wrong': 0, 'class-correct': 1, 'class-residual': 2 };
classRows.sort((a, b) => order[a.kind] - order[b.kind] || a.platform.localeCompare(b.platform) || a.cls.localeCompare(b.cls));

const countIf = (rows, f) => rows.filter(f).length;
const sets = { wrong18: classRows.filter(r => r.kind === 'class-wrong'), correct11: classRows.filter(r => r.kind === 'class-correct'), residual5: classRows.filter(r => r.kind === 'class-residual') };
const tot = key => ({ wrong_detected: countIf(sets.wrong18, r => r[key]), wrong_total: sets.wrong18.length, correct_accepted: countIf(sets.correct11, r => r[key]), correct_total: sets.correct11.length,
  misclassified_29: countIf([...sets.wrong18, ...sets.correct11], r => !r[key]), residual_detected: countIf(sets.residual5, r => r[key]), residual_total: sets.residual5.length,
  misclassified_34: countIf([...sets.wrong18, ...sets.correct11, ...sets.residual5], r => !r[key]) });
const totals = { oracle_v1: { misclassified_29: 29, note: 'by construction: the 18 wrong classes passed v1 and the 11 correct designs were rejected by v1 (dossier 7)' }, oracle_v2: tot('v2_ok'),
  conformance_G_tau1: tot('G_ok'), conformance_I_tau1: tot('I_ok'), conformance_I_tau095: tot('I95_ok'), conformance_I_share90: tot('Ish_ok') };

// ---- per-design totals incl. controls ----
const labelled = designs;   // every design has a truth label from its kind
const designTotals = tier => ({ designs: labelled.length,
  misclassified: labelled.filter(d => (tier === 'v2' ? d.oracleAccept : d[tier].accept) !== d.truthAccept).length,
  falseAccept: labelled.filter(d => !d.truthAccept && (tier === 'v2' ? d.oracleAccept : d[tier].accept)).length,
  falseReject: labelled.filter(d => d.truthAccept && !(tier === 'v2' ? d.oracleAccept : d[tier].accept)).length });
const perDesign = { v2: designTotals('v2'), G: designTotals('G'), I: designTotals('I') };
const perAdapter = Object.fromEntries(ADAPTERS.filter(a => meta[a]).map(a => {
  const ds = designs.filter(d => d.adapter === a);
  const mis = t => ds.filter(d => (t === 'v2' ? d.oracleAccept : d[t].accept) !== d.truthAccept).length;
  const agreeV2 = t => ds.filter(d => d[t].accept === d.oracleAccept).length;
  const sd = ds.filter(d => d.oracleScore !== null), f1s = t => sd.map(d => d[t].f1), sc = sd.map(d => d.oracleScore);
  const auc = (t, by) => { const pos = ds.filter(d => by(d)), neg = ds.filter(d => !by(d)); if (!pos.length || !neg.length) return null; let w = 0; for (const p of pos) for (const n of neg) w += p[t].f1 > n[t].f1 ? 1 : p[t].f1 === n[t].f1 ? 0.5 : 0; return w / (pos.length * neg.length); };
  return [a, { designs: ds.length, seeds: meta[a].seeds.length, misclassifiedVsLabel: { v2: mis('v2'), G: mis('G'), I: mis('I') }, verdictAgreementWithV2: { G: agreeV2('G'), I: agreeV2('I') },
    spearman_v2score_vs_F1: { G: f4(spearman(sc, f1s('G'))), I: f4(spearman(sc, f1s('I'))) }, kendall_v2score_vs_F1: { G: f4(kendall(sc, f1s('G'))), I: f4(kendall(sc, f1s('I'))) },
    auc_F1_predicts_truth: { G: f4(auc('G', d => d.truthAccept)), I: f4(auc('I', d => d.truthAccept)) }, auc_F1_predicts_v2_accept: { G: f4(auc('G', d => d.oracleAccept)), I: f4(auc('I', d => d.oracleAccept)) } }];
}));
const sdAll = designs.filter(d => d.oracleScore !== null), allSc = sdAll.map(d => d.oracleScore);
const pooled = { designs: sdAll.length, spearman: { G: f4(spearman(allSc, sdAll.map(d => d.G.f1))), I: f4(spearman(allSc, sdAll.map(d => d.I.f1))) }, kendall: { G: f4(kendall(allSc, sdAll.map(d => d.G.f1))), I: f4(kendall(allSc, sdAll.map(d => d.I.f1))) } };

// ---- declared-normalisation size ----
const loc = f => fs.readFileSync(here(f), 'utf8').split('\n').filter(l => l.trim() && !l.trim().startsWith('//')).length;
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(here(f))).digest('hex');
const sizes = Object.fromEntries(ADAPTERS.map(a => [a, { normalisationLoc: loc(`normalisation/${a}.mjs`), adapterLoc: loc(`adapters/${a}.mjs`), normalisationSha256: sha(`normalisation/${a}.mjs`), adapterSha256: sha(`adapters/${a}.mjs`) }]));
sizes.evaluator = { loc: loc('lib/conformance.mjs'), sha256: sha('lib/conformance.mjs') };

const out = { generated: new Date().toISOString().slice(0, 10), meta: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, { seeds: v.seeds, tiers: v.tiers, logUnit: v.logUnit, oracleExpectedConsistency: v.consistency.length ? { seeds: v.consistency.length, acceptedI: v.consistency.filter(c => c.acceptedI).length, minFitness: Math.min(...v.consistency.map(c => c.fitness)), minPrecision: Math.min(...v.consistency.map(c => c.precision)) } : null }])),
  totals, perDesign, perAdapter, pooled, sizes, classes: classRows,
  designs: designs.map(d => ({ adapter: d.adapter, id: d.id, cls: d.cls, kind: d.kind, truthAccept: d.truthAccept, seeds: d.nSeeds, errors: d.errors, v2: d.oracleAccept, v2Assumed: d.v2Assumed, v2score: f4(d.oracleScore), G: { accept: d.G.accept, f: f4(d.G.fitness), p: f4(d.G.precision), seedsAccepted: d.G.seedsAccepted }, I: { accept: d.I.accept, accept95: d.I.accept95, share90: d.I.share90, f: f4(d.I.fitness), p: f4(d.I.precision), seedsAccepted: d.I.seedsAccepted } })) };
fs.writeFileSync(here('out/summary.json'), JSON.stringify(out, null, 1));

// ---- markdown ----
const mark = (v, ok) => `${v === 'accepted' ? 'accept' : v === 'rejected' ? 'reject' : v.replace('mixed', 'mixed')}${ok ? '' : ' **X**'}`;
const L = [];
L.push('| class | platform | kind | decided by | designs | v2 oracle | conformance G | conformance I | I tau .95 | I 90% exact |', '|---|---|---|---|---|---|---|---|---|---|');
for (const r of classRows) L.push(`| ${r.cls} ${r.example.slice(0, 44)} | ${r.platform} | ${r.kind.replace('class-', '')} | ${r.decidedBy ?? ''} | ${r.designs} | ${mark(r.v2, r.v2_ok)}${r.v2Assumed ? '*' : ''} | ${mark(r.G, r.G_ok)} | ${mark(r.I, r.I_ok)} | ${mark(r.I_tau95, r.I95_ok)} | ${mark(r.I_share90, r.Ish_ok)} |`);
fs.writeFileSync(here('out/class-table.md'), L.join('\n') + '\n');
console.log(JSON.stringify({ totals, perDesign, pooled }, null, 1));
console.log(L.join('\n'));
