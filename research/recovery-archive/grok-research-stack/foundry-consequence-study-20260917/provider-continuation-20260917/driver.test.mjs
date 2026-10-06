import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { ROOT, sha, configuration, publicTask, compareProtocol, readArtifact, requireApplied, trackedProvider } from './driver.mjs';
import { Foundry } from '/home/raed/Projects/workflow-foundry/src/foundry.mjs';
import { WorkflowGenerator } from '/home/raed/Projects/workflow-foundry/src/generator.mjs';
import { digest } from '/home/raed/Projects/workflow-foundry/src/data.mjs';
import { engineHash } from '/home/raed/Projects/workflow-foundry/src/engine.mjs';
import { registryFactory, instrumentLog } from '../benchmark/capabilities.mjs';
import { auditInstruments } from '../benchmark/oracle-v2.mjs';

// Supplied, public synthetic fixtures only. No saved model candidate, suite load,
// full campaign, provider binary, network request or model inference is executed.
const fixtureRoot = mkdtempSync(path.join(ROOT, 'offline-fixtures-'));
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const prompt = 'Supplied fixture input';
const identity = { provider: 'SUPPLIED_TEST_CALLBACK', model: 'opencode/big-pickle' };
const response = (input = prompt) => ({ text: '{"fixture":true}', evidence: { model: identity.model, reportedCost: 0,
  tokens: { input: 7, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }, promptSHA256: sha(input), outputSHA256: sha('{"fixture":true}'), transport: { forwarded: 1, completed: 1 } } });

test('native public request/context and first generator prompt fit the provider without automatic queue admission or inference', async () => {
  const registry = registryFactory(), foundry = new Foundry(path.join(fixtureRoot, 'public-setup-workspace'), { registry, policy: configuration().policy });
  try {
    const task = publicTask(), request = foundry.store.createAgentDesignRequest({ task });
    assert.equal(request.source, 'agent-request'); assert.equal(request.status, 'diagnostic'); assert.equal(request.automaticGeneration, false);
    assert.ok(!foundry.store.pendingRequests().some(item => item.id === request.id));
    const context = foundry.designContext({ requestId: request.id, domain: 'general' });
    const publicContract = JSON.parse(readFileSync(new URL('../benchmark/PUBLIC.json', import.meta.url)));
    assert.equal(context.task, task); assert.equal(context.currentWorkflow, null); assert.equal(context.diagnosticRepair, null);
    assert.equal(context.registryHash, publicContract.registryHash); assert.deepEqual(context.capabilities, publicContract.capabilities);
    assert.deepEqual(context.workflowSchema, JSON.parse(readFileSync('/home/raed/Projects/workflow-foundry/schemas/workflow.schema.json')));
    assert.deepEqual(context.selectedSkills, ['workflow-foundry', 'runtime-native']);
    let captured = null, callbacks = 0;
    const provider = { identity: { provider: 'SUPPLIED_PREFLIGHT_CAPTURE_ONLY' }, async generate({ prompt: text }) {
      captured = text; callbacks++; throw Object.assign(new Error('Stopped before any provider dispatch'), { code: 'PREFLIGHT_CAPTURE_ONLY' });
    } };
    const job = await new WorkflowGenerator(foundry, provider, { maxRounds: 1, maxDurationMs: 10000, autoApply: false }).generate(request.id, { domain: 'general' });
    assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'PREFLIGHT_CAPTURE_ONLY'); assert.equal(callbacks, 1);
    assert.ok(captured.includes(JSON.stringify(context, null, 2))); assert.ok(!captured.includes('Previous candidate and independent host feedback'));
    const promptBytes = Buffer.byteLength(captured); assert.ok(promptBytes > 0 && promptBytes <= 400000);
    assert.equal(foundry.store.runs().length, 0); assert.equal(foundry.store.request(request.id).status, 'failed');
    assert.ok(!foundry.store.pendingRequests().some(item => item.id === request.id));
    save(path.join(fixtureRoot, 'NATIVE_SETUP.json'), { passed: true, requestStatusBeforeCapture: request.status, requestStatusAfterCapture: 'failed', automaticGeneration: false,
      taskSHA256: sha(task), registryHash: context.registryHash, selectedSkills: context.selectedSkills, promptBytes, promptSHA256: sha(captured),
      providerCallback: 'supplied capture-only failure', jobStatus: job.status, expectedStop: job.error.code,
      modelCalls: 0, suiteLoads: 0, runtimeExecutions: 0, priorCOSPromptByteEqualityClaimed: false });
  } finally { await foundry.close(); }
});

