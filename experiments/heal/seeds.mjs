// Seed ledger (DESIGN §8.1): every seed ever consumed, per family, split and difficulty, and by what. A seed that reached any
// gate is never fresh again. Heal development draws from its own pool; EX1 owns 2001+. Codefix tasks are also deduplicated by the
// hash of their reference solution, because dev and test overlap at d1-d3 (beds/codefix AUDIT F2).
import path from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { REPO } from './kit.mjs';
import { canonical, digest } from './ir.mjs';
import { bedsLib } from './replay.mjs';

export const LEDGER_FILE = path.join(REPO, 'research/heal-20261008/seed-ledger.json');
export const POOLS = Object.freeze({ heal: { records: [1001, 1100], codefix: [1001, 1100] }, ex1: { records: [2001, 2999], codefix: [2001, 2999] } });
// What the repository already consumed (DESIGN §8.1). Ranges are inclusive.
export const INITIAL = Object.freeze([
  { family: 'records', split: 'dev', difficulty: 3, range: [1, 3], by: 'C0 construction probes' },
  { family: 'codefix', split: 'dev', difficulty: 3, range: [1, 3], by: 'C0 construction probes' },
  { family: 'records', split: 'dev', difficulty: 3, range: [101, 160], by: 'records-v3 development (experiments/workflows/records-v3-dev.mjs)' },
  { family: 'records', split: 'dev', difficulty: 4, range: [101, 160], by: 'records-v3 development' },
  { family: 'records', split: 'test', difficulty: 3, range: [6001, 6004], by: 'C0 test (INSPECTED)' },
  { family: 'codefix', split: 'test', difficulty: 3, range: [6001, 6004], by: 'C0 test (INSPECTED)' },
  { family: 'records', split: 'test', difficulty: 3, range: [5001, 5006], by: 'P1 test (INSPECTED)' },
  { family: 'records', split: 'test', difficulty: 4, range: [5001, 5006], by: 'P1 test (INSPECTED)' },
]);

export function loadLedger(file = LEDGER_FILE) {
  if (!existsSync(file)) return { schema: 'heal-seed-ledger/1', entries: structuredClone(INITIAL), referenceHashes: {} };
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function saveLedger(ledger, file = LEDGER_FILE) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(ledger, null, 1) + '\n'); renameSync(tmp, file);
}
export const isUsed = (ledger, family, split, difficulty, seed) => ledger.entries.some(e => e.family === family && e.split === split && e.difficulty === difficulty
  && (e.range ? seed >= e.range[0] && seed <= e.range[1] : e.seeds?.includes(seed)));

export const referenceHash = async (family, task) => { const fam = await (await bedsLib()).loadFamily(family); return digest(fam.referenceSolve(task)); };

// Every task the ledger already names for a deduplicated family (the inspected test seeds, the construction probes, earlier fresh
// draws), as `split:dN:sS` keys. Review 2026-10-08: `draw` used to dedupe a codefix draw only against earlier FRESH draws, so a dev seed
// whose task equals an inspected test task (the d1-d3 dev/test overlap, beds/codefix AUDIT F2) could have been served as "fresh".
export function usedTaskKeys(ledger, family) {
  const out = [];
  for (const e of ledger.entries.filter(x => x.family === family)) {
    const seeds = e.range ? Array.from({ length: e.range[1] - e.range[0] + 1 }, (_, i) => e.range[0] + i) : e.seeds ?? [];
    for (const s of seeds) out.push({ split: e.split, difficulty: e.difficulty, seed: s, key: `${e.split}:d${e.difficulty}:s${s}` });
  }
  return out;
}
// Hash every used task of the family into ledger.referenceHashes (cached there, so each task is built once).
export async function hashUsedTasks(ledger, family, { maxRange = 200 } = {}) {
  const lib = await bedsLib(), hashes = ledger.referenceHashes[family] ??= {};
  for (const u of usedTaskKeys(ledger, family)) {
    if (hashes[u.key]) continue;
    const entry = ledger.entries.find(e => e.family === family && e.split === u.split && e.difficulty === u.difficulty && e.range && u.seed >= e.range[0] && u.seed <= e.range[1]);
    if (entry && entry.range[1] - entry.range[0] + 1 > maxRange) continue;   // a wide pre-registered range is excluded by seed, not by task
    const [t] = await lib.makeTasks(family, { split: u.split, seeds: [u.seed], difficulty: u.difficulty });
    hashes[u.key] = await referenceHash(family, t.task ?? t);
  }
  return hashes;
}

// Draw `n` fresh seeds from a pool. `keep(task)` may veto a seed (for example to balance strata); vetoed seeds stay unused.
// The draw is recorded before it is returned: a seed that reached a gate is consumed even if the run is abandoned.
export async function draw({ ledger, family, split = 'dev', difficulty, n, by, pool = 'heal', keep = null, scan = 400, makeTask }) {
  const range = POOLS[pool]?.[family];
  if (!range) throw new Error(`HEAL_SEED_POOL: no ${pool} pool for ${family}`);
  const dedupe = family === 'codefix';
  ledger.referenceHashes ??= {};
  if (dedupe) await hashUsedTasks(ledger, family);
  // Only the hashes of tasks that were USED count: a seed a stratum vetoed is cached in referenceHashes too, and it must stay drawable
  // (it used to be skipped forever as a "duplicate" of its own cached hash).
  const usedKeys = new Set(usedTaskKeys(ledger, family).map(u => u.key));
  const seeds = [], seen = new Set(Object.entries(ledger.referenceHashes?.[family] ?? {}).filter(([k]) => usedKeys.has(k)).map(([, h]) => h));
  for (let seed = range[0]; seed <= range[1] && seeds.length < n && seed - range[0] < scan; seed++) {
    if (isUsed(ledger, family, split, difficulty, seed)) continue;
    const task = await makeTask(seed);
    let h = null;
    if (dedupe) { h = await referenceHash(family, task.task ?? task); (ledger.referenceHashes[family] ??= {})[`${split}:d${difficulty}:s${seed}`] = h; if (seen.has(h)) continue; }
    if (keep && !(await keep(task, seeds))) { continue; }
    if (h) seen.add(h);
    seeds.push(seed);
  }
  if (seeds.length < n) throw Object.assign(new Error(`HEAL_SEED_POOL_EXHAUSTED: ${seeds.length}/${n} fresh ${family} ${split} d${difficulty} seeds left in pool ${pool}`), { code: 'HEAL_SEED_POOL_EXHAUSTED' });
  ledger.entries.push({ family, split, difficulty, seeds, by, at: new Date().toISOString() });
  return seeds;
}
