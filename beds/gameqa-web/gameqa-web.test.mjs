// gameqa-web bed tests: build determinism, the clean build against its spec, every injected fault reachable with a
// 1-minimal reference repro, the oracle's scoring rules, and the freeze manifest. Needs Chromium (Playwright); skips
// with a reason when it cannot launch.
//   nice -n 15 node --test --test-concurrency=1 beds/gameqa-web/gameqa-web.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchBrowser, openSession, tokenError } from './driver.mjs';
import { loadTruth, scoreReports, freezeManifest, reportShapeError, CLASSES } from './oracle.mjs';

const truth = loadTruth();
let browser = null, why = null;
before(async () => { try { browser = await launchBrowser(); } catch (e) { why = `chromium unavailable: ${e.message.split('\n')[0]}`; } });
after(async () => { await browser?.close(); });
const t = (name, fn) => test(name, async ctx => { if (why) return ctx.skip(why); await fn(); });

async function play(flags, seed, steps, detail = 'each') {
  const s = await openSession(browser, { flags });
  try { await s.reset(seed); return await s.run(steps, { detail }); } finally { await s.close(); }
}
const prim = r => r.steps.filter(x => x.token);
const lastState = r => r.final.state;

t('the public spec and the test API never name a flag or a bug id', async () => {
  const spec = readFileSync(new URL('./spec/DESIGN.md', import.meta.url), 'utf8');
  for (const b of truth.bugs) { assert.ok(!spec.includes(b.flag), b.flag); assert.ok(!spec.includes(b.id), b.id); }
  const r = await play(truth.build.flags, 1, ['right']);
  const text = JSON.stringify(r);
  for (const b of truth.bugs) assert.ok(!text.includes(b.flag), `observation leaks ${b.flag}`);
});

t('a (build, seed, tokens) triple replays bit-identically (D0)', async () => {
  const steps = ['goto:4,5', 'pause', 'pause', 'dash-left', 'goto:1,8', 'use', 'wait', 'right+down', 'pause+left', 'enter'];
  const a = await play(truth.build.flags, 77, steps), b = await play(truth.build.flags, 77, steps);
  assert.deepEqual(a, b);
  const c = await play(truth.build.flags, 78, steps);
  assert.notDeepEqual(prim(a).map(x => x.obs.state.enemies), prim(c).map(x => x.obs.state.enemies), 'the seed moves the enemies');
});

t('clean build follows the spec on every reference repro (no probe can fire, behaviour is the correct one)', async () => {
  const clean = async (seed, steps) => prim(await play([], seed, steps));
  // input: one move per tick, and nothing after a pause
  let r = await clean(1, ['right+right']); assert.deepEqual(r[0].obs.state.player, { x: 2, y: 1 });
  r = await clean(1, ['pause+right']); assert.deepEqual(r[0].obs.state.player, { x: 1, y: 1 }); assert.equal(r[0].obs.state.mode, 'paused');
  r = await clean(1, ['pause+pause']); assert.equal(r[0].obs.state.mode, 'paused', 'the second P is ignored in the pausing tick');
  // dash: blocked first tile means no dash; a dash-collected coin shows in the HUD
  r = await clean(1, ['right', 'dash-down']); assert.deepEqual(r[1].obs.state.player, { x: 2, y: 1 }); assert.equal(r[1].obs.state.dashCooldown, 0);
  r = await clean(1, ['dash-down']); assert.equal(r[0].obs.state.coins, 1); assert.equal(r[0].obs.hud.coins, 'Coins 1/5'); assert.equal(r[0].obs.hud.dash, 'Dash 5');
  // resume by click keeps the HUD timer live; restart from pause runs at once
  r = await clean(1, ['pause', 'click:btn-resume', 'wait']); assert.equal(r[2].obs.hud.time, `Time ${r[2].obs.state.timeLeft}`); assert.equal(r[1].click, 'hit');
  r = await clean(1, ['right', 'pause', 'click:btn-restart', 'right']); assert.equal(r[2].obs.state.mode, 'playing'); assert.deepEqual(r[3].obs.state.player, { x: 2, y: 1 });
  // spikes at 0 points leave 0; a swap with an enemy costs a life; a key taken in a hit tick is kept
  r = await clean(1, ['goto:3,3']); assert.equal(r.at(-1).obs.state.score, 0); assert.equal(r.at(-1).obs.state.lives, 2);
  r = await clean(4, ['goto:3,5', 'wait', 'right']); assert.equal(r.at(-1).obs.state.lives, 2); assert.ok(r.at(-1).obs.state.events.includes('hit'));
  r = await clean(1, ['goto:3,5', 'right']); assert.ok(r.at(-1).obs.state.events.includes('hit')); assert.equal(r.at(-1).obs.state.keys, 1);
  // a pause while the key toast shows leaves Resume clickable
  r = await clean(1, ['goto:4,5', 'pause', 'click:btn-resume']); assert.equal(r.at(-1).click, 'hit'); assert.equal(r.at(-1).obs.state.mode, 'playing');
});

