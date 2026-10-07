// Regression tests for the adversarial review of the bridge (findings F1-F5) and for what the
// e2e run against a real cloudflared taught (missing config, abandoned downloads, Cloudflare edge
// errors, streaming through quick tunnels). One or more tests per fix; no network.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BridgeClient, explainHttp, retryableConnectError } from '../cloud/client.mjs';
import { H, NonceCache, generateKeyPair, newNonce, sha256hex } from '../common/protocol.mjs';
import { normalizeConfig } from '../laptop/config.mjs';
import { createDaemon } from '../laptop/daemon.mjs';
import { Publisher } from '../laptop/publisher.mjs';
import { JobManager, jobEnv, torchSafe } from '../laptop/jobs.mjs';
import { Mailbox, acquireLockFile, buildEndpoint, initMailbox, runGit } from '../mailbox.mjs';
import { defer, plantTrainedRun, raw, scratch, signed, startDaemon, testConfig, testKey, waitFor } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAEMON = path.join(HERE, '..', 'laptop', 'daemon.mjs');
const CLI = path.join(HERE, '..', 'cloud', 'cli.mjs');
const TERMINAL = ['succeeded', 'failed', 'cancelled', 'stopped', 'lost'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function manager(t, overrides = {}, opts = {}) {
  const root = scratch(t, 'hard');
  const cfg = testConfig(root, overrides);
  const logs = [];
  const jm = new JobManager({ config: cfg, workdir: cfg.workdir, log: m => logs.push(m), refresh: async () => ({ source: 'test', keys: [] }), ...opts });
  await jm.init();
  defer(t, () => jm.shutdown());
  const data = (name, text = '{"state":"s","questions":{"q":{"type":"noul","instructions":"?","label":true}}}\n') => { fs.writeFileSync(path.join(cfg.workdir, 'data', name), text); return `data/${name}`; };
  return { jm, cfg, root, logs, data };
}
const done = (jm, id, timeoutMs = 15_000) => waitFor(() => { const j = jm.get(id); return TERMINAL.includes(j.state) && j; }, { timeoutMs, what: `job ${id}` });

// Sends only the request head (with a content-length it never honours) and returns the response.
// A response proves the daemon decided without reading the body.
function headOnly(url, { method = 'POST', path: p, headers }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, method, path: p, headers, agent: false });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('no response without the body: the daemon waited for it')); }, 5000);
    req.on('response', res => {
      let text = '';
      res.setEncoding('utf8').on('data', d => { text += d; });
      res.on('end', () => { clearTimeout(timer); req.destroy(); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json }); });
    });
    req.on('error', error => { clearTimeout(timer); if (!['ECONNRESET', 'EPIPE'].includes(error.code)) reject(error); });
    req.flushHeaders();
  });
}

// ---- F1: uploaded checkpoints are a deserialization gateway ----------------------------------------

