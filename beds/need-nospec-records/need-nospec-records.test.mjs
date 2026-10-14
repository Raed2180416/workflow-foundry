// need-nospec-records bed tests (node:test, built-ins only). Development seeds 601-640 only; nothing here is held-out evidence.
//   node --test beds/need-nospec-records/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as bed from './index.mjs';
import * as rec from '../records/index.mjs';
import { solveText } from '../records/solve-text.mjs';
import { collision, worldFor, exampleSeed } from './examples.mjs';
import { RULE_PHRASES, PROMPT_PHRASES, SPEC_PHRASES, sentencesOf } from './rule-phrases.mjs';
import { fmtStat } from './measure.mjs';
import { canonical, estimateTokens, sha256 } from '../lib/canonical.mjs';
import { portableSchemaViolations } from '../../src/schema-subset.mjs';
import { loadFamily, inlineRender } from '../../experiments/lib/beds.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const K = { 1: 2, 2: 3, 3: 4, 4: 4, 5: 5 };
const ROWS = { 1: 30, 2: 55, 3: 85, 4: 115, 5: 150 };
const SEEDS = Array.from({ length: 40 }, (_, i) => 601 + i); // dev seeds 601-640
const SEEDS20 = SEEDS.slice(0, 20);
const cache = new Map();
const task = (seed, d, split = 'dev') => {
  const key = `${split}|${d}|${seed}`;
  if (!cache.has(key)) cache.set(key, bed.generate({ seed, split, difficulty: d }));
  return cache.get(key);
};
const key3 = t => ({ seed: t.seed, split: t.split, difficulty: t.difficulty });
const appliesAt = (c, d) => (c.minDifficulty ?? 1) <= d;
const rowIds = text => text.split('\n').map(l => Number(l.match(/\d+/)[0]));
// Prose and rate sheets (no exports, no master records): where a rule of the master list could be written down.
const proseOf = t => [t.prompt, t.inputs.source_notes, t.inputs.rate_sheet, ...t.inputs.examples.flatMap(e => [e.source_notes, e.rate_sheet])].join('\n');
const fullTextOf = t => [proseOf(t), t.inputs.export, ...t.inputs.examples.map(e => e.export)].join('\n');
const sheetAsSpec = sheet => sheet.split('\n').slice(1).map(l => {
  const m = /^Table (B\d) \(valid (up to and including|on or after) (.+)\):$/.exec(l);
  return m ? `   Table ${m[1]}, for rows updated ${m[2]} ${m[3]}:` : `     ${l}`;
}).join('\n');
const fold = s => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------
// Contract conformance
test('contract: family, exports, portable schema, control names, loadable as a bed', async () => {
  assert.equal(bed.family.id, 'need-nospec-records');
  assert.equal(bed.family.version, '1.0.0');
  assert.equal(bed.family.kind, 'oneshot');
  assert.equal(bed.family.role, 'need-anchor');
  assert.ok(bed.family.domain && bed.family.description);
  assert.match(bed.family.description, /HYPOTHESIS/);
  for (const fn of ['generate', 'oracle', 'referenceSolve']) assert.equal(typeof bed[fn], 'function', fn);
  assert.deepEqual(bed.outputSchema, rec.outputSchema, 'the output schema is records\'');
  assert.notEqual(bed.outputSchema, rec.outputSchema, 'a copy, not the same object');
  assert.deepEqual(portableSchemaViolations(bed.outputSchema), []);
  const forbidden = new Set(['pattern', 'oneOf', 'uniqueItems', '$ref', 'format']);
  const walk = s => { if (s && typeof s === 'object') for (const [k, v] of Object.entries(s)) { assert.ok(!forbidden.has(k), `schema uses ${k}`); walk(v); } };
  walk(bed.outputSchema);
  const names = bed.badControls.map(c => c.name);
  assert.equal(new Set(names).size, names.length, 'control names are unique');
  for (const required of ['empty', 'shuffled-or-corrupted']) assert.ok(names.includes(required), required);
  assert.ok(names.filter(n => n.startsWith('plausible-but-wrong')).length >= 3);
  for (const n of rec.badControls.map(c => c.name)) assert.ok(names.includes(n), `records control ${n} kept under its name`);
  assert.ok(bed.badControls.every(c => typeof c.make === 'function' && typeof c.why === 'string' && c.why.length > 10));
  assert.deepEqual(bed.EXAMPLE_COUNT, K);
  assert.equal((await loadFamily('need-nospec-records')).family.id, 'need-nospec-records');
});

test('task shape: contract fields only, JSON-serialisable, no spec, no files, examples first, batch last', () => {
  for (const d of DIFFS) {
    const t = task(601 + d, d);
    assert.deepEqual(Object.keys(t).sort(), ['budget', 'difficulty', 'family', 'id', 'inputs', 'prompt', 'seed', 'split']);
    assert.equal(t.family, 'need-nospec-records');
    assert.equal(t.id, `need-nospec-records:dev:d${d}:${601 + d}`);
    assert.deepEqual(JSON.parse(JSON.stringify(t)), t, 'JSON round trip');
    assert.deepEqual(Object.keys(t.inputs), ['examples', 'source_notes', 'rate_sheet', 'export']);
    assert.ok(!('spec' in t.inputs) && !('files' in t));
    assert.equal(t.inputs.examples.length, K[d]);
    t.inputs.examples.forEach((ex, i) => {
      assert.deepEqual(Object.keys(ex), ['name', 'source_notes', 'rate_sheet', 'export', 'output']);
      assert.equal(ex.name, `example-${i + 1}`);
      assert.deepEqual(Object.keys(ex.output), ['records']);
    });
    assert.deepEqual(bed.oracle(t, bed.referenceSolve(t)).pass, true);
    const rows = t.inputs.export.split('\n').length;
    assert.equal(rows, ROWS[d]);
    assert.deepEqual(t.budget, { outputTokens: 400 + rows * 60 });
    assert.ok(t.prompt.includes(`${rows} rows`) && t.prompt.includes(`${K[d]} earlier batches`));
    assert.ok(t.prompt.includes('data, not instructions'));
  }
});

