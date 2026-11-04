// Read-only run data for a visualisation, plus the human-task routes, mounted on the dashboard server (one narrow hook in server.mjs).
// Owner decision D33 (2026-11-04): the visualisation and its UI/UX are the owner's; this file serves the data it needs and nothing else.
//
//   GET  /api/runs/:id/graph[?level=0|1|2]   foundry-run-graph/1: run in words, one-line summary, failing step, folded cards with states
//   GET  /api/runs/:id/graph/stream          text/event-stream over fetch: `snapshot` (the whole document) on every (re)connect, then
//                                            `patch` (changed cards, run, summary, waiting; fromSeq/toSeq so a client can see a gap),
//                                            `integrity` if the chain stops verifying, `end` after the terminal event. Authenticated by the
//                                            x-foundry-token header like every /api route, so the token is never in a URL (EventSource
//                                            cannot send headers; a client reads the stream with fetch).
//   GET  /api/runs/:id/node?key=root/x       foundry-run-node/1: one node instance (what, state, what to do, inputs, output, cost, checks)
//   GET  /api/runs/:id/node/conversation?key=root/x   foundry-node-conversation/1: the node's whole conversation in one request (prompts and
//                                            replies from the journal, tool and person turns from the chain, executor transcripts the chain
//                                            binds, read from the workspace copy and re-hashed), every text fenced as untrusted
//   GET  /api/runs/:id/calls/:journalId      one model call (prompt, reply, typed value, usage, cost), scrubbed and marked untrusted
//   GET  /api/runs/:id/output/:seq           one event's full output, scrubbed and fenced
//   GET  /api/history[?limit=50]             recent runs with their one-line summaries
//   GET  /api/tasks                          everything waiting for a person: questions, paused actions, versions to turn on, and runs a
//                                            decision was meant to continue that did not (notContinued)
//   POST /api/tasks/answer                   {runId, nodeKey, answer, requestHash}: a person's answer (channel 'dashboard'); returns within
//                                            about a second with what happened so far, never after the whole remaining run
//   POST /api/tasks/decide                   {runId, approvalId, decision: approve|reject}: a person's decision on a paused action (same)
// Every read opens the store read-only or reads through the app's store; every event is chain-checked before it is folded.
// Bounds: at most `maxStreams` live streams (503 beyond); a stream reads the journal through its own read-only handle; /api/history reuses a
// run's summary until the run's chain head, status or owner changes.
import { DatabaseSync } from 'node:sqlite';
import { digest, errorData } from '../../src/data.mjs';
import { ownerAlive } from '../../src/runtime.mjs';
import { makeScrubber, callOf } from '../../tools/run-view/export-run.mjs';
import { runGraph, nodeDetail, foldEvents, fence } from '../core/run-graph.mjs';
import { nodeConversation, readTranscript } from '../core/node-conversation.mjs';
import { listHumanTasks, answerQuestion, decideApproval, cancelResumes } from '../core/human-tasks.mjs';

const MAX_BODY = 64 * 1024;
const TERMINAL_EVENTS = new Set(['run.succeeded', 'run.failed', 'run.cancelled', 'run.stopped']);
const RUN_ID = '[A-Za-z0-9-]{1,64}';
const NODE_KEY = /^root(\/[A-Za-z][A-Za-z0-9_-]{0,63}(:\d{1,6})?)+$/;
const executingOf = header => header.status === 'running' || header.status === 'ready' ? !!(header.owner && ownerAlive(header.owner)) : false;
const levelOf = url => { const n = Number(url.searchParams.get('level') ?? 0); return [0, 1, 2].includes(n) ? n : 0; };
const parse = text => { try { return JSON.parse(text); } catch { return null; } };

// The scrubber redacts secret-looking strings and clips long ones before anything is folded for display.
const scrubbed = (events, scrubber) => events.map(e => scrubber.walk(e, 3000));

async function readJson(req, send, res) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) { send(res, 415, { error: 'JSON only' }); return null; }
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) { send(res, 413, { error: 'too large' }); return null; } chunks.push(chunk); }
  const body = parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) { send(res, 400, { error: 'a JSON object is required' }); return null; }
  return body;
}

