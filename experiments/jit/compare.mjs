// Tolerant answer comparison (JIT v2.1, opt-in). Exact canonical JSON makes every fitted number a disagreement (kinetics:
// vmax 4.0213 vs 4.0198), so shadows never agree, adjudication is always 'unresolved' and check-traces reports exact 0 for
// correct solvers (research/jit-20261008/DEV-NOTES.md). This module is the one definition of "tolerantly the same answer",
// shared by stream.mjs (shadows, adjudication), check-traces.mjs (exact / partial) and tierdown.mjs (decision agreement).
// Plain ESM, no dependencies: compile.mjs copies it to tools/compare.mjs beside tools/check-traces.mjs when compile.compare
// is 'tolerant'.
//
// Semantics, tolerantEqual(a, b, { relTol = 0.01, absTol = 1e-9 }):
// - numbers: equal when |a - b| <= max(absTol, relTol * max(|a|, |b|)); a === b covers infinities of one sign and 0 / -0;
//   NaN equals only NaN; a non-finite number never equals a finite one. Signs are not special: 1e-12 and -1e-12 are equal
//   under absTol 1e-9, 5 and -5 are not.
// - strings: equal after trim (case and inner whitespace count). No type coercion: 1 is not "1", null is not 0 or NaN.
// - objects: the same keys (a key whose value is undefined is absent, as in canonical JSON), every value tolerantly equal.
// - arrays: multisets. Equal when the lengths match and a perfect matching exists in the bipartite graph whose edges are
//   tolerantly equal item pairs. Tolerance is not transitive, so pairing identical items first is NOT safe in general
//   (a = [1.0, 0.99], b = [1.0, 1.0099] at relTol 0.01: only 1.0-1.0099 and 0.99-1.0 is perfect), hence a real matching:
//   Kuhn's augmenting paths, O(n*m) item comparisons plus O(n * edges) <= O(n^2 * m) steps, for n*m <= MATCH_CAP pairs. A
//   larger array falls back to a sound greedy pass (sorted by a canonical key, then first-fit): a perfect matching it finds
//   is a real one, so "equal" is never wrong, but it can miss one and report "not equal". stats.approx counts fallbacks.
//
// tolerantAgreement(got, want, opts) -> { exact, partial, matched, compared, diffs, approx }: the check-traces deep diff
// (leaves = primitives and empty containers; objects key by key, a missing or extra key counts its leaves as misses) with
// tolerant leaves and array items paired to maximise the matched leaves: an optimal assignment (Hungarian algorithm,
// O(k^3) for k = max(n, m), on an n*m matrix of recursive agreements) for n*m <= MATCH_CAP pairs, else check-traces'
// greedy pairing by overlap (a lower bound on the optimum; approx counts it). exact is tolerantEqual(got, want).
export const DEFAULT_TOLERANCE = Object.freeze({ relTol: 0.01, absTol: 1e-9 });
export const MATCH_CAP = 40000;   // item pairs per array (200 x 200) before the documented fallbacks
const MISSING = '<missing>', EXTRA = '<not expected>';

