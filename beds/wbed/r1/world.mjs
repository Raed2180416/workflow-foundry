// World model for W-bed R1 "ledger close" (W-BED §3.1). The customer layer is the `records` world at the same
// difficulty (imported unchanged: rows, void markers, per-task conventions, identity truth). This file adds the ledger
// layer: each billing system's invoice list (booked against customer row ids), one bank feed of payments, a close
// date, FX quotes, and the per-task conventions the ledger notes state. The oracle, the reference solver and every bad
// control derive from buildLedger(seed, split, difficulty).
import { buildCustomerWorld, toUsdCents, dayNum, fromDay, lastDayOfMonth, swappedDay, refKey, CURRENCIES } from '../lib/domain.mjs';
import { taskRng } from '../lib/prng.mjs';
import { hooks } from '../lib/faults.mjs';
import { BASE_STYLE, FLAG_WORDS, STATUS_WORDS, statusWord, statusLiveOf } from './vocab.mjs';
import { renderLedger } from './render.mjs';

export { BASE_STYLE, FLAG_WORDS, STATUS_WORDS, statusWord, statusLiveOf };

export const VERSION = '1.0.0';
export const MIN_D = 2, MAX_D = 5;

// Ledger knobs per difficulty. The customer layer adds its own (records LEVELS: 55/85/115/150 rows, 4/6/6/6 systems,
// per-task conventions from d3, an ATLAS vendor switch from d4).
//   inv: invoices per live customer row (uniform integer range); payP: share of live invoices with any payment;
//   partialP / splitP: paid in part / in two instalments; afterCloseP: invoices dated after the close date;
//   voidInvP: invoices with a void status; paidLag: invoices whose billing status says paid while the bank feed shows a
//   part payment (planted); remitDup: PAY lines repeated by a REMIT advice (planted); remitOnly: advices with no PAY;
//   unapplied: PAY lines naming no invoice; thirdParty: payments made by another customer (planted); voidRowInv:
//   invoices booked to twin void rows (planted); atlasConv: ATLAS invoice date order drawn per task (else day first);
//   refVariants: payments quote invoice numbers loosely; flags: per-task status words with per-task meaning;
//   tally: the TALLY subscription platform (a new system with its own date order); atlasSwitch: ATLAS changed its
//   invoice date order on a stated day.
export const LEVELS = {
  2: { inv: [0, 4], payP: 0.65, partialP: 0.25, splitP: 0.12, afterCloseP: 0.07, voidInvP: 0.05, paidLag: 1, remitDup: 2, remitOnly: 0,
    unapplied: 0, thirdParty: 1, voidRowInv: 1, atlasConv: false, refVariants: false, flags: 0, tally: false, atlasSwitch: false },
  3: { inv: [0, 4], payP: 0.65, partialP: 0.25, splitP: 0.15, afterCloseP: 0.08, voidInvP: 0.06, paidLag: 2, remitDup: 3, remitOnly: 1,
    unapplied: 1, thirdParty: 2, voidRowInv: 2, atlasConv: true, refVariants: true, flags: 0, tally: false, atlasSwitch: false },
  4: { inv: [0, 4], payP: 0.65, partialP: 0.28, splitP: 0.15, afterCloseP: 0.08, voidInvP: 0.06, paidLag: 2, remitDup: 3, remitOnly: 1,
    unapplied: 1, thirdParty: 2, voidRowInv: 2, atlasConv: true, refVariants: true, flags: 1, tally: true, atlasSwitch: true },
  5: { inv: [0, 5], payP: 0.65, partialP: 0.3, splitP: 0.18, afterCloseP: 0.09, voidInvP: 0.07, paidLag: 3, remitDup: 4, remitOnly: 2,
    unapplied: 2, thirdParty: 3, voidRowInv: 2, atlasConv: true, refVariants: true, flags: 2, tally: true, atlasSwitch: true },
};

