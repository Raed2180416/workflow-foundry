// Order-level decisions (SPEC-E R3, R4.1, R4.5, R6, R7.2). Key = order id.
// Each op only decides and records; the starts and the processing statuses are emitted by `settle`, which the parent
// calls once at the end of a tick, so a counted cancel in the same tick stops the order before any step is taken (S9, S10).

const fileJson = (files, p) => {
  let v = files?.[p];
  if (v === undefined) v = p.split('/').reduce((o, k) => (o ? o[k] : undefined), files);
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  return v ?? null;
};
const deepFind = (v, key, d = 0) => {
  if (!v || typeof v !== 'object' || d > 8) return undefined;
  if (!Array.isArray(v) && key in v) return v[key];
  for (const x of Object.values(v)) { const r = deepFind(x, key, d + 1); if (r !== undefined) return r; }
  return undefined;
};
const T = iso => Date.parse(iso);
const offOf = iso => { const m = /(Z|[+-]\d\d:\d\d)$/.exec(iso); return !m ? '+01:00' : m[1] === 'Z' ? '+00:00' : m[1]; };
const addMin = (iso, m) => {
  const off = offOf(iso), [h, mm] = off.slice(1).split(':').map(Number);
  const shift = (off[0] === '-' ? -1 : 1) * (h * 60 + mm);
  return new Date(Date.parse(iso) + m * 60000 + shift * 60000).toISOString().slice(0, 19) + off;
};
const TERMINAL = ['completed', 'failed', 'cancelled'];
const policy = (ctx, ed, name) => {
  const v = deepFind(fileJson(ctx.files, `rulebook/${ed}/policy.json`), name);
  if (typeof v !== 'number') throw new Error(`rulebook/${ed}/policy.json has no ${name}`);
  return v;
};

const orderEff = (ctx, status, key) => ({ key, system: 'orders', op: 'setStatus', args: { orderId: ctx.key, fulfilmentId: null, status } });
const fulEff = (ctx, fid, status, key) => ({ key, system: 'orders', op: 'setStatus', args: { orderId: ctx.key, fulfilmentId: fid, status } });
const mail = (O, template, about, key, text) => ({ key, system: 'notify', op: 'send', args: { to: O.em, about, template, text, ref: null } });
const fInput = (ctx, O, f) => ({ orderId: ctx.key, fulfilmentId: f.fid, location: f.loc, customerId: O.cust, currency: O.cur, amountMinor: f.amt, items: f.items, email: O.em });

// The order is cancelled (R6.1 / R6.2 / R2 / R3.2): every open fulfilment ends, the order is cancelled, customer notified.
function doCancel(ctx, O, reason, at, eff, obl) {
  O.ph = 'end'; O.oc = reason;
  for (const f of O.fl) {
    if (TERMINAL.includes(O.fs[f.fid])) continue;
    if (f.av && O.sp) {
      // started: compensate what committed and set it cancelled (R6.2); its result may come later
      const r = ctx.call('fulfilment', f.fid, { op: 'cancel', at, reason });
      if (r?.ended) O.fs[f.fid] = r.ended.status;
    } else {
      O.fs[f.fid] = 'cancelled';
      eff.push(fulEff(ctx, f.fid, 'cancelled', `f.${f.fid}.cancelled`));
    }
  }
  eff.push(orderEff(ctx, 'cancelled', 'o.cancelled'));
  eff.push(mail(O, 'order-cancelled', ctx.key, 'n.cancelled', `Order ${ctx.key} has been cancelled.`));
}

// The customer amends (R3.2): unavailable fulfilments are cancelled; the order is ready at the amend's time.
function amend(ctx, O, at, eff, obl) {
  for (const f of O.fl) {
    if (f.av) continue;
    O.fs[f.fid] = 'cancelled';
    eff.push(fulEff(ctx, f.fid, 'cancelled', `f.${f.fid}.cancelled`));
  }
  if (!O.fl.some(f => f.av)) return doCancel(ctx, O, 'nothing-available', at, eff, obl);
  O.ph = 'proc'; O.cl = at;
}

// The settle pass: the R3.1 notice, and the R4.1 processing statuses with each available fulfilment's saga started.
export function settle(ctx, O) {
  const eff = [];
  if (O.ph === 'wait' && !O.sar) {
    O.sar = true;
    eff.push(orderEff(ctx, 'customerActionRequired', 'o.action'));
    eff.push(mail(O, 'action-required', ctx.key, 'n.action', `Some items of order ${ctx.key} are unavailable. Please amend or cancel the order.`));
  }
  if (O.ph === 'proc' && !O.sp) {
    O.sp = true;
    eff.push(orderEff(ctx, 'processing', 'o.processing'));
    for (const f of O.fl) if (f.av) eff.push(fulEff(ctx, f.fid, 'processing', `f.${f.fid}.processing`));
    for (const f of O.fl) if (f.av) ctx.call('fulfilment', f.fid, { op: 'start', fulfilment: fInput(ctx, O, f) });
  }
  return eff;
}

