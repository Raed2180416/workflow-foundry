import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORITY, AUTHORITY_FLAGS, authorityOf, ENV_FAULT_CODES, INCONCLUSIVE_CODES, VERDICTS, verdictOf } from '../src/verdict.mjs';

const failed = code => ({ status: 'failed', error: code ? { code, message: 'x' } : null });
const check = (run, verdict, code, options) => {
  const v = verdictOf(run, options);
  assert.equal(v.verdict, verdict, JSON.stringify(run));
  assert.equal(v.code, code);
  assert.equal(typeof v.reason, 'string'); assert.ok(v.reason.length > 0);
  assert.equal(v.authority, AUTHORITY[verdict]);
  assert.equal(v.grantsActionAuthority, false); assert.equal(v.establishesCompletion, false);
  return v;
};

test('verdict: succeeded discovery run with a confirmed finding is a finding', () => {
  const run = { status: 'succeeded', error: null, findings: [{ id: 'f1', confirmed: true }, { id: 'f2', confirmed: false }] };
  assert.match(check(run, 'finding', null, { workflow: { discovery: true } }).reason, /1 confirmed finding\b/);
  check({ status: 'succeeded', discovery: true, findings: [{ confirmed: true }, { confirmed: true }] }, 'finding', null);
  check({ status: 'succeeded' }, 'finding', null, { discovery: true, findings: 3 });
});

test('verdict: succeeded is pass (including discovery without confirmed findings)', () => {
  check({ status: 'succeeded', error: null }, 'pass', null);
  check({ status: 'succeeded', findings: [{ confirmed: false }] }, 'pass', null, { workflow: { discovery: true } });
  check({ status: 'succeeded', findings: [{ confirmed: true }] }, 'pass', null, { workflow: { discovery: false } });
  check({ status: 'succeeded' }, 'pass', null, { workflow: { discovery: true } });
});

test('verdict: checks, loops, budgets and deadlines are inconclusive', () => {
  assert.deepEqual([...INCONCLUSIVE_CODES], ['VERIFY_FAILED', 'ACCEPTANCE_FAILED', 'ASSERTION_FAILED', 'NODE_CHECK_FAILED', 'LOOP_EXHAUSTED', 'STEP_BUDGET', 'COST_BUDGET', 'DEADLINE']);
  for (const code of INCONCLUSIVE_CODES) check(failed(code), 'inconclusive', code);
});

test('verdict: model outages, sandbox absence and network failures are env faults', () => {
  for (const code of ['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'SANDBOX_UNAVAILABLE', 'NETWORK', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']) {
    assert.ok(ENV_FAULT_CODES.includes(code));
    check(failed(code), 'env_fault', code);
  }
});

test('verdict: schema, escalation, code, replay and other runtime errors are harness faults', () => {
  for (const code of ['MODEL_SCHEMA', 'MODEL_ESCALATION_EXHAUSTED', 'CODE_ERROR', 'CODE_TIMEOUT', 'CODE_OUTPUT', 'REPLAY_MISS', 'MODEL_TRUNCATED', 'MODEL_REFUSAL', 'MODEL_PROTOCOL', 'TOOL_TIMEOUT', 'CAPABILITY_DRIFT', 'SOMETHING_NEW']) check(failed(code), 'harness_fault', code);
  check(failed(null), 'harness_fault', null);
});

test('verdict: uncertain status wins over any error code', () => {
  check({ status: 'uncertain', error: null }, 'uncertain', null);
  check({ status: 'uncertain', error: { code: 'MODEL_RATE_LIMIT' } }, 'uncertain', 'MODEL_RATE_LIMIT');
  check({ status: 'uncertain', error: { code: 'VERIFY_FAILED' } }, 'uncertain', 'VERIFY_FAILED');
});

test('verdict: cancelled runs are inconclusive; non-terminal runs have no verdict', () => {
  check({ status: 'cancelled', error: { code: 'CANCELLED' } }, 'inconclusive', 'CANCELLED');
  check({ status: 'cancelled', error: { code: 'APPROVAL_REJECTED' } }, 'inconclusive', 'APPROVAL_REJECTED');
  for (const status of ['ready', 'running', 'waiting', 'awaiting_human', 'awaiting_approval', 'interrupted']) assert.throws(() => verdictOf({ status }), { code: 'RUN_NOT_TERMINAL' });
  assert.throws(() => verdictOf(null), { code: 'VERDICT_INPUT' });
});

test('verdict: authority vocabulary maps to ARC states and never grants authority', () => {
  assert.deepEqual({ ...AUTHORITY }, { pass: 'supported', finding: 'supported', inconclusive: 'unresolved', harness_fault: 'unresolved', env_fault: 'unresolved', uncertain: 'in-doubt' });
  assert.deepEqual(Object.keys(AUTHORITY).sort(), [...VERDICTS].sort());
  for (const v of VERDICTS) assert.equal(authorityOf(v), AUTHORITY[v]);
  assert.throws(() => authorityOf('maybe'), { code: 'UNKNOWN_VERDICT' });
  assert.throws(() => authorityOf('constructor'), { code: 'UNKNOWN_VERDICT' });
  assert.deepEqual({ ...AUTHORITY_FLAGS }, { grantsActionAuthority: false, establishesCompletion: false });
  assert.ok(Object.isFrozen(AUTHORITY) && Object.isFrozen(AUTHORITY_FLAGS));
  assert.throws(() => { 'use strict'; AUTHORITY_FLAGS.grantsActionAuthority = true; }, TypeError);
});
