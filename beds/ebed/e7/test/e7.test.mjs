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
import { editionAt } from '../transition.mjs';
import { independentSlas, comparable, fuzzHistory } from './sla-independent.mjs';
import { runReference } from '../../oracle/policy.mjs';
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

test('SLA engine N-version, R4.2-R4.3 (review 2026-10-15 round 2): sla.mjs = an independent evaluator on fuzzed histories; retroactive history = live history; a pause ending at the attach is seen', async () => {
  // The independent evaluator (test/sla-independent.mjs) is written from the spec with its own structure, R0 and clock.
  // Fuzzed histories on the d5 rulebook (12 definitions, edition 2 from 03-23): same-instant merged changes, resets on
  // reassignment, edition switches, holds of three kinds, retroactive attaches during or at the end of a pause.
  const w = generateWorld({ seed: 1002, difficulty: 5 });
  const ctx = { world: w, defsAt: x => editionAt(w, x).defs, scheduleOf: { service: id => w.master.services.find(s => s.service === id).supportSchedule, group: id => w.master.groups.find(g => g.group === id).schedule } };
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  const ED2 = Date.parse('2026-03-23T00:00:00+01:00');
  const check = engine => {
    const out = { histories: 0, diffs: [], meta: [], cov: { pauseEndsAtX: 0, retroPause: 0, reset: 0, reattach: 0, crossEdition: 0, attachPaused: 0, merged: 0, metaChecked: 0 } };
    for (let i = 0; i < 600; i++) {
      const h = fuzzHistory(w, rng('ebed-fuzz', 'e7', 'sla-independent', 1301, i));
      const mine = engine(ctx, h.incident, h.snaps);
      const a = mine.map(comparable).sort(byId), b = independentSlas(w, h.incident, h.snaps).map(comparable).sort(byId);
      out.histories++;
      if (JSON.stringify(a) !== JSON.stringify(b)) out.diffs.push(i);
      if (h.merged) out.cov.merged++;
      for (const s of b) {
        // The records an attach writes besides the start: past pauses and resumes, and the pause it attaches in (S14).
        const atAttach = s.ops.filter(o => /^(pause|resume)@/.test(o) && o.split('/')[1] === String(s.attachAt));
        if (s.startAt < s.attachAt && atAttach.includes(`resume@${s.attachAt}/${s.attachAt}`)) out.cov.pauseEndsAtX++;
        if (s.startAt < s.attachAt && atAttach.length) out.cov.retroPause++;
        if (atAttach.length && atAttach.at(-1).startsWith('pause@')) out.cov.attachPaused++;
        if (s.startAt < ED2 && s.attachAt >= ED2) out.cov.crossEdition++;
        const reset = s.ops.find(o => o.endsWith('/reset'));
        if (reset) {
          out.cov.reset++;
          const at = Number(reset.split('@')[1].split('/')[0]);
          const [num, def, gen] = s.id.split('/');
          if (b.some(t => t.id === `${num}/${def}/${Number(gen) + 1}` && t.attachAt === at)) out.cov.reattach++;
        }
      }
      // Metamorphic: a retroactive SLA's past pauses (R4.3) are the pauses a live SLA with the same pause condition,
      // attached at openedAt and never ended, records up to the attach instant (including a resume at that instant).
      for (const s of mine) {
        if (s.def.start.from !== 'openedAt' || !s.def.start.retroactivePause || !s.def.pause || s.attachAt <= s.startAt) continue;
        const shadow = { id: 'SHADOW', target: s.def.target, start: { when: [{ field: 'source', in: ['report', 'alert'] }], from: 'openedAt', retroactivePause: false }, pause: s.def.pause,
          stop: { when: [] }, cancel: { whenStartFails: false, when: [] }, reset: null, schedule: { source: 'none' }, timezone: { sources: ['definition'], definition: 'Europe/Amsterdam' }, escalations: [] };
        const [live] = engine({ ...ctx, defsAt: () => [shadow] }, h.incident, h.snaps.filter(x => x.at <= s.attachAt));
        const retro = s.ops.filter(o => (o.op === 'pause' || o.op === 'resume') && o.x === s.attachAt).map(o => `${o.op}@${o.at}`);
        const want = live.ops.filter(o => (o.op === 'pause' || o.op === 'resume') && o.at <= s.attachAt).map(o => `${o.op}@${o.at}`);
        out.cov.metaChecked++;
        if (retro.join() !== want.join()) out.meta.push(`${i} ${s.id}`);
      }
    }
    return out;
  };
  const r = check(slaTimeline);
  assert.deepEqual(r.diffs.slice(0, 5), [], `${r.diffs.length}/${r.histories} histories where sla.mjs and the independent evaluator differ`);
  assert.deepEqual(r.meta.slice(0, 5), [], `${r.meta.length} retroactive SLAs whose past pauses differ from the live history`);
  // Not vacuous: the fuzz reaches every construct the review named.
  const c = r.cov;
  assert.ok(c.pauseEndsAtX >= 5 && c.retroPause >= 10 && c.reset >= 20 && c.reattach >= 10 && c.crossEdition >= 3 && c.attachPaused >= 5 && c.merged >= 100 && c.metaChecked >= 100, JSON.stringify(c));

  // The reviewer's hand case (RES-P1, 240 min 24x7, retroactive with retroactivePause): opened at P3 08:00Z, on hold
  // awaiting the caller 08:30Z, one merged change at 09:30Z (inProgress, P1). R4.3: pause 08:30Z, resume 09:30Z, D 13:00Z.
  const F = (state, priority) => ({ priority, impact: 1, urgency: 3, state, holdReason: state === 'onHold' ? 'awaitingCaller' : null, source: 'report', service: 'SVC-NET-EU', assignmentGroup: 'GRP-NET-EU', major: false });
  const t = s => Date.parse(`2026-03-02T${s}:00Z`);
  const snaps = [{ at: t('08:00'), fields: F('assigned', 3) }, { at: t('08:30'), fields: F('onHold', 3) }, { at: t('09:30'), fields: F('inProgress', 1) }];
  const inc = { number: 'INC-H', openedAt: t('08:00'), callerTz: 'Europe/Amsterdam', ciTz: 'Europe/Amsterdam' };
  const hand = engine => {
    const s = engine(ctx, inc, snaps).find(x => x.definition === 'RES-P1');
    return { ops: s.ops.map(o => `${o.op}@${new Date(o.at).toISOString()}`), D: new Date(s.D).toISOString() };
  };
  const want = { ops: ['start@2026-03-02T08:00:00.000Z', 'pause@2026-03-02T08:30:00.000Z', 'resume@2026-03-02T09:30:00.000Z'], D: '2026-03-02T13:00:00.000Z' };
  assert.deepEqual(hand(slaTimeline), want);
  assert.deepEqual(hand((cx, i, sn) => independentSlas(w, i, sn)), want);

  // Mutation: sla.mjs without the round-2 fix (the pause interval ending at the attach dropped) is caught by the
  // N-version check, by the metamorphic relation and by the hand case.
  const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const src = readFileSync(new URL('../sla.mjs', import.meta.url), 'utf8');
  const fix = "      if (from !== null && !pausedAtX) { s.ops.push({ op: 'pause', at: from, x }, { op: 'resume', at: x, x }); from = null; }\n";
  assert.ok(src.includes(fix), 'the fix line is where the mutation expects it');
  const dir = mkdtempSync(join(tmpdir(), 'e7-sla-mutant-'));
  try {
    const file = join(dir, 'sla-mutant.mjs');
    writeFileSync(file, src.replace(fix, '').replace("from '../lib/calendar.mjs'", `from '${new URL('../../lib/calendar.mjs', import.meta.url).href}'`));
    const { slaTimeline: mutant } = await import(pathToFileURL(file).href);
    const m = check(mutant);
    assert.ok(m.diffs.length >= 3, `the N-version check misses the mutant (${m.diffs.length} diffs)`);
    assert.ok(m.meta.length >= 3, `the metamorphic relation misses the mutant (${m.meta.length})`);
    assert.notDeepEqual(hand(mutant), want, 'the hand case misses the mutant');
  } finally { rmSync(dir, { recursive: true, force: true }); }
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

test('critical major-without-approval: only a counted approve or the fail-safe excuses a setMajor (review 2026-10-15)', () => {
  // A P1 report (CI-PAY-APP1, urgency 1) opened Mon 2026-03-09 10:00+01:00; the first approval task 10:05, so the deadline
  // is 10:35 (majorApprovalMinutes 30). Before the fix every setMajor after the deadline was skipped, whatever the answer.
  const base = generateWorld({ seed: 1001, difficulty: 3 });
  const caller = base.master.users.find(u => u.region === 'EU' && u.roles.length === 1 && u.roles[0] === 'caller');
  const N = 'INC-RPT-CRIT-0001', c = 'crit';
  const w = { ...base, truth: { ...base.truth, cases: { ...base.truth.cases, [c]: { subject: N, start: '2026-03-09T09:00:00Z', class: 'golden', callerId: caller.userId } } } };
  const T = s => Date.parse(`2026-03-09T${s}:00+01:00`);
  assert.equal(JSON.parse(w.rulebook.editions[0].files['policy.json']).majorApprovalMinutes, 30);
  const run = ({ answers = [], resolveAt = null, setMajorAt, tasks = [['10:05', 'mia#1']] }) => {
    let seq = 0;
    const deliveries = [{ seq: ++seq, at: T('10:00'), instance: 'g', round: 1, event: { id: 'ev-crit-1', type: 'incident.reported', source: 'portal',
      payload: { reportId: 'RPT-CRIT-0001', callerId: caller.userId, ci: 'CI-PAY-APP1', category: 'software', urgency: 1, summary: 'x' } } }];
    if (resolveAt) deliveries.push({ seq: ++seq, at: T(resolveAt), instance: 'g2', round: 1, event: { id: 'ev-crit-2', type: 'resolver.update', source: 'workspace',
      payload: { number: N, group: 'x', user: 'u-r', action: 'resolve', closeCode: 'fixed' } } });
    const tk = tasks.map(([at, id]) => ({ seq: ++seq, at: T(at), instance: 'g', task: { id, kind: 'majorIncidentApproval', role: 'incidentManager', excludeUsers: [caller.userId], subject: N } }));
    const ev = answers.map(([at, decision, taskId = 'mia#1']) => ({ seq: ++seq, at: T(at), type: 'humanTask.answered', instance: 'g', payload: { taskId, user: 'u-im2', answer: decision ? { decision } : { text: 'not sure' } } }));
    const ledger = [{ seq: ++seq, at: T(setMajorAt), system: 'itsm', op: 'setMajor', args: { number: N, at: 'x' }, committed: true }];
    const all = [...deliveries, ...tk, ...ev, ...ledger].sort((a, b) => a.at - b.at || a.seq - b.seq);
    all.forEach((x, i) => { x.seq = i + 1; });
    return oracleItem.critical(w, { bucket: () => ({ deliveries, ledger, tasks: tk, taskEvents: ev, calls: [] }), horizonMs: Date.parse(w.horizonEnd) }, c).map(x => x.code);
  };
  const MWA = ['major-without-approval'];
  assert.deepEqual(run({ answers: [['10:30', 'reject']], setMajorAt: '10:40' }), MWA, 'setMajor after a counted reject (the reviewer\'s case)');
  assert.deepEqual(run({ answers: [['10:30', 'approve']], resolveAt: '10:20', setMajorAt: '10:40' }), MWA, 'setMajor after the approval became moot');
  assert.deepEqual(run({ answers: [['10:20', 'reject'], ['10:30', 'approve', 'mia#2']], tasks: [['10:05', 'mia#1'], ['10:25', 'mia#2']], setMajorAt: '10:31' }), MWA, 'an approve after a counted reject does not count');
  assert.deepEqual(run({ setMajorAt: '10:35' }), MWA, 'the fail-safe is due strictly after the deadline');
  assert.deepEqual(run({ answers: [['10:40', 'approve']], setMajorAt: '10:30' }), MWA, 'setMajor before any answer');
  assert.deepEqual(run({ setMajorAt: '10:36' }), [], 'the fail-safe: no answer by the deadline');
  assert.deepEqual(run({ answers: [['10:20', null]], setMajorAt: '10:40' }), [], 'an unusable answer is no answer: fail-safe');
  assert.deepEqual(run({ answers: [['10:30', 'approve']], setMajorAt: '10:31' }), [], 'a counted approve');
  assert.deepEqual(run({ answers: [['10:35', 'approve']], setMajorAt: '10:45' }), [], 'an approve at the deadline counts (S1)');
});

test('critical (round 2): only an answer to a counted task excuses a setMajor; a cancellation at the deadline leaves no fail-safe (R7.2, S16)', () => {
  // The P1 report of the previous test: opened 10:00, first task 10:05, deadline 10:35.
  const base = generateWorld({ seed: 1001, difficulty: 3 });
  const caller = base.master.users.find(u => u.region === 'EU' && u.roles.length === 1 && u.roles[0] === 'caller');
  const N = 'INC-RPT-CRIT-0002', c = 'crit2';
  const w = { ...base, truth: { ...base.truth, cases: { ...base.truth.cases, [c]: { subject: N, start: '2026-03-09T09:00:00Z', class: 'golden', callerId: caller.userId } } } };
  const T = s => Date.parse(`2026-03-09T${s}:00+01:00`);
  const run = ({ tasks = [['10:05', 'mia#1']], taskEvents = [], extra = [], rows = [] }) => {
    const deliveries = [{ at: T('10:00'), instance: 'g', round: 1, event: { id: 'ev-c2-0', type: 'incident.reported', source: 'portal',
      payload: { reportId: 'RPT-CRIT-0002', callerId: caller.userId, ci: 'CI-PAY-APP1', category: 'software', urgency: 1, summary: 'x' } } }];
    extra.forEach(([at, type, payload], i) => deliveries.push({ at: T(at), instance: `g${i + 2}`, round: 1, event: { id: `ev-c2-${i + 1}`, type, source: type === 'caller.message' ? 'mail' : 'workspace', payload } }));
    const tk = tasks.map(([at, id]) => ({ at: T(at), instance: 'g', task: { id, kind: 'majorIncidentApproval', role: 'incidentManager', excludeUsers: [caller.userId], subject: N } }));
    const ev = taskEvents.map(([at, type, taskId, decision]) => ({ at: T(at), type, instance: 'g',
      payload: { taskId, user: 'u-im2', ...(type === 'humanTask.answered' ? { answer: decision ? { decision } : { text: 'not sure' } } : {}) } }));
    const ledger = rows.map(([at, op]) => ({ at: T(at), system: 'itsm', op, args: { number: N, at: 'x' }, committed: true }));
    const all = [...deliveries, ...tk, ...ev, ...ledger].sort((a, b) => a.at - b.at);
    all.forEach((x, i) => { x.seq = i + 1; });
    return oracleItem.critical(w, { bucket: () => ({ deliveries, ledger, tasks: tk, taskEvents: ev, calls: [] }), horizonMs: Date.parse(w.horizonEnd) }, c).map(x => x.code).sort();
  };
  const MWA = 'major-without-approval', ANS = 'humanTask.answered';
  const withdraw = at => [at, 'caller.message', { from: caller.email, incidentRef: N, intent: 'withdraw', text: 'x' }];
  // R7.2: a re-ask nobody sanctioned is an extra task; an approve on it excuses nothing.
  assert.deepEqual(run({ tasks: [['10:05', 'mia#1'], ['10:10', 'mia#2']], taskEvents: [['10:20', ANS, 'mia#2', 'approve']], rows: [['10:21', 'setMajor']] }), [MWA], 'approve on an unsanctioned re-ask');
  assert.deepEqual(run({ tasks: [['10:05', 'mia#1'], ['10:10', 'mia#2']], taskEvents: [['10:20', ANS, 'mia#2', 'reject']], rows: [['10:36', 'setMajor']] }), [], 'a reject on an extra task does not count: the fail-safe is still due');
  for (const cause of [[ANS, null], ['humanTask.answerRejected'], ['humanTask.withdrawn']]) {
    assert.deepEqual(run({ tasks: [['10:05', 'mia#1'], ['10:22', 'mia#2']], taskEvents: [['10:20', cause[0], 'mia#1', cause[1]], ['10:30', ANS, 'mia#2', 'approve']], rows: [['10:31', 'setMajor']] }), [],
      `a re-ask after ${cause[0]}${cause[1] === null ? ' (no decision)' : ''} counts`);
  }
  assert.deepEqual(run({ tasks: [['10:05', 'mia#1'], ['10:22', 'mia#2'], ['10:24', 'mia#3']], taskEvents: [['10:20', ANS, 'mia#1', null], ['10:30', ANS, 'mia#3', 'approve']], rows: [['10:31', 'setMajor']] }), [MWA],
    'one unusable answer sanctions one re-ask');
  // S16: withdrawn at the deadline before an answer: no fail-safe; one taken anyway is critical twice (after the cancel).
  assert.deepEqual(run({ extra: [withdraw('10:35')], rows: [['10:35', 'cancel']] }), []);
  assert.deepEqual(run({ extra: [withdraw('10:35')], rows: [['10:35', 'cancel'], ['10:36', 'setMajor']] }), ['effect-after-end', MWA]);
  // Resolved at the deadline: R7.3 says before, so the fail-safe is still due and excused.
  assert.deepEqual(run({ extra: [['10:35', 'resolver.update', { number: N, group: 'x', user: 'u-r', action: 'resolve', closeCode: 'fixed' }]], rows: [['10:35', 'resolve'], ['10:36', 'setMajor']] }), []);
});

test('escalate after the end: spec, mock and oracle agree (SPEC §2, R5.1, S3; review 2026-10-15 round 2)', () => {
  // G15's history: RES-P1 (240, 24x7) on an alert opened 10:00, resolved 14:00 (= D). The 100% notice is due from 14:00 and
  // ordered after the SLA's start only, so it may follow the stop record, which the mock accepts (world.test.mjs).
  const w = generateWorld({ seed: 1001, difficulty: 3, mix: 'tail' });
  const N = 'INC-ALR-RND2-0001', S = `${N}/RES-P1/1`;
  const at = s => Date.parse(`2026-03-09T${s}:00+01:00`);
  const ev = (seq, t, type, source, payload) => ({ id: `ev-r2-${seq}`, type, at: at(t), seq, source, instance: 'g', round: 1, payload });
  const events = [ev(1, '10:00', 'alert.raised', 'monitor', { alertId: 'ALR-RND2-0001', ci: 'CI-SW-AMS1', check: 'ping', severity: 'critical', raisedAt: 'x' }),
    ev(2, '10:20', 'resolver.update', 'workspace', { number: N, group: 'x', user: 'u', action: 'accept' }), ev(3, '14:00', 'resolver.update', 'workspace', { number: N, group: 'x', user: 'u', action: 'resolve', closeCode: 'fixed' })];
  const E = referenceTransition(w, { case: 'golden', at: at('14:01'), seq: Infinity, world: w, truth: { subject: N, start: '2026-03-09T09:00:00Z', class: 'golden' }, events, rows: [], tasks: [], taskEvents: [] });
  const esc = E.effects.required.find(e => e.lid === `esc:${S}:100`), stop = E.effects.required.find(e => e.lid === `sla:${S}:stop`);
  assert.ok(esc && stop, 'the 100% notice and the stop are both required');
  assert.deepEqual(esc.after, [`sla:${S}:start`], 'an escalation is ordered after the start only, never after or before the stop');
  assert.equal(esc.window.earliest, stop.window.earliest, 'both due from the stop instant (S3)');
  assert.ok(specE.text.replace(/\s+/g, ' ').includes('`escalate` is the exception: it is accepted for a recorded SLA at any stage, also after its `stop` or `cancel`'));
});

test('F5 (SPEC §1 API changes): a create written with the retired name is refused 400 and re-issued under the same key: no 409, no key-split, and it misses its [t, t] window (review 2026-10-15 round 2)', async () => {
  const w = generateWorld({ seed: 1015, difficulty: 5, size: 40 });
  const f5 = w.faults.find(f => f.kind === 'F5');
  assert.deepEqual([f5.system, f5.op, f5.params.from, f5.params.to], ['itsm', 'create', 'ci', 'configurationItem']);
  // The reference writes the names the API file shows at t. This variant writes the retired `ci` on its first attempt of
  // every create after the rename (an arm working from an old copy of the schema), then follows the reference: on the
  // 400 it re-issues the create, corrected, under the same key when the result arrives.
  const stale = new Set();
  const post = o => ({ ...o, effects: o.effects.map(e => {
    if (e.system !== 'itsm' || e.op !== 'create' || !('configurationItem' in (e.args ?? {})) || stale.has(e.key)) return e;
    stale.add(e.key);
    const { configurationItem, ...rest } = e.args;
    return { ...e, args: { ...rest, ci: configurationItem } };
  }) });
  const run = await runReference({ item: oracleItem, binding, world: w, timing: 'earliest', variant: { post } });
  const ledger = run.rows.filter(r => r.type === 'ledger');
  const creates = ledger.filter(r => r.system === 'itsm' && r.op === 'create');
  const refused = creates.filter(r => !r.committed);
  assert.ok(stale.size >= 3 && refused.length === stale.size, `${stale.size} stale creates, ${refused.length} refused`);
  for (const r of refused) {
    assert.deepEqual([r.error?.code, r.error?.reason], [400, 'field-renamed']);
    const again = creates.find(x => x.committed && x.key === r.key);
    assert.ok(again && Date.parse(again.at) > Date.parse(r.at), `${r.key}: re-issued later under the same key and committed`);
  }
  assert.deepEqual(ledger.filter(r => r.error?.code === 409).map(r => `${r.system}.${r.op} ${r.error.reason}`), [], 'no key conflict');
  const v = oracle(w, run.rows);
  const staleCases = new Set(refused.map(r => r.subjectCase));
  assert.equal(staleCases.size, refused.length);
  for (const cv of v.cases) {
    assert.ok(!['key-split', 'key-reuse'].includes(cv.firstDivergence?.code), `${cv.case}: ${cv.firstDivergence?.code}`);
    if (staleCases.has(cv.case)) {
      assert.equal(cv.pass, false, `${cv.case} passed with a late create`);
      assert.deepEqual([cv.firstDivergence.layer, cv.firstDivergence.lid], [3, `create:${cv.subject}`], `${cv.case}: ${JSON.stringify(cv.firstDivergence)}`);
      assert.ok(['missed', 'late'].includes(cv.firstDivergence.code));
    } else if (cv.complete) assert.ok(cv.pass, `${cv.case} ${JSON.stringify(cv.firstDivergence)}`);
  }
  assert.equal(v.critical.length, 0);
});

test('spec states the readings the oracle grades: S13-S16, the warning rule, API changes, escalate after the end, DST and re-asks (reviews 2026-10-15)', () => {
  for (const r of ['S13', 'S14', 'S15', 'S16']) assert.ok(specE.text.includes(`- ${r} `), `${r} missing from the spec`);
  // Round 2: what the oracle and the host already did, now said where an arm reads it.
  const flat = specE.text.replace(/\s+/g, ' ');
  for (const phrase of [
    '**API changes.** `api/<system>.schema.json` always shows the current argument names of every op, and a system can rename an argument during the stream',
    'Read the file on every call and write each effect with the names it shows at the instant you emit it.',
    'An error `400` (`invalid-args`, `field-renamed`) means your request was wrong',
    "correct it and re-issue it, with the same key, inside the rule's window; it is not a `409`, since the refused request committed nothing and keys are compared under the system's own names",
    '(`itsm.create`, R1.1, window [t, t]) leaves no time for a second attempt',
    "Arguments are compared under each system's own field names",
    '`escalate` is the exception: it is accepted for a recorded SLA at any stage, also after its `stop` or `cancel`',
    'each real instant in between counts once',
    'holds 60 minutes on 2026-03-29 (02:00 jumps to 03:00) and 180 minutes on 2026-10-25 (03:00 falls back to 02:00)',
    'No schedule of this service desk has an interval that contains a clock change.',
    'once for each answer to one of your counted tasks (the first, or an earlier re-ask) that was unusable, was withdrawn',
    'Any other further approval task is an error',
    'An incident closed or cancelled **at** the deadline, before an answer counts, is moot too (S16).',
  ]) assert.ok(flat.includes(phrase), `spec lacks: ${phrase}`);
  // No generated schedule has a business interval across a clock change (R4.4 says so): every interval is in daytime.
  const w5 = generateWorld({ seed: 1001, difficulty: 5 });
  for (const cal of Object.values(w5.calendars)) {
    if (cal.businessHours === '24x7') continue;
    for (const [a, b] of cal.businessHours.hours) assert.ok(a >= '04:00' && b <= '23:00', `${cal.id} ${a}-${b} may contain a clock change`);
  }
  assert.match(specE.text, /`plannedBreachAt` as of `startAt`, S13/);
  assert.match(specE.text, /\(`warning`\) changes nothing and\s+belongs to no incident \(`decisions\.subject` is `null`\), even when it names the CI and check of an open incident/);
  // The warning reading on a generated world: a warning on the CI and check of an open alert incident is graded subject
  // null (warnings land on such a pair by chance: 4 of 185 on dev seeds 1001-1030 d2-d5; seed 1012 d3 has i0067 on i0061).
  let n = 0;
  for (const seed of [1012]) {
    const w = generateWorld({ seed, difficulty: 3 });
    const open = cases(w).filter(([, t]) => t.subject && t.source?.kind === 'alert');
    for (const [c, t] of cases(w).filter(([, x]) => x.class === 'alert-warning')) {
      const a = w.arrivals.find(e => w.truth.eventCase[e.id] === c);
      const at = Date.parse(a.at);
      const hit = open.find(([, o]) => o.ci === a.payload.ci && o.check === a.payload.check && Date.parse(o.openedAt) <= at && (!o.resolvedAt || Date.parse(o.resolvedAt) > at));
      if (!hit) continue;
      const E = referenceTransition(w, plannedView(w, c));
      assert.deepEqual(E.decisions.graded, { subject: null, priority: null }, `${c}: warning on open ${hit[1].subject}`);
      assert.equal(E.effects.required.length, 0);
      n++;
    }
  }
  assert.ok(n >= 1, 'no warning on an open incident in dev world 1012 d3');
});

test('seed discipline: the walker check runs on dev seeds only and the touch of rehearsal seed 1241 is recorded (review 2026-10-15)', async () => {
  const { readFileSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [new URL('../tools/walker-grade.mjs', import.meta.url).pathname, '--seed', '1241'], { encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(r.status, 0, 'walker-grade ran on a rehearsal seed');
  assert.match(r.stderr, /single-use rehearsal block 1201-1249/);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const m = /\*\*Discrimination sanity check\*\*[^]*?seed (\d+) d3/.exec(readme);
  assert.ok(m, 'README states the discrimination check and its seed');
  assert.ok(Number(m[1]) >= 1001 && Number(m[1]) <= 1199, `README discrimination check on seed ${m[1]}, not a dev seed`);
  const ledger = JSON.parse(readFileSync(new URL('../../../../research/jit-20261008/SEED-LEDGER.json', import.meta.url), 'utf8'));
  const e7 = ledger.ranges.find(x => x.id === 'ebed-e7-rehearsal');
  assert.match(e7.use, /1241 touched 2026-10-14 at d3 by the part-A walker discrimination check only/);
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
