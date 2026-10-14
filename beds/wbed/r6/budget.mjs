// Token accounting for R6's decisive comparison (W-BED §3.6, PROOF-LEDGER B6): `wide` versus `best_of_n` at equal
// tokens, with the same verifier. Also the attention model behind the size-gated controls.
//
// The attention model (stand-in, as R3's SEQUENTIAL_BUDGET_TOKENS): a single context reads the corpus in document-id
// order and keeps what it read within a budget of SEQUENTIAL_BUDGET_TOKENS input tokens (prompt and inputs included);
// documents past the budget are not read at all. It is a hypothesis about long-context reading, encoded so that the
// controls are deterministic; the paid run measures the real thing.
//
// The reference `wide` reads (input tokens, utf8/4): plan = prompt + inputs + the header digest of every document
// (Type, Venue, Published, Affiliation, Title) + the consortium notices; one worker per plan candidate = prompt + inputs
// + every notice (errata, retractions, concerns, consortium notices) + every research document and review that mentions
// the candidate; verify = a panel of 3 judges on a 20% sample of cells, each judge reading what that cell's worker
// read. Output tokens are not counted (they are small next to the reads and the same order for both arms).
import { estimateTokens, rng } from '../lib/prng.mjs';
import { isResearch } from './world.mjs';

export const SEQUENTIAL_BUDGET_TOKENS = 32000;
/** Tokens the inline render adds per file ("## files/corpus/D001.txt" and the fences). */
export const PER_FILE_OVERHEAD = 12;
export const PANEL = { n: 3, sample: 0.2 };
export const BEST_OF_N_MIN = 3;

const noticeKinds = new Set(['erratum', 'retraction', 'concern', 'office']);
const headerOf = text => text.split('\n\n')[0];

/** Keys in reading order: document ids ascending, rotated to start at `offset`. */
export function readingOrder(world, offset = 0) {
  const keys = world.docs.map(d => d.key);
  const k = ((offset % keys.length) + keys.length) % keys.length;
  return [...keys.slice(k), ...keys.slice(0, k)];
}
/** Documents a single context never reads: everything past the budget in `order`. */
export function unseenPast(world, order, budget = SEQUENTIAL_BUDGET_TOKENS) {
  let used = world.render.fixedTokens;
  const unseen = new Set();
  for (const k of order) {
    used += world.render.tokens.get(k) + PER_FILE_OVERHEAD;
    if (used > budget) unseen.add(k);
  }
  return unseen;
}

/**
 * Input-token accounting of one task: corpus, inline render, the reference wide's phases, and best_of_n's N.
 * Two worker designs are counted. `chain` (the declared reference, structure.features.judges): per candidate one scope
 * judge, then for an in-scope candidate one judge per requested property, each call reading the candidate's context
 * (prompt + inputs + every notice + its mention documents). `oneCall`: one typed judgment per candidate returning the
 * scope verdict and every cell. N at equal tokens is computed from the declared design.
 */
export function tokenAccounting(world, { candidates, inScope }) {
  const tok = world.render.tokens, fixed = world.render.fixedTokens;
  const corpus = world.docs.reduce((s, d) => s + tok.get(d.key), 0);
  const inline = fixed + corpus + world.docs.length * PER_FILE_OVERHEAD;
  const notices = world.docs.filter(d => noticeKinds.has(d.kind)).reduce((s, d) => s + tok.get(d.key), 0);
  const digest = world.docs.reduce((s, d) => s + estimateTokens(headerOf(world.render.texts.get(d.key))), 0);
  const plan = fixed + digest + world.docs.filter(d => d.kind === 'office').reduce((s, d) => s + tok.get(d.key), 0);
  const ent = new Map(world.entities.map(e => [e.code, e]));
  const docsOf = code => { const e = ent.get(code); return world.docs.filter(d => (isResearch(d) || d.kind === 'review') && d.styles[e.id]).reduce((s, d) => s + tok.get(d.key), 0); };
  const workerOf = code => fixed + notices + docsOf(code);
  const inSet = new Set(inScope), k = world.props.length;
  const perWorker = candidates.map(workerOf);
  const oneCall = perWorker.reduce((a, b) => a + b, 0);
  const chain = candidates.reduce((s, code, i) => s + perWorker[i] * (inSet.has(code) ? 1 + k : 1), 0);
  const calls = { plan: 1, workers: candidates.length + inScope.length * k, verify: 0 };
  // prompt caching (slice 2 item 6b): the shared prefix (prompt + inputs + notices) is written once, each candidate's
  // documents once; every other read of them is a cache hit
  const uncached = fixed + notices + candidates.reduce((s, code) => s + docsOf(code), 0);
  const cells = inScope.length * k;
  const sample = Math.ceil(PANEL.sample * cells);
  const r = rng('wbed', 'r6', 'panel', world.spec.split, world.spec.seed, world.spec.difficulty);
  const sampled = Array.from({ length: sample }, () => r.pick(inScope));
  calls.verify = PANEL.n * sample;
  // verify, two readings: each panel judge re-derives the sampled cell from the compound's evidence (what its worker
  // read), or checks the cited source only (prompt + notices + the source document; cheaper, blind to a better claim)
  const verify = PANEL.n * sampled.reduce((s, code) => s + workerOf(code), 0);
  const meanDoc = corpus / world.docs.length;
  const verifySourceOnly = Math.round(PANEL.n * sample * (fixed + notices + meanDoc));
  const total = plan + chain + verify, totalOneCall = plan + oneCall + verify, totalLean = plan + oneCall + verifySourceOnly;
  const nOf = t => Math.max(1, Math.floor(t / inline));
  return {
    corpus, inline, notices, digest,
    wide: { plan, workers: chain, workersOneCall: oneCall, workerMean: Math.round(oneCall / Math.max(1, candidates.length)), workerMax: Math.max(0, ...perWorker),
      cacheableShare: Math.round((1 - uncached / chain) * 1000) / 1000, verify, verifySourceOnly, total, totalOneCall, totalLean, calls, candidates: candidates.length, cells, sample },
    bestOfN: { nAtEqualTokens: nOf(total), nOneCall: nOf(totalOneCall), nLean: nOf(totalLean), ratio: Math.round((total / inline) * 100) / 100 },
    over100k: { inline: inline > 100000, workerMax: Math.max(0, ...perWorker) > 100000 },
  };
}
