#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { sha256, readJSON, writeJSON, verifyClosure } from './freeze.mjs';
import { promptFeedback } from './offline-fixtures.mjs';

// Offline replay only. No provider transport, browser, network client or external
// model is invoked. Historical texts enter the real generator through a named
// replay fixture, with a fresh store and no authority to alter the originals.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const jsonWrite = (directory, name, value) => writeJSON(path.join(directory, name), value);

function describe(base, relative) {
  const file = path.join(base, relative), stat = lstatSync(file);
  if (stat.isDirectory()) return readdirSync(file).sort().flatMap(name => describe(base, path.join(relative, name)));
  if (stat.isSymbolicLink()) {
    assert.ok(realpathSync(file).startsWith(base + path.sep), 'Snapshot symlink must remain within its source');
    return [{ path: relative, kind: 'symlink', link: readlinkSync(file) }];
  }
  assert.ok(stat.isFile());
  return [{ path: relative, kind: 'file', bytes: stat.size, sha256: sha256(readFileSync(file)) }];
}

function freeze(history) {
  history = realpathSync(history);
  assert.ok(history.startsWith(path.join(root, 'research/product-demo/runs') + path.sep));
  const directory = mkdtempSync(path.join(root, 'research/product-demo/runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-offline-`));
  const snapshot = path.join(directory, 'snapshot'); mkdirSync(snapshot, { mode: 0o700 });
  const selection = ['package.json', 'package-lock.json', 'src', 'schemas', 'skills', 'node_modules', 'web/app.js', 'web/index.html', 'web/style.css',
    'tests/ui-live-contract.test.mjs', 'tests/ui-contract.test.mjs', 'research/product-demo/contract.mjs',
    'research/product-demo/freeze.mjs', 'research/product-demo/offline-fixtures.mjs', 'research/product-demo/offline.mjs'];
  const files = selection.flatMap(relative => describe(root, relative)).sort((a, b) => a.path.localeCompare(b.path));
  const executables = [{ path: realpathSync(process.execPath), sha256: sha256(readFileSync(process.execPath)) }];
  const manifest = { kind: 'offline host-construction replay, zero new model calls', createdAt: new Date().toISOString(),
    originalRoot: root, history, snapshot, selection, files, executables, node: process.version,
    closureSHA256: sha256(JSON.stringify({ files, executables })) };
  for (const relative of selection) {
    const target = path.join(snapshot, relative); mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(root, relative), target, { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true });
  }
  manifest.originalAtCopy = verifyClosure(root, manifest, { external: true });
  manifest.snapshotAtCopy = verifyClosure(snapshot, manifest, { external: true });
  jsonWrite(directory, 'closure.json', manifest);
  assert.equal(manifest.originalAtCopy.verified && manifest.snapshotAtCopy.verified, true, 'Copy changed; preserve the failed freeze');
  return directory;
}

async function modules(base) {
  const load = name => import(pathToFileURL(path.join(base, 'src', `${name}.mjs`)).href);
  const [foundry, generator, evaluation, validation, capabilities, data] = await Promise.all(
    ['foundry', 'generator', 'evaluation', 'validate', 'capabilities', 'data'].map(load));
  return { ...foundry, ...generator, ...evaluation, ...validation, ...capabilities, ...data };
}

function syntax(text) {
  try { JSON.parse(text); return null; }
  catch (error) {
    const position = /position\s+(\d+)/i.exec(error.message), offset = position ? Number(position[1]) : null;
    const marker = text.indexOf('"timeoutMs"');
    // This scans punctuation only; it never recovers, repairs or executes JSON.
    const stack = []; let quoted = false, escaped = false;
    for (const character of text.slice(0, marker)) {
      if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; }
      else if (character === '"') quoted = true;
      else if ('[{'.includes(character)) stack.push(character);
      else if (']}'.includes(character)) stack.pop();
    }
    return { parserMessage: error.message, offset, detectedCharacter: offset === null ? null : text[offset],
      beforeFirstTimeout: text.slice(Math.max(0, marker - 100), marker + 40), openContainersAtTimeout: stack.join(''),
      prematureNodeClosure: stack.at(-1) === '[', excerpt: offset === null ? null : text.slice(Math.max(0, offset - 100), offset + 100) };
  }
}

