// W-bed rung R1 "ledger close" (family wbed-r1): a linear multi-stage pipeline with typed hand-offs (W-BED §3.1).
// Interface per beds/CONTRACT.md v1 plus the W-specific exports `stages` and `structure` (W-BED §2.1). The hidden truth
// is recomputed from (seed, split, difficulty); nothing in the output but its value is read.
import { buildLedger, setVerifier, LEVELS, MIN_D, MAX_D, VERSION } from './world.mjs';
import { runPipeline, solveReport } from './pipeline.mjs';
import { outputSchema, scoreReport } from './score.mjs';
import { CONTRACTS, RELATIONS, makeStages, composeOracle, reportLocal } from './stages.mjs';
import { CONTROL_DEFS, appliesAt } from './controls.mjs';
import { requireNoFaults, hooks } from '../lib/faults.mjs';
import { estimateTokens } from '../lib/prng.mjs';

export { outputSchema, CONTRACTS, RELATIONS, reportLocal, LEVELS };
export const version = VERSION;

export const family = {
  id: 'wbed-r1',
  rung: 'R1',
  domain: 'back-office receivables close',
  version: VERSION,
  kind: 'oneshot',
  description: 'Close the receivables ledger of a fictional group as of a stated date: read a messy multi-system customer '
    + 'export (the records world: void markers, aliases, twins, per-task conventions) to find the real customers, parse '
    + 'each billing system\'s invoice list in its own dialect and date convention, read the bank feed (remittance advices, '
    + 'third-party payers, loose invoice references, unapplied cash), convert to US cents at stated quotes per document, '
    + 'and report invoiced / paid / open per customer with totals. The best-known solution is a typed linear pipeline '
    + 'extract -> normalise -> reconcile -> report. From difficulty 4 a new billing system with its own date order, an '
    + 'ATLAS date-format switch and per-task status words appear.',
};

export const difficulty = {
  min: MIN_D, max: MAX_D, default: 3, levels: LEVELS,
  customerLayer: 'records world at the same difficulty (records LEVELS: 55/85/115/150 rows; 4/6/6/6 systems)',
  drift: 'd -> d+1 adds what records d3 -> d4 adds (an ATLAS vendor switch in the customer export, more rows and traps) '
    + 'plus the ledger axis: d3 per-task ATLAS invoice date order, loose payment references, remit-only advices, unapplied '
    + 'cash; d4 the TALLY system (DD-MM-YY), an ATLAS invoice date-order switch on a stated day, one per-task status word '
    + 'with per-task meaning; d5 two status words of opposite meaning and more of every planted case. Streams switch from '
    + 'd3 to d4 at task 17 (W-BED §2.5).',
};

// ---------------------------------------------------------------------------------------------------------------------
const hostWorld = task => buildLedger(task.seed, task.split ?? 'dev', task.difficulty ?? 3);
const traceCache = new WeakMap();
function truthOf(task) {
  const w = hostWorld(task);
  if (!traceCache.has(w)) traceCache.set(w, runPipeline(w));
  return traceCache.get(w);
}
const inputsOf = w => ({
  customer_export: w.rw.exportText, customer_notes: w.rw.notes, customer_spec: w.rw.spec,
  invoices: { ...w.render.lists }, payments: w.render.payments, ledger_notes: w.render.notes, ledger_spec: w.render.spec,
});

export function generate({ seed, split = 'dev', difficulty: d = 3, faults } = {}) {
  requireNoFaults(faults);
  const w = hostWorld({ seed, split, difficulty: d });
  const inputs = hooks.adversarialContent(inputsOf(w)); // R8 f3 hook point (no-op in v1)
  return {
    id: `wbed-r1:${split}:d${d}:${seed}`,
    family: family.id,
    seed, split, difficulty: d,
    prompt: w.render.prompt,
    inputs,
    budget: { outputTokens: 400 + w.customers.length * 70 },
  };
}

export function oracle(task, output) {
  return scoreReport(truthOf(task).report, output);
}

