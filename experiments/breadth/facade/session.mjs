// One hardened Claude Code session against a bed facade (PLAN §5.1 "session", "init check", "meter").
// The same sandbox as src/executors/claude-code.mjs (its exported pieces, unchanged): private user/mount/pid
// namespaces, host filesystem read-only, /home, /root, /tmp, /var/tmp ... masked, allow-listed environment. Added here:
//   - the bed's MCP relay as the only MCP server (`--strict-mcp-config --mcp-config`), its script and tool list in a
//     read-only kept directory; the session's own built-in tools are those the arm names (none for the A arms);
//   - hardened flags (HARDENED_FLAGS below): --setting-sources '' --disable-slash-commands --no-session-persistence
//     --strict-mcp-config, the arm's --tools list, --max-turns (the bed's official cap), --max-budget-usd, --effort.
//     NOT --safe-mode: on CLI 2.1.307 it also drops the --mcp-config servers, so the bed's tools never load (observed
//     2026-10-22 by the $0 offline init probe: mcp_servers [] and 0 tools with it; workbench "connected" and 27 + 1
//     tools without it). What --safe-mode would add is covered here by --setting-sources '' (no user, project or
//     local settings: no settings hooks, permissions or env), the sandbox's empty private HOME (no ~/.claude: no
//     installed plugins, skills, agents, output styles or user CLAUDE.md), a fresh workdir, and the init check, which
//     refuses any session whose tools, MCP servers, skills, plugins, slash commands or agents differ from the arm's
//     frozen fingerprint (PLAN §5.1 lists --safe-mode; this deviation is recorded in the WorkBench ACQUISITION notes);
//   - the init check: the `system/init` event is compared with the arm's frozen configuration as it streams in, and a
//     session that differs is killed at once (CONFIG_MISMATCH: a harness fault, never a task outcome);
//   - the meter: every `rate_limit_event` is journaled;
//   - `offline: true` adds a network namespace (no route at all): the CLI starts, connects its MCP servers and prints
//     its init event, and the model request fails before anything is sent. That is the $0 configuration probe.
import { spawn } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_HIDDEN, DEFAULT_KEEP_RO, UNSHARE_ARGS, executorEnv, maskSteps, materialize, nestedModelUses, sandboxAvailable, sandboxScript, sessionError, splitReady, streamUsageOf } from '../../../src/executors/claude-code.mjs';
import { compareFingerprint, initFingerprint } from './init-check.mjs';
import { meterReading } from './meter.mjs';

export const HARDENED_FLAGS = Object.freeze(['--setting-sources', '', '--disable-slash-commands', '--no-session-persistence', '--strict-mcp-config']);
/** PLAN §5.1's original list, kept for beds without an MCP server (with it, the facade server does not load). */
export const SAFE_MODE_FLAGS = Object.freeze(['--safe-mode', '--disable-slash-commands', '--no-session-persistence', '--strict-mcp-config']);
export const NODE_BIN = realpathSync(process.execPath);

/** The MCP config for one session: the relay as server `serverName`, reading its tool list and mailbox. */
export function relayMcpConfig({ serverName, relayScript, toolsFile, mailbox, waitMs = 300_000 }) {
  return { mcpServers: { [serverName]: { type: 'stdio', command: NODE_BIN, args: [relayScript, '--tools', toolsFile, '--mailbox', mailbox, '--server-name', serverName, '--wait-ms', String(waitMs)], env: {} } } };
}

/** The exact argv after `claude` (exported for tests and for the arm manifest). */
export function sessionArgs({ model, mcpConfig, builtinTools = [], budgetUsd, maxTurns, systemPrompt, effort = null, flags = HARDENED_FLAGS }) {
  const a = ['-p', '--model', model, '--output-format', 'stream-json', '--verbose', ...flags, '--mcp-config', JSON.stringify(mcpConfig),
    '--tools', builtinTools.join(','), '--permission-mode', 'bypassPermissions', '--max-budget-usd', String(budgetUsd)];
  if (maxTurns) a.push('--max-turns', String(maxTurns));
  if (systemPrompt) a.push('--system-prompt', systemPrompt);
  if (effort) a.push('--effort', effort);
  return a;
}

/**
 * runFacadeSession(opts) -> raw facts (callers grade host-side).
 * opts: { model, prompt, workdir, keepRo (extra read-only dirs: the relay's), mcpConfig, builtinTools, budgetUsd,
 *         maxTurns, systemPrompt, effort, timeoutMs, expectInit (fingerprint subset; null = record only),
 *         onMeter(reading), offline, binary, hostEnv }
 */
