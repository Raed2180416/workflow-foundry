// Shared helpers for the quota-meter probes (BLOCKER-SYNTHESIS §2.1 row 6, B10-E2).
// One call = one `claude -p` child with the repo's own invocation flags (policy/models.json providers.claude-cli),
// except that --output-format is stream-json --verbose so the rate_limit_event is visible. Auth is the CLI's own login;
// nothing here reads a credential or ~/.claude. The prompt goes in on stdin, the raw stream goes to disk unchanged.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');

// The repo's invocation, read from the policy so this never drifts from what the provider runs.
export function repoInvocation() {
  const policy = JSON.parse(readFileSync(path.join(REPO, 'policy/models.json'), 'utf8'));
  const cfg = policy.providers['claude-cli'];
  return { invocation: [...cfg.invocation], childEnv: { ...cfg.childEnv } };
}

// Keys whose values must never be saved. The CLI's streams carry none today (checked in README); this is the guard.
const SECRETISH = /(token|secret|password|api[_-]?key|authorization|bearer|cookie)/i;
const VALUE_SECRET = /\b(sk-[A-Za-z0-9_-]{10,}|sk-ant-[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/;

/** Run one call. opts: model, prompt, system?, format ('stream-json' | 'json'), env overrides, maxBudgetUsd, timeoutMs, cwd.
 *  Returns { exitCode, lines (parsed), rawText, stderr, wallMs, summary }. */
export function runCall({ model, prompt, system, format = 'stream-json', childEnv, maxBudgetUsd = 0.1, timeoutMs = 120000, cwd = '/var/tmp/qm-cwd', effort }) {
  const { invocation, childEnv: policyEnv } = repoInvocation();
  const args = [...invocation];
  // Replace the policy's json output format with the requested one; stream-json needs --verbose with -p.
  const i = args.indexOf('--output-format');
  args[i + 1] = format;
  if (format === 'stream-json') args.push('--verbose');
  args.push('--model', model, '--max-budget-usd', String(maxBudgetUsd));
  if (system) args.push('--system-prompt', system);
  if (effort) args.push('--effort', effort);
  mkdirSync(cwd, { recursive: true });
  const env = { ...process.env };
  // Mirror claudeChildEnv: scrub the parent Claude session's identity, then apply the policy block (null removes).
  for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_(SSE_PORT|ENTRYPOINT|EXECPATH)|CLAUDE_EFFORT|MAX_THINKING_TOKENS)$/.test(k)) delete env[k];
  for (const [k, v] of Object.entries(childEnv ?? policyEnv)) { if (v === null) delete env[k]; else env[k] = v; }
  const t0 = Date.now();
  return new Promise(resolve => {
    const child = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.stdin.end(prompt);
    child.on('close', code => {
      clearTimeout(timer);
      const lines = out.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { _unparsed: l.slice(0, 200) }; } });
      resolve({ exitCode: code, lines, rawText: out, stderr: err.slice(-2000), wallMs: Date.now() - t0, args: args.map(a => a === system ? '<system>' : a), summary: summarize(lines) });
    });
  });
}

/** Pull the meter-relevant facts out of a parsed stream (or the single object of --output-format json). */
export function summarize(lines) {
  const result = lines.findLast?.(l => l.type === 'result') ?? lines.filter(l => l.type === 'result').at(-1) ?? (lines.length === 1 ? lines[0] : null);
  const rl = lines.filter(l => l.type === 'rate_limit_event');
  const info = rl.at(-1)?.rate_limit_info ?? null;
  const u = result?.usage ?? {};
  return {
    resultType: result?.type ?? null,
    costUsd: result?.total_cost_usd ?? null,
    inputTokens: u.input_tokens ?? null, outputTokens: u.output_tokens ?? null,
    cacheReadTokens: u.cache_read_input_tokens ?? null, cacheWriteTokens: u.cache_creation_input_tokens ?? null,
    cacheWrite5m: u.cache_creation?.ephemeral_5m_input_tokens ?? null, cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens ?? null,
    durationMs: result?.duration_ms ?? null, durationApiMs: result?.duration_api_ms ?? null,
    served: Object.keys(result?.modelUsage ?? {}),
    isError: result?.is_error ?? null, subtype: result?.subtype ?? null, text: typeof result?.result === 'string' ? result.result.slice(0, 80) : null,
    rateLimitEvents: rl.length,
    status: info?.status ?? null, claimType: info?.rateLimitType ?? null,
    fiveHour: info?.unifiedWindows?.five_hour ?? null, sevenDay: info?.unifiedWindows?.seven_day ?? null,
    windowsPresent: info?.unifiedWindows ? Object.keys(info.unifiedWindows) : [],
    rateLimitInfo: info,
  };
}

/** Walk a value and report any key or string value that looks like a credential. Returns the offending paths. */
export function secretScan(value, prefix = '') {
  const hits = [];
  const walk = (v, p) => {
    if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { if (SECRETISH.test(k) && typeof x === 'string' && x.length > 8) hits.push(`${p}.${k}`); walk(x, `${p}.${k}`); } }
    else if (typeof v === 'string' && VALUE_SECRET.test(v)) hits.push(p);
  };
  walk(value, prefix);
  return hits;
}

export function saveRaw(dir, label, rawText) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${label}.jsonl`);
  writeFileSync(file, rawText);
  return file;
}

export function appendJsonl(file, obj) { mkdirSync(path.dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify(obj) + '\n'); }

/** Deterministic padding that does not compress to a few tokens: numbered lines of pseudo-random hex (about 1.3 to 2 characters
 *  per token on Haiku 5.5, measured: a request of 70000 gave about 92000 cache-write tokens). */
export function pad(seed, tokens) {
  const lines = []; let h = createHash('sha256').update(seed).digest('hex');
  for (let chars = 0; chars < tokens * 2; chars += 70) { h = createHash('sha256').update(h).digest('hex'); lines.push(`${lines.length}: ${h}`); }
  return lines.join('\n');
}
