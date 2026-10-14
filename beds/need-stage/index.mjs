// `need-stage` bed: single-stage tasks with a workflow-like surface. Routing anchor for the need router
// (experiments/need-router), not a Tier-A bed. One task is ONE stage of a W-bed rung (R1 normalise, R2 route, R3
// classify, R6 worker) applied to ONE item of that rung's own world, with the rung's own rules text. See README.md for
// the knobs, the stage truths, the controls and the class hypothesis. Trusted host code: solvers never see the oracle,
// the reference solver or the rung's hidden world.
import { rng, hashSeed } from '../lib/rng.mjs';
import { estimateTokens } from '../lib/canonical.mjs';
import * as R1 from './stage-r1.mjs';
import * as R2 from './stage-r2.mjs';
import * as R3 from './stage-r3.mjs';
import * as R6 from './stage-r6.mjs';
import { str, int, bool } from './common.mjs';

export const VERSION = '1.0.0';
export const STAGES = Object.freeze(['r1-normalise', 'r2-route', 'r3-classify', 'r6-worker']);
const MOD = { 'r1-normalise': R1, 'r2-route': R2, 'r3-classify': R3, 'r6-worker': R6 };

export const family = {
  id: 'need-stage',
  domain: 'routing anchors: one stage of a W-bed back-office / research rung on one item (normalise one invoice list, route one e-mail, classify one statement discrepancy, one research-table worker)',
  version: VERSION,
  kind: 'oneshot',
  role: 'need-anchor',
  description: 'Single-stage tasks with a workflow-like surface: ONE stage of a W-bed rung (R1 normalise, R2 route, R3 classify, R6 worker) on ONE item of the rung\'s own seeded world, with the rung\'s own rules text and document dialects, so the task looks procedural but needs no multi-step workflow. Hypothesis (not a fact): one model call, or at most a plain agent, suffices. Difficulty picks the rung difficulty (d1-d2 use rung d2) and the item\'s ambiguity from the rung\'s own planted cases.',
};

/** Per-kind output schemas (each closed at the top level). The oracle validates the task's own kind. */
export const stageSchemas = Object.freeze({ 'r1-normalise': R1.schema, 'r2-route': R2.schema, 'r3-classify': R3.schema, 'r6-worker': R6.schema });

/** Family-level envelope: the union of the per-kind fields (portable subset). The oracle applies the kind's schema. */
export const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    invoices: R1.schema.properties.invoices,
    doc: int, kind: R2.schema.properties.kind,
    reason: R3.schema.properties.reason, ref: str(60),
    entity: str(80), in_scope: bool, cells: R6.schema.properties.cells, void_doc_ids: R6.schema.properties.void_doc_ids,
  },
};

/** Rung difficulty used at each need-stage difficulty (the W-bed rungs start at d2). */
export const RUNG_DIFFICULTY = Object.freeze({ 1: 2, 2: 2, 3: 3, 4: 4, 5: 5 });

/** The stage kind of a seed. Seeds are dealt in blocks of four consecutive integers, each block a seeded permutation of
 *  the four kinds; the kind does not depend on the difficulty. */
export function stageOf(seed, split = 'dev') {
  const n = Number.isSafeInteger(seed) ? seed : hashSeed(seed);
  return rng('need-stage', 'stage', split, Math.floor(n / 4)).shuffle(STAGES)[((n % 4) + 4) % 4];
}

function checkArgs({ seed, split, difficulty, stage }) {
  if (!Number.isSafeInteger(seed) && typeof seed !== 'string') throw new Error('need-stage: seed must be an integer or string');
  if (split !== 'dev' && split !== 'test') throw new Error("need-stage: split must be 'dev' or 'test'");
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new Error('need-stage: difficulty must be an integer 1..5');
  if (stage !== undefined && !STAGES.includes(stage)) throw new Error(`need-stage: stage must be one of ${STAGES.join(', ')}`);
}

