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

// Review fix M5 (2026-11-04): the void rules on flagged trials, through the archived transcripts (the test above never
// reaches the audit: its rows carry no hidden-path attempt).
test('analysis: every trial flagged — frozen rule leaves 0 blocks without throwing; Amendment 2 voids a real reach, keeps scratch', async t => {
  const live = mkdtempSync(path.join(os.tmpdir(), 'swarm-an2-')); t.after(() => rmSync(live, { recursive: true, force: true }));
  const tasks = await makeTasks('wbed-r6', { split: 'dev', seeds: [305, 306], difficulty: 5 });
  const rows = [];
  const wd = (arm, tk) => `/var/tmp/foundry-work/x/work/${arm}/${tk.taskKey.replaceAll(':', '_')}_t0`;
  const bash = command => ({ type: 'tool_use', id: `t${Math.random()}`, name: 'Bash', input: { command } });
  const put = (arm, tk, answer, uses) => {
    const v = bed.oracle(tk.task, answer);
    rows.push({ experiment: 'x', arm, taskKey: tk.taskKey, trial: 0, pass: v.pass, score: v.score, costUsd: 0.1, latencyMs: 60000, error: null,
      meta: { hiddenPathAttempts: 1 }, oracleDetails: JSON.stringify(v.details) });
    const dir = path.join(live, 'archive', arm, `${tk.taskKey.replaceAll(':', '_')}_t0`); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'answer.json'), JSON.stringify(answer));
    const events = [{ type: 'system', subtype: 'init', cwd: wd(arm, tk) }, { type: 'assistant', message: { id: 'm1', content: uses } }];
    writeFileSync(path.join(dir, 'transcript.jsonl.gz'), gzipSync(events.map(e => JSON.stringify(e)).join('\n')));
  };
  for (const tk of tasks) {
    const ref = bed.referenceSolve(tk.task);
    // A: an arrow inside a quoted string (the old writesOf read it as `> ""`), then another session's answer and a host file
    put(ARMS.A, tk, ref, [bash('grep -c -- "->" out.txt; python3 -c \'print("a ->", 1)\' > \'\''),
      bash(`cat /var/tmp/foundry-work/x/work/${ARMS.S}/${tk.taskKey.replaceAll(':', '_')}_t0/answer.json`), { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: '/etc/passwd' } }]);
    // S: scratch it wrote itself under /var/tmp, then read back
    put(ARMS.S, tk, ref, [bash('mkdir -p /var/tmp/s && python3 x.py > /var/tmp/s/hits.txt'), bash('wc -l /var/tmp/s/hits.txt')]);
    put(ARMS.W, tk, ref, [bash('mkdir -p /var/tmp/w && echo 1 > /var/tmp/w/a.txt'), bash('cat /var/tmp/w/a.txt')]);
  }
  mkdirSync(path.join(live, 'calibrate'));
  writeFileSync(path.join(live, 'calibrate/results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const frozen = await analyze({ live, stage: 'calibrate', rule: 'frozen' });
  assert.equal(frozen.tasks, 0); assert.deepEqual(frozen.table, {}); assert.deepEqual(frozen.comparisons, []);
  assert.equal(frozen.rules.frozen.voids, 6); assert.equal(frozen.rules.frozen.completeBlocks, 0);
  const a2 = await analyze({ live, stage: 'calibrate', rule: 'a2' });
  assert.equal(a2.tasks, 0, 'every A trial reached outside: no complete block');
  assert.deepEqual(a2.rules.a2.voidTrials.sort(), tasks.map(tk => `${ARMS.A}|${tk.taskKey}`).sort(), 'only the A trials are void');
  for (const v of a2.voids) assert.equal(v.other.length, 2, JSON.stringify(v));
  assert.equal(a2.rules.flaggedPaths.a2['self-created'], 8, JSON.stringify(a2.rules.flaggedPaths));
  // without the A arm's reach, scratch alone voids nothing and the blocks are complete
  writeFileSync(path.join(live, 'calibrate/results.jsonl'), rows.filter(r => r.arm !== ARMS.A).map(r => JSON.stringify(r)).join('\n') + '\n');
  const ok = await analyze({ live, stage: 'calibrate', rule: 'a2' });
  assert.equal(ok.tasks, 2); assert.equal(ok.rules.a2.voids, 0); assert.equal(ok.rules.frozen.completeBlocks, 0);
  assert.equal(ok.anatomyAll.length, 4); assert.ok(ok.anatomyAll.every(x => x.inComparison));
});

test('analysis: a flagged trial whose transcript cannot be audited stays void (the frozen verdict)', async t => {
  const live = mkdtempSync(path.join(os.tmpdir(), 'swarm-an3-')); t.after(() => rmSync(live, { recursive: true, force: true }));
  const [tk] = await makeTasks('wbed-r6', { split: 'dev', seeds: [305], difficulty: 5 });
  const ref = bed.referenceSolve(tk.task), v = bed.oracle(tk.task, ref);
  const rows = [ARMS.A, ARMS.S, ARMS.W].map(arm => ({ arm, taskKey: tk.taskKey, trial: 0, pass: v.pass, score: v.score, costUsd: 0.1, latencyMs: 1000, error: null,
    meta: { hiddenPathAttempts: arm === ARMS.A ? 1 : 0 }, oracleDetails: JSON.stringify(v.details) }));
  for (const r of rows) { const dir = path.join(live, 'archive', r.arm, `${tk.taskKey.replaceAll(':', '_')}_t0`); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, 'answer.json'), JSON.stringify(ref)); }
  mkdirSync(path.join(live, 'calibrate'));
  writeFileSync(path.join(live, 'calibrate/results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const res = await analyze({ live, stage: 'calibrate', rule: 'a3' });
  assert.equal(res.tasks, 0); assert.equal(res.voids[0].arm, ARMS.A);
});
