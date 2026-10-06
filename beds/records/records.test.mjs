// Health tests for the `records` bed (beds/CONTRACT.md "Oracle health").
import test from 'node:test';
import assert from 'node:assert/strict';
import * as bed from './index.mjs';
import { solveText, ABLATIONS, COUNTRY_ALIAS } from './solve-text.mjs';
import { canonical, estimateTokens } from '../lib/canonical.mjs';
import * as P from './pools.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const SEEDS = Array.from({ length: 20 }, (_, i) => i);
const taskCache = new Map();
const task = (seed, difficulty, split = 'dev') => {
  const key = `${split}|${difficulty}|${seed}`;
  if (!taskCache.has(key)) taskCache.set(key, bed.generate({ seed, split, difficulty }));
  return taskCache.get(key);
};
const textOf = t => `${t.prompt}\n${t.inputs.source_notes}\n${t.inputs.spec}\n${t.inputs.export}`;

test('interface shape', () => {
  assert.equal(bed.family.id, 'records');
  assert.equal(bed.family.kind, 'oneshot');
  for (const key of ['id', 'domain', 'version', 'description']) assert.ok(bed.family[key], key);
  assert.equal(typeof bed.generate, 'function');
  assert.equal(typeof bed.oracle, 'function');
  assert.equal(typeof bed.referenceSolve, 'function');
  const names = bed.badControls.map(c => c.name);
  for (const required of ['empty', 'shuffled-or-corrupted']) assert.ok(names.includes(required), required);
  assert.ok(names.length >= 3, 'at least one plausible-but-wrong control');
  // Portable schema subset: no pattern / oneOf / uniqueItems / $ref / format anywhere.
  const banned = ['pattern', 'oneOf', 'uniqueItems', '$ref', 'format'];
  const walk = s => { for (const [k, v] of Object.entries(s)) { assert.ok(!banned.includes(k), k); if (v && typeof v === 'object') walk(v); } };
  walk(bed.outputSchema);
});

test('task shape and determinism', () => {
  for (const d of DIFFS) {
    const a = bed.generate({ seed: 11, split: 'dev', difficulty: d });
    const b = bed.generate({ seed: 11, split: 'dev', difficulty: d });
    assert.equal(canonical(a), canonical(b), `byte-identical at d${d}`);
    assert.deepEqual(Object.keys(a).sort(), ['budget', 'difficulty', 'family', 'id', 'inputs', 'prompt', 'seed', 'split']);
    assert.equal(typeof a.prompt, 'string');
    for (const k of ['export', 'source_notes', 'spec']) assert.equal(typeof a.inputs[k], 'string');
    const other = bed.generate({ seed: 12, split: 'dev', difficulty: d });
    assert.notEqual(other.inputs.export, a.inputs.export, 'seed changes the task');
    const testSplit = bed.generate({ seed: 11, split: 'test', difficulty: d });
    assert.notEqual(testSplit.inputs.export, a.inputs.export, 'split salts the RNG');
    const out = bed.referenceSolve(a);
    assert.equal(canonical(bed.oracle(a, out)), canonical(bed.oracle(b, out)), 'oracle deterministic');
  }
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 6 }));
  assert.throws(() => bed.generate({ seed: 1, split: 'holdout', difficulty: 1 }));
});

test('referenceSolve passes with full score for 20 seeds per difficulty (and the test split)', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS) {
      const t = task(seed, d);
      const r = bed.oracle(t, bed.referenceSolve(t));
      assert.equal(r.pass, true, `d${d} seed ${seed}`);
      assert.equal(r.score, 1, `d${d} seed ${seed}`);
    }
    for (const seed of [100, 101, 102]) {
      const t = task(seed, d, 'test');
      assert.equal(bed.oracle(t, bed.referenceSolve(t)).score, 1, `test split d${d} seed ${seed}`);
    }
  }
});

