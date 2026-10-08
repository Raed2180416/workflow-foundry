// Ctrl-C / SIGTERM of a CLI command that executes runs (bin/foundry.mjs interruptOnSignal). Sandboxed code runs in a detached process
// group whose wall-clock limit is a timer in the CLI process, so a CLI killed by a signal used to leave the code running (a busy loop kept
// a CPU until it ended by itself: the sandbox sets no CPU-time limit). The CLI now aborts its executions first, which kills those groups,
// then exits as a crash would: the run stays resumable. Development/diagnostic evidence, not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.mjs';
import { sandboxStatus } from '../src/sandbox.mjs';

const cli = new URL('../bin/foundry.mjs', import.meta.url).pathname;
const sandbox = await sandboxStatus();
const skip = sandbox.available ? false : `code sandbox unavailable on this host (${sandbox.reason})`;
// [pid, ppid, pgid, state] of every process.
const processes = () => readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(pid => {
  try { const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return [[Number(pid), Number(fields[1]), Number(fields[2]), fields[0]]]; }
  catch { return []; }
});
const until = async (predicate, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const value = predicate(); if (value) return value; await delay(20); } return predicate(); };
const workflow = {
  schemaVersion: '1.0', id: 'InterruptProbe', version: 1, title: 'Interrupt probe', domain: 'diagnostic', goal: 'Hold a CPU in sandboxed code until interrupted.',
  envelope: { assumptions: ['Synthetic code only'], risks: [], successCriteria: ['The interrupt kills the code.'] },
  budget: { maxSteps: 10, maxConcurrency: 2, maxDurationMs: 300000 },
  nodes: [{ id: 'spin', kind: 'code', needs: [], description: 'Busy loop', lang: 'js', args: { ms: 120000 }, timeoutMs: 180000,
    source: 'export default function main(input) { const end = Date.now() + input.ms; while (Date.now() < end) {} return { ok: true }; }' }],
  acceptance: [{ op: 'eq', left: { $ref: 'nodes.spin.ok' }, right: true }]
};

for (const [name, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`${name} during \`foundry run\` kills the run's sandboxed code and leaves the run resumable`, { skip, timeout: 60000 }, async t => {
    const dir = mkdtempSync(path.join(tmpdir(), 'foundry-interrupt-')), file = path.join(dir, 'workflow.json'), workspace = path.join(dir, 'ws');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(file, JSON.stringify(workflow));
    const child = spawn(process.execPath, [cli, 'run', file, '--workspace', workspace], { env: { PATH: process.env.PATH ?? '', NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = new Promise(resolve => child.once('exit', (status, signal) => resolve({ status, signal })));
    t.after(() => { try { child.kill('SIGKILL'); } catch {} });
    // The sandbox is the CLI's child and the leader of its own process group; wait until its code is running.
    const group = await until(() => processes().find(([, ppid]) => ppid === child.pid)?.[0], 20000);
    assert.ok(group, `the sandbox started: ${stderr}`);
    t.after(() => { try { process.kill(-group, 'SIGKILL'); } catch {} });
    assert.ok(await until(() => processes().filter(([, , pgid, state]) => pgid === group && state !== 'Z').length >= 2, 20000), 'the code is running inside the sandbox');
    child.kill(name);
    const { status } = await exited;
    assert.equal(status, code, stderr);
    const report = JSON.parse(stderr.trim().split('\n').at(-1));
    assert.equal(report.interrupted, name);
    assert.equal(report.resumable, true);
    assert.equal(report.runs.length, 1);
    // Killed with the CLI, not left running (a killed process may stay a zombie until its new parent reaps it).
    const alive = await until(() => !processes().some(([, , pgid, state]) => pgid === group && state !== 'Z'), 5000) ? [] : processes().filter(([, , pgid]) => pgid === group);
    assert.deepEqual(alive, [], 'no process of the sandbox group is still running');
    const store = new Store(workspace);
    t.after(() => store.close());
    const run = store.run(report.runs[0]);
    assert.equal(run.status, 'running', 'stopped as a crash would: not cancelled, so `foundry resume` can continue it');
    assert.equal(run.owner.pid, child.pid);
    assert.ok(!store.events(run.id).some(e => ['run.stopped', 'run.verdict'].includes(e.type)));
  });
}
