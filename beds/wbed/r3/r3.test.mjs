// Oracle health for W-bed R3 "statement audit" (beds/CONTRACT.md rules; W-BED §2.2, §2.4, §3.3). Loaded by path; the
// registration shim beds/wbed-r3/index.mjs makes it loadable as family 'wbed-r3'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as bed from './index.mjs';
import { buildAudit } from './world.mjs';
import { canonical, sha256, estimateTokens, rng } from '../lib/prng.mjs';
import { amountIn } from '../lib/dialects.mjs';
import { buildLedger } from '../r1/world.mjs';
import { inlineRender, loadFamily } from '../../../experiments/lib/beds.mjs';
import { portableSchemaViolations } from '../../../src/schema-subset.mjs';
import { plan, runStub } from '../attacks/triviality.mjs';

const SEEDS = Array.from({ length: 20 }, (_, i) => 301 + i);
const DS = [2, 3, 4, 5];
const applies = (c, d) => d >= (c.minDifficulty ?? 0);
const hashOf = t => sha256(canonical(t));
const task = (seed, d, split = 'dev') => bed.generate({ seed, split, difficulty: d });
const inlineTokens = t => estimateTokens(inlineRender(t));

test('exports the bed interface plus the W-specific exports', async () => {
  for (const k of ['family', 'outputSchema', 'generate', 'oracle', 'referenceSolve', 'badControls', 'necessityControls', 'version', 'difficulty', 'stages', 'structure', 'relations', 'composedOracle']) assert.ok(k in bed, k);
  assert.equal(bed.family.id, 'wbed-r3');
  assert.equal(bed.version, '1.0.0');
  assert.deepEqual(bed.stages.map(s => s.id), ['split', 'match', 'classify', 'reduce']);
  assert.equal(bed.structure.shape, 'fan-out-fan-in');
  assert.ok(bed.structure.outline.some(l => /map\(statements/.test(l)) && bed.structure.outline.some(l => /reduce \(code\)/.test(l)));
  assert.equal((await loadFamily('wbed-r3')).family.id, 'wbed-r3');
});

test('output schema and stage contracts are in the portable subset', () => {
  assert.deepEqual(portableSchemaViolations(bed.outputSchema), []);
  for (const s of bed.stages) assert.deepEqual(portableSchemaViolations(s.outputSchema), [], s.id);
});

test('generator is deterministic: same seed -> same task hash, also in a fresh process', () => {
  for (const d of DS) for (const seed of [301, 350]) {
    const a = task(seed, d), b = task(seed, d);
    assert.equal(hashOf(a), hashOf(b));
    assert.notEqual(a.inputs, b.inputs);
  }
  const here = fileURLToPath(new URL('./index.mjs', import.meta.url));
  const code = `const m = await import(${JSON.stringify(here)}); const { canonical, sha256 } = await import(${JSON.stringify(fileURLToPath(new URL('../lib/prng.mjs', import.meta.url)))});`
    + `console.log(JSON.stringify([[301,3],[302,5],[303,2]].map(([s,d]) => sha256(canonical(m.generate({ seed: s, split: 'dev', difficulty: d }))))));`;
  const fresh = JSON.parse(execFileSync(process.execPath, ['--max-old-space-size=1024', '--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.deepEqual(fresh, [[301, 3], [302, 5], [303, 2]].map(([s, d]) => hashOf(task(s, d))));
  assert.notEqual(hashOf(task(301, 3)), hashOf(task(301, 3, 'test')));
});

for (const d of DS) {
  test(`d${d}: referenceSolve passes; every bad and every necessity control fails on ${SEEDS.length} seeds`, () => {
    const controls = [...bed.badControls, ...bed.necessityControls].filter(c => applies(c, d));
    for (const seed of SEEDS) {
      const t = task(seed, d);
      const ref = bed.oracle(t, bed.referenceSolve(t));
      assert.ok(ref.pass, `reference fails seed ${seed}: ${JSON.stringify(ref.details).slice(0, 300)}`);
      for (const c of controls) assert.equal(bed.oracle(t, c.make(t)).pass, false, `control ${c.name} passes seed ${seed} d${d}`);
    }
  });
}

test('the generator\'s plan is what the stated rules decide: every planned reason is the classified reason', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 8)) {
    const w = buildAudit(seed, 'dev', d), tr = bed.referenceTrace(task(seed, d));
    for (const v of w.vendors) {
      const c = tr.classify.items.find(x => x.vendor_id === v.id);
      assert.deepEqual(c.discrepancies.map(x => `${x.reason}|${x.amount_minor}`).sort(), v.plan.map(p => `${p.reason}|${p.amount}`).sort(), `${v.id} d${d} s${seed}`);
    }
    // per item: statement - ledger = sum of discrepancies; at least one clean supplier; every reason present
    const out = bed.referenceSolve(task(seed, d));
    for (const s of out.statements) assert.equal(s.statement_balance_minor - s.ledger_balance_minor, s.discrepancies.reduce((a, x) => a + x.amount_minor, 0));
    assert.ok(out.statements.some(s => s.discrepancies.length === 0));
    for (const x of out.by_reason) if (x.reason !== 'FX' || d >= 3) assert.ok(x.count >= 1, `${x.reason} d${d}`);
  }
});

test('controls: CONTRACT minimums, >= 12 plausible per difficulty, several relation controls', () => {
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted']) assert.ok(names.includes(n));
  assert.equal(new Set(names).size, names.length);
  for (const d of DS) assert.ok(bed.badControls.filter(c => applies(c, d)).length >= 12, `d${d}`);
  assert.ok(bed.badControls.filter(c => c.kind === 'relation').length >= 5);
  assert.deepEqual(bed.necessityControls.map(c => c.name).sort(), ['no-reducer-currency-mixed', 'no-reducer-lost-middle', 'sequential-single-context']);
});

test('relation controls pass every stage oracle and the reduce stage\'s local checks but fail a cross-stage relation', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 5)) {
    const t = task(seed, d);
    for (const c of bed.badControls.filter(x => x.kind === 'relation')) {
      const co = bed.composedOracle(t, c.trace(t));
      for (const [id, r] of Object.entries(co.stages)) assert.ok(r.pass, `${c.name} d${d} s${seed}: stage ${id} fails ${JSON.stringify(r.details).slice(0, 200)}`);
      assert.ok(Object.values(co.relations).some(r => !r.pass), `${c.name} d${d} s${seed}: no relation fails`);
    }
  }
});

