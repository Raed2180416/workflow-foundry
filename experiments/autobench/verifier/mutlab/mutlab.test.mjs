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
import { b64urlDecode, b64urlEncode, blankText, bumpFigure, dropReads, dropTail, dropWrite, dupWrite, extraWrite, figuresIn, flat, isWrite, mutantsOf, perturbNumber, reword, slotsOf, swapRecipient, writesOf } from './mutate.mjs';
import { collectionsOf, touchedIds, twinsOf } from './twins.mjs';
import { runAllowed, worldEmails } from './labio.mjs';
import { assertionClass, auroc, spearman } from './score.mjs';

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
  // known limit of mutate-v1 (the rule the lab ran with): space-separated phone groups read as figures
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

const py = (code) => spawnSync('python3', ['-I', '-c', code], { encoding: 'utf8' });
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
