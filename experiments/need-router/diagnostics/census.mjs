// The $0 feature census and the preregistered job table, as the inputs of D0 (kNN neighbours) and D1 (shortcut audit).
//   research/need-router-20261014/features-census.json   14 families x difficulty 3 and 5: the whitelisted features of example
//                                                          seeds 601-603 (experiments/need-router/features.mjs), computed 2026-10-14
//   research/need-router-20261014/prereg/stages.json      jobs (cluster, split, band, max example tokens, hypothesis), clusters
// The trusted feature set is the 8-key narrowing of DESIGN §1; the four prose-count keys count words in untrusted task text
// and stay out of the router (they remain inputs of the keyword baseline).
import path from 'node:path';
import { PROGRAM_DIR, readJson, sourceOf } from './common.mjs';
import { WHITELIST } from '../features.mjs';

export const TRUSTED8 = Object.freeze(['logInputTokens', 'logSchemaLeaves', 'itemLists', 'maxListLength', 'freeText', 'multiSource', 'conventionsInProse', 'verifiable']);
export const PROSE4 = Object.freeze(['effectVerbs', 'timeWords', 'humanWords', 'promptWords']);
export const KEYS12 = WHITELIST;   // the v0 whitelist: TRUSTED8 plus PROSE4
export const CENSUS_FILE = path.join(PROGRAM_DIR, 'features-census.json');
export const STAGES_FILE = path.join(PROGRAM_DIR, 'prereg/stages.json');
// r4 and r5 are cut from v1 (DESIGN §4) but stay in cluster W by the import graph (r4 imports r1 and r3; r5 imports r1 and r4).
export const CUT_FAMILIES = Object.freeze(['wbed-r4', 'wbed-r5']);

export function loadStages(file = STAGES_FILE) {
  const stages = readJson(file);
  const familyCluster = new Map();
  for (const [cluster, c] of Object.entries(stages.clusters)) for (const f of c.families) familyCluster.set(f, cluster);
  for (const f of CUT_FAMILIES) familyCluster.set(f, 'W');
  return { stages, familyCluster, source: sourceOf(file) };
}

/** Census entries as { id: 'records@d3', family, difficulty, features } (errors skipped and listed). */
export function loadCensus(file = CENSUS_FILE) {
  const raw = readJson(file), entries = [], errors = [];
  for (const [id, v] of Object.entries(raw)) {
    const [family, d] = id.split('@d');
    if (v.error) { errors.push({ id, error: v.error }); continue; }
    entries.push({ id, family, difficulty: Number(d), features: v });
  }
  return { entries, errors, source: sourceOf(file) };
}

/** Standardised euclidean nearest neighbours, exactly the metric of router.knnPredictor: z-scores from the pool's own mean and
 *  sample sd (sd 0 or one point -> 1), a missing value = the pool mean, ties broken by id. Returns [{id, d}] nearest first. */
export function nearest(pool, query, { k = 3, keys = TRUSTED8 } = {}) {
  const mean = {}, sd = {};
  for (const key of keys) {
    const xs = pool.map(p => p.features[key]).filter(Number.isFinite);
    mean[key] = xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0;
    sd[key] = xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean[key]) ** 2, 0) / (xs.length - 1)) || 1 : 1;
  }
  const z = f => keys.map(key => ((Number.isFinite(f[key]) ? f[key] : mean[key]) - mean[key]) / sd[key]);
  const q = z(query.features);
  return pool.map(p => ({ id: p.id, d: Math.hypot(...z(p.features).map((x, i) => x - q[i])), entry: p }))
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1)).slice(0, Math.min(k, pool.length));
}
