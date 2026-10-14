// Worked-example selection for need-nospec-records. Host side: the example seeds are a pure function of the task's
// (seed, split, difficulty); a task never carries them. Every example is a `records` world (beds/records/world.mjs,
// imported read-only) built from a seed in a namespace that no evaluation range uses.
import { hashSeed } from '../lib/rng.mjs';
import { buildWorld } from '../records/world.mjs';

/** Number of solved examples per difficulty: 2 at d1 rising to 5 at d5. */
export const EXAMPLE_COUNT = Object.freeze({ 1: 2, 2: 3, 3: 4, 4: 4, 5: 5 });
/**
 * The examples always come from the dev split of `records`: they are development material that the solver may learn from, never
 * held-out data, whatever the split of the task they accompany. (The task's split still salts which examples a task gets.)
 */
export const EXAMPLE_SPLIT = 'dev';
/** Example seeds live in [BASE, BASE + SPAN): far above every seed range in use (all below 1e6). */
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
// (Equal canonical record content implies an equal key, so this one rule also covers a record shown with all its values.)
const fold = s => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const personKey = r => `${fold(r.family_name)}|${fold(r.given_name)}|${r.birth_date ?? `tel:${r.phone_e164}`}`;

/**
 * Why an example world must not accompany a task world, or null. An example is rejected when it would show the evaluation
 * batch's truth: the same person (names + birth date, or names + phone when undated), a phone number (E.164) that the evaluation
 * truth contains, or an export line that is also a line of the evaluation export. (The phone rule is stricter than the person
 * rule; it keeps the invariant "no truth phone number is shown in an example" simple to state and to test.)
 */
export function collision(taskWorld, exampleWorld) {
  const keys = new Set(exampleWorld.truth.records.map(personKey));
  if (taskWorld.truth.records.some(r => keys.has(personKey(r)))) return 'person';
  const phones = new Set(exampleWorld.truth.records.map(r => r.phone_e164).filter(Boolean));
  if (taskWorld.truth.records.some(r => r.phone_e164 && phones.has(r.phone_e164))) return 'phone';
  const lines = new Set(exampleWorld.exportText.split('\n'));
  if (taskWorld.exportText.split('\n').some(l => lines.has(l))) return 'export-line';
  return null;
}

/**
 * Choose the example worlds of a task: for each of the EXAMPLE_COUNT[difficulty] slots, the first candidate seed (attempt 0, 1, ...)
 * that is not the task's own seed, not already chosen, and whose (dev-split) world does not collide with the task's. Returns
 * [{seed, split, difficulty}]. seedFn and worldOf are injectable so that the rejection rules can be tested.
 */
export function pickExamples({ taskWorld, seed, split, difficulty, seedFn = exampleSeed, worldOf = worldFor, maxAttempts = MAX_ATTEMPTS }) {
  const refs = [];
  for (let j = 0; j < EXAMPLE_COUNT[difficulty]; j++) {
    let chosen = null;
    for (let attempt = 0; attempt < maxAttempts && chosen === null; attempt++) {
      const s = seedFn(seed, split, difficulty, j, attempt);
      if (s === seed || refs.some(r => r.seed === s)) continue;
      if (collision(taskWorld, worldOf(s, EXAMPLE_SPLIT, difficulty)) === null) chosen = s;
    }
    if (chosen === null) throw new Error(`need-nospec-records: no collision-free example ${j} for seed ${seed} (${split}, d${difficulty})`);
    refs.push({ seed: chosen, split: EXAMPLE_SPLIT, difficulty });
  }
  return refs;
}

const refCache = new Map();
/** The example worlds of a task: [{seed, split, difficulty}] in presentation order, deterministic and collision-free. */
export function exampleRefs(seed, split, difficulty) {
  const cacheKey = `${split}|${difficulty}|${seed}`;
  let refs = refCache.get(cacheKey);
  if (!refs) {
    refs = pickExamples({ taskWorld: worldFor(seed, split, difficulty), seed, split, difficulty });
    refCache.set(cacheKey, refs);
    if (refCache.size > 200) refCache.delete(refCache.keys().next().value);
  }
  return refs.map(r => ({ ...r }));
}
