// saga (SPEC-E §4.4 R4.2 and R4.4, §4.5 R5.1-R5.2, §4.6 R6.2, S2, S14): one fulfilment's saga. Forward steps run one
// at a time, each after the previous committed: reserve every item, charge, book the shipment. The carrier's messages
// move the fulfilment to dispatched and completed. A failure or a cancel undoes what committed, in reverse order:
// cancel the shipment, refund the charge, release each reserved item. A step that is in flight when the saga stops is
// undone as soon as its result shows it committed.

const sv = (st, status, key) => ({ key, system: 'orders', op: 'setStatus', args: { orderId: st.o, fulfilmentId: st.f, status } });
// An error is { code: <HTTP status>, reason, retryable }; a 400 is an invalid request of ours (R4.2), not a failure.
const reason = p => (typeof p.error === 'string' ? p.error : p.error?.reason ?? '');
const invalid = p => p.error?.code === 400 || /invalid-args|field-renamed/.test(reason(p));
const cstat = (ctx, sys, key) => ctx.status(sys, key) === 'committed';
const committed = (ctx, p, sys) => p.status === 'ok' || (p.status === 'unknown' && cstat(ctx, sys, p.key));
const out = st => (st ? { fid: st.f, term: st.term } : null);

function fresh(i) {
  return {
    o: i.orderId, f: i.fid, loc: i.location, cust: i.customerId, cur: i.currency, amt: i.amountMinor,
    items: i.items.map((it, n) => ({ n, sku: it.sku, qty: it.qty, s: 'todo' })),
    ph: 'reserve',        // reserve | charge | ship | wait | done
    ch: 'todo',           // todo | ok | refunded | stuck
    sh: 'todo',           // todo | ok | cancelled | gone
    col: false, cf: false, dsp: false,
    inf: null,            // local key of the one effect in flight
    bat: 0, att: 0,       // reserve batches sent (their keys) and attempts in this phase
    why: null,            // null | 'cancel' | 'fail' (the undo in progress)
    fr: null, term: null,
  };
}

function failFwd(st, why, ctx, eff) {
  st.why = 'fail';
  st.fr = why;
  return advance(st, ctx, eff);
}

// Emit the next effect of the saga, if none is in flight. Returns eff.
function advance(st, ctx, eff) {
  if (st.inf || st.term) return eff;
  if (!st.why && (st.inv ?? 0) >= 6) return eff;   // the API keeps rejecting the request: wait, do not fail (R4.2)
  if (st.why) return undo(st, ctx, eff);
  if (st.ph === 'reserve') {
    const todo = st.items.filter(i => i.s !== 'ok');
    if (todo.length) {
      if (++st.att > 6) return failFwd(st, 'reserve', ctx, eff);
      // A batch is keyed by its items (r<n>), not by the batch: the in-flight marker is local to the saga.
      st.inf = `reserve-${st.bat}`;
      eff.push({ system: 'inventory', op: 'reserve', args: { orderId: st.o, fulfilmentId: st.f, location: st.loc, items: todo.map(i => ({ key: `r${i.n}`, sku: i.sku, qty: i.qty })) } });
      return eff;
    }
    st.ph = 'charge';
    st.att = 0;
  }
  if (st.ph === 'charge') {
    if (st.ch !== 'ok') {
      if (++st.att > 6) return failFwd(st, 'charge', ctx, eff);
      st.inf = 'charge';
      eff.push({ key: 'charge', system: 'billing', op: 'charge', args: { orderId: st.o, fulfilmentId: st.f, customerId: st.cust, amountMinor: st.amt, currency: st.cur } });
      return eff;
    }
    st.ph = 'ship';
    st.att = 0;
  }
  if (st.ph === 'ship') {
    if (st.sh !== 'ok') {
      if (++st.att > 6) return failFwd(st, 'ship', ctx, eff);
      st.inf = 'ship';
      eff.push({ key: 'ship', system: 'carrier', op: 'create', args: { orderId: st.o, fulfilmentId: st.f, location: st.loc, ref: `${st.o}.${st.f}`.slice(0, 120) } });
      return eff;
    }
    st.ph = 'wait';
    st.att = 0;
  }
  return eff;
}

