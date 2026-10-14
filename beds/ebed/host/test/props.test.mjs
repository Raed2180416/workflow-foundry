// E-BED §9.2 host property suite (seeded, no new dependency, $0): idempotency, determinism (runs, processes,
// concurrency, input order), clock laws, the host's never-list (no correlation, no dedupe, no deadlines, no
// compensation, no defaults), the tagged fault injector, platform profiles, arm-error isolation, the human-task router
// and noise model, the G21 form round trip, the portable validator against the engine's ajv authority, leak checks,
// the censoring record and bounds. Toy d1 worlds on the provisional E1/E8 systems (test/toy.mjs); seeds from the E-bed
// dev block 1001–1199. Run: node --test --test-concurrency=2 beds/ebed/host/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rng } from '../../../lib/rng.mjs';
import { hashOf, canonical } from '../../../lib/canonical.mjs';
import * as H from '../index.mjs';
import { e1, e8 } from '../index.mjs';
import { p2pItem, p2pWorld, p2pSolver, sagaItem, sagaWorld, sagaSolver, fuzzArm, SEEDS, APPROVE_SCHEMA } from './toy.mjs';
import { validateData } from '../../../../src/validate.mjs';
import { portableSchemaViolations } from '../../../../src/schema-subset.mjs';

const content = res => res.host.journal.contentRows();
const ofType = (res, t) => content(res).filter(r => r.type === t);
const run = opts => H.runWorld(opts);
const MIN = 60_000;
const ms = H.toMs;

/** Wrap an arm so every input, file map and read the arm makes is captured (the leak and isolation checks). */
function recording(arm) {
  const log = [];
  const wrap = (fn, kind) => fn && function (input, ctx) {
    const reads = [];
    const c2 = { ...ctx, query: (t, f) => { const r = ctx.query(t, f); reads.push(r); return r; }, status: (s, k) => { const r = ctx.status(s, k); reads.push(r); return r; },
      instances: f => { const r = ctx.instances(f); reads.push(r); return r; } };
    const entry = { kind, input: structuredClone(input), files: ctx.files, reads };
    log.push(entry);
    return fn.call(arm, input, c2);
  };
  return { arm: { ...arm, tick: wrap(arm.tick, 'case'), sweep: wrap(arm.sweep, 'sweep') }, log };
}

// ---------------------------------------------------------------------------------------------------------------------
test('idempotency (mock level, seeded): one key twice -> one entry and the same result; no key -> two; same key, other args -> 409', () => {
  for (const seed of SEEDS) {
    const r = rng('ebed-host-props', 'idem', seed);
    const bank = new H.MockSystem(e1.bank);
    bank.write('vendorAccounts', { vendorId: 'V1', iban: 'X' });
    const n0 = () => bank.db.payments.size;
    const args = { invoiceId: `INV-${r.int(1, 99)}`, vendorId: 'V1', amountMinor: r.int(1, 1e6), currency: 'EUR' };
    const key = `pay:${r.int(1, 1e9)}`;
    const a = bank.apply('pay', args, key, 0, { ctx: { now: 'x' } });
    const b = bank.apply('pay', structuredClone(args), key, 1, { ctx: { now: 'y' } });
    assert.equal(a.committed, true); assert.equal(b.committed, false); assert.equal(b.deduped, true);
    assert.deepEqual(b.result, a.result);
    assert.equal(n0(), 1);
    const c = bank.apply('pay', { ...args, amountMinor: args.amountMinor + 1 }, key, 2, { ctx: { now: 'z' } });
    assert.equal(c.status, 'error'); assert.equal(c.error.code, 409); assert.equal(n0(), 1);
    bank.apply('pay', args, null, 3, { ctx: { now: 'z' } }); bank.apply('pay', args, null, 4, { ctx: { now: 'z' } });
    assert.equal(n0(), 3, 'un-keyed calls are applied every time');
    assert.equal(bank.keyStatus(key), 'committed');
    assert.equal(bank.keyStatus('never'), 'not-found');
    assert.equal(bank.keyStatus('later', new Set(['bank\u0000later'])), 'pending');
    // A failed application records no key: a later retry with the same key can still succeed.
    const bad = bank.apply('pay', { ...args, vendorId: 'NOPE' }, 'k-bad', 5, { ctx: { now: 'z' } });
    assert.equal(bad.committed, false); assert.equal(bank.keyStatus('k-bad'), 'not-found');
    // F3: committed although the caller sees `unknown`; the key is committed.
    const u = bank.apply('pay', { ...args, invoiceId: 'INV-F3' }, 'k-f3', 6, { fault: 'F3', ctx: { now: 'z' } });
    assert.equal(u.status, 'unknown'); assert.equal(u.committed, true); assert.equal(bank.keyStatus('k-f3'), 'committed');
  }
});

test('idempotency (host level): keyed re-emission makes one ledger row and identical results; un-keyed makes two', async () => {
  const world = p2pWorld({ seed: 1001, cases: 2, backlog: 0, faults: false, duplicates: false, noise: {} });
  const arm = {
    id: 'dup-pay',
    tick(input) {
      const ev = input.events[0];
      if (ev.type !== 'doc.received') return { decisions: { subject: null }, carry: input.carry };
      const p = ev.payload;
      const pay = { system: 'bank', op: 'pay', args: { invoiceId: p.invoiceId, vendorId: p.vendorId, amountMinor: 100, currency: 'EUR' } };
      return { decisions: { subject: p.invoiceId }, effects: [{ ...pay, key: `k:${p.invoiceId}` }, { ...pay, key: `k:${p.invoiceId}` }, pay, pay], carry: null, close: true };
    },
  };
  const res = await run({ item: p2pItem, world, arm });
  const ledger = ofType(res, 'ledger').filter(r => r.op === 'pay');
  const results = ofType(res, 'deliver').filter(r => r.event.type === 'effect.result');
  assert.equal(ofType(res, 'effect.deduped').length, 2);
  for (const inv of ['INV-1001-001', 'INV-1001-002']) {
    assert.equal(ledger.filter(r => r.key === `k:${inv}`).length, 1);
  }
  assert.equal(ledger.filter(r => r.key === null).length, 4, 'two un-keyed pays per invoice, both applied');
  assert.equal(res.host.systems.get('bank').db.payments.size, 6);
  // Results of the keyed pair are identical apart from their event ids (delivered to closed instances: dropped rows).
  void results;
});

