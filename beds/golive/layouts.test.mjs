// $0 health of the golive 'blocks' layout (SW-1b): same worlds and truth as the delimited bed, lossless rendering, the
// node controls still fail, and no template of the SW-1 library can read it (the template-miss property the probe needs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as base from './index.mjs';
import { buildWorld } from './world.mjs';
import { generate, backlogFields, readBlocks, LAYOUTS } from './layouts.mjs';
import { templateById, instantiate, slotProblems } from '../../experiments/subworkflow/templates.mjs';
import { practiceRun } from '../../experiments/subworkflow/bind.mjs';
import { trueSlots } from '../../experiments/subworkflow/test/fixtures.mjs';

const SEEDS = Array.from({ length: 12 }, (_, i) => 100 + i);
const inputOf = (task, ch) => { const c = task.inputs.channels.find(x => x.channel === ch); return { channel: c.channel, spec: task.inputs.spec, notes: c.notes, export: c.export }; };

test('blocks: same spec and simple channels, backlog exports re-rendered, id suffixed, reference passes the unchanged oracles (d1-d5)', () => {
  for (const d of [1, 2, 3, 4, 5]) for (const seed of SEEDS) {
    const a = base.generate({ seed, split: 'test', difficulty: d }), b = generate({ seed, split: 'test', difficulty: d, layout: 'blocks' });
    assert.equal(b.id, `${a.id}+blocks`);
    assert.equal(b.inputs.spec, a.inputs.spec);
    const kinds = new Map(base.channelKinds(a).map(k => [k.channel, k.kind]));
    for (const [i, c] of b.inputs.channels.entries()) {
      if (kinds.get(c.channel) === 'simple') assert.deepEqual(c, a.inputs.channels[i]);
      else { assert.notEqual(c.export, a.inputs.channels[i].export); assert.match(c.export, /^@@ RECORD 1\n/); assert.match(c.export, /\n@@ END records=\d+ /); }
    }
    assert.equal(base.oracle(b, base.referenceSolve(b)).pass, true);
    assert.equal(JSON.stringify(generate({ seed, split: 'test', difficulty: d, layout: 'blocks' })), JSON.stringify(b));
    assert.equal(JSON.stringify(generate({ seed, split: 'test', difficulty: d, layout: 'delimited' })), JSON.stringify(a));
  }
  assert.deepEqual(LAYOUTS, ['delimited', 'blocks']);
});

test('the layout generator reproduces the frozen eval-1 inputs exactly (delimited) and the SW-1b manifest (blocks)', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { canonicalJson } = await import('../../experiments/subworkflow/dsl.mjs');
  const root = new URL('../../research/subworkflow-20261021/', import.meta.url);
  let n = 0;
  for (const name of ['tasks-eval.json', 'tasks-sw1b.json']) {
    const f = new URL(name, root);
    if (!existsSync(f)) continue;
    for (const t of JSON.parse(readFileSync(f, 'utf8')).tasks) {
      const g = generate({ seed: t.seed, split: t.split, difficulty: t.difficulty, layout: t.layout ?? 'delimited' });
      assert.equal(g.id, t.id);
      assert.equal(createHash('sha256').update(canonicalJson(g.inputs)).digest('hex'), t.inputsSha256, `${t.id} inputs changed`);
      n++;
    }
  }
  assert.ok(n >= 20, `checked ${n} manifest tasks`);
});

test('blocks: lossless (a reference reader recovers every field of every exported row, in order) and the trailer counts match', () => {
  for (const d of [2, 4, 5]) for (const seed of SEEDS) {
    const task = generate({ seed, split: 'test', difficulty: d, layout: 'blocks' }), w = buildWorld(seed, 'test', d);
    for (const ch of w.channels.filter(c => c.kind === 'backlog')) {
      const text = task.inputs.channels.find(c => c.channel === ch.name).export, want = backlogFields(ch);
      const got = readBlocks(text, ch.columns.map(c => ch.header[c]));
      assert.equal(got.rows.length, ch.versions.length);
      got.rows.forEach((r, i) => { for (const c of ch.columns) assert.equal(r[ch.header[c]], want.rows[i][c], `${task.id} ${ch.name} row ${i} ${c}`); });
      assert.match(got.trailer, new RegExp(`^@@ END records=${ch.versions.length} `));
    }
  }
});

test('blocks: every node control still fails on every backlog node (d2-d5)', () => {
  for (const d of [2, 3, 4, 5]) for (const seed of SEEDS) {
    const task = generate({ seed, split: 'test', difficulty: d, layout: 'blocks' });
    for (const k of base.channelKinds(task).filter(x => x.kind === 'backlog')) for (const c of base.nodeControls) {
      assert.equal(base.nodeOracle(task, k.channel, c.makeNode(task, k.channel)).pass, false, `${task.id} ${k.channel} ${c.name}`);
    }
  }
});

test('blocks: no SW-1 template reads it (legacy-export-intake with the true slots and any delimiter or trailer; json-list-intake)', async () => {
  const T = templateById('legacy-export-intake'), J = templateById('json-list-intake');
  for (const [seed, d] of [[201, 4], [202, 5], [203, 3]]) {
    const task = generate({ seed, split: 'test', difficulty: d, layout: 'blocks' }), w = buildWorld(seed, 'test', d);
    for (const ch of w.channels.filter(c => c.kind === 'backlog')) {
      const input = inputOf(task, ch.name), good = trueSlots(task, ch);
      for (const delimiter of [';', '|', 'tab', ',']) for (const trailer_prefix of ['#END', '@@ END', '']) {
        const slots = { ...good, delimiter, trailer_prefix };
        assert.deepEqual(slotProblems(T, slots), []);
        const p = await practiceRun(instantiate(T, slots, 0.05), input);
        assert.equal(p.ok, false, `${task.id} ${ch.name} legacy template read blocks with ${JSON.stringify(delimiter)} / ${JSON.stringify(trailer_prefix)}`);
      }
      const js = { ...good, field_ref: ch.header.ref, field_placed: ch.header.placed, field_amount: ch.header.amount, field_note: ch.header.note, currency: ch.home };
      const pj = await practiceRun(instantiate(J, Object.fromEntries(J.slots.map(s => [s.name, js[s.name]])), 0.05), input);
      assert.equal(pj.ok, false, `${task.id} ${ch.name} json-list template read blocks`);
    }
  }
});
