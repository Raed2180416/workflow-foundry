// W-bed rung R4 "group consolidation" (family wbed-r4): a nested sub-workflow (W-BED §3.4). Interface per
// beds/CONTRACT.md v1 plus the W-specific exports `stages`, `structure`, `relations`, `composedOracle`, `referenceTrace`
// and the R4-specific `childrenOf`, `childTask` and `scoreReuse`. The hidden truth is recomputed from (seed, split,
// difficulty); each pack's truth from its child seed by its own rung (R1 or R3). Nothing in the output but its value is
// read. R4 has no structure-necessity attack by design (W-BED §2.4 item 3: nesting never changes correctness); its value
// is construction cost through reuse, which the curriculum measures and `scoreReuse` scores.
import { buildGroup, buildChildren, childTruthTrace, setVerifier, LEVELS, MIN_D, MAX_D, VERSION } from './world.mjs';
import { runPipeline } from './pipeline.mjs';
import { outputSchema, scoreGroup } from './score.mjs';
import { CONTRACTS, RELATIONS, makeStages, composeOracle, reportLocal } from './stages.mjs';
import { CONTROL_DEFS, appliesAt } from './controls.mjs';
import { scoreReuseOf, packDigestOf, PLACEHOLDER_LIBRARY } from './reuse.mjs';
import { childSeedOf, CHILD_SEED_BASE, CHILD_SLOTS, PLANTED_STYLE, FAMILIES } from './children.mjs';
import { requireNoFaults, hooks } from '../lib/faults.mjs';
import { estimateTokens } from '../lib/prng.mjs';

export { outputSchema, CONTRACTS, RELATIONS, reportLocal, LEVELS, childSeedOf, CHILD_SEED_BASE, CHILD_SLOTS, PLANTED_STYLE, packDigestOf, PLACEHOLDER_LIBRARY };
export const version = VERSION;
// ATTACK-20261014 M1: output-invariance relations and the witness tag (host code, beside the oracle; never shown to arms).
export { invariance, witness, witnessOf, witnessCheck } from './invariance.mjs';

export const family = {
  id: 'wbed-r4',
  rung: 'R4',
  domain: 'back-office group consolidation',
  version: VERSION,
  kind: 'oneshot',
  description: 'Consolidate a fictional group of K subsidiaries (2/3/4/6 by difficulty) at a consolidation date. Each '
    + 'subsidiary\'s month-end pack is a complete earlier-rung task: a receivables close (W-bed R1) or, from difficulty 3, '
    + 'a supplier statement audit (W-bed R3), drawn with its own seed and its own systems and conventions; its result is '
    + 'reported unchanged and scored by its own rung\'s oracle. The parent translates each pack and each intercompany '
    + 'schedule into the group currency at stated closing rates (dated per pack from d4), pairs intercompany items '
    + '(same counterparties, currency and amount, and memos describing the same charge for the same period: decoys '
    + 'with equal amounts defeat amount-only matching), eliminates the pairs and reports consolidated receivables and '
    + 'payables. From difficulty 3 one or two receivables packs print one billing system\'s dates in a dialect no R1 '
    + 'task uses (the composition test: a reused R1 solver\'s profile should refuse them).',
};

export const difficulty = {
  min: MIN_D, max: MAX_D, default: 3, levels: LEVELS,
  drift: 'd -> d+1 adds subsidiaries (2/3/4/6), intercompany density (pairs, sibling, cross and disputed decoys), FX '
    + 'complexity (d3 CHF; d4 a dated rate table: packs at their own reporting date; d5 JPY schedules and CHF as a group '
    + 'currency) and the outside-profile plant (0/1/1/2 planted packs); buyer memos quote the seller\'s invoice number '
    + 'less often (80%/40%/20%/0%). Children run at d3 (parent d2-d3) or d4 (parent d4-d5), the difficulties R1/R3 streams cover. Streams switch '
    + 'from d3 to d4 at task 17 (W-BED §2.5).',
};

