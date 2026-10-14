// Output-invariance relations and the witness of W-bed rung R3 "statement audit" (ATTACK-20261014 §3 M1; PROOF-LEDGER K3,
// K4). Host code beside the oracle: no system component sees it. A relation reads the task's prompt and inputs and, where
// it says so, the audit the solver gave on the original task (never the hidden world). Contract: beds/lib/metamorphic.mjs.
// Why each relation holds for a correct audit (audit_spec sections):
//   shuffle-statement-files  every supplier is audited from its own file, named in inputs.vendors (s.1); the order of the
//       files in inputs.statements means nothing. distribution 'out': the generator lists them by file name.
//   shuffle-ledger-lines     the ledger balance is a sum over a supplier's lines and matching is by reference and kind
//       (s.1-2); each line carries its own line id and date. distribution 'out': the generator lists lines by line id.
//   (A statement's own lines are not shuffled: they carry a running balance, so a permuted statement is not a statement.)
//   drop-clean-supplier      remove a supplier the audit reports with no discrepancy: its vendor line, its statement
//       file and every ledger line that names it by its name or a listed other name (s.1, exact names). Nothing it had is
//       a discrepancy, so by_reason and every other supplier stay and totals.statements falls by one (s.5). distribution
//       'out' (review fix 2026-10-14, M1 review finding 3): it leaves gaps in the vendor ids (V-301...) and the ledger line
//       ids (L0001...), which are contiguous in every generated task. Built as 'in'. (Renumbering both would make it 'in',
//       at the price of an id map in the check; not done.)
// Regularities (`regularities`, audited by beds/lib/metamorphic.test.mjs): vendor ids contiguous in order; statement files in
// file-name order (render.mjs:15); ledger line ids L0001... contiguous in order. R3 has no 'in' relation.
// Comparison: statements keyed by vendor_id (currency, the three balances exactly, discrepancies as a multiset), by_reason
// keyed by reason, totals exactly.
import { rngOf, permute, variantTask, compareKeyed, sameValue, shapeViolation, capped, witnessDescriptor } from '../../lib/metamorphic.mjs';
import { canonical } from '../../lib/canonical.mjs';

export const REASONS = Object.freeze(['DUPLICATE', 'TIMING', 'MISSING_CREDIT', 'PRICE', 'FX', 'UNEXPLAINED']);
const POSTED = new Set(['PRICE', 'FX', 'MISSING_CREDIT']);
const BAL = ['currency', 'statement_balance_minor', 'ledger_balance_minor', 'adjusted_balance_minor'];
const TOTALS = ['statements', 'discrepancies', 'difference_usd_cents', 'adjustments_usd_cents'];
const auditOk = o => o && typeof o === 'object' && Array.isArray(o.statements) && Array.isArray(o.by_reason) && o.totals && typeof o.totals === 'object';
const multiset = xs => (Array.isArray(xs) ? xs.map(x => canonical(x ?? null)).sort() : xs);

export function compareAudits(expected, got) {
  if (!auditOk(expected)) return shapeViolation('original', 'no statements / by_reason / totals');
  if (!auditOk(got)) return shapeViolation('variant', 'no statements / by_reason / totals');
  const v = compareKeyed(expected.statements.filter(Boolean), got.statements.filter(Boolean), 'vendor_id', (e, g) => [
    ...BAL.filter(f => !sameValue(e[f], g[f])).map(f => ({ level: 'balances', field: f, expected: e[f] ?? null, got: g[f] ?? null })),
    ...(sameValue(multiset(e.discrepancies), multiset(g.discrepancies)) ? [] : [{ level: 'discrepancies' }]),
  ], 'vendor');
  const r = compareKeyed(expected.by_reason.filter(Boolean), got.by_reason.filter(Boolean), 'reason', (e, g) =>
    ['count', 'usd_cents'].filter(f => !sameValue(e[f], g[f])).map(f => ({ level: 'by-reason', field: f, expected: e[f] ?? null, got: g[f] ?? null })), 'reason');
  const t = TOTALS.filter(f => !sameValue(expected.totals[f], got.totals[f])).map(f => ({ level: 'totals', field: f, expected: expected.totals[f] ?? null, got: got.totals[f] ?? null }));
  return capped([...v, ...r, ...t]);
}

// inputs.vendors: "V-301 | name | other; names | currency | system | file" lines.
export function vendorsOf(text) {
  return String(text ?? '').split('\n').filter(l => /^V-\d+\s*\|/.test(l)).map(line => {
    const f = line.split('|').map(x => x.trim());
    return { line, id: f[0], name: f[1], others: (f[2] ?? '').split(';').map(x => x.trim()).filter(Boolean), file: f[5] ?? null };
  });
}
const ledgerSupplierOf = line => line.split('|')[2]?.trim() ?? null;

