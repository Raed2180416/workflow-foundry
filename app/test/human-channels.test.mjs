// The harness channels for a person's answer (review m7): MCP elicitation (list_waiting, answer_waiting) and the CLI (tasks, answer), both
// through app/core/human-tasks.mjs. $0, in-memory MCP transport, loopback only.
//   nice -n 15 node --test app/test/human-channels.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { serveAppMcp, elicitationForm } from '../mcp/server.mjs';
import { listHumanTasks, settleResumes } from '../core/human-tasks.mjs';
import { NAMED } from '../eval/run-graph/scenarios.mjs';
import { appWith, startFlow } from './run-graph-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
async function connect(app, elicit = null) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await serveAppMcp(app, { transport: serverSide });
  const client = new Client({ name: 'channels-test', version: '1' }, { capabilities: elicit ? { elicitation: { form: {} } } : {} });
  if (elicit) client.setRequestHandler(ElicitRequestSchema, elicit);
  await client.connect(clientSide);
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { ...JSON.parse(r.content[0].text), isError: !!r.isError }; };
  return { client, call };
}

test('MCP: list_waiting shows questions and paused actions without argument values; answer_waiting asks the person, bound to the question shown', async t => {
  const { app } = await appWith(t);
  const asked = await startFlow(app, NAMED['S3-question']().workflow), paused = await startFlow(app, NAMED['S2-approval']().workflow);
  const dialogs = [];
  const { call, client } = await connect(app, async request => {
    dialogs.push(request.params);
    return /refund/i.test(request.params.message) ? { action: 'accept', content: { approve: true, note: 'ok by me' } } : { action: 'accept', content: { decision: 'reject' } };
  });
  t.after(() => client.close());
  const w = await call('list_waiting');
  assert.equal(w.tasks.length, 2); assert.match(w.say, /2 thing\(s\) wait/);
  const q = w.tasks.find(x => x.kind === 'question'), a = w.tasks.find(x => x.kind === 'approval');
  assert.equal(q.answerableHere, true); assert.match(q.question, /Refund 120 EUR/);
  assert.deepEqual([...a.argumentNames].sort(), ['body', 'subject', 'to']);
  assert.ok(!JSON.stringify(w).includes('attacker@evil.example'), 'argument values go to the person\'s dialog, not to the model');
  const answered = await call('answer_waiting', { taskId: q.taskId });
  assert.equal(answered.status, 'answered'); assert.equal(answered.isError, false);
  assert.deepEqual(Object.keys(dialogs[0].requestedSchema.properties).sort(), ['approve', 'note']);
  await settleResumes(app);
  assert.equal(app.foundry.store.run(asked.id).status, 'succeeded');
  assert.equal(app.foundry.store.events(asked.id).filter(e => e.type === 'human.answered').length, 1);
  const decided = await call('answer_waiting', { taskId: a.taskId });
  assert.equal(decided.status, 'decided'); assert.equal(decided.approved, false);
  assert.match(dialogs[1].message, /attacker@evil\.example/, 'the person sees the padded payload');
  assert.ok(!/[‮​]/.test(dialogs[1].message), 'bidi and zero-width characters are made visible');
  assert.equal(app.foundry.store.run(paused.id).status, 'cancelled');
  assert.equal((await call('answer_waiting', { taskId: a.taskId })).isError, true, 'nothing is waiting any more');
});

test('MCP: without a dialog the model is told where the person answers, and nothing is recorded; a complex answer needs the dashboard form', async t => {
  const { app } = await appWith(t);
  const asked = await startFlow(app, NAMED['S3-question']().workflow);
  const { call, client } = await connect(app);
  t.after(() => client.close());
  const [q] = (await call('list_waiting')).tasks;
  const r = await call('answer_waiting', { taskId: q.taskId });
  assert.equal(r.status, 'awaiting_human'); assert.match(r.how, /cli\.mjs start/);
  assert.equal(app.foundry.store.events(asked.id).filter(e => e.type === 'human.answered').length, 0);
  assert.equal(elicitationForm({ type: 'array', items: { type: 'string' } }), null);
  assert.equal(elicitationForm({ type: 'object', properties: { rows: { type: 'array' } } }), null);
  assert.deepEqual(elicitationForm({ type: 'boolean' }).requestedSchema.properties.answer, { type: 'boolean', title: 'Your answer' });
  assert.deepEqual(elicitationForm({ enum: ['a', 'b'] }).requestedSchema.properties.answer.enum, ['a', 'b']);
});

test('CLI: tasks lists what waits (any terminal); answer refuses anything that is not a real terminal', async t => {
  const { app, dir } = await appWith(t);
  await startFlow(app, NAMED['S3-question']().workflow);
  const id = listHumanTasks(app).tasks[0].id;
  const cli = (...a) => spawnSync(process.execPath, [path.join(here, '..', 'cli.mjs'), ...a, '--workspace', dir], { encoding: 'utf8', timeout: 60000 });
  const list = cli('tasks');
  assert.equal(list.status, 0, list.stderr); assert.match(list.stdout, new RegExp(`^${id.slice(0, 16)}  question  “Approve the refund”`, 'm'));
  const answer = cli('answer', id.slice(0, 16));
  assert.equal(answer.status, 2); assert.match(answer.stderr, /real terminal/);
});
