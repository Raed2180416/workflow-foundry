// The person's own data: parsing, plain-word column mapping, and the ambiguities that are asked, never guessed (SPEC §5 A6b).
// nice -n 15 node --test app/onboarding/test/csv.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, sniffDelimiter, readTable, readDate, readNumber, preview, convert } from '../csv.mjs';
import { commit, liveSheets, history } from '../data.mjs';
import { fixture, withApp } from './helpers.mjs';

test('RFC 4180: quoted fields, doubled quotes, line breaks in quotes, CRLF, BOM; the delimiter is sniffed', () => {
  assert.deepEqual(parse('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\r\n'), [['a', 'b, c', 'say "hi"'], ['1', 'two\nlines', '3']]);
  assert.equal(sniffDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(sniffDelimiter('a\tb\n1\t2'), '\t');
  assert.deepEqual(readTable('﻿Name;Mail\nAna;ana@x.example\n').header, ['Name', 'Mail']);
  assert.throws(() => parse('"open'), { code: 'CSV_QUOTE' });
  assert.equal(readTable('[{"a":1,"b":"x"}]').format, 'json');
  assert.throws(() => readTable('[{"a":1}'), { code: 'CSV_JSON' });
});

test('dates: certain readings, ambiguous ones, Excel serials; amounts: thousands and decimal separators', () => {
  assert.deepEqual(readDate('2026-10-03'), { iso: '2026-10-03' });
  assert.equal(readDate('25/09/2026').iso, '2026-09-25');
  assert.equal(readDate('09/25/2026').iso, '2026-09-25');
  assert.deepEqual(readDate('03/10/2026'), { ambiguous: true, dmy: '2026-10-03', mdy: '2026-03-10' });
  assert.equal(readDate('03/10/2026', 'dmy').iso, '2026-10-03');
  assert.equal(readDate('3 Oct 2026').iso, '2026-10-03');
  assert.equal(readDate('31/02/2026'), null);
  assert.equal(readDate('45931').iso, '2025-10-01');
  assert.equal(readNumber('1,240.00').value, 1240);
  assert.equal(readNumber('€1.240,50').value, 1240.5);
  assert.equal(readNumber('(75.50)').value, -75.5);
  assert.ok(readNumber('1,234').ambiguous);
  assert.equal(readNumber('1,234', 'decimal-comma').value, 1.234);
  assert.equal(readNumber('1,234', 'decimal-point').value, 1234);
  assert.equal(readNumber('abc'), null);
});

test('the accounting export: columns mapped in plain words, unneeded columns dropped, only the date order asked', () => {
  const pv = preview({ template: 'invoice-chase', sheet: 'invoices', text: fixture('invoices-accounting-export.csv') });
  assert.deepEqual(pv.mapping, { invoice: 'Invoice No.', customer: 'Client', email: 'Contact email', amount: 'Amount due (EUR)', due: 'Due date', status: 'Status' });
  assert.deepEqual(pv.unused, ['Issued', 'Notes']);
  assert.deepEqual(pv.questions.map(q => q.id), ['dateOrder:due']);
  assert.match(pv.questions[0].question, /Is 03\/10\/2026 the 3rd of October 2026 or March 10th, 2026\?/);
  assert.throws(() => convert({ template: 'invoice-chase', sheet: 'invoices', text: fixture('invoices-accounting-export.csv'), mapping: pv.mapping }), { code: 'CSV_UNANSWERED' });
  const dmy = convert({ template: 'invoice-chase', sheet: 'invoices', text: fixture('invoices-accounting-export.csv'), mapping: pv.mapping, answers: { 'dateOrder:due': 'dmy' } });
  assert.deepEqual(dmy.rows[0], { invoice: 'INV-2041', customer: 'Bramble Cafe', email: 'accounts@bramble-cafe.example', amount: 1240, due: '2026-10-03', status: 'open' });
  assert.deepEqual(Object.keys(dmy.rows[0]), ['invoice', 'customer', 'email', 'amount', 'due', 'status'], 'Notes and Issued are not kept');
  const mdy = convert({ template: 'invoice-chase', sheet: 'invoices', text: fixture('invoices-accounting-export.csv'), mapping: pv.mapping, answers: { 'dateOrder:due': 'mdy' } });
  assert.equal(mdy.rows.find(r => r.invoice === 'INV-2046').due, '2026-08-11', 'the other reading would chase an invoice not yet due');
});

test('statuses Foundry cannot read are asked: which mean "still open"', () => {
  const text = fixture('invoices-odd-statuses.csv');
  const pv = preview({ template: 'invoice-chase', sheet: 'invoices', text });
  const q = pv.questions.find(x => x.id === 'values:status');
  assert.deepEqual(q.choices.map(c => c.value), ['Overdue', 'Part paid', 'Sent']);
  assert.match(q.question, /"Overdue", "Part paid" and "Sent"/);
  const out = convert({ template: 'invoice-chase', sheet: 'invoices', text, mapping: pv.mapping, answers: { 'values:status': ['Overdue', 'Part paid'] } });
  assert.deepEqual(out.rows.map(r => r.status), ['open', 'open', 'paid', 'paid']);
  assert.deepEqual(convert({ template: 'invoice-chase', sheet: 'invoices', text, mapping: pv.mapping, answers: { 'values:status': [] } }).rows.map(r => r.status), ['paid', 'paid', 'paid', 'paid']);
});

test('a missing column is named in plain words; a mapping to a column the file lacks is refused', () => {
  const text = 'Customer,Email\nA,a@x.example\n';
  const pv = preview({ template: 'invoice-chase', sheet: 'invoices', text });
  assert.ok(pv.missing.includes('due'));
  assert.throws(() => convert({ template: 'invoice-chase', sheet: 'invoices', text, mapping: pv.mapping }), { code: 'CSV_MAPPING', message: /due date/ });
  assert.throws(() => convert({ template: 'invoice-chase', sheet: 'invoices', text, mapping: { ...pv.mapping, due: 'Nope' } }), { code: 'CSV_MAPPING' });
});

test('live sheets: written atomically with only the mapped columns; the previous file is kept; practice returns rows only', async () => withApp(async app => {
  const text = fixture('invoices-accounting-export.csv');
  const pv = preview({ template: 'invoice-chase', sheet: 'invoices', text });
  const practice = commit(app, { template: 'invoice-chase', sheet: 'invoices', text, mapping: pv.mapping, answers: { 'dateOrder:due': 'dmy' }, target: 'practice' });
  assert.equal(practice.data.length, 6); assert.equal(liveSheets(app, 'invoice-chase').invoices, null, 'practice writes nothing');
  commit(app, { template: 'invoice-chase', sheet: 'invoices', text, mapping: pv.mapping, answers: { 'dateOrder:due': 'dmy' }, target: 'live' });
  const again = commit(app, { template: 'invoice-chase', sheet: 'invoices', text, mapping: pv.mapping, answers: { 'dateOrder:due': 'dmy' }, target: 'live' });
  assert.equal(again.replaced, true); assert.equal(history(app, 'invoices').length, 1);
  assert.equal(liveSheets(app, 'invoice-chase').invoices.rows, 6);
}));

test('own data in a test: the practice run uses the person\'s rows and says so', async () => withApp(async app => {
  const text = fixture('invoices-accounting-export.csv');
  const pv = preview({ template: 'invoice-chase', sheet: 'invoices', text });
  const rows = commit(app, { template: 'invoice-chase', sheet: 'invoices', text, mapping: pv.mapping, answers: { 'dateOrder:due': 'dmy' }, target: 'practice' }).data;
  const p = await app.propose({ template: 'invoice-chase', settings: { sendSummary: false }, origin: 'site-form' });
  const d = await app.dryRun({ proposalId: p.proposalId, sheets: { invoices: rows }, input: { now: '2026-10-21T09:00:00Z' } });
  assert.equal(d.passed, true); assert.equal(d.dataSource, 'your-data');
  assert.deepEqual(d.wouldDo.map(w => w.to).sort(), ['accounts@bramble-cafe.example', 'billing@northfield-gym.example', 'hello@larkfern.example']);
  const paid = convert({ template: 'invoice-chase', sheet: 'invoices', text: fixture('invoices-all-paid.csv'), mapping: preview({ template: 'invoice-chase', sheet: 'invoices', text: fixture('invoices-all-paid.csv') }).mapping });
  const none = await app.dryRun({ proposalId: p.proposalId, sheets: { invoices: paid.rows }, input: { now: '2026-10-21T09:00:00Z' } });
  assert.equal(none.passed, true, 'nothing to chase is a passing test'); assert.equal(none.wouldDo.length, 0);
}));
