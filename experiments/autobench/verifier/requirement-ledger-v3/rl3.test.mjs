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
import { FUNCTIONS, checkSqlText, evaluateInProcess, runSelect } from './sqlsafe.mjs';
import { businessDates, deriveToday, domainDays, parseDate, requestDate } from './clock.mjs';
import { mentionForms, sqlTables, universesFromInventory, universesFromWorld } from './universe.mjs';
import { normalizePointer, pointerIndex } from './pointers.mjs';
import { agentDiffContract, buildDstar, compileProhibitions, formatFigure, holdsTest, induceTest, verdict, verifyQuote } from './dstar.mjs';
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
  // a listed claim with a deciding value: code induces the rule from the claims and executes it on EVERY member
  const tested = buildDstar({ request: REQUEST, universes, readers: [listReader('r1', [{ ptr: p(2), in: true, test: { field: 'Status', value: 'Active' } }, { ptr: p(3), in: false, test: { field: 'status', value: 'On Hold' } }])] });
  assert.deepEqual(['Acme Supplies Inc', 'Globex Corp', 'Initech LLC'].map(l => disp(tested, l).disposition), ['include', 'exclude', 'include']);
  assert.equal(disp(tested, 'Initech LLC').basis.induced, 'categorical');
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

test('Δ*: consensus: with three readers a hard exclusion needs two verified votes and no more votes against', () => {
  const universes = universesFromInventory(inventory());
  const p = n => `google_sheets:row:${SS}/${WS}#${n}`;
  const one = buildDstar({ request: REQUEST, universes, readers: [predicateReader('a'), listReader('b', [{ ptr: p(3), in: false }]), listReader('c', [{ ptr: p(2), in: true }])] });
  assert.equal(disp(one, 'Globex Corp').disposition, 'unknown');
  const two = buildDstar({ request: REQUEST, universes, readers: [predicateReader('a'), predicateReader('b', `"Status" <> 'On Hold'`), listReader('c', [{ ptr: p(2), in: true }])] });
  assert.equal(disp(two, 'Globex Corp').disposition, 'exclude');
  assert.equal(disp(two, 'Globex Corp').hard, true);
  const against = buildDstar({ request: REQUEST, universes, readers: [predicateReader('a'), predicateReader('b'), predicateReader('c', '1 = 1'), predicateReader('d', '1 = 1'), predicateReader('e', '1 = 1')] });
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
  assert.deepEqual(v.assumptions, D.unknowns);
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
  const th = induceTest([{ m: by('Acme Supplies Inc'), want: 'include', field: 'Amount' }, { m: by('Globex Corp'), want: 'exclude', field: 'Amount' }], u);
  assert.equal(th.kind, 'threshold');
  assert.equal(th.apply(by('Initech LLC')), 'exclude', '450 is on the exclude side of the observed split');
  assert.equal(th.apply({ attrs: { Amount: '$1,000' } }), null, 'a value between the two sides is not placed');
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
