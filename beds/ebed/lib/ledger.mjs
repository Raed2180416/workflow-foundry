// Ledger checks for E-bed oracles (E-BED §2.8 layers 2-3 and invariants; BED-CONTRACT v1.1 §5.2-§5.3). Oracle-side;
// written without reference to the library cards and sharing no code with them.
//
// 1. matchEffects: the effect layer of the per-case grading machine. Logical effects (lid, system, op, match, window,
//    after?, openedAt?, withdrawnAt?, money?) against ledger rows ({ at, system, op, key?, args, committed }), giving
//    per-lid status and divergences with the contract's codes:
//      outside-allowed  a row matching no open lid and no permitted pattern (acting before the rule requires it, an
//                       effect on a withdrawn obligation, an invented effect)
//      duplicate        a second committed row for a satisfied lid ("duplicate money movement" when the lid is money)
//      early            a commit before the window's earliest
//      missed           no commit by the window's latest (reported at `latest`; a later commit is kept as detail)
//      order            a commit before an `after` predecessor committed (only where a rule declares order)
//      key-split        attempts of one lid under different keys (e.g. a retry after F1/F3 with a new key)
//      key-reuse        one key (per system) used by two logical effects
//    Windows are inclusive at both ends, in epoch ms (ISO accepted). A lid whose latest is after `end` and that is not
//    yet satisfied is 'open' (censored, not graded). Rows must be in journal order (non-decreasing `at`).
//    Row-to-lid assignment: among lids with the same system, op and matching args, open at the row's time, a row goes
//    to the lid that already used its key, else to an unsatisfied lid whose window contains the row, else to any
//    unsatisfied lid, else to a satisfied one (which makes it a duplicate). Each choice takes the earliest deadline
//    (window latest, then earliest, then lid), so the verdict does not depend on the order lids are listed (review fix:
//    "first in list order" graded A [Jan 1-10], B [Jan 5-31] with rows on Jan 3 and Jan 20 as passing or failing by
//    list order). Rows are taken in journal order, and earliest-deadline-first among the containing windows is the
//    greedy rule that matches the most rows to windows.
// 2. Idempotency and multiplicity: keyViolations, atMostOnce, exactlyOnce.
// 3. Conservation identities in exact integer minor units: identity, identityByGroup, netsToZero, doubleEntry, and
//    the X12 835 balancing identities (balance835).
import { fail } from './errors.mjs';
import { toMs } from './time.mjs';
import { canonical } from '../../lib/canonical.mjs';

/** An allowed window { earliest, latest } in epoch ms from ISO or ms; earliest <= latest. */
export function allowedWindow(earliest, latest) {
  const w = { earliest: toMs(earliest), latest: toMs(latest) };
  if (w.earliest > w.latest) fail('LEDGER_INVALID', `window earliest after latest`);
  return w;
}

const argsMatch = (match, args) => Object.keys(match ?? {}).every(k => args && Object.hasOwn(args, k) && canonical(args[k]) === canonical(match[k]));

function normaliseExpected(expected) {
  const byLid = new Map();
  const list = expected.map(e => {
    if (!e || typeof e.lid !== 'string' || !e.lid) fail('LEDGER_INVALID', `logical effect needs a lid: ${JSON.stringify(e)}`);
    if (byLid.has(e.lid)) fail('LEDGER_INVALID', `duplicate lid ${e.lid}`);
    if (typeof e.system !== 'string' || typeof e.op !== 'string') fail('LEDGER_INVALID', `${e.lid}: system and op are required`);
    const w = e.window ? allowedWindow(e.window.earliest, e.window.latest) : fail('LEDGER_INVALID', `${e.lid}: window is required`);
    const n = {
      lid: e.lid, rule: e.rule ?? null, system: e.system, op: e.op, match: e.match ?? {}, window: w, after: e.after ?? [],
      openedAt: e.openedAt === undefined || e.openedAt === null ? -Infinity : toMs(e.openedAt),
      withdrawnAt: e.withdrawnAt === undefined || e.withdrawnAt === null ? Infinity : toMs(e.withdrawnAt), money: e.money === true,
    };
    byLid.set(e.lid, n);
    return n;
  });
  for (const e of list) for (const p of e.after) if (!byLid.has(p)) fail('LEDGER_INVALID', `${e.lid}: after names unknown lid ${p}`);
  return { list, byLid };
}

