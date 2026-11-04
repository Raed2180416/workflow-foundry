// Oracle v2 (post hoc) on first-party fixtures: it differs from v1 only by its five declared changes, and it still refuses a leak of
// ANOTHER row, a missing required fact, a wrong count and a wrong sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { equivalent, rowIdentities } from '../../ci1/canon.mjs';
import { equivalentV2, rowIdentitiesWithAddresses } from '../oracle-v2.mjs';

const world = { id: 'w', now: '2026-07-17T06:00:00Z', sheets: {
  products: { rows: [{ name: 'Wool throw', link: 'https://shop.example/p/1', day: '2026-07-17' }, { name: 'Brass lamp', link: '', day: '2026-07-18' }] },
  subscribers: { rows: [{ email: 'soren.jessop@inbox.example', name: 'Soren' }, { email: 'elif.vantongeren@post.example', name: 'Elif' }] } } };
const vocab = new Set(['new', 'product', 'for', 'you', 'today', 'hi']);
const ref = { ok: true, mail: [{ to: 'soren.jessop@inbox.example', subject: '1 new product', body: 'Wool throw https://shop.example/p/1' }], chat: [], respond: [], sheets: {} };
const decls = () => {
  const d1 = { vocab, rows: rowIdentities(world, vocab) };
  return { d1, d2: { ...d1, rowsWithAddresses: rowIdentitiesWithAddresses(world, vocab) } };
};
const cand = body => ({ ok: true, mail: [{ to: 'soren.jessop@inbox.example', subject: '1 new product', body }], chat: [], respond: [], sheets: {} });

test('greeting the addressee by name is a leak to v1 and not to v2; naming another subscriber is a leak to both', () => {
  const { d1, d2 } = decls();
  const greet = cand('Hi Soren! Wool throw https://shop.example/p/1');
  assert.equal(equivalent(ref, greet, d1).pass, false);
  assert.equal(equivalentV2(ref, greet, d2).pass, true);
  const other = cand('Hi Soren and Elif! Wool throw https://shop.example/p/1');
  assert.equal(equivalentV2(ref, other, d2).pass, false);
  const lamp = cand('Wool throw https://shop.example/p/1 and Brass lamp');
  assert.equal(equivalentV2(ref, lamp, d2).pass, false, 'a product the reference leaves out is still a leak');
});

test('optional spans remove only the declared facts; v2 equals v1 without declarations', () => {
  const { d1, d2 } = decls();
  const ref2 = { ...ref, mail: [{ ...ref.mail[0], body: 'Overdue Invoices (7)\nWool throw https://shop.example/p/1' }] };
  const noCount = cand('Wool throw https://shop.example/p/1');
  assert.equal(equivalent(ref2, noCount, d1).pass, false, 'v1 requires the section count');
  assert.equal(equivalentV2(ref2, noCount, d2).pass, false, 'v2 without a declaration is v1');
  assert.equal(equivalentV2(ref2, noCount, { ...d2, optional: { mail: ['Overdue Invoices \\(\\d+\\)'] } }).pass, true);
  assert.equal(equivalentV2(ref2, cand('Wool throw'), { ...d2, optional: { mail: ['Overdue Invoices \\(\\d+\\)'] } }).pass, false, 'the link is still required');
});

test('categorical cells (a status, a currency) do not identify a row; ids still do', async () => {
  const { categoricalColumns } = await import('../oracle-v2.mjs');
  const inv = (n, st, cur) => ({ InvoiceNumber: `INV-${n}`, Status: st, Currency: cur });
  const worlds = [0, 1, 2].map(k => ({ sheets: { invoices: { rows: [inv(10 + k, 'Paid', 'GBP'), inv(20 + k, 'Unpaid', 'EUR'), inv(30 + k, 'Unpaid', 'GBP'), inv(40 + k, 'Unpaid', 'EUR')] } } }));
  const cat = categoricalColumns(worlds);
  assert.ok(cat.has('invoices|Status') && cat.has('invoices|Currency') && !cat.has('invoices|InvoiceNumber'));
  const rows = rowIdentitiesWithAddresses(worlds[0], new Set(), cat);
  assert.ok(!rows.some(r => r.ids.includes('paid')), 'the one "Paid" row is not identified by its status');
  assert.ok(rows.some(r => r.ids.includes('inv-10')));
  const vocab = new Set(['is', 'late', 'ignore', 'this', 'if', 'you', 'already', 'and', 'so']);
  const ref = { ok: true, mail: [{ to: 'a@x.example', subject: '', body: 'INV-20 is late' }], chat: [], respond: [], sheets: {} };
  const ok = { ...ref, mail: [{ ...ref.mail[0], body: 'INV-20 is late; ignore this if you already paid' }] };
  assert.equal(equivalentV2(ref, ok, { vocab, rowsWithAddresses: rows }).pass, true);
  assert.equal(equivalent(ref, ok, { vocab, rows: rowIdentities(worlds[0], vocab) }).pass, false, 'v1 calls "paid" a leak of the Paid row');
  const leak = { ...ref, mail: [{ ...ref.mail[0], body: 'INV-20 is late, and so is INV-30' }] };
  assert.equal(equivalentV2(ref, leak, { vocab, rowsWithAddresses: rows }).pass, false);
});

test('counts, missing runs and sheets are judged as in v1', () => {
  const { d2 } = decls();
  assert.equal(equivalentV2(ref, { ...cand('Wool throw https://shop.example/p/1'), mail: [] }, d2).pass, false);
  assert.equal(equivalentV2(ref, { ...cand('x'), ok: false, error: 'boom' }, d2).pass, false);
  const r = { ...ref, mail: [], sheets: { s: [{ a: 1 }] } };
  assert.equal(equivalentV2(r, { ok: true, mail: [], chat: [], respond: [], sheets: { s: [{ a: 2 }] } }, d2).pass, false);
  assert.equal(equivalentV2(r, { ok: true, mail: [], chat: [], respond: [], sheets: { s: [{ a: 1 }] } }, d2).pass, true);
});

