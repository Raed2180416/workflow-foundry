#!/usr/bin/env node
// A $0 stand-in for `claude -p --output-format stream-json` (tests only): it starts the MCP servers of --mcp-config,
// lists their tools, prints an init event like the CLI's, makes one or two tool calls through the bed relay, prints a
// rate_limit_event and a result. No network, no model. The behaviour follows the prompt:
//   "What is my e-mail address?"  -> replies "unknown" (identity probe)
//   anything else                  -> calls <server>__company_directory_find_email_address, then replies "done"
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = e => process.stdout.write(JSON.stringify(e) + '\n');
const prompt = await new Promise(r => { let s = ''; process.stdin.on('data', d => { s += d; }); process.stdin.on('end', () => r(s)); });
const cfg = JSON.parse(opt('--mcp-config') ?? '{"mcpServers":{}}');

function connect(name, spec) {
  const c = spawn(spec.command, spec.args ?? [], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '', id = 0;
  const waiting = new Map();
  c.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; const m = JSON.parse(l); waiting.get(m.id)?.(m); } });
  const rpc = (method, params) => new Promise(res => { const n = ++id; waiting.set(n, res); c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  return { name, rpc, close: () => { try { c.stdin.end(); c.kill(); } catch {} } };
}

const servers = Object.entries(cfg.mcpServers ?? {}).map(([n, s]) => connect(n, s));
const tools = [];
for (const s of servers) {
  await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-claude', version: '0' } });
  const r = await s.rpc('tools/list', {});
  for (const t of r.result.tools) tools.push({ server: s, name: t.name, full: `mcp__${s.name}__${t.name}` });
}
out({ type: 'system', subtype: 'init', claude_code_version: '0.0.0-fake', model: opt('--model'), permissionMode: opt('--permission-mode'), tools: tools.map(t => t.full),
  mcp_servers: servers.map(s => ({ name: s.name, status: 'connected' })), slash_commands: [], skills: [], plugins: [], agents: [], output_style: 'default', apiKeySource: 'none' });
await new Promise(r => setTimeout(r, 300)); // model latency: the real CLI prints nothing between init and its first model answer
out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.1 }, seven_day: { utilization: 0.2 } } } });
let reply = 'done', turns = 1;
if (/What is my e-mail address/.test(prompt)) reply = 'unknown';
else {
  const t = tools.find(x => x.name.endsWith('company_directory_find_email_address'));
  if (t) {
    out({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', name: t.full, input: { name: 'a' } }], usage: { input_tokens: 10, output_tokens: 5 } } });
    await t.server.rpc('tools/call', { name: t.name, arguments: { name: 'a' } });
    turns = 2;
  }
}
out({ type: 'result', subtype: 'success', is_error: false, result: reply, total_cost_usd: 0, num_turns: turns, modelUsage: {} });
for (const s of servers) s.close();
process.exit(0);
