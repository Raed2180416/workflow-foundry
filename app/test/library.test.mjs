// The template library and its local stand-ins ($0, no model). node --test --test-concurrency=1 app/test/library.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadLibrary, fillSchema, resolveSlots, instantiate, practiceOf, promises, templateOf, slotsOf } from '../core/library.mjs';
import { validateStrict, runInWorld } from '../core/practice.mjs';
import { appRegistry } from '../core/capabilities.mjs';
import { seedWorld, readWorld } from '../core/stand-ins.mjs';
import { portableSchemaViolations } from '../../src/schema-subset.mjs';
import { Foundry } from '../../src/foundry.mjs';

const library = loadLibrary();
const fillOf = slots => ({ slots, notStated: [], questions: [], assumptions: [] });
const verifies = flow => flow.nodes.flatMap(n => [...(n.kind === 'verify' ? [n] : []), ...(n.body ? verifies(n.body) : [])]);
const tools = flow => flow.nodes.flatMap(n => [...(n.tool ? [n.tool] : []), ...(n.body ? tools(n.body) : [])]);
const LOCAL = /^(core\.|rows\.|sheet\.|outbox\.|chat\.|report\.)/;

test('seven frontier-written templates, each typed, local-only, with acceptance checks and an independent gating verify', () => {
  assert.equal(library.length, 7);
  for (const t of library) {
    assert.match(t.author, /claude-opus-5-5 \(frontier author/, t.id);
    for (const k of ['title', 'whenToUse', 'notFor', 'slots', 'capabilities', 'practice', 'example', 'willDo', 'willNotDo']) assert.ok(t[k], `${t.id} has ${k}`);
    const r = resolveSlots(t, fillOf(t.example), { text: JSON.stringify(t.example) });
    assert.deepEqual([r.problems, r.questions], [[], []], t.id);
    const wf = instantiate(t, r.values, { builder: 'test' });
    const v = validateStrict(wf);
    assert.equal(v.valid, true, `${t.id}: ${JSON.stringify(v.errors)}`);
    assert.ok(verifies(wf).length >= 1 && verifies(wf).every(n => n.independence === 'execution' && n.gate === true), `${t.id} has a gating execution verify`);
    assert.ok(wf.acceptance.length >= 2, t.id);
    for (const tool of tools(wf)) { assert.match(tool, LOCAL, `${t.id} uses only local stand-ins`); assert.ok(t.capabilities.includes(tool) || tool === 'core.aggregate' || tool === 'core.artifact' || tool === 'outbox.check', `${t.id} declares ${tool}`); }
    assert.equal(templateOf(wf).id, t.id); assert.deepEqual(slotsOf(wf), r.values);
    assert.match(wf.metadata.rationale, /Frontier-written template/);
  }
});

test('every template passes its practice run with its example slots, and its promises name the targets', async () => {
  for (const t of library) {
    const r = resolveSlots(t, fillOf(t.example), { text: JSON.stringify(t.example) });
    const wf = instantiate(t, r.values, { builder: 'test' }), world = practiceOf(t);
    const res = await runInWorld(wf, { sheets: world.sheets, input: world.input, mode: 'practice' });
    assert.equal(res.passed, true, `${t.id}: ${res.status} ${JSON.stringify(res.error)}`);
    const { willDo, willNotDo } = promises(t, r.values);
    assert.ok(willDo.length >= 3 && willNotDo.length >= 2, t.id);
    assert.equal(/\[\[|\]\]/.test([...willDo, ...willNotDo].join(' ')), false, `${t.id} promises are fully rendered`);
  }
});

test('the model-facing fill schema is portable and strict-mode friendly: no unions, no bounds, closed objects', () => {
  const walk = (s, at) => {
    assert.equal(Array.isArray(s.type), false, `${at} has no union type`);
    for (const k of ['minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern']) assert.equal(k in s, false, `${at} has no ${k}`);
    if (s.type === 'object') { assert.equal(s.additionalProperties, false, at); assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${at} requires every property`); for (const [k, v] of Object.entries(s.properties)) walk(v, `${at}.${k}`); }
    if (s.type === 'array') walk(s.items, `${at}[]`);
  };
  for (const t of library) { const s = fillSchema(t); assert.deepEqual(portableSchemaViolations(s), [], t.id); walk(s, t.id); }
});

test('slot resolution: unwritten addresses are asked, never guessed; defaults are visible; constraints and incomplete rules are caught', () => {
  const by = id => library.find(t => t.id === id);
  // A recipient the person never wrote is treated as not given, and asked.
  let r = resolveSlots(by('weekly-report'), fillOf({ team: 'Platform', recipient: 'boss@company.com', listOpen: false, listBlocked: false }), { text: 'tell my boss what we did' });
  assert.deepEqual(r.questions.map(q => q.slot), ['recipient']); assert.deepEqual(r.ungrounded.map(u => u.slot), ['recipient']);
  r = resolveSlots(by('weekly-report'), { ...fillOf({ team: '', recipient: 'Boss@Co.example', listOpen: false, listBlocked: false }), notStated: ['team', 'listOpen', 'listBlocked'] }, { text: 'send to boss@co.example' });
  assert.deepEqual(r.questions, []); assert.equal(r.values.recipient, 'boss@co.example'); assert.deepEqual(r.defaults.map(d => d.slot), ['team', 'listOpen', 'listBlocked']);
  // The summary address is asked only when a summary is wanted.
  const inv = by('invoice-chase'), base = { firstAfterDays: 7, secondAfterDays: 14, finalAfterDays: 30, signature: 'x', sendSummary: false, summaryTo: '' };
  assert.deepEqual(resolveSlots(inv, fillOf(base), { text: '' }).questions, []);
  assert.deepEqual(resolveSlots(inv, fillOf({ ...base, sendSummary: true }), { text: '' }).questions.map(q => q.slot), ['summaryTo']);
  assert.match(resolveSlots(inv, fillOf({ ...base, secondAfterDays: 5 }), { text: '' }).problems.join(' '), /secondAfterDays must be later/);
  assert.deepEqual(resolveSlots(inv, fillOf({ ...base, secondAfterDays: 0, finalAfterDays: 0 }), { text: '' }).problems, [], '0 turns a stage off');
  // A routing rule whose address was never written makes the rules incomplete: asked, not guessed.
  const leads = by('lead-triage');
  r = resolveSlots(leads, fillOf({ rules: [{ field: 'region', op: 'is', value: 'EMEA', assignTo: 'dana@shop.example' }], defaultAssignee: 'sam@shop.example' }), { text: 'europe goes to dana, rest to sam@shop.example' });
  assert.deepEqual(r.questions.map(q => q.slot), ['rules']);
  r = resolveSlots(leads, fillOf({ rules: [], defaultAssignee: 'sam@shop.example' }), { text: 'all to sam@shop.example' });
  assert.deepEqual([r.questions, r.problems], [[], []], 'no rules is a valid answer and is not asked');
  assert.match(resolveSlots(leads, fillOf({ rules: [{ field: 'companySize', op: 'atLeast', value: 'big', assignTo: 'a@b.example' }], defaultAssignee: 'a@b.example' }), { text: 'a@b.example' }).problems.join(), /must be a number/);
  // The money limit is asked, never defaulted.
  assert.deepEqual(resolveSlots(by('expense-approval'), { ...fillOf({ autoApproveUpTo: 100, approver: 'f@x.example', requireReceipt: true, notifyEmployees: false }), notStated: ['autoApproveUpTo'] }, { text: 'f@x.example' }).questions.map(q => q.slot), ['autoApproveUpTo']);
  // A channel counts as written when its name appears, with or without the #.
  assert.deepEqual(resolveSlots(by('oncall-digest'), fillOf({ channel: 'ops', windowHours: 24, minSeverity: 'warning', page: false, pageTo: '' }), { text: 'post it in the ops channel' }).questions, []);
  assert.deepEqual(resolveSlots(by('oncall-digest'), fillOf({ channel: '#general', windowHours: 24, minSeverity: 'warning', page: false, pageTo: '' }), { text: 'post it in the ops channel' }).questions.map(q => q.slot), ['channel']);
});

test('what the templates never do: disputed and paid invoices, urgent tickets, unsubscribed contacts, spending over the limit', async () => {
  const run = async (id, slots) => { const t = library.find(x => x.id === id), w = practiceOf(t); return runInWorld(instantiate(t, resolveSlots(t, fillOf(slots), { text: JSON.stringify(slots) }).values), { sheets: w.sheets, input: w.input }); };
  const inv = await run('invoice-chase', library[1].example);
  assert.equal(inv.passed, true);
  assert.equal(inv.effects.outbox.some(m => /bakery|garage/.test(m.to)), false, 'paid and disputed invoices are never chased');
  assert.equal(inv.effects.outbox.filter(m => /practice-studio/.test(m.to)).length, 0, 'an invoice 2 days late is not due yet');
  const sup = await run('support-deflection', library.find(t => t.id === 'support-deflection').example);
  assert.equal(sup.effects.outbox.some(m => m.to.startsWith('cy@')), false, 'an urgent ticket that mentions a keyword still goes to a person');
  assert.match(sup.effects.outbox.find(m => m.to.startsWith('support-lead@')).body, /ticket P-3 \[urgent\]/);
  const sync = await run('contact-sync', { onlyTag: '', addMissing: true, reportTo: 'owner@practice.example' });
  assert.deepEqual(sync.effects.appended.newsletter.map(r => r.email).sort(), ['b@practice-co.example', 'e@practice-co.example'], 'c (unsubscribed) is never added; d matches ignoring case');
  const exp = await run('expense-approval', { autoApproveUpTo: 10, approver: 'f@practice.example', requireReceipt: true, notifyEmployees: false });
  assert.deepEqual(exp.effects.appended['expense-decisions'].filter(r => r.decision === 'approved').map(r => r.id), [], 'PX-1 (18.50) is over a limit of 10; PX-3 has no receipt');
});

test('invoice reminders are sent once per stage: a second run the same day sends nothing new', async () => {
  const t = library.find(x => x.id === 'invoice-chase'), w = practiceOf(t);
  const wf = instantiate(t, resolveSlots(t, fillOf({ ...t.example, sendSummary: false, summaryTo: '' }), { text: '' }).values);
  const dir = mkdtempSync(path.join(tmpdir(), 'lib-dedupe-')), outbox = path.join(dir, 'outbox'), world = path.join(dir, 'world');
  seedWorld(world, { sheets: w.sheets });
  const foundry = new Foundry(path.join(dir, 'store'), { registry: appRegistry({ mode: 'practice', outboxDir: outbox, worldDir: world }) });
  try {
    foundry.save(wf);
    const first = await foundry.startRun(foundry.createRun(wf.id, w.input).id);
    assert.equal(first.status, 'succeeded'); const sent = readdirSync(outbox).length; assert.equal(sent, 3);
    const second = await foundry.startRun(foundry.createRun(wf.id, w.input).id);
    assert.equal(second.status, 'succeeded'); assert.equal(second.verdict.verdict, 'pass');
    assert.equal(readdirSync(outbox).length, sent, 'no reminder twice');
  } finally { await foundry.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('stand-ins: row operations, idempotent appends, and audits that fail on a mismatch', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lib-standins-')), world = path.join(dir, 'world'), outbox = path.join(dir, 'outbox');
  try {
    const reg = appRegistry({ mode: 'live', outboxDir: outbox, worldDir: world });
    const ctx = (k = 'a'.repeat(64)) => ({ runId: 'run-1', nodeKey: 'n', idempotencyKey: k });
    const rows = [{ a: 'X ', n: 5, d: '2026-10-01' }, { a: 'y', n: 10, d: '2026-10-10' }, { a: 'z', n: 'ten' }];
    assert.equal((await reg.execute('rows.filter', { rows, where: [{ field: 'a', op: 'eq', value: 'x' }] }, ctx())).count, 1, 'text equality ignores case and spaces');
    assert.equal((await reg.execute('rows.filter', { rows, where: [{ field: 'n', op: 'gte', value: 5 }] }, ctx())).count, 2, 'order ops never coerce text');
    assert.deepEqual((await reg.execute('rows.age', { rows: rows.slice(0, 2), field: 'd', now: '2026-10-11T12:00:00Z', as: 'age' }, ctx())).rows.map(r => r.age), [10, 1]);
    await assert.rejects(reg.execute('rows.age', { rows, field: 'd', now: '2026-10-11', as: 'age' }, ctx()), { code: 'ROWS_DATE' });
    assert.deepEqual((await reg.execute('rows.route', { rows, rules: [{ field: 'n', op: 'gte', value: 10, set: { big: true } }], otherwise: { big: false } }, ctx())).rows.map(r => r.big), [false, true, false]);
    const rec = await reg.execute('rows.reconcile', { left: [{ e: 'A@x', v: 1 }, { e: 'b@x', v: 2 }], right: [{ e: 'a@x', v: 9 }, { e: 'c@x' }], key: 'e', compare: ['v'] }, ctx());
    assert.deepEqual(rec.counts, { missing: 1, extra: 1, changed: 1, matched: 1 });
    seedWorld(world, { sheets: { s: [{ id: 1 }] } });
    await reg.execute('sheet.append', { sheet: 's', rows: [{ id: 2 }] }, ctx());
    await reg.execute('sheet.append', { sheet: 's', rows: [{ id: 2 }] }, ctx());
    assert.equal(readWorld(world).sheets.s.length, 2, 'a repeated step never appends twice');
    assert.equal((await reg.execute('sheet.audit', { sheet: 's', rows: 1 }, ctx())).pass, true);
    assert.equal((await reg.execute('sheet.audit', { sheet: 's', rows: 2 }, ctx())).pass, false);
    await reg.execute('outbox.send', { to: 'a@x.example', subject: 's', body: 'b' }, ctx('b'.repeat(64)));
    assert.equal((await reg.execute('outbox.audit', { to: ['a@x.example'] }, ctx())).pass, true);
    assert.equal((await reg.execute('outbox.audit', { to: ['a@x.example', 'a@x.example'] }, ctx())).pass, false, 'a missing second message fails');
    assert.equal((await reg.execute('outbox.audit', { to: [] }, ctx())).pass, false, 'an unexpected message fails');
    await reg.execute('chat.post', { channel: '#ops', text: 'hi' }, ctx('c'.repeat(64)));
    assert.equal((await reg.execute('chat.audit', { channel: '#ops', posts: 1 }, ctx())).pass, true);
    await assert.rejects(reg.execute('chat.post', { channel: 'ops', text: 'hi' }, ctx('d'.repeat(64))), { code: 'CHAT_CHANNEL' });
    await assert.rejects(reg.execute('sheet.read', { sheet: '../etc' }, ctx()), { code: 'SHEET_NAME' });
    assert.equal(existsSync(path.join(world, 'chat', 'ops.json')), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
