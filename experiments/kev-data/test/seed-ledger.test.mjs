// The JIT seed ledger in the Kev registry (BLOCKER-SYNTHESIS S0-5): a world in a range that another owner holds as reserved
// or fresh (research/jit-20261008/SEED-LEDGER.json) enters no Kev slice; Kev's own reserves and every other world behave
// as before. $0, no model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reservedViolation, assertNoReserved, reservationOf, ledgerReservationOf, ledgerHeldRanges, LEDGER_FILE, RESERVATIONS } from '../lib/registry.mjs';

test('the Kev registry refuses the JIT ledger\'s reserved and fresh ranges in every slice', () => {
  for (const slice of ['train', 'calib-in', 'dev-select', 'test-in', 'real-reserve', 'e2e-reserve']) {
    assert.equal(reservedViolation('records:test:d3:s8001', slice)?.reservation, 'ledger:jit-heldout-a', slice);
    assert.equal(reservedViolation('kinetics:test:d5:s8124', slice)?.reservation, 'ledger:jit-heldout-b', slice);
    assert.equal(reservedViolation('gridquest:test:d4:s8010', slice)?.reservation, 'ledger:jit-heldout-a', `${slice}: held-out ranges hold every bed`);
    assert.equal(reservedViolation('records:dev:d3:s230', slice)?.reservation, 'ledger:jit-r0-fresh', slice);
    assert.equal(reservedViolation('kinetics:dev:d4:s260', slice)?.reservation, 'ledger:jit-oos-fresh', slice);
  }
  assert.throws(() => assertNoReserved([{ bed: 'records', split: 'test', difficulty: 3, seed: 8101 }], 'test-in'), e => e.code === 'RESERVED_WORLD' && /ledger:jit-heldout-b/.test(e.message));
  // the ledger check does not change reservationOf (meta.reserved) or Kev's own reserves
  assert.equal(reservationOf('records:test:d3:s8001'), null);
  assert.equal(reservedViolation('records:test:d3:s7001', 'real-reserve'), null, 'Kev\'s own reserve, in its own slice');
  assert.equal(reservedViolation('records:test:d3:s7041', 'e2e-reserve'), null);
  assert.equal(reservedViolation('records:test:d3:s7001', 'train').reservation, 'real-reserve');
  assert.equal(reservedViolation('records:dev:d3:s101', 'train').reservation, 'probe-pilot');
  // used and burned ranges are spent, not held: they never block a Kev slice beyond Kev's own rules
  assert.equal(reservedViolation('synth:test:d3:s7050', 'e2e-reserve'), null);
  assert.equal(reservedViolation('records:test:d3:s5003', 'test-in'), null);
  assert.equal(reservedViolation('records:test:d3:s8200', 'test-in'), null, 'clean test seeds outside the held-out ranges');
  assert.equal(reservedViolation('records:dev:d3:s401', 'train'), null);
  assert.equal(ledgerReservationOf({ bed: 'records', split: 'dev', difficulty: 3, seed: 201 }), null, 'used dev streams are not held');
});

test('the registry reads the ledger file itself: only non-Kev reserved or fresh ranges; Kev\'s ledger ranges mirror RESERVATIONS', () => {
  const ledger = JSON.parse(readFileSync(LEDGER_FILE, 'utf8'));
  const held = ledgerHeldRanges().map(r => r.id).sort();
  assert.deepEqual(held, ledger.ranges.filter(r => r.owner !== 'kev' && ['reserved', 'fresh'].includes(r.status)).map(r => r.id).sort());
  assert.deepEqual(held, ['jit-heldout-a', 'jit-heldout-b', 'jit-oos-fresh', 'jit-r0-fresh']);
  assert.deepEqual(ledger.ranges.filter(r => r.owner === 'kev').map(r => [r.id, r.split, r.from, r.to, r.beds]).sort(),
    RESERVATIONS.map(r => [`kev-${r.id}`, r.bedSplit, r.seeds[0], r.seeds[1], ['*']]).sort());
});
