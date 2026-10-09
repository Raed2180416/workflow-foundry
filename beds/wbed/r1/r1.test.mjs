// Oracle health for W-bed R1 "ledger close" (beds/CONTRACT.md rules; W-BED §2.2). The family is loaded by path:
// experiments/lib/beds.mjs resolves ids to beds/<id>/index.mjs, and this bed lives at beds/wbed/r1 (see
// research/jit-20261008/design/W-BED-R1-NOTES.md for the one-line registration).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as bed from './index.mjs';
import { buildLedger } from './world.mjs';
import { canonical, sha256 } from '../lib/prng.mjs';
import { portableSchemaViolations } from '../../../src/schema-subset.mjs';

const SEEDS = Array.from({ length: 20 }, (_, i) => 301 + i); // dev 301-320 (proposed wbed-dev-a)
const DS = [2, 3, 4, 5];
const applies = (c, d) => d >= (c.minDifficulty ?? 0);
const hashOf = t => sha256(canonical(t));

test('exports the bed interface plus the W-specific exports', () => {
  for (const k of ['family', 'outputSchema', 'generate', 'oracle', 'referenceSolve', 'badControls', 'version', 'difficulty', 'stages', 'structure']) assert.ok(k in bed, k);
  assert.equal(bed.family.id, 'wbed-r1');
  assert.equal(bed.family.version, '1.0.0');
  assert.equal(bed.version, '1.0.0');
  assert.equal(bed.family.kind, 'oneshot');
  assert.deepEqual(bed.stages.map(s => s.id), ['extract', 'normalise', 'reconcile', 'report']);
  for (const s of bed.stages) for (const k of ['inputSchema', 'outputSchema', 'oracle', 'project']) assert.ok(s[k], `${s.id}.${k}`);
  assert.deepEqual(bed.structure.stages, ['extract', 'normalise', 'reconcile', 'report']);
  assert.equal(bed.difficulty.min, 2);
  assert.equal(bed.difficulty.max, 5);
});

test('output schema is in the portable subset', () => {
  assert.deepEqual(portableSchemaViolations(bed.outputSchema), []);
});

test('generator is deterministic: same seed -> same task hash, also in a fresh process', () => {
  for (const d of DS) for (const seed of [301, 302, 350]) {
    const a = bed.generate({ seed, split: 'dev', difficulty: d }), b = bed.generate({ seed, split: 'dev', difficulty: d });
    assert.equal(hashOf(a), hashOf(b));
    assert.notEqual(a.inputs, b.inputs, 'each call returns a fresh object');
  }
  const here = fileURLToPath(new URL('./index.mjs', import.meta.url));
  const code = `const m = await import(${JSON.stringify(here)}); const { canonical, sha256 } = await import(${JSON.stringify(fileURLToPath(new URL('../lib/prng.mjs', import.meta.url)))});`
    + `console.log(JSON.stringify([[301,3],[302,5],[303,2]].map(([s,d]) => sha256(canonical(m.generate({ seed: s, split: 'dev', difficulty: d }))))));`;
  const fresh = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.deepEqual(fresh, [[301, 3], [302, 5], [303, 2]].map(([s, d]) => hashOf(bed.generate({ seed: s, split: 'dev', difficulty: d }))));
  assert.notEqual(hashOf(bed.generate({ seed: 301, split: 'dev', difficulty: 3 })), hashOf(bed.generate({ seed: 301, split: 'test', difficulty: 3 })));
  assert.notEqual(hashOf(bed.generate({ seed: 301, split: 'dev', difficulty: 3 })), hashOf(bed.generate({ seed: 302, split: 'dev', difficulty: 3 })));
});

for (const d of DS) {
  test(`d${d}: referenceSolve passes and every bad control fails on ${SEEDS.length} seeds`, () => {
    const controls = bed.badControls.filter(c => applies(c, d));
    for (const seed of SEEDS) {
      const task = bed.generate({ seed, split: 'dev', difficulty: d });
      const ref = bed.oracle(task, bed.referenceSolve(task));
      assert.ok(ref.pass, `reference fails seed ${seed}: ${JSON.stringify(ref.details).slice(0, 300)}`);
      assert.equal(ref.score, 1);
      for (const c of controls) {
        const r = bed.oracle(task, c.make(task));
        assert.equal(r.pass, false, `control ${c.name} passes seed ${seed} d${d}`);
        assert.ok(r.score < 1);
      }
    }
  });
}

