import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertDemoContract } from '../research/product-demo/contract.mjs';
import { revisionSuite, verifyClosure, sha256 } from '../research/product-demo/freeze.mjs';
import { malformedExtraBrace, neutralNested, promptFeedback, eq } from '../research/product-demo/offline-fixtures.mjs';
import { Foundry, parseCandidate } from '../src/foundry.mjs';
import { WorkflowGenerator } from '../src/generator.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';

const evidence = () => ({ mode: 'actual-browser/noninteractive-free-model/diagnostic', sourceIntegrity: { verified: true }, model: 'observed/free', registryHash: 'registry',
  stages: ['initial', 'revision'].map((kind, index) => ({ kind, calls: 1, status: 'proposed', modelProvenanceVerified: true, model: 'observed/free', reportedCost: 0, workflowHash: `v${index + 1}`, suiteHash: `suite${index + 1}`, requestSource: 'user-ui', appliedThroughUI: true,
    evaluation: { passed: true, metrics: { passedCount: 7, caseCount: 7 }, workflowHash: `v${index + 1}`, suiteHash: `suite${index + 1}`, registryHash: 'registry' }, uiRun: { status: 'succeeded', workflowHash: `v${index + 1}`, artifactMatches: true } })),
  history: { oldRunUnchanged: true, oldVersionAddressable: true, oldVersion: 1, newVersion: 2 } });

test('product demo contract rejects incomplete, static-only, over-budget and mismatched evidence', () => {
  assert.equal(assertDemoContract(evidence()), true);
  for (const mutate of [r => { r.stages.pop(); }, r => { r.sourceIntegrity.verified = false; }, r => { r.stages[0].evaluation = null; }, r => { r.stages[1].evaluation.workflowHash = 'other'; }, r => { r.stages[0].evaluation.metrics.passedCount = 4; }, r => { r.stages[0].reportedCost = 1; }, r => { r.stages[0].calls = 4; }, r => { r.stages[1].uiRun.artifactMatches = false; }, r => { r.history.oldRunUnchanged = false; }, r => { r.stages[1].appliedThroughUI = false; }, r => { r.stages[0].modelProvenanceVerified = false; }]) {
    const report = evidence(); mutate(report); assert.throws(() => assertDemoContract(report));
  }
});

test('revision oracle retains old rejection cases and ordered totals without changing the original', () => {
  const original = { id: 'initial', task: 'Summarize', cases: [
    { id: 'valid', input: { batches: [[-2, 1], [], [7]] }, expect: { artifacts: [{ name: 'summary.json', json: { batchCount: 3, grandTotal: 6 } }] } },
    { id: 'reject', input: {}, expect: { artifacts: [{ name: 'summary.json', absent: true }] } }
  ] };
  const before = structuredClone(original), revised = revisionSuite(original);
  assert.deepEqual(original, before);
  assert.deepEqual(revised.cases[0].expect.artifacts[0].json, { batchCount: 3, grandTotal: 6, batchTotals: [-1, 0, 7] });
  assert.deepEqual(revised.cases[1], original.cases[1]);
});

test('source closure detects executable changes but allows unrelated evidence files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-demo-closure-'));
  try {
    writeFileSync(path.join(root, 'runtime.mjs'), 'abc');
    const manifest = { files: [{ path: 'runtime.mjs', kind: 'file', bytes: 3, sha256: sha256('abc') }], executables: [] };
    writeFileSync(path.join(root, 'unrelated-receipt.json'), '{}');
    assert.equal(verifyClosure(root, manifest).verified, true);
    writeFileSync(path.join(root, 'runtime.mjs'), 'def');
    assert.deepEqual(verifyClosure(root, manifest).changed, ['runtime.mjs']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('strict syntax feedback retains a bounded location in the exact JSON body without repairing it', () => {
  const unicode = malformedExtraBrace.replace('"id":"step"', '"id":"step","note":"🧭"');
  for (const body of [malformedExtraBrace, unicode, unicode.replace('{"workflow":', '{\n"workflow":'), '{"workflow":']) {
    let native;
    try { JSON.parse(body); } catch (error) { native = error; }
    assert.ok(native, 'Fixture must be malformed JSON');
    const location = /position\s+(\d+)/i.exec(native.message);
    const expectedOffset = location ? Number(location[1]) : /unexpected end/i.test(native.message) ? body.length : null;
    for (const text of [body, `\n\x60\x60\x60json\n${body}\n\x60\x60\x60\n`]) {
      const before = sha256(text);
      assert.throws(() => parseCandidate(text), error => {
        assert.equal(error.code, 'CANDIDATE_FORMAT');
        assert.equal(error.details.offset, expectedOffset);
        assert.match(error.details.locationBasis, /UTF-16/);
        assert.ok(error.details.parserMessage.length <= 500);
        if (expectedOffset !== null) {
          assert.equal(error.details.line, body.slice(0, expectedOffset).split('\n').length);
          assert.equal(error.details.column, expectedOffset - body.slice(0, expectedOffset).lastIndexOf('\n'));
          assert.ok(error.details.excerpt.length <= 200);
          assert.equal(error.details.excerpt, body.slice(error.details.excerptStart, error.details.excerptStart + error.details.excerpt.length));
          assert.equal(error.details.excerptOffset + error.details.excerptStart, expectedOffset);
        }
        return true;
      });
      assert.equal(sha256(text), before);
    }
  }
  const valid = '{"workflow":{},"rationale":"Neutral parse-only control."}';
  assert.deepEqual(parseCandidate(valid), JSON.parse(valid));
  for (const invalid of [valid + valid, 'prose ' + valid, valid.replace('{}', '{"x":1,}'), valid.replace('{}', '{/* comment */}')]) {
    assert.throws(() => parseCandidate(invalid), { code: 'CANDIDATE_FORMAT' });
  }
});

test('each nested map or loop requires nonempty runtime acceptance even when the root and until have checks', () => {
  const registry = createDefaultRegistry();
  for (const kind of ['map', 'loop']) {
    assert.equal(validateWorkflow(neutralNested(kind), { registry }).valid, true);
    const empty = neutralNested(kind, []), original = JSON.stringify(empty);
    const result = validateWorkflow(empty, { registry });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.code === 'SCHEMA' && error.path === '/nodes/0/body/acceptance'));
    assert.equal(JSON.stringify(empty), original);
    assert.ok(validateWorkflow(neutralNested(kind, [eq(true, true)]), { registry }).errors.some(error => error.code === 'VACUOUS_ACCEPTANCE'));
  }
});

