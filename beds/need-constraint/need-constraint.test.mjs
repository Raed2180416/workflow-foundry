// Tests for the need-constraint bed (node:test, Node 24, built-ins only). Dev seeds 601-640 only.
// Routing anchor for the need router (experiments/need-router), not a Tier-A bed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens } from '../lib/canonical.mjs';
import { rng } from '../lib/rng.mjs';
import { family, outputSchema, generate, oracle, referenceSolve, altSolve, badControls, validateOutput, subtypeOf, SUBTYPES, FIELD } from './index.mjs';
import { build, KNOBS, MIN_ORDER_SOLUTIONS, VERSION, renderConstraint } from './gen.mjs';
import { checkNames, checkSentence, checkOrder, checkSchedule, embeds, tokenize } from './check.mjs';
import { solveOrder, solveSchedule } from './solve.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const SEEDS = Array.from({ length: 40 }, (_, i) => 601 + i); // dev seeds 601-640
const cache = new Map();
const taskOf = (seed, difficulty, split = 'dev') => {
  const key = `${split}|${seed}|${difficulty}`;
  if (!cache.has(key)) cache.set(key, generate({ seed, split, difficulty }));
  return cache.get(key);
};
const seedsOf = sub => SEEDS.filter(s => subtypeOf(s) === sub);
const clone = v => JSON.parse(JSON.stringify(v));

// Portable schema subset (beds/CONTRACT.md): no pattern / oneOf / uniqueItems / $ref / format.
const PORTABLE = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'description', 'const']);
function nonPortableKeys(node, path = '#') {
  const bad = [];
  for (const [k, v] of Object.entries(node)) {
    if (!PORTABLE.has(k)) bad.push(`${path}/${k}`);
    if (k === 'properties') for (const [name, child] of Object.entries(v)) bad.push(...nonPortableKeys(child, `${path}/properties/${name}`));
    if (k === 'items' || (k === 'additionalProperties' && typeof v === 'object')) bad.push(...nonPortableKeys(v, `${path}/${k}`));
  }
  return bad;
}

// ================================================================== independent validators
// Re-implementations that read ONLY the rendered task (prompt + inputs). They share no code with check.mjs or solve.mjs.
// Differential testing against them shows (1) the text states exactly the rules the oracle enforces and (2) the oracle
// accepts any answer these independent readings accept, not only the solver's.
const letterList = s => s.split(', ').map(x => x.toLowerCase());

function indepNames(task, out) {
  const p = task.prompt;
  const n = Number(p.match(/Invent exactly (\d+) product names/)[1]);
  const [, lo, hi] = p.match(/between (\d+) and (\d+) letters long/).map(Number).map((x, i) => (i ? x : 0));
  const grab = re => (p.match(re) ?? [])[1] ?? null;
  const start = grab(/begins with one of these letters: ([A-Z, ]+)\./); const end = grab(/ends with one of these letters: ([A-Z, ]+)\./);
  const must = grab(/contains the letter ([A-Z]) at least once\./); const ban = grab(/any of these letters \(in either case\): ([A-Z, ]+)\./);
  const forb = [...(grab(/letter sequences \(in either case\) anywhere inside it: ((?:"[a-z]+"(?:, )?)+)\./) ?? '').matchAll(/"([a-z]+)"/g)].map(m => m[1]);
  const rep = grab(/No letter occurs more than (\d+) times/); const vow = p.match(/between (\d+) and (\d+) vowels/);
  const distinctInit = /No two names begin with the same letter/.test(p); const mw = p.match(/At least (\d+) of the names contain the letter ([A-Z])/);
  const reserved = new Set(task.inputs.reserved_names.map(x => x.toLowerCase()));
  const names = out.names.map(x => x.trim());
  if (names.length !== n) return false;
  const seen = new Set(); const initials = new Set(); let withLetter = 0;
  for (const nm of names) {
    for (const ch of nm) if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'))) return false;
    const w = nm.toLowerCase();
    if (w.length < lo || w.length > hi) return false;
    if (start && !letterList(start).includes(w[0])) return false;
    if (end && !letterList(end).includes(w[w.length - 1])) return false;
    if (must && !w.includes(must.toLowerCase())) return false;
    if (ban && letterList(ban).some(l => w.includes(l))) return false;
    if (forb.some(f => w.includes(f))) return false;
    if (rep) { const tally = {}; for (const ch of w) tally[ch] = (tally[ch] || 0) + 1; if (Object.values(tally).some(v => v > Number(rep))) return false; }
    if (vow) { let v = 0; for (const ch of w) if ('aeiou'.includes(ch)) v++; if (v < Number(vow[1]) || v > Number(vow[2])) return false; }
    if (reserved.has(w) || seen.has(w)) return false;
    seen.add(w);
    if (distinctInit) { if (initials.has(w[0])) return false; initials.add(w[0]); }
    if (mw && w.includes(mw[2].toLowerCase())) withLetter++;
  }
  return !mw || withLetter >= Number(mw[1]);
}

function indepSentence(task, out) {
  const p = task.prompt; const s = out.sentence.trim();
  const [, lo, hi] = p.match(/between (\d+) and (\d+) words, inclusive/).map(Number);
  const req = task.inputs.required_words; const forb = new Set(task.inputs.forbidden_words);
  if (!/^[A-Z]/.test(s) || s[s.length - 1] !== '.') return false;
  const body = s.slice(0, -1);
  const parts = body.split(' ');
  const words = [];
  for (let i = 0; i < parts.length; i++) {
    let w = parts[i];
    if (w.endsWith(',')) { if (i === parts.length - 1) return false; w = w.slice(0, -1); }
    if (!w.length) return false;
    for (const ch of w) if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'))) return false;
    words.push(w.toLowerCase());
  }
  if (words.length < lo || words.length > hi) return false;
  const gapM = p.match(/at least (\d+) other words? between/); const gap = gapM ? Number(gapM[1]) : 0;
  const place = (j, from) => { if (j === req.length) return true; for (let i = from; i < words.length; i++) if (words[i] === req[j] && place(j + 1, i + 1 + (j + 1 < req.length ? gap : 0))) return true; return false; };
  if (!place(0, 0)) return false;
  if (words.some(w => forb.has(w))) return false;
  if (/No word is used twice/.test(p) && new Set(words).size !== words.length) return false;
  const cm = p.match(/exactly (\d+) commas?\./); if (cm && (body.split(',').length - 1) !== Number(cm[1])) return false;
  const bl = p.match(/The letter ([A-Z]) does not appear/); if (bl && body.toLowerCase().includes(bl[1].toLowerCase())) return false;
  const lw = p.match(/At least one word has (\d+) or more letters/); if (lw && !words.some(w => w.length >= Number(lw[1]))) return false;
  const an = p.match(/first word is "([a-z]+)" and its last word is "([a-z]+)"/); if (an && (words[0] !== an[1] || words[words.length - 1] !== an[2])) return false;
  return true;
}