/**
 * Grade ledger rows against logical effects. Options: permitted patterns [{ rule?, system, op, match?, window? }],
 * end (the grading instant: horizon end or the processing point; default +Infinity grades every window).
 * Returns { ok, lids: { [lid]: { status, commitAt, key, attempts, lateCommitAt } }, divergences, first, critical }.
 */
export function matchEffects({ expected = [], permitted = [], rows = [], end = Infinity }) {
  const { list } = normaliseExpected(expected);
  const byDeadline = [...list].sort((a, b) => a.window.latest - b.window.latest || a.window.earliest - b.window.earliest || (a.lid < b.lid ? -1 : a.lid > b.lid ? 1 : 0));
  const endMs = end === Infinity ? Infinity : toMs(end);
  const pats = permitted.map(p => ({ ...p, window: p.window ? allowedWindow(p.window.earliest, p.window.latest) : null }));
  const st = new Map(list.map(e => [e.lid, { status: 'open', satisfied: false, commitAt: null, commitIdx: -1, key: undefined, attempts: 0, lateCommitAt: null }]));
  const keyOwner = new Map();
  const divs = [];
  let last = -Infinity;
  const div = (at, code, extra) => divs.push({ at, code, seq: divs.length, ...extra });
  const claimKey = (row, owner, at, idx, lid) => {
    if (row.key === undefined || row.key === null) return;
    const k = `${row.system}\u0000${row.key}`;
    const prev = keyOwner.get(k);
    if (prev === undefined) keyOwner.set(k, owner);
    else if (prev !== owner) div(at, 'key-reuse', { row: idx, key: row.key, lid, other: prev });
  };
  rows.forEach((row, idx) => {
    if (!row || typeof row.system !== 'string' || typeof row.op !== 'string' || typeof row.committed !== 'boolean') fail('LEDGER_INVALID', `row ${idx}: needs system, op and committed`);
    const t = toMs(row.at);
    if (t < last) fail('LEDGER_ORDER', `row ${idx} is out of journal order`);
    last = t;
    const cands = list.filter(e => e.system === row.system && e.op === row.op && t >= e.openedAt && argsMatch(e.match, row.args)
      && !(t >= e.withdrawnAt && !st.get(e.lid).satisfied));
    let c = null;
    if (row.key !== undefined && row.key !== null) c = cands.find(e => st.get(e.lid).key === row.key) ?? null;
    c = c ?? cands.find(e => !st.get(e.lid).satisfied) ?? cands[0] ?? null;
    if (!c) {
      const pi = pats.findIndex(p => p.system === row.system && p.op === row.op && argsMatch(p.match, row.args) && (!p.window || (t >= p.window.earliest && t <= p.window.latest)));
      if (pi >= 0) claimKey(row, `permitted:${pi}:${canonical(row.args ?? null)}`, t, idx, null);
      else { div(t, 'outside-allowed', { row: idx, system: row.system, op: row.op }); claimKey(row, `outside:${idx}`, t, idx, null); }
      return;
    }
    const s = st.get(c.lid);
    const key = row.key === undefined ? null : row.key;
    if (s.attempts > 0 && key !== s.key) div(t, 'key-split', { row: idx, lid: c.lid, key, first: s.key });
    if (s.attempts === 0) s.key = key;
    s.attempts += 1;
    claimKey(row, c.lid, t, idx, c.lid);
    if (!row.committed) return;
    if (s.satisfied) { div(t, 'duplicate', { row: idx, lid: c.lid, money: c.money }); return; }
    s.satisfied = true; s.commitAt = t; s.commitIdx = idx;
    if (t < c.window.earliest) { s.status = 'early'; div(t, 'early', { row: idx, lid: c.lid }); return; }
    if (t > c.window.latest) { s.status = 'late'; s.lateCommitAt = t; return; }
    s.status = 'satisfied';
    for (const p of c.after) {
      const ps = st.get(p);
      if (!(ps.satisfied && ps.commitIdx < idx)) { div(t, 'order', { row: idx, lid: c.lid, before: p }); break; }
    }
  });
  for (const e of list) {
    const s = st.get(e.lid);
    if (s.status === 'satisfied' || s.status === 'early') continue;
    if (!s.satisfied && e.withdrawnAt <= e.window.latest) { s.status = 'withdrawn'; continue; }
    if (e.window.latest <= endMs) { s.status = s.status === 'late' ? 'late' : 'missed'; div(e.window.latest, 'missed', { lid: e.lid, lateCommitAt: s.lateCommitAt }); }
    else s.status = 'open';
  }
  divs.sort((a, b) => a.at - b.at || a.seq - b.seq);
  const divergences = divs.map(({ seq, ...d }) => d);
  const critical = divergences.filter(d => d.code === 'duplicate' && d.money).map(d => ({ code: 'duplicate-money', lid: d.lid, at: d.at, row: d.row }));
  const lids = Object.fromEntries(list.map(e => { const s = st.get(e.lid); return [e.lid, { status: s.status, commitAt: s.commitAt, key: s.key ?? null, attempts: s.attempts, lateCommitAt: s.lateCommitAt }]; }));
  return { ok: divergences.length === 0, lids, divergences, first: divergences[0] ?? null, critical };
}

