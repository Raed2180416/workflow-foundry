// Regression tests for the adversarial review of the host (2026-10-14; README §11). Each test names its finding and
// fails on the host as it was before the fix. Toy d1 worlds (test/toy.mjs), seeds from the E-bed dev block, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonical } from '../../../lib/canonical.mjs';
import * as H from '../index.mjs';
import { p2pItem, p2pWorld, p2pSolver, sagaItem, sagaWorld, SEEDS, APPROVE_SCHEMA } from './toy.mjs';

const rowsOf = res => res.host.journal.contentRows();
const ofType = (res, t) => rowsOf(res).filter(r => r.type === t);
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'ebed-host-review-'));
const T0 = '2026-03-02T08:00:00+01:00';
const at = m => H.addMinutes(T0, m);
const quiet = (opts = {}) => p2pWorld({ seed: 1151, cases: 2, backlog: 0, faults: false, duplicates: false, noise: {}, ...opts });
const resultsSeen = log => log.flatMap(l => l.events).filter(e => e.type === 'effect.result').map(e => e.payload);

/** An arm that registers (optionally), posts, and pays `after` the post; optionally reconciles an unknown post. */
function postPayArm({ registerFirst, reconcile = false, log = [] }) {
  return {
    id: 'post-pay',
    tick(input, ctx) {
      log.push({ instance: input.instance, events: input.events });
      const doc = input.events.find(e => e.type === 'doc.received');
      if (doc) {
        const p = doc.payload;
        const reg = { key: `r:${p.invoiceId}`, system: 'erp', op: 'registerInvoice', args: { invoiceId: p.invoiceId, vendorId: p.vendorId, vendorInvoiceNo: p.vendorInvoiceNo, poNumber: p.poNumber, invoiceDate: p.invoiceDate, lines: p.lines, chargesMinor: 0, totalMinor: p.totalMinor, currency: 'EUR', sourceDoc: null } };
        const post = { key: `p:${p.invoiceId}`, system: 'erp', op: 'post', args: { postingId: `P-${p.invoiceId}`, invoiceId: p.invoiceId, amountMinor: p.totalMinor, currency: 'EUR' } };
        const pay = { key: `y:${p.invoiceId}`, system: 'bank', op: 'pay', args: { invoiceId: p.invoiceId, vendorId: p.vendorId, amountMinor: p.totalMinor, currency: 'EUR' }, after: post.key };
        return { decisions: { subject: p.invoiceId }, effects: registerFirst ? [reg, post, pay] : [post, pay], carry: { p, pay: { ...pay, after: undefined } } };
      }
      const c = input.carry;
      const unknownPost = input.events.find(e => e.type === 'effect.result' && e.payload.op === 'post' && e.payload.status === 'unknown');
      if (reconcile && unknownPost && ctx.status('erp', unknownPost.payload.key) === 'committed') {
        const { after, ...pay } = c.pay;
        return { decisions: { subject: c.p.invoiceId }, effects: [pay], carry: c };
      }
      return { decisions: { subject: c?.p.invoiceId ?? null }, carry: c ?? null };
    },
  };
}
const f3OnPost = w => ({ ...w, faults: Object.keys(w.truth.cases).filter(c => w.truth.cases[c].subject).map(c => ({ case: c, system: 'erp', op: 'post', ordinal: 1, kind: 'F3' })) });

