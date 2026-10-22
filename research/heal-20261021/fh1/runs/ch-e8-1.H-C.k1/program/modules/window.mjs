// window (SPEC-E §4.3 R3.1-R3.2, S1, S5): the customer's window on unavailable items. The deadline D is placedAt plus
// customerActionHours (the edition in force at placedAt). The first amend or cancel at or before D counts; the timeout
// is taken after D (at D + 1 minute, so an action exactly at D is delivered first).

const MIN = 60000;
const AMS = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const wall = t => Object.fromEntries(AMS.formatToParts(new Date(Math.floor(t / 1000) * 1000)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
const dayOf = t => { const p = wall(t); return `${p.year}-${p.month}-${p.day}`; };
const iso = t => {
  const p = wall(t);
  const t0 = Math.floor(t / 1000) * 1000;
  const off = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t0) / MIN);
  const a = Math.abs(off);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};
const ms = s => new Date(s).getTime();

const fileJson = (files, p) => {
  let v = files?.[p];
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return v ?? null;
};

function editionAt(files, t) {
  const day = dayOf(t);
  let best = null;
  for (const k of Object.keys(files ?? {})) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(k);
    const e = m ? fileJson(files, k) : null;
    if (!e || typeof e.effectiveFrom !== 'string') continue;
    const from = e.effectiveFrom.slice(0, 10);
    if (from <= day && (!best || from > best.from)) best = { dir: m[1], from };
  }
  if (!best) throw new Error('window: no rulebook edition in force');
  return best.dir;
}

const setStatus = (orderId, fulfilmentId, status, key) => ({
  key, system: 'orders', op: 'setStatus', args: { orderId, fulfilmentId, status },
});

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
  if (input.op === 'open') {
    const p = ms(input.p);
    const ed = editionAt(ctx.files, p);
    const pol = fileJson(ctx.files, `rulebook/${ed}/policy.json`);
    if (!Number.isFinite(pol?.customerActionHours)) throw new Error('window: policy.json has no customerActionHours');
    const D = p + pol.customerActionHours * 3600000;
    const st = {
      o: input.orderId, c: input.customerId, D,
      unav: input.unavailable, avail: input.available,
      all: [...input.unavailable, ...input.available], done: null,
    };
    return {
      output: { status: 'waiting', deadline: iso(D) },
      state: st,
      // A go-live order already in customerActionRequired has that status on record: it is not set again (R7.2).
      effects: input.known === true ? [] : [setStatus(input.orderId, null, 'customerActionRequired', 'cad-status')],
      obligations: { upsert: [{ id: 'cad', kind: 'customerActionTimeout', anchor: input.p, dueAt: iso(D + MIN), onDue: 'timeout' }], cancel: [] },
    };
  }
  const st = ctx.state;
  if (input.op === 'stop') {
    if (!st) return { output: null };
    st.done = st.done ?? 'stopped';
    return { output: null, state: st, obligations: { cancel: ['cad'] } };
  }
  if (input.op !== 'act' || !st || st.done || ms(input.at) > st.D) return { output: { decision: null } };
  if (input.action === 'amend') {
    st.done = 'amend';
    return {
      output: { decision: 'amend', at: input.at, available: st.avail, unavailable: st.unav },
      state: st,
      effects: st.unav.map(f => setStatus(st.o, f, 'cancelled', `unav-${f}`)),
      obligations: { cancel: ['cad'] },
    };
  }
  if (input.action === 'cancel') {
    st.done = 'cancel';
    return { output: { decision: 'cancel', at: input.at }, state: st, obligations: { cancel: ['cad'] } };
  }
  return { output: { decision: null } };
}

function onEventImpl(ev, ctx) {
  const st = ctx.state;
  if (!st || st.done || ev.type !== 'timer.fired') return { output: null };
  if (ms(ctx.now) <= st.D) return { output: null };   // a timeout taken at D itself is too early (R3.2)
  st.done = 'timeout';
  return {
    output: { decision: 'timeout' },
    state: st,
    effects: [
      ...st.all.map(f => setStatus(st.o, f, 'cancelled', `to-${f}`)),
      setStatus(st.o, null, 'timedOut', 'timed-out'),
    ],
  };
}

export function step(input, ctx) { return fitResult(ctx, stepImpl(input, ctx)); }
export function onEvent(ev, ctx) { return fitResult(ctx, onEventImpl(ev, ctx)); }
