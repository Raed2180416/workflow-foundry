// Swarm ladder rung 1 arms (research/swarm-20261021/PREREG-SWARM-R1.md): on the same task, with the same per-task
// dollar and wall-clock caps,
//   A  single Haiku agent: Claude Code headless, tools Bash/Read/Write/Edit/Glob/Grep (experiments/lib/arms/b0-agent.mjs);
//   S  Haiku swarm: the same session plus the built-in Agent tool, every subagent forced onto Haiku, at most 8 running
//      at a time and 32 in a session, nesting depth 1, and a frozen task-agnostic lead preamble (who decomposes: a model,
//      at run time);
//   W  Haiku-built fixed workflow: a solve.mjs a Haiku builder wrote once on dev probes (experiments/c0/construct.mjs,
//      arm B1), run per task with only the model gateway (experiments/lib/arms/b1-script.mjs) (who decomposes: code,
//      at build time).
// Every arm archives its raw record (transcript or solver stdout/stderr/calls) outside the repository, gzipped, so a
// failure can be root-caused after the workdir is gone, and reports the models it used: any model other than Haiku 5.5
// voids the trial (coordination code K11).
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { runClaudeCode, DEFAULT_TOOLS, readJsonFile, nestedModelUses } from '../../src/executors/claude-code.mjs';
import { b0Agent, outsidePaths, mentionedPaths } from '../lib/arms/b0-agent.mjs';
import { b1Script } from '../lib/arms/b1-script.mjs';
import { solverView } from '../lib/beds.mjs';
import { messageUsageOf, taskHostPaths, repoPathMentions } from '../c0/construct.mjs';
import { parseSpawnTree, readEvents } from './spawn-tree.mjs';

export const MODEL = 'claude-haiku-5-5';
export const MAX_CONCURRENT = 8, MAX_WORKERS = 32;
// The swarm runtime's knobs (CLI 2.1.318 reads each; names found in the binary, behaviour checked by probe-agent.mjs).
export const SWARM_ENV = Object.freeze({
  CLAUDE_CODE_SUBAGENT_MODEL: MODEL,
  CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1',
  CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: String(MAX_CONCURRENT),
  CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: String(MAX_WORKERS),
  CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1',
});
export const SWARM_TOOLS = Object.freeze([...DEFAULT_TOOLS, 'Agent']);
export const SWARM_ARGS = Object.freeze(['--forward-subagent-text']);

// The lead preamble: task-agnostic (no R6 hint, no coverage-check instruction: that is rung 2's treatment), <= 150 words,
// built from the delegation-brief elements of Anthropic's multi-agent research system (objective, output format, sources,
// boundaries) and its effort rule (split only large independent parts). Frozen by its sha256 in the arm definition.
export const LEAD_PREAMBLE = [
  'You lead a team. The Agent tool starts workers: parallel subagents with fresh, empty contexts and the same file tools as you.',
  `Up to ${MAX_CONCURRENT} run at a time and at most ${MAX_WORKERS} can be started in total.`,
  'Delegate when the work splits into independent parts that are each large; do small or tightly coupled work yourself.',
  'Give every worker a self-contained brief: its objective, the exact files or items it covers, every rule it needs (it cannot see this conversation or the task text unless you include it or point to the file), what to return (compact JSON in its final message), and its boundaries (read anything, write only under ./work/<its name>/).',
  'Start independent workers in the same message so they run in parallel.',
  'You own ./answer.json: merge the workers\' results, resolve conflicts, and write it yourself.',
].join(' ');
export const sha16 = text => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** Per-model usage from a session's result event (modelUsage), or null. */
export function modelUsageOf(events) {
  const result = [...events].reverse().find(e => e?.type === 'result');
  if (!result?.modelUsage) return null;
  return Object.fromEntries(Object.entries(result.modelUsage).map(([m, u]) => [m, { costUsd: u.costUSD ?? null, in: u.inputTokens ?? 0, out: u.outputTokens ?? 0,
    cacheRead: u.cacheReadInputTokens ?? 0, cacheWrite: u.cacheCreationInputTokens ?? 0 }]));
}
/** Models other than `model` that served any message (assistant events or result modelUsage); [] when clean. */
export function driftOf({ modelUsage = null, messageModels = {} } = {}, model = MODEL) {
  const seen = new Set([...Object.keys(modelUsage ?? {}), ...Object.keys(messageModels ?? {})]);
  return [...seen].filter(m => m && m !== '<synthetic>' && !m.startsWith(model)).sort();
}