function parseOrder(task) {
  const names = '([A-Za-z]+)'; const out = [];
  const forms = [
    [new RegExp(`^${names} comes somewhere before ${names}\\.$`), m => ({ k: 'before', a: m[1], b: m[2] })],
    [new RegExp(`^${names} comes immediately before ${names}\\.$`), m => ({ k: 'next', a: m[1], b: m[2] })],
    [new RegExp(`^${names} and ${names} are not next to each other\\.$`), m => ({ k: 'apart', a: m[1], b: m[2] })],
    [new RegExp(`^${names} is first\\.$`), m => ({ k: 'at', a: m[1], at: 0 })],
    [new RegExp(`^${names} is last\\.$`), m => ({ k: 'at', a: m[1], at: -1 })],
    [new RegExp(`^${names} is in position (\\d+)\\.$`), m => ({ k: 'at', a: m[1], at: Number(m[2]) - 1 })],
    [new RegExp(`^${names} sits somewhere between ${names} and ${names}, in either direction\\.$`), m => ({ k: 'between', a: m[1], b: m[2], c: m[3] })],
    [new RegExp(`^At least (\\d+) other items? sits? between ${names} and ${names}\\.$`), m => ({ k: 'atLeast', d: Number(m[1]), a: m[2], b: m[3] })],
    [new RegExp(`^Exactly (\\d+) other items? sits? between ${names} and ${names}\\.$`), m => ({ k: 'exactly', d: Number(m[1]), a: m[2], b: m[3] })],
    [new RegExp(`^${names} is neither first nor last\\.$`), m => ({ k: 'inner', a: m[1] })],
  ];
  for (const text of task.inputs.constraints) {
    const hit = forms.map(([re, f]) => { const m = text.match(re); return m ? f(m) : null; }).filter(Boolean);
    assert.equal(hit.length, 1, `statement parses exactly one way: ${text}`);
    out.push(hit[0]);
  }
  return out;
}
function indepOrder(task, out, parsed = parseOrder(task)) {
  const items = task.inputs.items; const seq = out.order.map(x => x.trim());
  if (seq.length !== items.length) return false;
  const where = new Map(seq.map((x, i) => [x, i]));
  if (where.size !== items.length || items.some(x => !where.has(x))) return false;
  const n = seq.length; const P = x => where.get(x);
  for (const c of parsed) {
    switch (c.k) {
      case 'before': if (!(P(c.a) < P(c.b))) return false; break;
      case 'next': if (P(c.b) - P(c.a) !== 1) return false; break;
      case 'apart': if (Math.abs(P(c.a) - P(c.b)) === 1) return false; break;
      case 'at': if (P(c.a) !== (c.at === -1 ? n - 1 : c.at)) return false; break;
      case 'between': if (!((P(c.b) < P(c.a) && P(c.a) < P(c.c)) || (P(c.c) < P(c.a) && P(c.a) < P(c.b)))) return false; break;
      case 'atLeast': if (Math.abs(P(c.a) - P(c.b)) - 1 < c.d) return false; break;
      case 'exactly': if (Math.abs(P(c.a) - P(c.b)) - 1 !== c.d) return false; break;
      case 'inner': if (P(c.a) === 0 || P(c.a) === n - 1) return false; break;
      default: throw new Error('unreachable');
    }
  }
  return true;
}

function indepSchedule(task, out) {
  const I = task.inputs; const p = task.prompt; const rows = out.schedule;
  const roleOf = Object.fromEntries(I.people.map(x => [x.name, x.role]));
  const need = new Map(I.need.map(x => [`${x.day}/${x.shift}`, x.count]));
  const got = new Map(); const seenRow = new Set();
  const dayWork = new Map(); // person -> Set(day index) ; person -> Map(day -> shift)
  for (const r of rows) {
    if (!I.days.includes(r.day) || !I.shifts.includes(r.shift) || !(r.person in roleOf)) return false;
    const key = `${r.day}/${r.shift}/${r.person}`; if (seenRow.has(key)) return false; seenRow.add(key);
    const slot = `${r.day}/${r.shift}`; if (!got.has(slot)) got.set(slot, []); got.get(slot).push(r.person);
    if (!dayWork.has(r.person)) dayWork.set(r.person, new Map());
    if (dayWork.get(r.person).has(r.day)) return false; // a second shift the same day
    dayWork.get(r.person).set(r.day, r.shift);
  }
  for (const [slot, count] of need) if ((got.get(slot) ?? []).length !== count) return false;
  for (const u of I.unavailable) for (const r of rows) if (r.person === u.person && r.day === u.day && (u.shift === null || u.shift === r.shift)) return false;
  for (const lim of I.limits) { const c = rows.filter(r => r.person === lim.person).length; if (c < lim.min || c > lim.max) return false; }
  for (const [a, b] of I.never_together ?? []) for (const people of got.values()) if (people.includes(a) && people.includes(b)) return false;
  const cl = p.match(/Nobody works the last shift of a day \((\w+)\) and then the first shift of the next day \((\w+)\)/);
  if (cl) for (const [, m] of dayWork) for (let d = 1; d < I.days.length; d++) if (m.get(I.days[d - 1]) === cl[1] && m.get(I.days[d]) === cl[2]) return false;
  const leadAll = /Every slot includes at least one person whose role is "lead"/.test(p); const leadSome = p.match(/Every ([a-z]+(?: \/ [a-z]+)*) slot includes at least one person whose role is "lead"/);
  if (leadAll || leadSome) {
    const leadShifts = leadAll ? I.shifts : leadSome[1].split(' / ');
    for (const day of I.days) for (const sh of leadShifts) if (!(got.get(`${day}/${sh}`) ?? []).some(x => roleOf[x] === 'lead')) return false;
  }
  if (/A person whose role is "trainee"/.test(p)) for (const people of got.values()) if (people.some(x => roleOf[x] === 'trainee') && !people.some(x => roleOf[x] === 'lead')) return false;
  const st = p.match(/Nobody works on more than (\d+) days in a row/);
  if (st) for (const [, m] of dayWork) { let run = 0; for (const day of I.days) { run = m.has(day) ? run + 1 : 0; if (run > Number(st[1])) return false; } }
  return true;
}
const INDEP = { names: indepNames, sentence: indepSentence, order: indepOrder, schedule: indepSchedule };

// ================================================================== interface and determinism
test('interface: family metadata, portable output schema, exports', () => {
  assert.equal(family.id, 'need-constraint');
  assert.equal(family.kind, 'oneshot');
  assert.equal(family.role, 'need-anchor');
  assert.equal(family.version, '1.0.0');
  assert.equal(family.version, VERSION);
  assert.ok(family.domain && family.description);
  assert.deepEqual(nonPortableKeys(outputSchema), []);
  assert.deepEqual(Object.keys(outputSchema.properties).sort(), [...SUBTYPES].sort());
  for (const f of ['generate', 'oracle', 'referenceSolve', 'altSolve', 'validateOutput']) assert.equal(typeof { generate, oracle, referenceSolve, altSolve, validateOutput }[f], 'function');
  for (const name of ['empty', 'shuffled-or-corrupted', 'plausible-but-wrong']) assert.ok(badControls.some(c => c.name === name), name);
  assert.ok(badControls.length >= 3);
});

test('generate: bad arguments are rejected, defaults work', () => {
  assert.throws(() => generate({ seed: 1.5, split: 'dev', difficulty: 3 }), TypeError);
  assert.throws(() => generate({ seed: 601, split: 'prod', difficulty: 3 }), TypeError);
  for (const bad of [0, 6, 2.5, '3', null]) assert.throws(() => generate({ seed: 601, split: 'dev', difficulty: bad }), TypeError);
  assert.deepEqual(generate({ seed: 601 }), generate({ seed: 601, split: 'dev', difficulty: 3 }));
});

test('determinism: repeated generation is byte-identical; split and seed change the task', () => {
  for (const d of DIFFS) for (const seed of SEEDS) {
    const a = generate({ seed, split: 'dev', difficulty: d }); const b = generate({ seed, split: 'dev', difficulty: d });
    assert.equal(JSON.stringify(a), JSON.stringify(b), `seed ${seed} d${d}`);
    assert.deepEqual(a, b);
    assert.deepEqual(clone(a), a, 'task is plain JSON data');
    assert.equal(a.id, `need-constraint/dev/d${d}/s${seed}`);
    assert.deepEqual(Object.keys(a).sort(), ['budget', 'difficulty', 'family', 'id', 'inputs', 'prompt', 'seed', 'split']);
    cache.set(`dev|${seed}|${d}`, a);
  }
  for (const d of [1, 3, 5]) for (const seed of SEEDS.slice(0, 8)) {
    const dev = taskOf(seed, d); const test_ = generate({ seed, split: 'test', difficulty: d });
    assert.notEqual(JSON.stringify(dev), JSON.stringify(test_), 'split is an RNG salt');
    assert.equal(subtypeOf(seed), JSON.parse(JSON.stringify(test_)).inputs.subtype, 'split does not change the subtype');
    assert.notEqual(JSON.stringify(taskOf(seed + 4, d)), JSON.stringify(dev));
  }
  // referenceSolve / altSolve are deterministic too
  for (const seed of SEEDS.slice(0, 12)) for (const d of [2, 5]) {
    assert.equal(JSON.stringify(referenceSolve(taskOf(seed, d))), JSON.stringify(referenceSolve(generate({ seed, split: 'dev', difficulty: d }))));
    assert.equal(JSON.stringify(altSolve(taskOf(seed, d))), JSON.stringify(altSolve(taskOf(seed, d))));
  }
});

