// Tests for arm A1-C v2 (experiments/autobench/harness/v2/, run.mjs --harness codeowned-v2). $0: no model is called;
// model nodes and sessions are scripted stand-ins (harness/v2/codeowned-stubs.mjs). Fixtures are generic and invented
// (no task content). The end-to-end tests need the AutomationBench venv and skip without it.
//   nice -n 15 node --test --test-concurrency=1 experiments/autobench/test/codeowned-v2.test.mjs
// Numbers in test names refer to research/automationbench-20261014/A1C-V2-DESIGN.md §6.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { REPO, VENV_PY, readJson } from '../lib.mjs';
import { runTasks, PIPELINE_HARNESSES } from '../run.mjs';
import * as V1 from '../harness/codeowned.mjs';
import * as V2 from '../harness/v2/codeowned.mjs';
import { valueType, clauseReason, hasValue, sameValue, parseNumber, parseDay, slotOf, fillSlot, quotedIn, identifyingValue, humanRendering } from '../harness/v2/literals.mjs';
import { normalizeLedger, mergeLedgers, applyDecisions, settleByCode, sourceMap, typeLedger, renderLedger, sameEffect, parseJsonReply, findSpan, copyLiteral, ledgerPrompt, LEDGER_SYSTEM } from '../harness/v2/ledger.mjs';
import { postconditionsFromLedger, evaluate, validateMapped, resolveChannel, sameKind, fieldMatches, EFFECTS, observable, pcmapPrompt, kindFor, coOccurring } from '../harness/v2/postconditions.mjs';
import { terminationDecision, briefSection, runChecks, renderChecks } from '../harness/v2/checker.mjs';
import { ENUM_PLAN, dateOf, isLoadStamp, entityTerms, buildInventory, _internalV2 } from '../harness/v2/inventory.mjs';
import { dateOf as dateOfV1 } from '../harness/inventory.mjs';
import { gateConfig, gateRoutes, readGateLog, writeGate, GATE_ENV } from '../harness/v2/gate.mjs';
import { decide, callFacts, decodeRaw, refusalText, routeOf, names } from '../harness/v2/tool-gated.mjs';
import { stubNodeRunner, stubSessionRunner } from '../harness/v2/codeowned-stubs.mjs';

const tmp = p => mkdtempSync(path.join(os.tmpdir(), `autobench-c2-${p}-`));
const HAVE_VENV = existsSync(VENV_PY);
const SCHEMAS = path.join(REPO, 'corpus/AutomationBench/automationbench/tools/api/schemas');
const HAVE_SCHEMAS = existsSync(path.join(SCHEMAS, 'index.txt'));
const quiet = () => {};
const PHONE_TASK = 'simple.email_sf_contact_phone_update';
const V2_DIR = path.join(REPO, 'experiments/autobench/harness/v2');
const GRADING = /assert|rubric|grade|grading|score|partial.credit|oracle|benchmark|automationbench/i;

// ---------------------------------------------------------------------------------------------------------------
// Generic fixtures (invented names; .example addresses)

const rec = (ptr, data, date = null) => ({ ptr, app: ptr.split(':')[0], kind: ptr.split(':')[1], id: ptr.split(':').slice(2).join(':'), date, data });
const BUSINESS_MS = Date.UTC(2026, 1, 3, 9, 0, 0);   // a business date far from the host clock
const INV = {
  connected: ['gmail', 'slack', 'google_sheets', 'google_drive', 'salesforce', 'trello'], outOfScope: ['xero'], truncated: [], precedents: [], records: [
    rec('gmail:message:g1', { from: 'controller@orchid.example', to: ['ops@orchid.example'], subject: 'Vendor summary rules', body_plain: 'Use the subject "Quarterly Vendor Summary". Vendors on hold are left out of every summary.', date: BUSINESS_MS }, '2026-02-03T09:00:00.000Z'),
    rec('slack:channel_list:C9', { id: 'C9', name: 'ledger-ops' }),
    rec('slack:channel_list:D7', { id: 'D7', is_im: true, user: 'U5' }),
    rec('slack:user_list:U5', { id: 'U5', name: 'mbrandt', real_name: 'Mara Brandt', profile: { email: 'mara.brandt@orchid.example' } }),
    rec('google_sheets:row:ssV/Vendors#2', { spreadsheet: 'Vendors', spreadsheetId: 'ssV', worksheet: 'Vendors', row: 2, name: 'Quillfeather Supply', Status: 'Active', Total: '1,250.00' }),
    rec('google_sheets:row:ssV/Vendors#3', { spreadsheet: 'Vendors', spreadsheetId: 'ssV', worksheet: 'Vendors', row: 3, name: 'Brackenridge Tools', Status: 'On Hold', Total: '980.00' }),
    rec('salesforce:Contact:C01', { Id: 'C01', Name: 'Tamsin Oakes', Email: 'tamsin.oakes@orchid.example', Phone: '555-0142', Title: 'Buyer' }),
    rec('salesforce:Contact:C02', { Id: 'C02', Name: 'Ivo Marchetti', Email: 'ivo.marchetti@orchid.example', Phone: '555-0177', Title: 'Buyer' }),
    rec('trello:cards:k1', { id: 'k1', name: 'Dock repair', idBoard: 'b1', desc: 'Replace the hinge' }),
  ] };
const REQUEST = 'Send the quarterly vendor summary to finance-lead@orchid.example and post the totals in #ledger-ops.';
const SYSTEM = 'You automate office work. In summaries, name only the items you acted on; leave out the items you skipped.';
const SRC = sourceMap(REQUEST, INV, { system: SYSTEM });
const P = V2.PIPELINE_DEFAULTS;
const reader = (k, reqs, today = null) => normalizeLedger({ today, requirements: reqs }, SRC, { reader: k });
const summary = (extra = {}) => ({ id: 'R1', polarity: 'positive', action: 'send_email', app: 'gmail', target: 'finance-lead@orchid.example', statement: 'Email the quarterly vendor summary', source: 'request',
  fields: [{ name: 'to', quote: 'finance-lead@orchid.example', source: 'request' }, { name: 'subject', quote: 'Quarterly Vendor Summary', source: 'gmail:message:g1' }, { name: 'body', quote: 'Quillfeather Supply', source: 'google_sheets:row:ssV/Vendors#2' }],
  candidates: [{ record: 'google_sheets:row:ssV/Vendors#2', eligible: true, deciding_field: 'Status', value: 'Active', rule_source: 'gmail:message:g1' }, { record: 'google_sheets:row:ssV/Vendors#3', eligible: false, deciding_field: 'Status', value: 'On Hold', rule_source: 'gmail:message:g1' }], ...extra });
const compile = (ledgers, inv = INV, src = SRC) => { const m = mergeLedgers(ledgers, { sources: src }); typeLedger(m, src, inv, P); return { m, pcs: postconditionsFromLedger(m, inv, { sources: src, P }) }; };

// ---------------------------------------------------------------------------------------------------------------
// 1. Termination: single pass