test('controls: CONTRACT minimums, >= 6 plausible, >= 2 relation controls', () => {
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted']) assert.ok(names.includes(n));
  assert.ok(bed.badControls.filter(c => !['empty', 'shuffled-or-corrupted'].includes(c.name)).length >= 6);
  assert.ok(bed.badControls.filter(c => c.kind === 'relation').length >= 2);
  assert.equal(new Set(names).size, names.length);
});

test('relation controls pass every stage oracle and the report\'s local checks but fail a cross-stage relation', () => {
  const rel = bed.badControls.filter(c => c.kind === 'relation');
  for (const d of DS) for (const seed of SEEDS.slice(0, 6)) {
    const task = bed.generate({ seed, split: 'dev', difficulty: d });
    for (const c of rel) {
      const co = bed.composedOracle(task, c.trace(task));
      for (const [id, r] of Object.entries(co.stages)) assert.ok(r.pass, `${c.name} d${d} s${seed}: stage ${id} fails ${JSON.stringify(r.details).slice(0, 200)}`);
      assert.ok(Object.values(co.relations).some(r => !r.pass), `${c.name} d${d} s${seed}: no relation fails`);
      assert.equal(co.pass, false);
      assert.equal(bed.oracle(task, c.trace(task).report).pass, false);
    }
  }
});

test('composed oracle (stage oracles AND relations) agrees with the end-to-end oracle on every trace', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 5)) {
    const task = bed.generate({ seed, split: 'dev', difficulty: d });
    const ref = bed.composedOracle(task, bed.referenceTrace(task));
    assert.ok(ref.pass, JSON.stringify(ref).slice(0, 400));
    for (const c of bed.badControls.filter(x => x.trace && applies(x, d))) {
      const tr = c.trace(task);
      const co = bed.composedOracle(task, tr);
      assert.equal(co.pass, bed.oracle(task, tr.report).pass, `${c.name} d${d} s${seed}`);
      if (c.kind === 'stage') assert.ok(Object.values(co.stages).some(r => !r.pass), `${c.name}: some stage oracle must see a stage mistake`);
    }
  }
});

test('stage hand-offs of the reference trace satisfy their typed contracts; stage oracles pass on the truth', () => {
  for (const d of DS) {
    const task = bed.generate({ seed: 311, split: 'dev', difficulty: d });
    const tr = bed.referenceTrace(task);
    for (const s of ['extract', 'normalise', 'reconcile', 'report']) assert.deepEqual(bed.CONTRACTS[s].check(tr[s]), [], `${s} d${d}`);
    assert.deepEqual(bed.CONTRACTS.input.check(task.inputs), []);
    for (const s of bed.stages) {
      const st = s.project(task);
      assert.ok(s.oracle(st, tr[s.id]).pass, `${s.id} d${d}`);
      assert.equal(s.oracle(st, {}).pass, false, `${s.id} rejects an empty hand-off`);
    }
  }
});

test('oracle rejects schema-invalid and hostile outputs', () => {
  const task = bed.generate({ seed: 305, split: 'dev', difficulty: 3 });
  const ref = bed.referenceSolve(task);
  const bad = [
    null, 42, 'x', {}, { customers: ref.customers }, { totals: ref.totals },
    { ...ref, customers: ref.customers.map((c, i) => (i ? c : { ...c, invoiced_usd_cents: String(c.invoiced_usd_cents) })) },
    { ...ref, customers: ref.customers.map((c, i) => (i ? c : { ...c, paid_usd_cents: c.paid_usd_cents + 0.5 })) },
    { ...ref, customers: ref.customers.map((c, i) => (i ? c : { ...c, source_rows: [] })) },
    { ...ref, totals: { ...ref.totals, customers: undefined } },
    new Proxy(ref, {}),
  ];
  for (const out of bad) assert.equal(bed.oracle(task, out).pass, false);
  // A row in two customers is rejected outright.
  const dup = structuredClone(ref);
  dup.customers[1].source_rows.push(dup.customers[0].source_rows[0]);
  assert.equal(bed.oracle(task, dup).details.reason, 'row-in-multiple-customers');
  // Order of customers and of source rows does not matter.
  const shuffled = structuredClone(ref);
  shuffled.customers.reverse(); for (const c of shuffled.customers) c.source_rows.reverse();
  assert.ok(bed.oracle(task, shuffled).pass);
  // One cent off anywhere fails.
  const cent = structuredClone(ref);
  cent.customers[0].paid_usd_cents += 1; cent.customers[0].open_usd_cents -= 1; cent.totals.paid_usd_cents += 1; cent.totals.open_usd_cents -= 1;
  assert.equal(bed.oracle(task, cent).pass, false);
});

