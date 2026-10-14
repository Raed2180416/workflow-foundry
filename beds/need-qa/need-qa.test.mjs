// need-qa bed tests (node:test, built-ins only). Development seeds 601-640 only; nothing here is held-out evidence.
//   node --test beds/need-qa/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as bed from './index.mjs';
import { solveFromView } from './view-solver.mjs';
import { compareAnswer, numberTokens, normText } from './core.mjs';
import { canonical } from '../lib/canonical.mjs';

const SEEDS = Array.from({ length: 40 }, (_, i) => 601 + i);
const DIFFICULTIES = [1, 2, 3, 4, 5];
const SUBTYPES = ['ledger', 'lookup', 'calendar', 'convert'];
const gen = (seed, difficulty, extra = {}) => bed.generate({ seed, split: 'dev', difficulty, ...extra });
const tokensCompact = task => Math.ceil(Buffer.byteLength(JSON.stringify(task.inputs ?? {}) + String(task.prompt)) / 4);               // the need-router formula
const tokensPretty = task => Math.ceil(Buffer.byteLength([task.prompt, '', '## inputs.json', '```json', JSON.stringify(task.inputs, null, 1), '```'].join('\n')) / 4);   // what a single-call arm is shown
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const corr = (xs, ys) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};

test('contract: family, schema (portable subset), exports', () => {
  assert.equal(bed.family.id, 'need-qa');
  assert.equal(bed.family.version, '1.0.0');
  assert.equal(bed.family.kind, 'oneshot');
  assert.equal(bed.family.role, 'need-anchor');
  assert.ok(bed.family.domain && bed.family.description);
  assert.match(bed.family.description, /[Hh]ypothesis/);
  for (const fn of ['generate', 'oracle', 'referenceSolve']) assert.equal(typeof bed[fn], 'function');
  const forbidden = new Set(['pattern', 'oneOf', 'uniqueItems', '$ref', 'format']);
  const walk = s => { if (s && typeof s === 'object') for (const [k, v] of Object.entries(s)) { assert.ok(!forbidden.has(k), `schema uses ${k}`); walk(v); } };
  walk(bed.outputSchema);
  const names = bed.badControls.map(c => c.name);
  assert.ok(names.includes('empty'));
  assert.ok(names.includes('shuffled-or-corrupted'));
  assert.ok(names.some(n => n.startsWith('plausible-but-wrong')));
  assert.ok(bed.badControls.every(c => typeof c.make === 'function'));
});

test('task shape: contract fields only, JSON-serialisable, no knobs on default tasks', () => {
  for (const d of DIFFICULTIES) {
    const task = gen(601 + d, d);
    assert.deepEqual(Object.keys(task).sort(), ['budget', 'difficulty', 'family', 'id', 'inputs', 'prompt', 'seed', 'split']);
    assert.equal(task.family, 'need-qa');
    assert.equal(task.id, `need-qa/dev/d${d}/${601 + d}`);
    assert.equal(typeof task.prompt, 'string');
    assert.deepEqual(JSON.parse(JSON.stringify(task)), task);
    assert.match(task.prompt, /\{"answer":/);                       // the output form is stated
  }
});

test('determinism: repeated generation is byte-identical, fresh objects, split and seed matter', () => {
  for (const d of DIFFICULTIES) for (const seed of SEEDS.slice(0, 12)) {
    const a = gen(seed, d), b = gen(seed, d);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(canonical(a), canonical(b));
  }
  const t = gen(610, 3);
  const before = JSON.stringify(t);
  t.inputs = null; t.prompt = 'mutated';                              // callers cannot corrupt later generations
  assert.equal(JSON.stringify(gen(610, 3)), before);
  assert.notEqual(canonical(gen(610, 3)), canonical(bed.generate({ seed: 610, split: 'test', difficulty: 3 })));
  assert.notEqual(canonical(gen(610, 3)), canonical(gen(611, 3)));
  assert.notEqual(canonical(gen(610, 3)), canonical(gen(610, 4)));
  // the oracle is deterministic too
  const out = bed.referenceSolve(t0());
  assert.equal(JSON.stringify(bed.oracle(t0(), out)), JSON.stringify(bed.oracle(t0(), out)));
  function t0() { return gen(615, 4); }
});

test('argument validation', () => {
  assert.throws(() => bed.generate({ seed: 1.5, split: 'dev', difficulty: 3 }), /seed/);
  assert.throws(() => bed.generate({ seed: 1, split: 'val', difficulty: 3 }), /split/);
  for (const difficulty of [0, 6, 2.5, '3', null]) assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty }), /difficulty/);
  assert.throws(() => gen(1, 3, { size: 0 }), /size/);
  assert.throws(() => gen(1, 3, { steps: 6 }), /steps/);
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 3, size: '2' }), /size/);
});

