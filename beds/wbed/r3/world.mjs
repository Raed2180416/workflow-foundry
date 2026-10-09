// World model for W-bed R3 "statement audit" (W-BED §3.3). One task is a month-end audit of N supplier statements
// (8/16/32/48 by difficulty) against our accounts-payable ledger. Each supplier prints its statement from one of the
// back office's billing systems (R1's dialects, lib/dialects.mjs). Per item: match documents by reference, classify each
// difference into a reason code that only the notes decide, compute the adjusted balance. Fan-in: per-reason counts and
// US-cent totals by a stated conversion rule. The oracle, the reference solver and every control derive from
// buildAudit(seed, split, difficulty).
import { refKey, dayNum, lastDayOfMonth, minorDigits, CURRENCIES, longDay } from '../lib/domain.mjs';
import { taskRng } from '../lib/prng.mjs';
import { hooks } from '../lib/faults.mjs';
import { drawCompanies, SECTORS, fullName, slug } from '../lib/parties.mjs';
import { DIALECT_CURRENCIES } from '../lib/dialects.mjs';
import { drawQuotes } from '../lib/fx.mjs';
import { CR_SYSTEMS, EXPLAIN, NOISE, MONTH_NAMES, dateStyleOf } from './vocab.mjs';
import { renderAudit } from './render.mjs';

export const VERSION = '1.0.0';
export const MIN_D = 2, MAX_D = 5;

// Knobs per difficulty. n: statements (the fan-out width); lines: statement lines per supplier; systems: billing
// systems suppliers print from; fx: FX reason and USD-paid suppliers; atlasConv: ATLAS date order drawn per task;
// aliasP: share of suppliers our ledger names by another name; cr: statements printing credits with a "CR" suffix;
// perVendor: mean discrepancies per supplier.
export const LEVELS = {
  2: { n: 8, lines: [10, 16], systems: ['BRIGHTDESK', 'LEDGR', 'VERITAS'], fx: false, atlasConv: false, aliasP: 0, cr: false, perVendor: 1.4 },
  3: { n: 16, lines: [12, 22], systems: ['BRIGHTDESK', 'LEDGR', 'VERITAS', 'ATLAS'], fx: true, atlasConv: true, aliasP: 0.3, cr: false, perVendor: 1.4 },
  4: { n: 32, lines: [22, 36], systems: ['BRIGHTDESK', 'LEDGR', 'VERITAS', 'ATLAS', 'TALLY'], fx: true, atlasConv: true, aliasP: 0.3, cr: true, perVendor: 1.5 },
  5: { n: 48, lines: [24, 40], systems: ['BRIGHTDESK', 'LEDGR', 'VERITAS', 'ATLAS', 'TALLY', 'KOBO', 'VENDEX'], fx: true, atlasConv: true, aliasP: 0.35, cr: true, perVendor: 1.6 },
};
const ABBR = { Freight: 'Frt', Packaging: 'Pkg', 'Office Supply': 'Off. Sup.', Print: 'Prt', Facilities: 'Fac.', Hardware: 'Hdw', Catering: 'Cat.', Logistics: 'Log.' };
const CITIES = ['Leeds', 'Bremen', 'Lyon', 'Valencia', 'Manchester', 'Hamburg', 'Osaka'];

// ---------------------------------------------------------------------------------------------------------------------
// The reason rule (inputs.audit_spec section 3) over one difference. Shared by the pipeline, relations and tests.
// diff = { type: 'INV'|'CRN'|'PMT'|'BF', key, stmtCount, ledgerCount, amount, day }.
export function reasonOf(world, vendor, diff, opts = {}) {
  const { stmtCount: sc, ledgerCount: lc } = diff;
  if (sc > lc && lc >= 1) return 'DUPLICATE';
  if (sc === 0 || lc === 0) {
    if (opts.timingAll) return 'TIMING';
    if (!opts.timingIgnored && diff.day >= world.cutoff) return 'TIMING';
    if (diff.type === 'CRN' && sc > 0 && (opts.creditAlwaysMissing || vendor.notes.credit.has(diff.key))) return 'MISSING_CREDIT';
    return 'UNEXPLAINED';
  }
  if (diff.type === 'INV' && (vendor.notes.price.has(diff.key) || (opts.memoMeansPrice && vendor.notes.price.size > 0))) return 'PRICE';
  if (diff.type === 'PMT' && (vendor.notes.fx.has(diff.key) || opts.paymentDiffFx)) return 'FX';
  return 'UNEXPLAINED';
}

