// node --test experiments/autobench/verifier/code-checks/code-checks.test.mjs
// Synthetic worlds only: no benchmark task, world or grader text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify } from './verify.mjs';
import { deterministicFacts, groundFacts } from './facts.mjs';
import { numbersIn, datesIn, promptToday } from './lib.mjs';
import { literalMatcher } from './checks.mjs';
import { effectAtoms, pick } from './select.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const world0 = () => ({
  meta: { current_time: '2026-02-15T09:00:00Z' },
  google_sheets: { spreadsheets: [{ id: 'sh_src', title: 'Source' }], worksheets: [{ id: 'tab_a', spreadsheet_id: 'sh_src', title: 'A' }],
    rows: [{ id: 'r1', spreadsheet_id: 'sh_src', worksheet_id: 'tab_a', cells: { Name: 'Alpha Co', Amount: '$1,234.56', Status: 'Open', Due: '2026-02-01' } },
      { id: 'r2', spreadsheet_id: 'sh_src', worksheet_id: 'tab_a', cells: { Name: 'Beta Ltd', Amount: '$980', Status: 'Closed', Due: '2026-01-20' } }] },
  slack: { channels: [{ id: 'C1', name: 'team-alerts' }], messages: [] },
  gmail: { messages: [{ id: 'm0', from_: 'boss@corp.test', to: ['me@corp.test'], subject: 'Policy', body_plain: 'Send reports to lead@corp.test. Never post totals in #general.' }] },
});
const view = (user, changes) => ({ prompt: { system: '', user }, today: '2026-02-15T09:00:00Z', services: ['gmail', 'slack', 'google_sheets'], diff: { changes } });
const email = (to, subject, body, id = 'e' + Math.random()) => ({ app: 'gmail', coll: 'messages', op: 'created', id, record: { id, to: [to], subject, body_plain: body, label_ids: ['SENT'] } });
const status = (r, id) => r.checks.find(c => c.id === id).status;

test('an empty diff fails effect.nonempty and is rejected', () => {
  const r = verify({ view: view('Email the report to lead@corp.test.', []), world0: world0() });
  assert.equal(status(r, 'effect.nonempty'), 'fail');
  assert.equal(r.accept, false);
});

test('a complete, verbatim report to the named recipient is accepted', () => {
  const r = verify({ view: view('Email the report to lead@corp.test. Include the relevant amounts from the source data in your message(s).',
    [email('lead@corp.test', 'Report', 'Alpha Co owes $1,234.56.')]), world0: world0() });
  assert.equal(r.accept, true, JSON.stringify(r.checks.filter(c => c.status === 'fail')));
  assert.equal(status(r, 'value.amounts_in_messages'), 'pass');
});

test('a message admitting unfinished work fails text.incomplete; a requested decline does not', () => {
  const bad = verify({ view: view('Email the report to lead@corp.test.', [email('lead@corp.test', 'Report', 'I could not calculate the totals; will be sent once the date is confirmed.')]), world0: world0() });
  assert.equal(status(bad, 'text.incomplete'), 'fail');
  const decline = verify({ view: view('Email each requester the outcome, explaining why rejected requests were declined.', [email('lead@corp.test', 'Request', 'We are unable to schedule your request.')]), world0: world0() });
  assert.equal(status(decline, 'text.incomplete'), 'pass');
});

test('recipients must exist in the world or the request', () => {
  const r = verify({ view: view('Notify the lead.', [email('invented@nowhere.test', 'Hi', 'Hello')]), world0: world0() });
  assert.equal(status(r, 'target.recipients_known'), 'fail');
});

test('named outputs: a missing address or channel fails; a world-contested one is not required', () => {
  const r = verify({ view: view('Email lead@corp.test and post to #team-alerts.', [email('lead@corp.test', 'x', 'y')]), world0: world0() });
  assert.equal(status(r, 'target.named_outputs'), 'fail');
  assert.match(JSON.stringify(r.checks.find(c => c.id === 'target.named_outputs').evidence), /team-alerts/);
  const c = verify({ view: view('Email lead@corp.test and post totals to #general.', [email('lead@corp.test', 'x', 'y')]), world0: world0() });
  assert.equal(status(c, 'target.named_outputs'), 'pass');
});