export async function runFacadeSession({ model, prompt, workdir, keepRo = [], mcpConfig, builtinTools = [], budgetUsd = 0.5, maxTurns = null, systemPrompt = null,
  effort = null, timeoutMs = 10 * 60_000, expectInit = null, onMeter = null, offline = false, binary = 'claude', hostEnv = process.env, files = {}, flags = HARDENED_FLAGS }) {
  if (!model) throw new Error('an explicit model id from the policy file is required');
  if (!sandboxAvailable()) { const e = new Error('user/mount/pid namespaces are required'); e.code = 'SANDBOX_UNAVAILABLE'; throw e; }
  const env = executorEnv({ env: hostEnv, hidden: DEFAULT_HIDDEN });
  materialize(workdir, files);
  const args = sessionArgs({ model, mcpConfig, builtinTools, budgetUsd, maxTurns, systemPrompt, effort, flags });
  const script = sandboxScript(maskSteps({ workdir, hidden: DEFAULT_HIDDEN, keepRo: [...DEFAULT_KEEP_RO, ...keepRo] }), workdir, [binary, ...args]);
  const unshare = offline ? [...UNSHARE_ARGS, '--net'] : [...UNSHARE_ARGS];
  const started = Date.now();
  const child = spawn('unshare', [...unshare, 'sh', '-c', script], { env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  let raw = '', pending = '', stderr = '', timedOut = false, init = null, initMismatch = null, killedAfterInit = false;
  const events = [], meter = [];
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const onEvent = e => {
    events.push(e);
    if (e.type === 'system' && e.subtype === 'init' && !init) {
      init = e;
      const diff = expectInit ? compareFingerprint(expectInit, initFingerprint(e)) : [];
      if (diff.length) { initMismatch = diff; kill(); }
      else if (offline) { killedAfterInit = true; kill(); } // the probe needs nothing after init
    }
    const m = meterReading(e);
    if (m) { meter.push(m); try { onMeter?.(m); } catch {} }
  };
  child.stdout.on('data', d => {
    raw += d; pending += d;
    let i;
    while ((i = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, i); pending = pending.slice(i + 1);
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      onEvent(e);
    }
  });
  child.stderr.on('data', d => { if (stderr.length < 64 * 1024) stderr += d; });
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  const code = await new Promise(resolve => child.on('close', resolve));
  clearTimeout(timer);
  const { ready, stderr: errText } = splitReady(stderr);
  writeFileSync(path.join(workdir, '.executor-transcript.jsonl'), raw);
  const result = [...events].reverse().find(e => e.type === 'result') ?? null;
  const toolUses = events.filter(e => e.type === 'assistant').flatMap(e => (e.message?.content ?? []).filter(c => c.type === 'tool_use').map(c => ({ name: c.name, input: c.input })));
  // The turn cap is the bed's official iteration cap: a task outcome (the official AGENT_STOPPED error), checked before
  // the generic classification, which would call any is_error result EXECUTOR_ERROR.
  let errorCode = initMismatch ? 'CONFIG_MISMATCH' : killedAfterInit ? null : result?.subtype === 'error_max_turns' && !timedOut ? 'MAX_TURNS' : sessionError({ result, stderr: errText, timedOut, sandboxReady: ready });
  const reported = typeof result?.total_cost_usd === 'number' && Number.isFinite(result.total_cost_usd);
  const neverStarted = !result && !events.length;
  // An offline probe, or a session killed at its init event (CONFIG_MISMATCH) before any assistant message, sent no model
  // request that could complete: $0. (The CLI prints system/init before its first model request; a request already in
  // flight at the kill could at most bill one prompt's input, which this does not count.)
  const killedAtInit = Boolean(initMismatch) && !events.some(e => e.type === 'assistant' || e.type === 'result');
  const zeroSpend = neverStarted || offline || killedAtInit;
  return {
    ok: !errorCode, error: errorCode ? { code: errorCode, exitCode: code, stderr: errText.slice(-2000), initMismatch } : null, sandboxReady: ready,
    init, initFingerprint: initFingerprint(init), initMismatch, offline, result: result?.result ?? null, resultSubtype: result?.subtype ?? null, terminalReason: result?.terminal_reason ?? null,
    costUsd: reported ? result.total_cost_usd : zeroSpend ? 0 : null, costUnknown: !reported && !zeroSpend, costUpperUsd: reported ? result.total_cost_usd : zeroSpend ? 0 : budgetUsd,
    streamUsage: streamUsageOf(events), modelUsage: result?.modelUsage ?? null, turns: result?.num_turns ?? null, durationMs: Date.now() - started, toolUses, nestedModelUses: nestedModelUses(toolUses),
    meter, args, transcript: path.join(workdir, '.executor-transcript.jsonl'),
  };
}