test('hidden truth does not leak into prompt or inputs', () => {
  for (const d of DS) for (const seed of SEEDS) {
    const task = bed.generate({ seed, split: 'dev', difficulty: d });
    const text = canonical(task);
    const ref = bed.referenceSolve(task);
    for (const f of ['invoiced_usd_cents', 'paid_usd_cents', 'open_usd_cents']) {
      const v = ref.totals[f];
      if (Math.abs(v) < 100000) continue;
      assert.ok(!text.includes(String(v)), `d${d} s${seed}: totals.${f} ${v} appears in the task`);
      assert.ok(!text.includes((v / 100).toFixed(2)), `d${d} s${seed}: totals.${f} in dollars appears in the task`);
    }
  }
});

test('drift knob changes the task distribution measurably', () => {
  const feat = (seed, d) => {
    const t = bed.generate({ seed, split: 'dev', difficulty: d }), w = buildLedger(seed, 'dev', d);
    return { systems: Object.keys(t.inputs.invoices).length, tally: 'TALLY' in t.inputs.invoices, switch: /print server/.test(t.inputs.ledger_notes),
      atlas: w.conv.atlasPost, flags: w.flags.length, polarities: new Set(w.flags.map(f => f.polarity)).size,
      invoices: w.invoices.length, rows: w.rw.allRows.length, tokens: bed.taskTokens(t) };
  };
  const by = Object.fromEntries(DS.map(d => [d, SEEDS.map(s => feat(s, d))]));
  const mean = (d, k) => by[d].reduce((s, x) => s + x[k], 0) / by[d].length;
  for (const k of ['invoices', 'rows', 'tokens']) for (let d = 2; d < 5; d++) assert.ok(mean(d + 1, k) > mean(d, k), `${k}: d${d + 1} > d${d}`);
  assert.ok(by[2].every(x => x.atlas === 'DMY' && !x.tally && !x.switch && x.flags === 0));
  assert.deepEqual(new Set(by[3].map(x => x.atlas)), new Set(['DMY', 'MDY']), 'd3 draws the ATLAS invoice order per task');
  assert.ok(by[3].every(x => !x.tally && !x.switch && x.flags === 0));
  assert.ok(by[4].every(x => x.tally && x.switch && x.flags === 1), 'every d4 task has TALLY, the ATLAS switch and one status word');
  assert.ok(by[5].every(x => x.tally && x.switch && x.flags === 2 && x.polarities === 2));
  assert.ok(by[3].every(x => x.systems === 6) && by[4].every(x => x.systems === 7), 'd4 adds a billing system');
});

test('fault overlay: default generation is fault-free and requesting a fault throws in v1', () => {
  const a = bed.generate({ seed: 301, split: 'dev', difficulty: 3 });
  assert.equal(hashOf(bed.generate({ seed: 301, split: 'dev', difficulty: 3, faults: {} })), hashOf(a));
  assert.throws(() => bed.generate({ seed: 301, split: 'dev', difficulty: 3, faults: { f1: { at: 9 } } }), /not implemented/);
});

test('runtime: generate and oracle well under 2 s at difficulty 5', () => {
  const t0 = performance.now();
  const task = bed.generate({ seed: 389, split: 'test', difficulty: 5 });
  const t1 = performance.now();
  bed.oracle(task, bed.referenceSolve(task));
  const t2 = performance.now();
  assert.ok(t1 - t0 < 2000, `generate ${t1 - t0} ms`);
  assert.ok(t2 - t1 < 2000, `oracle ${t2 - t1} ms`);
});
