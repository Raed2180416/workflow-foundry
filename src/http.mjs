import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { packageRoot } from './foundry.mjs';
import { FoundryError, checkData, errorData } from './data.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const safeEqual = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(req) {
  const parts = []; let length = 0;
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new FoundryError('CONTENT_TYPE', 'JSON content-type is required');
  for await (const part of req) {
    length += part.length;
    if (length > 2 * 1024 * 1024) throw new FoundryError('BODY_LIMIT', 'Request is too large');
    parts.push(part);
  }
  try { return checkData(JSON.parse(Buffer.concat(parts).toString('utf8'))); }
  catch (error) { if (error.code) throw error; throw new FoundryError('JSON', 'Malformed request JSON'); }
}

export async function serveHttp(foundry, { port = 4177, host = '127.0.0.1' } = {}) {
  if (host !== '127.0.0.1') throw new FoundryError('HTTP_BIND', 'This local UI supports loopback only');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new FoundryError('HTTP_PORT', 'Invalid port');
  const token = randomBytes(32).toString('hex');
  const nonce = randomBytes(20).toString('hex');
  let origin;
  const server = createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    try {
      if (req.headers.host !== new URL(origin).host) throw new FoundryError('HTTP_HOST', 'Unrecognized host');
      if (req.headers.origin && req.headers.origin !== origin) throw new FoundryError('HTTP_ORIGIN', 'Cross-origin access is forbidden');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new FoundryError('HTTP_ORIGIN', 'Cross-site access is forbidden');
      const url = new URL(req.url, origin); const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const mutating = !['GET', 'HEAD'].includes(req.method);
      if (mutating && !safeEqual(req.headers['x-foundry-token'], token)) throw new FoundryError('HTTP_TOKEN', 'Missing or invalid local UI token');
      if (req.method === 'GET' && parts[0] === 'api') {
        if (parts.length === 2 && parts[1] === 'state') return json(200, foundry.state());
        if (parts.length === 3 && parts[1] === 'workflows') return json(200, foundry.store.workflow(parts[2]));
        if (parts.length === 3 && parts[1] === 'runs') return json(200, foundry.inspectRun(parts[2]));
        if (parts.length === 3 && parts[1] === 'context') return json(200, foundry.designContext({ requestId: parts[2] }));
        if (parts.length === 3 && parts[1] === 'generation') return json(200, foundry.store.generationJob(parts[2]));
        if (parts.length === 3 && parts[1] === 'trials') return json(200, foundry.inspectTrial(parts[2]));
      }
      if (req.method === 'POST' && parts[0] === 'api') {
        const data = await body(req);
        if (parts.length === 2 && parts[1] === 'validate') return json(200, foundry.validate(data.workflow));
        if (parts.length === 2 && parts[1] === 'workflows') return json(201, foundry.save(data.workflow, data.expectedHash));
        if (parts.length === 2 && parts[1] === 'requests') return json(201, foundry.store.createRequest({ workflowId: data.workflowId, baseHash: data.baseHash, text: data.text, source: 'user-ui' }));
        if (parts.length === 2 && parts[1] === 'proposals') return json(201, foundry.propose({ requestId: data.requestId, workflow: data.workflow, rationale: data.rationale }));
        if (parts.length === 2 && parts[1] === 'trials') {
          if (!Object.hasOwn(data, 'input')) throw new FoundryError('TRIAL_INPUT', 'An explicit diagnostic input is required');
          return json(201, await foundry.trial({ requestId: data.requestId, workflow: data.workflow, input: data.input }));
        }
        if (parts.length === 2 && parts[1] === 'repair-requests') return json(201, foundry.requestRepair({ requestId: data.requestId, failedRunId: data.failedRunId, expectedHash: data.expectedHash, diagnostic: data.diagnostic ?? '' }));
        if (parts.length === 2 && parts[1] === 'delivery') return json(200, foundry.delivery({ requestId: data.requestId, proposalId: data.proposalId, runId: data.runId }));
        if (parts.length === 4 && parts[1] === 'generation' && parts[3] === 'cancel') {
          if (!foundry.generator) throw new FoundryError('GENERATOR_UNAVAILABLE', 'No model provider is enabled in this server');
          foundry.generator.cancel(parts[2]); return json(202, { id: parts[2], cancellationRequested: true });
        }
        if (parts.length === 4 && parts[1] === 'proposals' && parts[3] === 'apply') return json(200, foundry.apply(parts[2]));
        if (parts.length === 2 && parts[1] === 'runs') {
          const run = foundry.createRun(data.workflowId, data.input ?? {});
          foundry.startRun(run.id).catch(error => console.error('Foundry execution:', error.code, error.message));
          return json(202, run);
        }
        if (parts.length === 4 && parts[1] === 'runs') {
          if (parts[3] === 'answers') {
            foundry.runtime.answer(parts[2], data.nodeId, data.answer);
            foundry.startRun(parts[2]).catch(error => console.error('Foundry resume:', error.code, error.message));
            return json(202, foundry.inspectRun(parts[2]));
          }
          if (parts[3] === 'approvals') {
            foundry.runtime.approve(parts[2], data.approvalId, data.approved, 'user');
            if (data.approved) foundry.startRun(parts[2]).catch(error => console.error('Foundry approval resume:', error.code, error.message));
            return json(202, foundry.inspectRun(parts[2]));
          }
          if (parts[3] === 'resume') { foundry.startRun(parts[2]).catch(error => console.error(error.message)); return json(202, { id: parts[2], resumeRequested: true }); }
          if (parts[3] === 'cancel') return json(202, foundry.cancelRun(parts[2]));
        }
      }
      if (req.method === 'GET' && ['/', '/index.html', '/app.js', '/style.css'].includes(url.pathname)) {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        let content = readFileSync(path.join(packageRoot, 'web', file), 'utf8');
        if (file === 'index.html') content = content.replace('__FOUNDRY_BOOTSTRAP__', `<script nonce="${nonce}">window.__FOUNDRY_TOKEN__=${JSON.stringify(token)};</script>`);
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] }); res.end(content); return;
      }
      return json(404, { error: { code: 'NOT_FOUND', message: 'Unknown route' } });
    } catch (error) {
      const code = error.code ?? 'ERROR';
      const status = ['HTTP_HOST', 'HTTP_ORIGIN', 'HTTP_TOKEN'].includes(code) ? 403 : code === 'NOT_FOUND' ? 404 : ['STALE_WORKFLOW', 'VERSION_CONFLICT', 'RUN_BUSY', 'PROPOSAL_CLOSED'].includes(code) ? 409 : code === 'BODY_LIMIT' ? 413 : 400;
      json(status, { error: errorData(error), ...(error.details ? { details: error.details } : {}) });
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000; server.maxHeadersCount = 50;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  origin = `http://${host}:${server.address().port}`;
  return { server, origin, close: () => new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())) };
}
