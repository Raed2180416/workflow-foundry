// Security requirements of the site (SPEC §15), each a test. nice -n 15 node --test app/site/test/security.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSP } from '../../dashboard/server.mjs';
import { startSite } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const files = dir => readdirSync(dir).flatMap(f => statSync(path.join(dir, f)).isDirectory() ? files(path.join(dir, f)) : [path.join(dir, f)]);
const CANARY = 'CANARY-site-0000-1111-2222-abcd';

test('the page: same CSP as the dashboard, no inline script or style, no markup sinks, decisions only from a click (SPEC §15.1-2, R5)', async () => {
  const s = await startSite();
  try {
    const page = await fetch(`${s.base}/`);
    assert.equal(page.headers.get('content-security-policy'), CSP);
    assert.match(CSP, /script-src 'self'; style-src 'self'/); assert.match(CSP, /img-src 'none'/);
    const html = await page.text();
    assert.equal(/<script(?![^>]*\bsrc=)/i.test(html) || /\sstyle=/i.test(html) || /<style/i.test(html), false, 'no inline script or style in the shell');
    for (const f of files(PUBLIC).filter(f => f.endsWith('.js'))) {
      const src = readFileSync(f, 'utf8');
      assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(src), false, `${path.relative(PUBLIC, f)} uses a markup or code sink`);
      assert.equal(/\.style\.|setAttribute\(\s*'style'/.test(src), false, `${path.relative(PUBLIC, f)} sets inline styles`);
      if (!f.endsWith('site.js')) assert.equal(src.includes("'/api/decide'"), false, `${path.relative(PUBLIC, f)} must decide through site.js decide(), which demands a trusted click on a visible card`);
    }
    assert.match(readFileSync(path.join(PUBLIC, 'site.js'), 'utf8'), /event\.isTrusted !== true/);
    assert.equal(/https?:\/\/(?!127\.0\.0\.1)/.test(files(PUBLIC).filter(f => /\.(js|html|css)$/.test(f)).map(f => readFileSync(f, 'utf8')).join('\n').replace(/\/\/.*$/gm, '')), false, 'no external URL is loaded by the page');
  } finally { await s.close(); }
});

test('Host check, token, JSON only, size caps, no path traversal (SPEC §15.3)', async () => {
  const s = await startSite();
  try {
    assert.equal((await fetch(`${s.base}/api/templates`)).status, 401);
    assert.equal(await s.raw('/api/templates', { ...s.headers, host: `evil.example:${s.port}` }), 421);
    assert.equal(await s.raw('/', { host: `evil.example:${s.port}` }), 421);
    assert.equal((await s.post('/api/suggest', 'text=hi', { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal((await s.post('/api/suggest', { text: 'x'.repeat(20000) })).status, 413);
    const big = 'Invoice,Customer,Email,Due,Amount,Status\n' + 'A,B,b@x.example,2026-10-01,1,open\n'.repeat(3000);
    assert.equal((await s.post('/api/data/preview', { template: 'invoice-chase', sheet: 'invoices', csv: big })).status, 200, 'a dropped file may be larger');
    for (const p of ['/../server.mjs', '/views/../../api.mjs', '/%2e%2e/claims.json', '/views/home.mjs', '/claims.json', '/api.mjs']) assert.equal(await s.raw(p, { host: `127.0.0.1:${s.port}` }), 404, p);
    assert.equal((await fetch(`${s.base}/views/home.js`)).status, 200);
  } finally { await s.close(); }
});

test('canary key: stored through the page, then absent from every response, the workspace files and the logs (SPEC §15.4)', async () => {
  const provider = createServer((req, res) => { res.writeHead(req.headers.authorization === `Bearer ${CANARY}` ? 200 : 401, { 'content-type': 'application/json' }); res.end('{"data":[]}'); });
  await new Promise(r => provider.listen(0, '127.0.0.1', r));
  const s = await startSite({ keyCheckBaseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  try {
    // A key is checked (sent to the provider) only once Allowed AI includes it (honesty review M7).
    await s.post('/api/settings', { allowedAI: 'mercury' });
    const saved = await s.post('/api/keys', { provider: 'inception', key: CANARY });
    assert.equal(saved.last4, 'abcd');
    s.bodies.length = 0;
    const p = await s.post('/api/propose', { template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' } });
    await s.post('/api/practice', { proposalId: p.proposalId });
    const req = await s.post('/api/request-approval', { proposalId: p.proposalId });
    await s.post('/api/decide', { kind: 'activation', approvalId: req.approvalId, decision: 'approve' });
    for (const g of ['/api/keys', '/api/settings', '/api/doctor', '/api/connect', '/api/templates', '/api/automations', '/api/overview', '/api/batches', '/api/drafts', '/api/claims',
      `/api/brief/${p.flowId}.json`, `/api/brief/${p.flowId}.md`, `/api/brief/${p.flowId}.html`, '/api/org/map', `/api/automations/${p.flowId}`]) await s.get(g);
    assert.ok(s.bodies.length >= 18);
    assert.equal(s.bodies.some(b => b.includes(CANARY)), false, 'no response carries the key');
    const all = files(s.dir).filter(f => !f.includes('-wal') && !f.includes('-shm'));
    assert.equal(all.some(f => readFileSync(f).includes(CANARY)), false, 'no workspace file holds the key');
    assert.equal(JSON.stringify(s.logs).includes(CANARY), false);
    assert.equal((await s.del('/api/keys/inception')).saved, false);
  } finally { await s.close(); await new Promise(r => provider.close(r)); }
});

test('the same-user limit stays on the Trust page copy and in every IT brief (SPEC §15.11, §17.5)', async () => {
  const copy = JSON.parse(readFileSync(path.join(PUBLIC, 'copy', 'en.json'), 'utf8'));
  assert.match(copy.trust.limit.body, /A coding agent that can run commands as you on this computer could do what you can do, including approve/);
  assert.match(readFileSync(path.join(PUBLIC, 'views', 'trust.js'), 'utf8'), /sec\('limit'/);
  const s = await startSite();
  try { assert.ok((await fetch(`${s.base}/api/brief.md`, { headers: s.headers }).then(r => r.text())).includes('could do what you can do, including approve')); }
  finally { await s.close(); }
});
