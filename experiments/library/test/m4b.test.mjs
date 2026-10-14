// M4b (ATTACK-20261014 §3 M4; PROOF-LEDGER K6): the precise type model of the catch-all cards (card-types.mjs), its
// citations, its soundness on the cards' own fixtures, the reachability walk against M4's, hand-derived counts, and the
// committed result. $0: no model, Jev or network call; beds through generate() and outputSchema only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { loadL1 } from '../cards.mjs';
import { validates } from '../skeletons/helpers.mjs';
import { interfaces, enumerateCompositions, listSites, schemaOfValue, closeTop, SLOT_TYPED } from '../enumerate.mjs';
import { fixtureTasks, wbedTasks } from '../m4.mjs';
import { PRECISE, CATCH_ALLS, NON_NULL, param, union, isParam, preciseInterfaces, enumeratePrecise, arraySites, readersMet, outCompatible, citationProblems } from '../card-types.mjs';
import { measureM4b, interfaceDigests } from '../m4b.mjs';

const l1 = loadL1(), cards = preciseInterfaces(l1), m4shape = preciseInterfaces(l1, { m4: true }), m4cards = interfaces(l1);
const card = id => l1.find(e => e.id === id);
const positive = id => card(id).fixtures.find(f => f.name === 'positive');
const R1 = { type: 'object', required: ['customers', 'totals'], properties: { customers: { type: 'array' }, totals: { type: 'object' } } };

test('M4b citations: every claim\'s snippet is on its cited line; P01 and P20 never read task', () => {
  assert.deepEqual(citationProblems(), []);
  assert.deepEqual(Object.keys(PRECISE), [...CATCH_ALLS]);
  for (const [id, p] of Object.entries(PRECISE)) {
    assert.ok(p.claims.length >= 4, `${id}: at least four cited claims`);
    assert.equal(p.preserving, false, `${id}: no catch-all is type-preserving`);
    for (const c of p.claims) assert.ok(Number.isInteger(c.line) && c.has.length >= 8 && c.claim.length > 20, `${id}: ${c.file}:${c.line}`);
  }
  // A moved line is caught: the same check against a wrong line number fails.
  const moved = { ...PRECISE.P01.claims[4], line: PRECISE.P01.claims[4].line + 1 };
  const src = readFileSync(new URL(`../../../${moved.file}`, import.meta.url), 'utf8').split('\n');
  assert.equal(src[moved.line - 1].includes(moved.has), false);
});

test('M4b soundness: each catch-all\'s own positive fixture fits its precise interface, and none is type-preserving', () => {
  // P01: the output satisfies the last stage's declared out schema (skeleton line 13), not the input's shape.
  const p01 = positive('P01'), stages = card('P01').example.slots.STAGES;
  assert.equal(validates(stages.at(-1).out, p01.expect.output), true);
  // P20: the output is the first closed shape, and result satisfies GEN.schema.
  const p20 = positive('P20');
  assert.equal(validates(PRECISE.P20.out.$union[0].properties.tries, p20.expect.output.tries), true);
  assert.deepEqual(Object.keys(p20.expect.output).sort(), ['result', 'tries']);
  assert.equal(validates(card('P20').example.slots.GEN.schema, p20.expect.output.result), true);
  // P12: ITEMS resolves to a list of non-null items in the fixture's inputs.
  const items = card('P12').example.slots.ITEMS.split('.').slice(1).reduce((v, k) => v[k], positive('P12').task.inputs);
  assert.ok(Array.isArray(items) && items.every(it => it != null));
  // Not type-preserving: in every catch-all's own fixture the output's shape differs from the input's.
  for (const id of CATCH_ALLS) {
    const fx = positive(id), i = schemaOfValue(fx.task.inputs), o = schemaOfValue(fx.expect.output);
    assert.notDeepEqual(o, i, `${id}: output shape = input shape`);
  }
  // Under the type-preserving counterfactual, P01 and P54 cannot produce their own fixture output (the reason it is a counterfactual).
  for (const id of ['P01', 'P54']) {
    const t = fixtureTasks(l1).find(x => x.card === id);
    const e = enumeratePrecise({ input: t.input, output: t.output, cards, preserve: ['P01', 'P54'], maxDepth: 1 });
    assert.equal(e.candidates.some(s => s[0] === id), false, `${id} preserved still covers its own fixture`);
  }
});