// ---------------------------------------------------------------------------------------------------------------------
const hostWorld = task => buildGroup(task.seed, task.split ?? 'dev', task.difficulty ?? 3);
// The truth report (no child traces: cheap) and the full reference trace (child traces too: analyst side) per world.
const reportCache = new WeakMap(), traceCache = new WeakMap();
function truthOf(task) {
  const w = hostWorld(task);
  if (!traceCache.has(w)) traceCache.set(w, runPipeline(w));
  return traceCache.get(w);
}
function truthReport(task) {
  const w = hostWorld(task);
  if (!reportCache.has(w)) reportCache.set(w, runPipeline(w, {}, { traces: false }).report);
  return reportCache.get(w);
}
const plantedTruthOf = sub => childTruthTrace(sub);
const inputsOf = w => ({
  subsidiaries: Object.fromEntries(w.subs.map(s => [s.id, { pack: s.pack, prompt: s.task.prompt, inputs: structuredClone(s.task.inputs) }])),
  register: w.render.register,
  intercompany: { ...w.render.intercompany },
  group_notes: w.render.group_notes,
  group_spec: w.render.group_spec,
});

export function generate({ seed, split = 'dev', difficulty: d = 3, faults } = {}) {
  requireNoFaults(faults);
  const w = hostWorld({ seed, split, difficulty: d });
  const inputs = hooks.adversarialContent(inputsOf(w)); // R8 f3 hook point (no-op in v1)
  return {
    id: `wbed-r4:${split}:d${d}:${seed}`,
    family: family.id,
    seed, split, difficulty: d,
    prompt: w.render.prompt,
    inputs,
    budget: { outputTokens: 600 + w.subs.reduce((a, s) => a + (s.task.budget?.outputTokens ?? 1000), 0) + 40 * w.items.length },
  };
}

export function oracle(task, output) { return scoreGroup(hostWorld(task), truthReport(task), output); }
export function referenceSolve(task) { return structuredClone(truthReport(task)); }

// ---------------------------------------------------------------------------------------------------------------------
export const badControls = CONTROL_DEFS.map(def => {
  const base = { name: def.name, kind: def.kind, why: def.why ?? null, ...(def.minDifficulty ? { minDifficulty: def.minDifficulty } : {}) };
  if (def.make) return { ...base, make: task => def.make(hostWorld(task)) };
  return { ...base, opts: def.opts, make: task => runPipeline(hostWorld(task), def.opts, { traces: false }).report, trace: task => runPipeline(hostWorld(task), def.opts) };
});

// Decisiveness: every applicable control must fail on every generated task, else the group layer is re-drawn.
setVerifier(world => {
  const truth = runPipeline(world, {}, { traces: false }).report;
  for (const def of CONTROL_DEFS) {
    if (!appliesAt(def, world.spec.difficulty)) continue;
    const out = def.make ? def.make(world) : runPipeline(world, def.opts, { traces: false }).report;
    if (scoreGroup(world, truth, out).pass) return def.name;
  }
  return null;
});

// ---------------------------------------------------------------------------------------------------------------------
// W-specific exports (W-BED §2.1).
export const stages = makeStages(truthOf, hostWorld, task => structuredClone(generate(task).inputs));
export const relations = RELATIONS;
/** Every child's composed oracle (its own rung's stages and relations), the parent stage oracles and W1-W4. */
export const composedOracle = (task, trace) => composeOracle(stages, task, trace, hostWorld(task), plantedTruthOf);
/** The exact solver's trace (analyst side only): { children: [{sub_id, family, output, trace}], translate, pair, eliminate, report }. */
export const referenceTrace = task => structuredClone(truthOf(task));

/** Hidden truth about the packs (analyst side): child seeds, rung, and which packs are outside the R1 profile. */
export const childrenOf = task => buildChildren({ seed: task.seed, split: task.split ?? 'dev', difficulty: task.difficulty ?? 3 })
  .map(c => ({ sub_id: c.id, family: c.family, pack: c.pack, seed: c.spec.seed, split: c.spec.split, difficulty: c.spec.difficulty,
    outsideProfile: c.outsideProfile, planted: c.planted ? { ...c.planted } : null }));
