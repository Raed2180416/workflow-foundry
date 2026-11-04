// PREREG-NODECAP-1-AMEND-1 runner and analysis: the K-replicate order, resume after an environment-fault abort, the rules in task units,
// the cost decomposition, the manifest check and the per-episode journal archive. $0, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { orderFor, resumeState, owedReruns, slotKey, manifestMismatches, AMEND1, ORDER } from '../experiments/nodecap/bed/run-model.mjs';
import { analyzeK, costDecomposition, decisions, armTable } from '../experiments/nodecap/bed/analyze.mjs';
import { TASKS } from '../experiments/nodecap/bed/tasks.mjs';

test('amend1 order: replicate 1 is the NC-1 rotation over U, A, C, B; replicate 2 shifts every arm by two positions', () => {
  const order = orderFor({ arms: AMEND1.arms, k: AMEND1.k });
  assert.equal(order.length, 96);
  assert.equal(new Set(order.map(slotKey)).size, 96);
  // The NC-1 order of the frozen run (before arm S existed): within task i, U, A, C, B rotated left by i mod 4.
  const nc1 = TASKS.flatMap((t, i) => ['U', 'A', 'C', 'B'].map((_, j) => ({ task: t.id, arm: ['U', 'A', 'C', 'B'][(i + j) % 4] })));
  assert.deepEqual(order.slice(0, 48).map(s => `${s.task}${s.arm}`), nc1.map(s => `${s.task}${s.arm}`));
  for (let i = 0; i < 48; i += 4) {
    const r1 = order.slice(i, i + 4).map(s => s.arm), r2 = order.slice(48 + i, 52 + i).map(s => s.arm);
    assert.deepEqual(r2, [...r1.slice(2), ...r1.slice(0, 2)]);
    assert.ok(r1.every((a, j) => r2[j] !== a), 'every arm sits in another position in replicate 2');
  }
  assert.ok(ORDER.some(s => s.arm === 'S'), 'the scripted-bed order (five arms) is unchanged');
});

test('resume keeps every episode that ran, re-runs only the aborted slots, and owes one re-run per environment-fault original', () => {
  const rows = [
    { task: 'T01', arm: 'U', rep: 1, attempt: 1, success: true, cost: { usd: 0.001 } },
    { task: 'T01', arm: 'A', rep: 1, attempt: 1, success: false, error: 'MODEL_TIMEOUT', cost: { usd: 0.002, unknownUpperUsd: 0.05 } },
    { task: 'T01', arm: 'C', rep: 1, attempt: 1, success: false, error: 'MODEL_RATE_LIMIT', cost: { usd: 0 } },
    { task: 'T01', arm: 'B', rep: 1, attempt: 1, success: false, error: 'MODEL_RATE_LIMIT', cost: { usd: 0 } },
    { task: 'T02', arm: 'A', rep: 1, kind: 'competent', notRun: 'aborted after 3 consecutive environment faults' },
    { task: 'T02', arm: 'C', rep: 1, attempt: 1, notRun: 'harness error: X boom' }];
  const state = resumeState(rows);
  assert.equal(state.rows.length, 5);
  assert.ok(!state.done.has('T02|A|1') && state.done.has('T02|C|1') && state.done.has('T01|U|1'));
  assert.ok(Math.abs(state.spent - 0.053) < 1e-12, 'unknown spend counts at its bound');
  assert.deepEqual(owedReruns(state.rows).map(slotKey), ['T01|A|1', 'T01|C|1', 'T01|B|1']);
  const after = [...state.rows, { task: 'T01', arm: 'A', rep: 1, attempt: 2, success: true }];
  assert.deepEqual(owedReruns(after).map(slotKey), ['T01|C|1', 'T01|B|1'], 'a slot already re-run is never re-run again');
});

const row = (task, arm, rep, success, extra = {}) => ({ task, arm, rep, success, status: success ? 'succeeded' : 'failed', error: success ? null : 'NODE_STUCK', used: [], turns: 2,
  promptTokens: 100, toolDefTokens: arm === 'B' ? 2000 : 40, exposed: 3, observed: { attempted: 0, blocked: 0, executed: 0, classes: {}, poisonShown: [], injectedSeen: false }, approvals: { asked: 0 },
  proposals: [], grants: [], cost: { usd: arm === 'B' ? 0.004 : 0.002, calls: 2, inputTokens: 10, outputTokens: 100, cacheReadTokens: 1000, cacheWriteTokens: 500 },
  calls: [0, 1].map(() => ({ inputTokens: 5, outputTokens: 50, cacheReadTokens: 500, cacheWriteTokens: 250, costUsd: arm === 'B' ? 0.002 : 0.001, latencyMs: 10, outputChars: 80 })),
  toolTextPerCallTokens: [arm === 'B' ? 2000 : 40, arm === 'B' ? 2000 : 40], ...extra });

