import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { smokeReport, serveMailbox, CLIENT, PRACTICE } from '../smoke-service.mjs';
import { buildFiles } from '../build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const S1 = readFileSync(path.join(here, '../../../beds/ebed/e8/specificity/s1-state-machine.mjs'), 'utf8');
const SMALL = { seeds: [1235], difficulties: [2], size: 12 };
// A solver that never emits an effect (the B1-H failure shape): smoke shows "(none)" without any grading.
const IDLE = `export function createSolver() { return { id: 'idle', tick(input) { return { decisions: { subject: null }, effects: [], close: true, carry: {} }; } }; }`;

test('practice worlds are disjoint from the B1 grading block and the specificity block', () => {
  for (const s of PRACTICE.seeds) { assert.ok(s >= 1235 && s <= 1240, `seed ${s}`); }
});

test('smoke mode reports effect results and arm errors, never grading', async () => {
  const good = await smokeReport(e8, S1, { mode: 'smoke', practice: SMALL });
  assert.match(good.text, /orders\.create ok/);
  assert.doesNotMatch(good.text, /business rules|pass|rule R/);
  const idle = await smokeReport(e8, IDLE, { mode: 'smoke', practice: SMALL });
  assert.match(idle.text, /0 effects emitted/);
  assert.match(idle.text, /\(none\)/);
});

test('graded mode adds the practice pass count and first divergences', async () => {
  const idle = await smokeReport(e8, IDLE, { mode: 'graded', practice: SMALL, show: 2 });
  assert.match(idle.text, /business rules: 0\/\d+ completed cases pass/);
  assert.match(idle.text, /rule R\d/);
  const good = await smokeReport(e8, S1, { mode: 'graded', practice: SMALL });
  const m = good.text.match(/business rules: (\d+)\/(\d+)/);
  assert.equal(m[1], m[2]);
});

test('the mailbox: the builder-side client gets the host-side report through files only', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
  writeFileSync(path.join(dir, 'solver.mjs'), IDLE);
  writeFileSync(path.join(dir, 'smoke.mjs'), CLIENT);
  const journal = path.join(dir, 'journal.jsonl');
  const box = serveMailbox({ item: e8, workdir: dir, mode: 'smoke', journal, practice: SMALL, pollMs: 100 });
  const { spawn } = await import('node:child_process');
  const out = await new Promise((res, rej) => { const c = spawn(process.execPath, ['smoke.mjs'], { cwd: dir }); let o = ''; c.stdout.on('data', d => { o += d; }); c.on('close', code => (code === 0 ? res(o) : rej(new Error(o)))); });
  assert.equal(await box.stop(), 1);
  assert.match(out, /practice world 1235/);
  assert.equal(JSON.parse(readFileSync(journal, 'utf8').trim()).n, 1);
});

test('loop builds ship the client and instructions; the plain B1 workspace is unchanged', () => {
  const plain = buildFiles(e8), loop = buildFiles(e8, { loop: 'graded' });
  assert.equal(plain['smoke.mjs'], undefined);
  assert.match(plain['TASK.md'], /You cannot\s+run the real systems here/);
  assert.equal(loop['smoke.mjs'], CLIENT);
  assert.match(loop['TASK.md'], /build loop: graded/);
  assert.doesNotMatch(loop['TASK.md'], /You cannot/);
});
