#!/usr/bin/env node
// Group-sequential dev design for AutomationBench comparisons (register A4; research/compromises-20261021/FIXES.md §2
// action 7; research/automationbench-20261014/PREREG-AB-v1-AMEND-1.md, DRAFT until the orchestrator freezes it). $0 here:
// this file plans, prints run commands, analyses stored rows and simulates; only `look --exec` starts a paid run.
//
// Design (FIXES A4 as amended by the skeptic):
//   - New tasks at k = 1, paired, never repeats: look 1 is the stored dev60 rows (devTrain, --subset 60 --seed 21; $0),
//     later looks are disjoint batches of unexposed devTrain tasks. Stored A0 outcomes are the control, run once per
//     batch and reused.
//   - Never devCheck: every selection is checked against SPLIT-v1's devCheck list, whose hash must be the one PREREG-AB-v1
//     §1.1 records (74cf7615…25a7). Never test: loadSplit/assertDevOnly.
//   - Co-primary metrics: strict pass (exact McNemar; stays the headline) and official partial credit (paired sign-flip
//     permutation), each at two-sided alpha 0.025 with its own O'Brien-Fleming schedule (Bonferroni over the two metrics,
//     so the family-wise type-I over both metrics and every look is at most 0.05). The boundary uses the planned
//     cumulative task counts as information fractions. A strict-pass claim needs the strict test to cross.
//   - Reported beside every look, never deciding: the Beta-mixture e-value (anytime-valid, for an unplanned look), Wilson
//     intervals per arm and paired Bayes intervals for both metrics (exact/Bayes intervals at n < 200).
//
//   node experiments/autobench/sequential.mjs plan [--batch 60] [--min-look 20] [--live-root DIR|none] [--write FILE] [--json]
//   node experiments/autobench/sequential.mjs look N --plan FILE [--descriptor FILE] [--exec] -- <run.mjs options…>
//   node experiments/autobench/sequential.mjs analyze --plan FILE --control 1:a0-dev60-dn [--control 2:RUN] \
//        --treatment 1:a1-dev60-dn,a1-dev60-dn-fill [--treatment 2:RUN] [--json]
//   node experiments/autobench/sequential.mjs simulate [--plan FILE] [--reps 20000] [--json]   (T2: type-I under H0)
//
// The unexposed pool, from data on disk (names only, never grades): devTrain minus the forced set (SPLIT-v1, 103), minus
// the dev tasks briefed by the families agent (EXPOSURE-20261015.json, AM-2), minus every task named by any recorded run
// (the repo's runs/*/summary.json and launch.json, and the live root's), minus look 1. FIXES assumed 137 unexposed tasks;
// it did not subtract dev60's 37 non-forced tasks, so the feasible schedule is smaller (see `plan`).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_DOMAINS, REPO, sha256 } from './lib.mjs';
import { assertDevOnly, domainOf, listSha256, loadSplit } from './split.mjs';
import { mcnemarExactCounts, mixtureEvalue, obrienFlemingBoundary, pairedBayesInterval, pairedPermutation, pairedSignFlipZ, twoSidedP, wilson } from '../lib/stats.mjs';
import { rng } from '../../beds/lib/rng.mjs';

export const SCHEMA = 'foundry.autobench.sequential-plan/v1';
export const RUNS = path.join(REPO, 'research/automationbench-20261014/runs');
export const EXPOSURE = path.join(REPO, 'research/automationbench-20261014/EXPOSURE-20261015.json');
export const LIVE_ROOT = '/var/tmp/foundry-work/autobench';
export const LOOK1_RUN = 'a0-dev60';                  // the stored dev60 selection (devTrain, subset 60, seed 21)
export const SALT = 'ab-seq-v1:';
export const ALPHA_TOTAL = 0.05;
export const ALPHA_PER_METRIC = 0.025;                // Bonferroni over the two co-primary metrics
/** PREREG-AB-v1 §1.1 records the devCheck list hash abbreviated as `74cf7615…25a7`. */
export const PREREG_DEVCHECK = Object.freeze({ prefix: '74cf7615', suffix: '25a7' });