async function replay(api, directory, responses, suite, task, label) {
  const workspace = path.join(directory, label), foundry = new api.Foundry(workspace);
  const prompts = [], suiteHost = api.suiteEvaluator(suite); let evaluationCalls = 0;
  try {
    const provider = { identity: { provider: 'offline-recorded-text-replay', externalCalls: 0, label }, async generate({ prompt }) {
      const index = prompts.length; prompts.push(prompt);
      assert.ok(index < responses.length, 'Replay exceeded its frozen text sequence');
      return { text: responses[index].text, evidence: { replay: true, externalCalls: 0, originalTextSHA256: sha256(responses[index].text) } };
    } };
    const generator = new api.WorkflowGenerator(foundry, provider, { maxRounds: 3, maxDurationMs: 300000, autoApply: false,
      evaluator: { id: suiteHost.id, async evaluate(args) { evaluationCalls++; return suiteHost.evaluate(args); } } });
    const request = foundry.store.createRequest({ text: task, source: 'offline-immutable-candidate-replay' });
    const job = await generator.generate(request.id);
    assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'GENERATION_EXHAUSTED');
    assert.deepEqual(job.attempts.map(attempt => attempt.status), ['failed-attempt', 'failed-attempt', 'rejected-candidate']);
    assert.equal(evaluationCalls, 0);
    const feedback = prompts.map((prompt, index) => {
      const item = promptFeedback(prompt);
      if (index) assert.equal(item.previousOutput, responses[index - 1].text);
      return { round: index + 1, previousTextMatches: index ? true : null, error: item?.error ?? null, details: item?.details ?? null };
    });
    const counts = { workflows: foundry.store.workflows().length, proposals: foundry.store.proposals().length,
      qualifications: foundry.store.qualifications().length, runs: foundry.store.runs().length };
    assert.ok(Object.values(counts).every(value => value === 0));
    for (const [index, response] of responses.entries()) {
      const saved = readJSON(path.join(foundry.store.directory, 'generation', job.id, String(index + 1).padStart(2, '0'), 'response.json'));
      assert.equal(saved.text, response.text);
    }
    // Calling the actual suite entrypoint with the unchanged third candidate
    // must reject before creating any per-case runtime store.
    let executionGate;
    try {
      await api.evaluateWorkflow(api.parseCandidate(responses[2].text).workflow, suite, { directory: path.join(directory, `${label}-blocked-evaluation`) });
      assert.fail('Invalid workflow unexpectedly reached evaluation');
    } catch (error) {
      assert.equal(error.code, 'INVALID_WORKFLOW');
      executionGate = { code: error.code, details: error.details, perCaseStoresCreated: existsSync(path.join(directory, `${label}-blocked-evaluation`)) };
      assert.equal(executionGate.perCaseStoresCreated, false);
    }
    const result = { label, replay: true, externalModelCalls: 0, replayCallbacks: prompts.length, evaluationCalls, job, feedback, counts, executionGate };
    jsonWrite(directory, `${label}.json`, result); return result;
  } finally { await foundry.close(); }
}