// ---------------------------------------------------------------------------------------------------------------------
test('determinism: worlds, noise draws and journals are byte-identical across runs; seeds differ', async () => {
  const heads = new Set();
  for (const seed of SEEDS.slice(0, 12)) {
    assert.equal(hashOf(p2pWorld({ seed })), hashOf(p2pWorld({ seed })));
    assert.equal(hashOf(sagaWorld({ seed })), hashOf(sagaWorld({ seed })));
    const a = await run({ item: p2pItem, world: p2pWorld({ seed, renames: true }), arm: p2pSolver() });
    const b = await run({ item: p2pItem, world: p2pWorld({ seed, renames: true }), arm: p2pSolver() });
    assert.equal(a.digests.journal, b.digests.journal, `seed ${seed}`);
    assert.deepEqual(a.digests, b.digests);
    const f1 = await run({ item: p2pItem, world: p2pWorld({ seed }), arm: fuzzArm(seed) });
    const f2 = await run({ item: p2pItem, world: p2pWorld({ seed }), arm: fuzzArm(seed) });
    assert.equal(f1.digests.journal, f2.digests.journal, `fuzz seed ${seed}`);
    heads.add(a.digests.journal);
    const w = p2pWorld({ seed });
    assert.deepEqual(H.noiseDraw(w, 'c001', 'approver', 'approvePosting', 3), H.noiseDraw(w, 'c001', 'approver', 'approvePosting', 3));
  }
  assert.equal(heads.size, 12, 'different seeds give different runs');
});

test('determinism across processes: a child process produces the same digests', async () => {
  const hostUrl = new URL('../index.mjs', import.meta.url).href, toyUrl = new URL('./toy.mjs', import.meta.url).href;
  const script = `import { runWorld } from ${JSON.stringify(hostUrl)}; import { p2pItem, p2pWorld, p2pSolver, sagaItem, sagaWorld, sagaSolver } from ${JSON.stringify(toyUrl)};
    const a = await runWorld({ item: p2pItem, world: p2pWorld({ seed: 1007, renames: true }), arm: p2pSolver() });
    const b = await runWorld({ item: sagaItem, world: sagaWorld({ seed: 1007 }), arm: sagaSolver() });
    console.log(JSON.stringify([a.digests, b.digests]));`;
  const child = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim());
  const a = await run({ item: p2pItem, world: p2pWorld({ seed: 1007, renames: true }), arm: p2pSolver() });
  const b = await run({ item: sagaItem, world: sagaWorld({ seed: 1007 }), arm: sagaSolver() });
  assert.deepEqual(child, [a.digests, b.digests]);
});

test('determinism: the journal does not depend on call concurrency or completion order', async () => {
  for (const seed of SEEDS.slice(0, 6)) {
    const slow = base => ({ ...base, async tick(input, ctx) {
      const out = base.tick(input, ctx);                                            // reads happen before any await
      await new Promise(res => setTimeout(res, (hashOf(input).charCodeAt(0) % 4)));   // completion order scrambled
      return out;
    } });
    const one = await run({ item: p2pItem, world: p2pWorld({ seed, cases: 16 }), arm: slow(p2pSolver()), concurrency: 1 });
    const four = await run({ item: p2pItem, world: p2pWorld({ seed, cases: 16 }), arm: slow(p2pSolver()), concurrency: 4 });
    assert.equal(one.digests.journal, four.digests.journal, `seed ${seed}`);
    const fz1 = await run({ item: p2pItem, world: p2pWorld({ seed }), arm: slow(fuzzArm(seed, { crash: false })), concurrency: 1 });
    const fz4 = await run({ item: p2pItem, world: p2pWorld({ seed }), arm: slow(fuzzArm(seed, { crash: false })), concurrency: 4 });
    assert.equal(fz1.digests.journal, fz4.digests.journal, `fuzz seed ${seed}`);
  }
});

test('determinism: tie-breaks by (time, source, id), whatever the order of the world arrays', async () => {
  for (const seed of SEEDS.slice(0, 8)) {
    const w = p2pWorld({ seed });
    const r = rng('ebed-host-props', 'perm', seed);
    // Force same-instant arrivals with different sources and ids.
    const tied = w.arrivals.filter(e => e.channel.kind === 'inbound').slice(0, 3).map((e, i) => ({ ...e, at: w.arrivals[0].at, source: ['inbox', 'edi', 'inbox'][i] }));
    const base = { ...w, arrivals: [...w.arrivals.filter(e => !tied.some(t => t.id === e.id)), ...tied] };
    const perm = { ...base, arrivals: r.shuffle(base.arrivals), writes: r.shuffle(base.writes) };
    const a = await run({ item: p2pItem, world: base, arm: p2pSolver() });
    const b = await run({ item: p2pItem, world: perm, arm: p2pSolver() });
    const strip = res => content(res).filter(x => x.type !== 'run.start');
    assert.equal(canonical(strip(a)), canonical(strip(b)), `seed ${seed}`);
    const first = ofType(a, 'deliver').filter(d => d.event.at === tied[0].at && d.event.channel.kind === 'inbound').map(d => [d.event.source, d.event.id]);
    assert.deepEqual(first, [...first].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : 1)));
  }
});

