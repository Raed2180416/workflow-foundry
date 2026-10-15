// latent-demand.mjs (Z1): the host's child/inline choice replayed over attempt rows at $0, with both probe readings and H5.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { replayLatentDemand, probeOf, taskSizeOf, parseSizeOnly, bedSizer, H5_LIMIT, NOT_REPLAYABLE } from '../latent-demand.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const SIZES = { small: { tokens: 600, units: 0 }, big: { tokens: 50000, units: 300 }, wide: { tokens: 5000, units: 40 }, pad: { tokens: 20000, units: 15 } };
const sizeOf = async key => SIZES[String(key).split(':')[0].replace(/^fam-/, '')] ?? SIZES.small;
const row = (fam, seed, o = {}) => ({ taskKey: `${fam}:dev:d3:s${seed}`, arm: o.arm ?? 'one-call', pass: o.pass ?? false, error: o.error ?? null });

test('probe readings: a timeout is slow; any other error is a visible failure; only the oracle reading sees a wrong but well-formed answer', () => {
  assert.deepEqual(probeOf(row('x', 1, { error: { code: 'MODEL_TIMEOUT' } })), { deployable: { failed: 0, slow: true }, oracle: { failed: 1, slow: true }, code: 'MODEL_TIMEOUT' });
  assert.deepEqual(probeOf(row('x', 1, { error: { code: 'MODEL_SCHEMA' } })).deployable, { failed: 1, slow: false });
  assert.deepEqual(probeOf(row('x', 1, { pass: false })), { deployable: { failed: 0, slow: false }, oracle: { failed: 1, slow: false }, code: null });
  assert.deepEqual(probeOf(row('x', 1, { pass: true })).oracle, { failed: 0, slow: false });
});

test('replay: a child only where the task is big and the attempt failed or was slow; per cell, per task, H5 and the size-only cells', async () => {
  const rows = [
    row('fam-small', 1, { pass: true }), row('fam-small', 2, { error: { code: 'MODEL_SCHEMA' } }),   // small: never a child, even failing
    row('fam-big', 1, { error: { code: 'MODEL_TIMEOUT' } }), row('fam-big', 1, { arm: 'two', pass: false }), // big: slow -> child; wrong -> oracle only
    row('fam-big', 2, { pass: true }), row('fam-big', 2, { arm: 'two', pass: true }),                       // big but solved: inline
    row('fam-wide', 1, { error: { code: 'MODEL_SCHEMA' } }),                                               // more than 32 units, a visible failure
    row('wbed-r0', 1, { pass: true }), row('wbed-r0', 2, { pass: false }),
  ];
  const r = await replayLatentDemand({ rows, sizeOf: async k => (k.startsWith('wbed-r0') ? SIZES.small : k.startsWith('need-r0pad') ? SIZES.pad : sizeOf(k)), sizeOnly: [parseSizeOnly('need-r0pad@2,3:601-602')] });
  const cell = (c, arm = 'one-call') => r.cells.find(x => x.cell === c && x.arm === arm);
  assert.deepEqual([cell('fam-small@d3').n, cell('fam-small@d3').big, cell('fam-small@d3').deployable.child, cell('fam-small@d3').oracle.child], [2, 0, 0, 0]);
  assert.deepEqual(cell('fam-big@d3').deployable, { child: 1, failed: 0, slow: 1 });
  assert.deepEqual(cell('fam-big@d3', 'two').deployable.child, 0); assert.equal(cell('fam-big@d3', 'two').oracle.child, 1);
  assert.equal(cell('fam-wide@d3').deployable.child, 1);
  assert.deepEqual(cell('fam-big@d3').tokens, [50000, 50000]);
  const task = c => r.tasks.find(x => x.cell === c);
  assert.deepEqual(task('fam-big@d3'), { cell: 'fam-big@d3', tasks: 2, big: 2, deployableChild: 1, oracleChild: 1 });
  assert.deepEqual(r.sizeOnly.map(c => [c.cell, c.tasks, c.big]), [['need-r0pad@d2', 2, 0], ['need-r0pad@d3', 2, 0]]);
  assert.deepEqual([r.h5.rows, r.h5.deployableChild, r.h5.oracleChild, r.h5.limit, r.h5.verdict], [2, 0, 0, H5_LIMIT, 'pass']);
  assert.deepEqual(r.h5.sizeOnly, [{ cell: 'need-r0pad@d2', tasks: 2, big: 0, s2Possible: false }, { cell: 'need-r0pad@d3', tasks: 2, big: 0, s2Possible: false }]);
  assert.deepEqual(r.notReplayable, [...NOT_REPLAYABLE]);
  // a big size-only control leaves H5 undetermined (S2 then rests on a probe the rows do not have); a control row that
  // would get a child fails it
  const bigPad = await replayLatentDemand({ rows: [row('wbed-r0', 1, { pass: true })], sizeOf: async k => (k.startsWith('need-r0pad') ? SIZES.big : SIZES.small), sizeOnly: [{ family: 'need-r0pad', difficulties: [3], seeds: [1] }] });
  assert.equal(bigPad.h5.verdict, 'undetermined'); assert.equal(bigPad.h5.sizeOnly[0].s2Possible, true);
  const bigR0 = await replayLatentDemand({ rows: [row('wbed-r0', 1, { error: { code: 'MODEL_TIMEOUT' } })], sizeOf: async () => SIZES.big });
  assert.equal(bigR0.h5.verdict, 'fail'); assert.equal(bigR0.h5.deployableShare, 1);
  assert.throws(() => parseSizeOnly('need-r0pad'), /expected/);
});

test('sizes: taskSizeOf counts bytes / 4 tokens and takes the longer of the longest list or table in the inputs and the file count; the bed sizer re-renders committed wbed-r0 rows at $0', async () => {
  assert.deepEqual(taskSizeOf({ prompt: '', inputs: { rows: [1, 2, 3] }, files: { a: 'x', b: 'y' } }), { tokens: 5, units: 3 }, '19 bytes');
  assert.equal(taskSizeOf({ prompt: '', inputs: { a: { b: [[1, 2, 3, 4]] } }, files: {} }).units, 4, 'the longest list at any depth');
  assert.equal(taskSizeOf({ prompt: '', inputs: {}, files: { a: 'x', b: 'y' } }).units, 2);
  const table = 'id,name,amount\n' + Array.from({ length: 40 }, (_, i) => `${i},n${i},${i * 3}`).join('\n');
  assert.equal(taskSizeOf({ prompt: '', inputs: { ledger: table }, files: {} }).units, 41, 'table lines in the inputs are units (as shapeOf counts them, header included)');
  assert.equal(taskSizeOf({ prompt: '', inputs: {}, files: { 'archive/a.csv': table } }).units, 1, 'a table inside a file is that file\'s content');
  const rows = readFileSync(path.join(ROOT, 'research/need-router-20261014/runs/m1/results.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(x => x.family === 'wbed-r0');
  assert.equal(rows.length, 24);
  const r = await replayLatentDemand({ rows, sizeOf: bedSizer() });
  assert.equal(r.h5.rows, 24); assert.equal(r.h5.deployableChild, 0); assert.equal(r.h5.oracleChild, 0);
  assert.ok(r.cells.every(c => c.big === 0 && c.tokens[1] < 30000));
});