/** The child task of one pack, as its own rung scores it (planted packs carry the re-rendered inputs). */
export const childTask = (task, subId) => {
  const c = buildChildren({ seed: task.seed, split: task.split ?? 'dev', difficulty: task.difficulty ?? 3 }).find(x => x.id === subId);
  return c ? structuredClone(c.task) : null;
};
/** The four reuse quantities and the wrong-reuse rate over a run's child calls (reuse.mjs). */
export const scoreReuse = (task, callLog, opts = {}) => scoreReuseOf(
  buildChildren({ seed: task.seed, split: task.split ?? 'dev', difficulty: task.difficulty ?? 3 }).map(c => ({ sub_id: c.id, family: c.family, outsideProfile: c.outsideProfile, task: c.task, output: c.output })),
  callLog, opts);

// Mined invariants (W-BED §2.2 item 3): analyst-side "free verifier" candidates. No system component sees them.
export const invariants = [
  { id: 'G1-group-conservation', scope: 'report', text: 'sum of gross receivables (payables) over subsidiaries = consolidated + eliminated' },
  { id: 'G2-elimination-symmetry', scope: 'report', text: 'every elimination removes one receivable and one payable item; no item twice; eliminated = sum of rows' },
  { id: 'G3-pack-carried', scope: 'report', text: 'each pack report passes its own rung\'s invariants (R1 L1-L3, X1-X3; R3 A1-A2, Z1-Z4)' },
  ...RELATIONS.map(x => ({ id: x.id, scope: x.stages.join('+'), text: x.text })),
];

// The best-known solution's structure (W-BED §6.3), declared by the bed author. Descriptive only.
export const structure = {
  rung: 'R4', shape: 'nested-sub-workflow',
  stages: ['children', 'translate', 'pair', 'eliminate', 'report'],
  features: { maxCallDepth: 2, callSites: 1, mapSites: 1, maxFanOut: 6, agentNodes: 0, wideNodes: 0, judgedBranchPoints: 1,
    judges: ['intercompany pair per amount-matched candidate (same counterparties, currency and amount): do the two memos describe the same charge for the same period? (schema {same, quote_receivable, quote_payable}; check: both quotes occur in the schedules)'],
    library: { R1_REF_HASH: 'the frozen arm (c) reference of wbed-r1 (by hash)', R3_REF_HASH: 'the frozen arm (c) reference of wbed-r3 (by hash; itself calls R1 parsers, so depth 2)' } },
  outline: [
    'map(subsidiaries, s => flow.call(s.pack === "receivables-close" ? R1_REF_HASH : R3_REF_HASH, s.inputs, { name: s.id, budgetUsd, onRefuse: "value" }))',
    '  refused (outside-profile: a date dialect the R1 solver never saw): solve that pack without the library solver, or rewrite the dialect and call again',
    'step translate (pack totals at the pack reporting-date rate from d4; intercompany per currency at the consolidation-date rate)',
    'step candidates (same counterparties, currency and amount)',
    'judge intercompany per candidate on the two memos (same charge, same period)',
    'step eliminate (one row per pair, receivable amount at the consolidation-date rate)',
    'invariant conservation (gross = consolidated + eliminated on both sides; eliminations and packs carried unchanged)',
    'done',
  ],
};

/** Rough input size of a task in tokens (utf8 bytes / 4), for cost planning. */
export const taskTokens = task => estimateTokens(task.prompt) + estimateTokens(JSON.stringify(task.inputs));
/** Size facts (analyst side). */
export function sizeOf(task) {
  const w = hostWorld(task);
  const packTokens = Object.fromEntries(w.subs.map(s => [s.id, estimateTokens(s.task.prompt) + estimateTokens(JSON.stringify(s.task.inputs))]));
  const parentOnly = estimateTokens(w.render.prompt) + estimateTokens(JSON.stringify({ register: w.render.register, intercompany: w.render.intercompany, group_notes: w.render.group_notes, group_spec: w.render.group_spec }));
  return { subsidiaries: w.subs.length, r1: w.subs.filter(s => s.family === 'wbed-r1').length, r3: w.subs.filter(s => s.family === 'wbed-r3').length,
    planted: w.subs.filter(s => s.planted).length, items: w.items.length, pairs: w.pairs.length, packTokens, parentOnlyTokens: parentOnly };
}
export { FAMILIES };
