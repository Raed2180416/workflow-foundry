import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JobManager, KINDS, buildCommand, jobEnv, readLogChunk, validateParams } from '../laptop/jobs.mjs';
import { defer, scratch, signed, startDaemon, testConfig, waitFor } from './helpers.mjs';

async function manager(t, overrides = {}) {
  const root = scratch(t, 'jobs');
  const cfg = testConfig(root, overrides);
  const logs = [];
  const jm = new JobManager({ config: cfg, workdir: cfg.workdir, log: m => logs.push(m), refresh: async () => ({ source: 'test', keys: [] }) });
  await jm.init();
  defer(t, () => jm.shutdown());
  const data = (name, text = '{"state":"s","questions":{"q":{"type":"noul","instructions":"?","label":true}}}\n') => { fs.writeFileSync(path.join(cfg.workdir, 'data', name), text); return `data/${name}`; };
  return { jm, cfg, root, logs, data };
}
const done = (jm, id, timeoutMs = 15_000) => waitFor(() => { const j = jm.get(id); return ['succeeded', 'failed', 'cancelled', 'stopped', 'lost'].includes(j.state) && j; }, { timeoutMs, what: `job ${id}` });

test('unknown job kinds are refused', async t => {
  const { jm } = await manager(t);
  for (const kind of ['rm -rf', 'shell', '__proto__', 'constructor', 'kev.train ', undefined, 42]) {
    await assert.rejects(jm.submit(kind, {}), e => e.status === 400 && e.code === 'unknown_kind', String(kind));
  }
});

test('parameters are validated against explicit schemas', async t => {
  const { jm, data } = await manager(t);
  const ds = data('train.jsonl');
  const bad = [
    [{}, /dataset: required/], [{ dataset: ds, epochs: 0 }, /epochs/], [{ dataset: ds, epochs: 11 }, /epochs/], [{ dataset: ds, epochs: 1.5 }, /epochs/],
    [{ dataset: ds, lr: 1e-2 }, /lr/], [{ dataset: ds, lr: '1e-4' }, /lr/], [{ dataset: ds, batch: 17 }, /batch/], [{ dataset: ds, accum: 65 }, /accum/],
    [{ dataset: ds, dtype: 'fp16' }, /dtype/], [{ dataset: ds, maxState: 64 }, /maxState/], [{ dataset: ds, checkpointing: 2 }, /checkpointing/],
    [{ dataset: ds, lora: 128 }, /lora/], [{ dataset: ds, base: 'evil/model' }, /base/], [{ dataset: ds, initFrom: 'someone/kev-0.8b' }, /initFrom/],
    [{ dataset: ds, initFrom: 'runs/../x' }, /initFrom/], [{ dataset: ds, initFrom: 'runs/nope' }, /initFrom/],
    [{ dataset: 'data/missing.jsonl' }, /does not exist/], [{ dataset: '../etc/passwd' }, /dataset/], [{ dataset: 'runs/x.jsonl' }, /dataset/],
    [{ dataset: ds, extra: { out: '/tmp/x' } }, /extra\.out: unknown/], [{ dataset: ds, extra: { perm_kl: -1 } }, /perm_kl/],
    [{ dataset: ds, extra: { suite: '../../etc' } }, /suite/], [{ dataset: ds, extra: { base_revision: 'main' } }, /base_revision/],
    [{ dataset: ds, unknown: 1 }, /unknown: unknown parameter/], [{ dataset: ds, extra: [] }, /extra: object/]
  ];
  for (const [params, re] of bad) await assert.rejects(jm.submit('kev.train', params), e => e.status === 400 && e.code === 'invalid_params' && re.test(e.message), JSON.stringify(params));
  await assert.rejects(jm.submit('kev.serve', { port: 8765 }), /port/);
  await assert.rejects(jm.submit('kev.serve', { run: 'jaredpalmer/kev-0.8b@main' }), /run/);
  await assert.rejects(jm.submit('kev.benchmark', { data: ds }), /run: required/);
  await assert.rejects(jm.submit('llama.serve', { name: 'Bad Name' }), /name/);
  await assert.rejects(jm.submit('llama.serve', { name: 'a', hf: { repo: 'x/y', file: 'z.gguf' } }), /allowlist/);
  await assert.rejects(jm.submit('llama.serve', { name: 'a' }), /exactly one of gguf/);
  await assert.rejects(jm.submit('llama.serve', { name: 'a', gguf: ds }), /\.gguf/);
  await assert.rejects(jm.submit('sys.selftest', { x: 1 }), /unknown parameter/);
  await assert.rejects(jm.submit('kev.train', 'string-params'), /params must be an object/);
});

