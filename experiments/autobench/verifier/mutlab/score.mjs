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
//
// v2 (review, 2026-11-04): the scoring is exported functions with fixture tests (v1's main held every decision untested).
// Severity ρ is EXPLORATORY (not an ATTACK metric) and is also reported without the controls and the empty-trajectory
// noops (severity 1, rejected by every verifier, which inflated v1's ρ). Class validity excludes noops from the lab miss
// rates, carries a task-cluster bootstrap interval and leave-one-class-out values (k = 6 classes, cells of >= 5: the kill
// is applied verbatim but is underpowered, and is reported so). The lab-calibrated threshold's gap is split into its base-
// rate and miss-rate parts (v1's "3.7x" mixed them). Replay fidelity is checked per verifier against the stored rows, not
// only at the pass label, and stored call errors are recounted. Dup and extra-create mutants are broken down by sub-kind.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { REPORTED_ARMS, fileSha, labelPass, loadLab, readJsonl, stepsOf } from './labio.mjs';
import { clopperPearson } from '../../../lib/certify.mjs';
import { clusterBootstrap, rng } from '../../../lib/infopath.mjs';
import { chooseTheta, curve, pointAt } from '../tristate/riskcov.mjs';
import { releasedAt } from '../tristate/verdict.mjs';

export const SCORE_VERSION = 'mutlab-score-v2';
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

const triV = p => ({ accept: v => v.tri?.[p]?.release ?? null, bad: v => (v.tri?.[p] ? v.tri[p].F + v.tri[p].unknownShare : null) });
const rdV = (field, rd) => ({ accept: v => v[field]?.[rd]?.accept ?? null, bad: v => v[field]?.[rd]?.fails ?? null });
export const VERIFIERS = Object.freeze({
  rl2: { accept: v => v.rl2.accept, bad: v => 1 - v.rl2.score },
  cc: { accept: v => v.cc.accept, bad: v => -v.cc.score },
  'cc@clock': { accept: v => v.ccClock?.accept ?? null, bad: v => (v.ccClock ? -v.ccClock.score : null) },
  triT1: triV('T1'), triT3: triV('T3'), triTC: triV('TC'),
  'triT1@clock': { accept: v => v.triClock?.T1?.release ?? null, bad: v => (v.triClock?.T1 ? v.triClock.T1.F + v.triClock.T1.unknownShare : null) },
  reader0: rdV('readers', 'haiku:0'), reader1: rdV('readers', 'haiku:1'), reader2: rdV('readers', 'haiku:2'),
  'readerShare0': rdV('readersShare', 'haiku:0'),
  nonEmpty: { accept: v => v.nonEmpty, bad: v => (v.nonEmpty ? 0 : 1) },
});
// the verifiers whose class cells are pooled in the validity check (as v1: RL2, code-checks, the three-valued verdict)
export const POOLED = Object.freeze(['rl2', 'cc', 'triT1']);

export const rate = (k, n) => ({ k, n, p: n ? k / n : null, ...(n ? { lo: clopperPearson(k, n).lo, hi: clopperPearson(k, n).hi } : {}) });
export const severity = o => (o.nScored ? (o.nScored - o.nPassed) / o.nScored : 0);
const failsClass = (o, c) => (o.failedByClass?.[c] ?? 0) > 0;

/** Controls: replayed, reproduced (official pass), not reproduced; the good seeds. */
export function controlsOf(man, outs) {
  const controls = Object.entries(man.jobs).filter(([, m]) => m.kind === 'control').map(([id, m]) => ({ id, m, o: outs.get(id) }));
  const goodSeed = new Set(controls.filter(c => c.o?.pass === 1).map(c => c.m.seed));
  return { controls, goodSeed, summary: { seeds: controls.length, replayed: controls.filter(c => c.o?.finalSha).length, reproducedPass: goodSeed.size,
    failedReplay: controls.filter(c => c.o && !c.o.finalSha).length, notReproduced: controls.filter(c => c.o?.finalSha && c.o.pass !== 1).length,
    tasks: new Set(controls.filter(c => goodSeed.has(c.m.seed)).map(c => c.m.task)).size } };
}

