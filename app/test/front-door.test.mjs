// The free-form front door (app/FRONT-DOOR.md), $0, no model: an agent-built typed workflow is checked by code, practised on its exact
// version, turned on only by a person, and run with per-action asks; everything it cannot do is refused by name.
// node --test app/test/front-door.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { FoundryApp } from '../core/service.mjs';
import { serveAppMcp } from '../mcp/server.mjs';
import { generatePractice, practiceCases, groundedIn, wordsOf, capabilityCatalog } from '../core/freeform.mjs';
import { constructionGuide, guideIndex } from '../core/guide.mjs';
import { listHumanTasks, decideApproval } from '../core/human-tasks.mjs';
import { Batches, listDigest } from '../onboarding/batch.mjs';
import { toolDefinitions } from '../mcp/server.mjs';
import { BUILDS, reconciliation, fanOut, approvalChain, escalation, needsSms, strangerTarget } from '../demo/workflows.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(here, '..', '..');
const clone = v => JSON.parse(JSON.stringify(v));
async function withApp(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'front-door-'));
  const app = new FoundryApp({ workspace: dir });
  try { await fn(app, dir); } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
}
const codes = r => (r.blockers ?? []).map(b => b.code);
const nothingMade = app => { const l = app.list(); return l.flows.length + l.proposals.length === 0; };

test('four requests no example could do: each agent-built workflow is proposed, explained in plain words and passes practice of its exact version', async () => withApp(async app => {
  for (const b of BUILDS) {
    const p = await app.propose({ request: b.request, workflow: b.workflow, practiceInput: b.practiceInput });
    assert.equal(p.status, 'proposed', `${b.name}: ${JSON.stringify(p.blockers ?? p.problem)}`);
    assert.equal(p.builder, 'the calling agent (free-form)');
    assert.ok(p.summary.steps.length >= 4 && p.willDo.length && p.outsideActions.length, b.name);
    assert.ok(p.outsideActions.every(a => a.source === 'your words' || a.source === 'your data'));
    const d = await app.dryRun({ proposalId: p.proposalId });
    assert.equal(d.passed, true, `${b.name}: ${d.headline} ${JSON.stringify(d.problem)}`);
    assert.equal(d.workflowHash, p.workflowHash);
    assert.ok(d.wouldDo.length >= 1 && d.wouldDo.every(w => /^[a-f0-9]{64}$/.test(w.digest)), 'every practice action carries the digest of its full content');
    assert.match(d.wouldDoDigest, /^[a-f0-9]{64}$/);
  }
  const chain = app.list().proposals.find(p => p.flowId === approvalChain.workflow.id);
  const d = await app.dryRun({ proposalId: chain.proposalId });
  assert.equal(d.cases.length, 2);
  assert.deepEqual(d.standInAnswers.map(s => [s.case, s.answer.approve]), [['both approve', true], ['both approve', true], ['the lead declines', false]], 'stand-in answers are reported, never hidden');
  assert.ok(d.wouldDo.some(w => w.case === 'the lead declines' && /declined the team lead/.test(w.preview)));
  // The timer: practice used a clock already past, so the escalation path ran and the e-mail is on the would-do list.
  const esc = app.list().proposals.find(p => p.flowId === escalation.workflow.id);
  const e = await app.dryRun({ proposalId: esc.proposalId });
  assert.deepEqual(e.wouldDo.map(w => [w.action, w.to]).sort(), [['post', '#oncall'], ['send', 'im@acme.example']]);
}));

