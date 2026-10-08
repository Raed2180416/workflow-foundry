// R-bench item github-actions:shafthq/shaft_engine/.github/workflows/update-selenium-grid-versions.yml
// "Update Selenium Grid Docker Versions": a weekly maintainer bot that keeps the Selenium images in a docker-compose file on the
// latest stable tags and opens a pull request only when something changed.
// Exposes the beds/CONTRACT.md (v1) interface for a one-shot family:
//   family, outputSchema, generate({seed, split, difficulty, variant}), oracle(task, output), referenceSolve(task), badControls
// plus R-bench extras: variants T1 translate | T2 rebuild from intent | T3 improve, instanceOf (trusted), materialize, meetsTarget.
// Development/diagnostic harness: nothing here is a sealed evaluation set (AGENTS.md).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ITEM, MODE_OF, T3_TARGET_RULE, VARIANTS, readText } from './spec.mjs';
import { KIND_IDS, instanceFor, inputsOf, poolFor, VERSION as SCENARIOS_VERSION } from './scenarios.mjs';
import { judgePlan, outputSchema } from './oracle.mjs';
import { CONTRACT, SKELETON, TASK_TEXT } from './prompts.mjs';
import { publicExamples } from './examples.mjs';
import { solveFaithful, solveImproved } from './controls/reference.mjs';
import { BROKEN, contextOf } from './controls/broken.mjs';

export const VERSION = '0.1.1';   // 0.1.1 (verifier, 2026-10-08): oracle PR-text and failed-plan checks, PR-stub label set; instances unchanged (scenarios.mjs VERSION 0.1.0)
export { ITEM, VARIANTS, MODE_OF, outputSchema, KIND_IDS, instanceFor, inputsOf, SKELETON };

export const family = {
  id: `rbench-${ITEM.safeId}`,
  domain: 'workflow replication / CI maintenance bot (fetch a reference file, edit a repository file, open a pull request only on change)',
  version: VERSION,
  kind: 'oneshot',
  description: 'A maintainer bot from the SHAFT test-automation project, replicated against mocks: given the repository\'s docker-compose file, the answer of the Selenium '
    + 'project\'s reference file and the open pull requests, produce the run\'s effects (edited file, pull-request request, failure) and the versions found. 14 scenario kinds '
    + '(bump, partial bump, no change, pre-release tags, open bot PR, missing images, duplicate lines, unusable reference, and the original\'s defects) drawn by seed. '
    + 'T1 is judged against the original actually running, T2/T3 against the maintainers\' intent (README section 3).',
};

function check({ seed, split, difficulty, variant }) {
  if (!['dev', 'test'].includes(split)) throw new Error(`${family.id}: split must be 'dev' or 'test', got ${split}`);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new Error(`${family.id}: difficulty must be an integer 1..5, got ${difficulty}`);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`${family.id}: seed must be a non-negative integer, got ${seed}`);
  if (!VARIANTS.includes(variant)) throw new Error(`${family.id}: variant must be one of ${VARIANTS.join(', ')}, got ${variant}`);
}

// The original's measured cost on the canonical suite (controls/run-controls.mjs writes fixtures/baseline.json). Machine-dependent
// (bash and curl start-up dominate); the T3 latency target is a fraction of it, so compare runs made on the same machine.
let baselineCache;
export function baseline() {
  if (baselineCache === undefined) {
    try { baselineCache = JSON.parse(readFileSync(new URL('./fixtures/baseline.json', import.meta.url), 'utf8')); } catch { baselineCache = null; }
  }
  return baselineCache;
}
export const targetOf = b => (b ? {
  modelUsdMax: T3_TARGET_RULE.modelUsdMax,
  latencyMsMax: Math.floor(b.wallMsMedian * T3_TARGET_RULE.latencyMsMax),
  note: 'per run on one instance, measured on the solver\'s own work (model spend, wall time to produce the plan); the host\'s fetch and pull-request calls are the same for every plan. Latency is the original\'s median wall time on the machine that measured fixtures/baseline.json.',
} : null);

let examplesCache;
const examples = () => (examplesCache ??= publicExamples());

export function generate({ seed, split = 'dev', difficulty = 3, variant = 'T2' }) {
  check({ seed, split, difficulty, variant });
  const instance = instanceFor({ seed, split, difficulty });
  const inputs = inputsOf(instance);
  if (variant === 'T2') inputs.examples = examples();
  const files = { 'solve.mjs': SKELETON };
  if (variant !== 'T2') {
    files['original/update-selenium-grid-versions.yml'] = readText(ITEM.vendoredPath);
    files['original/LICENSE'] = readText('fixtures/original/LICENSE');
  }
  const task = {
    id: `rbench:${ITEM.safeId}:${variant}:${split}:d${difficulty}:s${seed}`,
    family: family.id, seed, split, difficulty, variant,
    prompt: `${TASK_TEXT[variant]}\n\n${CONTRACT}`,
    inputs,
    files,
  };
  if (variant === 'T3') task.budget = { baseline: baseline(), target: targetOf(baseline()) };
  return task;
}

/** Trusted: rebuild the hidden instance (world and truth) of a task. Solvers and arms never call this. */
export const instanceOf = task => instanceFor({ seed: task.seed, split: task.split, difficulty: task.difficulty });

export function oracle(task, output) {
  return judgePlan(instanceOf(task), MODE_OF[task.variant], output);
}

export function referenceSolve(task) {
  return task.variant === 'T1' ? solveFaithful(task.inputs) : solveImproved(task.inputs);
}

export const badControls = BROKEN.map(c => ({
  name: c.name, describe: c.describe, expect: c.expect,
  applies: task => c.applies(contextOf(instanceOf(task), task.variant)),
  make: task => c.make(contextOf(instanceOf(task), task.variant)),
}));

/** T3 efficiency: did a run stay within the target? `measured` = {costUsd, latencyMs}; judged apart from correctness. */
export function meetsTarget(task, measured) {
  const t = task.budget?.target;
  if (!t) return { ok: null, reason: 'no target (only T3 tasks carry one, and fixtures/baseline.json must exist)' };
  const failures = [];
  if (measured.costUsd > t.modelUsdMax) failures.push(`cost ${measured.costUsd} > ${t.modelUsdMax}`);
  if (measured.latencyMs > t.latencyMsMax) failures.push(`latency ${measured.latencyMs} ms > ${t.latencyMsMax} ms`);
  return { ok: failures.length === 0, failures };
}

/** Write the solver's workspace: the task files and inputs.json. */
export function materialize(task, dir) {
  const written = [];
  const put = (rel, text) => { const file = path.join(dir, rel); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); written.push(file); };
  for (const [rel, text] of Object.entries(task.files)) put(rel, text);
  put('inputs.json', JSON.stringify(task.inputs, null, 2));
  put('prompt.md', task.prompt);
  return written;
}

export const scenarioPool = difficulty => poolFor(difficulty).map(k => k.id);
export { SCENARIOS_VERSION };
