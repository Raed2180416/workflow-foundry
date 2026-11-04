#!/usr/bin/env node
// Move 4 step 4: score the free-label lab. Official labels (replay_batch.py output) joined with the verifier outputs
// (verify.mjs). SCORING ONLY: this file reads grade counts and generic assertion classes; nothing here reaches a verifier.
//
//   node score.mjs --vlab <stored dev60 lab> --work <mutlab work dir> --verdicts <verdicts.jsonl> --out <lab.json>
//
// Reports: replay fidelity of the controls; per operator the official failure rate and severity; per verifier the kill
// rate on officially failing mutants, the false-alarm rate on officially passing ones, AUROC, and Spearman ρ between the
// verifier's badness and the official severity (share of scored assertions failed), with task-cluster bootstrap CIs;
// the validity check (ATTACK §6 Move 4: the lab's per-class miss ordering against the real false-accept ordering on the
// stored failing rows); twin consistency, stability and closure rates; intended-vs-official disagreement (grader blind
// spots). Writes counts and rates only (no task name, no grader string).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { REPORTED_ARMS, fileSha, labelPass, loadLab, readJsonl } from './labio.mjs';
import { clopperPearson } from '../../../lib/certify.mjs';
import { clusterBootstrap } from '../../../lib/infopath.mjs';
import { chooseTheta, curve, pointAt } from '../tristate/riskcov.mjs';

export const SCORE_VERSION = 'mutlab-score-v1';
export const CLASSES = Object.freeze(['content', 'prohibition', 'existence', 'action-key', 'flag', 'other']);

/** Generic class of a grader assertion TYPE name (the same rule as replay_batch.py; scoring only). */
export function assertionClass(t) {
  t = String(t ?? '').toLowerCase();
  if (t.includes('not_') || t.endsWith('_not') || t.includes('not_in')) return 'prohibition';
  if (['contains', 'body', 'cell', 'field', 'value', 'column', 'title', 'subject', 'text'].some(k => t.includes(k))) return 'content';
  if (['is_read', 'has_tag', 'has_label', 'tag', 'label', 'starred', 'archived'].some(k => t.includes(k))) return 'flag';
  if (t.includes('action')) return 'action-key';
  if (['exists', 'sent', 'created', 'posted', 'scheduled', 'event', 'updated', 'deleted'].some(k => t.includes(k))) return 'existence';
  return 'other';
}

