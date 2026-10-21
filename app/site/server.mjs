// The onboarding site: one loopback server over one FoundryApp (research/onboarding-20261021/SPEC.md §11).
//
//   static   the page shell, styles, scripts, views, components and copy from app/site/public (an allowlist of paths; no directory
//            listing, no traversal); the same CSP and security headers as the dashboard (no inline script or style, img-src 'none').
//   /api/*   the dashboard's routes (overview, run, flow versions, a person's decision) plus the site's (app/site/api.mjs). Every call
//            needs the per-start token (x-foundry-token) and a loopback Host header (DNS rebinding); POST bodies are JSON only, capped
//            at 16 KB (5 MB for a dropped file).
//
// Boundary (stated on the Trust page and in every IT brief): the token and the Host check keep other web pages and other OS users out.
// They do not keep out a coding agent that runs as the same OS user with a shell.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorData } from '../../src/data.mjs';
import { failureText } from '../core/explain.mjs';
import { FoundryApp } from '../core/service.mjs';
import { handleDashboardApi, SECURITY } from '../dashboard/server.mjs';
import { createSiteApi } from './api.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC = path.join(here, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const STATIC = /^\/(?:(site\.css|site\.js)|(copy\/en\.json)|((?:views|components)\/[a-z][a-z0-9-]{0,40}\.js))$/;
export const SMALL_BODY = 16 * 1024, LARGE_BODY = 5 * 1024 * 1024;
const LARGE = /^\/api\/(data|import|org)\//;
const STATUS = { NOT_FOUND: 404, CSV_SIZE: 413, PRACTICE_ONLY: 409, NOT_APPROVED: 409, STALE_APPROVAL: 409, KEYCHAIN_NONE: 409 };

/** A FoundryApp with the site builder (cards by form, $0; words to the stub unless an AI builder is configured). */
export async function siteApp({ workspace, builder = 'templates', tokenCap } = {}) {
  const { SiteBuilder } = await import('../onboarding/site-builder.mjs');
  let text;
  // Mercury (Preview): a child process gets the key from the keychain in its environment; this process never keeps it.
  if (builder === 'mercury') {
    const [{ WorkerBuilder }, { Keychain, detectBackend }] = await Promise.all([import('../onboarding/builder-worker.mjs'), import('../onboarding/keychain.mjs')]);
    text = new WorkerBuilder({ keychain: new Keychain({ backend: detectBackend() }), tokenCap: tokenCap ?? 200000, workspace });
  }
  return new FoundryApp({ workspace, builder: new SiteBuilder(text ? { text } : {}) });
}

/** Create (not start) the site server. options: token, now (clock for run inputs), keychain, keyCheckBaseUrl (tests: 127.0.0.1 only), log. */
export function createSite(app, options = {}) {
  const token = options.token ?? randomBytes(24).toString('base64url');
  const expected = Buffer.from(token);
  let port = null;
  const api = createSiteApi(app, options);
  const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    if (res.headersSent) return;
    res.writeHead(status, { ...SECURITY, 'content-type': type, ...extra });
    res.end(type.startsWith('application/json') && typeof body !== 'string' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body);
  };
  const server = createServer(async (req, res) => {
    try {
      if (!['127.0.0.1', 'localhost'].map(h => `${h}:${port}`).includes(req.headers.host ?? '')) return send(res, 421, { error: 'wrong host' });
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, readFileSync(path.join(PUBLIC, 'index.html')), TYPES['.html']);
      let m;
      if (req.method === 'GET' && (m = url.pathname.match(STATIC))) {
        const file = path.join(PUBLIC, url.pathname.slice(1));
        if (!file.startsWith(PUBLIC + path.sep) || !existsSync(file)) return send(res, 404, { error: 'not found' });
        return send(res, 200, readFileSync(file), TYPES[path.extname(file)]);
      }
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      const given = Buffer.from(String(req.headers['x-foundry-token'] ?? ''));
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return send(res, 401, { error: 'This page needs the link printed by `node app/cli.mjs site`.' });
      if (await handleDashboardApi(app, req, res, url, send)) return;
      let body = null;
      if (['POST', 'PUT'].includes(req.method)) {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'JSON only' });
        const cap = LARGE.test(url.pathname) ? LARGE_BODY : SMALL_BODY;
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > cap) return send(res, 413, { error: 'too large', problem: { what: 'That is more than Foundry takes in one go.', next: cap === LARGE_BODY ? 'Use a file under 5 MB.' : 'Send less.' } }); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return send(res, 400, { error: 'not JSON' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'a JSON object is required' });
      }
      const out = await api.handle(req.method, url, body);
      if (!out) return send(res, 404, { error: 'not found' });
      if (out.download) return send(res, 200, out.download.body, out.download.type, { 'content-disposition': `attachment; filename="${out.download.name.replace(/[^A-Za-z0-9._-]/g, '_')}"` });
      return send(res, out.status ?? 200, out.body);
    } catch (error) {
      const data = errorData(error);
      options.log?.({ at: new Date().toISOString(), code: data.code, path: req.url?.split('?')[0] });
      // Known codes read in plain words (app/core/explain.mjs); the site's own codes carry a plain message already.
      const known = failureText(data), plain = known && !known.what.startsWith('Stopped with code') ? known
        : { code: data.code, what: data.code === 'ERROR' ? 'Something went wrong inside Foundry.' : data.message, next: data.code === 'ERROR' ? 'Nothing was sent. Try again; if it keeps happening, the details below help whoever looks at it.' : null };
      return send(res, STATUS[data.code] ?? (data.code === 'ERROR' ? 500 : 409), { error: data, problem: plain, questions: error.questions ?? undefined, sheets: error.sheets ?? undefined, flips: error.flips ?? undefined, problems: error.problems ?? undefined });
    }
  });
  return {
    server, token, api,
    async listen(wanted = 0) {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(wanted, '127.0.0.1', resolve); });
      port = server.address().port;
      return { port, url: `http://127.0.0.1:${port}/#t=${token}` };
    },
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); })
  };
}