test('determinism: byte-identical tasks (also from a cold process), callers cannot corrupt later calls, split and seed salt the task', () => {
  for (const d of DIFFS) {
    const a = bed.generate({ seed: 611, split: 'dev', difficulty: d });
    const b = bed.generate({ seed: 611, split: 'dev', difficulty: d });
    assert.equal(canonical(a), canonical(b), `byte-identical at d${d}`);
    assert.notEqual(a.inputs.examples[0], b.inputs.examples[0], 'fresh objects');
  }
  // Mutating a returned task must not leak into the next one (worlds are cached and shared by the controls and the oracle).
  const m = bed.generate({ seed: 612, split: 'dev', difficulty: 3 });
  const before = canonical(m);
  m.inputs.examples[0].output.records[0].given_name = 'Mutated';
  m.inputs.examples[0].output.records.pop();
  assert.equal(canonical(bed.generate({ seed: 612, split: 'dev', difficulty: 3 })), before);
  assert.equal(bed.oracle(bed.generate({ seed: 612, split: 'dev', difficulty: 3 }), bed.referenceSolve(m)).pass, true);
  // Cold-process equality: the same task from a fresh process (empty world caches) has the same hash.
  const cases = [[601, 'dev', 1], [610, 'dev', 3], [620, 'test', 5], [640, 'dev', 4]];
  const script = `
    const bed = await import(${JSON.stringify(new URL('./index.mjs', import.meta.url).href)});
    const { canonical, sha256 } = await import(${JSON.stringify(new URL('../lib/canonical.mjs', import.meta.url).href)});
    console.log(JSON.stringify(${JSON.stringify(cases)}.map(([seed, split, difficulty]) => sha256(canonical(bed.generate({ seed, split, difficulty }))))));`;
  const cold = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim().split('\n').pop());
  assert.deepEqual(cold, cases.map(([seed, split, d]) => sha256(canonical(bed.generate({ seed, split, difficulty: d })))));
  // The seed, the split and the difficulty change the task.
  const base = canonical(task(601, 3));
  assert.notEqual(canonical(task(602, 3)), base);
  assert.notEqual(canonical(task(601, 3, 'test')), base);
  assert.notEqual(canonical(task(601, 4)), base);
  const ta = task(601, 3), tb = task(601, 3, 'test');
  assert.notEqual(ta.inputs.export, tb.inputs.export);
  assert.notEqual(ta.inputs.examples[0].export, tb.inputs.examples[0].export);
});

test('generate and oracle validate their arguments', () => {
  const bad = [{ seed: 1.5 }, { seed: '601' }, { seed: undefined }, { seed: 601, difficulty: 0 }, { seed: 601, difficulty: 6 },
    { seed: 601, difficulty: 2.5 }, { seed: 601, difficulty: '3' }, { seed: 601, split: 'sealed' }, { seed: 601, split: 'train' }];
  for (const args of bad) assert.throws(() => bed.generate(args), /need-nospec-records/, JSON.stringify(args));
  assert.throws(() => bed.generate(), /need-nospec-records/);
  const t = task(601, 2);
  for (const broken of [{ ...t, difficulty: 7 }, { ...t, split: undefined }, { ...t, seed: null }, null]) {
    assert.throws(() => bed.oracle(broken, bed.referenceSolve(t)), /need-nospec-records/);
    assert.throws(() => bed.referenceSolve(broken), /need-nospec-records/);
  }
});

// ---------------------------------------------------------------------------------------
// Oracle health
test('referenceSolve passes with full score for 40 dev seeds at every difficulty (oracle repeatable, output independent)', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS) {
      const t = task(seed, d);
      const ref = bed.referenceSolve(t);
      const r = bed.oracle(t, ref);
      assert.equal(r.pass, true, `d${d} s${seed}`);
      assert.equal(r.score, 1, `d${d} s${seed}`);
      assert.deepEqual(bed.oracle(t, ref), r, 'repeatable');
      assert.notEqual(bed.referenceSolve(t), ref, 'a fresh copy each time');
    }
  }
});

