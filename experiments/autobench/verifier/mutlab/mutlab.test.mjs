// Move 4 tests: mutation operators, world twins, the lab's hygiene, the replay driver's id carry-forward and class map,
// and the scoring statistics. Pure (no stored data needed); the Python checks run replay_batch.py's pure helpers with the
// system python3 in isolated mode (nothing of AutomationBench is imported).
//   nice -n 15 node --test --test-concurrency=1 experiments/autobench/verifier/mutlab/mutlab.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { b64urlDecode, b64urlEncode, blankText, bumpFigure, bumpNumber, dropReads, dropTail, dropWrite, dupWrite, extraCreate, extraWrite, figuresIn, flat, isWrite, mutantsOf, perturbNumber, reword, slotsOf, swapRecipient, writeKind, writesOf } from './mutate.mjs';
import { collectionsOf, touchedIds, twinsOf } from './twins.mjs';
import { runAllowed, underRun, viewOf, worldEmails } from './labio.mjs';
import { recordsOf } from './jobs.mjs';
import { assertionClass, auroc, blindSpots, classValidity, labCalibration, operatorTable, replayFidelity, spearman, verifierScores } from './score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fetchCall = (method, url, body, orig = '{"id":"r1"}') => ({ name: 'api_fetch', arguments: JSON.stringify({ method, url, params: null, body: body === null ? null : JSON.stringify(body) }), orig });
const mime = (to, body) => b64urlEncode(`To: ${to}\r\nSubject: Report\r\n\r\n${body}`);
const LOG = [
  { calls: [fetchCall('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages', null, '{"messages":[]}'), fetchCall('POST', 'https://api.hubapi.com/crm/v3/objects/contacts/search', { q: 'x' })] },
  { calls: [fetchCall('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: mime('a@corp.example', 'Total is $5,600 for 2026-02-15.\nRegards') })] },
  { calls: [fetchCall('POST', 'https://slack.com/api/chat.postMessage', { channel: 'C1', text: 'Posted the weekly summary for the finance team: 12 invoices.' }),
    fetchCall('PATCH', 'https://x.salesforce.com/services/data/v58.0/sobjects/Lead/LEAD-0001', { Status: 'Qualified' })] },
];
const WORLD = { meta: { current_time: '2026-02-15T09:00:00Z' }, gmail: { messages: [{ id: 'msg_a1', to: ['a@corp.example'] }] },
  salesforce: { leads: [{ id: 'LEAD-0001', Name: 'Ann', Email: 'ann@corp.example' }, { id: 'LEAD-0002', Name: 'Bob', Email: 'bob@corp.example' }] } };

test('write classification: GET and search/list POSTs and GraphQL queries are reads; sends, patches and mutations are writes', () => {
  const ws = writesOf(LOG);
  assert.equal(ws.length, 3);
  assert.equal(isWrite(fetchCall('POST', 'https://gql.example.com/graphql/public', { query: 'query { invoices { id } }' })), false);
  assert.equal(isWrite(fetchCall('POST', 'https://gql.example.com/graphql/public', { query: 'mutation { send(id: 1) { ok } }' })), true);
  assert.equal(isWrite({ name: 'base64_encode', arguments: '{}' }), false);
  assert.equal(isWrite({ name: 'gmail.users.messages.send', arguments: '{}' }), true);
  assert.equal(isWrite({ name: 'gmail.users.messages.list', arguments: '{}' }), false);
});

test('operators change exactly what they claim and never their input', () => {
  const before = JSON.stringify(LOG);
  const ctx = { seed: 'row-1', worldEmails: worldEmails(WORLD), records: collectionsOf(WORLD).flatMap(c => c.records.map(r => ({ app: c.app, coll: c.coll, id: r.id }))) };
  const dw = dropWrite(LOG, ctx);
  assert.equal(dw.length, 2);
  for (const m of dw) { assert.equal(writesOf(m.steps).length, 2); assert.equal(flat(m.steps).length, flat(LOG).length - 1); }
  assert.equal(writesOf(dropTail(LOG)[0].steps).length, 1);
  const dr = dropReads(LOG)[0];
  assert.equal(flat(dr.steps).length, 3);
  assert.ok(flat(dr.steps).every(x => isWrite(x.call)));
  const dup = dupWrite(LOG, ctx)[0];
  assert.equal(flat(dup.steps).length, flat(LOG).length + 1);
  assert.equal(flat(dup.steps).filter(x => x.call.orig === null).length, 1, 'the copy adds no id mapping');
  const sw = swapRecipient(LOG, ctx)[0];
  const sent = JSON.parse(JSON.parse(flat(sw.steps).find(x => x.call.arguments.includes('send')).call.arguments).body).raw;
  assert.match(b64urlDecode(sent), /^To: (ann|bob)@corp\.example\r\n/, 'one recipient replaced by an unused address of the world');
  const pn = perturbNumber(LOG, ctx)[0];
  const diffChars = (x, y) => [...x].filter((ch, i) => ch !== y[i]).length;
  const changed = flat(pn.steps).map((x, i) => [x.call.arguments, flat(LOG)[i].call.arguments]).filter(([p, q]) => p !== q);
  assert.equal(changed.length, 1, 'one call changed');
  assert.ok(pn.note.startsWith('figure in'));
  const bl = blankText(LOG, ctx)[0];
  assert.equal(flat(bl.steps).filter((x, i) => x.call.arguments !== flat(LOG)[i].call.arguments).length, 1);
  const rw = reword(LOG, ctx)[0];
  assert.ok(flat(rw.steps).some(x => x.call.arguments.includes('Thank you.') || b64urlDecode(JSON.parse(JSON.parse(x.call.arguments).body ?? '{}').raw ?? '').includes('Thank you.')));
  const ex = extraWrite(LOG, ctx)[0];
  assert.ok(ex, 'the PATCH on LEAD-0001 is repeated on an untouched lead');
  assert.ok(flat(ex.steps).some(x => x.call.arguments.includes('LEAD-0002')));
  assert.equal(JSON.stringify(LOG), before, 'inputs unchanged');
  // determinism: same seed, same mutants; another seed may pick other writes
  assert.deepEqual(mutantsOf(LOG, ctx).map(m => JSON.stringify(m.steps)), mutantsOf(LOG, ctx).map(m => JSON.stringify(m.steps)));
  // the perturbation is a minimal edit: inside the changed call, the decoded text differs by one character
  const [pa, qa] = changed[0].map(s => { const b = JSON.parse(JSON.parse(s).body ?? 'null'); return b?.raw ? b64urlDecode(b.raw) : JSON.stringify(b); });
  assert.equal(pa.length, qa.length);
  assert.equal(diffChars(pa, qa), 1);
});

test('figures: dates, times, years and ids are not figures; the bump moves one digit and keeps the format', () => {
  assert.deepEqual(figuresIn('Total $5,600 on 2026-02-15 at 09:30 for INV-6001 (12 items, 3.5%) in 2026').map(f => f.text), ['$5,600', '12', '3.5']);
  assert.deepEqual(figuresIn('Due 2026-03-01T09:30:00Z, pages 10-20, ref a1/22, v2.5.1, call +1-555-0100 x').map(f => f.text), [], 'timestamps, ranges, paths, versions and dashed phones are not figures');
  // known limit (mutate v1 and v2): space-separated phone groups read as figures
  assert.deepEqual(figuresIn('+1 555 0100').map(f => f.text), ['555', '0100']);
  assert.equal(bumpFigure('$5,600'), '$5,601');
  assert.equal(bumpFigure('3.9'), '3.8');
  // teeth: a naive number regex would also "perturb" the date and the id
  const naive = '2026-02-15 INV-6001'.match(/\d{2,}/g);
  assert.ok(naive.length >= 3);
  assert.equal(figuresIn('2026-02-15 INV-6001').length, 0);
});

test('MIME slots: the raw message round-trips; recipient and body are editable, an encoded body is not', () => {
  const raw = mime('a@corp.example', 'Hello');
  assert.equal(b64urlDecode(raw), 'To: a@corp.example\r\nSubject: Report\r\n\r\nHello');
  const call = fetchCall('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw });
  const slots = slotsOf(call);
  assert.deepEqual(slots.map(s => s.kind).sort(), ['recipient', 'text']);
  const enc = fetchCall('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: b64urlEncode('To: a@corp.example\r\nContent-Transfer-Encoding: base64\r\n\r\nSGVsbG8=') });
  assert.deepEqual(slotsOf(enc).map(s => s.kind), ['recipient']);
});

test('twins: permute reverses; decoys get fresh unique ids; touched records are those a write names', () => {
  const touched = touchedIds(WORLD, LOG);
  assert.deepEqual([...touched], ['salesforce.leads#LEAD-0001']);
  const tw = twinsOf(WORLD, LOG, { seed: 's' });
  assert.deepEqual(tw.map(t => t.twin).sort(), ['decoy_touched', 'decoy_untouched', 'permute', 'rename_untouched']);
  const per = tw.find(t => t.twin === 'permute').world0;
  assert.deepEqual(per.salesforce.leads.map(r => r.id), ['LEAD-0002', 'LEAD-0001']);
  const dt = tw.find(t => t.twin === 'decoy_touched').world0.salesforce.leads;
  assert.equal(dt.length, 3);
  assert.equal(new Set(dt.map(r => r.id)).size, 3);
  const copy = dt[2];
  assert.deepEqual({ ...copy, id: null }, { ...WORLD.salesforce.leads[0], id: null }, 'the copy differs only by its id');
  const du = tw.find(t => t.twin === 'decoy_untouched').world0.salesforce.leads;
  assert.deepEqual({ ...du[2], id: null }, { ...WORLD.salesforce.leads[1], id: null });
  assert.equal(tw.find(t => t.twin === 'rename_untouched').world0.salesforce.leads[1].Name, 'Bob II');
  assert.equal(WORLD.salesforce.leads.length, 2, 'input unchanged');
  assert.equal(tw.find(t => t.twin === 'decoy_touched').expect, 'incomplete');
});

test('hygiene: only dev60 runs are readable; verifier-side modules never touch grade fields or task names', () => {
  for (const r of ['a0-dev60-dn', 'm3-a1c-dev60-dn-fill']) assert.equal(runAllowed(r), true);
  for (const r of ['a0o-look2-1', 'a1c-v1-look2', 'a0-devcheck-1', 'raw-haiku-60', 'sealed-dev60', 'a1s-look2']) assert.equal(runAllowed(r), false, r);
  const strata = JSON.parse(readFileSync(path.join(HERE, '../../../../research/blockers-20261021/move0/dev60-ceiling-strata.json'), 'utf8'));
  const names = [...strata.hard, ...strata.soft];
  const verifierSide = ['mutate.mjs', 'twins.mjs', 'verify.mjs', '../tristate/verdict.mjs', '../tristate/adapters.mjs', '../tristate/riskcov.mjs', '../../../lib/infopath.mjs'];
  // the IO layer (labio: labels kept apart from the verifier view) and the seed chooser (jobs: official passes) may read a
  // label; neither may name a task
  for (const f of [...verifierSide, 'labio.mjs', 'jobs.mjs', 'score.mjs', '../tristate/run.mjs', '../kappa/tables.mjs']) {
    const src = readFileSync(path.join(HERE, f), 'utf8');
    for (const n of names) assert.ok(!src.includes(n) && !src.includes(n.split('.')[1]), `${f} names a dev60 task`);
  }
  for (const f of verifierSide) {
    const src = readFileSync(path.join(HERE, f), 'utf8');
    assert.ok(!/assertion_results|task_completed_correctly|failedByClass|nPassed|partial_credit|labelPass/.test(src), `${f} touches a grade field`);
  }
});

const py = (code) => spawnSync('python3', ['-I', '-B', '-c', code], { encoding: 'utf8' });   // -B: no bytecode next to the sources
const LOAD = `import importlib.util, json, sys\nspec = importlib.util.spec_from_file_location('rb', ${JSON.stringify(path.join(HERE, 'replay_batch.py'))})\nm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n`;

test('replay driver: ids under id-like keys carry forward to later calls; other changed values do not (python helpers)', (t) => {
  if (py('print(1)').status !== 0) { t.skip('python3 not available'); return; }
  const r = py(`${LOAD}o = {'id': 'msg_abc123', 'threadId': 't_9', 'created_at': '2026-01-01', 'to': 'a@x', 'labels': [{'id': 'L1'}]}
n = {'id': 'msg_zzz999', 'threadId': 't_7', 'created_at': '2026-11-04', 'to': 'b@x', 'labels': [{'id': 'L1'}]}
mp = m.id_pairs(o, n)
print(json.dumps({'map': mp, 'text': m.remap_text('{"url": "/messages/msg_abc123/modify", "thread": "t_9"}', mp)}))`);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.map, { msg_abc123: 'msg_zzz999' }, 'short ids (< 4 chars) and non-id keys are not mapped');
  assert.equal(out.text, '{"url": "/messages/msg_zzz999/modify", "thread": "t_9"}');
});

test('the assertion-class map is the same rule in the replay driver and in the scorer (teeth: a different rule disagrees)', (t) => {
  const types = ['gmail_message_sent_to', 'gmail_message_not_sent_to', 'slack_message_contains', 'sheets_cell_value_equals', 'gmail_message_is_read', 'asana_action_recorded',
    'calendar_event_created', 'record_field_not_equal', 'helpcrunch_customer_has_tag', 'something_else', 'zendesk_ticket_updated', 'twilio_sms_body_contains'];
  assert.deepEqual(types.map(assertionClass), ['existence', 'prohibition', 'content', 'content', 'flag', 'action-key', 'existence', 'prohibition', 'flag', 'other', 'existence', 'content']);
  if (py('print(1)').status !== 0) { t.skip('python3 not available'); return; }
  const r = py(`${LOAD}print(json.dumps([m.assertion_class(t) for t in ${JSON.stringify(types)}]))`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), types.map(assertionClass));
  const other = x => (x.includes('not') ? 'prohibition' : 'content');
  assert.notDeepEqual(types.map(other), types.map(assertionClass));
});

test('scoring statistics: Spearman with ties, AUROC with ties', () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.ok(Math.abs(spearman([1, 1, 2, 2], [1, 2, 3, 4]) - 0.894427) < 1e-5);
  // average ranks for ties (a tie at the low end and singletons above: min-ranking gives 0.9467)
  assert.ok(Math.abs(spearman([1, 1, 2, 3], [1, 2, 3, 4]) - 3 / Math.sqrt(10)) < 1e-9);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), null);
  assert.equal(auroc([3, 2, 1, 0], [true, true, false, false]), 1);
  assert.equal(auroc([1, 1, 1, 1], [true, false, true, false]), 0.5);
  // teeth: Pearson on raw values is not rank-invariant; Spearman is
  const x = [1, 2, 3, 100], y = [1, 2, 3, 4];
  const mean = v => v.reduce((s, z) => s + z, 0) / v.length, mx = mean(x), my = mean(y);
  const pearson = x.reduce((s, z, i) => s + (z - mx) * (y[i] - my), 0) / Math.sqrt(x.reduce((s, z) => s + (z - mx) ** 2, 0) * y.reduce((s, z) => s + (z - my) ** 2, 0));
  assert.ok(pearson < 0.9);
  assert.equal(spearman(x, y), 1);
});