test('frozen settings match prime budget and every configuration/source field participates in comparison', () => {
  const config = configuration();
  assert.equal(config.maxRounds, 2); assert.equal(config.maxDurationMs, 360000); assert.equal(config.providerTimeoutMs, 150000);
  assert.equal(config.maxOutputTokens, 8192); assert.equal(config.autoApply, false); assert.equal(config.evaluation.revision, 'v2');
  const frozen = { schemaVersion: 'fixture', frozenAt: '2026-09-17T00:00:00Z', configuration: config, directory: '/fixture', sources: [{ file: '/fixture/source', sha256: 'a'.repeat(64) }] };
  const raw = JSON.stringify(frozen), hash = sha(raw);
  assert.deepEqual(compareProtocol(raw, hash, structuredClone(frozen)), frozen);
  const paths = [];
  const visit = (value, keys = []) => { if (value && typeof value === 'object') for (const key of Object.keys(value)) visit(value[key], [...keys, key]); else paths.push(keys); };
  visit(frozen);
  for (const keys of paths) {
    const changed = structuredClone(frozen); let target = changed;
    for (const key of keys.slice(0, -1)) target = target[key];
    const key = keys.at(-1); target[key] = typeof target[key] === 'number' ? target[key] + 1 : typeof target[key] === 'boolean' ? !target[key] : target[key] + '-changed';
    assert.throws(() => compareProtocol(raw, hash, changed), undefined, keys.join('.'));
  }
  assert.throws(() => compareProtocol(raw + '\n', hash, frozen));
  assert.throws(() => compareProtocol(raw, undefined, frozen));
  assert.throws(() => compareProtocol(raw, hash, { ...frozen, extra: true }));
  save(path.join(fixtureRoot, 'protocol-comparison.json'), { passed: true, leavesRejected: paths.length, byteDriftRejected: true, unknownFieldRejected: true });
});

test('provider records measured receipts for at most two calls and closes before withheld evaluation', async () => {
  let invocations = 0, preflights = 0;
  const tracked = trackedProvider({ identity, async generate({ prompt: input }) { invocations++; return response(input); } }, () => preflights++);
  await tracked.provider.generate({ prompt }); await tracked.provider.generate({ prompt });
  assert.throws(() => tracked.provider.generate({ prompt }));
  await tracked.close(); assert.throws(() => tracked.provider.generate({ prompt }));
  assert.equal(invocations, 2); assert.equal(preflights, 2); assert.equal(tracked.calls[0].evidence.tokens.input, 7);
  assert.equal(tracked.calls[1].evidence.reportedCost, 0);
});

for (const code of ['MODEL_RATE_LIMIT', 'MODEL_AUTH_REQUIRED', 'MODEL_UNAVAILABLE', 'TIMEOUT']) {
  test(`provider ${code} ends the trajectory without a retry`, async () => {
    let invocations = 0;
    const tracked = trackedProvider({ identity, async generate() { invocations++; throw Object.assign(new Error('supplied refusal'), { code }); } }, () => {});
    await assert.rejects(tracked.provider.generate({ prompt }), { code });
    assert.throws(() => tracked.provider.generate({ prompt })); await tracked.close();
    assert.equal(invocations, 1); assert.equal(tracked.calls[0].status, 'failed'); assert.equal(tracked.calls[0].error.code, code);
  });
}

test('provider prompt/output/cost binding and pre-dispatch freeze errors cannot be accepted', async () => {
  for (const change of [value => { value.evidence.reportedCost = 1; }, value => { value.evidence.promptSHA256 = 'bad'; },
    value => { value.evidence.outputSHA256 = 'bad'; }, value => { value.evidence.model = 'other'; }, value => { value.evidence.transport.completed = 0; }]) {
    const supplied = response(); change(supplied);
    const tracked = trackedProvider({ identity, async generate() { return supplied; } }, () => {});
    await assert.rejects(tracked.provider.generate({ prompt })); assert.throws(() => tracked.provider.generate({ prompt })); await tracked.close();
  }
  let calls = 0;
  const tracked = trackedProvider({ identity, async generate() { calls++; } }, () => { throw new Error('source changed'); });
  assert.throws(() => tracked.provider.generate({ prompt })); assert.equal(calls, 0); await tracked.close();
});

test('artifact reader hashes actual bytes, checks JSON and rejects links and excess data', () => {
  const store = path.join(fixtureRoot, 'reader'), folder = path.join(store, 'artifacts', 'run1'); mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'manifest.json'), '{"samples":[]}\n');
  const artifact = readArtifact(store, 'run1'); assert.deepEqual(artifact.manifest, { samples: [] }); assert.equal(artifact.bytes, 15);
  assert.equal(artifact.sha256, sha('{"samples":[]}\n')); assert.equal(artifact.argsHash, digest({ name: 'manifest.json', content: artifact.text }));
  for (const [name, content] of [['large', ' '.repeat(512 * 1024 + 1)], ['invalid', 'not-json']]) {
    mkdirSync(path.join(store, 'artifacts', name)); writeFileSync(path.join(store, 'artifacts', name, 'manifest.json'), content);
    assert.throws(() => readArtifact(store, name));
  }
  symlinkSync(folder, path.join(store, 'artifacts', 'linked')); assert.throws(() => readArtifact(store, 'linked'));
  assert.throws(() => readArtifact(store, '../run1'));
});