// ------------------------------------------------------------------------------------------------ split guards
/** The recorded split, with its devCheck list checked against the hash PREREG-AB-v1 recorded. */
export function checkedSplit(split = loadSplit()) {
  const h = listSha256(split.devCheck);
  if (h !== split.sha256.devCheck || !h.startsWith(PREREG_DEVCHECK.prefix) || !h.endsWith(PREREG_DEVCHECK.suffix)) {
    throw new Error(`devCheck list hash ${h.slice(0, 8)}…${h.slice(-4)} is not PREREG-AB-v1's ${PREREG_DEVCHECK.prefix}…${PREREG_DEVCHECK.suffix}`);
  }
  if (split.devCheck.length !== 60) throw new Error(`devCheck holds ${split.devCheck.length} tasks, not 60`);
  return split;
}
/** Throws if any task is a devCheck task (the A4 rule: looks never touch devCheck), or not a dev task at all. */
export function assertNoDevCheck(tasks, split = checkedSplit()) {
  const dc = new Set(split.devCheck);
  const bad = tasks.filter(t => dc.has(t));
  if (bad.length) throw new Error(`sequential: ${bad.length} devCheck task(s) selected; looks run on devTrain only (PREREG-AB-v1 §5)`);
  assertDevOnly(tasks, split);
  return true;
}

// ------------------------------------------------------------------------------------------------ exposure
const readJsonSafe = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
/** Task names of every recorded run under the given roots (summary.json and launch.json `tasks`; names only). */
export function seenTasks(roots) {
  const seen = new Map();
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const f of ['summary.json', 'launch.json']) {
        const j = readJsonSafe(path.join(root, d.name, f));
        for (const t of j?.tasks ?? []) if (typeof t === 'string') { if (!seen.has(t)) seen.set(t, new Set()); seen.get(t).add(`${path.basename(root)}/${d.name}`); }
      }
    }
  }
  return seen;
}
/** Look 1: the stored dev60 tasks, checked against the recorded selection. */
export function look1Tasks() {
  const s = JSON.parse(readFileSync(path.join(RUNS, LOOK1_RUN, 'summary.json'), 'utf8'));
  const sel = s.selection ?? {};
  if (sel.pool !== 'devTrain' || sel.subset !== 60 || String(sel.seed) !== '21' || s.tasks?.length !== 60) throw new Error(`${LOOK1_RUN}: not the dev60 selection (devTrain, subset 60, seed 21)`);
  return [...s.tasks];
}

// ------------------------------------------------------------------------------------------------ plan
const byKey = (a, b) => { const x = sha256(SALT + a), y = sha256(SALT + b); return x < y ? -1 : x > y ? 1 : 0; };
const fractionsOf = cum => cum.map(n => n / cum[cum.length - 1]);
export const boundariesFor = cumulative => ({
  strict: obrienFlemingBoundary(cumulative.length, { alpha: ALPHA_PER_METRIC, fractions: cumulative }),
  partialCredit: obrienFlemingBoundary(cumulative.length, { alpha: ALPHA_PER_METRIC, fractions: cumulative }),
});

/**
 * The look schedule. Look 1 = the dev60 tasks; looks 2.. take, per domain in sha256(SALT + task) order, up to batch/6
 * tasks each from the unexposed pool; a last look smaller than minLook is not formed (its tasks stay unused, listed).
 */
