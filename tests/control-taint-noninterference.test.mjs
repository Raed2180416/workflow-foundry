// Noninterference check for control-flow taint (ROADMAP §2.9). A seeded generator builds small random workflows over an untrusted
// input (guards, joins, maps, loops, ungated effects). Every workflow the validator ACCEPTS is run with different untrusted input
// values; the set of effects that fired must not depend on them (termination excepted: only runs that all succeed are compared).
// The same harness run against the validator before the control rule existed found interference in 50 of 140 accepted workflows
// (seed 21, 150 generated); it must find none now. Also checks the dispatcher is never stricter than the validator.
// Local mock tools only. Development/diagnostic evidence, not a proof: the generator covers task, map and loop nodes only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';

const ref = (p, d) => d === undefined ? { $ref: p } : { $ref: p, default: d };

function generator(seed) {
  let state = seed;
  const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = list => list[Math.floor(rnd() * list.length)], chance = p => rnd() < p;
  function flow(depth, prefix, locals) {
    const nodes = [], count = 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const id = `${prefix}${i}`, earlier = nodes.map(n => n.id), needs = earlier.filter(() => chance(0.4));
      const source = () => pick(['input.doc', 'input.mode', ...locals, ...needs.map(dep => `nodes.${dep}.v`)]);
      const guard = () => chance(0.3) ? { op: 'exists', value: ref(source()) } : { op: 'eq', left: ref(source(), '-'), right: pick(['go', 'stop']) };
      const base = { id, needs, description: id, ...(chance(0.35) ? { when: guard() } : {}), ...(chance(0.2) ? { join: 'all_resolved' } : {}) };
      const kind = pick(['id', 'id', 'effect', 'effect', ...(depth > 0 ? [] : ['map', 'loop'])]);
      if (kind === 'id') nodes.push({ ...base, kind: 'task', tool: 'core.identity', args: { v: chance(0.6) ? ref(source(), '-') : 'lit' }, timeoutMs: 1000, retry: { maxAttempts: 1 }, ...(chance(0.15) ? { onError: 'continue' } : {}) });
      else if (kind === 'effect') nodes.push({ ...base, kind: 'task', tool: 'core.artifact', args: { name: `a-${id}.txt`, content: 'fixed' }, timeoutMs: 1000, retry: { maxAttempts: 1 } });
      else if (kind === 'map') nodes.push({ ...base, kind: 'map', items: chance(0.5) ? ref('input.rows') : [1, 2], maxItems: 5, body: flow(depth + 1, `${id}b`, ['item']) });
      else {
        const body = flow(depth + 1, `${id}b`, ['iteration', 'previous']);
        nodes.push({ ...base, kind: 'loop', maxIterations: 3, initial: { v: chance(0.5) ? ref('input.doc') : 'seed' },
          until: chance(0.5) ? { op: 'gte', left: ref('iteration'), right: 1 } : { op: 'exists', value: ref(`nodes.${pick(body.nodes.map(n => n.id))}`) }, body });
      }
    }
    return { nodes, acceptance: [{ op: 'exists', value: ref('input.doc') }] };
  }
  return index => ({ schemaVersion: '1.0', id: `Fuzz${index}`, version: 1, title: 'fuzz', goal: 'Probe noninterference', domain: 'general',
    envelope: { assumptions: ['Synthetic'], risks: [], successCriteria: ['Effects do not depend on untrusted input'] },
    budget: { maxSteps: 400, maxConcurrency: 2, maxDurationMs: 60000 }, ...flow(0, 'n', []),
    labels: { 'input.doc': 'untrusted:web', ...(chance(0.3) ? { 'input.rows': 'untrusted:csv' } : {}) } });
}

const firedEffects = run => [...Object.entries(run.nodes), ...Object.entries(run.frames).flatMap(([key, frame]) => Object.entries(frame.nodes).map(([id, node]) => [`${key}/${id}`, node]))]
  .filter(([, node]) => node.tool === 'core.artifact' && node.status === 'completed').map(([id]) => id).sort().join(',');

test('noninterference: no accepted workflow fires different effects for different untrusted inputs, and the dispatcher never refuses an accepted one', async t => {
  const registry = createDefaultRegistry(), make = generator(21), tally = { generated: 0, accepted: 0, rejectedControl: 0, comparable: 0, interference: [], dispatcherRefusals: [] };
  for (let index = 0; index < 80; index++) {
    const workflow = make(index); tally.generated++;
    const verdict = validateWorkflow(workflow, { registry });
    assert.deepEqual(verdict.errors.filter(e => !['LABEL_POLICY', 'UNTRUSTED_CONTROL', 'UNTRUSTED_EFFECT_ARGS'].includes(e.code)), [], `generated workflow ${index} is well-formed`);
    if (!verdict.valid) { tally.rejectedControl++; continue; }
    tally.accepted++;
    const rowsUntrusted = 'input.rows' in workflow.labels, fired = [];
    for (const doc of ['go', 'stop']) for (const rows of rowsUntrusted ? [[], ['a', 'b']] : [['a', 'b']]) {
      const root = mkdtempSync(path.join(tmpdir(), 'foundry-noninterference-')), store = new Store(root);
      try {
        const variant = { ...workflow, id: `${workflow.id}v${fired.length}` };
        store.saveWorkflow(variant);
        const runtime = new Runtime(store, registry, { maxCost: 0, maxSteps: 400 });
        const done = await runtime.execute(runtime.create(variant, { doc, rows, mode: 'go' }).id);
        if (done.error?.code === 'LABEL_POLICY') tally.dispatcherRefusals.push(index);
        fired.push(done.status === 'succeeded' ? firedEffects(done) : null);
      } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
    }
    if (fired.every(f => f !== null)) { tally.comparable++; if (new Set(fired).size > 1) tally.interference.push({ index, fired: [...new Set(fired)] }); }
  }
  assert.ok(tally.rejectedControl >= 10 && tally.accepted >= 10 && tally.comparable >= 10, `the sample exercises both outcomes: ${JSON.stringify({ ...tally, interference: undefined, dispatcherRefusals: undefined })}`);
  assert.deepEqual(tally.dispatcherRefusals, [], 'the runtime check is never stricter than the validator');
  assert.deepEqual(tally.interference, [], 'accepted workflows fire the same effects whatever the untrusted input says');
  t.diagnostic(JSON.stringify({ generated: tally.generated, accepted: tally.accepted, rejected: tally.rejectedControl, comparable: tally.comparable }));
});
