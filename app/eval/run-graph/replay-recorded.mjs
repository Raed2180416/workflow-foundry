#!/usr/bin/env node
// Replay the run exports committed in tools/run-view/samples through T (review m1): $0, no runtime, no network. One of them is a real-model run
// (records-v3-dev-d4-s108: Haiku and Sonnet through the Claude CLI, 26 journaled calls, two escalations); the four zoo-* exports are scripted
// fixtures written by the production runtime. Unlike the evaluation's scenarios, these were written before this work and by other code.
//
// What is checked, and against which record (none of them is the chain T reads, except where said):
//   run        T's run state against the exported run header's status                                     (consistency: same status)
//   cost       T from the chain alone, per top-level step, against the exported journal rows                (independent)
//   total      T from the chain alone against the header's cost, the runtime's own budget counter            (independent)
//   escalations T's escalation count per node instance against the decision records (decisions table)       (independent)
//   failing    the code against the header's error code; the step against the node id the runtime puts at the start of the error message (weak)
//   waiting    a run in awaiting_approval (awaiting_human) lists at least one approval (question); a stopped run lists nothing  (status only)
//   done       a succeeded run shows no step working or needing a person, and Done
//   conversation a node with journaled calls opens with every prompt verified against the chain and every reply present (fenced)
//   types      every event type in the exports is folded without error; listed against the types the scripted scenarios produce
// Development evidence: these exports were read while the review was being answered.
//   node app/eval/run-graph/replay-recorded.mjs [--out FILE] [--scenario-types]
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as T from '../../core/run-graph.mjs';
import { nodeConversation } from '../../core/node-conversation.mjs';
import { truthRun } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.resolve(here, '../../../tools/run-view/samples');
export const EXPORTS = ['records-v3-dev-d4-s108', 'zoo-envfault', 'zoo-finished', 'zoo-nested', 'zoo-paused'];
const C = globalThis.RunViewCore;
const near = (a, b) => Math.abs(a - b) < 1e-9;

export function replayOne(name) {
  const x = JSON.parse(readFileSync(path.join(SAMPLES, `${name}.json`), 'utf8'));
  const { workflow, run, events } = x, calls = Object.values(x.calls ?? {});
  const journal = calls.map(c => ({ id: c.id, nodeKey: c.nodeKey, modelId: c.modelId, ok: c.ok, costUsd: c.costUsd ?? 0, imputedUsd: c.imputedUsd ?? 0, inputTokens: c.inputTokens ?? 0, outputTokens: c.outputTokens ?? 0 }));
  const model = T.foldEvents(workflow, events);
  const chainDoc = T.runGraph({ workflow, run, events, model, executing: false, level: 2 });
  const doc = T.runGraph({ workflow, run, events, model, executing: false, level: 2, journal });
  const checks = [];
  const check = (question, ok, detail = null, independent = true) => checks.push({ question, ok: !!ok, independent, ...(detail ? { detail } : {}) });
  check('run', doc.run.state.user === truthRun(run, false), `${doc.run.state.user} vs ${truthRun(run, false)}`, false);
  for (const n of workflow.nodes) {
    const truth = journal.filter(r => r.nodeKey === `root/${n.id}` || r.nodeKey.startsWith(`root/${n.id}:`) || r.nodeKey.startsWith(`root/${n.id}/`)).reduce((s, r) => s + r.costUsd, 0);
    const card = chainDoc.graph.cards.find(c => c.members.includes(n.id));
    check('cost', near(card.cost.usd, truth), `${n.id}: chain ${card.cost.usd} vs journal ${truth}`);
  }
  check('total', near(chainDoc.run.cost.usd, run.cost ?? 0), `chain ${chainDoc.run.cost.usd} vs header ${run.cost}`);
  for (const d of (x.decisions ?? []).filter(d => d.kind === 'escalation')) {
    const inst = model.insts.get(d.features.nodeKey);
    const expected = x.decisions.filter(e => e.kind === 'escalation' && e.features.nodeKey === d.features.nodeKey).length;
    check('escalations', inst?.escalations === expected, `${d.features.nodeKey}: ${inst?.escalations} vs ${expected} decision record(s)`);
  }
  if (['failed', 'uncertain'].includes(run.status)) {
    const f = doc.summary.failing, id = f?.nodeKey?.split('/').at(-1).replace(/:\d+$/, '');
    check('failing code', f?.code === run.error?.code, `${f?.code} vs header ${run.error?.code}`);
    check('failing step (weak)', !!id && String(run.error?.message ?? '').startsWith(`${id}:`), `${f?.nodeKey} vs message "${String(run.error?.message ?? '').slice(0, 40)}"`);
    const red = workflow.nodes.find(n => ['failed', 'envfault', 'uncertain'].includes(model.insts.get(`root/${n.id}`)?.state));
    check('failing code (B1, first red card)', model.insts.get(`root/${red?.id}`)?.error?.code === run.error?.code, red?.id ?? 'no red card');
  } else check('no failing step', doc.summary.failing === null, JSON.stringify(doc.summary.failing)?.slice(0, 80), false);
  // The header's status names only the most urgent wait (the runtime ranks awaiting_approval over awaiting_human), so it says that at least
  // one item of that kind waits, not that nothing else does (a first version of this check said "no question" and was wrong on zoo-paused).
  const want = { awaiting_approval: 'approval', awaiting_human: 'question' }[run.status];
  if (want) check('waiting', doc.waiting.some(w => w.kind === want), JSON.stringify(doc.waiting.map(w => [w.kind, w.nodeKey])), false);
  else if (['succeeded', 'failed', 'cancelled', 'uncertain'].includes(run.status)) check('waiting', doc.waiting.length === 0, JSON.stringify(doc.waiting.map(w => [w.kind, w.nodeKey])), false);
  if (run.status === 'succeeded') check('done', doc.run.state.user === 'done' && doc.graph.cards.every(c => !['working', 'needs_you'].includes(c.state.user)), doc.graph.cards.map(c => `${c.id}:${c.state.detail}`).join(' '), false);
  // A node's conversation: the instance with the most journaled calls.
  const byKey = new Map(); for (const c of calls) byKey.set(c.nodeKey, [...(byKey.get(c.nodeKey) ?? []), c]);
  const [key, own] = [...byKey].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (key) {
    const conv = nodeConversation({ workflow, run, events, model, nodeKey: key, calls: new Map(own.map(c => [c.id, c])) });
    const prompts = conv.turns.filter(t => t.kind === 'prompt'), replies = conv.turns.filter(t => ['reply', 'model-error'].includes(t.kind));
    check('conversation', prompts.length === own.length && prompts.every(p => p.promptVerified === true && p.prompt?.trust === 'untrusted') && replies.length === own.length && replies.every(r => r.value || r.reply || r.kind === 'model-error'),
      `${key}: ${prompts.length} prompts, ${replies.length} replies for ${own.length} journal rows`);
  }
  const types = [...new Set(events.map(e => e.type))].sort();
  return { name, status: run.status, events: events.length, calls: calls.length, real: calls.some(c => !/^scripted/.test(c.engineVersion ?? '')), types, checks, oneLine: doc.summary.oneLine };
}

