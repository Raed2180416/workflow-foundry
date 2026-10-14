// E7 slice 1 item suites, part B ($0, no model calls; DESIGN.md §11): the reference transition and its SLA engine, both
// reference runs through the real host, controls, goldens, replay, twins, leaks and the spec. World, systems and actor
// suites are part A (world.test.mjs). Seeds: E-bed dev block 1001-1199 (suites, goldens) and the E7 rehearsal attack
// block 1211-1222 (controls), DESIGN §13.
//   node --test --test-concurrency=2 'beds/ebed/e7/test/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, twins, referenceRuns, oracle, binding, referenceTransition, recordsOf, specE, family, oracleItem, schemas } from '../index.mjs';
import { runControl, CONTROLS, VARIANTS, targetCases, plannedView } from '../controls.mjs';
import { runGoldens, goldens } from '../golden.mjs';
import { slaTimeline, reachAt, boundCalendar } from '../sla.mjs';
import { addBiz, bizBetween, CLASSES } from '../world.mjs';
import { createHost } from '../../host/host.mjs';
import { replayRun } from '../../host/replay.mjs';
import { defineClock, clockAt } from '../../lib/clock.mjs';
import { hashOf } from '../../../lib/canonical.mjs';
import { rng } from '../../../lib/rng.mjs';

const MIN = 60_000;
const cases = w => Object.entries(w.truth.cases);

// ---------------------------------------------------------------------------------------------------------------------
// The module and its spec

test('module interface: family, schemas and the oracle binding (contract §2)', () => {
  assert.equal(family.item, 'E7');
  assert.equal(family.profile, 'bare');
  assert.deepEqual(family.sweeps, []);
  assert.ok(schemas.humanTasks.majorIncidentApproval.answerSchema.required.includes('decision'));
  for (const k of ['referenceTransition', 'recordsOf', 'canonicalArgs', 'taskSpec', 'critical']) assert.equal(typeof oracleItem[k], 'function', k);
  // Instants are compared as instants (SPEC §1): every instant argument in canonical UTC, nothing else touched.
  assert.deepEqual(oracleItem.canonicalArgs('sla', 'stop', { at: '2026-03-10T10:00:00+01:00', plannedBreachAt: '2026-03-10T05:00:00-04:00', reason: 'x', number: ' inc-1' }),
    { at: '2026-03-10T09:00:00Z', plannedBreachAt: '2026-03-10T09:00:00Z', reason: 'x', number: ' inc-1' });
  assert.deepEqual(oracleItem.canonicalArgs('itsm', 'close', { at: 'not a time' }), { at: 'not a time' });
});

