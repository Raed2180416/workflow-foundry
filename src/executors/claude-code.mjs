// Claude Code headless as a bounded, opaque executor (ROADMAP §2.1 `executor`, P10).
// Inside it is a full agent loop; outside it is bounded: a workspace, a budget, a timeout,
// an allowed tool set, a hidden-path mount namespace (repo, oracles and corpus are invisible)
// and an environment without repository credentials. Its output is labelled `executor:claude-code`.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { FoundryError } from '../data.mjs';

export const DEFAULT_HIDDEN = ['/home/user/workflow-foundry', '/opt/corpus'];
export const DEFAULT_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
// Repository and git-proxy credentials are removed so an executor cannot fetch the private
// repo (and with it the oracles). Model access uses the CLI's own managed session auth.
const SCRUBBED = /^(GH_TOKEN|GITHUB_TOKEN|GIT_CONFIG_.*|GIT_ASKPASS|CLOUDSDK_AUTH_ACCESS_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)$/;

let unshareOk;
export function sandboxAvailable() {
  if (unshareOk === undefined) unshareOk = spawnSync('unshare', ['--user', '--map-root-user', '--mount', '--fork', 'true'], { timeout: 10000 }).status === 0;
  return unshareOk;
}

const shellQuote = s => `'${String(s).replaceAll("'", `'\\''`)}'`;

export function materialize(workdir, files = {}) {
  mkdirSync(workdir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = path.resolve(workdir, rel);
    if (!target.startsWith(path.resolve(workdir) + path.sep)) throw new FoundryError('EXECUTOR_PATH', `File escapes workspace: ${rel}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
}

// Run one headless Claude Code session. Returns raw facts; callers decide success with an oracle.
export async function runClaudeCode({
  model, prompt, workdir, files = {}, budgetUsd = 1, timeoutMs = 15 * 60 * 1000, tools = DEFAULT_TOOLS,
  hidden = DEFAULT_HIDDEN, systemPrompt = null, appendSystemPrompt = null, effort = null, binary = 'claude', signal,
} = {}) {
  if (!model) throw new FoundryError('EXECUTOR_MODEL', 'An explicit model id from the policy file is required');
  if (!sandboxAvailable()) throw new FoundryError('SANDBOX_UNAVAILABLE', 'User/mount namespaces are required to hide oracles from executors');
  materialize(workdir, files);
  const args = ['-p', '--model', model, '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--safe-mode', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands',
    '--tools', tools.join(','), '--permission-mode', 'bypassPermissions', '--max-budget-usd', String(budgetUsd)];
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);
  if (effort) args.push('--effort', effort);
  const mounts = hidden.filter(p => existsSync(p)).map(p => `mount -t tmpfs tmpfs ${shellQuote(p)}`).join(' && ');
  const script = `${mounts ? mounts + ' && ' : ''}cd ${shellQuote(workdir)} && exec ${shellQuote(binary)} ${args.map(shellQuote).join(' ')}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SCRUBBED.test(k)));
  const started = Date.now();
  const child = spawn('unshare', ['--user', '--map-root-user', '--mount', '--fork', 'sh', '-c', script], { env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { if (stderr.length < 64 * 1024) stderr += d; });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  signal?.addEventListener('abort', kill, { once: true });
  child.stdin.end(prompt);
  const code = await new Promise(resolve => child.on('close', resolve));
  clearTimeout(timer);
  const events = stdout.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  writeFileSync(path.join(workdir, '.executor-transcript.jsonl'), stdout);
  const result = [...events].reverse().find(e => e.type === 'result');
  const toolUses = events.filter(e => e.type === 'assistant').flatMap(e => (e.message?.content ?? []).filter(c => c.type === 'tool_use').map(c => ({ name: c.name, input: c.input })));
  const status = result?.api_error_status;
  const errorCode = timedOut ? 'EXECUTOR_TIMEOUT'
    : (status === 429 || status === 529 || /rate.?limit|overloaded/i.test(`${result?.result ?? ''} ${stderr}`)) && result?.is_error ? 'MODEL_RATE_LIMIT'
      : !result ? 'EXECUTOR_PROTOCOL'
        : result.subtype === 'error_max_budget_usd' ? 'EXECUTOR_BUDGET'
          : result.is_error ? 'EXECUTOR_ERROR' : null;
  return {
    ok: !errorCode, error: errorCode ? { code: errorCode, exitCode: code, stderr: stderr.slice(-2000) } : null,
    result: result?.result ?? null, costUsd: result?.total_cost_usd ?? 0, turns: result?.num_turns ?? null,
    usage: result?.usage ?? null, durationMs: Date.now() - started, toolUses,
    label: `executor:claude-code:${model}`, transcript: path.join(workdir, '.executor-transcript.jsonl'),
  };
}

export const readJsonFile = (workdir, name) => {
  try { return JSON.parse(readFileSync(path.join(workdir, name), 'utf8')); } catch { return null; }
};
