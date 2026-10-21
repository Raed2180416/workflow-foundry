// Composition runtime, loader and bundle (experiments/compose/; HARNESS.md §2). $0, no model calls, no worlds.
//   node --test --test-concurrency=1 experiments/compose/test/runtime.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createComposedSolver, manifestProblems, validate, kindsOfE8, InterfaceError } from '../runtime.mjs';
import { loadProgram, sourceProblems } from '../loader.mjs';
import { bundle, programProblems } from '../bundle.mjs';
import { interfaceReport } from '../trace.mjs';
import * as e8 from '../../../beds/ebed/e8/index.mjs';

const S = { type: 'object' };
const NOW = '2026-03-02T10:00:00+01:00';
const M = () => ({ version: 1,
  parent: { file: 'parent.mjs', calls: ['pay', 'note'], effects: [] },
  modules: {
    pay: { file: 'modules/pay.mjs', rules: ['R4.2'], input: { type: 'object', required: ['amount'], properties: { amount: { type: 'integer' } } }, output: { type: ['object', 'null'] }, effects: ['billing.charge', 'billing.refund'], timers: true },
    note: { file: 'modules/note.mjs', rules: ['§4.8'], input: S, output: { type: 'null' }, effects: ['notify.send:order-cancelled'], calls: ['pay'] },
  } });
const hostCtx = (over = {}) => ({ files: { 'master/x.json': '{}' }, query: () => [], status: () => 'not-found', instances: () => [], ...over });
const tickIn = (events = [], carry = null) => ({ kind: 'case', item: 'E8', world: 'w', instance: 'i-1', now: NOW, events, carry });
const charge = key => ({ key, system: 'billing', op: 'charge', args: { orderId: 'O', fulfilmentId: 'F', customerId: 'C', amountMinor: 1, currency: 'EUR' } });

test('manifest checks: ids, schemas, effect kinds against the item, unknown calls, cycles', () => {
  const ops = Object.keys(e8.schemas.effects);
  assert.deepEqual(manifestProblems(M(), { ops, taskKinds: ['fraudReview'] }), []);
  const bad = M();
  bad.modules.pay.effects.push('billing.void');
  bad.modules.note.calls.push('ghost');
  bad.modules.pay.calls = ['note'];                                   // pay -> note -> pay: a cycle
  bad.modules.pay.input = { type: 'object', oneOf: [] };
  const p = manifestProblems(bad, { ops });
  for (const re of [/unknown effect kind billing\.void/, /unknown module ghost/, /cycle/, /oneOf is outside the portable subset/]) assert.ok(p.some(x => re.test(x)), `${re}: ${p.join(' | ')}`);
  assert.ok(manifestProblems({ ...M(), modules: { Parent: M().modules.pay } }).some(x => /id must match/.test(x)));
});

test('portable-subset validation', () => {
  assert.deepEqual(validate({ type: 'object', required: ['a'], properties: { a: { enum: [1, 2] } }, additionalProperties: false }, { a: 1 }), []);
  assert.equal(validate({ type: 'object', required: ['a'] }, {}).length, 1);
  assert.equal(validate({ type: ['string', 'null'] }, null).length, 0);
  assert.equal(validate({ type: 'object', additionalProperties: false, properties: {} }, { x: 1 }).length, 1);
});

test('E8 effect kinds: status target and status, notification template', () => {
  assert.deepEqual(kindsOfE8({ system: 'orders', op: 'setStatus', args: { orderId: 'O', fulfilmentId: null, status: 'cancelled' } }), ['orders.setStatus', 'orders.setStatus:order', 'orders.setStatus:order:cancelled']);
  assert.deepEqual(kindsOfE8({ system: 'notify', op: 'send', args: { template: 'order-cancelled' } }), ['notify.send', 'notify.send:order-cancelled']);
});

