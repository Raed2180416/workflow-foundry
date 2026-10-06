import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, estimateTokens } from '../lib/canonical.mjs';
import * as bed from './index.mjs';
import { TEMPLATES, BUG_CLASSES } from './bugs.mjs';
import { Game, ACTIONS } from './engine.mjs';
import { DIFF } from './world.mjs';

const { caseFor, evaluateRepro, replay, decoyReports } = bed._internal;
const DIFFS = [1, 2, 3, 4, 5];
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const task = (seed, difficulty, split = 'dev') => bed.generate({ seed, split, difficulty });

test('interface shape', () => {
  assert.equal(bed.family.id, 'gameqa');
  assert.equal(bed.family.kind, 'interactive');
  for (const name of ['generate', 'oracle', 'referenceSolve', 'createEnv']) assert.equal(typeof bed[name], 'function');
  assert.ok(bed.outputSchema.properties.bugs);
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted']) assert.ok(names.includes(n));
  assert.ok(names.some(n => n === 'sibling-class' || n === 'by-design-overreport'), 'plausible-but-wrong near miss present');
  const json = JSON.stringify(bed.outputSchema);
  for (const banned of ['"pattern"', '"oneOf"', '"uniqueItems"', '"$ref"', '"format"']) assert.ok(!json.includes(banned), banned);
});

test('catalog has >= 10 parameterized templates covering all 10 classes', () => {
  assert.ok(TEMPLATES.length >= 10);
  assert.deepEqual([...new Set(TEMPLATES.map(t => t.cls))].sort(), [...BUG_CLASSES].sort());
});

test('generate is deterministic and split-salted', () => {
  for (const d of DIFFS) for (const seed of [1, 7]) {
    assert.equal(canonical(task(seed, d)), canonical(task(seed, d)));
    assert.notEqual(canonical(task(seed, d, 'dev')), canonical(task(seed, d, 'test')));
  }
});

test('K = difficulty, distinct classes, every planted bug has a known repro', () => {
  for (const d of DIFFS) for (const seed of SEEDS.slice(0, 8)) {
    const c = caseFor({ seed, split: 'dev', difficulty: d });
    assert.equal(c.bugs.length, d);
    assert.equal(new Set(c.bugs.map(b => b.cls)).size, d);
    for (const b of c.bugs) assert.ok(c.repros[b.id].length >= 1 && c.repros[b.id].length <= 400);
  }
});

test('templates and classes are all exercised across seeds', () => {
  const seen = new Set(), classes = new Set();
  for (const d of [3, 4, 5]) for (const seed of SEEDS) for (const b of caseFor({ seed, split: 'dev', difficulty: d }).bugs) { seen.add(b.template); classes.add(b.cls); }
  assert.equal(classes.size, BUG_CLASSES.length);
  assert.equal(seen.size, TEMPLATES.length, `missing: ${TEMPLATES.map(t => t.id).filter(t => !seen.has(t))}`);
});

test('referenceSolve passes for 20 seeds per difficulty (dev) and 5 per difficulty (test)', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS) {
      const t = task(seed, d);
      const v = bed.oracle(t, bed.referenceSolve(t));
      assert.equal(v.pass, true, `d${d} s${seed}: ${JSON.stringify(v.details).slice(0, 300)}`);
      assert.equal(v.score, 1);
      assert.equal(v.details.falseReports, 0);
      assert.equal(v.details.reproLengthRatio, 1);
    }
    for (const seed of SEEDS.slice(0, 5)) {
      const t = task(seed, d, 'test');
      assert.equal(bed.oracle(t, bed.referenceSolve(t)).pass, true);
    }
  }
});

test('every bad control fails for 20 seeds per difficulty', () => {
  for (const ctl of bed.badControls) for (const d of DIFFS) for (const seed of SEEDS) {
    const t = task(seed, d);
    const v = bed.oracle(t, ctl.make(t));
    assert.equal(v.pass, false, `${ctl.name} passed d${d} s${seed}: ${JSON.stringify(v.details).slice(0, 300)}`);
  }
});

