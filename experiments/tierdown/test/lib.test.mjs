// Tier-down library tests (A10 / #42): perturbations, the override module, the dev-only guard, site names, outcomes and
// the promotion policy. $0, no sandbox, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { perturbations, samplePerturbations, decisionPoints, swapDayMonth } from '../perturb.mjs';
import { requestKeyOf, canonical } from '../override.mjs';
import { assertDevRow, assertDevPath, phaseOf } from '../archive.mjs';
import { siteNameOf, outcomeOf } from '../leverage.mjs';
import { leverageClass, zeroFlipUnits, bound1, bound2, fixedSequence, mcnemarExact, nonInferior, costSaved, cascadeOf, shadowCount, demotionMonitor } from '../policy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('perturbations: one decision leaf at a time, evidence never touched', () => {
  const schema = { type: 'object', properties: { order: { enum: ['DMY', 'MDY', 'none'] }, sign: { enum: ['same', 'opposite'] }, quote: { type: 'string' }, ok: { type: 'boolean' } } };
  const v = { order: 'DMY', sign: 'same', quote: 'day first', ok: true };
  const ps = perturbations(v, schema);
  // enum DMY -> MDY and none (both neighbours), sign -> opposite, bool flip; quote is evidence.
  assert.deepEqual(ps.map(p => `${p.kind}:${p.path.join('.')}:${p.to}`).sort(), ['bool:ok:false', 'enum:order:MDY', 'enum:order:none', 'enum:sign:opposite']);
  for (const p of ps) {
    const changed = Object.keys(v).filter(k => canonical(v[k]) !== canonical(p.value[k]));
    assert.deepEqual(changed, [p.path[0]], 'exactly one leaf changed');
    assert.equal(p.value.quote, 'day first');
  }
  assert.equal(v.order, 'DMY', 'the input is not mutated');
});

test('perturbations: lists (drop first/last, dup), sibling swap, dates, numbers', () => {
  const v = { items: [{ id: 'a', country: 'France', dob: '2023-05-08', n: 3, x: 1.5 }, { id: 'b', country: 'Spain', dob: '1999-12-31', n: 0, x: 2 }, { id: 'c', country: 'Italy', dob: 'n/a', n: 1, x: 0.5 }] };
  const ps = perturbations(v, null);
  const kinds = ps.reduce((m, p) => ({ ...m, [p.kind]: (m[p.kind] ?? 0) + 1 }), {});
  assert.equal(kinds.drop, 2); assert.equal(kinds.dup, 1);
  const drop = ps.filter(p => p.kind === 'drop');
  assert.deepEqual(drop.map(p => p.value.items.map(i => i.id).join('')).sort(), ['ab', 'bc']);
  assert.equal(ps.find(p => p.kind === 'dup').value.items.length, 4);
  const date = ps.filter(p => p.kind === 'date');
  assert.deepEqual(date.map(p => p.to), ['2023-08-05'], 'only the date with a valid swapped reading');
  const swap = ps.find(p => p.kind === 'swap' && p.path.join('.') === 'items.0.country');
  assert.equal(swap.to, 'Spain');
  assert.equal(ps.find(p => p.kind === 'int' && p.path.join('.') === 'items.1.n').to, 1, 'n = 0 gets +1 only');
  assert.equal(ps.filter(p => p.kind === 'int' && p.path.join('.') === 'items.0.n').length, 2);
  assert.equal(ps.find(p => p.kind === 'num' && p.path.join('.') === 'items.0.x').to, 1.875);
  assert.equal(swapDayMonth('05/08/2023'), '08/05/2023');
  assert.equal(swapDayMonth('13/08/2023'), null);
  assert.equal(swapDayMonth('2023-05-05'), null, 'identical day and month: no different reading');
});

test('samplePerturbations: deterministic, bounded, spread over kinds', () => {
  const v = { a: [1, 2, 3, 4], b: { enum: 'x' }, flags: [true, false, true, false, true] };
  const all = perturbations(v, { properties: { b: { properties: { enum: { enum: ['x', 'y'] } } } } });
  const s1 = samplePerturbations(all, 4, 'seed'), s2 = samplePerturbations(all, 4, 'seed');
  assert.deepEqual(s1, s2);
  assert.equal(s1.length, 4);
  assert.equal(new Set(s1.map(p => p.kind)).size, 4, 'four different kinds before any repeat');
  assert.equal(samplePerturbations(all, 1000, 'x').length, all.length);
  assert.equal(samplePerturbations([], 3, 'x').length, 0);
});

test('decisionPoints skips evidence keys at every depth', () => {
  const pts = decisionPoints({ a: 1, reason: 'r', items: [{ quote: 'q', v: 2 }] });
  assert.deepEqual(pts.map(p => p.path.join('.')), ['a', 'items', 'items.0.v']);
});

