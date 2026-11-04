// Durable signal waits (L0 row 19 with correlate and race, row 18 `at`; src/signals.mjs): correlation hits and misses, races
// (signal vs timer, signal vs signal), timeout routing, absolute timers, restart while waiting, duplicate, out-of-order and late
// signals, delivery over the CLI and HTTP surfaces, and replay of every decision from the chain (verify-run).
// Local capabilities only: no model, no network. Development/diagnostic evidence, not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { Foundry } from '../src/foundry.mjs';
import { serveHttp } from '../src/http.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import { verifyRun } from '../src/verify-run.mjs';
import { digest } from '../src/data.mjs';
import { parseAt, replayWaits } from '../src/signals.mjs';

const cli = new URL('../bin/foundry.mjs', import.meta.url).pathname;
const ref = $ref => ({ $ref });
const PAYMENT = { type: 'object', additionalProperties: false, required: ['amount'], properties: { amount: { type: 'number' } } };
const FAILURE = { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', maxLength: 200 } } };
const RECEIPT = { type: 'object', additionalProperties: false, required: ['qty'], properties: { qty: { type: 'integer' } } };
const base = (nodes, acceptance, { id = 'SignalProbe', ...rest } = {}) => ({ schemaVersion: '1.0', id, version: 1, title: 'Signal probe', goal: 'Wait for a correlated signal, then act',
  domain: 'diagnostic', envelope: { assumptions: ['Synthetic local signals'], risks: [], successCriteria: ['The wait takes the right signal, or times out'] },
  budget: { maxSteps: 200, maxConcurrency: 4, maxDurationMs: 600000 }, nodes, acceptance, ...rest });
// undefined in `extra` removes a field.
const payWait = (extra = {}) => Object.fromEntries(Object.entries({ id: 'pay', kind: 'wait', needs: [], description: 'Wait for the payment of this order', signal: 'payment.settled', correlate: ref('input.order'),
  schema: PAYMENT, timeoutMs: 300000, ...extra }).filter(([, value]) => value !== undefined));
const echo = (id, needs, args, extra = {}) => ({ id, kind: 'task', needs, description: `Echo ${id}`, tool: 'core.identity', args, timeoutMs: 1000, retry: { maxAttempts: 1 }, ...extra });
const ship = () => echo('ship', ['pay'], { amount: ref('nodes.pay.payload.amount') });
const settled = (id, key, amount) => ({ id, name: 'payment.settled', key, payload: { amount } });
const registry = createDefaultRegistry();

function space(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-signals-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function open(t, root) {
  const store = new Store(root);
  t.after(() => { try { store.close(); } catch {} });
  return { store, runtime: new Runtime(store, createDefaultRegistry()) };
}
const until = async (predicate, timeoutMs = 5000) => {
  const end = Date.now() + timeoutMs;
  while (!predicate()) { if (Date.now() > end) throw new Error('condition not reached'); await delay(20); }
};
const pastWake = async (store, runId, nodeKey) => {
  const [timer] = store.timers(runId).filter(x => x.nodeKey === nodeKey);
  await delay(Math.max(0, timer.wakeAt - Date.now()) + 15);
  return timer.wakeAt;
};
const events = (store, runId, type) => store.events(runId).filter(e => e.type === type);
const clean = (store, runId) => {
  const report = verifyRun(store, runId);
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.equal(report.checks.waits.mismatches, 0);
  assert.deepEqual(replayWaits(store.events(runId)).mismatches, []);
  return report;
};
const codes = workflow => validateWorkflow(workflow, { registry }).errors.map(e => e.code);

test('wait.signal: validation accepts the documented shapes and refuses unbounded, ambiguous and misrouted waits', () => {
  const ok = base([payWait(), ship()], [{ op: 'exists', value: ref('nodes.ship.amount') }]);
  assert.deepEqual(codes(ok), []);
  assert.deepEqual(codes(base([payWait({ timeoutMs: undefined })], [{ op: 'exists', value: ref('nodes.pay') }])), ['WAIT_UNBOUNDED'], 'a wait with no timeout is refused');
  const month = { budget: { maxSteps: 200, maxConcurrency: 4, maxDurationMs: 30 * 86400000 } };
  assert.deepEqual(codes(base([payWait({ timeoutMs: 30 * 86400000 - 60000 })], [{ op: 'exists', value: ref('nodes.pay') }], month)), [], 'a signal wait may wait (almost) 30 days');
  // A timer at or after the run deadline can never be honoured: refused statically, not only when the wait starts.
  assert.deepEqual(codes(base([payWait({ timeoutMs: 30 * 86400000 })], [{ op: 'exists', value: ref('nodes.pay') }], month)), ['WAIT_DEADLINE']);
  assert.deepEqual(codes(base([payWait({ timeoutMs: 900000 })], [{ op: 'exists', value: ref('nodes.pay') }])), ['WAIT_DEADLINE'], '15 minutes in a 10-minute budget');
  assert.ok(codes(base([payWait({ timeoutMs: 30 * 86400000 + 1 })], [{ op: 'exists', value: ref('nodes.pay') }])).includes('SCHEMA'));
  assert.ok(codes(base([echo('slow', [], {}, { timeoutMs: 3600001 })], [{ op: 'exists', value: ref('nodes.slow') }])).includes('SCHEMA'), 'other nodes keep the 1-hour timeout bound');
  const shapes = [
    [{ id: 'w', kind: 'wait', needs: [], description: 'both timers', delayMs: 10, at: 1 }, 'WAIT_SHAPE'],
    [{ id: 'w', kind: 'wait', needs: [], description: 'a timer that times out', delayMs: 10, onTimeout: 'continue' }, 'WAIT_SHAPE'],
    [payWait({ id: 'w', delayMs: 10 }), 'WAIT_SHAPE'],
    [payWait({ id: 'w', at: 1 }), 'WAIT_SHAPE'],
    [{ ...payWait({ id: 'w' }), race: [{ signal: 'a' }, { signal: 'b' }] }, 'WAIT_SHAPE'],
    [{ id: 'w', kind: 'wait', needs: [], description: 'race with a shared key', race: [{ signal: 'a' }, { signal: 'b' }], correlate: ref('input.order'), timeoutMs: 10 }, 'WAIT_SHAPE'],
    [{ id: 'w', kind: 'wait', needs: [], description: 'race a signal twice', race: [{ signal: 'a' }, { signal: 'a' }], timeoutMs: 10 }, 'WAIT_SHAPE'],
    [{ id: 'w', kind: 'wait', needs: [], description: 'no offset', at: '2026-10-14T10:00:00' }, 'WAIT_AT'],
    [{ id: 'w', kind: 'wait', needs: [], description: '30 February', at: '2026-02-30T10:00:00Z' }, 'WAIT_AT'],
    [payWait({ id: 'w', onTimeout: 'nowhere' }), 'WAIT_ROUTE']
  ];
  for (const [node, code] of shapes) assert.ok(codes(base([node], [{ op: 'exists', value: ref('nodes.w') }])).includes(code), `${node.description}: ${code} expected, got ${codes(base([node], [{ op: 'exists', value: ref('nodes.w') }]))}`);
  // The timeout branch must need the wait and join all_success.
  const branch = extra => base([payWait({ onTimeout: 'escalate' }), echo('escalate', ['pay'], {}, extra), echo('other', [], {})], [{ op: 'exists', value: ref('nodes.pay') }]);
  assert.deepEqual(codes(branch({})), []);
  assert.deepEqual(codes(branch({ needs: ['other'] })), ['WAIT_ROUTE']);
  assert.deepEqual(codes(branch({ join: 'all_resolved' })), ['WAIT_ROUTE']);
  // One signal name, one payload type.
  const conflict = base([payWait(), payWait({ id: 'again', schema: FAILURE })], [{ op: 'exists', value: ref('nodes.pay') }]);
  assert.deepEqual(codes(conflict), ['SIGNAL_SCHEMA_CONFLICT']);
  // The output contract: a payload field is readable, an undeclared output field is not.
  assert.deepEqual(codes(base([payWait(), echo('bad', ['pay'], { x: ref('nodes.pay.receipt') })], [{ op: 'exists', value: ref('nodes.bad') }])), ['IMPOSSIBLE_REFERENCE']);
  assert.ok(codes(base([payWait({ correlate: ref('nodes.missing.x') })], [{ op: 'exists', value: ref('nodes.pay') }])).includes('UNDECLARED_DATA_DEPENDENCY'), 'correlate is a template checked like any other');
  assert.equal(parseAt('2026-10-14T10:00:00.5+05:30'), Date.UTC(2026, 9, 14, 4, 30, 0, 500));
  assert.throws(() => parseAt('2026-10-14 10:00Z'), { code: 'WAIT_AT' });
  // Epoch SECONDS are refused (read as milliseconds they would be January 1970); Python's microseconds are accepted and truncated.
  assert.throws(() => parseAt(1760400000), { code: 'WAIT_AT' });
  assert.equal(parseAt(1760400000000), 1760400000000);
  assert.equal(parseAt('2026-10-14T10:00:00.123456+00:00'), Date.UTC(2026, 9, 14, 10, 0, 0, 123));
  assert.equal(parseAt('2026-10-14T10:00:00.123456789Z'), Date.UTC(2026, 9, 14, 10, 0, 0, 123));
  assert.ok(codes(base([{ id: 'w', kind: 'wait', needs: [], description: 'epoch seconds', at: 1760400000 }], [{ op: 'exists', value: ref('nodes.w') }])).includes('WAIT_AT'));
});

test('wait.signal: taint — signals are trusted by default; a labelled wait that routes its timeout is control for its dependents', () => {
  const write = (needs, extra = {}) => ({ id: 'write', kind: 'task', needs, description: 'Write the receipt', tool: 'core.artifact', args: { name: 'receipt.txt', content: 'paid' }, timeoutMs: 1000, retry: { maxAttempts: 1 }, ...extra });
  const flow = waitExtra => base([payWait({ onTimeout: 'escalate', ...waitExtra }), write(['pay']), echo('escalate', ['pay'], {})], [{ op: 'exists', value: ref('nodes.pay') }]);
  assert.deepEqual(codes(flow({})), []);
  const tainted = validateWorkflow(flow({ label: 'untrusted:vendor' }), { registry });
  assert.ok(tainted.errors.some(e => e.code === 'LABEL_POLICY' && e.rule === 'UNTRUSTED_CONTROL' && e.path === 'workflow.write'), JSON.stringify(tainted.errors));
  // A correlation key computed from untrusted input decides which signal the wait takes: its outcome is tainted too.
  const keyed = base([payWait({ onTimeout: 'escalate' }), write(['pay']), echo('escalate', ['pay'], {})], [{ op: 'exists', value: ref('nodes.pay') }], { labels: { 'input.order': 'untrusted:web' } });
  assert.ok(validateWorkflow(keyed, { registry }).errors.some(e => e.rule === 'UNTRUSTED_CONTROL'));
});

test('wait.signal: a parked wait takes its correlated signal; its timer moves to now and a tick resumes the run', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const wf = base([payWait(), ship()], [{ op: 'gte', left: ref('nodes.ship.amount'), right: 0 }]);
  store.saveWorkflow(wf);
  const run = await runtime.execute(runtime.create(wf, { order: 'PO-1' }).id);
  assert.equal(run.status, 'waiting');
  const { wakeAt } = run.nodes.pay;
  assert.deepEqual(run.nodes.pay.subscriptions, [{ signal: 'payment.settled', key: 'PO-1', keyHash: digest('PO-1') }]);
  assert.deepEqual(store.timers(run.id), [{ runId: run.id, nodeKey: 'root/pay', wakeAt }]);
  assert.equal(events(store, run.id, 'node.started').find(e => e.nodeKey === 'root/pay').wakeAt, wakeAt, 'the timer and subscriptions are journaled when the wait starts');
  const delivered = runtime.deliverSignal(run.id, settled('pay-1', 'PO-1', 42));
  assert.deepEqual([delivered.consumedBy, delivered.duplicate], ['root/pay', false]);
  assert.deepEqual(store.timers(run.id), [{ runId: run.id, nodeKey: 'root/pay', wakeAt: delivered.receivedAt }], 'the timer is due now');
  assert.deepEqual((await runtime.tick()).runs, [{ runId: run.id, status: 'succeeded' }]);
  const done = store.run(run.id);
  assert.deepEqual(done.outputs.pay, { outcome: 'signal', signal: 'payment.settled', id: 'pay-1', key: 'PO-1', payload: { amount: 42 }, at: delivered.receivedAt });
  assert.equal(done.outputs.ship.amount, 42);
  assert.deepEqual(store.timers(run.id), []);
  assert.deepEqual(events(store, run.id, 'wait.resolved').map(e => [e.nodeKey, e.outcome, e.signalId, e.by, e.cancelled]), [['root/pay', 'signal', 'pay-1', 'delivery', ['timer']]]);
  assert.deepEqual(clean(store, run.id).checks.waits, { waits: 1, deliveries: 1, decisions: 1, mismatches: 0 });
});

test('wait.signal: correlation — another key stays buffered; per-item keys in a parallel map each take their own signal', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const wf = base([payWait(), ship()], [{ op: 'gte', left: ref('nodes.ship.amount'), right: 0 }]);
  store.saveWorkflow(wf);
  const run = await runtime.execute(runtime.create(wf, { order: 'PO-1' }).id);
  const { wakeAt } = run.nodes.pay;
  const miss = runtime.deliverSignal(run.id, settled('p-2', 'PO-2', 1));
  assert.equal(miss.consumedBy, null, 'a signal for another order is not this wait\'s');
  assert.deepEqual(store.timers(run.id).map(x => x.wakeAt), [wakeAt], 'a miss leaves the timer alone');
  assert.equal((await runtime.tick()).due, 0);
  const keyless = runtime.deliverSignal(run.id, { id: 'p-0', name: 'payment.settled', payload: { amount: 0 } });
  assert.equal(keyless.consumedBy, null, 'a correlated wait does not take a signal without its key');
  assert.equal(runtime.deliverSignal(run.id, settled('p-1', 'PO-1', 7)).consumedBy, 'root/pay');
  assert.deepEqual((await runtime.tick()).runs, [{ runId: run.id, status: 'succeeded' }]);
  const done = store.run(run.id);
  assert.equal(done.outputs.pay.id, 'p-1');
  assert.deepEqual(Object.entries(done.signals).map(([id, s]) => [s.seq, id, s.consumedBy]).sort((a, b) => a[0] - b[0]).map(([, id, by]) => [id, by]), [['p-2', null], ['p-0', null], ['p-1', 'root/pay']]);
  clean(store, run.id);

  const lines = base([{ id: 'lines', kind: 'map', needs: [], description: 'Wait for the goods receipt of each line', items: ref('input.lines'), maxItems: 4, concurrency: 4,
    body: { nodes: [{ id: 'receipt', kind: 'wait', needs: [], description: 'Wait for this line', signal: 'goods.received', correlate: ref('item'), schema: RECEIPT, timeoutMs: 300000 },
      echo('qty', ['receipt'], { line: ref('item'), qty: ref('nodes.receipt.payload.qty') })],
    acceptance: [{ op: 'eq', left: ref('nodes.qty.line'), right: ref('item') }] } }], [{ op: 'eq', left: ref('nodes.lines.count'), right: 3 }], { id: 'LinesProbe' });
  store.saveWorkflow(lines);
  const fan = await runtime.execute(runtime.create(lines, { lines: ['L1', 'L2', 'L3'] }).id);
  assert.equal(fan.status, 'waiting');
  assert.deepEqual(store.timers(fan.id).map(x => x.nodeKey).sort(), ['root/lines:0/receipt', 'root/lines:1/receipt', 'root/lines:2/receipt']);
  const took = [['g-3', 'L3', 30], ['g-1', 'L1', 10], ['g-2', 'L2', 20]].map(([id, key, qty]) => runtime.deliverSignal(fan.id, { id, name: 'goods.received', key, payload: { qty } }).consumedBy);
  assert.deepEqual(took, ['root/lines:2/receipt', 'root/lines:0/receipt', 'root/lines:1/receipt']);
  assert.deepEqual((await runtime.tick()).runs, [{ runId: fan.id, status: 'succeeded' }]);
  assert.deepEqual(store.run(fan.id).outputs.lines.items.map(item => [item.qty.line, item.qty.qty]), [['L1', 10], ['L2', 20], ['L3', 30]]);
  clean(store, fan.id);
});

