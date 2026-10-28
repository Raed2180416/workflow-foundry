// wait: R3 customer action on unavailable items. Keys: 'status' (order customerActionRequired), 'notice', 'deadline'
// (timer at D+1 min, so an action at exactly D still wins, S1), 'fcancel-<id>' and 'order-timedout' at the timeout.
// The parent calls op 'arm' when the order is cleared with an unavailable fulfilment, op 'action' for each customer
// action that reaches the order, and op 'timeout' when the deadline timer fires.

const addMin = (iso, m) => new Date(Date.parse(iso) + m * 60000).toISOString();

function stepRaw(input, ctx) {
  const st = ctx.state;
  if (input.op === 'arm') {
    if (st) return { output: { phase: st.phase } };
    const D = addMin(input.p, input.customerActionHours * 60);     // S1: anchored at p, not at the clearance
    const next = { orderId: input.orderId, email: input.email, D, phase: 'waiting', fulfilments: input.fulfilments };
    return {
      state: next,
      effects: [
        { key: 'status', system: 'orders', op: 'setStatus', args: { orderId: input.orderId, fulfilmentId: null, status: 'customerActionRequired' } },
        { key: 'notice', system: 'notify', op: 'send', args: { to: input.email, about: input.orderId, template: 'action-required', text: 'Some items are unavailable: amend or cancel your order.' } },
      ],
      obligations: { upsert: [{ id: 'deadline', kind: 'customerActionDeadline', anchor: input.p, dueAt: addMin(D, 1), onDue: 'timeout' }] },
      output: { phase: 'waiting', D },
    };
  }
  if (input.op === 'adopt') {
    // go-live (§3.5): the window was opened before go-live; its status and notice are already recorded, so no effects
    if (st) return { output: { phase: st.phase } };
    const D = addMin(input.p, input.customerActionHours * 60);
    const next = { orderId: input.orderId, email: input.email, D, phase: 'waiting', fulfilments: input.fulfilments };
    return {
      state: next,
      obligations: { upsert: [{ id: 'deadline', kind: 'customerActionDeadline', anchor: input.p, dueAt: addMin(D, 1), onDue: 'timeout' }] },
      output: { phase: 'waiting', D },
    };
  }
  if (!st) return { output: { phase: 'none' } };
  if (input.op === 'action') {
    // R3.2: the first amend or cancel at or before D counts; later ones change nothing (S5, S8)
    if (st.phase !== 'waiting') return { output: { counted: null, phase: st.phase } };
    if (Date.parse(input.at) > Date.parse(st.D)) return { output: { counted: null, phase: 'late' } };
    const available = st.fulfilments.filter(f => f.available);
    if (input.action === 'cancel') {
      return { state: { ...st, phase: 'customer' }, obligations: { cancel: ['deadline'] }, output: { counted: 'cancel', at: input.at } };
    }
    // amend: every unavailable fulfilment cancelled (within 60 min of the amend); the rest continue
    const unavailable = st.fulfilments.filter(f => !f.available);
    const effects = unavailable.map(f => ({ key: `fcancel-${f.fulfilmentId}`, system: 'orders', op: 'setStatus',
      args: { orderId: st.orderId, fulfilmentId: f.fulfilmentId, status: 'cancelled' } }));
    return {
      state: { ...st, phase: 'amended' }, effects, obligations: { cancel: ['deadline'] },
      output: { counted: 'amend', at: input.at, nothingAvailable: available.length === 0, available: available.map(f => f.fulfilmentId) },
    };
  }
  if (input.op === 'timeout') return timeout(st);
  return { output: { phase: st.phase } };
}

// The deadline timer (fires at D+1 min) and the parent's explicit 'timeout' call share this.
function timeout(st) {
  if (st.phase !== 'waiting') return { output: { timedOut: false, phase: st.phase } };
  // nothing counted by D: every fulfilment cancelled, the order timedOut, the customer told (R3.2)
  const effects = st.fulfilments.map(f => ({ key: `fcancel-${f.fulfilmentId}`, system: 'orders', op: 'setStatus',
    args: { orderId: st.orderId, fulfilmentId: f.fulfilmentId, status: 'cancelled' } }));
  effects.push({ key: 'order-timedout', system: 'orders', op: 'setStatus', args: { orderId: st.orderId, fulfilmentId: null, status: 'timedOut' } });
  effects.push({ key: 'notice-timeout', system: 'notify', op: 'send', args: { to: st.email, about: st.orderId, template: 'order-timed-out', text: 'Your order timed out.' } });
  return { state: { ...st, phase: 'timedOut' }, effects, output: { timedOut: true, phase: 'timedOut' } };
}

// The timer arrives here (routed to this instance by its name).
function onEventRaw(event, ctx) {
  const st = ctx.state;
  if (!st) return { output: { phase: 'none' } };
  if (event?.type === 'timer.fired') return timeout(st);
  return { output: { phase: st.phase } };
}

// The API may rename a field: api/<system>.schema.json in ctx.files shows the current names, so send those.
const fitNorm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function fitArgs(e, files) {
  const sch = files?.[`api/${e.system}.schema.json`];
  const props = (typeof sch === 'string' ? JSON.parse(sch) : sch)?.ops?.[e.op]?.args?.properties;
  if (!props || e.args === null || typeof e.args !== 'object' || Array.isArray(e.args)) return e;
  const names = Object.keys(props);
  const keys = Object.keys(e.args);
  const extra = keys.filter(k => !names.includes(k));
  const missing = names.filter(n => !keys.includes(n));
  const renamed = {};
  for (const k of extra) renamed[k] = names.find(n => fitNorm(n) === fitNorm(k)) ?? (extra.length === 1 && missing.length === 1 ? missing[0] : k);
  const args = {};
  for (const k of keys) args[renamed[k] ?? k] = e.args[k];
  return { ...e, args };
}
function fitAll(res, files) {
  if (res === null || typeof res !== 'object' || !Array.isArray(res.effects)) return res;
  return { ...res, effects: res.effects.map(e => fitArgs(e, files)) };
}
export function step(input, ctx) { return fitAll(stepRaw(input, ctx), ctx.files); }
export function onEvent(event, ctx) { return fitAll(onEventRaw(event, ctx), ctx.files); }
