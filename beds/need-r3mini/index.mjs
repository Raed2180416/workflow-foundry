// `need-r3mini` bed: the W-bed R3 supplier-statement audit cut down to 2-3 statements. Routing anchor for the need
// router (experiments/need-router), not a Tier-A bed: the metamorphic partner of wbed-r3 (same rules text, same document
// dialects, same output form and the rung's own oracle semantics; only the number of statements differs). See README.md
// for the knob, the truth, the controls and the class HYPOTHESIS. Trusted host code: solvers never see the oracle, the
// reference solver or the rung's hidden world.
import { estimateTokens } from '../lib/canonical.mjs';
import { validate } from '../wbed/lib/contracts.mjs';
import { outputSchema as rungSchema, scoreAudit } from '../wbed/r3/score.mjs';
import { REASONS } from '../wbed/r3/vocab.mjs';
import {
  buildAudit, runPipeline, restricted, chooseCut, renderSubset, RUNG_DIFFICULTY, BANDS,
  MIN_SUPPLIERS, MAX_SUPPLIERS, MIN_DISCREPANCIES, MAX_DISCREPANCIES, TOKEN_CAP,
} from './mini.mjs';

export const VERSION = '1.0.0';
export { RUNG_DIFFICULTY, BANDS, TOKEN_CAP };

export const family = {
  id: 'need-r3mini',
  domain: 'routing anchor: a back-office supplier statement audit (W-bed R3) cut down to 2-3 statements',
  version: VERSION,
  kind: 'oneshot',
  role: 'need-anchor',
  description: 'The W-bed R3 audit with 2-3 supplier statements instead of 8-48 (metamorphic partner of wbed-r3: same rules text, '
    + 'statement dialects, reason codes decided from cover notes and AP notes, adjusted balances and USD fan-in totals, and the rung\'s own '
    + 'oracle semantics). The task looks like the fan-out/fan-in audit but has no fan-out. HYPOTHESIS, not a fact: one model call '
    + '(or at most a plain agent) should suffice; a router keyed on the audit surface or on the output shape would call it a workflow. '
    + 'Difficulty varies only the ambiguity of the 2-3 statements, and input stays under 3K tokens.',
};

/** Output schema (portable subset): the rung's, with 2-3 statements. */
export const outputSchema = (() => {
  const s = structuredClone(rungSchema);
  s.properties.statements.minItems = MIN_SUPPLIERS;
  s.properties.statements.maxItems = MAX_SUPPLIERS;
  return s;
})();

const snapshot = value => { try { return structuredClone(value); } catch { return undefined; } };
/** [] when `output` is plain data satisfying the family schema, else up to 8 error strings. */
function schemaErrors(output) {
  const v = snapshot(output);
  if (v === undefined) return ['$: not plain JSON-like data'];
  return validate(outputSchema, v).slice(0, 8);
}

function checkArgs({ seed, split, difficulty }) {
  if (!Number.isSafeInteger(seed) && typeof seed !== 'string') throw new Error('need-r3mini: seed must be an integer or string');
  if (split !== 'dev' && split !== 'test') throw new Error("need-r3mini: split must be 'dev' or 'test'");
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new Error('need-r3mini: difficulty must be an integer 1..5');
}

// Memo of built cases (a pure function of the arguments); callers get clones.
const cache = new Map();
function buildCase({ seed, split = 'dev', difficulty = 3 }) {
  checkArgs({ seed, split, difficulty });
  const key = JSON.stringify([seed, split, difficulty]);
  if (cache.has(key)) return cache.get(key);
  const rungDifficulty = RUNG_DIFFICULTY[difficulty];
  const world = buildAudit(seed, split, rungDifficulty);
  const full = runPipeline(world);
  const cut = chooseCut({ seed, split, difficulty, world, full, valid: o => schemaErrors(o).length === 0 });
  const c = { seed, split, difficulty, rungDifficulty, world, full, ...cut };
  cache.set(key, c);
  if (cache.size > 256) cache.delete(cache.keys().next().value);
  return c;
}
const caseOf = task => buildCase({ seed: task.seed, split: task.split, difficulty: task.difficulty });

/** The router's input-size formula: ceil(bytes / 4) of JSON.stringify(inputs) + files + prompt. */
export const inputTokens = task => estimateTokens(JSON.stringify(task.inputs ?? {}) + Object.values(task.files ?? {}).join('\n') + String(task.prompt ?? ''));

export function generate({ seed, split = 'dev', difficulty = 3 } = {}) {
  const c = buildCase({ seed, split, difficulty });
  const task = {
    id: `need-r3mini/${split}/d${difficulty}/${seed}`,
    family: family.id,
    seed, split, difficulty,
    prompt: c.rendered.prompt,
    inputs: structuredClone(c.rendered.inputs),
  };
  task.budget = { inputTokensEstimate: inputTokens(task), suggestedOutputTokens: 400 + 120 * c.k };
  return task;
}

