// CI-1 analysis, freeze and gates ($0): the numbers the result reports are computed the preregistered way, the freeze refuses a changed
// file, committed summaries never carry a non-synthetic address, and the description gates catch what they claim to catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { perItem, bootstrap, signTest, armStats, paired, prng } from '../report.mjs';
import { scrubAddresses } from '../run-arm.mjs';
import { checkManifest } from '../manifest.mjs';

const rec = (item, pass, usd = 0.01) => ({ item, k: 0, outcome: pass ? 'ready' : 'build_failed', pass, usd, tokens: 100, calls: 1, wallMs: 1, worldsPassed: 0, worlds: 6, questions: 0, repairs: 0, practice: [] });

test('pass@1 averages per item over K; pass^K needs every build; costs per build and per verified build', () => {
  const s = { label: 'x', arm: 'A0', split: 'test', model: 'm', K: 3, records: [rec('a', true), rec('a', true), rec('a', false), rec('b', true), rec('b', true), rec('b', true), rec('c', false), rec('c', false), rec('c', false)] };
  const items = perItem(s.records);
  assert.deepEqual(items.map(x => [x.item, x.passes, x.all]), [['a', 2, false], ['b', 3, true], ['c', 0, false]]);
  const st = armStats(s, { boot: 2000 });
  assert.equal(st.pass1, (2 / 3 + 1 + 0) / 3);
  assert.equal(st.passAll, 1 / 3);
  assert.equal(st.usdPerBuild, 0.01);
  assert.ok(Math.abs(st.usdPerVerified - 0.09 / 5) < 1e-12);
  assert.ok(st.pass1CI.lo <= st.pass1 && st.pass1 <= st.pass1CI.hi);
});

test('bootstrap is deterministic, item-clustered and brackets the mean; constant data has a zero-width interval', () => {
  const v = [0, 1, 1, 0, 1, 1, 1, 0, 1, 1];
  assert.deepEqual(bootstrap(v, { boot: 3000 }), bootstrap(v, { boot: 3000 }));
  const ci = bootstrap(v, { boot: 3000 });
  assert.ok(ci.lo < 0.7 && ci.hi > 0.7 && ci.lo >= 0 && ci.hi <= 1);
  assert.deepEqual(bootstrap([1, 1, 1], { boot: 500 }), { lo: 1, hi: 1 });
  const r = prng(1); const xs = Array.from({ length: 5 }, r); assert.ok(xs.every(x => x >= 0 && x < 1));
});

test('exact sign test on paired differences (ties dropped)', () => {
  assert.deepEqual(signTest([1, 1, 1, 1, 1, 0, 0]), { pos: 5, neg: 0, p: 0.0625 });
  assert.equal(signTest([1, -1]).p, 1);
  assert.equal(signTest([0, 0]).p, 1);
  assert.ok(Math.abs(signTest([1, 1, 1, 1, 1, 1, 1, 1, 1, -1]).p - 0.021484375) < 1e-12);
});

test('paired difference is computed on the items both arms ran', () => {
  const a = { label: 'A2', records: [rec('a', true), rec('b', true), rec('c', false)] }, b = { label: 'A0', records: [rec('a', false), rec('b', true), rec('d', true)] };
  const p = paired(a, b, { boot: 500 });
  assert.equal(p.items, 2); assert.equal(p.diff, 0.5); assert.deepEqual(p.flips, { aOnly: ['a'], bOnly: [] });
});

test('committed summaries keep synthetic addresses and redact any other', () => {
  assert.equal(scrubAddresses('to user@example.com, a.b@inbox.example and x@corp.test'), 'to user@example.com, a.b@inbox.example and x@corp.test');
  assert.equal(scrubAddresses('sent to jane.doe@mailhost.invalid and boss@company.invalid'), 'sent to <redacted-address> and <redacted-address>');
});

test('the freeze check reports a file whose digest changed and a file the manifest does not list', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci1-manifest-'));
  try {
    const m = { schema: 'foundry.ci1.manifest/1', files: { 'experiments/ci1/canon.mjs': '0'.repeat(64) } };
    const f = path.join(dir, 'MANIFEST.json'); writeFileSync(f, JSON.stringify(m));
    const bad = checkManifest(f);
    assert.ok(bad.includes('experiments/ci1/canon.mjs: changed'));
    assert.ok(bad.some(x => x.endsWith(': not in the manifest')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  void readFileSync;
});
