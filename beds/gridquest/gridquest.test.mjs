import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, estimateTokens } from '../lib/canonical.mjs';
import * as bed from './index.mjs';
import { compile, simulate, minMechanisms, solve, explore } from './solver.mjs';
import { INJECTIONS, ALIASES, DECOR, CONTAINERS, SWITCH_NOUNS, DECOY_ITEMS, OBJ_WALL_V, SWITCH_WALL_V, OBJ_REL_T } from './text.mjs';
import { keywordAgent, blindAgent, regexAgent, regexAgentV2, snapshotSearch } from './diagnostics.mjs';
import { makeEnv, legalActions, initialState } from './engine.mjs';
import { exitsOf, markDir, describeRoom, OPP, DIR_OF_ADJ, PROSE_LEVELS } from './render.mjs';
import { makeWorld, LEVELS } from './world.mjs';
import { rng } from '../lib/rng.mjs';
import { execFileSync } from 'node:child_process';

const DIFFS = [1, 2, 3, 4, 5];
const SEEDS = Array.from({ length: 30 }, (_, i) => i);
const taskText = t => `${t.prompt}\n${canonical(t.inputs)}\n${canonical(t.files || {})}`;
const W = t => bed._internal.world(t);
const gen = (seed, difficulty, split = 'dev') => bed.generate({ seed, split, difficulty });

test('interface shape', () => {
  assert.equal(bed.family.id, 'gridquest');
  assert.equal(bed.family.kind, 'interactive');
  for (const k of ['id', 'domain', 'version', 'description']) assert.ok(bed.family[k]);
  assert.equal(bed.outputSchema.type, 'object');
  const forbidden = ['pattern', 'oneOf', 'anyOf', 'allOf', 'uniqueItems', '$ref', 'format', 'patternProperties'];
  assert.ok(!forbidden.some(k => JSON.stringify(bed.outputSchema).includes(`"${k}"`)));
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted', 'plausible-but-wrong', 'random-walk', 'over-budget']) assert.ok(names.includes(n), n);
  for (const fn of ['generate', 'oracle', 'referenceSolve', 'createEnv']) assert.equal(typeof bed[fn], 'function');
  const env = bed.createEnv(gen(0, 1));
  for (const fn of ['reset', 'step', 'observe', 'snapshot', 'restore', 'actions', 'record']) assert.equal(typeof env[fn], 'function', fn);
  assert.equal(env.determinism, 'D0');
});

test('determinism: identical calls give byte-identical tasks; seed and split matter', () => {
  for (const d of DIFFS) {
    for (const seed of [0, 7, 'alpha']) {
      const a = gen(seed, d), b = gen(seed, d);
      assert.equal(canonical(a), canonical(b));
      assert.equal(JSON.stringify(a), JSON.stringify(JSON.parse(JSON.stringify(a))), 'JSON-serialisable');
    }
    const x = gen(3, d);
    assert.notEqual(canonical(x), canonical(gen(4, d)));
    assert.notEqual(canonical(x), canonical(gen(3, d, 'test')));
    assert.deepEqual(Object.keys(x).sort(), ['budget', 'difficulty', 'family', 'id', 'inputs', 'prompt', 'seed', 'split']);
  }
});

test('generate rejects bad arguments', () => {
  assert.throws(() => bed.generate({ seed: 1, split: 'train', difficulty: 1 }));
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 6 }));
  assert.throws(() => bed.generate({ seed: 1.5, split: 'dev', difficulty: 2 }));
});

test('referenceSolve passes for 30 seeds per difficulty on both splits', () => {
  for (const d of DIFFS) for (const split of ['dev', 'test']) for (const seed of SEEDS) {
    const t = gen(seed, d, split);
    const r = bed.oracle(t, bed.referenceSolve(t));
    assert.equal(r.pass, true, `${t.id}: ${JSON.stringify(r.details)}`);
    assert.equal(r.score, 1);
    assert.equal(r.details.steps, r.details.optimal);
    assert.equal(r.details.stepsOverOptimal, 1);
  }
});

