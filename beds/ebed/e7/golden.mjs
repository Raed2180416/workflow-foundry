// E7 goldens (E-BED §9.1, contract §11; DESIGN.md §9): hand-derived histories fed straight to a reference transition,
// each with the expectation the rules give, cited. Every instant was derived by hand from the calendars (SCH-EU-STD
// Mon-Fri 09:00-17:00 Amsterdam, holidays 04-03 and 04-06; SCH-US-STD Mon-Fri 08:00-17:00 New York, holiday 03-20;
// SCH-AU-STD Mon-Fri 08:30-17:00 Sydney, holidays 04-03 and 04-06; SCH-EXT floating Mon-Sat 07:00-19:00; DST US 03-08,
// EU 03-29, AU end 04-05) and is written below in the zone the rule names. Exported as data + a runner, so the item suite
// and an oracle mutation tool run the same checks against the real transition and against every mutant. $0.
import { generateWorld } from './world.mjs';

const MIN = 60_000;
const ms = s => Date.parse(s);
const Z = s => new Date(ms(s)).toISOString().replace('.000Z', 'Z');
const W3 = generateWorld({ seed: 1001, difficulty: 3, mix: 'tail' });
const W4 = generateWorld({ seed: 1001, difficulty: 4, mix: 'tail' });
const user = (w, region, k = 0) => w.master.users.filter(u => u.region === region && u.roles.length === 1 && u.roles[0] === 'caller')[k];
const EU = user(W3, 'EU'), US = user(W3, 'US'), AU = user(W3, 'AU');
const G = id => W3.master.groups.find(g => g.group === id);

/** A synthetic history builder: events, approval tasks and answers in delivery order, and views of it. */
function builder(w = W3) {
  let seq = 0;
  const b = {
    report: (at, id, callerId, ci, category, urgency) => ({ id: `g-${++seq}`, type: 'incident.reported', at: ms(at), seq, source: 'portal', instance: 'g', round: 1,
      payload: { reportId: id, callerId, ci, category, urgency, summary: 'golden' } }),
    alert: (at, id, ci, check, severity) => ({ id: `g-${++seq}`, type: 'alert.raised', at: ms(at), seq, source: 'monitor', instance: 'g', round: 1,
      payload: { alertId: id, ci, check, severity, raisedAt: at } }),
    upd: (at, number, action, extra = {}) => ({ id: `g-${++seq}`, type: 'resolver.update', at: ms(at), seq, source: 'workspace', instance: 'g', round: 1,
      payload: { number, group: 'x', user: extra.user ?? 'u-resolver', action, ...extra } }),
    caller: (at, number, intent, from = EU.email) => ({ id: `g-${++seq}`, type: 'caller.message', at: ms(at), seq, source: 'mail', instance: 'g', round: 1,
      payload: { from, incidentRef: number, intent, text: 'golden' } }),
    task: (at, number, excludeUsers = [], id = 'mia#1') => ({ seq: ++seq, at: ms(at), instance: 'g', case: 'golden',
      task: { id, kind: 'majorIncidentApproval', role: 'incidentManager', excludeUsers, subject: number } }),
    answer: (at, decision, taskId = 'mia#1') => ({ seq: ++seq, at: ms(at), type: 'humanTask.answered', instance: 'g', case: 'golden',
      payload: { taskId, user: 'u-im2', answer: decision === null ? { text: 'not sure' } : { decision } } }),
    /** A task event other than an answer: `humanTask.answerRejected`, `humanTask.withdrawn`, `humanTask.timeout`. */
    taskEvent: (at, type, taskId = 'mia#1') => ({ seq: ++seq, at: ms(at), type, instance: 'g', case: 'golden', payload: { taskId, user: 'u-im2' } }),
    view: (at, subject, events, { tasks = [], taskEvents = [] } = {}) => ({ case: 'golden', at: ms(at), seq: Infinity, world: w,
      truth: { subject, start: events[0] ? new Date(events[0].at).toISOString() : null, class: 'golden', tail: true }, events, rows: [], tasks, taskEvents }),
  };
  return b;
}

const lids = E => E.effects.required.map(e => e.lid);
const find = (E, id) => E.effects.required.find(e => e.lid === id) ?? null;
const findBy = (E, pred) => E.effects.required.find(pred) ?? null;
const has = (E, id) => lids(E).includes(id);
/** A required lid with exactly this match subset and window (null fields not checked). */
function expect(E, id, { match = null, earliest = null, latest = null } = {}) {
  const e = find(E, id);
  if (!e) return `missing ${id} (have ${lids(E).filter(l => l.split(':')[0] === id.split(':')[0]).slice(0, 8).join(', ')})`;
  for (const [k, v] of Object.entries(match ?? {})) if (JSON.stringify(e.match[k]) !== JSON.stringify(v)) return `${id}: ${k} = ${JSON.stringify(e.match[k])}, expected ${JSON.stringify(v)}`;
  if (earliest !== null && e.window.earliest !== ms(earliest)) return `${id}: window opens ${new Date(e.window.earliest).toISOString()}, expected ${Z(earliest)}`;
  if (latest !== null && e.window.latest !== ms(latest)) return `${id}: window closes ${new Date(e.window.latest).toISOString()}, expected ${Z(latest)}`;
  return true;
}
const all = (...rs) => rs.find(r => r !== true) ?? true;

/** Each golden: { name, source (rules), check(transition, recordsOf) -> true | string (why it failed) }. */
export const goldens = [];
const golden = (name, source, check) => goldens.push({ name, source, check });

// ---------------------------------------------------------------------------------------------------------------------
// G1 R2.2: the 9-cell matrix on services without an override; the overrides win by lowest `order` (wildcard rows come
// first in the file, so a first-match reader gets every override wrong).
{
  const cells = [['CI-SW-AMS1', 1, 1, 1], ['CI-SW-AMS1', 1, 2, 2], ['CI-SW-AMS1', 1, 3, 3], ['CI-OMS-APP1', 2, 1, 2], ['CI-OMS-APP1', 2, 2, 3], ['CI-OMS-APP1', 2, 3, 4],
    ['CI-LT-EU', 3, 1, 3], ['CI-LT-EU', 3, 2, 4], ['CI-LT-EU', 3, 3, 5], ['CI-CRM-APP1', 1, 2, 2],
    ['CI-INTRA-WEB1', 1, 1, 2], ['CI-PAY-APP1', 2, 1, 1], ['CI-PAY-APP1', 2, 2, 2]];
  golden('G1 priority matrix and overrides (lowest order wins)', 'R2.1, R2.2', tr => {
    for (const [i, [ci, impact, urgency, want]] of cells.entries()) {
      const B = builder(), N = `INC-RPT-G1-${100 + i}`;
      const E = tr(W3, B.view('2026-03-10T10:01:00+01:00', N, [B.report('2026-03-10T10:00:00+01:00', N.slice(4), EU.userId, ci, 'software', urgency)]));
      const c = find(E, `create:${N}`);
      if (!c) return `${ci} ${impact}/${urgency}: no create`;
      if (c.match.impact !== impact || c.match.priority !== want) return `${ci} ${impact}/${urgency}: priority ${c.match.priority} (impact ${c.match.impact}), expected ${want}`;
      if (E.decisions.graded.priority !== want) return `${ci}: decision priority ${E.decisions.graded.priority}`;
    }
    return true;
  });
}