test('F1: only runs/<jobId> of a kev.train job this daemon finished, unchanged, is ever loaded', async t => {
  const { jm, cfg, data } = await manager(t);
  const ds = data('t.jsonl');
  const runs = path.join(cfg.workdir, 'runs');
  // a staged directory (the attack uploaded head.pt + adapter files into runs/evil; uploads there are now
  // refused, so here it is planted on disk), and one disguised with a job-id name but no job record
  for (const dir of ['evil', 'j-20261007-000000-aaaaaa']) {
    fs.mkdirSync(path.join(runs, dir));
    for (const f of ['head.pt', 'adapter_config.json', 'adapter_model.safetensors']) fs.writeFileSync(path.join(runs, dir, f), 'crafted');
  }
  const refusals = [
    ['kev.serve', { run: 'runs/evil' }, /runs\/<jobId> of a kev\.train job/],
    ['kev.benchmark', { run: 'runs/evil', data: ds }, /runs\/<jobId> of a kev\.train job/],
    ['kev.train', { dataset: ds, initFrom: 'runs/evil' }, /runs\/<jobId> of a kev\.train job/],
    ['kev.serve', { run: 'runs/j-20261007-000000-aaaaaa' }, /not a checkpoint of a kev\.train job this daemon finished/],
    ['kev.serve', { run: 'runs/j-20261007-000000-aaaaaa/head.pt' }, /runs\/<jobId>/]
  ];
  for (const [kind, params, re] of refusals) await assert.rejects(jm.submit(kind, params), e => e.status === 400 && e.code === 'invalid_params' && re.test(e.message), `${kind} ${JSON.stringify(params)}`);
  // a real run is accepted, and its head.pt hash is recorded as provenance
  const tr = await jm.submit('kev.train', { dataset: ds });
  const end = await done(jm, tr.id);
  assert.equal(end.state, 'succeeded', JSON.stringify(end));
  const head = path.join(runs, tr.id, 'head.pt');
  const original = fs.readFileSync(head);
  assert.deepEqual(end.checkpoint, { dir: `runs/${tr.id}`, headSha256: sha256hex(original) });
  const bench = await jm.submit('kev.benchmark', { run: `runs/${tr.id}`, data: ds });
  assert.equal((await done(jm, bench.id)).state, 'succeeded');
  // a benchmark's output and a failed training run are not checkpoints
  await assert.rejects(jm.submit('kev.serve', { run: `runs/${bench.id}` }), /not a checkpoint/);
  const failed = await jm.submit('kev.train', { dataset: data('fail.jsonl') });
  assert.equal((await done(jm, failed.id)).state, 'failed');
  fs.mkdirSync(path.join(runs, failed.id), { recursive: true }); fs.writeFileSync(path.join(runs, failed.id, 'head.pt'), 'crafted');
  await assert.rejects(jm.submit('kev.serve', { run: `runs/${failed.id}` }), /not a checkpoint/);
  // head.pt changed after the job wrote it, or replaced by a symlink: refused
  fs.writeFileSync(head, 'gadget');
  await assert.rejects(jm.submit('kev.serve', { run: `runs/${tr.id}` }), /changed after the job wrote it/);
  fs.rmSync(head); fs.symlinkSync(path.join(runs, 'evil', 'head.pt'), head);
  await assert.rejects(jm.submit('kev.serve', { run: `runs/${tr.id}` }), /not a regular file/);
  fs.rmSync(head); fs.writeFileSync(head, original);
  // provenance is the job record on disk: it survives a daemon restart
  const jm2 = new JobManager({ config: cfg, workdir: cfg.workdir });
  await jm2.init();
  assert.equal(await jm2.resolveRunDir(`runs/${tr.id}`), path.join(jm2.workdirReal, 'runs', tr.id));
});

test('F1: kev jobs are refused unless the configured python has torch >= 2.6; the selftest still runs and says why', async t => {
  for (const [version, re] of [['2.5.1+cu121', /torch 2\.5\.1\+cu121/], ['none', /not installed/]]) {
    const { jm, data } = await manager(t, { env: { FAKE_TORCH_VERSION: version } });
    const ds = data('t.jsonl');
    for (const [kind, params] of [['kev.train', { dataset: ds }], ['kev.benchmark', { run: 'jaredpalmer/kev-0.8b@v1.0', data: ds }], ['kev.serve', { port: 8094 }]])
      await assert.rejects(jm.submit(kind, params), e => e.status === 503 && e.code === 'unsafe_torch' && re.test(e.message), `${kind} with torch ${version}`);
    const st = await jm.submit('sys.selftest', {});
    const end = await done(jm, st.id);
    assert.equal(end.state, 'failed', 'the selftest exits 1 when the torch version is unsafe');
    assert.equal(end.result.torch_weights_only_safe, false);
  }
  for (const [v, ok] of [['2.6.0', true], ['2.8.0+cu128', true], ['2.10.1', true], ['3.0.0', true], ['2.5.1', false], ['1.13.1', false], ['', false], ['abc', false], [null, false]]) assert.equal(torchSafe(v), ok, String(v));
});