/** Scored items: replayed jobs with verdicts, of seeds whose control reproduced (noops count by task). */
export function itemsOf(man, outs, ver, goodSeed) {
  return Object.entries(man.jobs).map(([id, m]) => ({ id, m, o: outs.get(id), v: ver.get(id) }))
    .filter(x => x.o?.finalSha && x.v && !x.v.replayError && (goodSeed.has(x.m.seed) || x.m.op === 'noop'));
}

/** Per operator: official failure rate, severity, failed classes, call errors, and per sub-kind (dup: send/create, ...). */
export function operatorTable(items) {
  const ops = [...new Set(items.map(x => x.m.op))];
  return Object.fromEntries(ops.map(op => {
    const xs = items.filter(x => x.m.op === op);
    const fails = xs.filter(x => x.o.pass !== 1);
    const subs = [...new Set(xs.map(x => x.m.sub).filter(Boolean))].sort();
    return [op, { kind: xs[0].m.kind, cls: xs[0].m.cls, intended: xs[0].m.intended ?? xs[0].m.expect, n: xs.length, officialFail: rate(fails.length, xs.length),
      meanSeverity: xs.reduce((a, x) => a + severity(x.o), 0) / xs.length, failedClassRows: Object.fromEntries(CLASSES.map(c => [c, fails.filter(x => failsClass(x.o, c)).length])),
      callErrorsMean: xs.reduce((a, x) => a + (x.o.callErrors ?? 0), 0) / xs.length,
      ...(subs.length ? { bySub: Object.fromEntries(subs.map(sb => { const ys = xs.filter(x => x.m.sub === sb); return [sb, { n: ys.length, officialFail: rate(ys.filter(x => x.o.pass !== 1).length, ys.length) }]; })) } : {}) }];
  }));
}

/**
 * One verifier on the lab's mutants and controls: kill (officially failing rejected), false alarm (officially passing
 * rejected), AUROC, and the EXPLORATORY Spearman of badness vs official severity, both over everything (v1's number) and
 * over the core (mutants only: no controls, no noops), each with a task-cluster bootstrap interval. Per operator and per
 * class (noops excluded from classes) kill and false alarm; sensitivity (mutants of seeds whose control it accepts).
 */
export function verifierScores(mut, V, { B = 1000 } = {}) {
  const xs = mut.filter(x => V.accept(x.v) !== null && V.bad(x.v) !== null);
  const failing = xs.filter(x => x.o.pass !== 1), passing = xs.filter(x => x.o.pass === 1);
  const rej = x => !V.accept(x.v);
  const rho = ys => { const bad = ys.map(x => V.bad(x.v)), sv = ys.map(x => severity(x.o)); return { rho: spearman(bad, sv), ci: clusterBootstrap(ys.map(x => x.m.task), idx => spearman(idx.map(i => bad[i]), idx.map(i => sv[i])), { B, seed: 11 }), n: ys.length }; };
  const core = xs.filter(x => x.m.kind === 'mutant' && x.m.op !== 'noop');
  const ops = [...new Set(xs.map(x => x.m.op))].filter(op => op !== 'control');
  const perOp = Object.fromEntries(ops.map(op => { const f = failing.filter(x => x.m.op === op), p = passing.filter(x => x.m.op === op); return [op, { kill: rate(f.filter(rej).length, f.length), falseAlarm: rate(p.filter(rej).length, p.length) }]; }));
  const perClass = Object.fromEntries(CLASSES.map(c => { const f = failing.filter(x => x.m.op !== 'noop' && failsClass(x.o, c)); return [c, rate(f.filter(rej).length, f.length)]; }));
  const ctlAcc = new Set(xs.filter(x => x.m.kind === 'control' && V.accept(x.v) === true).map(x => x.m.seed));
  const fC = failing.filter(x => x.m.kind === 'mutant' && ctlAcc.has(x.m.seed)), pC = passing.filter(x => x.m.kind === 'mutant' && ctlAcc.has(x.m.seed));
  const all = rho(xs), cr = rho(core);
  return { n: xs.length, kill: rate(failing.filter(rej).length, failing.length), falseAlarm: rate(passing.filter(rej).length, passing.length),
    falseAlarmControls: rate(passing.filter(x => x.m.kind === 'control').filter(rej).length, passing.filter(x => x.m.kind === 'control').length),
    falseAlarmEquivalentMutants: rate(passing.filter(x => x.m.kind === 'mutant').filter(rej).length, passing.filter(x => x.m.kind === 'mutant').length),
    auroc: auroc(xs.map(x => V.bad(x.v)), xs.map(x => x.o.pass !== 1)),
    severityRho: { exploratory: true, all: { rho: all.rho, lo: all.ci.lo, hi: all.ci.hi, n: all.n }, core: { rho: cr.rho, lo: cr.ci.lo, hi: cr.ci.hi, n: cr.n } },
    perOp, perClass,
    sensitivity: { controlsAccepted: ctlAcc.size, kill: rate(fC.filter(rej).length, fC.length), falseAlarm: rate(pC.filter(rej).length, pC.length),
      perOp: Object.fromEntries(ops.map(op => { const f = fC.filter(x => x.m.op === op), p = pC.filter(x => x.m.op === op); return [op, { kill: rate(f.filter(rej).length, f.length), falseAlarm: rate(p.filter(rej).length, p.length) }]; })),
      perClass: Object.fromEntries(CLASSES.map(c => { const f = fC.filter(x => x.m.op !== 'noop' && failsClass(x.o, c)); return [c, rate(f.filter(rej).length, f.length)]; })) } };
}