test('every bad control fails for 40 dev seeds at every difficulty it applies to, with a schema-valid answer', () => {
  const failed = {};
  for (const d of DIFFS) {
    for (const seed of SEEDS) {
      const t = task(seed, d);
      for (const c of bed.badControls) {
        if (!appliesAt(c, d)) continue;
        const out = c.make(t);
        const r = bed.oracle(t, out);
        assert.equal(r.pass, false, `${c.name} d${d} s${seed}`);
        assert.ok(r.score < 1, `${c.name} d${d} s${seed}`);
        assert.notEqual(r.details.reason, 'schema-invalid', `${c.name} d${d} s${seed}: a control must fail on content, not on form`);
        failed[`${c.name}@d${d}`] = (failed[`${c.name}@d${d}`] ?? 0) + 1;
      }
    }
  }
  for (const d of DIFFS) {
    for (const c of bed.badControls) if (appliesAt(c, d)) assert.equal(failed[`${c.name}@d${d}`], SEEDS.length, `${c.name}@d${d}`);
    // per-task conventions (records minDifficulty 3) are not applied below d3
    assert.equal(bed.badControls.filter(c => appliesAt(c, d)).length, d < 3 ? 11 : 17, `controls at d${d}`);
  }
  // Controls are deterministic.
  const t = task(605, 5);
  for (const c of bed.badControls) assert.deepEqual(c.make(t), c.make(t), c.name);
});

test('the three no-spec controls are real near misses (or a plain echo) and fail for the reason they name', () => {
  const byName = Object.fromEntries(bed.badControls.map(c => [c.name, c]));
  for (const d of DIFFS) {
    for (const seed of SEEDS20) {
      const t = task(seed, d);
      const copy = bed.oracle(t, byName['plausible-but-wrong:copy-example-output'].make(t));
      assert.ok(copy.score < 0.2, `copy d${d} s${seed}: ${copy.score}`);
      const refs = bed.exampleRefs(t);
      assert.deepEqual(byName['plausible-but-wrong:copy-example-output'].make(t), rec.referenceSolve(refs[refs.length - 1]), 'the last example\'s master list');
      for (const name of ['plausible-but-wrong:example-rates-reused', 'plausible-but-wrong:trunk-zero-kept']) {
        const r = bed.oracle(t, byName[name].make(t));
        assert.ok(r.score >= 0.6 && r.score < 1, `${name} d${d} s${seed}: ${r.score}`);
        assert.ok(r.details.pairF1 === 1, `${name}: the clusters are right`);
        assert.ok(r.details.fieldAccuracy < 0.97, `${name}: the fields are what fails`);
      }
      // each control changes exactly the field it names
      const truth = bed.referenceSolve(t).records;
      const rates = byName['plausible-but-wrong:example-rates-reused'].make(t).records;
      const trunk = byName['plausible-but-wrong:trunk-zero-kept'].make(t).records;
      for (let i = 0; i < truth.length; i++) {
        for (const f of ['entity_id', 'source_rows', 'given_name', 'family_name', 'birth_date', 'country', 'phone_e164']) assert.deepEqual(rates[i][f], truth[i][f], `rates:${f}`);
        for (const f of ['entity_id', 'source_rows', 'given_name', 'family_name', 'birth_date', 'country', 'amount_usd']) assert.deepEqual(trunk[i][f], truth[i][f], `trunk:${f}`);
      }
      assert.ok(trunk.some((r, i) => r.phone_e164 !== truth[i].phone_e164), 'some phone keeps its trunk zero');
      assert.ok(rates.some((r, i) => r.amount_usd !== truth[i].amount_usd), 'some amount differs');
    }
  }
});

test('oracle rejects schema-invalid output, including oversized and non-finite values', () => {
  const t = task(603, 2);
  const ref = bed.referenceSolve(t);
  const first = patch => ({ records: ref.records.map((r, i) => (i === 0 ? { ...r, ...patch } : r)) });
  const bad = [
    null, undefined, 'records', 7, true, [], {}, { records: 'x' }, { records: {} }, { records: [{}] }, { records: [null] }, ref.records,
    first({ entity_id: String(ref.records[0].entity_id) }), first({ entity_id: ref.records[0].entity_id + 0.5 }),
    first({ amount_usd: '12.00' }), first({ source_rows: [] }), first({ source_rows: ['a'] }), first({ birth_date: undefined }),
    first({ country: 5 }), first({ phone_e164: 4912345 }), first({ given_name: null }),
    { records: ref.records.map((r, i) => (i === 0 ? (({ phone_e164, ...rest }) => rest)(r) : r)) },
    first({ amount_usd: Number.NaN }), first({ amount_usd: Infinity }), first({ entity_id: BigInt(1) }),
    first({ given_name: 'x'.repeat(bed.LIMITS.text + 1) }),
    first({ source_rows: Array.from({ length: bed.LIMITS.sourceRows + 1 }, (_, i) => i) }),
    { records: Array.from({ length: bed.LIMITS.records + 1 }, (_, i) => ({ ...ref.records[0], entity_id: i, source_rows: [i] })) },
    // the shape of an example, not of an answer
    { name: 'example-1', output: ref },
  ];
  for (const out of bad) {
    const r = bed.oracle(t, out);
    assert.equal(r.pass, false);
    assert.equal(r.score, 0);
    assert.equal(r.details.reason, 'schema-invalid');
  }
  const dup = structuredClone(ref);
  dup.records[1].source_rows.push(dup.records[0].source_rows[0]);
  const r = bed.oracle(t, dup);
  assert.equal(r.pass, false);
  assert.equal(r.details.reason, 'row-in-multiple-records');
});

