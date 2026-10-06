// Post-execution comparison only. Reads preserved evidence; executes no workflow.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual as equal } from 'node:util';
import { ROOT, sha, writeNew } from './freeze.mjs';
import { verifyRunnerAddendum } from './runner-addendum.mjs';

assert.equal(process.argv.length, 2, 'This saved-evidence comparison accepts no arguments');
assert.equal(existsSync(path.join(ROOT, 'COMPARISON.json')), false, 'Comparison receipt is write-once');
const verified = verifyRunnerAddendum();
const load = file => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
const fileHash = file => sha(readFileSync(path.join(ROOT, file)));
const suite = load('SUITE.json'), expected = load('EXPECTATIONS.json'), index = load('INDEX.json');
const arms = Object.fromEntries(['primary', 'counterpart'].map(label => [label, {
  report: load(`${label}/evaluation/REPORT.json`), result: load(`${label}/RESULTS.json`),
  binding: load(`${label}/BINDING.json`), candidate: load(`${label}/CANDIDATE.json`),
  reservation: load(`EXECUTION-${label}.json`),
}]));
assert.equal(suite.cases.length, 98);
assert.equal(arms.primary.reservation.reservedCases + arms.counterpart.reservation.reservedCases, 196);
for (const [label, arm] of Object.entries(arms)) {
  assert.equal(arm.report.cases.length, 98);
  assert.equal(arm.result.cases.length, 98);
  assert.equal(fileHash(`${label}/CANDIDATE.json`), arm.binding.candidateFileSha256);
  assert.equal(arm.binding.freezeSha256, verified.freezeSha256);
  assert.equal(arm.binding.addendumSha256, verified.addendumSha256);
  assert.equal(arm.candidate.budget.maxSteps, 160);
}

