// $0 tests for the GQA-1 analysis scripts that back the result's root-cause tables (review finding m6: funnel.mjs,
// regress.mjs and posthoc.mjs had no tests) and for the A2 analyses (rescore-union.mjs, cost-matched.mjs) and the leakage
// disclosure (analysis/leakage-map.json, finding M4). The browser tests build tiny synthetic run directories in a temp dir
// (removed afterwards) and check each script's verdicts against facts the bed tests already establish (the reference repros).
//   nice -n 15 node --test --test-concurrency=1 experiments/gameqa-web/gameqa-web-analysis.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, openSession } from '../../beds/gameqa-web/driver.mjs';
import { loadTruth, scoreReports } from '../../beds/gameqa-web/oracle.mjs';
import { emittedReports, rescoreRun } from './rescore-union.mjs';
import { expectedUnion, restartCurve } from './cost-matched.mjs';
import { funnelOf } from './funnel.mjs';
import { regressRun } from './regress.mjs';
import { creditedCandidates, exploreWithPerfectChecks } from './posthoc.mjs';

const truth = loadTruth();
const SPEC = readFileSync(new URL('../../beds/gameqa-web/spec/DESIGN.md', import.meta.url), 'utf8');
const LEAK = JSON.parse(readFileSync(new URL('../../research/gameqa-20261021/analysis/leakage-map.json', import.meta.url), 'utf8'));
let browser = null, why = null, tmp = null, prevTmp;
before(async () => {
  // Playwright's temp folders go to a folder of this test file, removed in after() (finding m8)
  prevTmp = process.env.TMPDIR; tmp = mkdtempSync(path.join(os.tmpdir(), 'gqa-analysis-test-')); process.env.TMPDIR = tmp;
  try { browser = await launchBrowser(); } catch (e) { why = `chromium unavailable: ${e.message.split('\n')[0]}`; }
});
after(async () => {
  await browser?.close();
  if (prevTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = prevTmp;
  rmSync(tmp, { recursive: true, force: true });
});
const bt = (name, fn) => test(name, async ctx => { if (why) return ctx.skip(why); await fn(); });
const rep = (bug_class, seed, steps, title = 't') => ({ bug_class, title, observed: 'o', expected: 'e', seed, steps });
const runDir = files => {
  const d = mkdtempSync(path.join(tmp, 'run-'));
  for (const [f, v] of Object.entries(files)) writeFileSync(path.join(d, f), typeof v === 'string' ? v : JSON.stringify(v));
  return d;
};

test('cost-matched: exact expected union over k-subsets, and the restart curve', () => {
  const sets = [['a'], ['a'], ['b'], ['c', 'd']];
  assert.deepEqual(expectedUnion(sets, 1), { mean: 5 / 4, subsets: 4 });
  // pairs: aa 1, ab 2, acd 3, ab 2, acd 3, bcd 3 -> 14 / 6
  assert.equal(expectedUnion(sets, 2).mean, 14 / 6);
  assert.equal(expectedUnion(sets, 4).mean, 4);
  assert.equal(expectedUnion(sets, 0).mean, null);
  const c = restartCurve(sets.map(b => ({ bugs: b, usd: 0.004 })));
  assert.deepEqual(c.map(x => x.k), [1, 2, 3, 4]);
  assert.equal(c[3].usd, 0.016); assert.equal(c[3].expectedBugs, 4);
  assert.ok(c.every((x, i) => i === 0 || x.expectedBugs >= c[i - 1].expectedBugs), 'the curve never falls');
});

test('rescore-union: every report ever listed, first and last listing, failed calls ignored', () => {
  const a = rep('input_race', 1, ['right+right']), b = rep('softlock', 1, ['pause', 'click:btn-restart']);
  const rows = [
    { nodeKey: 'turn-1', ok: true, value: { reports: [] } },
    { nodeKey: 'turn-2', ok: true, value: { reports: [a] } },
    { transport: 'cli-args', budgetFlag: false },
    { nodeKey: 'turn-3', ok: false, error: 'MODEL_SCHEMA' },
    { nodeKey: 'turn-4', ok: true, value: { reports: [b] } },   // a dropped: the frozen protocol lost it
    { nodeKey: 'turn-5', ok: true, value: { reports: [b, { ...a, title: 'renamed' }] } },
  ];
  const log = emittedReports(rows);
  assert.equal(log.length, 2);
  assert.deepEqual(log.map(x => [x.first, x.last]), [['turn-2', 'turn-5'], ['turn-4', 'turn-5']]);
  assert.equal(log[0].report.title, 't', 'the first listing is kept (seed + tokens identify a report)');
});

test('leakage map (M4 disclosure): every injected fault has its spec sentence, the cited line holds it, the class enum is the injected classes', () => {
  const flat = SPEC.replace(/\s+/g, ' '), lines = SPEC.split('\n');
  assert.deepEqual(LEAK.faults.map(f => f.bug).sort(), truth.bugs.map(b => b.id).sort());
  for (const f of LEAK.faults) {
    assert.ok(flat.includes(f.quote), `${f.bug}: quote not in DESIGN.md`);
    assert.ok(lines[f.specLine - 1].replace(/\s+/g, ' ').includes(f.quote.split(' ').slice(0, 5).join(' ')), `${f.bug}: line ${f.specLine}`);
    assert.equal(f.class, truth.bugs.find(b => b.id === f.bug).class);
  }
  assert.deepEqual([...LEAK.classEnum.injectedClasses].sort(), [...new Set(truth.bugs.map(b => b.class))].sort());
  assert.match(lines[LEAK.classEnum.specLine - 1], /bug class/);
});

bt('funnel: stages from a synthetic agent run (found, triggered but not reported, never triggered)', async () => {
  const reports = [rep('score_overflow', 1, ['goto:3,3'])];
  const score = await scoreReports(browser, reports, { truth });
  const d = runDir({ 'meta.json': { runId: 'syn-agent-r1', arm: 'agent' }, 'reports.json': reports, 'score.json': score,
    'stats.json': { stats: { played: [{ seed: 1, steps: ['goto:3,3'] }, { seed: 1, steps: ['right+right', 'wait'] }] } } });
  const session = await openSession(browser, { flags: truth.build.flags, oracle: true });
  try {
    const f = await funnelOf(session, d);
    assert.equal(f.stages.GQ10, 'foundMin');
    assert.equal(f.stages.GQ12, 'triggered-not-detected', 'the double move manifested in play but was never reported');
    assert.equal(f.stages.GQ08, 'never-triggered');
    assert.equal(f.perBug.GQ12.firstTriggerRun, 1);
    assert.deepEqual(f.falseReports, []);
  } finally { await session.close(); }
});

bt('regress: a report backed by a correct check is a valid regression test; a wrong check fails on the clean build too', async () => {
  const specs = [
    { id: 'one-move', rule: 'At most one move per tick.', bug_class: 'input_race', when: "cur.state.mode == 'playing' && !includes(cur.state.events, 'respawn') && !includes(cur.state.events, 'restart')",
      expect: "abs(cur.state.player.x - prev.state.player.x) + abs(cur.state.player.y - prev.state.player.y) <= (includes(cur.state.events, 'dash') ? 2 : 1)" },
    { id: 'time-wait', rule: '(wrong) the timer does not change on a wait.', bug_class: 'state_desync', expect: "cur.token != 'wait' || cur.state.timeLeft == prev.state.timeLeft" },
  ];
  const reports = [rep('input_race', 1, ['right+right']), rep('state_desync', 1, ['wait'])];
  const score = await scoreReports(browser, reports, { truth });
  const d = runDir({ 'meta.json': { runId: 'syn-wf-r1', arm: 'workflow' }, 'reports.json': reports, 'score.json': score,
    'constructed.json': { personas: [], specs }, 'stats.json': { reportChecks: [['one-move'], ['time-wait']] } });
  const b1 = await openSession(browser, { flags: truth.build.flags }), clean = await openSession(browser, { flags: [] });
  try {
    const r = await regressRun(b1, clean, d);
    assert.equal(r.reports, 2); assert.equal(r.validRegressionTests, 1); assert.equal(r.wrongChecks, 1);
    assert.deepEqual(r.perReport.map(x => [x.failsOnB1, x.passesOnClean, x.oracle]), [[true, true, 'credited'], [true, false, 'no_fault']]);
    assert.equal(r.falseReportsCaughtByControl, 1, 'the clean-build control catches the false report of the wrong check');
    const agent = await regressRun(b1, clean, runDir({ 'meta.json': { runId: 'syn-agent', arm: 'agent' }, 'stats.json': { stats: {} } }));
    assert.match(agent.skipped, /agent arm/);
  } finally { await b1.close(); await clean.close(); }
});

bt('posthoc: candidates are scored with the oracle rule, and exploration is re-scanned with the reference checks', async () => {
  const specs = [{ id: 'hud-coins', rule: 'The HUD shows the current coins.', bug_class: 'state_desync', expect: "cur.hud.coins == 'Coins ' + cur.state.coins + '/' + cur.state.coinsTotal" }];
  const d = runDir({ 'meta.json': { runId: 'syn-wf-r2', arm: 'workflow' }, 'constructed.json': { personas: [], specs },
    'stats.json': { minimized: [{ checkId: 'hud-coins', ctx: 'playing', seed: 1, steps: ['dash-down'], confirmed: true }, { checkId: 'hud-coins', ctx: 'x', seed: 1, steps: ['wait'], confirmed: false }],
      stats: { played: [{ seed: 1, steps: ['goto:3,3'] }] } } });
  const a = await creditedCandidates(browser, d, truth);
  assert.equal(a.candidates, 1, 'only confirmed candidates');
  assert.deepEqual(a.foundMinByCandidates, ['GQ03']);
  const b = await exploreWithPerfectChecks(browser, d, truth);
  assert.equal(b.played, 1);
  assert.ok(b.foundMinWithPerfectChecks.includes('GQ10'), JSON.stringify(b));
});

bt('rescore-union on a synthetic run: a dropped bug counts in the log, not in the final list', async () => {
  const a = rep('input_race', 1, ['right+right']), b = rep('score_overflow', 1, ['goto:3,3']);
  const final = await scoreReports(browser, [b], { truth });
  const d = runDir({ 'meta.json': { runId: 'syn-agent-r2', arm: 'agent', cost: { spent: 0.004 } }, 'score.json': final,
    'calls.jsonl': [{ nodeKey: 'turn-1', ok: true, value: { reports: [a] } }, { nodeKey: 'turn-2', ok: true, value: { reports: [b] } }].map(x => JSON.stringify(x)).join('\n') });
  const r = await rescoreRun(browser, d, { truth, scoreReports });
  assert.deepEqual(r.final.bugs, ['GQ10']); assert.deepEqual(r.ever.bugs, ['GQ10', 'GQ12']);
  assert.deepEqual(r.dropped.map(x => [x.bug, x.firstListed, x.lastListed]), [['GQ12', 'turn-1', 'turn-1']]);
});
