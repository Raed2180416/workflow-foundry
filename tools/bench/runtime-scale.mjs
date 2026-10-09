// Runtime and store scaling benchmark (research/review-20261007/04-efficiency-rust.md section 3; ROADMAP-AMENDMENTS R-9).
// Development/diagnostic: synthetic local capabilities and a scripted model provider. No network, no model.
//
// It reproduces the lane-4 scenarios (chains, fans and maps of task and agent nodes) and one store micro-benchmark (the cost of an update
// against the size of the run), and reports CPU time next to wall time: on a shared VM the wall time moves with other processes' load, the CPU time
// of this process does not (SQLite runs in-process, so its CPU is counted; only waiting for the disk is not).
//
//   node tools/bench/runtime-scale.mjs                          # all scenarios at their default sizes, 3 repeats, the current src/
//   SRC=/path/to/older/src node tools/bench/runtime-scale.mjs   # the same against another checkout's src/ (A/B)
//   SCENARIOS=map-task SIZES=100,1000 REPS=1 node tools/bench/runtime-scale.mjs
//   MICRO=1 node tools/bench/runtime-scale.mjs                  # also the store micro-benchmark (update cost vs run size)
//   JSON=out.json ...                                            # write the results as JSON too
//
// Environment: SRC (src directory, default ../../src), ROOT (where the scratch stores go, default the OS temp dir; use a disk, not tmpfs, for
// durable-write costs), SYNC (SQLite synchronous: FULL (the store's default), NORMAL or OFF), REPS, SCENARIOS, SIZES, MICRO, MICRO_ONLY.
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = path.resolve(process.env.SRC ?? fileURLToPath(new URL('../../src', import.meta.url)));
const load = name => import(pathToFileURL(path.join(SRC, name)).href);
const { Store } = await load('store.mjs');
const { Runtime } = await load('runtime.mjs');
const { createDefaultRegistry } = await load('capabilities.mjs');
const { validateWorkflow } = await load('validate.mjs');
const { loadPolicy } = await load('models/policy.mjs');
const { ModelPort } = await load('models/port.mjs');
const { Journal } = await load('journal.mjs');
const { ScriptedProvider } = await load('models/providers/scripted.mjs');

const ROOT = process.env.ROOT ?? tmpdir(), SYNC = process.env.SYNC ?? null, REPS = Number(process.env.REPS ?? 3);
const ref = $ref => ({ $ref });
const loaded = loadPolicy();
const base = (nodes, acceptance) => ({
  schemaVersion: '1.0', id: 'Bench', version: 1, title: 'Benchmark workflow', domain: 'diagnostic', goal: 'Measure runtime overhead with synthetic local inputs.',
  envelope: { assumptions: ['Synthetic'], risks: [], successCriteria: ['Runs to completion'] },
  budget: { maxSteps: 100000, maxConcurrency: 16, maxDurationMs: 600000, maxCost: 1 }, nodes, acceptance: acceptance ?? [{ op: 'exists', value: ref('input.x') }]
});
const task = (id, args = { value: 1 }, needs = []) => ({ id, kind: 'task', needs, description: `probe ${id}`, tool: 'probe.noop', args, timeoutMs: 5000, retry: { maxAttempts: 1 } });
const amount = { type: 'object', additionalProperties: false, required: ['amount'], properties: { amount: { type: 'number' } } };
const agent = (id, needs = [], inputRef = 'input.x') => ({ id, kind: 'agent', needs, description: 'Extract the amount', role: 'extract', instructions: 'Return the amount in USD as a number.',
  context: { inputs: [{ name: 'raw', ref: inputRef, render: 'text' }] }, returns: amount, model: { class: 'M', maxClass: 'M' }, checks: [{ op: 'gte', left: ref('output.amount'), right: 0 }] });
