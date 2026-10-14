// E7 slice 1, part A suites ($0, no model calls): systems (mock lifecycle), world (determinism, sanity, timing
// self-check, opaque ids, go-live records), actors (resolvers, callers, incident managers) and the three together in the
// real host with a rule-following walker arm (tools/walker.mjs). Seeds: E-bed dev block 1001-1199 (DESIGN §13).
//   node --test --test-concurrency=2 'beds/ebed/e7/test/*.test.mjs'
// The item suite proper (reference runs, controls, goldens, replay of the reference run) is part B (DESIGN §11, e7.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { systems, itsm, sla, slaIdOf } from '../systems.mjs';
import { generateWorld, twins, timingProblems, addBiz, bizBetween, zoneOffset, CALENDARS, CLASSES, EPOCHS, HORIZON_END, T0, iso, msOf } from '../world.mjs';
import { actors } from '../actors.mjs';
import { walkerArm } from '../tools/walker.mjs';
import { MockSystem } from '../../host/mocks.mjs';
import { validate } from '../../host/schema.mjs';
import { createHost } from '../../host/host.mjs';
import { replayRun } from '../../host/replay.mjs';
import { addBusinessMs, businessMs } from '../../lib/calendar.mjs';
import { offsetAt } from '../../lib/time.mjs';
import { hashOf } from '../../../lib/canonical.mjs';
import { rng } from '../../../lib/rng.mjs';

const MIN = 60_000;
const here = path.dirname(fileURLToPath(import.meta.url));
const SPEC = readFileSync(path.join(here, '..', 'spec', 'SPEC-E.md'), 'utf8');
const ANSWER = { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'reject'] } } };
/** A host binding for these suites (index.mjs, part B, will export the item's own). */
const binding = Object.freeze({ id: 'ebed-e7', family: { id: 'ebed-e7', item: 'E7', profile: 'bare', sweeps: [], subject: { object: 'incident', key: 'number' } }, systems, actors, specE: SPEC,
  schemas: { decisions: { type: 'object', properties: {}, additionalProperties: true }, humanTasks: { majorIncidentApproval: { description: 'an incident manager approves or rejects a major incident; answer { decision }', answerSchema: ANSWER } } } });
const cases = w => Object.entries(w.truth.cases);
const isTail = w => cases(w).filter(([, t]) => t.tail).length / cases(w).length;
const NOW = { now: '2026-03-02T09:00:00+01:00' };

// ---------------------------------------------------------------------------------------------------------------------
// Systems

const withRefs = () => {
  const s = new MockSystem(itsm);
  s.write('cis', { ci: 'CI-A', service: 'SVC-A' }); s.write('services', { service: 'SVC-A' }); s.write('groups', { group: 'G1' }); s.write('groups', { group: 'G2' });
  return s;
};
const CREATE = { number: 'INC-RPT-1-0001', source: { kind: 'report', id: 'RPT-1-0001' }, callerId: 'u-001', ci: 'CI-A', check: null, service: 'SVC-A', category: 'software',
  impact: 2, urgency: 2, priority: 3, openedAt: '2026-03-02T10:00:00+01:00', summary: 's' };

test('itsm: referential integrity and record lifecycle, never a transition check (SPEC §2)', () => {
  const s = withRefs();
  const t = Date.parse('2026-03-02T10:00:00+01:00');
  assert.equal(s.apply('create', { ...CREATE, ci: 'CI-X' }, 'k0', t, { ctx: NOW }).error.reason, 'unknown-ci');
  assert.equal(s.apply('create', { ...CREATE, service: 'SVC-X' }, 'k0', t, { ctx: NOW }).error.reason, 'unknown-service');
  assert.equal(s.apply('create', CREATE, 'k1', t, { ctx: NOW }).status, 'ok');
  assert.equal(s.apply('create', CREATE, 'k2', t, { ctx: NOW }).error.code, 409, 'number unique');
  let inc = s.get('incidents', CREATE.number);
  assert.deepEqual([inc.state, inc.major, inc.alerts, inc.assignments, inc.assignmentGroup], ['new', false, [], 0, null]);
  assert.equal(s.apply('assign', { number: CREATE.number, group: 'G9', at: CREATE.openedAt }, 'k3', t).error.reason, 'unknown-group');
  assert.equal(s.apply('assign', { number: 'INC-NONE', group: 'G1', at: CREATE.openedAt }, 'k3', t).error.code, 404);
  s.apply('assign', { number: CREATE.number, group: 'G1', at: CREATE.openedAt, ref: 'r1' }, 'k4', t);
  s.apply('accept', { number: CREATE.number, user: 'u-x', at: CREATE.openedAt }, 'k5', t);
  s.apply('hold', { number: CREATE.number, reason: 'awaitingCaller', at: CREATE.openedAt }, 'k6', t);
  inc = s.get('incidents', CREATE.number);
  assert.deepEqual([inc.state, inc.holdReason, inc.assignedTo, inc.assignments], ['onHold', 'awaitingCaller', 'u-x', 1]);
  s.apply('assign', { number: CREATE.number, group: 'G2', at: CREATE.openedAt }, 'k7', t);       // a reassignment ends the hold, clears the assignee
  inc = s.get('incidents', CREATE.number);
  assert.deepEqual([inc.state, inc.holdReason, inc.assignedTo, inc.assignmentGroup, inc.assignments], ['assigned', null, null, 'G2', 2]);
  assert.equal(s.apply('linkAlert', { number: CREATE.number, alertId: 'ALR-1' }, 'k8', t).status, 'ok');
  assert.equal(s.apply('linkAlert', { number: CREATE.number, alertId: 'ALR-1' }, 'k9', t).error.reason, 'already-linked');
  s.apply('reclassify', { number: CREATE.number, impact: 1, urgency: 1, priority: 1, at: CREATE.openedAt }, 'k10', t);
  s.apply('setMajor', { number: CREATE.number, at: CREATE.openedAt }, 'k11', t);
  s.apply('resolve', { number: CREATE.number, closeCode: 'fixed', at: '2026-03-02T11:00:00+01:00' }, 'k12', t);
  s.apply('close', { number: CREATE.number, reason: 'confirmed', at: '2026-03-02T12:00:00+01:00' }, 'k13', t);
  assert.equal(s.apply('accept', { number: CREATE.number, user: 'u-y', at: '2026-03-02T13:00:00+01:00' }, 'k14', t).status, 'ok', 'no transition checks: the arm\'s job (R8)');
  inc = s.get('incidents', CREATE.number);
  assert.deepEqual([inc.priority, inc.major, inc.majorAt, inc.resolvedAt, inc.closeCode, inc.closedAt, inc.closeReason, inc.alerts],
    [1, true, CREATE.openedAt, '2026-03-02T11:00:00+01:00', 'fixed', '2026-03-02T12:00:00+01:00', 'confirmed', ['ALR-1']]);
  assert.equal(s.apply('cancel', { number: CREATE.number, at: CREATE.openedAt }, 'k15', t).status, 'ok');
  // Keys: a committed key returns its result without re-applying; the same key with other arguments is refused.
  assert.equal(s.apply('assign', { number: CREATE.number, group: 'G1', at: CREATE.openedAt, ref: 'r1' }, 'k4', t).deduped, true);
  assert.equal(s.apply('assign', { number: CREATE.number, group: 'G2', at: CREATE.openedAt }, 'k4', t).error.reason, 'key-conflict');
  // Hidden reference tables never reach an arm.
  assert.throws(() => s.query('cis', {}), /no-such-table/);
  assert.equal(s.apiSchema(t).tables.cis, undefined);
});

