// Verifies the sealed held-out families without exposing their content: archive integrity against
// MANIFEST.json, interface shape, determinism, reference/bad-control behaviour, and each archive's
// own test file run in a subprocess. On failure, only counts are reported, never task text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadSealed, listSealed, extractSealed, sealedPath } from './loader.mjs';
import { canonical, sha256 } from '../lib/canonical.mjs';

const manifest = JSON.parse(readFileSync(new URL('./MANIFEST.json', import.meta.url), 'utf8'));
const ids = listSealed();

test('manifest lists exactly the sealed archives present', () => {
  assert.deepEqual(manifest.map(e => e.id).sort(), [...ids].sort());
  assert.ok(ids.length >= 4);
  assert.ok(manifest.some(e => e.kind === 'interactive'));
});

for (const id of ids) {
  const entry = manifest.find(e => e.id === id);

  test(`${id}: archive hash matches manifest`, () => {
    assert.equal(sha256(readFileSync(sealedPath(id))), entry.sha256, `${id} archive changed since the manifest was written`);
  });

  test(`${id}: interface, determinism and controls`, async () => {
    const F = await loadSealed(id);
    assert.equal(F.family.id, id);
    assert.equal(F.family.kind, entry.kind);
    for (const fn of ['generate', 'oracle', 'referenceSolve']) assert.equal(typeof F[fn], 'function');
    if (entry.kind === 'interactive') assert.equal(typeof F.createEnv, 'function');
    assert.ok(F.outputSchema && typeof F.outputSchema === 'object');
    const names = F.badControls.map(c => c.name);
    for (const n of ['empty', 'shuffled-or-corrupted', 'plausible-but-wrong']) assert.ok(names.includes(n), `${id} missing control ${n}`);
    let refPass = 0, refTotal = 0, badFail = 0, badTotal = 0, det = 0, detTotal = 0;
    for (const difficulty of [1, 3, 5]) for (let seed = 1; seed <= 10; seed++) {
      const a = F.generate({ seed, split: 'test', difficulty }), b = F.generate({ seed, split: 'test', difficulty });
      detTotal++; if (canonical(a) === canonical(b) && canonical(a) !== canonical(F.generate({ seed: seed + 100, split: 'test', difficulty }))) det++;
      refTotal++; if (F.oracle(a, F.referenceSolve(a)).pass) refPass++;
      for (const c of F.badControls) { badTotal++; if (!F.oracle(a, c.make(a)).pass) badFail++; }
    }
    assert.equal(det, detTotal, `${id} determinism ${det}/${detTotal}`);
    assert.equal(refPass, refTotal, `${id} reference ${refPass}/${refTotal}`);
    assert.equal(badFail, badTotal, `${id} bad controls failing ${badFail}/${badTotal}`);
  });

  test(`${id}: archived family test file passes`, () => {
    const dir = extractSealed(id);
    try {
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
      const r = spawnSync(process.execPath, ['--test', join(dir, `${id}.test.mjs`)], { encoding: 'utf8', env, timeout: 300000 });
      const pass = Number((/ℹ pass (\d+)/.exec(r.stdout) || [])[1] ?? NaN), fail = Number((/ℹ fail (\d+)/.exec(r.stdout) || [])[1] ?? NaN);
      assert.ok(r.status === 0 && fail === 0 && pass > 0, `${id} archived tests: pass=${pass} fail=${fail} exit=${r.status}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
