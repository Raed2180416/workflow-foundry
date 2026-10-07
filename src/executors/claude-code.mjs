// Claude Code headless as a bounded, opaque executor (ROADMAP §2.1 `executor`, P10).
// Inside it is a full agent loop; outside it is bounded: a workspace, a budget, a timeout,
// an allowed tool set, a private mount+pid namespace (repo, oracles, corpus, other sessions and
// every other executor's workdir are invisible; the host filesystem is read-only) and an environment
// without repository credentials or the parent session's identity. Its output is labelled `executor:claude-code`.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { FoundryError } from '../data.mjs';

// An executor sees only its own workdir under WORK_ROOT and at most one kit under KIT_ROOT.
export const WORK_ROOT = '/var/tmp/foundry-work', KIT_ROOT = '/opt/foundry-kit';
// Hidden = replaced by an empty private tmpfs (when the path exists). /root/.claude holds every session's
// transcripts, task output and hooks, /tmp other sessions' scratchpads and sockets, /home/user the repo and sibling
// projects, /run host service sockets, /opt/rclone* sync configuration; the rest is corpus, model and venv data.
// Hiding all of /root also keeps a builder from planting configuration (~/.claude.json, ~/.bashrc) for host sessions.
// Not all of /home: the CLI's managed login needs a path there (live-tested 2026-10-07: hiding /home fails auth).
export const DEFAULT_HIDDEN = Object.freeze(['/home/user', '/root', '/tmp', '/var/tmp', '/mnt', '/run', '/srv', '/media', '/old_root', '/dev/shm',
  '/opt/corpus', '/opt/models', '/opt/hf-cache', '/opt/kev-venv', '/opt/llamacpp', '/opt/rclone', '/opt/rclone-attach', '/opt/env-runner', WORK_ROOT, KIT_ROOT]);
// Kept visible, read-only, inside a hidden path: the proxy CA bundle (NODE_EXTRA_CA_CERTS) and user-local binaries (node).
export const DEFAULT_KEEP_RO = Object.freeze(['/root/.ccr', '/root/.local']);
export const DEFAULT_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
// Repository credentials, plus the parent Claude session's identity, sockets and tuning (else every nested CLI runs
// as the parent session, shares its scratchpad and gets ~530 extra prompt tokens). Model access keeps the CLI's own
// managed auth (live-tested 2026-10-07: auth still works without these).
export const SCRUBBED_ENV = /^(GH_TOKEN|GITHUB_TOKEN|GIT_CONFIG_.*|GIT_ASKPASS|CLOUDSDK_AUTH_ACCESS_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|MAX_THINKING_TOKENS|CLAUDE_AFTER_LAST_COMPACT|CLAUDE_AUTOCOMPACT_PCT_OVERRIDE|CLAUDE_AUTO_BACKGROUND_TASKS|CLAUDE_ADDITIONAL_DIRECTORIES|CLAUDE_SESSION_INGRESS_TOKEN_FILE|SBX_TELEMETRY_SOCKET|CLAUDE_CODE_(SESSION_ID|REMOTE_SESSION_ID|MESSAGING_SOCKET|MESSAGING_TOKEN|TEE_SDK_STDOUT|DIAGNOSTICS_FILE|CHILD_SESSION|POST_FOR_SESSION_INGRESS_V2|REMOTE_SEND_KEEPALIVES|REMOTE_TOOLS_FORWARD|SYNC_.*|WORKER_EPOCH|ARTIFACT_ASSETS|BG_TASKS_REPORT_RUNNING|HOLD_UNANSWERED_PARKED_PERMISSION|SESSION_ATTENDED|ADDITIONAL_DIRECTORIES_CLAUDE_MD|BASE_REF))$/;
export const scrubEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k, v]) => typeof v === 'string' && !SCRUBBED_ENV.test(k)));