test('native supplied-callback generator, apply and real v2 artifact audit bind delivery; false-success mutations fail', async () => {
  const registry = registryFactory(), foundry = new Foundry(path.join(fixtureRoot, 'native-workspace'), { registry, policy: configuration().policy });
  const workflow = { schemaVersion: '1.0', id: 'provider-driver-fixture', version: 1, title: 'Supplied empty-batch transport fixture', domain: 'general',
    goal: 'Write an empty manifest for the explicitly supplied empty input.',
    envelope: { assumptions: ['Empty input only'], risks: ['A file alone can outlive failed acceptance'], successCriteria: ['Exact empty manifest'], unsupported: ['Nonempty batches'] },
    inputSchema: { type: 'object', required: ['samples'], properties: { samples: { type: 'array', maxItems: 0 } }, additionalProperties: false },
    budget: configuration().policy,
    nodes: [{ id: 'write', kind: 'task', needs: [], description: 'Write supplied fixture bytes.', tool: 'core.artifact', args: { name: 'manifest.json', content: '{"samples":[]}' }, timeoutMs: 1000, retry: { maxAttempts: 1 } }],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.write.sha256' } }] };
  try {
    const request = foundry.store.createAgentDesignRequest({ task: workflow.goal });
    const provider = { identity: { provider: 'SUPPLIED_TEST_CALLBACK' }, async generate() { return { text: JSON.stringify({ workflow, rationale: 'Supplied fixture, not model construction.' }), evidence: { supplied: true } }; } };
    const generator = new WorkflowGenerator(foundry, provider, { maxRounds: 1, maxDurationMs: 10000, autoApply: false });
    const job = await generator.generate(request.id, { domain: 'general' }); assert.equal(job.status, 'proposed');
    foundry.apply(job.proposalId);
    const sample = { input: { samples: [] }, fixture: { observations: {} }, expect: { artifacts: [{ name: 'manifest.json', json: { samples: [] } }] } };
    const created = foundry.runtime.create(workflow, sample.input, { fixture: sample.fixture });
    assert.equal((await foundry.startRun(created.id)).status, 'succeeded');
    const run = foundry.store.run(created.id), events = foundry.store.events(created.id), artifact = readArtifact(foundry.store.directory, run.id);
    const calls = instrumentLog(registry, run.id), audit = auditInstruments(sample, calls, events, { run, artifact });
    const evidence = { workflow, proposal: foundry.store.proposal(job.proposalId), requestId: request.id, registryHash: registry.hash(), engineHash,
      run, events, artifact, expected: { samples: [] }, expectedInput: sample.input, audit, delivery: foundry.delivery({ requestId: request.id, proposalId: job.proposalId, runId: run.id }) };
    assert.equal(requireApplied(evidence), true);
    const mutations = [value => { value.run.status = 'failed'; }, value => { value.delivery.localExecutionSucceeded = false; },
      value => { value.delivery.workflowId = 'other'; }, value => { value.delivery.runId = 'other'; }, value => { value.proposal.requestId = 'other'; },
      value => { value.run.workflowHash = '0'.repeat(64); }, value => { value.run.registryHash = '0'.repeat(64); },
      value => { value.expectedInput = { samples: [{ id: 'different' }] }; }, value => { value.run.eventHead.hash = '0'.repeat(64); },
      value => { value.artifact.sha256 = '0'.repeat(64); }, value => { value.artifact.bytes++; }, value => { value.artifact.manifest = { samples: ['changed'] }; },
      value => { value.audit.publicationContentBasis = 'expected-manifest-requires-separate-exact-JSON-check'; }, value => { value.audit.passed = false; }];
    for (const change of mutations) { const changed = structuredClone(evidence); change(changed); assert.throws(() => requireApplied(changed)); }
    const changedArtifact = { ...artifact, text: artifact.text + '\n', sha256: sha(artifact.text + '\n'), bytes: artifact.bytes + 1,
      argsHash: digest({ name: 'manifest.json', content: artifact.text + '\n' }) };
    assert.equal(auditInstruments(sample, calls, events, { run, artifact: changedArtifact }).passed, false);
    save(path.join(fixtureRoot, 'native-applied-audit.json'), { passed: true, suppliedModelCalls: 1, actualModelCalls: 0, suiteLoads: 0, rejectedMutations: mutations.length, audit, delivery: evidence.delivery });
  } finally { await foundry.close(); }
});
