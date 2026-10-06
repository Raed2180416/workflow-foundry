// Additive repair of the two independently reported v1 evaluator defects.
// V1, its freeze, controls and independent review remain immutable history.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Store } from '/home/raed/Projects/workflow-foundry/src/store.mjs';
import { validateData } from '/home/raed/Projects/workflow-foundry/src/validate.mjs';
import { validateSuite } from '/home/raed/Projects/workflow-foundry/src/evaluation.mjs';
import { digest, clone, FoundryError, errorData } from '/home/raed/Projects/workflow-foundry/src/data.mjs';
import { engineHash } from '/home/raed/Projects/workflow-foundry/src/engine.mjs';
import { registryFactory } from './capabilities.mjs';
import { INPUT_SCHEMA, MANIFEST_SCHEMA, INSTRUMENT_DESCRIPTORS } from './contract.mjs';
import {
  evaluateCandidate as evaluateV1, auditInstruments as auditV1,
  verifyFreeze as verifyV1Freeze, expectedFromObservations, loadSuite,
} from './oracle.mjs';

export { expectedFromObservations, loadSuite };
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ownHash = sha(readFileSync(fileURLToPath(import.meta.url)));
const registry = registryFactory();
const registryHash = registry.hash();
const descriptor = new Map(INSTRUMENT_DESCRIPTORS.map(value => [value.name, value]));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const PUBLIC_V2_RULES = Object.freeze([
  'A confirmed row requires the same sample\'s complete positive reproduction to have finished native output validation before the successful manifest publication attempt begins. Screening must likewise have completed with a usable suspicious observation before reproduction begins.',
  'Instrument handler logs alone do not establish completed evidence. The evaluator binds each logged attempt and ordinal to the native event chain and its matching completed output or recorded error.',
  'Fixture returns outside the advertised instrument output schemas invalidate the evaluator input before workflow execution. Schema-valid incomplete observations remain valid benchmark cases and mean inconclusive under the original public rules.',
]);
export const PUBLICATION_POLICY = Object.freeze({
  id: 'confirmed-evidence-before-publication-v2',
  enforced: 'Completed, validated positive reproduction precedes each successful publication attempt containing a confirmed row.',
  timing: 'Native tool.intent is the conservative start fence; node.completed proves publication succeeded. An overlapping reproduction/publication interval is not certified.',
  allProcessing: 'Requiring every permitted instrument attempt to settle before any manifest, for every disposition, is a prospective strengthening. V2 measures it as a non-gating diagnostic; v1 PUBLIC.json is unchanged.',
  causalLimit: 'Order, binding and content are checked. A constant written after matching evidence can still pass a finite case; causal use, arbitrary asynchronous instruments and population generalization are not proven.',
});

function fixtureError(message) {
  throw new FoundryError('BENCHMARK_FIXTURE_SCHEMA', message);
}

// Validate every declared return, including unused reproduction observations.
// Deliberately missing optional evidence fields are legal, not fixture errors.
export function validateFixtures(suite) {
  validateSuite(suite);
  let instrumentFixtures = 0, returnedFixtures = 0, errorFixtures = 0;
  for (const [caseIndex, item] of suite.cases.entries()) {
    try { validateData(INPUT_SCHEMA, item.input); }
    catch { fixtureError(`Case ${caseIndex} violates the public input schema`); }
    const observations = item.fixture?.observations;
    if (!isObject(observations)) fixtureError(`Case ${caseIndex} has no observation table`);
    const ids = item.input.samples.map(sample => sample.id);
    if (Object.keys(observations).length !== ids.length || ids.some(id => !Object.hasOwn(observations, id))) {
      fixtureError(`Case ${caseIndex} observation identities differ from its input`);
    }
    for (const id of ids) {
      const pair = observations[id];
      if (!isObject(pair) || Object.keys(pair).some(key => !['screen', 'reproduce'].includes(key))) {
        fixtureError(`Case ${caseIndex} has an invalid instrument pair`);
      }
      for (const instrument of ['screen', 'reproduce']) {
        const fixture = pair[instrument];
        if (!isObject(fixture) || Object.keys(fixture).length !== 1) {
          fixtureError(`Case ${caseIndex} ${instrument} must declare exactly one return or error`);
        }
        instrumentFixtures++;
        if (Object.hasOwn(fixture, 'error')) {
          if (fixture.error !== (instrument === 'screen' ? 'SCREEN_ERROR' : 'REPRODUCTION_ERROR')) {
            fixtureError(`Case ${caseIndex} ${instrument} has an unadvertised error`);
          }
          errorFixtures++;
        } else if (Object.hasOwn(fixture, 'returned')) {
          try { validateData(descriptor.get(`lab.${instrument}`).outputSchema, fixture.returned); }
          catch { fixtureError(`Case ${caseIndex} ${instrument} return violates its output schema`); }
          returnedFixtures++;
        } else fixtureError(`Case ${caseIndex} ${instrument} has no return or error`);
      }
    }
    const expected = item.expect.artifacts?.find(value => value.name === 'manifest.json');
    if (!expected || !Object.hasOwn(expected, 'json') || expected.absent) {
      fixtureError(`Case ${caseIndex} needs an exact manifest JSON expectation`);
    }
    try { validateData(MANIFEST_SCHEMA, expected.json); }
    catch { fixtureError(`Case ${caseIndex} expected manifest violates its schema`); }
    assert.deepEqual(expected.json, expectedFromObservations(item).manifest,
      `Case ${caseIndex} expected JSON differs from the public observation rules`);
  }
  return { passed: true, caseCount: suite.cases.length, instrumentFixtures, returnedFixtures, errorFixtures };
}

