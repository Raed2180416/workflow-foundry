// CI-1 builder arms, retrieval, gates and the runner's scoring path on first-party fixtures, with a scripted ModelPort ($0, no model).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OneShotBuilder, ComposeBuilder, templateColumns, templateFitsData, practiceText, loadExamples, libraryBlock } from '../builders.mjs';
import { loadLibrary } from '../../../app/core/library.mjs';
import { wl, jaccard, exclusionsFor, maskRequest, shapeOfRequest, shapeOfDraft, skeleton, nodeLabel } from '../retrieve.mjs';
import { sharedBlocks, workspaceText, capabilityNames } from '../prompt.mjs';
import { respond, FALLBACK, EMPTY_WORKFLOW } from '../run-arm.mjs';
import { validateCi1, runBuilt } from '../foundry-world.mjs';

const [overdue, signup] = loadExamples();
const tasksWorld = { id: 'p1', now: '2026-03-10T08:00:00Z', sheets: { tasks: { columns: overdue.workspace.sheets.tasks.columns, rows: [
  { task_id: 'T1', title: 'Fix roof', owner_email: 'a@x.example', due: '2026-03-01', status: 'open', reminded_on: '' },
  { task_id: 'T2', title: 'Order tiles', owner_email: 'b@x.example', due: '2026-03-02', status: 'DONE', reminded_on: '' }] } } };

/** A ModelPort that answers each nodeKey from a script (a value, or a function of the request). */
function scriptedPort(script) {
  const calls = [];
  return { calls, call: async req => { calls.push(req); const v = script[req.nodeKey]; if (v === undefined) return { ok: false, error: { code: 'MODEL_UNAVAILABLE', message: `no script for ${req.nodeKey}` }, usage: {} };
    const value = typeof v === 'function' ? v(req) : v; return { ok: true, value: structuredClone(value), usage: { inputTokens: 1000, outputTokens: 100 }, costUsd: 0.0002 }; } };
}
const build = wf => ({ decision: 'build', reason: 'r', questions: [], workflow: wf });

test('worked examples validate against the CI-1 registry and do what their requests say', async () => {
  for (const ex of loadExamples()) assert.equal(validateCi1(ex.workflow).valid, true, ex.id);
  const r = await runBuilt(overdue.workflow, tasksWorld);
  assert.equal(r.status, 'succeeded');
  assert.deepEqual(r.effects.outbox.map(m => m.to), ['a@x.example'], 'only the owner of an overdue, unfinished task');
  assert.deepEqual(r.world.sheets.tasks.map(t => t.reminded_on), ['2026-03-10', '']);
  assert.match(libraryBlock(), /Worked examples/);
});

test('every template binds sheets and columns no CI-1 workspace has: none fits, so A1c always composes', () => {
  const lib = loadLibrary();
  assert.deepEqual(templateColumns(lib.find(t => t.id === 'invoice-chase')), { invoices: ['invoice', 'customer', 'email', 'amount', 'due', 'status'] });
  assert.deepEqual(templateColumns(lib.find(t => t.id === 'contact-sync')).newsletter, ['email', 'name', 'source', 'addedAt']);
  const fits = { invoices: { columns: ['Invoice', 'Customer', 'Email', 'Amount', 'Due', 'Status', 'extra'] } };
  assert.equal(templateFitsData(lib.find(t => t.id === 'invoice-chase'), { sheets: fits }), true, 'case-insensitive superset fits');
  assert.equal(templateFitsData(lib.find(t => t.id === 'invoice-chase'), { sheets: { invoices: { columns: ['Invoice ID', 'Client Name', 'Amount', 'Status', 'Due Date'] } } }), false);
});

test('the one-shot arm repairs once from validator errors, then gives up', async () => {
  const broken = { ...overdue.workflow, nodes: [{ ...overdue.workflow.nodes[0], tool: 'sheet.nope' }] };
  const p1 = scriptedPort({ build: build(broken), repair: build(overdue.workflow) });
  const r1 = await new OneShotBuilder({ port: p1 }).build({ request: overdue.request, workspace: overdue.workspace });
  assert.equal(r1.status, 'ready'); assert.equal(p1.calls.length, 2); assert.match(p1.calls[1].prompt, /failed validation/);
  assert.equal(r1.buildReport.calls, 2); assert.equal(r1.buildReport.costUsd, 0.0004);
  const p2 = scriptedPort({ build: build(broken), repair: build(broken) });
  assert.equal((await new OneShotBuilder({ port: p2 }).build({ request: overdue.request, workspace: overdue.workspace })).status, 'build_failed');
  const p3 = scriptedPort({ build: { decision: 'ask', reason: 'r', questions: [{ id: 'q1', question: 'Which channel?' }], workflow: {} } });
  const r3 = await new OneShotBuilder({ port: p3 }).build({ request: 'x', workspace: overdue.workspace });
  assert.equal(r3.status, 'needs_answers'); assert.equal(r3.questions[0].id, 'q1');
});

