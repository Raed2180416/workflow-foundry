// Unit tests for requirement-ledger-v3 (Δ* v1, ATTACK §6 Move 1): synthetic worlds only (no benchmark data).
//   nice -n 15 node --test --test-concurrency=1 experiments/autobench/verifier/requirement-ledger-v3/rl3.test.mjs
// Covers: the SQL sandbox (deny-by-default authorizer, function allow-list, static check, killable worker; the skeptic's
// probe that PRAGMA query_only alone lets ATTACH write a file and randomblob allocate), the clock ruling (D28), universes,
// pointer normalisation, dispositions (executed predicate / verbatim quote / labelled null), consensus, compilation of
// both directions into hard checks, the Agent-Diff-shaped contract, the three-valued verdict, and source hygiene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { FUNCTIONS, FILE_CAP_BLOCKS, checkPredicateText, checkSqlText, evaluateInProcess, hostClockUse, runSelect } from './sqlsafe.mjs';
import { businessDates, deriveToday, domainDays, parseDate, requestDate } from './clock.mjs';
import { mentionForms, sqlTables, universesFromInventory, universesFromWorld } from './universe.mjs';
import { normalizePointer, pointerIndex } from './pointers.mjs';
import { INDUCE_MIN_PER_SIDE, agentDiffContract, buildDstar, compileProhibitions, formatFigure, grounding, holdsTest, induceTest, listLike, verdict, verifyQuote } from './dstar.mjs';
import { evaluateDstar } from './evaluate.mjs';
import { adaptA1cLedger, adaptRl2Extraction } from './adapters.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------------------------------------------
// Fixtures: a vendor sheet, a policy e-mail, a request. Synthetic; no benchmark data.

const SS = 'ss_v', WS = 'ws_vendors';
const rowRec = (row, cells) => ({ ptr: `google_sheets:row:${SS}/${WS}#${row}`, app: 'google_sheets', kind: 'row', id: `${SS}/${WS}#${row}`, data: { spreadsheet: 'Vendors', spreadsheetId: SS, worksheet: 'Active Vendors', row, ...cells } });
function inventory({ messageDate = '2026-02-10T09:00:00Z', withMessage = true } = {}) {
  const records = [
    { ptr: 'google_sheets:spreadsheet:ss_v', app: 'google_sheets', kind: 'spreadsheet', id: SS, data: { title: 'Vendors' } },
    rowRec(2, { Vendor: 'Acme Supplies Inc', Status: 'Active', Amount: '$1,200', 'Due Date': '2026-01-05', Email: 'ap@acme.test' }),
    rowRec(3, { Vendor: 'Globex Corp', Status: 'On Hold', Amount: '$800', 'Due Date': '2026-02-20', Email: 'billing@globex.test' }),
    rowRec(4, { Vendor: 'Initech LLC', Status: 'Active', Amount: '$450', 'Due Date': '2026-02-01', Email: 'pay@initech.test' }),
  ];
  if (withMessage) records.push({ ptr: 'gmail.messages:m1', app: 'gmail', kind: 'message', id: 'm1', data: { subject: 'Payables policy', from: 'cfo@corp.test', body: 'Vendors on hold must not appear in any summary. Report only active vendors.', date: messageDate } });
  return { records };
}
const REQUEST = { user: 'Email owner@corp.test a summary of every active vendor balance with the total.', system: '' };
const tableOf = (universes, uid) => sqlTables(universes).catalog.find(c => c.uid === uid).table;
const VENDORS = `google_sheets.row[${SS}/${WS}]`;
const predicateReader = (name, where = `"Status" = 'Active'`, extra = {}) => ({ reader: name, obligations: [{ id: 'O1', effect: 'send_email', app: 'gmail', target: { emails: ['owner@corp.test'] }, selections: [{ universe: VENDORS, where }], figures: [], ...extra }] });
const listReader = (name, members) => ({ reader: name, obligations: [{ id: 'O1', effect: 'send_email', app: 'gmail', target: { emails: ['owner@corp.test'] }, selections: [{ members }] }] });
const msgDiff = (to, body, subject = 'Vendor summary') => ({ changes: [{ op: 'created', app: 'gmail', coll: 'messages', id: 'n1', record: { to: [to], subject, body_plain: body } }] });
const disp = (D, label) => D.dispositions.find(d => d.label === label);

// ---------------------------------------------------------------------------------------------------------------
// The SQL sandbox

const T = [{ name: 'u1', columns: [{ name: '_mid', type: 'num' }, { name: 'Amount', type: 'num' }, { name: 'Due Date', type: 'text' }], rows: [[1, 10, '2026-01-01'], [2, 20, '2026-02-01']] }];

test('sandbox control (the skeptic\'s probe): PRAGMA query_only alone lets ATTACH write a file and randomblob allocate', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rl3-ctl-'));
  try {
    const f = path.join(dir, 'escaped.db');
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA query_only = 1');
    db.exec(`ATTACH DATABASE '${f}' AS x`);
    assert.ok(existsSync(f), 'ATTACH under query_only created a file');
    db.exec('PRAGMA query_only = 0');   // untrusted SQL can lift the pragma itself
    db.exec('CREATE TABLE x.t (a)');
    assert.ok(statSync(f).size > 0, 'and then write to it');
    assert.equal(db.prepare('SELECT length(randomblob(1000000)) AS n').get().n, 1000000);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sandbox: ATTACH is refused (static check, authorizer and limit) and writes no file', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rl3-att-'));
  try {
    const f = path.join(dir, 'escaped.db');
    const sql = `ATTACH DATABASE '${f}' AS x`;
    assert.equal(checkSqlText(sql).ok, false);
    const [viaWorker] = runSelect({ tables: T, queries: [{ sql }] });
    assert.equal(viaWorker.ok, false);
    assert.equal(viaWorker.error.code, 'SQL_REFUSED');
    const [direct] = evaluateInProcess({ tables: T, queries: [{ sql }], staticCheck: false });
    assert.equal(direct.ok, false);
    assert.equal(direct.error.code, 'SQL_DENIED');
    assert.ok(!existsSync(f), 'no file was created');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sandbox: randomblob and every function outside the allow-list are refused by the authorizer', () => {
  assert.ok(!FUNCTIONS.has('randomblob') && !FUNCTIONS.has('zeroblob') && !FUNCTIONS.has('load_extension') && !FUNCTIONS.has('printf'));
  const qs = ['SELECT length(randomblob(100000000)) AS n', 'SELECT zeroblob(10)', "SELECT load_extension('x')", "SELECT printf('%.*c', 100000000, 'x')", 'SELECT random()'];
  const res = runSelect({ tables: T, queries: qs.map(sql => ({ sql })) });
  for (const [i, r] of res.entries()) { assert.equal(r.ok, false, qs[i]); assert.equal(r.error.code, 'SQL_DENIED', qs[i]); }
  assert.match(res[0].error.message, /randomblob/);
});