test('the oracle scores a plain-data snapshot and cannot be bypassed (hostile objects, degenerate answers)', () => {
  const t = task(607, 3);
  const ref = bed.referenceSolve(t);
  const hostile = {
    'inherited records': () => Object.create({ records: ref.records }),
    'throwing getter': () => ({ get records() { throw new Error('boom'); } }),
    proxy: () => new Proxy({ records: ref.records }, {}),
    'function field': () => ({ records: ref.records.map((r, i) => (i ? r : { ...r, amount_usd: () => 1 })) }),
  };
  for (const [name, make] of Object.entries(hostile)) {
    let r;
    assert.doesNotThrow(() => { r = bed.oracle(t, make()); }, name);
    assert.equal(r.pass, false, name);
    assert.equal(r.details.reason, 'schema-invalid', name);
  }
  const blank = id => ({ entity_id: id, source_rows: [id], given_name: '', family_name: '', birth_date: null, country: null, phone_e164: null, amount_usd: null });
  const probes = {
    'all-rows-one-record': x => ({ records: [{ ...blank(Math.min(...rowIds(x.inputs.export))), source_rows: rowIds(x.inputs.export) }] }),
    'every-row-alone': x => ({ records: rowIds(x.inputs.export).map(blank) }),
    'right-clusters-blank-fields': x => ({ records: bed.referenceSolve(x).records.map(r => ({ ...blank(r.entity_id), source_rows: r.source_rows })) }),
    'records-duplicated': x => { const r = bed.referenceSolve(x).records; return { records: [...r, ...r] }; },
    // the answers the examples invite: an example's rows renumbered into this batch
    'example-with-this-batch-ids': x => ({ records: x.inputs.examples[0].output.records.map((r, i) => ({ ...r, entity_id: rowIds(x.inputs.export)[i], source_rows: [rowIds(x.inputs.export)[i]] })) }),
  };
  for (const [name, make] of Object.entries(probes)) {
    for (const d of [1, 3, 5]) for (const seed of SEEDS.slice(0, 8)) assert.equal(bed.oracle(task(seed, d), make(task(seed, d))).pass, false, `${name} d${d} s${seed}`);
  }
  const huge = { records: Array.from({ length: 200000 }, (_, i) => ({ entity_id: i, source_rows: [i] })) };
  const t0 = performance.now();
  assert.equal(bed.oracle(t, huge).details.reason, 'schema-invalid');
  assert.ok(performance.now() - t0 < 200, 'oversized output rejected without walking it');
});

test('the oracle is records\': same truth, same scores, and it ignores the prompt, inputs and examples it is handed', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS.slice(0, 5)) {
      const t = task(seed, d);
      const p = rec.generate(key3(t));
      assert.deepEqual(bed.referenceSolve(t), rec.referenceSolve(p), 'truth is records\'');
      assert.equal(t.inputs.source_notes, p.inputs.source_notes, 'source notes are records\', byte for byte');
      assert.equal(t.inputs.export, p.inputs.export, 'export is records\', byte for byte');
      assert.deepEqual(bed.pairedRecordsTask(t).inputs, p.inputs);
      assert.notEqual(t.prompt, p.prompt);
      const outs = [bed.referenceSolve(t), ...bed.badControls.filter(c => appliesAt(c, d) && !c.name.includes('plausible-but-wrong')).map(c => c.make(t))];
      for (const out of outs) assert.deepEqual(bed.oracle(t, out), rec.oracle(p, out), `d${d} s${seed}`);
      // a task whose text was wiped scores the same: truth comes from (seed, split, difficulty) only
      const wiped = { ...key3(t), family: t.family, id: 'x', prompt: '', inputs: {}, budget: {} };
      assert.deepEqual(bed.oracle(wiped, bed.referenceSolve(t)), bed.oracle(t, bed.referenceSolve(t)));
      assert.deepEqual(bed.oracle({ ...t, inputs: { ...t.inputs, examples: [], export: 'x' } }, outs[0]), bed.oracle(t, outs[0]));
    }
  }
  // tolerance and thresholds are records': one wrong field still passes, a wrong cluster does not
  const t = task(609, 3);
  const ref = bed.referenceSolve(t);
  const one = structuredClone(ref); one.records[0].phone_e164 = '+10000000000';
  assert.equal(bed.oracle(t, one).pass, true);
  assert.deepEqual(bed.THRESHOLDS, { fieldAccuracy: 0.97, pairF1: 0.95, entitySlack: 0.02 });
});

