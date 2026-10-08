#!/usr/bin/env node
// Read-only server for tools/run-view: the page itself plus a live feed of one workspace's runs. It never writes to the workspace.
//
//   node tools/run-view/serve.mjs --workspace DIR [--journal FILE] [--port 0] [--poll-ms 100]     live: a run picker, then SSE
//   node tools/run-view/serve.mjs --data run.json [--port 0]                                         static: one exported run
//
// Live feed design (research/review-20261007/06-ui.md section 4): the `events` table is append-only and hash-chained, so a viewer is a tail.
//   GET /api/runs                       the workspace's recent runs (id, workflow title, status, counts)
//   GET /api/runs/:id/view              the run header, the immutable workflow version, the decision records (no events)
//   GET /api/runs/:id/stream            SSE. `event: batch` carries up to 400 events (the page's slim form), `id:` is the last seq, so the browser's own
//                                       reconnect resumes through Last-Event-ID. `event: end` follows a terminal run event; `event: integrity` stops the stream.
//   GET /api/runs/:id/call/:journalId   one journal row (prompt, reply, typed value), fetched when a transcript is opened
//   GET /api/runs/:id/output/:seq       one event's full output, fetched when a transcript is opened
// Wake-up: PRAGMA data_version changes when another connection commits, so an idle stream costs one cheap pragma per poll tick.
// Every new row is chain-checked on arrival (seq, previousHash, digest) against the hash the previous row carried.
// Security: loopback only; Host and Origin checks as in src/http.mjs; GET only; /api needs a per-start random token carried in the URL fragment (never sent
// in a request line); the CSP forbids inline script and style. The feed carries prompts and corpus text: the token is the guard, so do not share the URL.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { digest } from '../../src/data.mjs';
import { makeScrubber, slimEvent, callOf, runHeader, decisionsOf, SCHEMA } from './export-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TERMINAL = new Set(['run.succeeded', 'run.failed', 'run.cancelled', 'run.stopped']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const safeEqual = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const openReadOnly = file => new DatabaseSync(file, { readOnly: true });
const parse = text => { try { return JSON.parse(text); } catch { return null; } };

