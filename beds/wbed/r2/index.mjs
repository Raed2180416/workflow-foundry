// W-bed rung R2 "inbox router" (family wbed-r2): branching on judged conditions (W-BED §3.2). Interface per
// beds/CONTRACT.md v1 plus the W-specific exports `stages`, `structure`, `relations`, `composedOracle` and
// `necessityControls` (W-BED §2.1, §2.4 item 3). The hidden truth is recomputed from (seed, split, difficulty).
import { buildInbox, setVerifier, LEVELS, MIN_D, MAX_D, VERSION } from './world.mjs';
import { runPipeline, solveOutput } from './pipeline.mjs';
import { outputSchema, scoreInbox } from './score.mjs';
import { CONTRACTS, RELATIONS, makeStages, composeOracle, postLocal } from './stages.mjs';
import { CONTROL_DEFS, NECESSITY_DEFS, appliesAt } from './controls.mjs';
import { keywordRoute } from './keyword.mjs';
import { requireNoFaults, hooks } from '../lib/faults.mjs';
import { estimateTokens } from '../lib/prng.mjs';

export { outputSchema, CONTRACTS, RELATIONS, postLocal, LEVELS, keywordRoute };
export const version = VERSION;

export const family = {
  id: 'wbed-r2',
  rung: 'R2',
  domain: 'back-office accounts inbox',
  version: VERSION,
  kind: 'oneshot',
  description: 'Process one day of a fictional group\'s accounts inbox: 30-60 e-mails with attachment text from suppliers, '
    + 'customers and others. Route each document by what it is (invoice, credit note, remittance, dispute, statement '
    + 'request, bank-detail change, unrelated, injection), which the prose decides and keywords do not; send genuinely '
    + 'undecidable documents to review and nothing else; and apply the route\'s handling: post bills, post credits on the '
    + 'supplier bill a loose, mistyped or date-cited reference resolves to, allocate remittances by the stated rule, hold '
    + 'disputed invoices with a reason code, hold suppliers whose bank details changed. The best-known solution branches '
    + 'per document on a judged kind. From difficulty 4 a new kind appears and suppliers write in German, French and Spanish.',
};

export const difficulty = {
  min: MIN_D, max: MAX_D, default: 3, levels: LEVELS,
  drift: 'd -> d+1 adds documents (30/40/50/60) and decoys (30/40/45/50% of documents carry another kind\'s keyword or none); '
    + 'd3 adds mistyped and date-cited references, loose invoice numbers in remittances and payments on behalf of another '
    + 'customer; d4 adds the bank_change kind (new kind) and suppliers writing invoices and credit notes in German, French or '
    + 'Spanish (a kind whose cue changes language); d5 more of everything. Streams switch from d3 to d4 at task 17 (W-BED §2.5).',
};

// ---------------------------------------------------------------------------------------------------------------------
const hostWorld = task => buildInbox(task.seed, task.split ?? 'dev', task.difficulty ?? 3);
const traceCache = new WeakMap();
function truthOf(task) {
  const w = hostWorld(task);
  if (!traceCache.has(w)) traceCache.set(w, runPipeline(w));
  return traceCache.get(w);
}
const inputsOf = w => ({ inbox: w.render.inbox, parties: w.render.parties, payables: w.render.payables, receivables: w.render.receivables, notes: w.render.notes, spec: w.render.spec });

export function generate({ seed, split = 'dev', difficulty: d = 3, faults } = {}) {
  requireNoFaults(faults);
  const w = hostWorld({ seed, split, difficulty: d });
  const inputs = hooks.adversarialContent(inputsOf(w)); // R8 f3 hook point (no-op in v1)
  return {
    id: `wbed-r2:${split}:d${d}:${seed}`,
    family: family.id,
    seed, split, difficulty: d,
    prompt: w.render.prompt,
    inputs,
    budget: { outputTokens: 600 + w.docs.length * 60 },
  };
}

export function oracle(task, output) {
  return scoreInbox(truthOf(task).post, output);
}
export function referenceSolve(task) {
  return structuredClone(truthOf(task).post);
}