test('change 4: a numeric day/month/year date in the built message carries the ISO date fact; only the candidate side is widened', async () => {
  const { candTokens } = await import('../oracle-v2.mjs');
  assert.ok(candTokens('Shift reminder — 15/06/2026').includes('D:2026-06-15'), 'DD/MM/YYYY, unambiguous');
  assert.ok(candTokens('due 06.15.2026').includes('D:2026-06-15'), 'MM.DD.YYYY, unambiguous');
  const amb = candTokens('on 04/06/2026');
  assert.ok(amb.includes('D:2026-06-04') && amb.includes('D:2026-04-06'), 'both readings when both are valid');
  assert.ok(!candTokens('31/02/2026').some(t => t.startsWith('D:')), 'no impossible date');
  assert.ok(!candTokens('ref 13/34/5678').some(t => t.startsWith('D:')), 'no reading with both parts above 12');
  const vocab = new Set(['shift', 'reminder']);
  const ref = { ok: true, mail: [{ to: 'noor.hartigan@post.example', subject: 'Shift reminder — 2026-06-15', body: 'Riverside Mall' }], chat: [], respond: [], sheets: {} };
  const dmy = { ...ref, mail: [{ ...ref.mail[0], subject: 'Shift reminder — 15/06/2026' }] };
  assert.equal(equivalent(ref, dmy, { vocab }).pass, false, 'v1 misses the date written as DD/MM/YYYY');
  assert.equal(equivalentV2(ref, dmy, { vocab }).pass, true);
  const wrong = { ...ref, mail: [{ ...ref.mail[0], subject: 'Shift reminder — 16/06/2026' }] };
  assert.equal(equivalentV2(ref, wrong, { vocab }).pass, false, 'a wrong date still fails');
  // the reference writes DD/MM/YYYY (its description asked for that format): an ISO date in the built message does not carry it
  const refDmy = { ...ref, mail: [{ ...ref.mail[0], subject: 'Timesheet reminder — week of 03/08/2026' }] };
  const iso = { ...ref, mail: [{ ...ref.mail[0], subject: 'Timesheet reminder — week of 2026-08-03' }] };
  assert.equal(equivalentV2(refDmy, iso, { vocab }).pass, false);
  assert.equal(equivalentV2(refDmy, refDmy, { vocab }).pass, true);
});

test('AMBIGUOUS lists items for the sensitivity analysis only; every POSTHOC_DECL entry gives its reason', async () => {
  const { AMBIGUOUS, POSTHOC_DECL } = await import('../oracle-v2.mjs');
  assert.deepEqual(Object.keys(AMBIGUOUS).sort(), ['16312', '17545']);
  for (const [id, d] of Object.entries(POSTHOC_DECL)) { assert.ok(d.why?.length > 40, id); for (const p of [...(d.optional?.mail ?? []), ...(d.optional?.chat ?? [])]) assert.doesNotThrow(() => new RegExp(p)); }
});

test('change 5: a number before a prose comma is a fact on both sides; v1 drops it; a wrong number still fails', async () => {
  const { fixCommas, factsV2, candTokens } = await import('../oracle-v2.mjs');
  const { tokens, factsOf } = await import('../../ci1/canon.mjs');
  assert.ok(!tokens('expires 28/07/2026, 0 days').includes('2026'), 'the v1 defect this change corrects');
  assert.ok(candTokens('expires 28/07/2026, 0 days').includes('2026'));
  assert.equal(fixCommas('1,234, then 12,5 and 3,'), '1,234 , then 12,5 and 3 ,', 'thousands and decimal commas untouched');
  assert.ok(candTokens('Total: 1,234, ok').includes('1234'));
  const vocab = new Set(['certification', 'expiry', 'expires', 'days', 'left']);
  assert.deepEqual(factsOf('3 left, 11, 2026,', vocab), ['3']);
  assert.deepEqual(factsV2('3 left, 11, 2026,', vocab).sort(), ['11', '2026', '3']);
  const ref = { ok: true, mail: [{ to: 'ops@example.com', subject: 'Certification expiry', body: 'Lucinda Lorrimer 08/08/2026 11 days' }], chat: [], respond: [], sheets: {} };
  const comma = { ...ref, mail: [{ ...ref.mail[0], body: 'Lucinda Lorrimer: expires 08/08/2026, 11 days left' }] };
  assert.equal(equivalent(ref, comma, { vocab }).pass, false, 'v1 fails the comma-separated date');
  assert.equal(equivalentV2(ref, comma, { vocab }).pass, true);
  const wrongYear = { ...ref, mail: [{ ...ref.mail[0], body: 'Lucinda Lorrimer: expires 08/08/2027, 11 days left' }] };
  assert.equal(equivalentV2(ref, wrongYear, { vocab }).pass, false, 'the year is still required');
  // the reference side: a count before a comma becomes required (v1 silently dropped it)
  const refCount = { ...ref, mail: [{ ...ref.mail[0], body: 'Overdue: 3, due soon: 2' }] };
  const wrongCount = { ...refCount, mail: [{ ...refCount.mail[0], body: 'Overdue: 4, due soon: 2' }] };
  assert.equal(equivalent(refCount, wrongCount, { vocab }).pass, true, 'v1 blind spot');
  assert.equal(equivalentV2(refCount, wrongCount, { vocab }).pass, false);
});
