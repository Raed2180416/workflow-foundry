// R-bench item home-assistant:CCOSTAN/.../garbage_day_garage.yaml#0.   node --test experiments/replicate/items/home-assistant-ccostan-garbage-day-garage/item.test.mjs
// Oracle health per beds/CONTRACT.md: determinism, references pass (>=20 seeds), every bad control fails (>=20 seeds), schema-invalid output
// rejected, no hidden-truth leak, runtime limits. Plus: the mock Home Assistant's semantics, the env protocol, an independently structured
// valid solution, tolerance and ordering rules, the T3 reliability probes and cost cap, and the controls built on the ORIGINAL definition.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as bed from './index.mjs';
import { CONFIG, SPEC, TEXT, norm, LIMITS, T3_COST, VERSION } from './spec.mjs';
import { HAMock, installTimer, PRI, strftime, parseDuration, formatLocal, parseLocal, weekdayOf } from './mocks/ha-core.mjs';
import { buildGarageWorld } from './mocks/garage-world.mjs';
import { createEnv, driveSync, drive, replay, scenarioList } from './env.mjs';
import { scenariosFor, exampleScenarios, CORE_IDS, PROBE_IDS } from './scenarios.mjs';
import { matchTraces, normalizeCall, E } from './trace.mjs';
import { oracle, checkOutput, judgeScenario } from './oracle.mjs';
import { makeFaithful, makeImproved } from './controls/reference.mjs';
import { makeAlternative } from './controls/alternative.mjs';
import { BROKEN, T3_ONLY } from './controls/broken.mjs';
import { ORIGINAL, originalText, corpusMatches, loadOriginal, makeOriginal, makeOriginalIterationLocal, MUTANTS, makeMutant, sha256 } from './controls/original.mjs';
import { parseYaml, YamlUnsupported } from './controls/miniyaml.mjs';
import { render, TemplateUnsupported } from './controls/minijinja.mjs';
import { createAutomationHandler, UnsupportedSemantics } from './controls/original-engine.mjs';
import { hashes, FROZEN_INSTANCES, keyOfInstance } from './freeze.mjs';
import { canonical } from '../../../../beds/lib/canonical.mjs';
import { buildExamples } from './examples.mjs';

const SEEDS = Array.from({ length: 20 }, (_, i) => i);
const gen = (seed, difficulty = 3, variant = 'T2', split = 'dev') => bed.generate({ seed, split, difficulty, variant });
const task = (seed, variant = 'T2', difficulty = 3, split = 'dev') => ({ seed, split, difficulty, variant });
const here = new URL('./', import.meta.url);

// ---------------------------------------------------------------------------------------------------------------- contract
test('interface shape (beds/CONTRACT.md v1, interactive)', () => {
  assert.equal(bed.family.kind, 'interactive');
  for (const k of ['id', 'domain', 'version', 'description']) assert.ok(bed.family[k], k);
  for (const fn of ['generate', 'oracle', 'referenceSolve', 'createEnv', 'materialize']) assert.equal(typeof bed[fn], 'function', fn);
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted', 'plausible-but-wrong', 'do-nothing']) assert.ok(names.includes(n), n);
  assert.ok(bed.badControls.length >= 20);
  for (const c of [...bed.badControls, ...bed.t3Controls]) assert.equal(typeof c.make, 'function', c.name);
  const forbidden = ['pattern', 'oneOf', 'anyOf', 'allOf', 'uniqueItems', '$ref', 'format', 'patternProperties'];
  assert.ok(!forbidden.some(k => JSON.stringify(bed.outputSchema).includes(`"${k}"`)), 'portable schema subset');
  const env = bed.createEnv(gen(0));
  for (const fn of ['reset', 'step', 'observe', 'snapshot', 'restore', 'actions', 'record']) assert.equal(typeof env[fn], 'function', fn);
  assert.equal(env.determinism, 'D0');
  assert.equal(bed.ITEM.id, ORIGINAL.id);
  assert.equal(path.basename(new URL('.', import.meta.url).pathname.replace(/\/$/, '')), bed.ITEM.safeId);
});

test('determinism: identical calls give byte-identical tasks; seed, split, difficulty and variant matter', () => {
  for (const variant of bed.VARIANTS) for (const d of [1, 3, 5]) {
    const a = gen(7, d, variant), b = gen(7, d, variant);
    assert.equal(canonical(a), canonical(b));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  }
  assert.equal(canonical(scenariosFor({ seed: 4, split: 'dev', difficulty: 3 })), canonical(scenariosFor({ seed: 4, split: 'dev', difficulty: 3 })));
  assert.notEqual(canonical(scenariosFor({ seed: 3, split: 'dev', difficulty: 3 })), canonical(scenariosFor({ seed: 4, split: 'dev', difficulty: 3 })));
  assert.notEqual(canonical(scenariosFor({ seed: 3, split: 'dev', difficulty: 3 })), canonical(scenariosFor({ seed: 3, split: 'test', difficulty: 3 })));
  assert.notEqual(canonical(scenariosFor({ seed: 3, split: 'dev', difficulty: 1 })), canonical(scenariosFor({ seed: 3, split: 'dev', difficulty: 5 })));
  assert.notEqual(canonical(gen(3, 3, 'T1')), canonical(gen(3, 3, 'T2')));
  assert.equal(gen(3, 3, 'T2').id, `rbench:${bed.ITEM.safeId}:T2:dev:d3:s3`);
  assert.deepEqual(Object.keys(gen(3, 3, 'T2')).sort(), ['budget', 'difficulty', 'family', 'files', 'id', 'inputs', 'prompt', 'seed', 'split', 'variant']);
  assert.deepEqual(Object.keys(gen(3, 3, 'T3')).sort(), ['attachments', 'budget', 'difficulty', 'family', 'files', 'id', 'inputs', 'prompt', 'seed', 'split', 'variant']);
});

test('generate rejects bad arguments', () => {
  assert.throws(() => bed.generate({ seed: 1, split: 'train', difficulty: 1, variant: 'T2' }), /split/);
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 0, variant: 'T2' }), /difficulty/);
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 6, variant: 'T2' }), /difficulty/);
  assert.throws(() => bed.generate({ seed: 1.5, split: 'dev', difficulty: 3, variant: 'T2' }), /seed/);
  assert.throws(() => bed.generate({ seed: 'examples', split: 'dev', difficulty: 3, variant: 'T2' }), /reserved/);
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 3, variant: 'T9' }), /variant/);
});

