// E7 reference transition (BED-CONTRACT v1.1 §5.2; DESIGN.md §6): referenceTransition(world, view) -> Expectation for one
// incident at one processing point, computed on the arm's own trajectory (on-policy). Rule ids cite spec/SPEC-E.md §4-§5.
// Oracle-side: written from the spec and the world's truth only; it imports nothing from solvers, controls or the host.
//
// The incident's history is world-determined (DESIGN §4.9): it is rebuilt from the truth events delivered so far
// (opening report or alert, joining alerts, resolver updates, caller messages, the go-live migration), the approval tasks
// the arm created and their answers, and the rule-timed changes (closure at the caller deadline D, auto-closure at D2,
// the fail-safe major declaration) once their deadline has passed. The SLA clock is a pure function of that history
// (sla.mjs). Effects the history does not yet decide are projected from what is known (an SLA's planned breach and
// thresholds while it runs, the closure at a pending deadline, the fail-safe at a pending approval deadline) and are
// withdrawn when a later event supersedes them before they were due (E8's convention).
//
// Logical effect ids (lids) are functions of rule and business keys only (N the incident number, k the assignment
// ordinal, <t> a record instant in canonical UTC, S = N/DEF/generation an SLA record id):
//   create:N  asg:N:k  ntf:N:assignment:k  acc:N:<t>  hold:N:<t>  res:N:<t>  rcl:N:<t>  rsv:N  lnk:N:<alertId>
//   cls:N:<reason>  cnc:N  maj:N:approved|declared  ntf:N:<template>  sla:S:start|stop|cancel|breach
//   sla:S:pause:<t>  sla:S:resume:<t>  esc:S:<percent>;  human task mia:N
import { slaTimeline, boundCalendar } from './sla.mjs';
import { addBusinessMs } from '../lib/calendar.mjs';
import { localDate } from '../lib/time.mjs';

const MIN = 60_000;
const SEC = 1_000;
const ms = s => Date.parse(s);
/** An instant in canonical UTC (SPEC §1: instants are compared as instants, whatever offset they are written in). */
export const utc = m => (m === null || m === undefined ? null : new Date(m).toISOString().replace('.000Z', 'Z'));
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const INSTANT_ARGS = Object.freeze(['at', 'startAt', 'openedAt', 'plannedBreachAt']);
const ENDED = new Set(['resolved', 'closed', 'cancelled']);
const norm = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').trim().toUpperCase() : null);
const cmp = (a, b) => a.at - b.at || a.seq - b.seq;
const KIND = 'majorIncidentApproval', ROLE = 'incidentManager';

