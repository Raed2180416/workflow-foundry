// Practice for ANY workflow (the free-form front door, app/FRONT-DOOR.md): the exact version runs in a fresh practice world per case, by
// code, at $0. app/core/practice.mjs (runInWorld) is frozen by the BUILDER-1 manifest, so this file repeats its loop and adds what a
// free-form workflow can need that a card never did:
//   - stand-in answers at human steps: the case's own answer for that step (by node id), else a schema-valid answer made by code
//     (generatePractice); each one is reported, so nobody mistakes a practice answer for the person's
//   - timers: a timer due within PRACTICE_TIMER_MS is waited out; a longer one stops practice with PRACTICE_TIMER (the honest result:
//     practice cannot show what happens after it). A timer whose `at` comes from the input can be practised with a time already due.
// The practice registry stands in for every outside effect (outbox, chat, sheets: files in the practice world; nobody is asked), so a
// practice pass is evidence about the workflow, not about delivery. Every outside action the run would have taken is listed with the
// digest that binds its full content (effectDigest), the same digest a live paused action must match.
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Foundry } from '../../src/foundry.mjs';
import { requireWorkflow } from '../../src/validate.mjs';
import { errorData, digest } from '../../src/data.mjs';
import { appRegistry } from './capabilities.mjs';
import { explainRun } from './failure-words.mjs';
import { seedWorld, readWorld, readOutbox } from './stand-ins.mjs';
import { generatePractice } from './freeform.mjs';

export const PRACTICE_TIMER_MS = 3000;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'uncertain']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const effectDigest = (tool, args) => digest({ tool, args });

/** The outside actions one practice run left: e-mails, posts and appended rows, each with the digest of its full content. */
export function wouldDoOf(effects, caseName = null) {
  return [
    ...effects.outbox.map(m => ({ action: 'send', to: m.to, subject: m.subject, preview: m.body.slice(0, 400), digest: effectDigest('outbox.send', { to: m.to, subject: m.subject, body: m.body }) })),
    ...Object.entries(effects.chat).flatMap(([channel, posts]) => posts.map(text => ({ action: 'post', to: channel, subject: null, preview: text.slice(0, 400), digest: effectDigest('chat.post', { channel, text }) }))),
    ...Object.entries(effects.appended).map(([sheet, rows]) => ({ action: 'append', to: sheet, subject: `${rows.length} row(s)`, count: rows.length, rows: rows.slice(0, 50),
      preview: JSON.stringify(rows.slice(0, 3)).slice(0, 400), digest: effectDigest('sheet.append', { sheet, rows }) }))
  ].map(item => (caseName ? { case: caseName, ...item } : item));
}

/** The node definition at a node key ("root/a/b:2/c"): the human step's id and answer schema. */
function defAt(workflow, nodeKey) {
  let nodes = workflow.nodes, def = null;
  for (const part of String(nodeKey).split('/').slice(1)) { const id = part.replace(/:\d+$/, ''); def = (nodes ?? []).find(n => n.id === id) ?? null; if (!def) return null; nodes = def.body?.nodes; }
  return def;
}

/**
 * Run `workflow` once in a fresh practice world for one case { name, input, sheets, answers }. Returns { name, status, passed, run,
 * explained, effects, wouldDo, answered[], waiting, error, dir }. Keeps the directory only when keep is true (the caller removes it).
 */
