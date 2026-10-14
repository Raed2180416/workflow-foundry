// need-r0pad: the metamorphic LENGTH partner of wbed-r0 for the need router (experiments/need-router).
// Routing anchor, not a Tier-A bed: the task, the truth and the oracle are R0's, imported read-only from beds/wbed/r0; the only
// change is 10-20 irrelevant but plausible generated documents in files/archive/ that raise the input to roughly 15-25K tokens.
// Interface per beds/CONTRACT.md v1. Pure and seeded (beds/lib/rng.mjs); $0, no model call anywhere.
import * as r0 from '../wbed/r0/index.mjs';
import { buildPadding, PAD_SPEC, PAD_NOTE } from './padding.mjs';

export const version = '1.0.0';
export const family = {
  id: 'need-r0pad', domain: 'back-office invoice extraction under irrelevant context (length-padded wbed-r0)', version, kind: 'oneshot', role: 'need-anchor',
  description: 'The same task as beds/wbed/r0 at the same (seed, split, difficulty) - read one printed invoice and return its number, customer row, ISO issue '
    + 'date, currency, net / tax / gross in minor units and whether its status voids it - plus 10-20 irrelevant but plausible generated archive documents '
    + '(files/archive/, 15-25K tokens in all). Routing anchor and metamorphic length pair of wbed-r0: same structure, a few tens of times the input. Intended class '
    + '(a HYPOTHESIS, unmeasured): one direct call should suffice, because the added length carries no added structure; long-context loss of accuracy is the open question.',
};

// Difficulty is R0's (2..5): lines, discount, credited line, per-task date order and status word. wbed-r0 defines no level 1, but
// beds/CONTRACT.md asks for 1..5, so level 1 is an exact ALIAS of R0's level 2: the same R0 core and the same padding, with the task
// id and the difficulty field still recording 1 (README, "Difficulty knob"). The padding is constant in kind, count range and size
// band at every difficulty, so length and structure are separate axes (README).
const R0_LEVEL = { 1: 2 };                                   // alias table: need-r0pad level -> wbed-r0 level
const r0Level = d => R0_LEVEL[d] ?? d;
export const difficulty = { min: 1, max: 5, default: 3, alias: { ...R0_LEVEL }, levels: { 1: r0.LEVELS[2], ...r0.LEVELS }, padding: { ...PAD_SPEC },
  drift: `${r0.difficulty.drift}; level 1 is an alias of level 2 (identical task body, only id and difficulty differ); the padding (10-20 documents, 15-25K tokens) does not change with difficulty` };

export const outputSchema = JSON.parse(JSON.stringify(r0.outputSchema));

const fail = msg => { throw new Error(`need-r0pad: ${msg}`); };
function checkDifficulty(d) {
  if (!Number.isInteger(d) || d < difficulty.min || d > difficulty.max) fail(`difficulty must be an integer ${difficulty.min}..${difficulty.max} (R0's levels 2..5, with 1 as an alias of 2), got ${String(d)}`);
}
function checkArgs(seed, split, d) {
  if (!Number.isSafeInteger(seed)) fail(`seed must be an integer, got ${String(seed)}`);
  if (split !== 'dev' && split !== 'test') fail(`split must be 'dev' or 'test', got ${String(split)}`);
  checkDifficulty(d);
}
// The (seed, split, R0 level) a need-r0pad task wraps: the oracle and the controls read only this, never the prompt, inputs or files.
function keyOf(task) {
  const d = task.difficulty ?? 3;
  checkDifficulty(d);
  return { seed: task.seed, split: task.split ?? 'dev', difficulty: r0Level(d) };
}
// The R0 task a need-r0pad task wraps (a fresh object).
const coreOf = task => r0.generate(keyOf(task));

export function generate({ seed, split = 'dev', difficulty: d = 3, faults } = {}) {
  checkArgs(seed, split, d);
  const core = r0.generate({ seed, split, difficulty: r0Level(d), faults });
  const pad = buildPadding(core);              // a function of the R0 core alone, so level 1 and level 2 get the same archive
  return {
    id: `need-r0pad:${split}:d${d}:${seed}`, family: family.id, seed, split, difficulty: d,
    prompt: `${core.prompt}\n${pad.note}`,
    inputs: core.inputs,                                    // byte-identical to wbed-r0's inputs
    files: { ...pad.files },
    budget: { ...core.budget },
  };
}

// The oracle is R0's, called on the (seed, split, difficulty) of the task alone: it ignores the prompt, inputs and files it is handed.
export function oracle(task, output) { return r0.oracle(keyOf(task), output); }
export function referenceSolve(task) { return r0.referenceSolve(keyOf(task)); }

// R0's controls unchanged (same names, so a pair of beds can be compared control by control), plus two near misses that only a
// padded task has: the answer of a sibling invoice in the archive (a reader who took the wrong document) and the target with a
// sibling's amounts (a reader who mixed documents). Each fails for every seed: the sibling differs from the target in every field used.
const siblingOf = task => buildPadding(coreOf(task)).siblings[0].truth;
export const badControls = [
  ...r0.badControls.map(c => ({ ...c, make: task => c.make(keyOf(task)) })),
  { name: 'plausible-but-wrong:sibling-invoice', why: 'the answer for another invoice of the same billing system found in files/archive/',
    make: task => ({ ...siblingOf(task) }) },
  { name: 'plausible-but-wrong:sibling-amounts', why: 'the target invoice\'s identity with the net / tax / gross of a sibling invoice from the archive',
    make: task => { const s = siblingOf(task); return { ...referenceSolve(task), net_minor: s.net_minor, tax_minor: s.tax_minor, gross_minor: s.gross_minor }; } },
];

// Analysis helpers (host side only; they carry labels and sibling truths, so they are never part of a task or shown to a solver).
/** What surrounds the R0 core: per document kind, size and (for sibling invoices) the R0 seed it was taken from. */
export function describePadding(task) {
  const pad = buildPadding(coreOf(task));
  return { docs: pad.docs.map(d => ({ ...d, sibling: d.sibling ? { ...d.sibling } : null })), siblings: pad.siblings.map(s => ({ ...s, truth: { ...s.truth } })),
    paddingTokens: pad.docs.reduce((s, d) => s + d.tokens, 0), note: pad.note };
}
/** The R0 task (wbed-r0) this task pairs with: same seed and split, and the same difficulty (level 1 pairs with wbed-r0 level 2). */
export const pairedR0Task = coreOf;
/** Estimated tokens of a task by the need-router feature formula: bytes of JSON(inputs) + files + prompt, divided by 4. */
export const taskTokens = task => Math.ceil(Buffer.byteLength(JSON.stringify(task.inputs ?? {}) + Object.values(task.files ?? {}).join('\n') + String(task.prompt ?? '')) / 4);
export { PAD_SPEC, PAD_NOTE };