test('subtypes: dev seeds 601-640 cover the four subtypes equally; each task states its subtype', () => {
  for (const sub of SUBTYPES) assert.equal(seedsOf(sub).length, 10, sub);
  for (const d of DIFFS) for (const seed of SEEDS) assert.equal(taskOf(seed, d).inputs.subtype, subtypeOf(seed));
});

// ================================================================== oracle health
test('referenceSolve passes the oracle for every dev seed 601-640 at every difficulty', () => {
  for (const d of DIFFS) {
    let passes = 0;
    for (const seed of SEEDS) {
      const task = taskOf(seed, d); const ref = referenceSolve(task);
      assert.deepEqual(Object.keys(ref), [FIELD[subtypeOf(seed)]]);
      assert.deepEqual(validateOutput(ref, subtypeOf(seed)), []);
      const verdict = oracle(task, ref);
      assert.equal(verdict.pass, true, `seed ${seed} d${d} ${JSON.stringify(verdict.details.checks?.filter(c => !c.ok))}`);
      assert.equal(verdict.score, 1);
      passes++;
    }
    assert.ok(passes >= 20 && passes === SEEDS.length);
    for (const sub of SUBTYPES) assert.ok(seedsOf(sub).length >= 10);
  }
});

test('alternative valid answers: altSolve passes, differs from referenceSolve, and is a different stream per variant', () => {
  for (const d of DIFFS) for (const seed of SEEDS) {
    const task = taskOf(seed, d); const ref = referenceSolve(task); const alt = altSolve(task);
    assert.notEqual(JSON.stringify(alt), JSON.stringify(ref), `alt equals reference: seed ${seed} d${d}`);
    const verdict = oracle(task, alt);
    assert.equal(verdict.pass, true, `alt rejected: seed ${seed} d${d} ${JSON.stringify(verdict.details.checks?.filter(c => !c.ok))}`);
  }
  // variants 1 and 2 (names: constructive letter patterns; sentence: repeats allowed; order/schedule: randomised search)
  for (const d of DIFFS) for (const seed of SEEDS.slice(0, 20)) {
    const task = taskOf(seed, d);
    for (const v of [1, 2]) {
      const alt = altSolve(task, v);
      assert.equal(oracle(task, alt).pass, true, `variant ${v} seed ${seed} d${d}`);
      assert.notEqual(JSON.stringify(alt), JSON.stringify(referenceSolve(task)));
    }
  }
});

test('bad controls: every control fails for every dev seed at every difficulty, and near misses score as near misses', () => {
  for (const control of badControls) {
    for (const d of DIFFS) {
      let failed = 0;
      for (const seed of SEEDS) {
        const task = taskOf(seed, d); const out = control.make(task); const verdict = oracle(task, out);
        assert.equal(verdict.pass, false, `${control.name} passed: seed ${seed} d${d}`);
        assert.ok(verdict.score < 1);
        assert.equal(JSON.stringify(out) === JSON.stringify(referenceSolve(task)), false);
        if (control.name === 'plausible-but-wrong') {
          // a near miss is well-formed (schema-valid, right shape) and breaks only one or two rule groups
          assert.equal(verdict.details.schemaValid, true);
          assert.ok(verdict.details.failed.length >= 1 && verdict.details.failed.length <= 2, `near miss breaks 1-2 rule groups: ${verdict.details.failed} (seed ${seed} d${d})`);
          if (subtypeOf(seed) !== 'order') assert.ok(verdict.score >= 0.5, `near miss should be mostly right: seed ${seed} d${d} score ${verdict.score}`);
          else assert.equal(verdict.details.failed.includes('permutation'), false, 'an order near miss is still a permutation');
        }
        failed++;
      }
      assert.ok(failed >= 20, `${control.name} d${d}`);
    }
  }
  // control outputs are deterministic
  for (const control of badControls) assert.equal(JSON.stringify(control.make(taskOf(603, 4))), JSON.stringify(control.make(taskOf(603, 4))));
});

test('schema-invalid output is rejected', () => {
  const ok = { names: ['Kavro'] };
  assert.deepEqual(validateOutput(ok), []);
  for (const sub of SUBTYPES) {
    const seed = seedsOf(sub)[0]; const task = taskOf(seed, 3); const ref = referenceSolve(task); const field = FIELD[sub];
    const other = SUBTYPES[(SUBTYPES.indexOf(sub) + 1) % 4];
    const bad = [
      null, undefined, 42, 'text', true, [], [ref[field]], {}, { [field]: null }, { ...ref, extra: 1 }, { ...ref, [other]: ref[field] }, { [other]: ref[field] },
      { answer: ref[field] }, { [field]: 7 }, { [field]: { x: 1 } },
    ];
    if (sub === 'sentence') bad.push({ sentence: ['a sentence.'] }, { sentence: 'x'.repeat(601) });
    else {
      bad.push({ [field]: 'a string' }, { [field]: new Array(sub === 'schedule' ? 201 : 41).fill(sub === 'schedule' ? { day: 'Mon', shift: 'am', person: 'Zed' } : 'Abcde') }, { [field]: [null] }, { [field]: [7] });
    }
    if (sub === 'names' || sub === 'order') bad.push({ [field]: [''] }, { [field]: ['x'.repeat(61)] }, { [field]: [['nested']] });
    if (sub === 'schedule') bad.push({ schedule: [{ day: 'Mon' }] }, { schedule: ['Mon'] }, { schedule: [{ day: 'Mon', shift: 'am', person: 'Zed', extra: 1 }] }, { schedule: [{ day: 1, shift: 2, person: 3 }] }, { schedule: [[]] }, { schedule: {} });
    for (const b of bad) {
      const verdict = oracle(task, b);
      assert.equal(verdict.pass, false, `${sub}: ${JSON.stringify(b)?.slice(0, 80)}`);
      assert.equal(verdict.score, 0);
      assert.equal(verdict.details.schemaValid, false, `${sub}: ${JSON.stringify(b)?.slice(0, 80)}`);
    }
    // non-plain data: accessors, proxies, exotic prototypes, sparse arrays, symbol keys
    const getter = {}; Object.defineProperty(getter, field, { get: () => ref[field], enumerable: true });
    const sparse = []; sparse[2] = 'x'; sparse.length = 3;
    const exotic = [getter, new Proxy({ ...ref }, {}), Object.assign(Object.create({ inherited: 1 }), ref), { [field]: sub === 'sentence' ? 'x' : sparse }, { ...ref, [Symbol('s')]: 1 }, { toJSON: () => ref }];
    for (const b of exotic) assert.equal(oracle(task, b).pass, false, `${sub} exotic`);
  }
  // schema-valid but rule-breaking is NOT a schema error (it fails on the rules)
  assert.equal(subtypeOf(604), 'names');
  const names = oracle(taskOf(604, 1), { names: ['a', 'b', 'c'] });
  assert.equal(names.details.schemaValid, true); assert.equal(names.pass, false);
});

