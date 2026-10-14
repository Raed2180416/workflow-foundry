// Oracle health for W-bed R4 "group consolidation" (beds/CONTRACT.md rules; W-BED §2.2, §3.4, §5, §6). Loaded by path;
// the registration shim beds/wbed-r4/index.mjs makes it loadable as family 'wbed-r4'. No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as bed from './index.mjs';
import * as R1 from '../r1/index.mjs';
import * as R3 from '../r3/index.mjs';
import { buildGroup } from './world.mjs';
import { amountOnlyPairs, memoOnlyPairs } from './pipeline.mjs';
import { pairKey } from './score.mjs';
import { PLANTABLE_SYSTEMS, childOracle } from './children.mjs';
import { canonical, sha256, estimateTokens } from '../lib/prng.mjs';
import { fmtJulian, parseJulian, BASE_STYLE } from '../lib/dialects.mjs';
import { DATE_STYLES, dayNum } from '../lib/domain.mjs';
import { inlineRender, loadFamily } from '../../../experiments/lib/beds.mjs';
import { portableSchemaViolations } from '../../../src/schema-subset.mjs';
import { learnProfile, checkProfile } from '../../../experiments/jit/profile.mjs';
import { plan, runStub } from '../attacks/triviality.mjs';

const SEEDS = Array.from({ length: 20 }, (_, i) => 301 + i); // dev 301-320 (wbed-dev)
const DS = [2, 3, 4, 5];
const applies = (c, d) => d >= (c.minDifficulty ?? 0);
const hashOf = t => sha256(canonical(t));
const gen = (seed, d, split = 'dev') => bed.generate({ seed, split, difficulty: d });
const root = fileURLToPath(new URL('../../../', import.meta.url));
const r4 = (...a) => console.log('[r4]', ...a);

