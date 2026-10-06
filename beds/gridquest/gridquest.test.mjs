import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, estimateTokens } from '../lib/canonical.mjs';
import * as bed from './index.mjs';
import { compile, simulate, minMechanisms, solve, explore } from './solver.mjs';
import { INJECTIONS } from './text.mjs';
import { keywordAgent } from './diagnostics.mjs';
import { makeEnv } from './engine.mjs';
import { rng } from '../lib/rng.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const SEEDS = Array.from({ length: 24 }, (_, i) => i);
const taskText = t => `${t.prompt}\n${canonical(t.inputs)}\n${canonical(t.files || {})}`;
const W = t => bed._internal.world(t);

test('interface shape', () => {
  assert.equal(bed.family.id, 'gridquest');
  assert.equal(bed.family.kind, 'interactive');
  for (const k of ['id', 'domain', 'version', 'description']) assert.ok(bed.family[k]);
  assert.equal(bed.outputSchema.type, 'object');
  const forbidden = ['pattern', 'oneOf', 'uniqueItems', '$ref', 'format'];
  assert.ok(!forbidden.some(k => JSON.stringify(bed.outputSchema).includes(`"${k}"`)));
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted', 'plausible-but-wrong', 'random-walk']) assert.ok(names.includes(n), n);
  for (const fn of ['generate', 'oracle', 'referenceSolve', 'createEnv']) assert.equal(typeof bed[fn], 'function');
});

test('determinism: identical calls give byte-identical tasks; seed and split matter', () => {
  for (const d of DIFFS) {
    for (const seed of [0, 7, 'alpha']) {
      const a = bed.generate({ seed, split: 'dev', difficulty: d });
      const b = bed.generate({ seed, split: 'dev', difficulty: d });
      assert.equal(canonical(a), canonical(b));
      assert.equal(JSON.stringify(a), JSON.stringify(JSON.parse(JSON.stringify(a))), 'JSON-serialisable');
    }
    const x = bed.generate({ seed: 3, split: 'dev', difficulty: d });
    assert.notEqual(canonical(x), canonical(bed.generate({ seed: 4, split: 'dev', difficulty: d })));
    assert.notEqual(canonical(x), canonical(bed.generate({ seed: 3, split: 'test', difficulty: d })));
    assert.deepEqual(Object.keys(x).sort(), ['budget', 'difficulty', 'family', 'id', 'inputs', 'prompt', 'seed', 'split']);
  }
});

test('generate rejects bad arguments', () => {
  assert.throws(() => bed.generate({ seed: 1, split: 'train', difficulty: 1 }));
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 6 }));
  assert.throws(() => bed.generate({ seed: 1.5, split: 'dev', difficulty: 2 }));
});

test('referenceSolve passes for >=20 seeds per difficulty on both splits', () => {
  for (const d of DIFFS) for (const split of ['dev', 'test']) for (const seed of SEEDS) {
    const t = bed.generate({ seed, split, difficulty: d });
    const r = bed.oracle(t, bed.referenceSolve(t));
    assert.equal(r.pass, true, `${t.id}: ${JSON.stringify(r.details)}`);
    assert.equal(r.score, 1);
    assert.equal(r.details.steps, r.details.optimal);
    assert.equal(r.details.stepsOverOptimal, 1);
  }
});

test('every bad control fails for >=20 seeds per difficulty', () => {
  for (const d of DIFFS) for (const seed of SEEDS) {
    const t = bed.generate({ seed, split: 'dev', difficulty: d });
    for (const c of bed.badControls) {
      const out = c.make(t);
      const r = bed.oracle(t, out);
      assert.equal(r.pass, false, `${c.name} passed on ${t.id}`);
      assert.equal(r.score, 0);
    }
  }
});

