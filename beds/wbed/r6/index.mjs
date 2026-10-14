// W-bed rung R6 "wide research table" (family wbed-r6): a planned swarm (W-BED §3.6). Interface per beds/CONTRACT.md v1
// plus the W-specific exports `stages`, `structure`, `relations`, `composedOracle`, `referenceTrace`, `invariants`,
// `necessityControls`, and the R6-specific `unitChecks` (the code half of the verify), `codePlan` / `coverageIssues`
// (the plan's code check), `keywordScript`, `whiteboxSolve` (the white-box parser: decidability witness, reported
// triviality attack), `textIndex`, `tokenAccounting` (equal-token and equal-dollar accounting for wide vs best_of_n),
// `bestOfNRun`, the reported ablations `planAblation` and `grepAgentRun`, `scopeOf`, `sizeOf`.
// The hidden truth is recomputed from (seed, split, difficulty) by the bed's own exact solver over the world structure;
// nothing in the output but its value is read.
import { buildWide, setVerifier, LEVELS, MIN_D, MAX_D, VERSION } from './world.mjs';
import { runPipeline, textIndex, entityByString, voidKeys, worker, reduce } from './pipeline.mjs';
import { outputSchema, scoreTable } from './score.mjs';
import { CONTRACTS, RELATIONS, makeStages, composeOracle, reduceLocal } from './stages.mjs';
import { CONTROL_DEFS, NECESSITY_DEFS, appliesAt } from './controls.mjs';
import { keywordScript } from './heuristic.mjs';
import { unitChecks, codePlan, coverageIssues } from './verify.mjs';
import { whiteboxSolve } from './whitebox.mjs';
import { tokenAccounting as accountWorld, readingOrder, unseenPast, agentReadSet, SEQUENTIAL_BUDGET_TOKENS, PANEL, BEST_OF_N_MIN, PER_FILE_OVERHEAD } from './budget.mjs';
import { PROPS, MAX_FANOUT, tierOf } from './vocab.mjs';
import { isResearch } from './world.mjs';
import { requireNoFaults, hooks } from '../lib/faults.mjs';
import { estimateTokens, rng } from '../lib/prng.mjs';

export { outputSchema, CONTRACTS, LEVELS, reduceLocal, unitChecks, codePlan, coverageIssues, keywordScript, whiteboxSolve, textIndex, SEQUENTIAL_BUDGET_TOKENS, PANEL, MAX_FANOUT, PER_FILE_OVERHEAD };
export const version = VERSION;

export const family = {
  id: 'wbed-r6',
  rung: 'R6',
  domain: 'research synthesis over a consortium corpus (wide research table)',
  version: VERSION,
  kind: 'oneshot',
  description: 'A research consortium\'s corpus of 200-400 fictional documents (journal articles, preprints and their '
    + 'versions, lab notes, reviews, errata, retraction notices, expressions of concern, consortium notices) about '
    + 'fictional compounds, one text file per document. The question names a lab and a date: which compounds did the lab '
    + 'itself test on or after the date (the list is not given: it must be discovered; tests are dated by when the '
    + 'measurement was made; the lab also appears under an abbreviation and a former name; quoted values, predictions and '
    + 'planned tests are not tests; a retracted document\'s test does not count), and for each, the accepted value of 3-5 '
    + 'requested properties under a synth-style resolution policy (void documents, errata, standard conditions, quotes, '
    + 'predictions, bounds, units, a ranking policy), plus the void documents that mention them. The best-known solution is '
    + 'a planned swarm: a code plan over the header digest and the lab\'s alias notices, checked against a code mention '
    + 'index, one judge chain per candidate compound, a code reducer and a sampled verify. The plan is needed to fit the '
    + 'fan-out cap, not for correctness; the corpus is a closed template grammar a parser solves at d2-d4 (W-BED-R6-NOTES '
    + '§13). The inline task is 48-104K tokens.',
};

export const difficulty = {
  min: MIN_D, max: MAX_D, default: 3, levels: LEVELS,
  drift: 'd -> d+1 adds documents (200/260/320/400) and compounds in scope (8/12/16/20 +-2 per task, the fan-out width; '
    + 'plan candidates about 12/17/22/27, never above 32), requested properties (3/4/4/5), labs, unit variants and date styles; d3 adds lab X\'s '
    + 'abbreviation, compounds named by code only, reviews, expressions of concern, a second ranking policy and decoy '
    + '"received" dates; d4 adds lab X\'s former name (a consortium notice states the rename), a namesake organisation, a '
    + 'third ranking policy, thousands separators and out-of-corpus retractions sharing a title; d5 replaces part of the '
    + 'test-date phrasing by a held-out tier: a sample log and conference abstracts on split dev, dates relative to a '
    + 'site visit and technical reports on split test (never seen on split dev). Streams switch from d3 to d4 at task 17 '
    + '(W-BED §2.5).',
};

