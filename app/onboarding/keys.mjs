// Bring your own AI key (decision D11; SPEC §9.13, §15.4-6). The key goes to the OS keychain or nowhere; Foundry keeps only a
// reference: the provider, the last four characters, the backend and when it was checked (<workspace>/keys.json, no secret).
// The API never returns a key; logs and journals never contain one (the canary test checks every response).
//
// Checking a key sends ONE request, only when the person clicks "Check and save": GET <provider base URL>/models with the key, to the
// base URL in the owner policy (policy/models.json, the Inception provider entry). Tests may point it at http://127.0.0.1:* only.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { FoundryError } from '../../src/data.mjs';
import { loadPolicy } from '../../src/models/policy.mjs';
import { KEY_SHAPE } from './keychain.mjs';

export const PROVIDERS = Object.freeze({
  inception: { label: 'Inception (Mercury 3)', policyProvider: 'inception', model: 'mercury-3', status: 'Preview' },
  anthropic: { label: 'Anthropic (Haiku 5.5)', status: 'Planned', decision: 'O-A' },
  openrouter: { label: 'OpenRouter', status: 'Planned', decision: 'O-A' }
});

export function providerBaseUrl(provider, { override = null } = {}) {
  if (override) {
    const u = new URL(override);
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1') throw new FoundryError('KEY_CHECK_URL', 'A test override must be http://127.0.0.1:<port>');
    return override.replace(/\/$/, '');
  }
  const { policy } = loadPolicy();
  const entry = policy.providers?.[PROVIDERS[provider]?.policyProvider];
  if (!entry?.baseUrl) throw new FoundryError('KEY_PROVIDER', `The owner policy has no base URL for ${provider}`);
  return entry.baseUrl.replace(/\/$/, '');
}

export class Keys {
  constructor({ root, keychain, checkBaseUrl = null, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
    Object.assign(this, { root, keychain, checkBaseUrl, fetchImpl, now });
    this.file = path.join(root, 'keys.json');
  }
  #meta() { if (!existsSync(this.file)) return {}; try { return JSON.parse(readFileSync(this.file, 'utf8')) ?? {}; } catch { return {}; } }
  #saveMeta(m) { const tmp = `${this.file}.tmp-${process.pid}`; writeFileSync(tmp, JSON.stringify(m, null, 2), { mode: 0o600 }); renameSync(tmp, this.file); }
  /** What the page may know: per provider, saved or not, the last four characters, the backend. Never the key. */
  status() {
    const meta = this.#meta();
    return { backend: this.keychain.backend, keychainAvailable: this.keychain.available,
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({ provider: id, label: p.label, status: p.status, saved: !!meta[id], last4: meta[id]?.last4 ?? null, checkedAt: meta[id]?.checkedAt ?? null })) };
  }
  async check(provider, key) {
    const base = providerBaseUrl(provider, { override: this.checkBaseUrl });
    let res;
    try { res = await this.fetchImpl(`${base}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) }); }
    catch { throw new FoundryError('KEY_CHECK_NETWORK', 'Foundry could not reach the provider to check the key. Nothing was saved.'); }
    if (res.status === 401 || res.status === 403) throw new FoundryError('KEY_REJECTED', 'The provider did not accept this key. Nothing was saved.');
    if (!res.ok) throw new FoundryError('KEY_CHECK_FAILED', `The provider answered ${res.status}. Nothing was saved.`);
    return true;
  }
  /** Check, then store in the keychain. The key is not kept in this process after the call returns. */
  async save(provider, key) {
    if (!PROVIDERS[provider]) throw new FoundryError('KEY_PROVIDER', 'Unknown provider');
    if (PROVIDERS[provider].status === 'Planned') throw new FoundryError('KEY_PLANNED', `${PROVIDERS[provider].label} keys are planned, not available yet`);
    if (typeof key !== 'string' || !KEY_SHAPE.test(key.trim())) throw new FoundryError('KEY_SHAPE', 'That does not look like an API key (16 to 256 letters, digits, dashes, dots or underscores). Nothing was saved.');
    const k = key.trim();
    if (!this.keychain.available) throw new FoundryError('KEYCHAIN_NONE', 'This computer has no keychain Foundry can use, so your key was not saved.');
    await this.check(provider, k);
    this.keychain.set(provider, k);
    const meta = this.#meta();
    meta[provider] = { last4: k.slice(-4), checkedAt: new Date(this.now()).toISOString(), backend: this.keychain.backend };
    this.#saveMeta(meta);
    return { provider, saved: true, last4: meta[provider].last4, backend: this.keychain.backend, checkedAt: meta[provider].checkedAt };
  }
  remove(provider) {
    if (!PROVIDERS[provider]) throw new FoundryError('KEY_PROVIDER', 'Unknown provider');
    this.keychain.remove(provider);
    const meta = this.#meta(); delete meta[provider]; this.#saveMeta(meta);
    return { provider, saved: false };
  }
}
