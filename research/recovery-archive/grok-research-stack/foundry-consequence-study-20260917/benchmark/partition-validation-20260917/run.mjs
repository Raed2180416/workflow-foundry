import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ROOT, sha, json, writeNew, verifyPartitionFreeze } from './freeze.mjs';

const [label, suppliedFile] = process.argv.slice(2);
assert.ok(['primary', 'counterpart'].includes(label) && suppliedFile, 'Usage: node run.mjs primary|counterpart /exact/prime-supplied-workflow.json');
assert.equal(process.argv.length, 4, 'Exactly two positional arguments are accepted');
const { freeze, freezeSha256 } = verifyPartitionFreeze();
const suite = JSON.parse(readFileSync(path.join(ROOT, 'SUITE.json'), 'utf8'));
const expected = JSON.parse(readFileSync(path.join(ROOT, 'EXPECTATIONS.json'), 'utf8'));
assert.equal(suite.cases.length, freeze.reservation[label]);
if (label === 'counterpart') assert.ok(existsSync(path.join(ROOT, 'EXECUTION-primary.json')), 'Primary reservation must precede counterpart');
const consumed = ['primary', 'counterpart'].filter(name => existsSync(path.join(ROOT, `EXECUTION-${name}.json`)))
  .reduce((sum, name) => sum + JSON.parse(readFileSync(path.join(ROOT, `EXECUTION-${name}.json`))).reservedCases, 0);
assert.ok(consumed + suite.cases.length <= 200, 'Total candidate execution reservation exceeds cap');
const output = path.join(ROOT, label);
assert.equal(existsSync(output), false, 'Existing result directories are never reused');
writeNew(path.join(ROOT, `EXECUTION-${label}.json`), {
  label, reservedAt: new Date().toISOString(), reservedCases: suite.cases.length,
  totalReservedCases: consumed + suite.cases.length, freezeSha256, suppliedPath: path.resolve(suppliedFile),
});
mkdirSync(output, { mode: 0o700 });

