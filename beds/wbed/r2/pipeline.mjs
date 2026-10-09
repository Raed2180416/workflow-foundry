// The bed's own exact solver for R2, written as the four stages of the reference outline (W-BED §3.2): split the inbox
// into documents -> route each document (the judged branch, 'review' included) -> read the routed kind's facts from the
// document text -> post (resolve references against the ledgers, allocate remittances, assemble the output).
// referenceSolve runs it with no options; each control runs it with one option that reproduces one plausible mistake,
// so a control's per-stage outputs (its trace) can be scored by the stage oracles and relations. This is the oracle's
// reference, not the hand-curated reference workflow (arm c), which Opus writes later.
import { isoDay } from '../lib/domain.mjs';
import { HANDLED } from './vocab.mjs';
import { keywordRoute, keywordReason } from './keyword.mjs';
import { resolveBill, resolveInvoice, allocate, partyCurrency } from './world.mjs';

const textOf = d => `${d.subject}\n${d.body}`;

// ---- stage 1: split (one record per document; the header fields as printed)
export function split(world) {
  return { docs: world.docs.map(d => ({ doc: d.id, from: `${d.sender.name} <${d.sender.email}>`, subject: d.subject, date: isoDay(d.day) })) };
}

// ---- stage 2: route (the judged branch)
export function route(world, opts = {}) {
  const routing = world.docs.map(d => {
    let kind = d.kind;
    if (opts.oneHandler) kind = opts.oneHandler;
    else if (opts.reviewAll) kind = 'review';
    else if (opts.keywordRouter) kind = keywordRoute(textOf(d));
    else {
      if (opts.noEscalation && d.kind === 'review') kind = d.firstReading;
      if (opts.escalateHedged && d.hedged) kind = 'review';
      if (opts.injectionObeyed && d.kind === 'injection') kind = Object.keys(d.alt)[0];
      if (opts.foreignMissed && d.foreign) kind = keywordRoute(textOf(d));
      if (opts.bankUnrelated && d.kind === 'bank_change') kind = 'unrelated';
      if (opts.statementIgnored && d.kind === 'statement_request') kind = 'unrelated';
    }
    return { doc: d.id, kind };
  });
  return { routing };
}

// ---- stage 3: read (per document routed to a handled kind: the facts its text states for that kind)
function genericFacts(d, kind) {
  const s = d.surface;
  return { doc: d.id, kind, party: s.party, currency: s.currency, amount_minor: kind === 'dispute' || kind === 'statement_request' || kind === 'bank_change' ? 0 : s.amount_minor,
    refs: kind === 'statement_request' || kind === 'bank_change' ? [] : [...s.refs], ref_date: '', ref_amount_minor: 0,
    reason: kind === 'dispute' ? keywordReason(d.body) : '' };
}
export function read(world, rt, opts = {}) {
  const byId = new Map(world.docs.map(d => [d.id, d]));
  const facts = [];
  for (const { doc, kind } of rt.routing) {
    if (!HANDLED[kind]) continue;
    const d = byId.get(doc);
    let f;
    if (d.kind === kind && d.facts) f = { ...d.facts, refs: [...d.facts.refs] };
    else if (d.alt[kind]) f = { ...d.alt[kind], refs: [...d.alt[kind].refs] };
    else f = genericFacts(d, kind);
    if (opts.netNotTotal && kind === 'invoice' && d.kind === 'invoice') f.amount_minor = d.x.net;
    if (opts.reasonKeyword && kind === 'dispute') f.reason = keywordReason(d.body);
    facts.push(f);
  }
  return { facts };
}

// ---- stage 4: post (joins with the ledgers and the assembled output)
export function post(world, rt, rd, opts = {}) {
  const entries = [], holds = [];
  for (const f of rd.facts) {
    switch (f.kind) {
      case 'invoice':
        if (f.party && f.amount_minor > 0) entries.push({ doc: f.doc, action: 'post_bill', party: f.party, ref: f.refs[0] ?? '', currency: f.currency, amount_minor: f.amount_minor });
        break;
      case 'credit_note': {
        if (!f.party) break;
        let bill = opts.creditLatest ? world.bills.filter(b => b.vendor === f.party).sort((a, b) => b.day - a.day)[0] : resolveBill(world, f, { exactOnly: opts.typoUnresolved });
        const ref = bill ? bill.billId : (f.refs[0] ?? '');
        entries.push({ doc: f.doc, action: 'post_credit', party: f.party, ref, currency: f.currency, amount_minor: opts.creditPositive ? f.amount_minor : -f.amount_minor });
        break;
      }
      case 'remittance':
        if (f.party && f.amount_minor > 0) entries.push(...allocate(world, f, opts));
        break;
      case 'statement_request':
        if (f.party) entries.push({ doc: f.doc, action: 'send_statement', party: f.party, ref: '', currency: partyCurrency(world, f.party), amount_minor: 0 });
        break;
      case 'dispute': {
        if (!f.party) break;
        let inv = resolveInvoice(world, f.refs[0], f.party, { exactOnly: opts.typoUnresolved });
        if (opts.holdLatest) inv = world.ar.filter(i => i.customer === f.party).sort((a, b) => b.day - a.day)[0] ?? inv;
        holds.push({ doc: f.doc, ref: inv ? inv.no : (f.refs[0] ?? ''), reason: f.reason });
        break;
      }
      case 'bank_change':
        if (f.party) holds.push({ doc: f.doc, ref: f.party, reason: 'VERIFY_BANK' });
        break;
      default: break;
    }
  }
  const routing = rt.routing.map(x => ({ doc: x.doc, kind: x.kind }));
  const review_queue = routing.filter(x => x.kind === 'review').map(x => x.doc);
  return { routing, entries, holds, review_queue };
}

/** Full trace { split, route, read, post } under `opts` (default: the exact solver). */
export function runPipeline(world, opts = {}) {
  const sp = split(world);
  const rt = route(world, opts);
  const rd = read(world, rt, opts);
  return { split: sp, route: rt, read: rd, post: post(world, rt, rd, opts) };
}
export const solveOutput = (world, opts = {}) => { const rt = route(world, opts); return post(world, rt, read(world, rt, opts), opts); };
