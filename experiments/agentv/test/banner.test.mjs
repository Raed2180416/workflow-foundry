// The prereg banner's build-level unit (register B7; research/PREREGISTRATION-TEMPLATE.md §4). $0.
//   nice -n 15 node --test --test-concurrency=1 experiments/agentv/test/banner.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bannerUnit, preregBanner, PREREG_FILE } from '../run.mjs';

const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const bannerFile = body => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'agentv-banner-')); dirs.push(d);
  const f = path.join(d, 'PREREG.md');
  writeFileSync(f, `# P\n\n\`\`\`prereg-banner\n${body}\n\`\`\`\n`);
  return f;
};
const BASE = 'MDE        see the build-level line\nPREDICTION C-H >= B1L-H - 0.05\nREFUTED    if the interval lies below -0.05';

test('legacy banner (AGENTV-E8): accepted and labelled case-unit; the frozen file still parses', () => {
  const b = preregBanner(PREREG_FILE);
  assert.equal(b.buildLevel, null); assert.match(b.unit, /^case \(legacy/);
  assert.match(b.text, /MDE/);
});

test('UNIT build: the banner must carry K, CASES, SD_RATES or SIGMA_B, and STOP; the MDE is computed, not trusted', () => {
  const ok = preregBanner(bannerFile(`UNIT       build\nK          8\nCASES      1022\nSD_RATES   0.03\nSTOP       blocks of 2 builds, O'Brien-Fleming, K_max 12\n${BASE}`));
  assert.equal(ok.unit, 'build'); assert.equal(ok.buildLevel.K, 8); assert.equal(ok.buildLevel.cases, 1022);
  assert.ok(ok.buildLevel.resolvable && ok.buildLevel.mde > 0.03 && ok.buildLevel.mde < 0.06, `MDE ${ok.buildLevel.mde}`);
  assert.match(ok.buildLevel.line, /BUILD-LEVEL MDE .* at K = 8 per arm, 1022 cases per build/);
  // At small K the MDE is simulated with the exact permutation test (the t form understates it there).
  const k4 = bannerUnit(`UNIT build\nK 4\nCASES 1022\nSD_RATES 0.03\nSTOP blocks of 2\n${BASE}`);
  assert.match(k4.buildLevel.line, /simulated exact permutation\): 8\.9 points at K = 4/);
  // K = 3 per arm: the exact build-level test can never reach p < 0.05; the banner says so.
  const k3 = bannerUnit(`UNIT build\nK 3\nCASES 1022\nSIGMA_B 0.05\nSTOP fixed K = 3\n${BASE}`);
  assert.equal(k3.buildLevel.resolvable, false); assert.equal(k3.buildLevel.mde, Infinity);
  assert.match(k3.buildLevel.line, /cannot resolve at K = 3/);
  // Below the template's 400 cases per build: flagged.
  assert.match(bannerUnit(`UNIT build\nK 8\nCASES 14\nSIGMA_B 0.08\nSTOP x\n${BASE}`).buildLevel.line, /below the template's 400 cases/);
  // Missing fields: refused.
  assert.throws(() => preregBanner(bannerFile(`UNIT build\nK 8\n${BASE}`)), /lacks CASES, SD_RATES or SIGMA_B, STOP/);
  assert.throws(() => bannerUnit(`UNIT build\nK 1\nCASES 400\nSIGMA_B 0.08\nSTOP x`), /lacks K/);
  // Another declared unit passes through without a build-level line.
  assert.deepEqual(bannerUnit(`UNIT task (paired, k = 1)\n${BASE}`), { unit: 'task (paired, k = 1)', buildLevel: null });
});
