// ownerci hidden regression tests for src/verdict.mjs. Authored for the bed from the ORIGINAL
// module's behaviour at the frozen commit; never shown to solvers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORITY, AUTHORITY_FLAGS, authorityOf, ENV_FAULT_CODES, INCONCLUSIVE_CODES, VERDICTS, verdictOf } from './src/verdict.mjs';

const failed = code => ({ status: 'failed', error: code === undefined ? null : { code } });

test('hidden verdict: result objects have exactly the documented fields', () => {
  const v = verdictOf({ status: 'succeeded' });
  assert.deepEqual(v, { verdict: 'pass', reason: 'Run succeeded and its acceptance checks held', code: null, authority: 'supported',
    grantsActionAuthority: false, establishesCompletion: false });
  assert.deepEqual(Object.keys(verdictOf(failed('DEADLINE'))), ['verdict', 'reason', 'code', 'authority', 'grantsActionAuthority', 'establishesCompletion']);
});

test('hidden verdict: singular and plural finding counts in the reason', () => {
  const one = verdictOf({ status: 'succeeded' }, { discovery: true, findings: 1 });
  assert.equal(one.verdict, 'finding');
  assert.equal(one.reason, 'Discovery workflow succeeded with 1 confirmed finding');
  assert.equal(one.authority, 'supported');
  const two = verdictOf({ status: 'succeeded' }, { discovery: true, findings: [{ confirmed: true }, { confirmed: true }, { confirmed: false }] });
  assert.equal(two.reason, 'Discovery workflow succeeded with 2 confirmed findings');
  assert.equal(verdictOf({ status: 'succeeded' }, { discovery: true, findings: 7 }).reason, 'Discovery workflow succeeded with 7 confirmed findings');
  assert.equal(verdictOf({ status: 'succeeded' }, { discovery: true, findings: 0 }).verdict, 'pass');
  assert.equal(verdictOf({ status: 'succeeded' }, { discovery: true, findings: [] }).verdict, 'pass');
});

test('hidden verdict: only entries with confirmed === true count; other shapes count zero', () => {
  const v = verdictOf({ status: 'succeeded', findings: [{ confirmed: 'yes' }, { confirmed: 1 }, null, { confirmed: true }, {}] }, { discovery: true });
  assert.equal(v.reason, 'Discovery workflow succeeded with 1 confirmed finding');
  assert.equal(verdictOf({ status: 'succeeded', findings: 'many' }, { discovery: true }).verdict, 'pass');
  assert.equal(verdictOf({ status: 'succeeded', findings: { length: 3 } }, { discovery: true }).verdict, 'pass');
  assert.equal(verdictOf({ status: 'succeeded', findings: [null, undefined] }, { discovery: true }).verdict, 'pass');
});

test('hidden verdict: discovery must be exactly true; the workflow setting wins over the run', () => {
  assert.equal(verdictOf({ status: 'succeeded', findings: 2 }, { discovery: 'yes' }).verdict, 'pass');
  assert.equal(verdictOf({ status: 'succeeded', findings: 2 }, { discovery: 1 }).verdict, 'pass');
  assert.equal(verdictOf({ status: 'succeeded', discovery: true, findings: 2 }, { workflow: { discovery: false } }).verdict, 'pass');
  assert.equal(verdictOf({ status: 'succeeded', discovery: true, findings: 2 }, { workflow: {} }).verdict, 'finding');
  assert.equal(verdictOf({ status: 'succeeded', discovery: false, findings: 2 }, { workflow: { discovery: true } }).verdict, 'finding');
  assert.equal(verdictOf({ status: 'succeeded', discovery: true, findings: 2 }).verdict, 'finding');
  assert.equal(verdictOf({ status: 'succeeded', findings: 3 }, { discovery: true, findings: 0 }).verdict, 'pass');
  assert.equal(verdictOf({ status: 'succeeded', findings: 0 }, { discovery: true, findings: 2 }).verdict, 'finding');
});

test('hidden verdict: uncertain runs keep their error code or null', () => {
  const plain = verdictOf({ status: 'uncertain' });
  assert.equal(plain.verdict, 'uncertain'); assert.equal(plain.code, null); assert.equal(plain.authority, 'in-doubt');
  assert.equal(plain.reason, 'An effect may or may not have happened; reconciliation is required');
  assert.equal(verdictOf({ status: 'uncertain', error: { code: 'DEADLINE' } }).code, 'DEADLINE');
  assert.equal(verdictOf({ status: 'uncertain', error: {} }).code, null);
  assert.equal(verdictOf({ status: 'uncertain', findings: 4 }, { discovery: true }).verdict, 'uncertain');
});

