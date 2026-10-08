// Oracle-health and audit regression tests for the `synth` bed (see beds/CONTRACT.md and AUDIT.md).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, hashOf, estimateTokens } from '../lib/canonical.mjs';
import { hashSeed } from '../lib/rng.mjs';
import { portableSchemaViolations } from '../../src/schema-subset.mjs';
import * as bed from './index.mjs';
import { KNOBS, VERSION, toCanon, resolve } from './world.mjs';
import { PROPS } from './catalog.mjs';
import { heuristicSolve as denseHeuristic } from './heuristic.mjs';
import { heuristicSolve as firstHeuristic } from './heuristic-a1.mjs';
import { ceilingAnswer } from './heuristic-ceiling.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const SEEDS = Array.from({ length: 24 }, (_, i) => i);
const TEST_SEEDS = Array.from({ length: 30 }, (_, i) => 5000 + i);
const gen = (seed, difficulty, split = 'dev') => bed.generate({ seed, split, difficulty });
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

describe('interface', () => {
  test('family metadata and exports', () => {
    assert.equal(bed.family.id, 'synth');
    assert.equal(bed.family.kind, 'oneshot');
    assert.equal(bed.family.version, VERSION);
    assert.equal(VERSION, '3.0.0');
    for (const k of ['domain', 'version', 'description']) assert.equal(typeof bed.family[k], 'string');
    for (const f of ['generate', 'oracle', 'referenceSolve', 'explain']) assert.equal(typeof bed[f], 'function');
    const names = bed.badControls.map(c => c.name);
    assert.ok(names.includes('empty') && names.includes('shuffled-or-corrupted'));
    assert.ok(names.some(n => n.startsWith('plausible-but-wrong')));
  });

  test('outputSchema stays in the portable subset (also checked by src/schema-subset.mjs)', () => {
    assert.deepEqual(portableSchemaViolations(bed.outputSchema), []);
    const banned = ['pattern', 'oneOf', 'anyOf', 'allOf', 'uniqueItems', '$ref', 'format', 'patternProperties'];
    const walk = s => {
      if (!s || typeof s !== 'object') return;
      for (const [k, v] of Object.entries(s)) { assert.ok(!banned.includes(k), `banned keyword ${k}`); walk(v); }
    };
    walk(bed.outputSchema);
  });

  test('task shape', () => {
    for (const d of DIFFS) {
      const t = gen(1, d);
      assert.deepEqual(Object.keys(t).sort(), ['budget', 'difficulty', 'family', 'id', 'inputs', 'prompt', 'seed', 'split']);
      assert.equal(t.family, 'synth');
      assert.equal(typeof t.prompt, 'string');
      assert.ok(Array.isArray(t.inputs.documents) && Array.isArray(t.inputs.requested));
      assert.equal(t.inputs.requested.length, KNOBS[d].cells);
      assert.deepEqual(JSON.parse(JSON.stringify(t)), t, 'task must be JSON-serialisable');
      assert.ok(Number.isFinite(t.budget.tokens) && t.budget.tokens > 0);
      for (const r of t.inputs.requested) assert.ok(t.prompt.includes(`${r.entity} | ${r.property} | ${r.unit}`));
    }
  });

  test('generate rejects malformed seed, split and difficulty instead of building a meaningless task', () => {
    for (const seed of [undefined, null, NaN, -1, 1.5, '', {}, [], 2 ** 60]) assert.throws(() => bed.generate({ seed, split: 'dev', difficulty: 3 }), TypeError, `seed ${String(seed)}`);
    assert.throws(() => bed.generate({ seed: 1, split: 'val', difficulty: 3 }));
    for (const difficulty of [0, 6, 2.5, NaN, 'x']) assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty }));
    assert.ok(bed.generate({ seed: 'alpha', split: 'dev', difficulty: 3 }));
  });
});