export function referenceSolve(task) {
  return structuredClone(truthOf(task).report);
}

// ---------------------------------------------------------------------------------------------------------------------
// Bad controls. `make` gives the output; `trace` (pipeline controls) gives the control's full stage trace.
function corrupt(rep) {
  const out = structuredClone(rep);
  const n = out.customers.length, vals = out.customers.map(c => c.invoiced_usd_cents);
  out.customers.forEach((c, i) => { c.invoiced_usd_cents = vals[(i + 1) % n]; c.open_usd_cents = c.invoiced_usd_cents - c.paid_usd_cents; });
  out.totals.open_usd_cents = out.customers.reduce((s, c) => s + c.open_usd_cents, 0);
  return out;
}
export const badControls = CONTROL_DEFS.map(def => {
  const base = { name: def.name, kind: def.kind, why: def.why ?? null, ...(def.minDifficulty ? { minDifficulty: def.minDifficulty } : {}) };
  if (def.make) return { ...base, make: def.make };
  if (def.corrupt) return { ...base, make: task => corrupt(truthOf(task).report) };
  return { ...base, opts: def.opts, make: task => runPipeline(hostWorld(task), def.opts).report, trace: task => runPipeline(hostWorld(task), def.opts) };
});

// Decisiveness: every applicable control must fail on every generated task, else the generator re-draws the ledger.
setVerifier(world => {
  const truth = solveReport(world);
  for (const def of CONTROL_DEFS) {
    if (!appliesAt(def, world.spec.difficulty)) continue;
    const out = def.make ? def.make() : def.corrupt ? corrupt(truth) : solveReport(world, def.opts);
    if (scoreReport(truth, out).pass) return def.name;
  }
  return null;
});

// ---------------------------------------------------------------------------------------------------------------------
// W-specific exports (W-BED §2.1).
export const stages = makeStages(truthOf, task => structuredClone(generate(task).inputs));
export const relations = RELATIONS;
/** Stage oracles on a trace plus every cross-stage relation; agrees with `oracle` on the trace's report. */
export const composedOracle = (task, trace) => composeOracle(stages, task, trace);
/** The exact solver's trace (analyst side only). */
export const referenceTrace = task => structuredClone(truthOf(task));

// Mined invariants (W-BED §2.2 item 3): analyst-side "free verifier" candidates. No system component sees them.
export const invariants = [
  { id: 'L1-open-identity', scope: 'report', text: 'open = invoiced - paid for every customer' },
  { id: 'L2-totals-sum', scope: 'report', text: 'totals equal the sums over customers; totals.customers = number of entries' },
  { id: 'L3-partition', scope: 'report', text: 'no row id in two customers; customer_id = min(source_rows)' },
  ...RELATIONS.map(x => ({ id: x.id, scope: x.stages.join('+'), text: x.text })),
];

// The best-known solution's structure (W-BED §6.3), declared by the bed author. Descriptive only.
export const structure = {
  rung: 'R1', shape: 'linear-pipeline',
  stages: ['extract', 'normalise', 'reconcile', 'report'],
  features: { maxCallDepth: 0, callSites: 0, mapSites: 0, maxFanOut: 0, agentNodes: 0, wideNodes: 0, judgedBranchPoints: 0,
    judges: ['convention-note per billing system ({order, quote}; quote must be a substring of the notes)', 'identity borderline pairs (band around the name-match rule)'] },
  outline: [
    'step parse per system (customer export, each invoice list, bank feed)',
    'judge per system on the convention note',
    'step normalise (dates per convention, US cents per document, status and close date)',
    'step cluster customer rows with a borderline band; judge on band pairs',
    'step attach invoices by row and payments by invoice reference (PAY only, one per bank reference)',
    'invariant conservation (X1-X3) and report arithmetic (L1-L3)',
    'done',
  ],
};

/** Rough input size of a task in tokens (utf8 bytes / 4), for cost planning. */
export const taskTokens = task => estimateTokens(task.prompt) + estimateTokens(JSON.stringify(task.inputs));
