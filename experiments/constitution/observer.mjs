// The OT-0 observer (research/org-20261021/PREDICTION.md §2). It maps one run's host journal (and the constitution
// registry's journal) to an OCEL-2.0-shaped object-centric log, then evaluates clauses C1-C3 over that log alone.
//   objects: order, fulfilment, payment, principal, constitution-version (and workflow-version for the auditor)
//   events : order-placed, action-entered, charge-committed, refund-committed, status-set, approval-requested,
//            approval-decided, approval-failed, port-intervention, run-pinned, constitution-proposed/-approval/-gate
// It reads no truth label (not the journal's subjectCase or task case, not world.truth): only what the platform
// journaled, the registry, and the public reference data every arm also has (catalog prices and rulebook fees, for
// "wrong amount"). The analyst-side comparison with the E8 oracle (c1VsOracle) maps orders to truth cases afterwards.
// Independent of the oracle's code: it parses the journal itself and uses no transition or grader function.
import { holds, thresholdOf, boundProblems, docProblems } from './constitution.mjs';
import { verifyRegistryChain, DAY7 } from './registry.mjs';
import { APPROVAL_KIND } from './overlay.mjs';

const norm = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').toUpperCase() : null);
const ms = s => (typeof s === 'number' ? s : Date.parse(s));
const isoOf = x => new Date(x).toISOString();
export const OCEL_OBJECT_TYPES = Object.freeze(['order', 'fulfilment', 'payment', 'principal', 'constitution-version', 'workflow-version']);

/** Parse a host journal (content rows) into the facts the observer needs. */
export function parseJournal(rows) {
  let now = null;
  const J = { start: null, end: null, deliveries: [], calls: [], emits: new Map(), ledger: [], tasks: new Map(), writes: [] };
  for (const r of rows) {
    switch (r.type) {
      case 'run.start': J.start = r; now = ms(r.t0); break;
      case 'run.end': J.end = r; break;
      case 'wakeup': now = ms(r.at); break;
      case 'deliver': if (r.instance) J.deliveries.push({ at: now, event: r.event, instance: r.instance, round: r.round ?? 1 }); break;
      case 'call': if (r.kind === 'case') J.calls.push({ at: now, instance: r.target, round: r.round, outcome: r.outcome, output: r.output ?? null }); break;
      case 'effect.emit': J.emits.set(r.emission, { effect: r.effect, instance: r.origin?.instance ?? null, at: now }); break;
      case 'ledger': {
        const em = J.emits.get(r.emission) ?? null;
        let args = em?.effect?.args ?? {};
        if (r.batchIndex !== undefined && r.batchIndex !== null && Array.isArray(args.items)) { const { items, ...rest } = args; args = { ...rest, ...(items[r.batchIndex] ?? {}) }; }
        J.ledger.push({ at: ms(r.at), system: r.system, op: r.op, key: r.key ?? null, committed: !!r.committed, status: r.status, error: r.error ?? null, args, emittedAt: em?.at ?? ms(r.at), instance: em?.instance ?? null });
        break;
      }
      case 'humanTask.created': J.tasks.set(`${r.instance}\u0000${r.task.id}`, { at: now, instance: r.instance, task: r.task }); break;
      case 'world.write': J.writes.push({ at: now, system: r.system, table: r.table, row: r.row, source: r.source }); break;
      default: break;
    }
  }
  return J;
}

/** Fulfilment amounts from public reference data: catalog prices and the fee of the edition in force at placement (R1.3). */
function expectedAmounts(alloc, placedAt, ref) {
  if (!alloc || !ref) return {};
  const day = new Date(ms(placedAt) + 3_600_000).toISOString().slice(0, 10);      // E8 local date (+01:00)
  const ed = [...ref.editions].filter(e => e.effectiveFrom <= day).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)).at(-1);
  const fees = ed ? JSON.parse(ed.files['shipping-fees.json']) : [];
  const price = sku => ref.catalog.find(c => c.sku === sku)?.unitPriceMinor ?? 0;
  const out = {};
  for (const f of alloc.fulfilments ?? []) if (f.available !== false && f.location) out[f.fulfilmentId] = f.items.reduce((s, i) => s + i.qty * price(i.sku), 0) + (fees.find(x => x.location === f.location)?.feeMinor ?? 0);
  return out;
}

