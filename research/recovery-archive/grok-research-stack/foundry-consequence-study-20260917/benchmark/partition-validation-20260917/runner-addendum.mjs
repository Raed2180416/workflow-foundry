import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, sha, json, writeNew, verifyPartitionFreeze } from './freeze.mjs';

const sourceNames = ['run-v2.mjs', 'runner-replay.mjs', 'runner-v2.test.mjs', 'runner-addendum.mjs', 'RUNNER_ADDENDUM.md'];
const fixtureNames = [
  'runner-path-fixture/workspace/.foundry/artifacts/supplied-run/manifest.json',
  'runner-path-fixture/workspace/artifacts/supplied-run/manifest.json',
];

export function verifyRunnerAddendum() {
  const original = verifyPartitionFreeze();
  const bytes = readFileSync(path.join(ROOT, 'RUNNER_ADDENDUM.json'));
  const addendum = JSON.parse(bytes);
  assert.equal(addendum.originalFreezeSha256, original.freezeSha256);
  assert.equal(addendum.suiteSha256, sha(readFileSync(path.join(ROOT, 'SUITE.json'))));
  assert.equal(addendum.expectationsSha256, sha(readFileSync(path.join(ROOT, 'EXPECTATIONS.json'))));
  assert.equal(addendum.nativeMaxStepsPerRun, 160);
  assert.deepEqual(addendum.reservation, { primary: 98, counterpart: 98, sum: 196 });
  for (const entry of addendum.files) assert.equal(sha(readFileSync(path.join(ROOT, entry.name))), entry.sha256, `Runner addendum file changed: ${entry.name}`);
  return { ...original, addendum, addendumSha256: sha(bytes) };
}

export function freezeRunnerAddendum() {
  const original = verifyPartitionFreeze();
  assert.equal(existsSync(path.join(ROOT, 'RUNNER_ADDENDUM.json')), false, 'Runner addendum already frozen');
  assert.equal(existsSync(path.join(ROOT, 'EXECUTION-primary.json')), false, 'No primary exposure/reservation permitted before runner addendum');
  assert.equal(existsSync(path.join(ROOT, 'EXECUTION-counterpart.json')), false, 'No counterpart exposure/reservation permitted before runner addendum');
  const syntax = sourceNames.filter(name => name.endsWith('.mjs')).map(name => {
    const result = spawnSync(process.execPath, ['--check', path.join(ROOT, name)], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, `Syntax failure: ${name}: ${result.stderr}`);
    return { file: name, exitCode: result.status };
  });
  const testResult = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(ROOT, 'runner-v2.test.mjs')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(testResult.status, 0, testResult.stderr || testResult.stdout);
  writeNew(path.join(ROOT, 'RUNNER_TESTS.json'), {
    checkedAt: new Date().toISOString(), candidateExecutions: 0, syntax,
    command: [process.execPath, '--test', '--test-reporter=tap', 'runner-v2.test.mjs'],
    exitCode: testResult.status, stdout: testResult.stdout, stderr: testResult.stderr,
    fixtureOrigin: 'Supplied artifact and event-interval fixtures; no workflow candidate.',
  });
  const addendum = {
    schemaVersion: 'partition-validation-runner-addendum-v1', createdAt: new Date().toISOString(),
    originalFreezeSha256: original.freezeSha256,
    originalRunSha256: sha(readFileSync(path.join(ROOT, 'run.mjs'))),
    suiteSha256: sha(readFileSync(path.join(ROOT, 'SUITE.json'))),
    expectationsSha256: sha(readFileSync(path.join(ROOT, 'EXPECTATIONS.json'))),
    approvedRunner: 'run-v2.mjs', nativeMaxStepsPerRun: 160,
    reservation: { primary: 98, counterpart: 98, sum: 196 },
    reason: 'Prime found that native result.workspace is the workspace root; artifact reads must include .foundry before artifacts.',
    exposure: 'Frozen before any model candidate read, execution, or execution reservation.',
    interfaceReview: {
      source: '../oracle-v2.mjs',
      attempt: { lines: '195-199', fields: ['sampleId', 'instrument', 'valid', 'completedSequence'] },
      publication: { lines: '227-228', fields: ['startedSequence', 'completedSequence', 'valid'] },
      diagnostic: { lines: '241-262', fields: ['passed', 'requiredAttempts', 'incompleteAtPublication', 'enforced'] },
      conclusion: 'Existing diagnostic field names and strict before-start comparison match the permitted v2 source. False validity and missing or duplicate attempts remain incomplete; empty input still requires publication.',
    },
    files: [...sourceNames, ...fixtureNames, 'RUNNER_TESTS.json'].map(name => ({ name, sha256: sha(readFileSync(path.join(ROOT, name))) })),
  };
  writeNew(path.join(ROOT, 'RUNNER_ADDENDUM.json'), addendum);
  const verified = verifyRunnerAddendum();
  console.log(json({ status: 'READY_V2', originalFreezeSha256: original.freezeSha256,
    addendumSha256: verified.addendumSha256, suiteSha256: addendum.suiteSha256,
    runnerPath: path.join(ROOT, 'run-v2.mjs'), caseCount: 98, candidateExecutions: 0,
    syntaxChecksPassed: syntax.length, testsExitCode: testResult.status, reservation: addendum.reservation }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) freezeRunnerAddendum();