test('oracle is total: odd tasks never throw, and tampered task text cannot change the verdict', () => {
  for (const bad of [undefined, null, 3, 'x', {}, { family: 'other' }, { family: 'need-constraint' }, { family: 'need-constraint', seed: '601', split: 'dev', difficulty: 3 },
    { family: 'need-constraint', seed: 601, split: 'dev', difficulty: 9 }, { family: 'need-constraint', seed: 601, split: 'nope', difficulty: 3 }, { family: 'need-constraint', seed: 601.5, split: 'dev', difficulty: 3 }]) {
    const v = oracle(bad, { names: [] }); assert.equal(v.pass, false); assert.equal(v.score, 0);
  }
  for (const seed of SEEDS.slice(0, 16)) {
    const task = taskOf(seed, 4); const ref = referenceSolve(task);
    const forged = clone(task); forged.prompt = 'Anything goes.'; forged.inputs = { subtype: 'order', items: [], constraints: [], reserved_names: [], required_words: [], forbidden_words: [] };
    forged.budget = { actions: 0 };
    assert.equal(oracle(forged, ref).pass, true, 'forged text does not matter');
    for (const control of badControls) assert.equal(oracle(forged, control.make(task)).pass, false);
  }
});

// ================================================================== no truth leaks
test('no hidden truth leaks into the prompt, inputs or any key', () => {
  const allowedKeys = {
    names: ['reserved_names', 'subtype'], sentence: ['forbidden_words', 'required_words', 'subtype'], order: ['constraints', 'items', 'subtype'],
    schedule: ['days', 'limits', 'need', 'never_together', 'people', 'shifts', 'subtype', 'unavailable'],
  };
  const hasForbiddenKey = (v, path = '') => {
    if (Array.isArray(v)) return v.some(x => hasForbiddenKey(x, path));
    if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => /answer|solution|reference|planted|truth|oracle|expected|hidden/i.test(k) || hasForbiddenKey(x, `${path}/${k}`));
    return false;
  };
  for (const d of DIFFS) for (const seed of SEEDS) {
    const task = taskOf(seed, d); const sub = subtypeOf(seed); const { truth } = build(seed, 'dev', d);
    const hay = `${task.prompt}\n${JSON.stringify(task.inputs)}`.toLowerCase();
    assert.ok(Object.keys(task.inputs).every(k => allowedKeys[sub].includes(k)), `${sub} input keys`);
    assert.equal(hasForbiddenKey(task), false);
    const ref = referenceSolve(task);
    if (sub === 'names') {
      for (const nm of ref.names) assert.equal(new RegExp(`\\b${nm.toLowerCase()}\\b`).test(hay), false, `name ${nm} appears in the task`);
    } else if (sub === 'sentence') {
      assert.equal(hay.includes(ref.sentence.toLowerCase()), false);
      const middle = tokenize(ref.sentence).map(w => w.toLowerCase());
      for (let i = 0; i + 3 <= middle.length; i++) assert.equal(hay.includes(middle.slice(i, i + 3).join(' ')), false, 'three consecutive reference words appear in the task');
    } else if (sub === 'order') {
      const planted = truth.planted; const items = task.inputs.items;
      assert.notDeepEqual(items, planted); assert.notDeepEqual(items, [...planted].reverse());
      assert.notDeepEqual(items, ref.order); assert.notDeepEqual(items, truth.solutions[1].order);
      for (const seq of [planted, ref.order]) assert.equal(hay.includes(seq.join(' ').toLowerCase()), false);
      assert.equal(hay.includes(planted.slice(0, 3).join('", "').toLowerCase()), false, 'planted order is not echoed in the item list');
    } else {
      assert.equal(hay.includes(JSON.stringify(ref.schedule).toLowerCase()), false);
      assert.equal(hay.includes(JSON.stringify(truth.planted).toLowerCase()), false);
      for (const p of task.inputs.people) assert.deepEqual(Object.keys(p).filter(k => !['name', 'role'].includes(k)), []);
      // availability never reveals an assignment: nobody is listed unavailable where the reference rota places them
      for (const u of task.inputs.unavailable) assert.equal(ref.schedule.some(r => r.person === u.person && r.day === u.day && (u.shift === null || u.shift === r.shift)), false);
    }
  }
});

// ================================================================== runtime limits and difficulty
test('generate and oracle each stay under 2 s and 200 MB at difficulty 5 (cold, test split)', () => {
  const heapBefore = process.memoryUsage().heapUsed;
  for (const seed of SEEDS.slice(0, 16)) {
    let t0 = performance.now(); const task = generate({ seed, split: 'test', difficulty: 5 }); const g = performance.now() - t0;
    assert.ok(g < 2000, `generate ${g}ms (seed ${seed})`);
    t0 = performance.now(); const verdict = oracle(task, referenceSolve(task)); const o = performance.now() - t0;
    assert.ok(o < 2000, `oracle ${o}ms (seed ${seed})`);
    assert.equal(verdict.pass, true);
  }
  assert.ok(process.memoryUsage().heapUsed - heapBefore < 200 * 1024 * 1024);
});

test('difficulty knobs: items and constraints grow; input size grows; table of tokens is reported', t => {
  const med = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const table = {};
  for (const sub of SUBTYPES) {
    const meds = DIFFS.map(d => med(seedsOf(sub).map(seed => { const task = taskOf(seed, d); return estimateTokens(task.prompt) + estimateTokens(task.inputs); })));
    table[sub] = meds;
    for (let i = 1; i < 5; i++) assert.ok(meds[i] > meds[i - 1], `${sub}: tokens must grow with difficulty ${meds}`);
    assert.ok(meds[4] >= 1.3 * meds[0], `${sub}: d5 is clearly longer than d1 (${meds})`);
  }
  t.diagnostic(`median tokens (prompt+inputs) by difficulty 1..5: ${JSON.stringify(table)}`);
  for (let d = 2; d <= 5; d++) {
    assert.ok(KNOBS.names[d].n > KNOBS.names[d - 1].n && KNOBS.sentence[d].m > KNOBS.sentence[d - 1].m);
    assert.ok(KNOBS.order[d].n > KNOBS.order[d - 1].n && KNOBS.order[d].c > KNOBS.order[d - 1].c);
    assert.ok(KNOBS.schedule[d].P >= KNOBS.schedule[d - 1].P && KNOBS.schedule[d].days >= KNOBS.schedule[d - 1].days);
  }
  // the specs themselves get bigger: counted from the rebuilt specs
  for (const seed of seedsOf('order')) assert.equal(build(seed, 'dev', 5).spec.items.length, 15);
  for (const seed of seedsOf('names')) assert.equal(build(seed, 'dev', 4).spec.n, 11);
  for (const seed of seedsOf('schedule')) assert.equal(build(seed, 'dev', 1).spec.people.length, 4);
});

test('shortcut-breaker pairs exist: same structure at different lengths, different structure at the same length', () => {
  const tokens = (seed, d) => { const t = taskOf(seed, d); return estimateTokens(t.prompt) + estimateTokens(t.inputs); };
  const med = (sub, d) => [...seedsOf(sub).map(s => tokens(s, d))].sort((a, b) => a - b)[4];
  // (1) same structure (same subtype, same output field, same checker), length differs by >= 30% between d1 and d5
  for (const sub of SUBTYPES) {
    assert.ok(med(sub, 5) / med(sub, 1) >= 1.3, `${sub} d5/d1 length ratio`);
    for (const seed of seedsOf(sub).slice(0, 4)) assert.deepEqual(Object.keys(referenceSolve(taskOf(seed, 1))), Object.keys(referenceSolve(taskOf(seed, 5))));
  }
  // (2) different structure at (almost) the same length: cells of different subtypes whose median sizes are within 10%
  const cells = SUBTYPES.flatMap(sub => DIFFS.map(d => ({ sub, d, tok: med(sub, d) })));
  const matched = [];
  for (const a of cells) for (const b of cells) if (a.sub < b.sub && Math.abs(a.tok - b.tok) / Math.max(a.tok, b.tok) <= 0.1) matched.push([`${a.sub}@d${a.d}`, `${b.sub}@d${b.d}`]);
  assert.ok(matched.length >= 4, `matched-length pairs: ${JSON.stringify(matched)}`);
});

