#!/usr/bin/env node
// The held-out task list of the A1-C v2 evaluation (P1): look 2 of the FROZEN group-sequential plan of
// PREREG-AB-v1-AMEND-1 (SEQUENTIAL-PLAN-v1.json, plan sha256 pinned in sequential.mjs FROZEN_PLAN_SHA256 = 3cd586bd…;
// decisions D23 and D25). DEVELOPER TOOL, $0, task NAMES only: it never opens a task's content, a grade or a sealed
// record, and it refuses any devCheck or test task.
//
// Checks, each a reason to stop before a paid look-2 run (exit 1):
//   1. the plan file reads as the frozen plan (sequential.mjs readPlan: its own hash, the pinned hash, FROZEN status,
//      look 1 = dev60, never devCheck);
//   2. LOOK2-TASKS.json (the exported look 2) and a1c-v2/HELDOUT-LOOK2.json (A1-C v2's adopted copy) hold exactly the
//      plan's look 2, list sha256 a8c1ed5c…;
//   3. no look-2 task appears in any run outside this plan's own look-2 runs, over EVERY exposure root sequential.mjs
//      scans (the main tree's runs, every worktree's runs, every git worktree, the live root): summary.json, launch.json
//      and sequential-look.json `tasks` lists, and the task-named directories under prep/, w/ and host/. Exempt are
//      (a) runs whose sequential-look.json names this frozen plan, look 2 and look 2's list hash (the look runs
//      themselves), and (b) the runs a decision names (REFERENCE_RUNS: D26's Opus 5.5 xhigh arm, D27's Sonnet + A1 fork
//      of VL-1), each only when its launch.json (live) or summary.json (repo copy) matches the decision (model, harness
//      or none, tasks inside look 2);
//   4. the rule re-implemented here (AMEND-1 §2.2) re-derives look 2 from the same inputs, with the exempt runs set
//      aside: devTrain (SPLIT-v1 dev minus devCheck) minus the forced set, the AM-2 briefed tasks, look 1 (runs/a0-dev60:
//      dev60, subset 60, seed 21) and every task another recorded run names; per domain ascending
//      sha256('ab-seq-v1:' + task); the first 10 per domain.
// A `tasks` field that is not a list (a count, as an older P0 summary wrote) names no task and is ignored (re-review
// 2026-10-21, M-1); a file that does not parse is re-read twice (a run may be writing it) and then stops the check.
//   node experiments/autobench/replay/heldout-look2.mjs [--plan FILE] [--root DIR ...] [--write FILE]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PUBLIC_DOMAINS, REPO, sha256 } from '../lib.mjs';
import { assertDevOnly, domainOf, listSha256, loadSplit } from '../split.mjs';

export const SALT = 'ab-seq-v1:';
export const PER_DOMAIN = 10;
export const LOOK = 2;
export const LOOK1_RUN = 'a0-dev60';
export const LOOK2_SHA256 = 'a8c1ed5c8b18606c97feb7fcdd83115eab8cbdffa6e7956d9ee6d9d0974e916f';
export const PLAN = path.join(REPO, 'research/automationbench-20261014/SEQUENTIAL-PLAN-v1.json');
export const LOOK2_FILE = path.join(REPO, 'research/automationbench-20261014/LOOK2-TASKS.json');
export const ADOPTED = path.join(REPO, 'research/automationbench-20261014/a1c-v2/HELDOUT-LOOK2.json');
export const SIDECAR = 'sequential-look.json';
/** Reference runs on look 2 that a decision names (not part of any comparison of this plan), with what their launch must
 * show for the exemption to hold. */
export const REFERENCE_RUNS = Object.freeze({
  'a0o-look2-1': { decision: 'D26 (research/decisions-20261021.md): Opus 5.5 xhigh alone on the 60 look-2 tasks, a reference arm beside A1-C v2 look 2, launched by the orchestrator; not part of the confirmatory test', model: 'claude-opus-5-5', harness: false },
  'a1s-look2': { decision: 'D27 (research/decisions-20261021.md): Sonnet 5.5 + A1 on the look-2 tasks, a fork of the exploratory VL-1 arm; not part of the confirmatory test', model: 'claude-sonnet-5-5', harness: 'any' },
});
const TASK_NAME = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const TASK_DIRS = ['prep', 'w', 'host'];

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** A JSON file, re-read twice 2 s apart when it does not parse (a running run may be writing it); null when absent. */
export function readJsonRetry(f, { tries = 3, waitMs = 2000 } = {}) {
  if (!existsSync(f)) return null;
  for (let i = 0; ; i++) {
    try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) {
      if (i + 1 >= tries) throw new Error(`heldout-look2: ${f} does not parse (${e.message}); the exposure record cannot be trusted`);
      sleep(waitMs);
    }
  }
}
/** Task names a file's `tasks` field lists; anything other than a list of strings names none. */
export const taskList = j => (Array.isArray(j?.tasks) ? j.tasks.filter(t => typeof t === 'string') : []);