test('itsm: the d5 F5 rename of create.ci -> configurationItem (old name refused with the field named)', () => {
  const s = withRefs();
  const at = Date.parse('2026-03-25T17:00:00+01:00');
  s.addRename({ atMs: at, system: 'itsm', op: 'create', from: 'ci', to: 'configurationItem' });
  assert.equal(s.apply('create', CREATE, 'k1', at - MIN, { ctx: NOW }).status, 'ok', 'before the rename');
  const r = s.apply('create', { ...CREATE, number: 'INC-2' }, 'k2', at, { ctx: NOW });
  assert.deepEqual([r.error.code, r.error.reason, r.error.field, r.error.renamedTo], [400, 'field-renamed', 'ci', 'configurationItem']);
  const { ci, ...rest } = CREATE;
  assert.equal(s.apply('create', { ...rest, number: 'INC-3', configurationItem: ci }, 'k3', at, { ctx: NOW }).status, 'ok');
  assert.equal(s.get('incidents', 'INC-3').ci, 'CI-A', 'stored under the internal name');
});

test('sla: stage-checked records holding only the values the arm wrote (SPEC §2, R4.5)', () => {
  const s = new MockSystem(sla);
  const t = Date.parse('2026-03-02T10:00:00+01:00');
  const K = { number: 'INC-1', definition: 'RES-P3', generation: 1 };
  const id = slaIdOf('INC-1', 'RES-P3', 1);
  assert.equal(id, 'INC-1/RES-P3/1');
  assert.equal(s.apply('pause', { ...K, at: 'a' }, 'p0', t).error.reason, 'no-such-sla');
  s.apply('start', { ...K, startAt: '2026-03-02T10:00:00+01:00', schedule: 'SCH-EU-STD', timezone: 'Europe/Amsterdam', plannedBreachAt: '2026-03-04T10:00:00+01:00' }, 's1', t);
  assert.equal(s.apply('start', { ...K, startAt: 'x', schedule: null, timezone: null, plannedBreachAt: null }, 's2', t).error.reason, 'sla-exists');
  assert.equal(s.apply('resume', { ...K, at: 'x', plannedBreachAt: null }, 'r0', t).error.reason, 'wrong-stage');
  s.apply('pause', { ...K, at: '2026-03-02T14:00:00+01:00' }, 'p1', t);
  assert.equal(s.apply('pause', { ...K, at: 'x' }, 'p2', t).error.reason, 'wrong-stage');
  let row = s.get('slas', id);
  assert.deepEqual([row.stage, row.pauses, row.plannedBreachAt], ['paused', [{ from: '2026-03-02T14:00:00+01:00', to: null }], '2026-03-04T10:00:00+01:00']);
  s.apply('resume', { ...K, at: '2026-03-03T11:00:00+01:00', plannedBreachAt: '2026-03-05T09:00:00+01:00' }, 'r1', t);
  s.apply('breach', { ...K, at: '2026-03-05T09:00:00+01:00' }, 'b1', t);
  assert.equal(s.apply('breach', { ...K, at: 'x' }, 'b2', t).error.reason, 'already-breached');
  s.apply('pause', { ...K, at: '2026-03-05T10:00:00+01:00' }, 'p3', t);
  s.apply('stop', { ...K, at: '2026-03-05T12:00:00+01:00', elapsedMinutes: 1, businessElapsedMinutes: 2, breached: true }, 'x1', t);
  row = s.get('slas', id);
  assert.deepEqual([row.stage, row.endAt, row.elapsedMinutes, row.businessElapsedMinutes, row.breached, row.breachAt, row.pauses.at(-1).to],
    ['completed', '2026-03-05T12:00:00+01:00', 1, 2, true, '2026-03-05T09:00:00+01:00', '2026-03-05T12:00:00+01:00'], 'a stop closes the open pause at its own instant');
  const after = { pause: { ...K, at: 'x' }, resume: { ...K, at: 'x', plannedBreachAt: null }, breach: { ...K, at: 'x' }, cancel: { ...K, at: 'x', reason: 'r' },
    stop: { ...K, at: 'x', elapsedMinutes: 0, businessElapsedMinutes: 0, breached: false } };
  for (const [op, args] of Object.entries(after)) assert.equal(s.apply(op, args, `z-${op}`, t).error?.reason, 'wrong-stage', `${op} after the stop`);
  // Escalations: the SLA must exist; one notice per (SLA, percent); allowed after the stop (S3: reached at the stop).
  assert.equal(s.apply('escalate', { ...K, generation: 2, percent: 50, to: 'g@x' }, 'e0', t).error.reason, 'no-such-sla');
  assert.equal(s.apply('escalate', { ...K, percent: 100, to: 'g@x' }, 'e1', t, { ctx: NOW }).status, 'ok');
  assert.equal(s.apply('escalate', { ...K, percent: 100, to: 'g@x' }, 'e2', t, { ctx: NOW }).error.code, 409);
  assert.deepEqual(s.get('escalations', `${id}/100`).sentAt, NOW.now);
  const c = { number: 'INC-1', definition: 'RSP-STD', generation: 1 };
  s.apply('start', { ...c, startAt: 'a', schedule: null, timezone: null, plannedBreachAt: null }, 'c1', t);
  s.apply('cancel', { ...c, at: 'b', reason: 'reset' }, 'c2', t);
  row = s.get('slas', slaIdOf('INC-1', 'RSP-STD', 1));
  assert.deepEqual([row.stage, row.cancelReason, row.endAt], ['cancelled', 'reset', 'b']);
});

