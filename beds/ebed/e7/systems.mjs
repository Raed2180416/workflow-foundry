// E7 systems, pinned by spec/SPEC-E.md §2 (supersedes the provisional host/systems/e7.mjs for the item, as E8's
// systems.mjs did for host/systems/e8.mjs). Slice 1: incidents and the SLA engine's records; problems, changes and
// change approvals are slice 2 (DESIGN.md §3, §16) and will be added as further `itsm` tables and ops without renaming
// these.
//
// Mocks enforce referential integrity and record lifecycle only (DESIGN.md §3): `itsm` checks that an incident, CI,
// service or group exists, never a state transition (SPEC §2: "The itsm system does not check transitions: that is
// your job (R8)"); `sla` refuses an operation that does not fit the SLA's stage. Every record carries the values the
// arm wrote: no table holds a computed value (Track P, contract §4.2), so no field is marked `computed`. The CMDB,
// service and group lists the mock checks against are hidden tables loaded from world.sor (they mirror master/*.json,
// which the arm reads as files).
import { defineSystem, MockError } from '../host/mocks.mjs';
import { S } from '../host/schema.mjs';
import { notify } from '../host/systems/common.mjs';

const ID = S.str(80, { minLength: 1 });
const TIME = S.str(40, { minLength: 1 });
const TEXT = S.str(400);
export const INCIDENT_STATE = Object.freeze(['new', 'assigned', 'inProgress', 'onHold', 'resolved', 'closed', 'cancelled']);
export const HOLD_REASONS = Object.freeze(['awaitingCaller', 'awaitingVendor']);          // d5 adds awaitingChange from ep3 (world drift)
export const SLA_STAGE = Object.freeze(['inProgress', 'paused', 'completed', 'cancelled']);
export const SOURCE_KINDS = Object.freeze(['report', 'alert']);
const SOURCE = S.obj({ kind: S.enumOf(SOURCE_KINDS), id: ID });
const IMPACT = S.int({ minimum: 1, maximum: 3 });
const URGENCY = S.int({ minimum: 1, maximum: 3 });
const PRIORITY = S.int({ minimum: 1, maximum: 5 });
const GEN = S.int({ minimum: 1, maximum: 1000 });
const MINUTES = S.int({ minimum: 0, maximum: 1e8 });

/** The record id of an SLA (SPEC §2): `<number>/<definition>/<generation>`. */
export const slaIdOf = (number, definition, generation) => `${number}/${definition}/${generation}`;

const INCIDENT = {
  number: ID, source: SOURCE, callerId: S.nullable(ID), ci: ID, check: S.nullable(S.str(80)), service: ID, category: S.str(40),
  impact: IMPACT, urgency: URGENCY, priority: PRIORITY, state: S.enumOf(INCIDENT_STATE), holdReason: S.nullable(S.str(40)),
  assignmentGroup: S.nullable(ID), assignedTo: S.nullable(ID), assignments: S.int({ minimum: 0 }),
  openedAt: TIME, resolvedAt: S.nullable(TIME), closeCode: S.nullable(S.str(80)), closedAt: S.nullable(TIME), closeReason: S.nullable(S.str(80)),
  cancelledAt: S.nullable(TIME), major: S.bool, majorAt: S.nullable(TIME), alerts: S.arr(ID, 5000), summary: TEXT,
};
const SLA = {
  slaId: S.str(200, { minLength: 1 }), number: ID, definition: ID, generation: GEN, stage: S.enumOf(SLA_STAGE),
  startAt: TIME, schedule: S.nullable(S.str(80)), timezone: S.nullable(S.str(80)), plannedBreachAt: S.nullable(TIME),
  pauses: S.arr(S.obj({ from: TIME, to: S.nullable(TIME) }), 1000), breached: S.bool, breachAt: S.nullable(TIME),
  endAt: S.nullable(TIME), elapsedMinutes: S.nullable(MINUTES), businessElapsedMinutes: S.nullable(MINUTES), cancelReason: S.nullable(S.str(80)),
};
const ESCALATION = { escalationId: S.str(220, { minLength: 1 }), slaId: S.str(200), number: ID, definition: ID, generation: GEN,
  percent: S.int({ minimum: 1, maximum: 1000 }), to: S.str(120), sentAt: TIME };

