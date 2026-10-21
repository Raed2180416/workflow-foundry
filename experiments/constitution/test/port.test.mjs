// The effect port (post-posed edit automaton) with the shield and with G, driven tick by tick without a host: a scripted
// inner solver and a fake ctx. $0, pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { effectPort } from '../port.mjs';
import { shieldArm, shieldPolicy } from '../shield.mjs';
import { guardArm } from '../guard.mjs';
import { buildRegistry } from '../registry.mjs';

const reg = buildRegistry();
const V1 = reg.byVersion(1).hash, V2 = reg.byVersion(2).hash;
const O = 'ORD-1-0001', F = `${O}-F1`;
const placed = at => ({ id: 'ev-p', type: 'order.placed', at, payload: { orderId: O, placedAt: at, customerId: 'C-0001', items: [] } });
const cancel = (at, who) => ({ id: 'ev-c', type: 'customer.action', at, payload: { orderRef: O, action: 'cancel', from: 'x@y', enteredBy: who } });
const answered = (taskId, user, decision = 'approve', at) => ({ id: `a-${taskId}`, type: 'humanTask.answered', at, payload: { taskId, user, answer: { decision } } });
const failed = (taskId, type, at) => ({ id: `f-${taskId}`, type, at, payload: { taskId } });
const compensation = amount => [
  { key: 'csh', system: 'carrier', op: 'cancel', args: { orderId: O, fulfilmentId: F } },
  { key: 'rf', system: 'billing', op: 'refund', args: { orderId: O, fulfilmentId: F, amountMinor: amount }, after: 'csh' },
  { key: 'rel', system: 'inventory', op: 'release', args: { orderId: O, fulfilmentId: F, sku: 'S' }, after: 'rf' },
  { key: 'fst', system: 'orders', op: 'setStatus', args: { orderId: O, fulfilmentId: F, status: 'cancelled' } },
];
/** A scripted solver: returns the queued outputs in order (the default: an empty tick); records what it was given. */
function scripted(outputs) {
  const seen = [];
  return { id: 'scripted', seen, async tick(input) { seen.push(input.events.map(e => e.type)); const o = outputs.shift() ?? {}; return { decisions: { subject: O }, effects: [], carry: { n: seen.length }, ...o }; } };
}
const ctx = (status = {}) => ({ files: {}, status: (system, key) => status[key] ?? 'not-found', query: () => [], instances: () => [] });
const tick = (arm, events, now, c = ctx()) => arm.tick({ kind: 'case', instance: 'i1', now, events, carry: null }, c);

test('hold: the refund and its dependants are suppressed, an approval task replaces them, the close waits; SoD from the history', async () => {
  const inner = scripted([{}, { effects: compensation(43793), close: true }]);
  const arm = shieldArm(inner, { registry: reg, workflowHash: 'wf' });
  await tick(arm, [placed('2026-03-13T02:28:00+01:00')], '2026-03-13T02:28:00+01:00');
  const out = await tick(arm, [cancel('2026-03-13T02:40:00+01:00', 'u-cs1')], '2026-03-13T02:40:00+01:00');
  assert.deepEqual(out.effects.map(e => e.key), ['csh', 'fst']);
  assert.equal(out.close, undefined, 'the close is deferred while a hold is open');
  assert.equal(out.humanTasks.length, 1);
  const t = out.humanTasks[0];
  assert.equal(t.kind, 'refundApproval'); assert.equal(t.role, 'finance-approver'); assert.equal(t.subject, F);
  assert.deepEqual(t.excludeUsers, ['u-cs1']);
  const k = out.decisions.constitution;
  assert.equal(k.pins[O], V2, 'pinned to v2: the order was placed after day 7');
  assert.equal(k.workflow, 'wf');
  const hold = k.interventions.find(x => x.action === 'hold');
  assert.equal(hold.clause, 'C2'); assert.equal(hold.constitution, V2); assert.equal(hold.threshold, 25000);
});

