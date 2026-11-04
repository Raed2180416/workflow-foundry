// The dashboard's read-only run data and human-task routes (app/dashboard/live.mjs) over a real workspace, loopback only, $0.
//   nice -n 15 node --test app/test/live-routes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDashboard } from '../dashboard/server.mjs';
import { GRAPH_SCHEMA, NODE_SCHEMA } from '../core/run-graph.mjs';
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
  assert.equal(ok.status, 200); assert.equal(ok.body.run.status, 'succeeded'); assert.equal(ok.body.channel, 'dashboard');
  const a = (await get('/api/tasks')).body.tasks.find(x => x.kind === 'approval');
  const d = await post('/api/tasks/decide', { runId: sent.id, approvalId: a.approvalId, decision: 'approve' });
  assert.equal(d.status, 200); assert.equal(d.body.run.status, 'succeeded');
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