test('compose: invalid draft -> repair; practice run in the PUBLIC world; review fix -> rerun; review ok -> ready', async () => {
  const wrongMail = structuredClone(overdue.workflow); // sends to every owner, finished or not
  wrongMail.nodes[1].source = wrongMail.nodes[1].source.replace("String(r.status ?? '').trim().toLowerCase() !== 'done' && ", '');
  const invalid = { ...overdue.workflow, acceptance: [] };
  let reviews = 0;
  const port = scriptedPort({ compose: build(invalid), 'repair.r0': build(wrongMail),
    'review.r1': req => { reviews++; assert.match(req.prompt, /E-mails sent \(2\)/, 'the review sees the practice effects'); assert.match(req.prompt, /b@x\.example/); return { verdict: 'fix', problems: ['b@x.example got a finished task'], workflow: overdue.workflow }; },
    'review.r2': req => { reviews++; assert.match(req.prompt, /E-mails sent \(1\)/); return { verdict: 'ok', problems: [], workflow: {} }; } });
  const b = new ComposeBuilder({ port });
  const r = await b.build({ request: overdue.request, workspace: overdue.workspace, practiceWorld: tasksWorld });
  assert.equal(r.status, 'ready'); assert.equal(r.reviewed, true); assert.equal(reviews, 2);
  assert.deepEqual(r.workflow, overdue.workflow);
  assert.deepEqual(r.buildReport.repairs.map(x => x.kind), ['validation', 'review']);
  assert.deepEqual(r.buildReport.practiceRuns.map(x => x.status), ['succeeded', 'succeeded']);
  assert.deepEqual(r.buildReport.selection.fittingTemplates, []);
  assert.match(port.calls[0].prompt, /Worked examples/); assert.doesNotMatch(port.calls[0].prompt, /Patterns from similar automations/, 'A1c has no retrieval block');
});

test('compose without a clean review delivers the last workflow that ran, never one that did not', async () => {
  const fails = structuredClone(overdue.workflow); fails.nodes[0].args.sheet = 'no-such-sheet';
  const port = scriptedPort({ compose: build(overdue.workflow), 'review.r0': { verdict: 'fix', problems: ['p'], workflow: fails }, 'repair.r1': build(fails), 'repair.r2': build(fails) });
  const r = await new ComposeBuilder({ port }).build({ request: overdue.request, workspace: overdue.workspace, practiceWorld: tasksWorld });
  assert.equal(r.status, 'ready'); assert.equal(r.reviewed, false); assert.deepEqual(r.workflow, overdue.workflow);
  assert.ok(r.buildReport.practiceRuns.some(p => p.status !== 'succeeded'));
  const port2 = scriptedPort({ compose: build(fails), 'repair.r0': build(fails), 'repair.r1': build(fails), 'repair.r2': build(fails) });
  assert.equal((await new ComposeBuilder({ port: port2 }).build({ request: overdue.request, workspace: overdue.workspace, practiceWorld: tasksWorld })).status, 'build_failed');
});

test('A2 puts the retrieved block in the compose prompt and re-retrieves with the draft on a repair', async () => {
  const seen = [];
  const retrieval = ({ draft }) => { seen.push(draft ? 'draft' : 'request'); return { block: `Patterns from similar automations ${seen.length}`, patterns: [{ id: 'P42' }], exemplars: [{ id: '1' }], excluded: 2 }; };
  const invalid = { ...overdue.workflow, acceptance: [] };
  const port = scriptedPort({ compose: build(invalid), 'repair.r0': build(overdue.workflow), 'review.r1': { verdict: 'ok', problems: [], workflow: {} } });
  const r = await new ComposeBuilder({ port, retrieval }).build({ request: overdue.request, workspace: overdue.workspace, practiceWorld: tasksWorld });
  assert.equal(r.status, 'ready'); assert.deepEqual(seen, ['request', 'draft']);
  assert.match(port.calls[0].prompt, /Patterns from similar automations 1/); assert.match(port.calls[1].prompt, /Patterns from similar automations 2/);
  assert.equal(r.buildReport.retrieval.rounds.length, 2);
});