test('release: an approval releases the held effects in order, keys kept, the outside predecessor dropped once committed', async () => {
  const inner = scripted([{}, { effects: compensation(43793), close: true }]);
  const arm = shieldArm(inner, { registry: reg });
  await tick(arm, [placed('2026-03-13T02:28:00+01:00')], '2026-03-13T02:28:00+01:00');
  const o1 = await tick(arm, [cancel('2026-03-13T02:40:00+01:00', 'u-cs1')], '2026-03-13T02:40:00+01:00');
  const tid = o1.humanTasks[0].id;
  const calls = inner.seen.length;
  const o2 = await tick(arm, [answered(tid, 'u-fin1', 'approve', '2026-03-13T02:55:00+01:00')], '2026-03-13T02:55:00+01:00', ctx({ csh: 'committed' }));
  assert.equal(inner.seen.length, calls, 'the solver is not called for the port\'s own events');
  assert.deepEqual(o2.effects.map(e => e.key), ['rf', 'rel']);
  assert.equal(o2.effects[0].after, undefined, 'the committed predecessor is no longer in the output');
  assert.equal(o2.effects[1].after, 'rf');
  assert.equal(o2.decisions.subject, O);
  assert.equal(o2.close, undefined, 'never close in the output that releases');
  assert.equal(o2.decisions.constitution.releases[0].approvedBy, 'u-fin1');
  const o3 = await tick(arm, [{ id: 'r', type: 'effect.result', at: '2026-03-13T02:56:00+01:00', payload: {} }], '2026-03-13T02:56:00+01:00');
  assert.equal(inner.seen.length, calls + 1);
  assert.equal(o3.close, undefined);
  assert.equal(arm.holds[0].state, 'released');
});

test('a pending predecessor delays the release and sets a recheck timer', async () => {
  const inner = scripted([{}, { effects: compensation(43793) }]);
  const arm = shieldArm(inner, { registry: reg });
  await tick(arm, [placed('2026-03-13T02:28:00+01:00')], '2026-03-13T02:28:00+01:00');
  const o1 = await tick(arm, [cancel('2026-03-13T02:40:00+01:00', 'cust:C-0001')], '2026-03-13T02:40:00+01:00');
  assert.deepEqual(o1.humanTasks[0].excludeUsers, [], 'a customer is never a finance approver: nothing to exclude');
  const o2 = await tick(arm, [answered(o1.humanTasks[0].id, 'u-cs1', 'approve', '2026-03-13T02:55:00+01:00')], '2026-03-13T02:55:00+01:00', ctx({ csh: 'pending' }));
  assert.deepEqual(o2.effects, []);
  assert.equal(o2.obligations.upsert[0].id, 'ot0:recheck');
  const o3 = await tick(arm, [{ id: 'tf', type: 'timer.fired', at: '2026-03-13T03:00:00+01:00', payload: { obligationId: 'ot0:recheck' } }], '2026-03-13T03:00:00+01:00', ctx({ csh: 'committed' }));
  assert.deepEqual(o3.effects.map(e => e.key), ['rf', 'rel']);
});

test('re-asks after a timeout, a withdrawal or a rejected form; break-glass to the controller after three; a late answer still counts', async () => {
  const inner = scripted([{}, { effects: compensation(60000) }]);
  const arm = shieldArm(inner, { registry: reg });
  await tick(arm, [placed('2026-03-03T10:00:00+01:00')], '2026-03-03T10:00:00+01:00');
  const o1 = await tick(arm, [cancel('2026-03-03T10:30:00+01:00', 'u-cs2')], '2026-03-03T10:30:00+01:00');
  assert.equal(o1.decisions.constitution.pins[O], V1);
  let id = o1.humanTasks[0].id;
  const o2 = await tick(arm, [failed(id, 'humanTask.timeout', '2026-03-03T14:30:00+01:00')], '2026-03-03T14:30:00+01:00');
  id = o2.humanTasks[0].id; assert.match(id, /:2$/);
  const o3 = await tick(arm, [failed(id, 'humanTask.withdrawn', '2026-03-03T15:00:00+01:00')], '2026-03-03T15:00:00+01:00');
  id = o3.humanTasks[0].id; assert.match(id, /:3$/);
  const o4 = await tick(arm, [failed(id, 'humanTask.answerRejected', '2026-03-03T15:30:00+01:00')], '2026-03-03T15:30:00+01:00');
  const bg = o4.humanTasks[0];
  assert.equal(bg.role, 'controller'); assert.match(bg.question, /^BREAK-GLASS/);
  assert.ok(o4.decisions.constitution.interventions.some(x => x.action === 'break-glass'));
  const o5 = await tick(arm, [answered(o1.humanTasks[0].id, 'u-fin2', 'approve', '2026-03-03T16:00:00+01:00')], '2026-03-03T16:00:00+01:00', ctx({ csh: 'committed' }));
  assert.deepEqual(o5.effects.map(e => e.key), ['rf', 'rel'], 'the late answer to the first request releases');
});