test('strict: an undeclared effect is dropped and recorded, keys are namespaced, results route back by name', () => {
  const pay = { step(input, ctx) { return { state: { n: 1 }, output: { ok: true }, effects: [charge('charge'), { key: 'n1', system: 'notify', op: 'send', args: { template: 'order-cancelled' } }] }; },
    onEvent(ev, ctx) { return { state: { ...ctx.state, seen: ev.payload.key }, output: { got: ev.payload.key } }; } };
  const note = { step() { return { output: null }; } };
  const parent = { tick(input, ctx) {
    const outs = [];
    for (const ev of input.events) { const o = ctx.ownerOf(ev); if (o) outs.push([o, ctx.deliver(ev)]); }
    if (!input.events.length) ctx.call('pay', 'F1', { amount: 5 });
    return { decisions: { subject: 'O', outs }, state: { t: (input.state?.t ?? 0) + 1 } };
  } };
  const s = createComposedSolver({ manifest: M(), parent, modules: { pay, note }, kindsOf: kindsOfE8 });
  const o1 = s.tick(tickIn(), hostCtx());
  assert.deepEqual(o1.effects.map(e => e.key), ['pay/F1/charge']);
  assert.deepEqual(o1.decisions.composition.owners, ['pay']);
  assert.equal(o1.decisions.composition.violations[0].code, 'effect-undeclared');
  assert.equal(o1.decisions.composition.dropped.length, 1);
  // The result of pay/F1/charge comes back to pay's onEvent with the local key; the parent sees the owner.
  const res = { id: 'h1', type: 'effect.result', at: NOW, source: 'billing', payload: { key: 'pay/F1/charge', system: 'billing', op: 'charge', status: 'ok' } };
  const o2 = s.tick(tickIn([res], o1.carry), hostCtx());
  assert.deepEqual(o2.decisions.outs, [[{ module: 'pay', key: 'F1' }, { got: 'charge' }]]);
  assert.deepEqual(o2.carry.m.pay.F1, { n: 1, seen: 'charge' });
  // Stateless routing: the same event routes with NO carry at all (a crash lost it).
  const o3 = s.tick(tickIn([res], null), hostCtx());
  assert.deepEqual(o3.decisions.outs[0][0], { module: 'pay', key: 'F1' });
});

test('audit mode records the same breach and lets the effect through', () => {
  const pay = { step() { return { effects: [{ key: 'n', system: 'notify', op: 'send', args: { template: 'x' } }] }; } };
  const parent = { tick(input, ctx) { ctx.call('pay', 'F', { amount: 1 }); return { decisions: { subject: null } }; } };
  const o = createComposedSolver({ manifest: M(), parent, modules: { pay, note: {} }, kindsOf: kindsOfE8, mode: 'audit' }).tick(tickIn(), hostCtx());
  assert.equal(o.effects.length, 1);
  assert.equal(o.decisions.composition.violations[0].code, 'effect-undeclared');
});

test('calls outside the graph, schema breaches and recursion are refused; a failed call leaves nothing behind', () => {
  const errors = [];
  const pay = { step(input, ctx) { ctx.emit(charge('early')); if (input.amount === 13) throw new Error('boom'); return { state: { a: input.amount }, output: null }; } };
  const note = { step(input, ctx) { return { output: null }; } };
  const parent = { tick(input, ctx) {
    for (const f of [() => ctx.call('pay', 'F', { amount: 'x' }), () => ctx.call('ghost', 'F', {}), () => ctx.call('pay', 'F', { amount: 13 }), () => ctx.call('pay', 'a/b', { amount: 1 })]) {
      try { f(); } catch (e) { errors.push(e.code ?? e.message); }
    }
    return { decisions: { subject: null } };
  } };
  const o = createComposedSolver({ manifest: M(), parent, modules: { pay, note } }).tick(tickIn(), hostCtx());
  assert.deepEqual(errors.slice(0, 2), ['input-schema', 'unknown-module']);
  assert.match(String(errors[2]), /boom/);
  assert.equal(errors[3], 'bad-key');
  assert.equal(o.effects.length, 0, 'the failed call emitted nothing');
  assert.equal(o.carry.m.pay?.F, undefined, 'and saved no state');
  // A module calling outside its declared calls (pay declares none).
  const pay2 = { step(input, ctx) { try { ctx.call('note', 'X', {}); } catch (e) { errors.push(e.code); } return { output: null }; } };
  const o2 = createComposedSolver({ manifest: M(), parent: { tick(i, c) { c.call('pay', 'F', { amount: 1 }); return { decisions: { subject: null } }; } }, modules: { pay: pay2, note } }).tick(tickIn(), hostCtx());
  assert.equal(errors.at(-1), 'call-undeclared');
  assert.equal(o2.decisions.composition.violations[0].code, 'call-undeclared');
});