const PREFIX = { BRIGHTDESK: 'BD', LEDGR: 'RE', ATLAS: 'AT', VENDEX: 'V', KOBO: 'K', VERITAS: 'VR', TALLY: 'T' };

export const isMonthFirst = style => style === 'MDY';

// ---------------------------------------------------------------------------------------------------------------------
const worldCache = new Map();
/** Memoised: buildLedger is a pure function of (seed, split, difficulty) and callers never mutate the world. */
export function buildLedger(seed, split = 'dev', difficulty = 3) {
  const key = JSON.stringify([seed, split, difficulty]);
  if (worldCache.has(key)) return worldCache.get(key);
  if (!LEVELS[difficulty]) throw new Error(`wbed-r1: difficulty must be ${MIN_D}..${MAX_D}, got ${difficulty}`);
  if (split !== 'dev' && split !== 'test') throw new Error(`wbed-r1: split must be 'dev' or 'test', got ${split}`);
  const rw = buildCustomerWorld(seed, split, difficulty);
  let world = null, lastReason = null;
  for (let attempt = 0; attempt < 60 && !world; attempt++) {
    const w = attemptLedger(rw, { seed, split, difficulty }, attempt);
    if (w.reject) { lastReason = w.reject; continue; }
    world = w;
  }
  if (world) world.render = renderLedger(world);
  if (!world) throw new Error(`wbed-r1: no valid ledger for seed ${seed} d${difficulty} (${lastReason})`);
  worldCache.set(key, world);
  if (worldCache.size > 24) worldCache.delete(worldCache.keys().next().value);
  return world;
}

// Decisiveness is checked by the caller-supplied verifier (set by index.mjs to avoid an import cycle): every bad
// control must fail the oracle on this world, else the ledger is re-drawn.
let verifier = null;
export function setVerifier(fn) { verifier = fn; }

