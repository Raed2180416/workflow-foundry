// Group (b): failure and recovery. Real processes: the owner is lib/owner.mjs, killed with SIGKILL at chosen moments.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../../../src/store.mjs';
import { Runtime } from '../../../src/runtime.mjs';
import { Journal } from '../../../src/journal.mjs';
import { agentNode, descendants, eq, exists, groupLive, HAIKU, ledger, LOCAL, mapNode, POLICY, procAlive, procRows, ref, scriptedPort, task, tmp, until, wait, wf, withMarker, probeRegistry } from '../lib/harness.mjs';
import { owner, prng, startOwner } from '../lib/proc.mjs';
import { createRegistry, runSolver, stubPort } from '../lib/solver.mjs';

const DAY = 86400000;
const codeNode = (id, source, args = {}, extra = {}) => ({ id, kind: 'code', needs: [], description: `Code ${id}`, lang: 'js', args, timeoutMs: 120000, source, ...extra });
const SPIN = 'export default function main(input) { const end = Date.now() + input.ms; while (Date.now() < end) {} return { ok: true }; }';

// The B1 workflow: 30 items, each an idempotent effect then pure work; after the map one non-idempotent effect.
const killWorkflow = () => wf('KillNine', [
  mapNode('each', ref('input.items'), { nodes: [task('idem', 'chaos.idem', { id: ref('item'), ms: 30 }, { maxAttempts: 5 }), task('w', 'chaos.work', { id: ref('item'), ms: 50 }, { needs: ['idem'], maxAttempts: 5 })],
    acceptance: [exists(ref('nodes.w.id'))] }, { concurrency: 4 }),
  task('final', 'chaos.effect', { id: 'final', ms: 40 }, { needs: ['each'] }),
], [eq(ref('nodes.each.count'), 30), exists(ref('nodes.final.applied'))]);

async function killLoop({ ws, effectsFile, runId, seed, maxKills = 8, killWindow = [0, 500], extraSpec = {} }) {
  const rand = prng(seed), log = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const o = startOwner({ workspace: ws, action: 'execute', runId, effectsFile, ...extraSpec });
    const started = await o.waitFor('executing', 20000);
    const killAt = killWindow[0] + Math.floor(rand() * (killWindow[1] - killWindow[0]));
    let killed = false;
    if (log.filter(l => l.killed).length < maxKills) {
      const timer = setTimeout(() => { killed = true; try { o.child.kill('SIGKILL'); } catch {} }, killAt);
      const r = await o.done; clearTimeout(timer);
      log.push({ attempt, started, killed: killed && r.signal === 'SIGKILL', killAt, result: r.lines.find(l => l.phase === 'result' || l.phase === 'error') ?? null });
    } else {
      const r = await o.done;
      log.push({ attempt, started, killed: false, result: r.lines.find(l => l.phase === 'result' || l.phase === 'error') ?? null });
    }
    const res = log.at(-1).result;
    if (res && (res.phase === 'error' || ['succeeded', 'failed', 'cancelled', 'uncertain'].includes(res.status))) break;
  }
  return log;
}

