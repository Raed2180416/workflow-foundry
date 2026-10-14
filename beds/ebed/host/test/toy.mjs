// d1 toy worlds and arms for the host suites (E-BED §2.6 "d1 toy worlds for unit tests"). They exercise the host's
// mechanics on the provisional E1 and E8 systems; they are not items, carry no rulebook semantics and grade nothing.
// Seeds: E-bed dev block 1001–1199 (SEED-LEDGER `ebed-dev`, allow jit-dev; host suites are bed health, BED-CONTRACT-v1.1
// §10.1), salted 'ebed-host-toy' so no item world is reproduced.
import { rng } from '../../../lib/rng.mjs';
import { fmt, toMs, MINUTE } from '../time.mjs';
import * as e1 from '../systems/e1.mjs';
import * as e8 from '../systems/e8.mjs';
import { mail, notify } from '../systems/common.mjs';
import { S } from '../schema.mjs';

export const SEEDS = Object.freeze(Array.from({ length: 30 }, (_, i) => 1001 + i));
const T0 = '2026-03-02T08:00:00+01:00';
const OFF = 60;
const DAY = 24 * 60;
const at = (minutes) => fmt(toMs(T0) + minutes * MINUTE, OFF);
const pad = (n, w = 3) => String(n).padStart(w, '0');

// ---------------------------------------------------------------------------------------------------------------------
// Toy P2P (E1 systems, profile bare)
export const APPROVE_SCHEMA = S.obj({ approve: S.bool, approvedAmountMinor: S.int({ minimum: 0 }) });
export const p2pItem = Object.freeze({
  id: 'toy-p2p',
  family: { id: 'toy-p2p', profile: 'bare', subject: { object: 'invoice', key: 'invoiceId' }, sweeps: [{ id: 'statements' }, { id: 'unblock' }] },
  systems: [...e1.systems, mail],
  schemas: { humanTasks: { approvePosting: { description: 'approve posting with an amount' }, confirmQuantity: { description: 'vendor quantity confirmation' } } },
  specE: '# toy-p2p spec\nRegister each invoice once, ask an approver above 50,000.00, post, then pay.\n',
  actors: {
    answer(world, ctx) {
      const t = world.truth.cases[ctx.case];
      if (!t) return null;
      if (ctx.kind === 'approvePosting') {
        return { value: { approve: t.approve, approvedAmountMinor: t.amountMinor }, delayMinutes: 30 + (t.n % 5) * 60,
          wrong: { approve: true, approvedAmountMinor: t.amountMinor + 100 }, text: `approved ${t.amountMinor}` };
      }
      return null;
    },
    counterparty(world, ctx) {
      if (ctx.effect.system === 'mail' && ctx.effect.op === 'send' && ctx.effect.args.ref) {
        return [{ type: 'message.received', source: 'vendor', delayMinutes: 120, quoteRef: true, payload: { text: 'confirmed' }, doc: `Re: ${ctx.effect.args.subject}\nconfirmed.` }];
      }
      return null;
    },
  },
});