test('subtypes: all four occur across seeds 601-640 at every difficulty (both splits), independent of difficulty', () => {
  for (const split of ['dev', 'test']) for (const d of DIFFICULTIES) {
    const counts = Object.fromEntries(SUBTYPES.map(s => [s, 0]));
    for (const seed of SEEDS) {
      const info = bed.describeTask(bed.generate({ seed, split, difficulty: d }));
      counts[info.subtype]++;
      assert.equal(info.subtype, bed.subtypeOf(seed, split));
    }
    for (const s of SUBTYPES) assert.ok(counts[s] >= 8, `${split} d${d}: ${s} occurred ${counts[s]} times`);
  }
  for (const seed of SEEDS) assert.equal(new Set(DIFFICULTIES.map(d => bed.describeTask(gen(seed, d)).subtype)).size, 1);   // a seed keeps its subtype across difficulties
  assert.deepEqual([...bed.SUBTYPES].sort(), [...SUBTYPES].sort());
});

test('referenceSolve passes for 40 seeds at every difficulty, with score 1', () => {
  for (const d of DIFFICULTIES) {
    let passes = 0;
    for (const seed of SEEDS) {
      const task = gen(seed, d);
      const result = bed.oracle(task, bed.referenceSolve(task));
      assert.equal(result.pass, true, `${task.id}: ${JSON.stringify(result.details)}`);
      assert.equal(result.score, 1);
      passes++;
    }
    assert.ok(passes >= 20);
  }
});

test('every bad control fails for 40 seeds at every difficulty; controls are schema-valid and well-typed', () => {
  for (const control of bed.badControls) for (const d of DIFFICULTIES) {
    let failures = 0;
    for (const seed of SEEDS) {
      const task = gen(seed, d);
      const output = control.make(task);
      const result = bed.oracle(task, output);
      assert.equal(result.pass, false, `${control.name} passed on ${task.id}`);
      assert.equal(result.score, 0);
      failures++;
      if (control.name !== 'empty') assert.equal(result.details.schemaErrors, undefined, `${control.name} on ${task.id} is schema-invalid, so it only tests the schema`);
    }
    assert.ok(failures >= 20, `${control.name} d${d}`);
  }
  // a near miss is the same JSON type as the truth: a near miss that were a different type would be a weaker control
  for (const d of DIFFICULTIES) for (const seed of SEEDS) {
    const task = gen(seed, d), ref = bed.referenceSolve(task).answer;
    for (const name of ['plausible-but-wrong:first-near-miss', 'plausible-but-wrong:last-near-miss', 'plausible-but-wrong:off-by-one']) {
      assert.equal(typeof bed.badControls.find(c => c.name === name).make(task).answer, typeof ref, `${name} on ${task.id}`);
    }
  }
});

