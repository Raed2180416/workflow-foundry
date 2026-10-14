// E7 ITSM systems (E-BED §3 E7): `itsm` (incidents, problems, changes, approvals, SLA records), `cmdb` (configuration
// items, written by the world). SLA records are business records (start, pause intervals, stop) with product-computed
// elapsed, business-elapsed and breach fields: in Track P the arm computes and writes those; the host never does (it
// never computes business time, BED-CONTRACT-v1.1 §4.2). Provisional v1 bindings; spec-E pins names and enums
// (ServiceNow incident and problem state names are [unavail], E-BED §2.11).
import { defineSystem, MockError } from '../mocks.mjs';
import { S, validate } from '../schema.mjs';

const ID = S.str(80, { minLength: 1 });
const TIME = S.str(40);
const TABLE = S.enumOf(['incidents', 'problems', 'changes']);

const INCIDENT = { number: ID, state: S.enumOf(['new', 'inProgress', 'onHold', 'resolved', 'closed', 'canceled']), holdReason: S.nullable(S.str(40)),
  impact: S.int({ minimum: 1, maximum: 3 }), urgency: S.int({ minimum: 1, maximum: 3 }), priority: S.int({ minimum: 1, maximum: 5 }),
  assignmentGroup: S.nullable(S.str(80)), assignedTo: S.nullable(S.str(80)), caller: S.nullable(S.str(80)), ci: S.nullable(S.str(80)),
  shortDescription: S.str(400), openedAt: TIME, resolvedAt: S.nullable(TIME), closedAt: S.nullable(TIME), problem: S.nullable(S.str(80)) };
const PROBLEM = { number: ID, state: S.enumOf(['new', 'assess', 'rootCauseAnalysis', 'fixInProgress', 'resolved', 'closed']), assignmentGroup: S.nullable(S.str(80)),
  incidents: S.arr(S.str(80), 5000), openedAt: TIME, closedAt: S.nullable(TIME), change: S.nullable(S.str(80)) };
// Change states as integers New(-5) ... Canceled(4) [bar]; the meaning of each is spec-E's.
const CHANGE = { number: ID, type: S.enumOf(['standard', 'normal', 'emergency']), state: S.int({ minimum: -5, maximum: 4 }), risk: S.enumOf(['high', 'moderate', 'low']),
  ci: S.nullable(S.str(80)), assignmentGroup: S.nullable(S.str(80)), plannedStart: S.nullable(TIME), plannedEnd: S.nullable(TIME), problem: S.nullable(S.str(80)) };
const FIELDS = { incidents: INCIDENT, problems: PROBLEM, changes: CHANGE };

function checkFields(table, fields, { creating }) {
  const schema = { type: 'object', properties: FIELDS[table], additionalProperties: false, required: creating ? Object.keys(FIELDS[table]).filter(k => k !== 'number') : [] };
  const errors = validate(schema, fields);
  if (errors.length) throw new MockError(400, 'invalid-fields', { errors: errors.slice(0, 8) });
}

