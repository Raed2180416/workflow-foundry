// Capability probe for the swarm arm (research/swarm-20261021): does Claude Code's built-in Agent tool work inside the
// Foundry executor sandbox (--safe-mode, empty MCP config), are subagents forced onto Haiku 5.5 by
// CLAUDE_CODE_SUBAGENT_MODEL(_FORCE), and does --forward-subagent-text put subagent turns into the transcript?
// Diagnostic only (a toy task, no bed, no oracle). Spend: one Haiku session, budget $0.15.
// Usage: node experiments/swarm/probe-agent.mjs <workdir> [--no-forward]
import path from 'node:path';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { runClaudeCode, DEFAULT_TOOLS, readJsonFile } from '../../src/executors/claude-code.mjs';
import { SWARM_ENV, MODEL } from './arms.mjs';
import { parseSpawnTree } from './spawn-tree.mjs';

const [workdir, flag] = process.argv.slice(2);
if (!workdir) throw new Error('usage: probe-agent.mjs <workdir> [--no-forward]');
rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
const words = { 'a.txt': 'heliotrope', 'b.txt': 'quarzite', 'c.txt': 'marlinspike' };
const prompt = [
  'There are three files: a.txt, b.txt and c.txt. Each holds one secret word.',
  'Use the Agent tool to start three subagents in parallel (one Agent call per file, all in the same message). Each subagent must read its one file and reply with only the word.',
  'Do not read the files yourself. When all three have replied, write ./answer.json as {"words": {"a.txt": "...", "b.txt": "...", "c.txt": "..."}}.',
].join('\n');
const r = await runClaudeCode({ model: MODEL, prompt, workdir, files: words, budgetUsd: 0.15, timeoutMs: 5 * 60 * 1000, tools: [...DEFAULT_TOOLS, 'Agent'],
  env: SWARM_ENV, extraArgs: flag === '--no-forward' ? [] : ['--forward-subagent-text'] });
const events = readFileSync(r.transcript, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const init = events.find(e => e.type === 'system' && e.subtype === 'init');
const result = [...events].reverse().find(e => e.type === 'result');
const tree = parseSpawnTree(events);
const out = {
  ok: r.ok, error: r.error?.code ?? null, costUsd: r.costUsd, turns: r.turns, durationMs: r.durationMs,
  initTools: init?.tools ?? null, initModel: init?.model ?? null,
  modelUsage: result?.modelUsage ? Object.fromEntries(Object.entries(result.modelUsage).map(([m, u]) => [m, { costUSD: u.costUSD, in: u.inputTokens, out: u.outputTokens, cr: u.cacheReadInputTokens, cw: u.cacheCreationInputTokens }])) : null,
  answer: readJsonFile(workdir, 'answer.json'), expected: words,
  forwardedEvents: events.filter(e => e.parent_tool_use_id).length,
  eventTypes: [...new Set(events.map(e => `${e.type}${e.subtype ? ':' + e.subtype : ''}${e.parent_tool_use_id ? '(sub)' : ''}`))],
  tree: { workers: tree.workers.length, models: tree.models, maxConcurrent: tree.maxConcurrent, workersDetail: tree.workers.map(w => ({ id: w.id, briefChars: w.brief.length, resultChars: w.result?.length ?? null, ms: w.durationMs, subEvents: w.events, models: w.models })) },
};
writeFileSync(path.join(workdir, 'probe.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
