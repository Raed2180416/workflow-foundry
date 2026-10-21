#!/usr/bin/env node
// Code-side replay gate of A1-C v2 (B4 of research/automationbench-20261014/A1C-V2-DESIGN.md §7). DEVELOPER TOOL, $0,
// in-sample development evidence (devTrain dev60, the recorded a1c-dev60-dn run). Per task:
//   1. the task's initial world is served and read by the v2 inventory code (the recorded run's clock marks load stamps);
//   2. v2 checks are compiled from the RECORDED reader, adjudication and mapping replies (v1's prompts: no typed negatives);
//   3. the round-0 world (the recorded steps before the first repair) is rebuilt with playback.py and served;
//   4. the v2 check round re-reads it (code checks only; judged checks stay undecided: no checker call);
//   5. each check is aligned automatically with the grader's assertions at that point (lib.mjs alignScore) and classed:
//      true accept / true reject / false accept / false reject (aligned) / false reject (unaligned) / neutral / undecided.
// The recorded v1 round-0 verdicts (check-0.json) are aligned the same way, so both columns use one alignment rule.
// Thresholds (frozen before the single scoring pass; no sweeps):
//   aligned hard false rejects <= 25; hard false accepts <= 28; passing worlds rejected <= 3; clause or slot literals shown
//   as copy-exactly = 0; checks compiled to an app other than the item's = 0.
//
//   node experiments/autobench/replay/replay-gate.mjs [--run DIR] [--tasks a,b] [--out FILE] [--work DIR] [--concurrency N]
//   node experiments/autobench/replay/replay-gate.mjs --lint --from DIR [--run DIR] [--out FILE]
//     (P0: replays the pre-send lint over every outbound send in the recorded act windows, with the gate each task's
//      ledger-replay output compiles; every refusal is listed for review)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_RUN, actWindow, aligned, inventoryV2, playback, recompileV2, recorded, round0Cut, runTaskList, served } from './lib.mjs';
import { runChecks } from '../harness/v2/checker.mjs';
import { checkApp, sameApp } from '../harness/v2/postconditions.mjs';
import { displayOf } from '../harness/v2/ledger.mjs';
import { gateConfig } from '../harness/v2/gate.mjs';
import { decide, callFacts } from '../harness/v2/tool-gated.mjs';
import { PIPELINE_DEFAULTS } from '../harness/v2/codeowned.mjs';

export const TARGETS = Object.freeze({ alignedHardFalseRejects: 25, hardFalseAccepts: 28, passingWorldsRejected: 3, clauseOrSlotShownExact: 0, wrongAppChecks: 0 });

/** Class of one check verdict against the grader's assertions at the same point. */
export function classify(pc, pass, assertions) {
  const A = aligned(pc, assertions);
  if (pass === null || pass === undefined) return { cls: 'undecided', aligned: A.map(x => x.i) };
  if (pass === false) return { cls: !A.length ? 'FR-unaligned' : A.every(x => x.a.passed) ? 'FR-aligned' : 'TR', aligned: A.map(x => x.i) };
  return { cls: A.some(x => !x.a.passed) ? 'FA' : A.length ? 'TA' : 'neutral', aligned: A.map(x => x.i) };
}
/** Literals the brief shows as values to copy (ledger.mjs displayOf) although typed as instruction text or an unfilled
 * placeholder. */
export const clauseOrSlotShown = merged => merged.items.filter(i => !i.superseded).flatMap(i => i.fields).filter(f => displayOf(f) === 'exact' && (f.vtype === 'clause' || (f.vtype === 'slot' && !f.slotFilled))).length;
/** Checks whose app is not their requirement's app. */
export const wrongApp = (merged, pcs) => pcs.filter(p => { const it = merged.items.find(i => i.id === p.item); const a = checkApp(p); return it?.app && a && !sameApp(it.app, a); }).length;