test('by-design near miss: documented quirks reproduce in the control build too, so they are false reports', () => {
  for (const d of DIFFS) for (const seed of SEEDS.slice(0, 10)) {
    const c = caseFor({ seed, split: 'dev', difficulty: d });
    const decoys = decoyReports(c, 2);
    assert.equal(decoys.length, 2, `d${d} s${seed}`);
    for (const dr of decoys) assert.equal(evaluateRepro(c.world, c.bugs, dr.bug_class, dr.repro_actions).verdict, 'false');
  }
});

test('oracle rejects schema-invalid output', () => {
  const t = task(3, 3);
  const ref = bed.referenceSolve(t);
  const bad = [
    null, [], {}, { bugs: 'x' },
    { bugs: [{ bug_class: 'lag', repro_actions: ['N'], description: '' }] },
    { bugs: [{ bug_class: 'crash', repro_actions: [], description: '' }] },
    { bugs: [{ bug_class: 'crash', repro_actions: ['north'], description: '' }] },
    { bugs: [{ bug_class: 'crash', repro_actions: ['N'] }] },
    { bugs: [{ ...ref.bugs[0], repro_actions: Array(401).fill('WAIT') }] },
    { bugs: Array(21).fill(ref.bugs[0]) },
  ];
  for (const out of bad) {
    const v = bed.oracle(t, out);
    assert.equal(v.pass, false);
    assert.equal(v.score, 0);
    assert.match(v.details.reason, /^schema:/);
  }
});

test('oracle semantics: duplicates count once, one false report is tolerated, two are not', () => {
  const t = task(5, 3);
  const ref = bed.referenceSolve(t).bugs;
  const dup = bed.oracle(t, { bugs: [...ref, ref[0], ref[0]] });
  assert.equal(dup.pass, true);
  assert.equal(dup.details.duplicates, 2);
  const one = { bug_class: 'crash', repro_actions: ['WAIT'], description: 'nothing' };
  const c = caseFor(t);
  const crashPlanted = c.bugs.some(b => b.cls === 'crash');
  const filler = crashPlanted ? { ...one, bug_class: BUG_CLASSES.find(k => !c.bugs.some(b => b.cls === k)) } : one;
  assert.equal(bed.oracle(t, { bugs: [...ref, filler] }).pass, true);
  assert.equal(bed.oracle(t, { bugs: [...ref, filler, filler] }).pass, false);
  // Recall: at K=5 one missed bug is tolerated, two are not.
  const t5 = task(5, 5);
  const ref5 = bed.referenceSolve(t5).bugs;
  assert.equal(bed.oracle(t5, { bugs: ref5.slice(1) }).pass, true);
  assert.equal(bed.oracle(t5, { bugs: ref5.slice(2) }).pass, false);
});

test('control build never fires a detector; every known repro diverges from the control', () => {
  for (const d of [2, 4]) for (const seed of SEEDS.slice(0, 6)) {
    const c = caseFor({ seed, split: 'dev', difficulty: d });
    for (const b of c.bugs) {
      const ctl = replay(c.world, [], c.repros[b.id]);
      assert.equal(ctl.fired.length, 0);
      const bug = replay(c.world, c.bugs, c.repros[b.id]);
      assert.ok(bug.fired.some(f => f.bug === b.id));
      assert.notDeepEqual(bug.trace, ctl.trace);
    }
  }
});

test('truth never leaks into prompt, inputs or the initial observation', () => {
  const hidden = ['bug1', 'bug2', 'crash_action', 'key_eaten', 'chest_rubble', 'load_dupe', 'purse_wrap', 'enemy_teleport', 'enemy_freeze', 'ghost_sprite', 'stale_hud', 'door_bypass', 'stairs_drop', 'price_rounding', 'potion_at_full', 'save_on_open_door', 'sell_last_gem', 'lantern_twice', 'wrap256', 'capwrap', 'bump_twice', 'holding_other_key', 'adjacent_wait', 'sell_round_up', 'half_down'];
  for (const d of DIFFS) for (const seed of SEEDS.slice(0, 10)) {
    const t = task(seed, d);
    const text = JSON.stringify([t.prompt, t.inputs, t.files ?? null]);
    for (const h of hidden) assert.ok(!text.includes(h), `d${d} s${seed} leaks ${h}`);
    const c = caseFor(t);
    for (const b of c.bugs) {
      const rep = c.repros[b.id];
      if (rep.length >= 4) assert.ok(!text.includes(JSON.stringify(rep)), `d${d} s${seed} leaks repro of ${b.cls}`);
    }
    // The buggy build looks exactly like the control build until a defect is triggered.
    assert.deepEqual(new Game(c.world, c.bugs).observation(), new Game(c.world, []).observation());
    assert.deepEqual(t.inputs.environment.initial_observation, new Game(c.world, []).observation());
  }
});

