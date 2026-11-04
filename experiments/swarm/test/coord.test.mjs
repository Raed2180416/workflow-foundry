// Coordination-failure coder (experiments/swarm/coord.mjs): synthetic swarms built from the bed's own truth, one injected
// coordination fault per case; each code must fire on its fault and stay silent on the clean swarm.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as bed from '../../../beds/wbed/r6/index.mjs';
import { truthOf } from '../rootcause.mjs';
import { codeSession, replays, jsonValuesIn, rowsIn, briefDocs, CODES } from '../coord.mjs';

const task = bed.generate({ seed: 304, split: 'dev', difficulty: 5 });
const t = truthOf(task);
const ref = bed.referenceSolve(task);
const codes = [...t.inScope].sort();
const rowsOf = code => ref.table.filter(r => t.resolve(r.entity) === code);
// one worker per in-scope compound, briefed by code, returning its rows as JSON in a fenced block
function cleanSwarm() {
  const workers = codes.map((c, i) => ({ id: `w${i}`, brief: `Objective: resolve compound ${c}. Return JSON rows.`, report: 'Done.\n```json\n' + JSON.stringify({ rows: rowsOf(c) }) + '\n```',
    result: 'x', writes: [`work/w${i}/rows.json`], isError: false, resultMeta: { status: 'completed' } }));
  return { workers, batches: [{ index: 0, workers: workers.map(w => w.id) }], lead: { turns: 3 } };
}
const on = r => CODES.filter(k => r.codes[k]);

test('a clean swarm (one worker per compound, rows carried) raises no coordination code', () => {
  const r = codeSession({ task, tree: cleanSwarm(), output: ref });
  assert.deepEqual(on(r), []);
  assert.equal(r.detail.workers, codes.length);
});

test('K1 serial collapse and K2 over-fan-out', () => {
  const one = cleanSwarm(); one.workers = one.workers.slice(0, 1);
  assert.ok(codeSession({ task, tree: one, output: ref }).codes.K1);
  const many = cleanSwarm(); while (many.workers.length <= 33) many.workers.push({ ...many.workers[0], id: `x${many.workers.length}`, writes: [] });
  assert.ok(codeSession({ task, tree: many, output: ref }).codes.K2);
});

test('K3 plan gap: a compound no brief names, no worker returns and the lead never saw; not when a brief assigns its document range', () => {
  const sw = cleanSwarm(), gone = codes[2];
  sw.workers = sw.workers.filter(w => !w.brief.includes(gone));
  const out = { ...ref, table: ref.table.filter(r => t.resolve(r.entity) !== gone) };
  const r = codeSession({ task, tree: sw, output: out });
  assert.ok(r.codes.K3); assert.deepEqual(r.detail.planGap, [gone]);
  // the same omission when one worker was assigned the document holding its establishing test: not a plan gap
  const est = t.establishing.get(gone)[0];
  sw.workers.push({ id: 'range', brief: `Read documents ${est}-${est} and report every compound lab X tested`, report: 'nothing found', result: 'x', writes: [] });
  assert.equal(codeSession({ task, tree: sw, output: out }).codes.K3, false);
});

test('K4 duplicate assignment and K8 write collision / a worker writing answer.json', () => {
  const sw = cleanSwarm();
  sw.workers[1] = { ...sw.workers[1], brief: sw.workers[1].brief + ` Also check ${codes[0]}.` };
  assert.ok(codeSession({ task, tree: sw, output: ref }).codes.K4);
  const c = cleanSwarm(); c.workers[1].writes = [...c.workers[0].writes];
  assert.ok(codeSession({ task, tree: c, output: ref }).codes.K8);
  const a = cleanSwarm(); a.workers[0].writes = ['./answer.json'];
  assert.ok(codeSession({ task, tree: a, output: ref }).codes.K8);
});

test('K5 aggregation loss: the worker had the right row, the answer dropped it; the carried replay recovers the pass', () => {
  const victim = codes[0];
  const out = { ...ref, table: ref.table.filter(r => t.resolve(r.entity) !== victim) };
  const r = codeSession({ task, tree: cleanSwarm(), output: out });
  assert.ok(r.codes.K5); assert.equal(r.codes.K3, false);
  assert.equal(r.detail.aggregationLoss.length, rowsOf(victim).length);
  const rp = replays({ task, tree: cleanSwarm(), output: out, bed });
  assert.equal(rp.carried.pass, true);
});

