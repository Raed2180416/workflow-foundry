// Hosted Claude models through the headless `claude -p` CLI (DESIGN §2). One structured
// judgment per call: no tools, no MCP, no session, an empty throwaway cwd, a per-call USD cap.
// The CLI authenticates with its own managed login, so the environment is inherited (minus
// repository credentials) and is never logged.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FoundryError } from '../../data.mjs';
import { runProcess } from '../../process.mjs';
import { isPolicyModel } from '../policy.mjs';

const EFFORT = { none: 'low', low: 'low', medium: 'medium', high: 'high' };
const SCRUBBED = /^(GH_TOKEN|GITHUB_TOKEN|GIT_CONFIG_.*|GIT_ASKPASS|CLOUDSDK_AUTH_ACCESS_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)$/;
const RATE = /\b(429|529)\b|overloaded|rate.?limit/i;
const versions = new Map();

const fail = (code, message, extra = {}) => Object.assign(new FoundryError(code, message), extra);
const finishOf = stop => ({ end_turn: 'stop', tool_use: 'stop', stop_sequence: 'stop', max_tokens: 'length', refusal: 'refusal' })[stop] ?? (stop ?? null);
// Exact id, or the same id with a dated snapshot suffix (claude-haiku-4-5 ~ claude-haiku-4-5-20251001).
const dated = (a, b) => a.length === b.length + 9 && a.startsWith(`${b}-`) && /^\d{8}$/.test(a.slice(b.length + 1));
export const sameModel = (a, b) => typeof a === 'string' && typeof b === 'string' && (a === b || dated(a, b) || dated(b, a));
const usageOf = u => u && ({ inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 });

export function claudeEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k, v]) => typeof v === 'string' && !SCRUBBED.test(k)));
}

/** Map one parsed CLI result object to provider facts, or throw a classified FoundryError. */
export function interpretResult(result, { modelId, stderr = '' } = {}) {
  if (!result || typeof result !== 'object' || result.type !== 'result') throw fail('MODEL_PROTOCOL', 'claude CLI did not return a result object');
  const usage = usageOf(result.usage) ?? undefined;
  const costUsd = typeof result.total_cost_usd === 'number' ? result.total_cost_usd : undefined;
  const servedModels = Object.keys(result.modelUsage ?? {});
  const meta = { subtype: result.subtype ?? null, stopReason: result.stop_reason ?? null, terminalReason: result.terminal_reason ?? null,
    apiErrorStatus: result.api_error_status ?? null, numTurns: result.num_turns ?? null, durationApiMs: result.duration_api_ms ?? null,
    servedModels, costBasis: Object.values(result.modelUsage ?? {})[0]?.costBasis ?? null };
  const extra = { usage, costUsd, meta, text: typeof result.result === 'string' ? result.result : null };
  if (result.is_error || (typeof result.subtype === 'string' && result.subtype.startsWith('error'))) {
    const status = Number(result.api_error_status);
    const detail = `${result.subtype ?? 'error'}${result.api_error_status ? ` (HTTP ${result.api_error_status})` : ''}`;
    if (status === 429 || status === 529 || RATE.test(`${result.result ?? ''} ${stderr}`)) throw fail('MODEL_RATE_LIMIT', `claude CLI rate limited or overloaded: ${detail}`, extra);
    if (result.subtype === 'error_max_budget_usd') throw fail('MODEL_BUDGET', 'claude CLI hit the per-call --max-budget-usd cap', extra);
    if (/structured.?output/i.test(result.subtype ?? '')) throw fail('MODEL_SCHEMA', `claude CLI could not produce structured output: ${detail}`, extra);
    if (result.stop_reason === 'refusal') throw fail('MODEL_REFUSAL', 'The model refused the request', extra);
    if (status >= 500 || status === 401 || status === 403) throw fail('MODEL_UNAVAILABLE', `claude CLI API error: ${detail}`, extra);
    throw fail('MODEL_PROTOCOL', `claude CLI reported an error: ${detail}`, extra);
  }
  // No silent substitution: when the CLI reports which model served the call, it must be the one requested.
  if (modelId && servedModels.length && !servedModels.some(k => sameModel(k, modelId) || sameModel(modelId, result.modelUsage[k]?.canonicalModel)))
    throw fail('MODEL_PROTOCOL', `claude CLI served ${servedModels.join(', ')} instead of ${modelId}`, extra);
  return { value: result.structured_output ?? undefined, text: extra.text, usage, costUsd, finishReason: finishOf(result.stop_reason), meta };
}

