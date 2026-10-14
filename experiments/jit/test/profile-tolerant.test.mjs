// profile.mjs slice 2a (design/FLOW-V3-SLICE2.md §2): the opt-in v2 observation (JSON-lines fields, tolerant line shapes)
// and the tolerant check options, plus the R4 measurement the slice is judged on: false refusals of in-profile R1 packs
// (target <= 1/20 at child d3 and d4) while every planted CYYDDD pack stays refused (24/24). Dev evidence only: the
// options were chosen on these packs (parents dev 341-346), and 301-324 is a second dev set measured with the same
// options. No model calls; beds/ is only read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { learnProfile, checkProfile, looseLineShape, lineShape, checkOptionsOf, profileSupports, PARAMS, PARAMS_V2, OBSERVE_V2, TOLERANT_CHECK, SIZE_FEATURES, JL } from '../profile.mjs';
import * as R1 from '../../../beds/wbed/r1/index.mjs';
import * as R4 from '../../../beds/wbed/r4/index.mjs';
import { fmtJulian } from '../../../beds/wbed/lib/dialects.mjs';
import { dayNum } from '../../../beds/wbed/lib/domain.mjs';

const features = c => c.reasons.map(r => r.feature);

test('defaults are slice 1: PARAMS has no observe options, a default profile has no v2 maps or JSON-lines paths, and {} check options are the v1 check', () => {
  assert.equal('observe' in PARAMS, false);
  assert.deepEqual(PARAMS_V2.observe, OBSERVE_V2);
  const tasks = [1, 2, 3].map(i => ({ prompt: 'p', inputs: { rows: [`{"id":"A${i}","when":"2024-0${i}-01"}`, `{"id":"B${i}","when":"2024-0${i}-02"}`, `{"id":"C${i}","when":"2024-0${i}-03"}`].join('\n') } }));
  const v1 = learnProfile(tasks), v2 = learnProfile(tasks, PARAMS_V2);
  assert.equal(JSON.stringify(v1).includes(JL), false); assert.equal(JSON.stringify(v1).includes('Loose'), false);
  assert.ok(v2.paths[`inputs.rows${JL}.when`], 'v2 walks JSON-lines fields');
  assert.ok(v2.paths['inputs.rows'].lineSigsLoose && v2.paths['inputs.rows'].lineFamsLoose);
  assert.equal(v2.paths[`inputs.rows${JL}.id`].values, undefined, 'no enum values inside JSON lines');
  assert.deepEqual(checkProfile(v1, tasks[0], {}), checkProfile(v1, tasks[0]));
  assert.deepEqual(checkOptionsOf({ lineFormat: 'exact', vocabMinUnseen: 1, ignore: [] }), {}, 'defaults are dropped');
  assert.deepEqual(checkOptionsOf(TOLERANT_CHECK), { ignore: [...SIZE_FEATURES].sort(), lineFormat: 'tolerant', vocabMinUnseen: 2 });
  assert.throws(() => checkOptionsOf({ lineFormat: 'loose' }), /lineFormat must be one of/);
  assert.throws(() => checkOptionsOf({ vocabMinUnseen: 0 }), /vocabMinUnseen/);
  assert.throws(() => checkOptionsOf({ nope: 1 }), /not supported/);
  assert.equal(profileSupports(v1, TOLERANT_CHECK), false); assert.equal(profileSupports(v2, TOLERANT_CHECK), true); assert.equal(profileSupports(v1, {}), true);
  assert.throws(() => checkProfile(v1, tasks[0], TOLERANT_CHECK), /needs a profile learned with observe\.looseLines/);
});