export function tolerance(opts = {}) {
  const t = { relTol: opts?.relTol ?? DEFAULT_TOLERANCE.relTol, absTol: opts?.absTol ?? DEFAULT_TOLERANCE.absTol };
  for (const k of ['relTol', 'absTol']) if (typeof t[k] !== 'number' || !Number.isFinite(t[k]) || t[k] < 0) throw new Error(`tolerance: ${k} must be a finite number >= 0, got ${JSON.stringify(t[k])}`);
  return t;
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// JSON-like kinds; undefined (an array hole or item) is null, as canonical JSON writes it.
const kindOf = v => (v === null || v === undefined ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const keysOf = o => Object.keys(o).filter(k => o[k] !== undefined);

export function numbersEqual(a, b, { relTol, absTol } = DEFAULT_TOLERANCE) {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
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

function makeEqual(tol, stats, key = keyer(), memo = pairMemo()) {
  const eq = (a, b) => {
    const ka = kindOf(a), kb = kindOf(b);
    if (ka !== kb) return false;
    switch (ka) {
      case 'null': return true;
      case 'number': return numbersEqual(a, b, tol);
      case 'string': return a.trim() === b.trim();
      case 'boolean': return a === b;
      case 'object': {
        const hit = memo.get(a, b);
        if (hit !== undefined) return hit;
        const ks = keysOf(a), kb2 = keysOf(b);
        if (ks.length !== kb2.length || !ks.every(k => Object.hasOwn(b, k) && b[k] !== undefined)) return memo.set(a, b, false);
        return memo.set(a, b, ks.every(k => eq(a[k], b[k])));
      }
      case 'array': {
        const hit = memo.get(a, b);
        if (hit !== undefined) return hit;
        return memo.set(a, b, arraysEqual(a, b));
      }
      default: return a === b;
    }
  };
  const arraysEqual = (a, b) => {
    const n = a.length;
    if (n !== b.length) return false;
    if (!n) return true;
    if (a.every((x, i) => eq(x, b[i]))) return true;                     // in order: the common case
    if (n * n > MATCH_CAP) {
      // Sound fallback: first-fit in canonical-key order. A full pairing found is a real perfect matching.
      stats.approx = (stats.approx ?? 0) + 1;
      const order = v => v.map((x, i) => [key(x), i]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1])).map(p => p[1]);
      const ia = order(a), ib = order(b), used = new Uint8Array(n);
      for (const i of ia) {
        const j = ib.find(j2 => !used[j2] && eq(a[i], b[j2]));
        if (j === undefined) return false;
        used[j] = 1;
      }
      return true;
    }
    const adj = a.map(x => { const out = []; for (let j = 0; j < n; j++) if (eq(x, b[j])) out.push(j); return out; });
    if (adj.some(l => !l.length)) return false;
    return perfectMatching(adj, n);
  };
  return eq;
}

export function tolerantEqual(a, b, opts = {}, stats = {}) {
  return makeEqual(tolerance(opts), stats)(a, b);
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
  const tol = tolerance(opts), stats = {}, key = keyer();
  const eq = makeEqual(tol, stats, key);
  const scoreMemo = pairMemo();
  const diffs = [];
  const note = (p, g, w) => { if (diffs.length < maxDiffs) diffs.push({ path: p, got: g, want: w }); };
  const childPath = (p, k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? `${p}.${k}` : `${p}[${JSON.stringify(k)}]`);
  function cmp(a, b, p, record) {
    const containers = a !== null && b !== null && typeof a === 'object' && typeof b === 'object';
    if (!record && containers) { const hit = scoreMemo.get(a, b); if (hit) return hit; }
    let r;
    if (eq(a, b)) { const n = leaves(b); r = { m: n, n }; }
    else if (isObj(a) && isObj(b)) {
      let m = 0, n = 0;
      for (const k of new Set([...keysOf(b), ...keysOf(a)])) {
        const kp = childPath(p, k), inA = Object.hasOwn(a, k) && a[k] !== undefined, inB = Object.hasOwn(b, k) && b[k] !== undefined;
        if (!inA) { n += leaves(b[k]); if (record) note(kp, MISSING, b[k]); }
        else if (!inB) { n += leaves(a[k]); if (record) note(kp, a[k], EXTRA); }
        else { const x = cmp(a[k], b[k], kp, record); m += x.m; n += x.n; }
      }
      r = { m, n };
    } else if (Array.isArray(a) && Array.isArray(b)) r = cmpArrays(a, b, p, record);
    else { if (record) note(p, a, b); r = { m: 0, n: Math.max(leaves(a), leaves(b)) }; }
    if (!record && containers) scoreMemo.set(a, b, r);
    return r;
  }
  function cmpArrays(a, b, p, record) {
    let m = 0, n = 0;
    const pairs = [];
    if (a.length && b.length) {
      if (a.length * b.length <= MATCH_CAP) {
        const W = a.map(x => b.map(y => cmp(x, y, '', false).m));
        assignMax(W, a.length, b.length).forEach((j, i) => { if (j >= 0 && W[i][j] > 0) pairs.push({ i, j }); });
      } else {
        // Too large for the optimal assignment: check-traces' greedy (key-equal items first, then by overlap, else by position).
        stats.approx = (stats.approx ?? 0) + 1;
        const freeA = new Map();
        a.forEach((x, i) => { const k = key(x); freeA.set(k, [...(freeA.get(k) ?? []), i]); });
        const restB = [];
        b.forEach((y, j) => { const list = freeA.get(key(y)); if (list?.length) pairs.push({ i: list.shift(), j }); else restB.push(j); });
        const restA = [...freeA.values()].flat().sort((x, y) => x - y);
        for (let k = 0; k < Math.min(restA.length, restB.length); k++) pairs.push({ i: restA[k], j: restB[k] });
      }
    }
    const pairedA = new Set(pairs.map(c => c.i)), pairedB = new Set(pairs.map(c => c.j));
    for (const c of pairs.sort((x, y) => x.j - y.j)) { const r = cmp(a[c.i], b[c.j], `${p}[${c.j}]`, record); m += r.m; n += r.n; }
    b.forEach((y, j) => { if (!pairedB.has(j)) { n += leaves(y); if (record) note(`${p}[${j}]`, MISSING, y); } });
    a.forEach((x, i) => { if (!pairedA.has(i)) { n += leaves(x); if (record) note(`${p}[got ${i}]`, x, EXTRA); } });
    return { m, n };
  }
  const r = cmp(got, want, '$', true);
  return { exact: eq(got, want), partial: r.n ? r.m / r.n : 1, matched: r.m, compared: r.n, diffs, approx: stats.approx ?? 0 };
}
