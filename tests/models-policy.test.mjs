import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_POLICY_PATH, CHILD_ENV_ALLOWED, loadPolicy, validatePolicy, resolve, classIndex, nextClass, modelsForClass, assertPolicyUnchanged, modelById } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { Journal } from '../src/journal.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { policy, hash } = loadPolicy();
const mutable = () => structuredClone(policy);
const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };

test('the committed policy loads, validates, hashes stably and is frozen', () => {
  assert.equal(DEFAULT_POLICY_PATH, path.join(root, 'policy', 'models.json'));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(loadPolicy().hash, hash);
  assert.ok(Object.isFrozen(policy) && Object.isFrozen(policy.models[0]) && Object.isFrozen(policy.providers['claude-cli'].invocation));
  assert.deepEqual(policy.classOrder, ['S', 'M', 'L', 'F']);
  assert.ok(!policy.providers['claude-cli'].invocation.includes('--fallback-model'));
  assert.doesNotThrow(() => assertPolicyUnchanged(hash, loadPolicy()));
  const changed = mutable(); changed.policyVersion += '-x';
  assert.throws(() => assertPolicyUnchanged(hash, { policy: changed }), { code: 'MODEL_POLICY_DRIFT' });
});

test('policy validation rejects structural defects', () => {
  const cases = {
    'duplicate ids': p => p.models.push({ ...p.models[0] }),
    'class outside classOrder': p => { p.models[0].class = 'XL'; },
    'unknown provider': p => { p.models[0].provider = 'ollama'; },
    'local model without port': p => { delete p.models[0].port; },
    'shared port': p => { p.models[1].port = p.models[0].port; },
    'weights path traversal': p => { p.models[0].weights.file = '../etc/passwd'; },
    'negative price': p => { p.models[3].price.outputPerMTok = -1; },
    'fallback flag': p => { p.providers['claude-cli'].invocation.push('--fallback-model', 'x'); },
    'fixed model flag': p => { p.providers['claude-cli'].invocation.push('--model', 'x'); },
    'escalations above E7': p => { p.escalation.maxEscalationsPerNode = 3; },
    'duplicate classOrder': p => { p.classOrder.push('S'); },
    'missing version': p => { delete p.policyVersion; },
    'bad id characters': p => { p.models[0].id = 'qwen 2b'; },
    'baseUrl without port': p => { p.providers['llama-server'].baseUrlTemplate = 'http://127.0.0.1/v1'; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const p = mutable(); mutate(p);
    assert.throws(() => validatePolicy(p), { code: 'MODEL_POLICY_INVALID' }, name);
  }
  assert.doesNotThrow(() => validatePolicy(mutable()));
});

test('loadPolicy reports unreadable or invalid files as MODEL_POLICY_INVALID', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-policy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'bad.json'), '{ not json');
  assert.throws(() => loadPolicy(path.join(dir, 'bad.json')), { code: 'MODEL_POLICY_INVALID' });
  assert.throws(() => loadPolicy(path.join(dir, 'missing.json')), { code: 'MODEL_POLICY_INVALID' });
  const p = mutable(); p.models = [];
  writeFileSync(path.join(dir, 'empty.json'), JSON.stringify(p));
  assert.throws(() => loadPolicy(path.join(dir, 'empty.json')), { code: 'MODEL_POLICY_INVALID' });
});

