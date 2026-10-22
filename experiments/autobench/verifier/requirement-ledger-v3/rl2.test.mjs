// Unit tests for the requirement-ledger-v2 verifier: synthetic worlds only (no benchmark data), plus a hygiene test that
// the verifier sources carry no task names, grader check names or lab paths (PREREG-AB-v1 H7/H8).
//   node --test experiments/autobench/verifier/requirement-ledger-v2/rl2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { containsLiteral, findSpan, grounded, indexWorld, remapRecord, resolvePtr } from './lib.mjs';
import { groundLedger, extractionInput } from './extract.mjs';
import { compileRequirement, mergeLedgers } from './compile.mjs';
import { effectsOf, evaluateCheck, runCodeChecks } from './check.mjs';
import { combine } from './verify.mjs';
import { parseJudge } from './judge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const world0 = () => ({
  meta: { current_time: '2030-01-10T09:00:00Z' },
  gmail: { messages: [{ id: 'm_rule', from_: 'boss@acme.test', to: ['ops@acme.test'], subject: 'Policy', body_plain: 'Refunds over $500 need approval. Notify the owner. Do NOT email the auditor@acme.test about refunds.' }] },
  google_sheets: {
    spreadsheets: [{ id: 'ss_1', title: 'Refunds' }],
    worksheets: [{ id: 'ws_1', spreadsheet_id: 'ss_1', title: 'Queue' }, { id: 'ws_log', spreadsheet_id: 'ss_1', title: 'Log' }],
    rows: [
      { id: 'aaaaaaaabbbbbbbbccccccccdddddddd', spreadsheet_id: 'ss_1', worksheet_id: 'ws_1', row_id: 2, cells: { Customer: 'Zoë Ltd', Owner: 'ann@acme.test', Amount: '$1,250.00', Status: 'Pending' } },
      { id: 'eeeeeeeeffffffff0000000011111111', spreadsheet_id: 'ss_1', worksheet_id: 'ws_1', row_id: 3, cells: { Customer: 'Bo Inc', Owner: 'bob@acme.test', Amount: '$90', Status: 'Pending' } },
    ],
  },
  slack: { channels: [{ id: 'C_OPS', name: 'ops-alerts' }], messages: [] },
});
const view = (diff = { changes: [] }) => ({ prompt: { system: 'You are an agent.', user: 'Process the refund queue and follow our policy. Post a summary to #ops-alerts.' }, today: '2030-01-10T09:00:00Z', services: ['gmail', 'google_sheets', 'slack'], diff });

test('literal matching: word boundaries, numbers, diacritics', () => {
  assert.equal(containsLiteral('Three items', 'HR'), null);
  assert.equal(containsLiteral('Team HR update', 'hr'), 'exact');
  assert.equal(containsLiteral('Refund of $1,250.00 approved', '$1,250.00'), 'exact');
  assert.equal(containsLiteral('Refund of 1250 approved', '$1,250.00'), 'numeric');
  assert.equal(containsLiteral('Refund of $1,205.00', '$1,250.00'), null);
  assert.equal(containsLiteral('for Zoe Ltd', 'Zoë Ltd'), 'exact');
  assert.ok(findSpan('do not  email the auditor', 'x Do NOT email the auditor@y') !== null);
  assert.ok(grounded('Refunds over $500 ... Notify the owner', 'Refunds over $500 need approval. Notify the owner.'));
});

test('index aliases long ids; remap finds a sheet row by content after a re-prepare', () => {
  const idx = indexWorld(world0());
  const r = idx.recs.find(x => x.id.startsWith('aaaa'));
  assert.equal(r.alias, 'x1');
  assert.equal(resolvePtr('google_sheets.rows:x1', idx)?.ptr, r.ptr);
  const w2 = world0();
  w2.google_sheets.rows[0].id = '99999999999999999999999999999999';
  const idx2 = indexWorld(w2);
  assert.equal(remapRecord(r, idx2)?.id, '99999999999999999999999999999999');
});