const requireIncident = (db, number) => db.require('incidents', number);

export const itsm = defineSystem({
  id: 'itsm',
  description: 'Incidents of the IT service desk. Records carry the instant you give them (`at`); transitions are not checked.',
  latencyMinutes: 1,
  tables: {
    incidents: { pk: 'number', fields: INCIDENT },
    cis: { pk: 'ci', hidden: true, fields: { ci: ID, service: ID } },
    services: { pk: 'service', hidden: true, fields: { service: ID } },
    groups: { pk: 'group', hidden: true, fields: { group: ID } },
  },
  ops: {
    create: {
      description: 'Record an incident (SPEC R1). It starts in state `new`, unassigned, `major: false`, with no linked alerts.',
      args: S.obj({ number: ID, source: SOURCE, callerId: S.nullable(ID), ci: ID, check: S.nullable(S.str(80)), service: ID, category: S.str(40, { minLength: 1 }),
        impact: IMPACT, urgency: URGENCY, priority: PRIORITY, openedAt: TIME, summary: TEXT }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) {
        if (!db.get('cis', a.ci)) throw new MockError(422, 'unknown-ci', { ci: a.ci });
        if (!db.get('services', a.service)) throw new MockError(422, 'unknown-service', { service: a.service });
        db.insert('incidents', { number: a.number, source: a.source, callerId: a.callerId, ci: a.ci, check: a.check, service: a.service, category: a.category,
          impact: a.impact, urgency: a.urgency, priority: a.priority, state: 'new', holdReason: null, assignmentGroup: null, assignedTo: null, assignments: 0,
          openedAt: a.openedAt, resolvedAt: null, closeCode: null, closedAt: null, closeReason: null, cancelledAt: null, major: false, majorAt: null, alerts: [], summary: a.summary });
        return { number: a.number, state: 'new' };
      },
    },
    assign: {
      description: 'Assign the incident to `group` as of `at`: state `assigned`, assignee and hold cleared. A resolver update that quotes `ref` is routed to you.',
      args: S.obj({ number: ID, group: ID, at: TIME, ref: S.nullable(S.str(120, { minLength: 1 })) }, ['number', 'group', 'at']),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) {
        const inc = requireIncident(db, a.number);
        if (!db.get('groups', a.group)) throw new MockError(422, 'unknown-group', { group: a.group });
        db.update('incidents', a.number, { assignmentGroup: a.group, state: 'assigned', assignedTo: null, holdReason: null, assignments: inc.assignments + 1 });
        return { number: a.number, group: a.group, state: 'assigned' };
      },
    },
    accept: {
      description: 'The assignee `user` took the incident as of `at`: state `inProgress`.',
      args: S.obj({ number: ID, user: ID, at: TIME }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) { requireIncident(db, a.number); db.update('incidents', a.number, { assignedTo: a.user, state: 'inProgress', holdReason: null }); return { number: a.number, state: 'inProgress' }; },
    },
    hold: {
      description: 'Put the incident on hold with `reason` as of `at`: state `onHold`.',
      args: S.obj({ number: ID, reason: S.str(40, { minLength: 1 }), at: TIME }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) { requireIncident(db, a.number); db.update('incidents', a.number, { state: 'onHold', holdReason: a.reason }); return { number: a.number, state: 'onHold' }; },
    },
    resume: {
      description: 'End a hold as of `at`: state `inProgress`.',
      args: S.obj({ number: ID, at: TIME }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) { requireIncident(db, a.number); db.update('incidents', a.number, { state: 'inProgress', holdReason: null }); return { number: a.number, state: 'inProgress' }; },
    },
    reclassify: {
      description: 'Set impact, urgency and priority as of `at`.',
      args: S.obj({ number: ID, impact: IMPACT, urgency: URGENCY, priority: PRIORITY, at: TIME }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) { requireIncident(db, a.number); db.update('incidents', a.number, { impact: a.impact, urgency: a.urgency, priority: a.priority }); return { number: a.number, priority: a.priority }; },
    },
    resolve: {
      description: 'Resolve the incident with `closeCode` as of `at`: state `resolved`.',
      args: S.obj({ number: ID, closeCode: S.str(80, { minLength: 1 }), at: TIME }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) { requireIncident(db, a.number); db.update('incidents', a.number, { state: 'resolved', holdReason: null, resolvedAt: a.at, closeCode: a.closeCode }); return { number: a.number, state: 'resolved' }; },
    },
    close: {
      description: 'Close the incident with `reason` as of `at`: state `closed`.',
      args: S.obj({ number: ID, reason: S.str(80, { minLength: 1 }), at: TIME }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) { requireIncident(db, a.number); db.update('incidents', a.number, { state: 'closed', closedAt: a.at, closeReason: a.reason }); return { number: a.number, state: 'closed' }; },
    },
    cancel: {
      description: 'Cancel the incident as of `at`: state `cancelled`.',
      args: S.obj({ number: ID, at: TIME }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) { requireIncident(db, a.number); db.update('incidents', a.number, { state: 'cancelled', cancelledAt: a.at }); return { number: a.number, state: 'cancelled' }; },
    },
    linkAlert: {
      description: 'Link an alert to the incident (an alert can be linked once).',
      args: S.obj({ number: ID, alertId: ID }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) {
        const inc = requireIncident(db, a.number);
        if (inc.alerts.includes(a.alertId)) throw new MockError(409, 'already-linked', { alertId: a.alertId });
        db.update('incidents', a.number, { alerts: [...inc.alerts, a.alertId] });
        return { number: a.number, alerts: inc.alerts.length + 1 };
      },
    },
    setMajor: {
      description: 'Mark the incident a major incident as of `at`.',
      args: S.obj({ number: ID, at: TIME }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) { requireIncident(db, a.number); db.update('incidents', a.number, { major: true, majorAt: a.at }); return { number: a.number, major: true }; },
    },
  },
});

