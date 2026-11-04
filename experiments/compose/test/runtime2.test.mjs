// compose-runtime/2 (runtime2.mjs, effects.registry.json, bundle2.mjs): the envelope's pure behaviour, the registry's
// mirror of the grader's identity, and the static single-writer gate on the six COMP-1 manifests. $0, no model calls.
// The real-host fault probes are in runtime2.host.test.mjs.
//   nice -n 15 node --test --test-concurrency=1 experiments/compose/test/runtime2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { runReference } from '../../../beds/ebed/oracle/policy.mjs';
import { indexJournal } from '../../../beds/ebed/oracle/view.mjs';
import { identityOf } from '../capabilities.mjs';
import { readProgram } from '../bundle.mjs';
import { bundle2, E8_REGISTRY, RUNTIME2_SOURCE } from '../bundle2.mjs';
import {
  R2_CARRY, envRegistryProblems, envIdentities, envKey, envDigest, envFill, envBefore, envAfter, envUnwrap, withEnvelope,
  singleWriterProblems,
} from '../runtime2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.resolve(here, '../../../research/composition-20261021/runs');
const REG = E8_REGISTRY;

// A tiny seeded PRNG (mulberry32) for argument fuzzing.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

// One tick through the envelope: input events + a solver output -> { input the solver saw, output the host gets }.
function tick({ carry = null, events = [], out, status = null }) {
  const seen = {};
  const ctx = { files: {}, query: () => [], instances: () => [], status: status ?? ((s, k) => `status:${s}:${k}`) };
  const solver = { id: 's', tick: (input, c) => { seen.input = input; seen.ctx = c; return typeof out === 'function' ? out(input, c) : out; } };
  const w = withEnvelope(solver, { registry: REG });
  const res = w.tick({ kind: 'case', instance: 'i-1', now: '2026-03-10T08:00:00Z', events, carry }, ctx);
  return { seen, res };
}
const result = (key, status = 'ok', extra = {}) => ({ id: `ev-${key}-${status}-${Math.random()}`, type: 'effect.result', payload: { key, system: 'billing', op: 'charge', status, ...extra } });
const charge = (key, ful = 'F-1', amount = 100) => ({ key, system: 'billing', op: 'charge', args: { orderId: 'O-1', fulfilmentId: ful, customerId: 'C-1', amountMinor: amount, currency: 'EUR' } });
const out = (effects, carry = { mine: 1 }) => ({ decisions: { subject: 'O-1' }, effects, obligations: { upsert: [], cancel: [] }, humanTasks: [], carry });

// ---------------------------------------------------------------------------------------------------------------------
// Registry

test('the E8 registry is valid and names exactly the item\'s ops: an identity per keyed write, read for every read', () => {
  assert.deepEqual(envRegistryProblems(REG), []);
  const ops = new Map();
  for (const sys of e8.systems) for (const [op, d] of Object.entries(sys.ops)) ops.set(`${sys.id}.${op}`, d);
  assert.deepEqual([...ops.keys()].sort(), Object.keys(REG.ops).sort());
  for (const [name, d] of ops) {
    const ent = REG.ops[name];
    if (d.readOnly) assert.equal(ent.read, true, name);
    else { assert.equal(d.keyed, true, name); assert.equal(typeof ent.identity, 'string', name); assert.equal(ent.batch === true, d.batch === true, name); }
  }
  // teeth: the validator refuses a template without a slot, a shared prefix and an unknown field
  assert.ok(envRegistryProblems({ version: 1, ops: { 'a.b': { identity: 'x:fixed' } } }).length);
  assert.ok(envRegistryProblems({ version: 1, ops: { 'a.b': { identity: 'x:{p}' }, 'a.c': { identity: 'x:{q}' } } }).length);
  assert.ok(envRegistryProblems({ version: 1, ops: { 'a.b': { identity: 'x:{p}', keyBy: 'p' } } }).length);
});

test('registry identities equal the grader\'s identityOf on 3,000 fuzzed effects (about-null notices excepted by design)', () => {
  const r = rng(20261028);
  const ids = ['O-1', 'O-2', 'ORD-0001-17', 'F-9', 'ORD-0001-17-F2'];
  const writes = Object.entries(REG.ops).filter(([, e]) => !e.read);
  let compared = 0, aboutNull = 0, fulNull = 0;
  for (let n = 0; n < 3000; n++) {
    const [name, ent] = pick(r, writes);
    const [system, op] = name.split('.');
    const args = { orderId: pick(r, ids), fulfilmentId: r() < 0.3 ? null : pick(r, ids), status: pick(r, ['cancelled', 'shipped', 'pending']),
      sku: pick(r, ['SKU-1001', 'SKU-1002']), about: r() < 0.15 ? null : pick(r, ids), template: pick(r, ['cancel-refused', 'order-cancelled']),
      to: 'c@x.example', text: 't', amountMinor: 100, customerId: 'C-1', currency: 'EUR' };
    if (ent.batch) {
      const { sku, ...batch } = args;
      const got = envIdentities(REG, { system, op, args: { ...batch, items: [{ key: 'k', sku, qty: 1 }] } });
      if (args.fulfilmentId === null) { assert.equal(got.items[0], null); continue; }   // the op requires a fulfilment
      assert.equal(got.items[0], identityOf({ system, op, args }), name); compared++;
      continue;
    }
    const got = envIdentities(REG, { system, op, args });
    // the registry's two documented departures (effects.registry.json "about"): a null slot without a default is
    // unresolved here (the write keeps its caller's key), where identityOf spells the null
    if (name === 'notify.send' && args.about === null) { assert.equal(got.identity, null); assert.match(identityOf({ system, op, args }), /^notify:null:/); aboutNull++; continue; }
    if (name !== 'orders.setStatus' && args.fulfilmentId === null && /fulfilmentId/.test(ent.identity)) { assert.equal(got.identity, null); assert.match(identityOf({ system, op, args }), /:null(:|$)/); fulNull++; continue; }
    assert.equal(got.identity, identityOf({ system, op, args }), name); compared++;
  }
  assert.ok(compared > 2000 && aboutNull > 20 && fulNull > 300, `${compared} compared, ${aboutNull} about-null, ${fulNull} fulfilment-null`);
});