test('wait.signal: without a run id, a signal goes to the one run whose parked wait correlates on its key', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const wf = base([payWait(), ship()], [{ op: 'gte', left: ref('nodes.ship.amount'), right: 0 }]);
  store.saveWorkflow(wf);
  const a = await runtime.execute(runtime.create(wf, { order: 'PO-A' }).id), b = await runtime.execute(runtime.create(wf, { order: 'PO-B' }).id);
  const scope = { workflowId: 'SignalProbe' };
  assert.throws(() => runtime.correlateSignal(settled('c-0', 'PO-B', 5)), { code: 'SIGNAL_SCOPE' }, 'a correlated signal names its workflow');
  const routed = runtime.correlateSignal(settled('c-1', 'PO-B', 5), scope);
  assert.deepEqual([routed.runId, routed.consumedBy, routed.correlated], [b.id, 'root/pay', true]);
  assert.equal(store.rows.header(a.id).signals, undefined, 'the other run got nothing');
  const again = runtime.correlateSignal(settled('c-1', 'PO-B', 5), scope);
  assert.deepEqual([again.runId, again.duplicate], [b.id, true], 'a repeated correlated delivery is answered as the first was');
  assert.throws(() => runtime.correlateSignal(settled('c-9', 'PO-Z', 5), scope), { code: 'SIGNAL_UNMATCHED' });
  assert.equal(store.signalRecord('c-9'), null, 'an unmatched correlated signal is not recorded anywhere');
  assert.throws(() => runtime.correlateSignal({ id: 'c-8', name: 'payment.settled', payload: { amount: 1 } }, scope), { code: 'SIGNAL_KEY_REQUIRED' });
  const twin = await runtime.execute(runtime.create(wf, { order: 'PO-A' }).id);
  assert.throws(() => runtime.correlateSignal(settled('c-2', 'PO-A', 5), scope), error => error.code === 'SIGNAL_AMBIGUOUS' && error.details.runIds.includes(twin.id) && error.details.runIds.includes(a.id));
  assert.deepEqual((await runtime.tick()).runs, [{ runId: b.id, status: 'succeeded' }]);
  clean(store, b.id);
});

