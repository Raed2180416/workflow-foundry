// M4 (ATTACK-20261014 §3 M4; PROOF-LEDGER K6): the typed enumerator over the executable cards, its type rules, the
// temporal constraints, soundness on compositions known to be valid, the kill rule, and the committed result. $0: no
// model, Jev or network call; beds are used through generate() and outputSchema only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { loadL1 } from '../cards.mjs';
import { interfaces, cardInterface, enumerateCompositions, listSites, compatible, closeTop, kindSchema, taskSpecInputType, schemaOfValue,
  temporalPairs, violation, accepts, decide, codeOrder, containsInOrder, SLOT_TYPED, FROZEN_TEMPORAL, MAX_DEPTH } from '../enumerate.mjs';
import { fixtureTasks, wbedTasks, measureM4, cardDigests } from '../m4.mjs';
import { WBED_CORE, SCRIPTED_PLANS, containsInOrder as goldContains } from '../fixtures/enumerate-gold.mjs';

const l1 = loadL1(), cards = interfaces(l1);
const byId = id => cards.find(c => c.id === id);
const R1 = { type: 'object', required: ['customers', 'totals'], properties: { customers: { type: 'array' }, totals: { type: 'object' } } };

test('M4 interfaces: readers, list sites needed and outputs are derived from card.json', () => {
  assert.deepEqual(cards.map(c => c.id), ['P01', 'P03', 'P07', 'P08', 'P09', 'P12', 'P13', 'P15', 'P16', 'P17', 'P20', 'P54', 'P58', 'P59', 'P60']);
  for (const c of cards) {
    const card = l1.find(e => e.id === c.id);
    for (const r of c.readers) assert.ok(card.slots.some(d => d.name === r.slot && d.type === r.type), `${c.id}.${r.slot}`);
    assert.equal(c.out === SLOT_TYPED, card.fragment.out == null, `${c.id}: slot-typed iff fragment.out is null`);
  }
  assert.deepEqual(cards.filter(c => c.needsLists === 0).map(c => c.id), ['P01', 'P20', 'P54'], 'only fn / judge / no readers accept any value');
  assert.equal(byId('P17').needsLists, 2);
  assert.deepEqual(cards.filter(c => c.out === SLOT_TYPED).map(c => c.id), ['P01', 'P12', 'P54']);
  assert.deepEqual(byId('P20').out.required, ['result']); assert.ok('result' in byId('P20').out.properties, 'closeTop keeps required keys as properties');
});

test('M4 closed outputs: every fixed-output card\'s fixtures return only its declared top-level keys (the closeTop assumption)', () => {
  let n = 0;
  for (const card of l1.filter(e => e.executable && e.fragment.out)) {
    const keys = Object.keys(closeTop(card.fragment.out).properties);
    for (const fx of card.fixtures.filter(f => f.expect?.output && typeof f.expect.output === 'object')) {
      for (const k of Object.keys(fx.expect.output)) assert.ok(keys.includes(k), `${card.id}/${fx.name}: ${k} not in {${keys}}`);
      n++;
    }
  }
  assert.ok(n >= 24, `${n} fixture outputs checked`);
});

