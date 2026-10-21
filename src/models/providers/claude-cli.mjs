// Hosted Claude models through the headless `claude -p` CLI (DESIGN §2). One structured
// judgment per call: no tools, no MCP, no session, an empty throwaway cwd, a per-call USD cap.
// The CLI authenticates with its own managed login, so the environment is inherited (minus
// repository credentials and the CLI's decoding variables) and is never logged; the journal
// records only the closed-list and cache-tier variables the child saw (childEnvRecord).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FoundryError } from '../../data.mjs';
import { runProcess } from '../../process.mjs';
import { CHILD_ENV_ALLOWED, isPolicyModel, validateChildEnv } from '../policy.mjs';
import { DECODING_BY_KIND, THINKING } from '../port.mjs';
import { SCRUBBED_ENV } from '../../executors/claude-code.mjs';

// Thinking budget per reasoning level: defined with the replay-key decoding in ../port.mjs (engine identity).
export { THINKING };
// Repository credentials and the parent Claude session's identity, sockets and tuning (MAX_THINKING_TOKENS is set
// explicitly per call below), shared with the executor sandbox.
const SCRUBBED = SCRUBBED_ENV;
// Rate limits, overload and subscription usage limits are environment faults, never model outcomes.
const RATE = /\b(429|529)\b|overloaded|rate.?limit|usage limit|hit your (usage )?limit|limit reached/i;
const versions = new Map();

const fail = (code, message, extra = {}) => Object.assign(new FoundryError(code, message), extra);
// Wait for a shared promise (the per-binary version probe), but stop waiting when this caller's signal aborts. The probe keeps
// running for other callers; it is bounded by its own timeout.
const untilAborted = (promise, signal) => !signal ? promise : new Promise((resolve, reject) => {
  const cancelled = () => fail('CANCELLED', 'claude CLI call cancelled before launch');
  if (signal.aborted) { promise.catch(() => {}); reject(cancelled()); return; }
  const onAbort = () => reject(cancelled());
  signal.addEventListener('abort', onAbort, { once: true });
  promise.then(v => { signal.removeEventListener('abort', onAbort); resolve(v); }, e => { signal.removeEventListener('abort', onAbort); reject(e); });
});
const finishOf = stop => ({ end_turn: 'stop', tool_use: 'stop', stop_sequence: 'stop', max_tokens: 'length', refusal: 'refusal' })[stop] ?? (stop ?? null);
// Exact id, or the same id with a dated snapshot suffix (claude-haiku-4-5 ~ claude-haiku-4-5-20251001).
const dated = (a, b) => a.length === b.length + 9 && a.startsWith(`${b}-`) && /^\d{8}$/.test(a.slice(b.length + 1));
export const sameModel = (a, b) => typeof a === 'string' && typeof b === 'string' && (a === b || dated(a, b) || dated(b, a));
const usageOf = u => u && ({ inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 });
// The decoding this route actually applies; ModelPort hashes it into the replay key (DESIGN §3). Temperature and
// max tokens are not controllable here, so any requested value becomes the provider default.
export const claudeCliDecoding = DECODING_BY_KIND['claude-cli'];

// CLI variables that change the decoding: the replay key hashes the decoding this provider applies through its flags
// (claudeCliDecoding: --effort, MAX_THINKING_TOKENS, provider-default max tokens and temperature), so an inherited value would make
// the key false. Observed in the claude 2.1.295 binary: "CLAUDE_CODE_EFFORT_LEVEL overrides effort for this session" (over --effort);
// CLAUDE_CODE_MAX_OUTPUT_TOKENS sets the output cap; CLAUDE_CODE_EXTRA_BODY merges fields into the API request; the others switch
// thinking or set a temperature. Removed from the child, like CLAUDE_EFFORT and MAX_THINKING_TOKENS (SCRUBBED_ENV) before them.
const DECODING_ENV = /^(CLAUDE_CODE_EFFORT_LEVEL|CLAUDE_CODE_ALWAYS_ENABLE_EFFORT|CLAUDE_CODE_MAX_OUTPUT_TOKENS|CLAUDE_CODE_EXTRA_BODY|CLAUDE_CODE_DISABLE_THINKING|CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING|DISABLE_INTERLEAVED_THINKING|CLAUDE_CODE_AUTO_MODE_TEMPERATURE)$/;
// CLI variables outside the closed list that also set the prompt-cache tier or switch caching off (observed in the same binary next to
// FORCE_PROMPT_CACHING_5M). They do not change the decoding, so they pass through; when the child inherits one, the journal records it
// next to the flags, because it can override what the flags do to the cost (childEnvRecord).
const CACHE_TIER_ENV = /^(DISABLE_PROMPT_CACHING(_[A-Z]+)?|ENABLE_PROMPT_CACHING_1H(_BEDROCK)?|CLAUDE_CODE_(SUBAGENT_)?PROMPT_CACHE_TTL)$/;

