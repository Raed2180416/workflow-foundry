// Output-invariance relations and the witness of W-bed rung R1 "ledger close" (ATTACK-20261014 §3 M1; PROOF-LEDGER K3, K4).
// Host code beside the oracle: no system component sees it. A relation reads the task's prompt and inputs and, where it
// says so, the report the solver gave on the original task (never the hidden ledger). Contract: beds/lib/metamorphic.mjs.
// Why each relation holds for a correct report (ledger_spec sections; customer identity is customer_spec s.2, 3, 6, A):
//   shuffle-customer-rows, shuffle-invoice-lines, shuffle-bank-feed  every rule is per row, per invoice or per bank
//       event, and the amounts are sums (s.3-5); no rule reads a line's position. distribution 'out': the generator
//       always lists rows by row id and invoices and bank events by date.
//   duplicate-row   a copy of one customer row under a fresh row id that no list mentions, of a customer with two or more
//       rows (or a row the report leaves out): it links to its original by the same identity rule (records' argument,
//       beds/records/invariance.mjs), no invoice is booked to it, so the customer gains the new id in source_rows and
//       every amount stays. distribution 'in'.
//   drop-idle-singleton  remove the only row of a customer the report lists with one row and nothing invoiced or paid:
//       an invoice booked to it did not count before (nothing invoiced) and cannot count after (s.3 c), so no payment
//       moves (s.4); the report loses exactly that customer. distribution 'in'.
// Comparison: customers keyed by customer_id (source rows as a set, the three amounts exactly) and the totals exactly.
import { rngOf, permute, variantTask, compareKeyed, sameValue, sortedInts, shapeViolation, capped, witnessDescriptor } from '../../lib/metamorphic.mjs';

const AMOUNTS = ['invoiced_usd_cents', 'paid_usd_cents', 'open_usd_cents'];
const TOTALS = ['customers', 'invoiced_usd_cents', 'paid_usd_cents', 'open_usd_cents'];
const rowIdOf = line => Number(line.match(/\d+/)?.[0]);
const nonEmpty = text => String(text ?? '').split('\n').filter(l => l.trim() !== '');
const reportOk = o => o && typeof o === 'object' && Array.isArray(o.customers) && o.totals && typeof o.totals === 'object';

export function compareReports(expected, got) {
  if (!reportOk(expected)) return shapeViolation('original', 'no customers / totals');
  if (!reportOk(got)) return shapeViolation('variant', 'no customers / totals');
  const v = compareKeyed(expected.customers.filter(Boolean), got.customers.filter(Boolean), 'customer_id', (e, g) => {
    const out = [];
    if (!sameValue(sortedInts(e.source_rows), sortedInts(g.source_rows))) out.push({ level: 'source-rows', expected: sortedInts(e.source_rows), got: sortedInts(g.source_rows) });
    for (const f of AMOUNTS) if (!sameValue(e[f], g[f])) out.push({ level: 'amounts', field: f, expected: e[f] ?? null, got: g[f] ?? null });
    return out;
  }, 'customer');
  const t = TOTALS.filter(f => !sameValue(expected.totals[f], got.totals[f])).map(f => ({ level: 'totals', field: f, expected: expected.totals[f] ?? null, got: got.totals[f] ?? null }));
  return capped([...v, ...t]);
}

function withInputs(task, patch, { rows = null } = {}) {
  const prompt = rows == null ? task.prompt : task.prompt.replace(/holds \d+ customer rows/, `holds ${rows} customer rows`);
  return variantTask(task, { prompt, inputs: { ...task.inputs, ...patch } });
}
// Shuffle the lines of a list after its header (leading lines without a digit, or starting with '#').
function shuffleBody(text, r) {
  const lines = String(text ?? '').split('\n');
  let h = 0;
  while (h < lines.length && (lines[h].startsWith('#') || !/\d/.test(lines[h]))) h++;
  const body = lines.slice(h), idx = body.map((l, i) => i).filter(i => body[i].trim() !== '');
  if (idx.length < 2) return { text, moved: 0 };
  const perm = permute(idx.map(i => body[i]), r), out = [...body];
  idx.forEach((i, k) => { out[i] = perm[k]; });
  return { text: [...lines.slice(0, h), ...out].join('\n'), moved: perm.filter((x, k) => x !== body[idx[k]]).length };
}
const removeCustomerTotals = (rep, id) => {
  const customers = rep.customers.filter(c => c?.customer_id !== id), sum = f => customers.reduce((a, c) => a + (Number.isInteger(c?.[f]) ? c[f] : 0), 0);
  return { customers, totals: { ...rep.totals, customers: (rep.totals.customers ?? rep.customers.length) - 1, invoiced_usd_cents: sum('invoiced_usd_cents'), paid_usd_cents: sum('paid_usd_cents'), open_usd_cents: sum('open_usd_cents') } };
};