test('looseLineShape: quoted and thousands separators do not cut fields; a digit label is a value; digit fields keep their shape and date group lengths', () => {
  assert.deepEqual(looseLineShape('BD-1,99,10/17/2024,"1,861.62",void'), { sig: 'BD~comma:A-9¦9¦##/##/####¦"9.9"¦A', family: 'BD~comma:5', record: true });
  assert.equal(looseLineShape('BD-1,99,10/17/2024,"61.62",void').family, 'BD~comma:5', 'with or without a thousands separator: five fields');
  assert.equal(lineShape('BD-1,99,10/17/2024,"1,861.62",void').family, 'BD~comma:6', 'the v1 shape cuts the quoted amount');
  assert.equal(looseLineShape('TALLY T-2 cust=37 date=10-01-25 amt=JPY 1,053,317 st=active').sig, 'TALLY~text', 'thousands separators are not delimiters');
  // (a field's shape is capped at PARAMS.fieldMax characters, as in v1)
  assert.equal(looseLineShape('V-6255 (entry 5592), dated 5 August 2024: USD 54.80, parked.').sig, 'V~comma:A-9 (A 9)¦A 9 A 9: A 9¦A', 'a dated label is a value field');
  assert.equal(lineShape('V-6255 (entry 5592), dated 5 August 2024: USD 54.80, parked.').sig, 'V~comma:A9¦dated 5 August 2024=¦A', 'v1: the date is part of a key');
  assert.notEqual(looseLineShape('K-1 | 2024/10/25 | 9 | x').sig, looseLineShape('K-1 | 25/10/2024 | 9 | x').sig, 'YYYY/MM/DD and DD/MM/YYYY differ');
  assert.notEqual(looseLineShape('RE-1;16;07.09.2024;87,91 CHF;offen').sig, looseLineShape('RE-1;16;125032;87,91 CHF;offen').sig, 'a CYYDDD date differs');
  assert.notEqual(looseLineShape('RE-1;16;07.09.2024;4.487,18 EUR;offen').sig, looseLineShape('RE-1;16;07.09.2024;EUR 4,487.18;offen').sig, 'an amount convention differs');
  assert.equal(looseLineShape('cust=1;name=x;y=2').sig, 'cust~semi:cust=¦name=¦y=', 'plain key labels stay keys');
  assert.equal(looseLineShape('{"a":1,"b":"x"}').record, true); assert.equal(looseLineShape('just some prose here').record, false);
});

test('JSON-lines fields: a format change inside a JSON-lines string is novel under v2 (exact or tolerant) and invisible to v1', () => {
  const day = i => `2024-${String(1 + (i % 9)).padStart(2, '0')}-${String(10 + (i % 17)).padStart(2, '0')}`;
  const mk = (seed, fmt = d => d) => ({ prompt: 'Close the ledger.', inputs: { ledger: Array.from({ length: 6 + (seed % 4) }, (_, i) => JSON.stringify({ invoice: `VR-${seed}${i}`, issued: fmt(day(seed + i)), amount: `${seed + i}.50`, state: ['open', 'paid'][i % 2] })).join('\n') } });
  const train = Array.from({ length: 12 }, (_, i) => mk(100 + i));
  const v1 = learnProfile(train), v2 = learnProfile(train, PARAMS_V2);
  const ok = mk(200), julian = mk(200, d => { const [y, m, dd] = d.split('-').map(Number); return fmtJulian(dayNum(y, m, dd)); });
  assert.equal(checkProfile(v2, ok, TOLERANT_CHECK).novel, false); assert.equal(checkProfile(v2, ok).novel, false);
  assert.equal(checkProfile(v1, julian, { ignore: SIZE_FEATURES }).novel, false, 'v1 sees only the JSON key shape of each line');
  for (const opts of [{}, TOLERANT_CHECK]) {
    const c = checkProfile(v2, julian, opts);
    assert.equal(c.novel, true); assert.ok(c.reasons.some(r => r.path === `inputs.ledger${JL}.issued` && ['pattern-class', 'shape'].includes(r.feature)), JSON.stringify(c.reasons));
  }
  // A new key in the records is a new path under the record path; records gone entirely are not reported per field.
  const extra = { ...ok, inputs: { ledger: ok.inputs.ledger.replace(/"state"/g, '"status"') } };
  assert.ok(checkProfile(v2, extra, TOLERANT_CHECK).reasons.some(r => r.feature === 'new-path' && r.path === `inputs.ledger${JL}.status`));
});