test('the gates hold: no turn-on without a passing practice run of the SAME hash; a person decides; outside actions ask; the audit re-reads the outbox', async () => withApp(async app => {
  const p = await app.propose({ request: reconciliation.request, workflow: reconciliation.workflow, practiceInput: reconciliation.practiceInput });
  assert.equal(app.requestApproval({ proposalId: p.proposalId }).problem.code, 'NEEDS_DRY_RUN');
  // A practice case that fails (a duplicated bank row: the comparison counts it twice, the independent recount once) is no basis for a yes.
  const bad = await app.dryRun({ proposalId: p.proposalId, input: {}, sheets: { bank: [{ txn: 'X', amount: 1 }, { txn: 'X', amount: 1 }], ledger: [{ txn: 'X', amount: 1 }] } });
  assert.equal(bad.passed, false, bad.headline);
  assert.equal(app.requestApproval({ proposalId: p.proposalId }).problem.code, 'NEEDS_DRY_RUN');
  const good = await app.dryRun({ proposalId: p.proposalId });
  assert.equal(good.passed, true);
  // The model has no channel to decide with.
  const a = app.requestApproval({ proposalId: p.proposalId });
  assert.equal(a.status, 'awaiting_human'); assert.equal(a.practice.wouldDoDigest, good.wouldDoDigest); assert.equal(a.practice.wouldDo.length, 1);
  assert.throws(() => app.decideActivation(a.approvalId, true, { channel: 'mcp' }), e => e.code === 'APPROVAL_AUTHORITY');
  assert.equal((await app.run({ flowId: p.flowId, input: {} })).problem.code, 'NOT_APPROVED');
  assert.equal(app.decideActivation(a.approvalId, true, { channel: 'dashboard' }).status, 'approved');
  // The person's own data.
  mkdirSync(path.join(app.worldDir, 'sheets'), { recursive: true });
  for (const [name, rows] of Object.entries(reconciliation.liveSheets)) writeFileSync(path.join(app.worldDir, 'sheets', `${name}.json`), JSON.stringify(rows));
  const r = await app.run({ flowId: p.flowId, input: {} });
  assert.equal(r.status, 'awaiting_approval', 'the e-mail waits for the person');
  const task = listHumanTasks(app).tasks.find(t => t.kind === 'approval');
  assert.equal(task.facts.action, 'outbox.send');
  await assert.rejects(decideApproval(app, { runId: task.runId, approvalId: task.approvalId, approved: true, channel: 'agent' }), e => e.code === 'APPROVAL_AUTHORITY');
  const done = await decideApproval(app, { runId: task.runId, approvalId: task.approvalId, approved: true, channel: 'dashboard', waitMs: Infinity });
  assert.equal(done.run.status, 'succeeded');
  assert.ok(done.run.checks.every(c => c.passed === true), JSON.stringify(done.run.checks));
  // A changed version needs its own practice run: the old one is not reused (compare-and-swap on the head at apply).
  const v2 = clone(reconciliation.workflow); v2.version = 2; v2.nodes.find(n => n.id === 'send').args.subject = 'Bank vs ledger: this month';
  const p2 = await app.propose({ request: reconciliation.request, workflow: v2, practiceInput: reconciliation.practiceInput, flowId: p.flowId });
  assert.equal(p2.status, 'proposed'); assert.deepEqual(p2.basedOn.version, 1);
  assert.equal(app.requestApproval({ proposalId: p2.proposalId }).problem.code, 'NEEDS_DRY_RUN');
  const wrongVersion = await app.propose({ request: reconciliation.request, workflow: { ...v2, version: 7 }, flowId: p.flowId });
  assert.deepEqual(codes(wrongVersion), ['VERSION_CONFLICT']);
}));

