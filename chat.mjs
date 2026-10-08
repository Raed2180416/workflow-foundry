#!/usr/bin/env node
// foundry-chat: a durable message channel between the cloud session and the laptop GPU worker.
//
// Messages are JSON files on the `foundry-chat` branch of the private repo:
//   to-laptop/<createdAt>-<from>-<id>.json      to-cloud/<createdAt>-<from>-<id>.json
// Nothing depends on Claude session ids, tunnels or either side being online: a message waits in
// git until the other side reads it. Cloud messages are signed with the cloud's bridge key
// (Ed25519, the same key the bridge daemon trusts); the reader verifies them against the public
// keys on the `foundry-bridge` branch (bridge-state/keys/*.pub), so a revoked key stops verifying.
//
// Usage (node >= 20, no dependencies):
//   chat.mjs send  --from cloud|laptop --to laptop|cloud [--subject S] [--reply-to ID]
//                  [--body TEXT | --body-file F | stdin] [--key PEM]   (cloud signs by default)
//   chat.mjs inbox --for laptop|cloud [--peek] [--json]   new messages since the last inbox call
//   chat.mjs log   [--for laptop|cloud] [-n 20]           recent messages, both directions
//   chat.mjs watch --for laptop|cloud --out FILE [--interval 45]   append new messages as JSON lines
// Common options: --dir (local clone, default ~/.foundry-bridge/chat),
//   --remote URL (default: FOUNDRY_CHAT_REMOTE, else `origin` of the repo in the current directory,
//   else of ~/workflow-foundry).
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCHEMA = 'foundry-chat/1';
const BRANCH = process.env.FOUNDRY_CHAT_BRANCH ?? 'foundry-chat';
const KEYS_BRANCH = process.env.FOUNDRY_BRIDGE_BRANCH ?? 'foundry-bridge';
const KEYS_DIR = 'bridge-state/keys';
const PARTIES = ['cloud', 'laptop'];
const HOME = path.join(os.homedir(), '.foundry-bridge');
const DEFAULT_KEY = process.env.FOUNDRY_BRIDGE_KEY ?? path.join(HOME, 'cloud-ed25519.pem');
const MAX_BODY = 256 * 1024;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const die = (msg, code = 1) => { process.stderr.write(`chat: ${msg}\n`); process.exit(code); };

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--peek' || a === '--json') o[a.slice(2)] = true;
    else if (a.startsWith('--') || a === '-n') { o[a.replace(/^-+/, '')] = argv[++i]; if (o[a.replace(/^-+/, '')] === undefined) die(`${a} needs a value`, 2); }
    else o._.push(a);
  }
  return o;
}

function git(args, { cwd, allowFail = false } = {}) {
  const r = spawnSync('git', ['-c', 'user.name=foundry-chat', '-c', 'user.email=foundry-chat@localhost', ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 120_000 });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.error?.message || '').trim().split('\n').slice(-3).join(' | ')}`);
  return { ok: r.status === 0, out: (r.stdout || '').trim() };
}

function defaultRemote() {
  if (process.env.FOUNDRY_CHAT_REMOTE) return process.env.FOUNDRY_CHAT_REMOTE;
  for (const cwd of [process.cwd(), path.join(os.homedir(), 'workflow-foundry')]) {
    const r = git(['remote', 'get-url', 'origin'], { cwd, allowFail: true });
    if (r.ok && r.out) return r.out;
  }
  die('no remote: pass --remote or set FOUNDRY_CHAT_REMOTE', 2);
}

// The clone at `dir` belongs to this tool: it is always reset to the remote branch before use.
function sync(dir, remote) {
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(dir, { recursive: true });
    git(['init', '-q'], { cwd: dir });
    git(['remote', 'add', 'origin', remote], { cwd: dir });
  }
  git(['remote', 'set-url', 'origin', remote], { cwd: dir });
  const f = git(['fetch', '-q', 'origin', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`, `+refs/heads/${KEYS_BRANCH}:refs/remotes/origin/${KEYS_BRANCH}`], { cwd: dir, allowFail: true });
  const has = git(['rev-parse', '-q', '--verify', `refs/remotes/origin/${BRANCH}`], { cwd: dir, allowFail: true }).ok;
  if (!has) {
    if (!f.ok) git(['fetch', '-q', 'origin', `+refs/heads/${KEYS_BRANCH}:refs/remotes/origin/${KEYS_BRANCH}`], { cwd: dir, allowFail: true });
    return false;
  }
  git(['checkout', '-q', '-B', BRANCH, `refs/remotes/origin/${BRANCH}`], { cwd: dir });
  git(['reset', '-q', '--hard', `refs/remotes/origin/${BRANCH}`], { cwd: dir });
  git(['clean', '-qfd'], { cwd: dir });
  return true;
}

