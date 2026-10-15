// k241 (dispatched anchored at the later of the collection/delivery reports): W2 order, an arm that sets neither status
// by the delivery's 120 min. Original: dispatched missed first; mutant: dispatched moved past the late report, so the
// first divergence is completed missed. Also k17 check: a booking exactly the cut-off before a run.
import { pathToFileURL } from 'node:url';
const R0 = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');   // beds/ebed
const { generateWorld, oracleItem } = await import(pathToFileURL(`${R0}/e8/index.mjs`).href);
const { gradeCase } = await import(pathToFileURL(`${R0}/oracle/grade.mjs`).href);
const dir = process.argv[2];
const orig = await import(pathToFileURL(`${dir}/orig.mjs`).href);
const MIN = 60_000;
const W = generateWorld({ seed: 1001, difficulty: 3, mix: 'tail' });
const allocOf = O => W.sor['inventory.allocations'].find(a => a.orderId === O).fulfilments;
const [c, t] = Object.entries(W.truth.cases).find(([, x]) => x.class === 'straight' && allocOf(x.subject).length === 1);
const O = t.subject, P = Date.parse(t.placedAt), FUL = allocOf(O)[0], F = FUL.fulfilmentId;
const loc = W.master.locations.find(l => l.location === FUL.location);
const codes = JSON.parse(W.rulebook.editions[0].files['carrier-codes.json']);
const code = m => codes.find(x => x.carrier === loc.carrier && x.meaning === m).code;
const sig = v => (v.oracleError ? 'E' : v.firstDivergence ? `D:${v.firstDivergence.layer}/${v.firstDivergence.code}/${v.firstDivergence.lid ?? ''}` : v.complete ? 'PASS' : 'OPEN');
// Build a conforming history by asking the original transition step by step (rows at each lid's earliest).
const placed = { id: 'p', type: 'order.placed', source: 'shop', payload: { orderId: O } };
let items = [{ kind: 'd', at: P, ev: placed }];
const view = at => { const evs = [], rows = []; items.forEach((x, i) => { if (x.at >= at) return; if (x.kind === 'd') evs.push({ ...x.ev, at: x.at, seq: i + 1 }); else rows.push({ ...x.row, seq: i + 1 }); }); return { case: c, at, seq: Infinity, world: W, truth: t, rows, tasks: [], taskEvents: [], events: evs }; };
const done = new Set();
const step = until => { for (let guard = 0; guard < 20; guard++) { const E = orig.referenceTransition(W, view(until));
  const todo = E.effects.required.filter(e => !done.has(e.lid) && e.window.earliest < until && !/^(fst:.*:(dispatched|completed)|ost:.*:completed)$/.test(e.lid));
  if (!todo.length) return; for (const e of todo) { done.add(e.lid); const at = Math.max(e.window.earliest, ...items.map(x => x.at)); items.push({ kind: 'r', at, row: { at, system: e.system, op: e.op, key: e.lid, args: e.args, committed: true, status: 'ok', error: null, callAt: at, knows: new Set(), given: new Set() } }); } } };
step(P + 300 * MIN);
const ship = items.find(x => x.kind === 'r' && x.row.op === 'create' && x.row.system === 'carrier');
const Rr = orig.collectionAt(W, FUL.location, ship.at, 30);
const T2 = Rr + 1200 * MIN;
items.push({ kind: 'd', at: T2, ev: { id: 'dl', type: 'carrier.status', source: 'carrier', payload: { carrier: loc.carrier, code: code('delivered'), fulfilmentRef: F, reportedAt: new Date(T2).toISOString() } } });
items.push({ kind: 'd', at: T2 + 90 * MIN, ev: { id: 'col', type: 'carrier.status', source: 'carrier', payload: { carrier: loc.carrier, code: code('collected'), fulfilmentRef: F, reportedAt: new Date(Rr).toISOString() } } });
items.sort((a, b) => a.at - b.at);
const grade = (mod, H) => {
  const b = { deliveries: [], ledger: [], tasks: [], taskEvents: [], calls: [] }, writes = [];
  items.forEach((x, i) => { const seq = i + 1; if (x.kind === 'd') b.deliveries.push({ seq, at: x.at, event: x.ev, instance: 'i-1', round: 1, route: null, case: c, truth: true }); else b.ledger.push({ ...x.row, seq, case: c, money: x.row.system === 'billing' }); });
  const idx = { world: W, horizonMs: H, ledger: b.ledger, writes, bucket: x => (x === c ? b : { deliveries: [], ledger: [], tasks: [], taskEvents: [], calls: [] }) };
  return sig(gradeCase({ item: { ...oracleItem, referenceTransition: mod.referenceTransition, recordsOf: mod.recordsOf }, world: W, idx, c }));
};
const m241 = await import(pathToFileURL(`${dir}/m241.mjs`).href);
console.log('k241 W2 witness, no status set by T2+120:', grade(orig, T2 + 200 * MIN), 'vs', grade(m241, T2 + 200 * MIN));
