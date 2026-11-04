// One hardened Claude Code session on an AppWorld unit (PLAN §5.1 "session", "init check", "meter"). Copied from the
// AgentDojo bed's session.mjs (same flags, init check and meter); only the server name differs. The sandbox is
// src/executors/claude-code.mjs's (its exported pieces, unchanged): private user/mount/pid namespaces, host filesystem
// read-only, /home, /root, /tmp, /var/tmp ... masked, allow-listed environment. Added here:
//   - the bed's MCP relay (mcp.mjs, copied into the workdir's .facade/) as the ONLY MCP server, and NO built-in tools
//     (`--tools ''`): the arm sees `execute`, `api_docs`, `python` and (A-HN) the notes tools, nothing else;
//   - hardened flags: --disable-slash-commands --no-session-persistence --strict-mcp-config, the CLI's built-in plugins
//     disabled through --settings, --max-turns, --max-budget-usd, --effort, --system-prompt (replaces the CLI's default
//     prompt). NOT --safe-mode (PLAN §5.1 lists it): with CLI 2.1.312 it disables the --mcp-config servers too, so the
//     relay never connects and the arm has no tools (init probe 2026-10-28, NOTES.md "Session configuration"); and it
//     leaves the built-in plugins (cc-plugin-agents-md, cc-plugin-plugin-authoring, cc-plugin-telemetry) loaded, which the
//     settings below switch off;
//   - the init check: the `system/init` event must list exactly the arm's tools and a connected relay, else the session
//     is killed at once (CONFIG_MISMATCH, a harness fault, never a task outcome);
//   - the meter: every `rate_limit_event` is journaled;
//   - `offline: true` adds a network namespace: the CLI starts, connects the relay, prints its init event and the model
//     request fails before anything is sent ($0 configuration probe).
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_HIDDEN, DEFAULT_KEEP_RO, UNSHARE_ARGS, executorEnv, maskSteps, nestedModelUses, sandboxAvailable, sandboxScript, sessionError, splitReady, streamUsageOf } from '../../../src/executors/claude-code.mjs';
import { DEFAULT_CHILD_ENV } from '../../../src/models/providers/claude-cli.mjs';
import { HERE } from './lib.mjs';

export const HARDENED_FLAGS = Object.freeze(['--disable-slash-commands', '--no-session-persistence', '--strict-mcp-config']);
/** The CLI's built-in plugins (their ids as the init event and the plugin store name them), all disabled for every arm. */
export const BUILTIN_PLUGINS = Object.freeze(['cc-plugin-agents-md', 'cc-plugin-plugin-authoring', 'cc-plugin-telemetry', 'cc-plugin-privacy']); // cc-plugin-privacy: new in CLI 2.1.318 (init probe 2026-11-04)
export const SESSION_SETTINGS = Object.freeze({ enabledPlugins: Object.fromEntries(BUILTIN_PLUGINS.map(p => [`${p}@builtin`, false])) });
export const NODE_BIN = realpathSync(process.execPath);
/** The CLI child's closed-list variables, identical for every arm: the policy default (src/models/providers/claude-cli.mjs). */
export const SESSION_ENV = Object.freeze({ ...DEFAULT_CHILD_ENV });
export const SERVER = 'appworld';
export const mcpName = t => `mcp__${SERVER}__${t}`;

/** Lay out the agent side of a workdir: the relay and its tool list (.facade/), the mailbox (.tools/). */
export function materializeSession(workdir, tools) {
  mkdirSync(path.join(workdir, '.facade'), { recursive: true });
  mkdirSync(path.join(workdir, '.tools'), { recursive: true });
  copyFileSync(path.join(HERE, 'mcp.mjs'), path.join(workdir, '.facade', 'mcp.mjs'));
  writeFileSync(path.join(workdir, '.facade', 'tools.json'), JSON.stringify(tools));
  return { mcpConfig: { mcpServers: { [SERVER]: { type: 'stdio', command: NODE_BIN, args: [path.join(workdir, '.facade', 'mcp.mjs'), '--tools', path.join(workdir, '.facade', 'tools.json'), '--mailbox', path.join(workdir, '.tools'), '--server-name', SERVER], env: {} } } } };
}

/** The exact argv after `claude`. */
export function sessionArgs({ model, mcpConfig, budgetUsd, maxTurns, systemPrompt, effort = null, flags = HARDENED_FLAGS, extraArgs = [] }) {
  const a = ['-p', '--model', model, '--output-format', 'stream-json', '--verbose', ...flags, '--settings', JSON.stringify(SESSION_SETTINGS), ...extraArgs, '--mcp-config', JSON.stringify(mcpConfig),
    '--tools', '', '--permission-mode', 'bypassPermissions', '--max-budget-usd', String(budgetUsd), '--max-turns', String(maxTurns)];
  if (systemPrompt) a.push('--system-prompt', systemPrompt);
  if (effort) a.push('--effort', effort);
  return a;
}