function trustedKeys(dir) {
  const keys = new Map();
  const ls = git(['ls-tree', '--name-only', `refs/remotes/origin/${KEYS_BRANCH}`, `${KEYS_DIR}/`], { cwd: dir, allowFail: true });
  if (!ls.ok) return keys;
  for (const f of ls.out.split('\n').filter((n) => n.endsWith('.pub'))) {
    try {
      const pem = git(['show', `refs/remotes/origin/${KEYS_BRANCH}:${f}`], { cwd: dir }).out;
      const pub = crypto.createPublicKey(pem);
      if (pub.asymmetricKeyType !== 'ed25519') continue;
      const id = sha256(Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url')).slice(0, 16);
      keys.set(id, pub);
    } catch { /* a bad key file never blocks the channel */ }
  }
  return keys;
}

const canonical = (m) => [SCHEMA, m.id, m.from, m.to, m.createdAt, sha256(m.subject ?? ''), sha256(m.body), m.replyTo ?? ''].join('\n');

function verify(m, keys) {
  if (!m.sig) return 'unsigned';
  const pub = keys.get(m.sig.keyId);
  if (!pub) return `unknown-key:${m.sig.keyId}`;
  try { return crypto.verify(null, Buffer.from(canonical(m)), pub, Buffer.from(m.sig.value, 'base64')) ? `verified:${m.sig.keyId}` : 'BAD-SIGNATURE'; }
  catch { return 'BAD-SIGNATURE'; }
}

function readMessages(dir, to) {
  const d = path.join(dir, `to-${to}`);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((n) => n.endsWith('.json')).sort().map((name) => {
    try { return { name, m: JSON.parse(fs.readFileSync(path.join(d, name), 'utf8')) }; }
    catch (e) { return { name, m: null, error: e.message }; }
  });
}

function initBranch(dir) {
  git(['symbolic-ref', 'HEAD', `refs/heads/${BRANCH}`], { cwd: dir });
  git(['update-ref', '-d', `refs/heads/${BRANCH}`], { cwd: dir, allowFail: true });   // a failed earlier attempt
  git(['rm', '-rqf', '--ignore-unmatch', '.'], { cwd: dir });
  git(['clean', '-qfd'], { cwd: dir });
  for (const p of PARTIES) { fs.mkdirSync(path.join(dir, `to-${p}`), { recursive: true }); fs.writeFileSync(path.join(dir, `to-${p}`, '.keep'), ''); }
  fs.copyFileSync(new URL(import.meta.url), path.join(dir, 'chat.mjs'));
  const readme = path.join(path.dirname(new URL(import.meta.url).pathname), 'CHAT-README.md');
  if (fs.existsSync(readme)) fs.copyFileSync(readme, path.join(dir, 'README.md'));
  git(['add', '-A'], { cwd: dir });
  git(['commit', '-qm', 'foundry-chat: create the channel'], { cwd: dir });
}

function send(o, dir, remote) {
  const from = o.from, to = o.to;
  if (!PARTIES.includes(from) || !PARTIES.includes(to) || from === to) die('--from and --to must be cloud and laptop', 2);
  const body = o.body ?? (o['body-file'] ? fs.readFileSync(o['body-file'], 'utf8') : fs.readFileSync(0, 'utf8'));
  if (!body.trim()) die('empty body', 2);
  if (Buffer.byteLength(body) > MAX_BODY) die(`body larger than ${MAX_BODY} bytes`, 2);
  const createdAt = new Date().toISOString();
  const m = { schema: SCHEMA, id: crypto.randomBytes(8).toString('hex'), from, to, createdAt, ...(o.subject ? { subject: o.subject } : {}), ...(o['reply-to'] ? { replyTo: o['reply-to'] } : {}), body };
  const keyPath = o.key ?? (from === 'cloud' && fs.existsSync(DEFAULT_KEY) ? DEFAULT_KEY : null);
  if (keyPath) {
    const priv = crypto.createPrivateKey(fs.readFileSync(keyPath, 'utf8'));
    const keyId = sha256(Buffer.from(crypto.createPublicKey(priv).export({ format: 'jwk' }).x, 'base64url')).slice(0, 16);
    m.sig = { alg: 'ed25519', keyId, value: crypto.sign(null, Buffer.from(canonical(m)), priv).toString('base64') };
  }
  const rel = `to-${to}/${createdAt.replace(/[-:.]/g, '')}-${from}-${m.id}.json`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    if (!sync(dir, remote)) initBranch(dir);
    fs.mkdirSync(path.join(dir, `to-${to}`), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify(m, null, 2) + '\n');
    git(['add', rel], { cwd: dir });
    git(['commit', '-qm', `${from} -> ${to}: ${(o.subject ?? body).split('\n')[0].slice(0, 60)}`], { cwd: dir });
    if (git(['push', '-q', 'origin', `HEAD:refs/heads/${BRANCH}`], { cwd: dir, allowFail: true }).ok) {
      console.log(JSON.stringify({ sent: rel, id: m.id, signed: m.sig?.keyId ?? null, commit: git(['rev-parse', '--short', 'HEAD'], { cwd: dir }).out }));
      return;
    }
    spawnSync('sleep', [String(attempt * 2)]);
  }
  die('push failed 6 times (see git credentials); message not sent');
}

