import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFreeModel, parseModelCatalog, runDirectory, shellQuote } from '../evals/opencode-harness.mjs';
import { hashBytes, inspectPair, inspectSmoke } from '../evals/evidence.mjs';

// These are explicitly synthetic evaluator-unit-test fixtures, NOT model runs.
function evidenceFixture() {
  const prompt = 'Unit fixture: write synthetic JSON.';
  const output = '{"probe":"workflow-foundry-tui","ok":true,"sequence":[1,2,3]}';
  return {
    prompt, output, transcript: 'Synthetic terminal stream only for an evaluator unit test.',
    manifest: { mode: 'actual-tui', model: 'opencode/unit-fixture', promptSHA256: hashBytes(prompt) },
    session: {
      info: { id: 'unit-session', model: { providerID: 'opencode', id: 'unit-fixture' }, cost: 0, version: 'unit-version' },
      messages: [
        { info: { role: 'user' }, parts: [{ type: 'text', text: prompt }] },
        { info: { role: 'assistant', providerID: 'opencode', modelID: 'unit-fixture', cost: 0, finish: 'stop' }, parts: [
          { type: 'tool', tool: 'write', state: { status: 'completed', input: { filePath: '/task/output.json', content: output } } },
          { type: 'text', text: 'DONE' },
        ] },
      ],
    },
  };
}

test('smoke oracle rejects DONE when the file tool was denied', () => {
  const fixture = evidenceFixture();
  fixture.session.messages[1].parts[0].state.status = 'error';
  assert.equal(inspectSmoke(fixture).passed, false);
});

test('smoke oracle rejects a missing file and operator-substituted output', () => {
  const fixture = evidenceFixture();
  delete fixture.output;
  assert.equal(inspectSmoke(fixture).passed, false);
  fixture.output = '{"probe":"workflow-foundry-tui","ok":true,"sequence":[1,2,3]}\n';
  assert.equal(inspectSmoke(fixture).passed, false, 'Even equivalent JSON must retain exact generation bytes.');
});

test('smoke oracle requires exact expected semantics, not self-attested success', () => {
  const fixture = evidenceFixture();
  assert.equal(inspectSmoke(fixture).passed, true);
  fixture.output = '{"probe":"workflow-foundry-tui","ok":true,"sequence":[1,2,4]}';
  fixture.session.messages[1].parts[0].state.input.content = fixture.output;
  const result = inspectSmoke(fixture);
  assert.equal(result.valid, true);
  assert.equal(result.passed, false);
});

test('provenance fails on a changed prompt, model or frozen hash', () => {
  for (const mutate of [
    fixture => { fixture.prompt += ' Extra task guidance'; },
    fixture => { fixture.session.messages[1].info.modelID = 'another-model'; },
    fixture => { fixture.manifest.outputSHA256 = '0'.repeat(64); },
    fixture => { fixture.session.info.cost = 0.001; },
    fixture => { fixture.session.messages.push({ info: { role: 'user' }, parts: [{ type: 'text', text: 'Operator correction' }] }); },
  ]) {
    const fixture = evidenceFixture(); mutate(fixture);
    assert.equal(inspectSmoke(fixture).passed, false);
  }
});

test('successful edits are reconstructed and mismatched edits fail closed', () => {
  const fixture = evidenceFixture();
  const parts = fixture.session.messages[1].parts;
  parts[0].state.input.content = fixture.output.replace('[1,2,3]', '[1,2,4]');
  parts.push({ type: 'tool', tool: 'edit', state: { status: 'completed', input: { filePath: '/task/output.json', oldString: '[1,2,4]', newString: '[1,2,3]' } } });
  assert.equal(inspectSmoke(fixture).passed, true);
  parts.at(-1).state.input.oldString = 'absent';
  assert.equal(inspectSmoke(fixture).passed, false);
});

test('model guard rejects absent IDs, nonzero nested prices and unknown pricing', () => {
  const catalog = parseModelCatalog('opencode/test\n{"cost":{"input":0,"output":0,"cache":{"read":0,"write":0}}}\n');
  assert.equal(assertFreeModel(catalog, 'opencode/test').id, 'opencode/test');
  assert.throws(() => assertFreeModel(catalog, 'opencode/guessed'));
  for (const value of [0.2, 'free', null]) {
    catalog[0].metadata.cost.cache.read = value;
    assert.throws(() => assertFreeModel(catalog, 'opencode/test'));
  }
});

test('run IDs reject path traversal and shell arguments preserve metacharacters', () => {
  for (const id of ['../private', 'bad/name', 'x;id', '', 'x'.repeat(33)]) assert.throws(() => runDirectory(id));
  assert.equal(shellQuote("a'$(private)`thing`"), "'a'\\''$(private)`thing`'");
  assert.throws(() => shellQuote('nul\0byte'));
});

test('pair gate rejects unequal controls, skill contamination and unsealed heldout claims', () => {
  const common = Object.fromEntries(['taskSHA256', 'schemaSHA256', 'model', 'appVersion', 'executorSHA256', 'toolsSHA256', 'budgetSHA256', 'configSHA256'].map(key => [key, `unit-${key}`]));
  const baseline = { ...common, arm: 'baseline', split: 'diagnostic', sessionID: 'unit-a' };
  const treatment = { ...common, arm: 'foundry', split: 'diagnostic', sessionID: 'unit-b', skillSHA256: 'unit-skills' };
  assert.equal(inspectPair(baseline, treatment).comparable, true);
  assert.equal(inspectPair(baseline, { ...treatment, executorSHA256: 'different' }).comparable, false);
  assert.equal(inspectPair({ ...baseline, skillSHA256: 'leaked' }, treatment).comparable, false);
  assert.equal(inspectPair({ ...baseline, split: 'heldout' }, { ...treatment, split: 'heldout' }).comparable, false);
});
