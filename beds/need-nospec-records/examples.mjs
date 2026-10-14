// Worked-example selection for need-nospec-records. Host side: the example seeds are a pure function of the task's
// (seed, split, difficulty); a task never carries them. Every example is a `records` world (beds/records/world.mjs,
// imported read-only) built from a seed in a namespace that no evaluation range uses.
import { hashSeed } from '../lib/rng.mjs';
import { buildWorld } from '../records/world.mjs';

/** Number of solved examples per difficulty: 2 at d1 rising to 5 at d5. */
export const EXAMPLE_COUNT = Object.freeze({ 1: 2, 2: 3, 3: 4, 4: 4, 5: 5 });
/** Example seeds live in [BASE, BASE + SPAN): far above every dev / test / sealed seed range in use (all below 1e6). */
export const EXAMPLE_SEED_BASE = 100_000_000;
export const EXAMPLE_SEED_SPAN = 900_000_000;
const MAX_ATTEMPTS = 60;

// Memoised worlds (buildWorld is pure and nothing here mutates a world). Small LRU: a world is a few hundred KB.
const worlds = new Map();
export function worldFor(seed, split, difficulty) {
  const key = `${split}|${difficulty}|${seed}`;
  let w = worlds.get(key);
  if (w) { worlds.delete(key); worlds.set(key, w); return w; }
  w = buildWorld(seed, split, difficulty);
  worlds.set(key, w);
  if (worlds.size > 40) worlds.delete(worlds.keys().next().value);
  return w;
}

export const exampleSeed = (seed, split, difficulty, j, attempt) =>
  EXAMPLE_SEED_BASE + (hashSeed('need-nospec-records', 'example', split, seed, difficulty, j, attempt) % EXAMPLE_SEED_SPAN);

// A person, as the examples could reveal them: names (case-folded) plus the birth date, or the phone when there is none.
const fold = s => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const personKey = r => `${fold(r.family_name)}|${fold(r.given_name)}|${r.birth_date ?? `tel:${r.phone_e164}`}`;
// The whole canonical content of a record apart from the row ids (which are world-specific).
const contentKey = r => [r.given_name, r.family_name, r.birth_date, r.country, r.phone_e164, r.amount_usd].map(v => (v === null ? '' : String(v))).join('|');

/**
 * Why an example world must not accompany a task world, or null. An example is rejected when it would show the evaluation
 * batch's truth: the same person (names + birth date, or names + phone when undated), the same canonical record content,
 * or an export line that is also a line of the evaluation export. Phone numbers alone are not compared: the fictional
 * number ranges are small, so two unrelated people in two batches may share one (the identity rule needs the names too).
 */
export function collision(taskWorld, exampleWorld) {
  const keys = new Set(exampleWorld.truth.records.map(personKey));
  if (taskWorld.truth.records.some(r => keys.has(personKey(r)))) return 'person';
  const contents = new Set(exampleWorld.truth.records.map(contentKey));
  if (taskWorld.truth.records.some(r => contents.has(contentKey(r)))) return 'record-content';
  const lines = new Set(exampleWorld.exportText.split('\n'));
  if (taskWorld.exportText.split('\n').some(l => lines.has(l))) return 'export-line';
  return null;
}

const refCache = new Map();
/** The example worlds of a task: [{seed, split, difficulty}] in presentation order, deterministic and collision-free. */
export function exampleRefs(seed, split, difficulty) {
  const cacheKey = `${split}|${difficulty}|${seed}`;
  const hit = refCache.get(cacheKey);
  if (hit) return hit.map(r => ({ ...r }));
  const task = worldFor(seed, split, difficulty);
  const refs = [];
  for (let j = 0; j < EXAMPLE_COUNT[difficulty]; j++) {
    let chosen = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && chosen === null; attempt++) {
      const s = exampleSeed(seed, split, difficulty, j, attempt);
      if (s === seed || refs.some(r => r.seed === s)) continue;
      if (collision(task, worldFor(s, split, difficulty)) === null) chosen = s;
    }
    if (chosen === null) throw new Error(`need-nospec-records: no collision-free example ${j} for seed ${seed} (${split}, d${difficulty})`);
    refs.push({ seed: chosen, split, difficulty });
  }
  refCache.set(cacheKey, refs);
  if (refCache.size > 200) refCache.delete(refCache.keys().next().value);
  return refs.map(r => ({ ...r }));
}
