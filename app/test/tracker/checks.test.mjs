// The tracker's code-owned semantics: templates, statuses, gates, lint, words and scenarios. $0, no model, no run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, valuesAt, normText, renderCheck, holds } from '../../core/tracker/checks.mjs';
import { statusOf, tally } from '../../core/tracker/status.mjs';
import { realShape, twinOf, crossBuild } from '../../core/tracker/gates.mjs';
import { lintCheck, appVocabulary, parseCatalogLine } from '../../core/tracker/vocab.mjs';
import { wordsOf, locate, unitsOf, numbersIn, grounded } from '../../core/tracker/words.mjs';
import { scenarioRows } from '../../core/tracker/scenarios.mjs';
import { toCheck, toConditions, captureRule } from '../../core/tracker/model.mjs';

const NOW = '2026-10-20T09:00:00Z';
const lead = (name, email, region, extra = {}) => ({ name, email, region, status: 'new', ...extra });
const leads = [lead('Ann Able', 'ann@a.example', 'EMEA'), lead('Bob Baker', 'bob@b.example', 'NA'), lead('Cy Crane', 'cy@c.example', 'APAC'), lead('Old Owl', 'old@d.example', 'EMEA', { status: 'contacted' })];
function view(effects, { sources = { leads }, id = 'v', horizon = null } = {}) {
  return { id, now: NOW, horizon, sources: Object.fromEntries(Object.entries(sources).map(([k, rows]) => [k, rows.map((r, i) => ({ id: `${k}#${i}`, at: null, names: [r.name, r.email].filter(Boolean), fields: r }))])),
    effects: effects.map((e, i) => ({ id: `e${i + 1}`, seq: i + 1, at: e.at ?? NOW, status: e.status ?? 'applied', channel: e.channel ?? 'email', fields: e.fields, subject: e.subject ?? null,
      text: e.text ?? Object.values(e.fields).filter(v => typeof v === 'string').join('\n') })) };
}
const mail = (to, subject, body = '') => ({ channel: 'email', fields: { to, subject, body } });
const route = { template: 'when-then', source: 'leads', filter: [{ path: 'region', op: 'eq', value: 'EMEA' }], channel: 'email', link: { item: 'name', effect: '*', op: 'mentions' }, require: [{ path: 'to', op: 'eq', value: 'dana@peak.example' }] };

test('text semantics: word boundaries, e-mails exact, [*] paths', () => {
  assert.equal(normText('Hannah @ Little  Fern, Bakery!'), 'hannah little fern bakery');
  assert.equal(normText('Mail lena@brook.example. Ref INV-1.'), 'mail lena@brook.example ref inv-1');
  assert.ok(holds({ body: 'Thanks,\nHannah @ Little Fern Bakery' }, { path: 'body', op: 'contains', value: 'Hannah @ Little Fern Bakery' }));
  assert.ok(!holds({ s: 'unpaid' }, { path: 's', op: 'contains', value: 'paid' }), '"paid" is not inside "unpaid"');
  assert.ok(holds({ s: 'it was approved' }, { path: 's', op: 'contains', value: 'approve' }), 'a 6+ letter stem matches its inflection');
  assert.ok(!holds({ n: 'call 2000' }, { path: 'n', op: 'contains', value: '200' }));
  assert.ok(holds({ to: 'Dana@Peak.example' }, { path: 'to', op: 'eq', value: 'dana@peak.example' }));
  assert.ok(!holds({ to: 'xdana@peak.example' }, { path: 'to', op: 'eq', value: 'dana@peak.example' }));
  assert.deepEqual(valuesAt({ args: { items: [{ key: 'a' }, { key: 'b' }] } }, 'args.items[*].key'), ['a', 'b']);
  assert.deepEqual(valuesAt({ a: 1 }, 'b.c'), [], 'a path that names nothing matches nothing');
  assert.ok(holds({ due: '2026-10-10' }, { path: 'due', op: 'ageDaysGte', n: 10 }, { view: { now: NOW } }));
  assert.ok(!holds({ due: '2026-10-11' }, { path: 'due', op: 'ageDaysGte', n: 10 }, { view: { now: NOW } }));
});

