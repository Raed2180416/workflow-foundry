// One runner per workdir (orch-20261021 rank 12, chaos F1). $0, local files and one short-lived child process only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { lockWorkdir, LOCK_FILE } from './workdir-lock.mjs';
import { startOf } from '../../src/children.mjs';

const scratch = t => { const dir = mkdtempSync(path.join(tmpdir(), 'wd-lock-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

test('a second runner in the same process is refused while the first holds the workdir; release frees it', t => {
  const dir = path.join(scratch(t), 'w');
  const a = lockWorkdir(dir, { label: 'A' });
  assert.equal(a.ok, true);
  const b = lockWorkdir(dir, { label: 'B' });
  assert.equal(b.ok, false); assert.equal(b.holder.pid, process.pid); assert.equal(b.holder.label, 'A');
  a.release();
  assert.equal(existsSync(path.join(dir, LOCK_FILE)), false);
  const c = lockWorkdir(dir, { label: 'C' });
  assert.equal(c.ok, true); c.release();
  assert.deepEqual(readdirSync(dir), [], 'no temporary or stale files are left behind');
});

test('a lock whose holder is gone is taken over; a live holder in another process is refused; release never removes another runner\'s lock', async t => {
  const dir = path.join(scratch(t), 'w');
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' });
  t.after(() => { try { sleeper.kill('SIGKILL'); } catch {} });
  await new Promise(resolve => sleeper.once('spawn', resolve));
  const file = path.join(dir, LOCK_FILE);
  const first = lockWorkdir(dir); first.release();
  // Held by another live process (same start time as on record): refused.
  writeFileSync(file, JSON.stringify({ pid: sleeper.pid, start: startOf(sleeper.pid), token: 'other', label: 'elsewhere', at: Date.now() }));
  const refused = lockWorkdir(dir);
  assert.equal(refused.ok, false); assert.equal(refused.holder.label, 'elsewhere');
  // The same pid with another start time is a reused pid: stale.
  if (startOf(sleeper.pid) !== null) {
    writeFileSync(file, JSON.stringify({ pid: sleeper.pid, start: '1', token: 'reused', label: 'old', at: 1 }));
    const taken = lockWorkdir(dir);
    assert.equal(taken.ok, true, 'a reused pid does not hold the lock');
    // Another runner's lock replaces ours behind our back: our release leaves it alone.
    writeFileSync(file, JSON.stringify({ pid: sleeper.pid, start: startOf(sleeper.pid), token: 'theirs', label: 'theirs', at: Date.now() }));
    taken.release();
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).token, 'theirs');
  }
  // A dead holder: stale, taken over.
  sleeper.kill('SIGKILL'); await new Promise(resolve => sleeper.once('exit', resolve));
  const after = lockWorkdir(dir);
  assert.equal(after.ok, true); after.release();
});
