// Check semantics v4 (deviation D4, app/core/tracker/semantics.mjs R-copy-names and R-per-run) and the capture summary guard
// (review m3). Each fix with the case it must change AND a case it must leave a violation (teeth); v3 left exactly as before. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, containsText, softContains, actedOn } from '../../core/tracker/checks.mjs';
import { scenarioRows } from '../../core/tracker/scenarios.mjs';
import { joinViews } from '../../core/tracker/practice.mjs';
import { judgeViews } from '../../core/tracker/index.mjs';
import { DEFAULT_SEMANTICS, SEMANTICS } from '../../core/tracker/semantics.mjs';
import { toConditions, inventedLiterals } from '../../core/tracker/model.mjs';

const NOW = '2026-10-20T09:00:00Z';
function view(effects, { sources = {}, id = 'v', names = r => [r.id, r.email].filter(Boolean) } = {}) {
  return { id, now: NOW, horizon: null,
    sources: Object.fromEntries(Object.entries(sources).map(([k, rows]) => [k, rows.map((r, i) => ({ id: `${k}#${i}`, at: null, names: names(r), fields: r }))])),
    effects: effects.map((e, i) => ({ id: `${id}:e${i + 1}`, seq: i + 1, at: NOW, status: 'applied', channel: e.channel ?? 'email', fields: e.fields, subject: null,
      text: Object.values(e.fields).map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('\n') })), run: { status: 'succeeded', passed: true } };
}
const mail = (to, subject, body = '') => ({ channel: 'email', fields: { to, subject, body } });

test('v4 is the product default; v3 stays selectable for the preregistered numbers', () => {
  assert.equal(DEFAULT_SEMANTICS, 'v4');
  assert.equal(SEMANTICS.v4, 'tracker-checks/4');
  assert.equal(SEMANTICS.v3, 'tracker-checks/3');
});

const tickets = [{ id: 'P-1', priority: 'normal', subject: 'Where is my order', email: 'ann@a.example' }, { id: 'P-2', priority: 'urgent', subject: 'Site is down', email: 'bob@b.example' }];
const urgent = { template: 'when-then', source: 'tickets', filter: [{ path: 'priority', op: 'eq', value: 'urgent' }], channel: 'email', where: [], link: { item: 'id', effect: '*', op: 'mentions' }, require: [{ path: 'to', op: 'eq', value: 'mike@x.example' }] };

test('R-copy-names: a targeted copy\'s names neither contain the original\'s nor are contained in them (v3 unchanged)', () => {
  const base = view([mail('mike@x.example', 'Urgent P-2', 'Site is down')], { sources: { tickets } });
  const v3 = scenarioRows([urgent], base, { semantics: 'v3' }).tickets;
  const v4 = scenarioRows([urgent], base, { semantics: 'v4' }).tickets;
  assert.equal(v3.length, v4.length);
  assert.ok(v3.some(r => /^P-2 S\d+$/.test(r.id)), 'v3 names the copy by extending the original');
  for (const r of v4) {
    assert.match(r.id, /^S\d+P-2$/);
    assert.match(r.email, /^s\d+bob@b\.example$/);
    for (const [copy, orig] of [[r.id, 'P-2'], [r.email, 'bob@b.example'], [r.subject, 'Site is down']]) {
      assert.ok(!containsText(`Re: ${copy}`, orig), `an e-mail about the copy ${copy} does not name ${orig}`);
      assert.ok(!softContains(`Re: ${copy}`, orig), `nor in other words (${copy} / ${orig})`);
      assert.ok(!containsText(`Re: ${orig}`, copy), `an e-mail about ${orig} does not name the copy`);
    }
    assert.match(r.subject, /^S\d+Site is down$/, 'the words a flow may classify on are kept after the first');
  }
  assert.ok(v3.some(r => containsText(`Re: ${r.id}`, 'P-2')), 'the v3 bug, for the record: the copy names the original');
});

test('R-copy-names keeps teeth: an effect that names the original still names it, and a skipped copy is still unmet', () => {
  const base = view([mail('mike@x.example', 'Urgent P-2', 'Site is down')], { sources: { tickets } });
  const extra = scenarioRows([urgent], base, { semantics: 'v4' }).tickets;
  const rows = [...tickets, ...extra];
  // The flow answers the original urgent ticket but sends the urgent copy to the wrong person.
  const copy = extra.find(r => r.priority === 'urgent');
  const t = view([mail('mike@x.example', 'Urgent P-2', 'Site is down'), mail('desk@x.example', `Urgent ${copy.id}`, copy.subject)], { sources: { tickets: rows }, id: 'targeted' });
  const item = t.sources.tickets.find(i => i.fields.id === 'P-2');
  assert.ok(actedOn(item, t, { informative: true }), 'the original is still named by its own e-mail');
  const r = evaluate(urgent, t, { semantics: 'v4' });
  assert.equal(r.violated, 1, 'the copy routed to the wrong person is a violation');
  assert.equal(r.instances.find(i => i.ok === false).item.id, `tickets#${rows.indexOf(copy)}`);
});

