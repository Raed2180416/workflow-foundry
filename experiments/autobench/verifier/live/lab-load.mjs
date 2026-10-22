// VL-1 live-lab loader (Node >= 24, ESM, no dependencies). build-live.py copies this file into a built lab as load.mjs
// and fills in ARM_ORDER (the arms in command-line order; the first is the default fork). It is the interface the frozen
// verifiers read a lab through (requirement-ledger-v2/run.mjs and diverse-judges/run.mjs: loadRows, verifierView,
// loadWorlds, ARM_ORDER, opaqueId), ported from the development lab's loader WITHOUT labels: a live lab holds no grade,
// every row's label is null, and nothing here can score.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIR = dirname(fileURLToPath(import.meta.url));
export const DATASET = join(DIR, 'dataset.jsonl');
export const LIVE = true;
export const ARM_ORDER = [];

let cache = null;
function all(path = DATASET) {
  if (cache?.path === path) return cache.rows;
  const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const r of rows) if (r.label !== null) throw new Error(`live lab row ${r.rowId} carries a label: refused`);
  cache = { path, rows };
  return rows;
}

/** Rows, filtered. outcomeOnly drops task-runs the runner does not score (faults, skips); canonicalOnly keeps the one row
 *  per (arm, task) that the arm's score counts (a later run of an arm supersedes an earlier one for its tasks). */
export function loadRows({ path = DATASET, outcomeOnly = true, canonicalOnly = false, arms = null, runs = null, tasks = null, folds = null } = {}) {
  return all(path).filter(r => (!outcomeOnly || r.outcome) && (!canonicalOnly || r.canonical)
    && (!arms || arms.includes(r.arm)) && (!runs || runs.includes(r.run)) && (!tasks || tasks.includes(r.task))
    && (!folds || folds.includes(r.fold)));
}

/** Opaque, stable id for a row that does not reveal run, arm or task. */
export function opaqueId(row) {
  return 'v-' + createHash('sha256').update('vl1-live-v1:' + row.rowId).digest('hex').slice(0, 12);
}

/** What a verifier may see: the request, the world's own date and connected services, the initial-vs-final diff. */
export function verifierView(row, { writes = false, selfCheck = false } = {}) {
  const v = {
    vid: opaqueId(row),
    prompt: { system: row.prompt.system, user: row.prompt.user },
    today: row.today,
    services: row.services,
    diff: structuredClone(row.diff),
  };
  if (writes) v.writes = structuredClone(row.writes);
  if (selfCheck) v.selfCheck = structuredClone(row.selfCheck);
  return v;
}

/** A live lab has no labels. */
export function labelOf() {
  return null;
}
export function passed() {
  throw new Error('a live lab holds no labels: scoring happens in score.mjs after the selection is committed');
}

/** Initial and final world for a row (parsed JSON). */
export function loadWorlds(row) {
  const rd = p => JSON.parse(gunzipSync(readFileSync(join(DIR, p))).toString('utf8'));
  return { initial: rd(row.worlds.initial), final: rd(row.worlds.final) };
}

/** A world without its empty parts (keeps meta). */
export function compactWorld(w) {
  const strip = v => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        const y = strip(x);
        if (y === null || y === '' || (Array.isArray(y) && !y.length) || (y && typeof y === 'object' && !Array.isArray(y) && !Object.keys(y).length)) continue;
        o[k] = y;
      }
      return o;
    }
    return v;
  };
  return strip(w);
}

/** Selection cases: per task, the canonical outcome rows of distinct arms (only tasks with >= minArms arms). */
export function selectionGroups({ rows = loadRows({ canonicalOnly: true }), minArms = 1, arms = null } = {}) {
  const g = new Map();
  for (const r of rows) {
    if (arms && !arms.includes(r.arm)) continue;
    if (!g.has(r.task)) g.set(r.task, []);
    g.get(r.task).push(r);
  }
  for (const [t, rs] of g) if (new Set(rs.map(r => r.arm)).size < minArms) g.delete(t);
  return g;
}