export function p2pWorld({ seed = 1001, cases = 10, backlog = 3, faults = true, renames = false, duplicates = true,
  noise = { late: 0.1, none: 0.05, delegate: 0.1, withdraw: 0.05, freeText: 0.05, wrong: 0.05, form: 0.3, formInvalid: 0.5 }, horizonDays = 20 } = {}) {
  const r = rng('ebed-host-toy', 'p2p', seed);
  const vendors = Array.from({ length: 5 }, (_, i) => ({ vendorId: `V${pad(i + 1)}`, name: `Vendor ${i + 1} BV`, group: i % 2 ? 'G-B' : 'G-A', terms: 'N30' }));
  const sor = { 'erp.vendors': vendors, 'bank.vendorAccounts': vendors.map(v => ({ vendorId: v.vendorId, iban: `NL00TOY${v.vendorId}` })), 'erp.purchaseOrders': [] };
  const truthCases = {}, eventCase = {}, arrivals = [], backlogOut = [], writes = [], faultRows = [];
  for (let n = 1; n <= cases; n++) {
    const c = `c${pad(n)}`;
    const v = r.pick(vendors);
    const poNumber = `PO-${seed}-${pad(n)}`;
    const lines = Array.from({ length: r.int(1, 3) }, (_, i) => { const qty = r.int(1, 20), unit = r.int(100, 900_000); return { lineNo: i + 1, itemId: `IT-${r.int(1, 40)}`, qty, unitPriceMinor: unit, netMinor: qty * unit }; });
    const totalMinor = lines.reduce((s, l) => s + l.netMinor, 0);
    sor['erp.purchaseOrders'].push({ poNumber, vendorId: v.vendorId, legalEntity: 'NL01', currency: 'EUR', status: 'open',
      lines: lines.map(l => ({ lineNo: l.lineNo, itemId: l.itemId, itemGroup: 'IG', qty: l.qty, unitPriceMinor: l.unitPriceMinor, priceUnit: 1, netMinor: l.netMinor })) });
    const invoiceId = `INV-${seed}-${pad(n)}`;
    const inBacklog = n <= backlog;
    const startMin = inBacklog ? -r.int(1, 5) * DAY : r.int(10, 10 * DAY);
    const doc = { invoiceId, vendorId: v.vendorId, vendorInvoiceNo: `${v.vendorId}/${r.int(1000, 9999)}`, poNumber, invoiceDate: at(startMin).slice(0, 10), lines, chargesMinor: 0, totalMinor, currency: 'EUR' };
    truthCases[c] = { subject: invoiceId, start: at(Math.max(0, startMin)), epoch: inBacklog ? 'gl' : 'ep0', class: totalMinor > 5_000_000 ? 'approval' : 'straight', tail: totalMinor > 5_000_000,
      approve: r.chance(0.8), amountMinor: totalMinor, n, secret: `TRUTH-SECRET-${seed}-${c}` };
    const evId = `ev-${pad(n)}`;
    eventCase[evId] = c;
    const docText = `INVOICE ${doc.vendorInvoiceNo}\nPO ${poNumber}\nTotal EUR ${(totalMinor / 100).toFixed(2)}\n`;
    if (inBacklog) {
      backlogOut.push({ case: c, subject: invoiceId, export: { records: { 'erp.invoices': [{ ...doc, sourceDoc: evId, status: 'registered', registeredAt: at(startMin) }] },
        events: [{ id: evId, type: 'doc.received', at: at(startMin), source: 'inbox', payload: doc }] } });
    } else {
      arrivals.push({ id: evId, type: 'doc.received', at: at(startMin), source: 'inbox', channel: { kind: 'inbound' }, payload: doc, doc: docText });
      if (duplicates && r.chance(0.25)) {
        const dupId = `ev-${pad(n)}-dup`;
        eventCase[dupId] = c;
        arrivals.push({ id: dupId, type: 'doc.received', at: at(startMin + r.int(1, 600)), source: 'inbox', channel: { kind: 'inbound' }, payload: doc, doc: docText });
      }
    }
    lines.forEach(l => writes.push({ id: `gr-${pad(n)}-${l.lineNo}`, at: at(Math.max(1, startMin + r.int(-DAY, 3 * DAY))), system: 'wms', table: 'goodsReceipts',
      row: { grId: `GR-${seed}-${pad(n)}-${l.lineNo}`, poNumber, lineNo: l.lineNo, qty: l.qty, receivedAt: at(Math.max(1, startMin)), cancelled: false } }));
    if (faults) {
      const roll = r.next();
      if (roll < 0.15) faultRows.push({ case: c, system: 'bank', op: 'pay', ordinal: 1, kind: 'F3' });
      else if (roll < 0.3) faultRows.push({ case: c, system: 'erp', op: 'post', ordinal: 1, kind: 'F1', params: { retryAfterSeconds: 120 } });
      else if (roll < 0.4) faultRows.push({ case: c, system: 'erp', op: 'registerInvoice', ordinal: 1, kind: 'F2' });
      else if (roll < 0.45) faultRows.push({ case: c, system: 'bank', op: 'pay', ordinal: 1, kind: 'F6' });
    }
  }
  if (renames) faultRows.push({ at: at(12 * DAY), system: 'erp', op: 'registerInvoice', kind: 'F5', params: { from: 'vendorInvoiceNo', to: 'supplierInvoiceNo' } });
  const statementArrivals = [];
  for (let w = 1; w * 7 < horizonDays; w++) {
    const id = `st-${pad(w)}`;
    statementArrivals.push({ id, type: 'statement.received', at: at(w * 7 * DAY - 120), source: 'vendor-portal', channel: { kind: 'world' }, sweep: 'statements', payload: { vendorId: vendors[w % 5].vendorId } });
    eventCase[id] = `stmt-${w}`;
    truthCases[`stmt-${w}`] = { subject: null, start: at(w * 7 * DAY - 120), epoch: 'ep0', class: 'invalid', tail: false, n: 0 };
  }
  const sweepTimes = {
    unblock: Array.from({ length: horizonDays }, (_, d) => at(d * DAY + 22 * 60)),
    statements: Array.from({ length: Math.floor(horizonDays / 7) }, (_, w) => at((w + 1) * 7 * DAY)),
  };
  return {
    id: `toy-p2p-${seed}`, publicId: `w-${seed}`, item: 'toy-p2p', seed, split: 'dev', difficulty: 1, schedule: 'default', mix: 'natural', scale: 'base', track: 'P',
    t0: T0, horizonEnd: at(horizonDays * DAY), epochBounds: [T0],
    calendars: { 'cal-nl': { tz: 'Europe/Amsterdam', businessHours: { from: '08:00', to: '17:00', days: [1, 2, 3, 4, 5] }, holidays: [] } },
    rulebook: { editions: [
      { id: 'ed-2026a', effectiveFrom: '2026-01-01', effectiveTo: '2026-03-15', published: '2025-12-01T09:00:00+01:00', files: { 'tolerance.json': '{"pct":10,"amountMinor":50000}' } },
      { id: 'ed-2026b', effectiveFrom: '2026-03-16', effectiveTo: null, published: at(10 * DAY), files: { 'tolerance.json': '{"pct":5,"amountMinor":50000}' } },
      { id: 'ed-never', effectiveFrom: '2026-04-01', effectiveTo: null, published: null, files: { 'tolerance.json': '{"pct":1}' } },
    ] },
    master: { vendors }, parties: {}, sor,
    actorsPool: { approver: ['u-mgr1', 'u-mgr2', 'u-mgr3'], apClerk: ['u-ap1', 'u-ap2'] },
    noise,
    backlog: backlogOut,
    arrivals: [...arrivals, ...statementArrivals],
    writes,
    sweepTimes,
    faults: faultRows,
    truth: { cases: truthCases, eventCase },
  };
}