test('wait.signal: race of two signals — the first delivered wins, the loser is cancelled and a late loser stays buffered', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const race = { id: 'pay', kind: 'wait', needs: [], description: 'Settled or failed, whichever comes first', timeoutMs: 300000,
    race: [{ signal: 'payment.settled', correlate: ref('input.order'), schema: PAYMENT }, { signal: 'payment.failed', correlate: ref('input.order'), schema: FAILURE }] };
  const wf = base([race, echo('route', ['pay'], { won: ref('nodes.pay.signal') })], [{ op: 'exists', value: ref('nodes.route.won') }], { id: 'RaceProbe' });
  store.saveWorkflow(wf);
  const run = await runtime.execute(runtime.create(wf, { order: 'PO-7' }).id);
  assert.equal(runtime.deliverSignal(run.id, { id: 'f-1', name: 'payment.failed', key: 'PO-7', payload: { reason: 'card declined' } }).consumedBy, 'root/pay');
  assert.equal(runtime.deliverSignal(run.id, settled('s-1', 'PO-7', 9)).consumedBy, null, 'the loser arrived late: kept, not consumed');
  assert.deepEqual((await runtime.tick()).runs, [{ runId: run.id, status: 'succeeded' }]);
  const done = store.run(run.id);
  assert.deepEqual([done.outputs.pay.signal, done.outputs.pay.payload, done.outputs.route.won], ['payment.failed', { reason: 'card declined' }, 'payment.failed']);
  assert.deepEqual(events(store, run.id, 'wait.resolved')[0].cancelled, ['payment.settled', 'timer']);
  clean(store, run.id);

  // Both raced signals arrive before the wait starts (out of order): the one delivered first wins when the wait opens.
  const gated = base([{ id: 'ok', kind: 'human', needs: [], description: 'Release the order', question: 'Release?', answerSchema: { type: 'boolean' } }, { ...race, needs: ['ok'] },
    echo('route', ['pay'], { won: ref('nodes.pay.signal') })], [{ op: 'exists', value: ref('nodes.route.won') }], { id: 'EarlyRace' });
  store.saveWorkflow(gated);
  const early = await runtime.execute(runtime.create(gated, { order: 'PO-8' }).id);
  assert.equal(early.status, 'awaiting_human');
  assert.equal(runtime.deliverSignal(early.id, settled('s-8', 'PO-8', 8)).consumedBy, null, 'no wait is open yet: buffered');
  assert.equal(runtime.deliverSignal(early.id, { id: 'f-8', name: 'payment.failed', key: 'PO-8', payload: { reason: 'late' } }).consumedBy, null);
  runtime.answer(early.id, 'root/ok', true);
  const resumed = await runtime.execute(early.id);
  assert.equal(resumed.status, 'succeeded', JSON.stringify(resumed.error));
  assert.deepEqual([resumed.outputs.pay.id, resumed.signals['s-8'].consumedBy, resumed.signals['f-8'].consumedBy], ['s-8', 'root/pay', null]);
  assert.deepEqual(events(store, early.id, 'wait.resolved').map(e => [e.by, e.signalId]), [['buffer', 's-8']]);
  assert.equal(events(store, early.id, 'node.waiting').filter(e => e.nodeKey === 'root/pay').length, 0, 'a buffered signal resolves the wait without parking');
  clean(store, early.id);
});

test('wait.signal: race of a signal and the timer — a signal received after the timer loses even before the tick runs', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const wf = base([payWait({ timeoutMs: 150, onTimeout: 'continue' }), echo('after', ['pay'], { outcome: ref('nodes.pay.outcome') })], [{ op: 'exists', value: ref('nodes.after.outcome') }]);
  store.saveWorkflow(wf);
  const run = await runtime.execute(runtime.create(wf, { order: 'PO-3' }).id);
  const wakeAt = await pastWake(store, run.id, 'root/pay');
  const late = runtime.deliverSignal(run.id, settled('late-1', 'PO-3', 3));
  assert.ok(late.receivedAt >= wakeAt);
  assert.equal(late.consumedBy, null, 'the timer had already won');
  assert.deepEqual((await runtime.tick()).runs, [{ runId: run.id, status: 'succeeded' }]);
  const done = store.run(run.id);
  assert.deepEqual(done.outputs.pay, { outcome: 'timeout', at: wakeAt });
  assert.equal(done.outputs.after.outcome, 'timeout');
  assert.equal(done.signals['late-1'].consumedBy, null);
  const [resolved] = events(store, run.id, 'wait.resolved');
  assert.deepEqual([resolved.outcome, resolved.by, resolved.cancelled], ['timeout', 'timer', ['payment.settled']]);
  assert.ok(resolved.at >= wakeAt, 'the timeout is decided at or after the timer');
  clean(store, run.id);
});

test('wait.signal: timeout routing — onTimeout names the branch; the other dependents are skipped, and the reverse on a signal', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  // The paid run's signal is delivered as soon as that run parks, before the late run executes: delivering it after both
  // raced the 150 ms timer on a loaded host (load 38, 2026-11-04), so the paid run timed out first, which is correct
  // engine behaviour and a wrong test. 1 s leaves the margin; pastWake still waits out the late run's timer.
  const wf = base([payWait({ timeoutMs: 1000, onTimeout: 'escalate' }), ship(), echo('escalate', ['pay'], { reason: 'no payment' }),
    echo('close', ['ship', 'escalate'], { outcome: ref('nodes.pay.outcome') }, { join: 'all_resolved' })], [{ op: 'exists', value: ref('nodes.close.outcome') }], { id: 'RouteProbe' });
  assert.deepEqual(codes(wf), []);
  store.saveWorkflow(wf);
  const paid = await runtime.execute(runtime.create(wf, { order: 'PO-P' }).id);
  runtime.deliverSignal(paid.id, settled('rp-1', 'PO-P', 11));
  const late = await runtime.execute(runtime.create(wf, { order: 'PO-L' }).id);
  await pastWake(store, late.id, 'root/pay');
  const ticked = await runtime.tick();
  assert.deepEqual(ticked.runs.map(r => r.status), ['succeeded', 'succeeded']);
  const a = store.run(paid.id), b = store.run(late.id);
  assert.deepEqual([a.nodes.ship.status, a.nodes.escalate.status, a.outputs.close.outcome], ['completed', 'skipped', 'signal']);
  assert.equal(a.nodes.escalate.reason, 'wait pay received payment.settled; its timeout branch does not run');
  assert.deepEqual([b.nodes.ship.status, b.nodes.escalate.status, b.outputs.close.outcome], ['skipped', 'completed', 'timeout']);
  assert.equal(b.nodes.ship.reason, 'wait pay timed out; its timeout branch escalate runs instead');
  clean(store, paid.id); clean(store, late.id);
});