function differences(a, b, pointer = '') {
  if (equal(a, b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap(key =>
      differences(a[key], b[key], `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`));
  }
  return [{ pointer, primary: a, counterpart: b }];
}
const sourceDifferences = differences(arms.primary.candidate, arms.counterpart.candidate);
assert.deepEqual(sourceDifferences, [
  { pointer: '/nodes/0/body/nodes/6/args/disposition', primary: 'confirmed', counterpart: 'inconclusive' },
  { pointer: '/version', primary: 2, counterpart: 1 },
]);

const key = value => JSON.stringify([value.sampleId, value.instrument]);
const attemptTrace = reportCase => reportCase.instrumentLog.map(value => ({
  ordinal: value.ordinal, sampleId: value.sampleId, instrument: value.instrument,
  nodeKey: value.nodeKey, outcome: value.outcome, observation: value.observation, errorCode: value.errorCode,
}));
const intervalTrace = reportCase => ({
  attempts: reportCase.instrumentAudit.attempts.map(value => ({
    sampleId: value.sampleId, instrument: value.instrument, nodeKey: value.nodeKey,
    intentSequence: value.intentSequence, completedSequence: value.completedSequence,
    valid: value.valid, validatedReturn: value.validatedReturn, outcome: value.outcome,
  })),
  publications: reportCase.instrumentAudit.publications.map(value => ({
    nodeKey: value.nodeKey, startedSequence: value.startedSequence,
    completedSequence: value.completedSequence, valid: value.valid,
  })),
});

function inspect(label, position) {
  const reportCase = arms[label].report.cases[position], saved = arms[label].result.cases[position];
  const item = suite.cases[position], direct = expected[position];
  assert.equal(reportCase.id, item.id);
  assert.equal(saved.id, item.id);
  const artifactFile = path.resolve(reportCase.workspace, '.foundry', 'artifacts', reportCase.runId, 'manifest.json');
  assert.ok(artifactFile.startsWith(path.join(ROOT, label) + path.sep));
  const bytes = readFileSync(artifactFile), manifest = JSON.parse(bytes.toString('utf8'));
  const exact = equal(manifest, direct.manifest);
  assert.equal(exact, saved.exactIndependentManifest);
  assert.equal(sha(bytes), reportCase.evidenceBinding.manifestSha256);
  assert.equal(reportCase.evidenceBinding.passed, true);
  assert.deepEqual(reportCase.instrumentLog.map(key).sort(), direct.requiredAttempts.map(key).sort());
  let incomplete = 0;
  const audit = reportCase.instrumentAudit;
  for (const publication of audit.publications) for (const requirement of direct.requiredAttempts) {
    const matches = audit.attempts.filter(attempt => key(attempt) === key(requirement));
    if (matches.length !== 1 || !matches[0].valid || !Number.isInteger(matches[0].completedSequence)
      || matches[0].completedSequence <= 0 || matches[0].completedSequence >= publication.startedSequence) incomplete++;
  }
  const allProcessingPassed = audit.publications.length > 0 && incomplete === 0;
  assert.equal(allProcessingPassed, saved.allProcessingBeforePublication.passed);
  assert.equal(incomplete, audit.allProcessingBeforePublication.incompleteAtPublication);
  assert.equal(audit.allProcessingBeforePublication.requiredAttempts, direct.requiredAttempts.length);
  assert.equal(reportCase.falseSuccess, reportCase.status === 'succeeded' && !reportCase.passed);
  const rowDifferences = direct.manifest.samples.flatMap((row, rowIndex) => equal(row, manifest.samples[rowIndex]) ? [] : [{
    rowIndex, sampleId: row.sampleId, expected: row.disposition,
    actualSampleId: manifest.samples[rowIndex]?.sampleId, actual: manifest.samples[rowIndex]?.disposition,
  }]);
  assert.equal(manifest.samples.length, direct.manifest.samples.length);
  return { nativePassed: reportCase.passed, status: reportCase.status, falseSuccess: reportCase.falseSuccess,
    exactManifest: exact, artifactSha256: sha(bytes), permittedAttempts: true,
    allProcessingPassed, incompleteAtPublication: incomplete, rowDifferences };
}

const cases = suite.cases.map((item, position) => {
  const primary = inspect('primary', position), counterpart = inspect('counterpart', position);
  const expectedConfirmed = expected[position].manifest.samples.filter(row => row.disposition === 'confirmed').length;
  assert.equal(primary.nativePassed, true);
  assert.equal(primary.exactManifest, true);
  assert.equal(counterpart.falseSuccess, expectedConfirmed > 0);
  assert.equal(counterpart.rowDifferences.length, expectedConfirmed);
  for (const row of counterpart.rowDifferences) {
    assert.equal(row.sampleId, row.actualSampleId);
    assert.equal(row.expected, 'confirmed');
    assert.equal(row.actual, 'inconclusive');
  }
  return { id: item.id, group: index.find(entry => entry.id === item.id).group, primary, counterpart,
    sameInstrumentTrace: equal(attemptTrace(arms.primary.report.cases[position]), attemptTrace(arms.counterpart.report.cases[position])),
    sameIntervalTrace: equal(intervalTrace(arms.primary.report.cases[position]), intervalTrace(arms.counterpart.report.cases[position])) };
});
const groups = {};
for (const item of cases) {
  const group = groups[item.group] ??= { cases: 0, primaryPassed: 0, counterpartPassed: 0, counterpartFalseSuccess: 0, incorrectRows: 0 };
  group.cases++;
  group.primaryPassed += Number(item.primary.nativePassed);
  group.counterpartPassed += Number(item.counterpart.nativePassed);
  group.counterpartFalseSuccess += Number(item.counterpart.falseSuccess);
  group.incorrectRows += item.counterpart.rowDifferences.length;
}
const labels = Object.keys(arms);
const files = ['FREEZE.json', 'RUNNER_ADDENDUM.json', 'SUITE.json', 'EXPECTATIONS.json', 'compare-saved.mjs',
  ...labels.flatMap(label => [`${label}/RESULTS.json`, `${label}/evaluation/REPORT.json`, `${label}/BINDING.json`,
    `${label}/CANDIDATE.json`, `EXECUTION-${label}.json`])];
const output = {
  schemaVersion: 'partition-validation-saved-comparison-v1', createdAt: new Date().toISOString(),
  analysisOnly: true, newCandidateExecutions: 0, totalCandidateExecutions: 196, nativeMaxSteps: 160,
  sourceDifferences, sameGuardsAndDependencies: true,
  sameInstrumentTraceCases: cases.filter(item => item.sameInstrumentTrace).length,
  sameIntervalTraceCases: cases.filter(item => item.sameIntervalTrace).length,
  primaryPassed: cases.filter(item => item.primary.nativePassed).length,
  counterpartPassed: cases.filter(item => item.counterpart.nativePassed).length,
  counterpartFalseSuccessCount: cases.filter(item => item.counterpart.falseSuccess).length,
  counterpartIncorrectRows: cases.reduce((count, item) => count + item.counterpart.rowDifferences.length, 0),
  groups, falseSuccessCaseIds: cases.filter(item => item.counterpart.falseSuccess).map(item => item.id),
  cases, bindings: Object.fromEntries(labels.map(label => [label, {
    workflowHash: arms[label].report.workflowHash, candidateFileSha256: arms[label].binding.candidateFileSha256,
    firstReadAt: arms[label].binding.candidateReadAt, metrics: arms[label].report.metrics,
  }])), fileHashes: Object.fromEntries(files.map(file => [file, fileHash(file)])),
  interpretation: 'The faulty control preserves guard/dependency behavior and substitutes inconclusive for confirmed. Exact output checks reject all 18 affected cases (28 rows) despite successful runtime status and completed permitted attempts. This control does not establish rejection sensitivity to faulty guards or premature publication.',
  qualification: 'Comparison of the same 98 frozen schema-valid cases. Artifact bytes were reread; attempt requirements were independently authored; interval checks use saved native v2 audited intervals, not a separately implemented raw-event auditor. No universal, population, or general causal-use claim.',
};
assert.equal(output.sameInstrumentTraceCases, 98);
assert.equal(output.sameIntervalTraceCases, 98);
assert.equal(output.counterpartFalseSuccessCount, 18);
assert.equal(output.counterpartIncorrectRows, 28);
assert.equal(verifyRunnerAddendum().addendumSha256, verified.addendumSha256);
writeNew(path.join(ROOT, 'COMPARISON.json'), output);
console.log(JSON.stringify({ ...output, cases: undefined, bindings: undefined, fileHashes: undefined }, null, 2));
