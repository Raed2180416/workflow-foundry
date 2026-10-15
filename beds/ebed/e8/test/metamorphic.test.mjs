// E8 metamorphic suite (E-BED §9.3, MR1-MR13; BED-CONTRACT v1.1 §9) on the oracle (reference transition + grader) and
// on the reference policy. $0, no model calls; development evidence on E-bed dev seeds (1024-1133, block 1001-1199).
// The relations and their E8 status are in ../metamorphic.mjs (MRS). Heavy: run this file alone, one process.
//   node --test --test-concurrency=1 beds/ebed/e8/test/metamorphic.test.mjs
// Relation variants that fail on the unmutated oracle are todo tests carrying the finding (MRS[].known): they run and
// report, and do not fail the suite. The counterparties' own couplings and the W5 twin are diagnostics (todo as well).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MRS, fixture, oracleCheck, referenceCheck, mr11OracleCheck, mr10Sets, startOrder, compensationCheck, caseLabel, specKey,
  renaming, weekShift, amountScale, transformWorld, mapDeep, worldOf, INJECTION, INJECTIONS, twinDiagnostic, actorCoupling,
} from '../metamorphic.mjs';
import { oracleItem } from '../index.mjs';
import { canonical } from '../../../lib/canonical.mjs';

const cache = new Map();
const show = v => JSON.stringify(v ?? null).slice(0, 1500);
const MR = id => MRS.find(m => m.id === id);

test('MR1-MR13 each have an E8 status, a relation and dev worlds', () => {
  assert.deepEqual(MRS.map(m => m.id), Array.from({ length: 13 }, (_, i) => `MR${i + 1}`));
  for (const m of MRS) {
    assert.ok(['implemented', 'degenerate', 'analog', 'emulated'].includes(m.status), m.id);
    assert.ok(m.relation && m.cases.length && m.mutCases.length, m.id);
    for (const c of [...m.cases, ...m.mutCases, ...(m.known ?? [])]) assert.ok(c.spec.seed >= 1001 && c.spec.seed <= 1199, `${m.id}: seed outside the dev block`);
  }
});

test('the transformations are bijective and change what they claim', () => {
  for (const spec of [{ seed: 1122, difficulty: 3, size: 12 }, { seed: 1123, difficulty: 4, size: 14 }]) {
    const W = worldOf(spec);
    for (const tf of [renaming(), weekShift(1), weekShift(-1), weekShift(52), amountScale(10)]) {
      const Wt = transformWorld(W, tf);
      assert.notEqual(canonical(Wt), canonical(W), `${tf.id} changed nothing`);
      const back = mapDeep(Wt, tf.inv);
      if (tf.fwd.num) for (const ed of back.rulebook.editions) ed.files['shipping-fees.json'] = JSON.stringify(mapDeep(JSON.parse(ed.files['shipping-fees.json']), tf.inv), null, 1);
      assert.equal(canonical(back), canonical(W), `${tf.id} is not inverted by its inverse`);
    }
    const renamed = JSON.stringify(transformWorld(W, renaming()));
    for (const re of [/ORD-/i, /SKU-/, /\bWH-/, /PARCELLA|VELOX|SWIFTLINE/, /\bC-\d{4}/, /hollin-shop/]) assert.ok(!re.test(renamed), `${re} survives the renaming`);
  }
});

/** Each relation's own evidence that the follow-up exercised what it claims (no vacuous pass). */
const evidence = {
  MR4: fx => {
    assert.ok(fx.meta.permuted.length >= 1, 'no (instant, source) group with two cases');
    for (const g of fx.meta.permuted) {
      const a = startOrder(fx.src['ref-earliest'], fx.W, g), b = startOrder(fx.dst['ref-earliest'], fx.Wt, g);
      assert.deepEqual(b, [...a].reverse(), `group ${g.at} ${g.source}: instances not opened in reverse case order`);
    }
  },
  MR5: fx => assert.ok(fx.meta.copies > 0, 'nothing duplicated'),
  MR6: fx => {
    const extra = fx.dst['ref-earliest'].filter(r => r.type === 'deliver' && r.event?.type === 'timer.fired' && r.event.payload?.obligationId === 'mr6-split').length;
    assert.ok(extra > 0, 'no extra wake-up fired');
  },
  MR7: fx => assert.equal(fx.meta.added.length, 2),
  MR9: fx => assert.ok(Date.parse(fx.meta.published) < Date.parse(fx.W.horizonEnd), 'the late edition is never published'),
  MR12: fx => assert.ok(fx.Wt.arrivals.some(a => a.doc?.includes(INJECTION)), 'no document carries the injection'),
  MR13: fx => {
    assert.equal(fx.meta.stats.misses, 0, 'a call was not served from the world-level pass');
    assert.ok(fx.meta.stats.decided > fx.meta.stats.passes, 'no round decided two instances in one pass');
  },
};

