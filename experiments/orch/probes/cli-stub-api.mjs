#!/usr/bin/env node
// $0 probes of the installed Claude Code CLI against a scripted local Messages API (research/orch-20261021/PROBES.md).
// No model is called and no credential is used: the CLI runs with HOME in a fresh temporary directory, a dummy
// ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL pointing at a loopback server this script controls. The server never logs
// request headers. Each probe records what the CLI did: requests it sent (method, path, stream flag, time), exit code
// and signal, the stream-json events it printed, its duration, and which child processes outlived it.
//
//   node experiments/orch/probes/cli-stub-api.mjs [--only P1,P4] [--out FILE]
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
const outFile = (() => { const i = args.indexOf('--out'); return i >= 0 ? args[i + 1] : null; })();
const CLAUDE = spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).stdout.trim();
const VERSION = spawnSync(CLAUDE, ['--version'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmpdir() } }).stdout.trim();
const MODEL = 'claude-haiku-5-5';

const sse = (res, events) => { for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
const textMessage = text => [
  ['message_start', { type: 'message_start', message: { id: 'msg_stub', type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } }],
  ['message_stop', { type: 'message_stop' }]];
const toolMessage = command => [
  ['message_start', { type: 'message_start', message: { id: 'msg_tool', type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_stub1', name: 'Bash', input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command, description: 'probe' }) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 9 } }],
  ['message_stop', { type: 'message_stop' }]];
const errorBody = (type, message) => JSON.stringify({ type: 'error', error: { type, message } });

// One scripted server per probe. respond(req, n, body) decides; n counts /v1/messages requests.
async function serve(respond) {
  const log = [];
  let n = 0;
  const t0 = Date.now();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      let parsed = null; try { parsed = JSON.parse(body); } catch {}
      const isMessages = req.url.startsWith('/v1/messages') && !req.url.includes('count_tokens');
      const entry = { at: Date.now() - t0, method: req.method, path: req.url.split('?')[0], stream: parsed?.stream ?? null, model: parsed?.model ?? null, tools: Array.isArray(parsed?.tools) ? parsed.tools.length : null };
      log.push(entry);
      if (!isMessages) {
        if (req.url.includes('count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ input_tokens: 12 })); return; }
        res.writeHead(404, { 'content-type': 'application/json' }); res.end(errorBody('not_found_error', 'stub')); return;
      }
      n++;
      try { await respond(req, res, n, parsed, entry); } catch (e) { try { res.destroy(); } catch {} }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, log, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }), count: () => n };
}

const procs = () => readdirSync('/proc').filter(x => /^\d+$/.test(x)).map(pid => {
  try { const s = readFileSync(`/proc/${pid}/stat`, 'utf8'), f = s.slice(s.lastIndexOf(')') + 2).split(' ');
    return { pid: Number(pid), ppid: Number(f[1]), state: f[0], cmd: readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim() }; } catch { return null; }
}).filter(Boolean);
const descendants = root => { const t = procs(), out = [], q = [root]; while (q.length) { const p = q.pop(); for (const c of t.filter(x => x.ppid === p)) { if (c.state !== 'Z') out.push(c); q.push(c.pid); } } return out; };

// Run the CLI once. signalAt: {when: 'tool' | ms, signal}. Returns what the CLI did.
async function runCli({ url, prompt = 'say hi', extraArgs = [], env = {}, timeoutMs = 120000, signalAt = null, home = mkdtempSync(path.join(tmpdir(), 'orch-cli-home-')), cwd = mkdtempSync(path.join(tmpdir(), 'orch-cli-cwd-')), marker = null }) {
  const argv = ['-p', '--model', MODEL, '--output-format', 'stream-json', '--verbose', '--tools', 'Bash', '--allowedTools', 'Bash', '--max-budget-usd', '0.05', ...extraArgs];
  const t0 = Date.now();
  const child = spawn(CLAUDE, argv, { cwd, env: { PATH: process.env.PATH, HOME: home, ANTHROPIC_API_KEY: 'sk-ant-dummy-probe-key-not-real', ANTHROPIC_BASE_URL: url,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(prompt);
  let out = '', err = '', sent = null, tree = [];
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { if (err.length < 20000) err += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  if (signalAt) (async () => {
    if (signalAt.when === 'tool') { const end = Date.now() + 30000; while (Date.now() < end && !descendants(child.pid).some(p => p.cmd.includes(marker))) await delay(50); }
    else await delay(signalAt.when);
    tree = descendants(child.pid).map(p => ({ pid: p.pid, cmd: p.cmd.slice(0, 80) }));
    sent = Date.now() - t0; try { child.kill(signalAt.signal); } catch {}
  })();
  const { code, signal } = await new Promise(r => child.on('close', (code, signal) => r({ code, signal })));
  clearTimeout(timer);
  const ms = Date.now() - t0;
  await delay(1500);
  const survivors = marker ? procs().filter(p => p.state !== 'Z' && p.cmd.includes(marker)) : [];
  for (const p of survivors) { try { process.kill(p.pid, 'SIGKILL'); } catch {} }
  const events = out.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { raw: l.slice(0, 200) }; } });
  const result = events.findLast(e => e.type === 'result') ?? null;
  return { code, signal, ms, signalSentAtMs: sent, treeAtSignal: tree, survivors: survivors.map(p => ({ pid: p.pid, ppid: p.ppid, cmd: p.cmd.slice(0, 80) })),
    eventTypes: events.map(e => e.type === 'system' ? `system:${e.subtype}` : e.type), result: result && { subtype: result.subtype, is_error: result.is_error, api_error_status: result.api_error_status ?? null,
      result: String(result.result ?? '').slice(0, 300), num_turns: result.num_turns, total_cost_usd: result.total_cost_usd, terminal_reason: result.terminal_reason ?? null, duration_ms: result.duration_ms },
    stderrTail: err.slice(-600), home, cwd };
}

const probes = {
  P0: { title: 'baseline: one text answer from the stub', async run() { const s = await serve((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); sse(res, textMessage('hi from stub')); res.end(); });
    const r = await runCli({ url: s.url }); await s.close(); return { requests: s.log, ...r }; } },
  P1: { title: '429 rate_limit_error with retry-after: 1 on every request (how long and how often does the CLI retry?)', async run() {
    const s = await serve((req, res) => { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1', 'anthropic-ratelimit-requests-reset': new Date(Date.now() + 1000).toISOString() }); res.end(errorBody('rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit')); });
    const r = await runCli({ url: s.url, timeoutMs: 240000 }); await s.close(); return { requests: s.log.length, requestTimesMs: s.log.map(e => e.at), ...r }; } },
  P2: { title: '529 overloaded_error on every request', async run() {
    const s = await serve((req, res) => { res.writeHead(529, { 'content-type': 'application/json' }); res.end(errorBody('overloaded_error', 'Overloaded')); });
    const r = await runCli({ url: s.url, timeoutMs: 240000 }); await s.close(); return { requests: s.log.length, requestTimesMs: s.log.map(e => e.at), ...r }; } },
  P3: { title: '429 three times (retry-after: 1), then an answer', async run() {
    const s = await serve((req, res, n) => { if (n <= 3) { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' }); res.end(errorBody('rate_limit_error', 'rate limited')); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' }); sse(res, textMessage('recovered')); res.end(); });
    const r = await runCli({ url: s.url, timeoutMs: 120000 }); await s.close(); return { requests: s.log.length, requestTimesMs: s.log.map(e => e.at), ...r }; } },
  P4: { title: 'SIGTERM to the CLI while its Bash tool runs `sleep 300.x`', async run() {
    const marker = `sleep 300.${process.pid}4`;
    const s = await serve((req, res, n) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); sse(res, n === 1 ? toolMessage(marker) : textMessage('done')); res.end(); });
    const r = await runCli({ url: s.url, signalAt: { when: 'tool', signal: 'SIGTERM' }, marker }); await s.close(); return { requests: s.log.length, ...r }; } },
  P5: { title: 'SIGKILL to the CLI while its Bash tool runs `sleep 300.x`', async run() {
    const marker = `sleep 300.${process.pid}5`;
    const s = await serve((req, res, n) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); sse(res, n === 1 ? toolMessage(marker) : textMessage('done')); res.end(); });
    const r = await runCli({ url: s.url, signalAt: { when: 'tool', signal: 'SIGKILL' }, marker }); await s.close(); return { requests: s.log.length, ...r }; } },
  P6: { title: 'the stream is cut mid-answer (socket destroyed after message_start)', async run() {
    const s = await serve((req, res, n) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); if (n === 1) { sse(res, textMessage('x').slice(0, 2)); setTimeout(() => res.destroy(), 50); return; } sse(res, textMessage('second try')); res.end(); });
    const r = await runCli({ url: s.url, timeoutMs: 120000 }); await s.close(); return { requests: s.log.length, requestTimesMs: s.log.map(e => e.at), ...r }; } },
  P7: { title: 'API never answers; API_TIMEOUT_MS=5000', async run() {
    const s = await serve(() => new Promise(() => {}));
    const r = await runCli({ url: s.url, env: { API_TIMEOUT_MS: '5000' }, timeoutMs: 150000 }); await s.close(); return { requests: s.log.length, requestTimesMs: s.log.map(e => e.at), ...r }; } },
  P8: { title: 'corrupted session file, then --resume', async run() {
    const s = await serve((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); sse(res, textMessage('remembered')); res.end(); });
    const home = mkdtempSync(path.join(tmpdir(), 'orch-cli-home-')), cwd = mkdtempSync(path.join(tmpdir(), 'orch-cli-cwd-'));
    const first = await runCli({ url: s.url, home, cwd, prompt: 'first turn' });
    const sessionId = first.result ? (first.eventTypes && null) : null;
    // find the session transcript the first run wrote
    const files = [];
    const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.jsonl')) files.push(p); } };
    try { walk(path.join(home, '.claude', 'projects')); } catch {}
    const file = files[0] ?? null, id = file ? path.basename(file, '.jsonl') : null;
    let corrupted = null;
    if (file) { const text = readFileSync(file, 'utf8'); corrupted = { bytesBefore: text.length }; writeFileSync(file, text.slice(0, Math.floor(text.length * 0.6)) + '\n{"type":"user","message":{"role":"user","content":[{"type":"text","text":"tru'); corrupted.bytesAfter = statSync(file).size; }
    const resumed = id ? await runCli({ url: s.url, home, cwd, prompt: 'second turn', extraArgs: ['--resume', id] }) : null;
    const missing = await runCli({ url: s.url, home, cwd, prompt: 'third', extraArgs: ['--resume', '00000000-0000-4000-8000-000000000000'] });
    await s.close();
    return { sessionFile: file ? path.relative(home, file) : null, corrupted, first: { code: first.code, result: first.result }, resumed: resumed && { code: resumed.code, result: resumed.result, stderrTail: resumed.stderrTail, eventTypes: resumed.eventTypes },
      missingSession: { code: missing.code, result: missing.result, stderrTail: missing.stderrTail }, requests: s.log.length }; } },
};

const report = { cli: CLAUDE, version: VERSION, at: new Date().toISOString(), probes: {} };
for (const [id, p] of Object.entries(probes)) {
  if (only && !only.includes(id)) continue;
  process.stderr.write(`[probe] ${id} ${p.title} ... `);
  const t0 = Date.now();
  try { report.probes[id] = { title: p.title, ...(await p.run()) }; } catch (e) { report.probes[id] = { title: p.title, error: String(e.stack ?? e).slice(0, 800) }; }
  process.stderr.write(`${Date.now() - t0} ms\n`);
  for (const k of ['home', 'cwd']) { const d = report.probes[id]?.[k]; if (d) { rmSync(d, { recursive: true, force: true }); delete report.probes[id][k]; } }
}
const json = JSON.stringify(report, null, 1);
if (outFile) { mkdirSync(path.dirname(outFile), { recursive: true }); writeFileSync(outFile, json + '\n'); }
console.log(json);