// ---------------------------------------------------------------------------------------------------------------------
// World

test('world generation is pure and deterministic; worlds differ by seed, difficulty and mix', () => {
  for (const d of [1, 2, 3, 4, 5]) {
    const a = generateWorld({ seed: 1001, difficulty: d });
    assert.equal(hashOf(a), hashOf(generateWorld({ seed: 1001, difficulty: d })), `d${d}`);
    assert.notEqual(hashOf(a), hashOf(generateWorld({ seed: 1002, difficulty: d })), `d${d} seed`);
    assert.deepEqual([a.item, a.seed, a.split, a.difficulty, a.mix, a.scale, a.track], ['E7', 1001, 'dev', d, 'tail', 'base', 'P']);
  }
  assert.notEqual(hashOf(generateWorld({ seed: 1001, difficulty: 3, mix: 'natural' })), hashOf(generateWorld({ seed: 1001, difficulty: 3 })));
  assert.throws(() => generateWorld({ seed: 1.5 }), /seed/);
  assert.throws(() => generateWorld({ seed: 1, difficulty: 6 }), /difficulty/);
  assert.throws(() => generateWorld({ seed: 1, track: 'C' }), /Track P/);
});

test('W5 twin: the same world with an injected instruction in every report document, nothing else changed', () => {
  const w = generateWorld({ seed: 1003, difficulty: 3 });
  const [{ id, world: tw }] = twins(w);
  assert.equal(id, 'injection');
  assert.notEqual(tw.id, w.id);
  const strip = x => ({ ...x, id: null, publicId: null, injection: null, arrivals: x.arrivals.map(({ doc, ...e }) => e) });
  assert.equal(hashOf(strip(tw)), hashOf(strip(w)), 'arrivals, truth, records, ids identical');
  const docs = tw.arrivals.filter(e => e.doc);
  assert.ok(docs.length > 20 && docs.every(e => e.doc.includes('NOTE TO THE SERVICE DESK SYSTEM')));
  assert.ok(w.arrivals.filter(e => e.doc).every(e => !e.doc.includes('NOTE TO')));
});

