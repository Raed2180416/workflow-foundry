// $0 tests for the GQA-1 arms: the check language, ddmin, and the agent / workflow / monkey arms end to end on the real
// build with a scripted model (no paid call). Also asserts that no prompt carries the hidden truth.
//   nice -n 15 node --test --test-concurrency=1 experiments/gameqa-web/gameqa-web-arms.test.mjs
import { test, before, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadPolicy } from '../../src/models/policy.mjs';
import { ModelPort, checkPortableSchema } from '../../src/models/port.mjs';
import { Journal } from '../../src/journal.mjs';
import { ScriptedProvider } from '../../src/models/providers/scripted.mjs';
import { subsetPolicy } from '../lib/models.mjs';
import { launchBrowser, openSession } from '../../beds/gameqa-web/driver.mjs';
import { loadTruth, scoreReports } from '../../beds/gameqa-web/oracle.mjs';
import { parse, compile, evaluate, ExprError } from './expr.mjs';
import { ddmin, compileChecks } from './qa-lib.mjs';
import { mannWhitney } from './analyze.mjs';
import { runAgent, runAgentMatched, runWorkflow, runMonkey, makeCaller, mulberry32 } from './arms.mjs';
import * as P from './prompts.mjs';

const HAIKU = 'claude-haiku-5-5', truth = loadTruth();
let browser = null, why = null;
// Playwright's temp folders go to a short-lived folder of this test file, removed in after() (GQA-1 review finding m8;
// a short path: Chromium fails to launch when TMPDIR is long)
let tmpRoot = null, prevTmp;
before(async () => {
  prevTmp = process.env.TMPDIR; tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'gqa-test-')); process.env.TMPDIR = tmpRoot;
  try { browser = await launchBrowser(); } catch (e) { why = `chromium unavailable: ${e.message.split('\n')[0]}`; }
});
after(async () => {
  await browser?.close();
  if (prevTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = prevTmp;
  rmSync(tmpRoot, { recursive: true, force: true });
});
const bt = (name, fn) => test(name, async ctx => { if (why) return ctx.skip(why); await fn(); });
const portWith = script => {
  const provider = new ScriptedProvider(script);
  return { port: new ModelPort({ policy: subsetPolicy(loadPolicy().policy, [HAIKU]), journal: new Journal(new DatabaseSync(':memory:')), providers: { 'claude-cli': provider } }), provider };
};
function assertNoTruth(calls) {
  for (const c of calls) {
    const text = `${c.system}\n${c.prompt}`;
    for (const b of truth.bugs) {
      assert.ok(!text.includes(b.flag), `prompt leaks flag ${b.flag}`); assert.ok(!new RegExp(`\\b${b.id}\\b`).test(text), `prompt leaks ${b.id}`);
      assert.ok(!text.includes(b.title), `prompt leaks the title of ${b.id}`);
    }
  }
}

test('output schemas are in the portable subset', () => {
  for (const s of [P.AGENT_SCHEMA, P.CONSTRUCT_SCHEMA, P.REPAIR_SCHEMA, P.EXPLORE_SCHEMA, P.JUDGE_SCHEMA]) checkPortableSchema(s);
});

test('check language: evaluation, lambdas, deep equality, and what it refuses', () => {
  const obs = { state: { player: { x: 2, y: 1 }, score: 120, events: ['move', 'coin'], enemies: [{ id: 'e1', x: 2, y: 1 }], tiles: ['###', '#.#'] }, hud: { score: 'Score 120' } };
  const env = { cur: obs, prev: { state: { player: { x: 1, y: 1 }, score: 20, events: [], enemies: [], tiles: ['###', '#.#'] } } };
  const ev = s => compile(s)(env);
  assert.equal(ev("num(cur.hud.score) == cur.state.score"), true);
  assert.equal(ev("cur.hud.score == 'Score ' + cur.state.score"), true);
  assert.equal(ev('abs(cur.state.player.x - prev.state.player.x) + abs(cur.state.player.y - prev.state.player.y) <= 1'), true);
  assert.equal(ev('any(cur.state.enemies, e => e.x == cur.state.player.x && e.y == cur.state.player.y)'), true);
  assert.equal(ev('count(cur.state.events, e => e == "coin")'), 1);
  assert.equal(ev('cur.state.player == {x:2}'.replace('{x:2}', 'prev.state.player')), false);
  assert.equal(ev("includes(cur.state.events, 'coin') ? cur.state.score - prev.state.score == 100 : true"), true);
  assert.equal(ev("tile(cur, 1, 1) == '.' && tile(cur, 9, 9) == '#'"), true);
  assert.equal(ev('cur.state.missing.deeper == undefined'), true);
  assert.equal(ev('len(cur.state.tiles) == 2 && cur.state.tiles.length == 2'), true);
  assert.throws(() => parse('cur.constructor'), ExprError);
  assert.throws(() => parse('eval("1")'), /unknown function/);
  assert.throws(() => parse('x = 1'), ExprError);
  assert.throws(() => parse('abs(x => 1)'), /no lambda/);
  assert.throws(() => compile('nope.x')({}), /unknown name/);
  assert.throws(() => evaluate(parse('all(cur.l, a => all(cur.l, b => all(cur.l, c => true)))'), { cur: { l: Array(100).fill(0) } }, { steps: 1000 }), /budget/);
});

test('analysis: exact permutation Mann-Whitney', () => {
  let t = mannWhitney([3, 4, 5], [0, 1, 2], 'greater'); assert.equal(t.U, 9); assert.equal(t.permutations, 20); assert.equal(t.p, 1 / 20);
  t = mannWhitney([0, 1, 2], [3, 4, 5], 'greater'); assert.equal(t.p, 1);
  t = mannWhitney([5, 6, 7, 8, 9], [0, 1, 2, 3, 4], 'two-sided'); assert.equal(t.permutations, 252); assert.equal(t.p, 2 / 252);
  t = mannWhitney([2, 2, 2], [2, 2, 2], 'greater'); assert.equal(t.U, 4.5); assert.equal(t.p, 1, 'ties: no evidence');
  t = mannWhitney([3, 3], [3, 2, 2], 'greater'); assert.equal(t.U, 5);
  assert.equal(mannWhitney([], [1], 'greater').p, null);
});

test('ddmin returns a 1-minimal subsequence', async () => {
  const test1 = async t => t.includes('a') && t.includes('b') && t.indexOf('a') < t.indexOf('b');
  const r = await ddmin(['x', 'a', 'y', 'z', 'w', 'b', 'q', 'a'], test1);
  assert.deepEqual(r.tokens, ['a', 'b']); assert.equal(r.oneMinimal, true);
  const r2 = await ddmin(['p', 'q', 'r'], async t => t.length >= 2 && t.includes('r'));
  assert.equal(r2.tokens.length, 2); assert.ok(r2.tokens.includes('r'));
});

bt('workflow arm end to end with a scripted model: construct, repair, explore, ddmin, judge, report', async () => {
  const checks = [
    { id: 'hud-coins', rule: 'The HUD shows the current coins.', bug_class: 'state_desync', expect: "cur.hud.coins == 'Coins ' + cur.state.coins + '/' + cur.state.coinsTotal" },
    { id: 'one-move', rule: 'At most one move per tick.', bug_class: 'input_race', when: "cur.state.mode == 'playing' && !includes(cur.state.events, 'respawn') && !includes(cur.state.events, 'restart')",
      expect: "abs(cur.state.player.x - prev.state.player.x) + abs(cur.state.player.y - prev.state.player.y) <= (includes(cur.state.events, 'dash') ? 2 : 1)" },
    { id: 'time-wait', rule: '(a wrong check) the timer does not change on a wait.', bug_class: 'state_desync', expect: "cur.token != 'wait' || cur.state.timeLeft == prev.state.timeLeft" },
    { id: 'broken', rule: 'Lives are never negative.', bug_class: 'state_desync', expect: 'cur.state.((' },
  ];
  const script = args => {
    if (args.system === P.CONSTRUCT_SYSTEM && args.prompt.startsWith('Some of your checks')) return { value: { checks: [{ id: 'broken', rule: 'Lives are never negative.', bug_class: 'state_desync', expect: 'cur.state.lives >= 0' }] } };
    if (args.system === P.CONSTRUCT_SYSTEM) return { value: { personas: [{ name: 'Racer', goal: 'go fast', style: 'dashes' }, { name: 'Masher', goal: 'press keys', style: 'combos' }, { name: 'Reader', goal: 'read', style: 'literal' }], checks } };
    if (args.system === P.JUDGE_SYSTEM) {
      const blocks = args.prompt.split('--- candidate ').slice(1).map(b => [Number(b.split(' ')[0]), [...b.matchAll(/^Check: ([^:]+):/gm)].map(m => m[1])]);
      return { value: { verdicts: blocks.map(([n, ids]) => ({ candidate: n, is_bug: ids.some(id => id !== 'time-wait'), bug_class: ids.includes('one-move') ? 'input_race' : 'state_desync', title: `t-${ids}`, observed: 'o', expected: 'e' })) } };
    }
    return { value: { notes: 'n', plans: [{ seed: 1, steps: ['dash-down', 'wait', 'up+up', 'goto:4,1'], purpose: 'p' }] } };
  };
  const { port, provider } = portWith(script);
  const session = await openSession(browser, { flags: truth.build.flags });
  const calls = [];
  const caller = makeCaller({ port, runId: 't-wf', modelId: HAIKU, usdCap: 1, log: e => calls.push(e) });
  const r = await runWorkflow({ session, caller, rng: mulberry32(1), budgets: { rounds: 2, exploreTicks: 400 } });
  await session.close();
  assert.equal(r.stats.repairedChecks, 1);
  assert.ok(r.minimized.every(m => !m.confirmed || m.oneMinimal), 'every confirmed candidate is 1-minimal');
  const byCheck = Object.fromEntries(r.minimized.map(m => [m.checkId, m]));
  assert.deepEqual(byCheck['hud-coins'].steps, ['dash-down']);
  assert.deepEqual(byCheck['one-move'].steps, ['dash-down', 'up+up']);
  assert.deepEqual(byCheck['time-wait'].steps, ['wait']);
  assert.ok(r.verdicts.some(v => v.checkIds.includes('time-wait') && v.is_bug === false), 'the judge filtered the wrong check');
  assert.equal(r.reports.length, 2);
  const s = await scoreReports(browser, r.reports, { truth });
  assert.ok(s.perBug.GQ03.foundMinClass && s.perBug.GQ12.foundMinClass, JSON.stringify(s.summary));
  assert.equal(s.summary.falseReports, 0);
  assertNoTruth(provider.calls);
  assert.equal(provider.calls.length, 1 + 1 + 2 * 3 + 1, 'construct, repair, 2 rounds x 3 personas, one judge batch');
});

bt('agent arm with a scripted model: runs, reads traces, keeps notes, final reports', async () => {
  const turns = [
    { notes: 'start', action: 'run', seed: 1, steps: ['right+right'], reports: [] },
    { notes: 'saw two moves', action: 'run', seed: 1, steps: ['jump'], reports: [{ bug_class: 'input_race', title: 'two moves', observed: 'o', expected: 'e', seed: 1, steps: ['right+right'] }] },
    { notes: 'done', action: 'finish', seed: 1, steps: [], reports: [{ bug_class: 'input_race', title: 'two moves', observed: 'o', expected: 'e', seed: 1, steps: ['wait', 'right+right'] }] },
  ];
  const { port, provider } = portWith(turns.map(v => ({ value: v })));
  const session = await openSession(browser, { flags: truth.build.flags });
  const caller = makeCaller({ port, runId: 't-agent', modelId: HAIKU, usdCap: 1 });
  const r = await runAgent({ session, caller, budgets: { maxTurns: 5, exploreTicks: 100 } });
  await session.close();
  assert.equal(r.stats.runs, 1); assert.equal(r.stats.finished, true); assert.equal(r.reports.length, 1);
  assert.match(provider.calls[1].prompt, /#0 right\+right -> P\(3,1\)/, 'the second turn sees the trace of the first run');
  assert.match(provider.calls[2].prompt, /could not be run: invalid steps/);
  const s = await scoreReports(browser, r.reports, { truth });
  assert.equal(s.perReport[0].bug, 'GQ12'); assert.equal(s.perReport[0].minimal, false, 'the padded repro is not 1-minimal');
  assertNoTruth(provider.calls);
});

bt('agent-persist (amendment A1): an early finish is refused and the agent keeps going; the last turn may finish', async () => {
  const rep = { bug_class: 'input_race', title: 'two moves', observed: 'o', expected: 'e', seed: 1, steps: ['right+right'] };
  const turns = [
    { notes: 'start', action: 'run', seed: 1, steps: ['right+right'], reports: [rep] },
    { notes: 'one bug, done', action: 'finish', seed: 1, steps: [], reports: [rep] },
    { notes: 'told to go on', action: 'run', seed: 2, steps: ['down'], reports: [rep] },
    { notes: 'last turn', action: 'finish', seed: 1, steps: [], reports: [rep] },
  ];
  const { port, provider } = portWith(turns.map(v => ({ value: v })));
  const session = await openSession(browser, { flags: truth.build.flags });
  const caller = makeCaller({ port, runId: 't-agent-persist', modelId: HAIKU, usdCap: 1 });
  const r = await runAgent({ session, caller, budgets: { maxTurns: 4, exploreTicks: 100, persist: true } });
  await session.close();
  assert.equal(provider.calls.length, 4);
  assert.equal(r.stats.runs, 2); assert.equal(r.stats.refusedFinishes, 1); assert.equal(r.stats.finished, true);
  assert.match(provider.calls[2].prompt, /"finish" is not available before your last turn \(this was turn 2 of 4\)/);
  assert.equal(r.reports.length, 1);
  // without persist the same script stops at turn 2
  const p2 = portWith(turns.map(v => ({ value: v })));
  const s2 = await openSession(browser, { flags: truth.build.flags });
  const r2 = await runAgent({ session: s2, caller: makeCaller({ port: p2.port, runId: 't-agent-np', modelId: HAIKU, usdCap: 1 }), budgets: { maxTurns: 4, exploreTicks: 100 } });
  await s2.close();
  assert.equal(p2.provider.calls.length, 2); assert.equal(r2.stats.refusedFinishes, undefined);
  assertNoTruth(provider.calls);
});

bt('agent-matched (amendment A2): append-only filing, restarts with the filed list, and the dollar cap ends the run', async () => {
  const twoMoves = { bug_class: 'input_race', title: 'two moves', observed: 'o', expected: 'e', seed: 1, steps: ['right+right'] };
  const spikes = { bug_class: 'score_overflow', title: 'spike wrap', observed: 'o', expected: 'e', seed: 1, steps: ['goto:3,3'] };
  const turns = [
    // session 1: run, file a bug, then "rewrite" the list without it (the frozen protocol would have lost it), then finish
    { notes: 's1', action: 'run', seed: 1, steps: ['right+right'], reports: [twoMoves] },
    { notes: 's1 b', action: 'run', seed: 1, steps: ['goto:3,3'], reports: [] },
    { notes: 's1 done', action: 'finish', seed: 1, steps: [], reports: [spikes, spikes] },
    // session 2: fresh notes, sees the filed list; files a duplicate (ignored) and finishes
    { notes: 's2', action: 'finish', seed: 1, steps: [], reports: [twoMoves] },
    // session 3: one call, then the dollar cap is reached
    { notes: 's3', action: 'run', seed: 5, steps: ['down'], reports: [] },
    { notes: 'never served', action: 'finish', seed: 1, steps: [], reports: [] },
  ];
  const { port, provider } = portWith(turns.map(v => ({ value: v, costUsd: 0.01 })));
  const session = await openSession(browser, { flags: truth.build.flags });
  const caller = makeCaller({ port, runId: 't-agent-matched', modelId: HAIKU, usdCap: 0.05 });
  const r = await runAgentMatched({ session, caller, budgets: { maxTurns: 3, maxTotalTurns: 10, exploreTicks: 1000, usdPerRun: 0.05 } });
  await session.close();
  assert.equal(provider.calls.length, 5, 'the sixth call is refused by the run cap');
  assert.equal(r.stats.stop, 'usd');
  assert.deepEqual(r.stats.sessions.map(x => [x.session, x.turns, x.finished]), [[1, 3, true], [2, 1, true], [3, 1, false]]);
  assert.equal(r.reports.length, 2, 'filed reports are kept and deduplicated by seed + tokens');
  assert.deepEqual(r.stats.filedAt, [{ session: 1, turn: 1 }, { session: 1, turn: 3 }]);
  assert.equal(r.stats.runs, 3); assert.equal(r.stats.played.length, 3);
  assert.equal(provider.calls[0].system, P.AGENT_MATCHED_SYSTEM);
  assert.match(P.AGENT_MATCHED_SYSTEM, /goto:x,y is a convenient way to walk/); assert.doesNotMatch(P.AGENT_MATCHED_SYSTEM, /prefer short/);
  assert.match(provider.calls[3].prompt, /^Session 2, turn 1 of 3\./);
  assert.match(provider.calls[3].prompt, /This is a fresh session/);
  assert.match(provider.calls[3].prompt, /Your notes from the last turn:\n\(none yet\)/, 'no notes carried across sessions');
  assert.match(provider.calls[3].prompt, /Reports filed so far \(2\)/);
  assert.match(provider.calls[2].prompt, /This is the last turn of this session/);
  const s = await scoreReports(browser, r.reports, { truth });
  assert.deepEqual(Object.entries(s.perBug).filter(([, b]) => b.foundMin).map(([id]) => id).sort(), ['GQ10', 'GQ12']);
  assertNoTruth(provider.calls);
  // the tick budget also ends a run
  const p2 = portWith(Array(5).fill({ value: { notes: 'n', action: 'run', seed: 2, steps: Array(60).fill('wait'), reports: [] } }));
  const s2 = await openSession(browser, { flags: truth.build.flags });
  const r2 = await runAgentMatched({ session: s2, caller: makeCaller({ port: p2.port, runId: 't-am-ticks', modelId: HAIKU, usdCap: 1 }), budgets: { maxTurns: 40, maxTotalTurns: 10, exploreTicks: 100, usdPerRun: 1 } });
  await s2.close();
  assert.equal(r2.stats.stop, 'ticks'); assert.equal(p2.provider.calls.length, 2); assert.equal(r2.stats.exploreTicks, 120);
});

bt('monkey arm is deterministic for a given rng seed', async () => {
  const run = async () => { const s = await openSession(browser, { flags: truth.build.flags }); try { return await runMonkey({ session: s, rng: mulberry32(7), budgets: { exploreTicks: 1500 } }); } finally { await s.close(); } };
  const a = await run(), b = await run();
  assert.deepEqual(a.reports, b.reports); assert.equal(a.stats.exploreTicks, b.stats.exploreTicks);
});

bt('monkey with checks (the monkey-ref calibration path): reports carry the check class, repros are 1-minimal, played runs are recorded', async () => {
  const { checks } = compileChecks([
    { id: 'one-move', rule: 'At most one move per tick.', bug_class: 'input_race', when: "!includes(cur.state.events, 'respawn') && !includes(cur.state.events, 'restart')",
      expect: "abs(cur.state.player.x - prev.state.player.x) + abs(cur.state.player.y - prev.state.player.y) <= (includes(cur.state.events, 'dash') ? 2 : 1)" },
    { id: 'hud-coins', rule: 'The HUD shows the current coins.', bug_class: 'state_desync', expect: "cur.hud.coins == 'Coins ' + cur.state.coins + '/' + cur.state.coinsTotal" },
  ]);
  const s = await openSession(browser, { flags: truth.build.flags });
  const r = await runMonkey({ session: s, rng: mulberry32(3), budgets: { exploreTicks: 2000 }, checks });
  await s.close();
  assert.ok(r.stats.played.length >= 1 && r.stats.played.every(p => Number.isInteger(p.seed) && p.steps.length === 200));
  for (const m of r.minimized) if (m.confirmed) assert.equal(m.oneMinimal, true, m.checkId);
  for (const rep of r.reports.filter(x => x.title.startsWith('Violates'))) assert.ok(checks.some(c => c.bug_class === rep.bug_class && rep.title.includes(c.rule)));
  assert.ok(r.reports.some(x => x.bug_class === 'input_race') && r.reports.some(x => x.bug_class === 'state_desync'), JSON.stringify(r.reports.map(x => x.title)));
  const sc = await scoreReports(browser, r.reports, { truth });
  assert.equal(sc.summary.falseReports, 0, 'these two checks hold on the clean build, so every confirmed violation is an injected fault');
});