// G2 R4.4, R5, S4: RES-P3 (1440 business min, SCH-EU-STD) opened Thu 2026-04-02 15:00+02:00 across Easter.
//   Thu 15:00-17:00 120; Fri 04-03 and Mon 04-06 holidays; Tue 480 (600); Wed 09:00 + 120 = 11:00 (50%, 720);
//   Wed 17:00 = 1080 exactly (75%, reached at the close); Thu 04-09 09:00 + 360 = 15:00 (breach).
golden('G2 Easter: holidays skipped, a threshold reached at a closing time stays there', 'R4.4, R5.1, S4', tr => {
  const B = builder(), N = 'INC-RPT-G2-0001', S = `${N}/RES-P3/1`;
  const E = tr(W3, B.view('2026-04-02T15:01:00+02:00', N, [B.report('2026-04-02T15:00:00+02:00', 'RPT-G2-0001', EU.userId, 'CI-LT-EU', 'hardware', 1)]));
  return all(
    expect(E, `sla:${S}:start`, { match: { startAt: Z('2026-04-02T15:00:00+02:00'), schedule: 'SCH-EU-STD', timezone: 'Europe/Amsterdam', plannedBreachAt: Z('2026-04-09T15:00:00+02:00') } }),
    expect(E, `esc:${S}:50`, { earliest: '2026-04-08T11:00:00+02:00', match: { to: G('GRP-SD-EU').mailbox } }),
    expect(E, `esc:${S}:75`, { earliest: '2026-04-08T17:00:00+02:00', match: { to: G('GRP-SD-EU').managerEmail } }),
    expect(E, `sla:${S}:breach`, { match: { at: Z('2026-04-09T15:00:00+02:00') }, earliest: '2026-04-09T15:00:00+02:00', latest: '2026-04-09T15:15:00+02:00' }),
    expect(E, `esc:${S}:100`, { earliest: '2026-04-09T15:00:00+02:00', match: { to: 'incident-managers@hollin-group.example' } }));
});

// G3 R4.4: business time across the EU DST change: opened Fri 2026-03-27 16:00+01:00; Fri 60, Mon 03-30 480, Tue 480,
// Wed 09:00 + 420 = 16:00+02:00 (14:00Z), not 15:00Z as fixed-offset arithmetic would give.
golden('G3 EU DST on a business schedule', 'R4.4', tr => {
  const B = builder(), N = 'INC-RPT-G3-0001';
  const E = tr(W3, B.view('2026-03-27T16:01:00+01:00', N, [B.report('2026-03-27T16:00:00+01:00', 'RPT-G3-0001', EU.userId, 'CI-LT-EU', 'hardware', 1)]));
  return expect(E, `sla:${N}/RES-P3/1:breach`, { match: { at: '2026-04-01T14:00:00Z' } });
});

// G4 R4.4: 24x7 across a DST night counts elapsed (UTC) minutes: RES-P1 (240) opened at 01:30 local on the change night.
for (const [zone, ci, check, at, pct50, pct75, breach] of [
  ['EU', 'CI-SW-AMS1', 'ping', '2026-03-29T01:30:00+01:00', '2026-03-29T04:30:00+02:00', '2026-03-29T05:30:00+02:00', '2026-03-29T06:30:00+02:00'],
  ['US', 'CI-CRM-APP1', 'http', '2026-03-08T01:30:00-05:00', '2026-03-08T04:30:00-04:00', '2026-03-08T05:30:00-04:00', '2026-03-08T06:30:00-04:00'],
  ['AU', 'CI-TRD-SYD1', 'ping', '2026-04-05T01:30:00+11:00', '2026-04-05T02:30:00+10:00', '2026-04-05T03:30:00+10:00', '2026-04-05T04:30:00+10:00'],
]) {
  golden(`G4 24x7 across the ${zone} DST night`, 'R4.4, R5.1', tr => {
    const B = builder(), N = `INC-ALR-G4-${zone}`, S = `${N}/RES-P1/1`;
    const E = tr(W3, B.view(new Date(ms(at) + MIN).toISOString(), N, [B.alert(at, `ALR-G4-${zone}`, ci, check, 'critical')]));
    return all(
      expect(E, `sla:${S}:start`, { match: { schedule: null, timezone: null, plannedBreachAt: Z(breach) } }),
      expect(E, `esc:${S}:50`, { earliest: pct50 }), expect(E, `esc:${S}:75`, { earliest: pct75 }), expect(E, `sla:${S}:breach`, { match: { at: Z(breach) } }));
  });
}

// G5 R4.3, R4.4: RSP-STD (240) on the group's schedule SCH-US-STD, attached Fri 2026-03-06 15:00-05:00: Fri 120,
// Mon 03-09 (EDT) 08:00 + 120 = 10:00-04:00 (14:00Z). In the system zone it would be 07:00-04:00.
golden('G5 response SLA on a New York group schedule across the US DST change', 'R4.3, R4.4', tr => {
  const B = builder(), N = 'INC-RPT-G5-0001', S = `${N}/RSP-STD/1`;
  const E = tr(W3, B.view('2026-03-06T15:01:00-05:00', N, [B.report('2026-03-06T15:00:00-05:00', 'RPT-G5-0001', US.userId, 'CI-OMS-APP1', 'software', 2)]));
  return all(expect(E, `asg:${N}:1`, { match: { group: 'GRP-APP-US' } }),
    expect(E, `sla:${S}:start`, { match: { schedule: 'SCH-US-STD', timezone: 'America/New_York', plannedBreachAt: '2026-03-09T14:00:00Z' } }));
});

// G6 R4.4: RSP-STD on SCH-AU-STD attached Thu 2026-04-02 16:00+11:00: Thu 60; Fri 04-03 and Mon 04-06 holidays; AU DST
// ends Sun 04-05; Tue 04-07 08:30 + 180 = 11:30+10:00 (01:30Z).
golden('G6 Sydney group across AU Easter and the AU DST end', 'R4.3, R4.4', tr => {
  const B = builder(), N = 'INC-RPT-G6-0001';
  const E = tr(W3, B.view('2026-04-02T16:01:00+11:00', N, [B.report('2026-04-02T16:00:00+11:00', 'RPT-G6-0001', AU.userId, 'CI-TRD-SYD1', 'software', 3)]));
  return expect(E, `sla:${N}/RSP-STD/1:start`, { match: { schedule: 'SCH-AU-STD', timezone: 'Australia/Sydney', plannedBreachAt: '2026-04-07T01:30:00Z' } });
});

// G7 R4.3 time-zone precedence on the floating SCH-EXT (Mon-Sat 07:00-19:00, no holidays): RES-P2 (600).
//   A New York caller's report Fri 2026-03-06 17:00-05:00: Fri 120, Sat 07:00 + 480 = 15:00-05:00 (caller's zone).
//   An alert on a Sydney CI Fri 2026-04-03 (Good Friday is no holiday on SCH-EXT) 18:00+11:00: Fri 60, Sat 07:00 + 540 =
//   16:00+11:00 (no caller: the CI's zone).
golden('G7 floating schedule bound by caller, then CI', 'R4.3', tr => {
  const B = builder();
  const E1 = tr(W3, B.view('2026-03-06T17:01:00-05:00', 'INC-RPT-G7-0001', [B.report('2026-03-06T17:00:00-05:00', 'RPT-G7-0001', US.userId, 'CI-OMS-APP1', 'software', 1)]));
  const E2 = tr(W3, B.view('2026-04-03T18:01:00+11:00', 'INC-ALR-G7-0002', [B.alert('2026-04-03T18:00:00+11:00', 'ALR-G7-0002', 'CI-TRD-SYD1', 'cpu', 'major')]));
  return all(
    expect(E1, 'sla:INC-RPT-G7-0001/RES-P2/1:start', { match: { schedule: 'SCH-EXT', timezone: 'America/New_York', plannedBreachAt: Z('2026-03-07T15:00:00-05:00') } }),
    expect(E2, 'sla:INC-ALR-G7-0002/RES-P2/1:start', { match: { schedule: 'SCH-EXT', timezone: 'Australia/Sydney', plannedBreachAt: Z('2026-04-04T16:00:00+11:00') } }));
});

