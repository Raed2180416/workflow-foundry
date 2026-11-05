// Check semantics v2 (deviation D2, app/core/tracker/semantics.mjs): each rule with a case it must change AND a case it must leave a
// violation (teeth), and v1 left exactly as frozen. $0, no model, no run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, softContains, informativeName } from '../../core/tracker/checks.mjs';
import { prepareCheck, wordingOf, exclusiveCue } from '../../core/tracker/semantics.mjs';
import { judgeViews } from '../../core/tracker/index.mjs';
import { scenarioRows } from '../../core/tracker/scenarios.mjs';

const NOW = '2026-10-20T09:00:00Z';
const W = text => [{ turn: 0, kind: 'request', text }];
function view(effects, { sources = {}, id = 'v', ordered, names = r => [r.name, r.email, r.id].filter(Boolean) } = {}) {
  return { id, now: NOW, horizon: null, ...(ordered === undefined ? {} : { ordered }),
    sources: Object.fromEntries(Object.entries(sources).map(([k, rows]) => [k, rows.map((r, i) => ({ id: `${k}#${i}`, at: null, names: names(r), fields: r }))])),
    effects: effects.map((e, i) => ({ id: `e${i + 1}`, seq: i + 1, at: NOW, status: 'applied', channel: e.channel ?? 'email', fields: e.fields, subject: null,
      text: Object.values(e.fields).map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('\n') })) };
}
const mail = (to, subject, body = '') => ({ channel: 'email', fields: { to, subject, body } });
const cond = (id, quote, check) => ({ id, version: 1, quote, verification: 'test', check });
const statusOf = (conds, views, words, semantics = 'v2') => judgeViews(conds, views, { words, semantics });

test('R-wording: soft content may be said in other words (undecided); exact wording still fails; v1 unchanged', () => {
  const words = W('it should list whats done. Sign it Nimbus Support. we are open mon-sat 9-6');
  assert.equal(wordingOf('done', words), 'soft');
  assert.equal(wordingOf('Nimbus Support', words), 'hard', 'a capitalised name inside a sentence is exact wording');
  assert.equal(wordingOf('open mon-sat 9-6', words), 'hard', 'digits are exact');
  assert.equal(wordingOf('Platform team', W('weekly report pls. Platform team. the usual')), 'soft', 'a capital at a sentence start is not a name');
  assert.equal(wordingOf('order number', W('reply with your "order number"')), 'hard', 'quoted words are exact');
  assert.ok(softContains("We're open Monday to Saturday, 9am to 6pm.", 'open mon-sat 9-6'));
  assert.ok(softContains("We're open Monday to Saturday, 9:00 to 18:00.", 'open mon-sat 9-6'), '24-hour clock');
  assert.ok(softContains('2 unresolved alert(s)', 'alerts'));
  assert.ok(!softContains('Finished: 2 items', 'done'));
  const report = view([mail('tom@x.example', 'Weekly report', 'Finished:\n- ship the fix\nStill open: 1\nBlocked: 1')]);
  const done = { template: 'present', channel: 'email', where: [{ path: 'body', op: 'contains', value: 'done' }] };
  assert.equal(evaluate(done, report).violated, 1, 'v1: the literal word is required');
  const r2 = evaluate(prepareCheck(done, { quote: 'it should list whats done', words, semantics: 'v2' }), report, { semantics: 'v2' });
  assert.equal(r2.violated, 0); assert.equal(r2.decided, 0, 'v2: undecided, not met either');
  const empty = view([mail('tom@x.example', 'Weekly report', 'Nothing to report this week, see you on monday')]);
  assert.equal(evaluate(prepareCheck({ ...done, where: [{ path: 'body', op: 'contains', value: 'Nimbus Support' }] }, { words, semantics: 'v2' }), empty, { semantics: 'v2' }).violated, 1,
    'hard wording missing from free text is a violation');
  const s = statusOf([cond('C-1', 'it should list whats done', done)], [report], words);
  assert.equal(s['C-1'].status, 'unknown');
});

