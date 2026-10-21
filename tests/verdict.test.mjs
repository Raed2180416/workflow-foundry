import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORITY, AUTHORITY_FLAGS, authorityOf, ENV_FAULT_CODES, INCONCLUSIVE_CODES, REMEDIES, remedyOf, UNVERIFIED_CODES, VERDICTS, verdictOf } from '../src/verdict.mjs';

// R-17: a succeeded run is a pass only if its acceptance can fail a wrong answer. These tests are about the verdict mapping, so
// the workflows they pass in hold a predicate that gates.
const gating = { nodes: [{ id: 'a', kind: 'code' }], acceptance: [{ op: 'eq', left: { $ref: 'nodes.a.total' }, right: 3 }] };

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

test('verdict: succeeded with a gating acceptance is pass (including discovery without confirmed findings)', () => {
  const pass = check({ status: 'succeeded', error: null }, 'pass', null, { workflow: gating });
  assert.equal(pass.acceptance, 'gating');
  check({ status: 'succeeded', findings: [{ confirmed: false }] }, 'pass', null, { workflow: { ...gating, discovery: true } });
  check({ status: 'succeeded', findings: [{ confirmed: true }] }, 'pass', null, { workflow: { ...gating, discovery: false } });
  check({ status: 'succeeded' }, 'pass', null, { workflow: { ...gating, discovery: true } });
});

