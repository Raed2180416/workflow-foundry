// Start the site in-process over a temp workspace for API and security tests ($0, loopback only).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import { createSite, siteApp } from '../server.mjs';
import { Keychain } from '../../onboarding/keychain.mjs';

export const NOW = Date.parse('2026-10-21T09:00:00Z');
export async function startSite(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'site-test-'));
  const app = await siteApp({ workspace: dir });
  const logs = [];
  const site = createSite(app, { workspace: dir, now: () => NOW, keychain: options.keychain ?? new Keychain({ backend: 'ephemeral' }), log: l => logs.push(l), ...options });
  const { port, url } = await site.listen(0);
  const base = `http://127.0.0.1:${port}`, headers = { 'x-foundry-token': site.token };
  const bodies = [];
  const keep = async res => { const text = await res.text(); bodies.push(text); let json = null; try { json = JSON.parse(text); } catch { /* text */ } return { status: res.status, headers: res.headers, text, json, ...(json && typeof json === 'object' && !Array.isArray(json) ? json : {}) }; };
  const get = p => fetch(base + p, { headers }).then(keep);
  const post = (p, body, extra = {}) => fetch(base + p, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) }).then(keep);
  const del = p => fetch(base + p, { method: 'DELETE', headers }).then(keep);
  const raw = (p, hdrs) => new Promise((resolve, reject) => request({ host: '127.0.0.1', port, path: p, headers: hdrs }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject).end());
  const close = async () => { await site.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); };
  return { dir, app, site, port, url, base, headers, get, post, del, raw, close, logs, bodies };
}
