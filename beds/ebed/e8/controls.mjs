// E8 controls (E-BED §2.9, §3 E8, §9.4, §9.6; contract §5.5, §11). $0. Each must FAIL; a control that passes means the
// oracle is too weak there. Kinds:
//   bad        echo / no-op: define the informative case-ticks; must fail every world
//   gaming     hold everything, escalate everything, declare every obligation, charge twice: must fail every world
//   necessity  the reference minus one construct class: must fail >= 50% of the relevant tail cases on attack worlds
//   oss        the literal port of the reference application (no compensation, no fraud, no processing cancel, its
//              timer races the customer at the deadline): a structure-necessity datum, reported per class
// Necessity and oss controls are the analyst-side reference policy with one construct removed (beds/ebed/oracle/
// policy.mjs `variant`); they are deliberately the strongest possible arm minus that construct.
import { runReference } from '../oracle/policy.mjs';
import { createHost } from '../host/host.mjs';
import { oracleItem, binding } from './index.mjs';
import { CARRIER_CODES } from './world.mjs';

const MIN = 60_000;
const norm = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').toUpperCase() : null);
const subjectOf = ev => norm(ev?.payload?.orderId ?? ev?.payload?.orderRef ?? null);
const meaning = (carrier, code) => CARRIER_CODES.find(c => c.carrier === carrier && c.code === code)?.meaning ?? null;
const clone = x => structuredClone(x);
const withTruth = (world, f) => { const w = clone(world); for (const t of Object.values(w.truth.cases)) f(t); return w; };
const COMP = /^(csh|rf|rel):/;
const isTimeout = (world, e) => ['R3.2', 'R2.2'].includes(e.rule) && (e.window.earliest - Date.parse(world.t0)) % MIN === 1000;

/** Standalone arms (no reference behind them). */
const standalone = {
  noop: () => ({ id: 'noop', tick: () => ({ decisions: { subject: null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: null }) }),
  echo: () => ({ id: 'echo', tick: input => {
    const s = input.carry?.subject ?? input.events.map(subjectOf).find(Boolean) ?? null;
    return { decisions: { subject: s }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: { subject: s } };
  } }),
  'declare-every-obligation': () => ({ id: 'declare-every-obligation', tick: input => {
    const s = input.carry?.subject ?? input.events.map(subjectOf).find(Boolean) ?? null;
    const now = Date.parse(input.now);
    const iso = m => `${new Date(m + 60 * MIN).toISOString().slice(0, 19)}+01:00`;
    const upsert = input.carry ? [] : Array.from({ length: 40 }, (_, i) => ({ id: `ob-${i}`, kind: 'any', anchor: null, dueAt: iso(now + (i + 1) * 30 * MIN), onDue: null }));
    return { decisions: { subject: s }, effects: [], obligations: { upsert, cancel: [] }, humanTasks: [], carry: { subject: s } };
  } }),
};

/** Variants of the reference policy (one construct removed). */
export const VARIANTS = {
  // gaming
  'hold-everything': { kind: 'gaming', variant: world => ({ armWorld: withTruth(world, t => { if (t.subject) t.verdict = 'reject'; }) }) },
  'escalate-everything': { kind: 'gaming', variant: () => ({ post: (out, { idx, c, now, iso }) => {
    const subject = out.decisions.subject;
    if (!subject || out.merge || out.close || idx.bucket(c).tasks.some(t => t.task.id === `esc:${subject}`)) return out;
    const task = { id: `esc:${subject}`, kind: 'fraudReview', role: 'fraudAnalyst', excludeUsers: [], subject, question: `Review order ${subject}`,
      answerSchema: { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'reject'] } } },
      dueAt: iso(now + 24 * 60 * MIN), onTimeout: { action: 'none' } };
    return { ...out, humanTasks: [...out.humanTasks, task] };
  } }) },
  'charge-twice': { kind: 'gaming', variant: () => ({ post: out => ({ ...out, effects: out.effects.flatMap(e => {
    if (e.system !== 'billing' || e.op !== 'charge') return [e];
    const { after, ...second } = e;
    return [e, { ...second, key: `${e.key}#2` }];
  }) }) }) },
  // necessity
  'no-compensation': { kind: 'necessity', classes: ['decline', 'collection-failed', 'cancel-processing', 'f6-carrier', 'f3-refund'], variant: () => ({ drop: e => COMP.test(e.lid) }) },
  'forward-order-compensation': { kind: 'necessity', classes: ['collection-failed', 'cancel-processing', 'f6-carrier', 'f3-refund'], variant: () => ({ post: out => {
    const comp = out.effects.filter(e => /^(csh|rf|rel):/.test(e.key ?? ''));
    if (comp.length < 2) return out;
    const rank = k => (k.startsWith('rel:') ? 0 : k.startsWith('rf:') ? 1 : 2);
    const fwd = [...comp].sort((a, b) => rank(a.key) - rank(b.key)).map(({ after, ...e }) => e);
    return { ...out, effects: [...out.effects.filter(e => !comp.includes(e)), ...fwd] };
  } }) },
  'no-keys': { kind: 'necessity', classes: ['f3-charge', 'f3-refund'], minDifficulty: 5, variant: () => ({ post: out => ({ ...out, effects: out.effects.map(({ key, after, ...e }) => (Array.isArray(e.args?.items) ? { ...e, args: { ...e.args, items: e.args.items.map(({ key: k, ...it }) => it) } } : e)) }) }) },
  'last-signal-wins': { kind: 'necessity', classes: ['ooo'], minDifficulty: 3, variant: () => ({ post: (out, { input, idx, c }) => {
    const done = new Set(idx.bucket(c).ledger.filter(r => r.committed && r.op === 'setStatus' && r.args?.status === 'completed').map(r => r.args.fulfilmentId));
    const extra = input.events.filter(ev => ev.type === 'carrier.status' && ['collected', 'inTransit'].includes(meaning(ev.payload.carrier, ev.payload.code)) && done.has(ev.payload.fulfilmentRef))
      .map(ev => ({ key: `lsw:${ev.id}`, system: 'orders', op: 'setStatus', args: { orderId: out.decisions.subject, fulfilmentId: ev.payload.fulfilmentRef, status: 'dispatched' } }));
    return extra.length ? { ...out, effects: [...out.effects, ...extra], close: undefined } : out;
  } }) },
  'timer-first': { kind: 'necessity', classes: ['timeout', 'review-timeout', 'gl-awaiting'], variant: world => ({ due: (e, d) => (isTimeout(world, e) ? e.window.earliest - 1000 : d) }) },
  'latest-edition-always': { kind: 'necessity', classes: ['edition'], minDifficulty: 4, variant: world => {
    const w = clone(world);
    const last = w.rulebook.editions.at(-1);
    w.rulebook.editions = [{ ...last, effectiveFrom: '2000-01-01', effectiveTo: null }];
    return { armWorld: w };
  } },
  'no-dedupe': { kind: 'necessity', classes: ['duplicate-order'], minDifficulty: 3, variant: () => ({ post: (out, { input, E }) => {
    if (!out.merge || !input.events.some(ev => ev.type === 'order.placed')) return out;
    const create = E.effects.required.find(e => e.op === 'create' && e.system === 'orders');
    if (!create) return out;
    const { merge, ...rest } = out;
    return { ...rest, effects: [{ key: `dup:${input.instance}`, system: 'orders', op: 'create', args: create.args }], close: true };
  } }) },
  'no-correlation': { kind: 'necessity', classes: ['amend', 'cancel-wait', 'cancel-processing', 'action-at-deadline'], variant: () => ({
    viewFilter: v => ({ ...v, events: v.events.filter(e => e.type !== 'customer.action') }),
  }) },
  // the literal port of the reference application, on the same platform profile
  'c-oss': { kind: 'oss', variant: world => ({
    armWorld: withTruth(world, t => { if (t.subject) t.verdict = 'pass'; }),
    drop: e => COMP.test(e.lid) || e.lid.startsWith('ntf:'),
    viewFilter: v => ({ ...v, events: v.events.filter(e => !(e.type === 'customer.action' && e.payload.action === 'cancel' && e.at > Date.parse(v.truth.placedAt) + 4 * 60 * MIN)) }),
    due: (e, d) => (isTimeout(world, e) ? e.window.earliest - 1000 : d),
  }) },
};