// SLA records (SPEC §2, R4.5). Identified by (number, definition, generation); the record id is slaIdOf(...). Every field
// is the last value the arm wrote: `plannedBreachAt` from start/resume, `breached`/`breachAt` from breach (and `breached`
// from stop, as given), elapsed values from stop. Lifecycle only: a pause appends { from, to: null }, a resume closes it,
// and a stop or cancel closes a pause still open at its own `at` (the SLA stops or is cancelled while paused).
// `escalate` has no stage guard (SPEC §2): a notice for a threshold reached at or before the end may follow the stop or
// cancel record, and the oracle orders an escalation after the SLA's start only (review 2026-10-15 round 2).
const SLA_KEY = { number: ID, definition: ID, generation: GEN };
const stageGuard = (db, a, stages, what) => {
  const id = slaIdOf(a.number, a.definition, a.generation);
  const cur = db.get('slas', id);
  if (!cur) throw new MockError(404, 'no-such-sla', { slaId: id });
  if (!stages.includes(cur.stage)) throw new MockError(409, 'wrong-stage', { slaId: id, stage: cur.stage, op: what });
  return { id, cur };
};

export const sla = defineSystem({
  id: 'sla',
  description: 'SLA records and escalation notices. An operation that does not fit the SLA\'s stage is refused (409).',
  latencyMinutes: 1,
  tables: {
    slas: { pk: 'slaId', fields: SLA },
    escalations: { pk: 'escalationId', fields: ESCALATION },
  },
  ops: {
    start: {
      description: 'Record a new SLA (stage inProgress). A second start of the same SLA is refused.',
      args: S.obj({ ...SLA_KEY, startAt: TIME, schedule: S.nullable(S.str(80)), timezone: S.nullable(S.str(80)), plannedBreachAt: S.nullable(TIME) }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) {
        const slaId = slaIdOf(a.number, a.definition, a.generation);
        if (db.get('slas', slaId)) throw new MockError(409, 'sla-exists', { slaId });
        db.insert('slas', { slaId, number: a.number, definition: a.definition, generation: a.generation, stage: 'inProgress', startAt: a.startAt, schedule: a.schedule,
          timezone: a.timezone, plannedBreachAt: a.plannedBreachAt, pauses: [], breached: false, breachAt: null, endAt: null, elapsedMinutes: null, businessElapsedMinutes: null, cancelReason: null });
        return { slaId, stage: 'inProgress' };
      },
    },
    pause: {
      description: 'Pause an SLA that is in progress, as of `at`.',
      args: S.obj({ ...SLA_KEY, at: TIME }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) {
        const { id, cur } = stageGuard(db, a, ['inProgress'], 'pause');
        db.update('slas', id, { stage: 'paused', pauses: [...cur.pauses, { from: a.at, to: null }] });
        return { slaId: id, stage: 'paused' };
      },
    },
    resume: {
      description: 'Resume a paused SLA as of `at`, with its new planned breach.',
      args: S.obj({ ...SLA_KEY, at: TIME, plannedBreachAt: S.nullable(TIME) }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) {
        const { id, cur } = stageGuard(db, a, ['paused'], 'resume');
        const pauses = cur.pauses.map((p, i) => (i === cur.pauses.length - 1 && p.to === null ? { from: p.from, to: a.at } : p));
        db.update('slas', id, { stage: 'inProgress', pauses, plannedBreachAt: a.plannedBreachAt });
        return { slaId: id, stage: 'inProgress' };
      },
    },
    breach: {
      description: 'Record the breach of an SLA in progress or paused, as of `at` (once).',
      args: S.obj({ ...SLA_KEY, at: TIME }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) {
        const { id, cur } = stageGuard(db, a, ['inProgress', 'paused'], 'breach');
        if (cur.breached) throw new MockError(409, 'already-breached', { slaId: id });
        db.update('slas', id, { breached: true, breachAt: a.at });
        return { slaId: id, breached: true };
      },
    },
    stop: {
      description: 'Stop an SLA in progress or paused as of `at` (stage completed) with its elapsed values.',
      args: S.obj({ ...SLA_KEY, at: TIME, elapsedMinutes: MINUTES, businessElapsedMinutes: MINUTES, breached: S.bool }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) {
        const { id, cur } = stageGuard(db, a, ['inProgress', 'paused'], 'stop');
        const pauses = cur.pauses.map(p => (p.to === null ? { from: p.from, to: a.at } : p));
        db.update('slas', id, { stage: 'completed', pauses, endAt: a.at, elapsedMinutes: a.elapsedMinutes, businessElapsedMinutes: a.businessElapsedMinutes, breached: a.breached });
        return { slaId: id, stage: 'completed' };
      },
    },
    cancel: {
      description: 'Cancel an SLA in progress or paused as of `at`, with `reason`.',
      args: S.obj({ ...SLA_KEY, at: TIME, reason: S.str(80, { minLength: 1 }) }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) {
        const { id, cur } = stageGuard(db, a, ['inProgress', 'paused'], 'cancel');
        const pauses = cur.pauses.map(p => (p.to === null ? { from: p.from, to: a.at } : p));
        db.update('slas', id, { stage: 'cancelled', pauses, endAt: a.at, cancelReason: a.reason });
        return { slaId: id, stage: 'cancelled' };
      },
    },
    escalate: {
      description: 'Record and send one escalation notice (`percent`, `to`) of a recorded SLA, at any stage (also after its stop or cancel: R5 says which notices are due). One per SLA and percent.',
      args: S.obj({ ...SLA_KEY, percent: S.int({ minimum: 1, maximum: 1000 }), to: S.str(120, { minLength: 1 }) }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a, ctx) {
        const slaId = slaIdOf(a.number, a.definition, a.generation);
        if (!db.get('slas', slaId)) throw new MockError(404, 'no-such-sla', { slaId });
        const escalationId = `${slaId}/${a.percent}`;
        db.insert('escalations', { escalationId, slaId, number: a.number, definition: a.definition, generation: a.generation, percent: a.percent, to: a.to, sentAt: ctx.now });
        return { escalationId };
      },
    },
  },
});

export { notify };
export const systems = Object.freeze([itsm, sla, notify]);
