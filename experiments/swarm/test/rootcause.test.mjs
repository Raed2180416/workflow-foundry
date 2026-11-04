// Root-cause classifier (experiments/swarm/rootcause.mjs): its counterfactual resolver equals the bed's, the reference has no
// error unit, and every bed bad control is mapped to the trap it plants (the classifier's teeth: a wrong label fails here).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as bed from '../../../beds/wbed/r6/index.mjs';
import { resolveCell, voidKeys } from '../../../beds/wbed/r6/pipeline.mjs';
import { truthOf, errorUnits, trapCounts, _resolveAlt, agentLocus, seenDocs, cellTraps } from '../rootcause.mjs';

const task = (seed, d = 5, split = 'dev') => bed.generate({ seed, split, difficulty: d });

test('the counterfactual resolver with no mistake equals the bed resolver on every cell (d3, d5)', () => {
  for (const [seed, d] of [[301, 3], [302, 5]]) {
    const t = truthOf(task(seed, d));
    for (const e of t.world.entities) for (const p of t.world.props) {
      const a = resolveCell(t.world, t.vis, t.voids, e.id, p), b = _resolveAlt(t.world, t.vis, t.voids, e.id, p);
      if (!a) { assert.equal(b, null); continue; }
      assert.equal(b.source, a.source, `${seed} ${e.code} ${p}`);
      assert.equal(b.canon, a.canon, `${seed} ${e.code} ${p}`);
    }
  }
});

test('the reference answer has no error unit; no answer is one unit', () => {
  for (const seed of [301, 303]) assert.deepEqual(errorUnits(task(seed), bed.referenceSolve(task(seed))), []);
  assert.deepEqual(errorUnits(task(301), null).map(u => u.unit), ['no-answer']);
});

// control -> the label its errors must carry (most units, or every unit). Cell mistakes are matched exactly by re-running
// the resolver with that mistake; scope mistakes by the role the generator gave the compound.
const EXPECT = {
  'scope-by-publication-date': ['T1:tested-before-cutoff'],
  'scope-plans-counted': ['T4:planned'],
  'scope-void-kept': ['T3:retracted-only'],
  'scope-namesake-lab': ['T6:namesake'],
  'scope-code-and-name-twice': ['duplicate-row'],
  'retracted-claims-used': ['retracted-claims-used'],
  'superseded-kept': ['superseded-kept'],
  'errata-skipped': ['errata-skipped'],
  'erratum-cited': ['erratum-cited'],
  'nonstandard-counted': ['nonstandard-counted'],
  'quotes-counted': ['quotes-counted'],
  'predictions-counted': ['predictions-counted'],
  'bounds-counted': ['bounds-counted'],
  'no-unit-conversion': ['no-unit-conversion'],
  'recency-only': ['recency-only'],
  'concern-voids': ['concern-voids'],
  'retraction-by-title': ['retraction-by-title'],
  'excluded-corpus-wide': ['void-but-out-of-scope'],
  'reduce-excluded-all-candidates': ['void-but-out-of-scope'],
};
test('every bad control is mapped to the trap it plants (dev 301, 302 at d5)', () => {
  for (const seed of [301, 302]) {
    const tk = task(seed);
    for (const c of bed.badControls) {
      const want = EXPECT[c.name];
      if (!want) continue;
      const units = errorUnits(tk, c.make(tk));
      assert.ok(units.length > 0, `${c.name} fails the oracle, so it has units`);
      const counts = trapCounts(units);
      for (const w of want) assert.ok(counts[w] > 0, `${seed} ${c.name}: expected ${w} in ${JSON.stringify(counts)}`);
      // the planted label explains the cell units it produced: no cell unit is left unexplained
      if (!c.name.startsWith('scope') && !c.name.startsWith('excluded') && !c.name.startsWith('reduce')) {
        const cellUnits = units.filter(u => u.unit === 'wrong-cell');
        assert.ok(cellUnits.every(u => !u.traps.some(x => x.startsWith('unexplained'))), `${seed} ${c.name}: unexplained cell units`);
      }
    }
  }
});

test('missing compounds carry their scope trap: alias and code-only compounds are labelled as such', () => {
  const tk = task(301);
  const alias = bed.badControls.find(c => c.name === 'scope-alias-missed');
  const units = errorUnits(tk, alias.make(tk)).filter(u => u.unit === 'missing-compound');
  assert.ok(units.length > 0);
  for (const u of units) assert.ok(u.traps.some(x => /^alias:|^affil:/.test(x)), JSON.stringify(u.traps));
  // empty answer: every in-scope compound missing, labelled; the code-only compound is among them
  const all = errorUnits(tk, { table: [], excluded_doc_ids: [] }).filter(u => u.unit === 'missing-compound');
  assert.equal(all.length, truthOf(tk).inScope.size);
  assert.ok(all.some(u => u.traps.includes('code-only')));
  // the dev d5 tier: some compound is established only by the split's sample-log form
  assert.ok(all.some(u => u.traps.includes('novel-date:log')));
});

test('a value-only and a source-only error are told apart, and a random value is unexplained', () => {
  const tk = task(301), t = truthOf(tk);
  const out = bed.referenceSolve(tk);
  const row = out.table[0];
  const code = t.resolve(row.entity);
  const bad = structuredClone(out);
  bad.table[0] = { ...row, value: row.value + 12345.678 };
  const u = errorUnits(tk, bad).find(x => x.unit === 'wrong-cell');
  assert.equal(u.code, code); assert.equal(u.detail.how, 'value-wrong'); assert.ok(u.traps[0].startsWith('unexplained:'));
  assert.deepEqual(cellTraps(t, code, row.property, row), { exact: [], valueOnly: [], sourceOnly: [] }, 'the right row matches no mistake');
});

test('agentLocus: a needed document counts as seen only when a tool result shows it, with the context size then', () => {
  const tk = task(301), t = truthOf(tk);
  const code = [...t.inScope].find(c => t.establishing.get(c).length === 1);
  assert.ok(code, 'some compound has exactly one establishing document');
  const doc = t.establishing.get(code)[0];
  const units = [{ unit: 'missing-compound', code, traps: [] }];
  const ev = [
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: `files/corpus/${doc}.txt` } }], usage: { input_tokens: 10, cache_read_input_tokens: 1000 } } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: `Document ${doc}\nType: Journal article` }] } },
    { type: 'assistant', message: { id: 'm2', content: [], usage: { input_tokens: 5, cache_read_input_tokens: 4321, cache_creation_input_tokens: 7 } } },
  ];
  const [l] = agentLocus(tk, units, ev);
  assert.equal(l.seen, true); assert.equal(l.contextTokens, 4333);
  assert.equal(agentLocus(tk, units, ev.slice(0, 1))[0].seenAny, false);
  // a worker's result does not count for the lead
  const sub = ev.map(e => ({ ...e, parent_tool_use_id: 'w1' }));
  assert.equal(seenDocs(sub, { parent: null }).size, 0);
  assert.equal(seenDocs(sub, { parent: 'any' }).size, 1);
});
