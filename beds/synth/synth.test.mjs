// Oracle-health tests for the `synth` bed (see beds/CONTRACT.md).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, hashOf, estimateTokens } from '../lib/canonical.mjs';
import * as bed from './index.mjs';
import { KNOBS, toCanon, resolve } from './world.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const SEEDS = Array.from({ length: 24 }, (_, i) => i);
const gen = (seed, difficulty, split = 'dev') => bed.generate({ seed, split, difficulty });

describe('interface', () => {
  test('family metadata and exports', () => {
    assert.equal(bed.family.id, 'synth');
    assert.equal(bed.family.kind, 'oneshot');
    for (const k of ['domain', 'version', 'description']) assert.equal(typeof bed.family[k], 'string');
    assert.equal(typeof bed.generate, 'function');
    assert.equal(typeof bed.oracle, 'function');
    assert.equal(typeof bed.referenceSolve, 'function');
    const names = bed.badControls.map(c => c.name);
    assert.ok(names.includes('empty') && names.includes('shuffled-or-corrupted'));
    assert.ok(names.some(n => n.startsWith('plausible-but-wrong')));
  });

  test('outputSchema stays in the portable subset', () => {
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
      for (const r of t.inputs.requested) assert.ok(t.prompt.includes(`${r.entity} | ${r.property} | ${r.unit}`));
    }
  });
});

describe('determinism', () => {
  test('identical calls give byte-identical tasks, also from a fresh module instance', async () => {
    const fresh = await import('./index.mjs?fresh-instance');
    for (const d of DIFFS) for (const split of ['dev', 'test']) for (const seed of [0, 7, 'alpha']) {
      const a = canonical(bed.generate({ seed, split, difficulty: d }));
      const b = canonical(bed.generate({ seed, split, difficulty: d }));
      const c = canonical(fresh.generate({ seed, split, difficulty: d }));
      assert.equal(a, b);
      assert.equal(a, c, `fresh instance differs at d${d} ${split} ${seed}`);
      assert.deepEqual(bed.referenceSolve(bed.generate({ seed, split, difficulty: d })), fresh.referenceSolve(fresh.generate({ seed, split, difficulty: d })));
    }
  });

  test('seed and split change the task', () => {
    for (const d of DIFFS) {
      const h = new Set([hashOf(gen(1, d)), hashOf(gen(2, d)), hashOf(gen(1, d, 'test'))]);
      assert.equal(h.size, 3);
    }
  });

  test('mutating a returned task does not affect later generations', () => {
    const t = gen(3, 3);
    const before = canonical(gen(3, 3));
    t.inputs.documents[0].text = 'tampered';
    t.inputs.documents.pop();
    assert.equal(canonical(gen(3, 3)), before);
    assert.ok(bed.oracle(gen(3, 3), bed.referenceSolve(gen(3, 3))).pass);
  });
});

describe('controls', () => {
  test('referenceSolve passes for >=20 seeds per difficulty and both splits', () => {
    for (const d of DIFFS) for (const split of ['dev', 'test']) for (const s of SEEDS) {
      const t = gen(s, d, split);
      const o = bed.oracle(t, bed.referenceSolve(t));
      assert.ok(o.pass, `reference failed d${d} ${split} s${s}: ${JSON.stringify(o.details).slice(0, 300)}`);
      assert.equal(o.score, 1);
    }
  });

  test('every bad control fails for >=20 seeds per difficulty', () => {
    for (const c of bed.badControls) for (const d of DIFFS) for (const s of SEEDS) {
      const t = gen(s, d);
      const o = bed.oracle(t, c.make(t));
      assert.equal(o.pass, false, `${c.name} passed at d${d} s${s}`);
    }
  });

  test('plausible-but-wrong controls are near misses (most cells still right)', () => {
    // A near miss should usually get a sizeable share of cells right; otherwise it is not "plausible".
    const shares = [];
    for (const c of bed.badControls.filter(x => x.name.startsWith('plausible-but-wrong') && x.name !== 'plausible-but-wrong:latest-claim')) {
      for (const s of SEEDS.slice(0, 10)) { const t = gen(s, 3); shares.push(bed.oracle(t, c.make(t)).score); }
    }
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    assert.ok(mean > 0.6, `mean near-miss score ${mean}`);
  });

  test('gated controls fail for >=20 seeds from their minimum difficulty on', () => {
    for (const c of bed.gatedControls) for (const d of DIFFS.filter(x => x >= c.minDifficulty)) for (const s of SEEDS) {
      const t = gen(s, d);
      assert.equal(bed.oracle(t, c.make(t)).pass, false, `${c.name} passed at d${d} s${s}`);
    }
  });
});