test('analyzeK applies the frozen rules verbatim in task units, and reports each replicate alone', () => {
  const ids = TASKS.map(t => t.id), rows = [];
  // U solves 8 in both replicates; A 7 then 6 (6.5 tasks); C 2 then 3 (2.5); B 8 then 7 (7.5).
  const solves = { U: [8, 8], A: [7, 6], C: [2, 3], B: [8, 7] };
  for (const rep of [1, 2]) for (const [arm, ks] of Object.entries(solves)) ids.forEach((id, i) => rows.push(row(id, arm, rep, i < ks[rep - 1])));
  const k = analyzeK(rows, { k: 2, arms: ['U', 'A', 'C', 'B'] });
  assert.deepEqual(k.successTasks, { U: 8, A: 6.5, C: 2.5, B: 7.5 });
  assert.equal(k.decisions.R1_acquisitionAddsCapability.value, 4); assert.equal(k.decisions.R1_acquisitionAddsCapability.met, true);
  assert.equal(k.decisions.R2_costRule.successGap, -1); assert.equal(k.decisions.R2_costRule.met, true);
  assert.equal(k.decisions.R4_adaptiveNearPrebound.value, -1.5); assert.equal(k.decisions.R4_adaptiveNearPrebound.met, true);
  // Replicate 2 alone: A 6, B 7 (R2 met), A 6, C 3 (R1 met, at the boundary).
  assert.equal(k.replicates[1].decisions.R1_acquisitionAddsCapability.value, 3);
  assert.deepEqual(k.replicates[0].decisions, decisions(armTable(rows.filter(r => r.rep === 1))), 'each replicate uses the frozen decisions() unchanged');
  assert.equal(k.perTask.T01.A, '2/2'); assert.equal(k.perTask.T08.A, '0/2');
  // A superseded environment-fault original is left out; a final environment fault is counted (frozen) and reported apart.
  const extra = [...rows, row('T12', 'A', 1, false, { error: 'MODEL_TIMEOUT', superseded: true })];
  assert.equal(analyzeK(extra, { k: 2 }).episodes.A, 24);
  const fault = rows.map(r => r.task === 'T12' && r.arm === 'C' && r.rep === 1 ? { ...r, error: 'MODEL_TIMEOUT' } : r);
  assert.equal(analyzeK(fault, { k: 2 }).envExcluded.left, 1);
});

test('costDecomposition reproduces the reported spend and splits cost per success into a calls factor and a per-call factor', () => {
  const rows = [row('T01', 'A', 1, true), row('T02', 'A', 1, false), row('T01', 'B', 1, true), row('T02', 'B', 1, true)];
  const c = costDecomposition(rows);
  // Per call: 5 x 0.1 + 250 x 0.125 + 500 x 0.01 = 36.75e-6 input, 50 x 0.5 = 25e-6 output.
  assert.ok(Math.abs(c.A.inputUsd - 4 * 36.75e-6) < 1e-9 && Math.abs(c.A.outputUsd - 4 * 25e-6) < 1e-9);
  assert.equal(c.A.callsPerSuccess, 4); assert.equal(c.B.callsPerSuccess, 2);
  assert.equal(c.AoverB.callsFactor, 2); assert.equal(c.AoverB.perCallFactor, 0.5); assert.equal(c.AoverB.costPerSuccess, 1);
  assert.ok(c.B.toolDefUsd.low < c.B.toolDefUsd.central && c.B.toolDefUsd.central < c.B.toolDefUsd.high);
  assert.equal(c.B.perCall.toolTextTokens, 2000);
});

test('the manifest check names every file whose hash changed or that is missing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nc1-manifest-'));
  try {
    writeFileSync(path.join(dir, 'a.txt'), 'alpha'); writeFileSync(path.join(dir, 'b.txt'), 'beta');
    const h = s => createHash('sha256').update(s).digest('hex');
    writeFileSync(path.join(dir, 'm.sha256'), `${h('alpha')}  a.txt\n${h('BETA')}  b.txt\n${h('x')}  c.txt\n`);
    assert.deepEqual(manifestMismatches(path.join(dir, 'm.sha256'), dir), ['b.txt', 'c.txt']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an archived episode keeps every model call with its prompt, schema and response, and no canary', async () => {
  const { runEpisode } = await import('../experiments/nodecap/bed/episode.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'nc1-archive-'));
  try {
    const r = await runEpisode({ task: TASKS.find(t => t.id === 'T01'), arm: 'A', archive: path.join(dir, 'T01-A-r1') });
    assert.equal(r.success, true);
    assert.equal(r.archive.calls, r.turns); assert.equal(r.archive.redactions, 0); assert.equal(r.canaryHits, 0);
    const lines = gunzipSync(readFileSync(path.join(dir, 'T01-A-r1.journal.jsonl.gz'))).toString('utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(lines.length, r.turns);
    assert.ok(typeof lines[0].system === 'string' && lines[0].system.includes('## Tool protocol (Foundry)'));
    assert.ok(lines.slice(1).every(l => l.systemSha256 === lines[0].systemSha256 && l.system === undefined), 'a repeated system prompt is written once');
    assert.ok(lines.every(l => typeof l.prompt === 'string' && l.response && 'value' in l.response));
    assert.ok(lines[0].schema?.properties?.action, 'the decision schema is kept');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