// ---------------------------------------------------------------------------------------
// Family-specific: the written rules are gone
test('the task text contains none of the records rule phrases or rule sentences (the list is real: records contains every phrase)', () => {
  // 1. The phrases occur in records' own prompt / spec (not vacuous) and not in records' kept source notes.
  const recTexts = DIFFS.map(d => rec.generate({ seed: 601, split: 'dev', difficulty: d }));
  const recRules = recTexts.map(t => `${t.prompt}\n${t.inputs.spec}`).join('\n').toLowerCase();
  const recNotes = recTexts.map(t => t.inputs.source_notes).join('\n').toLowerCase();
  for (const p of PROMPT_PHRASES) assert.ok(recTexts.some(t => t.prompt.toLowerCase().includes(p.toLowerCase())), `records prompt has "${p}"`);
  for (const p of SPEC_PHRASES) assert.ok(recTexts.some(t => t.inputs.spec.toLowerCase().includes(p.toLowerCase())), `records spec has "${p}"`);
  for (const p of RULE_PHRASES) {
    assert.ok(recRules.includes(p.toLowerCase()), p);
    assert.ok(!recNotes.includes(p.toLowerCase()), `"${p}" is a rule phrase, so it must not be in the notes this family keeps`);
  }
  assert.ok(RULE_PHRASES.length >= 30);
  // 2. None occurs in this family's prose (prompt, notes, rate sheets, of the batch and of every example).
  for (const d of DIFFS) {
    for (const seed of SEEDS.slice(0, 6)) {
      const prose = proseOf(task(seed, d)).toLowerCase();
      for (const p of RULE_PHRASES) assert.ok(!prose.includes(p.toLowerCase()), `d${d} s${seed}: "${p}"`);
      assert.ok(!/specification \(|migration batch d\d-\d+\)/i.test(prose), 'no spec title');
    }
  }
  // 3. No sentence of the records prompt or spec occurs anywhere in the task (exports included).
  for (const d of DIFFS) {
    for (const seed of SEEDS.slice(0, 4)) {
      const p = rec.generate({ seed, split: 'dev', difficulty: d });
      const sentences = [...sentencesOf(p.prompt, 5), ...sentencesOf(p.inputs.spec, 5)];
      assert.ok(sentences.length >= 15, 'the sentence list is not vacuous');
      const text = fullTextOf(task(seed, d));
      for (const s of sentences) assert.ok(!text.includes(s), `d${d} s${seed}: sentence from records "${s.slice(0, 70)}"`);
      assert.ok(!text.includes(p.prompt.split('\n')[1]), 'records\' second prompt line is gone');
    }
  }
  // 4. The prompt says what is missing, and tells the solver the examples are all there is.
  const t = task(601, 3);
  assert.match(t.prompt, /no written specification/);
  assert.match(t.prompt, /inputs\.examples/);
  assert.ok(!('spec' in t.inputs));
});

test('the examples are solved: their master records pass records\' oracle for their own seeds, and are records\' own batches', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS20) {
      const t = task(seed, d);
      const refs = bed.exampleRefs(t);
      assert.equal(refs.length, K[d]);
      refs.forEach((ref, i) => {
        const ex = t.inputs.examples[i];
        const r = rec.oracle(ref, ex.output);
        assert.equal(r.pass, true, `d${d} s${seed} example ${i + 1}`);
        assert.equal(r.score, 1, `d${d} s${seed} example ${i + 1}`);
        assert.deepEqual(ex.output, rec.referenceSolve(ref));
        if (seed <= 604) { // the example inputs are exactly records' inputs for that seed (minus the spec); a spot check keeps the run short
          const p = rec.generate(ref);
          assert.equal(ex.source_notes, p.inputs.source_notes);
          assert.equal(ex.export, p.inputs.export);
        }
        assert.equal(ex.export.split('\n').length, ROWS[d], 'an example is a batch of the same size');
      });
    }
  }
});

test('the evaluation seed\'s truth never appears among the examples (people, records, clusters, export lines)', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS) {
      const t = task(seed, d);
      const truth = bed.referenceSolve(t).records;
      const exRecords = t.inputs.examples.flatMap(e => e.output.records);
      const exJson = JSON.stringify(t.inputs.examples.map(e => e.output));
      const people = new Set(exRecords.filter(r => r.birth_date).map(r => `${fold(r.family_name)}|${fold(r.given_name)}|${r.birth_date}`));
      const undated = new Set(exRecords.filter(r => !r.birth_date).map(r => `${fold(r.family_name)}|${fold(r.given_name)}|${r.phone_e164}`));
      const content = new Set(exRecords.map(r => [r.given_name, r.family_name, r.birth_date, r.country, r.phone_e164, r.amount_usd].join('|')));
      for (const r of truth) {
        if (r.birth_date) assert.ok(!people.has(`${fold(r.family_name)}|${fold(r.given_name)}|${r.birth_date}`), `d${d} s${seed}: same person ${r.entity_id}`);
        else assert.ok(!undated.has(`${fold(r.family_name)}|${fold(r.given_name)}|${r.phone_e164}`), `d${d} s${seed}: same undated person ${r.entity_id}`);
        assert.ok(!content.has([r.given_name, r.family_name, r.birth_date, r.country, r.phone_e164, r.amount_usd].join('|')), `d${d} s${seed}: same record content`);
        assert.ok(!exJson.includes(canonical(r)), 'canonical record JSON');
        assert.ok(!exJson.includes(JSON.stringify(r)), 'record JSON');
        if (r.source_rows.length > 1) assert.ok(!exJson.includes(JSON.stringify(r.source_rows)), `cluster ${r.source_rows}`);
      }
      for (const ex of t.inputs.examples) {
        assert.notEqual(canonical(ex.output), canonical({ records: truth }), 'no example is the answer');
        assert.notEqual(ex.export, t.inputs.export);
      }
      const lines = new Set(t.inputs.export.split('\n'));
      for (const ex of t.inputs.examples) for (const l of ex.export.split('\n')) assert.ok(!lines.has(l), `export line ${l.slice(0, 60)}`);
    }
  }
  // The rejection rule bites: a world is never allowed to accompany itself (its people are the evaluation's people).
  for (const d of DIFFS) {
    const w = worldFor(601, 'dev', d);
    assert.equal(collision(w, w), 'person');
    assert.equal(collision(w, worldFor(exampleSeed(601, 'dev', d, 0, 0), 'dev', d)), null);
  }
});