test('present / absent / field: refused proposals count as attempts only in field', () => {
  const v = view([mail('priya@k.example', 'Weekly', 'done: A'), { ...mail('x@y.example', 'refused', 'no'), status: 'refused' }]);
  assert.equal(evaluate({ template: 'present', channel: 'email', where: [{ path: 'to', op: 'eq', value: 'priya@k.example' }] }, v).violated, 0);
  assert.equal(evaluate({ template: 'present', channel: 'email', where: [{ path: 'to', op: 'eq', value: 'x@y.example' }] }, v).violated, 1, 'a refused send did not happen');
  assert.equal(evaluate({ template: 'absent', channel: 'email', where: [{ path: 'to', op: 'inColumn', source: 'leads', column: 'email' }] }, v).violated, 0);
  const f = evaluate({ template: 'field', channel: 'email', where: [], require: [{ path: 'body', op: 'nonEmpty' }, { path: 'to', op: 'contains', value: 'example' }] }, v);
  assert.equal(f.activated, 2, 'field reads applied and refused effects');
  const bad = evaluate({ template: 'field', channel: 'email', require: [{ path: 'subject', op: 'eq', value: 'Weekly' }] }, v);
  assert.equal(bad.violated, 1); assert.match(bad.instances.find(i => !i.ok).why, /refused/);
});

test('when-then is gated: right answer met, wrong answer unmet, untouched undecided; ambiguous names undecided', () => {
  const right = evaluate(route, view([mail('dana@peak.example', 'Lead Ann Able'), mail('kai@x.example', 'Lead Bob Baker')]));
  assert.deepEqual(right.instances.map(i => i.ok), [true, null], 'Ann routed right; Old Owl never acted on');
  const wrong = evaluate(route, view([mail('kai@x.example', 'New lead: Ann Able')]));
  assert.equal(wrong.violated, 1); assert.match(wrong.instances[0].why, /does not meet/);
  const untouched = evaluate(route, view([]));
  assert.equal(untouched.decided, 0); assert.equal(untouched.notActedOn, 2);
  const twins = [lead('Same', 'same@x.example', 'EMEA'), lead('Same', 'same@x.example', 'EMEA')];
  const amb = evaluate(route, view([mail('kai@x.example', 'Same')], { sources: { leads: twins } }));
  assert.ok(amb.instances.every(i => i.ok === null && /shared/.test(i.why)), 'no name of their own: undecided');
  const dupes = [lead('Same', 's1@x.example', 'EMEA'), lead('Same', 's2@x.example', 'EMEA')];
  const byShared = evaluate(route, view([mail('kai@x.example', 'Same')], { sources: { leads: dupes } }));
  assert.ok(byShared.instances.every(i => i.ok === null && i.why === 'not acted on'), 'an effect naming only a shared name acts on neither');
  const byOwn = evaluate(route, view([mail('kai@x.example', 'Lead s1@x.example')], { sources: { leads: dupes } }));
  assert.deepEqual(byOwn.instances.map(i => i.ok), [false, null], 'a unique name still identifies the lead, whatever column the link chose');
});