test('the three variants give the solver what the R-bench design says', () => {
  const t1 = gen(1, 3, 'T1'), t2 = gen(1, 3, 'T2'), t3 = gen(1, 3, 'T3');
  // T1: the original definition, no description, no examples
  assert.equal(t1.attachments.length, 1);
  assert.ok(t1.inputs.haSemantics && !t1.inputs.description && !t1.inputs.examples);
  assert.match(t1.prompt, /TRANSLATE/);
  // T2: only the description and worked examples; the original definition is not given
  assert.equal(t2.attachments, undefined);
  assert.ok(t2.inputs.description && t2.inputs.examples?.scenarios?.length === 4 && !t2.inputs.haSemantics);
  assert.ok(!JSON.stringify(t2).includes('mode: restart') && !JSON.stringify(t2).includes('for_each'), 'T2 must not carry the original definition');
  assert.match(t2.prompt, /REBUILD FROM INTENT/);
  // T3: the definition and a cost / latency / reliability target, not the description
  assert.equal(t3.attachments.length, 1);
  assert.equal(t3.budget.selfInflictedWork, T3_COST.cap);
  assert.ok(Number.isFinite(t3.budget.selfInflictedWork) && t3.budget.selfInflictedWork > 0);
  assert.match(t3.prompt, /IMPROVE/);
  assert.match(t3.prompt, /\+-1 s/);
  assert.ok(!t3.inputs.description);
  for (const t of [t1, t2, t3]) assert.ok(t.files['handler.mjs'].includes('createHandler'));
  // T1/T3: the attachment is the pinned MIT file; materialize copies it and its LICENSE
  const dir = mkdtempSync(path.join(tmpdir(), 'rbench-ha-'));
  try {
    for (const t of [t1, t3]) {
      const written = bed.materialize(t, dir);
      assert.equal(written.length, 1);
      assert.equal(sha256(readFileSync(written[0], 'utf8')), t.attachments[0].sha256);
      assert.match(readFileSync(path.join(path.dirname(written[0]), 'LICENSE'), 'utf8'), /MIT License[\s\S]*Carlo Costanzo/);
    }
    assert.deepEqual(bed.materialize(t2, dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------- mock Home Assistant
test('ha-core: clock, strftime, durations', () => {
  const t = parseLocal('2026-10-07T07:30:00');
  assert.equal(weekdayOf(t), 'wed');
  assert.equal(strftime(t, '%a %A %H:%M:%S %b %d %Y'), 'Wed Wednesday 07:30:00 Oct 07 2026');
  assert.equal(formatLocal(t + 0.5), '2026-10-07T07:30:00.500');
  assert.throws(() => strftime(t, '%q'), /unsupported directive/);
  for (const [v, s] of [['0:30:00', 1800], ['00:30:00', 1800], ['02:00:00', 7200], [1800, 1800], ['1800', 1800], ['00:30', 1800], [{ minutes: 30 }, 1800], [{ hours: 1, seconds: 5 }, 3605], ['0:00:00.5', 0.5]]) assert.equal(parseDuration(v), s, JSON.stringify(v));
  for (const v of ['abc', '', null, -5, '1:99:00', { weeks: 1 }, []]) assert.equal(parseDuration(v), null, JSON.stringify(v));
});

test('ha-core: queue order (world, then internal, then solver wake-ups at the same instant) and dump/load', () => {
  const w = new HAMock({ start: '2026-10-07T07:30:00' });
  w.schedule(5, PRI.wake, 'wake', { id: 'w' });
  w.schedule(5, PRI.script, 'script', { entry: 's' });
  w.schedule(5, PRI.internal, 'timer_expire', {});
  w.schedule(3, PRI.wake, 'wake', { id: 'early' });
  assert.deepEqual(w.queue.map(q => q.kind + (q.id ?? '')), ['wakeearly', 'script', 'timer_expire', 'wakew']);
  const d = w.dump(); const w2 = new HAMock({ start: '2026-10-07T07:30:00' }); w2.load(d);
  assert.deepEqual(w2.dump(), d);
});

test('timer helper: start, restart with a new duration, expire to idle, cancel; invalid calls', () => {
  const w = buildGarageWorld({ start: '2026-10-07T07:30:00' });
  const T = SPEC.ids.timer;
  assert.equal(w.getState(T).state, 'idle');
  assert.equal(w.callService({ service: 'timer.start', target: { entity_id: T }, data: { duration: '00:30:00' } }).status, 200);
  assert.equal(w.getState(T).state, 'active');
  w.t = 600;      // restart with a longer duration: the first expiry (t=1800) must not end it
  assert.equal(w.callService({ service: 'timer.start', target: { entity_id: T }, data: { duration: '02:00:00' } }).status, 200);
  const first = w.pop(); assert.equal(first.at, 1800); w.t = first.at; w.runInternal(first);
  assert.equal(w.getState(T).state, 'active', 'a restarted timer ignores the old expiry');
  const second = w.pop(); assert.equal(second.at, 600 + 7200); w.t = second.at; w.runInternal(second);
  assert.equal(w.getState(T).state, 'idle');
  assert.equal(w.callService({ service: 'timer.start', data: { entity_id: T } }).status, 200, 'entity may be in data; no duration = the configured 30 minutes');
  assert.equal(w.queue.at(-1).at, w.t + 1800);
  assert.equal(w.callService({ service: 'timer.cancel', target: { entity_id: T } }).status, 200);
  assert.equal(w.getState(T).state, 'idle');
  assert.equal(w.callService({ service: 'timer.start', target: { entity_id: T }, data: { duration: 'soon' } }).status, 400);
  assert.equal(w.callService({ service: 'timer.start', target: { entity_id: 'light.kitchen' }, data: { duration: 5 } }).status, 404);
  assert.equal(w.callService({ service: 'timer.start' }).status, 404);
  assert.equal(w.callService({ service: 'light.turn_on', target: { entity_id: 'light.kitchen' } }).status, 404);
  assert.equal(w.calls.length, 8, 'the recorder keeps accepted and refused calls alike');
});

test('garage world: group state, phone buttons, outage windows, helper services', () => {
  const w = buildGarageWorld({ start: '2026-10-07T07:30:00', faults: [{ service: 'script.speech_engine', from: 10, to: 20 }] });
  const apply = (t, entry) => { w.t = t; w.applyScript(entry); return w.drain(); };
  assert.deepEqual(apply(1, { do: 'cover', door: 'large', state: 'open' }).map(o => o.entity_id), ['cover.large_garage_door', SPEC.ids.group]);
  assert.equal(w.getState(SPEC.ids.group).state, 'open');
  assert.equal(apply(2, { do: 'cover', door: 'small', state: 'open' }).length, 1, 'only the cover changed; the group is already open');
  assert.equal(w.getState(SPEC.ids.group).state, 'open');
  apply(3, { do: 'cover', door: 'large', state: 'closed' });
  assert.equal(w.getState(SPEC.ids.group).state, 'open', 'one door still open');
  const out = apply(4, { do: 'cover', door: 'small', state: 'closed' });
  assert.deepEqual(out.map(o => [o.entity_id, o.new_state]), [['cover.small_garage_door', 'closed'], [SPEC.ids.group, 'closed']]);
  // a tap before any push is not delivered; after a push it resolves the button title (case-insensitive) to the push's own action id
  assert.deepEqual(apply(5, { do: 'tap', button: 'Snooze 30m' }), []);
  assert.equal(w.log.at(-1).delivered, false);
  w.t = 6;
  w.callService({ service: 'script.notify_engine_two_button', data: { title: 'x', value1: 'a', value2: 'b', who: 'carlo', tag: 't', title1: 'Snooze 30m', action1: 'MY_A', title2: 'Snooze 2h', action2: 'MY_B' } });
  assert.deepEqual(apply(7, { do: 'tap', button: 'snooze 2H' }).map(o => o.data), [{ action: 'MY_B' }]);
  w.callService({ service: 'script.notify_engine_two_button', data: { title: 'x', value1: 'to someone else', who: 'stacey', title1: 'Snooze 30m', action1: 'OTHER' } });
  assert.equal(w.phone.current.buttons[0].action, 'MY_A', 'a push to another person does not replace what is on Carlo\'s phone');
  w.callService({ service: 'script.notify_engine_two_button', data: { title: 'y', value1: 'no buttons', who: 'carlo', title1: 'Snooze 30m', action1: '' } });
  assert.deepEqual(w.phone.current.buttons, [], 'a button exists only if its action is non-empty');
  assert.deepEqual(apply(8, { do: 'foreign_action', action: 'OTHER_APP' }).map(o => o.data), [{ action: 'OTHER_APP' }]);
  // outage window [10, 20] on the speech helper; blank logbook fields log nothing; alexa needs a message
  w.t = 9; assert.equal(w.callService({ service: 'script.speech_engine', data: { value1: 'hi' } }).status, 200);
  w.t = 15; assert.equal(w.callService({ service: 'script.speech_engine', data: { value1: 'hi' } }).status, 500);
  w.t = 21; assert.equal(w.callService({ service: 'script.speech_engine', data: { value1: 'hi' } }).status, 200);
  const before = w.log.length;
  w.callService({ service: 'script.send_to_logbook', data: { topic: ' ', message: 'x' } });
  assert.equal(w.log.length, before);
  assert.equal(w.callService({ service: 'notify.alexa_media_garage', data: { message: '' } }).status, 400);
});

// ---------------------------------------------------------------------------------------------------------------- env protocol
test('env: events one at a time in time order, fresh flag, subscriptions, wake semantics, call rules', () => {
  const t = task(2);
  const env = createEnv(t);
  let obs = env.reset();
  assert.equal(obs.event.fresh, true);
  const seen = [obs.event];
  let steps = 0;
  while (!obs.done && steps++ < 400) { obs = env.step({ call: 'done' }).observation; if (obs.event) seen.push(obs.event); }
  assert.ok(obs.done);
  // without any wake-up scheduled, the solver only ever hears about door-group changes and notification actions
  for (const e of seen) {
    assert.ok(['state_changed', 'event'].includes(e.type));
    if (e.type === 'state_changed') assert.equal(e.entity_id, SPEC.ids.group);
    else assert.equal(e.event_type, SPEC.ids.snoozeEvent);
    assert.ok(e.at.iso && e.at.weekday && Number.isFinite(e.at.epoch));
  }
  assert.equal(seen.filter(e => e.fresh).length, scenarioList(t).length, 'one fresh event per scenario');
  const epochs = seen.map(e => e.at.epoch);
  // times are non-decreasing inside a scenario
  let prev = -Infinity;
  for (const e of seen) { if (e.fresh) prev = -Infinity; assert.ok(e.at.epoch >= prev); prev = e.at.epoch; }
  assert.ok(epochs.length > 20);
  // after the end every call is ignored
  assert.equal(env.step({ call: 'ha.get_state', args: { entity_id: SPEC.ids.group } }).info.ignored, true);
});

test('env: calls, wake-ups, kv, caps', () => {
  const env = createEnv(task(2));
  let obs = env.reset();
  const call = (name, args) => env.step({ call: name, args }).observation.response;
  assert.equal(call('ha.get_state', { entity_id: SPEC.ids.group }).body.state, 'open', 'the door-open event is the first one; the group reads open');
  assert.equal(call('ha.get_state', { entity_id: 'sensor.nope' }).status, 404);
  assert.equal(call('nope.nope', {}).status, 400);
  assert.equal(call('sched.set', { id: '', afterSeconds: 5 }).status, 400);
  assert.equal(call('sched.set', { id: 'a', afterSeconds: -1 }).status, 400);
  assert.equal(call('sched.set', { id: 'a', afterSeconds: 'x' }).status, 400);
  assert.equal(call('sched.set', { id: 'a', afterSeconds: 1e9 }).status, 400);
  assert.equal(call('sched.set', { id: 'a', afterSeconds: 5 }).status, 200);
  assert.equal(call('sched.set', { id: 'a', afterSeconds: 7 }).status, 200, 'same id replaces');
  assert.equal(call('sched.cancel', { id: 'a' }).body.cancelled, true);
  assert.equal(call('sched.cancel', { id: 'a' }).body.cancelled, false);
  assert.equal(call('kv.get', { key: 'k' }).status, 404);
  assert.equal(call('kv.put', { key: 'k', value: { n: 1 } }).body.version, 1);
  assert.equal(call('kv.put', { key: 'k', value: { n: 2 }, ifVersion: 1 }).body.version, 2);
  assert.equal(call('kv.put', { key: 'k', value: { n: 3 }, ifVersion: 1 }).status, 409);
  assert.deepEqual(call('kv.get', { key: 'k' }).body, { value: { n: 2 }, version: 2 });
  // a wake-up arrives as a wake event after the world's own items; replaced / cancelled ones do not
  call('sched.set', { id: 'mine', afterSeconds: 3 });
  obs = env.step({ call: 'done' }).observation;
  const types = [];
  for (let i = 0; i < 6 && !obs.done; i++) { types.push(obs.event.type === 'wake' ? `wake:${obs.event.id}` : obs.event.type); obs = env.step({ call: 'done' }).observation; }
  assert.ok(types.includes('wake:mine'), JSON.stringify(types));
  assert.ok(!types.includes('wake:a'));
  // the 41st call within one event is refused
  const env2 = createEnv(task(2)); env2.reset();
  let last; for (let i = 0; i < LIMITS.callsPerRun + 1; i++) last = env2.step({ call: 'ha.get_state', args: { entity_id: SPEC.ids.group } });
  assert.equal(last.observation.response.status, 429);
  // calls with no event being handled are refused
  const env3 = createEnv(task(2)); env3.reset(); while (!env3.observe().done) env3.step({ call: 'done' });
  assert.equal(env3.step({ call: 'ha.get_state', args: {} }).info.ignored, true);
});

test('env: snapshot/restore round trip, replay equals the live run, a runaway poller is capped', () => {
  const t = task(5, 'T3', 3);
  const live = driveSync(t, makeImproved());
  const a = createEnv(t); a.reset();
  const half = Math.floor(live.actions.length / 2);
  for (const act of live.actions.slice(0, half)) a.step(act);
  const snap = a.snapshot();
  const b = createEnv(t); b.restore(snap);
  for (const act of live.actions.slice(half)) { a.step(act); b.step(act); }
  while (!a.observe().done) a.step({ call: 'done' });
  while (!b.observe().done) b.step({ call: 'done' });
  assert.deepEqual(b._records(), a._records());
  assert.deepEqual(b.record(), a.record());
  assert.deepEqual(replay(t, live.actions).env._records(), a._records());
  // a handler that re-arms a 10 ms wake-up forever is cut off by the run budget, and the scenario fails whatever it did
  const poller = () => (event, api) => { api.sched.set({ id: 'tick', afterSeconds: 0.01 }); };
  const scs = scenarioList(task(0, 'T2', 1)).slice(0, 2), pt = task(0, 'T2', 1);
  const pep = driveSync(pt, poller, scs);
  const recs = replay(pt, pep.actions, scs).env._records();
  assert.ok(recs.every(r => r.stats.capped && r.stats.runs === LIMITS.runsPerScenario));
  assert.ok(scs.every((sc, i) => judgeScenario(sc, recs[i]).pass === false));
  // and the whole-episode record of a poller is rejected by the schema's size cap before anything is replayed
  const big = oracle(pt, driveSync(pt, poller));
  assert.equal(big.pass, false);
});

// ---------------------------------------------------------------------------------------------------------------- oracle rules
const call = (service, data, target) => ({ service, data, target: target ?? {}, entity_ids: [].concat(target?.entity_id ?? data?.entity_id ?? []) });

test('trace normal form: what counts and what is ignored', () => {
  const push = { title: 'Garbage Day Reminder', value1: ` ${TEXT.reminder('wed')}  `, who: 'carlo', group: 'Garbage_Reminders', tag: 'garbage_day_reminder', level: 'active', title1: 'Snooze 30m', action1: 'A', icon1: 'x', title2: 'Snooze 2h', action2: 'B', icon2: 'y' };
  const base = normalizeCall(call('script.notify_engine_two_button', push));
  assert.deepEqual(base, E.push(0, 'wed').norm);
  // icons, id values and a missing level (default active) do not matter; message split over value1/value2 does not matter
  const { level, icon1, icon2, ...rest } = push;
  assert.deepEqual(normalizeCall(call('script.notify_engine_two_button', { ...rest, action1: 'ZZZ', value1: 'Reminder: it\'s garbage day.', value2: TEXT.reminder('wed').slice('Reminder: it\'s garbage day. '.length) })), base);
  // but these do matter
  for (const bad of [{ who: 'family' }, { group: 'information' }, { tag: 'other' }, { title: 'Reminder' }, { title1: 'Snooze 1h' }, { action2: '' }, { value1: TEXT.reminder('sun') }, { level: 'passive' }]) {
    assert.notDeepEqual(normalizeCall(call('script.notify_engine_two_button', { ...push, ...bad })), base, JSON.stringify(bad));
  }
  const timer = E.timerStart(0, '30m').norm;
  for (const d of ['0:30:00', '00:30:00', 1800, '1800', { minutes: 30 }, undefined]) assert.deepEqual(normalizeCall(call('timer.start', { duration: d }, { entity_id: SPEC.ids.timer })), timer, String(d));
  assert.notDeepEqual(normalizeCall(call('timer.start', { duration: 1799 }, { entity_id: SPEC.ids.timer })), timer);
  assert.notDeepEqual(normalizeCall(call('timer.start', { duration: '02:00:00' }, { entity_id: SPEC.ids.timer })), timer);
  assert.deepEqual(normalizeCall(call('timer.start', { duration: 1800, entity_id: SPEC.ids.timer })), timer, 'entity in data is the same as in target');
  assert.deepEqual(normalizeCall(call('script.speech_engine', { value1: 'x', media_player: ['media_player.livingroomcc'] })), normalizeCall(call('script.speech_engine', { value1: 'x' })));
  assert.notDeepEqual(normalizeCall(call('script.speech_engine', { value1: 'x', media_player: 'media_player.bedroom' })), normalizeCall(call('script.speech_engine', { value1: 'x' })));
  assert.deepEqual(normalizeCall(call('notify.alexa_media_garage', { message: ' a   b ', data: { type: 'announce' } })), { service: 'notify.alexa_media_garage', text: 'a b', type: 'announce' });
});

test('matchTraces: +-1 s window, any order within a window, no missing, no extra, duplicates counted', () => {
  const A = t => ({ t, norm: { service: 'a' } }), B = t => ({ t, norm: { service: 'b' } });
  assert.equal(matchTraces([A(10), B(10)], [B(10), A(10)]).ok, true);
  assert.equal(matchTraces([A(10), B(10)], [B(10.9), A(9.1)]).ok, true);
  assert.equal(matchTraces([A(10)], [A(11)]).ok, true, 'exactly 1 s is inside');
  assert.equal(matchTraces([A(10)], [A(11.01)]).ok, false);
  assert.equal(matchTraces([A(10)], [A(8.99)]).ok, false);
  const late = matchTraces([A(10)], [A(12)]);
  assert.deepEqual([late.missing.length, late.extra.length, late.timing[0].got], [1, 1, 12], 'a late call is reported as a timing error');
  assert.equal(matchTraces([A(10)], [A(10), A(10)]).ok, false, 'a duplicate is an extra');
  assert.equal(matchTraces([A(10), A(10)], [A(10)]).ok, false);
  assert.equal(matchTraces([A(30), A(90), A(180)], [A(90.5), A(180.5), A(30.5)]).ok, true);
  assert.equal(matchTraces([A(30), A(90)], [A(31.5), A(91.5)]).ok, false);
  assert.equal(matchTraces([], []).ok, true);
  assert.equal(matchTraces([], [A(1)]).ok, false);
  assert.equal(matchTraces([A(1)], []).ok, false);
  assert.equal(matchTraces([A(0), A(1.5)], [A(0.9)]).ok, false, 'one call cannot serve two expectations');
  assert.equal(matchTraces([A(0.5), A(1.5)], [A(1.4), A(2.4)]).ok, true, 'greedy matching in time order finds the pairing');
});

test('oracle judges effects, not construction or the order of same-instant calls', async () => {
  for (const variant of ['T2', 'T3']) for (const d of [1, 3, 5]) for (const seed of [0, 1, 2, 3, 4, 5]) {
    const t = task(seed, variant, d);
    const r = oracle(t, await drive(t, makeAlternative()));
    assert.equal(r.pass, true, `alternative ${variant} d${d} s${seed}: ${JSON.stringify(r.details.failed)} ${JSON.stringify(r.details.cost)}`);
  }
  // same decisions, every same-instant batch of service calls issued in reverse order
  const reversed = inner => () => { const h = inner(); return (event, api) => { const buf = []; const api2 = { ...api, ha: { ...api.ha, call_service: a => { buf.push(a); return { status: 200, body: {} }; } } }; h(event, api2); for (const a of buf.reverse()) api.ha.call_service(a); }; };
  for (const seed of SEEDS.slice(0, 5)) { const t = task(seed); assert.equal(oracle(t, driveSync(t, reversed(makeFaithful()))).pass, true); }
});

test('oracle timing tolerance end to end: +0.9 s passes, +1.1 s fails', () => {
  const t = task(3);
  assert.equal(oracle(t, driveSync(t, makeFaithful({ debounce: 20.9, offsets: [30, 90, 180] }))).pass, true, 'everything 0.9 s late');
  assert.equal(oracle(t, driveSync(t, makeFaithful({ debounce: 21.1 }))).pass, false, 'everything 1.1 s late');
  assert.equal(oracle(t, driveSync(t, makeFaithful({ offsets: [30.9, 90.9, 180.9] }))).pass, true);
  assert.equal(oracle(t, driveSync(t, makeFaithful({ offsets: [31.2, 91.2, 181.2] }))).pass, false);
  assert.equal(oracle(t, driveSync(t, makeFaithful({ offsets: [29.1, 89.1, 179.1] }))).pass, true);
  assert.equal(oracle(t, driveSync(t, makeFaithful({ offsets: [28.8, 88.8, 178.8] }))).pass, false);
  const r = oracle(t, driveSync(t, makeFaithful({ offsets: [31.5, 91.5, 181.5] })));
  assert.ok(r.details.scenarios.find(s => s.id === 'wed-full').timingErrors.length >= 3, 'the report names the timing errors');
});

test('schema-invalid or hostile output is rejected, never crashes the oracle', () => {
  const t = task(0);
  const bad = [null, undefined, 5, 'x', [], {}, { actions: 'no' }, { actions: [null] }, { actions: [{}] }, { actions: [{ call: 5 }] }, { actions: [{ call: 'done', extra: 1 }] },
    { actions: [{ call: 'ha.get_state', args: [] }] }, { actions: [{ call: 'x'.repeat(65) }] }, { actions: [], extra: 1 }, { actions: [], meta: 3 }];
  for (const o of bad) { const r = oracle(t, o); assert.equal(r.pass, false, JSON.stringify(o)); assert.equal(r.score, 0); assert.ok(r.details.schemaErrors.length > 0); }
  assert.ok(checkOutput({ actions: [{ call: 'done' }], meta: { note: 1 } }).length === 0);
  // well-formed nonsense: unknown calls, wrong args, calls with no event pending, giant args
  const junk = { actions: [{ call: 'nope' }, { call: 'ha.call_service', args: { service: 5 } }, { call: 'sched.set', args: { id: 1 } }, { call: 'kv.put', args: { key: 'a'.repeat(1e5), value: 1 } }, { call: 'done' }, { call: 'done' }] };
  const r = oracle(t, junk);
  assert.equal(r.pass, false);
  assert.ok(Number.isFinite(r.score));
  // meta is ignored, whatever it claims
  const good = driveSync(t, makeFaithful());
  assert.equal(oracle(t, { ...good, meta: { claim: 'I passed' } }).pass, true);
  // a truncated episode (the solver stopped answering) and a doubled one both fail
  assert.equal(oracle(t, { actions: good.actions.slice(0, Math.floor(good.actions.length / 2)) }).pass, false);
  assert.equal(oracle(t, { actions: [...good.actions, ...good.actions] }).pass, true, 'actions beyond the end of the episode are ignored');
});

// ---------------------------------------------------------------------------------------------------------------- oracle health (CONTRACT)
test('referenceSolve passes the oracle for >= 20 seeds at every difficulty used, T1 T2 T3, both splits', () => {
  for (const variant of bed.VARIANTS) for (const d of [1, 3, 5]) for (const seed of SEEDS) {
    const t = gen(seed, d, variant, seed % 2 ? 'dev' : 'test');
    const r = oracle(t, bed.referenceSolve(t));
    assert.equal(r.pass, true, `${variant} d${d} s${seed}: ${JSON.stringify(r.details.failed)}`);
    assert.equal(r.score, 1);
  }
});

test('every bad control fails on >= 20 seeds, on the scenarios it is meant to fail', () => {
  assert.ok(bed.badControls.length >= 20);
  for (const c of bed.badControls) {
    for (const seed of SEEDS) {
      const t = gen(seed, 3, 'T2');
      const r = oracle(t, c.make(t));
      assert.equal(r.pass, false, `${c.name} s${seed} must fail`);
      assert.ok(r.score < 1);
      for (const id of c.expectFail) assert.ok(r.details.failed.includes(id), `${c.name} s${seed} should fail ${id}; failed: ${r.details.failed}`);
    }
  }
});

test('bad controls also fail under T1 and T3 (and score strictly less than the reference)', () => {
  for (const c of bed.badControls) for (const variant of ['T1', 'T3']) for (const seed of [0, 1, 2, 3]) {
    const t = gen(seed, variant === 'T1' ? 5 : 1, variant);
    assert.equal(oracle(t, c.make(t)).pass, false, `${c.name} ${variant} s${seed}`);
  }
});

test('the do-nothing and empty solutions fail; they pass only the "nothing should happen" scenarios', () => {
  for (const seed of SEEDS) {
    const t = gen(seed);
    const dn = oracle(t, bed.badControls.find(c => c.name === 'do-nothing').make(t));
    assert.equal(dn.pass, false);
    assert.deepEqual(scenarioList(t).filter(sc => sc.expect.length === 0).map(sc => sc.id).sort(), ['mon-open', 'wed-flap']);
    assert.deepEqual(dn.details.failed.sort(), CORE_IDS.filter(id => !['mon-open', 'wed-flap'].includes(id)).sort());
    const em = oracle(t, { actions: [] });
    assert.equal(em.pass, false);
    assert.equal(em.details.failed.length, CORE_IDS.length - 2);
  }
});

test('no hidden-truth leak: expected traces, scenario names and start times are not in the task', () => {
  for (const variant of bed.VARIANTS) for (const seed of [0, 1, 2, 3, 4]) {
    const t = gen(seed, 3, variant, 'test');
    const text = `${t.prompt}\n${JSON.stringify(t.inputs)}\n${JSON.stringify(t.files)}\n${JSON.stringify(t.attachments ?? [])}\n${JSON.stringify(t.budget)}`;
    const { core, probes } = scenariosFor({ seed, split: 'test', difficulty: 3 });
    for (const sc of [...core, ...probes]) {
      assert.ok(!text.includes(sc.id), `scenario id ${sc.id} appears in the ${variant} task`);
      assert.ok(!text.includes(sc.start), `scenario start ${sc.start} appears in the ${variant} task`);
      if (sc.expect.length) assert.ok(!text.includes(canonical(sc.expect.map(e => e.norm))), 'an expected trace appears in the task');
      for (const f of sc.faults) assert.ok(!text.includes(`"from":${f.from}`));
    }
    for (const word of ['matchTraces', 'expectFail', 'oracle.mjs', 'timing-margin', 'badControls']) assert.ok(!text.includes(word), word);
  }
});

test('examples are from a different data set than the battery and agree with the original definition', () => {
  const ex = buildExamples();
  const starts = new Set(exampleScenarios().map(s => s.start));
  for (const seed of SEEDS) for (const split of ['dev', 'test']) for (const sc of scenariosFor({ seed, split, difficulty: 3 }).core) assert.ok(!starts.has(sc.start));
  assert.equal(ex.scenarios.length, 4);
  assert.ok(ex.scenarios.every(s => s.events.every(e => e.type !== 'wake')), 'the solver\'s own wake-ups are not in the examples');
  // the ORIGINAL definition produces the same calls on the examples
  const exs = exampleScenarios();
  const run = make => { const t = task('examples', 'T2', 1); const ep = driveSync(t, make(), exs); return replay(t, ep.actions, exs).env._records().map(r => r.calls.map(c => ({ t: c.t, ...normalizeCall(c) }))); };
  assert.deepEqual(run(makeOriginal), run(makeFaithful));
  assert.equal(ex.scenarios[0].calls.length, 0, 'Thursday: nothing');
  assert.equal(ex.scenarios[1].calls.length, 5, 'Sunday: push, speech, three announcements');
  assert.ok(ex.scenarios[2].calls.some(c => c.service === 'timer.start' && c.data.duration === '02:00:00'));
});

test('runtime limits: generate and oracle each under 2 s at difficulty 5', () => {
  for (const variant of bed.VARIANTS) {
    let t0 = performance.now(); const t = gen(11, 5, variant); const g = performance.now() - t0;
    const out = bed.referenceSolve(t);
    t0 = performance.now(); const r = oracle(t, out); const o = performance.now() - t0;
    assert.ok(r.pass); assert.ok(g < 2000, `generate ${g} ms`); assert.ok(o < 2000, `oracle ${o} ms`);
  }
});

test('timing margins: no person or phone event is closer than 2 s to a nominal check instant of the job', () => {
  let min = Infinity;
  for (const split of ['dev', 'test']) for (const d of [1, 3, 5]) for (const seed of SEEDS) {
    const t = task(seed, 'T3', d, split);
    const ep = driveSync(t, makeFaithful());
    const env = replay(t, ep.actions).env;
    const recs = env._records(), scs = env._scenarios();
    recs.forEach((rec, i) => {
      const people = scs[i].script.filter(s => ['cover', 'tap', 'timer_start'].includes(s.do)).map(s => s.t);
      for (const w of rec.wakes) for (const p of people) { const dist = Math.abs(w.t - p); if (dist < min) min = dist; }
    });
  }
  assert.ok(min >= 2, `closest door/phone event to a wake-up is ${min} s`);
});

// ---------------------------------------------------------------------------------------------------------------- T3
test('T3: the original passes the ordinary scenarios and fails the four reliability probes; the improved reference and an independent design pass all', async () => {
  for (const seed of SEEDS) {
    const t = gen(seed, 3, 'T3');
    const o = oracle(t, driveSync(t, makeOriginal()));
    assert.equal(o.pass, false);
    assert.deepEqual(o.details.failed.sort(), [...PROBE_IDS].sort(), 'only the probes fail');
    assert.equal(o.details.core, `${CORE_IDS.length}/${CORE_IDS.length}`);
    assert.equal(o.details.cost.ok, true);
    const i = oracle(t, bed.referenceSolve(t));
    assert.equal(i.pass, true);
    assert.ok(i.details.cost.selfInflictedWork <= o.details.cost.selfInflictedWork, 'the improved reference is not more expensive than the original');
  }
  const t = gen(2, 3, 'T3');
  assert.equal(oracle(t, await drive(t, makeAlternative())).pass, true);
});

test('T3 controls: abort-on-first-failure fails the probes only; polling is correct but over the cost cap', () => {
  for (const c of bed.t3Controls) for (const seed of SEEDS) {
    const t3 = gen(seed, 3, 'T3'), t2 = gen(seed, 3, 'T2');
    assert.equal(oracle(t2, c.make(t2)).pass, true, `${c.name} passes the ordinary battery`);
    const r = oracle(t3, c.make(t3));
    assert.equal(r.pass, false, c.name);
    if (c.expectCostFail) { assert.deepEqual(r.details.failed, []); assert.equal(r.details.cost.ok, false); assert.ok(r.details.cost.selfInflictedWork > 10 * T3_COST.cap); }
    else for (const id of c.expectFail) assert.ok(r.details.failed.includes(id), `${c.name} ${id}`);
  }
});

test('freeze: scenario batteries and the T3 cost cap match fixtures/frozen.json', () => {
  const frozen = JSON.parse(readFileSync(new URL('./fixtures/frozen.json', here), 'utf8'));
  assert.equal(frozen.version, VERSION);
  assert.deepEqual(hashes(), frozen.instances, 'scenarios changed after the freeze: re-run `node freeze.mjs` and bump VERSION deliberately');
  assert.equal(Object.keys(frozen.instances).length, FROZEN_INSTANCES.length);
  assert.equal(frozen.cost.cap, T3_COST.cap);
  assert.equal(frozen.cost.cap, Math.ceil(frozen.cost.baselineMax * frozen.cost.factor));
  assert.ok(T3_COST.frozen && Number.isFinite(T3_COST.cap));
});

// ---------------------------------------------------------------------------------------------------------------- the ORIGINAL definition
test('original definition: pinned bytes, MIT licence kept, corpus copy identical when present', () => {
  const text = originalText();                       // throws if the sha256 differs from the pin
  assert.equal(sha256(text), ORIGINAL.sha256);
  assert.match(readFileSync(new URL('./fixtures/original/LICENSE', here), 'utf8'), /^MIT License\s+Copyright \(c\) 2018 Carlo Costanzo/);
  if (existsSync(ORIGINAL.rawPath)) assert.equal(corpusMatches(), true, 'the committed fixture differs from /opt/corpus');
});

test('mini YAML reader equals PyYAML on the original and rejects what it does not implement', () => {
  assert.deepEqual(parseYaml(originalText()), JSON.parse(readFileSync(new URL('./fixtures/original/parsed.pyyaml.json', here), 'utf8')));
  assert.deepEqual(parseYaml('a: [1, "x y", {b: c}]\nd:\n  - e: 1\n    f: |\n      l1\n      l2\n  - g\n'), { a: [1, 'x y', { b: 'c' }], d: [{ e: 1, f: 'l1\nl2\n' }, 'g'] });
  assert.deepEqual(parseYaml('a: >-\n  one\n  two\n\n  three\nb: \'it\'\'s\'  # note\n'), { a: 'one two\nthree', b: "it's" });
  for (const bad of ['a: &x 1\n', 'a: !tag 1\n', '---\na: 1\n---\nb: 2\n', 'a: >+\n  x\n', 'a: 1\na: 2\n']) assert.throws(() => parseYaml(bad), YamlUnsupported, bad);
});

test('template evaluator: the original\'s message and snooze templates, native results, rejections', () => {
  const doc = loadOriginal();
  const vars = doc.action[4].variables;               // reminder_delays, reminder_message
  const now = wd => () => ({ strftime: f => (f === '%a' ? wd : '') });
  assert.deepEqual(render(vars.reminder_delays, {}), [30, 60, 90]);
  assert.equal(norm(render(vars.reminder_message, { now: now('Wed') })), TEXT.reminder('wed'), 'rendering the author\'s template on Wednesday gives the text the oracle expects');
  assert.equal(norm(render(vars.reminder_message, { now: now('Sun') })), TEXT.reminder('sun'));
  assert.notEqual(render(vars.reminder_message, { now: now('Wed') }), norm(render(vars.reminder_message, { now: now('Wed') })), 'the author\'s template leaves double spaces; the oracle collapses whitespace');
  const sn = doc.action[0].choose[0].sequence[0].variables;
  assert.equal(render(sn.snooze_duration, { trigger: { id: 'snooze_30m' } }), '00:30:00');
  assert.equal(render(sn.snooze_duration, { trigger: { id: 'snooze_2h' } }), '02:00:00');
  assert.equal(render(sn.snooze_label, { trigger: { id: 'snooze_2h' } }), '2 hours');
  assert.equal(render('{{ repeat.item }}', { repeat: { item: 30 } }), 30, 'a lone expression renders natively (a number stays a number)');
  assert.equal(render('a {{ 1 + 2 }} b', {}), 'a 3 b');
  assert.equal(render('{% if x == 1 %}one{% elif x == 2 %}two{% else %}many{% endif %}', { x: 2 }), 'two');
  assert.equal(render('{{ [1, 2] | length }} {{ "A" | lower }} {{ "x" ~ 1 }} {{ 3 in [1, 3] }} {{ not (1 == 2) }}', {}), '2 a x1 True True');
  for (const bad of ['{% for i in x %}{{ i }}{% endfor %}', '{{ x | nope }}', '{% set a = 1 %}', '{{ a +* b }}', '{% if x %}unterminated']) assert.throws(() => render(bad, { x: [1] }), TemplateUnsupported, bad);
});

test('original engine: runs every construct the YAML uses and refuses what it does not implement', () => {
  const coverage = new Set();
  const t = task(0, 'T2', 3);
  const ep = driveSync(t, makeOriginal(coverage));
  assert.equal(ep.meta.handlerErrorCount, 0, 'the interpreter met nothing it could not run');
  assert.equal(oracle(t, ep).pass, true);
  const want = ['trigger:state', 'trigger:event', 'action:choose', 'action:variables', 'action:service', 'action:stop', 'action:condition', 'action:parallel', 'action:repeat', 'action:delay', 'condition:trigger', 'condition:time', 'condition:state'];
  for (const k of want) assert.ok(coverage.has(k), `construct not exercised: ${k}`);
  const doc = loadOriginal();
  // an unsupported construct is reported as a handler error (the env records it and the run goes on), never silently flattened
  const refuse = (mutate, re) => { const d = structuredClone(doc); mutate(d); const ep = driveSync(task(0, 'T2', 1), createAutomationHandler(d)); assert.ok(ep.meta.handlerErrorCount > 0, 'no error recorded'); assert.match(ep.meta.handlerErrors.join('|'), re); };
  assert.throws(() => createAutomationHandler({ ...doc, mode: 'queued' }), UnsupportedSemantics);
  assert.throws(() => createAutomationHandler({ ...doc, trigger: [{ platform: 'time', at: '07:00' }] }), UnsupportedSemantics);
  refuse(d => { d.action[1] = { condition: 'sun', after: 'sunset' }; }, /condition sun/);
  refuse(d => { d.action[2] = { wait_for_trigger: [] }; }, /action/);
  refuse(d => { d.action[6].repeat = { while: 'true', sequence: [] }; }, /repeat other than for_each/);
  refuse(d => { d.action[5].mystery = 1; }, /action key mystery/);
});

test('original engine semantics: restart ordering, failed condition bubbles out of repeat, failed service call ends the run, single mode', () => {
  const doc = loadOriginal();
  const scenarios = scenariosFor({ seed: 0, split: 'dev', difficulty: 1 });
  const byId = id => [...scenarios.core, ...scenarios.probes].find(s => s.id === id);
  const runOn = (handlerFactory, ids) => { const scs = ids.map(byId); const t = task(0, 'T3', 1); const ep = driveSync(t, handlerFactory, scs); return replay(t, ep.actions, scs).env._records(); };
  // a failed condition inside the repeat ends the whole run (wed-stop-then-reopen: no announcement at the third check)
  const stop = runOn(createAutomationHandler(doc), ['wed-stop-then-reopen'])[0];
  assert.equal(matchTraces(byId('wed-stop-then-reopen').expect, stop.calls.map(c => ({ t: c.t, norm: normalizeCall(c) }))).ok, true);
  // mode: restart kills the older run, mode: single keeps it
  const restart = runOn(createAutomationHandler(doc), ['wed-reopen-restarts-run'])[0];
  const single = runOn(createAutomationHandler({ ...doc, mode: 'single' }), ['wed-reopen-restarts-run'])[0];
  assert.equal(restart.calls.filter(c => c.service === 'notify.alexa_media_garage').length, 3);
  assert.notEqual(single.calls.length, restart.calls.length);
  // a failing service call ends the run with an error; with continue_on_error it does not
  const outage = runOn(createAutomationHandler(doc), ['p2-first-announcement-outage'])[0];
  assert.equal(outage.calls.filter(c => c.service === 'notify.alexa_media_garage').length, 1, 'one failed attempt, then the run is over');
  const tolerant = structuredClone(doc);
  const loop = tolerant.action.find(a => a.repeat); loop.repeat.sequence.at(-1).continue_on_error = true;
  const kept = runOn(createAutomationHandler(tolerant), ['p2-first-announcement-outage'])[0];
  assert.equal(kept.calls.filter(c => c.service === 'notify.alexa_media_garage' && c.status === 200).length, 2);
});

test('sensitivity: exactly one scenario rests on "a false condition inside repeat ends the whole run" (the least verified assumption)', () => {
  const failed = new Set();
  for (const seed of SEEDS) { const t = gen(seed, 3, 'T2'); for (const id of oracle(t, driveSync(t, makeOriginalIterationLocal())).details.failed) failed.add(id); }
  assert.deepEqual([...failed], ['wed-stop-then-reopen']);
});

test('original passes on >= 20 seeds at three difficulties; each mutant of it is rejected on the scenarios that expose it', () => {
  for (const d of [1, 3, 5]) for (const seed of SEEDS) {
    const t = gen(seed, d, 'T2', seed % 2 ? 'dev' : 'test');
    const r = oracle(t, driveSync(t, makeOriginal()));
    assert.equal(r.pass, true, `original d${d} s${seed}: ${r.details.failed}`);
  }
  for (const m of MUTANTS) for (const seed of SEEDS) {
    const t = gen(seed, 3, 'T2');
    const r = oracle(t, driveSync(t, makeMutant(m)));
    assert.equal(r.pass, false, `${m.name} s${seed} must fail`);
    for (const id of m.expectFail) assert.ok(r.details.failed.includes(id), `${m.name} s${seed} should fail ${id}; failed ${r.details.failed}`);
  }
});

test('controls/report.json is current', () => {
  const file = new URL('./controls/report.json', here);
  assert.ok(existsSync(file), 'run: node controls/run-controls.mjs');
  const rep = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(rep.version, VERSION);
  assert.equal(rep.t3CostCap.cap, T3_COST.cap);
  assert.equal(rep.original.T2_core.pass, rep.original.T2_core.runs);
  assert.equal(rep.original.T3_with_probes.pass, 0);
  assert.deepEqual(Object.keys(rep.original.T3_with_probes.failedScenarios).sort(), [...PROBE_IDS].sort());
  assert.equal(rep.brokenControls.length, BROKEN.length);
  assert.equal(rep.mutantsOfOriginal.length, MUTANTS.length);
  assert.equal(rep.t3Controls.length, T3_ONLY.length);
  for (const c of [...rep.brokenControls, ...rep.mutantsOfOriginal]) { assert.equal(c.rejectedEverywhere, true, c.name); assert.equal(c.expectedFailuresSeenEverywhere, true, c.name); }
  for (const c of rep.t3Controls) assert.equal(c.passesCoreRejectedOnT3, true, c.name);
  assert.ok(rep.timing.maxOracleMs < 2000 && rep.timing.maxGenerateMs < 2000);
});