test('example seeds: in their own namespace, distinct, deterministic, on the task\'s split, never a fixed set', () => {
  for (const split of ['dev', 'test']) {
    for (const d of DIFFS) {
      const seen = new Set();
      const firstExports = new Set();
      for (const seed of SEEDS.slice(0, split === 'dev' ? 40 : 12)) {
        const t = task(seed, d, split);
        const refs = bed.exampleRefs(t);
        assert.deepEqual(bed.exampleRefs(t), refs, 'deterministic');
        assert.equal(refs.length, K[d]);
        for (const r of refs) {
          assert.ok(r.seed >= bed.EXAMPLE_SEED_BASE && r.seed < bed.EXAMPLE_SEED_BASE + bed.EXAMPLE_SEED_SPAN, 'namespace');
          assert.ok(r.seed > 1e6, 'above every evaluation seed range in use');
          assert.notEqual(r.seed, seed);
          assert.equal(r.split, split, 'examples come from the task\'s own split');
          assert.equal(r.difficulty, d);
          assert.ok(!seen.has(r.seed), 'an example world is used by one task only');
          seen.add(r.seed);
        }
        assert.equal(new Set(refs.map(r => r.seed)).size, refs.length, 'distinct within a task');
        firstExports.add(t.inputs.examples[0].export);
      }
      assert.equal(firstExports.size, split === 'dev' ? 40 : 12, 'the examples change from task to task');
    }
  }
  // The task carries no seed of any kind that would lead back to an example world.
  const t = task(601, 4);
  const refs = bed.exampleRefs(t);
  const json = JSON.stringify(t);
  for (const r of refs) assert.ok(!json.includes(`"seed":${r.seed}`) && !json.includes(`"seed": ${r.seed}`));
  assert.ok(!/"seed"/.test(JSON.stringify(t.inputs)));
});

test('the examples show the rules they stand for: merged people and dropped (void) rows in every example', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS) {
      for (const ex of task(seed, d).inputs.examples) {
        const ids = rowIds(ex.export);
        const used = new Set(ex.output.records.flatMap(r => r.source_rows));
        const dropped = ids.filter(id => !used.has(id));
        assert.ok(ex.output.records.some(r => r.source_rows.length > 1), `d${d} s${seed}: a merged person`);
        assert.ok(dropped.length >= 1, `d${d} s${seed}: a dropped row`);
        assert.ok([...used].every(id => ids.includes(id)), 'source_rows refer to rows of the example export');
        assert.ok(ex.output.records.some(r => r.source_rows.length === 1), 'a single-row person');
        assert.ok(ex.output.records.every(r => r.entity_id === Math.min(...r.source_rows)));
      }
    }
  }
});

test('rate sheet: only the batch\'s rate lines of the withheld spec, as plain data, and never the same as an example\'s', () => {
  const header = /^RATE SHEET — migration batch D[1-5]-\d{4}$/;
  const table = /^Table B[12] \(valid (up to and including|on or after) \d{1,2} [A-Z][a-z]+ \d{4}\):$/;
  const rateLine = /^[A-Z]{3}(\/[A-Z]{3})?  \d+\.\d+$/;
  for (const d of DIFFS) {
    for (const seed of SEEDS.slice(0, 12)) {
      const t = task(seed, d);
      const spec = bed.withheldSpec(t);
      const specLines = new Set(spec.split('\n').map(l => l.trim()));
      const lines = t.inputs.rate_sheet.split('\n');
      assert.match(lines[0], header);
      assert.ok(spec.includes(`(${lines[0].replace('RATE SHEET — ', '')})`), 'same batch id as the spec');
      for (const l of lines.slice(1)) {
        assert.ok(table.test(l) || rateLine.test(l), `sheet line "${l}"`);
        if (rateLine.test(l)) assert.ok(specLines.has(l), `rate line "${l}" is the spec's own`);
      }
      const rates = lines.filter(l => rateLine.test(l)).length;
      assert.equal(lines.filter(l => table.test(l)).length, d === 5 ? 2 : 0);
      assert.equal(rates, d <= 2 ? 11 : d <= 4 ? 10 : 20, `rate lines at d${d}`);
      assert.equal(/USD\/JPY/.test(t.inputs.rate_sheet), d >= 3, 'market pairs from d3');
      assert.equal(/^USD  1\.0000$/m.test(t.inputs.rate_sheet), d <= 2);
      // no prose: every line is a header, a table label or "CODE  number"
      const words = t.inputs.rate_sheet.split(/[\s():,]+/).filter(w => /[a-z]{4,}/.test(w));
      assert.ok(words.every(w => ['Table', 'migration', 'including', 'valid', 'after', 'batch'].includes(w) || /^(January|February|March|April|May|June|July|August|September|October|November|December)$/.test(w)), `no explanatory words: ${words}`);
      const own = lines.slice(1).join('\n');
      for (const ex of t.inputs.examples) assert.notEqual(ex.rate_sheet.split('\n').slice(1).join('\n'), own, 'rates are per batch: an example\'s sheet is not this batch\'s');
    }
  }
  // The rates differ between batches (jitter), so an example cannot supply them.
  for (const d of DIFFS) {
    const sheets = new Set(SEEDS.slice(0, 20).map(s => task(s, d).inputs.rate_sheet.split('\n').slice(1).join('\n')));
    assert.equal(sheets.size, 20, `rates vary across tasks at d${d}`);
  }
});

