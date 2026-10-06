import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'metadata-001');
mkdirSync(root, { mode: 0o700 });
const model = 'qwen3.5-9b:itb';
const expectedDigest = '2afe0596021d6625b47a72567b3ce6692c2afa73a686d8bda8bd820c0b1710fb';
const hash = value => createHash('sha256').update(value).digest('hex');
const write = (name, value) => writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o400, flag: 'wx' });
const calls = [];
async function query(route, body) {
  if (!['version', 'ps', 'show'].includes(route)) throw new Error('Metadata route not authorized');
  const response = await fetch(`http://127.0.0.1:11434/api/${route}`, { method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
    redirect: 'error', signal: AbortSignal.timeout(10000) });
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('Metadata response too large'); chunks.push(Buffer.from(chunk)); }
  const bytes = Buffer.concat(chunks);
  calls.push({ route, method: body ? 'POST' : 'GET', status: response.status, responseBytes: bytes.length, responseSHA256: hash(bytes) });
  if (!response.ok) throw new Error(`Metadata ${route} returned ${response.status}`);
  return JSON.parse(bytes);
}
const version = await query('version');
const ps = await query('ps');
const show = await query('show', { model, verbose: false });
write('VERSION.json', version); write('PS.json', ps);
const info = show.model_info ?? {};
const architecture = info['general.architecture'];
const textInfo = value => ({ present: typeof value === 'string', bytes: typeof value === 'string' ? Buffer.byteLength(value) : null,
  sha256: typeof value === 'string' ? hash(value) : null });
const summary = {
  responseKeys: Object.keys(show), details: show.details, capabilities: show.capabilities,
  architecture, parameterCount: info['general.parameter_count'], contextLength: info[`${architecture}.context_length`],
  embeddingLength: info[`${architecture}.embedding_length`], metadata: Object.fromEntries(Object.entries(info).filter(([, value]) => !Array.isArray(value))),
  digest: show.digest ?? null, system: textInfo(show.system), template: textInfo(show.template),
  modelfile: textInfo(show.modelfile), parameters: show.parameters ?? null,
  messages: { count: show.messages?.length ?? 0, sha256: hash(JSON.stringify(show.messages ?? [])) },
};
write('SHOW-SUMMARY.json', summary);
const memory = Object.fromEntries(readFileSync('/proc/meminfo', 'utf8').split('\n').flatMap(line => {
  const match = /^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+) kB$/.exec(line);
  return match ? [[match[1] + 'Bytes', Number(match[2]) * 1024]] : [];
}));
const gpu = spawnSync('/usr/bin/nvidia-smi', ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits'],
  { encoding: 'utf8', timeout: 5000, maxBuffer: 32768, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
const loaded = (ps.models ?? []).find(item => item.name === model || item.model === model);
const observedDigest = show.digest ?? loaded?.digest ?? null;
const result = {
  status: 'HOLD_NO_INFERENCE', checkedAt: new Date().toISOString(), model, expectedDigest,
  expectedDigestSource: '../opencode-v2/ALTERNATE-METADATA.json (historical /api/tags observation)',
  observedDigest, exactDigestConfirmedNow: observedDigest === expectedDigest, version,
  residentModels: ps.models?.length ?? null, loadedContext: loaded?.context_length ?? null,
  architecture: summary.architecture, parameterCount: summary.parameterCount, quantization: show.details?.quantization_level,
  declaredContext: summary.contextLength, configuredParameters: show.parameters ?? null,
  system: summary.system, template: summary.template, availableLogicalCPUs: availableParallelism(), memory,
  gpu: { code: gpu.status, signal: gpu.signal, stdout: gpu.stdout ?? '', stderr: gpu.stderr ?? '', error: gpu.error?.code ?? null },
  calls, inferenceCalls: 0, modelLoads: 0, modelPulls: 0,
  promptUTF8BytesFromPrime: 48508, suggestedContextPendingHardwareQualification: 32768, suggestedMaxOutputTokens: 8192,
  contextQualification: 'No tokenizer count or actual prompt_eval_count; byte length alone does not establish no truncation. GPU memory is not certified while NVML fails.',
};
write('RESULT.json', result);
console.log(JSON.stringify(result));