test('sandbox: PRAGMA, writes behind WITH, schema reads and table-valued pragmas are denied by default', () => {
  const qs = ['PRAGMA query_only = 0', "WITH a AS (SELECT 1) INSERT INTO u1 VALUES (3, 30, 'x')", "WITH a AS (SELECT 1) DELETE FROM u1", 'SELECT name FROM sqlite_master', "SELECT * FROM pragma_table_info('u1')"];
  // defence in depth: with the static check off, the authorizer alone refuses each
  const res = evaluateInProcess({ tables: T, queries: qs.map(sql => ({ sql })), staticCheck: false });
  for (const [i, r] of res.entries()) { assert.equal(r.ok, false, qs[i]); assert.equal(r.error.code, 'SQL_DENIED', qs[i]); }
  // a WITH that writes passes the static check (it starts with WITH) and is stopped by the authorizer
  assert.equal(checkSqlText(qs[1]).ok, true);
  assert.equal(runSelect({ tables: T, queries: [{ sql: qs[1] }] })[0].error.code, 'SQL_DENIED');
});

test('sandbox: a trailing statement is refused, not silently dropped (prepare compiles only the first)', () => {
  const sql = 'SELECT 1 AS one; DROP TABLE u1';
  assert.deepEqual(checkSqlText(sql), { ok: false, reason: 'more than one statement' });
  assert.equal(runSelect({ tables: T, queries: [{ sql }] })[0].error.code, 'SQL_REFUSED');
  // without the static check the DROP would be ignored and the query would "succeed": the reason the check exists
  assert.equal(evaluateInProcess({ tables: T, queries: [{ sql }], staticCheck: false })[0].ok, true);
  assert.equal(checkSqlText("SELECT 'a;b' AS v -- ; trailing comment").ok, true, 'a semicolon in a literal or comment is not a statement');
});

