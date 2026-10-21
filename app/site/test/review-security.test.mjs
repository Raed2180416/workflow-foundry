// Regression tests for the security review of 2026-10-21 (onboarding workflow, review:security; findings H1-H3, M4-M7, L8-L18). Each
// test names the finding it holds; the behavioural ones fail on the code before the fix (commit b846c31a). $0, no model, loopback only.
// nice -n 15 node --test --test-concurrency=1 app/site/test/review-security.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { createServer, request } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSite } from './helpers.mjs';
import { createSite } from '../server.mjs';
import { createGate, mintCode, pageUrl } from '../gate.mjs';
import { alive, pageBase, takeLock, readLock } from '../lock.mjs';
import { peerUid, sameAccount } from '../peer.mjs';
import { browserOpener, canOpenBrowser, displayCommand, urlFileIn } from '../../cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', '..', 'cli.mjs');
const PUBLIC = path.join(here, '..', 'public');
const SECRETISH = /#t=|[?&]c=[A-Za-z0-9_-]{43}/;
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0 && process.platform === 'linux';

/** Run the CLI with stdout piped (as a coding agent's shell or `! command` would capture it); resolve when `until` matches or it exits. */
function cli(args, { env = {}, until = null, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_NO_WARNINGS: '1', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve({ child, out, err }); };
    const timer = setTimeout(() => { if (!done) { done = true; child.kill('SIGKILL'); reject(new Error(`timeout: ${out}\n${err}`)); } }, timeout);
    child.stdout.on('data', d => { out += d; if (until && until.test(out)) finish(); });
    child.stderr.on('data', d => { err += d; });
    child.on('exit', finish);
    child.on('error', reject);
  });
}
const stop = child => new Promise(r => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); });
const post = (base, p, body, headers = {}) => fetch(new URL(p, base), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
/** Run node code as another OS account without blocking this process (the server under test runs in it). */
const asOther = (code, uid = 65534) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['-e', code], { uid, gid: uid, cwd: '/', stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
  child.on('exit', () => resolve({ out, err })); child.on('error', reject);
});

test('H1: `site` and `open` never print a key or a code when their output is piped (a coding agent would read it)', async () => {
  const ws = mkdtempSync(path.join(tmpdir(), 'review-h1-'));
  let site = null;
  try {
    const started = await cli(['site', '--no-open', '--workspace', ws, '--port', '0'], { until: /To come back later/ });
    site = started.child;
    assert.equal(SECRETISH.test(started.out), false, `site printed a key or code:\n${started.out}`);
    assert.match(started.out, /run this in your own terminal/);
    const base = started.out.match(/Foundry is running: (http:\/\/127\.0\.0\.1:\d+\/)/)[1];
    const again = await cli(['open', '--no-open', '--workspace', ws]);
    assert.equal(SECRETISH.test(again.out), false, `open printed a key or code:\n${again.out}`);
    assert.match(again.out, /already running/);
    // In a person's terminal (stdin and stdout a TTY: `script` gives the command a pty) the one-time link is printed.
    if (spawnSync('sh', ['-c', 'command -v script'], { stdio: 'ignore' }).status === 0) {
      const tty = spawnSync('script', ['-qec', `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} open --no-open --workspace ${JSON.stringify(ws)}`, '/dev/null'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_NO_WARNINGS: '1' }, timeout: 60000 });
      const link = tty.stdout.match(/http:\/\/127\.0\.0\.1:\d+\/#\/\?c=[A-Za-z0-9_-]{43}/)?.[0];
      assert.ok(link, `a person's terminal gets a one-time link:\n${tty.stdout}`);
      const code = new URL(link).hash.split('c=')[1];
      const r = await post(base, '/auth/open', { code });
      assert.equal(r.status, 200, 'the printed link opens Foundry once');
      assert.equal((await post(base, '/auth/open', { code })).status, 409, 'and only once');
    }
  } finally { if (site) await stop(site); rmSync(ws, { recursive: true, force: true }); }
});

