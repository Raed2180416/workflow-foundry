// $0: the open governing builder (route 'governing-open', arms A2O / A2OF; SW-1b) on scripted model ports and the
// golive 'blocks' layout, where no library template reads the export. The library stage runs exactly as A2's; when it
// misses (the builder picks "none", or the template never passes), a fresh builder writes the sub-workflow free-form from
// the same request view, under the same envelope, checks, practice run, binding by hash and gate. A2 / A2F are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNode, ARM_CONFIG } from '../node.mjs';
import { templateById, instantiate } from '../templates.mjs';
import * as P from '../prompts.mjs';
import * as layouts from '../../../beds/golive/layouts.mjs';
import { bed, backlogChannels, trueSlots, truthLabels } from './fixtures.mjs';

const task = layouts.generate({ seed: 4243, split: 'dev', difficulty: 3, layout: 'blocks' });
const [ch] = backlogChannels(task);
const c = task.inputs.channels.find(x => x.channel === ch.name);
const input = { channel: c.channel, spec: task.inputs.spec, notes: c.notes, export: c.export };
const truth = bed.nodeTruth(task, ch.name);
const T = templateById('legacy-export-intake');
const pass = r => bed.nodeOracle(task, ch.name, r.output).pass;

// What a capable open builder writes: the library template's procedure behind a glue step that reads the blocks layout
// into the table shape parse_table returns (header, rows, comments), the trailer normalised to "rows=".
function openSpec(budget) {
  const names = ch.columns.map(k => ch.header[k]);
  const s = instantiate(T, { ...trueSlots(task, ch), trailer_prefix: '@@ END' }, budget);
  s.name = 'blocks-intake';
  s.steps[0] = { id: 'table', op: 'code', args: [{ name: 'text', ref: '$in.export' }], fn: `const NAMES = ${JSON.stringify(names)};
export default ({ text }) => {
  const rows = [], comments = []; let cur = null;
  for (const line of text.split('\\n')) {
    if (line.startsWith('@@ RECORD ')) { cur = {}; rows.push(cur); continue; }
    if (line.startsWith('@@ END')) { comments.push(line.replace('records=', 'rows=')); cur = null; continue; }
    const name = NAMES.find(n => line.startsWith(n + ': '));
    if (!cur || name === undefined) throw new Error('unreadable line: ' + line.slice(0, 60));
    cur[name] = line.slice(name.length + 2);
  }
  return { header: NAMES, rows, comments };
};` };
  return s;
}
function port(script) {
  const labels = truthLabels(task), calls = [], prompts = {};
  return {
    calls, prompts,
    async call(req) {
      calls.push(req.nodeKey); prompts[req.nodeKey] = req.prompt;
      if (req.nodeKey.includes('.judged.')) {
        const items = req.prompt.split('\n').filter(l => l.startsWith('{"i":')).map(l => JSON.parse(l));
        return { ok: true, costUsd: 0.0004, value: { items: items.map(x => ({ i: x.i, label: labels.get(x.ref) })) } };
      }
      const key = Object.keys(script).find(k => req.nodeKey.endsWith(k) || (k.endsWith('.r') && new RegExp(`${k.replace(/\./g, '\\.')}\\d+$`).test(req.nodeKey)));
      if (!key) return { ok: false, costUsd: 0.001, error: { code: 'MODEL_PROTOCOL', message: `no script for ${req.nodeKey}` } };
      const v = typeof script[key] === 'function' ? script[key](req) : script[key];
      return { ok: true, costUsd: 0.002, value: structuredClone(v) };
    },
  };
}
const REQUEST = { reason: 'directed', request: { goal: 'intake of the legacy report', inputs: ['export', 'notes', 'spec', 'channel'], returns: 'the intake answer', budgetUsd: 0.04 } };
const run = (arm, script, p = port(script)) => runNode({ port: p, arm, input, runId: `t-${arm}`, answerSchema: bed.nodeOutputSchema }).then(r => Object.assign(r, { port: p }));

test('the open arms ride the governing route: same typed request and decision prompts as A2 / A2F', () => {
  assert.deepEqual(ARM_CONFIG.A2O, { route: 'governing-open', directive: 'decide' });
  assert.deepEqual(ARM_CONFIG.A2OF, { route: 'governing-open', directive: 'subworkflow' });
  assert.deepEqual(ARM_CONFIG.A2, { route: 'governing', directive: 'decide' });
  assert.deepEqual(ARM_CONFIG.A2F, { route: 'governing', directive: 'subworkflow' });
});

