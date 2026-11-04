// The frozen analysis (experiments/swarm/analyze-r1.mjs) on a synthetic live directory: three arms on two dev tasks, the
// answers taken from the reference and from bed controls, so every number is known in advance.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import * as bed from '../../../beds/wbed/r6/index.mjs';
import { makeTasks } from '../../lib/beds.mjs';
import { analyze, ARMS } from '../analyze-r1.mjs';
import { truthOf } from '../rootcause.mjs';

test('analysis: pass counts, complete blocks only, coordination codes and fault sides from the archive', async t => {
  const live = mkdtempSync(path.join(os.tmpdir(), 'swarm-an-')); t.after(() => rmSync(live, { recursive: true, force: true }));
  const tasks = await makeTasks('wbed-r6', { split: 'dev', seeds: [305, 306], difficulty: 5 });
  const rows = [];
  const put = (arm, tk, answer, extra = {}) => {
    const v = bed.oracle(tk.task, answer);
    rows.push({ experiment: 'x', arm, taskKey: tk.taskKey, trial: 0, pass: v.pass, score: v.score, costUsd: 0.1, latencyMs: 60000, error: null, meta: extra.meta ?? {}, oracleDetails: JSON.stringify(v.details) });
    const dir = path.join(live, 'archive', arm, `${tk.taskKey.replaceAll(':', '_')}_t0`); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'answer.json'), JSON.stringify(answer));
    if (extra.tree) writeFileSync(path.join(dir, 'tree.json'), JSON.stringify(extra.tree));
    writeFileSync(path.join(dir, 'transcript.jsonl.gz'), gzipSync(''));
  };
  const alias = bed.badControls.find(c => c.name === 'scope-alias-missed'), lost = bed.badControls.find(c => c.name === 'reduce-lost-item');
  for (const tk of tasks) {
    const ref = bed.referenceSolve(tk.task), tr = truthOf(tk.task);
    put(ARMS.A, tk, alias.make(tk.task));
    // the swarm: one worker per compound returning the reference rows; the lead lost one item (K5)
    const workers = [...tr.inScope].map((c, i) => ({ id: `w${i}`, brief: `resolve ${c}`, result: 'x', report: JSON.stringify(ref.table.filter(r => tr.resolve(r.entity) === c)), writes: [] }));
    put(ARMS.S, tk, lost.make(tk.task), { tree: { workers, batches: [], lead: {} }, meta: { workers: workers.length, criticalSteps: 9 } });
    put(ARMS.W, tk, ref);
  }
  rows.pop();   // the second task's W row is missing: that block is incomplete
  mkdirSync(path.join(live, 'calibrate'));
  writeFileSync(path.join(live, 'calibrate/results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const res = await analyze({ live, stage: 'calibrate' });
  assert.equal(res.tasks, 1); assert.deepEqual(res.incomplete, [tasks[1].taskKey]);
  assert.equal(res.gradeConsistent, true, 'the decidability witness agrees with the grader on these tasks');
  assert.equal(res.table[ARMS.W].pass, 1); assert.equal(res.table[ARMS.A].pass, 0); assert.equal(res.table[ARMS.S].pass, 0);
  assert.equal(res.table[ARMS.S].workers.coord.K5, 1, 'the lost item is an aggregation loss');
  const s = res.anatomy.find(x => x.arm === ARMS.S);
  assert.equal(s.replays.carried.pass, true, 'carrying the workers\' rows would have passed');
  assert.ok(Object.keys(s.sides).some(k => k.startsWith('harness:coordination:K5')), JSON.stringify(s.sides));
  const a = res.anatomy.find(x => x.arm === ARMS.A);
  assert.ok(Object.keys(a.traps).some(k => /^alias:|^affil:/.test(k)), JSON.stringify(a.traps));
  assert.ok(Object.keys(a.sides).every(k => k.startsWith('model:search')), 'no transcript: nothing was seen, so search');
  assert.equal(res.comparisons.length, 3);
});