test('every bad control fails for 20 seeds at every difficulty', () => {
  for (const c of bed.badControls) {
    for (const d of DIFFS) {
      for (const seed of SEEDS) {
        const t = task(seed, d);
        const r = bed.oracle(t, c.make(t));
        assert.equal(r.pass, false, `${c.name} passed at d${d} seed ${seed}`);
        assert.ok(r.score < 1, `${c.name} full score at d${d} seed ${seed}`);
      }
    }
  }
});

test('truth is derivable from the rendered text alone (independent text-level solver)', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS) {
      const t = task(seed, d);
      const r = bed.oracle(t, solveText(t));
      assert.equal(r.score, 1, `d${d} seed ${seed}: ${JSON.stringify(r.details.mismatches?.slice(0, 3))}`);
    }
  }
});

test('oracle rejects schema-invalid output', () => {
  const t = task(3, 2);
  const ref = bed.referenceSolve(t);
  const bad = [
    null, 'records', {}, { records: 'x' }, { records: [{}] },
    { records: ref.records.map((r, i) => (i === 0 ? { ...r, entity_id: String(r.entity_id) } : r)) },
    { records: ref.records.map((r, i) => (i === 0 ? { ...r, amount_usd: '12.00' } : r)) },
    { records: ref.records.map((r, i) => (i === 0 ? { ...r, source_rows: [] } : r)) },
    { records: ref.records.map((r, i) => (i === 0 ? { ...r, birth_date: undefined } : r)) },
    { records: ref.records.map((r, i) => (i === 0 ? (({ phone_e164, ...rest }) => rest)(r) : r)) },
    { records: ref.records.map((r, i) => (i === 0 ? { ...r, amount_usd: Number.NaN } : r)) },
  ];
  for (const out of bad) {
    const r = bed.oracle(t, out);
    assert.equal(r.pass, false);
    assert.equal(r.score, 0);
    assert.equal(r.details.reason, 'schema-invalid');
  }
  // A row claimed by two records is rejected as well.
  const dup = structuredClone(ref);
  dup.records[1].source_rows.push(dup.records[0].source_rows[0]);
  assert.equal(bed.oracle(t, dup).details.reason, 'row-in-multiple-records');
});

