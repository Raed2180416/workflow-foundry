// Health and regression tests for the `records` bed (beds/CONTRACT.md "Oracle health" + beds/records/AUDIT.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as bed from './index.mjs';
import { solveText, ABLATIONS, COUNTRY_ALIAS } from './solve-text.mjs';
import { budgetSolve } from './attacks/budget.mjs';
import { trivialSolve as denseV1 } from './attacks/dense-v1.mjs';
import { attackPassRate } from './attacks/run.mjs';
import { canonical, estimateTokens } from '../lib/canonical.mjs';
import * as P from './pools.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const SEEDS = Array.from({ length: 20 }, (_, i) => i);
const SEEDS30 = Array.from({ length: 30 }, (_, i) => i);
const taskCache = new Map();
const task = (seed, difficulty, split = 'dev') => {
  const key = `${split}|${difficulty}|${seed}`;
  if (!taskCache.has(key)) taskCache.set(key, bed.generate({ seed, split, difficulty }));
  return taskCache.get(key);
};
const textOf = t => `${t.prompt}\n${t.inputs.source_notes}\n${t.inputs.spec}\n${t.inputs.export}`;
const passes = (d, seeds, solve) => seeds.filter(seed => { const t = task(seed, d); return bed.oracle(t, solve(t)).pass; }).length;

// ---------------------------------------------------------------------------------------
// Contract conformance
test('interface shape and portable schema subset', () => {
  assert.equal(bed.family.id, 'records');
  assert.equal(bed.family.kind, 'oneshot');
  for (const key of ['id', 'domain', 'version', 'description']) assert.ok(bed.family[key], key);
  for (const fn of ['generate', 'oracle', 'referenceSolve']) assert.equal(typeof bed[fn], 'function', fn);
  const names = bed.badControls.map(c => c.name);
  for (const required of ['empty', 'shuffled-or-corrupted', 'no-dedup', 'birthdate-key']) assert.ok(names.includes(required), required);
  assert.equal(new Set(names).size, names.length, 'control names unique');
  const allowed = new Set(['type', 'required', 'properties', 'items', 'minItems', 'maxItems', 'maxLength', 'enum', 'additionalProperties']);
  const walk = s => {
    for (const [k, v] of Object.entries(s)) {
      assert.ok(allowed.has(k), `schema keyword ${k}`);
      if (k === 'properties') for (const sub of Object.values(v)) walk(sub); else if (k === 'items') walk(v);
    }
  };
  walk(bed.outputSchema);
});

test('task shape and determinism (byte-identical tasks, split salts the RNG, oracle repeatable)', () => {
  for (const d of DIFFS) {
    const a = bed.generate({ seed: 11, split: 'dev', difficulty: d });
    const b = bed.generate({ seed: 11, split: 'dev', difficulty: d });
    assert.equal(canonical(a), canonical(b), `byte-identical at d${d}`);
    assert.deepEqual(Object.keys(a).sort(), ['budget', 'difficulty', 'family', 'id', 'inputs', 'prompt', 'seed', 'split']);
    assert.equal(typeof a.prompt, 'string');
    for (const k of ['export', 'source_notes', 'spec']) assert.equal(typeof a.inputs[k], 'string');
    assert.notEqual(bed.generate({ seed: 12, split: 'dev', difficulty: d }).inputs.export, a.inputs.export, 'seed changes the task');
    assert.notEqual(bed.generate({ seed: 11, split: 'test', difficulty: d }).inputs.export, a.inputs.export, 'split salts the RNG');
    const out = bed.referenceSolve(a);
    assert.equal(canonical(bed.oracle(a, out)), canonical(bed.oracle(b, out)), 'oracle deterministic');
  }
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 6 }));
  assert.throws(() => bed.generate({ seed: 1, split: 'holdout', difficulty: 1 }));
});

// ---------------------------------------------------------------------------------------
// Controls
test('referenceSolve passes with full score: 30 seeds at d1/d3/d5, 20 at d2/d4, plus the test split', () => {
  for (const d of DIFFS) {
    for (const seed of d % 2 ? SEEDS30 : SEEDS) {
      const r = bed.oracle(task(seed, d), bed.referenceSolve(task(seed, d)));
      assert.equal(r.pass, true, `d${d} seed ${seed}`);
      assert.equal(r.score, 1, `d${d} seed ${seed}`);
    }
    for (const seed of [100, 101, 102]) assert.equal(bed.oracle(task(seed, d, 'test'), bed.referenceSolve(task(seed, d, 'test'))).score, 1);
  }
});