// G21 R4.4 (review 2026-10-15 round 2): an interval that contains a clock change counts each real instant once. No slice-1
// schedule has one, so the golden binds RES-P2 (600, floating SCH-EXT, the caller's zone Europe/Amsterdam) to a world copy
// whose SCH-EXT is a night shift, every day 01:30-03:30 local, no holidays.
//   Spring, opened Sat 2026-03-28 04:00+01:00: Sun 03-29 01:30 CET (00:30Z) to the first 03:30 CEST (01:30Z) = 60; Mon-Thu
//   120 each (cum 540); Fri 04-03 01:30 CEST + 60 = 02:30 CEST (00:30Z). 50% (300) Tue 03-31 03:30 CEST (01:30Z), at a
//   close (S4); 75% (450) Thu 04-02 02:00 CEST (00:00Z).
//   Autumn, opened Sat 2026-10-24 04:00+02:00: Sun 10-25 01:30 CEST (23:30Z the day before) to the first 03:30, which is
//   03:30 CET (02:30Z) = 180; Mon-Wed 120 each (cum 540); Thu 10-29 01:30 CET + 60 = 02:30 CET (01:30Z). Counting the
//   repeated hour once would give 120 on Sunday and D at Thu 03:30 CET (02:30Z). 50% (300) Mon 10-26 03:30 CET (02:30Z).
{
  const night = { ...structuredClone(W3.calendars['SCH-EXT']), businessHours: { days: [1, 2, 3, 4, 5, 6, 7], hours: [['01:30', '03:30']] }, holidays: [] };
  const WN = { ...W3, calendars: { ...W3.calendars, 'SCH-EXT': night } };
  golden('G21 an interval across a clock change counts real time (60 min in spring, 180 in autumn)', 'R4.3, R4.4, R5.1, S4', tr => {
    const out = [];
    for (const [N, at, D, p50, p75] of [['INC-RPT-G21-0001', '2026-03-28T04:00:00+01:00', '2026-04-03T00:30:00Z', '2026-03-31T01:30:00Z', '2026-04-02T00:00:00Z'],
      ['INC-RPT-G21-0002', '2026-10-24T04:00:00+02:00', '2026-10-29T01:30:00Z', '2026-10-26T02:30:00Z', '2026-10-28T01:00:00Z']]) {
      const B = builder(WN), S = `${N}/RES-P2/1`;
      const E = tr(WN, B.view(new Date(ms(at) + MIN).toISOString(), N, [B.report(at, N.slice(4), EU.userId, 'CI-SW-AMS1', 'software', 2)]));
      out.push(expect(E, `sla:${S}:start`, { match: { schedule: 'SCH-EXT', timezone: 'Europe/Amsterdam', plannedBreachAt: D } }),
        expect(E, `sla:${S}:breach`, { match: { at: D }, earliest: D }), expect(E, `esc:${S}:50`, { earliest: p50 }), expect(E, `esc:${S}:75`, { earliest: p75 }));
    }
    return all(...out);
  });
}

// G8 R4.4-R4.6, R5, S3: RES-P3 (1440) opened Mon 2026-03-09 10:00+01:00; hold awaitingCaller Tue 14:00; reply Thu 11:00;
// resolved Fri 12:00. Planned at start Thu 10:00 (Mon 420, Tue 480, Wed 480, Thu 60). Business at the hold: 420 + 300 =
// 720 = 50%, reached at the pause instant (S3). Resume Thu 11:00 with 720 left: Thu 360, Fri 09:00 + 360 = 15:00. 75%
// (1080) at Thu 17:00. Stop Fri 12:00: business 720 + 360 + 180 = 1260; running wall time Mon 10:00-Tue 14:00 (1680) +
// Thu 11:00-Fri 12:00 (1500) = 3180; not breached.
golden('G8 pause arithmetic: planned breach, thresholds, stop values', 'R4.4, R4.5, R4.6, R5.1, S3', tr => {
  const B = builder(), N = 'INC-RPT-G8-0001', S = `${N}/RES-P3/1`;
  const evs = [B.report('2026-03-09T10:00:00+01:00', 'RPT-G8-0001', EU.userId, 'CI-LT-EU', 'hardware', 1), B.upd('2026-03-09T10:30:00+01:00', N, 'accept'),
    B.upd('2026-03-10T14:00:00+01:00', N, 'hold', { holdReason: 'awaitingCaller' }), B.caller('2026-03-12T11:00:00+01:00', N, 'reply'),
    B.upd('2026-03-13T12:00:00+01:00', N, 'resolve', { closeCode: 'fixed' })];
  const E = tr(W3, B.view('2026-03-13T12:01:00+01:00', N, evs));
  return all(
    expect(E, `sla:${S}:start`, { match: { plannedBreachAt: Z('2026-03-12T10:00:00+01:00') } }),
    expect(E, `sla:${S}:pause:${Z('2026-03-10T14:00:00+01:00')}`, { earliest: '2026-03-10T14:00:00+01:00' }),
    expect(E, `esc:${S}:50`, { earliest: '2026-03-10T14:00:00+01:00' }),
    expect(E, `sla:${S}:resume:${Z('2026-03-12T11:00:00+01:00')}`, { match: { plannedBreachAt: Z('2026-03-13T15:00:00+01:00') } }),
    expect(E, `esc:${S}:75`, { earliest: '2026-03-12T17:00:00+01:00' }),
    expect(E, `sla:${S}:stop`, { match: { at: Z('2026-03-13T12:00:00+01:00'), elapsedMinutes: 3180, businessElapsedMinutes: 1260, breached: false } }),
    has(E, `sla:${S}:breach`) ? 'breached during the pause' : true,
    expect(E, `res:${N}:${Z('2026-03-12T11:00:00+01:00')}`, { match: { at: Z('2026-03-12T11:00:00+01:00') } }));
});

// G9 R6.1-R6.3, S1, S10: hold awaitingCaller Fri 2026-03-13 16:00+01:00; D = 3 business days of SCH-EU-STD = Wed 03-18
// 16:00. A reply at D counts; without one the closure is due in (D, D + 60 min] dated D; a reply at D + 1 min is late.
{
  const N = 'INC-RPT-G9-0001', D = '2026-03-18T16:00:00+01:00';
  const base = B => [B.report('2026-03-13T10:00:00+01:00', 'RPT-G9-0001', EU.userId, 'CI-LT-EU', 'hardware', 2), B.upd('2026-03-13T10:30:00+01:00', N, 'accept'),
    B.upd('2026-03-13T16:00:00+01:00', N, 'hold', { holdReason: 'awaitingCaller' })];
  golden('G9 caller deadline: reply at D counts, closure strictly after D, late reply ignored', 'R6.1, R6.2, R6.3, S1, S10', tr => {
    let B = builder();
    const none = tr(W3, B.view('2026-03-18T16:02:00+01:00', N, base(B)));
    const r1 = all(expect(none, `ntf:${N}:awaiting-caller`, { match: { to: EU.email }, earliest: '2026-03-13T16:00:00+01:00' }),
      expect(none, `cls:${N}:no-caller-response`, { match: { reason: 'no-caller-response', at: Z(D) }, earliest: new Date(ms(D) + 1000).toISOString(), latest: '2026-03-18T17:00:00+01:00' }),
      expect(none, `ntf:${N}:closed-no-response`, { earliest: new Date(ms(D) + 1000).toISOString() }),
      expect(none, `sla:${N}/RES-P4/1:stop`, { match: { at: Z(D) }, earliest: new Date(ms(D) + 1000).toISOString(), latest: '2026-03-18T17:00:00+01:00' }),
      none.terminal ? true : 'not terminal after the closure');
    if (r1 !== true) return `no reply: ${r1}`;
    B = builder();
    const atD = tr(W3, B.view('2026-03-18T16:02:00+01:00', N, [...base(B), B.caller(D, N, 'reply')]));
    if (!has(atD, `res:${N}:${Z(D)}`) || has(atD, `cls:${N}:no-caller-response`)) return 'a reply exactly at D did not count';
    B = builder();
    const late = tr(W3, B.view('2026-03-18T16:03:00+01:00', N, [...base(B), B.caller('2026-03-18T16:01:00+01:00', N, 'reply')]));
    if (findBy(late, e => e.lid.startsWith(`res:${N}:`)) || !has(late, `cls:${N}:no-caller-response`)) return 'a reply after D counted';
    B = builder();
    const before = tr(W3, B.view('2026-03-18T15:59:00+01:00', N, base(B)));
    return expect(before, `cls:${N}:no-caller-response`, { earliest: new Date(ms(D) + 1000).toISOString() }) === true ? true : 'closure not projected before D';
  });
}