export async function gateTask({ runDir, task, work, P = PIPELINE_DEFAULTS }) {
  const rec = recorded(runDir, task);
  const dir = path.join(work, task);
  const inv = await inventoryV2({ runDir, task, liveDir: path.join(dir, 'inv'), clock: rec.clock, request: rec.prompt.user, P });
  const { merged, pcs, typing, mappedFromRecord } = recompileV2({ rec, inv, P });
  const cut = round0Cut(rec.nodes, rec.calls);
  const pb = await playback({ runDir, task, cut, outFile: path.join(dir, 'playback.json'), cwd: path.join(dir, 'pbcwd') });
  const chk = await served({ runDir, task, world: pb.world, liveDir: path.join(dir, 'round0') }, client => runChecks({ client, inv, pcs, maxSteps: P.checkSteps, judge: null }));
  const assertions = pb.assertions;
  const v2 = chk.results.map(r => ({ id: r.pc.id, type: r.pc.type, hard: r.pc.hard, pass: r.pass, observable: r.observable, evidence: String(r.evidence ?? '').slice(0, 200), ...classify(r.pc, r.pass, assertions) }));
  // v1 at the same point: the recorded round-0 verdicts of the recorded checks.
  const v1pcs = rec.v1.postconditions?.pcs ?? [];
  const v1 = (rec.v1.checks[0] ?? []).map(c => { const pc = v1pcs.find(p => p.id === c.id); return pc ? { id: c.id, type: c.type, hard: c.hard, pass: c.pass, ...classify(pc, c.pass, assertions) } : null; }).filter(Boolean);
  const count = (rows, cls) => rows.filter(r => r.hard && r.cls === cls).length;
  const sum = rows => ({ checks: rows.length, hard: rows.filter(r => r.hard).length, hardFail: rows.filter(r => r.hard && r.pass === false).length, FRaligned: count(rows, 'FR-aligned'), FRunaligned: count(rows, 'FR-unaligned'), FA: count(rows, 'FA'), TA: count(rows, 'TA'), TR: count(rows, 'TR'), neutral: count(rows, 'neutral'), nullHard: count(rows, 'undecided') });
  const s2 = sum(v2), s1 = sum(v1);
  const v1Today = rec.v1.ledgers?.merged?.today?.value ?? null, v2Today = merged.today?.value ?? null;
  return {
    task, cut, steps: rec.calls.length, graderPass: pb.pass, partialCredit: pb.partial_credit, mismatchedSteps: pb.mismatchedSteps,
    v2: { ...s2, rejects: s2.hardFail > 0, clauseOrSlotShown: clauseOrSlotShown(merged), wrongApp: wrongApp(merged, pcs), typing, mappedFromRecord, unobservable: v2.filter(r => !r.observable).length, rows: v2 },
    v1: { ...s1, rejects: s1.hardFail > 0, rows: v1 },
    today: { v1: v1Today, v2: v2Today, changed: v1Today !== v2Today },
  };
}

export function totals(rows) {
  const T = side => {
    const r = rows.map(x => x[side]);
    const add = k => r.reduce((s, x) => s + (x[k] ?? 0), 0);
    return { tasks: rows.length, checks: add('checks'), hard: add('hard'), alignedHardFalseRejects: add('FRaligned'), unalignedHardFalseRejects: add('FRunaligned'), hardFalseAccepts: add('FA'), hardTrueAccepts: add('TA'), hardTrueRejects: add('TR'), hardNeutral: add('neutral'), nullHard: add('nullHard'),
      passingWorldsRejected: rows.filter(x => x.graderPass && x[side].rejects).length, failingWorldsAccepted: rows.filter(x => !x.graderPass && !x[side].rejects).length,
      acceptedWithNullHard: rows.filter(x => !x[side].rejects && (x[side].nullHard ?? 0) > 0).length };
  };
  const v2 = { ...T('v2'), clauseOrSlotShownExact: rows.reduce((s, x) => s + x.v2.clauseOrSlotShown, 0), wrongAppChecks: rows.reduce((s, x) => s + x.v2.wrongApp, 0) };
  return { graderPasses: rows.filter(x => x.graderPass).length, v1: T('v1'), v2, todayChanged: rows.filter(x => x.today.changed).map(x => x.task),
    targets: Object.fromEntries(Object.entries(TARGETS).map(([k, lim]) => [k, { value: v2[k], limit: lim, met: v2[k] <= lim }])) };
}

// ---------------------------------------------------------------------------------------------------------------
// P0: the pre-send lint over the recorded act windows