export const invariance = Object.freeze([
  {
    id: 'shuffle-customer-rows', kind: 'invariant', distribution: 'out',
    text: 'Permute the customer export lines (seeded). No rule reads a line\'s position.',
    make(task, { seed }) {
      const lines = nonEmpty(task.inputs?.customer_export);
      if (lines.length < 2) return { skip: 'fewer than two customer rows' };
      return { task: withInputs(task, { customer_export: permute(lines, rngOf(seed, 'wbed-r1', 'shuffle-customer-rows')).join('\n') }), info: { lines: lines.length } };
    },
    check: (orig, variant) => compareReports(orig, variant),
  },
  {
    id: 'shuffle-invoice-lines', kind: 'invariant', distribution: 'out',
    text: 'Permute the invoice lines of every billing system\'s list, headers kept (seeded). Invoices count one by one.',
    make(task, { seed }) {
      const r = rngOf(seed, 'wbed-r1', 'shuffle-invoice-lines'), invoices = {};
      let moved = 0;
      for (const [sys, text] of Object.entries(task.inputs?.invoices ?? {})) { const s = shuffleBody(text, r); invoices[sys] = s.text; moved += s.moved; }
      if (!moved) return { skip: 'no invoice list with two or more lines' };
      return { task: withInputs(task, { invoices }), info: { moved } };
    },
    check: (orig, variant) => compareReports(orig, variant),
  },
  {
    id: 'shuffle-bank-feed', kind: 'invariant', distribution: 'out',
    text: 'Permute the bank feed lines, header kept (seeded). Payments count one by one.',
    make(task, { seed }) {
      const s = shuffleBody(task.inputs?.payments, rngOf(seed, 'wbed-r1', 'shuffle-bank-feed'));
      if (!s.moved) return { skip: 'fewer than two bank lines' };
      return { task: withInputs(task, { payments: s.text }), info: { moved: s.moved } };
    },
    check: (orig, variant) => compareReports(orig, variant),
  },
  {
    id: 'duplicate-row', kind: 'transform', distribution: 'in', needsOutput: true,
    text: 'Copy one customer row (of a customer with two or more rows, or a row the report leaves out) under a fresh row id no list mentions (seeded). The customer gains the new id in source_rows; every amount stays.',
    make(task, { seed, output }) {
      const lines = nonEmpty(task.inputs?.customer_export), ids = lines.map(rowIdOf);
      if (!lines.length || ids.some(x => !Number.isInteger(x))) return { skip: 'customer rows without a leading row id' };
      const owner = new Map();
      for (const c of reportOk(output) ? output.customers : []) if (Array.isArray(c?.source_rows)) for (const id of c.source_rows) if (!owner.has(id)) owner.set(id, c);
      const candidates = ids.map((id, i) => i).filter(i => !owner.has(ids[i]) || owner.get(ids[i]).source_rows.length >= 2);
      if (!candidates.length) return { skip: 'every row is a single-row customer' };
      const r = rngOf(seed, 'wbed-r1', 'duplicate-row'), i = candidates[r.int(0, candidates.length - 1)], rowId = ids[i], c = owner.get(rowId);
      const width = String(Math.max(...ids)).length, top = 10 ** width - 1;
      const mentioned = new Set(ids);
      for (const m of `${JSON.stringify(task.inputs?.invoices ?? {})}\n${task.inputs?.payments ?? ''}`.matchAll(/\d+/g)) mentioned.add(Number(m[0]));
      const floor = Math.max(rowId, Number.isInteger(c?.customer_id) ? c.customer_id : rowId), free = [];
      for (let x = floor + 1; x <= top && free.length < 5000; x++) if (!mentioned.has(x)) free.push(x);
      if (!free.length) return { skip: 'no free row id above the copied row' };
      const newId = free[r.int(0, free.length - 1)], at = ids.findIndex(x => x > newId), out = [...lines];
      out.splice(at < 0 ? lines.length : at, 0, lines[i].replace(String(rowId), String(newId)));
      return { task: withInputs(task, { customer_export: out.join('\n') }, { rows: out.length }), info: { rowId, newId, customer: c?.customer_id ?? null } };
    },
    check(orig, variant, info) {
      if (!reportOk(orig)) return shapeViolation('original', 'no customers / totals');
      const expected = { ...orig, customers: orig.customers.map(c => (Array.isArray(c?.source_rows) && c.source_rows.includes(info.rowId) ? { ...c, source_rows: [...c.source_rows, info.newId] } : c)) };
      return compareReports(expected, variant);
    },
  },
  {
    id: 'drop-idle-singleton', kind: 'transform', distribution: 'in', needsOutput: true,
    text: 'Remove the only row of a customer the report lists with one row and nothing invoiced or paid (seeded). The report loses exactly that customer.',
    make(task, { seed, output }) {
      const lines = nonEmpty(task.inputs?.customer_export), ids = new Set(lines.map(rowIdOf));
      const idle = (reportOk(output) ? output.customers : []).filter(c => Array.isArray(c?.source_rows) && c.source_rows.length === 1 && ids.has(c.source_rows[0])
        && c.invoiced_usd_cents === 0 && c.paid_usd_cents === 0 && Number.isInteger(c.customer_id)).sort((a, b) => a.customer_id - b.customer_id);
      if (!idle.length) return { skip: 'no single-row customer with nothing invoiced or paid' };
      const pick = idle[rngOf(seed, 'wbed-r1', 'drop-idle-singleton').int(0, idle.length - 1)], rowId = pick.source_rows[0];
      const out = lines.filter(l => rowIdOf(l) !== rowId);
      return { task: withInputs(task, { customer_export: out.join('\n') }, { rows: out.length }), info: { rowId, customer: pick.customer_id } };
    },
    check(orig, variant, info) {
      if (!reportOk(orig)) return shapeViolation('original', 'no customers / totals');
      return compareReports(removeCustomerTotals(orig, info.customer), variant);
    },
  },
]);

