import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRollup } from '../evals/mcp-tui.mjs';
import { digest } from '../src/data.mjs';
import { hashBytes } from '../evals/evidence.mjs';

// Synthetic negative oracle controls, never model generations.
const bytes = '{"count":2,"total":7}\n';
function evidence(status = 'succeeded', artifact = true) {
  const bodies = artifact ? [
    { type: 'tool.intent', tool: 'core.artifact', nodeKey: 'root/artifact' },
    { type: 'node.completed', nodeKey: 'root/artifact', output: { name: 'totals.json', sha256: hashBytes(bytes), bytes: Buffer.byteLength(bytes) } },
  ] : [{ type: 'run.failed' }];
  let previousHash = null;
  const events = bodies.map((body, index) => {
    const value = { seq: index + 1, at: 1, previousHash, ...body };
    const hash = digest(value); previousHash = hash; return { ...value, hash };
  });
  return { status, workflowHash: 'actual-workflow', events, eventHead: { seq: events.length, hash: previousHash } };
}
test('MCP artifact oracle accepts reordered JSON with real matching event receipt', () => {
  assert.equal(inspectRollup({ run: evidence(), artifactBytes: bytes, expected: { total: 7, count: 2 }, workflowHash: 'actual-workflow' }).passed, true);
});
test('MCP oracle rejects self-attestation, mismatched bytes, wrong workflow and truncated/corrupt events', () => {
  const inspect = (run, artifactBytes = bytes, workflowHash = 'actual-workflow') => inspectRollup({ run, artifactBytes, expected: { total: 7, count: 2 }, workflowHash });
  assert.equal(inspect({ status: 'succeeded' }).passed, false);
  assert.equal(inspect(evidence(), '{"total":21,"count":3}').passed, false);
  assert.equal(inspect(evidence(), bytes, 'different-workflow').passed, false);
  const truncated = evidence(); truncated.events.pop(); assert.equal(inspect(truncated).passed, false);
  const corrupt = evidence(); corrupt.events[0].tool = 'core.identity'; assert.equal(inspect(corrupt).passed, false);
});
test('MCP invalid-input oracle requires failure and no actual artifact completion', () => {
  assert.equal(inspectRollup({ run: evidence('failed', false), expected: null, workflowHash: 'actual-workflow' }).passed, true);
  assert.equal(inspectRollup({ run: evidence('failed', true), expected: null, workflowHash: 'actual-workflow' }).passed, false);
  assert.equal(inspectRollup({ run: evidence('succeeded', false), expected: null, workflowHash: 'actual-workflow' }).passed, false);
});
