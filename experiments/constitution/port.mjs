// The effect port: a post-posed edit automaton between a tick/1 solver and the E8 host (ATTACK-FABLE §3.2: Ligatti,
// Bauer and Walker's edit automata; post-posed shielding). It wraps the solver/host boundary in this package instead of
// editing the host: the solver's tick output passes through it before the host applies anything. For every effect the
// policy says allow, or hold: the port suppresses the effect (with the effects that depend on it in that output) and
// inserts an approval request (a human task); when an approval arrives it releases the held effects, in their original
// order and with their original keys, in the instance's next output. Effects the policy allows pass unchanged, so the
// builder's artifact is untouched and benchmarkable; every intervention is journaled in the tick's decisions
// (`decisions.constitution`, which E8 does not grade) with clause id and constitution hash, inside the host's
// hash-chained journal.
//
// The port also answers for the instance while a hold is open: it strips a close (the approval must reach the instance),
// handles its own task events and timers without calling the solver, and closes the instance once nothing is held and the
// solver last asked to close. Answers that fail (timeout, withdrawal, rejected form) are re-asked up to `maxAsks` times;
// then the policy may escalate to a break-glass request (C2-X1). Policies: shield.mjs (stateful, pinned) and guard.mjs (G).
import { createHash } from 'node:crypto';
import { canonical } from '../../beds/lib/canonical.mjs';
import { ANSWER_SCHEMA, APPROVAL_KIND } from './overlay.mjs';

const MIN = 60_000;
export const TASK_PREFIX = 'ot0:';
export const RECHECK = 'ot0:recheck';
const norm = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').toUpperCase() : null);
const iso = ms => `${new Date(ms + 60 * MIN).toISOString().slice(0, 19)}+01:00`;   // E8 worlds are written at +01:00
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const effKey = e => e.key ?? `args:${createHash('sha256').update(canonical([e.system, e.op, e.args])).digest('hex').slice(0, 24)}`;
export const sha = text => createHash('sha256').update(text).digest('hex');

/**
 * effectPort(inner, { policy, id, workflowHash, maxAsks, dueMinutes }) → a tick/1 arm.
 * policy: { name, hash, decide(effect, info) → { action: 'allow', pin? } | { action: 'hold', clause, threshold, pin?, task: { role, excludeUsers } },
 *           pin(orderId, order) → { hash, version } | null, escalate?(hold) → { role, excludeUsers, justification } | null, evidence: boolean }
 */