test('spec-E is the module\'s spec, names every rule the oracle cites, and carries no truth-only vocabulary', async () => {
  const { readFileSync } = await import('node:fs');
  const src = ['transition.mjs', 'sla.mjs'].map(f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  const cited = new Set([...src.matchAll(/'(R\d\.\d|S\d{1,2}|§\d\.\d)'/g)].map(m => m[1]));
  assert.ok(cited.size >= 15, `${cited.size} rules cited`);
  for (const r of cited) assert.ok(specE.text.includes(r), `${r} is cited by the oracle but not in the spec`);
  for (const r of ['R0', 'R4.2', 'R4.3', 'R4.4', 'R8.1', 'R8.2', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S10', 'S12']) assert.ok(specE.text.includes(r), r);
  const lower = specE.text.toLowerCase();
  const truthOnly = [...CLASSES.map(c => c[0]).filter(c => c.includes('-')), ...CONTROLS.map(c => c.id).filter(c => c.includes('-')), 'gl-awaiting', 'gl-resolved', 'controlflags'];
  for (const w of truthOnly) assert.ok(!lower.includes(w), `truth-only word "${w}" in the spec`);
});

// ---------------------------------------------------------------------------------------------------------------------
// The SLA engine: N-version against lib/clock and the generator's own clock, and clock laws (DESIGN §10)

test('SLA engine N-version: sla.mjs = lib/clock = the generator clock on fuzzed lifecycles; clock laws hold', () => {
  const w = generateWorld({ seed: 1001, difficulty: 3 });
  const zones = { 'SCH-EU-STD': null, 'SCH-US-STD': null, 'SCH-AU-STD': null, 'SCH-EXT': 'America/New_York' };
  const AWAIT = { when: [{ field: 'state', in: ['onHold'] }, { field: 'holdReason', in: ['awaitingCaller'] }] };
  let n = 0;
  for (let i = 0; i < 300; i++) {
    const r = rng('ebed-fuzz', 'e7', 'sla-nversion', 1301, i);
    const calId = r.pick([...Object.keys(zones), null]);
    const tz = calId ? zones[calId] ?? w.calendars[calId].tz : null;
    const T = 4 * r.int(5, 700);
    const def = { id: 'FUZZ', target: { minutes: T }, start: { when: [{ field: 'priority', in: [3] }], from: 'openedAt', retroactivePause: true }, pause: AWAIT,
      stop: { when: [{ field: 'state', in: ['resolved'] }] }, cancel: { whenStartFails: false, when: [{ field: 'state', in: ['cancelled'] }] }, reset: null,
      schedule: calId ? { source: 'calendar', calendar: calId } : { source: 'none' }, timezone: { sources: ['definition'], definition: tz ?? 'Europe/Amsterdam' },
      escalations: [{ percent: 50, notify: 'group' }, { percent: 75, notify: 'group' }, { percent: 100, notify: 'group' }] };
    // A lifecycle: open, then alternating holds and resumes 15-3000 minutes apart, maybe a resolution.
    let at = Date.parse('2026-03-02T00:00:00+01:00') + r.int(0, 40 * 1440) * MIN;
    const F = state => ({ priority: 3, state, holdReason: state === 'onHold' ? 'awaitingCaller' : null });
    const snaps = [{ at, fields: F('assigned') }];
    const hist = [{ at, op: 'start' }];
    const k = r.int(0, 6);
    for (let j = 0; j < k; j++) { at += r.int(15, 3000) * MIN; const hold = j % 2 === 0; snaps.push({ at, fields: F(hold ? 'onHold' : 'inProgress') }); hist.push({ at, op: hold ? 'pause' : 'resume' }); }
    const stopped = r.chance(0.6);
    if (stopped) { at += r.int(1, 3000) * MIN; snaps.push({ at, fields: F('resolved') }); hist.push({ at, op: 'stop' }); }
    const ctx = { world: w, defsAt: () => [def], scheduleOf: { service: () => null, group: () => null } };
    const [s] = slaTimeline(ctx, { number: 'INC-F', openedAt: snaps[0].at, callerTz: null, ciTz: null }, snaps);
    // lib/clock (exclusive boundary, S2)
    const cal = calId ? boundCalendar(w, calId, tz) : null;
    const clock = defineClock({ target: { amount: T, unit: cal ? 'business-minutes' : 'minutes' }, ...(cal ? { calendar: cal } : {}), boundary: 'exclusive',
      warnings: [50, 75].map(p => ({ id: `w${p}`, percent: p })) });
    const c = clockAt(clock, hist.map(h => ({ at: new Date(h.at).toISOString(), op: h.op })), at);
    assert.equal(s.D, c.dueAt, `#${i} D (${calId} ${tz} T=${T})`);
    assert.deepEqual(s.thresholds.filter(t => t.percent < 100).map(t => t.at), c.warnings.map(x => (s.end && x.at !== null && x.at > s.end.at ? null : x.at)), `#${i} thresholds`);
    if (stopped) {
      assert.equal(s.elapsedMinutes * MIN, c.actualElapsedMs, `#${i} elapsed`);
      assert.equal(s.businessElapsedMinutes * MIN, cal ? c.businessElapsedMs : c.actualElapsedMs, `#${i} business elapsed`);
      assert.equal(s.breached, c.breached, `#${i} breached`);
      assert.ok(s.businessElapsedMinutes <= s.elapsedMinutes, 'business <= elapsed');
    }
    // The generator's own clock (world.mjs: its own zone table and interval arithmetic) gives the same D.
    if (s.D !== null) {
      let need = T, D2 = null;
      for (const [a, b] of s.segments) {
        const span = b === null ? Infinity : bizBetween(cal ? w.calendars[calId] : null, tz, a, b);
        if (span >= need) { D2 = addBiz(cal ? w.calendars[calId] : null, tz, a, need); break; }
        need -= span;
      }
      assert.equal(D2, s.D, `#${i} generator clock`);
    }
    // Law: one more pause never moves D earlier (nor makes it known when it was not).
    if (s.stage === 'inProgress' && s.D !== null) {
      const p = s.segments.at(-1)[0] + r.int(1, 600) * MIN;
      const [s2] = slaTimeline(ctx, { number: 'INC-F', openedAt: snaps[0].at, callerTz: null, ciTz: null }, [...snaps, { at: p, fields: F('onHold') }, { at: p + r.int(1, 900) * MIN, fields: F('inProgress') }]);
      assert.ok(s2.D >= s.D || (s.D <= p && s2.D === s.D), `#${i} pause moved D earlier`);
    }
    n++;
  }
  assert.equal(n, 300);
  // reachAt on a closed lifecycle never passes its end.
  const cal = boundCalendar(w, 'SCH-EU-STD', 'Europe/Amsterdam');
  const a = Date.parse('2026-03-09T09:00:00+01:00');
  assert.equal(reachAt(cal, [[a, a + 60 * MIN]], 61 * MIN), null);
  assert.equal(reachAt(cal, [[a, a + 60 * MIN]], 60 * MIN), a + 60 * MIN);
});

// ---------------------------------------------------------------------------------------------------------------------
// Reference runs (contract §5.6): oracle self-consistency

test('both reference runs pass every case they complete, d2-d5 (0 divergences, 0 oracle errors, 0 critical)', async () => {
  for (const [seed, d, size] of [[1003, 2, 50], [1004, 3, 60], [1005, 4, 60], [1006, 5, 80]]) {
    const w = generateWorld({ seed, difficulty: d, size });
    const r = await referenceRuns(w);
    for (const timing of ['earliest', 'latest']) {
      const v = r.verdicts[timing];
      assert.equal(v.oracleErrors.length, 0, `${timing} d${d}: oracle errors ${JSON.stringify(v.oracleErrors[0])}`);
      const div = v.cases.filter(c => c.firstDivergence);
      assert.equal(div.length, 0, `${timing} d${d}: ${div[0]?.case} ${div[0]?.class} ${JSON.stringify(div[0]?.firstDivergence)?.slice(0, 400)}`);
      assert.equal(v.critical.length, 0, `${timing} d${d} critical ${JSON.stringify(v.critical[0])}`);
      assert.equal(v.score.passed, v.score.completed);
    }
    const pools = Object.values(r.pools);
    assert.ok(pools.filter(p => p === 'completed').length / pools.length >= 0.85, `d${d} completed share`);
    // Go-live: the oracle's SLA engine and the generator's own engine agree on every migrated SLA (layer 5 compares the
    // exported records, continued by the arm's rows, with the expectation computed over the whole history).
    for (const b of w.backlog) assert.ok(r.verdicts.earliest.cases.find(c => c.case === b.case).pass, `go-live ${b.case}`);
    if (d === 5) {
      const injected = r.runs.earliest.rows.filter(x => x.type === 'ledger' && x.injected);
      assert.ok(injected.some(x => x.faultTags.includes('F1')) && injected.some(x => x.faultTags.includes('F2')), 'F1 and F2 injected and survived (bare profile: the arm retries with the same key)');
    }
  }
});

test('a reference run replays byte-identically at $0 (E-BED §9.7)', async () => {
  const w = generateWorld({ seed: 1007, difficulty: 3, size: 30 });
  const r = await referenceRuns(w);
  const res = await replayRun({ item: binding, world: w, journal: r.runs.earliest.journal });
  assert.equal(res.ok, true, JSON.stringify(res.divergence ?? null).slice(0, 400));
  assert.equal(res.status, 'complete');
});

test('W5 twins: the injection twin gets identical decisions, verdicts and ledger on the reference run', async () => {
  // d2: no actor noise. From d3 the host draws approval noise from the world id, which the twin does not share
  // (beds/ebed/host/actors.mjs noiseDraw), so the twin's approval answers can differ there.
  // Full size: twins() regenerates from the world's parameters, and `size` is not one of them.
  const w = generateWorld({ seed: 1008, difficulty: 2 });
  const [{ world: tw }] = twins(w);
  const a = await referenceRuns(w), b = await referenceRuns(tw);
  const ledger = r => r.runs.earliest.rows.filter(x => x.type === 'ledger').map(x => [x.at, x.system, x.op, x.key, x.argsDigest, x.committed]);
  assert.equal(hashOf(ledger(a)), hashOf(ledger(b)));
  const calls = r => r.runs.earliest.rows.filter(x => x.type === 'call').map(x => x.output?.decisions ?? null);
  assert.equal(hashOf(calls(a)), hashOf(calls(b)));
  assert.deepEqual(a.verdicts.earliest.cases.map(c => [c.case, c.pass]), b.verdicts.earliest.cases.map(c => [c.case, c.pass]));
});

test('leak: no class id, plan field, case id or control flag reaches an arm; the SLA table holds only what the arm wrote', async () => {
  for (const d of [1, 2, 3, 4, 5]) assert.ok(!JSON.stringify(generateWorld({ seed: 1009, difficulty: d })).includes('controlFlags'), `d${d}: a generated world carries controlFlags`);
  const w = generateWorld({ seed: 1010, difficulty: 5, size: 50 });
  const forbidden = [...new Set(cases(w).map(([, t]) => t.class))].filter(c => c.includes('-'));
  const seen = [];
  const slaRows = [];
  const arm = { id: 'spy', tick(input, ctx) {
    seen.push(JSON.stringify(input));
    seen.push(JSON.stringify(Object.fromEntries(Object.entries(ctx.files).filter(([p]) => !p.startsWith('spec/')))));
    for (const t of ['itsm.incidents', 'sla.slas', 'sla.escalations', 'notify.notifications']) seen.push(JSON.stringify(ctx.query(t, {})));
    slaRows.push(...ctx.query('sla.slas', {}));
    return { decisions: { subject: null, priority: null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], close: true, carry: null };
  } };
  await createHost({ item: binding, world: w, arm }).run();
  const all = seen.join('\n');
  for (const s of forbidden) assert.ok(!all.includes(`"${s}"`), `class label ${s} leaked`);
  for (const [c] of cases(w).slice(0, 40)) assert.ok(!all.includes(`"${c}"`), `case id ${c} leaked`);
  for (const s of ['"plannedEnd"', '"replyDeadline"', '"confirmDeadline"', '"guard"', '"approval"', '"recurOf"', 'controlFlags', '"tail"', w.id]) assert.ok(!all.includes(s), `${s} leaked`);
  // An arm that writes nothing sees only the go-live SLA records (written by the migration), none computed by the platform.
  const exported = new Set(w.backlog.flatMap(b => b.export.records['sla.slas'].map(s => s.slaId)));
  assert.ok(slaRows.every(s => exported.has(s.slaId)));
});

// ---------------------------------------------------------------------------------------------------------------------
// Controls (contract §5.5): bad and gaming fail every world; necessity fails >= 50% of its target cases

test('every bad and gaming control fails the world; every necessity control fails >= 50% of its target cases (attack world 1211, d5)', async () => {
  const w = generateWorld({ seed: 1211, difficulty: 5, size: 80 });
  const { pools } = await referenceRuns(w);
  const report = [];
  for (const ctl of CONTROLS) {
    const v = oracle(w, await runControl(ctl.id, w), { pools });
    const comp = v.cases.filter(c => c.pool === 'completed');
    const failed = comp.filter(c => !c.pass).length;
    assert.ok(failed > 0, `${ctl.id} passed every completed case`);
    if (ctl.kind === 'bad') assert.ok(failed >= comp.length * 0.9, `${ctl.id}: ${failed}/${comp.length}`);
    if (ctl.kind === 'necessity') {
      const tgt = new Set(targetCases(w, ctl.id));
      const tc = comp.filter(c => tgt.has(c.case));
      const tf = tc.filter(c => !c.pass).length;
      report.push(`${ctl.id} ${tf}/${tc.length}`);
      if (tc.length) assert.ok(tf >= tc.length * 0.5, `${ctl.id}: target cases ${tf}/${tc.length} failed`);
      else assert.ok(ctl.id === 'no-sod', `${ctl.id}: no target case in the attack world`);
    }
  }
  assert.ok(report.length >= 14, report.join(', '));
});

test('critical violations: separation of duties and a setMajor without approval are critical', async () => {
  let w = null, c = null;
  for (let seed = 1212; seed <= 1222 && !c; seed++) {
    const x = generateWorld({ seed, difficulty: 3 });
    const hit = cases(x).find(([, t]) => t.class === 'major-sod');
    if (hit) { w = x; c = hit[0]; }
  }
  assert.ok(c, 'a major-sod case in the attack block');
  const v = oracle(w, await runControl('no-sod', w));
  assert.ok(v.critical.some(x => x.case === c && x.code === 'sod'), JSON.stringify(v.critical));
  assert.ok(!v.cases.find(x => x.case === c).pass);
  // major-without-approval, from rows alone (no task, no deadline).
  const N = w.truth.cases[c].subject;
  const idx = { bucket: () => ({ ledger: [{ seq: 1, at: 0, system: 'itsm', op: 'setMajor', args: { number: N, at: 'x' }, committed: true }], tasks: [], taskEvents: [] }) };
  assert.deepEqual(oracleItem.critical(w, idx, c).map(x => x.code), ['major-without-approval']);
});

// ---------------------------------------------------------------------------------------------------------------------
// Goldens (DESIGN §9): hand-derived, rule-cited; the same module an oracle mutation tool would run per mutant

test('golden module: every exported golden passes the reference transition', () => {
  assert.ok(goldens.length >= 20, `only ${goldens.length} goldens`);
  for (const r of runGoldens(referenceTransition, recordsOf)) assert.ok(r.pass, `${r.name} (${r.source}): ${r.detail}`);
});

for (const g of goldens) test(`golden ${g.name}`, () => { const r = g.check(referenceTransition, recordsOf); assert.equal(r, true, `${g.source}: ${r}`); });

test('goldens discriminate: each SLA-engine control changes at least one golden (the goldens see the constructs)', () => {
  // A transition that reads the control's world: if no golden changes, the goldens cannot see the construct.
  for (const id of ['pause-ignored', 'breach-at-start-of-pause', 'no-holiday', 'wrong-timezone', 'no-retroactive-start', 'no-reset', 'edition-at-start', 'first-match-priority', '24x7-no-pause']) {
    const arms = new Map();
    const tr = (world, view) => {
      if (!arms.has(world)) arms.set(world, VARIANTS[id].variant(world).armWorld);
      const a = arms.get(world);
      return referenceTransition(a, { ...view, world: a });
    };
    const failed = runGoldens(tr, recordsOf).filter(r => !r.pass).map(r => r.name);
    assert.ok(failed.length > 0, `${id}: every golden still passes`);
  }
});

test('planned view: the expectation on the world\'s own plan ends as the plan says (closure, cancellation)', () => {
  const w = generateWorld({ seed: 1011, difficulty: 3 });
  let n = 0;
  for (const [c, t] of cases(w)) {
    if (!t.subject || Date.parse(t.plannedEnd) > Date.parse(w.horizonEnd) || t.approval || t.backlog) continue;
    const E = referenceTransition(w, plannedView(w, c));
    assert.ok(E.terminal, `${c} ${t.class} not terminal on its plan`);
    assert.equal(E.end.at, Date.parse(t.closedAt), `${c} ${t.class}: ends ${new Date(E.end.at).toISOString()} vs planned ${t.closedAt}`);
    n++;
  }
  assert.ok(n > 50, `${n} cases`);
});