test('ids that exist nowhere in the world are targets and must be written', () => {
  const user = 'Log it in the tracker (tbl_log).';
  const miss = verify({ view: view(user, [email('lead@corp.test', 'x', 'y')]), world0: world0() });
  assert.equal(status(miss, 'target.named_outputs'), 'fail');
  const hit = verify({ view: view(user, [{ app: 'airtable', coll: 'actions.createRecord', op: 'created', id: 'a1', record: { id: 'a1', action_key: 'createRecord', params: { table: 'tbl_log', fields: { Note: 'done' } } } }]), world0: world0() });
  assert.equal(status(hit, 'target.named_outputs'), 'pass');
});

test('prescribed literals and templates: filled templates pass, raw slots fail', () => {
  const user = "Create a page titled 'Review: <Company>' for the account.";
  const ok = verify({ view: view(user, [{ app: 'notion', coll: 'actions.create_page', op: 'created', id: 'p1', record: { id: 'p1', params: { title: 'Review: Alpha Co' } } }]), world0: world0() });
  assert.equal(status(ok, 'target.literals'), 'pass');
  const raw = verify({ view: view(user, [{ app: 'notion', coll: 'actions.create_page', op: 'created', id: 'p1', record: { id: 'p1', params: { title: 'Review: <Company>' } } }]), world0: world0() });
  assert.equal(status(raw, 'target.literals'), 'fail');
  assert.equal(status(raw, 'text.placeholder'), 'fail');
});

test('a composite path used as one id fails target.refs_composite', () => {
  const r = verify({ view: view('Create the page in wiki_ops/SP_X.', [{ app: 'confluence', coll: 'actions.pageCreate', op: 'created', id: 'c1', record: { id: 'c1', params: { spaceId: 'wiki_ops/SP_X', title: 't' } } }]), world0: world0() });
  assert.equal(status(r, 'target.refs_composite'), 'fail');
});

test('a wall-clock date far from the task time fails text.date_anchor', () => {
  const r = verify({ view: view('Email the report to lead@corp.test.', [email('lead@corp.test', 'Report as of 2026-10-15', 'Totals as of 2026-10-15.')]), world0: world0() });
  assert.equal(status(r, 'text.date_anchor'), 'fail');
  const ok = verify({ view: view('Email the report to lead@corp.test.', [email('lead@corp.test', 'Report as of 2026-02-15', 'Due 2026-02-01.')]), world0: world0() });
  assert.equal(status(ok, 'text.date_anchor'), 'pass');
});

test('rounded source values fail value.verbatim_numbers; exact ones pass', () => {
  const r = verify({ view: view('Email lead@corp.test.', [email('lead@corp.test', 'x', 'Alpha Co owes $1,235.')]), world0: world0() });
  assert.equal(status(r, 'value.verbatim_numbers'), 'fail');
  const ok = verify({ view: view('Email lead@corp.test.', [email('lead@corp.test', 'x', 'Alpha Co owes $1,234.56.')]), world0: world0() });
  assert.equal(status(ok, 'value.verbatim_numbers'), 'pass');
});

test('the same message twice fails effect.duplicates', () => {
  const r = verify({ view: view('Email lead@corp.test.', [email('lead@corp.test', 'Report', 'a', 'e1'), email('lead@corp.test', 'Report', 'b', 'e2')]), world0: world0() });
  assert.equal(status(r, 'effect.duplicates'), 'fail');
});

test('enumerating skipped items fails scope.no_skip_enumeration unless outcomes were requested', () => {
  const r = verify({ view: view('Email lead@corp.test the processed items.', [email('lead@corp.test', 'Done', 'Processed Alpha Co. Skipped Beta Ltd (closed).')]), world0: world0() });
  assert.equal(status(r, 'scope.no_skip_enumeration'), 'fail');
});

test('deletions need a request', () => {
  const del = { app: 'google_sheets', coll: 'rows', op: 'deleted', id: 'r2', record: {} };
  assert.equal(status(verify({ view: view('Update the sheet.', [del]), world0: world0() }), 'scope.no_unrequested_mutation'), 'fail');
  assert.equal(status(verify({ view: view('Remove closed rows from the sheet.', [del]), world0: world0() }), 'scope.no_unrequested_mutation'), 'pass');
});

