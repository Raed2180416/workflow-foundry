#!/usr/bin/env node
// What it costs to watch one live run, three ways ($0, loopback): the same 50-item map run watched at once by
//   B1  tools/run-view/serve.mjs: EventSource-style SSE of every chain event (slim), folded in the page (token in the URL query)
//   T   app/dashboard live.mjs: SSE over fetch of the folded document (snapshot, then coalesced patches; token in a header), at level 0
//       (at most 24 folded cards) and, since the review (m4, 2026-11-04), also at level 2 (one card per top-level step). Neither level
//       streams per-item detail: a map's items are its card's progress; one item's detail is a /node request. B1 streams every event.
//   B0  app/dashboard today: GET /api/overview every 5 s (the page's poll) plus GET /api/runs/:id when a person opens the run
// Reported: messages, bytes, and the delay from the terminal event's commit to its arrival. One machine, shared load: indicative only.
//   node app/eval/run-graph/stream-cost.mjs [--items 50] [--out FILE]
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, loadavg } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { FoundryApp } from '../../core/service.mjs';
import { Foundry } from '../../../src/foundry.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { createDashboard } from '../../dashboard/server.mjs';
import { startServer } from '../../../tools/run-view/serve.mjs';
import { NAMED, effectRegistry, M } from './scenarios.mjs';

async function count(url, headers, until) {
  const res = await fetch(url, { headers });
  const out = { messages: 0, bytes: 0, endAt: null }, decoder = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    out.bytes += chunk.length; buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); if (/^data: /m.test(block)) out.messages++; if (/^event: end/m.test(block)) { out.endAt = Date.now(); return out; } }
    if (until()) break;
  }
  return out;
}

export async function streamCost({ items = 50 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'stream-cost-')), app = new FoundryApp({ workspace: dir });
  await app.foundry.close();
  const registry = effectRegistry(), provider = new ScriptedProvider({ [M]: async () => { await new Promise(r => setTimeout(r, 25)); return { value: { label: 'ok', confidence: 0.9 }, usage: { inputTokens: 300, outputTokens: 30 }, costUsd: 0.00004 }; } });
  app.registry = registry;
  app.foundry = new Foundry(app.liveDir, { registry, policy: { allowedCapabilities: registry.list().map(c => c.name), maxCost: 5, maxConcurrency: 16, maxSteps: 50000 },
    models: store => new ModelPort({ policy: loadPolicy().policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) }) });
  const dash = createDashboard(app), { port } = await dash.listen(0);
  const rv = await startServer({ dbFile: app.storeFile, pollMs: 100 });
  try {
    const sc = NAMED['S5-live-map'](items);
    app.foundry.store.saveWorkflow(sc.workflow);
    const run = app.foundry.createRun(sc.workflow.id, sc.input);
    let done = false;
    const tStream = count(`http://127.0.0.1:${port}/api/runs/${run.id}/graph/stream`, { 'x-foundry-token': dash.token }, () => done);
    const t2Stream = count(`http://127.0.0.1:${port}/api/runs/${run.id}/graph/stream?level=2`, { 'x-foundry-token': dash.token }, () => done);
    const bStream = count(`${rv.origin}/api/runs/${run.id}/stream?t=${rv.token}`, {}, () => done);
    // B0: the page polls the overview every 5 s while it is open; a person opens the run once at the end.
    const poll = { requests: 0, bytes: 0 };
    const pollOnce = async () => { const r = await fetch(`http://127.0.0.1:${port}/api/overview`, { headers: { 'x-foundry-token': dash.token } }); poll.requests++; poll.bytes += (await r.text()).length; };
    await pollOnce();
    const timer = setInterval(() => { pollOnce().catch(() => {}); }, 5000);
    await new Promise(r => setTimeout(r, 200));
    const t0 = Date.now();
    await app.foundry.startRun(run.id).catch(() => {});
    const committedAt = Date.now(), wallMs = committedAt - t0;
    const [t, t2, b] = await Promise.all([tStream, t2Stream, bStream]); done = true; clearInterval(timer);
    const detail = await fetch(`http://127.0.0.1:${port}/api/runs/${run.id}`, { headers: { 'x-foundry-token': dash.token } }); poll.requests++; poll.bytes += (await detail.text()).length;
    const events = app.foundry.store.events(run.id).length;
    return { items, events, runWallMs: wallMs, loadavg: loadavg().map(x => Math.round(x * 100) / 100),
      T: { messages: t.messages, bytes: t.bytes, endDelayMs: t.endAt - committedAt, liveStates: true, level: 0 },
      'T-level2': { messages: t2.messages, bytes: t2.bytes, endDelayMs: t2.endAt - committedAt, liveStates: true, level: 2 },
      perItemDetail: { T: 'no (item states are the map card\'s progress; GET /node?key=root/map:i/step for one item)', B1: 'yes (every event of every item)' },
      B1: { messages: b.messages, bytes: b.bytes, endDelayMs: b.endAt - committedAt, liveStates: true, tokenInUrl: true },
      B0: { requests: poll.requests, bytes: poll.bytes, endDelayMs: null, liveStates: false, note: 'polls every 5 s; per-step states are not in its data' } };
  } finally { await rv.close(); await dash.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: a } = parseArgs({ options: { items: { type: 'string', default: '50' }, out: { type: 'string' } } });
  const r = await streamCost({ items: Number(a.items) });
  if (a.out) writeFileSync(a.out, `${JSON.stringify(r, null, 1)}\n`);
  console.log(JSON.stringify(r, null, 1));
}