test('the missing information is exactly the rules: the withheld spec is records\' own, and rules + this task\'s own inputs determine the truth', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS.slice(0, 10)) {
      const t = task(seed, d);
      const p = rec.generate(key3(t));
      assert.equal(bed.withheldSpec(t), p.inputs.spec);
      assert.ok(!fullTextOf(t).includes(p.inputs.spec.split('\n')[0]), 'the spec title is not in the task');
      // Records' independent text solver carries the rules as code. Given only this task's notes, export and rate sheet it passes,
      // so the one thing a solver of this task lacks is the written rules (and the reference data in them).
      const fromSheet = solveText({ inputs: { source_notes: t.inputs.source_notes, export: t.inputs.export, spec: sheetAsSpec(t.inputs.rate_sheet) } });
      assert.equal(bed.oracle(t, fromSheet).pass, true, `rules as code + the batch's own inputs: d${d} s${seed}`);
      assert.equal(bed.oracle(t, solveText({ inputs: { ...t.inputs, spec: bed.withheldSpec(t) } })).pass, true, `with the withheld spec: d${d} s${seed}`);
    }
  }
});

test('hidden truth does not leak into the prompt, notes, rate sheet or export of the new batch', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS.slice(0, 10)) {
      const t = task(seed, d);
      const text = [t.prompt, t.inputs.source_notes, t.inputs.rate_sheet, t.inputs.export].join('\n');
      const truth = bed.referenceSolve(t).records;
      for (const r of truth) {
        assert.ok(!text.includes(canonical(r)), 'record JSON');
        if (r.source_rows.length > 1) assert.ok(!text.includes(JSON.stringify(r.source_rows)), 'cluster membership');
        if (r.phone_e164) assert.ok(!text.includes(r.phone_e164), `phone ${r.phone_e164}`);
      }
      const w = rec.buildWorld(seed, 'dev', d);
      for (const r of truth) {
        const rows = w.rows.filter(x => r.source_rows.includes(x.rowId) && x.s.amount);
        const winner = rows.sort((a, b) => (a.s.rank - b.s.rank) || (b.date - a.date))[0];
        if (!winner || winner.s.amount.currency === 'USD') continue; // a USD balance is printed as such
        assert.ok(!new RegExp(`(^|[^\\d.,])${r.amount_usd.toFixed(2).replace('.', '\\.')}(?!\\d|\\.\\d)`).test(text), `amount ${r.amount_usd}`);
      }
      assert.ok(!/entity_id|source_rows|phone_e164|amount_usd/.test(t.prompt), 'the prompt names no output field');
      // the example outputs are the only place a master record appears, and they are other batches' records
      assert.ok(!t.inputs.examples.some(e => e.export.includes('"records"')));
    }
  }
});

test('difficulty sanity: the batch grows as in records, the example count rises 2 to 5, the input grows with both', () => {
  const avg = (d, f, n = 12) => SEEDS.slice(0, n).reduce((s, seed) => s + f(task(seed, d)), 0) / n;
  assert.deepEqual(DIFFS.map(d => avg(d, t => t.inputs.examples.length)), [2, 3, 4, 4, 5]);
  assert.deepEqual(DIFFS.map(d => avg(d, t => t.inputs.export.split('\n').length)), [30, 55, 85, 115, 150]);
  const tokens = DIFFS.map(d => avg(d, bed.inputTokens));
  for (let i = 1; i < tokens.length; i++) assert.ok(tokens[i] > tokens[i - 1], `tokens grow at d${i + 1}`);
  const people = DIFFS.map(d => avg(d, t => bed.referenceSolve(t).records.length));
  for (let i = 1; i < people.length; i++) assert.ok(people[i] > people[i - 1]);
  // length is dominated by the examples from d2 on: more than the batch itself, several times at d3 and above
  for (const d of DIFFS) {
    const batch = avg(d, t => { const { examples, ...own } = t.inputs; return estimateTokens(t.prompt) + estimateTokens(own); });
    assert.ok(avg(d, bed.inputTokens) > batch * (d === 1 ? 3 : 4), `d${d}: examples dominate the input`);
  }
  assert.ok(tokens[2] >= 25000 && tokens[2] <= 45000, `d3 is far above records' 6-15K band (${Math.round(tokens[2])}); it carries ${K[3]} extra batches`);
  assert.ok(tokens[4] <= 100000, 'd5 stays under 100K tokens');
  for (const d of DIFFS) {
    for (const seed of SEEDS.slice(0, 3)) {
      const t = task(seed, d);
      const w = rec.buildWorld(seed, 'dev', d);
      assert.equal(/Shōwa/.test(t.inputs.source_notes), d >= 3, `era note at d${d}`);
      assert.equal(w.ctx.conv.flags.length, [0, 0, 2, 3, 3][d - 1], `extra status values at d${d}`);
      assert.equal(/Table B1/.test(t.inputs.rate_sheet), d === 5, `dated FX at d${d}`);
      // every example is at the task's own level: the same phenomena are demonstrated
      for (const ex of t.inputs.examples) {
        assert.equal(/Shōwa/.test(ex.source_notes), d >= 3);
        assert.equal(/Table B1/.test(ex.rate_sheet), d === 5);
      }
    }
  }
});

