// Health and regression tests for the `records` bed (beds/CONTRACT.md "Oracle health" + beds/records/AUDIT.md).
// Test ids A1..A12 refer to the findings table of the 2026-10-07 audit in AUDIT.md; F1..F6 to the v2 audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as bed from './index.mjs';
import { solveText, ABLATIONS, COUNTRY_ALIAS } from './solve-text.mjs';
import { budgetSolve } from './attacks/budget.mjs';
import { trivialSolve as denseV1 } from './attacks/dense-v1.mjs';
import { trivialSolve as denseV2 } from './attacks/dense-v2.mjs';
import { heurSolve as heurV2 } from './attacks/heur-v2.mjs';
import { heurSolve as heurV3 } from './attacks/heur-v3.mjs';
import { attackPassRate } from './attacks/run.mjs';
import { ORDER_NOTE, FLAG_NOTE, MIRROR_NOTE, RELIABLE_NOTE, PERSP_NOTE, ATLAS_CUTOFF_NOTE } from './render.mjs';
import { canonical, estimateTokens, sha256 } from '../lib/canonical.mjs';
import { hashSeed } from '../lib/rng.mjs';
import * as P from './pools.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const SEEDS = Array.from({ length: 20 }, (_, i) => i);
const SEEDS30 = Array.from({ length: 30 }, (_, i) => i);
const TEST30 = Array.from({ length: 30 }, (_, i) => 5000 + i);
const taskCache = new Map();
const task = (seed, difficulty, split = 'dev') => {
  const key = `${split}|${difficulty}|${seed}`;
  if (!taskCache.has(key)) taskCache.set(key, bed.generate({ seed, split, difficulty }));
  return taskCache.get(key);
};
const textOf = t => `${t.prompt}\n${t.inputs.source_notes}\n${t.inputs.spec}\n${t.inputs.export}`;
const passes = (d, seeds, solve, split = 'dev') => seeds.filter(seed => { const t = task(seed, d, split); return bed.oracle(t, solve(t)).pass; }).length;
const appliesAt = (control, d) => (control.minDifficulty ?? 1) <= d;

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
  for (const c of bed.badControls) assert.ok([1, 3].includes(c.minDifficulty ?? 1), `${c.name} minDifficulty`);
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

test('A9 regression: v3 changes difficulties 3-5 only; difficulties 1-2 stay byte-identical to v2', () => {
  // sha256(canonical(task)) prefixes recorded from bed v2.0.0 (git 65fe005) before the v3 changes.
  const v2 = { 'dev:1:0': '2f6f44b2a5464eaf', 'dev:1:1': 'f0a500166fd1c2e7', 'dev:2:0': '86bb089c3a63441e', 'dev:2:1': '4bf0eb8eaafc775b',
    'test:1:5000': 'ea8573aadef1c0d4', 'test:2:5000': '56a96bad99112863', 'test:2:5001': 'fde3dd5680686b26' };
  for (const [key, prefix] of Object.entries(v2)) {
    const [split, d, seed] = key.split(':');
    assert.equal(sha256(canonical(bed.generate({ seed: Number(seed), split, difficulty: Number(d) }))).slice(0, 16), prefix, key);
  }
});

test('test split (seeds >= 5000) never shares a world RNG stream with dev seeds 0..9999', () => {
  for (const d of DIFFS) {
    const dev = new Set();
    for (let s = 0; s < 10000; s++) for (let a = 0; a < 3; a++) dev.add(hashSeed('records', 'v2', 'dev', s, d, a));
    for (let s = 5000; s < 7000; s++) for (let a = 0; a < 3; a++) assert.ok(!dev.has(hashSeed('records', 'v2', 'test', s, d, a)), `test ${s} d${d}`);
  }
});

// ---------------------------------------------------------------------------------------
// Controls
test('referenceSolve passes with full score: 30 seeds at d1/d3/d5, 20 at d2/d4, plus 30 test-split seeds at d3', () => {
  for (const d of DIFFS) {
    for (const seed of d % 2 ? SEEDS30 : SEEDS) {
      const r = bed.oracle(task(seed, d), bed.referenceSolve(task(seed, d)));
      assert.equal(r.pass, true, `d${d} seed ${seed}`);
      assert.equal(r.score, 1, `d${d} seed ${seed}`);
    }
  }
  for (const seed of TEST30) assert.equal(bed.oracle(task(seed, 3, 'test'), bed.referenceSolve(task(seed, 3, 'test'))).score, 1, `test ${seed}`);
});