test('near misses: every task has at least one, and across the seeds each subtype shows its characteristic mistakes', () => {
  const names = Object.fromEntries(SUBTYPES.map(s => [s, new Set()]));
  for (const d of DIFFICULTIES) for (const seed of SEEDS) {
    const info = bed.describeTask(gen(seed, d));
    assert.ok(info.nearMisses.length >= 1);
    for (const n of info.nearMisses) names[info.subtype].add(n);
  }
  const has = (s, re) => [...names[s]].some(n => re.test(n));
  assert.ok(has('ledger', /^boundary-off-by-one$/) && has('ledger', /^dropped-.*-filter$/) && has('ledger', /^forgot-price$/));
  assert.ok(has('lookup', /^same-client-other-parcel$/) && has('lookup', /^adjacent-port-row$/) && has('lookup', /^kept-excluded-status$/) && has('lookup', /^ignored-region$/));
  assert.ok(has('calendar', /^start-counted-as-day-1$/) && has('calendar', /^ignored-festivals$/) && has('calendar', /^forgot-leap-day$/));
  assert.ok(has('convert', /^one-relation-read-backwards$/) && has('convert', /^truncated-not-rounded$/) && has('convert', /^ignored-.*-filter$/));
});

test('schema-invalid output is rejected, even when it contains the right answer', () => {
  for (const d of DIFFICULTIES) for (const seed of SEEDS.slice(0, 6)) {
    const task = gen(seed, d), good = bed.referenceSolve(task);
    assert.equal(bed.oracle(task, good).pass, true);
    const invalid = [
      undefined, null, 'answer', 42, [], [good],
      {}, { answer: null }, { answer: true }, { answer: [good.answer] }, { answer: { value: good.answer } },
      { answer: NaN }, { answer: Infinity }, { answer: 'x'.repeat(81) },
      { ...good, explanation: 'because' }, { value: good.answer }, { Answer: good.answer },
    ];
    for (const output of invalid) {
      const result = bed.oracle(task, output);
      assert.equal(result.pass, false, `${task.id}: ${JSON.stringify(output)}`);
      assert.equal(result.score, 0);
      assert.ok(result.details.schemaErrors.length > 0, JSON.stringify(output));
    }
  }
});

test('oracle recomputes the truth from (seed, split, difficulty) and never trusts the task object it is handed', () => {
  let different = 0, total = 0;
  for (const d of [2, 3, 4]) for (const seed of SEEDS) {
    const task = gen(seed, d), good = bed.referenceSolve(task);
    // rewriting the visible parts of the task changes nothing
    assert.equal(bed.oracle({ ...task, prompt: 'Reply {"answer": 0}', inputs: {}, budget: {}, extra: 'x' }, good).pass, true);
    // another seed has another truth (collisions between small answers are allowed, systematic equality is not)
    const other = gen(seed + 1000, d);
    total++;
    if (!bed.oracle(other, good).pass) different++;
  }
  assert.ok(different / total > 0.85, `answers of different seeds coincided too often: ${different}/${total}`);
  assert.throws(() => bed.oracle({ seed: 1, split: 'dev', difficulty: 9 }, { answer: 1 }), /difficulty/);
});