export function evaluatorId(suite) {
  return `sample-consequences-v2:${digest(suite)}:${ownHash}`;
}

export function verifyFreeze() {
  verifyV1Freeze();
  const freeze = JSON.parse(readFileSync(path.join(ROOT, 'FREEZE_V2.json'), 'utf8'));
  if (freeze.schemaVersion !== 'sample-consequence-freeze-v2' || freeze.nodeVersion !== process.version) {
    throw new FoundryError('BENCHMARK_V2_DRIFT', 'V2 freeze schema or Node runtime differs');
  }
  for (const file of freeze.files) {
    if (sha(readFileSync(file.path)) !== file.sha256) {
      throw new FoundryError('BENCHMARK_V2_DRIFT', `Frozen v2 dependency changed: ${file.path}`);
    }
  }
  if (registryHash !== freeze.registryHash || digest(PUBLICATION_POLICY) !== freeze.publicationPolicyHash) {
    throw new FoundryError('BENCHMARK_V2_DRIFT', 'V2 registry or publication policy differs');
  }
  for (const split of ['development', 'sealed']) {
    const validation = validateFixtures(loadSuite(split));
    if (digest(validation) !== digest(freeze.fixtureValidation[split])) {
      throw new FoundryError('BENCHMARK_V2_DRIFT', 'V2 frozen fixture validation differs');
    }
  }
  return freeze;
}

function chainProblems(events, item, run) {
  const problems = [];
  let previousHash = null;
  for (const [index, event] of events.entries()) {
    const { hash, ...body } = event;
    if (event.seq !== index + 1 || event.previousHash !== previousHash || hash !== digest(body)) {
      problems.push('event_chain_invalid'); break;
    }
    previousHash = hash;
  }
  const birth = events[0];
  if (birth?.type !== 'run.created' || birth.inputHash !== digest(item.input)
    || birth.registryHash !== registryHash || birth.engineHash !== engineHash) problems.push('event_birth_binding_invalid');
  if (run && (run.workflowHash !== birth?.workflowHash || run.registryHash !== birth?.registryHash
    || run.engineHash !== birth?.engineHash || digest(run.input) !== birth?.inputHash
    || run.eventHead?.seq !== events.length || run.eventHead?.hash !== events.at(-1)?.hash)) {
    problems.push('run_event_binding_invalid');
  }
  return problems;
}

// Match terminal evidence to this attempt, never merely to a similarly named node.
function attemptEvents(intent, events) {
  const next = events.find(event => event.seq > intent.seq && event.nodeKey === intent.nodeKey && event.type === 'tool.intent');
  return events.filter(event => event.nodeKey === intent.nodeKey && event.seq > intent.seq && event.seq < (next?.seq ?? Infinity));
}
const positiveScreen = (value, id) => value?.ok === true && value.sampleId === id && value.suspicious === true;
const positiveReproduction = (value, id) => value?.ok === true && value.sampleId === id && value.independent === true
  && typeof value.evidenceId === 'string' && value.evidenceId.length > 0 && value.reproduced === true;

/** Audit helper expects trusted, complete native events. evaluateCandidate also
 * checks Store's durable head and supplies the actual independently read artifact.
 * Without artifact bytes this helper audits the expected manifest and does not
 * replace native exact-JSON verification. */