export function archiveDirOf(root, armId, taskKey, trial) {
  const dir = path.join(root, armId, `${taskKey.replaceAll(':', '_')}_t${trial}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
const gzCopy = (from, to) => { if (existsSync(from)) writeFileSync(to, gzipSync(readFileSync(from))); };

// Files a session wrote under its workdir (not the task's own inputs, not the transcript): { relative path: text }, each
// file at most 256 KB and 2 MB in all, so a worker's result files survive the workdir for the coordination coder.
export const WORK_FILE_MAX = 256 * 1024, WORK_FILES_MAX = 2 * 1024 * 1024;
export function sessionFiles(workdir, { skip = new Set(['inputs.json', 'answer.json', '.executor-transcript.jsonl']) } = {}) {
  const out = {};
  let total = 0;
  const walk = (dir, rel) => {
    let names; try { names = readdirSync(dir).sort(); } catch { return; }
    for (const n of names) {
      const p = path.join(dir, n), r = rel ? `${rel}/${n}` : n;
      if (!rel && (n === 'files' || skip.has(n))) continue;
      let s; try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) { walk(p, r); continue; }
      if (!s.isFile() || s.size > WORK_FILE_MAX || total + s.size > WORK_FILES_MAX) continue;
      out[r] = readFileSync(p, 'utf8'); total += s.size;
    }
  };
  walk(workdir, '');
  return out;
}

// Post-process a Claude Code session's workdir: per-model usage, the spawn tree summary, drift; archive the transcript, the
// answer, the tree and the files the session wrote. Returns meta additions.
export function sessionFacts({ workdir, archive }) {
  const file = path.join(workdir, '.executor-transcript.jsonl');
  const events = existsSync(file) ? readEvents(readFileSync(file, 'utf8')) : [];
  const tree = parseSpawnTree(events);
  const modelUsage = modelUsageOf(events);
  const written = sessionFiles(workdir);
  if (archive) {
    gzCopy(file, path.join(archive, 'transcript.jsonl.gz'));
    if (existsSync(path.join(workdir, 'answer.json'))) writeFileSync(path.join(archive, 'answer.json'), readFileSync(path.join(workdir, 'answer.json')));
    writeFileSync(path.join(archive, 'tree.json'), JSON.stringify(tree));
    writeFileSync(path.join(archive, 'work-files.json.gz'), gzipSync(JSON.stringify(written)));
  }
  const result = [...events].reverse().find(e => e?.type === 'result') ?? null;
  return { modelUsage, messageModels: tree.models, drift: driftOf({ modelUsage, messageModels: tree.models }), workers: tree.workers.length, batches: tree.batches.length,
    maxConcurrent: tree.maxConcurrent, criticalSteps: tree.criticalSteps, leadTurns: tree.lead.turns, leadToolUses: tree.lead.toolUses,
    subagentStats: result?.subagent_stats ?? null, timing: tree.timing, filesWritten: Object.keys(written).length,
    workersUnreturned: tree.workers.filter(w => w.result == null).length };
}

const withFacts = (arm, archiveRoot) => ({
  ...arm,
  async run(ctx) {
    const r = await arm.run(ctx);
    const archive = archiveRoot ? archiveDirOf(archiveRoot, arm.id, ctx.taskKey, ctx.trial) : null;
    let facts = null;
    try { facts = sessionFacts({ workdir: ctx.workdir, archive }); } catch (error) { facts = { factsError: String(error.message ?? error).slice(0, 300) }; }
    return { ...r, meta: { ...(r.meta ?? {}), ...facts } };
  },
});

/** A: the single Haiku agent (the simple baseline). */
export function agentArm({ id = 'A-agent-haiku', budgetUsd, timeoutMs, archiveRoot = null, executor = runClaudeCode }) {
  return withFacts(b0Agent({ id, model: MODEL, budgetUsd, timeoutMs, executor }), archiveRoot);
}

const instructions = schema => [
  '', '---',
  'Inputs are in ./inputs.json (and ./files/ if present). Work autonomously; do not ask questions.',
  'Write your final answer to ./answer.json as JSON that matches this JSON Schema exactly:',
  '```json', JSON.stringify(schema, null, 1), '```',
].join('\n');

/** S: the Haiku swarm. The prompt is A's prompt plus the lead preamble; the tools are A's plus Agent. */
export function swarmArm({ id = 'S-swarm-haiku', budgetUsd, timeoutMs, archiveRoot = null, executor = runClaudeCode }) {
  const def = { kind: 'swarm-native', model: MODEL, budgetUsd, timeoutMs, tools: SWARM_TOOLS.join(','), env: SWARM_ENV, extraArgs: SWARM_ARGS, preambleSha: sha16(LEAD_PREAMBLE) };
  const arm = {
    id, def, stateful: false,
    async run({ task, outputSchema, workdir }) {
      const view = solverView(task);
      const prompt = view.prompt + instructions(outputSchema) + '\n\n' + LEAD_PREAMBLE;
      const r = await executor({ model: MODEL, prompt, workdir, files: view.files, budgetUsd, timeoutMs, tools: [...SWARM_TOOLS], env: { ...SWARM_ENV }, extraArgs: [...SWARM_ARGS] });
      // The same hidden-path scans as the single agent (b0-agent.mjs), over the lead's and (forwarded) every worker's tool uses.
      const stated = taskHostPaths([view.prompt, view.files]);
      const outside = outsidePaths(r.toolUses, [workdir], { ignore: stated }), mentioned = mentionedPaths(r.toolUses, [workdir]);
      const repo = repoPathMentions(r.toolUses, { ignoreText: JSON.stringify([view.prompt, view.files]), counted: u => outsidePaths([u], [workdir], { ignore: stated }).attempts > 0 });
      return { output: readJsonFile(workdir, 'answer.json'), costUsd: r.costUsd ?? r.costUpperUsd, costUnknown: r.costUnknown, latencyMs: r.durationMs, error: r.error,
        meta: { turns: r.turns, tools: r.toolUses.length, costUnknown: r.costUnknown, costUpperUsd: r.costUpperUsd, streamUsage: r.streamUsage, finalUsage: r.usage ?? null,
          nestedModelAttempts: nestedModelUses(r.toolUses), sessionId: r.sessionId, messageUsage: r.transcript ? messageUsageOf(r.transcript) : null,
          hiddenPathAttempts: outside.attempts, outsidePaths: outside.paths.slice(0, 20), pathMentions: mentioned.attempts, repoPathMentions: repo.attempts } };
    },
  };
  return withFacts(arm, archiveRoot);
}

/** W: the Haiku-built fixed workflow (a B1 solve.mjs), with its solver record archived. */
export function workflowArm({ id = 'W-workflow-haiku', scriptPath, modelPort, perTaskUsd, timeoutMs, archiveRoot = null }) {
  const arm = b1Script({ id, scriptPath, modelPort, perTaskUsd, timeoutMs, allowedModels: [MODEL] });
  return {
    ...arm,
    async run(ctx) {
      const r = await arm.run(ctx);
      if (archiveRoot) {
        const archive = archiveDirOf(archiveRoot, id, ctx.taskKey, ctx.trial);
        for (const f of ['.solve.stdout', '.solve.stderr']) gzCopy(path.join(ctx.workdir, f), path.join(archive, f.slice(1) + '.gz'));
        gzCopy(path.join(ctx.workdir, 'tools', 'calls.jsonl'), path.join(archive, 'calls.jsonl.gz'));
      }
      return r;
    },
  };
}
