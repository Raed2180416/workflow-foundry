// Independent specifications of every R3' family, written from the CONTRACT TEXT (families.mjs `doc`), not from the
// bodies: test-only (r3p.test.mjs), never imported by the bed. The review of 2026-10-14 (finding 2) found two families
// whose "correct" bodies broke their own contracts (fee-rate in percent rounded 38.5 to 38; safe-get returned
// Object.prototype members and a final null), so a contract-faithful report scored as a false positive. The oracle's
// truth is "planted differs from correct", which is sound only if every correct body meets its contract on EVERY valid
// input; the test runs every correct body (and every decoy) against these specs on random in-domain inputs.
//
// Where a contract is arithmetic on money, the spec works in exact integers (rationals), so it does not share the
// bodies' floating-point shortcuts. Each spec is (p, house) => (...args) => value, and throws for "throws" contracts;
// it may change an argument only where the contract says "in place".

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** Round num/den (integers, den > 0) to an integer by `rule`: 'away' (halves away from zero), 'even', 'trunc',
 *  'floor', 'up' (ceiling), 'half-up' (nearest, halves toward +infinity). Exact. */
export function roundRational(num, den, rule) {
  const sign = num < 0 ? -1 : 1, a = Math.abs(num), whole = Math.floor(a / den), rem = a - whole * den;
  const cmp = 2 * rem - den; // < 0 below the half, 0 at the half, > 0 above
  let mag;
  switch (rule) {
    case 'trunc': mag = whole; break;
    case 'away': mag = cmp >= 0 ? whole + 1 : whole; break;
    case 'even': mag = cmp > 0 || (cmp === 0 && whole % 2 === 1) ? whole + 1 : whole; break;
    case 'floor': return sign > 0 ? whole : -(rem ? whole + 1 : whole);
    case 'up': return sign > 0 ? (rem ? whole + 1 : whole) : -whole;
    case 'half-up': return sign > 0 ? (cmp >= 0 ? whole + 1 : whole) : -(cmp > 0 ? whole + 1 : whole);
    default: throw new Error(`rule ${rule}`);
  }
  return sign * mag + 0; // + 0 turns -0 into 0
}
const decimals = (x, dp) => Math.round(x * 10 ** dp); // x has at most dp decimals: its exact scaled integer
const houseRule = house => (house.rounding === 'HALF_AWAY' ? 'away' : 'even');
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // the proleptic Gregorian calendar of Date (years >= 100)
const put = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); // a data property, even for __proto__
const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const ym = (y, m, add) => { const i = y * 12 + (m - 1) + add; const Y = Math.floor(i / 12); return [Y, i - Y * 12 + 1]; };
const stableSort = (xs, key) => xs.map((x, i) => [x, i]).sort((a, b) => key(a[0], b[0]) || a[1] - b[1]).map(([x]) => x);
const trimWs = s => s.trim(); // CONVENTIONS §9: whitespace is what String.prototype.trim removes