// ---------------- review fixes (2026-11-04) ----------------

test('review 10: dup_write repeats only a send or a create; update-like POSTs are not duplicated (teeth: v1 took any POST)', () => {
  const modify = fetchCall('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify', { addLabelIds: ['L1'] });
  const addTag = fetchCall('POST', 'https://app.asana.com/api/1.0/tasks/t1/addTag', { tag: 'x' });
  const create = fetchCall('POST', 'https://api.example.com/api/v2/tickets', { subject: 'S' });
  const send = fetchCall('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: mime('a@corp.example', 'Hi') });
  const post = fetchCall('POST', 'https://slack.com/api/chat.postMessage', { channel: 'C1', text: 'x' });
  const append = fetchCall('POST', 'https://sheets.googleapis.com/v4/spreadsheets/s1/values/Log!A1:D1:append', { values: [['a']] });
  assert.deepEqual([modify, addTag, create, send, post, append].map(writeKind), ['update', 'update', 'create', 'send', 'send', 'create']);
  assert.equal(writeKind(fetchCall('PATCH', 'https://x.example.com/r/1', { a: 1 })), 'update');
  assert.equal(writeKind(fetchCall('DELETE', 'https://x.example.com/r/1', null)), 'delete');
  assert.equal(writeKind(fetchCall('GET', 'https://x.example.com/r/1', null)), null);
  assert.equal(writeKind({ name: 'gmail.users.messages.send', arguments: '{}' }), 'send');
  assert.equal(writeKind({ name: 'zoom.users.meetings.create', arguments: '{}' }), 'create');
  const onlyUpdates = [{ calls: [modify, addTag] }];
  assert.deepEqual(dupWrite(onlyUpdates, { seed: 's' }), [], 'no send or create: no duplicate');
  const v1IsCreate = c => JSON.parse(c.arguments).method === 'POST';
  assert.ok(flat(onlyUpdates).some(x => v1IsCreate(x.call)), 'teeth: v1 would have "duplicated" an update');
  const d = dupWrite([{ calls: [modify, create] }], { seed: 's' })[0];
  assert.equal(d.sub, 'create');
  assert.equal(flat(d.steps).filter(x => x.call.arguments === create.arguments).length, 2);
});

test('review 10: a number moves by one in its last digit (teeth: v1 scaled a decimal by 1.1)', () => {
  assert.equal(bumpNumber(12.5), 12.6);
  assert.equal(bumpNumber(40), 41);
  assert.equal(bumpNumber(19), 18);
  assert.equal(bumpNumber(1250.75), 1250.76);
  assert.notEqual(bumpNumber(12.5), Math.round(12.5 * 110) / 100, 'v1: 13.75');
  const log = [{ calls: [fetchCall('POST', 'https://api.example.com/invoices', { amount: 12.5, note: 'n' })] }];
  const m = perturbNumber(log, { seed: 's' })[0];
  assert.equal(JSON.parse(JSON.parse(flat(m.steps)[0].call.arguments).body).amount, 12.6);
});

test('review 11: extra_create adds one more send/create for an entity the run never referenced (the forbidden row)', () => {
  const ctx = { seed: 'row-1', worldEmails: worldEmails(WORLD), records: recordsOf(WORLD) };
  const before = JSON.stringify(LOG);
  const [m] = extraCreate(LOG, ctx);
  assert.equal(m.op, 'extra_create');
  assert.equal(m.intended, 'wrong');
  assert.equal(flat(m.steps).length, flat(LOG).length + 1);
  const added = flat(m.steps).find(x => x.call.orig === null && !flat(LOG).some(y => y.call.arguments === x.call.arguments));
  assert.ok(added, 'the added call differs from every call of the run');
  const raw = JSON.parse(JSON.parse(added.call.arguments).body).raw;
  if (raw) assert.match(b64urlDecode(raw), /^To: (ann|bob)@corp\.example\r\n/, 'addressed to an address of the world nobody was written to');
  assert.equal(m.sub, 'recipient');
  assert.equal(JSON.stringify(LOG), before, 'input unchanged');
  // id route: a create that names a world record is copied for an untouched record of the same collection
  const note = [{ calls: [fetchCall('POST', 'https://x.salesforce.com/services/data/v58.0/sobjects/Note', { ParentId: 'LEAD-0001', Body: 'Called the client today about renewal.' })] }];
  const [n] = extraCreate(note, { seed: 's', worldEmails: [], records: recordsOf(WORLD) });
  assert.equal(n.sub, 'id');
  assert.ok(flat(n.steps).some(x => x.call.arguments.includes('LEAD-0002')));
  assert.equal(flat(n.steps).filter(x => x.call.arguments.includes('LEAD-0001')).length, 1, 'the original write is kept');
  // the target is an entity NO call of the run references (a lead the run read is not "never referenced"), for any seed
  const W3 = { salesforce: { leads: [{ id: 'LEAD-0001', Name: 'Ann' }, { id: 'LEAD-0002', Name: 'Bob' }, { id: 'LEAD-0003', Name: 'Cyd' }, { id: 'LEAD-0004', Name: 'Dee' }] } };
  const read3 = [{ calls: [fetchCall('GET', 'https://x.salesforce.com/services/data/v58.0/sobjects/Lead/LEAD-0003', null, '{}')] }, ...note];
  for (let i = 0; i < 20; i++) {
    const [z] = extraCreate(read3, { seed: `s${i}`, worldEmails: [], records: recordsOf(W3) });
    const added = flat(z.steps).filter(x => x.call.orig === null).map(x => x.call.arguments);
    assert.equal(added.length, 1);
    assert.ok(!/LEAD-000[13]/.test(added[0]), `seed s${i}: the copy targets a referenced lead`);
  }
  // teeth: a duplicate is not a forbidden row (same entity), and nothing applies to a run without a send or create
  const [d] = dupWrite(note, { seed: 's' });
  assert.ok(!flat(d.steps).some(x => x.call.arguments.includes('LEAD-0002')));
  assert.deepEqual(extraCreate([{ calls: [fetchCall('PATCH', 'https://x.salesforce.com/services/data/v58.0/sobjects/Lead/LEAD-0001', { Status: 'Q' })] }], { seed: 's', worldEmails: worldEmails(WORLD), records: recordsOf(WORLD) }), []);
  assert.ok(mutantsOf(LOG, ctx).some(x => x.op === 'extra_create'));
});

test('review 17 / 5: host and prep paths are checked as resolved directories; the hidden clock is withheld from the view', () => {
  assert.equal(underRun('/var/tmp/w/autobench/a0-dev60/host/t.x/fork-0', 'a0-dev60', 'host'), true);
  assert.equal(underRun('/var/tmp/w/autobench/a0-dev60/prep/t.x', 'a0-dev60', 'prep'), true);
  const sneaky = '/var/tmp/w/autobench/a0-dev60/host/../../a0o-look2-1/host/t.x/fork-0';
  assert.equal(underRun(sneaky, 'a0-dev60', 'host'), false);
  assert.equal(sneaky.includes('/a0-dev60/host/'), true, 'teeth: v1 substring check accepted it');
  assert.equal(underRun('/var/tmp/w/autobench/a0-dev60/prep/t.x', 'a0-dev60', 'host'), false);
  assert.equal(underRun('/var/tmp/w/autobench/a0o-look2-1/host/t', 'a0o-look2-1', 'host'), false, 'a forbidden run never resolves');
  assert.equal(underRun('/var/tmp/w/autobench/a0-dev60/host', 'a0-dev60', 'host'), false, 'the run directory itself is not a row');
  const row = { rowId: 'r', prompt: { system: 's', user: 'u' }, today: '2026-02-15T09:00:00Z', services: ['gmail'], diff: { changes: [] } };
  assert.equal(viewOf(row).today, null, 'D28 (2): the clock is hidden by default');
  assert.equal(viewOf(row, row.diff, { clock: true }).today, '2026-02-15T09:00:00Z');
  assert.deepEqual(recordsOf(WORLD).map(r => r.name), [null, 'Ann', 'Bob']);
});

// ---- score.mjs (review 7, 8, 9, 14, 16): fixtures for every decision the scorer makes

const mk = (task, op, kind, pass, sev, accept, cls = [], extra = {}) => ({ id: `${task}-${op}-${Math.random()}`, m: { task, op, kind, seed: task, seedRow: `row-${task}`, intended: 'wrong', ...extra },
  o: { pass: pass ? 1 : 0, finalSha: 'x', nScored: 10, nPassed: Math.round(10 * (1 - sev)), failedByClass: Object.fromEntries(cls.map(c => [c, 1])), callErrors: 0 }, v: { acc: accept, bad: accept ? 0 : 1 } });
const V = { accept: v => v.acc, bad: v => v.bad };

test('review 9: class validity excludes noops, carries a task-cluster interval and leave-one-class-out values (teeth: noops change the lab miss rates)', () => {
  const lab = [], real = [];
  const classes = ['content', 'prohibition', 'existence', 'flag'];
  const missBy = { content: 0.1, prohibition: 0.3, existence: 0.5, flag: 0.7 }, faBy = { content: 0.2, prohibition: 0.4, existence: 0.6, flag: 0.3 };
  for (let t = 0; t < 12; t++) for (const c of classes) {
    for (let k = 0; k < 10; k++) lab.push({ task: `t${t}`, op: 'drop_write', failing: true, classes: new Set([c]), accept: k < 10 * missBy[c] });
    for (let k = 0; k < 10; k++) real.push({ task: `t${t}`, classes: new Set([c]), accept: k < 10 * faBy[c] });
  }
  // noops fail every class and are rejected by every verifier
  for (let t = 0; t < 12; t++) for (let k = 0; k < 20; k++) lab.push({ task: `t${t}`, op: 'noop', failing: true, classes: new Set(classes), accept: false });
  const v = classValidity(lab, real, { B: 200 });
  assert.equal(v.k, 4);
  assert.ok(Math.abs(v.classes.content.labMiss - 0.1) < 1e-9, 'noops excluded');
  const withNoop = classValidity(lab, real, { B: 0, excludeNoop: false });
  assert.ok(withNoop.classes.content.labMiss < 0.1 - 0.02, 'teeth: counting noops dilutes every lab miss rate');
  assert.equal(v.spearman, spearman([0.1, 0.3, 0.5, 0.7], [0.2, 0.4, 0.6, 0.3]));
  assert.ok(v.ci.lo !== null && v.ci.lo <= v.spearman && v.spearman <= v.ci.hi);
  assert.equal(v.leaveOneOut.flag, 1, 'without the one out-of-order class the ordering is perfect: the result hangs on one cell');
  assert.ok(v.pAtLeast >= 0 && v.pAtLeast <= 1);
  // cells under minCell are dropped
  assert.equal(classValidity(lab, [...real.filter(x => !x.classes.has('flag')), ...real.filter(x => x.classes.has('flag')).slice(0, 3)], { B: 0 }).k, 3);
});

test('review 8: the lab-calibrated threshold\'s gap splits into a base-rate part and a miss-rate part (teeth: v1 reported only the product)', () => {
  const it = (task, y, rel) => ({ task, y, v: rel ? { S: 1, F: 0, U: 0, unknownShare: 0, release: true } : { S: 0, F: 1, U: 0, unknownShare: 1, release: false } });
  const lab = [], real = [];
  for (let i = 0; i < 100; i++) lab.push(it(`f${i}`, false, i < 20));
  for (let i = 0; i < 100; i++) lab.push(it(`p${i}`, true, i < 80));
  for (let i = 0; i < 60; i++) real.push(it(`rf${i}`, false, i < 30));
  for (let i = 0; i < 20; i++) real.push(it(`rp${i}`, true, i < 16));
  const c = labCalibration(lab, real, { alpha: 0.3, delta: 0.1 });
  assert.equal(c.theta !== null, true);
  assert.ok(Math.abs(c.lab.risk - 0.2) < 1e-9);
  assert.ok(Math.abs(c.stored.risk - 30 / 46) < 1e-9);
  assert.ok(Math.abs(c.labRates.missRate - 0.2) < 1e-9 && Math.abs(c.storedRates.missRate - 0.5) < 1e-9);
  assert.ok(Math.abs(c.missRatio - 2.5) < 1e-9);
  assert.ok(Math.abs(c.riskAtRealBase - 0.15 / 0.35) < 1e-9, 'the lab rates at the real base rate (75% failing)');
  assert.ok(Math.abs(c.gap.baseRate * c.gap.missRate - c.gap.total) < 1e-9);
  assert.ok(c.gap.baseRate > 2, 'most of the gap here is the base rate, which the v1 "lab understates risk" reading folded into the lab');
});

test('review 14 / 7: severity rho is exploratory and reported without controls and noops; per-class kill excludes noops', () => {
  const mut = [];
  for (let t = 0; t < 8; t++) {
    mut.push(mk(`t${t}`, 'control', 'control', true, 0, true));
    mut.push(mk(`t${t}`, 'noop', 'mutant', false, 1, false, ['content']));
    // core mutants: severity unrelated to the verdict
    mut.push(mk(`t${t}`, 'drop_write', 'mutant', false, 0.3, t % 2 === 0, ['content']));
    mut.push(mk(`t${t}`, 'reword', 'mutant', true, 0, t % 2 === 1));
  }
  const s = verifierScores(mut, V, { B: 100 });
  assert.equal(s.severityRho.exploratory, true);
  assert.ok(s.severityRho.all.rho > s.severityRho.core.rho + 0.2, `teeth: noops and controls inflate rho (${s.severityRho.all.rho} vs ${s.severityRho.core.rho})`);
  assert.equal(s.severityRho.core.n, 16);
  assert.equal(s.perClass.content.n, 8, 'noops left out of the class rates');
  assert.equal(s.kill.n, 16, 'noops still count in the overall kill rate');
});

test('review 16 / 10: replay fidelity per verifier; operator sub-kinds; pooled blind spot without noops', () => {
  const pairs = [{ control: { acc: true, shape: 'a' }, stored: { acc: true, shape: 'a' } }, { control: { acc: false, shape: 'b' }, stored: { acc: true, shape: 'c' } }, { control: { acc: true, shape: 'd' }, stored: { acc: true, shape: 'd' } }];
  const f = replayFidelity(pairs, { v: V }, { replay: [1, 3], stored: [1, 3] });
  assert.deepEqual(f.perVerifier.v, { n: 3, differ: 1, rejectControl: 1, rejectStored: 0 });
  assert.equal(f.shapeEqual, 2);
  assert.equal(f.callErrors.replayMean, f.callErrors.storedMean);
  const items = [mk('a', 'dup_write', 'mutant', true, 0, true, [], { sub: 'send' }), mk('b', 'dup_write', 'mutant', false, 0.2, false, ['existence'], { sub: 'create' }),
    mk('c', 'dup_write', 'mutant', true, 0, true, [], { sub: 'send' }), mk('d', 'noop', 'mutant', false, 1, false), mk('e', 'reword', 'mutant', true, 0, true, [], { intended: 'equivalent' })];
  const ops = operatorTable(items);
  assert.deepEqual(Object.keys(ops.dup_write.bySub), ['create', 'send']);
  assert.equal(ops.dup_write.bySub.send.n, 2);
  assert.equal(ops.dup_write.bySub.send.officialFail.k, 0);
  const b = blindSpots(items);
  assert.deepEqual([b.pooledWithoutNoop.k, b.pooledWithoutNoop.n], [2, 3], 'two of three intended-wrong edits pass officially; the noop and the equivalent are left out');
  assert.equal(b.perOp.dup_write.bySub.send.k, 2);
});
