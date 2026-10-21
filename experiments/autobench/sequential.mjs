#!/usr/bin/env node
// Group-sequential dev design for AutomationBench comparisons (register A4; research/compromises-20261021/FIXES.md §2
// action 7; research/automationbench-20261014/PREREG-AB-v1-AMEND-1.md, DRAFT until the orchestrator freezes it). $0 here:
// this file plans, prints run commands, analyses stored rows and simulates; only `look --exec` starts a paid run, and only
// on a frozen plan whose hash is pinned below.
//
// Design (FIXES A4 as amended by the skeptic and by the 2026-10-21 review):
//   - New tasks at k = 1, paired, never repeats: look 1 is the dev60 task list (devTrain, --subset 60 --seed 21), later
//     looks are disjoint batches of unexposed devTrain tasks. Stored A0 outcomes are the control, run once per batch and
//     reused; on look 1 the stored dev60 A0 rows are that control ($0).
//   - Per-arm exposure: an arm developed, tuned or probed on any task of a look starts its statistic at the first look
//     after it (`firstLook`). Every arm with stored dev60 rows (A1, A1-C, A1-C v2, their Sonnet/Mercury variants) was
//     developed on dev60, so it starts at look 2, with its own O'Brien-Fleming schedule over looks 2.. (the plan carries
//     one schedule per possible first look). A treatment's look-1 rows must come from a run launched under the plan;
//     stored dev60 treatment rows are in-sample and are read only as an illustration (`analyze --illustration`).
//   - Never devCheck: every selection is checked against SPLIT-v1's devCheck list, whose hash must be the one PREREG-AB-v1
//     §1.1 records (74cf7615…25a7). Never test: loadSplit/assertDevOnly, always, whatever run.mjs flags are passed.
//   - Co-primary metrics: strict pass (exact McNemar; stays the headline) and official partial credit (paired sign-flip
//     permutation), each at two-sided alpha 0.025 with its own O'Brien-Fleming schedule (Bonferroni over the two metrics,
//     so the family-wise type-I over both metrics and every look is at most 0.05). A crossing decides only with a gap of
//     at least 3 points (0.03 partial credit; ROADMAP §4.3). A strict-pass claim needs the strict test to cross.
//   - Reported beside every look, never deciding: the Beta-mixture e-value (anytime-valid, for an unplanned look), Wilson
//     intervals per arm and paired Bayes intervals for both metrics (exact/Bayes intervals at n < 200).
//   - run.mjs is NOT changed by this design: it is in the A1 and A1-C harness manifests (PREREG-AB-v1 §5, §6.1), so the
//     look guard lives here. `look --exec` checks the task list before it spawns run.mjs and writes a sidecar,
//     sequential-look.json, into the run's live directory and its repo copy; `analyze` refuses a look run without it.
//
//   node experiments/autobench/sequential.mjs plan [--batch 60] [--min-look 20] [--live-root DIR|none] [--freeze] [--write FILE] [--json]
//   node experiments/autobench/sequential.mjs look N --plan FILE --role control|treatment --arm NAME [--first-look F] [--exec] \
//        -- --run-id ID <run.mjs options other than the task selection…>
//   node experiments/autobench/sequential.mjs analyze --plan FILE --first-look F --control 1:a0-dev60-dn [--control 2:RUN] \
//        --treatment 2:RUN [--treatment 3:RUN] [--stop-on either|strict] [--illustration] [--json]
//   node experiments/autobench/sequential.mjs simulate [--plan FILE --first-look F | --cumulative 60,120] [--reps 20000] \
//        [--pc-test normal|permutation] [--h1 [--h1-scale s]] [--json]   (T2: type-I under H0; power under --h1)
//
// The unexposed pool, from data on disk (names only, never grades): devTrain minus the forced set (SPLIT-v1, 103), minus
// the dev tasks briefed by the families agent (EXPOSURE-20261015.json, AM-2), minus every task named by any recorded run
// (summary.json, launch.json and sequential-look.json `tasks` under the main tree's runs, every worktree's runs and the
// live root; an unparsable file stops the plan), minus look 1. FIXES assumed 137 unexposed tasks; it did not subtract
// dev60's 37 non-forced tasks, so the feasible schedule is smaller (see `plan`).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_DOMAINS, REPO, sha256 } from './lib.mjs';
import { assertDevOnly, domainOf, listSha256, loadSplit } from './split.mjs';
import { mcnemarExactCounts, mixtureEvalue, obrienFlemingBoundary, pairedBayesInterval, pairedPermutation, pairedSignFlipZ, twoSidedP, wilson } from '../lib/stats.mjs';
import { rng } from '../../beds/lib/rng.mjs';

