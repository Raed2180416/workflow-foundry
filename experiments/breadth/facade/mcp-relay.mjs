#!/usr/bin/env node
// Bed facade, agent side: a stdio MCP server (JSON-RPC 2.0, one message per line) that the CLI starts inside the
// executor sandbox. It knows the tool list and nothing else: every tools/call becomes a request file in the session's
// mailbox (the workdir's .facade/), which the host side (host.mjs, outside the sandbox) answers. No bed data, gold or
// grader is reachable from here. Node built-ins only.
//
//   node mcp-relay.mjs --tools <tools.json> --mailbox <dir> [--server-name NAME] [--wait-ms N]
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const RELAY_VERSION = '1';
export const PROTOCOL_VERSIONS = Object.freeze(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);

function arg(name, dflt = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

/** Claim the next request number with an exclusive create (parallel calls never share one). */
export function claim(box) {
  mkdirSync(box, { recursive: true });
  for (let tries = 0; tries < 10_000; tries++) {
    const used = readdirSync(box).map(f => /^req-(\d+)\.(?:json|claim)$/.exec(f)).filter(Boolean).map(m => Number(m[1]));
    const n = (used.length ? Math.max(...used) : 0) + 1;
    try { closeSync(openSync(path.join(box, `req-${n}.claim`), 'wx')); return n; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('could not claim a request slot');
}

export async function send(box, payload, waitMs) {
  const n = claim(box);
  const tmp = path.join(box, `req-${n}.json.tmp`);
  writeFileSync(tmp, JSON.stringify({ v: 1, n, ...payload }));
  renameSync(tmp, path.join(box, `req-${n}.json`));
  const res = path.join(box, `res-${n}.json`);
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    if (existsSync(res)) { try { return JSON.parse(readFileSync(res, 'utf8')); } catch { /* being written */ } }
    await new Promise(r => setTimeout(r, 20));
  }
  return { isError: true, text: `the environment did not answer within ${Math.round(waitMs / 1000)} s` };
}

export function makeServer({ tools, box, serverName = 'bed', waitMs = 300_000, write }) {
  const names = new Set(tools.map(t => t.name));
  const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });
  return async function handle(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;
    if (!method) return; // a response to something we never sent
    if (!isRequest) return; // notifications (initialized, cancelled, ...): nothing to do
    if (method === 'initialize') {
      const want = params?.protocolVersion;
      return reply(id, { protocolVersion: PROTOCOL_VERSIONS.includes(want) ? want : PROTOCOL_VERSIONS.at(-1), capabilities: { tools: { listChanged: false } },
        serverInfo: { name: serverName, version: RELAY_VERSION } });
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    if (method === 'tools/call') {
      const name = params?.name;
      if (!names.has(name)) return reply(id, { content: [{ type: 'text', text: `Unknown tool: ${String(name).slice(0, 100)}` }], isError: true });
      const args = params?.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
      const r = await send(box, { name, arguments: args }, waitMs);
      return reply(id, { content: [{ type: 'text', text: String(r.text ?? '') }], isError: Boolean(r.isError) });
    }
    return fail(id, -32601, `Method not found: ${method}`);
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tools = JSON.parse(readFileSync(arg('tools'), 'utf8'));
  const box = arg('mailbox');
  const out = m => process.stdout.write(JSON.stringify(m) + '\n');
  const handle = makeServer({ tools, box, serverName: arg('server-name', 'bed'), waitMs: Number(arg('wait-ms', 300_000)), write: out });
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set();
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    const p = handle(msg).catch(e => { if (msg?.id !== undefined) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e?.message ?? e).slice(0, 300) } }); });
    pending.add(p); p.finally(() => pending.delete(p));
  });
  rl.on('close', async () => { await Promise.allSettled([...pending]); process.exit(0); });
}