test('registry identities equal identityOf on every committed write of a reference run (dev world 1161 d3)', async () => {
  const W = e8.generateWorld({ seed: 1161, difficulty: 3, mix: 'tail', size: 30 });
  const { rows } = await runReference({ item: e8.oracleItem, binding: e8.binding, world: W });
  const idx = indexJournal(W, rows, { canonicalArgs: e8.oracleItem.canonicalArgs });
  let n = 0;
  for (const r of idx.ledger.filter(x => x.committed)) {
    const want = identityOf(r);
    if (!want) continue;
    const ent = REG.ops[`${r.system}.${r.op}`];
    const got = ent.batch ? envFill(ent.identity, r.args) : envIdentities(REG, r).identity;
    if (r.system === 'notify' && r.args.about === null) { assert.equal(got, null); continue; }
    assert.equal(got, want); n++;
  }
  assert.ok(n > 100, `${n} committed writes compared`);
});

test('envKey: safe identities verbatim, unsafe or long ones digested; 20,000 distinct identities give distinct keys', () => {
  assert.equal(envKey('status:O-1:-:cancelled'), '=status:O-1:-:cancelled');
  assert.match(envKey('notify:O 1:x'), /^=#[0-9a-f]{16}$/);
  assert.match(envKey(`create:${'x'.repeat(200)}`), /^=#[0-9a-f]{16}$/);
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(envKey(`create:${'y'.repeat(160)}${i}`));
  assert.equal(seen.size, 20000);
  assert.notEqual(envDigest({ a: 1, b: 2 }), envDigest({ a: 1, b: 3 }));
  assert.equal(envDigest({ a: 1, b: 2 }), envDigest({ b: 2, a: 1 }));
  // both 32-bit halves carry information (a constant second pass would leave a 32-bit digest)
  assert.equal(new Set(['a', 'b', 'c', 'd', 'e'].map(v => envDigest(v).slice(8))).size, 5);
  assert.equal(new Set(['a', 'b', 'c', 'd', 'e'].map(v => envDigest(v).slice(0, 8))).size, 5);
});

test('envFill is injective: separators, defaults and number types in values cannot collide (E8 identities unchanged)', () => {
  const t = 'x:{a}:{b}';
  assert.notEqual(envFill(t, { a: 'O-1:F', b: 'G' }), envFill(t, { a: 'O-1', b: 'F:G' }));
  assert.notEqual(envFill('s:{o}:{f|-}', { o: 'O', f: null }), envFill('s:{o}:{f|-}', { o: 'O', f: '-' }));
  assert.notEqual(envFill('n:{v}', { v: 1 }), envFill('n:{v}', { v: '1' }));
  assert.notEqual(envFill('n:{v}', { v: '%3A' }), envFill('n:{v}', { v: ':' }));
  assert.notEqual(envFill('n:{v}', { v: '#1' }), envFill('n:{v}', { v: 1 }));
  assert.equal(envFill('n:{v}', { v: Infinity }), null);
  assert.equal(envFill('status:{orderId}:{fulfilmentId|-}:{status}', { orderId: 'ORD-0001-17', fulfilmentId: null, status: 'cancelled' }), 'status:ORD-0001-17:-:cancelled');
  assert.equal(envFill('status:{orderId}:{fulfilmentId|-}:{status}', { orderId: 'O-1', fulfilmentId: 'ORD-0001-17-F2', status: 'shipped' }), 'status:O-1:ORD-0001-17-F2:shipped');
  // property: over an alphabet rich in separators, distinct argument pairs never share an identity
  const r = rng(20261104);
  const alpha = ['', '-', ':', '%', '#', '1', 'a', '%3A', '#1', 'a:b', '--'];
  const seen = new Map();
  for (let n = 0; n < 5000; n++) {
    const mk = () => (r() < 0.25 ? Math.floor(r() * 3) : r() < 0.15 ? null : pick(r, alpha) + (r() < 0.5 ? pick(r, alpha) : ''));
    const args = { a: mk(), b: mk() };
    if (args.a === null) continue;                             // {a} has no default: unresolved
    const id = envFill('x:{a}:{b|-}', args);
    const k = JSON.stringify([args.a, args.b === null ? null : args.b]);
    if (seen.has(id)) assert.equal(seen.get(id), k, `collision: ${id}`); else seen.set(id, k);
  }
  assert.ok(seen.size > 100);
  // the registry refuses templates that escaping cannot make injective
  assert.ok(envRegistryProblems({ version: 1, ops: { 'a.b': { identity: 'x:{p}{q}' } } }).length);
  assert.ok(envRegistryProblems({ version: 1, ops: { 'a.b': { identity: 'x:{p}-{q}' } } }).length);
  assert.ok(envRegistryProblems({ version: 1, ops: { 'a.b': { identity: 'x:{p|a:b}' } } }).length);
  assert.deepEqual(envRegistryProblems({ version: 1, ops: { 'a.b': { identity: 'x:{p}:{q|-}' } } }), []);
});

// ---------------------------------------------------------------------------------------------------------------------
// Outbound

test('outbound: two caller keys of one logical effect leave with one identity key; after/compensates follow; reads untouched', () => {
  const { res } = tick({ out: out([
    charge('fulfil/O-1/charge'), charge('saga/O-1/charge-again'),
    { key: 'ship', system: 'carrier', op: 'create', args: { orderId: 'O-1', fulfilmentId: 'F-1', location: 'L1' }, after: 'fulfil/O-1/charge' },
    { key: 'fraud', system: 'fraud', op: 'check', args: { orderId: 'O-1' } },
    { key: 'mystery', system: 'mail', op: 'send', args: {} },
  ]) });
  const [a, b, c, d, e] = res.effects;
  assert.equal(a.key, '=charge:F-1');
  assert.equal(b.key, '=charge:F-1');
  assert.equal(c.key, '=ship:F-1');
  assert.equal(c.after, '=charge:F-1');
  assert.equal(d.key, 'fraud');
  assert.equal(e.key, 'mystery');
  assert.equal(res.carry.cv, R2_CARRY);
  assert.deepEqual(res.carry.c, { mine: 1 });
  assert.deepEqual(res.decisions.envelope.findings.map(f => f.code), ['shared-identity']);
});

test('outbound: `compensates` follows the rewrite within a tick and across ticks; an unknown target is kept', () => {
  const refund = (key, compensates) => ({ key, system: 'billing', op: 'refund', args: { orderId: 'O-1', fulfilmentId: 'F-1', amountMinor: 100, currency: 'EUR' }, compensates });
  const t1 = tick({ out: out([charge('c1'), refund('r1', 'c1')]) });
  assert.equal(t1.res.effects[1].key, '=refund:F-1');
  assert.equal(t1.res.effects[1].compensates, '=charge:F-1');
  const t2 = tick({ carry: t1.res.carry, events: [result('=charge:F-1')], out: out([refund('r2', 'c1'), refund('r3', 'nope')]) });
  assert.equal(t2.res.effects[0].compensates, '=charge:F-1');
  assert.equal(t2.res.effects[1].compensates, 'nope');
});

test('outbound: a key-less write gets its identity key; an unresolvable identity keeps the caller key; batch items per item', () => {
  const { res } = tick({ out: out([
    { system: 'orders', op: 'setStatus', args: { orderId: 'O-1', fulfilmentId: null, status: 'cancelled' } },
    { key: 'n1', system: 'notify', op: 'send', args: { to: 'a@b', about: null, template: 'unknown-order', text: 'x' } },
    { system: 'inventory', op: 'reserve', args: { orderId: 'O-1', fulfilmentId: 'F-1', location: 'L1', items: [{ key: 'r.a', sku: 'S1', qty: 1 }, { sku: 'S2', qty: 2 }] } },
  ]) });
  assert.equal(res.effects[0].key, '=status:O-1:-:cancelled');
  assert.equal(res.effects[1].key, 'n1');
  assert.deepEqual(res.effects[2].args.items.map(i => i.key), ['=reserve:F-1:S1', '=reserve:F-1:S2']);
  assert.deepEqual(res.decisions.envelope.findings.map(f => f.code).sort(), ['identity-unresolved', 'key-assigned', 'key-assigned']);
});

test('a tick with no findings leaves the decisions exactly as the solver wrote them', () => {
  const { res } = tick({ out: out([charge('k1')]) });
  assert.deepEqual(res.decisions, { subject: 'O-1' });
});

// ---------------------------------------------------------------------------------------------------------------------
// Inbox

test('inbox: a result comes back under the caller key; a surplus answer is dropped; a foreign key passes', () => {
  const t1 = tick({ out: out([charge('fulfil/O-1/charge')]) });
  const t2 = tick({ carry: t1.res.carry, events: [result('=charge:F-1'), result('other-key')], out: out([]) });
  assert.deepEqual(t2.seen.input.events.map(e => e.payload.key), ['fulfil/O-1/charge', 'other-key']);
  assert.deepEqual(t2.seen.input.carry, { mine: 1 });
  // the host's deduplicated answer to a second emission arrives with nothing owed: dropped
  const t3 = tick({ carry: t2.res.carry, events: [result('=charge:F-1')], out: out([]) });
  assert.deepEqual(t3.seen.input.events, []);
  assert.deepEqual(t3.res.decisions.envelope.findings.map(f => f.code), ['surplus']);
});

test('inbox: every emission gets its result, also when two caller keys share an identity or one key is re-emitted', () => {
  const t1 = tick({ out: out([charge('a'), charge('b')]) });
  const t2 = tick({ carry: t1.res.carry, events: [result('=charge:F-1'), result('=charge:F-1')], out: out([charge('a')]) });
  assert.deepEqual(t2.seen.input.events.map(e => e.payload.key), ['a', 'b']);
  const t3 = tick({ carry: t2.res.carry, events: [result('=charge:F-1', 'ok', { attempts: 1 })], out: out([]) });
  assert.deepEqual(t3.seen.input.events.map(e => e.payload.key), ['a']);
  const t4 = tick({ carry: t3.res.carry, events: [result('=charge:F-1')], out: out([]) });
  assert.equal(t4.seen.input.events.length, 0);
});

test('inbox under a crash: the rolled-back carry drops the lost emission\'s result (orphan) and the re-emission gets one result', () => {
  const t0 = tick({ out: out([]) });                                   // committed state before the crashed tick
  const crashed = tick({ carry: t0.res.carry, out: out([charge('fulfil/O-1/charge')]) });
  assert.equal(crashed.res.effects[0].key, '=charge:F-1');           // applied by the platform; the carry is then lost
  // next tick: the crashed tick's events are redelivered with the original result; the solver re-emits
  const t1 = tick({ carry: t0.res.carry, events: [result('=charge:F-1')], out: out([charge('fulfil/O-1/charge')]) });
  assert.deepEqual(t1.seen.input.events, []);
  assert.deepEqual(t1.res.decisions.envelope.findings.map(f => f.code), ['orphan']);
  const t2 = tick({ carry: t1.res.carry, events: [result('=charge:F-1')], out: out([]) });   // the host's deduplicated answer
  assert.deepEqual(t2.seen.input.events.map(e => e.payload.key), ['fulfil/O-1/charge']);
  // without the envelope's carry the same events would reach the solver twice: that is the D3 hazard (teeth below)
});

test('inbox: a surplus is compared with what the solver was told; it is delivered when the solver\'s view would be wrong', () => {
  // the crashed tick's charge was lost from the carry; the solver re-emits before that attempt's result arrives, so the
  // first result to arrive (the lost attempt's) is handed to the re-emission, and the re-emission's own result is surplus
  const start = (first) => {
    const t0 = tick({ out: out([]) });
    const t1 = tick({ carry: t0.res.carry, out: out([charge('c')]) });
    return tick({ carry: t1.res.carry, events: [first], out: out([]) });
  };
  const declined = result('=charge:F-1', 'error', { error: { code: 402, reason: 'card-declined' } });
  const unavailable = result('=charge:F-1', 'error', { error: { code: 503, reason: 'unavailable', retryable: true } });
  // error, then ok: the effect committed; the solver must learn it (the review's D1 case)
  const e1 = start(declined);
  assert.deepEqual(e1.seen.input.events.map(e => [e.payload.key, e.payload.status]), [['c', 'error']]);
  const e2 = tick({ carry: e1.res.carry, events: [result('=charge:F-1', 'ok', { result: { chargeId: 'CH-1' } })], out: out([]) });
  assert.deepEqual(e2.seen.input.events.map(e => [e.payload.key, e.payload.status]), [['c', 'ok']]);
  assert.deepEqual(e2.res.decisions.envelope.findings.map(f => f.code), ['conflicting-result']);
  // now committed: a further ok is the host's deduplicated answer, dropped
  const e3 = tick({ carry: e2.res.carry, events: [result('=charge:F-1', 'ok', { result: { chargeId: 'CH-1' } })], out: out([]) });
  assert.deepEqual(e3.seen.input.events, []);
  assert.deepEqual(e3.res.decisions.envelope.findings.map(f => f.code), ['surplus']);
  // ok, then 409 key-conflict: the remembered emission's arguments differ from the committed ones; never silent
  const k1 = start(result('=charge:F-1', 'ok'));
  const k2 = tick({ carry: k1.res.carry, events: [result('=charge:F-1', 'error', { error: { code: 409, reason: 'key-conflict' } })], out: out([]) });
  assert.deepEqual(k2.seen.input.events.map(e => [e.payload.key, e.payload.error?.reason]), [['c', 'key-conflict']]);
  assert.deepEqual(k2.res.decisions.envelope.findings.map(f => f.code), ['conflicting-result', 'host-key-conflict']);
  // ok, then a transport failure of the later attempt: the effect committed and the solver knows it; dropped
  const a1 = start(result('=charge:F-1', 'ok'));
  const a2 = tick({ carry: a1.res.carry, events: [unavailable], out: out([]) });
  assert.deepEqual(a2.seen.input.events, []);
  assert.deepEqual(a2.res.decisions.envelope.findings.map(f => f.code), ['surplus-after-commit']);
  // the same failure twice: dropped; a different failure: delivered
  const s1 = start(declined);
  const s2 = tick({ carry: s1.res.carry, events: [{ ...declined, id: 'again' }], out: out([]) });
  assert.deepEqual(s2.seen.input.events, []);
  const d1 = start(unavailable);
  const d2 = tick({ carry: d1.res.carry, events: [declined], out: out([]) });
  assert.deepEqual(d2.seen.input.events.map(e => [e.payload.key, e.payload.error?.reason]), [['c', 'card-declined']]);
  assert.deepEqual(d2.res.decisions.envelope.findings.map(f => f.code), ['conflicting-result']);
});

test('inbox: results for one identity shared by caller keys are handed out in emission order (A, B, A)', () => {
  const t1 = tick({ out: out([charge('A')]) });
  const t2 = tick({ carry: t1.res.carry, out: out([charge('B')]) });
  const t3 = tick({ carry: t2.res.carry, out: out([charge('A')]) });
  const t4 = tick({ carry: t3.res.carry, events: [result('=charge:F-1', 'error', { error: { code: 503, reason: 'unavailable' } }), result('=charge:F-1'), result('=charge:F-1')], out: out([]) });
  assert.deepEqual(t4.seen.input.events.map(e => [e.payload.key, e.payload.status]), [['A', 'error'], ['B', 'ok'], ['A', 'ok']]);
  // a conflicting surplus answers the latest emission (A's), so it goes to A
  const t5 = tick({ carry: t4.res.carry, events: [result('=charge:F-1', 'error', { error: { code: 409, reason: 'key-conflict' } })], out: out([]) });
  assert.deepEqual(t5.seen.input.events.map(e => [e.payload.key, e.payload.error?.reason]), [['A', 'key-conflict']]);
  // a single caller key keeps the compact state: no order list
  assert.equal(tick({ out: out([charge('A'), charge('A')]) }).res.carry.x.r['=charge:F-1'].f, undefined);
});

test('inbox: a batch result owed for some items and not others is delivered; only the owed items are counted', () => {
  const reserve = items => ({ system: 'inventory', op: 'reserve', args: { orderId: 'O-1', fulfilmentId: 'F-1', location: 'L1', items } });
  const ok = (sku) => ({ key: `=reserve:F-1:${sku}`, status: 'ok' });
  const batchResult = items => ({ id: `b-${Math.random()}`, type: 'effect.result', payload: { key: null, system: 'inventory', op: 'reserve', status: 'ok', items: items.map((it, index) => ({ index, ...it })) } });
  const t1 = tick({ out: out([reserve([{ key: 'a', sku: 'S1', qty: 1 }, { key: 'b', sku: 'S2', qty: 1 }])]) });
  const t2 = tick({ carry: t1.res.carry, events: [batchResult([ok('S1'), ok('S2')])], out: out([reserve([{ key: 'a', sku: 'S1', qty: 1 }])]) });
  assert.deepEqual(t2.seen.input.events[0].payload.items.map(i => i.key), ['a', 'b']);
  const t3 = tick({ carry: t2.res.carry, events: [batchResult([ok('S1'), ok('S2')])], out: out([]) });
  assert.equal(t3.seen.input.events.length, 1, 'the event is owed for S1, so it is delivered');
  assert.deepEqual(t3.seen.input.events[0].payload.items.map(i => i.key), ['a', 'b']);
  assert.deepEqual(t3.res.decisions.envelope.findings.map(f => f.code), ['surplus-in-batch']);
  // nothing owed: dropped
  const t4 = tick({ carry: t3.res.carry, events: [batchResult([ok('S1'), ok('S2')])], out: out([]) });
  assert.deepEqual(t4.seen.input.events, []);
});

test('inbox: results of reads and unresolved writes are counted under their caller key (a second one is surplus)', () => {
  const t1 = tick({ out: out([{ key: 'fraud', system: 'fraud', op: 'check', args: { orderId: 'O-1' } }, { key: 'n1', system: 'notify', op: 'send', args: { to: 'a@b', about: null, template: 't', text: 'x' } }]) });
  const r = (key, op) => ({ id: `r-${Math.random()}`, type: 'effect.result', payload: { key, system: op.split('.')[0], op: op.split('.')[1], status: 'ok' } });
  const t2 = tick({ carry: t1.res.carry, events: [r('fraud', 'fraud.check'), r('fraud', 'fraud.check'), r('n1', 'notify.send'), r('n1', 'notify.send')], out: out([]) });
  assert.deepEqual(t2.seen.input.events.map(e => e.payload.key), ['fraud', 'n1']);
  assert.deepEqual(t2.res.decisions.envelope.findings.map(f => f.code), ['surplus', 'surplus']);
});

test('read-back (reconcile): a crash-orphaned failure answers the re-emission once a read shows nothing committed', () => {
  const rtick = ({ carry = null, events = [], out: o, registry = REG, opts = {} }) => {
    const seen = {};
    const solver = { id: 's', tick: (input, c) => { seen.input = input; return typeof o === 'function' ? o(input, c) : o; } };
    const res = withEnvelope(solver, { registry, reconcile: true, ...opts }).tick({ kind: 'case', instance: 'i-1', now: '2026-03-10T08:00:00Z', events, carry }, { status: () => 'not-found' });
    return { seen, res };
  };
  const readOf = (status, extra = {}) => ({ id: `r-${Math.random()}`, type: 'effect.result', payload: { key: '=?readback:charge:F-1', system: 'billing', op: 'status', status: 'ok', result: { key: '=charge:F-1', status }, ...extra } });
  const t0 = rtick({ out: out([]) });
  // the crashed tick charged (declined); its carry is lost; the decline arrives with the redelivered events
  const declined = result('=charge:F-1', 'error', { error: { code: 402, reason: 'card-declined' } });
  const t1 = rtick({ carry: t0.res.carry, events: [declined], out: out([charge('fulfil/O-1/charge')]) });
  assert.deepEqual(t1.seen.input.events, []);                              // parked, not shown out of context
  assert.deepEqual(t1.res.effects, [{ key: '=?readback:charge:F-1', system: 'billing', op: 'status', args: { key: '=charge:F-1' } }]);
  assert.deepEqual(t1.res.decisions.envelope.findings.map(f => f.code), ['orphan-parked', 'readback']);
  // the read shows nothing committed: the re-emission is answered with the parked outcome, under the caller's key
  const t2 = rtick({ carry: t1.res.carry, events: [readOf('not-found')], out: out([]) });
  assert.equal(t2.seen.input.events.length, 1);
  assert.deepEqual(t2.seen.input.events[0].payload, { key: 'fulfil/O-1/charge', system: 'billing', op: 'charge', status: 'error', error: { code: 402, reason: 'card-declined' } });
  assert.equal(t2.res.decisions.envelope.findings[0].code, 'reconciled');
  // a read-back's own result arriving again (its entry rolled back by a crash) is dropped as an orphan, never parked
  const again = rtick({ carry: t2.res.carry, events: [readOf('not-found')], out: out([]) });
  assert.deepEqual(again.seen.input.events, []);
  assert.deepEqual(again.res.decisions.envelope.findings.map(f => f.code), ['orphan']);
  assert.deepEqual(again.res.carry.x.p, {});
  const failedRead = { id: 'fr', type: 'effect.result', payload: { key: '=?readback:charge:F-1', system: 'billing', op: 'status', status: 'error', error: { code: 503 } } };
  const again2 = rtick({ carry: t2.res.carry, events: [failedRead], out: out([]) });
  assert.deepEqual(again2.res.decisions.envelope.findings.map(f => f.code), ['orphan']);
  assert.deepEqual(again2.res.carry.x.p, {});
  // a corrected emission later goes to the system as usual
  const t3 = rtick({ carry: t2.res.carry, events: [], out: out([charge('fulfil/O-1/charge', 'F-1', 99)]) });
  assert.equal(t3.res.effects[0].op, 'charge');
  // the read shows the identity committed (another attempt got through): the re-emitted write is re-issued as written,
  // and the solver gets the host's answer to it, never the parked failure
  const fullCharge = { key: '=charge:F-1', system: 'billing', op: 'charge', args: charge('x').args };
  for (const read of [readOf('committed'), readOf('pending'), { ...readOf('x'), payload: { key: '=?readback:charge:F-1', system: 'billing', op: 'status', status: 'error', error: { code: 503 } } }]) {
    const m = rtick({ carry: t1.res.carry, events: [read], out: out([]) });
    assert.deepEqual(m.seen.input.events, []);
    assert.deepEqual(m.res.effects, [fullCharge]);
    assert.deepEqual(m.res.decisions.envelope.findings.map(f => f.code), ['readback-reissued', 'reissued']);
    const m2 = rtick({ carry: m.res.carry, events: [result('=charge:F-1', 'ok')], out: out([]) });
    assert.deepEqual(m2.seen.input.events.map(e => [e.payload.key, e.payload.status]), [['fulfil/O-1/charge', 'ok']]);
  }
  // a read-back whose answer never comes is re-issued as the write after 20 ticks
  let c = t1.res.carry, expired = null;
  for (let i = 0; i < 25 && !expired; i++) { const r = rtick({ carry: c, out: out([]) }); c = r.res.carry; if (r.res.effects.length) expired = { i, r }; }
  assert.ok(expired && expired.i >= 19, `re-issued after ${expired?.i} ticks`);
  assert.deepEqual(expired.r.res.effects, [fullCharge]);
  assert.deepEqual(expired.r.res.decisions.envelope.findings.map(f => f.code), ['readback-expired', 'reissued']);
  // an orphaned ok is never parked: the re-emission goes to the system, so the host compares its arguments (a changed
  // amount is answered 409 key-conflict, as without the option)
  const k1 = rtick({ carry: t0.res.carry, events: [result('=charge:F-1', 'ok')], out: out([charge('fulfil/O-1/charge', 'F-1', 90)]) });
  assert.equal(k1.res.effects[0].op, 'charge');
  assert.equal(k1.res.effects[0].args.amountMinor, 90);
  assert.deepEqual(k1.res.decisions.envelope.findings.map(f => f.code), ['orphan']);
  assert.deepEqual(k1.res.carry.x.p, {});
  // without the option the orphan is dropped and the re-emission is a second attempt (the default runtime2)
  const d0 = tick({ out: out([]) });
  const d1 = tick({ carry: d0.res.carry, events: [declined], out: out([charge('fulfil/O-1/charge')]) });
  assert.equal(d1.res.effects[0].op, 'charge');
  assert.deepEqual(d1.res.decisions.envelope.findings.map(f => f.code), ['orphan']);
  // and the default state carries no read-back fields
  assert.deepEqual(Object.keys(d1.res.carry.x).sort(), ['o', 'r', 'v']);
  assert.deepEqual(Object.keys(t1.res.carry.x).sort(), ['o', 'p', 'q', 'r', 't', 'v', 'w']);
  // a dependant on the outcome keeps the real emission
  const dep = rtick({ carry: t0.res.carry, events: [declined], out: out([charge('c1'), { key: 'ship', system: 'carrier', op: 'create', args: { orderId: 'O-1', fulfilmentId: 'F-1' }, after: 'c1' }]) });
  assert.equal(dep.res.effects[0].op, 'charge');
  // so does a system with no status read
  const noStatus = { version: 1, ops: Object.fromEntries(Object.entries(REG.ops).filter(([k]) => k !== 'billing.status')) };
  const ns = rtick({ registry: noStatus, carry: rtick({ registry: noStatus, out: out([]) }).res.carry, events: [declined], out: out([charge('fulfil/O-1/charge')]) });
  assert.equal(ns.res.effects[0].op, 'charge');
  // parks expire after three ticks without a re-emission
  c = t0.res.carry;
  c = rtick({ carry: c, events: [declined], out: out([]) }).res.carry;
  for (let i = 0; i < 4; i++) c = rtick({ carry: c, out: out([]) }).res.carry;
  const late = rtick({ carry: c, out: out([charge('fulfil/O-1/charge')]) });
  assert.equal(late.res.effects[0].op, 'charge');
});

test('inbox: timer and human-task events and key-less results are never filtered', () => {
  const evs = [{ id: 't', type: 'timer.fired', payload: { obligationId: 'w' } }, { id: 'h', type: 'humanTask.answered', payload: { taskId: 'x' } },
    { id: 'r', type: 'effect.result', payload: { key: null, system: 'fraud', op: 'check', status: 'ok' } }];
  const t = tick({ events: evs, out: out([]) });
  assert.deepEqual(t.seen.input.events.map(e => e.id), ['t', 'h', 'r']);
  const t2 = tick({ carry: t.res.carry, events: evs, out: out([]) });
  assert.deepEqual(t2.seen.input.events.map(e => e.id), ['t', 'h', 'r']);
});

test('inbox: a key-less write\'s result comes back with key null; batch items come back under their item keys', () => {
  const t1 = tick({ out: out([
    { system: 'orders', op: 'setStatus', args: { orderId: 'O-1', fulfilmentId: null, status: 'cancelled' } },
    { system: 'inventory', op: 'reserve', args: { orderId: 'O-1', fulfilmentId: 'F-1', location: 'L1', items: [{ key: 'r.a', sku: 'S1', qty: 1 }, { sku: 'S2', qty: 2 }] } },
  ]) });
  const batch = { id: 'b', type: 'effect.result', payload: { key: null, system: 'inventory', op: 'reserve', status: 'ok', items: [{ index: 0, key: '=reserve:F-1:S1', status: 'ok' }, { index: 1, key: '=reserve:F-1:S2', status: 'ok' }] } };
  const t2 = tick({ carry: t1.res.carry, events: [{ id: 's', type: 'effect.result', payload: { key: '=status:O-1:-:cancelled', system: 'orders', op: 'setStatus', status: 'ok' } }, batch], out: out([]) });
  assert.equal(t2.seen.input.events[0].payload.key, null);
  assert.deepEqual(t2.seen.input.events[1].payload.items.map(i => i.key), ['r.a', null]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Conflicts, status, eviction

test('identity conflict: same identity, other arguments, is flagged and never merged; a corrected re-emission after an error is not', () => {
  const t1 = tick({ out: out([charge('a', 'F-1', 100)]) });
  const t2 = tick({ carry: t1.res.carry, events: [result('=charge:F-1')], out: out([charge('b', 'F-1', 50)]) });
  assert.equal(t2.res.effects[0].key, '=charge:F-1');                 // the host answers 409 key-conflict: nothing applied
  assert.deepEqual(t2.res.decisions.envelope.findings.map(f => [f.code, f.committed]), [['shared-identity', undefined], ['identity-conflict', true]]);
  const t3 = tick({ carry: t2.res.carry, events: [result('=charge:F-1', 'error', { error: { code: 409, reason: 'key-conflict' } })], out: out([]) });
  assert.deepEqual(t3.res.decisions.envelope.findings.map(f => f.code), ['host-key-conflict']);
  // an emission refused before it committed (400) frees the identity: the corrected one is no conflict
  const u1 = tick({ out: out([charge('a', 'F-2', 100)]) });
  const u2 = tick({ carry: u1.res.carry, events: [result('=charge:F-2', 'error', { error: { code: 400, reason: 'field-renamed' } })], out: out([charge('a', 'F-2', 101)]) });
  assert.equal(u2.res.decisions.envelope, undefined);
  // so does a rate-limited one (nothing applied)
  const v1 = tick({ out: out([charge('a', 'F-3', 100)]) });
  const v2 = tick({ carry: v1.res.carry, events: [result('=charge:F-3', 'rate-limited', { error: { code: 429, reason: 'rate-limited' }, retryAfter: 60 })], out: out([charge('a', 'F-3', 101)]) });
  assert.equal(v2.res.decisions.envelope, undefined);
  // an unknown outcome (F3) does not: it may have committed
  const w1 = tick({ out: out([charge('a', 'F-4', 100)]) });
  const w2 = tick({ carry: w1.res.carry, events: [result('=charge:F-4', 'unknown', { error: { code: 504, reason: 'timeout' } })], out: out([charge('a', 'F-4', 101)]) });
  assert.deepEqual(w2.res.decisions.envelope.findings.map(f => f.code), ['identity-conflict']);
});

test('ctx.status of a caller key reads the identity key; unknown keys read as given', () => {
  const t1 = tick({ out: out([charge('fulfil/O-1/charge')]) });
  const t2 = tick({ carry: t1.res.carry, out: (input, ctx) => out([], { s: ctx.status('billing', 'fulfil/O-1/charge'), u: ctx.status('billing', 'zzz') }) });
  assert.deepEqual(t2.res.carry.c, { s: 'status:billing:=charge:F-1', u: 'status:billing:zzz' });
});

test('eviction: answered entries go first, unanswered ones stay; the carry stays under the host limit', () => {
  let carry = null;
  for (let i = 0; i < 60; i++) {
    // F-0, the oldest entry, is never answered; every later charge is answered on the next tick
    const t = tick({ carry, events: i > 1 ? [result(`=charge:F-${i - 1}`)] : [], out: out([charge(`k${i}`, `F-${i}`)], { pad: 'x'.repeat(100) }) });
    carry = t.res.carry;
  }
  const small = envAfter(out([charge('last', 'F-last')], { pad: 'x'.repeat(100) }), envBefore({ carry, events: [] }, {}), REG, { maxEnvelopeBytes: 600 });
  const { x } = envUnwrap(small.carry);
  assert.ok(Buffer.byteLength(JSON.stringify(x)) <= 600 + 200);
  assert.ok(x.o.includes('=charge:F-0') && x.o.includes('=charge:F-last') && x.o.includes('=charge:F-59'), 'unanswered entries kept, the oldest too');
  assert.ok(small.decisions.envelope.findings.some(f => f.code === 'evicted'));
  assert.ok(!small.decisions.envelope.findings.some(f => f.code === 'evicted-pending'));
  // a solver carry close to the host limit squeezes the envelope, never the solver
  const big = envAfter(out([charge('z', 'F-z')], { pad: 'y'.repeat(64 * 1024 - 900) }), envBefore({ carry, events: [] }, {}), REG);
  assert.ok(Buffer.byteLength(JSON.stringify(big.carry)) <= 64 * 1024);
  assert.ok(envUnwrap(big.carry).x.o.includes('=charge:F-0'), 'an unanswered entry is never evicted');
  // an entry still owed a result is never evicted, even over the budget (the review's D7 case: the solver would never
  // see its own result); over the host's carry limit the tick fails loudly instead
  let c = null;
  for (let i = 0; i < 6; i++) c = envAfter(out([charge(`p${i}`, `F-p${i}`)]), envBefore({ carry: c, events: [] }, {}), REG).carry;
  const tight = envAfter(out([], { pad: 'y'.repeat(100) }), envBefore({ carry: c, events: [] }, {}), REG, { maxEnvelopeBytes: 50 });
  assert.equal(envUnwrap(tight.carry).x.o.length, 6);
  assert.deepEqual(tight.decisions.envelope.findings.map(f => f.code), ['over-budget']);
  assert.throws(() => envAfter(out([], { pad: 'y'.repeat(64 * 1024 - 300) }), envBefore({ carry: c, events: [] }, {}), REG), /does not drop them/);
  // with read-back, parked failures go before anything owed
  const rb = { reconcile: true, maxEnvelopeBytes: 60 };
  const p0 = envAfter(out([]), envBefore({ carry: null, events: [] }, {}, { reconcile: true }), REG, { reconcile: true });
  const pre = envBefore({ carry: p0.carry, events: [result('=charge:F-9', 'error', { error: { code: 402, reason: 'card-declined' } })] }, {}, rb);
  const p1 = envAfter(out([]), pre, REG, rb);
  assert.deepEqual(p1.decisions.envelope.findings.map(f => f.code), ['orphan-parked', 'park-evicted']);
  assert.deepEqual(envUnwrap(p1.carry).x.p, {});
});

test('carry: a carry the envelope did not write is the solver\'s own; the envelope\'s carry round-trips', () => {
  assert.deepEqual(envUnwrap({ a: 1 }).inner, { a: 1 });
  assert.deepEqual(envUnwrap(null).inner, null);
  const t1 = tick({ out: out([], { a: 2 }) });
  const t2 = tick({ carry: t1.res.carry, out: input => out([], input.carry) });
  assert.deepEqual(t2.seen.input.carry, { a: 2 });
  assert.deepEqual(t2.res.carry.c, { a: 2 });
});

// ---------------------------------------------------------------------------------------------------------------------
// Static single-writer gate

test('single-writer gate: overlapping write kinds of two owners are problems; qualifiers that differ and reads are not', () => {
  const m = (mods, parent = []) => ({ version: 1, parent: { file: 'p.mjs', effects: parent }, modules: Object.fromEntries(Object.entries(mods).map(([k, v]) => [k, { file: `${k}.mjs`, effects: v }])) });
  assert.equal(singleWriterProblems(m({ a: ['notify.send:x'], b: ['notify.send:y'] }), REG).length, 0);
  assert.equal(singleWriterProblems(m({ a: ['notify.send'], b: ['notify.send:y'] }), REG).length, 1);
  assert.equal(singleWriterProblems(m({ a: ['orders.setStatus:fulfilment'], b: ['orders.setStatus:fulfilment:cancelled'] }), REG).length, 1);
  assert.equal(singleWriterProblems(m({ a: ['orders.setStatus:order'], b: ['orders.setStatus:fulfilment'] }), REG).length, 0);
  assert.equal(singleWriterProblems(m({ a: ['fraud.check'], b: ['fraud.check'] }), REG).length, 0);
  assert.equal(singleWriterProblems(m({ a: ['billing.charge'] }, ['billing.charge']), REG).length, 1);
});

test('single-writer gate on the six COMP-1 manifests: every C-H manifest is flagged, no C-H-T manifest is', () => {
  const flagged = {};
  for (const label of ['ch-e8-1', 'ch-e8-2', 'ch-e8-3', 'cht-e8-1', 'cht-e8-2', 'cht-e8-3']) {
    const manifest = JSON.parse(readFileSync(path.join(RUNS, label, 'program', 'composition.json'), 'utf8'));
    flagged[label] = singleWriterProblems(manifest, REG).length;
  }
  assert.ok(flagged['ch-e8-1'] > 0 && flagged['ch-e8-2'] > 0 && flagged['ch-e8-3'] > 0, JSON.stringify(flagged));
  assert.deepEqual([flagged['cht-e8-1'], flagged['cht-e8-2'], flagged['cht-e8-3']], [0, 0, 0]);
});

test('bundle2: the envelope is inlined (no imports); the gate refuses a flagged program by default and only reports it on request', () => {
  assert.ok(!/^\s*import\s/m.test(RUNTIME2_SOURCE));
  const ch = readProgram(path.join(RUNS, 'ch-e8-1', 'program'));
  const enf = bundle2({ ...ch, mode: 'strict' }, { item: e8 });
  assert.ok(enf.problems.some(p => p.startsWith('single-writer:')), 'the default refuses');
  const rep = bundle2({ ...ch, mode: 'strict' }, { item: e8, gate: 'report' });
  assert.equal(rep.problems.length, 0);
  assert.ok(rep.gate.length > 0);
  assert.match(rep.source, /withEnvelope\(/);
  const cht = readProgram(path.join(RUNS, 'cht-e8-1', 'program'));
  assert.equal(bundle2({ ...cht, mode: 'strict' }, { item: e8 }).problems.length, 0);
  assert.throws(() => bundle2({ ...cht, mode: 'strict' }, { item: e8, gate: 'off' }), /report or enforce/);
});