test('wait.signal: onTimeout "fail" (the default) fails the wait with WAIT_TIMEOUT and clears its timer', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const wf = base([payWait({ timeoutMs: 120 }), ship()], [{ op: 'gte', left: ref('nodes.ship.amount'), right: 0 }]);
  store.saveWorkflow(wf);
  const run = await runtime.execute(runtime.create(wf, { order: 'PO-F' }).id);
  await pastWake(store, run.id, 'root/pay');
  assert.deepEqual((await runtime.tick()).runs.map(r => [r.status, r.error?.code]), [['failed', 'WAIT_TIMEOUT']]);
  const done = store.run(run.id);
  assert.deepEqual([done.nodes.pay.status, done.nodes.pay.error.code, done.nodes.ship], ['failed', 'WAIT_TIMEOUT', undefined], 'the failure stops the frame: ship never starts');
  assert.deepEqual([done.verdict.verdict, done.verdict.code], ['inconclusive', 'WAIT_TIMEOUT'], 'the awaited event did not come: no decision, not a harness fault');
  assert.deepEqual(store.timers(run.id), []);
  assert.throws(() => runtime.deliverSignal(run.id, settled('after-close', 'PO-F', 1)), { code: 'RUN_CLOSED' });
  clean(store, run.id);
});

test('wait.at: absolute timers — a past time completes at once, a time from the input parks until exactly then', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const timer = at => base([{ id: 'until', kind: 'wait', needs: [], description: 'Wait until a business time', at }, echo('after', ['until'], { at: ref('nodes.until.wakeAt') })],
    [{ op: 'exists', value: ref('nodes.after.at') }], { id: `At${typeof at === 'string' ? 'Literal' : 'Ref'}` });
  const past = timer('2026-01-02T03:04:05+01:00');
  store.saveWorkflow(past);
  const done = await runtime.execute(runtime.create(past, {}).id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(done.outputs.until, { wakeAt: Date.UTC(2026, 0, 2, 2, 4, 5) });
  const later = timer(ref('input.dueAt'));
  store.saveWorkflow(later);
  const dueAt = Date.now() + 200;
  const parked = await runtime.execute(runtime.create(later, { dueAt }).id);
  assert.deepEqual([parked.status, parked.nodes.until.wakeAt], ['waiting', dueAt]);
  assert.deepEqual(store.timers(parked.id).map(x => x.wakeAt), [dueAt]);
  await delay(Math.max(0, dueAt - Date.now()) + 20);
  assert.deepEqual((await runtime.tick()).runs, [{ runId: parked.id, status: 'succeeded' }]);
  assert.equal(store.run(parked.id).outputs.after.at, dueAt);
  const bad = await runtime.execute(runtime.create(later, { dueAt: '2026-02-30T00:00:00Z' }).id);
  assert.deepEqual([bad.status, bad.error.code], ['failed', 'WAIT_AT'], 'a computed time is checked when the wait starts');
  // A signal wait's timer can be absolute too.
  const deadline = base([payWait({ timeoutMs: undefined, at: ref('input.dueAt'), onTimeout: 'continue' }), echo('after', ['pay'], { o: ref('nodes.pay.outcome') })], [{ op: 'exists', value: ref('nodes.after.o') }], { id: 'AtSignal' });
  store.saveWorkflow(deadline);
  const signalAt = Date.now() + 300000, waiting = await runtime.execute(runtime.create(deadline, { order: 'PO-T', dueAt: signalAt }).id);
  assert.deepEqual([waiting.status, waiting.nodes.pay.wakeAt], ['waiting', signalAt]);
  // A timer after the run deadline could never be honoured (the run would stop on DEADLINE before any timeout branch): refused at start.
  const beyond = await runtime.execute(runtime.create(deadline, { order: 'PO-U', dueAt: Date.now() + 3 * 3600000 }).id);
  assert.deepEqual([beyond.status, beyond.error.code], ['failed', 'WAIT_DEADLINE']);
});

