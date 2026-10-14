// W-bed rung R3' "planted-defect sweep" (family wbed-r3p): fan-out per file, verify before report, root-cause fan-in,
// scored exactly against a hidden manifest (PROOF-LEDGER J5; PRIOR-ART-MANAGED-AGENTS-DW §3.H, §4). Interface per
// beds/CONTRACT.md v1 plus the W-specific exports `stages`, `structure`, `relations`, `composedOracle` and
// `necessityControls`, and the sweep-specific `manifestOf`, `scoreDetails`, `costPerVerifiedFinding`, `aggregateSweeps`,
// `impactOf`, `callLogOf`, `scoreImpact`, `scoreReplay`.
import { buildSweep, setVerifier, LEVELS, MIN_D, MAX_D, VERSION, redrawStats } from './world.mjs';
import { runPipeline } from './pipeline.mjs';
import { outputSchema, scoreSweep, costPerVerifiedFinding, aggregateSweeps, witnessHolds, PASS } from './score.mjs';
import { CONTRACTS, RELATIONS, makeStages, composeOracle, reduceLocal } from './stages.mjs';
import { CONTROL_DEFS, NECESSITY_DEFS, SEQUENTIAL_BUDGET_TOKENS, appliesAt } from './controls.mjs';
import { linterFindings, todoFindings, everythingFindings, parseFunctions, LINT_RULES } from './lint.mjs';
import { impactOf, callLogOf, scoreImpact as scoreImpactW, scoreReplay as scoreReplayW } from './impact.mjs';
import { CLASSES, DEFINITIONS, CLASS_FROM, classesAt } from './vocab.mjs';
import { requireNoFaults, hooks } from '../lib/faults.mjs';
import { estimateTokens } from '../lib/prng.mjs';

export { outputSchema, CONTRACTS, RELATIONS, reduceLocal, LEVELS, SEQUENTIAL_BUDGET_TOKENS, PASS, CLASSES, DEFINITIONS, CLASS_FROM, classesAt,
  costPerVerifiedFinding, aggregateSweeps, parseFunctions, LINT_RULES, redrawStats };
export const version = VERSION;

export const family = {
  id: 'wbed-r3p',
  rung: "R3'",
  domain: 'code review: planted-defect sweep of a fictional JavaScript library',
  version: VERSION,
  kind: 'oneshot',
  description: 'Sweep a fictional internal JavaScript library (8/16/32/48 source files by difficulty, about 50-440 exported '
    + 'functions, each with a JSDoc contract; house rules in docs/CONVENTIONS.md drawn per task; green tests that miss the bugs) '
    + 'for defects: functions whose own code breaks their contract for some allowed input. 6/10/16/24 defects of 4/5/7/9 '
    + 'classes are planted, as many decoys (correct code that looks like a defect), and one or two shared helpers are defective, '
    + 'so callers inherit the misbehaviour and must not be reported (root cause). The answer is a list of findings '
    + '(file, function, class, optional witness arguments that are run). Scored exactly against a hidden manifest: precision, '
    + 'recall and F1 per class, cost per verified finding; pass at precision >= 0.90 and recall >= 0.80. The best-known solution '
    + 'is a map over files with a verify step and a code fan-in; at d4-d5 the inline task is 40-65K tokens.',
};

export const difficulty = {
  min: MIN_D, max: MAX_D, default: 3, levels: LEVELS,
  drift: 'd -> d+1 adds source files (8/16/32/48, the fan-out width), functions per file and planted defects (6/10/16/24) '
    + 'with as many decoys; NEW DEFECT CLASSES ONLY AT HIGHER DIFFICULTY: d2 OFF_BY_ONE, LOGIC_ERROR, MISSING_GUARD, ROUNDING; '
    + 'd3 adds INPUT_MUTATION; d4 adds DATE_ARITH (the dates helper can now be the defective one) and ESCAPING; d5 adds '
    + 'SWALLOWED_ERROR and UNIT_MISMATCH. House conventions (rounding of halves, band ends, page base) are drawn per task at '
    + 'every level. Streams switch from d3 to d4 at task 17 (W-BED §2.5), which is where two new classes appear.',
};