// ---------------------------------------------------------------------------------------------------------------------
test('finding 1 (P0): an F3 result is identical whether or not the request committed; it never says "commit"', async () => {
  // Mock level: the same error, no result, whatever happened behind it.
  const bank = new H.MockSystem(H.e1.bank);
  bank.write('vendorAccounts', { vendorId: 'V1', iban: 'X' });
  const committed = bank.apply('pay', { invoiceId: 'I1', vendorId: 'V1', amountMinor: 5, currency: 'EUR' }, 'k1', 0, { fault: 'F3', ctx: { now: 'x' } });
  const failed = bank.apply('pay', { invoiceId: 'I2', vendorId: 'NOPE', amountMinor: 5, currency: 'EUR' }, 'k2', 0, { fault: 'F3', ctx: { now: 'x' } });
  assert.equal(committed.committed, true); assert.equal(failed.committed, false);
  const visible = r => ({ status: r.status, error: r.error, result: r.result });
  assert.deepEqual(visible(committed), visible(failed));
  assert.deepEqual(committed.error, { code: 'timeout', reason: 'timeout' });

  // Host level: the arm-visible post result (and the dependant's) is the same in a world where the post commits and
  // in one where it cannot (H-7); the journal keeps the truth.
  const logA = [], logB = [];
  const a = await H.runWorld({ item: p2pItem, world: f3OnPost(quiet()), arm: postPayArm({ registerFirst: true, log: logA }), profile: 'bare' });
  const b = await H.runWorld({ item: p2pItem, world: f3OnPost(quiet()), arm: postPayArm({ registerFirst: false, log: logB }), profile: 'bare' });
  const postPay = log => resultsSeen(log).filter(p => p.op !== 'registerInvoice');
  assert.equal(postPay(logA).length, 4);
  assert.deepEqual(postPay(logA), postPay(logB), 'the arm cannot tell a committed F3 from an uncommitted one');
  for (const p of postPay(logA).filter(x => x.op === 'post')) assert.deepEqual(p, { key: p.key, system: 'erp', op: 'post', status: 'unknown', error: { code: 'timeout', reason: 'timeout' } });
  assert.deepEqual(ofType(a, 'ledger').filter(r => r.op === 'post').map(r => [r.committed, r.faultTags]), [[true, ['F3']], [true, ['F3']]]);
  assert.deepEqual(ofType(b, 'ledger').filter(r => r.op === 'post').map(r => [r.committed, r.faultTags]), [[false, ['F3']], [false, ['F3']]]);

  // Seeded runs: every unknown outcome an arm receives carries exactly the F3 error and nothing truth-derived.
  for (const seed of SEEDS.slice(0, 8)) {
    const log = [];
    const base = p2pSolver();
    await H.runWorld({ item: p2pItem, world: p2pWorld({ seed }), arm: { ...base, tick(input, ctx) { log.push({ events: input.events }); return base.tick(input, ctx); } } });
    const unknown = resultsSeen(log).filter(p => p.status === 'unknown');
    for (const p of unknown) {
      assert.deepEqual(p.error, { code: 'timeout', reason: 'timeout' });
      assert.ok(Object.keys(p).every(k => ['key', 'system', 'op', 'status', 'error', 'attempts'].includes(k)), JSON.stringify(p));
    }
    assert.ok(!/commit/i.test(JSON.stringify(resultsSeen(log).map(p => p.error ?? null))), 'no result error mentions a commit');
  }
});

test('finding 2 (P1): `after` follows the outcome the arm observes; an unknown predecessor gives predecessor-unknown and nothing is applied', async () => {
  const logA = [], logB = [];
  const a = await H.runWorld({ item: p2pItem, world: f3OnPost(quiet()), arm: postPayArm({ registerFirst: true, log: logA }), profile: 'bare' });
  const b = await H.runWorld({ item: p2pItem, world: f3OnPost(quiet()), arm: postPayArm({ registerFirst: false, log: logB }), profile: 'bare' });
  for (const [res, log] of [[a, logA], [b, logB]]) {
    const pays = resultsSeen(log).filter(p => p.op === 'pay');
    assert.equal(pays.length, 2);
    for (const p of pays) assert.deepEqual(p.error, { code: 'predecessor-unknown' });
    assert.equal(res.host.systems.get('bank').db.payments.size, 0, 'the dependant is not applied on an unknown predecessor');
    assert.equal(ofType(res, 'effect.skipped').filter(s => s.reason === 'predecessor-unknown').length, 2);
  }
  // An arm that reconciles with status(key) pays exactly once per invoice where the post committed, and never where
  // it did not.
  const r1 = await H.runWorld({ item: p2pItem, world: f3OnPost(quiet()), arm: postPayArm({ registerFirst: true, reconcile: true }), profile: 'bare' });
  assert.equal(r1.host.systems.get('bank').db.payments.size, 2);
  const r2 = await H.runWorld({ item: p2pItem, world: f3OnPost(quiet()), arm: postPayArm({ registerFirst: false, reconcile: true }), profile: 'bare' });
  assert.equal(r2.host.systems.get('bank').db.payments.size, 0);
  // Under temporal-like the platform retries the F3 with the same key (deduplicated, ok), so the dependant runs once.
  const tl = await H.runWorld({ item: p2pItem, world: f3OnPost(quiet()), arm: postPayArm({ registerFirst: true }), profile: 'temporal-like' });
  assert.equal(tl.host.systems.get('bank').db.payments.size, 2);
  assert.equal(tl.host.systems.get('erp').db.postings.size, 2, 'the platform retry deduplicated');
  assert.equal(ofType(tl, 'effect.skipped').length, 0);
});

