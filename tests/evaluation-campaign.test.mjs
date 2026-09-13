import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyIndependentAudit, verifyAuditReplay, summarizeOutcomes } from '../evals/sre-campaign.mjs';

const files = ['src/runtime.mjs', 'src/store.mjs', 'src/capabilities.mjs', 'src/data.mjs', 'src/validate.mjs', 'schemas/workflow.schema.json', 'package.json', 'package-lock.json', 'tests/evidence-contract-audit.test.mjs'];
const hashes = Object.fromEntries(files.map(file => [file, 'unit-hash-' + file]));
const validAudit = () => ({
  run: 'synthetic-unit-test', exitCode: 0, sourceStable: true, signal: null, error: null,
  command: ['node', '--test', 'tests/evidence-contract-audit.test.mjs'],
  sourceHashesBefore: structuredClone(hashes), sourceHashesAfter: structuredClone(hashes),
  stdout: '# tests 55\n# pass 55\n# fail 0\n# skipped 0\n',
});

test('campaign gate requires a passing latest independent source-bound audit', () => {
  assert.equal(verifyIndependentAudit([validAudit()], hashes).tests, 55);
  for (const mutate of [
    r => { r.exitCode = 1; }, r => { r.sourceStable = false; },
    r => { r.sourceHashesAfter['src/runtime.mjs'] = 'changed'; },
    r => { delete r.sourceHashesBefore['src/capabilities.mjs']; },
    r => { r.stdout = '# tests 55\n# pass 54\n# fail 0\n# skipped 1\n'; },
    r => { r.command = ['node', '--test', 'tests/unrelated.test.mjs']; },
  ]) {
    const bad = validAudit(); mutate(bad);
    assert.throws(() => verifyIndependentAudit([validAudit(), bad], hashes));
  }
});

test('campaign metrics distinguish safe no-op failure from useful recovery and retain missing cases', () => {
  const cases = [
    { id: 'recover', requiredOutcome: 'recovered', stratum: 'signals' },
    { id: 'block', requiredOutcome: 'fail-closed', stratum: 'invalid' },
    { id: 'unobserved', requiredOutcome: 'fail-closed', stratum: 'invalid' },
  ];
  const outcomes = [
    { caseId: 'recover', passed: false, runStatus: 'failed', actions: [] },
    { caseId: 'block', passed: true, runStatus: 'failed', actions: [] },
  ];
  const summary = summarizeOutcomes(outcomes, cases);
  assert.deepEqual(summary.recovery, { passed: 0, total: 1 });
  assert.deepEqual(summary.failClosed, { passed: 1, total: 2 });
  assert.equal(summary.observedCases, 2);
  assert.equal(summary.totalCases, 3);
  assert.equal(summary.falseSuccesses, 0);
  assert.deepEqual(summary.strata.invalid, { passed: 1, total: 2 });
  outcomes[1] = { caseId: 'block', passed: false, runStatus: 'succeeded', actions: ['rollback'] };
  assert.equal(summarizeOutcomes(outcomes, cases).invalidEvidenceEffects, 1);
  assert.equal(summarizeOutcomes(outcomes, cases).falseSuccesses, 1);
});

test('current audit replay retains author attribution and rejects edited independent tests', () => {
  const original = validAudit();
  const replay = { ...validAudit(), testAuthor: 'worker-2', executedBy: 'worker-5', originalAuditRun: original.run };
  assert.equal(verifyAuditReplay([original], replay, hashes).executedBy, 'worker-5');
  assert.throws(() => verifyAuditReplay([original], { ...replay, executedBy: 'worker-2' }, hashes));
  const changed = { ...hashes, 'tests/evidence-contract-audit.test.mjs': 'different-tests' };
  assert.throws(() => verifyAuditReplay([original], { ...replay, sourceHashesBefore: changed, sourceHashesAfter: changed }, changed));
});