/**
 * toOcel({ rows, registry, ref }) → an OCEL-2.0-shaped log { objectTypes, eventTypes, objects, events } (JSON form of the
 * OCEL 2.0 standard: objects with attributes and object-to-object relationships, events with attributes and qualified
 * event-to-object relationships). `ref` = { catalog, editions } (public reference data) or null (no wrong-amount check).
 */
export function toOcel({ rows, registry = null, ref = null }) {
  const J = parseJournal(rows);
  const objects = new Map(), events = [];
  const obj = (type, id, attrs = {}) => {
    const k = `${type}:${id}`;
    if (!objects.has(k)) objects.set(k, { id: k, type, attributes: [], relationships: [] });
    const o = objects.get(k);
    for (const [name, value] of Object.entries(attrs)) if (value !== undefined && !o.attributes.some(a => a.name === name && JSON.stringify(a.value) === JSON.stringify(value))) o.attributes.push({ name, time: J.start ? J.start.t0 : null, value });
    return k;
  };
  const rel = (from, to, qualifier) => { const o = objects.get(from); if (!o.relationships.some(r => r.objectId === to && r.qualifier === qualifier)) o.relationships.push({ objectId: to, qualifier }); };
  const ev = (type, at, attrs, rels) => events.push({ id: `e${events.length + 1}`, type, time: isoOf(at), attributes: Object.entries(attrs).filter(([, v]) => v !== undefined).map(([name, value]) => ({ name, value })), relationships: rels.filter(r => r.objectId) });
  // Allocations (initial records) for expected amounts; migrated records for go-live orders.
  const allocs = new Map(J.writes.filter(w => w.system === 'inventory' && w.table === 'allocations').map(w => [norm(w.row.orderId), w.row]));
  const placed = new Map();
  // A task subject names a fulfilment (`<order>-F<n>`, or a known fulfilment object) or an order.
  const subjectObject = subj => (objects.has(`fulfilment:${subj}`) || /-F\d+$/.test(String(subj ?? '')) ? obj('fulfilment', subj) : obj('order', norm(subj)));
  const placeOrder = (O, placedAt, customerId, at, how) => {
    if (!O || placed.has(O)) return;
    placed.set(O, ms(placedAt));
    const o = obj('order', O, { placedAt, customerId });
    const amounts = expectedAmounts(allocs.get(O), placedAt, ref);
    for (const fa of allocs.get(O)?.fulfilments ?? []) { const f = obj('fulfilment', fa.fulfilmentId, { orderId: O, location: fa.location ?? null, expectedAmountMinor: amounts[fa.fulfilmentId] }); rel(f, o, 'part-of'); }
    ev(how, at, { placedAt }, [{ objectId: o, qualifier: 'order' }]);
  };
  for (const w of J.writes.filter(x => x.system === 'billing' && x.table === 'charges' && String(x.source).startsWith('backlog'))) {
    const F = w.row.fulfilmentId, O = norm(w.row.orderId);
    const p = obj('payment', `migrated:${w.row.chargeId}`, { kind: 'charge', amountMinor: w.row.amountMinor, fulfilmentId: F, migrated: true });
    const f = obj('fulfilment', F, { orderId: O }); rel(p, f, 'pays');
    ev('charge-committed', J.start ? ms(J.start.t0) : 0, { amountMinor: w.row.amountMinor, migrated: true, key: null }, [{ objectId: p, qualifier: 'payment' }, { objectId: f, qualifier: 'fulfilment' }, { objectId: obj('order', O), qualifier: 'order' }]);
  }
  for (const d of J.deliveries) {
    const e = d.event, p = e.payload ?? {};
    if (e.type === 'order.placed') placeOrder(norm(p.orderId), p.placedAt, p.customerId, d.at, 'order-placed');
    else if (e.type === 'migration') {
      for (const r of p.records?.['orders.orders'] ?? []) placeOrder(norm(r.orderId), r.placedAt, r.customerId, d.at, 'order-migrated');
      for (const x of p.events ?? []) if (x.type === 'order.placed') placeOrder(norm(x.payload?.orderId), x.payload?.placedAt, x.payload?.customerId, d.at, 'order-migrated');
    } else if (e.type === 'customer.action' && d.round === 1) {
      const O = norm(p.orderRef);
      const who = p.enteredBy ?? null;
      if (!events.some(x => x.type === 'action-entered' && x.attributes.some(a => a.name === 'eventId' && a.value === e.id))) {
        ev('action-entered', d.at, { action: p.action, eventId: e.id, enteredBy: who }, [{ objectId: obj('order', O), qualifier: 'about' }, ...(who ? [{ objectId: obj('principal', who), qualifier: 'entered-by' }] : [])]);
      }
    } else if (e.type.startsWith('humanTask.')) {
      const t = J.tasks.get(`${d.instance}\u0000${p.taskId}`);
      if (!t || t.task.kind !== APPROVAL_KIND) continue;
      const target = subjectObject(t.task.subject);
      if (e.type === 'humanTask.answered') ev('approval-decided', d.at, { taskId: p.taskId, decision: p.answer?.decision ?? null, user: p.user ?? null, late: !!p.late, role: t.task.role, breakGlass: /BREAK-GLASS/.test(t.task.question ?? '') },
        [{ objectId: target, qualifier: 'subject' }, ...(p.user ? [{ objectId: obj('principal', p.user), qualifier: 'approver' }] : [])]);
      else if (['humanTask.timeout', 'humanTask.withdrawn', 'humanTask.answerRejected'].includes(e.type)) ev('approval-failed', d.at, { taskId: p.taskId, how: e.type }, [{ objectId: target, qualifier: 'subject' }]);
    }
  }
  for (const t of J.tasks.values()) {
    if (t.task.kind !== APPROVAL_KIND) continue;
    const subj = t.task.subject;
    const target = subjectObject(subj);
    ev('approval-requested', t.at, { taskId: t.task.id, role: t.task.role, excludeUsers: t.task.excludeUsers ?? [], subject: subj, question: t.task.question, breakGlass: /BREAK-GLASS/.test(t.task.question ?? '') },
      [{ objectId: target, qualifier: 'subject' }]);
  }
  for (const r of J.ledger) {
    if (!r.committed) continue;
    const a = r.args ?? {};
    const O = norm(a.orderId), F = a.fulfilmentId ?? null;
    if (r.system === 'billing' && (r.op === 'charge' || r.op === 'refund')) {
      const amount = a.amountMinor ?? a.amount ?? null;
      const p = obj('payment', r.key ?? `${r.op}:${r.at}:${F}`, { kind: r.op, amountMinor: amount, fulfilmentId: F, key: r.key });
      const f = obj('fulfilment', F, { orderId: O }); rel(p, f, 'pays');
      ev(`${r.op}-committed`, r.at, { key: r.key, amountMinor: amount, emittedAt: r.emittedAt, instance: r.instance }, [{ objectId: p, qualifier: 'payment' }, { objectId: f, qualifier: 'fulfilment' }, { objectId: obj('order', O), qualifier: 'order' }]);
    } else if (r.system === 'orders' && r.op === 'setStatus') {
      const target = F ? obj('fulfilment', F, { orderId: O }) : obj('order', O);
      ev('status-set', r.at, { status: a.status, scope: F ? 'fulfilment' : 'order' }, [{ objectId: target, qualifier: 'target' }, { objectId: obj('order', O), qualifier: 'order' }]);
    }
  }
  // Port evidence in the decisions of case-ticks (pins, interventions, workflow version).
  const pinSeen = new Set();
  const wf = new Map();
  for (const c of J.calls) {
    const k = c.output?.decisions?.constitution;
    if (!k || c.outcome !== 'ok') continue;
    if (k.workflow) { const w = wf.get(k.workflow) ?? { first: c.at, last: c.at, ticks: 0 }; w.last = c.at; w.ticks += 1; wf.set(k.workflow, w); }
    for (const [O, h] of Object.entries(k.pins ?? {})) {
      if (pinSeen.has(`${O}|${h}`)) continue;
      pinSeen.add(`${O}|${h}`);
      ev('run-pinned', c.at, { hash: h, port: k.port }, [{ objectId: obj('order', norm(O)), qualifier: 'run' }, { objectId: obj('constitution-version', h), qualifier: 'pinned' }]);
    }
    for (const x of [...(k.interventions ?? []).map(y => ({ ...y, kind: 'intervention' })), ...(k.releases ?? []).map(y => ({ ...y, kind: 'release', action: 'release' }))]) {
      const rels = [];
      if (x.orderId) rels.push({ objectId: obj('order', norm(x.orderId)), qualifier: 'order' });
      if (x.fulfilmentId) rels.push({ objectId: obj('fulfilment', x.fulfilmentId), qualifier: 'fulfilment' });
      if (x.constitution) rels.push({ objectId: obj('constitution-version', x.constitution), qualifier: 'under' });
      if (x.approvedBy) rels.push({ objectId: obj('principal', x.approvedBy), qualifier: 'approver' });
      ev('port-intervention', c.at, { action: x.action, clause: x.clause ?? null, hold: x.hold ?? null, key: x.key ?? null, keys: x.keys ?? null, threshold: x.threshold ?? null,
        constitution: x.constitution ?? null, task: x.task ?? x.approvalTask ?? null, excludeUsers: x.excludeUsers ?? null, port: k.port, instance: c.instance }, rels);
    }
  }
  for (const [h, w] of wf) obj('workflow-version', h, { firstTick: isoOf(w.first), lastTick: isoOf(w.last), ticks: w.ticks });
  // The constitution registry.
  if (registry) {
    for (const r of registry.journal()) {
      const c = obj('constitution-version', r.versionHash, { version: r.version });
      if (r.type === 'proposed') {
        obj('constitution-version', r.versionHash, { effectiveFrom: r.doc.effectiveFrom, threshold: thresholdOf(r.doc) });
        ev('constitution-proposed', ms(r.at), { version: r.version, hash: r.versionHash, by: r.by }, [{ objectId: c, qualifier: 'version' }, { objectId: obj('principal', r.by), qualifier: 'proposer' }]);
      } else if (r.type === 'approval') ev('constitution-approval', ms(r.at), { version: r.version, hash: r.versionHash, by: r.by }, [{ objectId: c, qualifier: 'version' }, { objectId: obj('principal', r.by), qualifier: 'approver' }]);
      else if (r.type === 'gate') { obj('constitution-version', r.versionHash, { gate: r.decision }); ev('constitution-gate', ms(r.at), { version: r.version, hash: r.versionHash, decision: r.decision, reasons: r.reasons }, [{ objectId: c, qualifier: 'version' }]); }
    }
  }
  events.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  const typesOf = list => [...new Set(list.map(x => x.type))].sort().map(name => ({ name, attributes: [] }));
  return { 'ocel:version': '2.0-json (OT-0 shape)', objectTypes: OCEL_OBJECT_TYPES.map(name => ({ name, attributes: [] })), eventTypes: typesOf(events), objects: [...objects.values()], events,
    run: { arm: J.start?.arm ?? null, world: J.start?.world ?? null, spec: J.start?.spec ?? null, journalRows: rows.length, ended: !!J.end } };
}

