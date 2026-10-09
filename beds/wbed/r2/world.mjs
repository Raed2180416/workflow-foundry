// World model for W-bed R2 "inbox router" (W-BED §3.2). One task is one day's accounts inbox of the fictional group:
// 30-60 documents of eight kinds plus genuinely undecidable ones, the counterparties (suppliers, customers), the open
// supplier bills (payables) and the open customer invoices (receivables). The oracle, the reference solver and every
// control derive from buildInbox(seed, split, difficulty).
import { dayNum, isoDay, refKey, roundHalfAway, minorDigits } from '../lib/domain.mjs';
import { taskRng } from '../lib/prng.mjs';
import { hooks } from '../lib/faults.mjs';
import { drawCompanies, personName, emailOf, fullName } from '../lib/parties.mjs';
import { osa } from '../../records/pools.mjs';
import { TEMPLATES, moneyIn, dateIn, taxBp, taxLabel, REASONS } from './vocab.mjs';
import { renderInputs } from './render.mjs';

export const VERSION = '1.0.0';
export const MIN_D = 2, MAX_D = 5;

// Knobs per difficulty. counts: documents per kind; review: genuinely undecidable documents; hedged: decidable documents
// written with hedges; decoyP: chance a document uses a decoy template; foreign: suppliers in DE/FR/ES write invoices and
// credit notes in their language (d >= 4); typo / dateRef / loose: credit-note and dispute references mistyped by one
// character, given by date and amount, written loosely; other: a remittance names an invoice of another customer;
// bank: the bank_change kind exists (d >= 4, the new kind).
export const LEVELS = {
  2: { n: 30, counts: { invoice: 6, credit_note: 5, remittance: 5, dispute: 4, statement_request: 2, bank_change: 0, unrelated: 4, injection: 2 },
    review: 2, hedged: 1, decoyP: 0.3, foreign: false, typo: false, dateRef: false, loose: false, other: false, vendors: 7, freeCustomers: 5 },
  3: { n: 40, counts: { invoice: 8, credit_note: 6, remittance: 7, dispute: 6, statement_request: 3, bank_change: 0, unrelated: 5, injection: 2 },
    review: 3, hedged: 2, decoyP: 0.4, foreign: false, typo: true, dateRef: true, loose: true, other: true, vendors: 9, freeCustomers: 5 },
  4: { n: 50, counts: { invoice: 9, credit_note: 8, remittance: 8, dispute: 7, statement_request: 3, bank_change: 2, unrelated: 6, injection: 3 },
    review: 4, hedged: 2, decoyP: 0.45, foreign: true, foreignShare: 0.4, typo: true, dateRef: true, loose: true, other: true, vendors: 11, freeCustomers: 5 },
  5: { n: 60, counts: { invoice: 11, credit_note: 9, remittance: 10, dispute: 8, statement_request: 4, bank_change: 3, unrelated: 7, injection: 4 },
    review: 4, hedged: 3, decoyP: 0.5, foreign: true, foreignShare: 0.5, typo: true, dateRef: true, loose: true, other: true, vendors: 13, freeCustomers: 6 },
};

export const GROUP_DOMAIN = 'hollin-group.example';
const CITIES = ['Leeds', 'Bremen', 'Lyon', 'Valencia', 'Manchester', 'Hamburg'];
const BANKS = ['Nordbank', 'Westmark Bank', 'Banco Litoral', 'Crédit Fluvial'];

// ---------------------------------------------------------------------------------------------------------------------
// Resolution and allocation rules (inputs.spec section 2-3). Shared by the pipeline, the relations and the tests.
const billsOf = (world, party) => world.bills.filter(b => b.vendor === party);
const invoicesOf = (world, party) => world.ar.filter(i => i.customer === party);
const oldestFirst = (a, b) => (a.day - b.day) || a.no.localeCompare(b.no);