test('oracle rejects schema-invalid output', () => {
  const t = bed.generate({ seed: 5, split: 'dev', difficulty: 2 });
  const good = bed.referenceSolve(t).actions;
  const bad = [null, undefined, 42, 'take treasure', [], {}, { actions: 'take treasure' }, { actions: [1, 2] },
    { actions: good, notes: 'extra' }, { actions: [...good.slice(0, -1), 'x'.repeat(201)] }, { actions: Array(2001).fill('look') }];
  for (const out of bad) {
    const r = bed.oracle(t, out);
    assert.equal(r.pass, false, JSON.stringify(out)?.slice(0, 60));
    assert.match(r.details.reason, /^schema:/);
  }
});

test('oracle recomputes truth from (seed, split, difficulty) and ignores tampered task fields', () => {
  const t = bed.generate({ seed: 11, split: 'test', difficulty: 3 });
  const over = bed.badControls.find(c => c.name === 'over-budget').make(t);
  const tampered = { ...t, budget: { actions: 9999 }, inputs: { ...t.inputs, budget: { actions: 9999 } }, prompt: 'anything' };
  assert.equal(bed.oracle(tampered, over).pass, false);
  assert.equal(bed.oracle(tampered, bed.referenceSolve(t)).pass, true);
});

test('oracle scoring: steps/optimal reported, trailing actions after the win ignored, slack lowers score', () => {
  const t = bed.generate({ seed: 2, split: 'dev', difficulty: 3 });
  const sol = bed.referenceSolve(t).actions;
  const after = bed.oracle(t, { actions: [...sol, 'go north', 'look'] });
  assert.equal(after.pass, true);
  assert.equal(after.details.ignoredAfterEnd, 2);
  const slack = bed.oracle(t, { actions: ['look', 'dance wildly', ...sol] });
  assert.equal(slack.pass, true);
  assert.equal(slack.details.steps, sol.length + 2);
  assert.equal(slack.details.invalidActions, 1);
  assert.ok(Math.abs(slack.score - sol.length / (sol.length + 2)) < 1e-3);
  assert.ok(slack.details.stepsOverOptimal > 1);
  // Exactly at the budget still passes; one more look fails.
  const pad = t.budget.actions - sol.length;
  assert.equal(bed.oracle(t, { actions: [...Array(pad).fill('look'), ...sol] }).pass, true);
  assert.equal(bed.oracle(t, { actions: [...Array(pad + 1).fill('look'), ...sol] }).pass, false);
});

test('truth never leaks into prompt/inputs', () => {
  for (const d of DIFFS) for (const seed of SEEDS) {
    const t = bed.generate({ seed, split: 'dev', difficulty: d });
    const text = taskText(t);
    const w = W(t).w;
    const treasureRoom = w.rooms[w.treasure].name;
    assert.ok(!new RegExp(`\\b${treasureRoom}\\b`, 'i').test(text), `${t.id} names the treasure room`);
    assert.ok(!text.includes(w.treasureDesc), `${t.id} shows the treasure`);
    assert.ok(!text.includes(bed.referenceSolve(t).actions.join(', ')), `${t.id} contains the plan`);
    assert.ok(!text.includes(bed.referenceSolve(t).actions.slice(0, 4).join('", "')), `${t.id} contains a plan prefix`);
    for (const h of w.hides) assert.ok(!text.includes(`find an ${w.keys[h.key].color} key`) && !text.includes(`find a ${w.keys[h.key].color} key`));
    assert.ok(!/\bstart\b|\bcoordinates?\b|\brow \d/.test(t.inputs.initialObservation));
  }
});