const attr = (e, n) => e.attributes.find(a => a.name === n)?.value;
const relOf = (e, q) => e.relationships.filter(r => r.qualifier === q).map(r => r.objectId);
const idOf = k => k.slice(k.indexOf(':') + 1);

/** Evaluate C1-C3 over an OCEL log. `registry` gives the versions (the registry's own journal is also in the log). */
export function evaluate(ocel, { registry }) {
  const objById = new Map(ocel.objects.map(o => [o.id, o]));
  const oattr = (k, n) => objById.get(k)?.attributes.find(a => a.name === n)?.value;
  const byType = t => ocel.events.filter(e => e.type === t);
  const T = t => Date.parse(t);
  // Placement and the version in force at it (the pin a run must carry).
  const orders = new Map();
  for (const o of ocel.objects.filter(x => x.type === 'order')) {
    const placedAt = oattr(o.id, 'placedAt');
    const v = placedAt ? registry.inForceAt(placedAt) : null;
    orders.set(o.id, { id: o.id, placedAt: placedAt ? T(placedAt) : null, version: v, entered: [], refunds: [], pins: new Set() });
  }
  const ord = k => { if (!orders.has(k)) orders.set(k, { id: k, placedAt: null, version: null, entered: [], refunds: [], pins: new Set() }); return orders.get(k); };
  for (const e of byType('action-entered')) ord(relOf(e, 'about')[0]).entered.push({ action: attr(e, 'action'), principal: attr(e, 'enteredBy'), at: T(e.time) });
  for (const e of byType('run-pinned')) ord(relOf(e, 'run')[0]).pins.add(attr(e, 'hash'));

  // C1: per fulfilment money ledger.
  const C1 = [];
  const fulfil = new Map();
  const fl = F => { if (!fulfil.has(F)) fulfil.set(F, { F, order: oattr(F, 'orderId') ? `order:${oattr(F, 'orderId')}` : null, charges: [], refunds: [], statuses: [] }); return fulfil.get(F); };
  for (const e of ocel.events) {
    if (e.type === 'charge-committed' || e.type === 'refund-committed') {
      const F = relOf(e, 'fulfilment')[0]; const f = fl(F); f.order ??= relOf(e, 'order')[0];
      (e.type === 'charge-committed' ? f.charges : f.refunds).push({ at: T(e.time), amount: attr(e, 'amountMinor') ?? 0, key: attr(e, 'key'), emittedAt: attr(e, 'emittedAt'), migrated: !!attr(e, 'migrated'), id: e.id });
    } else if (e.type === 'status-set' && attr(e, 'scope') === 'fulfilment') fl(relOf(e, 'target')[0]).statuses.push({ at: T(e.time), status: attr(e, 'status') });
  }
  for (const f of fulfil.values()) {
    const v = (code, extra = {}) => C1.push({ clause: 'C1', code, fulfilment: idOf(f.F), order: f.order ? idOf(f.order) : null, ...extra });
    if (f.charges.length > 1) v('double-charge', { charges: f.charges.length });
    const exp = oattr(f.F, 'expectedAmountMinor');
    for (const c of f.charges) if (!c.migrated && typeof exp === 'number' && c.amount !== exp) v('wrong-amount', { amountMinor: c.amount, expectedMinor: exp });
    const timeline = [...f.charges.map(c => ({ ...c, k: 'c' })), ...f.refunds.map(r => ({ ...r, k: 'r' }))].sort((a, b) => a.at - b.at || (a.k === 'c' ? -1 : 1));
    let net = 0, charged = 0, flagged = false;
    for (const x of timeline) {
      if (x.k === 'c') { net += x.amount; charged += x.amount; continue; }
      if (charged === 0) v('refund-without-charge', { amountMinor: x.amount });
      else if (x.amount > net && !flagged) { v('over-refund', { amountMinor: x.amount, netBefore: net }); flagged = true; }
      net -= x.amount;
    }
    const last = f.statuses.sort((a, b) => a.at - b.at).at(-1)?.status ?? null;
    if (['failed', 'cancelled'].includes(last) && net !== 0 && charged > 0) v('conservation', { status: last, netMinor: net });
    if (last === 'completed' && f.refunds.length) v('refund-after-completion', { refunds: f.refunds.length });
  }

  // C2: refunds above the pinned threshold need a bound, timely, role-holding, SoD-clean approval.
  const decided = byType('approval-decided');
  const requested = byType('approval-requested');
  const refundsAll = [];
  for (const f of fulfil.values()) for (const r of f.refunds) refundsAll.push({ ...r, F: f.F, order: f.order });
  const C2 = [], exceptions = [], aboveT = [];
  for (const r of refundsAll) {
    const o = r.order ? orders.get(r.order) : null;
    const v = o?.version ?? registry.inForceAt(r.emittedAt ?? r.at);
    const Tp = thresholdOf(v.doc);
    if (!(r.amount > Tp)) continue;
    const entered = (o?.entered ?? []).filter(x => ['amend', 'cancel'].includes(x.action));
    const sod = new Set(entered.map(x => x.principal).filter(Boolean));
    const refundsOfOrder = refundsAll.filter(x => x.order === r.order && x.amount > Tp);
    const cands = decided.filter(e => attr(e, 'decision') === 'approve' && (relOf(e, 'subject')[0] === r.F || (relOf(e, 'subject')[0] === r.order && refundsOfOrder.length === 1)));
    const timely = cands.filter(e => T(e.time) <= (r.emittedAt ?? r.at));
    const roleOk = e => holds(v.doc, attr(e, 'user'), 'finance-approver') || (attr(e, 'breakGlass') && holds(v.doc, attr(e, 'user'), 'controller'));
    const good = timely.filter(e => roleOk(e) && !sod.has(attr(e, 'user')));
    const rec = { order: r.order ? idOf(r.order) : null, fulfilment: idOf(r.F), amountMinor: r.amount, thresholdMinor: Tp, version: v.version, refundAt: isoOf(r.at),
      approver: good[0] ? attr(good[0], 'user') : timely[0] ? attr(timely[0], 'user') : null, sod: [...sod], placedAt: o?.placedAt ? isoOf(o.placedAt) : null };
    aboveT.push(rec);
    if (good.length) { if (attr(good[0], 'breakGlass')) exceptions.push({ clause: 'C2', code: 'break-glass', ...rec }); rec.ok = true; continue; }
    rec.ok = false;
    rec.code = !cands.length ? 'no-approval' : !timely.length ? 'approval-after-emit' : !timely.some(roleOk) ? 'approver-lacks-role' : 'sod-conflict';
    C2.push({ clause: 'C2', ...rec });
  }

  // C3: registry (re-checked from its journal), pins, stale and retroactive thresholds.
  const C3 = [];
  try { verifyRegistryChain(registry.journal()); } catch (e) { C3.push({ clause: 'C3', code: 'registry-chain', detail: String(e.message) }); }
  for (const ver of registry.versions.filter(x => x.decision === 'accepted')) {
    const gov = registry.inForceAt(ver.decidedAt);
    const rule = (gov && gov.hash !== ver.hash) ? gov.doc : ver.doc;
    const ap = ver.approvals.at(-1);
    const bad = [...docProblems(ver.doc), ...(gov && gov.hash !== ver.hash ? boundProblems(ver.doc, gov.doc) : [])];
    if (!holds(rule, ap.by, rule.change.approverRole)) bad.push('approver lacks the approver role');
    if (!rule.change.proposerMayApprove && ap.by === ver.proposedBy) bad.push('self-approved');
    if (Date.parse(ap.at) > Date.parse(ver.doc.effectiveFrom)) bad.push('approved after effectiveFrom');
    if (bad.length) C3.push({ clause: 'C3', code: 'registry-accepted-invalid', version: ver.version, reasons: bad });
  }
  const refused = new Set(registry.versions.filter(x => x.decision !== 'accepted').map(x => x.hash));
  let unpinned = 0, unpinnedGoverned = 0;
  for (const o of orders.values()) {
    if (!o.version) continue;
    const governed = refundsAll.some(r => r.order === o.id);
    if (!o.pins.size) { unpinned += 1; if (governed) unpinnedGoverned += 1; continue; }
    for (const h of o.pins) if (h !== o.version.hash) C3.push({ clause: 'C3', code: refused.has(h) ? 'unauthorised-version' : 'pin-mismatch', order: idOf(o.id), pinned: h, inForce: o.version.hash });
  }
  const [T1, T2] = [registry.byVersion(1), registry.byVersion(2)].map(x => thresholdOf(x.doc));
  const day7 = Date.parse(DAY7);
  const stale = { orders: 0, handledUnderT1: 0, cases: [] };
  for (const r of aboveT) {
    const o = orders.get(`order:${r.order}`);
    if (!o?.placedAt || o.placedAt < day7 || !(r.amountMinor > T2 && r.amountMinor <= T1)) continue;
    stale.orders += 1;
    // Handled under T1: refunded with no approval at all (an arm that asked, whatever the answer, applied T2).
    if (!r.ok && r.code === 'no-approval') { stale.handledUnderT1 += 1; stale.cases.push(r.order); C3.push({ clause: 'C3', code: 'stale', order: r.order, fulfilment: r.fulfilment, amountMinor: r.amountMinor, thresholdMinor: T2 }); }
  }
  const overEscalation = [];
  for (const e of requested) {
    const subj = relOf(e, 'subject')[0];
    const F = subj?.startsWith('fulfilment:') ? subj : null;
    const f = F ? fulfil.get(F) : null;
    const O = f?.order ?? (F ? (oattr(F, 'orderId') ? `order:${oattr(F, 'orderId')}` : null) : subj);
    const o = O ? orders.get(O) : null;
    if (!o?.version) continue;
    const amount = f?.refunds[0]?.amount ?? (F ? oattr(F, 'expectedAmountMinor') : null);
    if (typeof amount !== 'number') continue;
    const Tp = thresholdOf(o.version.doc);
    if (amount > Tp) continue;
    const Tnow = thresholdOf(registry.inForceAt(T(e.time)).doc);
    if (amount > Tnow) C3.push({ clause: 'C3', code: 'retroactive', order: idOf(O), fulfilment: F ? idOf(F) : null, amountMinor: amount, pinnedThreshold: Tp, thresholdAtRequest: Tnow });
    else overEscalation.push({ order: idOf(O), task: attr(e, 'taskId'), amountMinor: amount, thresholdMinor: Tp });
  }
  const interventions = {};
  for (const e of byType('port-intervention')) { const k = attr(e, 'action'); interventions[k] = (interventions[k] ?? 0) + 1; }
  const count = list => list.reduce((m, x) => ({ ...m, [x.code]: (m[x.code] ?? 0) + 1 }), {});
  return {
    C1: { violations: C1, byCode: count(C1) },
    C2: { violations: C2, byCode: count(C2), refundsAboveT: aboveT.length, compliant: aboveT.filter(x => x.ok).length, exceptions },
    C3: { violations: C3, byCode: count(C3), unpinnedRuns: unpinned, unpinnedGovernedRuns: unpinnedGoverned, staleWindow: stale },
    overEscalation: overEscalation.length, interventions, refundsAboveT: aboveT,
    approvals: { requested: requested.length, decided: decided.length },
  };
}