function stateFile(who) { fs.mkdirSync(path.join(HOME, 'chat-state'), { recursive: true }); return path.join(HOME, 'chat-state', `seen-${who}.txt`); }

function collectNew(o, dir, remote) {
  const who = o.for;
  if (!PARTIES.includes(who)) die('--for must be cloud or laptop', 2);
  if (!sync(dir, remote)) return [];
  const keys = trustedKeys(dir);
  const sf = stateFile(who);
  const seen = new Set(fs.existsSync(sf) ? fs.readFileSync(sf, 'utf8').split('\n').filter(Boolean) : []);
  const fresh = readMessages(dir, who).filter((x) => !seen.has(x.name));
  const out = fresh.map(({ name, m, error }) => m
    ? { file: `to-${who}/${name}`, id: m.id, from: m.from, createdAt: m.createdAt, subject: m.subject ?? null, replyTo: m.replyTo ?? null, auth: verify(m, keys), body: m.body }
    : { file: `to-${who}/${name}`, auth: 'UNREADABLE', error });
  if (!o.peek && fresh.length) fs.appendFileSync(sf, fresh.map((x) => x.name).join('\n') + '\n');
  return out;
}

function show(list, json) {
  for (const x of list) {
    if (json) { console.log(JSON.stringify(x)); continue; }
    console.log(`--- ${x.file}\nfrom ${x.from}  at ${x.createdAt}  auth ${x.auth}${x.subject ? `\nsubject: ${x.subject}` : ''}${x.replyTo ? `\nreply-to: ${x.replyTo}` : ''}\n\n${x.body ?? x.error}\n`);
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const cmd = o._[0];
  const dir = path.resolve(o.dir ?? process.env.FOUNDRY_CHAT_DIR ?? path.join(HOME, 'chat'));
  const remote = o.remote ?? defaultRemote();
  if (cmd === 'send') return send(o, dir, remote);
  if (cmd === 'inbox') { const l = collectNew(o, dir, remote); if (!l.length && !o.json) console.log('(no new messages)'); return show(l, o.json); }
  if (cmd === 'log') {
    if (!sync(dir, remote)) return console.log('(channel not created yet)');
    const keys = trustedKeys(dir);
    const all = PARTIES.filter((p) => !o.for || p === o.for).flatMap((p) => readMessages(dir, p).map((x) => ({ ...x, p })));
    all.sort((a, b) => a.name.localeCompare(b.name));
    return show(all.slice(-Number(o.n ?? 20)).map(({ name, m, p, error }) => m ? { file: `to-${p}/${name}`, ...m, sig: undefined, auth: verify(m, keys) } : { file: `to-${p}/${name}`, auth: 'UNREADABLE', error }), o.json);
  }
  if (cmd === 'watch') {
    if (!o.out) die('watch needs --out FILE', 2);
    const interval = Math.max(15, Number(o.interval ?? 45)) * 1000;
    const hb = path.join(HOME, 'chat-state', `watch-${o.for}.heartbeat`);
    for (;;) {
      try {
        for (const x of collectNew(o, dir, remote)) {
          const line = JSON.stringify({ receivedAt: new Date().toISOString(), ...x });
          fs.appendFileSync(o.out, line + '\n');
          console.log(`new message ${x.file} from ${x.from} (${x.auth})`);
        }
        fs.writeFileSync(hb, new Date().toISOString() + '\n');
      } catch (e) { console.error(`[${new Date().toISOString()}] watch error: ${e.message}`); }
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  die('usage: chat.mjs send|inbox|log|watch ... (see the header of this file)', 2);
}

main().catch((e) => die(e.message));
