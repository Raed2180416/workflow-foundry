// The R5 format catalogue (W-BED §3.5: "drawn per task from >= 8 textual formats"). Eleven formats in four tiers:
//
//   tier        drawn at              formats                                              necessity control parses it
//   dev         d2-d4, both splits    fixed-width, code-page, jsonl-versions, monthly-csv  yes (the "dev formats")
//   wild        d2-d4, both splits    copybook-overpunch, keyed-stanzas, decoder-tool*     no
//   novel-dev   d5, split dev only    column-store, print-image                            no
//   novel-test  d5, split test only   hex-masked, tagged-dictionary                        no
//   (* decoder-tool is grade 2 and is drawn from d3)
//
// THE RULE (format draw, recorded in W-BED-R5-NOTES §2):
//   class(seed, d) = 'novel' if d = 5; else 'dev' if seed mod 3 = 0; else 'wild'.
//   pool(class, split, d) = DEV | WILD (grade <= 1 at d2, <= 2 at d3-d4) | NOVEL_DEV (split dev) | NOVEL_TEST (split test).
//   format = pool[floor(u * |pool|)], u from rng('wbed','r5','format', split, seed, d, 0).
// Consequences, by construction: no novel format at d <= 4; at d5 the dev and test pools are disjoint (and disjoint from
// every d <= 4 format), so a held-out d5 task's format never appears in any dev task; the necessity control (code
// parsers for the dev formats only) meets a non-dev format on every task with seed mod 3 != 0 at d2-d4 (two seeds in
// three: 66.7% of any run of consecutive seeds, rounded down at most one) and on every d5 task.
import { taskRng } from '../lib/prng.mjs';
import { DEV_FORMATS } from './formats-dev.mjs';
import { WILD_FORMATS } from './formats-wild.mjs';
import { NOVEL_DEV_FORMATS, NOVEL_TEST_FORMATS } from './formats-novel.mjs';

export const FORMATS = Object.freeze([...DEV_FORMATS, ...WILD_FORMATS, ...NOVEL_DEV_FORMATS, ...NOVEL_TEST_FORMATS]);
export const FORMAT_BY_ID = Object.freeze(Object.fromEntries(FORMATS.map(f => [f.id, f])));
export const DEV_FORMAT_IDS = Object.freeze(DEV_FORMATS.map(f => f.id));
export const NOVEL_IDS = Object.freeze({ dev: NOVEL_DEV_FORMATS.map(f => f.id), test: NOVEL_TEST_FORMATS.map(f => f.id) });

export const FORMAT_RULE = 'class = novel at d5, else dev when seed mod 3 = 0, else wild; pool = DEV | WILD (grade <= 1 at d2) | NOVEL_DEV (split dev) | NOVEL_TEST (split test); one seeded pick';

export const classOf = (seed, difficulty) => (difficulty >= 5 ? 'novel' : seed % 3 === 0 ? 'dev' : 'wild');
export function poolOf(cls, split, difficulty) {
  if (cls === 'novel') return split === 'test' ? NOVEL_TEST_FORMATS : NOVEL_DEV_FORMATS;
  if (cls === 'dev') return DEV_FORMATS;
  return WILD_FORMATS.filter(f => f.grade <= (difficulty <= 2 ? 1 : 2));
}
/** The dump format of a task: a pure function of (seed, split, difficulty), fixed across generator re-draws. */
export function formatOf({ seed, split = 'dev', difficulty }) {
  const cls = classOf(seed, difficulty);
  const pool = poolOf(cls, split, difficulty);
  return pool[Math.floor(taskRng('r5', 'format', { seed, split, difficulty }).next() * pool.length)];
}

/** Catalogue metadata (no code): what the notes' table lists. */
export const CATALOGUE = FORMATS.map(f => ({ id: f.id, name: f.name, tier: f.tier, grade: f.grade, layoutWhere: f.layoutWhere,
  drawnAt: f.tier === 'dev' || f.tier === 'wild' ? (f.grade > 1 ? 'd3-d4' : 'd2-d4') : 'd5', split: f.tier === 'novel-dev' ? 'dev' : f.tier === 'novel-test' ? 'test' : 'dev+test',
  necessityParser: f.tier === 'dev', mistake: f.mistake.name }));
