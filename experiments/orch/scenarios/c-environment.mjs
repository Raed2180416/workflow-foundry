// Group (c): environment variance. Real faults where this Linux host can make them without root: a full disk (a small
// tmpfs in a user+mount namespace), a host without /proc (procfs masked by an empty tmpfs), clock steps (Date.now shifted
// in the owner process), several orchestrator processes on one SQLite workspace.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../../../src/store.mjs';
import { Results } from '../../lib/results.mjs';
import { ENV_FAULTS, metEnvFault } from '../../lib/runner.mjs';
import { agentNode, eq, exists, HAIKU, ledger, mapNode, ORCH, ref, task, tmp, until, wait, wf, withMarker } from '../lib/harness.mjs';
import { owner, startOwner } from '../lib/proc.mjs';
import { inNamespace, quote } from '../lib/ns.mjs';

const OWNER = path.join(ORCH, 'lib/owner.mjs');
const node = process.execPath;
const specFile = (dir, name, spec) => { const f = path.join(dir, `${name}.json`); writeFileSync(f, JSON.stringify(spec)); return f; };
const step = (n, cmd) => `echo '{"step":"${n}"}'; ${cmd}`;

export default [
  {
    id: 'C1', group: 'c', title: 'disk full mid-run (real ENOSPC on a 6 MB tmpfs), then space freed and resume',
    primitive: 'src/store.mjs SQLite WAL + runtime update/seal + resume', fault: 'the workspace filesystem fills during a 80-item fan-out with effects',
    invariant: 'the failure is reported as a typed disk-full fault; no corrupted record; after freeing space the run resumes to the fault-free result; each effect applied once per key',
    timeoutMs: 180000,
    async run() {
      const dir = tmp('orch-c1-'), mnt = path.join(dir, 'mnt'), effectsFile = path.join(dir, 'effects.jsonl');
      mkdirSync(mnt);
      const items = Array.from({ length: 80 }, (_, i) => i);
      const workflow = wf('DiskFull', [mapNode('each', ref('input.items'), { nodes: [task('idem', 'chaos.idem', { id: ref('item') }, { maxAttempts: 3 }), task('w', 'chaos.work', { id: ref('item'), bytes: 6000 }, { needs: ['idem'] })],
        acceptance: [exists(ref('nodes.w.id'))] }, { concurrency: 4 })], [eq(ref('nodes.each.count'), 80)]);
      const refRun = await owner({ workspace: path.join(tmp('orch-c1r-'), 'ws'), action: 'create-execute', workflow, input: { items } });
      const ws = path.join(mnt, 'ws');
      const s1 = specFile(dir, 's1', { workspace: ws, action: 'create-execute', workflow, input: { items }, effectsFile });
      const s2 = specFile(dir, 's2', { workspace: ws, action: 'execute', runId: 'only', effectsFile });
      const s3 = specFile(dir, 's3', { workspace: ws, action: 'verify', runId: 'only' });
      const script = [
        'set -u', `M=${quote(mnt)}`, 'mount -t tmpfs -o size=6m tmpfs "$M"', 'mkdir -p "$M/ws"',
        'dd if=/dev/zero of="$M/filler" bs=1k count=5000 2>/dev/null',
        step('run', `${quote(node)} ${quote(OWNER)} ${quote(s1)}`), 'rm -f "$M/filler"',
        step('resume', `${quote(node)} ${quote(OWNER)} ${quote(s2)}`), step('verify', `${quote(node)} ${quote(OWNER)} ${quote(s3)}`),
      ].join('\n');
      const r = await inNamespace(script, { timeoutMs: 150000 });
      const byStep = {}; let cur = null;
      for (const l of r.lines) { if (l.step) { cur = l.step; byStep[cur] = []; } else if (cur) byStep[cur].push(l); }
      const first = (byStep.run ?? []).find(l => l.phase === 'result' || l.phase === 'error') ?? null;
      const resumed = (byStep.resume ?? []).find(l => l.phase === 'result' || l.phase === 'error') ?? null;
      const verified = (byStep.verify ?? []).find(l => l.phase === 'result' || l.phase === 'error') ?? null;
      const fx = ledger(effectsFile).filter(x => x.kind === 'idem');
      const typed = first && /DISK|ENOSPC|FULL|SPACE/i.test(`${first.code ?? ''} ${first.error?.code ?? ''}`);
      return { observed: { firstRun: first, closeErrors: (byStep.run ?? []).filter(l => l.phase === 'close-error'), resumed, verified, effects: { deliveries: fx.length, keys: new Set(fx.map(x => x.key)).size }, nsExit: r.code, stderr: r.stderr.slice(-300) },
        checks: [
          { name: 'the disk filled during the run (fault injected)', pass: !!first && (first.phase === 'error' || first.status !== 'succeeded'), observed: first ? `${first.phase} ${first.code ?? first.status} ${String(first.message ?? first.error?.message ?? '').slice(0, 100)}` : 'no output' },
          { name: 'reported as a typed disk-full fault the user can act on', pass: !!typed, observed: first ? `${first.code ?? first.error?.code}: ${String(first.message ?? first.error?.message ?? '').slice(0, 120)}` : null },
          { name: 'after freeing space, resume completes', pass: resumed?.status === 'succeeded', observed: resumed ? `${resumed.phase} ${resumed.status ?? resumed.code} ${resumed.error?.code ?? ''} ${String(resumed.message ?? '').slice(0, 120)}` : null },
          { name: 'same result as the fault-free run', pass: resumed?.outputDigest != null && resumed.outputDigest === refRun.result?.outputDigest, observed: resumed?.outputDigest === refRun.result?.outputDigest },
          { name: 'record verifies after the fault', pass: verified?.ok === true, observed: verified?.findings?.map(f => f.code) ?? verified },
          { name: 'each effect key applied once', pass: new Set(fx.map(x => x.key)).size === 80 && fx.length >= 80, observed: { deliveries: fx.length, keys: new Set(fx.map(x => x.key)).size } },
        ] };
    },
  },
  {
    id: 'C2', group: 'c', title: 'disk full in the experiment runners: fault classification and a torn JSONL tail',
    primitive: 'experiments/lib/runner.mjs ENV_FAULTS/metEnvFault (also call-host envFaultOf); experiments/lib/results.mjs append', fault: 'an arm throws ENOSPC / SQLite full; results.jsonl ends in a torn line',
    invariant: 'a host disk/file-table fault is an environment fault (retried on resume, never scored as a task failure); appending after a torn tail loses no record',
    timeoutMs: 30000,
    async run() {
      // As the faults arrive: errno codes from fs, and node:sqlite's generic code with SQLite's text (what C1 produced).
      const faults = { ENOSPC: { code: 'ENOSPC', message: 'ENOSPC: no space left on device, write' }, EDQUOT: { code: 'EDQUOT', message: 'EDQUOT: disk quota exceeded' },
        EMFILE: { code: 'EMFILE', message: 'EMFILE: too many open files' }, 'SQLite full': { code: 'ERR_SQLITE_ERROR', message: 'database or disk is full' } };
      const classified = Object.fromEntries(Object.entries(faults).map(([k, error]) => [k, metEnvFault({ error })]));
      const file = path.join(tmp('orch-c2-'), 'results.jsonl');
      writeFileSync(file, JSON.stringify({ arm: 'a', taskKey: 't1', trial: 0, pass: true }) + '\n' + '{"arm":"a","taskKey":"t2","tri');
      new Results(file).append({ arm: 'a', taskKey: 't3', trial: 0, pass: true });
      const reloaded = new Results(file);
      return { observed: { ENV_FAULTS: [...ENV_FAULTS], classified, afterTornTail: { t1: reloaded.has('a', 't1', 0), t3: reloaded.has('a', 't3', 0) } },
        checks: [
          { name: 'ENOSPC / EDQUOT / EMFILE / SQLite-full classified as environment faults', pass: Object.values(classified).every(Boolean), observed: classified },
          { name: 'a record appended after a torn tail survives a reload', pass: reloaded.has('a', 't3', 0), observed: reloaded.has('a', 't3', 0) ? 't3 present' : 't3 lost: the append joined the torn line, so neither parses' },
        ] };
    },
  },
  {
    id: 'C3', group: 'c', title: 'no /proc (macOS, BSD, hidepid containers): orphan reaping and owner liveness',
    primitive: 'src/children.mjs processTable/startOf, runtime alive(), control.mjs killOwnerTree', fault: 'procfs masked; owner SIGKILLed during a model-CLI call; then a dead owner whose pid was reused',
    invariant: 'the model CLI a dead owner left is stopped by cancel; a dead owner is never taken for alive because its pid was reused',
    timeoutMs: 120000,
    async run() {
      const dir = tmp('orch-c3-'), ws = path.join(dir, 'ws'), tag = `${Math.floor(Math.random() * 1e6)}`;
      const fake = path.join(dir, 'claude');
      writeFileSync(fake, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.300 (Claude Code)"; exit 0; fi\nexec sleep 300.${tag}\n`); chmodSync(fake, 0o755);
      const workflow = wf('NoProc', [agentNode('j', { model: HAIKU })], [exists(ref('nodes.j.v'))]);
      const s1 = specFile(dir, 's1', { workspace: ws, action: 'create', workflow, input: { raw: '1' } });
      const s2 = specFile(dir, 's2', { workspace: ws, action: 'execute', runId: 'only', cliBinary: fake });
      const s3 = specFile(dir, 's3', { workspace: ws, action: 'cancel', runId: 'only', cancel: { graceMs: 1000 } });
      const script = ['set -u', 'mount -t tmpfs -o size=1m none /proc',
        step('create', `${quote(node)} ${quote(OWNER)} ${quote(s1)}`),
        `${quote(node)} ${quote(OWNER)} ${quote(s2)} & OWNER=$!`, 'sleep 4', 'kill -9 $OWNER', 'sleep 1',
        step('cancel', `${quote(node)} ${quote(OWNER)} ${quote(s3)}`)].join('\n');
      const r = await inNamespace(script, { timeoutMs: 60000 });
      await wait(1000);
      const orphans = withMarker(`sleep 300.${tag}`);
      const cancel = r.lines.find(l => l.phase === 'result' && l.cancel)?.cancel ?? r.lines.find(l => l.phase === 'error') ?? null;
      for (const p of orphans) { try { process.kill(p.pid, 'SIGKILL'); } catch {} }
      // Part 2: an owner recorded without a start time (as on a host without /proc) whose pid now belongs to a live process.
      const ws2 = path.join(dir, 'ws2');
      const created = await owner({ workspace: ws2, action: 'create', workflow: wf('Reused', [task('t', 'chaos.work', {})], [exists(ref('nodes.t.id'))]) });
      const runId = created.lines[0].runId;
      const stranger = spawn('sleep', ['30'], { stdio: 'ignore' });
      const store = new Store(ws2);
      store.updateRun(runId, run => { run.status = 'running'; run.owner = { token: 'dead-owner', pid: stranger.pid, processStart: null, acquiredAt: Date.now() }; }, { type: 'runner.acquired', token: 'dead-owner' }, { result: 'header' });
      store.close();
      const resume = await owner({ workspace: ws2, action: 'execute', runId });
      const force = await owner({ workspace: ws2, action: 'cancel', runId, cancel: { graceMs: 500, force: true } });
      const strangerAlive = stranger.exitCode === null;
      stranger.kill('SIGKILL');
      return { observed: { cancel, orphans: orphans.map(p => ({ pid: p.pid, ppid: p.ppid, cmd: p.cmd })), nsStderr: r.stderr.slice(-300), resume: resume.result, force: force.result, strangerAlive },
        checks: [
          { name: 'cancel closed the run of the dead owner without /proc', pass: cancel?.outcome === 'cancelled', observed: cancel },
          { name: 'no model-CLI orphan left after cancel without /proc', pass: orphans.length === 0, observed: `${orphans.length} orphan(s) (processTable() is empty without /proc, so reapChildren kills nothing)` },
          { name: 'a dead owner with a reused pid is not taken for alive (resume works)', pass: resume.result?.status === 'succeeded', observed: `${resume.result?.code ?? resume.result?.status}: ${resume.result?.message ?? ''}`.slice(0, 200) },
          { name: 'cancel --force can still close it, without signalling the stranger', pass: force.result?.cancel?.outcome === 'cancelled' && strangerAlive, observed: { cancel: force.result?.cancel ?? force.result, strangerAlive } },
        ] };
    },
  },
  {
    id: 'C4', group: 'c', title: 'clock steps forward 2 h mid-run (NTP step, VM resume)',
    primitive: 'src runtime deadline (Date.now) in checkBudget/flow/untilDeadline', fault: 'Date.now() jumps +2 h 500 ms into a 1.5 s run with a 1 h budget',
    invariant: 'a wall-clock step does not fail a run whose elapsed time is within budget (or the failure names the clock step)',
    timeoutMs: 60000,
    async run() {
      const ws = path.join(tmp('orch-c4-'), 'ws');
      const workflow = wf('ClockFwd', [mapNode('each', ref('input.items'), { nodes: [task('w', 'chaos.work', { id: ref('item'), ms: 300 })], acceptance: [exists(ref('nodes.w.id'))] }, { concurrency: 2 })],
        [eq(ref('nodes.each.count'), 10)]);
      const r = await owner({ workspace: ws, action: 'create-execute', workflow, input: { items: Array.from({ length: 10 }, (_, i) => i) }, clockJump: { afterMs: 900, offsetMs: 2 * 3600000 } });
      const res = r.result;
      return { observed: { jumped: r.lines.some(l => l.phase === 'clock-jumped'), result: res },
        checks: [
          { name: 'run not failed by the clock step', pass: res?.status === 'succeeded', observed: `${res?.status} ${res?.error?.code ?? ''}` },
          { name: 'a failure names the clock step, not an exhausted budget', pass: res?.status === 'succeeded' || /clock/i.test(res?.error?.message ?? ''), observed: res?.error?.message ?? null, info: true },
        ] };
    },
  },
  {
    id: 'C5', group: 'c', title: 'clock steps back 1 h while a 1.5 s timer wait is parked',
    primitive: 'src runtime wait (delayMs) + timers table + tick', fault: 'Date.now() is 1 h behind when the timer scan runs',
    invariant: 'a short timer still fires after about its real delay',
    timeoutMs: 60000,
    async run() {
      const ws = path.join(tmp('orch-c5-'), 'ws');
      const workflow = wf('ClockBack', [{ id: 'nap', kind: 'wait', needs: [], description: 'short pause', delayMs: 1500 }, task('after', 'chaos.work', {}, { needs: ['nap'] })], [exists(ref('nodes.after.id'))]);
      const parked = await owner({ workspace: ws, action: 'create-execute', workflow });
      const runId = parked.lines[0].runId;
      await wait(2500);
      const back = await owner({ workspace: ws, action: 'tick', runId, clockOffsetMs: -3600000 });
      const control = await owner({ workspace: ws, action: 'tick', runId });
      return { observed: { parked: parked.result?.status, afterTickWithClockBack: back.result?.run?.status, tickDue: back.result?.tick?.due, afterNormalTick: control.result?.run?.status },
        checks: [
          { name: 'parked on the timer', pass: parked.result?.status === 'waiting', observed: parked.result?.status },
          { name: 'timer fires 2.5 s later although the clock stepped back', pass: back.result?.run?.status === 'succeeded', observed: `${back.result?.run?.status} (due timers: ${back.result?.tick?.due}); with the clock right it ends ${control.result?.run?.status}` },
        ] };
    },
  },
  {
    id: 'C6', group: 'c', title: 'three orchestrator processes write one SQLite workspace at once',
    primitive: 'src/store.mjs (WAL, busy_timeout 5000, BEGIN IMMEDIATE) under the runtime', fault: '3 processes x 300-item fan-outs, 16 in flight each, on one workspace',
    invariant: 'contention only slows runs down: all three succeed, none fails with SQLITE_BUSY/locked',
    timeoutMs: 300000,
    async run() {
      const ws = path.join(tmp('orch-c6-'), 'ws');
      const items = Array.from({ length: 300 }, (_, i) => i);
      const mk = k => wf(`Contend${k}`, [mapNode('each', ref('input.items'), { nodes: [task('w', 'chaos.work', { id: ref('item'), ms: 1 })], acceptance: [exists(ref('nodes.w.id'))] }, { concurrency: 16 })],
        [eq(ref('nodes.each.count'), 300)]);
      await owner({ workspace: ws, action: 'verify', runId: 'none' });   // creates the workspace first, so the three race only on runs
      const t0 = Date.now();
      const rs = await Promise.all([0, 1, 2].map(k => owner({ workspace: ws, action: 'create-execute', workflow: mk(k), input: { items } })));
      const ms = Date.now() - t0;
      const outcomes = rs.map(r => r.result?.status ?? `${r.result?.code}: ${String(r.result?.message ?? '').slice(0, 80)}`);
      return { observed: { outcomes, ms },
        checks: [{ name: 'all three runs succeeded', pass: outcomes.every(o => o === 'succeeded'), observed: outcomes },
          { name: 'wall time for 900 items (3 processes)', pass: true, observed: `${ms} ms`, info: true }] };
    },
  },
];