test('env API: reset/step/observe/snapshot/restore/actions, D0 replay', () => {
  for (const d of DIFFS) {
    const t = bed.generate({ seed: 9, split: 'dev', difficulty: d });
    const env = bed.createEnv(t);
    assert.equal(env.determinism, 'D0');
    const r0 = env.reset();
    assert.equal(r0.observation, t.inputs.initialObservation);
    assert.equal(r0.done, false);
    assert.equal(env.observe(), r0.observation);
    const legal = env.actions();
    for (const a of ['look', 'go north', 'go south', 'go east', 'go west']) assert.ok(legal.includes(a));
    assert.ok(!legal.includes('take treasure'), 'treasure is never in the start room');
    const sol = bed.referenceSolve(t).actions;
    const half = Math.floor(sol.length / 2);
    const trace = [];
    for (const a of sol.slice(0, half)) trace.push(env.step(a).observation);
    const snap = env.snapshot();
    const rest = sol.slice(half).map(a => env.step(a));
    assert.equal(rest.at(-1).done, true);
    assert.equal(rest.at(-1).reward, 1);
    assert.deepEqual(env.actions(), []);
    const ignored = env.step('look');
    assert.equal(ignored.info.ignored, true);
    env.restore(snap);
    assert.equal(env.observe(), trace.at(-1));
    // In the treasure room, 'take treasure' is among the legal actions.
    const again = sol.slice(half, -1).map(a => env.step(a).observation);
    assert.deepEqual(again, rest.slice(0, -1).map(r => r.observation));
    assert.ok(env.actions().includes('take treasure'));
    // Fresh envs replay identically.
    const e2 = bed.createEnv(t);
    e2.reset();
    const obs2 = sol.slice(0, half).map(a => e2.step(a).observation);
    assert.deepEqual(obs2, trace);
    // Snapshots are opaque copies, not live references.
    const s1 = e2.snapshot();
    e2.step('go north');
    e2.step('go west');
    e2.restore(s1);
    assert.equal(e2.observe(), trace.at(-1));
  }
});

test('engine and abstract solver agree; every world solvable, certified and needs >=2 keys/switches at d3+', () => {
  for (const d of DIFFS) for (const seed of SEEDS) {
    const t = bed.generate({ seed, split: 'test', difficulty: d });
    const Wd = W(t);
    const m = compile(Wd.w);
    assert.equal(simulate(m, Wd.solution).won, true);
    assert.equal(solve(m).length, Wd.optimal);
    const mm = minMechanisms(m);
    assert.ok(mm >= (d >= 3 ? 2 : 1), `${t.id} minMech ${mm}`);
    if (d >= 4) assert.ok(mm >= 3);
    // The certifying explorer (perfect perception, no map) wins within budget in the real env.
    assert.equal(Wd.explorer.won, true, `${t.id} not certified`);
    const ex = bed.oracle(t, { actions: Wd.explorer.actions });
    assert.equal(ex.pass, true, `${t.id} explorer record fails in env`);
    assert.equal(ex.details.steps, explore(m, t.budget.actions).steps);
    // Budget is 2-3x optimal.
    assert.ok(t.budget.actions >= 2 * Wd.optimal && t.budget.actions <= 3 * Wd.optimal);
  }
});

test('fuzz: engine state matches the abstract model after random legal play', () => {
  for (const d of DIFFS) for (const seed of SEEDS.slice(0, 12)) {
    const t = bed.generate({ seed, split: 'dev', difficulty: d });
    const Wd = W(t), m = compile(Wd.w);
    const R = rng('fuzz', seed, d);
    const env = makeEnv(Wd.w, 10_000);
    const acts = [];
    for (let i = 0; i < 300; i++) {
      const legal = env.actions().filter(a => a !== 'take treasure');
      // Bias toward state-changing verbs so mechanisms and doors actually get exercised.
      const pref = legal.filter(a => /^(go|use|toggle|take|examine) /.test(a) && !a.startsWith('take ') || /key$/.test(a));
      const a = R.chance(0.7) && pref.length ? R.pick(pref) : R.pick(legal);
      acts.push(a);
      env.step(a);
    }
    const st = env._state();
    const s = simulate(m, acts).state;
    const bitAt = (o, i) => (s >>> (o + i)) & 1;
    assert.equal(s & 63, st.pos, `${t.id} position`);
    Wd.w.keys.forEach((k, i) => assert.equal(bitAt(m.oK, i) === 1, st.inv.includes(`key:${i}`), `${t.id} key ${i}`));
    Wd.w.hides.forEach((h, i) => assert.equal(bitAt(m.oH, i) === 1, st.revealed.includes(i), `${t.id} hide ${i}`));
    Wd.w.doors.forEach((dr, i) => assert.equal(bitAt(m.oD, i) === 1, st.unlocked.includes(i), `${t.id} door ${i}`));
    Wd.w.mechs.forEach((mc, i) => assert.equal(bitAt(m.oM, i) === 1, st.mech[i], `${t.id} mech ${i}`));
  }
});