/**
 * ATTACK Move 4's validity check: per class, the lab miss rate (officially failing mutants with that class among their
 * failures that the verifier ACCEPTS; noops excluded) against the real false-accept rate (stored failing rows with that
 * class among their failed assertions that the verifier accepts); Spearman over classes with both cells >= minCell.
 * lab: [{task, op, failing, classes: Set, accept}], real: [{task, classes: Set, accept}] (failing rows only).
 * Returns { classes, spearman, k, ci (task-cluster bootstrap over both sides), pAtLeast (share of resamples >= bar),
 * leaveOneOut: {class: rho without it} }.
 */
export function classValidity(lab, real, { minCell = 5, B = 1000, seed = 13, bar = 0.5, excludeNoop = true } = {}) {
  const L = lab.filter(x => x.failing && x.accept !== null && (!excludeNoop || x.op !== 'noop')), R = real.filter(x => x.accept !== null);
  const tasks = [...new Set([...L.map(x => x.task), ...R.map(x => x.task)])].sort();
  const ti = new Map(tasks.map((t, i) => [t, i]));
  // per task, per class counts: [labN, labMiss, realN, realAccept]
  const cnt = tasks.map(() => Object.fromEntries(CLASSES.map(c => [c, [0, 0, 0, 0]])));
  for (const x of L) for (const c of x.classes) { const z = cnt[ti.get(x.task)][c]; if (!z) continue; z[0]++; if (x.accept) z[1]++; }
  for (const x of R) for (const c of x.classes) { const z = cnt[ti.get(x.task)][c]; if (!z) continue; z[2]++; if (x.accept) z[3]++; }
  const cells = (weights, drop = null) => {
    const per = {};
    for (const c of CLASSES) {
      if (c === drop) continue;
      let a = 0, b = 0, d = 0, e = 0;
      weights.forEach((w, i) => { if (!w) return; const z = cnt[i][c]; a += w * z[0]; b += w * z[1]; d += w * z[2]; e += w * z[3]; });
      if (a >= minCell && d >= minCell) per[c] = { labMiss: b / a, nLab: a, realFalseAccept: e / d, nReal: d };
    }
    const cs = Object.keys(per);
    return { per, rho: cs.length >= 3 ? spearman(cs.map(c => per[c].labMiss), cs.map(c => per[c].realFalseAccept)) : null, k: cs.length };
  };
  const ones = tasks.map(() => 1);
  const base = cells(ones);
  const r = rng(seed), vals = [];
  for (let b = 0; b < B; b++) {
    const w = tasks.map(() => 0);
    for (let k = 0; k < tasks.length; k++) w[Math.floor(r() * tasks.length)]++;
    const v = cells(w).rho;
    if (v !== null && Number.isFinite(v)) vals.push(v);
  }
  vals.sort((x, y) => x - y);
  const q = p => (vals.length ? vals[Math.min(vals.length - 1, Math.max(0, Math.floor(p * (vals.length - 1))))] : null);
  const leaveOneOut = Object.fromEntries(Object.keys(base.per).map(c => [c, cells(ones, c).rho]));
  return { classes: base.per, spearman: base.rho, k: base.k, ci: { lo: q(0.025), hi: q(0.975), B: vals.length }, pAtLeast: vals.length ? vals.filter(v => v >= bar).length / vals.length : null, bar, leaveOneOut, minCell, excludeNoop };
}