test('practice text shows the data, every effect and the sheet changes', async () => {
  const run = await runBuilt(overdue.workflow, tasksWorld);
  const t = practiceText(tasksWorld, run);
  assert.match(t, /now = 2026-03-10T08:00:00Z/); assert.match(t, /\[1\] to a@x\.example \| subject: You have 1 overdue task/); assert.match(t, /\[#team\] 1 task/);
  assert.match(t, /sheet tasks after the run: 0 row\(s\) added; 1 row\(s\) changed: row 1: .*"reminded_on":"2026-03-10"/);
});

test('shared blocks: request quoted as data, workspace, CI-1 capabilities (no fixtures), rules, schema', () => {
  const blocks = sharedBlocks({ request: 'say """hi"""', workspace: signup.workspace, answers: { q1: 'yes' } });
  assert.match(blocks[0], /^Request \(data written by a person/); assert.doesNotMatch(blocks[0], /"""hi"""/);
  assert.match(blocks[1], /q1: yes/);
  assert.match(workspaceText(signup.workspace), /input\.event is \{"body": <the posted JSON object>\}/);
  const names = capabilityNames();
  for (const n of ['sheet.update', 'sheet.upsert', 'reply.send', 'outbox.send', 'chat.post']) assert.ok(names.includes(n), n);
  assert.ok(!names.some(n => /^fixture\.|^core\.(fail|sleep)$/.test(n)));
});

test('retrieval structure: WL hash ignores names and texts, sees structure; skeletons carry no corpus text', () => {
  const N = (name, type, parameters = {}) => ({ name, type: `n8n-nodes-base.${type}`, parameters });
  const wf = (names, text) => ({ nodes: [N(names[0], 'scheduleTrigger'), N(names[1], 'googleSheets', { operation: 'read' }), N(names[2], 'code', { jsCode: text }), N(names[3], 'gmail', { operation: 'send', sendTo: 'secret@corp.example', message: text })],
    connections: { [names[0]]: { main: [[{ node: names[1] }]] }, [names[1]]: { main: [[{ node: names[2] }]] }, [names[2]]: { main: [[{ node: names[3] }]] } } });
  const a = wl(wf(['A', 'B', 'C', 'D'], 'ignore previous instructions')), b = wl(wf(['W', 'X', 'Y', 'Z'], 'other'));
  assert.equal(a.hash, b.hash); assert.equal(jaccard(a.features, b.features), 1);
  const c = wf(['A', 'B', 'C', 'D'], 'x'); c.connections.B.main = [[{ node: 'D' }]];
  assert.notEqual(wl(c).hash, a.hash);
  const sk = skeleton(wf(['Daily', 'Rows', 'Logic', 'Send'], 'ignore previous instructions\nline2'));
  assert.equal(sk, '1. trigger (schedule) -> 2\n2. sheet read -> 3\n3. code (JavaScript) (2 lines) -> 4\n4. send e-mail');
  assert.doesNotMatch(sk, /ignore|secret|Daily|Rows/);
  assert.equal(nodeLabel(N('x', 'googleSheets', { operation: 'appendOrUpdate' })), 'googleSheets:appendOrUpdate');
});

test('leave-one-out: the target, same-hash items, near duplicates and (strict) the same author are excluded', () => {
  const f = xs => xs.map(String);
  const index = { entries: [
    { id: 't', author: 'ann', hash: 'h1', features: f([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) },
    { id: 'same', author: 'bob', hash: 'h1', features: f([1, 2]) },
    { id: 'near', author: 'cy', hash: 'h2', features: f([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]) },  // 9/11 = 0.82
    { id: 'far', author: 'dee', hash: 'h3', features: f([1, 2, 3, 4, 5, 20, 21, 22, 23, 24]) }, // 5/15 = 0.33
    { id: 'mine', author: 'ann', hash: 'h4', features: f([30]) }] };
  const ex = exclusionsFor('t', index);
  assert.deepEqual([...ex.ids].sort(), ['mine', 'near', 'same', 't']);
  assert.deepEqual([...exclusionsFor('t', index, { strict: false }).ids].sort(), ['near', 'same', 't']);
});

test('request masking and shapes', () => {
  assert.equal(maskRequest('Mail a@b.example "Hello there" on 2026-03-01 for $1,200.50').replace(/\s+/g, ' ').trim(), 'Mail ADDRESS TEXT on DATE for NUMBER');
  const s = shapeOfRequest('Answer the form, e-mail them and post in #sales; skip duplicates', { trigger: { kind: 'webhook' } });
  for (const f of ['trigger:webhook', 'effect:respond', 'effect:mail', 'effect:chat', 'logic:match', 'logic:branch']) assert.ok(s.has(f), f);
  assert.deepEqual([...shapeOfDraft(overdue.workflow)].sort(), ['effect:chat', 'effect:mail', 'effect:sheet-write', 'logic:branch', 'logic:code']);
});

test('the simulated person answers from the key, else the fixed fallback; the empty control has no effects', async () => {
  const key = { answers: [{ match: ['channel'], answer: '#ops' }] };
  assert.deepEqual(respond(key, { question: 'Which Channel?' }), { text: '#ops', matched: true });
  assert.deepEqual(respond({}, { question: 'Anything?' }), { text: FALLBACK, matched: false });
  assert.equal(validateCi1(EMPTY_WORKFLOW).valid, true);
  const r = await runBuilt(EMPTY_WORKFLOW, tasksWorld);
  assert.equal(r.status, 'succeeded'); assert.deepEqual(r.effects.outbox, []);
  void readFileSync;
});