export function effectPort(inner, { policy, id = `port(${inner.id})`, workflowHash = null, maxAsks = 3, dueMinutes = 240 }) {
  const orders = new Map();         // orderId -> { placedAt, entered: [{ eventId, action, principal, at }] }   (facts the port saw delivered)
  const instances = new Map();      // instance -> { subject, wantClose, recheck }
  const holds = [];                 // every hold, in creation order
  const byTask = new Map();         // task id -> hold
  const byKey = new Map();          // effect key -> open hold (asking | approved)
  const settled = new Map();        // effect key -> 'released' | 'refused' | 'abandoned' (a re-emission is the same effect)
  const log = [];                   // analyst-side mirror of everything journaled (tests; the auditor never reads it)
  const solverTasks = new Map();    // instance|task id -> the solver's own approval task (a constitution-aware solver asks itself)
  const approvals = [];             // answers to the solver's own approval tasks: { subject, user, decision, at, taskId }
  let n = 0;

  const order = O => { if (!orders.has(O)) orders.set(O, { placedAt: null, entered: [] }); return orders.get(O); };
  function observe(events) {
    for (const ev of events) {
      const p = ev.payload ?? {};
      if (ev.type === 'order.placed') { const o = order(norm(p.orderId)); o.placedAt ??= Date.parse(p.placedAt); }
      else if (ev.type === 'migration') {
        for (const r of p.records?.['orders.orders'] ?? []) { const o = order(norm(r.orderId)); o.placedAt ??= Date.parse(r.placedAt); }
        for (const e of p.events ?? []) if (e.type === 'order.placed') { const o = order(norm(e.payload?.orderId)); o.placedAt ??= Date.parse(e.payload?.placedAt); }
      } else if (ev.type === 'customer.action') {
        const o = order(norm(p.orderRef));
        if (!o.entered.some(x => x.eventId === ev.id)) o.entered.push({ eventId: ev.id, action: p.action, principal: p.enteredBy ?? null, at: Date.parse(ev.at) });
      }
    }
  }

  const amountOf = e => e.args?.amountMinor ?? e.args?.amount ?? null;
  function ask(h, now, { role, excludeUsers = [], breakGlass = false, justification = null }) {
    const k = h.asks.length + 1;
    const taskId = `${TASK_PREFIX}${h.clause}:${h.id}:${k}`;
    const head = h.effects[0];
    const task = { id: taskId, kind: APPROVAL_KIND, role, excludeUsers: [...excludeUsers], subject: h.F,
      question: `${breakGlass ? `BREAK-GLASS (${justification}). ` : ''}Approve refund of ${amountOf(head)} minor (EUR) for fulfilment ${h.F} of order ${h.orderId}; `
        + `effect key ${head.key ?? '(none)'}; clause ${h.clause}; threshold ${h.threshold}; constitution ${h.pin?.hash ?? 'unpinned'}.`,
      answerSchema: ANSWER_SCHEMA, dueAt: iso(now + dueMinutes * MIN), onTimeout: { action: 'escalate' } };
    h.asks.push({ taskId, at: now, role, excludeUsers: [...excludeUsers], breakGlass, justification });
    byTask.set(taskId, h);
    return task;
  }

  async function tick(input, ctx) {
    const now = Date.parse(input.now);
    const st = instances.get(input.instance) ?? { subject: null, wantClose: false, recheck: false };
    instances.set(input.instance, st);
    observe(input.events ?? []);
    const mine = [], rest = [];
    for (const ev of input.events ?? []) {
      const own = (ev.type.startsWith('humanTask.') && byTask.has(ev.payload?.taskId)) || (ev.type === 'timer.fired' && ev.payload?.obligationId === RECHECK);
      (own ? mine : rest).push(ev);
    }
    for (const ev of rest) {
      const t = ev.type === 'humanTask.answered' ? solverTasks.get(`${input.instance}|${ev.payload?.taskId}`) : null;
      if (t) approvals.push({ subject: t.subject, role: t.role, user: ev.payload.user ?? null, decision: ev.payload.answer?.decision ?? null, at: now, taskId: t.id });
    }
    const J = { interventions: [], releases: [], answers: [] };
    const newTasks = [];
    // 1. The port's own events: answers, timeouts, withdrawals, rechecks.
    for (const ev of mine) {
      if (ev.type === 'timer.fired') { st.recheck = false; continue; }
      const h = byTask.get(ev.payload.taskId);
      const p = ev.payload;
      J.answers.push({ hold: h.id, taskId: p.taskId, type: ev.type, user: p.user ?? null, decision: p.answer?.decision ?? null, late: !!p.late });
      if (h.state !== 'asking') continue;
      if (ev.type === 'humanTask.answered' && p.answer?.decision === 'approve') { h.state = 'approved'; h.approvedBy = p.user; h.approvedAt = now; h.approvalTask = p.taskId; }
      else if (ev.type === 'humanTask.answered' && p.answer?.decision === 'reject') {
        h.state = 'refused'; h.decidedAt = now; for (const e of h.effects) { byKey.delete(effKey(e)); settled.set(effKey(e), 'refused'); }
        J.interventions.push({ action: 'suppress', clause: h.clause, hold: h.id, reason: 'approval rejected', keys: h.effects.map(effKey), constitution: h.pin?.hash ?? null });
      } else if (['humanTask.timeout', 'humanTask.withdrawn', 'humanTask.answerRejected'].includes(ev.type) && h.asks.at(-1).taskId === p.taskId) {
        if (h.asks.length < maxAsks) newTasks.push(ask(h, now, { role: h.asks.at(-1).role, excludeUsers: h.asks.at(-1).excludeUsers }));
        else {
          const x = h.asks.some(a => a.breakGlass) ? null : policy.escalate?.(h) ?? null;
          if (x) { newTasks.push(ask(h, now, { ...x, breakGlass: true })); J.interventions.push({ action: 'break-glass', clause: h.clause, hold: h.id, role: x.role, justification: x.justification, constitution: h.pin?.hash ?? null }); }
          else { h.state = 'abandoned'; h.decidedAt = now; for (const e of h.effects) byKey.delete(effKey(e)); J.interventions.push({ action: 'abandon', clause: h.clause, hold: h.id, reason: 'no valid approval', keys: h.effects.map(effKey), constitution: h.pin?.hash ?? null }); }
        }
      }
    }
    // 2. The solver, on the events that are its own (never on a tick that carries only the port's).
    let out;
    const solverRan = rest.length > 0 || mine.length === 0;
    if (solverRan) out = await inner.tick(rest.length === (input.events ?? []).length ? input : { ...input, events: rest }, ctx);
    else out = { decisions: { subject: st.subject }, effects: [], carry: input.carry ?? null };
    if (!isObj(out) || !isObj(out.decisions)) return out;            // invalid output: the host judges it untouched
    if (solverRan) {
      st.subject = out.decisions.subject ?? null; st.wantClose = out.close === true;
      for (const t of Array.isArray(out.humanTasks) ? out.humanTasks : []) if (isObj(t) && t.kind === APPROVAL_KIND) solverTasks.set(`${input.instance}|${t.id}`, t);
    }
    const effects = Array.isArray(out.effects) ? out.effects : [];
    // 3. Edit the solver's effects.
    const kept = [], heldHere = new Map();          // key -> hold, for holds touched by this output
    for (const e of effects) {
      if (!isObj(e)) { kept.push(e); continue; }
      const k = effKey(e);
      const open = byKey.get(k);
      if (open && open.state === 'asking') { heldHere.set(k, open); J.interventions.push({ action: 'dedupe-held', hold: open.id, key: k }); continue; }
      if (open && open.state === 'approved') { kept.push(e); continue; }                    // approved this tick: released as the solver re-emits it
      if (settled.get(k) === 'released') { kept.push(e); continue; }                       // already approved: the host deduplicates it
      if (settled.get(k) === 'refused') { J.interventions.push({ action: 'suppress', reason: 'approval was rejected', key: k }); continue; }
      const dep = (e.after && heldHere.get(e.after)) || [...heldHere.values()].find(h => e.system === 'inventory' && e.op === 'release' && e.args?.fulfilmentId === h.F);
      if (dep) {
        if (!dep.effects.some(x => effKey(x) === k)) dep.effects.push(e);
        heldHere.set(k, dep); byKey.set(k, dep);
        continue;
      }
      const O = norm(e.args?.orderId);
      const d = policy.decide(e, { now, orderId: O, order: orders.get(O) ?? null, approvals: approvals.filter(a => a.subject === e.args?.fulfilmentId || a.subject === O) });
      if (d.action !== 'hold') {
        kept.push(e);
        if (d.verified) J.interventions.push({ action: 'verified', clause: d.clause ?? 'C2', key: k, orderId: O, fulfilmentId: e.args?.fulfilmentId ?? null, amountMinor: amountOf(e), threshold: d.threshold ?? null,
          constitution: d.pin?.hash ?? null, task: d.verified.taskId, approvedBy: d.verified.user });
        continue;
      }
      const h = { id: `h${++n}`, instance: input.instance, clause: d.clause, orderId: O, F: e.args?.fulfilmentId ?? O, threshold: d.threshold, pin: d.pin ?? null,
        effects: [e], deps: [], asks: [], state: 'asking', createdAt: now, approvedBy: null, approvedAt: null, releasedAt: null };
      if (e.after) { const pred = kept.find(x => isObj(x) && x.key === e.after); if (pred) h.deps.push({ system: pred.system, key: pred.key }); }
      holds.push(h); heldHere.set(k, h); byKey.set(k, h);
      newTasks.push(ask(h, now, d.task));
      J.interventions.push({ action: 'hold', clause: d.clause, hold: h.id, key: k, system: e.system, op: e.op, orderId: O, fulfilmentId: h.F, amountMinor: amountOf(e),
        threshold: d.threshold, constitution: h.pin?.hash ?? null, version: h.pin?.version ?? null, task: newTasks.at(-1).id, role: d.task.role, excludeUsers: d.task.excludeUsers ?? [] });
    }
    // 4. Release the approved holds of this instance (their predecessors outside the group must have committed).
    const released = [];
    for (const h of holds.filter(x => x.instance === input.instance && x.state === 'approved')) {
      let wait = false;
      for (const dpd of h.deps) {
        let v = null;
        try { v = ctx.status(dpd.system, dpd.key); } catch { v = null; }
        if (v === 'pending') wait = true;
        dpd.seen = v;
      }
      if (wait) { st.recheck = true; continue; }
      const keys = new Set(h.effects.map(effKey));
      const reemitted = new Set(kept.filter(isObj).map(effKey));
      const group = h.effects.filter(e => !reemitted.has(effKey(e))).map(e => (e.after && !keys.has(e.after) ? (({ after, ...x }) => x)(e) : { ...e }));
      released.push(...group);
      h.state = 'released'; h.releasedAt = now;
      for (const e of h.effects) { byKey.delete(effKey(e)); settled.set(effKey(e), 'released'); }
      J.releases.push({ hold: h.id, clause: h.clause, keys: h.effects.map(effKey), approvedBy: h.approvedBy, approvalTask: h.approvalTask, constitution: h.pin?.hash ?? null,
        deps: h.deps.map(x => ({ key: x.key, status: x.seen ?? null })) });
    }
    // 5. Assemble the output.
    // Nothing closes while a hold is open or in the output that releases it (a retried release must not be abandoned).
    const pending = released.length > 0 || holds.some(h => h.instance === input.instance && ['asking', 'approved'].includes(h.state));
    const res = { ...out, effects: [...kept, ...released] };
    if (newTasks.length) res.humanTasks = [...(Array.isArray(out.humanTasks) ? out.humanTasks : []), ...newTasks];
    if (res.close === true && pending) { delete res.close; J.interventions.push({ action: 'close-deferred', reason: 'a hold is open' }); }
    else if (!solverRan && st.wantClose && !pending) res.close = true;
    if (out.merge && pending) J.interventions.push({ action: 'merge-with-hold', into: out.merge.into });
    if (st.recheck && pending && !res.close) {
      const ob = isObj(out.obligations) ? out.obligations : {};
      res.obligations = { upsert: [...(ob.upsert ?? []), { id: RECHECK, kind: 'ot0-recheck', anchor: null, dueAt: iso(now + 5 * MIN), onDue: null }], cancel: (ob.cancel ?? []).filter(x => x !== RECHECK) };
    }
    const pinOf = st.subject ? policy.pin?.(norm(st.subject), orders.get(norm(st.subject)) ?? null) ?? null : null;
    const any = J.interventions.length || J.releases.length || J.answers.length;
    if (policy.evidence || any) {
      // A constitution-aware solver's own evidence (its pins) is kept under `solver`; the port's pins are the run's record.
      const own = isObj(out.decisions.constitution) ? { solver: out.decisions.constitution } : {};
      res.decisions = { ...out.decisions, constitution: { ...own, port: policy.name, policy: policy.hash ?? null,
        ...(policy.evidence ? { workflow: workflowHash, pins: pinOf ? { [norm(st.subject)]: pinOf.hash } : {} } : {}),
        ...(any ? J : {}) } };
    }
    if (any || newTasks.length) log.push({ at: input.now, instance: input.instance, ...J, tasks: newTasks.map(t => t.id) });
    return res;
  }

  return { id, tick, close: () => inner.close?.(), holds, orders, log, policy: policy.name };
}