test('wait.signal: restart while waiting — a delivery and a tick in new processes finish the run; a dead owner\'s wait is taken over', async t => {
  const root = space(t), first = open(t, root);
  const wf = base([payWait(), ship()], [{ op: 'gte', left: ref('nodes.ship.amount'), right: 0 }]);
  first.store.saveWorkflow(wf);
  const run = await first.runtime.execute(first.runtime.create(wf, { order: 'PO-R' }).id);
  const other = await first.runtime.execute(first.runtime.create(wf, { order: 'PO-S' }).id);
  assert.equal(run.status, 'waiting');
  first.store.close();
  const foundry = args => {
    const child = spawnSync(process.execPath, [cli, ...args, '--workspace', root], { encoding: 'utf8', timeout: 20000, env: { PATH: process.env.PATH ?? '' } });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  };
  const delivered = foundry(['signal', run.id, '--name', 'payment.settled', '--id', 'cli-1', '--key', '"PO-R"', '--payload', '{"amount":3}']);
  assert.deepEqual([delivered.consumedBy, delivered.duplicate], ['root/pay', false]);
  assert.equal(foundry(['signal', run.id, '--name', 'payment.settled', '--id', 'cli-1', '--key', '"PO-R"', '--payload', '{"amount":3}']).duplicate, true);
  const correlated = foundry(['signal', '--workflow', 'SignalProbe', '--name', 'payment.settled', '--id', 'cli-2', '--key', '"PO-S"', '--payload', '{"amount":4}']);
  assert.deepEqual([correlated.runId, correlated.correlated], [other.id, true]);
  const ticked = foundry(['tick']);
  assert.deepEqual(ticked.runs.map(r => r.status), ['succeeded', 'succeeded']);
  const second = open(t, root);
  assert.equal(second.store.run(run.id).outputs.ship.amount, 3);
  assert.equal(second.store.run(other.id).outputs.ship.amount, 4);
  clean(second.store, run.id);

  // A process killed (SIGKILL) right after its wait took a buffered signal and before the wait completed: the decision and a due timer
  // survive, and the next tick completes the wait once, with the signal it took.
  const killed = second.runtime.create(wf, { order: 'PO-K' }, { extra: { crashAfterWaitDecision: 'root/pay' } });
  assert.equal(second.runtime.deliverSignal(killed.id, settled('kill-1', 'PO-K', 6)).consumedBy, null, 'the run has not started: buffered');
  second.store.close();
  const code = `
    import { Store } from ${JSON.stringify(new URL('../src/store.mjs', import.meta.url).href)};
    import { Runtime } from ${JSON.stringify(new URL('../src/runtime.mjs', import.meta.url).href)};
    import { createDefaultRegistry } from ${JSON.stringify(new URL('../src/capabilities.mjs', import.meta.url).href)};
    const store = new Store(${JSON.stringify(root)});
    await new Runtime(store, createDefaultRegistry(), {}, { faultHooks: true }).execute(${JSON.stringify(killed.id)});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { encoding: 'utf8', timeout: 20000, env: { PATH: process.env.PATH ?? '' } });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  const third = open(t, root), dead = third.store.run(killed.id);
  assert.deepEqual([dead.status, dead.nodes.pay.resolution.signalId, dead.signals['kill-1'].consumedBy], ['running', 'kill-1', 'root/pay']);
  assert.equal(third.store.dueTimers(Date.now()).filter(x => x.runId === killed.id).length, 1, 'a due timer survives the crash');
  assert.deepEqual((await third.runtime.tick()).runs, [{ runId: killed.id, status: 'succeeded' }]);
  assert.equal(third.store.run(killed.id).outputs.ship.amount, 6);
  assert.deepEqual(['wait.resolved', 'node.completed'].map(type => events(third.store, killed.id, type).filter(e => e.nodeKey === 'root/pay').length), [1, 1]);
  clean(third.store, killed.id);

  // The state a crash leaves after a delivery decided the wait: the run marked running under a dead owner. The next tick takes it over.
  const crashed = await third.runtime.execute(third.runtime.create(wf, { order: 'PO-C' }).id);
  third.runtime.deliverSignal(crashed.id, settled('crash-1', 'PO-C', 5));
  third.store.updateRun(crashed.id, r => { r.status = 'running'; r.owner = { token: 'lost', pid: 2 ** 22 + 4321, processStart: null, acquiredAt: Date.now() }; }, { type: 'test.simulated-crash' });
  assert.deepEqual((await third.runtime.tick()).runs, [{ runId: crashed.id, status: 'succeeded' }]);
  assert.equal(events(third.store, crashed.id, 'node.completed').filter(e => e.nodeKey === 'root/pay').length, 1);
  clean(third.store, crashed.id);
});

test('wait.signal: duplicates are idempotent by id; a reused id with other content or for another run is refused; bad deliveries write nothing', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const wf = base([payWait(), ship()], [{ op: 'gte', left: ref('nodes.ship.amount'), right: 0 }]);
  store.saveWorkflow(wf);
  const run = await runtime.execute(runtime.create(wf, { order: 'PO-D' }).id), other = await runtime.execute(runtime.create(wf, { order: 'PO-E' }).id);
  const first = runtime.deliverSignal(run.id, settled('dup-1', 'PO-D', 1));
  const before = store.events(run.id).length;
  const again = runtime.deliverSignal(run.id, settled('dup-1', 'PO-D', 1));
  assert.deepEqual(again, { ...first, duplicate: true });
  assert.equal(store.events(run.id).length, before, 'a duplicate appends nothing');
  assert.throws(() => runtime.deliverSignal(run.id, settled('dup-1', 'PO-D', 2)), { code: 'SIGNAL_CONFLICT' });
  assert.throws(() => runtime.deliverSignal(other.id, settled('dup-1', 'PO-E', 1)), { code: 'SIGNAL_CONFLICT' });
  const refused = [
    [{ id: 'x-1', name: 'payment.refunded', key: 'PO-E', payload: { amount: 1 } }, 'SIGNAL_UNDECLARED'],
    [{ id: 'x-2', name: 'payment.settled', key: 'PO-E', payload: { amount: 'one' } }, 'SCHEMA_MISMATCH'],
    [{ id: 'x 3', name: 'payment.settled', key: 'PO-E', payload: { amount: 1 } }, 'SIGNAL_ID'],
    [{ id: '__proto__', name: 'payment.settled', key: 'PO-E', payload: { amount: 1 } }, 'SIGNAL_ID'],
    [{ id: 'x-4', name: '9bad', key: 'PO-E' }, 'SIGNAL_NAME'],
    [{ id: 'x-5', name: 'payment.settled', key: 'PO-E', payload: { amount: 1 }, at: 0 }, 'SIGNAL_SHAPE'],
    [{ id: 'x-6', name: 'payment.settled', key: 'x'.repeat(5000), payload: { amount: 1 } }, 'SIGNAL_KEY']
  ];
  const head = store.events(other.id).length;
  for (const [signal, code] of refused) assert.throws(() => runtime.deliverSignal(other.id, signal), { code }, code);
  assert.equal(store.events(other.id).length, head);
  assert.equal(store.rows.header(other.id).signals, undefined);
  // A signal with no declared payload schema carries none.
  const bare = base([{ id: 'ping', kind: 'wait', needs: [], description: 'Wait for a ping', signal: 'ping', timeoutMs: 60000 }, echo('after', ['ping'], { id: ref('nodes.ping.id') })],
    [{ op: 'exists', value: ref('nodes.after.id') }], { id: 'PingProbe' });
  store.saveWorkflow(bare);
  const ping = await runtime.execute(runtime.create(bare, {}).id);
  assert.throws(() => runtime.deliverSignal(ping.id, { id: 'pg-0', name: 'ping', payload: { x: 1 } }), { code: 'SIGNAL_PAYLOAD' });
  assert.equal(runtime.deliverSignal(ping.id, { id: 'pg-1', name: 'ping', key: 'anything' }).consumedBy, 'root/ping', 'a wait without correlate takes any key');
});

test('wait.signal: late signals — after the run closed (succeeded or cancelled) a delivery is refused', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const wf = base([payWait(), ship()], [{ op: 'gte', left: ref('nodes.ship.amount'), right: 0 }]);
  store.saveWorkflow(wf);
  const run = await runtime.execute(runtime.create(wf, { order: 'PO-X' }).id);
  runtime.deliverSignal(run.id, settled('lx-1', 'PO-X', 1));
  await runtime.tick();
  assert.equal(store.run(run.id).status, 'succeeded');
  assert.throws(() => runtime.deliverSignal(run.id, settled('lx-2', 'PO-X', 1)), { code: 'RUN_CLOSED' });
  const parked = await runtime.execute(runtime.create(wf, { order: 'PO-Y' }).id);
  assert.equal(runtime.closeCancelled(parked.id, { actor: 'test' }).status, 'cancelled');
  assert.deepEqual(store.timers(parked.id), []);
  assert.throws(() => runtime.deliverSignal(parked.id, settled('ly-1', 'PO-Y', 1)), { code: 'RUN_CLOSED' });
  assert.throws(() => runtime.correlateSignal(settled('ly-2', 'PO-Y', 1), { workflowId: 'SignalProbe' }), { code: 'SIGNAL_UNMATCHED' }, 'a closed run\'s wait is not found by correlation');
});

test('wait.signal: replay — every decision is re-derived from the chain; edits to the record or to the rule\'s inputs are caught', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const wf = base([payWait({ onTimeout: 'continue' }), echo('after', ['pay'], { o: ref('nodes.pay.outcome') })], [{ op: 'exists', value: ref('nodes.after.o') }]);
  store.saveWorkflow(wf);
  // A consumed signal marked unconsumed in the record: resume refuses, verify-run reports it.
  const edited = await runtime.execute(runtime.create(wf, { order: 'PO-1' }).id);
  runtime.deliverSignal(edited.id, settled('e-1', 'PO-1', 1));
  store.updateRun(edited.id, r => { r.signals = { ...r.signals, 'e-1': { ...r.signals['e-1'], consumedBy: null } }; }, { type: 'test.edit' });
  await assert.rejects(runtime.execute(edited.id), { code: 'CHECKPOINT_TAMPERED' });
  assert.ok(verifyRun(store, edited.id).findings.some(f => f.code === 'SIGNAL_EDITED'));
  // A planted decision (the wait "took" a signal nobody delivered).
  const planted = await runtime.execute(runtime.create(wf, { order: 'PO-2' }).id);
  store.updateRun(planted.id, r => { r.nodes.pay = { ...r.nodes.pay, resolution: { outcome: 'signal', signalId: 'ghost', signal: 'payment.settled', receivedAt: Date.now(), by: 'delivery' } }; }, { type: 'test.edit' });
  await assert.rejects(runtime.execute(planted.id), { code: 'CHECKPOINT_TAMPERED' });
  // The rule's inputs edited (the wait's timer moved earlier than the one journaled when it started; a subscription re-keyed to another
  // order): resume refuses the record before the wait decides anything, and verify-run reports it.
  const moved = await runtime.execute(runtime.create(wf, { order: 'PO-3' }).id), early = Date.now() - 1;
  store.updateRun(moved.id, r => { r.nodes.pay = { ...r.nodes.pay, wakeAt: early }; store.setTimer(r.id, 'root/pay', early); }, { type: 'test.clock-edited' });
  const ticked = await runtime.tick();
  assert.equal(ticked.runs.find(r => r.runId === moved.id).error.code, 'CHECKPOINT_TAMPERED');
  assert.equal(ticked.runs.find(r => r.runId === edited.id).error.code, 'CHECKPOINT_TAMPERED', 'the edited run stays refused at every tick');
  assert.ok(verifyRun(store, moved.id).findings.some(f => f.code === 'SIGNAL_EDITED' && /inputs of wait root\/pay/.test(f.message)));
  const rekeyed = await runtime.execute(runtime.create(wf, { order: 'PO-4' }).id);
  store.updateRun(rekeyed.id, r => { r.nodes.pay = { ...r.nodes.pay, subscriptions: [{ signal: 'payment.settled', key: 'PO-5', keyHash: digest('PO-5') }] }; }, { type: 'test.edit' });
  runtime.deliverSignal(rekeyed.id, settled('rk-1', 'PO-5', 500));
  await assert.rejects(runtime.execute(rekeyed.id), { code: 'CHECKPOINT_TAMPERED' }, 'the wait never completes with the signal its edit let it take');
  assert.equal(store.run(rekeyed.id).nodes.after, undefined);
  assert.ok(verifyRun(store, rekeyed.id).findings.some(f => f.code === 'SIGNAL_EDITED'));

  // The rule itself, on synthetic chains: each kind of departure from it is named.
  const start = { seq: 1, type: 'node.started', nodeKey: 'root/w', wakeAt: 1000, subscriptions: [{ signal: 'a', keyHash: null }, { signal: 'b', keyHash: null }] };
  const deliver = (seq, signalId, name, receivedAt, consumedBy = null) => ({ seq, type: 'signal.delivered', signalId, name, keyHash: digest(null), payloadHash: digest(null), receivedAt, consumedBy });
  const rules = chain => replayWaits(chain).mismatches.map(m => m.code);
  const parked = { seq: 2, type: 'node.waiting', nodeKey: 'root/w', wakeAt: 1000 };
  assert.deepEqual(rules([start, parked, deliver(3, 's1', 'a', 10, 'root/w'), { seq: 4, type: 'wait.resolved', nodeKey: 'root/w', outcome: 'signal', signalId: 's1', signal: 'a', by: 'delivery', cancelled: ['b', 'timer'] }]), []);
  assert.deepEqual(rules([start, parked, deliver(3, 's1', 'a', 10)]), ['WAIT_CLAIM'], 'a delivery a parked wait should have taken');
  assert.deepEqual(rules([start, parked, deliver(3, 's1', 'a', 2000)]), [], 'after the timer, no wait takes it');
  assert.deepEqual(rules([start, deliver(2, 's1', 'a', 10), deliver(3, 's2', 'b', 20), { seq: 4, type: 'wait.resolved', nodeKey: 'root/w', outcome: 'signal', signalId: 's2', signal: 'b', by: 'buffer', cancelled: ['a', 'timer'] }]), ['WAIT_PICK'], 'the first delivered wins');
  assert.deepEqual(rules([start, deliver(2, 's1', 'a', 10), { seq: 3, type: 'node.waiting', nodeKey: 'root/w', wakeAt: 1000 }]), ['WAIT_MISSED']);
  assert.deepEqual(rules([start, parked, { seq: 3, at: 999, type: 'wait.resolved', nodeKey: 'root/w', outcome: 'timeout', by: 'timer', cancelled: ['a', 'b'] }]), ['WAIT_TIMEOUT_EARLY']);
  assert.deepEqual(rules([start, deliver(2, 's1', 'a', 10), { seq: 3, at: 1000, type: 'wait.resolved', nodeKey: 'root/w', outcome: 'timeout', by: 'timer', cancelled: ['a', 'b'] }]), ['WAIT_TIMEOUT_EARLY'], 'a timeout while a signal waited');
  assert.deepEqual(rules([start, parked, { seq: 3, at: 1000, type: 'wait.resolved', nodeKey: 'root/w', outcome: 'timeout', by: 'timer', cancelled: ['a'] }]), ['WAIT_CANCELLED']);
  const second = { ...start, seq: 5, nodeKey: 'root/v' };
  assert.deepEqual(rules([start, deliver(2, 's1', 'a', 10), { seq: 3, type: 'wait.resolved', nodeKey: 'root/w', outcome: 'signal', signalId: 's1', signal: 'a', by: 'buffer', cancelled: ['b', 'timer'] },
    second, { seq: 6, type: 'wait.resolved', nodeKey: 'root/v', outcome: 'signal', signalId: 's1', signal: 'a', by: 'buffer', cancelled: ['b', 'timer'] }]), ['WAIT_PICK', 'SIGNAL_DOUBLE']);
  assert.deepEqual(rules([start, deliver(2, 's1', 'a', 10), { seq: 3, type: 'wait.resolved', nodeKey: 'root/w', outcome: 'signal', signalId: 's1', signal: 'a', by: 'buffer', cancelled: ['b', 'timer'] },
    { seq: 4, type: 'node.completed', nodeKey: 'root/w', output: { outcome: 'signal', signal: 'a', id: 's1', key: null, payload: { forged: true }, at: 10 } }]), ['WAIT_OUTPUT']);
});

test('wait.signal: HTTP — a token-authenticated delivery resumes the run; correlation works without a run id', async t => {
  const root = space(t), foundry = new Foundry(root);
  const server = await serveHttp(foundry, { port: 0, tickIntervalMs: 0 });
  t.after(async () => { await server.close(); await foundry.close(); });
  foundry.save(base([payWait(), ship()], [{ op: 'gte', left: ref('nodes.ship.amount'), right: 0 }], { id: 'HttpSignal' }));
  const run = foundry.createRun('HttpSignal', { order: 'PO-H' }), other = foundry.createRun('HttpSignal', { order: 'PO-I' });
  assert.equal((await foundry.startRun(run.id)).status, 'waiting');
  assert.equal((await foundry.startRun(other.id)).status, 'waiting');
  const token = (await (await fetch(`${server.origin}/`)).text()).match(/__FOUNDRY_TOKEN__="([0-9a-f]+)"/)[1];
  const post = async (url, body, headers = { 'x-foundry-token': token }) => {
    const response = await fetch(`${server.origin}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const unsigned = await post(`/api/runs/${run.id}/signals`, settled('h-0', 'PO-H', 1), {});
  assert.deepEqual([unsigned.status, unsigned.body.error.code], [403, 'HTTP_TOKEN'], 'a signal needs the local token, as an answer does');
  const sent = await post(`/api/runs/${run.id}/signals`, settled('h-1', 'PO-H', 12));
  assert.deepEqual([sent.status, sent.body.consumedBy], [202, 'root/pay']);
  await until(() => foundry.store.run(run.id).status === 'succeeded');
  assert.equal(foundry.store.run(run.id).outputs.ship.amount, 12);
  assert.equal((await post('/api/signals', settled('h-2', 'PO-I', 13))).body.error.code, 'SIGNAL_SCOPE', 'a correlated signal names its workflow');
  const routed = await post('/api/signals', { workflowId: 'HttpSignal', ...settled('h-2', 'PO-I', 13) });
  assert.deepEqual([routed.status, routed.body.runId, routed.body.correlated], [202, other.id, true]);
  await until(() => foundry.store.run(other.id).status === 'succeeded');
  assert.deepEqual([(await post('/api/signals', { workflowId: 'HttpSignal', ...settled('h-3', 'PO-Z', 1) })).status, (await post(`/api/runs/${run.id}/signals`, settled('h-1', 'PO-H', 99))).status], [409, 409]);
  clean(foundry.store, run.id); clean(foundry.store, other.id);
});

