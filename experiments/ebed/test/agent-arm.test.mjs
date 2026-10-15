import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { createHost } from '../../../beds/ebed/host/host.mjs';
import { agentArm } from '../agent-arm.mjs';
import { contractText } from '../build.mjs';

// A scripted "agent": reads task.json, asks the platform through ctx.mjs (the real mailbox, a real child process),
// declares the order id of an order.placed event as its subject and writes output.json. No model is called.
function scripted(log) {
  return async ({ workdir, files, budgetUsd }) => {
    const input = JSON.parse(readFileSync(path.join(workdir, 'task.json'), 'utf8'));
    for (const f of ['SPEC-E.md', 'CONTRACT.md', 'ctx.mjs', 'files/api/orders.schema.json']) assert.ok(existsSync(path.join(workdir, f)), f);
    const placed = input.events.find(e => e.type === 'order.placed' || e.payload?.orderId);
    const subject = placed?.payload?.orderId ?? input.carry?.subject ?? null;
    // ctx.mjs runs as a separate process and blocks on the mailbox; run it asynchronously so the adapter can serve it.
    const { spawn } = await import('node:child_process');
    const rows = await new Promise((res, rej) => { const c = spawn(process.execPath, ['ctx.mjs', 'query', 'orders.orders', '{"limit":5}'], { cwd: workdir }); let o = ''; c.stdout.on('data', d => { o += d; }); c.on('close', code => (code === 0 ? res(JSON.parse(o)) : rej(new Error('ctx.mjs failed')))); });
    log.push({ instance: input.instance, rows: rows.length, budgetUsd });
    writeFileSync(path.join(workdir, 'output.json'), JSON.stringify({ decisions: { subject }, effects: [], carry: { subject } }));
    return { costUsd: 0.01, turns: 3, error: null };
  };
}

test('agent arm: each tick is one session; ctx reads go through the mailbox; costs are recorded from the session report', async () => {
  const work = mkdtempSync(path.join(os.tmpdir(), 'agent-arm-'));
  const log = [];
  const journal = path.join(work, 'ticks.jsonl');
  const arm = agentArm({ id: 'agent-H-test', model: 'claude-haiku-5-5', workRoot: path.join(work, 'w'), contract: contractText(), runner: scripted(log), journal, budgetUsdPerTick: 0.4 });
  const w = e8.generateWorld({ seed: 1235, difficulty: 2, mix: 'tail', size: 4 });
  const host = createHost({ item: e8.binding, world: w, arm, callTimeoutMs: 60_000, maxWakeups: 40 });
  try { await host.run(); } catch (e) { assert.match(String(e.message), /wake-ups/); }
  const calls = host.journal.contentRows().filter(r => r.type === 'call');
  assert.ok(calls.length > 0 && log.length === calls.length, `${calls.length} calls, ${log.length} logged, first error ${JSON.stringify(calls.find(c => c.outcome !== "ok")?.error)}`);
  assert.ok(calls.every(c => c.outcome === 'ok'), JSON.stringify(calls.find(c => c.outcome !== 'ok')?.error));
  assert.ok(calls.every(c => c.costs.length === 1 && c.costs[0].costUsd === 0.01 && c.costs[0].source === 'executor:claude-code'));
  assert.equal(readFileSync(journal, 'utf8').trim().split('\n').length, calls.length);
  assert.ok(log.every(l => l.budgetUsd === 0.4));
});

test('agent arm: a session that writes no output.json is an arm crash, and its cost is still recorded', async () => {
  const work = mkdtempSync(path.join(os.tmpdir(), 'agent-arm-'));
  const arm = agentArm({ id: 'agent-H-test', model: 'claude-haiku-5-5', workRoot: work, contract: 'c', runner: async () => ({ costUsd: null, error: 'EXECUTOR_TIMEOUT' }) });
  const costs = [];
  const ctx = { files: { 'spec/SPEC-E.md': 'spec' }, recordCost: c => costs.push(c), query() { return []; }, status() { return 'not-found'; }, instances() { return []; } };
  await assert.rejects(arm.tick({ kind: 'case', instance: 'i-1', now: 'x', events: [], carry: null }, ctx), /no output\.json/);
  assert.equal(costs.length, 1);
  assert.equal(costs[0].costUnknown, true);
  assert.equal(costs[0].costUpperUsd, 0.5);
});