/**
 * Exposure under the roots (directories or { label, dir }): Map(task -> Set of "label/run") over the runs that are not
 * exempt, and the exempt runs with their reason. `exempt(runDir, files)` -> reason string or null.
 */
export function seenTasks(roots, { exempt = () => null, read = readJsonRetry } = {}) {
  const seen = new Map(), exempted = [], scanned = [];
  const add = (t, where) => { if (!seen.has(t)) seen.set(t, new Set()); seen.get(t).add(where); };
  for (const r of roots) {
    const { label, dir } = typeof r === 'string' ? { label: r, dir: r } : r;
    if (!dir || !existsSync(dir)) { scanned.push({ label, runs: 0, missing: true }); continue; }
    let runs = 0;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const runDir = path.join(dir, d.name);
      const files = Object.fromEntries(['summary.json', 'launch.json', SIDECAR].map(f => [f, read(path.join(runDir, f))]));
      const names = [...new Set(Object.values(files).flatMap(taskList))];
      for (const sub of TASK_DIRS) {
        const sd = path.join(runDir, sub);
        if (existsSync(sd)) for (const e of readdirSync(sd, { withFileTypes: true })) if (e.isDirectory() && TASK_NAME.test(e.name)) names.push(e.name);
      }
      if (!names.length && !Object.values(files).some(Boolean)) continue;
      runs += 1;
      const why = exempt(d.name, files, names);
      if (why) { exempted.push({ run: `${label}/${d.name}`, tasks: new Set(names).size, reason: why }); continue; }
      for (const t of names) add(t, `${label}/${d.name}`);
    }
    scanned.push({ label, runs });
  }
  return { seen, exempted, scanned };
}

/** The exemption rule (check 3): this plan's look-2 sidecar runs, and the decision-named reference runs. */
export function look2Exemption({ planSha256, look2Sha256, look2Tasks, reference = REFERENCE_RUNS }) {
  const inLook = names => names.length > 0 && names.every(t => look2Tasks.has(t));
  return (run, files, names) => {
    const sc = files[SIDECAR];
    if (sc) {
      if (sc.plan === planSha256 && sc.look === LOOK && sc.tasksSha256 === look2Sha256 && inLook(names)) return `look-2 run of the frozen plan (sidecar: ${sc.role} ${sc.arm})`;
      return null;
    }
    // A reference run's live directory has launch.json; its repo copy has summary.json (model and harness in both).
    const ref = reference[run], l = files['launch.json'] ?? files['summary.json'];
    if (ref && l && l.model === ref.model && (ref.harness === 'any' || !l.harness) && inLook(names)) return `reference run: ${ref.decision}`;
    return null;
  };
}

/** Look 2 by the AMEND-1 rule. -> { tasks, sha256, pool, excluded, perDomain } */
export function look2({ split = loadSplit(), look1, briefed, seen, perDomain = PER_DOMAIN, domains = PUBLIC_DOMAINS }) {
  const devCheck = new Set(split.devCheck);
  const devTrain = split.dev.filter(t => !devCheck.has(t));
  const forced = new Set(split.forcedSources.flatMap(f => f.tasks));
  const l1 = new Set(look1), br = new Set(briefed);
  const why = t => (forced.has(t) ? 'forced' : br.has(t) ? 'briefed (AM-2)' : l1.has(t) ? 'look 1' : seen.has(t) ? 'run before' : null);
  const excluded = { forced: 0, 'briefed (AM-2)': 0, 'look 1': 0, 'run before': 0 };
  const eligible = [];
  for (const t of devTrain) { const w = why(t); if (w) excluded[w] += 1; else eligible.push(t); }
  const key = t => sha256(SALT + t);
  const tasks = domains.flatMap(d => eligible.filter(t => domainOf(t) === d).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).slice(0, perDomain)).sort();
  if (tasks.some(t => devCheck.has(t))) throw new Error('look 2 holds a devCheck task');
  assertDevOnly(tasks, split);
  return { tasks, sha256: listSha256(tasks), pool: { devTrain: devTrain.length, eligible: eligible.length }, excluded, perDomain: Object.fromEntries(domains.map(d => [d, tasks.filter(t => domainOf(t) === d).length])) };
}

