// P60 SLA / obligation clock: start, pause, resume, stop over a business calendar, with warning and breach thresholds —
// authored blind for E-BED §8.1 step 1 from outside sources only (FROZEN-P58-P60.json lists them). Fragment (flow, task,
// x, S) -> {clocks: [{id, state, policyEdition, calendarEditions, targetMinutes, elapsedMinutes, remainingMinutes, met,
// breached, dueAt, warnings: [{fraction, reached, at}]}]}.
// The solver computes; the envelope keeps the timers (L0 18 / 19): dueAt and warnings[].at are the instants to wake at.
// Slots: CASES (path), AS_OF (path; ISO instant with offset: the evaluation time, never the wall clock), EVENTS (fn case ->
// events), AT (fn event -> ISO instant with Z or an offset), KIND (fn event -> event name), START_ON, STOP_ON, PAUSE_ON,
// RESUME_ON, IGNORE_ON (enum[] of event names; an event in none of them deopts: guard known-event), TARGET_KEY (fn case ->
// key of the policy's targets), POLICY ({editions: [{edition, effectiveFrom, effectiveTo?, targets: {key: business
// minutes}, warnings: [fractions]}]}), CALENDAR ({timezone: IANA name, editions: [{edition, effectiveFrom, effectiveTo?,
// week: {mon: [['09:00', '17:00']], ...}, holidays: [YYYY-MM-DD]}]}), HORIZON_DAYS, MAX_CASES.
// Clock: not-started -start-> running -pause-> paused -resume-> running; -stop-> stopped from running or paused. Events
// before the start are ignored; repeated start / pause / resume are no-ops; a start after the stop deopts (guard
// single-cycle: a reset or reopen is a new obligation). Events at the same instant keep their input order. Elapsed time is
// business time while running; breached = elapsed > target (reaching the target exactly is on time); met = stopped and
// not breached. dueAt = the instant elapsed reaches the target (past, or projected from AS_OF while running; null while
// paused or once stopped short of it).
// G18 editions: the policy edition in force on the clock's start date (local to the calendar) fixes target and warnings;
// the calendar edition is chosen per local day, so a clock running across an edition switch uses each day's hours.
export default async function P60(flow, task, x, S) {
  const cases = S.CASES(task, x), asOfText = S.AS_OF(task, x);
  flow.guard('bounded', Array.isArray(cases) && cases.length <= S.MAX_CASES, { n: Array.isArray(cases) ? cases.length : null, max: S.MAX_CASES });
  flow.guard('unique-ids', cases.every(c => c != null && c.id != null) && new Set(cases.map(c => String(c.id))).size === cases.length, { n: cases.length });
  const INSTANT = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
  const DATE = /^\d{4}-\d{2}-\d{2}$/, HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
  const validDate = d => typeof d === 'string' && DATE.test(d) && Number.isFinite(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
  const instant = s => (typeof s === 'string' && INSTANT.test(s) && validDate(s.slice(0, 10)) ? Date.parse(s) : null);   // V8 would roll 02-30 over
  const asOf = instant(asOfText);
  flow.guard('as-of-time', asOf !== null, { asOf: asOfText ?? null });
  const MIN = 60000, DAY = 86400000, DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  // ---- editions (G18) and the calendar ----
  const editionsOk = (eds, extra) => Array.isArray(eds) && eds.length > 0 && new Set(eds.map(e => e?.edition)).size === eds.length && eds.every((e, i) =>
    typeof e?.edition === 'string' && e.edition && validDate(e.effectiveFrom) && (e.effectiveTo == null ? i === eds.length - 1 : validDate(e.effectiveTo) && e.effectiveTo > e.effectiveFrom)
    && (i === 0 || eds[i - 1].effectiveTo <= e.effectiveFrom) && extra(e));
  const inForce = (eds, d) => eds.find(e => e.effectiveFrom <= d && (e.effectiveTo == null || d < e.effectiveTo)) ?? null;
  const tz = S.CALENDAR?.timezone;
  let fmt = null;
  try { fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { fmt = null; }
  const windowsOk = ws => Array.isArray(ws) && ws.every((w, i) => Array.isArray(w) && w.length === 2 && HHMM.test(w[0]) && HHMM.test(w[1]) && w[0] !== '24:00' && w[0] < w[1] && (i === 0 || ws[i - 1][1] <= w[0]));
  const calOk = e => e.week != null && typeof e.week === 'object' && Object.keys(e.week).every(k => DAYS.includes(k) && windowsOk(e.week[k]))
    && (e.holidays == null || (Array.isArray(e.holidays) && e.holidays.every(validDate)));
  flow.invariant('calendar-well-formed', typeof tz === 'string' && fmt !== null && editionsOk(S.CALENDAR.editions, calOk), { timezone: tz ?? null });
  const polOk = e => e.targets != null && typeof e.targets === 'object' && Object.keys(e.targets).length > 0 && Object.values(e.targets).every(m => Number.isInteger(m) && m > 0)
    && Array.isArray(e.warnings) && e.warnings.every((f, i) => typeof f === 'number' && f > 0 && f < 1 && (i === 0 || e.warnings[i - 1] < f));
  flow.invariant('policy-well-formed', editionsOk(S.POLICY?.editions, polOk), {});
  const sets = { start: S.START_ON, stop: S.STOP_ON, pause: S.PAUSE_ON ?? [], resume: S.RESUME_ON ?? [], ignore: S.IGNORE_ON ?? [] };
  const all = Object.values(sets).flat();
  flow.invariant('event-sets-disjoint', new Set(all).size === all.length, { sets });
  const actionOf = Object.fromEntries(Object.entries(sets).flatMap(([a, ns]) => ns.map(n => [n, a])));

  // Local wall time in the calendar's zone (IANA rules of the runtime's tz database).
  const parts = ms => Object.fromEntries(fmt.formatToParts(new Date(ms)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  const offset = ms => { const p = parts(ms); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000; };
  const localDate = ms => { const p = parts(ms); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
  const toUtc = (d, hhmm) => {   // local date + HH:MM -> UTC ms; 24:00 is the next day's 00:00
    const [h, m] = hhmm.split(':').map(Number), guess = Date.parse(d + 'T00:00:00Z') + (h * 60 + m) * MIN;
    const first = guess - offset(guess);
    return guess - offset(first);
  };
  const calendarUsed = new Set();
  const windowsOn = d => {   // business windows of one local day, as UTC [start, end) pairs
    const ed = inForce(S.CALENDAR.editions, d);
    flow.guard('calendar-edition-in-force', ed !== null, { date: d });
    calendarUsed.add(ed.edition);
    if ((ed.holidays ?? []).includes(d)) return [];
    return (ed.week[DAYS[new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay()]] ?? []).map(([a, b]) => [toUtc(d, a), toUtc(d, b)]);
  };
  // Business segments of [from, to), in order; bounded by HORIZON_DAYS local days.
  const segments = (from, to) => {
    const out = [], last = localDate(to);
    let d = localDate(from), done = false;
    for (let i = 0; i < S.HORIZON_DAYS; i++) {
      if (d > last) { done = true; break; }
      for (const [a, b] of windowsOn(d)) { const s = Math.max(a, from), e = Math.min(b, to); if (e > s) out.push([s, e]); }
      d = addDays(d, 1);
    }
    flow.guard('within-horizon', done || d > last, { from: new Date(from).toISOString(), to: new Date(to).toISOString(), horizonDays: S.HORIZON_DAYS });
    return out;
  };
  // The instant at which `need` ms of business time have run inside the given intervals (null if they hold less).
  const reach = (intervals, need) => {
    let acc = 0;
    for (const [a, b] of intervals) for (const [s, e] of segments(a, b)) { if (acc + (e - s) >= need) return s + (need - acc); acc += e - s; }
    return null;
  };
  // Projection from `from` while the clock keeps running: walk days forward until `need` ms are consumed.
  const project = (from, need) => {
    let d = localDate(from), acc = 0;
    for (let i = 0; i < S.HORIZON_DAYS; i++) {
      for (const [a, b] of windowsOn(d)) { const s = Math.max(a, from); if (b > s) { if (acc + (b - s) >= need) return s + (need - acc); acc += b - s; } }
      d = addDays(d, 1);
    }
    flow.guard('within-horizon', false, { from: new Date(from).toISOString(), needMinutes: need / MIN, horizonDays: S.HORIZON_DAYS });
    return null;
  };
  const iso = ms => (ms === null ? null : new Date(ms).toISOString());

  const clock = c => {
    const evs = S.EVENTS(c);
    flow.guard('event-list', Array.isArray(evs), { id: c.id });
    const timed = evs.map((e, i) => {
      const at = instant(S.AT(e)), name = S.KIND(e);
      flow.guard('event-time', at !== null, { id: c.id, event: i, at: S.AT(e) ?? null });
      flow.guard('known-event', typeof name === 'string' && actionOf[name] !== undefined, { id: c.id, event: i, name: name ?? null });
      flow.guard('not-after-as-of', at <= asOf, { id: c.id, event: i, at: S.AT(e) });
      return { at, i, action: actionOf[name] };
    }).sort((a, b) => a.at - b.at || a.i - b.i);
    let state = 'not-started', startAt = null, since = null;
    const running = [];
    for (const e of timed) {
      if (state === 'not-started') { if (e.action === 'start') { state = 'running'; startAt = e.at; since = e.at; } continue; }
      if (state === 'stopped') { flow.guard('single-cycle', e.action !== 'start', { id: c.id, event: e.i }); continue; }
      if (e.action === 'pause' && state === 'running') { running.push([since, e.at]); state = 'paused'; }
      else if (e.action === 'resume' && state === 'paused') { state = 'running'; since = e.at; }
      else if (e.action === 'stop') { if (state === 'running') running.push([since, e.at]); state = 'stopped'; }
    }
    if (state === 'running') running.push([since, asOf]);
    if (state === 'not-started') return { id: c.id, state, policyEdition: null, calendarEditions: [], targetMinutes: null, elapsedMinutes: 0, remainingMinutes: null, met: false, breached: false, dueAt: null, warnings: [] };
    const pol = inForce(S.POLICY.editions, localDate(startAt));
    flow.guard('policy-edition-in-force', pol !== null, { id: c.id, start: iso(startAt) });
    const key = S.TARGET_KEY(c);
    flow.guard('target-known', typeof key === 'string' && Number.isInteger(pol.targets[key]), { id: c.id, key: key ?? null, edition: pol.edition });
    calendarUsed.clear();
    const elapsed = running.reduce((n, [a, b]) => n + segments(a, b).reduce((m, [s, e]) => m + e - s, 0), 0);
    const calendarEditions = S.CALENDAR.editions.map(e => e.edition).filter(e => calendarUsed.has(e));
    flow.invariant('business-within-wall', elapsed <= running.reduce((n, [a, b]) => n + b - a, 0), { id: c.id });
    const target = pol.targets[key] * MIN;
    const when = need => (elapsed >= need ? reach(running, need) : state === 'running' ? project(asOf, need - elapsed) : null);
    const warnings = pol.warnings.map(f => { const need = Math.round(f * target); return { fraction: f, reached: elapsed >= need, at: iso(when(need)) }; });
    const breached = elapsed > target;
    return { id: c.id, state, policyEdition: pol.edition, calendarEditions, targetMinutes: pol.targets[key], elapsedMinutes: elapsed / MIN, remainingMinutes: (target - elapsed) / MIN,
      met: state === 'stopped' && !breached, breached, dueAt: iso(when(target)), warnings };
  };
  const clocks = cases.map(clock);
  flow.invariant('one-clock-per-case', clocks.length === cases.length && clocks.every((k, i) => k.id === cases[i].id), { clocks: clocks.length, cases: cases.length });
  flow.note('states', countBy(clocks, k => (k.breached ? `${k.state}/breached` : k.state)));
  return { clocks };
}