test('R-closed: scope keeps "never anyone else" only with an exclusive cue', () => {
  assert.ok(exclusiveCue('can you sync just our paying customers')); assert.ok(exclusiveCue("dont email the leads")); assert.ok(!exclusiveCue('new leads from the website form need to go to the right person'));
  const leads = [{ name: 'Ann Able', email: 'ann@a.example', source: 'website' }, { name: 'Bob Baker', email: 'bob@b.example', source: 'event' }];
  const v = view([mail('dana@x.example', 'Lead Ann Able'), mail('jo@x.example', 'Lead Bob Baker')], { sources: { leads } });
  const scope = { template: 'scope', source: 'leads', filter: [{ path: 'source', op: 'eq', value: 'website' }], channel: 'email', where: [], link: { item: 'email', effect: '*', op: 'mentions' }, require: [] };
  const words = W('new leads from the website form need to go to the right person. only website leads please');
  assert.equal(statusOf([cond('C-1', 'new leads from the website form need to go to the right person', scope)], [v], words)['C-1'].status, 'met', 'no cue: when-then');
  assert.equal(statusOf([cond('C-1', 'only website leads please', scope)], [v], words)['C-1'].status, 'unmet', 'cue: closed world stays');
  assert.equal(statusOf([cond('C-1', 'new leads from the website form need to go to the right person', scope)], [v], words, 'v1')['C-1'].status, 'unmet', 'v1 unchanged');
});

const leadsL2 = [{ name: 'Lou Big', email: 'lou@b.example', companySize: 900, source: 'referral' }, { name: 'Sam Small', email: 'sam@s.example', companySize: 40, source: 'referral' }];
const raj = cond('C-1', 'Big companies (500+ employees) go straight to Raj', { template: 'when-then', source: 'leads', filter: [{ path: 'companySize', op: 'gte', value: 500, n: 500 }], channel: 'email', where: [], link: { item: 'name', effect: '*', op: 'mentions' }, require: [{ path: 'to', op: 'eq', value: 'raj@x.example' }] });
const sofia = cond('C-2', 'Referals go to Sofia', { template: 'when-then', source: 'leads', filter: [{ path: 'source', op: 'eq', value: 'referral' }], channel: 'email', where: [], link: { item: 'name', effect: '*', op: 'mentions' }, require: [{ path: 'to', op: 'eq', value: 'sofia@x.example' }] });
test('R-overlap: two of the person\'s rules claim one item: a question, unless the build never implements the failing rule', () => {
  const words = W('Big companies (500+ employees) go straight to Raj. Referals go to Sofia');
  const ok = view([mail('raj@x.example', 'Lead Lou Big'), mail('sofia@x.example', 'Lead Sam Small')], { sources: { leads: leadsL2 } });
  const s = statusOf([raj, sofia], [ok], words);
  assert.equal(s['C-2'].status, 'met', 'Sam went to Sofia; Lou is a question, not a violation');
  assert.match(s['C-2'].questions[0], /which one is meant/);
  assert.equal(statusOf([raj, sofia], [ok], words, 'v1')['C-2'].status, 'unmet', 'v1 unchanged');
  const never = view([mail('raj@x.example', 'Lead Lou Big'), mail('sales@x.example', 'Lead Sam Small')], { sources: { leads: leadsL2 } });
  assert.equal(statusOf([raj, sofia], [never], words)['C-2'].status, 'unmet', 'teeth: a build that never routes to Sofia stays unmet');
  // Keyword membership: a site-down report that mentions "shipping" was forwarded; real shipping questions get the reply.
  const tickets = [{ id: 'P-1', from: 'ann@c.example', subject: 'How long is shipping?', body: 'When will my order arrive at my house?' }, { id: 'P-3', from: 'cy@c.example', subject: 'Site down', body: 'Checkout broken, shipping page errors' }];
  const ship = cond('C-3', 'if a ticket asks about shipping reply', { template: 'when-then', source: 'tickets', filter: [{ path: 'body', op: 'contains', value: 'shipping' }, { path: 'subject', op: 'exists' }], channel: 'email', where: [], link: { item: 'from', effect: 'to', op: 'eq' }, require: [{ path: 'body', op: 'contains', value: '2-3 business days' }] });
  const rest = cond('C-4', 'everything else send to me', { template: 'when-then', source: 'tickets', filter: [{ path: 'body', op: 'notContains', value: 'shipping' }], channel: 'email', where: [{ path: 'to', op: 'eq', value: 'help@x.example' }], link: { item: 'id', effect: '*', op: 'mentions' }, require: [] });
  const tw = W('if a ticket asks about shipping reply that orders ship in 2-3 business days. everything else send to me (help@x.example)');
  const good = view([mail('ann@c.example', 'Re: shipping', 'Orders ship in 2-3 business days.'), mail('help@x.example', 'Tickets', 'P-3 Site down')], { sources: { tickets } });
  assert.equal(statusOf([ship, rest], [good], tw)['C-3'].status, 'unknown', 'P-3 is a question; P-1 is outside the keyword filter');
  assert.equal(statusOf([ship, rest], [good], tw)['C-3'].reason, 'needs-answer');
  const fwdAll = view([mail('help@x.example', 'Tickets', 'P-1 shipping\nP-3 Site down')], { sources: { tickets } });
  assert.equal(statusOf([ship, rest], [fwdAll], tw)['C-3'].status, 'unmet', 'teeth: a build that never replies stays unmet');
});

