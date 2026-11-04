// Archived JIT streams as tier-down material (A10 / #42): the compiled answers, their journals, solvers and tasks, with
// a hard development-only guard. Everything here is read-only and $0.
//
// Material: <runs>/<experiment>/<jit arm>/{arm.json, results.jsonl, journal.jsonl, solvers/<version>/solve.mjs}, as
// stream.mjs exports it (research/jit-20261008/runs). A compiled answer is a results row with compiledStatus 'ok' and a
// version in force (eval-invariance.mjs compiledRowsOf). Its judge answers are the journal rows whose runId starts with
// `${experiment}:${armSlug}:${idx}:v${version}:` (eval-invariance.mjs journalPrefixOf).
//
// Guard (AGENTS.md, task brief): only dev material. An arm whose split is not 'dev', a row whose seed is >= 7001
// (FIRST_TEST_SEED, tierdown-e2e.mjs), or any path under beds/sealed or naming devCheck is refused before it is read.
import path from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { compiledRowsOf, journalPrefixOf } from '../jit/eval-invariance.mjs';
import { flowFileOf } from '../jit/prompts.mjs';
import { DEFAULT_FLOW, FLOW_V2, FLOW_V3 } from '../jit/run-compiled.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_RUNS = path.join(REPO, 'research/jit-20261008/runs');
export const DEFAULT_EXPERIMENTS = Object.freeze(['jit-dev-records-1', 'jit-dev-kinetics-1', 'jit-r0-records', 'jit-r0-kinetics']);
export const FIRST_TEST_SEED = 7001;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const JIT = path.join(HERE, '../jit');

export class ArchiveError extends Error { constructor(code, message) { super(`${code}: ${message}`); this.code = code; } }
const FORBIDDEN = [/(^|\/)beds\/sealed(\/|$)/, /devcheck/i, /(^|\/)sealed(\/|$)/];
export function assertDevPath(p) {
  const s = path.resolve(String(p));
  if (FORBIDDEN.some(re => re.test(s))) throw new ArchiveError('SEALED_PATH', `refusing to read ${s}: sealed or devCheck material is never tier-down input`);
  return s;
}
export function assertDevRow(row, arm = null) {
  if (arm && arm.split !== 'dev') throw new ArchiveError('NOT_DEV', `arm ${arm.experiment}/${arm.slug} has split ${arm.split}`);
  const m = /^(.+):([a-z]+):d(\d+):s(\d+)$/.exec(row?.taskKey ?? '');
  if (!m) throw new ArchiveError('BAD_TASK_KEY', `row ${row?.idx}: task key ${row?.taskKey}`);
  if (m[2] !== 'dev') throw new ArchiveError('NOT_DEV', `row ${row.idx}: split ${m[2]}`);
  if (Number(m[4]) >= FIRST_TEST_SEED) throw new ArchiveError('TEST_SEED', `row ${row.idx}: seed ${m[4]} is in the test range`);
  return { family: m[1], split: m[2], difficulty: Number(m[3]), seed: Number(m[4]) };
}

export const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
export const sha256 = s => createHash('sha256').update(s).digest('hex');

// The flow SDK an arm's solvers were written for (prompts.mjs FLOW_FILES), and the hooked flow the harness replays them
// under: version-1 solvers have no override hook, so they replay under flow-v2 (same judge/request API; the fidelity gate
// checks that every archived answer still comes out the same).
export function flowsOf(promptVersion) {
  const original = promptVersion >= 2 ? path.join(JIT, flowFileOf({ promptVersion })) : DEFAULT_FLOW;
  return { original, hooked: original === DEFAULT_FLOW ? FLOW_V2 : original, v3: FLOW_V3 };
}

// Every JIT arm of the listed experiments, with its compiled answers.
export function listArms({ runs = DEFAULT_RUNS, experiments = DEFAULT_EXPERIMENTS } = {}) {
  assertDevPath(runs);
  const out = [];
  for (const experiment of experiments) {
    const expDir = assertDevPath(path.join(runs, experiment));
    if (!existsSync(expDir)) continue;
    for (const d of readdirSync(expDir, { withFileTypes: true })) {
      if (!d.isDirectory() || !d.name.startsWith('jit-')) continue;
      const armDir = path.join(expDir, d.name), armJson = JSON.parse(readFileSync(path.join(armDir, 'arm.json'), 'utf8'));
      const pv = armJson.def?.compile?.promptVersion ?? 1;
      const arm = { experiment, slug: d.name, dir: armDir, family: armJson.def?.familyId, split: armJson.def?.split, promptVersion: pv, flows: flowsOf(pv), spec: armJson.spec };
      if (arm.split !== 'dev') continue;   // never read a non-dev arm's rows
      arm.rows = compiledRowsOf(readJsonl(path.join(armDir, 'results.jsonl'))).filter(r => { assertDevRow(r, arm); return true; });
      out.push(arm);
    }
  }
  return out.sort((a, b) => `${a.experiment}/${a.slug}`.localeCompare(`${b.experiment}/${b.slug}`));
}

const journals = new Map();
export function journalOf(arm) {
  if (!journals.has(arm.dir)) journals.set(arm.dir, readJsonl(path.join(arm.dir, 'journal.jsonl')));
  return journals.get(arm.dir);
}
export const rowJournal = (arm, row) => journalOf(arm).filter(j => typeof j.runId === 'string' && j.runId.startsWith(journalPrefixOf(row)));
export function solverOf(arm, row) {
  const ver = row.stateAfter.version.dir.replace(/^versions\//, '');
  return [path.join(arm.dir, 'solvers', ver, 'solve.mjs'), path.join(arm.dir, 'versions', ver, 'solve.mjs')].find(existsSync) ?? null;
}
export const versionOf = row => row.stateAfter.version.dir.replace(/^versions\//, '');
export const rowId = (arm, row) => `${arm.experiment}/${arm.slug}#${row.idx}`;

// The phase a journal row was spent in: 'compile' (builder test runs), 'check' (the host's jit-check runs), 'delivery'
// (a compiled run of a stream task: delivered, shadowed or adjudicated), or 'other' (interpreter and agent calls).
export function phaseOf(runId) {
  if (/^compile:/.test(runId)) return 'compile';
  if (/^jit-check:/.test(runId)) return 'check';
  if (/^[^:]+:jit-[^:]+:\d+:v\d+:/.test(runId)) return 'delivery';
  return 'other';
}