t('clean build: invulnerability is the respawn tick plus 4, and the timer drops once per running tick', async () => {
  const r = prim(await play([], 1, ['goto:3,3', 'wait', 'wait', 'wait', 'wait', 'wait', 'pause', 'wait']));
  const hitAt = r.findIndex(x => x.obs.state.events.includes('spikes'));
  assert.deepEqual(r.slice(hitAt, hitAt + 6).map(x => x.obs.state.invulnerable), [4, 3, 2, 1, 0, 0]);
  const times = r.map(x => x.obs.state.timeLeft);
  assert.equal(times.at(-1), times.at(-2), 'paused ticks do not run the timer');
  assert.equal(times[0], 299);
});

t('clean build: a full legitimate run completes, and every visible button is clickable in every dialog', async () => {
  const route = ['goto:4,5', 'goto:1,8', 'use', 'goto:10,5', 'down', 'goto:12,7'];
  let done = null;
  for (let seed = 1; seed <= 40 && !done; seed++) {
    const r = await play([], seed, route);
    if (lastState(r).mode === 'complete') done = { seed, r };
  }
  assert.ok(done, 'some seed in 1..40 completes the legitimate route');
  const after = await play([], done.seed, [...route, 'pause', 'click:btn-next', 'click:btn-again', 'pause']);
  const steps = prim(after);
  const seen = new Set();
  for (const s of steps) for (const u of s.obs.ui) if (u.visible && u.kind === 'button') { seen.add(u.id); assert.equal(u.top, true, `${u.id} covered at ${s.token}`); }
  assert.equal(lastState(done.r).bonus >= 1000, true, 'the legit route earns a big bonus, so the banner fault would show');
  const over = prim(await play([], 1, ['goto:3,3', 'goto:3,3', 'goto:3,3']));
  assert.equal(over.at(-1).obs.state.mode, 'gameover');
  for (const u of over.at(-1).obs.ui) if (u.visible && u.kind === 'button') { seen.add(u.id); assert.equal(u.top, true, u.id); }
  for (const id of ['btn-resume', 'btn-restart', 'btn-next', 'btn-again', 'btn-retry']) assert.ok(seen.has(id), `${id} was shown`);
});

t('every injected fault fires on its own reference repro, alone and in build B1, and the reference is 1-minimal', async () => {
  for (const b of truth.bugs) {
    const solo = await openSession(browser, { flags: [b.flag], oracle: true });
    const r = await solo.replayWithProbes(b.reference.seed, b.reference.steps);
    await solo.close();
    if (!['bonus_over_next', 'score_int16'].includes(b.flag)) assert.ok(r.fired.some(f => f.id === b.flag), `${b.id} fires alone`);
  }
  const reports = truth.bugs.map(b => ({ bug_class: b.class, title: b.title, seed: b.reference.seed, steps: b.reference.steps }));
  const s = await scoreReports(browser, reports, { truth });
  for (const [i, b] of truth.bugs.entries()) {
    const pr = s.perReport[i];
    assert.equal(pr.verdict, 'credited', b.id); assert.equal(pr.bug, b.id, `${b.id} credited to itself`);
    assert.equal(pr.minimal, true, `${b.id} reference is 1-minimal (removable ${pr.removable})`); assert.equal(pr.deterministic, true);
  }
  assert.equal(s.summary.foundMin, 12); assert.equal(s.summary.foundMinClass, 12); assert.equal(s.summary.falseReports, 0);
});

t('input-race probes fire on any observable deviation, not only a changed position', async () => {
  const fires = async (flag, seed, steps) => {
    const s = await openSession(browser, { flags: [flag], oracle: true });
    try { return (await s.replayWithProbes(seed, steps)).fired.some(f => f.id === flag); } finally { await s.close(); }
  };
  // down+up from the start: the faulty build steps down and back (two moves, same tile); the correct build bumps the wall above.
  assert.equal(await fires('multi_move', 1, ['down+up']), true);
  let r = prim(await play([], 1, ['down+up'])); assert.deepEqual(r[0].obs.state.player, { x: 1, y: 1 }); assert.deepEqual(r[0].obs.state.events, ['bump']);
  r = prim(await play(['multi_move'], 1, ['down+up'])); assert.deepEqual(r[0].obs.state.events, ['move', 'move']);
  // pause+up from the start: the late arrow only bumps the wall, which is still something happening in the pausing tick.
  assert.equal(await fires('pause_move', 1, ['pause+up']), true);
  r = prim(await play([], 1, ['pause+up'])); assert.deepEqual(r[0].obs.state.events, ['pause']);
  // up+up into the wall: the correct build reports one bump; the faulty one processes both keys (two bumps), which is observable
  assert.equal(await fires('multi_move', 1, ['up+up']), true);
  r = prim(await play([], 1, ['up+up'])); assert.deepEqual(r[0].obs.state.events, ['bump']);
  r = prim(await play(['multi_move'], 1, ['up+up'])); assert.deepEqual(r[0].obs.state.events, ['bump', 'bump']);
  // and no probe fires on the clean outcome: a single arrow, or a pause alone
  assert.equal(await fires('multi_move', 1, ['up']), false); assert.equal(await fires('pause_move', 1, ['pause']), false);
});