// Memo of built cases (pure function of the arguments); callers get clones.
const cache = new Map();
function buildCase({ seed, split = 'dev', difficulty = 3, stage }) {
  checkArgs({ seed, split, difficulty, stage });
  const kind = stage ?? stageOf(seed, split);
  const key = JSON.stringify([seed, split, difficulty, kind]);
  if (cache.has(key)) return cache.get(key);
  const rungDifficulty = RUNG_DIFFICULTY[difficulty];
  const r = rng('need-stage', kind, 'item', split, seed, difficulty);
  const c = { kind, rungDifficulty, seed, split, difficulty, ...MOD[kind].build({ seed, split, rungDifficulty, difficulty, r }) };
  cache.set(key, c);
  if (cache.size > 256) cache.delete(cache.keys().next().value);
  return c;
}
const caseOf = task => buildCase({ seed: task.seed, split: task.split, difficulty: task.difficulty, stage: task.knobs?.stage });

export function generate({ seed, split = 'dev', difficulty = 3, stage } = {}) {
  const c = buildCase({ seed, split, difficulty, stage });
  const overridden = stage !== undefined && stage !== stageOf(seed, split);
  const tokens = estimateTokens(c.prompt) + estimateTokens(JSON.stringify(c.inputs)) + Object.values(c.files ?? {}).reduce((s, t) => s + estimateTokens(t), 0);
  const task = {
    id: `need-stage/${split}/d${difficulty}/${seed}${overridden ? `/${c.kind}` : ''}`,
    family: family.id,
    seed, split, difficulty,
    prompt: c.prompt,
    inputs: structuredClone(c.inputs),
    ...(c.files ? { files: { ...c.files } } : {}),
    budget: { inputTokensEstimate: tokens, ...c.budget },
  };
  if (overridden) task.knobs = { stage: c.kind };
  return task;
}

/** The output schema of a task's own kind (for harnesses that want the strict per-task schema). */
export const outputSchemaOf = task => stageSchemas[caseOf(task).kind];

// The oracle recomputes everything from (seed, split, difficulty, knobs.stage); the prompt, inputs and files of the task
// object are never trusted, nor anything in the output beyond its value.
export function oracle(task, output) {
  const c = caseOf(task);
  const res = MOD[c.kind].score(c.truth, output, c.props);
  return { pass: res.pass, score: res.score, details: { stage: c.kind, ...res.details } };
}

/** Known-good control: the stage truth (trusted host code; solvers never get this). */
export function referenceSolve(task) { return structuredClone(caseOf(task).truth); }

// ---- bad controls: each must fail the oracle for every task ----
export const badControls = [
  { name: 'empty', why: 'no answer: {} (R1: {"invoices":[]})', make: task => MOD[caseOf(task).kind].empty() },
  { name: 'shuffled-or-corrupted', why: 'R1 US cents rotated by one invoice; R2/R3 the next route / reason code; R6 values scaled and sources rotated (or scope flipped)',
    make: task => { const c = caseOf(task); return MOD[c.kind].corrupt(c.truth); } },
  { name: 'plausible-but-wrong', why: 'the item\'s first planted near miss: the rung\'s own most relevant mistake that changes this item\'s answer (describeTask names it)',
    make: task => structuredClone(caseOf(task).near[0].output) },
  { name: 'plausible-but-wrong:last-near-miss', why: 'the item\'s last distinct planted near miss (the same as the first when the item has only one)',
    make: task => { const c = caseOf(task); return structuredClone(c.near[c.near.length - 1].output); } },
  { name: 'answer-for-another-item', why: 'the right stage applied to the wrong item of the same rung world (another list, document, discrepancy or candidate) whose answer differs',
    make: task => structuredClone(caseOf(task).wrongItem) },
];

/** Analysis helper (not part of the contract): kind, rung task, item and near misses of a task, kept off the task. */
export function describeTask(task) {
  const c = caseOf(task);
  return { stage: c.kind, rungFamily: MOD[c.kind].rungFamily, rungDifficulty: c.rungDifficulty,
    rungTask: { seed: c.seed, split: c.split, difficulty: c.rungDifficulty }, rungRef: structuredClone(c.rungRef),
    item: structuredClone(c.meta), nearMisses: c.near.map(m => m.name) };
}

/** Surface baselines (analyst side, not controls): R2 the rung's keyword router, R3 counts and cut-off only. null for
 *  R1 and R6 (no rung baseline for one stage). Used by the tests to show difficulty moves item ambiguity. */
export function surfaceBaseline(task) {
  const kind = caseOf(task).kind;
  return MOD[kind].surfaceBaseline ? MOD[kind].surfaceBaseline(task) : null;
}
