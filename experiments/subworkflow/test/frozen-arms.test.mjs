// $0 regression: the SW-1 and SW-1b arms see exactly the model-facing text they saw in the frozen runs. node.mjs changed
// after SW-1b (the SW-1c arms, proposal provenance), so its sha256 no longer equals the PREREG-SW-1 / PREREG-SW-1b pins;
// this test is the evidence that the change is additive. Each frozen arm is driven through every prompt it can send
// (decide or request, every build or fill round with feedback, the open stage, the fallback) on a scripted port whose
// replies never pass the static checks, so nothing reaches the sandbox; every call's (nodeKey, system, prompt, schema,
// decoding, modelId) is hashed in order. The expected digests were recorded from commit 9b3e9590 (the code that ran
// eval-1's launch 3 and SW-1b) before node.mjs was edited. PRINT_DIGESTS=1 prints the current digests instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runNode } from '../node.mjs';
import { canonicalJson } from '../dsl.mjs';
import { bed, backlogChannels, nodeInput } from './fixtures.mjs';

const task = bed.generate({ seed: 4242, split: 'dev', difficulty: 3 });
const [ch] = backlogChannels(task);
const input = nodeInput(task, ch.name);
const truth = bed.nodeTruth(task, ch.name);
const BAD_SPEC = { name: 'x', steps: [], output: '$x', models: [], budgetUsd: 0.01 };
const REQUEST = { goal: 'intake of the export', inputs: ['export', 'notes', 'spec', 'channel'], returns: 'the intake answer', budgetUsd: 0.03 };
const SCRIPT = {
  '.answer': truth, '.fallback': truth,
  '.decide': { decision: 'subworkflow', reason: 'many rows' },
  '.decide.gov': { decision: 'subworkflow', reason: 'many rows', request: REQUEST },
  '.request': { reason: 'directed', request: REQUEST },
  '.build.r': BAD_SPEC, '.builder.open.r': BAD_SPEC,
  '.tpl.select': { template: 'legacy-export-intake', reason: 'fits', notCovered: [] },
  '.builder.select': { template: 'legacy-export-intake', reason: 'fits', notCovered: ['write corrected typos back'] },
  '.tpl.fill.r': { slots: {}, assumptions: [] }, '.builder.fill.r': { slots: {}, assumptions: [] },
};
function recordingPort(governing) {
  const log = [];
  return {
    log,
    async call(req) {
      log.push(canonicalJson({ nodeKey: req.nodeKey, attempt: req.attempt, modelId: req.modelId, system: req.system, prompt: req.prompt, schema: req.schema, decoding: req.decoding }));
      const k = req.nodeKey.slice(ch.name.length);
      const key = k === '.decide' && governing ? '.decide.gov' : Object.keys(SCRIPT).find(s => k === s || (s.endsWith('.r') && new RegExp(`^${s.replace(/\./g, '\\.')}\\d+$`).test(k)));
      if (!key) return { ok: false, costUsd: 0.001, error: { code: 'MODEL_PROTOCOL', message: `no script for ${k}` } };
      return { ok: true, costUsd: 0.002, value: structuredClone(SCRIPT[key]) };
    },
  };
}
export async function armDigest(arm) {
  const p = recordingPort(['A2', 'A2O'].includes(arm));
  const r = await runNode({ port: p, arm, input, runId: `frozen-${arm}`, answerSchema: bed.nodeOutputSchema });
  return { digest: createHash('sha256').update(p.log.join('\n')).digest('hex').slice(0, 16), calls: p.log.length, path: r.path };
}

// Recorded at 9b3e9590 (pre-SW-1c node.mjs). calls = model calls the scripted node made; path = how it ended.
const EXPECTED = {
  A0: { digest: 'b5cc00fd7bf053cd', calls: 1, path: 'direct' },
  A1: { digest: '86ee5d374c7fa4ec', calls: 6, path: 'fallback' },
  A1T: { digest: '342fbde2949e143e', calls: 7, path: 'fallback' },
  A2: { digest: '054d202900cf1edf', calls: 7, path: 'fallback' },
  A1F: { digest: '084ee983e2628f06', calls: 5, path: 'fallback' },
  A1TF: { digest: 'ef456cb69a23d76b', calls: 6, path: 'fallback' },
  A2F: { digest: '6ff06d38c634203e', calls: 7, path: 'fallback' },
  A2O: { digest: '048ea0af272a416b', calls: 11, path: 'fallback' },
  A2OF: { digest: '34edf636f31d6060', calls: 11, path: 'fallback' },
};

test('the SW-1 and SW-1b arms send byte-identical model calls (prompts, schemas, decoding, keys) to the frozen code', async () => {
  const got = {};
  for (const arm of Object.keys(EXPECTED)) got[arm] = await armDigest(arm);
  if (process.env.PRINT_DIGESTS) { console.log(JSON.stringify(got, null, 1)); return; }
  assert.deepEqual(got, EXPECTED);
});