test('sandbox: allowed SQL computes with :today; a runaway recursive CTE is killed without hiding the other results', () => {
  const ok = runSelect({ tables: T, queries: [{ sql: 'SELECT sum(Amount) AS v FROM u1 WHERE julianday(:today) - julianday("Due Date") > 20', params: { today: '2026-02-15' } }] });
  assert.deepEqual(ok[0].rows, [{ v: 10 }]);
  const t0 = Date.now();
  const res = runSelect({ tables: T, timeoutMs: 1200, queries: [{ sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c' }, { sql: 'SELECT count(*) AS n FROM u1' }] });
  assert.equal(res[0].ok, false);
  assert.equal(res[0].error.code, 'SQL_TIMEOUT');
  assert.deepEqual(res[1].rows, [{ n: 2 }]);
  assert.ok(Date.now() - t0 < 10_000);
  assert.equal(runSelect({ tables: T, maxRows: 1, queries: [{ sql: 'SELECT * FROM u1' }] })[0].error.code, 'SQL_ROWS');
});

test('sandbox (review finding 2): reader SQL cannot read the host clock or zone; :today and fixed dates still compute', () => {
  const refused = ["SELECT date('now') AS v", 'SELECT date() AS v', 'SELECT unixepoch() AS v', "SELECT strftime('%Y', 'now') AS v", "SELECT strftime('%s') AS v",
    "SELECT date(lower('NOW')) AS v", "SELECT julianday(' now ') AS v", "SELECT datetime('2026-01-01', 'localtime') AS v", "SELECT time('12:00', 'utc') AS v", "SELECT julianday('n' || 'ow') AS v"];
  const res = runSelect({ tables: T, queries: refused.map(sql => ({ sql })) });
  for (const [i, r] of res.entries()) { assert.equal(r.ok, false, refused[i]); assert.equal(r.error.code, 'SQL_CLOCK', refused[i]); }
  const ok = runSelect({ tables: T, queries: [{ sql: "SELECT date('2026-01-31', '+1 month') AS a, julianday('2026-03-01') - julianday('2026-02-01') AS b, strftime('%Y', :today) AS c, unixepoch('2026-01-01') AS d", params: { today: '2026-02-15' } }] });
  assert.deepEqual(ok[0].rows, [{ a: '2026-03-03', b: 28, c: '2026', d: 1767225600 }]);
  assert.equal(hostClockUse('strftime', ['%Y']), 'no time value (the host clock)');
  assert.equal(hostClockUse('date', ['2026-01-01', '+1 day']), null);
  // through Δ*: a predicate on the host clock disposes nothing (it gave hard decisions from the host date before)
  const universes = universesFromInventory(inventory());
  const D = buildDstar({ request: REQUEST, universes, readers: [predicateReader('r1', `julianday('now') - julianday("Due Date") > 30`)] });
  assert.ok(D.dispositions.filter(d => d.uid === VENDORS).every(d => d.disposition === 'unknown' && /SQL_CLOCK/.test(d.basis.why)));
  assert.ok(!D.assertions.some(a => a.origin === 'closure' && a.status === 'hard'));
});

test('sandbox (review finding 3): a spill beyond the file-size cap fails fast instead of filling the shared disk', () => {
  assert.ok(FILE_CAP_BLOCKS * 512 <= 16 * 1024 * 1024, 'the cap is at most 16 MB per worker');
  const big = [{ name: 'u1', columns: [{ name: '_mid', type: 'num' }, { name: 'S', type: 'text' }], rows: [[1, 'x'.repeat(4000)]] }];
  const t0 = Date.now();
  // about 24 MB of distinct keys: far above the cap, and far above SQLite's in-memory sorter budget
  const [r] = runSelect({ tables: big, timeoutMs: 20_000, queries: [{ sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 6000) SELECT count(*) AS n FROM (SELECT DISTINCT x || S AS k FROM c, u1)' }] });
  assert.equal(r.ok, false, 'the sort must not complete by spilling to disk');
  assert.equal(r.error.code, 'SQL_SPILL');
  assert.ok(Date.now() - t0 < 5_000, 'it fails fast');
  // a sort that fits stays fine
  assert.deepEqual(runSelect({ tables: big, queries: [{ sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 500) SELECT count(*) AS n FROM (SELECT DISTINCT x AS k FROM c)' }] })[0].rows, [{ n: 500 }]);
});

test('sandbox (review finding 14): one time budget per call; the day-variants of one predicate fail together; an oversized reply is not a timeout', () => {
  const runaway = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) AS n FROM c WHERE :today IS NOT NULL';
  const days = Array.from({ length: 8 }, (_, i) => ({ sql: runaway, params: { today: `2026-01-0${i + 1}` } }));
  let t0 = Date.now();
  const grouped = runSelect({ tables: T, timeoutMs: 400, budgetMs: 10_000, queries: days, groupOf: () => 'predicate-1' });
  assert.ok(grouped.every(r => r.error?.code === 'SQL_TIMEOUT'));
  assert.ok(Date.now() - t0 < 2_000, 'no rerun variant by variant (8 x 400 ms before)');
  t0 = Date.now();
  const budget = runSelect({ tables: T, timeoutMs: 400, budgetMs: 1_000, queries: days });
  assert.ok(budget.some(r => r.error?.code === 'SQL_BUDGET'), 'nothing starts after the budget');
  assert.ok(Date.now() - t0 < 3_000);
  const [big] = runSelect({ tables: T, maxReplyBytes: 200, queries: [{ sql: 'SELECT * FROM u1, u1 AS b, u1 AS c' }] });
  assert.equal(big.error.code, 'SQL_REPLY');
});

test('sandbox (review finding 4): a predicate is a projected boolean; it cannot close its parentheses or add a query; reads are traced', () => {
  assert.equal(checkPredicateText(`"Status" = 'Active'`).ok, true);
  assert.equal(checkPredicateText('"Amount" > (SELECT avg("Amount") FROM u1)').ok, true, 'a parenthesised subquery is an expression');
  for (const w of ['0) UNION SELECT 1 --', '1) OR (1', '1; DROP TABLE u1', '"A" = 1 UNION SELECT 2', '(1', "'unterminated"]) assert.equal(checkPredicateText(w).ok, false, w);
  const [r] = runSelect({ tables: T, queries: [{ sql: 'SELECT _mid, CASE WHEN ("Amount" > 15) THEN 1 ELSE 0 END AS _hit FROM u1', trace: 'SELECT CASE WHEN ("Amount" > 15) THEN 1 ELSE 0 END FROM u1' }] });
  assert.deepEqual(r.reads, ['u1.Amount'], 'the trace reports the predicate\'s own reads, not the wrapper\'s _mid');
  assert.deepEqual(listLike(['u1.Amount'], 'u1', 'Vendor'), { list: false, why: null });
  for (const reads of [['u1._mid'], ['u1._label'], ['u1.ROWID'], ['u1.Vendor'], ['u1.Employee ID'], [], ['u2.Status']]) assert.equal(listLike(reads, 'u1', 'Vendor').list, true, JSON.stringify(reads));
  assert.equal(listLike(['u1.Status', 'u1._label'], 'u1', 'Vendor').list, true, 'any identifying read makes it a list (no "OR a trivial attribute" escape)');
});

// ---------------------------------------------------------------------------------------------------------------
// The clock (D28 (2)): request date, else business dates, else a labelled null; meta never read

test('clock: explicit, anchored (events), weak (business dates only), unknown; load stamps skipped', () => {
  assert.deepEqual(requestDate('Today is March 3, 2026. Please...'), { value: '2026-03-03', quote: 'Today is March 3, 2026' });
  assert.equal(parseDate('2026-02-30'), null);
  const u = universesFromInventory(inventory());
  const members = u.flatMap(x => x.members);
  const ex = deriveToday({ request: 'As of 2026-01-29 close the list', members });
  assert.equal(ex.status, 'explicit'); assert.deepEqual(ex.domain, ['2026-01-29', '2026-01-29']);
  const an = deriveToday({ request: REQUEST.user, members, horizonDays: 30 });
  assert.equal(an.status, 'anchored'); assert.equal(an.value, '2026-02-10'); assert.deepEqual(an.domain, ['2026-02-10', '2026-03-12']);
  // the message's time is within 12 h before the host read the world: a load stamp, so only the due dates remain (weak)
  const hostNow = Date.parse('2026-02-10T15:00:00Z');
  assert.ok(!businessDates(members, { hostNow }).some(d => d.field === 'date'));
  const weak = deriveToday({ request: REQUEST.user, members, hostNow, horizonDays: 30 });
  assert.equal(weak.status, 'weak'); assert.equal(weak.value, '2026-02-20'); assert.deepEqual(weak.domain, ['2026-01-21', '2026-03-22']);
  const none = deriveToday({ request: 'Tidy the list', members: [{ ptr: 'x', kind: 'row', attrs: { Name: 'A', Note: 'no dates here' } }] });
  assert.deepEqual([none.status, none.value, none.domain], ['unknown', null, null]);
  assert.equal(domainDays(['2026-02-27', '2026-03-02']).length, 4);
});

test('clock (review finding 13): only past-event fields bound today from below; a record\'s "as of" is not the work\'s date', () => {
  const members = [
    { ptr: 'gmail.messages:m1', kind: 'message', attrs: { subject: 'Status', date: '2026-02-10T09:00:00Z' } },
    { ptr: 'google_calendar.events:e1', kind: 'event', attrs: { summary: 'Planning', start: '2026-03-20T10:00:00Z', start_time: '2026-03-20T10:00:00Z' } },
    { ptr: 'zoom.meetings:z1', kind: 'meeting', attrs: { topic: 'Review', start_time: '2026-04-01T10:00:00Z', date: '2026-04-02T10:00:00Z' } },
    { ptr: 'zendesk.tickets:t1', kind: 'ticket', attrs: { subject: 'Onsite visit', start_time: '2026-05-01T10:00:00Z' } },
  ];
  const t = deriveToday({ request: 'Tidy up', members, horizonDays: 30 });
  assert.deepEqual([t.status, t.value], ['anchored', '2026-02-10'], 'a future meeting does not move today forward');
  assert.ok(!businessDates(members).some(d => d.kind === 'event' && d.date >= '2026-03-20'));
  // a reader's "today" quoted from an old record is that record's date; only the request states the work's date
  const records = inventory().records.map(r => (r.app === 'gmail' ? { ...r, data: { ...r.data, body: 'As of 2026-01-15 the policy changed. Vendors on hold must not appear in any summary.' } } : r));
  const universes = universesFromInventory({ records });
  const reader = { ...predicateReader('r1'), today: { value: '2026-01-15', quote: 'As of 2026-01-15' } };
  const D = buildDstar({ request: REQUEST, universes, readers: [reader] });
  assert.notEqual(D.today.status, 'explicit');
  const E = buildDstar({ request: { user: `${REQUEST.user} As of 2026-01-15, use the current list.` }, universes, readers: [reader] });
  assert.deepEqual([E.today.status, E.today.value], ['explicit', '2026-01-15']);
});

test('clock: the simulator meta (hidden clock) is never enumerated', () => {
  const world = { meta: { current_time: '2031-07-07T00:00:00Z' }, google_sheets: { spreadsheets: [{ id: 's', title: 'S' }], worksheets: [{ id: 'w', spreadsheet_id: 's', title: 'W' }], rows: [{ id: 'r1', spreadsheet_id: 's', worksheet_id: 'w', row_id: 2, cells: { Name: 'A', Due: '2026-01-02' } }] } };
  const u = universesFromWorld(world);
  assert.ok(!JSON.stringify(u.map(x => x.members.map(m => m.attrs))).includes('2031'));
  assert.equal(deriveToday({ members: u.flatMap(x => x.members) }).value, '2026-01-02');
});

// ---------------------------------------------------------------------------------------------------------------
// Universes and pointers

test('universes: code enumerates one universe per collection, with labels, mention forms and numeric columns', () => {
  const u = universesFromInventory(inventory());
  assert.deepEqual(u.map(x => x.uid).sort(), ['gmail.message', VENDORS].sort());
  const v = u.find(x => x.uid === VENDORS);
  assert.equal(v.members.length, 3);
  assert.equal(v.labelColumn, 'Vendor');
  assert.deepEqual(v.members.find(m => m.label === 'Globex Corp').forms.slice(0, 2), ['globex corp', 'globex']);
  assert.deepEqual(v.members.find(m => m.label === 'Globex Corp').emails, ['billing@globex.test']);
  const t = sqlTables(u).tables.find(x => x.name === tableOf(u, VENDORS));
  const col = t.columns.findIndex(c => c.name === 'Amount#num');
  assert.ok(col > 0);
  assert.deepEqual(t.rows.map(r => r[col]), [1200, 800, 450]);
  // a person's first name is a form only when no other label carries it; common words never stand alone
  assert.deepEqual(mentionForms('Dana Park', { person: true, others: ['Dana Park', 'Dana Ruiz'] }), ['dana park']);
  assert.deepEqual(mentionForms('Dana Park', { person: true, others: ['Dana Park', 'Lee Ruiz'] }), ['dana park', 'dana']);
  assert.deepEqual(mentionForms('Global Supplies'), ['global supplies']);
});

test('pointers: brackets, case, sheet titles and singular collections resolve; ambiguity never guesses', () => {
  const u = universesFromInventory(inventory());
  const idx = pointerIndex(u);
  const key = `google_sheets:row:${SS}/${WS}#3`;
  for (const [raw, how] of [[`[${key}]`, 'unwrapped'], [key.toUpperCase(), 'case'], ['Vendors/Active Vendors#3', 'sheet-row'], ['Active Vendors#3', 'worksheet-row'], ['gmail.message:m1', 'app-collection-id']]) {
    const h = normalizePointer(raw, idx);
    assert.equal(h.how, how, raw);
    assert.ok(h.m, raw);
  }
  assert.equal(normalizePointer('Vendors/Active Vendors#3', idx).m.key, key);
  const dup = pointerIndex([{ uid: 'a.x', app: 'a', kind: 'x', members: [{ mid: 1, ptr: 'a.x:7', key: 'a.x:7', id: '7', attrs: {} }] }, { uid: 'b.y', app: 'b', kind: 'y', members: [{ mid: 1, ptr: 'b.y:7', key: 'b.y:7', id: '7', attrs: {} }] }]);
  assert.deepEqual([normalizePointer('7', dup).m, normalizePointer('7', dup).how], [null, 'ambiguous']);
  assert.equal(normalizePointer('nothing:here:99', idx).m, null);
  // two members whose pointers differ only by case: a case-folded match is ambiguous, never the first one found
  const cased = pointerIndex([{ uid: 'app.x', app: 'app', kind: 'x', members: [{ mid: 1, ptr: 'app.x:Ab', key: 'app.x:Ab', id: 'Ab', attrs: {} }, { mid: 2, ptr: 'app.x:aB', key: 'app.x:aB', id: 'aB', attrs: {} }] }]);
  assert.equal(normalizePointer('app.x:Ab', cased).m.mid, 1);
  assert.deepEqual([normalizePointer('APP.X:AB', cased).m, normalizePointer('APP.X:AB', cased).how], [null, 'ambiguous']);
});

// ---------------------------------------------------------------------------------------------------------------
// Δ*: dispositions, labelled nulls, consensus, compilation, contract, verdict

test('pointers (review finding 18): an app-qualified pointer never falls back to another app\'s member by its bare id', () => {
  const universes = universesFromWorld({ hubspot: { contacts: [{ id: '501', email: 'a@x.test', firstname: 'Ann', lastname: 'Lee' }] }, salesforce: { contacts: [{ id: '777', Email: 'b@y.test', FirstName: 'Bo', LastName: 'Ray' }] } });
  const idx = pointerIndex(universes);
  assert.equal(normalizePointer('hubspot.contacts:501', idx).m?.id, '501');
  assert.equal(normalizePointer('hubspot.contacts:777', idx).m, null, 'id 777 is a salesforce contact, not a hubspot one');
  assert.equal(normalizePointer('777', idx).m?.id, '777', 'a bare id still resolves when unique');
});

test('Δ*: an executed predicate disposes every member; the complement compiles to hard negatives, the obligation and figure to hard positives', () => {
  const universes = universesFromInventory(inventory());
  const t = tableOf(universes, VENDORS);
  const R = predicateReader('r1', `"Status" = 'Active'`, { figures: [{ id: 'F1', select: `SELECT sum("Amount#num") AS v FROM "${t}" WHERE "Status" = 'Active'`, format: 'money' }] });
  const D = buildDstar({ request: REQUEST, universes, readers: [R] });
  assert.deepEqual(['Acme Supplies Inc', 'Globex Corp', 'Initech LLC'].map(l => disp(D, l).disposition), ['include', 'exclude', 'include']);
  assert.deepEqual(disp(D, 'Globex Corp').basis, { kind: 'predicate', where: `"Status" = 'Active'`, executed: true, complement: true });
  assert.equal(disp(D, 'Globex Corp').hard, true);
  const neg = D.assertions.find(a => a.polarity === 'must_not' && a.label === 'Globex Corp');
  assert.equal(neg.status, 'hard');
  assert.equal(neg.check.type, 'msg_lacks_any');
  assert.deepEqual(neg.check.params.target, { email: 'owner@corp.test' });
  assert.ok(neg.check.params.lits.includes('globex'));
  assert.equal(D.assertions.find(a => a.polarity === 'must' && a.label === 'Acme Supplies Inc').status, 'soft', 'naming each included member in an aggregate is a soft expectation');
  const fig = D.assertions.find(a => a.origin === 'figure');
  assert.deepEqual([fig.status, fig.check.type, fig.check.params.lit], ['hard', 'msg_has', '$1,650']);
  const ob = D.assertions.find(a => a.origin === 'obligation');
  assert.deepEqual([ob.status, ob.check.type, ob.check.params.target.email], ['hard', 'msg_to', 'owner@corp.test']);
  // evaluated on candidate worlds
  const good = evaluateDstar(D, { diff: msgDiff('owner@corp.test', 'Acme Supplies: $1,200. Initech: $450. Total $1,650.'), world0: {}, final: {} });
  const bad = evaluateDstar(D, { diff: msgDiff('owner@corp.test', 'Acme Supplies: $1,200. Initech: $450. Globex: $800. Total $1,650.'), world0: {}, final: {} });
  assert.equal(verdict(D, good).release, true);
  const vb = verdict(D, bad);
  assert.equal(vb.release, false);
  assert.ok(bad.some(r => r.id === neg.id && r.pass === false && /globex/.test(r.evidence)));
  // no message at all: the negative holds vacuously, but the hard obligation and the figure fail
  const none = evaluateDstar(D, { diff: { changes: [] }, world0: {}, final: {} });
  assert.equal(none.find(r => r.id === neg.id).pass, true);
  assert.equal(verdict(D, none).release, false);
});

test('Δ*: a bare reader exclusion is a labelled null; a verbatim quote or an executed test is what makes it hard', () => {
  const universes = universesFromInventory(inventory());
  const p = n => `google_sheets:row:${SS}/${WS}#${n}`;
  const say = buildDstar({ request: REQUEST, universes, readers: [listReader('r1', [{ ptr: p(2), in: true }, { ptr: p(3), in: false }, { ptr: p(4), in: true }])] });
  assert.equal(disp(say, 'Globex Corp').disposition, 'unknown');
  assert.ok(say.unknowns.some(u => u.kind === 'member' && u.label === 'Globex Corp'));
  assert.ok(!say.assertions.some(a => a.polarity === 'must_not' && a.status === 'hard'));
  const quoted = buildDstar({ request: REQUEST, universes, readers: [listReader('r1', [{ ptr: p(3), in: false, quote: { text: 'Vendors on hold must not appear in any summary' } }])] });
  assert.deepEqual([disp(quoted, 'Globex Corp').disposition, disp(quoted, 'Globex Corp').basis.kind, disp(quoted, 'Globex Corp').hard], ['exclude', 'quote', true]);
  const invented = buildDstar({ request: REQUEST, universes, readers: [listReader('r1', [{ ptr: p(3), in: false, quote: { text: 'Globex was terminated last week' } }])] });
  assert.equal(disp(invented, 'Globex Corp').disposition, 'unknown');
  // a listed claim with a deciding value, one per side: too few claims for code to induce a rule (finding 7)
  const tested = buildDstar({ request: REQUEST, universes, readers: [listReader('r1', [{ ptr: p(2), in: true, test: { field: 'Status', value: 'Active' } }, { ptr: p(3), in: false, test: { field: 'status', value: 'On Hold' } }])] });
  assert.deepEqual(['Acme Supplies Inc', 'Globex Corp', 'Initech LLC'].map(l => disp(tested, l).disposition), ['include', 'unknown', 'unknown']);
  assert.equal(disp(tested, 'Acme Supplies Inc').hard, false);
  // a claimed deciding value that the record refutes is a labelled null, not a vote
  const refuted = buildDstar({ request: REQUEST, universes, readers: [listReader('r1', [{ ptr: p(3), in: false, test: { field: 'Status', value: 'Active' } }])] });
  assert.equal(disp(refuted, 'Globex Corp').disposition, 'unknown');
  assert.match(disp(refuted, 'Globex Corp').basis.why, /refuted/, 'the labelled null keeps its reason');
  assert.ok(refuted.ledger.some(v => v.label === 'Globex Corp' && /refuted/.test(v.basis.why)));
});

test('Δ*: a predicate on :today is a certain answer or UNKNOWN over the clock domain; no clock means a labelled null', () => {
  const where = `julianday(:today) - julianday("Due Date") > 30`;
  const universes = universesFromInventory(inventory());
  const D = buildDstar({ request: REQUEST, universes, readers: [predicateReader('r1', where)], horizonDays: 30 });
  assert.equal(D.today.status, 'anchored');
  assert.equal(disp(D, 'Acme Supplies Inc').disposition, 'include');   // overdue on every day of the domain
  assert.equal(disp(D, 'Globex Corp').disposition, 'exclude');          // never overdue inside the domain
  assert.equal(disp(D, 'Initech LLC').disposition, 'unknown');          // flips inside the domain
  assert.match(disp(D, 'Initech LLC').basis.why, /flips inside the clock domain/);
  assert.ok(D.unknowns.some(u => u.kind === 'member' && u.label === 'Initech LLC' && u.clock), 'a clock-dependent member is on the assumption list');
  assert.ok(!D.unknowns.some(u => u.label === 'Acme Supplies Inc' || u.label === 'Globex Corp'));
  const noClock = buildDstar({ request: REQUEST, universes: universesFromInventory({ records: inventory().records.map(r => (r.kind === 'row' ? { ...r, data: { ...r.data, 'Due Date': 'soon' } } : r)).filter(r => r.app !== 'gmail') }), readers: [predicateReader('r1', `"Due Date" <> :today`)] });
  assert.equal(noClock.today.status, 'unknown');
  assert.ok(noClock.unknowns.some(u => u.kind === 'today'));
  assert.ok(noClock.dispositions.every(d => d.disposition === 'unknown'));
  assert.ok(!noClock.assertions.some(a => a.status === 'hard' && a.origin === 'closure'));
});

test('Δ*: a figure that changes inside the clock domain is UNKNOWN (no hard literal); a stable one is certain', () => {
  const universes = universesFromInventory(inventory());
  const t = tableOf(universes, VENDORS);
  const R = predicateReader('r1', `"Status" = 'Active'`, { figures: [
    { id: 'overdue', select: `SELECT sum("Amount#num") AS v FROM "${t}" WHERE julianday(:today) - julianday("Due Date") > 30`, format: 'money' },
    { id: 'all', select: `SELECT sum("Amount#num") AS v FROM "${t}" WHERE julianday("Due Date") <= julianday(:today) + 400`, format: 'money' },
  ] });
  const D = buildDstar({ request: REQUEST, universes, readers: [R], horizonDays: 30 });
  const [overdue, all] = ['overdue', 'all'].map(id => D.figures.find(f => f.id === id));
  assert.equal(overdue.status, 'unknown');
  assert.ok(overdue.distinctOverDomain > 1);
  assert.ok(D.unknowns.some(u => u.kind === 'value' && u.about === 'overdue'));
  assert.equal(all.status, 'certain');
  const lits = D.assertions.filter(a => a.origin === 'figure').map(a => a.check.params.lit);
  assert.deepEqual(lits, ['$2,450']);
});

test('Δ*: hostile reader SQL disposes nothing (every member UNKNOWN) and never crashes the build', () => {
  const universes = universesFromInventory(inventory());
  for (const where of [`"Status" = 'Active' AND length(randomblob(100000000)) > 0`, `1) UNION SELECT rowid FROM sqlite_master --`, `1); ATTACH DATABASE 'x.db' AS x; SELECT (1`]) {
    const D = buildDstar({ request: REQUEST, universes, readers: [predicateReader('r1', where)] });
    const own = D.dispositions.filter(d => d.uid === VENDORS);
    assert.equal(own.length, 3, where);
    assert.ok(own.every(d => d.disposition === 'unknown' && d.basis.kind === 'null'), where);
    assert.ok(!D.assertions.some(a => a.origin === 'closure' && a.status === 'hard'), where);
  }
});

test('Δ* (review finding 4): a list of names or ids posing as a predicate never makes a hard disposition', () => {
  const universes = universesFromInventory(inventory());
  const t = tableOf(universes, VENDORS);
  for (const where of ['_mid IN (1, 3)', `"_label" IN ('Acme Supplies Inc', 'Initech LLC')`, `"Vendor" <> 'Globex Corp'`, 'rowid <> 2', '1', `"Status" = 'Active' OR _mid = 2`]) {
    const D = buildDstar({ request: REQUEST, universes, readers: [predicateReader('r1', where)] });
    const own = D.dispositions.filter(d => d.uid === VENDORS);
    assert.ok(!own.some(d => d.hard), where);
    assert.ok(!own.some(d => d.disposition === 'exclude'), where);
    assert.ok(own.filter(d => d.disposition === 'include').every(d => d.basis.kind === 'reader' && d.basis.verified === false), where);
    assert.ok(!D.assertions.some(a => a.origin === 'closure' && a.status === 'hard'), where);
  }
  // the old splice: "0) UNION SELECT 1 --" turned every member into a hard decision
  const inj = buildDstar({ request: REQUEST, universes, readers: [predicateReader('r1', '0) UNION SELECT 1 --')] });
  assert.ok(inj.dispositions.filter(d => d.uid === VENDORS).every(d => d.disposition === 'unknown'));
  // control: a rule over attributes still executes and stays hard
  const rule = buildDstar({ request: REQUEST, universes, readers: [predicateReader('r1', `"Status" = 'Active' AND "Amount#num" > 0`)] });
  assert.deepEqual([disp(rule, 'Globex Corp').disposition, disp(rule, 'Globex Corp').hard], ['exclude', true]);
  assert.ok(t);
});

test('Δ* (review finding 7): a rule code induces from listed claims is not a reader rule: never verified, never hard, never extrapolated', () => {
  const rows = [['Acme Supplies Inc', 'Active', '$1,200'], ['Globex Corp', 'On Hold', '$800'], ['Initech LLC', 'Active', '$450'], ['Umbrella Group', 'On Hold', '$90'], ['Hooli Labs', 'Active', '$30'], ['Vandelay Imports', 'Closed', '$10']];
  const universes = universesFromInventory({ records: rows.map(([v, st, a], i) => rowRec(i + 2, { Vendor: v, Status: st, Amount: a })) });
  const p = n => `google_sheets:row:${SS}/${WS}#${n}`;
  const claims = [{ ptr: p(2), in: true, test: { field: 'Status', value: 'Active' } }, { ptr: p(4), in: true, test: { field: 'Status', value: 'Active' } }, { ptr: p(3), in: false, test: { field: 'Status', value: 'On Hold' } }, { ptr: p(5), in: false, test: { field: 'Status', value: 'On Hold' } }];
  assert.equal(INDUCE_MIN_PER_SIDE, 2);
  const D = buildDstar({ request: REQUEST, universes, readers: [listReader('r1', claims)] });
  assert.equal(D.ledger.find(v => v.label === 'Hooli Labs').basis.kind, 'induced', 'the unlisted active member is placed by the induced rule');
  assert.deepEqual([disp(D, 'Hooli Labs').disposition, disp(D, 'Hooli Labs').hard], ['include', false], 'an induced include is soft');
  assert.equal(disp(D, 'Globex Corp').disposition, 'unknown', 'an induced exclusion is a labelled null');
  assert.ok(D.unknowns.some(u => u.label === 'Globex Corp'), 'and is on the assumption list');
  assert.equal(disp(D, 'Vandelay Imports').disposition, 'unknown', 'a value no claim showed is not placed');
  assert.ok(!D.assertions.some(a => a.status === 'hard' && a.polarity === 'must_not'));
  // a reader's unverified include does not win over another reader's induced exclusion: the member stays UNKNOWN
  const two = buildDstar({ request: REQUEST, universes, readers: [listReader('r1', claims), listReader('r2', [{ ptr: p(3), in: true }])] });
  assert.equal(disp(two, 'Globex Corp').disposition, 'unknown');
});

test('Δ* (review finding 6): grounded content literals and targets compile to hard positives; ungrounded ones are soft and listed', () => {
  const universes = universesFromInventory(inventory());
  const R = { reader: 'r1', obligations: [
    { id: 'O1', effect: 'send_email', app: 'gmail', target: { emails: ['owner@corp.test'] }, literals: ['active vendor', 'Quarterly close is complete'] },
    { id: 'O2', effect: 'send_email', app: 'gmail', target: { emails: ['nobody@invented.test'] }, literals: [] },
    { id: 'O3', effect: 'post_message', app: 'slack', target: { channel: 'ops-invented' }, literals: [] },
    { id: 'O4', effect: 'create_record', app: 'hubspot', target: {}, literals: ['Globex Corp'] },
  ] };
  const D = buildDstar({ request: REQUEST, universes, readers: [R] });
  const find = (type, pred) => D.assertions.find(a => a.check.type === type && pred(a.check.params));
  assert.equal(find('msg_has', P => P.lit === 'active vendor').status, 'hard', 'the request carries it');
  assert.equal(find('msg_has', P => P.lit === 'Quarterly close is complete').status, 'soft', 'no source carries it');
  assert.ok(D.unknowns.some(u => u.kind === 'value' && u.about === 'Quarterly close is complete'));
  assert.equal(find('msg_to', P => P.target.email === 'owner@corp.test').status, 'hard');
  assert.equal(find('msg_to', P => P.target.email === 'nobody@invented.test').status, 'soft', 'an invented recipient is not grounded');
  assert.ok(D.unknowns.some(u => u.kind === 'target' && u.about === 'nobody@invented.test'));
  assert.equal(find('post_in', P => P.target.channel.name === 'ops-invented').status, 'soft');
  assert.equal(find('created_has', P => P.lit === 'Globex Corp').status, 'hard', 'a record carries the literal');
  // evaluated: the hard literal fails on a world whose message lacks it
  const bad = evaluateDstar(D, { diff: msgDiff('owner@corp.test', 'Done.'), world0: {}, final: {} });
  assert.equal(bad.find(r => r.id === find('msg_has', P => P.lit === 'active vendor').id).pass, false);
  // a certain figure is a hard literal only on a grounded target
  const t = tableOf(universes, VENDORS);
  const F = buildDstar({ request: REQUEST, universes, readers: [predicateReader('r1', `"Status" = 'Active'`, { target: { emails: ['nobody@invented.test'] }, figures: [{ id: 'F1', select: `SELECT sum("Amount#num") AS v FROM "${t}" WHERE "Status" = 'Active'`, format: 'money' }] })] });
  assert.deepEqual(F.assertions.filter(a => a.origin === 'figure').map(a => a.status), ['soft']);
  const g = grounding({ requestText: 'post in #finance-ops', records: [] });
  assert.deepEqual([g.channel({ id: null, name: 'finance-ops' }), g.channel({ id: null, name: 'finance' }), g.channel({ id: 'C1', name: 'x' })], [true, false, true]);
});

test('Δ* (review finding 5): the verdict maps a failed soft check and an undecided check to UNKNOWN on the assumption list, never to a pass', () => {
  const D = { unknowns: [{ id: 'U-today', kind: 'today' }], assertions: [
    { id: 'h1', status: 'hard', polarity: 'must', check: { key: 'k-h1' } }, { id: 's1', status: 'soft', polarity: 'must', check: { key: 'k-s1' } },
    { id: 's2', status: 'soft', polarity: 'must_not', check: { key: 'k-s2' } }, { id: 'h2', status: 'hard', polarity: 'must_not', check: { key: 'k-h2' } }] };
  const v = verdict(D, [{ key: 'k-h1', pass: true }, { key: 'k-s1', pass: false, evidence: 'lacks it' }, { key: 'k-s2', pass: true }, { key: 'k-h2', pass: null }]);
  assert.deepEqual(v.rows.map(r => r.verdict), ['SUPPORTED', 'UNKNOWN', 'SUPPORTED', 'UNKNOWN']);
  assert.equal(v.release, true, 'no FAILED: the run releases, with its assumptions shown');
  assert.deepEqual(v.assumptions.map(a => a.about ?? a.kind), ['today', 's1', 'h2']);
  assert.match(v.assumptions[1].why, /soft check failed/);
  const f = verdict(D, [{ key: 'k-h1', pass: false }]);
  assert.deepEqual([f.release, f.failed, f.rows[0].verdict], [false, 1, 'FAILED']);
});

test('Δ*: consensus: with three readers a hard exclusion needs two verified votes and no more votes against', () => {
  const universes = universesFromInventory(inventory());
  const p = n => `google_sheets:row:${SS}/${WS}#${n}`;
  const one = buildDstar({ request: REQUEST, universes, readers: [predicateReader('a'), listReader('b', [{ ptr: p(3), in: false }]), listReader('c', [{ ptr: p(2), in: true }])] });
  assert.equal(disp(one, 'Globex Corp').disposition, 'unknown');
  const two = buildDstar({ request: REQUEST, universes, readers: [predicateReader('a'), predicateReader('b', `"Status" <> 'On Hold'`), listReader('c', [{ ptr: p(2), in: true }])] });
  assert.equal(disp(two, 'Globex Corp').disposition, 'exclude');
  assert.equal(disp(two, 'Globex Corp').hard, true);
  const always = `"Status" IS NOT NULL`;
  const against = buildDstar({ request: REQUEST, universes, readers: [predicateReader('a'), predicateReader('b'), predicateReader('c', always), predicateReader('d', always), predicateReader('e', always)] });
  assert.equal(disp(against, 'Globex Corp').disposition, 'include', 'three verified includes outvote two verified excludes');
  // an unverified majority never overrides a verified vote: two say-so includes against one executed exclusion
  const sayso = buildDstar({ request: REQUEST, universes, readers: [predicateReader('a'), listReader('b', [{ ptr: p(3), in: true }]), listReader('c', [{ ptr: p(3), in: true }])] });
  assert.equal(disp(sayso, 'Globex Corp').disposition, 'unknown');
});

test('Δ*: per-item updates compile the excluded members into hard record negatives', () => {
  const universes = universesFromInventory(inventory());
  const R = { reader: 'r1', obligations: [{ id: 'O1', effect: 'update_row', app: 'google_sheets', target: {}, set: { field: 'Status', value: 'Paid' }, selections: [{ universe: VENDORS, where: `"Status" = 'Active'`, perItem: true }] }] };
  const D = buildDstar({ request: REQUEST, universes, readers: [R] });
  const neg = D.assertions.find(a => a.polarity === 'must_not' && a.label === 'Globex Corp');
  assert.deepEqual([neg.status, neg.check.type, neg.check.params.field, neg.check.params.value, neg.diff_type], ['hard', 'rec_field_not', 'Status', 'Paid', 'changed']);
  const pos = D.assertions.filter(a => a.polarity === 'must' && a.check.type === 'rec_field');
  assert.equal(pos.length, 2);
  assert.ok(pos.every(a => a.status === 'hard'));
});

test('Δ*: the contract has the Agent-Diff state-diff shape, and UNKNOWN is never a pass', () => {
  const universes = universesFromInventory(inventory());
  const D = buildDstar({ request: REQUEST, universes, readers: [predicateReader('r1', `julianday(:today) - julianday("Due Date") > 30`)] });
  const C = agentDiffContract(D);
  assert.equal(C.strict, true);
  assert.ok(C.assertions.length > 0);
  for (const a of C.assertions) {
    assert.ok(['added', 'changed', 'removed'].includes(a.diff_type));
    assert.equal(typeof a.entity, 'string');
    assert.equal(typeof a.where, 'object');
    assert.ok(a.expected_count === 0 || (a.expected_count && a.expected_count.min === 1));
    assert.equal(a.strict, a.status === 'hard');
  }
  assert.ok(C.unknowns.some(u => u.kind === 'member' && u.member === `google_sheets:row:${SS}/${WS}#4`));
  // an assertion with no result is UNKNOWN; UNKNOWNs are listed as assumptions, never counted as supported
  const v = verdict(D, []);
  assert.equal(v.supported, 0);
  assert.equal(v.unknown, D.assertions.length + D.unknowns.length);
  assert.deepEqual(v.assumptions.slice(0, D.unknowns.length), D.unknowns);
  assert.equal(v.assumptions.length, D.unknowns.length + D.assertions.length, 'every undecided check is on the assumption list');
});

test('Δ*: direct prohibitions are hard only with consensus, a verified quote, no contradiction and no condition', () => {
  const universes = universesFromInventory(inventory());
  const records = universes.flatMap(u => u.members);
  const requestText = `${REQUEST.user}\n${REQUEST.system}`;
  const pidx = pointerIndex(universes);
  const quote = { text: 'Vendors on hold must not appear in any summary' };
  const P = (statement, extra = {}) => ({ reader: 'r1', prohibitions: [{ effect: 'send_email', target: { emails: ['auditor@corp.test'] }, literals: [], quote, statement, ...extra }] });
  const base = { pidx, chans: [], requestText, records, need: 1 };
  assert.equal(compileProhibitions([P('Do not email the auditor')], base)[0].status, 'hard');
  assert.equal(compileProhibitions([P('Do not email the auditor', { quote: { text: 'an invented rule' } })], base)[0].status, 'soft');
  assert.equal(compileProhibitions([P('Do not email the auditor until the review closes')], base)[0].status, 'soft');
  const positive = [{ polarity: 'must', check: { params: { target: { email: 'auditor@corp.test' } } } }];
  assert.equal(compileProhibitions([P('Do not email the auditor')], { ...base, assertions: positive })[0].basis.contradicted, true);
  // a banned literal that is a member's label bans its mention forms too
  const lit = compileProhibitions([{ reader: 'r1', prohibitions: [{ effect: 'send_email', target: { emails: ['owner@corp.test'] }, literals: ['Globex Corp'], quote, statement: 'never mention Globex Corp' }] }], base)[0];
  assert.deepEqual([lit.check.type, lit.check.params.lits.includes('globex')], ['msg_lacks_any', true]);
});

test('Δ*: helpers: quote verification, absence claims, induced tests, figure formats', () => {
  const universes = universesFromInventory(inventory());
  const records = universes.flatMap(u => u.members);
  assert.equal(verifyQuote('Report only active vendors', { requestText: '', records }), 'gmail.messages:m1');
  assert.equal(verifyQuote('abc', { requestText: 'abc', records }), false, 'too short to verify');
  const m = { attrs: { Status: 'Active', Note: '' } };
  assert.equal(holdsTest({ field: 'status', value: 'ACTIVE' }, m), true);
  assert.equal(holdsTest({ field: 'Note', value: '(none)' }, m), true);
  assert.equal(holdsTest({ field: 'Missing', value: 'x' }, m), null);
  const u = universes.find(x => x.uid === VENDORS);
  const by = l => u.members.find(x => x.label === l);
  const am = v => ({ attrs: { Amount: v } });
  assert.equal(induceTest([{ m: by('Acme Supplies Inc'), want: 'include', field: 'Amount' }, { m: by('Globex Corp'), want: 'exclude', field: 'Amount' }], u), null, 'one claim per side is not a rule (finding 7)');
  const th = induceTest([{ m: am('$1,200'), want: 'include', field: 'Amount' }, { m: am('$1,500'), want: 'include', field: 'Amount' }, { m: am('$300'), want: 'exclude', field: 'Amount' }, { m: am('$800'), want: 'exclude', field: 'Amount' }], u);
  assert.equal(th.kind, 'threshold');
  assert.equal(th.apply(by('Initech LLC')), 'exclude', '450 lies inside the observed exclude range [300, 800]');
  assert.equal(th.apply(am('$1,000')), null, 'a value between the two sides is not placed');
  assert.equal(th.apply(am('$5,000')), null, 'no extrapolation above the include range');
  assert.equal(th.apply(am('$50')), null, 'no extrapolation below the exclude range');
  assert.equal(induceTest([{ m: by('Acme Supplies Inc'), want: 'include', field: 'Status' }, { m: by('Initech LLC'), want: 'include', field: 'Status' }], u), null, 'one side only is not a rule');
  assert.deepEqual([formatFigure([{ v: 1650 }], 'money'), formatFigure([{ v: 1650.5 }], 'grouped'), formatFigure([{ v: 3.6 }], 'integer'), formatFigure([{ v: 7 }], 'Count: {v}'), formatFigure([], 'money')], ['$1,650', '1,650.5', '4', 'Count: 7', null]);
});

test('adapters: stored reader shapes become claims, never verdicts', () => {
  const R = adaptA1cLedger({ reader: 1, requirements: [
    { id: 'q1', polarity: 'positive', action: 'send_email', app: 'gmail', target: 'owner@corp.test', fields: [{ name: 'body', value: 'Total $1,650' }], candidates: [{ record: `[google_sheets:row:${SS}/${WS}#3]`, eligible: false, decidingField: 'Status', value: 'On Hold' }] },
    { id: 'q2', polarity: 'negative', action: 'send_email', app: 'gmail', target: 'auditor@corp.test', fields: [], rule: { quote: 'x', source: 'request' }, statement: 'never' },
  ] });
  assert.equal(R.reader, 'a1c:1');
  assert.deepEqual(R.obligations[0].target.emails, ['owner@corp.test']);
  assert.deepEqual(R.obligations[0].selections[0].members[0], { ptr: `[google_sheets:row:${SS}/${WS}#3]`, in: false, test: { field: 'Status', value: 'On Hold' }, quote: null });
  assert.equal(R.prohibitions[0].target.emails[0], 'auditor@corp.test');
  const X = adaptRl2Extraction({ items: [{ ptr: 'a.x:1', label: 'Globex Corp', in_scope: false }, { ptr: 'a.x:2', label: 'Acme', in_scope: true }], requirements: [{ id: 'r1', kind: 'must', effect: 'send_email', recipients: ['owner@corp.test'], statement: 'summarise Acme', must_include: [] }] });
  assert.deepEqual(X.obligations[0].selections[0].members.map(m => m.in), [false, true]);
});

// ---------------------------------------------------------------------------------------------------------------
// Hygiene (PREREG-AB-v1 H7/H8; ATTACK and VERIFIER-LAB stay out of verifier and harness code)

test('hygiene: Δ* and harness/v3 sources carry no task names, grader check names, lab paths or ceiling notes', () => {
  const files = ['dstar.mjs', 'universe.mjs', 'pointers.mjs', 'sqlsafe.mjs', 'clock.mjs', 'adapters.mjs', 'evaluate.mjs', 'check.mjs', 'lib.mjs'].map(f => path.join(HERE, f));
  const v3 = path.join(HERE, '../../harness/v3');
  for (const f of ['gate.mjs', 'registry.mjs']) files.push(path.join(v3, f));
  const bad = [/\b(finance|hr|marketing|operations|sales|support)\.[a-z]+_[a-z_]+\b/, /gmail_message_sent|google_sheets_row_|_with_body_contains|slack_message_(not_)?in_channel|salesforce_field_equals|task_completed_correctly|partial_credit|assertion_results/,
    /\/var\/tmp\/foundry-work|vlab|dataset\.jsonl|grade\.json|ceiling\.md|strata\.json|VERIFIER-LAB|ATTACK\.md|hard[- ]defect|soft[- ]defect/];
  // the hidden clock may be named in a comment that says it is never read; code must not read it
  const hidden = /current_time|(?<!import)\.meta\b|(?<![.\w])meta\s*(\.|\[)/;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const re of bad) assert.ok(!re.test(src), `${path.basename(f)} matches ${re}`);
    const code = src.split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
    assert.ok(!hidden.test(code), `${path.basename(f)} reads the hidden clock`);
  }
});
