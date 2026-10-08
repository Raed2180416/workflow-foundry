// Control-flow (program-counter) taint: an effect whose FIRING depends on untrusted data is rejected the same
// way an effect whose ARGUMENTS depend on it is (ROADMAP §2.9; review-20261007/07 finding 3 and S2; lane-7 probe A.3).
// Local mock tools and the scripted provider only: no network, no model spend. Development/diagnostic evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflow } from '../src/validate.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { loadPolicy } from '../src/models/policy.mjs';

const loaded = loadPolicy();
const registry = createDefaultRegistry();
const flow = (nodes, extra = {}) => ({ schemaVersion: '1.0', id: 'ControlTaint', version: 1, title: 'Control taint probe', goal: 'Probe one control-flow taint rule',
  domain: 'general', envelope: { assumptions: ['Synthetic'], risks: [], successCriteria: ['The probed rule holds'] },
  budget: { maxSteps: 50, maxConcurrency: 2, maxDurationMs: 60000 }, nodes,
  acceptance: [{ op: 'exists', value: { $ref: 'nodes.read.value' } }], ...extra });
const check = (workflow, options = {}) => validateWorkflow(workflow, { registry, modelPolicy: loaded, ...options });
const codes = (workflow, options) => check(workflow, options).errors.map(e => e.code);
const task = (id, tool, args, extra = {}) => ({ id, kind: 'task', needs: [], description: `Run ${id}`, tool, args, timeoutMs: 1000, retry: { maxAttempts: 1 }, ...extra });
const untrustedDoc = { 'input.doc': 'untrusted:web' };

// Lane-7 probe A.3: input `doc` is untrusted:web; `read` is core.identity on input.doc; `write` is core.artifact
// (effects idempotent, risk low, no approval).
const read = task('read', 'core.identity', { value: { $ref: 'input.doc' } });
const writeWith = extra => task('write', 'core.artifact', { name: 'note.txt', content: 'fixed text' }, { needs: ['read'], ...extra });

test('probe A.3 case A (control): untrusted data in the effect arguments is rejected', () => {
  const write = task('write', 'core.artifact', { name: 'note.txt', content: { $ref: 'nodes.read.value' } }, { needs: ['read'] });
  const result = check(flow([read, write], { labels: untrustedDoc }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.code === 'LABEL_POLICY' && e.rule === 'UNTRUSTED_EFFECT_ARGS'), JSON.stringify(result.errors));
});

test('probe A.3 case B: a fixed-argument effect gated by `when` on an untrusted-derived value is rejected', () => {
  const write = writeWith({ when: { op: 'eq', left: { $ref: 'nodes.read.value' }, right: 'go' } });
  const result = check(flow([read, write], { labels: untrustedDoc }));
  assert.equal(result.valid, false, 'the validator accepted an effect whose firing is decided by untrusted data');
  const policy = result.errors.find(e => e.code === 'LABEL_POLICY');
  assert.ok(policy, JSON.stringify(result.errors));
  assert.deepEqual([policy.rule, policy.path, policy.label], ['UNTRUSTED_CONTROL', 'workflow.write', 'untrusted:web']);
});
