// The E-bed blocks of research/jit-20261008/SEED-LEDGER.json (E-BED §6; BED-CONTRACT-v1.1 §10): every item E1-E13 has
// its dev, rehearsal, held-out and sealed blocks (scale for the core items E1-E9), numerically disjoint from every other
// bounded range, and the ledger's refusal rules (experiments/jit/seeds.mjs) keep each block for its own purpose. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLedger, assertSeedsAllowed, seedRefusals } from '../jit/seeds.mjs';
import { ledgerReservationOf } from '../kev-data/lib/registry.mjs';
import { assertEbedSeeds, ebedSeedRefusals, isEbedBed } from './ebed-seeds.mjs';

const L = loadLedger();
const ITEMS = Array.from({ length: 13 }, (_, i) => `ebed-e${i + 1}`);
const CORE = ITEMS.slice(0, 9);
const ebed = L.ranges.filter(r => r.owner === 'ebed');
const span = r => [r.split, r.from, r.to];

test('every item has its blocks at the E-BED §6 seeds; scale only for E1-E9', () => {
  for (const bed of ITEMS) {
    const mine = ebed.filter(r => r.beds.includes(bed));
    const blocks = Object.fromEntries(mine.map(r => [r.id.replace(`${bed}-`, '').replace(/^ebed-/, ''), span(r)]));
    const want = { dev: ['dev', 1001, 1199], 'dev-fuzz': ['dev', 1301, 1310], rehearsal: ['dev', 1201, 1249],
      'heldout-ab': ['test', 9101, 9102], 'heldout-cd': ['test', 9103, 9104], sealed: ['test', 9201, 9204] };
    if (CORE.includes(bed)) want.scale = ['test', 9301, 9302];
    assert.deepEqual(blocks, want, bed);
  }
  // Shared dev blocks name all thirteen beds; every other E-bed range names exactly one.
  for (const r of ebed) assert.deepEqual(r.beds, ['ebed-dev', 'ebed-dev-fuzz'].includes(r.id) ? ITEMS : [r.id.split('-').slice(0, 2).join('-')], r.id);
  assert.equal(ebed.length, 2 + 13 * 4 + 9);
  // Test-split blocks are reserved for E-bed purposes only and are held-out (>= 8001).
  for (const r of ebed.filter(x => x.split === 'test')) {
    assert.equal(r.status, 'reserved', r.id); assert.ok(r.from >= L.rules.heldoutMinSeed, r.id);
    assert.equal(r.allow.length, 1); assert.ok(L.purposes[r.allow[0]].heldout && L.purposes[r.allow[0]].fresh, r.id);
  }
});

test('E-bed ranges are disjoint from every other bounded range (any bed) and from each other within a bed', () => {
  const others = L.ranges.filter(r => r.owner !== 'ebed');
  for (const r of ebed) for (const o of others) {
    if (o.split !== r.split) continue;
    if (o.to === null) { assert.equal(o.status, 'clean', `${o.id}: only the clean open row may contain E-bed seeds`); continue; }
    assert.ok(o.to < r.from || o.from > r.to, `${r.id} overlaps ${o.id}`);
  }
  for (const r of ebed) for (const o of ebed) {
    if (o === r || o.split !== r.split || !o.beds.some(b => r.beds.includes(b))) continue;
    assert.ok(o.to < r.from || o.from > r.to, `${r.id} overlaps ${o.id} on a shared bed`);
  }
});

test('refusals: each block serves its own purpose; the default held-out purpose cannot take E-bed worlds', () => {
  const ok = (bed, split, seeds, purpose) => assert.doesNotThrow(() => assertSeedsAllowed({ bed, split, seeds, purpose, ledger: L }), `${bed} ${split} ${seeds} ${purpose}`);
  const no = (bed, split, seed, purpose, re) => assert.throws(() => assertSeedsAllowed({ bed, split, seeds: [seed], purpose, ledger: L }), e => e.code === 'SEED_REFUSED' && re.test(e.message), `${bed} ${seed} ${purpose}`);
  ok('ebed-e8', 'dev', [1001, 1100, 1199, 1301, 1310], 'jit-dev');
  ok('ebed-e1', 'dev', [1201, 1206, 1211, 1222, 1231, 1232, 1249], 'ebed-rehearsal');
  no('ebed-e1', 'dev', 1201, 'jit-dev', /ebed-e1-rehearsal .*reserved for ebed-rehearsal/);
  no('ebed-e1', 'dev', 1100, 'ebed-rehearsal', /ebed-dev .*reserved for jit-dev/);
  ok('ebed-e8', 'test', [9101, 9102, 9103, 9104], 'ebed-heldout');
  no('ebed-e8', 'test', 9101, 'jit-heldout', /ebed-e8-heldout-ab .*reserved for ebed-heldout/);
  no('ebed-e8', 'test', 9201, 'ebed-heldout', /ebed-e8-sealed .*reserved for ebed-sealed/);
  ok('ebed-e8', 'test', [9201, 9204], 'ebed-sealed');
  ok('ebed-e6', 'test', [9301, 9302], 'ebed-scale');
  no('ebed-e6', 'test', 9101, 'ebed-scale', /reserved for ebed-heldout/);
  no('ebed-e1', 'test', 7300, 'ebed-heldout', /held-out seeds must be >= 8001/);
  no('ebed-e1', 'dev', 9101, 'ebed-heldout', /ebed-heldout is for the test split/);
  // Other beds are untouched: the same numbers are free for records (jit-heldout, test-clean) and Kev's probe range rules.
  ok('records', 'test', [9101, 9201, 9301], 'jit-heldout');
  assert.deepEqual(seedRefusals(L, { bed: 'records', split: 'dev', seed: 1201, purpose: 'jit-dev' }), []);
});

