// B0-call: one structured model call with the whole task (no tools, no decomposition), and
// B0+N-call: the same with append-only notes written by the same model after each task, given
// only the outcome bit. Every call goes through the experiment's journaled ModelPort.
import { inlineRender } from '../beds.mjs';

const SYSTEM = 'You solve the task below. Read all of it carefully, follow its rules exactly, and return only the final answer as JSON matching the provided schema.';

export function b0Call({ id, model, modelPort, notes = false, maxTokens = 16000, reasoning = 'medium' }) {
  const def = { kind: notes ? 'b0n-call' : 'b0-call', model, maxTokens, reasoning, system: SYSTEM, notesWords: notes ? 200 : 0 };
  return {
    id, def, stateful: notes,
    async run({ task, taskKey, trial, outputSchema, state }) {
      let prompt = inlineRender(task);
      if (notes && state.notes) prompt = `## Notes you wrote after earlier tasks of this kind\n${state.notes}\n\n${prompt}`;
      const r = await modelPort.call({ runId: `${id}:${taskKey}:t${trial}`, nodeKey: 'b0', modelId: model, system: SYSTEM, prompt,
        schema: outputSchema, decoding: { maxTokens, reasoning }, salt: `${id}:t${trial}` });
      return { output: r.ok ? r.value : null, costUsd: r.costUsd, imputedUsd: r.imputedUsd, latencyMs: r.latencyMs, error: r.ok ? null : r.error, meta: { tokensIn: r.usage?.inputTokens, tokensOut: r.usage?.outputTokens } };
    },
    async afterTask({ task, taskKey, trial, result, verdict, state }) {
      if (!notes) return { costUsd: 0 };
      const schema = { type: 'object', properties: { notes: { type: 'string', maxLength: 1600 } }, required: ['notes'], additionalProperties: false };
      const prompt = [`Task you attempted (abridged):\n${task.prompt.slice(0, 3000)}`, `\nYour answer was judged ${verdict.pass ? 'CORRECT' : 'INCORRECT'} by an independent checker (no other detail is available).`,
        `\nYour current notes:\n${state.notes ?? '(none)'}`, '\nRewrite the notes (at most 200 words): keep useful lessons, add what you would do differently. General lessons for future tasks of this kind only.'].join('\n');
      const r = await modelPort.call({ runId: `${id}:${taskKey ?? task.id}:t${trial ?? 0}:notes`, nodeKey: 'notes', modelId: model, system: 'You maintain concise working notes.', prompt, schema, decoding: { maxTokens: 800, reasoning: 'low' } });
      if (r.ok) state.notes = r.value.notes;
      return { costUsd: r.costUsd };
    },
  };
}