// G9b R6.1: hold Thu 2026-04-02 10:00+02:00 across Easter: Thu 420, Tue 480, Wed 480, Thu 09:00 + 60 = 10:00+02:00.
golden('G9b caller deadline across Easter', 'R6.1, R4.4', tr => {
  const B = builder(), N = 'INC-RPT-G9-0002';
  const E = tr(W3, B.view('2026-04-02T10:01:00+02:00', N, [B.report('2026-04-01T10:00:00+02:00', 'RPT-G9-0002', EU.userId, 'CI-LT-EU', 'hardware', 2),
    B.upd('2026-04-01T10:30:00+02:00', N, 'accept'), B.upd('2026-04-02T10:00:00+02:00', N, 'hold', { holdReason: 'awaitingCaller' })]));
  return expect(E, `cls:${N}:no-caller-response`, { match: { at: Z('2026-04-09T10:00:00+02:00') } });
});

// G10 R6.4, R6.5: resolved Fri 2026-03-06 12:00+01:00; D2 = 2 business days = Tue 03-10 12:00. A confirmation before D2
// closes at its own time; without one the closure is due in (D2, D2 + 60 min] dated D2.
golden('G10 resolved: confirmation or auto-closure at D2', 'R6.4, R6.5, S1', tr => {
  const N = 'INC-RPT-G10-0001', D2 = '2026-03-10T12:00:00+01:00';
  const base = B => [B.report('2026-03-06T10:00:00+01:00', 'RPT-G10-0001', EU.userId, 'CI-LT-EU', 'hardware', 2), B.upd('2026-03-06T10:30:00+01:00', N, 'accept'),
    B.upd('2026-03-06T12:00:00+01:00', N, 'resolve', { closeCode: 'fixed' })];
  let B = builder();
  const E = tr(W3, B.view('2026-03-10T12:01:00+01:00', N, base(B)));
  const r = all(expect(E, `ntf:${N}:resolved`, { match: { to: EU.email } }),
    expect(E, `cls:${N}:auto`, { match: { reason: 'auto', at: Z(D2) }, earliest: new Date(ms(D2) + 1000).toISOString(), latest: '2026-03-10T13:00:00+01:00' }));
  if (r !== true) return r;
  B = builder();
  const C = tr(W3, B.view('2026-03-09T11:01:00+01:00', N, [...base(B), B.caller('2026-03-09T11:00:00+01:00', N, 'confirm')]));
  return all(expect(C, `cls:${N}:confirmed`, { match: { at: Z('2026-03-09T11:00:00+01:00') } }), has(C, `cls:${N}:auto`) ? 'auto-closure still required' : true, C.terminal ? true : 'not terminal');
});

// G11 R4.2, R4.3: opened Mon 2026-03-16 09:00+01:00 at P4; on hold awaiting the caller 13:00-15:00 (reply); reclassified
// to P3 Tue 03-17 13:00. RES-P4 is cancelled `start-failed`; RES-P3 gen 1 starts at openedAt with the past pause
// 13:00-15:00: business at attach Mon 240 + 120 + Tue 240 = 600; planned Tue 13:00 + 840 = Thu 03-19 11:00 (the start
// record plans from startAt without pauses: Mon 480 + Tue 480 + Wed 480 = Wed 03-18 17:00, a close, S4).
golden('G11 retroactive start with a retroactive pause', 'R4.2, R4.3, R4.5', tr => {
  const B = builder(), N = 'INC-RPT-G11-0001', S = `${N}/RES-P3/1`, x = '2026-03-17T13:00:00+01:00';
  const E = tr(W3, B.view('2026-03-17T13:01:00+01:00', N, [B.report('2026-03-16T09:00:00+01:00', 'RPT-G11-0001', EU.userId, 'CI-LT-EU', 'hardware', 2),
    B.upd('2026-03-16T10:00:00+01:00', N, 'accept'), B.upd('2026-03-16T13:00:00+01:00', N, 'hold', { holdReason: 'awaitingCaller' }),
    B.caller('2026-03-16T15:00:00+01:00', N, 'reply'), B.upd(x, N, 'reclassify', { urgency: 1 })]));
  return all(
    expect(E, `sla:${N}/RES-P4/1:cancel`, { match: { reason: 'start-failed', at: Z(x) } }),
    expect(E, `sla:${S}:start`, { match: { startAt: Z('2026-03-16T09:00:00+01:00'), plannedBreachAt: Z('2026-03-18T17:00:00+01:00') }, earliest: x }),
    expect(E, `sla:${S}:pause:${Z('2026-03-16T13:00:00+01:00')}`, { earliest: x, latest: '2026-03-17T13:15:00+01:00' }),
    expect(E, `sla:${S}:resume:${Z('2026-03-16T15:00:00+01:00')}`, { match: { plannedBreachAt: Z('2026-03-19T11:00:00+01:00') }, earliest: x }),
    expect(E, `esc:${S}:50`, { earliest: '2026-03-17T15:00:00+01:00' }));
});

// G11b R4.3, S13, S14: opened Mon 2026-03-16 09:00+01:00 at P4, accepted 10:00, on hold awaiting the caller Mon 14:00;
// reclassified to P3 Tue 03-17 10:00 during the hold (x); the caller replies Tue 15:00. RES-P4 is cancelled
// `start-failed` at x; RES-P3 gen 1 attaches paused at x (S14), its pause starting Mon 14:00 where the current pause
// interval began. The start record plans from startAt as if never paused (S13): Mon 480 + Tue 480 + Wed 480 = Wed 03-18
// 17:00 (a close, S4), not null. Business at x: Mon 09:00-14:00 = 300; while paused no breach and no threshold is due.
// The resume Tue 15:00 plans with 1140 left: Tue 120, Wed 480, Thu 480, Fri 03-20 09:00 + 60 = 10:00. 50% (720) Wed
// 03-18 14:00 (Tue 17:00 at 420, Wed 09:00 + 300); 75% (1080) Thu 03-19 12:00.
golden('G11b retroactive start that attaches paused', 'R4.3, R4.5, S13, S14', tr => {
  const B = builder(), N = 'INC-RPT-G11-0002', S = `${N}/RES-P3/1`, x = '2026-03-17T10:00:00+01:00', h = '2026-03-16T14:00:00+01:00';
  const evs = [B.report('2026-03-16T09:00:00+01:00', 'RPT-G11-0002', EU.userId, 'CI-LT-EU', 'hardware', 2), B.upd('2026-03-16T10:00:00+01:00', N, 'accept'),
    B.upd(h, N, 'hold', { holdReason: 'awaitingCaller' }), B.upd(x, N, 'reclassify', { urgency: 1 })];
  const E = tr(W3, B.view('2026-03-17T10:01:00+01:00', N, evs));
  const r = all(
    expect(E, `sla:${N}/RES-P4/1:cancel`, { match: { reason: 'start-failed', at: Z(x) } }),
    expect(E, `sla:${S}:start`, { match: { startAt: Z('2026-03-16T09:00:00+01:00'), plannedBreachAt: Z('2026-03-18T17:00:00+01:00') }, earliest: x, latest: '2026-03-17T10:15:00+01:00' }),
    expect(E, `sla:${S}:pause:${Z(h)}`, { earliest: x, latest: '2026-03-17T10:15:00+01:00' }),
    findBy(E, e => e.lid.startsWith(`sla:${S}:resume:`) || e.lid === `sla:${S}:breach` || e.lid.startsWith(`esc:${S}:`)) ? `paused at the attach, yet ${lids(E).filter(l => l.includes(S)).join(' ')}` : true);
  if (r !== true) return `at the attach: ${r}`;
  const B2 = builder();
  const evs2 = [B2.report('2026-03-16T09:00:00+01:00', 'RPT-G11-0002', EU.userId, 'CI-LT-EU', 'hardware', 2), B2.upd('2026-03-16T10:00:00+01:00', N, 'accept'),
    B2.upd(h, N, 'hold', { holdReason: 'awaitingCaller' }), B2.upd(x, N, 'reclassify', { urgency: 1 }), B2.caller('2026-03-17T15:00:00+01:00', N, 'reply')];
  const E2 = tr(W3, B2.view('2026-03-17T15:01:00+01:00', N, evs2));
  return all(
    expect(E2, `sla:${S}:start`, { match: { plannedBreachAt: Z('2026-03-18T17:00:00+01:00') } }),
    expect(E2, `sla:${S}:resume:${Z('2026-03-17T15:00:00+01:00')}`, { match: { plannedBreachAt: Z('2026-03-20T10:00:00+01:00') }, earliest: '2026-03-17T15:00:00+01:00' }),
    expect(E2, `esc:${S}:50`, { earliest: '2026-03-18T14:00:00+01:00' }),
    expect(E2, `esc:${S}:75`, { earliest: '2026-03-19T12:00:00+01:00' }),
    lids(E2).filter(l => l.startsWith(`sla:${S}:resume:`)).length === 1 ? true : `resumes ${lids(E2).filter(l => l.startsWith(`sla:${S}:resume:`))}`);
});