test('kev.train builds an argument array (no shell) with defaults and allowlisted extras', async t => {
  const { jm, cfg, data } = await manager(t);
  const ds = data('we;ird$(x).jsonl'.replace(/[;$()]/g, '_'));
  const { value, resolved } = await validateParams(KINDS['kev.train'].params, { dataset: ds, extra: { perm_kl: 0.1, max_steps: 5, suite: 'evals/tiny', replay: 10 } }, jm);
  const built = buildCommand('kev.train', { params: value }, resolved, cfg, '/w/runs/j-1');
  assert.equal(built.cmd, cfg.python);
  assert.deepEqual(built.args.slice(0, 3), ['-m', 'kev.train', '--data']);
  const flags = Object.fromEntries(built.args.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a, arr[i + 1]]] : acc), []));
  assert.equal(flags['--base'], 'Qwen/Qwen3.5-0.8B-Base'); assert.equal(flags['--init_from'], 'jaredpalmer/kev-0.8b@v1.0');
  assert.equal(flags['--epochs'], '1'); assert.equal(flags['--lr'], '0.00002'); assert.equal(flags['--batch'], '1'); assert.equal(flags['--accum'], '8');
  assert.equal(flags['--dtype'], 'bf16'); assert.equal(flags['--max_state'], '384'); assert.equal(flags['--checkpointing'], '1'); assert.equal(flags['--lora'], '16');
  assert.equal(flags['--device'], 'cuda'); assert.equal(flags['--out'], '/w/runs/j-1'); assert.equal(flags['--perm_kl'], '0.1'); assert.equal(flags['--max_steps'], '5');
  assert.equal(flags['--suite'], path.join(cfg.kevDir, 'evals', 'tiny')); assert.equal(flags['--replay'], '10');
  const none = await validateParams(KINDS['kev.train'].params, { dataset: ds, initFrom: '' }, jm);
  assert.ok(!buildCommand('kev.train', { params: none.value }, none.resolved, cfg, '/o').args.includes('--init_from'));
  const cpu = { ...cfg, device: 'cpu' };
  assert.throws(() => buildCommand('kev.train', { params: value }, resolved, cpu, '/o'), /bf16 needs device cuda/);
});

test('job environment is minimal: no tokens unless the operator passes them through', () => {
  const cfg = { envPassthrough: [], env: { HF_HOME: '/hf' }, kevDir: '/kev', python: '/venv/bin/python' };
  const env = jobEnv(cfg, { PATH: '/usr/bin', HOME: '/home/u', HF_TOKEN: 'secret', GITHUB_TOKEN: 'x', AWS_SECRET_ACCESS_KEY: 'y', CUDA_VISIBLE_DEVICES: '0', SSH_AUTH_SOCK: '/s', RANDOM_VAR: '1', PYTORCH_CUDA_ALLOC_CONF: 'expandable_segments:True' });
  assert.equal(env.HF_TOKEN, undefined); assert.equal(env.GITHUB_TOKEN, undefined); assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.SSH_AUTH_SOCK, undefined); assert.equal(env.RANDOM_VAR, undefined);
  assert.equal(env.CUDA_VISIBLE_DEVICES, '0'); assert.equal(env.PYTORCH_CUDA_ALLOC_CONF, 'expandable_segments:True');
  assert.equal(env.HF_HOME, '/hf'); assert.equal(env.PYTHONPATH, '/kev'); assert.equal(env.PYTHONUNBUFFERED, '1');
  assert.ok(env.PATH.startsWith('/venv/bin'));
  assert.equal(jobEnv({ ...cfg, envPassthrough: ['HF_TOKEN'] }, { HF_TOKEN: 'secret' }).HF_TOKEN, 'secret');
});