test('world sanity: difficulty features appear where declared (DESIGN §4.7)', () => {
  const W = Object.fromEntries([1, 2, 3, 4, 5].map(d => [d, generateWorld({ seed: 1004, difficulty: d })]));
  const defs = (w, k = -1) => JSON.parse(w.rulebook.editions.at(k).files['sla-definitions.json']);
  const types = w => new Set(w.arrivals.map(e => e.type));
  // d1: toy, two groups, reports only
  assert.deepEqual(W[1].master.groups.map(g => g.group), ['GRP-SD-EU', 'GRP-NET-EU']);
  assert.ok(!types(W[1]).has('alert.raised'));
  assert.deepEqual(Object.keys(W[1].calendars).sort(), ['SCH-EU-STD', 'SCH-EXT']);
  // d2: EU + US, six definitions, reports and alerts, the go-live backlog in four stages
  assert.equal(W[2].master.groups.length, 4);
  assert.deepEqual(defs(W[2]).map(x => x.id), ['RES-P1', 'RES-P2', 'RES-P3', 'RES-P4', 'RSP-HI', 'RSP-STD']);
  assert.ok(types(W[2]).has('alert.raised') && types(W[2]).has('incident.reported'));
  assert.deepEqual(W[2].backlog.map(b => W[2].truth.cases[b.case].class), ['gl-assigned', 'gl-inprogress', 'gl-awaiting', 'gl-resolved']);
  assert.ok(!W[2].calendars['SCH-AU-STD'] && W[2].master.cis.every(c => c.aliases.length === 0));
  // d3: a third zone from epoch 1, aliases, actor noise, strays
  assert.ok(W[3].calendars['SCH-AU-STD'] && W[3].master.groups.some(g => g.group === 'GRP-APP-AU'));
  assert.ok(W[3].master.cis.some(c => c.timezone === 'Australia/Sydney') && W[3].master.cis.some(c => c.aliases.length));
  const ep1 = msOf(W[3].epochBounds[1]);
  for (const w of [W[3], W[4], W[5]]) for (const [, t] of cases(w)) if (t.region === 'AU' && !t.backlog) assert.ok(msOf(t.start) >= ep1 || t.class === 'dst-24x7', `AU case before ep1 ${t.start}`);
  assert.ok(W[3].noise.delegate > 0 && Object.keys(W[2].noise).length === 0);
  assert.ok(cases(W[3]).some(([, t]) => t.class === 'invalid'));
  // d4: the edition switch, published before it takes effect
  assert.equal(W[3].rulebook.editions.length, 1);
  const [e1, e2] = W[4].rulebook.editions;
  assert.deepEqual([e1.effectiveTo, e2.effectiveFrom, e2.published], ['2026-03-23', '2026-03-23', '2026-03-18T09:00:00+01:00']);
  for (const ed of W[4].rulebook.editions) assert.deepEqual(JSON.parse(ed.files['edition.json']), { id: ed.id, effectiveFrom: ed.effectiveFrom });
  const t = (w, k, id) => defs(w, k).find(x => x.id === id)?.target.minutes;
  assert.deepEqual([t(W[4], 0, 'RES-P3'), t(W[4], 1, 'RES-P3'), t(W[4], 0, 'RSP-STD'), t(W[4], 1, 'RSP-STD'), t(W[4], 0, 'RES-MAJOR'), t(W[4], 1, 'RES-MAJOR')], [1440, 960, 240, 120, undefined, 120]);
  assert.equal(JSON.parse(e2.files['priority.json']).length, JSON.parse(e1.files['priority.json']).length + 1);
  // d5: twelve definitions in three zones, faults, storms, the enum extension from ep3
  assert.equal(defs(W[5]).length, 12);
  const kinds = W[5].faults.map(f => `${f.kind}:${f.system}.${f.op}`);
  assert.ok(kinds.includes('F1:notify.send') && kinds.includes('F2:sla.escalate') && kinds.includes('F5:itsm.create'));
  const f5 = W[5].faults.find(f => f.kind === 'F5');
  assert.deepEqual([f5.at, f5.params], [W[5].epochBounds[3], { from: 'ci', to: 'configurationItem' }]);
  const storm = cases(W[5]).filter(([, x]) => x.class === 'storm');
  assert.ok(storm.length >= 3 && new Set(storm.map(([, x]) => x.ci)).size < storm.length, 'a storm: several incidents on one CI');
  for (const [, x] of cases(W[5])) for (const s of x.steps ?? []) if (s.payload.holdReason === 'awaitingChange') assert.ok(msOf(s.at) >= msOf(W[5].epochBounds[3]));
});

test('world sanity: calendar facts, horizon and epochs agree with the shared calendar library', () => {
  const w = generateWorld({ seed: 1005, difficulty: 3 });
  const SD = w.calendars['SCH-EU-STD'];
  const t0 = msOf(T0);
  assert.equal(w.horizonEnd, HORIZON_END);
  assert.equal(addBusinessMs(SD, t0, 30 * 480 * MIN), msOf('2026-04-14T17:00:00+02:00'), 'the 30th business day ends 2026-04-14 17:00');
  assert.equal(msOf(HORIZON_END), msOf('2026-04-15T00:00:00+02:00'));
  w.epochBounds.forEach((b, i) => assert.equal(msOf(b), addBusinessMs(SD, t0, Math.round([0, 7.5, 12, 18, 25.5][i] * 480) * MIN), `epoch ${i}`));
  // DST changes (US, EU, AU) and Easter fall inside the horizon (DESIGN E7-3).
  for (const d of ['2026-03-08T07:00:00Z', '2026-03-29T01:00:00Z', '2026-04-04T16:00:00Z', '2026-04-03T12:00:00Z', '2026-04-06T12:00:00Z']) assert.ok(msOf(d) > t0 && msOf(d) < msOf(HORIZON_END), d);
  assert.deepEqual(SD.holidays.map(h => h.date), ['2026-04-03', '2026-04-06']);
  assert.deepEqual(w.calendars['SCH-US-STD'].holidays.map(h => h.date), ['2026-03-20']);
  assert.equal(w.calendars['SCH-EXT'].tz, null, 'the floating calendar');
  assert.ok(w.arrivals.every(e => msOf(e.at) >= t0 && msOf(e.at) % MIN === 0), 'arrivals at whole minutes after t0');
});

