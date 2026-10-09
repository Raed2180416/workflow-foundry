// Stage contracts, stage oracles and cross-stage relations for W-bed R2 (W-BED §2.1 `stages`, §2.2 items 2-3).
//
// Stage oracles are analyst-side diagnostics, never success criteria. Each scores only the facts its stage owns:
//   split  one record per document (number, From line, subject, date)
//   route  the route of every document, 'review' included (the judged branch)
//   read   per routed document, the facts its own text states for its kind (party, amount, references as written,
//          cited date and amount, reason code)
//   post   local only: the output echoes the routing it was given, the review queue is the documents routed review,
//          every entry and hold comes from a document routed to a kind that produces it, in the right number
// What no single stage owns are the joins between a document's facts and the ledgers (FRONTIER-GAPS §1 item 2):
//   Y1 facts reach the books unchanged (bills, statements, bank holds)
//   Y2 a credit lands on the supplier bill its reference resolves to, with a negative amount
//   Y3 a remittance is allocated by the stated rule and conserves its amount
//   Y4 a dispute hold lands on the invoice its reference resolves to, with the read reason
// The composed oracle is (every stage oracle) AND (every relation); the tests check it agrees with the end-to-end
// oracle on the reference trace and on every control's trace.
import { contract, int, str, arr, obj } from '../lib/contracts.mjs';
import { canonical } from '../lib/prng.mjs';
import { refKey } from '../lib/domain.mjs';
import { outputSchema, entryKey, holdKey, multisetDiff } from './score.mjs';
import { HANDLED, ACTION_KIND } from './vocab.mjs';
import { resolveBill, resolveInvoice, allocate, partyCurrency } from './world.mjs';

export const CONTRACTS = {
  input: contract('wbed-r2/input', obj({ inbox: str(1e6), parties: str(1e5), payables: str(1e5), receivables: str(1e5), notes: str(1e5), spec: str(1e5) })),
  split: contract('wbed-r2/split', obj({ docs: arr(obj({ doc: int, from: str(200), subject: str(200), date: str(10) }), 200) })),
  route: contract('wbed-r2/route', obj({ routing: arr(obj({ doc: int, kind: str(20) }), 200) })),
  read: contract('wbed-r2/read', obj({ facts: arr(obj({ doc: int, kind: str(20), party: str(20), currency: str(3), amount_minor: int,
    refs: arr(str(60), 10), ref_date: str(10), ref_amount_minor: int, reason: str(20) }), 200) })),
  post: contract('wbed-r2/post', outputSchema),
};

const eqCanon = (a, b) => canonical(a) === canonical(b);
function diffList(want, got, key) {
  const g = new Map((Array.isArray(got) ? got : []).map(x => [key(x), x]));
  const out = [];
  for (const w of want) {
    const x = g.get(key(w));
    if (!x) out.push({ key: key(w), missing: true });
    else if (!eqCanon(w, x)) out.push({ key: key(w), expected: w, got: x });
    if (out.length >= 8) break;
  }
  return { mismatches: out, extra: (Array.isArray(got) ? got.length : 0) - want.length };
}
function sectionResult(errors, sections) {
  if (errors.length) return { pass: false, details: { reason: 'contract', errors: errors.slice(0, 8) } };
  const bad = Object.entries(sections).filter(([, d]) => d.mismatches.length || d.extra !== 0);
  return { pass: bad.length === 0, details: Object.fromEntries(Object.entries(sections).map(([k, d]) => [k, { mismatches: d.mismatches.length, extra: d.extra, first: d.mismatches[0] ?? null }])) };
}
const normFact = f => (f && typeof f === 'object' ? { ...f, refs: Array.isArray(f.refs) ? f.refs.map(refKey) : f.refs } : f);

/** Local post checks: the output against the routing hand-off it was given (no ledger, no document facts). */
export function postLocal(rt, out) {
  const errors = CONTRACTS.post.check(out);
  if (errors.length) return { pass: false, details: { reason: 'contract', errors: errors.slice(0, 8) } };
  const problems = [];
  const routeOf = new Map(rt.routing.map(x => [x.doc, x.kind]));
  if (out.routing.length !== routeOf.size || out.routing.some(x => routeOf.get(x.doc) !== x.kind)) problems.push('routing-echo');
  const rq = new Set(out.review_queue);
  const wantRq = [...routeOf].filter(([, k]) => k === 'review').map(([d]) => d);
  if (rq.size !== out.review_queue.length || rq.size !== wantRq.length || wantRq.some(d => !rq.has(d))) problems.push('review-queue');
  const nEntries = new Map(), nHolds = new Map();
  for (const e of out.entries) {
    nEntries.set(e.doc, (nEntries.get(e.doc) ?? 0) + 1);
    if (ACTION_KIND[e.action] !== routeOf.get(e.doc)) { problems.push(`entry-kind-${e.doc}`); break; }
    if (['post_bill', 'allocate', 'unapplied'].includes(e.action) && e.amount_minor <= 0) { problems.push(`entry-amount-${e.doc}`); break; }
    if (e.action === 'send_statement' && e.amount_minor !== 0) { problems.push(`statement-amount-${e.doc}`); break; }
  }
  for (const h of out.holds) {
    nHolds.set(h.doc, (nHolds.get(h.doc) ?? 0) + 1);
    const k = routeOf.get(h.doc);
    if (!(k === 'dispute' && h.reason !== 'VERIFY_BANK') && !(k === 'bank_change' && h.reason === 'VERIFY_BANK')) { problems.push(`hold-kind-${h.doc}`); break; }
  }
  for (const [doc, k] of routeOf) {
    const e = nEntries.get(doc) ?? 0, h = nHolds.get(doc) ?? 0;
    const ok = ['invoice', 'credit_note', 'statement_request'].includes(k) ? e === 1 && h === 0
      : k === 'remittance' ? e >= 1 && h === 0
        : ['dispute', 'bank_change'].includes(k) ? e === 0 && h === 1
          : e === 0 && h === 0;
    if (!ok) { problems.push(`count-${doc}`); break; }
  }
  return { pass: problems.length === 0, details: { problems } };
}