test('1 termination: with maxRounds 0 a hard failure never starts a repair; the reason says "single pass"', () => {
  const res = (hard, pass) => ({ pc: { hard }, pass });
  const base = { responsesUsed: 20, maxResponses: 50, stepsUsed: 10, maxWorldSteps: 49, round: 0, maxRounds: 0, usdLeft: 0.5, msLeft: 600_000 };
  assert.deepEqual(terminationDecision({ ...base, results: [res(true, false), res(true, false)] }), { repair: false, reason: 'single pass (repairs off): 2 hard check(s) fail', failing: 2, category: 'hard-fail', undecided: 0 });
  assert.deepEqual(terminationDecision({ ...base, results: [res(true, true)] }), { repair: false, reason: 'all checks pass', category: 'all-pass', undecided: 0 });
  assert.equal(terminationDecision({ ...base, results: [res(false, false)] }).reason, 'only advisory checks fail');
  // maxRounds > 0 keeps v1's semantics (not evaluated in v2).
  assert.equal(terminationDecision({ ...base, maxRounds: 2, results: [res(true, false)] }).repair, true);
  assert.equal(P.maxRounds, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Value typing

test('2 value typing: clauses, imperatives, modals, restatements and over-long column values are not values; names, ids, amounts, dates, quoted wording are', () => {
  const st = 'Email the quarterly vendor summary to the finance lead with each active vendor total';
  assert.equal(valueType('Please include every vendor total and the quarter end date in the body', { statement: st }).type, 'clause');   // >= 9 words
  assert.match(clauseReason('Totals attached. Review them'), /sentence break/);
  assert.match(clauseReason('Send the summary'), /imperative/);
  assert.match(clauseReason('totals must match'), /modal/);
  assert.match(clauseReason('the vendor summary to finance', { statement: 'Email the vendor summary to finance' }), /restates/);
  assert.equal(clauseReason('Quarterly Vendor Summary', { statement: 'Email the Quarterly Vendor Summary' }), null);        // a short value may share words
  assert.match(clauseReason('Replace the hinge and repaint the outer frame twice', { recordField: true, columnValues: ['Fix hinge'], clauseWords: 20 }), /longer than 3x/);
  for (const [v, t] of [['Tamsin Oakes', 'short'], ['INV-4471', 'id'], ['$1,250.00', 'number'], ['2026-02-03', 'date'], ['March 3, 2026', 'date'], ['tamsin.oakes@orchid.example', 'email']]) assert.equal(valueType(v).type, t, v);
  // Quoted wording, or a phrase after a cue, is exact wording even when long.
  const src = 'Use the subject "Quarterly Vendor Summary for the board and the regional leads". Then sign it with the phrase thanks for keeping our books clean this quarter';
  assert.equal(valueType('Quarterly Vendor Summary for the board and the regional leads', { sourceText: src }).type, 'quoted');
  assert.equal(quotedIn('thanks for keeping our books clean this quarter', src), true);
  assert.equal(valueType('thanks for keeping our books clean this quarter', { sourceText: src }).accepted, true);
  // Slots: placeholders and alternatives.
  assert.equal(slotOf('<vendor name>').kind, 'placeholder');
  assert.equal(slotOf('[Date]').kind, 'placeholder');
  assert.equal(slotOf('Hello <first name>, thanks').kind, 'template');
  assert.equal(slotOf('Approved/Rejected').kind, 'alternatives');
  assert.equal(slotOf('Approved or Rejected').kind, 'alternatives');
  assert.equal(slotOf('03/05/2026'), null);
  assert.deepEqual(fillSlot(slotOf('<vendor name>'), { name: 'Quillfeather Supply', Status: 'Active' }), { value: 'Quillfeather Supply', field: 'name' });
  assert.deepEqual(fillSlot(slotOf('Active or Paused'), { Status: 'Active' }), { value: 'Active', field: 'Status' });
  assert.equal(fillSlot(slotOf('<invoice number>'), { name: 'Quillfeather Supply' }), null);
});

test('2 value typing over a ledger: a slot is filled from the single eligible candidate or demoted; hardness is the minimum of item and field support; clauses never reach a check', () => {
  const withSlot = summary({ fields: [{ name: 'to', quote: 'finance-lead@orchid.example', source: 'request' }, { name: 'body', quote: '<vendor name>', source: 'request' }, { name: 'body', quote: 'Send the vendor summary every quarter to the finance lead please', source: 'request' }] });
  const src = sourceMap(`${REQUEST} Body: <vendor name>. Send the vendor summary every quarter to the finance lead please.`, INV, { system: SYSTEM });
  let { m, pcs } = compile([1, 2, 3].map(k => normalizeLedger({ requirements: [withSlot] }, src, { reader: k })), INV, src);
  const body = m.items[0].fields.filter(f => f.name === 'body');
  assert.equal(body[0].value, 'Quillfeather Supply');
  assert.deepEqual(body[0].slotFilled, { from: 'google_sheets:row:ssV/Vendors#2', field: 'name' });
  assert.equal(body[1].vtype, 'clause');
  assert.deepEqual(pcs[0].params.body, ['Quillfeather Supply']);
  assert.ok(!JSON.stringify(pcs).includes('every quarter to the finance lead'));
  // Two eligible candidates: the slot cannot be filled from one record, so it is demoted (shown as fill-from-record).
  const two = { ...withSlot, candidates: withSlot.candidates.map(c => ({ ...c, eligible: true })) };
  ({ m, pcs } = compile([1, 2, 3].map(k => normalizeLedger({ requirements: [two] }, src, { reader: k })), INV, src));
  assert.equal(m.items[0].fields.find(f => f.slot === undefined && f.vtype === 'slot').demoted, 'unfilled slot');
  assert.match(renderLedger(m), /body=\(fill from the record\)/);
  assert.deepEqual(pcs[0].params.body, []);
  // Per-literal hardness: a body value only one of three readers wrote is soft even on a majority item.
  ({ m, pcs } = compile([reader(1, [summary()]), reader(2, [summary({ fields: summary().fields.slice(0, 2) })]), reader(3, [summary({ fields: summary().fields.slice(0, 2) })])]));
  assert.equal(m.items[0].support, 3);
  assert.deepEqual(pcs[0].params.subject, ['Quarterly Vendor Summary']);
  assert.deepEqual(pcs[0].params.body, []);
  assert.ok(pcs[0].soft.some(s => s.value === 'Quillfeather Supply'));
  assert.match(renderLedger(m), /may mention \(no source requires it; use only where it belongs, never as a bare list\): "Quillfeather Supply"/);
});

test('2 co-occurrence (record and row checks only) and sheet-wide values (one check)', () => {
  // Row values from two different source records: only the record that covers the most is kept.
  const row = (k, values) => ({ id: `R${k}`, polarity: 'positive', action: 'add_row', app: 'google_sheets', target: 'google_sheets:spreadsheet:ssV', statement: `log vendor ${k}`, source: 'request', fields: values.map(([n, q, s]) => ({ name: n, quote: q, source: s })) });
  const mixed = row(1, [['vendor', 'Quillfeather Supply', 'google_sheets:row:ssV/Vendors#2'], ['total', '1,250.00', 'google_sheets:row:ssV/Vendors#2'], ['contact', 'Ivo Marchetti', 'salesforce:Contact:C02']]);
  let { pcs } = compile([1, 2, 3].map(k => reader(k, [mixed])));
  assert.deepEqual(pcs[0].params.values, ['Quillfeather Supply', '1,250.00']);
  assert.ok(pcs[0].soft.some(s => s.value === 'Ivo Marchetti' && /same source record/.test(s.why)));
  // Messages are not subject to co-occurrence: body values from two records stay.
  const msg = summary({ fields: [{ name: 'to', quote: 'finance-lead@orchid.example', source: 'request' }, { name: 'body', quote: 'Quillfeather Supply', source: 'google_sheets:row:ssV/Vendors#2' }, { name: 'body', quote: 'Tamsin Oakes', source: 'salesforce:Contact:C01' }] });
  ({ pcs } = compile([1, 2, 3].map(k => reader(k, [msg]))));
  assert.deepEqual(pcs[0].params.body, ['Quillfeather Supply', 'Tamsin Oakes']);
  // A value most row items of one spreadsheet share becomes one sheet-wide check (each row keeps its own values).
  const rows = ['Quillfeather Supply', 'Brackenridge Tools', 'Tamsin Oakes'].map((n, i) => row(i + 1, [['vendor', n, 'request'], ['quarter', 'Q1', 'request']]));
  const src = sourceMap('Log Quillfeather Supply, Brackenridge Tools and Tamsin Oakes in google_sheets:spreadsheet:ssV for Q1.', INV, { system: SYSTEM });
  ({ pcs } = compile([1, 2, 3].map(k => normalizeLedger({ requirements: rows }, src, { reader: k })), INV, src));
  const sheet = pcs.filter(p => p.type === 'sheet_row');
  assert.equal(sheet.filter(p => p.params.values.includes('Q1')).length, 1);
  assert.deepEqual(sheet.find(p => p.params.values.includes('Q1')).params.values, ['Q1']);
  assert.equal(sheet.length, 4);
  assert.equal(pcs.stats.sheetWide, 1);
  assert.equal(coOccurring([], {}, new Map()).keep.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Tolerance

test('3 tolerance: numbers as numbers, dates by day across formats; "1,000" and "1000" from two readers are one value', () => {
  for (const v of ['1000', '1,000', '$1,000.00', '1000.004']) assert.equal(sameValue(v, '1,000'), true, v);
  assert.equal(sameValue('1,000.01', '1000'), false);
  assert.equal(parseNumber('(5,200)'), -5200);
  assert.equal(hasValue('Total due: $1,000.00 by Friday', '1000'), true);
  assert.equal(hasValue('Total due: $21,000', '1,000'), false);                  // not found inside a larger number
  for (const d of ['2026-03-05', 'March 5, 2026', '5 March 2026', '03/05/2026', 'Mar 5, 2026', '2026-03-05T14:00:00Z']) assert.equal(parseDay(d), '2026-03-05', d);
  assert.equal(hasValue('Due on 5 March 2026.', '2026-03-05'), true);
  assert.equal(sameValue('2026-03-05', 'March 5, 2026'), true);
  const upd = (k, v) => reader(k, [{ id: 'R1', polarity: 'positive', action: 'update_record', app: 'salesforce', target: 'salesforce:Contact:C01', statement: 'set the credit limit', source: 'request', fields: [{ name: 'credit_limit', derived: { value: v, method: 'sum', inputs: [{ quote: '1,250.00', source: 'google_sheets:row:ssV/Vendors#2' }] } }] }]);
  const m = mergeLedgers([upd(1, '1,000'), upd(2, '1000'), upd(3, '1000.00')], { sources: SRC });
  assert.equal(m.conflicts.length, 0);
  assert.equal(m.items[0].fields.length, 1);
  assert.equal(m.items[0].fields[0].support, 3);
});

// ---------------------------------------------------------------------------------------------------------------
// 4. The effect table and app-faithful compile

test('4 effect table: every row traces to the shipped index, every index app is present, the generator reads only the schemas', { skip: !HAVE_SCHEMAS && 'AutomationBench schemas missing' }, () => {
  const index = readFileSync(path.join(SCHEMAS, 'index.txt'), 'utf8').split('\n').filter(Boolean).map(l => l.split('\t'));
  const lines = new Set(index.map(([a, op, m, p]) => `${a}\t${op}\t${m}\t${p}`));
  for (const r of EFFECTS.rows) assert.ok(lines.has(`${r.app}\t${r.op}\t${r.method}\t${r.path}`), r.op);
  assert.deepEqual([...new Set(EFFECTS.rows.map(r => r.app))].sort(), [...new Set(index.map(l => l[0]))].sort());
  assert.equal(EFFECTS.rows.length, index.length);
  assert.match(EFFECTS.source.indexTxtSha256, /^[0-9a-f]{64}$/);
  const gen = readFileSync(path.join(V2_DIR, 'build-effects.mjs'), 'utf8');
  assert.doesNotMatch(gen.replace(/^\s*\/\/.*$/gm, ''), /impl\/|rubric|domains\/|tasks\.py|readFileSync\((?!path\.join\(schemas|OUT|raw)/);
  // The committed table is the generator's current output.
  const r = spawnSync(process.execPath, [path.join(V2_DIR, 'build-effects.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  // Messaging channels come from one stated rule (build-effects.mjs MESSAGING_RULE; codeowned-v2-review.test.mjs m1); an
  // outgoing channel makes a send, an internal note stays a create.
  assert.deepEqual([...new Set(EFFECTS.rows.filter(x => x.channel).map(x => x.channel))].sort(), ['chat', 'dm', 'email', 'esign', 'note', 'reply', 'sms', 'social']);
  assert.ok(EFFECTS.rows.filter(x => x.channel && x.channel !== 'note').every(x => x.effect === 'send'));
  assert.ok(EFFECTS.rows.filter(x => x.channel === 'note').every(x => x.effect === 'create'));
});

test('4 app-faithful compile: a post compiles to its own app (never Slack for another app); kinds ignore case and plural; a comment on a record is child_created; lists use membership; a DM resolves to the im channel; no predicate is judged', () => {
  const post = (app, extra = {}) => ({ id: 'R1', polarity: 'positive', action: 'post_message', app, target: app === 'slack' ? '#ledger-ops' : 'the company page', statement: `post the quarterly totals on ${app}`, source: 'request', fields: [{ name: 'text', quote: 'Quillfeather Supply', source: 'google_sheets:row:ssV/Vendors#2' }], ...extra });
  let { pcs } = compile([1, 2, 3].map(k => reader(k, [post('twitter')])));
  assert.equal(pcs[0].type, 'channel_posted');
  assert.equal(pcs[0].params.app, 'twitter');
  ({ pcs } = compile([1, 2, 3].map(k => reader(k, [post('slack')]))));
  assert.equal(pcs[0].type, 'slack_posted');
  assert.deepEqual(pcs[0].params.channel, { id: 'C9', name: 'ledger-ops' });
  ({ pcs } = compile([1, 2, 3].map(k => reader(k, [post('asana')]))));
  assert.equal(pcs[0].type, 'judged');                                          // asana has no messaging operation
  assert.ok(!pcs.some(p => p.type.startsWith('slack')));
  // A DM to a Slack member goes to that member's im channel.
  assert.deepEqual(resolveChannel('@mbrandt', INV), { id: 'D7', name: '@mbrandt', dm: true, user: 'U5' });
  assert.deepEqual(resolveChannel('Mara Brandt', INV).id, 'D7');
  assert.deepEqual(resolveChannel('#ledger-ops', INV), { id: 'C9', name: 'ledger-ops' });
  // Kinds: case-insensitive, singular or plural; the listing's kind is used.
  assert.equal(sameKind('Tasks', 'task'), true);
  assert.equal(sameKind('cards', 'Card'), true);
  assert.equal(sameKind('event_list', 'Events'), true);                         // a '<kind>_list' listing holds <kind> records
  assert.equal(sameKind('cards', 'card_note'), false);
  // A kind named with its parent kind is the child kind, in the listing's name.
  const cal = { ...INV, connected: [...INV.connected, 'google_calendar'], records: [...INV.records, rec('google_calendar:calendar_list:team', { id: 'team', summary: 'Team' }), rec('google_calendar:event_list:e1', { id: 'e1', summary: 'Standup' })] };
  assert.deepEqual(kindFor({ app: 'google_calendar', target: 'the team calendar', statement: 'Create a calendar event for the dock inspection' }, cal), { kind: 'event_list', parent: { param: 'calendarId', kind: 'calendar' } });
  // A child kind whose listing never names a parent (events listed per calendar) cannot tie a new record to its parent:
  // unobservable either way (review of 2026-10-21; it used to pass any new record of the kind).
  const ev = { id: 'P9', type: 'child_created', hard: true, params: { parent: 'google_calendar:calendar_list:team', kind: 'event_list', values: ['Dock inspection'] } };
  assert.equal(evaluate(ev, cal, { ...cal, records: [...cal.records, rec('google_calendar:event_list:e2', { id: 'e2', summary: 'Dock inspection' })] }).pass, null);
  assert.equal(evaluate(ev, cal, cal).unobservable, true);
  // Where the listing does name the parent, a new record must name this one.
  const tk = { records: [rec('zendesk:tickets:7', { id: 7 }), rec('zendesk:tickets:8', { id: 8 }), rec('zendesk:comments:c1', { id: 'c1', ticket: 8, body: 'old' })] };
  const cm = { id: 'P10', type: 'child_created', hard: true, params: { parent: 'zendesk:tickets:7', kind: 'comment', values: ['Replace the hinge'] } };
  assert.equal(evaluate(cm, tk, { records: [...tk.records, rec('zendesk:comments:c2', { id: 'c2', ticket: 8, body: 'Replace the hinge' })] }).pass, false);
  assert.equal(evaluate(cm, tk, { records: [...tk.records, rec('zendesk:comments:c3', { id: 'c3', ticket: 7, body: 'Replace the hinge' })] }).pass, true);
  assert.deepEqual(kindFor({ app: 'salesforce', target: 'a new follow-up task', statement: 'Create a task for the contact' }, INV), { kind: 'task', parent: null });
  // A comment on an existing card is a child record.
  const comment = { id: 'R1', polarity: 'positive', action: 'create_record', app: 'trello', target: 'trello:cards:k1', statement: 'add a comment to the dock repair card', source: 'request', fields: [{ name: 'text', quote: 'Replace the hinge', source: 'trello:cards:k1' }] };
  ({ pcs } = compile([1, 2, 3].map(k => reader(k, [comment]))));
  assert.equal(pcs[0].type, 'child_created');
  assert.deepEqual(pcs[0].params, { parent: 'trello:cards:k1', kind: 'comment', values: ['Replace the hinge'] });
  // A row added in another app than the spreadsheets is a record of that app, never a sheet row.
  const boardRow = { id: 'R1', polarity: 'positive', action: 'add_row', app: 'trello', target: 'a new card on the board', statement: 'add a card for the dock repair', source: 'request', fields: [{ name: 'name', quote: 'Dock repair', source: 'trello:cards:k1' }] };
  ({ pcs } = compile([1, 2, 3].map(k => reader(k, [boardRow]))));
  assert.equal(pcs[0].type, 'record_created');
  assert.equal(pcs[0].params.app, 'trello');
  // A list field passes on membership; long text on containment.
  assert.equal(fieldMatches(['urgent', 'vendor'], 'vendor'), true);
  assert.equal(fieldMatches([{ name: 'vendor' }], 'vendor'), true);
  const long = 'Replace the hinge on the north loading dock door before the safety inspection next week';
  assert.equal(fieldMatches(`${long}, then sign the log.`, long), true);
  assert.equal(fieldMatches('Replace the hinge', 'Replace the hinge on the north door'), false);
  // The mapping prompt lists the new types and asks for the requirement's own app.
  const pm = pcmapPrompt({ items: [], inventoryText: '' });
  assert.match(pm, /channel_posted/);
  assert.match(pm, /in the requirement's own app/);
  assert.doesNotMatch(pm, GRADING);
  // A mapped check in another app than the requirement's is refused.
  const item = { app: 'twitter', statement: 'post the totals', fields: [] };
  assert.equal(validateMapped({ type: 'slack_posted', params: { channel: 'ledger-ops', text: [] } }, SRC, INV, { item }), null);
  assert.ok(validateMapped({ type: 'channel_posted', params: { app: 'twitter', text: ['Quillfeather Supply'] } }, SRC, INV, { item }));
});

// ---------------------------------------------------------------------------------------------------------------
// 5. Unobservable checks

test('5 unobservable: a check on an app the re-read cannot list is null with no checker call; it counts as nullHard', async () => {
  assert.equal(observable('notion'), false);
  assert.equal(observable('google_sheets'), true);
  const pcs = [{ id: 'P1', item: 'M1', type: 'record_created', hard: true, app: 'notion', params: { app: 'notion', kind: 'page', values: ['Dock repair'] }, statement: 's', source: 'request' },
    { id: 'P2', item: 'M2', type: 'judged', hard: true, app: 'notion', params: {}, statement: 'a page exists', source: 'request' }];
  let judged = 0;
  const client = { batch: async () => { throw new Error('no world step expected'); }, log: [] };
  const chk = await runChecks({ client, inv: INV, pcs, judge: async () => { judged += 1; return null; } });
  assert.equal(judged, 0);
  assert.deepEqual(chk.results.map(r => [r.pass, r.evidence, r.observable]), [[null, 'unobservable', false], [null, 'unobservable', false]]);
  assert.equal(chk.results.filter(r => r.pc.hard && r.pass === null).length, 2);       // the round row's nullHard
  assert.doesNotMatch(renderChecks(pcs), /observable/);                           // observability stays host-side
  // An app whose listing shows only the account (no posts) cannot observe a missing post; one that lists posts can.
  const post = { id: 'P3', type: 'channel_posted', hard: true, params: { app: 'twitter', channel: null, text: ['Quillfeather'], bodyNot: [] } };
  const before = { records: [rec('twitter:me:u1', { id: 'u1', username: 'orchid' })] };
  assert.equal(evaluate(post, before, before).unobservable, true);
  const fb = { ...post, params: { ...post.params, app: 'facebook_pages' } };
  const feed = { records: [rec('facebook_pages:feed:f1', { id: 'f1', message: 'old news', page: 'pg1' })] };
  // A Facebook post may be a feed post or a photo (the kinds its post operations create; re-review 2026-10-21 minor 5):
  // with only the feed listed, a missing post is undecided; with both listed, it fails; a new feed post decides.
  assert.equal(evaluate(fb, feed, feed).unobservable, true);
  const both = { records: [...feed.records, rec('facebook_pages:photos:p1', { id: 'p1', name: 'old photo', page: 'pg1' })] };
  assert.equal(evaluate(fb, both, both).pass, false);
  assert.equal(evaluate(fb, feed, { records: [...feed.records, rec('facebook_pages:feed:f2', { id: 'f2', message: 'Quillfeather joins', page: 'pg1' })] }).pass, true);
  // A direct message posted in an im channel the work opened is found through the member.
  const dm = { id: 'P4', type: 'slack_posted', hard: true, params: { channel: { id: null, name: '@ivo', dm: true, user: 'U9' }, text: ['Quillfeather'], bodyNot: [] } };
  const b0 = { records: [rec('slack:channel_list:C9', { id: 'C9', name: 'ledger-ops' })] };
  const a0 = { records: [...b0.records, rec('slack:channel_list:D9', { id: 'D9', is_im: true, user: 'U9' }), rec('slack:message:D9/1.0', { channel: 'D9', text: 'Quillfeather Supply is confirmed' })] };
  assert.equal(evaluate(dm, b0, a0).pass, true);
  assert.equal(evaluate(dm, b0, { records: [...b0.records, rec('slack:message:C9/2.0', { channel: 'C9', name: 'ledger-ops', text: 'Quillfeather' })] }).pass, false);
});

// ---------------------------------------------------------------------------------------------------------------
// 6-8. Typed negatives, satisfiability, standing rules

const contentNeg = (k, extra = {}) => ({ id: 'N1', polarity: 'negative', scope: 'content', limits: 'R1', action: 'send_email', app: 'gmail', target: 'finance-lead@orchid.example', statement: 'leave on-hold vendors out of the summary', source: 'gmail:message:g1',
  rule_quote: 'Vendors on hold are left out of every summary', rule_source: 'gmail:message:g1', leave_out: [{ quote: 'Brackenridge Tools', source: 'google_sheets:row:ssV/Vendors#3' }], ...extra });

test('6 typed negatives: a content negative attaches to its positive as a body ban (never a polarity conflict) and adjudication cannot supersede it; an effect negative still conflicts', () => {
  let { m, pcs } = compile([1, 2, 3].map(k => reader(k, [summary(), contentNeg(k)])));
  assert.equal(m.items.length, 1);
  assert.equal(m.conflicts.filter(c => c.kind === 'polarity').length, 0);
  assert.deepEqual(m.items[0].exclusions.map(e => [e.literal, e.support, e.hard]), [['Brackenridge Tools', 3, true]]);
  assert.equal(pcs[0].type, 'gmail_sent');
  assert.deepEqual(pcs[0].params.bodyNot, ['Brackenridge Tools']);
  assert.match(renderLedger(m), /leave out of this item: "Brackenridge Tools" \(rule gmail:message:g1: "Vendors on hold are left out of every summary"\)/);
  // An effect negative on the same recipient is a polarity conflict; a decision for it never supersedes the content-limited positive.
  const effectNeg = { id: 'N2', polarity: 'negative', scope: 'effect', action: 'send_email', app: 'gmail', target: 'finance-lead@orchid.example', statement: 'do not email the lead', source: 'gmail:message:g1', rule_quote: 'Vendors on hold are left out of every summary', rule_source: 'gmail:message:g1' };
  m = mergeLedgers([1, 2, 3].map(k => reader(k, [summary(), contentNeg(k), effectNeg])), { sources: SRC });
  const pol = m.conflicts.filter(c => c.kind === 'polarity');
  assert.equal(pol.length, 1);
  applyDecisions(m, [{ conflict: pol[0], choice: pol[0].options[1], by: 'adjudication' }]);
  assert.equal(m.items.find(i => i.polarity === 'positive').superseded, undefined);
  assert.match(m.adjudications[0].kept, /content-limited/);
  // Without a scope a negative is an effect negative (v1's reading).
  const L = reader(1, [{ ...effectNeg, scope: undefined }]);
  assert.equal(L.requirements[0].scope, 'effect');
});

test('7 satisfiability: a ban on a required recipient is dropped and logged; exclusions from a fixed-recipient summary are body bans, not recipient bans', () => {
  // A summary to a fixed recipient: the ineligible vendor never becomes a recipient ban.
  let { pcs } = compile([1, 2, 3].map(k => reader(k, [summary(), contentNeg(k)])));
  assert.ok(!pcs.some(p => p.type === 'gmail_not_sent'));
  // Recipients drawn from candidates: the ineligible candidates are recipient bans (v1 behaviour kept there).
  const each = { id: 'R2', polarity: 'positive', action: 'send_email', app: 'gmail', target: 'each active buyer', statement: 'email each active buyer', source: 'request', fields: [],
    candidates: [{ record: 'salesforce:Contact:C01', eligible: true, deciding_field: 'Title', value: 'Buyer', rule_source: 'request' }, { record: 'salesforce:Contact:C02', eligible: false, deciding_field: 'Title', value: 'Buyer', rule_source: 'request' }] };
  ({ pcs } = compile([1, 2, 3].map(k => reader(k, [each]))));
  assert.deepEqual(pcs.map(p => [p.type, p.params.to]), [['gmail_sent', ['tamsin.oakes@orchid.example']], ['gmail_not_sent', ['ivo.marchetti@orchid.example']]]);
  // A hard ban on an address a required message goes to cannot hold: dropped and logged.
  const ban = { id: 'N3', polarity: 'negative', action: 'send_email', app: 'gmail', target: 'finance-lead@orchid.example', statement: 'never email finance-lead', source: 'gmail:message:g1', rule_quote: 'Vendors on hold are left out of every summary', rule_source: 'gmail:message:g1' };
  const m = mergeLedgers([1, 2, 3].map(k => reader(k, [summary(), ban])), { sources: SRC });
  applyDecisions(m, settleByCode(m.conflicts, SRC).settled.map(s => ({ conflict: s.conflict, choice: s.choice, by: 'code' })));
  typeLedger(m, SRC, INV, P);
  pcs = postconditionsFromLedger(m, INV, { sources: SRC, P });
  assert.ok(!pcs.some(p => p.type === 'gmail_not_sent'));
  assert.deepEqual(pcs.satisfiability.map(s => [s.dropped, s.addresses]), [['gmail_not_sent', ['finance-lead@orchid.example']]]);
});

test('8 standing rule: a reader item citing the standing instructions excludes the out-of-scope candidates; without it nothing is excluded; in-scope names and asked-for notices are exempt', () => {
  const sysNeg = k => ({ id: 'N1', polarity: 'negative', scope: 'content', limits: 'R1', action: 'send_email', app: 'gmail', target: 'finance-lead@orchid.example', statement: 'name only acted-on items', source: 'system', rule_quote: 'name only the items you acted on', rule_source: 'system', leave_out: [] });
  let { m, pcs } = compile([1, 2, 3].map(k => reader(k, [summary(), sysNeg(k)])));
  assert.deepEqual(m.items[0].exclusions.map(e => [e.literal, e.standing, e.hard]), [['Brackenridge Tools', true, true]]);
  assert.deepEqual(pcs[0].params.bodyNot, ['Brackenridge Tools']);
  // Without a reader item citing the system text: nothing (no code constant ever excludes).
  ({ m, pcs } = compile([1, 2, 3].map(k => reader(k, [summary()]))));
  assert.deepEqual(m.items[0].exclusions, []);
  assert.deepEqual(pcs[0].params.bodyNot, []);
  // A source asks for the exclusion notice (asked_by on that value): no ban.
  const notice = summary({ fields: [...summary().fields, { name: 'body', quote: 'Brackenridge Tools', source: 'google_sheets:row:ssV/Vendors#3', asked_by: { quote: 'Vendors on hold are left out of every summary', source: 'gmail:message:g1' } }] });
  ({ m } = compile([1, 2, 3].map(k => reader(k, [notice, sysNeg(k)]))));
  assert.deepEqual(m.items[0].exclusions, []);
  // A ban that overlaps an in-scope candidate's identifying value is dropped.
  const inv2 = { ...INV, records: INV.records.map(r => (r.ptr === 'google_sheets:row:ssV/Vendors#3' ? rec(r.ptr, { ...r.data, name: 'Quillfeather' }) : r)) };
  const src2 = sourceMap(REQUEST, inv2, { system: SYSTEM });
  const m2 = mergeLedgers([1, 2, 3].map(k => normalizeLedger({ requirements: [summary(), sysNeg(k)] }, src2, { reader: k })), { sources: src2 });
  typeLedger(m2, src2, inv2, P);
  assert.deepEqual(m2.items[0].exclusions, []);
  assert.match(m2.items[0].droppedExclusions[0].why, /overlaps/);
  // The ledger prompt shows the standing instructions with their pointer and asks for typed negatives.
  const lp = ledgerPrompt({ request: REQUEST, system: SYSTEM, inventoryText: '(records)' });
  assert.ok(lp.startsWith(`<system>\n${SYSTEM}\n</system>\n\n<request>\n${REQUEST}\n</request>`));
  assert.match(lp, /its pointer is "system"/);
  assert.match(lp, /"scope" \(negative items only\)/);
  assert.match(lp, /"asked_by"/);
  for (const s of [lp, LEDGER_SYSTEM]) assert.doesNotMatch(s, GRADING);
});

// ---------------------------------------------------------------------------------------------------------------
// 9. The gated client

const b64url = s => Buffer.from(s, 'utf8').toString('base64url');
const sendMail = (to, body, { subject = 'Quarterly Vendor Summary', cte = null } = {}) => ({ name: 'api_fetch', arguments: JSON.stringify({ method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', params: null,
  body: JSON.stringify({ raw: b64url(`To: ${to}\r\nSubject: ${subject}\r\n${cte ? `Content-Transfer-Encoding: ${cte}\r\n` : ''}\r\n${body}`) }) }) });
const read = { name: 'api_fetch', arguments: JSON.stringify({ method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages', params: null, body: null }) };
const GATE_PCS = [{ id: 'P1', item: 'M1', type: 'gmail_sent', hard: true, params: { to: ['finance-lead@orchid.example'], cc: [], subject: [], body: [], bodyNot: ['Brackenridge Tools'] } },
  { id: 'P2', item: 'M2', type: 'slack_posted', hard: true, params: { channel: { id: 'C9', name: 'ledger-ops' }, text: [], bodyNot: ['Brackenridge Tools'] } }];
const GATE_MERGED = { items: [{ id: 'M1', exclusions: [{ literal: 'Brackenridge Tools', rule: { source: 'gmail:message:g1', quote: 'Vendors on hold are left out of every summary' } }] }, { id: 'M2', exclusions: [{ literal: 'Brackenridge Tools', rule: { source: 'gmail:message:g1', quote: 'Vendors on hold are left out of every summary' } }] }] };
const CFG = gateConfig(GATE_PCS, { merged: GATE_MERGED, perPair: 1, perSession: 2 });

test('9 gate decisions: routes, MIME decoding, refusals, identical resends, per-pair and per-session caps, batches, undecodable calls', () => {
  assert.ok(gateRoutes().length > 10);
  assert.equal(routeOf('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', CFG.routes)?.op, 'gmail.users.messages.send');
  assert.equal(routeOf('POST', 'https://www.googleapis.com/gmail/v1/users/me/messages/send', CFG.routes)?.op, 'gmail.users.messages.send');
  assert.equal(routeOf('POST', 'https://slack.com/api/chat.postMessage', CFG.routes)?.op, 'slack.chat.postMessage');
  assert.equal(routeOf('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages', CFG.routes), null);
  // MIME: base64url raw, multipart, quoted-printable, base64 parts, encoded subject.
  const mp = `To: a@orchid.example, finance-lead@orchid.example\r\nCc: c@orchid.example\r\nSubject: =?utf-8?B?${Buffer.from('Résumé Brackenridge').toString('base64')}?=\r\nContent-Type: multipart/alternative; boundary="zz"\r\n\r\n--zz\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nTotals for Bracken=\r\nridge Tools =E2=80=94 980\r\n--zz\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from('<p>html</p>').toString('base64')}\r\n--zz--\r\n`;
  const d = decodeRaw(b64url(mp));
  assert.deepEqual(d.to, ['a@orchid.example', 'finance-lead@orchid.example']);
  assert.deepEqual(d.cc, ['c@orchid.example']);
  assert.match(d.subject, /Résumé Brackenridge/);
  assert.match(d.text, /Brackenridge Tools — 980/);
  assert.doesNotMatch(d.text, /html/);
  assert.equal(decodeRaw('!!not base64!!'), null);
  assert.equal(decodeRaw(b64url('no headers at all')), null);
  // A call that does not decode passes.
  const bad = { name: 'api_fetch', arguments: JSON.stringify({ method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', body: JSON.stringify({ raw: '%%%' }) }) };
  assert.equal(callFacts(bad, CFG.routes), null);
  assert.deepEqual(decide([bad], CFG).map(x => x.action), ['send']);
  // Word-boundary matching: a ban does not fire inside another word.
  assert.equal(names('Brackenridge Toolsmiths', 'Brackenridge Tools'), false);
  assert.equal(names('see BRACKENRIDGE   tools.', 'Brackenridge Tools'), true);
  // Refuse once per (rule, recipient); an identical resend is sent; a different violating call to the same pair is capped.
  const v1 = sendMail('finance-lead@orchid.example', 'Vendors: Quillfeather Supply, Brackenridge Tools');
  let log = [];
  const step = calls => { const ds = decide(calls, CFG, log); for (const x of ds) if (x.action !== 'send') log.push({ kind: x.action === 'refuse' ? 'refused' : x.action === 'resend' ? 'resent' : 'capped', rule: x.violation.rule.pid, recipient: x.violation.recipient, hash: x.hash }); return ds.map(x => x.action); };
  assert.deepEqual(step([v1]), ['refuse']);
  assert.deepEqual(step([v1]), ['resend']);
  assert.deepEqual(step([sendMail('finance-lead@orchid.example', 'again Brackenridge Tools')]), ['cap']);
  // Another recipient of no rule: sent. The Slack rule: a second pair, refused once; then the session cap (2) holds.
  assert.deepEqual(step([sendMail('someone@orchid.example', 'Brackenridge Tools')]), ['send']);
  const post = t => ({ name: 'api_fetch', arguments: JSON.stringify({ method: 'POST', url: 'https://slack.com/api/chat.postMessage', body: JSON.stringify({ channel: 'C9', text: t }) }) });
  assert.deepEqual(step([post('Totals: Brackenridge Tools 980')]), ['refuse']);
  const cfg3 = { ...CFG, rules: [...CFG.rules, { pid: 'P3', app: 'slack', channels: [{ id: 'C10', name: 'misc' }], literals: [{ text: 'Brackenridge Tools', rule: null }] }] };
  log = [...log];
  assert.deepEqual(decide([{ name: 'api_fetch', arguments: JSON.stringify({ method: 'POST', url: 'https://slack.com/api/chat.postMessage', body: JSON.stringify({ channel: 'misc', text: 'Brackenridge Tools' }) }) }], cfg3, log).map(x => x.action), ['cap']);
  // A batch with a violating call is held whole (no partial send).
  assert.deepEqual(decide([read, sendMail('finance-lead@orchid.example', 'only Brackenridge Tools'), read], CFG, []).map(x => x.action), ['held', 'refuse', 'held']);
  // The refusal note: what to fix, no world step, no grading vocabulary.
  const ds = decide([sendMail('finance-lead@orchid.example', 'Brackenridge Tools')], CFG, []);
  const txt = refusalText(ds[0], sendMail('finance-lead@orchid.example', 'Brackenridge Tools'));
  assert.match(txt, /^HARNESS GATE: not sent \(no world step used\)\. Call 1 \(POST \/gmail\/v1\/users\/me\/messages\/send\) to finance-lead@orchid\.example contains "Brackenridge Tools", which P1 leaves out of this message \(rule gmail:message:g1: "Vendors on hold are left out of every summary"\)\. Remove it and send again\. If the message must contain it, run the identical command again: it will be sent\.$/);
  assert.doesNotMatch(txt, GRADING);
  assert.doesNotMatch(refusalText(ds[0], sendMail('x@orchid.example', 'y'), { batch: true }), GRADING);
});

/** A minimal mailbox responder (the bridge's role): answers req-N.json with deterministic results. */
function responder(box) {
  let stop = false;
  const seen = new Set();
  (async () => {
    while (!stop) {
      let files = [];
      try { files = readdirSync(box); } catch { /* not yet */ }
      for (const f of files) {
        const m = /^req-(\d+)\.json$/.exec(f);
        if (!m || seen.has(f)) continue;
        seen.add(f);
        const req = JSON.parse(readFileSync(path.join(box, f), 'utf8'));
        writeFileSync(path.join(box, `res-${m[1]}.json.tmp`), JSON.stringify({ results: req.calls.map((c, i) => ({ name: c.name, content: `ok ${m[1]}.${i + 1} ${c.name}` })) }));
        writeFileSync(path.join(box, `res-${m[1]}.json`), readFileSync(path.join(box, `res-${m[1]}.json.tmp`)));
      }
      await new Promise(r => setTimeout(r, 15));
    }
  })();
  return () => { stop = true; };
}
const runClient = (dir, args, env = {}) => new Promise(res => {
  const c = spawn(process.execPath, ['tool.mjs', ...args], { cwd: dir, env: { PATH: process.env.PATH, AUTOBENCH_TOOL_WAIT_MS: '4000', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '', e = '';
  c.stdout.on('data', x => { o += x; }); c.stderr.on('data', x => { e += x; });
  c.on('close', code => res({ code, stdout: o, stderr: e }));
});
function workdir(client) {
  const d = tmp('wd');
  mkdirSync(path.join(d, '.tools'), { recursive: true });
  copyFileSync(client, path.join(d, 'tool.mjs'));
  writeFileSync(path.join(d, 'tools.json'), JSON.stringify([{ name: 'api_fetch' }]));
  return d;
}

test('9 gated client: byte-compatible with tool.mjs for everything it does not refuse; a refusal writes no request; a missing configuration is plain', { timeout: 120_000 }, async () => {
  const plain = workdir(path.join(REPO, 'experiments/autobench/tool.mjs')), gated = workdir(path.join(V2_DIR, 'tool-gated.mjs'));
  const gdir = tmp('gate');
  writeGate(gdir, CFG);
  assert.equal(statSync(path.join(gdir, 'gate.json')).mode & 0o777, 0o444);
  const stops = [responder(path.join(plain, '.tools')), responder(path.join(gated, '.tools'))];
  try {
    const ok = sendMail('someone@orchid.example', 'Quillfeather Supply');
    const cases = [['list'], [], ['bogus'], ['call'], ['batch', '[]'], ['batch', 'not json'], ['call', 'api_fetch', read.arguments], ['batch', JSON.stringify([read, ok])], ['batch', JSON.stringify([{ name: 'api_fetch', arguments: { method: 'GET', url: 'https://slack.com/api/conversations.list' } }])]];
    for (const args of cases) {
      const a = await runClient(plain, args), b = await runClient(gated, args, { [GATE_ENV]: gdir });
      assert.deepEqual(b, a, JSON.stringify(args));
    }
    // A missing or unreadable configuration: plain behaviour, also for a call the lint would refuse.
    const banned = JSON.stringify([sendMail('finance-lead@orchid.example', 'Brackenridge Tools')]);
    assert.deepEqual(await runClient(gated, ['batch', banned], { [GATE_ENV]: tmp('empty') }), await runClient(plain, ['batch', banned]));
    // With the configuration: refused before the mailbox (no request file), exit 1, the note on stderr.
    const before = readdirSync(path.join(gated, '.tools')).filter(f => /^req-\d+\.json$/.test(f)).length;
    const r = await runClient(gated, ['batch', banned], { [GATE_ENV]: gdir });
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^HARNESS GATE: not sent \(no world step used\)/);
    assert.equal(readdirSync(path.join(gated, '.tools')).filter(f => /^req-\d+\.json$/.test(f)).length, before);
    // The identical resend is sent.
    const r2 = await runClient(gated, ['batch', banned], { [GATE_ENV]: gdir });
    assert.equal(r2.code, 0);
    assert.match(r2.stdout, /^### result 1: api_fetch\nok \d+\.1 api_fetch\n$/);
    // A batch with a violating call is refused whole: nothing is sent (codeowned-v2-review.test.mjs e2 covers the resend).
    const mixed = JSON.stringify([read, { ...sendMail('finance-lead@orchid.example', 'x'), arguments: JSON.parse(JSON.stringify(sendMail('ops@orchid.example', 'x').arguments)) }, { name: 'api_fetch', arguments: JSON.stringify({ method: 'POST', url: 'https://slack.com/api/chat.postMessage', body: JSON.stringify({ channel: 'C9', text: 'Brackenridge Tools 980' }) }) }]);
    const reqs = () => readdirSync(path.join(gated, '.tools')).filter(f => /^req-\d+\.json$/.test(f)).length;
    const n3 = reqs();
    const r3 = await runClient(gated, ['batch', mixed], { [GATE_ENV]: gdir });
    assert.equal(r3.code, 1);
    assert.equal(r3.stdout, '');
    assert.equal(reqs(), n3);
    assert.match(r3.stderr, /Call 3 \(POST \/api\/chat\.postMessage\) to #ledger-ops contains "Brackenridge Tools", which P2 leaves out/);
    assert.match(r3.stderr, /No call of this batch was sent/);
    // The host reads the log back without following a link, with a size cap.
    const lg = readGateLog(path.join(gated, '.tools', 'gate-log.jsonl'));
    assert.equal(lg.status, 'ok');
    assert.deepEqual(lg.lines.map(l => l.kind).filter(k => k !== 'loaded'), ['refused', 'resent', 'held', 'held', 'refused']);
    const linkDir = tmp('loglink');
    writeFileSync(path.join(linkDir, 'secret.json'), '{"kind":"refused"}\n');
    symlinkSync(path.join(linkDir, 'secret.json'), path.join(linkDir, 'gate-log.jsonl'));
    assert.deepEqual(readGateLog(path.join(linkDir, 'gate-log.jsonl')), { lines: [], status: 'absent' });
    writeFileSync(path.join(linkDir, 'big.jsonl'), `${'{"kind":"refused"}\n'.repeat(100)}`);
    assert.equal(readGateLog(path.join(linkDir, 'big.jsonl'), 100).status, 'cut');
  } finally { stops.forEach(s => s()); }
});

// ---------------------------------------------------------------------------------------------------------------
// 10. Business time

test('10 business time: with the date note, load stamps are not record dates, not "today" and never newer; business dates far from the clock are kept; without it, v1', () => {
  const clock = { t0: Date.UTC(2026, 9, 21, 12, 0, 0), t1: Date.UTC(2026, 9, 21, 12, 1, 0) };
  const stampIso = new Date(clock.t0 - 4 * 60_000).toISOString();
  const stamp = v => isLoadStamp(v, clock);
  assert.equal(stamp(stampIso), true);
  assert.equal(stamp(clock.t0 - 13 * 3_600_000), false);                // older than the 12 h window
  assert.equal(stamp(clock.t1 + 6 * 60_000), false);                     // after t1 + 5 min
  assert.equal(stamp('2026-10-21'), false);                              // a date without a time is never a stamp
  assert.equal(stamp(String((clock.t0 - 60_000) / 1000)), true);         // epoch seconds (a chat ts)
  const data = { created_at: stampIso, updated_at: '2026-02-11T10:00:00Z', subject: 'Count' };
  assert.equal(dateOf(data, { stamp }), '2026-02-11T10:00:00Z');
  assert.equal(dateOf(data), stampIso);
  assert.equal(dateOf(data), dateOfV1(data));                            // without the date note: v1's
  // Business text drops the stamp; "today" quoted from a stamp does not verify; with no today the brief says so.
  const inv = { connected: ['gmail'], outOfScope: [], truncated: [], precedents: [], clock, records: [rec('gmail:message:s1', { ...data, body_plain: 'Count the pallets.' }, dateOf(data, { stamp }))] };
  const src = sourceMap('Count the pallets.', inv, { dateNote: true });
  assert.ok(src.get('gmail:message:s1').text.includes(stampIso.slice(0, 10)));
  assert.ok(!src.get('gmail:message:s1').shownText.includes(stampIso));
  const t = normalizeLedger({ today: { value: stampIso.slice(0, 10), source: 'gmail:message:s1', quote: stampIso }, requirements: [] }, src, { reader: 1 });
  assert.equal(t.today.verified, false);
  const m = mergeLedgers([t, t, t], { sources: src });
  assert.equal(m.today, null);
  const b = briefSection({ inv, merged: { ...m, readers: 3, items: [] }, pcs: [], stepsLeft: 40, responseCap: 30, inventoryText: '' });
  assert.match(b, /Today's date for this task: not established: take it from the request and the records' business dates \(not their system timestamps\)\./);
  // Never newer: two sources with the same value conflict; the stamped one has no business date, so code cannot call it newer.
  const inv2 = { ...inv, records: [rec('gmail:message:a', { body_plain: 'limit 500', created_at: stampIso }, dateOf({ created_at: stampIso }, { stamp })), rec('gmail:message:b', { body_plain: 'limit 400', created_at: '2026-02-01T08:00:00Z' }, '2026-02-01T08:00:00Z')] };
  const src2 = sourceMap('Set the limit.', inv2, { dateNote: true });
  const conflict = { kind: 'value', item: 'M1', field: 'limit', options: [{ value: '500', verified: 'cited', source: 'gmail:message:a', date: src2.get('gmail:message:a').date }, { value: '400', verified: 'cited', source: 'gmail:message:b', date: src2.get('gmail:message:b').date }] };
  const s = settleByCode([conflict], src2);
  assert.equal(s.settled.length, 0);                                      // left to the adjudicator, not "newer"
  // Without the date note, the business text is the text.
  const src3 = sourceMap('Count the pallets.', inv, { dateNote: false });
  assert.equal(src3.get('gmail:message:s1').shownText, src3.get('gmail:message:s1').text);
});

// ---------------------------------------------------------------------------------------------------------------
// 11. Entity keys

test('11 entity keys: items on different records, rows or addresses never merge (even with near-identical targets); the same pointer merges; alignment is best-match', () => {
  const upd = (ptr, target) => ({ polarity: 'positive', action: 'update_record', app: 'salesforce', target: `${target} ${ptr}`, statement: 'update the buyer phone', fields: [] });
  assert.equal(sameEffect(upd('salesforce:Contact:C01', 'update buyer phone'), upd('salesforce:Contact:C02', 'update buyer phone')), false);
  assert.equal(sameEffect(upd('salesforce:Contact:C01', 'update buyer phone'), upd('salesforce:Contact:C01', 'buyer phone change')), true);
  const row = r => ({ polarity: 'positive', action: 'update_row', app: 'google_sheets', target: `vendor row google_sheets:row:ssV/Vendors#${r}`, statement: 's', fields: [] });
  assert.equal(sameEffect(row(2), row(3)), false);
  const mail = to => ({ polarity: 'positive', action: 'send_email', app: 'gmail', target: `weekly vendor note to ${to}`, statement: 's', fields: [{ name: 'to', value: to }] });
  assert.equal(sameEffect(mail('a@orchid.example'), mail('b@orchid.example')), false);
  // One item with keys, one without: never merged.
  assert.equal(sameEffect(upd('salesforce:Contact:C01', 'update buyer phone'), { ...upd('', 'update buyer phone'), target: 'update buyer phone' }), false);
  // Without keys anywhere: v1's word rule.
  assert.equal(sameEffect({ ...row(2), target: 'weekly vendor note' }, { ...row(2), target: 'the weekly vendor note' }), true);
  // Best-match alignment: reader 2 lists the same two effects in the other order.
  const note = (id, target) => ({ id, polarity: 'positive', action: 'post_message', app: 'slack', target, statement: `post the ${target}`, source: 'request', fields: [] });
  const m = mergeLedgers([reader(1, [note('R1', 'weekly sales summary east'), note('R2', 'weekly sales summary west')]), reader(2, [note('R1', 'weekly sales summary west'), note('R2', 'weekly sales summary east')])], { sources: SRC });
  assert.deepEqual(m.items.map(i => [i.target, i.memberIds]), [['weekly sales summary east', ['L1.R1', 'L2.R2']], ['weekly sales summary west', ['L1.R2', 'L2.R1']]]);
});

// ---------------------------------------------------------------------------------------------------------------
// 12-14. Ride-alongs

test('12 JSON repair: an unescaped inner quote is repaired; a reply with nothing to parse stays null', () => {
  assert.deepEqual(parseJsonReply('{"requirements": [{"statement": "Use the subject "Quarterly Vendor Summary" exactly", "id": "R1"}]}'), { requirements: [{ statement: 'Use the subject "Quarterly Vendor Summary" exactly', id: 'R1' }] });
  assert.deepEqual(parseJsonReply('```json\n{"a": "x"}\n```'), { a: 'x' });
  assert.equal(parseJsonReply('nothing here'), null);
});

test('13 fragments: a quote with an ellipsis verifies fragment by fragment, in order, within one source', () => {
  assert.equal(findSpan('Vendors on hold … every summary', 'Vendors on hold are left out of every summary.'), 'Vendors on hold are left out of every summary');
  assert.equal(findSpan('Vendors on hold ... every summary', 'Vendors on hold are left out of every summary.'), 'Vendors on hold are left out of every summary');
  assert.equal(findSpan('every summary … Vendors on hold', 'Vendors on hold are left out of every summary.'), null);   // out of order
  const src = new Map([['request', { text: 'Vendors on hold' }], ['x', { text: 'nothing about every summary' }]]);
  assert.equal(copyLiteral('Vendors on hold … every summary', 'request', src).verified, false);                     // across two sources
});

test('14 inventory fixes: calendar lists under "calendars", cells beyond the header, single-word proper nouns', () => {
  const cal = ENUM_PLAN.find(p => p.app === 'google_calendar');
  assert.deepEqual(cal.expand('calendar_list', { calendars: [{ id: 'team@orchid.example' }, { id: 'primary' }] }).map(c => JSON.parse(c.call.arguments).url), ['https://www.googleapis.com/calendar/v3/calendars/team%40orchid.example/events']);
  assert.equal(cal.expand('calendar_list', { items: [{ id: 'x' }] }).length, 1);
  const rows = _internalV2.recordsFromResponse('google_sheets', 'values', { spreadsheetId: 'ssV', valueRanges: [{ range: 'Vendors!A1:D3', values: [['Vendor', 'Status'], ['Quillfeather Supply', 'Active', 'late', 'note']] }] }, { title: 'Vendors', sheetIds: { Vendors: '0' } });
  assert.deepEqual(Object.entries(rows[0].data).slice(-4), [['Vendor', 'Quillfeather Supply'], ['Status', 'Active'], ['col_3', 'late'], ['col_4', 'note']]);
  assert.deepEqual(entityTerms('Please send the report and loop in Quillfeather about it, then Brackenridge.'), ['Quillfeather', 'Brackenridge']);
  assert.deepEqual(entityTerms('Quillfeather owes us. Contact them.'), []);                                // sentence-initial only
  assert.ok(entityTerms('a b c d e f g h i j k l m n Alpha Beta Gamma Delta Epsilon Zeta Theta Iota Kappa Lambda Omicron Sigma Tau'.split(' ').map((w, i) => (i % 2 ? w : `${w} x`)).join(' ')).length <= 10);
});

// ---------------------------------------------------------------------------------------------------------------
// 15. The brief

test('15 brief: no "Not rules" line; the single-pass heading; leave-out and may-mention tails; the lint line only with the lint; no grading vocabulary', () => {
  const { m, pcs } = compile([reader(1, [summary(), contentNeg(1)]), reader(2, [summary({ fields: summary().fields.slice(0, 2) }), contentNeg(2)]), reader(3, [summary({ fields: summary().fields.slice(0, 2) }), contentNeg(3)])]);
  m.dropped = [{ statement: 'do not post anywhere else' }];
  const args = { inv: INV, merged: m, pcs: pcs.map((p, i) => ({ ...p, id: `P${i + 1}` })), stepsLeft: 40, responseCap: 30, inventoryText: '(records)' };
  const b = briefSection(args);
  assert.doesNotMatch(b, /Not rules/);
  assert.match(b, /### Checks the harness runs after you stop \(recorded; no second session follows, so finish the work in this one\)/);
  assert.match(b, /### Requirements \(MUST = do it; MUST NOT = a cited rule forbids it; copy data values exactly \(names, addresses, ids, amounts\); in messages write machine timestamps as dates in words\)/);
  assert.match(b, /\| leave out of this item: "Brackenridge Tools"/);
  assert.match(b, /\| may mention \(no source requires it; use only where it belongs, never as a bare list\): "Quillfeather Supply"/);
  assert.match(b, /not containing "Brackenridge Tools"/);
  assert.doesNotMatch(b, /HARNESS GATE/);
  assert.match(briefSection({ ...args, gate: true }), /checks each outgoing message against the "leave out" rules above\. It refuses a message that breaks one, once, with "HARNESS GATE"/);
  assert.doesNotMatch(briefSection({ ...args, gate: true }), GRADING);
  // A machine timestamp bound for a message is shown as a date to write in words (with the record's own rendering).
  assert.equal(humanRendering('2026-02-03T09:00:00Z', 'Delivered February 3, 2026 at the north dock'), 'February 3, 2026');
});

// ---------------------------------------------------------------------------------------------------------------
// 16. Real-user probes (guards against grader-shaped behaviour)

test('16 guards: no read-marking anywhere; a loosely singular request gives no record_unchanged on siblings; a record note against a named entity gives no exclusion by itself', () => {
  // (a) Nothing in v2 marks or checks messages as read.
  for (const f of readdirSync(V2_DIR).filter(x => x.endsWith('.mjs'))) assert.doesNotMatch(readFileSync(path.join(V2_DIR, f), 'utf8').replace(/^\s*\/\/.*$/gm, ''), /\bUNREAD\b|is_read|mark(ed|s)? (as )?read/, f);
  // (b) "update the buyer's phone" on one record: no check on the other buyer.
  const one = { id: 'R1', polarity: 'positive', action: 'update_record', app: 'salesforce', target: 'salesforce:Contact:C01', statement: "update the buyer's phone", source: 'request', fields: [{ name: 'Phone', quote: '555-0142', source: 'salesforce:Contact:C01' }] };
  const { pcs } = compile([1, 2, 3].map(k => reader(k, [one])));
  assert.ok(!pcs.some(p => p.type === 'record_unchanged'));
  assert.ok(!JSON.stringify(pcs).includes('C02'));
  // (c) A record that says to leave an entity out does not by itself make a ban: only a reader's cited content rule does.
  const inv = { ...INV, records: [...INV.records, rec('gmail:message:g9', { subject: 'note', body_plain: 'Do not mention Brackenridge Tools to anyone.' })] };
  const src = sourceMap(REQUEST, inv, { system: SYSTEM });
  const r = compile([1, 2, 3].map(k => normalizeLedger({ requirements: [summary()] }, src, { reader: k })), inv, src);
  assert.deepEqual(r.m.items[0].exclusions, []);
  assert.deepEqual(r.pcs[0].params.bodyNot, []);
});

// ---------------------------------------------------------------------------------------------------------------
// 17-20. Isolation, leakage, manifest, v1 untouched

const V2_RUNTIME = ['codeowned.mjs', 'ledger.mjs', 'postconditions.mjs', 'checker.mjs', 'inventory.mjs', 'literals.mjs', 'gate.mjs', 'tool-gated.mjs'];
test('17 isolation: v2 runtime modules read no task, grade, initial world, call log or host directory, and import nothing from replay/', () => {
  for (const f of V2_RUNTIME) {
    const s = readFileSync(path.join(V2_DIR, f), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');
    assert.doesNotMatch(s, /assertion|rubric|grade\.json|world0|input\.json|meta\.json|prompt\.json|calls\.jsonl|generated\.json|final-world|\bprep\b|SPLIT-v1|loadSplit|families|RECURRING-DESIGN|\/host\//i, f);
    assert.doesNotMatch(s, /from\s+['"][^'"]*replay\//, f);
    assert.doesNotMatch(s, /import\(\s*['"][^'"]*replay\//, f);
  }
  for (const f of V2.manifestFiles()) assert.ok(!f.includes('/replay/'), f);
});

test('18 L1 + devTrain literals: no devTrain task name, world string (>= 16 characters) or 8-word prompt shingle in the v2 files, tests or stubs', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async () => {
  const helper = path.join(REPO, 'experiments/autobench/replay/devtrain-literals.py');
  const out = path.join(tmp('lits'), 'lits.json');
  const r = spawnSync(VENV_PY, ['-I', helper, '--out', out], { cwd: tmp('litcwd'), encoding: 'utf8', timeout: 540_000, env: { PATH: process.env.PATH, HOME: tmp('home'), HF_HUB_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', TQDM_DISABLE: '1' } });
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  const L = readJson(out);
  assert.ok(L.names.length > 200 && L.devTrainNames.length === 240 && L.strings.length > 1000 && L.shingles.length > 1000, JSON.stringify({ n: L.names.length, t: L.devTrainNames.length, s: L.strings.length, h: L.shingles.length }));
  const ours = [...new Set([...V2.manifestFiles().filter(f => f.includes('/harness/v2/')), 'experiments/autobench/harness/v2/codeowned-stubs.mjs', 'experiments/autobench/harness/v2/build-effects.mjs', 'experiments/autobench/test/codeowned-v2.test.mjs'])];
  // L1 (every public task name) for harness files and stubs; the test file names the simple-domain task it runs, so for it the
  // rule is devTrain names.
  const namesFor = f => (f.includes('/test/') ? L.devTrainNames : L.names);
  const words = s => s.toLowerCase().replace(/[^a-z0-9@.'-]+/g, ' ').trim().split(' ').filter(Boolean);
  const shingles = new Set(L.shingles);
  const hits = [];
  for (const f of ours) {
    const text = readFileSync(path.join(REPO, f), 'utf8');
    for (const n of namesFor(f)) if (text.includes(n)) hits.push(`${f}: task name ${n}`);
    const low = text.toLowerCase();
    for (const s of L.strings) if (low.includes(s.toLowerCase())) hits.push(`${f}: world string (${s.length} chars)`);
    const w = words(text);
    for (let i = 0; i + 8 <= w.length; i++) if (shingles.has(w.slice(i, i + 8).join(' '))) hits.push(`${f}: prompt shingle at word ${i}`);
  }
  // effects.json holds the shipped API index (operation ids, paths, the messaging rule), not task content: it is scanned
  // for every task name, devTrain world string and prompt shingle as well (review:correctness 13; the test-split scan is
  // open, §7 of the design doc).
  const fx = readFileSync(path.join(V2_DIR, 'effects.json'), 'utf8');
  for (const n of L.names) if (fx.includes(n)) hits.push(`effects.json: task name ${n}`);
  const fxLow = fx.toLowerCase();
  for (const s of L.strings) if (fxLow.includes(s.toLowerCase())) hits.push(`effects.json: world string (${s.length} chars)`);
  const fw = words(fx);
  for (let i = 0; i + 8 <= fw.length; i++) if (shingles.has(fw.slice(i, i + 8).join(' '))) hits.push(`effects.json: prompt shingle at word ${i}`);
  assert.deepEqual([...new Set(hits)], []);
});

test('19 manifest: v2 id and version, the v2 files, the gated client and the effect table; the hash differs from v1', () => {
  const base = { model: 'claude-haiku-5-5', effort: null, budgetUsd: 0.75, timeoutMin: 20, maxSteps: 50, tools: ['Bash'], det: 'record', k: 1, concurrency: 3, cli: null, dateNote: true };
  const c2 = V2.codeownedConfig(base), c1 = V1.codeownedConfig(base);
  assert.equal(c2.harness, 'codeowned-v2');
  assert.equal(c2.version, 'a1c-v2');
  assert.deepEqual(c2.gate, { envVar: 'AB_GATE_DIR', client: 'harness/v2/tool-gated.mjs' });
  assert.equal(c2.pipeline.maxRounds, 0);
  assert.equal(c2.pipeline.preSendLint, false);
  assert.equal(c2.knowledge.length, 18);
  assert.match(c2.knowledge[17], /^Exposure .*one look-2 finance request .*91-task superset of looks 2 and 3/);   // the development record's look-2 exposure (§0.1)
  assert.equal(c2.knowledge.filter(k => k.startsWith('D21')).length, 9);        // every grader-tuned rule and threshold (D21), the review and re-review rules, the P0 lint decision
  assert.deepEqual(c2.knowledge.slice(0, 4), [...V1.KNOWLEDGE]);
  assert.match(c2.knowledge[5], new RegExp(EFFECTS.source.indexTxtSha256));
  const files = V2.manifestFiles();
  for (const f of ['run.mjs', 'harness/codeowned.mjs', 'harness/v2/codeowned.mjs', 'harness/v2/ledger.mjs', 'harness/v2/postconditions.mjs', 'harness/v2/checker.mjs', 'harness/v2/inventory.mjs', 'harness/v2/literals.mjs',
    'harness/v2/gate.mjs', 'harness/v2/tool-gated.mjs', 'harness/v2/effects.json', 'tool.mjs', 'bridge.py']) assert.ok(files.includes(`experiments/autobench/${f}`), f);
  assert.ok(!files.some(f => /stubs|build-effects|replay\//.test(f)));
  assert.notEqual(V2.codeownedManifest(c2).sha256, V1.codeownedManifest(c1).sha256);
  assert.notEqual(V2.codeownedManifest(c2).sha256, V2.codeownedManifest({ ...c2, pipeline: { ...c2.pipeline, preSendLint: true } }).sha256);
  assert.equal(V1.HARNESS_VERSION, 'a1c-v1');
});

const V1_REF = (() => { for (const ref of ['a1c-v1', 'aada200']) { try { execFileSync('git', ['-C', REPO, 'rev-parse', '--verify', `${ref}^{commit}`], { stdio: 'ignore' }); return ref; } catch { /* next */ } } return null; })();
test(`20 v1 untouched: the non-runner v1 manifest files equal ${V1_REF ?? 'the a1c-v1 tag'} byte for byte; run.mjs differs only by the registration lines; --harness codeowned loads a1c-v1`, { skip: !V1_REF && 'git history unavailable' }, async () => {
  const files = V1.manifestFiles();
  assert.equal(files.length, 24);
  for (const f of files.filter(x => x !== 'experiments/autobench/run.mjs')) {
    const then = execFileSync('git', ['-C', REPO, 'show', `${V1_REF}:${f}`]);
    assert.ok(then.equals(readFileSync(path.join(REPO, f))), f);
  }
  for (const f of ['experiments/autobench/harness/codeowned-stubs.mjs', 'experiments/autobench/test/codeowned.test.mjs']) assert.ok(execFileSync('git', ['-C', REPO, 'show', `${V1_REF}:${f}`]).equals(readFileSync(path.join(REPO, f))), f);
  // run.mjs: the registration lines, and (re-review 2026-10-21, B-1) the executor-model wiring extended from the codeowned
  // pipeline to codeowned-v2 (EXECUTOR_PIPELINES). For --harness codeowned both guards decide exactly as before.
  const diff = execFileSync('git', ['-C', REPO, 'diff', '--unified=0', V1_REF, '--', 'experiments/autobench/run.mjs'], { encoding: 'utf8' });
  const changed = diff.split('\n').filter(l => /^[+-](?![+-])/.test(l));
  assert.ok(changed.length > 0 && changed.length <= 13, diff);
  for (const l of changed.filter(x => x.startsWith('+'))) assert.match(l, /codeowned-v2|EXECUTOR_PIPELINES/);
  for (const l of changed.filter(x => x.startsWith('-'))) assert.match(l, /PIPELINE_(HARNESSES|STUBS)|harness !== CODEOWNED|the codeowned pipeline \(A1-C\)/);
  const { EXECUTOR_PIPELINES, CODEOWNED } = await import('../run.mjs');
  assert.deepEqual([...EXECUTOR_PIPELINES], [CODEOWNED, 'codeowned-v2']);
  assert.equal(PIPELINE_HARNESSES.codeowned, './harness/codeowned.mjs');
  const loaded = await import(new URL(PIPELINE_HARNESSES.codeowned, pathToUrl(path.join(REPO, 'experiments/autobench/run.mjs'))).href);
  assert.equal(loaded.HARNESS_VERSION, 'a1c-v1');
  assert.equal(loaded.HARNESS_ID, 'codeowned');
});
function pathToUrl(p) { return new URL(`file://${p}`); }

// ---------------------------------------------------------------------------------------------------------------
// 21 and 1 (end to end). Scripted runs through the real bridge (no model).

/** A scripted reader built ONLY from its prompt (as v1's test): the contact pointer and the number in the e-mail. */
function phoneLedger(prompt) {
  const recs = prompt.split('\n').filter(l => l.startsWith('['));
  const contact = recs.find(l => /^\[salesforce:Contact:/.test(l) && /Jordan Lee/.test(l))?.match(/^\[([^\]]+)\]/)[1];
  const mail = recs.find(l => /^\[gmail:message:/.test(l) && /Jordan/.test(l) && /phone/i.test(l));
  const mptr = mail?.match(/^\[([^\]]+)\]/)[1];
  const number = mail?.match(/(\+?\d[\d\s().-]{6,}\d)/)?.[1];
  return { today: null, requirements: contact && number ? [{ id: 'R1', polarity: 'positive', action: 'update_record', app: 'salesforce', target: contact, statement: 'update the contact phone from the email', source: 'request', fields: [{ name: 'Phone', quote: ` ${number} `, source: mptr }] }] : [], conflicts: [] };
}
const two = prompt => {
  const l = phoneLedger(prompt);
  const addr = prompt.match(/\[salesforce:Contact:[^\]]+\][^\n]*Jordan Lee[^\n]*?"Email":"([^"]+)"/)?.[1];
  if (addr) l.requirements.push({ id: 'R2', polarity: 'positive', action: 'send_email', app: 'gmail', target: addr, statement: 'confirm to the contact', source: 'request', fields: [{ name: 'to', quote: addr, source: 'request' }] },
    { id: 'N1', polarity: 'negative', scope: 'content', limits: 'R2', action: 'send_email', app: 'gmail', target: addr, statement: 'keep the old number out of the confirmation', source: 'request', rule_quote: prompt.match(/<request>\n([^\n]{12,40})/)?.[1] ?? '', rule_source: 'request',
      leave_out: [{ quote: prompt.match(/\[salesforce:Contact:[^\]]+\][^\n]*Jordan Lee[^\n]*?"Phone":"([^"]+)"/)?.[1] ?? '', source: 'request' }] });
  return l;
};

test('21 end to end (v2, scripted): with no content rule the lint is not installed; act and check-0 run with no repair; the audit is clean; nothing grader-side reaches a node', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async () => {
  const live = tmp('e2e');
  const seenNodes = [], seenSessions = [];
  const { summary: sum, results } = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'codeowned-v2', det: 'record', liveRoot: live, outDir: path.join(live, 'out'), log: quiet, dateNote: true, pipeline: { preSendLint: true },
    runner: stubSessionRunner({ seen: seenSessions }), nodeRunner: stubNodeRunner({ seen: seenNodes, replies: { ledger: phoneLedger } }) });
  const r = results[0], f = r.forks[0], p = f.pipeline;
  assert.equal(r.final.task_completed_correctly, 1, JSON.stringify(f.session?.violations));
  assert.deepEqual(f.session.nodes.map(n => n.name), ['inventory', 'ledger-1', 'ledger-2', 'ledger-3', 'act', 'check-0']);
  assert.deepEqual(f.session.violations, []);
  assert.equal(f.steps, f.session.codeSteps + f.session.sessionSteps);
  assert.equal(p.termination.reason, 'all checks pass');
  assert.equal(p.termination.category, 'all-pass');
  assert.equal(p.rounds, 0);
  // preSendLint is on, but this ledger has no content rule: nothing to lint, so no gate (review: zero-rule gate).
  assert.equal(p.gate.installed, false);
  assert.equal(typeof p.checks[0].nullHard, 'number');
  const act = seenSessions[0];
  assert.equal(act.env, null);
  // The readers saw the standing instructions; the act session the official prompt and the brief.
  const prep = path.join(live, 'prep', PHONE_TASK);
  const official = readJson(path.join(prep, 'prompt.json'));
  assert.ok(seenNodes[0].prompt.startsWith(`<system>\n${official.system}\n</system>`));
  assert.ok(act.system.startsWith(official.system + '\n\n## Tools in this environment'));
  assert.equal(act.prompt, official.user);
  assert.match(act.system, /no second session follows/);
  assert.doesNotMatch(act.system, /HARNESS GATE/);
  const info = JSON.parse(readJson(path.join(prep, 'input.json')).info);
  const served = readFileSync(path.join(live, 'host', PHONE_TASK, 'fork-0', 'calls.jsonl'), 'utf8');
  const inputs = [...seenNodes, ...seenSessions].map(s => `${s.system}\n${s.prompt}`).join('\n');
  for (const a of info.assertions) {
    assert.ok(!inputs.includes(a.type), `assertion type reachable: ${a.type}`);
    const vals = []; const walk = v => { if (typeof v === 'string' && v.length >= 6) vals.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    const { type, ...rest } = a; walk(rest);
    for (const v of vals) if (inputs.includes(v)) assert.ok(official.user.includes(v) || official.system.includes(v) || served.includes(v) || served.includes(JSON.stringify(v).slice(1, -1)), `value reached a node from outside the world: ${v}`);
  }
  assert.ok(!inputs.includes(PHONE_TASK));
  for (const n of ['satisfiability.json', 'check-0.json']) assert.ok(existsSync(path.join(live, 'host', PHONE_TASK, 'fork-0', 'pipeline', n)), n);
  assert.ok(readJson(path.join(live, 'host', PHONE_TASK, 'fork-0', 'pipeline', 'check-0.json')).every(c => typeof c.observable === 'boolean' && typeof c.notReread === 'boolean'));
  assert.equal(sum.arm, 'A1-C v2 (code-owned harness)');
  assert.equal(sum.harness.id, 'codeowned-v2');
  assert.equal(sum.harness.version, 'a1c-v2');
  assert.ok(!readFileSync(path.join(live, 'out', 'results.jsonl'), 'utf8').includes('assertion_results'));
});

test('1 end to end (v2, scripted): a failing hard check ends the pipeline (single pass, no second session); with the lint on, a left-out value is refused once and the identical resend goes out', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async () => {
  const seen = [];
  const a = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'codeowned-v2', det: 'record', liveRoot: tmp('single'), outDir: null, log: quiet, dateNote: true,
    runner: stubSessionRunner({ skipLast: true, seen }), nodeRunner: stubNodeRunner({ replies: { ledger: two } }) });
  const f = a.results[0].forks[0];
  assert.ok(f.pipeline.ledger.hardChecks >= 2, JSON.stringify(f.pipeline.ledger));
  assert.deepEqual(f.session.nodes.map(n => n.name).filter(n => !/^checker/.test(n)), ['inventory', 'ledger-1', 'ledger-2', 'ledger-3', 'act', 'check-0']);
  assert.match(f.pipeline.termination.reason, /^single pass \(repairs off\): \d+ hard check\(s\) fail$/);
  assert.equal(seen.length, 1);                                                   // no second session
  assert.equal(f.pipeline.rounds, 0);
  assert.deepEqual(f.session.violations, []);
  // The lint end to end: the act session sends the confirmation with the value the readers' content rule leaves out.
  const live = tmp('lint');
  const g = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'codeowned-v2', det: 'record', liveRoot: live, outDir: null, log: quiet, dateNote: true, pipeline: { preSendLint: true },
    runner: stubSessionRunner({ appendLeftOut: true, perCall: true, resendOnGate: true }), nodeRunner: stubNodeRunner({ replies: { ledger: two } }) });
  const fg = g.results[0].forks[0];
  assert.equal(fg.pipeline.gate.installed, true);
  assert.equal(fg.pipeline.gate.active, true);
  assert.equal(fg.pipeline.gate.refused, 1, JSON.stringify(fg.pipeline.gate));
  assert.equal(fg.pipeline.gate.resentIdentical, 1);
  // The gate: AB_GATE_DIR names the act session's read-only step-guard directory, which holds gate.json.
  const gdir = readJson(path.join(live, 'host', PHONE_TASK, 'fork-0', 'pipeline', 'nodes.json')).find(n => n.name === 'act').gate;
  assert.equal(gdir.client.path, 'harness/v2/tool-gated.mjs');
  const glog = readJson(path.join(live, 'host', PHONE_TASK, 'fork-0', 'pipeline', 'gate-log.json'));
  assert.deepEqual(glog.lines.map(l => l.kind).filter(k => k !== 'loaded'), ['refused', 'resent']);
  assert.ok(glog.lines.filter(l => l.kind === 'loaded').length >= 2);
  // The refusal used no world step: the session issued one step per write plus the resend, and the refused try is not among them.
  assert.equal(fg.session.sessionSteps, 2);
  assert.deepEqual(fg.session.violations, []);
  // After the resend the message carries the left-out value: the round-0 check records it (instrumentation only).
  const c0 = readJson(path.join(live, 'host', PHONE_TASK, 'fork-0', 'pipeline', 'check-0.json'));
  assert.ok(c0.some(c => c.type === 'gmail_sent' && c.pass === false && /left-out/.test(c.evidence)), JSON.stringify(c0));
  // Re-ask: two readers that give no ledger make one more reader call.
  let n = 0;
  const flaky = prompt => { n += 1; return n <= 2 ? 'no json at all' : phoneLedger(prompt); };
  const b = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'codeowned-v2', det: 'record', liveRoot: tmp('reask'), outDir: null, log: quiet, dateNote: true,
    pipeline: { parallelLedgers: false }, runner: stubSessionRunner(), nodeRunner: stubNodeRunner({ replies: { ledger: flaky } }) });
  const fb = b.results[0].forks[0];
  assert.deepEqual(fb.session.nodes.map(x => x.name).slice(0, 5), ['inventory', 'ledger-1', 'ledger-2', 'ledger-3', 'ledger-1b']);
  assert.deepEqual(fb.pipeline.ledger.reasked, { reader: 1, parsed: true });
  assert.deepEqual(fb.session.violations, []);
  // One failed reader: no re-ask.
  let m = 0;
  const once = prompt => { m += 1; return m === 1 ? 'no json' : phoneLedger(prompt); };
  const c = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'codeowned-v2', det: 'record', liveRoot: tmp('noreask'), outDir: null, log: quiet, dateNote: true,
    pipeline: { parallelLedgers: false }, runner: stubSessionRunner(), nodeRunner: stubNodeRunner({ replies: { ledger: once } }) });
  assert.ok(!c.results[0].forks[0].session.nodes.some(x => x.name === 'ledger-1b'));
});

// ---------------------------------------------------------------------------------------------------------------
// Replay tools (developer tools, $0): classification, harm totals, the lint replay

test('replay tools: check classes against assertions, harm totals from a call log, the lint replay over an act window', async () => {
  const { classify, totals, lintTask } = await import('../replay/replay-gate.mjs');
  const { harmOfTask } = await import('../replay/harm.mjs');
  const { alignScore } = await import('../replay/lib.mjs');
  const A = [{ type: 'gmail_message_sent_to_with_body_contains', params: { to: 'finance-lead@orchid.example', body_contains: ['Quillfeather'] }, passed: true },
    { type: 'gmail_message_not_sent_to', params: { to: 'ivo.marchetti@orchid.example' }, passed: false }];
  const sent = { type: 'gmail_sent', params: { to: ['finance-lead@orchid.example'], cc: [], subject: [], body: ['Quillfeather Supply'] } };
  assert.equal(alignScore(sent, A[0]), 3);
  assert.equal(alignScore(sent, A[1]), 0);                                        // a positive check never aligns with a negative assertion
  assert.equal(classify(sent, false, A).cls, 'FR-aligned');
  assert.equal(classify(sent, true, A).cls, 'TA');
  assert.equal(classify({ type: 'gmail_not_sent', params: { to: ['ivo.marchetti@orchid.example'] } }, true, A).cls, 'FA');
  assert.equal(classify({ type: 'record_field', params: { ptr: 'salesforce:Contact:C01', field: 'Phone', value: '1' } }, false, A).cls, 'FR-unaligned');
  assert.equal(classify(sent, null, A).cls, 'undecided');
  const row = (pass, v2) => ({ graderPass: pass, v1: { checks: 0, hard: 0, rejects: false }, v2: { checks: 1, hard: 1, FRaligned: v2 === 'FR' ? 1 : 0, FRunaligned: 0, FA: 0, TA: v2 === 'TA' ? 1 : 0, TR: 0, neutral: 0, nullHard: 0, rejects: v2 === 'FR', clauseOrSlotShown: 0, wrongApp: 0 }, today: { changed: false } });
  const T = totals([row(true, 'FR'), row(true, 'TA'), row(false, 'TA')]);
  assert.equal(T.v2.passingWorldsRejected, 1);
  assert.equal(T.v2.failingWorldsAccepted, 1);
  assert.equal(T.targets.alignedHardFalseRejects.value, 1);
  // Harm: a repeated send, two messages to one recipient, a container, a read flip, a removed record and an emptied field.
  const fetchCall = (method, url, body) => ({ name: 'api_fetch', arguments: JSON.stringify({ method, url, params: null, body: JSON.stringify(body) }) });
  const mail = fetchCall('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: b64url('To: finance-lead@orchid.example\r\nSubject: s\r\n\r\nhello') });
  const calls = [{ step: 1, calls: [mail, mail] }, { step: 2, calls: [fetchCall('POST', 'https://slack.com/api/conversations.create', { name: 'tmp' }), fetchCall('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/g1/modify', { removeLabelIds: ['UNREAD'] })] }];
  const h = harmOfTask({ calls, world0: { crm: { contacts: [{ id: 'a', phone: '1' }, { id: 'b', phone: '2' }] } }, worldEnd: { crm: { contacts: [{ id: 'a', phone: '' }] } } });
  assert.deepEqual({ ...h, flips: undefined }, { duplicates: 1, removals: 2, extraMessages: 1, containers: 1, readFlips: 1, flips: undefined });
  // The lint replay: the sends of the act window, in order, through the configured lint.
  const recd = { nodes: [{ name: 'act', started: 10, ended: 20 }], calls: [{ step: 1, t: 5, calls: [sendMail('finance-lead@orchid.example', 'Brackenridge Tools')] }, { step: 2, t: 12, calls: [sendMail('finance-lead@orchid.example', 'Brackenridge Tools'), read] }],
    grade: { assertion_results: [{ type: 'gmail_message_sent_to_with_body_not_contains', params: { to: 'finance-lead@orchid.example', body_not_contains: ['Brackenridge Tools'] }, passed: false, excluded: false }] } };
  const L = lintTask({ rec: recd, pcs: GATE_PCS, merged: GATE_MERGED });
  assert.equal(L.sends, 1);                                                       // the send before the act window is not replayed
  assert.equal(L.refusals.length, 1);
  assert.match(L.refusals[0].auto, /^true/);
});
