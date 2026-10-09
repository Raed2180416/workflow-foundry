// Oracle health for W-bed R0, the no-workflow control (W-BED §3.0). Loaded by path (see W-BED-R1-NOTES.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as bed from './index.mjs';
import { canonical, sha256, estimateTokens } from '../lib/prng.mjs';
import { inlineRender } from '../../../experiments/lib/beds.mjs';
import { portableSchemaViolations } from '../../../src/schema-subset.mjs';

const SEEDS = Array.from({ length: 20 }, (_, i) => 301 + i);
const DS = [2, 3, 4, 5];
const hashOf = t => sha256(canonical(t));

test('exports and portable schema', () => {
  for (const k of ['family', 'outputSchema', 'generate', 'oracle', 'referenceSolve', 'badControls', 'version', 'difficulty', 'stages', 'structure']) assert.ok(k in bed, k);
  assert.equal(bed.family.id, 'wbed-r0');
  assert.equal(bed.version, '1.0.0');
  assert.equal(bed.structure.shape, 'none');
  assert.deepEqual(portableSchemaViolations(bed.outputSchema), []);
});

test('deterministic and split/seed sensitive', () => {
  for (const d of DS) for (const seed of [301, 377]) assert.equal(hashOf(bed.generate({ seed, split: 'dev', difficulty: d })), hashOf(bed.generate({ seed, split: 'dev', difficulty: d })));
  assert.notEqual(hashOf(bed.generate({ seed: 301, split: 'dev', difficulty: 3 })), hashOf(bed.generate({ seed: 301, split: 'test', difficulty: 3 })));
});

for (const d of DS) {
  test(`d${d}: reference passes, every control fails, task stays small (${SEEDS.length} seeds)`, () => {
    for (const seed of SEEDS) {
      const task = bed.generate({ seed, split: 'dev', difficulty: d });
      assert.ok(bed.oracle(task, bed.referenceSolve(task)).pass, `seed ${seed}`);
      for (const c of bed.badControls.filter(x => d >= (x.minDifficulty ?? 0))) assert.equal(bed.oracle(task, c.make(task)).pass, false, `${c.name} s${seed}`);
      assert.ok(estimateTokens(inlineRender(task)) < 2000, 'R0 is one short document (< 2K tokens inline)');
    }
  });
}

test('controls: CONTRACT minimums and plausible near misses', () => {
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted', 'date-order-flipped', 'tax-ignored', 'quantity-ignored']) assert.ok(names.includes(n), n);
});

test('oracle rejects schema-invalid output; formatting of the invoice number is lenient', () => {
  const task = bed.generate({ seed: 333, split: 'dev', difficulty: 3 });
  const ref = bed.referenceSolve(task);
  for (const out of [null, {}, { ...ref, net_minor: String(ref.net_minor) }, { ...ref, void: 'no' }, { ...ref, tax_minor: 1.5 }]) assert.equal(bed.oracle(task, out).pass, false);
  assert.ok(bed.oracle(task, { ...ref, invoice_number: ref.invoice_number.toLowerCase().replace(/[-/]/g, ' ') }).pass);
});

test('drift knob: lines grow, discount and status word from d4, credited line at d5', () => {
  const lines = d => SEEDS.map(s => (bed.generate({ seed: s, split: 'dev', difficulty: d }).inputs.document.match(/^ \d+ /gm) ?? []).length);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  for (let d = 2; d < 5; d++) assert.ok(mean(lines(d + 1)) > mean(lines(d)));
  for (const s of SEEDS) {
    const t3 = bed.generate({ seed: s, split: 'dev', difficulty: 3 }), t4 = bed.generate({ seed: s, split: 'dev', difficulty: 4 }), t5 = bed.generate({ seed: s, split: 'dev', difficulty: 5 });
    assert.ok(!/Discount/.test(t3.inputs.document) && /Discount/.test(t4.inputs.document));
    assert.ok(/credited/.test(t5.inputs.document) && !/credited, not billed/.test(t4.inputs.document));
  }
});

test('fault overlay is inert in v1', () => {
  assert.throws(() => bed.generate({ seed: 301, split: 'dev', difficulty: 3, faults: ['f3'] }), /not implemented/);
});