// G20 R4.3 (review 2026-10-15 round 2): a retroactive pause that ends at the very instant the SLA attaches. A P3 report on
// CI-SW-AMS1 (impact 1, urgency 3) opened Tue 2026-03-10 10:00+01:00, accepted 10:10, on hold awaiting the caller 10:30;
// at 11:30 the caller replies and a resolver raises urgency to 1 in the same instant (one merged change: inProgress, P1).
// RES-P1 (240, 24x7, retroactive with retroactivePause) attaches at 11:30 with startAt 10:00 and the past pause
// [10:30, 11:30): start (planned 14:00, S13), pause 10:30, resume 11:30 (planned 30 + 210 = 15:00), all due from 11:30.
// Running 10:00-10:30 (30) and from 11:30: 50% (120) at 13:00, 75% (180) at 14:00, breach at 15:00. RES-P3, paused
// since 10:30, is cancelled `start-failed` at 11:30. Before the fix the pause was dropped: D 14:00, 50% at 12:00.
golden('G20 retroactive pause ending at the attach instant (a reply merged with the reclassification)', 'R4.2, R4.3, R4.5, R5.1, S13', tr => {
  const B = builder(), N = 'INC-RPT-G20-0001', S = `${N}/RES-P1/1`, x = '2026-03-10T11:30:00+01:00', h = '2026-03-10T10:30:00+01:00';
  const E = tr(W3, B.view('2026-03-10T11:31:00+01:00', N, [B.report('2026-03-10T10:00:00+01:00', 'RPT-G20-0001', EU.userId, 'CI-SW-AMS1', 'software', 3),
    B.upd('2026-03-10T10:10:00+01:00', N, 'accept'), B.upd(h, N, 'hold', { holdReason: 'awaitingCaller' }), B.caller(x, N, 'reply'), B.upd(x, N, 'reclassify', { urgency: 1 })]));
  return all(
    expect(E, `sla:${N}/RES-P3/1:cancel`, { match: { reason: 'start-failed', at: Z(x) } }),
    expect(E, `sla:${S}:start`, { match: { startAt: Z('2026-03-10T10:00:00+01:00'), plannedBreachAt: Z('2026-03-10T14:00:00+01:00') }, earliest: x, latest: '2026-03-10T11:45:00+01:00' }),
    expect(E, `sla:${S}:pause:${Z(h)}`, { earliest: x, latest: '2026-03-10T11:45:00+01:00' }),
    expect(E, `sla:${S}:resume:${Z(x)}`, { match: { at: Z(x), plannedBreachAt: Z('2026-03-10T15:00:00+01:00') }, earliest: x, latest: '2026-03-10T11:45:00+01:00' }),
    expect(E, `esc:${S}:50`, { earliest: '2026-03-10T13:00:00+01:00' }),
    expect(E, `esc:${S}:75`, { earliest: '2026-03-10T14:00:00+01:00' }),
    expect(E, `sla:${S}:breach`, { match: { at: Z('2026-03-10T15:00:00+01:00') } }));
});

// G12 R4.2 reset and re-attach: a P3 incident (RSP-STD on the group's schedule) opened Fri 2026-03-06 16:00+01:00,
// bounced to New York Fri 21:00+01:00 before acceptance: gen 1 cancelled `reset`, gen 2 starts 21:00+01:00 on SCH-US-STD
// (Fri 15:00-17:00 EST 120; Mon 03-09 08:00 EDT + 120 = 10:00-04:00). Accepted Mon 09:00-04:00 (gen 2 stops); reassigned
// back to Europe Mon 11:00-04:00: gen 3 attaches at once (start holds, none in progress) on SCH-EU-STD.
golden('G12 reset on reassignment and re-attach after acceptance', 'R4.2, R4.3', tr => {
  const B = builder(), N = 'INC-RPT-G12-0001', x = '2026-03-06T21:00:00+01:00', y = '2026-03-09T11:00:00-04:00';
  const E = tr(W3, B.view('2026-03-09T11:01:00-04:00', N, [B.report('2026-03-06T16:00:00+01:00', 'RPT-G12-0001', EU.userId, 'CI-LT-EU', 'hardware', 1),
    B.upd(x, N, 'reassign', { toGroup: 'GRP-APP-US' }), B.upd('2026-03-09T09:00:00-04:00', N, 'accept'), B.upd(y, N, 'reassign', { toGroup: 'GRP-SD-EU' })]));
  return all(
    expect(E, `sla:${N}/RSP-STD/1:cancel`, { match: { reason: 'reset', at: Z(x) } }),
    expect(E, `sla:${N}/RSP-STD/2:start`, { match: { startAt: Z(x), schedule: 'SCH-US-STD', timezone: 'America/New_York', plannedBreachAt: Z('2026-03-09T10:00:00-04:00') } }),
    expect(E, `sla:${N}/RSP-STD/2:stop`, { match: { at: Z('2026-03-09T09:00:00-04:00'), businessElapsedMinutes: 180, breached: false } }),
    expect(E, `sla:${N}/RSP-STD/3:start`, { match: { startAt: Z(y), schedule: 'SCH-EU-STD' } }),
    expect(E, `asg:${N}:2`, { match: { group: 'GRP-APP-US' } }), expect(E, `ntf:${N}:assignment:2`, { match: { to: G('GRP-APP-US').mailbox } }),
    has(E, `sla:${N}/RES-P3/2:start`) ? 'the resolution SLA was reset' : true);
});

// G13 R0, R4.3, S6, S12 (d4): opened Fri 2026-03-20 10:00+01:00 at P4, reclassified to P3 Mon 03-23 10:00 (edition 2 in
// force): RES-P3 uses ed-2's 960 minutes: business at attach Fri 420 + Mon 60 = 480 = 50% reached exactly at the attach
// (due from it); 75% (720) Mon 14:00; planned Tue 03-24 10:00. Edition 1's 1440 would plan Wed 03-25 10:00.
golden('G13 definition edition at the attach instant', 'R0, R4.3, S6, S12', tr => {
  const B = builder(W4), N = 'INC-RPT-G13-0001', S = `${N}/RES-P3/1`, x = '2026-03-23T10:00:00+01:00';
  const E = tr(W4, B.view('2026-03-23T10:01:00+01:00', N, [B.report('2026-03-20T10:00:00+01:00', 'RPT-G13-0001', EU.userId, 'CI-LT-EU', 'hardware', 2),
    B.upd('2026-03-20T10:30:00+01:00', N, 'accept'), B.upd(x, N, 'reclassify', { urgency: 1 })]));
  return all(
    expect(E, `sla:${S}:start`, { match: { startAt: Z('2026-03-20T10:00:00+01:00'), plannedBreachAt: Z('2026-03-24T10:00:00+01:00') }, earliest: x }),
    expect(E, `esc:${S}:50`, { earliest: x, latest: '2026-03-23T10:15:00+01:00' }),
    expect(E, `esc:${S}:75`, { earliest: '2026-03-23T14:00:00+01:00' }),
    expect(E, `sla:${S}:breach`, { match: { at: Z('2026-03-24T10:00:00+01:00') } }));
});

