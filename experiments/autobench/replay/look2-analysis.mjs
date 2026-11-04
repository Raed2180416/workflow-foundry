#!/usr/bin/env node
// The A1-C v2 P1 analysis, fixed before any P1 run (A1C-V2-DESIGN.md §5; PREREG-AB-v1-AMEND-1 §6; decisions D23, D25).
// DEVELOPER TOOL, $0. It reads only the REPO COPIES of the look-2 runs (results.jsonl, summary.json and the
// sequential-look.json sidecar each run carries, in the checkout that ran it), never the live directories or a log.
//
//   1. T3 (AMEND-1 §4), read FIRST when the optional A/A run exists: A0 twice on look 2 (a0-look2-aa against a0-look2),
//      exact two-sided McNemar, descriptive (a check of the environment, never a decision).
//   2. CONFIRMATORY (the plan's only test that spends alpha): A1-C v2 (treatment, first look 2) against A0 (control) at
//      look 2 of SEQUENTIAL-PLAN-v1 (plan 3cd586bd…), by sequential.mjs analyzeLooks: strict pass first (exact McNemar at
//      the look-2 nominal level 0.0180, floor 3 points), partial credit only if strict pass is rejected (D23).
//   3. DESCRIPTIVE (no alpha of the plan; exact two-sided McNemar on the 60 paired tasks, reported with its p and the
//      discordant pairs, never a claim): v2 vs v1 (the work item's development comparison), v2-M vs v1-M, v2-M vs v2,
//      and each harness arm vs A0.
//   4. SENSITIVITY, pre-registered: every comparison again without the look-2 tasks whose content reached A1-C v2's
//      development (EXPOSED below; A1C-V2-DESIGN.md §0 b).
//   5. The development GATE for spending devCheck look 3 on v2 (never a claim): strict v2 − v1 ≥ +3 tasks, partial
//      credit v2 − v1 ≥ −0.01, mean cost per task v2 ≤ v1; harm (harm.mjs, paired) and the remaining conditions of §5
//      are read beside it.
// Outcome rules, the same for every arm (sequential.mjs loadOutcomes): a task row with a fault flag is not an outcome
// (the run is re-run with --resume until none remains, never scored); a row without a final grade and without a fault
// never completed and scores 0 (pass 0, partial credit 0) and is listed; the grade is the row's final grade
// (task_completed_correctly, partial_credit). A comparison with an arm that lacks an outcome for any look-2 task is
// reported as incomplete, not computed.
//   node experiments/autobench/replay/look2-analysis.mjs --pin DIR --branch DIR [--runs key=DIR,...] [--harm FILE] [--json] [--write FILE]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO } from '../lib.mjs';
import { mcnemarExactCounts, pairedPermutation, wilson } from '../../lib/stats.mjs';

export const PLAN_REL = 'research/automationbench-20261014/SEQUENTIAL-PLAN-v1.json';
export const RUNS_REL = 'research/automationbench-20261014/runs';
export const LOOK = 2;
/** The arms, their run ids, sidecar roles and arm names, and the checkout each runs from (look2-chain.sh launches them so). */
export const ARMS = Object.freeze([
  { key: 'A0', runId: 'a0-look2', role: 'control', arm: 'A0', checkout: 'pin' },
  { key: 'A0-AA', runId: 'a0-look2-aa', role: 'treatment', arm: 'A0 (T3 A/A)', firstLook: 2, checkout: 'pin', optional: true },
  { key: 'v1', runId: 'a1c-v1-look2', role: 'treatment', arm: 'A1-C', firstLook: 2, checkout: 'pin' },
  { key: 'v2', runId: 'a1c-v2-look2', role: 'treatment', arm: 'A1-C v2', firstLook: 2, checkout: 'branch' },
  { key: 'v1-M', runId: 'a1c-v1m-look2', role: 'treatment', arm: 'A1-C (Mercury ledger and checker)', firstLook: 2, checkout: 'pin' },
  { key: 'v2-M', runId: 'a1c-v2m-look2', role: 'treatment', arm: 'A1-C v2 (Mercury ledger and checker)', firstLook: 2, checkout: 'branch' },
]);
export const CONFIRMATORY = Object.freeze({ treatment: 'v2', control: 'A0' });
export const DESCRIPTIVE = Object.freeze([['v2', 'v1'], ['v2-M', 'v1-M'], ['v2-M', 'v2'], ['v1-M', 'v1'], ['v1', 'A0'], ['v1-M', 'A0'], ['v2-M', 'A0']]);
/** Look-2 tasks whose content reached A1-C v2's development (A1C-V2-DESIGN.md §0 b): the anatomy agent's sed overrun
 * printed part of one request; the need-router study read five requests (D25). The sensitivity analysis drops them. */
