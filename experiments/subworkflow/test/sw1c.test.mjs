// $0: the SW-1c arms (PREREG-SW-1c) on scripted model ports: A1H (reworded self-build offer), A0G (direct answer + the
// contract gate + retries), A0C (a code tool, no sub-workflow machinery), A2FC (request completeness + the note vote),
// and the note vote itself (vote.mjs) repairing a single judge slip that fails the node oracle without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNode } from '../node.mjs';
import * as P from '../prompts.mjs';
import * as PC from '../prompts-c.mjs';
import { templateById, instantiate } from '../templates.mjs';
import { createNodeBinding } from '../bind.mjs';
import { checkSpec, PURE_OPS } from '../dsl.mjs';
import { withNoteVote } from '../vote.mjs';
import { bed, backlogChannels, nodeInput, trueSlots, truthLabels, truthJudgePort } from './fixtures.mjs';

const task = bed.generate({ seed: 4242, split: 'dev', difficulty: 3 });
const [ch] = backlogChannels(task);
const input = nodeInput(task, ch.name);
const truth = bed.nodeTruth(task, ch.name);
const T = templateById('legacy-export-intake');
const pass = out => bed.nodeOracle(task, ch.name, out).pass;

// A scripted port: judge prompts get the true labels; other calls answer from the script by nodeKey suffix (a key ending
// in ".r" or ".t" answers every numbered round/turn). Every request is kept.
function port(script) {
  const labels = truthLabels(task), reqs = [];
  return {
    reqs,
    async call(req) {
      reqs.push(req);
      if (req.nodeKey.includes('.judged.')) {
        const items = req.prompt.split('\n').filter(l => l.startsWith('{"i":')).map(l => JSON.parse(l));
        return { ok: true, costUsd: 0.0004, value: { items: items.map(x => ({ i: x.i, label: labels.get(x.ref) })) } };
      }
      const k = req.nodeKey.slice(ch.name.length);
      const key = Object.keys(script).find(s => k === s || (/\.(r|t)$/.test(s) && new RegExp(`^${s.replace(/\./g, '\\.')}\\d+$`).test(k)));
      if (!key) return { ok: false, costUsd: 0.001, error: { code: 'MODEL_PROTOCOL', message: `no script for ${k}` } };
      const v = typeof script[key] === 'function' ? script[key](req) : script[key];
      return { ok: true, costUsd: 0.002, value: structuredClone(v) };
    },
  };
}
const run = (arm, script, extra = {}) => { const p = port(script); return runNode({ port: p, arm, input, runId: `t-${arm}`, answerSchema: bed.nodeOutputSchema, ...extra }).then(r => ({ r, p })); };

test('A1H: the decide prompt differs from A1\'s only in the self-build offer, which says the harness runs the program', async () => {
  const a1 = P.decidePrompt('self', input, 0.06), a1h = PC.decidePromptHarness(input, 0.06);
  const diff = a1h.split('\n\n').filter(x => !a1.split('\n\n').includes(x));
  assert.equal(diff.length, 1);
  assert.match(diff[0], /the harness checks it, runs its code and model steps for you/);
  assert.match(diff[0], /you need no code tool of your own/);
  assert.doesNotMatch(diff[0], /legacy-export-intake/, 'no template catalogue in the A1H offer');
  const { r, p } = await run('A1H', { '.decide': { decision: 'answer', reason: 'small', answer: truth } });
  assert.equal(r.path, 'direct'); assert.equal(pass(r.output), true);
  assert.equal(p.reqs[0].prompt, PC.decidePromptHarness(input, 0.06));
});

