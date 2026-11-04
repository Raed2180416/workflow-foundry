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
  let compared = 0, aboutNull = 0;
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
    if (name === 'notify.send' && args.about === null) { assert.equal(got.identity, null); aboutNull++; continue; }
    if (name !== 'orders.setStatus' && args.fulfilmentId === null && /fulfilmentId/.test(ent.identity)) { assert.equal(got.identity, null); continue; }
    assert.equal(got.identity, identityOf({ system, op, args }), name); compared++;
  }
  assert.ok(compared > 2000 && aboutNull > 20, `${compared} compared, ${aboutNull} about-null`);
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

test('read-back (reconcile): a crash-orphaned failure answers the re-emission; no second attempt reaches the system', () => {
  const opts = { reconcile: true };
  const rtick = ({ carry = null, events = [], out: o }) => {
    const seen = {};
    const solver = { id: 's', tick: (input, c) => { seen.input = input; return typeof o === 'function' ? o(input, c) : o; } };
    const res = withEnvelope(solver, { registry: REG, ...opts }).tick({ kind: 'case', instance: 'i-1', now: '2026-03-10T08:00:00Z', events, carry }, { status: () => 'not-found' });
    return { seen, res };
  };
  const t0 = rtick({ out: out([]) });
  // the crashed tick charged (declined); its carry is lost; the decline arrives with the redelivered events
  const declined = result('=charge:F-1', 'error', { error: { code: 402, reason: 'card-declined' } });
  const t1 = rtick({ carry: t0.res.carry, events: [declined], out: out([charge('fulfil/O-1/charge')]) });
  assert.deepEqual(t1.seen.input.events, []);                              // parked, not shown out of context
  assert.deepEqual(t1.res.effects, [{ key: '=?readback:charge:F-1', system: 'billing', op: 'status', args: { key: '=charge:F-1' } }]);
  assert.deepEqual(t1.res.decisions.envelope.findings.map(f => f.code), ['orphan-parked', 'readback']);
  // the read's result is answered with the parked outcome, under the caller's key
  const read = { id: 'r', type: 'effect.result', payload: { key: '=?readback:charge:F-1', system: 'billing', op: 'status', status: 'ok', result: { key: '=charge:F-1', status: 'not-found' } } };
  const t2 = rtick({ carry: t1.res.carry, events: [read], out: out([]) });
  assert.equal(t2.seen.input.events.length, 1);
  assert.deepEqual(t2.seen.input.events[0].payload, { key: 'fulfil/O-1/charge', system: 'billing', op: 'charge', status: 'error', error: { code: 402, reason: 'card-declined' } });
  assert.equal(t2.res.decisions.envelope.findings[0].code, 'reconciled');
  // a read-back's own result arriving again (its entry rolled back by a crash) is dropped as an orphan, never parked
  const again = rtick({ carry: t2.res.carry, events: [read], out: out([]) });
  assert.deepEqual(again.seen.input.events, []);
  assert.deepEqual(again.res.decisions.envelope.findings.map(f => f.code), ['orphan']);
  assert.deepEqual(again.res.carry.x.p, {});
  // a further result for the identity is surplus; a corrected emission later goes to the system as usual
  const t3 = rtick({ carry: t2.res.carry, events: [], out: out([charge('fulfil/O-1/charge', 'F-1', 99)]) });
  assert.equal(t3.res.effects[0].op, 'charge');
  // without the option the orphan is dropped and the re-emission is a second attempt (the default runtime2)
  const d0 = tick({ out: out([]) });
  const d1 = tick({ carry: d0.res.carry, events: [declined], out: out([charge('fulfil/O-1/charge')]) });
  assert.equal(d1.res.effects[0].op, 'charge');
  assert.deepEqual(d1.res.decisions.envelope.findings.map(f => f.code), ['orphan']);
  // and the default state carries no read-back fields, so its carry (and the journal) is byte-identical to the
  // envelope's before the option existed (the stored battery rows were made without it)
  assert.deepEqual(Object.keys(d1.res.carry.x).sort(), ['o', 'r', 'v']);
  assert.deepEqual(Object.keys(t1.res.carry.x).sort(), ['o', 'p', 'q', 'r', 't', 'v']);
  // a dependant on the outcome, or a system with no status read, keeps the real emission
  const dep = rtick({ carry: t0.res.carry, events: [declined], out: out([charge('c1'), { key: 'ship', system: 'carrier', op: 'create', args: { orderId: 'O-1', fulfilmentId: 'F-1' }, after: 'c1' }]) });
  assert.equal(dep.res.effects[0].op, 'charge');
  // parks expire after three ticks without a re-emission
  let c = t0.res.carry;
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

test('bundle2: the envelope is inlined (no imports), the gate is reported, and enforce mode refuses a flagged program', () => {
  assert.ok(!/^\s*import\s/m.test(RUNTIME2_SOURCE));
  const ch = readProgram(path.join(RUNS, 'ch-e8-1', 'program'));
  const rep = bundle2({ ...ch, mode: 'strict' }, { item: e8 });
  assert.equal(rep.problems.length, 0);
  assert.ok(rep.gate.length > 0);
  assert.match(rep.source, /withEnvelope\(/);
  const enf = bundle2({ ...ch, mode: 'strict' }, { item: e8, gate: 'enforce' });
  assert.ok(enf.problems.some(p => p.startsWith('single-writer:')));
  const cht = readProgram(path.join(RUNS, 'cht-e8-1', 'program'));
  assert.equal(bundle2({ ...cht, mode: 'strict' }, { item: e8, gate: 'enforce' }).problems.length, 0);
});
