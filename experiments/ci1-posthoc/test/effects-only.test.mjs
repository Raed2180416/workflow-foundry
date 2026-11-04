// effects-only diagnostic (post hoc): it selects only builds stopped by their own self-check, keeps every node, and its rewrite still
// passes the strict CI-1 validator; a missing reference read by a node argument is not excused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selfCheckFailure, withoutAcceptance } from '../effects-only.mjs';
import { validateCi1 } from '../../ci1/foundry-world.mjs';

const wf = { schemaVersion: '1.0', id: 'fx', version: 1, title: 'fixture', goal: 'fixture', domain: 'general',
  envelope: { assumptions: [], risks: [], successCriteria: ['x'] }, inputSchema: { type: 'object', additionalProperties: false, required: ['now'], properties: { now: { type: 'string' } } },
  budget: { maxSteps: 5, maxConcurrency: 1, maxDurationMs: 60000, maxCost: 0 },
  nodes: [
    { id: 'a', kind: 'task', needs: [], description: 'a', tool: 'core.identity', args: { value: 2 }, timeoutMs: 1000, retry: { maxAttempts: 1 } },
    { id: 'b', kind: 'task', needs: ['a'], description: 'b', when: { op: 'eq', left: { $ref: 'nodes.a.value' }, right: 3 }, tool: 'core.identity', args: { value: 1 }, timeoutMs: 1000, retry: { maxAttempts: 1 } },
  ],
  acceptance: [{ op: 'eq', left: { $ref: 'nodes.b.value' }, right: 1 }] };
const world = (pass, error) => ({ id: 'c', pass, status: pass ? 'succeeded' : 'failed', error, reasons: pass ? [] : ['the built workflow did not finish'] });
const rec = worlds => ({ pass: false, outcome: 'ready', workflow: wf, worlds });

test('only builds whose every failing world stopped on a self-check error are selected', () => {
  assert.equal(selfCheckFailure(rec([world(true, null), world(false, 'MISSING_REFERENCE Missing value at nodes.b.value')])), true);
  assert.equal(selfCheckFailure(rec([world(false, 'ACCEPTANCE_FAILED Acceptance failed for root')])), true);
  assert.equal(selfCheckFailure(rec([world(false, 'MISSING_REFERENCE Missing value at nodes.b.value'), world(false, 'CODE_ERROR boom')])), false, 'a code error elsewhere is a real failure');
  assert.equal(selfCheckFailure({ ...rec([world(false, null)]), worlds: [{ id: 'c', pass: false, status: 'succeeded', reasons: ['e-mail ...'] }] }), false, 'wrong effects are not a self-check failure');
  assert.equal(selfCheckFailure({ pass: false, outcome: 'build_failed', workflow: null, worlds: [] }), false);
  assert.equal(selfCheckFailure({ ...rec([]), pass: true }), false);
});

test('the rewrite keeps every node, replaces only the acceptance, and is still valid', () => {
  const out = withoutAcceptance(wf, 'MISSING_REFERENCE Missing value at nodes.b.value');
  assert.deepEqual(out.nodes.slice(0, 2), wf.nodes);
  assert.equal(out.nodes.length, 3);
  assert.notDeepEqual(out.acceptance, wf.acceptance);
  assert.equal(validateCi1(out).valid, true, JSON.stringify(validateCi1(out).errors?.slice(0, 2)));
});

test('a missing reference read by a node argument and not by the acceptance is not excused', () => {
  const argWf = { ...wf, nodes: [...wf.nodes, { id: 'c', kind: 'task', needs: ['b'], description: 'c', tool: 'core.identity', args: { value: { $ref: 'nodes.b.value' } }, timeoutMs: 1000, retry: { maxAttempts: 1 } }],
    acceptance: [{ op: 'eq', left: { $ref: 'nodes.a.value' }, right: 2 }] };
  assert.equal(withoutAcceptance(argWf, 'MISSING_REFERENCE Missing value at nodes.b.value'), null);
});
