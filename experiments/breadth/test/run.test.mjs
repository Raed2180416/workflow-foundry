// The paid runner end to end at $0 (experiments/breadth/workbench/run.mjs with the stand-in CLI fake-claude.mjs inside
// the real executor sandbox): records, host-side grading, meter journal, resume, the identity probe, and the init check
// turning a configuration mismatch into an environment fault (exit 3, nothing scored). Skipped without the pinned bed.
//   nice -n 15 node --test --test-concurrency=1 experiments/breadth/test/run.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { BENCH, CLONE, HOST_ONLY, VENV_PY } from '../workbench/lib.mjs';
import { DISK_FLOOR_BYTES, diskFreeBytes } from '../workbench/run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.resolve(HERE, '../workbench/run.mjs'), FAKE = path.join(HERE, 'fake-claude.mjs');
// Below its disk floor the runner starts no session and exits 4 (a stop, not a failure); these tests then cannot run.
const FREE = diskFreeBytes(BENCH);
const READY = !(existsSync(VENV_PY) && existsSync(path.join(CLONE, 'src/evals/evaluation.py')) && sandboxAvailable()) ? 'pinned bed or sandbox unavailable'
  : FREE !== null && FREE < DISK_FLOOR_BYTES ? `free disk ${Math.round(FREE / 1e6)} MB is under the runner's ${DISK_FLOOR_BYTES / 1e6} MB floor` : true;
const ids = [`test-standin-${process.pid}`, `test-mismatch-${process.pid}`, `test-identity-${process.pid}`];
after(() => { for (const id of ids) rmSync(path.join(HOST_ONLY, 'runs', id), { recursive: true, force: true }); });
const run = args => spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8', timeout: 300_000 });
const jsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

test('stand-in run: records, grading, meter, resume', { skip: READY === true ? false : READY }, () => {
  const r = run(['--arms', 'A-H', '--ids', 'email-001,calendar-074', '--cap', '1', '--binary', FAKE, '--no-init-check', '--run-id', ids[0]]);
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  const dir = path.join(HOST_ONLY, 'runs', ids[0]);
  const recs = jsonl(path.join(dir, 'results.jsonl'));
  assert.equal(recs.length, 2);
  for (const x of recs) { assert.equal(x.correct, false); assert.equal(x.graderAgree, true); assert.equal(x.liveMatchesReplay, true); assert.equal(x.worldCalls, 1); assert.equal(x.writes, 0); }
  assert.equal(jsonl(path.join(dir, 'meter.jsonl')).length, 2);
  const again = run(['--arms', 'A-H', '--ids', 'email-001,calendar-074', '--cap', '1', '--binary', FAKE, '--no-init-check', '--run-id', ids[0], '--resume']);
  assert.equal(again.status, 0, again.stderr.slice(-2000));
  assert.equal(jsonl(path.join(dir, 'results.jsonl')).length, 2); // nothing re-run
  const changed = run(['--arms', 'A-H', '--ids', 'email-001', '--cap', '1', '--binary', FAKE, '--no-init-check', '--run-id', ids[0], '--resume']);
  assert.notEqual(changed.status, 0); assert.match(changed.stderr, /resume refused/);
});

test('init check: a configuration that differs from the frozen fingerprint is an environment fault, never a score', { skip: READY === true ? false : READY }, () => {
  const r = run(['--arms', 'A-H', '--ids', 'email-001,calendar-074', '--cap', '1', '--binary', FAKE, '--run-id', ids[1], '--concurrency', '1']);
  assert.equal(r.status, 3, r.stderr.slice(-2000));
  const dir = path.join(HOST_ONLY, 'runs', ids[1]);
  assert.equal(jsonl(path.join(dir, 'results.jsonl')).length, 0);
  const f = jsonl(path.join(dir, 'faults.jsonl'));
  assert.equal(f.length, 1); assert.equal(f[0].sessionError, 'CONFIG_MISMATCH'); assert.ok(f[0].initMismatch.some(m => m.startsWith('cliVersion')));
  assert.equal(f[0].costUsd, 0); assert.equal(f[0].costUnknown, false); // killed at init, before any model answer
});

test('identity probe: one call per arm; "unknown" passes', { skip: READY === true ? false : READY }, () => {
  const r = run(['--probe', 'identity', '--arms', 'A-H,A-S', '--cap', '1', '--binary', FAKE, '--no-init-check', '--run-id', ids[2]]);
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  const recs = jsonl(path.join(HOST_ONLY, 'runs', ids[2], 'results.jsonl'));
  assert.deepEqual(recs.map(x => [x.arm, x.pass, x.saidUnknown]), [['A-H', true, true], ['A-S', true, true]]);
});