test('M4b types: array sites agree with listSites; params and unions read as specified', () => {
  const schemas = [...m4cards.map(c => c.out).filter(o => o !== SLOT_TYPED), ...m4cards.map(c => c.outDeclared).filter(o => o !== SLOT_TYPED),
    ...fixtureTasks(l1).flatMap(t => [t.input, t.output]), R1, {}, { type: 'array' }, { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
    { type: 'object', additionalProperties: { type: 'string' } }, { type: 'object', properties: { a: { type: 'array', items: { type: 'array' } } }, additionalProperties: false }];
  for (const s of schemas) { const a = arraySites(s); assert.equal(a.open || a.more.length ? Infinity : a.items.length, listSites(s), JSON.stringify(s).slice(0, 120)); }
  const D = param('d', 'declared'), Uc = param('u', 'unchecked');
  assert.equal(arraySites(D).open, true); assert.equal(arraySites(Uc).open, true);
  assert.equal(arraySites(D, { mode: 'checked' }).open, true, 'a declared param is checked by its skeleton');
  assert.deepEqual(arraySites(Uc, { mode: 'checked' }), { items: [], more: [], open: false }, 'an unchecked param supplies nothing to rely on');
  const reader = [{ slot: 'ITEMS', kind: 'path', items: NON_NULL }];
  assert.equal(readersMet(reader, [{ type: 'object', properties: { a: { type: 'array', items: { type: 'null' } } }, additionalProperties: false }]), false, 'null items fail P12\'s requirement');
  const one = { type: 'object', properties: { a: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false } } }, additionalProperties: false };
  assert.equal(readersMet(reader, [one]), true);
  assert.equal(readersMet([...reader, ...reader], [one]), false, 'two readers need two locations');
  assert.equal(readersMet([...reader, ...reader], [one, one]), true, 'one in the inputs, one in x');
  assert.equal(readersMet(reader, [{ type: 'object', properties: { a: { type: 'array', items: { type: 'object' } } }, additionalProperties: false }]), true, 'an open item may hold anything');
  const u = union([{ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }, { type: 'object', properties: { b: { type: 'array', items: {} } }, additionalProperties: false }]);
  assert.equal(readersMet(reader, [u]), true, 'a union is read branch by branch (existential)');
  assert.equal(outCompatible(u, R1), false); assert.equal(outCompatible(Uc, R1), true); assert.equal(outCompatible(PRECISE.P20.out, R1), false);
  assert.ok(isParam(PRECISE.P01.out) && PRECISE.P01.out.check === 'declared' && PRECISE.P54.out.check === 'unchecked' && PRECISE.P12.out.check === 'unchecked');
});

test('M4b walk: with M4\'s interfaces it returns exactly enumerate.mjs\'s candidates (18 problems at depth 3; the rule\'s layer at depth 4 on 7)', async () => {
  const tasks = [...fixtureTasks(l1), ...await wbedTasks({ seeds: [373] })];
  const same = (t, layer, maxDepth) => {
    const a = enumerateCompositions({ input: t.input, output: t.output, cards: m4cards, layer, maxDepth });
    const b = enumeratePrecise({ input: t.input, output: t.output, cards: m4shape, temporal: layer === 'temporal', maxDepth });
    assert.deepEqual(b.candidates, a.candidates, `${t.id} ${layer} depth ${maxDepth}`);
  };
  for (const t of tasks) { same(t, 'typed', 3); same(t, 'temporal', 3); }
  for (const t of tasks.filter(x => ['P01', 'P12', 'P17', 'P54'].includes(x.card) || x.set === 'wbed')) same(t, 'temporal', 4);
});

test('M4b counts: hand-derived W-bed numbers; P12\'s item requirement changes nothing; the four catch-alls alone exceed 100', async () => {
  const [t] = await wbedTasks({ seeds: [373] });
  const run = o => enumeratePrecise({ input: t.input, output: t.output, cards, ...o });
  // Types only: first in {P01, P20, P54}, last in {P01, P12, P54}, 15 x 15 between: 2 + 9 + 3*15*3 + 3*15*15*3.
  assert.deepEqual(run({ temporal: false }).byDepth, [2, 9, 135, 2025]);
  assert.equal(run().total, 2000, 'the M4 number: the precise model changes no W-bed count');
  // Catch-alls alone (existential): 2 + 3*3 + 3*4*3 + 3*4*4*3 = 191, whatever the other eleven cards' types.
  assert.deepEqual(run({ alphabet: CATCH_ALLS }).byDepth, [2, 9, 36, 144]);
  // Checked reading: P12 cannot follow an unchecked output (P12, P54) when the inputs hold no list: 2 + 8 + 28 + 100 = 138.
  assert.deepEqual(run({ alphabet: CATCH_ALLS, mode: 'checked' }).byDepth, [2, 8, 28, 100]);
  const noReq = cards.map(c => (c.id === 'P12' ? { ...c, readers: c.readers.map(r => ({ slot: r.slot, kind: r.kind })) } : c));
  for (const x of [t, ...fixtureTasks(l1).slice(0, 4)]) {
    assert.equal(enumeratePrecise({ input: x.input, output: x.output, cards: noReq, keep: false }).total, enumeratePrecise({ input: x.input, output: x.output, cards, keep: false }).total, x.id);
  }
});

test('M4b result: out/M4b-enumeration.json reproduces from the code and cards it names; a changed card fails, never skips', async t => {
  const url = new URL('../../../research/jit-20261008/design/library/out/M4b-enumeration.json', import.meta.url);
  if (!existsSync(url)) return t.skip('no committed result yet (run tools/m4b-coverage.mjs)');
  const saved = JSON.parse(readFileSync(url, 'utf8'));
  assert.deepEqual(saved.interfaceDigests, interfaceDigests(l1), 'a card interface changed since the M4b run: regenerate with tools/m4b-coverage.mjs');
  const r = await measureM4b();
  assert.deepEqual(r.files, saved.files);
  assert.deepEqual(r.decision, saved.decision);
  const key = x => [x.id, x.total, x.covered, x.m4.total, x.bounds.polymorphicOnly.total, x.bounds.strictOthers.total, ...Object.values(x.diagnostics).map(d => d.total)];
  assert.deepEqual(r.rows.map(key), saved.rows.map(key));
  assert.equal(r.decision.all.kill, true);
  assert.equal(r.boundDecisions.polymorphicOnly.tasksOver100, 33, 'no typing of the other eleven cards can pass the count clause');
  assert.ok(closeTop(card('P20').fragment.out).additionalProperties === false);
});
