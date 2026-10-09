// profile.mjs at $0 on synthetic tasks: a two-dialect export, an enum status, numeric and array ranges, prose notes and a
// prompt with numbers. Same-distribution tasks must not be novel; each kind of shift must be, with the right feature
// named; profiles are deterministic, JSON-serialisable, order-independent and never mutated by widening. Also the
// offline replay helpers in eval-profiles.mjs (evaluateArm, outcomeOf, parseTaskKey) on synthetic rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { learnProfile, checkProfile, widenProfile, emptyProfile, goodTuring, rateThreshold, shapeOf, classOf, lineSig, lineShape, promptSentences, SIZE_FEATURES, PROFILE_SCHEMA, PARAMS, describeProfile } from '../profile.mjs';
import { evaluateArm, outcomeOf, parseTaskKey, summarize } from '../eval-profiles.mjs';

// Deterministic PRNG (mulberry32).
const rng = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SYL = ['ka', 'lo', 'mi', 'ren', 'to', 'sa', 'vel', 'dor', 'an', 'is', 'ber', 'qu'];
const NOTES = 'The export merges two systems. ALPHA writes one pipe-separated row per contact with labelled fields, and BETA writes '
  + 'semicolon rows with positional fields. Status values describe whether a row is live. Amounts are in dollars and dates are '
  + 'written in ISO form. Rows with the same name and date describe the same person and must be merged.';

