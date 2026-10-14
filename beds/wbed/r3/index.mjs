// W-bed rung R3 "statement audit" (family wbed-r3): fan-out / fan-in (W-BED §3.3). Interface per beds/CONTRACT.md v1
// plus the W-specific exports `stages`, `structure`, `relations`, `composedOracle` and `necessityControls`.
import { buildAudit, setVerifier, LEVELS, MIN_D, MAX_D, VERSION } from './world.mjs';
import { runPipeline } from './pipeline.mjs';
import { outputSchema, scoreAudit } from './score.mjs';
import { CONTRACTS, RELATIONS, makeStages, composeOracle, reduceLocal } from './stages.mjs';
import { CONTROL_DEFS, NECESSITY_DEFS, SEQUENTIAL_BUDGET_TOKENS, appliesAt } from './controls.mjs';
import { requireNoFaults, hooks } from '../lib/faults.mjs';
import { estimateTokens } from '../lib/prng.mjs';

export { outputSchema, CONTRACTS, RELATIONS, reduceLocal, LEVELS, SEQUENTIAL_BUDGET_TOKENS };
export const version = VERSION;
// ATTACK-20261014 M1: output-invariance relations and the witness tag (host code, beside the oracle; never shown to arms).
export { invariance, witness, witnessOf, witnessCheck } from './invariance.mjs';

export const family = {
  id: 'wbed-r3',
  rung: 'R3',
  domain: 'back-office supplier statement audit',
  version: VERSION,
  kind: 'oneshot',
  description: 'Audit N supplier statements (8/16/32/48 by difficulty) of a fictional group against its accounts payable '
    + 'ledger at month end. Each supplier prints its statement from one of the back office\'s billing systems (R1\'s date '
    + 'and number dialects; credits with a CR suffix from d4); our ledger names some suppliers by other names. Per '
    + 'supplier: match documents by reference, classify each difference as TIMING, PRICE, FX, DUPLICATE, MISSING_CREDIT or '
    + 'UNEXPLAINED (only the cover notes and AP notes decide PRICE, FX and MISSING_CREDIT), compute the adjusted balance. '
    + 'Fan-in: per-reason counts and US-cent totals by a stated per-supplier conversion rule. The best-known solution is a '
    + 'map over suppliers with a code reducer; at d4-d5 the inline task is 40-70K tokens.',
};

export const difficulty = {
  min: MIN_D, max: MAX_D, default: 3, levels: LEVELS,
  drift: 'd -> d+1 adds suppliers (8/16/32/48, the fan-out width) and statement lines; d3 adds ATLAS (date order per '
    + 'task), the FX reason and ledger lines under other supplier names; d4 adds TALLY (DD-MM-YY) and statements that '
    + 'print credits with a CR suffix; d5 adds KOBO (yen) and VENDEX (statements in sentences). Streams switch from d3 to '
    + 'd4 at task 17 (W-BED §2.5).',
};

// ---------------------------------------------------------------------------------------------------------------------
const hostWorld = task => buildAudit(task.seed, task.split ?? 'dev', task.difficulty ?? 3);
const traceCache = new WeakMap();
function truthOf(task) {
  const w = hostWorld(task);
  if (!traceCache.has(w)) traceCache.set(w, runPipeline(w));
  return traceCache.get(w);
}
const inputsOf = w => ({ statements: { ...w.render.statements }, ledger: w.render.ledger, vendors: w.render.vendors, ap_notes: w.render.apNotes, audit_spec: w.render.auditSpec });

export function generate({ seed, split = 'dev', difficulty: d = 3, faults } = {}) {
  requireNoFaults(faults);
  const w = hostWorld({ seed, split, difficulty: d });
  const inputs = hooks.adversarialContent(inputsOf(w)); // R8 f3 hook point (no-op in v1)
  return {
    id: `wbed-r3:${split}:d${d}:${seed}`,
    family: family.id,
    seed, split, difficulty: d,
    prompt: w.render.prompt,
    inputs,
    budget: { outputTokens: 400 + w.vendors.length * 120 },
  };
}

export function oracle(task, output) { return scoreAudit(truthOf(task).reduce, output); }
export function referenceSolve(task) { return structuredClone(truthOf(task).reduce); }