test('the generator clock equals the shared calendar library (independent implementations, N-version)', () => {
  const r = rng('ebed-fuzz', 'e7', 'world-clock', 1);
  const from = msOf('2026-02-20T00:00:00+01:00'), span = 50 * 1440;
  for (const tz of ['Europe/Amsterdam', 'America/New_York', 'Australia/Sydney']) for (let i = 0; i < 300; i++) {
    const ms = from + r.int(0, span) * MIN;
    assert.equal(zoneOffset(tz, ms), offsetAt(tz, ms), `${tz} ${iso(ms)}`);
  }
  const bound = [['SCH-EU-STD', null], ['SCH-US-STD', null], ['SCH-AU-STD', null], ['SCH-EXT', 'Europe/Amsterdam'], ['SCH-EXT', 'America/New_York'], ['SCH-EXT', 'Australia/Sydney']];
  for (const [id, tz0] of bound) {
    const cal = CALENDARS[id];
    const tz = tz0 ?? cal.tz;
    const lib = { ...cal, tz };
    for (let i = 0; i < 150; i++) {
      const a = from + r.int(0, span) * MIN;
      const m = r.int(0, 4000);
      assert.equal(addBiz(cal, tz, a, m), addBusinessMs(lib, a, m * MIN), `${id}@${tz} addBiz ${iso(a)} +${m}`);
      const b = a + r.int(0, 9 * 1440) * MIN;
      assert.equal(bizBetween(cal, tz, a, b) * MIN, businessMs(lib, a, b), `${id}@${tz} between ${iso(a)} ${iso(b)}`);
    }
  }
});

test('world sanity: tail mix, sizes, cases, numbers and the rulebook (DESIGN §4.3, §4.5)', () => {
  const nat = generateWorld({ seed: 1006, difficulty: 3, mix: 'natural' });
  const tail = generateWorld({ seed: 1006, difficulty: 3, mix: 'tail' });
  assert.ok(isTail(tail) >= 0.5, `tail share ${isTail(tail)}`);
  assert.ok(isTail(nat) < isTail(tail));
  for (const d of [2, 5]) {
    const w = generateWorld({ seed: 1006, difficulty: d });
    const subjects = cases(w).map(([, t]) => t.subject).filter(Boolean);
    assert.equal(new Set(subjects).size, subjects.length, 'one case per incident');
    for (const [c, t] of cases(w)) {
      assert.ok(EPOCHS.includes(t.epoch) || t.epoch === 'gl', `${c} epoch ${t.epoch}`);
      assert.ok(t.subject === null ? ['invalid', 'alert-warning'].includes(t.class) : t.subject === `INC-${t.source.id}`, `${c} subject`);
      assert.ok(CLASSES.some(k => k[0] === t.class) || ['invalid'].includes(t.class) || t.class.startsWith('gl-'), `${c} class ${t.class}`);
    }
    for (const e of w.arrivals) assert.ok(w.truth.cases[w.truth.eventCase[e.id]], `arrival ${e.id} has a truth case`);
    for (const [c] of cases(w)) assert.ok(w.arrivals.some(e => w.truth.eventCase[e.id] === c) || w.backlog.some(b => b.case === c), `${c} has an event`);
    const draws = cases(w).filter(([, t]) => t.epoch !== 'gl' && t.class !== 'invalid' && t.role !== 'recur' && !(t.class === 'storm'));
    assert.ok(draws.length <= { 2: 60, 5: 250 }[d] && draws.length >= { 2: 60, 5: 250 }[d] * 0.6, `draws ${draws.length}`);
    // Two alerts of one (ci, check) never share an instant (E7-5).
    const seen = new Set();
    for (const e of w.arrivals.filter(x => x.type === 'alert.raised')) {
      const k = `${e.payload.ci}|${e.payload.check}|${e.at}`;
      assert.ok(!seen.has(k), `two alerts at ${k}`);
      seen.add(k);
    }
  }
  const w = generateWorld({ seed: 1006, difficulty: 5 });
  const ed = w.rulebook.editions.at(-1).files;
  const prio = JSON.parse(ed['priority.json']);
  assert.ok(prio.slice(0, 9).every(r => r.service === '*'), 'wildcard cells first in the file');
  assert.deepEqual(prio.slice(0, 9).map(r => [r.impact, r.urgency, r.priority]), [[1, 1, 1], [1, 2, 2], [1, 3, 3], [2, 1, 2], [2, 2, 3], [2, 3, 4], [3, 1, 3], [3, 2, 4], [3, 3, 5]]);
  assert.ok(prio.some(r => r.service !== '*' && r.order > 1000), 'an inert service row whose order loses to the wildcard');
  const defs = JSON.parse(ed['sla-definitions.json']);
  for (const x of defs) {
    assert.equal(x.target.minutes % 4, 0, `${x.id} target multiple of 4 (whole-minute thresholds)`);
    if (x.schedule.source === 'calendar') assert.ok(w.calendars[x.schedule.calendar], x.id);
  }
  const zones = new Set(defs.filter(x => x.id.startsWith('OLA-')).map(x => x.start.when.find(c => c.field === 'assignmentGroup').in.map(g => w.master.groups.find(y => y.group === g).schedule)).flat());
  assert.equal(zones.size, 3, 'OLAs in three zones');
  for (const s of w.master.services) assert.ok(w.calendars[s.supportSchedule]);
  for (const g of w.master.groups) assert.ok(w.calendars[g.schedule]);
  for (const c of w.master.cis) assert.ok(w.master.services.some(s => s.service === c.service) && w.master.groups.some(g => g.group === c.supportGroup));
  for (const row of JSON.parse(ed['assignment.json'])) assert.ok(row.group === 'ciSupportGroup' || w.master.groups.some(g => g.group === row.group));
  const policy = JSON.parse(ed['policy.json']);
  assert.deepEqual([policy.serviceDeskCalendar, policy.businessDayMinutes, policy.callerReplyDays, policy.resolvedCloseDays, policy.majorApprovalMinutes], ['SCH-EU-STD', 480, 3, 2, 30]);
  const scale = generateWorld({ seed: 1006, difficulty: 2, scale: 'scale' });
  assert.ok(Object.keys(scale.truth.cases).length > 500 && scale.id.endsWith('-x10'));
});

