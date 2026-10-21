// Shared pieces of the orchestration chaos suite (experiments/orch/chaos.mjs). Everything here is $0: synthetic
// capabilities, a scripted model provider, temporary workspaces. Development/diagnostic evidence, not sealed evaluation.
//
//   probeRegistry({ effectsFile })  capabilities with observable side effects (an append-only ledger file):
//     chaos.work    effects none          {id, ms?, fail?, bytes?}       cooperative sleep; returns {id, pad?}
//     chaos.idem    effects idempotent    {id, ms?}                      appends {kind:'idem', id, key} to the ledger
//     chaos.effect  effects non-idempotent {id, ms?}                     appends {kind:'effect', id} to the ledger
//     chaos.deaf    effects none          {id, ms}                       ignores its abort signal
//     chaos.selfkill effects idempotent   {id}                           SIGKILLs its own process (a crash loop / OOM stand-in)
//     chaos.gated   effects non-idempotent, requiresApproval              appends {kind:'gated', id}
//   wf(id, nodes, acceptance, budget)  a workflow skeleton
//   scriptedPort(store, script, opts)  a ModelPort over ScriptedProvider for both providers of the owner policy
//   ledger(file)                       the effect ledger's lines
//   tmp(prefix)                        a temporary directory (removed by cleanup())
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDefaultRegistry } from '../../../src/capabilities.mjs';
import { FoundryError } from '../../../src/data.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';

export const ROOT = new URL('../../../', import.meta.url).pathname;
export const ORCH = new URL('../', import.meta.url).pathname;
export const POLICY = loadPolicy();
export const HAIKU = 'claude-haiku-5-5', SONNET = 'claude-sonnet-5-5', LOCAL = 'qwen3.5-4b-q4km';

const made = [];
export function tmp(prefix = 'orch-') {
  const dir = mkdtempSync(path.join(process.env.ORCH_TMP ?? tmpdir(), prefix));
  made.push(dir);
  return dir;
}
export function cleanup() { for (const d of made.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch {} } }

// One fsync'd line per effect: the ledger is the "outside world" a crash cannot roll back.
export function appendDurable(file, row) {
  const fd = openSync(file, 'a');
  try { writeSync(fd, JSON.stringify(row) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
}
export const ledger = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { torn: l }; } }) : []);