test('honest refusals: each names its blocker, nothing is created, nothing is substituted or flattened', async () => withApp(async app => {
  const sms = await app.propose({ request: needsSms.request, workflow: needsSms.workflow, practiceInput: needsSms.practiceInput });
  assert.equal(sms.status, 'refused'); assert.deepEqual(codes(sms), ['MISSING_CAPABILITY']);
  assert.deepEqual(sms.blockers[0].capabilities, ['sms.send', 'sms.audit']); assert.match(sms.reply, /no capability for “sms\.send”/);
  const cfo = await app.propose({ request: strangerTarget.request, workflow: strangerTarget.workflow, practiceInput: strangerTarget.practiceInput });
  assert.deepEqual(codes(cfo), ['UNGROUNDED_TARGET']); assert.equal(cfo.blockers[0].value, 'cfo@acme.example');
  // The answer to a question grounds it: the person wrote it.
  const answered = await app.propose({ request: strangerTarget.request, answers: { copy: 'please also copy cfo@acme.example' }, workflow: strangerTarget.workflow, practiceInput: strangerTarget.practiceInput });
  assert.equal(answered.status, 'proposed');
  await app.withdraw?.({ proposalId: answered.proposalId, channel: 'dashboard' });
  const cases = [
    ['an address in code', w => { w.nodes.find(n => n.id === 'recount').source += '\n// cc: audit@elsewhere.example'; }, 'UNGROUNDED_TARGET'],
    ['a target from the run input', w => { w.nodes.find(n => n.id === 'send').args.to = { $ref: 'input.to' }; w.inputSchema = { type: 'object', additionalProperties: false, properties: { to: { type: 'string' } } }; }, 'TARGET_FROM_RUN_INPUT'],
    ['an address field in the input', w => { w.inputSchema = { type: 'object', additionalProperties: false, properties: { recipient: { type: 'string' } } }; }, 'TARGET_FROM_RUN_INPUT'],
    ['a model step', w => { w.nodes.splice(3, 0, { id: 'judge', kind: 'agent', needs: ['compare'], description: 'Judge the differences', instructions: 'Judge', returns: { type: 'object' }, model: { class: 'S' } }); }, 'MODEL_STEP_UNAVAILABLE'],
    ['a signal wait', w => { w.nodes.push({ id: 'ack', kind: 'wait', needs: ['audit'], description: 'Wait for an ack', signal: 'incident.ack', timeoutMs: 60000 }); }, 'SIGNAL_WAIT_UNSUPPORTED'],
    ['no independent check of the send', w => { w.nodes = w.nodes.filter(n => n.id !== 'audit'); w.acceptance = [{ op: 'eq', left: { $ref: 'nodes.recount.pass' }, right: true }]; }, 'EFFECT_UNCHECKED'],
    ['acceptance that only checks existence', w => { w.nodes.find(n => n.id === 'recount').gate = false; w.acceptance = [{ op: 'exists', value: { $ref: 'nodes.report.text' } }]; }, 'LINT_FAILED'],
    ['an example\'s reserved tags', w => { w.metadata = { tags: ['template:invoice-chase', 'slots:{}'] }; }, 'RESERVED_TAGS'],
    ['a node kind the schema does not have', w => { w.nodes[0].kind = 'teleport'; }, 'INVALID_WORKFLOW'],
    ['a channel the person never named', w => { w.nodes.find(n => n.id === 'send').tool = 'chat.post'; w.nodes.find(n => n.id === 'send').args = { channel: '#finance-leaks', text: { $ref: 'nodes.report.text' } }; }, 'UNGROUNDED_TARGET']
  ];
  for (const [what, change, code] of cases) {
    const w = clone(reconciliation.workflow); change(w);
    const r = await app.propose({ request: reconciliation.request, workflow: w, practiceInput: reconciliation.practiceInput });
    assert.equal(r.status, 'refused', `${what}: ${JSON.stringify(r).slice(0, 300)}`);
    assert.ok(codes(r).includes(code), `${what}: ${codes(r).join(', ')}`);
    assert.ok(r.blockers.every(b => b.what && b.next), `${what}: every blocker says what and what next`);
  }
  // Practice data: a sheet the workflow reads must have rows; a case must satisfy the input schema.
  assert.deepEqual(codes(await app.propose({ request: reconciliation.request, workflow: reconciliation.workflow })), ['PRACTICE_DATA_MISSING']);
  assert.deepEqual(codes(await app.propose({ request: fanOut.request, workflow: fanOut.workflow, practiceInput: [{ input: { when: 'x' }, sheets: fanOut.practiceInput[0].sheets }] })), ['PRACTICE_INPUT']);
  assert.ok(nothingMade(app), 'a refusal creates nothing');
}));