test('selftest runs the configured python and parses its FOUNDRY_RESULT line', async t => {
  const { jm } = await manager(t, { env: { HF_TOKEN_NOT: 'x' } });
  const j = await jm.submit('sys.selftest', {});
  const end = await done(jm, j.id);
  assert.equal(end.state, 'succeeded', JSON.stringify(end));
  assert.equal(end.result.device, 'Fake RTX 4060 Laptop GPU');
  assert.equal(end.result.env_has_hf_token, false);
  assert.ok(end.result.pythonpath.endsWith('kev'));
});

test('kev.train writes runs/<jobId> and lists its outputs; the log is readable by offset', async t => {
  const { jm, data } = await manager(t);
  const j = await jm.submit('kev.train', { dataset: data('t.jsonl'), epochs: 2 });
  assert.equal(j.outputDir, `runs/${j.id}`);
  const end = await done(jm, j.id);
  assert.equal(end.state, 'succeeded', JSON.stringify(end));
  assert.deepEqual(end.outputs.files.map(f => f.path).sort(), [`runs/${j.id}/adapter_model.safetensors`, `runs/${j.id}/head.pt`, `runs/${j.id}/sub/metrics.json`, `runs/${j.id}/training_config.json`]);
  const all = jm.readLog(j.id, 0);
  assert.match(all.data, /fake kev\.train argv/); assert.match(all.data, /end succeeded exit=0/); assert.ok(all.done);
  assert.ok(!all.data.split('\n')[0].includes(jm.workdirReal), 'absolute workdir is masked in the start line');
  const part = jm.readLog(j.id, 10, 20);
  assert.equal(part.offset, 10); assert.ok(part.nextOffset <= 30);
  // the trained run can be benchmarked and served by its runs/ path
  const b = await jm.submit('kev.benchmark', { run: `runs/${j.id}`, data: 't.jsonl'.replace(/^/, 'data/') });
  assert.equal((await done(jm, b.id)).state, 'succeeded');
});

test('UTF-8 log chunks never split a character', async t => {
  const dir = scratch(t, 'utf8');
  const f = path.join(dir, 'x.log');
  fs.writeFileSync(f, 'ab✓cd');   // ✓ is 3 bytes at offsets 2..4
  for (let lim = 1; lim <= 7; lim++) {
    const c = readLogChunk(f, 0, lim);
    assert.ok(!c.data.includes('�'), `limit ${lim}`);
    const rest = readLogChunk(f, c.nextOffset, 100);
    assert.equal(c.data + rest.data, 'ab✓cd');
  }
});

test('a failing job reports failed with its exit code', async t => {
  const { jm, data } = await manager(t);
  const j = await jm.submit('kev.train', { dataset: data('fail.jsonl') });
  const end = await done(jm, j.id);
  assert.equal(end.state, 'failed'); assert.equal(end.exitCode, 3); assert.match(end.error, /exit code 3/);
});

test('GPU jobs run one at a time in FIFO order; cancel works for running and queued jobs', async t => {
  const { jm, data } = await manager(t);
  const a = await jm.submit('kev.train', { dataset: data('slow-a.jsonl') });
  const b = await jm.submit('kev.train', { dataset: data('slow-b.jsonl') });
  const c = await jm.submit('sys.selftest', {});
  await waitFor(() => jm.get(a.id).state === 'running', { what: 'a running' });
  assert.equal(jm.get(b.id).state, 'queued'); assert.equal(jm.get(c.id).state, 'queued');
  assert.deepEqual(jm.queue(), { running: a.id, queued: [b.id, c.id] });
  await jm.cancel(b.id);
  assert.equal(jm.get(b.id).state, 'cancelled');
  await waitFor(() => /step 3/.test(jm.readLog(a.id, 0).data), { what: 'a progress' });
  await jm.cancel(a.id);
  const ea = await done(jm, a.id);
  assert.equal(ea.state, 'cancelled');
  const ec = await done(jm, c.id);
  assert.equal(ec.state, 'succeeded', 'the next queued job starts after the cancelled one');
  assert.ok(Date.parse(ec.startedAt) >= Date.parse(ea.endedAt));
});