/** The item's argument normaliser: every instant-valued argument in canonical UTC; nothing else (DESIGN §7.1). */
export function canonicalArgs(system, op, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  let out = args;
  for (const k of INSTANT_ARGS) {
    const v = args[k];
    if (typeof v !== 'string' || !ISO.test(v)) continue;
    const m = Date.parse(v);
    if (!Number.isFinite(m)) continue;
    if (out === args) out = { ...args };
    out[k] = utc(m);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The world as the rules read it (cached per world object): editions with parsed files, master-data lookups.
const CACHE = new WeakMap();
function rulesOf(world) {
  let r = CACHE.get(world);
  if (r) return r;
  const eds = [...world.rulebook.editions].map(e => ({ id: e.id, effectiveFrom: e.effectiveFrom, published: e.published ?? null,
    priority: JSON.parse(e.files['priority.json']), assignment: JSON.parse(e.files['assignment.json']), alertUrgency: JSON.parse(e.files['alert-urgency.json']),
    policy: JSON.parse(e.files['policy.json']), defs: JSON.parse(e.files['sla-definitions.json']) }))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
  const systemTz = eds[0].policy.systemTimeZone;
  const by = (rows, k) => new Map(rows.map(x => [x[k], x]));
  const cis = by(world.master.cis, 'ci');
  const ciNames = new Map();
  for (const c of world.master.cis) for (const n of [c.ci, c.name, ...(c.aliases ?? [])]) ciNames.set(String(n).trim().toLowerCase(), c);
  r = { eds, systemTz, cis, ciNames, services: by(world.master.services, 'service'), groups: by(world.master.groups, 'group'), users: by(world.master.users, 'userId'),
    slaMemo: new Map() };
  CACHE.set(world, r);
  return r;
}

/** R0: the edition in force at an instant (the latest effectiveFrom on or before its date in the system time zone). */
export function editionAt(world, atMs) {
  const R = rulesOf(world);
  const date = localDate(atMs, R.systemTz);
  let ed = null;
  for (const e of R.eds) if (e.effectiveFrom <= date) ed = e;
  if (!ed) throw new Error(`no edition in force on ${date}`);
  return ed;
}

/** R2.2: the row with the lowest `order` among those matching (service or '*', impact, urgency). */
export function priorityAt(world, atMs, service, impact, urgency) {
  const rows = editionAt(world, atMs).priority.filter(x => x.impact === impact && x.urgency === urgency && (x.service === '*' || x.service === service));
  if (!rows.length) throw new Error(`no priority row for ${service} ${impact}/${urgency}`);
  return rows.reduce((a, b) => (b.order < a.order ? b : a)).priority;
}

/** R3.1: the assignment group at intake (lowest `order` among rows matching category and region). */
export function groupAt(world, atMs, category, region, ci) {
  const rows = editionAt(world, atMs).assignment.filter(x => (x.category === '*' || x.category === category) && (x.region === '*' || x.region === region));
  if (!rows.length) throw new Error(`no assignment row for ${category}/${region}`);
  const g = rows.reduce((a, b) => (b.order < a.order ? b : a)).group;
  return g === 'ciSupportGroup' ? ci.supportGroup : g;
}

/** B (R6): the instant at which business time of the service desk calendar since `from` reaches `days` business days. */
export function businessDaysAfter(world, fromMs, field) {
  const R = rulesOf(world);
  const pol = editionAt(world, fromMs).policy;
  const cal = boundCalendar(world, pol.serviceDeskCalendar, world.calendars[pol.serviceDeskCalendar].tz ?? R.systemTz);
  return addBusinessMs(cal, fromMs, pol[field] * pol.businessDayMinutes * MIN);
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * referenceTransition(world, view) -> { case, at, decisions: { graded }, effects: { required, permitted }, humanTasks:
 * { required, permitted }, terminal, end?, records? }. Windows are { earliest, latest } in epoch ms.
 */
export function referenceTransition(world, view) {
  const t = view.truth;
  if (!t) throw new Error(`no truth for case ${view.case}`);
  if (t.subject === null) {
    // A warning alert or a caller message naming no incident (R1.2, §3.3): no effect; `unknown-incident` to the sender
    // of a message is allowed (S9).
    const permitted = t.from ? [{ rule: '§3.3', system: 'notify', op: 'send', match: { to: t.from, template: 'unknown-incident' } }] : [];
    return { case: view.case, at: view.at, decisions: { graded: { subject: null, priority: null } }, effects: { required: [], permitted },
      humanTasks: { required: [], permitted: [] }, terminal: true, end: { status: 'invalid', at: ms(t.start) }, records: null };
  }
  return incidentExpectation(world, view, t, world.controlFlags ?? {});
}

/**
 * historyOf(world, view) -> the incident's simulated history on this trajectory: { inc, changes, notices, approval,
 * pending, lids (incident-level) } (the analyst's timeline tool prints it).
 */
export function historyOf(world, view) {
  const t = view.truth;
  if (!t || t.subject === null) return null;
  return simulate(world, view, t);
}

function simulate(world, view, t) {
  const R = rulesOf(world);
  const N = t.subject;
  const now = view.at;
  const t0 = ms(world.t0);
  const backlog = !!t.backlog;
  const inc = { number: N, opened: false, openedAt: null, source: null, callerId: null, ci: null, check: null, service: null, category: null, impact: null, urgency: null,
    priority: null, state: null, holdReason: null, group: null, k: 0, assignee: null, resolvedAt: null, closeCode: null, closedAt: null, closeReason: null,
    cancelledAt: null, major: false, majorAt: null, alerts: [], openAlert: null, caller: null, ciRow: null };
  const changes = [];          // { at, seq, deadline: null | latest-minutes } with fields after the change
  const lids = [];             // incident-level lids in chronological order: { id, rule, system, op, match, args, at, deadline }
  const notices = [];          // every notice the rules ask for: { template, to, at }
  const seen = new Set();      // report and alert ids already received (R1.4)
  let priorityChangeAt = null;
  const pend = { caller: null, resolved: null, approval: null };
  const appr = { x: null, first: null, dl: null, taskKeys: new Set(), answer: null, moot: null, declared: null };

  const fields = () => ({ priority: inc.priority, impact: inc.impact, urgency: inc.urgency, state: inc.state, holdReason: inc.holdReason,
    source: inc.source?.kind ?? null, service: inc.service, assignmentGroup: inc.group, major: inc.major });
  const change = (at, seq, deadline = null) => changes.push({ at, seq, deadline, fields: fields(), group: inc.group });
  const lid = (id, rule, system, op, match, at, { deadline = null, args = {} } = {}) => lids.push({ id, rule, system, op, match, args: { ...match, ...args }, at, deadline });
  const notice = (template, to, at, rule, deadline = null) => {
    if (!to) return;
    const id = template === 'assignment' ? `ntf:${N}:assignment:${inc.k}` : `ntf:${N}:${template}`;
    notices.push({ template, to, at });
    lid(id, rule, 'notify', 'send', { to, about: N, template }, at, { deadline, args: { text: `${template}: ${N}`, ref: null } });
  };
  const policy = at => editionAt(world, at).policy;
  /** After a classification change at `at` (R2): R7.1 starts when the priority first becomes 1. */
  const setPriority = (at, before) => {
    if (inc.priority === 1 && appr.x === null) appr.x = at;
    if (before !== null && before !== inc.priority) priorityChangeAt = at;
  };
  const checkMoot = (at) => {
    if (appr.x === null || appr.answer || appr.moot !== null || appr.declared !== null) return;
    if (appr.dl !== null && at >= appr.dl) return;
    if (ENDED.has(inc.state) || inc.priority !== 1) appr.moot = at;
  };

  // ---- the opening (R1.1, R1.2, R2, R3.1) ---------------------------------------------------------------------------
  function open(e) {
    const p = e.at, pl = e.payload;
    const isAlert = e.type === 'alert.raised';
    const sourceId = isAlert ? pl.alertId : pl.reportId;
    if (`INC-${sourceId}` !== N) throw new Error(`case ${view.case}: opening ${e.type} ${sourceId} is not incident ${N}`);
    const ci = isAlert ? R.cis.get(pl.ci) : R.ciNames.get(String(pl.ci).trim().toLowerCase());
    if (!ci) throw new Error(`case ${view.case}: unknown CI ${pl.ci}`);
    const svc = R.services.get(ci.service);
    const caller = isAlert ? null : R.users.get(pl.callerId);
    const urgency = isAlert ? editionAt(world, p).alertUrgency[pl.severity] : pl.urgency;
    const category = isAlert ? 'monitoring' : pl.category;
    Object.assign(inc, { opened: true, openedAt: p, source: { kind: isAlert ? 'alert' : 'report', id: sourceId }, callerId: caller?.userId ?? null, caller, ci: ci.ci, ciRow: ci,
      check: isAlert ? pl.check : null, service: svc.service, category, impact: svc.impact, urgency, priority: priorityAt(world, p, svc.service, svc.impact, urgency),
      state: 'assigned', group: groupAt(world, p, category, isAlert ? ci.region : caller.region, ci), k: 1, openAlert: isAlert ? sourceId : null });
    seen.add(sourceId);
    lid(`create:${N}`, isAlert ? 'R1.2' : 'R1.1', 'itsm', 'create', { number: N, source: { ...inc.source }, callerId: inc.callerId, ci: inc.ci, check: inc.check, service: inc.service,
      category, impact: inc.impact, urgency, priority: inc.priority, openedAt: utc(p) }, p, { args: { summary: isAlert ? `${pl.severity} ${pl.check} on ${ci.ci}` : String(pl.summary ?? '') } });
    lid(`asg:${N}:1`, 'R3.1', 'itsm', 'assign', { number: N, group: inc.group, at: utc(p) }, p, { args: { ref: `ref-asg:${N}:1` } });
    notice('assignment', R.groups.get(inc.group).mailbox, p, 'R3.1');
    setPriority(p, null);
    change(p, e.seq);
  }
  /** Go-live (§3.6): the migrated incident record and the messages received before t0, replayed as its history. */
  function migrate(e) {
    const rec = (e.payload.records?.['itsm.incidents'] ?? []).find(x => x.number === N);
    if (!rec) throw new Error(`case ${view.case}: migration without incident ${N}`);
    const pre = [...(e.payload.events ?? [])].map((x, i) => ({ ...x, at: ms(x.at), seq: e.seq - 1 + (i + 1) / 1000 }));
    const rep = pre.find(x => x.type === 'incident.reported' || x.type === 'alert.raised');
    open(rep);
    if (inc.priority !== rec.priority || inc.group !== rec.assignmentGroup || inc.openedAt !== ms(rec.openedAt)) throw new Error(`case ${view.case}: migrated record disagrees with the rules`);
    for (const x of pre) if (x !== rep) handle(x);
  }

  // ---- one inbound event --------------------------------------------------------------------------------------------
  function handle(e) {
    const at = e.at, pl = e.payload ?? {};
    switch (e.type) {
      case 'migration': return migrate(e);
      case 'incident.reported': {
        if (!inc.opened) return open(e);
        if (seen.has(pl.reportId)) return;                                         // R1.4 a repeated delivery
        throw new Error(`case ${view.case}: a second report ${pl.reportId} in one incident`);
      }
      case 'alert.raised': {
        const u = editionAt(world, at).alertUrgency[pl.severity];
        if (u === null || u === undefined) return;                                // R1.2 warning: nothing
        if (!inc.opened) return open(e);
        if (seen.has(pl.alertId)) return;                                         // R1.4
        if (inc.source.kind !== 'alert' || pl.ci !== inc.ci || pl.check !== inc.check || ENDED.has(inc.state)) throw new Error(`case ${view.case}: alert ${pl.alertId} does not join ${N}`);
        seen.add(pl.alertId);
        inc.alerts.push(pl.alertId);
        lid(`lnk:${N}:${pl.alertId}`, 'R1.3', 'itsm', 'linkAlert', { number: N, alertId: pl.alertId }, at);
        if (u < inc.urgency) {                                                    // R1.3 -> R2.3
          const before = inc.priority;
          inc.urgency = u;
          inc.priority = priorityAt(world, at, inc.service, inc.impact, u);
          lid(`rcl:${N}:${utc(at)}`, 'R1.3', 'itsm', 'reclassify', { number: N, impact: inc.impact, urgency: u, priority: inc.priority, at: utc(at) }, at);
          setPriority(at, before);
          checkMoot(at);
          change(at, e.seq);
        }
        return;
      }
      case 'resolver.update': {
        if (!inc.opened || ENDED.has(inc.state)) return;                          // R3.3
        if (norm(pl.number) !== N) throw new Error(`case ${view.case}: resolver update for ${pl.number}`);
        const T = utc(at);
        switch (pl.action) {
          case 'accept':
            inc.assignee = pl.user; inc.state = 'inProgress'; inc.holdReason = null;
            lid(`acc:${N}:${T}`, 'R3.2', 'itsm', 'accept', { number: N, user: pl.user, at: T }, at);
            break;
          case 'hold':
            inc.state = 'onHold'; inc.holdReason = pl.holdReason;
            lid(`hold:${N}:${T}`, 'R3.2', 'itsm', 'hold', { number: N, reason: pl.holdReason, at: T }, at);
            if (pl.holdReason === 'awaitingCaller') {                             // R6.1
              notice('awaiting-caller', inc.caller?.email ?? null, at, 'R6.1');
              pend.caller = { h: at, D: businessDaysAfter(world, at, 'callerReplyDays') };
            }
            break;
          case 'resume':
            inc.state = 'inProgress'; inc.holdReason = null; pend.caller = null;
            lid(`res:${N}:${T}`, 'R3.2', 'itsm', 'resume', { number: N, at: T }, at);
            break;
          case 'reassign':
            inc.group = pl.toGroup; inc.k += 1; inc.state = 'assigned'; inc.assignee = null; inc.holdReason = null; pend.caller = null;      // S7
            lid(`asg:${N}:${inc.k}`, 'R3.2', 'itsm', 'assign', { number: N, group: inc.group, at: T }, at, { args: { ref: `ref-asg:${N}:${inc.k}` } });
            notice('assignment', R.groups.get(inc.group)?.mailbox ?? null, at, 'R3.2');
            break;
          case 'reclassify': {
            const impact = pl.impact ?? inc.impact, urgency = pl.urgency ?? inc.urgency;
            const priority = priorityAt(world, at, inc.service, impact, urgency);
            if (impact === inc.impact && urgency === inc.urgency && priority === inc.priority) return;     // R2.3: nothing changes
            const before = inc.priority;
            Object.assign(inc, { impact, urgency, priority });
            lid(`rcl:${N}:${T}`, 'R2.3', 'itsm', 'reclassify', { number: N, impact, urgency, priority, at: T }, at);
            setPriority(at, before);
            break;
          }
          case 'resolve':
            inc.state = 'resolved'; inc.holdReason = null; inc.resolvedAt = at; inc.closeCode = pl.closeCode; pend.caller = null;
            lid(`rsv:${N}`, 'R3.2', 'itsm', 'resolve', { number: N, closeCode: pl.closeCode, at: T }, at);
            notice('resolved', inc.caller?.email ?? null, at, 'R6.4');
            pend.resolved = { r: at, D2: businessDaysAfter(world, at, 'resolvedCloseDays') };
            break;
          default: throw new Error(`case ${view.case}: unknown resolver action ${pl.action}`);
        }
        checkMoot(at);
        change(at, e.seq);
        return;
      }
      case 'caller.message': {
        if (!inc.opened) return;
        if (norm(pl.incidentRef) !== N) throw new Error(`case ${view.case}: caller message about ${pl.incidentRef}`);
        const T = utc(at);
        if (pl.intent === 'reply') {                                              // R6.2
          if (!(inc.state === 'onHold' && inc.holdReason === 'awaitingCaller' && pend.caller && at <= pend.caller.D)) return;
          inc.state = 'inProgress'; inc.holdReason = null; pend.caller = null;
          lid(`res:${N}:${T}`, 'R6.2', 'itsm', 'resume', { number: N, at: T }, at);
        } else if (pl.intent === 'confirm') {                                     // R6.5
          if (!(inc.state === 'resolved' && pend.resolved && at <= pend.resolved.D2)) return;
          inc.state = 'closed'; inc.closedAt = at; inc.closeReason = 'confirmed'; pend.resolved = null;
          lid(`cls:${N}:confirmed`, 'R6.5', 'itsm', 'close', { number: N, reason: 'confirmed', at: T }, at);
        } else if (pl.intent === 'withdraw') {                                    // R6.6
          if (ENDED.has(inc.state)) return;
          inc.state = 'cancelled'; inc.cancelledAt = at; inc.holdReason = null; pend.caller = null; pend.resolved = null;
          lid(`cnc:${N}`, 'R6.6', 'itsm', 'cancel', { number: N, at: T }, at);
          notice('incident-cancelled', inc.caller?.email ?? null, at, 'R6.6');
        } else return;
        checkMoot(at);
        change(at, e.seq);
        return;
      }
      default: return;
    }
  }

  // ---- approvals (R7): tasks and answers as they happened on this trajectory -----------------------------------------
  function task(x) {
    if (appr.x === null || x.at < appr.x || appr.moot !== null) return;
    appr.taskKeys.add(`${x.instance}\u0000${x.task.id}`);
    if (appr.first) return;
    appr.first = x;
    appr.dl = x.at + policy(x.at).majorApprovalMinutes * MIN;
  }
  function answer(a) {
    if (!appr.first || appr.answer || appr.moot !== null || appr.declared !== null) return;
    if (!appr.taskKeys.has(`${a.instance}\u0000${a.payload?.taskId}`) || a.at > appr.dl) return;
    const d = a.payload?.answer?.decision;
    if (d !== 'approve' && d !== 'reject') return;                               // R7.2: only an answer with `decision` counts
    appr.answer = { at: a.at, decision: d };
    if (d === 'approve') {
      inc.major = true; inc.majorAt = a.at;
      lid(`maj:${N}:approved`, 'R7.2', 'itsm', 'setMajor', { number: N, at: utc(a.at) }, a.at);
      notice('major-incident', R.services.get(inc.service).owner, a.at, 'R7.2');
      change(a.at, a.seq);
    }
  }

  // ---- deadlines (S1, S10): taken strictly after, dated at the deadline, once passed on this trajectory ---------------
  const deadlines = () => [
    pend.caller && inc.state === 'onHold' && inc.holdReason === 'awaitingCaller' && { at: pend.caller.D, kind: 'caller' },
    pend.resolved && inc.state === 'resolved' && { at: pend.resolved.D2, kind: 'resolved' },
    appr.first && !appr.answer && appr.moot === null && appr.declared === null && { at: appr.dl, kind: 'approval' },
  ].filter(Boolean).sort((a, b) => a.at - b.at);
  function fire(d) {
    const D = d.at;
    if (d.kind === 'caller') {                                                    // R6.3
      pend.caller = null;
      inc.state = 'closed'; inc.closedAt = D; inc.closeReason = 'no-caller-response';
      lid(`cls:${N}:no-caller-response`, 'R6.3', 'itsm', 'close', { number: N, reason: 'no-caller-response', at: utc(D) }, D, { deadline: 60 });
      notice('closed-no-response', inc.caller?.email ?? null, D, 'R6.3', 60);
      checkMoot(D);
      change(D, Infinity, 60);
    } else if (d.kind === 'resolved') {                                           // R6.5
      pend.resolved = null;
      inc.state = 'closed'; inc.closedAt = D; inc.closeReason = 'auto';
      lid(`cls:${N}:auto`, 'R6.5', 'itsm', 'close', { number: N, reason: 'auto', at: utc(D) }, D, { deadline: 60 });
      change(D, Infinity, 60);
    } else {                                                                      // R7.2 fail-safe
      appr.declared = D;
      inc.major = true; inc.majorAt = D;
      lid(`maj:${N}:declared`, 'R7.2', 'itsm', 'setMajor', { number: N, at: utc(D) }, D, { deadline: 15 });
      notice('major-incident', R.services.get(inc.service).owner, D, 'R7.2', 15);
      change(D, Infinity, 15);
    }
  }
  const fireBefore = limit => { for (let ds = deadlines(); ds.length && ds[0].at < limit && ds[0].at < now; ds = deadlines()) fire(ds[0]); };

  const tasks = view.tasks.filter(x => x.task?.kind === KIND);
  const occ = [
    ...view.events.map(e => ({ kind: 'event', at: e.at, seq: e.seq, e })),
    ...tasks.map(x => ({ kind: 'task', at: x.at, seq: x.seq, x })),
    ...view.taskEvents.filter(e => e.type === 'humanTask.answered').map(a => ({ kind: 'answer', at: a.at, seq: a.seq, a })),
  ].sort(cmp);
  for (const o of occ) {
    fireBefore(o.at);
    if (o.kind === 'event') handle(o.e);
    else if (o.kind === 'task') task(o.x);
    else answer(o.a);
  }
  fireBefore(Infinity);
  return { inc, changes, lids, notices, pend, appr, deadlines: deadlines(), priorityChangeAt, backlog, t0 };
}

// ---------------------------------------------------------------------------------------------------------------------

function incidentExpectation(world, view, t, flags) {
  const R = rulesOf(world);
  const c = view.case, at = view.at;
  const N = t.subject;
  const H = simulate(world, view, t);
  const { inc } = H;
  const required = [], permitted = [], tasksReq = [], tasksPerm = [];
  const out = (terminal, end, records) => {
    const graded = { subject: N };
    // The priority after this tick's events (§1); not graded at the very instant a later event changed it (a call at that
    // instant may not have been given the event: it starts its own instance and is merged in a later round).
    if (H.priorityChangeAt === null || H.priorityChangeAt !== at) graded.priority = inc.priority;
    return { case: c, at, decisions: { graded }, effects: { required, permitted }, humanTasks: { required: tasksReq, permitted: tasksPerm }, terminal, end, records };
  };
  if (!inc.opened) return out(false, null, null);

  // Windows: [x, x + 15 min] for an event's records; (D, D + L] for a change taken after a deadline (S10, R4.5).
  const winOf = (x, deadline) => (deadline ? { earliest: x + SEC, latest: x + deadline * MIN } : { earliest: x, latest: x + 15 * MIN });
  const instants = new Map();
  for (const ch of H.changes) {
    const w = instants.get(ch.at) ?? { normal: false, L: 0 };
    if (ch.deadline) w.L = Math.max(w.L, ch.deadline); else w.normal = true;
    instants.set(ch.at, w);
  }
  const winAt = x => {
    const w = instants.get(x);
    if (!w || (w.normal && !w.L)) return winOf(x, null);
    if (!w.normal) return winOf(x, w.L);
    return { earliest: x, latest: x + Math.max(15, w.L) * MIN };               // an event and a deadline change in one instant
  };
  const pre = x => H.backlog && x < H.t0;                                       // go-live: already recorded in the export
  const named = new Set();
  const push = (id, rule, system, op, match, args, window, after = []) => {
    const e = { lid: id, rule, system, op, match, args: { ...match, ...args }, window: { earliest: window.earliest, latest: Math.max(window.earliest, window.latest) } };
    const a = after.filter(p => named.has(p));
    if (a.length) e.after = a;
    const prior = required.findIndex(x => x.lid === id);
    if (prior >= 0) required.splice(prior, 1);
    required.push(e);
    named.add(id);
    return e;
  };
  const createLid = `create:${N}`;

  // Incident records and notices (R1-R3, R6, R7), in the order they happened.
  for (const l of H.lids) {
    if (pre(l.at)) continue;
    const w = l.id === createLid ? { earliest: l.at, latest: l.at } : winOf(l.at, l.deadline);
    push(l.id, l.rule, l.system, l.op, l.match, l.args, w, l.id === createLid ? [] : [createLid]);
  }
  // Projections: a pending closure or fail-safe declaration is due strictly after its deadline unless superseded first.
  const owner = R.services.get(inc.service)?.owner ?? null;
  for (const d of H.deadlines) {
    if (d.kind === 'caller') {
      push(`cls:${N}:no-caller-response`, 'R6.3', 'itsm', 'close', { number: N, reason: 'no-caller-response', at: utc(d.at) }, {}, winOf(d.at, 60), [createLid]);
      if (inc.caller) push(`ntf:${N}:closed-no-response`, 'R6.3', 'notify', 'send', { to: inc.caller.email, about: N, template: 'closed-no-response' }, { text: `closed-no-response: ${N}`, ref: null }, winOf(d.at, 60), [createLid]);
    } else if (d.kind === 'resolved') {
      push(`cls:${N}:auto`, 'R6.5', 'itsm', 'close', { number: N, reason: 'auto', at: utc(d.at) }, {}, winOf(d.at, 60), [createLid]);
    } else {
      push(`maj:${N}:declared`, 'R7.2', 'itsm', 'setMajor', { number: N, at: utc(d.at) }, {}, winOf(d.at, 15), [createLid]);
      if (owner) push(`ntf:${N}:major-incident`, 'R7.2', 'notify', 'send', { to: owner, about: N, template: 'major-incident' }, { text: `major-incident: ${N}`, ref: null }, winOf(d.at, 15), [createLid]);
    }
  }

  // R7.1 the approval task; S11: no longer required once moot before it was created; re-asks allowed until the deadline.
  const A = H.appr;
  if (A.x !== null) {
    if (A.moot !== null && (!A.first || A.first.at > A.moot)) {
      tasksPerm.push({ rule: 'S11', kind: KIND, role: ROLE, window: { earliest: A.x, latest: A.moot } });
    } else if (!pre(A.x)) {
      tasksReq.push({ lid: `mia:${N}`, rule: 'R7.1', kind: KIND, role: ROLE, mustExclude: inc.callerId ? [inc.callerId] : [], window: { earliest: A.x, latest: A.x + 15 * MIN } });
    }
    if (A.first && !A.answer && A.moot === null && A.declared === null) tasksPerm.push({ rule: 'R7.2', kind: KIND, role: ROLE, window: { earliest: A.first.at, latest: A.dl } });
  }

  // R4-R5 the SLA engine.
  const slas = slaTimelineOf(world, view.case, H, flags);
  const groupAtInstant = x => { let g = H.changes[0]?.group ?? inc.group; for (const ch of H.changes) { if (ch.at > x) break; g = ch.group; } return g; };
  const recipient = (notify, x) => {
    const g = R.groups.get(groupAtInstant(x));
    if (notify === 'group') return g?.mailbox ?? null;
    if (notify === 'groupManager') return g?.managerEmail ?? null;
    return editionAt(world, x).policy.incidentManagersMailbox;
  };
  const escalations = [];
  for (const s of slas) {
    const base = { number: N, definition: s.definition, generation: s.generation };
    const L = op => `sla:${s.id}:${op}`;
    const x = s.attachAt;
    let prev = createLid;
    const step = (id, op, match, window, extraAfter = []) => {
      if (!window) { prev = named.has(id) ? id : prev; return; }
      push(id, 'R4.5', 'sla', op, match, {}, window, [prev, ...extraAfter]);
      prev = id;
    };
    // Breach (R4.6): reached by the end, while paused before the pause, or projected while running.
    const breachAnchor = s.D === null ? null : Math.max(s.D, x);
    const breachWin = s.D === null || pre(breachAnchor) ? null : s.D <= x ? winAt(x) : winOf(s.D, null);
    let startId = null;
    for (const o of s.ops) {
      const W = pre(o.x) ? null : winAt(o.x);
      if (o.op === 'start') {
        step(L('start'), 'start', { ...base, startAt: utc(s.startAt), schedule: s.schedule, timezone: s.timezone, plannedBreachAt: utc(s.planned.start) }, W);
        startId = L('start');
      } else if (o.op === 'pause') step(L(`pause:${utc(o.at)}`), 'pause', { ...base, at: utc(o.at) }, W);
      else if (o.op === 'resume') step(L(`resume:${utc(o.at)}`), 'resume', { ...base, at: utc(o.at), plannedBreachAt: utc(s.planned.resumes.get(o.at)) }, W);
      else {
        // The breach record comes before the stop or cancel that ends the SLA (the sla system refuses a breach after it).
        if (breachWin) push(L('breach'), 'R4.6', 'sla', 'breach', { ...base, at: utc(s.D) }, {}, breachWin, [startId ?? createLid]);
        if (o.op === 'stop') step(L('stop'), 'stop', { ...base, at: utc(o.at), elapsedMinutes: s.elapsedMinutes, businessElapsedMinutes: s.businessElapsedMinutes, breached: s.breached }, W, [L('breach')]);
        else step(L('cancel'), 'cancel', { ...base, at: utc(o.at), reason: o.reason }, W, [L('breach')]);
      }
    }
    if (!s.end && breachWin) push(L('breach'), 'R4.6', 'sla', 'breach', { ...base, at: utc(s.D) }, {}, breachWin, [startId ?? createLid]);
    // Escalations (R5): each threshold reached, from the attach when it was reached before it (S12).
    for (const th of s.thresholds) {
      if (th.at === null) continue;
      const anchor = Math.max(th.at, x);
      const to = recipient(th.notify, anchor);
      escalations.push(`${s.id}/${th.percent} ${to}`);
      if (pre(anchor)) continue;
      push(`esc:${s.id}:${th.percent}`, 'R5.1', 'sla', 'escalate', { ...base, percent: th.percent, to }, {}, th.at <= x ? winAt(x) : winOf(th.at, null), [startId ?? createLid]);
    }
  }

  // R8 records once the incident is closed or cancelled.
  const terminal = inc.state === 'closed' || inc.state === 'cancelled';
  if (!terminal) return out(false, null, null);
  const end = { status: inc.state, at: inc.state === 'closed' ? inc.closedAt : inc.cancelledAt };
  const records = {
    incident: { number: N, state: inc.state, priority: inc.priority, impact: inc.impact, urgency: inc.urgency, group: inc.group, assignee: inc.assignee,
      openedAt: utc(inc.openedAt), resolvedAt: utc(inc.resolvedAt), closeCode: inc.closeCode, closedAt: utc(inc.closedAt), closeReason: inc.closeReason,
      cancelledAt: utc(inc.cancelledAt), major: inc.major, majorAt: utc(inc.majorAt), alerts: [...inc.alerts].sort() },
    slas: Object.fromEntries(slas.map(s => [s.id, slaRecordOf(s)])),
    escalations: escalations.sort(),
    notifications: H.notices.map(n => `${n.template} ${n.to}`).sort(),
  };
  return out(true, end, records);
}

/** The expected SLA record (R8.1) of an SLA from its timeline. */
function slaRecordOf(s) {
  const pauses = [];
  for (const o of s.ops) {
    if (o.op === 'pause') pauses.push({ from: utc(o.at), to: null });
    else if ((o.op === 'resume' || o.op === 'stop' || o.op === 'cancel') && pauses.length && pauses.at(-1).to === null) pauses.at(-1).to = utc(o.at);
  }
  return { stage: s.stage, startAt: utc(s.startAt), schedule: s.schedule, timezone: s.timezone, pauses, breached: s.breached, breachAt: s.breached ? utc(s.D) : null,
    endAt: utc(s.end?.at ?? null), elapsedMinutes: s.elapsedMinutes, businessElapsedMinutes: s.businessElapsedMinutes, cancelReason: s.end?.op === 'cancel' ? s.end.reason : null };
}

/** The SLA timeline of a history, memoised per (world, case, snapshots, flags): the grader re-evaluates at every point. */
function slaTimelineOf(world, c, H, flags) {
  const R = rulesOf(world);
  const snaps = [];
  for (const ch of H.changes) {
    if (snaps.length && snaps.at(-1).at === ch.at) snaps[snaps.length - 1] = { at: ch.at, fields: ch.fields };
    else snaps.push({ at: ch.at, fields: ch.fields });
  }
  const key = `${c}|${JSON.stringify(flags)}|${snaps.map(s => `${s.at}:${Object.values(s.fields).join(',')}`).join(';')}`;
  let memo = R.slaMemo.get(c);
  if (!memo) { memo = new Map(); R.slaMemo.set(c, memo); }
  if (memo.has(key)) return memo.get(key);
  const ctx = { world, defsAt: x => editionAt(world, x).defs, scheduleOf: { service: id => R.services.get(id).supportSchedule, group: id => R.groups.get(id).schedule } };
  const inc = { number: H.inc.number, openedAt: H.inc.openedAt, callerTz: H.inc.caller?.timezone ?? null, ciTz: H.inc.ciRow?.timezone ?? null };
  const out = slaTimeline(ctx, inc, snaps, { flags });
  if (memo.size > 64) memo.delete(memo.keys().next().value);
  memo.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The arm's business records for one case at the end of its trajectory (layer 5): the incident, its SLAs, escalations
 * and notifications, from the go-live export and the arm's committed rows in journal order, with the mocks' semantics
 * (systems.mjs). Same shape as the expectation's `records`.
 */
export function recordsOf(world, idx, c) {
  const t = world.truth.cases[c];
  if (!t || t.subject === null) return null;
  const N = t.subject;
  const I = v => (typeof v === 'string' && ISO.test(v) && Number.isFinite(Date.parse(v)) ? utc(Date.parse(v)) : v ?? null);
  const rec = { incident: null, slas: {}, escalations: [], notifications: [] };
  const incRow = r => ({ number: r.number, state: r.state, priority: r.priority, impact: r.impact, urgency: r.urgency, group: r.assignmentGroup ?? null, assignee: r.assignedTo ?? null,
    openedAt: I(r.openedAt), resolvedAt: I(r.resolvedAt), closeCode: r.closeCode ?? null, closedAt: I(r.closedAt), closeReason: r.closeReason ?? null,
    cancelledAt: I(r.cancelledAt), major: !!r.major, majorAt: I(r.majorAt), alerts: [...(r.alerts ?? [])] });
  const b = world.backlog?.find(x => x.case === c);
  const ex = b?.export?.records ?? {};
  for (const r of ex['itsm.incidents'] ?? []) if (r.number === N) rec.incident = incRow(r);
  for (const r of ex['sla.slas'] ?? []) if (r.number === N) rec.slas[r.slaId] = { stage: r.stage, startAt: I(r.startAt), schedule: r.schedule, timezone: r.timezone,
    pauses: (r.pauses ?? []).map(p => ({ from: I(p.from), to: I(p.to) })), breached: !!r.breached, breachAt: I(r.breachAt), endAt: I(r.endAt),
    elapsedMinutes: r.elapsedMinutes ?? null, businessElapsedMinutes: r.businessElapsedMinutes ?? null, cancelReason: r.cancelReason ?? null };
  for (const r of ex['sla.escalations'] ?? []) if (r.number === N) rec.escalations.push(`${r.slaId}/${r.percent} ${r.to}`);
  for (const r of ex['notify.notifications'] ?? []) if (r.about === N) rec.notifications.push(`${r.template} ${r.to}`);
  const rows = [...idx.bucket(c).ledger].filter(r => r.committed).sort((a, b2) => a.seq - b2.seq);
  for (const r of rows) {
    const a = r.args ?? {};
    const inc = rec.incident;
    const k = `${r.system}.${r.op}`;
    if (r.system === 'itsm' && a.number !== N) continue;
    if (r.system === 'sla' && a.number !== N) continue;
    switch (k) {
      case 'itsm.create': rec.incident = { number: a.number, state: 'new', priority: a.priority, impact: a.impact, urgency: a.urgency, group: null, assignee: null,
        openedAt: I(a.openedAt), resolvedAt: null, closeCode: null, closedAt: null, closeReason: null, cancelledAt: null, major: false, majorAt: null, alerts: [] }; break;
      case 'itsm.assign': if (inc) Object.assign(inc, { group: a.group, state: 'assigned', assignee: null }); break;
      case 'itsm.accept': if (inc) Object.assign(inc, { assignee: a.user, state: 'inProgress' }); break;
      case 'itsm.hold': if (inc) inc.state = 'onHold'; break;
      case 'itsm.resume': if (inc) inc.state = 'inProgress'; break;
      case 'itsm.reclassify': if (inc) Object.assign(inc, { impact: a.impact, urgency: a.urgency, priority: a.priority }); break;
      case 'itsm.resolve': if (inc) Object.assign(inc, { state: 'resolved', resolvedAt: I(a.at), closeCode: a.closeCode }); break;
      case 'itsm.close': if (inc) Object.assign(inc, { state: 'closed', closedAt: I(a.at), closeReason: a.reason }); break;
      case 'itsm.cancel': if (inc) Object.assign(inc, { state: 'cancelled', cancelledAt: I(a.at) }); break;
      case 'itsm.linkAlert': if (inc) inc.alerts.push(a.alertId); break;
      case 'itsm.setMajor': if (inc) Object.assign(inc, { major: true, majorAt: I(a.at) }); break;
      case 'sla.start': rec.slas[`${a.number}/${a.definition}/${a.generation}`] = { stage: 'inProgress', startAt: I(a.startAt), schedule: a.schedule ?? null, timezone: a.timezone ?? null,
        pauses: [], breached: false, breachAt: null, endAt: null, elapsedMinutes: null, businessElapsedMinutes: null, cancelReason: null }; break;
      default: {
        const s = rec.slas[`${a.number}/${a.definition}/${a.generation}`];
        if (k === 'notify.send') { if (a.about === N) rec.notifications.push(`${a.template} ${a.to}`); break; }
        if (k === 'sla.escalate') { rec.escalations.push(`${a.number}/${a.definition}/${a.generation}/${a.percent} ${a.to}`); break; }
        if (!s) break;
        const closeOpen = at => { const p = s.pauses.at(-1); if (p && p.to === null) p.to = at; };
        if (k === 'sla.pause') { s.stage = 'paused'; s.pauses.push({ from: I(a.at), to: null }); }
        else if (k === 'sla.resume') { s.stage = 'inProgress'; closeOpen(I(a.at)); }
        else if (k === 'sla.breach') { s.breached = true; s.breachAt = I(a.at); }
        else if (k === 'sla.stop') { closeOpen(I(a.at)); Object.assign(s, { stage: 'completed', endAt: I(a.at), elapsedMinutes: a.elapsedMinutes, businessElapsedMinutes: a.businessElapsedMinutes, breached: !!a.breached }); }
        else if (k === 'sla.cancel') { closeOpen(I(a.at)); Object.assign(s, { stage: 'cancelled', endAt: I(a.at), cancelReason: a.reason }); }
      }
    }
  }
  if (rec.incident) rec.incident.alerts.sort();
  rec.escalations.sort();
  rec.notifications.sort();
  return rec;
}