/** Spearman's ρ with average ranks for ties (null when either side is constant). */
export function spearman(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const rank = v => {
    const idx = v.map((val, i) => [val, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(n);
    for (let i = 0; i < n;) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
    return r;
  };
  const rx = rank(x), ry = rank(y), mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/** AUROC of a score for a binary positive (ties count one half). */
export function auroc(score, pos) {
  const P = [], N = [];
  score.forEach((s, i) => (pos[i] ? P : N).push(s));
  if (!P.length || !N.length) return null;
  let w = 0;
  for (const p of P) for (const q of N) w += p > q ? 1 : p === q ? 0.5 : 0;
  return w / (P.length * N.length);
}

export const VERIFIERS = Object.freeze({
  rl2: { accept: v => v.rl2.accept, bad: v => 1 - v.rl2.score },
  cc: { accept: v => v.cc.accept, bad: v => -v.cc.score },
  triT1: { accept: v => v.tri.T1.release, bad: v => v.tri.T1.F + v.tri.T1.unknownShare },
  triT3: { accept: v => v.tri.T3.release, bad: v => v.tri.T3.F + v.tri.T3.unknownShare },
  'triT1-supported': { accept: v => v.tri.T1.release && v.tri.T1.unknownShare <= 0.1 + 1e-12, bad: v => v.tri.T1.F + v.tri.T1.unknownShare },
  reader0: { accept: v => v.readers?.['haiku:0']?.accept ?? null, bad: v => v.readers?.['haiku:0']?.fails ?? null },
  reader1: { accept: v => v.readers?.['haiku:1']?.accept ?? null, bad: v => v.readers?.['haiku:1']?.fails ?? null },
  reader2: { accept: v => v.readers?.['haiku:2']?.accept ?? null, bad: v => v.readers?.['haiku:2']?.fails ?? null },
  nonEmpty: { accept: v => v.nonEmpty, bad: v => (v.nonEmpty ? 0 : 1) },
});

const rate = (k, n) => ({ k, n, p: n ? k / n : null, ...(n ? { lo: clopperPearson(k, n).lo, hi: clopperPearson(k, n).hi } : {}) });

async function main() {
  const { values: a } = parseArgs({ options: { vlab: { type: 'string' }, work: { type: 'string' }, verdicts: { type: 'string' }, out: { type: 'string' }, B: { type: 'string', default: '1000' } } });
  for (const k of ['vlab', 'work', 'verdicts', 'out']) if (!a[k]) { console.error(`missing --${k}`); process.exit(2); }
  const B = Number(a.B);
  const man = JSON.parse(readFileSync(path.join(a.work, 'manifest.json'), 'utf8'));
  const outs = new Map([...readJsonl(path.join(a.work, 'out0.jsonl')), ...readJsonl(path.join(a.work, 'out1.jsonl'))].map(o => [o.id, o]));
  const ver = new Map(readJsonl(a.verdicts).map(l => [l.id, l]));
  const sev = o => (o.nScored ? (o.nScored - o.nPassed) / o.nScored : 0);
  const res = { version: SCORE_VERSION, evidence: 'development: official AutomationBench rubric on replayed edits of stored passing dev60 worlds ($0); verifiers frozen RL2 code checks, code-checks v1.1, the three-valued verdict, RL2 readers',
    inputs: { manifest: fileSha(path.join(a.work, 'manifest.json')), out0: fileSha(path.join(a.work, 'out0.jsonl')), out1: fileSha(path.join(a.work, 'out1.jsonl')), verdicts: fileSha(a.verdicts) } };

  // A. controls
  const controls = Object.entries(man.jobs).filter(([, m]) => m.kind === 'control').map(([id, m]) => ({ id, m, o: outs.get(id) }));
  const goodSeed = new Set(controls.filter(c => c.o?.pass === 1).map(c => c.m.seed));
  res.controls = { seeds: controls.length, replayed: controls.filter(c => c.o?.finalSha).length, reproducedPass: goodSeed.size,
    failedReplay: controls.filter(c => c.o && !c.o.finalSha).length, notReproduced: controls.filter(c => c.o?.finalSha && c.o.pass !== 1).length,
    tasks: new Set(controls.filter(c => goodSeed.has(c.m.seed)).map(c => c.m.task)).size,
    finalIdenticalToStored: null };
  // B. operators (mutants and twins of seeds whose control reproduced; noop counts by task)
  const items = Object.entries(man.jobs).map(([id, m]) => ({ id, m, o: outs.get(id), v: ver.get(id) }))
    .filter(x => x.o?.finalSha && x.v && !x.v.replayError && (goodSeed.has(x.m.seed) || x.m.op === 'noop'));
  res.items = items.length;
  const ops = [...new Set(items.map(x => x.m.op))];
  res.operators = Object.fromEntries(ops.map(op => {
    const xs = items.filter(x => x.m.op === op);
    const fails = xs.filter(x => x.o.pass !== 1);
    const cls = Object.fromEntries(CLASSES.map(c => [c, fails.filter(x => (x.o.failedByClass?.[c] ?? 0) > 0).length]));
    return [op, { kind: xs[0].m.kind, cls: xs[0].m.cls, intended: xs[0].m.intended ?? xs[0].m.expect, n: xs.length, officialFail: rate(fails.length, xs.length),
      meanSeverity: xs.reduce((s, x) => s + sev(x.o), 0) / xs.length, failedClassRows: cls, callErrorsMean: xs.reduce((s, x) => s + (x.o.callErrors ?? 0), 0) / xs.length }];
  }));
  // C. verifiers on mutants (+ controls and noops): kill, false alarm, AUROC, Spearman with severity
  const mut = items.filter(x => x.m.kind === 'mutant' || x.m.kind === 'control');
  res.verifiers = {};
  for (const [name, V] of Object.entries(VERIFIERS)) {
    const xs = mut.filter(x => V.accept(x.v) !== null && V.bad(x.v) !== null);
    const failing = xs.filter(x => x.o.pass !== 1), passing = xs.filter(x => x.o.pass === 1);
    const kill = failing.filter(x => !V.accept(x.v)).length, fa = passing.filter(x => !V.accept(x.v)).length;
    const faCtl = passing.filter(x => x.m.kind === 'control'), faMut = passing.filter(x => x.m.kind === 'mutant');
    const bad = xs.map(x => V.bad(x.v)), sv = xs.map(x => sev(x.o)), cl = xs.map(x => x.m.task);
    const rho = spearman(bad, sv);
    const ci = clusterBootstrap(cl, idx => spearman(idx.map(i => bad[i]), idx.map(i => sv[i])), { B, seed: 11 });
    const rhoFail = spearman(failing.map(x => V.bad(x.v)), failing.map(x => sev(x.o)));
    const perOp = Object.fromEntries(ops.filter(op => op !== 'control').map(op => {
      const f = failing.filter(x => x.m.op === op), p = passing.filter(x => x.m.op === op);
      return [op, { kill: rate(f.filter(x => !V.accept(x.v)).length, f.length), falseAlarm: rate(p.filter(x => !V.accept(x.v)).length, p.length) }];
    }));
    const perClass = Object.fromEntries(CLASSES.map(c => { const f = failing.filter(x => (x.o.failedByClass?.[c] ?? 0) > 0); return [c, rate(f.filter(x => !V.accept(x.v)).length, f.length)]; }));
    // sensitivity: only mutants whose seed control this verifier ACCEPTS (a rejection there is information, not a repeat)
    const ctlAcc = new Set(mut.filter(x => x.m.kind === 'control' && V.accept(x.v) === true).map(x => x.m.seed));
    const fC = failing.filter(x => x.m.kind === 'mutant' && ctlAcc.has(x.m.seed)), pC = passing.filter(x => x.m.kind === 'mutant' && ctlAcc.has(x.m.seed));
    const sensitivity = { controlsAccepted: ctlAcc.size, kill: rate(fC.filter(x => !V.accept(x.v)).length, fC.length), falseAlarm: rate(pC.filter(x => !V.accept(x.v)).length, pC.length),
      perOp: Object.fromEntries(ops.filter(op => op !== 'control').map(op => { const f = fC.filter(x => x.m.op === op), p = pC.filter(x => x.m.op === op); return [op, { kill: rate(f.filter(x => !V.accept(x.v)).length, f.length), falseAlarm: rate(p.filter(x => !V.accept(x.v)).length, p.length) }]; })),
      perClass: Object.fromEntries(CLASSES.map(c => { const f = fC.filter(x => (x.o.failedByClass?.[c] ?? 0) > 0); return [c, rate(f.filter(x => !V.accept(x.v)).length, f.length)]; })) };
    res.verifiers[name] = { n: xs.length, kill: rate(kill, failing.length), falseAlarm: rate(fa, passing.length), falseAlarmControls: rate(faCtl.filter(x => !V.accept(x.v)).length, faCtl.length),
      falseAlarmEquivalentMutants: rate(faMut.filter(x => !V.accept(x.v)).length, faMut.length), auroc: auroc(bad, xs.map(x => x.o.pass !== 1)),
      spearman: rho, spearmanCI: ci, spearmanFailingOnly: rhoFail, perOp, perClass, sensitivity };
  }
  // C2. Move 3 x 4: the release threshold set by Learn-then-Test on the lab (mutants + controls, official labels), then
  // applied unchanged to the stored rows (the real distribution). Clusters are tasks on both sides.
  const labItems = mut.map(x => ({ task: x.m.task, y: x.o.pass === 1, v: x.v.tri.T1 }));
  const realRows = loadLab(path.resolve(a.vlab), { arms: REPORTED_ARMS }).map(r => ({ task: r.task, y: labelPass(r), v: ver.get(`row:${r.rowId}`)?.tri?.T1 })).filter(s => s.v);
  res.releaseFromLab = {};
  for (const alpha of [0.1, 0.2]) {
    const ch = chooseTheta(labItems, { alpha, delta: 0.1 });
    res.releaseFromLab[`alpha${alpha}`] = { theta: ch.theta, lab: ch.theta === null ? null : pointAt(labItems, ch.theta), stored: ch.theta === null ? null : pointAt(realRows, ch.theta) };
  }
  res.releaseCurveLab = curve(labItems);
  res.releaseCurveStored = curve(realRows);
  // D. validity: lab miss rate per class vs the real false-accept rate per class on the stored failing rows
  const rows = loadLab(path.resolve(a.vlab), { arms: REPORTED_ARMS });
  const stored = rows.filter(r => !labelPass(r)).map(r => ({ classes: new Set((r.label.failedTypes ?? []).map(assertionClass)), v: ver.get(`row:${r.rowId}`) })).filter(s => s.v);
  res.validity = {};
  const pooled = { lab: [], real: [] };
  for (const [name, V] of Object.entries(VERIFIERS)) {
    if (name === 'nonEmpty') continue;
    const per = {};
    for (const c of CLASSES) {
      const f = mut.filter(x => x.o.pass !== 1 && (x.o.failedByClass?.[c] ?? 0) > 0 && V.accept(x.v) !== null);
      const s = stored.filter(x => x.classes.has(c) && V.accept(x.v) !== null);
      if (f.length >= 5 && s.length >= 5) per[c] = { labMiss: f.filter(x => V.accept(x.v)).length / f.length, nLab: f.length, realFalseAccept: s.filter(x => V.accept(x.v)).length / s.length, nReal: s.length };
    }
    const cs = Object.keys(per);
    res.validity[name] = { classes: per, spearman: spearman(cs.map(c => per[c].labMiss), cs.map(c => per[c].realFalseAccept)), k: cs.length };
    if (['rl2', 'cc', 'triT1'].includes(name)) for (const c of cs) { pooled.lab.push(per[c].labMiss); pooled.real.push(per[c].realFalseAccept); }
  }
  res.validity.pooled = { k: pooled.lab.length, spearman: spearman(pooled.lab, pooled.real), note: 'cells (verifier x class) of rl2, cc, triT1' };
  // stored-row operating points for reference (the same verifiers on the real rows)
  const real = rows.map(r => ({ y: labelPass(r), v: ver.get(`row:${r.rowId}`) })).filter(s => s.v);
  res.storedRows = Object.fromEntries(Object.entries(VERIFIERS).map(([name, V]) => {
    const xs = real.filter(s => V.accept(s.v) !== null);
    const f = xs.filter(s => !s.y), p = xs.filter(s => s.y);
    return [name, { n: xs.length, kill: rate(f.filter(s => !V.accept(s.v)).length, f.length), falseAlarm: rate(p.filter(s => !V.accept(s.v)).length, p.length), auroc: auroc(xs.map(s => V.bad(s.v)), xs.map(s => !s.y)) }];
  }));
  // E. twins: official consistency with the control, verifier flips, closure recall/precision
  const ctlOf = seed => items.find(x => x.m.seed === seed && x.m.kind === 'control');
  res.twins = {};
  for (const tw of ['permute', 'decoy_untouched', 'rename_untouched', 'decoy_touched']) {
    const xs = items.filter(x => x.m.kind === 'twin' && x.m.op === tw).map(x => ({ ...x, c: ctlOf(x.m.seed) })).filter(x => x.c);
    const consistent = xs.filter(x => x.o.pass === x.c.o.pass);
    const per = {};
    for (const [name, V] of Object.entries(VERIFIERS)) {
      const ys = consistent.filter(x => V.accept(x.v) !== null && V.accept(x.c.v) !== null);
      const flips = ys.filter(x => V.accept(x.v) !== V.accept(x.c.v)).length;
      const ctlAccepted = ys.filter(x => V.accept(x.c.v));
      per[name] = { flips: rate(flips, ys.length), rejectGivenControlAccepted: rate(ctlAccepted.filter(x => !V.accept(x.v)).length, ctlAccepted.length) };
    }
    res.twins[tw] = { n: xs.length, officiallyConsistent: consistent.length, expect: xs[0]?.m.expect ?? null, verifiers: per };
  }
  // F. intended wrong but officially passing (grader blind spots), per operator
  res.blindSpots = Object.fromEntries(ops.filter(op => items.find(x => x.m.op === op)?.m.intended === 'wrong').map(op => {
    const xs = items.filter(x => x.m.op === op);
    return [op, rate(xs.filter(x => x.o.pass === 1).length, xs.length)];
  }));
  writeFileSync(a.out, JSON.stringify(res, null, 1) + '\n');
  const brief = Object.fromEntries(Object.entries(res.verifiers).map(([k, v]) => [k, `kill ${v.kill.k}/${v.kill.n} FA ${v.falseAlarm.k}/${v.falseAlarm.n} AUROC ${v.auroc?.toFixed(3)} rho ${v.spearman?.toFixed(3)} [${v.spearmanCI.lo?.toFixed(2)}, ${v.spearmanCI.hi?.toFixed(2)}]`]));
  console.log(JSON.stringify({ controls: res.controls, items: res.items, brief, validity: Object.fromEntries(Object.entries(res.validity).map(([k, v]) => [k, `${v.spearman?.toFixed(2)} (k ${v.k})`])) }, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