// ---------------------------------------------------------------------------------------------------------------------
function corrupt(out) {
  const o = structuredClone(out);
  const n = o.statements.length, vals = o.statements.map(s => s.adjusted_balance_minor);
  o.statements.forEach((s, i) => { s.adjusted_balance_minor = vals[(i + 1) % n]; });
  return o;
}
/** Suppliers a single context skims: those whose statement ends past the budget, in input order. */
export function skimmedBy(world, budget = SEQUENTIAL_BUDGET_TOKENS) {
  let used = world.render.fixedTokens;
  const skim = new Set();
  for (const id of world.render.order) { used += world.render.itemTokens.get(id); if (used > budget) skim.add(id); }
  return skim;
}
const optsOf = (def, world) => (def.sequential ? { skim: skimmedBy(world) } : def.opts);
const asControl = def => {
  const base = { name: def.name, kind: def.kind, why: def.why ?? null, ...(def.minDifficulty ? { minDifficulty: def.minDifficulty } : {}) };
  if (def.make) return { ...base, make: def.make };
  if (def.corrupt) return { ...base, make: task => corrupt(truthOf(task).reduce) };
  return { ...base, opts: def.opts ?? null,
    make: task => { const w = hostWorld(task); return runPipeline(w, optsOf(def, w)).reduce; },
    trace: task => { const w = hostWorld(task); return runPipeline(w, optsOf(def, w)); } };
};
export const badControls = CONTROL_DEFS.map(asControl);
export const necessityControls = NECESSITY_DEFS.map(asControl);

setVerifier(world => {
  const truth = runPipeline(world).reduce;
  for (const def of [...CONTROL_DEFS, ...NECESSITY_DEFS]) {
    if (!appliesAt(def, world.spec.difficulty)) continue;
    const out = def.make ? def.make() : def.corrupt ? corrupt(truth) : runPipeline(world, optsOf(def, world)).reduce;
    if (scoreAudit(truth, out).pass) return def.name;
  }
  return null;
});

// ---------------------------------------------------------------------------------------------------------------------
export const stages = makeStages(truthOf, task => structuredClone(generate(task).inputs));
export const relations = RELATIONS;
export const composedOracle = (task, trace) => composeOracle(stages, task, trace, hostWorld(task));
export const referenceTrace = task => structuredClone(truthOf(task));

export const invariants = [
  { id: 'A1-by-reason-complete', scope: 'reduce', text: 'by_reason lists all six codes once; counts agree with the listed discrepancies' },
  { id: 'A2-totals-sum', scope: 'reduce', text: 'totals are the sums of by_reason; totals.statements counts the suppliers' },
  ...RELATIONS.map(x => ({ id: x.id, scope: x.stages.join('+'), text: x.text })),
];

/** Size facts (analyst side): inline tokens, fixed overhead and per-item tokens. */
export function sizeOf(task) {
  const w = hostWorld(task);
  const items = [...w.render.itemTokens.values()];
  return { statements: w.vendors.length, fixedTokens: w.render.fixedTokens, itemTokensMean: Math.round(items.reduce((a, b) => a + b, 0) / items.length),
    statementLines: w.vendors.reduce((s, v) => s + v.stmt.length, 0), ledgerLines: w.ledger.length,
    discrepancies: truthOf(task).reduce.totals.discrepancies, skimmed: skimmedBy(w).size };
}

export const structure = {
  rung: 'R3', shape: 'fan-out-fan-in',
  stages: ['split', 'match', 'classify', 'reduce'],
  features: { maxCallDepth: 1, callSites: 1, mapSites: 1, maxFanOut: 48, agentNodes: 0, wideNodes: 0, judgedBranchPoints: 0,
    judges: ['reason code per discrepancy (enum + quoted note sentence; check: the quote occurs in the cover note or the AP notes, or is empty for TIMING / DUPLICATE / UNEXPLAINED)'] },
  outline: [
    'step split the AP ledger by supplier (names and other names from inputs.vendors)',
    'map(statements, { concurrency: 8 }) of:',
    '  call the R1 statement parser/normaliser for the supplier\'s billing system (dates by convention, numbers by locale, CR suffix) -- by hash in the curriculum arm',
    '  step match statement and ledger by reference key and kind -> differences with counts and dates',
    '  step rule-decide DUPLICATE and TIMING (counts, cut-off date)',
    '  judge per remaining difference: PRICE / FX / MISSING_CREDIT / UNEXPLAINED with the quoted note',
    '  step adjusted balance = ledger + accepted',
    'step reduce (code): per supplier per reason sum, convert once, add; counts; totals',
    'invariant Z1 item conservation (statement - ledger = sum of discrepancies), Z3 fan-in conservation, Z4 coverage',
    'done',
  ],
};

export const taskTokens = task => estimateTokens(task.prompt) + estimateTokens(JSON.stringify(task.inputs));