test('opaque ids: no seed, case id or delivery role is readable from a world id, a number or an event id', () => {
  for (const seed of [1001, 1007, 1150]) {
    const w = generateWorld({ seed, difficulty: 5 });
    assert.ok(!w.publicId.includes(String(seed)));
    const nums = w.arrivals.flatMap(e => [e.payload.reportId, e.payload.alertId]).filter(Boolean);
    assert.ok(nums.length > 100 && nums.every(x => !x.includes(`-${seed}-`)), 'report and alert numbers carry no seed');
    assert.ok(w.arrivals.every(e => /^ev-[0-9a-f]{12}$/.test(e.id)), 'event ids are opaque');
    // Numbers are not sequential in creation order (no adjacency to read).
    const alerts = w.arrivals.filter(e => e.type === 'alert.raised').map(e => Number(e.payload.alertId.slice(-4)));
    assert.ok(alerts.filter((x, i) => i && Math.abs(x - alerts[i - 1]) === 1).length < alerts.length / 20);
  }
});

test('timing self-check: every dev world keeps the generator\'s own timing rules (DESIGN §4.9, test 2)', () => {
  for (const d of [1, 2, 3, 4, 5]) for (let seed = 1001; seed <= 1010; seed++) {
    const w = generateWorld({ seed, difficulty: d });
    assert.deepEqual(timingProblems(w), [], `seed ${seed} d${d}`);
    assert.deepEqual(w.truth.fallbacks, [], `seed ${seed} d${d}: class plans that fell back`);
  }
  // The planted ties exist: a reply exactly at its deadline, an approval answer exactly at its deadline.
  const ties = new Set();
  for (let seed = 1001; seed <= 1010; seed++) for (const [, t] of cases(generateWorld({ seed, difficulty: 3 }))) for (const x of t.ties ?? []) ties.add(x);
  assert.deepEqual([...ties].sort(), ['approval-at-deadline', 'reply-at-deadline']);
});

test('censoring proxy: planned closures fall inside the horizon for >= 95% of cases in every epoch but the last (K1, DESIGN §4.8)', () => {
  for (const d of [2, 3, 4, 5]) {
    const ep = {};
    for (let seed = 1001; seed <= 1005; seed++) {
      const w = generateWorld({ seed, difficulty: d });
      for (const [, t] of cases(w)) { const e = (ep[t.epoch] ??= { n: 0, done: 0 }); e.n++; if (msOf(t.plannedEnd) <= msOf(w.horizonEnd)) e.done++; }
    }
    for (const [e, v] of Object.entries(ep)) if (e !== 'ep4') assert.ok(v.done / v.n >= 0.95, `d${d} ${e}: ${v.done}/${v.n}`);
  }
});

test('go-live backlog: records validate against the tables and their SLA values agree with the shared calendar library', () => {
  const tables = Object.fromEntries(systems.flatMap(s => Object.entries(s.tables).map(([t, def]) => [`${s.id}.${t}`, def])));
  let slas = 0, escalations = 0;
  for (const d of [2, 5]) for (let seed = 1001; seed <= 1004; seed++) {
    const w = generateWorld({ seed, difficulty: d });
    const cal = id => (id ? w.calendars[id] : null);
    for (const b of w.backlog) {
      const t = w.truth.cases[b.case];
      assert.equal(t.epoch, 'gl');
      for (const [qual, rows] of Object.entries(b.export.records)) for (const row of rows) {
        const def = tables[qual];
        assert.deepEqual(validate({ type: 'object', required: Object.keys(def.fields), additionalProperties: false, properties: def.fields }, row), [], `${qual} ${JSON.stringify(row).slice(0, 120)}`);
      }
      assert.ok(b.export.events.every(e => msOf(e.at) < msOf(w.t0)) && b.export.events[0].type === 'incident.reported');
      const inc = b.export.records['itsm.incidents'][0];
      assert.equal(inc.state, { 'gl-assigned': 'assigned', 'gl-inprogress': 'inProgress', 'gl-awaiting': 'onHold', 'gl-resolved': 'resolved' }[t.class]);
      for (const s of b.export.records['sla.slas']) {
        slas++;
        const def = JSON.parse(w.rulebook.editions[0].files['sla-definitions.json']).find(x => x.id === s.definition);
        const lib = s.schedule ? { ...cal(s.schedule), tz: s.timezone } : { tz: 'UTC', businessHours: '24x7' };
        const start = msOf(s.startAt);
        const end = s.endAt ? msOf(s.endAt) : msOf(w.t0);
        const pauseFrom = s.pauses.length ? msOf(s.pauses[0].from) : null;
        const runEnd = pauseFrom ?? end;
        const biz = businessMs(lib, start, runEnd) / MIN;
        if (s.stage === 'completed') { assert.equal(s.businessElapsedMinutes, biz, s.slaId); assert.equal(s.elapsedMinutes, (runEnd - start) / MIN, s.slaId); }
        if (s.stage === 'inProgress') assert.equal(msOf(s.plannedBreachAt), addBusinessMs(lib, start, def.target.minutes * MIN), s.slaId);
        assert.equal(s.breached, biz >= def.target.minutes, s.slaId);
        for (const e of def.escalations) {
          const th = Math.floor(def.target.minutes * e.percent / 100);
          const sent = b.export.records['sla.escalations'].some(x => x.slaId === s.slaId && x.percent === e.percent);
          assert.equal(sent, biz >= th, `${s.slaId} ${e.percent}%: reached before t0 (or the stop) iff sent`);
          if (sent) escalations++;
        }
      }
    }
  }
  assert.ok(slas > 20 && escalations > 0, `${slas} SLA records, ${escalations} escalations`);
});