test('R-it: a field rule that fails only on messages to the person\'s own address is a question; failing on customers stays unmet', () => {
  const words = W('everything else goes to support@x.example. Sign it Nimbus Support');
  const sign = cond('C-1', 'Sign it Nimbus Support', { template: 'field', channel: 'email', where: [], require: [{ path: 'body', op: 'contains', value: 'Nimbus Support' }] });
  const internal = view([mail('support@x.example', 'Tickets for you', 'P-1\nP-2'), mail('ann@c.example', 'Re: invoice', 'It is under Billing.\nNimbus Support')]);
  const s = statusOf([sign], [internal], words);
  assert.equal(s['C-1'].status, 'met'); assert.match(s['C-1'].questions[0], /support@x.example/);
  const onlyInternal = view([mail('support@x.example', 'Tickets for you', 'P-1\nP-2')]);
  assert.equal(statusOf([sign], [onlyInternal], words)['C-1'].reason, 'needs-answer', 'fails only on the person\'s own address: ask');
  const customer = view([mail('ann@c.example', 'Re: invoice', 'It is under Billing.'), mail('bob@c.example', 'Re: invoice', 'It is under Billing.\nNimbus Support')]);
  assert.equal(statusOf([sign], [customer], words)['C-1'].status, 'unmet', 'teeth: an unsigned customer reply is a violation');
});

test('R-names: an extra naming value must be distinctive ("Thanks!" names no ticket)', () => {
  assert.ok(!informativeName('Thanks!')); assert.ok(informativeName('P-5')); assert.ok(informativeName('Wholesale pricing')); assert.ok(informativeName('ann@c.example'));
  const tickets = [{ id: 'P-5', from: 'eve@c.example', subject: 'Shipping to Canada', body: 'Thanks!' }, { id: 'P-6', from: 'fay@c.example', subject: 'Refund please', body: 'Where is it' }];
  const rest = { template: 'when-then', source: 'tickets', filter: [], channel: 'email', where: [{ path: 'to', op: 'eq', value: 'help@x.example' }], link: { item: 'id', effect: '*', op: 'mentions' }, require: [] };
  const v = view([mail('gil@c.example', 'Re: hello', 'Thanks for getting in touch')], { sources: { tickets }, names: r => [r.id, r.subject, r.body] });
  assert.equal(evaluate(rest, v).violated, 1, 'v1: the reply "names" P-5 by its body "Thanks!"');
  assert.equal(evaluate(rest, v, { semantics: 'v2' }).violated, 0, 'v2: not acted on');
});

test('R-objects: a sheet name nothing knows makes the check suspect; a known sheet does not', () => {
  const crm = [{ email: 'a@c.example', tags: 'customer' }];
  const v = { ...view([{ channel: 'row', fields: { sheet: 'newsletter', row: { email: 'a@c.example' } } }], { sources: { crm, newsletter: [] } }) };
  const mk = sheet => cond('C-1', 'to the mailing list', { template: 'count', channel: 'row', where: [{ path: 'sheet', op: 'contains', value: sheet }], op: 'atLeast', n: 1, source: 'crm', filter: [], link: { item: 'email', effect: 'row.email', op: 'eq' } });
  const s = statusOf([mk('mailing list')], [v], W('sync customers to the mailing list'));
  assert.equal(s['C-1'].reason, 'check-suspect'); assert.ok(s['C-1'].flags.includes('unknown-object'));
  assert.equal(statusOf([mk('newsletter')], [v], W('sync customers to the newsletter'))['C-1'].status, 'met');
});