// ---- cross-stage relations: each recomputes, from the read hand-off and the ledgers, what the books must show.
function expectedFor(world, f) {
  switch (f.kind) {
    case 'invoice': return { entries: [{ doc: f.doc, action: 'post_bill', party: f.party, ref: f.refs[0] ?? '', currency: f.currency, amount_minor: f.amount_minor }], holds: [] };
    case 'statement_request': return { entries: [{ doc: f.doc, action: 'send_statement', party: f.party, ref: '', currency: partyCurrency(world, f.party), amount_minor: 0 }], holds: [] };
    case 'bank_change': return { entries: [], holds: [{ doc: f.doc, ref: f.party, reason: 'VERIFY_BANK' }] };
    case 'credit_note': { const b = resolveBill(world, f); return { entries: [{ doc: f.doc, action: 'post_credit', party: f.party, ref: b ? b.billId : '\u0000unresolved', currency: f.currency, amount_minor: -f.amount_minor }], holds: [] }; }
    case 'remittance': return { entries: allocate(world, f), holds: [] };
    case 'dispute': { const i = resolveInvoice(world, f.refs[0], f.party); return { entries: [], holds: [{ doc: f.doc, ref: i ? i.no : '\u0000unresolved', reason: f.reason }] }; }
    default: return { entries: [], holds: [] };
  }
}
function relationOver(kinds) {
  return (trace, world) => {
    const facts = trace.read.facts.filter(f => kinds.includes(f.kind));
    const docs = new Set(facts.map(f => f.doc));
    const want = { entries: [], holds: [] };
    for (const f of facts) { const e = expectedFor(world, f); want.entries.push(...e.entries); want.holds.push(...e.holds); }
    const out = trace.post;
    const de = multisetDiff(want.entries.map(entryKey), out.entries.filter(e => docs.has(e.doc)).map(entryKey));
    const dh = multisetDiff(want.holds.map(holdKey), out.holds.filter(h => docs.has(h.doc)).map(holdKey));
    return { pass: !de.missing && !de.extra && !dh.missing && !dh.extra, details: { docs: docs.size, entries: de, holds: dh } };
  };
}
export const RELATIONS = [
  { id: 'Y1-facts-reach-books', stages: ['read', 'post'], text: 'every bill, statement request and bank change is booked with exactly the facts read from its document', check: relationOver(['invoice', 'statement_request', 'bank_change']) },
  { id: 'Y2-credit-resolution', stages: ['read', 'post'], text: 'a credit is posted, negative, on the supplier bill its reference resolves to (exact, one-character typo, or date and amount)', check: relationOver(['credit_note']) },
  { id: 'Y3-allocation', stages: ['read', 'post'], text: 'a remittance is allocated named-first, capped by open amounts, then oldest-first over the payer\'s invoices, remainder unapplied; allocations sum to the amount received', check: relationOver(['remittance']) },
  { id: 'Y4-hold-target', stages: ['read', 'post'], text: 'a dispute hold lands on the customer invoice its reference resolves to, with the reason read from the document', check: relationOver(['dispute']) },
];

/** Stage definitions. `truthOf(task)` gives the exact solver's trace; `inputOf(task)` the task inputs. */
export function makeStages(truthOf, inputOf) {
  return [
    { id: 'split', inputSchema: CONTRACTS.input.schema, outputSchema: CONTRACTS.split.schema,
      project: task => ({ task, input: inputOf(task) }),
      oracle: (st, out) => sectionResult(CONTRACTS.split.check(out), { docs: diffList(truthOf(st.task).split.docs, out?.docs, x => x?.doc) }) },
    { id: 'route', inputSchema: CONTRACTS.split.schema, outputSchema: CONTRACTS.route.schema,
      project: task => ({ task, input: { ...truthOf(task).split, notes: inputOf(task).notes } }),
      oracle: (st, out) => sectionResult(CONTRACTS.route.check(out), { routing: diffList(truthOf(st.task).route.routing, out?.routing, x => x?.doc) }) },
    { id: 'read', inputSchema: CONTRACTS.route.schema, outputSchema: CONTRACTS.read.schema,
      project: task => ({ task, input: truthOf(task).route }),
      oracle: (st, out) => sectionResult(CONTRACTS.read.check(out), { facts: diffList(truthOf(st.task).read.facts.map(normFact), (out?.facts ?? []).map(normFact), x => x?.doc) }) },
    { id: 'post', inputSchema: CONTRACTS.read.schema, outputSchema: CONTRACTS.post.schema,
      project: task => { const t = truthOf(task); return { task, input: { route: t.route, read: t.read } }; },
      oracle: (st, out) => postLocal(st.input.route, out) },
  ];
}

/** Stage oracles on a trace's own stage outputs, plus every relation. */
export function composeOracle(stages, task, trace, world) {
  const per = {};
  for (const s of stages) per[s.id] = s.oracle(s.project(task), trace[s.id]);
  per.post = postLocal(trace.route, trace.post); // judged against the routing the trace actually produced
  const rel = {};
  for (const x of RELATIONS) {
    try { rel[x.id] = x.check(trace, world); } catch (e) { rel[x.id] = { pass: false, details: { error: String(e.message ?? e) } }; }
  }
  const pass = Object.values(per).every(r => r.pass) && Object.values(rel).every(r => r.pass);
  return { pass, stages: per, relations: rel };
}

export { HANDLED };