test('M4 types: list sites, compatibility and TaskSpec kinds on the portable subset', () => {
  assert.equal(listSites({ type: 'string' }), 0);
  assert.equal(listSites({ type: 'object', additionalProperties: { type: 'string' } }), 0, 'a map of text holds no list');
  assert.equal(listSites({ type: 'object', properties: { a: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }), 1);
  assert.equal(listSites({ type: 'object', properties: { a: { type: 'string' } } }), Infinity, 'an open object may hold anything');
  assert.equal(listSites(SLOT_TYPED), Infinity); assert.equal(listSites({}), Infinity);
  assert.equal(compatible(SLOT_TYPED, R1).ok, true);
  assert.equal(compatible(byId('P15').out, R1).ok, false, 'P15 never produces customers');
  assert.equal(compatible(byId('P15').outDeclared, R1).ok, true, 'as declared (open) it might');
  assert.equal(compatible({ type: 'integer' }, { type: 'number' }).ok, true);
  assert.equal(compatible({ enum: ['a'] }, { enum: ['b'] }).ok, false);
  assert.equal(compatible({ type: 'array', items: { type: 'string' } }, { type: 'array', items: { type: 'object' } }).ok, false);
  assert.deepEqual(kindSchema('map of text'), { type: 'object', additionalProperties: { type: 'string' } });
  assert.deepEqual(kindSchema('list'), { type: 'array', items: {} });
  assert.deepEqual(kindSchema('a pile of things'), {}, 'unknown kinds are unconstrained, never guessed');
  const ts = taskSpecInputType({ inputs: [{ path: 'inputs.a', kind: 'text' }, { path: 'inputs.b.c', kind: 'list of text' }] });
  assert.equal(listSites(ts), 1); assert.equal(ts.additionalProperties, false);
  assert.deepEqual(schemaOfValue({ a: [1, 2], b: 'x' }, { closed: true }), { type: 'object', required: ['a', 'b'], properties: { a: { type: 'array', items: { type: 'integer' } }, b: { type: 'string' } }, additionalProperties: false });
});

test('M4 temporal: pairs come from card.json plus the one frozen-card rule; a violation is any B before an A', () => {
  const pairs = temporalPairs(cards);
  assert.deepEqual(pairs.map(p => `${p.before}<${p.after}`), ['P03<P12', 'P03<P15', 'P03<P17', 'P03<P58', 'P16<P12', 'P16<P15', 'P16<P17', 'P54<P15', 'P58<P07', 'P58<P60']);
  for (const p of pairs) assert.ok(p.source.length > 20, `${p.before}<${p.after} cites a source`);
  assert.equal(FROZEN_TEMPORAL.length, 1);
  for (const id of ['P58', 'P59', 'P60']) assert.equal(l1.find(e => e.id === id).temporal, undefined, `${id} is frozen; no field was added`);
  const v = s => violation(s, pairs)?.before ?? null;
  assert.equal(v(['P17', 'P16']), 'P16'); assert.equal(v(['P16', 'P17']), null);
  assert.equal(v(['P16', 'P17', 'P16']), 'P16', 'every A precedes every B'); assert.equal(v(['P12', 'P01']), null);
});

// An independent reference: every sequence over the alphabet, kept when each card accepts its environment, no pair is
// violated and the last output is compatible. The DFS must return exactly this set.
function bruteForce({ input, output, layer, maxDepth = MAX_DEPTH }) {
  const pairs = layer === 'temporal' ? temporalPairs(cards) : [], keep = [];
  const ok = seq => {
    let x = input;
    for (let i = 0; i < seq.length; i++) {
      const c = byId(seq[i]);
      if (!accepts(c, { input, x, first: i === 0, layer })) return false;
      x = layer === 'raw' ? c.outDeclared : c.out;
    }
    return !violation(seq, pairs) && compatible(x, output).ok;
  };
  const grow = seq => { for (const c of cards) { const s = [...seq, c.id]; if (ok(s)) keep.push(s.join('>')); if (s.length < maxDepth) grow(s); } };
  grow([]);
  return keep.sort();
}

test('M4 enumerator: depth-first reachability returns exactly the brute-force set (two input types, two layers)', () => {
  const fx = fixtureTasks(l1).find(t => t.card === 'P16');
  for (const [input, output] of [[taskSpecInputType({ inputs: [{ path: 'inputs.a', kind: 'text' }, { path: 'inputs.m', kind: 'map of text' }] }), R1], [fx.input, fx.output]])
    for (const layer of ['typed', 'temporal']) {
      const e = enumerateCompositions({ input, output, cards, layer, maxDepth: 3 });
      assert.deepEqual(e.candidates.map(s => s.join('>')).sort(), bruteForce({ input, output, layer, maxDepth: 3 }), layer);
      assert.equal(e.total, e.candidates.length); assert.equal(e.byDepth.length, 3);
    }
});

test('M4 soundness: compositions known to be valid are enumerated (card fixtures [card]; the step-6 scripted plans; every W-bed core)', async () => {
  for (const t of fixtureTasks(l1)) {
    const e = enumerateCompositions({ input: t.input, output: t.output, cards, layer: 'temporal', maxDepth: 1 });
    assert.ok(e.candidates.some(s => s.length === 1 && s[0] === t.card), `${t.card}: its own positive fixture`);
  }
  const wb = (await wbedTasks({ seeds: [373] }));
  for (const t of wb) {
    const e = enumerateCompositions({ input: t.input, output: t.output, cards, layer: 'temporal' });
    const has = seq => e.candidates.some(s => s.join('>') === seq.join('>'));
    assert.ok(has(SCRIPTED_PLANS[t.rung]), `${t.rung}: the scripted plan ${SCRIPTED_PLANS[t.rung]}`);
    for (const core of WBED_CORE[t.rung]) assert.ok(e.candidates.some(s => containsInOrder(s, core)), `${t.rung}: core ${core}`);
    assert.equal(listSites(t.input), 0, `${t.rung}: the TaskSpec names no list input`);
    assert.equal(listSites(t.inputCode), 0, `${t.rung}: nor do the inputs themselves`);
    assert.deepEqual(e.candidates.filter(s => s.length === 1).map(s => s[0]), ['P01', 'P54'], 'one card: only the slot-typed cards that accept any value');
  }
  assert.equal(goldContains(['P01', 'P03', 'P16', 'P12'], ['P03', 'P16']), true);
  assert.equal(goldContains(['P16', 'P03'], ['P03', 'P16']), false);
});

test('M4 decision rule: > 100 on MORE than half the tasks, or coverage below 80%, kills; the diagnostic code order', () => {
  const rows = (over, n, covered) => Array.from({ length: n }, (_, i) => ({ total: i < over ? 101 : 100, covered: i < covered }));
  assert.equal(decide(rows(2, 4, 4)).kill, false, 'exactly half over is not more than half');
  assert.equal(decide(rows(3, 4, 4)).kill, true);
  assert.equal(decide(rows(0, 10, 8)).kill, false, 'coverage exactly 80% passes');
  assert.equal(decide(rows(0, 10, 7)).kill, true);
  assert.deepEqual(codeOrder([['P12', 'P01'], ['P54'], ['P01']], ['P01', 'P12']).map(s => s.join('>')), ['P01', 'P54', 'P12>P01'], 'shorter first, then ranked cards first');
});

test('M4 result: out/M4-enumeration.json reproduces from the code and cards it names', async t => {
  const url = new URL('../../../research/jit-20261008/design/library/out/M4-enumeration.json', import.meta.url);
  if (!existsSync(url)) return t.skip('no committed result yet (run tools/m4-coverage.mjs)');
  const saved = JSON.parse(readFileSync(url, 'utf8'));
  if (JSON.stringify(saved.cardDigests) !== JSON.stringify(cardDigests())) return t.skip('a card changed since the M4 run: regenerate with tools/m4-coverage.mjs');
  const r = await measureM4();
  assert.deepEqual(r.files, saved.files, 'enumerate.mjs, m4.mjs and the gold are the files the result names');
  assert.deepEqual(r.decision, saved.decision);
  assert.deepEqual(r.rows.map(x => [x.id, x.total, x.covered]), saved.rows.map(x => [x.id, x.total, x.covered]));
});