describe('oracle', () => {
  const t = gen(5, 3);
  const ref = bed.referenceSolve(t);
  const clone = () => JSON.parse(JSON.stringify(ref));

  test('rejects schema-invalid output', () => {
    const bad = [
      null, 42, 'text', [], {},
      { table: [], conflicts: [] },
      { table: {}, conflicts: [], excluded_doc_ids: [] },
      { ...clone(), extra: 1 },
      (() => { const o = clone(); o.table[0].value = String(o.table[0].value); return o; })(),
      (() => { const o = clone(); delete o.table[0].source_doc_id; return o; })(),
      (() => { const o = clone(); o.excluded_doc_ids = [1, 2]; return o; })(),
      (() => { const o = clone(); o.conflicts = [{ entity: 'x', property: 'y' }]; return o; })(),
    ];
    for (const b of bad) {
      const o = bed.oracle(t, b);
      assert.equal(o.pass, false);
      assert.equal(o.score, 0);
      assert.ok(o.details.schemaErrors.length > 0);
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
  });

  test('lenient on case/whitespace, strict on duplicates and missing rows; extra rows ignored', () => {
    const cased = clone();
    cased.table = cased.table.map(r => ({ ...r, entity: `  ${r.entity.toUpperCase()} `, property: r.property.toUpperCase(), source_doc_id: r.source_doc_id.toLowerCase() }));
    assert.ok(bed.oracle(t, cased).pass);
    const dup = clone(); dup.table.push({ ...dup.table[0] });
    assert.equal(bed.oracle(t, dup).details.cells[0].ok, false);
    const missing = clone(); missing.table.pop();
    assert.equal(bed.oracle(t, missing).pass, false);
    const extraRow = clone(); extraRow.table.push({ entity: 'nonexistent', property: 'density', value: 1, source_doc_id: 'D01' });
    assert.ok(bed.oracle(t, extraRow).pass);
  });

  test('conflicts are diagnostic only', () => {
    const noConf = clone(); noConf.conflicts = [];
    const o = bed.oracle(t, noConf);
    assert.ok(o.pass);
    assert.equal(bed.oracle(t, ref).details.conflicts.recall, 1);
  });

  test('a code name is accepted in place of the entity name', () => {
    const h = bed.hidden(t);
    const aliased = clone();
    aliased.table = aliased.table.map(r => ({ ...r, entity: h.world.entities.find(e => e.name === r.entity).alias }));
    assert.ok(bed.oracle(t, aliased).pass);
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
    const internals = ['"feats"', 'pressOnly', 'aliasOnly', 'nonstdSameDoc', '"role"', 'distractorOf', '"mode"', 'quoteOf', 'constraints', 'winner', 'supersessions', 'docMap'];
    for (const d of DIFFS) for (const s of SEEDS.slice(0, 12)) {
      const t = gen(s, d);
      const ref = bed.referenceSolve(t);
      const blob = t.prompt + canonical(t.inputs);
      for (const m of internals) assert.ok(!blob.includes(m), `internal marker ${m} leaked at d${d} s${s}`);
      // the answer as a whole, the excluded set, and (id, value) answer pairs never appear verbatim
      assert.ok(!blob.includes(canonical(ref.excluded_doc_ids)), 'excluded list leaked');
      assert.ok(!blob.includes(canonical(ref.table)), 'answer table leaked');
      for (const row of ref.table) {
        assert.ok(!blob.includes(canonical(row)), 'answer row leaked');
        assert.ok(!blob.includes(`"source_doc_id":"${row.source_doc_id}"`), 'source id leaked as a field');
      }
      // no status words in metadata (status is only discoverable from notices)
      for (const doc of t.inputs.documents) assert.ok(!/void|superseded|retracted|winner|accepted/i.test(`${doc.type} ${doc.venue}`));
    }
  });
});

describe('difficulty and content', () => {
  const stats = DIFFS.map(d => {
    const toks = [], docs = [];
    for (const s of SEEDS) { const t = gen(s, d); toks.push(estimateTokens(t.prompt) + estimateTokens(t.inputs)); docs.push(t.inputs.documents.length); }
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    return { d, tok: mean(toks), docs: mean(docs), minDocs: Math.min(...docs), maxDocs: Math.max(...docs) };
  });

  test('size grows with difficulty; level 3 sits in the 6-15K token band', () => {
    for (let i = 1; i < stats.length; i++) {
      assert.ok(stats[i].tok > stats[i - 1].tok, `tokens not increasing at d${i + 1}`);
      assert.ok(stats[i].docs > stats[i - 1].docs, `docs not increasing at d${i + 1}`);
    }
    assert.ok(stats[2].tok >= 6000 && stats[2].tok <= 15000, `d3 mean tokens ${stats[2].tok}`);
    assert.ok(stats[0].minDocs >= 12 && stats[0].maxDocs <= 20, `d1 docs ${stats[0].minDocs}-${stats[0].maxDocs}`);
    assert.ok(stats[4].docs >= 50 && stats[4].docs <= 70, `d5 docs ${stats[4].docs}`);
  });

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
        assert.ok(/reported earlier by|reported a|previous study/.test(texts), 'quoted value expected at d>=3');
      }
      if (d >= 4) assert.ok(/predicts|expected to be around|design target/.test(texts), 'prediction expected at d>=4');
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

  test('unit conversions', () => {
    assert.ok(Math.abs(toCanon('melting point', 423.15, 'K') - 150) < 1e-9);
    assert.ok(Math.abs(toCanon('melting point', 302, '°F') - 150) < 1e-9);
    assert.ok(Math.abs(toCanon('tensile strength', 10, 'ksi') - 68.94757) < 1e-9);
    assert.ok(Math.abs(toCanon('enzyme IC50', 1.2e-8, 'M') - 12) < 1e-9);
    assert.ok(Math.abs(toCanon('plasma half-life', 90, 'min') - 1.5) < 1e-12);
  });

  test('generate and oracle run well under 2 s at difficulty 5 (uncached)', async () => {
    const fresh = await import('./index.mjs?timing-instance');
    for (const s of [101, 102, 103]) {
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
  });
});