test('finding 3 (P1): only a host-generated reply is routed by ref; a world arrival quoting an arm-placed ref starts its own instance', async () => {
  const base = p2pWorld({ seed: 1152, cases: 2, backlog: 0, faults: false, duplicates: false, noise: {} });
  const first = base.arrivals.filter(e => e.channel.kind === 'inbound')[0];
  const later = { id: 'vendor-msg', type: 'message.received', at: H.addMinutes(first.at, 600), source: 'vendor', channel: { kind: 'inbound' }, payload: { ref: first.payload.poNumber, text: 'price change' } };
  const world = { ...base, arrivals: [...base.arrivals, later], truth: { ...base.truth, eventCase: { ...base.truth.eventCase, 'vendor-msg': base.truth.eventCase[first.id] } } };
  const arm = {
    id: 'ref-by-po',
    tick(input) {
      const d = input.events.find(e => e.type === 'doc.received');
      // The arm uses a business key (the PO number) as its outbound ref.
      const effects = d ? [{ key: `m:${d.id}`, system: 'mail', op: 'send', args: { to: 'ap@x', about: d.payload.invoiceId, template: null, subject: 'noted', body: '.', ref: d.payload.poNumber } }] : [];
      return { decisions: { subject: d?.payload.invoiceId ?? input.carry }, effects, carry: d?.payload.invoiceId ?? input.carry };
    },
  };
  const res = await H.runWorld({ item: p2pItem, world, arm });
  const placed = new Map(ofType(res, 'ref.placed').map(r => [r.ref, r.instance]));
  assert.ok(placed.has(first.payload.poNumber), 'the arm placed the PO number as its ref');
  const vendor = ofType(res, 'deliver').find(d => d.event.id === 'vendor-msg');
  assert.equal(vendor.route, 'start', 'a world arrival is never routed by ref');
  assert.notEqual(vendor.instance, placed.get(first.payload.poNumber));
  const replies = ofType(res, 'deliver').filter(d => d.event.type === 'message.received' && d.event.id !== 'vendor-msg');
  assert.equal(replies.length, 2);
  for (const d of replies) { assert.equal(d.route, 'ref', 'the counterparty reply to the arm\'s message is'); assert.equal(d.instance, placed.get(d.event.payload.ref)); }
});