test('exports the bed interface plus the W-specific and R4-specific exports', async () => {
  for (const k of ['family', 'outputSchema', 'generate', 'oracle', 'referenceSolve', 'badControls', 'version', 'difficulty', 'stages', 'structure',
    'relations', 'composedOracle', 'referenceTrace', 'childrenOf', 'childTask', 'scoreReuse', 'invariants']) assert.ok(k in bed, k);
  assert.equal(bed.family.id, 'wbed-r4');
  assert.equal(bed.family.version, '1.0.1');
  assert.equal(bed.version, '1.0.1');
  assert.equal(bed.family.kind, 'oneshot');
  assert.deepEqual(bed.stages.map(s => s.id), ['children', 'translate', 'pair', 'eliminate', 'report']);
  for (const s of bed.stages) for (const k of ['inputSchema', 'outputSchema', 'oracle', 'project']) assert.ok(s[k], `${s.id}.${k}`);
  assert.equal(bed.structure.shape, 'nested-sub-workflow');
  const o = bed.structure.outline.join('\n');
  assert.match(o, /map\(subsidiaries, s => flow\.call\(.*R1_REF_HASH : R3_REF_HASH/);
  for (const re of [/step translate/, /judge intercompany/, /step eliminate/, /invariant conservation/]) assert.match(o, re);
  assert.equal((await loadFamily('wbed-r4')).family.id, 'wbed-r4');
});

test('output schema and stage contracts are in the portable subset', () => {
  assert.deepEqual(portableSchemaViolations(bed.outputSchema), []);
  for (const s of bed.stages) { assert.deepEqual(portableSchemaViolations(s.inputSchema), [], s.id); assert.deepEqual(portableSchemaViolations(s.outputSchema), [], s.id); }
});

test('generator is deterministic: same seed -> same task hash, also in a fresh process', () => {
  for (const d of DS) for (const seed of [301, 350]) {
    const a = gen(seed, d), b = gen(seed, d);
    assert.equal(hashOf(a), hashOf(b));
    assert.notEqual(a.inputs, b.inputs, 'each call returns a fresh object');
  }
  const here = fileURLToPath(new URL('./index.mjs', import.meta.url));
  const code = `const m = await import(${JSON.stringify(here)}); const { canonical, sha256 } = await import(${JSON.stringify(fileURLToPath(new URL('../lib/prng.mjs', import.meta.url)))});`
    + `console.log(JSON.stringify([[301,3],[302,5],[303,2]].map(([s,d]) => sha256(canonical(m.generate({ seed: s, split: 'dev', difficulty: d }))))));`;
  const fresh = JSON.parse(execFileSync(process.execPath, ['--max-old-space-size=1024', '--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.deepEqual(fresh, [[301, 3], [302, 5], [303, 2]].map(([s, d]) => hashOf(gen(s, d))));
  assert.notEqual(hashOf(gen(301, 3)), hashOf(gen(301, 3, 'test')));
  assert.notEqual(hashOf(gen(301, 3)), hashOf(gen(302, 3)));
});

for (const d of DS) {
  test(`d${d}: referenceSolve passes and every bad control fails on ${SEEDS.length} seeds`, () => {
    const controls = bed.badControls.filter(c => applies(c, d));
    assert.ok(controls.length >= 12, `${controls.length} controls at d${d}`);
    let retries = 0;
    for (const seed of SEEDS) {
      const task = gen(seed, d);
      retries += buildGroup(seed, 'dev', d).attempt;
      const ref = bed.oracle(task, bed.referenceSolve(task));
      assert.ok(ref.pass, `reference fails seed ${seed}: ${JSON.stringify(ref.details).slice(0, 300)}`);
      assert.equal(ref.score, 1);
      for (const c of controls) {
        const r = bed.oracle(task, c.make(task));
        assert.equal(r.pass, false, `control ${c.name} passes seed ${seed} d${d}`);
        assert.ok(r.score < 1);
      }
    }
    r4(`d${d}: ${controls.length} controls, group-layer re-draws over ${SEEDS.length} seeds: ${retries}`);
  });
}

test('controls: CONTRACT minimums, the brief\'s categories, >= 2 relation controls at every difficulty', () => {
  const names = bed.badControls.map(c => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of ['empty', 'shuffled-or-corrupted', 'fx-direction-inverted', 'rate-date-group-close', 'amount-only-pairing', 'elimination-not-applied',
    'double-elimination', 'child-error-propagated', 'translate-per-item', 'jpy-minor-digits', 'all-ic-removed', 'outside-profile-reused']) assert.ok(names.includes(n), n);
  for (const d of DS) assert.ok(bed.badControls.filter(c => c.kind === 'relation' && applies(c, d)).length >= 2, `d${d}`);
});

test('relation controls pass every child and parent stage oracle and the report\'s local checks but fail a cross-stage relation', () => {
  const rel = bed.badControls.filter(c => c.kind === 'relation');
  for (const d of DS) for (const seed of SEEDS.slice(0, 3)) {
    const task = gen(seed, d);
    for (const c of rel.filter(x => applies(x, d))) {
      const tr = c.trace(task);
      const co = bed.composedOracle(task, tr);
      for (const [id, r] of Object.entries(co.children)) assert.ok(r.pass, `${c.name} d${d} s${seed}: child ${id} fails`);
      for (const [id, r] of Object.entries(co.stages)) assert.ok(r.pass, `${c.name} d${d} s${seed}: stage ${id} fails ${JSON.stringify(r.details).slice(0, 200)}`);
      assert.ok(bed.reportLocal(buildGroup(seed, 'dev', d), tr.report).pass);
      assert.ok(Object.values(co.relations).some(r => !r.pass), `${c.name} d${d} s${seed}: no relation fails`);
      assert.equal(co.pass, false);
      assert.equal(bed.oracle(task, tr.report).pass, false);
    }
  }
});

test('composed oracle (child composed oracles AND parent stage oracles AND relations) agrees with the end-to-end oracle on every trace', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 2)) {
    const task = gen(seed, d);
    const ref = bed.composedOracle(task, bed.referenceTrace(task));
    assert.ok(ref.pass, JSON.stringify(ref).slice(0, 600));
    for (const c of bed.badControls.filter(x => x.trace && applies(x, d))) {
      const tr = c.trace(task);
      const co = bed.composedOracle(task, tr);
      assert.equal(co.pass, bed.oracle(task, tr.report).pass, `${c.name} d${d} s${seed}`);
      assert.equal(co.pass, false, c.name);
      if (c.kind === 'stage') assert.ok([...Object.values(co.children), ...Object.values(co.stages)].some(r => !r.pass), `${c.name}: some child or stage oracle must see a stage mistake`);
    }
  }
});

test('stage hand-offs of the reference trace satisfy their typed contracts; stage oracles pass on the truth and reject an empty hand-off', () => {
  for (const d of DS) {
    const task = gen(311, d);
    const tr = bed.referenceTrace(task);
    assert.deepEqual(bed.CONTRACTS.input.check(task.inputs), []);
    const hand = { ...tr, children: { children: tr.children.map(c => ({ sub_id: c.sub_id, output: c.output })) } };
    for (const s of ['children', 'translate', 'pair', 'eliminate', 'report']) assert.deepEqual(bed.CONTRACTS[s].check(hand[s]), [], `${s} d${d}`);
    for (const s of bed.stages) {
      const st = s.project(task);
      assert.ok(s.oracle(st, hand[s.id]).pass, `${s.id} d${d}`);
      assert.equal(s.oracle(st, {}).pass, false, `${s.id} rejects an empty hand-off`);
    }
    // Each child trace is its own rung's: R1 traces have R1's stages, R3 traces R3's.
    for (const c of tr.children) assert.deepEqual(Object.keys(c.trace).sort(), (c.family === 'wbed-r1' ? ['extract', 'normalise', 'reconcile', 'report'] : ['classify', 'match', 'reduce', 'split']));
  }
});

test('oracle rejects schema-invalid and hostile outputs; order free; one minor unit or one child error fails', () => {
  const task = gen(305, 4);
  const ref = bed.referenceSolve(task);
  const bad = [null, 42, 'x', {}, { ...ref, consolidated: undefined }, { ...ref, eliminations: 'none' },
    { ...ref, subsidiaries: ref.subsidiaries.map((s, i) => (i ? s : { ...s, ic_receivables_minor: String(s.ic_receivables_minor) })) },
    { ...ref, subsidiaries: [...ref.subsidiaries, ref.subsidiaries[0]] },
    { ...ref, group_currency: ref.group_currency === 'EUR' ? 'GBP' : 'EUR' },
    { ...ref, subsidiaries: ref.subsidiaries.slice(1) },
    new Proxy(ref, {})];
  for (const out of bad) assert.equal(bed.oracle(task, out).pass, false);
  const shuffled = structuredClone(ref);
  shuffled.subsidiaries.reverse(); shuffled.eliminations.reverse();
  for (const s of shuffled.subsidiaries) (s.report.customers ?? s.report.statements).reverse();
  assert.ok(bed.oracle(task, shuffled).pass);
  const unit = structuredClone(ref);
  unit.eliminations[0].amount_minor += 1; unit.consolidated.eliminated_minor += 1; unit.consolidated.receivables_minor -= 1; unit.consolidated.payables_minor -= 1;
  assert.equal(bed.oracle(task, unit).pass, false);
  const child = structuredClone(ref);
  const r1 = child.subsidiaries.find(s => s.pack === 'receivables-close');
  r1.report.customers[0].paid_usd_cents += 1; r1.report.customers[0].open_usd_cents -= 1; r1.report.totals.paid_usd_cents += 1; r1.report.totals.open_usd_cents -= 1;
  const v = bed.oracle(task, child);
  assert.equal(v.pass, false);
  assert.equal(v.details.childPass, ref.subsidiaries.length - 1);
});

test('children: each pack is its own rung\'s generate() at a derived child seed; planted packs differ only in one list and its note', () => {
  const counts = {};
  for (const d of DS) for (const seed of SEEDS.slice(0, 8)) {
    const task = gen(seed, d), kids = bed.childrenOf(task), L = bed.LEVELS[d];
    assert.equal(kids.length, L.K);
    assert.equal(kids.filter(k => k.family === 'wbed-r3').length, L.r3);
    assert.equal(kids.filter(k => k.outsideProfile).length, L.planted);
    kids.forEach((k, i) => {
      assert.equal(k.seed, bed.childSeedOf(seed, d, i));
      assert.equal(k.split, 'dev'); assert.equal(k.difficulty, Math.min(Math.max(d, 3), 4));
      const own = (k.family === 'wbed-r1' ? R1 : R3).generate({ seed: k.seed, split: k.split, difficulty: k.difficulty });
      const ct = bed.childTask(task, k.sub_id);
      assert.deepEqual(task.inputs.subsidiaries[k.sub_id], { pack: k.pack, prompt: own.prompt, inputs: ct.inputs });
      const R = k.family === 'wbed-r1' ? R1 : R3, refOut = R.referenceSolve(own);
      assert.ok(R.oracle(ct, refOut).pass, 'the rung oracle scores the pack');
      // R4 scores a pack with the rung's own scorer against the cached reference: the same verdict and score as R.oracle.
      for (const c of R.badControls.slice(0, 6)) {
        const x = c.make(own), a = R.oracle(ct, x), b = childOracle({ family: k.family, output: refOut }, x);
        assert.deepEqual([b.pass, b.score], [a.pass, a.score], `${k.family} ${c.name}`);
      }
      if (!k.outsideProfile) { assert.equal(hashOf(ct), hashOf(own)); return; }
      assert.equal(k.family, 'wbed-r1');
      assert.ok(PLANTABLE_SYSTEMS.includes(k.planted.system));
      counts[k.planted.system] = (counts[k.planted.system] ?? 0) + 1;
      const S = k.planted.system;
      const changed = Object.keys(own.inputs).filter(f => canonical(own.inputs[f]) !== canonical(ct.inputs[f]));
      assert.deepEqual(changed.sort(), ['invoices', 'ledger_notes']);
      assert.deepEqual(Object.keys(own.inputs.invoices).filter(s => own.inputs.invoices[s] !== ct.inputs.invoices[s]), [S]);
      assert.match(ct.inputs.ledger_notes, /CYYDDD Julian dates/);
      assert.ok(/(^|[;,| ])1\d{5}([;,| ]|$)/m.test(ct.inputs.invoices[S]), 'the list prints CYYDDD dates');
      // Misread by an R1 solver, the planted pack's report is wrong (the control below).
      assert.equal(R1.oracle(ct, bed.badControls.find(c => c.name === 'outside-profile-reused').trace(task).children.find(c => c.sub_id === k.sub_id).output).pass, false);
    });
  }
  r4('planted systems (d2-d5, seeds 301-308):', JSON.stringify(counts));
});

test('child seeds: injective, >= 1,000,000, outside every ledgered seed range (the open-ended clean test row excepted)', () => {
  const ledger = JSON.parse(readFileSync(new URL('../../../research/jit-20261008/SEED-LEDGER.json', import.meta.url), 'utf8'));
  const parents = [...Array.from({ length: 90 }, (_, i) => ['dev', 301 + i]), ...[8201, 8301, 8401, 8501].flatMap(a => Array.from({ length: 24 }, (_, i) => ['test', a + i]))];
  const seen = new Set();
  let n = 0;
  for (const [split, p] of parents) for (const d of DS) for (let k = 0; k < bed.CHILD_SLOTS; k++) {
    const s = bed.childSeedOf(p, d, k);
    assert.ok(s >= bed.CHILD_SEED_BASE);
    assert.ok(!seen.has(s), `collision at ${p} d${d} k${k}`); seen.add(s);
    for (const r of ledger.ranges) {
      if (r.split !== split) continue;
      const inside = s >= r.from && (r.to === null || s <= r.to);
      if (r.status === 'clean' && r.to === null) continue; // "test seeds >= 7200 are clean for every bed": not a reservation
      assert.ok(!inside, `child seed ${s} (parent ${split} ${p}) inside ${r.id}`);
    }
    n++;
  }
  const maxBounded = Math.max(...ledger.ranges.filter(r => r.to !== null).map(r => r.to));
  assert.ok(bed.CHILD_SEED_BASE > maxBounded);
  assert.throws(() => bed.childSeedOf(-1, 3, 0)); assert.throws(() => bed.childSeedOf(301, 3, 16));
  r4(`child seeds checked: ${n} (dev 301-390 and held-out 8201-8524 parents x d2-d5 x 16 slots); largest bounded ledger seed ${maxBounded}`);
});

test('the planted dialect is new: no R1/R3 date style prints CYYDDD, and it round-trips', () => {
  assert.ok(!Object.keys(DATE_STYLES).includes('JULIAN_CYYDDD'));
  assert.ok(!Object.values(BASE_STYLE).includes('JULIAN_CYYDDD'));
  for (let day = dayNum(2024, 1, 1); day <= dayNum(2025, 12, 31); day += 7) assert.equal(parseJulian(fmtJulian(day)), day);
  assert.equal(fmtJulian(dayNum(2025, 2, 1)), '125032');
  // R1 draws are unchanged by the R4 additions to lib (R1's own determinism test pins the hashes; spot-check one here).
  assert.equal(hashOf(R1.generate({ seed: 301, split: 'dev', difficulty: 3 })), hashOf(R1.generate({ seed: 301, split: 'dev', difficulty: 3 })));
});

test('composition test: an input profile learned on an R1-stream-shaped set refuses every planted pack (measured, slice-1 profile.mjs)', () => {
  // The R1 stream shape (W-BED §5): 16 tasks at d3 then 8 at d4 (dev 301-324). profile.mjs is read, never changed.
  const train = [...Array.from({ length: 16 }, (_, i) => R1.generate({ seed: 301 + i, split: 'dev', difficulty: 3 })),
    ...Array.from({ length: 8 }, (_, i) => R1.generate({ seed: 317 + i, split: 'dev', difficulty: 4 }))];
  const prof = learnProfile(train);
  const st = { planted: { novel: 0, n: 0, onSystem: 0 }, 'in-d3': { novel: 0, n: 0 }, 'in-d4': { novel: 0, n: 0 } };
  for (const d of DS) for (const seed of [341, 342, 343, 344, 345, 346]) {
    const task = gen(seed, d);
    for (const k of bed.childrenOf(task).filter(x => x.family === 'wbed-r1')) {
      const ct = bed.childTask(task, k.sub_id);
      const p = checkProfile(prof, { prompt: ct.prompt, inputs: ct.inputs });
      const b = k.outsideProfile ? st.planted : st[`in-d${k.difficulty}`];
      b.n++; if (p.novel) b.novel++;
      if (k.outsideProfile && p.reasons.some(r => r.path === `inputs.invoices.${k.planted.system}`)) b.onSystem++;
    }
  }
  r4('profile refusals (novel / packs; parents dev 341-346, d2-d5; in-dN = unplanted R1 packs at child difficulty N):', JSON.stringify(st));
  assert.equal(st.planted.novel, st.planted.n, 'every planted pack is outside the profile');
  assert.equal(st.planted.onSystem, st.planted.n, 'and the profile names the planted system');
});

test('scoreReuse: synthetic call logs (all correct, one wrong reuse, one missed reuse, re-derivation, wrong rung, adapted)', () => {
  const task = gen(302, 4);
  const kids = bed.childrenOf(task);
  const lib = { 'wbed-r1': 'sha256:r1', 'wbed-r3': 'sha256:r3' };
  const hashOfFam = f => lib[f];
  const planted = kids.find(k => k.outsideProfile), inR1 = kids.filter(k => k.family === 'wbed-r1' && !k.outsideProfile);
  // All correct: in-profile packs called and served; the planted pack refused outside-profile.
  const allOk = kids.map(k => (k.outsideProfile ? { calleeHash: hashOfFam(k.family), childId: k.sub_id, outcome: 'refused', refused: 'outside-profile' }
    : { calleeHash: hashOfFam(k.family), childId: k.sub_id, outcome: 'ok' }));
  let s = bed.scoreReuse(task, allOk, { library: lib });
  assert.deepEqual([s.counts.correct, s.counts.wrong, s.counts.missed, s.counts.rederived, s.counts.refusedCorrectly], [kids.length - 1, 0, 0, 0, 1]);
  assert.equal(s.childCalls, kids.length); assert.equal(s.wrongReuseRate, 0); assert.equal(s.falsifier.fires, false);
  // One wrong reuse: the planted pack reused anyway (the profile was not consulted).
  const wrong = allOk.map(e => (e.childId === planted.sub_id ? { ...e, outcome: 'ok', refused: undefined } : e));
  s = bed.scoreReuse(task, wrong, { library: lib });
  assert.equal(s.counts.wrong, 1); assert.equal(s.counts.correct, kids.length - 1);
  assert.equal(s.wrongReuseRate, 1 / kids.length); assert.equal(s.falsifier.fires, true);
  assert.equal(s.children.find(c => c.sub_id === planted.sub_id).status, 'wrong-reuse');
  // One missed reuse: an in-profile pack refused (a profile false alarm), solved inline.
  const missed = allOk.map(e => (e.childId === inR1[0].sub_id ? { ...e, outcome: 'refused', refused: 'outside-profile' } : e));
  s = bed.scoreReuse(task, missed, { library: lib });
  assert.equal(s.counts.missed, 1); assert.equal(s.counts.correct, kids.length - 2); assert.equal(s.counts.wrong, 0);
  // Re-derivation: an in-profile pack never called although the library holds its rung's solver.
  s = bed.scoreReuse(task, allOk.filter(e => e.childId !== inR1[0].sub_id), { library: lib });
  assert.equal(s.counts.rederived, 1); assert.equal(s.children.find(c => c.sub_id === inR1[0].sub_id).status, 'rederived');
  // With an empty library nothing is missed or re-derived.
  s = bed.scoreReuse(task, [], { library: {} });
  assert.equal(s.counts.rederived + s.counts.missed, 0);
  // Wrong rung (R3 solver on an R1 pack) and an output that fails the pack's oracle are wrong reuse; host event kinds work.
  const r3kid = kids.find(k => k.family === 'wbed-r3');
  const ctl = bed.badControls.find(c => c.name === 'child-error-propagated').trace(task).children;
  const badOut = ctl.find(c => c.sub_id === inR1[0].sub_id).output;
  s = bed.scoreReuse(task, [
    { callee: lib['wbed-r3'], childId: inR1[0].sub_id, kind: 'call-end' },
    { callee: lib['wbed-r1'], childId: inR1[1].sub_id, kind: 'call-end', output: badOut },
    { callee: lib['wbed-r3'], childId: r3kid.sub_id, kind: 'call-end', output: bed.referenceSolve(task).subsidiaries.find(x => x.sub_id === r3kid.sub_id).report },
    { callee: lib['wbed-r1'], childId: 'S99', kind: 'call-end' },
  ], { library: lib });
  assert.equal(s.counts.wrong, 2); assert.equal(s.counts.correct, 1); assert.equal(s.unattributed, 1); assert.equal(s.childCalls, 3);
  // Adapted: the planted pack's dialect rewritten before the call (input digest differs) and the output verified.
  const ref = bed.referenceSolve(task).subsidiaries.find(x => x.sub_id === planted.sub_id).report;
  s = bed.scoreReuse(task, [{ calleeHash: lib['wbed-r1'], childId: planted.sub_id, outcome: 'ok', inputDigest: 'f'.repeat(64), output: ref }], { library: lib });
  assert.equal(s.counts.adapted, 1); assert.equal(s.counts.wrong, 0);
  s = bed.scoreReuse(task, [{ calleeHash: lib['wbed-r1'], childId: planted.sub_id, outcome: 'ok', inputDigest: bed.packDigestOf(bed.childTask(task, planted.sub_id).inputs), output: ref }], { library: lib });
  assert.equal(s.counts.wrong, 1, 'the raw planted pack reused is wrong reuse even when this output happens to pass');
  // Default library: the placeholders of structure.outline.
  s = bed.scoreReuse(task, kids.filter(k => !k.outsideProfile).map(k => ({ calleeHash: k.family === 'wbed-r1' ? 'R1_REF_HASH' : 'R3_REF_HASH', childId: k.sub_id, outcome: 'ok' })));
  assert.equal(s.counts.correct, kids.length - 1);
});

test('measured: amount-only pairing fails on decoys with equal amounts (and memo-only on disputed amounts)', () => {
  const rows = [];
  for (const d of DS) {
    let aoPairs = 0, aoWrong = 0, aoMissed = 0, moPairs = 0, moWrong = 0, truePairs = 0, aoFailTasks = 0, items = 0;
    for (const seed of SEEDS) {
      const w = buildGroup(seed, 'dev', d);
      const t = new Set(w.pairs.map(pairKey));
      const ao = amountOnlyPairs(w).map(pairKey), mo = memoOnlyPairs(w).map(pairKey);
      truePairs += t.size; items += w.items.length;
      aoPairs += ao.length; aoWrong += ao.filter(k => !t.has(k)).length; aoMissed += [...t].filter(k => !ao.includes(k)).length;
      moPairs += mo.length; moWrong += mo.filter(k => !t.has(k)).length;
      if (ao.sort().join() !== [...t].sort().join()) aoFailTasks++;
      assert.ok(ao.some(k => !t.has(k)), `d${d} s${seed}: amount-only makes a wrong pair`);
    }
    rows.push({ d, items: +(items / SEEDS.length).toFixed(1), truePairs: +(truePairs / SEEDS.length).toFixed(1), amountOnlyWrongShare: +(aoWrong / aoPairs).toFixed(3),
      amountOnlyMissedShare: +(aoMissed / truePairs).toFixed(3), amountOnlyFailTasks: `${aoFailTasks}/${SEEDS.length}`, memoOnlyWrongShare: +(moWrong / moPairs).toFixed(3) });
    assert.equal(aoFailTasks, SEEDS.length);
  }
  r4('pairing fractions (means over dev 301-320):', JSON.stringify(rows));
});

test('measured: inline size of the parent task (inlineRender, utf8 bytes / 4) grows with difficulty', () => {
  const rows = {};
  for (const d of DS) {
    const toks = SEEDS.slice(0, 10).map(s => estimateTokens(inlineRender(gen(s, d))));
    const sz = SEEDS.slice(0, 10).map(s => bed.sizeOf(gen(s, d)));
    rows[d] = { mean: Math.round(toks.reduce((a, b) => a + b, 0) / toks.length), min: Math.min(...toks), max: Math.max(...toks),
      parentOnly: Math.round(sz.reduce((a, x) => a + x.parentOnlyTokens, 0) / sz.length), items: +(sz.reduce((a, x) => a + x.items, 0) / sz.length).toFixed(1) };
  }
  r4('inline tokens (seeds 301-310):', JSON.stringify(rows));
  for (const d of [2, 3, 4]) assert.ok(rows[d + 1].mean > rows[d].mean);
  assert.ok(rows[3].mean > 32000, 'd3 is above a 32K single-context budget');
});

test('drift knob changes the task distribution measurably', () => {
  for (const d of DS) {
    const L = bed.LEVELS[d];
    for (const seed of SEEDS.slice(0, 6)) {
      const w = buildGroup(seed, 'dev', d);
      assert.equal(w.subs.length, L.K);
      assert.equal(w.dateKeys.length > 1, L.dated);
      const cur = new Set(w.items.map(x => x.currency));
      if (d === 2) assert.ok(!cur.has('CHF') && !cur.has('JPY'));
      if (d === 5) assert.ok(cur.has('JPY'), 'd5 has yen schedules');
      assert.ok(w.items.length >= 2 * L.pairs + 2 * L.siblings + 1);
    }
  }
  const items = DS.map(d => SEEDS.slice(0, 6).reduce((a, s) => a + buildGroup(s, 'dev', d).items.length, 0));
  for (let i = 1; i < items.length; i++) assert.ok(items[i] > items[i - 1]);
});

test('hidden truth does not leak into prompt or inputs', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 10)) {
    const task = gen(seed, d);
    const text = canonical(task.inputs) + task.prompt;
    const ref = bed.referenceSolve(task);
    for (const f of ['receivables_minor', 'payables_minor', 'eliminated_minor']) {
      const v = ref.consolidated[f];
      if (Math.abs(v) < 100000) continue;
      assert.ok(!text.includes(String(v)), `d${d} s${seed}: consolidated.${f} ${v} appears in the task`);
    }
    assert.ok(!/outside.?profile|planted|decoy|sibling/i.test(text), 'no construction labels in the task');
  }
});

