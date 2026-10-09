// Effect-log conformance evaluator (BLOCKER-SYNTHESIS row 17, B14-E1). No dependencies, no model calls.
//
// An effect log is a list of events, each  { case, type, key, t?, stream? }:
//   case    the unit alignment runs in (a scenario, a seed's case, a mail batch);
//   type    the effect type, e.g. "ha.service:notify.alexa_media_garage", "jira.createIssue", "table.row:by_variant_report";
//   key     a JSON object of the effect's key fields (the data that decides whether two effects are "the same effect");
//   t       optional virtual time in seconds;
//   stream  optional ordering stream (events of different streams commute; default "main").
//   pre     optional: the key is already in normal form (the oracle's own expected trace), skip N.keyMap.
//
// ALIGNMENT RULE (declared; this is the whole rule)
//  1. Every event is projected to a signature = type + canonical JSON of its key after the declared normalisation N
//     (text, set, duration, ignore ... rules per field; see normalise()).
//  2. Two events MATCH when their signatures are equal and, if both carry t, |t1 - t2| <= N.timeTolerance.
//  3. Per case, events are grouped by stream. Within a stream:
//       - order "bag":  an optimal one-to-one matching (greedy by time within a signature, which is optimal for a
//                       symmetric window): order is not judged.
//       - order "seq":  a longest common subsequence under the MATCH predicate (sequence alignment with unit-cost
//                       log moves and model moves; a changed event is one model move plus one log move, no substitution).
//       - order "auto" (default): "bag" for a stream whose events all carry t (time already orders them, and events inside
//                       the tolerance are concurrent), "seq" otherwise.
//  4. fitness   = matched / |expected|     (share of expected effects reproduced, in order where order matters)
//     precision = matched / |observed|     (share of observed effects that were expected)
//     An empty denominator gives 1 for that measure (vacuous); both empty gives fitness = precision = 1.
//     alignmentCost = |expected| + |observed| - 2 * matched.
//  5. A design is ACCEPTED at threshold tau when every case has fitness >= tau and precision >= tau (tau = 1 is strict).
//
// Nothing here knows about any platform. What is item-specific is (a) the log extraction (adapters/) and (b) the
// declared normalisation N (normalisation/): both are small, declared, and frozen before scoring.

// ---------------------------------------------------------------------------------------------------- normalisation
const QUOTES = [[/[‘’ʼ′]/g, "'"], [/[“”″]/g, '"'], [/[–—]/g, '-'], [/ /g, ' ']];

export function textNorm(s, N = {}) {
  let x = String(s ?? '');
  for (const [re, to] of QUOTES) x = x.replace(re, to);
  x = x.replace(/\s+/g, ' ').trim();
  if (N.caseInsensitive) x = x.toLowerCase();
  for (const [src, flags, rep] of N.textSubst ?? []) x = x.replace(new RegExp(src, flags), rep);
  return x;
}

export const canonical = v => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
};

export const parseDuration = d => {
  if (typeof d === 'number') return d;
  if (d && typeof d === 'object') return (d.hours ?? 0) * 3600 + (d.minutes ?? 0) * 60 + (d.seconds ?? 0);
  const s = String(d).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : s;
};

// Rule kinds a normalisation may attach to a field name (or "type#field"):
//   ignore                  drop the field
//   set / uset              array compared as a sorted multiset / sorted set
//   duration                "0:30:00", "1800", {minutes:30}, 1800 -> seconds
//   ci                      case-insensitive text
//   tokens:<regex>          replace the text by the sorted set of substrings matching the regex
//   unixDate                unix seconds -> UTC date of (t + 12 h): equal for a UTC-midnight and a Europe/Berlin-midnight stamp
//   bool                    truthy/falsy -> boolean
//   fn:<name>               a function from N.fns
function applyRule(v, rule, N) {
  if (rule === 'ignore') return undefined;
  if (rule === 'set') return (Array.isArray(v) ? v : [v]).map(x => normValue(x, N)).map(canonical).sort();
  if (rule === 'uset') return [...new Set((Array.isArray(v) ? v : [v]).map(x => canonical(normValue(x, N))))].sort();
  if (rule === 'duration') return parseDuration(v);
  if (rule === 'ci') return textNorm(v, { ...N, caseInsensitive: true });
  if (rule === 'bool') return Boolean(v);
  if (rule === 'unixDate') { const n = Number(v); return Number.isFinite(n) && String(v).trim() !== '' ? new Date((n + 43200) * 1000).toISOString().slice(0, 10) : textNorm(v, N); }
  if (rule.startsWith('tokens:')) return [...new Set(String(v ?? '').match(new RegExp(rule.slice(7), 'g')) ?? [])].sort();
  if (rule.startsWith('fn:')) return N.fns[rule.slice(3)](v);
  throw new Error(`unknown normalisation rule ${rule}`);
}

