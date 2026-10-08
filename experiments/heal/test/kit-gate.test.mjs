import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO, HEAL_DIR, verifyKit, readPins, blobOf } from '../kit.mjs';
import { verifyPinned } from '../pin-gate.mjs';
import { world, skipReason } from './helpers.mjs';

test('the frozen kit has the blob ids of commit 880c6b9 and the owner policy is the kit policy', { skip: skipReason }, async () => {
  const { kit } = await world();
  const check = verifyKit();
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.equal(check.files, 87);
  assert.equal(kit.kitHash, '7e8f0f83153c5efb');
  assert.equal(kit.policyIdentical, true);
  assert.equal(readPins().kit.commit, '880c6b9');
});

test('a kit that differs from the pins is refused', { skip: skipReason }, () => {
  const pins = structuredClone(readPins());
  const file = Object.keys(pins.kit.files).find(f => f.endsWith('runtime.mjs'));
  pins.kit.files[file] = '0'.repeat(40);
  const check = verifyKit({ pins });
  assert.equal(check.ok, false);
  assert.deepEqual(check.mismatched, [file]);
  delete pins.kit.files['src/engine.mjs'];
  assert.ok(verifyKit({ pins }).extra.includes('src/engine.mjs'));
});

test('the gate closure is pinned: lint, acceptance and verdict at 13f7664, byte-identical copies', { skip: skipReason }, async () => {
  const { gate } = await world();
  assert.equal(verifyPinned().ok, true);
  assert.equal(gate.source, 'pinned');
  assert.equal(gate.blobs['src/lint.mjs'], '91ff528cbace9176dacbbaf9ef1aa49f64a80bd7');
  assert.equal(blobOf(path.join(HEAL_DIR, 'pinned/src/lint.mjs')), gate.blobs['src/lint.mjs']);
  assert.equal(blobOf(path.join(HEAL_DIR, 'pinned/src/verdict.mjs')), gate.blobs['src/verdict.mjs']);
});

test('the pinned lint reproduces the retro-audit exactly on the three base workflows', { skip: skipReason }, async () => {
  const { gate, kit, wf } = await world();
  const policy = kit.sessionPolicy(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
  const audit = JSON.parse(readFileSync(path.join(REPO, 'research/lint-20261008/retro-audit.json'), 'utf8')).lintOver;
  for (const [name, w] of [['F-haiku-codefix-k1', wf.codefix], ['F-haiku-records-k1', wf.records]]) {
    const want = audit.find(a => a.workflow === name), got = gate.lintWorkflow(w, { modelPolicy: policy });
    assert.deepEqual(got.codes, want.codes, name);
    assert.deepEqual(got.counts, want.counts, name);
    assert.deepEqual(got.findings.map(f => [f.code, f.severity, f.path]), want.findings.map(f => [f.code, f.severity, f.path]), name);
  }
  // records-v3 (P1): 11 errors, every one of them acceptance/gating debt
  const p1 = gate.lintWorkflow(wf.p1, { modelPolicy: policy });
  assert.equal(p1.counts.error, 11);
});

test('the pinned verdict re-derives "unverified / ACCEPTANCE_EXISTENCE_ONLY" for a succeeded run of an existence-only workflow', { skip: skipReason }, async () => {
  const { gate } = await world();
  const wf = { acceptance: [{ op: 'exists', value: { $ref: 'nodes.answer.x' } }], nodes: [] };
  const v = gate.verdictOf({ status: 'succeeded', nodes: {}, outputs: {}, frames: {} }, { workflow: wf });
  assert.equal(v.verdict, 'unverified');
  assert.equal(v.code, 'ACCEPTANCE_EXISTENCE_ONLY');
});