function attemptLedger(rw, spec, attempt) {
  const { difficulty } = spec;
  const L = LEVELS[difficulty];
  const r = taskRng('r1', 'ledger', spec, attempt);
  const reject = reason => ({ reject: reason });

  // Close date: the last day of a month in 2025 (March-August). Invoices run over the preceding ~11 months.
  const closeMonth = r.int(3, 8);
  const close = lastDayOfMonth(2025, closeMonth);
  const periodStart = close - 330;
  const inPeriodDay = () => r.int(periodStart, close);
  const afterDay = () => r.int(close + 1, close + 50);

  // Per-task invoice date conventions.
  const atlasPost = L.atlasConv ? r.pick(['DMY', 'MDY']) : 'DMY';
  const atlasSwitch = L.atlasSwitch ? r.int(close - 200, close - 90) : null;
  const atlasPre = atlasSwitch === null ? atlasPost : (atlasPost === 'DMY' ? 'MDY' : 'DMY');
  const conv = { close, closeMonth, periodStart, atlasPost, atlasPre, atlasSwitch, tally: L.tally };
  const styleOf = (system, day) => {
    if (system === 'ATLAS') return atlasSwitch !== null && day < atlasSwitch ? atlasPre : atlasPost;
    if (system === 'VENDEX') return 'WORDS';
    return BASE_STYLE[system];
  };
  // With a switch, a printed ATLAS date must read one way only: its swapped reading may not fall on the other side.
  const atlasOk = day => {
    if (atlasSwitch === null) return true;
    const s = swappedDay(day);
    return s === null || (s < atlasSwitch) === (day < atlasSwitch);
  };
  const drawDay = (system, after) => {
    for (let t = 0; t < 40; t++) {
      const d = after ? afterDay() : inPeriodDay();
      if (system !== 'ATLAS' || atlasOk(d)) return d;
    }
    return null;
  };

  const liveRows = rw.rows; // records' live rows ({ rowId, system, entity, currency, ... })
  const voidRows = rw.voids;
  const entities = rw.entities;
  const systems = [...rw.ctx.systems, ...(L.tally ? ['TALLY'] : [])];

  // Flag words (d >= 4): one or two billing systems get a per-task status word whose meaning the notes state.
  const flags = [];
  const flagSystems = r.shuffle(systems.filter(s => s !== 'KOBO' || liveRows.some(x => x.system === 'KOBO'))).slice(0, L.flags);
  for (const system of flagSystems) {
    const polarity = flags.length === 1 ? (flags[0].polarity === 'void' ? 'live' : 'void') : r.pick(['void', 'live']);
    flags.push({ system, word: r.pick(FLAG_WORDS[system]), polarity });
  }

  // ---- invoices
  const usedNums = new Set(), usedKeys = new Set();
  const newNumber = system => {
    for (;;) {
      let no;
      const p = PREFIX[system];
      if (system === 'BRIGHTDESK') no = `${p}-${r.int(10000, 99999)}`;
      else if (system === 'LEDGR') no = `${p}-${r.int(24, 25)}-${String(r.int(1, 9999)).padStart(4, '0')}`;
      else if (system === 'ATLAS') no = `${p}/${r.int(1000, 9999)}`;
      else if (system === 'VENDEX') no = `${p}-${r.int(1000, 9999)}`;
      else if (system === 'KOBO') no = `${p}${r.int(10000, 99999)}`;
      else if (system === 'VERITAS') no = `${p}-${r.int(100000, 999999)}`;
      else no = `${p}-${r.int(10000, 99999)}`;
      const k = refKey(no);
      if (usedNums.has(no) || usedKeys.has(k)) continue;
      usedNums.add(no); usedKeys.add(k);
      return no;
    }
  };
  const amountMinor = currency => {
    const usd = Math.exp(r.float(Math.log(40), Math.log(9000)));
    const md = CURRENCIES[currency].minor, units = usd / CURRENCIES[currency].rate;
    if (r.chance(0.15)) return Math.max(1, Math.round(units)) * 10 ** md;
    return Math.max(1, Math.round(units * 10 ** md));
  };
  const invoices = [];
  const addInvoice = (system, row, day, extra = {}) => {
    const inv = { no: newNumber(system), system, row: row.rowId, rowRef: row, day, currency: row.currency, minor: amountMinor(row.currency),
      status: 'open', flag: null, payments: [], tag: null, ...extra };
    inv.style = styleOf(system, day);
    invoices.push(inv);
    return inv;
  };
  for (const row of liveRows) {
    const n = r.int(L.inv[0], L.inv[1]);
    for (let i = 0; i < n; i++) {
      const after = r.chance(L.afterCloseP);
      const day = drawDay(row.system, after);
      if (day === null) return reject('atlas-day');
      const inv = addInvoice(row.system, row, day);
      if (r.chance(L.voidInvP)) inv.status = 'void';
    }
    if (L.tally && r.chance(0.15)) {
      const after = r.chance(L.afterCloseP);
      addInvoice('TALLY', row, after ? afterDay() : inPeriodDay());
    }
  }
  // Invoices booked to void customer rows: a few on solo voids at random, and planted ones on twin voids (a twin void
  // links to a real customer by the identity rules, so attaching its invoices there is the plausible mistake).
  for (const v of voidRows) if (v.twinOf === undefined && r.chance(0.5)) {
    const day = drawDay(v.system, false); if (day === null) return reject('atlas-day');
    addInvoice(v.system, v, day, { tag: 'void-row' });
  }
  const twinVoids = r.shuffle(voidRows.filter(v => v.twinOf !== undefined));
  if (twinVoids.length < 1) return reject('no-twin-void');
  for (let i = 0; i < Math.min(L.voidRowInv, twinVoids.length); i++) {
    const day = drawDay(twinVoids[i].system, false); if (day === null) return reject('atlas-day');
    addInvoice(twinVoids[i].system, twinVoids[i], day, { tag: 'void-row' });
  }

  // Date traps for systems whose numeric order matters: an in-period invoice whose swapped reading falls after the close
  // date, and an after-close invoice whose swapped reading falls inside the period.
  const trapSystems = ['ATLAS', ...(L.tally ? ['TALLY'] : [])];
  for (const system of trapSystems) {
    const pool = system === 'TALLY' ? liveRows : liveRows.filter(x => x.system === system);
    if (!pool.length) return reject(`no-${system}-rows`);
    const inDays = [], outDays = [];
    for (let dd = closeMonth + 1; dd <= 12; dd++) inDays.push(dayNum(2025, closeMonth, dd));
    for (let dd = 1; dd <= closeMonth; dd++) outDays.push(dayNum(2025, closeMonth + 1, dd));
    const ok = d => system !== 'ATLAS' || atlasOk(d);
    const din = r.shuffle(inDays.filter(ok))[0], dout = r.shuffle(outDays.filter(d => ok(d) && swappedDay(d) !== null && swappedDay(d) >= periodStart))[0];
    if (din === undefined || dout === undefined) return reject(`trap-${system}`);
    addInvoice(system, r.pick(pool), din, { tag: 'trap-in' });
    addInvoice(system, r.pick(pool), dout, { tag: 'trap-out' });
  }

  // Flag words on in-period invoices of live rows (at least two each).
  const isLiveRow = new Set(liveRows.map(x => x.rowId));
  for (const f of flags) {
    const cands = r.shuffle(invoices.filter(i => i.system === f.system && i.status === 'open' && !i.tag && isLiveRow.has(i.row) && i.day <= close));
    if (cands.length < 2) return reject(`flag-${f.system}`);
    const k = Math.min(cands.length, r.int(2, 4));
    for (const inv of cands.slice(0, k)) { inv.flag = f.word; inv.flagPolarity = f.polarity; }
  }

  // ---- payments
  const usedRefs = new Set();
  const newRef = () => { for (;;) { const ref = `BNK-${r.int(10000, 99999)}`; if (!usedRefs.has(ref)) { usedRefs.add(ref); return ref; } } };
  const statusLive = inv => inv.status !== 'void' && !(inv.flag && inv.flagPolarity === 'void');
  const payable = inv => statusLive(inv) && isLiveRow.has(inv.row) && inv.tag !== 'void-row';
  for (const inv of invoices) {
    if (!payable(inv) || inv.tag === 'trap-in' || inv.tag === 'trap-out' || !r.chance(L.payP)) continue;
    const total = r.chance(L.partialP) ? Math.max(1, Math.round(inv.minor * r.float(0.2, 0.8))) : inv.minor;
    const parts = r.chance(L.splitP) && total >= 2 ? (() => { const a = Math.max(1, Math.round(total * r.float(0.3, 0.7))); return [a, total - a].filter(x => x > 0); })() : [total];
    let day = inv.day;
    for (const amt of parts) {
      day += r.int(3, 60);
      inv.payments.push({ kind: 'PAY', ref: newRef(), day, minor: amt, payer: inv.rowRef.entity });
    }
  }
  // Billing status: an invoice fully paid on or before the close date usually shows the system's "paid" word.
  for (const inv of invoices) {
    if (inv.status !== 'open' || inv.flag) continue;
    const paidIn = inv.payments.filter(p => p.day <= close).reduce((s, p) => s + p.minor, 0);
    if (paidIn === inv.minor && r.chance(0.85)) inv.status = 'paid';
  }
  // Planted: "paid" status with only a part payment in the bank feed.
  const lagCands = r.shuffle(invoices.filter(i => i.status === 'open' && !i.flag && !i.tag && isLiveRow.has(i.row) && i.day <= close - 20 && i.minor >= 4));
  if (lagCands.length < L.paidLag) return reject('paid-lag');
  for (const inv of lagCands.slice(0, L.paidLag)) {
    inv.status = 'paid'; inv.tag = 'paid-lag';
    inv.payments = [{ kind: 'PAY', ref: newRef(), day: inv.day + r.int(2, 15), minor: Math.max(1, Math.round(inv.minor * r.float(0.3, 0.7))), payer: inv.rowRef.entity }];
  }
  const countedPays = () => invoices.filter(i => payable(i) && i.day <= close).flatMap(i => i.payments.filter(p => p.kind === 'PAY' && p.day <= close).map(p => ({ inv: i, p })));
  // Planted: third-party payers (another real customer pays the invoice).
  const realEntities = entities.filter(e => e.role !== 'void');
  const tp = r.shuffle(countedPays()).slice(0, L.thirdParty);
  if (tp.length < L.thirdParty) return reject('third-party');
  const clusterOfEntity = new Map(); // entity idx -> customer id
  for (const rec of rw.truth.records) for (const rowId of rec.source_rows) {
    const row = liveRows.find(x => x.rowId === rowId); clusterOfEntity.set(row.entity, rec.entity_id);
  }
  for (const { inv, p } of tp) {
    const others = realEntities.filter(e => clusterOfEntity.get(e.idx) !== clusterOfEntity.get(inv.rowRef.entity));
    p.payer = r.pick(others).idx; p.thirdParty = true;
  }
  // Planted: remittance advices repeating a counted PAY line (same ref), announced a few days before the money arrived.
  const dup = r.shuffle(countedPays()).slice(0, L.remitDup);
  if (dup.length < L.remitDup) return reject('remit-dup');
  for (const { inv, p } of dup) inv.payments.push({ kind: 'REMIT', ref: p.ref, day: p.day - r.int(1, 4), minor: p.minor, payer: p.payer });
  // Advices with no PAY line (announced, not received), on in-period open invoices.
  const ro = r.shuffle(invoices.filter(i => payable(i) && i.day <= close - 10 && i.payments.length === 0)).slice(0, L.remitOnly);
  for (const inv of ro) inv.payments.push({ kind: 'REMIT', ref: newRef(), day: Math.min(close, inv.day + r.int(3, 9)), minor: inv.minor, payer: inv.rowRef.entity, remitOnly: true });

  const payments = [];
  for (const inv of invoices) for (const p of inv.payments) payments.push({ ...p, invNo: inv.no, currency: inv.currency });
  // Unapplied cash: PAY lines that name no invoice of any list.
  for (let i = 0; i < L.unapplied; i++) {
    const sys = r.pick(rw.ctx.systems), row = r.pick(liveRows);
    const ghost = newNumber(sys);
    payments.push({ kind: 'PAY', ref: newRef(), day: r.int(periodStart + 30, close), minor: amountMinor(row.currency), currency: row.currency,
      payer: row.entity, invNo: ghost, unapplied: true });
  }
  // Bank feed order: by date, then reference; REMIT before PAY on the same day.
  payments.sort((a, b) => (a.day - b.day) || a.ref.localeCompare(b.ref) || a.kind.localeCompare(b.kind));
  invoices.sort((a, b) => a.system.localeCompare(b.system) || (a.day - b.day) || a.no.localeCompare(b.no));

  let world = {
    spec, attempt, L, rw, conv, flags, systems, invoices, payments, fx: rw.fx,
    entityCluster: clusterOfEntity,
    customers: rw.truth.records.map(x => ({ customer_id: x.entity_id, source_rows: [...x.source_rows] })),
  };
  world = hooks.schemaDrift(world); // R8 f1 hook point (no-op in v1)
  if (verifier) {
    const bad = verifier(world);
    if (bad) return reject(`control-passes:${bad}`);
  }
  return world;
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers shared by the pipeline, the renderer and the tests.
export const usdOf = (world, currency, minor) => toUsdCents(minor, currency, world.fx.cur[currency]);
export const entityName = (world, idx) => { const e = world.rw.entities[idx]; return `${e.given} ${e.family}`; };
export const dmy = day => fromDay(day);