/**
 * Move 3 x 4: the release threshold Learn-then-Test certifies on the lab, applied unchanged to the stored rows, with the
 * gap split into its parts. labItems/realRows: [{task, y, v}]. For the chosen theta: base failure rates, the miss rate
 * (released | failing) and pass-accept rate (released | passing) on each side; riskAtRealBase = the lab's two rates at the
 * stored base rate (what the lab would predict for the real mix); then real risk / lab risk = (riskAtRealBase / lab risk)
 * [base rate] x (real risk / riskAtRealBase) [miss rates].
 */
export function labCalibration(labItems, realRows, { alpha = 0.2, delta = 0.1 } = {}) {
  const ch = chooseTheta(labItems, { alpha, delta });
  if (ch.theta === null) return { alpha, theta: null };
  const side = xs => {
    const rel = it => releasedAt(it.v, ch.theta);
    const f = xs.filter(it => !it.y), p = xs.filter(it => it.y);
    return { n: xs.length, failShare: xs.length ? f.length / xs.length : null, missRate: f.length ? f.filter(rel).length / f.length : null, passAccept: p.length ? p.filter(rel).length / p.length : null };
  };
  const lab = pointAt(labItems, ch.theta), stored = pointAt(realRows, ch.theta);
  const sl = side(labItems), sr = side(realRows);
  const pi = sr.failShare, num = pi * sl.missRate, den = num + (1 - pi) * sl.passAccept;
  const riskAtRealBase = den > 0 ? num / den : null;
  return { alpha, theta: ch.theta, lab, stored, labRates: sl, storedRates: sr, missRatio: sl.missRate ? sr.missRate / sl.missRate : null, riskAtRealBase,
    gap: lab.risk ? { total: stored.risk / lab.risk, baseRate: riskAtRealBase / lab.risk, missRate: riskAtRealBase ? stored.risk / riskAtRealBase : null } : null };
}

/**
 * Replay fidelity beyond the pass label: each control against its stored row, per verifier (verdicts that differ, false
 * alarms on each side among reproduced passing controls), diff shape agreement, and call errors per control vs the
 * stored log. pairs: [{control: verdict line, stored: verdict line}]; callErrors: {replay: [n], stored: [n]}.
 */