test('F1: every job runs with TORCH_FORCE_WEIGHTS_ONLY_LOAD=1, and neither the daemon environment nor the config can turn it off', async t => {
  const cfg = { envPassthrough: [], env: {}, kevDir: '/kev', python: '/venv/bin/python' };
  const env = jobEnv(cfg, { PATH: '/usr/bin', TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1', TORCH_FORCE_WEIGHTS_ONLY_LOAD: '0' });
  assert.equal(env.TORCH_FORCE_WEIGHTS_ONLY_LOAD, '1'); assert.equal(env.TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD, undefined);
  const root = scratch(t, 'cfg');
  assert.throws(() => testConfig(root, { env: { TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1' } }), /not allowed/);
  assert.throws(() => testConfig(root, { env: { TORCH_FORCE_WEIGHTS_ONLY_LOAD: '0' } }), /not allowed/);
  assert.throws(() => testConfig(root, { envPassthrough: ['TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD'] }), /must not include/);
  const { jm } = await manager(t);
  const st = await done(jm, (await jm.submit('sys.selftest', {})).id);
  assert.equal(st.state, 'succeeded', JSON.stringify(st));
  assert.equal(st.result.torch_force_weights_only, '1'); assert.equal(st.result.pickle_guard, 'refused');
  const svc = await jm.submit('kev.serve', { port: 8095 });
  await waitFor(() => jm.get(svc.id).state === 'running', { what: 'kev.serve ready' });
  const models = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: 8095, path: '/v1/models', agent: false }, res => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => resolve(JSON.parse(b))); }).on('error', reject));
  assert.equal(models.weightsOnlyForced, true, 'the service process got the guard');
  await jm.cancel(svc.id); await done(jm, svc.id);
});

// ---- F2: replay across a daemon restart -----------------------------------------------------------

test('F2: accepted nonces survive a daemon restart, so a captured request cannot be replayed after one', async t => {
  const root = scratch(t, 'replay');
  const keysDir = path.join(root, 'keys');
  const key = testKey(keysDir);
  const cfg = testConfig(root);
  const first = await startDaemon(t, { root, config: cfg, keysDir, key });
  const nonce = newNonce(); const ts = Date.now();
  assert.equal((await signed(first.url, key, { path: '/ping', nonce, ts })).status, 200);
  await first.d.close();
  const second = await startDaemon(t, { root, config: cfg, keysDir, key });
  const replay = await signed(second.url, key, { path: '/ping', nonce, ts });
  assert.equal(replay.status, 401); assert.equal(replay.json.reason, 'replayed_nonce');
  assert.equal((await signed(second.url, key, { path: '/ping' })).status, 200, 'fresh nonces still work');
  const info = (await signed(second.url, key, { path: '/info' })).json;
  assert.equal(info.nonces.journaled, true); assert.equal(info.nonces.journalError, null);
  // the journal is daemon state, outside the files API
  assert.equal((await signed(second.url, key, { path: '/files/state/nonces.log' })).status, 400);
});

test('F2: the nonce journal reloads unexpired entries, skips torn lines, compacts, and degrades to memory when unwritable', t => {
  const dir = scratch(t, 'journal');
  const file = path.join(dir, 'state', 'nonces.log');
  let now = 1_000_000;
  const a = new NonceCache({ ttlMs: 1000, now: () => now, file });
  const [n1, n2, n3] = ['aa', 'bb', 'cc'].map(x => x.repeat(16));
  assert.equal(a.add(n1, now), true); assert.equal(a.add(n2, now), true);
  fs.appendFileSync(file, `${now + 5000} ${'dd'.repeat(8)}`);   // a torn last line from a crash
  now += 500;
  const b = new NonceCache({ ttlMs: 1000, now: () => now, file });
  assert.equal(b.add(n1, now), false, 'replay refused after reload'); assert.equal(b.size, 2);
  assert.equal(b.add(n3, now), true);
  now += 700;   // n1, n2 expired; n3 not
  const c = new NonceCache({ ttlMs: 1000, now: () => now, file });
  assert.equal(c.size, 1); assert.equal(c.has(n3), true);
  assert.deepEqual(fs.readFileSync(file, 'utf8').trim().split('\n').map(l => l.split(' ')[1]), [n3], 'compacted to the live entries');
  // a journal that cannot be written: reported once, the cache still refuses replays in memory
  const errors = [];
  const blocker = path.join(dir, 'not-a-dir'); fs.writeFileSync(blocker, '');
  const d = new NonceCache({ ttlMs: 1000, now: () => now, file: path.join(blocker, 'nonces.log'), onError: e => errors.push(e.message) });
  assert.equal(d.add(n1, now), true); assert.equal(d.add(n1, now), false);
  assert.ok(errors.length >= 1); assert.ok(d.journal.error);
});

// ---- F3: resource exhaustion by an authenticated caller -------------------------------------------

test('F3: the GPU queue is capped (429), also under concurrent submissions', async t => {
  const { jm, data } = await manager(t, { limits: { maxQueued: 2 } });
  const a = await jm.submit('kev.train', { dataset: data('slow.jsonl') });
  await waitFor(() => jm.get(a.id).state === 'running', { what: 'a running' });
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => jm.submit('sys.selftest', {})));
  const ok = results.filter(r => r.status === 'fulfilled');
  const refused = results.filter(r => r.status === 'rejected');
  assert.equal(ok.length, 2, 'exactly the cap is admitted');
  assert.ok(refused.every(r => r.reason.status === 429 && r.reason.code === 'queue_full'));
  assert.equal(jm.queue().queued.length, 2);
  assert.equal(jm.recordCount, 3, 'refused submissions leave no record');
  await jm.cancel(a.id);
});