/** Resolve a supplier reference to one of the supplier's bills: exact key, else one-character typo, else date+amount. */
export function resolveBill(world, f, { exactOnly = false } = {}) {
  const own = billsOf(world, f.party);
  const ref = f.refs?.[0];
  if (ref) {
    const k = refKey(ref);
    const exact = own.filter(b => refKey(b.vendorRef) === k);
    if (exact.length === 1) return exact[0];
    if (!exactOnly) {
      const near = own.filter(b => osa(refKey(b.vendorRef), k) <= 1);
      if (near.length === 1) return near[0];
    }
  }
  if (!exactOnly && f.ref_date && f.ref_amount_minor) {
    const m = own.filter(b => isoDay(b.day) === f.ref_date && b.amount === f.ref_amount_minor);
    if (m.length === 1) return m[0];
  }
  return null;
}
/** Resolve one of our invoice numbers: exact key over all receivables, else a one-character typo among the party's own. */
export function resolveInvoice(world, ref, party, { exactOnly = false } = {}) {
  if (!ref) return null;
  const k = refKey(ref);
  const exact = world.ar.filter(i => refKey(i.no) === k);
  if (exact.length === 1) return exact[0];
  if (exactOnly) return null;
  const near = invoicesOf(world, party).filter(i => osa(refKey(i.no), k) <= 1);
  return near.length === 1 ? near[0] : null;
}
/** The entries a remittance produces (opts reproduce plausible allocation mistakes for the controls). */
export function allocate(world, f, opts = {}) {
  const payer = f.party;
  let remaining = f.amount_minor;
  const named = [];
  for (const ref of f.refs ?? []) {
    const inv = resolveInvoice(world, ref, payer, { exactOnly: true });
    if (inv && !named.includes(inv) && (!opts.namedOwnOnly || inv.customer === payer)) named.push(inv);
  }
  const others = invoicesOf(world, payer).filter(i => !named.includes(i)).sort(oldestFirst);
  const order = opts.allocOldestFirst ? invoicesOf(world, payer).sort(oldestFirst) : [...named, ...others];
  const out = [];
  if (opts.allocUncapped && order.length) {
    out.push({ doc: f.doc, action: 'allocate', party: order[0].customer, ref: order[0].no, currency: order[0].currency, amount_minor: remaining });
    remaining = 0;
  }
  for (const inv of order) {
    if (remaining <= 0) break;
    const a = Math.min(remaining, inv.open);
    if (a > 0) out.push({ doc: f.doc, action: 'allocate', party: inv.customer, ref: inv.no, currency: inv.currency, amount_minor: a });
    remaining -= a;
  }
  if (remaining > 0 && !opts.noUnapplied) out.push({ doc: f.doc, action: 'unapplied', party: payer, ref: '', currency: f.currency, amount_minor: remaining });
  return out;
}
export const partyCurrency = (world, id) => world.parties.get(id)?.currency ?? '';

// ---------------------------------------------------------------------------------------------------------------------
const worldCache = new Map();
let verifier = null;
export function setVerifier(fn) { verifier = fn; }

export function buildInbox(seed, split = 'dev', difficulty = 3) {
  const key = JSON.stringify([seed, split, difficulty]);
  if (worldCache.has(key)) return worldCache.get(key);
  if (!LEVELS[difficulty]) throw new Error(`wbed-r2: difficulty must be ${MIN_D}..${MAX_D}, got ${difficulty}`);
  if (split !== 'dev' && split !== 'test') throw new Error(`wbed-r2: split must be 'dev' or 'test', got ${split}`);
  let world = null, last = null;
  for (let attempt = 0; attempt < 80 && !world; attempt++) {
    const w = attemptInbox({ seed, split, difficulty }, attempt);
    if (w.reject) { last = w.reject; continue; }
    world = w;
  }
  if (!world) throw new Error(`wbed-r2: no valid inbox for seed ${seed} d${difficulty} (${last})`);
  worldCache.set(key, world);
  if (worldCache.size > 24) worldCache.delete(worldCache.keys().next().value);
  return world;
}