export const EXPOSED = Object.freeze(['finance.intercompany_balance_recon', 'finance.qb_estimate_conversion', 'hr.recognition_nominations', 'sales.calendly_sequential_meetings', 'sales.dependency_chain', 'support.helpscout_customer_merge']);
export const GATE = Object.freeze({ strictTasks: 3, partialCredit: -0.01 });

/** Exact two-sided McNemar of a against b over the given tasks: { n, a, b, aOnly, bOnly, p, pcDiff, pcP } or { incomplete }. */
export function paired(A, B, tasks) {
  const missing = tasks.filter(t => !A.has(t) || !B.has(t));
  if (missing.length) return { incomplete: true, missing: missing.length };
  const x = tasks.map(t => A.get(t)), y = tasks.map(t => B.get(t));
  const aOnly = x.filter((o, i) => o.pass && !y[i].pass).length, bOnly = x.filter((o, i) => !o.pass && y[i].pass).length;
  const m = mcnemarExactCounts(aOnly, bOnly);
  const pc = pairedPermutation(x.map(o => o.pc), y.map(o => o.pc), { iterations: 100000, seed: 'a1cv2-look2' });
  const pa = x.filter(o => o.pass).length, pb = y.filter(o => o.pass).length;
  return { n: tasks.length, a: pa, b: pb, diff: pa - pb, aOnly, bOnly, p: m.p, wilsonA: wilson(pa, tasks.length), wilsonB: wilson(pb, tasks.length), pcA: x.reduce((s, o) => s + o.pc, 0) / tasks.length, pcB: y.reduce((s, o) => s + o.pc, 0) / tasks.length, pcDiff: pc.meanDiff, pcP: pc.p,
    neverGraded: { a: tasks.filter(t => A.get(t).neverGraded), b: tasks.filter(t => B.get(t).neverGraded) } };
}

/** Cost and tokens from a run's repo summary. */
export function costOf(dir) {
  const s = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  return { n: s.n ?? null, spentUsd: s.cost?.spentUsd ?? null, perTaskUsd: s.n ? (s.cost?.spentUsd ?? NaN) / s.n : null, unknownCostSessions: s.cost?.unknownCostSessions ?? null, tokens: s.tokens?.byModel ?? null, envFaults: s.envFaults ?? null };
}

/**
 * The analysis. dirs: { key -> absolute repo run directory }. S: the sequential module (readPlan, verifyLookRuns,
 * analyzeLooks). Returns the report object.
 */
export function analyze({ plan, dirs, S, harm = null }) {
  const L = plan.looks.find(x => x.look === LOOK);
  const tasks = [...L.tasks];
  const outcomes = {}, sources = {}, absent = [];
  for (const a of ARMS) {
    const dir = dirs[a.key];
    if (!dir || !existsSync(path.join(dir, 'results.jsonl'))) { if (!a.optional) absent.push(a.key); continue; }
    const v = S.verifyLookRuns(plan, LOOK, [dir], { role: a.role, firstLook: a.role === 'treatment' ? a.firstLook : null });
    if (v.arm !== a.arm) throw new Error(`${a.key}: the sidecar names arm ${JSON.stringify(v.arm)}, not ${JSON.stringify(a.arm)}`);
    outcomes[a.key] = v.outcomes; sources[a.key] = { dir, ...costOf(dir) };
  }
  const kept = tasks.filter(t => !EXPOSED.includes(t));
  const pair = (a, b, set) => (outcomes[a] && outcomes[b] ? paired(outcomes[a], outcomes[b], set) : { absent: [a, b].filter(k => !outcomes[k]) });
  const report = { plan: plan.planSha256, look: LOOK, tasks: tasks.length, exposed: EXPOSED.filter(t => tasks.includes(t)), absent, arms: sources };
  if (outcomes['A0-AA'] && outcomes.A0) report.t3 = { note: 'T3 A/A (AMEND-1 §4), read before the confirmatory result; descriptive', ...pair('A0-AA', 'A0', tasks) };
  if (outcomes.v2 && outcomes.A0) {
    const missing = tasks.filter(t => !outcomes.v2.has(t) || !outcomes.A0.has(t));
    report.confirmatory = missing.length ? { incomplete: true, missing: missing.length }
      : { note: 'SEQUENTIAL-PLAN-v1 look 2, A1-C v2 (first look 2) vs A0; D23 fixed sequence', ...S.analyzeLooks(plan, { [LOOK]: outcomes.A0 }, { [LOOK]: outcomes.v2 }, { firstLook: 2 }) };
  }
  report.descriptive = DESCRIPTIVE.map(([a, b]) => ({ a, b, all: pair(a, b, tasks), sensitivity: pair(a, b, kept) }));
  const vv = report.descriptive.find(d => d.a === 'v2' && d.b === 'v1')?.all;
  if (vv && !vv.incomplete && !vv.absent) {
    const c2 = sources.v2?.perTaskUsd, c1 = sources.v1?.perTaskUsd;
    report.gate = { note: 'development gate for devCheck look 3 (A1C-V2-DESIGN.md §5); never a claim', strictDiff: vv.diff, strictOk: vv.diff >= GATE.strictTasks, pcDiff: vv.pcDiff, pcOk: vv.pcDiff >= GATE.partialCredit,
      costPerTask: { v2: c2, v1: c1, ok: c2 != null && c1 != null && c2 <= c1 }, harm: harm ?? 'not given (run replay/harm.mjs --run <v1 live> --run2 <v2 live>)', rest: 'mean responses, H3, L1-L5 and the Δdev60 condition: §5, read by hand' };
  }
  return report;
}

