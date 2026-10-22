// One fulfilment (SPEC-E R4.2 saga, R4.4 carrier reports, R5.1 compensation, R5.2 failure, S14). Key = fulfilment id.
// Steps: reserve every item (one batch, each item keyed) → charge → ship. A failing or cancelled fulfilment is
// compensated in reverse order of what committed: shipment, charge (refund), reservations (release). Whenever a step
// commits after the stop, it is compensated as well (S14, R6.2). Nothing new is started once stopped.

const fileJson = (files, p) => {
  let v = files?.[p];
  if (v === undefined) v = p.split('/').reduce((o, k) => (o ? o[k] : undefined), files);
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  return v ?? null;
};

const MAX_FIX = 3;

// A 400 from a system is our mistake (e.g. a field it renamed): re-issue with the arguments the current schema names.
// A value whose name the schema no longer has moves to a required name of its own type that is most like the old one
// (by position only when no name is alike), so a rename never puts a value into another field.
const nameKey = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const likeness = (a, b) => {
  const x = nameKey(a), y = nameKey(b);
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n++;
  return n + (x.includes(y) || y.includes(x) ? 10 : 0);
};
const typeOf = v => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v === 'number' ? 'number' : typeof v);
const typeFits = (s, v) => {
  if (!s?.type) return true;
  const t = [].concat(s.type);
  return t.includes(typeOf(v)) || (typeOf(v) === 'number' && t.includes('integer'));
};
const fixArgs = (v, s) => {
  if (!s || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(x => fixArgs(x, s.items));
  const props = Object.keys(s.properties ?? {});
  if (!props.length) return v;
  const out = {}, extra = [];
  for (const k of Object.keys(v)) (props.includes(k) ? (out[k] = fixArgs(v[k], s.properties[k])) : extra.push(k));
  const free = [...(s.required ?? []), ...props].filter((k, i, all) => all.indexOf(k) === i && !(k in out));
  for (const k of extra) {
    if (!free.length) break;
    const fits = free.filter(m => typeFits(s.properties[m], v[k]));
    const pool = fits.length ? fits : free;
    const m = pool.reduce((best, c) => (likeness(k, c) > likeness(k, best) ? c : best), pool[0]);
    out[m] = fixArgs(v[k], s.properties[m]);
    free.splice(free.indexOf(m), 1);
  }
  return out;
};
const argsSchema = (ctx, system, op) => fileJson(ctx.files, `api/${system}.schema.json`)?.ops?.[op]?.args ?? null;

const codeOf = err => (typeof err === 'string' ? err : err?.code);
const isInvalid = err => codeOf(err) === 'invalid-args' || codeOf(err) === 'field-renamed';
// a permanent error (retryable: false, a declined card, a permanent failure) is never retried; any other error is
// retried a few times (the platform has already retried it once, e.g. 503 batch-item-not-processed)
const isTransient = err => {
  const c = String(codeOf(err) ?? '');
  return !/permanent|declined/.test(c) && !(typeof err === 'object' && err !== null && err.retryable === false);
};
// a budget of re-issues per step, so one step's renames do not use up another step's retries
const tryAgain = (S, step) => { S.fx[step] = (S.fx[step] ?? 0) + 1; return S.fx[step] <= MAX_FIX; };

// ok | pend (still running) | invalid (our request was wrong) | bad (a permanent failure) | transient (retry later)
const classify = (ctx, system, key, status, err) => {
  if (status === 'ok') return 'ok';
  if (status === 'unknown') {
    const s = ctx.status(system, key);       // S2: committed is the system's truth, not what we last saw
    // not-found: the effect did not apply, and that is no permanent failure (R5.2): issue it again with the same key
    return s === 'committed' ? 'ok' : s === 'pending' ? 'pend' : 'transient';
  }
  if (status === 'error') return isInvalid(err) ? 'invalid' : isTransient(err) ? 'transient' : 'bad';
  return 'pend';
};

const reserveEffect = (S, skus, args) => ({
  system: 'inventory', op: 'reserve',
  args: args ?? { orderId: S.f.oid, fulfilmentId: S.f.fid, location: S.f.loc,
    items: skus.map(sku => ({ key: `r.${sku}`, sku, qty: S.f.qty[sku] })) },
});
const chargeArgs = S => ({ orderId: S.f.oid, fulfilmentId: S.f.fid, customerId: S.f.cust, amountMinor: S.f.amt, currency: S.f.cur });
const shipArgs = S => ({ orderId: S.f.oid, fulfilmentId: S.f.fid, location: S.f.loc, ref: S.f.fid });
const setStatus = (S, status, key) => ({ key, system: 'orders', op: 'setStatus', args: { orderId: S.f.oid, fulfilmentId: S.f.fid, status } });

// Compensation (R5.1) of everything committed and not yet undone, then the terminal status once nothing is in flight.
function settle(S, at, ctx) {
  const eff = [];
  // nothing is undone unless the fulfilment was stopped by a failure or a cancel (never after a normal completion)
  if (!S.sr) return { eff, ended: null };
  const waitShip = S.sh === 'pend', waitCharge = S.ch === 'pend';
  // R5.1 order: shipment, then charge, then reservations; each waits for an in-flight step before it is undone
  if (!waitShip) {
    if (S.sh === 'ok' && !S.sc && !S.cf) { S.sc = true; eff.push({ key: 'ship.cancel', system: 'carrier', op: 'cancel', args: { orderId: S.f.oid, fulfilmentId: S.f.fid } }); }
    if (!waitCharge) {
      if (S.ch === 'ok' && !S.rf) { S.rf = true; eff.push({ key: 'refund', system: 'billing', op: 'refund', args: { orderId: S.f.oid, fulfilmentId: S.f.fid, amountMinor: S.f.amt } }); }
      for (const [sku, r] of Object.entries(S.res)) {
        if (r.s === 'ok' && !r.rel) { r.rel = true; eff.push({ key: `rel.${sku}`, system: 'inventory', op: 'release', args: { orderId: S.f.oid, fulfilmentId: S.f.fid, sku } }); }
      }
    }
  }
  const busy = Object.values(S.res).some(r => r.s === 'pend') || waitCharge || waitShip;
  let ended = null;
  if (S.st === 'stop' && !busy && !S.sf) {
    S.sf = true; S.st = 'end';
    const status = S.sr === 'fail' ? 'failed' : 'cancelled';
    S.ev = status;
    eff.push(setStatus(S, status, `st.${status}`));
    if (status === 'failed') eff.push({ key: 'n.failed', system: 'notify', op: 'send', args: { to: S.f.em, about: S.f.fid, template: 'fulfilment-failed', text: `Fulfilment ${S.f.fid} of order ${S.f.oid} could not be completed.`, ref: null } });
    ended = { fid: S.f.fid, status, at };
  }
  return { eff, ended };
}

const stopWith = (S, reason, at) => { if (S.st === 'run') { S.st = 'stop'; S.sr = reason; S.sat = at; } };

export function step(input, ctx) {
  let S = ctx.state;
  if (input.op === 'start') {
    if (S) return { output: null, state: S };
    const f = input.fulfilment;
    const qty = {};
    for (const it of f.items) qty[it.sku] = (qty[it.sku] ?? 0) + it.qty;
    const res = {};
    for (const sku of Object.keys(qty)) res[sku] = { s: 'pend', n: 0, rel: false };
    S = { st: 'run', sr: null, f: { oid: f.orderId, fid: f.fulfilmentId, loc: f.location, cust: f.customerId, cur: f.currency, amt: f.amountMinor, em: f.email, qty }, res, ch: 'none', sh: 'none', sc: false, rf: false, cf: false, dp: false, sf: false, fx: {} };
    return { output: null, state: S, effects: [reserveEffect(S, Object.keys(res))] };
  }
  if (input.op === 'resume') {
    // go-live (§3.5): a fulfilment in flight continues from its records; committed steps are not repeated, the rest
    // are issued again with their stable keys (a committed key returns the original result)
    if (S) return { output: null, state: S };
    const f = input.fulfilment;
    const qty = {};
    for (const it of f.items) qty[it.sku] = (qty[it.sku] ?? 0) + it.qty;
    const res = {};
    for (const sku of Object.keys(qty)) res[sku] = { s: input.reserved.includes(sku) ? 'ok' : 'pend', n: 0, rel: false };
    S = { st: 'run', sr: null, f: { oid: f.orderId, fid: f.fulfilmentId, loc: f.location, cust: f.customerId, cur: f.currency, amt: f.amountMinor, em: f.email, qty }, res,
      ch: input.charged ? 'ok' : 'none', sh: input.shipped ? 'ok' : 'none', sc: false, rf: false, cf: false, dp: !!input.dispatched, sf: false, fx: {} };
    const pend = Object.keys(res).filter(sku => res[sku].s === 'pend');
    const eff = [];
    if (pend.length) eff.push(reserveEffect(S, pend));
    else if (S.ch === 'none') { S.ch = 'pend'; eff.push({ key: 'charge', system: 'billing', op: 'charge', args: chargeArgs(S) }); }
    else if (S.sh === 'none') { S.sh = 'pend'; eff.push({ key: 'ship', system: 'carrier', op: 'create', args: shipArgs(S) }); }
    return { output: null, state: S, effects: eff };
  }
  if (!S) return { output: null, state: null };
  if (input.op === 'carrier') {
    // a report about a shipment we cancelled, or a fulfilment already ended, changes nothing (§3.3)
    if (S.st !== 'run' || S.sh !== 'ok') return { output: null, state: S };
    const m = input.report.meaning, at = input.report.reportedAt, eff = [];
    let ended = null;
    if (m === 'collectionFailed') { S.cf = true; stopWith(S, 'fail', at); }
    else if (m === 'collected') { if (!S.dp) { S.dp = true; eff.push(setStatus(S, 'dispatched', 'st.dispatched')); } }
    else if (m === 'delivered') {
      if (!S.dp) { S.dp = true; eff.push(setStatus(S, 'dispatched', 'st.dispatched')); }
      eff.push(setStatus(S, 'completed', 'st.completed'));
      S.st = 'end'; S.ev = 'completed';
      ended = { fid: S.f.fid, status: 'completed', at };
    }
    const r = settle(S, at, ctx);
    return { output: { ended: ended ?? r.ended }, state: S, effects: eff.concat(r.eff) };
  }
  if (input.op === 'cancel') {
    if (!S || S.st === 'end') return { output: null, state: S };
    if (S.st === 'run' && S.ch === 'none' && S.sh === 'none' && Object.values(S.res).every(r => r.s !== 'ok' && r.s !== 'pend')) {
      // nothing started: nothing to undo
      S.st = 'end'; S.sf = true; S.ev = 'cancelled';
      return { output: { ended: { fid: S.f.fid, status: 'cancelled', at: input.at } }, state: S, effects: [setStatus(S, 'cancelled', 'st.cancelled')] };
    }
    stopWith(S, 'cancel', input.at);
    const r = settle(S, input.at, ctx);
    return { output: { ended: r.ended }, state: S, effects: r.eff };
  }
  throw new Error(`fulfilment: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  const S = ctx.state;
  const p = event.payload ?? {};
  if (!S || event.type !== 'effect.result') return { output: { ended: null }, state: S };
  const sys = `${p.system}.${p.op}`;
  const at = event.at;
  const eff = [];
  let ended = null;
  const fail = () => stopWith(S, 'fail', at);

  if (sys === 'inventory.reserve') {
    const items = Array.isArray(p.items) ? p.items : Object.keys(S.res).filter(k => S.res[k].s === 'pend').map(sku => ({ key: `r.${sku}`, status: p.status, error: p.error }));
    const redo = [], fixable = [];
    for (const it of items) {
      const sku = String(it.key ?? '').replace(/^r\./, '');
      const r = S.res[sku];
      if (!r || r.s !== 'pend') continue;
      const c = classify(ctx, 'inventory', `r.${sku}`, it.status ?? p.status, it.error ?? p.error);
      if (c === 'ok') r.s = 'ok';
      else if (c === 'invalid') fixable.push(sku);
      else if (c === 'transient' && r.n < MAX_FIX) { r.n += 1; redo.push(sku); }
      else if (c === 'bad' || c === 'transient') { r.s = 'bad'; fail(); }
    }
    if (fixable.length) {
      const fixed = fixArgs(reserveEffect(S, fixable).args, argsSchema(ctx, 'inventory', 'reserve'));
      const e = tryAgain(S, 'reserve') ? reserveEffect(S, fixable, fixed) : false;
      if (e) eff.push(e); else { for (const sku of fixable) S.res[sku].s = 'bad'; fail(); }
    }
    if (redo.length) eff.push(reserveEffect(S, redo));
    if (Object.values(S.res).every(r => r.s === 'ok') && S.st === 'run') {
      // all reserved: charge; if the charge was already committed (a go-live resume), book the shipment instead
      if (S.ch === 'none') { S.ch = 'pend'; eff.push({ key: 'charge', system: 'billing', op: 'charge', args: chargeArgs(S) }); }
      else if (S.ch === 'ok' && S.sh === 'none') { S.sh = 'pend'; eff.push({ key: 'ship', system: 'carrier', op: 'create', args: shipArgs(S) }); }
    }
  } else if (sys === 'billing.charge') {
    const c = classify(ctx, 'billing', 'charge', p.status, p.error);
    if (c === 'ok') {
      S.ch = 'ok';
      if (S.st === 'run') { S.sh = 'pend'; eff.push({ key: 'ship', system: 'carrier', op: 'create', args: shipArgs(S) }); }
    } else if (c === 'invalid') {
      const fixed = fixArgs(chargeArgs(S), argsSchema(ctx, 'billing', 'charge'));
      if (tryAgain(S, 'charge')) eff.push({ key: 'charge', system: 'billing', op: 'charge', args: fixed }); else { S.ch = 'bad'; fail(); }
    } else if (c === 'bad') { S.ch = 'bad'; fail(); }
    else if (c === 'transient' && tryAgain(S, 'charge')) eff.push({ key: 'charge', system: 'billing', op: 'charge', args: chargeArgs(S) });
    else if (c === 'transient') { S.ch = 'bad'; fail(); }
  } else if (sys === 'carrier.create') {
    const c = classify(ctx, 'carrier', 'ship', p.status, p.error);
    if (c === 'ok') S.sh = 'ok';
    else if (c === 'invalid') {
      const fixed = fixArgs(shipArgs(S), argsSchema(ctx, 'carrier', 'create'));
      if (tryAgain(S, 'ship')) eff.push({ key: 'ship', system: 'carrier', op: 'create', args: fixed }); else { S.sh = 'bad'; fail(); }
    } else if (c === 'bad') { S.sh = 'bad'; fail(); }
    else if (c === 'transient' && tryAgain(S, 'ship')) eff.push({ key: 'ship', system: 'carrier', op: 'create', args: shipArgs(S) });
    else if (c === 'transient') { S.sh = 'bad'; fail(); }
  }
  // refunds, releases, cancellations and status changes need no reply from us: nothing else to decide
  const r = settle(S, at, ctx);
  ended = r.ended;
  return { output: { ended }, state: S, effects: eff.concat(r.eff) };
}