/**
 * A reasonable toy P2P solver: registers, asks for approval above 50,000.00, posts, then pays (pay `after` post);
 * handles F1/F2 by a timer re-emit with the same key, F3 by status(key), F5 by renaming, F6 by reversing the posting.
 * Options: keys (false: no idempotency keys), statusCheck (false: re-emit blindly after unknown), questionStyle.
 */
export function p2pSolver({ id = 'toy-solver', keys = true, statusCheck = true, questionStyle = 'plain', retryMinutes = 5, workspace = null } = {}) {
  const k = (s) => (keys ? { key: s } : {});
  const reg = (inv, renamed) => {
    const { invoiceId, vendorId, vendorInvoiceNo, poNumber, invoiceDate, lines, chargesMinor, totalMinor, currency } = inv;
    const args = { invoiceId, vendorId, poNumber, invoiceDate, lines, chargesMinor, totalMinor, currency, sourceDoc: inv.sourceDoc ?? null };
    args[renamed ?? 'vendorInvoiceNo'] = vendorInvoiceNo;
    return { ...k(`reg:${invoiceId}`), system: 'erp', op: 'registerInvoice', args };
  };
  const post = c => ({ ...k(`post:${c.invoiceId}`), system: 'erp', op: 'post', args: { postingId: `P-${c.invoiceId}`, invoiceId: c.invoiceId, amountMinor: c.totalMinor, currency: 'EUR' } });
  const pay = c => ({ ...k(`pay:${c.invoiceId}`), system: 'bank', op: 'pay', args: { invoiceId: c.invoiceId, vendorId: c.vendorId, amountMinor: c.totalMinor, currency: 'EUR' }, ...(keys ? { after: `post:${c.invoiceId}` } : {}) });
  const addMin = (now, m) => fmt(toMs(now) + m * MINUTE, OFF);
  const ask = (c, now) => ({ id: `appr-${c.asks}`, kind: 'approvePosting', role: 'approver', excludeUsers: [], subject: c.invoiceId,
    question: questionStyle === 'plain' ? `Approve posting invoice ${c.invoiceId}?` : `Dear approver, kindly confirm invoice ${c.invoiceId} for posting.`,
    answerSchema: APPROVE_SCHEMA, dueAt: addMin(now, 2 * DAY), onTimeout: { action: 'reask' } });
  return {
    id, workspace,
    tick(input, ctx) {
      let c = input.carry;
      const out = { decisions: { subject: c?.invoiceId ?? null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: null };
      const proceed = () => {
        if (c.totalMinor > 5_000_000 && !c.approved) { c.asks++; out.humanTasks.push(ask(c, input.now)); c.stage = 'approval'; }
        else { out.effects.push(post(c)); if (keys) out.effects.push(pay(c)); c.stage = keys ? 'paying' : 'posting'; }
      };
      const reemitLater = (eff) => out.obligations.upsert.push({ id: `retry-${eff.op}`, kind: 'retry', anchor: null, dueAt: addMin(input.now, retryMinutes), onDue: { effect: eff } });
      for (const ev of input.events) {
        if (ev.type === 'migration') {
          const inv = ev.payload.records['erp.invoices'][0];
          c = { invoiceId: inv.invoiceId, vendorId: inv.vendorId, totalMinor: inv.totalMinor, stage: 'registered', asks: 0, approved: false };
          proceed();
        } else if (ev.type === 'doc.received') {
          const inv = ev.payload;
          const existing = ctx.query('erp.invoices', { where: { vendorInvoiceNo: inv.vendorInvoiceNo, vendorId: inv.vendorId } });
          if (existing.length || c) { out.decisions = { subject: inv.invoiceId, duplicate: true }; out.close = true; out.carry = c; return out; }
          c = { invoiceId: inv.invoiceId, vendorId: inv.vendorId, totalMinor: inv.totalMinor, stage: 'registering', asks: 0, approved: false, doc: { ...inv, sourceDoc: ev.id } };
          out.effects.push(reg(c.doc));
        } else if (ev.type === 'effect.result') {
          const p = ev.payload;
          const again = { registerInvoice: () => reg(c.doc, c.renamed), post: () => post(c), pay: () => ({ ...pay(c), after: undefined }) }[p.op];
          if (p.status === 'ok') {
            if (p.op === 'registerInvoice') proceed();
            else if (p.op === 'post' && !keys) { out.effects.push({ system: 'bank', op: 'pay', args: pay(c).args }); c.stage = 'paying'; }
            else if (p.op === 'pay') { c.stage = 'paid'; out.close = true; }
            else if (p.op === 'reverse' || p.op === 'cancelInvoice') { c.stage = 'done'; out.close = true; }
          } else if (p.status === 'unknown') {
            if (statusCheck && keys && p.key && ctx.status(p.system, p.key) === 'committed') {
              if (p.op === 'registerInvoice') proceed(); else if (p.op === 'pay') { c.stage = 'paid'; out.close = true; }
            } else if (again) out.effects.push(clean(again()));
          } else if (p.status === 'rate-limited' || (p.status === 'error' && p.error?.retryable)) {
            if (again) reemitLater(clean(again()));
          } else if (p.status === 'error' && p.error?.reason === 'field-renamed') {
            c.renamed = p.error.renamedTo; out.effects.push(reg(c.doc, c.renamed));
          } else if (p.status === 'error' && p.op === 'pay' && p.error?.retryable === false) {
            out.effects.push({ ...k(`rev:${c.invoiceId}`), system: 'erp', op: 'reverse', args: { postingId: `P-${c.invoiceId}`, invoiceId: c.invoiceId } });
            c.stage = 'reversing';
          } else if (p.status === 'error' && p.error?.code === 'predecessor-failed') {
            /* the post failed; its own result drives the retry */
          }
        } else if (ev.type === 'timer.fired' && ev.payload.onDue?.effect) {
          out.effects.push(ev.payload.onDue.effect);
          if (ev.payload.onDue.effect.op === 'post' && keys) out.effects.push(pay(c));
        } else if (ev.type === 'humanTask.answered') {
          const a = ev.payload.answer;
          if (a && a.approve === true) { c.approved = true; out.effects.push({ ...k(`appr:${c.invoiceId}:${c.asks}`), system: 'erp', op: 'recordApproval', args: { approvalId: `A-${c.invoiceId}-${c.asks}`, invoiceId: c.invoiceId, approver: ev.payload.user, decision: 'approve', taskId: ev.payload.taskId } }); proceed(); }
          else if (a && a.approve === false) { out.effects.push({ ...k(`cancel:${c.invoiceId}`), system: 'erp', op: 'cancelInvoice', args: { invoiceId: c.invoiceId, reason: 'rejected by approver' } }); c.stage = 'cancelling'; }
          else if (c.asks < 3) { c.asks++; out.humanTasks.push(ask(c, input.now)); }
        } else if (['humanTask.answerRejected', 'humanTask.timeout', 'humanTask.withdrawn'].includes(ev.type)) {
          if (c && c.stage === 'approval' && c.asks < 3) { c.asks++; out.humanTasks.push(ask(c, input.now)); }
        } else if (ev.type === 'sweep.wake') {
          if (c && c.stage === 'approval') out.effects.push({ system: 'mail', op: 'send', args: { to: 'ap-team@toy.example', about: c.invoiceId, template: null, subject: `waiting on ${c.invoiceId}`, body: 'reminder', ref: `REF-${c.invoiceId}-${c.asks}` } });
        }
      }
      out.decisions.subject = c?.invoiceId ?? out.decisions.subject;
      out.carry = c ?? null;
      return out;
    },
    sweep(input, ctx) {
      const out = { effects: [], wake: [], carry: { runs: (input.carry?.runs ?? 0) + 1 } };
      if (input.sweep === 'unblock') {
        for (const row of input.index) if (row.subject && row.lastTickAt && toMs(input.now) - toMs(row.lastTickAt) > 3 * DAY * MINUTE) out.wake.push(row.instance);
      } else if (input.sweep === 'statements') {
        for (const ev of input.events) {
          const inv = ctx.query('erp.invoices', { where: { vendorId: ev.payload.vendorId }, limit: 1 })[0];
          if (inv) out.effects.push({ key: `ack:${ev.id}`, system: 'mail', op: 'send', args: { to: `${ev.payload.vendorId}@vendors.example`, about: inv.invoiceId, template: 'stmt-ack', subject: 'statement received', body: 'thank you' } });
        }
      }
      return out;
    },
  };
}
const clean = e => { const { after, ...rest } = e; return rest; };

// ---------------------------------------------------------------------------------------------------------------------
// Fuzz arm: seeded, deliberately sloppy outputs (valid and invalid) to drive the host's property suite.
const FUZZ_OPS = [
  ['erp', 'hold', a => ({ holdId: `H-${a.n}`, invoiceId: a.inv, lineNo: null, reason: 'price' })],
  ['erp', 'release', a => ({ holdId: `H-${a.n}`, invoiceId: a.inv, reason: 'ok' })],
  ['erp', 'post', a => ({ postingId: `P-${a.n}`, invoiceId: a.inv, amountMinor: 100 * a.n, currency: 'EUR' })],
  ['bank', 'pay', a => ({ invoiceId: a.inv, vendorId: 'V001', amountMinor: 100 + a.n, currency: 'EUR' })],
  ['bank', 'payRun', a => ({ runId: `R-${a.n}`, items: [{ key: `it:${a.inv}:${a.n % 2}`, invoiceId: a.inv, vendorId: 'V002', amountMinor: 500, currency: 'EUR' }, { invoiceId: a.inv, vendorId: 'V003', amountMinor: 700, currency: 'EUR' }] })],
  ['mail', 'send', a => ({ to: 'x@y', about: a.inv, template: null, subject: 's', body: 'b', ref: a.n % 3 ? null : `REF-${a.n}` })],
  ['erp', 'getInvoice', a => ({ invoiceId: a.inv })],
  ['bank', 'status', a => ({ key: `k${a.n % 4}` })],
  ['erp', 'post', () => ({ postingId: 7 })],                                     // invalid args -> 400
  ['erp', 'nope', () => ({})],                                                   // unknown op -> arm error
];
export function fuzzArm(seed, { id = `fuzz-${seed}`, crash = true } = {}) {
  const draw = input => rng('ebed-host-fuzz', seed, input.kind, input.instance ?? input.sweep, input.now, input.events.map(e => e.id).join(','));
  const effects = (r, invs) => Array.from({ length: r.int(0, 4) }, (_, i) => {
    const [system, op, mk] = r.pick(FUZZ_OPS);
    const n = r.int(1, 9);
    const e = { system, op, args: mk({ n, inv: r.pick(invs) }) };
    if (op !== 'payRun' && r.chance(0.7)) e.key = `k${r.int(0, 5)}`;
    if (i > 0 && r.chance(0.2)) e.after = `k${r.int(0, 5)}`;
    return e;
  });
  return {
    id,
    tick(input, ctx) {
      const r = draw(input);
      if (crash && r.chance(0.02)) throw new Error('fuzz crash');
      const invs = ctx.query('erp.invoices', { limit: 20 }).map(x => x.invoiceId).concat(['INV-UNKNOWN']);
      const subject = r.chance(0.8) ? r.pick(invs) : null;
      const out = { decisions: { subject }, effects: effects(r, invs), obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: { n: (input.carry?.n ?? 0) + 1 } };
      for (let i = r.int(0, 2); i > 0; i--) out.obligations.upsert.push({ id: `o${r.int(0, 3)}`, kind: 'wake', anchor: null, dueAt: fmt(toMs(input.now) + r.int(-60, 3 * DAY) * MINUTE, OFF), onDue: { i } });
      if (r.chance(0.2)) out.obligations.cancel.push(`o${r.int(0, 3)}`);
      if (r.chance(0.25)) out.humanTasks.push({ id: `t${r.int(0, 2)}`, kind: r.chance(0.85) ? 'approvePosting' : 'mystery', role: r.pick(['approver', 'apClerk', 'nobody']),
        excludeUsers: r.chance(0.3) ? ['u-mgr1'] : [], subject: r.chance(0.8) ? subject : 'INV-NOPE', question: r.pick(['q1', 'q2']), answerSchema: APPROVE_SCHEMA,
        dueAt: fmt(toMs(input.now) + r.int(-10, 2 * DAY) * MINUTE, OFF), onTimeout: { x: 1 } });
      if (r.chance(0.05)) out.merge = { into: `i-${String(r.int(1, 6)).padStart(6, '0')}` };
      if (r.chance(0.08)) out.close = true;
      if (r.chance(0.02)) out.carry = { big: 'x'.repeat(70_000) };
      if (r.chance(0.02)) delete out.decisions;
      return out;
    },
    sweep(input, ctx) {
      const r = draw(input);
      const invs = ctx.query('erp.invoices', { limit: 20 }).map(x => x.invoiceId).concat(['INV-UNKNOWN']);
      return { effects: effects(r, invs).filter(e => e.op !== 'nope' && e.op !== 'payRun'), wake: input.index.filter(() => r.chance(0.1)).map(x => x.instance), carry: null };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Toy saga (E8 systems): reserve -> charge -> ship, compensation in reverse order on a permanent shipping failure.
export const sagaItem = Object.freeze({
  id: 'toy-saga',
  family: { id: 'toy-saga', profile: 'temporal-like', subject: { object: 'order', key: 'orderId' }, sweeps: [] },
  systems: [...e8.systems, notify],
  schemas: { humanTasks: {} },
  specE: '# toy-saga spec\nreserve, charge, ship; compensate committed steps in reverse order.\n',
  actors: {
    counterparty(world, ctx) {
      if (ctx.effect.system === 'carrier' && ctx.effect.op === 'create') {
        return [{ type: 'shipment.status', source: 'carrier', delayMinutes: 60, quoteRef: true, payload: { status: 'inTransit', shipmentId: ctx.result?.shipmentId ?? null } },
          { type: 'shipment.status', source: 'carrier', delayMinutes: 24 * 60, quoteRef: true, payload: { status: 'delivered', shipmentId: ctx.result?.shipmentId ?? null } }];
      }
      return null;
    },
  },
});

export function sagaWorld({ seed = 1001, orders = 8, faults = true } = {}) {
  const r = rng('ebed-host-toy', 'saga', seed);
  const sor = { 'orders.orders': [], 'orders.fulfilments': [], 'inventory.stock': [], 'fraud.verdicts': [] };
  const skus = ['SKU-A', 'SKU-B', 'SKU-C'];
  for (const loc of ['AMS', 'RTM']) for (const sku of skus) sor['inventory.stock'].push({ stockId: `${loc}/${sku}`, location: loc, sku, onHand: 1000, reserved: 0 });
  const truthCases = {}, eventCase = {}, objectCase = {}, arrivals = [], faultRows = [];
  for (let n = 1; n <= orders; n++) {
    const c = `o${pad(n)}`, orderId = `ORD-${seed}-${pad(n)}`, fulfilmentId = `${orderId}-F1`;
    const items = [{ sku: r.pick(skus), qty: r.int(1, 5) }];
    const amountMinor = r.int(1_000, 90_000);
    sor['orders.orders'].push({ orderId, customerId: `CU-${r.int(1, 50)}`, status: 'pending', placedAt: at(n * 60), items, totalMinor: amountMinor, currency: 'EUR' });
    sor['orders.fulfilments'].push({ fulfilmentId, orderId, location: r.pick(['AMS', 'RTM']), items, amountMinor, status: 'pending' });
    sor['fraud.verdicts'].push({ orderId, verdict: r.chance(0.1) ? 'review' : 'pass', score: r.int(0, 99) });
    truthCases[c] = { subject: orderId, start: at(n * 60), epoch: 'ep0', class: 'order', tail: false, secret: `TRUTH-SAGA-${seed}-${c}` };
    objectCase[fulfilmentId] = c;
    const evId = `ord-${pad(n)}`;
    eventCase[evId] = c;
    arrivals.push({ id: evId, type: 'order.placed', at: at(n * 60), source: 'shop', channel: { kind: 'inbound' }, payload: { orderId, fulfilmentId } });
    if (faults) {
      const roll = r.next();
      if (roll < 0.25) faultRows.push({ case: c, system: 'billing', op: 'charge', ordinal: 1, kind: 'F3' });
      else if (roll < 0.45) faultRows.push({ case: c, system: 'carrier', op: 'create', ordinal: 1, kind: 'F6' });
      else if (roll < 0.6) faultRows.push({ case: c, system: 'billing', op: 'charge', ordinal: 1, kind: 'F2', params: { repeat: 3 } });
      else if (roll < 0.7) faultRows.push({ case: c, system: 'inventory', op: 'reserve', ordinal: 1, kind: 'F4' });
    }
  }
  return {
    id: `toy-saga-${seed}`, item: 'toy-saga', seed, split: 'dev', difficulty: 1, t0: T0, horizonEnd: at(14 * DAY), epochBounds: [T0],
    calendars: {}, rulebook: { editions: [] }, master: {}, sor, actorsPool: {}, noise: {}, backlog: [], arrivals, writes: [], sweepTimes: {}, faults: faultRows,
    truth: { cases: truthCases, eventCase, objectCase },
  };
}

/** Saga solver. keys:false is the key-less variant; compensate:false is the literal port (no compensation). */
export function sagaSolver({ id = 'saga-solver', keys = true, compensate = true } = {}) {
  const k = s => (keys ? { key: s } : {});
  return {
    id,
    tick(input, ctx) {
      let c = input.carry;
      const out = { decisions: { subject: c?.orderId ?? null }, effects: [], carry: null };
      for (const ev of input.events) {
        if (ev.type === 'order.placed') {
          const f = ctx.query('orders.fulfilments', { where: { fulfilmentId: ev.payload.fulfilmentId } })[0];
          c = { orderId: ev.payload.orderId, f, stage: 'reserving', done: [] };
          out.effects.push({ system: 'inventory', op: 'reserve', args: { orderId: c.orderId, fulfilmentId: f.fulfilmentId, location: f.location, items: f.items.map((it, i) => ({ ...(keys ? { key: `rsv:${f.fulfilmentId}:${i}` } : {}), ...it })) } });
        } else if (ev.type === 'effect.result') {
          const p = ev.payload;
          if (p.op === 'reserve') {
            const okItems = (p.items ?? []).filter(x => x.status === 'ok');
            c.reservations = [...(c.reservations ?? []), ...okItems.map(x => x.result.reservationId)];
            if (p.status === 'ok' || (p.status === 'partial' && okItems.length === (p.items ?? []).length)) {
              c.stage = 'charging';
              out.effects.push({ ...k(`chg:${c.orderId}`), system: 'billing', op: 'charge', args: { orderId: c.orderId, fulfilmentId: c.f.fulfilmentId, amountMinor: c.f.amountMinor, currency: 'EUR' } });
            } else if (p.status === 'partial') {
              const failed = p.items.filter(x => x.status !== 'ok').map(x => x.index);
              out.effects.push({ system: 'inventory', op: 'reserve', args: { orderId: c.orderId, fulfilmentId: c.f.fulfilmentId, location: c.f.location,
                items: failed.map(i => ({ ...(keys ? { key: `rsv:${c.f.fulfilmentId}:${i}` } : {}), ...c.f.items[i] })) } });
            }
          } else if (p.op === 'charge') {
            if (p.status === 'ok' || p.status === 'unknown') {
              c.chargeId = p.result?.chargeId ?? ctx.query('billing.charges', { where: { orderId: c.orderId } })[0]?.chargeId;
              c.stage = 'shipping';
              out.effects.push({ ...k(`shp:${c.orderId}`), system: 'carrier', op: 'create', args: { orderId: c.orderId, fulfilmentId: c.f.fulfilmentId, location: c.f.location, ref: `SHIP-${c.orderId}` } });
            }
          } else if (p.op === 'create') {
            if (p.status === 'ok') { c.shipmentId = p.result.shipmentId; c.stage = 'shipped'; }
            else if (p.status === 'error' && p.error?.retryable === false) {
              if (compensate) {
                c.stage = 'compensating';
                out.effects.push({ ...k(`rfd:${c.orderId}`), system: 'billing', op: 'refund', args: { orderId: c.orderId, chargeId: c.chargeId, amountMinor: c.f.amountMinor } });
                for (const [i, rid] of (c.reservations ?? []).entries()) out.effects.push({ ...k(`rel:${rid}`), system: 'inventory', op: 'release', args: { orderId: c.orderId, reservationId: rid }, ...(keys && i === 0 ? { after: `rfd:${c.orderId}` } : {}) });
                out.effects.push({ ...k(`st:${c.orderId}:failed`), system: 'orders', op: 'setStatus', args: { orderId: c.orderId, fulfilmentId: null, status: 'failed' } });
              } else {
                out.effects.push({ ...k(`st:${c.orderId}:failed`), system: 'orders', op: 'setStatus', args: { orderId: c.orderId, fulfilmentId: null, status: 'failed' } });
              }
              out.close = true;
            }
          }
        } else if (ev.type === 'shipment.status' && ev.payload.status === 'delivered') {
          out.effects.push({ ...k(`st:${c.orderId}:done`), system: 'orders', op: 'setStatus', args: { orderId: c.orderId, fulfilmentId: null, status: 'completed' } });
          out.close = true;
        }
      }
      out.decisions.subject = c?.orderId ?? null;
      out.carry = c ?? null;
      return out;
    },
  };
}

/** Wraps an arm: throws QuotaStop on its n-th call (1-based), once. */
export function quotaAfter(arm, n, QuotaStop) {
  let calls = 0, fired = false;
  const wrap = fn => fn && function (input, ctx) { calls++; if (!fired && calls === n) { fired = true; ctx.recordCost({ model: 'claude-haiku-5-5', usd: 0.01, source: 'model-journal' }); throw new QuotaStop('usage limit'); } return fn.call(arm, input, ctx); };
  return { ...arm, tick: wrap(arm.tick), sweep: wrap(arm.sweep) };
}