test('closed-world scope with model facts: outside-scope updates are flagged', () => {
  const hf = { outputs: [], sources: [], tracker: { present: false, target: '', per_entity: false }, deletions_requested: false, outcome_notices_requested: false,
    scope: { entity: 'rows', quantifier: 'all', conditions: [{ field: 'Status', value: 'Open' }] } };
  const upd = id => ({ app: 'google_sheets', coll: 'rows', op: 'updated', id, ref: {}, fields: { 'cells.Status': ['x', 'Done'] } });
  const r = verify({ view: view('Process all open rows.', [upd('r2')]), world0: world0(), hf });
  assert.equal(status(r, 'scope.closed_world_outside'), 'fail');
  assert.equal(status(r, 'scope.closed_world_missed'), 'fail');
  const ok = verify({ view: view('Process all open rows.', [upd('r1')]), world0: world0(), hf });
  assert.equal(status(ok, 'scope.closed_world_outside'), 'pass');
  assert.equal(status(ok, 'scope.closed_world_missed'), 'pass');
});

test('model facts are grounded in the request text', () => {
  const g = groundFacts({ outputs: [{ app: 'gmail', action: 'send_message', target: 'x@y.test', per_entity: false, literals: ['Exact Title', 'Review: <Co>'] }],
    sources: ['tab_a', 'invented'], tracker: { present: true, target: 'tbl_log', per_entity: true },
    scope: { entity: 'rows', quantifier: 'all', conditions: [{ field: 'Status', value: 'open' }, { field: 'date', value: '2026-10-21' }] } }, "Process all open rows from tab_a and title it 'Review: Alpha'.");
  assert.equal(g.outputs[0].target, '');
  assert.deepEqual(g.outputs[0].literals, ['Review: <Co>']);
  assert.deepEqual(g.sources, ['tab_a']);
  assert.equal(g.tracker.target, '');
  assert.deepEqual(g.scope.conditions.map(c => c.value), ['open']);
});

test('deterministic facts, numbers, dates and literal matching', () => {
  const f = deterministicFacts("Today is January 27, 2026. Email a@b.test (CC c@d.test) and post to #ops. Set the status to 'Done' for tbl_x.");
  assert.equal(f.today, '2026-01-27');
  assert.deepEqual(f.emails.map(e => e.role), ['to', 'cc']);
  assert.deepEqual(f.channels, ['ops']);
  assert.deepEqual(f.ids, ['tbl_x']);
  assert.equal(f.quoted.find(q => q.text === 'Done').output, true);
  assert.deepEqual(numbersIn('INV-2026-0452 totals $13,600.00 on 2026-02-11').map(n => n.value), [13600]);
  assert.deepEqual(datesIn('Feb 2, 2026 and 2026-03-05'), ['2026-03-05', '2026-02-02']);
  assert.equal(promptToday("It's March 2026."), '2026-03-01');
  assert.equal(literalMatcher('Dock [N] - [Company Name]').test('Dock 3 - Acme'), true);
  assert.equal(literalMatcher('Dock [N] - [Company Name]').test('Dock [N] - Acme'), false);
});

test('selector: highest score wins, then consensus or the fork order', () => {
  const A = effectAtoms({ changes: [email('lead@corp.test', 's', 'total 120')] }), B = effectAtoms({ changes: [email('lead@corp.test', 's', 'total 120')] }),
    C = effectAtoms({ changes: [email('other@corp.test', 's', 'total 99')] });
  assert.equal(pick([{ score: 0.7, atoms: A, order: 0 }, { score: 1, atoms: C, order: 1 }]), 1);
  assert.equal(pick([{ score: 1, atoms: C, order: 0 }, { score: 1, atoms: A, order: 1 }, { score: 1, atoms: B, order: 2 }], { tiebreak: 'consensus' }), 1);
  assert.equal(pick([{ score: 1, atoms: C, order: 0 }, { score: 1, atoms: A, order: 1 }]), 0);
});

test('H7/H8 hygiene: verifier sources carry no benchmark ids, addresses or task names', () => {
  for (const f of readdirSync(HERE).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))) {
    const s = readFileSync(path.join(HERE, f), 'utf8');
    assert.doesNotMatch(s, /example\.com|\b(?:ss|ws|brd|cal|pg|rec)_[a-z0-9]{2,}/i, f);
    assert.doesNotMatch(s, /\b(?:sales|marketing|operations|support|finance|hr)\.[a-z]+_[a-z_]+\b/, f);
  }
});
