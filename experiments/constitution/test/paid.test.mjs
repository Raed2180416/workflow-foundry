// The paid arms' wiring at $0: W-C's build inputs and overlay smoke loop, A-F's and A-HV's constitution prompt and files
// (a scripted session, no model call), and the CLIs' refusals. Nothing here calls a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost } from '../../../beds/ebed/host/host.mjs';
import { wcFiles, overlaySmokeReport, TASK_ADDENDUM } from '../build-wc.mjs';
import { makeAgentArm, SIZED } from '../run-agents.mjs';
import { baseWorld, overlayWorld, overlayBinding } from '../overlay.mjs';
import { buildRegistry, practiceRegistry } from '../registry.mjs';
import { CONSTITUTION_ARM_TEXT, withConstitutionFiles, constitutionRunner } from '../arms.mjs';
import { solverPath } from '../run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reg = buildRegistry();

test('W-C build inputs: B1L-H\'s files plus CONSTITUTION.md, the TASK section and the registry as of the period start only', () => {
  const f = wcFiles();
  for (const k of ['SPEC-E.md', 'CONTRACT.md', 'TASK.md', 'smoke.mjs', 'CONSTITUTION.md', 'constitution/log.json']) assert.ok(f[k], k);
  assert.equal(f['CONSTITUTION.md'], CONSTITUTION_ARM_TEXT);
  assert.ok(f['TASK.md'].endsWith(TASK_ADDENDUM));
  const versions = Object.keys(f).filter(k => k.startsWith('constitution/versions/') && k.endsWith('.json'));
  assert.equal(versions.length, 1, 'only v1 at the period start: the builder never sees v2 or the planted v3');
  for (const v of [reg.byVersion(2).hash, reg.byVersion(3).hash]) assert.ok(!Object.values(f).some(t => t.includes(v)));
});

test('the constitution reaches an arm time-gated through ctx.files, and the prompt through the runner', async () => {
  const seen = [];
  const arm = withConstitutionFiles({ id: 'x', tick: (input, ctx) => { seen.push(Object.keys(ctx.files).filter(p => p.startsWith('constitution/versions/') && p.endsWith('.json')).length); return null; } }, reg);
  await arm.tick({ now: '2026-03-04T00:00:00+01:00' }, { files: { a: '1' } });
  await arm.tick({ now: '2026-03-12T00:00:00+01:00' }, { files: { a: '1' } });
  assert.deepEqual(seen, [1, 3]);
  let got = null;
  await constitutionRunner(o => { got = o.prompt; return {}; })({ prompt: 'TICK' });
  assert.ok(got.startsWith(CONSTITUTION_ARM_TEXT) && got.endsWith('TICK'));
});

test('the overlay smoke report runs a solver on a practice world under the practice registry', async () => {
  const { text, summary } = await overlaySmokeReport(readFileSync(solverPath('b1lh-e8-1'), 'utf8'), { practice: { seeds: [1235], difficulties: [2] }, registry: practiceRegistry() });
  assert.match(text, /== practice world 1235 \(difficulty 2\): complete/);
  assert.match(text, /human-task events your solver received/);
  assert.equal(summary.worlds[0].armErrors, 0);
});

for (const armName of ['A-F', 'A-HV']) {
  test(`${armName} dry: a scripted session sees the constitution in its prompt and the registry in its files; the run completes`, async () => {
    const root = path.join('/var/tmp/foundry-work/ot0-dry', `test-${armName}-${process.pid}`);
    rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true });
    try {
      const W = overlayWorld(baseWorld(SIZED), { registry: reg });
      const arm = makeAgentArm({ arm: armName, model: armName === 'A-F' ? 'claude-sonnet-5-5' : 'claude-haiku-5-5', label: `dry-${armName}`, workRoot: path.join(root, 'work'), journal: path.join(root, 'ticks.jsonl'),
        dry: true, tickBudget: 0.01, tickMinutes: 1, registry: reg });
      const host = createHost({ item: overlayBinding, world: W, arm, concurrency: 2, callTimeoutMs: 60_000 });
      const { status } = await host.run();
      assert.equal(status, 'complete');
      const rows = host.journal.contentRows();
      assert.equal(rows.filter(r => r.type === 'arm.error').length, 0);
      assert.ok(rows.filter(r => r.type === 'call').length > 10);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test('the CLIs refuse a paid run outside the declared conditions before any session starts', () => {
  const node = (file, args) => spawnSync(process.execPath, [path.join(here, '..', file), ...args], { encoding: 'utf8', timeout: 60_000 });
  assert.match(node('run-agents.mjs', ['--arm', 'A-F', '--model', 'claude-haiku-5-5', '--label', 'x']).stderr, /--model for A-F must be one of/);
  assert.match(node('run-agents.mjs', ['--arm', 'A-F', '--model', 'claude-sonnet-5-5', '--label', 'x']).stderr, /--cap \(USD, at most 50 per arm\) is required/);
  assert.match(node('run-agents.mjs', ['--arm', 'A-F', '--model', 'claude-sonnet-5-5', '--label', 'x', '--dry']).stderr, /must start with dry-/);
  assert.match(node('build-wc.mjs', ['--model', 'claude-sonnet-5-5', '--label', 'wc-x']).stderr, /B1L-H conditions: --model claude-haiku-5-5/);
  // While PREREG-OT0.md is a draft, every paid row is refused before a session starts.
  assert.match(node('run-agents.mjs', ['--arm', 'A-F', '--model', 'claude-sonnet-5-5', '--label', 'x', '--cap', '20']).stderr, /PREREG-OT0.md is a draft|no preregistration/);
  assert.match(node('build-wc.mjs', ['--model', 'claude-haiku-5-5', '--label', 'wc-x']).stderr, /PREREG-OT0.md is a draft|no preregistration/);
});
