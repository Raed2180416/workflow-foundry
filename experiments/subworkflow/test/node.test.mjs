// $0: the SW-1 node runner on scripted model ports. Every arm's code path, the authority envelope (an effect step is
// refused and recorded as a proposal, never run; a nested call past the depth limit is refused; a budget above what the
// node can carve is never granted), the repair loop and the logged fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNode, NODE_BUDGET_USD } from '../node.mjs';
import { templateById, instantiate } from '../templates.mjs';
import { LABELS } from '../../../beds/golive/world.mjs';
import { bed, backlogChannels, nodeInput, trueSlots, truthLabels } from './fixtures.mjs';

const task = bed.generate({ seed: 4242, split: 'dev', difficulty: 3 });
const [ch] = backlogChannels(task);
const input = nodeInput(task, ch.name);
const truth = bed.nodeTruth(task, ch.name);
const T = templateById('legacy-export-intake');

// A port: judge_rows prompts get the true labels; everything else is answered from the script by nodeKey suffix.
function port(script) {
  const labels = truthLabels(task), calls = [];
  return {
    calls,
    async call(req) {
      calls.push(req.nodeKey);
      if (req.nodeKey.includes('.judged.')) {
        const items = req.prompt.split('\n').filter(l => l.startsWith('{"i":')).map(l => JSON.parse(l));
        return { ok: true, costUsd: 0.0004, value: { items: items.map(x => ({ i: x.i, label: labels.get(x.ref) })) } };
      }
      // A key ending in ".r" answers every round (".build.r" matches ".build.r0", ".build.r1", ...).
      const key = Object.keys(script).find(k => req.nodeKey.endsWith(k) || (k.endsWith('.r') && new RegExp(`${k.replace(/\./g, '\\.')}\\d+$`).test(req.nodeKey)));
      if (!key) return { ok: false, costUsd: 0.001, error: { code: 'MODEL_PROTOCOL', message: `no script for ${req.nodeKey}` } };
      const v = typeof script[key] === 'function' ? script[key](req) : script[key];
      return { ok: true, costUsd: 0.002, value: structuredClone(v) };
    },
  };
}
const run = (arm, script) => runNode({ port: port(script), arm, input, runId: `t-${arm}`, answerSchema: bed.nodeOutputSchema });
const goodSpec = budget => instantiate(T, trueSlots(task, ch), budget);
const pass = r => bed.nodeOracle(task, ch.name, r.output).pass;

test('A0: one direct answer, no sub-workflow', async () => {
  const r = await run('A0', { '.answer': truth });
  assert.equal(r.path, 'direct'); assert.equal(pass(r), true); assert.equal(r.calls.length, 1); assert.equal(r.events.length, 0);
});

test('A2: typed request -> governing builder -> bound by hash -> runs -> passes; notCovered becomes a proposal', async () => {
  const r = await run('A2', {
    '.decide': { decision: 'subworkflow', reason: 'many rows', request: { goal: 'intake of the export', inputs: ['export', 'notes', 'spec', 'channel'], returns: 'the intake answer', budgetUsd: 0.03 } },
    '.builder.select': { template: 'legacy-export-intake', reason: 'fits', notCovered: ['write corrected typos back to the legacy system'] },
    '.builder.fill.r0': { slots: trueSlots(task, ch), assumptions: [] },
  });
  assert.equal(r.path, 'subworkflow', JSON.stringify(r.rounds)); assert.equal(pass(r), true);
  assert.match(r.sub.hash, /^sha256:/);
  assert.equal(r.sub.request.grantedUsd, 0.03);
  assert.deepEqual(r.authority.violations, []); assert.equal(r.authority.executedEffects, 0);
  assert.equal(r.proposals.filter(p => p.source === 'notCovered').length, 1);
  assert.equal(r.maxDepthSeen, 1);
  assert.ok(r.costUsd <= NODE_BUDGET_USD);
});