// ---------------------------------------------------------------------------------------------------------------------
function corrupt(out) {
  const o = structuredClone(out);
  const n = o.entries.length, vals = o.entries.map(e => e.amount_minor);
  o.entries.forEach((e, i) => { e.amount_minor = vals[(i + 1) % n]; });
  return o;
}
const asControl = def => {
  const base = { name: def.name, kind: def.kind, why: def.why ?? null, ...(def.minDifficulty ? { minDifficulty: def.minDifficulty } : {}) };
  if (def.make) return { ...base, make: def.make };
  if (def.corrupt) return { ...base, make: task => corrupt(truthOf(task).post) };
  return { ...base, opts: def.opts, make: task => runPipeline(hostWorld(task), def.opts).post, trace: task => runPipeline(hostWorld(task), def.opts) };
};
export const badControls = CONTROL_DEFS.map(asControl);
/** Structure-necessity controls (W-BED §2.4 item 3): solvers without the judged branch. Every one must fail. */
export const necessityControls = NECESSITY_DEFS.map(asControl);

setVerifier(world => {
  const truth = solveOutput(world);
  for (const def of [...CONTROL_DEFS, ...NECESSITY_DEFS]) {
    if (!appliesAt(def, world.spec.difficulty)) continue;
    const out = def.make ? def.make() : def.corrupt ? corrupt(truth) : solveOutput(world, def.opts);
    if (scoreInbox(truth, out).pass) return def.name;
  }
  return null;
});

// ---------------------------------------------------------------------------------------------------------------------
// W-specific exports (W-BED §2.1).
export const stages = makeStages(truthOf, task => structuredClone(generate(task).inputs));
export const relations = RELATIONS;
export const composedOracle = (task, trace) => composeOracle(stages, task, trace, hostWorld(task));
export const referenceTrace = task => structuredClone(truthOf(task));

export const invariants = [
  { id: 'P1-routed-once', scope: 'post', text: 'every document appears in routing exactly once' },
  { id: 'P2-review-exclusive', scope: 'post', text: 'documents in the review queue (and unrelated / injection ones) produce no entries and no holds' },
  { id: 'P3-handler-arity', scope: 'post', text: 'bill, credit, statement: one entry; dispute, bank change: one hold; remittance: at least one entry' },
  ...RELATIONS.map(x => ({ id: x.id, scope: x.stages.join('+'), text: x.text })),
];

/** Keyword-rule failure on one task: the share of documents the keyword router misroutes (analyst side). */
export function keywordMisroute(task) {
  const w = hostWorld(task);
  const wrong = w.docs.filter(d => keywordRoute(`${d.subject}\n${d.body}`) !== d.kind);
  const decidable = w.docs.filter(d => d.kind !== 'review');
  return { docs: w.docs.length, misrouted: wrong.length, share: wrong.length / w.docs.length,
    decidableShare: decidable.filter(d => keywordRoute(`${d.subject}\n${d.body}`) !== d.kind).length / decidable.length };
}

export const structure = {
  rung: 'R2', shape: 'judged-branch',
  stages: ['split', 'route', 'read', 'post'],
  features: { maxCallDepth: 0, callSites: 0, mapSites: 1, maxFanOut: 60, agentNodes: 0, wideNodes: 0, judgedBranchPoints: 1,
    judges: ['kind per document (enum incl. review; quoted cue must occur in the document; samples split -> review)',
      'per-kind fact reader (bill total, credit amount and cited reference, remittance amount and named invoices, dispute reason with quote)'] },
  outline: [
    'step split the inbox into documents',
    'map over documents:',
    '  judge kind (schema: enum of routes incl. review + quoted cue; check: the quote occurs in the document)',
    '  flag + review queue when the kind judge says review or its samples split (createFlow({ autoFlag: true }), flow-v2)',
    '  JS switch on kind -> per-kind handler (each a judge that reads the facts + a code step):',
    '    invoice -> post_bill; credit_note -> resolve reference against payables (exact / typo / date+amount) -> post_credit',
    '    remittance -> allocate (named first, capped, oldest-first spill, unapplied); statement_request -> send_statement',
    '    dispute -> resolve invoice -> hold with reason; bank_change -> hold VERIFY_BANK; unrelated / injection -> nothing',
    'invariant every document routed exactly once (P1); review exclusive (P2); handler arity (P3); allocation conserves (Y3)',
    'done',
  ],
};

export const taskTokens = task => estimateTokens(task.prompt) + estimateTokens(JSON.stringify(task.inputs));