// The undo, in reverse order of the forward steps; only what committed is undone, each step once.
function undo(st, ctx, eff) {
  if (st.sh === 'gone') {
    // The carrier had already collected the shipment: the undo cannot happen; the fulfilment goes on (R6.2 refused).
    st.why = null;
    st.ph = 'wait';
    return eff;
  }
  if (st.sh === 'ok' && !st.cf) {
    st.inf = 'cancel-ship';
    eff.push({ key: 'cancel-ship', system: 'carrier', op: 'cancel', args: { orderId: st.o, fulfilmentId: st.f } });
    return eff;
  }
  if (st.ch === 'ok') {
    st.inf = 'refund';
    eff.push({ key: 'refund', system: 'billing', op: 'refund', args: { orderId: st.o, fulfilmentId: st.f, amountMinor: st.amt } });
    return eff;
  }
  const r = st.items.find(i => i.s === 'ok');
  if (r) {
    st.inf = `release-${r.n}`;
    eff.push({ key: st.inf, system: 'inventory', op: 'release', args: { orderId: st.o, fulfilmentId: st.f, sku: r.sku } });
    return eff;
  }
  st.term = st.why === 'cancel' ? 'cancelled' : 'failed';
  st.ph = 'done';
  eff.push(sv(st, st.term, `fs-${st.term}`));
  return eff;
}

function onResult(st, p, ctx, eff) {
  const k = p.key ?? st.inf ?? '';   // a batch result carries its item keys, not its own
  if (invalid(p)) st.inv = (st.inv ?? 0) + 1;
  else if (p.status === 'ok') st.inv = 0;
  if (k.startsWith('reserve-')) {
    st.inf = null;
    const rows = {};
    for (const r of Array.isArray(p.items) ? p.items : []) rows[r.key] = r.status;
    for (const it of st.items) {
      if (it.s === 'ok') continue;
      const row = rows[`r${it.n}`];
      if (p.status === 'ok' || row === 'ok' || (p.status === 'unknown' && cstat(ctx, 'inventory', `r${it.n}`))) it.s = 'ok';
    }
    if (p.status === 'error' && !invalid(p)) {
      if (p.error?.retryable === false) return failFwd(st, 'reserve', ctx, eff);
      // A batch that failed without a usable outcome: items that did not commit (status(key)) are resubmitted.
      for (const it of st.items) if (it.s !== 'ok' && cstat(ctx, 'inventory', `r${it.n}`)) it.s = 'ok';
      st.bat += 1;
    }
    if (p.status === 'partial' || p.status === 'ok') st.bat += 1;
    return advance(st, ctx, eff);
  }
  if (k === 'charge') {
    st.inf = null;
    if (committed(ctx, p, 'billing')) { st.ch = 'ok'; st.att = 0; }
    else if (p.status === 'error' && !invalid(p)) return failFwd(st, 'charge', ctx, eff);
    return advance(st, ctx, eff);
  }
  if (k === 'ship') {
    st.inf = null;
    if (committed(ctx, p, 'carrier')) { st.sh = 'ok'; st.att = 0; }
    else if (p.status === 'error' && !invalid(p)) return failFwd(st, 'ship', ctx, eff);
    return advance(st, ctx, eff);
  }
  if (k === 'cancel-ship') {
    st.inf = null;
    if (committed(ctx, p, 'carrier')) st.sh = 'cancelled';
    else if (p.status === 'error') st.sh = 'gone';
    return advance(st, ctx, eff);
  }
  if (k === 'refund') {
    st.inf = null;
    if (committed(ctx, p, 'billing')) st.ch = 'refunded';
    else if (p.status === 'error') st.ch = 'stuck';
    return advance(st, ctx, eff);
  }
  if (k.startsWith('release-')) {
    st.inf = null;
    const it = st.items[Number(k.slice('release-'.length))];
    if (committed(ctx, p, 'inventory')) it.s = 'released';
    else if (p.status === 'error') it.s = 'stuck';
    return advance(st, ctx, eff);
  }
  return advance(st, ctx, eff);
}

// The carrier's messages (§3.3, R4.4): collected dispatches; delivered completes; collectionFailed fails (R5.2).
function carrier(st, meaning, ctx, eff) {
  if (meaning === 'collected' || meaning === 'inTransit' || meaning === 'delivered') st.col = true;
  if (meaning === 'collected' && !st.why && !st.dsp) {
    st.dsp = true;
    eff.push(sv(st, 'dispatched', 'fs-dispatched'));
  }
  if (meaning === 'delivered' && !st.why) {
    if (!st.dsp) { st.dsp = true; eff.push(sv(st, 'dispatched', 'fs-dispatched')); }
    eff.push(sv(st, 'completed', 'fs-completed'));
    st.term = 'completed';
    st.ph = 'done';
  }
  if (meaning === 'collectionFailed' && !st.why) {
    st.cf = true;
    st.why = 'fail';
    st.fr = 'collection';
    advance(st, ctx, eff);
  }
  return eff;
}

