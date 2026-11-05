// DUR-1 CLI guards (BUILD-PLAN row 18): a paid stage refuses to start without --paid, and refuses with --paid while the
// freeze it needs is missing or changed; neither refusal writes a ledger row. Exit code 3 is the chain's stop signal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const RUN = path.join(ROOT, 'experiments/durability/run.mjs');
// Review minor 6: a scratch ledger and run directory, and an EMPTY freeze directory, so no test can ever pass a freeze check
// and spend (the real FREEZE-A.json exists from the freeze on); the real ledger is checked untouched as well.
const scratch = mkdtempSync(path.join(tmpdir(), 'dur1-cli-'));
const RUNS = path.join(scratch, 'runs'), FZ = path.join(scratch, 'freeze');
const SPEND = path.join(RUNS, 'spend.jsonl'), REAL = path.join(ROOT, 'research/durability-20261021/runs/spend.jsonl');
const run = (...args) => spawnSync(process.execPath, [RUN, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, DUR1_WORK: '/var/tmp/foundry-work/dur1-test', DUR1_RUNS: RUNS, DUR1_FREEZE_DIR: FZ } });
const ledger = () => `${existsSync(SPEND) ? readFileSync(SPEND, 'utf8') : ''}|${existsSync(REAL) ? readFileSync(REAL, 'utf8') : ''}`;
test.after(() => { rmSync(scratch, { recursive: true, force: true }); rmSync('/var/tmp/foundry-work/dur1-test', { recursive: true, force: true }); });

test('a paid stage without --paid exits 3 (DUR1_UNPAID) and spends nothing', () => {
  const before = ledger();
  for (const stage of ['heal', 'windows', 'refm', 'redteam', 'forks', 'p0']) {
    const r = run(stage);
    assert.equal(r.status, 3, `${stage}: ${r.stderr.slice(0, 300)}`);
    assert.match(r.stderr, /DUR1_UNPAID/);
  }
  assert.equal(ledger(), before);
});

test('with --paid but no F-B freeze (or no F-A for the author) the stage exits 3 (DUR1_FREEZE) and spends nothing', () => {
  const before = ledger();
  const r = run('heal', '--paid', '--streams', 's1');
  assert.equal(r.status, 3, r.stderr.slice(0, 300));
  assert.match(r.stderr, /DUR1_FREEZE/);
  const a = run('author', '--paid');
  assert.equal(a.status, 3, a.stderr.slice(0, 300));
  assert.match(a.stderr, /DUR1_FREEZE/);
  assert.equal(ledger(), before);
});

test('an unknown stage prints the usage and exits 2', () => {
  const r = run('nonsense');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});
