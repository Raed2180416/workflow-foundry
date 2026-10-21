#!/usr/bin/env node
// The held-out task list of the A1-C v2 evaluation (P1): look 2 of the DRAFT group-sequential plan of
// PREREG-AB-v1-AMEND-1 (§2.2, §6: "run A1-C v2's eval as look 2"). DEVELOPER TOOL, $0, task NAMES only: it never opens a
// task's content, a grade or a sealed record, and it refuses any devCheck or test task.
//
// The rule (AMEND-1 §2.2, committed as experiments/autobench/sequential.mjs `computePlan` on branch
// worktree-wf_630f3979-599-4, commit 3562d3ed; DRAFT plan committed at dac4ecdf), re-implemented here so the list can be
// re-derived on this branch:
//   pool  = devTrain (SPLIT-v1 dev minus devCheck)
//           minus the forced set (SPLIT-v1 forcedSources), minus the dev tasks briefed by the families agent
//           (EXPOSURE-20261015.json dev.exposedNotForced, AM-2), minus look 1 (runs/a0-dev60: dev60, subset 60, seed 21),
//           minus every task any recorded run names (summary.json / launch.json `tasks` under the exposure roots);
//   order = per domain, ascending sha256('ab-seq-v1:' + task) (the seed is the salt);
//   look 2 = the first 10 per domain (60 tasks).
//   node experiments/autobench/replay/heldout-look2.mjs [--draft FILE] [--root DIR ...] [--write FILE]
// Exit 1 when the recomputed look 2 differs from the DRAFT plan's look 2 (a collision: some look-2 task was exposed
// after the DRAFT was written, or the inputs changed): the orchestrator decides before P1.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PUBLIC_DOMAINS, REPO, sha256 } from '../lib.mjs';
import { assertDevOnly, domainOf, listSha256, loadSplit } from '../split.mjs';

export const SALT = 'ab-seq-v1:';
export const PER_DOMAIN = 10;
export const LOOK1_RUN = 'a0-dev60';
export const DRAFT = '/home/user/workflow-foundry/.claude/worktrees/wf_630f3979-599-4/research/automationbench-20261014/SEQUENTIAL-PLAN-v1.DRAFT.json';
export const ROOTS = Object.freeze([
  '/home/user/workflow-foundry/research/automationbench-20261014/runs',   // the main tree's recorded runs
  path.join(REPO, 'research/automationbench-20261014/runs'),              // this branch's recorded runs
  '/var/tmp/foundry-work/autobench',                                       // the live root (every run's launch.json)
]);

const readJsonSafe = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
/** Task names of every recorded run under the roots (names only). */
export function seenTasks(roots = ROOTS) {
  const seen = new Map();
  for (const root of new Set(roots)) {
    if (!root || !existsSync(root)) continue;
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const f of ['summary.json', 'launch.json']) {
        const j = readJsonSafe(path.join(root, d.name, f));
        for (const t of j?.tasks ?? []) if (typeof t === 'string') { if (!seen.has(t)) seen.set(t, new Set()); seen.get(t).add(`${root}/${d.name}`); }
      }
    }
  }
  return seen;
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

function args(argv) { const a = { root: [] }; for (let i = 0; i < argv.length; i++) { const k = argv[i].replace(/^--/, ''); if (k === 'root') a.root.push(argv[++i]); else a[k] = argv[++i]; } return a; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args(process.argv.slice(2));
  const split = loadSplit();
  const exposure = JSON.parse(readFileSync(path.join(REPO, 'research/automationbench-20261014/EXPOSURE-20261015.json'), 'utf8'));
  const l1 = readJsonSafe(path.join(REPO, 'research/automationbench-20261014/runs', LOOK1_RUN, 'summary.json'));
  const sel = l1?.selection ?? {};
  if (sel.pool !== 'devTrain' || sel.subset !== 60 || String(sel.seed) !== '21' || l1.tasks?.length !== 60) throw new Error(`${LOOK1_RUN}: not the dev60 selection`);
  const roots = a.root.length ? a.root : ROOTS;
  const seen = seenTasks(roots);
  const L = look2({ split, look1: l1.tasks, briefed: exposure.dev.exposedNotForced, seen });
  const draftFile = a.draft ?? DRAFT;
  const draft = readJsonSafe(draftFile);
  const d2 = draft?.looks?.find(x => x.look === 2) ?? null;
  const same = Boolean(d2) && listSha256(d2.tasks) === L.sha256;
  const out = {
    schema: 'foundry.autobench.a1c-v2-heldout/v1',
    evidence: 'task names only (no task content, grade or sealed record read)',
    rule: `PREREG-AB-v1-AMEND-1 §2.2 look 2: devTrain minus forced, briefed (AM-2), look 1 (${LOOK1_RUN}) and every task a recorded run names; per domain ascending sha256('${SALT}' + task); first ${PER_DOMAIN} per domain`,
    ruleSource: { draftPlan: draftFile, draftPlanSha256: draft?.planSha256 ?? null, draftLook2Sha256: d2?.sha256 ?? null, code: 'experiments/autobench/sequential.mjs computePlan (branch worktree-wf_630f3979-599-4, commits 3562d3ed and dac4ecdf)', reimplementation: 'experiments/autobench/replay/heldout-look2.mjs' },
    salt: SALT, perDomain: PER_DOMAIN, split: { devCheck: split.sha256.devCheck, dev: split.sha256.dev }, exposureRoots: roots,
    pool: L.pool, excluded: L.excluded, matchesDraftLook2: same,
    ...(same || !d2 ? {} : { onlyRecomputed: L.tasks.filter(t => !d2.tasks.includes(t)), onlyDraft: d2.tasks.filter(t => !L.tasks.includes(t)).map(t => ({ task: t, seenIn: [...(seen.get(t) ?? [])] })) }),
    tasks: L.tasks, tasksSha256: L.sha256, perDomainCount: L.perDomain,
  };
  if (a.write) writeFileSync(a.write, JSON.stringify(out, null, 1) + '\n');
  process.stdout.write(`${JSON.stringify({ ...out, tasks: `${out.tasks.length} tasks` }, null, 1)}\n`);
  if (!same) process.exit(1);
}