test('resolve, classIndex, nextClass and modelsForClass follow the policy order', () => {
  assert.equal(resolve(policy, { id: 'claude-haiku-4-5-20251001' }).class, 'M');
  assert.equal(resolve(policy, { class: 'S' }).id, 'qwen3.5-2b-q4km', 'first model of the class in policy order');
  assert.equal(resolve(policy, { class: 'F' }).id, 'claude-opus-5-5');
  assert.equal(resolve(policy, { class: 'S', id: 'granite-4.2-3b-q4km' }).family, 'granite');
  assert.throws(() => resolve(policy, { class: 'M', id: 'qwen3.5-2b-q4km' }), { code: 'MODEL_CLASS_MISMATCH' });
  assert.throws(() => resolve(policy, { id: 'gpt-4o' }), { code: 'MODEL_NOT_IN_POLICY' });
  assert.throws(() => resolve(policy, { class: 'XL' }), { code: 'MODEL_CLASS_UNKNOWN' });
  assert.throws(() => resolve(policy, {}), { code: 'MODEL_REQUEST' });
  assert.deepEqual(policy.classOrder.map(c => classIndex(policy, c)), [0, 1, 2, 3]);
  assert.deepEqual(['S', 'M', 'L', 'F'].map(c => nextClass(policy, c)), ['M', 'L', 'F', null]);
  const sparse = mutable(); sparse.models = sparse.models.filter(m => m.class !== 'M');
  assert.equal(nextClass(sparse, 'S'), 'L', 'empty classes are skipped');
  assert.throws(() => resolve(sparse, { class: 'M' }), { code: 'MODEL_CLASS_EMPTY' });
  assert.deepEqual(modelsForClass(policy, 'S').map(m => m.id), ['qwen3.5-2b-q4km', 'granite-4.2-3b-q4km', 'qwen3.5-4b-q4km']);
  assert.deepEqual(modelsForClass(policy, 'S', { excludeFamily: 'qwen' }).map(m => m.id), ['granite-4.2-3b-q4km']);
  assert.deepEqual(modelsForClass(policy, 'L', { excludeFamily: ['claude'] }), []);
});

// ROADMAP §2.3: "The runtime uses no model id outside this file. A test proves it."
test('no model id outside this file: providers only ever see policy ids', async () => {
  const providers = { 'claude-cli': new ScriptedProvider(() => ({ value: { ok: true } })), 'llama-server': new ScriptedProvider(() => ({ value: { ok: true } })) };
  const port = new ModelPort({ policy, providers, journal: new Journal(new DatabaseSync(':memory:')) });
  const request = modelId => ({ runId: 'policy-proof', nodeKey: 'n', attempt: 1, modelId, system: 's', prompt: 'p', schema });
  for (const m of policy.models) assert.equal((await port.call(request(m.id))).ok, true);
  for (const outsider of ['gpt-4o', 'claude-3-opus-20240229', 'qwen3.5-9b:itb', 'claude-haiku-4-5', 'CLAUDE-OPUS-5-5', '', undefined, null])
    await assert.rejects(port.call(request(outsider)), { code: 'MODEL_NOT_IN_POLICY' }, String(outsider));
  const seen = [...providers['claude-cli'].calls, ...providers['llama-server'].calls].map(c => c.modelId);
  assert.equal(seen.length, policy.models.length);
  assert.deepEqual(new Set(seen), new Set(policy.models.map(m => m.id)));
  for (const call of providers['claude-cli'].calls) assert.equal(modelById(policy, call.modelId).provider, 'claude-cli');
  for (const call of providers['llama-server'].calls) assert.equal(modelById(policy, call.modelId).provider, 'llama-server');
});

test('no model id outside this file: runtime source names only policy ids', () => {
  // Legacy exemption: src/ollama-local.mjs is the pre-Phase-1 diagnostic Ollama adapter; it is not
  // reachable from ModelPort and is listed here so any new hard-coded id elsewhere fails this test.
  const legacy = new Map([['src/ollama-local.mjs', /^(qwen3\.5-9b:itb|qwen35(\.[a-z_]+)?)$/]]);
  // Provider names, the CLI binary, the executor label and the closed list of claude-cli child environment variable names
  // (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is an env var, not a model id) are not model ids.
  const allowed = new Set([...policy.models.map(m => m.id), ...Object.keys(policy.providers), ...Object.values(policy.providers).map(p => p.binary).filter(Boolean), 'claude-code', ...CHILD_ENV_ALLOWED]);
  const literal = /['"`]((?:claude|qwen|granite|gpt|llama|gemma|mistral|phi|deepseek|haiku|sonnet|opus)[A-Za-z0-9._:-]*)['"`]/gi;
  const files = [];
  const walk = dir => { for (const name of readdirSync(dir)) { const p = path.join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.mjs')) files.push(p); } };
  walk(path.join(root, 'src'));
  assert.ok(files.some(f => f.endsWith(path.join('models', 'port.mjs'))));
  const offenders = [];
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    for (const [, id] of readFileSync(file, 'utf8').matchAll(literal))
      if (!allowed.has(id) && !legacy.get(rel)?.test(id) && !/^(llama-server|llama\.cpp)$/.test(id)) offenders.push(`${rel}: ${id}`);
  }
  assert.deepEqual(offenders, []);
});