const map = (id, items, body) => ({ id, kind: 'map', needs: [], description: 'map', items, maxItems: 1000, body, concurrency: 16 });
const registry = () => {
  const r = createDefaultRegistry();
  r.register({ name: 'probe.noop', description: 'noop', version: '1', implementation: 'bench/noop', inputSchema: {}, outputSchema: {}, effects: 'none', risk: 'low', requiresApproval: false,
    maxTimeoutMs: 10000, cancellation: 'cooperative', cost: 0, execute: async args => ({ ok: true, ...(args && typeof args === 'object' ? { n: 1 } : {}) }) });
  return r;
};
const scenarios = {
  'chain-task': n => ({ wf: base(Array.from({ length: n }, (_, i) => task(`t${i}`, { value: i }, i ? [`t${i - 1}`] : []))), input: { x: 1 } }),
  'fan-task': n => ({ wf: base(Array.from({ length: n }, (_, i) => task(`t${i}`))), input: { x: 1 } }),
  'map-task': n => ({ wf: base([map('m', ref('input.items'), { nodes: [task('w', { value: ref('item') })], acceptance: [{ op: 'exists', value: ref('nodes.w.ok') }] })], [{ op: 'eq', left: ref('nodes.m.count'), right: n }]),
    input: { x: 1, items: Array.from({ length: n }, (_, i) => i) } }),
  'fan-agent': n => ({ wf: base(Array.from({ length: n }, (_, i) => agent(`a${i}`)), null), input: { x: 'five dollars' } }),
  'chain-agent': n => ({ wf: base(Array.from({ length: n }, (_, i) => agent(`a${i}`, i ? [`a${i - 1}`] : [])), null), input: { x: 'five dollars' } }),
  'map-agent': n => ({ wf: base([map('m', ref('input.items'), { nodes: [agent('a', [], 'item')], acceptance: [{ op: 'gte', left: ref('nodes.a.amount'), right: 0 }] })], [{ op: 'eq', left: ref('nodes.m.count'), right: n }]),
    input: { x: 1, items: Array.from({ length: n }, (_, i) => `row ${i}: five dollars`) } })
};
const sizes = { 'chain-task': [20, 100, 500], 'fan-task': [100, 500], 'map-task': [100, 300, 1000], 'fan-agent': [100, 500], 'chain-agent': [100, 500], 'map-agent': [100, 300, 1000] };