test('K6 worker error propagated, K7 conflict resolved wrongly', () => {
  const sw = cleanSwarm(), bad = structuredClone(rowsOf(codes[1])[0]);
  bad.value += 1000;
  sw.workers[1].report = '```json\n' + JSON.stringify([bad, ...rowsOf(codes[1]).slice(1)]) + '\n```';
  const out = structuredClone(ref);
  const i = out.table.findIndex(r => t.resolve(r.entity) === codes[1] && r.property === bad.property);
  out.table[i] = bad;
  const r6 = codeSession({ task, tree: sw, output: out });
  assert.ok(r6.codes.K6); assert.equal(r6.codes.K7, false);
  // a second worker had the right row: now it is a conflict resolved wrongly
  sw.workers.push({ id: 'second', brief: `Double-check ${codes[1]}`, report: JSON.stringify(rowsOf(codes[1])), result: 'x', writes: [] });
  const r7 = codeSession({ task, tree: sw, output: out });
  assert.ok(r7.codes.K7);
});

test('K9 limits, K10 premature termination, K11 drift', () => {
  assert.ok(codeSession({ task, tree: cleanSwarm(), output: ref, stats: { refused: { concurrency_limit: 1 } } }).codes.K9);
  assert.ok(codeSession({ task, tree: cleanSwarm(), output: ref, error: { code: 'EXECUTOR_TIMEOUT' } }).codes.K9);
  const u = cleanSwarm(); u.workers[0].result = null;
  assert.ok(codeSession({ task, tree: u, output: ref }).codes.K10);
  assert.ok(codeSession({ task, tree: cleanSwarm(), output: null }).codes.K10);
  assert.ok(codeSession({ task, tree: cleanSwarm(), output: ref, drift: ['claude-opus-5-5'] }).codes.K11);
});

test('rows are read from reports and worker files in the shapes workers use', () => {
  assert.deepEqual(jsonValuesIn('text {"a":1} more [1,2] end'), [{ a: 1 }, [1, 2]]);
  assert.deepEqual(jsonValuesIn('```json\n{"x": 2}\n```'), [{ x: 2 }]);
  const props = ['ic50', 'pka'];
  const rows = rowsIn({ compound: 'VX-1', in_scope: true, cells: { ic50: { value: 3, source: 'D001' }, pka: { value: 4.5, source_doc_id: 'D002' } } }, props);
  assert.deepEqual(rows, [{ entity: 'VX-1', property: 'ic50', value: 3, source_doc_id: 'D001' }, { entity: 'VX-1', property: 'pka', value: 4.5, source_doc_id: 'D002' }]);
  assert.equal(rowsIn([{ entity: 'a', property: 'pka', value: 'n/a' }], props).length, 0, 'a non-number is not a row');
  // a worker that wrote its rows to a file and returned only a pointer still counts
  const sw = cleanSwarm();
  sw.workers[0].report = 'rows written to work/w0/rows.json';
  const victim = codes[0];
  const out = { ...ref, table: ref.table.filter(r => t.resolve(r.entity) !== victim) };
  const r = codeSession({ task, tree: sw, output: out, workFiles: { 'work/w0/rows.json': JSON.stringify(rowsOf(victim)) } });
  assert.ok(r.codes.K5);
});

test('briefDocs reads ranges, lists and globs', () => {
  assert.deepEqual([...briefDocs('Read D001-D003 and D010')].sort(), ['D001', 'D002', 'D003', 'D010']);
  assert.equal(briefDocs('documents 1 to 50').size, 50);
  assert.equal(briefDocs('files/corpus/D1*.txt').size, 100);
  assert.equal(briefDocs('no ids here').size, 0);
});

// Review minor 4 (2026-11-04): K8 must not fire on the fake write targets the old writesOf returned for quoted arrows and
// empty redirections (two workers that each ran `grep -c -- "->" …` both "wrote" "").
test('K8 stays silent when workers only print arrows or redirect to an empty name', async () => {
  const { writesOf } = await import('../spawn-tree.mjs');
  const sw = cleanSwarm();
  for (const w of sw.workers) w.writes = [...writesOf({ name: 'Bash', input: { command: 'grep -c -- "->" files/corpus/D001.txt; python3 x.py > \'\'' } })];
  const r = codeSession({ task, tree: sw, output: ref });
  assert.equal(r.codes.K8, false, JSON.stringify(r.detail.collisions));
});