// ---------------------------------------------------------------------------------------------------------------------
const worldCache = new Map();
let verifier = null;
export function setVerifier(fn) { verifier = fn; }

export function buildAudit(seed, split = 'dev', difficulty = 3) {
  const key = JSON.stringify([seed, split, difficulty]);
  if (worldCache.has(key)) return worldCache.get(key);
  if (!LEVELS[difficulty]) throw new Error(`wbed-r3: difficulty must be ${MIN_D}..${MAX_D}, got ${difficulty}`);
  if (split !== 'dev' && split !== 'test') throw new Error(`wbed-r3: split must be 'dev' or 'test', got ${split}`);
  let world = null, last = null;
  for (let attempt = 0; attempt < 60 && !world; attempt++) {
    const w = attemptAudit({ seed, split, difficulty }, attempt);
    if (w.reject) { last = w.reject; continue; }
    world = w;
  }
  if (!world) throw new Error(`wbed-r3: no valid audit for seed ${seed} d${difficulty} (${last})`);
  worldCache.set(key, world);
  if (worldCache.size > 16) worldCache.delete(worldCache.keys().next().value);
  return world;
}

function attemptAudit(spec, attempt) {
  const L = LEVELS[spec.difficulty];
  const r = taskRng('r3', 'audit', spec, attempt);
  const reject = reason => ({ reject: reason });
  const closeMonth = r.int(3, 8);
  const S = lastDayOfMonth(2025, closeMonth);
  const cutoff = S - r.int(5, 9);
  const P = dayNum(2025, closeMonth - 2, 1) - 1; // opening balance date: the last day before the three-month period
  const atlasOrder = L.atlasConv ? r.pick(['DMY', 'MDY']) : 'DMY';

  // ---- suppliers
  const comps = drawCompanies(r, L.n);
  const sysOrder = r.shuffle(L.systems);
  const vendors = comps.map((c, i) => {
    const system = i < sysOrder.length ? sysOrder[i] : r.pick(L.systems);
    const other = r.pick(SECTORS.filter(s => s.word !== c.sector)).word;
    return { ...c, id: `V-${301 + i}`, system, currency: r.pick(DIALECT_CURRENCIES[system]), dateStyle: dateStyleOf(system, atlasOrder),
      aliases: [`${c.stem} ${ABBR[c.sector]}`, `${c.stem} ${other} ${c.legal}`], aliasUse: L.aliasP > 0 && r.chance(L.aliasP),
      cr: L.cr && CR_SYSTEMS.includes(system) && r.chance(0.5), file: `${slug(`${c.stem}-${c.sector}`)}.txt`,
      pfx: (c.stem[0] + c.sector[0]).toUpperCase(), refFmt: r.int(0, 2),
      stmt: [], ledger: [], plan: [], memo: [], ap: [], notes: { price: new Set(), fx: new Set(), credit: new Set() } };
  });
  if (L.aliasP > 0 && !vendors.some(v => v.aliasUse)) r.pick(vendors).aliasUse = true;
  if (L.cr && !vendors.some(v => v.cr)) {
    const el = vendors.filter(v => CR_SYSTEMS.includes(v.system));
    if (!el.length) return reject('no-cr-system');
    r.pick(el).cr = true;
  }

  // ---- references (unique keys within the task)
  const used = new Set();
  const take = s => { const k = refKey(s); if (used.has(k)) return null; used.add(k); return s; };
  const d4 = () => String(r.int(1000, 9999)), d5 = () => String(r.int(10000, 99999));
  const invRef = v => { for (;;) { const s = [`${v.pfx}-${d4()}`, `${v.pfx}/${d5()}`, `INV ${v.pfx}${d4()}`][v.refFmt]; if (take(s)) return s; } };
  const crnRef = v => { for (;;) { const s = v.system === 'LEDGR' ? `GS-${d4()}` : v.system === 'KOBO' ? `H${d5()}` : `CN-${v.pfx}${d4()}`; if (take(s)) return s; } };
  const payRef = () => { for (;;) { const s = `PAY-${d5()}`; if (take(s)) return s; } };
  const loose = s => [s.toLowerCase(), s.replace(/[-/ ]/g, ''), s.replace(/[-/]/g, ' ')][r.int(0, 2)];
  const amountOf = (cur, lo, hi) => {
    const units = Math.exp(r.float(Math.log(lo), Math.log(hi))) / CURRENCIES[cur].rate;
    return Math.max(1, Math.round(units * 10 ** minorDigits(cur)));
  };
  const dayIn = (lo, hi) => r.int(lo, hi);

  // ---- discrepancy plan
  const items = [{ reason: 'TIMING', v: 'pay' }, { reason: 'TIMING', v: 'inv' }, { reason: 'PRICE', v: 'p' },
    { reason: 'DUPLICATE', v: 'd' }, { reason: 'MISSING_CREDIT', v: 'm' }, { reason: 'MISSING_CREDIT', v: 'm' },
    { reason: 'UNEXPLAINED', v: 'a-near' }, { reason: 'UNEXPLAINED', v: 'd' }];
  if (spec.difficulty >= 3) items.push({ reason: 'DUPLICATE', v: 'd' }, { reason: 'UNEXPLAINED', v: 'c' });
  if (L.fx) items.push({ reason: 'FX', v: 'f' }, { reason: 'FX', v: 'f' }, { reason: 'UNEXPLAINED', v: 'e' });
  const target = Math.round(L.n * L.perVendor);
  const extraPool = [['TIMING', 'pay'], ['TIMING', 'inv'], ['PRICE', 'p'], ['DUPLICATE', 'd'], ['MISSING_CREDIT', 'm'], ['UNEXPLAINED', 'a'],
    ['UNEXPLAINED', 'b'], ['UNEXPLAINED', 'c'], ['UNEXPLAINED', 'd'], ...(L.fx ? [['FX', 'f'], ['UNEXPLAINED', 'e']] : [])];
  while (items.length + 2 < target) { const [reason, v] = r.pick(extraPool); items.push({ reason, v }); }
  const nClean = Math.max(1, Math.round(L.n * 0.15));
  const order = r.shuffle(vendors);
  const clean = new Set(order.slice(0, nClean));
  const active = order.slice(nClean);
  const bundleV = active[0];
  bundleV.plan.push({ reason: 'PRICE', v: 'p' }, { reason: 'UNEXPLAINED', v: 'b' }); // the memo-means-price trap
  let k = 1;
  for (const it of r.shuffle(items)) {
    let placed = false;
    for (let t = 0; t < active.length && !placed; t++) {
      const v = active[(k + t) % active.length];
      if (v.plan.length < 4 && (it.reason !== 'FX' || v.currency !== 'USD')) { v.plan.push(it); placed = true; k = (k + t + 1) % active.length; }
    }
    if (!placed) return reject('plan-capacity');
  }
  for (const v of active.filter(x => x.plan.length === 0)) { // rebalance: every active supplier gets one discrepancy
    const donor = active.find(x => x !== bundleV && x.plan.length >= 2 && x.plan.some(it => it.reason !== 'FX' || v.currency !== 'USD'));
    if (!donor) return reject('empty-active');
    const i = donor.plan.findIndex(it => it.reason !== 'FX' || v.currency !== 'USD');
    v.plan.push(...donor.plan.splice(i, 1));
  }

  // ---- documents per supplier
  for (const v of vendors) {
    const cur = v.currency;
    const T = r.int(L.lines[0], L.lines[1]);
    const ob = r.chance(0.7) ? amountOf(cur, 200, 15000) : 0;
    v.stmt.push({ type: 'BF', ref: 'b/f', key: 'B/F', day: P, amount: ob });
    v.ledger.push({ type: 'BF', ref: 'b/f', key: 'B/F', day: P, amount: ob });
    const both = (type, ref, day, amount, ledgerAmount = amount) => {
      v.stmt.push({ type, ref, key: refKey(ref), day, amount });
      v.ledger.push({ type, ref: r.chance(0.2) ? loose(ref) : ref, key: refKey(ref), day, amount: ledgerAmount });
    };
    const stmtOnly = (type, ref, day, amount) => v.stmt.push({ type, ref, key: refKey(ref), day, amount });
    const ledgerOnly = (type, ref, day, amount) => v.ledger.push({ type, ref, key: refKey(ref), day, amount });
    const [item] = r.pick(v.goods);
    const early = () => dayIn(P + 1, cutoff - 1), late = () => dayIn(cutoff, S);
    const vx = { vendor: v.name, currency: cur, month: MONTH_NAMES[closeMonth - 2], item, contact: fullName(v.contact), qty: r.int(2, 30) };
    const explain = (reason, x) => {
      const where = r.chance(0.5) ? 'memo' : 'ap';
      const pool = EXPLAIN[reason][where];
      (where === 'memo' ? v.memo : v.ap).push(r.pick(pool)({ ...vx, ...x }));
    };
    const money = m => `${cur} ${m}`;
    for (const it of v.plan) {
      let disc;
      switch (`${it.reason}/${it.v}`) {
        case 'TIMING/pay': { const ref = payRef(), a = amountOf(cur, 150, 8000); ledgerOnly('PMT', ref, late(), -a); disc = { ref, amount: a }; break; }
        case 'TIMING/inv': { const ref = invRef(v), a = amountOf(cur, 150, 8000); stmtOnly('INV', ref, late(), a); disc = { ref, amount: a }; break; }
        case 'PRICE/p': case 'UNEXPLAINED/b': {
          const ref = invRef(v), a1 = amountOf(cur, 300, 8000);
          const a2 = Math.max(1, Math.round(a1 * (1 + (r.chance(0.7) ? 1 : -1) * r.float(0.02, 0.15))));
          both('INV', ref, early(), a2, a1);
          if (it.reason === 'PRICE') { v.notes.price.add(refKey(ref)); explain('PRICE', { ref }); }
          disc = { ref, amount: a2 - a1 }; break;
        }
        case 'FX/f': case 'UNEXPLAINED/e': {
          const ref = payRef(), p1 = amountOf(cur, 300, 8000);
          const p2 = Math.max(1, Math.round(p1 * (1 + (r.chance(0.5) ? 1 : -1) * r.float(0.005, 0.03))));
          if (p2 === p1) return reject('fx-equal');
          both('PMT', ref, early(), -p2, -p1);
          if (it.reason === 'FX') { v.notes.fx.add(refKey(ref)); explain('FX', { ref, amount: money(fmtMinor(cur, p2)) }); }
          disc = { ref, amount: p1 - p2 }; break;
        }
        case 'DUPLICATE/d': {
          const ref = invRef(v), a = amountOf(cur, 150, 8000), day = dayIn(P + 1, cutoff - 6);
          both('INV', ref, day, a); stmtOnly('INV', ref, day + r.int(0, 5), a);
          disc = { ref, amount: a }; break;
        }
        case 'MISSING_CREDIT/m': {
          const ref = crnRef(v), c = amountOf(cur, 60, 2500);
          stmtOnly('CRN', ref, early(), -c);
          v.notes.credit.add(refKey(ref));
          explain('MISSING_CREDIT', { ref, amount: money(fmtMinor(cur, c)), date: longDay(dayIn(P + 1, cutoff - 1)) });
          disc = { ref, amount: -c }; break;
        }
        case 'UNEXPLAINED/a': case 'UNEXPLAINED/a-near': {
          const ref = invRef(v), a = amountOf(cur, 150, 8000);
          stmtOnly('INV', ref, it.v === 'a-near' ? dayIn(cutoff - 6, cutoff - 1) : early(), a);
          disc = { ref, amount: a }; break;
        }
        case 'UNEXPLAINED/c': { const ref = payRef(), a = amountOf(cur, 150, 8000); ledgerOnly('PMT', ref, early(), -a); disc = { ref, amount: a }; break; }
        case 'UNEXPLAINED/d': { const ref = crnRef(v), c = amountOf(cur, 60, 2500); stmtOnly('CRN', ref, early(), -c); disc = { ref, amount: -c }; break; }
        default: throw new Error(`r3 plan ${it.reason}/${it.v}`);
      }
      it.ref = disc.ref; it.amount = disc.amount;
    }
    // matched documents to fill the statement
    const fill = Math.max(4, T - v.stmt.length);
    const invs = [];
    for (let i = 0; i < fill; i++) {
      const u = r.next();
      if (u < 0.6 || invs.length === 0) { const ref = invRef(v), a = amountOf(cur, 150, 9000), day = dayIn(P + 1, S); both('INV', ref, day, a); invs.push({ a, day }); }
      else if (u < 0.9) { const src = r.pick(invs); both('PMT', payRef(), Math.min(S, src.day + r.int(5, 40)), -(r.chance(0.7) ? src.a : Math.max(1, Math.round(src.a * r.float(0.3, 0.9))))); }
      else { const src = r.pick(invs); both('CRN', crnRef(v), Math.min(S, src.day + r.int(2, 20)), -Math.max(1, Math.round(src.a * r.float(0.05, 0.3)))); }
    }
    // noise in the notes: names other documents without explaining a difference
    const matchedInv = v.stmt.filter(x => x.type === 'INV' && !v.plan.some(p => p.ref === x.ref));
    const matchedPay = v.stmt.filter(x => x.type === 'PMT' && !v.plan.some(p => p.ref === x.ref));
    for (let i = r.int(0, 2); i > 0; i--) v.memo.push(r.pick(NOISE.memo)({ ...vx, ref: r.pick(matchedInv)?.ref ?? 'the last delivery', pay: r.pick(matchedPay)?.ref ?? 'last month', city: r.pick(CITIES) }));
    if (r.chance(0.4)) v.ap.push(r.pick(NOISE.ap)({ ...vx, ref: r.pick(matchedInv)?.ref ?? 'the last bill' }));
    v.memo = r.shuffle(v.memo);
    v.stmt.sort((a, b) => (a.day - b.day) || (a.type === 'BF' ? -1 : b.type === 'BF' ? 1 : 0) || a.ref.localeCompare(b.ref));
    // alias use in our ledger
    v.ledger.forEach((x, i) => { x.name = v.aliasUse && i > 0 && r.chance(0.5) ? r.pick(v.aliases) : v.name; });
    if (v.aliasUse && !v.ledger.some(x => x.name !== v.name)) v.ledger[v.ledger.length - 1].name = v.aliases[0];
  }
  for (const v of clean) if (v.plan.length) return reject('clean-has-plan');

  // ---- the shared ledger: all suppliers, by date, with line ids
  const ledger = vendors.flatMap(v => v.ledger.map(x => ({ ...x, vendor: v.id })));
  ledger.sort((a, b) => (a.day - b.day) || a.vendor.localeCompare(b.vendor) || a.key.localeCompare(b.key));
  ledger.forEach((x, i) => { x.id = `L${String(i + 1).padStart(4, '0')}`; });
  const ledgerOf = new Map(vendors.map(v => [v.id, ledger.filter(x => x.vendor === v.id)]));
  const quotes = drawQuotes(r, vendors.map(v => v.currency));

  let world = { spec, attempt, L, S, cutoff, P, atlasOrder, vendors, ledger, ledgerOf, quotes };
  world = hooks.schemaDrift(world); // R8 f1 hook point (no-op in v1)
  world.render = renderAudit(world);
  if (verifier) {
    const bad = verifier(world);
    if (bad) return reject(`control-passes:${bad}`);
  }
  return world;
}

function fmtMinor(cur, minor) {
  const md = minorDigits(cur), div = 10 ** md;
  const units = Math.floor(minor / div), frac = minor % div;
  const u = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return md ? `${u}.${String(frac).padStart(md, '0')}` : u;
}
