#!/usr/bin/env node
// Cloud CLI for the Foundry laptop bridge (bridge/PROTOCOL.md).
//
//   node bridge/cloud/cli.mjs keygen [--pub FILE] [--force]
//   node bridge/cloud/cli.mjs discover
//   node bridge/cloud/cli.mjs ping | info | jobs
//   node bridge/cloud/cli.mjs selftest [--timeout S]
//   node bridge/cloud/cli.mjs put <local-file> <data/...> [--overwrite]          (runs/ and logs/ are daemon-written)
//   node bridge/cloud/cli.mjs get <data/...|runs/...|logs/...> <dest> [--dir]
//   node bridge/cloud/cli.mjs ls [<dir>] [--recursive]
//   node bridge/cloud/cli.mjs job <kind> [--params JSON] [key=value ...]   e.g. job kev.train dataset=data/t.jsonl epochs=2 extra.max_steps=50
//   node bridge/cloud/cli.mjs wait <job-id> [--timeout S] [--poll MS] [--quiet]
//   node bridge/cloud/cli.mjs log <job-id> [--offset N] [--follow]
//   node bridge/cloud/cli.mjs cancel <job-id>
//   node bridge/cloud/cli.mjs req <METHOD> <path> [--data JSON|@file]       raw signed request, e.g. req POST /svc/kev/v1/systemone --data @q.json
//
// Global: --endpoint URL (or FOUNDRY_BRIDGE_URL; default: discover from the mailbox branch),
//         --key FILE (or FOUNDRY_BRIDGE_KEY; default ~/.foundry-bridge/cloud-ed25519.pem), --json.
// Exit codes: 0 ok, 1 error, 2 usage, 3 job ended unsuccessfully.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeClient, BridgeError, DEFAULT_KEY_PATH, discover, keygen, loadKey } from './client.mjs';
import { readAll } from './transport.mjs';

const BOOL = new Set(['--force', '--json', '--overwrite', '--follow', '--quiet', '--recursive', '--dir']);

function parse(argv) {
  const pos = []; const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BOOL.has(a)) o[a.slice(2)] = true;
    else if (a.startsWith('--')) { const v = argv[++i]; if (v === undefined) usage(`${a} needs a value`); o[a.slice(2)] = v; }
    else pos.push(a);
  }
  return { pos, o };
}

function usage(msg) {
  if (msg) process.stderr.write(`${msg}\n\n`);
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1);
  const text = lines.slice(0, lines.findIndex(l => !l.startsWith('//'))).map(l => l.replace(/^\/\/ ?/, '')).join('\n');
  process.stderr.write(`${text}\n`);
  process.exit(2);
}