export function auditInstruments(item, entries, events, { run = null, artifact = null } = {}) {
  const v1 = auditV1(item, entries, events);
  const problems = [...v1.problems, ...chainProblems(events, item, run)];
  const attempts = [], instrumentIntents = events.filter(event => event.type === 'tool.intent'
    && ['lab.screen', 'lab.reproduce'].includes(event.tool));
  let logBindingErrors = 0, completionErrors = 0, evidenceOrderErrors = 0, prematureConfirmations = 0;
  if (entries.length !== instrumentIntents.length) logBindingErrors++;
  for (const [index, entry] of entries.entries()) {
    const intent = instrumentIntents[index];
    const expectedArgsHash = digest({ sampleId: entry.sampleId });
    if (entry.ordinal !== index + 1 || !intent || intent.nodeKey !== entry.nodeKey
      || intent.idempotencyKey !== entry.idempotencyKey || intent.argsHash !== expectedArgsHash
      || intent.tool !== `lab.${entry.instrument}`
      || (run && intent.idempotencyKey !== digest({ runId: run.id, nodeKey: intent.nodeKey,
        workflowHash: run.workflowHash, args: { sampleId: entry.sampleId } }))) {
      logBindingErrors++; continue;
    }
    const interval = attemptEvents(intent, events);
    const completed = interval.filter(event => event.type === 'node.completed');
    const errors = interval.filter(event => ['tool.failed', 'node.failed', 'effect.uncertain', 'node.handled_error'].includes(event.type));
    let valid = false, settled = null;
    if (entry.outcome === 'returned') {
      settled = completed.length === 1 ? completed[0] : null;
      if (settled && errors.length === 0 && settled.outputHash === digest(settled.output)
        && digest(settled.output) === digest(entry.observation)) {
        try { validateData(descriptor.get(intent.tool).outputSchema, settled.output); valid = true; }
        catch { /* A raw return rejected by the registry is never completed evidence. */ }
      }
    } else if (entry.outcome === 'threw' && completed.length === 0) {
      const failed = interval.filter(event => event.type === 'tool.failed');
      const handled = interval.filter(event => event.type === 'node.handled_error');
      if (failed.length === 1 && failed[0].error?.code === entry.errorCode && handled.length <= 1
        && !interval.some(event => event.type === 'effect.uncertain')) {
        settled = handled[0] ?? failed[0];
        valid = handled.length === 0 || (settled.seq > failed[0].seq && settled.output?.ok === false
          && settled.output?.error?.code === entry.errorCode && settled.outputHash === digest(settled.output));
      }
    }
    if (!valid) completionErrors++;
    attempts.push({ ordinal: entry.ordinal, instrument: entry.instrument, sampleId: entry.sampleId,
      nodeKey: entry.nodeKey, intentSequence: intent.seq, completedSequence: valid ? settled.seq : null,
      validatedReturn: valid && entry.outcome === 'returned', valid,
      output: valid && entry.outcome === 'returned' ? settled.output : null,
      outcome: entry.outcome, eventHash: valid ? settled.hash : null });
  }
  for (const reproduction of attempts.filter(attempt => attempt.instrument === 'reproduce')) {
    const screening = attempts.filter(attempt => attempt.instrument === 'screen' && attempt.sampleId === reproduction.sampleId);
    if (screening.length !== 1 || !screening[0].validatedReturn
      || !positiveScreen(screening[0].output, reproduction.sampleId)
      || screening[0].completedSequence >= reproduction.intentSequence) evidenceOrderErrors++;
  }

  const expectedManifest = item.expect.artifacts?.find(value => value.name === 'manifest.json')?.json;
  const manifest = artifact?.manifest ?? expectedManifest;
  try { validateData(MANIFEST_SCHEMA, manifest); }
  catch { problems.push('publication_manifest_invalid'); }
  const publications = [];
  let publicationBindingErrors = 0;
  for (const intent of events.filter(event => event.type === 'tool.intent' && event.tool === 'core.artifact')) {
    const interval = attemptEvents(intent, events);
    const completions = interval.filter(event => event.type === 'node.completed');
    for (const completion of completions.filter(event => event.output?.name === 'manifest.json')) {
      let valid = completions.length === 1 && completion.outputHash === digest(completion.output)
        && !interval.some(event => ['tool.failed', 'node.handled_error', 'effect.uncertain', 'node.failed'].includes(event.type));
      try { validateData(registry.get('core.artifact').outputSchema, completion.output); }
      catch { valid = false; }
      if (artifact) valid &&= completion.output.sha256 === artifact.sha256 && completion.output.bytes === artifact.bytes
        && intent.argsHash === artifact.argsHash
        && (!run || intent.idempotencyKey === digest({ runId: run.id, nodeKey: intent.nodeKey,
          workflowHash: run.workflowHash, args: { name: 'manifest.json', content: artifact.text } }));
      if (!valid) publicationBindingErrors++;
      publications.push({ nodeKey: intent.nodeKey, startedSequence: intent.seq,
        completedSequence: completion.seq, valid, sha256: completion.output.sha256 });
    }
  }
  if (!publications.length) problems.push('completed_manifest_publication_missing');
  for (const publication of publications) {
    for (const row of manifest?.samples ?? []) {
      if (row.disposition !== 'confirmed') continue;
      const matches = attempts.filter(attempt => attempt.instrument === 'reproduce' && attempt.sampleId === row.sampleId);
      if (matches.length !== 1 || !matches[0].validatedReturn || !positiveReproduction(matches[0].output, row.sampleId)
        || matches[0].completedSequence >= publication.startedSequence) prematureConfirmations++;
    }
  }

  // Measure stronger all-status final-publication semantics without imposing it.
  const required = item.input.samples.flatMap(({ id }) => {
    const screen = item.fixture.observations[id].screen;
    return ['screen', ...(!screen.error && positiveScreen(screen.returned, id) ? ['reproduce'] : [])]
      .map(instrument => ({ sampleId: id, instrument }));
  });
  let incompleteAtPublication = 0;
  for (const publication of publications) for (const requirement of required) {
    const matches = attempts.filter(attempt => attempt.sampleId === requirement.sampleId && attempt.instrument === requirement.instrument);
    if (matches.length !== 1 || !matches[0].valid || matches[0].completedSequence >= publication.startedSequence) incompleteAtPublication++;
  }
  if (logBindingErrors) problems.push('log_ordinal_or_native_attempt_binding_invalid');
  if (completionErrors) problems.push('instrument_native_completion_invalid');
  if (evidenceOrderErrors) problems.push('reproduction_requires_completed_suspicious_screen');
  if (prematureConfirmations) problems.push('confirmation_before_completed_validated_reproduction');
  if (publicationBindingErrors) problems.push('manifest_publication_binding_invalid');
  return { ...v1, passed: problems.length === 0, problems: [...new Set(problems)],
    v1Passed: v1.passed, logBindingErrors, completionErrors, evidenceOrderErrors, prematureConfirmations, publicationBindingErrors,
    completedAttempts: attempts.filter(attempt => attempt.valid).length, attempts, publications,
    publicationContentBasis: artifact ? 'independently-read-actual-artifact' : 'expected-manifest-requires-separate-exact-JSON-check',
    allProcessingBeforePublication: { enforced: false, passed: publications.length > 0 && incompleteAtPublication === 0,
      requiredAttempts: required.length, incompleteAtPublication, qualification: PUBLICATION_POLICY.allProcessing } };
}