// The oracle recomputes the truth from (seed, split, difficulty); the prompt, inputs and budget of the task object are
// never trusted, nor anything in the output beyond its value. Pass rule = the rung's (beds/wbed/r3/score.mjs scoreAudit):
// exact on the reduced result for the cut's suppliers: every supplier once with currency and the three balances in minor
// units; its discrepancies as a multiset of (reference by the matching rule, reason, amount); by_reason exact for all six
// codes; totals exact.
export function oracle(task, output) {
  const c = caseOf(task);
  const out = snapshot(output);
  const errors = out === undefined ? ['$: not plain JSON-like data'] : validate(outputSchema, out).slice(0, 8);
  if (errors.length) return { pass: false, score: 0, details: { reason: 'schema-invalid', errors } };
  return scoreAudit(c.truth, out);
}

/** Known-good control: the rung's own truth for the cut (trusted host code; solvers never get this). */
export function referenceSolve(task) { return structuredClone(caseOf(task).truth); }

// ---- bad controls: each must fail the oracle for every task ----
const zeroTotals = () => ({ statements: 0, discrepancies: 0, difference_usd_cents: 0, adjustments_usd_cents: 0 });
function otherSuppliers(c) {
  const rest = c.world.vendors.map(v => v.id).filter(id => !c.ids.includes(id));
  return rest.slice(0, c.k);
}
export const badControls = [
  { name: 'empty', why: 'no statements, no rows, zero totals',
    make: () => ({ statements: [], by_reason: [], totals: zeroTotals() }) },
  { name: 'shuffled-or-corrupted', why: 'right discrepancies and totals; the adjusted balances rotated by one supplier (a mis-joined report whose totals still tie out)',
    make: task => {
      const o = structuredClone(caseOf(task).truth);
      const vals = o.statements.map(s => s.adjusted_balance_minor), n = vals.length;
      o.statements.forEach((s, i) => { s.adjusted_balance_minor = vals[(i + 1) % n]; });
      return o;
    } },
  { name: 'plausible-but-wrong', why: 'the first of the rung\'s own plausible mistakes (wbed-r3 CONTROL_DEFS options, run on this cut) that changes this cut\'s answer',
    make: task => structuredClone(caseOf(task).near[0].output) },
  { name: 'plausible-but-wrong:last-near-miss', why: 'the last distinct such mistake (the same as the first when the cut has only one)',
    make: task => { const c = caseOf(task); return structuredClone(c.near[c.near.length - 1].output); } },
  { name: 'answer-for-other-suppliers', why: 'the right audit of other suppliers of the same world (attribution error)',
    make: task => { const c = caseOf(task); return structuredClone(restricted(c.world, otherSuppliers(c), {}, c.full).reduce); } },
  { name: 'balances-without-differences', why: 'both balances right and the adjusted balance set to the ledger balance, no discrepancies reported (a skim: statement closing balance and ledger sum without matching documents)',
    make: task => {
      const o = structuredClone(caseOf(task).truth);
      for (const s of o.statements) { s.adjusted_balance_minor = s.ledger_balance_minor; s.discrepancies = []; }
      o.by_reason = REASONS.map(reason => ({ reason, count: 0, usd_cents: 0 }));
      o.totals = { ...zeroTotals(), statements: o.statements.length };
      return o;
    } },
];

/** Analysis helper (not part of the contract): the rung task, the cut and its ambiguity. Kept off the task. */
export function describeTask(task) {
  const c = caseOf(task);
  return {
    rungFamily: 'wbed-r3', rungDifficulty: c.rungDifficulty, rungTask: { seed: c.seed, split: c.split, difficulty: c.rungDifficulty },
    suppliers: [...c.ids], k: c.k, discrepancies: c.D,
    ambiguity: { score: c.score, band: [...c.band], inBand: c.dist === 0,
      perSupplier: c.facts.map(f => ({ id: f.id, system: f.system, judgement: f.judgement, naming: f.naming, format: f.format, items: f.items.map(x => ({ variant: x.variant, score: x.score })) })) },
    nearMisses: c.near.map(m => m.name),
    inputTokens: inputTokens(generate(task)),
  };
}

/** The rung's trace for the cut (analyst side, for cross-checks): { split, match, classify, reduce } over the cut's suppliers. */
export function truthTrace(task) {
  const c = caseOf(task);
  return structuredClone(restricted(c.world, c.ids, {}, c.full));
}

export { MIN_SUPPLIERS, MAX_SUPPLIERS, MIN_DISCREPANCIES, MAX_DISCREPANCIES };