test('when-then windows (inclusive), censoring, forbidBefore; triggers that are effects', () => {
  const orders = [{ orderId: 'O-1', placedAt: '2026-10-20T08:00:00Z' }, { orderId: 'O-2', placedAt: '2026-10-20T08:30:00Z' }];
  const check = { template: 'when-then', source: 'orders', filter: [], channel: 'orders.create', link: { item: 'orderId', effect: 'args.orderId', op: 'id' }, within: { anchor: 'placedAt', min: 0, max: 60 } };
  const v = view([{ channel: 'orders.create', at: '2026-10-20T09:00:00Z', fields: { args: { orderId: 'o-1' } } }, { channel: 'orders.create', at: '2026-10-20T09:31:00Z', fields: { args: { orderId: 'O-2' } } }],
    { sources: { orders }, horizon: '2026-10-20T12:00:00Z' });
  assert.deepEqual(evaluate(check, v).instances.map(i => i.ok), [true, false], 'exactly 60 min is inside; 61 is late');
  const cens = view([{ channel: 'other', fields: { args: { orderId: 'O-2' } }, text: 'O-2' }], { sources: { orders: [orders[1]] }, horizon: '2026-10-20T09:00:00Z' });
  assert.equal(evaluate(check, cens).instances[0].ok, null, 'window still open at the horizon');
  // A partial reserve (an effect) must be followed by a re-reserve of the same fulfilment, with no release first.
  const eff = [{ channel: 'inventory.reserve', fields: { args: { fulfilmentId: 'F1', items: [{ key: 'k1' }] }, result: { status: 'partial' } } },
    { channel: 'inventory.release', fields: { args: { fulfilmentId: 'F1' } } }, { channel: 'inventory.reserve', fields: { args: { fulfilmentId: 'F1', items: [{ key: 'k1' }] }, result: { status: 'ok' } } }];
  const ev = view(eff, { sources: {} });
  ev.sources.reserves = ev.effects.filter(e => e.channel === 'inventory.reserve').map(e => ({ id: e.id, at: e.at, isEffect: true, names: [], fields: e.fields }));
  const p162 = { template: 'when-then', source: 'reserves', filter: [{ path: 'result.status', op: 'eq', value: 'partial' }], channel: 'inventory.reserve',
    link: { item: 'args.fulfilmentId', effect: 'args.fulfilmentId', op: 'eq' }, require: [{ path: 'args.items[*].key', op: 'subsetOf', itemPath: 'args.items[*].key' }],
    forbidBefore: { channel: 'inventory.release', where: [] } };
  const r = evaluate(p162, ev);
  assert.equal(r.instances.length, 1); assert.equal(r.instances[0].ok, false); assert.match(r.instances[0].why, /release came first/);
  ev.effects.splice(1, 1);
  assert.equal(evaluate(p162, ev).instances[0].ok, true);
});

test('count is strict per item; scope forbids naming out-of-scope items; order', () => {
  const inv = [{ invoice: 'INV-1', email: 'a@x.example', status: 'open' }, { invoice: 'INV-2', email: 'b@x.example', status: 'paid' }];
  const once = { template: 'count', channel: 'email', op: 'atMost', n: 1, source: 'invoices', filter: [], link: { item: 'email', effect: 'to', op: 'eq' } };
  const v = view([mail('a@x.example', 'INV-1'), mail('a@x.example', 'INV-1 again')], { sources: { invoices: inv } });
  assert.deepEqual(evaluate(once, v).instances.map(i => i.ok), [false, true]);
  const atLeast = { ...once, op: 'atLeast', filter: [{ path: 'status', op: 'eq', value: 'open' }] };
  assert.equal(evaluate(atLeast, view([], { sources: { invoices: inv } })).violated, 1, 'count does not wait for the flow to act');
  const scope = { template: 'scope', source: 'invoices', filter: [{ path: 'status', op: 'eq', value: 'open' }], channel: 'email', link: { item: 'invoice', effect: '*', op: 'mentions' } };
  const sv = evaluate(scope, view([mail('a@x.example', 'INV-1'), mail('b@x.example', 'Reminder INV-2')], { sources: { invoices: inv } }));
  assert.deepEqual(sv.instances.map(i => i.ok), [true, false]);
  const order = { template: 'order', first: { channel: 'carrier.cancel' }, then: { channel: 'billing.refund' }, link: { first: 'args.orderId', then: 'args.orderId', op: 'id' } };
  const ov = view([{ channel: 'billing.refund', fields: { args: { orderId: 'O1' } } }, { channel: 'carrier.cancel', fields: { args: { orderId: 'O1' } } }], { sources: {} });
  assert.equal(evaluate(order, ov).violated, 1);
  assert.match(renderCheck(route), /When the flow handles a leads item where region is “EMEA”/);
});

test('statuses: untested is never met; suspect and inspection are unknown; waivers bind version and hash', () => {
  const c = { id: 'C-001', version: 2, check: route, verification: 'test' };
  const res = v => [evaluate(route, v)];
  assert.equal(statusOf(c, { results: res(view([])) }).reason, 'not-exercised');
  assert.equal(statusOf(c, { results: res(view([mail('kai@x.example', 'Ann Able')])) }).status, 'unmet');
  const met = statusOf(c, { results: res(view([mail('dana@peak.example', 'Ann Able')])) });
  assert.deepEqual([met.status, met.thin], ['met', true]);
  assert.equal(statusOf(c, { results: res(view([mail('kai@x.example', 'Ann Able')])), flags: ['suspect'] }).reason, 'check-suspect');
  assert.equal(statusOf({ ...c, verification: 'inspection', why: 'a schedule' }).reason, 'unverifiable');
  assert.equal(statusOf({ ...c, check: null, missing: ['Which address?'] }).reason, 'needs-answer');
  const w = { conditionVersion: 2, workflowHash: 'h1', by: 'me', why: 'ok for now' };
  assert.equal(statusOf(c, { results: res(view([])), waiver: w, workflowHash: 'h1' }).status, 'waived');
  assert.equal(statusOf(c, { results: res(view([])), waiver: w, workflowHash: 'h2' }).status, 'unknown', 'a new flow version re-opens it');
  assert.equal(statusOf({ ...c, version: 3 }, { results: res(view([])), waiver: w, workflowHash: 'h1' }).status, 'unknown', 'a new condition version re-opens it');
  assert.deepEqual(tally([{ status: 'met' }, { status: 'unknown', reason: 'no-check' }]).unknownBy, { 'no-check': 1 });
});

