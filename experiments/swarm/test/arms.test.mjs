// Swarm ladder arms (experiments/swarm/arms.mjs) and the paid runner's pure rules (run-r1.mjs): the swarm differs from the
// single agent only by the Agent tool, the subagent knobs and the lead preamble; the preamble is task-agnostic; drift is
// detected; the held-out N rule, the freeze diff and the global ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import * as bed from '../../../beds/wbed/r6/index.mjs';
import { agentArm, swarmArm, LEAD_PREAMBLE, SWARM_ENV, SWARM_TOOLS, SWARM_ARGS, driftOf, sessionFiles, MODEL } from '../arms.mjs';
import { DEFAULT_TOOLS } from '../../../src/executors/claude-code.mjs';
import { heldoutN, freezeDiff, spentSoFar, noArtifactArm, DESIGN } from '../run-r1.mjs';
import { armHash } from '../../lib/runner.mjs';

const task = bed.generate({ seed: 368, split: 'dev', difficulty: 3 });
const stubResult = { ok: true, error: null, costUsd: 0.01, costUnknown: false, costUpperUsd: 0.01, turns: 1, toolUses: [], usage: null, streamUsage: null, sessionId: 's', durationMs: 5, transcript: null };

test('the swarm session is the agent session plus Agent, the subagent knobs, forwarded subagent text and the preamble', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'swarm-arms-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const executor = async args => { calls.push(args); return stubResult; };
  const A = agentArm({ budgetUsd: 1, timeoutMs: 1000, executor }), S = swarmArm({ budgetUsd: 1, timeoutMs: 1000, executor });
  for (const arm of [A, S]) { const wd = path.join(dir, arm.id); mkdirSync(wd); await arm.run({ task, familyId: 'wbed-r6', outputSchema: bed.outputSchema, workdir: wd, taskKey: 'k', trial: 0 }); }
  const [a, s] = calls;
  assert.equal(a.model, MODEL); assert.equal(s.model, MODEL);
  assert.equal(s.prompt, a.prompt + '\n\n' + LEAD_PREAMBLE, 'the only prompt difference is the preamble');
  assert.deepEqual(a.tools ?? DEFAULT_TOOLS, DEFAULT_TOOLS);
  assert.deepEqual(s.tools, [...DEFAULT_TOOLS, 'Agent']); assert.deepEqual(SWARM_TOOLS, s.tools);
  assert.equal(s.env.CLAUDE_CODE_SUBAGENT_MODEL, MODEL); assert.equal(s.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE, '1');
  assert.equal(s.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '1'); assert.deepEqual(s.env, { ...SWARM_ENV });
  assert.deepEqual(s.extraArgs, [...SWARM_ARGS]); assert.equal(a.extraArgs, undefined);
  assert.equal(a.budgetUsd, s.budgetUsd); assert.equal(a.timeoutMs, s.timeoutMs);
  assert.deepEqual(Object.keys(s.files).sort(), Object.keys(a.files).sort(), 'the same task files');
  assert.notEqual(armHash(A), armHash(S));
});

test('the lead preamble is short and task-agnostic: no R6 word, no coverage-check instruction (rung 2 treatment)', () => {
  assert.ok(LEAD_PREAMBLE.split(/\s+/).length <= 150, `${LEAD_PREAMBLE.split(/\s+/).length} words`);
  for (const w of ['compound', 'lab', 'corpus', 'document', 'retract', 'coverage', 'register', 'property', 'scope', 'verify', 'check']) assert.ok(!LEAD_PREAMBLE.toLowerCase().includes(w), w);
});

test('driftOf: any model other than Haiku 5.5 in usage or messages is drift', () => {
  assert.deepEqual(driftOf({ modelUsage: { 'claude-haiku-5-5': {} }, messageModels: { 'claude-haiku-5-5': 3, '<synthetic>': 1 } }), []);
  assert.deepEqual(driftOf({ modelUsage: { 'claude-haiku-5-5': {}, 'claude-opus-5-5': {} } }), ['claude-opus-5-5']);
  assert.deepEqual(driftOf({ messageModels: { 'claude-sonnet-5-5': 1 } }), ['claude-sonnet-5-5']);
});

test('sessionFiles keeps what the session wrote (work/), never the task corpus or the answer, within its caps', t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'swarm-files-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'files/corpus'), { recursive: true }); mkdirSync(path.join(dir, 'work/w1'), { recursive: true });
  writeFileSync(path.join(dir, 'files/corpus/D001.txt'), 'doc'); writeFileSync(path.join(dir, 'answer.json'), '{}');
  writeFileSync(path.join(dir, 'work/w1/rows.json'), '[1]'); writeFileSync(path.join(dir, 'work/w1/big.txt'), 'x'.repeat(300 * 1024));
  assert.deepEqual(sessionFiles(dir), { 'work/w1/rows.json': '[1]' });
});

test('held-out N rule (§6.2), the no-artifact W arm, the freeze diff and the global ledger', async t => {
  assert.equal(heldoutN({ spent: 2, blockUsd: 0.5 }), Math.min(DESIGN.nMax, Math.floor((8 - 2 - 0.5) / (1.25 * 0.5))));
  assert.equal(heldoutN({ spent: 2, blockUsd: 0.05 }), DESIGN.nMax);
  assert.equal(heldoutN({ spent: 6, blockUsd: 1 }), 1);
  const w = noArtifactArm('W-workflow-haiku');
  const r = await w.run({});
  assert.equal(r.output, null); assert.equal(r.costUsd, 0); assert.equal(r.error.code, 'NO_ARTIFACT');
  assert.deepEqual(freezeDiff({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } }), []);
  assert.deepEqual(freezeDiff({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 3] }, d: 0 }), ['$.b.c.1', '$.d']);
  const live = mkdtempSync(path.join(os.tmpdir(), 'swarm-live-')); t.after(() => rmSync(live, { recursive: true, force: true }));
  assert.equal(spentSoFar(live), DESIGN.probeUsd);
  mkdirSync(path.join(live, 'build')); writeFileSync(path.join(live, 'build/construction.json'), JSON.stringify({ constructionCostUsd: 0.5 }));
  mkdirSync(path.join(live, 'calibrate'));
  writeFileSync(path.join(live, 'calibrate/results.jsonl'), JSON.stringify({ costUsd: 0.25 }) + '\n' + JSON.stringify({ costUsd: 0.25, imputedUsd: 0.1 }) + '\n');
  writeFileSync(path.join(live, 'calibrate/results.faults.jsonl'), JSON.stringify({ costUsd: 0.05 }) + '\n');
  assert.ok(Math.abs(spentSoFar(live) - (DESIGN.probeUsd + 0.5 + 0.6 + 0.05)) < 1e-9, 'faulted trials are paid for too');
});