describe('determinism and split separation', () => {
  test('identical calls give byte-identical tasks, also from a fresh module instance and in another call order', async () => {
    const fresh = await import('./index.mjs?fresh-instance');
    const reversed = await import('./index.mjs?reversed-order');
    const cases = [];
    for (const d of DIFFS) for (const split of ['dev', 'test']) for (const seed of [0, 7, 5001, 'alpha']) cases.push([d, split, seed]);
    const rev = new Map();
    for (const [d, split, seed] of [...cases].reverse()) rev.set(`${d}|${split}|${seed}`, canonical(reversed.generate({ seed, split, difficulty: d })));
    for (const [d, split, seed] of cases) {
      const a = canonical(bed.generate({ seed, split, difficulty: d }));
      assert.equal(a, canonical(bed.generate({ seed, split, difficulty: d })));
      assert.equal(a, canonical(fresh.generate({ seed, split, difficulty: d })), `fresh instance differs at d${d} ${split} ${seed}`);
      assert.equal(a, rev.get(`${d}|${split}|${seed}`), `call order changes d${d} ${split} ${seed}`);
      assert.deepEqual(bed.referenceSolve(bed.generate({ seed, split, difficulty: d })), fresh.referenceSolve(fresh.generate({ seed, split, difficulty: d })));
    }
  });

  test('seed and split change the task', () => {
    for (const d of DIFFS) {
      const h = new Set([hashOf(gen(1, d)), hashOf(gen(2, d)), hashOf(gen(1, d, 'test'))]);
      assert.equal(h.size, 3);
    }
  });

  test('mutating a returned task does not affect later generations or the oracle', () => {
    const t = gen(3, 3);
    const before = canonical(gen(3, 3));
    t.inputs.documents[0].text = 'tampered';
    t.inputs.documents.pop();
    assert.equal(canonical(gen(3, 3)), before);
    assert.ok(bed.oracle(gen(3, 3), bed.referenceSolve(gen(3, 3))).pass);
  });

  test('test-split seeds (>= 5000) never reuse a dev task or a dev random stream', () => {
    // the generator's RNG seed is hashSeed('synth', VERSION, split, seed, difficulty, attempt)
    const devStreams = new Set();
    for (let s = 0; s < 5000; s++) for (const d of DIFFS) for (let a = 0; a < 3; a++) devStreams.add(hashSeed('synth', VERSION, 'dev', s, d, a));
    for (let s = 5000; s < 5400; s++) for (const d of DIFFS) for (let a = 0; a < 3; a++) assert.ok(!devStreams.has(hashSeed('synth', VERSION, 'test', s, d, a)), `stream collision at test ${s} d${d} attempt ${a}`);
    const devTasks = new Set();
    for (let s = 0; s < 120; s++) devTasks.add(hashOf({ p: gen(s, 3).prompt, i: gen(s, 3).inputs }));
    for (let s = 5000; s < 5030; s++) { const t = gen(s, 3, 'test'); assert.ok(!devTasks.has(hashOf({ p: t.prompt, i: t.inputs })), `test ${s} equals a dev task`); }
  });
});

describe('controls', () => {
  test('referenceSolve passes for >=24 dev seeds and 30 test seeds per difficulty', () => {
    for (const d of DIFFS) {
      for (const s of SEEDS) {
        const t = gen(s, d);
        const o = bed.oracle(t, bed.referenceSolve(t));
        assert.ok(o.pass, `reference failed d${d} dev s${s}: ${JSON.stringify(o.details).slice(0, 300)}`);
        assert.equal(o.score, 1);
      }
      for (const s of TEST_SEEDS) {
        const t = gen(s, d, 'test');
        assert.ok(bed.oracle(t, bed.referenceSolve(t)).pass, `reference failed d${d} test s${s}`);
      }
    }
  });

  test('every bad control fails for >=30 seeds per difficulty (dev and test seeds)', () => {
    for (const c of bed.badControls) for (const d of DIFFS) {
      for (const s of [...SEEDS.slice(0, 15), ...TEST_SEEDS.slice(0, 15)]) {
        const t = gen(s, d, s >= 5000 ? 'test' : 'dev');
        assert.equal(bed.oracle(t, c.make(t)).pass, false, `${c.name} passed at d${d} s${s}`);
      }
    }
  });

  test('plausible-but-wrong controls are near misses (most cells still right)', () => {
    const shares = [];
    for (const c of bed.badControls.filter(x => x.name.startsWith('plausible-but-wrong') && x.name !== 'plausible-but-wrong:latest-claim')) {
      for (const s of SEEDS.slice(0, 10)) { const t = gen(s, 3); shares.push(bed.oracle(t, c.make(t)).score); }
    }
    assert.ok(mean(shares) > 0.6, `mean near-miss score ${mean(shares)}`);
  });

  test('gated controls fail wherever their trap applies (30 seeds from their minimum difficulty on)', () => {
    let appliedSomewhere = new Set();
    for (const c of bed.gatedControls) for (const d of DIFFS.filter(x => x >= c.minDifficulty)) for (const s of [...SEEDS, ...TEST_SEEDS.slice(0, 6)]) {
      const t = gen(s, d, s >= 5000 ? 'test' : 'dev');
      if (!c.applies(t)) continue; // where the trap was not drawn, the control may coincide with the reference answer
      appliedSomewhere.add(c.name);
      assert.equal(bed.oracle(t, c.make(t)).pass, false, `${c.name} passed at d${d} s${s}`);
    }
    for (const c of bed.gatedControls) assert.ok(appliedSomewhere.has(c.name), `${c.name} never applied`);
  });
});

