// `need-qa` bed ("qa-anchors"): short exact-match questions a single model call is hypothesised to answer.
// Routing anchor for the need router (experiments/need-router), not a Tier-A bed. See README.md for the knobs,
// the answer comparison and the hypothesis. Trusted host code: solvers never see the oracle or the reference solver.
import { rng, hashSeed } from '../lib/rng.mjs';
import { SUBTYPES, schemaErrors, compareAnswer, answerOf, normText, numberTokens } from './core.mjs';
import { buildLedger } from './sub-ledger.mjs';
import { buildLookup } from './sub-lookup.mjs';
import { buildCalendar } from './sub-calendar.mjs';
import { buildConvert } from './sub-convert.mjs';

export { SUBTYPES };
export const VERSION = '1.0.0';

export const family = {
  id: 'need-qa',
  domain: 'routing anchors: short exact-match QA over small generated data (table sums, two-table lookups, fictional-calendar dates, unit conversion)',
  version: VERSION,
  kind: 'oneshot',
  role: 'need-anchor',
  description: 'One short exact-match question over a small generated table, pair of joined tables, fictional calendar or set of stated conversion factors. Hypothesis (not a fact): one model call suffices at every difficulty. Difficulty scales rows and steps; optional size/steps overrides pull length and structure apart.',
};

export const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: { answer: { type: ['string', 'number'], maxLength: 80 } },
};

const BUILDERS = { ledger: buildLedger, lookup: buildLookup, calendar: buildCalendar, convert: buildConvert };
const MAX_ATTEMPTS = 400;

/** The subtype of a seed. Seeds are dealt in blocks of four consecutive integers, each block a seeded permutation of the four subtypes. */
export function subtypeOf(seed, split = 'dev') {
  const n = Number.isSafeInteger(seed) ? seed : hashSeed(seed);
  return rng('need-qa', 'subtype', split, Math.floor(n / 4)).shuffle(SUBTYPES)[((n % 4) + 4) % 4];
}

const isLevel = x => Number.isInteger(x) && x >= 1 && x <= 5;
function checkArgs({ seed, split, difficulty, size, steps }) {
  if (!Number.isSafeInteger(seed) && typeof seed !== 'string') throw new Error('need-qa: seed must be an integer or string');
  if (split !== 'dev' && split !== 'test') throw new Error("need-qa: split must be 'dev' or 'test'");
  if (!isLevel(difficulty)) throw new Error('need-qa: difficulty must be an integer 1..5');
  if (size !== undefined && !isLevel(size)) throw new Error('need-qa: size must be an integer 1..5');
  if (steps !== undefined && !isLevel(steps)) throw new Error('need-qa: steps must be an integer 1..5');
}

// A generated case is rejected (and redrawn) unless it is well posed: a nonzero truth, near misses and alternatives that really
// differ under the oracle's own comparison, and no derived answer that already appears as a number or date in the visible text.
function acceptable(c) {
  const { truth } = c;
  if ((truth.kind === 'int' || truth.kind === 'round') && Number(truth.value) === 0) return false;
  if (!c.near.length) return false;
  for (const x of [...c.near.map(n => n.truth), ...c.alternatives]) if (compareAnswer(answerOf(x), truth).ok) return false;
  const visible = `${c.prompt}\n${JSON.stringify(c.inputs)}`;
  if (truth.kind === 'text') {
    if (!c.alternatives.length) return false;
    if (!c.allowTextInPrompt && normText(c.prompt).includes(normText(truth.value))) return false;
  }
  if (c.derived && (truth.kind === 'int' || truth.kind === 'round')) {
    const n = Number(truth.value);
    if ((!Number.isInteger(n) || Math.abs(n) >= 100) && numberTokens(visible).has(String(n))) return false;
  }
  if (c.derived && truth.kind === 'date' && visible.toLowerCase().includes(truth.value.toLowerCase())) return false;
  return true;
}

/** Build the task and its hidden truth. Pure function of (seed, split, difficulty, size, steps). */
function buildCase({ seed, split = 'dev', difficulty = 3, size, steps }) {
  checkArgs({ seed, split, difficulty, size, steps });
  const knobs = { size: size ?? difficulty, steps: steps ?? difficulty };
  const subtype = subtypeOf(seed, split);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const r = rng('need-qa', split, seed, difficulty, knobs.size, knobs.steps, subtype, attempt);
    const c = BUILDERS[subtype](r, knobs);
    if (c && acceptable(c)) return { ...c, subtype, knobs, attempts: attempt + 1, split, difficulty, seed };
  }
  throw new Error(`need-qa: no well-posed ${subtype} case for seed ${seed} (generator bug)`);
}