// Witness (M1 b): conservation over the report itself (open = invoiced - paid; the totals are the sums and the count) and
// an input-tied partition (every source row is a row of the customer export, no row in two customers, customer_id = the
// smallest). A misread convention keeps both; they catch arithmetic and bookkeeping slips only.
export const witness = witnessDescriptor('conservation', [
  { tag: 'conservation', scope: 'output', text: 'open = invoiced - paid per customer; totals are the sums over customers' },
  { tag: 'count', scope: 'output', text: 'totals.customers = the number of entries' },
  { tag: 'count', scope: 'input', text: 'source rows are customer-export rows, none in two customers; customer_id = min(source_rows)' },
]);
export const witnessOf = () => witness;
export function witnessCheckReport(inputs, rep) {
  if (!reportOk(rep)) return [{ level: 'shape', tag: 'conservation' }];
  const v = [], cs = rep.customers.filter(Boolean), ids = new Set(nonEmpty(inputs?.customer_export).map(rowIdOf)), seen = new Set();
  for (const c of cs) {
    if (Number.isInteger(c.invoiced_usd_cents) && Number.isInteger(c.paid_usd_cents) && c.open_usd_cents !== c.invoiced_usd_cents - c.paid_usd_cents) v.push({ level: 'conservation', tag: 'conservation', customer: c.customer_id, check: 'open = invoiced - paid' });
    const rows = Array.isArray(c.source_rows) ? c.source_rows : [];
    if (rows.length && c.customer_id !== Math.min(...rows)) v.push({ level: 'count', tag: 'count', customer: c.customer_id, check: 'customer_id = min(source_rows)' });
    for (const x of rows) { if (!ids.has(x)) v.push({ level: 'count', tag: 'count', customer: c.customer_id, check: 'source row not in the export', row: x }); if (seen.has(x)) v.push({ level: 'count', tag: 'count', check: 'row in two customers', row: x }); seen.add(x); }
  }
  const sum = f => cs.reduce((a, c) => a + (Number.isFinite(c[f]) ? c[f] : 0), 0);
  for (const f of AMOUNTS) if (rep.totals[f] !== sum(f)) v.push({ level: 'conservation', tag: 'conservation', check: `totals.${f} = sum` });
  if (rep.totals.customers !== cs.length) v.push({ level: 'count', tag: 'count', check: 'totals.customers = entries' });
  return capped(v);
}
export const witnessCheck = (task, output) => witnessCheckReport(task.inputs, output);