export const CONTROLS = Object.freeze([...Object.keys(standalone).map(id => ({ id, kind: id === 'declare-every-obligation' ? 'gaming' : 'bad' })), ...Object.entries(VARIANTS).map(([id, v]) => ({ id, kind: v.kind, classes: v.classes ?? null, minDifficulty: v.minDifficulty ?? 2 }))]);

/** Run one control over a world; returns the journal content rows. */
export async function runControl(id, world) {
  if (standalone[id]) {
    const host = createHost({ item: binding, world, arm: standalone[id]() });
    await host.run();
    return host.journal.contentRows();
  }
  const v = VARIANTS[id];
  if (!v) throw new Error(`unknown control ${id}`);
  const r = await runReference({ item: oracleItem, binding, world, timing: 'earliest', variant: v.variant(world), id: `control-${id}` });
  return r.rows;
}

/** Which cases a necessity control is aimed at (its class list, plus the world-feature classes 'ooo', 'edition', 'duplicate-order'). */
export function targetCases(world, id) {
  const v = VARIANTS[id];
  if (!v?.classes) return null;
  const switchMs = Date.parse('2026-03-08T00:00:00+01:00');
  return Object.entries(world.truth.cases).filter(([, t]) => {
    if (!t.subject) return false;
    if (v.classes.includes(t.class)) return true;
    if (v.classes.includes('ooo') && Object.values(t.fulfilments ?? {}).some(f => f.ooo)) return true;
    if (v.classes.includes('duplicate-order') && t.duplicateOf) return true;
    if (v.classes.includes('edition') && world.difficulty >= 4 && Math.abs(Date.parse(t.placedAt) - switchMs) < 3 * 24 * 60 * MIN) return true;
    return false;
  }).map(([c]) => c);
}
