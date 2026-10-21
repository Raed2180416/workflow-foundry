// import { callModel } from './tools/model.mjs'
import { readFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const cfg = JSON.parse(readFileSync(new URL('./gateway.json', import.meta.url)));
const here = path.dirname(fileURLToPath(import.meta.url));
function target() {
  if (!cfg.socket) { const u = new URL(cfg.url); return { host: u.hostname, port: u.port }; }
  const abs = path.join(here, cfg.socket), rel = path.relative(process.cwd(), abs);
  return { socketPath: rel.length < abs.length ? rel : abs };
}
function post(route, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({ ...target(), path: route, method: 'POST', headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; });
      res.on('end', () => { let body = {}; try { body = JSON.parse(text); } catch {} resolve({ status: res.statusCode, body }); });
    });
    req.on('error', reject); req.end(data);
  });
}
export async function callModel({ model, system = '', prompt, schema, reasoning = 'none', maxTokens } = {}) {
  const { status, body } = await post('/model', { model, system, prompt, schema, decoding: { reasoning, ...(maxTokens ? { maxTokens } : {}) } });
  const line = JSON.stringify({ at: new Date().toISOString(), model, status, ok: !!body.ok, costUsd: body.costUsd ?? null, spentUsd: body.spentUsd ?? null, error: body.ok ? undefined : (body.error?.code ?? body.error ?? null) });
  process.stderr.write('[model] ' + line + '\n');
  try { appendFileSync(new URL('./calls.jsonl', import.meta.url), line + '\n'); } catch {}
  if (status !== 200 || !body.ok) throw new Error('model call failed: ' + status + ' ' + JSON.stringify(body.error ?? body).slice(0, 400));
  return body.value;
}