// G14 R7, S1, S11: a P1 incident whose caller is an incident manager (u-im1), opened Mon 2026-03-09 10:00+01:00; the task
// is created 10:05, so the deadline is 10:35. An answer at 10:35 counts; none: the declaration is due in (10:35, 10:50]
// dated 10:35; resolved at 10:20 before any answer: moot; the caller must be excluded.
{
  const N = 'INC-RPT-G14-0001', owner = W3.master.services.find(s => s.service === 'SVC-PAYROLL').owner;
  const open = B => [B.report('2026-03-09T10:00:00+01:00', 'RPT-G14-0001', 'u-im1', 'CI-PAY-APP1', 'software', 1)];
  golden('G14 major-incident approval: deadline, tie, fail-safe, moot, separation of duties', 'R7.1, R7.2, R7.3, S1, S11', tr => {
    let B = builder();
    const E0 = tr(W3, B.view('2026-03-09T10:01:00+01:00', N, open(B)));
    const tk = E0.humanTasks.required.find(t => t.lid === `mia:${N}`);
    if (!tk || tk.window.earliest !== ms('2026-03-09T10:00:00+01:00') || tk.window.latest !== ms('2026-03-09T10:15:00+01:00') || !tk.mustExclude.includes('u-im1')) return `task ${JSON.stringify(tk)}`;
    B = builder();
    let ev = open(B), t = B.task('2026-03-09T10:05:00+01:00', N, ['u-im1']);
    const E1 = tr(W3, B.view('2026-03-09T10:36:00+01:00', N, ev, { tasks: [t], taskEvents: [B.answer('2026-03-09T10:35:00+01:00', 'approve')] }));
    const r1 = all(expect(E1, `maj:${N}:approved`, { match: { at: Z('2026-03-09T10:35:00+01:00') }, earliest: '2026-03-09T10:35:00+01:00' }),
      expect(E1, `ntf:${N}:major-incident`, { match: { to: owner } }));
    if (r1 !== true) return `answer at the deadline: ${r1}`;
    B = builder(); ev = open(B); t = B.task('2026-03-09T10:05:00+01:00', N, ['u-im1']);
    const E2 = tr(W3, B.view('2026-03-09T10:37:00+01:00', N, ev, { tasks: [t], taskEvents: [B.answer('2026-03-09T10:36:00+01:00', 'reject')] }));
    const r2 = expect(E2, `maj:${N}:declared`, { match: { at: Z('2026-03-09T10:35:00+01:00') }, earliest: new Date(ms('2026-03-09T10:35:00+01:00') + 1000).toISOString(), latest: '2026-03-09T10:50:00+01:00' });
    if (r2 !== true) return `late answer: ${r2}`;
    B = builder(); ev = open(B); t = B.task('2026-03-09T10:05:00+01:00', N, ['u-im1']);
    const E3 = tr(W3, B.view('2026-03-09T10:40:00+01:00', N, [...ev, B.upd('2026-03-09T10:20:00+01:00', N, 'resolve', { closeCode: 'fixed' })], { tasks: [t], taskEvents: [B.answer('2026-03-09T10:30:00+01:00', 'approve')] }));
    if (findBy(E3, e => e.lid.startsWith(`maj:${N}`))) return 'moot approval still declared';
    B = builder(); ev = open(B);
    const E4 = tr(W3, B.view('2026-03-09T10:20:00+01:00', N, [...ev, B.upd('2026-03-09T10:10:00+01:00', N, 'resolve', { closeCode: 'fixed' })]));
    if (E4.humanTasks.required.length) return 'task still required after it became moot before creation';
    if (!E4.humanTasks.permitted.some(p => p.window.latest === ms('2026-03-09T10:10:00+01:00'))) return 'task not permitted up to the moot instant';
    B = builder(); ev = open(B); t = B.task('2026-03-09T10:05:00+01:00', N, ['u-im1']);
    const E5 = tr(W3, B.view('2026-03-09T10:31:00+01:00', N, ev, { tasks: [t], taskEvents: [B.answer('2026-03-09T10:30:00+01:00', null)] }));
    if (!E5.humanTasks.permitted.some(p => p.kind === 'majorIncidentApproval')) return 're-ask not permitted after an unusable answer';
    return true;
  });
}

// G14b R7.2 (review 2026-10-15 round 2): a new approval task is allowed only after an answer on a counted task was
// unusable, withdrawn or rejected by the schema, one per such answer, by the deadline; any other task is an extra task
// (not permitted) and its answer never counts. A P1 report (CI-PAY-APP1, urgency 1) opened Mon 2026-03-09 10:00+01:00,
// first task 10:05, deadline 10:35.
{
  const N = 'INC-RPT-G14-0002';
  const open = B => [B.report('2026-03-09T10:00:00+01:00', 'RPT-G14-0002', EU.userId, 'CI-PAY-APP1', 'software', 1)];
  const reask = E => E.humanTasks.permitted.find(p => p.rule === 'R7.2') ?? null;
  golden('G14b re-ask only after an unusable, withdrawn or schema-rejected answer', 'R7.2', tr => {
    // No cause: a second task is not permitted, and an approve on it does not count (the fail-safe stays due).
    let B = builder();
    let ev = open(B), t1 = B.task('2026-03-09T10:05:00+01:00', N, [EU.userId]);
    if (reask(tr(W3, B.view('2026-03-09T10:10:00+01:00', N, ev, { tasks: [t1] })))) return 'a re-ask permitted with no unusable answer';
    let t2 = B.task('2026-03-09T10:10:00+01:00', N, [EU.userId], 'mia#2');
    let E = tr(W3, B.view('2026-03-09T10:36:00+01:00', N, ev, { tasks: [t1, t2], taskEvents: [B.answer('2026-03-09T10:20:00+01:00', 'approve', 'mia#2')] }));
    if (has(E, `maj:${N}:approved`)) return 'an answer to an extra task counted';
    let r = expect(E, `maj:${N}:declared`, { match: { at: Z('2026-03-09T10:35:00+01:00') } });
    if (r !== true) return `extra task: ${r}`;
    // Each cause allows one re-ask from its instant to the deadline; the re-ask's answer counts.
    for (const cause of ['unusable', 'humanTask.answerRejected', 'humanTask.withdrawn']) {
      B = builder(); ev = open(B); t1 = B.task('2026-03-09T10:05:00+01:00', N, [EU.userId]);
      const c = cause === 'unusable' ? B.answer('2026-03-09T10:20:00+01:00', null) : B.taskEvent('2026-03-09T10:20:00+01:00', cause);
      const P = reask(tr(W3, B.view('2026-03-09T10:21:00+01:00', N, ev, { tasks: [t1], taskEvents: [c] })));
      if (!P || P.window.earliest !== ms('2026-03-09T10:20:00+01:00') || P.window.latest !== ms('2026-03-09T10:35:00+01:00')) return `${cause}: re-ask window ${JSON.stringify(P?.window)}`;
      t2 = B.task('2026-03-09T10:25:00+01:00', N, [EU.userId], 'mia#2');
      E = tr(W3, B.view('2026-03-09T10:31:00+01:00', N, ev, { tasks: [t1, t2], taskEvents: [c, B.answer('2026-03-09T10:30:00+01:00', 'approve', 'mia#2')] }));
      r = all(expect(E, `maj:${N}:approved`, { match: { at: Z('2026-03-09T10:30:00+01:00') } }), has(E, `maj:${N}:declared`) ? 'declared after a counted approve' : true);
      if (r !== true) return `${cause}: ${r}`;
    }
    // One cause, one re-ask: a third task after it is extra, and its answer does not count.
    B = builder(); ev = open(B); t1 = B.task('2026-03-09T10:05:00+01:00', N, [EU.userId]);
    const u = B.answer('2026-03-09T10:20:00+01:00', null);
    t2 = B.task('2026-03-09T10:22:00+01:00', N, [EU.userId], 'mia#2');
    if (reask(tr(W3, B.view('2026-03-09T10:24:00+01:00', N, ev, { tasks: [t1, t2], taskEvents: [u] })))) return 'a second re-ask permitted on one unusable answer';
    const t3 = B.task('2026-03-09T10:24:00+01:00', N, [EU.userId], 'mia#3');
    E = tr(W3, B.view('2026-03-09T10:36:00+01:00', N, ev, { tasks: [t1, t2, t3], taskEvents: [u, B.answer('2026-03-09T10:30:00+01:00', 'approve', 'mia#3')] }));
    if (has(E, `maj:${N}:approved`) || !has(E, `maj:${N}:declared`)) return 'the answer to a re-ask beyond the causes counted';
    // A timeout of the arm's own dueAt is no cause.
    B = builder(); ev = open(B); t1 = B.task('2026-03-09T10:05:00+01:00', N, [EU.userId]);
    return reask(tr(W3, B.view('2026-03-09T10:21:00+01:00', N, ev, { tasks: [t1], taskEvents: [B.taskEvent('2026-03-09T10:20:00+01:00', 'humanTask.timeout')] }))) ? 'a timeout allowed a re-ask' : true;
  });

  // G14c R7.3, S16, R8.2 (review 2026-10-15 round 2): the same incident withdrawn exactly at the deadline (10:35) before any
  // answer: moot, no declaration (it would be recorded after the cancellation); resolved at the deadline: still declared;
  // an approve that counted earlier in the same instant still counts, and one after the withdrawal does not.
  golden('G14c closed or cancelled at the approval deadline: no declaration', 'R7.2, R7.3, R8.2, S16', tr => {
    const dl = '2026-03-09T10:35:00+01:00';
    let B = builder();
    let ev = open(B), t1 = B.task('2026-03-09T10:05:00+01:00', N, [EU.userId]);
    let E = tr(W3, B.view('2026-03-09T10:51:00+01:00', N, [...ev, B.caller(dl, N, 'withdraw')], { tasks: [t1] }));
    let r = all(expect(E, `cnc:${N}`, { match: { at: Z(dl) } }), findBy(E, e => e.lid.startsWith(`maj:${N}`) || e.lid === `ntf:${N}:major-incident`) ? 'declared after a withdrawal at the deadline' : true,
      E.terminal && E.records?.incident.major === false ? true : 'not cancelled without major');
    if (r !== true) return `withdraw at the deadline: ${r}`;
    B = builder(); ev = open(B); t1 = B.task('2026-03-09T10:05:00+01:00', N, [EU.userId]);
    E = tr(W3, B.view('2026-03-09T10:51:00+01:00', N, [...ev, B.upd(dl, N, 'resolve', { closeCode: 'fixed' })], { tasks: [t1] }));
    r = expect(E, `maj:${N}:declared`, { match: { at: Z(dl) }, earliest: new Date(ms(dl) + 1000).toISOString(), latest: '2026-03-09T10:50:00+01:00' });
    if (r !== true) return `resolved at the deadline: ${r}`;
    B = builder(); ev = open(B); t1 = B.task('2026-03-09T10:05:00+01:00', N, [EU.userId]);
    const ans = B.answer(dl, 'approve');
    E = tr(W3, B.view('2026-03-09T10:51:00+01:00', N, [...ev, B.caller(dl, N, 'withdraw')], { tasks: [t1], taskEvents: [ans] }));
    r = all(expect(E, `maj:${N}:approved`, { match: { at: Z(dl) } }), expect(E, `cnc:${N}`));
    if (r !== true) return `approve then withdraw in one instant: ${r}`;
    B = builder(); ev = open(B); t1 = B.task('2026-03-09T10:05:00+01:00', N, [EU.userId]);
    const w = B.caller(dl, N, 'withdraw');
    E = tr(W3, B.view('2026-03-09T10:51:00+01:00', N, [...ev, w], { tasks: [t1], taskEvents: [B.answer(dl, 'approve')] }));
    return findBy(E, e => e.lid.startsWith(`maj:${N}`)) ? 'an approve after the withdrawal in the same instant counted' : true;
  });
}

