// Shared W-bed primitives: dates, money, references, contracts, fault hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayNum, fmtDate, parseDate, swappedDay, isoDay, refKey, roundHalfAway, quoteLine, mulRate, divRate, toUsdCents, lastDayOfMonth } from './domain.mjs';
import { CURRENCIES } from './domain.mjs';
import { drawQuotes, quoteLines, quantUsdPerUnit } from './fx.mjs';
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

test('drawQuotes: every stored rate is exactly the rate its quote line prints (wbed-r3 1.1.0; references/README "R3 bed finding")', () => {
  // A USD-per-unit rate with digits beyond what quoteLine prints made R3's totals underivable from the task in 1.0.0.
  const parse = line => {
    const m = /^(USD\/([A-Z]{3})|([A-Z]{3})\/USD)\s+(\d+)\.(\d+)$/.exec(line);
    assert.ok(m, line);
    const micro = Number(m[4]) * 1e6 + Number(m[5].padEnd(6, '0').slice(0, 6));
    return m[2] ? [m[2], divRate(Number(m[4]) * 1e4 + Number(m[5].padEnd(4, '0')))] : [m[3], mulRate(micro)];
  };
  const all = Object.keys(CURRENCIES);
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const quotes = drawQuotes(taskRng('lib', 'fx', { seed: i, split: 'dev', difficulty: 3 }), all);
    const lines = quoteLines(quotes);
    assert.equal(lines.length, all.filter(c => c !== 'USD').length);
    for (const line of lines) {
      const [c, rate] = parse(line);
      assert.deepEqual(rate, quotes[c], `${line} prints ${JSON.stringify(quotes[c])}`);
      n++;
    }
  }
  assert.ok(n >= 400 * 3);
  // The quantization is records' (beds/records/world.mjs quant): six decimals below 0.05, four above.
  assert.equal(quantUsdPerUnit(1.10422149), 1104200);
  assert.equal(quantUsdPerUnit(1.10425), 1104300);
  assert.equal(quantUsdPerUnit(0.0091234), 9123);
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