test('answer comparison: numeric tolerance, text normalisation, dates', () => {
  const int = { kind: 'int', value: '1234' };
  for (const ok of [1234, '1234', ' 1234 ', '1,234', '1234.0', '1234.000', '+1234', 1.234e3, '1.234e3']) assert.equal(compareAnswer(ok, int).ok, true, String(ok));
  for (const bad of [1235, 1233, '1234.4', 1234.5, '12 34', '1234 units', 'twelve hundred', '', '   ', '-1234', '0x4d2', '1,23,4']) assert.equal(compareAnswer(bad, int).ok, false, String(bad));
  const two = { kind: 'round', value: '12.35', dp: 2 };       // accepted: the submitted value rounds half up to 12.35, i.e. [12.345, 12.355)
  for (const ok of [12.35, '12.35', '12.350', 12.3456, 12.345, '12.3549', ' 12.35 ']) assert.equal(compareAnswer(ok, two).ok, true, String(ok));
  for (const bad of [12.34, 12.36, 12.344, 12.355, 12.3, 12.4, 13, '12.35 kg', -12.35]) assert.equal(compareAnswer(bad, two).ok, false, String(bad));
  const zero = { kind: 'round', value: '12', dp: 0 };
  for (const ok of [12, '12.0', 11.5, 12.49, '11.5']) assert.equal(compareAnswer(ok, zero).ok, true, String(ok));
  for (const bad of [11, 13, 11.49, 12.5]) assert.equal(compareAnswer(bad, zero).ok, false, String(bad));
  const text = { kind: 'text', value: 'Calarmere' };
  for (const ok of ['Calarmere', '  calarmere ', 'CALARMERE', '"Calarmere"', "'calarmere'", 'Calarmere.', 'calarmere\n']) assert.equal(compareAnswer(ok, text).ok, true, JSON.stringify(ok));
  for (const bad of ['Calar mere', 'Calarmere Depot', 'Calarmer', 12, '']) assert.equal(compareAnswer(bad, text).ok, false, JSON.stringify(bad));
  const date = { kind: 'date', value: 'Aldemere 5, year 301' };
  for (const ok of ['Aldemere 5, year 301', 'aldemere 5 301', ' ALDEMERE 5, 301 ', 'Aldemere 05, year 301']) assert.equal(compareAnswer(ok, date).ok, true, ok);
  for (const bad of ['Aldemere 6, year 301', 'Aldemere 5, year 300', 'Brinmere 5, year 301', '5 Aldemere 301', '301-1-5', 5, 'Aldemere']) assert.equal(compareAnswer(bad, date).ok, false, String(bad));
  assert.equal(normText('  A  b\tC. '), 'a b c');
});

test('difficulty knob: size and token budget grow with difficulty, difficulty 5 stays under 2K tokens', () => {
  const medians = {};
  for (const sub of SUBTYPES) medians[sub] = [];
  for (const d of DIFFICULTIES) {
    const bySub = Object.fromEntries(SUBTYPES.map(s => [s, []]));
    for (const seed of SEEDS) {
      const task = gen(seed, d);
      const info = bed.describeTask(task);
      assert.equal(info.size, d);
      assert.equal(info.steps, d);
      assert.ok(tokensCompact(task) < 2000 && tokensPretty(task) < 2000, `${task.id}: ${tokensCompact(task)} / ${tokensPretty(task)} tokens`);
      assert.equal(task.budget.inputTokensEstimate, tokensCompact(task));
      bySub[info.subtype].push(tokensCompact(task));
    }
    for (const sub of SUBTYPES) medians[sub].push(median(bySub[sub]));
  }
  for (const sub of SUBTYPES) {
    for (let i = 1; i < 5; i++) assert.ok(medians[sub][i] > medians[sub][i - 1], `${sub} median tokens not increasing: ${medians[sub]}`);
    assert.ok(medians[sub][0] < 400, `${sub} d1 should be tiny: ${medians[sub][0]}`);
    assert.ok(medians[sub][4] < 1500, `${sub} d5: ${medians[sub][4]}`);
  }
});

test('difficulty knob: question load (steps) grows with difficulty', () => {
  const words = Object.fromEntries(SUBTYPES.map(s => [s, DIFFICULTIES.map(() => [])]));
  for (const d of DIFFICULTIES) for (const seed of SEEDS) {
    const task = gen(seed, d);
    words[bed.describeTask(task).subtype][d - 1].push(task.prompt.split('\n').find(l => l.startsWith('Question:')).split(/\s+/).length);
  }
  for (const sub of SUBTYPES) {
    const mean = d => words[sub][d - 1].reduce((a, b) => a + b, 0) / words[sub][d - 1].length;
    // not monotone level by level (a count question is shorter than a "date of the Nth business day" question, a conversion total shorter than a single-item question), but clearly longer at the top
    assert.ok(mean(5) > mean(1) + 8, `${sub}: question words ${mean(1)} -> ${mean(5)}`);
  }
  // ledger: the number of filters in the question follows the knob
  const filters = d => SEEDS.map(seed => gen(seed, d)).filter(t => bed.describeTask(t).subtype === 'ledger').map(t => t.prompt.match(/where (.*?), (?:what|which)/)[1].split(' and ').length);
  assert.ok(filters(1).every(n => n === 1));
  assert.ok(filters(2).every(n => n === 2));
  assert.ok(filters(4).every(n => n === 3));
  assert.ok(filters(5).every(n => n === 2 || n === 3));
});

