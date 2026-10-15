// Hand-built witness journals for k77 and k123, graded by gradeCase under the original and the mutant.
import { pathToFileURL } from 'node:url';
const R = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');   // beds/ebed
const { generateWorld, oracleItem } = await import(pathToFileURL(`${R}/e8/index.mjs`).href);
const { gradeCase } = await import(pathToFileURL(`${R}/oracle/grade.mjs`).href);
const dir = process.argv[2];
const orig = await import(pathToFileURL(`${dir}/orig.mjs`).href);
const MIN = 60_000;
const W = generateWorld({ seed: 1001, difficulty: 3, mix: 'tail' });
const allocOf = O => W.sor['inventory.allocations'].find(a => a.orderId === O).fulfilments;
const sig = v => (v.oracleError ? 'E' : v.firstDivergence ? `D:${v.firstDivergence.layer}/${v.firstDivergence.code}/${v.firstDivergence.lid ?? ''}` : v.complete ? 'PASS' : 'OPEN');
function grade(mod, c, items, horizon) {
  // items: [{ kind: 'd'|'r', at, ...}] in journal order
  const b = { deliveries: [], ledger: [], tasks: [], taskEvents: [], calls: [] };
  items.forEach((it, i) => { const seq = i + 1;
    if (it.kind === 'd') b.deliveries.push({ seq, at: it.at, event: it.event, instance: 'i-1', round: 1, route: null, case: c, truth: true });
    else b.ledger.push({ seq, at: it.at, system: it.system, op: it.op, key: it.key, args: it.args, committed: true, status: 'ok', error: null, case: c, money: it.system === 'billing', callAt: it.callAt ?? it.at, knows: new Set(), given: new Set(it.given ?? []) }); });
  const idx = { world: W, horizonMs: horizon, ledger: b.ledger, writes: [], bucket: x => (x === c ? b : { deliveries: [], ledger: [], tasks: [], taskEvents: [], calls: [] }) };
  return sig(gradeCase({ item: { ...oracleItem, referenceTransition: mod.referenceTransition, recordsOf: mod.recordsOf }, world: W, idx, c }));
}
const lidArgs = (E, l) => E.effects.required.find(e => e.lid === l)?.args;
const view = (c, t, at, events, rows) => ({ case: c, at, seq: Infinity, world: W, truth: t, rows, tasks: [], taskEvents: [], events });
// k77: a second placement of the same order with other items arrives before the arm records the order (R1.4: no effect).
{
  const [c, t] = Object.entries(W.truth.cases).find(([, x]) => x.class === 'straight' && allocOf(x.subject).length === 1);
  const O = t.subject, P = Date.parse(t.placedAt);
  const placedAs = its => ({ orderId: O, customerId: t.customerId, placedAt: t.placedAt, currency: 'EUR', items: its, channel: 'web' });
  const items = allocOf(O)[0].items.map(i => ({ sku: i.sku, qty: i.qty }));
  const e1 = { id: 'e1', type: 'order.placed', source: 'shop', payload: placedAs(items) }, e2 = { id: 'e2', type: 'order.placed', source: 'shop', payload: placedAs([{ sku: items[0].sku, qty: items[0].qty + 1 }]) };
  const E = orig.referenceTransition(W, view(c, t, P + MIN, [{ ...e1, at: P, seq: 1 }], []));
  const journal = [{ kind: 'd', at: P, event: e1 }, { kind: 'd', at: P + 10 * MIN, event: e2 }, { kind: 'r', at: P + 20 * MIN, system: 'orders', op: 'create', key: 'c1', args: lidArgs(E, `create:${O}`) }];
  console.log('k77 witness (duplicate placement with other items before the create):', grade(orig, c, journal, P + 21 * MIN), 'vs', grade(await import(pathToFileURL(`${dir}/m77.mjs`).href), c, journal, P + 21 * MIN));
}
// k123: an amend and a cancel exactly at D (S11): the cancel counts (R6.2); a cancel-refused for it is not allowed.
{
  const [c, t] = Object.entries(W.truth.cases).find(([, x]) => x.class === 'amend' && allocOf(x.subject).some(f => f.available) && allocOf(x.subject).some(f => !f.available));
  const O = t.subject, P = Date.parse(t.placedAt), D = P + 4 * 60 * MIN;
  const email = W.master.customers.find(x => x.customerId === t.customerId).email;
  const ePl = { id: 'p', type: 'order.placed', source: 'shop', payload: { orderId: O } };
  const am = { id: 'a1', type: 'customer.action', source: 'customer-portal', payload: { orderRef: O, action: 'amend' } };
  const ca = { id: 'a2', type: 'customer.action', source: 'customer-portal', payload: { orderRef: O, action: 'cancel' } };
  const E0 = orig.referenceTransition(W, view(c, t, P + MIN, [{ ...ePl, at: P, seq: 1 }], []));
  const r = (at, l, E, key) => ({ kind: 'r', at, system: E.effects.required.find(e => e.lid === l).system, op: E.effects.required.find(e => e.lid === l).op, key: key ?? l, args: lidArgs(E, l) });
  const hist = [{ kind: 'd', at: P, event: ePl }, r(P + MIN, `create:${O}`, E0), r(P + 2 * MIN, `ost:${O}:customerActionRequired`, E0), r(P + 2 * MIN, `ntf:${O}:action-required`, E0)];
  const toRows = list => list.map((x, i) => (x.kind === 'd' ? { ...x.event, at: x.at, seq: i + 1 } : { seq: i + 1, at: x.at, system: x.system, op: x.op, args: x.args, committed: true, callAt: x.at, knows: new Set(), given: new Set() }));
  const evs = [...hist, { kind: 'd', at: D, event: am }, { kind: 'd', at: D, event: ca }];
  const vD = view(c, t, D + MIN, toRows(evs).filter(x => x.type), toRows(evs).filter(x => !x.type));
  const E1 = orig.referenceTransition(W, vD);
  const after = E1.effects.required.filter(e => !['create:', 'ost:' + O + ':customerActionRequired', 'ntf:' + O + ':action-required'].some(p => e.lid.startsWith(p)) && !e.lid.includes('customerAction') && !e.lid.includes('action-required') && !e.lid.startsWith('create:'));
  const journal = [...evs, ...after.map(e => r(D, e.lid, E1)), { kind: 'r', at: D, system: 'notify', op: 'send', key: 'cr', args: { to: email, about: O, template: 'cancel-refused', text: 'x', ref: null } }];
  console.log('k123 required at D:', after.map(e => e.lid).join(' '));
  console.log('k123 witness (amend and cancel at D, plus a cancel-refused):', grade(orig, c, journal, D + 2 * MIN), 'vs', grade(await import(pathToFileURL(`${dir}/m123.mjs`).href), c, journal, D + 2 * MIN));
}