// ---------------------------------------------------------------------------------------------------------------------
const specOf = task => ({ seed: task.seed, split: task.split ?? 'dev', difficulty: task.difficulty ?? 3 });
const hostWorld = task => { const s = specOf(task); return buildWide(s.seed, s.split, s.difficulty); };
const traceCache = new WeakMap();
function truthTraceOf(world) {
  if (!traceCache.has(world)) traceCache.set(world, runPipeline(world));
  return traceCache.get(world);
}
const truthOf = task => truthTraceOf(hostWorld(task));
const scoreCache = new WeakMap();
/** The oracle's truth: cells (code|prop -> canon, source), all compounds for name resolution, the excluded set. */
function scoringTruth(world) {
  if (scoreCache.has(world)) return scoreCache.get(world);
  const tr = truthTraceOf(world);
  const cells = new Map();
  for (const r of tr.reduce.table) {
    const e = entityByString(world, r.entity);
    cells.set(`${e.code}|${r.property}`, { canon: Math.round(r.value * 10 ** PROPS[r.property].dec), source: r.source_doc_id });
  }
  const t = { cells, props: world.props, entities: world.entities.map(e => ({ code: e.code, name: e.name })), excluded: [...tr.reduce.excluded_doc_ids] };
  scoreCache.set(world, t);
  return t;
}
const taskView = world => ({ prompt: world.render.prompt, inputs: world.render.inputs, files: world.render.files });

export function generate({ seed, split = 'dev', difficulty: d = 3, faults } = {}) {
  requireNoFaults(faults);
  const w = buildWide(seed, split, d);
  const files = hooks.adversarialContent({ ...w.render.files }); // R8 f3 hook point (no-op in v1)
  const cells = w.truthCells.length;
  return {
    id: `wbed-r6:${split}:d${d}:${seed}`,
    family: family.id,
    seed, split, difficulty: d,
    prompt: w.render.prompt,
    inputs: structuredClone(w.render.inputs),
    files,
    budget: { outputTokens: 300 + 45 * cells },
  };
}

export function oracle(task, output) { return scoreTable(scoringTruth(hostWorld(task)), output); }
export function referenceSolve(task) { return structuredClone(truthOf(task).reduce); }

// ---------------------------------------------------------------------------------------------------------------------
// Controls
const corrupt = out => {
  const o = structuredClone(out);
  const ids = o.table.map(r => r.source_doc_id);
  o.table = o.table.map((r, i) => ({ ...r, value: Math.round(r.value * 1.37 * 1000) / 1000, source_doc_id: ids[(i + 1) % ids.length] }));
  return o;
};
const inScopeCodes = world => truthTraceOf(world).worker.items.filter(x => x.in_scope).map(x => entityByString(world, x.entity).code);
const accountingOf = world => accountWorld(world, { candidates: truthTraceOf(world).plan.candidates, inScope: inScopeCodes(world) });

/** best_of_n at equal tokens with the same verifier: { N, candidates: [{ offset, unseen, score, unitIssues }], pick, trace }. */
function bestOfNOf(world) {
  const acc = accountingOf(world);
  const N = Math.max(BEST_OF_N_MIN, acc.bestOfN.nAtEqualTokens);
  const D = world.docs.length, truth = scoringTruth(world), view = taskView(world);
  const cands = [];
  for (let i = 0; i < N; i++) {
    const offset = Math.floor((i * D) / N);
    const unseen = unseenPast(world, readingOrder(world, offset));
    const trace = runPipeline(world, { unseen });
    const out = trace.reduce;
    const uc = unitChecks(view, out).issues.length;
    // the panel (stand-in: a perfect judge) re-derives a 20% sample of the candidate's rows
    const r = rng('wbed', 'r6', 'bon-panel', world.spec.split, world.spec.seed, world.spec.difficulty, i);
    const rows = r.shuffle(out.table).slice(0, Math.ceil(PANEL.sample * out.table.length));
    const ok = rows.filter(row => {
      const e = entityByString(world, row.entity), t = e && truth.cells.get(`${e.code}|${row.property}`);
      return t && Math.round(row.value * 10 ** PROPS[row.property].dec) === t.canon && row.source_doc_id === t.source;
    }).length;
    const score = (rows.length ? ok / rows.length : 0) - 0.01 * uc;
    cands.push({ offset, unseen: unseen.size, score: Math.round(score * 1e4) / 1e4, unitIssues: uc, trace });
  }
  let pick = 0;
  cands.forEach((c, i) => { if (c.score > cands[pick].score) pick = i; });
  return { N, nAtEqualTokens: acc.bestOfN.nAtEqualTokens, candidates: cands, pick, trace: cands[pick].trace };
}