test('reads outside the declaration are refused; timers need timers: true; wake-up ids are namespaced', () => {
  let err = null;
  const note = { step(input, ctx) { try { ctx.query('billing.charges', {}); } catch (e) { err = e.code; } return { output: null, obligations: { upsert: [{ id: 't', kind: 'k', anchor: null, dueAt: NOW, onDue: null }] } }; } };
  const pay = { step() { return { output: null, obligations: { upsert: [{ id: 'deadline', kind: 'k', anchor: null, dueAt: NOW, onDue: null }] } }; } };
  const parent = { tick(i, c) { c.call('note', 'O', {}); c.call('pay', 'F', { amount: 1 }); return { decisions: { subject: null } }; } };
  const o = createComposedSolver({ manifest: M(), parent, modules: { pay, note } }).tick(tickIn(), hostCtx());
  assert.equal(err, 'read-undeclared');
  assert.deepEqual(o.obligations.upsert.map(x => x.id), ['pay/F/deadline']);
  assert.ok(o.decisions.composition.violations.some(v => v.code === 'timer-undeclared' && v.module === 'note'));
});

test('after across modules resolves to the emitting module; carry and output stay valid host data', () => {
  const pay = { step() { return { output: null, effects: [charge('c1')] }; } };
  const note = { step() { return { output: null, effects: [{ key: 'n1', system: 'notify', op: 'send', args: { template: 'order-cancelled' }, after: 'c1' }] }; } };
  const parent = { tick(i, c) { c.call('pay', 'F', { amount: 1 }); c.call('note', 'O', {}); return { decisions: { subject: 'O' } }; } };
  const o = createComposedSolver({ manifest: M(), parent, modules: { pay, note }, kindsOf: kindsOfE8 }).tick(tickIn(), hostCtx());
  assert.equal(o.effects[1].after, 'pay/F/c1');
  assert.ok(JSON.stringify(o.carry).length < 64 * 1024);
});

