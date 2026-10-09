// T4 (LIBRARY-TESTS §2; BUILD-ORDER step 3): the 12 first-slice cards are executable modules. Each card has a card.json,
// a skeleton and three fixtures (positive, no-match, drift); every fixture runs its assembled solve.mjs against the real
// flow-v3 SDK, gateway and call host (stub mode), with judges answered by the override hook: zero live model calls, $0
// spent, and every drift fixture deopts with the expected kind. $0; fixtures run one at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCard, loadL1, expandedCard } from '../cards.mjs';
import { checkSlots, assemble, resolveRefs, lintFn } from '../assemble.mjs';
import { runFixture, runParts } from '../run.mjs';
import { countTokens, CAP_TABLE } from '../context.mjs';

const FIRST_SLICE = ['P01', 'P03', 'P07', 'P08', 'P09', 'P12', 'P13', 'P15', 'P16', 'P17', 'P20', 'P54'];
const cards = FIRST_SLICE.map(id => loadCard(id));
const DUMMY = 'sha256:' + 'ab'.repeat(32);
const dummyRefs = v => resolveRefs(v, new Proxy({}, { get: () => DUMMY, has: () => true }));

test('T4: the 12 first-slice cards exist, each with a skeleton and the three fixture kinds', () => {
  const l1 = loadL1();
  assert.equal(l1.length, 54);
  assert.deepEqual(l1.filter(e => e.executable).map(e => e.id).sort(), FIRST_SLICE);
  let n = 0;
  for (const c of cards) {
    assert.ok(c, 'card loads');
    assert.match(c.skeleton, new RegExp(`export default async function ${c.id}\\(flow, task, x, S\\)`), `${c.id} skeleton signature`);
    assert.deepEqual(c.fixtures.map(f => f.name).sort(), ['drift', 'no-match', 'positive'], `${c.id} fixtures`);
    assert.equal(c.fixtures.find(f => f.name === 'drift').expect.status, 'deopt', `${c.id}: drift must deopt`);
    assert.ok(c.when.some(j => j.id === 'J1' && j.type === 'noul'), `${c.id}: J1 is a noul question`);
    assert.ok(c.checklist.length >= 3 && c.slots.length >= 2, `${c.id}: checklist and slots`);
    n += c.fixtures.length;
  }
  assert.ok(n >= 36, `${n} fixtures`);
});

test('T4: every card\'s worked example passes its own slot checks and assembles; fn slots lint clean', () => {
  for (const c of cards) {
    const slots = dummyRefs(c.example.slots);
    assert.deepEqual(checkSlots(c, slots), [], `${c.id} example slots`);
    for (const d of c.slots.filter(d => d.type === 'fn' && typeof slots[d.name] === 'string')) assert.equal(lintFn(slots[d.name]), null, `${c.id}.${d.name}`);
    const { source, findings } = assemble({ parts: [{ card: c, slots }] });
    assert.deepEqual(findings, []);
    assert.ok(source.includes(`async function ${c.id}_0(`) && source.includes('flow.done('));
  }
});

test('T4: each expanded card fits the S6 one-card allocation (LIBRARY §5.2: ≤ 1,200 tokens, calibrated counter)', () => {
  for (const c of cards) {
    const t = countTokens(expandedCard(c));
    assert.ok(t <= CAP_TABLE.S6.parts.expanded, `${c.id}: ${t} tokens`);
  }
});

for (const c of cards) {
  test(`T4: ${c.id} fixtures (positive, no-match, drift) at $0`, async () => {
    for (const fx of c.fixtures) {
      const r = await runFixture(c, fx);
      assert.ok(r.pass, `${c.id}/${fx.name}: ${r.problems.join(' | ')}`);
      assert.equal(r.result.liveModelCalls, 0); assert.equal(r.result.spentUsd, 0);
      if (fx.name === 'drift') assert.equal(r.result.status, 'deopt');
    }
  });
}

test('T4: a judge with no stub answer deopts instead of reaching a model (the $0 runner never spends)', async () => {
  const c = cards.find(x => x.id === 'P07'), fx = c.fixtures.find(f => f.name === 'positive');
  const r = await runFixture(c, { ...fx, answers: {} });
  assert.equal(r.result.status, 'deopt'); assert.equal(r.result.liveModelCalls, 0); assert.equal(r.result.spentUsd, 0);
  assert.ok(!r.pass);
});

test('T4: fragments assemble in order into one solver (P08 then P12), and P08 alone runs through runParts', async () => {
  const p08 = cards.find(x => x.id === 'P08'), p12 = cards.find(x => x.id === 'P12');
  const fx08 = p08.fixtures.find(f => f.name === 'positive');
  const r = await runParts({ parts: [{ card: p08, slots: { ...p08.example.slots, ...(fx08.slots ?? {}) } }], task: fx08.task, answers: fx08.answers });
  assert.equal(r.status, 'ok');
  // Assembling two fragments: the generated main threads x through both in order.
  const { source } = assemble({ parts: [{ card: p08, slots: p08.example.slots }, { card: p12, slots: p12.example.slots }] });
  assert.ok(source.indexOf('P08_0(flow, task, x') < source.indexOf('P12_1(flow, task, x'));
});