export function generate({ seed, split = 'dev', difficulty = 3, size, steps } = {}) {
  const c = buildCase({ seed, split, difficulty, size, steps });
  const overridden = c.knobs.size !== difficulty || c.knobs.steps !== difficulty;
  const tokens = Math.ceil(Buffer.byteLength(JSON.stringify(c.inputs) + c.prompt) / 4);
  const task = {
    id: `need-qa/${split}/d${difficulty}/${seed}${overridden ? `/size${c.knobs.size}-steps${c.knobs.steps}` : ''}`,
    family: family.id,
    seed, split, difficulty,
    prompt: c.prompt,
    inputs: c.inputs,
    budget: { inputTokensEstimate: tokens, suggestedOutputTokens: 40 },
  };
  if (overridden) task.knobs = { size: c.knobs.size, steps: c.knobs.steps };
  return task;
}

// The oracle recomputes everything from (seed, split, difficulty, knobs); the prompt, inputs and budget of the task object are never trusted.
const caseOf = task => buildCase({ seed: task.seed, split: task.split, difficulty: task.difficulty, size: task.knobs?.size, steps: task.knobs?.steps });

export function oracle(task, output) {
  const errors = schemaErrors(outputSchema, output);
  if (errors.length) return { pass: false, score: 0, details: { schemaErrors: errors.slice(0, 10) } };
  const c = caseOf(task);
  const verdict = compareAnswer(output.answer, c.truth);
  return { pass: verdict.ok, score: verdict.ok ? 1 : 0, details: { subtype: c.subtype, kind: c.truth.kind, size: c.knobs.size, steps: c.knobs.steps, reason: verdict.reason, normalized: verdict.normalized } };
}

/** Known-good control: the exact truth (trusted host code; solvers never get this). */
export function referenceSolve(task) { return { answer: answerOf(caseOf(task).truth) }; }

// ---- bad controls: each must fail the oracle for every task ----
function corrupt(truth) {
  if (truth.kind === 'int' || truth.kind === 'round') {
    const digits = truth.value.replace('.', '');
    const rotated = digits.slice(1) + digits[0];
    const text = truth.value.includes('.') ? `${rotated.slice(0, truth.value.indexOf('.'))}.${rotated.slice(truth.value.indexOf('.'))}` : rotated;
    return text === truth.value ? Number(truth.value) + 17 : Number(text);
  }
  const reversed = [...truth.value].reverse().join('');
  return reversed === truth.value ? `${truth.value}x` : reversed;
}
function offByOne(c) {
  const t = c.truth;
  if (t.kind === 'int') return Number(t.value) + 1;
  if (t.kind === 'round') return Number(t.value) + 10 ** -t.dp;
  if (t.kind === 'date') { const [, month, day, year] = /^(\S+) (\d+), year (\d+)$/.exec(t.value); return `${month} ${Number(day) + 1}, year ${year}`; }
  return c.alternatives[0].value;
}
function constantGuess(c) {
  const t = c.truth;
  if (t.kind === 'int' || t.kind === 'round') return 0;
  if (t.kind === 'date') return `${/^(\S+) /.exec(t.value)[1]} 1, year 1`;
  return c.alternatives[c.alternatives.length - 1].value;
}

export const badControls = [
  { name: 'empty', make: () => ({ answer: '' }) },
  { name: 'shuffled-or-corrupted', make: task => ({ answer: corrupt(caseOf(task).truth) }) },
  { name: 'plausible-but-wrong:first-near-miss', make: task => ({ answer: answerOf(caseOf(task).near[0].truth) }) },
  { name: 'plausible-but-wrong:last-near-miss', make: task => { const c = caseOf(task); return { answer: answerOf(c.near[c.near.length - 1].truth) }; } },
  { name: 'plausible-but-wrong:off-by-one', make: task => ({ answer: offByOne(caseOf(task)) }) },
  { name: 'constant-guess', make: task => ({ answer: constantGuess(caseOf(task)) }) },
];

/** Analysis helper (not part of the contract): subtype, knobs and the names of the near misses of a task, kept off the task itself. */
export function describeTask(task) {
  const c = caseOf(task);
  return { subtype: c.subtype, size: c.knobs.size, steps: c.knobs.steps, kind: c.truth.kind, derived: c.derived, nearMisses: c.near.map(n => n.name), attempts: c.attempts };
}
