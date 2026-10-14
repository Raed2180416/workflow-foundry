// Synthetic label worlds for the need-router evaluator tests (not a test file itself). $0.
// Planted truth: a job needs a workflow when it is big (logInputTokens >= 4.3) OR wide (maxListLength >= 2.2); the
// best mode is then construct-H at every cell of the slider grid; otherwise direct-H. The size-only rule misses the
// wide jobs, so a router that reads both keys beats it. `informative: false` assigns the regime at random, independent
// of the features (a null world: no router can learn anything from structure).
import { syntheticWorld, makeContext } from '../evaluate.mjs';

export const SMALL = Object.freeze({
  'direct-H': { p: 0.95, q: 0.03, c: 0.02 }, 'agent-H': { p: 0.95, q: 0.03, c: 0.12 }, 'agent-O': { p: 0.97, q: 0.02, c: 0.6 },
  'agent-H+proc': { p: 0.95, q: 0.03, c: 0.13, B: 0.03 }, 'construct-H': { p: 0.9, q: 0.05, c: 0.02, B: 1.0 },
});
export const BIG = Object.freeze({
  'direct-H': { p: 0.1, q: 0.6, c: 0.03 }, 'agent-H': { p: 0.4, q: 0.3, c: 0.15 }, 'agent-O': { p: 0.6, q: 0.2, c: 0.9 },
  'agent-H+proc': { p: 0.5, q: 0.2, c: 0.17, B: 0.03 }, 'construct-H': { p: 0.95, q: 0.02, c: 0.02, B: 0.15 },
});
export const needsWorkflow = f => f.logInputTokens >= 4.3 || f.maxListLength >= 2.2;
const TYPES = ['small', 'big', 'wide'];
export function features(r, k) {
  const t = TYPES[k % 3];
  return { logInputTokens: t === 'big' ? 4.6 + 0.6 * r() : 2.6 + 1.2 * r(), maxListLength: t === 'wide' ? 2.6 + 0.6 * r() : 1.5 * r(),
    logSchemaLeaves: 1 + r(), itemLists: 1, freeText: 0, multiSource: 0, conventionsInProse: 0, verifiable: 1 };
}

export function plantedWorld({ seed = 3, train = 4, heldout = 8, jobs = 3, informative = true, near = null } = {}) {
  const clusters = [...Array.from({ length: train }, (_, i) => ({ id: `T${i}`, split: 'train', jobs })),
    ...Array.from({ length: heldout }, (_, i) => ({ id: `H${i}`, split: 'heldout', jobs, near: near === i }))];
  return syntheticWorld({ seed, clusters, features, truth: (f, r) => ((informative ? needsWorkflow(f) : r() < 0.5) ? BIG : SMALL) });
}

/** Recorded judge-H decisions: a weak judge that always says agent-H, with its routing dollars. */
export const judgeAlwaysAgent = meta => Object.keys(meta).filter(j => meta[j].split !== 'train').map(job => ({ policy: 'judge-H', job, cell: null, mode: 'agent-H', routingUsd: 0.09 }));
export { makeContext };