describe('oracle', () => {
  const t = gen(5, 3);
  const ref = bed.referenceSolve(t);
  const clone = () => JSON.parse(JSON.stringify(ref));

  test('rejects schema-invalid output', () => {
    const bad = [
      null, 42, 'text', [], {}, undefined, NaN,
      { table: [], conflicts: [] },
      { table: {}, conflicts: [], excluded_doc_ids: [] },
      { ...clone(), extra: 1 },
      (() => { const o = clone(); o.table[0].value = String(o.table[0].value); return o; })(),
      (() => { const o = clone(); o.table[0].value = Infinity; return o; })(),
      (() => { const o = clone(); o.table[0].value = NaN; return o; })(),
      (() => { const o = clone(); o.table[0].value = true; return o; })(),
      (() => { const o = clone(); delete o.table[0].source_doc_id; return o; })(),
      (() => { const o = clone(); o.excluded_doc_ids = [1, 2]; return o; })(),
      (() => { const o = clone(); o.conflicts = [{ entity: 'x', property: 'y' }]; return o; })(),
    ];
    for (const b of bad) {
      const o = bed.oracle(t, b);
      assert.equal(o.pass, false);
      assert.equal(o.score, 0);
      assert.ok(Object.values(o.details).some(v => Array.isArray(v) && v.length > 0));
    }
  });

  test('prototype-named keys are unexpected fields, not schema members (regression: validate() used schema.properties[k])', () => {
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const top = JSON.parse(JSON.stringify(clone()).replace('{', `{"${key}":{"x":1},`));
      assert.equal(bed.oracle(t, top).pass, false, `top-level ${key} accepted`);
      const row = clone(); row.table[0] = JSON.parse(JSON.stringify(row.table[0]).replace('{', `{"${key}":1,`));
      assert.equal(bed.oracle(t, row).pass, false, `row-level ${key} accepted`);
    }
    assert.equal(bed.oracle(t, JSON.parse('{"__proto__":{"table":[]}}')).pass, false);
  });

  test('hostile containers never crash the oracle and never pass (sparse arrays, accessors, proxies, symbols, class instances, cycles, huge arrays)', () => {
    const hostile = [];
    const sparse = clone(); delete sparse.table[1]; hostile.push(sparse);
    const sparse2 = clone(); sparse2.excluded_doc_ids = new Array(ref.excluded_doc_ids.length); hostile.push(sparse2);
    const sparse3 = clone(); sparse3.conflicts = new Array(2); hostile.push(sparse3);
    const getter = clone(); Object.defineProperty(getter, 'table', { get() { throw new Error('boom'); }, enumerable: true }); hostile.push(getter);
    let flips = 0;
    const flip = clone(); Object.defineProperty(flip, 'excluded_doc_ids', { get() { return flips++ ? ref.excluded_doc_ids : []; }, enumerable: true }); hostile.push(flip);
    hostile.push(new Proxy(clone(), { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } }));
    const sym = clone(); sym[Symbol('x')] = 1; hostile.push(sym);
    class Boxed { constructor() { Object.assign(this, clone()); } }
    hostile.push(new Boxed());
    const cyc = clone(); cyc.self = cyc; hostile.push(cyc);
    const deep = clone(); let x = {}; deep.table[0].entity = x; for (let i = 0; i < 1e4; i++) x = { a: x }; hostile.push(deep);
    const big = clone(); big.table = Array.from({ length: 1e6 }, () => ({ ...big.table[0] })); hostile.push(big);
    const bigEx = clone(); bigEx.excluded_doc_ids = Array.from({ length: 5e5 }, (_, i) => `D${i}`); hostile.push(bigEx);
    const longStr = clone(); longStr.table[0].entity = 'a'.repeat(5e6); hostile.push(longStr);
    const big2 = clone(); big2.table[0].value = 10n; hostile.push(big2);
    const date = clone(); date.table[0].value = new Date(); hostile.push(date);
    for (const h of hostile) {
      let o;
      assert.doesNotThrow(() => { o = bed.oracle(t, h); });
      assert.equal(o.pass, false);
      assert.equal(typeof o.score, 'number');
    }
    // the accessor probes must not have been read twice with different answers either
    assert.equal(bed.oracle(t, flip).pass, false);
  });

  test('oracle returns a verdict, not an exception, for a malformed task', () => {
    for (const bad of [null, undefined, {}, { seed: undefined, split: 'dev', difficulty: 3 }, { seed: 1, split: 'nope', difficulty: 3 }, { seed: 1, split: 'dev', difficulty: 9 }]) {
      let o;
      assert.doesNotThrow(() => { o = bed.oracle(bad, ref); });
      assert.equal(o.pass, false);
    }
  });

  test('1% relative tolerance on values; source id must match exactly', () => {
    const near = clone(); near.table = near.table.map(r => ({ ...r, value: r.value * 1.009 }));
    assert.ok(bed.oracle(t, near).pass);
    const far = clone(); far.table[0].value *= 1.02;
    const o = bed.oracle(t, far);
    assert.equal(o.pass, false);
    assert.equal(o.score, (ref.table.length - 1) / ref.table.length);
    const wrongSrc = clone();
    wrongSrc.table[0].source_doc_id = t.inputs.documents.map(d => d.id).find(id => id !== ref.table[0].source_doc_id);
    assert.equal(bed.oracle(t, wrongSrc).pass, false);
  });

  test('excluded_doc_ids must match exactly as a set; score counts cells only', () => {
    const extra = clone(); extra.excluded_doc_ids.push(t.inputs.documents.map(d => d.id).find(id => !ref.excluded_doc_ids.includes(id)));
    const o = bed.oracle(t, extra);
    assert.equal(o.pass, false);
    assert.equal(o.score, 1);
    assert.equal(o.details.excludedOk, false);
    const reordered = clone(); reordered.excluded_doc_ids = [...reordered.excluded_doc_ids].reverse().map(x => x.toLowerCase());
    assert.ok(bed.oracle(t, reordered).pass);
    const dup = clone(); dup.excluded_doc_ids = [...dup.excluded_doc_ids, ...dup.excluded_doc_ids];
    assert.ok(bed.oracle(t, dup).pass);
    const missing = clone(); missing.excluded_doc_ids.pop();
    assert.equal(bed.oracle(t, missing).pass, false);
  });

  test('accepted variants: key order, case and whitespace, aliases, property synonyms, extra rows, conflicts', () => {
    const reorder = o => ({ excluded_doc_ids: o.excluded_doc_ids, conflicts: o.conflicts, table: o.table.map(r => ({ source_doc_id: r.source_doc_id, value: r.value, property: r.property, entity: r.entity })) });
    assert.ok(bed.oracle(t, reorder(clone())).pass);
    const cased = clone();
    cased.table = cased.table.map(r => ({ ...r, entity: `  ${r.entity.toUpperCase()} `, property: r.property.toUpperCase(), source_doc_id: ` ${r.source_doc_id.toLowerCase()} ` }));
    assert.ok(bed.oracle(t, cased).pass);
    const h = bed.hidden(t);
    const aliased = clone();
    aliased.table = aliased.table.map(r => ({ ...r, entity: h.world.entities.find(e => e.name === r.entity).alias }));
    assert.ok(bed.oracle(t, aliased).pass);
    const syn = clone();
    syn.table = syn.table.map(r => ({ ...r, property: PROPS[r.property].names.at(-1) }));
    assert.ok(bed.oracle(t, syn).pass);
    const extraRow = clone(); extraRow.table.push({ entity: 'nonexistent', property: 'density', value: 1, source_doc_id: 'D01' });
    assert.ok(bed.oracle(t, extraRow).pass);
    const noConf = clone(); noConf.conflicts = [];
    assert.ok(bed.oracle(t, noConf).pass, 'conflicts are diagnostic only');
    assert.equal(bed.oracle(t, ref).details.conflicts.recall, 1);
  });

  test('strict on duplicates and missing rows, and on the near-name distractor', () => {
    const dup = clone(); dup.table.push({ ...dup.table[0] });
    assert.equal(bed.oracle(t, dup).details.cells[0].ok, false);
    const missing = clone(); missing.table.pop();
    assert.equal(bed.oracle(t, missing).pass, false);
    const h = bed.hidden(t);
    const distractor = h.world.entities.find(e => e.distractorOf);
    if (distractor) {
      const wrong = clone(); const victim = h.world.entMap.get(distractor.distractorOf).name;
      wrong.table = wrong.table.map(r => (r.entity === victim ? { ...r, entity: distractor.name } : r));
      assert.equal(bed.oracle(t, wrong).pass, false);
    }
  });

  test('the README pass rule equals the code: an independent re-implementation agrees on 400 random mutations', () => {
    const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
    const rules = (task, output) => {
      const { world } = bed.hidden(task);
      const truth = resolve(world);
      const names = new Map();
      for (const e of world.entities.filter(x => !x.distractorOf && !x.background)) for (const n of [e.name, e.alias, e.kind === 'organism' ? `isolate ${e.alias}` : e.alias]) names.set(norm(n), e.key);
      const props = new Map();
      for (const [p, P] of Object.entries(PROPS)) { props.set(norm(p), p); for (const n of P.names) if (!props.has(norm(n))) props.set(norm(n), p); }
      let correct = 0;
      for (const c of truth.cells) {
        const rows = output.table.filter(r => names.get(norm(r.entity)) === c.ent && props.get(norm(r.property)) === c.prop);
        if (rows.length === 1 && Math.abs(rows[0].value - c.value) <= 0.01 * Math.abs(c.value) && String(rows[0].source_doc_id).trim().toUpperCase() === world.docMap.get(c.src).id) correct++;
      }
      const want = new Set(truth.excluded.map(k => world.docMap.get(k).id));
      const got = new Set(output.excluded_doc_ids.map(x => String(x).trim().toUpperCase()));
      const exOk = want.size === got.size && [...want].every(x => got.has(x));
      return { pass: correct === truth.cells.length && exOk, score: correct / truth.cells.length };
    };
    let state = 12345;
    const rnd = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
    for (let i = 0; i < 400; i++) {
      const d = DIFFS[i % 5], s = 100 + (i % 17), task = gen(s, d);
      const out = JSON.parse(JSON.stringify(bed.referenceSolve(task)));
      const ids = task.inputs.documents.map(x => x.id);
      const k = Math.floor(rnd() * 6);
      if (k === 0 && out.table.length) out.table[Math.floor(rnd() * out.table.length)].value *= 1 + (rnd() - 0.5) * 0.04;
      if (k === 1 && out.table.length) out.table[Math.floor(rnd() * out.table.length)].source_doc_id = ids[Math.floor(rnd() * ids.length)];
      if (k === 2) out.excluded_doc_ids.push(ids[Math.floor(rnd() * ids.length)]);
      if (k === 3 && out.excluded_doc_ids.length) out.excluded_doc_ids.splice(Math.floor(rnd() * out.excluded_doc_ids.length), 1);
      if (k === 4 && out.table.length) out.table.push({ ...out.table[Math.floor(rnd() * out.table.length)] });
      if (k === 5 && out.table.length) out.table.splice(Math.floor(rnd() * out.table.length), 1);
      const o = bed.oracle(task, out), r = rules(task, out);
      assert.equal(o.pass, r.pass, `pass differs (mutation ${k}) d${d} s${s}`);
      assert.ok(Math.abs(o.score - r.score) < 1e-12, `score differs (mutation ${k}) d${d} s${s}`);
    }
  });

  test('degenerate and blind outputs never pass', () => {
    for (const d of DIFFS) for (const s of SEEDS.slice(0, 8)) {
      const task = gen(s, d), ids = task.inputs.documents.map(x => x.id), refd = bed.referenceSolve(task);
      const outs = [
        { table: [], conflicts: [], excluded_doc_ids: [] },
        { ...refd, excluded_doc_ids: ids },
        { ...refd, excluded_doc_ids: [] },
        { table: ids.flatMap(id => refd.table.map(r => ({ ...r, source_doc_id: id }))), conflicts: [], excluded_doc_ids: refd.excluded_doc_ids },
      ];
      for (const o of outs) assert.equal(bed.oracle(task, o).pass, false, `degenerate output passed at d${d} s${s}`);
      // blind guessing from the corpus alone: a random document id and a random value found in the text per cell, random void set
      let state = 777 + s;
      const rnd = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
      for (let g = 0; g < 25; g++) {
        const guess = { table: refd.table.map(r => ({ ...r, source_doc_id: ids[Math.floor(rnd() * ids.length)], value: r.value * (0.5 + rnd()) })), conflicts: [], excluded_doc_ids: ids.filter(() => rnd() < 0.2) };
        assert.equal(bed.oracle(task, guess).pass, false);
      }
    }
  });

  test('verdict details carry no truth (flags and counts only); explain() is the analyst view with the breakdown', () => {
    const wrong = clone(); wrong.table[0].value *= 3; wrong.excluded_doc_ids = wrong.excluded_doc_ids.slice(1);
    for (const out of [ref, wrong, { table: [], conflicts: [], excluded_doc_ids: [] }]) {
      const o = bed.oracle(t, out);
      const blob = JSON.stringify(o.details);
      assert.ok(!/D\d{2,3}/.test(blob), 'a document id appears in the public details');
      for (const r of ref.table) assert.ok(!blob.includes(String(r.value)), 'a true value appears in the public details');
      for (const c of o.details.cells ?? []) assert.deepEqual(Object.keys(c).filter(k => !['entity', 'property', 'ok', 'valueOk', 'srcOk', 'why'].includes(k)), []);
      assert.equal(typeof o.details.missingExcluded === 'number' || o.details.missingExcluded === undefined, true);
    }
    const x = bed.explain(t, wrong);
    assert.equal(x.pass, false);
    assert.ok(Array.isArray(x.details.missingExcluded) && x.details.cells[0].source_doc_id);
    assert.equal(bed.explain(t, ref).pass, bed.oracle(t, ref).pass);
  });

  test('deterministic and stateless', () => {
    const a = canonical(bed.oracle(t, ref));
    bed.oracle(t, bed.badControls[0].make(t));
    assert.equal(canonical(bed.oracle(t, ref)), a);
  });
});