// ================================================================== differential test against the independent readings
test('differential: oracle agrees with an independent reading of the rendered task on references, alternatives, controls and mutations', () => {
  const stats = Object.fromEntries(SUBTYPES.map(s => [s, { total: 0, validNeighbours: 0, validNeighbourTasks: new Set(), invalid: 0 }]));
  const wordsPool = ['lamp', 'stone', 'quiet', 'the', 'very', 'cartographer', 'x', 'zzz'];
  for (const d of DIFFS) for (const seed of SEEDS) {
    const sub = subtypeOf(seed); const task = taskOf(seed, d); const ref = referenceSolve(task); const field = FIELD[sub];
    const r = rng('differential', seed, d); const parsed = sub === 'order' ? parseOrder(task) : null;
    const indep = out => (Object.keys(out).length !== 1 || !(field in out) ? false : sub === 'order' ? indepOrder(task, out, parsed) : INDEP[sub](task, out));
    const answers = [ref, altSolve(task), ...badControls.map(c => c.make(task))];
    // random mutations of the reference
    for (let k = 0; k < 24; k++) {
      const v = clone(ref[field]);
      if (sub === 'names') {
        const i = r.int(0, v.length - 1);
        switch (r.int(0, 4)) {
          case 0: { const at = r.int(1, v[i].length - 2); v[i] = v[i].slice(0, at) + r.pick('abcdefghijklmnopqrstuvwxyz'.split('')) + v[i].slice(at + 1); break; }
          case 1: v[i] = v[i] + r.pick(['a', 'k', 'x']); break;
          case 2: v[i] = v[r.int(0, v.length - 1)].toUpperCase(); break;
          case 3: v[i] = task.inputs.reserved_names.length ? r.pick(task.inputs.reserved_names) : v[i]; break;
          default: { const at = r.int(0, v[i].length - 1); v[i] = v[i].slice(0, at) + v[i].slice(at + 1); }
        }
        answers.push({ names: v });
      } else if (sub === 'sentence') {
        const words = v.split(' ').map(w => w.replace(/[,.]/g, ''));
        const i = r.int(0, words.length - 1);
        switch (r.int(0, 5)) {
          case 0: words[i] = r.pick(wordsPool); break;
          case 1: words.splice(i, 1); break;
          case 2: words.splice(i, 0, r.pick(wordsPool)); break;
          case 3: words[i] = r.pick(task.inputs.forbidden_words); break;
          case 4: { const j = r.int(0, words.length - 1); [words[i], words[j]] = [words[j], words[i]]; break; }
          default: words[i] = r.pick(task.inputs.required_words);
        }
        let s = words.join(' '); s = s.charAt(0).toUpperCase() + s.slice(1);
        if (r.chance(0.2)) s = s.replace(' ', ', ');
        answers.push({ sentence: `${s}${r.chance(0.9) ? '.' : '!'}` });
      } else if (sub === 'order') {
        const i = r.int(0, v.length - 1); const j = r.int(0, v.length - 1);
        if (r.chance(0.5)) [v[i], v[j]] = [v[j], v[i]]; else { const [x] = v.splice(i, 1); v.splice(j, 0, x); }
        if (r.chance(0.05)) v[i] = v[j];
        answers.push({ order: v });
      } else {
        const people = task.inputs.people.map(p => p.name);
        const i = r.int(0, v.length - 1); const j = r.int(0, v.length - 1);
        switch (r.int(0, 5)) {
          case 0: case 1: v[i].person = r.pick(people); break;
          case 2: [v[i].person, v[j].person] = [v[j].person, v[i].person]; break;
          case 3: v.splice(i, 1); break;
          case 4: v.push({ ...v[i], person: r.pick(people) }); break;
          default: v[i].shift = r.pick(task.inputs.shifts); v[i].day = r.pick(task.inputs.days);
        }
        answers.push({ schedule: v });
      }
    }
    answers.forEach((out, idx) => {
      const expected = indep(out); const verdict = oracle(task, out);
      assert.equal(verdict.pass, expected, `${sub} d${d} seed ${seed} answer #${idx}: oracle ${verdict.pass} vs independent ${expected} ${JSON.stringify(out).slice(0, 200)} ${JSON.stringify(verdict.details.failed)}`);
      stats[sub].total++;
      if (idx >= 2 + badControls.length && expected && JSON.stringify(out) !== JSON.stringify(ref)) { stats[sub].validNeighbours++; stats[sub].validNeighbourTasks.add(`${seed}/${d}`); }
      if (!expected) stats[sub].invalid++;
    });
  }
  for (const sub of SUBTYPES) {
    assert.ok(stats[sub].total > 1000, sub);
    assert.ok(stats[sub].invalid > 300, `${sub}: the mutation corpus contains plenty of invalid answers`);
    // answers that differ from the reference, were not produced by any solver, and are valid per the independent reading
    assert.ok(stats[sub].validNeighbours >= 5, `${sub}: found ${stats[sub].validNeighbours} valid mutated answers`);
  }
});

test('differential: the rendered text parses completely (every order statement, every schedule rule) and matches the spec', () => {
  for (const seed of seedsOf('order')) for (const d of DIFFS) {
    const task = taskOf(seed, d); const { spec } = build(seed, 'dev', d);
    const parsed = parseOrder(task);
    assert.equal(parsed.length, spec.constraints.length);
    assert.deepEqual([...task.inputs.constraints].sort(), spec.constraints.map(c => renderConstraint(c, spec.items.length)).sort());
    assert.deepEqual([...task.inputs.items].sort(), [...spec.items].sort());
  }
  for (const seed of seedsOf('schedule')) for (const d of DIFFS) {
    const task = taskOf(seed, d); const { spec } = build(seed, 'dev', d); const p = task.prompt;
    assert.equal(/never work the same slot/.test(p), spec.rules.apartPairs.length > 0);
    assert.equal(/Nobody works the last shift/.test(p), spec.rules.noClopen);
    assert.equal(/role is "lead"/.test(p), spec.rules.leadShifts.length > 0);
    assert.equal(/"trainee"/.test(p), spec.rules.traineeNeedsLead);
    assert.equal(/days in a row/.test(p), Boolean(spec.rules.maxStreak));
    assert.equal(task.inputs.need.length, spec.days.length * spec.shifts.length);
    assert.equal(task.inputs.unavailable.length, spec.unavailable.length);
  }
});

// ================================================================== family-specific properties
test('every rule category can fail: mutation coverage of the checker ids that are active in the tasks', () => {
  const failedIds = Object.fromEntries(SUBTYPES.map(s => [s, new Set()])); const activeIds = Object.fromEntries(SUBTYPES.map(s => [s, new Set()]));
  const wordsPool = ['lamp', 'the', 'very', 'cartographer', 'zzz', 'x'];
  for (const seed of SEEDS) {
    const sub = subtypeOf(seed); const task = taskOf(seed, 5); const ref = referenceSolve(task); const field = FIELD[sub]; const r = rng('coverage', seed);
    for (const c of oracle(task, ref).details.checks) activeIds[sub].add(c.id);
    for (let k = 0; k < 120; k++) {
      let v = clone(ref[field]);
      if (sub === 'names') {
        const i = r.int(0, v.length - 1); const at = r.int(0, v[i].length - 1);
        v[i] = k % 6 === 0 ? v[0] : k % 6 === 1 ? task.inputs.reserved_names[k % task.inputs.reserved_names.length] : v[i].slice(0, at) + r.pick('abcdefghijklmnopqrstuvwxyz'.split('')) + v[i].slice(at + 1);
        if (k % 17 === 0) v.pop();
      } else if (sub === 'sentence') {
        const w = v.replace('.', '').replace(/,/g, '').split(' '); const i = r.int(0, w.length - 1);
        w[i] = k % 7 === 0 ? task.inputs.forbidden_words[k % task.inputs.forbidden_words.length] : k % 5 === 0 ? w[(i + 1) % w.length] : r.pick(wordsPool);
        if (k % 11 === 0) w.splice(i, 1);
        if (k % 13 === 0) w.push(w[0]);
        if (k % 3 === 0) w[i] = `${w[i]},`;
        const text = w.join(' ');
        v = `${text.charAt(0).toUpperCase() + text.slice(1)}.`;
      } else if (sub === 'order') {
        const i = r.int(0, v.length - 1); const j = r.int(0, v.length - 1); [v[i], v[j]] = [v[j], v[i]];
      } else {
        const people = task.inputs.people.map(p => p.name); const i = r.int(0, v.length - 1);
        if (k % 9 === 0) v.splice(i, 1); else if (k % 9 === 1) v.push({ ...v[i] }); else if (k % 9 === 2) v[i].day = 'Nope'; else v[i].person = r.pick(people);
      }
      out(sub, v);
    }
    function out(s, value) { const res = oracle(task, { [FIELD[s]]: value }); for (const id of res.details.failed ?? []) failedIds[s].add(id); }
  }
  for (const sub of SUBTYPES) {
    const missing = [...activeIds[sub]].filter(id => !failedIds[sub].has(id));
    // rule categories that only exist in some tasks are covered across seeds; all of them must be shown to fail
    const allowedMissing = sub === 'schedule' ? ['lead-coverage', 'trainee-with-lead', 'rest-rule', 'never-together', 'streak'] : [];
    assert.deepEqual(missing.filter(id => !allowedMissing.includes(id)), [], `${sub}: categories never seen failing`);
  }
});

