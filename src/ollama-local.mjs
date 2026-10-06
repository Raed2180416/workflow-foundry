import fs, { mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import childProcess from 'node:child_process';
import path from 'node:path';
import { FoundryError } from './data.mjs';

const endpoint = 'http://127.0.0.1:11434/api/';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw new FoundryError(code, message); };
const textIdentity = text => ({ present: typeof text === 'string', sha256: typeof text === 'string' ? hash(text) : null });
const save = (root, name, value) => writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });

async function request(route, body, signal) {
  const response = await fetch(endpoint + route, { method: body ? 'POST' : 'GET', redirect: 'error', signal,
    headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) fail('MODEL_RESPONSE_LIMIT', 'Local response exceeds 4 MiB');
    chunks.push(Buffer.from(chunk));
  }
  if (!response.ok) fail('MODEL_HTTP', `Local ${route} returned HTTP ${response.status}; no retry`);
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('MODEL_PROTOCOL', 'Local response is not complete JSON'); }
  if (value?.error) fail('MODEL_FAILED', 'Local server returned an error');
  return value;
}

/** One local chat request. Construction is inert; generate requires an idle
 * server and a working GPU. /api/tags is needed because /api/show omits digest. */
export class OllamaLocalProvider {
  constructor({ model = 'qwen3.5-9b:itb', expectedDigest, timeoutMs = 240000, numCtx = 32768,
    maxOutputTokens = 8192, seed = 0, temperature = 0 } = {}) {
    if (model !== 'qwen3.5-9b:itb' || !/^[a-f0-9]{64}$/.test(expectedDigest ?? '')) fail('MODEL_ID', 'Use the observed local tag and its full manifest digest');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000 || !Number.isInteger(numCtx) || numCtx < 8192 || numCtx > 32768 ||
      !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 8192 || maxOutputTokens >= numCtx || seed !== 0 || temperature !== 0)
      fail('MODEL_BUDGET', 'Use bounded context/output/deadline and deterministic seed 0, temperature 0');
    Object.assign(this, { model, expectedDigest, timeoutMs, numCtx, maxOutputTokens, seed, temperature, active: false });
    this.identity = Object.freeze({ provider: 'ollama-local', model, expectedDigest, version: '0.31.1', endpoint,
      transport: 'one-loopback-chat-request', numCtx, maxOutputTokens, seed, temperature, think: false });
  }

  async generate({ prompt, directory, signal } = {}) {
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 400000 || typeof directory !== 'string' || !directory)
      fail('MODEL_INPUT', 'A nonempty bounded prompt and receipt directory are required');
    if (signal?.aborted) fail('CANCELLED', 'Cancelled before local preflight');
    if (this.active) fail('MODEL_BUSY', 'This provider already owns an in-flight request');
    const root = path.join(directory, `ollama-local-${randomUUID()}`);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(root, 'prompt.txt'), prompt, { mode: 0o600, flag: 'wx' });
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const started = Date.now(); let calls = 0;
    const checkDigest = catalog => {
      const entries = catalog?.models?.filter(item => item.name === this.model);
      if (entries?.length !== 1 || entries[0].digest !== this.expectedDigest) fail('MODEL_DIGEST_DRIFT', 'Local tag manifest digest changed or is unavailable');
      return entries[0];
    };
    this.active = true;
    try {
      const version = await request('version', null, bounded);
      if (version.version !== this.identity.version) fail('MODEL_VERSION_DRIFT', 'Local server version differs from the qualified protocol');
      const tag = checkDigest(await request('tags', null, bounded));
      const show = await request('show', { model: this.model, verbose: false }, bounded);
      const info = show.model_info ?? {};
      if (show.remote_host || show.remote_model || info['general.architecture'] !== 'qwen35' || info['general.parameter_count'] !== 8953803264 ||
        info['qwen35.full_attention_interval'] !== 4 || show.details?.quantization_level !== 'Q4_K_M' ||
        !Number.isSafeInteger(info['qwen35.context_length']) || info['qwen35.context_length'] < this.numCtx)
        fail('MODEL_METADATA_DRIFT', 'Expected local Qwen3.5 9B Q4_K_M metadata is missing');
      const gpu = childProcess.spawnSync('/usr/bin/nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'],
        { encoding: 'utf8', timeout: 5000, maxBuffer: 8192, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
      const gpuFree = /^\d+(?:\.\d+)?\s*$/.test(gpu.stdout ?? '') ? Number(gpu.stdout.trim()) * 1024 ** 2 : 0;
      // Estimated full-GPU floor: stored model + eight full-attention KV layers
      // at fp16 + 1.5 GiB runtime reserve. This is a preflight, not an OOM proof.
      const gpuFloor = tag.size + this.numCtx * 32768 + 1.5 * 1024 ** 3;
      save(root, 'preflight.json', { version, tag, system: textIdentity(show.system), template: textIdentity(show.template),
        configuredParameters: show.parameters, declaredContext: info['qwen35.context_length'], gpuFree, gpuFloor, gpuExitCode: gpu.status });
      if (gpu.status !== 0 || !Number.isFinite(gpuFloor) || gpuFree < gpuFloor) fail('MODEL_GPU_PREFLIGHT', 'Working GPU with the estimated memory reserve is required; CPU fallback is not authorized');
      const available = Number(/^MemAvailable:\s+(\d+) kB$/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'))?.[1]) * 1024;
      if (!Number.isFinite(available) || available < 2 * 1024 ** 3) fail('MODEL_MEMORY_PREFLIGHT', 'At least 2 GiB available host memory is required');
      const before = await request('ps', null, bounded);
      if (!Array.isArray(before.models) || before.models.length) fail('MODEL_BUSY', 'Existing resident models are left untouched');
      const body = { model: this.model, messages: [{ role: 'user', content: prompt }], tools: [], stream: false, think: false, keep_alive: 0,
        options: { num_ctx: this.numCtx, num_predict: this.maxOutputTokens, seed: this.seed, temperature: this.temperature } };
      save(root, 'request.json', body);
      let response, inferenceError;
      calls++;
      try { response = await request('chat', body, bounded); save(root, 'raw-response.json', response); }
      catch (error) { inferenceError = error; }
      // Read-only cleanup evidence even after cancellation; never issue an unload
      // request that could stop another user's resident model.
      const afterSignal = AbortSignal.timeout(5000);
      const after = await Promise.allSettled([request('tags', null, afterSignal), request('ps', null, afterSignal)]);
      save(root, 'after.json', after.map(item => item.status === 'fulfilled' ? item : { status: item.status, message: item.reason?.message }));
      if (inferenceError) throw inferenceError;
      if (after[0].status !== 'fulfilled') fail('MODEL_DIGEST_UNKNOWN', 'Post-call manifest digest could not be checked');
      checkDigest(after[0].value);
      if (bounded.aborted) fail('CANCELLED', 'Cancelled before response qualification');
      if (response.model !== this.model || response.done !== true || response.message?.role !== 'assistant') fail('MODEL_PROTOCOL', 'Unbound or incomplete local response');
      if (response.message.tool_calls !== undefined && (!Array.isArray(response.message.tool_calls) || response.message.tool_calls.length)) fail('MODEL_TOOL_ATTEMPT', 'Output-only local model attempted tools');
      if (response.done_reason !== 'stop') fail('MODEL_INCOMPLETE', `Local generation ended with ${response.done_reason ?? 'unknown'}; response preserved`);
      for (const key of ['prompt_eval_count', 'eval_count', 'total_duration', 'load_duration', 'prompt_eval_duration', 'eval_duration'])
        if (!Number.isSafeInteger(response[key]) || response[key] < 0) fail('MODEL_USAGE_UNKNOWN', 'Local token counts or latency fields are missing');
      if (response.eval_count > this.maxOutputTokens || response.prompt_eval_count + this.maxOutputTokens > this.numCtx) fail('MODEL_CONTEXT_LIMIT', 'Observed tokens exceed the reserved context/output budget');
      const text = response.message.content;
      if (typeof text !== 'string' || !text.trim()) fail('MODEL_INCOMPLETE', 'No final response text');
      const evidence = { ...this.identity, receipts: root, manifestDigestBefore: tag.digest, manifestDigestAfter: this.expectedDigest,
        promptSHA256: hash(prompt), outputSHA256: hash(text), promptBytes: Buffer.byteLength(prompt), elapsedMs: Date.now() - started,
        doneReason: response.done_reason, promptEvalCount: response.prompt_eval_count, outputTokens: response.eval_count,
        durationsNs: { total: response.total_duration, load: response.load_duration, prompt: response.prompt_eval_duration, generation: response.eval_duration },
        inputTruncation: 'unknown: no independent tokenizer count; prompt_eval_count is retained, not proof of full input', outputTruncated: false,
        keepAlive: 0, residentAfter: after[1].status === 'fulfilled' ? after[1].value : null, inferenceCalls: calls,
        billing: 'local execution; resource costs are not priced', metadata: { system: textIdentity(show.system), template: textIdentity(show.template) } };
      save(root, 'response.json', { text, evidence });
      return { text, evidence };
    } catch (error) {
      const code = signal?.aborted ? 'CANCELLED' : deadline.aborted ? 'TIMEOUT' : error.code ?? 'MODEL_FAILED';
      save(root, 'failure.json', { code, message: error.message, inferenceCalls: calls, receipts: root });
      const failure = new FoundryError(code, error.message); failure.receipts = root; throw failure;
    } finally { this.active = false; }
  }
}