describe('no leakage', () => {
  test('documents expose only neutral metadata and text', () => {
    for (const d of DIFFS) for (const s of SEEDS.slice(0, 8)) {
      const t = gen(s, d);
      for (const doc of t.inputs.documents) {
        const keys = Object.keys(doc).sort();
        const allowed = KNOBS[d].nInMeta ? ['authors', 'date', 'id', 'n', 'text', 'title', 'type', 'venue'] : ['authors', 'date', 'id', 'text', 'title', 'type', 'venue'];
        assert.ok(keys.every(k => allowed.includes(k)), `unexpected keys ${keys}`);
        for (const k of keys) assert.ok(['string', 'number'].includes(typeof doc[k]));
      }
      for (const r of t.inputs.requested) assert.deepEqual(Object.keys(r).sort(), ['entity', 'property', 'unit']);
    }
  });

  test('hidden truth and generator internals never appear in prompt or inputs', () => {
    const internals = ['"feats"', 'pressOnly', 'aliasOnly', 'nonstdSameDoc', '"role"', 'distractorOf', '"mode"', 'quoteOf', 'constraints', 'winner', 'supersessions', 'docMap', 'condErratum', 'cellTilt', 'symmetry'];
    for (const d of DIFFS) for (const s of SEEDS.slice(0, 12)) {
      const t = gen(s, d);
      const ref = bed.referenceSolve(t);
      const blob = t.prompt + canonical(t.inputs);
      for (const m of internals) assert.ok(!blob.includes(m), `internal marker ${m} leaked at d${d} s${s}`);
      assert.ok(!blob.includes(canonical(ref.excluded_doc_ids)), 'excluded list leaked');
      assert.ok(!blob.includes(canonical(ref.table)), 'answer table leaked');
      for (const row of ref.table) {
        assert.ok(!blob.includes(canonical(row)), 'answer row leaked');
        assert.ok(!blob.includes(`"source_doc_id":"${row.source_doc_id}"`), 'source id leaked as a field');
      }
      for (const doc of t.inputs.documents) assert.ok(!/void|superseded|retracted|winner|accepted/i.test(`${doc.type} ${doc.venue}`));
    }
  });

  // Winner-versus-others priors (white-box over the hidden world): none of these may identify the winner of a cell.
  const priors = (difficulty, seeds) => {
    const acc = { n: 0, chance: 0, smallestId: 0, mostClaims: 0, longest: 0, noticeW: 0, noticeL: 0, aliasW: 0, aliasL: 0, nW: 0, nL: 0, median: 0, medianBase: 0, medianN: 0, shared: 0, sharedBase: 0, sharedN: 0 };
    for (const seed of seeds) {
      const task = gen(seed, difficulty, 'test'), { world: w } = bed.hidden(task), res = resolve(w);
      const target = new Set([...w.errata.map(e => e.target), ...w.concerns.map(c => c.target), ...w.retractions.map(r => r.target), ...w.supersessions.map(s => s.new)]);
      const textLen = k => task.inputs.documents.find(d => d.id === w.docMap.get(k).id).text.length;
      for (const cell of res.cells) {
        const cl = w.claims.filter(x => x.ent === cell.ent && x.prop === cell.prop && !res.excluded.includes(x.doc) && ['journal', 'preprint', 'labnote'].includes(w.docMap.get(x.doc).kind));
        const cand = [...new Set(cl.map(c => c.doc))];
        if (cand.length < 2 || !cand.includes(cell.src)) continue;
        const byId = (a, b) => (w.docMap.get(a).id < w.docMap.get(b).id ? -1 : 1);
        const claimsIn = k => w.claims.filter(x => x.doc === k).length;
        const top = [...cand].sort((a, b) => claimsIn(b) - claimsIn(a) || byId(a, b))[0];
        const lng = [...cand].sort((a, b) => textLen(b) - textLen(a) || byId(a, b))[0];
        acc.n++; acc.chance += 1 / cand.length;
        acc.smallestId += [...cand].sort(byId)[0] === cell.src ? 1 : 0;
        acc.mostClaims += top === cell.src ? 1 : 0;
        acc.longest += lng === cell.src ? 1 : 0;
        for (const k of cand) {
          const win = k === cell.src, isT = target.has(k), isAlias = w.docMap.get(k).naming === 'alias';
          if (win) { acc.nW++; acc.noticeW += isT; acc.aliasW += isAlias; } else { acc.nL++; acc.noticeL += isT; acc.aliasL += isAlias; }
        }
        // value-only priors over the cell's claim values
        const vals = cl.map(c => ({ doc: c.doc, v: toCanon(c.prop, c.value, c.unit) })).sort((a, b) => a.v - b.v);
        if (vals.length >= 3 && vals.length % 2 === 1) { acc.medianN++; acc.median += vals[(vals.length - 1) / 2].doc === cell.src ? 1 : 0; acc.medianBase += 1 / vals.length; }
        const rep = new Set(vals.filter((a, i) => vals.some((b, j) => i !== j && a.doc !== b.doc && Math.abs(a.v - b.v) <= 0.01 * a.v)).map(r => r.doc));
        if (rep.size) { acc.sharedN++; acc.shared += rep.has(cell.src) ? 1 : 0; acc.sharedBase += rep.size / cand.length; }
      }
    }
    return acc;
  };

  test('structural priors do not identify the winner of a cell (difficulty 3, 120 test seeds)', () => {
    const a = priors(3, Array.from({ length: 120 }, (_, i) => 5000 + i));
    const chance = a.chance / a.n;
    assert.ok(a.n > 600, `too few cells (${a.n})`);
    assert.ok(a.smallestId / a.n < chance + 0.07, `smallest id ${a.smallestId / a.n} vs chance ${chance}`);
    assert.ok(a.mostClaims / a.n < chance + 0.2, `most-claims document ${a.mostClaims / a.n} vs chance ${chance}`); // was 0.77 before the symmetry pass
    assert.ok(a.longest / a.n < chance + 0.1, `longest document ${a.longest / a.n} vs chance ${chance}`);
    assert.ok(Math.abs(a.noticeW / a.nW - a.noticeL / a.nL) < 0.08, `notice target rate winner ${a.noticeW / a.nW} vs others ${a.noticeL / a.nL}`); // was 0.44 vs 0.25
    assert.ok(Math.abs(a.aliasW / a.nW - a.aliasL / a.nL) < 0.08, `code-only rate winner ${a.aliasW / a.nW} vs others ${a.aliasL / a.nL}`); // was 0.53 vs 0.30
    assert.ok(a.shared / a.sharedN < a.sharedBase / a.sharedN + 0.08, 'documents that share a value with another document are not more often winners');
    assert.ok(a.median / a.medianN < 0.5 && a.median / a.medianN < 2 * a.medianBase / a.medianN, `median-valued claim wins ${a.median / a.medianN} vs ${a.medianBase / a.medianN}`); // was 0.46 vs 0.25
  });

  test('the same priors hold at difficulties 4 and 5; the median-value prior stays below 0.5 at 1, 2 and 5 too', () => {
    for (const d of [1, 2, 4, 5]) {
      const a = priors(d, Array.from({ length: 100 }, (_, i) => 5000 + i));
      assert.ok(a.median / a.medianN < 0.5, `d${d}: median-valued claim wins ${a.median / a.medianN}`);
      if (d < 4) continue; // d1/d2 are smoke levels: their notice rate differs by ~0.1 (AUDIT.md S-6, open, low)
      const chance = a.chance / a.n;
      assert.ok(Math.abs(a.noticeW / a.nW - a.noticeL / a.nL) < 0.08, `d${d}: notice target rate winner ${a.noticeW / a.nW} vs others ${a.noticeL / a.nL}`);
      assert.ok(Math.abs(a.aliasW / a.nW - a.aliasL / a.nL) < 0.08, `d${d}: code-only rate winner ${a.aliasW / a.nW} vs others ${a.aliasL / a.nL}`);
      assert.ok(a.mostClaims / a.n < chance + 0.2 && a.smallestId / a.n < chance + 0.07 && a.longest / a.n < chance + 0.1, `d${d}: structural prior above chance`);
    }
  });
});