const optsFor = (def, world) => {
  if (def.attention === 'sequential') return { unseen: unseenPast(world, readingOrder(world, 0)) };
  return def.opts;
};
function controlOutput(def, world) {
  if (def.name === 'empty') return { table: [], excluded_doc_ids: [] };
  if (def.name === 'shuffled-or-corrupted') return corrupt(truthTraceOf(world).reduce);
  if (def.kind === 'heuristic') return keywordScript(taskView(world));
  if (def.attention === 'best-of-n') return bestOfNOf(world).trace.reduce;
  return runPipeline(world, { ...optsFor(def, world), traces: false }).reduce;
}
function controlTrace(def, world) {
  if (def.attention === 'best-of-n') return bestOfNOf(world).trace;
  if (!def.opts && !def.attention) return null;
  return runPipeline(world, optsFor(def, world));
}
const asControl = def => {
  const base = { name: def.name, kind: def.kind, why: def.why ?? null, stage: def.stage ?? null, ...(def.minDifficulty ? { minDifficulty: def.minDifficulty } : {}) };
  const out = { ...base, make: task => controlOutput(def, hostWorld(task)) };
  if (def.opts || def.attention) out.trace = task => controlTrace(def, hostWorld(task));
  return out;
};
export const badControls = CONTROL_DEFS.map(asControl);
export const necessityControls = NECESSITY_DEFS.map(asControl);

setVerifier(world => {
  const truth = scoringTruth(world);
  for (const def of [...CONTROL_DEFS, ...NECESSITY_DEFS]) {
    if (!appliesAt(def, world.spec.difficulty)) continue;
    if (scoreTable(truth, controlOutput(def, world)).pass) return def.name;
  }
  return null;
});

// ---------------------------------------------------------------------------------------------------------------------
// W-specific exports (W-BED §2.1).
export const stages = makeStages(truthOf, hostWorld, task => structuredClone(generate(task).inputs));
export const relations = RELATIONS;
export const composedOracle = (task, trace) => composeOracle(stages, task, trace);
/** The exact solver's trace (analyst side only): { index, plan, worker, reduce }. */
export const referenceTrace = task => structuredClone(truthOf(task));