test('A2OF: the library misses ("none"), a fresh builder writes the sub-workflow from the request view, it is bound by hash, runs and passes', async () => {
  const r = await run('A2OF', { '.request': REQUEST, '.builder.select': { template: 'none', reason: 'the export is not delimited', notCovered: ['write typos back'] }, '.builder.open.r0': openSpec(0.04) });
  assert.equal(r.path, 'subworkflow', JSON.stringify(r.rounds)); assert.equal(pass(r), true);
  assert.equal(r.sub.builder, 'governing'); assert.match(r.sub.open.after, /no template fits/); assert.match(r.sub.hash, /^sha256:/);
  assert.deepEqual(r.authority.violations, []); assert.equal(r.authority.executedEffects, 0); assert.equal(r.maxDepthSeen, 1);
  assert.ok(r.proposals.some(p => p.source === 'notCovered'));
  // The open builder sees the request view only: the node's typed request and the inputs it named, never the node's prompt.
  const openPrompt = r.port.prompts[`${ch.name}.builder.open.r0`];
  assert.match(openPrompt, /A node asked for a sub-workflow/); assert.match(openPrompt, /No library template fits/);
  assert.ok(!openPrompt.includes(P.PARENT_DIRECTIVE));
});

test('A2OF: a template that never passes uses its rounds, then the open stage; an effect step there is refused and proposed, the repair runs', async () => {
  const wrongTemplate = { slots: { ...trueSlots(task, ch), trailer_prefix: '@@ END' }, assumptions: [] };
  const withEffect = () => { const s = openSpec(0.04); s.steps.push({ id: 'tell', op: 'send_message', args: [{ name: 'a', ref: '$answer' }], target: 'legacy-ops@example.invalid', text: 'list' }); return s; };
  const r = await run('A2OF', { '.request': REQUEST, '.builder.select': { template: 'legacy-export-intake', reason: 'legacy export', notCovered: [] }, '.builder.fill.r': wrongTemplate,
    '.builder.open.r0': withEffect(), '.builder.open.r1': openSpec(0.04) });
  const kinds = r.rounds.map(x => x.kind);
  assert.deepEqual(kinds.slice(0, 4), ['practice', 'practice', 'practice', 'practice'], JSON.stringify(r.rounds));
  assert.deepEqual(kinds.slice(4), ['authority', 'ok']);
  assert.match(r.sub.open.after, /no passing sub-workflow/);
  assert.ok(r.proposals.some(p => p.kind === 'op' && /send_message/.test(p.detail)));
  assert.equal(r.specsRun.length, 1); assert.ok(!r.specsRun[0].spec.steps.some(s => s.op === 'send_message'));
  assert.equal(r.path, 'subworkflow'); assert.equal(pass(r), true); assert.deepEqual(r.authority.violations, []);
});

test('A2F is unchanged: a library miss falls back to a direct answer (no open stage)', async () => {
  const r = await run('A2F', { '.request': REQUEST, '.builder.select': { template: 'none', reason: 'not delimited', notCovered: [] }, '.fallback': truth });
  assert.equal(r.path, 'fallback'); assert.equal(r.sub.open, undefined); assert.ok(!r.calls.some(x => x.key.includes('open')));
});

test('A2O decides with the A2 prompt and schema; an open stage that never passes falls back; the node budget bounds it', async () => {
  const decide = { decision: 'subworkflow', reason: 'many rows', request: REQUEST.request };
  const a2 = await run('A2', { '.decide': decide, '.builder.select': { template: 'none', reason: 'x', notCovered: [] }, '.fallback': truth });
  const a2o = await run('A2O', { '.decide': decide, '.builder.select': { template: 'none', reason: 'x', notCovered: [] }, '.builder.open.r': { name: 'x', steps: [], output: '$nothing', models: [], budgetUsd: 0.01 }, '.fallback': truth });
  assert.equal(a2o.port.prompts[`${ch.name}.decide`], a2.port.prompts[`${ch.name}.decide`]);
  assert.equal(a2o.path, 'fallback'); assert.equal(a2o.rounds.length, 1 + 4);
  assert.ok(a2o.costUsd <= 0.15);
});
