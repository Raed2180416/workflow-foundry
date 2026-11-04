#!/usr/bin/env node
// Move 6 $0 step (ATTACK §6): κ and n_eff for every stored signal pair (readers, forks, judges, checks), on the stored
// dev60 rows and on the free-label mutants, and the information-path budget rule applied to them. Development evidence.
//
//   node tables.mjs --vlab <stored dev60 lab> --verdicts <mutlab verdicts.jsonl> --work <mutlab work dir> --out <json>
//
// Signals per stored row (the six reported arms): RL2 frozen accept (with its stored judged verdicts: rule R1's input),
// RL2 code-only accept, each RL2 reader as an INDEPENDENT ledger (its own extraction alone; v1 used the reader's share of
// the merged ledger, kept here as readerShare-* for the comparison), code-checks v1.1 accept (clock-blind), the
// three-valued release (T1, RL2 + code-checks), the A1-C pipeline's own "all checks pass" (A1-C rows only; a self-report),
// and the stored judges (Haiku world, Haiku diff-only, Mercury, Sonnet; accept = p_done >= 0.5). Forks: the arms' official
// pass vectors over the 60 tasks. Labels are read for scoring only. Costs per decision are the verifier lab's measured
// means (VERIFIER-LAB §1.1), passed in, not inferred; Mercury has no price on record (shadow price pending, D28 (7)).
//
// v2 (review, 2026-11-04): the admission walk's decision of record uses ATTACK's metric (verdict κ, point estimate,
// bar 0.4), excludes self-reports and uninformative signals by rule, and never admits a 'provisional' signal under the
// bound rule; the error-κ walks are reported beside it as the alternative the owner may adopt (infopath.mjs v2 header).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { REPORTED_ARMS, fileSha, labelPass, loadLab, readJsonl } from '../mutlab/labio.mjs';
import { INFOPATH_VERSION, KAPPA_MAX, admissionWalk, budgetPaths, cohenKappa, neffOfSet, pairStats } from '../../../lib/infopath.mjs';

export const TABLES_VERSION = 'kappa-tables-v2';
// Mean $ per decision from VERIFIER-LAB §1.1 (RL2: $0.013 per task over its candidates, ~6 per task here; readers a third
// of that each; judged-check calls $0.00074 per accepted candidate). Mercury: null (listed at $0 per token, but a shadow
// price is pending under D28 (7); an unpriced signal is not bought by budgetPaths). own: the pipeline's own checker
// (its cost is inside the pipeline run).
export const COST = Object.freeze({ own: 0, cc: 0.0005, rl2: 0.013 / 6 + 0.00074, rl2code: 0.013 / 6, reader: 0.013 / 18, tri: 0.013 / 6 + 0.0005,
  'judge-haiku': 0.0023, 'judge-haiku-diff': 0.0023, 'judge-mercury': null, 'judge-sonnet': 0.030 });
export const SELF_REPORT = Object.freeze(['own']);
// the order the program bought its signals (RL2 first, as the best verifier)
export const PURCHASE_ORDER = Object.freeze(['rl2', 'judge-haiku', 'judge-sonnet', 'judge-mercury', 'judge-haiku-diff', 'cc', 'reader-haiku0', 'reader-haiku1', 'reader-haiku2', 'own']);
export const costOf = n => COST[n.startsWith('reader') ? 'reader' : n];

/** The admission walks: ATTACK's (verdict κ, point) as the decision of record, and the bound / error-κ alternatives. */
export function walks(sig, { y, clusters, order = PURCHASE_ORDER, B = 500 } = {}) {
  const signals = Object.fromEntries(order.map(n => [n, { verdicts: sig[n], selfReport: SELF_REPORT.includes(n) }]));
  const out = {};
  for (const on of ['verdicts', 'errors']) for (const rule of ['point', 'bound']) {
    const w = admissionWalk(order, signals, { y, clusters, on, rule, B });
    out[`${on}/${rule}`] = { ...w, walk: w.walk.map(x => ({ name: x.name, items: sig[x.name].filter(v => v !== null).length, decision: x.decision, reason: x.reason, fragile: x.fragile ?? false,
      rows: x.rows.map(r => ({ with: r.with, n: r.n, kappa: r.kappa, lo: r.lo, hi: r.hi })) })) };
  }
  out.decisionOfRecord = 'verdicts/point';
  return out;
}

const acc = v => (v === null || v === undefined ? null : v ? 1 : 0);
function balancedValue(verdicts, y) {
  let tp = 0, fn = 0, tn = 0, fp = 0;
  verdicts.forEach((v, i) => { if (v === null) return; if (y[i]) { if (v) tp++; else fn++; } else if (v) fp++; else tn++; });
  const tpr = tp + fn ? tp / (tp + fn) : null, tnr = tn + fp ? tn / (tn + fp) : null;
  return tpr === null || tnr === null ? null : (tpr + tnr) / 2 - 0.5;
}