// ---------------------------------------------------------------------------------------------------------------------
const hostWorld = task => buildSweep(task.seed, task.split ?? 'dev', task.difficulty ?? 3);
const traceCache = new WeakMap();
function truthOf(task) {
  const w = hostWorld(task);
  if (!traceCache.has(w)) traceCache.set(w, runPipeline(w));
  return traceCache.get(w);
}
const inputsOf = w => structuredClone(w.render.inputs);

export function generate({ seed, split = 'dev', difficulty: d = 3, faults } = {}) {
  requireNoFaults(faults);
  const w = hostWorld({ seed, split, difficulty: d });
  const inputs = hooks.adversarialContent(inputsOf(w)); // R8 f3 hook point (no-op in v1): planted reviewer-directed comments
  return {
    id: `wbed-r3p:${split}:d${d}:${seed}`,
    family: family.id,
    seed, split, difficulty: d,
    prompt: w.render.prompt,
    inputs,
    files: { ...w.render.files },
    budget: { outputTokens: 600 + w.manifest.length * 120 },
  };
}

export function oracle(task, output) { return scoreSweep(hostWorld(task), output); }
export function referenceSolve(task) { return structuredClone(truthOf(task).reduce); }

// ---------------------------------------------------------------------------------------------------------------------
function corrupt(out) {
  const o = structuredClone(out);
  const locs = o.findings.map(f => [f.file, f.function]);
  o.findings.forEach((f, i) => { [f.file, f.function] = locs[(i + 1) % locs.length]; delete f.witness; delete f.line; });
  return o;
}
/** Source files a single context skims: those that end past the budget, in reading order. */
export function skimmedBy(world, budget = SEQUENTIAL_BUDGET_TOKENS) {
  let used = world.render.fixedTokens;
  const skim = new Set();
  for (const p of world.render.sourceFiles) { used += world.render.fileTokens.get(p); if (used > budget) skim.add(p); }
  return skim;
}
const textControl = (def, world) => ({ todo: todoFindings, lint: linterFindings, everything: everythingFindings })[def.text](world.render.files, world.L.classes);
function optsOf(def, world) {
  if (def.sequential) return { skim: skimmedBy(world) };
  if (def.opts?.half) return { ...def.opts, stopAfter: Math.floor(world.render.sourceFiles.length / 2) };
  return def.opts ?? {};
}
function outputOf(def, world, truthOut) {
  if (def.make) return def.make();
  if (def.corrupt) return corrupt(truthOut);
  if (def.text) return textControl(def, world);
  return runPipeline(world, optsOf(def, world)).reduce;
}
const asControl = def => {
  const base = { name: def.name, kind: def.kind, why: def.why ?? null, ...(def.minDifficulty ? { minDifficulty: def.minDifficulty } : {}) };
  const make = task => { const w = hostWorld(task); return outputOf(def, w, def.corrupt ? truthOf(task).reduce : null); };
  if (def.make || def.corrupt || def.text) return { ...base, make };
  return { ...base, opts: def.opts ?? null, make, trace: task => { const w = hostWorld(task); return runPipeline(w, optsOf(def, w)); } };
};
export const badControls = CONTROL_DEFS.map(asControl);
export const necessityControls = NECESSITY_DEFS.map(asControl);

setVerifier(world => {
  const truth = runPipeline(world).reduce;
  if (!scoreSweep(world, truth).pass) return 'reference';
  for (const def of [...CONTROL_DEFS, ...NECESSITY_DEFS]) {
    if (!appliesAt(def, world.spec.difficulty)) continue;
    if (scoreSweep(world, outputOf(def, world, truth)).pass) return def.name;
  }
  return null;
});

// ---------------------------------------------------------------------------------------------------------------------
export const stages = makeStages(hostWorld, task => structuredClone(generate(task).inputs), truthOf);
export const relations = RELATIONS;
export const composedOracle = (task, trace) => composeOracle(stages, task, trace, hostWorld(task));
export const referenceTrace = task => structuredClone(truthOf(task));

