// BUILDER-1 harness with scripted ModelPorts ($0, no network): conversations, B0's single repair, and the environment-fault rule.
// node --test --test-concurrency=1 experiments/surface/test/harness.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Journal } from '../../../src/journal.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelBuilder, SELECT_SYSTEM } from '../../../app/core/builder-model.mjs';
import { instantiate, templateById } from '../../../app/core/library.mjs';
import { B0Builder, b0Prompt } from '../b0.mjs';
import { runCase, CASES_FILE } from '../run-builder-eval.mjs';

const doc = JSON.parse(readFileSync(CASES_FILE, 'utf8'));
const byId = id => doc.cases.find(c => c.id === id);
const worlds = mkdtempSync(path.join(tmpdir(), 'builder1-harness-'));
test.after(() => rmSync(worlds, { recursive: true, force: true }));
const portOf = fn => new ModelPort({ policy: loadPolicy().policy, providers: { 'claude-cli': new ScriptedProvider(fn) }, journal: new Journal(new DatabaseSync(':memory:')) });

test('a two-question conversation (L3): both required questions asked once, answered from the key, verified in the hidden world', async () => {
  const port = portOf(args => {
    if (args.system === SELECT_SYSTEM) return { value: { template: 'lead-triage', reason: 'r', notCovered: [] } };
    const known = args.prompt.includes('lena@brook-tools.de'), me = args.prompt.includes('kai@brook-tools.de');
    const rule = (country, who) => ({ field: 'country', op: 'is', value: country, assignTo: known ? `${who}@brook-tools.de` : '' });
    return { value: { slots: { rules: [rule('Germany', 'lena'), rule('Austria', 'lena'), rule('France', 'paul')], defaultAssignee: me ? 'kai@brook-tools.de' : '' }, notStated: me ? [] : ['defaultAssignee'],
      questions: [{ slot: 'rules', question: 'What are the e-mail addresses for Lena and Paul?', why: 'x' }, { slot: 'defaultAssignee', question: 'What is your e-mail address?', why: 'x' }], assumptions: [] } };
  });
  const rec = await runCase(byId('L3'), { arm: 'B-H', builder: new ModelBuilder({ port }), worldsRoot: worlds });
  assert.equal(rec.judgement.verified, true, rec.judgement.reasons.join('; '));
  assert.deepEqual(rec.questions.map(q => q.matched), [['rules'], ['defaultAssignee']]);
  assert.deepEqual([rec.numbers.requiredAsked, rec.numbers.unnecessaryQuestions, rec.numbers.personActions], [2, 0, 2 + 1 + 5]);
});

test('B0: one call builds; an invalid workflow gets exactly one repair with the validator errors, then fails honestly', async () => {
  let n = 0;
  const port = portOf(args => { n++; return { value: { decision: 'build', reason: 'r', questions: [], workflow: n === 1 ? { id: 'broken' } : { id: 'still-broken', nodes: [] } } }; });
  const rec = await runCase(byId('W1'), { arm: 'B0-H', builder: new B0Builder({ port }), worldsRoot: worlds });
  assert.equal(rec.outcome, 'build_failed'); assert.equal(rec.cost.calls, 2); assert.equal(rec.judgement.verified, false);
  const ok = portOf(() => ({ value: { decision: 'build', reason: 'r', questions: [], workflow: instantiate(templateById('weekly-report'), byId('W1').reference) } }));
  assert.equal((await runCase(byId('W1'), { arm: 'B0-H', builder: new B0Builder({ port: ok }), worldsRoot: worlds })).judgement.verified, true);
  const prompt = b0Prompt({ request: 'x', answers: {} });
  assert.match(prompt, /sheet\.append/); assert.match(prompt, /"invoices"/); assert.doesNotMatch(prompt, /"template"\s*:/, 'no template reaches B0');
});

test('environment faults (rate limit, unavailable, timeout) are recorded and never scored', async () => {
  for (const code of ['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT']) {
    const port = portOf(args => args.system === SELECT_SYSTEM ? { value: { template: 'weekly-report', reason: 'r', notCovered: [] }, costUsd: 0.001 } : { error: code });
    const rec = await runCase(byId('W1'), { arm: 'B-H', builder: new ModelBuilder({ port }), worldsRoot: worlds });
    assert.equal(rec.environmentFault, code); assert.equal(rec.judgement.kind, 'environment-fault'); assert.equal(rec.judgement.verified, null);
    assert.equal(rec.cost.calls, 2, 'the spend before the fault is still on the record');
  }
  const budget = portOf(args => args.system === SELECT_SYSTEM ? { value: { template: 'weekly-report', reason: 'r', notCovered: [] } } : { error: 'MODEL_BUDGET' });
  const rec = await runCase(byId('W1'), { arm: 'B-H', builder: new ModelBuilder({ port: budget }), worldsRoot: worlds });
  assert.equal(rec.environmentFault, null, 'our own cap is not an environment fault'); assert.equal(rec.judgement.verified, false);
});