function readManifest(store, run) {
  let file = store.directory;
  for (const [index, part] of ['artifacts', run.id, 'manifest.json'].entries()) {
    file = path.join(file, part);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || (index < 2 ? !stat.isDirectory() : !stat.isFile())) {
      throw new FoundryError('BENCHMARK_ARTIFACT', 'Manifest path has an invalid type or link');
    }
  }
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const limit = 512 * 1024, stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new FoundryError('BENCHMARK_ARTIFACT', 'Manifest exceeds the artifact contract');
    const buffer = Buffer.alloc(limit + 1); let size = 0;
    while (size < buffer.length) { const got = readSync(fd, buffer, size, buffer.length - size, null); if (!got) break; size += got; }
    if (size > limit) throw new FoundryError('BENCHMARK_ARTIFACT', 'Manifest grew beyond its artifact contract');
    const bytes = buffer.subarray(0, size), text = bytes.toString('utf8'), manifest = JSON.parse(text);
    validateData(MANIFEST_SCHEMA, manifest);
    return { manifest, text, sha256: sha(bytes), bytes: size, argsHash: digest({ name: 'manifest.json', content: text }) };
  } finally { closeSync(fd); }
}

export async function evaluateCandidate(workflow, suite, { directory, signal, enforceFreeze = true } = {}) {
  if (enforceFreeze) verifyFreeze();
  const fixtureValidation = validateFixtures(suite);
  if (!directory || !path.resolve(directory).startsWith(`${ROOT}${path.sep}`)) {
    throw new FoundryError('BENCHMARK_DIRECTORY', 'V2 evidence must remain inside the benchmark directory');
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // The exact original report and its case Stores are retained, never rewritten.
  const v1 = await evaluateV1(workflow, suite, { directory: path.join(directory, 'v1'), signal, enforceFreeze });
  const cases = v1.cases.map((result, index) => {
    let events = [], run = null, artifact = null, artifactError = null;
    if (result.runId) {
      const store = new Store(result.workspace);
      try {
        run = store.run(result.runId); events = store.events(result.runId);
        try { artifact = readManifest(store, run); }
        catch (error) { artifactError = errorData(error); }
      } finally { store.close(); }
    }
    const instrumentAudit = auditInstruments(suite.cases[index], result.instrumentLog, events, { run, artifact });
    const nativeArtifact = result.artifacts?.find(value => value.name === 'manifest.json');
    const bindingsAgree = !!run && run.workflowHash === digest(workflow)
      && (!artifact || nativeArtifact?.sha256 === artifact.sha256);
    const passed = result.passed && result.status === 'succeeded' && !artifactError && !!artifact && bindingsAgree && instrumentAudit.passed;
    return { ...result, v1Passed: result.passed, v1InstrumentAudit: result.instrumentAudit,
      instrumentAudit, passed, falseSuccess: result.status === 'succeeded' && !passed, artifactError,
      evidenceBinding: { passed: bindingsAgree, eventHead: run?.eventHead ?? null,
        eventsHash: digest(events), instrumentLogHash: digest(result.instrumentLog),
        manifestSha256: artifact?.sha256 ?? null },
    };
  });
  const metrics = { ...v1.metrics, v1PassedCount: v1.metrics.passedCount,
    passedCount: cases.filter(item => item.passed).length, successFraction: cases.filter(item => item.passed).length / cases.length,
    falseSuccessCount: cases.filter(item => item.falseSuccess).length,
    logBindingErrors: cases.reduce((sum, item) => sum + item.instrumentAudit.logBindingErrors, 0),
    completionErrors: cases.reduce((sum, item) => sum + item.instrumentAudit.completionErrors, 0),
    evidenceOrderErrors: cases.reduce((sum, item) => sum + item.instrumentAudit.evidenceOrderErrors, 0),
    prematureConfirmations: cases.reduce((sum, item) => sum + item.instrumentAudit.prematureConfirmations, 0),
    allProcessingDiagnosticFailures: cases.filter(item => !item.instrumentAudit.allProcessingBeforePublication.passed).length };
  const report = { ...v1, evaluatorId: evaluatorId(suite), v1EvaluatorId: v1.evaluatorId,
    v1Passed: v1.passed, passed: cases.every(item => item.passed), metrics, cases, fixtureValidation,
    publicationPolicy: PUBLICATION_POLICY, v1ReportPath: path.join(directory, 'v1', 'REPORT.json'),
    qualification: `${v1.qualification} V2 adds validated completion/event binding and confirmation-before-publication checks. All-item completion before publication is a non-gating diagnostic; temporal order alone does not prove causal use.` };
  writeFileSync(path.join(directory, 'REPORT.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}

export function makeEvaluator(suite = loadSuite('development')) {
  if (suite.split === 'heldout') throw new FoundryError('HOLDOUT_LEAKAGE', 'Sealed evaluation must never supply generator repair feedback');
  validateFixtures(suite);
  const frozen = clone(suite);
  return { id: evaluatorId(frozen), publicTask: frozen.task,
    evaluate: ({ workflow, directory, signal }) => evaluateCandidate(workflow, frozen, { directory: path.join(directory, 'evaluation'), signal }) };
}

export function aggregate(report) {
  return { evaluatorId: report.evaluatorId, v1EvaluatorId: report.v1EvaluatorId, workflowHash: report.workflowHash,
    registryHash: report.registryHash, suiteHash: report.suiteHash, split: report.split,
    passed: report.passed, v1Passed: report.v1Passed, metrics: report.metrics,
    fixtureValidation: report.fixtureValidation, publicationPolicy: report.publicationPolicy, qualification: report.qualification };
}