test('environment: D0 determinism, opaque snapshots, restore, errors and done', () => {
  const t = task(2, 4);
  const ref = bed.referenceSolve(t);
  const envA = bed.createEnv(t), envB = bed.createEnv(t);
  assert.equal(envA.determinism, 'D0');
  assert.deepEqual(envA.actions(), ACTIONS);
  const r0 = envA.reset();
  assert.equal(r0.done, false);
  const seq = ref.bugs[0].repro_actions;
  const obsA = seq.map(a => envA.step(a)), obsB = seq.map(a => envB.step(a));
  assert.deepEqual(obsA, obsB);
  // Snapshot handles are opaque strings; restoring rewinds exactly.
  const env = bed.createEnv(t);
  env.step('E');
  const snap = env.snapshot();
  assert.equal(typeof snap, 'string');
  const before = env.observe();
  env.step('S'); env.step('WAIT'); env.step('SAVE');
  assert.notDeepEqual(env.observe(), before);
  env.restore(snap);
  assert.deepEqual(env.observe(), before);
  assert.throws(() => env.restore('nope'));
  // Unknown actions are rejected without consuming a turn.
  const turn = env.observe().state.turn;
  const bad = env.step('jump');
  assert.equal(bad.info.ok, false);
  assert.equal(env.observe().state.turn, turn);
  // Observations never expose host-side detector state.
  const text = JSON.stringify(obsA);
  for (const h of ['fired', 'bug1', 'mem', 'hudGold', 'lagPrev']) assert.ok(!text.includes(h), h);
});

test('environment: a crash ends the episode and later steps are refused', () => {
  for (const seed of SEEDS) {
    const c = caseFor({ seed, split: 'dev', difficulty: 3 });
    const b = c.bugs.find(x => x.cls === 'crash');
    if (!b) continue;
    const env = bed.createEnv(task(seed, 3));
    let last;
    for (const a of c.repros[b.id]) last = env.step(a);
    assert.equal(last.done, true);
    assert.equal(last.observation.status, 'crashed');
    assert.ok(last.observation.error);
    assert.equal(env.step('WAIT').info.ok, false);
    assert.deepEqual(env.actions(), []);
    return;
  }
  assert.fail('no crash bug found at d3 in 20 seeds');
});

test('difficulty sanity: sizes grow with difficulty and level 3 is in the 6-15K token band', () => {
  const avg = {};
  for (const d of DIFFS) {
    const toks = SEEDS.slice(0, 8).map(s => { const t = task(s, d); return estimateTokens(t.prompt) + estimateTokens(t.inputs); });
    avg[d] = toks.reduce((a, b) => a + b, 0) / toks.length;
    assert.equal(caseFor({ seed: 1, split: 'dev', difficulty: d }).world.levels.length, DIFF[d].levels);
  }
  for (const d of [2, 3, 4, 5]) assert.ok(avg[d] > avg[d - 1], `tokens d${d} ${avg[d]} <= d${d - 1} ${avg[d - 1]}`);
  assert.ok(avg[3] >= 6000 && avg[3] <= 15000, `d3 tokens ${avg[3]}`);
  const t5 = task(3, 5);
  assert.ok(t5.inputs.reports.length > task(3, 1).inputs.reports.length);
});

test('runtime: generate and oracle each under 2 s at difficulty 5', () => {
  for (const seed of [101, 102, 103]) {
    let t0 = performance.now();
    const t = task(seed, 5);
    assert.ok(performance.now() - t0 < 2000, 'generate');
    const out = bed.badControls.find(c => c.name === 'by-design-overreport').make(t);
    t0 = performance.now();
    bed.oracle(t, out);
    assert.ok(performance.now() - t0 < 2000, 'oracle');
  }
});