test('a rejection suppresses the refund for good, and a re-emission stays suppressed; a re-emission while asking is deduplicated', async () => {
  const comp = compensation(43793);
  const inner = scripted([{}, { effects: comp }, { effects: [comp[1]].map(({ after, ...e }) => e) }]);
  const arm = shieldArm(inner, { registry: reg });
  await tick(arm, [placed('2026-03-13T02:28:00+01:00')], '2026-03-13T02:28:00+01:00');
  const o1 = await tick(arm, [cancel('2026-03-13T02:40:00+01:00', 'u-cs1')], '2026-03-13T02:40:00+01:00');
  const o2 = await tick(arm, [{ id: 'r', type: 'effect.result', at: '2026-03-13T02:41:00+01:00', payload: {} }], '2026-03-13T02:41:00+01:00');
  assert.deepEqual(o2.effects, []);
  assert.ok(o2.decisions.constitution.interventions.some(x => x.action === 'dedupe-held'));
  const o3 = await tick(arm, [answered(o1.humanTasks[0].id, 'u-fin1', 'reject', '2026-03-13T02:50:00+01:00')], '2026-03-13T02:50:00+01:00');
  assert.ok(o3.decisions.constitution.interventions.some(x => x.action === 'suppress'));
  assert.equal(arm.holds[0].state, 'refused');
});

test('below the pinned threshold nothing is held; the pin is at placement, not at the refund', async () => {
  // Placed on day 6 (v1, T = 500 EUR), refunded on day 8 (v2 in force, T = 250 EUR): EUR 300 needs no approval under the pin.
  const inner = scripted([{}, { effects: compensation(30000) }]);
  const arm = shieldArm(inner, { registry: reg });
  await tick(arm, [placed('2026-03-08T12:00:00+01:00')], '2026-03-08T12:00:00+01:00');
  const o = await tick(arm, [cancel('2026-03-10T09:00:00+01:00', 'u-cs1')], '2026-03-10T09:00:00+01:00');
  assert.deepEqual(o.effects.map(e => e.key), ['csh', 'rf', 'rel', 'fst']);
  assert.equal(o.humanTasks, undefined);
  assert.equal(o.decisions.constitution.pins[O], V1);
});

test('G: the threshold in force now, the role only: it holds the same refund (C3 retroactive) and excludes nobody (no SoD)', async () => {
  const inner = scripted([{}, { effects: compensation(30000) }]);
  const arm = guardArm(inner, { registry: reg });
  await tick(arm, [placed('2026-03-08T12:00:00+01:00')], '2026-03-08T12:00:00+01:00');
  const o = await tick(arm, [cancel('2026-03-10T09:00:00+01:00', 'u-cs1')], '2026-03-10T09:00:00+01:00');
  assert.deepEqual(o.effects.map(e => e.key), ['csh', 'fst']);
  assert.deepEqual(o.humanTasks[0].excludeUsers, []);
  assert.equal(o.decisions.constitution.pins, undefined, 'G journals no pin and no workflow hash');
  assert.equal(o.decisions.constitution.interventions[0].constitution, null);
});

test('G is at most 30 lines', () => {
  const lines = readFileSync(fileURLToPath(new URL('../guard.mjs', import.meta.url)), 'utf8').split('\n').filter(l => l.trim()).length;
  assert.ok(lines <= 30, `${lines} lines`);
});

test('the shield verifies a constitution-aware solver\'s own approval instead of asking again (and rejects a conflicted one)', async () => {
  const ask = { id: 'my-approval', kind: 'refundApproval', role: 'finance-approver', excludeUsers: ['u-cs1'], subject: F, question: 'q', answerSchema: { type: 'object' }, dueAt: '2026-03-13T06:00:00+01:00', onTimeout: { action: 'escalate' } };
  for (const [user, held] of [['u-fin2', false], ['u-cs1', true]]) {
    const inner = scripted([{}, { humanTasks: [ask] }, { effects: compensation(43793) }]);
    const arm = shieldArm(inner, { registry: reg });
    await tick(arm, [placed('2026-03-13T02:28:00+01:00')], '2026-03-13T02:28:00+01:00');
    await tick(arm, [cancel('2026-03-13T02:40:00+01:00', 'u-cs1')], '2026-03-13T02:40:00+01:00');
    const o = await tick(arm, [answered('my-approval', user, 'approve', '2026-03-13T02:50:00+01:00')], '2026-03-13T02:50:00+01:00');
    assert.equal(o.effects.some(e => e.key === 'rf'), !held, user);
    if (!held) assert.ok(o.decisions.constitution.interventions.some(x => x.action === 'verified' && x.task === 'my-approval'));
  }
});

test('an invalid solver output passes through untouched (the host judges it)', async () => {
  const arm = effectPort({ id: 'x', async tick() { return 'not an object'; } }, { policy: shieldPolicy({ registry: reg }) });
  assert.equal(await tick(arm, [placed('2026-03-13T02:28:00+01:00')], '2026-03-13T02:28:00+01:00'), 'not an object');
});