test('wait.signal: a labelled wait carries its label into its output at run time', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const wf = base([payWait({ label: 'untrusted:vendor' }), ship()], [{ op: 'gte', left: ref('nodes.ship.amount'), right: 0 }], { id: 'LabelProbe' });
  store.saveWorkflow(wf);
  const run = await runtime.execute(runtime.create(wf, { order: 'PO-L' }).id);
  runtime.deliverSignal(run.id, settled('lb-1', 'PO-L', 2));
  await runtime.tick();
  const done = store.run(run.id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual([done.nodes.pay.outputLabel, done.nodes.ship.outputLabel], ['untrusted:vendor', 'untrusted:vendor']);
});

// Review of step 2 (E3 `wait-signal`): regression tests for the findings fixed (ENGINE-FREEZE §7.2, review fixes).
const cliIn = (root, args, cwd = undefined) => {
  const child = spawnSync(process.execPath, [cli, ...args, '--workspace', root], { encoding: 'utf8', timeout: 20000, env: { PATH: process.env.PATH ?? '' }, ...(cwd ? { cwd } : {}) });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
};
// A child process that dies (SIGKILL) right after a signal wait's node.started committed, before the wait parked or decided.
const crashAtWaitStart = (root, runId) => spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { Store } from ${JSON.stringify(new URL('../src/store.mjs', import.meta.url).href)};
    import { Runtime } from ${JSON.stringify(new URL('../src/runtime.mjs', import.meta.url).href)};
    import { createDefaultRegistry } from ${JSON.stringify(new URL('../src/capabilities.mjs', import.meta.url).href)};
    const original = Store.prototype.updateRun;
    Store.prototype.updateRun = function (...args) {
      const out = original.apply(this, args), tail = this.events(args[0]).at(-1);
      if (tail.type === 'node.started' && Array.isArray(tail.subscriptions)) process.kill(process.pid, 'SIGKILL');
      return out;
    };
    await new Runtime(new Store(${JSON.stringify(root)}), createDefaultRegistry()).execute(${JSON.stringify(runId)});`], { encoding: 'utf8', timeout: 20000, env: { PATH: process.env.PATH ?? '' } });

test('wait.signal: correlation is scoped to one workflow — another workflow waiting on the same name and key neither takes nor blocks the signal', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const gate = { id: 'ok', kind: 'human', needs: [], description: 'Release the order', question: 'Release?', answerSchema: { type: 'boolean' } };
  const legit = base([gate, payWait({ needs: ['ok'] }), ship()], [{ op: 'gte', left: ref('nodes.ship.amount'), right: 0 }], { id: 'Legit' });
  // Any other workflow saved into the workspace (a model can save and run one over MCP) can wait on the same signal name and key.
  const listener = base([{ id: 'grab', kind: 'wait', needs: [], description: 'Listen', signal: 'payment.settled', correlate: ref('input.order'), schema: { type: 'object', additionalProperties: true }, timeoutMs: 300000 },
    echo('leak', ['grab'], { got: ref('nodes.grab.payload') })], [{ op: 'exists', value: ref('nodes.leak.got') }], { id: 'Listener' });
  assert.deepEqual(codes(listener), []);
  store.saveWorkflow(legit); store.saveWorkflow(listener);
  const a = await runtime.execute(runtime.create(legit, { order: 'PO-77' }).id), b = await runtime.execute(runtime.create(listener, { order: 'PO-77' }).id);
  assert.deepEqual([a.status, b.status], ['awaiting_human', 'waiting']);
  // The legit run has not reached its wait yet: the payment is not routed to the listener (before the fix it was, and a retry of the
  // same id was then answered as the listener's duplicate), and nothing is recorded.
  assert.throws(() => runtime.correlateSignal(settled('evt-1', 'PO-77', 1234.5), { workflowId: 'Legit' }), { code: 'SIGNAL_UNMATCHED' });
  assert.equal(store.rows.header(b.id).signals, undefined, 'the listener took nothing');
  assert.equal(store.signalRecord('evt-1'), null);
  // Once it waits, the payment goes to it: the listener's wait on the same name and key makes it neither ambiguous nor refused.
  runtime.answer(a.id, 'root/ok', true);
  assert.equal((await runtime.execute(a.id)).status, 'waiting');
  const routed = runtime.correlateSignal(settled('evt-1', 'PO-77', 1234.5), { workflowId: 'Legit' });
  assert.deepEqual([routed.runId, routed.consumedBy, routed.correlated], [a.id, 'root/pay', true]);
  // An id another workflow's run took is not answered as a duplicate here, and a by-id delivery can be held to a workflow too.
  runtime.deliverSignal(b.id, settled('evt-2', 'PO-77', 1));
  assert.throws(() => runtime.correlateSignal(settled('evt-2', 'PO-77', 1), { workflowId: 'Legit' }), { code: 'SIGNAL_CONFLICT' });
  assert.throws(() => runtime.deliverSignal(b.id, settled('evt-3', 'PO-77', 1), { workflowId: 'Legit' }), { code: 'SIGNAL_SCOPE' });
  await runtime.tick();
  assert.deepEqual([store.run(a.id).status, store.run(a.id).outputs.ship.amount], ['succeeded', 1234.5]);
  clean(store, a.id);

  // A wait whose timer has run out (the tick has not come yet) takes nothing, so it is no claimant and does not make a live wait ambiguous.
  const dated = base([payWait({ timeoutMs: undefined, at: ref('input.dueAt'), onTimeout: 'continue' }), echo('after', ['pay'], { o: ref('nodes.pay.outcome') })],
    [{ op: 'exists', value: ref('nodes.after.o') }], { id: 'Dated' });
  store.saveWorkflow(dated);
  const overdue = await runtime.execute(runtime.create(dated, { order: 'PO-9', dueAt: Date.now() + 150 }).id);
  const live = await runtime.execute(runtime.create(dated, { order: 'PO-9', dueAt: Date.now() + 300000 }).id);
  await pastWake(store, overdue.id, 'root/pay');
  assert.deepEqual(Object.values(runtime.correlateSignal(settled('d-1', 'PO-9', 9), { workflowId: 'Dated' })).slice(0, 1), [live.id]);

  // Runs are counted, not waits: two runs with 65 matching waits each are ambiguous (a 64-row limit on waits used to hide the second run).
  const many = base(Array.from({ length: 65 }, (_, i) => payWait({ id: `w${i}` })), [{ op: 'exists', value: ref('nodes.w0') }], { id: 'Many' });
  store.saveWorkflow(many);
  const m1 = await runtime.execute(runtime.create(many, { order: 'PO-M' }).id), m2 = await runtime.execute(runtime.create(many, { order: 'PO-M' }).id);
  assert.deepEqual([m1.status, m2.status], ['waiting', 'waiting']);
  assert.throws(() => runtime.correlateSignal(settled('m-1', 'PO-M', 1), { workflowId: 'Many' }), error => error.code === 'SIGNAL_AMBIGUOUS' && error.details.runIds.length === 2);
});

test('wait.signal: a signal id is delivered to a run once, whatever the workspace index says; a wait completes with the delivery its decision names', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const wf = base([payWait(), ship()], [{ op: 'gte', left: ref('nodes.ship.amount'), right: 0 }]);
  store.saveWorkflow(wf);
  const run = await runtime.execute(runtime.create(wf, { order: 'PO-1' }).id);
  const first = runtime.deliverSignal(run.id, settled('pay-1', 'PO-1', 10));
  assert.equal(first.consumedBy, 'root/pay');
  const head = store.events(run.id).length;
  // The workspace index (table `signals`, which no chain binds) loses the id: the run's own inbox still refuses the id with other content.
  store.db.prepare('DELETE FROM signals WHERE id=?').run('pay-1');
  assert.throws(() => runtime.deliverSignal(run.id, settled('pay-1', 'PO-1', 1000000)), { code: 'SIGNAL_CONFLICT' });
  assert.deepEqual(runtime.deliverSignal(run.id, settled('pay-1', 'PO-1', 10)), { ...first, duplicate: true });
  assert.equal(store.events(run.id).length, head, 'nothing was appended');
  assert.deepEqual((await runtime.tick()).runs, [{ runId: run.id, status: 'succeeded' }]);
  assert.equal(store.run(run.id).outputs.ship.amount, 10, 'before the fix, the redelivered 1000000 shipped and verify-run said ok');
  assert.equal(events(store, run.id, 'wait.resolved')[0].deliverySeq, events(store, run.id, 'signal.delivered')[0].seq, 'the decision names its delivery event');
  clean(store, run.id);

  // The inbox entry edited away as well: the chain still holds the delivery.
  const stripped = await runtime.execute(runtime.create(wf, { order: 'PO-2' }).id);
  runtime.deliverSignal(stripped.id, settled('pay-2', 'PO-2', 20));
  store.db.prepare('DELETE FROM signals WHERE id=?').run('pay-2');
  store.updateRun(stripped.id, r => { const { 'pay-2': _, ...rest } = r.signals; r.signals = rest; }, { type: 'test.edit' });
  assert.throws(() => runtime.deliverSignal(stripped.id, settled('pay-2', 'PO-2', 999)), { code: 'SIGNAL_CONFLICT' });
  await assert.rejects(runtime.execute(stripped.id), { code: 'CHECKPOINT_TAMPERED' });

  // A second delivery of one id forced into the chain: resume refuses the run, and verify-run names it twice over.
  const forged = await runtime.execute(runtime.create(wf, { order: 'PO-3' }).id);
  runtime.deliverSignal(forged.id, settled('pay-3', 'PO-3', 30));
  const payload = { amount: 3e6 };
  store.updateRun(forged.id, () => {}, { type: 'signal.delivered', signalId: 'pay-3', name: 'payment.settled', key: 'PO-3', keyHash: digest('PO-3'), payloadHash: digest(payload), payload, receivedAt: Date.now(), actor: 'test', consumedBy: null });
  await assert.rejects(runtime.execute(forged.id), { code: 'CHECKPOINT_TAMPERED' });
  const report = verifyRun(store, forged.id);
  assert.ok(report.findings.some(f => f.code === 'WAIT_REPLAY_MISMATCH' && f.rule === 'SIGNAL_REDELIVERED'), JSON.stringify(report.findings));
  assert.ok(report.findings.some(f => f.code === 'SIGNAL_EDITED' && /delivered twice/.test(f.message)));

  // The rule on synthetic chains: the output is checked against the delivery the decision names, and a wait that ends undecided is named.
  const start = { seq: 1, type: 'node.started', nodeKey: 'root/w', kind: 'wait', wakeAt: 1000, subscriptions: [{ signal: 'a', keyHash: null }] };
  const parked = { seq: 2, type: 'node.waiting', nodeKey: 'root/w', wakeAt: 1000 };
  const deliver = (seq, body, consumedBy = null) => ({ seq, type: 'signal.delivered', signalId: 's1', name: 'a', keyHash: digest(null), payloadHash: digest(body), payload: body, receivedAt: 10, consumedBy });
  const out = body => ({ type: 'node.completed', nodeKey: 'root/w', output: { outcome: 'signal', signal: 'a', id: 's1', key: null, payload: body, at: 10 } });
  const decided = { seq: 4, type: 'wait.resolved', nodeKey: 'root/w', outcome: 'signal', signalId: 's1', deliverySeq: 3, signal: 'a', by: 'delivery', cancelled: ['timer'] };
  const rules = chain => replayWaits(chain).mismatches.map(m => m.code);
  assert.deepEqual(rules([start, parked, deliver(3, { v: 1 }, 'root/w'), decided, { seq: 5, ...out({ v: 1 }) }]), []);
  assert.deepEqual(rules([start, parked, deliver(3, { v: 1 }, 'root/w'), decided, deliver(5, { v: 999 }), { seq: 6, ...out({ v: 999 }) }]), ['SIGNAL_REDELIVERED', 'WAIT_OUTPUT']);
  assert.deepEqual(rules([start, parked, deliver(3, { v: 1 }, 'root/w'), { ...decided, deliverySeq: 2 }]), ['WAIT_CLAIM', 'WAIT_PICK'], 'a decision naming another event as its delivery');
  assert.deepEqual(rules([start, deliver(2, { v: 1 }), { seq: 3, ...out({ v: 1 }) }]), ['WAIT_UNDECIDED'], 'completed with no decision');
  assert.deepEqual(rules([start, parked, { seq: 3, type: 'node.failed', nodeKey: 'root/w', error: { code: 'WAIT_TIMEOUT' } }]), ['WAIT_UNDECIDED'], 'timed out with no decision');
  assert.deepEqual(rules([start, parked, { seq: 3, type: 'node.failed', nodeKey: 'root/w', error: { code: 'MAP_ITEM_FAILED' }, abandoned: true }, deliver(4, { v: 1 })]), [], 'a settled wait claims nothing');
});

test('wait.signal: a wait parked in a map item that failed (collect) is settled with its item, so the live wait takes the signal', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const body = { nodes: [
    { id: 'w', kind: 'wait', needs: [], description: 'Wait for go', signal: 'go', timeoutMs: 300000 },
    { id: 'boom', kind: 'assert', needs: [], description: 'Fail item 0 while its wait is parked', checks: [{ op: 'ne', left: ref('index'), right: 0 }] },
    echo('after', ['w', 'boom'], { i: ref('index') })
  ], acceptance: [{ op: 'exists', value: ref('nodes.after.i') }] };
  const wf = base([{ id: 'm', kind: 'map', needs: [], description: 'Items', items: ref('input.items'), maxItems: 4, concurrency: 1, failure: 'collect', body }],
    [{ op: 'gte', left: ref('nodes.m.count'), right: 0 }], { id: 'Orphan' });
  store.saveWorkflow(wf);
  const run = await runtime.execute(runtime.create(wf, { items: ['a', 'b'] }).id);
  assert.equal(run.status, 'waiting');
  const settledWait = run.frames['root/m:0'].nodes.w;
  assert.deepEqual([settledWait.status, settledWait.error.code, run.frames['root/m:1'].nodes.w.status], ['failed', 'MAP_ITEM_FAILED', 'waiting']);
  assert.deepEqual(store.timers(run.id).map(x => x.nodeKey), ['root/m:1/w'], 'the settled wait keeps no timer');
  assert.equal(runtime.deliverSignal(run.id, { id: 'go-1', name: 'go' }).consumedBy, 'root/m:1/w', 'before the fix the failed item\'s wait took it');
  assert.deepEqual((await runtime.tick()).runs, [{ runId: run.id, status: 'succeeded' }]);
  const done = store.run(run.id);
  assert.deepEqual([done.outputs.m.failed, done.outputs.m.items[1].after.i], [1, 1]);
  clean(store, run.id);
});

test('wait.signal: a wait whose owner died before it parked is resumed by a delivery (by id and by correlation); fault hooks need the runtime option', async t => {
  const root = space(t), first = open(t, root);
  const wf = base([payWait(), ship()], [{ op: 'gte', left: ref('nodes.ship.amount'), right: 0 }]);
  first.store.saveWorkflow(wf);
  const byId = first.runtime.create(wf, { order: 'PO-I' }), byKey = first.runtime.create(wf, { order: 'PO-K' });
  const hooked = first.runtime.create(wf, { order: 'PO-H' }, { extra: { crashAfterWaitDecision: 'root/pay' } });
  first.runtime.deliverSignal(hooked.id, settled('h-1', 'PO-H', 7));
  first.store.close();
  for (const id of [byId.id, byKey.id]) assert.equal(crashAtWaitStart(root, id).signal, 'SIGKILL');
  // A record edit cannot make a host kill itself: the run's fault hook is ignored by a runtime not built with faultHooks.
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { Store } from ${JSON.stringify(new URL('../src/store.mjs', import.meta.url).href)};
    import { Runtime } from ${JSON.stringify(new URL('../src/runtime.mjs', import.meta.url).href)};
    import { createDefaultRegistry } from ${JSON.stringify(new URL('../src/capabilities.mjs', import.meta.url).href)};
    const run = await new Runtime(new Store(${JSON.stringify(root)}), createDefaultRegistry()).execute(${JSON.stringify(hooked.id)});
    console.log(run.status);`], { encoding: 'utf8', timeout: 20000, env: { PATH: process.env.PATH ?? '' } });
  assert.deepEqual([child.signal, child.status, child.stdout.trim()], [null, 0, 'succeeded'], child.stderr);
  const { store, runtime } = open(t, root);
  for (const id of [byId.id, byKey.id]) {
    const dead = store.run(id);
    assert.deepEqual([dead.status, dead.nodes.pay.status, store.timers(id)[0].wakeAt > Date.now() + 200000], ['running', 'running', true], 'the timer is the full timeout away');
  }
  const delivered = runtime.deliverSignal(byId.id, settled('i-1', 'PO-I', 6));
  assert.deepEqual([delivered.consumedBy, delivered.resumes], [null, ['root/pay']], 'buffered, and the stranded wait is due now');
  const correlated = runtime.correlateSignal(settled('k-1', 'PO-K', 8), { workflowId: 'SignalProbe' });
  assert.deepEqual([correlated.runId, correlated.resumes], [byKey.id, ['root/pay']], 'correlation finds a stranded wait too');
  const ticked = await runtime.tick();
  assert.deepEqual(ticked.runs.map(r => r.status), ['succeeded', 'succeeded']);
  assert.deepEqual([store.run(byId.id).outputs.ship.amount, store.run(byKey.id).outputs.ship.amount], [6, 8]);
  clean(store, byId.id); clean(store, byKey.id);
});