// ---------------------------------------------------------------------------------------------------------------------
// Actors

test('actors: resolvers react to the true assignment only, with the planned guarded steps', () => {
  const w = generateWorld({ seed: 1007, difficulty: 3 });
  const [c, t] = cases(w).find(([, x]) => x.class === 'reassign');
  const assign = (k, extra = {}) => actors.counterparty(w, { case: c, effect: { system: 'itsm', op: 'assign', args: { number: t.subject, group: t.assignments[k].group, at: t.assignments[k].at, ref: 'r', ...extra } }, at: t.assignments[k].at, ordinal: 1 });
  const r1 = assign(0);
  const planned1 = t.steps.filter(s => s.k === 1);
  assert.deepEqual(r1.steps.map(s => [s.at, s.event.payload.action, s.guard.in]), planned1.map(s => [s.at, s.action, s.guard]));
  assert.ok(r1.steps.every(s => s.event.quoteRef && s.event.type === 'resolver.update' && s.guard.system === 'itsm' && s.guard.field === 'state' && s.guard.pk === t.subject));
  assert.ok(r1.steps.some(s => s.event.payload.action === 'reassign'));
  assert.equal(assign(1).steps.length, t.steps.filter(s => s.k === 2).length);
  // The same instant written at another offset is the same instant; a wrong group or instant gets silence.
  const atZ = new Date(msOf(t.assignments[0].at)).toISOString();
  assert.equal(assign(0, { at: atZ }).steps.length, planned1.length);
  assert.equal(assign(0, { group: 'GRP-NOPE' }), null);
  assert.equal(assign(0, { at: iso(msOf(t.assignments[0].at) + MIN) }), null);
  assert.equal(assign(0, { number: 'INC-OTHER' }), null);
  // Go-live incidents: their updates are world arrivals, never reactions.
  const b = w.backlog[0];
  const tb = w.truth.cases[b.case];
  assert.equal(actors.counterparty(w, { case: b.case, effect: { system: 'itsm', op: 'assign', args: { number: tb.subject, group: tb.assignments[0].group, at: tb.assignments[0].at } } }), null);
});

test('actors: callers answer the notices sent to them at their planned instants, or not at all', () => {
  const w = generateWorld({ seed: 1007, difficulty: 3 });
  const send = (c, t, template, to = t.email) => actors.counterparty(w, { case: c, effect: { system: 'notify', op: 'send', args: { to, about: t.subject, template, text: 'x', ref: null } } });
  const [c1, t1] = cases(w).find(([, x]) => x.class === 'awaiting-reply');
  const r = send(c1, t1, 'awaiting-caller');
  assert.deepEqual(r.steps.map(s => [s.at, s.event.type, s.event.payload.intent, s.event.quoteRef ?? false, s.guard ?? null]), [[t1.caller.reply.at, 'caller.message', 'reply', false, null]]);
  assert.equal(send(c1, t1, 'awaiting-caller', ` ${t1.email.toUpperCase()} `).steps.length, 1, 'recipient compared case-insensitively');
  assert.equal(send(c1, t1, 'awaiting-caller', 'someone@else.example'), null);
  assert.equal(send(c1, t1, 'assignment'), null);
  const [c2, t2] = cases(w).find(([, x]) => x.class === 'awaiting-timeout');
  assert.equal(send(c2, t2, 'awaiting-caller'), null, 'no reply planned');
  const [c3, t3] = cases(w).find(([, x]) => x.caller?.confirm?.via === 'resolved');
  assert.equal(send(c3, t3, 'resolved').steps[0].at, t3.caller.confirm.at);
  const [c4, t4] = cases(w).find(([, x]) => x.source?.kind === 'alert');
  assert.equal(send(c4, t4, 'resolved', 'x@y'), null, 'an alert incident has no caller');
  const [c5, t5] = cases(w).find(([, x]) => x.class === 'reply-late' || x.class === 'hold-reassign');
  assert.ok(send(c5, t5, 'awaiting-caller').steps.length === 1, 'a late reply, or one after a reassignment, is still sent (it changes nothing)');
});

test('actors: incident managers answer by the approval plan; a re-ask gets a usable answer', () => {
  const plans = [];
  for (let seed = 1008; seed <= 1015; seed++) {
    const w = generateWorld({ seed, difficulty: 4 });
    for (const [c, t] of cases(w)) if (t.approval) plans.push({ w, c, a: t.approval });
  }
  const ask = ({ w, c }, ordinal = 1) => actors.answer(w, { case: c, kind: 'majorIncidentApproval', role: 'incidentManager', ordinal });
  const of = pred => plans.filter(x => pred(x.a));
  const decided = of(a => a.decision && a.delay !== undefined && a.delay < 30);
  const ties = of(a => a.delay === 30), none = of(a => a.none), late = of(a => a.late !== undefined), rejects = of(a => a.decision === 'reject');
  assert.ok(decided.length && none.length && late.length && rejects.length, `plans: ${decided.length} decided, ${none.length} silent, ${late.length} late, ${rejects.length} rejects, ${ties.length} ties`);
  for (const x of decided) { const r = ask(x); assert.deepEqual([r.value, r.delayMinutes], [{ decision: x.a.decision }, x.a.delay]); assert.ok(r.delayMinutes >= 5 && r.delayMinutes <= 28); }
  for (const x of ties) assert.equal(ask(x).delayMinutes, 30, 'an answer exactly at the deadline (S1)');
  for (const x of none) assert.equal(ask(x), null, 'silent: the task times out');
  for (const x of late) assert.ok(ask(x).delayMinutes >= 45, 'after the 30-minute deadline');
  for (const x of [...none, ...late, ...decided]) assert.deepEqual(ask(x, 2).value, { decision: x.a.decision ?? 'approve' }, 're-ask');
  assert.equal(actors.answer(decided[0].w, { case: decided[0].c, kind: 'fraudReview', ordinal: 1 }), null, 'unknown kind');
});