test('tolerant lines: the rate is line-weighted; one odd line in a long list passes, a re-rendered column does not; a one-line list is checked as a line; vocabMinUnseen', () => {
  const line = (i, d = `${String(1 + (i % 28)).padStart(2, '0')}.0${1 + (i % 9)}.2024`) => `RE-${1000 + i};${200 + i};${d};${(i * 7.3).toFixed(2).replace('.', ',')} EUR;${['offen', 'bezahlt'][i % 2]}`;
  const mk = (seed, n = 30, f = line) => ({ prompt: 'p', inputs: { list: Array.from({ length: n }, (_, i) => f(seed * 31 + i)).join('\n'), notes: 'The ledger lists every open invoice with its amount and the date it was raised in the system.' } });
  const train = Array.from({ length: 10 }, (_, i) => mk(i));
  const v2 = learnProfile(train, PARAMS_V2);
  const odd = mk(50); odd.inputs.list += '\nRE-9;9;--;9 EUR;offen';
  assert.equal(checkProfile(v2, odd, TOLERANT_CHECK).novel, false, 'one odd line in 31');
  assert.ok(features(checkProfile(v2, odd, { ignore: SIZE_FEATURES })).includes('line-format'), 'the exact check refuses it (one unseen signature of two)');
  const planted = mk(51, 30, i => line(i, fmtJulian(dayNum(2024, 1 + (i % 9), 1 + (i % 28)))));
  const c = checkProfile(v2, planted, TOLERANT_CHECK);
  assert.equal(c.novel, true); const r = c.reasons.find(x => x.feature === 'line-format');
  assert.equal(r.weighted, true); assert.equal(r.unseenLines, 30); assert.equal(r.lines, 30);
  // One line: v1 observes it as a short string (class and shape); tolerant checks it as a line of the list.
  const one = mk(52, 1);
  assert.equal(checkProfile(v2, one, TOLERANT_CHECK).novel, false);
  assert.ok(checkProfile(v2, mk(53, 1, i => line(i, '125032')), TOLERANT_CHECK).novel, 'a one-line list in a new format is still novel');
  // Vocabulary: one unseen word in prose is a reason by default, not with vocabMinUnseen 2; two are.
  const word1 = mk(54); word1.inputs.notes = word1.inputs.notes.replace('raised', 'parked');
  const word2 = mk(55); word2.inputs.notes = word2.inputs.notes.replace('raised', 'parked').replace('open', 'routed');
  assert.ok(features(checkProfile(v2, word1)).includes('vocabulary'));
  const w1 = checkProfile(v2, word1, { vocabMinUnseen: 2 });
  assert.equal(features(w1).includes('vocabulary'), false); assert.ok(w1.near.some(x => x.feature === 'vocabulary' && x.belowMinUnseen === 2));
  assert.ok(features(checkProfile(v2, word2, { vocabMinUnseen: 2 })).includes('vocabulary'));
});

// ---- the R4 measurement (W-BED-R4-NOTES §6 and §10 item 4; FLOW-V3-SLICE2 §2) ----
const R1_STREAM = () => [...Array.from({ length: 16 }, (_, i) => R1.generate({ seed: 301 + i, split: 'dev', difficulty: 3 })),
  ...Array.from({ length: 8 }, (_, i) => R1.generate({ seed: 317 + i, split: 'dev', difficulty: 4 }))];
