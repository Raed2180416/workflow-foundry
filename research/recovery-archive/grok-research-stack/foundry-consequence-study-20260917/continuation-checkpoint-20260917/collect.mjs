import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyFreeze } from '../benchmark/oracle-v2.mjs';

// Read-only evidence aggregation. This executes no workflow, provider or audit
// checker, and never turns a reported pass into a new independent qualification.
const directory = path.dirname(fileURLToPath(import.meta.url));
const study = path.dirname(directory);
const evidence = [];
const sha = value => createHash('sha256').update(value).digest('hex');
function json(relative) {
  const absolute = path.join(study, relative), bytes = readFileSync(absolute);
  evidence.push({ path: relative, bytes: bytes.length, sha256: sha(bytes) });
  return JSON.parse(bytes.toString('utf8'));
}
const freeze = verifyFreeze();
const model = json('benchmark/outcome-model-001/RESULTS.json');
const job = json('benchmark/outcome-model-001/GENERATION_JOB.json');
const review = json('outcome-model-independent-20260917/RESULT_AUDIT.json');
const paired = json('benchmark/partition-validation-20260917/COMPARISON.json');
const primary = json('benchmark/partition-validation-20260917/primary/RESULTS.json');
const counterpart = json('benchmark/partition-validation-20260917/counterpart/RESULTS.json');
const cli = json('outcome-cli-20260917/verification-Eubfvm/REPORT.json');
const example = json('continuation-checkpoint-20260917/DOCUMENTED_EXAMPLE_CHECK.json');
const provider = json('benchmark/campaign-opencode-v2-continuation-001/RESULTS.json');
const providerFinal = json('benchmark/campaign-opencode-v2-continuation-001/FINALIZED.json');
assert.equal(providerFinal.resultsSHA256, sha(readFileSync(path.join(study, 'benchmark/campaign-opencode-v2-continuation-001/RESULTS.json'))));
assert.equal(providerFinal.accountingSHA256, sha(readFileSync(path.join(study, 'benchmark/campaign-opencode-v2-continuation-001/ACCOUNTING.json'))));
const providerReview = json('provider-continuation-20260917/RESULT_REVIEW.json');
const dependency = json('outcome-dependency-study-20260917/run-001/RESULTS.json');
assert.equal(model.success, true); assert.equal(model.finalOutcome, 'satisfied');
assert.equal(model.initialOutcome, 'unsatisfied'); assert.equal(model.initialStatus, 'succeeded');
assert.equal(job.attempts.length, 1); assert.equal(review.passedChecks, 19); assert.equal(review.failedChecks, 0);
assert.equal(primary.nativePassedCount, 98); assert.equal(primary.exactIndependentManifestCount, 98);
assert.equal(counterpart.nativePassedCount, 80); assert.equal(counterpart.falseSuccessCount, 18);
assert.equal(paired.totalCandidateExecutions, 196); assert.equal(paired.sameInstrumentTraceCases, 98);
assert.equal(cli.passed, true); assert.equal(example.passed, true);
assert.equal(provider.success, false); assert.equal(provider.accounting.providerInvocations, 1);
assert.equal(providerReview.partialStream.answerContentUTF8Bytes, 0);
assert.equal(providerReview.partialStream.usageRecords, 0); assert.equal(dependency.passed, true);
const artifact = {
  schemaVersion: 'foundry-continuation-checkpoint/1', collectedAt: new Date().toISOString(),
  scope: 'Evidence aggregation from actual saved runs; not an additional independent experiment.',
  coreEvaluatorFreeze: { passed: true, at: freeze.frozenAt },
  modelRepair: { completed: true, configuredModel: 'COS model 6 / pro', attempts: job.attempts.length,
    workflowHash: model.workflowHash, development: '5/5', withheldRegression: '8/8',
    nativeBefore: 'succeeded', observedBefore: 'unsatisfied', nativeAfter: 'succeeded', observedAfter: 'satisfied',
    independentSavedAudit: { passed: review.passedChecks, failed: review.failedChecks },
    limit: 'Same builder restores a researcher-injected single-field fault; expected development feedback and prior solution memory are available. Not natural-error or novel-diagnosis discovery.' },
  independentlyAuthoredPartitions: { casesPerArm: 98, actualExecutions: 196,
    repaired: 98, faulty: 80, faultyGreenButWrongCases: 18, faultyWrongRows: paired.counterpartIncorrectRows,
    unchangedAttemptAndIntervalPairs: 98,
    limit: 'Finite valid-schema partitions for one fixed objective. Outcome rejection is exercised; this mutation does not test rejection of bad guards or ordering.' },
  product: { explicitOutcomeCLI: 'tested and installed', originalFullSuite: cli.results.find(row => row.name === 'repository-tests').tests,
    documentedOfflineExample: 'literal bash block independently executed and observed wrong v1 to right v2',
    exampleModelCalls: 0 },
  freeProvider: { model: 'opencode/big-pickle', completed: false, httpStatus: 200,
    providerCalls: 1, finalAnswerBytes: 0, terminalUsageRecords: 0,
    observedCode: provider.error.code,
    diagnosis: providerReview.abortAnalysis.bestSupportedCause,
    diagnosisQualification: providerReview.abortAnalysis.confidence,
    billedUsage: 'unobserved', modelScale: 'unknown', retries: 0, paidFallbacks: 0,
    sourceStatus: 'The historical campaign retains its original sourceStable result. Any later adapter patch is a separate source revision, not retroactive success.' },
  jev: { calls: 0, reason: 'Supported current execution context has no gateway key/OIDC; no credential exposure or invented calibration.' },
  dependencyWitness: { nativeRuns: 1, modelCalls: 0, historicalReceiptPreserved: true,
    currentVerifyAndRepairAfterUnusedCatalogAddition: 'rejected', identicalOracleRebinding: 'rejected',
    restoringCatalogRestoresVerify: true },
  additionalEvidence: {},
  excludedClaims: ['General process invention', 'Autonomous intent formalization', 'General business outcome verification',
    'Jev accuracy/calibration', 'Known-scale cheap-model success', 'Learning', 'Production deployment readiness',
    'Cross-registry repair/promotion is implemented'],
  evidence,
};
for (const relative of ['outcome-history-20260917/FINALIZED.json', 'outcome-history-20260917/FINALIZED_V2.json', 'provider-termination-fix-20260917/FINALIZED.json',
  'history-independent-review-20260917/AUDIT.json', 'continuation-checkpoint-20260917/HISTORY_CLI_CHECK.json',
  'continuation-checkpoint-20260917/HISTORY_CLI_CHECK_V2.json',
  'continuation-checkpoint-20260917/OPT_IN_REGRESSION.json',
  'continuation-checkpoint-20260917/FINAL_REGRESSION.json']) {
  artifact.additionalEvidence[relative] = existsSync(path.join(study, relative)) ? json(relative) : { status: 'not-finalized-at-collection' };
}
if (process.argv.includes('--write')) {
  const required = ['outcome-history-20260917/FINALIZED_V2.json', 'provider-termination-fix-20260917/FINALIZED.json',
    'history-independent-review-20260917/AUDIT.json', 'continuation-checkpoint-20260917/HISTORY_CLI_CHECK_V2.json',
    'continuation-checkpoint-20260917/FINAL_REGRESSION.json', 'continuation-checkpoint-20260917/OPT_IN_REGRESSION.json'];
  for (const relative of required) assert.ok(existsSync(path.join(study, relative)), `Not finalized: ${relative}`);
  const full = artifact.additionalEvidence['continuation-checkpoint-20260917/FINAL_REGRESSION.json'];
  const optional = artifact.additionalEvidence['continuation-checkpoint-20260917/OPT_IN_REGRESSION.json'];
  const history = artifact.additionalEvidence['history-independent-review-20260917/AUDIT.json'];
  assert.equal(full.passed, true); assert.equal(optional.passed, true);
  assert.equal(history.passedChecks, 14); assert.equal(history.failedChecks, 0);
  assert.equal(history.source.sha256, full.sourceAfter['src/outcome-history.mjs']);
  for (const [relative, expectedHash] of Object.entries(full.sourceAfter)) {
    assert.equal(sha(readFileSync(path.resolve(study, '../../workflow-foundry', relative))), expectedHash, `Source changed after final tests: ${relative}`);
  }
  writeFileSync(path.join(directory, 'EVIDENCE.json'), JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ evidence: path.join(directory, 'EVIDENCE.json'), sourceRecords: evidence.length, collectedAt: artifact.collectedAt }));
} else console.log(JSON.stringify(artifact, null, 2));