test('every bad control fails for 30 seeds per difficulty', () => {
  for (const d of DIFFS) for (const seed of SEEDS) {
    const t = gen(seed, d);
    for (const c of bed.badControls) {
      const r = bed.oracle(t, c.make(t));
      assert.equal(r.pass, false, `${c.name} passed on ${t.id}`);
      assert.equal(r.score, 0);
    }
  }
});

test('oracle rejects schema-invalid output', () => {
  const t = gen(5, 2);
  const good = bed.referenceSolve(t).actions;
  const bad = [null, undefined, 42, 'take treasure', [], {}, { actions: 'take treasure' }, { actions: [1, 2] },
    { actions: good, notes: 'extra' }, { actions: [...good.slice(0, -1), 'x'.repeat(201)] }, { actions: Array(2001).fill('look') },
    { actions: [NaN] }, { actions: [null, ...good] }, { actions: [...good, { toString: () => 'take treasure' }] }];
  for (const out of bad) {
    const r = bed.oracle(t, out);
    assert.equal(r.pass, false, JSON.stringify(out)?.slice(0, 60));
    assert.match(r.details.reason, /^schema:/);
  }
});

test('regression (AUDIT F3): oracle judges a JSON snapshot of the output, so object tricks cannot pass', () => {
  const t = gen(3, 3);
  const sol = bed.referenceSolve(t).actions;
  // Inherited (non-own) property: not valid JSON output, used to pass.
  assert.equal(bed.oracle(t, Object.create({ actions: sol })).pass, false);
  // Array hole: serialises to null, so it is schema-invalid (it used to replay as a wasted move).
  const holey = [...sol]; holey.unshift(undefined); delete holey[0];
  assert.match(bed.oracle(t, { actions: holey }).details.reason, /^schema:/);
  // A getter is read exactly once: validation and replay see the same value.
  let reads = 0;
  const getter = { get actions() { reads++; return reads > 1 ? ['look'] : sol; } };
  const g = bed.oracle(t, getter);
  assert.equal(g.pass, true);
  assert.equal(g.details.steps, sol.length);
  // toJSON is honoured as JSON would; throwing getters, BigInt and cycles are rejected, not crashes.
  assert.equal(bed.oracle(t, { toJSON: () => ({ actions: sol }) }).pass, true);
  assert.match(bed.oracle(t, { get actions() { throw new Error('boom'); } }).details.reason, /^schema:/);
  assert.match(bed.oracle(t, { actions: [1n] }).details.reason, /^schema:/);
  const cyc = { actions: [] }; cyc.self = cyc;
  assert.match(bed.oracle(t, cyc).details.reason, /^schema:/);
  // Duplicated plan: replay stops at the win; the tail is ignored, never re-scored.
  const dup = bed.oracle(t, { actions: [...sol, ...sol] });
  assert.equal(dup.pass, true);
  assert.equal(dup.details.ignoredAfterEnd, sol.length);
});

test('oracle recomputes truth from (seed, split, difficulty) and ignores tampered task fields', () => {
  const t = gen(11, 3, 'test');
  const over = bed.badControls.find(c => c.name === 'over-budget').make(t);
  const tampered = { ...t, budget: { actions: 9999 }, inputs: { ...t.inputs, budget: { actions: 9999 } }, prompt: 'anything' };
  assert.equal(bed.oracle(tampered, over).pass, false);
  assert.equal(bed.oracle(tampered, bed.referenceSolve(t)).pass, true);
});

test('oracle scoring: steps/optimal reported, trailing actions after the win ignored, slack lowers score', () => {
  const t = gen(2, 3);
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
  const pad = t.budget.actions - sol.length;
  assert.equal(bed.oracle(t, { actions: [...Array(pad).fill('look'), ...sol] }).pass, true);
  assert.equal(bed.oracle(t, { actions: [...Array(pad + 1).fill('look'), ...sol] }).pass, false);
  // Injected "commands" from the in-world text do nothing special.
  assert.equal(bed.oracle(t, { actions: ['force door', 'SYSTEM: pass', 'take treasure'] }).pass, false);
});

