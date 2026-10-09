// Shared W-bed primitives: dates, money, references, contracts, fault hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayNum, fmtDate, parseDate, swappedDay, isoDay, refKey, roundHalfAway, quoteLine, mulRate, divRate, toUsdCents, lastDayOfMonth } from './domain.mjs';
import { taskRng } from './prng.mjs';
import { contract, obj, int, str } from './contracts.mjs';
import { requireNoFaults, hooks, faultsAt, FAULT_KINDS, PREREG_SCHEDULE } from './faults.mjs';

test('date styles round-trip and swaps', () => {
  const r = taskRng('lib', 'dates', { seed: 1, split: 'dev', difficulty: 3 });
  for (let i = 0; i < 300; i++) {
    const day = r.int(dayNum(2024, 1, 1), dayNum(2025, 12, 31));
    for (const style of ['MDY', 'DMY', 'DMY_DOT', 'YMD_SLASH', 'ISO', 'DMY_DASH_YY', 'WORDS_DMY', 'WORDS_MDY']) {
      assert.equal(parseDate(fmtDate(day, style), style), day, `${style} ${isoDay(day)}`);
    }
  }
  assert.equal(isoDay(swappedDay(dayNum(2025, 7, 5))), '2025-05-07');
  assert.equal(swappedDay(dayNum(2025, 7, 13)), null);
  assert.equal(swappedDay(dayNum(2025, 7, 7)), null);
  assert.equal(isoDay(lastDayOfMonth(2025, 2)), '2025-02-28');
  assert.equal(isoDay(lastDayOfMonth(2025, 12)), '2025-12-31');
});

test('money: exact rounding and quote lines', () => {
  assert.equal(roundHalfAway(5, 2), 3);
  assert.equal(roundHalfAway(-5, 2), -3);
  assert.equal(roundHalfAway(4, 3), 1);
  assert.equal(quoteLine('EUR', mulRate(1104000)), 'EUR/USD  1.1040');
  assert.equal(quoteLine('JPY', divRate(1438737)), 'USD/JPY  143.8737');
  assert.equal(toUsdCents(10000, 'EUR', mulRate(1104000)), 11040);
  assert.equal(toUsdCents(1000, 'JPY', divRate(1438737)), 695); // 1000 / 143.8737 = 6.9505 USD
});

test('invoice reference keys ignore case, spaces, hyphens and slashes', () => {
  assert.equal(refKey('AT/7781'), refKey('at 7781'));
  assert.equal(refKey('RE-25-0456'), refKey('re250456'));
  assert.notEqual(refKey('V-1234'), refKey('VR-1234'));
});

test('contracts validate typed hand-offs', () => {
  const c = contract('t', obj({ a: int, b: str(5) }));
  assert.deepEqual(c.check({ a: 1, b: 'x' }), []);
  assert.ok(c.check({ a: '1', b: 'x' }).length);
  assert.ok(c.check({ a: 1 }).length);
  assert.ok(c.check({ a: 1, b: 'toolong' }).length);
  assert.ok(c.check({ a: 1, b: 'x', f() {} }).length, 'functions are not plain data');
  assert.match(c.hash, /^[0-9a-f]{16}$/);
});

test('fault overlay: hooks are no-ops, injection is not implemented in v1', () => {
  assert.equal(requireNoFaults(undefined), null);
  assert.equal(requireNoFaults({}), null);
  assert.equal(requireNoFaults([]), null);
  assert.throws(() => requireNoFaults({ f1: true }), /not implemented/);
  assert.throws(() => requireNoFaults(['f3']), /not implemented/);
  const x = { a: 1 };
  assert.equal(hooks.schemaDrift(x), x);
  assert.equal(hooks.adversarialContent(x), x);
  assert.deepEqual(hooks.toolFailure({}), { fail: false });
  assert.deepEqual(faultsAt(17), ['f1']);
  assert.deepEqual(faultsAt(1), []);
  for (const ids of Object.values(PREREG_SCHEDULE)) for (const id of ids) assert.ok(FAULT_KINDS[id]);
});
