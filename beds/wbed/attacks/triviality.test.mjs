// The triviality attack driver is dry-run only: it plans, stubs and emits, and never calls a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { plan, runStub, emit, callShape, B0_SYSTEM, ATTACK_SEEDS } from './triviality.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('plan: 12 attack seeds (dev 379-390) x 2 efforts x one Haiku call per rung', async () => {
  assert.deepEqual(ATTACK_SEEDS, Array.from({ length: 12 }, (_, i) => 379 + i));
  const p = await plan({ rungs: ['r0', 'r1'] });
  for (const r of p) {
    assert.equal(r.calls, 24);
    assert.equal(r.model, 'claude-haiku-5-5');
    assert.deepEqual(r.efforts, ['none', 'medium']);
    assert.ok(r.estUsd.tokenPriced > 0 && r.estUsd.tokenPriced < 1);
  }
});

test('call shape follows the engine: policy invocation, effort flag and thinking budget', async () => {
  const none = await callShape('none'), medium = await callShape('medium');
  assert.equal(none.effortFlag, 'low'); assert.equal(none.thinkingTokens, 0);
  assert.equal(medium.effortFlag, 'medium'); assert.equal(medium.thinkingTokens, 8000);
  assert.ok(none.invocation.includes('-p'));
  assert.ok(!JSON.stringify(none).includes('OAUTH'), 'no credential in the call shape');
});

test('the B0 system prompt matches the B0-call arm', () => {
  const src = readFileSync(path.join(root, 'experiments/lib/arms/b0-call.mjs'), 'utf8');
  assert.ok(src.includes(`const SYSTEM = '${B0_SYSTEM}';`));
});

test('stub runs score through the oracle without a model', async () => {
  const p = await plan({ rungs: ['r0', 'r1'], seeds: ATTACK_SEEDS.slice(0, 3) });
  for (const x of await runStub(p, 'reference')) assert.equal(x.pass, x.n);
  for (const x of await runStub(p, 'empty')) assert.equal(x.pass, 0);
  for (const x of await runStub(p.filter(r => r.rung === 'r1'), 'payer-credited')) assert.equal(x.pass, 0);
});

test('emit writes prompts, schemas and a run.sh, and executes nothing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wbed-triv-'));
  try {
    const p = await plan({ rungs: ['r1'], seeds: [379, 380] });
    assert.equal(emit(p, dir), 4);
    const sh = readFileSync(path.join(dir, 'run.sh'), 'utf8');
    assert.equal(sh.split('\n').filter(l => l.startsWith('env ')).length, 4);
    assert.ok(existsSync(path.join(dir, 'prompt-r1-d3-s379.txt')));
    assert.ok(!existsSync(path.join(dir, 'out')), 'nothing ran');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI dry run prints the plan and says no model was called', () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('./triviality.mjs', import.meta.url)), '--rung', 'all'], { encoding: 'utf8' });
  assert.match(out, /24 calls/);
  assert.match(out, /No model was called/);
  const stub = execFileSync(process.execPath, [fileURLToPath(new URL('./triviality.mjs', import.meta.url)), '--rung', 'r1', '--stub'], { encoding: 'utf8' });
  assert.match(stub, /0\/12 pass -> gate holds/);
});
