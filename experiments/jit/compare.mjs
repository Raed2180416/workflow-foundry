// Tolerant answer comparison (JIT v2.1, opt-in). Exact canonical JSON makes every fitted number a disagreement (kinetics:
// vmax 4.0213 vs 4.0198), so shadows never agree, adjudication is always 'unresolved' and check-traces reports exact 0 for
// correct solvers (research/jit-20261008/DEV-NOTES.md). This module is the one definition of "tolerantly the same answer",
// shared by stream.mjs (shadows, adjudication), check-traces.mjs (exact / partial) and tierdown.mjs (decision agreement).
// Plain ESM, no dependencies: compile.mjs copies it to tools/compare.mjs beside tools/check-traces.mjs when compile.compare
// is 'tolerant'.
//
// Semantics, tolerantEqual(a, b, { relTol = 0.01, absTol = 1e-9, tolerantKeys, allowLooseTolerance }):
// - numbers: equal when |a - b| <= max(absTol, relTol * max(|a|, |b|)), where tolerance applies (below); a === b covers
//   infinities of one sign and 0 / -0; NaN equals only NaN; a non-finite number never equals a finite one. Signs are not
//   special: 1e-12 and -1e-12 are equal under absTol 1e-9, 5 and -5 are not.
//   Where tolerance applies: with tolerantKeys (a list of object keys, e.g. ['vmax', 'km']), only to a number whose nearest
//   enclosing object key is listed (an array passes its key on to its items); every other number is compared exactly.
//   Without tolerantKeys, to every number except when both are integers: two integers are compared exactly, so ids, row
//   numbers and counts never become "equal" to a neighbour (records: entity_id 150 is not 151). A non-integer amount
//   (cents, 1000 vs 1009.9) is still tolerant without tolerantKeys: list the fitted keys, or use relTol 0, for such data.
// - bounds: relTol <= MAX_REL_TOL (0.05) and absTol <= MAX_ABS_TOL (1e-6) unless allowLooseTolerance: true (recorded with
//   the tolerance). A looser tolerance lets a wrong answer agree with a right one (kinetics grades at 10% and its near-miss
//   control is a Km 12% off).
// - strings: equal after trim (case and inner whitespace count). No type coercion: 1 is not "1", null is not 0 or NaN.
// - objects: the same keys (a key whose value is undefined is absent, as in canonical JSON), every value tolerantly equal.
// - arrays: multisets. Equal when the lengths match and a perfect matching exists in the bipartite graph whose edges are
//   tolerantly equal item pairs. Tolerance is not transitive, so pairing identical items first is NOT safe in general
//   (a = [1.0, 0.99], b = [1.0, 1.0099] at relTol 0.01: only 1.0-1.0099 and 0.99-1.0 is perfect), hence a real matching:
//   Kuhn's augmenting paths over the n*n item comparisons, O(n^3) steps, when n*n <= MATCH_CAP and the comparison's work
//   budget allows. Otherwise a sound greedy pass: items sorted by a canonical key and compared pairwise, then first-fit for
//   the rest while the budget lasts. A perfect matching it finds is a real one, so "equal" is never wrong, but it can miss
//   one and report "not equal". stats.approx counts fallbacks.
// - work budget: every comparison of two values (at any depth) spends one unit of WORK_CAP per top-level call, and a
//   matching or assignment is only started, and only finished, while units remain; past the budget every array takes its
//   linear fallback. So nested arrays cannot multiply: total work is about WORK_CAP comparisons plus, after that, a pass
//   over the values per nesting level (O(size * depth) comparisons and O(size * log(size)) for the key sorts), whatever
//   the shape. The matching steps (Kuhn O(n * edges), Hungarian O(k^2 * l)) are charged to the budget too, before they run.
//
// tolerantAgreement(got, want, opts) -> { exact, partial, matched, compared, diffs, approx }: the check-traces deep diff
// (leaves = primitives and empty containers; objects key by key, a missing or extra key counts its leaves as misses) with
// tolerant leaves and array items paired to maximise the matched leaves: an optimal assignment (Hungarian algorithm,
// O(k^3) for k = max(n, m), on an n*m matrix of recursive agreements) for n*m <= MATCH_CAP pairs within the work budget.
// Otherwise key-equal items are paired first, then the rest by the optimal assignment if that fits the budget, else by
// the optimal assignment on a cheap non-recursive score (the leaves of equal-keyed top-level fields) when the rest has at
// most MATCH_CAP pairs, else by position. All are lower bounds on the optimum; approx counts these fallbacks. exact is tolerantEqual(got, want).
export const DEFAULT_TOLERANCE = Object.freeze({ relTol: 0.01, absTol: 1e-9 });
export const MATCH_CAP = 40000;   // item pairs per array (200 x 200) before the documented fallbacks
export const WORK_CAP = 10_000_000;   // value comparisons per top-level comparison (seconds) before every array falls back
export const MAX_REL_TOL = 0.05, MAX_ABS_TOL = 1e-6;
const MISSING = '<missing>', EXTRA = '<not expected>';