async function capabilityProbes(api, candidate, suite) {
  const registry = api.createDefaultRegistry(), schema = candidate.workflow.inputSchema;
  const numeric = { operation: 'sum', values: [1e308, 1e308] };
  const boundaryCases = [
    ...suite.cases.map(item => ({ id: `suite-input-schema-only:${item.id}`, input: item.input, expected: item.expect.statuses.includes('succeeded') })),
    { id: 'exact-20-by-100-bound', input: { batches: Array.from({ length: 20 }, () => Array(100).fill(1)) }, expected: true },
    { id: 'outer-21', input: { batches: Array.from({ length: 21 }, () => []) }, expected: false },
    { id: 'inner-101', input: { batches: [Array(101).fill(1)] }, expected: false },
    { id: 'boolean-number', input: { batches: [[true]] }, expected: false },
    { id: 'null-number', input: { batches: [[null]] }, expected: false },
    { id: 'scalar-inner', input: { batches: [1] }, expected: false },
    { id: 'array-root', input: [], expected: false },
    { id: 'finite-values-with-overflowing-sum', input: { batches: [numeric.values] }, expected: true }
  ];
  const inputChecks = [];
  for (const item of boundaryCases) {
    const result = await registry.execute('core.validate', { value: item.input, schema }, {});
    assert.equal(result.valid, item.expected);
    inputChecks.push({ id: item.id, inputHash: api.digest(item.input), expected: item.expected, actual: result.valid, passed: true, workflowExecuted: false });
  }
  let overflow;
  try { await registry.execute('core.aggregate', numeric, {}); assert.fail('Expected finite-number overflow'); }
  catch (error) { assert.equal(error.code, 'AGGREGATE_OVERFLOW'); overflow = { input: numeric, code: error.code, message: error.message }; }
  const flat = await registry.execute('core.aggregate', { operation: 'sum', values: [1e16, -1e16, 1] }, {});
  const right = await registry.execute('core.aggregate', { operation: 'sum', values: [-1e16, 1] }, {});
  const grouped = await registry.execute('core.aggregate', { operation: 'sum', values: [1e16, right.value] }, {});
  assert.notEqual(flat.value, grouped.value);
  const descriptors = registry.list().filter(item => ['core.validate', 'core.aggregate', 'core.pluck', 'core.json', 'core.artifact'].includes(item.name));
  assert.ok(descriptors.find(item => item.name === 'core.pluck').outputSchema.required.includes('count'));
  return { mode: 'isolated capability and input-schema checks; no candidate workflow execution', registryHash: registry.hash(), inputChecks, descriptors,
    overflow, precision: { inputs: [1e16, -1e16, 1], flat: flat.value, grouped: grouped.value, meaning: 'Binary64 grouping changes the result; the diagnostic task needs an explicit precision/overflow envelope.' } };
}

async function oracleProbe(api, directory, suite) {
  const workflow = { schemaVersion: '1.0', id: 'SyntheticUniformFailure', version: 1, title: 'Synthetic uniform failure oracle probe', domain: 'diagnostic',
    goal: 'Fail every input without creating an artifact; never a proposed task solution.',
    envelope: { assumptions: ['Synthetic oracle probe'], risks: [], successCriteria: ['Uniform failure is observed'] },
    budget: { maxSteps: 5, maxConcurrency: 1, maxDurationMs: 5000, maxCost: 0 },
    nodes: [{ id: 'stop', kind: 'task', description: 'Fail without inspecting the input', needs: [], tool: 'core.fail', args: {}, timeoutMs: 1000, retry: { maxAttempts: 1 } }],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.stop' } }] };
  jsonWrite(directory, 'synthetic-oracle-probe-input.json', { synthetic: true, workflow, suiteHash: api.digest(suite) });
  const evaluation = await api.evaluateWorkflow(workflow, suite, { directory: path.join(directory, 'synthetic-oracle-probe'), maxDurationMs: 10000 });
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.metrics.passedCount, 3);
  assert.ok(evaluation.cases.every(item => item.status === 'failed' && item.runError.code === 'INJECTED_FAILURE'));
  return { synthetic: true, candidateEdited: false, originalCandidateExecuted: false, externalModelCalls: 0,
    purpose: 'The three negative-case expectations accept an arbitrary failed run with absent artifact; the four positive cases still block promotion.', evaluation };
}

