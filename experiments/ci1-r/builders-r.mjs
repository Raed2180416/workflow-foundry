// CI-1 review arms (research/ci1-20261021/r/PREREG-CI1-R.md). New file: the frozen arms (experiments/ci1/builders.mjs) are unchanged.
//   A0p   PracticeOneShotBuilder: A0's prompt and system (no worked examples, no retrieval, no self-review), then the compose path's
//         code-owned loop WITHOUT the review call: strict validation -> a practice run in the item's PUBLIC world; a validation error
//         or a run that does not finish goes back to the model with the same feedback text the compose path sends; at most 3 repairs.
//         It isolates "practice run" (review finding 5) from the worked examples and the self-review of A1c.
//   A1cH  A1c + every blind card in every prompt, nothing retrieved (retrieve-r.mjs staticCards): "better instructions" vs "retrieval".
//   A2b   A2 with the blind cards (retrieve-r.mjs retrieveWith): the same retrieval, cards written by a session that never saw the bed.
//   A2    the frozen A2 (run-arm.mjs makeBuilderFactory), rerun under the isolated CLI configuration as the same-session control.
import { randomUUID } from 'node:crypto';
import { FoundryError } from '../../src/data.mjs';
import { ONE_SHOT_SYSTEM, ComposeBuilder, practiceText } from '../ci1/builders.mjs';
import { sharedBlocks } from '../ci1/prompt.mjs';
import { validateCi1, runBuilt } from '../ci1/foundry-world.mjs';
import { buildIndex } from '../ci1/retrieve.mjs';
import { makeBuilderFactory } from '../ci1/run-arm.mjs';
import { retrieveWith, staticCards, BLIND_HINTS } from './retrieve-r.mjs';

export const BUILDERS_R_VERSION = 'ci1-builders-r/1';
export const R_ARMS = Object.freeze(['A0p', 'A1cH', 'A2b', 'A2']);
// the same decision schema and repair texts as experiments/ci1/builders.mjs (copied: they are not exported there)
const DECISION_SCHEMA = { type: 'object', additionalProperties: false, required: ['decision', 'reason', 'questions', 'workflow'], properties: {
  decision: { type: 'string', enum: ['build', 'ask', 'none'] },
  reason: { type: 'string', description: 'One sentence.' },
  questions: { type: 'array', description: 'Only with decision ask: at most 3.', items: { type: 'object', additionalProperties: false, required: ['id', 'question'], properties: { id: { type: 'string' }, question: { type: 'string' } } } },
  workflow: { type: 'object', description: 'With decision build: the complete workflow object. Otherwise {}.' } } };
const sum = (calls, k) => calls.reduce((s, c) => s + (c[k] ?? 0), 0);
function report(id, model, state) {
  return { builder: id, model, runId: state.runId, calls: state.calls.length, inputTokens: sum(state.calls, 'inputTokens'), outputTokens: sum(state.calls, 'outputTokens'),
    cacheReadTokens: sum(state.calls, 'cacheReadTokens'), cacheWriteTokens: sum(state.calls, 'cacheWriteTokens'), costUsd: Math.round(sum(state.calls, 'costUsd') * 1e6) / 1e6,
    costUnknown: state.calls.some(c => c.costUnknown), wallMs: Date.now() - state.started, repairs: state.repairs, practiceRuns: state.practice ?? [], escalations: [],
    selection: null, retrieval: null, callLog: state.calls };
}
async function typedCall(builder, state, nodeKey, system, prompt, schema, { maxTokens = 16000 } = {}) {
  let feedback = null;
  for (let attempt = 0; attempt <= builder.schemaRetries; attempt++) {
    const started = Date.now();
    let r;
    try { r = await builder.port.call({ runId: state.runId, nodeKey, attempt, modelId: builder.model, system, prompt: feedback ? `${prompt}\n\nYour previous reply was refused: ${feedback}. Reply again with JSON that matches the schema.` : prompt, schema, decoding: { maxTokens } }); }
    catch (error) { r = { ok: false, error: { code: error.code ?? 'ERROR', message: error.message }, usage: {} }; }
    state.calls.push({ nodeKey, attempt, modelId: builder.model, ok: !!r.ok, error: r.ok ? null : { code: r.error?.code ?? null, message: String(r.error?.message ?? '').slice(0, 300) },
      inputTokens: r.usage?.inputTokens ?? 0, outputTokens: r.usage?.outputTokens ?? 0, cacheReadTokens: r.usage?.cacheReadTokens ?? 0, cacheWriteTokens: r.usage?.cacheWriteTokens ?? 0,
      costUsd: r.costUsd ?? 0, costUnknown: !!r.costUnknown, latencyMs: r.latencyMs ?? Date.now() - started, journalId: r.journalId ?? null });
    if (r.ok) return r.value;
    if (!['MODEL_SCHEMA', 'MODEL_TRUNCATED'].includes(r.error?.code)) throw new FoundryError('BUILDER_MODEL', `${nodeKey} failed: ${r.error?.code}: ${String(r.error?.message ?? '').slice(0, 300)}`, { code: r.error?.code });
    feedback = r.error.code === 'MODEL_TRUNCATED' ? 'it was cut off at the length limit; write a shorter workflow (less prose, the same logic)' : (r.error.feedback ?? 'it did not match the schema');
  }
  throw new FoundryError('BUILDER_MODEL', `no valid answer for ${nodeKey} after ${builder.schemaRetries} retries`, { code: 'MODEL_SCHEMA' });
}
const errorsText = v => v.errors.slice(0, 20).map(e => `- ${e.code}${e.path ? ` at ${e.path}` : ''}: ${String(e.message).slice(0, 300)}${e.repair?.hint ? ` (how to fix: ${String(e.repair.hint).slice(0, 400)})` : ''}`).join('\n');
const asked = out => out.decision === 'ask' && (out.questions ?? []).length;
const questionsOf = out => out.questions.slice(0, 3).map((q, i) => ({ id: String(q.id || `q${i + 1}`).slice(0, 64), slot: null, question: String(q.question).slice(0, 300), why: '' }));

