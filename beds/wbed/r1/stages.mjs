// Stage contracts, stage oracles and cross-stage relations for W-bed R1 (W-BED §2.1 `stages`, §2.2 items 2-3).
//
// Stage oracles are analyst-side diagnostics for fault localisation, never success criteria: a correct workflow need
// not have these stages. Each stage oracle scores only the facts its stage owns:
//   extract    one record per input line, surface text kept (the parse of each file on its own)
//   normalise  per document: ISO date, US cents, and whether the document's own fields let it count
//   reconcile  the customer partition (identity resolution over the customer export)
//   report     arithmetic and shape: one entry per reconciled customer, open = invoiced - paid, totals = sums
// What no single stage owns are the relations between inputs (FRONTIER-GAPS §1 item 2): invoice -> customer row ->
// customer, payment -> invoice, PAY <-> REMIT by bank reference. Those are the cross-stage relations X1-X3. The
// composed oracle is (every stage oracle) AND (every relation); on any trace it agrees with the end-to-end oracle,
// which the tests check on the reference and on every bad control.
import { contract, int, str, bool, arr, obj } from '../lib/contracts.mjs';
import { canonical } from '../lib/prng.mjs';
import { refKey } from '../lib/domain.mjs';
import { outputSchema } from './score.mjs';

// ---- typed hand-offs
export const CONTRACTS = {
  input: contract('wbed-r1/input', obj({
    customer_export: str(1e6), customer_notes: str(1e5), customer_spec: str(1e5),
    invoices: { type: 'object' }, payments: str(1e6), ledger_notes: str(1e5), ledger_spec: str(1e5),
  })),
  extract: contract('wbed-r1/extract', obj({
    customer_rows: arr(obj({ row: int, system: str(20), void: bool })),
    invoices: arr(obj({ invoice: str(40), system: str(20), row: int, date_text: str(60), currency: str(3), amount_minor: int, status_text: str(60) })),
    payments: arr(obj({ line: int, kind: str(5), ref: str(40), date: str(10), currency: str(3), amount_minor: int, invoice_ref: str(40), payer: str(120) })),
  })),
  normalise: contract('wbed-r1/normalise', obj({
    invoices: arr(obj({ invoice: str(40), row: int, date: str(10), usd_cents: int, live: bool })),
    payments: arr(obj({ line: int, kind: str(5), ref: str(40), date: str(10), usd_cents: int, invoice_key: str(40), in_period: bool })),
  })),
  reconcile: contract('wbed-r1/reconcile', obj({
    customers: arr(obj({ customer_id: int, source_rows: arr(int, 400, { minItems: 1 }) })),
  })),
  report: contract('wbed-r1/report', outputSchema),
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
  const extra = (Array.isArray(got) ? got.length : 0) - want.length;
  return { mismatches: out, extra };
}
function sectionResult(errors, sections) {
  if (errors.length) return { pass: false, details: { reason: 'contract', errors: errors.slice(0, 8) } };
  const bad = Object.entries(sections).filter(([, d]) => d.mismatches.length || d.extra !== 0);
  return { pass: bad.length === 0, details: Object.fromEntries(Object.entries(sections).map(([k, d]) => [k, { mismatches: d.mismatches.length, extra: d.extra, first: d.mismatches[0] ?? null }])) };
}

/** Local report checks: the report's own arithmetic and its customers against the reconcile hand-off it was given. */
export function reportLocal(rc, rep) {
  const errors = CONTRACTS.report.check(rep);
  if (errors.length) return { pass: false, details: { reason: 'contract', errors: errors.slice(0, 8) } };
  const problems = [];
  const want = new Map(rc.customers.map(c => [c.customer_id, [...c.source_rows].sort((a, b) => a - b).join(',')]));
  if (rep.customers.length !== want.size) problems.push('customer-count');
  for (const c of rep.customers) {
    if (want.get(c.customer_id) !== [...c.source_rows].sort((a, b) => a - b).join(',')) { problems.push(`customer-${c.customer_id}`); break; }
  }
  for (const c of rep.customers) if (c.open_usd_cents !== c.invoiced_usd_cents - c.paid_usd_cents) { problems.push(`open-${c.customer_id}`); break; }
  for (const c of rep.customers) if (c.invoiced_usd_cents < 0 || c.paid_usd_cents < 0) { problems.push(`negative-${c.customer_id}`); break; }
  const sum = f => rep.customers.reduce((s, c) => s + c[f], 0);
  if (rep.totals.customers !== rep.customers.length) problems.push('totals.customers');
  for (const f of ['invoiced_usd_cents', 'paid_usd_cents', 'open_usd_cents']) if (rep.totals[f] !== sum(f)) problems.push(`totals.${f}`);
  return { pass: problems.length === 0, details: { problems } };
}

