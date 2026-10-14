// Trace API v1: the allowlist projection, the leak test (TRACKER-DESIGN.md §2.1: must exist before any use) and h.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { sandboxArm } from '../../../beds/ebed/host/sandbox-arm.mjs';
import { projectTrace, makeHelpers, completeTrace, TRACE_API, E8_SUBJECT } from '../trace.mjs';
import { runWorld } from '../run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const skip = !sandboxAvailable() && 'sandbox unavailable';
const FORBIDDEN = ['subjectCase', 'faultTags', 'injected', 'binding', 'noise', 'ordinal', 'committed', 'truth', 'steps', 'noAnswer', 'form'];
const keysOf = (v, acc = new Set()) => { if (Array.isArray(v)) v.forEach(x => keysOf(x, acc)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.add(k); keysOf(x, acc); } return acc; };

// A hand-written journal: every row type the host writes that the trace must NOT carry is present with truth labels.
const ROWS = [
  { type: 'run.start', host: '1.2.1', item: 'ebed-e8', world: { id: 'ebed-e8-dev-1-d2-tail', digest: 'x' }, arm: 'a', t0: '2026-03-02T00:00:00+01:00', horizonEnd: '2026-03-16T00:00:00+01:00' },
  { type: 'world.write', system: 'fraud', table: 'verdicts', pk: 'ORD-1', source: 'initial', row: { orderId: 'ORD-1', verdict: 'reject' } },
  { type: 'run.ready', at: '2026-03-02T00:00:00+01:00', instances: 0, agenda: 1 },
  { type: 'wakeup', at: '2026-03-02T10:00:00+01:00', entries: 1 },
  { type: 'instance.open', instance: 'i-000001', startedBy: { kind: 'event', eventId: 'ev-1' }, at: '2026-03-02T10:00:00+01:00', binding: 'o0001' },
  { type: 'deliver', event: { id: 'ev-1', type: 'order.placed', at: '2026-03-02T10:00:00+01:00', source: 'shop', channel: { kind: 'inbound' }, payload: { orderId: ' ord-1', placedAt: '2026-03-02T10:00:00+01:00', items: [{ sku: 'A', qty: 1 }] }, doc: 'ORDER ORD-1' }, instance: 'i-000001', route: 'start' },
  { type: 'call', callId: 'c1', kind: 'case', target: 'i-000001', round: 1, at: '2026-03-02T10:00:00+01:00', inputDigest: 'd', outcome: 'ok', output: { decisions: { subject: 'ORD-1' }, effects: [{ system: 'orders', op: 'create', key: 'k1', args: { orderId: 'ORD-1' } }] }, costs: [], envFaults: [] },
  { type: 'effect.emit', emission: 'em-0000001', origin: { kind: 'case', instance: 'i-000001' }, effect: { system: 'orders', op: 'create', key: 'k1', args: { orderId: 'ORD-1' } } },
  { type: 'ledger', world: 'w', arm: 'a', instance: 'i-000001', at: '2026-03-02T10:00:00+01:00', system: 'orders', op: 'create', emission: 'em-0000001', attempt: 1, key: 'k1', subjectCase: 'o0001', ordinal: 1, committed: true, status: 'ok', faultTags: ['F3'], injected: true },
  { type: 'counterparty.event', event: { id: 'h-0000009', type: 'carrier.status' }, case: 'o0001', cause: 'em-0000001' },
  { type: 'effect.result', emission: 'em-0000001', event: 'h-0000001', at: '2026-03-02T10:01:00+01:00', status: 'unknown', injected: true },
  { type: 'obligation.upsert', instance: 'i-000001', id: 'deadline', kind: 'customer', dueAt: '2026-03-02T14:00:00+01:00', firesAt: '2026-03-02T14:00:00+01:00' },
  { type: 'humanTask.created', instance: 'i-000001', task: { id: 't1', kind: 'fraudReview', role: 'fraudAnalyst', subject: 'ORD-1', dueAt: '2026-03-03T10:00:00+01:00' }, case: 'o0001', ordinal: 1, user: 'u-fa1', noAnswer: null, noise: 'late', form: null, steps: [{ at: 'x', type: 'humanTask.answered' }] },
  { type: 'carry.commit', instance: 'i-000001', tickIndex: 1, digest: 'z' },
  { type: 'wakeup.commit', at: '2026-03-02T10:00:00+01:00', ledgerRows: 1 },
  { type: 'wakeup', at: '2026-03-02T10:01:00+01:00', entries: 1 },
  { type: 'deliver', event: { id: 'h-0000001', type: 'effect.result', at: '2026-03-02T10:01:00+01:00', source: 'orders', channel: { kind: 'instance', instance: 'i-000001' }, payload: { key: 'k1', system: 'orders', op: 'create', status: 'unknown', error: { code: 'timeout', reason: 'timeout' } }, injected: true }, instance: 'i-000001' },
  { type: 'call', callId: 'c2', kind: 'case', target: 'i-000001', round: 1, at: '2026-03-02T10:01:00+01:00', inputDigest: 'd', outcome: 'ok', output: { decisions: { subject: 'ORD-1' }, effects: [{ system: 'inventory', op: 'reserve', key: 'batch', args: { orderId: 'ORD-1', items: [{ sku: 'A', qty: 1 }] } }] }, costs: [], envFaults: [] },
  { type: 'arm.error', instance: 'i-000001', code: 'invalid-output', detail: ['effects[0].key: a batch op keys its items, not the batch'], binding: 'o0001' },
  { type: 'carry.lost', instance: 'i-000001', tickIndex: 2 },
  { type: 'instance.close', instance: 'i-000001', reason: 'closed', droppedObligations: [] },
  { type: 'wakeup.commit', at: '2026-03-02T10:01:00+01:00', ledgerRows: 1 },
  { type: 'run.end', at: '2026-03-16T00:00:00+01:00', open: [{ instance: 'i-000002', binding: 'o0002' }], obligations: [], tasks: [], undeliveredWorldEvents: [], pending: [], digests: {} },
];