for (const mr of MRS) {
  test(`${mr.id} ${mr.title} [${mr.status}]: ${mr.relation}`, async () => {
    const grown = [];
    for (const c of mr.cases) {
      const fx = await fixture(mr, c, { cache });
      const o = mr.kind === 'mr11' ? mr11OracleCheck(fx) : oracleCheck(fx);
      assert.deepEqual(o, [], `${caseLabel(mr, c)} oracle flavour: ${o.length} violations, first ${show(o[0])}`);
      const r = await referenceCheck(fx);
      assert.deepEqual(r, [], `${caseLabel(mr, c)} reference flavour: ${r.length} violations, first ${show(r[0])}`);
      evidence[mr.id]?.(fx);
      if (mr.id === 'MR10') { const s = mr10Sets(fx); grown.push(s.followUp.length - s.source.length); }
    }
    if (mr.id === 'MR10') assert.ok(grown.some(n => n > 0), `tightening never ended another order timedOut (${grown})`);
  });
  for (const k of mr.known ?? []) {
    test(`${mr.id} ${k.variant} on ${specKey(k.spec)}: fails on the unmutated oracle (known)`, { todo: k.finding }, async () => {
      const fx = await fixture(mr, k, { cache });
      const o = oracleCheck(fx), r = await referenceCheck(fx);
      assert.deepEqual([...o, ...r], [], `${o.length} oracle and ${r.length} reference violations, first ${show(o[0] ?? r[0])}`);
    });
  }
}

test('MR11 covers every injection kind and checks compensated fulfilments of both reference runs', async () => {
  const mr = MR('MR11');
  const kinds = new Set();
  let compensated = 0;
  for (const c of mr.cases) {
    const fx = await fixture(mr, c, { cache });
    for (const i of fx.meta.injected) kinds.add(i.kind);
    for (const arm of mr.arms) compensated += compensationCheck(oracleItem, fx.Wt, fx.dst[arm]).compensated;
  }
  assert.deepEqual([...kinds].sort(), [...INJECTIONS].sort());
  assert.ok(compensated >= 20, `only ${compensated} compensated fulfilments checked`);
});

// The relations can fail: each detects, at the arm level, the defect its transformation targets (the controls are
// the reference minus one construct, controls.mjs).
test('the relations detect their target defects in controls (MR11 compensation, MR9 edition by publication, MR5 no dedupe)', async () => {
  const mr11 = MR('MR11');
  const fx11 = await fixture(mr11, mr11.cases[0], { cache, arms: ['no-compensation', 'forward-order-compensation'] });
  const whats = arm => new Set(compensationCheck(oracleItem, fx11.Wt, fx11.dst[arm], { expectation: false }).violations.map(v => v.what));
  assert.ok(whats('no-compensation').has('compensation set'), 'MR11 misses a control that never compensates');
  assert.ok(whats('forward-order-compensation').has('compensation order'), 'MR11 misses a control that compensates in forward order');
  const mr9 = MR('MR9');
  const fx9 = await fixture(mr9, { spec: { seed: 1123, difficulty: 4, size: 14 } }, { cache, arms: ['edition-by-publication'] });
  assert.ok(oracleCheck(fx9).length > 0, 'MR9 misses an arm that applies an edition from its publication');
  const mr5 = MR('MR5');
  const fx5 = await fixture(mr5, { spec: { seed: 1122, difficulty: 3, size: 12 }, variant: 'delayed' }, { cache, arms: ['no-dedupe'] });
  assert.ok(oracleCheck(fx5).length > 0, 'MR5 misses an arm that records a duplicate placement again');
});

// Diagnostics: the world's own couplings that the relations work around (reported, not oracle findings).
test('W5 twins(): the injection twin differs from its world only in the documents', { todo: 'world.mjs:335: a line comment swallows `item, seed, split, difficulty, schedule, mix, scale, track` of the world object (since d0237bf), so twins(world) throws "seed must be an integer"; and the twin has its own world.id, which keys the actors\' and the noise draws, so even a working twin changes more than the documents. MR12 uses injectDocs (world identity kept) instead' }, async () => {
  const d = await twinDiagnostic({ seed: 1122, difficulty: 3, size: 12 });
  assert.equal(d.sameWorldOtherwise, true);
  assert.equal(d.ledger, null, show(d.ledger));
});

test('the counterparties are invariant under renaming and week shifts without adaptActors', { todo: 'actors.mjs keys the carriers\' random draws by fulfilment id, looks codes up in world.mjs\'s constant CARRIER_CODES by carrier name, and places reports with world.mjs\'s iso()/collectionRuns(), anchored to the constant T0 rather than world.t0. Only worlds that generateWorld makes are consistent; the relations carry the source world\'s counterparties through T (adaptActors)' }, async () => {
  const r = await actorCoupling({ seed: 1121, difficulty: 2, size: 12 });
  assert.equal(r.rename.casesDiffering, 0, show(r.rename.first));
  assert.equal(r['shift+1w'].casesDiffering, 0, show(r['shift+1w'].first));
});