test('order: the search solver finds several orderings per task, and reports contradictions', () => {
  for (const d of DIFFS) for (const seed of seedsOf('order')) {
    const { spec } = build(seed, 'dev', d);
    const res = solveOrder(spec, { limit: MIN_ORDER_SOLUTIONS, maxNodes: 200000 });
    assert.equal(res.solutions.length, MIN_ORDER_SOLUTIONS, `seed ${seed} d${d}: at least ${MIN_ORDER_SOLUTIONS} valid orders`);
    assert.equal(new Set(res.solutions.map(s => s.join())).size, MIN_ORDER_SOLUTIONS);
    for (const s of res.solutions) assert.equal(oracle(taskOf(seed, d), { order: s }).pass, true);
    // every constraint kind of the difficulty's palette is allowed, and nothing outside it
    const allowed = new Set(KNOBS.order[d].kinds);
    for (const c of spec.constraints) assert.ok(allowed.has(c.kind), `${c.kind} not in palette of d${d}`);
    assert.ok(spec.constraints.some(c => c.kind === 'before') && spec.constraints.some(c => c.kind === 'next'));
  }
  const items = ['Aa', 'Bb', 'Cc'];
  const contradictory = { subtype: 'order', items, constraints: [{ kind: 'before', a: 'Aa', b: 'Bb' }, { kind: 'before', a: 'Bb', b: 'Cc' }, { kind: 'before', a: 'Cc', b: 'Aa' }] };
  const none = solveOrder(contradictory, { limit: 5 });
  assert.deepEqual(none.solutions, []); assert.equal(none.complete, true);
  const unique = { subtype: 'order', items, constraints: [{ kind: 'before', a: 'Aa', b: 'Bb' }, { kind: 'before', a: 'Bb', b: 'Cc' }] };
  assert.deepEqual(solveOrder(unique, { limit: 5 }).solutions, [['Aa', 'Bb', 'Cc']]);
});

test('schedule: the search solver and a random-restart search find different valid rotas; planting never contradicts availability', () => {
  for (const d of DIFFS) for (const seed of seedsOf('schedule')) {
    const { spec, truth } = build(seed, 'dev', d); const task = taskOf(seed, d);
    const distinct = new Set([JSON.stringify(truth.solutions[0].schedule), JSON.stringify(truth.solutions[1].schedule)]);
    for (let k = 0; k < 3; k++) {
      const res = solveSchedule(spec, { mode: 'random', rng: rng('sched-test', seed, k), maxNodes: 100000 });
      if (res.solutions[0]) { assert.equal(oracle(task, { schedule: res.solutions[0] }).pass, true); distinct.add(JSON.stringify(res.solutions[0])); }
    }
    assert.ok(distinct.size >= 2, `seed ${seed} d${d}: at least two distinct valid rotas`);
    assert.equal(checkSchedule(spec, truth.planted).pass, true, 'the planted rota is itself valid');
    // total staffing equals the sum of needs, and the limits can hold it
    const total = spec.need.reduce((a, b) => a + b, 0);
    assert.equal(referenceSolve(task).schedule.length, total);
    assert.ok(Object.values(spec.limits).reduce((a, l) => a + l.max, 0) >= total && Object.values(spec.limits).reduce((a, l) => a + l.min, 0) <= total);
  }
});

test('names and sentence: the knobs show up as rules, and tasks are satisfiable with room to spare', () => {
  for (const seed of seedsOf('names')) {
    const s1 = build(seed, 'dev', 1).spec; const s5 = build(seed, 'dev', 5).spec;
    assert.equal(s1.n, 3); assert.equal(s5.n, 14); assert.equal(s5.distinctInitials, true); assert.ok(s5.startSet.length >= s5.n);
    assert.ok(s5.minWith && s5.vowelRange && s5.mustContain && s5.endSet && s5.reserved.length === 16);
    assert.ok(s1.startSet === null && s1.reserved.length === 0);
    for (const d of DIFFS) { const spec = build(seed, 'dev', d).spec; assert.equal(spec.forbidden.length, KNOBS.names[d].forbidden); }
  }
  for (const seed of seedsOf('sentence')) {
    for (const d of DIFFS) {
      const spec = build(seed, 'dev', d).spec;
      assert.equal(spec.required.length, KNOBS.sentence[d].m); assert.equal(spec.forbidden.length, KNOBS.sentence[d].forbid);
      assert.equal(new Set(spec.required).size, spec.required.length);
      assert.equal(spec.required.filter(w => spec.forbidden.includes(w)).length, 0);
      assert.ok(spec.maxWords - spec.minWords === KNOBS.sentence[d].width, 'window width narrows with difficulty');
      const used = Object.values(spec.rules).filter(v => v !== null && v !== false && v !== 0).length;
      assert.ok(used >= (d === 1 ? 0 : 1) || d === 1, `extras at d${d}`);
    }
    assert.equal(Object.values(build(seed, 'dev', 1).spec.rules).filter(v => v !== null && v !== false && v !== 0).length, 0, 'd1 has no extras');
  }
});

// ================================================================== checker semantics on hand-written specs and answers
test('names checker semantics (hand-written spec and answers)', () => {
  const spec = { subtype: 'names', n: 2, minLen: 5, maxLen: 7, startSet: ['k', 'v'], endSet: ['a', 'o'], mustContain: 'r', banLetters: ['q', 'x'], forbidden: ['zz', 'ab'], maxRepeat: 2, vowelRange: [2, 3], reserved: ['kerlo'], distinctInitials: true, minWith: { letter: 'v', count: 1 } };
  const failed = names => checkNames(spec, names).checks.filter(c => !c.ok).map(c => c.id);
  assert.equal(checkNames(spec, ['Karola', 'Vermo']).pass, true);
  assert.equal(checkNames(spec, ['  karola ', 'VERMO']).pass, true, 'case and surrounding spaces do not matter');
  assert.equal(checkNames(spec, ['Vermo', 'Karola']).pass, true, 'order of the names does not matter');
  const cases = [
    [['Karola'], 'count'], [['Karola', 'Vermo', 'Kiro'], 'count'], [['Karola', 'Ver mo'], 'format'], [['Karola', 'Vermo9'], 'format'],
    [['Karola', 'Vero'], 'length'], [['Karola', 'Vermoara'], 'length'], [['Karola', 'Barmo'], 'start'], [['Karola', 'Vermi'], 'end'],
    [['Karola', 'Vetalo'], 'contain'], [['Karola', 'Vexrmo'], 'banned-letters'], [['Karola', 'Verabo'], 'forbidden-substrings'], [['Karola', 'VERABO'], 'forbidden-substrings'],
    [['Karola', 'Varrrao'], 'repeat'], [['Karola', 'Veramio'], 'vowels'], [['Karola', 'Vrmrk'], 'vowels'], [['Karola', 'KERLO'], 'reserved'],
    [['Karola', 'KAROLA'], 'distinct'], [['Karola', 'Kermo'], 'distinct-initials'], [['Karola', 'Kermo'], 'min-with-letter'],
  ];
  for (const [answer, id] of cases) assert.ok(failed(answer).includes(id), `${JSON.stringify(answer)} should fail ${id}, failed: ${failed(answer)}`);
  // a spec without optional rules only checks what it states
  const minimal = { ...spec, startSet: null, endSet: null, mustContain: null, banLetters: [], maxRepeat: null, vowelRange: null, reserved: [], distinctInitials: false, minWith: null, forbidden: ['zz'] };
  assert.equal(checkNames(minimal, ['Abcde', 'Fghij']).pass, true);
  assert.deepEqual(checkNames(minimal, ['Abcde', 'Fghij']).checks.map(c => c.id), ['count', 'format', 'length', 'forbidden-substrings', 'distinct']);
});