async function execute(directory) {
  const manifest = readJSON(path.join(directory, 'closure.json')), history = manifest.history;
  const originalManifest = readJSON(path.join(history, 'closure.json'));
  const originalReport = readJSON(path.join(history, 'result.json'));
  const job = readJSON(path.join(history, 'initial-job.json'));
  const generation = path.join(history, 'workspace/.foundry/generation', job.id);
  const originalContext = readJSON(path.join(generation, 'context.json'));
  const responses = [1, 2, 3].map(round => readJSON(path.join(generation, String(round).padStart(2, '0'), 'response.json')));
  const protectedFiles = ['closure.json', 'result.json', 'initial-job.json', 'initial-suite.json', 'revision-suite.json', 'final-receipt.json', 'diagnostic-summary.json']
    .map(file => path.join(history, file));
  protectedFiles.push(path.join(generation, 'context.json'));
  for (const round of ['01', '02', '03']) for (const file of ['prompt.txt', 'response.json', 'generation.json', 'catalog.json', 'session-export.json', round === '03' ? 'assessment.json' : 'error.json']) protectedFiles.push(path.join(generation, round, file));
  const identities = protectedFiles.map(file => ({ path: file, sha256: sha256(readFileSync(file)) }));
  const report = { mode: 'offline-immutable-artifact-analysis', startedAt: new Date().toISOString(), newModelCalls: 0,
    historicalModelOutcome: { creationPassed: false, initialCalls: 3, revisionCalls: 0, error: job.error, jobId: job.id,
      registeredCases: 7, executedCases: 0, passedCases: 0, failedCases: 0, notRunCases: 7, successFraction: null },
    originalClosureSHA256: originalManifest.closureSHA256, updatedClosureSHA256: manifest.closureSHA256,
    originalOutcomePreserved: false, offlineChecksPassed: false };
  jsonWrite(directory, 'protected-artifacts-before.json', identities);
  try {
    assert.equal(originalReport.passed, false); assert.deepEqual(originalReport.calls, { initial: 3, revision: 0 });
    assert.equal(verifyClosure(manifest.snapshot, manifest, { external: true }).verified, true);
    assert.equal(verifyClosure(originalManifest.snapshot, originalManifest, { external: true }).verified, true);
    const original = await modules(originalManifest.snapshot), updated = await modules(manifest.snapshot);
    const suite = readJSON(path.join(history, 'initial-suite.json'));
    assert.equal(suite.cases.length, 7);
    const syntaxRows = responses.map((response, index) => {
      assert.equal(sha256(response.text), response.evidence.outputSHA256);
      const prompt = readFileSync(path.join(generation, String(index + 1).padStart(2, '0'), 'prompt.txt'), 'utf8');
      assert.equal(sha256(prompt), response.evidence.promptSHA256);
      const feedback = promptFeedback(prompt);
      if (index) { assert.equal(feedback.previousOutput, responses[index - 1].text); assert.equal(feedback.details, undefined); }
      return { round: index + 1, textSHA256: sha256(response.text), nativeSyntax: syntax(response.text),
        emptyAcceptanceLiteralOffset: response.text.indexOf('"acceptance": []'),
        historicalFeedback: feedback ? { previousOutputSHA256: sha256(feedback.previousOutput), error: feedback.error, details: feedback.details ?? null } : null };
    });
    jsonWrite(directory, 'exact-syntax-and-feedback.json', { originalSelectedSkills: originalContext.selectedSkills, originalDomain: originalContext.domain, rows: syntaxRows });
    const candidate = original.parseCandidate(responses[2].text);
    const initialWorkflowHash = original.digest(candidate.workflow);
    assert.equal(initialWorkflowHash, job.attempts[2].workflowHash);
    jsonWrite(directory, 'exact-third-structure.json', { workflowHash: initialWorkflowHash, rootNodes: candidate.workflow.nodes.length,
      nodes: candidate.workflow.nodes.map(node => ({ id: node.id, kind: node.kind, needs: node.needs, tool: node.tool ?? null,
        args: node.args ?? null, checks: node.checks ?? null, body: node.body ?? null })), rootAcceptance: candidate.workflow.acceptance,
      inputSchema: candidate.workflow.inputSchema, budget: candidate.workflow.budget });
    report.originalReplay = await replay(original, directory, responses, suite, originalContext.task, 'original-frozen-host');
    report.updatedReplay = await replay(updated, directory, responses, suite, originalContext.task, 'updated-frozen-host');
    for (const index of [1, 2]) {
      assert.equal(report.originalReplay.feedback[index].details, null);
      assert.equal(report.updatedReplay.feedback[index].details.offset, syntaxRows[index - 1].nativeSyntax.offset);
    }
    const perCase = suite.cases.map(item => ({ id: item.id, expected: item.expect, originalTrial: 'not-run', originalFrozenReplay: 'not-run', updatedFrozenReplay: 'not-run',
      initialBlockers: ['round-1:CANDIDATE_FORMAT', 'round-2:CANDIDATE_FORMAT', 'round-3:SCHEMA:/nodes/2/body/acceptance'],
      revision: 'not-attempted', passed: null, runId: null, chargedRuntimeSteps: 0 }));
    jsonWrite(directory, 'individual-case-metrics.json', { metrics: report.historicalModelOutcome, cases: perCase });
    jsonWrite(directory, 'capability-probes.json', await capabilityProbes(original, candidate, suite));
    jsonWrite(directory, 'synthetic-oracle-probe.json', await oracleProbe(original, directory, suite));
    assert.equal(original.digest(candidate.workflow), initialWorkflowHash);
    const test = spawnSync(process.execPath, ['--test', 'tests/ui-live-contract.test.mjs', 'tests/ui-contract.test.mjs'], {
      cwd: manifest.snapshot, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', FOUNDRY_UI_E2E: '0' } });
    writeFileSync(path.join(directory, 'neutral-tests.stdout'), test.stdout ?? '', { flag: 'wx', mode: 0o600 });
    writeFileSync(path.join(directory, 'neutral-tests.stderr'), test.stderr ?? '', { flag: 'wx', mode: 0o600 });
    report.tests = { argv: [process.execPath, '--test', 'tests/ui-live-contract.test.mjs', 'tests/ui-contract.test.mjs'], cwd: manifest.snapshot,
      status: test.status, signal: test.signal, error: test.error?.message ?? null };
    assert.equal(test.status, 0);
    report.changedSourcePathsSinceOriginal = manifest.files.filter(file => file.kind === 'file').flatMap(file => {
      const before = originalManifest.files.find(item => item.path === file.path);
      return before && before.sha256 !== file.sha256 ? [file.path] : [];
    });
    report.offlineChecksPassed = true;
  } catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
  finally {
    report.protectedArtifactsUnchanged = identities.every(item => sha256(readFileSync(item.path)) === item.sha256);
    report.originalSourceIntegrity = verifyClosure(originalManifest.snapshot, originalManifest, { external: true });
    report.updatedSourceIntegrity = verifyClosure(manifest.snapshot, manifest, { external: true });
    report.originalOutcomePreserved = report.protectedArtifactsUnchanged && readJSON(path.join(history, 'result.json')).passed === false;
    if (!report.originalOutcomePreserved || !report.originalSourceIntegrity.verified || !report.updatedSourceIntegrity.verified) {
      report.offlineChecksPassed = false; process.exitCode = 1;
    }
    report.finishedAt = new Date().toISOString();
    jsonWrite(directory, 'result.json', report);
    console.log(JSON.stringify({ directory, offlineChecksPassed: report.offlineChecksPassed, originalOutcomePreserved: report.originalOutcomePreserved,
      historicalModelOutcome: report.historicalModelOutcome, newModelCalls: 0, updatedClosureSHA256: manifest.closureSHA256, error: report.error ?? null }, null, 2));
  }
}

const { values } = parseArgs({ options: { history: { type: 'string' }, execute: { type: 'string' } }, strict: true });
if (values.execute) await execute(path.resolve(values.execute));
else {
  if (!values.history) throw new Error('Supply --history with the preserved product-demo directory');
  const directory = freeze(path.resolve(values.history));
  const child = spawnSync(process.execPath, [path.join(directory, 'snapshot/research/product-demo/offline.mjs'), '--execute', directory], {
    cwd: root, stdio: 'inherit', timeout: 60000, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}