/** Analyst side: the hidden scope and its traps. Never shown to a solver. */
export function scopeOf(task) {
  const w = hostWorld(task);
  const tr = truthTraceOf(w);
  const roleOf = s => entityByString(w, s);
  return {
    lab: w.labs.find(l => l.isX).name, cutoff: w.render.inputs.question.tested_on_or_after, policy: w.policy, props: [...w.props], tier: w.tier,
    inScope: tr.worker.items.filter(x => x.in_scope).map(x => ({ code: roleOf(x.entity).code, sub: roleOf(x.entity).sub })),
    candidates: tr.plan.candidates.map(s => ({ code: roleOf(s).code, role: roleOf(s).role })),
    namesake: w.entities.filter(e => e.role === 'T6').map(e => e.code),
    traps: w.truthCells.flatMap(c => c.traps).reduce((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {}),
    excluded: tr.reduce.excluded_doc_ids.length, attempt: w.attempt, rejects: w.rejects,
  };
}
/** Equal-token accounting (W-BED §3.6 comparison): corpus, inline, the reference wide's phases, best_of_n's N. */
export const tokenAccounting = task => accountingOf(hostWorld(task));
/** best_of_n at equal tokens with the same verifier (analyst side): per candidate its unseen count and verifier score. */
export function bestOfNRun(task) {
  const b = bestOfNOf(hostWorld(task));
  return { N: b.N, nAtEqualTokens: b.nAtEqualTokens, pick: b.pick, candidates: b.candidates.map(({ trace, ...c }) => c), output: structuredClone(b.trace.reduce) };
}

// Mined invariants (W-BED §2.2 item 3): analyst-side "free verifier" candidates. No system component sees them.
export const invariants = [
  { id: 'A1-complete-rows', scope: 'reduce', text: 'every compound in the table has exactly one row per requested property' },
  { id: 'A2-no-void-source', scope: 'reduce', text: 'no source_doc_id is in excluded_doc_ids' },
  { id: 'A3-void-by-title', scope: 'reduce', text: 'every excluded document is quoted by title in a retraction notice or a version-2 / peer-reviewed-version sentence (code check, unitChecks)' },
  ...RELATIONS.map(x => ({ id: x.id, scope: x.stages.join('+'), text: x.text })),
];

// The best-known solution's structure (W-BED §6.3), declared by the bed author. Descriptive only.
export const structure = {
  rung: 'R6', shape: 'planned-swarm',
  stages: ['index', 'plan', 'worker', 'reduce'],
  features: { maxCallDepth: 1, callSites: 0, mapSites: 0, maxFanOut: MAX_FANOUT, agentNodes: 0, wideNodes: 1, judgedBranchPoints: 1,
    judges: [
      'plan: candidate compounds (typed list of codes, each with a quoted Affiliation line and Published date; check: every quote occurs; the code index checks gaps and duplicates)',
      'worker scope: in scope? (enum + the quoted test-date sentence and Affiliation line; check: both quotes occur in the cited document)',
      'worker cell, per requested property: the winning claim (value, unit, n, source id, quoted sentence; check: the quote occurs in the source and names the compound)',
      'verify panel: 3 judges (independence: same-model, correlated) on a 20% sample of cells',
    ],
    wide: { plan: 'judge over the header digest (Type, Venue, Published, Affiliation, Title of every document) + consortium notices + the question',
      check: 'code: index entities (textIndex) -> no unknown or duplicate candidate; gaps = compounds mentioned in a document whose Affiliation the plan accepted, published on/after the date, but not listed', maxFanout: MAX_FANOUT,
      worker: 'judge chain per candidate over its mention documents + every notice (shared prefix: rules + notices)', reduce: 'code (in-scope items only; excluded = union of their void documents)',
      verify: `panel of ${PANEL.n} on a ${PANEL.sample * 100}% sample of cells + unitChecks (code)` } },
  outline: [
    'step index (code): textIndex(files, register) -> per code: name, mention documents; header digest; notices',
    'flow.wide("wide-table", {',
    '  plan: judge(question + header digest + consortium notices) -> candidates [{code, affiliation_quote, published}] (recall: every compound mentioned in a research document of the lab, under any of its names, published on/after the date),',
    '  check: (cands, ctx) => coverageIssues(cands, ctx.index) (unknown codes, two strings for one compound, gaps), one replan with the issues,',
    `  maxFanout: ${MAX_FANOUT},`,
    '  worker: per candidate, over its mention documents + every notice:',
    '    judge in_scope (an own test by the lab dated on/after the date, in a document that is not void) -> if not, return { in_scope: false }',
    '    judge per requested property: the winning claim (void status, errata, condition, quotes, predictions, bounds, unit, ranking policy)',
    '    step void documents among its mention documents',
    '  reduce: (results, coverage) => table of in-scope items + union of their void documents (code; coverage must be complete),',
    `  verify: { panel: { n: ${PANEL.n} }, sample: ${PANEL.sample}, code: unitChecks },`,
    '})',
    'invariant Y1-Y5 (plan-index, coverage, table carried, void union, sources live)',
    'done',
  ],
};

/** Rough input size of a task in tokens (utf8 bytes / 4), for cost planning. */
export const taskTokens = task => estimateTokens(task.prompt) + estimateTokens(JSON.stringify(task.inputs)) + Object.values(task.files ?? {}).reduce((a, t) => a + estimateTokens(t), 0);
/** Size facts (analyst side). */
export function sizeOf(task) {
  const w = hostWorld(task);
  const tr = truthTraceOf(w);
  const acc = accountingOf(w);
  return { docs: w.docs.length, research: w.docs.filter(isResearch).length, entities: w.entities.length, inScope: tr.worker.items.filter(x => x.in_scope).length,
    candidates: tr.plan.candidates.length, cells: tr.reduce.table.length, excluded: tr.reduce.excluded_doc_ids.length, tier: tierOf(w.spec.split, w.spec.difficulty),
    corpusTokens: acc.corpus, inlineTokens: acc.inline, sequentialUnseen: unseenPast(w, readingOrder(w, 0)).size, wide: acc.wide, bestOfN: acc.bestOfN };
}