// Changed with R-17. These used to expect `pass` for a bare succeeded run, which is the defect: a verdict computed without the
// acceptance contract, or from an acceptance that only checks that an answer exists, certified runs nothing had checked.
test('verdict: a succeeded run is unverified unless its acceptance gates; evidence against the answer is reported first', () => {
  const existence = { nodes: [], acceptance: [{ op: 'exists', value: { $ref: 'nodes.answer.records' } }] };
  const v = check({ status: 'succeeded', error: null }, 'unverified', 'ACCEPTANCE_UNASSESSED');
  assert.equal(v.acceptance, 'unassessed');
  assert.equal(v.authority, 'unresolved');
  check({ status: 'succeeded' }, 'unverified', 'ACCEPTANCE_UNASSESSED', { workflow: { discovery: true } });
  assert.equal(check({ status: 'succeeded' }, 'unverified', 'ACCEPTANCE_EXISTENCE_ONLY', { workflow: existence }).acceptance, 'existence-only');
  assert.match(check({ status: 'succeeded' }, 'unverified', 'NO_ORACLE_DECLARED', { workflow: { ...existence, oracle: { mode: 'none', reason: 'A person reads the brief against the source.' } } }).reason, /A person reads the brief/);
  assert.equal(check({ status: 'succeeded' }, 'unverified', 'NO_ORACLE_DECLARED', { workflow: { ...gating, oracle: { mode: 'none', reason: 'Declared, so the run cannot claim more.' } } }).acceptance, 'no-oracle');

  // A non-gating verify that recorded a failure, at the root or in a map frame, and a collecting map whose failed count nothing reads.
  const withVerify = { nodes: [{ id: 'a', kind: 'code' }, { id: 'check', kind: 'verify', gate: false }], acceptance: gating.acceptance };
  check({ status: 'succeeded', outputs: { check: { pass: false } } }, 'unverified', 'VERIFY_FAILED_NONBLOCKING', { workflow: withVerify });
  check({ status: 'succeeded', outputs: {}, frames: { 'root/m:0': { outputs: { check: { pass: false } } } } }, 'unverified', 'VERIFY_FAILED_NONBLOCKING', { workflow: withVerify });
  check({ status: 'succeeded', outputs: { check: { pass: true } } }, 'pass', null, { workflow: withVerify });
  const collecting = { nodes: [{ id: 'a', kind: 'code' }, { id: 'rows', kind: 'map', failure: 'collect' }], acceptance: gating.acceptance };
  check({ status: 'succeeded', nodes: { rows: { failedItems: 2 } } }, 'unverified', 'ERROR_COLLECTED', { workflow: collecting });
  check({ status: 'succeeded', nodes: { rows: { failedItems: 0 } } }, 'pass', null, { workflow: collecting });
  const owned = { ...collecting, acceptance: [...gating.acceptance, { op: 'lte', left: { $ref: 'nodes.rows.failed' }, right: 3 }] };
  check({ status: 'succeeded', nodes: { rows: { failedItems: 2 } } }, 'pass', null, { workflow: owned });
  // Evidence against the answer outranks the lack of evidence for it.
  check({ status: 'succeeded', outputs: { check: { pass: false } } }, 'unverified', 'VERIFY_FAILED_NONBLOCKING', { workflow: { ...withVerify, acceptance: existence.acceptance } });
  // A confirmed discovery finding is still a finding, and failures are untouched.
  check({ status: 'succeeded', findings: [{ confirmed: true }] }, 'finding', null, { workflow: { ...existence, discovery: true } });
  check({ status: 'failed', error: { code: 'VERIFY_FAILED' } }, 'inconclusive', 'VERIFY_FAILED', { workflow: existence });
  // Review 2026-10-08 added ERROR_CONTINUED (a handled onError:"continue" failure nothing gated) and GATE_NOT_RUN (every assert or
  // verify gate was skipped); both were false passes before.
  assert.deepEqual([...UNVERIFIED_CODES], ['VERIFY_FAILED_NONBLOCKING', 'ERROR_COLLECTED', 'ERROR_CONTINUED', 'ACCEPTANCE_EXISTENCE_ONLY', 'NO_ORACLE_DECLARED', 'GATE_NOT_RUN', 'ACCEPTANCE_UNASSESSED']);
  // A gate that is an assert or verify node vouches only if it ran: skipped (no state) or skipped in some map frame is not a pass.
  const verified = { nodes: [{ id: 'a', kind: 'code' }, { id: 'check', kind: 'verify', needs: ['a'], subject: { $ref: 'nodes.a' } }, { id: 'answer', kind: 'code', needs: ['check'] }],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.answer.x' } }] };
  check({ status: 'succeeded', nodes: { check: { status: 'completed' } } }, 'pass', null, { workflow: verified });
  check({ status: 'succeeded', nodes: { check: { status: 'skipped' } } }, 'unverified', 'GATE_NOT_RUN', { workflow: verified });
  check({ status: 'succeeded' }, 'unverified', 'GATE_NOT_RUN', { workflow: verified });
  const perItem = { nodes: [{ id: 'rows', kind: 'map', body: { nodes: [{ id: 'w', kind: 'code' }, { id: 'each', kind: 'verify', needs: ['w'], subject: { $ref: 'nodes.w' } }] } }, { id: 'answer', kind: 'code', needs: ['rows'] }],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.answer.x' } }] };
  const frames = (...states) => Object.fromEntries(states.map((status, i) => [`root/rows:${i}`, { nodes: { each: { status } } }]));
  check({ status: 'succeeded', frames: frames('completed', 'completed') }, 'pass', null, { workflow: perItem });
  check({ status: 'succeeded', frames: frames('completed', 'skipped') }, 'unverified', 'GATE_NOT_RUN', { workflow: perItem });
  check({ status: 'succeeded', frames: {} }, 'unverified', 'GATE_NOT_RUN', { workflow: perItem });
  // A continued failure that nothing reads is reported; one that a gate reads is the author's.
  const continuing = { nodes: [{ id: 'a', kind: 'code' }, { id: 'b', kind: 'agent', onError: 'continue' }], acceptance: gating.acceptance };
  check({ status: 'succeeded', nodes: { b: { status: 'handled_error' } } }, 'unverified', 'ERROR_CONTINUED', { workflow: continuing });
  check({ status: 'succeeded', nodes: { b: { status: 'completed' } } }, 'pass', null, { workflow: continuing });
  const read = { ...continuing, acceptance: [...gating.acceptance, { op: 'not', condition: { op: 'exists', value: { $ref: 'nodes.b.error' } } }] };
  check({ status: 'succeeded', nodes: { b: { status: 'handled_error' } } }, 'pass', null, { workflow: read });
});

test('verdict: checks, loops, budgets, deadlines, lost state compare-and-swaps, full state slots and failing wait timeouts are inconclusive', () => {
  assert.deepEqual([...INCONCLUSIVE_CODES], ['VERIFY_FAILED', 'ACCEPTANCE_FAILED', 'ASSERTION_FAILED', 'NODE_CHECK_FAILED', 'LOOP_EXHAUSTED', 'STEP_BUDGET', 'COST_BUDGET', 'TOKEN_BUDGET', 'DEADLINE',
    'STATE_VERSION_CONFLICT', 'STATE_FULL', 'WAIT_TIMEOUT', 'WAIT_DEADLINE']);
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
  assert.deepEqual({ ...AUTHORITY }, { pass: 'supported', finding: 'supported', unverified: 'unresolved', inconclusive: 'unresolved', harness_fault: 'unresolved', env_fault: 'unresolved', uncertain: 'in-doubt' });
  assert.deepEqual(Object.keys(AUTHORITY).sort(), [...VERDICTS].sort());
  for (const v of VERDICTS) assert.equal(authorityOf(v), AUTHORITY[v]);
  assert.throws(() => authorityOf('maybe'), { code: 'UNKNOWN_VERDICT' });
  assert.throws(() => authorityOf('constructor'), { code: 'UNKNOWN_VERDICT' });
  assert.deepEqual({ ...AUTHORITY_FLAGS }, { grantsActionAuthority: false, establishesCompletion: false });
  assert.ok(Object.isFrozen(AUTHORITY) && Object.isFrozen(AUTHORITY_FLAGS));
  assert.throws(() => { 'use strict'; AUTHORITY_FLAGS.grantsActionAuthority = true; }, TypeError);
});

// orch-20261021 rank 15 (chaos G1): every stop says whether the run can continue and what to do next; terminal verdicts seal it.
test('remedy: every stop code names continuability and a next action; terminal verdicts carry it, success and running runs have none', () => {
  for (const code of [...ENV_FAULT_CODES, ...INCONCLUSIVE_CODES, 'CANCELLED']) {
    const r = REMEDIES[code];
    assert.ok(r, `a remedy for ${code}`);
    assert.equal(typeof r.continuable, 'boolean'); assert.ok(r.action && r.text.length > 20);
    assert.match(r.text, r.continuable ? /resume/ : /Final|cannot continue/, code);
  }
  for (const code of ['MODEL_RATE_LIMIT', 'STORAGE_FULL', 'COST_BUDGET', 'TOKEN_BUDGET', 'MODEL_PROTOCOL']) {
    const v = verdictOf({ status: 'failed', error: { code, message: 'x' } }, { workflow: gating });
    assert.deepEqual(v.remedy, (({ continuable, action, text }) => ({ continuable, action, text }))(remedyOf({ status: 'failed', error: { code } })), code);
  }
  assert.equal(verdictOf({ status: 'failed', error: { code: 'STORAGE_FULL' } }).remedy.action, 'free-space');
  assert.equal(verdictOf({ status: 'failed', error: { code: 'COST_BUDGET' } }).remedy.continuable, false);
  assert.equal(verdictOf({ status: 'failed', error: { code: 'MODEL_PROTOCOL' } }).remedy.action, 'investigate', 'an unlisted code is a harness failure to investigate');
  assert.equal(verdictOf({ status: 'succeeded', nodes: { a: { status: 'completed' } }, outputs: { a: { total: 3 } } }, { workflow: gating }).remedy, undefined);
  for (const status of ['succeeded', 'running', 'pending']) assert.equal(remedyOf({ status }), null);
});

test('remedy: a parked, a questioning, an approving and an uncertain run each say what continues them', () => {
  const parked = remedyOf({ status: 'waiting', nodes: { a: { status: 'waiting', parked: { code: 'MODEL_RATE_LIMIT', message: 'a: 429', retryAt: Date.parse('2026-10-21T15:00:00Z') } } }, frames: {} });
  assert.deepEqual([parked.code, parked.continuable, parked.action, parked.retryAt], ['MODEL_RATE_LIMIT', true, 'resume-after', Date.parse('2026-10-21T15:00:00Z')]);
  assert.match(parked.text, /Parked, not failed: root\/a .*2026-10-21T15:00:00.000Z/);
  const timer = remedyOf({ status: 'waiting', nodes: { w: { status: 'waiting' } } });
  assert.deepEqual([timer.code, timer.action], ['WAITING', 'wait']);
  const human = remedyOf({ status: 'awaiting_human', nodes: {}, frames: { 'root/m:0': { nodes: { ask: { status: 'awaiting_human' } } } } });
  assert.deepEqual([human.code, human.continuable, human.nodeKeys], ['AWAITING_HUMAN', true, ['root/m:0/ask']]);
  assert.match(human.text, /foundry answer RUN --node root\/m:0\/ask/);
  const approval = remedyOf({ status: 'awaiting_approval', approvals: { ap1: { status: 'pending' } } });
  assert.deepEqual([approval.code, approval.approvalIds], ['AWAITING_APPROVAL', ['ap1']]);
  const doubt = remedyOf({ status: 'uncertain', error: null, nodes: { pay: { status: 'uncertain', tool: 'billing.charge' } } });
  assert.deepEqual([doubt.code, doubt.continuable, doubt.action, doubt.effects], ['EFFECT_UNCERTAIN', false, 'reconcile', [{ nodeKey: 'root/pay', tool: 'billing.charge' }]]);
  assert.match(doubt.text, /Check whether root\/pay \(billing.charge\) took effect/);
  assert.equal(verdictOf(doubt && { status: 'uncertain', nodes: { pay: { status: 'uncertain', tool: 'billing.charge' } } }).remedy.action, 'reconcile');
});
