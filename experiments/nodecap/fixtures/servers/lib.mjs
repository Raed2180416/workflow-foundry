// Tiny fixture MCP servers for the nodecap spike (development fixtures, not third-party servers). Each keeps a server-side call ledger
// (JSON lines appended synchronously to the file named by --ledger) that tests and the bed oracles read; the model never sees it.
// Built on the pinned SDK's low-level Server with raw JSON schemas, as tests/components-environment.test.mjs does.
import { appendFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export function argv(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
export const flag = name => process.argv.includes(`--${name}`);
export function record(ledger, entry) { if (ledger) appendFileSync(ledger, `${JSON.stringify({ at: Date.now(), ...entry })}\n`); }
export const ok = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
export const err = text => ({ isError: true, content: [{ type: 'text', text }] });

/**
 * A server from a tool table: tools() returns the current Tool list (it may change between listings), handlers maps a tool name to
 * (args, state) => result. `onListed(count)` runs after each tools/list (a rug pull flips its definitions there).
 */
export function fixtureServer({ name, version = '1', instructions, tools, handlers, ledger = argv('ledger'), onListed = null, listChanged = false }) {
  const server = new Server({ name, version }, { capabilities: { tools: listChanged ? { listChanged: true } : {} }, ...(instructions ? { instructions } : {}) });
  let listed = 0;
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = { tools: tools() };
    listed++; setImmediate(() => onListed?.(listed, server));
    return result;
  });
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name: tool, arguments: args = {} } = request.params;
    record(ledger, { tool, args });
    const handler = handlers[tool];
    if (!handler) return err(`unknown tool ${tool}`);
    return handler(args);
  });
  return server;
}
export async function serveStdio(server) { await server.connect(new StdioServerTransport()); }
