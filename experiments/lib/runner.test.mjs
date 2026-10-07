// C0 preflight R4: environment faults are routed out of the results (and retried on resume), a stall stops the run,
// and a resume never mixes versions of an arm. Uses the records bed's dev split only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runExperiment, armHash, metEnvFault, faultsFileOf, ENV_FAULTS } from './runner.mjs';
import { makeTasks, loadFamily } from './beds.mjs';
import { BUILD_ENV_FAULTS } from '../c0/construct.mjs';

const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);
let fam; try { fam = await loadFamily('records'); } catch {}
const skip = fam ? false : 'records bed not available';
const setup = async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'runner-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tasks = await makeTasks('records', { split: 'dev', seeds: [1, 2, 3, 4], difficulty: 1 });
  return { dir, tasks, resultsFile: path.join(dir, 'results.jsonl'), workRoot: path.join(dir, 'work') };
};
// An arm that answers correctly except where `fault(taskKey)` names an environment fault for it.
const arm = (id, fault = () => null, version = 1) => ({
  id, def: { kind: 'test', version }, stateful: false,
  async run({ task, taskKey }) {
    const code = fault(taskKey);
    if (code === 'meta') return { output: null, costUsd: 0.01, error: { code: 'SCRIPT_OUTPUT' }, meta: { errors: { MODEL_RATE_LIMIT: 1 } } };
    if (code) return { output: null, costUsd: 0.02, costUnknown: true, error: { code } };
    return { output: fam.referenceSolve(task), costUsd: 0.001 };
  },
});

test('the environment-fault classes are the pre-registered ones', () => {
  assert.deepEqual([...ENV_FAULTS].sort(), ['EXECUTOR_LAUNCH', 'EXECUTOR_PROTOCOL', 'MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'SANDBOX_UNAVAILABLE']);
  assert.deepEqual([...BUILD_ENV_FAULTS].sort(), [...ENV_FAULTS].sort(), 'constructions and trials share one fault rule');
  assert.equal(metEnvFault({ error: { code: 'MODEL_RATE_LIMIT' } }), true);
  assert.equal(metEnvFault({ error: { code: 'SCRIPT_ERROR' }, meta: { errors: { MODEL_UNAVAILABLE: 2 } } }), true, 'a fault met by any model call counts');
  assert.equal(metEnvFault({ error: { code: 'EXECUTOR_TIMEOUT' } }), false); assert.equal(metEnvFault({ error: { code: 'NO_ARTIFACT' } }), false);
  assert.equal(faultsFileOf('/x/results.jsonl'), '/x/results.faults.jsonl');
});

test('a failed trial that met an environment fault goes to the faults file, not the results, and a resume retries it', { skip }, async t => {
  const { tasks, resultsFile, workRoot } = await setup(t);
  const opts = { experiment: 'r4', tasks, trials: 1, workRoot, resultsFile, concurrency: 2, log: () => {}, envFaultRule: true, strictResume: true };
  const flaky = arm('A', key => (key.endsWith('s2') ? 'MODEL_RATE_LIMIT' : key.endsWith('s3') ? 'meta' : null));
  await runExperiment({ ...opts, arms: [flaky] });
  const first = readJsonl(resultsFile), faults = readJsonl(faultsFileOf(resultsFile));
  assert.equal(first.length, 2); assert.ok(first.every(r => r.pass));
  assert.deepEqual(faults.map(f => f.task).sort(), [tasks[1].taskKey, tasks[2].taskKey].sort());
  assert.equal(faults.find(f => f.task === tasks[1].taskKey).costUnknown, true, 'the faulted attempt keeps its spend facts');
  // After the reset the same arm version completes the faulted trials; recorded ones are not re-run.
  let runs = 0;
  const fixed = { ...arm('A'), async run(a) { runs++; return arm('A').run(a); } };
  await runExperiment({ ...opts, arms: [fixed] });
  assert.equal(runs, 2); assert.equal(readJsonl(resultsFile).length, 4);
});

test('without the rule (the default) a faulted trial is recorded as before', { skip }, async t => {
  const { tasks, resultsFile, workRoot } = await setup(t);
  await runExperiment({ experiment: 'r4', arms: [arm('A', () => 'MODEL_RATE_LIMIT')], tasks: tasks.slice(0, 1), trials: 1, workRoot, resultsFile, log: () => {} });
  assert.equal(readJsonl(resultsFile).length, 1); assert.equal(existsSync(faultsFileOf(resultsFile)), false);
});

test('more than 25% faulted trials after 8 attempts stops the run as a stall', { skip }, async t => {
  const { tasks, resultsFile, workRoot } = await setup(t);
  const many = await makeTasks('records', { split: 'dev', seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], difficulty: 1 });
  await assert.rejects(runExperiment({ experiment: 'r4', arms: [arm('A', key => (/s[1-4]$/.test(key) ? 'MODEL_UNAVAILABLE' : null))], tasks: many, trials: 1, workRoot, resultsFile,
    concurrency: 1, log: () => {}, envFaultRule: true }), /STALL/);
  assert.ok(tasks.length > 0);
});

test('a resume refuses to mix versions of an arm (strictResume)', { skip }, async t => {
  const { tasks, resultsFile, workRoot } = await setup(t);
  const opts = { experiment: 'r4', tasks: tasks.slice(0, 2), trials: 1, workRoot, resultsFile, log: () => {}, envFaultRule: true, strictResume: true };
  await runExperiment({ ...opts, arms: [arm('A', () => null, 1)] });
  assert.equal(readJsonl(resultsFile)[0].armHash, armHash(arm('A', () => null, 1)));
  await assert.rejects(runExperiment({ ...opts, arms: [arm('A', () => null, 2)] }), /resume would mix versions of A/);
  await runExperiment({ ...opts, arms: [arm('A', () => null, 1)] });   // the same version resumes (nothing to do)
  assert.equal(readJsonl(resultsFile).length, 2);
});