export class ClaudeCliProvider {
  constructor({ policy, providerName = 'claude-cli', binary, maxBudgetUsd = 1, timeoutMs = 300000, env = process.env, maxOutputBytes = 8 * 1024 * 1024 } = {}) {
    const config = policy?.providers?.[providerName];
    if (!config || config.kind !== 'claude-cli') throw new FoundryError('MODEL_POLICY_INVALID', `Policy has no claude-cli provider named ${providerName}`);
    if (config.invocation.some(a => a === '--fallback-model' || a.startsWith('--fallback-model='))) throw new FoundryError('MODEL_POLICY_INVALID', '--fallback-model is never passed');
    if (typeof maxBudgetUsd !== 'number' || !(maxBudgetUsd > 0 && maxBudgetUsd <= 25)) throw new FoundryError('MODEL_REQUEST', 'maxBudgetUsd must be in (0, 25]');
    Object.assign(this, { policy, providerName, binary: binary ?? config.binary, invocation: [...config.invocation], maxBudgetUsd, timeoutMs, env, maxOutputBytes });
  }

  async engineVersion() {
    if (!versions.has(this.binary)) {
      const probe = runProcess(this.binary, ['--version'], { env: claudeEnv(this.env), timeoutMs: 30000, maxBytes: 64 * 1024 })
        .then(r => `claude-code ${r.stdout.trim().split(/\s+/)[0]}`);
      versions.set(this.binary, probe);
      probe.catch(() => versions.delete(this.binary));
    }
    return versions.get(this.binary);
  }

  args({ modelEntry, system, schema, decoding = {} }) {
    const args = [...this.invocation, '--model', modelEntry.id, '--system-prompt', system, '--json-schema', JSON.stringify(schema),
      '--effort', EFFORT[decoding.reasoning ?? 'none'] ?? 'low', '--max-budget-usd', String(this.maxBudgetUsd)];
    if (args.some(a => a === '--fallback-model')) throw new FoundryError('MODEL_POLICY_INVALID', '--fallback-model is never passed');
    return args;
  }

  async complete({ modelEntry, system, prompt, schema, decoding = {}, signal, timeoutMs = this.timeoutMs }) {
    if (!modelEntry || !isPolicyModel(this.policy, modelEntry.id) || modelEntry.provider !== this.providerName) throw new FoundryError('MODEL_NOT_IN_POLICY', `Model ${modelEntry?.id} is not a ${this.providerName} model in the policy`);
    let engineVersion;
    try { engineVersion = await this.engineVersion(); }
    catch (error) { throw fail('MODEL_UNAVAILABLE', `claude CLI version probe failed: ${error.code ?? error.message}`); }
    const args = this.args({ modelEntry, system, schema, decoding });
    const request = { binary: path.basename(this.binary), args: args.map(a => a === system ? '<system>' : a), temperature: 'provider-default',
      maxTokens: 'provider-default', effort: EFFORT[decoding.reasoning ?? 'none'], maxBudgetUsd: this.maxBudgetUsd };
    const cwd = mkdtempSync(path.join(tmpdir(), 'foundry-claude-'));
    let processResult, launchError;
    try {
      processResult = await runProcess(this.binary, args, { cwd, env: claudeEnv(this.env), input: prompt, timeoutMs: Math.min(timeoutMs, 3600000), signal, maxBytes: this.maxOutputBytes });
    } catch (error) {
      launchError = error; processResult = error.processResult;
    } finally { rmSync(cwd, { recursive: true, force: true }); }
    const stderr = processResult?.stderr?.slice(-4000) ?? '';
    if (launchError && launchError.code !== 'PROCESS_FAILED') {
      const code = launchError.code === 'PROCESS_TIMEOUT' ? 'MODEL_TIMEOUT' : launchError.code === 'CANCELLED' ? 'CANCELLED'
        : launchError.code === 'PROCESS_LAUNCH' ? 'MODEL_UNAVAILABLE' : 'MODEL_PROTOCOL';
      throw fail(code, `claude CLI ${launchError.message}`, { engineVersion, request });
    }
    let parsed;
    try { parsed = JSON.parse(processResult.stdout); }
    catch {
      const code = RATE.test(stderr) ? 'MODEL_RATE_LIMIT' : 'MODEL_PROTOCOL';
      throw fail(code, `claude CLI exited ${processResult.code ?? processResult.signal} without a JSON result${stderr ? `: ${stderr.trim().split('\n').at(-1).slice(0, 300)}` : ''}`, { engineVersion, request });
    }
    try { return { ...interpretResult(parsed, { modelId: modelEntry.id, stderr }), engineVersion, request }; }
    catch (error) { error.engineVersion = engineVersion; error.request = request; throw error; }
  }
}