function dispatch(op, I, ctx) {
  let O = ctx.state;
  const eff = [], obl = { upsert: [], cancel: [] };
  if (op === 'record') {
    if (O) return { output: { done: false }, state: O, effects: [], obligations: obl };
    O = { ph: 'pend', p: I.p, ed: I.ed, em: I.em, cur: I.cur, cust: I.cust, fl: I.fl, fs: {}, cl: null, D: null, coll: null, sar: false, sp: false, oc: null };
    return { output: { done: false }, state: O, effects: [], obligations: obl };
  }
  if (!O) return { output: { done: false }, state: null, effects: [], obligations: obl };
  const prev = O.ph;
  if (op === 'cleared') {
    // R2.1 pass / R2.2 approve: cleared at the given time (R4.1 ready, or R3.1 waiting for the customer)
    if (O.ph === 'pend') {
      O.cl = I.at;
      if (O.fl.some(f => !f.av)) {
        O.ph = 'wait';
        O.D = addMin(O.p, policy(ctx, O.ed, 'customerActionHours') * 60);
        obl.upsert.push({ id: 'deadline', kind: 'customerDeadline', anchor: O.p, dueAt: addMin(O.D, 60), onDue: 'deadline' });
      } else O.ph = 'proc';
    }
  } else if (op === 'reject') {
    // R2.1 reject, R2.2 reject: cancelled for fraud before any step
    if (O.ph === 'pend') doCancel(ctx, O, I.reason, I.at, eff, obl);
  } else if (op === 'action') {
    if (I.action === 'amend') {
      // R3.2: the first amend at or before D counts while waiting (S5, S8: later amends change nothing)
      if (O.ph === 'wait' && T(I.at) <= T(O.D)) amend(ctx, O, I.at, eff, obl);
    } else if (I.action === 'cancel') {
      if (O.ph === 'pend') doCancel(ctx, O, 'customer', I.at, eff, obl);                 // R6.4
      else if (O.ph === 'wait') { if (T(I.at) <= T(O.D)) doCancel(ctx, O, 'customer', I.at, eff, obl); }   // R3.2
      else if (O.ph === 'proc') {
        // R6.2: counts unless a collection was reported at or before the cancel (S7)
        if (O.coll !== null && T(O.coll) <= T(I.at)) {
          eff.push(mail(O, 'cancel-refused', ctx.key, `n.refused.${String(I.eid).replace(/\//g, '_')}`, `The order ${ctx.key} has been collected and can no longer be cancelled.`));
        } else doCancel(ctx, O, 'customer', I.at, eff, obl);
      }
    }
  } else if (op === 'evidence') {
    // a collection-proving report (S7): keep the earliest reportedAt
    if (O.coll === null || T(I.reportedAt) < T(O.coll)) O.coll = I.reportedAt;
  } else if (op === 'ended') {
    // R4.5: the order's outcome once every available fulfilment has ended
    O.fs[I.fid] = I.status;
    if (O.ph === 'proc' && O.fl.filter(f => f.av).every(f => TERMINAL.includes(O.fs[f.fid]))) {
      const fs = O.fl.filter(f => f.av).map(f => O.fs[f.fid]);
      O.ph = 'end';
      O.oc = fs.includes('completed') ? 'completed' : fs.includes('failed') ? 'failed' : 'cancelled';
      eff.push(orderEff(ctx, O.oc, 'o.outcome'));
    }
  } else if (op === 'timeout') {
    // R3.2: nothing counted by D: after D (and by D + 60 min) every fulfilment is cancelled and the order times out
    if (O.ph === 'wait' && T(I.now) >= T(O.D)) {
      O.ph = 'end'; O.oc = 'timedOut';
      for (const f of O.fl) {
        if (TERMINAL.includes(O.fs[f.fid])) continue;
        O.fs[f.fid] = 'cancelled';
        eff.push(fulEff(ctx, f.fid, 'cancelled', `f.${f.fid}.cancelled`));
      }
      eff.push(orderEff(ctx, 'timedOut', 'o.timedOut'));
      eff.push(mail(O, 'order-timed-out', ctx.key, 'n.timed-out', `Order ${ctx.key} timed out: it was not confirmed in time.`));
    }
  } else if (op === 'resume') {
    // go-live (§3.5): continue an order in flight from the status its records show; nothing is re-announced
    O.fs = { ...O.fs, ...(I.fs ?? {}) };
    if (I.status === 'customerActionRequired' && O.ph === 'pend') {
      O.ph = 'wait'; O.cl = O.p; O.sar = true;
      O.D = addMin(O.p, policy(ctx, O.ed, 'customerActionHours') * 60);
      obl.upsert.push({ id: 'deadline', kind: 'customerDeadline', anchor: O.p, dueAt: addMin(O.D, 60), onDue: 'deadline' });
    } else if (I.status === 'processing' && O.ph === 'pend') {
      O.ph = 'proc'; O.cl = O.p; O.sp = true;
    } else if (['completed', 'failed', 'cancelled', 'timedOut'].includes(I.status)) {
      O.ph = 'end'; O.oc = I.status;
    }
  } else if (op === 'settle') {
    eff.push(...settle(ctx, O));
  } else throw new Error(`orderflow: unknown op ${op}`);
  if (prev === 'wait' && O.ph !== 'wait') obl.cancel.push('deadline');
  const done = O.ph === 'end' && O.fl.every(f => TERMINAL.includes(O.fs[f.fid]));
  return { output: { done }, state: O, effects: eff, obligations: obl };
}

export function step(input, ctx) {
  return dispatch(input.op, input, ctx);
}

export function onEvent(event, ctx) {
  if (event.type === 'timer.fired' && event.payload?.obligationId === 'deadline') return dispatch('timeout', { now: ctx.now }, ctx);
  // results of this order's own status changes and notices need no decision
  return { output: { done: false }, state: ctx.state };
}
