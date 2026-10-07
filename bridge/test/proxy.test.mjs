import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { signed, startDaemon, waitFor } from './helpers.mjs';

async function waitRunning(url, key, id) {
  return waitFor(async () => { const r = await signed(url, key, { path: `/jobs/${id}` }); return r.json.state === 'running' && r.json; }, { what: `service ${id}`, timeoutMs: 15_000 });
}

test('/svc/kev returns 502 until a kev.serve service is running, then forwards with headers stripped', async t => {
  const { url, key } = await startDaemon(t);
  let r = await signed(url, key, { path: '/svc/kev/v1/models' });
  assert.equal(r.status, 502); assert.equal(r.json.error, 'service_not_running');
  const job = (await signed(url, key, { method: 'POST', path: '/jobs', body: JSON.stringify({ kind: 'kev.serve', params: { port: 8061 } }) })).json;
  await waitRunning(url, key, job.id);
  r = await signed(url, key, { path: '/svc/kev/v1/models' });
  assert.equal(r.status, 200); assert.equal(r.json.models[0].run, 'jaredpalmer/kev-0.8b@v1.0');
  const body = JSON.stringify({ state: 'two charges', model: 'kev-latest', questions: { team: { type: 'choice', instructions: 'Which team?', criteria: { billing: '', shipping: '' } } } });
  r = await signed(url, key, {
    method: 'POST', path: '/svc/kev/v1/systemone?trace=1', body,
    headers: { 'content-type': 'application/json', authorization: 'Bearer leak', cookie: 'sid=1', 'proxy-authorization': 'Basic x', 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '1.2.3.4', 'x-custom': 'kept' }
  });
  assert.equal(r.status, 200, r.text);
  const echo = r.json.echo;
  assert.equal(echo.url, '/v1/systemone?trace=1'); assert.equal(echo.method, 'POST'); assert.deepEqual(echo.body, JSON.parse(body));
  for (const h of Object.keys(echo.headers)) assert.ok(!h.startsWith('x-bridge-'), `${h} must be stripped`);
  for (const h of ['authorization', 'cookie', 'proxy-authorization', 'cf-connecting-ip', 'x-forwarded-for']) assert.equal(echo.headers[h], undefined, h);
  assert.equal(echo.headers['x-custom'], 'kept'); assert.equal(echo.headers['content-type'], 'application/json');
  assert.equal(echo.headers.host, '127.0.0.1:8061');
  assert.equal(r.headers['x-upstream'], 'fake-kev', 'upstream response headers pass through');
  assert.ok(r.json.team.probabilities.billing > 0.5);
  // upstream 404 passes through as-is
  r = await signed(url, key, { path: '/svc/kev/nope' });
  assert.equal(r.status, 404);
  // after stop, 502 again
  await signed(url, key, { method: 'POST', path: `/jobs/${job.id}/stop` });
  await waitFor(async () => (await signed(url, key, { path: `/jobs/${job.id}` })).json.state === 'stopped');
  r = await signed(url, key, { path: '/svc/kev/v1/models' });
  assert.equal(r.status, 502);
});

test('/svc/llm/<name> reaches the named llama-server only', async t => {
  const { url, key, cfg } = await startDaemon(t);
  fs.writeFileSync(path.join(cfg.workdir, 'data', 'tiny.gguf'), 'GGUF');
  const job = (await signed(url, key, { method: 'POST', path: '/jobs', body: JSON.stringify({ kind: 'llama.serve', params: { name: 'qwen', gguf: 'data/tiny.gguf', port: 8161, ctx: 2048, ngl: 99 } }) })).json;
  assert.equal(job.state, 'starting', JSON.stringify(job));
  await waitRunning(url, key, job.id);
  let r = await signed(url, key, { method: 'POST', path: '/svc/llm/qwen/v1/chat/completions', body: JSON.stringify({ model: 'qwen', messages: [{ role: 'user', content: 'hi' }] }), headers: { authorization: 'Bearer nope', 'content-type': 'application/json' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.choices[0].message.content, 'echo: hi');
  assert.equal(r.json.authorizationSeen, null);
  assert.deepEqual(r.json.argv.slice(0, 2), ['-m', fs.realpathSync(path.join(cfg.workdir, 'data', 'tiny.gguf'))]);
  assert.ok(r.json.argv.includes('--alias') && r.json.argv.includes('127.0.0.1'));
  r = await signed(url, key, { path: '/svc/llm/other/health' });
  assert.equal(r.status, 502);
  r = await signed(url, key, { path: '/svc/llm/QWEN/health' });
  assert.equal(r.status, 404, 'names are lower-case only');
});

test('llama.serve accepts hf models only from the operator allowlist', async t => {
  const root = (await import('./helpers.mjs')).scratch(t, 'allow');
  const allow = path.join(root, 'allow.json');
  fs.writeFileSync(allow, JSON.stringify({ models: [{ repo: 'Qwen/Qwen3.5-2B-GGUF', file: 'qwen3.5-2b-q4_k_m.gguf' }] }));
  const { testConfig } = await import('./helpers.mjs');
  const { url, key } = await startDaemon(t, { root, config: testConfig(root, { llamaAllowlist: allow }) });
  let r = await signed(url, key, { method: 'POST', path: '/jobs', body: JSON.stringify({ kind: 'llama.serve', params: { name: 'q', hf: { repo: 'evil/x', file: 'y.gguf' } } }) });
  assert.equal(r.status, 400); assert.match(r.json.message, /allowlist/);
  r = await signed(url, key, { method: 'POST', path: '/jobs', body: JSON.stringify({ kind: 'llama.serve', params: { name: 'q', hf: { repo: 'Qwen/Qwen3.5-2B-GGUF', file: 'qwen3.5-2b-q4_k_m.gguf' }, port: 8162 } }) });
  assert.equal(r.status, 202, r.text);
  await waitRunning(url, key, r.json.id);
  const echo = await signed(url, key, { method: 'POST', path: '/svc/llm/q/v1/chat/completions', body: '{"messages":[{"role":"user","content":"x"}]}' });
  assert.deepEqual(echo.json.argv.slice(0, 4), ['--hf-repo', 'Qwen/Qwen3.5-2B-GGUF', '--hf-file', 'qwen3.5-2b-q4_k_m.gguf']);
});