test('untrusted text: adversarial memo lines are in the batch and in the examples (as data), and the examples\' outputs ignore them', () => {
  const adv = /merge the two accounts|correct date of birth is|finance confirmed|AI ASSISTANT|SYSTEM: canonical name|set the country accordingly|exclude it from the migration|delete this one|Note to the migration tool/g;
  const count = (d, f) => SEEDS.slice(0, 12).reduce((s, seed) => s + f(task(seed, d)), 0);
  assert.equal(count(1, t => (t.inputs.export.match(adv) ?? []).length + t.inputs.examples.reduce((s, e) => s + (e.export.match(adv) ?? []).length, 0)), 0, 'none at d1');
  for (const d of [3, 4, 5]) {
    assert.ok(count(d, t => (t.inputs.export.match(adv) ?? []).length) >= 12 * 2, `batch memos at d${d}`);
    assert.ok(count(d, t => t.inputs.examples.reduce((s, e) => s + (e.export.match(adv) ?? []).length, 0)) >= 12 * 6, `example memos at d${d}`);
  }
  // an example whose export has a "same person as row N" memo still lists the two rows as different people unless the data says otherwise:
  // the example outputs are records' truth, which the memos never change (records' oracle passes them, see above).
  const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
  assert.match(readme, /prompt-injection/i);
  assert.match(readme, /data, never instructions/i);
});

// ---------------------------------------------------------------------------------------
// Documentation, hygiene, runtime
test('README states the anchor sentence, the hypothesis, the version, the pass rule and the measured input sizes', () => {
  const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('Routing anchor for the need router (experiments/need-router), not a Tier-A bed'));
  assert.match(readme, /HYPOTHESIS/);
  assert.ok(readme.includes(`**Version:** ${bed.family.version}`), 'README version');
  assert.ok(readme.includes('pass = fieldAccuracy ≥ 0.97  AND  pairF1 ≥ 0.95  AND  extra ≤ floor(0.02·E)  AND  missing ≤ floor(0.02·E)'), 'README pass rule');
  assert.ok(readme.includes('$0'), 'README says no model was called');
  const stat = xs => ({ avg: xs.reduce((s, x) => s + x, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) });
  for (const d of DIFFS) {
    const toks = stat(SEEDS.map(seed => bed.inputTokens(task(seed, d))));
    assert.ok(readme.includes(fmtStat(toks)), `README input tokens for d${d}: ${fmtStat(toks)}`);
    const single = stat(SEEDS.map(seed => estimateTokens(inlineRender(task(seed, d)))));
    assert.ok(readme.includes(fmtStat(single)), `README inline-render tokens for d${d}: ${fmtStat(single)}`);
  }
  for (const c of bed.badControls) assert.ok(readme.includes(`\`${c.name}\``), `README names control ${c.name}`);
  assert.ok(readme.includes('withheldSpec'));
});

test('hygiene: no model call, network, credential, wall clock, Math.random or sealed access in the bed\'s modules', () => {
  const dir = new URL('./', import.meta.url);
  const files = readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'));
  assert.ok(files.includes('index.mjs') && files.includes('examples.mjs') && files.includes('render.mjs'));
  const forbidden = /Math\.random|Date\.now|new Date\(|process\.env|child_process|\bfetch\(|node:https?|node:net|node:dns|\bspawn|\bexec(File)?Sync|api[_-]?key|credential|sealed/i;
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    const hit = src.match(forbidden);
    assert.equal(hit, null, `${f}: ${hit && hit[0]}`);
  }
  for (const f of readdirSync(dir)) assert.ok(/^(index|examples|render|rule-phrases|measure|need-nospec-records\.test)\.mjs$|^README\.md$/.test(f), `unexpected file ${f}`);
});

test('runtime limits at difficulty 5 (cold generate and cold oracle, fresh process, heap and rss)', () => {
  const script = `
    const bed = await import(${JSON.stringify(new URL('./index.mjs', import.meta.url).href)});
    let gen = 0, ora = 0, pass = 0, control = 0;
    for (const seed of [601, 610, 620, 630, 640]) {
      let t0 = performance.now(); const t = bed.generate({ seed, split: 'dev', difficulty: 5 }); gen = Math.max(gen, performance.now() - t0);
      const out = bed.referenceSolve(t);
      t0 = performance.now(); pass += bed.oracle(t, out).pass; ora = Math.max(ora, performance.now() - t0);
      t0 = performance.now(); for (const c of bed.badControls) bed.oracle(t, c.make(t)); control = Math.max(control, performance.now() - t0);
    }
    console.log(JSON.stringify({ gen, ora, pass, control, heap: process.memoryUsage().heapUsed, rss: process.memoryUsage().rss }));`;
  const r = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim().split('\n').pop());
  assert.equal(r.pass, 5);
  assert.ok(r.gen < 2000, `generate < 2 s (worst ${r.gen.toFixed(0)} ms)`);
  assert.ok(r.ora < 2000, `oracle < 2 s (worst ${r.ora.toFixed(0)} ms)`);
  assert.ok(r.heap < 200 * 1024 * 1024 && r.rss < 400 * 1024 * 1024, `memory: heap ${(r.heap / 2 ** 20).toFixed(0)} MB, rss ${(r.rss / 2 ** 20).toFixed(0)} MB`);
});