export const invariance = Object.freeze([
  {
    id: 'shuffle-statement-files', kind: 'invariant', distribution: 'out',
    text: 'Permute the order of the files in inputs.statements (seeded). Each supplier is audited from its own named file.',
    make(task, { seed }) {
      const names = Object.keys(task.inputs?.statements ?? {});
      if (names.length < 2) return { skip: 'fewer than two statements' };
      const order = permute(names, rngOf(seed, 'wbed-r3', 'shuffle-statement-files'));
      return { task: variantTask(task, { inputs: { ...task.inputs, statements: Object.fromEntries(order.map(n => [n, task.inputs.statements[n]])) } }), info: { order } };
    },
    check: (orig, variant) => compareAudits(orig, variant),
  },
  {
    id: 'shuffle-ledger-lines', kind: 'invariant', distribution: 'out',
    text: 'Permute the AP ledger lines, header kept (seeded). Balances are sums and matching is by reference and kind.',
    make(task, { seed }) {
      const lines = String(task.inputs?.ledger ?? '').split('\n');
      const idx = lines.map((l, i) => i).filter(i => lines[i].trim() !== '' && !lines[i].startsWith('#'));
      if (idx.length < 2) return { skip: 'fewer than two ledger lines' };
      const perm = permute(idx.map(i => lines[i]), rngOf(seed, 'wbed-r3', 'shuffle-ledger-lines')), out = [...lines];
      idx.forEach((i, k) => { out[i] = perm[k]; });
      return { task: variantTask(task, { inputs: { ...task.inputs, ledger: out.join('\n') } }), info: { lines: idx.length } };
    },
    check: (orig, variant) => compareAudits(orig, variant),
  },
  {
    id: 'drop-clean-supplier', kind: 'transform', distribution: 'out', needsOutput: true,
    text: 'Remove one supplier the audit reports with no discrepancy (vendor line, statement file, its ledger lines; seeded). The audit loses exactly that supplier.',
    make(task, { seed, output }) {
      const vendors = vendorsOf(task.inputs?.vendors);
      const clean = (auditOk(output) ? output.statements : []).filter(s => s && Array.isArray(s.discrepancies) && s.discrepancies.length === 0)
        .map(s => vendors.find(x => x.id === s.vendor_id)).filter(x => x && x.file && task.inputs?.statements?.[x.file] != null).sort((a, b) => (a.id < b.id ? -1 : 1));
      if (!clean.length || vendors.length < 2) return { skip: 'no clean supplier to remove' };
      const pick = clean[rngOf(seed, 'wbed-r3', 'drop-clean-supplier').int(0, clean.length - 1)], names = new Set([pick.name, ...pick.others]);
      const statements = Object.fromEntries(Object.entries(task.inputs.statements).filter(([n]) => n !== pick.file));
      const vendorsText = String(task.inputs.vendors).split('\n').filter(l => l !== pick.line).join('\n');
      const ledger = String(task.inputs.ledger ?? '').split('\n').filter(l => l.startsWith('#') || !names.has(ledgerSupplierOf(l))).join('\n');
      const n = Object.keys(statements).length;
      const prompt = task.prompt.replace(/auditing \d+ supplier statements/, `auditing ${n} supplier statements`);
      return { task: variantTask(task, { prompt, inputs: { ...task.inputs, statements, vendors: vendorsText, ledger } }), info: { vendor: pick.id, file: pick.file } };
    },
    check(orig, variant, info) {
      if (!auditOk(orig)) return shapeViolation('original', 'no statements / by_reason / totals');
      const expected = { ...orig, statements: orig.statements.filter(s => s?.vendor_id !== info.vendor), totals: { ...orig.totals, statements: (orig.totals.statements ?? orig.statements.length) - 1 } };
      return compareAudits(expected, variant);
    },
  },
]);