export async function startServer({ workspace, dbFile, journalFile, dataFile, port = 0, pollMs = 100, batch = 400, token = randomBytes(24).toString('hex'), heartbeatMs = 15000 } = {}) {
  dbFile ??= workspace ? path.join(workspace, '.foundry', 'foundry.sqlite') : null;
  if (!dbFile && !dataFile) throw new Error('Need a workspace (live) or a data file (static)');
  if (dbFile && !existsSync(dbFile)) throw new Error(`No workspace store at ${dbFile}`);
  let origin;
  const streams = new Set();
  const stats = { streams: 0, batches: 0, events: 0, polls: 0, pumps: 0 };
  const server = createServer((req, res) => {
    const send = (status, body, type = types['.json'], extra = {}) => { res.writeHead(status, { 'Content-Type': type, ...extra }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      if (req.method !== 'GET') return send(405, { error: 'GET only' });
      if (req.headers.host !== new URL(origin).host) return send(403, { error: 'Unrecognized host' });
      if (req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'Cross-origin access is forbidden' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'Cross-site access is forbidden' });
      const url = new URL(req.url, origin), parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const files = { '/': 'index.html', '/index.html': 'index.html', '/run-view.js': 'run-view.js', '/run-view.css': 'run-view.css' };
      if (files[url.pathname]) return send(200, readFileSync(path.join(here, files[url.pathname])), types[path.extname(files[url.pathname])]);
      if (url.pathname === '/data.json' && dataFile) return send(200, readFileSync(dataFile));
      if (parts[0] === 'api' && dbFile) {
        if (!safeEqual(url.searchParams.get('t'), token)) return send(403, { error: 'Missing or invalid token' });
        return api(req, res, url, parts, send);
      }
      return send(404, { error: 'Not found' });
    } catch (error) { if (!res.headersSent) send(500, { error: String(error.message ?? error).slice(0, 300) }); else res.end(); }
  });
  const withDb = fn => { const db = openReadOnly(dbFile); try { return fn(db); } finally { db.close(); } };
  const journalDb = db => journalFile ? openReadOnly(journalFile) : db;
  const runOf = (db, id) => { const row = db.prepare('SELECT body FROM runs WHERE id=?').get(id); return row ? JSON.parse(row.body) : null; };
  const workflowOf = (db, run) => { const row = db.prepare('SELECT body FROM workflows WHERE hash=?').get(run.workflowHash); return row ? JSON.parse(row.body) : null; };

  function api(req, res, url, parts, send) {
    if (parts.length === 2 && parts[1] === 'runs') {
      return send(200, withDb(db => db.prepare('SELECT body FROM runs ORDER BY rowid DESC LIMIT 50').all().map(r => {
        const run = JSON.parse(r.body), wf = workflowOf(db, run);
        return { id: run.id, status: run.status, workflowId: run.workflowId, title: wf?.title ?? run.workflowId, createdAt: run.createdAt, updatedAt: run.updatedAt, steps: run.steps, cost: run.cost, events: run.eventHead?.seq ?? 0 };
      })));
    }
    const id = parts[2];
    if (parts[1] !== 'runs' || !id) return send(404, { error: 'Not found' });
    if (parts.length === 4 && parts[3] === 'view') {
      return withDb(db => {
        const run = runOf(db, id); if (!run) return send(404, { error: 'No such run' });
        const workflow = workflowOf(db, run); if (!workflow) return send(404, { error: 'Workflow version missing' });
        if (digest(workflow) !== run.workflowHash) return send(409, { error: 'Stored workflow does not match its hash' });
        const scrubber = makeScrubber();
        return send(200, { schema: SCHEMA, exportedAt: new Date().toISOString(), source: { workspace: path.basename(path.resolve(workspace ?? path.dirname(path.dirname(dbFile)))), live: true, exporter: 'tools/run-view/serve.mjs' },
          run: runHeader(run, workflow), workflow: scrubber.walk(workflow, 2500), decisions: decisionsOf(db, id, scrubber), integrity: { chainVerified: false, verifiedAt: 'stream', live: true, events: run.eventHead?.seq ?? 0, head: run.eventHead?.hash?.slice(0, 16) ?? null, journalRows: null, journalOrphans: null, derivedEvents: 0 },
          truncation: { maxPrompt: 40000 }, redaction: { enabled: true }, notice: 'Live feed. Contains prompts, model replies and corpus text.' });
      });
    }
    if (parts.length === 5 && parts[3] === 'call') {
      const db = openReadOnly(dbFile), jd = journalDb(db);
      try {
        const row = jd.prepare('SELECT * FROM model_calls WHERE id=? AND run_id=?').get(Number(parts[4]), id);
        if (!row) return send(404, { error: 'No such journal row for this run' });
        const compiled = db.prepare("SELECT body FROM events WHERE run_id=? AND json_extract(body,'$.type')='context.compiled' AND json_extract(body,'$.receiptHash')=? LIMIT 1").get(id, row.receipt_hash);
        return send(200, callOf(row, makeScrubber(), 40000, compiled ? parse(compiled.body)?.receipt?.promptHash ?? null : null));
      } finally { if (jd !== db) jd.close(); db.close(); }
    }
    if (parts.length === 5 && parts[3] === 'output') {
      return withDb(db => {
        const row = db.prepare('SELECT body FROM events WHERE run_id=? AND seq=?').get(id, Number(parts[4]));
        const event = row && parse(row.body);
        return event && event.output !== undefined ? send(200, makeScrubber().walk(event.output, 3000)) : send(404, { error: 'No output on that event' });
      });
    }
    if (parts.length === 4 && parts[3] === 'stream') return stream(req, res, id, url);
    return send(404, { error: 'Not found' });
  }

  function stream(req, res, id, url) {
    const db = openReadOnly(dbFile), scrubber = makeScrubber();
    if (!runOf(db, id)) { db.close(); res.writeHead(404, { 'Content-Type': types['.json'] }); res.end(JSON.stringify({ error: 'No such run' })); return; }
    let draining = false;
    let last = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0) || 0, prevHash = null, version = -1, ended = false;
    if (last > 0) { const row = db.prepare('SELECT hash FROM events WHERE run_id=? AND seq=?').get(id, last); prevHash = row?.hash ?? null; if (!prevHash) last = 0; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    const next = db.prepare('SELECT seq, body, hash FROM events WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?');
    const entry = { close };
    streams.add(entry); stats.streams++;
    function write(event, data, idValue) { res.write(`${idValue === undefined ? '' : `id: ${idValue}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
    function pump() {
      if (ended) return;
      if (res.writableNeedDrain) { if (!draining) { draining = true; res.once('drain', () => { draining = false; pump(); }); } return; }     // a slow client is never buffered without bound: read the next rows only once it has taken the last
      stats.pumps++;
      const rows = next.all(id, last, batch), out = [];
      let terminal = false, broken = null;
      for (const row of rows) {
        const event = parse(row.body);
        if (!event || event.seq !== last + 1 || event.previousHash !== prevHash || digest(event) !== row.hash) { broken = { seq: last + 1, reason: 'The event chain does not verify from here. Streaming stopped.' }; break; }
        prevHash = row.hash; last = event.seq;
        out.push(slimEvent({ ...event, hash: row.hash }, scrubber).slim);
        if (TERMINAL.has(event.type)) terminal = true;
      }
      if (out.length) { write('batch', out, last); stats.batches++; stats.events += out.length; }     // rows that verified are delivered before a break is reported
      if (broken) { write('integrity', broken); return setTimeout(close, 200); }
      if (terminal) { write('end', { seq: last }); return setTimeout(close, 200); }                    // the client closes on `end`; closing here too avoids an aborted request
      if (rows.length === batch) setImmediate(pump);
    }
    function tick() { stats.polls++; const v = db.prepare('PRAGMA data_version').get().data_version; if (v !== version) { version = v; pump(); } }
    const poll = setInterval(tick, pollMs), beat = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
    function close() { if (ended) return; ended = true; clearInterval(poll); clearInterval(beat); streams.delete(entry); try { db.close(); } catch {} try { res.end(); } catch {} }
    res.on('close', close);                                  // the response closes when the browser goes away (req 'close' fires when the request body is consumed)
    tick();
  }

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, token, stats, url: dataFile ? `${origin}/?data=/data.json` : `${origin}/#t=${token}`, close: async () => { for (const s of [...streams]) s.close(); await new Promise(r => server.close(r)); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: a } = parseArgs({ options: { workspace: { type: 'string' }, journal: { type: 'string' }, data: { type: 'string' }, port: { type: 'string', default: '0' }, 'poll-ms': { type: 'string', default: '100' } } });
  const service = await startServer({ workspace: a.workspace, journalFile: a.journal, dataFile: a.data, port: Number(a.port), pollMs: Number(a['poll-ms']) });
  console.log(`Run view (read-only, loopback only): ${service.url}`);
  console.log(a.data ? 'Static: one exported run.' : 'Live: pick a run on the page. The URL contains a one-time token; do not share it.');
  process.on('SIGINT', async () => { await service.close(); process.exit(0); });
}