test('wait.signal: review P2s — taint of a wait\'s timer and keys, the deadline tie, WAIT_DEADLINE verdict, CLI --key is JSON only', async t => {
  // In a collect map a wait that fails over an untrusted `at` (or key) decides whether the rest of its item runs, in every timeout mode.
  const write = needs => ({ id: 'write', kind: 'task', needs, description: 'Write', tool: 'core.artifact', args: { name: 'x.txt', content: 'x' }, timeoutMs: 1000, retry: { maxAttempts: 1 } });
  const inMap = waitNode => base([{ id: 'm', kind: 'map', needs: [], description: 'Items', items: ref('input.items'), maxItems: 4, concurrency: 1, failure: 'collect',
    body: { nodes: [waitNode, write(['w'])], acceptance: [{ op: 'exists', value: ref('nodes.write') }] } }], [{ op: 'gte', left: ref('nodes.m.count'), right: 0 }], { labels: { 'input.due': 'untrusted:web' } });
  for (const node of [{ id: 'w', kind: 'wait', needs: [], description: 'Until', at: ref('input.due') },
    { id: 'w', kind: 'wait', needs: [], description: 'Signal', signal: 'go', at: ref('input.due'), onTimeout: 'continue' }])
    assert.ok(codes(inMap(node)).includes('UNTRUSTED_CONTROL'), node.description);
  assert.deepEqual(codes(inMap({ id: 'w', kind: 'wait', needs: [], description: 'Until', at: '2026-10-14T10:00:00Z' })), [], 'a literal time decides nothing');

  const root = space(t), { store, runtime } = open(t, root);
  // A timer exactly at the run deadline could not be honoured either (the resume stops on DEADLINE): refused when the wait starts.
  const boundary = base([{ id: 'ok', kind: 'human', needs: [], description: 'When', question: 'Deadline?', answerSchema: { type: 'integer', minimum: 0 } },
    payWait({ needs: ['ok'], timeoutMs: undefined, at: ref('nodes.ok.answer'), onTimeout: 'escalate' }), echo('ship', ['pay'], { a: 1 }), echo('escalate', ['pay'], { why: 'late' })],
    [{ op: 'exists', value: ref('nodes.pay') }], { id: 'Boundary' });
  store.saveWorkflow(boundary);
  const tie = await runtime.execute(runtime.create(boundary, { order: 'PO-B' }).id);
  runtime.answer(tie.id, 'root/ok', store.rows.header(tie.id).deadline);
  const refused = await runtime.execute(tie.id);
  assert.deepEqual([refused.status, refused.error.code, refused.verdict.verdict], ['failed', 'WAIT_DEADLINE', 'inconclusive'], 'the run\'s time budget, as DEADLINE');

  // CLI: a --key that happens to name a file is still the JSON it spells.
  const wf = base([payWait(), ship()], [{ op: 'gte', left: ref('nodes.ship.amount'), right: 0 }]);
  store.saveWorkflow(wf);
  const run = await runtime.execute(runtime.create(wf, { order: 42 }).id);
  store.close();
  const cwd = space(t);
  writeFileSync(path.join(cwd, '42'), '"PO-OTHER"');
  assert.equal(cliIn(root, ['signal', run.id, '--name', 'payment.settled', '--id', 'cli-42', '--key', '42', '--payload', '{"amount":1}'], cwd).consumedBy, 'root/pay');
});