test('grounding drops invented recipients and resolves alias pointers', () => {
  const w = world0(), idx = indexWorld(w);
  const raw = { today: '', rule_sources: [], items: [], requirements: [
    { id: 'R1', type: 'positive', kind: 'must', statement: 'Email the owner', effect: 'send_email', app: 'gmail', recipients: ['ann@acme.test', 'ghost@nowhere.test'], channel: '', record: '', container: '', field: '', value: '', must_include: ['$1,250.00', 'Approved by finance'], must_not_include: [], item: 'google_sheets.rows:x1', source: 'gmail.messages:m_rule', quote: 'Notify the owner.', computed: false },
    { id: 'R2', type: 'value', kind: 'must', statement: 'Mark the row', effect: 'update_row', app: 'google_sheets', recipients: [], channel: '', record: 'google_sheets.rows:x1', container: '', field: 'Status', value: 'Pending', must_include: [], must_not_include: [], item: '', source: 'request', quote: 'not in the request', computed: false },
  ] };
  const g = groundLedger(raw, { view: view(), idx });
  assert.deepEqual(g.requirements[0].recipients, ['ann@acme.test']);
  assert.equal(g.requirements[0].include[0].grounded, true);
  assert.equal(g.requirements[0].include[1].grounded, false);
  assert.equal(g.requirements[0].quoteOk, 'cited');
  assert.equal(g.requirements[1].record, idx.recs.find(x => x.id.startsWith('aaaa')).ptr);
  assert.equal(g.requirements[1].quoteOk, false);
  const { checks, judged } = compileRequirement(g.requirements[0]);
  assert.deepEqual(checks.map(c => c.type), ['msg_to', 'msg_has']);
  assert.ok(judged && /Approved by finance/.test(judged.statement));
});

const req = (o) => ({ id: 'R', type: 'positive', kind: 'must', statement: 's', effect: 'send_email', app: 'gmail', recipients: [], channel: null, record: null, container: null, field: '', value: '', include: [], exclude: [], item: null, source: 'request', quote: 'q', quoteOk: 'cited', computed: false, ...o });

test('compile: negatives, duplicates, conditional prohibitions', () => {
  assert.deepEqual(compileRequirement(req({ kind: 'must_not', type: 'negative', recipients: ['x@a.test'] })).checks.map(c => [c.type, c.weak]), [['msg_none', false]]);
  assert.deepEqual(compileRequirement(req({ kind: 'must_not', type: 'negative', recipients: ['x@a.test'], quoteOk: false })).checks.map(c => [c.type, c.weak]), [['msg_none', true]]);
  assert.deepEqual(compileRequirement(req({ kind: 'must_not', type: 'side_effect', statement: 'no duplicate notices', recipients: ['x@a.test'] })).checks.map(c => c.type), ['no_dup']);
  const cond = compileRequirement(req({ kind: 'must_not', type: 'negative', statement: 'Do not email x before the CEO signs', recipients: ['x@a.test'] }));
  assert.equal(cond.checks.length, 0); assert.ok(cond.judged);
});

test('merge: majority makes hard, contradictions resolve by support, a reader keeps its own positive', () => {
  const L = (reader, reqs) => ({ reader, ok: true, items: [], requirements: reqs });
  const pos = req({ recipients: ['a@a.test'] }), neg = req({ kind: 'must_not', type: 'negative', recipients: ['a@a.test'] }), other = req({ recipients: ['b@a.test'] });
  const m = mergeLedgers([L('r1', [pos, neg]), L('r2', [pos]), L('r3', [neg, other])]);
  const byKey = Object.fromEntries(m.checks.map(c => [c.key, c]));
  assert.equal(byKey['msg_to|@a@a.test'].hard, true, 'r1 drops its own negative: 2 positive votes against 1');
  assert.equal(byKey['msg_none|@a@a.test'], undefined, 'the minority side is dropped');
  assert.equal(byKey['msg_to|@b@a.test'].hard, false, 'one reader of three: soft');
  const m2 = mergeLedgers([L('r1', [pos]), L('r2', [pos]), L('r3', [neg])]);
  assert.equal(m2.checks.find(c => c.key === 'msg_to|@a@a.test').hard, true);
  assert.equal(m2.checks.find(c => c.key === 'msg_none|@a@a.test'), undefined, 'minority side dropped');
});