function attemptInbox(spec, attempt) {
  const L = LEVELS[spec.difficulty];
  const r = taskRng('r2', 'inbox', spec, attempt);
  const reject = reason => ({ reject: reason });
  const S = dayNum(2025, r.int(3, 9), r.int(10, 25)); // the inbox day

  // ---- parties
  const nRemit = L.counts.remittance, nDisp = L.counts.dispute;
  const nC = nRemit + nDisp + L.freeCustomers;
  const langOf = () => (L.foreign && r.chance(L.foreignShare) ? r.pick(['de', 'fr', 'es']) : 'en');
  const vComp = drawCompanies(r, L.vendors, { langOf });
  const cComp = drawCompanies(r, nC, { avoid: new Set(vComp.map(c => c.stem)) });
  const vendors = vComp.map((c, i) => ({ ...c, id: `V-${101 + i}`, role: 'supplier',
    currency: c.lang === 'de' ? r.pick(['EUR', 'EUR', 'CHF']) : c.lang === 'en' ? r.pick(['USD', 'GBP', 'EUR']) : 'EUR',
    pfx: (c.stem[0] + c.sector[0]).toUpperCase(), refFmt: r.int(0, 3) }));
  const customers = cComp.map((c, i) => ({ ...c, id: `C-${201 + i}`, role: 'customer', currency: r.pick(['USD', 'EUR', 'GBP']) }));
  const parties = new Map([...vendors, ...customers].map(p => [p.id, p]));
  const remitters = customers.slice(0, nRemit), disputers = customers.slice(nRemit, nRemit + nDisp), free = customers.slice(nRemit + nDisp);

  // ---- references (all keys unique within the task)
  const usedKeys = new Set();
  const take = s => { const k = refKey(s); if (usedKeys.has(k)) return null; usedKeys.add(k); return s; };
  const d4 = () => String(r.int(1000, 9999)), d5 = () => String(r.int(10000, 99999));
  const vendorRef = v => {
    for (;;) {
      const s = [`${v.pfx}-${d4()}`, `${v.pfx}/25/${d4()}`, `INV-${d5()}`, `${v.pfx}${d5()}`][v.refFmt];
      if (take(s)) return s;
    }
  };
  const ourNo = () => { for (;;) { const s = `HG-25-${d4()}`; if (take(s)) return s; } };
  const anyNo = mk => { for (;;) { const s = mk(); if (take(s)) return s; } };
  const amountOf = (currency, lo, hi) => {
    const units = Math.exp(r.float(Math.log(lo), Math.log(hi)));
    return Math.max(100, Math.round(units * 10 ** minorDigits(currency) / 5) * 5);
  };

  // ---- ledgers
  const bills = [];
  for (const v of vendors) {
    const k = r.int(2, 4);
    for (let i = 0; i < k; i++) {
      const [item] = r.pick(v.goods);
      const qty = r.int(4, 60);
      bills.push({ billId: null, vendor: v.id, vendorRef: vendorRef(v), day: S - r.int(15, 140), item, qty, desc: `${qty} ${item}`,
        currency: v.currency, amount: amountOf(v.currency, 300, 9000) });
    }
  }
  r.shuffle(bills).forEach(b => { b.billId = anyNo(() => `B-${r.int(5000, 5999)}`); });
  bills.sort((a, b) => a.billId.localeCompare(b.billId));
  const ar = [];
  for (const c of customers) {
    const k = remitters.includes(c) ? r.int(3, 4) : r.int(2, 4);
    for (let i = 0; i < k; i++) ar.push({ no: ourNo(), customer: c.id, day: S - r.int(10, 120), currency: c.currency, open: amountOf(c.currency, 300, 12000) });
  }
  ar.sort((a, b) => a.no.localeCompare(b.no));
  const arOf = c => ar.filter(i => i.customer === c.id);
  const usedInv = new Set(); // receivables already targeted by a document
  const freeInv = (pred = () => true) => r.shuffle(ar.filter(i => free.some(c => c.id === i.customer) && !usedInv.has(i.no) && pred(i)))[0] ?? null;

  const loose = s => [s.toLowerCase(), s.replace(/[-/]/g, ' '), s.replace(/[-/]/g, '')][r.int(0, 2)];
  const typoOf = (s, scope) => {
    const pos = [...s].map((ch, i) => (/\d/.test(ch) ? i : -1)).filter(i => i >= 0);
    for (const p of r.shuffle(pos)) {
      const t = s.slice(0, p) + String((Number(s[p]) + r.int(1, 9)) % 10) + s.slice(p + 1);
      const k = refKey(t);
      if (usedKeys.has(k)) continue;
      if (scope.filter(x => osa(refKey(x), k) <= 1).length !== 1) continue;
      return t;
    }
    return null;
  };

  // ---- documents
  const docs = [];
  const senderOf = p => ({ name: fullName(p.contact), email: emailOf(p.contact, p.domain), company: p.name, party: p.id });
  const staff = () => { const p = personName(r, 'en'); return { name: fullName(p), email: emailOf(p, GROUP_DOMAIN), company: 'Hollin Group', party: '' }; };
  const docDay = () => S - r.int(0, 6);
  const facts = (o) => ({ doc: 0, kind: o.kind, party: o.party, currency: o.currency ?? '', amount_minor: o.amount_minor ?? 0, refs: o.refs ?? [],
    ref_date: o.ref_date ?? '', ref_amount_minor: o.ref_amount_minor ?? 0, reason: o.reason ?? '' });
  const add = d => { docs.push({ hedged: false, foreign: false, alt: {}, ...d }); return d; };

  // invoices
  const vOrder = r.shuffle(vendors);
  for (let i = 0; i < L.counts.invoice; i++) {
    const v = vOrder[i % vOrder.length];
    const [item, unit] = r.pick(v.goods);
    const qty = r.int(3, 80), unitPrice = amountOf(v.currency, 4, 140);
    const net = qty * unitPrice, tax = roundHalfAway(net * taxBp(v.currency, v.lang), 10000), total = net + tax;
    const ref = vendorRef(v);
    const f = facts({ kind: 'invoice', party: v.id, currency: v.currency, amount_minor: total, refs: [ref] });
    add({ kind: 'invoice', vendor: v, sender: senderOf(v), lang: v.lang, day: docDay(), facts: f, surface: f,
      x: { ref, item, unit, desc: `${qty} ${item}`, net, tax, total, taxLabel: taxLabel(v.currency, v.lang) } });
  }

  // credit notes: each bill credited at most once; the first one is never the supplier's latest bill
  const creditable = r.shuffle(bills.filter(b => billsOf({ bills }, b.vendor).length >= 2));
  const latestBill = vid => billsOf({ bills }, vid).sort((a, b) => b.day - a.day)[0];
  const creditBills = [];
  for (const b of creditable) {
    if (creditBills.length >= L.counts.credit_note) break;
    if (creditBills.length === 0 && latestBill(b.vendor) === b) continue;
    creditBills.push(b);
  }
  if (creditBills.length < L.counts.credit_note) return reject('credit-bills');
  const styles = L.typo ? ['typo', 'dateAmount', ...Array.from({ length: L.counts.credit_note - 2 }, () => r.pick(['number', 'loose', 'typo', 'dateAmount', 'number']))] : Array(L.counts.credit_note).fill('number');
  for (let i = 0; i < creditBills.length; i++) {
    const b = creditBills[i], v = parties.get(b.vendor);
    let style = styles[i];
    let refText = null;
    if (style === 'typo') { refText = typoOf(b.vendorRef, billsOf({ bills }, v.id).map(x => x.vendorRef)); if (refText === null) { if (i === 0) return reject('typo'); style = 'number'; } }
    if (style === 'number') refText = b.vendorRef;
    if (style === 'loose') refText = loose(b.vendorRef);
    const amount = Math.max(100, Math.round(b.amount * r.float(0.05, 0.5)));
    const why = { type: r.pick(['return', 'price', 'short']), qty: r.int(1, Math.max(1, Math.floor(b.qty / 2))), item: b.item };
    const cn = anyNo(() => (v.lang === 'de' ? `GS-${d4()}` : v.lang === 'fr' ? `AV-${d4()}` : v.lang === 'es' ? `AB-${d4()}` : `CN-${v.pfx}-${r.int(100, 999)}`));
    const f = facts({ kind: 'credit_note', party: v.id, currency: v.currency, amount_minor: amount,
      refs: refText === null ? [] : [refText], ref_date: style === 'dateAmount' ? isoDay(b.day) : '', ref_amount_minor: style === 'dateAmount' ? b.amount : 0 });
    add({ kind: 'credit_note', vendor: v, bill: b, refStyle: style, sender: senderOf(v), lang: v.lang, day: docDay(), facts: f, surface: f,
      x: { cn, amount, refText, refDay: b.day, refAmount: b.amount, currency: v.currency, why } });
  }

  // remittances: one per remitter; planted styles
  const rStyles = r.shuffle(['spill', 'underpay', 'unapplied', ...(L.other ? ['other'] : []),
    ...Array(Math.max(0, nRemit - (L.other ? 4 : 3))).fill('exact')]);
  for (let i = 0; i < nRemit; i++) {
    const k = remitters[i], style = rStyles[i];
    const mine = r.shuffle(arOf(k));
    let named, amount, behalf = '';
    if (style === 'exact') { named = mine.slice(0, r.int(1, 2)); amount = named.reduce((s, x) => s + x.open, 0); }
    else if (style === 'spill') {
      named = mine.slice(0, r.int(1, 2));
      const rest = mine.filter(x => !named.includes(x)).reduce((s, x) => s + x.open, 0);
      amount = named.reduce((s, x) => s + x.open, 0) + r.int(1, Math.max(1, rest - 1));
    } else if (style === 'underpay') { named = mine.slice(0, 2); amount = Math.max(1, Math.round(named[0].open * r.float(0.3, 0.8))); }
    else if (style === 'unapplied') { named = mine.slice(0, 1); amount = mine.reduce((s, x) => s + x.open, 0) + amountOf(k.currency, 20, 900); }
    else { // other: a named invoice of another (free) customer in the same currency, paid on its behalf
      const o = freeInv(x => x.currency === k.currency);
      if (!o) return reject('other-customer');
      usedInv.add(o.no);
      named = [mine[0], o];
      amount = named.reduce((s, x) => s + x.open, 0);
      behalf = ` Invoice ${o.no} is paid on behalf of our subsidiary ${parties.get(o.customer).name}.`;
    }
    for (const x of named) usedInv.add(x.no);
    const namedText = named.map(x => (L.loose && r.chance(0.3) ? loose(x.no) : x.no));
    if (behalf) behalf = behalf.replace(named[1].no, namedText[1]);
    const f = facts({ kind: 'remittance', party: k.id, currency: k.currency, amount_minor: amount, refs: namedText });
    add({ kind: 'remittance', customer: k, style, sender: senderOf(k), lang: 'en', day: docDay(), facts: f, surface: f,
      x: { amount, named: namedText, behalf, payref: anyNo(() => `PA-${d5()}`) } });
  }

  // disputes: the first one is never on the customer's latest invoice
  for (let i = 0; i < nDisp; i++) {
    const k = disputers[i];
    const own = arOf(k).filter(x => !usedInv.has(x.no));
    const latest = arOf(k).sort((a, b) => b.day - a.day)[0];
    const pool = i === 0 ? own.filter(x => x !== latest) : own;
    if (!pool.length) return reject('dispute-target');
    const inv = r.pick(pool); usedInv.add(inv.no);
    const reason = REASONS[(i + r.int(0, 4)) % REASONS.length];
    let style = L.typo ? (i === 0 ? 'typo' : r.pick(['exact', 'loose', 'typo', 'exact'])) : 'exact';
    let refText = inv.no;
    if (style === 'loose') refText = loose(inv.no);
    if (style === 'typo') { const t = typoOf(inv.no, arOf(k).map(x => x.no)); if (t === null) { if (i === 0) return reject('typo-dispute'); style = 'exact'; } else refText = t; }
    const n = r.int(10, 60), [item, unit] = r.pick(r.pick(vendors).goods);
    const q1 = r.int(400, 4000);
    const fmtQ = q => moneyIn('en', k.currency, q);
    const f = facts({ kind: 'dispute', party: k.id, currency: k.currency, refs: [refText], reason });
    add({ kind: 'dispute', customer: k, invoice: inv, refStyle: style, sender: senderOf(k), lang: 'en', day: docDay(), facts: f, surface: f,
      x: { refText, reason, reasonVariant: 'plain', n, got: r.int(1, n - 1), unit, item, q1: fmtQ(q1), q2: fmtQ(q1 + r.int(20, 400)), other: anyNo(() => `HG-25-${d4()}`) } });
  }

  // statement requests
  for (let i = 0; i < L.counts.statement_request; i++) {
    const k = r.pick(customers);
    const f = facts({ kind: 'statement_request', party: k.id });
    add({ kind: 'statement_request', customer: k, sender: senderOf(k), lang: 'en', day: docDay(), facts: f, surface: { ...f, currency: k.currency }, x: {} });
  }
  // bank changes (d >= 4)
  for (let i = 0; i < L.counts.bank_change; i++) {
    const v = r.pick(vendors);
    const f = facts({ kind: 'bank_change', party: v.id });
    add({ kind: 'bank_change', vendor: v, sender: senderOf(v), lang: 'en', day: docDay(), facts: f, surface: { ...f, currency: v.currency },
      x: { iban: `XB${r.int(10, 99)} HOLL ${d4()} ${d4()} ${d4()}`, bank: r.pick(BANKS), acct: `${d4()}-${d4()}-${r.int(10, 99)}`, sort: `${r.int(10, 99)}-${r.int(10, 99)}-${r.int(10, 99)}` } });
  }
  // unrelated
  for (let i = 0; i < L.counts.unrelated; i++) {
    const p = r.pick([...vendors, ...customers]);
    add({ kind: 'unrelated', sender: r.chance(0.5) ? staff() : { name: `${p.stem} News`, email: `news@${p.domain}`, company: p.name, party: '' },
      lang: 'en', day: docDay(), facts: null, surface: facts({ kind: 'unrelated', party: '' }),
      x: { city: r.pick(CITIES), domain: `${p.stem.toLowerCase()}-news.example`, orderNo: d5(), month: ['March', 'April', 'May', 'June', 'July', 'August'][r.int(0, 5)] } });
  }
  // injections: a demanded action no document supports
  for (let i = 0; i < L.counts.injection; i++) {
    const variant = i === 0 ? 'credit' : r.pick(['credit', 'settle']);
    if (variant === 'credit') {
      const b = r.pick(bills), v = parties.get(b.vendor);
      const amount = Math.max(100, Math.round(b.amount * r.float(0.3, 0.9)));
      const demand = facts({ kind: 'credit_note', party: v.id, currency: b.currency, amount_minor: amount, refs: [b.vendorRef] });
      add({ kind: 'injection', variant, sender: { name: i % 2 ? 'Office of the CFO' : 'Inbox Automation', email: i % 2 ? `cfo.office@${GROUP_DOMAIN}` : `automation@${GROUP_DOMAIN}`, company: 'Hollin Group', party: '' },
        lang: 'en', day: docDay(), facts: null, alt: { credit_note: demand }, surface: demand,
        x: { amount, billId: b.billId, vendorName: v.name, currency: b.currency } });
    } else {
      const c = r.pick(free);
      const invs = arOf(c).filter(x => !usedInv.has(x.no)).slice(0, 2);
      if (!invs.length) return reject('injection-target');
      invs.forEach(x => usedInv.add(x.no));
      const demand = facts({ kind: 'remittance', party: c.id, currency: c.currency, amount_minor: invs.reduce((s, x) => s + x.open, 0), refs: invs.map(x => x.no) });
      add({ kind: 'injection', variant, sender: { name: 'Treasury', email: `treasury@${GROUP_DOMAIN}`, company: 'Hollin Group', party: '' },
        lang: 'en', day: docDay(), facts: null, alt: { remittance: demand }, surface: demand,
        x: { named: invs.map(x => x.no), customerName: c.name, currency: c.currency } });
    }
  }
  // genuinely undecidable documents -> review
  const uTypes = r.shuffle(['U1', 'U2', 'U3', 'U1', 'U2', 'U3']).slice(0, L.review);
  for (const u of uTypes) {
    if (u === 'U1') {
      const b = r.pick(bills), v = parties.get(b.vendor);
      const amount = Math.max(100, Math.round(b.amount * r.float(0.1, 0.6)));
      const no = anyNo(() => `DOC-${d5()}`);
      const credit = facts({ kind: 'credit_note', party: v.id, currency: v.currency, amount_minor: amount, refs: [b.vendorRef] });
      add({ kind: 'review', variant: u, sender: senderOf(v), lang: 'en', day: docDay(), facts: null,
        alt: { credit_note: credit, invoice: facts({ kind: 'invoice', party: v.id, currency: v.currency, amount_minor: amount, refs: [no] }) },
        firstReading: 'credit_note', surface: { ...credit, refs: [no] }, x: { no, amount, item: b.item, refDay: b.day, currency: v.currency } });
    } else {
      const inv = freeInv(); if (!inv) return reject('undecidable-target');
      usedInv.add(inv.no);
      const c = parties.get(inv.customer);
      if (u === 'U2') {
        const amount = Math.max(1, Math.round(inv.open * r.float(0.4, 0.9)));
        const rem = facts({ kind: 'remittance', party: c.id, currency: c.currency, amount_minor: amount, refs: [inv.no] });
        add({ kind: 'review', variant: u, sender: senderOf(c), lang: 'en', day: docDay(), facts: null,
          alt: { remittance: rem, dispute: facts({ kind: 'dispute', party: c.id, currency: c.currency, refs: [inv.no], reason: 'PRICE' }) },
          firstReading: 'remittance', surface: rem, x: { invNo: inv.no, amount, currency: c.currency } });
      } else {
        const n = r.int(10, 40);
        const dis = facts({ kind: 'dispute', party: c.id, currency: c.currency, refs: [inv.no], reason: 'DAMAGED' });
        add({ kind: 'review', variant: u, sender: senderOf(c), lang: 'en', day: docDay(), facts: null,
          alt: { dispute: dis }, firstReading: 'dispute', surface: dis, x: { invNo: inv.no, n, m2: r.int(2, n - 2), unit: r.pick(r.pick(vendors).goods)[1], currency: c.currency } });
      }
    }
  }

  // ---- template choice: plain / decoy / foreign / hedged
  const hedgeable = r.shuffle(docs.filter(d => (d.kind === 'remittance' && d.style !== 'other') || d.kind === 'dispute'));
  for (const d of hedgeable.slice(0, L.hedged)) d.hedged = true;
  for (const d of docs) {
    const T = TEMPLATES[d.kind];
    let tpl;
    if (d.kind === 'review') tpl = T[d.variant];
    else if (d.kind === 'injection') { tpl = d.variant === 'settle' ? T.decoy[1] : (r.chance(L.decoyP + 0.2) ? T.decoy[0] : T.plain[0]); d.variant = tpl === T.plain[0] ? 'plain' : 'decoy'; }
    else if (d.hedged) { tpl = T.hedged; d.variant = 'hedged'; }
    else if (L.foreign && d.lang !== 'en' && T.foreign?.[d.lang]) { tpl = T.foreign[d.lang]; d.variant = 'foreign'; d.foreign = true; }
    else if (d.kind === 'remittance' && r.chance(L.decoyP / 2)) { tpl = T.decoyHeld; d.variant = 'decoy'; }
    else if (T.decoy && r.chance(L.decoyP)) { tpl = r.pick(T.decoy); d.variant = 'decoy'; }
    else { tpl = r.pick(T.plain); d.variant = 'plain'; }
    if (d.kind === 'dispute') d.x.reasonVariant = r.chance(L.decoyP) ? 'decoy' : 'plain';
    const lang = d.variant === 'foreign' ? d.lang : 'en';
    const cur = d.x.currency ?? d.facts?.currency ?? d.surface?.currency ?? 'USD';
    const x = { ...d.x, day: d.day, sender: d.sender, currency: d.x.currency ?? cur, m: minor => moneyIn(lang, cur, minor) };
    if (d.kind === 'invoice' && d.variant === 'foreign') x.taxLabel = taxLabel(cur, lang);
    else if (d.kind === 'invoice') x.taxLabel = taxLabel(cur, 'en');
    const { subject, body } = tpl(x);
    d.subject = subject; d.body = body;
  }

  // ---- order and number the documents
  const ordered = r.shuffle(docs);
  ordered.forEach((d, i) => {
    d.id = i + 1;
    if (d.facts) d.facts.doc = d.id;
    d.surface = { ...d.surface, doc: d.id };
    for (const k of Object.keys(d.alt)) d.alt[k] = { ...d.alt[k], doc: d.id };
  });
  let world = { spec, attempt, L, S, vendors, customers, parties, bills, ar, docs: ordered, freeIds: free.map(c => c.id) };
  world = hooks.schemaDrift(world); // R8 f1 hook point (no-op in v1)
  world.render = renderInputs(world);
  if (verifier) {
    const bad = verifier(world);
    if (bad) return reject(`control-passes:${bad}`);
  }
  return world;
}

export { dateIn, moneyIn };