// ---- cross-stage relations. Each recomputes, from the earlier stages' outputs alone, what the report must say.
function attribution(trace) {
  const { normalise: no, reconcile: rc } = trace;
  const ownerOfRow = new Map();
  for (const c of rc.customers) for (const r of c.source_rows) ownerOfRow.set(r, c.customer_id);
  const inv = new Map(), pay = new Map();
  const counted = new Map();
  for (const i of no.invoices) {
    if (!i.live || !ownerOfRow.has(i.row)) continue;
    const o = ownerOfRow.get(i.row);
    counted.set(refKey(i.invoice), o);
    inv.set(o, (inv.get(o) ?? 0) + i.usd_cents);
  }
  const seen = new Set();
  for (const p of no.payments) {
    if (p.kind !== 'PAY' || seen.has(p.ref)) continue;
    seen.add(p.ref);
    if (!p.in_period || !counted.has(p.invoice_key)) continue;
    const o = counted.get(p.invoice_key);
    pay.set(o, (pay.get(o) ?? 0) + p.usd_cents);
  }
  return { inv, pay };
}
const total = m => [...m.values()].reduce((s, x) => s + x, 0);
export const RELATIONS = [
  { id: 'X1-invoice-conservation', stages: ['normalise', 'reconcile', 'report'],
    text: 'sum of invoiced over the report = sum of US cents over invoices that count (live, in period, booked to a reconciled row), each once',
    check: trace => { const { inv } = attribution(trace); const got = trace.report.totals.invoiced_usd_cents; return { pass: got === total(inv), details: { expected: total(inv), got } }; } },
  { id: 'X2-payment-conservation', stages: ['normalise', 'report'],
    text: 'sum of paid over the report = sum of US cents over distinct PAY references, in period, whose invoice counts',
    check: trace => { const { pay } = attribution(trace); const got = trace.report.totals.paid_usd_cents; return { pass: got === total(pay), details: { expected: total(pay), got } }; } },
  { id: 'X3-ownership', stages: ['normalise', 'reconcile', 'report'],
    text: 'each customer is invoiced for the invoices booked to its rows and credited with the payments of those invoices, whoever paid',
    check: trace => {
      const { inv, pay } = attribution(trace);
      const bad = trace.report.customers.filter(c => c.invoiced_usd_cents !== (inv.get(c.customer_id) ?? 0) || c.paid_usd_cents !== (pay.get(c.customer_id) ?? 0));
      return { pass: bad.length === 0, details: { customers: bad.length, first: bad[0]?.customer_id ?? null } };
    } },
];

/** Stage definitions. `truthOf(task)` gives the exact solver's trace (index.mjs passes it in). */
export function makeStages(truthOf, inputOf) {
  return [
    { id: 'extract', inputSchema: CONTRACTS.input.schema, outputSchema: CONTRACTS.extract.schema,
      project: task => ({ task, input: inputOf(task) }),
      oracle: (st, out) => {
        const t = truthOf(st.task).extract;
        return sectionResult(CONTRACTS.extract.check(out), {
          customer_rows: diffList(t.customer_rows, out?.customer_rows, x => x.row),
          invoices: diffList(t.invoices, out?.invoices, x => x.invoice),
          payments: diffList(t.payments, out?.payments, x => x.line),
        });
      } },
    { id: 'normalise', inputSchema: CONTRACTS.extract.schema, outputSchema: CONTRACTS.normalise.schema,
      project: task => ({ task, input: truthOf(task).extract }),
      oracle: (st, out) => {
        const t = truthOf(st.task).normalise;
        return sectionResult(CONTRACTS.normalise.check(out), {
          invoices: diffList(t.invoices, out?.invoices, x => x.invoice),
          payments: diffList(t.payments, out?.payments, x => x.line),
        });
      } },
    { id: 'reconcile', inputSchema: CONTRACTS.extract.schema, outputSchema: CONTRACTS.reconcile.schema,
      project: task => ({ task, input: { customer_rows: truthOf(task).extract.customer_rows } }),
      oracle: (st, out) => {
        const t = truthOf(st.task).reconcile;
        const norm = c => ({ customer_id: c.customer_id, source_rows: [...c.source_rows].sort((a, b) => a - b) });
        return sectionResult(CONTRACTS.reconcile.check(out), {
          customers: diffList(t.customers.map(norm), (out?.customers ?? []).map(c => (c && Array.isArray(c.source_rows) ? norm(c) : c)), x => x?.customer_id),
        });
      } },
    { id: 'report', inputSchema: CONTRACTS.reconcile.schema, outputSchema: CONTRACTS.report.schema,
      project: task => { const t = truthOf(task); return { task, input: { extract: t.extract, normalise: t.normalise, reconcile: t.reconcile } }; },
      oracle: (st, out) => reportLocal(st.input.reconcile, out) },
  ];
}

/** Stage oracles on a trace's own stage outputs, plus every relation. */
export function composeOracle(stages, task, trace) {
  const per = {};
  for (const s of stages) per[s.id] = s.oracle(s.project(task), trace[s.id]);
  // The report stage is judged against the reconcile hand-off the trace actually produced.
  per.report = reportLocal(trace.reconcile, trace.report);
  const rel = {};
  for (const x of RELATIONS) {
    try { rel[x.id] = x.check(trace); } catch (e) { rel[x.id] = { pass: false, details: { error: String(e.message ?? e) } }; }
  }
  const pass = Object.values(per).every(r => r.pass) && Object.values(rel).every(r => r.pass);
  return { pass, stages: per, relations: rel };
}