export class PracticeOneShotBuilder {
  constructor({ port, model = 'claude-haiku-5-5', maxRepairs = 3, schemaRetries = 2, runPrefix = 'ci1r-a0p', practiceRoot = null } = {}) {
    if (!port || typeof port.call !== 'function') throw new FoundryError('BUILDER_PORT', 'A0p needs a ModelPort');
    Object.assign(this, { port, model, maxRepairs, schemaRetries, runPrefix, practiceRoot });
    this.id = `${BUILDERS_R_VERSION}/one-shot+practice (${model}; practice in the public world; no review; <= ${maxRepairs} repairs)`;
  }
  async build({ request, workspace, answers = {}, runId = null, practiceWorld }) {
    const state = { runId: runId ?? `${this.runPrefix}-${randomUUID()}`, calls: [], repairs: [], practice: [], started: Date.now() };
    try {
      const prompt = sharedBlocks({ request, workspace, answers }).join('\n\n');
      const out = await typedCall(this, state, 'build', ONE_SHOT_SYSTEM, `${prompt}\n\nDecide: build, ask or none.`, DECISION_SCHEMA);
      if (out.decision === 'none') return { status: 'unsupported', builder: this.id, reply: out.reason, buildReport: report(this.id, this.model, state) };
      if (asked(out)) return { status: 'needs_answers', builder: this.id, questions: questionsOf(out), buildReport: report(this.id, this.model, state) };
      let workflow = out.workflow ?? {};
      for (let round = 0; round <= this.maxRepairs; round++) {
        const v = validateCi1(workflow);
        let feedback, kind;
        if (!v.valid) { kind = 'validation'; feedback = `It failed validation:\n${errorsText(v)}`; }
        else {
          const run = await runBuilt(workflow, practiceWorld, { root: this.practiceRoot });
          state.practice.push({ round, status: run.status, error: run.error ? `${run.error.code ?? ''} ${String(run.error.message ?? '').slice(0, 200)}` : null,
            effects: { mail: run.effects.outbox.length, chat: Object.values(run.effects.chat).reduce((s, t) => s + t.length, 0), replies: run.effects.replies.length } });
          if (run.status === 'succeeded') return { status: 'ready', builder: this.id, workflow, reviewed: null, buildReport: report(this.id, this.model, state) };
          kind = 'practice-run'; feedback = `It did not finish its practice run.\n${practiceText(practiceWorld, run)}`;
        }
        state.repairs.push({ round, kind, feedback: feedback.slice(0, 4000) });
        if (round === this.maxRepairs) break;
        const fixed = await typedCall(this, state, `repair.r${round}`, ONE_SHOT_SYSTEM, `${prompt}\n\nYour workflow:\n${JSON.stringify(workflow)}\n\n${feedback}\n\nReturn the corrected complete workflow with decision build.`, DECISION_SCHEMA);
        workflow = fixed.workflow ?? {};
      }
      return { status: 'build_failed', builder: this.id, workflow, buildReport: report(this.id, this.model, state) };
    } catch (error) { error.buildReport = report(this.id, this.model, state); throw error; }
  }
}

/** item => builder, for one review arm. */
export function makeBuilderFactoryR(arm, { port, model = 'claude-haiku-5-5', hintsFile = BLIND_HINTS } = {}) {
  if (arm === 'A0p') { const b = new PracticeOneShotBuilder({ port, model }); return () => b; }
  if (arm === 'A1cH') { const fixed = staticCards(hintsFile); const b = new ComposeBuilder({ port, model, runPrefix: 'ci1r-a1ch', retrieval: () => fixed }); return () => b; }
  if (arm === 'A2b') { const index = buildIndex(); return item => new ComposeBuilder({ port, model, runPrefix: 'ci1r-a2b', retrieval: ({ request, workspace, draft }) => retrieveWith({ hintsFile, request, workspace, targetId: item.id, index, draft }) }); }
  if (arm === 'A2') return makeBuilderFactory('A2', { port, model });
  throw new Error(`unknown review arm ${arm}`);
}