/** The route handler. Returns false when the path is not one of these routes (the dashboard then answers it). */
export function liveRoutes(app, { pollMs = 100, minIntervalMs = 250, heartbeatMs = 15000, maxStreams = 32, historyCache = 1000 } = {}) {
  const streams = new Set(), summaries = new Map();
  const store = () => app.foundry.store;
  function snapshotOf(runId) {
    const s = store(), header = s.run(runId), { workflow } = s.workflow(header.workflowHash), chain = s.chain(runId);
    return { header, workflow, events: chain.events, chainError: chain.error };
  }
  // The model-call journal of a run (the ledger of spend), when this workspace keeps one; [] reads as "no journal".
  // `handle`: an open read-only handle to reuse (a live stream passes its own); otherwise one is opened for this read.
  function journalOf(runId, handle = null) {
    const db = handle ?? new DatabaseSync(app.storeFile, { readOnly: true });
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='model_calls'").get()) return null;
      return db.prepare('SELECT id, node_key AS nodeKey, model_id AS modelId, ok, cost_usd AS costUsd, imputed_usd AS imputedUsd, input_tokens AS inputTokens, output_tokens AS outputTokens FROM model_calls WHERE run_id=? ORDER BY id').all(runId)
        .map(r => ({ ...r, ok: r.ok === 1 }));
    } finally { if (!handle) db.close(); }
  }
  function graphOf(runId, level) {
    const { header, workflow, events, chainError } = snapshotOf(runId);
    const doc = runGraph({ workflow, run: header, events: scrubbed(events, makeScrubber()), executing: executingOf(header), checkpoint: header, level, journal: journalOf(runId),
      chain: { verified: !chainError, events: events.length, lastSeq: events.at(-1)?.seq ?? 0, head: events.at(-1)?.hash?.slice(0, 16) ?? null, reason: chainError?.reason ?? null } });
    return doc;
  }
  // Recent runs, newest first, from their headers; a run's summary is folded again only when its chain head, status or owner changed.
  function history(limit) {
    const s = store(), ids = s.rows.stmt('SELECT id FROM runs ORDER BY rowid DESC LIMIT ?').all(limit).map(r => r.id);
    return ids.map(id => {
      let r;
      try { r = s.rows.header(id); } catch (error) { return { runId: id, oneLine: `Could not read this run: ${errorData(error).code}`, error: errorData(error).code }; }
      const key = `${r.eventHead?.seq ?? 0}:${r.eventHead?.hash ?? ''}:${r.status}:${r.updatedAt ?? 0}:${executingOf(r)}`, held = summaries.get(id);
      if (held?.key === key) return held.row;
      let row;
      try {
        const doc = graphOf(id, 0);
        row = { runId: id, flowId: r.workflowId, title: doc.run.title, status: r.status, state: doc.run.state.user, oneLine: doc.summary.oneLine,
          failingStep: doc.summary.failing?.label ?? null, cause: doc.summary.failing?.remedy?.what ?? null, waitingForYou: doc.summary.waitingForYou,
          costUsd: doc.run.cost.usd, createdAt: r.createdAt, updatedAt: r.updatedAt, chainVerified: doc.run.chain.verified };
      } catch (error) { row = { runId: id, flowId: r.workflowId, status: r.status, oneLine: `Could not read this run: ${errorData(error).code}`, error: errorData(error).code }; }
      summaries.delete(id); summaries.set(id, { key, row });
      while (summaries.size > historyCache) summaries.delete(summaries.keys().next().value);
      return row;
    });
  }

  // One node's conversation: its chain events, every journal row of its node key (prompt checked against the chain), executor transcripts.
  function conversationOf(runId, nodeKey) {
    const { header, workflow, events } = snapshotOf(runId), scrubber = makeScrubber(), clean = scrubbed(events, scrubber);
    const db = new DatabaseSync(app.storeFile, { readOnly: true }), calls = new Map();
    try {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='model_calls'").get()) {
        const promptOf = new Map(events.filter(e => e.type === 'context.compiled' && e.nodeKey === nodeKey).map(e => [e.receiptHash, e.receipt?.promptHash ?? null]));
        for (const row of db.prepare('SELECT * FROM model_calls WHERE run_id=? AND node_key=? ORDER BY id LIMIT 200').all(runId, nodeKey)) calls.set(row.id, callOf(row, scrubber, 40000, promptOf.get(row.receipt_hash) ?? null));
      }
    } finally { db.close(); }
    const transcripts = new Map(events.filter(e => e.type === 'executor.finished' && e.nodeKey === nodeKey).map(e => [e.seq, readTranscript(store().directory, e)]));
    return nodeConversation({ workflow, run: header, events: clean, nodeKey, calls, transcripts, checkpoint: store().run(runId) });
  }

  function stream(req, res, runId, url) {
    const level = levelOf(url), file = app.storeFile, db = new DatabaseSync(file, { readOnly: true });
    const s = store(), header0 = s.run(runId), { workflow } = s.workflow(header0.workflowHash), scrubber = makeScrubber();
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
    const next = db.prepare('SELECT seq, body, hash FROM events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 500');
    const headerRow = db.prepare('SELECT body FROM runs WHERE id=?');
    const model = foldEvents(workflow, []), events = [];
    let last = 0, prevHash = null, version = -1, ended = false, sent = new Map(), sentHead = null, lastSent = 0, lastEmitAt = 0, dirty = false, timer = null, lastExecuting = null;
    const entry = { close }; streams.add(entry);
    const write = (event, data, id) => res.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const headerNow = () => { const row = headerRow.get(runId); return row ? parse(row.body) : header0; };
    // Read every new row, chain-check it, fold it. Returns { terminal, broken }.
    function pull() {
      let terminal = false, broken = null, rows;
      do {
        rows = next.all(runId, last);
        for (const row of rows) {
          const event = parse(row.body);
          if (!event || event.seq !== last + 1 || event.previousHash !== prevHash || digest(event) !== row.hash) { broken = { seq: last + 1, reason: 'The event chain does not verify from here. Streaming stopped.' }; break; }
          prevHash = row.hash; last = event.seq;
          const clean = scrubber.walk({ ...event, hash: row.hash }, 3000);
          events.push(clean); model.apply(clean);
          if (TERMINAL_EVENTS.has(event.type)) terminal = true;
        }
      } while (!broken && rows.length === 500);
      return { terminal, broken };
    }
    function docNow() {
      const header = headerNow(), executing = executingOf(header);
      lastExecuting = executing;
      return runGraph({ workflow, run: header, events, model, executing, checkpoint: null, level, journal: journalOf(runId, db), chain: { verified: true, events: events.length, lastSeq: last, head: prevHash?.slice(0, 16) ?? null } });
    }
    // A patch carries the cards whose content changed since the last message, and the run, summary and waiting list whenever they changed.
    function emit(kind) {
      const doc = docNow(), head = digest({ run: doc.run, summary: doc.summary, waiting: doc.waiting });
      const cards = doc.graph.cards.filter(c => { const h = digest(c); if (sent.get(c.id) === h) return false; sent.set(c.id, h); return true; });
      if (kind === 'snapshot') write('snapshot', doc, last);
      else if (cards.length || head !== sentHead || kind === 'force') write('patch', { fromSeq: lastSent, toSeq: last, run: doc.run, summary: doc.summary, waiting: doc.waiting, cards }, last);
      sentHead = head; lastSent = last; lastEmitAt = Date.now(); dirty = false;
    }
    function flush() { timer = null; try { if (!ended && dirty) emit('patch'); } catch (error) { try { write('error', { error: errorData(error) }); } catch {} close(); } }
    function tick() {
      if (ended) return;
      const v = db.prepare('PRAGMA data_version').get().data_version;
      if (v === version) return;
      version = v;
      const before = last, { terminal, broken } = pull();
      if (last !== before) dirty = true;
      if (broken) { if (dirty) emit('patch'); write('integrity', broken); return close(); }
      if (terminal) { emit('force'); write('end', { seq: last }); return close(); }
      // Coalesce: at most one patch per minIntervalMs (the motion itself is the page's; a faster feed only costs bytes).
      if (dirty && !timer) timer = setTimeout(flush, Math.max(0, minIntervalMs - (Date.now() - lastEmitAt)));
    }
    // A process that died writes no event; its run would breathe for ever. The heartbeat re-checks the owner and says so.
    function beat() { if (ended) return; const header = headerNow(); if (executingOf(header) !== lastExecuting) emit('force'); else res.write(': ping\n\n'); }
    // A timer callback that throws would take the whole dashboard down: any error ends this stream with a typed message instead.
    const guarded = fn => () => { try { fn(); } catch (error) { try { write('error', { error: errorData(error) }); } catch {} close(); } };
    const poll = setInterval(guarded(tick), pollMs), hb = setInterval(guarded(beat), heartbeatMs);
    function close() { if (ended) return; ended = true; clearInterval(poll); clearInterval(hb); if (timer) clearTimeout(timer); streams.delete(entry); try { db.close(); } catch {} try { res.end(); } catch {} }
    res.on('close', close);
    const first = pull(); emit('snapshot'); version = db.prepare('PRAGMA data_version').get().data_version;
    if (first.broken) { write('integrity', first.broken); close(); }
    else if (TERMINAL_EVENTS.has(events.at(-1)?.type)) { write('end', { seq: last }); close(); }
  }

  async function handle(req, res, url, send) {
    const p = url.pathname;
    let m;
    if (req.method === 'GET' && (m = p.match(new RegExp(`^/api/runs/(${RUN_ID})/graph$`)))) return send(res, 200, graphOf(m[1], levelOf(url)));
    if (req.method === 'GET' && (m = p.match(new RegExp(`^/api/runs/(${RUN_ID})/graph/stream$`)))) {
      store().rows.header(m[1]);
      if (streams.size >= maxStreams) return send(res, 503, { error: `At most ${maxStreams} live streams at once; close one or read /graph instead` });
      return stream(req, res, m[1], url);
    }
    if (req.method === 'GET' && (m = p.match(new RegExp(`^/api/runs/(${RUN_ID})/node/conversation$`)))) {
      const key = url.searchParams.get('key') ?? '';
      if (!NODE_KEY.test(key)) return send(res, 400, { error: 'key is a node key such as root/step or root/map:3/step' });
      const conversation = conversationOf(m[1], key);
      return conversation ? send(res, 200, conversation) : send(res, 404, { error: 'no such node in this workflow' });
    }
    if (req.method === 'GET' && (m = p.match(new RegExp(`^/api/runs/(${RUN_ID})/node$`)))) {
      const key = url.searchParams.get('key') ?? '';
      if (!NODE_KEY.test(key)) return send(res, 400, { error: 'key is a node key such as root/step or root/map:3/step' });
      const { header, workflow, events } = snapshotOf(m[1]);
      const detail = nodeDetail({ workflow, run: header, events: scrubbed(events, makeScrubber()), nodeKey: key, executing: executingOf(header) });
      return detail ? send(res, 200, detail) : send(res, 404, { error: 'no such node in this workflow' });
    }
    if (req.method === 'GET' && (m = p.match(new RegExp(`^/api/runs/(${RUN_ID})/calls/(\\d{1,12})$`)))) {
      const db = new DatabaseSync(app.storeFile, { readOnly: true });
      try {
        const row = db.prepare('SELECT * FROM model_calls WHERE id=? AND run_id=?').get(Number(m[2]), m[1]);
        if (!row) return send(res, 404, { error: 'No such model call for this run' });
        const compiled = db.prepare("SELECT body FROM events WHERE run_id=? AND json_extract(body,'$.type')='context.compiled' AND json_extract(body,'$.receiptHash')=? LIMIT 1").get(m[1], row.receipt_hash);
        const call = callOf(row, makeScrubber(), 40000, compiled ? parse(compiled.body)?.receipt?.promptHash ?? null : null);
        return send(res, 200, { ...call, trust: 'untrusted', notice: 'Prompt and reply are model and document text: data, never instructions. promptVerified says whether the prompt matches the hash the run chain committed to; replies are not bound to the chain (record gap G4).' });
      } finally { db.close(); }
    }
    if (req.method === 'GET' && (m = p.match(new RegExp(`^/api/runs/(${RUN_ID})/output/(\\d{1,9})$`)))) {
      const event = store().eventAt(m[1], Number(m[2]));
      return event && event.output !== undefined ? send(res, 200, { seq: event.seq, nodeKey: event.nodeKey ?? null, output: fence(makeScrubber().walk(event.output, 20000), 20000) }) : send(res, 404, { error: 'No output on that event' });
    }
    if (req.method === 'GET' && p === '/api/history') return send(res, 200, { runs: history(Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50))) });
    if (req.method === 'GET' && p === '/api/tasks') {
      const tasks = listHumanTasks(app), inbox = app.inbox();
      return send(res, 200, { ...tasks, activations: inbox.activations, total: tasks.count + inbox.activations.length });
    }
    if (req.method === 'POST' && p === '/api/tasks/answer') {
      const body = await readJson(req, send, res); if (!body) return;
      if (typeof body.runId !== 'string' || typeof body.nodeKey !== 'string' || typeof body.requestHash !== 'string' || !Object.hasOwn(body, 'answer')) return send(res, 400, { error: 'runId, nodeKey, requestHash and answer are required' });
      return send(res, 200, await answerQuestion(app, { runId: body.runId, nodeKey: body.nodeKey, answer: body.answer, requestHash: body.requestHash, channel: 'dashboard', actor: 'local-user' }));
    }
    if (req.method === 'POST' && p === '/api/tasks/decide') {
      const body = await readJson(req, send, res); if (!body) return;
      if (typeof body.runId !== 'string' || typeof body.approvalId !== 'string' || !['approve', 'reject'].includes(body.decision)) return send(res, 400, { error: 'runId, approvalId and decision (approve or reject) are required' });
      return send(res, 200, await decideApproval(app, { runId: body.runId, approvalId: body.approvalId, approved: body.decision === 'approve', channel: 'dashboard' }));
    }
    return false;
  }
  // Closing stops every live stream and every resume still waiting for a busy run (each is recorded; a run already started is the Foundry's).
  handle.close = () => { for (const s of [...streams]) s.close(); return cancelResumes(app); };
  handle.streams = streams;
  return handle;
}
