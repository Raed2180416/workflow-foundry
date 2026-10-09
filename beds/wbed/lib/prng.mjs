// Seeded PRNG and hashing for W-bed generators. Thin re-export of the shared bed helpers (beds/lib/rng.mjs,
// beds/lib/canonical.mjs) plus one convention: every W-bed random stream is salted with the rung id, the part of the
// world it draws, (split, seed, difficulty) and the attempt number, so two rungs on one seed never share a stream.
import { rng, hashSeed } from '../../lib/rng.mjs';
export { rng, hashSeed };
export { canonical, sha256, hashOf, estimateTokens } from '../../lib/canonical.mjs';

/** Random stream for one part of one task: `rung` ('r0', 'r1', ...), `part` ('ledger', 'render', ...). */
export const taskRng = (rung, part, { seed, split, difficulty }, attempt = 0) => rng('wbed', rung, part, split, seed, difficulty, attempt);