test('every bad control fails on 30 seeds at every difficulty', () => {
  for (const c of bed.badControls) {
    for (const d of DIFFS) {
      for (const seed of SEEDS30) {
        const t = task(seed, d);
        const r = bed.oracle(t, c.make(t));
        assert.equal(r.pass, false, `${c.name} passed at d${d} seed ${seed}`);
        assert.ok(r.score < 1, `${c.name} full score at d${d} seed ${seed}`);
      }
    }
  }
});

test('truth is derivable from the rendered text alone (independent text-level solver, both splits)', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS) {
      for (const split of ['dev', 'test']) {
        const t = task(seed, d, split);
        const r = bed.oracle(t, solveText(t));
        assert.equal(r.score, 1, `${split} d${d} seed ${seed}: ${JSON.stringify(r.details.mismatches?.slice(0, 3))}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------------------
// Oracle validity and bypass attempts (AUDIT step 3)
test('oracle rejects schema-invalid output, including oversized and non-finite values', () => {
  const t = task(3, 2);
  const ref = bed.referenceSolve(t);
  const first = patch => ({ records: ref.records.map((r, i) => (i === 0 ? { ...r, ...patch } : r)) });
  const bad = [
    null, undefined, 'records', [], {}, { records: 'x' }, { records: {} }, { records: [{}] }, { records: [null] }, ref.records,
    first({ entity_id: String(ref.records[0].entity_id) }), first({ entity_id: ref.records[0].entity_id + 0.5 }),
    first({ amount_usd: '12.00' }), first({ source_rows: [] }), first({ birth_date: undefined }),
    { records: ref.records.map((r, i) => (i === 0 ? (({ phone_e164, ...rest }) => rest)(r) : r)) },
    first({ amount_usd: Number.NaN }), first({ amount_usd: Infinity }),
    first({ given_name: 'x'.repeat(bed.LIMITS.text + 1) }),
    first({ source_rows: Array.from({ length: bed.LIMITS.sourceRows + 1 }, (_, i) => i) }),
    { records: Array.from({ length: bed.LIMITS.records + 1 }, (_, i) => ({ ...ref.records[0], entity_id: i, source_rows: [i] })) },
  ];
  for (const out of bad) {
    const r = bed.oracle(t, out);
    assert.equal(r.pass, false);
    assert.equal(r.score, 0);
    assert.equal(r.details.reason, 'schema-invalid');
  }
  const dup = structuredClone(ref);
  dup.records[1].source_rows.push(dup.records[0].source_rows[0]);
  assert.equal(bed.oracle(t, dup).details.reason, 'row-in-multiple-records');
});

test('degenerate outputs never pass (bypass probes), and hostile sizes are rejected fast', () => {
  const rowIds = t => t.inputs.export.split('\n').map(l => Number(l.match(/\d+/)[0]));
  const blank = id => ({ entity_id: id, source_rows: [id], given_name: '', family_name: '', birth_date: null, country: null, phone_e164: null, amount_usd: null });
  const probes = {
    'all-rows-one-record': t => ({ records: [{ ...blank(Math.min(...rowIds(t))), source_rows: rowIds(t) }] }),
    'every-row-alone': t => ({ records: rowIds(t).map(blank) }),
    'right-clusters-blank-fields': t => ({ records: bed.referenceSolve(t).records.map(r => ({ ...blank(r.entity_id), source_rows: r.source_rows })) }),
    'records-duplicated': t => { const r = bed.referenceSolve(t).records; return { records: [...r, ...r] }; },
    'records-doubled-with-fake-ids': t => {
      const r = bed.referenceSolve(t).records;
      return { records: [...r, ...r.map(x => ({ ...x, entity_id: x.entity_id + 1e5, source_rows: x.source_rows.map(i => i + 1e5) }))] };
    },
  };
  for (const [name, make] of Object.entries(probes)) {
    for (const d of [1, 3, 5]) for (const seed of SEEDS.slice(0, 10)) assert.equal(bed.oracle(task(seed, d), make(task(seed, d))).pass, false, `${name} d${d} s${seed}`);
  }
  // Extra properties on a correct answer are allowed (documented) and do not change the score.
  const t = task(4, 3);
  const extra = { meta: 1, records: bed.referenceSolve(t).records.map(r => ({ ...r, confidence: 0.9 })) };
  assert.equal(bed.oracle(t, extra).score, 1);
  const huge = { records: Array.from({ length: 200000 }, (_, i) => ({ entity_id: i, source_rows: [i] })) };
  const t0 = performance.now();
  assert.equal(bed.oracle(t, huge).details.reason, 'schema-invalid');
  assert.ok(performance.now() - t0 < 200, 'oversized output rejected without walking it');
});

test('oracle tolerance: one wrong field still passes; formatting noise is not graded', () => {
  for (const d of DIFFS) {
    const t = task(5, d);
    const ref = bed.referenceSolve(t);
    const one = structuredClone(ref);
    one.records.find(r => r.amount_usd !== null).amount_usd += 0.01;
    const r = bed.oracle(t, one);
    assert.equal(r.pass, true, `d${d}`);
    assert.ok(r.score < 1);
    const noisy = structuredClone(ref);
    for (const rec of noisy.records) {
      rec.given_name = rec.given_name.toUpperCase();
      rec.family_name = ` ${rec.family_name.toLowerCase()} `;
      if (rec.country) rec.country = rec.country.toLowerCase();
    }
    noisy.records.reverse();
    assert.equal(bed.oracle(t, noisy).score, 1, `d${d} case/order noise`);
  }
});

// ---------------------------------------------------------------------------------------
// Truth leakage (AUDIT step 2)
test('hidden truth does not leak into prompt, notes, spec or export; row order carries no cluster signal', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS.slice(0, 10)) {
      const t = task(seed, d);
      const text = textOf(t);
      const ref = bed.referenceSolve(t);
      for (const rec of ref.records) {
        assert.ok(!text.includes(canonical(rec)), 'record JSON');
        if (rec.source_rows.length > 1) assert.ok(!text.includes(JSON.stringify(rec.source_rows)), 'cluster membership');
        if (rec.phone_e164) assert.ok(!text.includes(rec.phone_e164), `phone ${rec.phone_e164}`);
      }
      const w = bed.buildWorld(seed, 'dev', d);
      for (const rec of ref.records) {
        const rows = w.rows.filter(x => rec.source_rows.includes(x.rowId) && x.s.amount);
        const winner = rows.sort((a, b) => b.date - a.date)[0];
        if (!winner || winner.s.amount.currency === 'USD') continue;
        assert.ok(!new RegExp(`(^|[^\\d.,])${rec.amount_usd.toFixed(2).replace('.', '\\.')}(?!\\d|\\.\\d)`).test(text), `amount ${rec.amount_usd}`);
      }
      assert.ok(!/entity_id":(?!17,)/.test(text), 'only the prompt example mentions entity_id');
      // Export lines are sorted by row id, so line order says nothing about which rows belong together.
      const ids = t.inputs.export.split('\n').map(l => Number(l.match(/\d+/)[0]));
      assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
    }
  }
  // Adjacent export lines are no more likely to be the same person than random pairs (no ordering leak).
  let adjSame = 0, adj = 0;
  for (const seed of SEEDS) {
    const t = task(seed, 3);
    const of = new Map(bed.referenceSolve(t).records.flatMap((r, i) => r.source_rows.map(id => [id, i])));
    const ids = t.inputs.export.split('\n').map(l => Number(l.match(/\d+/)[0]));
    for (let i = 1; i < ids.length; i++) { adj++; if (of.has(ids[i]) && of.get(ids[i]) === of.get(ids[i - 1])) adjSame++; }
  }
  assert.ok(adjSame / adj < 0.06, `adjacent-same-person rate ${(adjSame / adj).toFixed(3)}`);
});

// ---------------------------------------------------------------------------------------
// Difficulty
test('difficulty sanity: size, token budget and adversarial content grow with difficulty', () => {
  const avg = (d, f) => SEEDS.slice(0, 8).reduce((s, seed) => s + f(task(seed, d)), 0) / 8;
  assert.deepEqual(DIFFS.map(d => avg(d, t => t.inputs.export.split('\n').length)), [30, 55, 85, 115, 150]);
  const tokens = DIFFS.map(d => avg(d, t => estimateTokens(t.prompt) + estimateTokens(t.inputs)));
  for (let i = 1; i < tokens.length; i++) assert.ok(tokens[i] > tokens[i - 1], `tokens grow at d${i + 1}`);
  assert.ok(tokens[2] >= 6000 && tokens[2] <= 15000, `d3 ≈ 6–15K tokens (got ${tokens[2]})`);
  const ents = DIFFS.map(d => avg(d, t => bed.referenceSolve(t).records.length));
  for (let i = 1; i < ents.length; i++) assert.ok(ents[i] > ents[i - 1]);
  const adv = /merge the two accounts|correct date of birth is|finance confirmed|AI ASSISTANT|SYSTEM: canonical name|set the country accordingly|exclude it from the migration|delete this one|Note to the migration tool/g;
  const advCount = DIFFS.map(d => avg(d, t => (t.inputs.export.match(adv) ?? []).length));
  assert.equal(advCount[0], 0);
  for (let i = 2; i < advCount.length; i++) assert.ok(advCount[i] > advCount[i - 1]);
  for (const d of DIFFS) {
    const t = task(0, d);
    assert.equal(/ATLAS[^\n]*US[- ]host/.test(t.inputs.source_notes), d >= 4, `ATLAS cutoff note at d${d}`);
    assert.equal(/Table B1/.test(t.inputs.spec), d === 5, `dated FX at d${d}`);
    assert.equal(/Shōwa/.test(t.inputs.source_notes), d >= 3, `era note at d${d}`);
    assert.equal(/USD\/JPY/.test(t.inputs.spec), d >= 3, `market FX pairs at d${d}`);
  }
});

// ---------------------------------------------------------------------------------------
// Regression tests for AUDIT findings (each fix has one)
test('F1 regression: same-birth-date people exist at every level, so birth date is not an identity key', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS) {
      const w = bed.buildWorld(seed, 'dev', d);
      const live = w.entities.filter(e => e.role !== 'void');
      const byDob = new Map();
      for (const e of live) { const k = `${e.dob.y}-${e.dob.m}-${e.dob.d}`; byDob.set(k, (byDob.get(k) ?? 0) + 1); }
      const shared = [...byDob.values()].filter(n => n > 1).length;
      assert.ok(shared >= w.L.mates + w.L.twins, `d${d} s${seed}: ${shared} shared birth dates`);
    }
  }
  // Near-twins (same family and birth date, given names exactly two edits apart) are common from d2.
  let near = 0, twins = 0;
  for (const seed of SEEDS) {
    const w = bed.buildWorld(seed, 'dev', 3);
    for (const e of w.entities.filter(x => x.role === 'twinA')) { twins++; if (P.partDistance(e.given, w.entities[e.partner].given) === 2) near++; }
  }
  assert.ok(near / twins >= 0.6, `near-twin share ${near}/${twins}`);
  // A matcher that tolerates two typing errors merges them and fails most d3 tasks.
  assert.ok(passes(3, SEEDS, t => solveText(t, { ablate: 'lenient-names' })) <= 4);
});

test('F2 regression: memo text that mentions a void marker does not void the row', () => {
  const decoy = /not a ZZTEST|ZZTEST copy|marked DO NOT MIGRATE|not a DO NOT MIGRATE|SAMPLE order|sample pack|sandbox environment|sandbox retry|application was withdrawn in|withdrawn once/;
  for (const d of [2, 3, 4, 5]) for (const seed of SEEDS.slice(0, 5)) assert.ok(decoy.test(task(seed, d).inputs.export), `decoy at d${d} s${seed}`);
  assert.ok(!decoy.test(task(0, 1).inputs.export));
  assert.ok(passes(3, SEEDS, t => solveText(t, { ablate: 'keyword-voids' })) <= 2, 'keyword voiding fails at d3');
});

test('F3 regression: phone calling code does not name the country (movers keep numbers; expats)', () => {
  let mism = 0, n = 0;
  for (const seed of SEEDS) {
    for (const rec of bed.referenceSolve(task(seed, 3)).records) {
      if (!rec.phone_e164 || !rec.country) continue;
      n++; if (!rec.phone_e164.startsWith(`+${P.COUNTRIES[rec.country].cc}`)) mism++;
    }
  }
  assert.ok(mism / n >= 0.08, `phone/country mismatch share ${(mism / n).toFixed(3)}`);
  assert.ok(passes(3, SEEDS, t => solveText(t, { ablate: 'country-from-phone' })) <= 12);
  // KOBO renders every phone as a Japanese local number, so it only holds Japanese numbers.
  for (const seed of SEEDS) {
    const w = bed.buildWorld(seed, 'dev', 5);
    for (const row of w.allRows.filter(x => x.system === 'KOBO')) assert.equal(row.phone.iso, 'JP');
  }
});

test('F4 regression: VENDEX paraphrase variety, US numeric dates, cities, credit phrasing, a/an', () => {
  const lines = SEEDS.flatMap(seed => task(seed, 4).inputs.export.split('\n').filter(l => l.startsWith('Vendex ')));
  const has = re => lines.some(l => re.test(l));
  for (const re of [/— Supplier contact /, / supplier,| based in [^,;]+,/, /— Entry revised [^:]+: /, /— Spoke with .+ on /, / — last revised /]) assert.ok(has(re), `template ${re}`);
  assert.ok(has(/(?:born|DOB|b\.|date of birth|Born|Date of birth) \d{1,2}\/\d{1,2}\/\d{2,4}/), 'numeric US birth dates');
  assert.ok(has(/revised \d\d\/\d\d\/\d{4}/), 'numeric US revision dates');
  assert.ok(has(/we owe them|credit balance of/), 'credit phrasing');
  const cities = new Set(Object.values(P.CITIES).flat());
  assert.ok(lines.some(l => [...cities].some(c => l.includes(`based in ${c}`) || l.includes(`(${c})`) || l.includes(`— ${c} —`))), 'city-implied countries');
  assert.ok(!lines.some(l => /\ba (American|Australian|Austrian|Irish|Italian)\b/.test(l)), 'article agrees');
  assert.ok(passes(3, SEEDS, t => solveText(t, { ablate: 'vendex-dmy' })) <= 4, 'reading VENDEX dates day-first fails');
});

test('F5 regression: FX market quotes (divide USD/XXX) and paraphrased ATLAS cutoff notes', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const spec = task(seed, 3).inputs.spec;
    assert.match(spec, /^ {5}EUR\/USD {2}\d+\.\d{4}$/m);
    assert.match(spec, /^ {5}USD\/JPY {2}\d+\.\d{4}$/m);
  }
  let wrong = 0;
  for (const seed of SEEDS) {
    const t = task(seed, 5);
    const r = bed.oracle(t, solveText(t, { ablate: 'pairs-multiply' }));
    wrong += r.details.perField.amount_usd < 1 ? 1 : 0;
  }
  assert.ok(wrong >= 18, `multiplying by USD/XXX rates is wrong in ${wrong}/20 tasks`);
  const styles = new Set(SEEDS.map(seed => task(seed, 4).inputs.source_notes.split('\n').find(l => l.startsWith('ATLAS.')).match(/On \d|Since its migration|Caution: rows/)?.[0]));
  assert.equal(styles.size, 3, 'all three ATLAS cutoff paraphrases occur');
});

test('F6 regression: merge memos are sometimes true, so "memo mentions row N" is no signal', () => {
  let truthful = 0, lying = 0;
  for (const d of [3, 4, 5]) {
    for (const seed of SEEDS) {
      const t = task(seed, d);
      const of = new Map(bed.referenceSolve(t).records.flatMap((r, i) => r.source_rows.map(id => [id, i])));
      for (const line of t.inputs.export.split('\n')) {
        const m = line.match(/(?:Same person as|Duplicate of) row (\d+)/);
        if (!m) continue;
        const self = Number(line.match(/\d+/)[0]);
        if (of.get(self) === of.get(Number(m[1]))) truthful++; else lying++;
      }
    }
  }
  assert.ok(truthful >= 3 && lying >= 3, `truthful ${truthful}, lying ${lying}`);
});

test('triviality (AUDIT step 4): budget heuristic attacker < 20% at d3; the v1 shortcut attacker no longer passes', () => {
  const budget = attackPassRate(bed, budgetSolve, 3, 30);
  assert.ok(budget.pass / budget.seeds < 0.2, `budget attacker ${budget.pass}/30 at d3`);
  const d1 = attackPassRate(bed, denseV1, 3, 30);
  assert.equal(d1.pass, 0, 'dense-v1 (birth-date key) at d3');
});

test('single-judgment ablations: core skills are each decisive at difficulty 5 (and new traps at d3)', () => {
  const core = ['atlas-cutoff', 'atlas-month-first', 'keep-void', 'no-fx', 'keep-trunk-zero', 'exact-names', 'no-phone-link',
    'phone-merges-households', 'oldest-wins', 'single-fx-table'];
  for (const ab of [...core, 'lenient-names', 'keyword-voids', 'country-from-phone', 'pairs-multiply', 'vendex-dmy']) assert.ok(ABLATIONS.includes(ab));
  for (const ab of core) {
    const fails = SEEDS.length - passes(5, SEEDS, t => solveText(t, { ablate: ab }));
    assert.ok(fails >= 12, `${ab} fails only ${fails}/20 at d5`);
  }
  for (const ab of ['lenient-names', 'keyword-voids', 'vendex-dmy']) {
    const fails = SEEDS.length - passes(3, SEEDS, t => solveText(t, { ablate: ab }));
    assert.ok(fails >= 15, `${ab} fails only ${fails}/20 at d3`);
  }
  const memoFails = SEEDS.length - passes(5, SEEDS, t => solveText(t, { ablate: 'obey-memos' }));
  assert.ok(memoFails >= 4, `obey-memos fails ${memoFails}/20`);
});

// ---------------------------------------------------------------------------------------
test('pools are internally consistent', () => {
  const formals = new Set(Object.values(P.CULTURES).flatMap(c => c.given.map(([g]) => g)));
  for (const [nick, formal] of Object.entries(P.NICKNAMES)) {
    assert.ok(formals.has(formal), `${nick} -> ${formal}`);
    assert.ok(!formals.has(nick), `${nick} is also a formal name`);
  }
  const seen = new Map();
  for (const [iso, c] of Object.entries(P.COUNTRIES)) {
    for (const a of new Set([...c.en, ...c.de, ...c.typo, ...c.prose, iso].map(x => x.toLowerCase()))) {
      assert.ok(!seen.has(a) || seen.get(a) === iso, `alias ${a} is ambiguous (${seen.get(a)} / ${iso})`);
      seen.set(a, iso);
    }
  }
  // Cities are unique across countries, never equal to a country alias or demonym, and cover every country.
  const cityOf = new Map();
  for (const [iso, list] of Object.entries(P.CITIES)) {
    for (const c of list) {
      assert.ok(!cityOf.has(c), `city ${c} twice`);
      assert.ok(!seen.has(c.toLowerCase()), `city ${c} is a country alias`);
      cityOf.set(c, iso);
    }
  }
  assert.deepEqual(Object.keys(P.CITIES).sort(), Object.keys(P.COUNTRIES).sort());
  assert.equal(COUNTRY_ALIAS.get('uk'), 'GB');
  assert.equal(P.numberWords(1200, 'hundreds'), 'twelve hundred');
  assert.equal(P.numberWords(1200), 'one thousand two hundred');
});

test('runtime limits at difficulty 5 (cold generate and cold oracle)', () => {
  for (const seed of [900, 901, 902]) {
    let t0 = performance.now();
    const t = bed.generate({ seed, split: 'test', difficulty: 5 });
    assert.ok(performance.now() - t0 < 2000, 'generate < 2 s');
    const out = solveText(t); // does not warm the oracle's world cache
    t0 = performance.now();
    assert.equal(bed.oracle(t, out).pass, true);
    assert.ok(performance.now() - t0 < 2000, 'oracle < 2 s');
  }
  assert.ok(process.memoryUsage().heapUsed < 200 * 1024 * 1024, 'heap < 200 MB');
});