function out(o, value, text) {
  if (o.json || text === undefined) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${text}\n`);
}

function parseValue(v) { try { return JSON.parse(v); } catch { return v; } }
function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) { if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}; cur = cur[k]; }
  cur[keys[keys.length - 1]] = value;
}

async function client(o) {
  const keyPath = o.key ?? process.env.FOUNDRY_BRIDGE_KEY ?? DEFAULT_KEY_PATH;
  let endpoint = o.endpoint ?? process.env.FOUNDRY_BRIDGE_URL;
  if (!endpoint) {
    const d = await discover();
    if (!d.url) throw new Error(`no usable endpoint in the mailbox: ${d.errors.join('; ')}`);
    if (d.stale) process.stderr.write(`warning: endpoint heartbeat is ${Math.round(d.ageMs / 60000)} min old; the laptop may be asleep or offline\n`);
    endpoint = d.url;
  }
  return new BridgeClient({ endpoint, key: loadKey(keyPath) });
}

async function cmdWait(c, id, o) {
  const job = await c.waitJob(id, {
    pollMs: Number(o.poll ?? 2000), timeoutMs: Number(o.timeout ?? 6 * 3600) * 1000,
    onLog: o.quiet ? undefined : text => process.stderr.write(text)
  });
  out(o, job, `${job.id} ${job.kind}: ${job.state}${job.exitCode !== null ? ` (exit ${job.exitCode})` : ''}${job.error ? ` - ${job.error}` : ''}${job.result ? `\nresult: ${JSON.stringify(job.result)}` : ''}${job.outputs ? `\noutputs: ${job.outputs.dir} (${job.outputs.files.length} files)` : ''}`);
  const ok = job.state === 'succeeded' || (job.class === 'service' && (job.state === 'running' || (job.state === 'stopped' && job.cancelRequested)));
  return ok ? 0 : 3;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') usage();
  const { pos, o } = parse(rest);
  switch (cmd) {
    case 'keygen': {
      const r = keygen({ privatePath: o.key ?? process.env.FOUNDRY_BRIDGE_KEY ?? DEFAULT_KEY_PATH, publicPath: o.pub, force: !!o.force });
      out(o, r, `key id ${r.keyId}\nprivate key: ${r.privatePath} (mode 0600; never share it)\npublic key:  ${r.publicPath}\nnext: node bridge/cloud/init-mailbox.mjs --pub ${r.publicPath}`);
      return 0;
    }
    case 'discover': {
      const d = await discover();
      const { endpoint } = d;
      out(o, d, `${d.url ?? '(no url)'}  state=${d.state ?? '-'}  heartbeat ${d.ageMs === null || d.ageMs === undefined ? '?' : `${Math.round(d.ageMs / 1000)} s ago`}${d.stale ? ' (STALE)' : ''}\nmailbox ${d.head?.slice(0, 8)}  keys [${d.keys.join(', ')}]${d.killed ? '  KILL SET' : ''}${d.errors?.length ? `\nproblems: ${d.errors.join('; ')}` : ''}${endpoint ? `\ndaemon ${endpoint.daemonVersion} since ${endpoint.startedAt}; gpu ${endpoint.gpu?.name ?? 'none'}; services ${JSON.stringify(endpoint.services ?? [])}` : ''}`);
      return d.ok && !d.stale ? 0 : 1;
    }
    case 'ping': {
      const c = await client(o);
      const h = await c.health();
      if (h.status !== 200) throw new Error(`GET /health -> ${h.status}: ${(h.raw ?? h.error ?? '').toString().slice(0, 200)}${h.hint ? `\n  hint: ${h.hint}` : ''}`);
      const p = await c.ping();
      out(o, { health: h, ping: p }, `health ${h.status} ok=${h.ok} version=${h.version} rtt=${h.rttMs} ms clock skew=${h.skewMs ?? '?'} ms\nsigned ping ok as key ${p.keyId} (daemon ${p.version}, ${p.protocol})`);
      return 0;
    }
    case 'info': { const c = await client(o); out(o, await c.info()); return 0; }
    case 'jobs': { const c = await client(o); out(o, await c.jobs()); return 0; }
    case 'ls': { const c = await client(o); const r = await c.list(pos[0] ?? '', { recursive: !!o.recursive }); out(o, r, r.entries.map(e => `${e.type.padEnd(7)} ${String(e.size ?? '').padStart(12)}  ${e.path}`).join('\n') || '(empty)'); return 0; }
    case 'selftest': {
      const c = await client(o);
      const job = await c.submitJob('sys.selftest', {});
      process.stderr.write(`submitted ${job.id}\n`);
      return cmdWait(c, job.id, { ...o, timeout: o.timeout ?? 900 });
    }
    case 'put': {
      if (pos.length !== 2) usage('put <local-file> <data/...>');
      const c = await client(o);
      const r = await c.upload(pos[0], pos[1], { overwrite: !!o.overwrite });
      out(o, r, `${r.path} ${r.size} bytes sha256 ${r.sha256}`);
      return 0;
    }
    case 'get': {
      if (pos.length !== 2) usage('get <remote> <dest>');
      const c = await client(o);
      const r = o.dir ? await c.downloadDir(pos[0], pos[1]) : await c.download(pos[0], pos[1]);
      out(o, r, o.dir ? `${r.files.length} files -> ${pos[1]}${r.truncated ? ' (listing truncated)' : ''}` : `${r.dest} ${r.size} bytes sha256 ${r.sha256} (verified)`);
      return 0;
    }
    case 'job': {
      if (pos.length < 1) usage('job <kind> [--params JSON] [key=value ...]');
      const params = o.params ? JSON.parse(o.params.startsWith('@') ? fs.readFileSync(o.params.slice(1), 'utf8') : o.params) : {};
      for (const kv of pos.slice(1)) { const i = kv.indexOf('='); if (i < 1) usage(`bad parameter ${kv} (use key=value)`); setPath(params, kv.slice(0, i), parseValue(kv.slice(i + 1))); }
      const c = await client(o);
      const job = await c.submitJob(pos[0], params);
      out(o, job, `${job.id} ${job.kind} ${job.state}`);
      return 0;
    }
    case 'wait': { if (pos.length !== 1) usage('wait <job-id>'); return cmdWait(await client(o), pos[0], o); }
    case 'log': {
      if (pos.length !== 1) usage('log <job-id>');
      const c = await client(o);
      let offset = Number(o.offset ?? 0);
      for (;;) {
        const r = await c.log(pos[0], offset);
        process.stdout.write(r.data);
        offset = r.nextOffset;
        if (!o.follow || r.done) break;
        if (r.nextOffset >= r.size) await new Promise(res => setTimeout(res, 2000));
      }
      return 0;
    }
    case 'cancel': { if (pos.length !== 1) usage('cancel <job-id>'); const c = await client(o); const j = await c.cancel(pos[0]); out(o, j, `${j.id} ${j.state}${j.cancelRequested ? ' (cancel requested)' : ''}`); return 0; }
    case 'req': {
      if (pos.length !== 2) usage('req <METHOD> <path> [--data JSON|@file]');
      const c = await client(o);
      const data = o.data === undefined ? undefined : o.data.startsWith('@') ? fs.readFileSync(path.resolve(o.data.slice(1))) : o.data;
      const res = await c.signed(pos[0], pos[1], { body: data, headers: data !== undefined ? { 'content-type': 'application/json' } : {} });
      const text = (await readAll(res.body)).toString('utf8');
      process.stderr.write(`HTTP ${res.status}\n`);
      process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
      return res.status >= 200 && res.status < 300 ? 0 : 1;
    }
    default: usage(`unknown command ${cmd}`);
  }
}

main().then(code => process.exit(code ?? 0), error => {
  const msg = error instanceof BridgeError ? error.message : `${error.code ? `${error.code}: ` : ''}${error.message}`;
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
});