export function tolerance(opts = {}) {
  const t = { relTol: opts?.relTol ?? DEFAULT_TOLERANCE.relTol, absTol: opts?.absTol ?? DEFAULT_TOLERANCE.absTol };
  for (const k of ['relTol', 'absTol']) if (typeof t[k] !== 'number' || !Number.isFinite(t[k]) || t[k] < 0) throw new Error(`tolerance: ${k} must be a finite number >= 0, got ${JSON.stringify(t[k])}`);
  const loose = opts?.allowLooseTolerance;
  if (loose != null && typeof loose !== 'boolean') throw new Error('tolerance: allowLooseTolerance must be true or false');
  if (!loose && (t.relTol > MAX_REL_TOL || t.absTol > MAX_ABS_TOL)) throw new Error(`tolerance: relTol ${t.relTol} / absTol ${t.absTol} is looser than ${MAX_REL_TOL} / ${MAX_ABS_TOL}; a wrong answer would agree with a right one (set allowLooseTolerance: true to insist, and it is recorded)`);
  const keys = opts?.tolerantKeys;
  if (keys != null) {
    if (!Array.isArray(keys) || !keys.length || !keys.every(k => typeof k === 'string' && k)) throw new Error('tolerance: tolerantKeys must be a non-empty list of object keys');
    t.tolerantKeys = [...new Set(keys)].sort();
  }
  if (loose) t.allowLooseTolerance = true;
  return t;
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// JSON-like kinds; undefined (an array hole or item) is null, as canonical JSON writes it.
const kindOf = v => (v === null || v === undefined ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const keysOf = o => Object.keys(o).filter(k => o[k] !== undefined);

// here: does tolerance apply at this number's position (see tolerantKeys)? Without tolerantKeys two integers are exact.
export function numbersEqual(a, b, { relTol, absTol, tolerantKeys } = DEFAULT_TOLERANCE, here = true) {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !here) return false;
  if (!tolerantKeys && Number.isInteger(a) && Number.isInteger(b)) return false;
  return Math.abs(a - b) <= Math.max(absTol, relTol * Math.max(Math.abs(a), Math.abs(b)));
}

// A canonical key that never merges values tolerantEqual tells apart (unlike canonical JSON, where NaN, Infinity and
// null are all "null"): equal keys imply tolerantly equal values. Used for fast paths and the greedy fallback order.
function keyer() {
  const memo = new WeakMap();
  const key = v => {
    switch (kindOf(v)) {
      case 'null': return 'z';
      case 'number': return `n${Object.is(v, -0) ? 0 : v}`;
      case 'string': return `s${JSON.stringify(v.trim())}`;
      case 'boolean': return v ? 't' : 'f';
      case 'array': case 'object': {
        let k = memo.get(v);
        if (k === undefined) {
          k = Array.isArray(v) ? `[${v.map(key).join(',')}]` : `{${keysOf(v).sort().map(x => `${JSON.stringify(x)}:${key(v[x])}`).join(',')}}`;
          memo.set(v, k);
        }
        return k;
      }
      default: return `?${String(v)}`;
    }
  };
  return key;
}

// Memo for a pair of containers within one top-level call (recursion meets the same pairs again).
function pairMemo() {
  const m = new WeakMap();
  return {
    get(a, b) { return m.get(a)?.get(b); },
    set(a, b, v) { let x = m.get(a); if (!x) { x = new WeakMap(); m.set(a, x); } x.set(b, v); return v; },
  };
}
// Whether tolerance applies is part of a container's context (an array passes it to its items), so memos are per context.
const ctxMemo = () => { const t = pairMemo(), f = pairMemo(); return h => (h ? t : f); };

// Kuhn's algorithm: is there a perfect matching (n === m) in adjacency adj[i] = [j...]?
function perfectMatching(adj, n) {
  const matchB = new Array(n).fill(-1);
  const tryA = (i, seen) => {
    for (const j of adj[i]) {
      if (seen[j]) continue;
      seen[j] = 1;
      if (matchB[j] < 0 || tryA(matchB[j], seen)) { matchB[j] = i; return true; }
    }
    return false;
  };
  for (let i = 0; i < n; i++) if (!tryA(i, new Uint8Array(n))) return false;
  return true;
}

// The work budget of one top-level comparison: every item comparison spends one unit (see WORK_CAP).
const newWork = () => ({ left: WORK_CAP, cheap: WORK_CAP });   // cheap: the fallback assignments' own budget
// Does tolerance apply to the value under object key k (inside an object at any depth)? At the top level: only without a list.
const hereAt = (tol, k) => (tol.tolerantKeys ? tol.tolerantKeys.includes(k) : true);
const hereTop = tol => !tol.tolerantKeys;

function makeEqual(tol, stats, key = keyer(), work = newWork()) {
  const memoOf = ctxMemo();
  const approx = () => { stats.approx = (stats.approx ?? 0) + 1; };
  const eq = (a, b, here = hereTop(tol)) => {
    work.left--;
    const ka = kindOf(a), kb = kindOf(b);
    if (ka !== kb) return false;
    switch (ka) {
      case 'null': return true;
      case 'number': return numbersEqual(a, b, tol, here);
      case 'string': return a.trim() === b.trim();
      case 'boolean': return a === b;
      case 'object': {
        const memo = memoOf(here), hit = memo.get(a, b);
        if (hit !== undefined) return hit;
        const ks = keysOf(a), kb2 = keysOf(b);
        if (ks.length !== kb2.length || !ks.every(k => Object.hasOwn(b, k) && b[k] !== undefined)) return memo.set(a, b, false);
        return memo.set(a, b, ks.every(k => eq(a[k], b[k], hereAt(tol, k))));
      }
      case 'array': {
        const memo = memoOf(here), hit = memo.get(a, b);
        if (hit !== undefined) return hit;
        return memo.set(a, b, arraysEqual(a, b, here));
      }
      default: return a === b;
    }
  };
  const arraysEqual = (a, b, here) => {
    const n = a.length;
    if (n !== b.length) return false;
    if (!n) return true;
    if (a.every((x, i) => eq(x, b[i], here))) return true;                     // in order: the common case
    if (n * n <= MATCH_CAP && n * n <= work.left) {
      const adj = [];
      for (const x of a) {
        if (work.left <= 0) break;   // the budget ran out while building: take the fallback below
        const out = []; for (let j = 0; j < n; j++) if (eq(x, b[j], here)) out.push(j);
        if (!out.length) return false;
        adj.push(out);
      }
      const steps = adj.length === n ? n * adj.reduce((t, l) => t + l.length, 0) : Infinity;   // Kuhn: O(n * edges)
      if (steps <= work.left) { work.left -= steps; return perfectMatching(adj, n); }
    }
    // Sound fallback: canonical-key order, pairwise; then first-fit for the rest while the budget lasts. A full pairing
    // found is a real perfect matching; running out of budget answers "not equal".
    approx();
    const order = v => v.map((x, i) => [key(x), i]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1])).map(p => p[1]);
    const ia = order(a), ib = order(b), usedB = new Uint8Array(n), restA = [];
    for (let k = 0; k < n; k++) { if (eq(a[ia[k]], b[ib[k]], here)) usedB[ib[k]] = 1; else restA.push(ia[k]); }
    const restB = ib.filter(j => !usedB[j]);
    for (const i of restA) {
      let found = -1;
      for (let k = 0; k < restB.length; k++) {
        if (work.left <= 0) return false;
        if (restB[k] >= 0 && eq(a[i], b[restB[k]], here)) { found = k; break; }
      }
      if (found < 0) return false;
      restB[found] = -1;
    }
    return true;
  };
  return eq;
}