export function replayFidelity(pairs, verifiers, callErrors = null) {
  const per = {};
  for (const [name, V] of Object.entries(verifiers)) {
    const ps = pairs.filter(p => V.accept(p.control) !== null && V.accept(p.stored) !== null);
    per[name] = { n: ps.length, differ: ps.filter(p => V.accept(p.control) !== V.accept(p.stored)).length,
      rejectControl: ps.filter(p => !V.accept(p.control)).length, rejectStored: ps.filter(p => !V.accept(p.stored)).length };
  }
  const mean = xs => (xs?.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
  return { pairs: pairs.length, shapeEqual: pairs.filter(p => p.control.shape !== undefined && p.control.shape === p.stored.shape).length, perVerifier: per,
    callErrors: callErrors ? { replayMean: mean(callErrors.replay), storedMean: mean(callErrors.stored), n: callErrors.replay.length } : null };
}

/** Twins: official consistency with the control, verifier flips, rejection when the control was accepted. */
export function twinTable(items, verifiers) {
  const ctl = new Map(items.filter(x => x.m.kind === 'control').map(x => [x.m.seed, x]));
  const out = {};
  for (const tw of ['permute', 'decoy_untouched', 'rename_untouched', 'decoy_touched']) {
    const xs = items.filter(x => x.m.kind === 'twin' && x.m.op === tw).map(x => ({ ...x, c: ctl.get(x.m.seed) })).filter(x => x.c);
    const consistent = xs.filter(x => x.o.pass === x.c.o.pass);
    const per = {};
    for (const [name, V] of Object.entries(verifiers)) {
      const ys = consistent.filter(x => V.accept(x.v) !== null && V.accept(x.c.v) !== null);
      const ctlAccepted = ys.filter(x => V.accept(x.c.v));
      per[name] = { flips: rate(ys.filter(x => V.accept(x.v) !== V.accept(x.c.v)).length, ys.length), rejectGivenControlAccepted: rate(ctlAccepted.filter(x => !V.accept(x.v)).length, ctlAccepted.length) };
    }
    out[tw] = { n: xs.length, officiallyConsistent: consistent.length, expect: xs[0]?.m.expect ?? null, verifiers: per };
  }
  return out;
}

/** Intended wrong but officially passing (grader blind spots), per operator and sub-kind, and pooled without noops. */
export function blindSpots(items) {
  const wrong = items.filter(x => x.m.kind === 'mutant' && x.m.intended === 'wrong');
  const ops = [...new Set(wrong.map(x => x.m.op))];
  const per = Object.fromEntries(ops.map(op => { const xs = wrong.filter(x => x.m.op === op); const subs = [...new Set(xs.map(x => x.m.sub).filter(Boolean))].sort();
    return [op, { ...rate(xs.filter(x => x.o.pass === 1).length, xs.length), ...(subs.length ? { bySub: Object.fromEntries(subs.map(sb => { const ys = xs.filter(x => x.m.sub === sb); return [sb, rate(ys.filter(x => x.o.pass === 1).length, ys.length)]; })) } : {}) }]; }));
  const pooledXs = wrong.filter(x => x.m.op !== 'noop');
  return { perOp: per, pooledWithoutNoop: rate(pooledXs.filter(x => x.o.pass === 1).length, pooledXs.length) };
}

const storedCallErrors = row => stepsOf(row).flatMap(s => s.calls).filter(c => typeof c.orig === 'string' && c.orig.trimStart().startsWith('{"error"')).length;

async function main() {
  const { values: a } = parseArgs({ options: { vlab: { type: 'string' }, work: { type: 'string' }, verdicts: { type: 'string' }, out: { type: 'string' }, B: { type: 'string', default: '1000' } } });
  for (const k of ['vlab', 'work', 'verdicts', 'out']) if (!a[k]) { console.error(`missing --${k}`); process.exit(2); }
  const B = Number(a.B);
  const man = JSON.parse(readFileSync(path.join(a.work, 'manifest.json'), 'utf8'));
  const outs = new Map([...readJsonl(path.join(a.work, 'out0.jsonl')), ...readJsonl(path.join(a.work, 'out1.jsonl'))].filter(o => o.id).map(o => [o.id, o]));
  const ver = new Map(readJsonl(a.verdicts).map(l => [l.id, l]));
  const res = { version: SCORE_VERSION, evidence: 'development: official AutomationBench rubric on replayed edits of stored passing dev60 worlds ($0); verifiers frozen RL2 code checks, code-checks v1.1 (clock-blind, and with the hidden clock as @clock), the three-valued verdict, independent RL2 readers',
    inputs: { manifest: fileSha(path.join(a.work, 'manifest.json')), out0: fileSha(path.join(a.work, 'out0.jsonl')), out1: fileSha(path.join(a.work, 'out1.jsonl')), verdicts: fileSha(a.verdicts) }, mutateVersion: man.versions };
  const { controls, goodSeed, summary } = controlsOf(man, outs);
  const rows = loadLab(path.resolve(a.vlab), { arms: REPORTED_ARMS });
  const byRow = new Map(rows.map(r => [r.rowId, r]));
  const items = itemsOf(man, outs, ver, goodSeed);
  // replay fidelity: controls vs their stored rows
  const ctlItems = items.filter(x => x.m.kind === 'control');
  res.controls = { ...summary, fidelity: replayFidelity(ctlItems.map(x => ({ control: x.v, stored: ver.get(`row:${x.m.seedRow}`) })).filter(p => p.stored), VERIFIERS,
    { replay: ctlItems.map(x => x.o.callErrors ?? 0), stored: ctlItems.map(x => storedCallErrors(byRow.get(x.m.seedRow))) }) };
  res.items = items.length;
  res.operators = operatorTable(items);
  const mut = items.filter(x => x.m.kind === 'mutant' || x.m.kind === 'control');
  res.verifiers = Object.fromEntries(Object.entries(VERIFIERS).map(([name, V]) => [name, verifierScores(mut, V, { B })]));
  // Move 3 x 4 calibration
  const labItems = mut.map(x => ({ task: x.m.task, y: x.o.pass === 1, v: x.v.tri.T1 }));
  const realRows = rows.map(r => ({ task: r.task, y: labelPass(r), v: ver.get(`row:${r.rowId}`)?.tri?.T1 })).filter(s => s.v);
  res.releaseFromLab = Object.fromEntries([0.1, 0.2].map(alpha => [`alpha${alpha}`, labCalibration(labItems, realRows, { alpha, delta: 0.1 })]));
  res.releaseCurveLab = curve(labItems);
  res.releaseCurveStored = curve(realRows);
  // validity (ATTACK Move 4): per class, lab miss vs real false accept
  const storedFail = rows.filter(r => !labelPass(r)).map(r => ({ task: r.task, classes: new Set((r.label.failedTypes ?? []).map(assertionClass)), v: ver.get(`row:${r.rowId}`) })).filter(s => s.v);
  res.validity = {};
  const pooledLab = [], pooledReal = [];
  for (const [name, V] of Object.entries(VERIFIERS)) {
    if (name === 'nonEmpty') continue;
    const lab = mut.map(x => ({ task: x.m.task, op: x.m.op, failing: x.o.pass !== 1, classes: new Set(CLASSES.filter(c => failsClass(x.o, c))), accept: V.accept(x.v) }));
    const real = storedFail.map(s => ({ task: s.task, classes: s.classes, accept: V.accept(s.v) }));
    res.validity[name] = classValidity(lab, real, { B });
    res.validity[name].withNoop = classValidity(lab, real, { B: 0, excludeNoop: false }).spearman;
    if (POOLED.includes(name)) for (const c of Object.keys(res.validity[name].classes)) { pooledLab.push(res.validity[name].classes[c].labMiss); pooledReal.push(res.validity[name].classes[c].realFalseAccept); }
  }
  res.validity.pooled = { k: pooledLab.length, spearman: spearman(pooledLab, pooledReal), note: `cells (verifier x class) of ${POOLED.join(', ')}; cells are not independent (same rows across verifiers)` };
  // stored-row operating points for reference (the same verifiers on the real rows)
  const real = rows.map(r => ({ y: labelPass(r), v: ver.get(`row:${r.rowId}`) })).filter(s => s.v);
  res.storedRows = Object.fromEntries(Object.entries(VERIFIERS).map(([name, V]) => {
    const xs = real.filter(s => V.accept(s.v) !== null);
    const f = xs.filter(s => !s.y), p = xs.filter(s => s.y);
    return [name, { n: xs.length, kill: rate(f.filter(s => !V.accept(s.v)).length, f.length), falseAlarm: rate(p.filter(s => !V.accept(s.v)).length, p.length), auroc: auroc(xs.map(s => V.bad(s.v)), xs.map(s => !s.y)) }];
  }));
  res.twins = twinTable(items, VERIFIERS);
  res.blindSpots = blindSpots(items);
  writeFileSync(a.out, JSON.stringify(res, null, 1) + '\n');
  const brief = Object.fromEntries(Object.entries(res.verifiers).map(([k, v]) => [k, `kill ${v.kill.k}/${v.kill.n} FA ${v.falseAlarm.k}/${v.falseAlarm.n} AUROC ${v.auroc?.toFixed(3)} rho(core) ${v.severityRho.core.rho?.toFixed(3)}`]));
  console.log(JSON.stringify({ controls: res.controls.reproducedPass, items: res.items, brief, validity: Object.fromEntries(Object.entries(res.validity).map(([k, v]) => [k, `${v.spearman?.toFixed(2)} (k ${v.k}) [${v.ci?.lo?.toFixed(2)}, ${v.ci?.hi?.toFixed(2)}]`])) }, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
