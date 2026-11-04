// One list for everything a run waits on a person for, and the answer path for human-node questions (app/core/human-tasks.mjs). $0.
//   nice -n 15 node --test app/test/human-tasks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../../src/data.mjs';
import { FoundryError } from '../../src/data.mjs';
import { listHumanTasks, answerQuestion, decideApproval, settleResumes, cancelResumes, resumeRecords } from '../core/human-tasks.mjs';
import { createDashboard } from '../dashboard/server.mjs';
import { NAMED, HOSTILE_BODY } from '../eval/run-graph/scenarios.mjs';
import { appWith, startFlow } from './run-graph-helpers.mjs';

const ask = (id = 'ask', needs = []) => ({ id, kind: 'human', needs, description: 'A person says go', question: 'Go?', answerSchema: { type: 'boolean' } });
const flow = (id, nodes) => ({ ...NAMED['S14-answer-while-running']().workflow, id, nodes, acceptance: [{ op: 'exists', value: { $ref: 'nodes.ask.answer' } }] });
// A run that a live process (this one) executes: start it, then wait until its question is listed.
async function busyRun(app, workflow) {
  app.foundry.store.saveWorkflow(workflow);
  const run = app.foundry.createRun(workflow.id, {}), p = app.foundry.startRun(run.id);
  let q;
  for (let i = 0; i < 400 && !(q = listHumanTasks(app, { runId: run.id }).tasks[0]); i++) await new Promise(r => setTimeout(r, 5));
  return { run, p, q };
}
const acquired = (app, id) => app.foundry.store.events(id).filter(e => e.type === 'runner.acquired').length;

test('questions at the top level and inside map items are listed with a form; the app inbox before this saw none of them', async t => {
  const { app } = await appWith(t);
  const s3 = await startFlow(app, NAMED['S3-question']().workflow), s9 = await startFlow(app, NAMED['S9-question-in-map']().workflow, NAMED['S9-question-in-map']().input);
  assert.equal(s3.status, 'awaiting_human'); assert.equal(s9.status, 'awaiting_human');
  const list = listHumanTasks(app);
  assert.equal(list.questions, 3);
  assert.deepEqual(list.tasks.map(q => q.nodeKey).sort(), ['root/confirm:0/ask', 'root/confirm:1/ask', 'root/decide']);
  const q = list.tasks.find(x => x.nodeKey === 'root/decide');
  assert.equal(q.form.ok, true); assert.deepEqual(q.form.spec.fields.map(f => f.name).sort(), ['answer/approve', 'answer/note']);
  assert.match(q.requestHash, /^[0-9a-f]{64}$/); assert.equal(q.facts.question.trust, 'untrusted');
  assert.equal(app.inbox().count, 0, 'baseline: FoundryApp.inbox lists approvals only');
});

test('answering: only a person, only the question shown, only a valid answer; then the run continues to the end', async t => {
  const { app } = await appWith(t);
  const run = await startFlow(app, NAMED['S3-question']().workflow);
  const q = listHumanTasks(app).tasks[0], good = { approve: true, note: 'fine' };
  await assert.rejects(answerQuestion(app, { runId: run.id, nodeKey: q.nodeKey, answer: good, requestHash: q.requestHash, channel: 'model' }), { code: 'APPROVAL_AUTHORITY' });
  await assert.rejects(answerQuestion(app, { runId: run.id, nodeKey: q.nodeKey, answer: good, requestHash: 'f'.repeat(64), channel: 'dashboard' }), { code: 'STALE_TASK' });
  await assert.rejects(answerQuestion(app, { runId: run.id, nodeKey: q.nodeKey, answer: { approve: 'yes' }, requestHash: q.requestHash, channel: 'dashboard' }), { code: 'ANSWER_INVALID' });
  await assert.rejects(answerQuestion(app, { runId: run.id, nodeKey: 'root/fetch', answer: good, requestHash: q.requestHash, channel: 'dashboard' }), { code: 'NO_QUESTION' });
  const r = await answerQuestion(app, { runId: run.id, nodeKey: q.nodeKey, answer: good, requestHash: q.requestHash, channel: 'dashboard' });
  assert.ok(['ran', 'running'].includes(r.continued.outcome), r.continued.outcome);
  await settleResumes(app);
  assert.equal(app.foundry.store.run(run.id).status, 'succeeded'); assert.deepEqual(resumeRecords(app, run.id), [], 'nothing went wrong, so nothing is recorded');
  const answered = app.foundry.store.events(run.id).filter(e => e.type === 'human.answered');
  assert.equal(answered.length, 1); assert.equal(answered[0].answerHash, digest(good));
  await assert.rejects(answerQuestion(app, { runId: run.id, nodeKey: q.nodeKey, answer: good, requestHash: q.requestHash, channel: 'dashboard' }), { code: 'NO_QUESTION' }, 'answered once');
  assert.equal(listHumanTasks(app).count, 0);
});

