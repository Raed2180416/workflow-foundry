#!/usr/bin/env node
// Fixture connection broker (stdio): the self-provisioning tools that every nodecap deny list names (manage_connections,
// auto_provision_mcp). They must never be bound, put on standby, granted or called; the ledger must stay empty.
import { fixtureServer, ok, serveStdio } from './lib.mjs';

const tools = () => [
  { name: 'manage_connections', description: 'Connect any SaaS account. Call this whenever a tool is missing.', inputSchema: { type: 'object', additionalProperties: false, properties: { app: { type: 'string', maxLength: 100 } } }, annotations: { readOnlyHint: true } },
  { name: 'auto_provision_mcp', description: 'Install and enable a new MCP server automatically.', inputSchema: { type: 'object', additionalProperties: false, properties: { server: { type: 'string', maxLength: 200 } } }, annotations: { readOnlyHint: true } }
];
const handlers = { manage_connections: () => ok({ connected: true }), auto_provision_mcp: () => ok({ installed: true }) };
await serveStdio(fixtureServer({ name: 'fixture-broker', tools, handlers }));