export const SCHEMA = 'foundry.autobench.sequential-plan/v2';
export const SIDECAR_SCHEMA = 'foundry.autobench.sequential-look/v1';
export const SIDECAR = 'sequential-look.json';
export const RUNS_REL = 'research/automationbench-20261014/runs';
export const RUNS = path.join(REPO, RUNS_REL);
export const EXPOSURE = path.join(REPO, 'research/automationbench-20261014/EXPOSURE-20261015.json');
export const LIVE_ROOT = '/var/tmp/foundry-work/autobench';
export const RUNNER = path.join(REPO, 'experiments/autobench/run.mjs');
export const LOOK1_RUN = 'a0-dev60';                  // the stored dev60 selection (devTrain, subset 60, seed 21)
export const SALT = 'ab-seq-v1:';
export const ALPHA_TOTAL = 0.05;
export const ALPHA_PER_METRIC = 0.025;                // Bonferroni over the two co-primary metrics
export const FLOOR = 0.03;                            // ROADMAP §4.3: gaps under 3 points (0.03 partial credit) are noise
/** PREREG-AB-v1 §1.1 records the devCheck list hash abbreviated as `74cf7615…25a7`. */
export const PREREG_DEVCHECK = Object.freeze({ prefix: '74cf7615', suffix: '25a7' });
/**
 * The frozen plan's sha256, pinned here at freeze (PREREG-AB-v1-AMEND-1 §8). null while the amendment is a DRAFT: then a
 * plan reads only as DRAFT (analyses are labelled so) and `look --exec` refuses to start a paid run.
 */
export const FROZEN_PLAN_SHA256 = null;
/** run.mjs options a look may not pass: the task list comes from the plan, and the repo copy is what `analyze` reads. */
export const REFUSED_RUN_OPTIONS = Object.freeze(['--tasks', '--pool', '--subset', '--seed', '--domains', '--test-run', '--no-copy', '--dry-run']);

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
/** The main tree (a worktree's REPO lives under <main>/.claude/worktrees/<name>). */
export const mainTree = (repo = REPO) => (repo.includes(`${path.sep}.claude${path.sep}worktrees${path.sep}`) ? repo.slice(0, repo.indexOf(`${path.sep}.claude${path.sep}worktrees${path.sep}`)) : repo);
/** Every run root whose task names count as exposure: the main tree's runs, every worktree's runs, the live root. */
export function exposureRoots({ repo = REPO, liveRoot = LIVE_ROOT } = {}) {
  const main = mainTree(repo), roots = [{ label: `main:${RUNS_REL}`, dir: path.join(main, RUNS_REL) }];
  const wt = path.join(main, '.claude', 'worktrees');
  if (existsSync(wt)) for (const d of readdirSync(wt, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name).sort()) roots.push({ label: `worktree:${d}:${RUNS_REL}`, dir: path.join(wt, d, RUNS_REL) });
  if (liveRoot) roots.push({ label: `live:${liveRoot}`, dir: liveRoot });
  return roots;
}
const readJsonStrict = f => {
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { throw new Error(`sequential: ${f} is unreadable or not JSON (${e.message}); the exposure record cannot be trusted, so nothing is planned (re-run once the file is whole)`); }
};
/**
 * Task names of every recorded run under the given roots (summary.json, launch.json and sequential-look.json `tasks`;
 * names only). An unparsable file throws: a run silently dropped would put its tasks back into the "unexposed" pool.
 * roots: directories, or { label, dir }. Returns Map(task -> Set of "label/run"), with .scanned = [{ label, runs }].
 */
export function seenTasks(roots) {
  const seen = new Map(), scanned = [];
  for (const r of roots) {
    const { label, dir } = typeof r === 'string' ? { label: path.basename(r ?? ''), dir: r } : r;
    if (!dir || !existsSync(dir)) { scanned.push({ label, runs: 0, missing: true }); continue; }
    let runs = 0;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      let any = false;
      for (const f of ['summary.json', 'launch.json', SIDECAR]) {
        const file = path.join(dir, d.name, f);
        if (!existsSync(file)) continue;
        const j = readJsonStrict(file);
        if (j?.tasks !== undefined && !Array.isArray(j.tasks)) throw new Error(`sequential: ${file}: tasks is not a list`);
        for (const t of j?.tasks ?? []) {
          if (typeof t !== 'string') throw new Error(`sequential: ${file}: a task name is not a string`);
          if (!seen.has(t)) seen.set(t, new Set());
          seen.get(t).add(`${label}/${d.name}`);
        }
        any = true;
      }
      runs += any;
    }
    scanned.push({ label, runs });
  }
  Object.defineProperty(seen, 'scanned', { value: scanned, enumerable: false });
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
/** One O'Brien-Fleming schedule per possible first look F: looks F..last, cumulative task counts from look F. */
export function schedulesFor(counts) {
  return counts.map((_, f) => {
    let c = 0;
    const cumulative = counts.slice(f).map(n => (c += n)), b = boundariesFor(cumulative);
    return { firstLook: f + 1, looks: cumulative.map((__, i) => f + 1 + i), cumulative, fractions: fractionsOf(cumulative), nominal: { strict: b.strict.nominal, partialCredit: b.partialCredit.nominal } };
  });
}
const planHash = plan => sha256(JSON.stringify({ ...plan, planSha256: undefined, draft: undefined }));

/**
 * The look schedule. Look 1 = the dev60 tasks; looks 2.. take, per domain in sha256(SALT + task) order, up to batch/6
 * tasks each from the unexposed pool; a last look smaller than minLook is not formed (its tasks stay unused, listed).
 */