export const SPEC = {
  'range-check': p => (v, lo, hi) => (p.loIncl ? v >= lo : v > lo) && (p.hiIncl ? v <= hi : v < hi),
  'page-slice': p => (items, page, size = p.fixed) => {
    const start = (page - p.base) * size;
    if (start >= items.length) return p.past === 'null' ? null : [];
    return items.slice(start, start + size);
  },
  'day-count': p => (a, b) => ({ both: b - a + 1, start: b - a, between: Math.max(0, b - a - 1) }[p.rule]),
  'pairwise-deltas': p => xs => { const out = []; for (let i = 0; i + p.k < xs.length; i++) out.push(p.fwd ? xs[i + p.k] - xs[i] : xs[i] - xs[i + p.k]); return out; },
  'last-n': p => (items, n) => {
    if (n === 0) return [];
    if (items.length < n && p.short === 'null') return null;
    const tail = items.length <= n ? items.slice() : items.slice(items.length - n);
    return p.rev ? tail.reverse() : tail;
  },
  chunk: p => (items, size = p.fixed) => {
    const out = [];
    for (let i = 0; i < items.length; i += size) { const c = items.slice(i, i + size); if (c.length === size || p.last === 'short') out.push(c); }
    return out;
  },
  'approval-rule': p => (role, amount, limit) => {
    if (role === p.sup) return p.mult ? amount <= p.mult * limit : true;
    if (role === p.app) return p.incl ? amount <= limit : amount < limit;
    return false;
  },
  'retry-policy': p => (status, attempt, max) => {
    const ok = { a: [429], b: [408, 429], c: [429, 502, 503, 504] }[p.set].includes(status) || (p.set !== 'c' && status >= 500 && status <= 599);
    return ok && attempt < max;
  },
  'filter-status': p => recs => recs.filter(r => (p.mode === 'exclude' ? !p.ws.includes(r.status) : p.ws.includes(r.status))),
  'is-overdue': p => (due, today, paid) => paid === null && today > due + p.g,
  'max-by': p => items => {
    let best = null;
    for (const it of items) {
      if (best === null) { best = it; continue; }
      const better = p.big ? it[p.f] > best[p.f] : it[p.f] < best[p.f], tie = it[p.f] === best[p.f];
      if (better || (tie && p.tieLast)) best = it;
    }
    return best;
  },
  average: p => xs => {
    if (!xs.length) return p.empty === 'zero' ? 0 : null;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return p.trunc ? Math.trunc(m) : m;
  },
  ratio: p => (part, whole) => (whole === 0 ? (p.zero === 'null' ? null : 0) : p.pct ? (part * 100) / whole : part / whole),
  'display-name': p => c => {
    const n = c[p.nf], fb = p.fb === 'email' ? c[p.ef] : p.fb;
    return n === null || trimWs(n) === '' ? fb : trimWs(n);
  },
  'first-or': p => (items, fb) => (items.length === 0 ? fb : p.last ? items[items.length - 1] : items[0]),
  'safe-get': p => (obj, path) => {
    const MISS = p.miss === 'null' ? null : undefined;
    let cur = obj;
    for (const key of path.split(p.sep)) {
      if (cur === null || typeof cur !== 'object' || !own(cur, key)) return MISS;
      cur = cur[key];
    }
    return cur;
  },
  'round-minor': (p, house) => x => roundRational(decimals(x, 4), 1e4, houseRule(house)),
  'line-amount': (p, house) => (qty, unit, disc) => { const D = p.pct ? 100 : 10000; return roundRational(qty * unit * (D - disc), D, houseRule(house)); },
  'sum-lines': p => xs => xs.reduce((t, a) => t + (p.abs ? Math.abs(a) : a), 0),
  'split-evenly': p => (t, n) => { const base = Math.floor(t / n), extra = t - base * n; return Array.from({ length: n }, (_, i) => base + ((p.later ? i >= n - extra : i < extra) ? 1 : 0)); },
  'percent-of': p => (a, pct) => roundRational(a * pct, p.bp ? 10000 : 100, p.rule),
  'fee-rate': p => (a, rate) => roundRational(a * rate, p.unit === 'bp' ? 10000 : 100, { 'half-up': 'half-up', up: 'up', down: 'floor' }[p.rule]),
  'to-major': p => (m, cur) => { const digits = cur === 'JPY' || (p.set === 'jpy-krw' && cur === 'KRW') ? 0 : p.set === 'kwd' && cur === 'KWD' ? 3 : 2; return m / [1, 10, 100, 1000][digits]; },
  'timeout-ms': p => s => (p.min ? decimals(s, 2) * 600 : decimals(s, 3)),
  'sort-by': p => items => {
    const sorted = stableSort(items, (a, b) => (p.desc ? b[p.f] - a[p.f] : a[p.f] - b[p.f]));
    if (!p.inPlace) return sorted;
    sorted.forEach((x, i) => { items[i] = x; });
    return items;
  },
  'with-defaults': p => o => {
    const out = Object.fromEntries(p.defaults.map(([k, v]) => [k, JSON.parse(v.replace(/'/g, '"'))]));
    for (const [k, v] of Object.entries(o)) if (!(p.skipNull && v === null)) put(out, k, v);
    return out;
  },
  'drop-status': p => lines => lines.filter(l => !p.ss.includes(l[p.sf])),
  'append-total': p => row => { const t = row.reduce((a, b) => a + b, 0); return p.front ? [t, ...row] : [...row, t]; },
  'days-in-month': () => (y, m) => dim(y, m),
  'add-months': p => (date, n) => {
    const [y, m, d] = date.split('-').map(Number), [Y, M] = ym(y, m, n);
    if (d <= dim(Y, M)) return iso(Y, M, d);
    if (!p.roll) return iso(Y, M, dim(Y, M));
    const [Y2, M2] = ym(Y, M, 1);
    return iso(Y2, M2, d - dim(Y, M));
  },
  'month-end': p => date => { const [y, m] = date.split('-').map(Number), [Y, M] = ym(y, m, { same: 0, previous: -1, next: 1 }[p.which]); return iso(Y, M, dim(Y, M)); },
  'is-valid-date': p => t => {
    const m = p.dmy ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t) : /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (!m) return false;
    const [y, mo, d] = p.dmy ? [+m[3], +m[2], +m[1]] : [+m[1], +m[2], +m[3]];
    return y >= p.yr[0] && y <= p.yr[1] && mo >= 1 && mo <= 12 && d >= 1 && d <= dim(y, mo);
  },
  'csv-field': p => v => {
    const needs = p.always || [...(p.semi ? ';' : ','), '"', '\r', '\n'].some(c => v.includes(c));
    return needs ? `"${v.split('"').join('""')}"` : v;
  },
  'html-text': p => t => [...t].map(c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': p.quot, "'": p.apos }[c] ?? c)).join(''),
  'like-pattern': p => q => {
    const E = p.bang ? '!' : '\\', esc = [...q].map(c => ('%_'.includes(c) || c === E ? E + c : c)).join('');
    return { any: `%${esc}%`, prefix: `${esc}%`, suffix: `%${esc}` }[p.match];
  },
  'parse-amount': p => t => {
    const s = trimWs(t), [TH, DEC] = p.eu ? ['.', ','] : [',', '.'];
    const fail = () => { if (p.mode === 'null') return null; throw new RangeError('not an amount'); };
    let i = 0, neg = false;
    if (s[i] === '-') { neg = true; i++; }
    const decAt = s.indexOf(DEC, i);
    const intPart = decAt < 0 ? s.slice(i) : s.slice(i, decAt), frac = decAt < 0 ? null : s.slice(decAt + 1);
    const digits = x => x.length > 0 && [...x].every(c => c >= '0' && c <= '9');
    if (frac !== null && !(frac.length === 2 && digits(frac))) return fail();
    let units;
    if (digits(intPart)) units = Number(intPart);
    else {
      const groups = intPart.split(TH);
      if (!(groups.length > 1 && digits(groups[0]) && groups[0].length <= 3 && groups.slice(1).every(g => g.length === 3 && digits(g)))) return fail();
      units = Number(groups.join(''));
    }
    return (neg ? -1 : 1) * (units * 100 + (frac === null ? 0 : Number(frac)));
  },
  'read-settings': p => j => {
    const parsed = JSON.parse(j); // SyntaxError on invalid JSON (the domain admits only objects or invalid text)
    const out = Object.fromEntries(p.defaults.map(([k, v]) => [k, JSON.parse(v.replace(/'/g, '"'))]));
    for (const [k, v] of Object.entries(parsed)) if (!p.known || own(out, k)) put(out, k, v);
    return out;
  },
  // fillers
  slugify: () => t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  'group-by': p => items => { const out = {}; for (const it of items) (own(out, it[p.f]) ? out[it[p.f]] : (out[it[p.f]] = [])).push(it); return out; },
  'unique-ids': () => items => items.filter((it, i) => items.findIndex(x => x.id === it.id) === i),
  'sum-field': p => items => items.reduce((t, it) => t + it[p.f], 0),
  'format-ref': () => (pre, n, w) => `${pre}-${String(n).padStart(w, '0')}`,
  'normalize-spaces': () => t => t.split(/\s+/).filter(Boolean).join(' '),
  'compare-by-date': () => (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
  'count-by': () => items => { const c = {}; for (const it of items) c[it.status] = (c[it.status] ?? 0) + 1; return c; },
  clamp: () => (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v),
  initials: () => t => t.split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join(''),
  'mask-account': () => t => (t.length <= 4 ? t : '*'.repeat(t.length - 4) + t.slice(-4)),
  'is-blank': () => t => trimWs(t) === '',
};

// ---- random in-domain inputs (exec.mjs domain specs), biased to edges; family literals come in as `hints`
const STRINGS = ['', ' ', '  ', 'abc', 'a,b', 'a;b', '"', 'x"y"z', '""', '\n', 'a\r\nb', '\t', ' 42 ', '1,234.50', '1.234,50', '-12', '7.05', '7,05', '-0.99', '12.5',
  '1,23', '1234,567', '%', '_', '\\', '!', '!%', 'a_b%c', '<&>', "it's", 'say "x"', 'null', '{}', '{"pageSize": 10}', '{"a":1', 'not json', '[1,2]',
  '2023-02-29', '2024-02-29', '29/02/2024', '31/04/2023', '2023-1-01', 'constructor', '__proto__', 'length', 'a.b.c', 'a/b/c', 'list.1', 'n.c', 'é', ' x ', '😀'];
export function randomValue(spec, r, hints = []) {
  switch (spec.t) {
    case 'int': {
      const edges = [spec.min, spec.max, 0, 1, -1, 2, 3, 5, 7, 10, 50, 99, 100, 101, 1000, -1000].filter(x => x >= spec.min && x <= spec.max);
      const u = r.next();
      if (u < 0.4) return r.pick(edges);
      if (u < 0.8) return r.int(Math.max(spec.min, -2000), Math.min(spec.max, 2000));
      return r.int(spec.min, spec.max);
    }
    case 'num': {
      const s = 10 ** spec.dp, lo = Math.ceil(spec.min * s), hi = Math.floor(spec.max * s), u = r.next();
      const k = u < 0.3 ? r.int(Math.max(lo, -5000), Math.min(hi, 5000)) : u < 0.6 ? Math.max(lo, Math.min(hi, (r.int(-40, 40) * 2 + 1) * (s / 2))) : r.int(lo, hi);
      return k / s;
    }
    case 'str': { const x = r.chance(0.7) ? r.pick([...STRINGS, ...hints, ...hints]) : Array.from({ length: r.int(0, 12) }, () => r.pick(['a', 'Z', '0', '9', ' ', ',', '.', '-', '"', "'", '%', '_', '\\', '!', '/', 'é'])).join(''); return x.slice(0, spec.max); }
    case 'enum': return r.pick(spec.values);
    case 'bool': return r.chance(0.5);
    case 'scalar': return r.pick([0, 1, -1, 7, '', 'x', ' ', false, true, ...hints.slice(0, 3)]);
    case 'nullable': return r.chance(0.25) ? null : randomValue(spec.of, r, hints);
    case 'iso': {
      const y = r.pick([1600, 1700, 1800, 1900, 2000, 2023, 2024, 2100, 2400, r.int(1600, 2400)]), m = r.int(1, 12);
      return iso(y, m, r.chance(0.5) ? dim(y, m) : r.int(1, dim(y, m)));
    }
    case 'arr': { const n = Math.min(spec.max, r.pick([0, 1, 2, 3, 4, 5, 8, 9, 10, 13, spec.max])); return Array.from({ length: n }, () => randomValue(spec.of, r, hints)); }
    case 'obj': {
      const out = {};
      for (const [k, s] of Object.entries(spec.props ?? {})) if (!spec.optional?.includes(k) || r.chance(0.5)) out[k] = randomValue(s, r, hints);
      return out;
    }
    case 'json': return randomJson(r, 0);
    default: throw new Error(`no generator for ${spec.t}`);
  }
}
const JSON_KEYS = ['a', 'b', 'c', 'n', 'list', 'billing', 'address', 'city', 'constructor', 'toString', '__proto__', 'length', '0', '1', ''];
function randomJson(r, depth) {
  const u = r.next();
  if (depth > 2 || u < 0.35) return r.pick([null, 0, 1, -3, 2.5, 'x', '', true, false]);
  if (u < 0.55) return Array.from({ length: r.int(0, 3) }, () => randomJson(r, depth + 1));
  const o = {};
  for (let i = r.int(0, 4); i > 0; i--) Object.defineProperty(o, r.pick(JSON_KEYS), { value: randomJson(r, depth + 1), enumerable: true, writable: true, configurable: true });
  return o;
}