test('truth does not leak into prompt, inputs or budget', () => {
  const forbiddenKey = /^(answer|truth|solution|expected|reference|oracle|near|alternatives?)$/i;
  const keysOf = v => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
  let derivedChecked = 0, lookupChecked = 0;
  for (const d of DIFFICULTIES) for (const seed of SEEDS) {
    const task = gen(seed, d);
    const info = bed.describeTask(task);
    assert.ok(!keysOf(task.inputs).some(k => forbiddenKey.test(k)), `${task.id} has a truth-like key`);
    assert.deepEqual(Object.keys(task.budget).sort(), ['inputTokensEstimate', 'suggestedOutputTokens']);
    const visible = `${task.prompt}\n${JSON.stringify(task.inputs)}`;
    const answer = bed.referenceSolve(task).answer;
    if (info.derived && typeof answer === 'number') {
      if (!Number.isInteger(answer) || Math.abs(answer) >= 100) {
        assert.ok(!numberTokens(visible).has(String(answer)), `${task.id}: derived answer ${answer} is visible in the task`);
        derivedChecked++;
      }
    } else if (info.derived && info.kind === 'date') {
      assert.ok(!visible.toLowerCase().includes(String(answer).toLowerCase()), `${task.id}: derived date visible`);
      derivedChecked++;
    } else if (typeof answer === 'string' && info.subtype !== 'calendar') {
      // a lookup answer lives in the data (answerable) but is never named by the question
      assert.ok(JSON.stringify(task.inputs).includes(`"${answer}"`), `${task.id}: lookup answer not in the data`);
      assert.ok(!normText(task.prompt).includes(normText(answer)), `${task.id}: question names the lookup answer`);
      lookupChecked++;
    } else if (typeof answer === 'string') {
      assert.ok(task.inputs.calendar.weekdays.includes(answer));
    }
  }
  assert.ok(derivedChecked > 80, `only ${derivedChecked} derived answers were checkable`);
  assert.ok(lookupChecked > 5, `only ${lookupChecked} lookup answers were checkable`);
});

test('no adversarial text: prompts are templated, three lines, and inputs hold only data', () => {
  for (const d of DIFFICULTIES) for (const seed of SEEDS) {
    const task = gen(seed, d);
    const lines = task.prompt.split('\n');
    assert.equal(lines.length, 3);
    assert.ok(lines[1].startsWith('Question: '));
    assert.ok(lines[2].startsWith('Reply with only a JSON object {"answer":'));
    assert.ok(!/ignore|disregard|previous instructions|system prompt/i.test(JSON.stringify(task.inputs)));
  }
});

test('independent check: a solver that reads only prompt + inputs reproduces the oracle truth', () => {
  // 40 seeds x 5 difficulties x (default, long-and-shallow, short-and-deep) on both splits
  for (const split of ['dev', 'test']) for (const d of DIFFICULTIES) for (const seed of SEEDS) {
    for (const extra of [{}, { size: 5, steps: 1 }, { size: 1, steps: 5 }]) {
      const task = bed.generate({ seed, split, difficulty: d, ...extra });
      const result = bed.oracle(task, solveFromView(task));
      assert.equal(result.pass, true, `${task.id}: ${JSON.stringify(solveFromView(task))} ${JSON.stringify(result.details)}`);
    }
  }
});

