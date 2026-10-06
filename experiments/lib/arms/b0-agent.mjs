// B0 (plain executor) and B0+N (plain executor with append-only notes) on Claude Code headless.
// Same tools and per-task budget as every other agent arm; the repo and oracles are hidden.
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { runClaudeCode, readJsonFile } from '../../../src/executors/claude-code.mjs';
import { solverView, loadFamily } from '../beds.mjs';
import { startServices, Ledger } from '../services.mjs';

// Client the agent runs inside its sandbox to drive an interactive bed through the host env service.
export const ENV_CLIENT = `#!/usr/bin/env node
// Usage: node env.mjs create | observe | actions | step "<action>" | snapshot | restore <id> | reset
import { readFileSync, appendFileSync } from 'node:fs';
const { url, token } = JSON.parse(readFileSync(new URL('./.env-service.json', import.meta.url)));
const [op, ...rest] = process.argv.slice(2);
const state = (() => { try { return JSON.parse(readFileSync(new URL('./.env-episode.json', import.meta.url))); } catch { return {}; } })();
const body = op === 'create' ? { probe: 0 } : op === 'step' ? { episode: state.episode, action: rest.join(' ') } : op === 'restore' ? { episode: state.episode, snapshot: rest[0] } : { episode: state.episode };
const res = await fetch(url + '/env/' + op, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const out = await res.json();
if (op === 'create' && out.episode) (await import('node:fs')).writeFileSync(new URL('./.env-episode.json', import.meta.url), JSON.stringify({ episode: out.episode }));
if (op === 'step') appendFileSync(new URL('./.env-actions.log', import.meta.url), rest.join(' ') + '\\n');
console.log(JSON.stringify(out, null, 1));
`;

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
    async run({ task, familyId, outputSchema, workdir, state }) {
      const view = solverView(task);
      const files = { ...view.files };
      let prompt = view.prompt + instructions(outputSchema);
      const fam = await loadFamily(familyId);
      let svc = null;
      if (fam.family.kind === 'interactive') {
        svc = await startServices({ modelPort: null, ledger: new Ledger({ capUsd: 0 }), familyId, probes: [task], scoreLimit: 0 });
        files['env.mjs'] = ENV_CLIENT;
        files['.env-service.json'] = JSON.stringify({ url: svc.url, token: svc.token });
        prompt += '\n\nThis task is interactive. Drive the environment with `node env.mjs create` (once), then `node env.mjs observe|actions|step "<action>"|snapshot|restore <id>|reset`. Only the actions you list in answer.json are replayed by the checker from a fresh start, so answer.json must contain the complete action sequence of your final successful play.';
      }
      if (notes && state.notes) {
        files['notes.md'] = state.notes;
        prompt += '\n\n./notes.md holds lessons you wrote after earlier tasks of this same kind. Read it first.';
      }
      let r;
      try { r = await runClaudeCode({ model, prompt, workdir, files, budgetUsd, timeoutMs, effort }); }
      finally { await svc?.close(); }
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
