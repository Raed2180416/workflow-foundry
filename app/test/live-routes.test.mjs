// The dashboard's read-only run data and human-task routes (app/dashboard/live.mjs) over a real workspace, loopback only, $0.
//   nice -n 15 node --test app/test/live-routes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createDashboard } from '../dashboard/server.mjs';
import { liveRoutes } from '../dashboard/live.mjs';
import { GRAPH_SCHEMA, NODE_SCHEMA, PRESENTATION } from '../core/run-graph.mjs';
import { CONVERSATION_SCHEMA } from '../core/node-conversation.mjs';
import { settleResumes } from '../core/human-tasks.mjs';
import { processStartStamp } from '../../src/runtime.mjs';
import { NAMED } from '../eval/run-graph/scenarios.mjs';
import { appWith, startFlow } from './run-graph-helpers.mjs';

async function serve(t, app) {
  const dash = createDashboard(app), { port } = await dash.listen(0);
  t.after(() => dash.close());
  const base = `http://127.0.0.1:${port}`, headers = { 'x-foundry-token': dash.token };
  const get = async (p, h = headers) => { const r = await fetch(base + p, { headers: h }); return { status: r.status, body: await r.json() }; };
  const post = async (p, body, extra = {}) => { const r = await fetch(base + p, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  return { dash, base, headers, get, post };
}
// A minimal SSE reader over fetch (EventSource cannot send a header): yields {event, id, data, bytes}.
async function* sse(url, headers, signal) {
  const res = await fetch(url, { headers, signal });
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const decoder = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const msg = { event: 'message', id: null, data: '', bytes: block.length + 2 };
      for (const line of block.split('\n')) { if (line.startsWith('event: ')) msg.event = line.slice(7); else if (line.startsWith('id: ')) msg.id = Number(line.slice(4)); else if (line.startsWith('data: ')) msg.data += line.slice(6); }
      if (msg.data) { msg.data = JSON.parse(msg.data); yield msg; }
    }
  }
}

test('the token is required in a header; a token in the URL is never accepted', async t => {
  const { app } = await appWith(t);
  const run = await startFlow(app, NAMED['S3-question']().workflow);
  const { get, dash } = await serve(t, app);
  assert.equal((await get(`/api/runs/${run.id}/graph`, {})).status, 401);
  assert.equal((await get(`/api/runs/${run.id}/graph?t=${dash.token}`, {})).status, 401);
  const ok = await get(`/api/runs/${run.id}/graph`);
  assert.equal(ok.status, 200); assert.equal(ok.body.schema, GRAPH_SCHEMA);
  assert.equal(ok.body.run.state.user, 'needs_you'); assert.equal(ok.body.waiting[0].nodeKey, 'root/decide');
  assert.equal((await get('/api/runs/no-such-run/graph')).status, 404);
});

test('graph, node, history and tasks answer the persona questions in one request each', async t => {
  const { app } = await appWith(t, { script: { 'claude-haiku-5-5': async () => ({ value: { label: 'unsure', confidence: 0.2 }, usage: { inputTokens: 600, outputTokens: 80 }, costUsd: 0.0001 }) } });
  const failed = await startFlow(app, NAMED['S1b-check-named']().workflow, { topic: 'essay' });
  const waiting = await startFlow(app, NAMED['S2-approval']().workflow);
  const { get } = await serve(t, app);
  // T1: why did the run fail
  const g = (await get(`/api/runs/${failed.id}/graph`)).body;
  assert.equal(g.summary.failing.label, 'Grade'); assert.match(g.summary.failing.check.text, /confidence/);
  // T3: what did the step cost (the journal is read with the run)
  assert.equal(g.graph.cards.find(c => c.id === 'grade').cost.usd, 0.0001); assert.equal(g.run.cost.source, 'journal');
  // the node drawer and its transcript
  const n = (await get(`/api/runs/${failed.id}/node?key=root/grade`)).body;
  assert.equal(n.schema, NODE_SCHEMA); assert.equal(n.checks[0].status, 'failed');
  const call = (await get(`/api/runs/${failed.id}/calls/${n.calls[0].journalId}`)).body;
  assert.equal(call.trust, 'untrusted'); assert.equal(call.promptVerified, true); assert.match(call.prompt, /Grade the essay/);
  assert.equal((await get(`/api/runs/${failed.id}/node?key=../../etc`)).status, 400);
  // T5: which recent run failed and why, from the list
  const h = (await get('/api/history')).body.runs;
  const row = h.find(r => r.runId === failed.id);
  assert.match(row.oneLine, /Problem at “Grade”/); assert.equal(row.failingStep, 'Grade');
  // T6 and T2: what waits (one list: questions, approvals, versions to turn on)
  const tasks = (await get('/api/tasks')).body;
  assert.equal(tasks.total, 1); assert.equal(tasks.tasks[0].runId, waiting.id); assert.equal(tasks.tasks[0].kind, 'approval');
});