test('A2: a budget above what the node can carve is never granted (clamped, excess recorded as a proposal)', async () => {
  const r = await run('A2', {
    '.decide': { decision: 'subworkflow', reason: 'many rows', request: { goal: 'intake', inputs: ['export'], returns: 'answer', budgetUsd: 5 } },
    '.builder.select': { template: 'legacy-export-intake', reason: 'fits', notCovered: [] },
    '.builder.fill.r0': { slots: trueSlots(task, ch), assumptions: [] },
  });
  assert.ok(r.sub.request.grantedUsd <= 0.06, JSON.stringify(r.sub.request));
  assert.ok(r.proposals.some(p => p.kind === 'budget'));
  assert.equal(r.path, 'subworkflow'); assert.equal(pass(r), true);
});

test('A2: a request that does not pass the export cannot read it (the template step is refused, then fallback)', async () => {
  const r = await run('A2', {
    '.decide': { decision: 'subworkflow', reason: 'many rows', request: { goal: 'intake', inputs: ['notes'], returns: 'answer', budgetUsd: 0.03 } },
    '.builder.select': { template: 'legacy-export-intake', reason: 'fits', notCovered: [] },
    '.builder.fill.r': { slots: trueSlots(task, ch), assumptions: [] },
    '.fallback': truth,
  });
  assert.equal(r.path, 'fallback');
  assert.ok(r.rounds.every(x => x.kind === 'authority'), JSON.stringify(r.rounds));
  assert.equal(r.events.length, 0, 'nothing ran');
});

test('A1: an effect step is refused before anything runs, recorded as a proposal, and the repaired spec runs', async () => {
  let n = 0;
  const withEffect = () => { const s = goodSpec(0.04); s.steps.push({ id: 'tell', op: 'send_message', args: [{ name: 'a', ref: '$answer' }], target: 'legacy-ops@example.invalid', text: 'the list' }); return s; };
  const r = await run('A1', {
    '.decide': { decision: 'subworkflow', reason: 'many rows' },
    '.build.r0': () => (n++, withEffect()),
    '.build.r1': goodSpec(0.04),
  });
  assert.equal(r.rounds[0].kind, 'authority');
  assert.equal(r.rounds[1].kind, 'ok');
  assert.ok(r.proposals.some(p => p.kind === 'op' && /send_message/.test(p.detail)));
  assert.equal(r.authority.executedEffects, 0); assert.deepEqual(r.authority.violations, []);
  assert.equal(r.ranSpecs, 1);
  assert.equal(pass(r), true);
});

test('A1: a nested call past the depth limit is refused statically; a nested call within it runs at depth 2', async () => {
  const leaf = { name: 'leaf', steps: [{ id: 'v', op: 'code', args: [{ name: 'x', ref: '$in.x' }], fn: 'export default ({ x }) => x' }], output: '$v', models: [], budgetUsd: 0.001 };
  const mid = { name: 'mid', steps: [{ id: 'c', op: 'call', args: [{ name: 'x', ref: '$in.x' }], specJson: JSON.stringify(leaf) }], output: '$c', models: [], budgetUsd: 0.002 };
  const wrap = (inner) => { const s = goodSpec(0.04); s.steps.splice(s.steps.length - 1, 0, { id: 'echo', op: 'call', args: [{ name: 'x', ref: '$answer' }], specJson: JSON.stringify(inner) }); return s; };
  const tooDeep = await run('A1', { '.decide': { decision: 'subworkflow', reason: 'r' }, '.build.r': wrap(mid), '.fallback': truth });
  assert.ok(tooDeep.rounds.every(x => x.kind === 'authority'), JSON.stringify(tooDeep.rounds));
  assert.ok(tooDeep.proposals.some(p => p.kind === 'depth'));
  assert.equal(tooDeep.path, 'fallback'); assert.equal(tooDeep.events.length, 0);
  const ok = await run('A1', { '.decide': { decision: 'subworkflow', reason: 'r' }, '.build.r0': wrap(leaf) });
  assert.equal(ok.path, 'subworkflow', JSON.stringify(ok.rounds)); assert.equal(pass(ok), true);
  assert.equal(ok.maxDepthSeen, 2);
  assert.deepEqual(ok.authority.violations, []);
});