// A saga whose order was already running before go-live: rebuild what committed from the records (rows).
function resumed(i) {
  const st = fresh(i);
  const r = i.rows ?? {};
  for (const it of st.items) if ((r.reservedSkus ?? []).includes(it.sku)) it.s = 'ok';
  if (r.charged) st.ch = 'ok';
  if (r.ship && !['cancelled', 'failed'].includes(r.ship)) st.sh = 'ok';
  if (['collected', 'inTransit', 'delivered'].includes(r.ship)) st.col = true;
  if (r.dispatched) st.dsp = true;
  st.ph = st.sh === 'ok' ? 'wait' : st.ch === 'ok' ? 'ship' : st.items.every(it => it.s === 'ok') ? 'charge' : 'reserve';
  if (r.ship === 'delivered') st.ph = 'done';
  return st;
}

// The API may rename a field (api/<system>.schema.json in ctx.files shows the current names): each field is sent under
// the name the current schema gives it, matched by type when it is the only one left.
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const squash = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const words = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const near = (a, b) => {
  if (squash(a) === squash(b)) return 3;
  if (squash(a).includes(squash(b)) || squash(b).includes(squash(a))) return 2;
  return words(a).filter(w => words(b).includes(w)).length;
};
function fit(ctx, system, op, args) {
  let api = ctx.files?.[`api/${system}.schema.json`];
  if (typeof api === 'string') { try { api = JSON.parse(api); } catch { api = null; } }
  const props = api?.ops?.[op]?.args?.properties;
  if (!props || !args || Object.keys(args).every(k => hasOwn(props, k))) return args;
  const spare = Object.keys(props).filter(k => !hasOwn(args, k));
  const out = {};
  for (const k of Object.keys(args)) {
    if (hasOwn(props, k)) { out[k] = args[k]; continue; }
    const t = typeof args[k] === 'number' ? ['integer', 'number'] : [typeof args[k]];
    const ok = spare.filter(s => [].concat(props[s].type ?? []).some(x => t.includes(x)));
    const scored = ok.map(s => [near(k, s), s]).sort((a, b) => b[0] - a[0]);
    const pick = scored.length && scored[0][0] > 0 && (scored.length === 1 || scored[1][0] < scored[0][0]) ? scored[0][1] : (ok.length === 1 ? ok[0] : null);
    if (pick) { out[pick] = args[k]; spare.splice(spare.indexOf(pick), 1); } else out[k] = args[k];
  }
  return out;
}
const fitResult = (ctx, r) => (r && Array.isArray(r.effects) ? { ...r, effects: r.effects.map(e => ({ ...e, args: fit(ctx, e.system, e.op, e.args) })) } : r);

function stepImpl(input, ctx) {
  const eff = [];
  let st = ctx.state;
  switch (input.op) {
    case 'start':
      st = fresh(input);
      eff.push(sv(st, 'processing', 'fs-processing'));
      advance(st, ctx, eff);
      break;
    case 'cancel':
      if (!st || st.term) break;
      st.why = st.why ?? 'cancel';
      advance(st, ctx, eff);
      break;
    case 'carrier':
      if (!st || st.term) break;
      carrier(st, input.meaning, ctx, eff);
      break;
    case 'resume':
      st = resumed(input);
      if (st.ph === 'done') {
        // Completed by the carrier before go-live: the records say so.
        st.term = 'completed';
        if (input.rows?.fstatus === 'processing') eff.push(sv(st, 'dispatched', 'fs-dispatched'));
        if (input.rows?.fstatus !== 'completed') eff.push(sv(st, 'completed', 'fs-completed'));
      } else {
        advance(st, ctx, eff);
      }
      break;
    default:
      break;
  }
  return { output: out(st), state: st, effects: eff };
}

function onEventImpl(ev, ctx) {
  const st = ctx.state;
  if (!st || st.term || ev.type !== 'effect.result') return { output: out(st) };
  const eff = [];
  onResult(st, ev.payload, ctx, eff);
  return { output: out(st), state: st, effects: eff };
}

export function step(input, ctx) { return fitResult(ctx, stepImpl(input, ctx)); }
export function onEvent(ev, ctx) { return fitResult(ctx, onEventImpl(ev, ctx)); }