test('real generator carries parser locations into the next offline callback and never evaluates rejected candidates', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'foundry-offline-feedback-'));
  const foundry = new Foundry(directory), prompts = [];
  const texts = [malformedExtraBrace, malformedExtraBrace, JSON.stringify({ workflow: neutralNested('map', []), rationale: 'Neutral empty-body control.' })];
  let evaluations = 0;
  try {
    const provider = { identity: { provider: 'offline-inert-fixture', externalCalls: 0 }, async generate({ prompt }) {
      const index = prompts.length; prompts.push(prompt);
      assert.ok(index < texts.length); return { text: texts[index], evidence: { synthetic: true, externalCalls: 0 } };
    } };
    const generator = new WorkflowGenerator(foundry, provider, { maxRounds: 3, maxDurationMs: 10000,
      evaluator: { id: 'unreachable-inert-evaluator', evaluate() { evaluations++; throw new Error('Validation must block this evaluator'); } } });
    const request = foundry.store.createRequest({ text: 'Neutral offline construction regression. No provider service is called.' });
    const job = await generator.generate(request.id);
    assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'GENERATION_EXHAUSTED');
    assert.deepEqual(job.attempts.map(attempt => attempt.status), ['failed-attempt', 'failed-attempt', 'rejected-candidate']);
    assert.equal(evaluations, 0);
    for (const index of [1, 2]) {
      const feedback = promptFeedback(prompts[index]);
      assert.equal(feedback.previousOutput, texts[index - 1]);
      assert.deepEqual(feedback.details, job.attempts[index - 1].details);
      assert.equal(typeof feedback.details.offset, 'number');
    }
    assert.equal(job.attempts[2].assessment.evaluation, null);
    assert.equal(job.attempts[2].assessment.deploymentQualified, false);
    assert.equal(foundry.store.proposals().length + foundry.store.workflows().length + foundry.store.runs().length + foundry.store.qualifications().length, 0);
    for (const [index, text] of texts.entries()) {
      const saved = JSON.parse(readFileSync(path.join(foundry.store.directory, 'generation', job.id, String(index + 1).padStart(2, '0'), 'response.json'), 'utf8'));
      assert.equal(saved.text, text, 'The host must preserve exact output even for rejected attempts');
    }
  } finally { await foundry.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('nonempty neutral map exposes a flattened extraction error while an empty map cannot expose that path error', async () => {
  for (const [field, entries, expected] of [['emit.payload', ['violet', false], 'succeeded'], ['payload', ['violet', false], 'failed'], ['payload', [], 'succeeded']]) {
    const directory = mkdtempSync(path.join(tmpdir(), 'foundry-neutral-path-')), foundry = new Foundry(directory);
    try {
      const workflow = neutralNested('map', undefined, field);
      assert.equal(foundry.validate(workflow).valid, true, 'Current validation checks dependency roots, not complete output path types');
      const saved = foundry.save(workflow), run = foundry.createRun(saved.hash, { entries });
      const result = await foundry.startRun(run.id);
      assert.equal(result.status, expected);
      if (expected === 'failed') assert.equal(result.error.code, 'MISSING_REFERENCE');
      else assert.deepEqual(result.outputs.project, { items: entries, count: entries.length });
    } finally { await foundry.close(); rmSync(directory, { recursive: true, force: true }); }
  }
});