/** Every check; -> { ok, problems, report }. Throws only on unreadable inputs. */
export async function checkLook2({ planFile = PLAN, roots = null, look2File = LOOK2_FILE, adoptedFile = ADOPTED } = {}) {
  const S = await import('../sequential.mjs');
  const problems = [];
  const plan = S.readPlan(planFile);
  if (plan.draft || plan.planSha256 !== S.FROZEN_PLAN_SHA256) problems.push(`plan ${plan.planSha256.slice(0, 16)}… is not the frozen plan`);
  const L = plan.looks.find(x => x.look === LOOK);
  if (L.sha256 !== LOOK2_SHA256 || listSha256(L.tasks) !== LOOK2_SHA256) problems.push(`the plan's look 2 is not list ${LOOK2_SHA256.slice(0, 8)}…`);
  const files = {};
  for (const [k, f] of [['LOOK2-TASKS.json', look2File], ['HELDOUT-LOOK2.json', adoptedFile]]) {
    const text = readFileSync(f, 'utf8'), j = JSON.parse(text);
    files[k] = { file: f, fileSha256: sha256(text), listSha256: listSha256(j.tasks ?? []) };
    if (listSha256(j.tasks ?? []) !== L.sha256 || JSON.stringify([...j.tasks].sort()) !== JSON.stringify([...L.tasks].sort())) problems.push(`${k} does not hold the plan's look 2`);
    if (j.tasksSha256 !== undefined && j.tasksSha256 !== L.sha256) problems.push(`${k} records list sha ${String(j.tasksSha256).slice(0, 8)}…`);
  }
  const split = S.checkedSplit();
  const look2Tasks = new Set(L.tasks);
  const rootList = roots ?? S.exposureRoots();
  const { seen, exempted, scanned } = seenTasks(rootList, { exempt: look2Exemption({ planSha256: plan.planSha256, look2Sha256: L.sha256, look2Tasks }) });
  const exposed = L.tasks.filter(t => seen.has(t)).map(t => ({ task: t, seenIn: [...seen.get(t)] }));
  if (exposed.length) problems.push(`${exposed.length} look-2 task(s) appear in runs outside this plan's look-2 runs`);
  const exposure = JSON.parse(readFileSync(path.join(REPO, 'research/automationbench-20261014/EXPOSURE-20261015.json'), 'utf8'));
  const look1 = S.look1Tasks();
  const R = look2({ split, look1, briefed: exposure.dev.exposedNotForced, seen });
  const same = R.sha256 === L.sha256;
  if (!same) problems.push(`the rule re-derives list ${R.sha256.slice(0, 8)}…, not the plan's look 2`);
  return {
    ok: problems.length === 0, problems,
    report: {
      schema: 'foundry.autobench.a1c-v2-heldout-check/v2', evidence: 'task names only (no task content, grade or sealed record read)',
      plan: { file: planFile, planSha256: plan.planSha256, frozen: !plan.draft, status: plan.status }, look: LOOK, look2Sha256: L.sha256, files,
      rule: `PREREG-AB-v1-AMEND-1 §2.2 look 2: devTrain minus forced, briefed (AM-2), look 1 (${LOOK1_RUN}) and every task another recorded run names; per domain ascending sha256('${SALT}' + task); first ${PER_DOMAIN} per domain`,
      rederived: { sha256: R.sha256, matches: same, pool: R.pool, excluded: R.excluded, perDomain: R.perDomain },
      exposure: { roots: scanned, exempted, exposed: exposed.map(x => ({ task: x.task, seenIn: x.seenIn })) },
    },
  };
}

function args(argv) { const a = { root: [] }; for (let i = 0; i < argv.length; i++) { const k = argv[i].replace(/^--/, ''); if (k === 'root') a.root.push(argv[++i]); else a[k] = argv[++i]; } return a; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args(process.argv.slice(2));
  const r = await checkLook2({ planFile: a.plan ?? PLAN, roots: a.root.length ? a.root : null });
  if (a.write) writeFileSync(a.write, JSON.stringify(r.report, null, 1) + '\n');
  // Exposed tasks are named only by domain and run (task names of look 2 stay off the terminal).
  const out = { ok: r.ok, problems: r.problems, ...r.report, exposure: { ...r.report.exposure, exposed: r.report.exposure.exposed.map(x => ({ domain: domainOf(x.task), seenIn: x.seenIn })) } };
  process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
  if (!r.ok) process.exit(1);
}