test('POST routes: JSON only, required fields, a person\'s answer resumes the run; a decision on a paused action', async t => {
  const { app } = await appWith(t);
  const run = await startFlow(app, NAMED['S3-question']().workflow), sent = await startFlow(app, NAMED['S2-approval']().workflow);
  const { get, post, base, headers } = await serve(t, app);
  const q = (await get('/api/tasks')).body.tasks.find(x => x.kind === 'question');
  const raw = await fetch(`${base}/api/tasks/answer`, { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(raw.status, 415);
  assert.equal((await post('/api/tasks/answer', { runId: run.id })).status, 400);
  const bad = await post('/api/tasks/answer', { runId: run.id, nodeKey: q.nodeKey, requestHash: q.requestHash, answer: { approve: 1 } });
  assert.equal(bad.status, 409); assert.equal(bad.body.error.code, 'ANSWER_INVALID');
  const ok = await post('/api/tasks/answer', { runId: run.id, nodeKey: q.nodeKey, requestHash: q.requestHash, answer: { approve: false, note: 'too much' } });
  assert.equal(ok.status, 200); assert.equal(ok.body.channel, 'dashboard'); assert.ok(['ran', 'running'].includes(ok.body.continued.outcome));
  const a = (await get('/api/tasks')).body.tasks.find(x => x.kind === 'approval');
  const d = await post('/api/tasks/decide', { runId: sent.id, approvalId: a.approvalId, decision: 'approve' });
  assert.equal(d.status, 200);
  // The POST returns within about a second whatever the run does next; the run itself goes on (here it finishes at once).
  await settleResumes(app);
  assert.equal(app.foundry.store.run(run.id).status, 'succeeded'); assert.equal(app.foundry.store.run(sent.id).status, 'succeeded');
  assert.equal((await get('/api/tasks')).body.total, 0);
});

test('live stream over fetch: a snapshot, then patches with contiguous sequence numbers, ending with the final state', async t => {
  const { app } = await appWith(t, { script: { 'claude-haiku-5-5': async () => { await new Promise(r => setTimeout(r, 15)); return { value: { label: 'ok', confidence: 0.9 }, usage: { inputTokens: 100, outputTokens: 10 }, costUsd: 0.00002 }; } } });
  const sc = NAMED['S5-live-map'](30);
  app.foundry.store.saveWorkflow(sc.workflow);
  const created = app.foundry.createRun(sc.workflow.id, sc.input);
  const { base, headers, get } = await serve(t, app);
  const ac = new AbortController(), seen = [];
  const reading = (async () => { for await (const m of sse(`${base}/api/runs/${created.id}/graph/stream`, headers, ac.signal)) { seen.push(m); if (m.event === 'end' || m.event === 'integrity') break; } })();
  await new Promise(r => setTimeout(r, 150));
  await app.foundry.startRun(created.id).catch(() => {});
  await Promise.race([reading, new Promise((_, rej) => setTimeout(() => rej(new Error('stream did not end')), 20000))]);
  ac.abort();
  assert.equal(seen[0].event, 'snapshot'); assert.equal(seen.at(-1).event, 'end');
  const patches = seen.filter(m => m.event === 'patch');
  assert.ok(patches.length >= 2, `${patches.length} patches`);
  let last = seen[0].data.run.chain.lastSeq;
  for (const p of patches) { assert.equal(p.data.fromSeq, last, 'no gap between messages'); last = p.data.toSeq; }
  const final = (await get(`/api/runs/${created.id}/graph`)).body;
  assert.equal(seen.at(-1).data.seq, final.run.chain.lastSeq);
  // Fold the stream the way a client would: the snapshot, then each patch's cards replace the cards with the same id.
  const cards = new Map(seen[0].data.graph.cards.map(c => [c.id, c]));
  for (const p of patches) for (const c of p.data.cards) cards.set(c.id, c);
  for (const c of final.graph.cards) assert.deepEqual(cards.get(c.id).state, c.state, `${c.id} state via the stream equals the snapshot`);
  assert.equal(patches.at(-1).data.run.status, 'succeeded');
  // Coalescing: far fewer messages than events.
  assert.ok(patches.length < final.run.chain.events / 2, `${patches.length} patches for ${final.run.chain.events} events`);
});

test('reconnecting gives a snapshot at the current head; an edited event stops the stream with an integrity message', async t => {
  const { app, dir } = await appWith(t);
  const run = await startFlow(app, NAMED['S3-question']().workflow);
  const { base, headers } = await serve(t, app);
  const first = await (async () => { for await (const m of sse(`${base}/api/runs/${run.id}/graph/stream`, { ...headers, 'last-event-id': '2' })) return m; })();
  assert.equal(first.event, 'snapshot'); assert.equal(first.data.run.chain.lastSeq, app.foundry.store.events(run.id).length);
  const db = new DatabaseSync(path.join(app.foundry.store.directory, 'foundry.sqlite'));
  const row = db.prepare('SELECT seq, body FROM events WHERE run_id=? ORDER BY seq LIMIT 1 OFFSET 3').get(run.id);
  db.prepare('UPDATE events SET body=? WHERE run_id=? AND seq=?').run(row.body.replace('"type"', '"edited":true,"type"'), run.id, row.seq); db.close();
  const msgs = [];
  for await (const m of sse(`${base}/api/runs/${run.id}/graph/stream`, headers)) { msgs.push(m); if (m.event === 'integrity') break; }
  assert.equal(msgs.at(-1).event, 'integrity'); assert.equal(msgs.at(-1).data.seq, row.seq);
  assert.ok(dir);
});

test('one request opens a node\'s whole conversation: prompt and reply from the journal, a person\'s answer, an executor transcript bound to the chain', async t => {
  const { app, dir } = await appWith(t, { script: { 'claude-haiku-5-5': async () => ({ value: { label: 'unsure', confidence: 0.2 }, usage: { inputTokens: 600, outputTokens: 80 }, costUsd: 0.0001 }) } });
  const failed = await startFlow(app, NAMED['S1b-check-named']().workflow, { topic: 'essay' });
  const asked = await startFlow(app, NAMED['S3-question']().workflow);
  const { get, post } = await serve(t, app);
  const c = (await get(`/api/runs/${failed.id}/node/conversation?key=root/grade`)).body;
  assert.equal(c.schema, CONVERSATION_SCHEMA); assert.equal(c.counts.modelCalls, 1);
  const prompt = c.turns.find(x => x.kind === 'prompt'), reply = c.turns.find(x => x.kind === 'reply');
  assert.equal(prompt.promptVerified, true); assert.match(prompt.prompt.text, /Grade the essay/); assert.equal(prompt.prompt.trust, 'untrusted');
  assert.match(reply.value.text, /"confidence":0\.2/); assert.equal(reply.boundToChain, false);
  assert.equal(c.turns.at(-1).kind, 'error'); assert.equal(c.turns.at(-1).code, 'NODE_CHECK_FAILED');
  assert.ok(c.turns.findIndex(x => x.kind === 'prompt') < c.turns.findIndex(x => x.kind === 'error'), 'in chain order');
  // The node record points at it.
  assert.match((await get(`/api/runs/${failed.id}/node?key=root/grade`)).body.conversation.route, /^node\/conversation\?key=/);
  // A person's answer: the value from the checkpoint, checked against the hash the chain holds.
  const q = (await get('/api/tasks')).body.tasks.find(x => x.runId === asked.id);
  await post('/api/tasks/answer', { runId: asked.id, nodeKey: q.nodeKey, requestHash: q.requestHash, answer: { approve: true, note: 'fine' } });
  await settleResumes(app);
  const h = (await get(`/api/runs/${asked.id}/node/conversation?key=root/decide`)).body;
  assert.deepEqual(h.turns.map(x => x.kind).filter(k => ['question', 'answer'].includes(k)), ['question', 'answer']);
  const answer = h.turns.find(x => x.kind === 'answer');
  assert.equal(answer.role, 'person'); assert.equal(answer.answerMatchesChain, true); assert.match(answer.answer.text, /fine/);
  // An executor transcript (an executor binds it with store.bindTranscript): shown only when the workspace copy matches the chain's hash.
  const file = path.join(dir, 'executor.jsonl');
  writeFileSync(file, [{ role: 'user', content: 'Fix the failing test' }, { role: 'assistant', content: 'Edited src/x.mjs; tests pass.\u202e' }].map(x => JSON.stringify(x)).join('\n'));
  const bound = app.foundry.store.bindTranscript(failed.id, { nodeKey: 'root/grade', file, label: 'opencode' });
  const x = (await get(`/api/runs/${failed.id}/node/conversation?key=root/grade`)).body.turns.find(y => y.kind === 'transcript');
  assert.equal(x.verified, true); assert.equal(x.entries.length, 2); assert.equal(x.entries[0].role, 'user'); assert.match(x.entries[1].text.text, /tests pass/);
  assert.ok(x.entries[1].text.invisibleReplaced >= 1, 'a bidi override in an executor transcript is made visible');
  const copy = path.join(app.foundry.store.directory, bound.location.path);
  writeFileSync(copy, 'tampered');
  const y = (await get(`/api/runs/${failed.id}/node/conversation?key=root/grade`)).body.turns.find(z => z.kind === 'transcript');
  assert.equal(y.verified, false); assert.equal(y.entries.length, 0); assert.match(y.reason, /does not match/);
  assert.equal((await get(`/api/runs/${failed.id}/node/conversation?key=root/nope`)).status, 404);
  assert.equal((await get(`/api/runs/${failed.id}/node/conversation?key=../x`)).status, 400);
});

test('the graph says which fields are data and which are suggestions for the owner\'s UI (D33)', async t => {
  const { app } = await appWith(t);
  const run = await startFlow(app, NAMED['S3-question']().workflow);
  const { get } = await serve(t, app);
  const g = (await get(`/api/runs/${run.id}/graph`)).body;
  assert.deepEqual(g.presentation, JSON.parse(JSON.stringify(PRESENTATION)));
  assert.ok(g.presentation.authoritative.includes('graph.cards[].state.detail')); assert.ok(g.presentation.advisory.includes('*.state.motion'));
});

// The live routes on a bare loopback server, so a test can set the heartbeat and the stream cap.
async function bare(t, app, options) {
  const handle = liveRoutes(app, options);
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => { try { if (await handle(req, res, new URL(req.url, 'http://127.0.0.1'), send) === false) send(res, 404, {}); } catch (e) { send(res, 409, { error: e.code }); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { handle.close(); server.closeAllConnections?.(); return new Promise(r => server.close(r)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('a run whose process dies writes no event; the stream\'s heartbeat still turns it "stalled" (review m9)', async t => {
  const { app } = await appWith(t);
  const sc = NAMED['S6-nothing-waiting']();
  app.foundry.store.saveWorkflow(sc.workflow);
  const created = app.foundry.createRun(sc.workflow.id, sc.input ?? {});
  const base = await bare(t, app, { heartbeatMs: 40, pollMs: 20 });
  const ac = new AbortController(), seen = [];
  const reading = (async () => { for await (const m of sse(`${base}/api/runs/${created.id}/graph/stream`, {}, ac.signal)) { seen.push(m); if (m.data?.run?.state?.detail === 'stalled') break; } })().catch(() => {});
  await new Promise(r => setTimeout(r, 100));
  const events = app.foundry.store.events(created.id).length;
  // The header says a live process (this one) runs it; then that the process is one that has exited. No event is written either time.
  app.foundry.store.updateRun(created.id, r => { r.status = 'running'; r.owner = { token: 't', pid: process.pid, processStart: processStartStamp(process.pid), acquiredAt: Date.now() }; }, [], { result: 'header' });
  await new Promise(r => setTimeout(r, 150));
  const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
  app.foundry.store.updateRun(created.id, r => { r.owner = { token: 't', pid: Number(gone), processStart: 'gone', acquiredAt: Date.now() }; }, [], { result: 'header' });
  await Promise.race([reading, new Promise(r => setTimeout(r, 5000))]);
  ac.abort();
  assert.equal(app.foundry.store.events(created.id).length, events, 'no event was written');
  assert.equal(seen[0].event, 'snapshot'); assert.equal(seen[0].data.run.executing, false);
  assert.ok(seen.some(m => m.event === 'patch' && m.data.run.executing === true), 'the heartbeat saw the live owner');
  const last = seen.at(-1);
  assert.equal(last.event, 'patch'); assert.equal(last.data.run.state.detail, 'stalled'); assert.equal(last.data.run.state.motion, 'none');
});

test('live streams are capped; beyond the cap a client is told to read /graph (review m5)', async t => {
  const { app } = await appWith(t);
  const run = await startFlow(app, NAMED['S3-question']().workflow);
  const base = await bare(t, app, { maxStreams: 1 });
  const ac = new AbortController();
  const first = await fetch(`${base}/api/runs/${run.id}/graph/stream`, { signal: ac.signal });
  assert.equal(first.status, 200);
  const second = await fetch(`${base}/api/runs/${run.id}/graph/stream`);
  assert.equal(second.status, 503); assert.match((await second.json()).error, /At most 1/);
  ac.abort();
});
