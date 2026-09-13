import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, DEFAULT_INHERITED_ENV_VARS } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, realpathSync } from 'node:fs';
import { createDefaultRegistry } from './capabilities.mjs';
import { validateData } from './validate.mjs';
import { checkData, digest, FoundryError } from './data.mjs';

export const componentsSchema = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'servers'],
  properties: {
    schemaVersion: { const: '1.0' },
    servers: {
      type: 'array', maxItems: 20, items: {
        type: 'object', additionalProperties: false, required: ['id', 'command', 'args', 'capabilities'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,40}$' },
          command: { type: 'string', minLength: 1, maxLength: 4096 },
          args: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 10000 } },
          cwd: { type: 'string', maxLength: 4096 },
          envAllow: { type: 'array', maxItems: 30, items: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' } },
          capabilities: {
            type: 'array', maxItems: 200, items: {
              type: 'object', additionalProperties: false,
              required: ['tool', 'effects', 'risk', 'maxTimeoutMs', 'cost', 'outputMode', 'outputSchema'],
              properties: {
                tool: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_.-]{0,100}$' },
                effects: { enum: ['none', 'idempotent', 'non-idempotent'] },
                risk: { enum: ['low', 'high'] }, requiresApproval: { type: 'boolean' },
                maxTimeoutMs: { type: 'integer', minimum: 1, maximum: 3600000 },
                cost: { type: 'number', minimum: 0, maximum: 1000 },
                outputMode: { enum: ['structured', 'json-text', 'text'] },
                outputSchema: { type: 'object' },
                idempotencyArgument: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
                requiresEvidence: {
                  type: 'array', maxItems: 30, items: {
                    type: 'object', additionalProperties: false,
                    required: ['id', 'sourceTool', 'sourceArgs', 'schema', 'maxAgeMs'],
                    properties: {
                      id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                      sourceTool: { type: 'string', minLength: 1, maxLength: 128 },
                      sourceArgs: {}, path: { type: 'string', maxLength: 512 },
                      schema: { type: 'object' }, maxAgeMs: { type: 'integer', minimum: 1, maximum: 86400000 }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

/** Load ONLY an explicitly selected, trusted host manifest. Never auto-load
 * model-authored workspace files or install/launch downloaded corpus projects. */
export async function loadComponents(manifestPath, registry = createDefaultRegistry()) {
  const canonicalPath = realpathSync(manifestPath);
  const raw = readFileSync(canonicalPath, 'utf8');
  if (Buffer.byteLength(raw) > 1024 * 1024) throw new FoundryError('COMPONENT_SIZE', 'Component manifest is too large');
  const manifest = JSON.parse(raw); validateData(componentsSchema, manifest, 'trusted component manifest', { trustedSchema: true });
  const ids = new Set(); const clients = [];
  try {
    for (const server of manifest.servers) {
      if (ids.has(server.id)) throw new FoundryError('COMPONENT_DUPLICATE', 'Duplicate component server id');
      ids.add(server.id);
      // The SDK merges its default HOME/USER/etc. even when env is supplied.
      // Explicitly blank every inherited key before restoring the host allowlist.
      // This limits environment inheritance; trusted child processes still run
      // with the user's OS permissions and are not a filesystem/network sandbox.
      const env = { ...Object.fromEntries(DEFAULT_INHERITED_ENV_VARS.map(key => [key, ''])), PATH: process.env.PATH ?? '/usr/bin:/bin' };
      for (const key of server.envAllow ?? []) if (process.env[key] !== undefined) env[key] = process.env[key];
      const transport = new StdioClientTransport({ command: server.command, args: server.args, cwd: server.cwd, env, stderr: 'pipe' });
      // Drain diagnostics without retaining potentially sensitive server logs.
      // Leaving the PassThrough unread can block initialization or a long call.
      transport.stderr?.resume();
      const client = new Client({ name: 'workflow-foundry-component-host', version: '0.1.0' });
      clients.push(client);
      await client.connect(transport, { timeout: 15000 });
      const tools = [];
      let cursor; const cursors = new Set();
      for (let page = 0; page < 10; page++) {
        const result = await client.listTools(cursor ? { cursor } : {}, { timeout: 15000 });
        tools.push(...result.tools); cursor = result.nextCursor;
        if (!cursor) break;
        if (cursors.has(cursor)) throw new FoundryError('COMPONENT_CATALOG_CURSOR', 'Component repeated a tool-list cursor');
        cursors.add(cursor);
      }
      if (cursor) throw new FoundryError('COMPONENT_CATALOG_LIMIT', 'Component tool listing exceeded ten pages');
      if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw new FoundryError('COMPONENT_CATALOG_DUPLICATE', 'Component returned ambiguous duplicate tool names');
      for (const selected of server.capabilities) {
        const observed = tools.find(t => t.name === selected.tool);
        if (!observed) throw new FoundryError('COMPONENT_TOOL_MISSING', `Configured tool ${server.id}/${selected.tool} does not exist`);
        checkData(observed.inputSchema);
        if (selected.effects === 'idempotent' && !selected.idempotencyArgument) throw new FoundryError('COMPONENT_IDEMPOTENCY', 'Idempotent external tools require an explicit idempotency argument contract');
        const descriptor = { manifestHash: digest(manifest), tool: observed, serverVersion: client.getServerVersion() ?? null };
        registry.register({
          name: `mcp.${server.id}.${selected.tool}`,
          description: observed.description ?? selected.tool,
          version: '1', implementation: digest(descriptor),
          inputSchema: observed.inputSchema, outputSchema: selected.outputSchema,
          effects: selected.effects, risk: selected.risk,
          requiresApproval: selected.requiresApproval ?? selected.risk === 'high',
          maxTimeoutMs: selected.maxTimeoutMs, cost: selected.cost,
          ...(selected.requiresEvidence ? { requiresEvidence: selected.requiresEvidence } : {}),
          cancellation: 'protocol-request-only; external effect reconciliation may be required',
          async execute(args, context) {
            const bound = selected.idempotencyArgument ? { ...args, [selected.idempotencyArgument]: context.idempotencyKey } : args;
            const result = await client.callTool({ name: selected.tool, arguments: bound }, undefined, { signal: context.signal, timeout: selected.maxTimeoutMs });
            if (result.isError) throw new FoundryError('MCP_TOOL_ERROR', `Component ${server.id}/${selected.tool} returned an error`);
            if (selected.outputMode === 'structured') {
              if (result.structuredContent === undefined) throw new FoundryError('MCP_OUTPUT', 'Expected structuredContent from component');
              return result.structuredContent;
            }
            if (!Array.isArray(result.content) || result.content.some(part => part.type !== 'text')) throw new FoundryError('MCP_OUTPUT', 'Unexpected non-text component output');
            const text = result.content.map(part => part.text).join('\n');
            if (selected.outputMode === 'text') return { text };
            try { return JSON.parse(text); } catch { throw new FoundryError('MCP_OUTPUT', 'Component returned malformed JSON text'); }
          }
        });
      }
    }
    return { registry, manifestHash: digest(manifest), close: async () => { await Promise.allSettled(clients.map(client => client.close())); } };
  } catch (error) { await Promise.allSettled(clients.map(client => client.close())); throw error; }
}