test('finding 4 (P1): F6 is permanent: retries under the same key or a new one fail again; the schedule refuses faults it would shadow', async () => {
  const base = sagaWorld({ seed: 1153, orders: 1, faults: false });
  const c = Object.keys(base.truth.cases)[0];
  const world = { ...base, faults: [{ case: c, system: 'carrier', op: 'create', ordinal: 1, kind: 'F6' }] };
  const seen = [];
  const arm = { id: 'retry-permanent', tick(input) {
    const o = input.events.find(e => e.type === 'order.placed');
    const r = input.events.find(e => e.type === 'effect.result');
    const n = (input.carry?.n ?? 0);
    const ship = (id, key) => ({ key, system: 'carrier', op: 'create', args: { orderId: id, fulfilmentId: `${id}-F1`, location: 'AMS', ref: null } });
    if (o) return { decisions: { subject: o.payload.orderId }, effects: [ship(o.payload.orderId, 's1')], carry: { id: o.payload.orderId, n: 1 } };
    if (r) seen.push(`${r.payload.status}:${r.payload.error?.reason ?? ''}`);
    if (r && r.payload.status === 'error' && n < 4) return { decisions: { subject: input.carry.id }, effects: [ship(input.carry.id, n < 3 ? 's1' : 's2')], carry: { ...input.carry, n: n + 1 } };
    return { decisions: { subject: input.carry?.id ?? null }, carry: input.carry ?? null };
  } };
  const res = await H.runWorld({ item: sagaItem, world, arm, profile: 'bare' });
  assert.deepEqual(seen, Array(4).fill('error:permanent-failure'));
  assert.equal(res.host.systems.get('carrier').db.shipments.size, 0);
  assert.deepEqual(ofType(res, 'ledger').filter(r => r.op === 'create').map(r => [r.ordinal, r.faultTags, r.key]), [[1, ['F6'], 's1'], [2, ['F6'], 's1'], [3, ['F6'], 's1'], [4, ['F6'], 's2']]);
  // Schedule: F6 takes no repeat; a fault on an attempt an F6 already covers is refused; one before it is accepted.
  const systems = new Map(sagaItem.systems.map(d => [d.id, new H.MockSystem(d)]));
  const sched = faults => H.faultSchedule({ faults }, systems, H.toMs);
  assert.throws(() => sched([{ case: c, system: 'carrier', op: 'create', ordinal: 1, kind: 'F6', params: { repeat: 2 } }]), /no repeat/);
  assert.throws(() => sched([{ case: c, system: 'carrier', op: 'create', ordinal: 2, kind: 'F6' }, { case: c, system: 'carrier', op: 'create', ordinal: 3, kind: 'F2' }]), /fails permanently/);
  assert.throws(() => sched([{ case: c, system: 'carrier', op: 'create', ordinal: 2, kind: 'F6' }, { case: c, system: 'carrier', op: 'create', ordinal: 1, kind: 'F2', params: { repeat: 2 } }]), /fails permanently/);
  const ok = sched([{ case: c, system: 'carrier', op: 'create', ordinal: 3, kind: 'F6' }, { case: c, system: 'carrier', op: 'create', ordinal: 1, kind: 'F2', params: { repeat: 2 } }]);
  assert.deepEqual([1, 2, 3, 4, 99].map(n => ok.lookup(c, 'carrier', 'create', n)?.kind ?? null), ['F2', 'F2', 'F6', 'F6', 'F6']);
  assert.equal(ok.lookup('other', 'carrier', 'create', 5), null);
});

test('finding 5 (P1): the product engine sees every row; the arm\'s query stays limited to 1,000', async () => {
  const seen = [];
  const item = { ...p2pItem, product: { compute({ rows, query }) { seen.push([rows('erp', 'vendors').length, query('erp.vendors', {}).length, query('erp.vendors', { limit: 10 }).length]); return []; } } };
  const w = quiet({ cases: 1 });
  w.sor['erp.vendors'] = [...w.sor['erp.vendors'], ...Array.from({ length: 1500 }, (_, i) => ({ vendorId: `VX${String(i).padStart(5, '0')}`, name: `X ${i}`, group: 'G-X', terms: 'N30' }))];
  const armReads = [];
  await H.runWorld({ item, world: w, arm: { id: 'reader', tick(input, ctx) { armReads.push(ctx.query('erp.vendors', {}).length); return { decisions: { subject: null }, carry: null, close: true }; } }, profile: 'product' });
  assert.ok(seen.length > 0);
  assert.deepEqual(seen.at(-1), [1505, 1505, 10]);
  assert.ok(armReads.length > 0 && armReads.every(n => n === 1000));
});