// MEM-0 M1 (MEMORY-ROUTING-RECURSION §3.2): the workspace was copied in and out whole on every tick, so one case's notes
// reached every other case. Default now: a workspace per instance; 'arm' (agent-H-ws) keeps the shared one on purpose.
test('M1: by default a session sees only its own instance\'s workspace; workspaceScope arm (agent-H-ws) shares it across instances', async () => {
  const { readdirSync } = await import('node:fs');
  const tickWith = async (scope, instances) => {
    const work = mkdtempSync(path.join(os.tmpdir(), 'agent-arm-ws-'));
    const seen = [], prompts = [];
    const runner = async ({ workdir, prompt }) => {
      const input = JSON.parse(readFileSync(path.join(workdir, 'task.json'), 'utf8'));
      const ws = path.join(workdir, 'ws');
      seen.push({ instance: input.instance, files: existsSync(ws) ? readdirSync(ws).sort() : null }); prompts.push(prompt);
      writeFileSync(path.join(ws, `note-${input.instance}.txt`), `notes on ${input.instance}`);
      writeFileSync(path.join(workdir, 'output.json'), JSON.stringify({ decisions: { subject: input.instance }, effects: [], carry: null }));
      return { costUsd: 0, turns: 1, error: null };
    };
    const arm = agentArm({ id: 'ws-test', model: 'claude-haiku-5-5', workRoot: path.join(work, 'w'), contract: 'c', runner, ...(scope ? { workspaceScope: scope } : {}) });
    const workspace = path.join(work, 'ws'); mkdirSync(workspace, { recursive: true });
    const ctx = { files: {}, workspace, recordCost() {}, query() { return []; }, status() { return 'not-found'; }, instances() { return []; } };
    for (const instance of instances) await arm.tick({ kind: 'case', instance, now: 'x', events: [], carry: null }, ctx);
    return { seen, prompts };
  };
  const own = await tickWith(null, ['A', 'B', 'A']);
  assert.deepEqual(own.seen, [{ instance: 'A', files: [] }, { instance: 'B', files: [] }, { instance: 'A', files: ['note-A.txt'] }], 'B never sees A\'s notes; A keeps its own');
  assert.match(own.prompts[0], /across this instance's ticks/);
  const shared = await tickWith('arm', ['A', 'B', 'A']);
  assert.deepEqual(shared.seen.map(s => s.files), [[], ['note-A.txt'], ['note-A.txt', 'note-B.txt']], 'agent-H-ws: one workspace across instances');
  assert.match(shared.prompts[0], /across ticks and instances/);
  assert.throws(() => agentArm({ id: 'x', model: 'claude-haiku-5-5', workRoot: os.tmpdir(), contract: 'c', workspaceScope: 'run' }), /workspaceScope/);
});

test('the arm cap freezes the stream (QuotaStop) and grading treats the open cases as censored', async () => {
  const { capped, summarize } = await import('../run-agent.mjs');
  const work = mkdtempSync(path.join(os.tmpdir(), 'agent-arm-'));
  const log = [];
  const arm = capped(agentArm({ id: 'agent-H-cap', model: 'claude-haiku-5-5', workRoot: work, contract: 'c', runner: scripted(log) }), 0.03);
  const w = e8.generateWorld({ seed: 1235, difficulty: 2, mix: 'tail', size: 4 });
  const host = createHost({ item: e8.binding, world: w, arm, callTimeoutMs: 60_000 });
  const r = await host.run();
  assert.equal(r.status, 'frozen');
  assert.ok(arm.spent.usd >= 0.03 && arm.spent.usd < 0.03 + 0.01 * 4 + 1e-9, `spent ${arm.spent.usd}`);
  const { pools } = await e8.referenceRuns(w);
  const s = summarize(w, host.journal.contentRows(), pools, 'agent-H-cap');
  assert.equal(s.passed, 0);
  assert.ok(s.ticks >= 3);
});