export function computePlan({ split = checkedSplit(), look1 = look1Tasks(), exposure, batch = 60, minLook = 20, domains = PUBLIC_DOMAINS, freeze = false } = {}) {
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
  const looks = [{ look: 1, source: `the dev60 task list (runs/${LOOK1_RUN}: devTrain, subset 60, seed 21); stored A0 rows are its control`, tasks: [...look1].sort() }];
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
  const counts = looks.map(L => L.n);
  const plan = {
    schema: SCHEMA, status: freeze ? 'FROZEN (PREREG-AB-v1-AMEND-1)' : 'DRAFT (PREREG-AB-v1-AMEND-1 not frozen)', split: { devCheck: split.sha256.devCheck, dev: split.sha256.dev },
    rule: `look 1 = the dev60 tasks; looks 2.. = ${perDomainQuota} per domain from the unexposed devTrain pool in sha256('${SALT}' + task) order; a remainder under ${minLook} is unused`,
    exposureRule: 'an arm developed, tuned or probed on any task of a look starts at the first look after it (firstLook); every arm with stored dev60 rows starts at look 2',
    batch, minLook, salt: SALT, looks, counts, schedules: schedulesFor(counts),
    alpha: { total: ALPHA_TOTAL, perMetric: ALPHA_PER_METRIC }, floor: FLOOR,
    pool: { devTrain: devTrain.length, eligible: eligible.length, excluded, unused: unused.sort(), roots: exposure.roots ?? seen.scanned ?? null },
  };
  plan.planSha256 = planHash(plan);
  return plan;
}

/**
 * A plan file, checked: its own hash; every look's task hash, disjointness, never devCheck; look 1 = the dev60 list;
 * counts and every schedule's boundaries recomputed from the looks (an edited nominal level is refused); and, once
 * frozen, the hash pinned in FROZEN_PLAN_SHA256. Returns the plan with `draft` set when it is not the frozen one.
 */
export function readPlan(file, { frozen = FROZEN_PLAN_SHA256, look1 = look1Tasks() } = {}) {
  const p = JSON.parse(readFileSync(file, 'utf8'));
  if (p.schema !== SCHEMA) throw new Error(`${file}: schema ${p.schema} != ${SCHEMA}`);
  if (planHash(p) !== p.planSha256) throw new Error(`${file}: plan hash mismatch (edited after it was written)`);
  const split = checkedSplit();
  if (p.split?.devCheck !== split.sha256.devCheck || p.split?.dev !== split.sha256.dev) throw new Error(`${file}: planned on another split`);
  for (const L of p.looks) { assertNoDevCheck(L.tasks, split); if (listSha256(L.tasks) !== L.sha256 || L.n !== L.tasks.length) throw new Error(`${file}: look ${L.look} task list hash mismatch`); }
  const all = p.looks.flatMap(L => L.tasks);
  if (new Set(all).size !== all.length) throw new Error(`${file}: looks overlap`);
  if (JSON.stringify(p.looks[0]?.tasks) !== JSON.stringify([...look1].sort())) throw new Error(`${file}: look 1 is not the dev60 task list`);
  const counts = p.looks.map(L => L.n), want = schedulesFor(counts);
  if (JSON.stringify(p.counts) !== JSON.stringify(counts) || p.schedules?.length !== want.length) throw new Error(`${file}: look counts or schedules do not match the looks`);
  for (let i = 0; i < want.length; i++) {
    const s = p.schedules[i], w = want[i];
    const close = (a, b) => a.length === b.length && a.every((x, j) => Math.abs(x - b[j]) <= 1e-12 * Math.max(1, Math.abs(b[j])));
    if (s.firstLook !== w.firstLook || JSON.stringify(s.cumulative) !== JSON.stringify(w.cumulative) || !close(s.nominal.strict, w.nominal.strict) || !close(s.nominal.partialCredit, w.nominal.partialCredit)) {
      throw new Error(`${file}: schedule from look ${w.firstLook} does not match the boundaries recomputed from its task counts`);
    }
  }
  if (p.alpha?.perMetric !== ALPHA_PER_METRIC || p.alpha?.total !== ALPHA_TOTAL) throw new Error(`${file}: alpha ${JSON.stringify(p.alpha)} is not the amendment's`);
  const isFrozen = frozen !== null && p.planSha256 === frozen;
  if (frozen !== null && !isFrozen) throw new Error(`${file}: plan ${p.planSha256.slice(0, 16)}… is not the frozen plan ${frozen.slice(0, 16)}…`);
  if (isFrozen && !/^FROZEN/.test(p.status)) throw new Error(`${file}: the pinned plan must carry a FROZEN status`);
  if (!isFrozen && /^FROZEN/.test(p.status)) throw new Error(`${file}: a FROZEN plan whose hash is not pinned in FROZEN_PLAN_SHA256`);
  return Object.assign(p, { draft: !isFrozen });
}
export const scheduleOf = (plan, firstLook) => {
  const s = plan.schedules.find(x => x.firstLook === firstLook);
  if (!Number.isInteger(firstLook) || !s) throw new Error(`firstLook must be declared: one of ${plan.schedules.map(x => x.firstLook).join(', ')} (an arm developed on a look's tasks starts after it)`);
  return s;
};