test('oracle tolerance: one wrong field still passes; formatting noise is not graded', () => {
  for (const d of DIFFS) {
    const t = task(5, d);
    const ref = bed.referenceSolve(t);
    const one = structuredClone(ref);
    const victim = one.records.find(r => r.amount_usd !== null);
    victim.amount_usd += 0.01;
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

test('hidden truth does not leak into prompt, notes, spec or export', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS.slice(0, 10)) {
      const t = task(seed, d);
      const text = textOf(t);
      const ref = bed.referenceSolve(t);
      for (const rec of ref.records) {
        assert.ok(!text.includes(canonical(rec)), 'record JSON');
        if (rec.source_rows.length > 1) assert.ok(!text.includes(JSON.stringify(rec.source_rows)), 'cluster membership');
        // E.164 numbers are only ever shown spaced, local, or without "+".
        if (rec.phone_e164) assert.ok(!text.includes(rec.phone_e164), `phone ${rec.phone_e164}`);
      }
      // Converted amounts of non-USD winners never appear verbatim.
      const w = bed.buildWorld(seed, 'dev', d);
      for (const rec of ref.records) {
        const rows = w.rows.filter(x => rec.source_rows.includes(x.rowId) && x.s.amount);
        const winner = rows.sort((a, b) => b.date - a.date)[0];
        if (!winner || winner.s.amount.currency === 'USD') continue;
        assert.ok(!new RegExp(`(^|[^\\d.,])${rec.amount_usd.toFixed(2).replace('.', '\\.')}(?!\\d|\\.\\d)`).test(text), `amount ${rec.amount_usd}`);
      }
      assert.ok(!/entity_id":(?!17,)/.test(text), 'only the prompt example mentions entity_id');
    }
  }
});

test('difficulty sanity: size, token budget and adversarial content grow with difficulty', () => {
  const avg = (d, f) => SEEDS.slice(0, 8).reduce((s, seed) => s + f(task(seed, d)), 0) / 8;
  const rows = DIFFS.map(d => avg(d, t => t.inputs.export.split('\n').length));
  assert.deepEqual(rows, [30, 55, 85, 115, 150]);
  const tokens = DIFFS.map(d => avg(d, t => estimateTokens(t.prompt + canonical(t.inputs))));
  for (let i = 1; i < tokens.length; i++) assert.ok(tokens[i] > tokens[i - 1], `tokens grow at d${i + 1}`);
  assert.ok(tokens[2] >= 6000 && tokens[2] <= 15000, `d3 ≈ 6–15K tokens (got ${tokens[2]})`);
  const ents = DIFFS.map(d => avg(d, t => bed.referenceSolve(t).records.length));
  for (let i = 1; i < ents.length; i++) assert.ok(ents[i] > ents[i - 1]);
  // Adversarial memo lines appear from d2 and grow; ATLAS locale change from d4; dated FX at d5.
  const adv = /merge the two accounts|correct date of birth is|finance confirmed|AI ASSISTANT|SYSTEM: canonical name|set the country accordingly|exclude it from the migration|delete this one|Note to the migration tool/g;
  const advCount = DIFFS.map(d => avg(d, t => (t.inputs.export.match(adv) ?? []).length));
  assert.equal(advCount[0], 0);
  for (let i = 2; i < advCount.length; i++) assert.ok(advCount[i] > advCount[i - 1]);
  for (const d of DIFFS) {
    const t = task(0, d);
    assert.equal(/ATLAS moved to a new hosting vendor/.test(t.inputs.source_notes), d >= 4, `ATLAS cutoff note at d${d}`);
    assert.equal(/Table B1/.test(t.inputs.spec), d === 5, `dated FX at d${d}`);
    assert.equal(/Shōwa/.test(t.inputs.source_notes), d >= 3, `era note at d${d}`);
  }
});

test('single-judgment ablations: core skills are each decisive at difficulty 5', () => {
  const core = ['atlas-cutoff', 'atlas-month-first', 'keep-void', 'no-fx', 'keep-trunk-zero', 'exact-names', 'no-phone-link',
    'phone-merges-households', 'oldest-wins', 'single-fx-table'];
  for (const ab of core) assert.ok(ABLATIONS.includes(ab));
  for (const ab of core) {
    let fails = 0;
    for (const seed of SEEDS) { const t = task(seed, 5); if (!bed.oracle(t, solveText(t, { ablate: ab })).pass) fails++; }
    assert.ok(fails >= 12, `${ab} fails only ${fails}/20 at d5`);
  }
  // Obeying staff memos (prompt-injection lines) costs a pass on a substantial share of d5 tasks.
  let memoFails = 0;
  for (const seed of SEEDS) { const t = task(seed, 5); if (!bed.oracle(t, solveText(t, { ablate: 'obey-memos' })).pass) memoFails++; }
  assert.ok(memoFails >= 6, `obey-memos fails ${memoFails}/20`);
});

test('pools are internally consistent', () => {
  // Nicknames are one-to-one and never collide with a formal given name in any culture.
  const formals = new Set(Object.values(P.CULTURES).flatMap(c => c.given.map(([g]) => g)));
  for (const [nick, formal] of Object.entries(P.NICKNAMES)) {
    assert.ok(formals.has(formal), `${nick} -> ${formal}`);
    assert.ok(!formals.has(nick), `${nick} is also a formal name`);
  }
  // Country aliases resolve to exactly one ISO code.
  const seen = new Map();
  for (const [iso, c] of Object.entries(P.COUNTRIES)) {
    for (const a of new Set([...c.en, ...c.de, ...c.typo, ...c.prose, iso].map(x => x.toLowerCase()))) {
      assert.ok(!seen.has(a) || seen.get(a) === iso, `alias ${a} is ambiguous (${seen.get(a)} / ${iso})`);
      seen.set(a, iso);
    }
  }
  assert.equal(COUNTRY_ALIAS.get('uk'), 'GB');
  assert.equal(P.numberWords(1200, 'hundreds'), 'twelve hundred');
  assert.equal(P.numberWords(1200), 'one thousand two hundred');
});

test('runtime limits at difficulty 5', () => {
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