test('every bad control fails on 30 seeds at d1/d3/d5 (20 at d2/d4) at every difficulty it applies to', () => {
  for (const c of bed.badControls) {
    for (const d of DIFFS.filter(x => appliesAt(c, x))) {
      for (const seed of d % 2 ? SEEDS30 : SEEDS) {
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
      for (const [split, s] of [['dev', seed], ['test', 5000 + seed]]) {
        const t = task(s, d, split);
        const r = bed.oracle(t, solveText(t));
        assert.equal(r.score, 1, `${split} d${d} seed ${s}: ${JSON.stringify(r.details.mismatches?.slice(0, 3))}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------------------
// Oracle validity and bypass attempts
test('oracle rejects schema-invalid output, including oversized and non-finite values', () => {
  const t = task(3, 2);
  const ref = bed.referenceSolve(t);
  const first = patch => ({ records: ref.records.map((r, i) => (i === 0 ? { ...r, ...patch } : r)) });
  const bad = [
    null, undefined, 'records', [], {}, { records: 'x' }, { records: {} }, { records: [{}] }, { records: [null] }, ref.records,
    first({ entity_id: String(ref.records[0].entity_id) }), first({ entity_id: ref.records[0].entity_id + 0.5 }),
    first({ amount_usd: '12.00' }), first({ source_rows: [] }), first({ birth_date: undefined }),
    { records: ref.records.map((r, i) => (i === 0 ? (({ phone_e164, ...rest }) => rest)(r) : r)) },
    first({ amount_usd: Number.NaN }), first({ amount_usd: Infinity }), first({ entity_id: BigInt(1) }),
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

test('A8 regression: the oracle scores a plain-data snapshot (inherited fields, throwing getters, proxies, functions)', () => {
  const t = task(7, 3);
  const ref = bed.referenceSolve(t);
  const hostile = {
    'inherited records': () => Object.create({ records: ref.records }),
    'inherited field': () => ({ records: ref.records.map(r => { const { amount_usd, ...rest } = r; return Object.assign(Object.create({ amount_usd }), rest); }) }),
    'throwing getter': () => ({ get records() { throw new Error('boom'); } }),
    proxy: () => new Proxy({ records: ref.records }, {}),
    'function field': () => ({ records: ref.records.map((r, i) => (i ? r : { ...r, amount_usd: () => 1 })) }),
    'JSON __proto__ key': () => JSON.parse(`{"__proto__":{"records":${JSON.stringify(ref.records)}}}`),
  };
  for (const [name, make] of Object.entries(hostile)) {
    let r;
    assert.doesNotThrow(() => { r = bed.oracle(t, make()); }, name);
    assert.equal(r.pass, false, name);
    assert.equal(r.details.reason, 'schema-invalid', name);
  }
  // A getter is read exactly once, so validation and scoring see the same value.
  let reads = 0;
  const once = { get records() { reads++; return ref.records; } };
  assert.equal(bed.oracle(t, once).score, 1);
  assert.ok(reads <= 2, `records read ${reads} times`);
  // Plain JSON with an own "__proto__" key next to the answer is just an extra property.
  assert.equal(bed.oracle(t, JSON.parse(`{"__proto__":{"x":1},"records":${JSON.stringify(ref.records)}}`)).score, 1);
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
    'truth-split-into-singletons': t => ({ records: bed.referenceSolve(t).records.flatMap(r => r.source_rows.map(id => ({ ...r, entity_id: id, source_rows: [id] }))) }),
  };
  for (const [name, make] of Object.entries(probes)) {
    for (const d of [1, 3, 5]) for (const seed of SEEDS.slice(0, 10)) assert.equal(bed.oracle(task(seed, d), make(task(seed, d))).pass, false, `${name} d${d} s${seed}`);
  }
  // Extra properties on a correct answer are allowed (documented) and do not change the score.
  const t = task(4, 3);
  const extra = { meta: 1, records: bed.referenceSolve(t).records.map(r => ({ ...r, confidence: 0.9 })) };
  assert.equal(bed.oracle(t, extra).score, 1);
  const huge = { records: Array.from({ length: 200000 }, (_, i) => ({ entity_id: i, source_rows: [i] })) };
  let t0 = performance.now();
  assert.equal(bed.oracle(t, huge).details.reason, 'schema-invalid');
  assert.ok(performance.now() - t0 < 200, 'oversized output rejected without walking it');
  const maxLegal = { records: Array.from({ length: bed.LIMITS.records }, (_, i) => ({ ...probes['every-row-alone'](t).records[0], entity_id: i,
    source_rows: Array.from({ length: bed.LIMITS.sourceRows }, (_, j) => i * bed.LIMITS.sourceRows + j) })) };
  t0 = performance.now();
  assert.equal(bed.oracle(t, maxLegal).pass, false);
  assert.ok(performance.now() - t0 < 2000, 'largest schema-valid output scored within the 2 s limit');
});

test('oracle tolerance: one wrong field still passes; acceptable variant forms are not graded', () => {
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
      rec.given_name = rec.given_name.toUpperCase().normalize('NFD');
      rec.family_name = ` ${rec.family_name.toLowerCase().replace(/'/g, '’')} `;
      if (rec.country) rec.country = ` ${rec.country.toLowerCase()}`;
      if (rec.phone_e164) rec.phone_e164 = `${rec.phone_e164.slice(0, 3)} (${rec.phone_e164.slice(3, 6)}) ${rec.phone_e164.slice(6)}`;
      if (rec.amount_usd !== null) rec.amount_usd += 1e-9;
      rec.source_rows.reverse();
    }
    noisy.records = noisy.records.map(rec => Object.fromEntries(Object.entries(rec).reverse())).reverse();
    assert.equal(bed.oracle(t, noisy).score, 1, `d${d} case/NFD/apostrophe/phone punctuation/order noise`);
  }
});

test('A7 regression: README states the version, pass rule and thresholds the code uses', () => {
  const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes(`**Version:** ${bed.family.version}`), 'README version');
  assert.ok(readme.includes('pass = fieldAccuracy ≥ 0.97  AND  pairF1 ≥ 0.95  AND  extra ≤ floor(0.02·E)  AND  missing ≤ floor(0.02·E)'), 'README pass rule');
  assert.deepEqual(bed.THRESHOLDS, { fieldAccuracy: 0.97, pairF1: 0.95, entitySlack: 0.02 });
});

// ---------------------------------------------------------------------------------------
// Truth leakage
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
        const winner = rows.sort((a, b) => (a.s.rank - b.s.rank) || (b.date - a.date))[0];
        if (!winner || winner.s.amount.currency === 'USD') continue; // a USD balance is printed as such (only its sign may flip)
        assert.ok(!new RegExp(`(^|[^\\d.,])${rec.amount_usd.toFixed(2).replace('.', '\\.')}(?!\\d|\\.\\d)`).test(text), `amount ${rec.amount_usd}`);
      }
      assert.ok(!/entity_id":(?!17,)/.test(text), 'only the prompt example mentions entity_id');
      const ids = t.inputs.export.split('\n').map(l => Number(l.match(/\d+/)[0]));
      assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
    }
  }
  let adjSame = 0, adj = 0;
  for (const seed of SEEDS) {
    const t = task(seed, 3);
    const of = new Map(bed.referenceSolve(t).records.flatMap((r, i) => r.source_rows.map(id => [id, i])));
    const ids = t.inputs.export.split('\n').map(l => Number(l.match(/\d+/)[0]));
    for (let i = 1; i < ids.length; i++) { adj++; if (of.has(ids[i]) && of.get(ids[i]) === of.get(ids[i - 1])) adjSame++; }
  }
  assert.ok(adjSame / adj < 0.06, `adjacent-same-person rate ${(adjSame / adj).toFixed(3)}`);
});

