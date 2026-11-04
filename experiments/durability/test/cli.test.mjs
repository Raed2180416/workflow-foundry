// DUR-1 CLI guards (BUILD-PLAN row 18): a paid stage refuses to start without --paid, and refuses with --paid while the
// freeze it needs is missing or changed; neither refusal writes a ledger row. Exit code 3 is the chain's stop signal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const RUN = path.join(ROOT, 'experiments/durability/run.mjs');
const SPEND = path.join(ROOT, 'research/durability-20261021/runs/spend.jsonl');
const run = (...args) => spawnSync(process.execPath, [RUN, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, DUR1_WORK: '/var/tmp/foundry-work/dur1-test' } });
const ledger = () => (existsSync(SPEND) ? readFileSync(SPEND, 'utf8') : '');

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
  if (existsSync(path.join(ROOT, 'research/durability-20261021/FREEZE.json'))) return;   // after F-B this case is the freeze check itself
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
