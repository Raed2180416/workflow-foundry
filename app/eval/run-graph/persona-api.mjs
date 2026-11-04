#!/usr/bin/env node
// The plan's persona tasks, done through the dashboard's HTTP API by a scripted client, in two arms ($0, loopback):
//   B0  only the routes that existed before this work (/api/overview, /api/runs/:id, /api/decide)
//   T   the routes added here (/api/runs/:id/graph, /node, /calls, /api/history, /api/tasks, /api/tasks/answer|decide)
// Each task's answer is checked against the store and journal (not against either arm). Reported per task: success, requests, bytes read.
// What it is: the data-level analogue of "steps" for a UI built on each arm. What it is not: a user study, or a measurement of any UI.
//   node app/eval/run-graph/persona-api.mjs [--out FILE]
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { NAMED, effectRegistry, M, L } from './scenarios.mjs';

const loaded = loadPolicy();
async function workspace(script) {
  const dir = mkdtempSync(path.join(tmpdir(), 'persona-api-')), app = new FoundryApp({ workspace: dir });
  await app.foundry.close();
  const registry = effectRegistry(), provider = new ScriptedProvider(script);
  app.registry = registry;
  app.foundry = new Foundry(app.liveDir, { registry, policy: { allowedCapabilities: registry.list().map(c => c.name), maxCost: 5, maxConcurrency: 16, maxSteps: 50000 },
    models: store => new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) }) });
  const dash = createDashboard(app), { port } = await dash.listen(0);
  const counter = { requests: 0, bytes: 0 };
  const call = async (p, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? 'POST' : 'GET', headers: { 'x-foundry-token': dash.token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); counter.requests++; counter.bytes += text.length;
    return JSON.parse(text);
  };
  const start = async (wf, input = {}) => { app.foundry.store.saveWorkflow(wf); const r = app.foundry.createRun(wf.id, input); await app.foundry.startRun(r.id).catch(() => {}); return r.id; };
  return { app, call, counter, start, close: async () => { await dash.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const measured = async (counter, fn) => { const before = { ...counter }, t0 = performance.now(); let ok = false, note = null; try { ({ ok, note = null } = await fn()); } catch (error) { note = `error: ${error.message}`; } return { ok, requests: counter.requests - before.requests, bytes: counter.bytes - before.bytes, ms: Math.round(performance.now() - t0), note }; };
const leafOf = (store, runId) => { const run = store.run(runId); const all = [...Object.entries(run.nodes).map(([id, n]) => [`root/${id}`, n]), ...Object.entries(run.frames ?? {}).flatMap(([f, fr]) => Object.entries(fr.nodes).map(([id, n]) => [`${f}/${id}`, n]))];
  const bad = all.filter(([, n]) => ['failed', 'uncertain'].includes(n.status) && n.error?.code !== 'CANCELLED'); return bad.filter(([k]) => !bad.some(([j]) => j !== k && j.startsWith(`${k}:`)))[0] ?? null; };
const labelOf = key => { const id = key.split('/').at(-1).replace(/:\d+$/, ''); return id[0].toUpperCase() + id.slice(1).replace(/[_-]+/g, ' '); };

export async function personaApi() {
  const script = { [M]: async a => /\[tag:(grade|read)\]/.test(a.prompt) && (!/"id":/.test(a.prompt) || /"id":2\b/.test(a.prompt)) ? { value: { label: 'x', confidence: 0.2 }, usage: { inputTokens: 600, outputTokens: 80 }, costUsd: 0.0001 }
    : /\[tag:translate\]/.test(a.prompt) ? { error: { code: 'MODEL_RATE_LIMIT', message: 'scripted 429' } } : /\[tag:a\]/.test(a.prompt) ? { value: { label: 'x', confidence: 0.3 }, usage: { inputTokens: 1500, outputTokens: 200 }, costUsd: 0.0021 }
    : { value: { label: 'x', confidence: 0.95 }, usage: { inputTokens: 900, outputTokens: 120 }, costUsd: 0.0013 },
    [L]: async () => ({ value: { label: 'x', confidence: 0.9 }, usage: { inputTokens: 1500, outputTokens: 220 }, costUsd: 0.0094 }) };
  const ws = await workspace(script), { app, call, counter, start } = ws, store = app.foundry.store, rows = [];
  try {
    const failed = { S1b: await start(NAMED['S1b-check-named']().workflow, { topic: 'essay' }), S7: await start(NAMED['S7-nested-fail']().workflow, NAMED['S7-nested-fail']().input), S12: await start(NAMED['S12-envfault']().workflow, { topic: 'page' }) };
    const costs = await start(NAMED['S4-costs']().workflow, { topic: 'reports' });
    // T1: why did the run fail (the deepest failing step and its code, from the record).
    for (const [name, runId] of Object.entries(failed)) {
      const [key, node] = leafOf(store, runId), truth = { label: labelOf(key), code: node.error?.code };
      rows.push({ task: `T1 why did ${name} fail`, B0: await measured(counter, async () => { const d = await call(`/api/runs/${runId}`); return { ok: d.failedStep !== null && new RegExp(truth.label, 'i').test(String(d.failedStep)) && d.problem?.code === truth.code, note: `${d.failedStep} / ${d.problem?.code}` }; }),
        T: await measured(counter, async () => { const g = await call(`/api/runs/${runId}/graph`); return { ok: g.summary.failing?.label === truth.label && g.summary.failing?.code === truth.code, note: `${g.summary.failing?.label} / ${g.summary.failing?.code}` }; }) });
    }
    // T3: what did step "a" (escalated) cost.
    const truthA = new Journal(store).forRun(costs).filter(r => r.nodeKey === 'root/a').reduce((s, r) => s + r.costUsd, 0);
    rows.push({ task: 'T3 what did step A cost', B0: await measured(counter, async () => { const d = await call(`/api/runs/${costs}`); return { ok: Math.abs(d.modelCalls.costUsd - truthA) < 1e-4, note: `run total only: $${d.modelCalls.costUsd.toFixed(4)}` }; }),
      T: await measured(counter, async () => { const g = await call(`/api/runs/${costs}/graph`); const c = g.graph.cards.find(x => x.members.includes('a')).cost.usd; return { ok: Math.abs(c - truthA) < 1e-9, note: `$${c}` }; }) });
    // T5: from the list, which recent run failed and why.
    const lastFailed = failed.S12;
    rows.push({ task: 'T5 which recent run failed and why (list)', B0: await measured(counter, async () => { const o = await call('/api/overview'); const r = o.runs.find(x => x.status === 'failed'); return { ok: r?.runId === lastFailed && /rate|service|model/i.test(r.problem?.what ?? ''), note: `${r?.flowId}: ${r?.problem?.what}` }; }),
      T: await measured(counter, async () => { const h = await call('/api/history'); const r = h.runs.find(x => x.state === 'problem'); return { ok: r?.runId === lastFailed && r.failingStep === 'Translate' && /not the workflow/.test(r.cause), note: r?.oneLine }; }) });
    // T6 (negative): with nothing waiting, both must say "nothing".
    rows.push({ task: 'T6a nothing waiting: say no', B0: await measured(counter, async () => ({ ok: (await call('/api/overview')).inbox.count === 0 })), T: await measured(counter, async () => ({ ok: (await call('/api/tasks')).total === 0 })) });
    // T6b and T4: questions inside a map wait for a person; then answer one.
    const s9 = await start(NAMED['S9-question-in-map']().workflow, NAMED['S9-question-in-map']().input);
    rows.push({ task: 'T6b two questions wait (in a map): say yes, 2', B0: await measured(counter, async () => { const n = (await call('/api/overview')).inbox.count; return { ok: n === 2, note: `count ${n}` }; }), T: await measured(counter, async () => { const n = (await call('/api/tasks')).total; return { ok: n === 2, note: `count ${n}` }; }) });
    const s3 = await start(NAMED['S3-question']().workflow);
    rows.push({ task: 'T4 answer the refund question', B0: await measured(counter, async () => { await call('/api/overview'); return { ok: false, note: 'no route answers a human-node question' }; }),
      T: await measured(counter, async () => { const t = await call('/api/tasks'), q = t.tasks.find(x => x.runId === s3); const r = await call('/api/tasks/answer', { runId: s3, nodeKey: q.nodeKey, requestHash: q.requestHash, answer: { approve: true, note: 'ok' } });
        return { ok: r.run?.status === 'succeeded' && store.events(s3).filter(e => e.type === 'human.answered').length === 1 }; }) });
    // T2: approve the waiting send (two separate workspaces' worth of runs: one per arm).
    const sendB0 = await start({ ...NAMED['S2-approval']().workflow, id: 'SendB0' }), sendT = await start({ ...NAMED['S2-approval']().workflow, id: 'SendT' });
    const decided = id => store.events(id).filter(e => e.type === 'approval.decided' && e.approved === true).length === 1 && store.run(id).status === 'succeeded';
    rows.push({ task: 'T2 approve the waiting send', B0: await measured(counter, async () => { const o = await call('/api/overview'); const a = o.inbox.actions.find(x => x.runId === sendB0); await call('/api/decide', { kind: 'action', runId: sendB0, approvalId: a.approvalId, decision: 'approve' }); return { ok: decided(sendB0) }; }),
      T: await measured(counter, async () => { const t = await call('/api/tasks'); const a = t.tasks.find(x => x.runId === sendT); await call('/api/tasks/decide', { runId: sendT, approvalId: a.approvalId, decision: 'approve' }); return { ok: decided(sendT) }; }) });
    void s9;
  } finally { await ws.close(); }
  const sum = arm => ({ success: rows.filter(r => r[arm].ok).length, of: rows.length, requests: rows.reduce((s, r) => s + r[arm].requests, 0), bytes: rows.reduce((s, r) => s + r[arm].bytes, 0) });
  return { generatedAt: new Date().toISOString(), rows, total: { B0: sum('B0'), T: sum('T') } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: a } = parseArgs({ options: { out: { type: 'string' } } });
  const r = await personaApi();
  if (a.out) writeFileSync(a.out, `${JSON.stringify(r, null, 1)}\n`);
  for (const row of r.rows) console.log(`${row.task}\tB0 ${row.B0.ok ? 'ok' : 'FAIL'} ${row.B0.requests} req ${row.B0.bytes} B${row.B0.note ? ` (${row.B0.note})` : ''}\tT ${row.T.ok ? 'ok' : 'FAIL'} ${row.T.requests} req ${row.T.bytes} B${row.T.note ? ` (${row.T.note})` : ''}`);
  console.log(JSON.stringify(r.total));
}