test('F3: finished job records and their logs are pruned to limits.maxJobRecords; successful kev.train records are kept', async t => {
  const { jm, cfg, data } = await manager(t, { limits: { maxJobRecords: 3 } });
  const tr = await jm.submit('kev.train', { dataset: data('t.jsonl') });
  assert.equal((await done(jm, tr.id)).state, 'succeeded');
  const ids = [];
  for (let i = 0; i < 6; i++) { const j = await jm.submit('sys.selftest', {}); ids.push(j.id); await done(jm, j.id); }
  await waitFor(() => jm.recordCount === 4, { what: 'pruning' });
  assert.ok(jm.get(tr.id), 'the trained run keeps its provenance record');
  for (const id of ids.slice(0, 3)) {
    assert.equal(jm.get(id), null, `${id} pruned`);
    assert.equal(fs.existsSync(path.join(cfg.workdir, 'jobs', `${id}.json`)), false);
    assert.equal(fs.existsSync(path.join(cfg.workdir, 'logs', `${id}.log`)), false);
  }
  for (const id of ids.slice(3)) assert.ok(jm.get(id), `${id} kept`);
  assert.equal(fs.readdirSync(path.join(cfg.workdir, 'jobs')).filter(n => n.endsWith('.json')).length, 4);
  // pruning also runs at start-up
  const jm2 = new JobManager({ config: normalizeConfig({ ...cfg, limits: { ...cfg.limits, maxJobRecords: 1 } }), workdir: cfg.workdir });
  await jm2.init();
  assert.equal(jm2.recordCount, 2); assert.ok(jm2.get(tr.id)); assert.ok(jm2.get(ids[5]));
});

test('F3: uploads and new jobs are refused with 507 when the workdir disk is nearly full', async t => {
  const root = scratch(t, 'disk');
  const { url, key, cfg } = await startDaemon(t, { root, config: testConfig(root, { limits: { minFreeMiB: 2 ** 30 } }) });   // 1 PiB free required
  const up = await signed(url, key, { method: 'PUT', path: '/files/data/x.bin', body: 'x'.repeat(1000) });
  assert.equal(up.status, 507); assert.equal(up.json.error, 'insufficient_storage');
  assert.deepEqual(fs.readdirSync(path.join(cfg.workdir, 'data')), [], 'nothing written, no temp file left');
  const job = await signed(url, key, { method: 'POST', path: '/jobs', body: JSON.stringify({ kind: 'sys.selftest', params: {} }) });
  assert.equal(job.status, 507);
  // the free-space probe is injectable for the job manager
  const { jm } = await manager(t, {}, { diskFree: async () => ({ freeBytes: 1024 }) });
  await assert.rejects(jm.submit('sys.selftest', {}), e => e.status === 507);
});

