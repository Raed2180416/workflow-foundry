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

export function validatePolicy(policy) {
  try { checkData(policy, { maxBytes: 1024 * 1024 }); } catch (error) { invalid(error.message); }
  if (!isObject(policy)) invalid('must be a JSON object');
  if (!nonEmpty(policy.policyVersion)) invalid('policyVersion is required');
  const order = policy.classOrder;
  if (!Array.isArray(order) || !order.length || order.some(c => !nonEmpty(c)) || new Set(order).size !== order.length) invalid('classOrder must be a non-empty list of distinct class names');
  if (!isObject(policy.providers) || !Object.keys(policy.providers).length) invalid('providers must be a non-empty object');
  for (const [name, p] of Object.entries(policy.providers)) {
    if (!ID.test(name) || !isObject(p) || !nonEmpty(p.kind)) invalid(`provider ${name} needs a kind`);
    if (p.imputedComputeUsdPerHour !== undefined && !money(p.imputedComputeUsdPerHour)) invalid(`provider ${name} imputedComputeUsdPerHour must be a non-negative number`);
    if (p.kind === 'claude-cli') {
      if (!nonEmpty(p.binary) || !Array.isArray(p.invocation) || p.invocation.some(a => typeof a !== 'string')) invalid(`provider ${name} needs binary and a string invocation list`);
      if (p.invocation.some(a => a === '--fallback-model' || a.startsWith('--fallback-model='))) invalid(`provider ${name} may not configure --fallback-model (no silent fallback)`);
      if (p.invocation.some(a => a === '--model' || a.startsWith('--model='))) invalid(`provider ${name} invocation may not fix a model; ids come from models[]`);
    }
    if (p.kind === 'openai-compatible-http' && (!nonEmpty(p.baseUrlTemplate) || !p.baseUrlTemplate.includes('{port}'))) invalid(`provider ${name} needs a baseUrlTemplate with {port}`);
  }
  if (!Array.isArray(policy.models) || !policy.models.length) invalid('models must be a non-empty list');
  const ids = new Set(), ports = new Set();
  for (const m of policy.models) {
    if (!isObject(m) || typeof m.id !== 'string' || !ID.test(m.id)) invalid(`model id ${JSON.stringify(m?.id)} is not a valid id`);
    if (ids.has(m.id)) invalid(`duplicate model id ${m.id}`); ids.add(m.id);
    if (!order.includes(m.class)) invalid(`model ${m.id} has class ${m.class} outside classOrder`);
    if (!nonEmpty(m.family)) invalid(`model ${m.id} needs a family`);
    const provider = policy.providers[m.provider];
    if (!provider) invalid(`model ${m.id} names unknown provider ${m.provider}`);
    if (!isObject(m.price) || !money(m.price.inputPerMTok) || !money(m.price.outputPerMTok)) invalid(`model ${m.id} needs non-negative price.inputPerMTok/outputPerMTok`);
    if (provider.kind === 'openai-compatible-http') {
      if (!Number.isInteger(m.port) || m.port < 1024 || m.port > 65535) invalid(`model ${m.id} needs an unprivileged port`);
      if (ports.has(m.port)) invalid(`port ${m.port} is assigned to two models`); ports.add(m.port);
      if (!isObject(m.weights) || !nonEmpty(m.weights.file) || /[\\/]/.test(m.weights.file) || m.weights.file.startsWith('.')) invalid(`model ${m.id} needs weights.file (a bare file name)`);
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
