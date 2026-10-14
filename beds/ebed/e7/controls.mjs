// E7 controls (E-BED §2.9, §9.4, §9.6; contract §5.5, §11; DESIGN.md §8). $0. Each must FAIL; a control that passes means
// the oracle is too weak there. Kinds:
//   bad        no-op / echo: must fail every world
//   gaming     declare every obligation, escalate everything (an approval task for every incident, every escalation at
//              attach), pause everything (every SLA paused at its start): must fail every world
//   necessity  the reference minus one construct: must fail >= 50% of the cases where that construct matters
// Necessity controls are the analyst-side reference policy (beds/ebed/oracle/policy.mjs `variant`) with one construct
// removed: by editing the world the arm believes (definitions, calendars, rule tables), by an analyst-only engine switch
// (`armWorld.controlFlags`, read by sla.mjs; no generated world carries it), or by a timing, filter or output hook.
// They are deliberately the strongest possible arm minus that construct.
//
// Target cases ("where the construct matters"): for a construct removed by a world edit or an engine switch, the cases
// whose expectation on the world's planned timeline (`plannedView`: every truth event of the case as planned, no arm
// involved) changes when the construct is removed; for the others, the case classes the design names.
import { runReference } from '../oracle/policy.mjs';
import { createHost } from '../host/host.mjs';
import { oracleItem, binding } from './index.mjs';
import { referenceTransition } from './transition.mjs';
import { canonical } from '../../lib/canonical.mjs';

const MIN = 60_000;
const ms = s => Date.parse(s);
const clone = x => structuredClone(x);
const norm = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').trim().toUpperCase() : null);
const subjectOf = ev => {
  const p = ev?.payload ?? {};
  if (p.reportId) return `INC-${p.reportId}`;
  if (p.alertId && p.severity !== 'warning') return `INC-${p.alertId}`;
  return norm(p.incidentRef ?? p.number ?? null);
};
const utcOf = s => new Date(ms(s)).toISOString().replace('.000Z', 'Z');
const ANSWER = { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'reject'] } } };

/** A world whose rulebook files are edited (every edition): f(name, parsed) -> new parsed value. */
function editRulebook(world, f) {
  const w = clone(world);
  for (const ed of w.rulebook.editions) for (const name of Object.keys(ed.files)) {
    const next = f(name, JSON.parse(ed.files[name]));
    if (next !== undefined) ed.files[name] = JSON.stringify(next, null, 1);
  }
  return w;
}
const editDefs = (world, f) => editRulebook(world, (name, v) => (name === 'sla-definitions.json' ? v.map(f) : undefined));
function editCalendars(world, f) { const w = clone(world); for (const [id, cal] of Object.entries(w.calendars)) w.calendars[id] = f(cal, id); return w; }
const withFlags = (world, flags) => ({ ...world, controlFlags: flags });