test('real-shape gate: a twin of a real passing instance must fail; unexercised checks have no teeth to show', () => {
  const v = view([mail('dana@peak.example', 'Ann Able')]);
  const g = realShape(route, [v]);
  assert.deepEqual([g.exercised, g.teeth], [true, true]);
  const twin = twinOf(route, v, evaluate(route, v).instances[0]);
  assert.equal(evaluate(route, twin).instances[0].ok, false, 'the moved answer still names the lead, so the lead is acted on and unmet');
  assert.deepEqual([realShape(route, [view([])]).exercised, realShape(route, [view([])]).teeth], [false, null]);
  const absent = { template: 'absent', channel: 'email', where: [{ path: 'to', op: 'inColumn', source: 'leads', column: 'email' }] };
  assert.equal(realShape(absent, [v]).teeth, true, 'a synthesized e-mail to a lead fails it');
  const field = { template: 'field', channel: 'email', where: [], require: [{ path: 'body', op: 'contains', value: 'Fern' }] };
  assert.equal(realShape(field, [view([mail('a@x.example', 's', 'Love, Fern')])]).teeth, true);
  assert.deepEqual([...crossBuild([{ a: 'unmet', b: 'met' }, { a: 'unmet', b: 'unmet' }, { a: 'unmet', b: 'met' }])], ['a']);
  assert.equal(crossBuild([{ a: 'unmet' }, { a: 'unmet' }]).size, 0, 'K < 3 builds: no G3 flag');
});