test('jobs past their timeout are killed and marked failed', async t => {
  const { jm, data } = await manager(t, { timeouts: { 'kev.train': 0.5, 'sys.selftest': 30, 'kev.benchmark': 30 } });
  const j = await jm.submit('kev.train', { dataset: data('slow.jsonl') });
  const end = await done(jm, j.id);
  assert.equal(end.state, 'failed'); assert.match(end.error, /timed out/);
});

test('a daemon restart marks unfinished jobs lost', async t => {
  const { jm, cfg, data } = await manager(t);
  const j = await jm.submit('kev.train', { dataset: data('slow.jsonl') });
  const file = path.join(cfg.workdir, 'jobs', `${j.id}.json`);
  await waitFor(() => JSON.parse(fs.readFileSync(file, 'utf8')).state === 'running', { what: 'running state on disk' });
  const jm2 = new JobManager({ config: cfg, workdir: cfg.workdir });
  await jm2.init();
  assert.equal(jm2.get(j.id).state, 'lost');
  await jm.cancel(j.id); await done(jm, j.id);
});

test('services: start, readiness, one kev.serve at a time, port checks, stop', async t => {
  const { jm } = await manager(t);
  const s = await jm.submit('kev.serve', { port: 8091 });
  assert.equal(s.state, 'starting');
  await waitFor(() => jm.get(s.id).state === 'running', { what: 'kev.serve ready' });
  assert.deepEqual(jm.serviceTarget('kev.serve'), { port: 8091, id: s.id });
  await assert.rejects(jm.submit('kev.serve', { port: 8092 }), e => e.status === 409);
  await assert.rejects(jm.submit('llama.serve', { name: 'x', gguf: 'data/none.gguf', port: 8191 }), /does not exist/);
  await jm.cancel(s.id);
  const end = await done(jm, s.id);
  assert.equal(end.state, 'stopped');
  assert.equal(jm.serviceTarget('kev.serve'), null);
});

test('git.refresh is an inline job that returns the refresh result', async t => {
  const { jm } = await manager(t);
  const j = await jm.submit('git.refresh', {});
  const end = await done(jm, j.id);
  assert.equal(end.state, 'succeeded'); assert.deepEqual(end.result, { source: 'test', keys: [] });
});

test('POST /jobs over HTTP: 202 with the job, 400 for unknown kinds and stray fields, 404 for unknown ids', async t => {
  const { url, key } = await startDaemon(t);
  let r = await signed(url, key, { method: 'POST', path: '/jobs', body: JSON.stringify({ kind: 'sys.selftest', params: {} }) });
  assert.equal(r.status, 202, r.text); assert.match(r.json.id, /^j-/);
  r = await signed(url, key, { method: 'POST', path: '/jobs', body: JSON.stringify({ kind: 'bash', params: {} }) });
  assert.equal(r.status, 400); assert.equal(r.json.error, 'unknown_kind');
  r = await signed(url, key, { method: 'POST', path: '/jobs', body: JSON.stringify({ kind: 'sys.selftest', params: {}, cmd: 'id' }) });
  assert.equal(r.status, 400); assert.match(r.json.message, /unexpected fields: cmd/);
  r = await signed(url, key, { method: 'POST', path: '/jobs', body: 'not json' });
  assert.equal(r.status, 400);
  r = await signed(url, key, { method: 'POST', path: '/jobs', body: JSON.stringify({ kind: 'kev.train', params: { dataset: 'data/x', epochs: 99 } }) });
  assert.equal(r.status, 400); assert.ok(Array.isArray(r.json.details) && r.json.details.length === 2, r.text);
  r = await signed(url, key, { path: '/jobs/j-20990101-000000-abcdef' });
  assert.equal(r.status, 404);
  r = await signed(url, key, { path: '/jobs/..%2f..%2fetc' });
  assert.equal(r.status, 404);
  r = await signed(url, key, { path: '/jobs' });
  assert.equal(r.status, 200); assert.equal(r.json.jobs.length, 1);
});
