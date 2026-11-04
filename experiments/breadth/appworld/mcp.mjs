#!/usr/bin/env node
// AppWorld facade, agent side: a stdio MCP server (JSON-RPC 2.0, one message per line) that the CLI starts inside the
// executor sandbox (session.mjs). It is the ONLY way an arm reaches anything: `execute` (AppWorld's own code-execution
// interface, world.execute), `api_docs` (an API-docs lookup), the shared `python` tool and, for the notes control arm
// only, `read_notes` / `write_notes`. Every tools/call becomes a request file in the session's mailbox (the workdir's
// .tools/), which the HOST facade (facade.mjs) answers; the world, its data and all grading stay outside the session.
// Same protocol as the AgentDojo bed's relay (experiments/breadth/agentdojo/mcp.mjs). Node built-ins only.
//
//   node mcp.mjs --tools <tools.json> --mailbox <dir> [--server-name appworld] [--wait-ms N]
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const RELAY_VERSION = '1';
export const SERVER = 'appworld';
export const PROTOCOL_VERSIONS = Object.freeze(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
// Tool texts state only what AppWorld's public README and package API say (research/breadth-20261021/appworld/NOTES.md
// "Tool texts"); task-specific facts come only from the task prompt.
export const EXECUTE_TOOL = Object.freeze({ name: 'execute',
  description: 'Run Python code in the AppWorld environment and return what it printed (or the error traceback). An `apis` object is predefined: call any app\'s API as apis.<app_name>.<api_name>(**arguments), e.g. apis.supervisor.show_account_passwords(). Variables persist between calls. Use print() to see results. This is the ONLY way to read or change the apps\' state. When the task is done, call apis.supervisor.complete_task() (with answer=... if the task asks a question); after that, no more code runs.',
  inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Python code to execute in the AppWorld environment' } }, required: ['code'] } });
export const DOCS_TOOL = Object.freeze({ name: 'api_docs',
  description: 'Look up AppWorld API documentation. No arguments: every app with a description. app_name only: every API of that app with a one-line description. app_name and api_name: the full specification of that API (parameters, types, defaults, response schema). Reading documentation never changes anything.',
  inputSchema: { type: 'object', properties: { app_name: { type: 'string' }, api_name: { type: 'string' } } } });
export const PYTHON_TOOL = Object.freeze({ name: 'python', description: 'Run Python 3 code in a sandbox (no network, no files kept between runs, standard library only) and return what it printed. Use print() to see results. This tool does not see or change the AppWorld environment; it is for computing, parsing or checking.',
  inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Python 3 source code to run' } }, required: ['code'] } });
export const NOTES_TOOLS = Object.freeze([
  { name: 'read_notes', description: 'Read your notes file. It holds whatever you wrote with write_notes in earlier tasks of this series (empty at first).', inputSchema: { type: 'object', properties: {} } },
  { name: 'write_notes', description: 'Replace your notes file with this text (at most 8000 characters). Later tasks of this series can read it with read_notes.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
]);
export const armTools = notes => [EXECUTE_TOOL, DOCS_TOOL, PYTHON_TOOL, ...(notes ? NOTES_TOOLS : [])];

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

export async function send(box, body, waitMs) {
  const n = claim(box);
  const tmp = path.join(box, `req-${n}.json.tmp`);
  writeFileSync(tmp, JSON.stringify({ v: 1, ...body }));
  renameSync(tmp, path.join(box, `req-${n}.json`));
  const res = path.join(box, `res-${n}.json`);
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    if (existsSync(res)) { try { return JSON.parse(readFileSync(res, 'utf8')); } catch { /* being written */ } }
    await new Promise(r => setTimeout(r, 20));
  }
  return { error: `the environment did not answer within ${Math.round(waitMs / 1000)} s` };
}

/** The text and error flag an MCP tool result carries for one mailbox answer. */
export function toolResult(name, r) {
  if (r.error) return { text: String(r.error), isError: true };
  if (name === 'python') return { text: `${r.python?.stdout ?? ''}${r.python?.error ? `\nError:\n${r.python.error}` : ''}`, isError: Boolean(r.python?.error) };
  if (name === 'read_notes' || name === 'write_notes') return { text: String(r.notes ?? ''), isError: false };
  if (name === 'api_docs') return { text: String(r.docs ?? ''), isError: false };
  if (name === 'execute') return { text: String(r.output ?? ''), isError: false };
  return { text: 'no result', isError: true };
}

export function makeServer({ tools, box, serverName = SERVER, waitMs = 300_000, write }) {
  const names = new Set(tools.map(t => t.name));
  const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });
  return async function handle(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;
    const { id, method, params } = msg;
    if (!method || id === undefined || id === null) return; // notifications and stray responses
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
      const body = name === 'python' ? { python: String(args.code ?? '') }
        : name === 'execute' ? { execute: String(args.code ?? '') }
          : name === 'api_docs' ? { docs: { appName: args.app_name ? String(args.app_name) : null, apiName: args.api_name ? String(args.api_name) : null } }
            : name === 'read_notes' ? { notes: { op: 'read' } }
              : { notes: { op: 'write', text: String(args.text ?? '') } };
      const r = await send(box, body, waitMs);
      const out = toolResult(name, r);
      return reply(id, { content: [{ type: 'text', text: out.text }], isError: out.isError });
    }
    return fail(id, -32601, `Method not found: ${method}`);
  };
}

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt; };

if (import.meta.url === `file://${process.argv[1]}`) {
  const tools = JSON.parse(readFileSync(arg('tools'), 'utf8'));
  const out = m => process.stdout.write(JSON.stringify(m) + '\n');
  const handle = makeServer({ tools, box: arg('mailbox'), serverName: arg('server-name', SERVER), waitMs: Number(arg('wait-ms', 300_000)), write: out });
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
