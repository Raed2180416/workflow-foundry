// X4 (MEMORY-ROUTING-RECURSION §3.2 "Memory tests"): memo reused hits across task ids, from what a stream recorded and
// from the arm's journal served back the way a replay arm's memo serves it; a claim-bearing (test-split) run with a reused
// hit is a violation. Synthetic run directories; $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { replayCount, recordedCount, scanRun, taskOfRunId } from '../memo-reuse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'x4-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const row = (runId, digest, value = { v: digest }) => ({ runId, model: 'claude-haiku-5-5', requestDigest: digest.repeat(64).slice(0, 64), response: { ok: true, value } });
const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';

test('X4: journal replay counts hits, cross-task hits and requests past a key\'s last answer (reused only if reuse is on)', () => {
  assert.equal(taskOfRunId('exp:jit-a--b:7:v2:1234-uuid'), 7); assert.equal(taskOfRunId('compile:v1-haiku55:uuid'), null); assert.equal(taskOfRunId('jit-check:v1:uuid'), null);
  const fault = (runId, digest) => ({ runId, model: 'claude-haiku-5-5', requestDigest: digest.repeat(64).slice(0, 64), ok: false, errorCode: 'MODEL_RATE_LIMIT', response: { ok: false, error: { code: 'MODEL_RATE_LIMIT' } } });
  const rows = [
    row('jit-check:v1:u0', 'a'),          // a host check journaled request a first
    row('exp:arm:0:v1:u1', 'a'),          // task 0 asks a: served the check's row (cross-task)
    row('exp:arm:1:v1:u2', 'b'),          // task 1 asks b: its own row
    fault('exp:arm:1:v1:u3', 'b'),        // task 1 asks b again (a second vote sample) that faulted: past b's one answer
    fault('exp:arm:2:v1:u4', 'a'),        // task 2 asks a: served task 0's row (cross-task)
  ];
  // Environment faults are never served (memoRowOf), but their requests are replayed.
  const off = replayCount(rows);
  assert.deepEqual({ ...off, crossTaskByTask: undefined }, { rows: 5, servable: 3, taskRequests: 4, hits: 3, crossTask: 2, reused: 0, reusedIfOn: 1, live: 1, crossTaskByTask: undefined });
  assert.deepEqual(off.crossTaskByTask, { 0: 1, 2: 1 });
  const on = replayCount(rows, { reuse: true });
  assert.deepEqual([on.reused, on.live], [1, 0], 'with reuse on, the request past the end would have been served the last answer again');
});

test('X4: recorded memo counts by task, and a claim-bearing run with a reused hit is a violation (CLI exit 1)', t => {
  const results = [{ idx: 0, taskKey: 'f:dev:d3:s1', events: [{ kind: 'compiled', memo: { requests: 3, hits: 3, reused: 0, live: 0 } }] },
    { idx: 1, taskKey: 'f:dev:d3:s2', events: [{ kind: 'compiled', memo: { requests: 3, hits: 1, reused: 2, live: 0 } }, { kind: 'shadow' }] }];
  assert.deepEqual(recordedCount(results), { requests: 6, hits: 4, reused: 2, live: 0, reusedByTask: { 1: 2 }, compiledRuns: 2 });
  const root = tmp(t);
  for (const [run, split] of [['dev-run', 'dev'], ['held-out', 'test']]) {
    const dir = path.join(root, run, 'jit-a--b'); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'results.jsonl'), jsonl(results.map(r => ({ ...r, taskKey: r.taskKey.replace(':dev:', `:${split}:`) }))));
    writeFileSync(path.join(dir, 'journal.jsonl'), jsonl([row(`${run}:jit-a--b:0:v1:u`, 'c')]));
  }
  const [dev] = scanRun(path.join(root, 'dev-run')), [held] = scanRun(path.join(root, 'held-out'));
  assert.deepEqual([dev.claimBearing, dev.violation], [false, false]);
  assert.deepEqual([held.claimBearing, held.violation, held.recorded.reused], [true, true, 2]);
  assert.deepEqual([held.replayed.taskRequests, held.replayed.hits, held.replayed.reused], [1, 1, 0]);
  const cli = spawnSync(process.execPath, [path.join(HERE, '../memo-reuse.mjs'), path.join(root, 'dev-run'), path.join(root, 'held-out')], { encoding: 'utf8' });
  assert.equal(cli.status, 1, cli.stderr); assert.match(cli.stdout, /VIOLATION: reused on a claim-bearing run/); assert.match(cli.stdout, /claim-bearing violations 1/);
  const ok = spawnSync(process.execPath, [path.join(HERE, '../memo-reuse.mjs'), path.join(root, 'dev-run')], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
});