export async function practiseCase(workflow, practiceCase, { root = null, keep = false, maxSteps = 200 } = {}) {
  if (root) mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(path.join(root ?? tmpdir(), 'foundry-freeform-'));
  const worldDir = path.join(dir, 'world'), outboxDir = path.join(dir, 'outbox');
  mkdirSync(worldDir, { recursive: true, mode: 0o700 });
  const sheets = practiceCase.sheets ?? {};
  seedWorld(worldDir, { sheets });
  const registry = appRegistry({ mode: 'practice', outboxDir, worldDir });
  const foundry = new Foundry(path.join(dir, 'store'), { registry });
  const out = { name: practiceCase.name, dir, status: 'not-started', passed: false, answered: [], waiting: null, error: null, registryHash: registry.hash(), inputGenerated: !!practiceCase.inputGenerated };
  try {
    let staged;
    try { requireWorkflow(workflow, { registry, modelPolicy: foundry.modelPolicy }); staged = foundry.store.stageEvaluationWorkflow(workflow); }
    catch (error) { out.status = 'invalid'; out.error = { ...errorData(error), details: error.details ?? null }; return out; }
    let run;
    try { run = foundry.createRun(staged.hash, practiceCase.input ?? {}); }
    catch (error) { out.status = 'input-refused'; out.error = { ...errorData(error), details: error.details ?? null }; return out; }
    out.input = practiceCase.input ?? {};
    await foundry.startRun(run.id).catch(() => {});
    let current = foundry.publicRun(foundry.store.run(run.id));
    for (let step = 0; step < maxSteps && !TERMINAL.has(current.status); step++) {
      if (current.status === 'awaiting_human') {
        // A stand-in answers each question: the case's answer for that step, else one made from the answer schema by code.
        for (const { frameKey, nodeId, state } of foundry.store.rows.withStatus(run.id, 'awaiting_human')) {
          const nodeKey = `${frameKey}/${nodeId}`, def = defAt(workflow, nodeKey);
          const given = Object.hasOwn(practiceCase.answers ?? {}, nodeId);
          const answer = given ? practiceCase.answers[nodeId] : generatePractice(state.answerSchema ?? def?.answerSchema ?? {});
          try { foundry.runtime.answer(run.id, nodeKey, answer, { actor: 'practice stand-in', channel: 'practice' }); }
          catch (error) { out.error = { ...errorData(error), step: def?.description ?? nodeId }; out.status = 'answer-refused'; return finish(); }
          out.answered.push({ step: def?.description ?? nodeId, nodeId, answer, from: given ? 'practice case' : 'made by Foundry from the answer schema' });
        }
      } else if (current.status === 'waiting') {
        const timers = foundry.store.rows.withStatus(run.id, 'waiting').map(r => r.state?.wakeAt).filter(Number.isFinite);
        const due = timers.length ? Math.min(...timers) : null;
        if (due === null || due - Date.now() > PRACTICE_TIMER_MS) {
          out.waiting = { wakeAt: due === null ? null : new Date(due).toISOString() };
          out.status = 'waiting'; out.error = { code: 'PRACTICE_TIMER', message: `The practice run waits on a timer that is due ${due === null ? 'on a signal' : `at ${new Date(due).toISOString()}`}; practice does not wait that long.` };
          return finish();
        }
        await sleep(Math.max(0, due - Date.now()) + 20);
      } else if (current.status === 'awaiting_approval') {
        out.status = 'awaiting_approval'; out.error = { code: 'PRACTICE_APPROVAL', message: 'A practice action asked for approval; the practice registry should never ask.' };
        return finish();
      }
      await foundry.startRun(run.id).catch(() => {});
      current = foundry.publicRun(foundry.store.run(run.id));
    }
    return finish();
    function finish() {
      current = foundry.publicRun(foundry.store.run(run.id));
      const events = foundry.store.events(run.id);
      out.run = current; if (!['answer-refused', 'waiting', 'awaiting_approval'].includes(out.status)) out.status = current.status;
      out.verdict = current.verdict?.verdict ?? null;
      out.passed = current.status === 'succeeded' && out.verdict === 'pass';
      out.error = out.error ?? current.error ?? null;
      out.explained = explainRun(current, workflow, events);
      const world = readWorld(worldDir);
      out.effects = {
        outbox: readOutbox(outboxDir).filter(m => m.runId === run.id).map(m => ({ to: m.to, subject: m.subject, body: m.body })),
        chat: Object.fromEntries(Object.entries(world.chat).map(([c, posts]) => [c, posts.filter(p => p.runId === run.id).map(p => p.text)]).filter(([, p]) => p.length)),
        appended: Object.fromEntries(Object.entries(world.sheets).map(([name, rows]) => [name, rows.slice((sheets[name] ?? []).length)]).filter(([, r]) => r.length))
      };
      out.wouldDo = wouldDoOf(out.effects);
      return out;
    }
  } finally {
    await foundry.close();
    if (!keep) rmSync(dir, { recursive: true, force: true });
  }
}

/** The sheets a workflow reads by a literal name (sheet.read), so practice can say which ones need rows. */
export function sheetsRead(workflow) {
  const out = new Set();
  const walk = flow => { for (const n of flow?.nodes ?? []) { if (n.kind === 'task' && n.tool === 'sheet.read' && typeof n.args?.sheet === 'string') out.add(n.args.sheet); if (n.body) walk(n.body); } };
  walk(workflow);
  return [...out];
}

/** A short, model-facing account of why practice did not pass (for the free-form builder's repair turns and the agent). */
export function practiceFeedback(results) {
  const lines = [];
  for (const r of results) {
    if (r.passed) continue;
    lines.push(`Practice case "${r.name}" ended ${r.status}${r.verdict ? ` (verdict ${r.verdict})` : ''}.`);
    if (r.error) lines.push(`Failure: ${r.error.code}: ${String(r.error.message ?? '').slice(0, 400)}`);
    if (r.explained?.failedStep) lines.push(`Failed step: ${r.explained.failedStep}`);
    for (const c of r.explained?.checks ?? []) if (c.passed === false) lines.push(`Check failed: ${c.plain ?? c.exact}`);
  }
  return lines.join('\n');
}
