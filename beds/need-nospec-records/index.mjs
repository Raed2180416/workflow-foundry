// need-nospec-records: the `records` task with its written specification withheld and k solved examples given instead.
// Routing anchor for the need router (experiments/need-router), not a Tier-A bed: the task, the truth and the oracle are
// `records`' (beds/records, imported read-only); the only changes are that inputs.spec is gone (its rate tables stay as a
// plain-data rate sheet) and that inputs.examples holds k correctly solved batches of the same generator.
// Interface per beds/CONTRACT.md v1. Pure and seeded (beds/lib/rng.mjs); $0, no model call anywhere.
import * as rec from '../records/index.mjs';
import { ruleSolve } from '../records/world.mjs';
import * as P from '../records/pools.mjs';
import { estimateTokens } from '../lib/canonical.mjs';
import { EXAMPLE_COUNT, EXAMPLE_SEED_BASE, EXAMPLE_SEED_SPAN, worldFor, exampleRefs as refsOf } from './examples.mjs';
import { rateSheet, buildPrompt } from './render.mjs';

export const version = '1.0.0';
export const family = {
  id: 'need-nospec-records',
  domain: 'data repair / entity resolution with the rules withheld (induce them from solved examples, or ask)',
  version,
  kind: 'oneshot',
  role: 'need-anchor',
  description: 'The records task (merge a messy multi-system customer/supplier export into one master record per real person) at the same '
    + '(seed, split, difficulty), with the written specification removed: no identity, conflict, phone or USD-conversion rules. The batch keeps '
    + 'its own source notes and a plain rate sheet (the per-task FX rates). Instead, k = 2 (d1) to 5 (d5) earlier batches of the same generator, '
    + 'each with its notes, rate sheet, export and correct master records, are given as solved examples. Routing anchor for the need router: '
    + 'exploratory, build-from-examples versus clarify. Intended class (a HYPOTHESIS under test, unmeasured, not a result): at d1-d2 one direct '
    + 'call should suffice (H-induce: the rules can be induced from the 2-3 examples); at d3-d5 clarify-then-solve (H-clarify: the per-batch '
    + 'conventions, the demotion of the re-stamped system and the reference data are only partly visible in 4-5 long examples, so the written '
    + 'rules are needed first). The alternative, kept to be tested against it, is H-induce at every level.',
};

// The prior label for the need router's benchmark, one class per difficulty band. A HYPOTHESIS under test: no model has been run on
// this bed, and nothing in the tests depends on it holding (they only check that it is stated and marked as a hypothesis).
export const workingHypothesis = {
  status: 'hypothesis, unmeasured',
  bands: [
    { difficulties: [1, 2], hypothesis: 'H-induce', class: 'one direct call should suffice' },
    { difficulties: [3, 4, 5], hypothesis: 'H-clarify', class: 'clarify-then-solve' },
  ],
  alternative: { hypothesis: 'H-induce at every level', class: 'one direct call should suffice at d1-d5' },
};

// Difficulty is records': rows 30 -> 150, systems, per-task conventions from d3, dated FX at d5. The example count is the family's knob.
export const difficulty = { min: 1, max: 5, default: 3, examples: { ...EXAMPLE_COUNT }, base: 'records' };

export const outputSchema = structuredClone(rec.outputSchema);
export { LIMITS, FIELDS, THRESHOLDS, validate, scoreAgainst } from '../records/index.mjs';
export { EXAMPLE_COUNT, EXAMPLE_SEED_BASE, EXAMPLE_SEED_SPAN };

const fail = msg => { throw new Error(`need-nospec-records: ${msg}`); };
function checkArgs(seed, split, d) {
  if (!Number.isSafeInteger(seed)) fail(`seed must be an integer, got ${String(seed)}`);
  if (split !== 'dev' && split !== 'test') fail(`split must be 'dev' or 'test', got ${String(split)}`);
  if (!Number.isInteger(d) || d < 1 || d > 5) fail(`difficulty must be an integer 1..5, got ${String(d)}`);
}
const keyOf = task => ({ seed: task.seed, split: task.split, difficulty: task.difficulty });

// ---------------------------------------------------------------------------------------
export function generate({ seed, split = 'dev', difficulty: d = 3 } = {}) {
  checkArgs(seed, split, d);
  const w = worldFor(seed, split, d);
  const examples = refsOf(seed, split, d).map((ref, i) => {
    const ew = worldFor(ref.seed, ref.split, ref.difficulty);
    return { name: `example-${i + 1}`, source_notes: ew.notes, rate_sheet: rateSheet(ew), export: ew.exportText, output: structuredClone(ew.truth) };
  });
  const rows = w.allRows.length;
  return {
    id: `need-nospec-records:${split}:d${d}:${seed}`,
    family: family.id,
    seed, split, difficulty: d,
    prompt: buildPrompt({ systems: w.ctx.systems.length, rows, examples: examples.length }),
    // The new batch comes last. Its source_notes and export are byte-identical to records' for the same (seed, split, difficulty).
    inputs: { examples, source_notes: w.notes, rate_sheet: rateSheet(w), export: w.exportText },
    budget: { outputTokens: 400 + rows * 60 },
  };
}