/** Standalone arms (no reference behind them). */
const standalone = {
  noop: () => ({ id: 'noop', tick: () => ({ decisions: { subject: null, priority: null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: null }) }),
  echo: () => ({ id: 'echo', tick: input => {
    const s = input.carry?.subject ?? input.events.map(subjectOf).find(Boolean) ?? null;
    return { decisions: { subject: s, priority: null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: { subject: s } };
  } }),
  'declare-every-obligation': () => ({ id: 'declare-every-obligation', tick: input => {
    const s = input.carry?.subject ?? input.events.map(subjectOf).find(Boolean) ?? null;
    const now = ms(input.now);
    const iso = m => `${new Date(m + 60 * MIN).toISOString().slice(0, 19)}+01:00`;
    const upsert = input.carry ? [] : Array.from({ length: 40 }, (_, i) => ({ id: `ob-${i}`, kind: 'any', anchor: null, dueAt: iso(now + (i + 1) * 30 * MIN), onDue: null }));
    return { decisions: { subject: s, priority: null }, effects: [], obligations: { upsert, cancel: [] }, humanTasks: [], carry: { subject: s } };
  } }),
};

/** Variants of the reference policy (one construct removed). `targets`: 'planned' (expectation diff) or a truth predicate. */
export const VARIANTS = {
  // gaming
  'escalate-everything': { kind: 'gaming', variant: world => ({ post: (out, { idx, c, now, iso }) => {
    const subject = out.decisions.subject;
    if (!subject || out.merge || out.close) return out;
    const extra = [];
    for (const e of out.effects) {
      if (e.system !== 'sla' || e.op !== 'start') continue;
      const mailbox = JSON.parse(world.rulebook.editions[0].files['policy.json']).incidentManagersMailbox;
      for (const percent of [50, 75, 100]) extra.push({ key: `escall:${e.key}:${percent}`, system: 'sla', op: 'escalate', after: e.key,
        args: { number: e.args.number, definition: e.args.definition, generation: e.args.generation, percent, to: mailbox } });
    }
    const tasks = idx.bucket(c).tasks.some(t => t.task.id === `escall:${subject}`) ? [] : [{ id: `escall:${subject}`, kind: 'majorIncidentApproval', role: 'incidentManager',
      excludeUsers: [], subject, question: `Declare ${subject} a major incident?`, answerSchema: ANSWER, dueAt: iso(now + 30 * MIN), onTimeout: { action: 'none' } }];
    return { ...out, effects: [...out.effects, ...extra], humanTasks: [...out.humanTasks, ...tasks] };
  } }) },
  'pause-everything': { kind: 'gaming', variant: () => ({ post: out => {
    const extra = out.effects.filter(e => e.system === 'sla' && e.op === 'start').map(e => ({ key: `pall:${e.key}`, system: 'sla', op: 'pause', after: e.key,
      args: { number: e.args.number, definition: e.args.definition, generation: e.args.generation, at: e.args.startAt } }));
    return extra.length ? { ...out, effects: [...out.effects, ...extra] } : out;
  } }) },
  // necessity: constructs inside the SLA engine (world edits and engine switches)
  '24x7-no-pause': { kind: 'necessity', targets: 'planned', variant: world => ({ armWorld: editDefs(world, d => ({ ...d, schedule: { source: 'none' }, pause: null })) }) },
  'pause-ignored': { kind: 'necessity', targets: 'planned', variant: world => ({ armWorld: editDefs(world, d => ({ ...d, pause: null })) }) },
  'breach-at-start-of-pause': { kind: 'necessity', targets: 'planned', variant: world => ({ armWorld: withFlags(world, { breachAtPlannedPause: true }) }) },
  'no-holiday': { kind: 'necessity', targets: 'planned', variant: world => ({ armWorld: editCalendars(world, cal => ({ ...cal, holidays: [] })) }) },
  'wrong-timezone': { kind: 'necessity', targets: 'planned', variant: world => ({ armWorld: editCalendars(world, cal => ({ ...cal, tz: JSON.parse(world.rulebook.editions[0].files['policy.json']).systemTimeZone })) }) },
  'no-retroactive-start': { kind: 'necessity', targets: 'planned', variant: world => ({ armWorld: editDefs(world, d => ({ ...d, start: { ...d.start, from: 'match', retroactivePause: false } })) }) },
  'no-reset': { kind: 'necessity', targets: 'planned', variant: world => ({ armWorld: editDefs(world, d => ({ ...d, reset: null })) }) },
  'edition-at-start': { kind: 'necessity', targets: 'planned', minDifficulty: 4, variant: world => ({ armWorld: withFlags(world, { editionAtStart: true }) }) },
  // R2.2 precedence: the first matching row in file order (the wildcard cells come first in the file) instead of the lowest order.
  'first-match-priority': { kind: 'necessity', targets: 'planned', variant: world => ({ armWorld: editRulebook(world, (name, v) => (name === 'priority.json' ? v.map((r, i) => ({ ...r, order: i })) : undefined)) }) },
  // necessity: constructs outside the engine (output, timing and view hooks)
  'never-escalate': { kind: 'necessity', targets: 'planned-escalations', variant: () => ({ drop: e => e.lid.startsWith('esc:') }) },
  'timer-first': { kind: 'necessity', targets: t => t.subject && (t.class === 'major-timeout' || (t.closedAt && (t.closedAt === t.caller?.replyDeadline || t.closedAt === t.caller?.confirmDeadline))),
    variant: world => ({ due: (e, d) => ((e.window.earliest - ms(world.t0)) % MIN === 1000 ? e.window.earliest - 1000 : d) }) },
  'no-dedupe': { kind: 'necessity', minDifficulty: 2, targets: t => t.subject && ((t.alerts ?? []).some(a => a.role === 'join' || a.role === 'redelivery') || (t.reports ?? []).length > 1),
    variant: () => ({ post: (out, { input, E }) => {
      const ev = input.events.find(x => (x.type === 'alert.raised' && x.payload.severity !== 'warning') || x.type === 'incident.reported');
      if (!out.merge || !ev) return out;
      const create = E.effects.required.find(e => e.system === 'itsm' && e.op === 'create');
      if (!create) return out;
      const id = ev.payload.alertId ?? ev.payload.reportId;
      const args = { ...create.args, number: `INC-${id}`, source: { kind: ev.payload.alertId ? 'alert' : 'report', id }, openedAt: utcOf(ev.at) };
      const { merge, ...rest } = out;
      return { ...rest, decisions: { subject: args.number, priority: out.decisions.priority ?? null }, effects: [{ key: `dup:${input.instance}`, system: 'itsm', op: 'create', args }], close: true };
    } }) },
  'no-correlation': { kind: 'necessity', targets: t => t.subject && !!(t.caller?.reply || t.caller?.confirm || t.caller?.withdraw),
    variant: () => ({ viewFilter: v => ({ ...v, events: v.events.filter(e => e.type !== 'caller.message') }) }) },
  'no-sod': { kind: 'necessity', minDifficulty: 3, targets: t => t.class === 'major-sod',
    variant: () => ({ post: out => (out.humanTasks.length ? { ...out, humanTasks: out.humanTasks.map(t => ({ ...t, excludeUsers: [] })) } : out) }) },
};

export const CONTROLS = Object.freeze([...Object.keys(standalone).map(id => ({ id, kind: id === 'declare-every-obligation' ? 'gaming' : 'bad' })),
  ...Object.entries(VARIANTS).map(([id, v]) => ({ id, kind: v.kind, minDifficulty: v.minDifficulty ?? 2 }))]);

/**
 * Every variant gives up an effect the systems refused (a 4xx: wrong stage, unknown record, key conflict) instead of
 * re-issuing it at every later tick until the horizon, as a sane arm would; its dependants go with it. Retryable
 * outcomes (F1 rate limits, F2 5xx) are still retried. Without this a control whose records diverged from the systems'
 * state re-emits a refused effect every minute for weeks of simulated time.
 */
function givingUp(v) {
  const refused = (idx, c, key) => idx.bucket(c).ledger.some(r => r.key === key && !r.committed && r.status === 'error' && !(Number(r.error?.code) >= 500));
  return { ...v, post: (out, info) => {
    const o = v.post ? v.post(out, info) : out;
    if (!o.effects?.length || info.c === null || info.c === undefined) return o;
    const dropped = new Set();
    const effects = [];
    for (const e of o.effects) {
      if ((e.key && refused(info.idx, info.c, e.key)) || (e.after && dropped.has(e.after))) { if (e.key) dropped.add(e.key); continue; }
      effects.push(e);
    }
    return effects.length === o.effects.length ? o : { ...o, effects };
  } };
}

/** Run one control over a world; returns the journal content rows. */
export async function runControl(id, world) {
  if (standalone[id]) {
    const host = createHost({ item: binding, world, arm: standalone[id]() });
    await host.run();
    return host.journal.contentRows();
  }
  const v = VARIANTS[id];
  if (!v) throw new Error(`unknown control ${id}`);
  const r = await runReference({ item: oracleItem, binding, world, timing: 'earliest', variant: givingUp(v.variant(world)), id: `control-${id}` });
  return r.rows;
}

/**
 * The view of a case at the horizon on the world's planned timeline (no arm): its arrivals, its planned resolver updates
 * and caller messages, the go-live migration; no tasks (an approval is neither created nor answered).
 */
export function plannedView(world, c) {
  const t = world.truth.cases[c];
  const evs = world.arrivals.filter(e => world.truth.eventCase[e.id] === c).map(e => ({ id: e.id, type: e.type, at: ms(e.at), source: e.source, payload: e.payload }));
  if (!t.backlog) {
    for (const s of t.steps ?? []) evs.push({ id: `plan-${s.k}-${s.action}-${s.at}`, type: 'resolver.update', at: ms(s.at), source: 'workspace', payload: s.payload });
    for (const m of [t.caller?.reply, t.caller?.confirm]) if (m?.via) evs.push({ id: `plan-${m.payload.intent}`, type: 'caller.message', at: ms(m.at), source: 'mail', payload: m.payload });
  } else {
    const b = world.backlog.find(x => x.case === c);
    evs.push({ id: `plan-migration-${c}`, type: 'migration', at: ms(world.t0), source: 'host', payload: { records: b.export.records, events: b.export.events } });
  }
  evs.sort((a, b) => a.at - b.at);
  const events = evs.map((e, i) => ({ ...e, seq: i, instance: 'plan', round: 1 }));
  return { case: c, at: ms(world.horizonEnd), seq: Infinity, world, truth: t, events, rows: [], tasks: [], taskEvents: [] };
}

/** What an arm is asked to do (records follow from it; a go-live case's history before t0 is not the arm's to redo). */
const shape = E => canonical({ lids: E.effects.required.map(e => [e.lid, e.match, e.window]), tasks: E.humanTasks.required.map(t => [t.lid, t.mustExclude, t.window]) });

/** Which cases a necessity control is aimed at (null for bad and gaming controls). */
export function targetCases(world, id) {
  const v = VARIANTS[id];
  if (!v || v.kind !== 'necessity') return null;
  const cases = Object.entries(world.truth.cases).filter(([, t]) => t.subject);
  if (typeof v.targets === 'function') return cases.filter(([, t]) => v.targets(t)).map(([c]) => c);
  if (v.targets === 'planned-escalations') return cases.filter(([c]) => referenceTransition(world, plannedView(world, c)).effects.required.some(e => e.lid.startsWith('esc:'))).map(([c]) => c);
  const arm = v.variant(world).armWorld;
  return cases.filter(([c]) => {
    const a = referenceTransition(world, plannedView(world, c));
    const b = referenceTransition(arm, { ...plannedView(arm, c) });
    return shape(a) !== shape(b);
  }).map(([c]) => c);
}