test('R-order: an unordered record cannot show what came first; an ordered one can', () => {
  const order = { template: 'order', first: { channel: 'row', where: [] }, then: { channel: 'email', where: [] }, link: { first: 'row.email', then: 'to', op: 'eq' } };
  const effects = [mail('a@c.example', 'hi'), { channel: 'row', fields: { sheet: 'log', row: { email: 'a@c.example' } } }];
  assert.equal(evaluate(order, view(effects, { ordered: true }), { semantics: 'v2' }).violated, 1, 'teeth: ordered and wrong');
  const u = evaluate(order, view(effects, { ordered: false }), { semantics: 'v2' });
  assert.equal(u.violated, 0); assert.equal(u.decided, 0);
  assert.equal(evaluate(order, view(effects, { ordered: false })).violated, 1, 'v1 unchanged');
});

test('R-chimera: no synthesized row for a keyword in free text; structured edges still get rows', () => {
  const tickets = [{ id: 'P-1', from: 'a@c.example', subject: 'How long is shipping?', body: 'When will my order arrive at the shop?', priority: 'normal' }, { id: 'P-2', from: 'b@c.example', subject: 'Login', body: 'I cannot log in at all today', priority: 'urgent' }];
  const base = view([mail('a@c.example', 'Re: P-1', 'soon')], { sources: { tickets } });
  const kw = { template: 'when-then', source: 'tickets', filter: [{ path: 'body', op: 'contains', value: 'password' }], channel: 'email', link: { item: 'from', effect: 'to', op: 'eq' }, require: [] };
  const eq = { ...kw, filter: [{ path: 'priority', op: 'eq', value: 'urgent' }] };
  assert.equal(scenarioRows([kw], base).tickets.length, 1, 'v1: a chimera row');
  assert.equal(scenarioRows([kw], base, { semantics: 'v2' }).tickets, undefined, 'v2: none');
  assert.equal(scenarioRows([eq], base, { semantics: 'v2' }).tickets.length, 1, 'structured edge kept');
});

test('R-state: rows already on the sheet count for "at least" in v2', () => {
  const crm = [{ email: 'a@c.example', name: 'Ada' }, { email: 'b@c.example', name: 'Bo' }, { email: 'c@c.example', name: 'Cy' }];
  const v = view([{ channel: 'row', fields: { sheet: 'newsletter', row: { email: 'b@c.example' } } }], { sources: { crm, newsletter: [{ email: 'a@c.example' }] } });
  const all = { template: 'count', channel: 'row', where: [], op: 'atLeast', n: 1, source: 'crm', filter: [], link: { item: 'email', effect: 'row.email', op: 'eq' } };
  assert.deepEqual(evaluate(all, v).instances.map(i => i.ok), [false, true, false], 'v1: Ada was already there, still counted missing');
  assert.deepEqual(evaluate(all, v, { semantics: 'v2' }).instances.map(i => i.ok), [true, true, false], 'v2: Ada is on the list; Cy is still missing (teeth)');
});

// Deviation D3 (v3 = v2 + these rules); v2 must not change.
test('R-state+: a contact already on the list answers a when-then on rows (v3); a missing one still fails', () => {
  const crm = [{ email: 'd@c.example', name: 'Di', tags: 'customer' }, { email: 'e@c.example', name: 'Eve', tags: 'customer' }];
  const sync = cond('C-1', 'sync our customers to the newsletter', { template: 'when-then', source: 'crm', filter: [{ path: 'tags', op: 'contains', value: 'customer' }], channel: 'row', where: [], link: { item: 'email', effect: 'row.email', op: 'eq' }, require: [] });
  const report = mail('me@x.example', 'Sync report', 'Added nobody. d@c.example and e@c.example were looked at.');
  const v = view([report, { channel: 'row', fields: { sheet: 'newsletter', row: { email: 'x@c.example' } } }], { sources: { crm, newsletter: [{ email: 'D@c.example' }] } });
  const words = W('sync our customers to the newsletter');
  assert.equal(statusOf([sync], [v], words, 'v2')['C-1'].status, 'unmet', 'v2: d@ counts as missed');
  const s3 = statusOf([sync], [v], words, 'v3')['C-1'];
  assert.equal(s3.status, 'unmet', 'teeth: e@ is not on the list and got no row');
  assert.match(s3.evidence[0].why, /acted on/);
  assert.equal(statusOf([sync], [view([report, { channel: 'row', fields: { sheet: 'newsletter', row: { email: 'e@c.example' } } }], { sources: { crm, newsletter: [{ email: 'D@c.example' }] } })], words, 'v3')['C-1'].status, 'met');
});