/** The comparable part of an init event, and the check against the arm's tool list. */
export function initFingerprint(init) {
  if (!init) return null;
  const names = xs => (Array.isArray(xs) ? xs.map(x => (typeof x === 'string' ? x : x?.name ?? JSON.stringify(x))).sort() : null);
  return { cliVersion: init.claude_code_version ?? null, model: init.model ?? null, permissionMode: init.permissionMode ?? null, tools: names(init.tools),
    mcpServers: Array.isArray(init.mcp_servers) ? init.mcp_servers.map(s => ({ name: s.name, status: s.status })) : null,
    slashCommands: names(init.slash_commands), skills: names(init.skills), plugins: names(init.plugins), agents: names(init.agents),
    outputStyle: init.output_style ?? null, perTurnEffortActive: init.per_turn_effort_active ?? null, analyticsDisabled: init.analytics_disabled ?? null };
}
export function initProblems(fp, { toolNames, model, effort = null }) {
  if (!fp) return ['no init event'];
  const out = [];
  const want = toolNames.map(mcpName).sort();
  if (JSON.stringify(fp.tools) !== JSON.stringify(want)) out.push(`tools: expected ${want.length} relay tools, saw ${JSON.stringify(fp.tools).slice(0, 400)}`);
  if (JSON.stringify(fp.mcpServers) !== JSON.stringify([{ name: SERVER, status: 'connected' }])) out.push(`mcp servers: ${JSON.stringify(fp.mcpServers)}`);
  if (fp.permissionMode !== 'bypassPermissions') out.push(`permission mode ${fp.permissionMode}`);
  for (const k of ['skills', 'plugins', 'slashCommands']) if (fp[k] && fp[k].length) out.push(`${k}: ${fp[k].join(',').slice(0, 200)}`);
  if (model && fp.model && !String(fp.model).startsWith(model)) out.push(`model ${fp.model} (expected ${model})`);
  if (effort && fp.perTurnEffortActive === false) out.push(`effort ${effort} requested but per_turn_effort_active is false`);
  if (fp.outputStyle && fp.outputStyle !== 'default') out.push(`output style ${fp.outputStyle}`);
  return out;
}

/** The meter reading of one stream event, or null (research/jit-20261008/analysis/quota-meter/README.md). */
export function meterReading(event) {
  if (event?.type !== 'rate_limit_event') return null;
  const info = event.rate_limit_info ?? {}, w = info.unifiedWindows ?? {};
  const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  return { status: info.status ?? null, rateLimitType: info.rateLimitType ?? null, resetsAt: num(info.resetsAt), fiveHour: num(w.five_hour?.utilization), sevenDay: num(w.seven_day?.utilization) };
}
/** PLAN §9.1: no new session at 5h >= 0.80 or a non-"allowed" status. */
export function meterGate(last) {
  if (!last || last.fiveHour === null) return { ok: true, reason: null };
  if (last.status && last.status !== 'allowed') return { ok: false, reason: `meter status ${last.status}` };
  if (last.fiveHour >= 0.8) return { ok: false, reason: `5-hour utilisation ${last.fiveHour}` };
  return { ok: true, reason: null };
}

/** Run one session. Returns raw facts; the caller grades host-side. */
export async function runSession({ model, prompt, workdir, mcpConfig, toolNames, budgetUsd, maxTurns, systemPrompt, effort = null, timeoutMs = 10 * 60_000, offline = false, onMeter = null, binary = 'claude', hostEnv = process.env, flags = HARDENED_FLAGS, extraArgs = [] }) {
  if (!model) throw new Error('an explicit model id from the policy file is required');
  if (!sandboxAvailable()) { const e = new Error('user/mount/pid namespaces are required'); e.code = 'SANDBOX_UNAVAILABLE'; throw e; }
  const env = executorEnv({ env: hostEnv, hidden: DEFAULT_HIDDEN, extraEnv: SESSION_ENV });
  const args = sessionArgs({ model, mcpConfig, budgetUsd, maxTurns, systemPrompt, effort, flags, extraArgs });
  const script = sandboxScript(maskSteps({ workdir, hidden: DEFAULT_HIDDEN, keepRo: DEFAULT_KEEP_RO }), workdir, [binary, ...args]);
  const started = Date.now();
  const child = spawn('unshare', [...UNSHARE_ARGS, ...(offline ? ['--net'] : []), 'sh', '-c', script], { env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  let raw = '', pending = '', stderr = '', timedOut = false, init = null, mismatch = null, killedAfterInit = false;
  const events = [], meter = [];
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const onEvent = e => {
    events.push(e);
    if (e.type === 'system' && e.subtype === 'init' && !init) {
      init = e;
      const p = initProblems(initFingerprint(e), { toolNames, model, effort });
      if (p.length) { mismatch = p; kill(); } else if (offline) { killedAfterInit = true; kill(); }
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
  let errorCode = mismatch ? 'CONFIG_MISMATCH' : killedAfterInit ? null : sessionError({ result, stderr: errText, timedOut, sandboxReady: ready });
  if (!errorCode && result?.subtype === 'error_max_turns') errorCode = 'MAX_TURNS';
  const reported = typeof result?.total_cost_usd === 'number' && Number.isFinite(result.total_cost_usd);
  const zeroSpend = (!result && !events.length) || offline || (mismatch && !events.some(e => e.type === 'assistant'));
  return {
    ok: !errorCode, error: errorCode ? { code: errorCode, exitCode: code, stderr: errText.slice(-2000), mismatch } : null, sandboxReady: ready,
    initFingerprint: initFingerprint(init), result: result?.result ?? null, resultSubtype: result?.subtype ?? null,
    costUsd: reported ? result.total_cost_usd : zeroSpend ? 0 : null, costUnknown: !reported && !zeroSpend, costUpperUsd: reported ? result.total_cost_usd : zeroSpend ? 0 : budgetUsd,
    streamUsage: streamUsageOf(events), modelUsage: result?.modelUsage ?? null, turns: result?.num_turns ?? null, durationMs: Date.now() - started,
    toolUses, nestedModelUses: nestedModelUses(toolUses), meter, args,
  };
}