/** observe(...) = evaluate(toOcel(...)). */
export function observe({ rows, registry, ref = null }) {
  const ocel = toOcel({ rows, registry, ref });
  return { ocel, verdict: evaluate(ocel, { registry }) };
}

/** The validity comparison (analyst side): per truth case with a subject, observer C1 (any) vs oracle critical (any). */
export function c1VsOracle({ world, verdict, oracleVerdict, onlyCompleted = false }) {
  const caseOf = new Map(Object.entries(world.truth.cases).filter(([, t]) => t.subject).map(([c, t]) => [t.subject, c]));
  const c1 = new Map();
  for (const v of verdict.C1.violations) { const c = caseOf.get(v.order) ?? caseOf.get(String(v.fulfilment ?? '').replace(/-F\d+$/, '')) ?? null; if (c) c1.set(c, [...(c1.get(c) ?? []), v.code]); }
  const rows = [];
  for (const cv of oracleVerdict.cases) {
    if (!world.truth.cases[cv.case]?.subject) continue;
    if (onlyCompleted && cv.pool !== 'completed') continue;
    // A money-outside-allowed critical after the case's first divergence comes from the grader's frozen expectation
    // (grade.mjs stops computing expectations at the first divergence, so later money rows match no lid).
    const first = cv.firstDivergence?.at ? Date.parse(cv.firstDivergence.at) : null;
    const oc = cv.critical.map(x => (x.code === 'money-outside-allowed' && first !== null && Date.parse(x.at) > first ? 'money-outside-allowed:after-first-divergence' : x.code));
    const ob = c1.get(cv.case) ?? [];
    rows.push({ case: cv.case, pool: cv.pool, oracle: oc, observer: ob, firstDivergence: cv.firstDivergence ? `L${cv.firstDivergence.layer}:${cv.firstDivergence.code}` : null, agree: (oc.length > 0) === (ob.length > 0) });
  }
  const dis = rows.filter(r => !r.agree);
  const kind = r => {
    if (!r.oracle.length) return `observer-only:${[...new Set(r.observer)].join('+')}`;
    const k = new Set(r.oracle);
    if ([...k].every(c => c === 'orphan-reservation')) return 'oracle-only:stock (outside C1)';
    if ([...k].every(c => ['orphan-reservation', 'money-outside-allowed:after-first-divergence'].includes(c))) return 'oracle-only:money-outside-allowed after the first divergence (frozen expectation)';
    if ([...k].every(c => ['orphan-reservation', 'money-outside-allowed', 'money-outside-allowed:after-first-divergence'].includes(c))) return 'oracle-only:money-outside-allowed at or before the first divergence (money the rules did not allow, conserved)';
    return `oracle-only:${[...k].join('+')}`;
  };
  return { cases: rows.length, bothCritical: rows.filter(r => r.oracle.length && r.observer.length).length, bothClean: rows.filter(r => !r.oracle.length && !r.observer.length).length,
    disagreements: dis.map(r => ({ ...r, kind: kind(r) })), byKind: dis.reduce((m, r) => ({ ...m, [kind(r)]: (m[kind(r)] ?? 0) + 1 }), {}) };
}