test('A4 regression: per-task date orders cannot be read off the data (numeric dates only for days <= 12)', () => {
  for (const d of [3, 4, 5]) {
    for (const seed of SEEDS) {
      const lines = task(seed, d).inputs.export.split('\n');
      for (const l of lines) {
        const nums = l.startsWith('BRIGHTDESK') ? [l.match(/\| dob=(\d+)\/(\d+)\/\d{4} /)]
          : l.startsWith('ATLAS') ? [l.match(/ :: born (\d+)\/(\d+)\/\d{4} ::/)]
            : l.startsWith('Vendex') ? [...l.replace(/ Remark: .*/, '').matchAll(/\b(\d{1,2})\/(\d{1,2})\/(?:\d{4}|\d{2})\b/g)] : [];
        for (const m of nums) if (m) assert.ok(Number(m[1]) <= 12 && Number(m[2]) <= 12, `d${d} s${seed}: ${l.slice(0, 90)}`);
      }
    }
  }
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
    for (const seed of SEEDS.slice(0, 3)) {
      const w = bed.buildWorld(seed, 'dev', d), t = task(seed, d);
      assert.equal(w.ctx.cutoff !== null, d >= 4, `ATLAS cutoff at d${d}`);
      if (w.ctx.cutoff !== null) assert.ok(t.inputs.source_notes.split('\n').find(l => l.startsWith('ATLAS.')).includes(w.ctx.cutoffText), 'cutoff date stated');
      assert.equal(/Table B1/.test(t.inputs.spec), d === 5, `dated FX at d${d}`);
      assert.equal(/Shōwa/.test(t.inputs.source_notes), d >= 3, `era note at d${d}`);
      assert.equal(/USD\/JPY/.test(t.inputs.spec), d >= 3, `market FX pairs at d${d}`);
      assert.equal(w.ctx.conv.flags.length, [0, 0, 2, 3, 3][d - 1], `extra status values at d${d}`);
      assert.equal(w.ctx.conv.mirror !== null, d >= 3, `mirror at d${d}`);
    }
  }
});

