import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadComponents } from '../src/components.mjs';
import { DEFAULT_INHERITED_ENV_VARS } from '@modelcontextprotocol/sdk/client/stdio.js';

async function fixture(t, { envAllow = [], noisy = false, duplicate = false, repeatCursor = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-env-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const server = path.join(dir, 'server.mjs');
  writeFileSync(server, `
    import { Server } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'))};
    import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'))};
    import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/types.js'))};
    const server = new Server({name:'synthetic-environment-probe',version:'1'}, {capabilities:{tools:{}}});
    const tool={name:'probe',inputSchema:{type:'object',additionalProperties:false,properties:{}}};
    server.setRequestHandler(ListToolsRequestSchema, async () => ({tools:${duplicate ? '[tool,tool]' : '[tool]'}${repeatCursor ? ',nextCursor:"same"' : ''}}));
    server.setRequestHandler(CallToolRequestSchema, async () => {
      const keys=${JSON.stringify([...DEFAULT_INHERITED_ENV_VARS, 'FOUNDRY_ENV_TEST_ALLOW', 'FOUNDRY_ENV_TEST_DENY'])};
      const result={nonemptyKeys:keys.filter(key=>typeof process.env[key]==='string'&&process.env[key].length>0)};
      return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
    });
    ${noisy ? "await new Promise(resolve=>process.stderr.write('synthetic diagnostic '.repeat(20000),resolve));" : ''}
    await server.connect(new StdioServerTransport());
  `, { mode: 0o600 });
  const manifestPath = path.join(dir, 'components.json');
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: '1.0', servers: [{ id: 'envtest', command: process.execPath, args: [server], envAllow,
    capabilities: [{ tool: 'probe', effects: 'none', risk: 'low', maxTimeoutMs: 2000, cost: 0, outputMode: 'structured', outputSchema: { type: 'object', required: ['nonemptyKeys'], properties: { nonemptyKeys: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } }]
  }] }), { mode: 0o600 });
  return manifestPath;
}

test('Component environment: actual stdio child receives only explicit environment values, not SDK default HOME/USER', { timeout: 10000 }, async t => {
  const originalAllow = process.env.FOUNDRY_ENV_TEST_ALLOW, originalDeny = process.env.FOUNDRY_ENV_TEST_DENY;
  process.env.FOUNDRY_ENV_TEST_ALLOW = 'synthetic allowlisted value';
  process.env.FOUNDRY_ENV_TEST_DENY = 'synthetic value that must stay out of the child';
  t.after(() => {
    if (originalAllow === undefined) delete process.env.FOUNDRY_ENV_TEST_ALLOW; else process.env.FOUNDRY_ENV_TEST_ALLOW = originalAllow;
    if (originalDeny === undefined) delete process.env.FOUNDRY_ENV_TEST_DENY; else process.env.FOUNDRY_ENV_TEST_DENY = originalDeny;
  });
  const file = await fixture(t, { envAllow: ['FOUNDRY_ENV_TEST_ALLOW'] });
  const loaded = await loadComponents(file);
  try {
    const observed = await loaded.registry.execute('mcp.envtest.probe', {}, { signal: new AbortController().signal });
    assert.deepEqual(observed.nonemptyKeys.sort(), ['FOUNDRY_ENV_TEST_ALLOW', 'PATH']);
  } finally { await loaded.close(); }
});

test('Component environment: explicitly authorized inherited key remains available without default widening', { timeout: 10000 }, async t => {
  const file = await fixture(t, { envAllow: ['HOME'] });
  const loaded = await loadComponents(file);
  try {
    const observed = await loaded.registry.execute('mcp.envtest.probe', {}, { signal: new AbortController().signal });
    assert.deepEqual(observed.nonemptyKeys.sort(), process.env.HOME ? ['HOME', 'PATH'] : ['PATH']);
  } finally { await loaded.close(); }
});

test('Component environment: a noisy authored server cannot block on undrained stderr', { timeout: 10000 }, async t => {
  const loaded = await loadComponents(await fixture(t, { noisy: true }));
  try {
    assert.ok(loaded.registry.get('mcp.envtest.probe'));
    const result = await loaded.registry.execute('mcp.envtest.probe', {}, { signal: new AbortController().signal });
    assert.deepEqual(result.nonemptyKeys, ['PATH']);
  } finally { await loaded.close(); }
});

test('Component catalog: duplicate names and repeated cursors fail explicitly rather than choosing an ambiguous first tool', { timeout: 10000 }, async t => {
  await assert.rejects(loadComponents(await fixture(t, { duplicate: true })), { code: 'COMPONENT_CATALOG_DUPLICATE' });
  await assert.rejects(loadComponents(await fixture(t, { repeatCursor: true })), { code: 'COMPONENT_CATALOG_CURSOR' });
});
