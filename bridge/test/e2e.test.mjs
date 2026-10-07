// End to end on localhost: daemon (stub python/llama) + cloud client + CLI + src/judgment.mjs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SystemOneClient } from '../../src/judgment.mjs';
import { BridgeClient, BridgeError, keygen, loadKey } from '../cloud/client.mjs';
import { sha256hex } from '../common/protocol.mjs';
import { scratch, startDaemon } from './helpers.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cloud', 'cli.mjs');
const LOCAL_ENV = { PATH: process.env.PATH };   // no proxy variables: the daemon is on loopback

async function setup(t) {
  const root = scratch(t, 'e2e');
  const keyFile = path.join(root, 'cloud', 'cloud-ed25519.pem');
  const kg = keygen({ privatePath: keyFile });
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  assert.throws(() => keygen({ privatePath: keyFile }), /exists/);
  const keysDir = path.join(root, 'keys'); fs.mkdirSync(keysDir);
  fs.copyFileSync(kg.publicPath, path.join(keysDir, `cloud-${kg.keyId}.pub`));
  const key = loadKey(keyFile);
  const { d, url, cfg } = await startDaemon(t, { root, keysDir, key });
  const client = new BridgeClient({ endpoint: url, key, env: LOCAL_ENV });
  return { root, keyFile, key, d, url, cfg, client };
}

function cli(args, { keyFile, url }) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [CLI, ...args, '--endpoint', url, '--key', keyFile], { env: { ...LOCAL_ENV, HOME: path.dirname(keyFile) } });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ code, out, err }));
  });
}