export function signalTable(signals, y, clusters, { B = 1000 } = {}) {
  const names = Object.keys(signals);
  const pairs = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = signals[names[i]], b = signals[names[j]];
    const idx = a.map((v, k) => (v !== null && b[k] !== null ? k : -1)).filter(k => k >= 0);
    if (idx.length < 10) continue;
    const st = pairStats(idx.map(k => a[k]), idx.map(k => b[k]), { y: idx.map(k => y[k]), clusters: idx.map(k => clusters[k]), B });
    pairs.push({ a: names[i], b: names[j], ...st });
  }
  const per = Object.fromEntries(names.map(n => {
    const v = signals[n], idx = v.map((x, k) => (x !== null ? k : -1)).filter(k => k >= 0);
    return [n, { n: idx.length, acceptRate: idx.length ? idx.filter(k => v[k]).length / idx.length : null, value: balancedValue(idx.map(k => v[k]), idx.map(k => y[k])),
      errorRate: idx.length ? idx.filter(k => Boolean(v[k]) !== Boolean(y[k])).length / idx.length : null }];
  }));
  return { per, pairs };
}

async function main() {
  const { values: a } = parseArgs({ options: { vlab: { type: 'string' }, verdicts: { type: 'string' }, work: { type: 'string' }, out: { type: 'string' }, B: { type: 'string', default: '1000' } } });
  for (const k of ['vlab', 'verdicts', 'work', 'out']) if (!a[k]) { console.error(`missing --${k}`); process.exit(2); }
  const vlab = path.resolve(a.vlab), B = Number(a.B);
  const rows = loadLab(vlab, { arms: REPORTED_ARMS });
  const ver = new Map(readJsonl(a.verdicts).map(l => [l.id, l]));
  const dj = f => new Map(readJsonl(path.join(vlab, 'dj', f)).filter(j => j.ok && j.verdict).map(j => [j.rowId, j.verdict]));
  const judges = { 'judge-haiku': dj('judgments-haiku-world.jsonl'), 'judge-haiku-diff': dj('judgments-haiku-diffonly.jsonl'), 'judge-mercury': dj('judgments-mercury-world.jsonl'), 'judge-sonnet': dj('judgments-sonnet-world.jsonl') };
  const pdone = v => (v ? (typeof v.confidence === 'number' ? v.confidence >= 0.5 : Boolean(v.pass)) : null);
  const y = rows.map(labelPass), clusters = rows.map(r => r.task);
  const sig = {}; const put = (k, v) => { (sig[k] ??= []).push(v); };
  for (const r of rows) {
    const v = ver.get(`row:${r.rowId}`);
    put('rl2', acc(v?.rl2full?.accept));
    put('rl2code', acc(v?.rl2?.accept));
    put('cc', acc(v?.cc?.accept));
    put('tri', acc(v?.tri?.T1?.release));
    for (const rd of ['haiku:0', 'haiku:1', 'haiku:2']) { put(`reader-${rd.replace(':', '')}`, acc(v?.readers?.[rd]?.accept)); put(`readerShare-${rd.replace(':', '')}`, acc(v?.readersShare?.[rd]?.accept)); }
    put('own', r.selfCheck?.kind === 'a1c-checks' ? acc(Boolean(r.selfCheck.terminationAllPass ?? r.selfCheck.allPass)) : null);
    for (const [k, m] of Object.entries(judges)) put(k, acc(pdone(m.get(r.rowId))));
  }
  const stored = signalTable(sig, y, clusters, { B });
  const families = { readers: ['reader-haiku0', 'reader-haiku1', 'reader-haiku2'], readerShares: ['readerShare-haiku0', 'readerShare-haiku1', 'readerShare-haiku2'], judges: ['judge-haiku', 'judge-mercury', 'judge-sonnet', 'judge-haiku-diff'], checks: ['own', 'cc', 'rl2', 'tri'],
    'rl2+judge': ['rl2', 'judge-haiku'] };
  const errVec = n => sig[n].map((v, i) => (v === null ? null : Number(Boolean(v) !== y[i])));
  const neff = {};
  for (const [f, names] of Object.entries(families)) {
    const idx = rows.map((_, i) => i).filter(i => names.every(n => sig[n][i] !== null));
    neff[f] = { items: idx.length, ...neffOfSet(names.map(n => idx.map(i => errVec(n)[i]))) };
  }
  // forks: the arms' official pass vectors over the tasks (verdict agreement; the outcome is the label itself)
  const tasks = [...new Set(rows.map(r => r.task))].sort();
  const forkVec = Object.fromEntries(REPORTED_ARMS.map(arm => [arm, tasks.map(t => { const r = rows.find(x => x.task === t && x.arm === arm); return r ? acc(labelPass(r)) : null; })]));
  const forkPairs = [];
  for (let i = 0; i < REPORTED_ARMS.length; i++) for (let j = i + 1; j < REPORTED_ARMS.length; j++) {
    const k = cohenKappa(forkVec[REPORTED_ARMS[i]], forkVec[REPORTED_ARMS[j]]);
    forkPairs.push({ a: REPORTED_ARMS[i], b: REPORTED_ARMS[j], kappa: k.kappa, phi: k.phi, n: k.n });
  }
  const forks = { pairs: forkPairs, nEff: neffOfSet(REPORTED_ARMS.map(arm => forkVec[arm])) };
  const admission = walks(sig, { y, clusters, B: 500 });
  // budget: rows every candidate scored (Haiku judge + checks + readers; Sonnet/Mercury judged too few rows to join)
  const bnames = ['rl2', 'cc', 'tri', 'judge-haiku', 'reader-haiku0', 'reader-haiku1', 'reader-haiku2'];
  const bidx = rows.map((_, i) => i).filter(i => bnames.every(n => sig[n][i] !== null));
  const cands = bnames.map(n => ({ name: n, verdicts: bidx.map(i => sig[n][i]), costUsd: costOf(n), value: stored.per[n].value ?? 0 }));
  const budget = {};
  for (const on of ['verdicts', 'errors']) for (const order of ['ratio', 'value']) for (const cap of [0.001, 0.003, 0.01]) budget[`${on}:${order}:$${cap}`] = budgetPaths(cands, { y: bidx.map(i => y[i]), clusters: bidx.map(i => clusters[i]), budgetUsd: cap, order, on });

  // mutants (official labels): the code verifiers' agreement on the free-label distribution
  const man = JSON.parse(readFileSync(path.join(a.work, 'manifest.json'), 'utf8'));
  const outs = new Map([...readJsonl(path.join(a.work, 'out0.jsonl')), ...readJsonl(path.join(a.work, 'out1.jsonl'))].map(o => [o.id, o]));
  const mrows = [...outs.values()].filter(o => o.finalSha && ver.get(o.id) && !ver.get(o.id).replayError && man.jobs[o.id]?.kind !== 'twin');
  const my = mrows.map(o => o.pass === 1), mcl = mrows.map(o => man.jobs[o.id].task);
  const msig = {};
  for (const o of mrows) {
    const v = ver.get(o.id);
    (msig.rl2code ??= []).push(acc(v.rl2.accept)); (msig.cc ??= []).push(acc(v.cc.accept)); (msig.tri ??= []).push(acc(v.tri.T1.release));
    for (const rd of ['haiku:0', 'haiku:1', 'haiku:2']) { (msig[`reader-${rd.replace(':', '')}`] ??= []).push(acc(v.readers?.[rd]?.accept)); (msig[`readerShare-${rd.replace(':', '')}`] ??= []).push(acc(v.readersShare?.[rd]?.accept)); }
  }
  const mutants = { items: mrows.length, ...signalTable(msig, my, mcl, { B }) };
  mutants.readersNeff = neffOfSet(['reader-haiku0', 'reader-haiku1', 'reader-haiku2'].map(n => msig[n].map((v, i) => (v === null ? null : Number(Boolean(v) !== my[i])))));
  mutants.readerSharesNeff = neffOfSet(['readerShare-haiku0', 'readerShare-haiku1', 'readerShare-haiku2'].map(n => msig[n].map((v, i) => (v === null ? null : Number(Boolean(v) !== my[i])))));

  const out = { version: TABLES_VERSION, infopath: INFOPATH_VERSION, kappaMax: KAPPA_MAX, evidence: 'development (dev60 stored rows, k = 1; mutants: official labels on replayed edits of passing worlds)',
    inputs: { 'dataset.jsonl': fileSha(path.join(vlab, 'dataset.jsonl')), verdicts: fileSha(a.verdicts), manifest: fileSha(path.join(a.work, 'manifest.json')) },
    stored: { rows: rows.length, tasks: tasks.length, ...stored, neff, forks, admission, budget, costs: COST }, mutants };
  writeFileSync(a.out, JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({ forksNeff: forks.nEff.nEff.toFixed(2), neff: Object.fromEntries(Object.entries(neff).map(([k, v]) => [k, v.nEff.toFixed(2)])), admission: Object.fromEntries(['verdicts/point', 'verdicts/bound', 'errors/point', 'errors/bound'].map(k => [k, admission[k].walk.map(w => `${w.name}:${w.decision}${w.fragile ? '(fragile)' : ''}`).join(' ')])), budget: Object.fromEntries(Object.entries(budget).map(([k, v]) => [k, v.chosen.join('+')])) }, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