export function computePlan({ split = checkedSplit(), look1 = look1Tasks(), exposure, batch = 60, minLook = 20, domains = PUBLIC_DOMAINS } = {}) {
  assertNoDevCheck(look1, split);
  const devCheck = new Set(split.devCheck);
  const devTrain = split.dev.filter(t => !devCheck.has(t));
  const forced = new Set(split.forcedSources.flatMap(f => f.tasks));
  const briefed = new Set(exposure.briefed ?? []), seen = exposure.seen ?? new Map(), l1 = new Set(look1);
  const why = t => (forced.has(t) ? 'forced' : briefed.has(t) ? 'briefed (AM-2)' : l1.has(t) ? 'look 1' : seen.has(t) ? 'run before' : null);
  const excluded = { forced: 0, 'briefed (AM-2)': 0, 'look 1': 0, 'run before': 0 };
  const eligible = [];
  for (const t of devTrain) { const w = why(t); if (w) excluded[w]++; else eligible.push(t); }
  const perDomainQuota = Math.floor(batch / domains.length);
  const queues = new Map(domains.map(d => [d, eligible.filter(t => domainOf(t) === d).sort(byKey)]));
  const looks = [{ look: 1, source: `stored dev60 rows (runs/${LOOK1_RUN}: devTrain, subset 60, seed 21)`, tasks: [...look1].sort() }];
  let unused = [];
  for (;;) {
    const tasks = domains.flatMap(d => queues.get(d).splice(0, perDomainQuota));
    if (!tasks.length) break;
    if (tasks.length < minLook) { unused = tasks; break; }
    looks.push({ look: looks.length + 1, source: `unexposed devTrain, ${perDomainQuota} per domain in sha256('${SALT}' + task) order`, tasks: tasks.sort() });
  }
  for (const L of looks) { assertNoDevCheck(L.tasks, split); L.n = L.tasks.length; L.perDomain = Object.fromEntries(domains.map(d => [d, L.tasks.filter(t => domainOf(t) === d).length])); L.sha256 = listSha256(L.tasks); }
  const all = looks.flatMap(L => L.tasks);
  if (new Set(all).size !== all.length) throw new Error('sequential: looks overlap');
  let c = 0;
  const cumulative = looks.map(L => (c += L.n));
  const b = boundariesFor(cumulative);
  const plan = {
    schema: SCHEMA, status: 'DRAFT (PREREG-AB-v1-AMEND-1 not frozen)', split: { devCheck: split.sha256.devCheck, dev: split.sha256.dev },
    rule: `look 1 = stored dev60; looks 2.. = ${perDomainQuota} per domain from the unexposed devTrain pool in sha256('${SALT}' + task) order; a remainder under ${minLook} is unused`,
    batch, minLook, salt: SALT, looks, cumulative, fractions: fractionsOf(cumulative),
    alpha: { total: ALPHA_TOTAL, perMetric: ALPHA_PER_METRIC },
    nominal: { strict: b.strict.nominal, partialCredit: b.partialCredit.nominal },
    pool: { devTrain: devTrain.length, eligible: eligible.length, excluded, unused: unused.sort() },
  };
  plan.planSha256 = sha256(JSON.stringify({ ...plan, planSha256: undefined }));
  return plan;
}
export function readPlan(file) {
  const p = JSON.parse(readFileSync(file, 'utf8'));
  if (p.schema !== SCHEMA) throw new Error(`${file}: schema ${p.schema} != ${SCHEMA}`);
  if (sha256(JSON.stringify({ ...p, planSha256: undefined })) !== p.planSha256) throw new Error(`${file}: plan hash mismatch (edited after it was written)`);
  for (const L of p.looks) { assertNoDevCheck(L.tasks); if (listSha256(L.tasks) !== L.sha256) throw new Error(`${file}: look ${L.look} task list hash mismatch`); }
  return p;
}

// ------------------------------------------------------------------------------------------------ look (run descriptor)
/** The descriptor run.mjs records in launch.json (`--sequential-look`): look number, boundaries, plan hash, task hash. */
export function lookDescriptor(plan, n) {
  const L = plan.looks.find(x => x.look === n);
  if (!L) throw new Error(`plan has no look ${n} (looks: ${plan.looks.map(x => x.look).join(', ')})`);
  assertNoDevCheck(L.tasks);
  return { design: 'PREREG-AB-v1-AMEND-1 group-sequential (A4)', plan: plan.planSha256, look: n, looks: plan.looks.length, tasks: L.tasks, tasksSha256: L.sha256,
    cumulative: plan.cumulative[n - 1], fraction: plan.fractions[n - 1], nominal: { strict: plan.nominal.strict[n - 1], partialCredit: plan.nominal.partialCredit[n - 1] }, alphaPerMetric: plan.alpha.perMetric };
}