function measure(profile, opts, parents) {
  const st = { planted: { novel: 0, n: 0, onSystem: 0 }, 'in-d3': { novel: 0, n: 0 }, 'in-d4': { novel: 0, n: 0 } };
  for (const d of [2, 3, 4, 5]) for (const seed of parents) {
    const task = R4.generate({ seed, split: 'dev', difficulty: d });
    for (const k of R4.childrenOf(task).filter(x => x.family === 'wbed-r1')) {
      const ct = R4.childTask(task, k.sub_id), p = checkProfile(profile, { prompt: ct.prompt, inputs: ct.inputs }, opts);
      const b = k.outsideProfile ? st.planted : st[`in-d${k.difficulty}`];
      b.n++; if (p.novel) b.novel++;
      if (k.outsideProfile && p.reasons.some(r => r.path?.startsWith(`inputs.invoices.${k.planted.system}`))) b.onSystem++;
    }
  }
  return st;
}

test('R4 measurement, parents dev 341-346 (the R4-NOTES set): v1 refuses 5/18 and 13/24 in-profile packs; v2 + TOLERANT_CHECK refuses 0/18 and 0/24; both refuse 24/24 planted packs on the planted system', () => {
  const train = R1_STREAM(), parents = [341, 342, 343, 344, 345, 346];
  const before = measure(learnProfile(train), {}, parents), after = measure(learnProfile(train, PARAMS_V2), TOLERANT_CHECK, parents);
  console.log('[slice2 profile] before', JSON.stringify(before), 'after', JSON.stringify(after));
  assert.deepEqual(before, { planted: { novel: 24, n: 24, onSystem: 24 }, 'in-d3': { novel: 5, n: 18 }, 'in-d4': { novel: 13, n: 24 } });
  assert.deepEqual(after, { planted: { novel: 24, n: 24, onSystem: 24 }, 'in-d3': { novel: 0, n: 18 }, 'in-d4': { novel: 0, n: 24 } });
  for (const k of ['in-d3', 'in-d4']) assert.ok(after[k].novel / after[k].n <= 1 / 20, `${k} false refusals <= 1/20`);
});

test('VERITAS (JSON lines), the R4 blind spot: re-dating VERITAS in CYYDDD on in-profile packs is refused by v2 + TOLERANT_CHECK on every pack, and is not by v1 beyond its false-alarm rate', () => {
  const train = R1_STREAM(), v1 = learnProfile(train), v2 = learnProfile(train, PARAMS_V2);
  const jul = iso => { const [y, m, d] = iso.split('-').map(Number); return fmtJulian(dayNum(y, m, d)); };
  let n = 0, v1Novel = 0, v1Base = 0, v2Novel = 0, onField = 0;
  for (const d of [2, 3, 4, 5]) for (const seed of [341, 342, 343, 344, 345, 346]) {
    const task = R4.generate({ seed, split: 'dev', difficulty: d });
    for (const k of R4.childrenOf(task).filter(x => x.family === 'wbed-r1' && !x.outsideProfile)) {
      const ct = R4.childTask(task, k.sub_id);
      if (!ct.inputs.invoices.VERITAS) continue;
      const t = { prompt: ct.prompt, inputs: { ...ct.inputs, invoices: { ...ct.inputs.invoices, VERITAS: ct.inputs.invoices.VERITAS.replace(/"issued":"(\d{4}-\d{2}-\d{2})"/g, (_, x) => `"issued":"${jul(x)}"`) } } };
      n++;
      if (checkProfile(v1, t, { ignore: SIZE_FEATURES }).novel) v1Novel++;
      if (checkProfile(v1, { prompt: ct.prompt, inputs: ct.inputs }, { ignore: SIZE_FEATURES }).novel) v1Base++;
      const c = checkProfile(v2, t, TOLERANT_CHECK);
      if (c.novel) v2Novel++;
      if (c.reasons.some(r => r.path === `inputs.invoices.VERITAS${JL}.issued`)) onField++;
    }
  }
  console.log('[slice2 profile] VERITAS CYYDDD plants', JSON.stringify({ n, v1Novel, v1BaselineFalseAlarms: v1Base, v2Novel, onField }));
  assert.equal(n, 42); assert.equal(v2Novel, n); assert.equal(onField, n);
  assert.equal(v1Novel, v1Base, 'v1 refuses exactly the packs it refuses without the plant: the plant itself is invisible to it');
});
