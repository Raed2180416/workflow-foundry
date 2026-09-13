import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadComponents } from '../src/components.mjs';
import { Foundry } from '../src/foundry.mjs';
import { toolDefinitions } from '../src/mcp.mjs';

// All launched code below is an authored local MCP fixture in an owned temporary
// directory. No acquired server, research corpus, scanner or remote API runs.
async function componentFixture(t, { risk, effects, idempotencyArgument, failFirst = false }) {
  const directory = mkdtempSync(path.join(tmpdir(), 'foundry-authority-audit-'));
  const callsFile = path.join(directory, 'calls.jsonl');
  const serverFile = path.join(directory, 'mock-server.mjs');
  const source = `
    import { Server } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'))};
    import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'))};
    import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/types.js'))};
    import { appendFileSync } from 'node:fs';
    let calls = 0;
    const server = new Server({name:'local-audit-fixture',version:'1'}, {capabilities:{tools:{}}});
    server.setRequestHandler(ListToolsRequestSchema, async () => ({tools:[{
      name:'perform', description:'Authored synthetic operation only',
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true},
      inputSchema:{type:'object',additionalProperties:false,properties:{operationKey:{type:'string'}}}
    }]}));
    server.setRequestHandler(CallToolRequestSchema, async request => {
      calls++;
      appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({name:request.params.name,args:request.params.arguments})+'\\n');
      if (${JSON.stringify(failFirst)} && calls === 1) return {isError:true,content:[{type:'text',text:'Synthetic transient acknowledgement failure'}]};
      const output={ok:true,key:request.params.arguments?.operationKey ?? null};
      return {content:[{type:'text',text:JSON.stringify(output)}],structuredContent:output};
    });
    await server.connect(new StdioServerTransport());
  `;
  writeFileSync(serverFile, source);
  const capability = { tool: 'perform', effects, risk, maxTimeoutMs: 1000, cost: 0,
    outputMode: 'structured', outputSchema: { type: 'object', required: ['ok', 'key'],
      properties: { ok: { type: 'boolean' }, key: { type: ['string', 'null'] } }, additionalProperties: false },
    ...(idempotencyArgument ? { idempotencyArgument } : {}) };
  const manifestFile = path.join(directory, 'components.json');
  writeFileSync(manifestFile, JSON.stringify({ schemaVersion: '1.0', servers: [{
    id: 'audit', command: process.execPath, args: [serverFile], capabilities: [capability],
  }] }));
  let components, foundry;
  t.after(async () => {
    if (foundry) await foundry.close();
    if (components) await components.close();
    rmSync(directory, { recursive: true, force: true });
  });
  components = await loadComponents(manifestFile);
  foundry = new Foundry(path.join(directory, 'workspace'), {
    registry: components.registry, policy: { allowedCapabilities: ['mcp.audit.perform'] },
  });
  return { foundry, components, calls: () => existsSync(callsFile)
    ? readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [] };
}
function flow({ attempts = 1 } = {}) {
  return { schemaVersion: '1.0', id: `authority-${randomUUID()}`, version: 1,
    title: 'Mock component authority', domain: 'security-audit', goal: 'Preserve host authority across a connector',
    envelope: { assumptions: ['Only an authored local MCP fixture is connected'], risks: [], successCriteria: ['The trusted effect policy controls dispatch'] },
    budget: { maxSteps: 5, maxConcurrency: 1, maxDurationMs: 5000, maxCost: 0 },
    nodes: [{ id: 'operation', kind: 'task', needs: [], description: 'Invoke the selected mock tool',
      tool: 'mcp.audit.perform', args: { operationKey: 'model-selected-key' }, timeoutMs: 1000, retry: { maxAttempts: attempts } }],
    acceptance: [{ op: 'eq', left: { $ref: 'nodes.operation.ok' }, right: true }],
  };
}

test('security authority: remote read-only annotations cannot replace host approval, including MCP resume', { timeout: 10000 }, async t => {
  const { foundry, calls } = await componentFixture(t, { effects: 'non-idempotent', risk: 'high' });
  const workflow = flow(); foundry.save(workflow);
  const run = foundry.createRun(workflow.id);
  const paused = await foundry.startRun(run.id);
  assert.equal(paused.status, 'awaiting_approval');
  assert.equal(calls().length, 0);
  const definitions = toolDefinitions(foundry);
  assert.equal(definitions.some(tool => /approve|answer/.test(tool.name)), false,
    'Model-facing tool names must not grant human authority');
  const resumed = await definitions.find(tool => tool.name === 'foundry_resume').execute({ runId: run.id });
  assert.equal(resumed.status, 'awaiting_approval');
  assert.equal(calls().length, 0);
});

test('security authority: connector retry receives one runtime-owned idempotency key, never the model key', { timeout: 10000 }, async t => {
  const { foundry, calls } = await componentFixture(t, {
    effects: 'idempotent', risk: 'low', idempotencyArgument: 'operationKey', failFirst: true,
  });
  const workflow = flow({ attempts: 2 }); foundry.save(workflow);
  const run = foundry.createRun(workflow.id);
  const result = await foundry.startRun(run.id);
  assert.equal(result.status, 'succeeded', JSON.stringify(result.error));
  const observed = calls();
  assert.equal(observed.length, 2);
  assert.notEqual(observed[0].args.operationKey, 'model-selected-key');
  assert.equal(observed[0].args.operationKey, observed[1].args.operationKey);
  assert.equal(result.outputs.operation.key, observed[0].args.operationKey);
});

test('security authority: uninstall preserves an edit made after its initial conflict scan', { timeout: 10000 }, () => {
  // Deterministically inject a concurrent editor at the first deletion boundary.
  // A child process contains the temporary fs binding replacement and restores
  // it in finally; only that child's owned temporary installation is touched.
  const moduleURL = new URL('../src/install.mjs', import.meta.url).href;
  const source = `
    import fs from 'node:fs';
    import path from 'node:path';
    import {tmpdir} from 'node:os';
    import {syncBuiltinESMExports} from 'node:module';
    import {install,uninstall} from ${JSON.stringify(moduleURL)};
    const root=fs.mkdtempSync(path.join(tmpdir(),'foundry-uninstall-audit-'));
    const originalUnlink=fs.unlinkSync;
    let result={injected:false,preserved:false};
    try {
      const receipt=install(root,{client:'generic',hooks:false});
      const journal=JSON.parse(fs.readFileSync(receipt.journal,'utf8'));
      const deletes=journal.changes.filter(change=>change.before===null).reverse();
      if(deletes.length<2) throw Error('Audit fixture needs two initially absent installed files');
      const first=path.join(root,deletes[0].relative), changed=path.join(root,deletes[1].relative);
      const content='Concurrent user edit: preserve this exact fixture text';
      fs.unlinkSync=function(file,...args){
        if(file===first&&!result.injected){fs.writeFileSync(changed,content);result.injected=true;}
        return originalUnlink.call(fs,file,...args);
      };
      syncBuiltinESMExports();
      try {result.receipt=uninstall(root,receipt.id);} catch(error){result.error=error.code||error.name;}
      result.preserved=fs.existsSync(changed)&&fs.readFileSync(changed,'utf8')===content;
    } finally {
      fs.unlinkSync=originalUnlink;syncBuiltinESMExports();fs.rmSync(root,{recursive:true,force:true});
    }
    process.stdout.write(JSON.stringify(result));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8', timeout: 7000, maxBuffer: 100000,
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' },
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.injected, true, 'The intended concurrent-edit boundary was not exercised');
  assert.equal(result.preserved, true, `Uninstall removed or overwrote the concurrent edit: ${JSON.stringify(result)}`);
});