export function tolerantEqual(a, b, opts = {}, stats = {}) {
  const tol = tolerance(opts);
  return makeEqual(tol, stats)(a, b, hereTop(tol));
}

// A leaf is a primitive or an empty container; a container counts the leaves inside it (check-traces' definition).
export function leaves(v) {
  if (Array.isArray(v)) return v.length ? v.reduce((s, x) => s + leaves(x), 0) : 1;
  if (isObj(v)) { const ks = keysOf(v); return ks.length ? ks.reduce((s, k) => s + leaves(v[k]), 0) : 1; }
  return 1;
}

// Maximum-weight assignment (Hungarian algorithm, potentials form, O(n^2 * m) for n <= m). W is n x m of integers >= 0.
// Returns, for each row, the column it is assigned to.
export function assignMax(W, n, m) {
  if (n > m) {
    const T = Array.from({ length: m }, (_, j) => Array.from({ length: n }, (_, i) => W[i][j]));
    const colToRow = assignMax(T, m, n), out = new Array(n).fill(-1);
    colToRow.forEach((i, j) => { if (i >= 0) out[i] = j; });
    return out;
  }
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1), p = new Int32Array(m + 1), way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(Infinity), used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = -W[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const out = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1;
  return out;
}

export function tolerantAgreement(got, want, opts = {}) {
  const { maxDiffs = 20 } = opts ?? {};
  const tol = tolerance(opts), stats = {}, key = keyer(), work = newWork();
  const eq = makeEqual(tol, stats, key, work);
  const scoreMemoOf = ctxMemo();
  const diffs = [];
  const note = (p, g, w) => { if (diffs.length < maxDiffs) diffs.push({ path: p, got: g, want: w }); };
  const childPath = (p, k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? `${p}.${k}` : `${p}[${JSON.stringify(k)}]`);
  function cmp(a, b, p, record, here) {
    work.left--;
    const containers = a !== null && b !== null && typeof a === 'object' && typeof b === 'object';
    if (!record && containers) { const hit = scoreMemoOf(here).get(a, b); if (hit) return hit; }
    let r;
    if (eq(a, b, here)) { const n = leaves(b); r = { m: n, n }; }
    else if (isObj(a) && isObj(b)) {
      let m = 0, n = 0;
      for (const k of new Set([...keysOf(b), ...keysOf(a)])) {
        const kp = childPath(p, k), inA = Object.hasOwn(a, k) && a[k] !== undefined, inB = Object.hasOwn(b, k) && b[k] !== undefined;
        if (!inA) { n += leaves(b[k]); if (record) note(kp, MISSING, b[k]); }
        else if (!inB) { n += leaves(a[k]); if (record) note(kp, a[k], EXTRA); }
        else { const x = cmp(a[k], b[k], kp, record, hereAt(tol, k)); m += x.m; n += x.n; }
      }
      r = { m, n };
    } else if (Array.isArray(a) && Array.isArray(b)) r = cmpArrays(a, b, p, record, here);
    else { if (record) note(p, a, b); r = { m: 0, n: Math.max(leaves(a), leaves(b)) }; }
    if (!record && containers) scoreMemoOf(here).set(a, b, r);
    return r;
  }
  // A cheap lower-bound score for an item pair, with no recursion into arrays: the leaves of the top-level fields whose
  // values have equal canonical keys (or are tolerantly equal numbers or strings).
  const prim = (x, y, h) => (key(x) === key(y) ? leaves(y) : kindOf(x) === 'number' && kindOf(y) === 'number' && numbersEqual(x, y, tol, h) ? 1
    : kindOf(x) === 'string' && kindOf(y) === 'string' && x.trim() === y.trim() ? 1 : 0);
  function cheapScore(x, y, h, depth = 0) {
    if (isObj(x) && isObj(y) && depth < 2) {
      let m = 0;
      for (const k of keysOf(y)) if (Object.hasOwn(x, k) && x[k] !== undefined) m += cheapScore(x[k], y[k], hereAt(tol, k), depth + 1);
      return m;
    }
    if (Array.isArray(x) && Array.isArray(y) && depth < 2) {   // multiset overlap of the items' canonical keys
      work.cheap -= x.length + y.length;
      const count = new Map(); for (const v of y) { const k = key(v); count.set(k, (count.get(k) ?? 0) + 1); }
      let m = 0; for (const v of x) { const k = key(v), c = count.get(k); if (c) { count.set(k, c - 1); m += leaves(v); } }
      return m;
    }
    return prim(x, y, h);
  }
  // Optimal assignment of the items ia of a to the items jb of b, if it fits the caps. Building the matrix spends at least
  // |ia| * |jb| units (every nested comparison counts); if the budget runs out on the way, it gives up (false).
  function assign(a, b, ia, jb, here, pairs) {
    if (ia.length * jb.length > MATCH_CAP || ia.length * jb.length > work.left) return false;
    const W = [];
    for (const i of ia) { if (work.left <= 0) return false; W.push(jb.map(j => cmp(a[i], b[j], '', false, here).m)); }
    // The Hungarian steps, O(k^2 * l) for k = min, l = max of the two sizes, are spent too; a run that cannot afford them gives up.
    const steps = Math.min(ia.length, jb.length) ** 2 * Math.max(ia.length, jb.length);
    if (steps > work.left) return false;
    work.left -= steps;
    assignMax(W, ia.length, jb.length).forEach((k, r) => { if (k >= 0 && W[r][k] > 0) pairs.push({ i: ia[r], j: jb[k] }); });
    return true;
  }
  function cmpArrays(a, b, p, record, here) {
    let m = 0, n = 0;
    const pairs = [];
    if (a.length && b.length && !assign(a, b, a.map((_, i) => i), b.map((_, j) => j), here, pairs)) {
      // Too large (or over the budget) for one optimal assignment: key-equal items first (equal keys are tolerantly
      // equal), then the optimal assignment on the rest if that fits, else the rest by position.
      stats.approx = (stats.approx ?? 0) + 1;
      const freeA = new Map();
      a.forEach((x, i) => { const k = key(x); freeA.set(k, [...(freeA.get(k) ?? []), i]); });
      const restB = [];
      b.forEach((y, j) => { const list = freeA.get(key(y)); if (list?.length) pairs.push({ i: list.shift(), j }); else restB.push(j); });
      const restA = [...freeA.values()].flat().sort((x, y) => x - y);
      if (restA.length && restB.length && !assign(a, b, restA, restB, here, pairs)) {
        const k2l = Math.min(restA.length, restB.length) ** 2 * Math.max(restA.length, restB.length);
        // Only on the scoring walk itself (record): a speculative score for a matrix cell that ran out of budget is discarded.
        if (record && restA.length * restB.length <= MATCH_CAP && 2 * restA.length * restB.length + k2l <= work.cheap) {
          // Over the budget: the optimal assignment on a cheap score (two levels into fields and arrays), on a budget of its own.
          work.cheap -= restA.length * restB.length + k2l;
          const W = restA.map(i => restB.map(j => cheapScore(a[i], b[j], here)));
          assignMax(W, restA.length, restB.length).forEach((k, r) => { if (k >= 0 && W[r][k] > 0) pairs.push({ i: restA[r], j: restB[k] }); });
        }
        // Whatever is still unpaired (a zero cheap score, or too many pairs for an assignment): by position.
        const usedA = new Set(pairs.map(c => c.i)), usedB = new Set(pairs.map(c => c.j));
        const ra = restA.filter(i => !usedA.has(i)), rb = restB.filter(j => !usedB.has(j));
        for (let k = 0; k < Math.min(ra.length, rb.length); k++) pairs.push({ i: ra[k], j: rb[k] });
      }
    }
    const pairedA = new Set(pairs.map(c => c.i)), pairedB = new Set(pairs.map(c => c.j));
    for (const c of pairs.sort((x, y) => x.j - y.j)) { const r = cmp(a[c.i], b[c.j], `${p}[${c.j}]`, record, here); m += r.m; n += r.n; }
    b.forEach((y, j) => { if (!pairedB.has(j)) { n += leaves(y); if (record) note(`${p}[${j}]`, MISSING, y); } });
    a.forEach((x, i) => { if (!pairedA.has(i)) { n += leaves(x); if (record) note(`${p}[got ${i}]`, x, EXTRA); } });
    return { m, n };
  }
  const r = cmp(got, want, '$', true, hereTop(tol));
  return { exact: eq(got, want, hereTop(tol)), partial: r.n ? r.m / r.n : 1, matched: r.m, compared: r.n, diffs, approx: stats.approx ?? 0 };
}