// Transcript scan (pre-registered: a count > 0 voids the run). Tool uses that start a nested Claude CLI or call the
// model API directly, i.e. spend outside every ledger: a Bash command with `claude` in command position (also after
// exec/env/nohup/timeout/npx or a path), or any Bash/Write/Edit input naming the API host or SDK, or code that
// spawns `claude`. Mentions of the word (grep claude, ~/.claude, model ids like claude-opus-5-5) do not count.
const NESTED_CLI = /(?:^|[;&|(`\n]|\$\()\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:(?:exec|env|nohup|command|time|timeout\s+\S+|npx(?:\s+-y)?|sudo)\s+(?:-\S+\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*)*(?:\S*\/)?claude(?:\s|$|[;&|)])/;
const NESTED_API = /api\.anthropic\.com|@anthropic-ai\/(?:sdk|claude-code|claude-agent-sdk)|\banthropic\.(?:Anthropic|AsyncAnthropic)\b|\/v1\/(?:messages|complete)\b/;
const NESTED_SPAWN = /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|execa|Popen|run|check_output|call|system)\s*\(\s*\[?\s*['"`](?:\S*\/)?claude(?:['"`\s])/;
export function nestedModelUses(toolUses = []) {
  return toolUses.filter(u => {
    const input = u?.input ?? {};
    if (u?.name === 'Bash') { const cmd = String(input.command ?? ''); return NESTED_CLI.test(cmd) || NESTED_API.test(cmd) || NESTED_SPAWN.test(cmd); }
    if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(u?.name)) {
      const text = [input.content, input.new_string, input.new_source, ...(Array.isArray(input.edits) ? input.edits.map(e => e?.new_string) : [])].filter(x => typeof x === 'string').join('\n');
      return NESTED_API.test(text) || NESTED_SPAWN.test(text);
    }
    return false;
  }).length;
}

let unshareOk;
export function sandboxAvailable() {
  if (unshareOk === undefined) unshareOk = spawnSync('unshare', ['--user', '--map-root-user', '--mount', '--pid', '--fork', '--mount-proc', 'true'], { timeout: 10000 }).status === 0;
  return unshareOk;
}
// The namespace flags every executor sandbox uses: its own user, mount and pid namespace with a fresh /proc
// (the host /proc would expose /proc/<pid>/root, i.e. the unmasked host filesystem, and other processes' environ).
export const UNSHARE_ARGS = Object.freeze(['--user', '--map-root-user', '--mount', '--pid', '--fork', '--kill-child', '--mount-proc']);

export const shellQuote = s => `'${String(s).replaceAll("'", `'\\''`)}'`;
const inside = (a, b) => a.startsWith(b === '/' ? '/' : b + '/');
const isDir = p => { try { return lstatSync(p).isDirectory(); } catch { return false; } };

// Mount steps run as the namespace root before the executor starts (sh, set -e):
// 1. a private tmpfs on the staging point (it is also the mask of /mnt); every kept path is rbind-copied there
//    while its source is still writable;
// 2. every inherited mount (except the fresh /proc, /sys and the staging area) is remounted read-only, so the executor
//    cannot alter the host filesystem;
// 3. each hidden path becomes an empty private tmpfs; paths nested in another hidden path are skipped (mounting on
//    them would fail once the parent is masked);
// 4. the kept paths are moved back to their own locations: the workdir writable, the kit and keepRo read-only.
export function maskSteps({ workdir, kitDir = null, hidden = DEFAULT_HIDDEN, keepRo = [], stage = '/mnt' }) {
  const rw = path.resolve(workdir), ro = [...(kitDir ? [path.resolve(kitDir)] : []), ...keepRo.map(p => path.resolve(p)).filter(isDir)];
  const keeps = [rw, ...ro];
  if (!isDir(stage)) throw new FoundryError('EXECUTOR_PATH', `The sandbox staging point ${stage} does not exist`);
  for (const k of keeps) {
    if (k === '/' || k === stage || inside(k, stage) || k === '/proc' || inside(k, '/proc')) throw new FoundryError('EXECUTOR_PATH', `Cannot keep ${k} visible in the sandbox`);
    for (const o of keeps) if (o !== k && (inside(k, o))) throw new FoundryError('EXECUTOR_PATH', `Kept paths may not nest: ${k} is inside ${o}`);
  }
  const all = [...new Set([WORK_ROOT, KIT_ROOT, ...hidden].map(p => path.resolve(p)))].filter(p => p !== '/' && isDir(p));
  // A hidden path under the staging point is already masked by the staging tmpfs.
  const roots = all.filter(p => !all.some(o => o !== p && inside(p, o)) && !inside(p, stage));
  for (const p of roots) if (keeps.some(k => k === p || inside(p, k))) throw new FoundryError('EXECUTOR_PATH', `Cannot hide ${p}: it is or contains a kept path`);
  const steps = [`mount -t tmpfs -o mode=0700 foundry-stage ${shellQuote(stage)}`];
  keeps.forEach((k, i) => steps.push(`mkdir ${shellQuote(`${stage}/k${i}`)}`, `mount --rbind ${shellQuote(k)} ${shellQuote(`${stage}/k${i}`)}`));
  // /sys stays as inherited: the CLI's Bash tool clones each command into a cgroup under /sys/fs/cgroup (EROFS otherwise).
  const skip = `${stage}|${stage}/*|/proc|/proc/*|/sys|/sys/*`;
  steps.push(`for mp in $(awk '{print $5}' /proc/self/mountinfo | sort -u); do case "$mp" in *\\\\*) echo "foundry-executor: unsupported mount point name" >&2; exit 97;; ${skip}) continue;; esac; mount -o remount,bind,ro "$mp"; done`);
  for (const p of roots) if (p !== stage) steps.push(`mount -t tmpfs -o mode=0755 foundry-hidden ${shellQuote(p)}`);
  keeps.forEach((k, i) => steps.push(`mkdir -p ${shellQuote(k)}`, `mount --move ${shellQuote(`${stage}/k${i}`)} ${shellQuote(k)}`));
  for (const k of ro) steps.push(`mount -o remount,bind,ro ${shellQuote(k)}`);
  return steps;
}
// The marker line on stderr separates a sandbox that could not be set up (an environment fault: nothing ran, nothing
// was spent) from a program that started and failed.
export const SANDBOX_READY = 'foundry-sandbox-ready';
export const sandboxScript = (steps, workdir, argv) => `set -e\n${steps.join('\n')}\ncd ${shellQuote(workdir)}\necho ${SANDBOX_READY} >&2\nexec ${argv.map(shellQuote).join(' ')}`;
export const splitReady = stderr => { const i = stderr.indexOf(`${SANDBOX_READY}\n`); return i < 0 ? { ready: false, stderr } : { ready: true, stderr: stderr.slice(0, i) + stderr.slice(i + SANDBOX_READY.length + 1) }; };

export function materialize(workdir, files = {}) {
  mkdirSync(workdir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = path.resolve(workdir, rel);
    if (!target.startsWith(path.resolve(workdir) + path.sep)) throw new FoundryError('EXECUTOR_PATH', `File escapes workspace: ${rel}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
}

// Usage per assistant message id (stream-json repeats a message once per content block, with the usage so far):
// a lower bound on what a killed session consumed, kept for review. Its cost bound is the session budget.
export function streamUsageOf(events) {
  const byMsg = new Map();
  for (const e of events) if (e?.type === 'assistant' && e.message?.id && e.message.usage) byMsg.set(e.message.id, e.message.usage);
  return [...byMsg.values()].reduce((s, u) => ({ inputTokens: s.inputTokens + (u.input_tokens ?? 0), outputTokens: s.outputTokens + (u.output_tokens ?? 0),
    cacheReadTokens: s.cacheReadTokens + (u.cache_read_input_tokens ?? 0), cacheWriteTokens: s.cacheWriteTokens + (u.cache_creation_input_tokens ?? 0) }),
  { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
}
const LIMITED = /rate.?limit|overloaded|usage limit|hit your (usage )?limit|limit reached/i;
// Classify one session's end from the CLI's result event (null: none was printed). Exported for tests.
export function sessionError({ result, stderr = '', timedOut = false, sandboxReady = true }) {
  const status = Number(result?.api_error_status);
  if (!sandboxReady && !result) return 'SANDBOX_UNAVAILABLE';
  if (timedOut) return 'EXECUTOR_TIMEOUT';
  if (result?.subtype === 'error_max_budget_usd') return 'EXECUTOR_BUDGET';
  if ((status === 429 || status === 529 || LIMITED.test(`${result?.result ?? ''} ${stderr}`)) && (result?.is_error || !result)) return 'MODEL_RATE_LIMIT';
  if (!result) return 'EXECUTOR_PROTOCOL';
  if (result.is_error && (status >= 500 || status === 401 || status === 403)) return 'MODEL_UNAVAILABLE';
  return result.is_error ? 'EXECUTOR_ERROR' : null;
}

// Run one headless Claude Code session. Returns raw facts; callers decide success with an oracle.
// costUsd is the CLI-reported spend, or null when the session ended without a result (killed on timeout, crashed):
// then costUnknown is true and costUpperUsd is the session budget (a soft bound: the CLI checks it between turns).
export async function runClaudeCode({
  model, prompt, workdir, files = {}, budgetUsd = 1, timeoutMs = 15 * 60 * 1000, tools = DEFAULT_TOOLS,
  hidden = DEFAULT_HIDDEN, keepRo = DEFAULT_KEEP_RO, kitDir = null, systemPrompt = null, appendSystemPrompt = null, effort = null, binary = 'claude', signal,
} = {}) {
  if (!model) throw new FoundryError('EXECUTOR_MODEL', 'An explicit model id from the policy file is required');
  if (!sandboxAvailable()) throw new FoundryError('SANDBOX_UNAVAILABLE', 'User/mount/pid namespaces are required to hide oracles from executors');
  materialize(workdir, files);
  const args = ['-p', '--model', model, '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--safe-mode', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands',
    '--tools', tools.join(','), '--permission-mode', 'bypassPermissions', '--max-budget-usd', String(budgetUsd)];
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);
  if (effort) args.push('--effort', effort);
  const script = sandboxScript(maskSteps({ workdir, kitDir, hidden, keepRo }), workdir, [binary, ...args]);
  const env = scrubEnv();
  const started = Date.now();
  const child = spawn('unshare', [...UNSHARE_ARGS, 'sh', '-c', script], { env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { if (stderr.length < 64 * 1024) stderr += d; });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  signal?.addEventListener('abort', kill, { once: true });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  const code = await new Promise(resolve => child.on('close', resolve));
  clearTimeout(timer);
  const { ready, stderr: errText } = splitReady(stderr);
  const events = stdout.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  writeFileSync(path.join(workdir, '.executor-transcript.jsonl'), stdout);
  const result = [...events].reverse().find(e => e.type === 'result');
  const toolUses = events.filter(e => e.type === 'assistant').flatMap(e => (e.message?.content ?? []).filter(c => c.type === 'tool_use').map(c => ({ name: c.name, input: c.input })));
  const init = events.find(e => e.type === 'system' && e.subtype === 'init');
  const errorCode = sessionError({ result, stderr: errText, timedOut, sandboxReady: ready });
  const reported = typeof result?.total_cost_usd === 'number' && Number.isFinite(result.total_cost_usd);
  // A sandbox that never got ready never started the CLI: nothing was spent.
  const neverStarted = !ready && !result && !events.length;
  return {
    ok: !errorCode, error: errorCode ? { code: errorCode, exitCode: code, stderr: errText.slice(-2000) } : null, sandboxReady: ready,
    result: result?.result ?? null, costUsd: reported ? result.total_cost_usd : neverStarted ? 0 : null, costUnknown: !reported && !neverStarted,
    costUpperUsd: reported ? result.total_cost_usd : neverStarted ? 0 : budgetUsd,
    streamUsage: streamUsageOf(events), turns: result?.num_turns ?? null, sessionId: init?.session_id ?? result?.session_id ?? null,
    usage: result?.usage ?? null, durationMs: Date.now() - started, toolUses,
    label: `executor:claude-code:${model}`, transcript: path.join(workdir, '.executor-transcript.jsonl'),
  };
}

export const readJsonFile = (workdir, name) => {
  try { return JSON.parse(readFileSync(path.join(workdir, name), 'utf8')); } catch { return null; }
};