function normValue(v, N, rules = {}, type = '', path = '') {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return textNorm(v, N);
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(x => normValue(x, N, rules, type, path));
  const out = {};
  for (const k of Object.keys(v).sort()) {
    const rule = rules[`${type}#${k}`] ?? rules[k];
    if (rule) { const r = applyRule(v[k], rule, N); if (r !== undefined) out[k] = r; }
    else out[k] = normValue(v[k], N, rules, type, `${path}.${k}`);
  }
  return out;
}

export function project(ev, N) {
  const rules = N.fieldRules ?? {};
  const type = N.typeMap?.[ev.type] ?? ev.type;
  const key = normValue(N.keyMap && !ev.pre ? N.keyMap(ev.type, ev.key ?? {}, ev) : ev.key ?? {}, N, rules, ev.type);
  return { sig: `${type}|${canonical(key)}`, type, t: ev.t, stream: ev.stream ?? 'main', raw: ev };
}

// ---------------------------------------------------------------------------------------------------- alignment
const timeOk = (a, b, tol) => a.t === undefined || b.t === undefined || tol == null || Math.abs(a.t - b.t) <= tol + 1e-9;
const matchOk = (a, b, tol) => a.sig === b.sig && timeOk(a, b, tol);

function bagMatch(E, O, tol) {
  const by = ev => { const m = new Map(); for (const x of ev) { if (!m.has(x.sig)) m.set(x.sig, []); m.get(x.sig).push(x); } return m; };
  const me = by(E), mo = by(O);
  const pairs = [], missing = [], extra = [];
  for (const sig of new Set([...me.keys(), ...mo.keys()])) {
    const e = (me.get(sig) ?? []).slice().sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
    const o = (mo.get(sig) ?? []).slice().sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
    const used = new Array(o.length).fill(false);
    let j = 0;
    for (const x of e) {
      while (j < o.length && o[j].t !== undefined && x.t !== undefined && tol != null && o[j].t < x.t - tol - 1e-9) { j++; }
      if (j < o.length && timeOk(x, o[j], tol)) { used[j] = true; pairs.push([x, o[j]]); j++; } else missing.push(x);
    }
    o.forEach((y, i) => { if (!used[i]) extra.push(y); });
  }
  return { pairs, missing, extra };
}

function lcsMatch(E0, O0, tol) {
  // common prefix / suffix are always part of some optimal alignment: peel them off (exact, only a speed-up)
  let a = 0; const pre = [];
  while (a < E0.length && a < O0.length && matchOk(E0[a], O0[a], tol)) { pre.push([E0[a], O0[a]]); a++; }
  let b = 0; const suf = [];
  while (b < E0.length - a && b < O0.length - a && matchOk(E0[E0.length - 1 - b], O0[O0.length - 1 - b], tol)) { suf.push([E0[E0.length - 1 - b], O0[O0.length - 1 - b]]); b++; }
  const mid = lcsCore(E0.slice(a, E0.length - b), O0.slice(a, O0.length - b), tol);
  return { pairs: [...pre, ...mid.pairs, ...suf.reverse()], missing: mid.missing, extra: mid.extra };
}

