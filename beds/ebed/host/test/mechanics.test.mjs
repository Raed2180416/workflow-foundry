// Contract mechanics of the E-bed host (BED-CONTRACT-v1.1 §3–§4): wake-up rounds and merges, reply routing by `ref`,
// the obligation scheduler, `after` deferral, batch ops under F4, the product profile, rulebook editions and F5 API
// files, workspace limits, documents as files, world and output validation, pending keys, and the E7 systems.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as H from '../index.mjs';
import { e7, common } from '../index.mjs';
import { p2pItem, p2pWorld, p2pSolver, sagaItem, sagaWorld, APPROVE_SCHEMA } from './toy.mjs';

const rowsOf = res => res.host.journal.contentRows();
const ofType = (res, t) => rowsOf(res).filter(r => r.type === t);
const T0 = '2026-03-02T08:00:00+01:00';
const at = m => H.addMinutes(T0, m);
const quiet = (opts = {}) => p2pWorld({ seed: 1101, cases: 3, backlog: 1, faults: false, duplicates: false, noise: {}, ...opts });
const empty = (input, extra = {}) => ({ decisions: { subject: input.carry?.subject ?? null }, carry: input.carry ?? null, ...extra });
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'ebed-host-'));

test('rounds: an inbound event merged into an existing instance is re-delivered to it in round 3 of the same instant', async () => {
  const w = quiet();
  const first = w.arrivals.find(e => e.channel.kind === 'inbound');
  const second = { ...first, id: 'ev-again', at: H.addMinutes(first.at, 3 * 24 * 60) };
  w.arrivals.push(second);
  w.truth.eventCase[second.id] = w.truth.eventCase[first.id];
  const log = [];
  const arm = {
    id: 'merger',
    tick(input, ctx) {
      log.push({ instance: input.instance, now: input.now, events: input.events.map(e => e.id) });
      const doc = input.events.find(e => e.type === 'doc.received');
      if (!doc) return empty(input);
      const subject = doc.payload.invoiceId;
      const owner = ctx.instances({ subject }).find(r => r.instance !== input.instance);
      if (owner) return { decisions: { subject }, merge: { into: owner.instance }, carry: null };
      return { decisions: { subject }, carry: { subject } };
    },
  };
  const res = await H.runWorld({ item: p2pItem, world: w, arm });
  const merge = ofType(res, 'instance.merge')[0];
  assert.ok(merge, 'the second delivery merged');
  const calls = ofType(res, 'call').filter(c => c.at === second.at);
  assert.deepEqual(calls.map(c => [c.round, c.target]), [[1, merge.instance], [3, merge.into]]);
  assert.ok(log.find(l => l.instance === merge.into && l.now === second.at).events.includes('ev-again'));
  assert.ok(ofType(res, 'instance.close').some(c => c.instance === merge.instance && c.reason === 'merged'));
});

