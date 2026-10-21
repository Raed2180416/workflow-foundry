// A remote OpenAI-compatible chat model as a bounded executor session (policy kind openai-chat-https, executorModels[];
// research/mercury-20261021/), with the call signature and result shape of runClaudeCode (./claude-code.mjs), so a runner
// that drives a Claude Code session can drive this one instead.
//
// Where the parts run:
// - The tool-calling loop runs here, on the host. The endpoint's key is read from the host environment (the variable the
//   policy names in credentialEnv) at each request and goes only into that request's Authorization header: it never enters
//   the sandbox, a transcript, a log or an error message.
// - Every tool runs inside ONE executor sandbox per session, built as runClaudeCode builds its own: the same maskSteps
//   (DEFAULT_HIDDEN masked, the workdir writable, the kit and keepRo read-only, a fresh /dev and /proc, the pid namespace and
//   the uid drop) and the same executorEnv allow-list. The sandbox's program is a small command server (commandServer
//   below) instead of the claude CLI, so /tmp, HOME and /dev/shm are private to the session and last as long as it does.
// - By default the sandbox also has no network (a private network namespace, `network: false`): unlike the claude CLI, no
//   tool here needs egress, so none is given. The claude CLI login file is not kept visible either (nothing here needs it).
//
// One model response is one turn. maxTurns caps the responses: the tool calls of the last allowed response still run, and
// then the session ends (subtype error_max_turns). budgetUsd is checked between turns against the policy price times the
// usage the endpoint reports (a soft bound, as the CLI's); tokenBudget does the same for input + output tokens, which is
// the binding limit for a model listed at $0. timeoutMs bounds the whole session.
//
// The transcript is written where runClaudeCode writes it (<workdir>/.executor-transcript.jsonl) in the claude CLI's
// stream-json shape (system/init, one assistant event per response with a unique message id, one user event per tool
// result with its completion timestamp, a final result event), so the existing auditors read it unchanged
// (experiments/autobench/accounting.mjs auditSession and readStream, nestedModelUses and streamUsageOf here).
//
// Error codes are the claude executor's: MODEL_RATE_LIMIT (HTTP 429/529 or a usage limit, after bounded retries),
// MODEL_UNAVAILABLE (5xx, connection failures and timeouts after bounded retries; 401/403; no credential in the
// environment), SANDBOX_UNAVAILABLE (the sandbox never got ready), EXECUTOR_LAUNCH (the command server did not start),
// EXECUTOR_PROTOCOL (an unparseable endpoint response), all environment faults in experiments/lib/runner.mjs ENV_FAULTS;
// and the task outcomes EXECUTOR_TIMEOUT, EXECUTOR_BUDGET, EXECUTOR_MAX_TURNS, EXECUTOR_ERROR, EXECUTOR_CANCELLED.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { FoundryError } from '../data.mjs';
import { REMOTE_CHAT_KIND, executorModelById, loadPolicy, sessionModelById } from '../models/policy.mjs';
import { CLOUD_LOGIN_FILE, DEFAULT_HIDDEN, DEFAULT_KEEP_RO, SANDBOX_READY, UNSHARE_ARGS, executorEnv, maskSteps, materialize, runClaudeCode, sandboxAvailable, sandboxScript } from './claude-code.mjs';