function mkTask(seed, o = {}) {
  const r = rng(seed), pick = xs => xs[Math.floor(r() * xs.length)];
  const name = () => { const s = pick(SYL) + pick(SYL) + pick(SYL); return s[0].toUpperCase() + s.slice(1); };
  const statuses = o.statuses ?? ['open', 'closed', 'held'];
  const date = () => { const y = 1950 + Math.floor(r() * 50), m = 1 + Math.floor(r() * 12), d = 1 + Math.floor(r() * 28); return o.dateFmt === 'dmy' ? `${d}/${m}/${y}` : `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  const rows = o.rows ?? 20 + Math.floor(r() * 5), lines = [];
  for (let i = 0; i < rows; i++) {
    lines.push(i % 2 ? `BETA;${100 + i};${name()};${date()};${(r() * 900 + 10).toFixed(2)}`
      : `ALPHA | id=${100 + i} | name=${name()} ${name()} | dob=${date()} | status=${pick(statuses)}`);
  }
  for (let i = 0; i < (o.newDialect ?? 0); i++) lines.push(`GAMMA :: ${200 + i} :: ${name()} :: ${date()} :: live`);
  const items = Array.from({ length: o.items ?? 3 + Math.floor(r() * 3) }, () => ({ sku: `SKU-${1000 + Math.floor(r() * 9000)}`, qty: o.qty ?? 1 + Math.floor(r() * 50), status: pick(statuses) }));
  const client = name();
  const inputs = { client, export: lines.join('\n'), notes: o.notes ?? NOTES, items };
  if (o.extraKey) inputs.priority = 'high';
  if (o.dropItems) delete inputs.items;
  if (o.qtyAsString) for (const it of inputs.items) it.qty = String(it.qty);
  return { prompt: o.prompt ?? `Merge the ${rows} rows of the export for client ${client}. Return JSON only, with one record per person.`, inputs };
}
const train = (n = 8, o = {}) => Array.from({ length: n }, (_, i) => mkTask(1000 + i, o));
const features = c => c.reasons.map(r => r.feature);

test('helpers: shapes, classes, line signatures, prompt skeleton, Good-Turing', () => {
  assert.equal(shapeOf('Smit, Wouter M.'), 'A, A.');
  assert.equal(shapeOf('4/8/1989'), '9/9/9');
  assert.equal(shapeOf('1,665.00'), '9.9');
  assert.equal(classOf('2020-01-31'), 'date-iso');
  assert.equal(classOf('31/01/2020'), 'date-num');
  assert.equal(classOf('+44 20 7946 0958'), 'phone');
  assert.equal(classOf('HV-0412'), 'id');
  assert.equal(classOf('Benoît'), 'word');
  assert.equal(classOf('12'), 'int');
  assert.equal(classOf('27 Jan 1977'), 'date-text');
  assert.equal(lineSig('ALPHA | id=1 | name=Ka Lo | dob=2001-01-01'), 'ALPHA~pipe:A¦id=¦name=¦dob=');
  assert.equal(lineSig('ALPHA row=1 | name=Ka Lo | dob=2001-01-01'), 'ALPHA~pipe:ALPHA row=¦name=¦dob=');
  assert.equal(lineShape('BETA;1;Kalo;2001-01-01;12.50').family, 'BETA~semi:5');
  assert.equal(lineShape('VERITAS {"row":1,"x":"a"}').sig, 'VERITAS~json:{row:n,x:s}');
  // prose with commas stays text: its fields are long
  assert.equal(lineShape('This sentence, which is long enough to matter here, has commas, and keeps going for a while.').family, 'This~text');
  assert.deepEqual(promptSentences('Merge the 24 rows for client Kalo. Return "only" JSON.', ['Kalo']), ['Merge the # rows for client ‹v›.', 'Return ‹q› JSON.']);
  assert.equal(goodTuring({ df: { a: 3, b: 1, c: 1 } }), 2 / 5);
  assert.equal(goodTuring({ df: {} }), 1);
  assert.equal(rateThreshold({ df: { a: 5 } }), PARAMS.rate.min);
  assert.equal(rateThreshold({ df: { a: 1 } }), PARAMS.rate.max);
});

test('same-distribution tasks are not novel; profiles are deterministic, serialisable and order-independent', () => {
  const tr = train(8), prof = learnProfile(tr);
  assert.equal(prof.schema, PROFILE_SCHEMA);
  assert.equal(prof.n, 8);
  assert.deepEqual(JSON.parse(JSON.stringify(prof)), prof);
  assert.deepEqual(learnProfile(tr), prof);
  assert.deepEqual(learnProfile([...tr].reverse()), prof, 'widening order does not matter');
  for (let i = 0; i < 12; i++) {
    const c = checkProfile(prof, mkTask(5000 + i));
    assert.equal(c.novel, false, `task ${i} flagged: ${JSON.stringify(c.reasons)}`);
    assert.ok(c.score <= 1 && c.score >= 0);
    assert.equal(c.n, 8);
  }
  // the status path became an enum (values recur across tasks); the per-task client name did not
  assert.match(describeProfile(prof), /inputs\.items\[\]\.status: .*enum \{closed, held, open\}/);
  assert.doesNotMatch(describeProfile(prof), /inputs\.client: .*enum/);
  // trace records ({task}) are accepted as well as task objects
  assert.deepEqual(learnProfile(tr.map(task => ({ traceId: 'x', task }))), prof);
});

test('each kind of shift is novel, with the feature named', () => {
  const prof = learnProfile(train(8));
  const cases = [
    [{ statuses: ['open', 'void'] }, 'enum'],
    [{ qty: 900 }, 'number-range'],
    [{ items: 40 }, 'array-length'],
    [{ rows: 120 }, 'line-count'],
    [{ newDialect: 12 }, 'line-family'],
    [{ dateFmt: 'dmy' }, 'line-format'],
    [{ extraKey: true }, 'new-path'],
    [{ dropItems: true }, 'missing-path'],
    [{ qtyAsString: true }, 'type'],
    [{ notes: 'Kinetic assays measure enzyme velocity across substrate concentrations; replicate wells are averaged, outliers excluded per protocol, and fitted parameters reported with units.' }, 'vocabulary'],
    [{ prompt: 'Translate every row into French and summarise the sentiment of each customer.' }, 'prompt'],
  ];
  for (const [o, feature] of cases) {
    const c = checkProfile(prof, mkTask(7777, o));
    assert.equal(c.novel, true, `${feature}: not novel`);
    assert.ok(features(c).includes(feature), `${feature}: reasons were ${features(c).join(', ')}`);
    assert.ok(c.score > 1);
    for (const r of c.reasons) assert.ok(r.ratio > 1);
  }
});

test('a format path changing class is novel; a free-text path changing shape is not', () => {
  const base = s => ({ prompt: 'Do it.', inputs: { when: s.when, who: s.who } });
  const prof = learnProfile([base({ when: '2020-01-02', who: 'Kalo' }), base({ when: '2021-03-04', who: 'Renmi' }), base({ when: '2019-11-30', who: 'Tosa' })]);
  assert.equal(checkProfile(prof, base({ when: '2022-05-06', who: 'Vel Dor-An' })).novel, false, 'a multi-word name is still a name');
  const c = checkProfile(prof, base({ when: '06/05/2022', who: 'Kalo' }));
  assert.ok(c.novel && features(c).includes('pattern-class'));
  const d = checkProfile(prof, base({ when: '2022-05-06', who: '2022-05-06' }));
  assert.ok(d.novel && d.reasons.some(r => r.feature === 'pattern-class' && r.path === 'inputs.who'), 'a name field now holding a date');
});

test('numeric margins: inside the margin is fine, beyond it is novel; non-integers on an integer path are novel', () => {
  const t = q => ({ prompt: 'p', inputs: { q } });
  const prof = learnProfile([t(10), t(20), t(30)]);   // span 20: margin max(5, 3) = 5
  assert.equal(checkProfile(prof, t(34)).novel, false);
  assert.equal(checkProfile(prof, t(6)).novel, false);
  const hi = checkProfile(prof, t(40));
  assert.ok(hi.novel && hi.reasons[0].feature === 'number-range');
  assert.equal(hi.reasons[0].ratio, 2);   // excess 5 over a margin of 5
  assert.ok(features(checkProfile(prof, t(20.5))).includes('non-integer'));
});

test('widening merges a confirmed task without mutating the input profile', () => {
  const prof = learnProfile(train(4)), snapshot = JSON.stringify(prof);
  const shifted = mkTask(4242, { newDialect: 12, statuses: ['open', 'void'] });
  assert.equal(checkProfile(prof, shifted).novel, true);
  const wider = widenProfile(prof, shifted);
  assert.equal(JSON.stringify(prof), snapshot, 'the input profile is unchanged');
  assert.equal(wider.n, 5);
  assert.equal(checkProfile(wider, shifted).novel, false, 'a merged task is no longer novel');
  assert.deepEqual(widenProfile(null, shifted), learnProfile([shifted]));
});

test('empty profiles, size ablation, near misses', () => {
  const e = checkProfile(emptyProfile(), mkTask(1));
  assert.equal(e.novel, true);
  assert.equal(e.reasons[0].feature, 'empty-profile');
  const prof = learnProfile(train(8)), big = mkTask(99, { rows: 120 });
  assert.equal(checkProfile(prof, big).novel, true);
  const blind = checkProfile(prof, big, { ignore: SIZE_FEATURES });
  assert.equal(blind.novel, false, 'only size changed');
  assert.ok(blind.reasons.every(r => !SIZE_FEATURES.includes(r.feature)));
  const ok = checkProfile(prof, mkTask(5001));
  assert.ok(ok.near.length > 0 && ok.near.every(r => r.ratio <= 1));
  assert.throws(() => checkProfile({ schema: 'other' }, mkTask(1)), /not a profile/);
});

test('eval-profiles: task keys, outcomes and a replayed arm', () => {
  assert.deepEqual(parseTaskKey('records:dev:d4:s217'), { familyId: 'records', split: 'dev', difficulty: 4, seed: 217 });
  assert.equal(parseTaskKey('nope'), null);
  assert.equal(outcomeOf({ compiledStatus: null }, 5, 3), 'interpreted');
  assert.equal(outcomeOf({ compiledStatus: 'ok', delivered: 'compiled', pass: false }, 5, 3), 'silent-miss');
  assert.equal(outcomeOf({ compiledStatus: 'ok', delivered: 'adjudicated' }, 5, 3), 'overruled');
  assert.equal(outcomeOf({ compiledStatus: 'deopt' }, 5, 3), 'deopt');
  assert.equal(outcomeOf({ compiledStatus: 'ok' }, 1, 3), 'warmup');
  // A static-like arm: 3 warmup-position rows, 6 same-distribution compiled passes, then 4 drifted silent misses.
  const tasks = [...Array.from({ length: 9 }, (_, i) => mkTask(3000 + i)), ...Array.from({ length: 4 }, (_, i) => mkTask(3100 + i, { rows: 120, newDialect: 10 }))];
  const rows = tasks.map((_, i) => ({ idx: i, taskKey: `fam:dev:d${i < 9 ? 3 : 4}:s${i}`, difficulty: i < 9 ? 3 : 4, kind: 'static', compiledStatus: 'ok', delivered: 'compiled', pass: i < 9 }));
  const res = evaluateArm(rows, r => tasks[r.idx], { warmup: 3, kind: 'static' });
  assert.deepEqual(Object.keys(res.policies), ['frozen', 'interp']);
  const s = res.policies.frozen.summary;
  assert.equal(s.checked, 10);
  assert.equal(s.silentMisses, 4);
  assert.equal(s.recallOnSilentMisses, 1);
  assert.equal(s.falseAlarmRate, 0);
  assert.equal(s.byDifficulty.d4.firstNovelIdx, 9);
  const blind = evaluateArm(rows, r => tasks[r.idx], { warmup: 3, kind: 'static', ignore: SIZE_FEATURES }).policies.frozen.summary;
  assert.equal(blind.recallOnSilentMisses, 1, 'the new dialect is visible without size');
  // A JIT arm gets the version policy: profile of the version's compile pool, widened by shadow-confirmed runs.
  const jitRows = rows.map((r, i) => ({ ...r, kind: 'jit', version: i >= 3 ? 1 : null, compiledStatus: i >= 3 ? 'ok' : null, delivered: i >= 3 ? 'compiled' : 'interpreter',
    stateAfter: { traces: [0, 1, 2].filter(q => q <= i).map(q => ({ idx: q })), version: i >= 3 ? { n: 1, adoptedAt: 3 } : null } }));
  const jit = evaluateArm(jitRows, r => tasks[r.idx], { warmup: 3, kind: 'jit' });
  assert.deepEqual(Object.keys(jit.policies), ['frozen', 'interp', 'version']);
  assert.equal(jit.policies.version.summary.silentMissesNovel, 4);
  assert.equal(summarize([{ skipped: 'no task' }]).checked, 0);
});