test('code checks on a synthetic diff', () => {
  const w = world0(), idx = indexWorld(w);
  const rowPtr = idx.recs.find(x => x.id.startsWith('aaaa')).ptr;
  const diff = { changes: [
    { app: 'gmail', coll: 'messages', op: 'created', id: 'n1', record: { id: 'n1', from_: 'me@acme.test', to: ['ann@acme.test'], subject: 'Refund', body_plain: 'Refund of $1,250.00 for Zoe Ltd approved.' } },
    { app: 'slack', coll: 'messages', op: 'created', id: null, record: { channel_id: 'C_OPS', text: 'Processed 1 refund.' } },
    { app: 'google_sheets', coll: 'rows', op: 'updated', id: 'aaaaaaaabbbbbbbbccccccccdddddddd', fields: { 'cells.Status': ['Pending', 'Approved'], updated_at: [1, 2] } },
    { app: 'google_sheets', coll: 'rows', op: 'created', id: 'new1', record: { id: 'new1', spreadsheet_id: 'ss_1', worksheet_id: 'ws_log', cells: { Customer: 'Zoë Ltd', Amount: '$1,250.00' } } },
  ] };
  const final = structuredClone(w); final.google_sheets.rows[0].cells.Status = 'Approved';
  const eff = effectsOf(diff, w);
  const ctx = { mapPtr: p => { const r = idx.byPtr.get(p); return r ? { app: r.app, coll: r.coll, id: r.id } : null; }, final };
  const ev = (type, params, polarity = 'must') => evaluateCheck({ type, params, polarity }, eff, ctx).pass;
  assert.equal(ev('msg_to', { target: { email: 'ann@acme.test' } }), true);
  assert.equal(ev('msg_none', { target: { email: 'auditor@acme.test' } }), true);
  assert.equal(ev('msg_has', { target: { email: 'ann@acme.test' }, lit: '$1,250.00' }), true);
  assert.equal(ev('msg_has', { target: { email: 'ann@acme.test' }, lit: 'Bo Inc' }), false);
  assert.equal(ev('post_in', { target: { channel: { id: 'C_OPS', name: 'ops-alerts' } } }), true);
  assert.equal(ev('rec_field', { ptr: rowPtr, field: 'Status', value: 'Approved' }), true);
  assert.equal(ev('rec_field', { ptr: rowPtr, field: 'Status', value: 'Pending' }), false);
  assert.equal(ev('created_has', { app: 'google_sheets', container: 'ws_log', label: null, lit: '$1,250.00' }), true);
  assert.equal(ev('created_none', { app: 'google_sheets', container: 'ws_log', lit: 'Bo Inc' }), true);
  assert.equal(ev('no_dup', { target: { email: 'ann@acme.test' } }), true);
  const merged = { readers: 1, checks: [{ key: 'k', type: 'msg_to', polarity: 'must', cat: 'positive', params: { target: { email: 'bob@acme.test' } }, hard: true, support: 1 }], judged: [] };
  const res = runCodeChecks(merged, { diff, world0: w, final, canonIdx: idx, rowIdx: idx });
  const v = combine({ code: res.results });
  assert.equal(v.accept, false); assert.equal(v.hardFails, 1);
});

test('combine: soft failures lower the score without a veto; judged not_met on a hard check vetoes', () => {
  const code = [{ key: 'effect_any', hard: true, pass: true }, { key: 'a', hard: false, pass: false }, { key: 'b', hard: true, pass: true }];
  const v = combine({ code });
  assert.equal(v.accept, true); assert.ok(v.score < 1 && v.score > 0.5);
  const judged = [{ id: 'J1', hard: true, kind: 'must', cat: 'value' }];
  assert.equal(combine({ code, judged, verdicts: parseJudge({ verdicts: [{ id: 'J1', verdict: 'not_met', evidence: 'x' }] }, judged) }).accept, false);
  assert.equal(combine({ code, judged, verdicts: parseJudge({ verdicts: [] }, judged) }).accept, true, 'a missing verdict is unclear, not a failure');
});

test('extraction prompt: request and records only, opaque ids aliased', () => {
  const x = extractionInput(view(), world0());
  assert.ok(x.prompt.includes('google_sheets.rows (2 records'));
  assert.ok(x.prompt.includes('| x1 |'));
  assert.ok(!x.prompt.includes('aaaaaaaabbbbbbbb'));
  assert.ok(!x.prompt.includes('current_time'), 'meta is never shown');
});

test('hygiene: verifier sources carry no task names, grader check names or lab paths', () => {
  // the verifier's logic (run.mjs is the harness: its leak guard names the label fields it refuses; eval.mjs scores labels)
  const files = ['lib.mjs', 'render.mjs', 'extract.mjs', 'compile.mjs', 'check.mjs', 'judge.mjs', 'verify.mjs'];
  const bad = [/\b(finance|hr|marketing|operations|sales|support)\.[a-z]+_[a-z_]+\b/, /gmail_message_sent|google_sheets_row_|_with_body_contains|slack_message_in_channel|salesforce_field_equals|task_completed_correctly|partial_credit/, /\/var\/tmp\/foundry-work|vlab|dataset\.jsonl|grade\.json|ceiling\.md|dump\.py/];
  for (const f of files) {
    const src = readFileSync(path.join(HERE, f), 'utf8');
    for (const re of bad) assert.ok(!re.test(src), `${f} matches ${re}`);
  }
  const lab = process.env.VLAB_TASKS;
  if (lab && existsSync(lab)) {
    const names = readFileSync(lab, 'utf8').split('\n').filter(Boolean);
    for (const f of files) { const src = readFileSync(path.join(HERE, f), 'utf8'); for (const n of names) assert.ok(!src.includes(n), `${f} names a task`); }
  }
});