test('hidden verdict: cancelled runs mention their code only when there is one', () => {
  const a = verdictOf({ status: 'cancelled' });
  assert.equal(a.verdict, 'inconclusive'); assert.equal(a.code, null);
  assert.equal(a.reason, 'Run was stopped before reaching a decision');
  const b = verdictOf({ status: 'cancelled', error: { code: 'MODEL_RATE_LIMIT' } });
  assert.equal(b.verdict, 'inconclusive'); assert.equal(b.code, 'MODEL_RATE_LIMIT');
  assert.equal(b.reason, 'Run was stopped before reaching a decision (MODEL_RATE_LIMIT)');
  assert.equal(b.authority, 'unresolved');
});

test('hidden verdict: every inconclusive, env and harness code maps with the documented reason', () => {
  for (const code of INCONCLUSIVE_CODES) {
    const v = verdictOf(failed(code));
    assert.deepEqual([v.verdict, v.code, v.reason, v.authority], ['inconclusive', code, `A check or budget stopped the run without a decision (${code})`, 'unresolved']);
  }
  for (const code of ENV_FAULT_CODES) {
    const v = verdictOf(failed(code));
    assert.deepEqual([v.verdict, v.code, v.reason, v.authority], ['env_fault', code, `The environment failed, not the workflow (${code})`, 'unresolved']);
  }
  const h = verdictOf(failed('TOOL_CRASH'));
  assert.deepEqual([h.verdict, h.code, h.reason, h.authority], ['harness_fault', 'TOOL_CRASH', 'The harness or workflow failed (TOOL_CRASH)', 'unresolved']);
  const none = verdictOf({ status: 'failed', error: {} });
  assert.deepEqual([none.verdict, none.code, none.reason], ['harness_fault', null, 'The harness or workflow failed (no error code)']);
  assert.equal(verdictOf({ status: 'failed' }).code, null);
});

test('hidden verdict: code vocabularies are exact, ordered and frozen', () => {
  assert.deepEqual([...VERDICTS], ['pass', 'finding', 'inconclusive', 'env_fault', 'harness_fault', 'uncertain']);
  assert.deepEqual([...ENV_FAULT_CODES], ['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'SANDBOX_UNAVAILABLE', 'NETWORK', 'MODEL_TRANSPORT',
    'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
  assert.equal(INCONCLUSIVE_CODES.length, 8);
  for (const list of [VERDICTS, ENV_FAULT_CODES, INCONCLUSIVE_CODES, AUTHORITY, AUTHORITY_FLAGS]) assert.ok(Object.isFrozen(list));
  assert.equal(AUTHORITY_FLAGS.grantsActionAuthority, false);
  assert.equal(AUTHORITY_FLAGS.establishesCompletion, false);
});

test('hidden verdict: input validation codes and messages', () => {
  for (const bad of [undefined, null, 'succeeded', 42, true]) {
    assert.throws(() => verdictOf(bad), e => e.name === 'FoundryError' && e.code === 'VERDICT_INPUT' && e.message === 'A run record is required');
  }
  assert.throws(() => verdictOf({}), e => e.code === 'RUN_NOT_TERMINAL' && e.message === 'Run status undefined has no verdict yet');
  assert.throws(() => verdictOf({ status: 'running' }), e => e.code === 'RUN_NOT_TERMINAL' && e.message === 'Run status running has no verdict yet');
  assert.throws(() => verdictOf([]), { code: 'RUN_NOT_TERMINAL' });
  assert.throws(() => verdictOf({ status: 'SUCCEEDED' }), { code: 'RUN_NOT_TERMINAL' });
});

test('hidden verdict: authorityOf only accepts own verdict names', () => {
  assert.deepEqual(VERDICTS.map(authorityOf), ['supported', 'supported', 'unresolved', 'unresolved', 'unresolved', 'in-doubt']);
  for (const bad of ['hasOwnProperty', '__proto__', 'toString', '', 'PASS']) {
    assert.throws(() => authorityOf(bad), e => e.name === 'FoundryError' && e.code === 'UNKNOWN_VERDICT' && e.message === `Unknown verdict: ${bad}`);
  }
});