test('sentence checker semantics (hand-written spec and answers)', () => {
  const base = { subtype: 'sentence', minWords: 5, maxWords: 9, required: ['lantern', 'harbor'], forbidden: ['very', 'the'], rules: { noRepeat: false, commas: null, banLetter: null, longWord: null, startWord: null, endWord: null, minGap: 0 } };
  const ok = (s, spec = base) => checkSentence(spec, s).pass;
  assert.equal(ok('A lantern glowed over a quiet harbor.'), true);
  assert.equal(ok('A LANTERN glowed over a quiet Harbor.'), true, 'capitalisation is ignored');
  assert.equal(ok('A lantern, glowed over, a quiet harbor.'), true, 'commas are allowed when not limited');
  assert.equal(ok('  A lantern glowed over a quiet harbor.  '), true, 'surrounding whitespace is ignored');
  assert.equal(ok('Harbor lights and a lantern harbor glowed.'), true, 'a repeated required word may be satisfied by a later occurrence');
  for (const [s, why] of [
    ['A lantern glowed over the quiet harbor.', 'forbidden word'], ['A lantern glowed over a Very quiet harbor.', 'forbidden word, any case'], ['A harbor glowed over a quiet lantern.', 'order'],
    ['A lanterns glowed over a quiet harbors.', 'whole words only'], ['Alantern glowed over a quiet harbor.', 'substring is not a word'], ['A lantern. Glowed over a harbor.', 'two sentences'],
    ['a lantern glowed over a quiet harbor.', 'capital start'], ['A lantern glowed over a quiet harbor', 'final period'], ['A lantern glowed over a quiet harbor!', 'final period'],
    ['A lantern glowed over 2 quiet harbors.', 'digit'], ['A lantern glowed over a well-lit harbor.', 'hyphen'], ["A lantern glowed over a harbor's edge.", 'apostrophe'],
    ['A lantern  glowed over a quiet harbor.', 'double space'], ['A lantern glowed over a quiet harbor,.', 'comma before period'], ['A lantern glowed over a quiet harbor.\n', 'trailing newline is trimmed (valid)'],
    ['Lantern harbor.', 'too short'], ['A lantern glowed over a quiet harbor on a very windy night.', 'too long'], ['', 'empty'], ['A lantern glowed over a quiet harbor; fine.', 'semicolon'],
  ]) {
    const res = ok(s);
    assert.equal(res, why.includes('(valid)'), `${JSON.stringify(s)} (${why})`);
  }
  const rules = (o) => ({ ...base, rules: { ...base.rules, ...o } });
  assert.equal(ok('A lantern glowed over a quiet harbor.', rules({ noRepeat: true })), false, '"a" twice');
  assert.equal(ok('One lantern glowed over some quiet harbor.', rules({ noRepeat: true })), true);
  assert.equal(ok('A lantern glowed over a quiet harbor.', rules({ commas: 1 })), false);
  assert.equal(ok('A lantern, glowed over a quiet harbor.', rules({ commas: 1 })), true);
  assert.equal(ok('A lantern, glowed over, a quiet harbor.', rules({ commas: 1 })), false);
  assert.equal(ok('A lantern glowed over a quiet harbor.', rules({ banLetter: 'z' })), true);
  assert.equal(ok('A lantern glowed over a quiet zebra harbor.', rules({ banLetter: 'z' })), false);
  assert.equal(ok('A lantern glowed over a quiet Zebra harbor.', rules({ banLetter: 'z' })), false, 'banned letter in either case');
  assert.equal(ok('A lantern glowed over a quiet harbor.', rules({ longWord: 9 })), false);
  assert.equal(ok('A lantern glowed over a quiet lighthouse harbor.', rules({ longWord: 9 })), true);
  assert.equal(ok('Finally a lantern glowed over a quiet harbor anyway.', rules({ startWord: 'finally', endWord: 'anyway', maxWords: 9 })), true);
  assert.equal(ok('Then a lantern glowed over a quiet harbor anyway.', rules({ startWord: 'finally', endWord: 'anyway' })), false);
  assert.equal(ok('Finally a lantern glowed over a quiet harbor again.', rules({ startWord: 'finally', endWord: 'anyway' })), false);
  assert.equal(ok('A lantern harbor glowed over a quiet night.', rules({ minGap: 1 })), false, 'no word between the required words');
  assert.equal(ok('A lantern glowed over a quiet harbor.', rules({ minGap: 1 })), true);
  assert.equal(ok('A lantern glowed over a quiet harbor.', rules({ minGap: 4 })), true, 'exactly four words sit between');
  assert.equal(ok('A lantern glowed over a quiet harbor.', rules({ minGap: 5 })), false);
  // the embedding search chooses occurrences, so a later pair can satisfy the gap rule
  assert.equal(embeds(['a', 'b', 'x', 'x', 'a', 'x', 'x', 'b'], ['a', 'b'], 2), true);
  assert.equal(embeds(['a', 'b', 'x', 'b'], ['a', 'b'], 3), false);
  assert.equal(embeds(['b', 'a'], ['a', 'b'], 0), false);
  assert.equal(embeds(['a'], ['a'], 5), true);
  assert.deepEqual(tokenize('Hello, world. x'), ['Hello', 'world', 'x']);
});