// G15 R4.6, S2: RES-P1 (240, 24x7) opened 10:00, resolved 14:00 the same day: breached at 14:00 (a stop at D is a breach),
// the 100% escalation is due, the stop says breached, and the breach record comes before the stop.
golden('G15 breach at target: a stop at D is a breach', 'R4.6, R5.1, S2, S3', tr => {
  const B = builder(), N = 'INC-ALR-G15-0001', S = `${N}/RES-P1/1`;
  const E = tr(W3, B.view('2026-03-09T14:01:00+01:00', N, [B.alert('2026-03-09T10:00:00+01:00', 'ALR-G15-0001', 'CI-SW-AMS1', 'ping', 'critical'),
    B.upd('2026-03-09T10:20:00+01:00', N, 'accept'), B.upd('2026-03-09T14:00:00+01:00', N, 'resolve', { closeCode: 'fixed' })]));
  const stop = find(E, `sla:${S}:stop`);
  return all(expect(E, `sla:${S}:breach`, { match: { at: Z('2026-03-09T14:00:00+01:00') } }), expect(E, `esc:${S}:100`, { earliest: '2026-03-09T14:00:00+01:00' }),
    expect(E, `sla:${S}:stop`, { match: { elapsedMinutes: 240, businessElapsedMinutes: 240, breached: true } }),
    stop?.after?.includes(`sla:${S}:breach`) ? true : 'stop not ordered after the breach');
});

// G16 R1.2-R1.4, R2.3, R7.1, S8: an alert opens; the same CI and check 10 min later joins (linked, no new incident); the
// opening alert delivered again changes nothing; a warning changes nothing; a joining critical alert on a P2 incident
// raises urgency to 1 -> P1 -> approval task at the join; an alert after the resolution opens a new incident.
golden('G16 alerts: open, join, redelivery, warning, escalation by a joining alert', 'R1.2, R1.3, R1.4, R2.3, R7.1, S8', tr => {
  const B = builder(), N = 'INC-ALR-G16-0001';
  const evs = [B.alert('2026-03-10T10:00:00+01:00', 'ALR-G16-0001', 'CI-CRM-APP1', 'http', 'major'), B.alert('2026-03-10T10:10:00+01:00', 'ALR-G16-0002', 'CI-CRM-APP1', 'http', 'minor'),
    B.alert('2026-03-10T10:12:00+01:00', 'ALR-G16-0001', 'CI-CRM-APP1', 'http', 'major'), B.alert('2026-03-10T10:14:00+01:00', 'ALR-G16-0004', 'CI-CRM-APP1', 'http', 'warning')];
  const E = tr(W3, B.view('2026-03-10T10:15:00+01:00', N, evs));
  if (lids(E).filter(l => l.startsWith('create:')).length !== 1 || !has(E, `lnk:${N}:ALR-G16-0002`) || findBy(E, e => e.op === 'linkAlert' && e.match.alertId !== 'ALR-G16-0002')) return `links ${lids(E).filter(l => l.startsWith('lnk:'))}`;
  if (findBy(E, e => e.op === 'reclassify')) return 'a less urgent joining alert reclassified';
  if (E.decisions.graded.priority !== 2) return `priority ${E.decisions.graded.priority}`;
  const E2 = tr(W3, B.view('2026-03-10T10:21:00+01:00', N, [...evs, B.alert('2026-03-10T10:20:00+01:00', 'ALR-G16-0005', 'CI-CRM-APP1', 'http', 'critical')]));
  const r = all(expect(E2, `rcl:${N}:${Z('2026-03-10T10:20:00+01:00')}`, { match: { urgency: 1, priority: 1, impact: 1 } }),
    E2.humanTasks.required.some(t => t.window.earliest === ms('2026-03-10T10:20:00+01:00')) ? true : 'no approval task at the join',
    expect(E2, `sla:${N}/RES-P2/1:cancel`, { match: { reason: 'start-failed' } }), expect(E2, `sla:${N}/RES-P1/1:start`, { match: { startAt: Z('2026-03-10T10:00:00+01:00') } }));
  if (r !== true) return r;
  const B2 = builder(), N2 = 'INC-ALR-G16-0009';
  const E3 = tr(W3, B2.view('2026-03-10T16:01:00+01:00', N2, [B2.alert('2026-03-10T16:00:00+01:00', 'ALR-G16-0009', 'CI-CRM-APP1', 'http', 'major')]));
  return has(E3, `create:${N2}`) ? true : 'a recurrence after the resolution did not open an incident';
});

