// B0 (plain executor) and B0+N (plain executor with append-only notes) on Claude Code headless.
// Same tools and per-task budget as every other agent arm; the repo and oracles are hidden.
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { runClaudeCode, readJsonFile } from '../../../src/executors/claude-code.mjs';
import { solverView } from '../beds.mjs';

const instructions = schema => [
  '',
  '---',
  'Inputs are in ./inputs.json (and ./files/ if present). Work autonomously; do not ask questions.',
  'Write your final answer to ./answer.json as JSON that matches this JSON Schema exactly:',
  '```json', JSON.stringify(schema, null, 1), '```',
].join('\n');

export function b0Agent({ id, model, budgetUsd = 1, timeoutMs = 15 * 60 * 1000, notes = false, effort = null }) {
  const def = { kind: notes ? 'b0n-agent' : 'b0-agent', model, budgetUsd, timeoutMs, effort, tools: 'default', notesWords: notes ? 200 : 0 };
  return {
    id, def, stateful: notes,
    async run({ task, outputSchema, workdir, state }) {
      const view = solverView(task);
      const files = { ...view.files };
      let prompt = view.prompt + instructions(outputSchema);
      if (notes && state.notes) {
        files['notes.md'] = state.notes;
        prompt += '\n\n./notes.md holds lessons you wrote after earlier tasks of this same kind. Read it first.';
      }
      const r = await runClaudeCode({ model, prompt, workdir, files, budgetUsd, timeoutMs, effort });
      return { output: readJsonFile(workdir, 'answer.json'), costUsd: r.costUsd, latencyMs: r.durationMs, error: r.error, meta: { turns: r.turns, tools: r.toolUses.length } };
    },
    // B0+N: after the oracle, the same model appends lessons given only the outcome bit.
    async afterTask({ task, result, verdict, workdir, state }) {
      if (!notes) return { costUsd: 0 };
      const dir = path.join(workdir, 'notes-update'); mkdirSync(dir, { recursive: true });
      const prompt = [
        `You just attempted a task of this kind:\n\n${task.prompt.slice(0, 4000)}`,
        `\nYour answer (answer.json) was judged: ${verdict.pass ? 'CORRECT' : 'INCORRECT'} by an independent checker (no further detail is available).`,
        '\nUpdate ./notes.md: keep useful existing lessons and add what you would do differently next time.',
        'Keep the whole file under 200 words. Write general lessons for future tasks of this kind, not answers to this specific task.',
      ].join('\n');
      const files = { 'notes.md': state.notes ?? '', 'answer.json': JSON.stringify(result.output ?? null, null, 1) };
      const r = await runClaudeCode({ model, prompt, workdir: dir, files, budgetUsd: Math.min(0.3, budgetUsd), timeoutMs: 5 * 60 * 1000 });
      const updated = existsSync(path.join(dir, 'notes.md')) ? readFileSync(path.join(dir, 'notes.md'), 'utf8') : state.notes;
      state.notes = (updated ?? '').split(/\s+/).slice(0, 260).join(' ');
      return { costUsd: r.costUsd };
    },
  };
}