const digest = { template: 'count', channel: 'email', op: 'atMost', n: 1, where: [{ path: 'subject', op: 'contains', value: 'digest' }] };
test('R-per-run: a count with no source item is counted per run on the repeat view (v3 counted both runs together)', () => {
  const day1 = view([mail('zara@x.example', 'Daily digest'), mail('mike@x.example', 'Urgent P-2')], { id: 'repeat-1' });
  const day2 = view([mail('zara@x.example', 'Daily digest')], { id: 'repeat-2' });
  const joined = joinViews(day1, day2);
  assert.deepEqual(joined.effects.map(e => e.run), [0, 0, 1]);
  assert.equal(evaluate(digest, joined, { semantics: 'v3' }).violated, 1, 'v3: two digests over two runs read as two in one run');
  const r = evaluate(digest, joined, { semantics: 'v4' });
  assert.equal(r.violated, 0); assert.equal(r.decided, 2, 'one decided instance per run');
  assert.match(r.instances[1].why, /^run 2: 1 matching/);
});

test('R-per-run keeps teeth: two digests in one run are still a violation; per-item counts still read both runs', () => {
  const day1 = view([mail('zara@x.example', 'Daily digest'), mail('zara@x.example', 'Daily digest again')], { id: 'repeat-1' });
  const day2 = view([mail('zara@x.example', 'Daily digest')], { id: 'repeat-2' });
  const r = evaluate(digest, joinViews(day1, day2), { semantics: 'v4' });
  assert.equal(r.violated, 1); assert.match(r.instances[0].why, /^run 1: 2 matching/);
  // "each invoice at most one reminder": once is about the next run too.
  const inv = [{ id: 'INV-7', email: 'pay@c.example' }];
  const once = { template: 'count', channel: 'email', op: 'atMost', n: 1, source: 'invoices', filter: [], link: { item: 'email', effect: 'to', op: 'eq' } };
  const a = view([mail('pay@c.example', 'Reminder INV-7')], { id: 'repeat-1', sources: { invoices: inv } }), b = view([mail('pay@c.example', 'Reminder INV-7')], { id: 'repeat-2', sources: { invoices: inv } });
  assert.equal(evaluate(once, joinViews(a, b), { semantics: 'v4' }).violated, 1, 'a second reminder on the next day still breaks "once"');
  // And on a single run view the per-run rule changes nothing.
  assert.equal(evaluate(digest, day1, { semantics: 'v4' }).violated, 1);
});

test('judgeViews under v4 turns the per-run digest false alarm into met, and leaves v3 as it was', () => {
  const words = [{ turn: 0, kind: 'request', text: 'everything else goes to zara in one digest' }];
  const joined = joinViews(view([mail('zara@x.example', 'Daily digest')], { id: 'repeat-1' }), view([mail('zara@x.example', 'Daily digest')], { id: 'repeat-2' }));
  const c = [{ id: 'C-1', version: 1, quote: 'everything else goes to zara in one digest', verification: 'test', check: digest }];
  assert.equal(judgeViews(c, [joined], { words, semantics: 'v3' })['C-1'].status, 'unmet');
  assert.notEqual(judgeViews(c, [joined], { words, semantics: 'v4' })['C-1'].status, 'unmet');
});

test('capture summary guard (review m3): a routing literal the words never gave is replaced by the quote; a stated one is kept', () => {
  const words = [{ turn: 0, kind: 'request', text: 'remind them at 30, 60 and 90 days, bcc me on the 2nd one. send the summary to nadia@yoga.example' }];
  assert.deepEqual(inventedLiterals('Bcc the user (someone.else@mail.example) on the second reminder.', words), ['someone.else@mail.example']);
  assert.deepEqual(inventedLiterals('Send the summary to nadia@yoga.example.', words), []);
  assert.deepEqual(inventedLiterals('Post it in #ops-alerts and see https://x.example/a', words), ['#ops-alerts', 'https://x.example/a']);
  const { conditions } = toConditions([
    { quote: 'bcc me on the 2nd one', summary: 'Bcc the user (someone.else@mail.example) on the second reminder only.', kind: 'must', checkable: true, why: null },
    { quote: 'send the summary to nadia@yoga.example', summary: 'Send the summary to nadia@yoga.example.', kind: 'must', checkable: true, why: null }], words);
  assert.equal(conditions[0].summary, 'bcc me on the 2nd one', 'the invented address never reaches the bind prompt or a screen');
  assert.equal(conditions[1].summary, 'Send the summary to nadia@yoga.example.');
});