test('necessity: a reducer-less solve gets every item right and fails the fan-in conservation relation (Z3)', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 5)) {
    const t = task(seed, d);
    for (const c of bed.necessityControls.filter(x => x.name.startsWith('no-reducer'))) {
      const co = bed.composedOracle(t, c.trace(t));
      for (const id of ['split', 'match', 'classify']) assert.ok(co.stages[id].pass, `${c.name}: per-item stage ${id} is right`);
      assert.equal(co.relations['Z3-fan-in-conservation'].pass, false, `${c.name} d${d} s${seed}`);
      assert.equal(bed.oracle(t, c.make(t)).pass, false);
    }
  }
});

test('necessity: a sequential single-context solve fails on size at d4-d5 (inline task above the budget)', t => {
  const sizes = {};
  for (const d of [4, 5]) {
    const toks = SEEDS.map(s => inlineTokens(task(s, d)));
    sizes[d] = { min: Math.min(...toks), mean: Math.round(toks.reduce((a, b) => a + b, 0) / toks.length), max: Math.max(...toks) };
    assert.ok(sizes[d].min > bed.SEQUENTIAL_BUDGET_TOKENS, `d${d}: every task exceeds the ${bed.SEQUENTIAL_BUDGET_TOKENS}-token single-context budget`);
    const seq = bed.necessityControls.find(c => c.name === 'sequential-single-context');
    for (const seed of SEEDS) { const tk = task(seed, d); assert.ok(bed.sizeOf(tk).skimmed >= 1); assert.equal(bed.oracle(tk, seq.make(tk)).pass, false); }
  }
  assert.ok(sizes[5].mean >= 60000, `d5 mean ${sizes[5].mean} < 60K`);
  assert.ok(sizes[5].min >= 57000, `d5 min ${sizes[5].min}`);
  t.diagnostic(`inline tokens (utf8/4) d4-d5: ${JSON.stringify(sizes)}`);
});