// G17 R3.2, S7: on hold awaiting the caller at 10:00, reassigned at 11:00 (the hold ends; RES resumes at 11:00), the
// caller replies at 12:00: nothing (no resume record), and no closure is pending.
golden('G17 a reassignment ends the hold; a later reply changes nothing', 'R3.2, R6.2, S7', tr => {
  const B = builder(), N = 'INC-RPT-G17-0001', S = `${N}/RES-P4/1`;
  const E = tr(W3, B.view('2026-03-11T12:01:00+01:00', N, [B.report('2026-03-10T10:00:00+01:00', 'RPT-G17-0001', EU.userId, 'CI-LT-EU', 'hardware', 2),
    B.upd('2026-03-10T10:30:00+01:00', N, 'accept'), B.upd('2026-03-11T10:00:00+01:00', N, 'hold', { holdReason: 'awaitingCaller' }),
    B.upd('2026-03-11T11:00:00+01:00', N, 'reassign', { toGroup: 'GRP-APP-US' }), B.caller('2026-03-11T12:00:00+01:00', N, 'reply')]));
  return all(expect(E, `sla:${S}:resume:${Z('2026-03-11T11:00:00+01:00')}`), has(E, `res:${N}:${Z('2026-03-11T12:00:00+01:00')}`) ? 'the reply resumed' : true,
    findBy(E, e => e.lid.startsWith(`cls:${N}`)) ? 'closure still pending' : true);
});

// G18 R6.6, R3.2, R4.2: a withdrawal before acceptance cancels the incident and every SLA (`cancelled`), with the notice; a
// resolution from `assigned` (W2) stops the response SLA at the resolution.
golden('G18 withdrawal; resolution before acceptance', 'R6.6, R3.2, R4.2', tr => {
  let B = builder();
  const N = 'INC-RPT-G18-0001';
  const E = tr(W3, B.view('2026-03-10T11:01:00+01:00', N, [B.report('2026-03-10T10:00:00+01:00', 'RPT-G18-0001', EU.userId, 'CI-LT-EU', 'hardware', 2),
    B.caller('2026-03-10T11:00:00+01:00', N, 'withdraw')]));
  const r = all(expect(E, `cnc:${N}`, { match: { at: Z('2026-03-10T11:00:00+01:00') } }), expect(E, `ntf:${N}:incident-cancelled`, { match: { to: EU.email } }),
    expect(E, `sla:${N}/RES-P4/1:cancel`, { match: { reason: 'cancelled' } }), expect(E, `sla:${N}/RSP-STD/1:cancel`, { match: { reason: 'cancelled' } }),
    E.terminal && E.records?.incident.state === 'cancelled' ? true : 'not cancelled');
  if (r !== true) return r;
  B = builder();
  const N2 = 'INC-RPT-G18-0002';
  const E2 = tr(W3, B.view('2026-03-10T11:01:00+01:00', N2, [B.report('2026-03-10T10:00:00+01:00', 'RPT-G18-0002', EU.userId, 'CI-LT-EU', 'hardware', 2),
    B.upd('2026-03-10T11:00:00+01:00', N2, 'resolve', { closeCode: 'fixed' })]));
  return expect(E2, `sla:${N2}/RSP-STD/1:stop`, { match: { at: Z('2026-03-10T11:00:00+01:00'), businessElapsedMinutes: 60, breached: false } });
});

// R1.4, §3.3, S9: a report delivered twice is one incident; a caller message naming no incident is no incident (an
// `unknown-incident` notice to its sender is allowed, nothing is required).
golden('report delivered twice; a message naming no incident', 'R1.1, R1.4, §3.3, S9', tr => {
  const B = builder(), N = 'INC-RPT-G19-0001';
  const rep = B.report('2026-03-10T10:00:00+01:00', 'RPT-G19-0001', EU.userId, 'CI-LT-EU', 'hardware', 2);
  const E = tr(W3, B.view('2026-03-10T10:31:00+01:00', N, [rep, { ...rep, id: 'g-dup', seq: 99, at: ms('2026-03-10T10:30:00+01:00') }]));
  if (lids(E).filter(l => l.startsWith('create:') || l.startsWith('asg:')).length !== 2) return `duplicate delivery created records: ${lids(E).join(' ')}`;
  const S = { case: 'golden', at: ms('2026-03-10T10:01:00+01:00'), seq: Infinity, world: W3, truth: { subject: null, start: '2026-03-10T09:00:00Z', from: EU.email },
    events: [], rows: [], tasks: [], taskEvents: [] };
  const E2 = tr(W3, S);
  if (E2.effects.required.length || E2.decisions.graded.subject !== null || E2.decisions.graded.priority !== null) return 'a stray message required something';
  return E2.effects.permitted.some(p => p.match.template === 'unknown-incident' && p.match.to === EU.email) ? true : 'unknown-incident not permitted';
});

// Layer 5 (R8.1): recordsOf replays the arm's committed rows with the mocks' semantics; the go-live export is the start.
{
  const migrated = W3.backlog;
  golden('records of rows and of the go-live export', 'R8.1, §3.6', (tr, recordsOf) => {
    if (typeof recordsOf !== 'function') return 'recordsOf not supplied: call runGoldens(transition, recordsOf)';
    const [c, t] = Object.entries(W3.truth.cases).find(([, x]) => x.class === 'straight' && x.subject);
    const N = t.subject;
    let seq = 0;
    const row = (system, op, args) => ({ seq: ++seq, at: 0, system, op, key: `k${seq}`, args, committed: true, case: c });
    const ledger = [row('itsm', 'create', { number: N, priority: 3, impact: 2, urgency: 2, openedAt: '2026-03-10T10:00:00+01:00' }),
      row('itsm', 'assign', { number: N, group: 'GRP-SD-EU', at: '2026-03-10T09:00:00Z' }), row('itsm', 'accept', { number: N, user: 'u-x', at: '2026-03-10T09:30:00Z' }),
      row('sla', 'start', { number: N, definition: 'RES-P3', generation: 1, startAt: '2026-03-10T10:00:00+01:00', schedule: 'SCH-EU-STD', timezone: 'Europe/Amsterdam', plannedBreachAt: null }),
      row('sla', 'pause', { number: N, definition: 'RES-P3', generation: 1, at: '2026-03-10T11:00:00+01:00' }),
      row('sla', 'stop', { number: N, definition: 'RES-P3', generation: 1, at: '2026-03-10T12:00:00+01:00', elapsedMinutes: 60, businessElapsedMinutes: 60, breached: false }),
      row('notify', 'send', { to: 'a@b', about: N, template: 'assignment' }), row('itsm', 'resolve', { number: N, closeCode: 'fixed', at: '2026-03-10T13:00:00+01:00' })];
    const r = recordsOf(W3, { bucket: () => ({ ledger, deliveries: [], tasks: [], taskEvents: [], calls: [] }) }, c);
    const s = r.slas[`${N}/RES-P3/1`];
    if (r.incident.state !== 'resolved' || r.incident.assignee !== 'u-x' || r.incident.openedAt !== '2026-03-10T09:00:00Z' || r.incident.resolvedAt !== '2026-03-10T12:00:00Z') return `incident ${JSON.stringify(r.incident)}`;
    if (s.stage !== 'completed' || s.pauses[0].to !== '2026-03-10T11:00:00Z' || s.startAt !== '2026-03-10T09:00:00Z') return `sla ${JSON.stringify(s)}`;
    if (r.notifications.join() !== 'assignment a@b') return `notifications ${r.notifications}`;
    for (const b of migrated) {
      const rb = recordsOf(W3, { bucket: () => ({ ledger: [], deliveries: [], tasks: [], taskEvents: [], calls: [] }) }, b.case);
      const inc = b.export.records['itsm.incidents'][0];
      if (rb.incident.state !== inc.state || Object.keys(rb.slas).length !== b.export.records['sla.slas'].length) return `go-live ${b.case}: ${JSON.stringify(rb).slice(0, 200)}`;
    }
    const stray = Object.entries(W3.truth.cases).find(([, x]) => x.subject === null)[0];
    return recordsOf(W3, { bucket: () => ({ ledger: [] }) }, stray) === null ? true : 'records for a case with no incident';
  });
}

/**
 * Run every golden against a transition and, for the records golden, the same module's recordsOf (a mutant's own, in a
 * mutation tool); returns [{ name, source, pass, detail }]. A throw is a failure.
 */
export function runGoldens(transition, recordsOf = null) {
  return goldens.map(g => {
    let r;
    try { r = g.check(transition, recordsOf); } catch (e) { r = `threw: ${String(e?.message ?? e).slice(0, 300)}`; }
    return { name: g.name, source: g.source, pass: r === true, detail: r === true ? null : r };
  });
}