test('F3: a job whose log grows past limits.jobLogBytes is stopped and marked failed', async t => {
  const { jm, data } = await manager(t, { limits: { jobLogBytes: 600 } }, { logWatchMs: 50 });
  const j = await jm.submit('kev.train', { dataset: data('slow.jsonl') });
  const end = await done(jm, j.id);
  assert.equal(end.state, 'failed'); assert.match(end.error, /log grew past 600 bytes/);
});

test('F3: concurrent service submissions cannot exceed the one-kev.serve and port limits', async t => {
  const { jm } = await manager(t);
  const rs = await Promise.allSettled([8096, 8097, 8098].map(port => jm.submit('kev.serve', { port })));
  assert.equal(rs.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(rs.filter(r => r.status === 'rejected').every(r => r.reason.status === 409));
  assert.equal(jm.services().length, 1);
  const id = rs.find(r => r.status === 'fulfilled').value.id;
  await jm.cancel(id); await done(jm, id);
});

// ---- F4: git work on the mailbox clone is serialized ----------------------------------------------

test('F4: git.refresh jobs coalesce: one runs, at most one waits, refreshes never overlap', async t => {
  let calls = 0, running = 0, maxRunning = 0;
  const refresh = async () => { calls++; running++; maxRunning = Math.max(maxRunning, running); await sleep(150); running--; return { n: calls }; };
  const { jm } = await manager(t, {}, { refresh });
  const jobs = await Promise.all(Array.from({ length: 10 }, () => jm.submit('git.refresh', {})));
  const ids = [...new Set(jobs.map(j => j.id))];
  assert.equal(ids.length, 2, 'one running and one waiting job; the rest joined the waiting one');
  assert.equal(jobs.filter(j => j.coalesced).length, 8);
  for (const id of ids) assert.equal((await done(jm, id)).state, 'succeeded');
  assert.equal(calls, 2); assert.equal(maxRunning, 1);
  assert.equal(jm.recordCount, 2, 'no orphaned queued records');
});

test('F4: the daemon coalesces refresh callers (publisher ticks, git.refresh) onto one mailbox snapshot at a time', async t => {
  const root = scratch(t, 'coalesce');
  const k = testKey();
  let calls = 0, running = 0, maxRunning = 0;
  const mailbox = { snapshot: async () => { calls++; running++; maxRunning = Math.max(maxRunning, running); await sleep(100); running--; return { head: 'f'.repeat(40), keys: [{ id: k.keyId, file: 'x.pub', publicKey: k.publicKey }], errors: [], killed: false, endpointRaw: null }; } };
  const d = await createDaemon({ config: testConfig(root), mailbox, publish: false, log: () => {} });
  defer(t, () => d.close());
  assert.equal(calls, 1, 'initial refresh');
  await Promise.all(Array.from({ length: 10 }, () => d.refresh()));
  assert.ok(calls <= 3, `at most one running and one queued snapshot (${calls - 1} for 10 callers)`);
  assert.equal(maxRunning, 1);
  assert.equal((await signed(d.url, k, { path: '/ping' })).status, 200);
});

test('F4: two Mailbox instances on one clone never run git concurrently; stale git locks are cleared', async t => {
  const root = scratch(t, 'mblock');
  const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const remote = path.join(root, 'remote.git');
  assert.equal((await runGit(['init', '--quiet', '--bare', remote], { cwd: root, env: ENV })).code, 0);
  await initMailbox({ remote, keys: [], scratch: root, env: ENV });
  const dir = path.join(root, 'clone');
  const a = new Mailbox({ dir, remote, env: ENV });
  const b = new Mailbox({ dir, remote, env: ENV });   // e.g. `daemon --check` next to the running daemon
  await a.refresh();
  // a git process killed on timeout leaves .git/index.lock behind; under the mailbox lock it is stale
  const lock = path.join(dir, '.git', 'index.lock');
  fs.writeFileSync(lock, ''); const old = new Date(Date.now() - 60_000); fs.utimesSync(lock, old, old);
  const ops = [];
  for (let i = 0; i < 4; i++) {
    ops.push(a.publishEndpoint(buildEndpoint({ url: `https://a${i}.trycloudflare.com`, daemonVersion: 'x', startedAt: 's', heartbeatAt: `a${i}` }), { baseDelayMs: 10 }));
    ops.push(b.snapshot());
    ops.push(b.publishEndpoint(buildEndpoint({ url: `https://b${i}.trycloudflare.com`, daemonVersion: 'x', startedAt: 's', heartbeatAt: `b${i}` }), { baseDelayMs: 10 }));
  }
  const rs = await Promise.allSettled(ops);
  assert.deepEqual(rs.filter(r => r.status === 'rejected').map(r => r.reason.message), []);
  assert.equal(fs.existsSync(lock), false);
  assert.equal(fs.existsSync(`${dir}.lock`), false, 'the mailbox lock file is released');
  const st = await runGit(['status', '--porcelain'], { cwd: dir, env: ENV });
  assert.equal(st.stdout, '', 'the clone is clean');
  const log = await runGit(['log', '--format=%s', 'foundry-bridge'], { cwd: remote, env: ENV });
  assert.equal(log.stdout.trim().split('\n').length, 1 + 8, 'every publish landed, linearly');
});

test('F4: the mailbox lock file waits for a live holder, times out with MAILBOX_BUSY, and takes over from a dead one', async t => {
  const root = scratch(t, 'lockfile');
  const file = path.join(root, 'mailbox.lock');
  // a live holder in another process
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireLockFile } from ${JSON.stringify(path.join(HERE, '..', 'mailbox.mjs'))};
    const l = await acquireLockFile(${JSON.stringify(file)});
    process.stdout.write('held\\n');
    setTimeout(() => { l.release(); process.exit(0); }, 600);`], { stdio: ['ignore', 'pipe', 'inherit'] });
  defer(t, () => holder.kill());
  await new Promise(r => holder.stdout.once('data', r));
  await assert.rejects(acquireLockFile(file, { timeoutMs: 150 }), e => e.code === 'MAILBOX_BUSY');
  const t0 = Date.now();
  const mine = await acquireLockFile(file, { timeoutMs: 10_000 });
  assert.ok(Date.now() - t0 >= 200, 'waited for the holder');
  mine.release();
  assert.equal(fs.existsSync(file), false);
  // a holder that died without releasing (same host, pid gone)
  const dead = spawn(process.execPath, ['-e', '']); await new Promise(r => dead.on('exit', r));
  fs.writeFileSync(file, JSON.stringify({ pid: dead.pid, host: os.hostname(), token: 'deadbeefdeadbeef', at: new Date().toISOString() }));
  const logs = [];
  const taken = await acquireLockFile(file, { timeoutMs: 2000, log: m => logs.push(m) });
  assert.match(logs.join('\n'), /took over the lock of a dead holder/);
  taken.release();
});

// ---- F5: verify before reading the body -----------------------------------------------------------

test('F5: a trusted key id with a bad signature is refused before any body byte is read', async t => {
  const { url, key, cfg } = await startDaemon(t);
  const base = () => ({ [H.key]: key.keyId, [H.ts]: String(Date.now()), [H.nonce]: newNonce(), [H.sig]: Buffer.alloc(64, 1).toString('base64'), 'content-type': 'application/json' });
  // announced hash: verified against it before reading (900 KB declared, nothing sent)
  let r = await headOnly(url, { path: '/jobs', headers: { ...base(), [H.bodySha]: sha256hex('x'), 'content-length': String(900_000) } });
  assert.equal(r.status, 401); assert.equal(r.json.reason, 'bad_signature');
  // same for the proxy routes
  r = await headOnly(url, { path: '/svc/kev/v1/systemone', headers: { ...base(), [H.bodySha]: sha256hex('x'), 'content-length': String(900_000) } });
  assert.equal(r.status, 401);
  // no announced hash: only a small body may be read before the signature check
  r = await headOnly(url, { path: '/jobs', headers: { ...base(), 'content-length': String(cfg.limits.unannouncedBodyBytes + 1) } });
  assert.equal(r.status, 413); assert.equal(r.json.reason, 'body_hash_required');
  // uploads must announce (unchanged), and the bad signature is caught before the upload is read
  r = await headOnly(url, { method: 'PUT', path: '/files/data/big.bin', headers: { ...base(), [H.bodySha]: sha256hex('x'), 'content-length': String(50_000_000) } });
  assert.equal(r.status, 401);
  assert.deepEqual(fs.readdirSync(path.join(cfg.workdir, 'data')), []);
  // a small unannounced body from an older client still works
  const ok = await signed(url, key, { method: 'POST', path: '/jobs', body: JSON.stringify({ kind: 'git.refresh', params: {} }), announce: false });
  assert.equal(ok.status, 202, ok.text);
});

// ---- e2e report follow-ups ------------------------------------------------------------------------

function run(cmd, args, env) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { env });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ code, out, err }));
  });
}

test('e2e: a missing --config is an error, never a silent fallback to built-in defaults', async t => {
  const home = scratch(t, 'noconfig');
  fs.mkdirSync(path.join(home, 'keys'));
  const env = { PATH: process.env.PATH, HOME: home };
  for (const extra of [[], ['--check']]) {
    const r = await run(process.execPath, [DAEMON, '--config', path.join(home, 'typo', 'bridge-config.json'), '--keys-dir', path.join(home, 'keys'), ...extra], env);
    assert.equal(r.code, 2, r.out + r.err); assert.match(r.err, /config .* not found/);
  }
  const r = await run(process.execPath, [DAEMON, '--keys-dir', path.join(home, 'keys')], env);   // default path, absent
  assert.equal(r.code, 2); assert.match(r.err, /not found/);
  assert.deepEqual(fs.readdirSync(home), ['keys'], 'no default workdir was created');
});

test('e2e: a download the client abandons is logged as client_closed, not as an internal error', async t => {
  const { url, key, cfg, logs } = await startDaemon(t);
  fs.writeFileSync(path.join(cfg.workdir, 'data', 'big.bin'), crypto.randomBytes(8 << 20));
  const { signRequest } = await import('../common/protocol.mjs');
  const h = signRequest({ privateKey: key.privateKey, keyId: key.keyId, method: 'GET', path: '/files/data/big.bin', body: '' });
  await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.get({ host: u.hostname, port: u.port, path: '/files/data/big.bin', headers: h, agent: false }, res => {
      assert.equal(res.statusCode, 200);
      res.once('data', () => { req.destroy(); resolve(); });
    });
    req.on('error', e => { if (e.code !== 'ECONNRESET') reject(e); });
  });
  const accessLog = path.join(cfg.workdir, 'logs', 'bridge-access.log');
  const rec = await waitFor(() => { try { return fs.readFileSync(accessLog, 'utf8').trim().split('\n').map(l => JSON.parse(l)).find(x => x.path === '/files/data/big.bin'); } catch { return null; } }, { what: 'access log line' });
  assert.ok(['client_closed', 'connection_closed'].includes(rec.reason), JSON.stringify(rec));
  await sleep(200);
  assert.deepEqual(logs.filter(l => /internal error/.test(l)), []);
});

test('e2e: Cloudflare edge answers are explained; connect refusals for a fresh hostname are retried briefly', async t => {
  assert.match(explainHttp(530, 'error code: 1033'), /no cloudflared is connected/);
  assert.match(explainHttp(502, '<html>Bad gateway</html>'), /could not reach the daemon/);
  assert.match(explainHttp(524, 'error code: 524'), /longer than about 100 s/);
  assert.equal(explainHttp(502, '{"error":"service_not_running","message":"no running kev service"}'), null, 'daemon answers are not reinterpreted');
  assert.equal(retryableConnectError({ phase: 'connect', code: 'PROXY_REFUSED', status: 502 }), true);
  assert.equal(retryableConnectError({ phase: 'connect', code: 'PROXY_DENIED', status: 403 }), false);
  assert.equal(retryableConnectError({ code: 'REQUEST_FAILED' }), false, 'a request that may have been sent is never retried');
  const key = generateKeyPair();
  const refused = () => Object.assign(new Error('proxy refused CONNECT x:443: 502'), { code: 'PROXY_REFUSED', status: 502, phase: 'connect' });
  const answer = () => ({ status: 200, statusText: 'OK', headers: {}, rawHeaders: [], body: Readable.from([Buffer.from('{"ok":true,"version":"v"}')]) });
  let calls = 0;
  const c1 = new BridgeClient({ endpoint: 'https://fresh-name.trycloudflare.com', key, transport: async () => { if (++calls < 3) throw refused(); return answer(); } });
  assert.equal((await c1.health()).ok, true); assert.equal(calls, 3);
  calls = 0;
  const c2 = new BridgeClient({ endpoint: 'https://fresh-name.trycloudflare.com', key, transport: async () => { calls++; throw refused(); }, connectRetryMs: 0 });
  await assert.rejects(c2.health(), /brand-new trycloudflare hostname/); assert.equal(calls, 1);
  // the CLI prints the explanation for a tunnel whose cloudflared is gone
  const edge = http.createServer((req, res) => { res.writeHead(530, { 'content-type': 'text/plain' }); res.end('error code: 1033'); });
  await new Promise(r => edge.listen(0, '127.0.0.1', r));
  defer(t, () => new Promise(r => edge.close(r)));
  const keyFile = path.join(scratch(t, 'clikey'), 'k.pem');
  fs.writeFileSync(keyFile, key.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const r = await run(process.execPath, [CLI, 'ping', '--endpoint', `http://127.0.0.1:${edge.address().port}`, '--key', keyFile], { PATH: process.env.PATH, HOME: path.dirname(keyFile) });
  fs.rmSync(keyFile);
  assert.equal(r.code, 1); assert.match(r.err, /530/); assert.match(r.err, /no cloudflared is connected/);
});