test('shortcut breakers: size and steps can be pulled apart; length tracks size, not steps', () => {
  // default knobs are the coupled case
  for (const d of DIFFICULTIES) for (const seed of SEEDS.slice(0, 8)) assert.equal(canonical(gen(seed, d)), canonical(gen(seed, d, { size: d, steps: d })));
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const grid = [];
  for (let size = 1; size <= 5; size++) for (let steps = 1; steps <= 5; steps++) for (const seed of SEEDS) {
    const task = gen(seed, 3, { size, steps });
    const info = bed.describeTask(task);
    assert.equal(info.size, size);
    assert.equal(info.steps, steps);
    if (size === 3 && steps === 3) assert.equal(task.knobs, undefined);   // the coupled setting carries no override
    else assert.deepEqual(task.knobs, { size, steps });
    assert.equal(info.subtype, bed.subtypeOf(seed, 'dev'));          // the same seed keeps its subtype whatever the knobs
    assert.ok(tokensCompact(task) < 2000 && tokensPretty(task) < 2000);
    grid.push({ size, steps, tokens: tokensCompact(task), subtype: info.subtype, questionWords: task.prompt.split('\n')[1].split(/\s+/).length });
  }
  // across the grid, length follows size and is nearly independent of steps (steps is carried by the question text)
  assert.ok(corr(grid.map(g => g.size), grid.map(g => g.tokens)) > 0.8);
  assert.ok(Math.abs(corr(grid.map(g => g.steps), grid.map(g => g.tokens))) < 0.2);
  for (const sub of SUBTYPES) {
    const rows = grid.filter(g => g.subtype === sub);
    assert.ok(corr(rows.map(g => g.steps), rows.map(g => g.questionWords)) > 0.7, `${sub}: question length should follow steps`);
    // same structure (steps 3), very different length
    const short = mean(rows.filter(g => g.steps === 3 && g.size === 1).map(g => g.tokens)), long = mean(rows.filter(g => g.steps === 3 && g.size === 5).map(g => g.tokens));
    assert.ok(long > 2.2 * short, `${sub}: ${short} vs ${long}`);
    // same length (size 3), different structure
    const shallow = mean(rows.filter(g => g.size === 3 && g.steps === 1).map(g => g.tokens)), deep = mean(rows.filter(g => g.size === 3 && g.steps === 5).map(g => g.tokens));
    assert.ok(deep / shallow < 1.25, `${sub}: ${shallow} vs ${deep}`);
  }
});

test('knob shapes keep the oracle healthy: reference passes and every control fails', () => {
  for (const extra of [{ size: 5, steps: 1 }, { size: 1, steps: 5 }, { size: 1, steps: 1 }, { size: 5, steps: 5 }]) {
    for (const seed of SEEDS.slice(0, 24)) {
      const task = gen(seed, 3, extra);
      assert.equal(task.id, `need-qa/dev/d3/${seed}/size${extra.size}-steps${extra.steps}`);
      assert.equal(bed.oracle(task, bed.referenceSolve(task)).pass, true, task.id);
      for (const control of bed.badControls) assert.equal(bed.oracle(task, control.make(task)).pass, false, `${control.name} on ${task.id}`);
    }
  }
});

test('performance: generate and oracle stay well under 2 s at difficulty 5', () => {
  let worstGenerate = 0, worstOracle = 0;
  for (const seed of SEEDS) {
    const t0 = performance.now();
    const task = gen(seed, 5);
    const t1 = performance.now();
    bed.oracle(task, bed.referenceSolve(task));
    const t2 = performance.now();
    worstGenerate = Math.max(worstGenerate, t1 - t0);
    worstOracle = Math.max(worstOracle, t2 - t1);
  }
  assert.ok(worstGenerate < 2000 && worstOracle < 2000, `generate ${worstGenerate.toFixed(0)} ms, oracle ${worstOracle.toFixed(0)} ms`);
});

test('generator robustness: every seed in a wide sweep yields a well-posed task at every knob setting', () => {
  // exercising the retry loop: no combination of (size, steps) may be infeasible
  for (let size = 1; size <= 5; size++) for (let steps = 1; steps <= 5; steps++) for (let seed = 1; seed <= 60; seed++) {
    const task = bed.generate({ seed, split: 'dev', difficulty: 3, size, steps });
    assert.ok(bed.describeTask(task).attempts < 400);
  }
});
