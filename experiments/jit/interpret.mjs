// JIT interpreter (SPEC §4): one Claude Code agent session on one task (the B0 arm's instructions, tools and
// answer.json contract), then the trace it leaves: answer, the scripts it wrote, the Bash commands it ran.
// Each interpretation is independent: it never sees earlier traces, a bed oracle or a reference solver.
import path from 'node:path';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { b0Agent } from '../lib/arms/b0-agent.mjs';
import { validateData } from '../../src/validate.mjs';

export const SCRIPT_EXT = new Set(['.mjs', '.js', '.py', '.sh']);
export const SCRIPT_CAP_BYTES = 20 * 1024, MAX_SCRIPTS = 40, COMMAND_CAP_CHARS = 20 * 1024;
// Directories never harvested: task files, dependency trees and VCS/cache state.
const SKIP_DIRS = new Set(['files', 'node_modules', '.git', '__pycache__', '.venv', 'venv', '.cache', '.npm']);

// Bed output schemas are host-owned (trusted). Returns { valid, errors }; never throws.
export function validateOutput(schema, output) {
  if (!schema) return { valid: true, errors: null };
  try { validateData(schema, output, 'output', { trustedSchema: true }); return { valid: true, errors: null }; }
  catch (error) { return { valid: false, errors: (error.details ?? [{ message: String(error.message ?? error) }]).slice(0, 5).map(e => `${e.instancePath ?? ''} ${e.message ?? ''}`.trim()) }; }
}

// Every regular file under dir (relative paths), skipping SKIP_DIRS at any depth and symlinks.
export function listFiles(dir, rel = '') {
  const out = [];
  let entries = [];
  try { entries = readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...listFiles(dir, r)); }
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

// Scripts the agent left: *.mjs|*.js|*.py|*.sh, not provided by the harness (inputs, files/, env client) and not
// present before the session started. Each is capped at SCRIPT_CAP_BYTES (bytes keeps the real size).
export function harvestScripts(workdir, { exclude = new Set() } = {}) {
  const scripts = [];
  for (const rel of listFiles(workdir)) {
    if (!SCRIPT_EXT.has(path.extname(rel)) || exclude.has(rel) || rel.startsWith('files/')) continue;
    const buf = readFileSync(path.join(workdir, rel));
    const truncated = buf.length > SCRIPT_CAP_BYTES;
    scripts.push({ path: rel, bytes: buf.length, text: buf.subarray(0, SCRIPT_CAP_BYTES).toString('utf8') + (truncated ? '\n/* [truncated by the harness at 20 KB] */\n' : ''), ...(truncated ? { truncated: true } : {}) });
    if (scripts.length >= MAX_SCRIPTS) break;
  }
  return scripts;
}

// Tool uses from the session transcript runClaudeCode writes into the workdir (same extraction as runClaudeCode).
export function transcriptToolUses(workdir) {
  const file = path.join(workdir, '.executor-transcript.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(e => e?.type === 'assistant')
    .flatMap(e => (e.message?.content ?? []).filter(c => c?.type === 'tool_use').map(c => ({ name: c.name, input: c.input })));
}

// The C0 transcript scan for paths outside the session's own workdir (construct.mjs `outside`): reviewed by hand.
const OUTSIDE = /\/(?:home|root|opt|mnt|var|run|srv|media|etc|proc)\/[\w.\/-]*/g;
export const outsidePathsOf = (toolUses, workdir) => {
  const own = path.resolve(workdir);
  const per = toolUses.map(u => (JSON.stringify(u.input ?? '').match(OUTSIDE) ?? []).filter(p => !p.startsWith(own)));
  return { hiddenPathAttempts: per.filter(p => p.length).length, outsidePaths: [...new Set(per.flat())].slice(0, 100) };
};

const sha = s => createHash('sha256').update(s).digest('hex');

// interpret(): runs the agent and packages the trace. trace.json is written in the workdir and returned.
// binary is the CLI (tests substitute a stand-in). Throws only on a harness bug; a session that cannot start
// (no sandbox, bad model id) comes back as a trace with error.code SANDBOX_UNAVAILABLE / EXECUTOR_LAUNCH and $0.
export async function interpret({ task, familyId, outputSchema = null, model, budgetUsd = 1, timeoutMs = 15 * 60 * 1000, workdir, effort = null, binary = 'claude', traceId = null }) {
  if (!task || !familyId || !model || !workdir) throw new Error('interpret needs task, familyId, model and workdir');
  mkdirSync(workdir, { recursive: true });
  const before = new Set(listFiles(workdir));
  const agent = b0Agent({ id: 'jit-interpreter', model, budgetUsd, timeoutMs, effort, binary });
  const started = Date.now();
  let r;
  try { r = await agent.run({ task, familyId, outputSchema, workdir, state: {} }); }
  catch (error) {
    // runClaudeCode throws only before the CLI starts: nothing was spent.
    r = { output: null, costUsd: 0, costUnknown: false, latencyMs: Date.now() - started, meta: {},
      error: { code: error.code === 'SANDBOX_UNAVAILABLE' ? 'SANDBOX_UNAVAILABLE' : 'EXECUTOR_LAUNCH', message: String(error.message ?? error).slice(0, 500) } };
  }
  // Provided by the harness: task inputs/files, the interactive env client, and anything present before the session.
  const exclude = new Set([...before, 'inputs.json', 'env.mjs', 'answer.json']);
  const toolUses = transcriptToolUses(workdir);
  const commands = toolUses.filter(u => u.name === 'Bash' && typeof u.input?.command === 'string').map(u => u.input.command.slice(0, COMMAND_CAP_CHARS));
  const { hiddenPathAttempts, outsidePaths } = outsidePathsOf(toolUses, workdir);
  const answer = r.output ?? null;
  const check = answer == null ? { valid: false, errors: ['no answer.json'] } : validateOutput(outputSchema, answer);
  const view = { prompt: task.prompt, inputs: task.inputs ?? {}, ...(task.files ? { files: task.files } : {}) };
  const trace = {
    traceId: traceId ?? `tr-${sha(`${workdir}|${started}|${model}`).slice(0, 12)}`,
    taskId: task.id ?? null, seed: task.seed ?? null, difficulty: task.difficulty ?? null, split: task.split ?? null, familyId,
    model, effort, budgetUsd,
    answer, answerValid: check.valid, answerErrors: check.errors,
    costUsd: r.costUsd ?? 0, costUnknown: !!r.costUnknown, latencyMs: r.latencyMs ?? (Date.now() - started), error: r.error ?? null,
    scripts: harvestScripts(workdir, { exclude }), commands,
    turns: r.meta?.turns ?? null, tools: r.meta?.tools ?? toolUses.length, sessionId: r.meta?.sessionId ?? null,
    nestedModelAttempts: r.meta?.nestedModelAttempts ?? 0, hiddenPathAttempts, outsidePaths,
    streamUsage: r.meta?.streamUsage ?? null,
    task: view, taskSha256: sha(JSON.stringify(view)),
    workdir, createdAt: new Date(started).toISOString(),
  };
  writeFileSync(path.join(workdir, 'trace.json'), JSON.stringify(trace, null, 1));
  return trace;
}

// A trace is a usable compile input only with an answer (the compiler distils answers, not failures).
export const usableTrace = t => t != null && t.answer != null;