test('fault overlay: default generation is fault-free and requesting a fault throws in v1', () => {
  const a = gen(301, 3);
  assert.equal(hashOf(bed.generate({ seed: 301, split: 'dev', difficulty: 3, faults: {} })), hashOf(a));
  assert.throws(() => bed.generate({ seed: 301, split: 'dev', difficulty: 3, faults: { f1: { at: 9 } } }), /not implemented/);
});

test('runtime: generate and oracle under 2 s at difficulty 5', () => {
  const t0 = performance.now();
  const task = bed.generate({ seed: 389, split: 'test', difficulty: 5 });
  const t1 = performance.now();
  bed.oracle(task, bed.referenceSolve(task));
  const t2 = performance.now();
  r4(`d5 generate ${Math.round(t1 - t0)} ms, oracle ${Math.round(t2 - t1)} ms`);
  assert.ok(t1 - t0 < 2000, `generate ${t1 - t0} ms`);
  assert.ok(t2 - t1 < 2000, `oracle ${t2 - t1} ms`);
});

test('triviality driver lists R4 (dry run; stubs score through the oracle, no model)', async () => {
  const p = await plan({ rungs: ['r4'], seeds: [379, 380] });
  assert.equal(p[0].family, 'wbed-r4');
  for (const x of await runStub(p, 'reference')) assert.equal(x.pass, x.n);
  for (const x of await runStub(p, 'amount-only-pairing')) assert.equal(x.pass, 0);
  assert.ok(readFileSync(new URL('../../wbed-r4/index.mjs', import.meta.url), 'utf8').includes("'../wbed/r4/index.mjs'"));
  void root;
});
