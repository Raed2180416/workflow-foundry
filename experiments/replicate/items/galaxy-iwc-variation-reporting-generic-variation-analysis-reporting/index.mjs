// R-bench item: galaxy:iwc/variation-reporting/Generic-variation-analysis-reporting
// Exposes the beds/CONTRACT.md shape (family, outputSchema, generate, oracle, referenceSolve, badControls) plus the extras an
// R-bench runner needs (evalInputs, originalControls, runCandidate). Trusted host code: arms never see this module.
//
// The solver builds a program/workflow; the host runs it on the hidden jobs (evalInputs) and hands the four tables per job to
// oracle() as `output = { cases: { <caseId>: tables }, meta? }`.
import { buildTask, FAMILY_ID, TASK_TYPES, EFFICIENCY_TARGET } from './tasks.mjs';
import { battery, evaluate, evaluatorHealth, PASS_RULE } from './oracle.mjs';
import { referenceSolve as refSolve, badControls as bad, passControls } from './controls.mjs';

export { TASK_TYPES, EFFICIENCY_TARGET };

export const corpusItem = Object.freeze({
  id: 'galaxy:iwc/variation-reporting/Generic-variation-analysis-reporting',
  safeId: 'galaxy-iwc-variation-reporting-generic-variation-analysis-reporting',
  source: 'https://github.com/galaxyproject/iwc/blob/fc190a435262bb61ba29f316e987aa492eb5d18b/workflows/variant-calling/variation-reporting/Generic-variation-analysis-reporting.ga',
  revision: 'iwc commit fc190a435262bb61ba29f316e987aa492eb5d18b; workflow release 0.1.1',
  license: 'MIT', rawSha256: 'b146d115ad99dc836ce2df56975b99176e1a6abdc7b30a8e338b9872e088589f',
});

export const family = {
  id: FAMILY_ID,
  domain: 'science / tabular variant reporting (R-bench replicate item)',
  version: '2', // v2 (2026-10-08, adversarial verification): SnpEff-ordered multi-effect lists, zero-dp and multi-allelic probes, stratified AF, honest T2 wording
  kind: 'oneshot',
  description: 'Rebuild a published 35-step Galaxy reporting workflow (SnpSift, datamash, joins, sorts over a sample collection). Tasks T1 translate, T2 rebuild from intent, T3 improve; '
    + 'judged by four tables on the shipped test job and 20 seeded derived multi-sample jobs. Controls: shipped tables / .ga emulator pass, mutated reference and trivial outputs fail.',
};

export const outputSchema = {
  type: 'object',
  required: ['cases'],
  properties: {
    cases: {
      type: 'object', // keys are case ids ('shipped', 'derived-00' .. 'derived-19'); values:
      description: 'map caseId -> { af_recalculated: {sampleId: tsv}, all_variants_all_samples, by_variant_report, combined_variant_report }',
    },
    meta: { type: 'object', description: 'optional self-reported cost: nodes, modelCalls, wallMs (never used for the verdict)' },
  },
};

// generate({ seed, split, difficulty, taskType = 'T2' }) -> Task. Pure and deterministic. The hidden battery is not part of the task.
export function generate({ seed, split, difficulty = 3, taskType = 'T2' }) {
  if (!Number.isSafeInteger(seed) && typeof seed !== 'string') throw new Error('seed must be an integer or string');
  if (split !== 'dev' && split !== 'test') throw new Error("split must be 'dev' or 'test'");
  if (![1, 2, 3, 4, 5].includes(difficulty)) throw new Error('difficulty must be 1..5');
  return buildTask({ seed, split, difficulty, taskType });
}

// Host side: the jobs to run the candidate on, as [{ caseId, inputs: { params, samples } }]. No expected tables.
export const evalInputs = task => battery(task).map(c => ({ caseId: c.caseId, kind: c.kind, inputs: c.inputs }));

export function oracle(task, output) {
  const { perCase, ...verdict } = evaluate(task, output);
  return verdict;
}
// Same judgement with the per-table detail (diagnostics, tests).
export const diagnose = (task, output) => evaluate(task, output);

export const referenceSolve = refSolve;
export const badControls = bad;
export const originalControls = passControls;
export { evaluatorHealth, PASS_RULE };

// Convenience: run `candidate(inputs) -> tables` (sync or async) on every hidden job and judge the result. The candidate sees the job only: never the
// case id or kind, so it cannot special-case the (public) shipped job. A job on which the candidate throws or returns nothing is a missing case, which fails.
export async function runCandidate(task, candidate) {
  const cases = {}, errors = {};
  for (const c of evalInputs(task)) {
    try { const out = await candidate(structuredClone(c.inputs)); if (out != null) cases[c.caseId] = out; }
    catch (e) { errors[c.caseId] = String(e?.message ?? e).slice(0, 200); }
  }
  const verdict = oracle(task, { cases });
  return { ...verdict, details: { ...verdict.details, candidateErrors: errors } };
}
