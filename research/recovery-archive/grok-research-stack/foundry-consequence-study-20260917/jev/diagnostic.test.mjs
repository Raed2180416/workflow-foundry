import test from 'node:test';
import assert from 'node:assert/strict';
import { cases, providerRequest, boundRecommendation, score, sha } from './cases.mjs';

test('18 distinct cases, six pairs, explicit missing evidence, no gold in requests', () => {
  assert.equal(cases.length, 18);
  assert.equal(new Set(cases.map(item => item.id)).size, 18);
  for (const item of cases) {
    const request = providerRequest(item);
    assert.deepEqual(Object.keys(request), ['state', 'questions']);
    assert.ok(!Object.hasOwn(request, 'expected'));
    assert.ok(!Object.hasOwn(request, 'role'));
    assert.ok(Object.hasOwn(request.questions.decision.criteria, item.expected));
    if (item.side === 2) { assert.equal(request.state.evidence, null); assert.equal(item.expected, 'clarify'); }
  }
});

test('changed evidence and candidate order invalidate stale recommendations', () => {
  for (const item of cases) {
    const request = providerRequest(item);
    const receipt = { requestHash: sha(request), result: { answers: { decision: { choice: item.expected } } } };
    assert.equal(boundRecommendation(item, request, receipt).authorityGranted, false);
    const modified = structuredClone(request); modified.state.evidence = 'different evidence';
    assert.throws(() => boundRecommendation(item, modified, receipt), /STALE_JUDGMENT/);
    assert.throws(() => boundRecommendation(item, providerRequest(item, true), receipt), /STALE_JUDGMENT/);
  }
});

test('missing provider answer does not default to success', () => {
  const item = cases[0], request = providerRequest(item);
  assert.throws(() => boundRecommendation(item, request, { requestHash: sha(request), result: {} }), /INVALID_CHOICE/);
});

test('always abstain cannot pass consequential pairs', () => {
  const records = cases.map(item => ({ caseId: item.id, variant: 'original', status: 'received',
    result: { answers: { decision: { choice: 'clarify' } } } }));
  const result = score(records);
  assert.equal(result.correct, 6);
  assert.ok(result.pairs.every(pair => pair.evaluated && !pair.bothCorrect));
});

test('six finite separation witnesses require different process updates', () => {
  for (let index = 0; index < cases.length; index += 3) {
    const a = cases[index], b = cases[index + 1];
    assert.notEqual(a.expected, b.expected);
    assert.notDeepEqual(a.consequences[a.expected], b.consequences[b.expected]);
    assert.equal(a.state.context, b.state.context);
    assert.deepEqual(a.questions, b.questions);
  }
});