// ------------------------------------------------------------------------------------------------ analyze
/** Outcomes by task from repo run directories (results.jsonl; sealed files are refused). Later directories override. */
export function loadOutcomes(dirs, { runsRoot = RUNS } = {}) {
  const out = new Map();
  for (const d of dirs) {
    const dir = path.isAbsolute(d) ? d : path.join(runsRoot, d);
    if (existsSync(path.join(dir, 'results.sealed.jsonl')) && !existsSync(path.join(dir, 'results.jsonl'))) throw new Error(`${d}: a sealed run (devCheck or test); never part of a sequential look`);
    for (const l of readFileSync(path.join(dir, 'results.jsonl'), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      const r = JSON.parse(l);
      if (r.forks?.some(f => f.skipped || f.deferred || f.sessionError || f.harnessError)) continue;   // not an outcome
      out.set(r.task, { pass: r.final ? r.final.task_completed_correctly : 0, pc: r.final ? r.final.partial_credit : 0 });
    }
  }
  return out;
}

/**
 * Cumulative co-primary statistics at every look both arms have complete outcomes for, in order; stops at the first
 * crossing. control/treatment: { [look]: Map(task -> { pass, pc }) }.
 */
export function analyzeLooks(plan, control, treatment, { permIterations = 100000 } = {}) {
  const rows = [];
  const x = [], y = [];   // cumulative: treatment, control
  let decided = null;
  for (const L of plan.looks) {
    const C = control[L.look], T = treatment[L.look];
    if (!C || !T) break;
    const missing = L.tasks.filter(t => !C.has(t) || !T.has(t));
    if (missing.length) { rows.push({ look: L.look, status: 'incomplete', missing: missing.length }); break; }
    for (const t of L.tasks) { x.push(T.get(t)); y.push(C.get(t)); }
    const b = x.filter((o, i) => o.pass && !y[i].pass).length, c = x.filter((o, i) => !o.pass && y[i].pass).length;
    const strict = mcnemarExactCounts(b, c);
    const pc = pairedPermutation(x.map(o => o.pc), y.map(o => o.pc), { iterations: permIterations, seed: `ab-seq-look${L.look}` });
    const nom = { strict: plan.nominal.strict[L.look - 1], partialCredit: plan.nominal.partialCredit[L.look - 1] };
    const crossed = { strict: strict.p < nom.strict, partialCredit: pc.p < nom.partialCredit };
    const dir = { strict: Math.sign(b - c), partialCredit: Math.sign(pc.meanDiff) };
    const passT = x.filter(o => o.pass).length, passC = y.filter(o => o.pass).length, n = x.length;
    const row = {
      look: L.look, n, status: 'complete', nominal: nom, crossed,
      strict: { treatment: passT, control: passC, b, c, p: strict.p, diff: (passT - passC) / n, wilsonT: wilson(passT, n), wilsonC: wilson(passC, n),
        bayes: pairedBayesInterval(x.map(o => o.pass), y.map(o => o.pass), { seed: `ab-seq-strict-${L.look}` }), eValue: mixtureEvalue(b, c) },
      partialCredit: { meanDiff: pc.meanDiff, p: pc.p, method: pc.method, bayes: pairedBayesInterval(x.map(o => o.pc), y.map(o => o.pc), { seed: `ab-seq-pc-${L.look}` }) },
    };
    rows.push(row);
    if (!decided && (crossed.strict || crossed.partialCredit)) {
      const which = Object.keys(crossed).filter(k => crossed[k]);
      const harm = which.some(k => dir[k] < 0);
      decided = { look: L.look, label: `${harm ? 'harm' : 'effect'} at look ${L.look} (${which.join(' and ')})`, strictClaim: crossed.strict && dir.strict > 0 };
      break;
    }
  }
  const last = rows.filter(r => r.status === 'complete').at(-1);
  const decision = decided ?? (last && last.look === plan.looks.length ? { look: last.look, label: 'final look: no resolvable difference', strictClaim: false }
    : { look: last?.look ?? 0, label: last ? `continue: run look ${last.look + 1}` : 'no complete look', strictClaim: false });
  return { plan: plan.planSha256, rows, decision };
}

// ------------------------------------------------------------------------------------------------ simulate (T2)
/** Per-task outcome population from stored dev60 runs: { task: [{ pass, pc }, …] } (A0 and A1, original and date note). */
export function storedPopulation(groups = [['a0-dev60'], ['a0-dev60-dn'], ['a1-dev60'], ['a1-dev60-dn', 'a1-dev60-dn-fill']]) {
  const maps = groups.map(g => loadOutcomes(g));
  const tasks = [...maps[0].keys()].filter(t => maps.every(m => m.has(t))).sort();
  return tasks.map(t => maps.map(m => m.get(t)));
}

/**
 * Type-I error (two-sided, both directions) of the co-primary schedule under H0: both arms draw each task's outcome from
 * the same pooled stored outcomes (an A/A comparison), tasks resampled from the stored population. Partial credit uses
 * the sign-flip test's normal form (pairedSignFlipZ) for speed; strict uses the exact McNemar. Also reports each metric
 * alone at the full 0.05 schedule, to show what the Bonferroni split costs.
 */
export function simulateSchedule({ cumulative, reps = 20000, seed = 'ab-seq-sim', population = storedPopulation(), alternative = null } = {}) {
  const r = rng(seed, cumulative.join(','), reps, alternative ? 'h1' : 'h0');
  const half = boundariesFor(cumulative), full = obrienFlemingBoundary(cumulative.length, { alpha: ALPHA_TOTAL, fractions: cumulative });
  const draw = (arr) => arr[Math.floor(r.next() * arr.length)];
  let combined = 0, strictOnly = 0, pcOnly = 0, strictFull = 0, pcFull = 0, used = 0;
  for (let i = 0; i < reps; i++) {
    const x = [], y = [];
    let stop = { combined: false, strict: false, pc: false, strictFull: false, pcFull: false }, n = 0, stoppedAt = cumulative.at(-1);
    for (let k = 0; k < cumulative.length; k++) {
      for (; n < cumulative[k]; n++) {
        const outs = population[Math.floor(r.next() * population.length)];
        if (alternative) { x.push(draw(alternative.treatment(outs))); y.push(draw(alternative.control(outs))); } else { x.push(draw(outs)); y.push(draw(outs)); }
      }
      const b = x.filter((o, j) => o.pass && !y[j].pass).length, c = x.filter((o, j) => !o.pass && y[j].pass).length;
      const ps = mcnemarExactCounts(b, c).p, pp = twoSidedP(pairedSignFlipZ(x.map(o => o.pc), y.map(o => o.pc)));
      const cs = ps < half.strict.nominal[k], cp = pp < half.partialCredit.nominal[k];
      if (!stop.combined && (cs || cp)) { stop.combined = true; stoppedAt = cumulative[k]; }
      if (cs) stop.strict = true;
      if (cp) stop.pc = true;
      if (ps < full.nominal[k]) stop.strictFull = true;
      if (pp < full.nominal[k]) stop.pcFull = true;
    }
    combined += stop.combined; strictOnly += stop.strict; pcOnly += stop.pc; strictFull += stop.strictFull; pcFull += stop.pcFull; used += stoppedAt;
  }
  const f = v => v / reps;
  return { cumulative, reps, hypothesis: alternative ? 'H1' : 'H0', combined: f(combined), strictAtHalfAlpha: f(strictOnly), partialCreditAtHalfAlpha: f(pcOnly),
    strictAtFullAlpha: f(strictFull), partialCreditAtFullAlpha: f(pcFull), meanTasks: used / reps, mcSE: Math.sqrt(0.05 * 0.95 / reps) };
}

// ------------------------------------------------------------------------------------------------ CLI
function parseArgs(argv) {
  const a = { _: [], control: [], treatment: [], passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--') { a.passthrough = argv.slice(i + 1); break; }
    if (!k.startsWith('--')) { a._.push(k); continue; }
    const name = k.slice(2), v = argv[i + 1];
    if (name === 'control' || name === 'treatment') { a[name].push(v); i++; continue; }
    if (v === undefined || v.startsWith('--')) a[name] = true; else { a[name] = v; i++; }
  }
  return a;
}
const lookMap = specs => Object.fromEntries(specs.map(s => { const [n, dirs] = s.split(':'); return [Number(n), loadOutcomes(dirs.split(',').filter(Boolean))]; }));

async function main(argv) {
  const a = parseArgs(argv);
  const cmd = a._[0];
  if (cmd === 'plan') {
    const split = checkedSplit();
    const exposure = JSON.parse(readFileSync(EXPOSURE, 'utf8'));
    const roots = [RUNS, a['live-root'] === 'none' ? null : a['live-root'] ?? LIVE_ROOT];
    const plan = computePlan({ split, exposure: { briefed: exposure.dev.exposedNotForced, seen: seenTasks(roots) }, batch: Number(a.batch ?? 60), minLook: Number(a['min-look'] ?? 20) });
    if (a.write) writeFileSync(a.write, JSON.stringify(plan, null, 1) + '\n');
    if (a.json) { console.log(JSON.stringify(plan, null, 1)); return; }
    console.log(`plan ${plan.planSha256.slice(0, 16)} (${plan.status})`);
    console.log(`devTrain ${plan.pool.devTrain}; excluded ${JSON.stringify(plan.pool.excluded)}; eligible ${plan.pool.eligible}; unused remainder ${plan.pool.unused.length}`);
    for (const L of plan.looks) console.log(`look ${L.look}: ${L.n} tasks (${Object.values(L.perDomain).join('/')} by domain), cumulative ${plan.cumulative[L.look - 1]}, nominal strict ${plan.nominal.strict[L.look - 1].toPrecision(3)}, partial credit ${plan.nominal.partialCredit[L.look - 1].toPrecision(3)}`);
    if (a.write) console.log(`wrote ${a.write}`);
    return;
  }
  if (cmd === 'look') {
    const n = Number(a._[1]);
    const plan = readPlan(a.plan);
    const d = lookDescriptor(plan, n);
    const descFile = a.descriptor ?? path.join(path.dirname(path.resolve(a.plan)), `sequential-look-${n}.json`);
    writeFileSync(descFile, JSON.stringify(d, null, 1) + '\n');
    const args = ['experiments/autobench/run.mjs', '--tasks', d.tasks.join(','), '--sequential-look', descFile, ...a.passthrough];
    console.log(`look ${n}: ${d.tasks.length} tasks, nominal strict ${d.nominal.strict.toPrecision(3)}, partial credit ${d.nominal.partialCredit.toPrecision(3)}; descriptor ${descFile}`);
    console.log(`node ${args.join(' ')}`);
    if (a.exec) { const r = spawnSync(process.execPath, args, { cwd: REPO, stdio: 'inherit' }); process.exitCode = r.status ?? 1; }
    return;
  }
  if (cmd === 'analyze') {
    const plan = readPlan(a.plan);
    const res = analyzeLooks(plan, lookMap(a.control), lookMap(a.treatment));
    if (a.json) { console.log(JSON.stringify(res, null, 1)); return; }
    for (const r of res.rows) {
      if (r.status !== 'complete') { console.log(`look ${r.look}: ${r.status} (${r.missing} task(s) without an outcome in an arm)`); continue; }
      console.log(`look ${r.look} (n ${r.n}): strict ${r.strict.treatment} vs ${r.strict.control}, ${r.strict.b}:${r.strict.c}, McNemar p ${r.strict.p.toFixed(4)} vs ${r.nominal.strict.toPrecision(3)}${r.crossed.strict ? ' CROSSED' : ''}; `
        + `partial credit ${r.partialCredit.meanDiff.toFixed(3)} p ${r.partialCredit.p.toFixed(4)} vs ${r.nominal.partialCredit.toPrecision(3)}${r.crossed.partialCredit ? ' CROSSED' : ''}; e-value ${r.strict.eValue.toFixed(2)}; `
        + `Bayes strict [${r.strict.bayes.lo.toFixed(3)}, ${r.strict.bayes.hi.toFixed(3)}], partial credit [${r.partialCredit.bayes.lo.toFixed(3)}, ${r.partialCredit.bayes.hi.toFixed(3)}]`);
    }
    console.log(`decision: ${res.decision.label}${res.decision.strictClaim ? ' (a strict-pass claim is allowed)' : ''}`);
    return;
  }
  if (cmd === 'simulate') {
    const cumulative = a.plan ? readPlan(a.plan).cumulative : (a.cumulative ? String(a.cumulative).split(',').map(Number) : [60, 120, 180, 240]);
    // --h1: treatment outcomes from the stored A1 runs, control from the stored A0 runs (the in-sample dev60 effect, so the
    // power it prints is optimistic for the next, out-of-sample improvement).
    // --h1-scale s: the treatment draws from A1's outcomes with probability s and from A0's otherwise (s times the effect).
    const s = Number(a['h1-scale'] ?? 1), pick = rng('h1-scale', s);
    const alternative = a.h1 ? { treatment: outs => (pick.next() < s ? outs.slice(2) : outs.slice(0, 2)), control: outs => outs.slice(0, 2) } : null;
    const r = simulateSchedule({ cumulative, reps: Number(a.reps ?? 20000), alternative });
    if (a.json) { console.log(JSON.stringify(r, null, 1)); return; }
    console.log(`${a.h1 ? 'H1 (A1 vs A0, stored dev60 outcomes; in-sample, optimistic)' : 'H0 (A/A from stored dev60 outcomes)'}, looks at ${cumulative.join('/')}, ${r.reps} reps: co-primary rule ${r.combined.toFixed(4)} (mean tasks ${r.meanTasks.toFixed(1)}); strict alone at 0.025 ${r.strictAtHalfAlpha.toFixed(4)}, at 0.05 ${r.strictAtFullAlpha.toFixed(4)}; partial credit alone at 0.025 ${r.partialCreditAtHalfAlpha.toFixed(4)}, at 0.05 ${r.partialCreditAtFullAlpha.toFixed(4)} (MC SE at 0.05: ${r.mcSE.toFixed(4)})`);
    return;
  }
  throw new Error('usage: sequential.mjs plan|look|analyze|simulate …');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
}