test('projection: allowlisted rows and fields only, results joined to their effects, refused outputs kept with what they proposed', () => {
  const t = projectTrace(ROWS, { files: { 'master/catalog.json': '[]', 'api/orders.schema.json': '{}', 'spec/SPEC-E.md': 'x', 'docs/ev-1.txt': 'y' }, records: { 'orders.orders': [{ orderId: 'ORD-1' }] } });
  assert.equal(t.trace, '1');
  assert.equal(t.horizon, '2026-03-16T00:00:00+01:00');
  assert.deepEqual(Object.keys(t.files), ['master/catalog.json'], 'only master/, rulebook/, calendar/ files');
  assert.equal(t.inbound.length, 1);
  assert.deepEqual({ ...t.inbound[0], payload: undefined }, { id: 'ev-1', type: 'order.placed', at: '2026-03-02T10:00:00+01:00', source: 'shop', payload: undefined, instance: 'i-000001', subject: 'ORD-1', doc: 'ORDER ORD-1' });
  assert.equal(t.effects.length, 1);
  assert.deepEqual(t.effects[0], { id: 'em-0000001', at: '2026-03-02T10:00:00+01:00', instance: 'i-000001', subject: 'ORD-1', system: 'orders', op: 'create', args: { orderId: 'ORD-1' }, key: 'k1', after: null,
    result: { at: '2026-03-02T10:01:00+01:00', status: 'unknown', error: { code: 'timeout', reason: 'timeout' } }, abandoned: false });
  assert.equal(t.refused.length, 1);
  assert.equal(t.refused[0].code, 'invalid-output');
  assert.equal(t.refused[0].subject, 'ORD-1');
  assert.deepEqual(t.refused[0].proposed, [{ system: 'inventory', op: 'reserve', args: { orderId: 'ORD-1', items: [{ sku: 'A', qty: 1 }] }, key: 'batch', after: null }]);
  assert.deepEqual(t.tasks, [{ at: '2026-03-02T10:00:00+01:00', instance: 'i-000001', task: { id: 't1', kind: 'fraudReview', role: 'fraudAnalyst', subject: 'ORD-1', dueAt: '2026-03-03T10:00:00+01:00' } }]);
  assert.deepEqual(t.timers, [{ at: '2026-03-02T10:00:00+01:00', instance: 'i-000001', id: 'deadline', kind: 'customer', dueAt: '2026-03-02T14:00:00+01:00' }]);
  assert.deepEqual(t.instances, [{ instance: 'i-000001', openedAt: '2026-03-02T10:00:00+01:00', subject: 'ORD-1', closed: { at: '2026-03-02T10:01:00+01:00', reason: 'closed' } }]);
  const json = JSON.stringify(t);
  for (const k of FORBIDDEN) assert.ok(!keysOf(t).has(k), `key ${k} must not reach the trace`);
  for (const s of ['o0001', 'o0002', 'h-0000009', 'u-fa1', 'verdict']) assert.ok(!json.includes(s), `${s} must not reach the trace`);
});