test('H2, M6: every start makes new keys; a key is traded for a one-time code, which works once; a reused code withdraws the key it gave', async () => {
  const ws = mkdtempSync(path.join(tmpdir(), 'review-h2-'));
  const urlFile = path.join(ws, 'browser-url.txt');
  let a = null, b = null;
  try {
    const first = await cli(['site', '--workspace', ws, '--port', '0'], { env: { FOUNDRY_URL_FILE: urlFile }, until: /To come back later/ });
    a = first.child;
    const link = readFileSync(urlFile, 'utf8').trim();
    // What the browser opener gets: a one-time code in the fragment, no key, and no & or % for cmd.exe to cut (M6).
    assert.match(link, /^http:\/\/127\.0\.0\.1:\d+\/#\/\?c=[A-Za-z0-9_-]{43}$/); assert.equal(/[&%]/.test(link), false);
    const base = link.split('#')[0], code = link.split('c=')[1];
    const key = (await (await post(base, '/auth/open', { code })).json()).key;
    assert.equal((await fetch(`${base}api/overview`, { headers: { 'x-foundry-token': key } })).status, 200);
    // The same code again (another program that saw the opener's command line, racing the browser): refused, and the key it gave is withdrawn.
    assert.equal((await post(base, '/auth/open', { code })).status, 409);
    assert.equal((await fetch(`${base}api/overview`, { headers: { 'x-foundry-token': key } })).status, 401, 'the key from a reused code is dead');
    // A second page key from `open` (a code minted by another process, bound to this start).
    rmSync(urlFile);
    await cli(['open', '--workspace', ws], { env: { FOUNDRY_URL_FILE: urlFile } });
    const code2 = readFileSync(urlFile, 'utf8').trim().split('c=')[1];
    const key2 = (await (await post(base, '/auth/open', { code: code2 })).json()).key;
    assert.equal((await fetch(`${base}api/overview`, { headers: { 'x-foundry-token': key2 } })).status, 200);
    for (const f of readdir(ws)) assert.equal(readFileSync(f, 'utf8').includes(key2), false, `${f} holds the key`);
    await stop(a); a = null;
    // A new start: the old key is useless, and no key was ever on disk to reuse.
    rmSync(urlFile);
    const second = await cli(['site', '--workspace', ws, '--port', '0'], { env: { FOUNDRY_URL_FILE: urlFile }, until: /To come back later/ });
    b = second.child;
    const base2 = readFileSync(urlFile, 'utf8').trim().split('#')[0];
    assert.equal((await fetch(`${base2}api/overview`, { headers: { 'x-foundry-token': key2 } })).status, 401, 'a key from an earlier start is refused');
    // The page keeps the key in this tab only (sessionStorage) and removes any copy an older version left in localStorage.
    const js = readFileSync(path.join(PUBLIC, 'site.js'), 'utf8');
    assert.equal(/localStorage\.setItem\(KEY/.test(js), false); assert.match(js, /sessionStorage\.setItem\(KEY/); assert.match(js, /localStorage\.removeItem\(KEY\)/);
  } finally { if (a) await stop(a); if (b) await stop(b); rmSync(ws, { recursive: true, force: true }); }
});
/** Every file under dir. */
const readdir = dir => { const out = []; const walk = d => { for (const f of (existsSync(d) ? readdirSync(d, { withFileTypes: true }) : [])) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else out.push(p); } }; walk(dir); return out; };

test('H2: when another program holds the home port, Foundry says so and does not move its home', async () => {
  const ws = mkdtempSync(path.join(tmpdir(), 'review-port-'));
  const squatter = createServer((req, res) => res.end('not foundry'));
  await new Promise(r => squatter.listen(0, '127.0.0.1', r));
  const port = squatter.address().port;
  mkdirSync(path.join(ws, 'site'), { recursive: true });
  writeFileSync(path.join(ws, 'site', 'session.json'), JSON.stringify({ port }));
  let site = null;
  try {
    const r = await cli(['site', '--no-open', '--workspace', ws], { until: /To come back later/ });
    site = r.child;
    assert.match(r.out, new RegExp(`Port ${port} is in use by another program`));
    assert.match(r.out, /is not Foundry/);
    assert.equal(JSON.parse(readFileSync(path.join(ws, 'site', 'session.json'), 'utf8')).port, port, 'the home port stays the bookmarked one');
  } finally { if (site) await stop(site); await new Promise(r => squatter.close(r)); rmSync(ws, { recursive: true, force: true }); }
});

test('H2, L18: on Linux the page answers only this OS account (or root); another account gets 403 even with a valid key', { skip: !isRoot && 'needs root on Linux to run a client as another account' }, async () => {
  const s = await startSite();
  try {
    const script = `const http=require('http');const get=(p,h)=>new Promise(r=>http.get({host:'127.0.0.1',port:${s.port},path:p,headers:{host:'127.0.0.1:${s.port}',...h}},res=>{res.resume();r(res.statusCode)}).on('error',()=>r(0)));
      (async()=>{console.log(JSON.stringify([await get('/open-info',{}),await get('/api/overview',{'x-foundry-token':${JSON.stringify(s.site.token)}})]))})()`;
    const other = await asOther(script);
    assert.deepEqual(JSON.parse(other.out), [403, 403], other.err);
    // This account still gets in.
    assert.equal((await fetch(`${s.base}/api/overview`, { headers: s.headers })).status, 200);
  } finally { await s.close(); }
});

test('peer: the client row of /proc/net/tcp names its owner; unknown defers to the key', () => {
  const table = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n' +
    '   0: 0100007F:1052 0100007F:A1B2 01 00000000:00000000 00:00000000 00000000  1000        0 1 1 0\n' +
    '   1: 0100007F:A1B2 0100007F:1052 01 00000000:00000000 00:00000000 00000000     0        0 2 1 0\n';
  const socket = { remotePort: 0xA1B2, localPort: 0x1052, remoteAddress: '127.0.0.1' };
  assert.equal(peerUid(socket, { table, platform: 'linux' }), 0, 'the client end, not the server end');
  assert.equal(peerUid({ ...socket, remotePort: 0x1052, localPort: 0xA1B2 }, { table, platform: 'linux' }), 1000);
  assert.equal(peerUid(socket, { table, platform: 'darwin' }), null);
  assert.equal(sameAccount(1000, 1000), true); assert.equal(sameAccount(1001, 1000), false); assert.equal(sameAccount(0, 1000), true); assert.equal(sameAccount(null, 1000), true);
});

test('L12: a lock counts only for a live Foundry process of this account, and only an address of Foundry\'s own shape is used', async () => {
  assert.equal(pageBase('http://127.0.0.1:4178/'), 'http://127.0.0.1:4178/');
  for (const bad of ['http://evil.example:4178/', 'http://127.0.0.1:4178/#t=x', 'https://127.0.0.1:4178/', 'http://127.0.0.1:99999/', 'http://localhost:4178/', null]) assert.equal(pageBase(bad), null, String(bad));
  // A live process of this account that is not Foundry (a recycled pid): not a running Foundry.
  const sleeper = spawn('sleep', ['30'], { stdio: 'ignore' });
  try {
    await new Promise(r => setTimeout(r, 100));
    if (process.platform === 'linux') assert.equal(alive(sleeper.pid), false, 'a pid that is not a Foundry CLI');
  } finally { sleeper.kill(); }
  if (isRoot) {
    // Another account's process (kill(pid, 0) succeeds for root; EPERM for anyone else): not this account's Foundry.
    const other = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)', 'cli.mjs'], { uid: 65534, gid: 65534, stdio: 'ignore', cwd: '/' });
    try { await new Promise(r => setTimeout(r, 200)); assert.equal(alive(other.pid), false); } finally { other.kill(); }
  }
  const ws = mkdtempSync(path.join(tmpdir(), 'review-lock-'));
  try { const l = takeLock(ws, 'test'); assert.equal(readLock(ws).alive, true, 'this process'); l.release(); } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('L15: FOUNDRY_URL_FILE is honoured only for a file inside the workspace', async () => {
  const ws = mkdtempSync(path.join(tmpdir(), 'review-l15-')), outside = mkdtempSync(path.join(tmpdir(), 'review-l15-out-'));
  try {
    const out = path.join(outside, 'link.txt'), inside = path.join(ws, 'link.txt');
    assert.equal(await browserOpener('linux', { FOUNDRY_URL_FILE: out }, { workspace: ws })('http://127.0.0.1:1/#/?c=x'), false);
    assert.equal(existsSync(out), false, 'nothing written outside the workspace');
    assert.equal(canOpenBrowser({ FOUNDRY_URL_FILE: out }, 'linux', ws), false);
    assert.equal(await browserOpener('linux', { FOUNDRY_URL_FILE: inside }, { workspace: ws })('http://127.0.0.1:1/#/?c=x'), true);
    assert.equal(readFileSync(inside, 'utf8').trim(), 'http://127.0.0.1:1/#/?c=x');
    assert.equal(urlFileIn(path.join(ws, '..', 'x'), ws), null); assert.equal(urlFileIn(ws, ws), null);
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('L18: the page without a key shows the open command with the home folder as ~, and the shell still finds it', async () => {
  assert.equal(displayCommand('node "/home/ravi/foundry/app/cli.mjs" open --workspace "/home/ravi/.f"', '/home/ravi', 'linux'), 'node ~/"foundry/app/cli.mjs" open --workspace ~/".f"');
  assert.equal(displayCommand('node "/opt/foundry/app/cli.mjs" open', '/home/ravi', 'linux'), 'node "/opt/foundry/app/cli.mjs" open');
  assert.equal(spawnSync('sh', ['-c', 'echo ~/"a b"'], { encoding: 'utf8', env: { HOME: '/home/ravi', PATH: process.env.PATH } }).stdout.trim(), '/home/ravi/a b');
  const ws = path.join(homedir(), `.review-l18-${process.pid}`);
  mkdirSync(ws, { recursive: true });
  const { siteApp } = await import('../server.mjs');
  const app = await siteApp({ workspace: ws }), site = createSite(app, { workspace: ws });
  try {
    const { port } = await site.listen(0);
    const info = await fetch(`http://127.0.0.1:${port}/open-info`).then(r => r.json());
    assert.equal(info.open.includes(homedir()), false, info.open); assert.match(info.open, /~\//);
  } finally { await site.close(); await app.close(); rmSync(ws, { recursive: true, force: true }); }
});

test('gate: a code works once, within its time, only for the start it names; codes from an earlier start are swept', () => {
  const ws = mkdtempSync(path.join(tmpdir(), 'review-gate-'));
  try {
    let t = 1000;
    const stale = mintCode(ws, { instance: 'old-start', now: t });
    const g = createGate({ workspace: ws, instance: 'this-start', now: () => t });
    assert.equal(g.open(stale).ok, false, 'a code for an earlier start');
    const c = mintCode(ws, { instance: 'this-start', now: t });
    t += 61000;
    assert.equal(g.open(c).code, 'CODE_EXPIRED');
    const m = g.mint(); const k = g.open(m);
    assert.equal(k.ok, true); assert.equal(g.check(k.key), true);
    assert.equal(g.open(m).code, 'CODE_USED'); assert.equal(g.check(k.key), false);
    assert.equal(g.open('short').code, 'CODE_SHAPE');
    assert.equal(pageUrl('http://127.0.0.1:1/', 'C', '/go-live/x'), 'http://127.0.0.1:1/#/go-live/x?c=C');
    assert.equal(pageUrl('http://127.0.0.1:1/', 'C', 'javascript:x'), 'http://127.0.0.1:1/#/?c=C');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('auth/open: JSON only (another site cannot send it without a preflight); the Host check still applies', async () => {
  const s = await startSite();
  try {
    const code = s.site.gate.mint();
    assert.equal((await fetch(`${s.base}/auth/open`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ code }) })).status, 415);
    const rebound = await new Promise((resolve, reject) => { const r = request({ host: '127.0.0.1', port: s.port, path: '/auth/open', method: 'POST', headers: { host: `evil.example:${s.port}`, 'content-type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); }); r.on('error', reject); r.end(JSON.stringify({ code })); });
    assert.equal(rebound, 421);
    assert.equal((await post(s.base, '/auth/open', { code })).status, 200);
  } finally { await s.close(); }
});