// ---------------------------------------------------------------------------------------
// Regression tests for the v2 audit findings (F1..F6)
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
  let near = 0, twins = 0;
  for (const seed of SEEDS) {
    const w = bed.buildWorld(seed, 'dev', 3);
    for (const e of w.entities.filter(x => x.role === 'twinA')) { twins++; if (P.partDistance(e.given, w.entities[e.partner].given) === 2) near++; }
  }
  assert.ok(near / twins >= 0.6, `near-twin share ${near}/${twins}`);
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
  for (const seed of SEEDS) {
    const w = bed.buildWorld(seed, 'dev', 5);
    for (const row of w.allRows.filter(x => x.system === 'KOBO')) assert.equal(row.phone.iso, 'JP');
  }
});

test('F4 regression: VENDEX paraphrase variety, numeric dates, cities, credit phrasing, a/an', () => {
  const lines = SEEDS.flatMap(seed => task(seed, 4).inputs.export.split('\n').filter(l => l.startsWith('Vendex ')));
  const has = re => lines.some(l => re.test(l));
  for (const re of [/— Supplier contact /, / supplier,| based in [^,;]+,/, /— Entry revised [^:]+: /, /— Spoke with .+ on /, / — last revised /]) assert.ok(has(re), `template ${re}`);
  assert.ok(has(/(?:born|DOB|b\.|date of birth|Born|Date of birth) \d{1,2}\/\d{1,2}\/\d{2,4}/), 'numeric birth dates');
  assert.ok(has(/revised \d\d\/\d\d\/\d{4}/), 'numeric revision dates');
  assert.ok(has(/we owe them|credit balance of/), 'credit phrasing');
  const extra = new Set(Object.values(P.EXTRA_CITIES).flat());
  assert.ok(lines.some(l => [...extra].some(c => l.includes(`based in ${c}`) || l.includes(`(${c})`) || l.includes(`— ${c} —`))), 'wider city pool used');
  assert.ok(!lines.some(l => /\ba (American|Australian|Austrian|Irish|Italian)\b/.test(l)), 'article agrees');
  assert.ok(passes(3, SEEDS, t => solveText(t, { ablate: 'vendex-flipped' })) === 0, 'reading VENDEX numeric dates in the other order fails');
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
  // A6: the old test counted the matched text ("On 3", "On 12", ...) instead of the template.
  const styles = new Set(SEEDS.map(seed => bed.buildWorld(seed, 'dev', 4).ctx.choices.cutTpl));
  assert.equal(styles.size, ATLAS_CUTOFF_NOTE.length, 'all ATLAS cutoff paraphrases occur');
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

// ---------------------------------------------------------------------------------------
// Regression tests for this audit (A1..A12, see AUDIT.md)
test('A1 regression (triviality): <=40-line heuristic solvers pass < 20% at d3 on 30 test-split seeds (5000+)', () => {
  for (const file of ['heur-v2.mjs', 'heur-v3.mjs']) {
    const lines = readFileSync(new URL(`./attacks/${file}`, import.meta.url), 'utf8').replace(/\n$/, '').split('\n');
    assert.ok(lines.length <= 40 && lines.every(l => l.length <= 160), `${file} is within the 40 x 160 budget`);
  }
  const rate = solve => attackPassRate(bed, solve, 3, 30, 'test', 5000);
  const v3 = rate(heurV3);
  assert.ok(v3.pass <= 3, `heur-v3 (re-adapted, white-box) ${v3.pass}/30`);
  for (const [name, solve] of [['heur-v2', heurV2], ['dense-v2', denseV2], ['budget', budgetSolve], ['dense-v1', denseV1]]) {
    const r = rate(solve);
    assert.ok(r.pass < 6, `${name} (frozen) ${r.pass}/30 at d3`);
  }
});

test('A2 regression: the per-task notes are needed; ignoring any single one of them fails at d3', () => {
  for (const ab of ['notes-defaults', 'atlas-flipped', 'bd-flipped', 'vendex-flipped', 'flags-flipped', 'unknown-flags-live', 'mirror-ignored', 'perspective-ignored']) {
    assert.ok(ABLATIONS.includes(ab), ab);
    assert.equal(passes(3, SEEDS, t => solveText(t, { ablate: ab }), 'dev'), 0, `${ab} passes some d3 tasks`);
  }
});

test('A3 regression: the per-task conventions and their paraphrases vary (no constant prose to hard-code)', () => {
  const seen = new Map();
  const mark = (k, v) => { if (!seen.has(k)) seen.set(k, new Set()); seen.get(k).add(v); };
  for (const d of [3, 4, 5]) {
    for (let seed = 0; seed < 40; seed++) {
      const { conv, choices: c } = bed.buildWorld(seed, seed % 2 ? 'test' : 'dev', d).ctx;
      mark('atlas', conv.atlas); mark('vendex', conv.vendex); mark('bd', conv.bd); mark('mirror', conv.mirror);
      for (const sys of ['ATLAS', 'BRIGHTDESK', 'VENDEX']) mark(`order-${sys}-${sys === 'BRIGHTDESK' ? conv.bd : conv[sys.toLowerCase()]}`, c.orderTpl[sys]);
      conv.flags.forEach((f, i) => { mark(`flag-${f.polarity}`, c.flagTpl[i]); mark('flag-system', f.system); });
      mark('mirrorTpl', c.mirrorTpl); mark('reliableTpl', c.reliableTpl);
      for (const [sys, pol] of Object.entries(conv.persp)) mark(`persp-${sys}-${pol}`, c.perspTpl[sys]);
    }
  }
  for (const k of ['atlas', 'vendex', 'bd']) assert.equal(seen.get(k).size, 2, k);
  assert.equal(seen.get('mirror').size, P.MIRROR_SYSTEMS.length, 'every mirror system occurs');
  assert.equal(seen.get('flag-system').size, Object.keys(P.FLAG_TOKENS).length, 'every system carries extra status values');
  for (const sys of ['ATLAS', 'BRIGHTDESK', 'VENDEX']) for (const o of ['dmy', 'mdy']) {
    assert.equal(seen.get(`order-${sys}-${o}`).size, ORDER_NOTE[sys][o].length, `${sys} ${o} paraphrases`);
  }
  for (const pol of ['live', 'void']) assert.equal(seen.get(`flag-${pol}`).size, FLAG_NOTE[pol].length, `${pol} status paraphrases`);
  assert.equal(seen.get('mirrorTpl').size, MIRROR_NOTE.length);
  assert.equal(seen.get('reliableTpl').size, RELIABLE_NOTE.length);
  for (const [sys, pols] of Object.entries(PERSP_NOTE)) for (const [pol, tpls] of Object.entries(pols)) {
    assert.equal(seen.get(`persp-${sys}-${pol}`)?.size, tpls.length, `${sys} ${pol} perspective paraphrases`);
  }
});

test('A5 regression: every extra status value is decisive and its meaning is stated in the notes', () => {
  for (const d of [3, 4, 5]) {
    for (const seed of SEEDS.slice(0, 10)) {
      const w = bed.buildWorld(seed, 'dev', d);
      const notes = w.notes;
      const pols = w.ctx.conv.flags.map(f => f.polarity);
      assert.ok(pols.includes('live') && pols.includes('void'), 'both meanings occur in every task');
      for (const f of w.ctx.conv.flags) {
        assert.ok(notes.includes(f.token), `${f.token} explained`);
        const flagged = [...w.rows, ...w.voids].filter(x => x.flag === f.token);
        assert.ok(flagged.length >= 2 && flagged.every(x => x.system === f.system && x.void === (f.polarity === 'void')), f.token);
      }
    }
  }
});

test('single-judgment ablations: core skills are each decisive at difficulty 5', () => {
  const core = ['atlas-cutoff', 'atlas-flipped', 'bd-flipped', 'keep-void', 'no-fx', 'keep-trunk-zero', 'exact-names', 'no-phone-link',
    'phone-merges-households', 'oldest-wins', 'single-fx-table', 'vendex-flipped', 'flags-flipped', 'mirror-ignored', 'perspective-ignored'];
  for (const ab of [...core, 'lenient-names', 'keyword-voids', 'country-from-phone', 'pairs-multiply']) assert.ok(ABLATIONS.includes(ab), ab);
  for (const ab of core) {
    const fails = SEEDS.length - passes(5, SEEDS, t => solveText(t, { ablate: ab }));
    assert.ok(fails >= 12, `${ab} fails only ${fails}/20 at d5`);
  }
  for (const ab of ['lenient-names', 'keyword-voids']) {
    const fails = SEEDS.length - passes(3, SEEDS, t => solveText(t, { ablate: ab }));
    assert.ok(fails >= 15, `${ab} fails only ${fails}/20 at d3`);
  }
  const memoFails = SEEDS.length - passes(5, SEEDS, t => solveText(t, { ablate: 'obey-memos' }));
  assert.ok(memoFails >= 3, `obey-memos fails ${memoFails}/20`);
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
  const demonyms = new Set(Object.values(P.COUNTRIES).map(c => c.demonym.toLowerCase()));
  for (const [iso, list] of Object.entries(P.ALL_CITIES)) {
    for (const c of list) {
      assert.ok(!cityOf.has(c), `city ${c} twice`);
      assert.ok(!seen.has(c.toLowerCase()) && !demonyms.has(c.toLowerCase()), `city ${c} is a country alias`);
      cityOf.set(c, iso);
    }
  }
  assert.deepEqual(Object.keys(P.ALL_CITIES).sort(), Object.keys(P.COUNTRIES).sort());
  const team = [...P.TEAM_CITIES.mdy, ...P.TEAM_CITIES.dmy];
  assert.equal(new Set(team).size, team.length, 'team cities unique and in one class only');
  const tokens = Object.values(P.FLAG_TOKENS).flat().map(x => x.toLowerCase());
  assert.equal(new Set(tokens).size, tokens.length, 'extra status values are unique across systems (A11)');
  for (const t of tokens) assert.ok(!['customer', 'production', 'aktiv', 'gesperrt', 'storniert', 'sample', 'sandbox', 'do not migrate'].includes(t));
  assert.equal(COUNTRY_ALIAS.get('uk'), 'GB');
  assert.equal(P.numberWords(1200, 'hundreds'), 'twelve hundred');
  assert.equal(P.numberWords(1200), 'one thousand two hundred');
});

test('A12 regression: runtime limits at difficulty 5 (cold generate and cold oracle, measured in a fresh process)', () => {
  // The old check read this test process's heap, which also holds every cached task of the suite.
  const script = `
    const bed = await import(${JSON.stringify(new URL('./index.mjs', import.meta.url).href)});
    const { solveText } = await import(${JSON.stringify(new URL('./solve-text.mjs', import.meta.url).href)});
    let gen = 0, ora = 0, pass = 0;
    for (const seed of [900, 901, 902, 903, 904, 905, 906, 907]) {
      let t0 = performance.now(); const t = bed.generate({ seed, split: 'test', difficulty: 5 }); gen = Math.max(gen, performance.now() - t0);
      const out = solveText(t);
      t0 = performance.now(); pass += bed.oracle(t, out).pass; ora = Math.max(ora, performance.now() - t0);
    }
    console.log(JSON.stringify({ gen, ora, pass, heap: process.memoryUsage().heapUsed, rss: process.memoryUsage().rss }));`;
  const r = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim().split('\n').pop());
  assert.equal(r.pass, 8);
  assert.ok(r.gen < 2000, `generate < 2 s (worst ${r.gen.toFixed(0)} ms)`);
  assert.ok(r.ora < 2000, `oracle < 2 s (worst ${r.ora.toFixed(0)} ms)`);
  assert.ok(r.heap < 200 * 1024 * 1024 && r.rss < 400 * 1024 * 1024, `memory: heap ${(r.heap / 2 ** 20).toFixed(0)} MB, rss ${(r.rss / 2 ** 20).toFixed(0)} MB`);
});