// The oracle is records': it regenerates the world from (seed, split, difficulty) alone and ignores the prompt, inputs and
// examples it is handed.
export function oracle(task, output) {
  checkArgs(task?.seed, task?.split, task?.difficulty);
  return rec.scoreAgainst(worldFor(task.seed, task.split, task.difficulty).truth.records, output);
}

export function referenceSolve(task) {
  checkArgs(task?.seed, task?.split, task?.difficulty);
  return structuredClone(worldFor(task.seed, task.split, task.difficulty).truth);
}

// ---------------------------------------------------------------------------------------
// Bad controls. records' own (same names and minDifficulty, so the two beds compare control by control), plus three near
// misses that only a no-spec task has: parroting an example, reusing an example's rates, keeping the national trunk prefix of phones.
const WHY = {
  'empty': 'no records at all',
  'shuffled-or-corrupted': 'right clusters, but birth date, phone, amount and country rotated across records',
  'no-dedup': 'every row its own person (no entity resolution)',
  'birthdate-key': 'birth date as the identity key, names never compared',
  'ignore-void-markers': 'void rows (test fixtures, cancelled, withdrawn, sample) migrated as people',
  'oldest-row-wins': 'conflicts resolved by the oldest row instead of the newest',
  'atlas-order-flipped': 'ATLAS numeric birth dates read in the other order',
  'unconverted-amounts': 'balances copied without currency conversion',
  'brightdesk-order-flipped': 'BRIGHTDESK numeric birth dates read in the other order',
  'vendex-order-flipped': 'VENDEX numeric dates read in the other order',
  'status-meaning-flipped': 'per-task extra status values read with the opposite meaning',
  'unknown-status-live': 'unknown status values treated as live',
  'mirror-ignored': 're-stamped mirror system not demoted in the conflict order',
  'perspective-ignored': 'every printed balance read as owed to us',
};
const lastExample = task => { const refs = refsOf(task.seed, task.split, task.difficulty); return refs[refs.length - 1]; };
// Calling code -> national trunk prefix to put back in front of the national number: "0" for most countries, "1" for North
// America (+1); none for Spain, Mexico, Denmark, Norway and Italy (whose leading 0 is part of the number and already in the truth).
const trunkOf = new Map([...new Set(Object.values(P.COUNTRIES).map(c => c.cc))]
  .map(cc => [cc, ({ 0: '0', nanp: '1' })[Object.values(P.COUNTRIES).find(c => c.cc === cc).trunk] ?? '']));
const keepTrunkPrefix = phone => {
  if (phone === null) return null;
  for (const [cc, trunk] of trunkOf) if (phone.startsWith(`+${cc}`)) return `+${cc}${trunk}${phone.slice(cc.length + 1)}`;
  return phone;
};

export const badControls = [
  ...rec.badControls.map(c => ({ ...c, why: WHY[c.name] ?? c.name, make: task => c.make(keyOf(task)) })),
  { name: 'plausible-but-wrong:copy-example-output', minDifficulty: 1,
    why: 'a well-formed answer that is the last example\'s master list, returned as if it were the new batch\'s',
    make: task => { const r = lastExample(task); return structuredClone(worldFor(r.seed, r.split, r.difficulty).truth); } },
  { name: 'plausible-but-wrong:example-rates-reused', minDifficulty: 1,
    why: 'everything right except that the first example\'s rate sheet is used instead of the new batch\'s own',
    make: task => {
      const w = worldFor(task.seed, task.split, task.difficulty);
      const r = refsOf(task.seed, task.split, task.difficulty)[0];
      return ruleSolve(w.rows.map(x => x.s), worldFor(r.seed, r.split, r.difficulty).fx);
    } },
  { name: 'plausible-but-wrong:trunk-prefix-kept', minDifficulty: 1,
    why: 'everything right except that the national trunk prefix (0, or 1 in North America) stays in front of the national number after the country code',
    make: task => {
      const truth = structuredClone(worldFor(task.seed, task.split, task.difficulty).truth);
      for (const r of truth.records) r.phone_e164 = keepTrunkPrefix(r.phone_e164);
      return truth;
    } },
];

// ---------------------------------------------------------------------------------------
// Host-side helpers. None of these is part of a task, and none may be shown to a solver.
/** The worlds of the solved examples of a task: [{seed, split, difficulty}] (records worlds; presentation order). */
export const exampleRefs = task => { checkArgs(task?.seed, task?.split, task?.difficulty); return refsOf(task.seed, task.split, task.difficulty); };
/**
 * The written records specification this task withholds (its identity, conflict, phone and USD rules, the calling-code table
 * and the nickname appendix). For a harness that answers a clarifying question or measures a "clarify" arm; never in a task.
 */
export function withheldSpec(task) {
  checkArgs(task?.seed, task?.split, task?.difficulty);
  return worldFor(task.seed, task.split, task.difficulty).spec;
}
/** The records task this one pairs with: same seed, split and difficulty, so the same batch, the same truth, with its spec and no examples. */
export const pairedRecordsTask = task => { checkArgs(task?.seed, task?.split, task?.difficulty); return rec.generate(keyOf(task)); };
/** Estimated input tokens of a task: tokens of the prompt plus tokens of the inputs (UTF-8 bytes / 4), the records README's method. */
export const inputTokens = task => estimateTokens(task.prompt) + estimateTokens(task.inputs);