function make(workflow, input) {
  const dir = mkdtempSync(path.join(ROOT, 'foundry-bench-')), store = new Store(dir);
  if (SYNC) store.db.exec(`PRAGMA synchronous=${SYNC}`);
  const reg = registry(), provider = new ScriptedProvider(() => ({ value: { amount: 1 }, usage: { inputTokens: 100, outputTokens: 10 } }));
  const models = new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store), concurrency: { 'claude-cli': 64 } });
  const valid = validateWorkflow(workflow, { registry: reg, modelPolicy: loaded });
  if (!valid.valid) throw new Error(`invalid workflow: ${JSON.stringify(valid.errors.slice(0, 3))}`);
  store.saveWorkflow(workflow);
  const runtime = new Runtime(store, reg, { allowedCapabilities: reg.list().map(c => c.name), maxConcurrency: 16, maxSteps: 100000, maxCost: 1 }, { models, modelPolicy: loaded });
  return { dir, store, runtime, run: runtime.create(workflow, input), cleanup: () => { try { store.close(); } catch { /* closed */ } rmSync(dir, { recursive: true, force: true }); } };
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const cpuMs = (a, b) => (b.user - a.user + b.system - a.system) / 1000;
// What the run occupies in the database, in KiB: the run header plus every run-state table that exists (the whole-run store has only `runs`).
function stateKiB(store, id) {
  const tables = new Set(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  const one = sql => store.db.prepare(sql).get(id).n ?? 0;
  let bytes = one('SELECT length(body) AS n FROM runs WHERE id=?');
  if (tables.has('run_input')) bytes += one('SELECT length(body) AS n FROM run_input WHERE run_id=?');
  if (tables.has('run_frames')) bytes += one('SELECT SUM(length(body)) AS n FROM run_frames WHERE run_id=?');
  if (tables.has('run_nodes')) bytes += one('SELECT SUM(COALESCE(length(body),0)+COALESCE(length(output),0)) AS n FROM run_nodes WHERE run_id=?');
  return Math.round(bytes / 1024);
}

const results = [];
console.log(`# runtime-scale  src=${SRC}  synchronous=${SYNC ?? 'FULL(default)'}  root=${ROOT}  node=${process.version}  load=${readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ')}  ${new Date().toISOString()}`);
if (!process.env.MICRO_ONLY) {
  const only = process.env.SCENARIOS?.split(','), wanted = process.env.SIZES?.split(',').map(Number);
  console.log(['scenario'.padEnd(12), 'n'.padStart(5), 'wall ms (min..p50)'.padEnd(22), 'cpu ms p50'.padEnd(11), 'wall ms/node'.padEnd(13), 'cpu ms/node'.padEnd(12), 'events'.padStart(6), 'stateKiB'.padStart(8), 'rssMB'.padStart(6), 'status'].join(' '));
  for (const [name, build] of Object.entries(scenarios)) {
    if (only && !only.includes(name)) continue;
    for (const n of sizes[name].filter(size => !wanted || wanted.includes(size)).concat(wanted?.filter(size => !sizes[name].includes(size)) ?? [])) {
      const walls = [], cpus = []; let last = null, status = '';
      for (let r = 0; r < (n >= 1000 ? Math.min(REPS, 2) : REPS); r++) {
        const { wf, input } = build(n), h = make(wf, input);
        const c0 = process.cpuUsage(), t0 = performance.now();
        const run = await h.runtime.execute(h.run.id);
        const wall = performance.now() - t0, cpu = cpuMs(c0, process.cpuUsage());
        status = run.status + (run.error ? `:${run.error.code}` : '');
        if (run.status !== 'succeeded') { console.log(`  !! ${name} ${n}: ${status} ${run.error?.message?.slice(0, 160) ?? ''}`); h.cleanup(); break; }
        walls.push(wall); cpus.push(cpu);
        last = { events: h.store.db.prepare('SELECT COUNT(*) AS c FROM events WHERE run_id=?').get(h.run.id).c, stateKiB: stateKiB(h.store, h.run.id), rssMB: Math.round(process.memoryUsage().rss / 1048576) };
        h.cleanup();
      }
      if (!walls.length) { console.log(name.padEnd(12), String(n).padStart(5), status); continue; }
      const row = { scenario: name, n, wallMsMin: +Math.min(...walls).toFixed(1), wallMsP50: +median(walls).toFixed(1), cpuMsP50: +median(cpus).toFixed(1),
        wallMsPerNode: +(median(walls) / n).toFixed(3), cpuMsPerNode: +(median(cpus) / n).toFixed(3), ...last, repeats: walls.length, status };
      results.push(row);
      console.log([name.padEnd(12), String(n).padStart(5), `${row.wallMsMin}..${row.wallMsP50}`.padEnd(22), String(row.cpuMsP50).padEnd(11), String(row.wallMsPerNode).padEnd(13), String(row.cpuMsPerNode).padEnd(12), String(last.events).padStart(6), String(last.stateKiB).padStart(8), String(last.rssMB).padStart(6), status].join(' '));
    }
  }
}
// The store alone: grow one run to a given number of node rows (a node state and an output each, about 400 bytes together), then time updates
// that touch ONE node. A store whose update cost depends on the size of the run shows it here without any runtime around it.
if (process.env.MICRO || process.env.MICRO_ONLY) {
  console.log('\n# store micro-benchmark: updateRun touching one node of a run with N nodes (p50 of 40 updates). `header` = updateRun(..., { result: \'header\' }), what the runtime\'s');
  console.log('# loop uses; `record` = the default, which also returns the whole run record (the CLI prints it). The whole-run store ignores the option and always returns the record.');
  console.log(['nodes'.padStart(6), 'stateKiB'.padStart(9), 'header wall ms'.padEnd(15), 'header cpu ms'.padEnd(14), 'record wall ms'.padEnd(15), 'store.run() ms'].join(' '));
  const wf = { ...base([{ id: 'a', kind: 'assert', needs: [], description: 'd', checks: [{ op: 'exists', value: ref('input.x') }] }]) };
  for (const nodes of [100, 1000, 5000, 10000]) {
    const dir = mkdtempSync(path.join(ROOT, 'foundry-bench-')), store = new Store(dir);
    if (SYNC) store.db.exec(`PRAGMA synchronous=${SYNC}`);
    store.saveWorkflow(wf);
    const run = new Runtime(store, createDefaultRegistry(), { allowedCapabilities: [] }).create(wf, { x: 1 });
    for (let from = 0; from < nodes; from += 500) {
      store.updateRun(run.id, r => { for (let i = from; i < Math.min(nodes, from + 500); i++) { r.nodes[`n${i}`] = { kind: 'task', status: 'completed', attempts: 1, note: 'x'.repeat(120) }; r.outputs[`n${i}`] = { value: i, pad: 'y'.repeat(120) }; } }, { type: 'bench.grow', from });
    }
    const wall = [], cpu = [], full = [], reads = [];
    for (let i = 0; i < 40; i++) {
      const c0 = process.cpuUsage(), t0 = performance.now();
      store.updateRun(run.id, r => { r.nodes.n7.attempts = i + 2; r.steps++; }, { type: 'bench.tick', i }, { result: 'header' });
      wall.push(performance.now() - t0); cpu.push(cpuMs(c0, process.cpuUsage()));
    }
    for (let i = 0; i < 20; i++) { const t0 = performance.now(); store.updateRun(run.id, r => { r.nodes.n7.attempts = i + 100; r.steps++; }, { type: 'bench.tick', i }); full.push(performance.now() - t0); }
    for (let i = 0; i < 10; i++) { const t0 = performance.now(); store.run(run.id); reads.push(performance.now() - t0); }
    const row = { micro: 'update-one-node', nodes, stateKiB: stateKiB(store, run.id), headerUpdateWallMsP50: +median(wall).toFixed(3), headerUpdateCpuMsP50: +median(cpu).toFixed(3), recordUpdateWallMsP50: +median(full).toFixed(2), wholeRunReadMsP50: +median(reads).toFixed(2) };
    results.push(row);
    console.log([String(nodes).padStart(6), String(row.stateKiB).padStart(9), String(row.headerUpdateWallMsP50).padEnd(15), String(row.headerUpdateCpuMsP50).padEnd(14), String(row.recordUpdateWallMsP50).padEnd(15), row.wholeRunReadMsP50].join(' '));
    store.close(); rmSync(dir, { recursive: true, force: true });
  }
}
if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify({ src: SRC, synchronous: SYNC ?? 'FULL', node: process.version, at: new Date().toISOString(), results }, null, 1));