test('loader: static scan, vm isolation (no imports, no shared globals), JSON-only bridge', () => {
  assert.ok(sourceProblems("import x from './y.mjs';\nexport function step() {}").some(p => /import/.test(p)));
  assert.ok(sourceProblems('export function step() { return process.env; }').some(p => /process/.test(p)));
  assert.deepEqual(sourceProblems('// import nothing here\nexport function step(input, ctx) { return {}; }'), []);
  const manifest = M();
  const sources = {
    'parent.mjs': 'export function tick(input, ctx) { const a = ctx.call("pay", "F", { amount: 2 }); return { decisions: { subject: null, a, leak: typeof SECRET } }; }',
    'modules/pay.mjs': 'const SECRET = 42;\nexport function step(input, ctx) { return { output: { amount: input.amount, ctor: ctx.files.constructor === Object } }; }',
    'modules/note.mjs': 'export function step() { return { output: null }; }',
  };
  const prog = loadProgram({ vm, manifest, sources });
  assert.deepEqual(prog.problems, []);
  const o = createComposedSolver({ manifest, parent: prog.parent, modules: prog.modules, realm: prog.realm }).tick(tickIn(), hostCtx());
  assert.deepEqual(o.decisions.a, { amount: 2, ctor: true });         // files arrive as the module realm's own objects
  assert.equal(o.decisions.leak, 'undefined');                         // the parent cannot see a module's variables
  // Reads through the bridge: query and status (with the module's local key namespaced), instances for the parent only.
  const seen = [];
  const sources2 = { ...sources,
    'parent.mjs': 'export function tick(input, ctx) { const a = ctx.call("pay", "F", { amount: 2 }); return { decisions: { subject: null, a, inst: ctx.instances({ subject: "O" }) } }; }',
    'modules/pay.mjs': 'export function step(input, ctx) { let err = null; try { ctx.instances({}); } catch (e) { err = e.code; } return { output: { rows: ctx.query("billing.charges", { where: { orderId: "O" } }), st: ctx.status("billing", "charge"), err } }; }' };
  const prog2 = loadProgram({ vm, manifest, sources: sources2 });
  const o2 = createComposedSolver({ manifest, parent: prog2.parent, modules: prog2.modules, realm: prog2.realm }).tick(tickIn(), hostCtx({
    query: (t, f) => { seen.push(['query', t, f]); return [{ chargeId: 'C1' }]; }, status: (sys, k) => { seen.push(['status', sys, k]); return 'committed'; }, instances: f => [{ instance: 'i-9', subject: f.subject }] }));
  assert.deepEqual(o2.decisions.a, { rows: [{ chargeId: 'C1' }], st: 'committed', err: 'instances-module' });
  assert.deepEqual(o2.decisions.inst, [{ instance: 'i-9', subject: 'O' }]);
  assert.deepEqual(seen, [['query', 'billing.charges', { where: { orderId: 'O' } }], ['status', 'billing', 'pay/F/charge']]);
});

test('bundle: the harness-built solver.mjs runs as an ordinary tick/1 solver and carries its trace', async () => {
  const manifest = M();
  const sources = { 'parent.mjs': 'export function tick(input, ctx) { ctx.call("pay", "F", { amount: 1 }); return { decisions: { subject: "O" } }; }',
    'modules/pay.mjs': 'export function step(input, ctx) { return { output: null, effects: [{ key: "c", system: "billing", op: "charge", args: {} }] }; }',
    'modules/note.mjs': 'export function step() { return { output: null }; }' };
  assert.deepEqual(programProblems({ manifest, sources }, { item: e8 }), []);
  const b = bundle({ manifest, sources }, { item: e8 });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(b.source).toString('base64')}`);
  const out = mod.createSolver().tick(tickIn(), hostCtx());
  assert.deepEqual(out.effects.map(e => e.key), ['pay/F/c']);
  // The analyst re-verifies the trace against the TRUSTED manifest from journal-shaped rows.
  const rows = [{ type: 'call', kind: 'case', target: 'i-1', outcome: 'ok', output: out }];
  const rep = interfaceReport(rows, manifest);
  assert.equal(rep.integrity.length, 0);
  const forged = structuredClone(out);
  forged.decisions.composition.owners = ['note'];                      // a trace claiming note emitted the charge
  assert.equal(interfaceReport([{ ...rows[0], output: forged }], manifest).integrity.length, 1);
  assert.ok(programProblems({ manifest, sources: { ...sources, 'modules/pay.mjs': 'export function step( {' } }, { item: e8 }).some(p => /syntax/.test(p)));
});

test('an error the parent does not catch fails the tick with the composition summary in the message', () => {
  const s = createComposedSolver({ manifest: M(), parent: { tick(i, c) { c.call('pay', 'F', { amount: 'no' }); } }, modules: { pay: { step() { return {}; } }, note: {} } });
  assert.throws(() => s.tick(tickIn(), hostCtx()), e => /input-schema/.test(e.message) && /\[composition/.test(e.message));
  assert.ok(new InterfaceError('x', 'y') instanceof Error);
});