test('practice for ANY workflow: no cases -> a schema-valid input made by code and stand-in answers; a long timer stops practice honestly', async () => withApp(async app => {
  const ask = { schemaVersion: '1.0', id: 'ask-and-tell', version: 1, title: 'Ask and tell', goal: 'Ask the person a yes/no question and post the answer to #team.', domain: 'general',
    envelope: { assumptions: [], risks: [], successCriteria: ['Exactly one post went to #team'] },
    inputSchema: { type: 'object', additionalProperties: false, required: ['topic', 'now', 'count'], properties: { topic: { type: 'string', minLength: 3, maxLength: 40 }, now: { type: 'string', minLength: 10, maxLength: 40 }, count: { type: 'integer', minimum: 2, maximum: 9 } } },
    budget: { maxSteps: 50, maxConcurrency: 1, maxDurationMs: 600000, maxCost: 0 },
    nodes: [{ id: 'q', kind: 'human', needs: [], description: 'Ask the person', question: 'Go ahead?', answerSchema: { type: 'object', additionalProperties: false, required: ['go'], properties: { go: { type: 'boolean' } } } },
      { id: 'text', kind: 'task', needs: ['q'], description: 'Write the post', tool: 'core.template', args: { text: 'Topic {{t}} at {{n}}: go', variables: { t: { $ref: 'input.topic' }, n: { $ref: 'input.now' } } }, timeoutMs: 10000, retry: { maxAttempts: 2 } },
      { id: 'post', kind: 'task', needs: ['text'], description: 'Post to #team (asks you first)', tool: 'chat.post', args: { channel: '#team', text: { $ref: 'nodes.text.text' } }, timeoutMs: 10000, retry: { maxAttempts: 1 } },
      { id: 'audit', kind: 'verify', needs: ['post'], description: 'Re-read #team', method: 'capability', tool: 'chat.audit', args: { channel: '#team', posts: 1 }, subject: { $ref: 'nodes.post' }, independence: 'execution', gate: true, timeoutMs: 10000 }],
    acceptance: [{ op: 'eq', left: { $ref: 'nodes.audit.pass' }, right: true }] };
  const p = await app.propose({ request: 'ask me, then post to the #team channel', workflow: ask });
  assert.equal(p.status, 'proposed', JSON.stringify(p.blockers)); assert.equal(p.practice.generatedInput, true);
  const d = await app.dryRun({ proposalId: p.proposalId });
  assert.equal(d.passed, true, d.headline);
  assert.equal(d.cases[0].inputGenerated, true);
  assert.deepEqual(d.standInAnswers.map(s => [s.answer, s.from]), [[{ go: true }, 'made by Foundry from the answer schema']]);
  assert.match(d.wouldDo[0].preview, /^Topic practice at 2026-01-05T09:00:00Z: go$/);
  // A 50-minute timer: practice does not wait that long, and says so.
  const timed = clone(ask); timed.id = 'ask-wait-tell'; timed.nodes.splice(1, 0, { id: 'pause', kind: 'wait', needs: ['q'], description: 'Wait 50 minutes', delayMs: 3000000 }); timed.nodes[2].needs = ['pause'];
  const p2 = await app.propose({ request: 'ask me, wait, then post to the #team channel', workflow: timed });
  const d2 = await app.dryRun({ proposalId: p2.proposalId });
  assert.equal(d2.passed, false); assert.equal(d2.problem.code, 'PRACTICE_TIMER');
  assert.equal(app.requestApproval({ proposalId: p2.proposalId }).problem.code, 'NEEDS_DRY_RUN');
}));

test('the generator and the grounding rules', () => {
  assert.deepEqual(generatePractice({ type: 'object', required: ['a', 'b', 'runAt', 'list'], properties: { a: { enum: ['x', 'y'] }, b: { type: 'integer', minimum: 3 }, runAt: { type: 'string' }, list: { type: 'array', minItems: 2, items: { type: 'boolean' } }, skip: { type: 'string' } } }),
    { a: 'x', b: 3, runAt: '2026-01-05T09:00:00Z', list: [true, true] });
  assert.equal(generatePractice({ type: 'string', minLength: 12 }).length >= 12, true);
  assert.throws(() => practiceCases([{ input: {}, extra: 1 }], { type: 'object' }), e => e.code === 'PRACTICE_INPUT');
  const words = wordsOf('post it to the ops channel and mail Boss@Example.com', { log: 'use the approvals log sheet' });
  assert.equal(groundedIn(words, 'chat channel', '#ops'), true); assert.equal(groundedIn(words, 'chat channel', '#opsx'), false);
  assert.equal(groundedIn(words, 'e-mail', 'boss@example.com'), true); assert.equal(groundedIn(words, 'e-mail', 'boss@example.co'), true, 'a prefix of a written address is in the words');
  assert.equal(groundedIn(words, 'sheet', 'approvals-log'), true); assert.equal(groundedIn(words, 'sheet', 'approvals'), true); assert.equal(groundedIn(words, 'sheet', 'payroll'), false);
});