test('parser accepts natural variants of canonical actions', () => {
  const t = bed.generate({ seed: 4, split: 'dev', difficulty: 3 });
  const sol = bed.referenceSolve(t).actions;
  const vary = a => {
    let m;
    if ((m = a.match(/^go (\w+)$/))) return m[1][0];
    if ((m = a.match(/^take (.+)$/))) return `pick up the ${m[1]}`;
    if ((m = a.match(/^use (.+) on (.+)$/))) return `unlock the ${m[2]} with the ${m[1]}`;
    if ((m = a.match(/^toggle (.+)$/))) return `pull the ${m[1]}`;
    if ((m = a.match(/^examine (.+)$/))) return `look in the ${m[1]}`;
    return a;
  };
  const r = bed.oracle(t, { actions: sol.map(vary) });
  assert.equal(r.pass, true, JSON.stringify(r.details));
  assert.equal(r.details.steps, sol.length);
});

test('difficulty sanity: grid size, plan length, prose volume and adversarial content grow with difficulty', () => {
  const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const rows = DIFFS.map(d => {
    const ts = SEEDS.slice(0, 12).map(seed => bed.generate({ seed, split: 'dev', difficulty: d }));
    const roomText = ts.map(t => W(t).w.rooms.map(r => r.slots.filter(s => s.k === 'text').map(s => s.text).join(' ')).join(' '));
    return {
      d,
      n: ts[0].inputs.grid.rows,
      opt: avg(ts.map(t => W(t).optimal)),
      tok: avg(ts.map(t => estimateTokens(t.prompt) + estimateTokens(t.inputs))),
      inject: ts.filter((t, i) => INJECTIONS.some(x => roomText[i].includes(x))).length,
      journal: avg(ts.map(t => (t.inputs.journal || []).length)),
      sky: ts.filter(t => W(t).w.rooms.some(r => r.slots.some(s => s.sky))).length,
    };
  });
  assert.deepEqual(rows.map(r => r.n), [3, 4, 5, 6, 7]);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].opt > rows[i - 1].opt, `optimal length grows d${i + 1}`);
    assert.ok(rows[i].tok >= rows[i - 1].tok, `prompt+inputs grow d${i + 1}`);
  }
  assert.equal(rows[0].inject + rows[1].inject + rows[2].inject, 0);
  assert.equal(rows[3].inject, 12);
  assert.equal(rows[4].inject, 12);
  assert.equal(rows[0].journal + rows[1].journal, 0);
  assert.ok(rows[2].journal >= 4 && rows[4].journal >= 9);
  assert.ok(rows[4].sky >= 10, 'sky directions appear at d5');
  assert.equal(rows[2].sky, 0);
});

test('a keyword-heuristic script is weak where judgment and memory matter', () => {
  const rate = d => SEEDS.slice(0, 20).filter(seed => {
    const t = bed.generate({ seed, split: 'test', difficulty: d });
    return bed.oracle(t, keywordAgent(bed.createEnv(t), t.budget.actions)).pass;
  }).length / 20;
  assert.ok(rate(4) <= 0.15, 'keyword agent at d4');
  assert.ok(rate(5) <= 0.15, 'keyword agent at d5');
});

test('runtime limits: generate and oracle well under 2 s at difficulty 5', () => {
  for (const seed of [101, 202, 303]) {
    let t0 = performance.now();
    const t = bed.generate({ seed: `fresh-${seed}`, split: 'test', difficulty: 5 });
    assert.ok(performance.now() - t0 < 2000);
    t0 = performance.now();
    bed.oracle(t, bed.badControls.find(c => c.name === 'random-walk').make(t));
    assert.ok(performance.now() - t0 < 2000);
  }
});