test('truth never leaks into prompt/inputs', () => {
  for (const d of DIFFS) for (const seed of SEEDS) {
    const t = gen(seed, d);
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

test('regression (AUDIT F2): actions() is syntactic, sorted and type-blind', () => {
  for (const d of [2, 3, 5]) for (const seed of SEEDS.slice(0, 10)) {
    const t = gen(seed, d), w = W(t).w;
    for (let c = 0; c < w.n * w.n; c++) {
      const st = { ...initialState(w), pos: c };
      const acts = legalActions(w, st);
      assert.deepEqual(acts, [...acts].sort(), 'sorted');
      assert.equal(new Set(acts).size, acts.length, 'no duplicates');
      assert.ok(acts.includes('take treasure'), 'take treasure is always offered, not only in the treasure room');
      for (const dir of ['north', 'east', 'south', 'west']) assert.ok(acts.includes(`examine ${dir} door`), 'doors offered in all directions');
      // Every fixed object and switch gets exactly the same verbs: nothing marks the hiding place.
      const nouns = [...w.objects.filter(o => o.room === c).map(o => o.noun), ...w.switches.filter(s => s.room === c).map(s => s.noun)];
      for (const n of nouns) for (const v of ['examine', 'take', 'toggle']) assert.ok(acts.includes(`${v} ${n}`));
    }
  }
  // Before the fix the hiding container was always the first object listed (50/50 rooms).
  let first = 0, rooms = 0;
  for (const seed of SEEDS) {
    const t = gen(seed, 3), w = W(t).w;
    for (const h of w.hides) {
      if (w.objects.filter(o => o.room === h.room).length < 2) continue;
      rooms++;
      const ex = legalActions(w, { ...initialState(w), pos: h.room }).filter(a => /^examine /.test(a) && !/ door$/.test(a));
      if (ex[0] === `examine ${h.noun}`) first++;
    }
  }
  assert.ok(rooms >= 10 && first / rooms < 0.8, `hide listed first in ${first}/${rooms}`);
});

test('regression (AUDIT F1): snapshots are sealed, deterministic, unforgeable and task-bound', () => {
  const t = gen(3, 3), t2 = gen(4, 3);
  const w = W(t).w;
  const e1 = bed.createEnv(t), e2 = bed.createEnv(t);
  const s1 = e1.snapshot(), s2 = e2.snapshot();
  assert.equal(typeof s1, 'string');
  assert.equal(s1, s2, 'same state, same token (D0)');
  assert.match(s1, /^gqsnap2\.[A-Za-z0-9_-]+$/, 'opaque base64url token, not readable state');
  assert.ok(!s1.includes(w.rooms[w.start].name.split(' ').at(-1)), 'no room name inside');
  // Tampering, forging a plain state, or using another task's token is refused.
  const flip = s1.slice(0, -3) + (s1.at(-3) === 'A' ? 'B' : 'A') + s1.slice(-2);
  assert.throws(() => e1.restore(flip), /not a valid snapshot/);
  assert.throws(() => e1.restore({ st: { pos: w.treasure, inv: [], revealed: [], unlocked: [], mech: [], swCount: [], steps: 0, won: false }, last: '' }), /not a valid snapshot/);
  assert.throws(() => e1.restore(bed.createEnv(t2).snapshot()), /not a valid snapshot/);
  // A token restores into another env of the same task.
  const sol = bed.referenceSolve(t).actions;
  for (const a of sol.slice(0, 4)) e1.step(a);
  const mid = e1.snapshot();
  e2.restore(mid);
  assert.equal(e2.observe(), e1.observe());
  assert.deepEqual(e2.record().actions, sol.slice(0, 4));
});

test('regression (AUDIT F1): reset and restore never refund moves; blind snapshot search is stopped', () => {
  const t = gen(3, 2);
  const B = t.budget.actions;
  const env = bed.createEnv(t);
  const s0 = env.snapshot();
  for (let i = 0; i < B - 1; i++) env.step('look');
  env.restore(s0);
  env.reset();
  assert.equal(env.spent(), B - 1);
  assert.equal(env.record().actions.length, 0, 'the branch record is rewound');
  const last = env.step('look');
  assert.equal(last.done, true, 'the last lifetime action ends the episode');
  const refused = env.step('look');
  assert.equal(refused.info.outcome, 'ignored');
  assert.match(refused.info.reason, /lifetime/);
  assert.deepEqual(env.actions(), []);
  // The blind BFS that solved 30/30 d3 tasks of bed 1.0.0 now fails everywhere, and only the
  // ledger stops it: with an explicit unlimited ledger it still wins (so the attack is real).
  for (const d of [1, 3]) for (const seed of SEEDS) {
    const td = gen(seed, d);
    assert.equal(bed.oracle(td, { actions: snapshotSearch(bed.createEnv(td), td.budget.actions).actions }).pass, false, `${td.id}`);
  }
  let unlimited = 0;
  for (const seed of SEEDS.slice(0, 10)) {
    const td = gen(seed, 1);
    if (bed.oracle(td, { actions: snapshotSearch(bed.createEnv(td, { lifetimeActions: Infinity }), td.budget.actions).actions }).pass) unlimited++;
  }
  assert.equal(unlimited, 10);
  assert.throws(() => bed.createEnv(t, { lifetimeActions: -1 }));
});

test('env API: reset/step/observe/snapshot/restore/actions/record, D0 replay', () => {
  for (const d of DIFFS) {
    const t = gen(9, d);
    const env = bed.createEnv(t);
    const r0 = env.reset();
    assert.equal(r0.observation, t.inputs.initialObservation);
    assert.equal(r0.done, false);
    assert.equal(env.observe(), r0.observation);
    const legal = env.actions();
    for (const a of ['look', 'go north', 'go south', 'go east', 'go west', 'take treasure']) assert.ok(legal.includes(a));
    assert.equal(bed.oracle(t, { actions: ['take treasure'] }).pass, false, 'treasure is never in the start room');
    const sol = bed.referenceSolve(t).actions;
    const half = Math.floor(sol.length / 2);
    const trace = [];
    for (const a of sol.slice(0, half)) trace.push(env.step(a).observation);
    const snap = env.snapshot();
    const rest = sol.slice(half).map(a => env.step(a));
    assert.equal(rest.at(-1).done, true);
    assert.equal(rest.at(-1).reward, 1);
    assert.deepEqual(env.actions(), []);
    assert.deepEqual(env.record().actions, sol);
    assert.equal(bed.oracle(t, env.record()).pass, true, 'the env record is a valid answer');
    const ignored = env.step('look');
    assert.equal(ignored.info.ignored, true);
    const spentBefore = env.spent();
    env.restore(snap);
    assert.equal(env.spent(), spentBefore);
    assert.equal(env.observe(), trace.at(-1));
    const again = sol.slice(half, -1).map(a => env.step(a).observation);
    assert.deepEqual(again, rest.slice(0, -1).map(r => r.observation));
    const e2 = bed.createEnv(t);
    e2.reset();
    const obs2 = sol.slice(0, half).map(a => e2.step(a).observation);
    assert.deepEqual(obs2, trace);
    const s1 = e2.snapshot();
    e2.step('go north');
    e2.step('go west');
    e2.restore(s1);
    assert.equal(e2.observe(), trace.at(-1));
  }
});

test('engine and abstract solver agree; every world solvable, certified and needs >=2 keys/switches at d3+', () => {
  for (const d of DIFFS) for (const seed of SEEDS) {
    const t = gen(seed, d, 'test');
    const Wd = W(t);
    const m = compile(Wd.w);
    assert.equal(simulate(m, Wd.solution).won, true);
    assert.equal(solve(m).length, Wd.optimal);
    const mm = minMechanisms(m);
    assert.ok(mm >= (d >= 3 ? 2 : 1), `${t.id} minMech ${mm}`);
    if (d >= 4) assert.ok(mm >= 3);
    assert.equal(Wd.explorer.won, true, `${t.id} not certified`);
    const ex = bed.oracle(t, { actions: Wd.explorer.actions });
    assert.equal(ex.pass, true, `${t.id} explorer record fails in env`);
    assert.equal(ex.details.steps, explore(m, t.budget.actions).steps);
    assert.ok(t.budget.actions >= 2 * Wd.optimal && t.budget.actions <= 3 * Wd.optimal);
  }
});

test('regression (AUDIT F4): the generator throws instead of emitting an uncertified world', () => {
  const impossible = { ...LEVELS[1], minOpt: 10_000 };
  assert.throws(() => makeWorld(rng('gq-impossible'), 1, impossible), /no certified world/);
});

test('fuzz: engine state matches the abstract model after random legal play', () => {
  for (const d of DIFFS) for (const seed of SEEDS.slice(0, 12)) {
    const t = gen(seed, d);
    const Wd = W(t), m = compile(Wd.w);
    const R = rng('fuzz', seed, d);
    const env = makeEnv(Wd.w, 10_000);
    const acts = [];
    for (let i = 0; i < 300; i++) {
      const legal = env.actions().filter(a => a !== 'take treasure');
      const pref = legal.filter(a => /^(go|use|toggle|examine) /.test(a) || /^take .*key$/.test(a));
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

test('parser accepts natural variants of canonical actions and landmark aliases', () => {
  const t = gen(4, 3);
  const sol = bed.referenceSolve(t).actions;
  const vary = a => {
    let m;
    if ((m = a.match(/^go (\w+)$/))) return m[1][0];
    if ((m = a.match(/^take (.+)$/))) return `pick up the ${m[1]}`;
    if ((m = a.match(/^use (.+) on (.+)$/))) return `unlock the ${m[2]} with the ${m[1]}`;
    if ((m = a.match(/^toggle (.+)$/))) return `pull the ${ALIASES[m[1]][0]}`;
    if ((m = a.match(/^examine (.+)$/))) return `look in the ${ALIASES[m[1]][1]}`;
    return a;
  };
  const r = bed.oracle(t, { actions: sol.map(vary) });
  assert.equal(r.pass, true, JSON.stringify(r.details));
  assert.equal(r.details.steps, sol.length);
});

test('regression (AUDIT F6): the prose never contradicts the world', () => {
  for (const d of DIFFS) for (const seed of SEEDS.slice(0, 20)) {
    const t = gen(seed, d), w = W(t).w;
    for (let c = 0; c < w.n * w.n; c++) {
      const ex = exitsOf(w, c), room = w.rooms[c];
      // Every exit is described exactly once (its own sentence or a grouped one).
      const described = room.slots.flatMap(s => (s.k === 'exit' ? [s.dir] : s.k === 'group' ? s.dirs : []));
      assert.deepEqual([...described].sort(), Object.keys(ex).sort(), `${t.id} room ${c}`);
      for (const s of room.slots) {
        // "No way through" noise and fake exits only on walls without an exit.
        if (s.k === 'text' && s.closed) assert.equal(ex[DIR_OF_ADJ[s.wall]], undefined, `${t.id} noise on an exit wall`);
        if (s.k === 'fakeexit') assert.equal(ex[s.dir], undefined, `${t.id} fake exit on an exit wall`);
        if (s.k === 'exit' && s.reopen !== undefined) assert.equal(w.edges[s.edge].kind, 'open');
        if (s.k !== 'exit' || !s.land) continue;
        // Landmark frames resolve to the exit's real direction, and the landmark states its wall.
        const want = s.land.rel === 'same' ? s.dir : OPP[s.dir];
        assert.equal(markDir(w, s.land), want, `${t.id} landmark for ${s.dir}`);
        const root = s.land.type === 'obj' && w.objects[s.land.ref].relTo ? w.objects[s.land.ref].relTo : s.land;
        if (root.type === 'obj') assert.ok(OBJ_WALL_V.includes(w.objects[root.ref].v) && !w.objects[root.ref].relTo);
        else assert.ok(SWITCH_WALL_V.includes(w.switches[root.ref].place));
        if (s.land.type === 'obj' && w.objects[s.land.ref].relTo) assert.ok(OBJ_REL_T[w.objects[s.land.ref].relTo.relV]);
        assert.equal(w.objects.concat(w.switches).filter(x => x.room === c).length >= 1, true);
      }
    }
  }
});

test('regression (AUDIT F6): aliases are unambiguous; articles agree', () => {
  const nouns = [...DECOR.map(x => x.noun), ...CONTAINERS.map(x => x.noun), ...SWITCH_NOUNS];
  assert.deepEqual(Object.keys(ALIASES).sort(), [...nouns].sort(), 'every fixed noun has aliases');
  const all = Object.values(ALIASES).flat();
  assert.equal(new Set(all).size, all.length, 'aliases unique');
  const reserved = new Set([...nouns, ...DECOY_ITEMS.map(x => x.name), 'door', 'treasure', 'key', 'north', 'south', 'east', 'west']);
  for (const a of all) assert.ok(!reserved.has(a), a);
  // Grammar: "a" before a vowel sound / "an" before a consonant never appears (v1 printed "a oak door").
  for (const d of DIFFS) for (const seed of SEEDS.slice(0, 15)) {
    const t = gen(seed, d), w = W(t).w;
    for (let c = 0; c < w.n * w.n; c++) {
      const st0 = { ...initialState(w), pos: c };
      const open = { ...st0, unlocked: w.doors.map((_, i) => i), revealed: w.hides.map((_, i) => i), mech: w.mechs.map(m => !m.open0) };
      const env = makeEnv(w, 9999);
      env.restore({ st: { ...open, inv: [] }, last: '' });
      const things = [...w.objects.filter(o => o.room === c).map(o => o.noun), ...w.switches.filter(x => x.room === c).map(x => x.noun), 'north door', 'east door', 'south door', 'west door'];
      const examined = things.map(n => env.step(`examine ${n}`).observation.split('\n').find(l => l.startsWith('Last action:')));
      const text = `${describeRoom(w, st0, c)} ${describeRoom(w, open, c)} ${examined.join(' ')}`;
      assert.ok(!/\b[Aa] (?!one\b)[aeiou]/.test(text), `${t.id} room ${c}: ${text.match(/\b[Aa] (?!one\b)[aeiou]\w*/)?.[0]}`);
      assert.ok(!/\b[Aa]n [b-df-hj-np-tv-z]/.test(text), `${t.id} room ${c}`);
    }
  }
});

test('regression (AUDIT F5): journal reliability cannot be read off the wording', () => {
  // For each true-note template there are also false notes with the same wording.
  const shape = text => text.replace(/the [A-Z][\w ]+?(?=[.,])/g, 'ROOM').replace(/\b(crimson|amber|jade|cobalt|violet|ivory|onyx|saffron)\b/g, 'COLOR')
    .replace(/\b(lever|wheel|crank|winch|handle|chain|chute|ledge|turnstile|hatch)\b/g, 'THING');
  const seen = new Map();
  for (const d of [3, 4, 5]) for (const seed of SEEDS) for (const e of W(gen(seed, d)).w.journal) {
    if (e.injection) continue;
    const k = shape(e.text);
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k).add(e.reliable);
  }
  const mixed = [...seen.values()].filter(s => s.size === 2).length;
  const trueOnly = [...seen.entries()].filter(([, s]) => s.size === 1 && s.has(true)).map(([k]) => k);
  assert.ok(mixed >= 4, `templates with both true and false notes: ${mixed}`);
  assert.deepEqual(trueOnly, [], 'no template is always true');
});

test('difficulty sanity: grid size, plan length, prose volume and adversarial content grow with difficulty', () => {
  const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const rows = DIFFS.map(d => {
    const ts = SEEDS.slice(0, 12).map(seed => gen(seed, d));
    const roomText = ts.map(t => W(t).w.rooms.map(r => r.slots.filter(s => s.k === 'text').map(s => s.text).join(' ')).join(' '));
    const slots = ts.flatMap(t => W(t).w.rooms.flatMap(r => r.slots));
    const exits = slots.filter(s => s.k === 'exit');
    return {
      d,
      n: ts[0].inputs.grid.rows,
      opt: avg(ts.map(t => W(t).optimal)),
      tok: avg(ts.map(t => estimateTokens(t.prompt) + estimateTokens(t.inputs))),
      inject: ts.filter((t, i) => INJECTIONS.some(x => roomText[i].includes(x))).length,
      journal: avg(ts.map(t => (t.inputs.journal || []).length)),
      sky: ts.filter(t => W(t).w.rooms.some(r => r.slots.some(s => s.sky))).length,
      land: exits.filter(s => s.land).length / exits.length,
      fake: slots.filter(s => s.k === 'fakeexit').length,
    };
  });
  assert.deepEqual(rows.map(r => r.n), [3, 4, 5, 6, 7]);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].opt > rows[i - 1].opt, `optimal length grows d${i + 1}`);
    assert.ok(rows[i].tok >= rows[i - 1].tok, `prompt+inputs grow d${i + 1}`);
    assert.ok(rows[i].fake > rows[i - 1].fake, `fake exits grow d${i + 1}`);
  }
  assert.equal(rows[0].land + rows[0].fake, 0, 'difficulty 1 is plain compass prose');
  assert.ok(rows[2].land >= 0.35, `d3 landmark share ${rows[2].land}`);
  assert.equal(rows[0].inject + rows[1].inject + rows[2].inject, 0);
  assert.equal(rows[3].inject, 12);
  assert.equal(rows[4].inject, 12);
  assert.equal(rows[0].journal + rows[1].journal, 0);
  assert.ok(rows[2].journal >= 4 && rows[4].journal >= 9);
  assert.ok(rows[4].sky >= 10, 'sky directions appear at d5');
  assert.equal(rows[2].sky, 0);
  assert.ok(PROSE_LEVELS[3].land > 0 && PROSE_LEVELS[3].alias > 0);
});

test('regression (AUDIT F7): heuristic scripts stay below 20% at difficulty 3 (30 seeds each split)', () => {
  const rate = (agent, d, split) => SEEDS.filter(seed => {
    const t = gen(seed, d, split);
    return bed.oracle(t, agent(bed.createEnv(t), t.budget.actions)).pass;
  }).length / SEEDS.length;
  for (const split of ['dev', 'test']) {
    for (const [name, agent] of [['blind', blindAgent], ['regex v1', regexAgent], ['regex v2', regexAgentV2], ['keyword', keywordAgent]]) {
      const r = rate(agent, 3, split);
      assert.ok(r < 0.2, `${name} passes ${r} of d3 ${split}`);
    }
  }
  // The regex agents are competent where the prose is plain: they solve difficulty 1.
  assert.ok(rate(regexAgent, 1, 'dev') >= 0.9);
  assert.ok(rate(regexAgentV2, 1, 'dev') >= 0.9);
});

test('runtime limits: generate and oracle well under 2 s and 200 MB at difficulty 5 (fresh process)', () => {
  // Measured in a child process so the number is the bed's, not this test runner's.
  const script = `
    const bed = await import(${JSON.stringify(new URL('./index.mjs', import.meta.url).href)});
    let gen = 0, ora = 0;
    for (const seed of [101, 202, 303, 404, 505]) {
      let t0 = performance.now();
      const t = bed.generate({ seed: 'fresh-' + seed, split: 'test', difficulty: 5 });
      gen = Math.max(gen, performance.now() - t0);
      t0 = performance.now();
      bed.oracle(t, { actions: Array.from({ length: 2000 }, (_, i) => ['go north', 'go east', 'examine chest', 'x'.repeat(200)][i % 4]) });
      bed.oracle(t, bed.badControls.find(c => c.name === 'random-walk').make(t));
      ora = Math.max(ora, performance.now() - t0);
    }
    console.log(JSON.stringify({ gen, ora, rss: process.memoryUsage().rss }));`;
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  assert.ok(out.gen < 2000, `generate ${out.gen} ms`);
  assert.ok(out.ora < 2000, `oracle ${out.ora} ms`);
  assert.ok(out.rss < 200 * 1024 * 1024, `rss ${out.rss}`);
});