test('e2e: upload a dataset, fine-tune, follow the log, fetch the run, benchmark it, serve it, judge through it', async t => {
  const { root, client, cfg } = await setup(t);
  // health is unsigned and reports clock skew; ping proves the signature path
  const h = await client.health();
  assert.equal(h.status, 200); assert.equal(h.ok, true); assert.ok(Math.abs(h.skewMs) < 5000);
  assert.equal((await client.ping()).keyId, client.key.keyId);
  const info = await client.info();
  assert.equal(info.gpu.available, false, 'no nvidia-smi here; the probe degrades instead of failing');
  assert.equal(info.keys.count, 1);

  const ds = path.join(root, 'train.jsonl');
  fs.writeFileSync(ds, '{"state":"Charged twice","questions":{"team":{"type":"choice","instructions":"Team?","criteria":{"billing":"","shipping":""},"label":"billing"}}}\n'.repeat(64));
  const up = await client.upload(ds, 'data/train.jsonl');
  assert.equal(up.sha256, sha256hex(fs.readFileSync(ds)));
  await assert.rejects(client.upload(ds, 'data/train.jsonl'), e => e instanceof BridgeError && e.status === 409);

  const job = await client.submitJob('kev.train', { dataset: 'data/train.jsonl', epochs: 1, extra: { max_steps: 3 } });
  let logText = '';
  const end = await client.waitJob(job.id, { pollMs: 50, timeoutMs: 20_000, onLog: s => { logText += s; } });
  assert.equal(end.state, 'succeeded', JSON.stringify(end));
  assert.match(logText, /fake kev\.train argv/); assert.match(logText, /✓/); assert.match(logText, /end succeeded/);
  assert.match(logText, /"--max_steps","3"/);
  const runDir = path.join(root, 'fetched');
  const got = await client.downloadDir(end.outputs.dir, runDir);
  assert.equal(got.files.length, 4);
  assert.deepEqual(fs.readFileSync(path.join(runDir, 'head.pt')), fs.readFileSync(path.join(cfg.workdir, end.outputs.dir, 'head.pt')));
  assert.ok(JSON.parse(fs.readFileSync(path.join(runDir, 'training_config.json'), 'utf8')).args.includes('--init_from'));

  const bench = await client.submitJob('kev.benchmark', { run: end.outputs.dir, data: 'data/train.jsonl' });
  const bend = await client.waitJob(bench.id, { pollMs: 50, timeoutMs: 20_000 });
  assert.equal(bend.state, 'succeeded');
  const report = path.join(root, 'report.json');
  await client.download(`${bend.outputs.dir}/report.json`, report);
  assert.equal(JSON.parse(fs.readFileSync(report, 'utf8')).run.endsWith(end.id), true);

  // serve the tuned run, then use the repo's SystemOneClient with bridgeFetch as its fetchImpl
  const svc = await client.submitJob('kev.serve', { run: end.outputs.dir, port: 8071 });
  const ready = await client.waitJob(svc.id, { pollMs: 50, timeoutMs: 20_000 });
  assert.equal(ready.state, 'running');
  const kev = new SystemOneClient({ url: `${client.endpoint}/svc/kev`, fetchImpl: client.bridgeFetch, env: { FOUNDRY_SYSTEMONE_KEY: 'should-not-leak' } });
  const models = await kev.describe();
  assert.ok(models.ids[0].endsWith(end.id));
  const answer = await kev.ask({ state: 'I see two charges', questions: { team: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Charges', shipping: 'Delivery' } } } });
  assert.ok(answer.team.probabilities.billing > 0.5);
  assert.equal(answer.echo.headers.authorization, undefined, 'the daemon strips Authorization before the local service');
  // bridgeFetch refuses other origins (it must never sign requests for somewhere else)
  await assert.rejects(client.bridgeFetch('https://example.com/svc/kev/v1/models'), /not the bridge endpoint/);
  // OpenAI-compatible lane: llama.serve + plain fetch semantics through bridgeFetch
  fs.copyFileSync(ds, path.join(root, 'm.gguf'));
  await client.upload(path.join(root, 'm.gguf'), 'data/m.gguf');
  const llm = await client.submitJob('llama.serve', { name: 'qwen', gguf: 'data/m.gguf', port: 8171 });
  await client.waitJob(llm.id, { pollMs: 50, timeoutMs: 20_000 });
  const res = await client.bridgeFetch(`${client.endpoint}/svc/llm/qwen/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'qwen', messages: [{ role: 'user', content: 'ping' }] }) });
  assert.equal(res.status, 200); assert.equal((await res.json()).choices[0].message.content, 'echo: ping');
  // stop both; the proxy answers 502 afterwards
  await client.cancel(svc.id); await client.cancel(llm.id);
  for (const id of [svc.id, llm.id]) assert.equal((await client.waitJob(id, { pollMs: 50, timeoutMs: 20_000 })).state, 'stopped');
  const after = await client.bridgeFetch('/svc/kev/v1/models');
  assert.equal(after.status, 502);
  await assert.rejects(kev.describe(), e => e.code === 'MODEL_UNAVAILABLE');
});

test('e2e: the CLI drives every command against a live daemon', async t => {
  const { root, keyFile, url } = await setup(t);
  const o = { keyFile, url };
  let r = await cli(['ping'], o);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /signed ping ok/);
  r = await cli(['info', '--json'], o); assert.equal(r.code, 0, r.err); assert.equal(JSON.parse(r.out).version, '0.1.0');
  r = await cli(['selftest'], o); assert.equal(r.code, 0, r.err); assert.match(r.out, /succeeded/); assert.match(r.out, /Fake RTX 4060/);
  fs.writeFileSync(path.join(root, 'slow.jsonl'), '{}\n');
  r = await cli(['put', path.join(root, 'slow.jsonl'), 'data/slow.jsonl'], o); assert.equal(r.code, 0, r.err); assert.match(r.out, /sha256/);
  r = await cli(['ls', 'data'], o); assert.match(r.out, /data\/slow\.jsonl/);
  r = await cli(['job', 'kev.train', 'dataset=data/slow.jsonl', 'epochs=1', 'extra.seed=7'], o); assert.equal(r.code, 0, r.err);
  const id = r.out.split(' ')[0];
  await new Promise(res => setTimeout(res, 400));
  r = await cli(['log', id], o); assert.match(r.out, /step \d+/);
  r = await cli(['cancel', id], o); assert.equal(r.code, 0, r.err); assert.match(r.out, /cancel/);
  r = await cli(['wait', id, '--quiet'], o); assert.equal(r.code, 3, 'cancelled jobs exit 3'); assert.match(r.out, /cancelled/);
  r = await cli(['jobs'], o); assert.equal(r.code, 0);
  r = await cli(['get', `logs/${id}.log`, path.join(root, 'job.log')], o); assert.equal(r.code, 0, r.err); assert.match(fs.readFileSync(path.join(root, 'job.log'), 'utf8'), /--seed 7/);
  r = await cli(['job', 'kev.train', 'dataset=data/slow.jsonl', 'epochs=99'], o); assert.equal(r.code, 1); assert.match(r.err, /epochs/);
  r = await cli(['req', 'GET', '/files?dir=logs'], o); assert.equal(r.code, 0); assert.match(r.out, /bridge-access\.log/);
  r = await cli(['job', 'nope'], o); assert.equal(r.code, 1); assert.match(r.err, /unknown_kind/);
  r = await cli(['bogus'], o); assert.equal(r.code, 2);
  r = await cli(['keygen'], o); assert.equal(r.code, 1); assert.match(r.err, /exists/);
  assert.ok(!(r.out + r.err).includes('PRIVATE KEY'), 'the CLI never prints private keys');
});