export const itsm = defineSystem({
  id: 'itsm',
  description: 'Incidents, problems, changes, change approvals and SLA records.',
  latencyMinutes: 1,
  tables: {
    incidents: { pk: 'number', fields: INCIDENT },
    problems: { pk: 'number', fields: PROBLEM },
    changes: { pk: 'number', fields: CHANGE },
    approvals: { pk: 'approvalId', fields: { approvalId: ID, change: ID, approver: S.str(80), state: S.enumOf(['requested', 'approved', 'rejected', 'cancelled']), at: TIME } },
    slas: { pk: 'slaId', fields: { slaId: ID, ticket: ID, definition: S.str(80), state: S.enumOf(['inProgress', 'paused', 'completed', 'cancelled']),
      startAt: S.nullable(TIME), pauses: S.arr(S.obj({ from: TIME, to: S.nullable(TIME) }), 1000), stopAt: S.nullable(TIME),
      elapsedMinutes: S.nullable(S.int()), businessElapsedMinutes: S.nullable(S.int()), breachAt: S.nullable(TIME), breached: S.nullable(S.bool) },
    computed: ['elapsedMinutes', 'businessElapsedMinutes', 'breachAt', 'breached'] },
  },
  ops: {
    create: {
      args: S.obj({ table: TABLE, number: ID, fields: { type: 'object' } }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) { checkFields(a.table, a.fields, { creating: true }); db.insert(a.table, { ...a.fields, number: a.number }); return { table: a.table, number: a.number }; },
    },
    update: {
      args: S.obj({ table: TABLE, number: ID, fields: { type: 'object' } }),
      keyed: true, subjectArgs: ['number'],
      apply(db, a) { checkFields(a.table, a.fields, { creating: false }); if ('number' in a.fields) throw new MockError(400, 'number-immutable'); db.update(a.table, a.number, a.fields); return { table: a.table, number: a.number }; },
    },
    requestApproval: {
      args: S.obj({ approvalId: ID, change: ID, approver: S.str(80, { minLength: 1 }) }),
      keyed: true, subjectArgs: ['change'],
      apply(db, a, ctx) { db.require('changes', a.change); db.insert('approvals', { ...a, state: 'requested', at: ctx.now }); return { approvalId: a.approvalId }; },
    },
    setApproval: {
      args: S.obj({ approvalId: ID, change: ID, state: S.enumOf(['approved', 'rejected', 'cancelled']) }),
      keyed: true, subjectArgs: ['change'],
      apply(db, a, ctx) {
        const ap = db.require('approvals', a.approvalId);
        if (ap.change !== a.change) throw new MockError(422, 'approval-not-on-change');
        db.update('approvals', a.approvalId, { state: a.state, at: ctx.now });
        return { approvalId: a.approvalId, state: a.state };
      },
    },
    slaEvent: {
      description: 'Record an SLA start, pause, resume, stop, cancel or reset at an arm-chosen time (retroactive allowed).',
      args: S.obj({ slaId: ID, ticket: ID, definition: S.str(80, { minLength: 1 }), event: S.enumOf(['start', 'pause', 'resume', 'stop', 'cancel', 'reset']), at: TIME }),
      keyed: true, subjectArgs: ['ticket'],
      apply(db, a) {
        const cur = db.get('slas', a.slaId);
        if (a.event === 'start' || a.event === 'reset') {
          db.upsert('slas', { slaId: a.slaId, ticket: a.ticket, definition: a.definition, state: 'inProgress', startAt: a.at, pauses: [], stopAt: null,
            elapsedMinutes: null, businessElapsedMinutes: null, breachAt: null, breached: null });
          return { slaId: a.slaId, state: 'inProgress' };
        }
        if (!cur) throw new MockError(404, 'not-found', { table: 'slas', id: a.slaId });
        if (cur.ticket !== a.ticket) throw new MockError(422, 'sla-not-on-ticket');
        const open = cur.pauses.length && cur.pauses.at(-1).to === null;
        if (a.event === 'pause') { if (open) throw new MockError(409, 'already-paused'); db.update('slas', a.slaId, { state: 'paused', pauses: [...cur.pauses, { from: a.at, to: null }] }); }
        if (a.event === 'resume') { if (!open) throw new MockError(409, 'not-paused'); db.update('slas', a.slaId, { state: 'inProgress', pauses: [...cur.pauses.slice(0, -1), { from: cur.pauses.at(-1).from, to: a.at }] }); }
        if (a.event === 'stop') db.update('slas', a.slaId, { state: 'completed', stopAt: a.at });
        if (a.event === 'cancel') db.update('slas', a.slaId, { state: 'cancelled', stopAt: a.at });
        return { slaId: a.slaId, event: a.event };
      },
    },
    setSlaComputed: {
      description: 'Write the product-computed fields of an SLA record.',
      args: S.obj({ slaId: ID, ticket: ID, elapsedMinutes: S.int({ minimum: 0 }), businessElapsedMinutes: S.int({ minimum: 0 }), breachAt: S.nullable(TIME), breached: S.bool }),
      keyed: true, subjectArgs: ['ticket'],
      apply(db, a) { const cur = db.require('slas', a.slaId); if (cur.ticket !== a.ticket) throw new MockError(422, 'sla-not-on-ticket'); const { slaId, ticket, ...f } = a; db.update('slas', slaId, f); return { slaId }; },
    },
    get: {
      args: S.obj({ table: TABLE, number: ID }), readOnly: true, subjectArgs: ['number'],
      apply(db, a) { return { record: db.require(a.table, a.number) }; },
    },
  },
});

export const cmdb = defineSystem({
  id: 'cmdb',
  description: 'Configuration items (written by the world).',
  latencyMinutes: 1,
  tables: { cis: { pk: 'ciId', fields: { ciId: ID, name: S.str(120), class: S.str(40), supportGroup: S.str(80), schedule: S.str(80) } } },
  ops: {},
});

export const systems = Object.freeze([itsm, cmdb]);