test('rounds: merge is refused outside round 1, on backlog instances, into closed or unknown instances; sweeps wake into round 3 once', async () => {
  const w = quiet();
  const arm = {
    id: 'bad-merger',
    tick(input) {
      if (input.events.some(e => e.type === 'migration')) return { decisions: { subject: null }, merge: { into: 'i-000002' }, carry: null };
      if (input.events.some(e => e.type === 'sweep.wake')) return { decisions: { subject: 'x' }, merge: { into: 'i-000001' }, carry: null };
      const doc = input.events.find(e => e.type === 'doc.received');
      if (doc && input.instance === 'i-000003') return { decisions: { subject: null }, merge: { into: 'i-999999' }, carry: null };
      return empty(input, { decisions: { subject: doc?.payload.invoiceId ?? input.carry?.subject ?? null }, carry: { subject: doc?.payload.invoiceId ?? input.carry?.subject ?? null } });
    },
    sweep(input) { return { wake: input.index.map(r => r.instance), carry: null }; },
  };
  const res = await H.runWorld({ item: p2pItem, world: w, arm });
  const errs = ofType(res, 'arm.error').map(e => [e.instance, e.detail.join(' ')]);
  assert.ok(errs.some(([i, d]) => i === 'i-000001' && /only on an instance started by an inbound event/.test(d)));
  assert.ok(errs.some(([i, d]) => i === 'i-000003' && /not an open instance/.test(d)));
  assert.ok(errs.some(([, d]) => /only in the first round/.test(d)));
  // Each woken instance ticks at most once in round 3 at a sweep instant.
  const r3 = ofType(res, 'call').filter(c => c.round === 3);
  const keys = r3.map(c => `${c.at}|${c.target}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(r3.length > 0);
});

test('reply routing: a counterparty reply quoting the arm\'s own ref reaches the sender; without an open sender it starts an instance', async () => {
  const w = quiet();
  const arm = {
    id: 'mailer',
    tick(input) {
      const doc = input.events.find(e => e.type === 'doc.received');
      if (doc) {
        const ref = `REF-${doc.payload.invoiceId}`;
        const close = doc.payload.invoiceId.endsWith('3');
        return { decisions: { subject: doc.payload.invoiceId }, effects: [{ key: `m:${ref}`, system: 'mail', op: 'send', args: { to: 'v@x', about: doc.payload.invoiceId, template: null, subject: 'qty?', body: 'please confirm', ref } }], carry: { ref }, ...(close ? { close: true } : {}) };
      }
      return empty(input);
    },
  };
  const res = await H.runWorld({ item: p2pItem, world: w, arm });
  const replies = ofType(res, 'deliver').filter(d => d.event.type === 'message.received');
  assert.equal(replies.length, 2);
  const placed = new Map(ofType(res, 'ref.placed').map(r => [r.ref, r.instance]));
  for (const d of replies) {
    const sender = placed.get(d.event.payload.ref);
    const closed = ofType(res, 'instance.close').some(c => c.instance === sender);
    if (closed) { assert.equal(d.route, 'start'); assert.notEqual(d.instance, sender); }
    else { assert.equal(d.route, 'ref'); assert.equal(d.instance, sender); }
  }
  assert.ok(replies.some(d => d.route === 'ref') && replies.some(d => d.route === 'start'));
  assert.ok(ofType(res, 'counterparty.event').every(r => typeof r.case === 'string'), 'counterparty events are bound to a truth case in the journal');
});

test('obligations: upsert replaces, cancel prevents, close drops, a past dueAt fires one minute later, onDue comes back', async () => {
  const w = quiet({ cases: 1, backlog: 1 });
  w.arrivals = []; w.sweepTimes = {};
  const seen = [];
  const arm = {
    id: 'timers',
    tick(input) {
      seen.push(...input.events.filter(e => e.type === 'timer.fired').map(e => [e.at, e.payload.obligationId, e.payload.onDue]));
      if (input.events.some(e => e.type === 'migration')) {
        return { decisions: { subject: null }, obligations: { upsert: [
          { id: 'a', kind: 'x', anchor: 'invoice', dueAt: at(60), onDue: { v: 1 } },
          { id: 'a', kind: 'x', anchor: 'invoice', dueAt: at(90), onDue: { v: 2 } },
          { id: 'b', kind: 'x', anchor: null, dueAt: at(30), onDue: null },
          { id: 'c', kind: 'x', anchor: null, dueAt: at(-5), onDue: 'past' },
          { id: 'd', kind: 'x', anchor: null, dueAt: at(500), onDue: null },
        ], cancel: ['b'] }, carry: { n: 0 } };
      }
      if (input.events.some(e => e.payload.obligationId === 'a')) return { decisions: { subject: null }, close: true, carry: null };
      return empty(input);
    },
  };
  const res = await H.runWorld({ item: p2pItem, world: w, arm });
  assert.deepEqual(seen, [[at(1), 'c', 'past'], [at(90), 'a', { v: 2 }]]);
  const close = ofType(res, 'instance.close')[0];
  assert.deepEqual(close.droppedObligations, ['d']);
  assert.ok(ofType(res, 'obligation.upsert').find(o => o.id === 'c').clamped);
});

test('after: a failed predecessor skips the dependant (bare); under temporal-like the dependant waits for the retried predecessor', async () => {
  const base = sagaWorld({ seed: 1102, orders: 2, faults: false });
  const cases = Object.keys(base.truth.cases);
  const world = { ...base, faults: [{ case: cases[0], system: 'billing', op: 'charge', ordinal: 1, kind: 'F2', params: { repeat: 2 } }] };
  const arm = {
    id: 'chain',
    tick(input) {
      const ev = input.events.find(e => e.type === 'order.placed');
      if (!ev) return empty(input);
      const { orderId, fulfilmentId } = ev.payload;
      return { decisions: { subject: orderId }, effects: [
        { key: `c:${orderId}`, system: 'billing', op: 'charge', args: { orderId, fulfilmentId, amountMinor: 500, currency: 'EUR' } },
        { key: `s:${orderId}`, system: 'carrier', op: 'create', args: { orderId, fulfilmentId, location: 'AMS', ref: null }, after: `c:${orderId}` },
      ], carry: null };
    },
  };
  const bare = await H.runWorld({ item: sagaItem, world, arm, profile: 'bare' });
  assert.equal(ofType(bare, 'effect.skipped').length, 1);
  assert.equal(bare.host.systems.get('carrier').db.shipments.size, 1);
  const tl = await H.runWorld({ item: sagaItem, world, arm, profile: 'temporal-like' });
  assert.equal(ofType(tl, 'effect.deferred').length, 1);
  const ship = ofType(tl, 'ledger').filter(r => r.op === 'create');
  const charge = ofType(tl, 'ledger').filter(r => r.op === 'charge' && r.committed);
  assert.equal(ship.length, 2);
  const deferredShip = ship.find(s => s.subjectCase === cases[0]);
  assert.equal(deferredShip.at, charge.find(c => c.subjectCase === cases[0]).at, 'applied at the instant the predecessor committed');
  assert.equal(deferredShip.at, H.addSeconds(at(60), 3), 'after the 1 s and 2 s retries');
});

test('batch ops: F4 applies k of n items and the result is partial; resubmitting the same item keys applies only the missing ones', async () => {
  const w = quiet({ cases: 2, backlog: 2 });
  w.arrivals = []; w.sweepTimes = {};
  const cs = Object.keys(w.truth.cases).filter(c => w.truth.cases[c].subject);
  w.faults = [{ case: cs[1], system: 'bank', op: 'payRun', ordinal: 1, kind: 'F4' }];
  const runOnce = { done: false };
  const results = [];
  const arm = {
    id: 'runner',
    tick(input) {
      results.push(...input.events.filter(e => e.type === 'effect.result').map(e => e.payload));
      const items = cs.map(c => ({ key: `pay:${w.truth.cases[c].subject}`, invoiceId: w.truth.cases[c].subject, vendorId: 'V001', amountMinor: 1000, currency: 'EUR' }));
      if (!runOnce.done && input.instance === 'i-000001') { runOnce.done = true; return { decisions: { subject: null }, effects: [{ system: 'bank', op: 'payRun', args: { runId: 'R1', items } }], carry: null }; }
      if (input.events.some(e => e.type === 'effect.result' && e.payload.status === 'partial') && results.length < 3) return { decisions: { subject: null }, effects: [{ system: 'bank', op: 'payRun', args: { runId: 'R2', items } }], carry: null };
      return empty(input);
    },
  };
  const res = await H.runWorld({ item: p2pItem, world: w, arm });
  assert.equal(results[0].status, 'partial');
  assert.deepEqual(results[0].items.map(i => i.status), ['ok', 'error']);
  assert.equal(results[1].status, 'ok');
  assert.equal(res.host.systems.get('bank').db.payments.size, 2, 'one payment per invoice after the resubmission');
  const f4 = ofType(res, 'ledger').filter(r => r.faultTags.includes('F4'));
  assert.equal(f4.length, 1); assert.equal(f4[0].injected, true); assert.equal(f4[0].batchIndex, 1);
});

test('product profile: the engine computes product-computed fields readable by the arm; Track P strips them from every read', async () => {
  const product = {
    compute({ rows }) {
      return rows('erp', 'matches').map(m => ({ system: 'erp', table: 'matches', pk: m.matchId, fields: { priceTotals: 'passed', netUnitPrice: 'passed', quantity: 'passed', charges: 'notChecked', invoiceTotals: 'passed' } }));
    },
  };
  const item = { ...p2pItem, product };
  const reads = [];
  const arm = {
    id: 'reader',
    tick(input, ctx) {
      reads.push(ctx.query('erp.matches', {}));
      const m = input.events.find(e => e.type === 'migration');
      if (m) {
        const inv = m.payload.records['erp.invoices'][0];
        return { decisions: { subject: inv.invoiceId }, effects: [{ key: `m:${inv.invoiceId}`, system: 'erp', op: 'setMatch', args: { invoiceId: inv.invoiceId, lineNo: 1, priceTotals: 'failed', netUnitPrice: 'failed', quantity: 'failed', charges: 'failed', invoiceTotals: 'failed' } }],
          obligations: { upsert: [{ id: 'look', kind: 'x', anchor: null, dueAt: H.addMinutes(input.now, 10), onDue: null }] }, carry: null };
      }
      return empty(input);
    },
  };
  const w = () => { const x = quiet({ cases: 1, backlog: 1 }); x.arrivals = []; x.sweepTimes = {}; return x; };
  await H.runWorld({ item, world: w(), arm, profile: 'product' });
  assert.equal(reads.at(-1)[0].priceTotals, 'passed', 'Track C: the product engine\'s value');
  reads.length = 0;
  await H.runWorld({ item, world: w(), arm, profile: 'bare' });
  assert.ok(reads.at(-1).length === 1 && !('priceTotals' in reads.at(-1)[0]), 'Track P: product-computed fields are never in an arm read');
  const bad = { ...item, product: { compute: ({ rows }) => rows('erp', 'matches').map(m => ({ system: 'erp', table: 'matches', pk: m.matchId, fields: { invoiceId: 'X' } })) } };
  await assert.rejects(H.runWorld({ item: bad, world: w(), arm, profile: 'product' }), /non-computed field/);
});

test('editions and API files: rulebook files appear at publication, never-published editions never; the API schema shows an F5 rename from its time', async () => {
  const w = quiet({ renames: true, horizonDays: 20 });
  const files = [];
  const arm = { ...p2pSolver(), id: 'file-reader', tick(input, ctx) { files.push([input.now, Object.keys(ctx.files), ctx.files['api/erp.schema.json']]); return p2pSolver().tick(input, ctx); } };
  await H.runWorld({ item: p2pItem, world: w, arm });
  const pub = H.toMs(w.rulebook.editions[1].published), ren = H.toMs(w.faults.find(f => f.kind === 'F5').at);
  for (const [now, keys, api] of files) {
    assert.equal(keys.includes('rulebook/ed-2026b/tolerance.json'), H.toMs(now) >= pub);
    assert.ok(keys.includes('rulebook/ed-2026a/tolerance.json'));
    assert.ok(!keys.some(k => k.startsWith('rulebook/ed-never/')));
    const reg = JSON.parse(api).ops.registerInvoice.args.properties;
    assert.equal('supplierInvoiceNo' in reg, H.toMs(now) >= ren);
    assert.equal('vendorInvoiceNo' in reg, H.toMs(now) < ren);
    assert.ok(keys.includes('spec/SPEC-E.md') && keys.includes('master/vendors.json') && keys.includes('calendar/cal-nl.json'));
  }
});

test('documents are files: an event\'s document text is in docs/<eventId>.txt and the event carries only its path', async () => {
  const w = quiet();
  const seen = [];
  const arm = { ...p2pSolver(), id: 'doc-reader', tick(input, ctx) { for (const e of input.events) if (e.docFile) seen.push([e, ctx.files[e.docFile], ctx.files[`sor/${input.instance}.json`]]); return p2pSolver().tick(input, ctx); } };
  await H.runWorld({ item: p2pItem, world: w, arm });
  assert.ok(seen.length >= 2);
  for (const [e, text] of seen) { assert.ok(text.startsWith('INVOICE ')); assert.ok(!('doc' in e)); assert.equal(e.docFile, `docs/${e.id}.txt`); }
});

test('workspace limits: an oversize or symlinked workspace is an arm error and the snapshot is restored', async () => {
  const dir = tmp();
  try {
    let n = 0;
    const base = p2pSolver();
    const arm = { ...base, id: 'ws', workspace: { dir: path.join(dir, 'ws') }, tick(input, ctx) {
      n++;
      writeFileSync(path.join(ctx.workspace, 'a.txt'), `call ${n}`);
      if (n === 2) writeFileSync(path.join(ctx.workspace, 'big.bin'), Buffer.alloc(4096));
      if (n === 3) symlinkSync('/etc/hostname', path.join(ctx.workspace, 'link'));
      return base.tick(input, ctx);
    } };
    const res = await H.runWorld({ item: p2pItem, world: quiet(), arm, workspaceMaxBytes: 1024 });
    const errs = ofType(res, 'arm.error').map(e => e.code);
    assert.deepEqual(errs.slice(0, 2), ['workspace-oversize', 'workspace-forbidden']);
    const calls = ofType(res, 'call').filter(c => c.kind === 'case');
    assert.equal(calls[1].workspace.digest, calls[0].workspace.digest, 'restored to the previous snapshot');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('world validation: malformed worlds are bed bugs, refused before any run', () => {
  const ok = quiet();
  const bad = [
    { ...ok, arrivals: [{ ...ok.arrivals[0], channel: { kind: 'instance', instance: 'i-000001' } }] },
    { ...ok, arrivals: [ok.arrivals[0], ok.arrivals[0]] },
    { ...ok, t0: '2026-03-02 08:00' },
    { ...ok, sor: { 'erp.nope': [] } },
    { ...ok, noise: { late: 0.7, none: 0.6 } },
    { ...ok, faults: [{ case: 'c001', system: 'erp', op: 'getInvoice', ordinal: 1, kind: 'F1' }] },
    { ...ok, faults: [{ case: 'c001', system: 'erp', op: 'post', ordinal: 1, kind: 'F4' }] },
    { ...ok, horizonEnd: ok.t0 },
  ];
  for (const w of bad) assert.throws(() => H.createHost({ item: p2pItem, world: w, arm: p2pSolver() }));
  assert.doesNotThrow(() => H.createHost({ item: p2pItem, world: ok, arm: p2pSolver() }));
});

test('output validation: each malformed output is refused with a reason', () => {
  const ctx = { schemas: H.bindItem(p2pItem).schemas, round: 1, inbound: true, instances: new Map([['i-000001', { closed: false }], ['i-000002', { closed: true }]]), self: 'i-000003' };
  const ok = { decisions: { subject: null }, carry: null };
  const eff = { system: 'erp', op: 'post', args: {} };
  const task = { id: 't', kind: 'k', role: 'r', subject: null, question: 'q', answerSchema: APPROVE_SCHEMA, dueAt: T0, onTimeout: null };
  const cases = [
    [{ carry: null }, /decisions/], [{ decisions: {}, carry: null }, /subject/], [{ decisions: { subject: null } }, /carry/],
    [{ ...ok, extra: 1 }, /unexpected extra/], [{ ...ok, effects: [{ system: 'erp', op: 'nope', args: {} }] }, /unknown op/],
    [{ ...ok, effects: [{ ...eff, after: 'k1' }] }, /names no earlier effect/], [{ ...ok, effects: [{ ...eff, key: '' }] }, /key/],
    [{ ...ok, effects: [{ system: 'bank', op: 'payRun', key: 'x', args: {} }] }, /batch op keys its items/],
    [{ ...ok, obligations: { upsert: [{ id: 'o', kind: 'k', dueAt: '2026-03-02' }] } }, /dueAt/],
    [{ ...ok, humanTasks: [{ ...task, answerSchema: { type: 'object', properties: { a: { type: 'string', pattern: 'x' } } } }] }, /answerSchema/],
    [{ ...ok, humanTasks: [{ ...task, answerSchema: { type: 'string' } }] }, /answerSchema/],
    [{ ...ok, humanTasks: [task, task] }, /duplicate id/], [{ ...ok, humanTasks: [{ ...task, subject: undefined }] }, /subject/],
    [{ ...ok, merge: { into: 'i-000002' } }, /not an open instance/], [{ ...ok, merge: { into: 'i-000003' } }, /into itself/],
    [{ ...ok, close: false }, /close/], [{ ...ok, carry: { x: 'y'.repeat(70_000) } }, /carry/],
  ];
  for (const [out, re] of cases) {
    const { errors } = H.validateCaseOutput(out, ctx);
    assert.ok(errors.some(e => re.test(e)), `${JSON.stringify(out).slice(0, 80)} -> ${errors.join('; ')}`);
  }
  assert.deepEqual(H.validateCaseOutput({ ...ok, effects: [{ key: 'a', ...eff }, { ...eff, key: 'b', after: 'a' }], humanTasks: [task] }, ctx).errors, []);
  const sweepCtx = { schemas: ctx.schemas, instances: ctx.instances };
  assert.ok(H.validateSweepOutput({ effects: [{ system: 'erp', op: 'post', args: { postingId: 'p' } }], carry: null }, sweepCtx).errors.some(e => /subject argument/.test(e)));
  assert.ok(H.validateSweepOutput({ wake: ['i-000002'], carry: null }, sweepCtx).errors.some(e => /not an open instance/.test(e)));
});

test('status(key) is pending while the platform retries, committed after, not-found for unknown keys', async () => {
  const base = sagaWorld({ seed: 1103, orders: 2, faults: false });
  const cases = Object.keys(base.truth.cases);
  const world = { ...base, faults: [{ case: cases[0], system: 'billing', op: 'charge', ordinal: 1, kind: 'F2', params: { repeat: 8 } }] };
  world.arrivals[1] = { ...world.arrivals[1], at: H.addMinutes(world.arrivals[0].at, 1) };
  const seen = [];
  const arm = {
    id: 'peek',
    tick(input, ctx) {
      seen.push([input.now, ctx.status('billing', 'chg-1'), ctx.status('billing', 'nope')]);
      const ev = input.events.find(e => e.type === 'order.placed');
      if (ev && ev.payload.orderId === base.truth.cases[cases[0]].subject) return { decisions: { subject: ev.payload.orderId }, effects: [{ key: 'chg-1', system: 'billing', op: 'charge', args: { orderId: ev.payload.orderId, fulfilmentId: ev.payload.fulfilmentId, amountMinor: 900, currency: 'EUR' } }], carry: null };
      return empty(input, { obligations: ev ? { upsert: [{ id: 'later', kind: 'x', anchor: null, dueAt: H.addMinutes(input.now, 30), onDue: null }] } : undefined });
    },
  };
  await H.runWorld({ item: sagaItem, world, arm, profile: 'temporal-like' });
  assert.deepEqual(seen.map(s => s.slice(1)), [['not-found', 'not-found'], ['pending', 'not-found'], ['committed', 'not-found'], ['committed', 'not-found']]);
});

test('E7 systems through the host: tickets and SLA records are business records, computed SLA fields are stripped in Track P, notify faults are tagged', async () => {
  const item = { id: 'toy-itsm', family: { subject: { object: 'incident', key: 'number' }, sweeps: [] }, systems: [...e7.systems, common.notify], schemas: { humanTasks: {} }, specE: '# toy itsm', actors: {} };
  const world = { id: 'toy-itsm-1104', t0: T0, horizonEnd: at(3 * 24 * 60), sor: { 'cmdb.cis': [{ ciId: 'CI-1', name: 'mail', class: 'app', supportGroup: 'G1', schedule: '8x5' }] },
    arrivals: [{ id: 'al-1', type: 'message.received', at: at(5), source: 'monitor', channel: { kind: 'inbound' }, payload: { alert: 'disk', ci: 'CI-1' } }],
    faults: [{ case: 'k1', system: 'notify', op: 'send', ordinal: 1, kind: 'F1', params: { retryAfterSeconds: 30 } }],
    truth: { cases: { k1: { subject: 'INC0001', start: at(5), epoch: 'ep0', class: 'incident', tail: false } }, eventCase: { 'al-1': 'k1' } } };
  const reads = [];
  const arm = {
    id: 'itsm-arm',
    tick(input, ctx) {
      reads.push(ctx.query('itsm.slas', {}));
      if (input.events.some(e => e.type === 'message.received')) {
        return { decisions: { subject: 'INC0001' }, effects: [
          { key: 'inc', system: 'itsm', op: 'create', args: { table: 'incidents', number: 'INC0001', fields: { state: 'new', holdReason: null, impact: 2, urgency: 2, priority: 3, assignmentGroup: 'G1', assignedTo: null, caller: null, ci: 'CI-1', shortDescription: 'disk', openedAt: input.now, resolvedAt: null, closedAt: null, problem: null } } },
          { key: 'sla', system: 'itsm', op: 'slaEvent', args: { slaId: 'SLA-1', ticket: 'INC0001', definition: 'P3-resolve', event: 'start', at: input.now }, after: 'inc' },
          { key: 'slac', system: 'itsm', op: 'setSlaComputed', args: { slaId: 'SLA-1', ticket: 'INC0001', elapsedMinutes: 0, businessElapsedMinutes: 0, breachAt: null, breached: false }, after: 'sla' },
          { key: 'n1', system: 'notify', op: 'send', args: { to: 'G1', about: 'INC0001', template: 'assign', text: 'new incident' } },
          { key: 'bad', system: 'itsm', op: 'update', args: { table: 'incidents', number: 'INC0001', fields: { priority: 9 } }, after: 'inc' },
        ], carry: { open: true } };
      }
      return empty(input);
    },
  };
  const res = await H.runWorld({ item, world, arm, profile: 'bare' });
  const ledger = ofType(res, 'ledger');
  assert.deepEqual(ledger.map(r => [r.op, r.status]), [['create', 'ok'], ['slaEvent', 'ok'], ['setSlaComputed', 'ok'], ['send', 'rate-limited'], ['update', 'error']]);
  assert.deepEqual(ledger[3].faultTags, ['F1']);
  const result = ofType(res, 'deliver').find(d => d.event.payload?.op === 'send').event.payload;
  assert.equal(result.retryAfter, 30);
  const sla = res.host.systems.get('itsm').db.slas.get('SLA-1');
  assert.equal(sla.breached, false, 'the arm wrote the computed field');
  assert.ok(reads.at(-1).length === 1 && !('breached' in reads.at(-1)[0]) && reads.at(-1)[0].startAt, 'Track P reads strip it');
});