export default [
  {
    id: 'B1', group: 'b', title: 'kill -9 of the owner at random points, then resume, x3 seeds',
    primitive: 'src runtime lease + recover() + idempotencyKey + effect.uncertain', fault: 'SIGKILL of the orchestrator up to 8 times per seed during a 30-item fan-out with effects',
    invariant: 'resumable to the same result; each idempotent effect applied under one key (at-least-once delivery, exactly-once by key); the non-idempotent effect applied at most once and never silently repeated; the chain verifies',
    timeoutMs: 420000,
    async run() {
      const items = Array.from({ length: 30 }, (_, i) => i);
      // Reference: no faults.
      const refWs = path.join(tmp('orch-b1r-'), 'ws');
      const ref0 = await owner({ workspace: refWs, action: 'create-execute', workflow: killWorkflow(), input: { items } });
      const reference = ref0.result?.outputDigest;
      const seeds = [], checks = [];
      for (const seed of [11, 23, 47]) {
        const dir = tmp('orch-b1-'), ws = path.join(dir, 'ws'), effectsFile = path.join(dir, 'effects.jsonl');
        const created = await owner({ workspace: ws, action: 'create', workflow: killWorkflow(), input: { items } });
        const runId = created.lines[0].runId;
        const log = await killLoop({ ws, effectsFile, runId, seed });
        const final = log.at(-1).result;
        const verify = await owner({ workspace: ws, action: 'verify', runId });
        const fx = ledger(effectsFile), idem = fx.filter(r => r.kind === 'idem'), eff = fx.filter(r => r.kind === 'effect');
        const keys = new Set(idem.map(r => r.key)), ids = new Set(idem.map(r => r.id));
        seeds.push({ seed, kills: log.filter(l => l.killed).length, attempts: log.length, status: final?.status ?? final?.code, error: final?.error?.code ?? null, outputMatches: final?.outputDigest === reference,
          idemDeliveries: idem.length, idemKeys: keys.size, idemIds: ids.size, effectApplied: eff.length, verifyOk: verify.result?.ok, verifyFindings: (verify.result?.findings ?? []).map(f => f.code) });
      }
      for (const s of seeds) {
        const uncertainOk = s.status === 'uncertain' && s.effectApplied <= 1;
        checks.push({ name: `seed ${s.seed}: ended succeeded (or uncertain with the effect applied <= 1)`, pass: s.status === 'succeeded' || uncertainOk, observed: `${s.status} ${s.error ?? ''} after ${s.kills} kills` });
        if (s.status === 'succeeded') checks.push({ name: `seed ${s.seed}: same output as the fault-free run`, pass: s.outputMatches, observed: s.outputMatches });
        checks.push({ name: `seed ${s.seed}: 30 items applied, one key per item`, pass: s.idemIds === 30 && s.idemKeys === 30, observed: { ids: s.idemIds, keys: s.idemKeys, deliveries: s.idemDeliveries } });
        checks.push({ name: `seed ${s.seed}: non-idempotent effect applied <= 1`, pass: s.effectApplied <= 1 && (s.status !== 'succeeded' || s.effectApplied === 1), observed: s.effectApplied });
        checks.push({ name: `seed ${s.seed}: verify-run ok`, pass: !!s.verifyOk, observed: s.verifyFindings.slice(0, 4) });
      }
      return { observed: { reference: ref0.result?.status, seeds }, checks };
    },
  },
  {
    id: 'B2', group: 'b', title: 'orphaned sandbox after kill -9 of the owner: lifetime without and with a supervisor',
    primitive: 'src/children.mjs run_children + reapChildren (cancel/resume)', fault: 'owner SIGKILLed while a sandboxed busy loop (60 s) runs',
    invariant: 'no process a run started survives its owner by more than N s without human action; cancel/resume reap what is left',
    timeoutMs: 120000,
    async run() {
      const dir = tmp('orch-b2-'), ws = path.join(dir, 'ws');
      const workflow = wf('Orphan', [codeNode('spin', SPIN, { ms: 60000 })], [eq(ref('nodes.spin.ok'), true)]);
      const created = await owner({ workspace: ws, action: 'create', workflow });
      const runId = created.lines[0].runId;
      const o = startOwner({ workspace: ws, action: 'execute', runId });
      await o.waitFor('executing');
      const store = new Store(ws);
      const rows = await until(() => { const c = store.children(runId); return c.length ? c : null; }, 15000);
      store.close();
      const group = rows?.[0]?.pgid;
      // Kill only once the sandboxed code itself runs: an owner killed during sandbox setup takes the sandbox with it
      // (its READY line to the dead owner's stderr pipe raises SIGPIPE), which would hide the hazard.
      const running = await until(() => groupLive([group]).some(p => p.cmd.includes('--permission')), 15000);
      o.child.kill('SIGKILL'); await o.done;
      await wait(5000);
      const orphanAfter5s = group ? groupLive([group]).length : -1;
      const t0 = Date.now();
      const cancel = await owner({ workspace: ws, action: 'cancel', runId, cancel: { graceMs: 2000 } });
      const gone = await until(() => groupLive([group]).length === 0, 5000);
      return { observed: { recordedGroup: group ?? null, orphanAfter5s, cancel: cancel.result?.cancel ?? cancel.result, reapedMs: Date.now() - t0 },
        checks: [
          { name: 'the sandbox group was recorded while it ran', pass: !!group && !!running, observed: rows ?? null },
          { name: 'no orphan 5 s after the owner died, without human action', pass: orphanAfter5s === 0, observed: `${orphanAfter5s} sandbox process(es) of the dead owner still running (busy loop, CPU burning)` },
          { name: 'foundry cancel reaps the orphaned group', pass: !!gone, observed: gone ? 'reaped' : 'still running' },
        ] };
    },
  },
  {
    id: 'B3', group: 'b', title: 'orphaned experiment sandbox (runSandboxed: compiled solvers, call-host children) after kill -9 of its host',
    primitive: 'src/executors/sandboxed-command.mjs runSandboxed (used by run-compiled.mjs, call-host.mjs)', fault: 'host process SIGKILLed while its sandboxed solver runs',
    invariant: 'no sandboxed process survives its host by more than N s; something on record can find and stop it',
    timeoutMs: 60000,
    async run() {
      const work = path.join('/var/tmp/foundry-work', `orch-b3-${process.pid}-${Date.now()}`);
      mkdirSync(work, { recursive: true });
      const marker = `orchB3${Date.now()}`;
      const script = `import { runSandboxed } from ${JSON.stringify(new URL('../../../src/executors/sandboxed-command.mjs', import.meta.url).pathname)};
process.stdout.write('started\\n');
await runSandboxed({ command: 'sh', args: ['-c', 'exec sleep 300 # ${marker}'], workdir: ${JSON.stringify(work)}, timeoutMs: 290000, network: false });`;
      const host = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
      await new Promise(resolve => host.stdout.once('data', resolve));
      // Wait until the command itself runs (after the sandbox's setup): see B2 for why.
      const seen = await until(() => descendants(host.pid).some(p => p.cmd === 'sleep 300'), 10000);
      const tree = descendants(host.pid).map(p => p.pid);
      host.kill('SIGKILL');
      await new Promise(r => host.once('close', r));
      await wait(4000);
      const left = procRows().filter(p => p.state !== 'Z' && tree.includes(p.pid));
      for (const p of left) { try { process.kill(-p.pgid, 'SIGKILL'); } catch {} try { process.kill(p.pid, 'SIGKILL'); } catch {} }
      rmSync(work, { recursive: true, force: true });
      return { observed: { sawSandbox: !!seen, survivors: left.map(p => ({ pid: p.pid, ppid: p.ppid, cmd: p.cmd.slice(0, 80) })) },
        checks: [
          { name: 'the sandboxed command ran', pass: !!seen, observed: !!seen },
          { name: 'no sandboxed process survives its host after 4 s', pass: left.length === 0, observed: `${left.length} survivor(s), reparented to ppid ${[...new Set(left.map(p => p.ppid))].join(',')}; nothing records them (no trackChild)` },
        ] };
    },
  },
  {
    id: 'B4', group: 'b', title: 'child crash inside a fan-out of sandboxed code nodes (SIGABRT in item 2)',
    primitive: 'src runtime map (fail-fast and collect) + sandbox', fault: 'process.abort() in one of 6 sandboxed children',
    invariant: 'fail-fast: the run fails naming the item, siblings stop, no sandbox survives; collect: the run completes with exactly that item failed',
    timeoutMs: 120000,
    async run() {
      const src = 'export default function main(input) { if (input.i === 2) process.abort(); const end = Date.now() + 300; while (Date.now() < end) {} return { i: input.i }; }';
      const body = { nodes: [{ ...codeNode('c', src, { i: ref('item') }), timeoutMs: 30000 }], acceptance: [exists(ref('nodes.c.i'))] };
      const out = {};
      for (const failure of [undefined, 'collect']) {
        const ws = path.join(tmp('orch-b4-'), 'ws');
        const groups = new Set();
        let polling = true;
        const poll = (async () => { while (polling && !existsSync(path.join(ws, 'foundry.sqlite'))) await wait(20); while (polling) { try { const st = new Store(ws); for (const runRow of st.db.prepare('SELECT DISTINCT run_id FROM run_children').all()) for (const c of st.children(runRow.run_id)) groups.add(c.pgid); st.close(); } catch {} await wait(15); } })();
        const r = await owner({ workspace: ws, action: 'create-execute', workflow: wf(`Crash${failure ?? 'Fast'}`, [mapNode('each', ref('input.items'), body, { concurrency: 3, failure })], [exists(ref('nodes.each.count'))]),
          input: { items: [0, 1, 2, 3, 4, 5] } });
        polling = false; await poll;
        await wait(500);
        const store = new Store(ws); const runId = r.lines[0].runId; const run = store.run(runId); store.close();
        out[failure ?? 'fail-fast'] = { status: r.result?.status, error: r.result?.error && { code: r.result.error.code, message: r.result.error.message.slice(0, 80) }, failedItems: run.nodes?.each?.failedItems ?? null,
          groupsSeen: groups.size, sandboxesLeft: groupLive([...groups]).length };
      }
      const ff = out['fail-fast'], col = out.collect;
      return { observed: out,
        checks: [
          { name: 'fail-fast: run failed with the child\'s error', pass: ff.status === 'failed' && /CODE_ERROR|MAP/.test(ff.error?.code ?? ''), observed: ff.error },
          { name: 'collect: run succeeded with 1 failed item', pass: col.status === 'succeeded' && col.failedItems === 1, observed: `${col.status} failed=${col.failedItems}` },
          { name: 'no sandbox left running', pass: ff.sandboxesLeft === 0 && col.sandboxesLeft === 0, observed: [ff.sandboxesLeft, col.sandboxesLeft] },
        ] };
    },
  },
  {
    id: 'B5', group: 'b', title: 'duplicate signal delivery: one signal id delivered 20 times from 2 processes at once, plus a conflicting replay',
    primitive: 'Runtime.deliverSignal (signals table, inbox, chain)', fault: 'concurrent duplicate deliveries; same id with another payload',
    invariant: 'the wait consumes the signal exactly once; a same-id different-payload delivery is refused; the run completes with the first payload',
    timeoutMs: 60000,
    async run() {
      const ws = path.join(tmp('orch-b5-'), 'ws');
      const workflow = wf('DupSignal', [{ id: 'pay', kind: 'wait', needs: [], description: 'wait for payment', signal: 'payment.settled', timeoutMs: 600000,
        schema: { type: 'object', required: ['amount'], properties: { amount: { type: 'number' } } } }, task('after', 'chaos.work', {}, { needs: ['pay'] })], [exists(ref('nodes.after.id'))]);
      const created = await owner({ workspace: ws, action: 'create-execute', workflow });
      const runId = created.lines[0].runId;
      const signal = { id: 'sig-1', name: 'payment.settled', payload: { amount: 42 } };
      const [a, b] = await Promise.all([owner({ workspace: ws, action: 'signal', runId, signal, repeat: 10 }), owner({ workspace: ws, action: 'signal', runId, signal, repeat: 10 })]);
      const conflict = await owner({ workspace: ws, action: 'signal', runId, signal: { ...signal, payload: { amount: 1 } } });
      const resumed = await owner({ workspace: ws, action: 'execute', runId });
      const store = new Store(ws); const ev = store.events(runId); const run = store.run(runId); store.close();
      const outcomes = [...(a.result?.outcomes ?? []), ...(b.result?.outcomes ?? [])];
      return { observed: { parked: created.result?.status, outcomes: Object.fromEntries([...new Set(outcomes)].map(o => [o, outcomes.filter(x => x === o).length])), conflict: conflict.result?.outcomes, deliveredEvents: ev.filter(e => e.type === 'signal.delivered').length, final: resumed.result?.status, payload: run.outputs?.pay?.payload ?? null },
        checks: [
          { name: 'exactly one signal.delivered in the chain', pass: ev.filter(e => e.type === 'signal.delivered').length === 1, observed: ev.filter(e => e.type === 'signal.delivered').length },
          { name: '19 of 20 deliveries reported as duplicates', pass: outcomes.filter(o => o === 'duplicate').length === 19 && outcomes.filter(o => o === 'delivered').length === 1, observed: outcomes.filter(o => o !== 'duplicate') },
          { name: 'same id, other payload refused (SIGNAL_CONFLICT)', pass: (conflict.result?.outcomes ?? [])[0] === 'SIGNAL_CONFLICT', observed: conflict.result?.outcomes },
          { name: 'run completed with the first payload', pass: resumed.result?.status === 'succeeded' && run.outputs?.pay?.payload?.amount === 42, observed: `${resumed.result?.status} ${JSON.stringify(run.outputs?.pay?.payload ?? null)}` },
        ] };
    },
  },
  {
    id: 'B6', group: 'b', title: 'approval granted while no owner runs; two approvers and two resumers race',
    primitive: 'Runtime.approve + approval gate bound to args hash + lease', fault: 'owner gone while parked; concurrent approve x2 and resume x2',
    invariant: 'the gated effect fires exactly once, after the approval, under one owner',
    timeoutMs: 60000,
    async run() {
      const dir = tmp('orch-b6-'), ws = path.join(dir, 'ws'), effectsFile = path.join(dir, 'effects.jsonl');
      const created = await owner({ workspace: ws, action: 'create-execute', workflow: wf('Gated', [task('g', 'chaos.gated', { id: 'g' })], [exists(ref('nodes.g.applied'))]), effectsFile });
      const runId = created.lines[0].runId;
      const appr = await Promise.all([owner({ workspace: ws, action: 'approve', runId }), owner({ workspace: ws, action: 'approve', runId })]);
      const res = await Promise.all([owner({ workspace: ws, action: 'execute', runId, effectsFile }), owner({ workspace: ws, action: 'execute', runId, effectsFile })]);
      const fx = ledger(effectsFile).filter(r => r.kind === 'gated');
      return { observed: { parked: created.result?.status, approvals: appr.map(a => a.result?.approvals), resumes: res.map(r => r.result?.status ?? r.result?.code), applied: fx.length },
        checks: [
          { name: 'parked awaiting approval with no owner', pass: created.result?.status === 'awaiting_approval', observed: created.result?.status },
          { name: 'gated effect applied exactly once', pass: fx.length === 1, observed: fx.length },
          { name: 'one resumer succeeded, the other was refused or saw the result', pass: res.some(r => r.result?.status === 'succeeded'), observed: res.map(r => r.result?.status ?? r.result?.code) },
        ] };
    },
  },
  {
    id: 'B7', group: 'b', title: 'poison pill: a node that crashes its owner every time (OOM stand-in), under a naive restart loop',
    primitive: 'src runtime recover() + retry.maxAttempts across executions', fault: 'capability SIGKILLs its own process; a supervisor restarts the run 6 times',
    invariant: 'the crash loop stops by itself within maxAttempts + 1 executions with a typed, user-visible reason; no unbounded restarts',
    timeoutMs: 120000,
    async run() {
      const dir = tmp('orch-b7-'), ws = path.join(dir, 'ws'), effectsFile = path.join(dir, 'effects.jsonl');
      const created = await owner({ workspace: ws, action: 'create', workflow: wf('Poison', [task('p', 'chaos.selfkill', {}, { maxAttempts: 3 })], [exists(ref('nodes.p.id'))]) });
      const runId = created.lines[0].runId;
      const execs = [];
      for (let i = 0; i < 6; i++) {
        const r = await owner({ workspace: ws, action: 'execute', runId, effectsFile });
        execs.push(r.signal ?? r.result?.status ?? r.result?.code);
        if (r.result && ['failed', 'succeeded', 'uncertain', 'cancelled'].includes(r.result.status)) { execs.push(r.result.error?.code); break; }
      }
      const store = new Store(ws); const run = store.run(runId); store.close();
      const crashes = ledger(effectsFile).filter(r => r.kind === 'selfkill').length;
      return { observed: { executions: execs, crashes, status: run.status, error: run.error, resumeCount: run.resumeCount },
        checks: [
          { name: 'the loop stopped by itself (terminal status) within 4 executions', pass: ['failed', 'uncertain'].includes(run.status) && execs.filter(x => x === 'SIGKILL').length <= 3, observed: execs },
          { name: 'crashes bounded by maxAttempts (3)', pass: crashes <= 3, observed: crashes },
          { name: 'the reason names a crash loop (not only an attempt budget)', pass: /crash|kill|died|owner/i.test(run.error?.message ?? ''), observed: run.error?.message ?? null, info: true },
        ] };
    },
  },
  {
    id: 'B8', group: 'b', title: 'a wait across days: signal 2 days later, after a restart (library host vs shipped surfaces)',
    primitive: 'src runtime signal wait + timers + tick; default runtime policy', fault: 'the process exits while parked; the clock moves 2 days; a new process delivers and ticks',
    invariant: 'a run can wait days for a signal and finish after a restart; the shipped CLI/MCP surfaces allow it',
    timeoutMs: 60000,
    async run() {
      const workflow = maxDurationMs => wf(`LongWait${maxDurationMs}`, [{ id: 'w', kind: 'wait', needs: [], description: 'wait for approval mail', signal: 'mail.approved', timeoutMs: 3 * DAY }, task('after', 'chaos.work', {}, { needs: ['w'] })],
        [exists(ref('nodes.after.id'))], { maxDurationMs });
      const ws = path.join(tmp('orch-b8-'), 'ws');
      const lib = await owner({ workspace: ws, action: 'create-execute', workflow: workflow(4 * DAY), policy: { maxDurationMs: 4 * DAY } });
      const runId = lib.lines[0].runId;
      const sig = await owner({ workspace: ws, action: 'signal', runId, signal: { id: 's1', name: 'mail.approved' }, clockOffsetMs: 2 * DAY, policy: { maxDurationMs: 4 * DAY } });
      const tick = await owner({ workspace: ws, action: 'tick', runId, clockOffsetMs: 2 * DAY, policy: { maxDurationMs: 4 * DAY } });
      const ws2 = path.join(tmp('orch-b8s-'), 'ws');
      const shipped = await owner({ workspace: ws2, action: 'create-execute', workflow: workflow(4 * DAY) });
      return { observed: { library: { parked: lib.result?.status, signal: sig.result, after: tick.result?.run?.status, error: tick.result?.run?.error }, shipped: shipped.result ?? null },
        checks: [
          { name: 'library host (maxDurationMs raised): completes 2 days later after a restart', pass: tick.result?.run?.status === 'succeeded', observed: `${lib.result?.status} -> ${tick.result?.run?.status} ${tick.result?.run?.error?.code ?? ''}` },
          { name: 'shipped surfaces (default policy): a 3-day wait is accepted', pass: ['waiting', 'running'].includes(shipped.result?.status), observed: `${shipped.result?.status ?? shipped.result?.code} ${shipped.result?.error?.code ?? ''}: the default runtime policy caps every run at 1 h and no CLI flag raises it` },
        ] };
    },
  },
  {
    id: 'B9', group: 'b', title: 'one transient model timeout in an agent node',
    primitive: 'src runtime modelLoop environmentFaults + ModelPort timeout', fault: 'the first model call hangs past its timeout; the next would answer',
    invariant: 'a transient environment fault is retried (bounded, with backoff) or parks the run resumable; it never ends the run terminally',
    timeoutMs: 60000,
    async run() {
      const store = new Store(path.join(tmp('orch-b9-'), 'ws'));
      const { registry } = probeRegistry();
      const workflow = wf('ModelTimeout', [agentNode('j', { model: LOCAL, timeoutMs: 300 })], [exists(ref('nodes.j.v'))]);
      store.saveWorkflow(workflow);
      let n = 0;
      const { port } = scriptedPort(store, () => (n++ === 0 ? { value: { v: 1 }, delayMs: 5000 } : { value: { v: 1 } }));
      const runtime = new Runtime(store, registry, { allowedCapabilities: [], maxCost: 5 }, { models: port, modelPolicy: POLICY });
      const run = runtime.create(workflow, { raw: '1' });
      const first = await runtime.execute(run.id);
      const again = await runtime.execute(run.id);
      store.close();
      return { observed: { first: { status: first.status, code: first.error?.code, verdict: first.verdict?.code }, afterResume: again.status, calls: n },
        checks: [
          { name: 'run not terminally failed by one transient timeout', pass: !['failed'].includes(first.status), observed: `${first.status} ${first.error?.code} (verdict ${first.verdict?.verdict}/${first.verdict?.code})` },
          { name: 'resume after the fault completes the run', pass: again.status === 'succeeded', observed: `resume returned ${again.status}; provider called ${n} time(s)` },
        ] };
    },
  },
  {
    id: 'B10', group: 'b', title: 'parent death cancels its children (flow.call child running when the parent solver is killed)',
    primitive: 'experiments/jit/call-host.mjs runChild + services.mjs close (runCompiled path)', fault: 'parent solver SIGKILLed (its timeout) 1.5 s into an 8 s child call',
    invariant: 'cancellation propagates downward: the child stops within 1 s of the parent; the host returns within the parent timeout + 1 s',
    timeoutMs: 60000,
    async run() {
      const reg = createRegistry();
      let childEnded = null;
      const slow = reg.register({ contract: { output: { type: 'object' }, taskTemplate: 'slow' }, stub: async () => { await wait(8000); childEnded = Date.now(); return { output: { ok: true }, costUsd: 0.05 }; } });
      const t0 = Date.now();
      const r = await runSolver({ registry: reg, modelPort: stubPort(async () => ({ ok: true, value: {} })), killAfterMs: 1500, source: `const flow = createFlow({ budgetUsd: 1 });
const out = await flow.call('${slow.hash}', { x: 1 }, { name: 'slow', budgetUsd: 0.3, timeoutMs: 60000 });
flow.done(out);` });
      const parentDied = t0 + r.exitedMs;
      return { observed: { parentKilled: r.killed, parentExitMs: r.exitedMs, hostReturnedMs: r.exitedMs + r.closeMs, childEndedAfterParentMs: childEnded ? childEnded - parentDied : null, childSpendBooked: r.ledger.spentUsd },
        checks: [
          { name: 'child stopped within 1 s of the parent\'s death', pass: childEnded == null || childEnded - parentDied < 1000, observed: `child ran on ${childEnded ? childEnded - parentDied : '?'} ms after the parent died` },
          { name: 'host returned within the parent timeout + 1 s', pass: r.exitedMs + r.closeMs < 1500 + 1000, observed: `${r.exitedMs + r.closeMs} ms (gateway close waits for in-flight calls up to 330 s)` },
        ] };
    },
  },
  {
    id: 'B11', group: 'b', title: 'kill -9 during a fan-out of 20 model calls: spend of calls in flight at the crash',
    primitive: 'ModelPort journal (journal-before-observe) + chargeModel + crash recovery', fault: 'SIGKILL of the owner while 4 model calls are in flight, twice',
    invariant: 'no answered call is paid twice; every call the provider received is accounted (known or bounded unknown spend) in the run\'s cost',
    timeoutMs: 180000,
    async run() {
      const dir = tmp('orch-b11-'), ws = path.join(dir, 'ws'), modelsLedger = path.join(dir, 'provider.jsonl');
      const body = { nodes: [agentNode('j', { model: HAIKU, input: 'item' })], acceptance: [exists(ref('nodes.j.v'))] };
      const workflow = wf('KillModels', [mapNode('each', ref('input.items'), body, { concurrency: 4 })], [eq(ref('nodes.each.count'), 20)]);
      const models = { [HAIKU]: { value: { v: 1 }, delayMs: 150, costUsd: 0.01 } };
      const created = await owner({ workspace: ws, action: 'create', workflow, input: { items: Array.from({ length: 20 }, (_, i) => String(i)) }, models, modelsLedger });
      const runId = created.lines[0].runId;
      const log = await killLoop({ ws, runId, seed: 5, maxKills: 2, killWindow: [250, 600], extraSpec: { models, modelsLedger } });
      const store = new Store(ws); const run = store.run(runId); const journal = new Journal(store).costForRun(runId); store.close();
      const providerCalls = ledger(modelsLedger).length;
      return { observed: { kills: log.filter(l => l.killed).length, status: run.status, providerCalls, journalRows: journal.calls, runCost: run.cost, journalCost: journal.costUsd, unknown: run.costUnknownUpperUsd ?? null },
        checks: [
          { name: 'run succeeded after the kills', pass: run.status === 'succeeded', observed: run.status },
          { name: 'no answered call paid twice (provider calls <= 20 + calls in flight at each kill)', pass: providerCalls <= 20 + 4 * log.filter(l => l.killed).length, observed: providerCalls },
          { name: 'every provider call is accounted in the run (journal rows == provider calls)', pass: journal.calls >= providerCalls, observed: `${providerCalls} provider calls, ${journal.calls} journal rows, run cost $${run.cost.toFixed(2)}: ${providerCalls - journal.calls} call(s) in flight at a crash left no row and no bound` },
        ] };
    },
  },
];