test('R-objects+: a row column no run has makes the check suspect (v3); a real column stays a check', () => {
  const rows = [{ channel: 'row', fields: { sheet: 'expense-decisions', row: { id: 'PX-2', decision: 'waiting for approver' } } }];
  const mk = col => cond('C-1', 'our office manager, beth@x.example', { template: 'field', channel: 'row', where: [{ path: 'row.decision', op: 'eq', value: 'waiting for approver' }], require: [{ path: `row.${col}`, op: 'eq', value: 'beth@x.example' }] });
  const words = W('above that it needs an ok from our office manager, beth@x.example');
  assert.equal(statusOf([mk('assignTo')], [view(rows)], words, 'v2')['C-1'].status, 'unmet', 'v2 unchanged');
  const s = statusOf([mk('assignTo')], [view(rows)], words, 'v3')['C-1'];
  assert.equal(s.reason, 'check-suspect'); assert.ok(s.flags.includes('unknown-object'));
  assert.equal(statusOf([mk('decision')], [view(rows)], words, 'v3')['C-1'].status, 'unmet', 'teeth: a column that exists, with the wrong value');
});

test('R-contra: a link and a requirement fixing the same field make the check suspect (v3)', () => {
  const leads = [{ name: 'Lou Big', email: 'lou@b.example', companySize: 900 }];
  const bad = cond('C-1', 'Big companies go straight to Raj', { template: 'when-then', source: 'leads', filter: [], channel: 'email', where: [], link: { item: 'email', effect: 'to', op: 'eq' }, require: [{ path: 'to', op: 'eq', value: 'raj@x.example' }] });
  const v = view([mail('raj@x.example', 'Lead Lou Big', 'lou@b.example')], { sources: { leads } });
  const words = W('Big companies go straight to Raj, raj@x.example');
  assert.equal(statusOf([bad], [v], words, 'v2')['C-1'].status, 'unmet', 'v2 unchanged');
  assert.ok(statusOf([bad], [v], words, 'v3')['C-1'].flags.includes('contradictory'));
  const good = cond('C-1', 'Big companies go straight to Raj', { ...bad.check, link: { item: 'name', effect: '*', op: 'mentions' } });
  assert.equal(statusOf([good], [view([mail('sales@x.example', 'Lead Lou Big')], { sources: { leads } })], words, 'v3')['C-1'].status, 'unmet', 'teeth: a sound check still fails');
});

// E8-shaped views (effects with results and times, effect triggers), for R-deadline, R-commit and R-outcome (deviation D3).
function e8view(effects, { inbound = [] } = {}) {
  const eff = effects.map((e, i) => ({ id: `em-${i + 1}`, seq: i + 1, at: e.at, channel: e.channel, status: e.status ?? 'applied', subject: e.subject ?? null,
    fields: { args: e.args, result: e.result ?? null }, text: JSON.stringify(e.args) }));
  const sources = { 'inbound:order.placed': inbound.map((m, i) => ({ id: `in-${i + 1}`, at: m.at, subject: m.orderId, names: [], fields: { at: m.at, payload: m } })) };
  for (const e of eff) (sources[`effect:${e.channel}`] ??= []).push({ id: e.id, at: e.at, isEffect: true, subject: e.subject, names: [], fields: e.fields });
  return { id: 'run', now: null, horizon: null, sources, effects: eff };
}
const ok = at => ({ at, status: 'ok' });