test('leak test: a real run carries no truth label, and two worlds that differ only in truth labels give the same trace', { skip }, async () => {
  const solver = readFileSync(path.join(ROOT, 'research/enterprise-20261014/runs/b1lh-e8-1/solver.mjs'), 'utf8');
  const a = e8.generateWorld({ seed: 1235, difficulty: 3, mix: 'tail', size: 14 });
  const b = structuredClone(a);
  for (const c of Object.values(b.truth.cases)) { c.class = `relabelled-${c.class}`; c.tail = !c.tail; c.epoch = 'epX'; }
  const item = { binding: e8.binding };
  const traceOf = async world => { const arm = sandboxArm({ id: 'leak', solverSource: solver, timeoutMs: 20_000 }); try { return (await runWorld({ item, world, arm })).trace; } finally { arm.close(); } };
  const ta = await traceOf(a), tb = await traceOf(b);
  assert.ok(ta.effects.length > 50 && ta.inbound.length > 10, 'the run did something');
  const ja = JSON.stringify(ta), jb = JSON.stringify(tb);
  for (const c of Object.keys(a.truth.cases)) assert.ok(!new RegExp(`\\b${c}\\b`).test(ja), `truth case id ${c} leaked`);
  const keys = keysOf(ta);
  for (const k of FORBIDDEN) assert.ok(!keys.has(k), `key ${k} leaked`);
  const digest = s => createHash('sha256').update(s).digest('hex');
  assert.equal(digest(ja), digest(jb), 'truth labels changed the trace');
  assert.ok(ta.effects.every(e => e.result === null || typeof e.result.status === 'string'));
  assert.ok(Object.keys(ta.files).some(p => p.startsWith('rulebook/')) && Object.keys(ta.records).includes('orders.orders'));
});

test('h: windows with explicit bounds, censoring, h.of in time order, h.json', () => {
  const t = completeTrace({ horizon: '2026-03-02T12:00:00+01:00', files: { 'rulebook/e1/policy.json': '{"fraudReviewHours":24}' },
    inbound: [{ id: 'm1', type: 'order.placed', at: '2026-03-02T10:00:00+01:00', payload: {}, subject: 'ORD-1' }],
    effects: [{ id: 'e2', at: '2026-03-02T10:30:00+01:00', subject: 'ORD-1', system: 'x', op: 'y' }, { id: 'e1', at: '2026-03-02T10:05:00+01:00', subject: 'ord-1', system: 'x', op: 'y' }, { id: 'e3', at: '2026-03-02T10:05:00+01:00', subject: 'ORD-2', system: 'x', op: 'y' }] });
  const h = makeHelpers(t);
  assert.equal(h.minutes('2026-03-02T10:00:00+01:00', '2026-03-02T11:00:00+01:00'), 60);
  assert.equal(h.within('2026-03-02T11:00:00+01:00', '2026-03-02T10:00:00+01:00', 0, 60), true);
  assert.equal(h.within('2026-03-02T11:00:00+01:00', '2026-03-02T10:00:00+01:00', 0, 60, { hi: 'excl' }), false);
  assert.equal(h.within('2026-03-02T10:00:00+01:00', '2026-03-02T10:00:00+01:00', 0, 60, { lo: 'excl' }), false);
  assert.equal(h.within('2026-03-02T09:00:00Z', '2026-03-02T10:00:00+01:00', 0, 0), true, 'offsets are respected');
  assert.equal(h.censored('2026-03-02T12:00:00+01:00'), false);
  assert.equal(h.censored('2026-03-02T12:00:01+01:00'), true);
  assert.deepEqual(h.of(' #ord-1').map(r => r.id), ['m1', 'e1', 'e2']);
  assert.deepEqual(h.of('ORD-9'), []);
  assert.equal(h.json('rulebook/e1/policy.json').fraudReviewHours, 24);
  assert.equal(h.json('nope'), null);
  assert.throws(() => h.ms('yesterday'), /not an ISO time/);
  assert.equal(h.norm(' #ord-7 '), 'ORD-7');
  assert.match(TRACE_API, /t\.refused/);
  assert.equal(E8_SUBJECT.ofPayload({ fulfilmentRef: 'ORD-1237-0062-F2' }), 'ORD-1237-0062');
  assert.equal(E8_SUBJECT.ofPayload({ orderRef: '#ord-5' }), 'ORD-5');
});