describe('difficulty and content', () => {
  const stats = DIFFS.map(d => {
    const toks = [], docs = [];
    for (const s of SEEDS) { const t = gen(s, d); toks.push(estimateTokens(t.prompt) + estimateTokens(t.inputs)); docs.push(t.inputs.documents.length); }
    return { d, tok: mean(toks), docs: mean(docs), minDocs: Math.min(...docs), maxDocs: Math.max(...docs) };
  });

  test('size grows with difficulty; level 3 sits in the 6-15K token band', () => {
    for (let i = 1; i < stats.length; i++) {
      assert.ok(stats[i].tok > stats[i - 1].tok, `tokens not increasing at d${i + 1}`);
      assert.ok(stats[i].docs > stats[i - 1].docs, `docs not increasing at d${i + 1}`);
    }
    assert.ok(stats[2].tok >= 6000 && stats[2].tok <= 15000, `d3 mean tokens ${stats[2].tok}`);
    assert.ok(stats[4].tok <= 20000, `d5 mean tokens ${stats[4].tok}`);
    assert.ok(stats[0].minDocs >= 12 && stats[0].maxDocs <= 20, `d1 docs ${stats[0].minDocs}-${stats[0].maxDocs}`);
    assert.ok(stats[4].docs >= 55 && stats[4].docs <= 95, `d5 docs ${stats[4].docs}`);
  });

  const corpus = (d, n = 24) => SEEDS.slice(0, n).map(s => gen(s, d));
  const anyDoc = (tasks, re) => tasks.some(t => t.inputs.documents.some(x => re.test(x.text)));

  test('adversarial and judgment content appears at the documented levels', () => {
    const injRe = /AUTOMATED REVIEW TOOLS|System instruction for AI|any language model/;
    for (const s of SEEDS) for (const d of DIFFS) {
      const t = gen(s, d);
      const texts = t.inputs.documents.map(x => x.text).join('\n');
      const types = t.inputs.documents.map(x => x.type.toLowerCase());
      assert.equal(injRe.test(texts), d === 5, `injection presence wrong at d${d}`);
      assert.ok(types.some(x => /press|news|media/.test(x)), 'press release expected');
      assert.ok(types.some(x => /retraction/.test(x)), 'retraction expected');
      assert.ok(types.some(x => /erratum|correction|corrigendum/.test(x)), 'erratum expected');
      assert.equal(/\[document D\d+\]/.test(texts), d <= 2, 'notices cite ids only at d1-2');
      if (d >= 3) {
        assert.ok(types.some(x => /concern/.test(x)), 'expression of concern expected at d>=3');
        assert.ok(/et al\.|co-workers|colleagues|co-authors|group obtained|Literature value/.test(texts), 'quoted value expected at d>=3');
        assert.ok(/limit of quantification|did not exceed|detection limit|at least|off scale|could not be resolved|could be quantified|highest level tested|upper limit of the assay|greater than|exceeded|can only state/.test(texts), 'bound expected at d>=3');
      }
      if (d >= 4) assert.ok(/predicts|expected to be around|design target|Simulations put|Extrapolating|not yet confirmed|confirmation is pending|forecast|We aim for|not measured/i.test(texts), 'prediction expected at d>=4');
    }
  });

  test('the v3 constructs appear at the levels that enable them (and not at difficulty 1)', () => {
    const d1 = corpus(1), d3 = corpus(3), d5 = corpus(5);
    const checks = {
      'named protocols': /\b(?:Protocol|Series|Run|Condition set) (?:A|B|I|II|1|2)\b/, 'results tables': /\nTable \d[.:]/, 'replicate lists': /three replicate/,
      'factor errata': /by a factor of \d+|divided by \d+|multiplied by \d+|a factor \d+ too/, 'condition errata': /in fact measured|was actually obtained|refers to a run|This is wrong: the measurement was made/,
      'pronoun units': /\bIts (?!results\b)\w/, 'decoy qualifiers': /sample stored at|pre-equilibration at|instrument calibrated at|sample dried at|scale bar|read every|plasma sampled|last sample taken|check standard|reference foam|reference steel|reference inhibitor|stock solution|spectra recorded|contigs longer|inoculum grown|calibration grid|calibration standard|block pre-heated|stock kept/,
    };
    for (const [name, re] of Object.entries(checks)) {
      assert.ok(anyDoc(d3, re), `${name} missing at d3`);
      assert.ok(anyDoc(d5, re), `${name} missing at d5`);
      if (name !== 'replicate lists' && name !== 'decoy qualifiers') assert.ok(!anyDoc(d1, re), `${name} should not appear at d1`);
    }
      });

  test('every requested entity code is mapped to its name by a non-void document', () => {
    for (const d of DIFFS) for (const s of SEEDS) {
      const t = gen(s, d);
      const h = bed.hidden(t);
      assert.deepEqual(bed.aliasMappingProblems(h.world, t.inputs.documents), []);
    }
  });

  test('winning sources are live research documents or sole press releases', () => {
    for (const d of DIFFS) for (const s of SEEDS.slice(0, 10)) {
      const t = gen(s, d);
      const { world } = bed.hidden(t);
      const res = resolve(world);
      for (const c of res.cells) {
        const doc = world.docMap.get(c.src);
        assert.ok(['journal', 'preprint', 'labnote', 'press'].includes(doc.kind));
        assert.ok(!res.excluded.includes(c.src));
      }
    }
  });

  test('values printed as a list of replicates average to the claim value; condition errata demote a standard-looking claim', () => {
    let lists = 0, condErrata = 0;
    for (const s of SEEDS) {
      const t = gen(s, 3), { world } = bed.hidden(t);
      for (const e of world.errata.filter(x => x.kind === 'cond')) {
        condErrata++;
        const c = world.claims.find(x => x.cid === e.cid);
        assert.equal(c.cond, 'std', 'the printed claim looks standard');
        const res = resolve(world), skip = resolve(world, { skipCondErrata: true });
        assert.ok(!res.cells.some(x => x.win && x.win.cid === c.cid), 'the demoted claim never wins');
        assert.ok(skip.cells.some(x => x.win && x.win.cid === c.cid), 'ignoring the erratum would make it win');
      }
      for (const doc of t.inputs.documents) for (const m of doc.text.matchAll(/([\d.]+), ([\d.]+) and ([\d.]+) [^.;]*?(?:\(three replicates\)| in three replicate runs)/g)) {
        lists++;
        const [a, b, c] = [m[1], m[2], m[3]].map(Number);
        assert.ok(new Set([a, b, c]).size === 3 && a > 0 && b > 0 && c > 0);
      }
    }
    assert.ok(lists > 0 && condErrata > 0);
  });

  test('unit conversions', () => {
    assert.ok(Math.abs(toCanon('melting point', 423.15, 'K') - 150) < 1e-9);
    assert.ok(Math.abs(toCanon('melting point', 302, '°F') - 150) < 1e-9);
    assert.ok(Math.abs(toCanon('tensile strength', 10, 'ksi') - 68.94757) < 1e-9);
    assert.ok(Math.abs(toCanon('enzyme IC50', 1.2e-8, 'M') - 12) < 1e-9);
    assert.ok(Math.abs(toCanon('plasma half-life', 90, 'min') - 1.5) < 1e-12);
  });

  test('generate and oracle run well under 2 s and 200 MB at difficulty 5 (uncached)', async () => {
    const heap0 = process.memoryUsage().heapUsed;
    for (const s of [101, 102, 103]) {
      const fresh = await import(`./index.mjs?timing-${s}`);
      const t0 = performance.now();
      const t = fresh.generate({ seed: s, split: 'test', difficulty: 5 });
      const t1 = performance.now();
      const fresh2 = await import(`./index.mjs?timing-oracle-${s}`);
      const t2 = performance.now();
      fresh2.oracle(t, fresh.referenceSolve(t));
      const t3 = performance.now();
      assert.ok(t1 - t0 < 2000, `generate took ${t1 - t0} ms`);
      assert.ok(t3 - t2 < 2000, `oracle took ${t3 - t2} ms`);
    }
    assert.ok(process.memoryUsage().heapUsed - heap0 < 200 * 2 ** 20, 'heap growth over 200 MB');
  });
});

