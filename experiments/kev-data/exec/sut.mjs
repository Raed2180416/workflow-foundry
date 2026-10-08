// The fixture system under test for the `finding` cause of F1: small pure operations with a correct reading ("build N-1",
// the control build) and a planted bug ("build N", the build under test). A finding is the SUT misbehaving, so the
// same call must pass on N-1 and fail on N. Every function is deterministic; every bug is chosen so that the arguments
// the plan draws do trigger it (checked: good(args) != bad(args)).
import { makeRnd } from './util.mjs';

const r2 = x => Math.round(x * 100) / 100;

export const SUT_OPS = Object.freeze({
  cart_total: {
    title: 'cart total with a percentage coupon',
    args: rnd => ({ prices: Array.from({ length: rnd.int('n', 3, 5) }, (_, i) => rnd.int(`p${i}`, 3, 40) * 100 + rnd.pick(`c${i}`, [5, 15, 35, 45, 95]) ).map(c => c / 100), coupon: rnd.pick('coupon', [10, 15, 20, 25]) }),
    good: a => r2(a.prices.reduce((s, p) => s + p, 0) * (1 - a.coupon / 100)),
    bad: a => r2(a.prices.reduce((s, p) => s + r2(p * (1 - a.coupon / 100)), 0)),
  },
  slugify: {
    title: 'slug of a title',
    args: rnd => ({ text: `${rnd.pick('w1', ['Quarterly', 'Revised', 'Annual', 'Draft', 'Final'])} ${rnd.pick('w2', ['Report', 'Budget', 'Forecast', 'Summary'])} ${rnd.int('y', 2021, 2027)}${rnd.pick('tail', ['!', ' -', '?!', ' (v2)', '...'])}` }),
    good: a => a.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    bad: a => a.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, ''),
  },
  business_days: {
    title: 'business days between two dates',
    args: rnd => { const a = rnd.int('a', 0, 6); return { start: a, end: a + rnd.int('len', 6, 20) }; },
    good: a => { let n = 0; for (let d = a.start; d <= a.end; d++) if (d % 7 !== 5 && d % 7 !== 6) n++; return n; },
    bad: a => { let n = 0; for (let d = a.start; d < a.end; d++) if (d % 7 !== 5 && d % 7 !== 6) n++; return n; },
  },
  dedupe: {
    title: 'duplicate removal keeping the first occurrence',
    args: rnd => { const base = rnd.sample('base', ['ant', 'bee', 'cat', 'dog', 'eel', 'fox', 'gnu'], 4); return { items: [base[0], base[1], base[0], base[2], base[1], base[3]] }; },
    good: a => a.items.filter((x, i) => a.items.indexOf(x) === i),
    bad: a => a.items.filter((x, i) => a.items.lastIndexOf(x) === i),
  },
  median: {
    title: 'median of a list',
    args: rnd => ({ xs: Array.from({ length: 2 * rnd.int('h', 2, 4) }, (_, i) => rnd.int(`x${i}`, 1, 90)) }),
    good: a => { const s = [...a.xs].sort((p, q) => p - q), m = s.length / 2; return (s[m - 1] + s[m]) / 2; },
    bad: a => { const s = [...a.xs].sort((p, q) => p - q); return s[s.length / 2]; },
  },
  split_cents: {
    title: 'splitting an amount into equal shares',
    args: rnd => { const n = rnd.pick('n', [3, 4, 6, 7]); return { total_cents: n * rnd.int('base', 20, 90) + rnd.int('rem', 1, n - 1), parts: n }; },
    good: a => { const base = Math.floor(a.total_cents / a.parts), rem = a.total_cents % a.parts; return Array.from({ length: a.parts }, (_, i) => base + (i < rem ? 1 : 0)); },
    bad: a => { const base = Math.floor(a.total_cents / a.parts); return Array.from({ length: a.parts }, () => base); },
  },
  page_slice: {
    title: 'one page of a list',
    args: rnd => ({ items: Array.from({ length: rnd.int('n', 9, 14) }, (_, i) => i + 1), page: rnd.int('page', 2, 3), size: rnd.pick('size', [3, 4]) }),
    good: a => a.items.slice((a.page - 1) * a.size, a.page * a.size),
    bad: a => a.items.slice((a.page - 1) * a.size + 1, a.page * a.size + 1),
  },
  clamp_score: {
    title: 'clamping a score to a range',
    args: rnd => { const lo = rnd.int('lo', 0, 10), hi = lo + rnd.int('w', 40, 90); return { value: hi, lo, hi }; },
    good: a => Math.min(a.hi, Math.max(a.lo, a.value)),
    bad: a => (a.value >= a.hi ? a.hi - 1 : Math.max(a.lo, a.value)),
  },
});
export const SUT_OP_NAMES = Object.freeze(Object.keys(SUT_OPS));

// Crash texts of the build under test (the SUT raising instead of answering).
export const SUT_CRASHES = Object.freeze([
  { name: 'RangeError', msg: 'Invalid array length' },
  { name: 'TypeError', msg: "Cannot read properties of null (reading 'lines')" },
  { name: 'Error', msg: 'ledger invariant violated: balance -3 < 0 after settle()' },
  { name: 'TypeError', msg: "Cannot read properties of undefined (reading 'price')" },
  { name: 'RangeError', msg: 'Maximum call stack size exceeded' },
  { name: 'Error', msg: 'unexpected end of stream while decoding frame 17' },
  { name: 'TypeError', msg: 'items is not iterable' },
]);

// The arguments of one plan (deterministic). The planted bug must change the answer.
export function sutCall(op, key) {
  const def = SUT_OPS[op], rnd = makeRnd(`${key}|sut|${op}`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const args = def.args(rnd.sub(`a${attempt}`));
    if (JSON.stringify(def.good(args)) !== JSON.stringify(def.bad(args))) return { args, expected: def.good(args), buggy: def.bad(args) };
  }
  throw new Error(`sut: no triggering arguments for ${op}`);
}
export const runSut = (op, args, build) => (build === 'N' ? SUT_OPS[op].bad(args) : SUT_OPS[op].good(args));