export const EXECUTOR_KIND = 'openai-chat';
export const TRANSCRIPT_FILE = '.executor-transcript.jsonl';
/** The tools this executor can offer (the claude executor's default set, each with the same input field names). */
export const SUPPORTED_TOOLS = Object.freeze(['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']);
export const DEFAULT_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
/** Reasoning levels forwarded as reasoning_effort. The claude CLI's xhigh and max have no counterpart: refused, not flattened. */
export const EFFORTS = Object.freeze(['low', 'medium', 'high']);
// The claude CLI login file is the only DEFAULT_KEEP_RO entry a remote-chat session has no use for.
export const OPENAI_CHAT_KEEP_RO = Object.freeze(DEFAULT_KEEP_RO.filter(p => p !== CLOUD_LOGIN_FILE));
export const BASH_DEFAULT_TIMEOUT_MS = 120_000, BASH_MAX_TIMEOUT_MS = 600_000, OTHER_TOOL_TIMEOUT_MS = 60_000;
/** Tool output kept per call (the claude CLI's default Bash output limit): head and tail, with the middle elided. */
export const TOOL_OUTPUT_MAX_CHARS = 30_000;
/** Input + output tokens per session unless the caller sets tokenBudget (null: no token cap). */
export const DEFAULT_TOKEN_BUDGET = 3_000_000;
// Per-minute rate limits are the binding constraint on a free tier (measured 2026-10-21: HTTP 429 "too many requests per
// minute" / "input token limit exceeded" with two sessions beside another run on the same key), so a session waits them out
// for about four minutes (5, 10, 20, 40, 60, 60, 60 s) before it reports MODEL_RATE_LIMIT, which stops an AutomationBench run.
export const DEFAULT_RETRY = Object.freeze({ attempts: 8, baseDelayMs: 5_000, maxDelayMs: 60_000 });
// A rate-limited endpoint cools down for every session of this process, not only the one that saw the 429: concurrent sessions
// wait out the same window instead of spending their retries on it. Keyed by endpoint origin; exported for tests.
export const COOLDOWN = new Map();
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy'];
const LIMITED = /rate.?limit|overloaded|usage limit|quota|limit reached|insufficient.?(?:credit|balance|funds)/i;
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?(\/[^\s?#]*)?$/;
const HTTPS = /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/;

// --- tools ---------------------------------------------------------------------------------------------------------------
const str = description => ({ type: 'string', description });
const int = description => ({ type: 'integer', description });
const TOOL_DEFS = Object.freeze({
  Bash: { description: 'Run one shell command (bash -c) in the working directory, inside the sandbox. Each command starts in the working directory with a fresh shell; files persist, shell variables and background processes do not. Output (stdout and stderr together) is truncated to 30000 characters.',
    parameters: { type: 'object', properties: { command: str('The command to run'), timeout: int(`Optional timeout in milliseconds (default ${BASH_DEFAULT_TIMEOUT_MS}, at most ${BASH_MAX_TIMEOUT_MS})`), description: str('Optional: what the command does, in a few words') }, required: ['command'] } },
  Read: { description: 'Read a text file. Returns numbered lines (number, tab, line), at most 2000 lines from offset.',
    parameters: { type: 'object', properties: { file_path: str('Path of the file (absolute, or relative to the working directory)'), offset: int('First line to read (1-based)'), limit: int('Number of lines to read') }, required: ['file_path'] } },
  Write: { description: 'Write a file, replacing any existing content. Parent directories are created.',
    parameters: { type: 'object', properties: { file_path: str('Path of the file (absolute, or relative to the working directory)'), content: str('The full content to write') }, required: ['file_path', 'content'] } },
  Edit: { description: 'Replace old_string with new_string in a file. old_string must occur exactly once unless replace_all is true.',
    parameters: { type: 'object', properties: { file_path: str('Path of the file'), old_string: str('The exact text to replace'), new_string: str('The replacement text'), replace_all: { type: 'boolean', description: 'Replace every occurrence' } }, required: ['file_path', 'old_string', 'new_string'] } },
  Glob: { description: 'List files matching a glob pattern (for example **/*.json), newest first, at most 100.',
    parameters: { type: 'object', properties: { pattern: str('The glob pattern'), path: str('Directory to search (default: the working directory)') }, required: ['pattern'] } },
  Grep: { description: 'Search file contents with a regular expression (ripgrep syntax).',
    parameters: { type: 'object', properties: { pattern: str('The regular expression'), path: str('File or directory to search (default: the working directory)'), glob: str('Only files matching this glob'),
      output_mode: { type: 'string', enum: ['files_with_matches', 'content', 'count'], description: 'files_with_matches (default), content (matching lines with numbers) or count' }, ignore_case: { type: 'boolean', description: 'Case-insensitive search' },
      head_limit: int('Keep only the first N lines of output') }, required: ['pattern'] } },
});
export const toolDefinitions = tools => tools.map(name => ({ type: 'function', function: { name, description: TOOL_DEFS[name].description, parameters: TOOL_DEFS[name].parameters } }));
const OP_OF = { Bash: 'bash', Read: 'read', Write: 'write', Edit: 'edit', Glob: 'glob', Grep: 'grep' };

/** The system prompt when the caller gives none (the claude CLI would use its own built-in agent prompt). */
export function defaultSystemPrompt({ tools, network }) {
  return ['You are an autonomous agent working on a task in a sandboxed Linux workspace.',
    `Your working directory is where the task's files are. Files you write there persist for this session; the rest of the filesystem is read-only${network ? '' : ', and there is no network'}.`,
    tools.length ? `Use your tools (${tools.join(', ')}) to read files and run commands. Each Bash command starts in the working directory with a fresh shell.` : 'You have no tools: answer from the conversation.',
    'Work until the task is done, then reply with a short final message and make no further tool call.'].join('\n');
}

// The command server: the sandbox's program. It is serialized with Function.prototype.toString and started as
// `node -e`, so it must not close over anything in this module. One JSON request per stdin line, one JSON reply per stdout
// line; requests run one at a time. Its first line is a hello carrying the session nonce.
async function commandServer(cfg) {
  const { spawn } = await import('node:child_process');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const readline = await import('node:readline');
  const WORKDIR = process.cwd();
  const SHELL = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
  const onPath = name => String(process.env.PATH ?? '').split(':').filter(d => d.startsWith('/')).map(d => path.join(d, name)).find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) ?? null;
  const send = o => process.stdout.write(JSON.stringify(o) + '\n');
  const at = p => path.resolve(WORKDIR, String(p ?? ''));
  const HEAD = Math.floor(cfg.maxChars * 2 / 3), TAIL = cfg.maxChars - HEAD;
  // Head plus a rolling tail: a flood of output never grows the server's memory.
  const collector = () => {
    let head = '', tail = '', total = 0;
    return {
      add(d) {
        const s = String(d); total += s.length;
        let rest = s;
        if (head.length < HEAD) { const take = HEAD - head.length; head += s.slice(0, take); rest = s.slice(take); }
        if (rest && TAIL > 0) tail = (tail + rest).slice(-TAIL);
      },
      text() { const kept = head.length + tail.length; return total <= kept ? head + tail : `${head}\n\n[... ${total - kept} characters truncated ...]\n\n${tail}`; },
    };
  };
  const clip = s => { const c = collector(); c.add(s); return c.text(); };
  const run = (file, args, timeoutMs) => new Promise(resolve => {
    const child = spawn(file, args, { cwd: WORKDIR, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = collector();
    let timedOut = false, done = false;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => out.add(d)); child.stderr.on('data', d => out.add(d));
    const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
    const finish = (code, signal) => {
      if (done) return; done = true; clearTimeout(timer);
      // Background processes do not outlive their command (their group is killed once the command's shell is gone).
      killGroup(); child.stdout.destroy(); child.stderr.destroy();
      resolve({ code, signal, timedOut, text: out.text() });
    };
    child.on('error', e => { out.add(String(e?.message ?? e)); finish(127, null); });
    child.on('exit', (code, signal) => setTimeout(() => finish(code, signal), 200));
    child.on('close', (code, signal) => finish(code, signal));
  });
  const ops = {
    async bash({ command, timeoutMs }) {
      if (typeof command !== 'string' || !command.trim()) throw new Error('command must be a non-empty string');
      const r = await run(SHELL, ['-c', command], timeoutMs);
      let output = r.text;
      if (r.timedOut) output += `${output ? '\n' : ''}[command timed out after ${Math.round(timeoutMs / 1000)} s; its process group was killed]`;
      else if (r.code !== 0) output += `${output ? '\n' : ''}[exit code ${r.code ?? `signal ${r.signal}`}]`;
      return { output: output || '(no output)', isError: r.timedOut || r.code !== 0 };
    },
    async read({ file_path, offset, limit }) {
      const p = at(file_path), st = fs.statSync(p);
      if (st.isDirectory()) throw new Error(`${p} is a directory: list it with Bash (ls)`);
      if (st.size > cfg.readMaxBytes) throw new Error(`${p} has ${st.size} bytes, more than ${cfg.readMaxBytes}: read parts of it with Bash (head, sed -n)`);
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      if (lines.at(-1) === '') lines.pop();
      const start = Number.isInteger(offset) && offset > 0 ? offset : 1, n = Number.isInteger(limit) && limit > 0 ? limit : 2000;
      const body = lines.slice(start - 1, start - 1 + n).map((l, i) => `${String(start + i).padStart(6)}\t${l.length > 2000 ? `${l.slice(0, 2000)} [line truncated]` : l}`).join('\n');
      return { output: clip(body || (lines.length ? `(no lines from ${start}: the file has ${lines.length})` : '(empty file)')) };
    },
    async write({ file_path, content }) {
      if (typeof content !== 'string') throw new Error('content must be a string');
      const p = at(file_path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
      return { output: `Wrote ${Buffer.byteLength(content)} bytes to ${p}` };
    },
    async edit({ file_path, old_string, new_string, replace_all = false }) {
      if (typeof old_string !== 'string' || typeof new_string !== 'string' || !old_string) throw new Error('old_string (non-empty) and new_string must be strings');
      if (old_string === new_string) throw new Error('old_string and new_string are the same');
      const p = at(file_path), text = fs.readFileSync(p, 'utf8'), count = text.split(old_string).length - 1;
      if (!count) throw new Error(`old_string was not found in ${p}`);
      if (count > 1 && !replace_all) throw new Error(`old_string occurs ${count} times in ${p}: give more context or set replace_all`);
      fs.writeFileSync(p, replace_all ? text.split(old_string).join(new_string) : text.replace(old_string, () => new_string));
      return { output: `Edited ${p} (${replace_all ? count : 1} replacement${(replace_all ? count : 1) === 1 ? '' : 's'})` };
    },
    async glob({ pattern, path: dir }) {
      if (typeof pattern !== 'string' || !pattern) throw new Error('pattern must be a non-empty string');
      const base = at(dir ?? '.');
      const hits = fs.globSync(pattern, { cwd: base }).map(f => path.resolve(base, f)).map(f => { try { return [f, fs.statSync(f).mtimeMs]; } catch { return [f, 0]; } }).sort((a, b) => b[1] - a[1]).map(([f]) => f);
      return { output: hits.length ? hits.slice(0, 100).join('\n') + (hits.length > 100 ? `\n[${hits.length - 100} more not shown]` : '') : 'No files found' };
    },
    async grep({ pattern, path: target, glob, output_mode = 'files_with_matches', ignore_case = false, head_limit }) {
      if (typeof pattern !== 'string' || !pattern) throw new Error('pattern must be a non-empty string');
      const mode = { files_with_matches: '-l', content: '-n', count: '-c' }[output_mode];
      if (!mode) throw new Error('output_mode must be files_with_matches, content or count');
      const rg = onPath('rg');
      const args = rg ? ['--no-heading', '--color=never', mode, ...(ignore_case ? ['-i'] : []), ...(glob ? ['--glob', String(glob)] : []), '-e', pattern, '--', at(target ?? '.')]
        : ['-r', '-E', mode, ...(ignore_case ? ['-i'] : []), ...(glob ? [`--include=${glob}`] : []), '-e', pattern, '--', at(target ?? '.')];
      const r = await run(rg ?? (onPath('grep') ?? '/bin/grep'), args, cfg.otherTimeoutMs);
      if (r.code === 1 && !r.timedOut) return { output: 'No matches found' };
      let text = r.text;
      if (Number.isInteger(head_limit) && head_limit > 0) text = text.split('\n').slice(0, head_limit).join('\n');
      return { output: text || 'No matches found', isError: r.timedOut || r.code > 1 };
    },
  };
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let chain = Promise.resolve();
  rl.on('line', line => {
    chain = chain.then(async () => {
      let req;
      try { req = JSON.parse(line); } catch { return; }
      try {
        if (!Object.hasOwn(ops, req?.op)) throw new Error(`unknown operation ${req?.op}`);
        send({ id: req.id, ...(await ops[req.op](req.args ?? {})) });
      } catch (e) { send({ id: req?.id ?? null, error: String(e?.message ?? e).slice(0, 2000) }); }
    });
  });
  rl.on('close', () => { chain.then(() => process.exit(0)); });
  send({ hello: cfg.nonce });
}

/** One sandbox per session: started before the first model call, closed (every process in it killed) at the end. */
export class SandboxSession {
  constructor({ workdir, kitDir = null, hidden = DEFAULT_HIDDEN, keepRo = OPENAI_CHAT_KEEP_RO, env, network = false, maxChars = TOOL_OUTPUT_MAX_CHARS, readMaxBytes = 8 * 1024 * 1024 }) {
    this.nonce = randomUUID();
    const cfg = { nonce: this.nonce, maxChars, readMaxBytes, otherTimeoutMs: OTHER_TOOL_TIMEOUT_MS };
    const code = `(${commandServer.toString()})(${JSON.stringify(cfg)}).catch(e => { console.error(String(e?.stack ?? e)); process.exit(70); });`;
    this.script = sandboxScript(maskSteps({ workdir, kitDir, hidden, keepRo }), workdir, ['node', '-e', code]);
    this.args = [...UNSHARE_ARGS, ...(network ? [] : ['--net']), 'sh', '-c', this.script];
    this.env = env; this.pending = new Map(); this.seq = 0; this.stdout = ''; this.stderr = ''; this.ready = false; this.hello = false; this.closed = false;
  }
  start(timeoutMs = 60_000) {
    this.child = spawn('unshare', this.args, { env: this.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    this.exited = new Promise(resolve => this.child.on('close', (code, signal) => { this.closed = true; this.exitCode = code ?? signal; this.failAll(); resolve(); }));
    this.child.stdin.on('error', () => {});
    this.child.on('error', () => {});
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8');   // a multibyte character may span chunks
    this.child.stderr.on('data', d => {
      if (this.stderr.length < 64 * 1024) this.stderr += d;
      if (!this.ready && this.stderr.includes(`${SANDBOX_READY}\n`)) this.ready = true;
    });
    this.child.stdout.on('data', d => {
      this.stdout += d;
      // A reply line is bounded by the server's output cap; anything far beyond it is not the server talking.
      if (this.stdout.length > 16 * 1024 * 1024) { this.protocolError = 'oversized reply'; this.kill(); return; }
      let i;
      while ((i = this.stdout.indexOf('\n')) >= 0) {
        const line = this.stdout.slice(0, i); this.stdout = this.stdout.slice(i + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg?.hello === this.nonce) { this.hello = true; this.onHello?.(); continue; }
        const p = this.pending.get(msg?.id);
        if (p) { this.pending.delete(msg.id); clearTimeout(p.timer); p.resolve(msg); }
      }
    });
    return new Promise(resolve => {
      const t = setTimeout(() => { this.kill(); resolve(this.ready ? 'EXECUTOR_LAUNCH' : 'SANDBOX_UNAVAILABLE'); }, timeoutMs);
      this.onHello = () => { clearTimeout(t); resolve(null); };
      this.exited.then(() => { clearTimeout(t); resolve(this.hello ? null : this.ready ? 'EXECUTOR_LAUNCH' : 'SANDBOX_UNAVAILABLE'); });
    });
  }
  /** Run one operation in the sandbox: resolves { output, isError } or { error }; rejects only if the session ended. */
  request(op, args, timeoutMs) {
    if (this.closed) return Promise.reject(new FoundryError('EXECUTOR_ERROR', 'the sandbox session has ended'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new FoundryError('EXECUTOR_ERROR', `the sandbox did not answer ${op} within ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, op, args }) + '\n');
    });
  }
  failAll() { for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new FoundryError('EXECUTOR_ERROR', `the sandbox session ended${this.protocolError ? ` (${this.protocolError})` : ''}`)); this.pending.delete(id); } }
  kill() { try { process.kill(-this.child.pid, 'SIGKILL'); } catch {} }
  async close() { if (!this.child) return; this.kill(); await this.exited; }
}

// --- the endpoint ------------------------------------------------------------------------------------------------------
/** Replace every occurrence of the credential (and any bearer token) in text that may reach a log or a result. */
export const redact = (text, secret) => {
  let s = String(text ?? '');
  if (typeof secret === 'string' && secret.length >= 4) s = s.split(secret).join('[redacted]');
  return s.replace(/(bearer\s+)[^\s"',;]+/gi, '$1[redacted]').replace(/("?authorization"?\s*[:=]\s*"?)[^"\n]+/gi, '$1[redacted]');
};

/** POST JSON; resolves { status, headers, text } or rejects with the transport error. https goes through the host's
 * HTTPS_PROXY when one is set (the cloud's egress), plain http only to loopback (tests). */
function postJson(url, body, { headers, timeoutMs, signal, hostEnv }) {
  const u = new URL(url);
  const secure = u.protocol === 'https:';
  const proxyEnv = Object.fromEntries(PROXY_VARS.filter(k => typeof hostEnv[k] === 'string').map(k => [k, hostEnv[k]]));
  const agent = secure ? new https.Agent({ keepAlive: false, ...(Object.keys(proxyEnv).length ? { proxyEnv } : {}) }) : new http.Agent({ keepAlive: false });
  const data = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request(u, { method: 'POST', agent, signal, headers: { 'content-type': 'application/json', accept: 'application/json', 'content-length': data.length, ...headers } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error(`no response within ${Math.round(timeoutMs / 1000)} s`), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(data);
  });
}

class SessionStop extends Error { constructor(code, message, subtype = 'error_during_execution') { super(message); this.code = code; this.subtype = subtype; } }
const sleep = (ms, signal) => new Promise(resolve => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); });

/** Classify one failed attempt: { code, retry }. */
export function classifyHttp({ status = null, text = '', transportError = null }) {
  if (transportError) return { code: 'MODEL_UNAVAILABLE', retry: true };
  if (status === 429 || status === 529) return { code: 'MODEL_RATE_LIMIT', retry: true };
  if (status >= 500 || status === 408) return { code: 'MODEL_UNAVAILABLE', retry: true };
  if (LIMITED.test(text)) return { code: 'MODEL_RATE_LIMIT', retry: false };
  if (status === 401 || status === 403) return { code: 'MODEL_UNAVAILABLE', retry: false };
  return { code: 'EXECUTOR_ERROR', retry: false };
}

const usageOf = u => ({
  input: Number(u?.prompt_tokens ?? u?.input_tokens ?? 0) || 0, output: Number(u?.completion_tokens ?? u?.output_tokens ?? 0) || 0,
  cached: Number(u?.prompt_tokens_details?.cached_tokens ?? u?.cached_tokens ?? 0) || 0,
  reasoning: Number(u?.completion_tokens_details?.reasoning_tokens ?? u?.reasoning_tokens ?? 0) || 0,
});
/** USD for one response's usage at the policy price (cached input at cacheReadPerMTok when listed, else the input price). */
export const priceUsage = (u, price) => ((u.input - u.cached) * price.inputPerMTok + u.cached * (price.cacheReadPerMTok ?? price.inputPerMTok) + u.output * price.outputPerMTok) / 1e6;

/** The executor for a policy model: this one for an executorModels entry (kind openai-chat-https), runClaudeCode for a
 * claude-cli model. Refuses ids the policy does not list and kinds no session executor serves. */
export function executorForModel(policy, model) {
  const { entry, provider, kind } = sessionModelById(policy, model);
  if (kind === REMOTE_CHAT_KIND) return { kind: EXECUTOR_KIND, run: runOpenAIChat, entry, provider, source: `executor:${EXECUTOR_KIND}` };
  if (kind === 'claude-cli') return { kind: 'claude-code', run: runClaudeCode, entry, provider, source: 'executor:claude-code' };
  throw new FoundryError('EXECUTOR_MODEL', `model ${model} (provider kind ${kind}) has no session executor`);
}

// --- the session -------------------------------------------------------------------------------------------------------
// Run one session. Returns raw facts like runClaudeCode; callers decide success with an oracle. Caller errors (no model, a
// model the policy does not list as an executor model, an unsupported tool or effort) throw; everything that happens once
// the session is set up is returned as error.code.
// Extra options beside runClaudeCode's: maxTurns (also accepted, as the A1 runner passes it), tokenBudget, network,
// policy (default: policy/models.json), baseUrl (a loopback override for tests only), retry, requestTimeoutMs.
// `binary` (the claude CLI or its step-guard wrapper) has no meaning here and is ignored: the step guard's only effect,
// maxTurns, is enforced natively. `task` is ignored as by runClaudeCode.
export async function runOpenAIChat({
  model, prompt, workdir, files = {}, budgetUsd = 1, timeoutMs = 15 * 60 * 1000, tools = DEFAULT_TOOLS,
  hidden = DEFAULT_HIDDEN, keepRo = OPENAI_CHAT_KEEP_RO, kitDir = null, systemPrompt = null, appendSystemPrompt = null, effort = null, binary = null, signal,
  env: extraEnv = {}, hostEnv = process.env, maxTurns = null, tokenBudget = DEFAULT_TOKEN_BUDGET, network = false,
  policy = null, baseUrl = null, retry = DEFAULT_RETRY, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  if (!model) throw new FoundryError('EXECUTOR_MODEL', 'An explicit model id from the policy file is required');
  const pol = policy ?? loadPolicy().policy;
  const { entry, provider } = executorModelById(pol, model);
  if (provider.kind !== REMOTE_CHAT_KIND) throw new FoundryError('EXECUTOR_MODEL', `model ${model} is not served by a ${REMOTE_CHAT_KIND} provider`);
  const unsupported = (tools ?? []).filter(t => !SUPPORTED_TOOLS.includes(t));
  if (unsupported.length) throw new FoundryError('EXECUTOR_TOOLS', `the ${EXECUTOR_KIND} executor offers ${SUPPORTED_TOOLS.join(', ')}; unsupported: ${unsupported.join(', ')}`);
  if (effort !== null && !EFFORTS.includes(effort)) throw new FoundryError('EXECUTOR_EFFORT', `effort ${effort} has no counterpart on this endpoint (reasoning_effort ${EFFORTS.join('|')})`);
  if (maxTurns !== null && !(Number.isInteger(maxTurns) && maxTurns >= 1)) throw new FoundryError('EXECUTOR_OPTION', 'maxTurns must be a positive integer or null');
  if (tokenBudget !== null && !(Number.isInteger(tokenBudget) && tokenBudget >= 1)) throw new FoundryError('EXECUTOR_OPTION', 'tokenBudget must be a positive integer or null');
  if (baseUrl !== null && !LOOPBACK.test(baseUrl)) throw new FoundryError('EXECUTOR_OPTION', 'a baseUrl override must be plain http on loopback (tests only); remote endpoints come from the policy');
  const endpoint = `${(baseUrl ?? provider.baseUrl).replace(/\/+$/, '')}/chat/completions`;
  if (!(baseUrl ? LOOPBACK : HTTPS).test(endpoint)) throw new FoundryError('EXECUTOR_OPTION', `endpoint ${endpoint} is not https`);
  const toolList = [...new Set(tools ?? [])];
  const credentialEnv = provider.credentialEnv;
  // The sandbox environment: the claude executor's allow-list (and its extraEnv refusals), minus the CLI login and, without
  // network, the proxy routing. The endpoint credential can never be in it: its name is not on the allow-list.
  const sandboxEnv = executorEnv({ env: hostEnv, extraEnv, hidden });
  delete sandboxEnv.CLAUDE_CODE_OAUTH_TOKEN;
  if (!network) for (const k of [...PROXY_VARS, 'HTTP_PROXY', 'http_proxy']) delete sandboxEnv[k];
  const keyAtStart = hostEnv[credentialEnv];
  if (Object.hasOwn(sandboxEnv, credentialEnv) || (typeof keyAtStart === 'string' && keyAtStart && Object.values(sandboxEnv).includes(keyAtStart))) throw new FoundryError('SANDBOX_ENV', `refusing to pass ${credentialEnv} into the sandbox`);
  materialize(workdir, files);

  const sessionId = randomUUID(), started = Date.now(), transcript = path.join(workdir, TRANSCRIPT_FILE);
  const price = entry.price, priced = price.inputPerMTok > 0 || price.outputPerMTok > 0 || (price.cacheReadPerMTok ?? 0) > 0;
  const events = [], toolUses = [], served = new Map();
  const ts = () => new Date().toISOString();
  const totals = { input: 0, output: 0, cached: 0, reasoning: 0 };
  let costUsd = 0, usageMissing = false, inFlight = false, turns = 0, requests = 0, retries = 0, finalText = null, stop = null, sandbox = null, sandboxReady = toolList.length === 0;
  const system = [systemPrompt ?? defaultSystemPrompt({ tools: toolList, network }), appendSystemPrompt].filter(Boolean).join('\n\n');
  const requestDefaults = provider.requestDefaults ?? {};
  events.push({ type: 'system', subtype: 'init', session_id: sessionId, model, tools: toolList, cwd: workdir, timestamp: ts(),
    executor: EXECUTOR_KIND, provider: entry.provider, endpoint: baseUrl ? 'loopback override (test)' : endpoint, credentialEnv, requestDefaults, reasoningEffort: effort,
    maxTurns, budgetUsd, tokenBudget, timeoutMs, network, systemPromptSource: systemPrompt ? 'caller' : 'default', ...(binary ? { ignored: { binary } } : {}) });

  const controller = new AbortController();
  const onAbort = () => controller.abort(new SessionStop('EXECUTOR_CANCELLED', 'the caller cancelled the session'));
  if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new SessionStop('EXECUTOR_TIMEOUT', `the session ran past ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
  const aborted = () => controller.signal.aborted ? controller.signal.reason : null;
  const raceAbort = p => new Promise((resolve, reject) => {
    if (aborted()) return reject(aborted());
    const on = () => reject(aborted());
    controller.signal.addEventListener('abort', on, { once: true });
    p.then(v => { controller.signal.removeEventListener('abort', on); resolve(v); }, e => { controller.signal.removeEventListener('abort', on); reject(e); });
  });

  // One chat.completions call with bounded retries. Returns the parsed body; throws SessionStop.
  const complete = async messages => {
    const body = { model, messages, ...(toolList.length ? { tools: toolDefinitions(toolList), tool_choice: 'auto' } : {}), ...requestDefaults, ...(effort ? { reasoning_effort: effort } : {}) };
    const origin = new URL(endpoint).origin;
    for (let attempt = 1; ; attempt++) {
      if (aborted()) throw aborted();
      const cool = (COOLDOWN.get(origin) ?? 0) - Date.now();
      if (cool > 0) {
        if (cool >= started + timeoutMs - Date.now()) throw new SessionStop('MODEL_RATE_LIMIT', `the endpoint is cooling down for ${Math.round(cool / 1000)} s after a rate limit, past this session's time`);
        events.push({ type: 'system', subtype: 'rate_limit_wait', session_id: sessionId, timestamp: ts(), waitMs: cool });
        await sleep(cool, controller.signal);
        if (aborted()) throw aborted();
      }
      const key = hostEnv[credentialEnv];   // read at call time, never cached
      if (typeof key !== 'string' || !key) throw new SessionStop('MODEL_UNAVAILABLE', `no credential: the environment variable ${credentialEnv} is not set`);
      let res = null, transportError = null;
      requests += 1; inFlight = true;
      try { res = await postJson(endpoint, body, { headers: { authorization: `Bearer ${key}` }, timeoutMs: requestTimeoutMs, signal: controller.signal, hostEnv }); }
      catch (e) { if (aborted()) throw aborted(); transportError = e; }
      inFlight = false;
      if (res && res.status >= 200 && res.status < 300) {
        try { return JSON.parse(res.text); } catch { throw new SessionStop('EXECUTOR_PROTOCOL', `the endpoint answered ${res.status} with a body that is not JSON: ${redact(res.text.slice(0, 300), key)}`); }
      }
      const { code, retry: again } = classifyHttp({ status: res?.status ?? null, text: res?.text ?? '', transportError });
      const detail = res ? `HTTP ${res.status}: ${redact(res.text.slice(0, 500), key)}` : `${transportError?.code ?? 'transport error'}: ${redact(transportError?.message ?? transportError, key).slice(0, 300)}`;
      const retryAfter = Number(res?.headers?.['retry-after']);
      const delay = Math.round(Math.min(retry.maxDelayMs, Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : retry.baseDelayMs * 2 ** (attempt - 1)) * (1 + Math.random() * 0.1));
      if (code === 'MODEL_RATE_LIMIT' && again) COOLDOWN.set(origin, Math.max(COOLDOWN.get(origin) ?? 0, Date.now() + delay));
      const room = started + timeoutMs - Date.now();
      events.push({ type: 'system', subtype: 'api_error', session_id: sessionId, timestamp: ts(), attempt, status: res?.status ?? null, code, retry: again && attempt < retry.attempts && delay < room, delayMs: delay, detail });
      if (!again || attempt >= retry.attempts || delay >= room) throw new SessionStop(code, `${detail} (attempt ${attempt} of ${retry.attempts})`);
      retries += 1;
      await sleep(delay, controller.signal);
    }
  };

  const runTool = async (call, name, input) => {
    if (!toolList.includes(name)) return { output: `Unknown tool ${name}: the tools are ${toolList.join(', ')}`, isError: true };
    if (input === null) return { output: 'The tool arguments are not a JSON object', isError: true };
    let args = input, wait = OTHER_TOOL_TIMEOUT_MS;
    if (name === 'Bash') {
      const asked = Number(input.timeout);
      const timeout = Math.min(BASH_MAX_TIMEOUT_MS, Number.isFinite(asked) && asked > 0 ? asked : BASH_DEFAULT_TIMEOUT_MS, Math.max(1000, started + timeoutMs - Date.now()));
      args = { command: input.command, timeoutMs: timeout }; wait = timeout;
    }
    try {
      const reply = await raceAbort(sandbox.request(OP_OF[name], args, wait + 15_000));
      return reply.error !== undefined ? { output: `Error: ${reply.error}`, isError: true } : { output: String(reply.output ?? ''), isError: Boolean(reply.isError) };
    } catch (e) {
      if (e instanceof SessionStop) throw e;
      throw new SessionStop('EXECUTOR_ERROR', String(e?.message ?? e));
    }
  };

  try {
    if (!sandboxAvailable()) throw new SessionStop('SANDBOX_UNAVAILABLE', 'User/mount/pid namespaces are required to hide oracles from executors');
    if (typeof keyAtStart !== 'string' || !keyAtStart) throw new SessionStop('MODEL_UNAVAILABLE', `no credential: the environment variable ${credentialEnv} is not set`);
    if (toolList.length) {
      sandbox = new SandboxSession({ workdir, kitDir, hidden, keepRo: keepRo.filter(p => p !== CLOUD_LOGIN_FILE), env: sandboxEnv, network });
      const failed = await raceAbort(sandbox.start());
      sandboxReady = sandbox.ready;
      if (failed) throw new SessionStop(failed, failed === 'SANDBOX_UNAVAILABLE' ? `the sandbox could not be set up: ${sandbox.stderr.slice(-500)}` : `the command server did not start: ${sandbox.stderr.slice(-500)}`);
    }
    const messages = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
    while (true) {
      if (priced && costUsd >= budgetUsd) throw new SessionStop('EXECUTOR_BUDGET', `spent $${costUsd.toFixed(6)} of the $${budgetUsd} session budget`, 'error_max_budget_usd');
      if (tokenBudget !== null && totals.input + totals.output >= tokenBudget) throw new SessionStop('EXECUTOR_BUDGET', `used ${totals.input + totals.output} tokens of the ${tokenBudget}-token session budget`, 'error_max_budget_tokens');
      const data = await complete(messages);
      const choice = data?.choices?.[0], msg = choice?.message;
      if (!msg || typeof msg !== 'object') {
        const said = redact(JSON.stringify(data?.error ?? data ?? null).slice(0, 300), hostEnv[credentialEnv]);
        throw new SessionStop(LIMITED.test(said) ? 'MODEL_RATE_LIMIT' : 'EXECUTOR_PROTOCOL', `the endpoint returned no message: ${said}`);
      }
      turns += 1;
      const u = data.usage ? usageOf(data.usage) : null;
      const servedModel = typeof data.model === 'string' && data.model ? data.model : model;
      const byModel = served.get(servedModel) ?? { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, reasoningTokens: 0, responses: 0 };
      served.set(servedModel, byModel); byModel.responses += 1;
      if (u) {
        for (const k of Object.keys(totals)) totals[k] += u[k];
        costUsd += priceUsage(u, price);
        byModel.inputTokens += u.input; byModel.outputTokens += u.output; byModel.cacheReadInputTokens += u.cached; byModel.reasoningTokens += u.reasoning;
      } else usageMissing = true;
      const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map(c => c?.text ?? '').join('') : '';
      const calls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).map((c, i) => ({ ...c, id: typeof c?.id === 'string' && c.id ? c.id : `call_${turns}_${i}` }));
      const parsed = calls.map(c => { const raw = c?.function?.arguments; if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw; try { const v = JSON.parse(raw || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } });
      const reasoning = typeof msg.reasoning_content === 'string' ? msg.reasoning_content : typeof msg.reasoning === 'string' ? msg.reasoning : null;
      // A unique message id per response: the auditor counts responses by distinct id, and an endpoint may reuse ids.
      events.push({ type: 'assistant', session_id: sessionId, timestamp: ts(), message: { id: `${sessionId}-r${turns}`, type: 'message', role: 'assistant', model: servedModel, provider_id: data.id ?? null,
        stop_reason: choice.finish_reason ?? null,
        content: [...(reasoning ? [{ type: 'thinking', thinking: reasoning }] : []), ...(text ? [{ type: 'text', text }] : []),
          ...calls.map((c, i) => ({ type: 'tool_use', id: c.id, name: String(c?.function?.name ?? ''), input: parsed[i] ?? { _unparsed: String(c?.function?.arguments ?? '').slice(0, 20_000) } }))],
        usage: u ? { input_tokens: u.input, output_tokens: u.output, cache_read_input_tokens: u.cached, reasoning_tokens: u.reasoning } : null, raw_usage: data.usage ?? null } });
      messages.push({ role: 'assistant', content: msg.content ?? null, ...(calls.length ? { tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: String(c?.function?.name ?? ''), arguments: typeof c?.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c?.function?.arguments ?? {}) } })) } : {}) });
      if (!calls.length) { finalText = text; break; }
      for (const [i, c] of calls.entries()) {
        const name = String(c?.function?.name ?? '');
        toolUses.push({ name, input: parsed[i] ?? {} });
        const r = await runTool(c, name, parsed[i]);
        events.push({ type: 'user', session_id: sessionId, timestamp: ts(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: c.id, content: r.output, is_error: r.isError }] } });
        messages.push({ role: 'tool', tool_call_id: c.id, content: r.output });
      }
      if (maxTurns !== null && turns >= maxTurns) throw new SessionStop('EXECUTOR_MAX_TURNS', `reached maxTurns ${maxTurns}`, 'error_max_turns');
    }
  } catch (e) {
    stop = e instanceof SessionStop ? e : aborted() instanceof SessionStop ? aborted() : new SessionStop('EXECUTOR_ERROR', String(e?.message ?? e));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    await sandbox?.close();
  }
  const neverStarted = requests === 0;
  // A request cut off in flight (timeout, cancel) may have been billed without a usage report; so may a response without one.
  const unknown = priced && (usageMissing || (inFlight && !neverStarted));
  const cost = neverStarted ? 0 : unknown ? null : costUsd;
  const usage = { input_tokens: totals.input, output_tokens: totals.output, cache_read_input_tokens: totals.cached, reasoning_tokens: totals.reasoning };
  events.push({ type: 'result', subtype: stop ? stop.subtype ?? 'error_during_execution' : 'success', is_error: Boolean(stop), session_id: sessionId, timestamp: ts(),
    result: finalText, error_code: stop?.code ?? null, error: stop ? stop.message.slice(0, 2000) : null, num_turns: turns, requests, retries, duration_ms: Date.now() - started,
    total_cost_usd: cost, usage, modelUsage: Object.fromEntries(served) });
  writeTranscript(transcript, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  return {
    ok: !stop, error: stop ? { code: stop.code, exitCode: null, stderr: stop.message.slice(-2000) } : null, sandboxReady,
    result: finalText, costUsd: cost, costUnknown: cost === null, costUpperUsd: cost ?? Math.max(budgetUsd, costUsd),
    streamUsage: { inputTokens: totals.input, outputTokens: totals.output, cacheReadTokens: totals.cached, cacheWriteTokens: 0, reasoningTokens: totals.reasoning },
    turns, sessionId, usage, durationMs: Date.now() - started, toolUses, requests, retries, servedModels: [...served.keys()],
    label: `executor:${EXECUTOR_KIND}:${model}`, transcript,
  };
}

/** Write the transcript without following anything the session left at that path (a planted link or directory). */
function writeTranscript(file, text) {
  try { rmSync(file, { recursive: true, force: true }); } catch {}
  try { writeFileSync(file, text, { flag: 'wx' }); } catch {}
}