// The generator's listing and numbering regularities (beds/lib/metamorphic.mjs).
const contiguousFromFirst = xs => xs.length > 0 && xs.every((x, i) => Number.isInteger(x) && x === xs[0] + i);
const ledgerIdsOf = task => String(task.inputs?.ledger ?? '').split('\n').filter(l => l.trim() !== '' && !l.startsWith('#')).map(l => Number(/^L(\d+)\b/.exec(l)?.[1]));
export const regularities = Object.freeze([
  { id: 'vendor-ids-contiguous', text: 'inputs.vendors lists V-<n> ids contiguous and in order', holds: task => contiguousFromFirst(vendorsOf(task.inputs?.vendors).map(v => Number(v.id.slice(2)))) },
  { id: 'statement-files-by-name', text: 'inputs.statements is in file-name order (render.mjs:15)',
    holds: task => { const n = Object.keys(task.inputs?.statements ?? {}); return n.every((x, i) => i === 0 || n[i - 1].localeCompare(x) < 0); } },
  { id: 'ledger-ids-contiguous', text: 'ledger lines are L0001, L0002, ... in order', holds: task => { const ids = ledgerIdsOf(task); return contiguousFromFirst(ids) && ids[0] === 1; } },
]);

// Witness (M1 b): conservation inside the audit (statement - ledger = the sum of a supplier's discrepancies; adjusted =
// ledger + PRICE, FX and MISSING_CREDIT; by_reason lists the six codes once with counts that agree; the totals are the
// sums) and an input-tied count (one statement per supplier of inputs.vendors). A wrong classification that keeps the sums
// passes it.
export const witness = witnessDescriptor('conservation', [
  { tag: 'conservation', scope: 'output', text: 'statement - ledger = sum of discrepancies; adjusted = ledger + PRICE + FX + MISSING_CREDIT; totals are sums of by_reason' },
  { tag: 'count', scope: 'input', text: 'one statements entry per supplier of inputs.vendors; by_reason lists all six codes once; counts agree with the discrepancies' },
]);
export const witnessOf = () => witness;
export function witnessCheckAudit(inputs, out) {
  if (!auditOk(out)) return [{ level: 'shape', tag: 'conservation' }];
  const v = [], st = out.statements.filter(Boolean);
  const want = vendorsOf(inputs?.vendors).map(x => x.id).sort(), got = st.map(s => s.vendor_id).sort();
  if (want.join() !== got.join()) v.push({ level: 'count', tag: 'count', check: 'one statement per vendor', want, got });
  const counts = Object.fromEntries(REASONS.map(r => [r, 0]));
  for (const s of st) {
    const ds = Array.isArray(s.discrepancies) ? s.discrepancies.filter(Boolean) : [];
    const sum = ds.reduce((a, d) => a + (Number.isInteger(d.amount_minor) ? d.amount_minor : 0), 0);
    if (s.statement_balance_minor - s.ledger_balance_minor !== sum) v.push({ level: 'conservation', tag: 'conservation', vendor: s.vendor_id, check: 'statement - ledger = sum of discrepancies' });
    const posted = ds.filter(d => POSTED.has(d.reason)).reduce((a, d) => a + (Number.isInteger(d.amount_minor) ? d.amount_minor : 0), 0);
    if (s.adjusted_balance_minor !== s.ledger_balance_minor + posted) v.push({ level: 'conservation', tag: 'conservation', vendor: s.vendor_id, check: 'adjusted = ledger + posted' });
    for (const d of ds) if (d.reason in counts) counts[d.reason]++;
  }
  const br = out.by_reason.filter(Boolean), reasons = br.map(x => x.reason).sort();
  if (reasons.join() !== [...REASONS].sort().join()) v.push({ level: 'count', tag: 'count', check: 'by_reason lists the six codes once' });
  for (const x of br) if (x.reason in counts && x.count !== counts[x.reason]) v.push({ level: 'count', tag: 'count', reason: x.reason, check: 'by_reason count = discrepancies' });
  const usd = f => br.filter(f).reduce((a, x) => a + (Number.isInteger(x.usd_cents) ? x.usd_cents : 0), 0);
  const t = out.totals;
  if (t.statements !== st.length) v.push({ level: 'count', tag: 'count', check: 'totals.statements = entries' });
  if (t.discrepancies !== br.reduce((a, x) => a + (Number.isInteger(x.count) ? x.count : 0), 0)) v.push({ level: 'conservation', tag: 'conservation', check: 'totals.discrepancies = sum of counts' });
  if (t.difference_usd_cents !== usd(() => true)) v.push({ level: 'conservation', tag: 'conservation', check: 'difference = sum of by_reason usd' });
  if (t.adjustments_usd_cents !== usd(x => POSTED.has(x.reason))) v.push({ level: 'conservation', tag: 'conservation', check: 'adjustments = PRICE + FX + MISSING_CREDIT usd' });
  return capped(v);
}
export const witnessCheck = (task, output) => witnessCheckAudit(task.inputs, output);