test('A1: a practice failure is fed back and repaired; a spec that never passes falls back to a direct answer', async () => {
  const broken = { ...goodSpec(0.04) }; broken.steps = broken.steps.map(s => (s.id === 'table' ? { ...s, delimiter: s.delimiter === ';' ? '|' : ';' } : s));
  const r = await run('A1', { '.decide': { decision: 'subworkflow', reason: 'r' }, '.build.r0': broken, '.build.r1': goodSpec(0.04) });
  assert.equal(r.rounds[0].kind, 'practice'); assert.equal(r.path, 'subworkflow'); assert.equal(pass(r), true);
  const never = await run('A1', { '.decide': { decision: 'subworkflow', reason: 'r' }, '.build.r': broken, '.fallback': truth });
  assert.equal(never.rounds.length, 4); assert.equal(never.path, 'fallback'); assert.equal(never.events.length, 0);
});

test('A1T: the node picks and fills a template itself; "none" falls back', async () => {
  const r = await run('A1T', { '.decide': { decision: 'subworkflow', reason: 'r' }, '.tpl.select': { template: 'legacy-export-intake', reason: 'fits', notCovered: [] },
    '.tpl.fill.r0': { slots: trueSlots(task, ch), assumptions: [] } });
  assert.equal(r.path, 'subworkflow'); assert.equal(pass(r), true);
  const none = await run('A1T', { '.decide': { decision: 'subworkflow', reason: 'r' }, '.tpl.select': { template: 'none', reason: 'no', notCovered: [] }, '.fallback': truth });
  assert.equal(none.path, 'fallback');
});

test('decision "answer" skips the sub-workflow in every deciding arm', async () => {
  for (const arm of ['A1', 'A1T', 'A2']) {
    const r = await run(arm, { '.decide': { decision: 'answer', reason: 'small', answer: truth } });
    assert.equal(r.path, 'direct'); assert.equal(pass(r), true); assert.equal(r.calls.length, 1);
  }
});

test('the labels the template judges with are the bed labels', () => { assert.deepEqual(trueSlots(task, ch).labels, [...LABELS]); });

test('parent-directed arms: no decision call; the governing route still writes its own typed request', async () => {
  const self = await run('A1F', { '.build.r0': goodSpec(0.04) });
  assert.equal(self.decision, 'directed'); assert.equal(self.path, 'subworkflow'); assert.equal(pass(self), true);
  assert.ok(!self.calls.some(c => c.key === 'decide'));
  const tpl = await run('A1TF', { '.tpl.select': { template: 'legacy-export-intake', reason: 'fits', notCovered: [] }, '.tpl.fill.r0': { slots: trueSlots(task, ch), assumptions: [] } });
  assert.equal(tpl.path, 'subworkflow'); assert.equal(pass(tpl), true);
  const gov = await run('A2F', { '.request': { reason: 'directed', request: { goal: 'intake', inputs: ['export', 'channel'], returns: 'answer', budgetUsd: 0.03 } },
    '.builder.select': { template: 'legacy-export-intake', reason: 'fits', notCovered: [] }, '.builder.fill.r0': { slots: trueSlots(task, ch), assumptions: [] } });
  assert.equal(gov.path, 'subworkflow'); assert.equal(pass(gov), true); assert.deepEqual(gov.sub.request.inputs, ['export', 'channel']);
  const simple = await runNode({ port: port({ '.answer': truth }), arm: 'A2F', directive: 'answer', input, runId: 't', answerSchema: bed.nodeOutputSchema });
  assert.equal(simple.path, 'direct'); assert.equal(simple.calls.length, 1);
});

test('defense in depth: without checkSpec, the call host refuses an effectful callee and the runtime refuses an effect op', async () => {
  const { createNodeBinding } = await import('../bind.mjs');
  const { runSpec } = await import('../dsl.mjs');
  const b = createNodeBinding({ port: port({}), budgetUsd: 0.1, taskKey: 'x', runId: 'd', outputSchema: { type: 'object' } });
  const spec = { name: 'e', steps: [{ id: 's', op: 'send_message', args: [], target: 'legacy-ops@example.invalid', text: 'list' }], output: '$s', models: [], budgetUsd: 0.01 };
  const r = await b.call(spec, { export: 'x' });
  assert.equal(r.value.status, 'refused'); assert.equal(r.value.refused, 'effects');
  await assert.rejects(runSpec(spec, {}, { practice: true }), e => e.code === 'AUTHORITY');
});