test('order checker semantics (each statement kind, both outcomes)', () => {
  const items = ['A', 'B', 'C', 'D', 'E'];
  const holds = (c, order) => checkOrder({ subtype: 'order', items, constraints: [c] }, order).pass;
  const abcde = ['A', 'B', 'C', 'D', 'E'];
  assert.equal(holds({ kind: 'before', a: 'A', b: 'D' }, abcde), true);
  assert.equal(holds({ kind: 'before', a: 'D', b: 'A' }, abcde), false);
  assert.equal(holds({ kind: 'next', a: 'B', b: 'C' }, abcde), true);
  assert.equal(holds({ kind: 'next', a: 'C', b: 'B' }, abcde), false);
  assert.equal(holds({ kind: 'next', a: 'A', b: 'C' }, abcde), false);
  assert.equal(holds({ kind: 'apart', a: 'A', b: 'C' }, abcde), true);
  assert.equal(holds({ kind: 'apart', a: 'C', b: 'B' }, abcde), false);
  assert.equal(holds({ kind: 'pos', a: 'C', k: 3 }, abcde), true);
  assert.equal(holds({ kind: 'pos', a: 'C', k: 2 }, abcde), false);
  assert.equal(holds({ kind: 'between', a: 'C', b: 'A', c: 'E' }, abcde), true);
  assert.equal(holds({ kind: 'between', a: 'C', b: 'E', c: 'A' }, abcde), true, 'either direction');
  assert.equal(holds({ kind: 'between', a: 'A', b: 'B', c: 'E' }, abcde), false);
  assert.equal(holds({ kind: 'gap', a: 'A', b: 'D', d: 2 }, abcde), true);
  assert.equal(holds({ kind: 'gap', a: 'A', b: 'D', d: 3 }, abcde), false);
  assert.equal(holds({ kind: 'gap', a: 'D', b: 'A', d: 2 }, abcde), true, 'gap does not depend on the order of the pair');
  assert.equal(holds({ kind: 'exact', a: 'A', b: 'D', d: 2 }, abcde), true);
  assert.equal(holds({ kind: 'exact', a: 'A', b: 'D', d: 1 }, abcde), false);
  assert.equal(holds({ kind: 'notEnd', a: 'C' }, abcde), true);
  assert.equal(holds({ kind: 'notEnd', a: 'A' }, abcde), false);
  assert.equal(holds({ kind: 'notEnd', a: 'E' }, abcde), false);
  // not a permutation: repeats, missing, unknown, wrong length, whitespace is trimmed
  const none = { subtype: 'order', items, constraints: [{ kind: 'notEnd', a: 'C' }] };
  for (const bad of [['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D', 'D'], ['A', 'B', 'C', 'D', 'Z'], [...abcde, 'F'], ['a', 'b', 'c', 'd', 'e']]) assert.equal(checkOrder(none, bad).pass, false);
  assert.equal(checkOrder(none, [' A', 'B ', 'C', 'D', 'E']).pass, true);
  // statements render and read back the same way
  assert.equal(renderConstraint({ kind: 'pos', a: 'A', k: 1 }, 5), 'A is first.');
  assert.equal(renderConstraint({ kind: 'pos', a: 'A', k: 5 }, 5), 'A is last.');
  assert.equal(renderConstraint({ kind: 'gap', a: 'A', b: 'B', d: 1 }, 5), 'At least 1 other item sits between A and B.');
  assert.equal(renderConstraint({ kind: 'exact', a: 'A', b: 'B', d: 2 }, 5), 'Exactly 2 other items sit between A and B.');
});

test('schedule checker semantics (each rule, both outcomes)', () => {
  const people = [{ name: 'Ann', role: 'lead' }, { name: 'Bob', role: 'staff' }, { name: 'Cy', role: 'trainee' }, { name: 'Di', role: 'lead' }];
  const spec = {
    subtype: 'schedule', days: ['Mon', 'Tue', 'Wed'], shifts: ['am', 'pm'], people, need: [1, 1, 1, 1, 1, 1], unavailable: [{ person: 'Bob', day: 'Tue', shift: null }, { person: 'Cy', day: 'Wed', shift: 'am' }],
    limits: { Ann: { min: 0, max: 3 }, Bob: { min: 0, max: 3 }, Cy: { min: 0, max: 3 }, Di: { min: 0, max: 3 } },
    rules: { apartPairs: [], noClopen: false, leadShifts: [], traineeNeedsLead: false, maxStreak: null },
  };
  const row = (day, shift, person) => ({ day, shift, person });
  const good = [row('Mon', 'am', 'Ann'), row('Mon', 'pm', 'Bob'), row('Tue', 'am', 'Ann'), row('Tue', 'pm', 'Di'), row('Wed', 'am', 'Bob'), row('Wed', 'pm', 'Ann')];
  const failed = (s, rows) => checkSchedule(s, rows).checks.filter(c => !c.ok).map(c => c.id);
  assert.deepEqual(failed(spec, good), []);
  assert.equal(checkSchedule(spec, [...good].reverse()).pass, true, 'row order does not matter');
  const swap = (i, p) => good.map((r, k) => (k === i ? { ...r, person: p } : r));
  assert.ok(failed(spec, good.slice(1)).includes('slot-counts'));
  assert.ok(failed(spec, [...good, row('Mon', 'am', 'Bob')]).includes('slot-counts'));
  assert.ok(failed(spec, [...good, good[0]]).includes('rows-valid'));
  assert.ok(failed(spec, swap(0, 'Zed')).includes('rows-valid'));
  assert.ok(failed(spec, [{ ...good[0], day: 'Fri' }, ...good.slice(1)]).includes('rows-valid'));
  assert.ok(failed(spec, swap(3, 'Bob')).includes('availability'), 'whole-day unavailability (shift: null)');
  assert.ok(failed(spec, swap(4, 'Cy')).includes('availability'), 'single-slot unavailability');
  assert.equal(failed(spec, swap(5, 'Cy')).includes('availability'), false, 'Cy is only unavailable for Wednesday am');
  assert.ok(failed(spec, [row('Mon', 'am', 'Ann'), row('Mon', 'pm', 'Ann'), ...good.slice(2)]).includes('one-per-day'));
  const tight = { ...spec, limits: { ...spec.limits, Ann: { min: 0, max: 2 } } };
  assert.ok(failed(tight, good).includes('limits'));
  const needMin = { ...spec, limits: { ...spec.limits, Cy: { min: 1, max: 3 } } };
  assert.ok(failed(needMin, good).includes('limits'));
  const apart = { ...spec, rules: { ...spec.rules, apartPairs: [['Ann', 'Di']] }, need: [2, 1, 1, 1, 1, 1] };
  assert.ok(failed(apart, [row('Mon', 'am', 'Ann'), row('Mon', 'am', 'Di'), ...good.slice(1)]).includes('never-together'));
  assert.equal(failed(apart, [row('Mon', 'am', 'Ann'), row('Mon', 'am', 'Bob'), ...good.slice(1)]).includes('never-together'), false);
  const clopen = { ...spec, rules: { ...spec.rules, noClopen: true } };
  assert.ok(failed(clopen, [row('Mon', 'am', 'Bob'), row('Mon', 'pm', 'Ann'), row('Tue', 'am', 'Ann'), ...good.slice(3)]).includes('rest-rule'), 'pm then next day am');
  assert.deepEqual(failed(clopen, [row('Mon', 'am', 'Ann'), row('Mon', 'pm', 'Bob'), row('Tue', 'am', 'Ann'), row('Tue', 'pm', 'Di'), row('Wed', 'am', 'Bob'), row('Wed', 'pm', 'Ann')]), []);
  const lead = { ...spec, rules: { ...spec.rules, leadShifts: ['pm'] } };
  assert.ok(failed(lead, good).includes('lead-coverage'), 'Mon pm has only Bob');
  assert.deepEqual(failed(lead, swap(1, 'Di')), ['one-per-day'].filter(() => false));
  const trainee = { ...spec, rules: { ...spec.rules, traineeNeedsLead: true }, need: [2, 1, 1, 1, 1, 1] };
  assert.ok(failed(trainee, [row('Mon', 'am', 'Cy'), row('Mon', 'am', 'Bob'), ...good.slice(1)]).includes('trainee-with-lead'));
  assert.equal(failed(trainee, [row('Mon', 'am', 'Cy'), row('Mon', 'am', 'Ann'), ...good.slice(1)]).includes('trainee-with-lead'), false);
  const streak = { ...spec, rules: { ...spec.rules, maxStreak: 2 }, unavailable: [] };
  assert.ok(failed(streak, [row('Mon', 'am', 'Bob'), row('Mon', 'pm', 'Ann'), row('Tue', 'am', 'Bob'), row('Tue', 'pm', 'Di'), row('Wed', 'am', 'Bob'), row('Wed', 'pm', 'Ann')]).includes('streak'), 'Bob works three days in a row');
  assert.equal(failed(streak, [row('Mon', 'am', 'Ann'), row('Mon', 'pm', 'Bob'), row('Tue', 'am', 'Di'), row('Tue', 'pm', 'Ann'), row('Wed', 'am', 'Bob'), row('Wed', 'pm', 'Di')]).includes('streak'), false);
  assert.ok(failed(streak, good).includes('streak'), 'Ann works Mon, Tue and Wed');
});
