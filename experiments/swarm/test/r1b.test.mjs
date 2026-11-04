// Rung 1b (exploratory, PREREG-SWARM-R1 Amendment 1): arm S-F is arm S with only the fan-out rule added; the k rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import * as bed from '../../../beds/wbed/r6/index.mjs';
import { swarmArm, LEAD_PREAMBLE } from '../arms.mjs';
import { fanoutArm, PREAMBLE_F, FANOUT_RULE, kOf } from '../run-r1b.mjs';

const task = bed.generate({ seed: 368, split: 'dev', difficulty: 3 });
const stub = { ok: true, error: null, costUsd: 0.01, costUnknown: false, costUpperUsd: 0.01, turns: 1, toolUses: [], usage: null, streamUsage: null, sessionId: 's', durationMs: 5, transcript: null };

test('S-F differs from S only by the fan-out rule appended to the preamble', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'swarm-r1b-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const executor = async a => { calls.push(a); return stub; };
  const S = swarmArm({ budgetUsd: 1, timeoutMs: 1000, executor }), F = fanoutArm({ budgetUsd: 1, timeoutMs: 1000, executor });
  for (const arm of [S, F]) { const wd = path.join(dir, arm.id); mkdirSync(wd); await arm.run({ task, outputSchema: bed.outputSchema, workdir: wd, taskKey: 'k', trial: 0 }); }
  const [s, f] = calls;
  assert.equal(f.prompt, s.prompt + '\n\n' + FANOUT_RULE);
  assert.equal(PREAMBLE_F, LEAD_PREAMBLE + '\n\n' + FANOUT_RULE);
  for (const k of ['model', 'budgetUsd', 'timeoutMs']) assert.equal(f[k], s[k], k);
  for (const k of ['tools', 'env', 'extraArgs', 'files']) assert.deepEqual(f[k], s[k], k);
  for (const w of ['compound', 'lab', 'corpus', 'document', 'coverage', 'verify']) assert.ok(!FANOUT_RULE.toLowerCase().includes(w), w);
});

test('k rule: at most 4, at most the complete blocks, and within the cap', () => {
  assert.equal(kOf({ spent: 6.5, sMaxUsd: 0.36, complete: 6 }), Math.floor((8 - 6.5 - 0.2) / (1.25 * 0.36)));
  assert.equal(kOf({ spent: 1, sMaxUsd: 0.1, complete: 6 }), 4);
  assert.equal(kOf({ spent: 1, sMaxUsd: 0.1, complete: 2 }), 2);
  assert.equal(kOf({ spent: 7.9, sMaxUsd: 0.3, complete: 6 }), 0);
});