test('R-deadline: a 0-opening window bounds lateness only (v3); late still fails; a later-opening window still forbids early', () => {
  // A reserve emitted in the same tick as the status change, before the status change's commit time (result.at).
  const v = e8view([
    { channel: 'orders.setStatus', at: '2026-03-02T00:02:00Z', subject: 'O1', args: { orderId: 'O1', status: 'processing' }, result: ok('2026-03-02T00:03:00Z') },
    { channel: 'inventory.reserve', at: '2026-03-02T00:02:00Z', subject: 'O1', args: { orderId: 'O1' }, result: ok('2026-03-02T00:03:00Z') },
    { channel: 'orders.setStatus', at: '2026-03-02T01:00:00Z', subject: 'O2', args: { orderId: 'O2', status: 'processing' }, result: ok('2026-03-02T01:01:00Z') },
    { channel: 'inventory.reserve', at: '2026-03-02T04:00:00Z', subject: 'O2', args: { orderId: 'O2' }, result: ok('2026-03-02T04:01:00Z') }]);
  const reserve = { template: 'when-then', source: 'effect:orders.setStatus', filter: [{ path: 'args.status', op: 'eq', value: 'processing' }], channel: 'inventory.reserve', where: [],
    link: { item: 'args.orderId', effect: 'args.orderId', op: 'eq' }, require: [], within: { anchor: 'result.at', min: 0, max: 120 } };
  assert.deepEqual(evaluate(reserve, v, { semantics: 'v2' }).instances.map(i => i.ok), [false, false], 'v2: the same-tick reserve reads as early');
  assert.deepEqual(evaluate(reserve, v, { semantics: 'v3' }).instances.map(i => i.ok), [true, false], 'v3: in time; the 3-hour-late reserve still fails (teeth)');
  const notBefore = { ...reserve, within: { anchor: 'result.at', min: 30, max: 300 } };
  assert.equal(evaluate(notBefore, v, { semantics: 'v3' }).instances[0].ok, false, 'a window opening at 30 min still forbids an answer before it');
  // A re-delivered message: the order was recorded for the first delivery, before the duplicate arrived.
  const dup = e8view([{ channel: 'orders.create', at: '2026-03-03T18:11:00Z', subject: 'O3', args: { orderId: 'O3' }, result: ok('2026-03-03T18:12:00Z') }],
    { inbound: [{ orderId: 'O3', at: '2026-03-03T18:10:00Z' }, { orderId: 'O3', at: '2026-03-03T18:16:00Z' }, { orderId: 'O4', at: '2026-03-03T18:20:00Z' }] });
  const create = { template: 'when-then', source: 'inbound:order.placed', filter: [], channel: 'orders.create', where: [], link: { item: 'payload.orderId', effect: 'args.orderId', op: 'eq' }, require: [],
    within: { anchor: 'at', min: 0, max: 60 } };
  assert.deepEqual(evaluate(create, dup, { semantics: 'v2' }).instances.map(i => i.ok), [true, false, null], 'v2: the duplicate reads as answered too early');
  assert.deepEqual(evaluate(create, dup, { semantics: 'v3' }).instances.map(i => i.ok), [true, true, null], 'v3: already recorded; O4 was never acted on (undecided)');
});

test('R-commit: a declined charge is no trigger (v3); a committed charge with no shipment still fails; a filter on the outcome keeps failed triggers', () => {
  const declined = { code: 402, reason: 'card-declined', retryable: false };
  const v = e8view([
    { channel: 'billing.charge', at: '2026-03-04T21:32:00Z', subject: 'O1', args: { orderId: 'O1', fulfilmentId: 'F1' }, result: { at: '2026-03-04T21:33:00Z', status: 'error', error: declined } },
    { channel: 'billing.charge', at: '2026-03-04T22:00:00Z', subject: 'O2', args: { orderId: 'O2', fulfilmentId: 'F2' }, result: ok('2026-03-04T22:01:00Z') },
    { channel: 'notify.send', at: '2026-03-04T22:05:00Z', subject: 'O2', args: { about: 'O2', fulfilmentId: 'F2', template: 'charged' }, result: ok('2026-03-04T22:06:00Z') }]);
  const ship = { template: 'when-then', source: 'effect:billing.charge', filter: [], channel: 'carrier.create', where: [], link: { item: 'args.fulfilmentId', effect: 'args.fulfilmentId', op: 'eq' }, require: [] };
  const v2 = evaluate(ship, v, { semantics: 'v2' }), v3 = evaluate(ship, v, { semantics: 'v3' });
  assert.equal(v2.activated, 2);
  assert.equal(v3.activated, 1, 'v3: the declined charge is not an event');
  assert.equal(v3.instances[0].item.id, 'em-2'); assert.equal(v3.instances[0].ok, false, 'teeth: the committed charge got no shipment (the notify names it)');
  const onDecline = { ...ship, filter: [{ path: 'result.status', op: 'eq', value: 'error' }], channel: 'billing.refund' };
  assert.equal(evaluate(onDecline, v, { semantics: 'v3' }).activated, 1, 'words about the failure keep the failed trigger');
  const count = { template: 'count', source: 'effect:billing.charge', filter: [], channel: 'carrier.create', where: [], link: { item: 'args.fulfilmentId', effect: 'args.fulfilmentId', op: 'eq' }, op: 'atLeast', n: 1 };
  assert.equal(evaluate(count, v, { semantics: 'v3' }).activated, 1, 'count: the same rule');
});

