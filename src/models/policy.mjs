// Owner model policy (ROADMAP §2.3, DESIGN §2): the only source of model ids for the runtime.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FoundryError, checkData, digest } from '../data.mjs';

export const DEFAULT_POLICY_PATH = fileURLToPath(new URL('../../policy/models.json', import.meta.url));
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const invalid = message => { throw new FoundryError('MODEL_POLICY_INVALID', `Model policy: ${message}`); };
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = v => typeof v === 'string' && v.trim().length > 0;
const money = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const freeze = v => { if (v && typeof v === 'object') { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } return v; };
// The TypeSafe System One wire format (src/judgment.mjs SystemOneClient), served by Jev and by a local Kev.
export const JUDGMENT_KIND = 'systemone-http';
const HTTPS_URL = /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/;
const LOOPBACK_URL = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?(\/[^\s?#]*)?$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const SECRET_FIELD = /^(api[-_]?key|key|token|secret|password|bearer|authorization)$/i;

// Remote OpenAI-compatible chat endpoints (POST <baseUrl>/chat/completions over HTTPS; research/mercury-20261021/), served
// only as executor sessions: src/executors/openai-chat.mjs runs the tool-calling loop on the host and every tool inside the
// executor sandbox. Their models are listed under executorModels, apart from models[], as judgmentModels are: ModelPort has
// no provider for this kind, so class resolution and escalation never route a typed node to one (modelById reads models[]
// only). The provider names its credential variable (credentialEnv), never a value, and carries no other field than these.
// 2026-10-21.2: ModelPort serves an executor model too, when a call names its id (portModelById below; never by class), through
// src/models/providers/openai-chat.mjs (one structured-output request, no tools, per-call and per-run token caps).
export const REMOTE_CHAT_KIND = 'openai-chat-https';
const REMOTE_CHAT_PROVIDER_KEYS = Object.freeze(['kind', 'baseUrl', 'credentialEnv', 'requestDefaults', 'auth', 'docs', 'knownGaps', 'features']);
/** Request fields a remote-chat provider may fix for every call (sent as is; nothing else is configurable). */
export const REQUEST_DEFAULT_KEYS = Object.freeze(['temperature', 'max_tokens']);
const EXECUTOR_MODEL_KEYS = Object.freeze(['id', 'class', 'family', 'provider', 'price', 'contextTokens', 'maxOutputTokens', 'note']);
const EXECUTOR_PRICE_KEYS = Object.freeze(['inputPerMTok', 'outputPerMTok', 'cacheReadPerMTok', 'source']);
// Defence in depth beside the field-name check: a long unbroken run of key-like characters mixing letters and digits is
// refused anywhere in a remote-chat provider entry (an API key pasted into a description, say). Prose, URLs and variable
// names do not match.
const KEY_LIKE = /[A-Za-z0-9_-]{32,}/;
const keyLike = s => typeof s === 'string' && (s.match(new RegExp(KEY_LIKE.source, 'g')) ?? []).some(run => /[0-9]/.test(run) && /[A-Za-z]/.test(run));
const strings = v => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : isObject(v) ? Object.values(v).flatMap(strings) : []);
function validateRemoteChatProvider(name, p) {
  const secretField = Object.keys(p).find(k => SECRET_FIELD.test(k));
  if (secretField) invalid(`provider ${name} may not carry a credential field (${secretField}); name the environment variable in credentialEnv`);
  const unknown = Object.keys(p).filter(k => !REMOTE_CHAT_PROVIDER_KEYS.includes(k));
  if (unknown.length) invalid(`provider ${name} (kind ${REMOTE_CHAT_KIND}) has unknown fields: ${unknown.join(', ')} (allowed: ${REMOTE_CHAT_PROVIDER_KEYS.join(', ')})`);
  if (!nonEmpty(p.baseUrl) || !HTTPS_URL.test(p.baseUrl)) invalid(`provider ${name} needs an https baseUrl (a remote endpoint; plain http is refused)`);
  if (typeof p.credentialEnv !== 'string' || !ENV_NAME.test(p.credentialEnv)) invalid(`provider ${name} credentialEnv must name an environment variable; a credential value never goes in the policy`);
  if (p.requestDefaults !== undefined) {
    const d = p.requestDefaults;
    if (!isObject(d)) invalid(`provider ${name} requestDefaults must be an object`);
    const extra = Object.keys(d).filter(k => !REQUEST_DEFAULT_KEYS.includes(k));
    if (extra.length) invalid(`provider ${name} requestDefaults has unknown fields: ${extra.join(', ')} (allowed: ${REQUEST_DEFAULT_KEYS.join(', ')})`);
    if (d.temperature !== undefined && !(typeof d.temperature === 'number' && d.temperature >= 0 && d.temperature <= 2)) invalid(`provider ${name} requestDefaults.temperature must be a number 0..2`);
    if (d.max_tokens !== undefined && !(Number.isInteger(d.max_tokens) && d.max_tokens >= 1)) invalid(`provider ${name} requestDefaults.max_tokens must be a positive integer`);
  }
  if (p.features !== undefined && (!isObject(p.features) || Object.values(p.features).some(v => typeof v !== 'boolean'))) invalid(`provider ${name} features must map names to booleans`);
  if (p.knownGaps !== undefined && (!Array.isArray(p.knownGaps) || p.knownGaps.some(g => !nonEmpty(g)))) invalid(`provider ${name} knownGaps must be a list of strings`);
  for (const k of ['auth', 'docs']) if (p[k] !== undefined && !nonEmpty(p[k])) invalid(`provider ${name} ${k} must be a non-empty string`);
  if (strings(p).some(keyLike)) invalid(`provider ${name} holds a key-like value; a credential value never goes in the policy (name its variable in credentialEnv)`);
}

// Environment variables a claude-cli provider config may set in (or remove from, with null) the child process. A closed list:
// an environment variable can change what the CLI sends (model, thinking budget, base URL, caching), and a variable that changes
// the decoding would have to enter the replay key. Everything here is transport, telemetry or cache-pricing tuning; none changes
// the decoding (research/review-20261007/04-efficiency-rust.md §2.4; CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC also shortens the prompt the
// CLI builds by about 165 tokens, see research/review-20261007/cli-flags-20261008/). A value is "1" (set) or null (removed from the child).
// "0" is rejected: the CLI tests some of these variables for presence, so "0" does not reliably mean off (measured 2026-10-08:
// CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=0 behaves exactly as =1, FORCE_PROMPT_CACHING_5M=0 as absent; cli-flags-20261008/zero-probe.json).
// DISABLE_UPDATES (compromise C2, 2026-10-21): with DISABLE_AUTOUPDATER, keeps a CLI from replacing itself under a run (incident I3); the
// pin by bytes is src/cli-pin.mjs. Neither changes the decoding.
export const CHILD_ENV_ALLOWED = Object.freeze(['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'FORCE_PROMPT_CACHING_5M', 'DISABLE_TELEMETRY', 'DISABLE_ERROR_REPORTING', 'DISABLE_AUTOUPDATER', 'DISABLE_UPDATES']);
/** Check a childEnv block ({ NAME: "1" | null }); `where` names it in the error. Returns the block. */
export function validateChildEnv(childEnv, where = 'childEnv') {
  // A plain object only: a Map or class instance has no enumerable entries and would pass as an empty block.
  if (!isObject(childEnv) || ![Object.prototype, null].includes(Object.getPrototypeOf(childEnv))) invalid(`${where} must be a plain object of environment variables`);
  for (const [name, value] of Object.entries(childEnv)) {
    if (!CHILD_ENV_ALLOWED.includes(name)) invalid(`${where} may not set ${JSON.stringify(name)}; allowed: ${CHILD_ENV_ALLOWED.join(', ')}`);
    if (value !== null && value !== '1') invalid(`${where}.${name} must be "1" (set) or null (removed); "0" is not "off" for every variable here, so use null`);
  }
  return childEnv;
}

// executorOnly: a session subset that lists executor models alone (experiments/lib/models.mjs subsetPolicy); only then may models[] be empty.
export function validatePolicy(policy, { executorOnly = false } = {}) {
  try { checkData(policy, { maxBytes: 1024 * 1024 }); } catch (error) { invalid(error.message); }
  if (!isObject(policy)) invalid('must be a JSON object');
  if (!nonEmpty(policy.policyVersion)) invalid('policyVersion is required');
  const order = policy.classOrder;
  if (!Array.isArray(order) || !order.length || order.some(c => !nonEmpty(c)) || new Set(order).size !== order.length) invalid('classOrder must be a non-empty list of distinct class names');
  if (!isObject(policy.providers) || !Object.keys(policy.providers).length) invalid('providers must be a non-empty object');
  for (const [name, p] of Object.entries(policy.providers)) {
    if (!ID.test(name) || !isObject(p) || !nonEmpty(p.kind)) invalid(`provider ${name} needs a kind`);
    if (p.imputedComputeUsdPerHour !== undefined && !money(p.imputedComputeUsdPerHour)) invalid(`provider ${name} imputedComputeUsdPerHour must be a non-negative number`);
    // Only the claude-cli provider reads childEnv. Elsewhere the block would be inert and still kept out of the replay key, so it is refused.
    if (p.childEnv !== undefined && p.kind !== 'claude-cli') invalid(`provider ${name} (kind ${p.kind}) does not support childEnv`);
    if (p.kind === 'claude-cli') {
      if (!nonEmpty(p.binary) || !Array.isArray(p.invocation) || p.invocation.some(a => typeof a !== 'string')) invalid(`provider ${name} needs binary and a string invocation list`);
      if (p.invocation.some(a => a === '--fallback-model' || a.startsWith('--fallback-model='))) invalid(`provider ${name} may not configure --fallback-model (no silent fallback)`);
      if (p.invocation.some(a => a === '--model' || a.startsWith('--model='))) invalid(`provider ${name} invocation may not fix a model; ids come from models[]`);
      if (p.childEnv !== undefined) validateChildEnv(p.childEnv, `provider ${name} childEnv`);
    }
    if (p.kind === 'openai-compatible-http' && (!nonEmpty(p.baseUrlTemplate) || !p.baseUrlTemplate.includes('{port}'))) invalid(`provider ${name} needs a baseUrlTemplate with {port}`);
    if (p.kind === JUDGMENT_KIND) {
      if (!nonEmpty(p.baseUrl) || !(HTTPS_URL.test(p.baseUrl) || LOOPBACK_URL.test(p.baseUrl))) invalid(`provider ${name} needs an https baseUrl (plain http only on loopback)`);
      if (p.credentialEnv !== null && (typeof p.credentialEnv !== 'string' || !ENV_NAME.test(p.credentialEnv))) invalid(`provider ${name} credentialEnv must name an environment variable (or be null); a credential value never goes in the policy`);
      const secretField = Object.keys(p).find(k => SECRET_FIELD.test(k));
      if (secretField) invalid(`provider ${name} may not carry a credential field (${secretField}); name the environment variable in credentialEnv`);
    }
    if (p.kind === REMOTE_CHAT_KIND) validateRemoteChatProvider(name, p);
  }
  // models[] may be empty only in an executor-only session subset (executorOnly, with a non-empty executorModels[]: a Mercury-only stream,
  // research/mercury-20261021/PORT-PROBE.md finding 1). Class resolution (modelsForClass, nextClass, resolve) reads models[] only, so it
  // finds nothing and never reaches an executor model; every call must name its executor model (portModelById). The owner policy file and
  // the Runtime (agent nodes resolve models[] by class or id) still need a non-empty models[].
  const emptyAllowed = executorOnly === true && Array.isArray(policy.models) && Array.isArray(policy.executorModels) && policy.executorModels.length > 0;
  if (!Array.isArray(policy.models) || (!policy.models.length && !emptyAllowed)) invalid('models must be a non-empty list (it may be empty only in an executor-only session subset)');
  const ids = new Set(), ports = new Set();
  for (const m of policy.models) {
    if (!isObject(m) || typeof m.id !== 'string' || !ID.test(m.id)) invalid(`model id ${JSON.stringify(m?.id)} is not a valid id`);
    if (ids.has(m.id)) invalid(`duplicate model id ${m.id}`); ids.add(m.id);
    if (!order.includes(m.class)) invalid(`model ${m.id} has class ${m.class} outside classOrder`);
    if (!nonEmpty(m.family)) invalid(`model ${m.id} needs a family`);
    const provider = policy.providers[m.provider];
    if (!provider) invalid(`model ${m.id} names unknown provider ${m.provider}`);
    if (provider.kind === JUDGMENT_KIND) invalid(`model ${m.id}: provider ${m.provider} serves typed judgments only; list it under judgmentModels`);
    if (provider.kind === REMOTE_CHAT_KIND) invalid(`model ${m.id}: provider ${m.provider} serves executor sessions only; list it under executorModels`);
    if (!isObject(m.price) || !money(m.price.inputPerMTok) || !money(m.price.outputPerMTok)) invalid(`model ${m.id} needs non-negative price.inputPerMTok/outputPerMTok`);
    if (provider.kind === 'openai-compatible-http') {
      if (!Number.isInteger(m.port) || m.port < 1024 || m.port > 65535) invalid(`model ${m.id} needs an unprivileged port`);
      if (ports.has(m.port)) invalid(`port ${m.port} is assigned to two models`); ports.add(m.port);
      if (!isObject(m.weights) || !nonEmpty(m.weights.file) || /[\\/]/.test(m.weights.file) || m.weights.file.startsWith('.')) invalid(`model ${m.id} needs weights.file (a bare file name)`);
    }
  }
  // Judgment models (System One: typed questions in, a probability per option out). Kept apart from models[] so ModelPort,
  // class resolution and escalation never route a generative call to one (modelById reads models[] only).
  if (policy.judgmentModels !== undefined) {
    if (!Array.isArray(policy.judgmentModels)) invalid('judgmentModels must be a list');
    for (const m of policy.judgmentModels) {
      if (!isObject(m) || typeof m.id !== 'string' || !ID.test(m.id)) invalid(`judgment model id ${JSON.stringify(m?.id)} is not a valid id`);
      if (ids.has(m.id)) invalid(`duplicate model id ${m.id}`); ids.add(m.id);
      if (!nonEmpty(m.family)) invalid(`judgment model ${m.id} needs a family`);
      const provider = policy.providers[m.provider];
      if (!provider || provider.kind !== JUDGMENT_KIND) invalid(`judgment model ${m.id} needs a provider of kind ${JUDGMENT_KIND}`);
      const priceOk = v => v === null || money(v);
      if (!isObject(m.price) || !priceOk(m.price.inputPerMTok) || !priceOk(m.price.outputPerMTok) || !nonEmpty(m.price.source)) invalid(`judgment model ${m.id} needs price.inputPerMTok/outputPerMTok (non-negative, or null when unknown) and price.source`);
    }
  }
  // Executor models (a remote chat endpoint driven as a tool-using session; REMOTE_CHAT_KIND above). Kept apart from models[]
  // so ModelPort, class resolution and escalation never reach one; the class records the tier for reports only.
  if (policy.executorModels !== undefined) {
    if (!Array.isArray(policy.executorModels)) invalid('executorModels must be a list');
    for (const m of policy.executorModels) {
      if (!isObject(m) || typeof m.id !== 'string' || !ID.test(m.id)) invalid(`executor model id ${JSON.stringify(m?.id)} is not a valid id`);
      const unknown = Object.keys(m).filter(k => !EXECUTOR_MODEL_KEYS.includes(k));
      if (unknown.length) invalid(`executor model ${m.id} has unknown fields: ${unknown.join(', ')} (allowed: ${EXECUTOR_MODEL_KEYS.join(', ')})`);
      if (ids.has(m.id)) invalid(`duplicate model id ${m.id}`); ids.add(m.id);
      if (!order.includes(m.class)) invalid(`executor model ${m.id} has class ${m.class} outside classOrder`);
      if (!nonEmpty(m.family)) invalid(`executor model ${m.id} needs a family`);
      const provider = policy.providers[m.provider];
      if (!provider || provider.kind !== REMOTE_CHAT_KIND) invalid(`executor model ${m.id} needs a provider of kind ${REMOTE_CHAT_KIND}`);
      if (!isObject(m.price) || Object.keys(m.price).some(k => !EXECUTOR_PRICE_KEYS.includes(k)) || !money(m.price.inputPerMTok) || !money(m.price.outputPerMTok)
        || (m.price.cacheReadPerMTok !== undefined && !money(m.price.cacheReadPerMTok)) || !nonEmpty(m.price.source))
        invalid(`executor model ${m.id} needs price.inputPerMTok/outputPerMTok (non-negative), an optional non-negative cacheReadPerMTok and price.source, nothing else`);
      for (const k of ['contextTokens', 'maxOutputTokens']) if (m[k] !== undefined && !(Number.isInteger(m[k]) && m[k] > 0)) invalid(`executor model ${m.id} ${k} must be a positive integer`);
      if (m.note !== undefined && !nonEmpty(m.note)) invalid(`executor model ${m.id} note must be a non-empty string`);
    }
  }
  const esc = policy.escalation;
  if (esc !== undefined) {
    if (!isObject(esc)) invalid('escalation must be an object');
    if (esc.maxEscalationsPerNode !== undefined && (!Number.isInteger(esc.maxEscalationsPerNode) || esc.maxEscalationsPerNode < 0 || esc.maxEscalationsPerNode > 2)) invalid('escalation.maxEscalationsPerNode must be 0..2 (E7)');
    if (esc.schemaRetriesBeforeEscalation !== undefined && (!Number.isInteger(esc.schemaRetriesBeforeEscalation) || esc.schemaRetriesBeforeEscalation < 0 || esc.schemaRetriesBeforeEscalation > 3)) invalid('escalation.schemaRetriesBeforeEscalation must be 0..3');
  }
  if (policy.inputBudgetTokensByClass !== undefined && (!isObject(policy.inputBudgetTokensByClass) || Object.values(policy.inputBudgetTokensByClass).some(n => !Number.isInteger(n) || n < 1)))
    invalid('inputBudgetTokensByClass values must be positive integers');
  return policy;
}

export function loadPolicy(file = DEFAULT_POLICY_PATH) {
  let policy;
  try { policy = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { throw new FoundryError('MODEL_POLICY_INVALID', `Model policy ${file} is unreadable: ${error.code ?? error.message}`); }
  validatePolicy(policy);
  return { policy: freeze(policy), hash: digest(policy), path: String(file) };
}

export const policyHash = policy => digest(policy);
export function assertPolicyUnchanged(recordedHash, current) {
  const hash = typeof current === 'string' ? current : current?.hash ?? digest(current?.policy ?? current);
  if (recordedHash !== hash) throw new FoundryError('MODEL_POLICY_DRIFT', 'The model policy changed since this run was created; resume is blocked', { recordedHash, currentHash: hash });
  return hash;
}

export function modelById(policy, id) {
  const entry = typeof id === 'string' ? policy.models.find(m => m.id === id) : undefined;
  if (!entry) throw new FoundryError('MODEL_NOT_IN_POLICY', `Model ${JSON.stringify(id)} is not listed in the model policy`, { modelId: id ?? null, policyVersion: policy.policyVersion });
  return entry;
}
export const isPolicyModel = (policy, id) => policy.models.some(m => m.id === id);
/** A judgment model (judgmentModels[]) with its provider config; refuses an id the policy does not list. */
export function judgmentModelById(policy, id) {
  const entry = typeof id === 'string' ? (policy.judgmentModels ?? []).find(m => m.id === id) : undefined;
  if (!entry) throw new FoundryError('MODEL_NOT_IN_POLICY', `Judgment model ${JSON.stringify(id)} is not listed in the model policy`, { modelId: id ?? null, policyVersion: policy.policyVersion });
  return { entry, provider: providerConfig(policy, entry) };
}

/** An executor model (executorModels[]) with its provider config; refuses an id the policy does not list there. */
export function executorModelById(policy, id) {
  const entry = typeof id === 'string' ? (policy.executorModels ?? []).find(m => m.id === id) : undefined;
  if (!entry) throw new FoundryError('MODEL_NOT_IN_POLICY', `Executor model ${JSON.stringify(id)} is not listed in the model policy`, { modelId: id ?? null, policyVersion: policy.policyVersion });
  return { entry, provider: providerConfig(policy, entry) };
}
/** The model of an executor session: an executorModels entry (kind REMOTE_CHAT_KIND) or a models[] entry (its provider's
 * kind, e.g. claude-cli). Refuses an id the policy lists in neither. */
export function sessionModelById(policy, id) {
  if (typeof id === 'string' && (policy.executorModels ?? []).some(m => m.id === id)) return { ...executorModelById(policy, id), kind: REMOTE_CHAT_KIND };
  const entry = modelById(policy, id), provider = providerConfig(policy, entry);
  return { entry, provider, kind: provider.kind };
}

/**
 * The model a ModelPort call names (2026-10-21.2, research/mercury-20261021/): a models[] entry, or an executorModels entry
 * when the caller names its id. Explicit only: class resolution (resolve by class, modelsForClass, nextClass), escalation
 * targets and the verifier-independence check read models[] alone, so no node is ever moved to an executor model by class,
 * and a call that names one is served by that model or fails (no fallback: an unregistered provider is
 * MODEL_PROVIDER_MISSING, a different served model MODEL_PROTOCOL). Workflow IR nodes still resolve their model.id through
 * modelById (models[] only): an IR node naming an executor model is refused until escalation from one is decided.
 */
export function portModelById(policy, id) {
  const exec = typeof id === 'string' ? (policy.executorModels ?? []).find(m => m.id === id) : undefined;
  return exec ?? modelById(policy, id);
}

export function classIndex(policy, cls) {
  const index = policy.classOrder.indexOf(cls);
  if (index < 0) throw new FoundryError('MODEL_CLASS_UNKNOWN', `Model class ${JSON.stringify(cls)} is not in the policy classOrder`);
  return index;
}

export function modelsForClass(policy, cls, { excludeFamily } = {}) {
  classIndex(policy, cls);
  const excluded = new Set(excludeFamily == null ? [] : typeof excludeFamily === 'string' ? [excludeFamily] : [...excludeFamily]);
  return policy.models.filter(m => m.class === cls && !excluded.has(m.family));
}

/** The next class up the order that has at least one model, or null at the top. */
export function nextClass(policy, cls) {
  for (let i = classIndex(policy, cls) + 1; i < policy.classOrder.length; i++)
    if (policy.models.some(m => m.class === policy.classOrder[i])) return policy.classOrder[i];
  return null;
}

export function resolve(policy, { class: cls, id } = {}) {
  if (id !== undefined && id !== null) {
    const entry = modelById(policy, id);
    if (cls !== undefined && cls !== null && entry.class !== cls) throw new FoundryError('MODEL_CLASS_MISMATCH', `Model ${id} is class ${entry.class}, not ${cls}`);
    return entry;
  }
  if (cls === undefined || cls === null) throw new FoundryError('MODEL_REQUEST', 'A model class or a policy model id is required');
  const [first] = modelsForClass(policy, cls);
  if (!first) throw new FoundryError('MODEL_CLASS_EMPTY', `The policy lists no model for class ${cls}`);
  return first;
}

export function providerConfig(policy, entry) {
  const config = policy.providers[entry.provider];
  if (!config) throw new FoundryError('MODEL_POLICY_INVALID', `Provider ${entry.provider} is not configured in the policy`);
  return config;
}