// The event types the evaluation's named scenarios produce (recorded here with the real runtime), to say which recorded types they never do.
async function scenarioTypes() {
  const { NAMED } = await import('./scenarios.mjs'), { record } = await import('./harness.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'replay-types-')), types = new Set();
  try {
    for (const name of Object.keys(NAMED)) { const rec = await record(path.join(dir, name), { ...NAMED[name](), name }); if (rec.invalid) continue; for (const e of rec.events) types.add(e.type); rec.store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return types;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: a } = parseArgs({ options: { out: { type: 'string' }, 'scenario-types': { type: 'boolean', default: true } } });
  const runs = EXPORTS.map(replayOne);
  const recorded = new Set(runs.flatMap(r => r.types)), produced = a['scenario-types'] ? await scenarioTypes() : null;
  const tally = {};
  for (const r of runs) for (const c of r.checks) { tally[c.question] ??= { ok: 0, n: 0, independent: c.independent }; tally[c.question].n++; if (c.ok) tally[c.question].ok++; }
  const out = { generatedAt: new Date().toISOString(), evidence: 'development (exports read while answering the review)', exports: runs, tally,
    recordedTypes: [...recorded].sort(), notProducedByScenarios: produced ? [...recorded].filter(t => !produced.has(t)).sort() : null };
  if (a.out) writeFileSync(a.out, `${JSON.stringify(out, null, 1)}\n`);
  for (const r of runs) console.log(`${r.name}\t${r.status}\t${r.events} events\t${r.calls} calls${r.real ? ' (real model)' : ''}\tfailed checks: ${r.checks.filter(c => !c.ok).map(c => `${c.question} [${c.detail}]`).join('; ') || 'none'}`);
  for (const [q, t] of Object.entries(tally)) console.log(`${q}\t${t.ok}/${t.n}${t.independent ? '' : '  (consistency)'}`);
  console.log(`recorded types: ${out.recordedTypes.length}; not produced by the scripted scenarios: ${out.notProducedByScenarios?.join(', ') ?? 'not computed'}`);
}