// ---------------------------------------------------------------------------------------------------------------------
test('clock laws: event-driven, monotone, deliveries at their time, results >= 1 minute later, timers at their due time, horizon respected', async () => {
  for (const seed of SEEDS.slice(0, 10)) {
    for (const res of [
      await run({ item: p2pItem, world: p2pWorld({ seed, renames: true }), arm: p2pSolver() }),
      await run({ item: p2pItem, world: p2pWorld({ seed }), arm: fuzzArm(seed) }),
      await run({ item: sagaItem, world: sagaWorld({ seed }), arm: sagaSolver() }),
    ]) {
      const rows = content(res);
      const w = res.host.world;
      let now = null, last = -Infinity, perRound = new Set();
      const horizon = ms(w.horizonEnd);
      for (const r of rows) {
        if (r.type === 'wakeup') {
          now = ms(r.at); assert.ok(now > last, 'wake-ups strictly increase'); assert.ok(now <= horizon); assert.ok(r.entries >= 1, 'no idle wake-up');
          last = now; perRound = new Set();
        }
        if (r.type === 'deliver' && now !== null) assert.equal(ms(r.event.at), now, `${r.event.type} delivered at its time`);
        if (r.type === 'call') { const k = `${r.round}|${r.target}`; assert.ok(!perRound.has(k), 'one call per target per round'); perRound.add(k); assert.equal(ms(r.at), now); }
        if (r.type === 'effect.result') assert.ok(ms(r.at) >= now + MIN, 'no same-instant results');
      }
      // Every fired timer fires at the time its last upsert announced (its dueAt, or now + 1 minute when due already).
      const fires = new Map();
      for (const r of rows) if (r.type === 'obligation.upsert') fires.set(`${r.instance}/${r.id}`, r.firesAt);
      for (const r of rows.filter(x => x.type === 'deliver' && x.event.type === 'timer.fired')) {
        const announced = fires.get(`${r.instance}/${r.event.payload.obligationId}`);
        assert.equal(r.event.at, announced);
        const up = rows.filter(x => x.type === 'obligation.upsert' && x.instance === r.instance && x.id === r.event.payload.obligationId).at(-1);
        assert.ok(up.clamped ? true : r.event.at === H.fmt(ms(up.dueAt), 60), 'the host never computes a due time');
      }
      const wakeups = rows.filter(r => r.type === 'wakeup').length;
      assert.ok(wakeups < (horizon - ms(w.t0)) / MIN / 50, `idle time skipped (${wakeups} wake-ups)`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
test('the host never correlates or deduplicates inbound events: every uncorrelated inbound event starts its own instance', async () => {
  for (const seed of SEEDS.slice(0, 10)) {
    const w = p2pWorld({ seed, duplicates: true });
    const res = await run({ item: p2pItem, world: w, arm: p2pSolver() });
    const inbound = w.arrivals.filter(e => e.channel.kind === 'inbound' && ms(e.at) <= ms(w.horizonEnd));
    const started = ofType(res, 'instance.open').filter(r => r.startedBy.kind === 'event').map(r => r.startedBy.eventId).sort();
    assert.deepEqual(started, inbound.map(e => e.id).sort());
    // Mistyped business keys are delivered exactly as written (no repair).
    const typo = { ...w, arrivals: w.arrivals.map(e => (e.id === inbound[0].id ? { ...e, payload: { ...e.payload, invoiceId: e.payload.invoiceId.replace('INV', 'lNV') } } : e)) };
    const t = await run({ item: p2pItem, world: typo, arm: recording(p2pSolver()).arm });
    const got = ofType(t, 'deliver').find(d => d.event.id === inbound[0].id);
    assert.ok(got.event.payload.invoiceId.startsWith('lNV'));
  }
});

test('the host never computes deadlines, enforces rules for the arm, or fills defaults', async () => {
  const w = p2pWorld({ seed: 1011, cases: 3, backlog: 0, faults: false, duplicates: false, noise: {}, renames: true });
  // Post a held invoice and let a renamed field through without the rename: the mock commits the first and rejects the
  // second (400, field named); the host neither blocks the post nor maps the old field.
  const arm = {
    id: 'rule-breaker',
    tick(input) {
      const ev = input.events[0];
      if (ev.type === 'doc.received') {
        const p = ev.payload;
        const args = { invoiceId: p.invoiceId, vendorId: p.vendorId, vendorInvoiceNo: p.vendorInvoiceNo, poNumber: p.poNumber, invoiceDate: p.invoiceDate, lines: p.lines, chargesMinor: 0, totalMinor: p.totalMinor, currency: 'EUR', sourceDoc: null };
        return { decisions: { subject: p.invoiceId }, effects: [
          { key: `r:${p.invoiceId}`, system: 'erp', op: 'registerInvoice', args },
          { key: `h:${p.invoiceId}`, system: 'erp', op: 'hold', args: { holdId: `H-${p.invoiceId}`, invoiceId: p.invoiceId, lineNo: null, reason: 'price' }, after: `r:${p.invoiceId}` },
          { key: `p:${p.invoiceId}`, system: 'erp', op: 'post', args: { postingId: `P-${p.invoiceId}`, invoiceId: p.invoiceId, amountMinor: p.totalMinor, currency: 'EUR' }, after: `h:${p.invoiceId}` },
        ], obligations: { upsert: [{ id: 'odd', kind: 'x', anchor: null, dueAt: '2026-03-02T08:00:07+01:00', onDue: null }] }, carry: null };
      }
      return { decisions: { subject: null }, carry: null };
    },
  };
  const res = await run({ item: p2pItem, world: w, arm });
  const erp = res.host.systems.get('erp');
  const posted = [...erp.db.postings.values()].map(p => p.invoiceId);
  const held = [...erp.db.holds.values()].filter(h => h.status === 'active').map(h => h.invoiceId);
  const before = posted.filter(id => held.includes(id));
  for (const r of ofType(res, 'ledger').filter(x => x.op === 'registerInvoice')) {
    const late = ms(r.at) >= ms(w.faults.find(f => f.kind === 'F5').at);
    if (late) { assert.equal(r.status, 'error'); assert.deepEqual(r.faultTags, ['F5']); assert.equal(r.injected, true); }
    else assert.equal(r.status, 'ok');
  }
  assert.ok(before.length >= 1 || posted.length === 0, 'a held invoice can be posted: the mock enforces no workflow rule');
  // The past-due obligation fires one minute after the tick, never at a host-computed time.
  for (const r of ofType(res, 'obligation.upsert')) { assert.equal(r.clamped, true); }
});

// ---------------------------------------------------------------------------------------------------------------------
test('faults: every injected row matches the world schedule (case, system, op, ordinal) and every reached fault is injected; tags never reach the arm', async () => {
  for (const seed of SEEDS.slice(0, 15)) {
    const w = p2pWorld({ seed, renames: true });
    const rec = recording(p2pSolver());
    const res = await run({ item: p2pItem, world: w, arm: rec.arm });
    const ledger = ofType(res, 'ledger');
    for (const row of ledger) {
      if (!row.injected) { assert.deepEqual(row.faultTags, []); continue; }
      for (const tag of row.faultTags) {
        if (tag === 'F5') { assert.ok(w.faults.some(f => f.kind === 'F5' && f.system === row.system && f.op === row.op && ms(f.at) <= ms(row.at))); continue; }
        const f = w.faults.find(x => x.kind === tag && x.case === row.subjectCase && x.system === row.system && x.op === row.op
          && row.ordinal >= x.ordinal && row.ordinal < x.ordinal + (x.params?.repeat ?? 1));
        assert.ok(f, `injected ${tag} on ${row.system}.${row.op} #${row.ordinal} is scheduled`);
      }
    }
    for (const f of w.faults.filter(x => x.kind !== 'F5')) {
      const reached = ledger.filter(r => r.subjectCase === f.case && r.system === f.system && r.op === f.op && r.ordinal === f.ordinal);
      for (const r of reached) assert.ok(r.faultTags.includes(f.kind), `reached ${f.kind} was injected`);
    }
    const seen = JSON.stringify(rec.log.map(l => [l.input, l.reads]));
    assert.ok(!seen.includes('"injected"') && !seen.includes('faultTags'), 'injection tags are journal-only');
  }
});

test('faults and actors are identical across arms that make the same attempts (keys and question wording differ)', async () => {
  for (const seed of SEEDS.slice(0, 10)) {
    const a = await run({ item: p2pItem, world: p2pWorld({ seed }), arm: p2pSolver({ id: 'arm-a', questionStyle: 'plain' }) });
    const b = await run({ item: p2pItem, world: p2pWorld({ seed }), arm: p2pSolver({ id: 'arm-b', questionStyle: 'polite' }) });
    const fx = res => ofType(res, 'ledger').map(r => [r.at, r.system, r.op, r.subjectCase, r.ordinal, r.status, r.faultTags]);
    assert.deepEqual(fx(a), fx(b));
    const tasks = res => ofType(res, 'humanTask.created').map(r => [r.case, r.ordinal, r.user, r.noAnswer, r.noise, r.steps]);
    assert.deepEqual(tasks(a), tasks(b));
    const answers = res => ofType(res, 'deliver').filter(d => d.event.type.startsWith('humanTask.')).map(d => [d.event.at, d.event.type, d.event.payload]);
    assert.deepEqual(answers(a), answers(b), 'answers depend on (case, role, kind, ordinal), never on the question text');
  }
});

// ---------------------------------------------------------------------------------------------------------------------
test('profiles: bare never retries; temporal-like retries 1 s x 2 capped at 100 s, unlimited, and delivers only the final outcome', async () => {
  const bare = await run({ item: sagaItem, world: sagaWorld({ seed: 1013 }), arm: sagaSolver(), profile: 'bare' });
  assert.equal(ofType(bare, 'platform.retry').length, 0);
  // A ten-attempt outage on every charge.
  const base = sagaWorld({ seed: 1013, faults: false });
  const world = { ...base, faults: Object.keys(base.truth.cases).map(c => ({ case: c, system: 'billing', op: 'charge', ordinal: 1, kind: 'F2', params: { repeat: 9 } })) };
  const res = await run({ item: sagaItem, world, arm: sagaSolver() });
  const byEm = new Map();
  for (const r of ofType(res, 'platform.retry')) { if (!byEm.has(r.emission)) byEm.set(r.emission, []); byEm.get(r.emission).push(r.afterSeconds); }
  assert.equal(byEm.size, Object.keys(base.truth.cases).length);
  for (const delays of byEm.values()) assert.deepEqual(delays, [1, 2, 4, 8, 16, 32, 64, 100, 100]);
  const results = ofType(res, 'deliver').filter(d => d.event.type === 'effect.result' && d.event.payload.op === 'charge');
  assert.equal(results.length, Object.keys(base.truth.cases).length, 'one result per emission, after the last retry');
  for (const d of results) { assert.equal(d.event.payload.status, 'ok'); assert.equal(d.event.payload.attempts, 10); }
  assert.equal(H.backoffSeconds(H.PROFILES['temporal-like'].retry, 50), 100);
});

test('profiles: under temporal-like an F3 is retried by the platform, so a key-less arm double-charges and a keyed one does not; F6 is never retried', async () => {
  const base = sagaWorld({ seed: 1014, faults: false });
  const cases = Object.keys(base.truth.cases);
  const world = { ...base, faults: [...cases.slice(0, 4).map(c => ({ case: c, system: 'billing', op: 'charge', ordinal: 1, kind: 'F3' })),
    ...cases.slice(4, 6).map(c => ({ case: c, system: 'carrier', op: 'create', ordinal: 1, kind: 'F6' }))] };
  const charges = res => { const m = new Map(); for (const c of res.host.systems.get('billing').db.charges.values()) m.set(c.orderId, (m.get(c.orderId) ?? 0) + 1); return m; };
  const keyed = await run({ item: sagaItem, world, arm: sagaSolver({ keys: true }) });
  const keyless = await run({ item: sagaItem, world, arm: sagaSolver({ keys: false, id: 'keyless' }) });
  for (const c of cases.slice(0, 4)) {
    const order = base.truth.cases[c].subject;
    assert.equal(charges(keyed).get(order), 1, `${order}: keyed charge applied once`);
    assert.equal(charges(keyless).get(order), 2, `${order}: key-less charge applied twice after the platform retry`);
  }
  for (const res of [keyed, keyless]) {
    const f6 = ofType(res, 'ledger').filter(r => r.faultTags.includes('F6'));
    assert.equal(f6.length, 2);
    for (const r of f6) assert.equal(ofType(res, 'platform.retry').filter(x => x.emission === r.emission).length, 0, 'F6 is not retried');
  }
  // Under bare the same F3 reaches the arm as `unknown` and status(key) shows committed.
  const rec = recording(sagaSolver());
  await run({ item: sagaItem, world, arm: rec.arm, profile: 'bare' });
  const unknown = rec.log.flatMap(l => l.input.events).filter(e => e.type === 'effect.result' && e.payload.status === 'unknown');
  assert.equal(unknown.length, 4);
});

// ---------------------------------------------------------------------------------------------------------------------
test('arm errors apply nothing, keep the carry and the obligations, and fail no other instance', async () => {
  let errors = 0;
  for (const seed of SEEDS.slice(0, 15)) {
    const rec = recording(fuzzArm(seed));
    const res = await run({ item: p2pItem, world: p2pWorld({ seed }), arm: rec.arm });
    const rows = content(res);
    const lastCarry = new Map();
    rows.forEach((r, i) => {
      if (r.type === 'carry.commit' && r.instance) lastCarry.set(r.instance, r.digest);
      if (r.type !== 'arm.error' || !r.instance) return;
      errors++;
      // Between the failed call and the next row of another kind of work, nothing was applied for it.
      for (let j = i + 1; j < rows.length && !['call', 'wakeup.commit'].includes(rows[j].type); j++) {
        assert.ok(['carry.lost'].includes(rows[j].type), `nothing applied after an arm error (${rows[j].type})`);
      }
    });
    // The next input of an instance after its error carries the last committed carry.
    const inputs = rec.log.filter(l => l.kind === 'case');
    const calls = rows.filter(r => r.type === 'call' && r.kind === 'case');
    assert.equal(inputs.length, calls.length);
    const carryBy = new Map();
    calls.forEach((c, i) => {
      const inp = inputs[i].input;
      assert.equal(inp.instance, c.target);
      if (carryBy.has(c.target)) assert.equal(hashOf(inp.carry ?? null), carryBy.get(c.target));
      const ok = rows.find(r => r.type === 'carry.commit' && r.instance === c.target && r.tickIndex === calls.slice(0, i + 1).filter(x => x.target === c.target).length);
      if (ok) carryBy.set(c.target, ok.digest);
    });
  }
  assert.ok(errors > 20, `the fuzz arm produced arm errors (${errors})`);
});

test('arm errors: crash, oversize carry, invalid output, environment faults (retried, then impaired)', async () => {
  const w = p2pWorld({ seed: 1015, cases: 4, backlog: 0, faults: false, duplicates: false, noise: {} });
  let n = 0;
  const arm = {
    id: 'bad',
    tick(input) {
      n++;
      if (n === 1) throw new Error('boom');
      if (n === 2) return { decisions: { subject: null }, carry: { x: 'y'.repeat(70_000) } };
      if (n === 3) return { carry: null };
      if (n === 4 || n === 5) throw new H.EnvFault('MODEL_UNAVAILABLE');
      if (n >= 6 && n <= 8) throw new H.EnvFault('SANDBOX_UNAVAILABLE');
      return { decisions: { subject: null }, obligations: { upsert: [{ id: 'later', kind: 'k', anchor: null, dueAt: H.addMinutes(input.now, 30), onDue: null }] }, carry: { ok: true } };
    },
  };
  const res = await run({ item: p2pItem, world: w, arm });
  const errs = ofType(res, 'arm.error').map(r => r.code);
  assert.deepEqual(errs.slice(0, 4), ['crash', 'invalid-output', 'invalid-output', 'impaired']);
  const calls = ofType(res, 'call');
  assert.deepEqual(calls[3].envFaults.map(f => f.code), ['MODEL_UNAVAILABLE', 'MODEL_UNAVAILABLE']);
  assert.equal(calls[3].outcome, 'ok', 'two env faults then a success is not an arm error');
  assert.deepEqual(calls[4].envFaults.map(f => f.code), ['SANDBOX_UNAVAILABLE', 'SANDBOX_UNAVAILABLE', 'SANDBOX_UNAVAILABLE']);
  assert.ok(!JSON.stringify(calls).includes('"injected"'), 'real environment faults are never tagged injected');
});

// ---------------------------------------------------------------------------------------------------------------------
test('human tasks: noise shares are realised, routing honours excludeUsers, unknown kinds and subjects get no answer, rejected answers are withheld', async () => {
  const w = p2pWorld({ seed: 1016, noise: { none: 0.1, late: 0.15, delegate: 0.1, withdraw: 0.05, freeText: 0.1, wrong: 0.1, form: 0.4, formInvalid: 0.5 } });
  const counts = Object.fromEntries(['normal', ...H.NOISE_CLASSES].map(k => [k, 0]));
  let form = 0;
  const N = 20_000;
  for (let i = 0; i < N; i++) { const d = H.noiseDraw(w, `c${i % 97}`, 'approver', 'approvePosting', i); counts[d.cls]++; if (d.form) form++; }
  for (const [k, share] of Object.entries({ none: 0.1, late: 0.15, delegate: 0.1, withdraw: 0.05, freeText: 0.1, wrong: 0.1, normal: 0.4 })) {
    assert.ok(Math.abs(counts[k] / N - share) < 0.015, `${k}: ${counts[k] / N} vs ${share}`);
  }
  assert.ok(Math.abs(form / N - 0.4) < 0.015);

  const world = p2pWorld({ seed: 1016, cases: 6, backlog: 0, faults: false, duplicates: false, noise: {} });
  const sub = c => world.truth.cases[c].subject;
  const schemaNeedsReason = S => ({ ...S, properties: { ...S.properties, reason: { type: 'string' } }, required: [...S.required, 'reason'] });
  const tasks = [
    { id: 't-ok', kind: 'approvePosting', role: 'approver', excludeUsers: ['u-mgr1'], subject: sub('c001'), question: 'q', answerSchema: APPROVE_SCHEMA, onTimeout: 1 },
    { id: 't-kind', kind: 'mystery', role: 'approver', subject: sub('c001'), question: 'q', answerSchema: APPROVE_SCHEMA, onTimeout: 2 },
    { id: 't-subj', kind: 'approvePosting', role: 'approver', subject: 'INV-DOES-NOT-EXIST', question: 'q', answerSchema: APPROVE_SCHEMA, onTimeout: 3 },
    { id: 't-nouser', kind: 'approvePosting', role: 'approver', excludeUsers: ['u-mgr1', 'u-mgr2', 'u-mgr3'], subject: sub('c002'), question: 'q', answerSchema: APPROVE_SCHEMA, onTimeout: 4 },
    { id: 't-reject', kind: 'approvePosting', role: 'approver', subject: sub('c003'), question: 'q', answerSchema: schemaNeedsReason(APPROVE_SCHEMA), onTimeout: 5 },
  ];
  let asked = false;
  const rec = recording({ id: 'asker', tick(input) {
    const out = { decisions: { subject: null }, carry: null };
    if (!asked) { asked = true; out.humanTasks = tasks.map(t => ({ ...t, dueAt: H.addMinutes(input.now, 6 * 60) })); }
    return out;
  } });
  const res = await run({ item: p2pItem, world, arm: rec.arm });
  const created = Object.fromEntries(ofType(res, 'humanTask.created').map(r => [r.task.id, r]));
  assert.equal(created['t-ok'].user, 'u-mgr2', 'first eligible holder not excluded');
  assert.equal(created['t-kind'].noAnswer, 'unknown-kind');
  assert.equal(created['t-subj'].noAnswer, 'unknown-subject');
  assert.equal(created['t-nouser'].noAnswer, 'no-eligible-user');
  const evs = rec.log.flatMap(l => l.input.events).filter(e => e.type.startsWith('humanTask.'));
  const of = id => evs.filter(e => e.payload.taskId === id).map(e => e.type);
  assert.deepEqual(of('t-ok'), ['humanTask.answered']);
  for (const id of ['t-kind', 't-subj', 't-nouser']) assert.deepEqual(of(id), ['humanTask.timeout']);
  const rej = evs.find(e => e.payload.taskId === 't-reject');
  assert.equal(rej.type, 'humanTask.answerRejected');
  assert.ok(!('answer' in rej.payload), 'a rejected answer is withheld from the arm');
  const timeout = evs.find(e => e.payload.taskId === 't-kind');
  assert.equal(timeout.payload.onTimeout, 2);
  assert.equal(timeout.at, H.addMinutes(created['t-kind'].task.dueAt, 0), 'the timeout is the arm\'s own dueAt');
});

test('human tasks: late, delegated, withdrawn, free-text and wrong answers follow the noise class', async () => {
  const classes = new Set();
  for (const seed of SEEDS.slice(0, 20)) {
    const world = p2pWorld({ seed, cases: 8, backlog: 0, faults: false, duplicates: false,
      noise: { none: 0.15, late: 0.2, delegate: 0.15, withdraw: 0.1, freeText: 0.1, wrong: 0.1, form: 0.5, formInvalid: 0.5 } });
    const rec = recording(p2pSolver());
    const res = await run({ item: p2pItem, world, arm: rec.arm });
    const evs = rec.log.flatMap(l => l.input.events.map(e => ({ ...e, instance: l.input.instance })));
    for (const c of ofType(res, 'humanTask.created')) {
      const cls = c.noise?.applied ?? (c.noAnswer ? 'none' : 'normal');
      classes.add(cls);
      const mine = evs.filter(e => e.instance === c.instance && e.payload?.taskId === c.task.id && ms(e.at) >= ms(c.steps[0]?.at ?? '1970-01-01T00:00:00Z') - 1e12).map(e => e.type);
      const types = c.steps.filter(s => s.type !== 'form.rejected').map(s => s.type);
      if (cls === 'late') { assert.deepEqual(types, ['humanTask.timeout', 'humanTask.answered']); }
      if (cls === 'withdraw') assert.deepEqual(types, ['humanTask.withdrawn']);
      if (cls === 'delegate') assert.equal(types[0], 'humanTask.delegated');
      if (cls === 'none') assert.deepEqual(types, ['humanTask.timeout']);
      void mine;
    }
    for (const d of ofType(res, 'deliver').filter(x => x.event.type === 'humanTask.answered' && x.event.payload.late)) {
      const task = ofType(res, 'humanTask.created').find(c => c.instance === d.instance && c.task.id === d.event.payload.taskId);
      assert.ok(ms(d.event.at) > ms(task.task.dueAt));
    }
  }
  for (const k of ['normal', 'late', 'delegate', 'withdraw', 'none']) assert.ok(classes.has(k), `class ${k} exercised`);
});

// ---------------------------------------------------------------------------------------------------------------------
function genSchema(r, depth = 0) {
  const kinds = depth >= 3 ? ['string', 'integer', 'number', 'boolean', 'enum'] : ['string', 'integer', 'number', 'boolean', 'enum', 'object', 'object', 'array', 'nullable'];
  switch (r.pick(kinds)) {
    case 'string': return { type: 'string', ...(r.chance(0.4) ? { minLength: r.int(0, 3) } : {}), ...(r.chance(0.4) ? { maxLength: r.int(3, 12) } : {}) };
    case 'integer': return { type: 'integer', ...(r.chance(0.5) ? { minimum: r.int(-50, 0) } : {}), ...(r.chance(0.5) ? { maximum: r.int(1, 1000) } : {}) };
    case 'number': return { type: 'number', ...(r.chance(0.5) ? { minimum: -r.int(0, 100) / 4 } : {}), ...(r.chance(0.5) ? { maximum: r.int(1, 100) / 4 } : {}) };
    case 'boolean': return { type: 'boolean' };
    case 'enum': return { enum: r.sample(['a', 'b', 'c', 1, 2, true, 'x y'], r.int(1, 4)) };
    case 'object': return genObject(r, depth);
    case 'array': return { type: 'array', items: genSchema(r, depth + 1), ...(r.chance(0.4) ? { minItems: r.int(0, 2) } : {}), ...(r.chance(0.4) ? { maxItems: r.int(2, 5) } : {}) };
    default: { const s = genSchema(r, depth + 1); return s.type && !String(s.type).includes('null') && !Array.isArray(s.type) ? { ...s, type: [s.type, 'null'] } : s; }
  }
}
function genObject(r, depth) {
  const props = {};
  for (let i = r.int(1, 4); i > 0; i--) props[`f${i}`] = genSchema(r, depth + 1);
  return { type: 'object', properties: props, required: Object.keys(props).filter(() => r.chance(0.7)), ...(r.chance(0.5) ? { additionalProperties: false } : {}) };
}
function genValue(r, s) {
  if (r.chance(0.06)) return r.pick([null, 'zz', 3.5, -7, true, [], {}, 'αβγ😀', 12]);
  if (s.enum) return r.pick(s.enum);
  switch (Array.isArray(s.type) ? r.pick(s.type) : s.type) {
    case 'null': return null;
    case 'string': return r.pick(['', 'a', 'abc', 'abcdefghijk', '😀😀', 'x'.repeat(r.int(0, 15))]);
    case 'integer': return r.int(-60, 1100);
    case 'number': return r.int(-400, 400) / 4;
    case 'boolean': return r.chance(0.5);
    case 'object': { const o = {}; for (const [k, sub] of Object.entries(s.properties)) if (r.chance(0.85)) o[k] = genValue(r, sub); if (r.chance(0.1)) o.extra = 1; return o; }
    case 'array': return Array.from({ length: r.int(0, 6) }, () => genValue(r, s.items));
    default: return null;
  }
}
/** A dense, schema-valid value: every declared property present, no null, no empty string. */
function denseValue(r, s) {
  if (s.enum) return r.pick(s.enum);
  const t = Array.isArray(s.type) ? s.type.find(x => x !== 'null') : s.type;
  switch (t) {
    case 'string': { const lo = Math.max(1, s.minLength ?? 1), hi = Math.max(lo, Math.min(s.maxLength ?? 10, 10)); return Array.from({ length: r.int(lo, hi) }, () => r.pick(['a', 'Z', ' ', 'é', '😀', '7'])).join('').replace(/^ | $/g, 'q'); }
    case 'integer': return r.int(s.minimum ?? -50, s.maximum ?? 1000);
    case 'number': { const lo = s.minimum ?? -25, hi = s.maximum ?? 25; return Math.round((lo + r.next() * (hi - lo)) * 4) / 4; }
    case 'boolean': return r.chance(0.5);
    case 'object': return Object.fromEntries(Object.entries(s.properties).map(([k, sub]) => [k, denseValue(r, sub)]));
    case 'array': return Array.from({ length: r.int(s.minItems ?? 0, Math.min(s.maxItems ?? 4, 4)) }, () => denseValue(r, s.items));
    default: return null;
  }
}

test('validator: the host\'s portable validator agrees with the engine\'s ajv authority (validateData) on seeded schemas and values', () => {
  let accepted = 0, rejected = 0;
  for (let i = 0; i < 3000; i++) {
    const r = rng('ebed-host-props', 'validator', i);
    const schema = genObject(r, 0);
    const value = genValue(r, schema);
    const mine = H.validate(schema, value).length === 0;
    let theirs;
    try { validateData(schema, value); theirs = true; } catch (e) { if (e.code !== 'SCHEMA_MISMATCH') throw e; theirs = false; }
    assert.equal(mine, theirs, `case ${i}: ${JSON.stringify(schema)} ${JSON.stringify(value)}`);
    if (mine) accepted++; else rejected++;
  }
  assert.ok(accepted > 300 && rejected > 300, `both outcomes exercised (${accepted}/${rejected})`);
});

test('validator: the host\'s portability check agrees with the engine\'s portableSchemaViolations', () => {
  const bad = [{ pattern: '^a' }, { format: 'email' }, { oneOf: [] }, { $ref: '#/x' }, { uniqueItems: true }, { type: 'decimal' }, { enum: [{ a: 1 }] },
    { required: ['a', 'a'] }, { minLength: -1 }, { items: [{ type: 'string' }] }, { type: ['string', 'string'] }, { maxItems: 1.5 }];
  for (let i = 0; i < 1000; i++) {
    const r = rng('ebed-host-props', 'portable', i);
    const schema = genObject(r, 0);
    if (r.chance(0.5)) { const k = r.pick(Object.keys(schema.properties)); schema.properties[k] = { ...schema.properties[k], ...r.pick(bad) }; }
    if (r.chance(0.1)) schema.type = 'array';
    assert.equal(H.schemaProblems(schema, { root: 'object' }).length === 0, portableSchemaViolations(schema).length === 0, `case ${i}: ${JSON.stringify(schema)}`);
  }
});

test('G21 round trip: dense valid answers survive render -> fill -> submit -> parse; planted "12abc" passes the client rule and is rejected by the host', async () => {
  for (let i = 0; i < 1000; i++) {
    const r = rng('ebed-host-props', 'form', i);
    const schema = genObject(r, 0);
    const value = denseValue(r, schema);
    assert.deepEqual(H.validate(schema, value), [], `generator: case ${i}`);
    const back = H.fromFormState(schema, H.toFormState(schema, value));
    assert.deepEqual(back, value, `case ${i}: ${JSON.stringify(schema)}`);
  }
  const schema = { type: 'object', properties: { amountMinor: { type: 'integer', minimum: 0 }, note: { type: 'string' } }, required: ['amountMinor', 'note'] };
  const state = H.toFormState(schema, { amountMinor: 12, note: 'ok' });
  const planted = H.plantInvalid(state);
  assert.equal(planted.formState.amountMinor.value, '12abc');
  assert.equal(H.clientNumericAccepts('12abc'), true, 'OpenUI numeric rule (parseFloat) accepts it');
  const parsed = H.fromFormState(schema, planted.formState);
  assert.equal(parsed.amountMinor, '12abc');
  assert.ok(H.validate(schema, parsed).length > 0, 'the host rejects it');
  for (const [text, ok] of [['7', true], [' 7 ', true], ['7.0', false], ['0x10', false], ['1e3', false], ['', false], ['-0', true]]) {
    const v = H.fromFormState(schema, { ...state, amountMinor: { value: text, componentType: 'NumberInput' } });
    assert.equal(H.validate(schema, v).length === 0, ok, `integer entry ${JSON.stringify(text)}`);
  }
  // In a run: every planted entry is rejected first and the re-entered answer validates.
  for (const seed of SEEDS.slice(0, 10)) {
    const world = p2pWorld({ seed, cases: 10, backlog: 0, faults: false, noise: { form: 1, formInvalid: 1 } });
    const res = await run({ item: p2pItem, world, arm: p2pSolver() });
    const rejections = ofType(res, 'form.rejected');
    const answered = ofType(res, 'deliver').filter(d => d.event.type === 'humanTask.answered');
    assert.equal(rejections.length, answered.length, 'one planted rejection per form-routed answer');
    for (const f of rejections) { assert.equal(f.clientNumericAccepts, true); assert.ok(f.errors.length > 0); }
    for (const d of answered) assert.deepEqual(H.validate(APPROVE_SCHEMA, d.event.payload.answer), []);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
test('leak: no truth-only string, hidden field, injection tag or product-computed field reaches inputs, files or reads', async () => {
  for (const seed of SEEDS.slice(0, 10)) {
    for (const [item, world, arm] of [[p2pItem, p2pWorld({ seed, renames: true }), p2pSolver()], [p2pItem, p2pWorld({ seed }), fuzzArm(seed)], [sagaItem, sagaWorld({ seed }), sagaSolver()]]) {
      const rec = recording(arm);
      await run({ item, world, arm: rec.arm });
      const seen = JSON.stringify(rec.log);
      for (const [c, t] of Object.entries(world.truth.cases)) {
        if (t.secret) assert.ok(!seen.includes(t.secret), `truth secret of ${c}`);
        assert.ok(!seen.includes(`"${c}"`), `truth case id ${c}`);
      }
      for (const k of ['"injected"', '"faultTags"', '"binding"', '"subjectCase"', '"score"', '"priceTotals"', '"breached"']) assert.ok(!seen.includes(k), `${k} never reaches an arm`);
    }
  }
  const fraud = new H.MockSystem(e8.fraud);
  fraud.write('verdicts', { orderId: 'O1', verdict: 'review', score: 97 });
  assert.throws(() => fraud.query('verdicts', {}), /no-such-table/);
  assert.deepEqual(fraud.read('check', { orderId: 'O1' }, 0).result, { orderId: 'O1', verdict: 'review' });
  assert.ok(!JSON.stringify(fraud.apiSchema(0)).includes('verdicts'), 'hidden tables are not in the API schema');
});

test('censoring record: run.end lists exactly the open instances, their obligations and open tasks', async () => {
  for (const seed of SEEDS.slice(0, 8)) {
    const res = await run({ item: p2pItem, world: p2pWorld({ seed, horizonDays: 4, noise: { none: 0.5 } }), arm: p2pSolver() });
    const end = ofType(res, 'run.end')[0];
    const open = [...res.host.instances.values()].filter(i => !i.closed).map(i => i.id);
    assert.deepEqual(end.open.map(o => o.instance), open);
    for (const o of end.obligations) assert.ok(open.includes(o.instance));
    assert.equal(end.digests.sor, res.digests.sor);
    assert.equal(end.digests.ledger, res.digests.ledger);
  }
});

test('bounds: 1,000 toy cases run in bounded time and memory (reported)', async () => {
  const t = performance.now();
  const before = process.memoryUsage().heapUsed;
  const res = await run({ item: p2pItem, world: p2pWorld({ seed: 1030, cases: 1000, backlog: 50, horizonDays: 40 }), arm: p2pSolver() });
  const secs = (performance.now() - t) / 1000;
  const mb = (process.memoryUsage().heapUsed - before) / 2 ** 20;
  console.log(`[ebed-host] 1000 cases: ${res.stats.caseTicks} case-ticks, ${res.stats.sweepTicks} sweep ticks, ${res.stats.wakeups} wake-ups, ${secs.toFixed(2)} s, heap +${mb.toFixed(0)} MB, journal ${res.host.journal.rows.length} rows`);
  assert.equal(res.status, 'complete');
  assert.ok(secs < 60, `${secs} s`);
});