/** Replay the lint over every outbound send of the act window, in order, with the gate `pcs`/`merged` compile. */
export function lintTask({ rec, pcs, merged, P = PIPELINE_DEFAULTS }) {
  const cfg = gateConfig(pcs, { merged, perPair: P.lintPerPair, perSession: P.lintPerSession });
  const w = actWindow(rec.nodes);
  const steps = w ? rec.calls.filter(c => c.t >= w[0] - 1 && c.t <= w[1] + 1) : [];
  const log = [], out = [];
  for (const s of steps) for (const [i, call] of s.calls.entries()) {
    if (!callFacts(call, cfg.routes)) continue;
    const [d] = decide([call], cfg, log);
    if (d.action !== 'send') log.push({ kind: d.action === 'refuse' ? 'refused' : d.action === 'resend' ? 'resent' : 'capped', rule: d.violation.rule.pid, recipient: d.violation.recipient, hash: d.hash });
    if (d.action === 'refuse') {
      const lit = d.violation.literal.text.toLowerCase();
      const related = (rec.grade?.assertion_results ?? []).filter(a => !a.excluded && JSON.stringify(a.params ?? {}).toLowerCase().includes(lit)).map(a => ({ type: a.type, passed: a.passed }));
      out.push({ step: s.step, call: i + 1, rule: d.violation.rule.pid, recipient: d.violation.recipient, literal: d.violation.literal.text, ruleSource: d.violation.literal.rule?.source ?? null,
        auto: related.some(a => !a.passed && /not|exclude/.test(a.type)) ? 'true (a failing assertion names it)' : related.length ? 'review (named by passing assertions only)' : 'review (no assertion names it)', related });
    }
  }
  return { rules: cfg.rules.length, sends: steps.reduce((s, x) => s + x.calls.filter(c => callFacts(c, cfg.routes)).length, 0), refusals: out };
}

// ---------------------------------------------------------------------------------------------------------------

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }
function args(argv) { const a = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i].replace(/^--/, ''); if (['lint'].includes(k)) a[k] = true; else a[k] = argv[++i]; } return a; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args(process.argv.slice(2));
  const runDir = a.run ?? DEFAULT_RUN;
  const tasks = a.tasks ? a.tasks.split(',') : runTaskList(runDir);
  if (a.lint) {
    if (!a.from) throw new Error('--lint needs --from <ledger-replay output directory>');
    const rows = [];
    for (const task of tasks) {
      const f = path.join(a.from, task, 'compiled.json');
      if (!existsSync(f)) { rows.push({ task, missing: true }); continue; }
      const c = JSON.parse(readFileSync(f, 'utf8'));
      rows.push({ task, ...lintTask({ rec: recorded(runDir, task), pcs: c.pcs, merged: c.merged }) });
    }
    const refusals = rows.flatMap(r => (r.refusals ?? []).map(x => ({ task: r.task, ...x })));
    const res = { rows, refusals: refusals.length, autoTrue: refusals.filter(x => x.auto.startsWith('true')).length, review: refusals.filter(x => !x.auto.startsWith('true')).length,
      rule: 'P0: preSendLint on only if >= 2 true refusals and <= 1 false refusal (every refusal reviewed by hand)' };
    if (a.out) writeFileSync(a.out, JSON.stringify(res, null, 1));
    process.stdout.write(`${JSON.stringify({ refusals: res.refusals, autoTrue: res.autoTrue, review: res.review }, null, 1)}\n`);
    for (const x of refusals) process.stdout.write(`- ${x.task} step ${x.step} call ${x.call}: ${x.rule} to ${x.recipient} "${x.literal}" -> ${x.auto}\n`);
  } else {
    const work = a.work ?? path.join(os.tmpdir(), `a1c-v2-replay-gate-${Date.now()}`);
    mkdirSync(work, { recursive: true });
    const rows = [], errors = [];
    await pool(tasks, Number(a.concurrency ?? 2), async task => {
      try { const r = await gateTask({ runDir, task, work }); rows.push(r); process.stderr.write(`[replay-gate] ${task}: grader ${r.graderPass ? 'pass' : 'fail'}; v2 hard ${r.v2.hard}, fail ${r.v2.hardFail} (FR ${r.v2.FRaligned}+${r.v2.FRunaligned}u, FA ${r.v2.FA}); v1 hard fail ${r.v1.hardFail} (FR ${r.v1.FRaligned}+${r.v1.FRunaligned}u, FA ${r.v1.FA})\n`); }
      catch (e) { errors.push({ task, error: String(e?.stack ?? e).slice(0, 1500) }); process.stderr.write(`[replay-gate] ${task}: ERROR ${String(e?.message ?? e).slice(0, 300)}\n`); }
    });
    rows.sort((x, y) => tasks.indexOf(x.task) - tasks.indexOf(y.task));
    const res = { evidence: 'development/diagnostic, in-sample (devTrain dev60, recorded a1c-dev60-dn replies; automatic alignment)', run: runDir, work, totals: totals(rows), errors, rows };
    if (a.out) writeFileSync(a.out, JSON.stringify(res, null, 1));
    process.stdout.write(`${JSON.stringify({ totals: res.totals, errors: errors.map(e => e.task) }, null, 1)}\n`);
  }
}
