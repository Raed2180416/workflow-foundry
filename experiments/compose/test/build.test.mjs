// Builder side of arms C-H and C-H-T (HARNESS.md §7): workspace, kit, smoke loop, module tests. $0, no model calls.
//   node --test --test-concurrency=1 experiments/compose/test/build.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { buildFiles } from '../../ebed/build.mjs';
import { composedBuildFiles, composedTaskText, runModuleTests, B1LH_CONDITIONS } from '../build.mjs';
import { composedSmokeReport } from '../smoke.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, '..', 'fixtures', 'straight-saga');
const materialize = (dir, files) => { for (const [f, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); writeFileSync(path.join(dir, f), t); } };

test('C-H and C-H-T keep B1L-H\'s spec, contract and API files; C-H-T adds only the templates', () => {
  const b1 = buildFiles(e8, { loop: 'smoke' }), ch = composedBuildFiles(e8, { arm: 'C-H' }), cht = composedBuildFiles(e8, { arm: 'C-H-T' });
  for (const f of Object.keys(b1).filter(f => f !== 'TASK.md')) assert.equal(ch[f], b1[f], f);
  assert.ok(ch['COMPOSE.md'] && ch['compose-kit/runtime.mjs'] && ch['compose-kit/kit.mjs']);
  assert.ok(!Object.keys(ch).some(f => f.startsWith('templates/')));
  assert.deepEqual(Object.keys(cht).filter(f => !(f in ch)).every(f => f.startsWith('templates/')), true);
  assert.match(composedTaskText('C-H-T'), /Decomposition templates/);
  assert.doesNotMatch(composedTaskText('C-H'), /templates/);
  for (const f of Object.values(cht)) assert.doesNotMatch(f, /referenceTransition|oracle\/|golden|ledger\/MUTANTS/, 'no bed or oracle code or path reaches the builder');
  assert.deepEqual(B1LH_CONDITIONS.paired, { seed: 1232, d: 2, size: 12 });
});

test('the kit checks a program and runs its module contract tests (in the builder\'s directory)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compose-kit-'));
  try {
    materialize(dir, composedBuildFiles(e8, { arm: 'C-H' }));
    cpSync(FIXTURE, dir, { recursive: true });
    const noTests = spawnSync(process.execPath, ['compose-kit/compose.mjs', 'check'], { cwd: dir, encoding: 'utf8' });
    assert.equal(noTests.status, 1);
    assert.match(noTests.stdout, /no contract tests/);
    mkdirSync(path.join(dir, 'tests'));
    for (const id of ['intake', 'order', 'saga']) writeFileSync(path.join(dir, 'tests', `${id}.test.mjs`), `import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';
test('${id}', () => { const r = moduleHarness('${id}').onEvent({ type: 'timer.fired', payload: { obligationId: 'x' } }, { key: 'K' }); assert.equal(r.error, null); });
`);
    // A real contract test through the harness: the saga starts a fulfilment with its status and a per-item keyed batch.
    writeFileSync(path.join(dir, 'tests', 'saga-start.test.mjs'), `import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';
test('saga start', () => {
  const r = moduleHarness('saga').step({ start: { orderId: 'O', fulfilmentId: 'O-F1', location: 'L', items: [{ sku: 'S', qty: 1 }], amountMinor: 5, customerId: 'C' } }, { key: 'O-F1' });
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.effects.map(e => e.key ?? e.args.items[0].key), ['st-processing', 'rsv-S']);
  assert.equal(r.state.phase, 'reserving');
});
`);
    const ok = spawnSync(process.execPath, ['compose-kit/compose.mjs', 'check'], { cwd: dir, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout);
    const t = spawnSync(process.execPath, ['compose-kit/compose.mjs', 'test'], { cwd: dir, encoding: 'utf8' });
    assert.equal(t.status, 0, t.stdout + t.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the composed smoke report runs the harness-bundled program and lists interface violations, never grading', { skip: !sandboxAvailable() }, async () => {
  const practice = { seeds: [1235], difficulties: [2], size: 8 };
  const r = await composedSmokeReport(e8, FIXTURE, { mode: 'smoke', practice });
  assert.match(r.text, /orders\.create ok/);
  assert.match(r.text, /interface violations: 0/);
  assert.doesNotMatch(r.text, /business rules|completed cases pass/);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compose-bad-'));
  try {
    cpSync(FIXTURE, dir, { recursive: true });
    writeFileSync(path.join(dir, 'modules', 'order.mjs'), "export function step(input, ctx) { return { output: null, effects: [{ key: 'x', system: 'billing', op: 'refund', args: {} }] }; }\nexport function onEvent() { return { output: null }; }\n");
    const bad = await composedSmokeReport(e8, dir, { mode: 'smoke', practice });
    assert.match(bad.text, /effect-undeclared/);
    writeFileSync(path.join(dir, 'modules', 'order.mjs'), "import x from './saga.mjs';\nexport function step() { return {}; }\n");
    assert.match((await composedSmokeReport(e8, dir, { mode: 'smoke', practice })).text, /program problems/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('module contract tests run inside the sandbox', { skip: !sandboxAvailable() }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compose-tests-'));
  try {
    materialize(dir, composedBuildFiles(e8, { arm: 'C-H' }));
    cpSync(FIXTURE, dir, { recursive: true });
    mkdirSync(path.join(dir, 'tests'));
    writeFileSync(path.join(dir, 'tests', 'saga.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => assert.ok(true));\ntest('b', () => assert.ok(false));\n");
    const r = await runModuleTests(dir);
    assert.equal(r.ran, true);
    assert.equal(r.pass, 1);
    assert.equal(r.fail, 1);
    assert.equal(r.modulesWithTests, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