t('minimality keeps the symptom: a repro of the position symptom stays minimal although a shorter input shows another symptom', async () => {
  const s = await scoreReports(browser, [
    { bug_class: 'input_race', title: 'two moves', seed: 1, steps: ['dash-down', 'up+up'] },  // ends a tile off; 'up+up' alone only double-bumps
    { bug_class: 'input_race', title: 'double bump', seed: 1, steps: ['up+up'] },             // the effect symptom, one token
    { bug_class: 'input_race', title: 'padded', seed: 1, steps: ['wait', 'right+right'] },     // position symptom with a removable wait
    { bug_class: 'input_race', title: 'pause then a step', seed: 1, steps: ['right', 'pause+right'] }, // position symptom; pause+right alone also moves
  ], { truth, checkMinimality: true });
  const v = s.perReport;
  assert.equal(v[0].bug, 'GQ12'); assert.equal(v[0].symptom, 'position'); assert.equal(v[0].minimal, true);
  assert.equal(v[1].bug, 'GQ12'); assert.equal(v[1].symptom, 'effect'); assert.equal(v[1].minimal, true);
  assert.equal(v[2].minimal, false); assert.deepEqual(v[2].removable, [0]);
  assert.equal(v[3].bug, 'GQ11'); assert.equal(v[3].symptom, 'position'); assert.equal(v[3].minimal, false); assert.deepEqual(v[3].removable, [0]);
});

t('oracle scoring: padding, wrong class, duplicates, junk and malformed reports', async () => {
  const ref = id => truth.bugs.find(b => b.id === id).reference;
  const reports = [
    { bug_class: 'input_race', title: 'padded', seed: 1, steps: ['wait', 'right+right'] },          // credited, not minimal
    { bug_class: 'input_race', title: 'min', seed: 1, steps: ['right+right'] },                    // earns GQ12; the padded one is the duplicate
    { bug_class: 'ui_overlap', title: 'wrong class', ...ref('GQ10') },                               // GQ10 with class mismatch
    { bug_class: 'collision', title: 'nothing', seed: 3, steps: ['right', 'left', 'wait'] },        // no fault
    { bug_class: 'collision', title: 'bad token', seed: 3, steps: ['jump'] },                        // malformed
    { bug_class: 'graphics', title: 'bad class', seed: 3, steps: ['right'] },                        // malformed
  ];
  const s = await scoreReports(browser, reports, { truth });
  const v = s.perReport;
  assert.equal(v[0].verdict, 'credited'); assert.equal(v[0].minimal, false); assert.deepEqual(v[0].removable, [0]); assert.equal(v[0].duplicate, true);
  assert.equal(v[1].minimal, true); assert.equal(v[1].duplicate, undefined);
  assert.equal(v[2].bug, 'GQ10'); assert.equal(v[2].classMatch, false);
  assert.equal(v[3].verdict, 'no_fault'); assert.equal(v[4].verdict, 'malformed'); assert.equal(v[5].verdict, 'malformed');
  assert.deepEqual({ foundMin: s.summary.foundMin, foundMinClass: s.summary.foundMinClass, falseReports: s.summary.falseReports, duplicates: s.summary.duplicates },
    { foundMin: 2, foundMinClass: 1, falseReports: 3, duplicates: 1 });
});

test('report shape and token grammar (no browser)', () => {
  assert.equal(reportShapeError({ bug_class: 'softlock', seed: 1, steps: ['pause', 'click:btn-restart'] }), null);
  assert.match(reportShapeError({ bug_class: 'softlock', seed: 0, steps: ['pause'] }), /seed/);
  assert.match(reportShapeError({ bug_class: 'softlock', seed: 1, steps: [] }), /steps/);
  assert.equal(tokenError('up+down+left'), null); assert.match(tokenError('up+down+left+right'), /at most 3/);
  assert.match(tokenError('goto:1'), /goto/); assert.match(tokenError('click:btn-x'), /unknown button/); assert.match(tokenError('wait+up'), /key tokens/);
  assert.deepEqual(CLASSES, ['collision', 'state_desync', 'softlock', 'ui_overlap', 'score_overflow', 'input_race']);
  const m = freezeManifest();
  assert.match(m.sha256, /^[0-9a-f]{64}$/); assert.equal(Object.keys(m.files).length, 6);
});