try {
  const candidateReadAt = new Date().toISOString();
  const candidateBytes = readFileSync(path.resolve(suppliedFile));
  const workflow = JSON.parse(candidateBytes.toString('utf8'));
  writeFileSync(path.join(output, 'CANDIDATE.json'), candidateBytes, { flag: 'wx', mode: 0o600 });
  writeNew(path.join(output, 'BINDING.json'), {
    label, candidateReadAt, frozenAt: freeze.createdAt, freezeSha256,
    candidateFileSha256: sha(candidateBytes), candidateSourcePath: path.resolve(suppliedFile),
    suiteFileSha256: sha(readFileSync(path.join(ROOT, 'SUITE.json'))),
    nativeMaxStepsPerRun: 160, reservedCases: suite.cases.length,
  });
  // Required native evaluator only after the independent freeze and explicit file supply.
  // Its internal legacy validation is not used to construct or revise expectations.
  const { evaluateCandidate } = await import('../oracle-v2.mjs');
  const report = await evaluateCandidate(workflow, suite, { directory: path.join(output, 'evaluation') });
  const replay = report.cases.map((result, position) => {
    const direct = expected[position];
    const artifactFile = result.runId ? path.join(result.workspace, 'artifacts', result.runId, 'manifest.json') : null;
    let manifest = null, artifactError = null;
    try { if (artifactFile) manifest = JSON.parse(readFileSync(artifactFile, 'utf8')); }
    catch (error) { artifactError = { code: error.code ?? error.name, message: error.message }; }
    const key = item => JSON.stringify([item.sampleId, item.instrument]);
    const allowed = direct.requiredAttempts.map(key).sort();
    const actual = (result.instrumentLog ?? []).map(key).sort();
    const audit = result.instrumentAudit;
    let incompleteAtPublication = 0;
    for (const publication of audit.publications) for (const requirement of direct.requiredAttempts) {
      const matches = audit.attempts.filter(attempt => key(attempt) === key(requirement));
      if (matches.length !== 1 || !matches[0].valid || matches[0].completedSequence >= publication.startedSequence) incompleteAtPublication++;
    }
    const allProcessingPassed = audit.publications.length > 0 && incompleteAtPublication === 0;
    return {
      id: suite.cases[position].id, runId: result.runId ?? null, nativePassed: result.passed,
      status: result.status, falseSuccess: result.falseSuccess,
      exactIndependentManifest: isDeepStrictEqual(manifest, direct.manifest),
      permittedAttemptMultiset: isDeepStrictEqual(actual, allowed),
      requiredAttempts: direct.requiredAttempts.length, syntheticCostExpected: direct.syntheticCost,
      syntheticCostObserved: (result.instrumentLog ?? []).reduce((sum, attempt) => sum + (attempt.instrument === 'screen' ? 1 : attempt.instrument === 'reproduce' ? 10 : 0), 0),
      allProcessingBeforePublication: { passed: allProcessingPassed, enforced: false, incompleteAtPublication,
        agreesWithNativeDiagnostic: allProcessingPassed === audit.allProcessingBeforePublication.passed
          && incompleteAtPublication === audit.allProcessingBeforePublication.incompleteAtPublication
          && direct.requiredAttempts.length === audit.allProcessingBeforePublication.requiredAttempts },
      nativeProblems: audit.problems, artifactFile, artifactError,
      expectedManifest: direct.manifest, actualManifest: manifest,
    };
  });
  verifyPartitionFreeze();
  const result = {
    label, finishedAt: new Date().toISOString(), freezeSha256,
    candidateFileSha256: sha(candidateBytes), suiteFileSha256: sha(readFileSync(path.join(ROOT, 'SUITE.json'))),
    workflowHash: report.workflowHash, suiteHash: report.suiteHash, evaluatorId: report.evaluatorId,
    registryHash: report.registryHash, nativeMaxStepsPerRun: 160,
    caseCount: replay.length, nativePassedCount: replay.filter(item => item.nativePassed).length,
    exactIndependentManifestCount: replay.filter(item => item.exactIndependentManifest).length,
    permittedAttemptMultisetCount: replay.filter(item => item.permittedAttemptMultiset).length,
    falseSuccessCount: replay.filter(item => item.falseSuccess).length,
    allProcessingBeforePublication: {
      enforced: false, passedCount: replay.filter(item => item.allProcessingBeforePublication.passed).length,
      diagnosticAgreementCount: replay.filter(item => item.allProcessingBeforePublication.agreesWithNativeDiagnostic).length,
      incompleteAtPublication: replay.reduce((sum, item) => sum + item.allProcessingBeforePublication.incompleteAtPublication, 0),
      basis: 'Independent required-attempt sets compared against v2 audited native attempt/publication intervals.',
    },
    nativeMetrics: report.metrics, cases: replay,
    passed: report.passed && replay.length === suite.cases.length
      && replay.every(item => item.exactIndependentManifest && item.permittedAttemptMultiset
        && item.allProcessingBeforePublication.agreesWithNativeDiagnostic),
    qualification: 'Only the frozen 98 cases; all-status completion is a separately reported diagnostic. Finite swaps and temporal order do not prove general causal use or universal correctness.',
  };
  writeNew(path.join(output, 'RESULTS.json'), result);
  console.log(json({ label, passed: result.passed, caseCount: result.caseCount,
    nativePassedCount: result.nativePassedCount, exactIndependentManifestCount: result.exactIndependentManifestCount,
    permittedAttemptMultisetCount: result.permittedAttemptMultisetCount, falseSuccessCount: result.falseSuccessCount,
    allProcessingBeforePublication: result.allProcessingBeforePublication, nativeMetrics: result.nativeMetrics,
    resultsPath: path.join(output, 'RESULTS.json') }));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  writeNew(path.join(output, 'RUN-ERROR.json'), {
    at: new Date().toISOString(), label, freezeSha256,
    code: error.code ?? error.name, message: error.message, details: error.details ?? null,
    reservedCases: suite.cases.length, qualification: 'Reservation is retained; no automatic rerun or budget increase.',
  });
  console.error(json({ label, code: error.code ?? error.name, message: error.message, output }));
  process.exitCode = 1;
}