test('finding 6 (P1): the host refuses, untouched, a non-empty workspace it did not create or one of another run', async () => {
  const dir = tmp();
  try {
    const user = path.join(dir, 'user');
    mkdirSync(path.join(user, 'precious'), { recursive: true });
    writeFileSync(path.join(user, 'precious', 'thesis.md'), 'do not delete');
    writeFileSync(path.join(user, 'notes.txt'), 'x');
    const mk = (id, wsDir) => ({ ...p2pSolver({ id }), workspace: { dir: wsDir } });
    assert.throws(() => H.createHost({ item: p2pItem, world: quiet(), arm: mk('ws', user) }), /not empty and was not created by the host/);
    assert.deepEqual(readdirSync(user).sort(), ['notes.txt', 'precious']);
    assert.equal(readFileSync(path.join(user, 'precious', 'thesis.md'), 'utf8'), 'do not delete');
    // A fresh directory is claimed (marker) and the marker is never part of a snapshot.
    const own = path.join(dir, 'own');
    const res = await H.runWorld({ item: p2pItem, world: quiet(), arm: { ...mk('ws-a', own), tick(input, ctx) { writeFileSync(path.join(ctx.workspace, 'n.txt'), input.now); return p2pSolver().tick(input, ctx); } } });
    assert.ok(readdirSync(own).includes(H.WORKSPACE_MARKER));
    const last = ofType(res, 'call').at(-1).workspace;
    assert.equal(last.files, 1, 'only the arm\'s file is in the snapshot');
    // Another arm, or another world, may not take it over; the same (arm, world) may.
    assert.throws(() => H.createHost({ item: p2pItem, world: quiet(), arm: mk('ws-b', own) }), /belongs to another run/);
    assert.throws(() => H.createHost({ item: p2pItem, world: quiet({ seed: 1152 }), arm: mk('ws-a', own) }), /belongs to another run/);
    assert.doesNotThrow(() => H.createHost({ item: p2pItem, world: quiet(), arm: mk('ws-a', own) }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------
test('finding 8 (P2): a ctx is revoked when its call settles; late costs or reads throw and never change a journaled row', async () => {
  const dir = tmp();
  try {
    const base = p2pSolver();
    const late = [];
    const arm = { ...base, id: 'late', tick(input, ctx) {
      setTimeout(() => {
        for (const f of [() => ctx.recordCost({ usd: 1 }), () => ctx.query('erp.invoices', {}), () => ctx.status('bank', 'k'), () => ctx.instances({})]) {
          try { f(); late.push('no error'); } catch (e) { late.push(e.message); }
        }
      }, 0);
      ctx.recordCost({ model: 'claude-haiku-5-5', usd: 0.5, source: 'model-journal' });
      return base.tick(input, ctx);
    } };
    const file = path.join(dir, 'j.jsonl');
    const res = await H.runWorld({ item: p2pItem, world: p2pWorld({ seed: 1154, cases: 4 }), arm, journalFile: file });
    await new Promise(r => setTimeout(r, 50));
    const calls = ofType(res, 'call').filter(c => c.kind === 'case');
    assert.ok(calls.length > 0 && late.length === 4 * calls.length, `${late.length} late attempts, ${calls.length} case calls`);
    assert.ok(late.every(m => /after the call settled/.test(m)), late.find(m => !/after the call settled/.test(m)));
    assert.ok(calls.every(c => c.costs.length === 1 && c.costs[0].usd === 0.5));
    const disk = H.readJournal(file).filter(r => !H.CONTROL_TYPES.has(r.type)).map(({ seq, prev, hash, ...c }) => c);
    assert.equal(canonical(disk), canonical(rowsOf(res)), 'the in-memory journal equals the file');
    assert.doesNotThrow(() => H.verifyChain(res.host.journal.rows.map(r => ({ ...r }))));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('finding 9 (P2): world times must be whole seconds and world writes may not precede t0', () => {
  const ok = quiet();
  const sub = s => s.replace(/(Z|[+-]\d\d:\d\d)$/, '.500$1');
  const w0 = ok.writes[0];
  const bad = [
    { ...ok, t0: sub(ok.t0) },
    { ...ok, arrivals: [{ ...ok.arrivals[0], at: sub(ok.arrivals[0].at) }, ...ok.arrivals.slice(1)] },
    { ...ok, writes: [{ ...w0, at: sub(w0.at) }] },
    { ...ok, writes: [{ ...w0, at: H.addMinutes(ok.t0, -5) }] },
    { ...ok, sweepTimes: { ...ok.sweepTimes, unblock: [sub(ok.sweepTimes.unblock[0])] } },
    { ...ok, faults: [{ at: sub(at(60)), system: 'erp', op: 'hold', kind: 'F5', params: { from: 'invoiceId', to: 'invoiceRef' } }] },
    { ...ok, rulebook: { editions: [{ ...ok.rulebook.editions[1], published: sub(ok.rulebook.editions[1].published) }] } },
  ];
  for (const [i, w] of bad.entries()) assert.throws(() => H.createHost({ item: p2pItem, world: w, arm: p2pSolver() }), /whole seconds|before t0/, `case ${i}`);
  assert.doesNotThrow(() => H.createHost({ item: p2pItem, world: ok, arm: p2pSolver() }));
});

test('finding 10 (P2): an F5 rename of a subject argument or of `ref` is followed by the host (validator, fault keying, counterparty, API file)', async () => {
  const w = quiet({ cases: 1, backlog: 1 });
  w.arrivals = [];
  w.sweepTimes = { unblock: [at(60), at(120)] };
  w.faults = [
    { at: T0, system: 'erp', op: 'hold', kind: 'F5', params: { from: 'invoiceId', to: 'invoiceRef' } },
    { at: T0, system: 'mail', op: 'send', kind: 'F5', params: { from: 'ref', to: 'replyRef' } },
  ];
  const inv = w.truth.cases.c001.subject;
  let sweeps = 0;
  const apis = [];
  const arm = {
    id: 'renamed',
    tick(input, ctx) {
      apis.push(JSON.parse(ctx.files['api/erp.schema.json']).ops.hold.subjectArgs);
      if (input.events.some(e => e.type === 'migration')) {
        return { decisions: { subject: inv }, effects: [{ key: 'm1', system: 'mail', op: 'send', args: { to: 'v@x', about: inv, template: null, subject: 'q', body: 'b', replyRef: 'REF-1' } }], carry: { inv } };
      }
      return { decisions: { subject: inv }, carry: input.carry };
    },
    sweep() {
      sweeps++;
      // The first sweep uses the new name (correct); the second the retired one (must reach the mock and get its 400).
      const args = sweeps === 1 ? { holdId: 'H1', invoiceRef: inv, lineNo: null, reason: 'price' } : { holdId: 'H2', invoiceId: inv, lineNo: null, reason: 'price' };
      return { effects: [{ key: `h${sweeps}`, system: 'erp', op: 'hold', args }], carry: null };
    },
  };
  const res = await H.runWorld({ item: p2pItem, world: w, arm });
  assert.equal(ofType(res, 'arm.error').length, 0, 'neither sweep output is an arm error');
  const holds = ofType(res, 'ledger').filter(r => r.op === 'hold').map(r => [r.status, r.error?.reason ?? null, r.faultTags, r.subjectCase]);
  assert.deepEqual(holds, [['ok', null, [], 'c001'], ['error', 'field-renamed', ['F5'], 'c001']]);
  const reply = ofType(res, 'deliver').find(d => d.event.type === 'message.received');
  assert.equal(reply.route, 'ref', 'a renamed `ref` is still the reply reference');
  assert.equal(reply.event.payload.ref, 'REF-1');
  assert.ok(apis.length > 0 && apis.every(a => canonical(a) === canonical(['invoiceRef'])), 'the API file lists the renamed subject argument');
});

test('finding 11 (P2): platform retries and deferred dependants are abandoned when their instance closes', async () => {
  const base = sagaWorld({ seed: 1155, orders: 1, faults: false });
  const c = Object.keys(base.truth.cases)[0];
  const world = { ...base, faults: [{ case: c, system: 'billing', op: 'charge', ordinal: 1, kind: 'F2', params: { repeat: 3 } }] };
  const arm = { id: 'charge-and-close', tick(input) {
    const o = input.events.find(e => e.type === 'order.placed');
    if (!o) return { decisions: { subject: null }, carry: null };
    const { orderId, fulfilmentId } = o.payload;
    return { decisions: { subject: orderId }, effects: [
      { key: 'c1', system: 'billing', op: 'charge', args: { orderId, fulfilmentId: null, amountMinor: 999, currency: 'EUR' } },
      { key: 's1', system: 'carrier', op: 'create', args: { orderId, fulfilmentId, location: 'AMS', ref: null }, after: 'c1' },
    ], close: true, carry: null };
  } };
  const res = await H.runWorld({ item: sagaItem, world, arm, profile: 'temporal-like' });
  assert.equal(res.host.systems.get('billing').db.charges.size, 0, 'no charge after the instance closed');
  assert.equal(res.host.systems.get('carrier').db.shipments.size, 0);
  assert.deepEqual(ofType(res, 'ledger').map(r => [r.op, r.via]), [['charge', 'arm']]);
  assert.deepEqual(ofType(res, 'effect.abandoned').map(r => r.reason), ['instance-closed', 'instance-closed']);
  assert.deepEqual(ofType(res, 'run.end')[0].pending, [], 'no key stays pending');
});

test('finding 12 (P2): a planted form rejection of a closed task neither wakes the host nor is journaled', async () => {
  const world = p2pWorld({ seed: 1156, cases: 1, backlog: 0, faults: false, duplicates: false, noise: { form: 1, formInvalid: 1 } });
  const arm = { id: 'ask-and-close', tick(input) {
    const d = input.events.find(e => e.type === 'doc.received');
    if (!d) return { decisions: { subject: null }, carry: null };
    return { decisions: { subject: d.payload.invoiceId }, humanTasks: [{ id: 't', kind: 'approvePosting', role: 'approver', subject: d.payload.invoiceId, question: 'q', answerSchema: APPROVE_SCHEMA, dueAt: H.addMinutes(input.now, 6000), onTimeout: null }], close: true, carry: null };
  } };
  const res = await H.runWorld({ item: p2pItem, world, arm });
  const created = ofType(res, 'humanTask.created')[0];
  assert.ok(created.steps.some(s => s.type === 'form.rejected'), 'the plan had a planted rejection');
  assert.equal(ofType(res, 'form.rejected').length, 0);
  const rows = rowsOf(res);
  rows.forEach((r, i) => { if (r.type === 'wakeup') assert.notEqual(rows[i + 1].type, 'wakeup.commit'); });
});

test('finding 17 (P2): object key order in the world (which its digest ignores) does not change the journal', async () => {
  const w = p2pWorld({ seed: 1157, cases: 4, backlog: 2 });
  const reversed = o => Object.fromEntries(Object.entries(o).reverse());
  const w2 = { ...w, sor: reversed(w.sor), sweepTimes: reversed(w.sweepTimes), backlog: w.backlog.map(b => ({ ...b, export: { ...b.export, records: reversed({ ...b.export.records, 'bank.vendorAccounts': [] }) } })) };
  const w1 = { ...w, backlog: w.backlog.map(b => ({ ...b, export: { ...b.export, records: { ...b.export.records, 'bank.vendorAccounts': [] } } })) };
  assert.notEqual(JSON.stringify(w1), JSON.stringify(w2));
  const a = await H.runWorld({ item: p2pItem, world: w1, arm: p2pSolver() });
  const b = await H.runWorld({ item: p2pItem, world: w2, arm: p2pSolver() });
  assert.equal(canonical(rowsOf(a)), canonical(rowsOf(b)));
  const rp = await H.replayRun({ item: p2pItem, world: w2, journal: a.host.journal.rows });
  assert.equal(rp.ok, true, 'a journal replays against the same world whatever its key order');
});

test('finding 18 (P2): a read-only effect sharing a key does not clear that key\'s pending state', async () => {
  const base = sagaWorld({ seed: 1158, orders: 1, faults: false });
  const c = Object.keys(base.truth.cases)[0];
  const placed = base.arrivals[0].at;
  // A sweep at the same instant reads the state after round 1 applied the case-tick's effects.
  const world = { ...base, sweepTimes: { peek: [placed] }, faults: [{ case: c, system: 'billing', op: 'charge', ordinal: 1, kind: 'F2', params: { repeat: 4 } }] };
  const seen = [];
  const arm = {
    id: 'peek',
    tick(input) {
      const o = input.events.find(e => e.type === 'order.placed');
      if (!o) return { decisions: { subject: null }, carry: null };
      return { decisions: { subject: o.payload.orderId }, effects: [
        { key: 'K', system: 'billing', op: 'charge', args: { orderId: o.payload.orderId, fulfilmentId: null, amountMinor: 5, currency: 'EUR' } },
        { key: 'K', system: 'billing', op: 'status', args: { key: 'K' } },
      ], carry: null };
    },
    sweep(input, ctx) { seen.push([input.now, ctx.status('billing', 'K')]); return { carry: null }; },
  };
  const res = await H.runWorld({ item: sagaItem, world, arm, profile: 'temporal-like' });
  assert.deepEqual(seen, [[placed, 'pending']], 'pending while the platform retries, whatever a read-only effect with that key did');
  assert.equal(res.host.systems.get('billing').db.charges.size, 1);
  assert.deepEqual(ofType(res, 'run.end')[0].pending, []);
});
