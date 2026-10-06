// Independent saved-result audit. No campaign import, provider call, Store/Runtime
// construction, workflow execution, or writes outside the new RESULT_AUDIT.json.
// Run: node outcome-model-independent-20260917/result-check.mjs [--write]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync, lstatSync, realpathSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const own = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(own);
const product = path.resolve(root, '../../workflow-foundry');
const study = path.join(root, 'benchmark/outcome-model-001');
const startedAt = new Date().toISOString();
const inputHashes = new Map(), checks = [], databaseReads = [], caseEvidence = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = value => Array.isArray(value) ? value.map(sorted)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const canonical = value => JSON.stringify(sorted(value));
const digest = value => sha(canonical(value));
const same = (left, right, message) => assert.deepEqual(left, right, message);
const dataOnly = value => JSON.parse(JSON.stringify(value));
const without = (value, ...keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const bodyHash = (value, key = 'id') => digest(without(value, key));
function bytes(filename) {
  assert.ok(filename.startsWith(`${root}/`) || filename.startsWith(`${product}/`), 'Read must stay in the assigned source/evidence roots');
  const stat = lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32 * 1024 * 1024, 'Bounded regular input required');
  const result = readFileSync(filename);
  const entry = { path: filename, sha256: sha(result), bytes: result.length };
  if (inputHashes.has(filename)) same(entry, inputHashes.get(filename), 'Input changed during audit');
  else inputHashes.set(filename, entry);
  return result;
}
const json = filename => JSON.parse(bytes(filename).toString('utf8'));
const read = name => json(path.join(study, name));
function check(name, fn) {
  try { checks.push({ name, passed: true, detail: fn() ?? null }); }
  catch (error) { checks.push({ name, passed: false, error: String(error.message).slice(0, 1200) }); }
}
function diff(left, right, at = '') {
  if (canonical(left) === canonical(right)) return [];
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return [{ path: at, before: left, after: right }];
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap(key => {
    const next = `${at}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) return [{ path: next,
      beforePresent: Object.hasOwn(left, key), afterPresent: Object.hasOwn(right, key) }];
    return diff(left[key], right[key], next);
  });
}
function database(workspace, fn) {
  assert.ok(workspace.startsWith(`${study}/`), 'Only released study databases are allowed');
  const filename = path.join(workspace, '.foundry/foundry.sqlite');
  assert.equal(realpathSync(filename), filename);
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const tables = new Set(['requests', 'proposals', 'runs', 'workflows', 'fixtures',
      'generation_jobs', 'outcome_contracts', 'outcome_observations']);
    const get = (table, id) => {
      assert.ok(tables.has(table));
      const key = table === 'workflows' ? 'hash' : table === 'fixtures' ? 'run_id' : 'id';
      const row = db.prepare(`SELECT body FROM ${table} WHERE ${key}=?`).get(id);
      assert.ok(row, `Missing ${table} record`);
      return JSON.parse(row.body);
    };
    const events = runId => db.prepare('SELECT seq,body,hash FROM events WHERE run_id=? ORDER BY seq').all(runId).map(row => {
      const body = JSON.parse(row.body); assert.equal(body.seq, row.seq);
      return { ...body, hash: row.hash };
    });
    const result = fn({ db, get, events });
    databaseReads.push({ path: filename, mode: 'readOnly', projectionHash: digest(result) });
    return result;
  } finally { db.close(); }
}

const initial = json(path.join(own, 'AUDIT.json'));
const protocol = read('PROTOCOL.json'), config = protocol.configuration, ready = read('READY.json');
const original = read('ORIGINAL_MODEL_CANDIDATE.json'), faulty = read('FAULTY_CANDIDATE.json');
const candidate = read('REPAIRED_CANDIDATE.json'), result = read('RESULTS.json');
const job = read('GENERATION_JOB.json'), attempt = job.attempts[0];
const context = read('REPAIR_CONTEXT.json'), repair = read('REPAIR_REQUEST.json');
const contract = read('CONTRACT.json'), sample = read('DEVELOPMENT_CASE.json');
const wrong = read('WRONG_EXECUTION.json'), oldObservation = read('WRONG_OBSERVATION.json');
const repaired = read('REPAIRED_EXECUTION.json'), observation = read('SATISFIED_OBSERVATION.json');
const promotion = read('LOCAL_PROMOTION.json'), candidateFreeze = read('CANDIDATE_FREEZE.json');
const delivery = read('DELIVERY.json'), host = read('HOST_MODEL_RECEIPT.json');
const author = read('packet/AUTHOR_1.json'), call = read('packet/CALL_1.json'), received = read('packet/RECEIVED_1.json');
const responseBytes = bytes(path.join(study, 'packet/RESPONSE_1.json'));
const raw = JSON.parse(responseBytes.toString('utf8'));
const prompt = bytes(path.join(study, 'packet/PROMPT_1.txt')).toString('utf8');
const gen = path.join(study, 'workspace/.foundry/generation', job.id);
const savedContext = json(path.join(gen, 'context.json'));
const savedResponse = json(path.join(gen, '01/response.json'));
const savedAssessment = json(path.join(gen, '01/assessment.json'));
const v1Freeze = json(path.join(root, 'benchmark/FREEZE.json'));
const v2Freeze = json(path.join(root, 'benchmark/FREEZE_V2.json'));
const declared = [...config.sourceHashes, ...v1Freeze.files, ...v2Freeze.files];

check('initial-review-files-and-all-111-inputs-preserved', () => {
  const pinned = {
    'AUDIT.json': '45e746895fb800deb6fb2fc08a56e895345cd253780f118eeb98d2397999589f',
    'check.mjs': 'e92b2241a896c7bc1266541d012e2be5eab50fc7f69ed5c614e81d04d68cbede',
    'NOTE.md': '541f44501ccdb5b2c4d7e30b9e38b2cedc60a4cd64e0f94ec14daec24e1abd7c'
  };
  for (const [name, hash] of Object.entries(pinned)) assert.equal(sha(bytes(path.join(own, name))), hash, name);
  assert.equal(initial.passedChecks, 18); assert.equal(initial.failedChecks, 0);
  assert.equal(initial.inputHashes.length, 111);
  for (const file of initial.inputHashes) assert.equal(sha(bytes(file.path)), file.sha256, file.path);
  return { initialChecks: 18, preservedInputFiles: 111, pinnedReviewFiles: pinned };
});
check('entire-declared-protocol-and-v1-v2-freeze-current', () => {
  assert.equal(digest(config), protocol.configurationSha256);
  assert.equal(protocol.configurationSha256, initial.protocol.sha256);
  const unique = new Map();
  for (const file of declared) {
    if (unique.has(file.path)) assert.equal(unique.get(file.path), file.sha256);
    unique.set(file.path, file.sha256);
  }
  for (const [filename, expected] of unique) assert.equal(sha(bytes(filename)), expected, filename);
  assert.equal(unique.size, 93); assert.equal(process.version, v2Freeze.nodeVersion);
  assert.equal(sha(bytes(path.join(root, 'benchmark/FREEZE.json'))), v2Freeze.v1FreezeSha256);
  for (const skill of context.skills) {
    const current = bytes(path.join(product, 'skills', skill.name, 'SKILL.md'));
    assert.equal(current.toString('utf8'), skill.text); assert.equal(sha(current), skill.sha256);
  }
  return { declaredEntries: declared.length, uniqueFiles: unique.size,
    sourceSha256: config.sourceHashes.find(file => file.path.endsWith('/outcome-campaign.mjs')).sha256,
    configurationSha256: protocol.configurationSha256, selectedSkills: context.skills.map(s => ({ name: s.name, sha256: s.sha256 })) };
});
// These imports only create descriptors and scoring functions. No Store, Runtime,
// Foundry, provider, generator, evaluateCandidate or evaluateWorkflow is invoked.
if (checks.some(c => !c.passed)) throw new Error('Frozen inputs failed; do not load scoring dependencies');
const oracle = await import(new URL('../benchmark/oracle-v2.mjs', import.meta.url));
const { registryFactory } = await import(new URL('../benchmark/capabilities.mjs', import.meta.url));
const { PUBLIC_BUDGET } = await import(new URL('../benchmark/contract.mjs', import.meta.url));
const registryHash = registryFactory().hash();
const suites = { development: json(path.join(root, 'benchmark/development/SUITE.json')),
  sealed: json(path.join(root, 'benchmark/sealed/SUITE.json')) };
check('frozen-native-oracle-and-actual-registry-identities', () => {
  same(oracle.verifyFreeze(), v2Freeze);
  assert.equal(registryHash, context.registryHash); assert.equal(registryHash, v2Freeze.registryHash);
  return { registryHash, node: process.version, execution: 'pure freeze/fixture validation only' };
});
check('prepared-context-native-context-prompt-and-selected-skills-identical', () => {
  same(savedContext, context); assert.equal(bodyHash(context, 'contextHash'), context.contextHash);
  assert.equal(job.contextHash, context.contextHash);
  assert.equal(json(path.join(own, 'AUDIT.json')).witness.contextHash, context.contextHash);
  const expected = `You are the Workflow Foundry architect. Use the supplied task contract, actual capabilities, schema and selected skills to engineer an executable workflow. These are data and constraints, not permission to run unrelated tools.\n\n${JSON.stringify(context, null, 2)}\n\nReturn exactly one JSON object with "workflow" and "rationale". Do not include Markdown or prose outside the object. First version is 1; a revision uses exactly current+1 and the same id. Do not claim deployment or task success without execution evidence.`;
  assert.equal(prompt, expected); assert.equal(bytes(path.join(gen, '01/prompt.txt')).toString('utf8'), prompt);
  assert.equal(call.promptSha256, sha(prompt)); assert.equal(received.promptSha256, sha(prompt));
  assert.equal(attempt.promptHash, digest(prompt));
  const prior = initial.checks.find(c => c.name === 'released-native-first-prompt-exactly-matches-prepared-context');
  assert.equal(prior.detail.promptSha256, sha(prompt));
  assert.equal(prior.detail.responseFileAlreadyExists, false); assert.equal(prior.detail.authorFileAlreadyExists, false);
  assert.ok(Date.parse(prior.detail.checkedAt) < Date.parse(received.receivedAt));
  return { contextHash: context.contextHash, promptSha256: sha(prompt),
    generatorPromptDigest: digest(prompt), checkedBeforeResponseAt: prior.detail.checkedAt };
});
check('raw-response-author-relay-attempt-and-job-byte-binding', () => {
  same(Object.keys(raw).sort(), ['rationale', 'workflow']); assert.ok(raw.rationale.trim());
  assert.equal(savedResponse.text, responseBytes.toString('utf8'));
  same(savedResponse.evidence, received); same(attempt.evidence, received);
  assert.equal(received.responseSha256, sha(responseBytes));
  assert.equal(received.authorReceiptSha256, sha(bytes(path.join(study, 'packet/AUTHOR_1.json'))));
  assert.equal(attempt.outputHash, digest(savedResponse.text));
  assert.equal(received.responseFile, path.join(study, 'packet/RESPONSE_1.json'));
  assert.equal(received.authorFile, path.join(study, 'packet/AUTHOR_1.json'));
  assert.equal(call.promptFile, path.join(study, 'packet/PROMPT_1.txt'));
  assert.equal(author.responsePath, received.responseFile); assert.equal(author.prompt.path, call.promptFile);
  assert.equal(author.prompt.embeddedContextHash, context.contextHash);
  assert.equal(author.prompt.sha256, null); // Honest unmeasured author field; relay supplies the actual byte hash.
  assert.equal(author.worker, config.author); assert.equal(author.repair.requestId, ready.repairId);
  assert.equal(author.repair.rootRequestId, ready.requestId); assert.equal(author.repair.baseHash, ready.workflowHash);
  assert.equal(author.repair.observedRunId, ready.runId); assert.equal(author.repair.workflowId, candidate.id);
  assert.equal(author.repair.version, 2);
  same(savedAssessment, attempt.assessment); same(raw.workflow, candidate);
  return { responseBytes: responseBytes.length, responseSha256: sha(responseBytes),
    authorSha256: received.authorReceiptSha256, outputDigest: attempt.outputHash,
    authorPromptSha256: 'unmeasured; exact prompt hash independently supplied by CALL/RECEIVED and prior audit' };
});
check('host-configured-model-author-and-round-consistency', () => {
  assert.equal(sha(bytes(path.join(study, 'HOST_MODEL_RECEIPT.json'))), '6a7d7595c3bb68aaa037a4d6441796a77a2180e0e1bac9dd6f41b3d916568e94');
  assert.equal(host.runId, 'a6c2cb58-50d1-4559-a931-c46650f6dc12'); assert.equal(host.self, 'prime');
  assert.equal(host.selectedAgent.id, config.author); assert.equal(host.selectedAgent.role, 'worker');
  assert.equal(host.selectedAgent.model, config.model); assert.equal(host.selectedAgent.reasoning_effort, config.reasoningEffort);
  assert.equal(author.modelSettings.model, config.model); assert.equal(author.modelSettings.reasoningEffort, config.reasoningEffort);
  for (const descriptor of [call.provider, received, job.provider]) {
    assert.equal(descriptor.authorAgent, config.author); assert.equal(descriptor.model, config.model);
    assert.equal(descriptor.reasoningEffort, config.reasoningEffort); assert.equal(descriptor.provider, 'cos-artifact-relay');
    assert.equal(descriptor.usage, null); assert.equal(descriptor.billedCost, null);
  }
  same(job.provider, call.provider); assert.equal(call.round, 1); assert.equal(received.round, 1);
  assert.ok(Date.parse(call.at) <= Date.parse(host.recordedAt));
  assert.ok(Date.parse(host.recordedAt) <= Date.parse(received.receivedAt));
  return { hostReceiptSha256: sha(bytes(path.join(study, 'HOST_MODEL_RECEIPT.json'))),
    author: config.author, configuredModel: config.model, configuredReasoningEffort: config.reasoningEffort,
    hostRecordedAt: host.recordedAt,
    trustBoundary: 'Prime transcription of actual COS host status plus exact packet chain; no independent remote model attestation, token/cost measurement, or ambient-access proof.' };
});
check('single-recorded-round-and-original-budget-no-hidden-feedback-round', () => {
  assert.equal(job.attempts.length, 1); assert.equal(attempt.round, 1); assert.equal(attempt.status, 'accepted-candidate');
  assert.equal(job.status, 'proposed'); assert.equal(job.error, null);
  same(job.limits, { autoApply: false, evaluator: oracle.evaluatorId(suites.development),
    maxDurationMs: config.maxDurationMs, maxRounds: config.maxRounds });
  same(readdirSync(path.join(study, 'packet')).sort(), ['AUTHOR_1.json', 'CALL_1.json', 'PROMPT_1.txt', 'RECEIVED_1.json', 'RESPONSE_1.json']);
  same(readdirSync(gen).sort(), ['01', 'context.json']);
  same(readdirSync(path.join(gen, '01')).sort(), ['assessment.json', 'evaluation', 'prompt.txt', 'response.json']);
  assert.ok(job.finishedAt - job.createdAt <= config.maxDurationMs);
  assert.equal(attempt.assessment.evaluation.split, 'development');
  assert.equal(result.job.id, job.id); assert.equal(result.job.attempts, 1); assert.equal(result.job.status, job.status);
  return { recordedRounds: 1, limitRounds: config.maxRounds, maxDurationMs: config.maxDurationMs,
    jobDurationMs: job.finishedAt - job.createdAt, sealedFeedbackInRecordedGeneratorRounds: false,
    scope: 'Recorded packet/job path; procedural withholding and prior conversation contents are not independently attested.' };
});
check('exact-version-two-and-one-leaf-restoration', () => {
  const changes = diff(faulty, candidate);
  same(changes, [{ path: config.fault.path, before: config.fault.after, after: config.fault.before },
    { path: '/version', before: 1, after: 2 }]);
  same(diff(original, candidate), [{ path: '/version', before: 1, after: 2 }]);
  same([...author.repair.intendedWorkflowValueChanges].sort((a, b) => a.path.localeCompare(b.path)),
    [...changes].sort((a, b) => a.path.localeCompare(b.path)));
  assert.equal(candidate.id, original.id); assert.equal(candidate.version, 2);
  assert.equal(digest(candidate), result.workflowHash); assert.equal(job.workflowHash, digest(candidate));
  assert.equal(attempt.workflowHash, digest(candidate)); assert.equal(candidateFreeze.workflowHash, digest(candidate));
  assert.equal(candidateFreeze.byteHash, sha(bytes(path.join(study, 'REPAIRED_CANDIDATE.json'))));
  assert.equal(candidateFreeze.beforeSealedEvaluation, true); assert.equal(candidateFreeze.requestId, ready.repairId);
  assert.equal(candidateFreeze.proposalId, job.proposalId);
  assert.equal(result.modelAttribution, config.modelContinuity); assert.equal(result.qualification, config.qualification);
  return { changes, workflowHash: digest(candidate), savedCandidateByteHash: candidateFreeze.byteHash,
    allOriginalWorkflowValuesExceptVersionRestored: true };
});

// Independent public-rule calculation for each frozen fixture. It does not use
// the report's verdict or the candidate to decide the expected classification.
function obligations(item) {
  const required = [];
  const samples = item.input.samples.map(({ id }) => {
    const pair = item.fixture.observations[id], screening = pair.screen.returned;
    required.push({ sampleId: id, instrument: 'screen' });
    let disposition = 'inconclusive';
    if (pair.screen.error) disposition = 'error';
    else if (screening?.ok === true && screening.sampleId === id && typeof screening.suspicious === 'boolean') {
      if (screening.suspicious === false) disposition = 'clear';
      else {
        required.push({ sampleId: id, instrument: 'reproduce' });
        const evidence = pair.reproduce.returned;
        if (pair.reproduce.error) disposition = 'error';
        else if (evidence?.ok === true && evidence.sampleId === id && evidence.independent === true
          && typeof evidence.evidenceId === 'string' && evidence.evidenceId.length > 0
          && typeof evidence.reproduced === 'boolean') disposition = evidence.reproduced ? 'confirmed' : 'not_reproduced';
      }
    }
    return { sampleId: id, disposition };
  });
  return { manifest: { samples }, required };
}
check('all-13-frozen-expectations-rederived-from-public-observation-rules', () => {
  for (const suite of Object.values(suites)) {
    same(oracle.validateFixtures(suite), v2Freeze.fixtureValidation[suite.split === 'heldout' ? 'sealed' : 'development']);
    for (const item of suite.cases) {
      same(item.expect.checks, []); same(item.expect.statuses, ['succeeded']);
      assert.equal(item.expect.artifacts.length, 1); assert.equal(item.expect.artifacts[0].name, 'manifest.json');
      same(item.expect.artifacts[0].json, obligations(item).manifest);
    }
  }
  same(sample, suites.development.cases.find(c => c.id === sample.id));
  same(contract.expected, obligations(sample).manifest); assert.equal(bodyHash(contract), contract.id);
  return { development: suites.development.cases.length, sealed: suites.sealed.cases.length,
    basis: 'Supplied fixed synthetic fixtures interpreted under the public rules; no independent instrument calibration.' };
});

function inspectSavedRun(workspace, runId, expectedWorkflow, item, calls) {
  const state = database(workspace, ({ get, events }) => ({
    run: get('runs', runId), events: events(runId), workflow: get('workflows', digest(expectedWorkflow)), fixture: get('fixtures', runId)
  }));
  const { run, events } = state;
  same(state.workflow, expectedWorkflow);
  // Frozen Store.createRun, src/store.mjs:104, adds these simulator counters
  // to every fixture. All observation values must remain exact and counters zero.
  same(state.fixture, { ...item.fixture, actions: [], wrongActions: 0 }); same(run.input, item.input);
  assert.equal(run.id, runId); assert.equal(run.workflowHash, digest(expectedWorkflow)); assert.equal(run.workflowId, expectedWorkflow.id);
  assert.equal(run.registryHash, registryHash); assert.equal(run.engineHash, wrong.run.engineHash);
  assert.equal(run.status, 'succeeded'); assert.equal(run.error, null); assert.equal(run.owner, null);
  assert.equal(run.cost, 0); assert.ok(run.steps > 0 && run.steps <= PUBLIC_BUDGET.maxStepsPerRun);
  assert.ok(events.length > 0 && events.length < 5000);
  let previousHash = null;
  for (const [index, event] of events.entries()) {
    assert.equal(event.seq, index + 1); assert.equal(event.previousHash, previousHash);
    assert.equal(bodyHash(event, 'hash'), event.hash);
    if (Object.hasOwn(event, 'outputHash')) assert.equal(digest(event.output), event.outputHash);
    previousHash = event.hash;
  }
  same(run.eventHead, { seq: events.length, hash: previousHash });
  const birth = events[0]; assert.equal(birth.type, 'run.created');
  assert.equal(birth.workflowHash, run.workflowHash); assert.equal(birth.registryHash, registryHash);
  assert.equal(birth.engineHash, run.engineHash); assert.equal(birth.inputHash, digest(item.input));
  assert.equal(birth.policyHash, digest(run.policy)); assert.equal(events.at(-1).type, 'run.succeeded');
  const expected = obligations(item), intents = events.filter(e => e.type === 'tool.intent' && ['lab.screen', 'lab.reproduce'].includes(e.tool));
  same(calls.map(c => `${c.sampleId}/${c.instrument}`).sort(), expected.required.map(c => `${c.sampleId}/${c.instrument}`).sort());
  assert.equal(intents.length, calls.length);
  const settled = [];
  for (const [index, entry] of calls.entries()) {
    const intent = intents[index], args = { sampleId: entry.sampleId };
    assert.equal(entry.ordinal, index + 1); assert.equal(entry.nodeKey, intent.nodeKey);
    assert.equal(intent.tool, `lab.${entry.instrument}`); assert.equal(intent.argsHash, digest(args));
    assert.equal(intent.idempotencyKey, entry.idempotencyKey);
    assert.equal(intent.idempotencyKey, digest({ runId, nodeKey: intent.nodeKey, workflowHash: run.workflowHash, args }));
    assert.equal(entry.syntheticCost, entry.instrument === 'screen' ? 1 : 10);
    const interval = events.filter(e => e.nodeKey === intent.nodeKey && e.seq > intent.seq);
    assert.ok(!interval.some(e => e.type === 'tool.intent'), 'No repeated instrument attempt');
    const fixture = item.fixture.observations[entry.sampleId][entry.instrument];
    let terminal;
    if (fixture.error) {
      assert.equal(entry.outcome, 'threw'); assert.equal(entry.errorCode, fixture.error);
      const failures = interval.filter(e => e.type === 'tool.failed'), handled = interval.filter(e => e.type === 'node.handled_error');
      assert.equal(failures.length, 1); assert.equal(handled.length, 1);
      assert.equal(failures[0].error.code, fixture.error); assert.equal(handled[0].output.error.code, fixture.error);
      assert.equal(handled[0].output.ok, false); assert.ok(handled[0].seq > failures[0].seq);
      assert.ok(!interval.some(e => ['node.completed', 'effect.uncertain'].includes(e.type)));
      terminal = handled[0];
    } else {
      assert.equal(entry.outcome, 'returned'); same(entry.observation, fixture.returned);
      const completions = interval.filter(e => e.type === 'node.completed'); assert.equal(completions.length, 1);
      assert.ok(!interval.some(e => ['tool.failed', 'node.handled_error', 'effect.uncertain', 'node.failed'].includes(e.type)));
      terminal = completions[0]; same(terminal.output, entry.observation);
    }
    settled.push({ sampleId: entry.sampleId, instrument: entry.instrument, began: intent.seq, ended: terminal.seq,
      returned: !fixture.error, output: fixture.error ? null : terminal.output });
  }
  for (const reproduction of settled.filter(c => c.instrument === 'reproduce')) {
    const screening = settled.filter(c => c.instrument === 'screen' && c.sampleId === reproduction.sampleId);
    assert.equal(screening.length, 1); assert.ok(screening[0].returned && screening[0].ended < reproduction.began);
    assert.equal(screening[0].output.ok, true); assert.equal(screening[0].output.sampleId, reproduction.sampleId);
    assert.equal(screening[0].output.suspicious, true);
  }
  const artifactPath = path.join(workspace, '.foundry/artifacts', runId, 'manifest.json');
  assert.equal(realpathSync(artifactPath), artifactPath);
  const actual = bytes(artifactPath); assert.ok(actual.length <= 512 * 1024);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(actual), manifest = JSON.parse(text);
  const artifact = { manifest, text, sha256: sha(actual), bytes: actual.length, argsHash: digest({ name: 'manifest.json', content: text }) };
  const publications = events.filter(e => e.type === 'tool.intent' && e.tool === 'core.artifact');
  assert.equal(publications.length, 1);
  const intent = publications[0], args = { name: 'manifest.json', content: text };
  assert.equal(intent.argsHash, digest(args));
  assert.equal(intent.idempotencyKey, digest({ runId, nodeKey: intent.nodeKey, workflowHash: run.workflowHash, args }));
  const completion = events.filter(e => e.nodeKey === intent.nodeKey && e.type === 'node.completed');
  assert.equal(completion.length, 1); assert.ok(completion[0].seq > intent.seq);
  assert.equal(completion[0].output.name, 'manifest.json'); assert.equal(completion[0].output.sha256, artifact.sha256);
  assert.equal(completion[0].output.bytes, artifact.bytes);
  assert.ok(settled.every(c => c.ended < intent.seq), 'Observed stronger all-processing ordering');
  for (const row of manifest.samples) if (row.disposition === 'confirmed') {
    const matching = settled.filter(c => c.instrument === 'reproduce' && c.sampleId === row.sampleId);
    assert.equal(matching.length, 1); assert.equal(matching[0].returned, true);
    const e = matching[0].output;
    assert.ok(e.ok === true && e.sampleId === row.sampleId && e.independent === true && e.reproduced === true
      && typeof e.evidenceId === 'string' && e.evidenceId.length > 0 && matching[0].ended < intent.seq);
  }
  const contentMatches = canonical(manifest) === canonical(expected.manifest);
  const replayedAudit = dataOnly(oracle.auditInstruments(item, calls, events, { run, artifact }));
  assert.equal(replayedAudit.passed, true);
  return { ...state, artifact, replayedAudit, contentMatches,
    syntheticCost: calls.reduce((sum, c) => sum + c.syntheticCost, 0),
    instrumentCount: calls.length, createdAt: run.createdAt, endedAt: events.at(-1).at };
}

const main = database(path.join(study, 'workspace'), ({ db, get, events }) => ({
  originalRequest: get('requests', ready.requestId), request: get('requests', ready.repairId),
  originalProposal: get('proposals', oldObservation.binding.proposalId), proposal: get('proposals', job.proposalId),
  job: get('generation_jobs', job.id),
  contract: { id: contract.id, ...get('outcome_contracts', contract.id) },
  oldObservation: { id: oldObservation.id, ...get('outcome_observations', oldObservation.id) },
  observation: { id: observation.id, ...get('outcome_observations', observation.id) },
  repairRecord: JSON.parse(db.prepare('SELECT body FROM outcome_repairs WHERE request_id=?').get(ready.repairId).body),
  head: db.prepare('SELECT id,hash FROM heads WHERE id=?').get(candidate.id),
  qualifications: db.prepare('SELECT id,workflow_hash,body FROM qualifications ORDER BY id').all().map(row => ({
    id: row.id, workflowHash: row.workflow_hash, report: JSON.parse(row.body)
  })),
  counts: Object.fromEntries(['requests', 'proposals', 'runs', 'workflows', 'generation_jobs', 'outcome_contracts', 'outcome_observations', 'outcome_repairs']
    .map(table => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]))
}));
check('actual-proposal-job-version-head-and-fixed-intent-database-bindings', () => {
  same(main.job, job); assert.equal(main.proposal.status, 'applied'); assert.equal(main.request.status, 'applied');
  assert.equal(main.proposal.id, result.proposalId); assert.equal(main.proposal.id, candidateFreeze.proposalId);
  assert.equal(main.proposal.requestId, ready.repairId); assert.equal(main.proposal.baseHash, ready.workflowHash);
  same(main.proposal.workflow, raw.workflow); assert.equal(main.proposal.rationale, raw.rationale);
  assert.equal(main.proposal.workflowHash, digest(candidate)); same(main.proposal.validation, attempt.assessment.validation);
  assert.equal(main.proposal.validation.valid, true); assert.equal(main.proposal.validation.hash, digest(candidate));
  assert.equal(main.proposal.impact.acceptanceChanged, false); assert.equal(main.proposal.impact.budgetChanged, false);
  same(main.proposal.impact.changed, ['processBatch']);
  same(dataOnly(main.head), { id: candidate.id, hash: digest(candidate) });
  same(main.request, { ...without(repair, 'reused'), status: 'applied', generationJobId: job.id });
  same(main.repairRecord.request, without(repair, 'reused')); assert.equal(main.repairRecord.requestHash, digest(main.repairRecord.request));
  assert.equal(main.repairRecord.receiptId, oldObservation.id);
  assert.equal(main.request.text, main.originalRequest.text); assert.equal(main.request.rootRequestId, main.originalRequest.id);
  assert.equal(candidate.goal, repair.goal); same(candidate.envelope.successCriteria, repair.successCriteria);
  same(main.counts, { requests: 2, proposals: 2, runs: 2, workflows: 2, generation_jobs: 1,
    outcome_contracts: 1, outcome_observations: 2, outcome_repairs: 1 });
  return { proposalId: main.proposal.id, appliedAt: main.proposal.appliedAt, currentHead: dataOnly(main.head), counts: main.counts };
});

const reportSpecs = [
  { arm: 'repaired', split: 'development', file: path.join(gen, '01/evaluation/REPORT.json'), workflow: candidate, expectedPasses: 5 },
  { arm: 'repaired', split: 'sealed', file: path.join(study, 'sealed/REPORT.json'), workflow: candidate, expectedPasses: 8 },
  { arm: 'mutant', split: 'development', file: path.join(study, 'mutant-development/REPORT.json'), workflow: faulty, expectedPasses: 4 },
  { arm: 'mutant', split: 'sealed', file: path.join(study, 'mutant-sealed/REPORT.json'), workflow: faulty, expectedPasses: 4 }
];
const reports = [];
for (const spec of reportSpecs) check(`${spec.arm}-${spec.split}-every-saved-case-and-full-score`, () => {
  const report = json(spec.file), suite = suites[spec.split], directory = path.dirname(spec.file);
  const v1 = json(path.join(directory, 'v1/REPORT.json'));
  assert.equal(report.evaluatorId, oracle.evaluatorId(suite));
  assert.equal(report.v1EvaluatorId, `sample-consequences-v1:${digest(suite)}:${sha(bytes(path.join(root, 'benchmark/oracle.mjs')))}`);
  assert.equal(report.nativeEvaluatorId, `suite:${suite.id}:${digest(suite)}`);
  assert.equal(report.workflowHash, digest(spec.workflow)); assert.equal(report.registryHash, registryHash);
  assert.equal(report.suiteHash, digest(suite)); assert.equal(report.split, suite.split);
  assert.equal(report.qualificationLevel, 'task-outcome'); same(report.envelope, suite.envelope);
  assert.equal(report.v1ReportPath, path.join(directory, 'v1/REPORT.json'));
  assert.equal(report.v1Passed, v1.passed); assert.equal(v1.evaluatorId, report.v1EvaluatorId);
  assert.equal(v1.workflowHash, report.workflowHash); assert.equal(v1.suiteHash, report.suiteHash);
  assert.equal(report.cases.length, suite.cases.length); assert.equal(v1.cases.length, suite.cases.length);
  let passed = 0, eventCount = 0, instrumentCount = 0, steps = 0, syntheticCost = 0;
  const times = [], savedCases = [];
  for (const [index, c] of report.cases.entries()) {
    const item = suite.cases[index], oldCase = v1.cases[index]; assert.equal(c.id, item.id); assert.equal(oldCase.id, c.id);
    assert.ok(c.workspace.startsWith(`${directory}/v1/`));
    const state = inspectSavedRun(c.workspace, c.runId, spec.workflow, item, c.instrumentLog);
    same(c.instrumentAudit, state.replayedAudit); same(c.v1InstrumentAudit, oldCase.instrumentAudit);
    for (const key of ['runId', 'workspace', 'status', 'steps', 'cost', 'elapsedMs', 'eventCount', 'checks', 'artifacts', 'instrumentLog', 'failedNodes', 'runError', 'exception', 'nativePassed']) same(c[key], oldCase[key]);
    assert.equal(c.status, state.run.status); assert.equal(c.steps, state.run.steps); assert.equal(c.cost, state.run.cost);
    assert.equal(c.eventCount, state.events.length); same(c.checks, []); assert.equal(c.artifactError, null);
    assert.equal(c.runError, null); assert.equal(c.exception, null);
    if (suite.split === 'heldout') assert.ok(!Object.hasOwn(c, 'diagnostic'));
    else same(c.diagnostic, { input: item.input, expected: item.expect });
    const predicted = spec.arm === 'mutant' ? { samples: obligations(item).manifest.samples.map(row => ({
      ...row, disposition: row.disposition === 'confirmed' ? 'inconclusive' : row.disposition
    })) } : obligations(item).manifest;
    same(state.artifact.manifest, predicted, 'Repair/mutant difference must be confined to the injected classification');
    same(c.artifacts, [{ name: 'manifest.json', passed: state.contentMatches, sha256: state.artifact.sha256 }]);
    assert.equal(c.nativePassed, state.contentMatches); assert.equal(c.v1Passed, oldCase.passed);
    assert.equal(oldCase.passed, state.contentMatches && oldCase.instrumentAudit.passed && state.run.steps <= PUBLIC_BUDGET.maxStepsPerRun);
    const ownPass = state.contentMatches && state.replayedAudit.passed;
    assert.equal(c.passed, ownPass); assert.equal(c.falseSuccess, !ownPass);
    same(c.evidenceBinding, { passed: true, eventHead: state.run.eventHead, eventsHash: digest(state.events),
      instrumentLogHash: digest(c.instrumentLog), manifestSha256: state.artifact.sha256 });
    if (ownPass) passed++;
    eventCount += state.events.length; instrumentCount += state.instrumentCount;
    steps += state.run.steps; syntheticCost += state.syntheticCost; times.push([state.createdAt, state.endedAt]);
    const evidence = { arm: spec.arm, split: spec.split, caseIndex: index, caseIdHash: digest(item.id), runId: c.runId,
      workflowHash: state.run.workflowHash, runHash: digest(state.run), eventsHash: digest(state.events),
      eventCount: state.events.length, eventHead: state.run.eventHead, instrumentLogHash: digest(c.instrumentLog),
      manifestSha256: state.artifact.sha256, outcomeMatches: ownPass, artifactByteCount: state.artifact.bytes,
      createdAt: state.createdAt, endedAt: state.endedAt };
    savedCases.push(evidence); caseEvidence.push(evidence);
  }
  assert.equal(passed, spec.expectedPasses); assert.equal(report.passed, passed === suite.cases.length);
  const metrics = { ...v1.metrics, v1PassedCount: v1.metrics.passedCount, passedCount: passed,
    successFraction: passed / suite.cases.length, falseSuccessCount: suite.cases.length - passed,
    logBindingErrors: 0, completionErrors: 0, evidenceOrderErrors: 0, prematureConfirmations: 0, allProcessingDiagnosticFailures: 0 };
  same(report.metrics, metrics);
  assert.equal(report.metrics.caseCount, suite.cases.length); assert.equal(report.metrics.totalSteps, steps);
  assert.equal(report.metrics.totalCost, 0); assert.equal(report.metrics.syntheticCost, syntheticCost);
  for (const key of ['missingCalls', 'forbiddenCalls', 'duplicateCalls']) assert.equal(report.metrics[key], 0);
  assert.ok(report.metrics.elapsedMs >= Math.max(...times.map(t => t[1])) - Math.min(...times.map(t => t[0])));
  same(report.fixtureValidation, oracle.validateFixtures(suite));
  const summary = { arm: spec.arm, split: spec.split, passed, cases: suite.cases.length,
    falseSuccesses: suite.cases.length - passed, eventCount, instrumentCount, steps, syntheticCost,
    firstRunAt: Math.min(...times.map(t => t[0])), lastRunAt: Math.max(...times.map(t => t[1])),
    reportSha256: sha(bytes(spec.file)), reportDigest: digest(report) };
  reports.push({ ...spec, report, summary });
  return summary;
});

let originalState, finalState;
check('original-run-events-fixture-artifact-and-observation-unchanged', () => {
  originalState = inspectSavedRun(path.join(study, 'workspace'), ready.runId, faulty, sample, wrong.calls);
  same(originalState.run, wrong.run); same(originalState.events, wrong.events); same(originalState.artifact, wrong.artifact);
  same(originalState.replayedAudit, wrong.audit); assert.equal(originalState.contentMatches, false);
  same(main.oldObservation, oldObservation); assert.equal(bodyHash(oldObservation), oldObservation.id);
  same(Buffer.from(oldObservation.artifact.base64, 'base64'), Buffer.from(wrong.artifact.text, 'utf8'));
  assert.equal(oldObservation.artifact.sha256, originalState.artifact.sha256);
  assert.equal(digest(main.originalRequest), oldObservation.binding.requestHash);
  assert.equal(digest(main.originalRequest), oldObservation.binding.rootRequestHash);
  assert.equal(digest(main.originalProposal), oldObservation.binding.proposalHash);
  assert.equal(digest(originalState.run), oldObservation.binding.runHash);
  assert.equal(oldObservation.outcome, 'unsatisfied'); assert.equal(oldObservation.binding.runStatus, 'succeeded');
  same(main.contract, contract); assert.equal(main.contract.id, ready.contractId);
  return { runId: ready.runId, runStatus: originalState.run.status, outcome: oldObservation.outcome,
    eventCount: originalState.events.length, wrongArtifactSha256: originalState.artifact.sha256,
    wrongArtifactBytes: originalState.artifact.bytes, preservedObservationId: oldObservation.id };
});
check('new-applied-run-exact-bytes-and-satisfied-same-contract-observation', () => {
  finalState = inspectSavedRun(path.join(study, 'workspace'), result.runId, candidate, sample, repaired.calls);
  same(finalState.run, repaired.run); same(finalState.events, repaired.events); same(finalState.artifact, repaired.artifact);
  same(finalState.replayedAudit, repaired.audit); assert.equal(finalState.contentMatches, true);
  assert.notEqual(result.runId, ready.runId); same(finalState.fixture, originalState.fixture);
  assert.equal(bodyHash(observation), observation.id); same(main.observation, observation);
  assert.equal(observation.contractId, contract.id); assert.equal(observation.contractId, oldObservation.contractId);
  same(Buffer.from(observation.artifact.base64, 'base64'), Buffer.from(finalState.artifact.text, 'utf8'));
  assert.equal(observation.artifact.sha256, finalState.artifact.sha256); assert.equal(observation.artifact.bytes, finalState.artifact.bytes);
  assert.equal(observation.outcome, 'satisfied'); assert.equal(observation.reason, 'exact-json-match');
  assert.equal(observation.observedJsonHash, digest(contract.expected));
  const bound = observation.binding;
  same(bound, { requestId: ready.repairId, proposalId: main.proposal.id, runId: finalState.run.id,
    rootRequestId: ready.requestId, requestHash: digest(main.request), proposalHash: digest(main.proposal),
    rootRequestHash: digest(main.originalRequest), workflowId: candidate.id, workflowHash: digest(candidate), workflowVersion: 2,
    registryHash, engineHash: finalState.run.engineHash, inputHash: digest(finalState.run.input),
    policyHash: digest(finalState.run.policy), eventHead: finalState.run.eventHead,
    eventCount: finalState.events.length, runStatus: 'succeeded', runHash: digest(finalState.run) });
  const producer = finalState.events.find(e => e.type === 'node.completed' && e.output?.name === 'manifest.json');
  same(observation.artifact.producers, [{ nodeKey: producer.nodeKey, sequence: producer.seq, eventHash: producer.hash }]);
  same(finalState.artifact.manifest, contract.expected);
  same(diff(wrong.artifact.manifest, finalState.artifact.manifest), [{ path: '/samples/1/disposition', before: 'inconclusive', after: 'confirmed' }]);
  return { runId: finalState.run.id, runStatus: finalState.run.status, observationId: observation.id,
    contractId: contract.id, outcome: observation.outcome, eventCount: finalState.events.length,
    artifactSha256: finalState.artifact.sha256, artifactBytes: finalState.artifact.bytes };
});
check('aggregates-job-assessment-qualified-reports-and-delivery-all-match', () => {
  assert.equal(reports.length, 4);
  const dev = reports.find(r => r.arm === 'repaired' && r.split === 'development').report;
  const sealed = reports.find(r => r.arm === 'repaired' && r.split === 'sealed').report;
  const mutantDev = reports.find(r => r.arm === 'mutant' && r.split === 'development').report;
  const mutantSealed = reports.find(r => r.arm === 'mutant' && r.split === 'sealed').report;
  same(attempt.assessment.evaluation, dev); same(read('SEALED_AGGREGATE.json'), oracle.aggregate(sealed));
  same(read('MUTANT_DEVELOPMENT_AGGREGATE.json'), oracle.aggregate(mutantDev));
  same(read('MUTANT_SEALED_AGGREGATE.json'), oracle.aggregate(mutantSealed));
  same(result.sealed, oracle.aggregate(sealed)); same(result.mutant.development, oracle.aggregate(mutantDev));
  same(result.mutant.sealed, oracle.aggregate(mutantSealed));
  assert.equal(main.qualifications.length, 2);
  for (const q of main.qualifications) {
    assert.equal(q.id, digest(q.report)); assert.equal(q.workflowHash, digest(candidate));
    same(q.report, q.report.split === 'heldout' ? sealed : dev);
  }
  const matched = [sealed, dev].map(r => ({ id: digest(r), evaluatorId: r.evaluatorId, passed: r.passed,
    split: r.split, envelope: r.envelope, qualification: r.qualification }));
  same(delivery.matchedTaskEvidence, matched);
  same(without(delivery, 'matchedTaskEvidence', 'qualification'), { requestId: ready.repairId, proposalId: main.proposal.id,
    runId: result.runId, workflowId: candidate.id, workflowHash: digest(candidate), workflowVersion: 2,
    inputHash: digest(sample.input), registryHash, eventHead: finalState.run.eventHead,
    eventCount: finalState.events.length, status: 'succeeded', localExecutionSucceeded: true, independentTaskVerified: false });
  assert.equal(job.deploymentQualified, true); assert.equal(job.qualificationLevel, 'task-outcome');
  assert.equal(job.qualification, 'Task outcome checked only within the evaluator-declared envelope; not general deployment readiness');
  assert.equal(result.success, true); assert.equal(result.stage, 'observed-model-repair-and-native-reexecution');
  assert.equal(result.requestId, ready.requestId); assert.equal(result.repairRequestId, ready.repairId);
  assert.equal(result.contractId, contract.id); assert.equal(result.preservedWrongArtifact, true);
  same([result.initialStatus, result.initialOutcome, result.finalStatus, result.finalOutcome], ['succeeded', 'unsatisfied', 'succeeded', 'satisfied']);
  return { registeredQualificationCount: main.qualifications.length, deliveryIndependentTaskVerified: false,
    legacyDeploymentQualifiedFlag: true, flagScope: job.qualification };
});
check('response-freeze-regression-promotion-application-run-observation-chronology', () => {
  const at = value => Date.parse(value);
  assert.ok(job.createdAt <= attempt.startedAt && attempt.startedAt <= at(call.at));
  const responseMtime = statSync(path.join(study, 'packet/RESPONSE_1.json')).mtimeMs;
  const authorMtime = statSync(path.join(study, 'packet/AUTHOR_1.json')).mtimeMs;
  assert.ok(at(call.at) <= responseMtime && responseMtime <= authorMtime && authorMtime <= at(received.receivedAt));
  const find = (arm, split) => reports.find(r => r.arm === arm && r.split === split).summary;
  const dev = find('repaired', 'development'), sealed = find('repaired', 'sealed');
  const mutantDev = find('mutant', 'development'), mutantSealed = find('mutant', 'sealed');
  const timeline = { relayReceived: at(received.receivedAt), developmentFirstRun: dev.firstRunAt,
    developmentLastRun: dev.lastRunAt, attemptAccepted: attempt.finishedAt, proposalCreated: main.proposal.createdAt,
    generationFinished: job.finishedAt, candidateFrozen: at(candidateFreeze.frozenAt),
    sealedFirstRun: sealed.firstRunAt, sealedLastRun: sealed.lastRunAt,
    mutantDevelopmentFirst: mutantDev.firstRunAt, mutantDevelopmentLast: mutantDev.lastRunAt,
    mutantSealedFirst: mutantSealed.firstRunAt, mutantSealedLast: mutantSealed.lastRunAt,
    explicitPromotion: at(promotion.at), appliedAt: main.proposal.appliedAt,
    finalRunCreated: finalState.run.createdAt, finalRunSucceeded: finalState.endedAt,
    satisfiedObserved: observation.observedAt, resultFinalized: at(result.finishedAt) };
  const values = Object.values(timeline); assert.ok(values.every(Number.isFinite));
  for (let index = 1; index < values.length; index++) assert.ok(values[index] >= values[index - 1], Object.keys(timeline)[index]);
  for (const entry of reports) assert.ok(statSync(entry.file).mtimeMs <= at(promotion.at));
  assert.equal(promotion.proposalId, main.proposal.id); assert.equal(promotion.workflowHash, digest(candidate));
  assert.equal(promotion.authority, config.authority);
  assert.ok(at(result.finishedAt) <= at('2026-09-17T08:49:52Z'), 'Finalized before reviewer release');
  return { ...timeline, responseFileMtime: responseMtime, authorFileMtime: authorMtime,
    qualification: 'Local saved timestamps, file metadata, and frozen control flow; no externally authenticated wall-clock sequence.' };
});
check('all-28-saved-runs-distinct-and-all-checked-inputs-stable', () => {
  assert.equal(caseEvidence.length, 26);
  const runIds = [...caseEvidence.map(c => c.runId), ready.runId, result.runId];
  assert.equal(new Set(runIds).size, 28);
  for (const file of inputHashes.values()) assert.equal(sha(readFileSync(file.path)), file.sha256, file.path);
  return { distinctSavedRuns: runIds.length, regressionRuns: caseEvidence.length,
    originalAndFinalRuns: 2, checkedFiles: inputHashes.size };
});

const failed = checks.filter(c => !c.passed);
const findings = [
  { id: 'B1', status: 'run-specific-binding-discharged-under-trusted-host-record-boundary',
    genericSourceGapPreserved: true,
    detail: 'Raw response, author bytes, native attempt, job and applied candidate agree. AUTHOR explicitly leaves unavailable prompt hash/time unknown. Prime-recorded host status corroborates worker-5 configured model 6/pro. The unchanged relay still does not parse AUTHOR; this audit supplies the run-specific binding, not general enforcement or independent remote-model attestation.' },
  { id: 'B2', status: 'run-specific-context-and-first-prompt-equality-discharged', genericSourceGapPreserved: true,
    detail: 'Prepared context, native saved context, both prompt files, selected skill bytes and the pre-response audit agree. All 111 prior inputs remain unchanged. The unchanged campaign still omits generic prepared-context equality and two selected skills from its freeze list.' },
  { id: 'L1', status: 'claim-limit', detail: 'The researcher injected the fault and supplied explicit expected development feedback. The same builder retained its earlier solution and aggregate construction results. Version 2 exactly restores the original program values except version. This does not isolate outcome feedback as the cause, demonstrate novel repair discovery, naturally arising error repair, learning or a general success rate.' },
  { id: 'L2', status: 'claim-limit', detail: '5 development and 8 provider-withheld scenarios are fixed, source-informed synthetic regressions. There is one recorded generation round and no sealed feedback round. Procedural withholding and author statements do not prove OS isolation or absence of ambient prior knowledge.' },
  { id: 'L3', status: 'claim-limit', detail: 'Validated evidence completion precedes confirmed publication in saved runs; the stronger all-processing completion diagnostic also passes. Finite output and time checks do not prove general causal use, arbitrary scheduling robustness or real instrument validity.' },
  { id: 'L4', status: 'claim-limit', detail: 'GENERATION_JOB retains deploymentQualified:true as a compatibility field scoped to task-outcome evaluation; its adjacent qualification excludes general deployment readiness. DELIVERY.independentTaskVerified is false. Neither field combination is commercial or production qualification.' },
  { id: 'L5', status: 'claim-limit', detail: 'Host local receipts establish the saved experiment under a trusted filesystem/host boundary. They do not independently attest remote model weights, token use, billed cost, all author tool activity or wall-clock authenticity.' }
];
const audit = { schemaVersion: 'outcome-model-independent-results-review/1', reviewer: 'worker-6',
  releaseReceived: '2026-09-17T08:49:52Z', startedAt, finishedAt: new Date().toISOString(),
  verdict: failed.length ? 'SAVED_RESULT_AUDIT_FAILED' : 'PASS_BOUNDED_SAME_BUILDER_INJECTED_FAULT_REPAIR',
  checkCount: checks.length, passedChecks: checks.length - failed.length, failedChecks: failed.length,
  claimBlockers: failed.map(c => ({ check: c.name, error: c.error })),
  scope: 'Independent frozen-source/receipt/hash and saved-artifact scoring review; no model or native-case reruns.',
  operations: { newWorkflowRuns: 0, modelCalls: 0, generationCalls: 0, trainingUpdates: 0,
    databaseMode: 'readOnly SELECT', pureOracleReplay: 'auditInstruments on saved evidence and freeze/fixture validation only',
    oldFilesChanged: 0, initialCheckOutputsRewritten: false, authorContextReads: 0, builderMessages: 0 },
  reviewerValidationHistory: [
    { stage: 'first checker dry-run', recordedToolChunk: '6635b5', exitCode: 1, passedChecks: 10, failedChecks: 9,
      primaryFailedGroups: ['repaired-development', 'repaired-sealed', 'mutant-development', 'mutant-sealed', 'original-run', 'final-run'],
      dependentFailedGroups: ['aggregate-report-linkage', 'chronology', 'distinct-run-count'],
      cause: 'Reviewer assumed the saved fixture equals the supplied fixture without Store normalization. Actual saved fixtures include actions:[] and wrongActions:0.',
      sourceResolution: 'Frozen src/store.mjs:104 inserts canonical({...fixture, actions:[], wrongActions:0}). The checker now requires that complete normalized fixture, including exact observation data and zero counters.',
      campaignEvidenceChanged: false, auditFileWritten: false,
      preservation: 'Original negative output remains in the host tool recording; this entry preserves its cause and disposition.' },
    { stage: 'corrected checker dry-run', recordedToolChunk: '4990bc', exitCode: 0,
      passedChecks: 19, failedChecks: 0, savedRegressionCasesRescored: 26, newNativeCases: 0, auditFileWritten: false }
  ],
  protocol: { configurationSha256: protocol.configurationSha256, sourceSha256: initial.protocol.sourceHash },
  identity: { source: 'Prime-recorded actual host status plus saved relay/author consistency', hostRunId: host.runId,
    configuredModel: config.model, configuredReasoningEffort: config.reasoningEffort, author: config.author,
    independentRemoteModelAttestation: false, usage: null, billedCost: null },
  response: { sha256: sha(responseBytes), authorReceiptSha256: received.authorReceiptSha256,
    promptSha256: sha(prompt), contextHash: context.contextHash, recordedRounds: job.attempts.length },
  trajectory: { originalWorkflowHash: ready.originalWorkflowHash, faultyWorkflowHash: ready.workflowHash,
    repairedWorkflowHash: digest(candidate), generationJobId: job.id, proposalId: job.proposalId,
    contractId: contract.id, oldRunId: ready.runId, oldObservationId: oldObservation.id,
    finalRunId: result.runId, finalObservationId: observation.id },
  suites: reports.map(r => r.summary), checks, findings, caseEvidence, databaseReads,
  inputHashes: [...inputHashes.values()], checkerSha256: sha(readFileSync(fileURLToPath(import.meta.url))) };
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--write')) throw new Error('Use result-check.mjs [--write]');
if (args[0] === '--write') writeFileSync(path.join(own, 'RESULT_AUDIT.json'), JSON.stringify(audit, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ verdict: audit.verdict, checks: audit.checkCount, passed: audit.passedChecks,
  failures: failed, suiteScores: audit.suites.map(s => ({ arm: s.arm, split: s.split, passed: s.passed, cases: s.cases, falseSuccesses: s.falseSuccesses })),
  savedCasesRescored: caseEvidence.length, inputFiles: inputHashes.size,
  databaseReads: databaseReads.length, auditWritten: args[0] === '--write' }, null, 2));
if (failed.length) process.exitCode = 1;
