// Independent INITIAL review of saved preparation evidence only.
// No campaign imports, workflow execution, model calls, or post-repair result reads.
// Run: node outcome-model-independent-20260917/check.mjs [--write]
// --write creates only this directory's AUDIT.json and refuses to overwrite it.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const own = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(own);
const product = path.resolve(root, '../../workflow-foundry');
const prepared = path.join(root, 'benchmark/outcome-model-001');
const startedAt = new Date().toISOString();
const hashes = new Map();
const checks = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Written independently after inspecting data.mjs. Only ordinary parsed JSON is used.
const sorted = value => Array.isArray(value) ? value.map(sorted)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const canonical = value => JSON.stringify(sorted(value));
const digest = value => sha(canonical(value));
const same = (a, b) => assert.deepEqual(a, b);
function bytes(filename) {
  const value = readFileSync(filename);
  hashes.set(filename, { path: filename, sha256: sha(value), bytes: value.length });
  return value;
}
const json = filename => JSON.parse(bytes(filename).toString('utf8'));
const read = name => json(path.join(prepared, name));
function check(name, fn) {
  try { checks.push({ name, passed: true, detail: fn() ?? null }); }
  catch (error) { checks.push({ name, passed: false, error: String(error.message).slice(0, 700) }); }
}
function bodyHash(record, field = 'id') {
  const { [field]: ignored, ...body } = record;
  return digest(body);
}
function diff(a, b, at = '') {
  if (canonical(a) === canonical(b)) return [];
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object'
    || Array.isArray(a) !== Array.isArray(b)) return [{ path: at, before: a, after: b }];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap(key => {
    const next = `${at}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) {
      return [{ path: next, beforePresent: Object.hasOwn(a, key), afterPresent: Object.hasOwn(b, key) }];
    }
    return diff(a[key], b[key], next);
  });
}

const protocol = read('PROTOCOL.json');
const ready = read('READY.json');
const original = read('ORIGINAL_MODEL_CANDIDATE.json');
const faulty = read('FAULTY_CANDIDATE.json');
const initialRequest = read('INITIAL_REQUEST.json');
const initialProposal = read('FAULT_PROPOSAL.json');
const sample = read('DEVELOPMENT_CASE.json');
const contract = read('CONTRACT.json');
const execution = read('WRONG_EXECUTION.json');
const observation = read('WRONG_OBSERVATION.json');
const repair = read('REPAIR_REQUEST.json');
const context = read('REPAIR_CONTEXT.json');
const v1Freeze = json(path.join(root, 'benchmark/FREEZE.json'));
const v2Freeze = json(path.join(root, 'benchmark/FREEZE_V2.json'));
const config = protocol.configuration;
const run = execution.run;
const events = execution.events;
const calls = execution.calls;
const sourceOriginalPath = path.join(root, 'benchmark/campaign-cos-001/CANDIDATE.json');
const sourceOriginalBytes = bytes(sourceOriginalPath);
const frozenFiles = [...config.sourceHashes, ...v1Freeze.files, ...v2Freeze.files];
const frozenPaths = new Set(frozenFiles.map(file => file.path));
const skillCoverage = context.skills.map(skill => ({
  name: skill.name, sha256: skill.sha256,
  coveredByFreeze: frozenPaths.has(path.join(product, 'skills', skill.name, 'SKILL.md'))
}));

check('protocol-content-digest', () => {
  assert.equal(digest(config), protocol.configurationSha256);
  assert.equal(config.schemaVersion, 'outcome-model-repair-control/1');
  assert.equal(config.author, 'worker-5');
  assert.equal(config.model, '6');
  assert.equal(config.reasoningEffort, 'pro');
  same([config.maxRounds, config.maxDurationMs], [2, 900000]);
  return { configurationSha256: protocol.configurationSha256, identityStatus: 'declaration; not model attestation' };
});
check('all-declared-source-and-freeze-file-hashes', () => {
  const unique = new Map();
  for (const file of frozenFiles) {
    assert.ok(file.path.startsWith(`${root}/`) || file.path.startsWith(`${product}/`));
    if (unique.has(file.path)) assert.equal(unique.get(file.path), file.sha256);
    unique.set(file.path, file.sha256);
  }
  for (const [filename, expected] of unique) assert.equal(sha(bytes(filename)), expected, filename);
  assert.equal(process.version, v2Freeze.nodeVersion);
  assert.equal(sha(bytes(path.join(root, 'benchmark/FREEZE.json'))), v2Freeze.v1FreezeSha256);
  return { entries: frozenFiles.length, uniqueFiles: unique.size, node: process.version };
});
check('original-candidate-preserved', () => {
  same(JSON.parse(sourceOriginalBytes), original);
  assert.equal(digest(original), ready.originalWorkflowHash);
  return { workflowHash: digest(original), originalFileSha256: sha(sourceOriginalBytes),
    preparedCopyByteIdentical: sourceOriginalBytes.equals(bytes(path.join(prepared, 'ORIGINAL_MODEL_CANDIDATE.json'))) };
});
check('exactly-one-fault-scalar', () => {
  const changes = diff(original, faulty);
  same(changes, [{ path: config.fault.path, before: config.fault.before, after: config.fault.after }]);
  assert.equal(faulty.nodes[0].body.nodes[6].id, 'confirmedRow');
  assert.equal(digest(faulty), ready.workflowHash);
  assert.equal(faulty.version, 1);
  same(faulty.acceptance, original.acceptance);
  same(faulty.envelope, original.envelope);
  return changes;
});
check('prepared-case-is-frozen-development-case', () => {
  const suite = json(path.join(root, 'benchmark/development/SUITE.json'));
  assert.equal(sample.id, config.developmentObservation);
  const matching = suite.cases.filter(item => item.id === sample.id);
  assert.equal(matching.length, 1);
  same(sample, matching[0]);
  return { caseId: sample.id, suiteSha256: digest(suite), caseCount: suite.cases.length };
});

// Independent interpretation of the public observation rules for this saved case.
const independentExpected = { samples: sample.input.samples.map(({ id }) => {
  const { screen, reproduce } = sample.fixture.observations[id];
  let disposition;
  if (screen.error) disposition = 'error';
  else {
    const s = screen.returned;
    if (s?.ok !== true || s.sampleId !== id || typeof s.suspicious !== 'boolean') disposition = 'inconclusive';
    else if (!s.suspicious) disposition = 'clear';
    else if (reproduce.error) disposition = 'error';
    else {
      const r = reproduce.returned;
      const complete = r?.ok === true && r.sampleId === id && r.independent === true
        && typeof r.evidenceId === 'string' && r.evidenceId.length > 0 && typeof r.reproduced === 'boolean';
      disposition = complete ? (r.reproduced ? 'confirmed' : 'not_reproduced') : 'inconclusive';
    }
  }
  return { sampleId: id, disposition };
}) };
check('frozen-expectation-and-contract-identifier', () => {
  assert.equal(bodyHash(contract), contract.id);
  assert.equal(contract.id, ready.contractId);
  assert.equal(contract.rootRequestId, initialRequest.id);
  assert.equal(contract.rootTextHash, digest(initialRequest.text));
  assert.equal(contract.inputHash, digest(sample.input));
  assert.equal(contract.registryHash, v2Freeze.registryHash);
  same(contract.expected, sample.expect.artifacts.find(x => x.name === 'manifest.json').json);
  same(contract.expected, independentExpected);
  return { expected: independentExpected, evaluator: contract.evaluator };
});
check('recorded-local-chronology', () => {
  const chronology = {
    v2Freeze: Date.parse(v2Freeze.frozenAt), protocolFreeze: Date.parse(protocol.frozenAt),
    requestCreated: initialRequest.createdAt,
    contractFileMtime: statSync(path.join(prepared, 'CONTRACT.json')).mtimeMs,
    proposalCreated: initialProposal.createdAt, runCreated: run.createdAt,
    runFinished: events.at(-1).at, observed: observation.observedAt,
    repairRequested: repair.createdAt, ready: Date.parse(ready.readyAt)
  };
  const values = Object.values(chronology);
  assert.ok(values.every(Number.isFinite));
  for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1], Object.keys(chronology)[i]);
  return { ...chronology, qualification: 'Local timestamps and frozen source control flow; no remote timestamp attestation. Contract registration has no embedded creation timestamp.' };
});
check('native-run-and-67-event-chain', () => {
  assert.equal(run.id, ready.runId);
  assert.equal(run.workflowHash, digest(faulty));
  assert.equal(run.workflowId, faulty.id);
  same(run.input, sample.input);
  assert.equal(run.status, 'succeeded');
  assert.equal(run.owner, null);
  assert.equal(run.error, null);
  assert.equal(events.length, 67);
  let previousHash = null;
  for (const [index, event] of events.entries()) {
    assert.equal(event.seq, index + 1);
    assert.equal(event.previousHash, previousHash);
    assert.equal(bodyHash(event, 'hash'), event.hash);
    if (Object.hasOwn(event, 'outputHash')) assert.equal(digest(event.output), event.outputHash);
    previousHash = event.hash;
  }
  const birth = events[0];
  assert.equal(birth.type, 'run.created');
  assert.equal(birth.workflowHash, run.workflowHash);
  assert.equal(birth.registryHash, contract.registryHash);
  assert.equal(birth.engineHash, run.engineHash);
  assert.equal(birth.inputHash, digest(run.input));
  assert.equal(birth.policyHash, digest(run.policy));
  same(run.eventHead, { seq: events.length, hash: previousHash });
  assert.equal(events.at(-1).type, 'run.succeeded');
  return { eventCount: events.length, eventHead: run.eventHead, eventsHash: digest(events) };
});

const instrumentAttempts = [];
check('instrument-logs-completed-outputs-and-required-attempts', () => {
  const intents = events.filter(e => e.type === 'tool.intent' && ['lab.screen', 'lab.reproduce'].includes(e.tool));
  assert.equal(intents.length, calls.length);
  for (const [index, call] of calls.entries()) {
    const intent = intents[index];
    assert.equal(call.ordinal, index + 1);
    assert.equal(intent.tool, `lab.${call.instrument}`);
    assert.equal(intent.nodeKey, call.nodeKey);
    assert.equal(intent.argsHash, digest({ sampleId: call.sampleId }));
    assert.equal(intent.idempotencyKey, call.idempotencyKey);
    assert.equal(call.idempotencyKey, digest({ runId: run.id, nodeKey: intent.nodeKey,
      workflowHash: run.workflowHash, args: { sampleId: call.sampleId } }));
    assert.equal(call.outcome, 'returned'); // This independent check is explicitly for dev-basic.
    const next = events.find(e => e.seq > intent.seq && e.nodeKey === intent.nodeKey && e.type === 'tool.intent');
    const interval = events.filter(e => e.seq > intent.seq && e.seq < (next?.seq ?? Infinity) && e.nodeKey === intent.nodeKey);
    const completed = interval.filter(e => e.type === 'node.completed');
    assert.equal(completed.length, 1);
    assert.ok(!interval.some(e => ['tool.failed', 'node.failed', 'node.handled_error', 'effect.uncertain'].includes(e.type)));
    same(completed[0].output, call.observation);
    same(call.observation, sample.fixture.observations[call.sampleId][call.instrument].returned);
    instrumentAttempts.push({ sampleId: call.sampleId, instrument: call.instrument, intent: intent.seq, completed: completed[0].seq });
  }
  const expected = sample.input.samples.flatMap(({ id }) => {
    const value = sample.fixture.observations[id].screen.returned;
    return ['screen', ...(value?.ok === true && value.sampleId === id && value.suspicious === true ? ['reproduce'] : [])]
      .map(instrument => `${id}/${instrument}`);
  });
  same(calls.map(c => `${c.sampleId}/${c.instrument}`).sort(), expected.sort());
  for (const reproduction of instrumentAttempts.filter(a => a.instrument === 'reproduce')) {
    const screens = instrumentAttempts.filter(a => a.instrument === 'screen' && a.sampleId === reproduction.sampleId);
    assert.equal(screens.length, 1);
    assert.ok(screens[0].completed < reproduction.intent);
  }
  assert.equal(calls.reduce((sum, c) => sum + c.syntheticCost, 0), 23);
  return { screen: 3, reproduce: 2, syntheticCost: 23, instrumentLogHash: digest(calls), attempts: instrumentAttempts };
});
check('actual-artifact-bytes-publication-and-wrong-content', () => {
  const filename = path.join(prepared, 'workspace/.foundry/artifacts', run.id, 'manifest.json');
  assert.ok(lstatSync(filename).isFile());
  assert.equal(realpathSync(filename), filename);
  const actual = bytes(filename);
  const preserved = Buffer.from(observation.artifact.base64, 'base64');
  assert.ok(actual.equals(preserved));
  assert.equal(actual.toString('utf8'), execution.artifact.text);
  assert.equal(actual.length, execution.artifact.bytes);
  assert.equal(sha(actual), execution.artifact.sha256);
  assert.equal(sha(actual), ready.artifactSha256);
  same(JSON.parse(actual), execution.artifact.manifest);
  const args = { name: 'manifest.json', content: actual.toString('utf8') };
  assert.equal(digest(args), execution.artifact.argsHash);
  const intents = events.filter(e => e.type === 'tool.intent' && e.tool === 'core.artifact');
  assert.equal(intents.length, 1);
  const intent = intents[0];
  assert.equal(intent.argsHash, digest(args));
  assert.equal(intent.idempotencyKey, digest({ runId: run.id, nodeKey: intent.nodeKey, workflowHash: run.workflowHash, args }));
  const completion = events.filter(e => e.nodeKey === intent.nodeKey && e.type === 'node.completed');
  assert.equal(completion.length, 1);
  assert.equal(completion[0].output.sha256, sha(actual));
  assert.equal(completion[0].output.bytes, actual.length);
  assert.equal(completion[0].output.name, 'manifest.json');
  assert.ok(instrumentAttempts.every(a => a.completed < intent.seq));
  same(observation.artifact.producers, [{ nodeKey: intent.nodeKey, sequence: completion[0].seq, eventHash: completion[0].hash }]);
  const mismatch = diff(contract.expected, execution.artifact.manifest);
  same(mismatch, [{ path: '/samples/1/disposition', before: 'confirmed', after: 'inconclusive' }]);
  return { bytes: actual.length, sha256: sha(actual), publicationStart: intent.seq,
    publicationCompleted: completion[0].seq, mismatch };
});
check('observation-identifier-and-run-bindings', () => {
  const binding = observation.binding;
  assert.equal(bodyHash(observation), observation.id);
  assert.equal(observation.id, ready.observationId);
  assert.equal(observation.outcome, 'unsatisfied');
  assert.equal(observation.reason, 'json-content-mismatch');
  assert.equal(observation.observedJsonHash, digest(execution.artifact.manifest));
  assert.equal(binding.runHash, digest(run));
  assert.equal(binding.workflowHash, digest(faulty));
  assert.equal(binding.runId, run.id);
  assert.equal(binding.runStatus, run.status);
  assert.equal(binding.workflowVersion, 1);
  assert.equal(binding.workflowId, faulty.id);
  assert.equal(binding.registryHash, run.registryHash);
  assert.equal(binding.engineHash, run.engineHash);
  assert.equal(binding.policyHash, digest(run.policy));
  assert.equal(binding.inputHash, digest(run.input));
  same(binding.eventHead, run.eventHead);
  assert.equal(binding.eventCount, events.length);
  return { receiptId: observation.id, runStatus: run.status, outcome: observation.outcome };
});
check('live-database-original-applied-state-and-receipts-read-only', () => {
  const db = new DatabaseSync(path.join(prepared, 'workspace/.foundry/foundry.sqlite'), { readOnly: true });
  try {
    const get = (table, id) => {
      assert.ok(['requests', 'proposals', 'runs', 'workflows', 'outcome_contracts', 'outcome_observations'].includes(table));
      const key = table === 'workflows' ? 'hash' : 'id';
      const row = db.prepare(`SELECT body FROM ${table} WHERE ${key}=?`).get(id);
      assert.ok(row, `${table} ${id}`);
      return JSON.parse(row.body);
    };
    const savedRequest = get('requests', initialRequest.id);
    const savedProposal = get('proposals', initialProposal.id);
    assert.equal(savedRequest.status, 'applied');
    assert.equal(savedProposal.status, 'applied');
    same(savedRequest, { ...initialRequest, status: 'applied' });
    const { appliedAt, ...proposalWithoutTime } = savedProposal;
    same(proposalWithoutTime, { ...initialProposal, status: 'applied' });
    assert.ok(appliedAt >= initialProposal.createdAt && appliedAt <= run.createdAt);
    assert.equal(digest(savedRequest), observation.binding.requestHash);
    assert.equal(digest(savedRequest), observation.binding.rootRequestHash);
    assert.equal(digest(savedProposal), observation.binding.proposalHash);
    assert.equal(savedProposal.workflowHash, run.workflowHash);
    same(savedProposal.workflow, faulty);
    same(get('workflows', ready.workflowHash), faulty);
    same(get('runs', run.id), run);
    const savedEvents = db.prepare('SELECT body,hash FROM events WHERE run_id=? ORDER BY seq').all(run.id)
      .map(row => ({ ...JSON.parse(row.body), hash: row.hash }));
    same(savedEvents, events);
    same({ id: contract.id, ...get('outcome_contracts', contract.id) }, contract);
    same({ id: observation.id, ...get('outcome_observations', observation.id) }, observation);
    const frozenRepair = JSON.parse(db.prepare('SELECT body FROM outcome_repairs WHERE request_id=?').get(repair.id).body);
    assert.equal(digest(frozenRepair.request), frozenRepair.requestHash);
    assert.equal(frozenRepair.receiptId, observation.id);
    const { reused, ...repairWithoutReturnFlag } = repair;
    assert.equal(reused, false);
    same(frozenRepair.request, repairWithoutReturnFlag);
    return { originalRequestStatus: savedRequest.status, originalProposalStatus: savedProposal.status,
      proposalAppliedAt: appliedAt, initialSnapshotStatuses: [initialRequest.status, initialProposal.status],
      qualification: 'Only original prepare records read; no generation jobs or repaired proposals inspected.' };
  } finally { db.close(); }
});
check('repair-lineage-fixed-intent-and-no-failed-run-relabel', () => {
  same([repair.id, repair.parentRequestId, repair.rootRequestId], [ready.repairId, ready.requestId, ready.requestId]);
  assert.equal(repair.text, initialRequest.text);
  assert.equal(repair.workflowId, faulty.id);
  assert.equal(repair.baseHash, ready.workflowHash);
  assert.equal(repair.appliedProposalId, initialProposal.id);
  assert.equal(repair.observedRunId, run.id);
  assert.equal(repair.observedRunStatus, 'succeeded');
  assert.equal(repair.outcomeReceiptId, observation.id);
  assert.equal(repair.outcomeContractId, contract.id);
  assert.equal(repair.repairCause, 'observed-outcome');
  assert.equal(repair.repairDepth, 1);
  assert.equal(repair.automaticGeneration, false);
  assert.ok(!Object.hasOwn(repair, 'failedRunId'));
  assert.ok(!Object.hasOwn(repair, 'failure'));
  assert.equal(repair.goal, original.goal);
  same(repair.successCriteria, original.envelope.successCriteria);
  return { requestId: repair.id, baseHash: repair.baseHash, repairDepth: repair.repairDepth };
});
check('prepared-context-and-bounded-comparison-bindings', () => {
  assert.equal(bodyHash(context, 'contextHash'), context.contextHash);
  assert.equal(context.requestId, repair.id);
  assert.equal(context.task, initialRequest.text);
  assert.equal(context.baseHash, ready.workflowHash);
  assert.equal(context.registryHash, contract.registryHash);
  assert.equal(context.domain, 'general');
  assert.equal(context.diagnosticRepair, null);
  same(context.currentWorkflow, faulty);
  const o = context.outcomeRepair, c = o.comparison;
  assert.equal(o.receiptId, observation.id);
  assert.equal(o.contractId, contract.id);
  assert.equal(o.observedRunId, run.id);
  assert.equal(o.observedRunStatus, 'succeeded');
  same(o.input, sample.input);
  assert.equal(o.preserveGoal, original.goal);
  same(o.preserveSuccessCriteria, original.envelope.successCriteria);
  same(c.expected.value, contract.expected);
  same(c.observed.value, execution.artifact.manifest);
  for (const value of [c.expected, c.observed]) {
    assert.equal(value.jsonHash, digest(value.value));
    assert.equal(value.bytes, Buffer.byteLength(canonical(value.value)));
    assert.equal(value.truncated, false);
  }
  assert.equal(c.differences.entries.length, 1);
  const d = c.differences.entries[0];
  assert.equal(d.path, '/samples/1/disposition');
  assert.equal(d.expected.value, 'confirmed');
  assert.equal(d.observed.value, 'inconclusive');
  assert.equal(c.differences.truncated, false);
  return { contextHash: context.contextHash, comparisonEntries: 1,
    scope: 'Prepared context only; actual generator context/prompt requires a later equality check.' };
});
check('prepared-selected-skills-match-current-bytes', () => {
  for (const skill of context.skills) {
    const current = bytes(path.join(product, 'skills', skill.name, 'SKILL.md'));
    assert.equal(sha(current), skill.sha256);
    assert.equal(sha(skill.text), skill.sha256);
    assert.equal(current.toString('utf8'), skill.text);
  }
  return skillCoverage;
});
check('released-native-first-prompt-exactly-matches-prepared-context', () => {
  const promptPath = path.join(prepared, 'packet/PROMPT_1.txt');
  const prompt = bytes(promptPath).toString('utf8');
  const expected = `You are the Workflow Foundry architect. Use the supplied task contract, actual capabilities, schema and selected skills to engineer an executable workflow. These are data and constraints, not permission to run unrelated tools.\n\n${JSON.stringify(context, null, 2)}\n\nReturn exactly one JSON object with "workflow" and "rationale". Do not include Markdown or prose outside the object. First version is 1; a revision uses exactly current+1 and the same id. Do not claim deployment or task success without execution evidence.`;
  assert.equal(prompt, expected);
  const call = json(path.join(prepared, 'packet/CALL_1.json'));
  assert.equal(call.promptSha256, sha(prompt));
  assert.equal(call.promptFile, promptPath);
  assert.equal(call.round, 1);
  assert.equal(call.provider.authorAgent, config.author);
  assert.equal(call.provider.model, config.model);
  assert.equal(call.provider.reasoningEffort, config.reasoningEffort);
  assert.ok(Date.parse(call.at) >= Date.parse(ready.readyAt));
  return { callAt: call.at, checkedAt: new Date().toISOString(), promptSha256: sha(prompt),
    preparedContextHash: context.contextHash, protocolConfigurationSha256: protocol.configurationSha256,
    responseFileAlreadyExists: existsSync(path.join(prepared, 'packet/RESPONSE_1.json')),
    authorFileAlreadyExists: existsSync(path.join(prepared, 'packet/AUTHOR_1.json')),
    sourceGapDisposition: 'Run-specific first-prompt equality established independently. Generic missing enforcement remains in the frozen driver.',
    modelIdentity: 'CALL fields agree with protocol declarations; this is not trusted model attestation.' };
});
check('known-native-engine-identity-recomputed', () => {
  const names = ['engine.mjs', 'runtime.mjs', 'store.mjs', 'data.mjs', 'dataflow.mjs', 'validate.mjs', 'capabilities.mjs'];
  const files = Object.fromEntries(names.map(name => [name, sha(bytes(path.join(product, 'src', name)))]));
  files['../schemas/workflow.schema.json'] = sha(bytes(path.join(product, 'schemas/workflow.schema.json')));
  const ajv = json(path.join(product, 'node_modules/ajv/package.json'));
  const descriptor = { contract: 'native-engine-identity/1', node: process.version, platform: process.platform,
    architecture: process.arch, validator: `ajv@${ajv.version}`, files };
  assert.equal(sha(JSON.stringify(descriptor)), run.engineHash);
  return { engineHash: run.engineHash, node: process.version, validator: descriptor.validator };
});

// Source findings are independently reasoned review findings, not executions of hypothetical attacks.
const findings = [
  { id: 'B1', severity: 'claim-blocking', category: 'authorship-binding',
    status: 'open-in-frozen-source',
    source: 'relay-provider.mjs:13-19,21-45; outcome-campaign.mjs:30-40,125-134',
    finding: 'Relay hashes arbitrary AUTHOR bytes without parsing or validating them. Static provider identity and file presence do not verify the author, model, reasoning, round, request, protocol, prompt or response claims.',
    consequence: 'A passing campaign does not alone prove exact actual-model authorship. No wrong-author event is asserted to have occurred.',
    closure: 'Independently verify a trusted COS execution/spawn record plus exact AUTHOR/PROMPT/RESPONSE/CALL/RECEIVED/job binding; retain an additive receipt. Do not edit the frozen source to erase this finding.' },
  { id: 'B2', severity: 'source-gap', category: 'prepared-context-freeze',
    status: 'generic-enforcement-gap; first-prompt-equality-independently-checked',
    source: 'outcome-campaign.mjs:26-46,107-117,125-131; src/generator.mjs:37-55; src/foundry.mjs:120-135',
    finding: 'The generator regenerates its context without comparison with saved REPAIR_CONTEXT. Two selected skills are outside all declared freeze lists; prepared sidecars are not hashed by PROTOCOL.',
    missingSkills: skillCoverage.filter(s => !s.coveredByFreeze).map(s => s.name),
    runSpecificCheck: 'released-native-first-prompt-exactly-matches-prepared-context',
    consequence: 'checkProtocol alone cannot establish the exact prepared prompt. Current selected-skill bytes are separately checked here; no drift is asserted.',
    closure: 'Bind an additive pre-dispatch packet/skill/context receipt to the protocol, then compare actual generation context and exact prompt bytes before treating the run as the frozen prepared experiment.' },
  { id: 'L1', severity: 'claim-limit', category: 'repair-attribution',
    finding: 'The researcher injected a one-field defect into the same builder\'s earlier solution and supplied explicit expected development output. Restoration may use retained construction context. This cannot establish novel diagnosis from outcome evidence alone, autonomous fault discovery, learning, or unseen-task generalization.' },
  { id: 'L2', severity: 'claim-limit', category: 'withheld-regression',
    finding: 'The source freezes the repaired candidate before the eight fixed provider-withheld cases, aborts on failure, and keeps sealed evaluation out of generator feedback. These are previously existing finite regression cases, with procedural withholding, not a fresh distribution or an OS sandbox.' },
  { id: 'L3', severity: 'claim-limit', category: 'publication',
    finding: 'V2 gates complete positive reproduction before confirmed-row publication. All-status completion is a non-gating diagnostic; temporal order does not establish causal use. The saved wrong run independently satisfies the stronger ordering as an observed fact.' },
  { id: 'N1', severity: 'note', category: 'snapshot-semantics',
    finding: 'INITIAL_REQUEST and FAULT_PROPOSAL are pending/proposed return-value snapshots. Applied request/proposal hashes in WRONG_OBSERVATION must be checked against the live original database records, as this audit does.' }
];

check('prepared-and-frozen-inputs-still-byte-identical-after-checks', () => {
  for (const entry of hashes.values()) assert.equal(sha(readFileSync(entry.path)), entry.sha256, entry.path);
  return { files: hashes.size };
});
const failedChecks = checks.filter(c => !c.passed);
const audit = {
  schemaVersion: 'outcome-model-independent-initial-review/1', reviewer: 'worker-6',
  startedAt, finishedAt: new Date().toISOString(),
  phase: 'initial-prepared-evidence-and-released-first-prompt',
  verdict: failedChecks.length ? 'EVIDENCE_CHECK_FAILED' : 'PREPARED_WITNESS_AND_FIRST_PROMPT_VALID_MODEL_ATTRIBUTION_PENDING',
  evidenceChecksPassed: failedChecks.length === 0, checkCount: checks.length,
  passedChecks: checks.length - failedChecks.length, failedChecks: failedChecks.length,
  actualModelRepairAudited: false, finalizedResultsReleaseReceived: false,
  operations: { newWorkflowRuns: 0, generationCalls: 0, modelCalls: 0, trainingUpdates: 0,
    databaseMode: 'readOnly; SELECT of original preparation records only',
    sealedSuites: 'raw freeze hashes only; hidden cases not parsed or emitted',
    existingFileEdits: 0, responseOrResultsReads: 0 },
  tooling: { serena: 'initial_instructions failed: HTTP 404 tunnel_client_not_seen; no Serena verification claimed',
    core: 'reads and commands succeeded; chat identity recovered and messages to prime queued' },
  protocol: { sha256: protocol.configurationSha256, frozenAt: protocol.frozenAt,
    sourceHash: config.sourceHashes.find(f => f.path.endsWith('/outcome-campaign.mjs')).sha256 },
  witness: { originalWorkflowHash: ready.originalWorkflowHash, faultyWorkflowHash: ready.workflowHash,
    runId: run.id, status: run.status, outcome: observation.outcome, contractId: contract.id,
    observationId: observation.id, artifactSha256: execution.artifact.sha256, contextHash: context.contextHash },
  checks, findings, selectedSkillFreezeCoverage: skillCoverage,
  inputHashes: [...hashes.values()], checkerSha256: sha(readFileSync(fileURLToPath(import.meta.url)))
};
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--write')) throw new Error('Use check.mjs [--write]');
if (args[0] === '--write') writeFileSync(path.join(own, 'AUDIT.json'), JSON.stringify(audit, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ verdict: audit.verdict, checks: audit.checkCount, passed: audit.passedChecks,
  failures: failedChecks, bindingFindings: findings.filter(f => f.severity === 'claim-blocking'),
  auditWritten: args[0] === '--write', actualModelRepairAudited: false }, null, 2));
if (failedChecks.length) process.exitCode = 1;