test('e2e: streaming requests are refused locally for quick-tunnel endpoints (Cloudflare quick tunnels do not carry SSE)', async t => {
  const key = generateKeyPair();
  let sent = 0;
  const transport = async () => { sent++; return { status: 200, statusText: 'OK', headers: {}, rawHeaders: [], body: Readable.from([Buffer.from('{}')]) }; };
  const quick = new BridgeClient({ endpoint: 'https://abc-def.trycloudflare.com', key, transport });
  await assert.rejects(quick.bridgeFetch('/svc/llm/q/v1/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [], stream: true }) }), /stream:false/);
  await assert.rejects(quick.bridgeFetch('/svc/llm/q/v1/chat/completions', { method: 'POST', headers: { accept: 'text/event-stream' }, body: '{}' }), /stream:false/);
  assert.equal(sent, 0, 'nothing was sent');
  assert.equal((await quick.bridgeFetch('/svc/llm/q/v1/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [], stream: false }) })).status, 200);
  const named = new BridgeClient({ endpoint: 'https://bridge.example.com', key, transport });
  assert.equal((await named.bridgeFetch('/svc/llm/q/v1/chat/completions', { method: 'POST', body: JSON.stringify({ stream: true }) })).status, 200, 'other hosts may stream');
  void raw; void plantTrainedRun;
});

test('e2e: endpoint.json follows cloudflared readiness (0 edge connections means 530 for the cloud), at most once a minute', async t => {
  let now = 1_000_000, ready = 0;
  const published = [];
  const p = new Publisher({
    mailbox: { publishEndpoint: async ep => { published.push(ep); return { head: 'a'.repeat(40), pushed: true }; } },
    refresh: async () => ({}), snapshot: async () => ({ gpu: null, services: [], tunnelReadyConnections: ready }),
    discoverTunnel: async () => ({ url: 'https://fresh-name.trycloudflare.com', source: 'cloudflared-metrics' }), tunnelReady: async () => ready,
    pollMs: 20, now: () => now, daemonVersion: 'v', startedAt: 's'
  }).start();
  defer(t, () => p.stop({ timeoutMs: 1000 }));
  await waitFor(() => published.length === 1, { what: 'first publish' });
  assert.equal(published[0].tunnelReadyConnections, 0);
  ready = 4;
  await sleep(150);
  assert.equal(published.length, 1, 'not within a minute of the last publish');
  now += 61_000;
  await waitFor(() => published.length === 2, { what: 'readiness republish' });
  assert.equal(published[1].tunnelReadyConnections, 4);
  ready = 2; now += 61_000;
  await sleep(150);
  assert.equal(published.length, 2, 'a count change that keeps the tunnel up is left for the heartbeat');
});