test('R-outcome: the system saying no is not the flow failing (v3); asking for the wrong thing still fails', () => {
  const v = e8view([
    { channel: 'inventory.reserve', at: '2026-03-04T21:31:00Z', subject: 'O1', args: { orderId: 'O1', fulfilmentId: 'F1' }, result: ok('2026-03-04T21:32:00Z') },
    { channel: 'billing.charge', at: '2026-03-04T21:32:00Z', subject: 'O1', args: { orderId: 'O1', fulfilmentId: 'F1', currency: 'EUR' }, result: { at: '2026-03-04T21:33:00Z', status: 'error', error: { code: 402 } } },
    { channel: 'inventory.reserve', at: '2026-03-04T23:00:00Z', subject: 'O2', args: { orderId: 'O2', fulfilmentId: 'F2' }, result: ok('2026-03-04T23:01:00Z') },
    { channel: 'billing.charge', at: '2026-03-04T23:01:00Z', subject: 'O2', args: { orderId: 'O2', fulfilmentId: 'F2', currency: 'USD' }, result: ok('2026-03-04T23:02:00Z') }]);
  const charge = { template: 'when-then', source: 'effect:inventory.reserve', filter: [], channel: 'billing.charge', where: [], link: { item: 'args.fulfilmentId', effect: 'args.fulfilmentId', op: 'eq' },
    require: [{ path: 'result.status', op: 'eq', value: 'ok' }, { path: 'args.currency', op: 'eq', value: 'EUR' }] };
  assert.deepEqual(evaluate(charge, v, { semantics: 'v2' }).instances.map(i => i.ok), [false, false]);
  const r = evaluate(charge, v, { semantics: 'v3' });
  assert.deepEqual(r.instances.map(i => i.ok), [null, false], 'v3: the declined charge is undecided; the USD charge asked for the wrong currency (teeth)');
  assert.match(r.instances[0].why, /^outcome:/);
  const field = { template: 'field', channel: 'billing.charge', where: [], require: [{ path: 'result.status', op: 'eq', value: 'ok' }] };
  assert.equal(evaluate(field, v, { semantics: 'v3' }).violated, 0, 'field: an outcome requirement is undecided');
  assert.equal(evaluate(field, v, { semantics: 'v2' }).violated, 1);
});

test('R-discharge: a trigger the platform-declared reversal undid lapses (v3); one not undone still fails; another item\'s reversal does not count', () => {
  const v = e8view([
    { channel: 'billing.charge', at: '2026-03-11T13:11:00Z', subject: 'O1', args: { orderId: 'O1', fulfilmentId: 'F1' }, result: ok('2026-03-11T13:12:00Z') },
    { channel: 'billing.charge', at: '2026-03-11T13:11:00Z', subject: 'O2', args: { orderId: 'O2', fulfilmentId: 'F2' }, result: ok('2026-03-11T13:12:00Z') },
    { channel: 'billing.refund', at: '2026-03-11T13:40:00Z', subject: 'O1', args: { orderId: 'O1', fulfilmentId: 'F1' }, result: ok('2026-03-11T13:41:00Z') },
    { channel: 'notify.send', at: '2026-03-11T13:45:00Z', subject: 'O2', args: { about: 'O2', fulfilmentId: 'F2', template: 'charged' }, result: ok('2026-03-11T13:46:00Z') }]);
  v.reverses = { 'billing.refund': 'billing.charge' };
  const ship = { template: 'when-then', source: 'effect:billing.charge', filter: [], channel: 'carrier.create', where: [], link: { item: 'args.fulfilmentId', effect: 'args.fulfilmentId', op: 'eq' }, require: [] };
  assert.deepEqual(evaluate(ship, v, { semantics: 'v2' }).instances.map(i => i.ok), [false, false]);
  const r = evaluate(ship, v, { semantics: 'v3' });
  assert.deepEqual(r.instances.map(i => i.ok), [null, false], 'v3: F1 was refunded (discharged); F2 was charged and never shipped (teeth)');
  assert.match(r.instances[0].why, /^discharged:/);
  const noDecl = { ...v, reverses: {} };
  assert.deepEqual(evaluate(ship, noDecl, { semantics: 'v3' }).instances.map(i => i.ok), [false, false], 'without a declared reversal nothing lapses');
});