/** The hidden manifest (analyst side only): the planted defects with the bed's own witness for each. */
export const manifestOf = task => structuredClone(hostWorld(task).manifest);
/** Decoys and inheriting callers (analyst side): what a precise sweep must NOT report. */
export const trapsOf = task => {
  const w = hostWorld(task);
  return { decoys: w.fns.filter(f => f.role === 'decoy').map(f => ({ file: f.path, function: f.name, looksLike: f.smell })),
    inheritingCallers: w.fns.filter(f => f.affected).map(f => ({ file: f.path, function: f.name, calls: f.calls })) };
};
/** Is `args` a witness for `fn` (in `file`) of this task: valid per its contract's domain and reproducing a misbehaviour. */
export function checkWitness(task, file, fn, args) {
  const w = hostWorld(task), f = w.byName.get(fn);
  if (!f || f.path !== file) return { ok: false, why: 'unknown-function' };
  return witnessHolds(w, f, args);
}
export const impactManifestOf = task => impactOf(hostWorld(task));
export const callLogFor = task => callLogOf(hostWorld(task));
export const scoreImpact = (task, report) => scoreImpactW(hostWorld(task), report);
export const scoreReplay = (task, log, report) => scoreReplayW(hostWorld(task), log, report);

export const invariants = [
  { id: 'S1-one-per-function', scope: 'reduce', text: 'at most one finding per function; every class in scope' },
  { id: 'S2-witness-reproduces', scope: 'reduce', text: 'every witness given lies in the function\'s domain and reproduces (run it)' },
  ...RELATIONS.map(x => ({ id: x.id, scope: x.stages.join('+'), text: x.text })),
];

/** Size facts (analyst side). */
export function sizeOf(task) {
  const w = hostWorld(task);
  const lines = w.render.sourceFiles.reduce((s, p) => s + w.render.files[p].split('\n').length, 0);
  return { sourceFiles: w.render.sourceFiles.length, functions: w.fns.length, sourceLines: lines, defects: w.manifest.length,
    decoys: w.fns.filter(f => f.role === 'decoy').length, inheritingCallers: w.fns.filter(f => f.affected).length,
    testedFunctions: w.fns.filter(f => f.tested).length, testFiles: w.render.testFiles.length, fixedTokens: w.render.fixedTokens,
    sourceTokens: [...w.render.fileTokens.values()].reduce((a, b) => a + b, 0), skimmed: skimmedBy(w).size, attempt: w.attempt };
}

export const structure = {
  rung: "R3'", shape: 'fan-out-verify-fan-in',
  stages: ['inventory', 'candidates', 'verify', 'reduce'],
  features: { maxCallDepth: 1, callSites: 0, mapSites: 2, maxFanOut: 48, agentNodes: 0, wideNodes: 0, judgedBranchPoints: 1,
    judges: ['per file: suspicious functions with a class (enum + the quoted contract sentence the code breaks; check: the quote occurs in the JSDoc or docs/CONVENTIONS.md)',
      'per suspect: a witness (arguments + the value the contract requires), checked by running the function in a sandbox (code)'] },
  outline: [
    'step inventory (code): parse src/ into files and exported functions with spans and the call graph (imports)',
    'map(files, { concurrency: 8 }) of:',
    '  judge suspects in this file: [{ function, class, contract sentence }] (one file plus docs/CONVENTIONS.md in context)',
    'map(suspects, { concurrency: 8 }) of:',
    '  judge witness: arguments the contract allows + the result the contract requires',
    '  step run the function on the witness in a sandbox (code); reproduced iff the result differs from the required one',
    '  branch: not reproduced -> drop (decoy or a misread contract)',
    'step root cause (code): drop a reproduced caller whose reproduced callee explains it (re-run with the callee fixed)',
    'step report (code): one finding per function, with the witness',
    'invariant V1 coverage, V2 verify-before-report, V3 root cause, V4 fan-in conservation',
    'done',
  ],
};

export const taskTokens = task => estimateTokens(task.prompt) + estimateTokens(JSON.stringify(task.inputs)) + Object.values(task.files ?? {}).reduce((s, t) => s + estimateTokens(t), 0);