test('A0G: a gate failure goes back to the node with the problems; a passing answer costs no retry', async () => {
  const broken = structuredClone(truth); broken.totals.orders += 2;
  let retryPrompt = null;
  const { r } = await run('A0G', { '.answer': broken, '.answer.retry1': req => { retryPrompt = req.prompt; return truth; } });
  assert.equal(r.path, 'direct'); assert.equal(pass(r.output), true);
  assert.deepEqual(r.calls.map(c => c.key), ['answer', 'answer.retry1']);
  assert.match(retryPrompt, /failed the harness's answer checks:\n- totals.orders/);
  assert.equal(r.gate.at(-1), 'ok');
  const clean = await run('A0G', { '.answer': truth });
  assert.deepEqual(clean.r.calls.map(c => c.key), ['answer']);
  // Never passing: three retries, then the last answer stands (the gate cannot see the oracle).
  const never = await run('A0G', { '.answer': broken, '.answer.retry1': broken, '.answer.retry2': broken, '.answer.retry3': broken });
  assert.equal(never.r.calls.length, 4); assert.equal(pass(never.r.output), false); assert.notEqual(never.r.gate.at(-1), 'ok');
});

test('A0C: the node runs code, sees the value, answers with a program; a gate failure and a thrown error are fed back', async () => {
  const answerProgram = `export default () => (${JSON.stringify(truth)});`;
  const bad = structuredClone(truth); bad.totals.usd_cents += 1;
  const turns = {
    '.tool.t0': { action: 'run', program: 'export default ({ data }) => ({ lines: data.split("\\n").length })', why: 'count lines' },
    '.tool.t1': { action: 'answer', program: 'export default () => { throw new Error("not yet"); }', why: 'oops' },
    '.tool.t2': { action: 'answer', program: `export default () => (${JSON.stringify(bad)});`, why: 'answer' },
    '.tool.t3': { action: 'answer', program: answerProgram, why: 'answer' },
  };
  const { r, p } = await run('A0C', turns);
  assert.equal(r.path, 'code-tool', JSON.stringify(r.tool)); assert.equal(pass(r.output), true);
  assert.deepEqual(r.tool.map(t => t.kind), ['run', 'error', 'gate', 'ok']);
  const last = p.reqs.at(-1).prompt;
  assert.match(last, /It returned: \{"lines":\d+\}/);
  assert.match(last, /It failed: CODE_ERROR[\s\S]*Error: not yet/);
  assert.match(last, /failed the answer checks:\n- totals.usd_cents/);
  assert.equal(p.reqs[0].system, PC.CODE_TOOL_SYSTEM);
  // No passing answer program in CODE_TOOL_TURNS turns: a logged direct-answer fallback.
  const fb = await run('A0C', { '.tool.t': { action: 'run', program: 'export default () => 1', why: 'x' }, '.fallback': truth });
  assert.equal(fb.r.path, 'fallback'); assert.equal(fb.r.tool.length, PC.CODE_TOOL_TURNS); assert.equal(pass(fb.r.output), true);
});

test('A2FC: a request without the export goes back to the node once; the completed request builds, votes and passes', async () => {
  let returnedPrompt = null;
  const { r, p } = await run('A2FC', {
    '.request': { reason: 'directed', request: { goal: 'intake', inputs: ['notes', 'spec'], returns: 'the intake answer', budgetUsd: 0.04 } },
    '.request.returned': req => { returnedPrompt = req.prompt; return { reason: 'fixed', request: { goal: 'intake', inputs: ['export', 'notes', 'spec'], returns: 'the intake answer', budgetUsd: 0.04 } }; },
    '.builder.select': { template: 'legacy-export-intake', reason: 'fits', notCovered: ['E-mail the list to legacy-ops@example.invalid'] },
    '.builder.fill.r0': { slots: trueSlots(task, ch), assumptions: [] },
  }, { directive: 'subworkflow' });
  assert.match(returnedPrompt, /does not pass export, and your answer contract depends on it/);
  assert.deepEqual(r.returned, { missing: ['export'], after: ['export', 'notes', 'spec'], stillMissing: [] });
  assert.equal(r.path, 'subworkflow', JSON.stringify(r.rounds)); assert.equal(pass(r.output), true);
  assert.ok(r.specsRun[0].spec.steps.some(s => s.id === 'judged_vote'), 'the note vote step ran');
  assert.ok(p.reqs.some(q => q.nodeKey.endsWith('.builder.select')));
  // The notCovered proposal carries its provenance (the address is not in this d3 dev export: tagged, not quarantined).
  const prop = r.proposals.find(x => x.source === 'notCovered');
  assert.ok(['export', 'builder'].includes(prop.origin)); assert.equal(typeof prop.quarantined, 'boolean');
  // A complete request is not returned (no extra call); A2F (frozen) never returns a request.
  const full = await run('A2FC', { '.request': { reason: 'd', request: { goal: 'intake', inputs: ['export', 'notes', 'spec', 'channel'], returns: 'a', budgetUsd: 0.04 } },
    '.builder.select': { template: 'none', reason: 'no', notCovered: [] }, '.fallback': truth }, { directive: 'subworkflow' });
  assert.equal(full.r.returned, undefined); assert.ok(!full.p.reqs.some(q => q.nodeKey.endsWith('.request.returned')));
  const frozen = await run('A2F', { '.request': { reason: 'd', request: { goal: 'intake', inputs: ['notes'], returns: 'a', budgetUsd: 0.04 } },
    '.builder.select': { template: 'none', reason: 'no', notCovered: [] }, '.fallback': truth }, { directive: 'subworkflow' });
  assert.ok(!frozen.p.reqs.some(q => q.nodeKey.endsWith('.request.returned')));
});

test('note vote: one judge slip on a repeated note fails the node oracle; the vote step repairs it and stays a pure, checkable spec', async () => {
  // A ref whose note text is shared by >= 2 other imported orders, with a label that a slip keeps imported.
  const newest = new Map(); for (const v of ch.versions) { const q = newest.get(v.ref); if (!q || (v.updatedMin ?? 0) > (q.updatedMin ?? 0)) newest.set(v.ref, v); }
  const imported = new Set(truth.import.map(o => o.ref)), byNote = new Map();
  for (const v of newest.values()) if (imported.has(v.ref) && v.label !== 'dispatched') { const k = v.noteText ?? v.note; byNote.set(k, [...(byNote.get(k) ?? []), v.ref]); }
  const [, refs] = [...byNote.entries()].find(([, rs]) => rs.length >= 3);
  const slip = new Set([refs[0]]);
  const spec = instantiate(T, trueSlots(task, ch), 0.05), voted = withNoteVote(spec);
  assert.ok(checkSpec(voted, { inputs: ['channel', 'spec', 'notes', 'export'], ops: [...PURE_OPS], models: ['claude-haiku-5-5'], maxDepth: 2, budgetUsd: 0.06 }).ok);
  assert.equal(voted.steps.find(s => s.id === 'answer').args.find(a => a.name === 'judged').ref, '$judged_vote');
  const runWith = async s => (await createNodeBinding({ port: truthJudgePort(task, { wrong: slip }), budgetUsd: 0.1, taskKey: task.id, runId: 'v', outputSchema: bed.nodeOutputSchema }).call(s, input)).value;
  const plain = await runWith(spec), fixed = await runWith(voted);
  assert.equal(plain.status, 'ok'); assert.equal(pass(plain.output), false, 'the slip fails the exact oracle');
  assert.equal(fixed.status, 'ok'); assert.equal(pass(fixed.output), true, 'the vote repairs it');
});
