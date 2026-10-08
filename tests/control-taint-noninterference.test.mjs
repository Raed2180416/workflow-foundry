// Noninterference check for control-flow taint (ROADMAP §2.9). A seeded generator builds small random workflows over an untrusted
// input (guards, joins, maps, collect maps, loops, ungated effects, a task that really fails under onError "continue", and asserts in
// map and loop bodies, which inside a collect map end one item rather than the run). Every workflow the
// validator ACCEPTS is run with different untrusted input values; the set of effects that fired must not depend on them (termination
// excepted: only runs that all succeed are compared). Also checks the dispatcher is never stricter than the validator.
// Measured 2026-10-08 on seeds 21, 7 and 99 with 400 workflows each (FOUNDRY_FUZZ_SEED / FOUNDRY_FUZZ_COUNT; the committed default is a
// smoke-sized 80): the validator before the control rule existed accepted every workflow and 297 of the 1138 comparable ones interfered;
// the current validator accepted 648, ran 624 comparable ones and none interfered. Mutation check: six one-line weakenings of the rule
// (onError continuation, the needs chain, map items, loop until, the guard itself, the output label) are each caught, four by this
// fuzz at 300 workflows and all six at 1500, and all six by the static tests in control-taint.test.mjs. The smoke size does not catch
// every mutant; run the larger size after changing the rule.
// Adversarial review 2026-10-08 added collect maps and body asserts to the generator (so the numbers above are for the earlier
// generator). With seeds 21, 7 and 99 at 400 workflows each, the validator of HEAD c983182 accepted 15 workflows that interfered
// (first at index 47, 40 and 57, so the default 80 catches it on every seed): a body assert over the untrusted input ended one item
// of a collect map, and the write after it fired or not. The fixed validator accepted 549, ran 418 comparable ones, none interfered,
// and the dispatcher refused none.
// Local mock tools only. Development/diagnostic evidence, not a proof: the generator covers task, assert (in bodies), map and loop
// nodes only (no human, agent or verify nodes; a top-level assert would stop the run, the termination channel the rule does not track).
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
const SEED = Number(process.env.FOUNDRY_FUZZ_SEED ?? 21), COUNT = Number(process.env.FOUNDRY_FUZZ_COUNT ?? 80);

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
      // An assert fails its frame when its guard is false. At the top level that ends the run (termination, not compared); inside a
      // map with failure "collect" it ends only its item, and the rest of the item does not run: a skip that the run survives.
      const kind = pick(['id', 'id', 'check', 'effect', 'effect', ...(depth > 0 ? ['assert', 'assert'] : ['map', 'map', 'loop'])]);
      if (kind === 'id') nodes.push({ ...base, kind: 'task', tool: 'core.identity', args: { v: chance(0.6) ? ref(source(), '-') : 'lit' }, timeoutMs: 1000, retry: { maxAttempts: 1 }, ...(chance(0.15) ? { onError: 'continue' } : {}) });
      // core.pluck fails when a row has no field x: it succeeds on rows [] and fails on rows ['a', 'b'], and onError continue turns the failure into a skip.
      else if (kind === 'check') nodes.push({ ...base, kind: 'task', tool: 'core.pluck', args: { items: ref('input.rows'), field: 'x' }, timeoutMs: 1000, retry: { maxAttempts: 1 }, onError: 'continue' });
      else if (kind === 'effect') nodes.push({ ...base, kind: 'task', tool: 'core.artifact', args: { name: `a-${id}.txt`, content: 'fixed' }, timeoutMs: 1000, retry: { maxAttempts: 1 } });
      else if (kind === 'assert') nodes.push({ ...base, kind: 'assert', checks: [chance(0.6) ? { op: 'eq', left: ref('input.doc'), right: pick(['go', 'stop']) } : guard()] });
      else if (kind === 'map') nodes.push({ ...base, kind: 'map', items: chance(0.5) ? ref('input.rows') : [1, 2], maxItems: 5, ...(chance(0.5) ? { failure: 'collect' } : {}), body: flow(depth + 1, `${id}b`, ['item']) });
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
  const registry = createDefaultRegistry(), make = generator(SEED), tally = { generated: 0, accepted: 0, rejectedControl: 0, comparable: 0, continued: 0, interference: [], dispatcherRefusals: [] };
  for (let index = 0; index < COUNT; index++) {
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
        if (Object.values(done.nodes).some(node => node.status === 'handled_error')) tally.continued++;
      } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
    }
    if (fired.every(f => f !== null)) { tally.comparable++; if (new Set(fired).size > 1) tally.interference.push({ index, fired: [...new Set(fired)] }); }
  }
  assert.ok(tally.rejectedControl >= 10 && tally.accepted >= 10 && tally.comparable >= 10, `the sample exercises both outcomes: ${JSON.stringify({ ...tally, interference: undefined, dispatcherRefusals: undefined })}`);
  assert.ok(tally.continued >= 3, `the onError continuation path is exercised by real failures: ${tally.continued} runs`);
  assert.deepEqual(tally.dispatcherRefusals, [], 'the runtime check is never stricter than the validator');
  assert.deepEqual(tally.interference, [], 'accepted workflows fire the same effects whatever the untrusted input says');
  t.diagnostic(JSON.stringify({ seed: SEED, generated: tally.generated, accepted: tally.accepted, rejected: tally.rejectedControl, comparable: tally.comparable, continued: tally.continued }));
});