test('R-qualifier: failures exactly on an unmentioned status value are a question (v3); a value the words name stays a violation', () => {
  const crm = [{ email: 'a@c.example', name: 'Ann', unsubscribed: false }, { email: 'b@c.example', name: 'Bo', unsubscribed: false }, { email: 'c@c.example', name: 'Cy', unsubscribed: true }, { email: 'd@c.example', name: 'Di', unsubscribed: false }];
  const rows = ['a@c.example', 'b@c.example', 'd@c.example'].map(email => ({ channel: 'row', fields: { sheet: 'newsletter', row: { email } } }));
  const check = { template: 'count', source: 'crm', filter: [], channel: 'row', where: [], link: { item: 'email', effect: 'row.email', op: 'eq' }, op: 'atLeast', n: 1 };
  const everyone = cond('C-1', 'make sure our newsletter list has everyone from the CRM on it', check);
  const v = view(rows, { sources: { crm } });
  const s3 = statusOf([everyone], [v], W(everyone.quote), 'v3')['C-1'];
  assert.equal(s3.status, 'met', 'met for the three it decided, with the question shown beside it');
  assert.equal(s3.violated, 0);
  assert.match(s3.questions[0], /unsubscribed is true/);
  assert.equal(statusOf([everyone], [v], W(everyone.quote), 'v2')['C-1'].status, 'unmet', 'v2 unchanged');
  const named = cond('C-1', 'make sure the list has everyone, even the unsubscribed ones', check);
  assert.equal(statusOf([named], [v], W(named.quote), 'v3')['C-1'].status, 'unmet', 'the words name the column: a violation (teeth)');
  // Failures that no single unmentioned value explains stay violations.
  const mixed = view(rows.slice(0, 2), { sources: { crm } });
  assert.equal(statusOf([everyone], [mixed], W(everyone.quote), 'v3')['C-1'].status, 'unmet', 'Di (subscribed) and Cy (unsubscribed) both missing: no qualifier explains it');
});

test('R-objects+ by schema: a column the named sheet lacks is suspect even with one build; a column the catalog lists stays a check', () => {
  // One build that writes lead-log rows without assignTo, which the person asked for: the catalog says lead-log has assignTo.
  const rows = [{ channel: 'row', fields: { sheet: 'lead-log', row: { email: 'a@x.example', name: 'Ann' } } }];
  const words = W('log every lead with who it went to');
  const assign = cond('C-1', 'log every lead with who it went to', { template: 'field', channel: 'row', where: [{ path: 'sheet', op: 'eq', value: 'lead-log' }], require: [{ path: 'row.assignTo', op: 'exists' }] });
  const schemas = { 'lead-log': ['email', 'name', 'assignTo'], 'expense-decisions': ['id', 'decision'] };
  const s = judgeViews([assign], [view(rows)], { words, semantics: 'v3', schemas })['C-1'];
  assert.equal(s.status, 'unmet', 'teeth: the column exists in the catalog, the build left it out');
  const noCatalog = judgeViews([assign], [view(rows)], { words, semantics: 'v3' })['C-1'];
  assert.equal(noCatalog.reason, 'check-suspect', 'without the catalog nothing shows the sheet has that column');
  const mixed = cond('C-2', 'beth approves', { template: 'field', channel: 'row', where: [{ path: 'row.decision', op: 'eq', value: 'waiting for approver' }], require: [{ path: 'row.assignTo', op: 'eq', value: 'beth@x.example' }] });
  const decisions = [{ channel: 'row', fields: { sheet: 'expense-decisions', row: { id: 'PX-2', decision: 'waiting for approver' } } }];
  assert.ok(judgeViews([mixed], [view(decisions)], { words, semantics: 'v3', schemas })['C-2'].flags.includes('unknown-object'), 'no one sheet has decision and assignTo');
});