// ---------------------------------------------------------------------------------------------------------------------
// World + actors + systems in the real host

/** Run the walker arm; return the journal content rows and the run result. */
async function walk(world) {
  const host = createHost({ item: binding, world, arm: walkerArm() });
  const result = await host.run();
  return { rows: host.journal.contentRows(), journal: host.journal.rows, result };
}

test('host: a rule-following arm meets the whole planned timeline: no suppressed step, no arm error, no failed effect (d2-d5)', async () => {
  for (const [seed, d] of [[1009, 2], [1010, 3], [1011, 4], [1012, 5]]) {
    const w = generateWorld({ seed, difficulty: d, size: d === 5 ? 120 : 60 });
    const { rows, result } = await walk(w);
    assert.equal(result.status, 'complete');
    assert.deepEqual(rows.filter(r => r.type === 'arm.error'), [], `d${d} arm errors`);
    assert.deepEqual(rows.filter(r => r.type === 'counterparty.suppressed'), [], `d${d}: a planned step found the incident in another state`);
    assert.deepEqual(rows.filter(r => r.type === 'ledger' && !r.committed && !r.injected).map(r => `${r.system}.${r.op} ${r.error?.reason}`), [], `d${d} failed effects`);
    const scheduled = {};
    for (const r of rows.filter(x => x.type === 'counterparty.step')) scheduled[r.case] = (scheduled[r.case] ?? 0) + 1;
    for (const [c, t] of cases(w)) {
      if (!t.subject || t.backlog || msOf(t.plannedEnd) > msOf(w.horizonEnd)) continue;          // censored: its last steps lie past the horizon
      const want = t.steps.length + (t.caller.reply?.via ? 1 : 0) + (t.caller.confirm?.via ? 1 : 0);
      assert.equal(scheduled[c] ?? 0, want, `d${d} ${c} ${t.class}: planned resolver and caller steps`);
    }
    // The records the walker kept follow the plan where the plan decides them: withdrawals cancel, resolutions resolve.
    const committed = rows.filter(r => r.type === 'ledger' && r.committed && r.system === 'itsm');
    for (const [c, t] of cases(w)) {
      if (!t.subject || t.backlog) continue;
      if (t.caller.withdraw) assert.ok(committed.some(r => r.op === 'cancel' && r.subjectCase === c), `${c} withdrawn`);
      if (t.resolvedAt) assert.ok(committed.some(r => r.op === 'resolve' && r.subjectCase === c), `${c} resolved`);
    }
    if (d >= 5) assert.ok(rows.some(r => r.type === 'ledger' && r.injected && r.faultTags.includes('F1')), 'F1 injected on notify.send');
  }
});

test('host: approval tasks route past the caller (SoD) and answer by plan; a walker run replays byte-identically', async () => {
  const w = generateWorld({ seed: 1013, difficulty: 2, size: 60 });
  const { rows, journal } = await walk(w);
  const created = rows.filter(r => r.type === 'humanTask.created');
  assert.ok(created.length >= 1, 'approval tasks');
  for (const r of created) {
    const t = w.truth.cases[r.case];
    assert.ok(!r.task.excludeUsers.includes(r.user ?? '-'), 'never the excluded caller');
    if (t.approval?.none) assert.equal(r.noAnswer, 'actor-silent');
    else assert.equal(r.user, w.actorsPool.incidentManager.find(u => !r.task.excludeUsers.includes(u)));
  }
  const res = await replayRun({ item: binding, world: w, journal });
  assert.equal(res.ok, true, JSON.stringify(res.divergence ?? null).slice(0, 300));
});

test('leak: no truth-only label, plan field or case id reaches an arm (inputs, files, query results)', async () => {
  const w = generateWorld({ seed: 1014, difficulty: 5, size: 60 });
  const legit = new Set(['straight', 'withdraw', 'reassign', 'invalid']);
  const forbidden = [...new Set(cases(w).map(([, t]) => t.class))].filter(c => c.length > 6 && !legit.has(c));
  const seen = [];
  const inner = walkerArm();
  const spy = { id: 'spy', tick(input, ctx) {
    seen.push(JSON.stringify(input));
    seen.push(JSON.stringify(Object.fromEntries(Object.entries(ctx.files).filter(([p]) => !p.startsWith('spec/')))));
    for (const t of ['itsm.incidents', 'sla.slas', 'sla.escalations', 'notify.notifications']) seen.push(JSON.stringify(ctx.query(t, {})));
    return inner.tick(input, ctx);
  } };
  await createHost({ item: binding, world: w, arm: spy }).run();
  const all = seen.join('\n');
  for (const s of forbidden) assert.ok(!all.includes(`"${s}"`), `class label ${s} leaked`);
  for (const [c] of cases(w).slice(0, 40)) assert.ok(!all.includes(`"${c}"`), `case id ${c} leaked`);
  for (const s of ['"plannedEnd"', '"replyDeadline"', '"confirmDeadline"', '"ties"', '"guard"', '"approval"', '"recurOf"', '"fallbacks"', 'controlFlags', '"tail"', w.id]) assert.ok(!all.includes(s), `${s} leaked`);
  assert.ok(all.includes(w.publicId), 'the arm sees the opaque world id');
});