test('lint: only vocabulary names and grounded literals pass', () => {
  const vocab = appVocabulary({ catalog: { leads: 'one row per lead: name, email, region, status (new | contacted | spam)', 'lead-log': 'the flow appends one row per routed lead: name, assignTo' }, sheets: { leads } });
  const words = wordsOf({ request: 'EMEA leads go to dana@peak.example, and never e-mail more than 3 people' });
  assert.deepEqual(lintCheck(route, { vocab, words }), []);
  assert.match(lintCheck({ ...route, channel: 'slack' }, { vocab, words })[0], /channel "slack"/);
  assert.match(lintCheck({ ...route, filter: [{ path: 'country', op: 'eq', value: 'EMEA' }] }, { vocab, words })[0], /path "country"/);
  assert.match(lintCheck({ ...route, require: [{ path: 'to', op: 'eq', value: 'boss@peak.example' }] }, { vocab, words })[0], /not in the person's words/);
  assert.deepEqual(lintCheck({ ...route, filter: [{ path: 'status', op: 'eq', value: 'new' }] }, { vocab, words }), [], 'a value of their own data is allowed');
  assert.match(lintCheck({ template: 'count', channel: 'email', op: 'atMost', n: 7 }, { vocab, words })[0], /number 7/);
  assert.deepEqual(lintCheck({ template: 'count', channel: 'email', op: 'atMost', n: 3 }, { vocab, words }), []);
  assert.ok(vocab.channels.row.fields.includes('row.assignTo'));
  assert.deepEqual(parseCatalogLine('one row per invoice: invoice (id), customer, due (YYYY-MM-DD), status (open | paid | disputed)').status.values, ['open', 'paid', 'disputed']);
  assert.match(lintCheck({ template: 'bogus' }, { vocab, words })[0], /not one of/);
});

test('words: verbatim location across turns, clause units, numbers, grounding', () => {
  const w = wordsOf({ request: 'Germany & Austria -> Lena, France -> Paul, anyone else -> me. thx', answers: { rules: 'Lena is lena@brook.example.' } });
  assert.deepEqual(locate(w, 'france  ->  PAUL'), { turn: 0, kind: 'request', start: 27, end: 41, text: 'France -> Paul' });
  assert.equal(locate(w, 'lena@brook.example').turn, 1);
  assert.equal(locate(w, 'Germany -> Lena'), null, 'not verbatim');
  assert.deepEqual(unitsOf(w).map(u => u.text), ['Germany & Austria -> Lena', 'France -> Paul', 'anyone else -> me. thx', 'Lena is lena@brook.example.']);
  assert.deepEqual([...numbersIn(wordsOf({ request: 'ONE reminder at 10 days, 500+ staff, $50' }))].sort((a, b) => a - b), [1, 10, 50, 500]);
  assert.ok(grounded(w, 'lena@brook.example')); assert.ok(!grounded(w, 'ena@brook.example'));
  const conds = toConditions([{ quote: 'France -> Paul', summary: 's', kind: 'when-then', checkable: true }, { quote: 'invented', summary: 's', kind: 'must', checkable: true }], w);
  assert.equal(conds.conditions.length, 1); assert.equal(conds.dropped.length, 1);
  assert.equal(captureRule(w).length, 4);
});

test('scenario rows: edges of the check\'s own filter, copied from a row the base run acted on, with fresh names', () => {
  const v = view([mail('kai@x.example', 'New lead Ann Able')]);
  const check = { ...route, filter: [{ path: 'region', op: 'in', values: ['EMEA', 'LATAM'] }, { path: 'size', op: 'gte', n: 500 }] };
  const rows = scenarioRows([check], v).leads;
  assert.deepEqual(rows.map(r => [r.region, r.size]), [['EMEA', 500], ['LATAM', 500], ['EMEA', 499], ['EMEA', 1000]], 'each value of the in-list; gte ON, OFF and IN points');
  assert.ok(rows.every(r => r.status === 'new' && r.name.startsWith('Ann Able S') && r.email.startsWith('scenario')), 'copies the acted-on row; fresh names');
  const age = scenarioRows([{ template: 'count', source: 'inv', filter: [{ path: 'due', op: 'ageDaysGte', n: 10 }], channel: 'email', op: 'atMost', n: 1, link: { item: 'id', effect: '*', op: 'mentions' } }],
    view([], { sources: { inv: [{ id: 'INV-1', due: '2026-10-01' }, { id: 'INV-2', due: '2026-09-01' }] } })).inv;
  assert.deepEqual(age.map(r => [r.id, r.due]), [['INV-1 S1', '2026-10-10'], ['INV-1 S2', '2026-10-11'], ['INV-1 S3', '2026-09-30']], 'dates are not names; the filter column keeps its edge value');
});

test('a model bind entry becomes a typed check; unknown templates become inspection', () => {
  const e = { id: 'C-1', decision: 'check', why: null, question: null, template: 'when-then', channel: 'email', where: [], source: 'leads',
    filter: [{ path: 'region', op: 'eq', value: 'EMEA', values: null, source: null, column: null, filterPath: null, filterOp: null, filterValue: null, itemPath: null }],
    linkItem: 'name', linkEffect: '*', linkOp: 'mentions', require: [{ path: 'to', op: 'eq', value: 'dana@peak.example', values: null, source: null, column: null, filterPath: null, filterOp: null, filterValue: null, itemPath: null }],
    countOp: null, n: null, windowAnchor: null, windowMin: null, windowMax: null, forbidChannel: null, forbidWhere: [], thenChannel: null, thenWhere: [], linkThen: null };
  assert.deepEqual(toCheck(e).check, { ...route, where: [] });
  const abs = toCheck({ ...e, template: 'absent', where: [{ path: 'to', op: 'inColumn', value: null, values: null, source: 'leads', column: 'email', filterPath: 'status', filterOp: 'eq', filterValue: 'new', itemPath: null }] });
  assert.deepEqual(abs.check.where, [{ path: 'to', op: 'inColumn', source: 'leads', column: 'email', filter: [{ path: 'status', op: 'eq', value: 'new' }] }]);
  assert.equal(toCheck({ ...e, decision: 'inspection', why: 'a schedule' }).check, undefined);
});