test('construction_guide: the skill core, the rules and the capabilities always; a reference or worked example by name; the seven examples are worked examples that pass the front door', async () => withApp(async app => {
  const g = constructionGuide(app, {});
  assert.match(g.skill, /# Construct a workflow/); assert.ok(g.rules.length >= 8);
  assert.ok(g.capabilities.some(c => c.name === 'outbox.send' && c.asksThePersonFirst && c.outsideEffect.target === 'to'));
  assert.ok(!g.capabilities.some(c => /^fixture\.|^core\.(fail|sleep)$/.test(c.name)), 'diagnostic capabilities are not offered');
  assert.deepEqual(g.capabilities.map(c => c.name), capabilityCatalog(app.registry).map(c => c.name));
  assert.ok(g.references.some(r => r.name === 'references/patterns.md'));
  assert.equal(g.exemplars.filter(e => e.name.startsWith('exemplars/app/')).length, 7);
  assert.match(constructionGuide(app, { name: 'references/verify-stop.md' }).text, /\S/);
  for (const bad of ['../SKILL.md', 'references/../../package.json', 'exemplars/app/../../SKILL.md', '/etc/passwd']) assert.throws(() => constructionGuide(app, { name: bad }), e => e.code === 'GUIDE_NAME', bad);
  // The worked examples are current with the examples they come from...
  const check = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'skillpack', 'gen-exemplars.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  // ...and each one, with every target in the person's words, passes the front door's checks and practice.
  for (const e of guideIndex().exemplars.filter(x => x.name.startsWith('exemplars/app/'))) {
    const x = constructionGuide(app, { name: e.name });
    const targets = [...JSON.stringify(x.workflow).matchAll(/"(?:to|channel|sheet)":"([^"]+)"/g)].map(m => m[1]);
    const mails = JSON.stringify(x.workflow).match(/[^@\s"'<>()]+@[^@\s"'<>()]+\.[a-z]{2,}/gi) ?? [];
    const p = await app.propose({ request: `Please use: ${[...new Set([...targets, ...mails])].join(', ')}`, workflow: x.workflow, practiceInput: x.practiceInput });
    assert.equal(p.status, 'proposed', `${e.name}: ${JSON.stringify(p.blockers)}`);
    const d = await app.dryRun({ proposalId: p.proposalId });
    assert.equal(d.passed, true, `${e.name}: ${d.headline}`);
  }
}));

async function connect(app, { elicit = null, dialog = true } = {}) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await serveAppMcp(app, { transport: serverSide, dialog });
  const client = new Client({ name: 'front-door-test', version: '1' }, { capabilities: elicit ? { elicitation: { form: {} } } : {} });
  if (elicit) client.setRequestHandler(ElicitRequestSchema, elicit);
  await client.connect(clientSide);
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { ...JSON.parse(r.content[0].text), isError: !!r.isError }; };
  return { client, call };
}

test('MCP: construction_guide replaced list_templates; propose_flow takes a workflow; the turn-on dialog shows the practice list; no card or template words in what the person reads', async () => withApp(async app => {
  let dialogText = null;
  const { client, call } = await connect(app, { elicit: async req => { dialogText = req.params.message; return { action: 'accept', content: { decision: 'approve' } }; } });
  const { tools } = await client.listTools();
  assert.equal(tools[0].name, 'construction_guide'); assert.ok(!tools.some(t => t.name === 'list_templates'));
  assert.deepEqual(Object.keys(tools.find(t => t.name === 'propose_flow').inputSchema.properties).sort(), ['answers', 'flowId', 'practiceInput', 'request', 'workflow']);
  const guide = await call('construction_guide');
  assert.equal(guide.ok, true); assert.ok(guide.capabilities.length > 10);
  const ex = await call('construction_guide', { name: 'exemplars/app/oncall-digest.json' });
  assert.ok(ex.workflow.nodes.length && ex.practiceInput.length);
  // A card id is no longer an argument: the schema refuses it before anything runs.
  const old = await call('propose_flow', { request: 'chase my invoices', template: 'invoice-chase' });
  assert.equal(old.isError, true);
  const refused = await call('propose_flow', { request: needsSms.request, workflow: needsSms.workflow, practiceInput: needsSms.practiceInput });
  assert.equal(refused.status, 'refused'); assert.match(refused.say, /sms\.send/);
  const p = await call('propose_flow', { request: fanOut.request, workflow: fanOut.workflow, practiceInput: fanOut.practiceInput });
  assert.equal(p.status, 'proposed', JSON.stringify(p.blockers));
  const d = await call('dry_run', { proposalId: p.proposalId });
  assert.equal(d.passed, true); assert.match(d.say, /Practice run passed/);
  const on = await call('ask_person_to_turn_on', { proposalId: p.proposalId });
  assert.equal(on.status, 'approved'); assert.match(on.say, /Each send or post still asks them first/);
  assert.match(dialogText, /On practice data it would have made:\n- post to #procurement/);
  const words = await call('propose_flow', { request: 'translate my emails into French with AI' });
  assert.equal(words.status, 'unsupported');
  for (const r of [guide, refused, p, d, on, words]) assert.doesNotMatch(r.say, /\b(template|card)s?\b/i, r.say);
  assert.doesNotMatch(dialogText, /\b(template|card)s?\b/i);
  await client.close();
}));

test('with the site: a free-form automation\'s run starts with the exact list (a practice-registry run on the person\'s live data, bound by digest); one that asks or waits goes action by action', async () => withApp(async app => {
  const batches = new Batches(app);
  const tools = Object.fromEntries(toolDefinitions(app, { batches, dashboardUrl: () => 'the Foundry page' }).map(t => [t.name, t]));
  const on = async b => {
    const p = await app.propose({ request: b.request, workflow: b.workflow, practiceInput: b.practiceInput });
    assert.equal((await app.dryRun({ proposalId: p.proposalId })).passed, true);
    assert.equal(app.decideActivation(app.requestApproval({ proposalId: p.proposalId }).approvalId, true, { channel: 'dashboard' }).status, 'approved');
    return p;
  };
  const p = await on(reconciliation);
  assert.equal(app.isFreeform(p.workflowHash), true);
  const missing = await tools.run_flow.execute({ flowId: p.flowId, input: {} });
  assert.equal(missing.status, 'needs_data'); assert.deepEqual(missing.needsData.sort(), ['bank', 'ledger']);
  mkdirSync(path.join(app.worldDir, 'sheets'), { recursive: true });
  for (const [name, rows] of Object.entries(reconciliation.liveSheets)) writeFileSync(path.join(app.worldDir, 'sheets', `${name}.json`), JSON.stringify(rows));
  const r = await tools.run_flow.execute({ flowId: p.flowId, input: {} });
  assert.equal(r.status, 'awaiting_human'); assert.equal(r.count, 1); assert.ok(r.batchId);
  const b = batches.get(r.batchId);
  assert.equal(b.freeform, true); assert.equal(b.template, null); assert.equal(b.items[0].to, 'finance@acme.example'); assert.match(b.items[0].body, /B-101: bank 85, ledger 58/);
  await assert.rejects(batches.approve(r.batchId, { listDigest: '0'.repeat(64) }), e => e.code === 'BATCH_CHANGED');
  const done = await batches.approve(r.batchId, { listDigest: listDigest(b) });
  assert.equal(done.status, 'succeeded'); assert.equal(done.made.length, 1); assert.equal(done.stoppedAt, null);
  // The data changed after the list was made: the real run wants an e-mail that was not on the list, so it stops and asks.
  const r2 = await tools.run_flow.execute({ flowId: p.flowId, input: {} });
  writeFileSync(path.join(app.worldDir, 'sheets', 'ledger.json'), JSON.stringify([...reconciliation.liveSheets.ledger, { txn: 'B-200', amount: 9 }]));
  const stopped = await batches.approve(r2.batchId, { listDigest: listDigest(batches.get(r2.batchId)) });
  assert.ok(stopped.stoppedAt, 'not on the list the person approved'); assert.equal(stopped.made.length, 0);
  // An automation that asks the person while it runs cannot have its list made in advance: its actions ask one by one.
  const chain = await on(approvalChain);
  writeFileSync(path.join(app.worldDir, 'sheets', 'requests.json'), JSON.stringify([{ id: 'P-1', item: 'Servers', amount: 9000, status: 'submitted' }]));
  const c = await tools.run_flow.execute({ flowId: chain.flowId, input: {} });
  assert.equal(c.batchId, undefined); assert.equal(c.status, 'awaiting_human', 'a question waits for the person');
  await assert.rejects(batches.preview(chain.flowId), e => e.code === 'BATCH_INTERACTIVE');
}));
