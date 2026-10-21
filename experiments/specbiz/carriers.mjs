// SPEC-0 carrier assignment (FIRST-CLASS-PROGRAMS §4.4): which unit of SPEC-E sits in which carrier, by code, seeded.
// $0, pure. The assignment is the exact truth that requirement recall and the leak and coverage gates rest on.
//
// Carriers of the 30 gold ids (quotas fixed for every seed):
//   sop       16  the current SOP page (v3) states the rule
//   override   3  the SOP v3 states an outdated version; a later e-mail from an authorised sender gives the current one
//   email      4  only an e-mail from an authorised sender states the rule
//   records    4  only precedent records reveal it (inference; precedent.mjs proves each one discriminating)
//   owner      3  only the owner knows it: answerable only by asking (owner-sim.mjs)
// So the SOP mentions 19 of 30 (63%), 3 of them stale; 3 of 30 (10%) are owner-only.
// Extra units (not among the 30): U12 and NTF are pinned to the SOP; S10-S15 go to the SOP or an e-mail (seeded).
import { rng } from '../../beds/lib/rng.mjs';
import { hashOf } from '../../beds/lib/canonical.mjs';
import { GOLD_IDS, EXTRA_IDS } from './spec-units.mjs';
import { ELIGIBLE } from './content.mjs';

export const CARRIERS = Object.freeze(['sop', 'override', 'email', 'records', 'owner']);
export const QUOTAS = Object.freeze({ records: 4, owner: 3, override: 3, email: 4, sop: 16 });
export const PINNED = Object.freeze({ U12: 'sop', NTF: 'sop' });
const DRAW_ORDER = ['records', 'owner', 'override', 'email'];

/**
 * assignCarriers(seed) → { seed, version, units: { id: { carrier, gold } }, counts, digest }.
 * Draws within each carrier's eligible set (content.mjs ELIGIBLE), in a fixed order, without replacement.
 */
export function assignCarriers(seed) {
  if (!Number.isInteger(seed)) throw new Error('seed must be an integer');
  const r = rng('specbiz/carriers', seed);
  const taken = new Map();
  for (const carrier of DRAW_ORDER) {
    const pool = ELIGIBLE[carrier].filter(id => GOLD_IDS.includes(id) && !taken.has(id));
    if (pool.length < QUOTAS[carrier]) throw new Error(`carrier ${carrier}: ${pool.length} eligible left, quota ${QUOTAS[carrier]}`);
    for (const id of r.sample(pool, QUOTAS[carrier])) taken.set(id, carrier);
  }
  const units = {};
  for (const id of GOLD_IDS) units[id] = { carrier: taken.get(id) ?? 'sop', gold: true };
  for (const id of EXTRA_IDS) units[id] = { carrier: PINNED[id] ?? (r.chance(0.5) ? 'sop' : 'email'), gold: false };
  const counts = Object.fromEntries(CARRIERS.map(c => [c, GOLD_IDS.filter(id => units[id].carrier === c).length]));
  const out = { seed, version: 'specbiz-carriers/1', units, counts };
  return { ...out, digest: hashOf(out) };
}

/** Carriers whose documents may state a unit's true rule (the leak tests' allowed set). Owner answers are separate. */
export function allowedCarriers(carrier) {
  return { sop: ['sop'], override: ['email'], email: ['email'], records: ['records'], owner: [] }[carrier];
}

/** Provenance tag per unit (CorpusBench / Era style, research/intent-20261021/EXTERNAL-BENCHMARKS.md). */
export function provenanceOf(carrier) {
  return { sop: 'stated', email: 'stated', override: 'stated-override', records: 'evidenced', owner: 'owner-only' }[carrier] ?? 'not-derivable';
}