function lcsCore(E, O, tol) {
  const n = E.length, m = O.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = matchOk(E[i], O[j], tol) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [], missing = [], extra = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (matchOk(E[i], O[j], tol) && dp[i][j] === dp[i + 1][j + 1] + 1) { pairs.push([E[i], O[j]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) missing.push(E[i++]); else extra.push(O[j++]);
  }
  while (i < n) missing.push(E[i++]);
  while (j < m) extra.push(O[j++]);
  return { pairs, missing, extra };
}

const groupBy = (list, f) => { const m = new Map(); for (const x of list) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };

/** Align one case. expected, observed: projected events in log order. */
export function alignCase(expected, observed, N) {
  const tol = N.timeTolerance ?? null;
  const mode = N.order ?? 'auto';
  const se = groupBy(expected, x => x.stream), so = groupBy(observed, x => x.stream);
  let matched = 0, bagMatched = 0;
  const missing = [], extra = [];
  for (const s of new Set([...se.keys(), ...so.keys()])) {
    const e = se.get(s) ?? [], o = so.get(s) ?? [];
    const timed = e.concat(o).every(x => x.t !== undefined);
    const sm = N.streamOrder?.(s) ?? mode;   // optional declared per-stream order mode (e.g. a table the job sorts vs one it does not)
    const seq = sm === 'seq' || (sm === 'auto' && !timed);
    const bag = bagMatch(e, o, tol);
    bagMatched += bag.pairs.length;
    const r = seq ? lcsMatch(e, o, tol) : bag;
    matched += r.pairs.length; missing.push(...r.missing); extra.push(...r.extra);
  }
  const nE = expected.length, nO = observed.length;
  const fitness = nE === 0 ? 1 : matched / nE;
  const precision = nO === 0 ? 1 : matched / nO;
  return { nE, nO, matched, bagMatched, orderMoves: bagMatched - matched, fitness, precision,
    f1: fitness + precision === 0 ? 0 : (2 * fitness * precision) / (fitness + precision), alignmentCost: nE + nO - 2 * matched,
    missing: missing.slice(0, 5).map(x => ({ type: x.type, sig: x.sig.slice(0, 200), t: x.t })), extra: extra.slice(0, 5).map(x => ({ type: x.type, sig: x.sig.slice(0, 200), t: x.t })),
    nMissing: missing.length, nExtra: extra.length };
}

/** Compare whole logs: arrays of raw events grouped by .case. Returns per-case results and micro/strict aggregates. */
export function conform(expectedLog, observedLog, N) {
  if (N.prepare) { expectedLog = N.prepare(expectedLog); observedLog = N.prepare(observedLog); }   // whole-log, stateful id canonicalisation (declared)
  const pe = groupBy(expectedLog.map(ev => ({ ...project(ev, N), case: ev.case })), x => x.case);
  const po = groupBy(observedLog.map(ev => ({ ...project(ev, N), case: ev.case })), x => x.case);
  const cases = {};
  for (const c of new Set([...pe.keys(), ...po.keys()])) cases[c] = alignCase(pe.get(c) ?? [], po.get(c) ?? [], N);
  return { cases, ...aggregate(cases) };
}

export function aggregate(cases) {
  const vs = Object.values(cases);
  const sum = f => vs.reduce((a, c) => a + f(c), 0);
  const nE = sum(c => c.nE), nO = sum(c => c.nO), m = sum(c => c.matched);
  const fitness = nE === 0 ? 1 : m / nE, precision = nO === 0 ? 1 : m / nO;
  return { nCases: vs.length, nE, nO, matched: m, fitness, precision, f1: fitness + precision === 0 ? 0 : (2 * fitness * precision) / (fitness + precision),
    minFitness: Math.min(1, ...vs.map(c => c.fitness)), minPrecision: Math.min(1, ...vs.map(c => c.precision)),
    casesExact: vs.filter(c => c.fitness === 1 && c.precision === 1).length };
}

/** Verdict at threshold tau: every case must reach tau on both measures. casesShare: accept if this share of cases is exact. */
export const accept = (res, tau = 1) => res.nCases === 0 ? false : res.minFitness >= tau - 1e-12 && res.minPrecision >= tau - 1e-12;
export const acceptShare = (res, share) => res.nCases > 0 && res.casesExact / res.nCases >= share - 1e-12;

// ---------------------------------------------------------------------------------------------------- statistics
export function ranks(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
  return r;
}
export function spearman(a, b) {
  if (a.length < 3) return null;
  const ra = ranks(a), rb = ranks(b), n = a.length;
  const ma = ra.reduce((x, y) => x + y, 0) / n, mb = rb.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (ra[i] - ma) * (rb[i] - mb); saa += (ra[i] - ma) ** 2; sbb += (rb[i] - mb) ** 2; }
  return saa === 0 || sbb === 0 ? null : sab / Math.sqrt(saa * sbb);
}
// Kendall tau-b with ties.
export function kendall(a, b) {
  const n = a.length; if (n < 3) return null;
  let c = 0, d = 0, ta = 0, tb = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const x = Math.sign(a[i] - a[j]), y = Math.sign(b[i] - b[j]);
    if (x === 0 && y === 0) continue; if (x === 0) { ta++; continue; } if (y === 0) { tb++; continue; }
    if (x === y) c++; else d++;
  }
  const den = Math.sqrt((c + d + ta) * (c + d + tb));
  return den === 0 ? null : (c - d) / den;
}
