// Focused re-audit of preserved independent evidence. No workflow execution,
// model call, supplied graph inspection, or sealed fixture parsing occurs here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARK = path.resolve(ROOT, '..', 'benchmark');
const source = path.join(BENCHMARK, 'oracle-v2.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFile = file => sha(fs.readFileSync(file));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const [expectedSourceHash, outputName = 'receipt-v2-001'] = process.argv.slice(2);
assert.match(expectedSourceHash ?? '', /^[0-9a-f]{64}$/, 'Pass the reviewed v2 source byte hash');
assert.match(outputName, /^receipt-v2-[0-9]{3}$/);
assert.equal(hashFile(source), expectedSourceHash, 'V2 changed since source review');

const output = path.join(ROOT, outputName);
fs.mkdirSync(output, { mode: 0o700 }); // Existing evidence is never overwritten.
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const targets = [
  { name: 'early-confirmation', fixtureValid: true, gatePassed: false, problem: 'confirmation_before_completed_validated_reproduction' },
  { name: 'raw-invalid-reproduction-confirmed', fixtureValid: false, gatePassed: false, problem: 'instrument_native_completion_invalid' },
  { name: 'raw-invalid-screen', fixtureValid: false, gatePassed: false, problem: 'instrument_native_completion_invalid' },
  { name: 'observed-positive-control', fixtureValid: true, gatePassed: true },
  { name: 'early-confirmation-counterfactual', fixtureValid: true, gatePassed: false, problem: 'confirmation_before_completed_validated_reproduction' }
];
const originals = ['NOTE.md', 'AUDIT.json', 'check.mjs', 'FINAL_CHECK.json', 'PRE_REVIEW.json', 'WITNESS_PATHS.json'].map(name => path.join(ROOT, name));
const frozenFiles = readJson(path.join(BENCHMARK, 'FREEZE.json')).files;
// Frozen sealed files are hashed as bytes only; their cases and labels are never parsed.
const protectedFiles = [...new Set([...originals, path.join(BENCHMARK, 'FREEZE.json'), source, ...frozenFiles.map(item => item.path)])];
const before = protectedFiles.map(file => ({ path: file, sha256: hashFile(file) }));
for (const item of frozenFiles) assert.equal(hashFile(item.path), item.sha256, `V1 freeze drift at ${item.path}`);
save('SOURCE_BEFORE.json', before);

const { auditInstruments, validateFixtures, PUBLICATION_POLICY, PUBLIC_V2_RULES } = await import(source);
const { digest } = await import('/home/raed/Projects/workflow-foundry/src/data.mjs');
const results = [];
for (const target of targets) {
  const directory = path.join(ROOT, 'run-001', target.name);
  const names = ['WORKFLOW.json', 'SUITE.json', 'NATIVE.json', 'RUN-0.json', 'TRACE-0.json', 'LOG-0.json'];
  const receipts = names.map(name => ({ path: path.join(directory, name), sha256: hashFile(path.join(directory, name)) }));
  const workflow = readJson(path.join(directory, 'WORKFLOW.json'));
  const suite = readJson(path.join(directory, 'SUITE.json'));
  const native = readJson(path.join(directory, 'NATIVE.json'));
  const run = readJson(path.join(directory, 'RUN-0.json'));
  const events = readJson(path.join(directory, 'TRACE-0.json'));
  const log = readJson(path.join(directory, 'LOG-0.json'));
  assert.equal(suite.cases.length, 1);
  assert.equal(native.cases.length, 1);
  assert.equal(run.workflowHash, digest(workflow));
  assert.equal(native.workflowHash, run.workflowHash);
  assert.equal(native.cases[0].runId, run.id);
  assert.equal(native.cases[0].status, run.status);
  assert.equal(native.registryHash, run.registryHash);
  const workspace = path.resolve(native.cases[0].workspace);
  assert.ok(workspace.startsWith(`${directory}${path.sep}`));
  assert.equal(fs.realpathSync(workspace), workspace);
  const artifactPath = path.join(workspace, '.foundry', 'artifacts', run.id, 'manifest.json');
  assert.ok(fs.lstatSync(artifactPath).isFile());
  assert.equal(fs.realpathSync(artifactPath), artifactPath);
  const bytes = fs.readFileSync(artifactPath), text = bytes.toString('utf8');
  const artifact = { manifest: JSON.parse(text), text, bytes: bytes.length, sha256: sha(bytes), argsHash: digest({ name: 'manifest.json', content: text }) };
  receipts.push({ path: artifactPath, sha256: artifact.sha256 });
  assert.equal(native.cases[0].artifacts.find(item => item.name === 'manifest.json').sha256, artifact.sha256);

  let fixtureValidation = null, fixtureError = null;
  try { fixtureValidation = validateFixtures(suite); }
  catch (error) { fixtureError = { code: error.code ?? 'ERROR', message: error.message }; }
  assert.equal(fixtureError === null, target.fixtureValid, target.name);
  if (!target.fixtureValid) assert.equal(fixtureError.code, 'BENCHMARK_FIXTURE_SCHEMA', target.name);
  const audit = auditInstruments(suite.cases[0], log, events, { run, artifact });
  assert.equal(audit.passed, target.gatePassed, `${target.name}: ${audit.problems.join(', ')}`);
  if (target.problem) assert.ok(audit.problems.includes(target.problem), target.name);
  assert.equal(audit.publicationContentBasis, 'independently-read-actual-artifact');
  assert.equal(audit.allProcessingBeforePublication.enforced, false);
  for (const receipt of receipts) assert.equal(hashFile(receipt.path), receipt.sha256);
  results.push({ name: target.name, expectedFixtureValid: target.fixtureValid, fixtureValidation, fixtureError,
    nativePassed: native.cases[0].passed, v2GatePassed: audit.passed, expectedGatePassed: target.gatePassed,
    combinedDecisionOnPreservedEvidence: !fixtureError && native.cases[0].passed && audit.passed,
    problems: audit.problems, logBindingErrors: audit.logBindingErrors, completionErrors: audit.completionErrors,
    evidenceOrderErrors: audit.evidenceOrderErrors, prematureConfirmations: audit.prematureConfirmations,
    publicationBindingErrors: audit.publicationBindingErrors,
    allProcessingBeforePublication: audit.allProcessingBeforePublication,
    eventCount: events.length, sourceReceipts: receipts });
}

for (const item of before) assert.equal(hashFile(item.path), item.sha256, `Protected file changed during review: ${item.path}`);
const freezeV2Path = path.join(BENCHMARK, 'FREEZE_V2.json');
const freezeV2 = fs.existsSync(freezeV2Path) ? { path: freezeV2Path, sha256: hashFile(freezeV2Path) } : null;
const report = { schemaVersion: 'independent-v2-preserved-evidence-review-v1', createdAt: new Date().toISOString(),
  source: { path: source, sha256: expectedSourceHash }, reviewScriptSHA256: hashFile(fileURLToPath(import.meta.url)),
  modelsCalled: 0, newWorkflowExecutions: 0, previousEvidenceCasesReaudited: results.length,
  previousWholeAuditRerun: false, sealedConcreteCasesParsed: false, suppliedGraphInspected: false,
  wrapperInvoked: false, qualification: 'Re-applies v2 fixture validation and event/artifact helper to five previously executed independent diagnostics; does not claim a new evaluateCandidate invocation or full v2 suite run.',
  publicRules: PUBLIC_V2_RULES, publicationPolicy: PUBLICATION_POLICY,
  causalBoundary: 'Temporal availability and validated return identity do not prove data-origin dependence. Existing evidence-swap diagnostics cover only their finite counterfactuals.',
  freezeV2AtCompletion: freezeV2, protectedFilesUnchanged: before.length, results, passed: true };
save('AUDIT.json', report);
console.log(JSON.stringify({ report: path.join(output, 'AUDIT.json'), sha256: hashFile(path.join(output, 'AUDIT.json')),
  reviewedSourceSHA256: expectedSourceHash, passed: true, newWorkflowExecutions: 0,
  cases: results.map(item => ({ name: item.name, fixtureRejected: !!item.fixtureError, nativePassed: item.nativePassed,
    v2GatePassed: item.v2GatePassed, problems: item.problems })), freezeV2AtCompletion: freezeV2,
  protectedFilesUnchanged: before.length }, null, 2));