test('token sizes and fan-out width by difficulty', t => {
  const rows = {};
  for (const d of DS) {
    const xs = SEEDS.slice(0, 10).map(s => { const tk = task(s, d); return { ...bed.sizeOf(tk), inline: inlineTokens(tk) }; });
    const mean = k => Math.round(xs.reduce((a, x) => a + x[k], 0) / xs.length);
    rows[d] = { statements: mean('statements'), statementLines: mean('statementLines'), ledgerLines: mean('ledgerLines'), discrepancies: mean('discrepancies'), itemTokens: mean('itemTokensMean'), inline: mean('inline'), skimmed: mean('skimmed') };
  }
  assert.deepEqual(DS.map(d => rows[d].statements), [8, 16, 32, 48]);
  for (let d = 2; d < 5; d++) for (const k of ['statementLines', 'discrepancies', 'inline']) assert.ok(rows[d + 1][k] > rows[d][k], `${k} d${d + 1}`);
  assert.equal(rows[2].skimmed, 0);
  t.diagnostic(`R3 sizes (means over seeds 301-310): ${JSON.stringify(rows)}`);
});

test('composed oracle agrees with the end-to-end oracle on every trace; stage controls fail a stage oracle', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 4)) {
    const t = task(seed, d);
    assert.ok(bed.composedOracle(t, bed.referenceTrace(t)).pass);
    for (const c of [...bed.badControls, ...bed.necessityControls].filter(x => x.trace && applies(x, d))) {
      const tr = c.trace(t), co = bed.composedOracle(t, tr);
      assert.equal(co.pass, bed.oracle(t, tr.reduce).pass, `${c.name} d${d} s${seed}`);
      if (c.kind === 'stage') assert.ok(Object.values(co.stages).some(r => !r.pass), `${c.name}: some stage oracle must see it`);
    }
  }
});

test('stage hand-offs of the reference trace satisfy their contracts; stage oracles pass on the truth', () => {
  for (const d of DS) {
    const t = task(311, d), tr = bed.referenceTrace(t);
    for (const s of ['split', 'match', 'classify', 'reduce']) assert.deepEqual(bed.CONTRACTS[s].check(tr[s]), [], `${s} d${d}`);
    assert.deepEqual(bed.CONTRACTS.input.check(t.inputs), []);
    for (const s of bed.stages) {
      assert.ok(s.oracle(s.project(t), tr[s.id]).pass, `${s.id} d${d}`);
      assert.equal(s.oracle(s.project(t), {}).pass, false);
    }
  }
});

test('oracle: schema-invalid and hostile outputs fail; exact on the reduced result; order-insensitive', () => {
  const t = task(305, 3), ref = bed.referenceSolve(t);
  for (const out of [null, {}, { ...ref, totals: undefined }, { ...ref, by_reason: ref.by_reason.slice(1) }, new Proxy(ref, {}),
    { ...ref, statements: ref.statements.map((s, i) => (i ? s : { ...s, adjusted_balance_minor: String(s.adjusted_balance_minor) })) }]) assert.equal(bed.oracle(t, out).pass, false);
  const sh = structuredClone(ref);
  sh.statements.reverse(); sh.by_reason.reverse(); for (const s of sh.statements) { s.discrepancies.reverse(); for (const x of s.discrepancies) x.ref = x.ref.toLowerCase(); }
  assert.ok(bed.oracle(t, sh).pass);
  const cent = structuredClone(ref); cent.totals.difference_usd_cents += 1;
  assert.equal(bed.oracle(t, cent).pass, false);
  const dup = structuredClone(ref); dup.statements.push(dup.statements[0]);
  assert.equal(bed.oracle(t, dup).pass, false);
});