test('per-item status: a consumed block refuses its own worlds only', () => {
  const used = structuredClone(L);
  used.ranges.find(r => r.id === 'ebed-e8-heldout-ab').status = 'used';
  assert.match(seedRefusals(used, { bed: 'ebed-e8', split: 'test', seed: 9101, purpose: 'ebed-heldout' }).join(';'), /ebed-e8-heldout-ab is used and ebed-heldout needs fresh seeds/);
  assert.deepEqual(seedRefusals(used, { bed: 'ebed-e8', split: 'test', seed: 9103, purpose: 'ebed-heldout' }), [], 'K = 4 worlds C-D stay fresh');
  assert.deepEqual(seedRefusals(used, { bed: 'ebed-e1', split: 'test', seed: 9101, purpose: 'ebed-heldout' }), [], 'another item is unaffected');
});

test('confinement (review finding 10): the E-bed runner\'s check keeps every E-bed seed inside its own block', () => {
  // The ledger alone accepts these: no range covers the seed, so nothing refuses it.
  const escapes = [['ebed-e1', 'test', 9105, 'ebed-heldout'], ['ebed-e1', 'test', 8900, 'ebed-heldout'], ['ebed-e1', 'test', 9999, 'ebed-sealed'],
    ['records', 'test', 9101, 'ebed-heldout'], ['ebed-e1', 'test', 9105, 'jit-heldout'], ['ebed-e10', 'test', 9301, 'ebed-scale']];
  for (const [bed, split, seed, purpose] of escapes) {
    assert.deepEqual(seedRefusals(L, { bed, split, seed, purpose }), [], `ledger alone: ${bed} ${seed} ${purpose}`);
    assert.throws(() => assertEbedSeeds({ bed, split, seeds: [seed], purpose, ledger: L }), e => e.code === 'SEED_REFUSED', `confined: ${bed} ${seed} ${purpose}`);
  }
  assert.match(ebedSeedRefusals(L, { bed: 'ebed-e1', split: 'test', seed: 9105, purpose: 'ebed-heldout' }).join(';'), /outside every E-bed block of ebed-e1/);
  assert.match(ebedSeedRefusals(L, { bed: 'records', split: 'test', seed: 9101, purpose: 'ebed-heldout' }).join(';'), /for the E-bed beds/);
  // Every seed of every block passes for its own purpose; the ledger's own refusals still apply.
  for (const r of ebed) {
    const purpose = r.allow[0];
    for (const bed of r.beds) assert.doesNotThrow(() => assertEbedSeeds({ bed, split: r.split, seeds: [r.from, r.to], purpose, ledger: L }), `${r.id} ${bed}`);
  }
  assert.throws(() => assertEbedSeeds({ bed: 'ebed-e8', split: 'test', seeds: [9201], purpose: 'ebed-heldout', ledger: L }), /reserved for ebed-sealed/);
  assert.deepEqual(['ebed-e1', 'ebed-e13', 'ebed-e14', 'ebed-dev', 'records'].map(isEbedBed), [true, true, false, false, false]);
});

test('the Kev factory holds the E-bed ranges for the E-bed beds only', () => {
  assert.equal(ledgerReservationOf({ bed: 'ebed-e1', split: 'test', difficulty: 3, seed: 9101 })?.id, 'ebed-e1-heldout-ab');
  assert.equal(ledgerReservationOf({ bed: 'ebed-e5', split: 'dev', difficulty: 2, seed: 1050 })?.id, 'ebed-dev');
  assert.equal(ledgerReservationOf({ bed: 'records', split: 'test', difficulty: 3, seed: 9101 }), null);
  assert.equal(ledgerReservationOf({ bed: 'records', split: 'dev', difficulty: 3, seed: 1050 }), null);
});