test('override module: serves by request key across tiers, logs every call, samples in order', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tierdown-ov-'));
  try {
    mkdirSync(path.join(dir, 'tools'));
    copyFileSync(path.join(HERE, '..', 'override.mjs'), path.join(dir, 'tools', 'flow-override.mjs'));
    const reqA = { model: 'claude-opus-5-5', system: 's', prompt: 'p', schema: { type: 'object' }, decoding: { reasoning: 'none' } };
    const reqB = { ...reqA, prompt: 'other' };
    const key = requestKeyOf(reqA);
    assert.equal(key, requestKeyOf({ ...reqA, model: 'claude-haiku-5-5', decoding: { reasoning: 'high' } }), 'the key ignores model and decoding');
    assert.notEqual(key, requestKeyOf(reqB));
    writeFileSync(path.join(dir, 'tools', 'flow-override.json'), JSON.stringify({ log: true, serve: [{ key, values: [{ v: 1 }, { v: 2 }] }, { key: requestKeyOf(reqB), error: 'invalid' }] }));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const mod = await import(pathToFileURL(path.join(dir, 'tools', 'flow-override.mjs')).href + '?t=' + Date.now());
      const site = (tier, sample) => ({ id: `j#${sample}:x`, name: 'j', ordinal: sample, digest: 'd', tier, tierIndex: 0, sample });
      assert.deepEqual(mod.default(site('claude-opus-5-5', 0), reqA), { value: { v: 1 } });
      assert.deepEqual(mod.default(site('claude-haiku-5-5', 1), { ...reqA, model: 'claude-haiku-5-5' }), { value: { v: 2 } });
      assert.deepEqual(mod.default(site('claude-opus-5-5', 2), reqA), { value: { v: 2 } }, 'past the end: the last value again');
      assert.deepEqual(mod.default(site('x', 0), reqB), { error: 'invalid' });
      assert.equal(mod.default(site('x', 0), { ...reqA, prompt: 'unknown' }), undefined, 'unknown requests go to the port');
      const log = readFileSync(path.join(dir, 'override-log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
      assert.equal(log.length, 5);
      assert.deepEqual(log.map(l => l.served), [true, true, true, true, false]);
      assert.ok(log.every(l => /^[0-9a-f]{16}$/.test(l.sys) && /^[0-9a-f]{16}$/.test(l.sch)));
    } finally { process.chdir(cwd); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('dev-only guard refuses sealed paths, devCheck, non-dev splits and test seeds', () => {
  assert.throws(() => assertDevPath('/x/beds/sealed/records'), /SEALED_PATH/);
  assert.throws(() => assertDevPath('/x/research/a1c/devCheck/run'), /SEALED_PATH/);
  assert.doesNotThrow(() => assertDevPath('/x/research/jit-20261008/runs'));
  assert.deepEqual(assertDevRow({ idx: 0, taskKey: 'records:dev:d3:s201' }), { family: 'records', split: 'dev', difficulty: 3, seed: 201 });
  assert.throws(() => assertDevRow({ idx: 0, taskKey: 'records:test:d3:s201' }), /NOT_DEV/);
  assert.throws(() => assertDevRow({ idx: 0, taskKey: 'records:dev:d3:s7001' }), /TEST_SEED/);
  assert.throws(() => assertDevRow({ idx: 0, taskKey: 'records:dev:d3:s201' }, { split: 'heldout', experiment: 'e', slug: 's' }), /NOT_DEV/);
  assert.throws(() => assertDevRow({ idx: 0, taskKey: 'garbage' }), /BAD_TASK_KEY/);
});

test('phases and site names', () => {
  assert.equal(phaseOf('compile:v1-haiku55:6f4f3b73-6122-42cd-860e-392eca3c8627'), 'compile');
  assert.equal(phaseOf('jit-check:v3-haiku55:abc'), 'check');
  assert.equal(phaseOf('jit-dev-records-1:jit-claude-opus-5-5--claude-haiku-5-5:23:v3:uuid'), 'delivery');
  assert.equal(phaseOf('jit-dev-records-1:agent:3:interpreter'), 'other');
  assert.equal(siteNameOf('vendex-3'), 'vendex-*');
  assert.equal(siteNameOf('extract:DOC-7'), 'extract:*');
  assert.equal(siteNameOf('apply:d1:k2'), 'apply:*');
  assert.equal(siteNameOf('decide-17'), 'decide-*');
  assert.equal(siteNameOf('prose-events-a'), 'prose-events-a');
  assert.equal(siteNameOf('rules'), 'rules');
});

test('outcomeOf classifies against the base replay', () => {
  const base = { output: { a: 1 }, pass: true };
  assert.equal(outcomeOf(base, { status: 'ok', output: { a: 1 }, pass: true, memo: { misses: 0 } }), 'same');
  assert.equal(outcomeOf(base, { status: 'ok', output: { a: 2 }, pass: true, memo: { misses: 0 } }), 'changed');
  assert.equal(outcomeOf(base, { status: 'ok', output: { a: 2 }, pass: false, memo: { misses: 0 } }), 'flip');
  assert.equal(outcomeOf(base, { status: 'deopt', memo: { misses: 0 } }), 'deopt');
  assert.equal(outcomeOf(base, { status: 'crash', memo: { misses: 0 } }), 'crash');
  assert.equal(outcomeOf(base, { status: 'ok', output: { a: 2 }, pass: false, memo: { misses: 1 } }), 'unmeasured', 'a replay miss is never a flip');
  assert.equal(outcomeOf(base, { status: 'deopt', memo: { misses: 2 } }), 'unmeasured');
});

test('policy: leverage classes, zero-flip unit counts (success-run theorem), bounds', () => {
  assert.equal(leverageClass(0).name, 'low'); assert.equal(leverageClass(0.049).name, 'low');
  assert.equal(leverageClass(0.05).name, 'mid'); assert.equal(leverageClass(0.2).name, 'high');
  assert.equal(leverageClass(null).name, 'high'); assert.ok(leverageClass(null).unmeasured);
  assert.equal(zeroFlipUnits(0.10), 29); assert.equal(zeroFlipUnits(0.05), 59); assert.equal(zeroFlipUnits(0.02), 149);
  assert.equal(bound1({ flips: 0, units: 29, delta: 0.10 }).holds, true);
  assert.equal(bound1({ flips: 0, units: 28, delta: 0.10 }).holds, false, 'one unit short');
  assert.equal(bound1({ flips: 1, units: 29, delta: 0.10 }).holds, false, 'one flip at the minimum n fails');
  assert.equal(bound1({ flips: 0, units: 0, delta: 0.10 }).holds, false, 'no units, no promotion');
  assert.throws(() => bound1({ flips: 3, units: 2, delta: 0.1 }));
  assert.equal(bound2({ disagreement: 0.04, usable: 96, answered: 100 }).holds, true);
  assert.equal(bound2({ disagreement: 0.06, usable: 100, answered: 100 }).holds, false);
  assert.equal(bound2({ disagreement: 0.0, usable: 94, answered: 100 }).holds, false, 'usable rate below 0.95');
  assert.equal(bound2({ disagreement: 0.0, usable: 10, answered: 100, rule: true }).holds, true, 'a rule tier abstains into the reference');
  assert.equal(bound2({ disagreement: null, usable: 0, answered: 0, rule: true }).holds, false);
});

test('policy: fixed-sequence testing stops at the first failure', () => {
  const r = fixedSequence([{ id: 'a', ok: true }, { id: 'b', ok: false }, { id: 'c', ok: true }], c => ({ holds: c.ok }));
  assert.deepEqual(r.map(x => x.verdict), ['promote', 'keep-reference', 'not-tested']);
  assert.equal(r[2].stoppedBy, 'b');
});

test('policy: exact McNemar and non-inferiority', () => {
  assert.equal(mcnemarExact(0, 0), 1);
  assert.ok(Math.abs(mcnemarExact(0, 6) - 2 * 0.5 ** 6) < 1e-12);
  assert.ok(Math.abs(mcnemarExact(5, 5) - 1) < 1e-12);
  // 0 losses in 99 units: upper bound 0.0298 < 0.03; in 98 it is not.
  assert.equal(nonInferior({ b: 0, c: 0, n: 99 }).holds, true);
  assert.equal(nonInferior({ b: 0, c: 0, n: 98 }).holds, false);
  assert.equal(nonInferior({ b: 1, c: 0, n: 60 }).holds, false);
  assert.equal(nonInferior({ b: 0, c: 0, n: 0 }).holds, false);
  assert.equal(costSaved(1, 4), 0.75); assert.equal(costSaved(1, 0), null);
});

test('policy: cascade, shadow count and CUSUM demotion', () => {
  assert.deepEqual(cascadeOf({ site: 's', tier: 'claude-haiku-5-5', reference: ['claude-opus-5-5'] }).tiers, ['claude-haiku-5-5', 'claude-opus-5-5']);
  assert.deepEqual(cascadeOf({ site: 's', tier: 'rule', reference: ['claude-haiku-5-5', 'rule'] }).tiers, ['rule', 'claude-haiku-5-5']);
  assert.equal(shadowCount(100), 10); assert.equal(shadowCount(0), 0); assert.equal(shadowCount(2), 2);
  const quiet = demotionMonitor(Array(200).fill(0).map((_, i) => (i % 50 === 0 ? 1 : 0)), { p0: 0.02 });
  assert.equal(quiet.demote, false, 'disagreement at the expected rate never demotes');
  const drift = demotionMonitor([...Array(50).fill(0), ...Array(10).fill(1)], { p0: 0.02 });
  assert.equal(drift.demote, true);
  assert.ok(drift.firstAlarm >= 50 && drift.firstAlarm <= 55, `alarm soon after drift (at ${drift.firstAlarm})`);
  assert.throws(() => demotionMonitor([0], { p0: 0 }));
});