// ------------------------------------------------------------------------------------------------ look (guard + sidecar)
/** The task list of look n, checked: never devCheck, dev only (always), the plan's list and hash. */
export function lookTasks(plan, n, split = checkedSplit()) {
  const L = plan.looks.find(x => x.look === n);
  if (!L) throw new Error(`plan has no look ${n} (looks: ${plan.looks.map(x => x.look).join(', ')})`);
  assertNoDevCheck(L.tasks, split);
  if (listSha256(L.tasks) !== L.sha256) throw new Error(`look ${n}: task list hash mismatch`);
  return L.tasks;
}
const flagValue = (argv, name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
/**
 * The sidecar a look run carries (live directory and repo copy): which plan, look, task list, role and arm, and for a
 * treatment its declared first look (its exposure), fixed before the run starts.
 */
export function lookSidecar(plan, n, { role, arm, firstLook = null, runId, live, out, argv = [] }) {
  if (role !== 'control' && role !== 'treatment') throw new Error('look: --role must be control or treatment');
  if (!arm || typeof arm !== 'string') throw new Error('look: --arm NAME is required (the arm this run measures)');
  if (role === 'treatment') {
    const s = scheduleOf(plan, firstLook);
    if (n < s.firstLook) throw new Error(`look ${n} precedes the arm's declared first look ${firstLook}`);
  } else if (firstLook !== null) throw new Error('look: --first-look belongs to a treatment arm (a control serves every schedule)');
  const tasks = lookTasks(plan, n);
  return {
    schema: SIDECAR_SCHEMA, design: 'PREREG-AB-v1-AMEND-1 group-sequential (A4)', planStatus: plan.status, plan: plan.planSha256, look: n, looks: plan.looks.length,
    tasks, tasksSha256: listSha256(tasks), role, arm, ...(role === 'treatment' ? { firstLook } : {}),
    nominal: Object.fromEntries(plan.schedules.filter(s => s.looks.includes(n) && (role === 'control' || s.firstLook === firstLook)).map(s => [`from look ${s.firstLook}`, { strict: s.nominal.strict[s.looks.indexOf(n)], partialCredit: s.nominal.partialCredit[s.looks.indexOf(n)] }])),
    alphaPerMetric: plan.alpha.perMetric, runId, live, out, runArgs: argv,
    runnerSha256: sha256(readFileSync(RUNNER)), sequentialSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  };
}
const SIDECAR_KEYS = ['schema', 'plan', 'look', 'tasksSha256', 'role', 'arm', 'firstLook', 'runId'];
/**
 * Plans one look run: checks the passthrough run.mjs options (no task selection, no --no-copy/--dry-run/--test-run; a
 * --run-id is required), the look's tasks (never devCheck, dev only, the plan's list), and returns the run.mjs argv and
 * the sidecar. With exec, also refuses a DRAFT plan, writes the sidecar into the live directory and the repo copy (a
 * resumed run must carry the same one) and spawns run.mjs; after it exits, the repo copy's tasks must be the look's.
 */
export function execLook(plan, n, { role, arm, firstLook = null, passthrough = [], exec = false, spawn = spawnSync, workRoot = path.dirname(LIVE_ROOT), now = () => new Date().toISOString() }) {
  for (const k of REFUSED_RUN_OPTIONS) if (passthrough.includes(k)) throw new Error(`look: ${k} may not be passed; the look's task list comes from the plan and the repo copy is what analyze reads`);
  const runId = flagValue(passthrough, '--run-id');
  if (!runId) throw new Error('look: pass --run-id ID after -- (the sidecar and the analysis name the run)');
  const live = flagValue(passthrough, '--live') ?? path.join(workRoot, 'autobench', runId);
  const out = flagValue(passthrough, '--out') ?? path.join(REPO, RUNS_REL, runId);
  const sidecar = lookSidecar(plan, n, { role, arm, firstLook, runId, live, out, argv: passthrough });
  const args = [RUNNER, '--tasks', sidecar.tasks.join(','), ...passthrough];
  if (!exec) return { sidecar, args, live, out };
  if (plan.draft) throw new Error('look --exec: the plan is a DRAFT (FROZEN_PLAN_SHA256 is not pinned); no paid look runs before PREREG-AB-v1-AMEND-1 is frozen');
  for (const dir of [live, out]) {
    const f = path.join(dir, SIDECAR);
    if (existsSync(f)) {
      const prev = JSON.parse(readFileSync(f, 'utf8'));
      const diff = SIDECAR_KEYS.filter(k => JSON.stringify(prev[k] ?? null) !== JSON.stringify(sidecar[k] ?? null));
      if (diff.length) throw new Error(`look: ${f} belongs to another look run (${diff.join(', ')} differ); use a new --run-id`);
    } else { mkdirSync(dir, { recursive: true }); writeFileSync(f, JSON.stringify({ ...sidecar, writtenAt: now() }, null, 1) + '\n'); }
  }
  const r = spawn(process.execPath, args, { cwd: REPO, stdio: 'inherit' });
  const summary = path.join(out, 'summary.json');
  if (existsSync(summary)) {
    const s = JSON.parse(readFileSync(summary, 'utf8'));
    if (listSha256(s.tasks ?? []) !== sidecar.tasksSha256) throw new Error(`look: ${summary} holds tasks other than look ${n}'s`);
  }
  return { sidecar, args, live, out, status: r?.status ?? 1 };
}

// ------------------------------------------------------------------------------------------------ outcomes
/**
 * Outcomes by task from repo run directories (results.jsonl; sealed files are refused). Later directories override. A row
 * with a fault flag is not an outcome (the look stays incomplete until it is re-run). A row without a final grade and
 * without a fault flag never completed: it scores 0 and is listed (PREREG-AB-v1 §6.3), as outcome.neverGraded.
 */
export function loadOutcomes(dirs, { runsRoot = RUNS } = {}) {
  const out = new Map();
  for (const d of dirs) {
    const dir = path.isAbsolute(d) ? d : path.join(runsRoot, d);
    if (existsSync(path.join(dir, 'results.sealed.jsonl')) && !existsSync(path.join(dir, 'results.jsonl'))) throw new Error(`${d}: a sealed run (devCheck or test); never part of a sequential look`);
    for (const l of readFileSync(path.join(dir, 'results.jsonl'), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      const r = JSON.parse(l);
      if (r.forks?.some(f => f.skipped || f.deferred || f.sessionError || f.harnessError)) continue;   // not an outcome
      out.set(r.task, r.final ? { pass: r.final.task_completed_correctly, pc: r.final.partial_credit } : { pass: 0, pc: 0, neverGraded: true });
    }
  }
  return out;
}

/**
 * The runs named for one arm at one look, checked before their rows are read: each holds only the look's tasks and, unless
 * it is a stored dev60 control row set on look 1 (pre-plan A0 rows: their selection is dev60 or a subset of it), carries
 * a sidecar for this plan, look, task list and role; a treatment's sidecars carry the analysis' first look and one arm
 * name. With illustration, missing sidecars are allowed and the result is labelled. Returns { outcomes, sources, arm }.
 */
export function verifyLookRuns(plan, n, dirs, { role, firstLook = null, illustration = false, runsRoot = RUNS }) {
  const tasks = new Set(lookTasks(plan, n)), sources = [];
  let arm = null;
  for (const d of dirs) {
    const dir = path.isAbsolute(d) ? d : path.join(runsRoot, d);
    const s = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
    const extra = (s.tasks ?? []).filter(t => !tasks.has(t));
    if (extra.length) throw new Error(`${d}: holds ${extra.length} task(s) outside look ${n}`);
    const sc = path.join(dir, SIDECAR);
    if (existsSync(sc)) {
      const c = JSON.parse(readFileSync(sc, 'utf8'));
      const bad = [c.schema !== SIDECAR_SCHEMA && 'schema', c.plan !== plan.planSha256 && 'plan', c.look !== n && 'look', c.tasksSha256 !== plan.looks[n - 1].sha256 && 'task list', c.role !== role && 'role',
        role === 'treatment' && c.firstLook !== firstLook && `first look (declared ${c.firstLook}, analysed ${firstLook})`, arm !== null && c.arm !== arm && 'arm'].filter(Boolean);
      if (bad.length) throw new Error(`${d}: its ${SIDECAR} does not match (${bad.join(', ')})`);
      if (listSha256(s.tasks ?? []) !== c.tasksSha256) throw new Error(`${d}: its summary's tasks are not look ${n}'s`);
      arm = c.arm; sources.push({ run: d, source: 'sequential look run' });
    } else if (role === 'control' && n === 1) {
      // Pre-plan control rows on look 1: an A0 model run (no harness, not scripted) on dev60 tasks only.
      if (s.harness || s.scripted !== false || !s.model) throw new Error(`${d}: look 1's pre-plan control must be a stored A0 model run (no harness, not scripted)`);
      sources.push({ run: d, source: 'stored dev60 A0 rows (pre-plan control)' });
    } else if (illustration) {
      sources.push({ run: d, source: 'ILLUSTRATION: no sequential-look sidecar' });
    } else {
      throw new Error(`${d}: no ${SIDECAR}: look ${n} ${role} rows must come from \`sequential.mjs look ${n} --exec\`${n === 1 && role === 'treatment' ? ' (stored dev60 treatment rows are in-sample: the arm was developed on dev60; analyse from look 2, or pass --illustration)' : ''}`);
    }
  }
  return { outcomes: loadOutcomes(dirs, { runsRoot }), sources, arm };
}

// ------------------------------------------------------------------------------------------------ analyze
/**
 * Cumulative co-primary statistics from the arm's first look on, in order; stops at the first decision. control and
 * treatment: { [look]: Map(task -> { pass, pc, neverGraded? }) }. firstLook (required) picks the schedule. stopOn:
 * 'either' (the DRAFT rule: the first decisive crossing of either metric ends the comparison) or 'strict' (owner
 * alternative: a partial-credit effect is recorded and the comparison continues until strict pass decides, harm is
 * crossed, or the last look).
 */
export function analyzeLooks(plan, control, treatment, { firstLook, permIterations = 100000, stopOn = 'either' } = {}) {
  const sched = scheduleOf(plan, firstLook);
  if (stopOn !== 'either' && stopOn !== 'strict') throw new Error(`stopOn must be either or strict, got ${stopOn}`);
  const rows = [], x = [], y = [];   // cumulative: treatment, control
  let decided = null, pcEffect = null;
  for (const [idx, n] of sched.looks.entries()) {
    const L = plan.looks[n - 1], C = control[n], T = treatment[n];
    if (!C || !T) break;
    const missing = L.tasks.filter(t => !C.has(t) || !T.has(t));
    if (missing.length) { rows.push({ look: n, status: 'incomplete', missing: missing.length }); break; }
    const neverGraded = { treatment: L.tasks.filter(t => T.get(t).neverGraded), control: L.tasks.filter(t => C.get(t).neverGraded) };
    for (const t of L.tasks) { x.push(T.get(t)); y.push(C.get(t)); }
    const b = x.filter((o, i) => o.pass && !y[i].pass).length, c = x.filter((o, i) => !o.pass && y[i].pass).length;
    const strict = mcnemarExactCounts(b, c);
    const pc = pairedPermutation(x.map(o => o.pc), y.map(o => o.pc), { iterations: permIterations, seed: `ab-seq-look${n}` });
    const nom = { strict: sched.nominal.strict[idx], partialCredit: sched.nominal.partialCredit[idx] };
    const crossed = { strict: strict.p < nom.strict, partialCredit: pc.p < nom.partialCredit };
    const dir = { strict: Math.sign(b - c), partialCredit: Math.sign(pc.meanDiff) };
    const passT = x.filter(o => o.pass).length, passC = y.filter(o => o.pass).length, cn = x.length;
    const row = {
      look: n, n: cn, status: 'complete', nominal: nom, crossed, neverGraded,
      strict: { treatment: passT, control: passC, b, c, p: strict.p, diff: (passT - passC) / cn, wilsonT: wilson(passT, cn), wilsonC: wilson(passC, cn),
        bayes: pairedBayesInterval(x.map(o => o.pass), y.map(o => o.pass), { seed: `ab-seq-strict-${n}` }), eValue: mixtureEvalue(b, c) },
      partialCredit: { meanDiff: pc.meanDiff, p: pc.p, method: pc.method, bayes: pairedBayesInterval(x.map(o => o.pc), y.map(o => o.pc), { seed: `ab-seq-pc-${n}` }) },
    };
    // ROADMAP §4.3 floor: a crossing decides only with a gap of at least 3 points (strict) or 0.03 (mean partial credit).
    const floor = { strict: Math.abs(row.strict.diff) >= FLOOR, partialCredit: Math.abs(pc.meanDiff) >= FLOOR };
    row.decisive = { strict: crossed.strict && floor.strict, partialCredit: crossed.partialCredit && floor.partialCredit };
    rows.push(row);
    const which = Object.keys(row.decisive).filter(k => row.decisive[k]);
    if (!which.length) continue;
    const harm = which.some(k => dir[k] < 0), strictClaim = row.decisive.strict && dir.strict > 0;
    if (stopOn === 'strict' && !harm && !row.decisive.strict) { pcEffect ??= n; row.note = `partial-credit effect recorded at look ${n}; continuing for strict pass (stopOn strict)`; continue; }
    decided = { look: n, label: `${harm ? 'harm' : 'effect'} at look ${n} (${which.join(' and ')})${!harm && !strictClaim ? '; strict pass not resolved' : ''}${pcEffect && pcEffect !== n ? `; partial-credit effect first at look ${pcEffect}` : ''}`, strictClaim };
    break;
  }
  const last = rows.filter(r => r.status === 'complete').at(-1), lastLook = sched.looks.at(-1);
  const decision = decided ?? (last && last.look === lastLook
    ? { look: last.look, label: pcEffect ? `final look: effect on partial credit (look ${pcEffect}); strict pass not resolved` : 'final look: no resolvable difference', strictClaim: false }
    : { look: last?.look ?? 0, label: last ? `continue: run look ${last.look + 1}` : `no complete look (the schedule starts at look ${sched.firstLook})`, strictClaim: false });
  return { plan: plan.planSha256, draft: Boolean(plan.draft), firstLook: sched.firstLook, schedule: sched.cumulative, stopOn, rows, decision };
}

// ------------------------------------------------------------------------------------------------ simulate (T2)
/** Per-task outcome population from stored dev60 runs: { task: [{ pass, pc }, …] } (A0 and A1, original and date note). */
export function storedPopulation(groups = [['a0-dev60'], ['a0-dev60-dn'], ['a1-dev60'], ['a1-dev60-dn', 'a1-dev60-dn-fill']]) {
  const maps = groups.map(g => loadOutcomes(g));
  const tasks = [...maps[0].keys()].filter(t => maps.every(m => m.has(t))).sort();
  return tasks.map(t => maps.map(m => m.get(t)));
}

/**
 * Two-sided sign-flip permutation p with Besag-Clifford sequential stopping: draw random sign vectors until `h`
 * exceedances (p = h/draws) or `max` draws (p = (hits + 1)/(max + 1)). A valid p-value for the same permutation null as
 * pairedPermutation; used where the simulation needs the analysis' test at thousands of repetitions.
 */
export function signFlipPSequential(d, r, { h = 20, max = 20000 } = {}) {
  const nz = d.filter(v => v !== 0), obs = Math.abs(nz.reduce((s, v) => s + v, 0));
  if (!nz.length) return 1;
  const tol = 1e-9 * Math.max(1, nz.reduce((s, v) => s + Math.abs(v), 0));
  let hits = 0;
  for (let b = 1; b <= max; b++) {
    let s = 0;
    for (const v of nz) s += r.next() < 0.5 ? v : -v;
    if (Math.abs(s) >= obs - tol && ++hits >= h) return h / b;
  }
  return (hits + 1) / (max + 1);
}

/**
 * Type-I error (two-sided, both directions) of the co-primary schedule under H0: both arms draw each task's outcome from
 * the same pooled stored outcomes (an A/A comparison), tasks resampled from the stored population. Strict uses the exact
 * McNemar. Partial credit uses pcTest: 'normal' (the sign-flip test's large-sample form, fast) or 'permutation' (the
 * analysis' sign-flip permutation, Besag-Clifford stopped). The family-wise event (either metric crosses at some look) is
 * the same under stopOn either or strict. Also reports each metric alone at the full 0.05 schedule.
 */
export function simulateSchedule({ cumulative, reps = 20000, seed = 'ab-seq-sim', population = storedPopulation(), alternative = null, pcTest = 'normal' } = {}) {
  const r = rng(seed, cumulative.join(','), reps, alternative ? 'h1' : 'h0', pcTest);
  const half = boundariesFor(cumulative), full = obrienFlemingBoundary(cumulative.length, { alpha: ALPHA_TOTAL, fractions: cumulative });
  const draw = (arr) => arr[Math.floor(r.next() * arr.length)];
  const pcP = (x, y) => (pcTest === 'permutation' ? signFlipPSequential(x.map((o, i) => o.pc - y[i].pc), r) : twoSidedP(pairedSignFlipZ(x.map(o => o.pc), y.map(o => o.pc))));
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
      const ps = mcnemarExactCounts(b, c).p, pp = pcP(x, y);
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
  return { cumulative, reps, pcTest, hypothesis: alternative ? 'H1' : 'H0', combined: f(combined), strictAtHalfAlpha: f(strictOnly), partialCreditAtHalfAlpha: f(pcOnly),
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
const intArg = (v, what) => { const n = Number(v); if (!Number.isInteger(n)) throw new Error(`${what} must be an integer`); return n; };

async function main(argv) {
  const a = parseArgs(argv);
  const cmd = a._[0];
  if (cmd === 'plan') {
    const split = checkedSplit();
    const exposure = JSON.parse(readFileSync(EXPOSURE, 'utf8'));
    const roots = exposureRoots({ liveRoot: a['live-root'] === 'none' ? null : a['live-root'] ?? LIVE_ROOT });
    const seen = seenTasks(roots);
    const plan = computePlan({ split, exposure: { briefed: exposure.dev.exposedNotForced, seen, roots: seen.scanned }, batch: Number(a.batch ?? 60), minLook: Number(a['min-look'] ?? 20), freeze: Boolean(a.freeze) });
    if (a.write) writeFileSync(a.write, JSON.stringify(plan, null, 1) + '\n');
    if (a.json) { console.log(JSON.stringify(plan, null, 1)); return; }
    console.log(`plan ${plan.planSha256} (${plan.status})${a.freeze ? ': pin this hash in FROZEN_PLAN_SHA256' : ''}`);
    console.log(`devTrain ${plan.pool.devTrain}; excluded ${JSON.stringify(plan.pool.excluded)}; eligible ${plan.pool.eligible}; unused remainder ${plan.pool.unused.length}`);
    console.log(`exposure roots scanned: ${plan.pool.roots.map(r => `${r.label} (${r.missing ? 'missing' : `${r.runs} runs`})`).join('; ')}`);
    for (const L of plan.looks) console.log(`look ${L.look}: ${L.n} tasks (${Object.values(L.perDomain).join('/')} by domain)`);
    for (const s of plan.schedules) console.log(`from look ${s.firstLook}: cumulative ${s.cumulative.join('/')}, nominal per metric ${s.nominal.strict.map(v => v.toPrecision(3)).join(' / ')}`);
    if (a.write) console.log(`wrote ${a.write}`);
    return;
  }
  if (cmd === 'look') {
    const n = intArg(a._[1], 'look N');
    const plan = readPlan(a.plan);
    const r = execLook(plan, n, { role: a.role, arm: a.arm, firstLook: a['first-look'] === undefined ? null : intArg(a['first-look'], '--first-look'), passthrough: a.passthrough, exec: Boolean(a.exec) });
    const nom = Object.entries(r.sidecar.nominal).map(([k, v]) => `${k}: strict ${v.strict.toPrecision(3)}, partial credit ${v.partialCredit.toPrecision(3)}`).join('; ');
    console.log(`look ${n} (${plan.status}): ${r.sidecar.tasks.length} tasks, ${r.sidecar.role} ${r.sidecar.arm}; nominal ${nom}; sidecar ${path.join(r.live, SIDECAR)} and ${path.join(r.out, SIDECAR)}`);
    console.log(`node ${r.args.map(x => path.relative(REPO, x) === 'experiments/autobench/run.mjs' ? 'experiments/autobench/run.mjs' : x).join(' ')}`);
    if (a.exec) process.exitCode = r.status;
    else console.log('(not started: add --exec on a frozen plan; a run launched any other way has no sidecar and analyze refuses it)');
    return;
  }
  if (cmd === 'analyze') {
    const plan = readPlan(a.plan);
    const firstLook = intArg(a['first-look'], '--first-look (the arm\'s declared exposure: 2 for every arm with stored dev60 rows)');
    const illustration = Boolean(a.illustration);
    const side = (specs, role) => {
      const outcomes = {}, sources = [];
      for (const s of specs) {
        const [n, dirs] = s.split(':'), look = intArg(n, '--control/--treatment look');
        const v = verifyLookRuns(plan, look, dirs.split(',').filter(Boolean), { role, firstLook, illustration });
        outcomes[look] = v.outcomes; sources.push(...v.sources.map(x => ({ look, ...x })));
      }
      return { outcomes, sources };
    };
    const C = side(a.control, 'control'), T = side(a.treatment, 'treatment');
    const res = analyzeLooks(plan, C.outcomes, T.outcomes, { firstLook, stopOn: a['stop-on'] ?? 'either' });
    res.sources = { control: C.sources, treatment: T.sources };
    res.illustration = illustration;
    if (a.json) { console.log(JSON.stringify(res, null, 1)); return; }
    const tag = `${illustration ? 'ILLUSTRATION, not a sequential look; ' : ''}${plan.draft ? 'DRAFT plan; ' : ''}`;
    console.log(`${tag}from look ${res.firstLook} (cumulative ${res.schedule.join('/')}), stop on ${res.stopOn}`);
    for (const r of res.rows) {
      if (r.status !== 'complete') { console.log(`look ${r.look}: ${r.status} (${r.missing} task(s) without an outcome in an arm)`); continue; }
      console.log(`look ${r.look} (n ${r.n}): strict ${r.strict.treatment} vs ${r.strict.control}, ${r.strict.b}:${r.strict.c}, McNemar p ${r.strict.p.toFixed(4)} vs ${r.nominal.strict.toPrecision(3)}${r.crossed.strict ? ' CROSSED' : ''}; `
        + `partial credit ${r.partialCredit.meanDiff.toFixed(3)} p ${r.partialCredit.p.toFixed(4)} vs ${r.nominal.partialCredit.toPrecision(3)}${r.crossed.partialCredit ? ' CROSSED' : ''}; e-value ${r.strict.eValue.toFixed(2)}; `
        + `Bayes strict [${r.strict.bayes.lo.toFixed(3)}, ${r.strict.bayes.hi.toFixed(3)}], partial credit [${r.partialCredit.bayes.lo.toFixed(3)}, ${r.partialCredit.bayes.hi.toFixed(3)}]`);
      for (const k of ['treatment', 'control']) if (r.neverGraded[k].length) console.log(`  ${k}: ${r.neverGraded[k].length} task-run(s) never completed, scored 0 (PREREG-AB-v1 §6.3): ${r.neverGraded[k].join(', ')}`);
      if (r.note) console.log(`  ${r.note}`);
    }
    console.log(`decision: ${tag}${res.decision.label}${res.decision.strictClaim ? ' (a strict-pass claim is allowed)' : ''}`);
    return;
  }
  if (cmd === 'simulate') {
    const cumulative = a.plan ? scheduleOf(readPlan(a.plan), intArg(a['first-look'], '--first-look')).cumulative : (a.cumulative ? String(a.cumulative).split(',').map(Number) : [60, 120, 180, 240]);
    // --h1: treatment outcomes from the stored A1 runs, control from the stored A0 runs (the in-sample dev60 effect, so the
    // power it prints is optimistic for the next, out-of-sample improvement).
    // --h1-scale s: the treatment draws from A1's outcomes with probability s and from A0's otherwise (s times the effect).
    const s = Number(a['h1-scale'] ?? 1), pick = rng('h1-scale', s);
    const alternative = a.h1 ? { treatment: outs => (pick.next() < s ? outs.slice(2) : outs.slice(0, 2)), control: outs => outs.slice(0, 2) } : null;
    const r = simulateSchedule({ cumulative, reps: Number(a.reps ?? 20000), alternative, pcTest: a['pc-test'] ?? 'normal' });
    if (a.json) { console.log(JSON.stringify(r, null, 1)); return; }
    console.log(`${a.h1 ? 'H1 (A1 vs A0, stored dev60 outcomes; in-sample, optimistic)' : 'H0 (A/A from stored dev60 outcomes)'}, looks at ${cumulative.join('/')}, partial credit by ${r.pcTest}, ${r.reps} reps: co-primary rule ${r.combined.toFixed(4)} (mean tasks ${r.meanTasks.toFixed(1)}); strict alone at 0.025 ${r.strictAtHalfAlpha.toFixed(4)}, at 0.05 ${r.strictAtFullAlpha.toFixed(4)}; partial credit alone at 0.025 ${r.partialCreditAtHalfAlpha.toFixed(4)}, at 0.05 ${r.partialCreditAtFullAlpha.toFixed(4)} (MC SE at 0.05: ${r.mcSE.toFixed(4)})`);
    return;
  }
  throw new Error('usage: sequential.mjs plan|look|analyze|simulate …');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
}