export function claudeEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k, v]) => typeof v === 'string' && !SCRUBBED.test(k) && !DECODING_ENV.test(k)));
}

// Child-process tuning that applies when the policy's provider config has no `childEnv` block (research/review-20261007/
// 04-efficiency-rust.md, change 1: about -0.6 to -0.8 s wall and -17 to -31 % cost per call; re-measured through this provider in
// research/review-20261007/cli-flags-20261008/: median wall -1.3 to -1.5 s and cost -41 to -42 % on trivial Haiku 5.5 calls, n=5 per
// cell, under heavy VM load). Neither variable changes the decoding (temperature, max tokens, effort, thinking budget), so neither is in
// the replay key: the first drops the CLI's non-essential startup work (updates, telemetry, feature-flag fetches), the second makes the
// CLI write its prompt cache at the 5-minute price instead of the 1-hour one. The first also changes what the CLI loads (its builtin
// telemetry plugin is absent from the init event) and the prompt it builds is about 165 tokens shorter (init-probe.json; the cause was
// not isolated and the text was not inspected). A CLI version change moves that boilerplate too: the journal records the engine version
// and, per call, the closed-list variables the child saw (providerRequest.env, childEnvRecord below). Both flags change the reported cost,
// so cost per success before and after this default is not comparable (synthesis rule R3).
export const DEFAULT_CHILD_ENV = Object.freeze({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', FORCE_PROMPT_CACHING_5M: '1' });

/** The child process environment: the caller's, minus credentials and the parent session's identity; then the `childEnv` block
 *  ("0"/"1" sets, null removes, so a policy value always wins over an inherited one); then the per-call thinking budget. */
export function claudeChildEnv(env = process.env, childEnv = DEFAULT_CHILD_ENV, thinkingTokens) {
  const out = claudeEnv(env);
  for (const [name, value] of Object.entries(childEnv)) { if (value === null) delete out[name]; else out[name] = value; }
  if (thinkingTokens !== undefined) out.MAX_THINKING_TOKENS = String(thinkingTokens);
  return out;
}

/** The journal's record of the child environment (providerRequest.env): every closed-list variable that the block names or that the
 *  child inherits, with the value the child sees (null: absent). The record is the child's state, not the configuration: a variable the
 *  block leaves alone passes through from the caller and is recorded verbatim (the CLI reads some of these by presence, so "0" can mean
 *  set; see CHILD_ENV_ALLOWED). Only these names are recorded; the rest of the environment is never logged. */
export function childEnvRecord(childProcessEnv, block = {}) {
  const out = {};
  for (const name of CHILD_ENV_ALLOWED) if (Object.hasOwn(block, name) || Object.hasOwn(childProcessEnv, name)) out[name] = childProcessEnv[name] ?? null;
  // An inherited cache-tier variable can override the cache flag, so it is on the record too (present only; values are tier settings).
  for (const name of Object.keys(childProcessEnv).filter(n => CACHE_TIER_ENV.test(n)).sort()) out[name] = childProcessEnv[name];
  return out;
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
    if (result.subtype === 'error_max_budget_usd') throw fail('MODEL_BUDGET', 'claude CLI hit the per-call --max-budget-usd cap', extra);
    // The CLI's own text carries what the user needs (a usage limit's reset time, a retry-after): it is kept, cut short (orch-20261021 D3).
    if (status === 429 || status === 529 || RATE.test(`${result.result ?? ''} ${stderr}`)) throw fail('MODEL_RATE_LIMIT', `claude CLI rate limited or overloaded: ${detail}${result.result ? `: ${String(result.result).slice(0, 200)}` : ''}`, extra);
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
  // childEnv: replaces the policy's `childEnv` block (an A/B measurement can pass nulls to switch the flags off); absent (undefined), the
  // policy block applies, and absent there the DEFAULT_CHILD_ENV. An explicit null is not "absent": it is refused like any non-object.
  constructor({ policy, providerName = 'claude-cli', binary, maxBudgetUsd = 1, timeoutMs = 300000, env = process.env, maxOutputBytes = 8 * 1024 * 1024, childEnv } = {}) {
    const config = policy?.providers?.[providerName];
    if (!config || config.kind !== 'claude-cli') throw new FoundryError('MODEL_POLICY_INVALID', `Policy has no claude-cli provider named ${providerName}`);
    if (config.invocation.some(a => a === '--fallback-model' || a.startsWith('--fallback-model='))) throw new FoundryError('MODEL_POLICY_INVALID', '--fallback-model is never passed');
    if (typeof maxBudgetUsd !== 'number' || !(maxBudgetUsd > 0 && maxBudgetUsd <= 25)) throw new FoundryError('MODEL_REQUEST', 'maxBudgetUsd must be in (0, 25]');
    // Only an absent block means "the default": an explicit null in a policy object that bypassed validatePolicy is refused, not defaulted.
    const block = childEnv === undefined ? validateChildEnv(config.childEnv === undefined ? DEFAULT_CHILD_ENV : config.childEnv, `provider ${providerName} childEnv`) : validateChildEnv(childEnv, 'childEnv');
    Object.assign(this, { policy, providerName, binary: binary ?? config.binary, invocation: [...config.invocation], maxBudgetUsd, timeoutMs, env, maxOutputBytes, childEnv: Object.freeze({ ...block }) });
  }

  async engineVersion() {
    if (!versions.has(this.binary)) {
      // Same child environment as a call (minus the thinking budget), so the probe does no non-essential startup traffic either.
      const probe = runProcess(this.binary, ['--version'], { env: claudeChildEnv(this.env, this.childEnv), timeoutMs: 30000, maxBytes: 64 * 1024 })
        .then(r => `claude-code ${r.stdout.trim().split(/\s+/)[0]}`);
      versions.set(this.binary, probe);
      probe.catch(() => versions.delete(this.binary));
    }
    return versions.get(this.binary);
  }

  effectiveDecoding(decoding) { return claudeCliDecoding(decoding); }

  args({ modelEntry, system, schema, decoding = {} }) {
    const args = [...this.invocation, '--model', modelEntry.id, '--system-prompt', system, '--json-schema', JSON.stringify(schema),
      '--effort', claudeCliDecoding(decoding).effort, '--max-budget-usd', String(this.maxBudgetUsd)];
    if (args.some(a => a === '--fallback-model')) throw new FoundryError('MODEL_POLICY_INVALID', '--fallback-model is never passed');
    return args;
  }

  async complete({ modelEntry, system, prompt, schema, decoding = {}, signal, timeoutMs = this.timeoutMs }) {
    if (!modelEntry || !isPolicyModel(this.policy, modelEntry.id) || modelEntry.provider !== this.providerName) throw new FoundryError('MODEL_NOT_IN_POLICY', `Model ${modelEntry?.id} is not a ${this.providerName} model in the policy`);
    let engineVersion;
    try { engineVersion = await untilAborted(this.engineVersion(), signal); }
    catch (error) {
      // A cancellation (or the port's deadline) while the shared version probe runs ends this call at once; no call was launched, so no spend.
      if (error.code === 'CANCELLED') throw error;
      throw fail('MODEL_UNAVAILABLE', `claude CLI version probe failed: ${error.code ?? error.message}`);
    }
    const args = this.args({ modelEntry, system, schema, decoding }), applied = claudeCliDecoding(decoding);
    const childProcessEnv = claudeChildEnv(this.env, this.childEnv, applied.thinkingTokens);
    const request = { binary: path.basename(this.binary), args: args.map(a => a === system ? '<system>' : a), temperature: applied.temperature,
      maxTokens: applied.maxTokens, effort: applied.effort, thinkingTokens: applied.thinkingTokens, maxBudgetUsd: this.maxBudgetUsd,
      env: childEnvRecord(childProcessEnv, this.childEnv) };
    const cwd = mkdtempSync(path.join(tmpdir(), 'foundry-claude-'));
    let processResult, launchError;
    try {
      processResult = await runProcess(this.binary, args, { cwd, env: childProcessEnv, input: prompt, timeoutMs: Math.min(timeoutMs, 3600000), signal, maxBytes: this.maxOutputBytes });
    } catch (error) {
      launchError = error; processResult = error.processResult;
    } finally { rmSync(cwd, { recursive: true, force: true }); }
    const stderr = processResult?.stderr?.slice(-4000) ?? '';
    // A CLI that ran but returned no result object (killed on timeout or cancellation, over its output budget, crashed)
    // may already have been billed: its spend is unknown, never an exact $0. The per-call cap bounds it (DESIGN §2).
    const unknownSpend = processResult && launchError?.code !== 'PROCESS_LAUNCH' ? { costUnknown: true, costCapUsd: this.maxBudgetUsd } : {};
    if (launchError && launchError.code !== 'PROCESS_FAILED') {
      const code = launchError.code === 'PROCESS_TIMEOUT' ? 'MODEL_TIMEOUT' : launchError.code === 'CANCELLED' ? 'CANCELLED'
        : launchError.code === 'PROCESS_LAUNCH' ? 'MODEL_UNAVAILABLE' : 'MODEL_PROTOCOL';
      throw fail(code, `claude CLI ${launchError.message}`, { engineVersion, request, ...unknownSpend });
    }
    let parsed;
    try { parsed = JSON.parse(processResult.stdout); }
    catch {
      const code = RATE.test(stderr) ? 'MODEL_RATE_LIMIT' : 'MODEL_PROTOCOL';
      throw fail(code, `claude CLI exited ${processResult.code ?? processResult.signal} without a JSON result${stderr ? `: ${stderr.trim().split('\n').at(-1).slice(0, 300)}` : ''}`, { engineVersion, request, ...unknownSpend });
    }
    try { return { ...interpretResult(parsed, { modelId: modelEntry.id, stderr }), engineVersion, request }; }
    catch (error) { error.engineVersion = engineVersion; error.request = request; throw error; }
  }
}