const sleep = (ms, signal) => delay(ms, undefined, { signal }).catch(error => { throw Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR', cause: error }); });

export function probeRegistry({ effectsFile = null, stats = { active: 0, peak: 0, started: 0, aborted: 0 } } = {}) {
  const registry = createDefaultRegistry();
  const note = row => { if (effectsFile) appendDurable(effectsFile, { ...row, pid: process.pid, at: Date.now() }); };
  const track = async (fn, signal) => {
    stats.active++; stats.started++; stats.peak = Math.max(stats.peak, stats.active);
    try { return await fn(); } catch (error) { if (signal?.aborted) stats.aborted++; throw error; } finally { stats.active--; }
  };
  const common = { version: '1', inputSchema: {}, outputSchema: {}, risk: 'low', requiresApproval: false, maxTimeoutMs: 3600000, cancellation: 'cooperative', cost: 0 };
  registry.register({ ...common, name: 'chaos.work', description: 'Synthetic work', implementation: 'orch/chaos.work', effects: 'none',
    execute: (args, { signal }) => track(async () => {
      if (args.ms) await sleep(args.ms, signal);
      if (args.fail) throw new FoundryError('PROBE_FAILED', `synthetic failure of ${args.id}`);
      return { id: args.id, ...(args.bytes ? { pad: 'x'.repeat(args.bytes) } : {}) };
    }, signal) });
  registry.register({ ...common, name: 'chaos.idem', description: 'Synthetic idempotent effect', implementation: 'orch/chaos.idem', effects: 'idempotent',
    execute: (args, { signal, idempotencyKey }) => track(async () => {
      if (args.ms) await sleep(args.ms, signal);
      note({ kind: 'idem', id: args.id, key: idempotencyKey });
      return { id: args.id, applied: true };
    }, signal) });
  registry.register({ ...common, name: 'chaos.effect', description: 'Synthetic non-idempotent effect', implementation: 'orch/chaos.effect', effects: 'non-idempotent',
    execute: (args, { signal, idempotencyKey }) => track(async () => {
      if (args.ms) await sleep(args.ms, signal);
      note({ kind: 'effect', id: args.id, key: idempotencyKey });
      return { id: args.id, applied: true };
    }, signal) });
  registry.register({ ...common, name: 'chaos.deaf', description: 'Synthetic work that ignores cancellation', implementation: 'orch/chaos.deaf', effects: 'none', cancellation: 'none',
    execute: args => track(async () => { await delay(args.ms ?? 1000); stats.deafFinished = (stats.deafFinished ?? 0) + 1; return { id: args.id }; }) });
  registry.register({ ...common, name: 'chaos.selfkill', description: 'Kills its own process (crash loop stand-in)', implementation: 'orch/chaos.selfkill', effects: 'idempotent',
    execute: args => { note({ kind: 'selfkill', id: args.id }); process.kill(process.pid, 'SIGKILL'); return new Promise(() => {}); } });
  registry.register({ ...common, name: 'chaos.gated', description: 'Synthetic gated effect', implementation: 'orch/chaos.gated', effects: 'non-idempotent', requiresApproval: true,
    execute: (args, { idempotencyKey }) => { note({ kind: 'gated', id: args.id, key: idempotencyKey }); return { id: args.id, applied: true }; } });
  return { registry, stats };
}

export const ref = $ref => ({ $ref });
export const eq = (left, right) => ({ op: 'eq', left, right });
export const exists = value => ({ op: 'exists', value });
export const task = (id, tool, args = {}, { needs = [], timeoutMs = 60000, maxAttempts = 1, backoffMs, onError } = {}) =>
  ({ id, kind: 'task', needs, description: `Synthetic ${id}`, tool, args: { id, ...args }, timeoutMs, retry: { maxAttempts, ...(backoffMs ? { backoffMs } : {}) }, ...(onError ? { onError } : {}) });
export const mapNode = (id, items, body, { concurrency = 4, maxItems = 1000, failure, needs = [] } = {}) =>
  ({ id, kind: 'map', needs, description: `Synthetic fan-out ${id}`, items, maxItems, concurrency, body, ...(failure ? { failure } : {}) });
export const agentNode = (id, { model = HAIKU, returns = { type: 'object', required: ['v'], properties: { v: { type: 'number' } }, additionalProperties: false }, input = 'input.raw', needs = [], timeoutMs } = {}) =>
  ({ id, kind: 'agent', needs, description: `Synthetic judgment ${id}`, role: 'extract', instructions: 'Return the number as v.',
    context: { inputs: [{ name: 'raw', ref: input, render: 'text' }] }, returns, model: { id: model }, ...(timeoutMs ? { timeoutMs } : {}) });
export const wf = (id, nodes, acceptance = [], budget = {}) => ({
  schemaVersion: '1.0', id, version: 1, title: `Chaos ${id}`, domain: 'diagnostic', goal: 'Exercise an orchestration invariant under an injected fault, with synthetic capabilities.',
  envelope: { assumptions: ['Synthetic local capabilities only'], risks: [], successCriteria: ['The scenario invariant holds.'] },
  budget: { maxSteps: 20000, maxConcurrency: 16, maxDurationMs: 3600000, maxCost: 5, ...budget }, nodes, acceptance,
});

// A ModelPort whose providers (both kinds in the owner policy) are one ScriptedProvider.
export function scriptedPort(store, script, { concurrency = {}, timeoutMs } = {}) {
  const provider = script instanceof ScriptedProvider ? script : new ScriptedProvider(script);
  const port = new ModelPort({ policy: POLICY.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store), concurrency, ...(timeoutMs ? { timeoutMs } : {}) });
  return { port, provider };
}

export const wait = (ms) => delay(ms);
export async function until(predicate, ms = 20000, every = 20) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await predicate(); if (v) return v; await delay(every); }
  return predicate();
}
export const procAlive = pid => { try { process.kill(pid, 0); } catch (e) { return e.code !== 'ESRCH'; } try { const s = readFileSync(`/proc/${pid}/stat`, 'utf8'); return !/^\d+ \(.*\) [ZX] /.test(s); } catch { return true; } };
export const procRows = () => {
  const out = [];
  let names = []; try { names = readdirSync('/proc'); } catch {}
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const text = readFileSync(`/proc/${name}/stat`, 'utf8'), f = text.slice(text.lastIndexOf(')') + 2).split(' ');
      let cmd = ''; try { cmd = readFileSync(`/proc/${name}/cmdline`, 'utf8').replaceAll('\0', ' ').trim(); } catch {}
      out.push({ pid: Number(name), state: f[0], ppid: Number(f[1]), pgid: Number(f[2]), cmd });
    } catch {}
  }
  return out;
};
/** Live processes whose command line contains `marker` (zombies excluded). */
export const withMarker = marker => procRows().filter(p => p.state !== 'Z' && p.cmd.includes(marker) && p.pid !== process.pid);
/** Every live descendant of pid (children, grandchildren ...), zombies excluded. */
export function descendants(pid, table = procRows()) {
  const out = [], queue = [pid];
  while (queue.length) { const p = queue.pop(); for (const c of table.filter(x => x.ppid === p)) { if (c.state !== 'Z') out.push(c); queue.push(c.pid); } }
  return out;
}
/** Live members of the given process groups. */
export const groupLive = (pgids, table = procRows()) => table.filter(p => p.state !== 'Z' && pgids.includes(p.pgid));
export function killMarked(marker) { for (const p of withMarker(marker)) { try { process.kill(p.pid, 'SIGKILL'); } catch {} } }
export const appendLine = (file, row) => appendFileSync(file, JSON.stringify(row) + '\n');
