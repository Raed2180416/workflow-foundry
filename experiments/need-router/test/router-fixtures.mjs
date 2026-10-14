// Fixtures for the v1 router and decision-card tests (not a test file itself). $0.
// plantedRouter: evaluate.mjs's planted world (test/worlds.mjs: a job needs a workflow when logInputTokens >= 4.3 OR
// maxListLength >= 2.2; construct-H is then best at every cell, else direct-H), labelled, with the TRAIN fitting context
// and the public views of the held-out jobs. Random mode sets for property tests: `realisticModes` follows the v1 modes'
// shape (direct-H cheap, agent-O dear, a small procedure-writing cost for agent-H+proc, a large build for construct-H and
// its cascade), `generalModes` draws anything.
import { plantedWorld } from './worlds.mjs';
import { makeContext, publicView } from '../evaluate.mjs';
import { needTable, needLabels, GRID, MODES, rng } from '../metrics.mjs';
import { itemsFromContext } from '../router.mjs';

export const V1_MODES = Object.freeze(Object.keys(MODES).filter(m => !MODES[m].ceiling));

let cached = null;
export function plantedRouter() {
  if (cached) return cached;
  const W = plantedWorld({ near: 7 });
  const table = needTable(W.rows, W.builds);
  const labels = needLabels(table, { cells: GRID, reps: 200, seed: 1 });
  const TRAIN = table.jobs.filter(j => W.meta[j].split === 'train'), EVAL = table.jobs.filter(j => W.meta[j].split === 'heldout');
  const ctx = makeContext(labels, TRAIN, W.meta, { modes: V1_MODES });
  const view = (j, over = {}) => ({ ...publicView(j, W.meta[j], labels.modesOf(j).filter(m => V1_MODES.includes(m))), ...over });
  cached = { W, table, labels, TRAIN, EVAL, ctx, items: itemsFromContext(ctx), view };
  return cached;
}

const U = (r, a, b) => a + (b - a) * r();
/** A v1-shaped random mode set: Map(mode -> {s, q, c, B}). */
export function realisticModes(r) {
  const sD = U(r, 0, 1), sA = Math.min(1, sD + U(r, -0.1, 0.4)), sO = Math.min(1, sA + U(r, 0, 0.3)), sP = Math.min(1, sA + U(r, -0.1, 0.2)), sC = U(r, 0, 1);
  const st = (s, c, B) => ({ s, q: U(r, 0, 1 - s), c, B });
  const cC = U(r, 0.005, 0.06), BC = U(r, 0.1, 2.5), cA = U(r, 0.05, 0.25);
  const sCas = Math.min(1, sC + (1 - sC) * U(r, 0, 0.5) * sA);
  return new Map([
    ['direct-H', st(sD, U(r, 0.01, 0.06), 0)], ['agent-H', st(sA, cA, 0)], ['agent-O', st(sO, U(r, 0.3, 1), 0)],
    ['agent-H+proc', st(sP, cA * U(r, 1, 1.3), U(r, 0.01, 0.1))], ['construct-H', st(sC, cC, BC)],
    ['construct-H->agent-H', { s: sCas, q: U(r, 0, 1 - sCas), c: cC + (1 - sC) * U(r, 0, 1) * cA, B: BC }],
  ]);
}
/** Any 3-8 modes (named m0..m7), half of them with a build cost. */
export function generalModes(r) {
  const n = 3 + Math.floor(r() * 6);
  return new Map(Array.from({ length: n }, (_, i) => { const s = r(); return [`m${i}`, { s, q: r() * (1 - s), c: r() * 0.7, B: r() < 0.5 ? r() * 2 : 0 }]; }));
}
export { rng };

/**
 * A pinned case where δ ties are not monotone in N (V = $1, W = 0, δ = 0.03). At N = 1 agent-O (u 0.35) is best and
 * agent-H+proc (u 0.33) is within δ and cheaper, so the guided workflow is chosen. At N = 2 construct-H's build halves
 * (u 0.378): agent-H+proc (u 0.345) falls out of δ, agent-O (u 0.35) stays in, and agent-O ($0.60) is cheaper than
 * construct-H ($0.62), so the choice goes back to no workflow. Exact ties choose agent-O, then construct-H: monotone.
 */
export const NON_MONOTONE_N = Object.freeze(new Map([
  ['agent-O', { s: 0.95, q: 0, c: 0.6, B: 0 }],
  ['agent-H+proc', { s: 0.49, q: 0, c: 0.13, B: 0.03 }],
  ['construct-H', { s: 0.998, q: 0, c: 0.02, B: 1.2 }],
]));