test('hidden truth does not leak: USD totals and reason codes are not in the task', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 10)) {
    const t = task(seed, d), text = canonical(t), ref = bed.referenceSolve(t);
    for (const k of ['difference_usd_cents', 'adjustments_usd_cents']) {
      const v = Math.abs(ref.totals[k]);
      if (v < 100000) continue;
      assert.ok(!text.includes(String(v)) && !text.includes((v / 100).toFixed(2)), `d${d} s${seed}: ${k}`);
    }
    for (const s of Object.values(t.inputs.statements)) for (const code of ['UNEXPLAINED', 'MISSING_CREDIT', 'DUPLICATE']) assert.ok(!s.includes(code));
  }
});

test('drift knob changes the task distribution measurably', () => {
  const feat = (seed, d) => { const w = buildAudit(seed, 'dev', d); return { systems: new Set(w.vendors.map(v => v.system)), cr: w.vendors.filter(v => v.cr).length, alias: w.vendors.filter(v => v.aliasUse).length, atlas: w.atlasOrder }; };
  const by = Object.fromEntries(DS.map(d => [d, SEEDS.map(s => feat(s, d))]));
  assert.ok(by[2].every(x => x.cr === 0 && x.alias === 0 && x.systems.size === 3));
  assert.ok(by[3].every(x => x.alias >= 1 && x.cr === 0 && x.systems.has('ATLAS')));
  assert.deepEqual(new Set(by[3].map(x => x.atlas)), new Set(['DMY', 'MDY']), 'd3 draws the ATLAS date order per task');
  assert.ok(by[4].every(x => x.cr >= 1 && x.systems.has('TALLY')));
  assert.ok(by[5].every(x => x.systems.has('KOBO') && x.systems.has('VENDEX')));
});

test('cross-rung reuse: R3 statements print amounts exactly as R1 invoice lists do (lib/dialects.mjs)', () => {
  const w = buildLedger(303, 'dev', 4), rr = rng('pin');
  let n = 0;
  for (const inv of w.invoices.filter(i => i.system !== 'KOBO')) { assert.equal(amountIn(inv.system, inv.currency, inv.minor, rr), w.render.invText.get(inv.no).amount); n++; }
  assert.ok(n > 50);
});

test('triviality driver plans R3 dry (no model call) and scores stubs through the oracle', async () => {
  const p = await plan({ rungs: ['r3'], seeds: [379, 380] });
  assert.equal(p[0].calls, 4);
  assert.match(p[0].necessity, /fan-out/);
  for (const x of await runStub(p, 'reference')) assert.equal(x.pass, x.n);
  for (const x of await runStub(p, 'no-reducer-lost-middle')) assert.equal(x.pass, 0);
});

test('fault overlay: default generation is fault-free and requesting a fault throws in v1', () => {
  assert.equal(hashOf(bed.generate({ seed: 301, split: 'dev', difficulty: 3, faults: [] })), hashOf(task(301, 3)));
  assert.throws(() => bed.generate({ seed: 301, split: 'dev', difficulty: 3, faults: ['f1'] }), /not implemented/);
});

test('runtime: generate and oracle under 3 s at difficulty 5', () => {
  const t0 = performance.now();
  const t = bed.generate({ seed: 389, split: 'test', difficulty: 5 });
  const t1 = performance.now();
  bed.oracle(t, bed.referenceSolve(t));
  assert.ok(t1 - t0 < 3000, `generate ${t1 - t0} ms`);
  assert.ok(performance.now() - t1 < 3000);
});