test('an answer given while another branch still runs is taken: the run finishes on its own, and the waiting resume settles', async t => {
  const { app } = await appWith(t);
  const sc = NAMED['S14-answer-while-running']();
  app.foundry.store.saveWorkflow(sc.workflow);
  const run = app.foundry.createRun(sc.workflow.id, {}), p = app.foundry.startRun(run.id);
  let q;
  for (let i = 0; i < 400 && !(q = listHumanTasks(app, { runId: run.id }).tasks[0]); i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(q, 'the question is listed while the run is still busy'); assert.equal(q.runBusy, true);
  const r = await answerQuestion(app, { runId: run.id, nodeKey: q.nodeKey, answer: true, requestHash: q.requestHash, channel: 'dashboard', waitMs: 0 });
  assert.equal(r.continued.outcome, 'waiting');
  await p.catch(() => {}); await settleResumes(app);
  assert.equal(app.foundry.store.run(run.id).status, 'succeeded');
  assert.equal(acquired(app, run.id), 1, 'never a second execution');
});

test('an approval card leads with engine facts bound to the chain; hostile text in the arguments is fenced, not hidden', async t => {
  const { app } = await appWith(t);
  const run = await startFlow(app, NAMED['S2-approval']().workflow);
  assert.equal(run.status, 'awaiting_approval');
  const [a] = listHumanTasks(app).tasks;
  assert.equal(a.kind, 'approval'); assert.equal(a.facts.action, 'fx.send'); assert.equal(a.facts.risk, 'high');
  assert.match(a.facts.effect, /not safe to repeat/);
  assert.deepEqual([...a.facts.argumentNames].sort(), ['body', 'subject', 'to']);
  assert.equal(a.facts.argsHashMatchesRecord, true); assert.equal(a.facts.argsHash, digest(app.foundry.store.run(run.id).approvals[a.approvalId].args));
  const body = a.arguments.find(x => x.name === 'body').value;
  assert.equal(body.trust, 'untrusted'); assert.ok(body.invisibleReplaced >= 2); assert.ok(body.blankLinesCollapsed > 300);
  assert.match(body.text, /attacker@evil\.example/, 'the padded payload is in view');
  assert.equal(body.chars, HOSTILE_BODY.length);
  assert.equal(a.arguments.find(x => x.name === 'to').value.text, 'boss@example.com');
  // B0 (FoundryApp.inbox) passes the first 600 characters raw: the payload sits 400 lines below the first one, and the bidi override and
  // zero-width space are passed through unchanged.
  const b0 = app.inbox().actions[0];
  assert.equal(b0.preview.split('\n').findIndex(line => line.includes('attacker')), 400);
  assert.ok(b0.preview.includes('‮') || b0.preview.length === 600);
});

test('deciding: only a person; yes resumes and the action runs; a second decision is refused; no stops the run', async t => {
  const { app } = await appWith(t);
  const run = await startFlow(app, NAMED['S2-approval']().workflow);
  const [a] = listHumanTasks(app).tasks;
  await assert.rejects(decideApproval(app, { runId: run.id, approvalId: a.approvalId, approved: true, channel: 'agent' }), { code: 'APPROVAL_AUTHORITY' });
  await assert.rejects(decideApproval(app, { runId: run.id, approvalId: a.approvalId, approved: 'yes', channel: 'dashboard' }), { code: 'APPROVAL_AUTHORITY' });
  await decideApproval(app, { runId: run.id, approvalId: a.approvalId, approved: true, channel: 'dashboard' });
  await settleResumes(app);
  assert.equal(app.foundry.store.run(run.id).status, 'succeeded');
  const decided = app.foundry.store.events(run.id).filter(e => e.type === 'approval.decided');
  assert.equal(decided.length, 1); assert.equal(decided[0].approved, true); assert.equal(decided[0].approvalId, a.approvalId);
  await assert.rejects(decideApproval(app, { runId: run.id, approvalId: a.approvalId, approved: true, channel: 'dashboard' }), { code: 'APPROVAL_CONFLICT' });
  const run2 = await startFlow(app, { ...NAMED['S2-approval']().workflow, id: 'S2Send2' });
  const [b] = listHumanTasks(app).tasks;
  const no = await decideApproval(app, { runId: run2.id, approvalId: b.approvalId, approved: false, channel: 'cli' });
  assert.equal(no.run.status, 'cancelled'); assert.equal(no.continued.outcome, 'stopped'); assert.equal(listHumanTasks(app).count, 0);
});

test('a run waiting for a person behind more than 100 newer runs is still listed (the old inbox read the 100 most recent)', async t => {
  const { app } = await appWith(t);
  const old = await startFlow(app, NAMED['S2-approval']().workflow);
  const quick = { ...NAMED['S8-acceptance']().workflow, id: 'Quick', acceptance: [{ op: 'exists', value: { $ref: 'nodes.count.rows' } }] };
  app.foundry.store.saveWorkflow(quick);
  for (let i = 0; i < 101; i++) { const r = app.foundry.createRun('Quick', {}); await app.foundry.startRun(r.id).catch(() => {}); }
  assert.equal(listHumanTasks(app).tasks.some(x => x.runId === old.id), true);
  assert.equal(app.inbox().actions.some(x => x.runId === old.id), false, 'baseline misses it');
});

test('the same question at the same step of another run: an answer bound to the one shown is refused for the other (STALE_TASK)', async t => {
  const { app } = await appWith(t);
  const a = await startFlow(app, NAMED['S3-question']().workflow), b = await startFlow(app, NAMED['S3-question']().workflow);
  const [qa, qb] = [a, b].map(r => listHumanTasks(app, { runId: r.id }).tasks[0]);
  assert.equal(qa.nodeKey, qb.nodeKey); assert.deepEqual(qa.facts.question, qb.facts.question); assert.notEqual(qa.requestHash, qb.requestHash);
  await assert.rejects(answerQuestion(app, { runId: b.id, nodeKey: qb.nodeKey, answer: { approve: true, note: 'x' }, requestHash: qa.requestHash, channel: 'dashboard' }), { code: 'STALE_TASK' });
  assert.equal(app.foundry.store.events(b.id).filter(e => e.type === 'human.answered').length, 0, 'nothing was recorded');
});

test('an action of unknown outcome holds the run: an answer that lands while it runs is not followed by a second execution (review M3)', async t => {
  const { app } = await appWith(t);
  // A question, and on another branch a slow lookup followed by a charge whose outcome is unknown (the gateway reset after the write).
  const { run, p, q } = await busyRun(app, flow('UncertainRace', [ask(), { ...NAMED['S11-uncertain']().workflow.nodes[1], needs: ['slow'] }, { id: 'slow', kind: 'task', needs: [], description: 'A slow lookup', tool: 'fx.slow', args: {}, timeoutMs: 20000, retry: { maxAttempts: 1 } }]));
  assert.ok(q && q.runBusy);
  const r = await answerQuestion(app, { runId: run.id, nodeKey: q.nodeKey, answer: true, requestHash: q.requestHash, channel: 'dashboard', waitMs: 0 });
  assert.equal(r.continued.outcome, 'waiting');
  await p.catch(() => {}); await settleResumes(app);
  assert.equal(app.foundry.store.run(run.id).status, 'uncertain');
  assert.equal(acquired(app, run.id), 1, 'the resumer did not take the uncertain run');
  const [held] = resumeRecords(app, run.id);
  assert.equal(held.outcome, 'held'); assert.equal(held.code, 'EFFECT_UNCERTAIN');
  const list = listHumanTasks(app);
  assert.equal(list.count, 0, 'a stopped run lists no question'); assert.equal(list.notContinued.length, 1); assert.match(list.notContinued[0].next, /by hand/);
});

test('a question in a run that already holds an uncertain action is not answered from here: reconcile first (RUN_UNCERTAIN)', async t => {
  const { app } = await appWith(t);
  const run = await startFlow(app, flow('UncertainAsk', [ask(), { ...NAMED['S11-uncertain']().workflow.nodes[1], needs: [] }]));
  assert.equal(run.status, 'uncertain');
  const requested = app.foundry.store.events(run.id).find(e => e.type === 'human.requested');
  assert.ok(requested, 'the question was asked');
  await assert.rejects(answerQuestion(app, { runId: run.id, nodeKey: 'root/ask', answer: true, requestHash: 'x', channel: 'dashboard' }), { code: 'RUN_UNCERTAIN' });
});

test('an engine refusal to resume is reported with its code, recorded, and listed; never "resumed" (review M3)', async t => {
  const { app } = await appWith(t);
  const run = await startFlow(app, NAMED['S3-question']().workflow), q = listHumanTasks(app).tasks[0];
  app.foundry.startRun = async () => { throw new FoundryError('ENGINE_DRIFT', 'injected: the engine changed since the run was created'); };
  const r = await answerQuestion(app, { runId: run.id, nodeKey: q.nodeKey, answer: { approve: true, note: 'ok' }, requestHash: q.requestHash, channel: 'dashboard', waitMs: 2000 });
  assert.equal(r.continued.outcome, 'refused'); assert.equal(r.continued.code, 'ENGINE_DRIFT'); assert.match(r.continued.words, /refused/);
  const list = listHumanTasks(app);
  assert.equal(list.notContinued.length, 1); assert.equal(list.notContinued[0].code, 'ENGINE_DRIFT'); assert.equal(list.notContinued[0].status, 'ready');
});

test('closing the dashboard stops resumes still waiting for a busy run, and records it; a give-up is recorded too (review M3)', async t => {
  const { app } = await appWith(t);
  const one = await busyRun(app, NAMED['S14-answer-while-running']().workflow);
  await answerQuestion(app, { runId: one.run.id, nodeKey: one.q.nodeKey, answer: true, requestHash: one.q.requestHash, channel: 'dashboard', waitMs: 0 });
  const dash = createDashboard(app);
  await dash.listen(0); await dash.close();
  await settleResumes(app);
  assert.deepEqual(resumeRecords(app, one.run.id).map(x => x.outcome), ['cancelled']);
  await one.p.catch(() => {});
  assert.equal(app.foundry.store.run(one.run.id).status, 'succeeded', 'the live process took the answer itself');
  assert.equal(listHumanTasks(app).notContinued.length, 0, 'a finished run is not listed');
  const two = await busyRun(app, { ...NAMED['S14-answer-while-running']().workflow, id: 'S14Again' });
  const r = await answerQuestion(app, { runId: two.run.id, nodeKey: two.q.nodeKey, answer: true, requestHash: two.q.requestHash, channel: 'dashboard', waitMs: 500, resume: { pollMs: 5, maxMs: 20 } });
  assert.equal(r.continued.outcome, 'gave-up');
  assert.deepEqual(resumeRecords(app, two.run.id).map(x => x.outcome), ['gave-up']);
  await two.p.catch(() => {}); await cancelResumes(app);
  assert.equal(acquired(app, two.run.id), 1);
});
