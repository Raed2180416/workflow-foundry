import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { openCodeV2SandboxArgs, validateV2WireRequest, nativeV2Headers } from '/home/raed/Projects/workflow-foundry/src/opencode-v2-free.mjs';
import { runProcess } from '/home/raed/Projects/workflow-foundry/src/process.mjs';
const base = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(base, `offline-replay-${randomUUID()}`);
const repo = '/home/raed/Projects/workflow-foundry/src';
const prompt = 'Return exactly this JSON object and nothing else: {"ok":true}';
for (const rel of ['task/runtime', 'state/config/opencode', 'state/data', 'state/cache', 'state/state', 'bridge']) mkdirSync(path.join(root, rel), { recursive: true, mode: 0o700 });
for (const file of ['opencode-v2-free.mjs', 'process.mjs', 'data.mjs']) writeFileSync(path.join(root, 'task/runtime', file), readFileSync(path.join(repo, file)), { mode: 0o600 });
writeFileSync(path.join(root, 'task/catalog.json'), readFileSync(path.join(base, 'remote-catalog.json')));
writeFileSync(path.join(root, 'task/prompt.txt'), prompt);
writeFileSync(path.join(root, 'task/input.json'), JSON.stringify({ model: 'opencode/big-pickle', maxOutputTokens: 512, timeoutMs: 15000, promptSHA256: createHash('sha256').update(prompt).digest('hex') }));
const envelope = { id: 'chatcmpl_supplied_fixture', object: 'chat.completion.chunk', created: 1, model: 'big-pickle' };
const fixture = [
  { ...envelope, choices: [{ index: 0, delta: { role: 'assistant', content: '{"ok":true}' }, finish_reason: null }] },
  { ...envelope, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } } },
].map(item => `data: ${JSON.stringify(item)}\n\n`).join('') + 'data: [DONE]\n\n';
writeFileSync(path.join(root, 'SUPPLIED-provider-response.sse'), fixture);
let requests = 0;
const gateway = createServer(async (request, response) => {
  requests++;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  writeFileSync(path.join(root, `request-${requests}.json`), body);
  try {
    if (requests !== 1 || request.url !== '/zen/v1/chat/completions') throw new Error('Unexpected additional request');
    validateV2WireRequest(JSON.parse(body.toString()), { prompt, maxOutputTokens: 512 });
    writeFileSync(path.join(root, 'native-headers.json'), JSON.stringify(nativeV2Headers(request.headers), null, 2));
    response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end(fixture);
  } catch (error) { response.writeHead(400); response.end(JSON.stringify({ error: error.message })); }
});
const fd = openSync(path.join(root, 'bridge'), 'r');
await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(`/proc/self/fd/${fd}/provider.sock`, resolve); });
const env = { PATH: '/usr/bin:/bin', HOME: '/home/opencode', LANG: 'C.UTF-8', TERM: 'dumb',
  XDG_CONFIG_HOME: '/state/config', XDG_DATA_HOME: '/state/data', XDG_CACHE_HOME: '/state/cache', XDG_STATE_HOME: '/state/state',
  OPENCODE_CONFIG: '/state/config/opencode/opencode.json', OPENCODE_CONFIG_DIR: '/state/config/opencode',
  OPENCODE_MODELS_PATH: '/task/catalog.json', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_FILEWATCHER: '1', OPENCODE_DISABLE_FFF: '1' };
let result;
try {
  const processResult = await runProcess('/usr/bin/bwrap', openCodeV2SandboxArgs(root), { env, timeoutMs: 20000 });
  result = { status: 'PASS', kind: 'SUPPLIED SSE fixture through actual v2 CLI/server; no model inference or external network', root, requests, processResult };
} catch (error) { result = { status: 'FAIL', kind: 'SUPPLIED SSE fixture; no model inference or external network', root, requests, code: error.code, message: error.message, processResult: error.processResult }; process.exitCode = 1; }
finally { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); closeSync(fd); }
writeFileSync(path.join(root, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, processResult: { code: result.processResult?.code, stdout: result.processResult?.stdout, stderr: result.processResult?.stderr } }));