// ---------------------------------------------------------------------------------------------------------------------
// Idempotency and multiplicity

/**
 * Key invariants of a keyed system's ledger (host-side guarantees, checked analyst-side): the same (system, key) with
 * different arguments ('key-conflict'), or committed more than once ('double-apply').
 */
export function keyViolations(rows) {
  const groups = new Map();
  rows.forEach((r, idx) => {
    if (r.key === undefined || r.key === null) return;
    const k = `${r.system}\u0000${r.key}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ r, idx });
  });
  const out = [];
  for (const [, g] of groups) {
    const digests = new Set(g.map(({ r }) => canonical([r.op, r.args ?? null])));
    if (digests.size > 1) out.push({ code: 'key-conflict', system: g[0].r.system, key: g[0].r.key, rows: g.map(x => x.idx) });
    const commits = g.filter(({ r }) => r.committed);
    if (commits.length > 1) out.push({ code: 'double-apply', system: g[0].r.system, key: g[0].r.key, rows: commits.map(x => x.idx) });
  }
  return out;
}

/** Committed rows selected by `select` grouped by `keyOf`: groups with more than one commit (e.g. "<= 1 payment per invoice"). */
export function atMostOnce(rows, { select = () => true, keyOf }) {
  const groups = new Map();
  rows.forEach((r, idx) => {
    if (!r.committed || !select(r)) return;
    const k = canonical(keyOf(r));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(idx);
  });
  return [...groups].filter(([, g]) => g.length > 1).map(([key, g]) => ({ code: 'more-than-once', key: JSON.parse(key), rows: g }));
}

/** Like atMostOnce, plus every key in `required` must have exactly one commit ("provisional credit exactly once"). */
export function exactlyOnce(rows, { select = () => true, keyOf, required }) {
  const out = atMostOnce(rows, { select, keyOf });
  const have = new Set(rows.filter(r => r.committed && select(r)).map(r => canonical(keyOf(r))));
  for (const k of required) if (!have.has(canonical(k))) out.push({ code: 'missing', key: k, rows: [] });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Conservation identities (exact integer minor units)

const big = (v, where) => {
  if (!Number.isSafeInteger(v)) fail('LEDGER_INVALID', `${where}: amount must be a safe integer of minor units, got ${JSON.stringify(v)}`);
  return BigInt(v);
};
const out = b => (b <= BigInt(Number.MAX_SAFE_INTEGER) && b >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(b) : b.toString());
const sum = (xs, where) => xs.reduce((a, v, i) => a + big(v, `${where}[${i}]`), 0n);

/** Exact sum of integer minor units (refuses non-integers). */
export const sumMinor = xs => out(sum(xs, 'sumMinor'));

/** Σ lhs = Σ rhs: { ok, lhs, rhs, diff } with diff = lhs - rhs. */
export function identity(lhs, rhs) {
  const l = sum(lhs, 'lhs'), r = sum(rhs, 'rhs');
  return { ok: l === r, lhs: out(l), rhs: out(r), diff: out(l - r) };
}

/** Per group: Σ lhs(row) = Σ rhs(row) (e.g. per PO line: Σ invoiced = Σ matched + Σ held). Violations only. */
export function identityByGroup(rows, { group, lhs, rhs }) {
  const groups = new Map();
  for (const r of rows) {
    const k = canonical(group(r));
    if (!groups.has(k)) groups.set(k, { l: [], r: [] });
    groups.get(k).l.push(...[].concat(lhs(r))); groups.get(k).r.push(...[].concat(rhs(r)));
  }
  const bad = [];
  for (const [k, g] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const res = identity(g.l, g.r);
    if (!res.ok) bad.push({ code: 'identity', group: JSON.parse(k), ...res });
  }
  return bad;
}

/** Per group: Σ amount = 0 (eliminations net to zero; group totals conserved). Violations only. */
export const netsToZero = (rows, { group, amount }) => identityByGroup(rows, { group, lhs: amount, rhs: () => [] }).map(v => ({ ...v, code: 'nonzero' }));

/**
 * Double entry: every journal entry balances per currency. entries: [{ id, lines: [{ account, side: 'debit' |
 * 'credit', amount (positive minor units), currency }] }]. Violations only.
 */
export function doubleEntry(entries) {
  const bad = [];
  for (const e of entries) {
    const per = new Map();
    for (const [i, l] of e.lines.entries()) {
      if (l.side !== 'debit' && l.side !== 'credit') fail('LEDGER_INVALID', `entry ${e.id} line ${i}: side must be debit or credit`);
      const a = big(l.amount, `entry ${e.id} line ${i}`);
      if (a < 0n) fail('LEDGER_INVALID', `entry ${e.id} line ${i}: amounts are positive; the side carries the sign`);
      const c = per.get(l.currency) ?? { d: 0n, c: 0n };
      if (l.side === 'debit') c.d += a; else c.c += a;
      per.set(l.currency, c);
    }
    for (const [currency, { d, c }] of [...per].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) if (d !== c) bad.push({ code: 'unbalanced', entry: e.id, currency, debit: out(d), credit: out(c), diff: out(d - c) });
  }
  return bad;
}

/**
 * X12 835 balancing (ASC X12 005010X221 TR3 §1.10.2.1, as quoted in X12 RFI 2601, x12.org, retrieved 2026-10-14;
 * transaction level as stated in BCBSOK's PLB guide, bcbsok.com ok-pl-segment-835era-2018.pdf):
 *   service line   SVC02 - Σ CAS03 (line) = SVC03
 *   claim          CLP03 - Σ CAS (claim level) - Σ CAS (all its lines) = CLP04
 *   transaction    Σ CLP04 - Σ PLB amounts = BPR02 (PLB: positive reduces the payment, negative increases it)
 *   line charges   Σ SVC02 = CLP03 when service lines are present (a validator rule, IBM APAR PH17298; on by
 *                  default, off with requireLineChargeSum: false)
 * remit = { bpr02, claims: [{ id, clp03, clp04, adjustments: [{ group, reason, amount }], lines: [{ id, svc02, svc03,
 * adjustments }] }], plb: [{ reason, amount }] }. All amounts in integer cents. Returns violations (empty = balanced).
 */
export function balance835(remit, { requireLineChargeSum = true } = {}) {
  const bad = [];
  const adj = (xs, where) => sum((xs ?? []).map(a => a.amount), where);
  let paid = 0n;
  for (const c of remit.claims ?? []) {
    const lines = c.lines ?? [];
    let lineAdj = 0n, lineCharge = 0n;
    for (const l of lines) {
      const a = adj(l.adjustments, `claim ${c.id} line ${l.id}`);
      lineAdj += a; lineCharge += big(l.svc02, `claim ${c.id} line ${l.id} SVC02`);
      const lhs = big(l.svc02, 'SVC02') - a, rhs = big(l.svc03, 'SVC03');
      if (lhs !== rhs) bad.push({ code: 'line', claim: c.id, line: l.id, expected: out(lhs), svc03: out(rhs), diff: out(rhs - lhs) });
    }
    const lhs = big(c.clp03, `claim ${c.id} CLP03`) - adj(c.adjustments, `claim ${c.id}`) - lineAdj, rhs = big(c.clp04, `claim ${c.id} CLP04`);
    if (lhs !== rhs) bad.push({ code: 'claim', claim: c.id, expected: out(lhs), clp04: out(rhs), diff: out(rhs - lhs) });
    if (requireLineChargeSum && lines.length && lineCharge !== big(c.clp03, 'CLP03')) bad.push({ code: 'line-charges', claim: c.id, sumSvc02: out(lineCharge), clp03: c.clp03, diff: out(lineCharge - BigInt(c.clp03)) });
    paid += rhs;
  }
  const expected = paid - adj(remit.plb, 'PLB'), bpr02 = big(remit.bpr02, 'BPR02');
  if (expected !== bpr02) bad.push({ code: 'transaction', expected: out(expected), bpr02: out(bpr02), diff: out(bpr02 - expected) });
  return bad;
}
