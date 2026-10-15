// B0 (plain executor) and B0+N (plain executor with append-only notes) on Claude Code headless.
// Same tools and per-task budget as every other agent arm; the repo and oracles are hidden.
// procedureFile (need router v1, agent-H+proc): the agent gets PROCEDURE.md (written once per lineage by a procedure
// writer from example tasks) and one prompt line telling it to follow it and write checks.json; the checks it reports
// become the row's selfVerdict (all true = pass).
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runClaudeCode, readJsonFile, nestedModelUses } from '../../../src/executors/claude-code.mjs';
import { solverView, loadFamily } from '../beds.mjs';
import { startServices, Ledger } from '../services.mjs';
import { messageUsageOf, accessedOutsidePaths, taskHostPaths, HOST_ROOTS } from '../../c0/construct.mjs';

// The one prompt line of agent-H+proc (PREREG-NEED-V1 §4.1); its sha256 is part of the engine stamp.
export const PROCEDURE_FILE = 'PROCEDURE.md', CHECKS_FILE = 'checks.json';
export const PROCEDURE_LINE = 'Follow the procedure in ./PROCEDURE.md. Before you finish, write ./checks.json: a JSON array with one {"check": "<the check as written>", "pass": true or false} entry for each check listed in PROCEDURE.md, judged against your final answer.';
const sha16 = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
// Hidden-path scan of an agent session (need router v1: a draw that reaches outside its workdir is voided). It counts only
// paths a tool use accesses (experiments/c0/construct.mjs accessedOutsidePaths: file-tool path arguments and Bash commands
// without heredoc bodies; never Write or Edit content or Grep patterns), and a path the task itself states is not an
// attempt (`ignore`, from taskHostPaths). mentionedPaths is the older scan of every string of a tool input (the same host
// roots as construct()'s `outside` closure, which other code reads as text and is therefore left as it is): its hits are
// recorded for review by hand and never void anything. /tmp is private to the sandbox, so it is not listed.
const HOST_PATH = new RegExp(`/(?:${HOST_ROOTS.join('|')})/[\\w./-]*`, 'g');
export function outsidePaths(toolUses = [], allowedRoots = [], { ignore = new Set() } = {}) {
  return accessedOutsidePaths(toolUses, allowedRoots, { ignore });
}
export function mentionedPaths(toolUses = [], allowedRoots = []) {
  const outside = u => (JSON.stringify(u?.input ?? '').match(HOST_PATH) ?? []).filter(p => !allowedRoots.some(r => r && p.startsWith(r)));
  return { attempts: toolUses.filter(u => outside(u).length).length, paths: [...new Set(toolUses.flatMap(outside))] };
}
/** The self-verdict an agent reported in checks.json: 'pass' when every check passed, 'fail' when any failed, null when
 *  the file is missing, empty or not a list of {pass: boolean} (the object form {"<check>": boolean} is accepted too). */
export function checksVerdict(checks) {
  const list = Array.isArray(checks) ? checks.map(c => c?.pass) : checks && typeof checks === 'object' ? Object.values(checks) : null;
  if (!list || !list.length || !list.every(v => typeof v === 'boolean')) return null;
  return list.every(Boolean) ? 'pass' : 'fail';
}

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

// binary: the CLI to run (tests substitute a stand-in; not part of the arm definition). executor: the session runner
// (runClaudeCode; tests and label-run --dry substitute a stub with its result shape; not part of the definition either).
// procedureFile: a host path read once here; its sha enters the definition (each lineage is its own arm version). Without
// it the definition, the prompt and the arm hash are exactly as before.
export function b0Agent({ id, model, budgetUsd = 1, timeoutMs = 15 * 60 * 1000, notes = false, effort = null, binary = 'claude', procedureFile = null, executor = runClaudeCode }) {
  const procedure = procedureFile ? readFileSync(procedureFile, 'utf8') : null;
  const def = { kind: notes ? 'b0n-agent' : 'b0-agent', model, budgetUsd, timeoutMs, effort, tools: 'default', notesWords: notes ? 200 : 0,
    ...(procedure !== null ? { procedureSha: sha16(procedure), procedureLineSha: sha16(PROCEDURE_LINE) } : {}) };
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
      if (procedure !== null) { files[PROCEDURE_FILE] = procedure; prompt += `\n\n${PROCEDURE_LINE}`; }
      let r;
      try { r = await executor({ model, prompt, workdir, files, budgetUsd, timeoutMs, effort, binary }); }
      finally { await svc?.close(); }
      const outside = outsidePaths(r.toolUses, [workdir], { ignore: taskHostPaths([view.prompt, view.files]) }), mentioned = mentionedPaths(r.toolUses, [workdir]);
      const checks = procedure !== null ? readJsonFile(workdir, CHECKS_FILE) : undefined;
      // A killed session (no result event) is charged at its budget bound, never $0; costUnknown marks it.
      return { output: readJsonFile(workdir, 'answer.json'), costUsd: r.costUsd ?? r.costUpperUsd, costUnknown: r.costUnknown, latencyMs: r.durationMs, error: r.error,
        meta: { turns: r.turns, tools: r.toolUses.length, costUnknown: r.costUnknown, costUpperUsd: r.costUpperUsd, streamUsage: r.streamUsage,
          nestedModelAttempts: nestedModelUses(r.toolUses), sessionId: r.sessionId,
          // Need router v1 additions: per-message usage for the one re-priced cost meter, and the hidden-path scan.
          messageUsage: r.transcript ? messageUsageOf(r.transcript) : null, hiddenPathAttempts: outside.attempts, outsidePaths: outside.paths.slice(0, 20),
          taskPathsIgnored: outside.ignored.length, pathMentions: mentioned.attempts, mentionedPaths: mentioned.paths.slice(0, 20),
          ...(procedure !== null ? { selfVerdict: checksVerdict(checks), checks: Array.isArray(checks) ? checks.length : checks && typeof checks === 'object' ? Object.keys(checks).length : 0 } : {}) } };
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
      const r = await executor({ model, prompt, workdir: dir, files, budgetUsd: Math.min(0.3, budgetUsd), timeoutMs: 5 * 60 * 1000, binary });
      const updated = existsSync(path.join(dir, 'notes.md')) ? readFileSync(path.join(dir, 'notes.md'), 'utf8') : state.notes;
      state.notes = (updated ?? '').split(/\s+/).slice(0, 260).join(' ');
      return { costUsd: r.costUsd ?? r.costUpperUsd };
    },
  };
}
