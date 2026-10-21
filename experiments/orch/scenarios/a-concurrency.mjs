// Group (a): concurrency and dependencies. In-process src runtime runs and flow-v3 solvers as plain processes; $0.
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../../../src/store.mjs';
import { Runtime } from '../../../src/runtime.mjs';
import { validateWorkflow } from '../../../src/validate.mjs';
import { verifyRun } from '../../../src/verify-run.mjs';
import { exists, mapNode, probeRegistry, ref, task, tmp, wf, until, wait, eq } from '../lib/harness.mjs';
import { createRegistry, runSolver, stubPort } from '../lib/solver.mjs';

const runtimeFor = (workflow, { registry, policy = {}, now } = {}) => {
  const store = new Store(path.join(tmp('orch-a-'), 'ws'));
  store.saveWorkflow(workflow);
  const runtime = new Runtime(store, registry, { allowedCapabilities: registry.list().map(c => c.name), maxConcurrency: 16, maxCost: 5, ...policy }, { cancelPollMs: 25, cancelGraceMs: 300, ...(now ? { now } : {}) });
  return { store, runtime };
};
const close = store => { try { store.close(); } catch {} };

export default [
  {
    id: 'A1', group: 'a', title: 'src map fan-out of 1,000 items under a concurrency cap of 16',
    primitive: 'src/runtime.mjs Invocation.map + run-wide Semaphore', fault: 'scale: 1,000 items (the schema maximum), 5 ms each',
    invariant: 'all 1,000 complete; in-flight calls never exceed the cap and reach it; bounded memory; the record verifies',
    timeoutMs: 300000,
    async run() {
      const { registry, stats } = probeRegistry();
      const items = Array.from({ length: 1000 }, (_, i) => i);
      const workflow = wf('FanOut1000', [mapNode('each', ref('input.items'), { nodes: [task('w', 'chaos.work', { id: ref('item'), ms: 5 })], acceptance: [exists(ref('nodes.w.id'))] }, { concurrency: 16 })],
        [eq(ref('nodes.each.count'), 1000)], { maxConcurrency: 16 });
      const { store, runtime } = runtimeFor(workflow, { registry });
      const rss0 = process.memoryUsage().rss, t0 = Date.now();
      let peakRss = rss0;
      const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 200);
      const run = runtime.create(workflow, { items });
      let final;
      try { final = await runtime.execute(run.id); } finally { clearInterval(sampler); }
      const ms = Date.now() - t0, events = store.events(run.id).length, report = verifyRun(store, run.id);
      close(store);
      return { observed: { status: final.status, error: final.error?.code ?? null, ms, msPerItem: ms / 1000, events, peak: stats.peak, rssDeltaMb: Math.round((peakRss - rss0) / 1e6) },
        checks: [
          { name: 'run succeeded with 1,000 items', pass: final.status === 'succeeded', observed: `${final.status} ${final.error?.code ?? ''}` },
          { name: 'peak in-flight <= 16', pass: stats.peak <= 16, observed: stats.peak },
          { name: 'peak in-flight reaches the cap (work-conserving)', pass: stats.peak >= 12, observed: stats.peak },
          { name: 'memory growth < 512 MB', pass: peakRss - rss0 < 512e6, observed: `${Math.round((peakRss - rss0) / 1e6)} MB` },
          { name: 'verify-run ok', pass: report.ok, observed: (report.findings ?? []).filter(f => f.severity === 'error').map(f => f.code).slice(0, 5) },
          { name: 'per-item orchestration overhead < 50 ms', pass: ms / 1000 < 50, observed: `${(ms / 1000).toFixed(1)} ms/item, ${events} events`, info: true },
        ] };
    },
  },
  {
    id: 'A2', group: 'a', title: 'flow-v3 fan-out of 1,000: wide refuses above 64, map runs 1,000 judge items under its cap',
    primitive: 'experiments/jit/flow-v3.mjs flow.wide / flow.map + gateway', fault: 'scale: 1,000 items',
    invariant: 'over-limit fan-out is a typed refusal, never a silent truncation; an accepted fan-out completes within its concurrency cap',
    timeoutMs: 180000,
    async run() {
      const port = stubPort(async () => { await wait(2); return { ok: true, value: { ok: true }, costUsd: 0 }; });
      const wide = await runSolver({ modelPort: port, source: `const flow = createFlow({ budgetUsd: 1 });
const items = Array.from({ length: 1000 }, (_, i) => i);
const out = await flow.wide('w', { items, worker: x => x * 2, reduce: (r, c) => c, budgetUsd: 0.5 });
flow.done(out);` });
      const map = await runSolver({ modelPort: port, source: `const flow = createFlow({ budgetUsd: 1 });
const items = Array.from({ length: 1000 }, (_, i) => i);
const out = await flow.map(items, i => flow.judge('j', { tiers: ['claude-haiku-5-5'], prompt: 'item ' + i, schema: { type: 'object' } }), { concurrency: 16 });
flow.done({ n: out.filter(Boolean).length });` });
      return { observed: { wide: { code: wide.code, deopt: wide.deopt && { kind: wide.deopt.kind, refused: wide.deopt.detail?.refused } }, map: { code: map.code, output: map.output, peak: port.peak, calls: port.calls.length, ms: map.exitedMs } },
        checks: [
          { name: 'wide over 64 items deopts with a typed fanout refusal', pass: wide.code === 75 && wide.deopt?.kind === 'wide' && wide.deopt?.detail?.refused === 'fanout', observed: `exit ${wide.code} ${JSON.stringify(wide.deopt?.detail ?? null).slice(0, 120)}` },
          { name: 'map of 1,000 judges completes', pass: map.code === 0 && map.output?.n === 1000, observed: `exit ${map.code} ${JSON.stringify(map.output).slice(0, 80)} ${map.stderr.slice(-200)}` },
          { name: 'model calls in flight <= 16', pass: port.peak <= 16, observed: port.peak },
        ] };
    },
  },
  {
    id: 'A3', group: 'a', title: 'straggler in a map: one item hangs, others continue, the hang is bounded by its timeout',
    primitive: 'src runtime map (failure collect) + task timeoutMs/retry', fault: 'one of 12 items never returns (cooperative); node timeout 1.5 s, 2 attempts',
    invariant: 'siblings keep running while the straggler hangs; the straggler is bounded by timeout x attempts; the user sees which node is slow while it runs',
    timeoutMs: 60000,
    async run() {
      const { registry } = probeRegistry();
      const workflow = wf('Straggler', [mapNode('each', ref('input.items'), { nodes: [task('w', 'chaos.work', { id: ref('item.id'), ms: ref('item.ms') }, { timeoutMs: 1500, maxAttempts: 2 })], acceptance: [exists(ref('nodes.w.id'))] },
        { concurrency: 4, failure: 'collect' })], [exists(ref('nodes.each.count'))]);
      const { store, runtime } = runtimeFor(workflow, { registry });
      const items = Array.from({ length: 12 }, (_, i) => ({ id: i, ms: i === 1 ? 600000 : 60 }));
      const run = runtime.create(workflow, { items });
      const t0 = Date.now();
      const done = runtime.execute(run.id);
      // While it runs: is the straggler visible as a running node with a start time, and do siblings finish meanwhile?
      const seen = await until(() => {
        const rows = store.rows.withStatus(run.id, 'running').filter(r => r.frameKey.endsWith(':1'));
        return rows.length ? rows[0] : null;
      }, 3000);
      await wait(1200);
      const siblingsDone = store.events(run.id).filter(e => e.type === 'map.item.completed').length;
      const final = await done, ms = Date.now() - t0;
      const out = store.run(run.id);
      close(store);
      return { observed: { status: final.status, ms, siblingsDoneWhileHanging: siblingsDone, failedItems: out.nodes?.each?.failedItems ?? null, visible: seen ? { frameKey: seen.frameKey, startedAt: !!seen.state?.startedAt } : null },
        checks: [
          { name: 'straggler visible as running with a start time', pass: !!seen?.state?.startedAt, observed: seen ? seen.frameKey : 'not seen' },
          { name: 'siblings progressed while the straggler hung (>= 8 of 11)', pass: siblingsDone >= 8, observed: siblingsDone },
          { name: 'run ended within timeout x attempts + 2 s', pass: ms < 1500 * 2 + 2000, observed: `${ms} ms` },
          { name: 'collect mode: run succeeded with exactly 1 failed item', pass: final.status === 'succeeded' && (out.nodes?.each?.failedItems === 1), observed: `${final.status} failed=${out.nodes?.each?.failedItems}` },
        ] };
    },
  },
  {
    id: 'A4', group: 'a', title: 'deaf straggler: a capability that ignores its abort signal outlives its timeout',
    primitive: 'src runtime task timeout + abandonOnCancel', fault: 'pure capability (effects none) sleeps 3 s and never looks at its signal; node timeout 400 ms',
    invariant: 'when a run reports a terminal status, no work it started is still running; a pure capability that timed out is a retryable failure, not an effect of unknown outcome',
    timeoutMs: 30000,
    async run() {
      const { registry, stats } = probeRegistry();
      const workflow = wf('Deaf', [task('d', 'chaos.deaf', { ms: 3000 }, { timeoutMs: 400 })], [exists(ref('nodes.d.id'))]);
      const { store, runtime } = runtimeFor(workflow, { registry });
      const run = runtime.create(workflow, {});
      const t0 = Date.now();
      const final = await runtime.execute(run.id);
      const ms = Date.now() - t0, stillRunning = stats.active;
      await wait(3200);
      close(store);
      return { observed: { status: final.status, error: final.error?.code ?? null, returnedMs: ms, stillRunningAtReturn: stillRunning, finishedLater: stats.deafFinished ?? 0 },
        checks: [
          { name: 'run returns promptly (< 2 s)', pass: ms < 2000, observed: `${ms} ms` },
          { name: 'no work still running when the run reports its status', pass: stillRunning === 0, observed: `${stillRunning} capability call(s) still running after ${final.status}` },
          { name: 'pure timed-out call is not reported as an uncertain effect', pass: final.status !== 'uncertain', observed: final.status },
        ] };
    },
  },
  {
    id: 'A5', group: 'a', title: 'cyclic wait between two runs (each waits for the other\'s signal)',
    primitive: 'src runtime wait (signal) + foundry tick', fault: 'run A waits for b.done, run B waits for a.done; nobody can deliver',
    invariant: 'a signal wait cannot be unbounded; both runs end at their timers; while parked the record names what each waits for',
    timeoutMs: 30000,
    async run() {
      const { registry } = probeRegistry();
      const waiter = (id, signal) => wf(id, [{ id: 'w', kind: 'wait', needs: [], description: `wait for ${signal}`, signal, timeoutMs: 1200, onTimeout: 'fail' }, task('after', 'chaos.work', {}, { needs: ['w'] })],
        [exists(ref('nodes.after.id'))]);
      const unbounded = validateWorkflow({ ...waiter('Unbounded', 'x.done'), nodes: [{ id: 'w', kind: 'wait', needs: [], description: 'wait', signal: 'x.done' }] }, { registry });
      const A = waiter('CycleA', 'b.done'), B = waiter('CycleB', 'a.done');
      const { store, runtime } = runtimeFor(A, { registry });
      store.saveWorkflow(B);
      const ra = runtime.create(A, {}), rb = runtime.create(B, {});
      const pa = await runtime.execute(ra.id), pb = await runtime.execute(rb.id);
      const parked = store.rows.withStatus(ra.id, 'waiting');
      const names = parked.map(r => JSON.stringify(r.state).includes('b.done'));
      await wait(1400);
      const ticked = await runtime.tick({ now: Date.now() });
      const fa = store.run(ra.id), fb = store.run(rb.id);
      close(store);
      return { observed: { unboundedErrors: (unbounded.errors ?? []).map(e => e.code).slice(0, 3), parked: [pa.status, pb.status], final: [fa.status, fb.status], codes: [fa.error?.code, fb.error?.code], tick: ticked.runs.length },
        checks: [
          { name: 'validator refuses a signal wait without a timer', pass: !unbounded.valid && (unbounded.errors ?? []).some(e => /UNBOUNDED/.test(e.code)), observed: (unbounded.errors ?? []).map(e => e.code).slice(0, 3) },
          { name: 'both runs park waiting', pass: pa.status === 'waiting' && pb.status === 'waiting', observed: [pa.status, pb.status] },
          { name: 'the parked record names the awaited signal', pass: names.length > 0 && names.every(Boolean), observed: names },
          { name: 'both runs end at their timers (bounded)', pass: !['waiting', 'running'].includes(fa.status) && !['waiting', 'running'].includes(fb.status), observed: [fa.status, fb.status, fa.error?.code] },
          { name: 'the wait cycle itself is detected and reported', pass: false, observed: 'no cross-run wait graph exists; each run times out independently', info: true },
        ] };
    },
  },
  {
    id: 'A6', group: 'a', title: 'cycles: a needs-cycle in the IR and flow.call recursion A -> B -> A',
    primitive: 'src/validate.mjs DAG check; call-host recursion check', fault: 'cyclic dependency / recursive callee',
    invariant: 'a cycle is refused before anything runs, with a typed reason',
    timeoutMs: 30000,
    async run() {
      const { registry } = probeRegistry();
      const cyc = validateWorkflow(wf('Cycle', [task('a', 'chaos.work', {}, { needs: ['b'] }), task('b', 'chaos.work', {}, { needs: ['a'] })], [exists(ref('nodes.a.id'))]), { registry });
      const reg = createRegistry();
      const OUT = { type: 'object' };
      let bHash = null;
      const a = reg.register({ contract: { output: OUT, taskTemplate: 'a' }, stub: async (input, ctx) => ({ output: { b: await ctx.call({ v: 1, op: 'call', callee: bHash, input, name: 'b', budgetUsd: 0.1 }) } }) });
      const b = reg.register({ contract: { output: OUT, taskTemplate: 'b' }, stub: async (input, ctx) => ({ output: { a: await ctx.call({ v: 1, op: 'call', callee: a.hash, input, name: 'a2', budgetUsd: 0.05 }) } }) });
      bHash = b.hash;
      const r = await runSolver({ registry: reg, modelPort: stubPort(async () => ({ ok: true, value: {} })), source: `const flow = createFlow({ budgetUsd: 1 });
const out = await flow.call('${a.hash}', { x: 1 }, { name: 'a', budgetUsd: 0.5 });
flow.done(out);` });
      const refused = r.host.events.filter(e => e.kind === 'call-refused').map(e => e.refused);
      return { observed: { validator: (cyc.errors ?? []).map(e => e.code).slice(0, 3), refusals: refused, code: r.code },
        checks: [
          { name: 'IR needs-cycle refused by the validator', pass: !cyc.valid, observed: (cyc.errors ?? []).map(e => e.code).slice(0, 3) },
          { name: 'flow.call recursion refused (typed)', pass: refused.includes('recursion'), observed: refused },
        ] };
    },
  },
  {
    id: 'A7', group: 'a', title: 'user cancels mid-fan-out (200 items, 8 in flight) from another handle',
    primitive: 'Runtime.requestCancel + Invocation.watchCancel + map scope abort', fault: 'durable cancel request after ~30 items completed',
    invariant: 'no item starts after the cancel is seen; in-flight items are aborted; the run is cancelled within 1 s; completed work stays recorded; the chain verifies',
    timeoutMs: 60000,
    async run() {
      const { registry, stats } = probeRegistry();
      const workflow = wf('CancelFan', [mapNode('each', ref('input.items'), { nodes: [task('w', 'chaos.work', { id: ref('item'), ms: 80 })], acceptance: [exists(ref('nodes.w.id'))] }, { concurrency: 8 })],
        [exists(ref('nodes.each.count'))], { maxConcurrency: 8 });
      const { store, runtime } = runtimeFor(workflow, { registry, policy: { maxConcurrency: 8 } });
      const other = new Runtime(store, registry, { allowedCapabilities: registry.list().map(c => c.name), maxConcurrency: 8, maxCost: 5 });
      const run = runtime.create(workflow, { items: Array.from({ length: 200 }, (_, i) => i) });
      const done = runtime.execute(run.id);
      await until(() => store.events(run.id).filter(e => e.type === 'map.item.completed').length >= 30, 20000, 5);
      const t0 = Date.now();
      other.requestCancel(run.id, { actor: 'orch', reason: 'user stop' });
      const final = await done, stopMs = Date.now() - t0;
      const ev = store.events(run.id), cancelSeq = ev.find(e => e.type === 'cancel.requested')?.seq;
      const startedAfter = ev.filter(e => e.seq > cancelSeq && e.type === 'tool.intent').length;
      const completed = ev.filter(e => e.type === 'map.item.completed').length;
      const report = verifyRun(store, run.id);
      close(store);
      return { observed: { status: final.status, stopMs, startedAfterCancelEvent: startedAfter, completedItems: completed, aborted: stats.aborted, active: stats.active },
        checks: [
          { name: 'run cancelled', pass: final.status === 'cancelled', observed: final.status },
          { name: 'stopped within 1 s of the request', pass: stopMs < 1000, observed: `${stopMs} ms` },
          { name: 'no item started after the cancel was recorded', pass: startedAfter === 0, observed: startedAfter },
          { name: 'in-flight items aborted, none still running', pass: stats.active === 0 && stats.aborted > 0, observed: { aborted: stats.aborted, active: stats.active } },
          { name: 'completed items stay recorded', pass: completed >= 30, observed: completed },
          { name: 'verify-run ok', pass: report.ok, observed: (report.findings ?? []).filter(f => f.severity === 'error').map(f => f.code).slice(0, 5) },
        ] };
    },
  },
  {
    id: 'A8', group: 'a', title: 'backpressure: 64 agent nodes behind a provider limit of 2',
    primitive: 'ModelPort per-provider Semaphore under the run semaphore', fault: '64 model nodes ready at once, provider concurrency 2, 50 ms per call',
    invariant: 'provider calls in flight never exceed its limit; queued calls do not time out while queued; all complete',
    timeoutMs: 60000,
    async run() {
      const { registry } = probeRegistry();
      const { scriptedPort, agentNode, LOCAL } = await import('../lib/harness.mjs');
      const body = { nodes: [agentNode('j', { model: LOCAL, input: 'item' })], acceptance: [exists(ref('nodes.j.v'))] };
      const workflow = wf('Backpressure', [mapNode('each', ref('input.items'), body, { concurrency: 16 })], [eq(ref('nodes.each.count'), 64)]);
      const store = new Store(path.join(tmp('orch-a8-'), 'ws'));
      store.saveWorkflow(workflow);
      const { port, provider } = scriptedPort(store, () => ({ value: { v: 1 }, delayMs: 50 }), { concurrency: { 'llama-server': 2 }, timeoutMs: 400 });
      const { POLICY } = await import('../lib/harness.mjs');
      const runtime = new Runtime(store, registry, { allowedCapabilities: registry.list().map(c => c.name), maxConcurrency: 16, maxCost: 5 }, { models: port, modelPolicy: POLICY });
      const run = runtime.create(workflow, { items: Array.from({ length: 64 }, (_, i) => String(i)) });
      const final = await runtime.execute(run.id);
      close(store);
      return { observed: { status: final.status, error: final.error?.code ?? null, providerPeak: provider.maxActive, calls: provider.calls.length },
        checks: [
          { name: 'all 64 complete although the per-call timeout (400 ms) is shorter than the queue (64 x 50 ms / 2)', pass: final.status === 'succeeded', observed: `${final.status} ${final.error?.code ?? ''}` },
          { name: 'provider in flight <= 2', pass: provider.maxActive <= 2, observed: provider.maxActive },
        ] };
    },
  },
  {
    id: 'A9', group: 'a', title: 'single-flight: two identical flow.call requests in flight at once',
    primitive: 'call-host idempotency memo (callKeyOf)', fault: 'flow.map with concurrency 2 over two identical inputs to one callee',
    invariant: 'an identical call already in flight is joined, not executed twice (exactly-once execution per key)',
    timeoutMs: 30000,
    async run() {
      const reg = createRegistry();
      let runs = 0;
      const sum = reg.register({ contract: { output: { type: 'object' }, taskTemplate: 'sum' }, stub: async input => { runs++; await wait(300); return { output: { total: input.n }, costUsd: 0.05 }; } });
      const r = await runSolver({ registry: reg, modelPort: stubPort(async () => ({ ok: true, value: {} })), source: `const flow = createFlow({ budgetUsd: 1 });
const out = await flow.map([1, 1], () => flow.call('${sum.hash}', { n: 1 }, { name: 'sum', budgetUsd: 0.2 }), { concurrency: 2 });
flow.done({ out, spent: flow.spent() });` });
      return { observed: { code: r.code, runs, spent: r.output?.spent ?? null, memo: r.host.events.map(e => e.memo ?? null) },
        checks: [
          { name: 'callee executed once for two concurrent identical calls', pass: runs === 1, observed: `${runs} executions; memo ${JSON.stringify(r.host.events.map(e => e.memo ?? null))}` },
          { name: 'run completed', pass: r.code === 0, observed: r.code },
        ] };
    },
  },
];