function args(argv) { const a = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i].replace(/^--/, ''); if (k === 'json') a.json = true; else a[k] = argv[++i]; } return a; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args(process.argv.slice(2));
  const S = await import('../sequential.mjs');
  const branch = path.resolve(a.branch ?? REPO), pin = a.pin ? path.resolve(a.pin) : null;
  const plan = S.readPlan(path.join(branch, PLAN_REL));
  if (plan.draft) throw new Error('the plan is not the frozen plan');
  const dirs = Object.fromEntries(ARMS.map(x => [x.key, path.join(x.checkout === 'pin' ? (pin ?? branch) : branch, RUNS_REL, x.runId)]));
  for (const kv of (a.runs ?? '').split(',').filter(Boolean)) { const [k, d] = kv.split('='); dirs[k] = path.resolve(d); }
  const harm = a.harm ? JSON.parse(readFileSync(a.harm, 'utf8')) : null;
  const r = analyze({ plan, dirs, S, harm });
  if (a.write) writeFileSync(a.write, JSON.stringify(r, null, 1) + '\n');
  if (a.json) { process.stdout.write(JSON.stringify(r, null, 1) + '\n'); process.exit(0); }
  const f = x => (x == null || Number.isNaN(x) ? '–' : typeof x === 'number' ? (Math.abs(x) < 1 && x !== 0 ? x.toFixed(4) : String(x)) : String(x));
  if (r.absent.length) console.log(`absent arms: ${r.absent.join(', ')}`);
  if (r.t3) console.log(`T3 A/A (read first): A0 ${r.t3.a ?? '–'} vs ${r.t3.b ?? '–'} (${r.t3.aOnly}:${r.t3.bOnly}), McNemar p ${f(r.t3.p)}`);
  if (r.confirmatory?.rows) for (const row of r.confirmatory.rows) console.log(row.status === 'complete' ? `CONFIRMATORY look ${row.look}: v2 ${row.strict.treatment} vs A0 ${row.strict.control} (${row.strict.b}:${row.strict.c}), p ${f(row.strict.p)} vs ${row.nominal.strict.toPrecision(3)}; decision: ${r.confirmatory.decision.label}` : `CONFIRMATORY look ${row.look}: ${row.status}`);
  else if (r.confirmatory) console.log(`CONFIRMATORY: incomplete (${r.confirmatory.missing} task(s) without an outcome)`);
  for (const d of r.descriptive) {
    const s = x => (x.absent ? `absent (${x.absent.join(', ')})` : x.incomplete ? `incomplete (${x.missing})` : `${x.a} vs ${x.b} of ${x.n} (${x.aOnly}:${x.bOnly}), exact McNemar p ${f(x.p)}; partial credit ${f(x.pcDiff)}`);
    console.log(`descriptive ${d.a} vs ${d.b}: ${s(d.all)} | without the ${r.exposed.length} exposed tasks: ${s(d.sensitivity)}`);
  }
  if (r.gate) console.log(`gate (devCheck look 3, never a claim): strict ${r.gate.strictDiff >= 0 ? '+' : ''}${r.gate.strictDiff} (${r.gate.strictOk ? 'ok' : 'no'}), partial credit ${f(r.gate.pcDiff)} (${r.gate.pcOk ? 'ok' : 'no'}), cost per task ${f(r.gate.costPerTask.v2)} vs ${f(r.gate.costPerTask.v1)} (${r.gate.costPerTask.ok ? 'ok' : 'no'})`);
}