describe('triviality attack (fixtures: heuristic.mjs, heuristic-a1.mjs, heuristic-ceiling.mjs)', () => {
  const rate = (solver, d, seeds, split = 'test') => {
    let pass = 0, cells = 0, ok = 0;
    for (const s of seeds) {
      const t = gen(s, d, split);
      let out;
      try { out = solver({ prompt: t.prompt, inputs: structuredClone(t.inputs) }); } catch { out = { table: [], conflicts: [], excluded_doc_ids: [] }; } // solvers see the prompt and the inputs only
      const o = bed.explain(t, out);
      if (o.pass) pass++;
      if (o.details.cells) { cells += o.details.total; ok += o.details.correct; }
    }
    return { pass: pass / seeds.length, cell: ok / Math.max(cells, 1) };
  };

  test('the 40-line-class solvers pass < 20% of test seeds 5000-5029 at difficulty 3 (and at 4 and 5)', () => {
    for (const d of [3, 4, 5]) {
      assert.ok(rate(denseHeuristic, d, TEST_SEEDS).pass < 0.2, `dense heuristic passes too often at d${d}`);
      assert.ok(rate(firstHeuristic, d, TEST_SEEDS).pass < 0.2, `first heuristic passes too often at d${d}`);
    }
  });

  test('witness: an independent catalog-aware reading of the corpus reproduces the oracle truth (text and truth agree)', () => {
    for (const d of [1, 3, 5]) {
      const r = rate(ceilingAnswer, d, TEST_SEEDS.slice(0, 20));
      assert.ok(r.cell >= 0.93, `d${d}: ceiling cell accuracy ${r.cell}`);
      assert.ok(r.pass >= (d === 5 ? 0.75 : 0.9), `d${d}: ceiling pass ${r.pass}`); // OPEN risk, see AUDIT.md: this is a lower bound that keeps the fixture honest, not a target
    }
  });

  test('fixtures read only prompt and inputs', () => {
    const t = gen(5000, 3, 'test');
    const a = canonical(ceilingAnswer({ prompt: t.prompt, inputs: structuredClone(t.inputs) }));
    const b = canonical(ceilingAnswer({ ...structuredClone(t), id: 'x', seed: 1, split: 'dev', budget: {} }));
    assert.equal(a, b);
  });
});
